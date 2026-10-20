// Staging self-checks, run from the dashboard (owner only). Nothing here ever returns a secret value.
const db = require('./db');
const store = require('./store');
const tw = require('./twilio');
const leads = require('./leads');
const auth = require('./auth');
const { normalizePhone, maskPhone, baseUrl, twilioUrl } = require('./util');

const E164 = /^\+[1-9]\d{9,14}$/;

function check(name, state, note = '') { return { name, state, note }; }

// ---------- 1. Environment variables: CONFIGURED / MISSING / INVALID ----------
async function envCheck(req) {
  const e = process.env;
  const out = [];
  const has = (k) => !!(e[k] && String(e[k]).trim());

  out.push(!has('TWILIO_ACCOUNT_SID') ? check('TWILIO_ACCOUNT_SID', 'MISSING')
    : /^AC[0-9a-f]{32}$/i.test(e.TWILIO_ACCOUNT_SID) ? check('TWILIO_ACCOUNT_SID', 'CONFIGURED') : check('TWILIO_ACCOUNT_SID', 'INVALID', 'Should start with AC and be 34 characters'));
  out.push(!has('TWILIO_AUTH_TOKEN') ? check('TWILIO_AUTH_TOKEN', 'MISSING', 'Required to verify Twilio webhooks')
    : /^[0-9a-f]{32}$/i.test(e.TWILIO_AUTH_TOKEN) ? check('TWILIO_AUTH_TOKEN', 'CONFIGURED') : check('TWILIO_AUTH_TOKEN', 'INVALID', 'Should be 32 hex characters (Console → Account → API keys & tokens → Auth token)'));
  const from = e.TWILIO_PHONE_NUMBER || e.TWILIO_FROM;
  out.push(!from ? check('TWILIO_PHONE_NUMBER', 'MISSING')
    : E164.test(from) ? check('TWILIO_PHONE_NUMBER', 'CONFIGURED', `ends in ${from.slice(-4)}`) : check('TWILIO_PHONE_NUMBER', 'INVALID', 'Use +1XXXXXXXXXX format'));

  const settings = await store.getSettings().catch(() => ({}));
  const owner = normalizePhone(settings.primary_phone || e.OWNER_ALERT_PHONE || e.OWNER_PHONE);
  out.push(!(e.OWNER_ALERT_PHONE || e.OWNER_PHONE || settings.primary_phone) ? check('OWNER_ALERT_PHONE', 'MISSING')
    : owner ? check('OWNER_ALERT_PHONE', 'CONFIGURED', `ends in ${owner.slice(-4)}`) : check('OWNER_ALERT_PHONE', 'INVALID', 'Not a valid phone number'));
  const backup = normalizePhone(settings.backup_phone || e.BACKUP_ALERT_PHONE);
  out.push(!(e.BACKUP_ALERT_PHONE || settings.backup_phone) ? check('BACKUP_ALERT_PHONE', 'MISSING', 'Optional, but needed for backup escalation')
    : backup ? check('BACKUP_ALERT_PHONE', 'CONFIGURED', `ends in ${backup.slice(-4)}`) : check('BACKUP_ALERT_PHONE', 'INVALID'));

  const tm = e.TWILIO_TEST_MODE;
  out.push(tm === undefined || tm === '' ? check('TWILIO_TEST_MODE', 'MISSING', 'Not set, so the code defaults to ON. Set it to true explicitly.')
    : String(tm).toLowerCase() === 'true' ? check('TWILIO_TEST_MODE', 'CONFIGURED', 'ON') : check('TWILIO_TEST_MODE', 'INVALID', 'Must be true until you approve going live'));
  out.push(String(e.CONSUMER_SMS_ENABLED || '').toLowerCase() === 'true'
    ? check('Consumer texting', 'CONFIGURED', 'ON: confirmations and text replies go to people who gave consent')
    : check('Consumer texting', 'PENDING', 'OFF until A2P campaign approval. Calls, email and owner alerts still work.'));

  const rawAllowed = (e.ALLOWED_TEST_NUMBERS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const allowed = rawAllowed.map(normalizePhone);
  let note = `${allowed.filter(Boolean).length} number(s)`;
  if (owner && !allowed.includes(owner)) note += '. Owner phone is NOT in the list, so owner alerts are blocked in test mode';
  if (backup && !allowed.includes(backup)) note += '. Backup phone is NOT in the list';
  out.push(!rawAllowed.length ? check('ALLOWED_TEST_NUMBERS', 'MISSING', 'Nothing can be texted or called in test mode')
    : allowed.every(Boolean) ? check('ALLOWED_TEST_NUMBERS', 'CONFIGURED', note) : check('ALLOWED_TEST_NUMBERS', 'INVALID', 'One or more numbers are not valid phone numbers'));

  out.push(!has('SESSION_SECRET') ? check('SESSION_SECRET', 'MISSING')
    : e.SESSION_SECRET.length >= 32 ? check('SESSION_SECRET', 'CONFIGURED') : check('SESSION_SECRET', 'INVALID', 'Needs 32+ characters'));
  const users = auth.users();
  out.push(!(has('ADMIN_USERS') || has('ADMIN_PASSWORD')) ? check('ADMIN credentials', 'MISSING')
    : users.some((u) => u.role === 'owner') ? check('ADMIN credentials', 'CONFIGURED', `${users.length} user(s)`) : check('ADMIN credentials', 'INVALID', 'ADMIN_USERS must be valid JSON with at least one owner'));
  out.push(!has('CRON_SECRET') ? check('CRON_SECRET', 'MISSING', 'Escalation timer endpoint is locked until this is set')
    : e.CRON_SECRET.length >= 16 ? check('CRON_SECRET', 'CONFIGURED') : check('CRON_SECRET', 'INVALID', 'Use 16+ random characters'));

  if (!has('DATABASE_URL') && process.env.PGLITE !== '1') out.push(check('DATABASE_URL', 'MISSING'));
  else {
    try { await db.query('SELECT 1'); out.push(check('DATABASE_URL', 'CONFIGURED', 'connected')); }
    catch (err) { out.push(check('DATABASE_URL', 'INVALID', 'Could not connect: ' + String(err.message).replace(/postgres(ql)?:\/\/\S+/g, '[url]').slice(0, 120))); }
  }

  // Signatures are computed against PUBLIC_BASE_URL, so it must be the host Twilio actually calls.
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  if (!has('PUBLIC_BASE_URL')) out.push(check('PUBLIC_BASE_URL', 'MISSING', 'Defaults to www.crashhelptx.com, which is wrong for a preview'));
  else {
    let h = ''; try { h = new URL(e.PUBLIC_BASE_URL).host; } catch {}
    out.push(!h ? check('PUBLIC_BASE_URL', 'INVALID', 'Not a URL')
      : host && h !== host && !host.startsWith('localhost') ? check('PUBLIC_BASE_URL', 'INVALID', `Points at ${h} but this deployment is ${host}. Twilio signature checks will fail.`)
      : check('PUBLIC_BASE_URL', 'CONFIGURED', h));
  }

  if (e.VERCEL_ENV === 'preview') {
    out.push(has('VERCEL_AUTOMATION_BYPASS_SECRET') ? check('Preview protection bypass', 'CONFIGURED', 'Twilio can reach this protected preview')
      : check('Preview protection bypass', 'MISSING', 'Turn on Protection Bypass for Automation, or Twilio webhooks will be blocked by Vercel login'));
  }
  if (has('PARTNER_PHONES')) out.push(check('PARTNER_PHONES', 'INVALID', 'Left over from the removed crash-alert feature. Delete it in Vercel.'));
  out.push(!has('GMAIL_APP_PASSWORD') ? check('Email (GMAIL_APP_PASSWORD)', 'MISSING', 'Email alerts will fail; texts still work')
    : e.GMAIL_APP_PASSWORD.replace(/\s/g, '').length === 16 ? check('Email (GMAIL_APP_PASSWORD)', 'CONFIGURED') : check('Email (GMAIL_APP_PASSWORD)', 'INVALID', 'Gmail app passwords are 16 letters'));

  const mode = (e.CRM_MODE || 'none').toLowerCase();
  if (mode === 'none') out.push(check('CRM / HighLevel', 'MISSING', 'CRM_MODE=none: leads stay in the dashboard only'));
  else if (mode === 'ghl') {
    const miss = ['GHL_API_KEY', 'GHL_LOCATION_ID'].filter((k) => !has(k));
    let stagesOk = true; if (has('GHL_STAGE_IDS')) { try { const m = JSON.parse(e.GHL_STAGE_IDS); stagesOk = typeof m === 'object'; } catch { stagesOk = false; } }
    out.push(miss.length ? check('CRM / HighLevel', 'MISSING', 'Missing ' + miss.join(', '))
      : stagesOk ? check('CRM / HighLevel', 'CONFIGURED', has('GHL_PIPELINE_ID') ? 'mode ghl' : `mode ghl · pipeline looked up by name "${e.GHL_PIPELINE_NAME || 'CrashHelp TX'}"`) : check('CRM / HighLevel', 'INVALID', 'GHL_STAGE_IDS is not valid JSON with stage IDs'));
  } else if (mode === 'webhook') {
    let ok = false; try { ok = new URL(e.CRM_WEBHOOK_URL).protocol === 'https:'; } catch {}
    out.push(ok ? check('CRM / HighLevel', 'CONFIGURED', 'mode webhook') : check('CRM / HighLevel', 'INVALID', 'CRM_WEBHOOK_URL must be an https URL'));
  } else out.push(check('CRM / HighLevel', 'INVALID', 'CRM_MODE must be none, ghl or webhook'));

  return out;
}

// ---------- 2. Twilio number, webhooks and A2P (live API) ----------
function expectedUrls() {
  return {
    voice: twilioUrl('r=voice'),
    sms: twilioUrl('r=sms'),
    status: twilioUrl('r=call-status&purpose=inbound'),
  };
}

async function findNumber(client) {
  const from = tw.fromNumber();
  const list = await client.incomingPhoneNumbers.list({ phoneNumber: from, limit: 1 });
  return list[0] || null;
}

// When the configured number isn't found: what this account is and which numbers it does hold (last 4 only).
async function accountDiagnosis(client) {
  const d = {};
  try {
    const acct = await client.api.v2010.accounts(process.env.TWILIO_ACCOUNT_SID).fetch();
    d.account_type = acct.type; d.account_status = acct.status; d.is_subaccount = !!(acct.ownerAccountSid && acct.ownerAccountSid !== acct.sid);
  } catch (e) { d.account_error = e.message; }
  try { d.numbers_on_account = (await client.incomingPhoneNumbers.list({ limit: 20 })).map((n) => ({ number: n.phoneNumber, sms: !!n.capabilities?.sms, voice: !!n.capabilities?.voice, voice_url_set: !!n.voiceUrl, sms_url_set: !!n.smsUrl, messaging_service: n.smsApplicationSid || null })); } catch (e) { d.numbers_error = e.message; }
  try { d.subaccounts = (await client.api.v2010.accounts.list({ limit: 20 })).filter((a) => a.sid !== process.env.TWILIO_ACCOUNT_SID).map((a) => a.friendlyName); } catch { /* not a parent account */ }
  return d;
}

async function twilioCheck() {
  const client = tw.rawClient();
  if (!client) return { state: 'ACTION REQUIRED', note: 'Twilio credentials missing', items: [] };
  const items = [];
  const exp = expectedUrls();
  let num;
  try { num = await findNumber(client); } catch (e) { return { state: 'ACTION REQUIRED', note: `Twilio API error: ${e.message}`, items }; }
  if (!num) return { state: 'ACTION REQUIRED', note: `TWILIO_PHONE_NUMBER (ends ${tw.fromNumber().slice(-4)}) is not on this Twilio account`, items, diagnosis: await accountDiagnosis(client) };

  items.push(check('Number on this account', 'READY', `ends in ${num.phoneNumber.slice(-4)}`));
  items.push(check('SMS capable', num.capabilities?.sms ? 'READY' : 'ACTION REQUIRED'));
  items.push(check('Voice capable', num.capabilities?.voice ? 'READY' : 'ACTION REQUIRED'));
  items.push(check('Inbound voice webhook', num.voiceUrl === exp.voice && (num.voiceMethod || 'POST') === 'POST' ? 'READY' : 'ACTION REQUIRED',
    num.voiceUrl === exp.voice ? 'points at this deployment' : `currently ${num.voiceUrl ? 'points elsewhere' : 'not set'}`));
  items.push(check('Inbound SMS webhook', num.smsUrl === exp.sms && (num.smsMethod || 'POST') === 'POST' ? 'READY' : 'ACTION REQUIRED',
    num.smsUrl === exp.sms ? 'points at this deployment' : `currently ${num.smsUrl ? 'points elsewhere' : 'not set'} (if the number is in a Messaging Service, set it there)`));
  items.push(check('Call status callback', num.statusCallback === exp.status ? 'READY' : 'ACTION REQUIRED',
    num.statusCallback === exp.status ? 'points at this deployment' : 'not set to this deployment'));

  // A2P 10DLC (US local numbers). Field names per Twilio Messaging v1 API; unknown shapes report PENDING with a note.
  let a2p = check('A2P 10DLC', 'PENDING', 'Could not read registration status. Check Console → Messaging → Regulatory Compliance.');
  try {
    const brands = await client.messaging.v1.brandRegistrations.list({ limit: 20 });
    const brand = brands.find((b) => String(b.status).toUpperCase() === 'APPROVED') || brands[0];
    if (!brand) a2p = check('A2P 10DLC', 'ACTION REQUIRED', 'No brand registered');
    else if (String(brand.status).toUpperCase() !== 'APPROVED') a2p = check('A2P 10DLC', 'PENDING', `Brand status ${brand.status}`);
    else {
      const services = await client.messaging.v1.services.list({ limit: 20 });
      let campaign = null;
      for (const s of services) {
        const c = await client.messaging.v1.services(s.sid).usAppToPerson.list({ limit: 5 }).catch(() => []);
        if (c.length) { campaign = c.find((x) => String(x.campaignStatus).toUpperCase() === 'VERIFIED') || c[0]; break; }
      }
      if (!campaign) a2p = check('A2P 10DLC', 'ACTION REQUIRED', 'Brand approved, but no campaign registered');
      else a2p = String(campaign.campaignStatus).toUpperCase() === 'VERIFIED' ? check('A2P 10DLC', 'READY', 'Brand approved, campaign verified')
        : check('A2P 10DLC', 'PENDING', `Campaign status ${campaign.campaignStatus}`);
    }
  } catch (e) { a2p.note += ` (${e.message})`; }
  items.push(a2p);

  const worst = items.some((i) => i.state === 'ACTION REQUIRED') ? 'ACTION REQUIRED' : items.some((i) => i.state === 'PENDING') ? 'PENDING' : 'READY';
  await store.setStatus('twilio_number_check', { state: worst });
  return { state: worst, items, expected: exp };
}

// Points the CrashHelp number at THIS deployment. Owner must type the confirmation phrase.
async function pointNumberHere(actor) {
  const client = tw.rawClient();
  if (!client) throw new Error('Twilio credentials missing');
  const num = await findNumber(client);
  if (!num) throw new Error('TWILIO_PHONE_NUMBER is not on this Twilio account');
  const exp = expectedUrls();
  const previous = { voiceUrl: num.voiceUrl || null, smsUrl: num.smsUrl || null, statusCallback: num.statusCallback || null };
  await client.incomingPhoneNumbers(num.sid).update({
    voiceUrl: exp.voice, voiceMethod: 'POST', smsUrl: exp.sms, smsMethod: 'POST',
    statusCallback: exp.status, statusCallbackMethod: 'POST',
  });
  await store.audit(actor, 'twilio_number_repointed', null, { previous, now: exp });
  return { ok: true, previous, now: exp };
}

// ---------- 3. One-tap end-to-end test (TEST MODE only, approved numbers only) ----------
const TEST_LEAD = {
  first_name: 'TEST', last_name: 'CRASHHELP', crash_city: 'Houston', crash_county: 'Harris',
  preferred_contact: 'call', injury_status: 'unsure', medical_status: 'not_yet', vehicle_damage: 'yes',
  source: 'END_TO_END_TEST', utm_source: 'END_TO_END_TEST', utm_campaign: 'CRASHHELP_TEST', campaign: 'CRASHHELP_TEST',
  description: 'SIMULATED TEST LEAD. Not a real accident or a real person.',
  contact_consent: true, consent_text: 'Owner-initiated end-to-end test using an approved test number.',
};

async function closeOpenTestLeads(phone, actor) {
  const open = await db.query(`SELECT lead_id FROM leads WHERE is_test = true AND phone = $1 AND lead_status <> 'CLOSED' AND duplicate_of IS NULL`, [phone]);
  for (const r of open.rows) await leads.setStatus(r.lead_id, 'CLOSED', actor);
  return open.rows.length;
}

async function runE2E({ leadPhoneIndex, kind = 'chain' }, actor) {
  if (!tw.testMode()) throw new Error('Test mode is OFF. The end-to-end test only runs in test mode.');
  const allowed = tw.allowedTestNumbers();
  const phone = allowed[Number(leadPhoneIndex)];
  if (!phone) throw new Error('Pick a number from ALLOWED_TEST_NUMBERS.');
  const steps = [];
  const step = (name, ok, note = '') => steps.push({ name, result: ok === null ? 'WAITING' : ok ? 'PASS' : 'FAIL', note });

  await closeOpenTestLeads(phone, actor); // a fresh run never dedupes against the previous run
  const data = { ...TEST_LEAD, phone, preferred_contact: kind === 'escalation' ? 'text' : 'call' };
  const started = Date.now();
  const r = await leads.intake(data, { actor });
  const id = r.lead_id;
  const lead = await db.one('SELECT * FROM leads WHERE lead_id = $1', [id]);

  step('Database save', !!lead, id);
  step('Lead ID assigned', /^CH-\d{6}-[0-9A-F]{5}$/.test(id), id);
  step('Marked is_test (hidden from real reporting)', lead?.is_test === true);

  if (kind === 'escalation') {
    const tm = (await store.getSettings()).test_escalation_minutes || [1, 2, 3];
    step('0 min: owner alert sent', (r.alerts?.sms || []).some((x) => x.role === 'owner' && x.ok), 'texts the owner now');
    step('Escalation armed', lead?.escalation_level === 0 && !lead?.first_contact_at,
      `TEST timers: "5 min" warning at ${tm[0]} min, "15 min" owner+backup at ${tm[1]} min, "30 min" final + call at ${tm[2]} min. Keep the dashboard open or the 1-minute pinger running. Mark it CONTACTED to prove escalation stops.`);
    return { lead_id: id, kind, steps, elapsed_ms: Date.now() - started };
  }

  // Duplicate check: same phone again must link to the first lead and must NOT re-text the tester.
  const before = (await db.one(`SELECT count(*)::int AS n FROM messages WHERE to_number = $1 AND purpose = 'lead_confirmation' AND status NOT IN ('blocked','failed')`, [phone])).n;
  const again = await leads.intake({ ...data }, { actor });
  const after = (await db.one(`SELECT count(*)::int AS n FROM messages WHERE to_number = $1 AND purpose = 'lead_confirmation' AND status NOT IN ('blocked','failed')`, [phone])).n;
  step('Duplicate check', again.duplicate === true && again.lead_id === id && after === before, 'second submission linked, no second confirmation text');

  const msgs = (await db.query('SELECT purpose, status, error, sid FROM messages WHERE lead_id = $1', [id])).rows;
  const calls = (await db.query('SELECT purpose, status, error, sid FROM calls WHERE lead_id = $1', [id])).rows;
  const ev = (await db.query('SELECT type, detail FROM events WHERE lead_id = $1', [id])).rows;
  const sent = (p) => msgs.find((m) => m.purpose === p);
  const okMsg = (m) => m && m.sid && !['failed', 'blocked', 'undelivered'].includes(m.status);
  const skipped = ev.find((e) => e.type === 'consumer_confirmation_skipped');
  const why = (m) => (m ? `${m.status}${m.error ? ' · ' + m.error : ''}` : skipped ? `skipped: ${skipped.detail.reason}` : 'not attempted');

  step('Confirmation SMS to test number', okMsg(sent('lead_confirmation')), why(sent('lead_confirmation')) + ` → ${maskPhone(phone)}`);
  step('Owner SMS alert', okMsg(sent('owner_alert')), why(sent('owner_alert')));
  const settings = await store.getSettings();
  if (settings.backup_phone) step('Backup SMS alert', okMsg(sent('backup_alert')), why(sent('backup_alert')));
  const oc = calls.find((c) => c.purpose === 'owner_alert');
  step('Owner phone ringing (voice alert placed)', !!(oc && oc.sid && oc.status !== 'failed'), oc ? `${oc.status}. Answer it and press 1.` : 'not attempted');
  step('Email notification', ev.some((e) => e.type === 'email_sent' && /alert/.test(e.detail.purpose || '')), ev.find((e) => e.type === 'email_failed')?.detail.error || '');
  const crmEv = ev.find((e) => e.type === 'crm_synced' || e.type === 'crm_failed');
  const mode = require('./crm').mode();
  step('CRM sync', mode === 'none' ? null : crmEv?.type === 'crm_synced', mode === 'none' ? 'NOT CONNECTED (CRM_MODE=none). Lead kept in dashboard.' : crmEv?.type === 'crm_failed' ? 'failed, queued for retry: ' + crmEv.detail.error : '');
  const listed = await db.one(`SELECT 1 FROM leads WHERE lead_id = $1 AND is_test = true AND duplicate_of IS NULL`, [id]);
  step('Admin dashboard entry (TEST filter)', !!listed);
  const fresh = await db.one('SELECT first_alert_at, created_at FROM leads WHERE lead_id = $1', [id]);
  const alertMs = fresh.first_alert_at ? new Date(fresh.first_alert_at) - new Date(fresh.created_at) : null;
  step('Response timer running', !!fresh.first_alert_at, alertMs !== null ? `first alert ${Math.max(0, Math.round(alertMs / 1000))}s after submit` : 'no alert delivered');
  step('Voice answered → keypress → bridge → connected', null, 'Happens on your phone. Watch this lead\'s timeline: owner_alert_answered → owner_keypress → bridge_dialing → call_connected (with duration).');

  await store.setStatus('last_e2e', { by: actor, lead_id: id, pass: steps.filter((s) => s.result === 'PASS').length, fail: steps.filter((s) => s.result === 'FAIL').length });
  return { lead_id: id, kind, steps, elapsed_ms: Date.now() - started };
}

function allowedForPicker() {
  return tw.allowedTestNumbers().map((n, i) => ({ index: i, label: maskPhone(n) }));
}

module.exports = { envCheck, twilioCheck, pointNumberHere, runE2E, allowedForPicker, expectedUrls };
