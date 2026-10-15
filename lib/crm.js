// CRM adapter. CRM_MODE = ghl | webhook | none (default none).
// GHL endpoints taken from HighLevel's published OpenAPI spec (services.leadconnectorhq.com, Version 2021-07-28):
//   POST /contacts/upsert            (locationId required)
//   POST /contacts/{contactId}/notes (body required)
//   POST /opportunities/             (pipelineId, locationId, name, status, contactId required)
//   PUT  /opportunities/{id}         (pipelineStageId to move stages)
const crypto = require('crypto');
const db = require('./db');
const store = require('./store');

const GHL_BASE = 'https://services.leadconnectorhq.com';
// CrashHelp pipeline in the CRM. Internal statuses map onto these stages.
const STAGES = ['NEW LEAD', 'CONTACT ATTEMPTED', 'CONTACTED', 'QUALIFIED', 'REFERRED / TRANSFERRED', 'FOLLOW-UP', 'CLOSED', 'DO NOT CONTACT'];
function crmStage(lead) {
  if (lead.sms_opt_out) return 'DO NOT CONTACT';
  return {
    'NEW': 'NEW LEAD', 'PENDING CONSENT': 'NEW LEAD', 'NEEDS HUMAN REVIEW': 'NEW LEAD',
    'CONTACT ATTEMPTED': 'CONTACT ATTEMPTED', 'CONTACTED': 'CONTACTED',
    'QUALIFYING': 'QUALIFIED', 'QUALIFIED': 'QUALIFIED', 'APPOINTMENT SET': 'QUALIFIED',
    'REFERRED': 'REFERRED / TRANSFERRED', 'NO RESPONSE': 'FOLLOW-UP',
    'NOT QUALIFIED': 'CLOSED', 'DUPLICATE': 'CLOSED', 'CLOSED': 'CLOSED',
  }[lead.lead_status] || 'NEW LEAD';
}
function leadChannel(lead) {
  if (lead.source === 'inbound_call') return 'call';
  if (lead.source === 'sms_keyword') return 'text';
  if (/^partner/i.test(lead.source || '')) return 'partner_signup';
  return 'form';
}
function followUpStatus(lead) {
  if (lead.sms_opt_out) return 'do not text';
  if (lead.first_contact_at) return 'contacted';
  if (lead.first_response_at) return 'attempted, not reached';
  return 'awaiting first contact';
}

function mode() {
  return (process.env.CRM_MODE || 'none').toLowerCase();
}

function fetchImpl() {
  return global.__crashhelpFetch || fetch;
}

