# Twilio setup — CrashHelp TX response engine

Everything is built and tested. These are the steps that need your logins. Do them in order.

## 1. Register for A2P 10DLC (do this first, it takes days)

US carriers block texts from local 10-digit numbers unless the business is registered. If your earlier "SMS not firing" problem showed error 30034 in Twilio's logs, this is the cause.

Twilio Console → Messaging → Regulatory Compliance → A2P 10DLC:
1. Create a **Customer Profile** (business name, EIN, address).
2. Register a **Brand**.
3. Register a **Campaign**: use case "Customer Care" (or "Mixed"), and paste the opt-in description below.
4. Put +1 346 860 1929 in that campaign's Messaging Service.

**Opt-in description for the campaign:**
> People request contact by submitting the form at crashhelptx.com/start and checking an unchecked consent box, by texting CRASH and replying YES, or by calling our number. Messages confirm their request and coordinate a callback. Reply STOP to opt out, HELP for help.

**Sample messages:** use the lead confirmation text and the missed-call text-back from `lib/leads.js` and `api/twilio.js`.

## 2. Point the number at the app

Twilio Console → Phone Numbers → Active numbers → (346) 860-1929:

| Setting | Value |
| --- | --- |
| Voice → A call comes in | Webhook, `https://www.crashhelptx.com/api/twilio?r=voice`, HTTP POST |
| Messaging → A message comes in | Webhook, `https://www.crashhelptx.com/api/twilio?r=sms`, HTTP POST |

If the number sits in a Messaging Service, set the incoming-message webhook on the service instead.

## 3. Opt-out keywords

Twilio's Advanced Opt-Out handles the carrier-required replies for STOP, START and HELP. The app records every opt-out in its own table too, and never texts an opted-out number. HELP gets Twilio's default reply, so the app's keyword flow is built around **CRASH** (HELP and START also work when nobody is opted out). Customize the HELP reply under Messaging Service → Opt-Out Management.

## 4. Environment variables (Vercel)

Copy `.env.example` into Vercel → Settings → Environment Variables. Required to go live:

- `DATABASE_URL`: add **Neon** from Vercel's Marketplace (free tier works). It creates the variable for you. Tables are created automatically on first request.
- `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
- `OWNER_ALERT_PHONE`, optionally `BACKUP_ALERT_PHONE`
- `ALLOWED_TEST_NUMBERS`: your cell and the backup's cell
- `SESSION_SECRET`, `ADMIN_USERS`, `CRON_SECRET`
- `GMAIL_APP_PASSWORD` (already set if the old alert email worked)

Old names still work: `TWILIO_FROM` = `TWILIO_PHONE_NUMBER`. `OWNER_PHONE` is replaced by `OWNER_ALERT_PHONE`.

**Remove** `PARTNER_PHONES` from Vercel. The crash-alert feature that used it has been deleted on this branch (see LEGAL_REVIEW.md).

## 5. Turn on the escalation timer (every minute)

Escalations, backup calls and CRM retries run when `/api/cron` is called. Vercel's free plan only runs crons once a day, so use a free pinger:

1. Sign up at cron-job.org.
2. New cron job, URL `https://www.crashhelptx.com/api/cron?key=YOUR_CRON_SECRET`, every 1 minute.

On Vercel Pro you can instead add `"crons":[{"path":"/api/cron","schedule":"* * * * *"}]` to `vercel.json`. Vercel sends the secret automatically.

The dashboard also runs an escalation check every time it refreshes (every 10 seconds while it's open), as a backup.

## 6. Test in test mode

1. Deploy the `development` branch (Vercel makes a preview URL). For the preview, set `PUBLIC_BASE_URL` to the preview URL and point the Twilio webhooks there while testing.
2. Open `/admin` → Twilio & Systems → **Send test text to owner**, then **Test text + call**.
3. Submit `/start` with **your own cell** (it's in `ALLOWED_TEST_NUMBERS`). Expect within seconds:
   - a confirmation text on your phone
   - the owner alert text
   - your phone ringing: "New CrashHelp TX lead from … Press 1 to connect." Pressing 1 calls the lead (you) from the CrashHelp number.
   - the lead on the dashboard with its timeline
4. Call the CrashHelp number from a test phone and don't answer. You should get the missed-call text-back.
5. Text STOP, then check the dashboard shows the opt-out.
6. Leave a lead uncontacted for 5 minutes and confirm the escalation text arrives.

## 7. Go live (only after you approve)

Set `TWILIO_TEST_MODE=false` in Vercel and redeploy. The dashboard badge flips from TEST MODE to LIVE.

## How the call flows work

- **New lead who asked for a call:** Twilio rings the owner. Owner hears the lead's first name and city and presses 1. Twilio dials the lead from the CrashHelp number, so the owner's cell is never shown. If the owner doesn't answer, or voicemail picks up, the backup phone rings after the delay set in Settings (default 2 minutes).
- **Inbound call:** rings owner and backup at once with a short "Incoming CrashHelp TX call" whisper. If nobody answers in 20 seconds, the caller hears a short message, gets one text-back, and shows up on the dashboard as PENDING CONSENT.
- **One-tap call from the dashboard:** Twilio rings your phone (set it under Settings → Agent phones), then connects you to the lead from the CrashHelp number.
