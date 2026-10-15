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

## Flags for the firm's lawyer (added 2026-10-15)
These are questions for counsel, not legal conclusions.
1. **Partner payouts (`partners.html`, offline since 2026-10-15).** The page offered tow drivers, body shops, clinics and individuals $100 per qualified lead and $200 per signed case. Review against Tex. Penal Code §38.12 and the Texas Disciplinary Rules before any version goes back up.
2. **Referral-service status.** The site describes CrashHelp TX as a "referral service" that connects people with "licensed Texas attorneys." Confirm how it is structured and paid under Tex. Occ. Code ch. 952 and the Disciplinary Rules on lawyer referral services and paying for referrals.
3. **Attorney relationship claims.** "Texas Attorney Referrals" and "connect you with a licensed Texas attorney" assume a real arrangement with at least one licensed attorney. Confirm it exists and how it should be described.
4. **Fee wording.** "No upfront fees" and the contingency explanation on every page. Confirm the wording, and whether costs and expenses need a disclosure.
5. **Legal facts on the page.** The 2-year filing deadline, the "less than 51% at fault" FAQ answer, and the uninsured-motorist answer. Confirm these are accurate and phrased properly.
6. **Advertising review.** If any page or ad counts as advertising for a lawyer or firm, confirm whether it needs filing or review under the Texas Bar advertising rules before paid ads run.
7. **Consent and privacy.** The SMS/call consent checkbox on `/start`, the privacy policy SMS section, and the terms. Confirm they meet TCPA and Texas requirements for this use.
8. **Old "Crash Alert" GitHub workflow on `main`.** It was built to alert on crashes found in public records. Outreach to people who did not contact us is out of scope; the owner is disabling it. Counsel should confirm no public-record outreach is ever used.
9. **Exit-intent popup.** The "No thanks, I don't want help" button wording. Confirm the firm is comfortable with that tone.
