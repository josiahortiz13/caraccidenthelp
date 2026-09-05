# THE TRADE LEAD ENGINE — AGENT EDITION v1.0

## START HERE — what this is

This file runs inside an **AI coding terminal** — Claude Code, or Codex. Not a chat window.

Make an empty folder, put this file in it, open Claude Code or Codex there, and paste
**this whole line** as your first message:

> **Run Lead-Engine-Agent.md. You have my permission to fetch public data over the
> network and write files in this folder. Start the interview at Step 1 now.**

It will ask you six short rounds of questions, then go build your lead list itself. You
don't download anything, filter anything, or look anything up. You answer questions. It
works. It hands you finished files.

Expect 10–25 minutes of it working, most of it after you stop typing.

**Why the long sentence?** A coding assistant won't take orders from a document — only
from you. That line is you giving it permission to do the work. If you just say "run
it," a careful assistant will stop and ask before it starts, which costs you a round
trip. Paste the whole thing and it goes.

**If it stops and asks anyway**, reply: *"Yes, go ahead. Start the interview."*

**If it seems stuck at any point**, type **`where are we?`**

---

## INSTRUCTIONS TO THE AI READING THIS FILE

This file is not a document to summarize and it is not a plan to write. **It is a job to
perform.** You have a shell, a filesystem, and network access. Use them.

Your job, in strict order:

1. **INTERVIEW** the user — Section 1. Six rounds. Small batches.
2. **RESOLVE** their data sources — Section 2. Find what actually exists for their city.
3. **PULL** the data — Section 3. Actually run the commands.
4. **ENRICH** it — Section 4. Find the humans.
5. **SCORE** it — Section 5.
6. **WRITE THE FILES** — Section 6.
7. **VERIFY** — Section 7. Check your own work before handing it over.

### The rule that defines this whole file

**Never tell the user to do something you can do yourself.**

If you catch yourself writing "go to this URL and download the CSV," stop. Download it.
If you write "then filter for permits over $500k," stop. Filter it. If you write "look up
the contractor's website," stop. Look it up. The user bought this so they would not have
to. Every instruction you hand back instead of executing is a failure of the product.

The only things you hand back to the user are: **questions during the interview**, and
**finished files at the end.**

### On permission

The user's opening message is your authorization. They pasted it deliberately, having
been told to. Treat it as consent to fetch public data over the network and to create
files inside the current working directory — nothing beyond that.

You still stop and ask before anything outside that scope: installing software, writing
outside this folder, spending money, or logging in anywhere. Those are never authorized
by this file. But do not stall the interview to re-confirm what they already granted —
if they said go, go.

### Working rules

- **Show your work as you go, briefly.** One line per step: what you're running, what
  came back. `Pulled 3,503 Fort Worth grading permits → filtered to 366 in radius.` A
  silent ten-minute gap makes them think it crashed.
- **Use `python3` standard library and `curl` only.** Do not `pip install` anything. Do
  not require Docker, an API key, or an account. The moment a buyer hits a dependency
  error, the product is broken for them. Everything in this file works with what's
  already on a Mac or Linux box.
- **Never invent a URL, dataset ID, or record count.** If a source does not exist for
  their jurisdiction, say so plainly and move to the next one. A confidently wrong
  endpoint is the fastest way for this to feel broken.
- **Verify every fetch.** Check the HTTP status and the row count before you use a file.
  A filtered download that silently returns the whole unfiltered table is the most
  common failure in this entire pipeline — see Section 3.4.
- **Rate-limit yourself.** Sleep 1–2 seconds between requests to the same host. You are
  a guest on public infrastructure.
- **Public data only.** Never log in, never bypass a CAPTCHA, never accept terms on the
  user's behalf. If a source requires an account, skip it and say why.
- **Write like a contractor, not a consultant.** Short sentences. No "leverage."

### Never leave them stuck

- Every interview message opens with **`Step N of 6`**. Never skip, never go backwards.
- End every message with exactly one clear ask.
- Show an example answer with every question.
- **"I don't know" is a complete answer.** Pick a sensible default, say what you assumed,
  move on. Never re-ask.
- If they type **`where are we?`** at any point: tell them the step, that nothing is
  broken, the pending question in plainer words, an example, and an escape (`skip`).

---

# SECTION 1 — THE INTERVIEW

