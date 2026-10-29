// Accident report feature: uploads, safety checks, analysis display rules, attorney review, deletion.
// Uses fake storage (BLOB_FAKE) and a fake model (REPORT_AI_FAKE) with 8 synthetic crash scenarios.
// What these prove: the code keeps facts labeled, shows only verified public citations, never shows the
// attorney section or a fault verdict to visitors, masks ID numbers, and deletes on schedule.
// What they do NOT prove: the real model's reading quality. That needs live runs on sample reports with ANTHROPIC_API_KEY set.
process.env.BLOB_FAKE = '1';
process.env.REPORT_AI_FAKE = '1';
const test = require('node:test');
const assert = require('node:assert/strict');
const h = require('./harness');
const db = require('../lib/db');
const law = require('../lib/texas-law');

let base, server, ownerCookie, staffCookie;
const PDF = Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(64, 1)]);

const F = (value, basis = 'report_states', source = 'CR-3 p.1') => ({ value, basis, source });
const U = () => ({ value: '', basis: 'unknown', source: '' });
function result(o = {}) {
  return {
    document_type: 'texas_cr3',
    overview: { crash_date: F('2026-09-14'), crash_time: F('17:40'), location: F('Westheimer Rd at S Gessner Rd, Houston'), crash_type: F('Angle'), vehicles_involved: F('2') },
    parties: [
      { label: 'Unit 1', role: 'driver', vehicle: F('2019 sedan'), commercial_vehicle: F('No'), insurer_named: F('Example Mutual'), cited: U(), injuries_reported: F('Possible injury'), likely_the_uploader: 'yes' },
      { label: 'Unit 2', role: 'driver', vehicle: F('2021 pickup'), commercial_vehicle: F('No'), insurer_named: U(), cited: F('Disregard stop and go signal'), injuries_reported: F('Not injured'), likely_the_uploader: 'no' },
    ],
    narrative: F('Unit 2 entered the intersection on a red signal per witness and struck Unit 1.'),
    diagram: F('Unit 2 northbound, Unit 1 eastbound, impact to Unit 1 right side', 'ai_inference', 'diagram p.2'),
    conditions: { road: F('Dry'), weather: F('Clear'), light: F('Daylight'), traffic_control: F('Signal light') },
    officer_findings: { contributing_factors: [F('Unit 2: Disregard stop and go signal')], citations_issued: [F('Unit 2 cited')], observations: [] },
    witnesses: [{ label: 'Witness 1', account: F('Said Unit 2 had a red light') }],
    conflicts: [], missing_info: [],
    evidence_checklist: [{ item: 'Photos of both vehicles', why: 'Shows impact points', status: 'missing' }],
    laws: [{ id: 'TN-544.007', why: 'Officer listed disregarding a signal' }],
    questions_for_lawyer: ['Does the witness statement matter if the other driver disputes it?'],
    attorney: {
      liability_issues: [{ party: 'Unit 2', theory: 'Signal violation', supporting: ['Officer factor', 'Witness 1'], contradicting: ['No video'] }],
      comparative_responsibility_issues: ['Unit 1 speed not recorded'],
      insurance_questions: [{ coverage: 'bodily_injury_liability', question: 'Unit 2 insurer not listed' }],
      open_questions: ['Signal timing records'], evidence_to_obtain: ['Traffic camera footage'],
    },
    ...o,
  };
}

