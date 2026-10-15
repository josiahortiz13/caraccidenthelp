/* CrashHelp TX attribution. Loaded on every public page.
 * 1) Saves first-touch UTMs, gclid, fbclid, landing page and referrer for the visit.
 * 2) Adds them to every POST /api/lead from any page (no per-form changes needed).
 * 3) Keeps any lead the server could not accept and resends it later.
 * 4) Fires call-click and form conversions to GA4, Meta Pixel and (once IDs are set) Google Ads.
 */
(function () {
  // Google Ads: fill these in from Google Ads → Goals → Conversions → (action) → Tag setup. Leave blank to skip.
  var GOOGLE_ADS = { id: '', formLabel: '', callLabel: '' }; // e.g. id: 'AW-123456789', formLabel: 'AbCdEf...'

  var KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'gclid', 'fbclid'];
  var attr = {};
  try { attr = JSON.parse(sessionStorage.getItem('chx_attr') || '{}'); } catch (e) {}
  var q = new URLSearchParams(location.search);
  if (KEYS.some(function (k) { return q.get(k); })) {
    attr = {};
    KEYS.forEach(function (k) { if (q.get(k)) attr[k] = q.get(k).slice(0, 300); });
    attr.landing_page = (location.pathname + location.search).slice(0, 300);
    attr.referrer = document.referrer.slice(0, 300);
  }
  if (!attr.landing_page) { attr.landing_page = (location.pathname + location.search).slice(0, 300); attr.referrer = document.referrer.slice(0, 300); }
  try { sessionStorage.setItem('chx_attr', JSON.stringify(attr)); } catch (e) {}
  window.CHX_ATTR = attr;

  if (GOOGLE_ADS.id) {
    var s = document.createElement('script'); s.async = true; s.src = 'https://www.googletagmanager.com/gtag/js?id=' + GOOGLE_ADS.id; document.head.appendChild(s);
    window.dataLayer = window.dataLayer || []; window.gtag = window.gtag || function () { dataLayer.push(arguments); };
    gtag('js', new Date()); gtag('config', GOOGLE_ADS.id);
  }
  function adsConversion(label, leadId) {
    if (GOOGLE_ADS.id && label && window.gtag) gtag('event', 'conversion', { send_to: GOOGLE_ADS.id + '/' + label, transaction_id: leadId || undefined });
  }
  window.CHX_ADS_CONVERSION = adsConversion;

  // Every lead POST carries attribution, whichever page or form sent it.
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (url, opts) {
      try {
        var u = typeof url === 'string' ? url : (url && url.url) || '';
        if (/\/api\/lead(\?|$)/.test(u) && opts && opts.method === 'POST' && typeof opts.body === 'string') {
          var body = JSON.parse(opts.body);
          KEYS.concat(['landing_page', 'referrer']).forEach(function (k) { if (!body[k] && attr[k]) body[k] = attr[k]; });
          opts = Object.assign({}, opts, { body: JSON.stringify(body) });
          return origFetch.call(window, url, opts).then(function (res) {
            if (res.status >= 500) queueLead(body);
            if (res.ok) {
              res.clone().json().then(function (r) {
                adsConversion(GOOGLE_ADS.formLabel, r && r.lead_id);
                try { window.gtag && gtag('event', 'generate_lead', { lead_id: r && r.lead_id, source: attr.utm_source || 'direct' }); } catch (e) {}
              }).catch(function () {});
            }
            return res;
          }, function (err) { queueLead(body); throw err; });
        }
      } catch (e) {}
      return origFetch.apply(this, arguments);
    };
  }

  // Never lose a lead to a bad connection or a server outage: keep it in this browser and resend
  // on the next page load or when the connection comes back. The server de-duplicates by phone/email.
  var QKEY = 'chx_pending_leads';
  function readQ() { try { return JSON.parse(localStorage.getItem(QKEY) || '[]'); } catch (e) { return []; } }
  function writeQ(q) { try { q.length ? localStorage.setItem(QKEY, JSON.stringify(q.slice(-5))) : localStorage.removeItem(QKEY); } catch (e) {} }
  function queueLead(body) {
    if (body.client_retry) return;
    var q = readQ(); q.push({ body: body, at: Date.now() }); writeQ(q);
  }
  var flushing = false;
  function flushQueue() {
    if (flushing || !origFetch) return;
    var q = readQ().filter(function (x) { return Date.now() - x.at < 7 * 864e5; });
    if (!q.length) return writeQ([]);
    flushing = true;
    var item = q[0];
    var body = Object.assign({}, item.body, { client_retry: true });
    origFetch.call(window, '/api/lead', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      .then(function (res) {
        flushing = false;
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) { writeQ(readQ().slice(1)); flushQueue(); }
      }, function () { flushing = false; });
  }
  window.CHX_FLUSH_LEADS = flushQueue;
  setTimeout(flushQueue, 1500);
  window.addEventListener('online', flushQueue);

  // Click-to-call conversions.
  document.addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href^="tel:"]');
    if (!a) return;
    try { window.fbq && fbq('track', 'Contact', { method: 'call' }); } catch (x) {}
    try { window.gtag && gtag('event', 'click_to_call', { source: attr.utm_source || 'direct', campaign: attr.utm_campaign || '' }); } catch (x) {}
    adsConversion(GOOGLE_ADS.callLabel);
  }, true);
})();