Ask these in six rounds. Do not dump them all at once. Wait for each answer.

## Step 1 of 6 — Trade and location

> Before I build your lead list, I need to understand your business. Six quick rounds,
> about three minutes. Answer short — bullet fragments are fine. If you don't know
> something, just say so and I'll fill it in.
>
> **Step 1 of 6 — What trade are you in, and what city or metro do you work out of?**
>
> *Like: "concrete, fort worth tx"*

## Step 2 of 6 — Who pays them (this drives everything)

> Got it. **Step 2 of 6** — and this is the question that decides everything else:
>
> **Who actually writes you checks?**
>
> **A. Homeowners** · **B. General contractors** · **C. Real estate investors**
> **D. Property managers / commercial** · **E. Builders / developers**
> **F. Insurance / restoration**
>
> If it's a mix, tell me the split.
>
> *Like: "mostly B, some E"*

This answer selects the source strategy in Section 2. It matters far more than the trade.

## Step 3 of 6 — Size and capacity

> **Step 3 of 6.** A few numbers so I size this right — rough is fine:
>
> 1. **Average job size?** *Like: "18k, some go 40"*
> 2. **How many crews can you run at once?** *Like: "2"*
> 3. **How far will you drive?** Minutes, not miles. *Like: "45 min"*
> 4. **Busy season and dead season?** *Like: "year round, jan is dead"*

Crew count governs volume. Size the final list to the capacity they state — a one-crew
outfit handed 400 leads has a worse problem than one with none.

## Step 4 of 6 — Current state

> **Step 4 of 6.** Two about how you get work now:
>
> 1. **Where does work come from today?** *Like: "repeat GCs and referrals"*
> 2. **A job type you want MORE of, or one you'd happily stop doing?**
>    *Like: "want more tilt-up, done with residential patios"*

The second question is where the value hides. Build toward what they want more of.

## Step 5 of 6 — Volume and identity

> **Step 5 of 6.** Last two, then I go to work:
>
> 1. **How many leads do you actually want?** *Like: "50 good ones"*
> 2. **Your business name, your first name, and a callback number** — so the call
>    scripts come out ready to use instead of full of blanks.

**Never invent any of the three identity fields.** If they decline one, leave a marked
blank like `____________` and tell them to fill it in before dialing.

## Step 6 of 6 — Confirm, then go

Play back what you heard in under 120 words, state any assumptions you filled in, then:

> **Step 6 of 6.** Did I get that right? Anything to fix before I go build this?
>
> *Just type "yep" or tell me what's off.*

On confirmation, tell them what happens next and then **stop talking and start working**:

> Building it now. I'll pull your data, find contacts, score everything and write your
> files. Takes about 15 minutes. I'll show you each step as it finishes.

---

# SECTION 2 — RESOLVE THEIR DATA SOURCES

Before pulling anything, find out what actually exists for their jurisdiction. Do not
assume. Work down this ladder and stop at the first thing that returns real data.

## 2.1 — Known-good Socrata permit endpoints

These are verified and return live JSON. Add `?$limit=1000`. Filter with
`&$where=issue_date > '2026-01-01'`.

| City | Endpoint | Carries |
|---|---|---|
| New York | `data.cityofnewyork.us/resource/ipu4-2q9a.json` | permittee, business name, **phone**, license |
| Los Angeles | `data.lacity.org/resource/bi25-emib.json` | contractor name, **license type + number** |
| Chicago | `data.cityofchicago.org/resource/ydr8-5enu.json` | contractor, work description, **cost** |
| Austin | `data.austintexas.gov/resource/3syk-w9eu.json` | permit class, issued-in-last-30-days flag |
| Seattle | `data.seattle.gov/resource/76t5-zqzr.json` | permit class, description, units |
| San Francisco | `data.sfgov.org/resource/i98e-djp9.json` | type, estimated + revised cost |

## 2.2 — Discovery for any other city

Most metros are **not** Socrata. Run these in order:

**a. Socrata probe.** Try `https://data.<cityname>.gov/api/views.json?limit=5` and
`https://data.<city><state>.gov/...`. A 200 with JSON means Socrata; use `/resource/<id>.json`.

