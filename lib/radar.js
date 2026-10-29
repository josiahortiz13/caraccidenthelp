// Live Crash Radar: polls the public Houston TranStar incident feed (TxDOT) every 3 minutes and keeps a
// private, staff-only list of freeway crashes. Ported from crash_radar.py, with fixes:
// - One incident = one row. TranStar's guid is "<id>_<Status>" (Detected → Verified → Cleared), so hashing
//   the whole guid (as the script did) would alert up to three times for the same crash.
// - Status is never guessed: ACTIVE / CLEARED come from the feed; an incident that drops off the feed
//   without a "Cleared" entry, or any incident while the feed is down, shows as UNKNOWN.
// - No locations are invented: the feed has road + cross street text only, no coordinates, so no map pins.
// - Alerts go only to the owner's own phone/email from Settings. Nobody else is ever contacted.
// Off unless RADAR_ENABLED=true. TxDOT's site terms require written permission to copy or redistribute
// its information; get that before turning this on (see accident-intel/RADAR.md).
const db = require('./db');
const store = require('./store');
const tw = require('./twilio');
const email = require('./email');
const log = require('./log');

const FEED_URL = process.env.RADAR_FEED_URL || 'https://traffic.houstontranstar.org/data/rss/incidents_rss.xml';
const SOURCE = 'houston_transtar';
const POLL_SECONDS = 180;
const STALE_MINUTES = 10;           // no successful poll for this long → ACTIVE shows as UNKNOWN
const OUTAGE_FAILURES = 5;          // ≈15 minutes of failed polls → one outage alert
const MAX_BYTES = 3_000_000;
const CRASH_WORDS = /\b(accident|collision|crash|wreck)\b/i;

function enabled() {
  return String(process.env.RADAR_ENABLED || '').toLowerCase() === 'true';
}

// ---------- Parsing ----------
const decode = (s) => String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&').trim();
const tag = (xml, name) => { const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(xml); return m ? decode(m[1]) : ''; };

// "SH-288 Northbound At Holly Hall St - Accident" / "Status: Verified at 1:58 PM - Lanes Affected: 1 Mainlane(s), 1 Shoulder Lane(s)"
function parseItem(xml) {
  const title = tag(xml, 'title');
  const description = tag(xml, 'description');
  const guid = tag(xml, 'guid');
  const pubDate = tag(xml, 'pubDate');
  const idm = /^(\d+)_([A-Za-z]+)$/.exec(guid);
  const incidentId = idm ? idm[1] : null;
  const dash = title.lastIndexOf(' - ');
  const where = dash > 0 ? title.slice(0, dash) : title;
  const types = dash > 0 ? title.slice(dash + 3).split(',').map((s) => s.trim()).filter(Boolean) : [];
  const at = /^(.*?)\s+At\s+(.*)$/i.exec(where);
  const road = at ? at[1] : where;
  const dir = /\b(Northbound|Southbound|Eastbound|Westbound|Inbound|Outbound)\b/i.exec(road);
  const sm = /Status:\s*([A-Za-z]+)(?:\s+at\s+(\d{1,2}:\d{2}\s*[AP]M))?/i.exec(description);
  const lanesText = (/Lanes Affected:\s*(.*)$/i.exec(description) || [])[1] || '';
  const mainlanes = [...lanesText.matchAll(/(\d+)\s+Mainlane/gi)].reduce((n, m) => n + Number(m[1]), 0);
  const allLanes = /all\s+(main)?lanes/i.test(lanesText);
  const typeText = types.join(', ');
  const isCrash = CRASH_WORDS.test(typeText) || CRASH_WORDS.test(title);
  const isTruck = /heavy truck|18[- ]?wheeler|tractor/i.test(typeText);
  const feedStatus = sm ? sm[1].toLowerCase() : (idm ? idm[2].toLowerCase() : '');
  // Severity is CrashHelp's own rule from the feed's lane data, not an official TxDOT rating.
  let severity = 'UNKNOWN';
  if (allLanes || mainlanes >= 2 || (isTruck && isCrash) || /\bmajor\b/i.test(typeText)) severity = 'MAJOR';
  else if (lanesText) severity = 'MINOR';
  return {
    incident_id: incidentId, guid, title, description, road: road.trim(), direction: dir ? dir[1] : '', cross_street: at ? at[2].trim() : '',
    types, is_crash: isCrash, is_truck: isTruck, severity, lanes_text: lanesText, mainlanes,
    feed_status: feedStatus, status: feedStatus === 'cleared' ? 'CLEARED' : ['detected', 'verified', 'active'].includes(feedStatus) ? 'ACTIVE' : 'UNKNOWN',
    status_clock: sm && sm[2] ? sm[2].toUpperCase() : '', feed_pub_date: pubDate,
  };
}

