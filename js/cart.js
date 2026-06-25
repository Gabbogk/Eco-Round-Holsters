/* ============================================================================
 * cart.js - client-side cart + slide-in drawer, shared by every page.
 *
 * The cart only ever stores WHAT was chosen (product id + option keys + the
 * shopper-facing summary) and a display price. The price charged is recomputed
 * by the server (see catalog.js) at checkout, so nothing here is trusted for money.
 *
 * Include with <script src="js/cart.js"></script>. Product pages call
 * Cart.add({...}) then Cart.open().
 * ==========================================================================*/
(function () {
    'use strict';

    var KEY = 'ecoround_cart_v1';
    // Mirror of catalog.js shipping rule - for DISPLAY only. Server decides the
    // real charge; these just power the drawer's "free shipping" nudge.
    var FREE_SHIP_AT = 10000; // cents
    var FLAT_SHIP = 695;

    function money(cents) { return '$' + (Math.round(cents) / 100).toFixed(2); }

    function load() {
        try { return JSON.parse(localStorage.getItem(KEY)) || []; }
        catch (e) { return []; }
    }
    function save(items) {
        try { localStorage.setItem(KEY, JSON.stringify(items)); } catch (e) {}
        render();
    }

    // Identity of a configured line, so re-adding the same config bumps qty
    // instead of stacking duplicate rows.
    function sig(it) {
        return [it.id, (it.options || []).slice().sort().join(','), it.gun || '', it.washerColor || '', it.summary || ''].join('|');
    }

    var Cart = {
        items: function () { return load(); },
        count: function () {
            return load().reduce(function (n, it) { return n + (it.qty || 1); }, 0);
        },
        subtotal: function () {
            return load().reduce(function (s, it) { return s + (it.unit || 0) * (it.qty || 1); }, 0);
        },
        add: function (item) {
            var items = load();
            item.qty = item.qty || 1;
            var s = sig(item);
            var found = null;
            for (var i = 0; i < items.length; i++) { if (sig(items[i]) === s) { found = items[i]; break; } }
            if (found) found.qty += item.qty; else items.push(item);
            save(items);
        },
        setQty: function (i, qty) {
            var items = load();
            if (!items[i]) return;
            items[i].qty = Math.max(1, Math.min(20, qty));
            save(items);
        },
        remove: function (i) {
            var items = load();
            items.splice(i, 1);
            save(items);
        },
        clear: function () { save([]); },
        open: function () { toggle(true); },
        close: function () { toggle(false); }
    };
    window.Cart = Cart;

    // ---- DOM / drawer ------------------------------------------------------

    var drawer, overlay, linesEl, subtotalEl, shipNoteEl, checkoutBtn, errEl, footEl;

    function build() {
        overlay = document.createElement('div');
        overlay.className = 'cart-overlay';

        drawer = document.createElement('aside');
        drawer.className = 'cart-drawer';
        drawer.setAttribute('aria-hidden', 'true');
        drawer.innerHTML =
            '<div class="cart-drawer-head"><h3>Your Cart</h3><button class="cart-drawer-close" aria-label="Close cart">&times;</button></div>' +
            '<div class="cart-drawer-body"></div>' +
            '<div class="cart-drawer-foot">' +
                '<div class="cart-subtotal"><span>Subtotal</span><span class="cart-subtotal-val">$0.00</span></div>' +
                '<p class="cart-ship-note"></p>' +
                '<button class="cart-checkout-btn">Checkout</button>' +
                '<p class="cart-err" role="alert"></p>' +
                '<button class="cart-keep">Keep shopping</button>' +
            '</div>';

        document.body.appendChild(overlay);
        document.body.appendChild(drawer);

        linesEl = drawer.querySelector('.cart-drawer-body');
        subtotalEl = drawer.querySelector('.cart-subtotal-val');
        shipNoteEl = drawer.querySelector('.cart-ship-note');
        checkoutBtn = drawer.querySelector('.cart-checkout-btn');
        errEl = drawer.querySelector('.cart-err');
        footEl = drawer.querySelector('.cart-drawer-foot');

        overlay.addEventListener('click', function () { toggle(false); });
        drawer.querySelector('.cart-drawer-close').addEventListener('click', function () { toggle(false); });
        drawer.querySelector('.cart-keep').addEventListener('click', function () { toggle(false); });
        checkoutBtn.addEventListener('click', function () { window.location.href = '/checkout.html'; });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && drawer.classList.contains('open')) toggle(false);
        });

        // line-level qty / remove (event delegation)
        linesEl.addEventListener('click', function (e) {
            var t = e.target;
            if (t.hasAttribute('data-remove')) { Cart.remove(+t.getAttribute('data-remove')); }
            else if (t.hasAttribute('data-inc')) { var i = +t.getAttribute('data-inc'); Cart.setQty(i, currentQty(i) + 1); }
            else if (t.hasAttribute('data-dec')) { var j = +t.getAttribute('data-dec'); Cart.setQty(j, currentQty(j) - 1); }
        });
    }

    function currentQty(i) { var it = load()[i]; return it ? (it.qty || 1) : 1; }

    function toggle(openIt) {
        if (!drawer) return;
        drawer.classList.toggle('open', openIt);
        overlay.classList.toggle('open', openIt);
        drawer.setAttribute('aria-hidden', openIt ? 'false' : 'true');
        document.body.style.overflow = openIt ? 'hidden' : '';
        if (openIt && errEl) errEl.textContent = '';
    }

    function render() {
        // update every cart-count badge sitewide
        var n = Cart.count();
        document.querySelectorAll('.cart-count').forEach(function (el) { el.textContent = n; });
        try { document.dispatchEvent(new Event('cart:change')); } catch (e) {} // let /checkout.html re-sync its summary

        if (!linesEl) return; // drawer not built yet
        var items = load();
        if (!items.length) {
            linesEl.innerHTML = '<div class="cart-empty"><p>Your cart is empty.</p><a class="btn btn-outline btn-sm" href="shop.html">Browse holsters</a></div>';
            footEl.style.display = 'none';
            return;
        }
        footEl.style.display = '';
        linesEl.innerHTML = items.map(function (it, i) {
            var line = (it.unit || 0) * (it.qty || 1);
            return '<div class="cart-line">' +
                '<div class="cart-line-main">' +
                    '<div class="cart-line-name">' + esc(it.name) + '</div>' +
                    (it.gun ? '<div class="cart-line-gun">Fitted for ' + esc(it.gun) + '</div>' : '') +
                    '<div class="cart-line-summary">' + esc(it.summary || '') + (it.washerColor ? ' · Washers: ' + esc(it.washerColor) : '') + '</div>' +
                    '<button class="cart-line-remove" data-remove="' + i + '">Remove</button>' +
                '</div>' +
                '<div class="cart-line-side">' +
                    '<div class="cart-qty"><button data-dec="' + i + '" aria-label="Decrease">&minus;</button>' +
                        '<span>' + (it.qty || 1) + '</span>' +
                        '<button data-inc="' + i + '" aria-label="Increase">+</button></div>' +
                    '<div class="cart-line-price">' + money(line) + '</div>' +
                '</div>' +
            '</div>';
        }).join('');

        var sub = Cart.subtotal();
        subtotalEl.textContent = money(sub);
        if (sub >= FREE_SHIP_AT) {
            shipNoteEl.textContent = '✓ You’ve unlocked free shipping.';
            shipNoteEl.className = 'cart-ship-note ok';
        } else {
            shipNoteEl.textContent = 'Add ' + money(FREE_SHIP_AT - sub) + ' for free shipping (otherwise ' + money(FLAT_SHIP) + ' flat).';
            shipNoteEl.className = 'cart-ship-note';
        }
    }

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
        });
    }

    // The signed-in customer's email (if logged in via Supabase), so the order
    // links to their account for "My Orders". Resolves null for guests.
    function currentEmail() {
        if (window.sb && window.sb.auth) {
            return window.sb.auth.getSession()
                .then(function (s) { return (s && s.data && s.data.session) ? s.data.session.user.email : null; })
                .catch(function () { return null; });
        }
        return Promise.resolve(null);
    }

    // Build the Stripe Checkout session and redirect. notes (optional) ride along
    // onto the order. Returns a promise that RESOLVES while redirecting and REJECTS
    // with a user-facing message on failure - the caller (/checkout.html) shows it.
    function checkout(notes) {
        var items = load();
        if (!items.length) return Promise.reject(new Error('Your cart is empty.'));
        return currentEmail().then(function (email) {
            return fetch('/api/checkout', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    items: items.map(function (it) {
                        // name + unit are display-only (server still recomputes price from catalog.js);
                        // they ride along so the order's reorder snapshot can rebuild a full cart line.
                        return { id: it.id, name: it.name || '', options: it.options || [], gun: it.gun || '', washerColor: it.washerColor || '', summary: it.summary || '', unit: it.unit || 0, qty: it.qty || 1 };
                    }),
                    customerEmail: email || undefined,
                    notes: (typeof notes === 'string' && notes.trim()) ? notes.trim().slice(0, 500) : undefined
                })
            });
        }).then(function (r) {
            return r.json().then(function (j) { return { ok: r.ok, j: j }; });
        }).then(function (res) {
            if (res.ok && res.j && res.j.url) { window.location.href = res.j.url; return; }
            throw new Error((res.j && res.j.message) || 'Couldn’t start checkout. Please try again.');
        });
    }
    Cart.checkout = checkout;

    // Bind the existing cart icons (home .cart-btn, product/shop .pdp-cart) to open the drawer.
    function bindTriggers() {
        document.querySelectorAll('.cart-btn, .pdp-cart, [data-cart-open]').forEach(function (el) {
            el.addEventListener('click', function (e) { e.preventDefault(); Cart.open(); });
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        build();
        bindTriggers();
        render();
    });
})();
