// Accident report feature: a visitor uploads their own crash documents, gets an organized, citation-backed
// explanation, and can ask for a free attorney review (which becomes a normal lead).
// Compliance lines this code holds (see accident-intel/BLOCKERS.md):
// - The visitor view has no fault verdict, no fault percentage, no case value. The attorney section is
//   never sent to the visitor.
// - Routing never depends on the analysis: a review request goes through leads.intake like any other lead.
// - Personal data is deleted on schedule (30 days, 180 after a review request) or on the visitor's request.
const crypto = require('crypto');
const db = require('./db');
const store = require('./store');
const files = require('./files');
const scan = require('./scan');
const ai = require('./report-ai');
const law = require('./texas-law');
const log = require('./log');

const RETAIN_DAYS = 30;
const RETAIN_REVIEW_DAYS = 180;
const MAX_FILES = 8;
const LIMITS = { // bytes, by content type
  'application/pdf': 20 * 1024 * 1024,
  'image/jpeg': 20 * 1024 * 1024,
  'image/png': 20 * 1024 * 1024,
  'image/webp': 20 * 1024 * 1024,
  'image/heic': 20 * 1024 * 1024,
  'video/mp4': 200 * 1024 * 1024,
  'video/quicktime': 200 * 1024 * 1024,
};
const AI_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'];
const AI_MAX_TOTAL = 22 * 1024 * 1024; // base64 grows ~33%; the API request limit is 32 MB

// Exact consent wording is versioned so the record shows what the person agreed to.
const CONSENT = {
  en: "I'm uploading documents about my own crash. CrashHelp TX will use them to prepare a summary for me. CrashHelp TX is not a law firm, does not give legal advice, does not recommend lawyers, and is paid by participating law firms for advertising. My files are stored privately and deleted after 30 days unless I ask for an attorney review. (v1)",
  es: 'Estoy subiendo documentos sobre mi propio accidente. CrashHelp TX los usará para preparar un resumen para mí. CrashHelp TX no es un bufete de abogados, no da asesoría legal, no recomienda abogados y recibe pago de bufetes participantes por publicidad. Mis archivos se guardan en privado y se borran después de 30 días, a menos que pida una revisión con un abogado. (v1)',
};

function enabledPublicly() {
  return String(process.env.ACCIDENT_INTEL_PUBLIC || '').toLowerCase() === 'true';
}

