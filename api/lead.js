// POST /api/lead — opt-in lead form. Saves first, then confirms, alerts and syncs.
const leads = require('../lib/leads');
const store = require('../lib/store');
const tw = require('../lib/twilio');
const email = require('../lib/email');
const { sendJson, clientIp, fill } = require('../lib/util');
const log = require('../lib/log');

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
    // Last-resort path: the database is down, so the lead could not be saved.
    // 1) Write the full submission to the runtime log (recoverable from Vercel logs).
    // 2) Push it to the owner by SMS and email.
    // 3) If neither reached the owner, answer 503 so the browser keeps it and retries.
    // Logs carry a reference ID only. The lead itself goes to the owner by email (and text when available).
    const ref = 'FB-' + require('crypto').randomBytes(4).toString('hex').toUpperCase();
    log.error('lead intake failed, using email backup', err, { ref });
    const noDb = !require('../lib/db').configured(); // not configured yet, vs. configured but failing
    const summary = fill((noDb ? '🚨 NEW CRASHHELP LEAD (email only, dashboard not connected yet)' : '🚨 CRASHHELP LEAD (DATABASE DOWN — NOT SAVED)') + '\nRef: ' + ref + '\n{{first_name}} {{last_name}}\n{{phone}} {{email}}\nCity: {{crash_city}}\nCrash: {{crash_date}}\nPrefers: {{preferred_contact}}\nCallback: {{callback_window}}\nInjured: {{injury_status}} · Doctor: {{medical_status}}\nNotes: {{description}}\nSource: {{utm_source}} / {{utm_campaign}}\nPage: {{landing_page}}', data);
    const owner = process.env.OWNER_ALERT_PHONE || process.env.OWNER_PHONE;
    const [sms, mail] = await Promise.allSettled([
      owner ? tw.sendSms({ to: owner, body: summary, kind: 'internal', purpose: 'fallback_alert' }) : Promise.resolve({ ok: false }),
      email.send({ to: process.env.OWNER_ALERT_EMAIL || process.env.GMAIL_USER || 'crashhelptx@gmail.com', subject: noDb ? `🚨 New CrashHelp lead — ${data.first_name || ''} ${data.phone || ''}`.trim() : '🚨 CrashHelp lead — database down, saved here only', text: summary, purpose: 'fallback_alert' }),
    ]);
    const delivered = [sms, mail].some((r) => r.status === 'fulfilled' && r.value && r.value.ok);
    log.error('email backup result', null, { ref, kind: `sms:${sms.status === 'fulfilled' && !!sms.value.ok} email:${mail.status === 'fulfilled' && !!mail.value.ok}` });
    if (!delivered) return sendJson(res, 503, { ok: false, retry: true, error: 'We could not save your request. Please call (346) 860-1929.' });
    return sendJson(res, 200, { ok: true, saved: false });
  }
};
