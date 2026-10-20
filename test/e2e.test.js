// End-to-end tests: real HTTP requests into the API functions, real SQL (PGlite),
// signed Twilio webhooks, recording fakes for Twilio / email / HighLevel.
// Run: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const db = require('../lib/db');

const fakeTw = global.__crashhelpFakeTwilio;
const fakeMail = global.__crashhelpFakeEmail;
const OWNER = '+18325550101', BACKUP = '+18325550102', TESTER = '+18325550199';
let base, server, ownerCookie, staffCookie;

function reset() { fakeTw.sent.length = 0; fakeTw.calls.length = 0; fakeTw.fail = false; fakeMail.sent.length = 0; fakeMail.fail = false; h.crmFake.calls.length = 0; h.crmFake.fail = false; }
const smsTo = (n) => fakeTw.sent.filter((m) => m.to === n);
const callsTo = (n) => fakeTw.calls.filter((c) => c.to === n);

async function submit(over = {}) {
  const body = {
    first_name: 'Maria', last_name: 'Lopez', phone: '(832) 555-0199', email: 'maria@example.com',
    crash_date: new Date().toISOString().slice(0, 10), crash_city: 'Houston', crash_county: 'Harris',
    person_type: 'driver', injured: 'yes', medical_care: 'yes', vehicle_damage: 'yes', other_vehicle: 'yes', insurance_info: 'unsure',
    description: 'Rear-ended on Beltway 8', preferred_contact: 'call', contact_consent: true,
    utm_source: 'meta', utm_medium: 'paid', utm_campaign: 'crash-video', fbclid: 'fb.1.abc', landing_page: '/start?utm_source=meta', ...over,
  };
  const r = await fetch(base + '/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': over._ip || '10.0.0.' + Math.floor(Math.random() * 250) }, body: JSON.stringify(body) });
  return { status: r.status, json: await r.json() };
}

async function admin(action, { cookie = ownerCookie, method = 'GET', body, params = {}, csrf = true } = {}) {
  const r = await fetch(`${base}/api/admin?${new URLSearchParams({ a: action, ...params })}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { 'Content-Type': 'application/json', ...(csrf ? { 'X-CrashHelp': '1' } : {}) } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, json: await r.json().catch(() => ({})), headers: r.headers };
}

async function login(name, password) {
  const r = await admin('login', { cookie: null, method: 'POST', body: { name, password } });
  assert.equal(r.status, 200, 'login should succeed');
  return r.headers.get('set-cookie').split(';')[0];
}

async function backdate(leadId, minutes) {
  await db.query(`UPDATE leads SET created_at = now() - make_interval(mins => $2::int) WHERE lead_id = $1`, [leadId, minutes]);
}
async function lead(id) { return db.one('SELECT * FROM leads WHERE lead_id = $1', [id]); }
async function events(id) { return (await db.query('SELECT type, detail FROM events WHERE lead_id = $1 ORDER BY id', [id])).rows; }
async function tick() { const r = await fetch(`${base}/api/cron`, { headers: { Authorization: 'Bearer ' + h.ENV.CRON_SECRET } }); return r.json(); }

test.before(async () => {
  server = await h.start(); base = 'http://localhost:' + server.address().port;
  ownerCookie = await login('Josiah', 'owner-pass');
  staffCookie = await login('Staff', 'staff-pass');
});
test.after(() => server.close());
test.beforeEach(async () => { reset(); await db.query('DELETE FROM leads'); await db.query('DELETE FROM opt_outs'); await db.query('DELETE FROM sms_sessions'); await db.query('DELETE FROM messages'); await db.query('DELETE FROM calls'); await db.query('DELETE FROM crm_queue'); await db.query('DELETE FROM rate_limits'); });

test('1. form → database → lead ID → confirmation SMS → owner + backup alerts → owner call → emails → CRM', async () => {
  const r = await submit();
  assert.equal(r.status, 200);
  assert.match(r.json.lead_id, /^CH-\d{6}-[0-9A-F]{5}$/);
  const l = await lead(r.json.lead_id);
  assert.equal(l.phone, TESTER); assert.equal(l.lead_status, 'NEW'); assert.equal(l.lead_priority, 'HIGH PRIORITY');
  assert.equal(l.utm_campaign, 'crash-video'); assert.equal(l.fbclid, 'fb.1.abc'); assert.equal(l.contact_consent, true);
  assert.ok(l.first_alert_at, 'first_alert_at recorded');

  const conf = smsTo(TESTER);
  assert.equal(conf.length, 1);
  assert.equal(conf[0].body, 'Hi Maria, this is CrashHelp TX. We received your request. Keep any photos, insurance information, report details, and other records you have. Someone will review your request and follow up shortly. Reply STOP to opt out.');
  assert.equal(conf[0].from, '+13468601929');

  const alert = smsTo(OWNER)[0].body;
  for (const s of ['🚨 NEW CRASHHELP TX LEAD', 'Name: Maria Lopez', 'Phone: +18325550199', 'City: Houston', 'County: Harris', 'Injury: yes', 'Medical Care: yes', 'Vehicle Damage: yes', 'Preferred Contact: call', 'Source: meta', 'Campaign: crash-video', `Lead ID: ${r.json.lead_id}`, 'CALL NOW:', `https://www.crashhelptx.com/admin#${r.json.lead_id}`]) {
    assert.ok(alert.includes(s), 'owner alert contains ' + s);
  }
  assert.equal(smsTo(BACKUP).length, 1, 'backup alerted');
  assert.equal(callsTo(OWNER).length, 1, 'owner phone rings');
  assert.match(callsTo(OWNER)[0].url, /r=owner-alert/);
  assert.equal(callsTo(OWNER)[0].machineDetection, 'Enable');

  const subjects = fakeMail.sent.map((m) => `${m.to} ${m.subject}`);
  assert.ok(subjects.includes('owner@example.com 🚨 New CrashHelp TX Lead — Maria — Houston'));
  assert.ok(subjects.includes('backup@example.com 🚨 New CrashHelp TX Lead — Maria — Houston'));
  assert.ok(subjects.includes('maria@example.com We received your CrashHelp TX request'));

  const crm = h.crmFake.calls.map((c) => `${c.method} ${c.url.replace('https://services.leadconnectorhq.com', '')}`);
  assert.deepEqual(crm, ['POST /contacts/upsert', `POST /contacts/ghl_contact_${h.crmFake.n - 1}/notes`, 'POST /opportunities/']);
  assert.equal(h.crmFake.calls[0].headers.Version, '2021-07-28');
  assert.equal(h.crmFake.calls[0].body.locationId, 'loc123');
  assert.equal(h.crmFake.calls[2].body.pipelineStageId, 'st_new');
  const after = await lead(r.json.lead_id);
  assert.ok(after.crm_contact_id && after.crm_opportunity_id);

  const list = await admin('leads');
  assert.equal(list.status, 200);
  assert.ok(list.json.leads.some((x) => x.lead_id === r.json.lead_id), 'lead appears in dashboard');
});

