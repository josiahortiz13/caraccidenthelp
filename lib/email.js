// Email via Gmail SMTP (existing setup). EMAIL_FAKE=1 records instead of sending (tests only).
const nodemailer = require('nodemailer');
const store = require('./store');

const fake = global.__crashhelpFakeEmail || (global.__crashhelpFakeEmail = { sent: [], fail: false });

function sender() {
  return process.env.GMAIL_USER || 'crashhelptx@gmail.com';
}

async function send({ to, subject, html, text, leadId = null, purpose = '' }) {
  if (!to) return { ok: false, error: 'no_recipient' };
  let receipt = null;
  try {
    if (process.env.EMAIL_FAKE === '1') {
      if (fake.fail) throw new Error('Simulated email outage');
      fake.sent.push({ to, subject, html, text });
    } else {
      if (!process.env.GMAIL_APP_PASSWORD) throw new Error('email_not_configured');
      const t = nodemailer.createTransport({
        host: 'smtp.gmail.com', port: 587, secure: false,
        auth: { user: sender(), pass: process.env.GMAIL_APP_PASSWORD },
      });
      receipt = await t.sendMail({ from: `CrashHelp TX <${sender()}>`, to, subject, html, text });
    }
    // Gmail's SMTP receipt: how many recipients it accepted and its reply code. Proves hand-off, not inbox placement.
    await store.event(leadId, 'email_sent', { purpose, to_domain: String(to).split('@')[1] || '', accepted: receipt ? (receipt.accepted || []).length : null,
      rejected: receipt ? (receipt.rejected || []).length : null, smtp: receipt ? String(receipt.response || '').slice(0, 40) : (process.env.EMAIL_FAKE === '1' ? 'fake' : null) });
    await store.setStatus('email', { state: 'WORKING' });
    return { ok: true };
  } catch (e) {
    await store.event(leadId, 'email_failed', { purpose, error: e.message });
    await store.setStatus('email', { state: 'FAILED', error: e.message });
    return { ok: false, error: e.message };
  }
}

module.exports = { send, fake };
