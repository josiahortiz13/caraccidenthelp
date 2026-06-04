const nodemailer = require('nodemailer');

const rateMap = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const entry = rateMap.get(ip) || { count: 0, reset: now + 60000 };
  if (now > entry.reset) { entry.count = 0; entry.reset = now + 60000; }
  entry.count++;
  rateMap.set(ip, entry);
  return entry.count > 5;
}

function sanitize(str) {
  if (!str) return '';
  return String(str).replace(/[<>]/g, '').slice(0, 500);
}

module.exports = async (req, res) => {
  const allowedOrigins = ['https://www.crashhelptx.com', 'https://crashhelptx.com'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) return res.status(429).json({ error: 'Too many requests' });

  const raw = req.body || {};
  const name   = sanitize(raw.name);
  const phone  = sanitize(raw.phone);
  const email  = sanitize(raw.email);
  const city   = sanitize(raw.city);
  const when   = sanitize(raw.when);
  const desc   = sanitize(raw.desc);
  const source = sanitize(raw.source);

  if (!name && !phone) return res.status(400).json({ error: 'Name or phone required' });

  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

  // Email via Gmail SMTP
  if (process.env.GMAIL_APP_PASSWORD) {
    try {
      const transporter = nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false,
        auth: {
          user: 'crashhelptx@gmail.com',
          pass: process.env.GMAIL_APP_PASSWORD
        }
      });
      await transporter.sendMail({
        from: 'CrashHelpTX Leads <crashhelptx@gmail.com>',
        to: 'crashhelptx@gmail.com',
        subject: `🚨 New Lead: ${name || 'Unknown'} — ${city || 'TX'} — ${phone || 'no phone'}`,
        html: `
          <div style="font-family:sans-serif;max-width:500px;margin:0 auto">
            <h2 style="color:#e03030">🚨 New Car Accident Lead</h2>
            <table style="width:100%;border-collapse:collapse">
              <tr><td style="padding:8px 0;font-weight:bold;color:#555">Name</td><td style="padding:8px 0">${name || '—'}</td></tr>
              <tr><td style="padding:8px 0;font-weight:bold;color:#555">Phone</td><td style="padding:8px 0"><a href="tel:${phone}">${phone || '—'}</a></td></tr>
              <tr><td style="padding:8px 0;font-weight:bold;color:#555">Email</td><td style="padding:8px 0">${email || '—'}</td></tr>
              <tr><td style="padding:8px 0;font-weight:bold;color:#555">City</td><td style="padding:8px 0">${city || '—'}</td></tr>
              <tr><td style="padding:8px 0;font-weight:bold;color:#555">When</td><td style="padding:8px 0">${when || '—'}</td></tr>
              <tr><td style="padding:8px 0;font-weight:bold;color:#555">Source</td><td style="padding:8px 0">${source || '—'}</td></tr>
              <tr><td style="padding:8px 0;font-weight:bold;color:#555">Description</td><td style="padding:8px 0">${desc || '—'}</td></tr>
              <tr><td style="padding:8px 0;font-weight:bold;color:#555">Time (CT)</td><td style="padding:8px 0">${timestamp}</td></tr>
            </table>
            <div style="margin-top:24px">
              <a href="tel:${phone}" style="background:#e03030;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;display:inline-block">📞 Call ${name || 'Lead'} Now</a>
            </div>
          </div>
        `
      });
    } catch (err) {
      console.error('Gmail error:', err.message);
    }
  }

  // SMS via Twilio (optional)
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({
        body: `🚨 NEW LEAD\nName: ${name}\nPhone: ${phone}\nCity: ${city || 'TX'}\nSource: ${source}\nCall them NOW!`,
        from: process.env.TWILIO_FROM,
        to: process.env.TWILIO_TO
      });
    } catch (err) {
      console.error('Twilio error:', err.message);
    }
  }

  console.log('Lead received:', { name, phone, city, source, timestamp });
  return res.status(200).json({ ok: true });
};
