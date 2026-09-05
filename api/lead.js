const nodemailer = require('nodemailer');

function getTwilioClient() {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  if (!sid) return null;
  const apiKey = process.env.TWILIO_API_KEY;
  const apiSecret = process.env.TWILIO_API_SECRET;
  if (apiKey && apiSecret) return require('twilio')(apiKey, apiSecret, { accountSid: sid });
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  if (authToken) return require('twilio')(sid, authToken);
  return null;
}

function sanitize(str) {
  if (!str) return '';
  return String(str).replace(/[<>'"]/g, '').slice(0, 500);
}

function isValidPhone(p) {
  if (!p) return true; // optional
  return /^\+?[\d\s\-().]{7,20}$/.test(p);
}

module.exports = async (req, res) => {
  const allowedOrigins = ['https://www.crashhelptx.com', 'https://crashhelptx.com'];
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const raw = req.body || {};
  const name   = sanitize(raw.name);
  const phone  = sanitize(raw.phone);
  const email  = sanitize(raw.email);
  const city   = sanitize(raw.city);
  const when   = sanitize(raw.when);
  const desc   = sanitize(raw.desc);
  const source = sanitize(raw.source);

  if (!name && !phone) return res.status(400).json({ error: 'Name or phone required' });
  if (phone && !isValidPhone(phone)) return res.status(400).json({ error: 'Invalid phone number' });

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

  // SMS via Twilio — alert owner on every new lead
  const ownerPhone = process.env.OWNER_PHONE || process.env.TWILIO_TO;
  const twilioClient = getTwilioClient();
  if (twilioClient && process.env.TWILIO_FROM && ownerPhone) {
    try {
      await twilioClient.messages.create({
        body: `🚨 NEW LEAD — Call NOW!\nName: ${name}\nPhone: ${phone}\nCity: ${city || 'TX'}\nSource: ${source}`,
        from: process.env.TWILIO_FROM,
        to: ownerPhone
      });
    } catch (err) {
      console.error('Twilio error:', err.message);
    }
  }

  console.log('Lead received:', { name, phone, city, source, timestamp });
  return res.status(200).json({ ok: true });
};
