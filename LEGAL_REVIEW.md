# Legal review — before any live contact or ad spend

Not legal advice. Every item below needs a written yes from the partner firm's attorney before `TWILIO_TEST_MODE=false` or any campaign launch.

## Removed on this branch

**Crash-alert texts to partners (`api/crash-alert.js`, GitHub Action "Crash Alert").** Every 5 minutes it read Houston TranStar incidents and texted `PARTNER_PHONES`: "If you respond to this scene, hand the driver our card." Asking someone to solicit legal work from crash victims falls under Texas Penal Code §38.12 (barratry), which is a third-degree felony for the solicitor and exposes any lawyer who accepts those cases (§38.12(b)(3)). The files are deleted on the `development` branch.

**Until that branch is merged, the job is still running on `main`.** Disable it now: GitHub → Actions → Crash Alert → ⋯ → Disable workflow. Then delete `PARTNER_PHONES` in Vercel.

## Still live on the homepage (`index.html`) — not changed on this branch

- "Recent Texas Settlements" cards with dollar amounts
- "5.0 · Based on 47 Google reviews", 7 written reviews, and `ratingValue: 5.0` in the structured data
- "Cases Won" / "Recovered for Clients" stats, "We Fight. You Get Paid.", "3 Steps to Get Paid"
- "Licensed Texas Attorneys" and "State Bar of Texas" badges

Unless every number and review is real and attributable, remove them. Fake reviews are illegal under the FTC's 2024 rule, and results claims are regulated by the Texas attorney advertising rules the partner firm answers to. The new `/start` page avoids all of this.

## Confirm with the firm's attorney

| Item | Question to answer | Status |
| --- | --- | --- |
| Business model | Is CrashHelp TX a lawyer referral service under Tex. Occ. Code ch. 952 (needs state certification and the §952.151 ad statement), or the firm's own advertising? | Open |
| Payment | How is CrashHelp paid? No per-lead or per-case fees until approved. | Open |
| Partner relationship | Which firm receives leads, and does the firm review and approve all ad copy? | Open |
| Consent language | Approve the checkbox text on `/start` (call/text/email, automated means, not required to get help, STOP to opt out). | Open |
| Missed-call text-back | One text to someone who called the number. Confirm this is acceptable for the firm. | Open |
| SMS keyword flow | CRASH → YES consent, then name/city/contact. Confirm the YES wording is sufficient consent. | Open |
| Disclosures | "Referral service, not a law firm, not legal advice, no attorney-client relationship, no outcome promised" appear on `/start`. Confirm wording. | Open |
| A2P 10DLC | Brand + campaign registration approved by Twilio. | Open |
| Data handling | Who at the firm can see lead data, and how long it's kept. | Open |

## Built-in safeguards

- Consumers are only texted after they submit the form with the consent box checked, text CRASH and reply YES, or call the number (one text-back).
- Nobody is contacted from public crash data. The system has no feature that does this.
- STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT and REVOKE opt out immediately, and opted-out numbers are blocked at the send layer.
- Escalation only messages the team, never the consumer.
- Test mode blocks every text and call to numbers outside `ALLOWED_TEST_NUMBERS`.
- Lead statuses never label a "good case" or "bad case". Priorities are HIGH PRIORITY / NORMAL PRIORITY / LOW INFORMATION.
