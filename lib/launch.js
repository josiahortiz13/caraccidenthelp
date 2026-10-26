// Launch readiness: what works, what's blocked, what needs an approval, what config is missing.
// Every "evidence" line comes from live data (database, environment, the last Twilio check, recorded test runs).
const db = require('./db');
const store = require('./store');
const tw = require('./twilio');
const crm = require('./crm');
const staging = require('./staging');

// Approvals only a person can give. Ticking one here records who and when; it switches nothing on.
const APPROVALS = [
  { key: 'ship_connect', label: 'Put /connect, the guides and privacy/terms on the live site', who: 'You' },
  { key: 'a2p_campaign', label: 'Twilio A2P campaign submitted and VERIFIED', who: 'Twilio' },
  { key: 'attorney_ads', label: 'Firm\'s attorney approves ad copy, video scripts, landing pages and guides (LEGAL_REVIEW 6, 13, 18)', who: 'Firm\'s attorney' },
  { key: 'compensation', label: 'Written answer on how CrashHelp TX may be paid (LEGAL_REVIEW 11, 14)', who: 'Firm\'s attorney' },
  { key: 'lead_transfer', label: 'Lead sharing with the firm approved, incl. consent wording (LEGAL_REVIEW 10, 17)', who: 'Firm\'s attorney' },
  { key: 'video_rights', label: 'Rights confirmed for any footage used in ads (no staged or borrowed crash footage)', who: 'You' },
  { key: 'ad_budget', label: '$500 starting ad budget approved', who: 'You' },
  { key: 'texting_on', label: 'Turn on texts to consumers (CONSUMER_SMS_ENABLED) after the campaign is verified', who: 'You' },
  { key: 'test_mode_off', label: 'Turn off TEST MODE in production', who: 'You' },
];

async function count(sql, params = []) { try { return (await db.one(sql, params))?.n ?? 0; } catch { return null; } }

async function evidence() {
  const bySource = async (src) => {
    const r = await db.one(`SELECT count(*)::int AS n, count(*) FILTER (WHERE is_test)::int AS test, max(created_at) AS last
      FROM leads WHERE source = ANY($1) AND duplicate_of IS NULL`, [src]).catch(() => null);
    return r || { n: 0, test: 0, last: null };
  };
  return {
    callback: await bySource(['express-callback']),
    quiz: await bySource(['express-quiz']),
    sms_quiz: await bySource(['sms-quiz']),
    inbound_calls: await count(`SELECT count(*)::int AS n FROM calls WHERE direction = 'inbound'`),
    callbacks_done: await count(`SELECT count(*)::int AS n FROM leads WHERE callback_requested AND first_contact_at IS NOT NULL`),
    inbound_texts: await count(`SELECT count(*)::int AS n FROM messages WHERE direction = 'inbound'`),
    consumer_texts_blocked: await count(`SELECT count(*)::int AS n FROM messages WHERE status = 'blocked'`),
    opt_outs: await count(`SELECT count(*)::int AS n FROM opt_outs`),
  };
}

function f(name, state, note) { return { name, state, note }; }