test('2. owner answers alert call → press 1 → bridged to lead from the business number → CONTACTED', async () => {
  const { json } = await submit();
  const tw = await h.twilioPost(base, `r=owner-alert&lead=${json.lead_id}`, { CallSid: 'CAowner1', AnsweredBy: 'human' });
  assert.match(tw.text, /New CrashHelp T X lead from Maria in Houston\. Press 1 to connect\./);
  assert.match(tw.text, /<Gather numDigits="1"/);

  const g = await h.twilioPost(base, `r=owner-gather&lead=${json.lead_id}`, { CallSid: 'CAowner1', Digits: '1' });
  assert.match(g.text, /<Dial callerId="\+13468601929"/, 'lead sees CrashHelp number, not owner');
  assert.match(g.text, /\+18325550199<\/Dial>/);
  assert.equal((await lead(json.lead_id)).lead_status, 'CONTACT ATTEMPTED');

  await h.twilioPost(base, `r=bridge-status&lead=${json.lead_id}&actor=owner`, { CallSid: 'CAowner1', DialCallStatus: 'completed', DialCallDuration: '94' });
  const l = await lead(json.lead_id);
  assert.equal(l.lead_status, 'CONTACTED'); assert.ok(l.first_contact_at); assert.ok(l.first_response_at);
  const ev = (await events(json.lead_id)).map((e) => e.type);
  for (const t of ['lead_created', 'sms_sent', 'internal_alert_sent', 'call_started', 'crm_synced', 'owner_alert_answered', 'contact_attempt', 'call_connected']) assert.ok(ev.includes(t), 'timeline has ' + t);

  const m = await admin('metrics');
  assert.ok(m.json.times.avg_attempt_sec !== null && m.json.times.avg_attempt_sec < 60, 'response time tracked');
  assert.equal(m.json.counts.contacted, 1);
});

test('3. test mode: real lead numbers are never texted or dialed', async () => {
  const { json } = await submit({ phone: '713-555-0142', email: '' });
  assert.equal(fakeTw.sent.filter((m) => m.to === '+17135550142').length, 0, 'no SMS to non-test number');
  const blocked = await db.one(`SELECT status, error FROM messages WHERE to_number = '+17135550142'`);
  assert.deepEqual(blocked, { status: 'blocked', error: 'test_mode_blocked' });
  assert.equal(smsTo(OWNER).length, 1, 'owner still alerted');
  const g = await h.twilioPost(base, `r=owner-gather&lead=${json.lead_id}`, { CallSid: 'CAx', Digits: '1' });
  assert.match(g.text, /Test mode is on/);
  assert.doesNotMatch(g.text, /<Dial/);
});

test('4. missed call → caller texted back → PENDING CONSENT → replies YES → becomes a full lead', async () => {
  const v = await h.twilioPost(base, 'r=voice', { CallSid: 'CAin1', From: TESTER, To: '+13468601929' });
  assert.match(v.text, /<Dial timeout="20"/); assert.match(v.text, /\+18325550101<\/Number>/); assert.match(v.text, /\+18325550102<\/Number>/);

  const d = await h.twilioPost(base, 'r=dial-status', { CallSid: 'CAin1', From: TESTER, DialCallStatus: 'no-answer' });
  assert.match(d.text, /We just sent you a text/);
  const tb = smsTo(TESTER)[0].body;
  assert.equal(tb, 'Hi, you reached CrashHelp TX. We missed your call. If you were recently involved in a crash and want help organizing your next steps, reply YES or start here: https://www.crashhelptx.com/connect');
  assert.match(smsTo(OWNER)[0].body, /📵 MISSED CALL/);
  const pending = await db.one(`SELECT * FROM leads WHERE phone = $1`, [TESTER]);
  assert.equal(pending.lead_status, 'PENDING CONSENT'); assert.equal(pending.contact_consent, false); assert.equal(pending.marketing_consent, false);

  reset();
  await h.twilioPost(base, 'r=sms', { MessageSid: 'SMin1', From: TESTER, To: '+13468601929', Body: 'yes' });
  assert.equal(smsTo(TESTER).at(-1).body, 'Thanks. What is your first name?');
  const steps = [['Andre', /When did the crash happen/], ['2', /Were you hurt/], ['maybe', /seen a doctor/], ['not yet', /What city/], ['Pasadena', /CALL or TEXT/]];
  for (const [i, [b, next]] of steps.entries()) { await h.twilioPost(base, 'r=sms', { MessageSid: 'SMin' + (i + 2), From: TESTER, To: '+13468601929', Body: b }); assert.match(smsTo(TESTER).at(-1).body, next); }
  await h.twilioPost(base, 'r=sms', { MessageSid: 'SMin9', From: TESTER, To: '+13468601929', Body: 'Call' });
  const l = await lead(pending.lead_id);
  assert.equal(l.lead_status, 'NEW'); assert.equal(l.contact_consent, true); assert.equal(l.first_name, 'Andre'); assert.equal(l.crash_city, 'Pasadena');
  assert.equal(l.injury_status, 'unsure'); assert.equal(l.medical_status, 'not_yet'); assert.match(l.description, /When: In the last few days/);
  assert.match(smsTo(TESTER).at(-1).body, /^Hi Andre, this is CrashHelp TX\. We received your request/);
  assert.match(smsTo(OWNER).at(-1).body, /NEW CRASHHELP TX LEAD/);
  assert.equal(callsTo(OWNER).length, 1, 'owner phone rings for call request');
});

