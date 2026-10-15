# Staging runbook — deploy the `development` branch and run the live test

About 30 minutes, plus A2P approval time. Secrets go into Vercel and Twilio only, never into a chat.

## 1. Put the branch on GitHub (Ubuntu laptop)

```bash
cd ~/projects/caraccidenthelp
git fetch ~/Downloads/crashhelp-development.bundle development:development
git push -u origin development
```

Vercel builds a **Preview** for the branch automatically. Production (`main`) is untouched.

Your staging URL is the branch alias Vercel shows on the deployment page. Vercel → caraccidenthelp → Deployments → the `development` deployment → Domains. It looks like `caraccidenthelp-git-development-<your-team>.vercel.app` and stays the same on every push.

- Staging landing page: `<staging>/start`
- Staging lead form: `<staging>/start#request`
- Staging dashboard: `<staging>/admin`

## 2. Let Twilio reach the preview

Vercel → caraccidenthelp → **Settings → Deployment Protection** → set **Vercel Authentication** to **Disabled** (or "Only Production Deployments"). Twilio can't sign in to Vercel, so protected previews block every webhook and call callback. The dashboard's own login still protects lead data, and test mode still blocks every text and call outside your approved numbers.

## 3. Database

Vercel → caraccidenthelp → **Storage → Create → Neon (Postgres)** → connect to the project with **Preview** checked. That creates `DATABASE_URL` for you. Use a separate Neon branch or database from production later.

## 4. Environment variables (Preview scope only)

Vercel → caraccidenthelp → **Settings → Environment Variables → Add**. For each one, tick **Preview** only and untick Production.

| Variable | Value to paste |
| --- | --- |
| `PUBLIC_BASE_URL` | your staging URL from step 1, e.g. `https://caraccidenthelp-git-development-xyz.vercel.app` |
| `LANDING_PAGE_URL` | `<staging>/start` |
| `TWILIO_ACCOUNT_SID` | Twilio Console home → Account Info → Account SID |
| `TWILIO_AUTH_TOKEN` | Twilio Console home → Account Info → Auth Token (click to reveal) |
| `TWILIO_PHONE_NUMBER` | `+13468601929` |
| `TWILIO_TEST_MODE` | `true` |
| `ALLOWED_TEST_NUMBERS` | your cell and a second test phone, comma-separated, `+1` format |
| `OWNER_ALERT_PHONE` | your cell (`+1…`) |
| `BACKUP_ALERT_PHONE` | backup person's cell, or leave out |
| `OWNER_ALERT_EMAIL` | `crashhelptx@gmail.com` |
| `GMAIL_USER` | `crashhelptx@gmail.com` |
| `GMAIL_APP_PASSWORD` | Google Account → Security → 2-Step Verification → App passwords → create "CrashHelp" (16 letters) |
| `SESSION_SECRET` | run `openssl rand -hex 32` on the laptop and paste the output |
| `CRON_SECRET` | run `openssl rand -hex 16` and paste the output |
| `ADMIN_USERS` | `[{"name":"Josiah","role":"owner","password":"<pick one>"}]` |
| `CRM_MODE` | `none` for now (see CRM_ADAPTER.md to connect HighLevel later) |

Then Deployments → the `development` deployment → ⋯ → **Redeploy**, so it picks up the variables.

**The owner phone must also be in `ALLOWED_TEST_NUMBERS`,** or test mode blocks your own alerts. The env check flags this.

## 5. Verify from the dashboard

Open `<staging>/admin`, sign in, go to **Twilio & Systems**.

1. **Check environment variables** → every row should be CONFIGURED. Fix anything MISSING or INVALID in Vercel, then redeploy.
2. **Check Twilio number & A2P** → shows SMS/voice capability, where the webhooks point, and A2P status.
3. **Point CrashHelp number at this deployment** → type `POINT NUMBER HERE`. This sets incoming voice, incoming SMS and the call status callback to staging, and shows the old URLs so you can switch back.
   - Note: you have one Twilio number. While it points at staging, real calls and texts to (346) 860-1929 go to staging too. Test mode still blocks anything outbound except your approved numbers, and inbound calls still ring your phone. A second Twilio number for staging (about $1.15/month) avoids this. That's your call.
   - To set it by hand instead: Twilio Console → Phone Numbers → Manage → Active numbers → (346) 860-1929. Voice "A call comes in" = Webhook `<staging>/api/twilio?r=voice` (HTTP POST). "Call status changes" = `<staging>/api/twilio?r=call-status&purpose=inbound` (POST). Messaging "A message comes in" = `<staging>/api/twilio?r=sms` (POST). Save.
4. Set up the 1-minute pinger at cron-job.org: `<staging>/api/cron?key=<CRON_SECRET>`, every minute.

## 6. Run the live tests (all in test mode)

On **Twilio & Systems → End-to-end test**:

| Test | How | What should happen |
| --- | --- | --- |
| Chain + ringing phone | Pick your **second** test phone as the lead's phone → **Run chain test** | 12 steps show PASS. The second phone gets the confirmation text. Your phone gets the alert text and rings: "New CrashHelp TX test lead from Test in Houston. Press 1 to connect." Press 1 and the second phone rings from (346) 860-1929. Answer, talk a few seconds, hang up. The lead timeline shows answered → keypress → bridge → connected with duration. |
| Escalation | **Run escalation test** | Owner text now. At 1 min "STILL UNCONTACTED", at 2 min owner + backup "15-MINUTE", at 3 min final + a call. These are the TEST-only timers; real leads use 5/15/30. Mark it CONTACTED before minute 3 to prove it stops. |
| STOP | Text `STOP` to (346) 860-1929 from the second test phone | The lead shows TEXT OPT-OUT. Twilio sends its own opt-out reply. Text `START` to undo it. |
| Missed call | Call (346) 860-1929 from the second test phone and let it ring out | That phone gets the missed-call text. The dashboard shows a PENDING CONSENT record. You get a 📵 MISSED CALL text. |
| Failure protection | Already proven in automated tests (Twilio, email, CRM and database outages) | To see it live: temporarily set `GMAIL_APP_PASSWORD` to `x`, redeploy, and run the chain test. Email fails, texts still fire, and the error shows on the dashboard. |

Test leads only show under the **🧪 TEST leads only** filter, and they're excluded from all normal counts.

## 7. Before real leads

See the go-live list in the readiness report and LEGAL_REVIEW.md. Test mode stays on until you set `TWILIO_TEST_MODE=false` yourself.
