// POST /api/lead — opt-in lead form. Saves first, then confirms, alerts and syncs.
const leads = require('../lib/leads');
const store = require('../lib/store');
const tw = require('../lib/twilio');
const email = require('../lib/email');
const { sendJson, clientIp, fill } = require('../lib/util');

const ALLOWED_ORIGINS = ['https://www.crashhelptx.com', 'https://crashhelptx.com'];

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  const previewOrigin = origin && process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`;
  if (ALLOWED_ORIGINS.includes(origin) || previewOrigin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });

  const raw = req.body || {};
  if (raw.company_website) return sendJson(res, 200, { ok: true }); // honeypot: bots fill hidden fields

  const ip = clientIp(req);
  if (!(await store.rateLimit(`lead:${ip}`, 8, 600))) {
    return sendJson(res, 429, { error: 'Too many submissions. Please call us instead.' });
  }

  const data = leads.parseForm(raw);
  if (!data.phone && !data.email) return sendJson(res, 400, { error: 'Enter a valid phone number or email so we can reach you.' });
  if (!data.first_name) return sendJson(res, 400, { error: 'Enter your first name.' });

  try {
    const result = await leads.intake(data, { actor: 'web_form' });
    return sendJson(res, 200, { ok: true, lead_id: result.lead_id });
  } catch (err) {
    // Last-resort path: database is down. Never lose the lead — push the raw submission to the owner.
    console.error('LEAD INTAKE FAILED', err);
    const summary = fill('🚨 CRASHHELP LEAD (DATABASE DOWN — NOT SAVED)\n{{first_name}} {{last_name}}\n{{phone}} {{email}}\nCity: {{crash_city}}\nCrash: {{crash_date}}\nPrefers: {{preferred_contact}}\nSource: {{utm_source}}', data);
    const owner = process.env.OWNER_ALERT_PHONE;
    await Promise.allSettled([
      owner ? tw.sendSms({ to: owner, body: summary, kind: 'internal', purpose: 'fallback_alert' }) : null,
      email.send({ to: process.env.OWNER_ALERT_EMAIL || process.env.GMAIL_USER || 'crashhelptx@gmail.com', subject: '🚨 CrashHelp lead — database down, saved here only', text: summary, purpose: 'fallback_alert' }),
    ]);
    return sendJson(res, 200, { ok: true, saved: false });
  }
};
