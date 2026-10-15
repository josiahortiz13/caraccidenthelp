// Lead intake + instant response. Order matters: the lead is saved BEFORE any integration runs,
// and each integration is isolated so one failure never drops the lead or blocks the others.
const db = require('./db');
const store = require('./store');
const tw = require('./twilio');
const email = require('./email');
const crm = require('./crm');
const { clean, normalizePhone, normalizeEmail, oneOf, truthy, newLeadId, fill, baseUrl, xmlEscape } = require('./util');

const STATUSES = ['NEW', 'PENDING CONSENT', 'CONTACT ATTEMPTED', 'CONTACTED', 'QUALIFYING', 'QUALIFIED', 'NEEDS HUMAN REVIEW',
  'APPOINTMENT SET', 'REFERRED', 'NOT QUALIFIED', 'DUPLICATE', 'NO RESPONSE', 'CLOSED'];
const OPEN_STATUSES = ['NEW', 'PENDING CONSENT', 'CONTACT ATTEMPTED'];
const PRIORITIES = ['HIGH PRIORITY', 'NORMAL PRIORITY', 'LOW INFORMATION'];

const CONSUMER_CONFIRMATION =
  'Hi {{first_name}}, this is CrashHelp TX. We received your request. Keep any photos, insurance information, report details, and other records you have. Someone will review your request and follow up shortly. Reply STOP to opt out.';

const OWNER_ALERT =
`🚨 NEW CRASHHELP TX LEAD

Name: {{first_name}} {{last_name}}
Phone: {{phone}}
Crash Date: {{crash_date}}
City: {{crash_city}}
County: {{crash_county}}
Injury: {{injury_status}}
Medical Care: {{medical_status}}
Vehicle Damage: {{vehicle_damage}}
Preferred Contact: {{preferred_contact}}
Source: {{utm_source}}
Campaign: {{utm_campaign}}
Priority: {{lead_priority}}
Lead ID: {{lead_id}}

CALL NOW:
{{phone}}

Admin:
{{admin_url}}`;

function adminUrl(leadId) {
  return `${baseUrl()}/admin#${encodeURIComponent(leadId)}`;
}

function fmtDate(d) {
  if (!d) return '';
  const x = d instanceof Date ? d : new Date(d);
  return isNaN(x) ? String(d) : x.toISOString().slice(0, 10);
}

function priorityFor(l) {
  const hasContact = !!(l.phone || l.email);
  const answered = ['injury_status', 'medical_status', 'crash_date', 'crash_city'].filter((k) => l[k]).length;
  if (!hasContact || answered < 2) return 'LOW INFORMATION';
  const recent = l.crash_date ? (Date.now() - new Date(l.crash_date).getTime()) / 864e5 <= 30 : false;
  if (l.injury_status === 'yes' && (recent || l.medical_status === 'yes')) return 'HIGH PRIORITY';
  return 'NORMAL PRIORITY';
}