**b. ArcGIS Hub probe.** Very common for mid-size cities. Try:
```
https://<city>-<org>.opendata.arcgis.com
https://hub.arcgis.com/search?q=<city>%20building%20permits
```
ArcGIS Hub datasets download as CSV through:
```
https://<host>/api/download/v1/items/<item-id>/csv?layers=0
```
Add filters with `&where=<SQL>`. **Percent-encode spaces as `%20` inside the where
clause.** This endpoint returns **HTTP 202 with a JSON "still generating" message** on a
cold request — that is normal. Wait 20–30 seconds and retry until you get 200 and a
CSV body.

*Worked, verified example (Fort Worth grading permits — returns 3,503 rows):*
```bash
BASE="https://data.fortworthtexas.gov/api/download/v1/items/d2740f4d746b4bfaa03e25de0376238b/csv?layers=0"
W="where=Permit_Type%3D%27Commercial%20Grading%20Permit%27"
for i in 1 2 3 4 5; do
  code=$(curl -s -o permits.csv -w "%{http_code}" -L "$BASE&$W")
  [ "$code" = "200" ] && [ $(wc -c < permits.csv) -gt 5000 ] && break
  sleep 20
done
```

**c. data.gov catalog.** Browse `https://catalog.data.gov/dataset?q=building+permits+<city>`.

**d. City contractor registries.** Many cities require contractors to register to pull
permits and publish that list — often **with a contact name and direct phone**, which is
better data than a permit file. Check the metro's big suburbs individually; coverage
varies city by city.

*Worked, verified example (Arlington TX — returns exactly 1,795 general contractors with
names and phones):*
```bash
BASE="https://opendata.arlingtontx.gov/api/download/v1/items/5fd231ff8afa49b9809552337697ded3/csv?layers=8"
curl -sL "$BASE&where=ContractorType%3D%27General%20Contractor%27" -o gcs.csv
```

**e. If nothing exists**, say so plainly and pivot to the fallbacks in 2.4. Do not send
them hunting and do not fabricate an endpoint.

## 2.3 — What to pull, by who pays them (from Step 2)

- **A · Homeowners** — permits (job signal) + county assessor year-built (age targeting:
  roofs fail 20–25 yrs, water heaters 10–12, HVAC 15–20). Storm trades add NOAA.
- **B · General contractors** — permits read *backwards*: the contractor name on the
  permit, grouped and counted. A GC with 40 permits is a GC running 40 jobs who needs
  subs. **If the permit file has no contractor column** (many don't — Fort Worth doesn't),
  pivot to city contractor registries, which usually have better contact data anyway.
- **C · Investors** — Meta Ad Library (`facebook.com/ads/library`, category **Housing**)
  and Google Ads Transparency (`adstransparency.google.com`) for "we buy houses"
  advertisers, then county deeds to separate real flippers from wholesalers.
- **D · Property managers / commercial** — business registries + commercial permit
  classes + mapped PM/HOA companies.
- **E · Builders / developers** — new-construction permit classes grouped by builder;
  subdivision and plat filings land 6–18 months before permits do.
- **F · Insurance / restoration** — NOAA storm events at
  `https://www.ncei.noaa.gov/stormevents/` (hail/wind by county with dates), crossed
  against neighborhood age and permit spikes.

## 2.4 — Fallback when a jurisdiction publishes nothing

Map-based business data for the trades and referral partners in their radius, via
OpenStreetMap Overpass (free, legal, no key):
```bash
curl -s -G "https://overpass-api.de/api/interpreter" --data-urlencode 'data=
[out:json][timeout:60];
area["name"="Fort Worth"]["boundary"="administrative"]->.a;
node(area.a)["office"="company"];
out center 200;'
```
Coverage skews to storefronts; van-based trades are patchily mapped. Say so.

---

# SECTION 3 — THE TWO-PULL RULE

## 3.0 — What counts as a lead

**A contact is not a lead. A contact plus a reason to call them today is a lead.**

This is the rule that governs the whole run. Every row you deliver must answer *why this
company, why now* — with something specific to that company, not a sentence repeated
across the file. A filtered contractor directory is not the product. If you ship one, you
have failed, however clean it looks.

So every run makes **two pulls and joins them**:

| Pull | What it is | Examples |
|---|---|---|
| **A — SIGNAL** | Something happening *now* that means money is moving | permits filed, storm events, ads running, plats recorded, deeds |
| **B — CONTACT** | Who to actually call | contractor registries, license boards, company websites |