// Eight synthetic scenarios, keyed by a word in the description. Each one exercises a different risk.
const SCENARIOS = {
  'red-light': result({ laws: [{ id: 'TN-544.007', why: 'signal' }, { id: 'CP-33.001', why: 'should never reach visitors' }, { id: 'TN-999.999', why: 'invented id must be dropped' }] }),
  'rear-end': result({ overview: { ...result().overview, crash_type: F('Rear end') }, laws: [{ id: 'TN-545.062', why: 'Unit 2 struck Unit 1 from behind' }] }),
  'left-turn': result({ overview: { ...result().overview, crash_type: F('Left turn') }, laws: [{ id: 'TN-545.152', why: 'Unit 1 was turning left' }] }),
  'multi-vehicle': result({ parties: [...result().parties, { label: 'Unit 3', role: 'driver', vehicle: F('SUV'), commercial_vehicle: F('No'), insurer_named: U(), cited: U(), injuries_reported: U(), likely_the_uploader: 'unknown' }], overview: { ...result().overview, vehicles_involved: F('3'), location: F('I-610 West Loop northbound') } }),
  'commercial': result({ parties: [result().parties[0], { ...result().parties[1], label: 'Unit 2', vehicle: F('Truck-tractor with semi-trailer'), commercial_vehicle: F('Yes, carrier listed') }],
    attorney: { ...result().attorney, insurance_questions: [{ coverage: 'commercial_auto', question: 'Carrier policy and federal minimums' }, { coverage: 'employer_vehicle', question: 'Was the driver on duty?' }] } }),
  'hit-and-run': result({ parties: [result().parties[0], { label: 'Unit 2', role: 'driver', vehicle: U(), commercial_vehicle: U(), insurer_named: U(), cited: U(), injuries_reported: U(), likely_the_uploader: 'no' }],
    narrative: F('Unit 2 left the scene without stopping.'), laws: [{ id: 'TN-550.021', why: 'Unit 2 left the scene' }, { id: 'IN-1952.101', why: 'Unknown driver' }] }),
  'conflicting': result({ witnesses: [{ label: 'Witness 1', account: F('Unit 2 had red') }, { label: 'Witness 2', account: F('Unit 1 had red') }], conflicts: ['Witness 1 says Unit 2 ran the red; Witness 2 says Unit 1 did.'] }),
  // Incomplete: no date, ID numbers echoed by mistake (must be masked), most fields unknown.
  'incomplete': result({
    overview: { crash_date: U(), crash_time: U(), location: F('Houston, street not legible'), crash_type: U(), vehicles_involved: U() },
    narrative: F('Narrative illegible. DL 12345678 noted, call 832-555-0123.'),
    missing_info: ['Crash date blank', 'Narrative illegible'],
  }),
};
global.__crashhelpFakeAI = async ({ description }) => {
  if (/ai-down/.test(description)) throw new Error('upstream 529');
  const key = Object.keys(SCENARIOS).find((k) => description.includes(k)) || 'red-light';
  return { result: JSON.parse(JSON.stringify(SCENARIOS[key])), model: 'fake-model' };
};

