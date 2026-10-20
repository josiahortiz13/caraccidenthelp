// /api/admin?a=<action> — dashboard API. Every action except login requires a valid session.
// Mutations also require the X-CrashHelp header (CSRF guard on top of SameSite=Strict cookies).
const db = require('../lib/db');
const store = require('../lib/store');
const auth = require('../lib/auth');
const tw = require('../lib/twilio');
const crm = require('../lib/crm');
const leads = require('../lib/leads');
const escalation = require('../lib/escalation');
const email = require('../lib/email');
const staging = require('../lib/staging');
const { sendJson, clientIp, clean, maskPhone, normalizePhone } = require('../lib/util');

const READ_ACTIONS = ['me', 'leads', 'lead', 'metrics', 'status', 'settings', 'env-check', 'twilio-check', 'test-numbers'];

// Views: all (default), urgent, callbacks, missed (missed inbound calls), followup.
// Order: open + not yet contacted first, then URGENT → HIGH → NORMAL → LOW, then oldest waiting first.
async function listLeads(q) {
  const params = [];
  let where = 'duplicate_of IS NULL';
  // TEST leads are hidden from the normal queue and only shown under the TEST filter.
  if (q.status === 'TEST') where += ' AND is_test = true';
  else {
    where += ' AND is_test = false';
    if (q.status) { params.push(q.status); where += ` AND lead_status = $${params.length}`; }
  }
  if (q.view === 'urgent') where += ` AND lead_priority = 'URGENT'`;
  if (q.view === 'callbacks') where += ' AND callback_requested = true';
  if (q.view === 'missed') where += ` AND source = 'inbound_call' AND (lead_status = 'PENDING CONSENT' OR first_contact_at IS NULL)`;
  if (q.view === 'followup') where += ` AND (follow_up_at IS NOT NULL OR lead_status IN ('FOLLOW-UP', 'CONTACT ATTEMPTED', 'NO RESPONSE')) AND lead_status NOT IN ('CLOSED', 'NOT QUALIFIED', 'DUPLICATE', 'REFERRED')`;
  if (q.search) {
    params.push(`%${String(q.search).toLowerCase()}%`);
    where += ` AND (lower(coalesce(first_name,'')||' '||coalesce(last_name,'')) LIKE $${params.length} OR phone LIKE $${params.length} OR lower(coalesce(email,'')) LIKE $${params.length} OR lower(lead_id) LIKE $${params.length})`;
  }
  const open = `(l.lead_status = ANY($${params.length + 1}) AND l.first_contact_at IS NULL)`;
  const order = q.view === 'followup'
    ? `(l.follow_up_at IS NULL), l.follow_up_at ASC, ${open} DESC, l.updated_at ASC`
    : `${open} DESC, CASE l.lead_priority WHEN 'URGENT' THEN 0 WHEN 'HIGH PRIORITY' THEN 1 WHEN 'NORMAL PRIORITY' THEN 2 ELSE 3 END,
       CASE WHEN ${open} THEN l.created_at END ASC, l.created_at DESC`;
  const r = await db.query(
    `SELECT l.*, EXTRACT(EPOCH FROM (now() - l.created_at))::int AS age_sec,
       (SELECT count(*)::int FROM leads d WHERE d.duplicate_of = l.lead_id) AS repeat_count
     FROM leads l WHERE ${where}
     ORDER BY ${order} LIMIT 300`,
    [...params, leads.OPEN_STATUSES]
  );
  return r.rows;
}

