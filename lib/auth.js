// Admin sessions: HMAC-signed, HttpOnly, SameSite=Strict cookie. No passwords stored in the DB.
// ADMIN_USERS = JSON: [{"name":"Josiah","role":"owner","password":"..."},{"name":"Chelsie","role":"staff","password":"..."}]
// or simply ADMIN_PASSWORD (owner) / STAFF_PASSWORD (staff).
const crypto = require('crypto');

const COOKIE = 'chx_admin';
const TTL_SEC = 12 * 3600;

// QA_ADMIN_PASSWORD: an automated test login ("QA Bot") for Preview only. Never honored in Production.
function qaUser() {
  const p = process.env.QA_ADMIN_PASSWORD;
  if (!p || p.length < 24 || process.env.VERCEL_ENV === 'production') return [];
  return [{ name: 'QA Bot', role: 'owner', password: p }];
}

function users() {
  try {
    const list = JSON.parse(process.env.ADMIN_USERS || '[]');
    if (Array.isArray(list) && list.length) return list.filter((u) => u.name && u.password && ['owner', 'staff'].includes(u.role)).concat(qaUser());
  } catch { /* fall through */ }
  const out = qaUser();
  if (process.env.ADMIN_PASSWORD) out.push({ name: process.env.ADMIN_NAME || 'Owner', role: 'owner', password: process.env.ADMIN_PASSWORD });
  if (process.env.STAFF_PASSWORD) out.push({ name: process.env.STAFF_NAME || 'Staff', role: 'staff', password: process.env.STAFF_PASSWORD });
  return out;
}

function secret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET must be set (32+ characters)');
  return s;
}

function safeEqual(a, b) {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const mac = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  return `${body}.${mac}`;
}

function verify(token) {
  if (!token || !token.includes('.')) return null;
  const [body, mac] = token.split('.');
  const expect = crypto.createHmac('sha256', secret()).update(body).digest('base64url');
  if (!safeEqual(mac, expect)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!p.exp || p.exp < Date.now() / 1000) return null;
    return p;
  } catch { return null; }
}

function login(name, password) {
  const u = users().find((x) => x.name.toLowerCase() === String(name || '').trim().toLowerCase());
  if (!u || !safeEqual(password || '', u.password)) return null;
  return { name: u.name, role: u.role };
}

function cookieHeader(user) {
  const token = sign({ ...user, exp: Math.floor(Date.now() / 1000) + TTL_SEC });
  const secure = process.env.INSECURE_COOKIES === '1' ? '' : ' Secure;';
  return `${COOKIE}=${token}; Path=/; HttpOnly;${secure} SameSite=Strict; Max-Age=${TTL_SEC}`;
}

function clearCookie() {
  return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

function fromRequest(req) {
  const raw = req.headers.cookie || '';
  const m = raw.split(';').map((s) => s.trim()).find((s) => s.startsWith(COOKIE + '='));
  return m ? verify(m.slice(COOKIE.length + 1)) : null;
}

module.exports = { login, cookieHeader, clearCookie, fromRequest, users };
