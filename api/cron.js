// GET/POST /api/cron — escalation, backup calls, CRM retries.
// Call it every minute with: Authorization: Bearer <CRON_SECRET>  (or ?key=<CRON_SECRET> for pingers that can't set headers)
const escalation = require('../lib/escalation');
const { sendJson } = require('../lib/util');

module.exports = async (req, res) => {
  const secret = process.env.CRON_SECRET;
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const ok = secret && (req.headers.authorization === `Bearer ${secret}` || q.key === secret);
  if (!ok) return sendJson(res, 401, { error: 'Unauthorized' });
  const result = await escalation.tick();
  return sendJson(res, 200, { ok: true, ...result });
};