async function leadDetail(id) {
  const lead = await db.one('SELECT *, EXTRACT(EPOCH FROM (now() - created_at))::int AS age_sec FROM leads WHERE lead_id = $1', [id]);
  if (!lead) return null;
  const [events, messages, calls, repeats] = await Promise.all([
    db.query('SELECT at, type, actor, detail FROM events WHERE lead_id = $1 ORDER BY at ASC, id ASC', [id]),
    db.query('SELECT created_at, direction, kind, purpose, body, status, error FROM messages WHERE lead_id = $1 ORDER BY created_at ASC', [id]),
    db.query('SELECT created_at, direction, purpose, status, duration, connected, answered_by FROM calls WHERE lead_id = $1 ORDER BY created_at ASC', [id]),
    db.query('SELECT lead_id, created_at, source FROM leads WHERE duplicate_of = $1 ORDER BY created_at ASC', [id]),
  ]);
  return { lead, timeline: events.rows, messages: messages.rows, calls: calls.rows, repeats: repeats.rows };
}

async function metrics(test = false) {
  const settings = await store.getSettings();
  const target = Number(settings.response_target_min) || 5;
  const one = (sql, p) => db.one(sql, p);
  const counts = await one(`SELECT
      count(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Chicago') AT TIME ZONE 'America/Chicago')::int AS new_today,
      count(*) FILTER (WHERE created_at >= now() - interval '7 days')::int AS week,
      count(*) FILTER (WHERE lead_status = ANY($1) AND first_contact_at IS NULL)::int AS uncontacted,
      count(*) FILTER (WHERE first_contact_at IS NOT NULL)::int AS contacted,
      count(*) FILTER (WHERE lead_status = 'QUALIFIED')::int AS qualified,
      count(*) FILTER (WHERE appointment_at IS NOT NULL)::int AS appointments,
      count(*) FILTER (WHERE lead_status = 'REFERRED')::int AS referred,
      count(*) FILTER (WHERE lead_status = 'NO RESPONSE')::int AS no_response,
      count(*) FILTER (WHERE lead_priority = 'HIGH PRIORITY' AND lead_status = ANY($1))::int AS high_open,
      count(*) FILTER (WHERE lead_priority = 'URGENT' AND lead_status = ANY($1) AND first_contact_at IS NULL)::int AS urgent_open,
      count(*) FILTER (WHERE callback_requested AND lead_status = ANY($1) AND first_contact_at IS NULL)::int AS callbacks_waiting,
      count(*) FILTER (WHERE callback_requested AND first_contact_at IS NOT NULL AND created_at >= now() - interval '30 days')::int AS callbacks_done,
      count(*) FILTER (WHERE source = 'inbound_call' AND first_contact_at IS NULL AND created_at >= now() - interval '7 days')::int AS missed_calls,
      count(*) FILTER (WHERE follow_up_at IS NOT NULL AND follow_up_at <= now() AND lead_status NOT IN ('CLOSED','NOT QUALIFIED','DUPLICATE','REFERRED','CONTACTED','QUALIFIED','APPOINTMENT SET'))::int AS followups_due
    FROM leads WHERE duplicate_of IS NULL AND is_test = $2`, [leads.OPEN_STATUSES, test]);
  const times = await one(`SELECT
      round(avg(EXTRACT(EPOCH FROM (first_alert_at - created_at))))::int AS avg_alert_sec,
      round(avg(EXTRACT(EPOCH FROM (first_response_at - created_at))))::int AS avg_attempt_sec,
      round(avg(EXTRACT(EPOCH FROM (first_contact_at - created_at))))::int AS avg_contact_sec,
      round(avg(EXTRACT(EPOCH FROM (appointment_at - created_at))))::int AS avg_appointment_sec,
      round(avg(EXTRACT(EPOCH FROM (first_contact_at - created_at))) FILTER (WHERE callback_requested))::int AS avg_callback_sec,
      count(*) FILTER (WHERE first_response_at IS NOT NULL AND first_response_at - created_at > make_interval(mins => $1::int))::int AS over_target
    FROM leads WHERE duplicate_of IS NULL AND is_test = $2 AND created_at >= now() - interval '30 days' AND source <> 'inbound_call'`, [target, test]);
  const sources = await db.query(`SELECT coalesce(nullif(utm_source,''), source, 'direct') AS source, coalesce(nullif(utm_campaign,''),'—') AS campaign,
      count(*)::int AS leads,
      count(*) FILTER (WHERE first_contact_at IS NOT NULL)::int AS contacted,
      count(*) FILTER (WHERE lead_status IN ('QUALIFIED','APPOINTMENT SET','REFERRED'))::int AS qualified
    FROM leads WHERE duplicate_of IS NULL AND is_test = $1 AND created_at >= now() - interval '30 days'
    GROUP BY 1,2 ORDER BY leads DESC LIMIT 12`, [test]);
  const notTest = `(lead_id IS NULL OR lead_id IN (SELECT lead_id FROM leads WHERE is_test = ${test ? 'true' : 'false'}))`;
  const activity = await one(`SELECT
      (SELECT count(*)::int FROM messages WHERE direction='outbound' AND status NOT IN ('blocked','failed') AND created_at >= now() - interval '7 days' AND ${notTest}) AS texts_sent,
      (SELECT count(*)::int FROM calls WHERE direction='outbound' AND status <> 'failed' AND created_at >= now() - interval '7 days' AND ${notTest}) AS calls_made,
      (SELECT count(*)::int FROM messages WHERE status IN ('failed','undelivered') AND created_at >= now() - interval '7 days' AND ${notTest}) AS twilio_sms_failures,
      (SELECT count(*)::int FROM calls WHERE status = 'failed' AND created_at >= now() - interval '7 days' AND ${notTest}) AS twilio_call_failures,
      (SELECT count(*)::int FROM crm_queue WHERE done = false) AS crm_pending,
      (SELECT count(*)::int FROM crm_queue WHERE done = false AND attempts >= 8) AS crm_gave_up`);
  return { counts, times, target_min: target, sources: sources.rows, activity };
}