function parseFeed(xml) {
  if (!/<rss\b|<channel\b/i.test(xml)) throw new Error('not an RSS feed');
  const items = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => parseItem(m[1]));
  return { pubDate: tag(xml.split(/<item\b/i)[0], 'pubDate'), items };
}

// Feed times are Houston local clock times ("1:58 PM") on the feed's publish date (CST/CDT handled).
function chicagoOffsetHours(d) {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', timeZoneName: 'shortOffset' }).formatToParts(d).find((p) => p.type === 'timeZoneName').value;
  return Number(name.replace('GMT', '') || 0); // "GMT-5" -> -5
}
function sourceTime(clock, pubDate) {
  const m = /^(\d{1,2}):(\d{2})\s*([AP])M$/.exec(clock || '');
  const pub = pubDate ? new Date(pubDate) : new Date();
  if (!m || isNaN(pub)) return null;
  const [y, mo, d] = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(pub).split('-').map(Number);
  const h = (Number(m[1]) % 12) + (m[3] === 'P' ? 12 : 0);
  let t = Date.UTC(y, mo - 1, d, h, Number(m[2])) - chicagoOffsetHours(pub) * 3600e3;
  if (t > pub.getTime() + 3600e3) t -= 864e5; // "11:50 PM" read just after midnight belongs to the day before
  return new Date(t);
}