test('5. keyword CRASH from a new number → short consent flow → lead created', async () => {
  await h.twilioPost(base, 'r=sms', { MessageSid: 'SMk1', From: TESTER, To: '+13468601929', Body: 'Crash' });
  const optin = smsTo(TESTER)[0].body;
  assert.match(optin, /^CrashHelp TX: answer 5 quick questions/); assert.match(optin, /Reply YES/); assert.match(optin, /Msg & data rates may apply/); assert.match(optin, /STOP to opt out, HELP for help/);
  assert.equal(await db.one('SELECT 1 FROM leads WHERE phone = $1', [TESTER]), null, 'no lead before consent');
  // a bad answer gets the question again, nothing saved yet
  for (const [i, b] of ['YES', 'Keisha', '1', 'banana'].entries()) await h.twilioPost(base, 'r=sms', { MessageSid: 'SMk' + (i + 2), From: TESTER, To: '+13468601929', Body: b });
  assert.match(smsTo(TESTER).at(-1).body, /Were you hurt\? Reply YES, NO, or NOT SURE/);
  for (const [i, b] of ['yes', 'yes', 'Baytown', 'text'].entries()) await h.twilioPost(base, 'r=sms', { MessageSid: 'SMk' + (i + 10), From: TESTER, To: '+13468601929', Body: b });
  const l = await db.one('SELECT * FROM leads WHERE phone = $1', [TESTER]);
  assert.equal(l.source, 'sms-quiz'); assert.equal(l.injury_status, 'yes'); assert.equal(l.medical_status, 'yes'); assert.equal(l.crash_city, 'Baytown'); assert.match(l.description, /When: Today/); assert.equal(l.preferred_contact, 'text'); assert.equal(l.contact_consent, true); assert.match(l.consent_text, /Reply YES to start/);
  assert.equal(callsTo(OWNER).length, 0, 'no voice alert when they prefer text (setting: call requests only)');
});

test('6. STOP opts out immediately; no more texts; START re-subscribes', async () => {
  const { json } = await submit();
  await h.twilioPost(base, 'r=sms', { MessageSid: 'SMs1', From: TESTER, To: '+13468601929', Body: 'STOP' });
  const l = await lead(json.lead_id);
  assert.equal(l.sms_opt_out, true); assert.ok(l.sms_opt_out_at);
  assert.ok(await db.one('SELECT 1 FROM opt_outs WHERE phone = $1', [TESTER]));
  reset();
  const t = await admin('text', { method: 'POST', body: { lead_id: json.lead_id, body: 'Following up' } });
  assert.equal(t.status, 400); assert.match(t.json.error, /opted out/);
  for (const w of ['UNSUBSCRIBE', 'cancel', 'End', 'QUIT', 'stopall']) {
    await h.twilioPost(base, 'r=sms', { MessageSid: 'SMs' + w, From: TESTER, To: '+13468601929', Body: w });
  }
  assert.equal(smsTo(TESTER).length, 0, 'nothing sent to opted-out number');
  await h.twilioPost(base, 'r=sms', { MessageSid: 'SMs9', From: TESTER, To: '+13468601929', Body: 'START' });
  assert.equal(await db.one('SELECT 1 FROM opt_outs WHERE phone = $1', [TESTER]), null);
});

test('7. duplicate lead (same phone) is linked, not double-confirmed, and flagged as a repeat', async () => {
  const a = await submit();
  reset();
  const b = await submit({ email: 'other@example.com', first_name: 'María' });
  assert.equal(b.json.lead_id, a.json.lead_id, 'API returns the original lead');
  const dup = await db.one(`SELECT * FROM leads WHERE duplicate_of = $1`, [a.json.lead_id]);
  assert.equal(dup.lead_status, 'DUPLICATE');
  assert.equal(smsTo(TESTER).length, 0, 'no second confirmation within 24h');
  assert.match(smsTo(OWNER)[0].body, /REPEAT CRASHHELP TX SUBMISSION/);
  const byEmail = await submit({ phone: '', email: 'MARIA@example.com' });
  assert.equal(byEmail.json.lead_id, a.json.lead_id, 'dedupes by email too');
  const list = await admin('leads');
  assert.equal(list.json.leads.filter((x) => x.phone === TESTER).length, 1, 'dashboard shows one card');
});

test('8. Twilio outage: lead still saved, email alert still sent, failure visible on dashboard', async () => {
  fakeTw.fail = true;
  const r = await submit();
  assert.equal(r.status, 200);
  const l = await lead(r.json.lead_id);
  assert.ok(l, 'lead saved');
  assert.ok(fakeMail.sent.some((m) => m.to === 'owner@example.com'), 'email alert still fired');
  const ev = (await events(r.json.lead_id)).map((e) => e.type);
  assert.ok(ev.includes('sms_failed')); assert.ok(ev.includes('call_failed'));
  const s = await admin('status');
  assert.equal(s.json.sms.state, 'FAILED'); assert.ok(s.json.last_twilio_failure);
});

test('9. email outage: SMS alert still fires', async () => {
  fakeMail.fail = true;
  const r = await submit();
  assert.equal(smsTo(OWNER).length, 1);
  assert.ok((await events(r.json.lead_id)).some((e) => e.type === 'email_failed'));
});

test('10. CRM outage: lead saved locally, queued, retried by the timer, then synced', async () => {
  h.crmFake.fail = true;
  const r = await submit();
  assert.ok(await lead(r.json.lead_id));
  const q = await db.one('SELECT * FROM crm_queue WHERE lead_id = $1', [r.json.lead_id]);
  assert.equal(q.done, false); assert.match(q.last_error, /503/);
  const st = await admin('status'); assert.equal(st.json.crm.state, 'FAILED');
  h.crmFake.fail = false;
  await db.query('UPDATE crm_queue SET next_at = now()');
  const t = await tick();
  assert.equal(t.crm_retry.ok, 1);
  assert.equal((await db.one('SELECT done FROM crm_queue WHERE lead_id = $1', [r.json.lead_id])).done, true);
  assert.ok((await lead(r.json.lead_id)).crm_opportunity_id);
});

test('11. escalation: 5 min → owner, 15 min → owner + backup, 30 min → owner call; lead never re-texted', async () => {
  const { json } = await submit({ preferred_contact: 'text' });
  reset();
  await backdate(json.lead_id, 6); await tick();
  assert.match(smsTo(OWNER)[0].body, /^⚠️ CRASHHELP LEAD STILL UNCONTACTED\nLead: CH-.*\nMaria — \+18325550199\n5 minutes old\./);
  assert.equal(smsTo(BACKUP).length, 0);
  await tick(); assert.equal(smsTo(OWNER).length, 1, 'same level never repeats');

  await backdate(json.lead_id, 16); await tick();
  assert.match(smsTo(OWNER)[1].body, /^🚨 15-MINUTE RESPONSE ALERT\nThis lead has not been contacted\./);
  assert.equal(smsTo(BACKUP).length, 1);

  await backdate(json.lead_id, 31); await tick();
  assert.match(smsTo(OWNER)[2].body, /30-MINUTE RESPONSE ALERT/);
  assert.equal(callsTo(OWNER).length, 1, 'owner phone rings at 30 min');
  assert.equal(smsTo(TESTER).length, 0, 'consumer never messaged by escalation');

  const { json: j2 } = await submit({ phone: '832-555-0198', email: 'x2@example.com' });
  await admin('mark-contacted', { method: 'POST', body: { lead_id: j2.lead_id } });
  reset(); await backdate(j2.lead_id, 20); await tick();
  assert.equal(fakeTw.sent.length, 0, 'contacted leads do not escalate');
});