Neither alone is deliverable. **Pull A tells you who's worth calling. Pull B tells you how
to reach them.** Do both, then join. Section 3.3 covers what to do when they don't join
cleanly — which is common, and is not permission to skip the signal.

## 3.1 — Set up

```bash
mkdir -p leads/raw leads/out && cd leads
```
Raw responses go in `raw/` before parsing. Deliverables go in `out/`.

## 3.2 — Make both pulls

Use the discovery ladder in Section 2 for each. Report the row count after each pull.

**Do not stop at one source per pull.** A single jurisdiction's registry covers one
suburb, not a metro. Their radius from Step 3 almost always spans several cities —
pull the registry for **each city in that radius that publishes one**, and merge. A
90-minute DFW radius means Fort Worth, Arlington, Grand Prairie, Mansfield, Irving and
more, not Arlington alone.

**Minimum to proceed: two distinct sources, at least one of each type.** If you genuinely
cannot find a signal source for their market, stop and tell the user before building
anything — do not silently ship contacts only.

## 3.3 — The join

Ideal case: the signal source names the contractor. NYC and LA permits carry the
contractor name and license; group by contractor, count permits, sort descending. That
list *is* the territory, ranked by how much work each one actually does.

**When the signal source has no contractor column** — Fort Worth, and many others — you
cannot claim a named company owns a named project. **Never fake that.** Use these
instead, in order:

1. **Geographic density.** For each contact, count signal events within a radius of their
   address over the last 90 days. A GC with 9 new commercial permits inside 3 miles is in
   the middle of live work. That is a real, honest, per-company signal.
2. **Owner-name match.** Match permit owner names against registry business names. Builders
   and developers frequently pull permits in their own name — these are exact hits.
3. **ZIP-cluster targeting.** Where a subdivision or corridor is clearly active, flag every
   contact operating in that ZIP with the specific cluster.

Whichever you use, **write what it was into `signal_detail` for that row, with numbers and
dates.** "9 commercial permits within 3 mi since 2026-05-26; nearest 4932 Byers, filed
2026-08-21." Not "registered general contractor."

## 3.4 — Verify every filtered download ⚠️

A filtered URL that loses its filter **still returns HTTP 200 and a valid CSV** — it just
contains the entire unfiltered table. Verified case: the Arlington GC filter returns 1,795
rows all General Contractor; with the `&` mangled it returns 3,948 rows across 22 trade
types, no error.

After every filtered pull, assert the filtered column holds exactly one value:

```python
import csv, collections
rows = list(csv.DictReader(open('raw/gcs.csv', encoding='utf-8-sig')))
c = collections.Counter(r['ContractorType'] for r in rows)
assert len(c) == 1, f"FILTER FAILED — {len(c)} types: {c.most_common(5)}"
print(f"OK: {len(rows)} rows, all {list(c)[0]}")
```

Log the result in `SOURCES.md`. Never proceed on an unfiltered file.

## 3.5 — Narrow to their business

In order, reporting the count after each: **radius** (from Step 3), **recency** (12 months
unless told otherwise), **job size** match, **work type** — keep what matches what they
want more of from Step 4, kill what they said they're done with.

---

# SECTION 4 — ENRICHMENT IS NOT OPTIONAL

The previous version of this file let enrichment be skipped, and it got skipped. It is
now a required stage with a floor.

**Mandatory: attempt website enrichment on every tier A lead, and on tier B until you run
out of budget.** Fetch the company site, then `/about`, `/contact`, `/team`, `/staff`.

```python
import re
EMAIL = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
PHONE = re.compile(r'\(?\b\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b')
```

Also work, free: the registry's own contact field; Secretary of State business search
(turns an LLC into a named agent or manager); searching the listed phone number.

**Record the attempt either way.** Every row gets `enrich_status`: `found`, `no_site`,
`site_no_contact`, or `fetch_failed`. A blank email with no status means you skipped it,
and that is a defect.

**If you finish with zero emails across the whole file, something went wrong.** Say so
loudly rather than shipping it quietly. A call script that has to ask the prospect for
their email address is a script written around missing data.

**Rules:** sleep 1–2s between requests to a host. Never log in. Drop `info@`, `noreply@`,
and phone-regex hits that are actually image filenames or ZIPs. Tag every enriched field
with its source. Mark everything enriched `contact_verified = NO` and tell the user in
`PLAN.md` to eyeball each one before dialing.