const sha = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const newId = (prefix) => `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;

function kindOf(type) {
  return type.startsWith('video/') ? 'video' : type.startsWith('image/') ? 'photo' : 'document';
}

function safeName(name) {
  const n = String(name || 'file').replace(/[^\w.\- ]+/g, '').replace(/\s+/g, '_').slice(0, 80);
  return n || 'file';
}

async function startCase({ lang = 'en', consent, ip }) {
  if (consent !== true) throw httpError(400, 'Please check the box to agree before uploading.');
  const l = lang === 'es' ? 'es' : 'en';
  const caseId = newId('RPT');
  const token = crypto.randomBytes(24).toString('base64url');
  await db.query(
    `INSERT INTO report_cases (case_id, token_hash, lang, consent_text, consent_at, ip_hash, delete_after)
     VALUES ($1,$2,$3,$4,now(),$5, now() + make_interval(days => $6::int))`,
    [caseId, sha(token), l, CONSENT[l], ip ? sha('ip:' + ip).slice(0, 16) : null, RETAIN_DAYS]
  );
  await store.audit('visitor', 'report_case_started', null, { case_id: caseId, lang: l });
  return { case_id: caseId, token };
}

// Loads a case for its visitor. The token is the only key; a wrong token looks like a missing case.
async function forVisitor(caseId, token) {
  const c = await db.one('SELECT * FROM report_cases WHERE case_id = $1', [String(caseId || '').slice(0, 40)]);
  if (!c || !token || c.token_hash !== sha(token) || c.deleted_at) throw httpError(404, 'This report link has expired or was deleted.');
  return c;
}

async function requestUpload(c, { name, type, size }) {
  const contentType = String(type || '').toLowerCase();
  const bytes = Number(size);
  if (!LIMITS[contentType]) throw httpError(400, 'That file type is not supported. Use PDF, JPG, PNG, HEIC, MP4 or MOV.');
  if (!Number.isFinite(bytes) || bytes <= 0) throw httpError(400, 'Empty file.');
  if (bytes > LIMITS[contentType]) throw httpError(400, `That file is too large (limit ${Math.round(LIMITS[contentType] / 1048576)} MB).`);
  const count = await db.one("SELECT count(*)::int AS n FROM report_files WHERE case_id = $1 AND status <> 'DELETED'", [c.case_id]);
  if (count.n >= MAX_FILES) throw httpError(400, `You can upload up to ${MAX_FILES} files.`);
  if (!files.configured()) throw httpError(503, 'Uploads are not available right now. Please call us instead.');

  const fileId = newId('F');
  const pathname = `reports/${c.case_id}/${fileId}-${safeName(name)}`;
  const url = await files.uploadUrl(pathname, { contentType, maxBytes: bytes });
  await db.query(
    `INSERT INTO report_files (file_id, case_id, pathname, name, content_type, size_bytes, kind) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [fileId, c.case_id, pathname, safeName(name), contentType, bytes, kindOf(contentType)]
  );
  return { file_id: fileId, upload_url: url, method: 'PUT', headers: { 'Content-Type': contentType } };
}

// After the browser's PUT finishes: read the bytes back from private storage and check them.
async function confirmUpload(c, fileId) {
  const f = await db.one('SELECT * FROM report_files WHERE file_id = $1 AND case_id = $2', [String(fileId || ''), c.case_id]);
  if (!f) throw httpError(404, 'File not found.');
  if (f.status !== 'PENDING') return { file_id: f.file_id, status: f.status };
  let got = null;
  try { got = await files.read(f.pathname, { maxBytes: LIMITS[f.content_type] }); } catch (e) { log.error('report upload read failed', e, { kind: f.file_id }); }
  if (!got) throw httpError(400, 'The upload did not finish. Please try again.');
  // Videos are checked on their header only; reading 200 MB into a function is not worth it.
  const res = scan.check(got.bytes, f.content_type);
  if (!res.ok || got.size > LIMITS[f.content_type]) {
    await files.remove(f.pathname).catch(() => {});
    await db.query("UPDATE report_files SET status = 'REJECTED', scan_detail = $2, deleted_at = now() WHERE file_id = $1", [f.file_id, res.reason || 'too_large']);
    await store.audit('system', 'report_file_rejected', null, { case_id: c.case_id, file_id: f.file_id, reason: res.reason || 'too_large' });
    return { file_id: f.file_id, status: 'REJECTED', reason: res.reason || 'too_large' };
  }
  await db.query("UPDATE report_files SET status = 'CLEAN', scan_level = $2, size_bytes = $3 WHERE file_id = $1", [f.file_id, res.level, got.size]);
  return { file_id: f.file_id, status: 'CLEAN' };
}