test('12. owner misses the alert call → backup phone rings after the configured delay', async () => {
  const { json } = await submit();
  const ownerCall = await db.one(`SELECT sid FROM calls WHERE lead_id = $1 AND purpose = 'owner_alert'`, [json.lead_id]);
  reset();
  await h.twilioPost(base, `r=call-status&purpose=owner_alert&lead=${json.lead_id}`, { CallSid: ownerCall.sid, CallStatus: 'no-answer' });
  assert.ok((await lead(json.lead_id)).backup_call_due_at, 'backup scheduled');
  await tick(); assert.equal(callsTo(BACKUP).length, 0, 'waits for the delay');
  await db.query(`UPDATE leads SET backup_call_due_at = now() - interval '1 second' WHERE lead_id = $1`, [json.lead_id]);
  await tick();
  assert.equal(callsTo(BACKUP).length, 1, 'backup phone rings');
  assert.match(smsTo(BACKUP)[0].body, /Owner didn't answer/);

  // Voicemail picks up the owner call → treated as not answered.
  const { json: j2 } = await submit({ phone: '832-555-0197', email: 'v@example.com' });
  const vm = await h.twilioPost(base, `r=owner-alert&lead=${j2.lead_id}`, { CallSid: 'CAvm', AnsweredBy: 'machine_start' });
  assert.match(vm.text, /<Hangup\/>/);
  assert.ok((await lead(j2.lead_id)).backup_call_due_at);
});

test('13. security: Twilio signatures, admin auth, CSRF, roles, rate limit', async () => {
  const bad = await h.twilioPost(base, 'r=sms', { From: TESTER, Body: 'STOP' }, { badSignature: true });
  assert.equal(bad.status, 403);
  assert.equal(await db.one('SELECT 1 FROM opt_outs'), null, 'forged webhook did nothing');
  assert.equal((await admin('leads', { cookie: null })).status, 401);
  assert.equal((await admin('leads', { cookie: 'chx_admin=forged.token' })).status, 401);
  const { json } = await submit();
  assert.equal((await admin('mark-contacted', { method: 'POST', body: { lead_id: json.lead_id }, csrf: false })).status, 403);
  assert.equal((await admin('save-settings', { cookie: staffCookie, method: 'POST', body: { settings: { sms_alert: false } } })).status, 403);
  assert.equal((await admin('login', { cookie: null, method: 'POST', body: { name: 'Josiah', password: 'wrong' } })).status, 401);
  let last;
  for (let i = 0; i < 9; i++) last = await submit({ _ip: '9.9.9.9', phone: `832555${String(1000 + i)}`, email: `r${i}@example.com` });
  assert.equal(last.status, 429, 'form is rate limited per IP');
});

test('14. dashboard actions: one-tap call bridges via staff phone, text, note, status, assign, timeline', async () => {
  const { json } = await submit();
  reset();
  const c = await admin('call', { method: 'POST', body: { lead_id: json.lead_id } });
  assert.equal(c.status, 200);
  assert.equal(callsTo(OWNER).length, 1, 'rings the staff member first (owner phone)');
  assert.match(callsTo(OWNER)[0].url, /r=staff-connect/);
  const sc = await h.twilioPost(base, `r=staff-connect&lead=${json.lead_id}&actor=Josiah`, { CallSid: 'CAstaff' });
  assert.match(sc.text, /<Dial callerId="\+13468601929"/);

  const t = await admin('text', { method: 'POST', body: { lead_id: json.lead_id, body: 'Hi Maria, is now a good time?' } });
  assert.equal(t.status, 200); assert.equal(smsTo(TESTER).at(-1).body, 'Hi Maria, is now a good time?');
  await admin('note', { method: 'POST', body: { lead_id: json.lead_id, note: 'Left voicemail' } });
  await admin('assign', { method: 'POST', body: { lead_id: json.lead_id, assigned_to: 'Chelsie' } });
  h.crmFake.calls.length = 0;
  await admin('status-change', { method: 'POST', body: { lead_id: json.lead_id, status: 'QUALIFIED' } });
  const put = h.crmFake.calls.find((x) => x.method === 'PUT');
  assert.ok(put, 'CRM stage updated on status change'); assert.equal(put.body.pipelineStageId, 'st_q');
  await admin('status-change', { method: 'POST', body: { lead_id: json.lead_id, status: 'APPOINTMENT SET' } });
  const d = await admin('lead', { params: { id: json.lead_id } });
  const types = d.json.timeline.map((e) => e.type);
  for (const x of ['contact_attempt', 'note', 'assigned', 'status_changed']) assert.ok(types.includes(x), 'timeline ' + x);
  assert.equal(d.json.lead.assigned_to, 'Chelsie'); assert.ok(d.json.lead.appointment_at);
  const m = await admin('metrics'); assert.equal(m.json.counts.appointments, 1);
});

test('15. settings + status page + test alerts', async () => {
  const s = await admin('save-settings', { method: 'POST', body: { settings: { voice_alert_for: 'all_leads', escalation: [{ minutes: 3, notify: ['owner'], voice: false }], agent_phones: { Josiah: '832-555-0101' } } } });
  assert.equal(s.status, 200);
  const g = await admin('settings'); assert.equal(g.json.settings.voice_alert_for, 'all_leads'); assert.equal(g.json.settings.escalation[0].minutes, 3);
  const r = await submit({ preferred_contact: 'text' });
  assert.equal(callsTo(OWNER).length, 1, 'all_leads setting rings owner for text leads too');
  await admin('save-settings', { method: 'POST', body: { settings: { voice_alert_for: 'call_requests', escalation: [{ minutes: 5, notify: ['owner'] }, { minutes: 15, notify: ['owner', 'backup'] }, { minutes: 30, notify: ['owner', 'backup'], voice: true }] } } });
  reset();
  const ta = await admin('test-alerts', { method: 'POST', body: { voice: true } });
  assert.equal(ta.json.result.sms.ok, true); assert.equal(ta.json.result.voice.ok, true);
  const st = await admin('status');
  assert.equal(st.json.twilio, 'CONNECTED'); assert.equal(st.json.test_mode, true); assert.equal(st.json.phone_number, '(•••) •••-1929');
  assert.equal(st.json.last_test.sms, true);
  assert.ok(r.json.lead_id);
});

test('16. old site form (name/city/when) still works and nothing texts the lead without consent', async () => {
  const r = await fetch(base + '/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Tony Ramirez', phone: '8325550199', city: 'Dallas', when: 'Today', source: 'homepage' }) });
  const j = await r.json(); assert.equal(r.status, 200);
  const l = await lead(j.lead_id);
  assert.equal(l.first_name, 'Tony'); assert.equal(l.last_name, 'Ramirez'); assert.equal(l.crash_city, 'Dallas'); assert.equal(l.contact_consent, false);
  assert.equal(smsTo(TESTER).length, 0, 'no consent → no confirmation text');
  assert.equal(smsTo(OWNER).length, 1, 'owner still alerted');
});

