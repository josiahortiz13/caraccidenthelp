// All Twilio webhooks, routed by ?r=  (one serverless function keeps you under Vercel's function limit)
//   sms            inbound SMS: STOP/START, CRASH keyword flow, replies from leads
//   voice          inbound call: rings owner (+ backup) with a whisper
//   whisper        what the owner hears before an inbound call connects
//   dial-status    after inbound <Dial>: missed-call text-back
//   owner-alert    TwiML for the "new lead" call to the owner (press 1 to connect)
//   owner-gather   owner pressed a key
//   bridge-status  after owner↔lead (or staff↔lead) bridge ends
//   staff-connect  one-tap call from the dashboard: staff answered, now dial the lead
//   call-status    outbound call status callback
//   msg-status     outbound SMS status callback
const db = require('../lib/db');
const store = require('../lib/store');
const tw = require('../lib/twilio');
const leads = require('../lib/leads');
const { sendXml, xmlEscape, normalizePhone, baseUrl, fill } = require('../lib/util');

const STOP_WORDS = ['STOP', 'STOPALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'REVOKE', 'OPTOUT'];
const START_WORDS = ['START', 'UNSTOP', 'YES'];
const KEYWORDS = ['CRASH', 'HELP', 'START'];
const VOICE = 'Polly.Joanna';

const twiml = (inner) => `<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`;
const say = (t) => `<Say voice="${VOICE}">${xmlEscape(t)}</Say>`;
const empty = () => twiml('');
const url = (q) => xmlEscape(`${baseUrl()}/api/twilio?${q}`);

function landingUrl() {
  return process.env.LANDING_PAGE_URL || `${baseUrl()}/start`;
}

async function leadById(id) {
  return id ? db.one('SELECT * FROM leads WHERE lead_id = $1', [id]) : null;
}

async function latestLeadForPhone(phone) {
  return db.one(`SELECT * FROM leads WHERE phone = $1 AND duplicate_of IS NULL ORDER BY created_at DESC LIMIT 1`, [phone]);
}

// ---------------- SMS ----------------

async function setSession(phone, step, data = {}) {
  await db.query(
    `INSERT INTO sms_sessions (phone, step, data, updated_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (phone) DO UPDATE SET step = EXCLUDED.step, data = EXCLUDED.data, updated_at = now()`,
    [phone, step, JSON.stringify(data)]
  );
}

async function reply(res, phone, text, leadId) {
  // Replies go out through the REST API (not TwiML) so they're logged, gated by test mode, and get delivery status.
  await tw.sendSms({ to: phone, body: text, leadId, kind: 'consumer', purpose: 'sms_flow_reply' });
  return sendXml(res, empty());
}

async function handleSms(req, res) {
  const from = normalizePhone(req.body.From);
  const body = String(req.body.Body || '').trim();
  const word = body.toUpperCase().replace(/[^A-Z]/g, '');
  const lead = await latestLeadForPhone(from);

  await db.query(
    `INSERT INTO messages (sid, lead_id, direction, kind, purpose, to_number, from_number, body, status) VALUES ($1,$2,'inbound','consumer','inbound',$3,$4,$5,'received')
     ON CONFLICT (sid) DO NOTHING`,
    [req.body.MessageSid || null, lead?.lead_id || null, normalizePhone(req.body.To), from, body.slice(0, 1600)]
  );
  await store.setStatus('webhook', { state: 'WORKING', last: 'sms' });

  // STOP family: record the opt-out. Twilio's own opt-out handling sends the carrier-required reply.
  if (STOP_WORDS.includes(word)) {
    await db.query(`INSERT INTO opt_outs (phone, keyword) VALUES ($1,$2) ON CONFLICT (phone) DO UPDATE SET keyword = EXCLUDED.keyword, opted_out_at = now()`, [from, word]);
    await db.query(`UPDATE leads SET sms_opt_out = true, sms_opt_out_at = now(), updated_at = now() WHERE phone = $1`, [from]);
    await db.query('DELETE FROM sms_sessions WHERE phone = $1', [from]);
    await store.event(lead?.lead_id || null, 'sms_opt_out', { keyword: word, phone_last4: from.slice(-4) });
    return sendXml(res, empty());
  }

  const optedOut = await db.one('SELECT 1 FROM opt_outs WHERE phone = $1', [from]);
  if (optedOut && START_WORDS.includes(word)) {
    await db.query('DELETE FROM opt_outs WHERE phone = $1', [from]);
    await db.query('UPDATE leads SET sms_opt_out = false, sms_opt_out_at = NULL WHERE phone = $1', [from]);
    await store.event(lead?.lead_id || null, 'sms_opt_in', { keyword: word });
  } else if (optedOut) {
    return sendXml(res, empty()); // never text an opted-out number
  }

  const session = await db.one('SELECT * FROM sms_sessions WHERE phone = $1', [from]);
  const step = session?.step;
  const data = session?.data || {};

  if (KEYWORDS.includes(word) && !(step === 'awaiting_yes' && word === 'START')) {
    await setSession(from, 'awaiting_yes', { origin: 'keyword', keyword: word });
    return reply(res, from, 'CrashHelp TX here. If you were recently involved in a crash and want us to contact you, reply YES.', lead?.lead_id);
  }

  if (step === 'awaiting_yes') {
    if (word === 'YES' || word === 'Y') {
      await setSession(from, 'ask_name', { ...data, consent_at: new Date().toISOString(), consent_text: 'Replied YES to: "If you were recently involved in a crash and want us to contact you, reply YES."' });
      return reply(res, from, 'Thanks. What is your first name?', lead?.lead_id);
    }
    await db.query('DELETE FROM sms_sessions WHERE phone = $1', [from]);
    return sendXml(res, empty());
  }
  if (step === 'ask_name') {
    const first = body.replace(/[^A-Za-zÀ-ÿ' -]/g, '').trim().split(/\s+/)[0]?.slice(0, 40) || '';
    if (!first) return reply(res, from, 'Sorry, what is your first name?', lead?.lead_id);
    await setSession(from, 'ask_city', { ...data, first_name: first });
    return reply(res, from, `Thanks ${first}. What city did the crash happen in?`, lead?.lead_id);
  }
  if (step === 'ask_city') {
    await setSession(from, 'ask_contact', { ...data, crash_city: body.slice(0, 60) });
    return reply(res, from, 'How should we reach you? Reply CALL, TEXT, or EMAIL.', lead?.lead_id);
  }
  if (step === 'ask_contact') {
    const pref = ['CALL', 'TEXT', 'EMAIL'].find((w) => word.startsWith(w));
    if (!pref) return reply(res, from, 'Please reply CALL, TEXT, or EMAIL.', lead?.lead_id);
    await db.query('DELETE FROM sms_sessions WHERE phone = $1', [from]);
    // Promote a missed-call record to a real lead, or create one.
    const pending = lead && lead.lead_status === 'PENDING CONSENT' ? lead : null;
    if (pending) {
      await db.query(
        `UPDATE leads SET first_name = $2, crash_city = $3, preferred_contact = $4, contact_consent = true, consent_text = $5, lead_status = 'NEW', updated_at = now() WHERE lead_id = $1`,
        [pending.lead_id, data.first_name, data.crash_city, pref.toLowerCase(), data.consent_text]
      );
      await store.event(pending.lead_id, 'consent_received', { via: 'sms_yes' });
      const settings = await store.getSettings();
      const fresh = await leadById(pending.lead_id);
      await tw.sendSms({ to: from, body: fill(leads.CONSUMER_CONFIRMATION, { first_name: data.first_name }), leadId: pending.lead_id, kind: 'consumer', purpose: 'lead_confirmation' });
      await leads.alertNewLead(fresh, settings);
    } else {
      await leads.intake({
        first_name: data.first_name, crash_city: data.crash_city, phone: from, preferred_contact: pref.toLowerCase(),
        contact_consent: true, consent_text: data.consent_text, source: 'sms_keyword', utm_source: 'sms', keyword: data.keyword || null,
      }, { actor: 'sms' });
    }
    return sendXml(res, empty());
  }

  // Free-text from a known lead: put it on their timeline and forward to the owner.
  const settings = await store.getSettings();
  if (lead) {
    await store.event(lead.lead_id, 'sms_received', { preview: body.slice(0, 120) });
    if (settings.primary_phone) {
      await tw.sendSms({ to: settings.primary_phone, kind: 'internal', purpose: 'reply_forward', leadId: lead.lead_id,
        body: `💬 Reply from ${lead.first_name || 'lead'} (${lead.lead_id}):\n"${body.slice(0, 300)}"\n${leads.adminUrl(lead.lead_id)}` });
    }
  } else if (settings.primary_phone) {
    await tw.sendSms({ to: settings.primary_phone, kind: 'internal', purpose: 'unknown_sms_forward',
      body: `💬 Text to CrashHelp number from …${from.slice(-4)}:\n"${body.slice(0, 300)}"` });
  }
  return sendXml(res, empty());
}

// ---------------- Inbound calls ----------------

async function handleVoice(req, res) {
  const settings = await store.getSettings();
  const from = normalizePhone(req.body.From);
  await db.query(
    `INSERT INTO calls (sid, direction, purpose, to_number, from_number, status) VALUES ($1,'inbound','inbound',$2,$3,'ringing') ON CONFLICT (sid) DO NOTHING`,
    [req.body.CallSid, normalizePhone(req.body.To), from]
  );
  await store.setStatus('webhook', { state: 'WORKING', last: 'voice' });
  const nums = [settings.primary_phone, settings.backup_phone].map(normalizePhone).filter(Boolean);
  if (!nums.length) {
    return sendXml(res, twiml(say('Thanks for calling CrashHelp TX. We will text you right back.') + `<Redirect method="POST">${url('r=dial-status&nobody=1')}</Redirect>`));
  }
  const numbers = nums.map((n) => `<Number url="${url('r=whisper')}">${xmlEscape(n)}</Number>`).join('');
  return sendXml(res, twiml(`<Dial timeout="20" answerOnBridge="true" action="${url('r=dial-status')}">${numbers}</Dial>`));
}

function handleWhisper(req, res) {
  return sendXml(res, twiml(say('Incoming CrashHelp T X call.')));
}

async function handleDialStatus(req, res) {
  const from = normalizePhone(req.body.From);
  const status = req.query.nobody ? 'no-answer' : req.body.DialCallStatus;
  const answered = status === 'completed' || status === 'answered';
  await db.query('UPDATE calls SET status = $2, duration = $3, connected = $4, updated_at = now() WHERE sid = $1',
    [req.body.CallSid, answered ? 'answered' : `missed:${status}`, Number(req.body.DialCallDuration || 0), answered]);

  // Every caller becomes a record so nobody is lost. Callers have not consented to marketing.
  let lead = await latestLeadForPhone(from);
  if (!lead && from) {
    const r = await leads.intake({ phone: from, source: 'inbound_call', utm_source: 'phone', preferred_contact: 'call',
      contact_consent: false, lead_status: answered ? 'CONTACTED' : 'PENDING CONSENT' }, { actor: 'inbound_call', notify: false });
    lead = await leadById(r.lead_id);
  }
  if (lead) {
    await db.query('UPDATE calls SET lead_id = $2 WHERE sid = $1', [req.body.CallSid, lead.lead_id]);
    await store.event(lead.lead_id, answered ? 'inbound_call_answered' : 'inbound_call_missed', { duration: Number(req.body.DialCallDuration || 0) });
    if (answered) {
      await db.query(`UPDATE leads SET first_contact_at = COALESCE(first_contact_at, now()), first_response_at = COALESCE(first_response_at, now()),
        last_contact_at = now(), lead_status = CASE WHEN lead_status IN ('NEW','PENDING CONSENT','CONTACT ATTEMPTED') THEN 'CONTACTED' ELSE lead_status END WHERE lead_id = $1`, [lead.lead_id]);
    }
  }

  if (answered) return sendXml(res, empty());

  // Missed: one text-back to the caller (they called us), then tell the owner.
  if (from) {
    const body = fill('Hi, you reached CrashHelp TX. We missed your call. If you were recently involved in a crash and want help organizing your next steps, reply YES or start here: {{url}}', { url: landingUrl() });
    await tw.sendSms({ to: from, body, leadId: lead?.lead_id, kind: 'consumer', purpose: 'missed_call_textback' });
    await setSession(from, 'awaiting_yes', { origin: 'missed_call' });
  }
  const settings = await store.getSettings();
  const targets = await leads.alertTargets(settings, ['owner']);
  for (const t of targets.filter((x) => x.phone)) {
    await tw.sendSms({ to: t.phone, kind: 'internal', purpose: 'missed_call_alert', leadId: lead?.lead_id,
      body: `📵 MISSED CALL — CrashHelp TX\nFrom: ${from || 'unknown'}\nText-back sent. Call them back.\n${lead ? leads.adminUrl(lead.lead_id) : ''}` });
  }
  return sendXml(res, twiml(say('Sorry we missed you. We just sent you a text. Goodbye.') + '<Hangup/>'));
}

// ---------------- Owner alert call + bridge ----------------

async function handleOwnerAlert(req, res) {
  const lead = await leadById(req.query.lead);
  const answeredBy = String(req.body.AnsweredBy || '');
  if (answeredBy.startsWith('machine') || answeredBy === 'fax') {
    await store.event(lead?.lead_id, 'owner_alert_voicemail', { answered_by: answeredBy });
    await db.query('UPDATE calls SET answered_by = $2 WHERE sid = $1', [req.body.CallSid, answeredBy]);
    await scheduleBackup(lead, 'owner_voicemail');
    return sendXml(res, twiml('<Hangup/>'));
  }
  if (!lead) return sendXml(res, twiml(say('This lead could not be found. Check the dashboard.')));
  const who = `${lead.first_name || 'a caller'}${lead.crash_city ? ` in ${lead.crash_city}` : ''}`;
  const canBridge = !!lead.phone && lead.contact_consent;
  await store.event(lead.lead_id, 'owner_alert_answered', { purpose: req.query.purpose || 'owner_alert' });
  if (!canBridge) {
    return sendXml(res, twiml(say(`New CrashHelp T X lead from ${who}. They prefer ${lead.preferred_contact || 'a callback'}. Check your texts for details.`)));
  }
  const prompt = say(`New CrashHelp T X lead from ${who}. Press 1 to connect.`);
  return sendXml(res, twiml(
    `<Gather numDigits="1" timeout="8" action="${url(`r=owner-gather&lead=${encodeURIComponent(lead.lead_id)}`)}">${prompt}</Gather>` +
    `<Gather numDigits="1" timeout="8" action="${url(`r=owner-gather&lead=${encodeURIComponent(lead.lead_id)}`)}">${prompt}</Gather>` +
    say('No key pressed. The lead is waiting in your dashboard.')
  ));
}

async function bridgeTo(lead, actor) {
  const block = await (async () => {
    if (!lead.contact_consent) return 'no_consent';
    if (tw.testMode() && !tw.allowedTestNumbers().includes(lead.phone)) return 'test_mode_blocked';
    return null;
  })();
  if (block) {
    await store.event(lead.lead_id, 'bridge_blocked', { reason: block }, actor);
    return twiml(say(block === 'test_mode_blocked'
      ? 'Test mode is on, so this lead was not dialed. Call them from your phone or turn off test mode.'
      : 'This lead has not given consent to be called. Check the dashboard.'));
  }
  await leads.markAttempt(lead.lead_id, 'call', actor);
  await store.event(lead.lead_id, 'bridge_dialing', {}, actor);
  return twiml(say('Connecting now.') +
    `<Dial callerId="${xmlEscape(tw.fromNumber())}" timeout="25" action="${url(`r=bridge-status&lead=${encodeURIComponent(lead.lead_id)}&actor=${encodeURIComponent(actor)}`)}">${xmlEscape(lead.phone)}</Dial>`);
}

async function handleOwnerGather(req, res) {
  const lead = await leadById(req.query.lead);
  if (!lead) return sendXml(res, twiml(say('Lead not found.')));
  if (String(req.body.Digits) !== '1') return sendXml(res, twiml(say('Okay. The lead is in your dashboard.')));
  return sendXml(res, await bridgeTo(lead, 'owner'));
}

async function handleStaffConnect(req, res) {
  const lead = await leadById(req.query.lead);
  if (!lead) return sendXml(res, twiml(say('Lead not found.')));
  return sendXml(res, await bridgeTo(lead, req.query.actor || 'staff'));
}

async function handleBridgeStatus(req, res) {
  const lead = await leadById(req.query.lead);
  const status = req.body.DialCallStatus;
  const duration = Number(req.body.DialCallDuration || 0);
  const connected = status === 'completed' && duration > 0;
  if (lead) {
    await store.event(lead.lead_id, connected ? 'call_connected' : 'call_not_connected', { status, duration }, req.query.actor || 'owner');
    if (connected) {
      await db.query(`UPDATE leads SET first_contact_at = COALESCE(first_contact_at, now()), last_contact_at = now(), updated_at = now(),
        lead_status = CASE WHEN lead_status IN ('NEW','PENDING CONSENT','CONTACT ATTEMPTED') THEN 'CONTACTED' ELSE lead_status END WHERE lead_id = $1`, [lead.lead_id]);
      await require('../lib/crm').sync(lead.lead_id, 'call_connected');
    }
  }
  await db.query('UPDATE calls SET connected = $2, duration = GREATEST(COALESCE(duration,0), $3), updated_at = now() WHERE sid = $1', [req.body.CallSid, connected, duration]);
  return sendXml(res, twiml(connected ? '' : say('The lead did not answer. Try a text from the dashboard.')));
}

// Owner didn't pick up → backup call after the configured delay (cron places it; 0 = now).
async function scheduleBackup(lead, why) {
  if (!lead) return;
  const settings = await store.getSettings();
  if (!settings.backup_phone || !settings.voice_alert) return;
  if (lead.first_contact_at) return;
  const already = await db.one(`SELECT 1 FROM calls WHERE lead_id = $1 AND purpose = 'backup_alert'`, [lead.lead_id]);
  if (already || lead.backup_call_due_at) return;
  const delay = Math.max(0, Number(settings.backup_call_delay_min) || 0);
  await db.query(`UPDATE leads SET backup_call_due_at = now() + make_interval(mins => $2::int) WHERE lead_id = $1`, [lead.lead_id, delay]);
  await store.event(lead.lead_id, 'backup_call_scheduled', { why, delay_min: delay });
  if (delay === 0) {
    const escalation = require('../lib/escalation');
    await escalation.placeDueBackupCalls();
  }
}

async function handleCallStatus(req, res) {
  const status = req.body.CallStatus;
  await db.query(
    `UPDATE calls SET status = $2, duration = COALESCE($3, duration), answered_by = COALESCE($4, answered_by), updated_at = now() WHERE sid = $1`,
    [req.body.CallSid, status, req.body.CallDuration ? Number(req.body.CallDuration) : null, req.body.AnsweredBy || null]
  );
  const lead = await leadById(req.query.lead);
  if (lead && ['completed', 'busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
    await store.event(lead.lead_id, `call_${status.replace('-', '_')}`, { purpose: req.query.purpose, duration: Number(req.body.CallDuration || 0) });
  }
  if (lead && req.query.purpose === 'owner_alert' && ['busy', 'no-answer', 'failed', 'canceled'].includes(status)) {
    await scheduleBackup(lead, `owner_${status}`);
  }
  await store.setStatus('voice', { state: status === 'failed' ? 'FAILED' : 'WORKING', last_status: status });
  return sendXml(res, empty());
}

async function handleMsgStatus(req, res) {
  const status = req.body.MessageStatus;
  await db.query('UPDATE messages SET status = $2, error = COALESCE($3, error), updated_at = now() WHERE sid = $1',
    [req.body.MessageSid, status, req.body.ErrorCode ? `twilio_${req.body.ErrorCode}` : null]);
  if (['failed', 'undelivered'].includes(status)) {
    const m = await db.one('SELECT lead_id, purpose FROM messages WHERE sid = $1', [req.body.MessageSid]);
    await store.event(m?.lead_id || null, 'sms_undelivered', { purpose: m?.purpose, error_code: req.body.ErrorCode || null });
    await store.setStatus('sms', { state: 'FAILED', error: `delivery ${status} ${req.body.ErrorCode || ''}`.trim() });
  } else if (status === 'delivered') {
    await store.setStatus('sms', { state: 'WORKING', last_delivered: req.body.MessageSid });
  }
  return sendXml(res, empty());
}

const ROUTES = {
  sms: handleSms, voice: handleVoice, whisper: handleWhisper, 'dial-status': handleDialStatus,
  'owner-alert': handleOwnerAlert, 'owner-gather': handleOwnerGather, 'staff-connect': handleStaffConnect,
  'bridge-status': handleBridgeStatus, 'call-status': handleCallStatus, 'msg-status': handleMsgStatus,
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
  req.query = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const handler = ROUTES[req.query.r];
  if (!handler) { res.statusCode = 404; return res.end(); }
  if (!tw.validRequest(req)) {
    await store.setStatus('webhook', { state: 'FAILED', error: `bad signature on ${req.query.r}` });
    res.statusCode = 403;
    return res.end('Invalid Twilio signature');
  }
  try {
    return await handler(req, res);
  } catch (e) {
    console.error('twilio webhook error', req.query.r, e);
    await store.setStatus('webhook', { state: 'FAILED', error: `${req.query.r}: ${e.message}` });
    // Inbound calls must still reach a human even if our code breaks.
    if (req.query.r === 'voice') {
      const owner = normalizePhone(process.env.OWNER_ALERT_PHONE);
      return sendXml(res, twiml(owner ? `<Dial timeout="20">${xmlEscape(owner)}</Dial>` : say('Thanks for calling CrashHelp TX. Please text us at this number.')));
    }
    return sendXml(res, empty());
  }
};

module.exports.scheduleBackup = scheduleBackup;
