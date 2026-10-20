// GET /api/health — liveness. ?db=1 also checks the database: connection, schema, and that all tables exist.
// Reports only status and table names, never data or connection details.
const EXPECTED = ['leads', 'events', 'messages', 'calls', 'opt_outs', 'sms_sessions', 'settings', 'crm_queue', 'audit', 'rate_limits', 'system_status', 'ledger'];

module.exports = async (req, res) => {
  const out = { ok: true, ts: Date.now(), v: 3 };
  if (req.query && req.query.db) {
    if (!require('../lib/db').configured()) {
      out.db = { state: 'NOT CONFIGURED' };
    } else {
      try {
        const db = require('../lib/db');
        const t0 = Date.now();
        await db.migrate();
        const r = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'");
        const have = r.rows.map((x) => x.table_name);
        const missing = EXPECTED.filter((t) => !have.includes(t));
        out.db = { state: missing.length ? 'SCHEMA INCOMPLETE' : 'CONNECTED', tables: EXPECTED.length - missing.length, expected: EXPECTED.length, missing, ms: Date.now() - t0 };
      } catch (e) {
        out.ok = false;
        out.db = { state: 'ERROR', error: String(e.message || e).replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 160) };
      }
    }
  }
  // Ops check for one lead: did it save once, is it in the dashboard, which notifications went out.
  // Needs the CRON_SECRET bearer token. Returns IDs, flags, counts and timestamps only — no names, numbers or form data.
  if (req.query && req.query.lead) {
    const auth = String(req.headers.authorization || '');
    const want = process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : null;
    const crypto = require('crypto');
    const ok = want && auth.length === want.length && crypto.timingSafeEqual(Buffer.from(auth), Buffer.from(want));
    if (!ok) { res.statusCode = 401; res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({ error: 'unauthorized' })); }
    const db = require('../lib/db');
    const id = String(req.query.lead).slice(0, 40);
    const lead = await db.one('SELECT lead_id, created_at, is_test, source, lead_status, lead_priority, duplicate_of, callback_requested, phone FROM leads WHERE lead_id = $1', [id]);
    if (!lead) { out.lead = { found: false }; }
    else {
      const samePhone = lead.phone ? (await db.one('SELECT count(*)::int AS n FROM leads WHERE phone = $1', [lead.phone])).n : null;
      const ev = (await db.query('SELECT at, type, detail FROM events WHERE lead_id = $1 ORDER BY at, id', [id])).rows;
      const visible = await db.one(`SELECT 1 AS y FROM leads WHERE lead_id = $1 AND duplicate_of IS NULL AND is_test = $2`, [id, lead.is_test]);
      out.lead = {
        found: true, lead_id: lead.lead_id, created_at: lead.created_at, is_test: lead.is_test, source: lead.source, status: lead.lead_status, priority: lead.lead_priority,
        rows_with_same_phone: samePhone, dashboard_view: visible ? (lead.is_test ? 'Leads → TEST filter' : 'Leads (all)') : 'not visible',
        emails: ev.filter((e) => /^email_/.test(e.type)).map((e) => ({ at: e.at, type: e.type, purpose: e.detail.purpose, accepted: e.detail.accepted, rejected: e.detail.rejected, smtp: e.detail.smtp, error: e.detail.error ? String(e.detail.error).slice(0, 80) : undefined })),
        other_events: ev.filter((e) => !/^email_/.test(e.type)).map((e) => e.type),
      };
    }
  }
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = out.ok ? 200 : 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(out));
};
