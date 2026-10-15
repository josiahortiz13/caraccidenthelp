// Internal escalation. Runs on every cron tick (and whenever the dashboard polls).
// Only staff are messaged here — the consumer is never re-texted by escalation.
const db = require('./db');
const store = require('./store');
const tw = require('./twilio');
const email = require('./email');
const crm = require('./crm');
const leads = require('./leads');

function ageMinutes(lead) {
  return Math.floor((Date.now() - new Date(lead.created_at).getTime()) / 60000);
}

function message(rule, lead, levelIndex) {
  const mins = rule.minutes;
  const who = `${lead.first_name || 'Unknown'} — ${lead.phone || lead.email || 'no contact'}`;
  if (levelIndex === 0) {
    return `⚠️ CRASHHELP LEAD STILL UNCONTACTED\nLead: ${lead.lead_id}\n${who}\n${mins} minutes old.\n${leads.adminUrl(lead.lead_id)}`;
  }
  return `🚨 ${mins}-MINUTE RESPONSE ALERT\nThis lead has not been contacted.\nLead: ${lead.lead_id}\n${who}\n${leads.adminUrl(lead.lead_id)}`;
}

async function escalateLeads() {
  const settings = await store.getSettings();
  const rules = (Array.isArray(settings.escalation) ? settings.escalation : [])
    .filter((r) => Number(r.minutes) > 0)
    .sort((a, b) => a.minutes - b.minutes);
  if (!rules.length) return { escalated: 0 };

  const open = await db.query(
    `SELECT * FROM leads WHERE lead_status = ANY($1) AND first_contact_at IS NULL AND duplicate_of IS NULL
       AND escalation_level < $2 AND created_at > now() - interval '3 days'`,
    [leads.OPEN_STATUSES, rules.length]
  );
  let escalated = 0;
  for (const lead of open.rows) {
    const age = ageMinutes(lead);
    // Find the highest rule this lead has reached but not yet fired. Skipped levels collapse into one alert.
    let target = -1;
    for (let i = lead.escalation_level; i < rules.length; i++) if (age >= rules[i].minutes) target = i;
    if (target < 0) continue;

    // Claim the level first so overlapping ticks can't double-send.
    const claimed = await db.one(
      'UPDATE leads SET escalation_level = $2, updated_at = now() WHERE lead_id = $1 AND escalation_level = $3 RETURNING lead_id',
      [lead.lead_id, target + 1, lead.escalation_level]
    );
    if (!claimed) continue;

    const rule = rules[target];
    const body = message(rule, lead, target);
    const targets = await leads.alertTargets(settings, rule.notify || ['owner']);
    const results = [];
    for (const t of targets) {
      if (t.phone) results.push(await tw.sendSms({ to: t.phone, body, leadId: lead.lead_id, kind: 'internal', purpose: `escalation_${rule.minutes}m_${t.role}` }));
      else if (t.email) results.push(await email.send({ to: t.email, subject: body.split('\n')[0], text: body, leadId: lead.lead_id, purpose: `escalation_${rule.minutes}m_${t.role}` }));
    }
    // If every SMS failed, fall back to email so the escalation still lands somewhere.
    if (!results.some((r) => r.ok)) {
      for (const t of targets.filter((x) => x.email)) {
        await email.send({ to: t.email, subject: body.split('\n')[0], text: body, leadId: lead.lead_id, purpose: `escalation_${rule.minutes}m_email_fallback` });
      }
    }
    if (rule.voice && settings.voice_alert && settings.primary_phone) {
      await tw.placeCall({ to: settings.primary_phone, purpose: 'escalation_call', leadId: lead.lead_id, machineDetection: true,
        twimlQuery: `r=owner-alert&purpose=escalation&lead=${encodeURIComponent(lead.lead_id)}` });
    }
    await store.event(lead.lead_id, 'escalated', { minutes: rule.minutes, level: target + 1, notified: targets.map((t) => t.role) });
    escalated++;
  }
  return { escalated };
}

async function placeDueBackupCalls() {
  const settings = await store.getSettings();
  if (!settings.backup_phone) return { placed: 0 };
  const due = await db.query(
    `UPDATE leads SET backup_call_due_at = NULL
     WHERE backup_call_due_at IS NOT NULL AND backup_call_due_at <= now() AND first_contact_at IS NULL
     RETURNING *`
  );
  for (const lead of due.rows) {
    await tw.placeCall({ to: settings.backup_phone, purpose: 'backup_alert', leadId: lead.lead_id, machineDetection: true,
      twimlQuery: `r=owner-alert&purpose=backup&lead=${encodeURIComponent(lead.lead_id)}` });
    await tw.sendSms({ to: settings.backup_phone, kind: 'internal', purpose: 'backup_alert_text', leadId: lead.lead_id,
      body: `📞 Owner didn't answer. Backup needed for CrashHelp lead ${lead.lead_id}: ${lead.first_name || ''} ${lead.phone || ''}\n${leads.adminUrl(lead.lead_id)}` });
  }
  return { placed: due.rows.length };
}

async function tick() {
  const out = {};
  for (const [name, fn] of [['escalation', escalateLeads], ['backup_calls', placeDueBackupCalls], ['crm_retry', crm.retryQueue]]) {
    try { out[name] = await fn(); } catch (e) { out[name] = { error: e.message }; console.error('tick step failed', name, e); }
  }
  await store.setStatus('cron', { state: 'WORKING', result: out });
  return out;
}

module.exports = { tick, escalateLeads, placeDueBackupCalls };