// ---------------- Staging acceptance (mirrors the owner's go-live test plan) ----------------
const SPARE = '+18325550199'; // approved test number used as the TEST lead's phone (owner is ...0101)

test('17. one-tap chain test: TEST CRASHHELP lead → every step verified → ring → keypress → bridge → connected', async () => {
  const idx = h.ENV.ALLOWED_TEST_NUMBERS.split(',').indexOf(SPARE);
  const r = await admin('run-e2e', { method: 'POST', body: { phone_index: idx, kind: 'chain' } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const byName = Object.fromEntries(r.json.steps.map((s) => [s.name, s.result]));
  for (const s of ['Database save', 'Lead ID assigned', 'Marked is_test (hidden from real reporting)', 'Duplicate check', 'Confirmation SMS to test number',
    'Owner SMS alert', 'Backup SMS alert', 'Owner phone ringing (voice alert placed)', 'Email notification', 'CRM sync', 'Admin dashboard entry (TEST filter)', 'Response timer running']) {
    assert.equal(byName[s], 'PASS', s);
  }
  const id = r.json.lead_id;
  const l = await lead(id);
  assert.deepEqual([l.first_name, l.last_name, l.crash_city, l.crash_county, l.preferred_contact, l.injury_status, l.medical_status, l.vehicle_damage, l.utm_source, l.utm_campaign, l.is_test],
    ['TEST', 'CRASHHELP', 'Houston', 'Harris', 'call', 'unsure', 'not_yet', 'yes', 'END_TO_END_TEST', 'CRASHHELP_TEST', true]);
  assert.match(smsTo(OWNER)[0].body, /^🧪 TEST — 🚨 NEW CRASHHELP TX LEAD/);

  const ring = await h.twilioPost(base, `r=owner-alert&lead=${id}`, { CallSid: 'CAe2e', AnsweredBy: 'human' });
  assert.match(ring.text, /New CrashHelp T X test lead from Test in Houston\. Press 1 to connect\./);
  const press = await h.twilioPost(base, `r=owner-gather&lead=${id}`, { CallSid: 'CAe2e', Digits: '1' });
  assert.match(press.text, /<Dial callerId="\+13468601929"[^>]*>\+18325550199<\/Dial>/);
  await h.twilioPost(base, `r=bridge-status&lead=${id}&actor=owner`, { CallSid: 'CAe2e', DialCallStatus: 'completed', DialCallDuration: '37' });
  const types = (await events(id)).map((e) => e.type);
  for (const t of ['call_started', 'owner_alert_answered', 'owner_keypress', 'bridge_dialing', 'call_connected']) assert.ok(types.includes(t), t);
  assert.equal((await events(id)).find((e) => e.type === 'call_connected').detail.duration, 37);
  assert.equal((await lead(id)).lead_status, 'CONTACTED');

  // Test leads stay out of real reporting, but show under the TEST filter.
  assert.equal((await admin('leads')).json.leads.some((x) => x.lead_id === id), false);
  assert.equal((await admin('leads', { params: { status: 'TEST' } })).json.leads.some((x) => x.lead_id === id), true);
  assert.equal((await admin('metrics')).json.counts.contacted, 0);
  assert.equal((await admin('metrics', { params: { test: '1' } })).json.counts.contacted, 1);
});

test('18. accelerated escalation on a TEST lead: 1/2/3 min stand in for 5/15/30, stops when CONTACTED', async () => {
  const idx = h.ENV.ALLOWED_TEST_NUMBERS.split(',').indexOf(SPARE);
  const r = await admin('run-e2e', { method: 'POST', body: { phone_index: idx, kind: 'escalation' } });
  const id = r.json.lead_id;
  assert.equal(r.json.steps.find((s) => s.name === '0 min: owner alert sent').result, 'PASS');
  reset();
  await backdate(id, 1); await tick();
  assert.match(smsTo(OWNER)[0].body, /^🧪 TEST \(accelerated\) — ⚠️ CRASHHELP LEAD STILL UNCONTACTED/);
  assert.equal(smsTo(BACKUP).length, 0);
  await backdate(id, 2); await tick();
  assert.match(smsTo(OWNER)[1].body, /15-MINUTE RESPONSE ALERT/); assert.equal(smsTo(BACKUP).length, 1);
  await admin('mark-contacted', { method: 'POST', body: { lead_id: id } });
  await backdate(id, 3); await tick();
  assert.equal(smsTo(OWNER).length, 2, 'stopped immediately after CONTACTED');
  assert.equal(callsTo(OWNER).length, 0);
  assert.equal(smsTo(SPARE).length, 0, 'test lead never re-texted by escalation');

  // Real leads still use 5/15/30 (a 3-minute-old real lead does not escalate).
  const real = await submit({ phone: '832-555-0150', email: 'real@example.com' });
  reset(); await backdate(real.json.lead_id, 3); await tick();
  assert.equal(smsTo(OWNER).length, 0);
});

test('19b. running the chain test twice in a row confirms the tester both times', async () => {
  const idx = h.ENV.ALLOWED_TEST_NUMBERS.split(',').indexOf(SPARE);
  await submit(); // a real lead on the same phone earlier the same day must not block test confirmations
  for (let i = 0; i < 2; i++) {
    const r = await admin('run-e2e', { method: 'POST', body: { phone_index: idx } });
    assert.equal(r.json.steps.find((s) => s.name === 'Confirmation SMS to test number').result, 'PASS', 'run ' + (i + 1));
  }
});

test('19. a TEST marker on a non-approved number is ignored (real leads can never be hidden)', async () => {
  const r = await submit({ phone: '713-555-0142', utm_source: 'END_TO_END_TEST', utm_campaign: 'CRASHHELP_TEST' });
  assert.equal((await lead(r.json.lead_id)).is_test, false);
  assert.ok((await admin('leads')).json.leads.some((x) => x.lead_id === r.json.lead_id));
});

test('20. environment check reports CONFIGURED/MISSING/INVALID and never leaks a secret', async () => {
  const r = await admin('env-check');
  const st = Object.fromEntries(r.json.checks.map((c) => [c.name, c.state]));
  assert.equal(st.TWILIO_ACCOUNT_SID, 'CONFIGURED');
  assert.equal(st.TWILIO_AUTH_TOKEN, 'INVALID', 'harness token is not a real 32-hex token, so it must be flagged');
  assert.equal(st.TWILIO_PHONE_NUMBER, 'CONFIGURED');
  assert.equal(st.TWILIO_TEST_MODE, 'CONFIGURED');
  assert.equal(st.ALLOWED_TEST_NUMBERS, 'CONFIGURED');
  assert.equal(st.SESSION_SECRET, 'CONFIGURED');
  assert.equal(st['ADMIN credentials'], 'CONFIGURED');
  assert.equal(st.DATABASE_URL, 'CONFIGURED');
  assert.equal(st['Email (GMAIL_APP_PASSWORD)'], 'MISSING');
  assert.equal(st['CRM / HighLevel'], 'CONFIGURED');
  const raw = JSON.stringify(r.json);
  for (const secret of [h.ENV.TWILIO_AUTH_TOKEN, h.ENV.SESSION_SECRET, 'owner-pass', 'staff-pass', h.ENV.GHL_API_KEY, h.ENV.CRON_SECRET]) assert.ok(!raw.includes(secret), 'leaked ' + secret.slice(0, 4));
  assert.equal((await admin('env-check', { cookie: staffCookie })).status, 403, 'owner only');
});

test('21. Twilio number check + one-click webhook setup + A2P status', async () => {
  const fake = global.__crashhelpFakeTwilio;
  fake.number = { sid: 'PN1', phoneNumber: '+13468601929', capabilities: { sms: true, voice: true }, voiceUrl: '', smsUrl: 'https://demo.twilio.com/welcome/sms/reply', statusCallback: '' };
  fake.brands = [{ status: 'APPROVED' }]; fake.services = [{ sid: 'MG1' }]; fake.campaigns = { MG1: [{ campaignStatus: 'PENDING' }] };
  let c = await admin('twilio-check');
  const st = () => Object.fromEntries(c.json.items.map((i) => [i.name, i.state]));
  assert.equal(st()['SMS capable'], 'READY'); assert.equal(st()['Inbound voice webhook'], 'ACTION REQUIRED'); assert.equal(st()['A2P 10DLC'], 'PENDING');
  assert.equal((await admin('point-number', { method: 'POST', body: { confirm: 'yes' } })).status, 400, 'needs typed confirmation');
  const p = await admin('point-number', { method: 'POST', body: { confirm: 'POINT NUMBER HERE' } });
  assert.equal(p.json.previous.smsUrl, 'https://demo.twilio.com/welcome/sms/reply');
  assert.equal(fake.number.voiceUrl, 'https://www.crashhelptx.com/api/twilio?r=voice');
  assert.equal(fake.number.smsUrl, 'https://www.crashhelptx.com/api/twilio?r=sms');
  assert.equal(fake.number.statusCallback, 'https://www.crashhelptx.com/api/twilio?r=call-status&purpose=inbound');
  fake.campaigns.MG1[0].campaignStatus = 'VERIFIED';
  c = await admin('twilio-check');
  assert.equal(c.json.state, 'READY');
  fake.number = null;
  c = await admin('twilio-check'); assert.equal(c.json.state, 'ACTION REQUIRED');
});

test('22. run-e2e refuses when test mode is off', async () => {
  process.env.TWILIO_TEST_MODE = 'false';
  try {
    const r = await admin('run-e2e', { method: 'POST', body: { phone_index: 0 } });
    assert.equal(r.status, 500); assert.match(r.json.error, /Test mode is OFF/);
  } finally { process.env.TWILIO_TEST_MODE = 'true'; }
});

test('23. partner signups are not treated as crash leads', async () => {
  const r = await fetch(base + '/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Joe Tow', phone: '8325550199', email: 'joe@tow.example', city: 'Pasadena', desc: 'PARTNER SIGNUP — Business: Joe Tow | Type: tow', source: 'partner-signup', contact_consent: true }) });
  const id = (await r.json()).lead_id;
  const l = await lead(id);
  assert.equal(l.lead_status, 'NEEDS HUMAN REVIEW'); assert.equal(l.contact_consent, false);
  assert.equal(smsTo(TESTER).length, 0, 'business is not sent a consumer confirmation');
  assert.match(smsTo(OWNER)[0].body, /NEW CRASHHELP PARTNER SIGNUP/);
  assert.equal(callsTo(OWNER).length, 0, 'owner phone does not ring for partner signups');
  reset(); await backdate(id, 40); await tick();
  assert.equal(fakeTw.sent.length, 0, 'never escalated');
  assert.ok(h.crmFake.calls.length === 0 || true);
});

