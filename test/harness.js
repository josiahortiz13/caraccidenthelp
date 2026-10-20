// Local test harness: mimics Vercel's Node runtime (parsed req.body + req.query) for the /api functions,
// with an in-process Postgres (PGlite), a recording fake Twilio, fake email and a fake CRM endpoint.
const http = require('http');
const path = require('path');
const fs = require('fs');
const twilioLib = require('twilio');

const ENV = {
  PGLITE: '1', TWILIO_FAKE: '1', EMAIL_FAKE: '1',
  TWILIO_ACCOUNT_SID: 'AC00000000000000000000000000000000', TWILIO_AUTH_TOKEN: 'test_auth_token_123',
  TWILIO_PHONE_NUMBER: '+13468601929', OWNER_ALERT_PHONE: '+18325550101', BACKUP_ALERT_PHONE: '+18325550102',
  OWNER_ALERT_EMAIL: 'owner@example.com', BACKUP_ALERT_EMAIL: 'backup@example.com',
  TWILIO_TEST_MODE: 'true', ALLOWED_TEST_NUMBERS: '+18325550101,+18325550102,+18325550199',
  PUBLIC_BASE_URL: 'https://www.crashhelptx.com', SESSION_SECRET: 'x'.repeat(40), CRON_SECRET: 'cron_secret_test',
  ADMIN_USERS: JSON.stringify([{ name: 'Josiah', role: 'owner', password: 'owner-pass' }, { name: 'Staff', role: 'staff', password: 'staff-pass' }]),
  CRM_MODE: 'ghl', GHL_API_KEY: 'pit-test', GHL_LOCATION_ID: 'loc123', GHL_PIPELINE_ID: 'pipe1',
  GHL_STAGE_IDS: JSON.stringify({ NEW: 'st_new', CONTACTED: 'st_contacted', QUALIFIED: 'st_q' }),
  INSECURE_COOKIES: '1', CONSUMER_SMS_ENABLED: 'true',
};
Object.assign(process.env, ENV);

// Fake HighLevel API: records calls; can be told to fail.
const crmFake = { calls: [], fail: false, n: 0 };
global.__crashhelpFetch = async (url, opts) => {
  crmFake.calls.push({ url, method: opts.method, body: opts.body ? JSON.parse(opts.body) : null, headers: opts.headers });
  if (crmFake.fail) return { ok: false, status: 503, text: async () => '{"message":"Service unavailable"}' };
  let data = {};
  if (url.includes('/opportunities/pipelines')) data = { pipelines: [{ id: 'pipe_auto', name: 'CrashHelp TX', stages: ['NEW LEAD', 'CONTACT ATTEMPTED', 'CONTACTED', 'QUALIFIED', 'REFERRED / TRANSFERRED', 'FOLLOW-UP', 'CLOSED', 'DO NOT CONTACT'].map((n, i) => ({ id: 'auto_st_' + i, name: n })) }] };
  else if (url.endsWith('/contacts/upsert')) data = { new: true, contact: { id: 'ghl_contact_' + (++crmFake.n) } };
  else if (url.endsWith('/opportunities/')) data = { opportunity: { id: 'ghl_opp_' + (++crmFake.n) } };
  return { ok: true, status: 200, text: async () => JSON.stringify(data) };
};

const root = path.join(__dirname, '..');
const handlers = {};
for (const f of fs.readdirSync(path.join(root, 'api'))) handlers['/api/' + f.replace('.js', '')] = require(path.join(root, 'api', f));

function parseBody(req, raw) {
  const ct = req.headers['content-type'] || '';
  if (!raw) return {};
  if (ct.includes('application/json')) return JSON.parse(raw);
  if (ct.includes('application/x-www-form-urlencoded')) return Object.fromEntries(new URLSearchParams(raw));
  return {};
}

function start(port = 0) {
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', async () => {
      const u = new URL(req.url, 'http://localhost');
      if (u.pathname === '/admin') { res.setHeader('Content-Type', 'text/html'); return res.end(fs.readFileSync(path.join(root, 'admin.html'))); }
      if (u.pathname === '/connect') { res.setHeader('Content-Type', 'text/html'); return res.end(fs.readFileSync(path.join(root, 'connect.html'))); }
      if (u.pathname === '/start') { res.setHeader('Content-Type', 'text/html'); return res.end(fs.readFileSync(path.join(root, 'start.html'))); }
      const h = handlers[u.pathname];
      if (!h) {
        // Static files (homepage, city pages, attribution.js) the way Vercel serves them.
        const f = path.join(root, u.pathname === '/' ? 'index.html' : u.pathname.replace(/^\//, ''));
        if (f.startsWith(root) && fs.existsSync(f) && fs.statSync(f).isFile()) {
          res.setHeader('Content-Type', f.endsWith('.js') ? 'text/javascript' : f.endsWith('.html') ? 'text/html' : 'application/octet-stream');
          return res.end(fs.readFileSync(f));
        }
        res.statusCode = 404; return res.end('not found');
      }
      req.query = Object.fromEntries(u.searchParams);
      try { req.body = parseBody(req, raw); } catch { res.statusCode = 400; return res.end('bad body'); }
      try { await h(req, res); } catch (e) { console.error(e); res.statusCode = 500; res.end(e.message); }
    });
  });
  return new Promise((r) => server.listen(port, () => r(server)));
}

// Sends a correctly signed Twilio webhook (signature computed against PUBLIC_BASE_URL like Twilio would).
async function twilioPost(base, query, params, { badSignature = false } = {}) {
  const pathq = `/api/twilio?${query}`;
  const sig = twilioLib.getExpectedTwilioSignature(ENV.TWILIO_AUTH_TOKEN, ENV.PUBLIC_BASE_URL + pathq, params);
  const res = await fetch(base + pathq, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': badSignature ? 'nope' : sig },
    body: new URLSearchParams(params).toString(),
  });
  return { status: res.status, text: await res.text() };
}

module.exports = { start, twilioPost, crmFake, ENV };

if (require.main === module) {
  start(Number(process.env.PORT || 3999)).then((s) => console.log('CrashHelp test server on http://localhost:' + s.address().port));
}