// Accepts the new form fields and the old site's form fields (name, city, when, desc).
function parseForm(raw) {
  let first = clean(raw.first_name, 60);
  let last = clean(raw.last_name, 60);
  if (!first && raw.name) {
    const parts = clean(raw.name, 120).split(' ');
    first = parts.shift() || '';
    last = last || parts.join(' ');
  }
  const crashDate = clean(raw.crash_date, 10);
  return {
    first_name: first,
    last_name: last,
    phone: normalizePhone(raw.phone),
    email: normalizeEmail(raw.email),
    crash_date: /^\d{4}-\d{2}-\d{2}$/.test(crashDate) && !isNaN(new Date(crashDate)) ? crashDate : null,
    crash_city: clean(raw.crash_city || raw.city, 80),
    crash_county: clean(raw.crash_county, 80),
    person_type: oneOf(raw.person_type, ['driver', 'passenger', 'pedestrian', 'cyclist', 'other']),
    injury_status: oneOf(raw.injured ?? raw.injury_status, ['yes', 'no', 'unsure']),
    medical_status: oneOf(raw.medical_care ?? raw.medical_status, ['yes', 'no', 'not_yet']),
    vehicle_damage: oneOf(raw.vehicle_damage, ['yes', 'no']),
    other_vehicle: oneOf(raw.other_vehicle, ['yes', 'no']),
    insurance_available: oneOf(raw.insurance_info ?? raw.insurance_available, ['yes', 'no', 'unsure']),
    description: clean(raw.description || raw.desc || (raw.when ? `When: ${raw.when}` : ''), 1500),
    preferred_contact: oneOf(raw.preferred_contact, ['call', 'text', 'email'], 'call'),
    contact_consent: truthy(raw.contact_consent),
    marketing_consent: truthy(raw.marketing_consent),
    consent_text: clean(raw.consent_text, 600),
    utm_source: clean(raw.utm_source, 100),
    utm_medium: clean(raw.utm_medium, 100),
    utm_campaign: clean(raw.utm_campaign, 150),
    utm_content: clean(raw.utm_content, 150),
    utm_term: clean(raw.utm_term, 150),
    gclid: clean(raw.gclid, 200),
    fbclid: clean(raw.fbclid, 300),
    ad_id: clean(raw.ad_id, 100),
    landing_page: clean(raw.landing_page, 300),
    referrer: clean(raw.referrer, 300),
    source: clean(raw.source, 60) || 'web_form',
    campaign: clean(raw.campaign, 100),
  };
}

async function findDuplicate(l) {
  if (!l.phone && !l.email) return null;
  return db.one(
    `SELECT * FROM leads
     WHERE duplicate_of IS NULL AND lead_status <> 'CLOSED' AND is_test = $3
       AND created_at > now() - interval '30 days'
       AND ((phone <> '' AND phone = $1) OR (email <> '' AND lower(email) = $2))
     ORDER BY created_at ASC LIMIT 1`,
    [l.phone || '__none__', l.email || '__none__', !!l.is_test]
  );
}

const COLS = ['lead_id', 'source', 'campaign', 'ad_id', 'keyword', 'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'gclid', 'fbclid', 'landing_page', 'referrer', 'first_name', 'last_name', 'phone', 'email', 'crash_date', 'crash_city', 'crash_county',
  'person_type', 'injury_status', 'medical_status', 'vehicle_damage', 'other_vehicle', 'insurance_available', 'description',
  'preferred_contact', 'contact_consent', 'marketing_consent', 'consent_text', 'lead_priority', 'lead_status', 'duplicate_of', 'sms_opt_out', 'is_test'];

async function insertLead(l) {
  const BOOLS = ['contact_consent', 'marketing_consent', 'sms_opt_out', 'is_test'];
  const vals = COLS.map((c) => (BOOLS.includes(c) ? !!l[c] : (l[c] === undefined ? null : l[c])));
  await db.query(`INSERT INTO leads (${COLS.join(',')}) VALUES (${COLS.map((_, i) => '$' + (i + 1)).join(',')})`, vals);
}

// ---------- Internal alerts ----------

async function alertTargets(settings, who) {
  const out = [];
  if (who.includes('owner') && settings.primary_phone) out.push({ role: 'owner', phone: settings.primary_phone, email: settings.primary_email });
  if (who.includes('backup') && settings.backup_phone) out.push({ role: 'backup', phone: settings.backup_phone, email: settings.backup_email });
  if (who.includes('backup') && !settings.backup_phone && settings.backup_email) out.push({ role: 'backup', phone: '', email: settings.backup_email });
  return out;
}

function alertVars(lead) {
  return {
    ...lead,
    crash_date: fmtDate(lead.crash_date),
    utm_source: lead.utm_source || lead.source,
    injury_status: lead.injury_status, medical_status: lead.medical_status,
    admin_url: adminUrl(lead.lead_id),
  };
}

