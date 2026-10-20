// Server logs carry lead IDs and operational errors only. Never names, phone numbers, emails or form contents.
// redact() is a safety net for error messages that might echo data back (e.g. a database error quoting a value).
function redact(v) {
  return String((v && v.message) || v || '')
    .replace(/postgres(ql)?:\/\/\S+/gi, '[db-url]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
    .replace(/\+?\d[\d\s().-]{6,}\d/g, '[number]')
    .replace(/\(([^()]{0,200})\)=\(([^()]{0,200})\)/g, '($1)=([value])')
    .slice(0, 300);
}

function error(what, err, ids = {}) {
  const safeIds = Object.fromEntries(Object.entries(ids).filter(([k, v]) => /^(lead_id|ref|action|route|step|kind)$/.test(k) && v != null).map(([k, v]) => [k, String(v).slice(0, 60)]));
  console.error(`[crashhelp] ${what}` + (Object.keys(safeIds).length ? ' ' + JSON.stringify(safeIds) : '') + (err ? ' :: ' + redact(err) : ''));
}

module.exports = { redact, error };