async function runAnalysis(c, { description = '' } = {}) {
  const desc = String(description || '').replace(/[<>]/g, '').slice(0, 4000);
  const clean = (await db.query("SELECT * FROM report_files WHERE case_id = $1 AND status = 'CLEAN' ORDER BY created_at", [c.case_id])).rows;
  const readable = clean.filter((f) => AI_TYPES.includes(f.content_type));
  if (!readable.length && !desc) throw httpError(400, 'Upload your crash report or photos, or describe what happened.');

  const inputs = [];
  let total = 0;
  for (const f of readable) {
    if (total + Number(f.size_bytes) > AI_MAX_TOTAL) break;
    const got = await files.read(f.pathname);
    if (got) { inputs.push({ bytes: got.bytes, contentType: f.content_type, name: f.name }); total += got.size; }
  }
  await db.query("UPDATE report_cases SET status = 'ANALYZING', description = $2, updated_at = now() WHERE case_id = $1", [c.case_id, desc || null]);
  try {
    const out = await ai.analyze({ files: inputs, description: desc });
    await db.query(
      "UPDATE report_cases SET status = 'READY', analysis = $2, analysis_model = $3, analysis_at = now(), analysis_error = NULL, updated_at = now() WHERE case_id = $1",
      [c.case_id, JSON.stringify(out.result), out.model || null]
    );
    await store.audit('system', 'report_analyzed', c.lead_id, { case_id: c.case_id, files: inputs.length, skipped: readable.length - inputs.length, model: out.model || null });
    return publicView({ ...c, analysis: out.result, status: 'READY' }, clean);
  } catch (e) {
    const code = /ai_not_configured|ai_refused|ai_output_too_long/.test(e.message) ? e.message : 'ai_error';
    await db.query("UPDATE report_cases SET status = 'FAILED', analysis_error = $2, updated_at = now() WHERE case_id = $1", [c.case_id, code]);
    log.error('report analysis failed', e, { kind: c.case_id });
    throw httpError(502, 'We could not read your documents right now. Please call us and we will help.');
  }
}

// ---------- What the visitor sees ----------
// Masks ID-like numbers (license, policy, VIN, plate) and phone numbers in any text shown to the visitor,
// in case the model echoed one despite its instructions.
const ID_LIKE = /\b(?=(?:[A-Z]*\d){5})[A-Z0-9]{7,}\b/gi;
const PHONE = /\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g;
function scrub(v) {
  if (typeof v === 'string') return v.replace(PHONE, '•••-•••-••••').replace(ID_LIKE, (m) => '•'.repeat(Math.max(0, m.length - 2)) + m.slice(-2));
  if (Array.isArray(v)) return v.map(scrub);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
  return v;
}

const isFact = (f) => f && typeof f === 'object' && 'basis' in f;
const keepFact = (f) => (isFact(f) ? { value: String(f.value || ''), basis: ai.BASIS.includes(f.basis) ? f.basis : 'unknown', source: String(f.source || '') } : { value: '', basis: 'unknown', source: '' });

function publicView(c, fileRows = []) {
  const a = c.analysis || null;
  const base = {
    case_id: c.case_id, status: c.status, lang: c.lang,
    files: fileRows.map((f) => ({ file_id: f.file_id, name: f.name, kind: f.kind, status: f.status })),
    delete_after: c.delete_after, review_requested: !!c.review_requested_at,
  };
  if (!a) return base;
  const crashDate = a.overview && isFact(a.overview.crash_date) && a.overview.crash_date.basis !== 'unknown' ? String(a.overview.crash_date.value || '').slice(0, 10) : '';
  const view = {
    document_type: a.document_type,
    overview: Object.fromEntries(Object.entries(a.overview || {}).map(([k, f]) => [k, keepFact(f)])),
    parties: (a.parties || []).map((p) => ({
      label: String(p.label || ''), role: p.role,
      vehicle: keepFact(p.vehicle), commercial_vehicle: keepFact(p.commercial_vehicle), insurer_named: keepFact(p.insurer_named),
      cited: keepFact(p.cited), injuries_reported: keepFact(p.injuries_reported), likely_the_uploader: p.likely_the_uploader,
    })),
    narrative: keepFact(a.narrative),
    diagram: keepFact(a.diagram),
    conditions: Object.fromEntries(Object.entries(a.conditions || {}).map(([k, f]) => [k, keepFact(f)])),
    officer_findings: {
      contributing_factors: (a.officer_findings?.contributing_factors || []).map(keepFact),
      citations_issued: (a.officer_findings?.citations_issued || []).map(keepFact),
      observations: (a.officer_findings?.observations || []).map(keepFact),
    },
    witnesses: (a.witnesses || []).map((w) => ({ label: String(w.label || ''), account: keepFact(w.account) })),
    conflicts: (a.conflicts || []).map(String),
    missing_info: (a.missing_info || []).map(String),
    evidence_checklist: (a.evidence_checklist || []).map((e) => ({ item: String(e.item || ''), why: String(e.why || ''), status: e.status })),
    laws: law.resolve(a.laws, { audience: 'public' }).map(({ id, cite, title, url, summary, why, verified_on }) => ({ id, cite, title, url, summary, why, verified_on })),
    deadline: crashDate && law.generalDeadline(crashDate) ? {
      crash_date: crashDate, general_deadline: law.generalDeadline(crashDate), cite: law.BY_ID['CP-16.003'].cite, url: law.BY_ID['CP-16.003'].url,
      note: 'General two-year rule only. Exceptions can make it shorter or longer — confirm your exact deadline with a lawyer.',
    } : null,
    questions_for_lawyer: (a.questions_for_lawyer || []).map(String),
  };
  return { ...base, result: scrub(view), disclaimer: 'CrashHelp TX is not a law firm and this is not legal advice. It organizes what your documents say and points to Texas laws that commonly come up. It does not decide who is at fault or what a claim is worth.' };
}

