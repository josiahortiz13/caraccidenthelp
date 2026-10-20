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


## A2P 10DLC campaign: exact values to paste (prepared 2026-10-19)
Brand is already approved. Register the campaign on a Messaging Service that holds +1 346-680-5398.

- **Use case:** Customer Care
- **Campaign description:** CrashHelp TX helps people involved in Texas car crashes request help. People who submit our website form (with the consent checkbox) or text a keyword to our number and reply YES receive a confirmation of their request, a short set of questions about their crash, and follow-up messages about that request. Messages are only sent to people who asked to be contacted. We do not send marketing to purchased lists or public records.
- **Sample message 1:** Hi Maria, this is CrashHelp TX. We received your request and someone will follow up shortly. Reply STOP to opt out.
- **Sample message 2:** CrashHelp TX: answer 5 quick questions about your Texas crash and we will contact you by call or text about it. Reply YES to start. Msg & data rates may apply. Msg frequency varies. Reply STOP to opt out, HELP for help.
- **Sample message 3:** Thanks Maria. When did the crash happen? Reply 1 = Today, 2 = Last few days, 3 = Within a month, 4 = Longer ago
- **How do end-users consent:** Web form at https://www.crashhelptx.com/connect: the person enters their name and phone and checks an unchecked-by-default box reading "I agree that CrashHelp TX and the attorneys or professionals it refers me to may contact me about this request by call or text at the number I entered, including by automated means. Consent is not required to get help; you can call us instead. Message and data rates may apply. Reply STOP to opt out." Or by text: the person texts CRASH or QUIZ to +1 346-680-5398, receives the opt-in message above, and replies YES. Privacy policy: https://www.crashhelptx.com/privacy · Terms: https://www.crashhelptx.com/terms
- **Opt-in keywords:** YES, CRASH, QUIZ, START · **Opt-out keywords:** STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT · **Help keywords:** HELP, INFO
- **Opt-in message:** (sample message 2)
- **Opt-out message:** You have successfully been unsubscribed from CrashHelp TX. You will not receive any more messages from this number. Reply START to resubscribe.
- **Help message:** CrashHelp TX: help after a Texas crash. Call (346) 860-1929 or visit https://www.crashhelptx.com/connect. Msg & data rates may apply. Reply STOP to opt out.
- **Embedded links:** Yes · **Embedded phone numbers:** Yes · **Age-gated content:** No · **Direct lending:** No · **Affiliate marketing:** No

**Reviewers open the consent URL and privacy policy.** /connect and the updated privacy/terms (SMS section) must be live on www.crashhelptx.com before the campaign is submitted.

**After approval:** set CONSUMER_SMS_ENABLED=true (only after the owner says go).

## Texting on the business number (346) 860-1929 — checked 2026-10-20 (read-only)

- The number is **not** on this Twilio account or any subaccount. Its calls run through another provider, so Twilio cannot send or receive texts on it. Nothing here changes its voice service.
- Twilio's Hosted SMS API (adds texting to a number while voice stays put) is not enabled on this account (`/v2/HostedNumber/Orders` not found). It is a Developer Preview that needs early access, and it only works for landline or toll-free numbers that don't already text through another provider.
- The Twilio texting number (ends 5398) is in a Messaging Service with **no A2P campaign**. All 34 outbound texts in the last 14 days were blocked by carriers (error 30034).

Options, none of which touch the business number's calls:
1. **Recommended:** register the A2P campaign on the existing Messaging Service and text from the 5398 number. Keep 860-1929 for calls.
2. Request Twilio Hosted SMS early access for 860-1929 (only if it is a landline/VoIP line that doesn't text today), sign the LOA, then register it in the same campaign.
3. Ask the current provider of 860-1929 whether it offers registered business texting there.
Porting 860-1929 to Twilio would move its calls and is **not** recommended without your explicit approval.