function alertEmailHtml(lead, heading) {
  const v = alertVars(lead);
  const rows = [['Name', `${v.first_name || ''} ${v.last_name || ''}`], ['Phone', v.phone], ['Email', v.email], ['Crash date', v.crash_date],
    ['City', v.crash_city], ['County', v.crash_county], ['Injury', v.injury_status], ['Medical care', v.medical_status],
    ['Vehicle damage', v.vehicle_damage], ['Preferred contact', v.preferred_contact], ['Source', v.utm_source],
    ['Campaign', v.utm_campaign], ['Priority', v.lead_priority], ['Lead ID', v.lead_id]];
  return `<div style="font-family:Arial,sans-serif;max-width:520px">
  <h2 style="color:#c8102e;margin:0 0 12px">${xmlEscape(heading)}</h2>
  <table style="border-collapse:collapse;width:100%">${rows.map(([k, val]) =>
    `<tr><td style="padding:6px 8px 6px 0;color:#666;font-weight:bold">${k}</td><td style="padding:6px 0">${xmlEscape(val || '—')}</td></tr>`).join('')}</table>
  <p style="margin-top:20px"><a href="${v.admin_url}" style="background:#c8102e;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none;font-weight:bold">Open in dashboard</a></p>
  <p style="color:#888;font-size:12px">Sign-in required. Lead details stay in the dashboard.</p></div>`;
}

async function alertNewLead(lead, settings, { repeat = false } = {}) {
  const results = { sms: [], email: [], voice: null };
  const partner = /^partner/i.test(lead.source || '');
  const heading = (lead.is_test ? '🧪 TEST — ' : '') + (partner ? '🤝 NEW CRASHHELP PARTNER SIGNUP' : repeat ? '🔁 REPEAT CRASHHELP TX SUBMISSION' : '🚨 NEW CRASHHELP TX LEAD');
  const smsBody = fill(OWNER_ALERT, alertVars(lead)).replace('🚨 NEW CRASHHELP TX LEAD', heading);
  const targets = await alertTargets(settings, ['owner', 'backup']);

  if (settings.sms_alert) {
    for (const t of targets.filter((x) => x.phone)) {
      results.sms.push({ role: t.role, ...(await tw.sendSms({ to: t.phone, body: smsBody, leadId: lead.lead_id, kind: 'internal', purpose: `${t.role}_alert` })) });
    }
  }
  if (settings.email_alert) {
    const subject = `${lead.is_test ? '🧪 TEST — ' : ''}${repeat ? '🔁 Repeat' : '🚨 New'} CrashHelp TX Lead — ${lead.first_name || 'Unknown'} — ${lead.crash_city || 'TX'}`;
    for (const t of targets.filter((x) => x.email)) {
      results.email.push({ role: t.role, ...(await email.send({ to: t.email, subject, html: alertEmailHtml(lead, heading), text: smsBody, leadId: lead.lead_id, purpose: `${t.role}_alert_email` })) });
    }
  }
  const wantsVoice = settings.voice_alert && !repeat && !partner && (settings.voice_alert_for === 'all_leads' || lead.preferred_contact === 'call');
  if (wantsVoice && settings.primary_phone) {
    results.voice = await tw.placeCall({
      to: settings.primary_phone, purpose: 'owner_alert', leadId: lead.lead_id, machineDetection: true,
      twimlQuery: `r=owner-alert&lead=${encodeURIComponent(lead.lead_id)}`,
    });
  }

  const anyDelivered = results.sms.some((r) => r.ok) || results.email.some((r) => r.ok) || results.voice?.ok;
  if (anyDelivered) {
    await db.query('UPDATE leads SET first_alert_at = COALESCE(first_alert_at, now()) WHERE lead_id = $1', [lead.lead_id]);
    await store.event(lead.lead_id, 'internal_alert_sent', { sms: results.sms.filter((r) => r.ok).length, email: results.email.filter((r) => r.ok).length, voice: !!results.voice?.ok });
  } else {
    await store.event(lead.lead_id, 'internal_alert_failed', { note: 'No alert channel delivered. Lead is on the dashboard.' });
    await store.setStatus('alert_failure', { lead_id: lead.lead_id, note: 'No alert channel delivered for this lead' });
  }
  return results;
}

