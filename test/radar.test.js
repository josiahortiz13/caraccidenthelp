// Crash Radar: parsing the TranStar feed, one row per incident, honest statuses, owner-only alerts with
// a cap, feed outage + recovery alerts, 3-minute throttle. The feed is faked; nothing calls TranStar.
process.env.RADAR_ENABLED = 'true';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const db = require('../lib/db');
const radar = require('../lib/radar');
const store = require('../lib/store');

const fakeTw = global.__crashhelpFakeTwilio;
const fakeMail = global.__crashhelpFakeEmail;
let base, server, ownerCookie, staffCookie;

const item = (id, status, title, desc) => `<item><title>${title}</title><link>http://traffic.houstontranstar.org</link><description>${desc}</description><pubDate>Thu, 29 Oct 2026 19:03:16 GMT</pubDate><guid isPermaLink="false">${id}_${status}</guid></item>`;
const feed = (...items) => `﻿<?xml version="1.0" encoding="utf-8"?><rss version="2.0"><channel><title>Houston TranStar Incidents</title><pubDate>Thu, 29 Oct 2026 19:03:16 GMT</pubDate>${items.join('')}</channel></rss>`;
const STALL = item('100', 'Verified', 'Beltway 8-North Westbound At IH-45 North - Stall', 'Status: Verified at 1:54 PM - Lanes Affected: 1 Shoulder Lane(s)');
const MINOR = (st = 'Verified') => item('200', st, 'SH-288 Northbound At Holly Hall St - Accident', `Status: ${st} at 1:58 PM - Lanes Affected: 1 Mainlane(s), 1 Shoulder Lane(s)`);
const MINOR_CLEARED = item('200', 'Cleared', 'SH-288 Northbound At Holly Hall St - Accident', 'Status: Cleared at 2:20 PM');
const MAJOR = (id = '300', st = 'Detected') => item(id, st, `IH-10 Katy Eastbound At Bunker Hill Rd - Accident, Heavy Truck`, `Status: ${st} at 2:01 PM - Lanes Affected: 3 Mainlane(s)`);

let nextFeed = feed();
global.__crashhelpRadarFetch = async () => { if (nextFeed instanceof Error) throw nextFeed; return nextFeed; };

