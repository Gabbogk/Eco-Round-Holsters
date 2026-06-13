/* ============================================================================
 * header-auth.js - drops a "Sign In" / "Account" control into the site header
 * and reflects Supabase login state. Self-contained: it lazy-loads supabase-js
 * + supabase-client.js, injects its own styles, and adapts to whichever header
 * layout the page uses. Each storefront page just needs:
 *     <script src="js/header-auth.js"></script>
 * (The Admin link for admins is added in Phase 2, once roles exist.)
 * ==========================================================================*/
(function () {
    'use strict';

    function loadScript(src, cb) {
        var s = document.createElement('script');
        s.src = src; s.onload = cb; s.onerror = cb;
        document.head.appendChild(s);
    }
    function ready(fn) {
        if (document.readyState !== 'loading') fn();
        else document.addEventListener('DOMContentLoaded', fn);
    }

    function injectStyles() {
        if (document.getElementById('acctNavStyles')) return;
        var st = document.createElement('style');
        st.id = 'acctNavStyles';
        st.textContent =
            '.acct-nav{display:inline-flex;align-items:center;gap:14px;margin-right:16px;}' +
            '.acct-link{color:#e8e8e8;font-family:inherit;font-size:.82rem;letter-spacing:.3px;text-decoration:none;white-space:nowrap;font-weight:500;cursor:pointer;}' +
            '.acct-link:hover{color:var(--color-primary-hover,#6cae7e);}' +
            '.acct-link.admin{color:var(--color-accent,#c8a96e);}';
        document.head.appendChild(st);
    }

    // Find the right spot in whatever header this page uses.
    function mountPoint() {
        var actions = document.querySelector('.header-actions');
        if (actions) return { host: actions, before: actions.firstChild };
        var cart = document.querySelector('.pdp-cart');
        if (cart && cart.parentNode) return { host: cart.parentNode, before: cart };
        return null;
    }

    function render(user) {
        var mp = mountPoint();
        if (!mp) return;
        var nav = document.getElementById('acctNav');
        if (!nav) {
            injectStyles();
            nav = document.createElement('div');
            nav.id = 'acctNav';
            nav.className = 'acct-nav';
            mp.host.insertBefore(nav, mp.before);
        }
        nav.innerHTML = user
            ? '<a class="acct-link" href="/account.html">Account</a>'
            : '<a class="acct-link" href="/account.html">Sign In</a>';
    }

    function wire() {
        if (!window.sb) { render(null); return; } // graceful: still show "Sign In"
        window.sb.auth.getUser()
            .then(function (res) { render(res && res.data ? res.data.user : null); })
            .catch(function () { render(null); });
        window.sb.auth.onAuthStateChange(function () {
            window.sb.auth.getUser().then(function (res) { render(res && res.data ? res.data.user : null); });
        });
    }

    ready(function () {
        if (window.sb) { wire(); return; }
        loadScript('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2', function () {
            loadScript('js/supabase-client.js', wire);
        });
    });
})();