async function call(action, body = {}, { cookie, method = 'POST', ip, headers = {}, query = {} } = {}) {
  const r = await fetch(`${base}/api/report?${new URLSearchParams({ a: action, ...query })}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-Forwarded-For': ip || '10.9.' + Math.floor(Math.random() * 250) + '.' + Math.floor(Math.random() * 250), ...(cookie ? { Cookie: cookie } : {}), ...headers },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => ({})) };
}
async function login(name, password) {
  const r = await fetch(`${base}/api/admin?a=login`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CrashHelp': '1' }, body: JSON.stringify({ name, password }) });
  return r.headers.get('set-cookie').split(';')[0];
}
async function upload(c, bytes, type, name = 'cr3.pdf') {
  const u = await call('upload-url', { ...c, name, type, size: bytes.length });
  assert.equal(u.status, 200, JSON.stringify(u.json));
  const put = await fetch(base + u.json.upload_url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ b64: bytes.toString('base64'), type }) });
  assert.equal(put.status, 200);
  return (await call('uploaded', { ...c, file_id: u.json.file_id })).json;
}
async function newCase() {
  const s = await call('start', { consent: true, lang: 'en' });
  assert.equal(s.status, 200, JSON.stringify(s.json));
  return { case_id: s.json.case_id, token: s.json.token };
}
const deepKeys = (o, out = []) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { out.push(k); deepKeys(v, out); } return out; };

test.before(async () => {
  server = await h.start(); base = 'http://localhost:' + server.address().port;
  ownerCookie = await login('Josiah', 'owner-pass');
  staffCookie = await login('Staff', 'staff-pass');
});
test.after(() => server.close());
test.beforeEach(async () => { process.env.ACCIDENT_INTEL_PUBLIC = 'true'; await db.query('DELETE FROM rate_limits'); });

test('R1. switched off by default: public gets 404, signed-in staff can still test it', async () => {
  delete process.env.ACCIDENT_INTEL_PUBLIC;
  const pub = await call('start', { consent: true });
  assert.equal(pub.status, 404); assert.equal(pub.json.disabled, true);
  const staff = await call('start', { consent: true }, { cookie: staffCookie });
  assert.equal(staff.status, 200); assert.match(staff.json.case_id, /^RPT-/);
});

test('R2. consent is required and recorded word for word', async () => {
  assert.equal((await call('start', { consent: false })).status, 400);
  const c = await newCase();
  const row = await db.one('SELECT consent_text, consent_at, delete_after FROM report_cases WHERE case_id = $1', [c.case_id]);
  assert.match(row.consent_text, /not a law firm/); assert.ok(row.consent_at);
  const days = (new Date(row.delete_after) - Date.now()) / 864e5;
  assert.ok(days > 29 && days <= 30.01, 'deleted after 30 days by default');
});

test('R3. upload checks: wrong type, too big, disguised executable, PDF with JavaScript are refused', async () => {
  const c = await newCase();
  assert.equal((await call('upload-url', { ...c, name: 'x.exe', type: 'application/x-msdownload', size: 10 })).status, 400);
  assert.equal((await call('upload-url', { ...c, name: 'big.pdf', type: 'application/pdf', size: 21 * 1024 * 1024 })).status, 400);
  assert.equal((await upload(c, Buffer.from('MZ\x90\x00 not a pdf'), 'application/pdf', 'evil.pdf')).status, 'REJECTED');
  const jsPdf = Buffer.concat([PDF, Buffer.from('<< /S /JavaScript /JS (app.alert(1)) >>')]);
  const r = await upload(c, jsPdf, 'application/pdf', 'active.pdf');
  assert.equal(r.status, 'REJECTED'); assert.equal(r.reason, 'pdf_active_content');
  assert.equal((await upload(c, JPG, 'image/png', 'lies.png')).status, 'REJECTED', 'content must match declared type');
  assert.equal((await upload(c, PDF, 'application/pdf')).status, 'CLEAN');
  assert.equal((await upload(c, JPG, 'image/jpeg', 'scene.jpg')).status, 'CLEAN');
  const rejected = await db.query("SELECT pathname FROM report_files WHERE case_id = $1 AND status = 'REJECTED'", [c.case_id]);
  for (const f of rejected.rows) assert.equal(global.__crashhelpFakeBlob.has(f.pathname), false, 'rejected files are removed from storage');
});

test('R4. the private link is the only key: wrong token or other case = not found', async () => {
  const a = await newCase(); const b = await newCase();
  assert.equal((await call('result', { case_id: a.case_id, token: b.token })).status, 404);
  assert.equal((await call('result', { case_id: a.case_id, token: 'x'.repeat(32) })).status, 404);
  assert.equal((await call('result', a)).status, 200);
});

for (const name of Object.keys(SCENARIOS)) {
  test(`R5. scenario ${name}: facts stay labeled, only verified public laws, no attorney section or verdict`, async () => {
    const c = await newCase();
    await upload(c, PDF, 'application/pdf');
    const r = await call('analyze', { ...c, description: `synthetic ${name} crash` });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const v = r.json.result;
    // Nothing from the attorney section, and no field that could carry a verdict or a value.
    const keys = deepKeys(r.json);
    for (const bad of ['attorney', 'liability_issues', 'comparative_responsibility_issues', 'insurance_questions', 'fault', 'fault_percent', 'case_value']) assert.ok(!keys.includes(bad), `visitor view must not include ${bad}`);
    // Every law shown is in the library, public, with an official URL and verification date.
    for (const l of v.laws) {
      assert.ok(law.BY_ID[l.id], `unknown law ${l.id}`); assert.equal(law.BY_ID[l.id].audience, 'public');
      assert.match(l.url, /^https:\/\/statutes\.capitol\.texas\.gov\/Docs\//); assert.equal(l.verified_on, law.VERIFIED_ON);
    }
    // Every fact keeps one of the four labels.
    const all = []; (function walk(o) { if (o && typeof o === 'object') { if ('basis' in o) all.push(o.basis); Object.values(o).forEach(walk); } })(v);
    assert.ok(all.length > 5); for (const b of all) assert.ok(['report_states', 'person_states', 'ai_inference', 'unknown'].includes(b));
    assert.match(r.json.disclaimer, /not a law firm/);

    if (name === 'red-light') {
      assert.deepEqual(v.laws.map((l) => l.id), ['TN-544.007'], 'attorney-only and invented ids are dropped');
      assert.equal(v.deadline.general_deadline, '2028-09-14');
    }
    if (name === 'incomplete') {
      assert.equal(v.deadline, null, 'no crash date → no deadline is invented');
      assert.equal(v.overview.crash_date.basis, 'unknown');
      assert.ok(!v.narrative.value.includes('12345678') && !v.narrative.value.includes('555-0123'), 'ID and phone numbers are masked');
      assert.ok(v.missing_info.length >= 2);
    }
    if (name === 'conflicting') assert.equal(v.conflicts.length, 1);
    if (name === 'hit-and-run') assert.deepEqual(v.laws.map((l) => l.id).sort(), ['IN-1952.101', 'TN-550.021']);
    if (name === 'multi-vehicle') assert.equal(v.parties.length, 3);
    if (name === 'commercial') assert.match(v.parties[1].commercial_vehicle.value, /Yes/);
  });
}

test('R6. model outage: the person gets a call-us message, the case is marked FAILED, nothing invented', async () => {
  const c = await newCase();
  await upload(c, PDF, 'application/pdf');
  const r = await call('analyze', { ...c, description: 'ai-down' });
  assert.equal(r.status, 502); assert.match(r.json.error, /call us/i);
  const row = await db.one('SELECT status, analysis FROM report_cases WHERE case_id = $1', [c.case_id]);
  assert.equal(row.status, 'FAILED'); assert.equal(row.analysis, null);
});

test('R7. attorney review request becomes a normal lead and extends retention to 180 days', async () => {
  const c = await newCase();
  await upload(c, PDF, 'application/pdf');
  await call('analyze', { ...c, description: 'rear-end' });
  assert.equal((await call('review', { ...c, first_name: 'Ana', phone: '(832) 555-0199', contact_consent: false })).status, 400);
  const r = await call('review', { ...c, first_name: 'Ana', last_name: 'Diaz', phone: '(832) 555-0199', preferred_contact: 'call', contact_consent: true, consent_text: 'I agree…' });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const lead = await db.one('SELECT source, crash_date, contact_consent FROM leads WHERE lead_id = $1', [r.json.lead_id]);
  assert.equal(lead.source, 'accident-report'); assert.equal(lead.contact_consent, true);
  assert.equal(new Date(lead.crash_date).toISOString().slice(0, 10), '2026-09-14', 'crash date taken only because the report states it');
  const row = await db.one('SELECT lead_id, delete_after FROM report_cases WHERE case_id = $1', [c.case_id]);
  assert.equal(row.lead_id, r.json.lead_id);
  assert.ok((new Date(row.delete_after) - Date.now()) / 864e5 > 179);
});

test('R8. "delete my files" removes storage and personal data immediately', async () => {
  const c = await newCase();
  await upload(c, PDF, 'application/pdf');
  await call('analyze', { ...c, description: 'left-turn' });
  const paths = (await db.query('SELECT pathname FROM report_files WHERE case_id = $1', [c.case_id])).rows.map((x) => x.pathname);
  assert.ok(paths.every((p) => global.__crashhelpFakeBlob.has(p)));
  assert.equal((await call('delete', c)).status, 200);
  assert.ok(paths.every((p) => !global.__crashhelpFakeBlob.has(p)));
  const row = await db.one('SELECT status, analysis, description, deleted_by FROM report_cases WHERE case_id = $1', [c.case_id]);
  assert.equal(row.status, 'DELETED'); assert.equal(row.analysis, null); assert.equal(row.deleted_by, 'visitor');
  assert.equal((await call('result', c)).status, 404, 'link stops working');
});

test('R9. retention: the cron tick purges cases past their delete date', async () => {
  const c = await newCase();
  await upload(c, PDF, 'application/pdf');
  await db.query("UPDATE report_cases SET delete_after = now() - interval '1 minute' WHERE case_id = $1", [c.case_id]);
  const tick = await (await fetch(`${base}/api/cron`, { headers: { Authorization: 'Bearer ' + h.ENV.CRON_SECRET } })).json();
  assert.ok(tick.report_retention.purged >= 1, JSON.stringify(tick));
  const row = await db.one('SELECT status, deleted_by FROM report_cases WHERE case_id = $1', [c.case_id]);
  assert.equal(row.status, 'DELETED'); assert.equal(row.deleted_by, 'retention');
});

test('R10. attorney screen: login required, shows the attorney section, every file view is audited, owner-only delete', async () => {
  const c = await newCase();
  await upload(c, PDF, 'application/pdf');
  await call('analyze', { ...c, description: 'red-light' });
  assert.equal((await call('admin-case', {}, { method: 'GET', query: { case_id: c.case_id } })).status, 401);
  const r = await call('admin-case', {}, { method: 'GET', cookie: staffCookie, query: { case_id: c.case_id } });
  assert.equal(r.status, 200);
  assert.ok(r.json.attorney.liability_issues.length); assert.match(r.json.attorney.notice, /Preliminary/);
  assert.ok(r.json.attorney.laws.some((l) => l.id === 'CP-33.001'), 'attorney view keeps proportionate-responsibility law');
  assert.ok(!r.json.attorney.laws.some((l) => l.id === 'TN-999.999'), 'invented ids dropped here too');
  const f = await call('admin-file', {}, { method: 'GET', cookie: staffCookie, query: { case_id: c.case_id, file_id: r.json.files[0].file_id } });
  assert.equal(f.status, 200); assert.equal(f.json.expires_minutes, 5);
  const audit = await db.query("SELECT action FROM audit WHERE detail->>'case_id' = $1", [c.case_id]);
  assert.ok(audit.rows.some((x) => x.action === 'report_case_viewed')); assert.ok(audit.rows.some((x) => x.action === 'report_file_opened'));
  assert.equal((await call('admin-delete', { case_id: c.case_id }, { cookie: staffCookie, headers: { 'X-CrashHelp': '1' } })).status, 403);
  assert.equal((await call('admin-delete', { case_id: c.case_id }, { cookie: ownerCookie })).status, 403, 'CSRF header required');
  assert.equal((await call('admin-delete', { case_id: c.case_id }, { cookie: ownerCookie, headers: { 'X-CrashHelp': '1' } })).status, 200);
});
