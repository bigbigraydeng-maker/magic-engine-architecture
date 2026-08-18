/**
 * Google tag loader — Google Ads + GA4.
 *
 * GA4 is opt-in per deploy: leave GA4_MEASUREMENT_ID as the placeholder to
 * ship without GA4 (silent skip), replace with the real G-XXXXXXXXXX after
 * the analytics.google.com property + web stream are provisioned.
 *
 * Once configured, every `trackMarketingEvent(...)` call in app.js — which
 * already fires `discover_submit`, `contact_submit`, `discover_start`,
 * `ads_landing_view`, `ads_primary_cta_click`, plus other MARKETING_EVENT
 * entries — automatically flows to GA4 via the shared `window.gtag('event',
 * ...)` path (app.js:200-202). No per-event wiring required here.
 */
(function initGoogleTags() {
  var GOOGLE_ADS_ID = 'AW-18192230281';
  var GA4_MEASUREMENT_ID = 'G-4JL29VZ1L4'; // replace after GA4 property is created; leave placeholder to skip GA4
  var PLACEHOLDER_GA4 = 'G-XXXXXXXXXX';

  window.dataLayer = window.dataLayer || [];

  if (typeof window.gtag !== 'function') {
    window.gtag = function gtag() {
      window.dataLayer.push(arguments);
    };
  }

  // ── Google Ads (unchanged) ───────────────────────────────────────────────
  if (!document.querySelector('script[data-google-tag-id="' + GOOGLE_ADS_ID + '"]')) {
    var adsScript = document.createElement('script');
    adsScript.async = true;
    adsScript.src = 'https://www.googletagmanager.com/gtag/js?id=' + GOOGLE_ADS_ID;
    adsScript.setAttribute('data-google-tag-id', GOOGLE_ADS_ID);
    document.head.appendChild(adsScript);
  }

  if (!window.__meGoogleAdsConfigured) {
    window.gtag('js', new Date());
    window.gtag('config', GOOGLE_ADS_ID);
    window.__meGoogleAdsConfigured = true;
  }

  // ── GA4 (opt-in) ─────────────────────────────────────────────────────────
  if (GA4_MEASUREMENT_ID && GA4_MEASUREMENT_ID !== PLACEHOLDER_GA4) {
    // Loader script is shared across all gtag configs — one load, multiple configs.
    if (!document.querySelector('script[data-google-tag-id="' + GA4_MEASUREMENT_ID + '"]')) {
      var ga4Script = document.createElement('script');
      ga4Script.async = true;
      ga4Script.src = 'https://www.googletagmanager.com/gtag/js?id=' + GA4_MEASUREMENT_ID;
      ga4Script.setAttribute('data-google-tag-id', GA4_MEASUREMENT_ID);
      document.head.appendChild(ga4Script);
    }

    if (!window.__meGa4Configured) {
      window.gtag('config', GA4_MEASUREMENT_ID);
      window.__meGa4Configured = true;
    }
  }
})();
