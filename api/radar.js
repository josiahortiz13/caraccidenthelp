// /api/radar — private Crash Radar dashboard data (staff login required).
// GET  ?a=list&severity=MAJOR|MINOR|UNKNOWN&status=ACTIVE|CLEARED|UNKNOWN&hours=24
// GET  ?a=history&incident=1861569
// POST ?a=poll-now            (owner; respects the feed: still at most one fetch per call)
// POST ?a=alert-settings      (owner; who gets radar alerts is always the owner's own phone/email)
const radar = require('../lib/radar');
const store = require('../lib/store');
const auth = require('../lib/auth');
const { sendJson, normalizeEmail } = require('../lib/util');
const log = require('../lib/log');

module.exports = async (req, res) => {
  let user = null;
  try { user = auth.fromRequest(req); } catch { user = null; }
  if (!user) return sendJson(res, 401, { error: 'Sign in required' });
  const a = String((req.query && req.query.a) || '');
  if (req.method === 'POST' && req.headers['x-crashhelp'] !== '1') return sendJson(res, 403, { error: 'Bad request' });
  try {
    if (a === 'list') {
      const s = await store.getSettings();
      const out = await radar.list(req.query);
      return sendJson(res, 200, { ...out, alerts: { sms: !!s.radar_alert_sms, email: !!s.radar_alert_email, severity: s.radar_alert_severity, max_per_hour: s.radar_alert_max_per_hour, to_phone: !!s.primary_phone, to_email: !!s.primary_email,
        extra_emails: user.role === 'owner' ? (s.radar_alert_emails || []) : undefined } });
    }
    if (a === 'history') return sendJson(res, 200, { events: await radar.incidentHistory(req.query.incident) });
    if (req.method !== 'POST') return sendJson(res, 405, {});
    if (user.role !== 'owner') return sendJson(res, 403, { error: 'Owner only' });
    if (a === 'poll-now') {
      if (!radar.enabled()) return sendJson(res, 400, { error: 'Crash Radar is off (RADAR_ENABLED is not true).' });
      return sendJson(res, 200, await radar.poll({ force: true }));
    }
    if (a === 'alert-settings') {
      const p = req.body || {};
      const patch = {};
      if ('sms' in p) patch.radar_alert_sms = !!p.sms;
      if ('email' in p) patch.radar_alert_email = !!p.email;
      if (['major', 'minor', 'all'].includes(p.severity)) patch.radar_alert_severity = p.severity;
      if ('max_per_hour' in p) patch.radar_alert_max_per_hour = Math.max(1, Math.min(30, Number(p.max_per_hour) || 6));
      if ('extra_emails' in p) {
        const raw = Array.isArray(p.extra_emails) ? p.extra_emails : String(p.extra_emails || '').split(/[,;\s]+/);
        const given = raw.map((x) => String(x).trim()).filter(Boolean);
        if (given.some((x) => !normalizeEmail(x))) return sendJson(res, 400, { error: 'One of those email addresses is not valid.' });
        const list = [...new Set(given.map(normalizeEmail))];
        if (list.length > 5) return sendJson(res, 400, { error: 'Up to 5 extra addresses.' });
        patch.radar_alert_emails = list;
      }
      await store.saveSettings(patch);
      await store.audit(user.name, 'radar_alert_settings', null, { ...patch, radar_alert_emails: patch.radar_alert_emails ? `${patch.radar_alert_emails.length} address(es)` : undefined });
      return sendJson(res, 200, { ok: true });
    }
    return sendJson(res, 400, { error: 'Unknown action' });
  } catch (e) {
    log.error('radar api failed', e, { kind: a });
    return sendJson(res, 500, { error: 'Radar request failed' });
  }
};