async function ghl(method, path, body) {
  const res = await fetchImpl()(GHL_BASE + path, {
    method,
    headers: {
      Authorization: `Bearer ${process.env.GHL_API_KEY}`,
      Version: '2021-07-28',
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
  if (!res.ok) throw new Error(`GHL ${method} ${path} → ${res.status} ${(data.message || text || '').toString().slice(0, 200)}`);
  return data;
}

function stageMap() {
  try { return JSON.parse(process.env.GHL_STAGE_IDS || '{}'); } catch { return {}; }
}
// The pipeline and its stage IDs are looked up by name (GET /opportunities/pipelines), so only
// GHL_API_KEY + GHL_LOCATION_ID are required. GHL_PIPELINE_ID / GHL_STAGE_IDS still override if set.
let pipelineCache = null;
async function resolvePipeline() {
  if (process.env.GHL_PIPELINE_ID) return { id: process.env.GHL_PIPELINE_ID, stages: {} };
  if (pipelineCache && pipelineCache.at > Date.now() - 10 * 60 * 1000) return pipelineCache;
  const want = (process.env.GHL_PIPELINE_NAME || 'CrashHelp TX').trim().toLowerCase();
  const r = await ghl('GET', `/opportunities/pipelines?locationId=${encodeURIComponent(process.env.GHL_LOCATION_ID)}`);
  const p = (r.pipelines || []).find((x) => String(x.name || '').trim().toLowerCase() === want);
  if (!p) throw new Error(`HighLevel pipeline "${process.env.GHL_PIPELINE_NAME || 'CrashHelp TX'}" not found in this location`);
  const stages = {};
  for (const s of p.stages || []) if (s.name && s.id) stages[String(s.name).trim().toUpperCase()] = s.id;
  pipelineCache = { id: p.id, stages, at: Date.now() };
  return pipelineCache;
}
// GHL_STAGE_IDS may be keyed by CrashHelp stage names ("NEW LEAD", "FOLLOW-UP", ...) or by internal statuses.
function stageIdFor(lead, resolved = { stages: {} }) {
  const m = stageMap();
  const stage = crmStage(lead);
  return m[stage] || m[lead.lead_status] || resolved.stages[stage] || null;
}

function payload(lead) {
  return {
    crm_stage: crmStage(lead), channel: leadChannel(lead), follow_up_status: followUpStatus(lead), is_test: !!lead.is_test,
    utm_medium: lead.utm_medium, utm_content: lead.utm_content, utm_term: lead.utm_term,
    gclid: lead.gclid, fbclid: lead.fbclid, landing_page: lead.landing_page, referrer: lead.referrer, campaign: lead.campaign,
    description: lead.description,
    lead_id: lead.lead_id,
    created_at: lead.created_at,
    status: lead.lead_status,
    priority: lead.lead_priority,
    first_name: lead.first_name, last_name: lead.last_name,
    phone: lead.phone, email: lead.email,
    crash_date: lead.crash_date, crash_city: lead.crash_city, crash_county: lead.crash_county,
    person_type: lead.person_type, injury_status: lead.injury_status, medical_status: lead.medical_status,
    vehicle_damage: lead.vehicle_damage, preferred_contact: lead.preferred_contact,
    contact_consent: lead.contact_consent, sms_opt_out: lead.sms_opt_out,
    source: lead.source, utm_source: lead.utm_source, utm_campaign: lead.utm_campaign,
  };
}

async function syncGhl(lead) {
  for (const k of ['GHL_API_KEY', 'GHL_LOCATION_ID']) if (!process.env[k]) throw new Error(`${k} not set`);
  const loc = process.env.GHL_LOCATION_ID;
  let contactId = lead.crm_contact_id;
  const isNew = !contactId;
  const up = await ghl('POST', '/contacts/upsert', {
    locationId: loc,
    firstName: lead.first_name || undefined,
    lastName: lead.last_name || undefined,
    phone: lead.phone || undefined,
    email: lead.email || undefined,
    city: lead.crash_city || undefined,
    source: 'CrashHelp TX',
    dnd: lead.sms_opt_out ? true : undefined,
    tags: ['crashhelp-tx', `ch-${leadChannel(lead)}`, lead.is_test ? 'crashhelp-test' : null, lead.sms_opt_out ? 'do-not-contact' : null,
      lead.utm_source ? `src-${lead.utm_source}` : null, lead.utm_campaign ? `cmp-${lead.utm_campaign}` : null].filter(Boolean),
  });
  contactId = up.contact?.id || up.id || contactId;
  if (!contactId) throw new Error('GHL upsert returned no contact id');
  // Save right away so a retry after a later failure doesn't add a second note.
  await db.query('UPDATE leads SET crm_contact_id = $2 WHERE lead_id = $1', [lead.lead_id, contactId]);

  if (isNew) {
    const lines = [
      `${lead.is_test ? '[TEST] ' : ''}CrashHelp TX lead ${lead.lead_id} · created ${new Date(lead.created_at).toISOString()} · via ${leadChannel(lead)}`,
      `Crash date: ${lead.crash_date || '—'} · City: ${lead.crash_city || '—'} · County: ${lead.crash_county || '—'}`,
      `Person: ${lead.person_type || '—'} · Injury: ${lead.injury_status || '—'} · Medical: ${lead.medical_status || '—'}`,
      `Vehicle damage: ${lead.vehicle_damage || '—'} · Prefers: ${lead.preferred_contact || '—'}`,
      `Source: ${lead.source || '—'} · utm_source ${lead.utm_source || '—'} · utm_medium ${lead.utm_medium || '—'} · utm_campaign ${lead.utm_campaign || '—'} · utm_content ${lead.utm_content || '—'} · utm_term ${lead.utm_term || '—'}`,
      `gclid: ${lead.gclid || '—'} · fbclid: ${lead.fbclid || '—'} · landing page: ${lead.landing_page || '—'}`,
      `Details: ${lead.description || '—'}`,
      `Consent to contact: ${lead.contact_consent ? 'yes' : 'no'}`,
    ];
    await ghl('POST', `/contacts/${contactId}/notes`, { body: lines.join('\n') });
  }

  const pipeline = await resolvePipeline();
  const stageId = stageIdFor(lead, pipeline);
  let oppId = lead.crm_opportunity_id;
  if (!oppId) {
    const opp = await ghl('POST', '/opportunities/', {
      pipelineId: pipeline.id,
      locationId: loc,
      name: `CrashHelp TX — ${[lead.first_name, lead.last_name].filter(Boolean).join(' ') || lead.phone} (${lead.lead_id})`,
      status: 'open',
      contactId,
      ...(stageId ? { pipelineStageId: stageId } : {}),
    });
    oppId = opp.opportunity?.id || opp.id || null;
  } else if (stageId) {
    await ghl('PUT', `/opportunities/${oppId}`, { pipelineStageId: stageId });
  }
  await db.query('UPDATE leads SET crm_contact_id = $2, crm_opportunity_id = COALESCE($3, crm_opportunity_id), updated_at = now() WHERE lead_id = $1', [lead.lead_id, contactId, oppId]);
}

async function syncWebhook(lead, reason) {
  if (!process.env.CRM_WEBHOOK_URL) throw new Error('CRM_WEBHOOK_URL not set');
  const body = JSON.stringify({ event: reason, lead: payload(lead) });
  const headers = { 'Content-Type': 'application/json' };
  if (process.env.CRM_WEBHOOK_SECRET) {
    headers['X-CrashHelp-Signature'] = crypto.createHmac('sha256', process.env.CRM_WEBHOOK_SECRET).update(body).digest('hex');
  }
  const res = await fetchImpl()(process.env.CRM_WEBHOOK_URL, { method: 'POST', headers, body });
  if (!res.ok) throw new Error(`webhook → ${res.status}`);
}

// Never throws. On failure the lead is queued for retry and the dashboard is alerted.
async function sync(leadId, reason = 'update') {
  if (mode() === 'none') return { ok: true, skipped: true };
  const lead = await db.one('SELECT * FROM leads WHERE lead_id = $1', [leadId]);
  if (!lead) return { ok: false, error: 'lead_not_found' };
  try {
    if (mode() === 'ghl') await syncGhl(lead);
    else if (mode() === 'webhook') await syncWebhook(lead, reason);
    else throw new Error(`unknown CRM_MODE ${mode()}`);
    await store.event(leadId, 'crm_synced', { reason, mode: mode() });
    await store.setStatus('crm', { state: 'WORKING', mode: mode() });
    return { ok: true };
  } catch (e) {
    await db.query('INSERT INTO crm_queue (lead_id, reason, last_error, next_at) VALUES ($1,$2,$3, now() + interval \'1 minute\')', [leadId, reason, e.message]);
    await store.event(leadId, 'crm_failed', { reason, error: e.message });
    await store.setStatus('crm', { state: 'FAILED', mode: mode(), error: e.message });
    return { ok: false, error: e.message, queued: true };
  }
}

// Called by the cron tick. Exponential backoff, gives up after 8 attempts.
async function retryQueue() {
  if (mode() === 'none') return { processed: 0 };
  const due = await db.query('SELECT * FROM crm_queue WHERE done = false AND next_at <= now() AND attempts < 8 ORDER BY id LIMIT 10');
  let ok = 0;
  for (const job of due.rows) {
    const lead = await db.one('SELECT * FROM leads WHERE lead_id = $1', [job.lead_id]);
    try {
      if (!lead) throw new Error('lead_not_found');
      if (mode() === 'ghl') await syncGhl(lead); else await syncWebhook(lead, job.reason);
      await db.query('UPDATE crm_queue SET done = true, attempts = attempts + 1 WHERE id = $1', [job.id]);
      await store.event(job.lead_id, 'crm_synced', { reason: job.reason, retry: true });
      await store.setStatus('crm', { state: 'WORKING', mode: mode() });
      ok++;
    } catch (e) {
      const mins = Math.min(2 ** (job.attempts + 1), 240);
      await db.query(`UPDATE crm_queue SET attempts = attempts + 1, last_error = $2, next_at = now() + make_interval(mins => $3::int) WHERE id = $1`, [job.id, e.message, mins]);
    }
  }
  return { processed: due.rows.length, ok };
}

module.exports = { sync, retryQueue, mode, STAGES, crmStage, leadChannel, payload };
