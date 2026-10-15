const crypto = require('crypto');

function clean(v, max = 500) {
  if (v === undefined || v === null) return '';
  return String(v).replace(/[<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

// US-centric E.164 normalization. Returns '' when the number can't be trusted.
function normalizePhone(v) {
  if (!v) return '';
  const s = String(v).trim();
  const digits = s.replace(/\D/g, '');
  if (s.startsWith('+') && digits.length >= 10 && digits.length <= 15) return '+' + digits;
  if (digits.length === 10) return '+1' + digits;
  if (digits.length === 11 && digits.startsWith('1')) return '+' + digits;
  return '';
}

function maskPhone(p) {
  if (!p) return '';
  const d = String(p).replace(/\D/g, '');
  return d.length >= 4 ? `(•••) •••-${d.slice(-4)}` : '••••';
}

function normalizeEmail(v) {
  const e = clean(v, 200).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) ? e : '';
}

function oneOf(v, allowed, fallback = null) {
  const s = clean(v, 40).toLowerCase().replace(/\s+/g, '_');
  return allowed.includes(s) ? s : fallback;
}

function truthy(v) {
  return v === true || v === 'true' || v === 'on' || v === '1' || v === 1 || v === 'yes';
}

function newLeadId(now = new Date()) {
  const y = String(now.getUTCFullYear()).slice(2);
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const r = crypto.randomBytes(3).toString('hex').toUpperCase().slice(0, 5);
  return `CH-${y}${m}${d}-${r}`;
}

function fill(template, vars) {
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k) => {
    const v = vars[k];
    return v === undefined || v === null || v === '' ? '—' : String(v);
  });
}

function clientIp(req) {
  const xf = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return xf || req.socket?.remoteAddress || 'unknown';
}

function sendJson(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

function sendXml(res, xml) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/xml');
  res.end(xml);
}

function xmlEscape(s) {
  return String(s ?? '').replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
}

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || 'https://www.crashhelptx.com').replace(/\/$/, '');
}

// Vercel sets VERCEL_AUTOMATION_BYPASS_SECRET when "Protection Bypass for Automation" is on.
// Twilio can't log in to Vercel, so on protected previews every webhook URL needs it.
function twilioUrl(query) {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  return `${baseUrl()}/api/twilio?${query}${bypass ? `&x-vercel-protection-bypass=${encodeURIComponent(bypass)}` : ''}`;
}

module.exports = {
  clean, normalizePhone, maskPhone, normalizeEmail, oneOf, truthy, newLeadId, fill,
  clientIp, sendJson, sendXml, xmlEscape, baseUrl, twilioUrl,
};
