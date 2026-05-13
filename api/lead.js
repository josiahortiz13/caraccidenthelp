const { Resend } = require('resend');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { name, phone, email, city, when, desc, source } = req.body || {};
  const notifyEmail = process.env.NOTIFY_EMAIL || 'josiah5.jo@gmail.com';
  const timestamp = new Date().toLocaleString('en-US', { timeZone: 'America/Chicago' });

  // Email notification via Resend
  if (process.env.RESEND_API_KEY) {
    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      await resend.emails.send({
        from: 'Car Accident Help <onboarding@resend.dev>',
        to: notifyEmail,
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
      console.error('Resend error:', err.message);
    }
  }

  // SMS notification via Twilio (optional)
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM) {
    try {
      const twilio = require('twilio')(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
      await twilio.messages.create({
        body: `🚨 NEW LEAD\nName: ${name}\nPhone: ${phone}\nCity: ${city || 'TX'}\nSource: ${source}\nCall them NOW!`,
        from: process.env.TWILIO_FROM,
        to: process.env.TWILIO_TO || notifyEmail
      });
    } catch (err) {
      console.error('Twilio error:', err.message);
    }
  }

  console.log('Lead received:', { name, phone, city, source, timestamp });
  return res.status(200).json({ ok: true });
};
