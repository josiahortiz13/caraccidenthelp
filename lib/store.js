// Timeline events, audit log, settings, system status, rate limits.
const db = require('./db');

async function event(leadId, type, detail = {}, actor = 'system') {
  try {
    await db.query('INSERT INTO events (lead_id, type, actor, detail) VALUES ($1,$2,$3,$4)', [leadId, type, actor, JSON.stringify(detail)]);
  } catch (e) {
    console.error('event log failed', type, e.message);
  }
}

async function audit(actor, action, leadId, detail = {}) {
  try {
    await db.query('INSERT INTO audit (actor, action, lead_id, detail) VALUES ($1,$2,$3,$4)', [actor, action, leadId || null, JSON.stringify(detail)]);
  } catch (e) {
    console.error('audit failed', e.message);
  }
}

const DEFAULT_SETTINGS = () => ({
  sms_alert: true,
  voice_alert: true,
  email_alert: true,
  consumer_confirmation_sms: true,
  consumer_confirmation_email: true,
  voice_alert_for: 'call_requests', // 'call_requests' | 'all_leads'
  backup_call_delay_min: 2,
  escalation: [
    { minutes: 5, notify: ['owner'], voice: false },
    { minutes: 15, notify: ['owner', 'backup'], voice: false },
    { minutes: 30, notify: ['owner', 'backup'], voice: true },
  ],
  primary_phone: process.env.OWNER_ALERT_PHONE || '',
  backup_phone: process.env.BACKUP_ALERT_PHONE || '',
  primary_email: process.env.OWNER_ALERT_EMAIL || process.env.GMAIL_USER || 'crashhelptx@gmail.com',
  backup_email: process.env.BACKUP_ALERT_EMAIL || '',
  agent_phones: {},          // { "Josiah": "+1832..." } for one-tap calling
  response_target_min: 5,
});

async function getSettings() {
  const s = DEFAULT_SETTINGS();
  try {
    const r = await db.query('SELECT key, value FROM settings');
    for (const row of r.rows) s[row.key] = row.value;
  } catch (e) {
    console.error('settings read failed, using defaults', e.message);
  }
  return s;
}

async function saveSettings(patch) {
  const allowed = Object.keys(DEFAULT_SETTINGS());
  for (const [k, v] of Object.entries(patch)) {
    if (!allowed.includes(k)) continue;
    await db.query(
      'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value',
      [k, JSON.stringify(v)]
    );
  }
}

async function setStatus(key, value) {
  try {
    await db.query(
      'INSERT INTO system_status (key, value, at) VALUES ($1,$2,now()) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, at = now()',
      [key, JSON.stringify(value)]
    );
  } catch (e) {
    console.error('status write failed', e.message);
  }
}

async function getStatuses() {
  const r = await db.query('SELECT key, value, at FROM system_status');
  const out = {};
  for (const row of r.rows) out[row.key] = { ...row.value, at: row.at };
  return out;
}

// Fixed-window limiter. Returns true when the request is allowed.
async function rateLimit(key, max, windowSec) {
  try {
    const row = await db.one(
      `INSERT INTO rate_limits (key, window_start, count) VALUES ($1, now(), 1)
       ON CONFLICT (key) DO UPDATE SET
         count = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2::double precision) THEN 1 ELSE rate_limits.count + 1 END,
         window_start = CASE WHEN rate_limits.window_start < now() - make_interval(secs => $2::double precision) THEN now() ELSE rate_limits.window_start END
       RETURNING count`,
      [key, windowSec]
    );
    return row.count <= max;
  } catch (e) {
    console.error('rate limit check failed, allowing', e.message);
    return true;
  }
}

module.exports = { event, audit, getSettings, saveSettings, setStatus, getStatuses, rateLimit, DEFAULT_SETTINGS };