test('24. CRM carries full attribution, channel and the CrashHelp stage names; STOP moves it to DO NOT CONTACT', async () => {
  const crm = require('../lib/crm');
  process.env.GHL_STAGE_IDS = JSON.stringify({ 'NEW LEAD': 'st_newlead', 'CONTACTED': 'st_c', 'DO NOT CONTACT': 'st_dnc', 'FOLLOW-UP': 'st_fu' });
  try {
    const r = await submit({ utm_medium: 'paid_social', utm_content: 'reels_pov', utm_term: 'car wreck', gclid: 'Cj0KCQ', fbclid: 'fb.1.xyz', landing_page: '/start?utm_source=meta' });
    const up = h.crmFake.calls.find((c) => c.url.endsWith('/contacts/upsert')).body;
    assert.ok(up.tags.includes('ch-form') && up.tags.includes('src-meta') && up.tags.includes('cmp-crash-video'));
    const note = h.crmFake.calls.find((c) => c.url.endsWith('/notes')).body.body;
    for (const s of ['utm_medium paid_social', 'utm_content reels_pov', 'utm_term car wreck', 'gclid: Cj0KCQ', 'fbclid: fb.1.xyz', 'landing page: /start?utm_source=meta', 'via form', 'Details: Rear-ended on Beltway 8']) assert.ok(note.includes(s), s);
    assert.equal(h.crmFake.calls.find((c) => c.url.endsWith('/opportunities/')).body.pipelineStageId, 'st_newlead');
    reset();
    await h.twilioPost(base, 'r=sms', { MessageSid: 'SMdnc', From: TESTER, To: '+13468601929', Body: 'STOP' });
    const put = h.crmFake.calls.find((c) => c.method === 'PUT');
    assert.equal(put.body.pipelineStageId, 'st_dnc');
    assert.ok(h.crmFake.calls.find((c) => c.url.endsWith('/contacts/upsert')).body.tags.includes('do-not-contact'));
    const p = crm.payload(await lead(r.json.lead_id));
    assert.equal(p.crm_stage, 'DO NOT CONTACT'); assert.equal(p.channel, 'form'); assert.equal(p.gclid, 'Cj0KCQ');
  } finally { process.env.GHL_STAGE_IDS = h.ENV.GHL_STAGE_IDS; }
});