async function confirmConsumer(lead, settings) {
  const out = { sms: null, email: null };
  if (!lead.contact_consent) {
    await store.event(lead.lead_id, 'consumer_confirmation_skipped', { reason: 'no_contact_consent' });
    return out;
  }
  if (settings.consumer_confirmation_sms && lead.phone && !lead.sms_opt_out) {
    const recent = await db.one(
      `SELECT 1 FROM messages WHERE lead_id = $1 AND purpose = 'lead_confirmation' AND status <> 'blocked' AND status <> 'failed' AND created_at > now() - interval '24 hours'`, [lead.lead_id]);
    if (recent) {
      await store.event(lead.lead_id, 'consumer_confirmation_skipped', { reason: 'already_confirmed_24h' });
    } else {
      out.sms = await tw.sendSms({ to: lead.phone, body: fill(CONSUMER_CONFIRMATION, { first_name: lead.first_name || 'there' }), leadId: lead.lead_id, kind: 'consumer', purpose: 'lead_confirmation' });
    }
  }
  if (settings.consumer_confirmation_email && lead.email) {
    out.email = await email.send({
      to: lead.email, leadId: lead.lead_id, purpose: 'lead_confirmation_email',
      subject: 'We received your CrashHelp TX request',
      text: `Hi ${lead.first_name || 'there'},\n\nWe received your CrashHelp TX request. Someone will review it and follow up.\n\nWhile you wait:\n- Stay safe and get medical attention if you need it.\n- Save photos of the scene, vehicles and any injuries.\n- Save insurance information for everyone involved.\n- Save the crash report number and officer details if you have them.\n- Keep receipts, bills and other records related to the crash.\n\nCrashHelp TX is a referral service, not a law firm, and this email is not legal advice. Submitting a request does not create an attorney-client relationship.\n\nCrashHelp TX`,
    });
  }
  return out;
}

const TEST_MARKERS = ['end_to_end_test', 'crashhelp_test'];
function isTestLead(l) {
  const marked = [l.source, l.utm_source, l.utm_campaign, l.campaign].some((v) => TEST_MARKERS.includes(String(v || '').toLowerCase()));
  return marked && !!l.phone && tw.allowedTestNumbers().includes(l.phone);
}

// Main entry for any opt-in lead (form, SMS flow, ad form webhook).
async function intake(data, { actor = 'system', notify = true } = {}) {
  const settings = await store.getSettings();
  const lead = { ...data, lead_id: newLeadId(), lead_status: data.lead_status || 'NEW' };
  if (lead.phone) {
    const o = await db.one('SELECT opted_out_at FROM opt_outs WHERE phone = $1', [lead.phone]);
    if (o) lead.sms_opt_out = true;
  }
  lead.lead_priority = priorityFor(lead);
  lead.is_test = isTestLead(lead);
  // Tow/body-shop partner signups share the form endpoint but are businesses, not crash leads:
  // never texted as consumers, never escalated, tagged separately in the CRM.
  lead.is_partner = /^partner/i.test(lead.source || '');
  if (lead.is_partner) { lead.lead_status = 'NEEDS HUMAN REVIEW'; lead.contact_consent = false; lead.lead_priority = 'NORMAL PRIORITY'; }

  const dup = await findDuplicate(lead);  // is_test already set above
  if (dup) {
    lead.duplicate_of = dup.lead_id;
    lead.lead_status = 'DUPLICATE';
  }

  // STEP A–C: save first. If this throws, the caller still emails the raw submission.
  await insertLead(lead);
  await store.event(lead.lead_id, 'lead_created', { source: lead.source, duplicate_of: lead.duplicate_of || null }, actor);

  // From here on the lead is saved. A failure in any later step must not be reported as "not saved":
  // it is logged, and the escalation timer + CRM retry queue pick the lead up again.
  try {
    return await afterSave(lead, dup, settings, notify);
  } catch (e) {
    console.error('post-save step failed (lead is saved)', lead.lead_id, e.message);
    await store.event(lead.lead_id, 'post_save_failed', { error: e.message });
    return { lead_id: lead.lead_id, saved: true, post_save_error: e.message };
  }
}