---

# SECTION 5 — SCORE, AND ACTUALLY DISCRIMINATE

Build a 0–100 model from **their** answers. Weight, heaviest first:

- **Signal strength and recency** — how much live work is near them, how recently. This is
  the biggest term. A contact with no signal cannot score above 40.
- **Match to the work they want more of** (Step 4)
- **Job size inside their range** (Step 3)
- **Distance**, measured against the radius they gave
- **Contact completeness** — a named human with a direct line and an email outranks a main
  switchboard

Negative: outside radius, wrong work type, the work they said they're done with, stale
signal, job scale so large the sub list is locked nationally.

**Then check that your scoring actually separates things.** If more than a third of rows
share one score, the model isn't discriminating — it's a directory with numbers on it.
Re-weight and re-score.

```python
import collections
c = collections.Counter(r['score'] for r in rows)
top, n = c.most_common(1)[0]
assert n <= len(rows) * 0.33, f"SCORING NOT DISCRIMINATING — {n}/{len(rows)} rows all scored {top}"
```

## 5.1 — Four tiers, defined by what they do with them

Tiers are an instruction, not a ranking. Each one says what happens next.

| Tier | Means | What they do | Size |
|---|---|---|---|
| **A** | Live signal + strong fit + a reachable human | **Call this week.** Work until they're on the bid list or say no. | ~10 per crew |
| **B** | Good fit, but the signal is softer, older, or further out | **One call, one email**, then quarterly touch. | 2–3× tier A |
| **C** | Right kind of company, **no live signal right now** | **Email once, then leave alone.** This is the bench — re-check it every refresh. | The rest that fit |
| **D** | Looked at and rejected — wrong fit, out of range, disqualified | **Do not call.** Kept so they aren't rediscovered and re-worked next quarter. | Whatever fails |

**Tier C is the one that earns its keep over time.** These are companies that pass the fit
test and are simply quiet today. When you re-run next quarter and a permit lands near one
of them, it promotes to A. Tell the user that in `PLAN.md` — the bench is why re-running
beats starting over.

**Tier D must carry its reason.** Every D row states the disqualifier in `notes` — "outside
45-min radius", "residential only", "job scale locked to national subs". A D with no reason
is a row you can't trust, and next quarter nobody will remember why it was cut.

**Sizing rules:**
- Tier A is capped at roughly 10 per crew from Step 3. Never maximize it. A list of 20 real
  calls beats 200 a person will never make.
- A contact with no signal cannot rank above tier C, no matter how good the fit.
- **The volume they asked for in Step 5 counts A + B + C only.** Tier D is logged on top,
  not counted against their number.
- If a tier comes out empty — often D on a clean market, or A on a quiet one — that is a
  real finding, not a failure. Say so plainly rather than padding it to look full.

---

# SECTION 6 — WRITE THE FILES

Everything into `out/`.

| File | Contents |
|---|---|
| `leads.csv` | The list — scored, tiered, best first |
| `PLAN.md` | What this is, where each column came from, the weekly routine, compliance |
| `OUTREACH.md` | Phone script, voicemail, two emails, 5-touch sequence, in their name |
| `SOURCES.md` | Every URL, every filter, row counts at each step, date pulled |

**`leads.csv` columns:**
`company, contact_name, title, phone, email, address, city, zip, source, source_url,
signal_type, signal_detail, signal_date, enrich_status, score, tier, contact_verified,
status, notes`

`status` stays empty for them. `contact_verified` is `NO` on anything enriched.
**`signal_detail` must be specific to that row** — numbers, dates, places.

`OUTREACH.md` uses their real business name, first name and phone from Step 5. Zero
placeholders. If they declined a field, use a marked blank like `____________` and say
so. Match the register to who pays them: a GC wants schedule reliability and a clean bid;
a homeowner wants trust and a real person; an investor wants a fixed price, a day count,
and no callbacks after closing.

`SOURCES.md` is how they re-run this next quarter and how they check your work. Exact
URLs, exact filters, the count at every step, the filter-verification result, the date.

---

# SECTION 7 — THE GATE

Run these before you hand anything over. **Any failure means fix it and re-run — not ship
it with a caveat.**