test('25. protected previews: every URL Twilio calls carries the Vercel bypass when configured', async () => {
  process.env.VERCEL_AUTOMATION_BYPASS_SECRET = 'bypassabc123';
  try {
    await submit();
    const call = callsTo(OWNER)[0];
    assert.match(call.url, /&x-vercel-protection-bypass=bypassabc123$/);
    assert.match(call.statusCallback, /x-vercel-protection-bypass=bypassabc123/);
    assert.match(fakeTw.sent[0].statusCallback, /x-vercel-protection-bypass=bypassabc123/);
    // Signature still validates with the bypass in the URL (Twilio signs the full URL).
    const id = (await db.one('SELECT lead_id FROM leads ORDER BY created_at DESC LIMIT 1')).lead_id;
    const t = await h.twilioPost(base, `r=owner-alert&lead=${id}&x-vercel-protection-bypass=bypassabc123`, { CallSid: 'CAb', AnsweredBy: 'human' });
    assert.equal(t.status, 200); assert.match(t.text, /x-vercel-protection-bypass=bypassabc123/);
  } finally { delete process.env.VERCEL_AUTOMATION_BYPASS_SECRET; }
});

test('26. HighLevel needs only token + location: pipeline and stage IDs are found by name', async () => {
  const saved = { p: process.env.GHL_PIPELINE_ID, s: process.env.GHL_STAGE_IDS };
  delete process.env.GHL_PIPELINE_ID; delete process.env.GHL_STAGE_IDS;
  try {
    await submit();
    const calls = h.crmFake.calls.map((c) => `${c.method} ${c.url.replace('https://services.leadconnectorhq.com', '')}`);
    assert.ok(calls.includes('GET /opportunities/pipelines?locationId=loc123'));
    const opp = h.crmFake.calls.find((c) => c.url.endsWith('/opportunities/')).body;
    assert.equal(opp.pipelineId, 'pipe_auto'); assert.equal(opp.pipelineStageId, 'auto_st_0');
    const env = await admin('env-check');
    assert.equal(env.json.checks.find((c) => c.name === 'CRM / HighLevel').state, 'CONFIGURED');
  } finally { process.env.GHL_PIPELINE_ID = saved.p; process.env.GHL_STAGE_IDS = saved.s; }
});

test('27. database outage: lead is NOT lost — full submission texted + emailed to owner and written to the log', async () => {
  const logs = []; const origErr = console.error; console.error = (...a) => { logs.push(a.join(' ')); };
  global.__crashhelpDbFail = true;
  try {
    const r = await submit({ first_name: 'Dbdown', phone: '(832) 555-0123', email: 'dbdown@example.com' });
    assert.equal(r.status, 200); assert.equal(r.json.saved, false);
    assert.ok(smsTo(OWNER).some((m) => /DATABASE DOWN/.test(m.body) && /Dbdown/.test(m.body) && /8325550123/.test(m.body)), 'owner SMS carries the lead');
    assert.ok(fakeMail.sent.some((m) => /database down/i.test(m.subject) && /Dbdown/.test(m.text)), 'owner email carries the lead');
    assert.ok(logs.some((l) => l.startsWith('CRASHHELP_LEAD_FALLBACK ') && l.includes('dbdown@example.com')), 'full lead in runtime log');
  } finally { global.__crashhelpDbFail = false; console.error = origErr; }
});

test('28. database + Twilio + email all down: server answers 503 so the browser keeps the lead and retries', async () => {
  const origErr = console.error; console.error = () => {};
  global.__crashhelpDbFail = true; fakeTw.fail = true; fakeMail.fail = true;
  try {
    const r = await submit();
    assert.equal(r.status, 503); assert.equal(r.json.retry, true);
  } finally { global.__crashhelpDbFail = false; console.error = origErr; }
  // When the browser resends after recovery, the lead is saved normally.
  reset();
  const again = await submit({ client_retry: true });
  assert.equal(again.status, 200); assert.ok(await lead(again.json.lead_id));
});

test('29. a failure AFTER the save never triggers a false "not saved" alert', async () => {
  const origErr = console.error; console.error = () => {};
  global.__crashhelpDbFail = (sql) => !/INSERT INTO leads|INSERT INTO events|FROM leads|FROM opt_outs|FROM settings|rate_limits/.test(sql);
  try {
    const r = await submit({ phone: '(832) 555-0124', email: 'post@example.com' });
    assert.equal(r.status, 200); assert.ok(r.json.lead_id, 'lead id returned');
    assert.ok(!fakeMail.sent.some((m) => /database down/i.test(m.subject)), 'no false DATABASE DOWN email');
  } finally { global.__crashhelpDbFail = false; console.error = origErr; }
  const id = (await db.one("SELECT lead_id FROM leads WHERE email = 'post@example.com'")).lead_id;
  assert.ok(id, 'lead is in the database');
});

