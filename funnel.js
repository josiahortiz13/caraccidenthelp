/* CrashHelp TX lead funnel (homepage, /es, /houston/*).
 * 1) 3-question quiz → first name, phone, TCPA consent checkbox → POST /api/lead (attribution.js adds UTMs).
 * 2) Meta Pixel + GA events: QuizStart, QuizComplete, Lead (form submit), CallClick (call click; attribution.js adds Contact).
 *    No quiz answers (injury, fault, crash timing) are sent to Meta or Google.
 * Markup: <div data-chx-quiz data-lang="en|es" data-source="home-quiz" data-area="Houston"></div>
 */
(function () {
  var PHONE = '(346) 860-1929', TEL = 'tel:+13468601929';
  var T = {
    en: {
      langBtn: 'Español', of: function (i, n) { return 'Step ' + i + ' of ' + n; }, back: '← Back',
      Q: [
        ['when', 'When was the crash?', [['Today', 'today'], ['In the last few days', 'days'], ['Within the last month', 'month'], ['More than a month ago', 'older']]],
        ['hurt', 'Was anyone hurt?', [['Yes', 'yes'], ['Not sure yet', 'unsure'], ['No', 'no']]],
        ['fault', 'Was it your fault?', [['No', 'no'], ['Not sure', 'unsure'], ['Partly', 'partly'], ['Yes', 'yes']]],
      ],
      formH: 'Where can we reach you?', name: 'First name', phone: 'Phone',
      consent: 'I agree to receive calls and texts from CrashHelp TX about my inquiry. Msg & data rates may apply. Reply STOP to opt out.',
      submit: 'Request a free call back', sending: 'Sending…',
      alt: 'Checking the box isn’t required to get help — you can call us 24/7 at ' + PHONE + ' instead.',
      fine: 'CrashHelp TX is not a law firm and does not give legal advice. No outcome is promised. See our <a href="/privacy">Privacy Policy</a> and <a href="/terms">Terms</a>.',
      eName: 'Enter your first name.', ePhone: 'Enter a 10-digit phone number.', eConsent: 'Check the box so we can call or text you back, or call us now.',
      eGen: 'Something went wrong. Please call ' + PHONE + '.',
      doneH: 'Got it. We’ll be in touch.', doneP: 'Keep your phone nearby. In an emergency, call 911.', callNow: '📞 Call 24/7 · ' + PHONE,
    },
    es: {
      langBtn: 'English', of: function (i, n) { return 'Paso ' + i + ' de ' + n; }, back: '← Atrás',
      Q: [
        ['when', '¿Cuándo fue el choque?', [['Hoy', 'today'], ['En los últimos días', 'days'], ['En el último mes', 'month'], ['Hace más de un mes', 'older']]],
        ['hurt', '¿Alguien salió lastimado?', [['Sí', 'yes'], ['Todavía no sé', 'unsure'], ['No', 'no']]],
        ['fault', '¿Fue tu culpa?', [['No', 'no'], ['No estoy seguro', 'unsure'], ['En parte', 'partly'], ['Sí', 'yes']]],
      ],
      formH: '¿Dónde te podemos contactar?', name: 'Nombre', phone: 'Teléfono',
      consent: 'Acepto recibir llamadas y mensajes de texto de CrashHelp TX sobre mi solicitud. Pueden aplicar tarifas de mensajes y datos. Responde STOP para cancelar.',
      submit: 'Pedir una llamada gratis', sending: 'Enviando…',
      alt: 'No es necesario marcar la casilla para recibir ayuda: puedes llamarnos 24/7 al ' + PHONE + '.',
      fine: 'CrashHelp TX no es un bufete de abogados y no da consejos legales. No se promete ningún resultado. Ve nuestra <a href="/privacy">Política de privacidad</a> y <a href="/terms">Términos</a>.',
      eName: 'Escribe tu nombre.', ePhone: 'Escribe un teléfono de 10 dígitos.', eConsent: 'Marca la casilla para que te llamemos o te mandemos texto, o llámanos ahora.',
      eGen: 'Algo salió mal. Por favor llama al ' + PHONE + '.',
      doneH: 'Listo. Te contactaremos.', doneP: 'Ten tu teléfono cerca. En una emergencia, llama al 911.', callNow: '📞 Llama 24/7 · ' + PHONE,
    },
  };

  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function track(std, name, data) {
    data = data || {};
    try { if (window.fbq) { std ? fbq('track', name, data.meta || {}, data.eventID ? { eventID: data.eventID } : undefined) : fbq('trackCustom', name, data.meta || {}); } } catch (e) {}
    try { window.gtag && gtag('event', data.ga || name, data.meta || {}); } catch (e) {}
  }
  window.CHX_TRACK = track;

  // Call clicks: attribution.js already sends the standard "Contact" conversion for every tel: tap.
  // This adds a custom CallClick saying which button was tapped (placement only, no personal data).
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (!a) return;
    track(false, 'CallClick', { ga: 'call_click', meta: { placement: a.getAttribute('data-call') || 'page', page: location.pathname } });
  }, true);

  if (document.querySelector('.chx-sticky')) document.body.classList.add('has-chx-sticky');

  function Quiz(el) {
    var lang = el.getAttribute('data-lang') === 'es' ? 'es' : 'en';
    var source = el.getAttribute('data-source') || 'quiz';
    var area = el.getAttribute('data-area') || '';
    var answers = {}, qi = 0, started = false, completed = false, done = false, form = {};
    el.classList.add('chx-quiz');
    el.setAttribute('aria-live', 'polite');
    function L() { return T[lang]; }
    function meta() { return { content_name: source, lang: lang }; }

    function bar(on) { var n = L().Q.length + 1, h = ''; for (var i = 0; i < n; i++) h += '<i class="' + (i < on ? 'on' : '') + '"></i>'; return '<div class="chx-q-bar" aria-hidden="true">' + h + '</div>'; }
    function top(i) { return '<div class="chx-q-top"><span class="chx-q-step">' + esc(L().of(i, L().Q.length + 1)) + '</span><button type="button" class="chx-q-lang">' + esc(L().langBtn) + '</button></div>' + bar(i); }

    function render(focus) {
      if (done) return renderDone();
      if (qi < L().Q.length) {
        var q = L().Q[qi], key = q[0];
        el.innerHTML = top(qi + 1) + '<p class="chx-q-text" tabindex="-1">' + esc(q[1]) + '</p><div class="chx-q-ans">' +
          q[2].map(function (o, i) { return '<button type="button" data-i="' + i + '"' + (answers[key] && answers[key].i === i ? ' class="sel"' : '') + '>' + esc(o[0]) + '</button>'; }).join('') + '</div>' +
          (qi > 0 ? '<button type="button" class="chx-q-back">' + esc(L().back) + '</button>' : '');
        el.querySelectorAll('.chx-q-ans button').forEach(function (b) {
          b.addEventListener('click', function () {
            var i = +b.getAttribute('data-i');
            answers[key] = { i: i, value: q[2][i][1] };
            if (!started) { started = true; track(false, 'QuizStart', { ga: 'quiz_start', meta: meta() }); }
            qi++; render(true);
          });
        });
      } else {
        if (!completed) { completed = true; track(false, 'QuizComplete', { ga: 'quiz_complete', meta: meta() }); }
        el.innerHTML = top(L().Q.length + 1) + '<p class="chx-q-text" tabindex="-1">' + esc(L().formH) + '</p>' +
          '<form class="chx-q-form" novalidate>' +
          '<input class="hp" name="company_website" tabindex="-1" autocomplete="off" aria-hidden="true">' +
          '<label class="f"><span>' + esc(L().name) + '</span><input type="text" name="first_name" autocomplete="given-name" required value="' + esc(form.first_name || '') + '"></label>' +
          '<label class="f"><span>' + esc(L().phone) + '</span><input type="tel" name="phone" inputmode="tel" autocomplete="tel" placeholder="(555) 555-5555" required value="' + esc(form.phone || '') + '"></label>' +
          '<label class="chx-q-consent"><input type="checkbox" name="contact_consent"' + (form.consent ? ' checked' : '') + '><span class="chx-q-ctext">' + esc(L().consent) + '</span></label>' +
          '<p class="chx-q-err" role="alert"></p>' +
          '<button type="submit" class="chx-q-submit">' + esc(L().submit) + '</button>' +
          '<p class="chx-q-fine">' + esc(L().alt) + '</p><p class="chx-q-fine">' + L().fine + '</p>' +
          '</form><a class="chx-q-call" href="' + TEL + '" data-call="quiz">' + esc(L().callNow) + '</a>' +
          '<button type="button" class="chx-q-back">' + esc(L().back) + '</button>';
        var f = el.querySelector('form');
        f.addEventListener('input', function () { el.querySelector('.chx-q-err').textContent = ''; save(f); });
        f.addEventListener('submit', submit);
      }
      var back = el.querySelector('.chx-q-back');
      if (back) back.onclick = function () { var f = el.querySelector('form'); if (f) save(f); qi = Math.max(0, qi - 1); render(true); };
      el.querySelector('.chx-q-lang').onclick = function () { var f = el.querySelector('form'); if (f) save(f); lang = lang === 'es' ? 'en' : 'es'; render(false); };
      if (focus) { var h = el.querySelector('.chx-q-text'); h && h.focus({ preventScroll: true }); }
    }

    function save(f) { form = { first_name: f.first_name.value, phone: f.phone.value, consent: f.contact_consent.checked }; }
    function digits(p) { return String(p || '').replace(/\D/g, ''); }

    function submit(e) {
      e.preventDefault();
      var f = e.target, err = el.querySelector('.chx-q-err'), btn = f.querySelector('.chx-q-submit');
      var name = f.first_name.value.trim(), phone = f.phone.value, d = digits(phone);
      if (!name) return (err.textContent = L().eName);
      if (!(d.length === 10 || (d.length === 11 && d[0] === '1'))) return (err.textContent = L().ePhone);
      // We only call or text people who checked the box. Without it, the form asks them to call us instead.
      if (!f.contact_consent.checked) return (err.textContent = L().eConsent);
      var en = T.en.Q;
      var summary = 'Quiz (' + lang.toUpperCase() + ', ' + source + ') · ' + en.map(function (q) { var a = answers[q[0]]; return q[1] + ' ' + (a ? q[2][a.i][0] : '—'); }).join(' · ');
      var payload = {
        first_name: name, phone: phone, company_website: f.company_website.value,
        preferred_contact: 'call', contact_consent: true, consent_text: el.querySelector('.chx-q-ctext').textContent,
        consent_page_url: location.href.slice(0, 300),
        crash_recency: answers.when && answers.when.value, injured: answers.hurt && answers.hurt.value,
        crash_city: area, description: summary, source: source + (lang === 'es' ? '-es' : ''),
      };
      btn.disabled = true; btn.textContent = L().sending;
      fetch('/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
        .then(function (res) { return res.json().catch(function () { return {}; }).then(function (r) { if (!res.ok) throw new Error(r.error || L().eGen); return r; }); })
        .then(function (r) {
          track(true, 'Lead', { ga: 'form_submit', meta: { content_name: payload.source }, eventID: r.lead_id });
          done = true; renderDone();
        })
        .catch(function (ex) { err.textContent = ex.message || L().eGen; btn.disabled = false; btn.textContent = L().submit; });
    }

    function renderDone() {
      el.innerHTML = '<div class="chx-q-done"><div class="ck" aria-hidden="true">✓</div><p class="chx-q-text" tabindex="-1">' + esc(L().doneH) + '</p><p>' + esc(L().doneP) + '</p></div>' +
        '<a class="chx-q-call" href="' + TEL + '" data-call="quiz-done">' + esc(L().callNow) + '</a>';
      var h = el.querySelector('.chx-q-text'); h && h.focus({ preventScroll: true });
    }

    render(false);
  }

  document.querySelectorAll('[data-chx-quiz]').forEach(Quiz);
})();
