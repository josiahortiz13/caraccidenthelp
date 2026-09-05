#!/usr/bin/env python3
"""Fix all city pages: simplify lead form, fix handleSubmit JS, fix thank-you redirect, remove dead voice code."""
import re, os, glob

BASE = os.path.dirname(os.path.abspath(__file__))
SKIP = {'index.html', 'thank-you.html', 'partners.html', 'privacy.html', 'terms.html', 'es.html'}

CITY_PAGES = sorted([
    f for f in glob.glob(os.path.join(BASE, '*.html'))
    if os.path.basename(f) not in SKIP
])

NEW_FORM_TPL = '''\
    <form class="lead-form" onsubmit="handleSubmit(event)">
      <input type="text"  id="f-name"  placeholder="Your Full Name *" required/>
      <input type="tel"   id="f-phone" placeholder="Phone Number *" required/>
      <button type="submit" class="submit-btn">📞 Get My FREE Case Review Now →</button>
      <p class="form-note">By submitting you agree to be contacted about your case. This is a referral service — submitting does not create an attorney-client relationship.</p>
      <div class="form-success" id="form-success">
        ✅ Got it! A specialist will reach out to you shortly.<br/>For fastest service call <a href="tel:+13468601929" style="color:var(--red)">(346) 860-1929</a> now.
      </div>
    </form>
  </div>
</section>'''


def new_submit_fn(city):
    return (
        "/* ── MAIN FORM ── */\n"
        "function handleSubmit(e){\n"
        "  e.preventDefault();\n"
        "  submitLead({\n"
        f"    name:  document.getElementById('f-name').value,\n"
        f"    phone: document.getElementById('f-phone').value,\n"
        f"    city:  '{city}',\n"
        "    source:'main-form'\n"
        "  },\n"
        "  document.getElementById('form-success'),\n"
        "  e.target.querySelector('.submit-btn'),\n"
        "  '📞 Get My FREE Case Review Now →'\n"
        "  );\n"
        "  e.target.querySelectorAll('input').forEach(function(i){ i.value=''; });\n"
        "}"
    )


def extract_city(html):
    m = re.search(r"source:\s*'hero-mini',\s*city:\s*'([^']+)'", html)
    if m:
        return m.group(1)
    m2 = re.search(r"source:\s*'exit-popup',\s*city:\s*'([^']+)'", html)
    return m2.group(1) if m2 else None


def fix_page(path):
    html = open(path, encoding='utf-8').read()
    city = extract_city(html)
    if not city:
        return None, False

    changed = False

    # ── 1. Simplify lead form ──────────────────────────────────────────────
    # The lead form uses class="lead-form" — exit form uses class="exit-form"
    # Pattern: <form class="lead-form" ...> ... </form>\n  </div>\n</section>
    form_re = re.compile(
        r'    <form class="lead-form" onsubmit="handleSubmit\(event\)">'
        r'.*?'
        r'    </form>\s*</div>\s*</section>',
        re.DOTALL
    )
    new_html, n = form_re.subn(NEW_FORM_TPL, html, count=1)
    if n:
        html = new_html
        changed = True

    # ── 2. Fix handleSubmit JS ─────────────────────────────────────────────
    hs_re = re.compile(
        r'/\* ── MAIN FORM ── \*/\s*\nfunction handleSubmit\(e\)\{.*?\}',
        re.DOTALL
    )
    new_html, n = hs_re.subn(new_submit_fn(city), html)
    if n:
        html = new_html
        changed = True

    # ── 3. Fix thank-you redirect ──────────────────────────────────────────
    if "'/thank-you.html'" in html:
        html = html.replace("'/thank-you.html'", "'/thank-you'")
        changed = True

    # ── 4. Remove voice recording dead code ───────────────────────────────
    voice_re = re.compile(
        r'/\* ── VOICE RECORDING ── \*/\n'
        r'var recognition.*?recognition\.start\(\);\n\}',
        re.DOTALL
    )
    new_html, n = voice_re.subn('', html)
    if n:
        html = new_html
        changed = True

    # ── 5. Remove micPulse style block ────────────────────────────────────
    mic_re = re.compile(r'<style>\s*@keyframes micPulse\{[^}]+\}\s*</style>\s*\n', re.DOTALL)
    new_html, n = mic_re.subn('', html)
    if n:
        html = new_html
        changed = True

    if changed:
        open(path, 'w', encoding='utf-8').write(html)

    return city, changed


fixed = []
skipped = []
for p in CITY_PAGES:
    name = os.path.basename(p)
    city, ok = fix_page(p)
    if ok:
        fixed.append(name)
        print(f'  FIXED  {name}  ({city})')
    else:
        skipped.append(name)
        print(f'  SKIP   {name}  (no city detected or already clean)')

print(f'\n✓ Fixed {len(fixed)}, skipped {len(skipped)}')
print('Fixed:', ', '.join(fixed))
