// Upload safety checks. Vercel has no built-in antivirus, so this does what can be checked locally:
// the bytes must really be the declared type (magic numbers), and PDFs may not carry active content
// (JavaScript, launch actions, embedded files). Anything else is rejected.
// A full antivirus scan is NOT included yet: result.level is 'basic' until a scanning service is added,
// and the launch checklist keeps the public feature blocked while that is true.

const SIGNATURES = {
  'application/pdf': (b) => b.subarray(0, 5).toString('latin1') === '%PDF-',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/webp': (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
  'image/heic': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' && /^(heic|heix|mif1|msf1|hevc)/.test(b.subarray(8, 12).toString('latin1')),
  'video/mp4': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp',
  'video/quicktime': (b) => b.subarray(4, 8).toString('latin1') === 'ftyp' || b.subarray(4, 8).toString('latin1') === 'moov',
};

// Executables and scripts, whatever they claim to be.
const DANGEROUS_HEADS = [
  Buffer.from('MZ'),               // Windows PE
  Buffer.from([0x7f, 0x45, 0x4c, 0x46]), // ELF
  Buffer.from([0xcf, 0xfa, 0xed, 0xfe]), // Mach-O
  Buffer.from('#!'),               // script
  Buffer.from('PK\u0003\u0004'),   // zip / office files with macros
];

const PDF_ACTIVE = [/\/JavaScript\b/, /\/JS\s*[(<]/, /\/Launch\b/, /\/EmbeddedFile\b/, /\/RichMedia\b/, /\/XFA\b/, /\/OpenAction\b[^>]*\/JS/];

function check(bytes, declaredType) {
  if (!Buffer.isBuffer(bytes) || !bytes.length) return { ok: false, reason: 'empty_file' };
  for (const head of DANGEROUS_HEADS) {
    if (bytes.subarray(0, head.length).equals(head)) return { ok: false, reason: 'executable_or_archive' };
  }
  const sig = SIGNATURES[declaredType];
  if (!sig) return { ok: false, reason: 'type_not_allowed' };
  if (!sig(bytes)) return { ok: false, reason: 'content_does_not_match_type' };
  if (declaredType === 'application/pdf') {
    const text = bytes.toString('latin1');
    const hit = PDF_ACTIVE.find((re) => re.test(text));
    if (hit) return { ok: false, reason: 'pdf_active_content' };
  }
  return { ok: true, level: 'basic' };
}

module.exports = { check, ALLOWED_TYPES: Object.keys(SIGNATURES) };