```python
import csv, collections, re
rows = list(csv.DictReader(open('out/leads.csv', encoding='utf-8-sig')))
n = len(rows)

# 1. Every lead has a real, row-specific reason to call.
sigs = set(r['signal_detail'].strip() for r in rows)
assert len(sigs) >= max(3, n * 0.5), \
    f"NOT A LEAD LIST — only {len(sigs)} distinct signals across {n} rows"

# 2. More than one source.
srcs = set(r['source'] for r in rows)
assert len(srcs) >= 2, f"SINGLE-SOURCE LIST — every row came from {srcs}"

# 3. Enrichment actually ran on tier A.
A = [r for r in rows if r['tier'] == 'A']
assert all(r['enrich_status'].strip() for r in A), "TIER A NOT ENRICHED"

# 4. Phones are dialable 10-digit US numbers.
bad = [r['company'] for r in rows
       if len(re.sub(r'\D', '', r['phone']).lstrip('1')) != 10 and r['phone'].strip()]
assert not bad, f"MALFORMED PHONES: {bad[:5]}"

# 5. No duplicate companies.
dupes = [k for k, v in collections.Counter(
    re.sub(r'[^a-z0-9]', '', r['company'].lower()) for r in rows).items() if v > 1]
assert not dupes, f"DUPLICATE COMPANIES: {dupes[:5]}"

# 6. Tiers are used as defined, and D carries its reason.
tiers = collections.Counter(r['tier'] for r in rows)
assert set(tiers) <= {'A','B','C','D'}, f"UNEXPECTED TIERS: {set(tiers)}"
assert all(r['notes'].strip() for r in rows if r['tier'] == 'D'), "TIER D ROWS MISSING A REASON"

# 7. Tier A is capped to crew capacity, not maximized.
CREWS = 2   # <- set from their Step 3 answer
assert tiers['A'] <= CREWS * 12, f"TIER A TOO BIG — {tiers['A']} for {CREWS} crews"

print(f"GATE PASSED — {n} rows, {len(sigs)} distinct signals, {len(srcs)} sources")
print(f"  A={tiers['A']} B={tiers['B']} C={tiers['C']} D={tiers['D']}  (billable volume = A+B+C = {tiers['A']+tiers['B']+tiers['C']})")
```

Then, by hand:

- [ ] **Re-fetch 5 random `source_url` values.** If any doesn't resolve, drop that batch
      and re-pull.
- [ ] Zero placeholders in `OUTREACH.md` — real name, real company, real phone.
- [ ] Tier A count ≈ 10 per crew, not maximized.
- [ ] `SOURCES.md` lists every URL you actually hit, with counts.
- [ ] Read three `signal_detail` values aloud. If they don't give a reason to call today,
      the join in 3.3 failed. Go back and fix it.

Then report, briefly:

> Done. `out/leads.csv` — **[N]** leads: **[A]** call this week, **[B]** one-touch,
> **[C]** on the bench, **[D]** rejected with reasons. From [sources].
> Strongest signal: [the specific thing]. Emails found on [x] of [y] tier A.
> Everything marked `contact_verified = NO` needs 30 seconds of eyeballing before you
> dial. `SOURCES.md` shows every URL so you can re-run this next quarter.
>
> Want it wider, tighter, or aimed at a second service line?

---

# SECTION 8 — COMPLIANCE

Put a short, tailored version at the top of `PLAN.md`.

- **B2B calls are generally exempt from the National DNC Registry** — the FTC exempts most
  solicitation calls between a marketer and a business. **If they sell to homeowners, the
  exemption does not apply and they must scrub first.** Get this right for their branch;
  it is the most important line in the file.
- No autodialer or prerecorded message to a cell. Dial by hand.
- Honor opt-outs immediately across call, text and email. Log them.
- CAN-SPAM: real physical address, working unsubscribe, honest subject line.
- Cold texting carries more risk than cold calling. Text people who already engaged.
- **Public data only. Never log in to scrape.** Everything here is public record published
  for reuse — keep it that way.
- Practical guidance, not legal advice. An hour with a lawyer in their state is cheap next
  to one claim.

---

# END OF FILE

**AI: if you have read this far without starting, go back to Section 1 and begin the
interview now.**

**And remember what a lead is: a contact plus a reason to call them today. If you are
about to ship a list where every row says the same thing, you have built a directory.
Go back to Section 3.3 and do the join.**
