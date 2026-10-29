// Private file storage for accident report uploads (Vercel Blob, access: 'private').
// Files are never public: the browser uploads with a short-lived presigned PUT scoped to one pathname,
// size and type; staff view through a 5-minute presigned GET. Needs BLOB_READ_WRITE_TOKEN (added
// automatically when a Blob store is connected to the project).
// Tests: BLOB_FAKE=1 keeps files in memory and serves uploads at /api/report?a=fake-put.
const UPLOAD_MINUTES = 10;
const VIEW_MINUTES = 5;

const fake = () => process.env.BLOB_FAKE === '1';
const mem = global.__crashhelpFakeBlob || (global.__crashhelpFakeBlob = new Map());

function configured() {
  return fake() || !!process.env.BLOB_READ_WRITE_TOKEN;
}

async function signed(pathname, operation, minutes, extra = {}) {
  const { issueSignedToken, presignUrl } = require('@vercel/blob');
  const validUntil = Date.now() + minutes * 60000;
  const token = await issueSignedToken({ pathname, operations: [operation], validUntil, ...extra });
  const { presignedUrl } = await presignUrl(token, { operation, pathname, access: 'private', validUntil, ...extra });
  return presignedUrl;
}

// One-file upload URL. The browser sends: PUT <url> with the file as the body.
async function uploadUrl(pathname, { contentType, maxBytes }) {
  if (fake()) return `/api/report?a=fake-put&p=${encodeURIComponent(pathname)}`;
  return signed(pathname, 'put', UPLOAD_MINUTES, { allowedContentTypes: [contentType], maximumSizeInBytes: maxBytes, addRandomSuffix: false });
}

async function viewUrl(pathname) {
  if (fake()) return `fake-blob://${pathname}?expires=${Date.now() + VIEW_MINUTES * 60000}`;
  return signed(pathname, 'get', VIEW_MINUTES);
}

// Returns { bytes: Buffer, contentType, size } or null when the file is missing.
async function read(pathname, { maxBytes = 40 * 1024 * 1024 } = {}) {
  if (fake()) {
    const f = mem.get(pathname);
    return f ? { bytes: f.bytes, contentType: f.contentType, size: f.bytes.length } : null;
  }
  const { get } = require('@vercel/blob');
  const r = await get(pathname, { access: 'private', useCache: false });
  if (!r || r.statusCode !== 200) return null;
  if (r.blob.size > maxBytes) throw new Error('file_too_large');
  const bytes = Buffer.from(await new Response(r.stream).arrayBuffer());
  return { bytes, contentType: r.blob.contentType, size: bytes.length };
}

async function remove(pathnames) {
  const list = (Array.isArray(pathnames) ? pathnames : [pathnames]).filter(Boolean);
  if (!list.length) return;
  if (fake()) { for (const p of list) mem.delete(p); return; }
  const { del } = require('@vercel/blob');
  await del(list);
}

// Tests only: receives the "upload" the browser would send to Blob.
function fakePut(pathname, bytes, contentType) {
  if (!fake()) throw new Error('fake storage is off');
  mem.set(pathname, { bytes, contentType });
}

module.exports = { configured, uploadUrl, viewUrl, read, remove, fakePut, UPLOAD_MINUTES, VIEW_MINUTES };