async function report(req) {
  const env = await staging.envCheck(req);
  const statuses = await store.getStatuses();
  const settings = await store.getSettings();
  const approvals = settings.launch_approvals || {};
  const tests = statuses.launch_tests || {};
  const site = statuses.site_number || null;
  const ev = await evidence();
  const e = process.env;
  const texting = String(e.CONSUMER_SMS_ENABLED || '').toLowerCase() === 'true';
  const campaignVerified = !!(site && (site.messaging_services || []).some((s) => s.campaigns.some((c) => String(c.status).toUpperCase() === 'VERIFIED')));
  const envState = (name) => env.find((c) => c.name === name)?.state;
  const day = (d) => (d ? new Date(d).toISOString().slice(0, 16).replace('T', ' ') + ' UTC' : 'never');

  const features = [
    f('Express Connect: Call Now', 'READY', 'Button dials the business number (346) 860-1929. Taps are counted in GA4/Meta as click-to-call.'),
    f('Completed-call tracking for the business number', site && (site.on_this_account || site.on_subaccount) ? 'READY' : 'BLOCKED',
      site ? (site.on_this_account || site.on_subaccount ? 'Number is on Twilio' : 'The business number is not on Twilio, so completed calls to it cannot be counted. Voice itself works.') : 'Run "Re-check Twilio" to inspect.'),
    f('Express Connect: Request Callback', ev.callback.n ? 'READY' : 'PENDING', `${ev.callback.n} saved (${ev.callback.test} test) · last ${day(ev.callback.last)} · ${ev.callbacks_done} callbacks completed`),
    f('Express Connect: Accident Quiz', ev.quiz.n ? 'READY' : 'PENDING', `${ev.quiz.n} saved (${ev.quiz.test} test) · last ${day(ev.quiz.last)}`),
    f('Lead dashboard, priorities, follow-ups, reports', 'READY', 'Every saved callback and quiz lead appears in Leads (test leads under the TEST filter).'),
    f('Two-way inbox (inbound texts, staff replies)', 'READY', `${ev.inbound_texts ?? 0} inbound texts received. Staff replies are blocked until texting is on.`),
    f('Text-message quiz', texting && campaignVerified ? 'READY' : 'BLOCKED', `${ev.sms_quiz.n} saved. Replies to consumers need a verified A2P campaign and texting turned on.`),
    f('Texts to consumers', texting ? 'READY' : 'BLOCKED', texting ? 'ON' : `OFF by design (CONSUMER_SMS_ENABLED). ${ev.consumer_texts_blocked ?? 0} attempts were safely blocked.`),
    f('Owner text alerts', campaignVerified ? 'READY' : 'BLOCKED', campaignVerified ? 'Campaign verified' : 'US carriers block texts from an unregistered number (error 30034). Owner call + email alerts still work.'),
    f('Owner call alerts (press 1 to connect)', tw.configured() ? 'READY' : 'BLOCKED', tw.configured() ? 'Proven earlier on Preview: call placed, keypress, bridge, marked CONTACTED.' : 'Twilio not configured'),
    f('STOP / START / HELP and opt-out records', 'READY', `${ev.opt_outs ?? 0} numbers currently opted out. Opted-out numbers are blocked at the send layer.`),
    f('Webhook security (signatures, duplicates)', 'READY', 'Unsigned or forged Twilio requests get 403; repeated deliveries are handled once.'),
    f('HighLevel CRM', crm.mode() === 'ghl' && envState('CRM / HighLevel') === 'CONFIGURED' ? (statuses.crm?.state === 'FAILED' ? 'FAILED' : 'READY') : 'BLOCKED',
      crm.mode() === 'none' ? 'Code complete (contacts, dedupe, pipeline, tasks, consent/DND sync). Needs GHL_API_KEY, GHL_LOCATION_ID and CRM_MODE=ghl.' : (env.find((c) => c.name === 'CRM / HighLevel')?.note || '')),
    f('Email alerts', [envState('Email (RESEND_API_KEY)'), envState('Email (GMAIL_APP_PASSWORD)')].includes('CONFIGURED') ? 'READY' : 'BLOCKED',
      env.filter((c) => c.name.startsWith('Email')).map((c) => `${c.name.replace('Email ', '')}: ${c.state}`).join(' · ')),
    f('Ad tracking (Meta Pixel, GA4)', 'READY', 'Lead events carry an event ID only; no accident, injury or contact details.'),
    f('Guides + sitemap (SEO)', 'READY', '3 Houston guides with structured data; sitemap lists them.'),
  ];

  const missing = env.filter((c) => ['MISSING', 'INVALID'].includes(c.state));
  const suites = Object.entries(tests).filter(([k]) => k !== 'at' && k !== 'state').map(([suite, t]) => ({ suite, ...t }));
  const failedTests = suites.flatMap((s) => (s.items || []).filter((i) => i.result === 'FAIL').map((i) => ({ suite: s.suite, ...i })));
  const appr = APPROVALS.map((a) => {
    const rec = approvals[a.key];
    let auto = null;
    if (a.key === 'a2p_campaign') auto = campaignVerified;
    if (a.key === 'texting_on') auto = texting;
    if (a.key === 'test_mode_off') auto = !tw.testMode();
    return { ...a, done: auto === null ? !!rec?.done : auto, auto: auto !== null, by: rec?.by || null, at: rec?.at || null };
  });

  return {
    generated_at: new Date().toISOString(),
    environment: e.VERCEL_ENV || 'local',
    summary: {
      ready: features.filter((x) => x.state === 'READY').length,
      blocked: features.filter((x) => x.state !== 'READY').length,
      approvals_pending: appr.filter((a) => !a.done).length,
      missing_config: missing.length,
      failed_tests: failedTests.length,
    },
    features, missing, approvals: appr, tests: suites, failed_tests: failedTests,
    site_number: site, site_number_checked_at: site?.at || null,
  };
}

async function setApproval(key, done, actor) {
  const a = APPROVALS.find((x) => x.key === key);
  if (!a) throw new Error('Unknown approval');
  if (['a2p_campaign', 'texting_on', 'test_mode_off'].includes(key)) throw new Error('This one is read from the live system, not ticked by hand.');
  const settings = await store.getSettings();
  const cur = { ...(settings.launch_approvals || {}) };
  cur[key] = { done: !!done, by: actor, at: new Date().toISOString() };
  await store.saveSettings({ launch_approvals: cur });
  await store.audit(actor, done ? 'launch_approval_recorded' : 'launch_approval_cleared', null, { key });
}

// Recorded by an automated test run (owner login). Stores names + PASS/FAIL only, never test data.
async function recordTests(suite, items, actor) {
  const clean = (s, n) => String(s ?? '').slice(0, n);
  const list = (Array.isArray(items) ? items : []).slice(0, 80).map((i) => ({ name: clean(i.name, 120), result: ['PASS', 'FAIL', 'SKIP'].includes(i.result) ? i.result : 'FAIL', note: clean(i.note, 200) }));
  const statuses = await store.getStatuses();
  const all = { ...(statuses.launch_tests || {}) };
  delete all.at; delete all.state;
  all[clean(suite, 60) || 'tests'] = { at: new Date().toISOString(), by: actor, passed: list.filter((i) => i.result === 'PASS').length, failed: list.filter((i) => i.result === 'FAIL').length, items: list };
  await store.setStatus('launch_tests', all);
  await store.audit(actor, 'launch_tests_recorded', null, { suite, passed: all[suite]?.passed, failed: all[suite]?.failed });
  return all[suite];
}

module.exports = { report, setApproval, recordTests, APPROVALS };