async function twilioStatus() {
  const s = await store.getStatuses();
  const settings = await store.getSettings();
  const pick = (k) => s[k] || { state: 'NO DATA YET' };
  return {
    twilio: tw.configured() ? 'CONNECTED' : 'NOT CONFIGURED',
    phone_number: tw.fromNumber() ? maskPhone(tw.fromNumber()) : 'not set',
    test_mode: tw.testMode(),
    allowed_test_numbers: tw.allowedTestNumbers().map(maskPhone),
    sms: pick('sms'), voice: pick('voice'), webhook: pick('webhook'), email: pick('email'), cron: pick('cron'),
    crm: { mode: crm.mode(), ...(s.crm || { state: crm.mode() === 'none' ? 'NOT CONFIGURED' : 'NO DATA YET' }) },
    last_test: s.last_test || null,
    last_twilio_failure: s.last_twilio_failure || null,
    alert_failure: s.alert_failure || null,
    owner_phone: settings.primary_phone ? maskPhone(settings.primary_phone) : 'not set',
    backup_phone: settings.backup_phone ? maskPhone(settings.backup_phone) : 'not set',
    webhook_urls: {
      sms: '/api/twilio?r=sms', voice: '/api/twilio?r=voice',
    },
  };
}

function agentPhone(settings, user) {
  const map = settings.agent_phones || {};
  return normalizePhone(map[user.name]) || (user.role === 'owner' ? normalizePhone(settings.primary_phone) : normalizePhone(settings.backup_phone));
}