async function visitorResult(c) {
  const rows = (await db.query("SELECT * FROM report_files WHERE case_id = $1 AND status <> 'DELETED' ORDER BY created_at", [c.case_id])).rows;
  return publicView(c, rows);
}

// "Free attorney review": becomes an ordinary lead. Which firm gets it does not depend on the analysis.
async function requestReview(c, raw) {
  const leads = require('./leads');
  if (raw.contact_consent !== true && raw.contact_consent !== 'true') throw httpError(400, 'Please agree to be contacted so an attorney can review your report.');
  const crashDate = c.analysis?.overview?.crash_date;
  const data = leads.parseForm({
    ...raw,
    source: 'accident-report',
    crash_date: crashDate && crashDate.basis === 'report_states' ? String(crashDate.value || '').slice(0, 10) : raw.crash_date,
    description: `Uploaded crash report ${c.case_id} for attorney review.${raw.description ? ' ' + raw.description : ''}`,
  });
  if (!data.phone && !data.email) throw httpError(400, 'Enter a valid phone number or email so we can reach you.');
  if (!data.first_name) throw httpError(400, 'Enter your first name.');
  const result = await leads.intake(data, { actor: 'report_review' });
  await db.query(
    `UPDATE report_cases SET review_requested_at = now(), review_consent_text = $2, lead_id = $3,
       delete_after = greatest(delete_after, now() + make_interval(days => $4::int)), updated_at = now() WHERE case_id = $1`,
    [c.case_id, String(raw.consent_text || '').slice(0, 600), result.lead_id, RETAIN_REVIEW_DAYS]
  );
  await store.audit('visitor', 'report_review_requested', result.lead_id, { case_id: c.case_id });
  return { ok: true, lead_id: result.lead_id };
}

// Deletes files from storage and personal data from the row. Keeps ids/timestamps for the audit trail.
async function purge(caseId, actor) {
  const rows = (await db.query("SELECT pathname FROM report_files WHERE case_id = $1 AND status <> 'DELETED'", [caseId])).rows;
  await files.remove(rows.map((r) => r.pathname));
  await db.query("UPDATE report_files SET status = 'DELETED', deleted_at = now(), name = NULL WHERE case_id = $1", [caseId]);
  await db.query(
    `UPDATE report_cases SET status = 'DELETED', deleted_at = now(), deleted_by = $2, description = NULL, analysis = NULL,
       consent_text = '[deleted]', review_consent_text = NULL, ip_hash = NULL, updated_at = now() WHERE case_id = $1`,
    [caseId, actor]
  );
  await store.audit(actor, 'report_case_deleted', null, { case_id: caseId, files: rows.length });
  return { deleted: rows.length };
}

