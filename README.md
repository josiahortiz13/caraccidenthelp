# CrashHelp TX

Static site + Vercel serverless functions. Inbound lead response engine: form → database → instant confirmation → owner text, email and phone call → dashboard → CRM → escalation until someone responds.

| Path | What it is |
| --- | --- |
| `/start` | "Just crashed? Start here." checklist + 3-step lead form with consent and UTM/click-ID capture |
| `/admin` | Lead desk: live queue color-coded by response age, one-tap call/text, timeline, sources, Twilio status, settings |
| `api/lead.js` | Form intake. Saves first, then confirms, alerts, syncs. Falls back to text + email if the database is down. |
| `api/twilio.js` | Every Twilio webhook (inbound SMS/calls, owner alert call, press-1 bridge, missed-call text-back, STOP, status callbacks). Signature-validated. |
| `api/cron.js` | Escalation (5/15/30 min), backup calls, CRM retries. Ping every minute. |
| `api/admin.js` | Dashboard API. Signed session cookie, owner/staff roles, CSRF header, rate-limited login, audit log. |
| `lib/` | Database, Twilio wrapper (test mode + opt-out gates), email, CRM adapter, escalation |

**Setup:** `TWILIO_SETUP.md` · **CRM:** `CRM_ADAPTER.md` · **Before going live:** `LEGAL_REVIEW.md` · **Env vars:** `.env.example`

## Tests

```
npm install
npm test
```

16 end-to-end tests run the real API code against an in-process Postgres with simulated Twilio, email and HighLevel. Covered: form → DB → confirmation → owner/backup alerts → owner call → press 1 bridge → dashboard → CRM → email; missed call + text-back + YES flow; CRASH keyword flow; STOP/START; duplicates; Twilio outage; email outage; CRM outage + retry; 5/15/30 escalation; backup call on owner no-answer or voicemail; forged webhooks; auth, CSRF, roles; rate limits; dashboard actions; settings; old homepage form.

`npm run dev` starts the same harness on http://localhost:3999 (log in at `/admin` as Josiah / owner-pass).