async function afterSave(lead, dup, settings, notify) {

  if (dup && !notify) {
    await store.event(dup.lead_id, 'repeat_contact', { new_lead_id: lead.lead_id, source: lead.source });
    return { lead_id: dup.lead_id, duplicate: true, submission_id: lead.lead_id };
  }
  if (dup) {
    await store.event(dup.lead_id, 'repeat_submission', { new_lead_id: lead.lead_id, source: lead.source });
    await db.query('UPDATE leads SET updated_at = now() WHERE lead_id = $1', [dup.lead_id]);
    // Merge any newly provided consent onto the original so staff can contact them.
    if (lead.contact_consent && !dup.contact_consent) await db.query('UPDATE leads SET contact_consent = true WHERE lead_id = $1', [dup.lead_id]);
    const original = await db.one('SELECT * FROM leads WHERE lead_id = $1', [dup.lead_id]);
    const alerts = await alertNewLead(original, settings, { repeat: true });
    const confirmation = await confirmConsumer(original, settings);
    return { lead_id: dup.lead_id, duplicate: true, submission_id: lead.lead_id, alerts, confirmation };
  }

  // STEP D–F: confirmation, owner + backup alerts (+ voice), CRM. Isolated from each other.
  const confirmation = notify ? await confirmConsumer(lead, settings) : null;
  const alerts = notify ? await alertNewLead(lead, settings) : null;
  const crmResult = await crm.sync(lead.lead_id, 'lead_created');
  return { lead_id: lead.lead_id, duplicate: false, confirmation, alerts, crm: crmResult };
}

async function setStatus(leadId, status, actor) {
  if (!STATUSES.includes(status)) throw new Error('invalid status');
  const lead = await db.one('SELECT * FROM leads WHERE lead_id = $1', [leadId]);
  if (!lead) throw new Error('lead not found');
  const contacted = ['CONTACTED', 'QUALIFYING', 'QUALIFIED', 'APPOINTMENT SET', 'REFERRED'].includes(status);
  await db.query(
    `UPDATE leads SET lead_status = $2, updated_at = now(),
       first_contact_at = CASE WHEN $3::boolean THEN COALESCE(first_contact_at, now()) ELSE first_contact_at END,
       first_response_at = CASE WHEN $3::boolean OR $2::text = 'CONTACT ATTEMPTED' THEN COALESCE(first_response_at, now()) ELSE first_response_at END,
       last_contact_at = CASE WHEN $3::boolean THEN now() ELSE last_contact_at END,
       appointment_at = CASE WHEN $2::text = 'APPOINTMENT SET' THEN COALESCE(appointment_at, now()) ELSE appointment_at END,
       appointment_status = CASE WHEN $2::text = 'APPOINTMENT SET' THEN 'set' ELSE appointment_status END,
       referral_status = CASE WHEN $2::text = 'REFERRED' THEN 'referred' ELSE referral_status END
     WHERE lead_id = $1`,
    [leadId, status, contacted]
  );
  await store.event(leadId, 'status_changed', { from: lead.lead_status, to: status }, actor);
  await store.audit(actor, 'status_changed', leadId, { from: lead.lead_status, to: status });
  await crm.sync(leadId, 'status_changed');
}

async function markAttempt(leadId, channel, actor) {
  await db.query(
    `UPDATE leads SET first_response_at = COALESCE(first_response_at, now()), last_contact_at = now(), updated_at = now(),
       lead_status = CASE WHEN lead_status IN ('NEW','PENDING CONSENT') THEN 'CONTACT ATTEMPTED' ELSE lead_status END
     WHERE lead_id = $1`, [leadId]);
  await store.event(leadId, 'contact_attempt', { channel }, actor);
  await crm.sync(leadId, 'contact_attempt');
}

module.exports = {
  intake, parseForm, isTestLead, setStatus, markAttempt, alertNewLead, adminUrl, fmtDate, alertTargets,
  STATUSES, OPEN_STATUSES, PRIORITIES, CONSUMER_CONFIRMATION,
};