module.exports = async (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const a = q.a;
  const body = req.body || {};

  if (a === 'login') {
    if (req.method !== 'POST') return sendJson(res, 405, {});
    if (!(await store.rateLimit(`login:${clientIp(req)}`, 6, 900))) return sendJson(res, 429, { error: 'Too many attempts. Wait 15 minutes.' });
    const user = auth.login(body.name, body.password);
    if (!user) { await store.audit(`unknown:${clean(body.name, 40)}`, 'login_failed', null, {}); return sendJson(res, 401, { error: 'Wrong name or password.' }); }
    res.setHeader('Set-Cookie', auth.cookieHeader(user));
    await store.audit(user.name, 'login', null, {});
    return sendJson(res, 200, { ok: true, user });
  }

  let user;
  try { user = auth.fromRequest(req); } catch (e) { return sendJson(res, 500, { error: e.message }); }
  if (!user) return sendJson(res, 401, { error: 'Sign in required' });

  if (a === 'logout') { res.setHeader('Set-Cookie', auth.clearCookie()); return sendJson(res, 200, { ok: true }); }

  const mutating = !READ_ACTIONS.includes(a);
  if (mutating && (req.method !== 'POST' || req.headers['x-crashhelp'] !== '1')) return sendJson(res, 403, { error: 'Bad request' });

  try {
    switch (a) {
      case 'me': return sendJson(res, 200, { user });

      case 'leads': {
        // The dashboard polls this; piggyback an escalation tick so alerts fire even if the external cron lags.
        escalation.tick().catch(() => {});
        return sendJson(res, 200, { leads: await listLeads(q), statuses: leads.STATUSES, now: new Date().toISOString() });
      }

      case 'lead': {
        const d = await leadDetail(q.id);
        if (!d) return sendJson(res, 404, { error: 'Not found' });
        await store.audit(user.name, 'viewed_lead', q.id, {});
        return sendJson(res, 200, d);
      }

      case 'status-change': {
        await leads.setStatus(body.lead_id, body.status, user.name);
        return sendJson(res, 200, { ok: true });
      }

      case 'follow-up': {
        // Set (or clear, with hours = 0) when to follow up with this lead.
        const hrs = Number(body.hours);
        const at = body.at ? new Date(body.at) : (hrs > 0 ? new Date(Date.now() + Math.min(hrs, 24 * 60) * 3600e3) : null);
        if (at && isNaN(at)) return sendJson(res, 400, { error: 'Bad follow-up time' });
        const cur = await db.one('SELECT lead_status FROM leads WHERE lead_id = $1', [body.lead_id]);
        if (!cur) return sendJson(res, 404, { error: 'Not found' });
        await db.query('UPDATE leads SET follow_up_at = $2, follow_up_note = $3, updated_at = now() WHERE lead_id = $1', [body.lead_id, at, clean(body.note, 300) || null]);
        if (at && leads.OPEN_STATUSES.includes(cur.lead_status)) await leads.setStatus(body.lead_id, 'FOLLOW-UP', user.name);
        await store.event(body.lead_id, at ? 'follow_up_set' : 'follow_up_cleared', at ? { at: at.toISOString(), note: clean(body.note, 300) } : {}, user.name);
        await crm.sync(body.lead_id, 'follow_up');
        return sendJson(res, 200, { ok: true, follow_up_at: at });
      }

      case 'mark-contacted': {
        await leads.setStatus(body.lead_id, 'CONTACTED', user.name);
        return sendJson(res, 200, { ok: true });
      }

      case 'assign': {
        await db.query('UPDATE leads SET assigned_to = $2, updated_at = now() WHERE lead_id = $1', [body.lead_id, clean(body.assigned_to, 60) || null]);
        await store.event(body.lead_id, 'assigned', { to: clean(body.assigned_to, 60) }, user.name);
        await store.audit(user.name, 'assigned', body.lead_id, { to: clean(body.assigned_to, 60) });
        return sendJson(res, 200, { ok: true });
      }

      case 'priority': {
        if (!leads.PRIORITIES.includes(body.priority)) return sendJson(res, 400, { error: 'Bad priority' });
        await db.query('UPDATE leads SET lead_priority = $2, updated_at = now() WHERE lead_id = $1', [body.lead_id, body.priority]);
        await store.event(body.lead_id, 'priority_changed', { to: body.priority }, user.name);
        return sendJson(res, 200, { ok: true });
      }

      case 'note': {
        const note = clean(body.note, 2000);
        if (!note) return sendJson(res, 400, { error: 'Empty note' });
        await store.event(body.lead_id, 'note', { text: note }, user.name);
        await store.audit(user.name, 'note', body.lead_id, {});
        return sendJson(res, 200, { ok: true });
      }

      case 'call': {
        const lead = await db.one('SELECT * FROM leads WHERE lead_id = $1', [body.lead_id]);
        if (!lead?.phone) return sendJson(res, 400, { error: 'This lead has no phone number.' });
        const settings = await store.getSettings();
        const mine = agentPhone(settings, user);
        if (!mine) return sendJson(res, 400, { error: 'Add your phone under Settings → Agent phones first.' });
        // Twilio rings YOU first, then dials the lead from the CrashHelp number. Your number stays private.
        const r = await tw.placeCall({ to: mine, purpose: 'staff_bridge', leadId: lead.lead_id,
          twimlQuery: `r=staff-connect&lead=${encodeURIComponent(lead.lead_id)}&actor=${encodeURIComponent(user.name)}` });
        await store.audit(user.name, 'call_lead', lead.lead_id, { ok: r.ok, reason: r.reason || r.error || null });
        if (!r.ok) return sendJson(res, 400, { error: r.reason === 'test_mode_blocked' ? 'Test mode: your phone is not in ALLOWED_TEST_NUMBERS.' : `Call failed: ${r.error || r.reason}` });
        return sendJson(res, 200, { ok: true, message: 'Calling your phone now. Answer and you will be connected.' });
      }

      case 'text': {
        const lead = await db.one('SELECT * FROM leads WHERE lead_id = $1', [body.lead_id]);
        const text = clean(body.body, 600);
        if (!lead?.phone || !text) return sendJson(res, 400, { error: 'Missing phone or message.' });
        if (!lead.contact_consent) return sendJson(res, 400, { error: 'This lead has not consented to contact. Call them back instead.' });
        const r = await tw.sendSms({ to: lead.phone, body: text, leadId: lead.lead_id, kind: 'consumer', purpose: 'staff_text' });
        if (r.ok) await leads.markAttempt(lead.lead_id, 'text', user.name);
        await store.audit(user.name, 'text_lead', lead.lead_id, { ok: r.ok, reason: r.reason || r.error || null });
        if (!r.ok) {
          const why = { opted_out: 'This person opted out of texts.', test_mode_blocked: 'Test mode is on and this number is not an approved test number.' }[r.reason] || r.error;
          return sendJson(res, 400, { error: why });
        }
        return sendJson(res, 200, { ok: true });
      }

      case 'email-logged': {
        await leads.markAttempt(body.lead_id, 'email', user.name);
        return sendJson(res, 200, { ok: true });
      }

      case 'metrics': return sendJson(res, 200, await metrics(q.test === '1'));
      case 'status': return sendJson(res, 200, await twilioStatus());

      case 'settings': {
        const s = await store.getSettings();
        return sendJson(res, 200, { settings: s, can_edit: user.role === 'owner' });
      }

      case 'save-settings': {
        if (user.role !== 'owner') return sendJson(res, 403, { error: 'Owner only' });
        const p = body.settings || {};
        const patch = {};
        for (const k of ['sms_alert', 'voice_alert', 'email_alert', 'consumer_confirmation_sms', 'consumer_confirmation_email']) if (k in p) patch[k] = !!p[k];
        if (['call_requests', 'all_leads'].includes(p.voice_alert_for)) patch.voice_alert_for = p.voice_alert_for;
        for (const k of ['primary_phone', 'backup_phone']) if (k in p) patch[k] = normalizePhone(p[k]);
        for (const k of ['primary_email', 'backup_email']) if (k in p) patch[k] = clean(p[k], 120).toLowerCase();
        if ('backup_call_delay_min' in p) patch.backup_call_delay_min = Math.max(0, Math.min(30, Number(p.backup_call_delay_min) || 0));
        if ('response_target_min' in p) patch.response_target_min = Math.max(1, Math.min(120, Number(p.response_target_min) || 5));
        if (Array.isArray(p.escalation)) {
          patch.escalation = p.escalation.slice(0, 6).map((r) => ({
            minutes: Math.max(1, Math.min(1440, Number(r.minutes) || 5)),
            notify: (r.notify || ['owner']).filter((x) => ['owner', 'backup'].includes(x)),
            voice: !!r.voice,
          })).sort((x, y) => x.minutes - y.minutes);
        }
        if (p.agent_phones && typeof p.agent_phones === 'object') {
          patch.agent_phones = Object.fromEntries(Object.entries(p.agent_phones).slice(0, 20).map(([n, ph]) => [clean(n, 40), normalizePhone(ph)]).filter(([n, ph]) => n && ph));
        }
        await store.saveSettings(patch);
        await store.audit(user.name, 'settings_saved', null, { keys: Object.keys(patch) });
        return sendJson(res, 200, { ok: true });
      }

      case 'test-alerts': {
        if (user.role !== 'owner') return sendJson(res, 403, { error: 'Owner only' });
        const settings = await store.getSettings();
        const result = { sms: null, voice: null, email: null };
        if (settings.primary_phone) {
          result.sms = await tw.sendSms({ to: settings.primary_phone, kind: 'internal', purpose: 'system_test', body: '✅ CrashHelp TX test alert. SMS alerts are working.' });
          if (body.voice) result.voice = await tw.placeCall({ to: settings.primary_phone, purpose: 'system_test', twimlQuery: 'r=whisper' });
        }
        if (settings.primary_email) result.email = await email.send({ to: settings.primary_email, subject: '✅ CrashHelp TX test alert', text: 'Email alerts are working.', purpose: 'system_test' });
        await store.setStatus('last_test', { by: user.name, sms: result.sms?.ok ?? null, voice: result.voice?.ok ?? null, email: result.email?.ok ?? null,
          sms_error: result.sms?.reason || result.sms?.error || null, voice_error: result.voice?.reason || result.voice?.error || null });
        return sendJson(res, 200, { ok: true, result });
      }

      case 'run-tick': return sendJson(res, 200, await escalation.tick());

      // ---- Staging self-checks (owner only; never return secret values) ----
      case 'env-check':
      case 'twilio-check':
      case 'test-numbers':
      case 'point-number':
      case 'run-e2e': {
        if (user.role !== 'owner') return sendJson(res, 403, { error: 'Owner only' });
        if (a === 'env-check') return sendJson(res, 200, { checks: await staging.envCheck(req) });
        // Never echo the Vercel bypass secret back to the browser, even to owners.
        const mask = (o) => { const b = process.env.VERCEL_AUTOMATION_BYPASS_SECRET; return b ? JSON.parse(JSON.stringify(o).split(b).join('•••')) : o; };
        if (a === 'twilio-check') return sendJson(res, 200, mask(await staging.twilioCheck()));
        if (a === 'test-numbers') return sendJson(res, 200, { numbers: staging.allowedForPicker(), test_mode: tw.testMode() });
        if (a === 'point-number') {
          if (body.confirm !== 'POINT NUMBER HERE') return sendJson(res, 400, { error: 'Type POINT NUMBER HERE to confirm.' });
          return sendJson(res, 200, mask(await staging.pointNumberHere(user.name)));
        }
        const result = await staging.runE2E({ leadPhoneIndex: body.phone_index, kind: body.kind === 'escalation' ? 'escalation' : 'chain' }, user.name);
        await store.audit(user.name, 'e2e_test_run', result.lead_id, { kind: result.kind });
        return sendJson(res, 200, result);
      }

      default: return sendJson(res, 404, { error: 'Unknown action' });
    }
  } catch (e) {
    console.error('admin error', a, e);
    return sendJson(res, 500, { error: e.message });
  }
};