async function fetchFeed() {
  if (typeof global.__crashhelpRadarFetch === 'function') return global.__crashhelpRadarFetch(FEED_URL);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(FEED_URL, { headers: { 'User-Agent': 'CrashHelpTX-PublicIncidentMonitor/1.0' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`feed HTTP ${r.status}`);
    const text = await r.text();
    if (text.length > MAX_BYTES) throw new Error('feed too large');
    return text;
  } finally { clearTimeout(timer); }
}

// ---------- Polling ----------
async function radarState() {
  const r = await db.one("SELECT value FROM system_status WHERE key = 'radar'");
  return r ? r.value : {};
}
async function saveState(s) { await store.setStatus('radar', s); }

// Called from the cron tick every minute; does real work at most every 3 minutes.
async function poll({ force = false } = {}) {
  if (!enabled() && !force) return { skipped: 'disabled' };
  const st = await radarState();
  const since = st.last_attempt ? (Date.now() - new Date(st.last_attempt).getTime()) / 1000 : Infinity;
  if (!force && since < POLL_SECONDS - 10) return { skipped: 'throttled', next_in_s: Math.round(POLL_SECONDS - since) };
  st.last_attempt = new Date().toISOString();

  let feed;
  try {
    feed = parseFeed(await fetchFeed());
  } catch (e) {
    st.consecutive_failures = (st.consecutive_failures || 0) + 1;
    st.last_error = String(e.message || e).slice(0, 200);
    st.last_error_at = new Date().toISOString();
    st.state = 'FEED DOWN';
    if (st.consecutive_failures >= OUTAGE_FAILURES && !st.outage_alerted) {
      await alertOwner(`⚠️ CrashHelp Crash Radar: the TranStar feed has failed ${st.consecutive_failures} times in a row (${st.last_error}). Incident statuses show as UNKNOWN until it recovers.`, 'radar_outage', { force: true });
      st.outage_alerted = true;
    }
    await saveState(st);
    log.error('radar feed failed', e);
    return { ok: false, error: st.last_error, failures: st.consecutive_failures };
  }

  const recovered = st.outage_alerted;
  // First successful poll ever: record what is already on the feed without alerting (as crash_radar.py did).
  const baseline = !st.last_ok;
  st.consecutive_failures = 0; st.outage_alerted = false; st.state = 'WORKING';
  st.last_ok = new Date().toISOString(); st.last_feed_pub = feed.pubDate || null;
  st.last_count = feed.items.length;

  const crashes = feed.items.filter((i) => i.is_crash && i.incident_id);
  const fresh = [];
  for (const it of crashes) {
    const when = sourceTime(it.status_clock, it.feed_pub_date || feed.pubDate);
    const prev = await db.one('SELECT incident_id, status, feed_status, severity FROM radar_incidents WHERE source = $1 AND incident_id = $2', [SOURCE, it.incident_id]);
    if (!prev) {
      await db.query(
        `INSERT INTO radar_incidents (source, incident_id, title, road, direction, cross_street, types, is_truck, severity, lanes_text,
           status, feed_status, status_text, source_status_at, first_seen, last_seen, cleared_at, baseline)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),now(),$15,$16)`,
        [SOURCE, it.incident_id, it.title, it.road, it.direction, it.cross_street, it.types.join(', '), it.is_truck, it.severity, it.lanes_text,
          it.status, it.feed_status, it.description, when, it.status === 'CLEARED' ? when || new Date() : null, baseline]
      );
      await history(it, when);
      if (!baseline && it.status === 'ACTIVE') fresh.push(it);
    } else if (prev.feed_status !== it.feed_status || (it.severity !== 'UNKNOWN' && prev.severity !== it.severity) || prev.status !== it.status) {
      await db.query(
        `UPDATE radar_incidents SET status = $3, feed_status = $4, status_text = $5, source_status_at = coalesce($6, source_status_at),
           -- "Cleared" entries carry no lane data: keep the last known severity and lanes.
           severity = CASE WHEN $7 = 'UNKNOWN' THEN severity ELSE $7 END, lanes_text = coalesce(nullif($8, ''), lanes_text), types = $9, is_truck = $10, last_seen = now(), gone_at = NULL,
           cleared_at = CASE WHEN $3 = 'CLEARED' THEN coalesce($6, now()) ELSE cleared_at END
         WHERE source = $1 AND incident_id = $2`,
        [SOURCE, it.incident_id, it.status, it.feed_status, it.description, when, it.severity, it.lanes_text, it.types.join(', '), it.is_truck]
      );
      await history(it, when);
    } else {
      await db.query('UPDATE radar_incidents SET last_seen = now(), gone_at = NULL WHERE source = $1 AND incident_id = $2', [SOURCE, it.incident_id]);
    }
  }
  // Dropped off the feed without a Cleared entry: we do not know that it cleared.
  const ids = crashes.map((i) => i.incident_id);
  const gone = await db.query(
    `UPDATE radar_incidents SET status = 'UNKNOWN', gone_at = now() WHERE source = $1 AND status = 'ACTIVE' AND NOT (incident_id = ANY($2)) RETURNING incident_id`,
    [SOURCE, ids]
  );
  for (const g of gone.rows) await db.query("INSERT INTO radar_events (source, incident_id, status, text) VALUES ($1,$2,'UNKNOWN','No longer listed in the feed; not confirmed cleared')", [SOURCE, g.incident_id]);

  const alerts = await alertNew(fresh);
  if (recovered) await alertOwner('✅ CrashHelp Crash Radar: the TranStar feed is back.', 'radar_recovered', { force: true });
  await saveState(st);
  return { ok: true, items: feed.items.length, crashes: crashes.length, new: fresh.length, alerted: alerts, baseline, no_longer_listed: gone.rows.length };
}

async function history(it, when) {
  await db.query('INSERT INTO radar_events (source, incident_id, status, text, source_status_at) VALUES ($1,$2,$3,$4,$5)', [SOURCE, it.incident_id, it.status, it.description, when]);
}

// ---------- Alerts (owner only) ----------
const SEVERITY_RANK = { UNKNOWN: 0, MINOR: 1, MAJOR: 2 };

async function alertNew(items) {
  if (!items.length) return 0;
  const s = await store.getSettings();
  if (!s.radar_alert_sms && !s.radar_alert_email) return 0;
  const min = { all: -1, minor: SEVERITY_RANK.MINOR, major: SEVERITY_RANK.MAJOR }[s.radar_alert_severity] ?? SEVERITY_RANK.MAJOR;
  const want = items.filter((i) => SEVERITY_RANK[i.severity] >= min);
  let sent = 0;
  for (const it of want) {
    const recent = await db.one("SELECT count(*)::int AS n FROM radar_incidents WHERE alerted_at > now() - interval '1 hour'");
    if (recent.n >= (Number(s.radar_alert_max_per_hour) || 6)) break; // hourly cap; the dashboard still lists them
    const body = `🚨 Crash Radar (${it.severity}${it.is_truck ? ', heavy truck' : ''})\n${it.title}\n${it.description}\nSource: Houston TranStar (public feed). For awareness only — never contact people involved.`;
    if (await alertOwner(body, 'radar_alert', { settings: s })) {
      await db.query('UPDATE radar_incidents SET alerted_at = now() WHERE source = $1 AND incident_id = $2', [SOURCE, it.incident_id]);
      sent++;
    }
  }
  return sent;
}

async function alertOwner(body, purpose, { settings, force = false } = {}) {
  const s = settings || (await store.getSettings());
  const jobs = [];
  if ((force || s.radar_alert_sms) && s.primary_phone) jobs.push(tw.sendSms({ to: s.primary_phone, body, kind: 'internal', purpose }));
  if ((force || s.radar_alert_email) && s.primary_email) jobs.push(email.send({ to: s.primary_email, subject: body.split('\n')[0].slice(0, 120), text: body, purpose }));
  const res = await Promise.allSettled(jobs);
  return res.some((r) => r.status === 'fulfilled' && r.value && r.value.ok);
}

// ---------- Dashboard ----------
async function list({ severity = '', status = '', hours = 24 } = {}) {
  const st = await radarState();
  const stale = !st.last_ok || (Date.now() - new Date(st.last_ok).getTime()) / 60000 > STALE_MINUTES;
  const params = [Math.min(Math.max(Number(hours) || 24, 1), 24 * 30)];
  let where = "first_seen > now() - make_interval(hours => $1::int) AND NOT baseline";
  if (['MAJOR', 'MINOR', 'UNKNOWN'].includes(severity)) { params.push(severity); where += ` AND severity = $${params.length}`; }
  const r = await db.query(`SELECT * FROM radar_incidents WHERE ${where} ORDER BY first_seen DESC LIMIT 300`, params);
  let rows = r.rows.map((x) => ({
    ...x,
    // While the feed is stale, "active" cannot be confirmed.
    shown_status: x.status === 'ACTIVE' && stale ? 'UNKNOWN' : x.status,
    status_note: x.status === 'ACTIVE' && stale ? 'Feed not reachable; last known active'
      : x.status === 'UNKNOWN' && x.gone_at ? 'No longer listed in the feed; not confirmed cleared' : '',
  }));
  if (['ACTIVE', 'CLEARED', 'UNKNOWN'].includes(status)) rows = rows.filter((x) => x.shown_status === status);
  return { incidents: rows, feed: { ...st, stale, source: 'Houston TranStar (TxDOT) public incident feed', url: FEED_URL, coordinates: false }, enabled: enabled() };
}

async function incidentHistory(incidentId) {
  return (await db.query('SELECT at, status, text, source_status_at FROM radar_events WHERE source = $1 AND incident_id = $2 ORDER BY id', [SOURCE, String(incidentId)])).rows;
}

module.exports = { enabled, parseFeed, parseItem, sourceTime, poll, list, incidentHistory, FEED_URL, POLL_SECONDS };
