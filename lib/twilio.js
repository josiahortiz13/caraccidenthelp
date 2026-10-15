// Twilio wrapper: test-mode gate, opt-out gate, logging, signature validation.
// TWILIO_FAKE=1 swaps in a recorder for automated tests (never set in production).
const twilioLib = require('twilio');
const db = require('./db');
const store = require('./store');
const { normalizePhone, baseUrl } = require('./util');

const fake = global.__crashhelpFakeTwilio || (global.__crashhelpFakeTwilio = { sent: [], calls: [], fail: false, seq: 0 });

function configured() {
  return !!(process.env.TWILIO_ACCOUNT_SID && (process.env.TWILIO_AUTH_TOKEN || (process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET)) && fromNumber());
}

function fromNumber() {
  return process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_FROM || '';
}

function testMode() {
  return String(process.env.TWILIO_TEST_MODE ?? 'true').toLowerCase() !== 'false';
}

function allowedTestNumbers() {
  return (process.env.ALLOWED_TEST_NUMBERS || '').split(',').map(normalizePhone).filter(Boolean);
}

function client() {
  if (process.env.TWILIO_FAKE === '1') {
    return {
      messages: { create: async (o) => { if (fake.fail) throw Object.assign(new Error('Simulated Twilio outage'), { code: 20500 }); fake.sent.push(o); return { sid: 'SM' + String(++fake.seq).padStart(32, '0'), status: 'queued' }; } },
      calls: { create: async (o) => { if (fake.fail) throw Object.assign(new Error('Simulated Twilio outage'), { code: 20500 }); fake.calls.push(o); return { sid: 'CA' + String(++fake.seq).padStart(32, '0'), status: 'queued' }; } },
    };
  }
  if (!configured()) return null;
  const sid = process.env.TWILIO_ACCOUNT_SID;
  if (process.env.TWILIO_API_KEY && process.env.TWILIO_API_SECRET) {
    return twilioLib(process.env.TWILIO_API_KEY, process.env.TWILIO_API_SECRET, { accountSid: sid });
  }
  return twilioLib(sid, process.env.TWILIO_AUTH_TOKEN);
}

// Returns null when allowed, or a reason string when this number must not be contacted.
async function blockReason(to, kind) {
  if (!to) return 'no_number';
  if (testMode() && !allowedTestNumbers().includes(to)) return 'test_mode_blocked';
  if (kind === 'consumer') {
    const o = await db.one('SELECT phone FROM opt_outs WHERE phone = $1', [to]);
    if (o) return 'opted_out';
  }
  return null;
}

// kind: 'consumer' (a lead) or 'internal' (owner/backup/staff).
async function sendSms({ to, body, leadId = null, kind = 'internal', purpose = '' }) {
  to = normalizePhone(to);
  const reason = await blockReason(to, kind);
  if (reason) {
    await db.query(
      'INSERT INTO messages (lead_id, direction, kind, purpose, to_number, from_number, body, status, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [leadId, 'outbound', kind, purpose, to, fromNumber(), body, 'blocked', reason]
    );
    await store.event(leadId, 'sms_blocked', { to_last4: to.slice(-4), purpose, reason });
    return { ok: false, blocked: true, reason };
  }
  const c = client();
  if (!c) {
    await store.event(leadId, 'sms_failed', { purpose, error: 'twilio_not_configured' });
    await store.setStatus('sms', { state: 'NOT CONFIGURED' });
    return { ok: false, error: 'twilio_not_configured' };
  }
  try {
    const msg = await c.messages.create({
      to, from: fromNumber(), body,
      statusCallback: `${baseUrl()}/api/twilio?r=msg-status`,
    });
    await db.query(
      'INSERT INTO messages (sid, lead_id, direction, kind, purpose, to_number, from_number, body, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [msg.sid, leadId, 'outbound', kind, purpose, to, fromNumber(), body, msg.status || 'queued']
    );
    await store.event(leadId, 'sms_sent', { purpose, to_last4: to.slice(-4), sid: msg.sid });
    await store.setStatus('sms', { state: 'WORKING', last_sid: msg.sid });
    return { ok: true, sid: msg.sid };
  } catch (e) {
    await db.query(
      'INSERT INTO messages (lead_id, direction, kind, purpose, to_number, from_number, body, status, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [leadId, 'outbound', kind, purpose, to, fromNumber(), body, 'failed', `${e.code || ''} ${e.message}`.trim()]
    );
    await store.event(leadId, 'sms_failed', { purpose, error: e.message, code: e.code || null });
    await store.setStatus('sms', { state: 'FAILED', error: e.message });
    await store.setStatus('last_twilio_failure', { what: 'sms', purpose, error: e.message, lead_id: leadId });
    return { ok: false, error: e.message };
  }
}

// twimlPath: path+query under /api/twilio that returns the TwiML for this call.
async function placeCall({ to, twimlQuery, leadId = null, purpose, kind = 'internal', machineDetection = false }) {
  to = normalizePhone(to);
  const reason = await blockReason(to, kind);
  if (reason) {
    await store.event(leadId, 'call_blocked', { to_last4: to.slice(-4), purpose, reason });
    return { ok: false, blocked: true, reason };
  }
  const c = client();
  if (!c) {
    await store.event(leadId, 'call_failed', { purpose, error: 'twilio_not_configured' });
    return { ok: false, error: 'twilio_not_configured' };
  }
  try {
    const opts = {
      to, from: fromNumber(),
      url: `${baseUrl()}/api/twilio?${twimlQuery}`,
      statusCallback: `${baseUrl()}/api/twilio?r=call-status&purpose=${encodeURIComponent(purpose)}${leadId ? `&lead=${encodeURIComponent(leadId)}` : ''}`,
      statusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      timeout: 25,
    };
    if (machineDetection) opts.machineDetection = 'Enable';
    const call = await c.calls.create(opts);
    await db.query(
      'INSERT INTO calls (sid, lead_id, direction, purpose, to_number, from_number, status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [call.sid, leadId, 'outbound', purpose, to, fromNumber(), call.status || 'queued']
    );
    await store.event(leadId, 'call_started', { purpose, to_last4: to.slice(-4), sid: call.sid });
    await store.setStatus('voice', { state: 'WORKING', last_sid: call.sid });
    return { ok: true, sid: call.sid };
  } catch (e) {
    await db.query(
      'INSERT INTO calls (lead_id, direction, purpose, to_number, from_number, status, error) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [leadId, 'outbound', purpose, to, fromNumber(), 'failed', e.message]
    );
    await store.event(leadId, 'call_failed', { purpose, error: e.message });
    await store.setStatus('voice', { state: 'FAILED', error: e.message });
    await store.setStatus('last_twilio_failure', { what: 'call', purpose, error: e.message, lead_id: leadId });
    return { ok: false, error: e.message };
  }
}

// Validates X-Twilio-Signature against PUBLIC_BASE_URL + the request path.
function validRequest(req) {
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!token) return false;
  const sig = req.headers['x-twilio-signature'];
  if (!sig) return false;
  const url = baseUrl() + req.url;
  return twilioLib.validateRequest(token, sig, url, req.body || {});
}

module.exports = { sendSms, placeCall, validRequest, configured, fromNumber, testMode, allowedTestNumbers, fake };
