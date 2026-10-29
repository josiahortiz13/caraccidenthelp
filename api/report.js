// /api/report — accident report uploads ("Your Crash Report, Explained").
// Visitor actions use the private link token from `start`. While ACCIDENT_INTEL_PUBLIC is not "true",
// visitor actions only work for a signed-in staff member (so the team can test it on the live site).
// Staff actions (admin-*) need the dashboard login, and POSTs need the X-CrashHelp header like /api/admin.
const reports = require('../lib/reports');
const store = require('../lib/store');
const auth = require('../lib/auth');
const files = require('../lib/files');
const { sendJson, clientIp } = require('../lib/util');
const log = require('../lib/log');

const VISITOR_POST = ['start', 'upload-url', 'uploaded', 'analyze', 'review', 'delete'];

module.exports = async (req, res) => {
  const a = String((req.query && req.query.a) || '');
  const body = req.body || {};
  let user = null;
  try { user = auth.fromRequest(req); } catch { user = null; }

  try {
    // Tests only: stands in for the browser's PUT to Blob storage.
    if (a === 'fake-put' && process.env.BLOB_FAKE === '1' && req.method === 'PUT') {
      files.fakePut(String(req.query.p || ''), Buffer.from(String(body.b64 || ''), 'base64'), req.headers['content-type'] === 'application/json' ? body.type : req.headers['content-type']);
      return sendJson(res, 200, { ok: true });
    }

    if (a.startsWith('admin-')) return staff(a, req, res, user, body);

    if (!reports.enabledPublicly() && !user) return sendJson(res, 404, { disabled: true, error: 'Not available yet.' });
    if (VISITOR_POST.includes(a) && req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    const ip = clientIp(req);

    if (a === 'start') {
      if (!(await store.rateLimit(`report-start:${ip}`, 6, 3600))) return sendJson(res, 429, { error: 'Too many uploads from this connection. Please call us instead.' });
      return sendJson(res, 200, await reports.startCase({ lang: body.lang, consent: body.consent === true, ip }));
    }

    const c = await reports.forVisitor(body.case_id || req.query.case_id, body.token || req.headers['x-report-token']);
    if (a === 'upload-url') return sendJson(res, 200, await reports.requestUpload(c, body));
    if (a === 'uploaded') return sendJson(res, 200, await reports.confirmUpload(c, body.file_id));
    if (a === 'analyze') {
      if (!(await store.rateLimit(`report-analyze:${ip}`, 4, 3600))) return sendJson(res, 429, { error: 'Too many requests. Please call us and we will help.' });
      return sendJson(res, 200, await reports.runAnalysis(c, { description: body.description }));
    }
    if (a === 'result') return sendJson(res, 200, await reports.visitorResult(c));
    if (a === 'review') {
      if (!(await store.rateLimit(`report-review:${ip}`, 5, 3600))) return sendJson(res, 429, { error: 'Too many requests. Please call us instead.' });
      return sendJson(res, 200, await reports.requestReview(c, body));
    }
    if (a === 'delete') return sendJson(res, 200, { ok: true, ...(await reports.purge(c.case_id, 'visitor')) });
    return sendJson(res, 400, { error: 'Unknown action' });
  } catch (e) {
    if (e.status) return sendJson(res, e.status, { error: e.message });
    log.error('report api failed', e, { kind: a });
    return sendJson(res, 500, { error: 'Something went wrong. Please call us and we will help.' });
  }
};

async function staff(a, req, res, user, body) {
  if (!user) return sendJson(res, 401, { error: 'Sign in required' });
  if (req.method === 'POST' && req.headers['x-crashhelp'] !== '1') return sendJson(res, 403, { error: 'Bad request' });
  if (a === 'admin-list') return sendJson(res, 200, { cases: await reports.listCases(), public: reports.enabledPublicly(), storage: files.configured(), ai: !!process.env.ANTHROPIC_API_KEY || process.env.REPORT_AI_FAKE === '1' });
  if (a === 'admin-case') return sendJson(res, 200, await reports.staffCase(req.query.case_id, user));
  if (a === 'admin-file') return sendJson(res, 200, await reports.staffFileUrl(req.query.case_id, req.query.file_id, user));
  if (a === 'admin-delete') {
    if (req.method !== 'POST') return sendJson(res, 405, {});
    if (user.role !== 'owner') return sendJson(res, 403, { error: 'Owner only' });
    return sendJson(res, 200, { ok: true, ...(await reports.purge(String(body.case_id || ''), user.name)) });
  }
  return sendJson(res, 400, { error: 'Unknown action' });
}
