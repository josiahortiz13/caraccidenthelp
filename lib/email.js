// Email delivery. Two providers, tried in order:
//   1) Resend (RESEND_API_KEY) from the crashhelptx.com domain — does not depend on anyone's Gmail login.
//   2) Gmail SMTP (GMAIL_APP_PASSWORD) — backup if Resend is missing or fails.
// A lead alert only fails when BOTH fail. EMAIL_FAKE=1 records instead of sending (tests only).
const nodemailer = require('nodemailer');
const store = require('./store');

const fake = global.__crashhelpFakeEmail || (global.__crashhelpFakeEmail = { sent: [], fail: false, resendFail: false });

function gmailSender() {
  return process.env.GMAIL_USER || 'crashhelptx@gmail.com';
}

function resendFrom() {
  return process.env.RESEND_FROM || 'CrashHelp TX <alerts@crashhelptx.com>';
}

function providers() {
  const out = [];
  if (process.env.RESEND_API_KEY) out.push('resend');
  if (process.env.GMAIL_APP_PASSWORD) out.push('gmail');
  return out;
}

const toList = (to) => String(to).split(',').map((s) => s.trim()).filter(Boolean);

async function viaResend({ to, subject, html, text }) {
  if (process.env.EMAIL_FAKE === '1') {
    if (fake.fail || fake.resendFail) throw new Error('Simulated Resend outage');
    fake.sent.push({ to, subject, html, text, provider: 'resend' });
    return { accepted: toList(to).length, rejected: 0, smtp: 'fake' };
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10000);
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: resendFrom(), to: toList(to), subject, html, text }),
      signal: ctrl.signal,
    });
    const body = await r.json().catch(() => ({}));
    if (!r.ok || !body.id) throw new Error(`resend_${r.status}: ${String(body.message || body.name || 'send failed').slice(0, 120)}`);
    return { accepted: toList(to).length, rejected: 0, smtp: `resend ${String(body.id).slice(0, 24)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function viaGmail({ to, subject, html, text }) {
  if (process.env.EMAIL_FAKE === '1') {
    if (fake.fail) throw new Error('Simulated email outage');
    fake.sent.push({ to, subject, html, text, provider: 'gmail' });
    return { accepted: null, rejected: null, smtp: 'fake' };
  }
  const t = nodemailer.createTransport({
    host: 'smtp.gmail.com', port: 587, secure: false,
    auth: { user: gmailSender(), pass: process.env.GMAIL_APP_PASSWORD },
  });
  const receipt = await t.sendMail({ from: `CrashHelp TX <${gmailSender()}>`, to, subject, html, text });
  return { accepted: (receipt.accepted || []).length, rejected: (receipt.rejected || []).length, smtp: String(receipt.response || '').slice(0, 40) };
}

async function send({ to, subject, html, text, leadId = null, purpose = '' }) {
  if (!to) return { ok: false, error: 'no_recipient' };
  // Tests run with no provider keys: keep the old single-path fake so existing tests behave as before.
  const order = process.env.EMAIL_FAKE === '1' && !providers().length ? ['gmail'] : providers();
  if (!order.length) {
    const error = 'email_not_configured';
    await store.event(leadId, 'email_failed', { purpose, error });
    await store.setStatus('email', { state: 'FAILED', error });
    return { ok: false, error };
  }
  const errors = [];
  for (const p of order) {
    try {
      const r = p === 'resend' ? await viaResend({ to, subject, html, text }) : await viaGmail({ to, subject, html, text });
      // Provider receipt proves hand-off, not inbox placement.
      await store.event(leadId, 'email_sent', { purpose, provider: p, to_domain: String(to).split('@')[1] || '', accepted: r.accepted, rejected: r.rejected, smtp: r.smtp,
        fallback_from: errors.length ? errors.map((e) => e.provider).join(',') : undefined });
      await store.setStatus('email', { state: errors.length ? 'DEGRADED' : 'WORKING', provider: p, error: errors.length ? errors[0].error : undefined });
      return { ok: true, provider: p, accepted: r.accepted, rejected: r.rejected, smtp: r.smtp };
    } catch (e) {
      errors.push({ provider: p, error: String(e.message || e).slice(0, 160) });
    }
  }
  const error = errors.map((e) => `${e.provider}: ${e.error}`).join(' | ');
  await store.event(leadId, 'email_failed', { purpose, error });
  await store.setStatus('email', { state: 'FAILED', error });
  return { ok: false, error };
}

module.exports = { send, fake, providers };