async function poll(xml) { nextFeed = xml; return radar.poll({ force: true }); }
const radarTexts = () => fakeTw.sent.filter((m) => /Crash Radar/.test(m.body));
const radarMails = () => fakeMail.sent.filter((m) => /Crash Radar/.test(m.subject || m.text || ''));
async function api(action, { cookie = ownerCookie, method = 'GET', body, params = {} } = {}) {
  const r = await fetch(`${base}/api/radar?${new URLSearchParams({ a: action, ...params })}`, {
    method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/json', 'X-CrashHelp': '1' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
async function login(name, password) {
  const r = await fetch(`${base}/api/admin?a=login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CrashHelp': '1' }, body: JSON.stringify({ name, password }) });
  return r.headers.get('set-cookie').split(';')[0];
}

test.before(async () => {
  server = await h.start(); base = 'http://localhost:' + server.address().port;
  ownerCookie = await login('Josiah', 'owner-pass'); staffCookie = await login('Staff', 'staff-pass');
});
test.after(() => server.close());
test.beforeEach(async () => {
  fakeTw.sent.length = 0; fakeTw.fail = false; fakeMail.sent.length = 0; fakeMail.fail = false;
  await db.query('DELETE FROM radar_incidents'); await db.query('DELETE FROM radar_events');
  await db.query("DELETE FROM system_status WHERE key = 'radar'");
  await store.saveSettings({ radar_alert_sms: true, radar_alert_email: true, radar_alert_severity: 'major', radar_alert_max_per_hour: 6, radar_alert_emails: [] });
});

test('X1. parses the real TranStar format: road, direction, cross street, type, lanes, status, time', () => {
  const f = radar.parseFeed(feed(MINOR(), MAJOR(), STALL));
  const [minor, major, stall] = f.items;
  assert.equal(minor.incident_id, '200'); assert.equal(minor.road, 'SH-288 Northbound'); assert.equal(minor.direction, 'Northbound');
  assert.equal(minor.cross_street, 'Holly Hall St'); assert.equal(minor.is_crash, true); assert.equal(minor.severity, 'MINOR'); assert.equal(minor.status, 'ACTIVE');
  assert.equal(major.severity, 'MAJOR'); assert.equal(major.is_truck, true);
  assert.equal(stall.is_crash, false, 'stalls are not crashes');
  assert.equal(radar.sourceTime('1:58 PM', 'Thu, 29 Oct 2026 19:03:16 GMT').toISOString(), '2026-10-29T18:58:00.000Z');
  assert.throws(() => radar.parseFeed('<html>blocked</html>'), /not an RSS feed/);
});

test('X2. first run is a baseline (no alerts, not listed); later crashes alert the owner only; stalls never', async () => {
  const b = await poll(feed(MINOR(), STALL));
  assert.equal(b.baseline, true); assert.equal(radarTexts().length + radarMails().length, 0);
  const r = await poll(feed(MINOR(), STALL, MAJOR()));
  assert.equal(r.new, 1); assert.equal(r.alerted, 1);
  assert.deepEqual(radarTexts().map((m) => m.to), ['+18325550101'], 'text goes to the owner phone from Settings');
  assert.match(radarTexts()[0].body, /Never contact, text, call, message or approach anyone involved/);
  const list = await api('list');
  assert.deepEqual(list.json.incidents.map((i) => i.incident_id), ['300'], 'baseline incidents are not shown as new');
  assert.equal(list.json.feed.coordinates, false);
});

test('X3. Detected → Verified → Cleared is ONE incident: one alert, three history entries, CLEARED', async () => {
  await poll(feed(STALL));
  await poll(feed(STALL, MAJOR('300', 'Detected')));
  await poll(feed(STALL, MAJOR('300', 'Verified')));
  await poll(feed(STALL, item('300', 'Cleared', 'IH-10 Katy Eastbound At Bunker Hill Rd - Accident, Heavy Truck', 'Status: Cleared at 2:40 PM')));
  assert.equal(radarTexts().length, 1, 'no duplicate alerts');
  const rows = await db.query("SELECT status, cleared_at FROM radar_incidents WHERE incident_id = '300'");
  assert.equal(rows.rows.length, 1); assert.equal(rows.rows[0].status, 'CLEARED'); assert.ok(rows.rows[0].cleared_at);
  assert.equal((await db.one("SELECT severity FROM radar_incidents WHERE incident_id = '300'")).severity, 'MAJOR', 'severity survives the lane-less Cleared entry');
  const hist = await api('history', { params: { incident: '300' } });
  assert.deepEqual(hist.json.events.map((e) => e.status), ['ACTIVE', 'ACTIVE', 'CLEARED']);
});

test('X4. a crash that drops off the feed without "Cleared" is UNKNOWN, never assumed cleared', async () => {
  await poll(feed(STALL));
  await poll(feed(STALL, MAJOR()));
  await poll(feed(STALL));
  const row = await db.one("SELECT status, gone_at, cleared_at FROM radar_incidents WHERE incident_id = '300'");
  assert.equal(row.status, 'UNKNOWN'); assert.ok(row.gone_at); assert.equal(row.cleared_at, null);
  const list = await api('list');
  assert.match(list.json.incidents[0].status_note, /not confirmed cleared/);
});

test('X5. filters: minor crashes are listed but only alert when the setting allows; severity/status filters work', async () => {
  await poll(feed(STALL));
  await poll(feed(STALL, MINOR(), MAJOR()));
  assert.equal(radarTexts().length, 1, 'only the major one alerted by default');
  assert.equal((await api('list', { params: { severity: 'MINOR' } })).json.incidents.length, 1);
  assert.equal((await api('list', { params: { severity: 'MAJOR' } })).json.incidents.length, 1);
  assert.equal((await api('list', { params: { status: 'CLEARED' } })).json.incidents.length, 0);
  assert.equal((await api('alert-settings', { method: 'POST', body: { severity: 'minor' } })).status, 200);
  await poll(feed(STALL, MINOR(), MAJOR(), item('400', 'Verified', 'US-59 South At Shepherd - Accident', 'Status: Verified at 2:05 PM - Lanes Affected: 1 Mainlane(s)')));
  assert.equal(radarTexts().length, 2, 'minor now alerts');
});

test('X6. hourly alert cap stops a flood; everything is still listed', async () => {
  await store.saveSettings({ radar_alert_max_per_hour: 2 });
  await poll(feed(STALL));
  await poll(feed(STALL, MAJOR('301'), MAJOR('302'), MAJOR('303'), MAJOR('304')));
  assert.equal(radarTexts().length, 2);
  assert.equal((await api('list')).json.incidents.length, 4);
});

test('X7. feed outage: no fake data, one outage alert after ~15 min, statuses go UNKNOWN, recovery alert', async () => {
  await poll(feed(STALL));
  await poll(feed(STALL, MAJOR()));
  fakeTw.sent.length = 0; fakeMail.sent.length = 0;
  for (let i = 0; i < 6; i++) { const r = await poll(new Error('feed HTTP 503')); assert.equal(r.ok, false); }
  const outage = radarTexts().filter((m) => /failed/.test(m.body));
  assert.equal(outage.length, 1, 'one outage alert, not one per failure');
  // Make the last good poll old: ACTIVE incidents now show as UNKNOWN.
  await db.query("UPDATE system_status SET value = jsonb_set(value, '{last_ok}', to_jsonb((now() - interval '20 minutes')::text)) WHERE key = 'radar'");
  const list = await api('list');
  assert.equal(list.json.feed.stale, true); assert.equal(list.json.incidents[0].shown_status, 'UNKNOWN');
  await poll(feed(STALL, MAJOR()));
  assert.equal(radarTexts().filter((m) => /is back/.test(m.body)).length, 1);
  assert.equal((await db.one('SELECT count(*)::int AS n FROM radar_incidents')).n, 1, 'nothing invented during the outage (stalls are not stored)');
});

test('X8. background: the cron tick polls at most every 3 minutes, and not at all when switched off', async () => {
  nextFeed = feed(STALL);
  const tick = async () => (await (await fetch(`${base}/api/cron`, { headers: { Authorization: 'Bearer ' + h.ENV.CRON_SECRET } })).json()).crash_radar;
  assert.equal((await tick()).ok, true);
  assert.equal((await tick()).skipped, 'throttled');
  process.env.RADAR_ENABLED = 'false';
  await db.query("DELETE FROM system_status WHERE key = 'radar'");
  assert.equal((await tick()).skipped, 'disabled');
  process.env.RADAR_ENABLED = 'true';
});

test('X9. restart recovery: state lives in the database, so a fresh process does not re-alert old incidents', async () => {
  await poll(feed(STALL));
  await poll(feed(STALL, MAJOR()));
  // Simulate a cold start: nothing in memory matters, only the tables.
  delete require.cache[require.resolve('../lib/radar')];
  const fresh = require('../lib/radar');
  nextFeed = feed(STALL, MAJOR());
  const r = await fresh.poll({ force: true });
  assert.equal(r.new, 0); assert.equal(r.baseline, false); assert.equal(radarTexts().length, 1);
});

test('X10. access: login required, staff can view, only the owner can change alerts or force a poll', async () => {
  assert.equal((await api('list', { cookie: null })).status, 401);
  assert.equal((await api('list', { cookie: staffCookie })).status, 200);
  assert.equal((await api('alert-settings', { cookie: staffCookie, method: 'POST', body: { sms: true } })).status, 403);
  assert.equal((await api('poll-now', { cookie: staffCookie, method: 'POST' })).status, 403);
  nextFeed = feed(STALL);
  assert.equal((await api('poll-now', { method: 'POST' })).status, 200);
});

test('X11. extra staff emails get radar alerts; owner-only; invalid addresses refused; never contact reminder', async () => {
  assert.equal((await api('alert-settings', { cookie: staffCookie, method: 'POST', body: { extra_emails: 'staff@example.com' } })).status, 403);
  assert.equal((await api('alert-settings', { method: 'POST', body: { extra_emails: 'not-an-email' } })).status, 400);
  assert.equal((await api('alert-settings', { method: 'POST', body: { extra_emails: 'Chelsie@Example.com, chelsie@example.com' } })).status, 200);
  assert.deepEqual((await api('list')).json.alerts.extra_emails, ['chelsie@example.com'], 'normalized and de-duplicated');
  assert.equal((await api('list', { cookie: staffCookie })).json.alerts.extra_emails, undefined, 'staff do not see the list');
  await poll(feed(STALL));
  await poll(feed(STALL, MAJOR()));
  const mail = radarMails();
  assert.equal(mail.length, 1, 'one email, both recipients');
  assert.match(mail[0].to, /owner@example\.com/); assert.match(mail[0].to, /chelsie@example\.com/);
  assert.match(mail[0].text, /Never contact, text, call, message or approach anyone involved/);
  assert.equal(radarTexts().length, 1, 'texts still go only to the owner phone');
});
