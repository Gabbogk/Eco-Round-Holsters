/* ============================================================================
 * analytics.js - Google Analytics 4 with Consent Mode v2 + a cookie banner.
 *
 * Privacy-respecting by default: analytics cookies stay DENIED until the
 * visitor clicks "Accept" in the banner. Include on public pages only
 * (not admin). The whole thing is a no-op until you set GA_MEASUREMENT_ID.
 *
 * SET THIS: paste your GA4 Measurement ID below (looks like "G-XXXXXXXXXX").
 * It's a public value - it ships in the page source, so no secret handling.
 * ==========================================================================*/
(function () {
    'use strict';

    var GA_MEASUREMENT_ID = 'G-7GWELZ0N7V'; // EcoRound Holsters GA4 - public value (ships in page source)

    if (!GA_MEASUREMENT_ID) return; // not configured yet → no tracking, no banner

    var CONSENT_KEY = 'eco_analytics_consent'; // 'granted' | 'denied'

    // --- Consent Mode v2: deny everything until the visitor opts in ---
    window.dataLayer = window.dataLayer || [];
    function gtag() { dataLayer.push(arguments); }
    window.gtag = window.gtag || gtag;
    gtag('consent', 'default', {
        ad_storage: 'denied',
        ad_user_data: 'denied',
        ad_personalization: 'denied',
        analytics_storage: 'denied',
        wait_for_update: 500
    });

    // --- Load gtag.js + basic config ---
    var s = document.createElement('script');
    s.async = true;
    s.src = 'https://www.googletagmanager.com/gtag/js?id=' + encodeURIComponent(GA_MEASUREMENT_ID);
    document.head.appendChild(s);
    gtag('js', new Date());
    gtag('config', GA_MEASUREMENT_ID);

    // --- Apply a prior choice, or ask for one ---
    var prior = null;
    try { prior = localStorage.getItem(CONSENT_KEY); } catch (e) {}
    if (prior === 'granted') {
        gtag('consent', 'update', { analytics_storage: 'granted' });
    } else if (prior !== 'denied') {
        if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', showBanner);
        else showBanner();
    }

    function setConsent(v) {
        try { localStorage.setItem(CONSENT_KEY, v); } catch (e) {}
        if (v === 'granted') gtag('consent', 'update', { analytics_storage: 'granted' });
        var b = document.getElementById('eco-consent');
        if (b && b.parentNode) b.parentNode.removeChild(b);
    }

    function showBanner() {
        if (document.getElementById('eco-consent')) return;

        var style = document.createElement('style');
        style.textContent =
            '#eco-consent{position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;background:#1c1c1c;border:1px solid #2a2a2a;border-radius:12px;padding:16px 18px;display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:center;box-shadow:0 12px 40px rgba(0,0,0,.45);font-family:Inter,system-ui,sans-serif;}' +
            '#eco-consent p{color:#cfcfcf;font-size:.86rem;line-height:1.5;margin:0;flex:1;min-width:240px;}' +
            '#eco-consent a{color:#ffdd33;text-decoration:underline;}' +
            '#eco-consent .ecc-btns{display:flex;gap:10px;flex-shrink:0;}' +
            '#eco-consent button{font-family:Oswald,sans-serif;font-size:.78rem;letter-spacing:.5px;text-transform:uppercase;padding:9px 18px;border-radius:8px;cursor:pointer;border:1px solid #2a2a2a;transition:all .15s;}' +
            '#eco-consent .ecc-accept{background:#f8d000;color:#1a1a1a;border-color:#f8d000;}' +
            '#eco-consent .ecc-accept:hover{background:#ffdd33;}' +
            '#eco-consent .ecc-decline{background:transparent;color:#999;}' +
            '#eco-consent .ecc-decline:hover{color:#fff;border-color:#f8d000;}';
        document.head.appendChild(style);

        var bar = document.createElement('div');
        bar.id = 'eco-consent';
        bar.setAttribute('role', 'dialog');
        bar.setAttribute('aria-label', 'Cookie consent');
        bar.innerHTML =
            '<p>We use cookies to measure site traffic with Google Analytics. See our <a href="/privacy.html">Privacy Policy</a>.</p>' +
            '<div class="ecc-btns">' +
                '<button type="button" class="ecc-decline">Decline</button>' +
                '<button type="button" class="ecc-accept">Accept</button>' +
            '</div>';
        document.body.appendChild(bar);

        bar.querySelector('.ecc-accept').addEventListener('click', function () { setConsent('granted'); });
        bar.querySelector('.ecc-decline').addEventListener('click', function () { setConsent('denied'); });
    }
})();
