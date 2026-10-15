// GET /api/health — liveness. ?db=1 also checks the database: connection, schema, and that all tables exist.
// Reports only status and table names, never data or connection details.
const EXPECTED = ['leads', 'events', 'messages', 'calls', 'opt_outs', 'sms_sessions', 'settings', 'crm_queue', 'audit', 'rate_limits', 'system_status'];

module.exports = async (req, res) => {
  const out = { ok: true, ts: Date.now(), v: 3 };
  if (req.query && req.query.db) {
    if (!process.env.DATABASE_URL && process.env.PGLITE !== '1') {
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
  res.setHeader('Cache-Control', 'no-store');
  res.statusCode = out.ok ? 200 : 503;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(out));
};