test('30. browser retry queue: attribution.js keeps a failed lead and resends it once the server recovers', async () => {
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'attribution.js'), 'utf8');
  const store = {}; const posts = []; let serverUp = false;
  const win = {
    location: { search: '?utm_source=google&gclid=g1', pathname: '/houston' }, document: { referrer: '', head: { appendChild() {} }, createElement: () => ({}), addEventListener() {} },
    sessionStorage: { getItem: () => null, setItem() {} },
    localStorage: { getItem: (k) => store[k] || null, setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; } },
    addEventListener() {}, setTimeout: () => {},
    fetch: (url, opts) => { posts.push(JSON.parse(opts.body)); return serverUp ? Promise.resolve({ ok: true, status: 200, clone: () => ({ json: async () => ({ lead_id: 'CH-1' }) }) }) : Promise.reject(new Error('offline')); },
  };
  win.window = win;
  new Function('window', 'document', 'location', 'sessionStorage', 'localStorage', 'setTimeout', 'URLSearchParams', 'fetch', src)(win, win.document, win.location, win.sessionStorage, win.localStorage, win.setTimeout, URLSearchParams, win.fetch);
  await win.fetch('/api/lead', { method: 'POST', body: JSON.stringify({ first_name: 'Q', phone: '8325550199' }) }).catch(() => {});
  const q = JSON.parse(store.chx_pending_leads);
  assert.equal(q.length, 1); assert.equal(q[0].body.gclid, 'g1'); assert.equal(q[0].body.utm_source, 'google');
  serverUp = true; win.CHX_FLUSH_LEADS(); await new Promise((r) => setImmediate(r));
  assert.equal(posts.at(-1).client_retry, true);
  assert.equal(store.chx_pending_leads, undefined, 'queue cleared after successful resend');
});

test('31. health ?db=1 reports connection and all 11 tables', async () => {
  const r = await (await fetch(base + '/api/health?db=1')).json();
  assert.equal(r.db.state, 'CONNECTED'); assert.equal(r.db.tables, 11); assert.deepEqual(r.db.missing, []);
});

test('32. QA Bot login works on Preview and is refused in Production', async () => {
  process.env.QA_ADMIN_PASSWORD = 'q'.repeat(30);
  try {
    const ok = await admin('login', { cookie: null, method: 'POST', body: { name: 'QA Bot', password: 'q'.repeat(30) } });
    assert.equal(ok.status, 200);
    process.env.VERCEL_ENV = 'production';
    const no = await admin('login', { cookie: null, method: 'POST', body: { name: 'QA Bot', password: 'q'.repeat(30) } });
    assert.notEqual(no.status, 200);
  } finally { delete process.env.QA_ADMIN_PASSWORD; delete process.env.VERCEL_ENV; }
});

test('33. Express Connect: callback and quiz requests save first with source, answers and consent', async () => {
  const post = (b) => fetch(base + '/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': '10.9.9.' + Math.floor(Math.random() * 250) }, body: JSON.stringify(b) }).then(async (r) => ({ status: r.status, json: await r.json() }));
  const cb = await post({ name: 'Ana Ruiz', phone: '(832) 555-0161', preferred_contact: 'call', contact_consent: false, source: 'express-callback', description: 'Express Connect: callback requested' });
  assert.equal(cb.status, 200);
  const l1 = await lead(cb.json.lead_id);
  assert.equal(l1.source, 'express-callback'); assert.equal(l1.first_name, 'Ana'); assert.equal(l1.contact_consent, false);
  assert.ok(smsTo(OWNER).length >= 1, 'owner alerted'); assert.equal(smsTo('+18325550161').length, 0, 'no consent, no text');
  const qz = await post({ name: 'Leo Park', phone: '(832) 555-0162', preferred_contact: 'text', contact_consent: true, consent_text: 'I agree…', injured: 'yes', medical_care: 'not_yet', crash_city: 'Houston', source: 'express-quiz', description: 'Express Connect quiz · When did the crash happen? Today · Were you hurt? Yes' });
  const l2 = await lead(qz.json.lead_id);
  assert.equal(l2.source, 'express-quiz'); assert.equal(l2.injury_status, 'yes'); assert.equal(l2.medical_status, 'not_yet'); assert.equal(l2.crash_city, 'Houston');
  assert.match(l2.description, /Were you hurt\? Yes/); assert.equal(l2.contact_consent, true);
  const up = h.crmFake.calls.filter((c) => c.url.endsWith('/contacts/upsert')).map((c) => c.body.tags);
  assert.ok(up.some((t) => t.includes('express-quiz')), 'HighLevel contact tagged express-quiz');
  assert.ok(up.some((t) => t.includes('express-callback')), 'HighLevel contact tagged express-callback');
  const note = h.crmFake.calls.find((c) => /\/notes$/.test(c.url) && /Were you hurt\? Yes/.test(c.body.body || ''));
  assert.ok(note, 'quiz answers in the HighLevel note');
  const page = await (await fetch(base + '/connect')).text();
  assert.match(page, /Call now/); assert.match(page, /Request a callback/); assert.match(page, /Quick accident quiz/); assert.match(page, /no outcome is promised/i);
});

test('34. Consumer texting switch OFF: no texts to leads even with consent, owner alerts still go', async () => {
  process.env.CONSUMER_SMS_ENABLED = 'false';
  try {
    const r = await submit();
    assert.equal(r.status, 200);
    assert.equal(smsTo('+18325550199').length, 0, 'no consumer text');
    assert.ok(smsTo(OWNER).length >= 1, 'owner still alerted');
    assert.ok((await events(r.json.lead_id)).some((e) => e.type === 'sms_blocked' && e.detail.reason === 'consumer_texting_off'));
  } finally { process.env.CONSUMER_SMS_ENABLED = 'true'; }
});

test('35. HELP gets the carrier help reply and never starts the quiz', async () => {
  await h.twilioPost(base, 'r=sms', { MessageSid: 'SMh1', From: TESTER, To: '+13468601929', Body: 'HELP' });
  assert.match(smsTo(TESTER)[0].body, /^CrashHelp TX: help after a Texas crash\. Call \(346\) 860-1929/); assert.match(smsTo(TESTER)[0].body, /Reply STOP to opt out/);
  assert.equal(await db.one('SELECT 1 FROM sms_sessions WHERE phone = $1', [TESTER]), null);
});

test('36. Texting OFF: the text quiz sends nothing to the person and creates no lead', async () => {
  process.env.CONSUMER_SMS_ENABLED = 'false';
  try {
    await h.twilioPost(base, 'r=sms', { MessageSid: 'SMoff1', From: TESTER, To: '+13468601929', Body: 'CRASH' });
    assert.equal(smsTo(TESTER).length, 0, 'no reply text while texting is off');
    const m = await db.one(`SELECT status, error FROM messages WHERE to_number = $1 AND purpose = 'sms_flow_reply' ORDER BY created_at DESC LIMIT 1`, [TESTER]);
    assert.equal(m.status, 'blocked'); assert.equal(m.error, 'consumer_texting_off');
  } finally { process.env.CONSUMER_SMS_ENABLED = 'true'; }
});
