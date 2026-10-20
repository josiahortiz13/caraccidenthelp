# Legal review — before any live contact or ad spend

Not legal advice. Every item below needs a written yes from the partner firm's attorney before `TWILIO_TEST_MODE=false` or any campaign launch.

## Removed on this branch

**Crash-alert texts to partners (`api/crash-alert.js`, GitHub Action "Crash Alert").** Every 5 minutes it read Houston TranStar incidents and texted `PARTNER_PHONES`: "If you respond to this scene, hand the driver our card." Asking someone to solicit legal work from crash victims falls under Texas Penal Code §38.12 (barratry), which is a third-degree felony for the solicitor and exposes any lawyer who accepts those cases (§38.12(b)(3)). The files are deleted on the `development` branch.

**Until that branch is merged, the job is still running on `main`.** Disable it now: GitHub → Actions → Crash Alert → ⋯ → Disable workflow. Then delete `PARTNER_PHONES` in Vercel.

## Homepage claims — removed from production (commit 1612d08)

The settlement cards, review count and rating, "Cases Won" stats and bar badges are no longer on `main` (checked 2026-10-19). The `crash-alert` files are still on `main` until `development` is merged, so the GitHub workflow must stay disabled.

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

## Attorney partnership workflow — flags for counsel (added 2026-10-19)
Questions for the firm's attorney, not legal conclusions. Nothing below is switched on; each needs a written yes first.

10. **Lead transfer to the firm.** The dashboard can show leads to staff. No automatic transfer of lead details to an attorney or firm is built or enabled. Before any transfer: confirm the consumer's consent covers sharing with a named firm, what is shared, and how.
11. **Compensation.** Do not assume the existing partnership allows paid referrals, per-lead fees, per-case fees, revenue share or fee sharing. Confirm how (and whether) CrashHelp TX can be paid under Tex. Disciplinary Rules 7.03 and 5.04, Tex. Occ. Code ch. 952 and Tex. Penal Code §38.12. The ledger in the dashboard records revenue only as the owner enters it; it does not calculate per-lead payouts.
12. **Solicitation timing and channel.** Texas restricts lawyer solicitation of accident victims (including the 30-day rule for written solicitation in Gov't Code §82.0805 and Disciplinary Rule 7.03). All outreach here is inbound only: callbacks the person requested, the text quiz they started, and one missed-call text-back. Confirm this is acceptable and whether timing limits apply to the firm's follow-up.
13. **Advertising rules.** Meta and Google ads, landing pages, guides (`/houston-car-accident-checklist`, `/texas-crash-report`, `/insurance-adjuster-call`), the quiz and video scripts may count as lawyer advertising for the firm. Confirm whether they need the firm's approval, a responsible-attorney name, or Texas Bar Advertising Review filing before they run.
14. **Lawyer referral service status.** If CrashHelp TX refers to more than one firm or is paid for referrals, ch. 952 certification may apply. Do not search for or add other attorney partners until counsel answers this.
15. **Quiz wording.** The 5-question quiz asks when, injured, doctor, fault and area. It gives no case value, fault ruling or legal conclusion; injured people who haven't seen a doctor get a "get checked / call 911 in an emergency" notice. Confirm the wording.
16. **Privacy and ad tracking.** Ads tracking sends no accident, injury, medical or legal details to Meta or Google (Lead events carry only an event ID; automatic form capture is off). Confirm the privacy policy covers pixels and analytics, and that no sensitive data is used for audiences.
17. **HighLevel access.** If the firm gets HighLevel access, decide which fields it sees, who at the firm can log in, and how long leads are kept.
18. **Guide content.** Confirm the Texas legal facts on the three guide pages: duties after a crash under Transp. Code ch. 550, 30/60/25 minimum coverage, crash-report access, and the general deadline language.