// Cron step: delete everything past its retention date. Abandoned uploads go too.
async function purgeExpired() {
  const due = (await db.query('SELECT case_id FROM report_cases WHERE deleted_at IS NULL AND delete_after <= now() LIMIT 50')).rows;
  let n = 0;
  for (const r of due) {
    try { await purge(r.case_id, 'retention'); n++; } catch (e) { log.error('report purge failed', e, { kind: r.case_id }); }
  }
  return { purged: n };
}

// ---------- Staff / attorney view ----------
async function listCases({ limit = 50 } = {}) {
  const r = await db.query(
    `SELECT c.case_id, c.created_at, c.status, c.lang, c.review_requested_at, c.lead_id, c.delete_after, c.deleted_at, c.analysis_error,
            c.analysis->>'document_type' AS document_type,
            (SELECT count(*)::int FROM report_files f WHERE f.case_id = c.case_id AND f.status = 'CLEAN') AS files
       FROM report_cases c ORDER BY (c.review_requested_at IS NULL), c.created_at DESC LIMIT $1`,
    [Math.min(Number(limit) || 50, 200)]
  );
  return r.rows;
}

async function staffCase(caseId, user) {
  const c = await db.one('SELECT * FROM report_cases WHERE case_id = $1', [String(caseId || '')]);
  if (!c) throw httpError(404, 'Not found');
  const rows = (await db.query('SELECT file_id, name, kind, content_type, size_bytes, status, scan_level, scan_detail, created_at FROM report_files WHERE case_id = $1 ORDER BY created_at', [c.case_id])).rows;
  await store.audit(user.name, 'report_case_viewed', c.lead_id, { case_id: c.case_id });
  const a = c.analysis;
  return {
    case: { case_id: c.case_id, created_at: c.created_at, status: c.status, lang: c.lang, lead_id: c.lead_id, review_requested_at: c.review_requested_at,
      consent_text: c.consent_text, consent_at: c.consent_at, review_consent_text: c.review_consent_text, delete_after: c.delete_after, deleted_at: c.deleted_at,
      analysis_model: c.analysis_model, analysis_at: c.analysis_at, analysis_error: c.analysis_error, description: c.description },
    files: rows,
    visitor_view: a ? publicView(c, rows).result : null,
    attorney: a ? {
      notice: 'Preliminary AI research for attorney review. Not legal advice; verify every fact against the original documents.',
      liability_issues: a.attorney?.liability_issues || [],
      comparative_responsibility_issues: a.attorney?.comparative_responsibility_issues || [],
      insurance_questions: a.attorney?.insurance_questions || [],
      open_questions: a.attorney?.open_questions || [],
      evidence_to_obtain: a.attorney?.evidence_to_obtain || [],
      laws: law.resolve(a.laws, { audience: 'attorney' }),
      conflicts: a.conflicts || [],
    } : null,
  };
}

async function staffFileUrl(caseId, fileId, user) {
  const f = await db.one("SELECT * FROM report_files WHERE case_id = $1 AND file_id = $2 AND status = 'CLEAN'", [String(caseId || ''), String(fileId || '')]);
  if (!f) throw httpError(404, 'File not available');
  await store.audit(user.name, 'report_file_opened', null, { case_id: caseId, file_id: fileId });
  return { url: await files.viewUrl(f.pathname), expires_minutes: files.VIEW_MINUTES };
}

function httpError(status, message) {
  const e = new Error(message); e.status = status; return e;
}

module.exports = {
  enabledPublicly, startCase, forVisitor, requestUpload, confirmUpload, runAnalysis, visitorResult, requestReview,
  purge, purgeExpired, listCases, staffCase, staffFileUrl, publicView, scrub, CONSENT, LIMITS, MAX_FILES, RETAIN_DAYS, RETAIN_REVIEW_DAYS,
};
