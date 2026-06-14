/* ============================================================================
 * account.js - sign in / create account / reset password on /account.html,
 * powered by Supabase Auth (window.sb from supabase-client.js).
 * ==========================================================================*/
(function () {
    'use strict';
    var sb = window.sb;
    var currentEmail = '';
    function el(id) { return document.getElementById(id); }
    function setMsg(id, text, ok) {
        var m = el(id); if (!m) return;
        m.textContent = text || '';
        m.className = 'acct-msg ' + (text ? (ok ? 'ok' : 'err') : '');
    }

    if (!sb) {
        setMsg('siMsg', 'Could not reach the sign-in service. Please refresh.', false);
        return;
    }

    // --- which card view is showing ---
    function show(view) {
        ['authView', 'signedInView', 'resetView'].forEach(function (v) {
            var node = el(v); if (node) node.hidden = (v !== view);
        });
    }
    function refreshView() {
        return sb.auth.getUser().then(function (res) {
            var user = res && res.data ? res.data.user : null;
            if (user) { currentEmail = user.email || ''; el('whoEmail').textContent = currentEmail; show('signedInView'); loadMyOrders(); }
            else { currentEmail = ''; show('authView'); }
        });
    }

    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

    // --- the customer's own order history ---
    function money(cents) { return '$' + ((cents || 0) / 100).toFixed(2); }
    // The server prefixes the first line item's description with "Order ECO-… · "
    // (so it shows on the Stripe receipt); strip it here so it doesn't read twice
    // next to the order number.
    function cleanDesc(s) { return String(s || '').replace(/^Order\s+ECO-\w+\s*·\s*/i, ''); }
    // Best build text for a line: the metadata config line (product + gun + options)
    // when present, otherwise the line item description.
    function lineText(o, i, it) { return (o.config && o.config[i]) ? o.config[i] : cleanDesc(it.description); }

    function orderDetail(o) {
        var lines = (o.items || []).map(function (it, i) {
            var qty = (it.qty > 1) ? it.qty + '× ' : '';
            return '<div class="ao-line"><span>' + qty + esc(lineText(o, i, it)) + '</span><span class="ao-amt">' + money(it.amount) + '</span></div>';
        }).join('');
        var sh = o.shipping || {};
        var ship = '';
        if (sh.line1 || sh.city) {
            var cityLine = [sh.city, sh.state].filter(Boolean).map(esc).join(', ');
            if (sh.postal_code) cityLine += ' ' + esc(sh.postal_code);
            ship = '<div class="ao-ship"><b>Ship to</b>' +
                (sh.name ? esc(sh.name) + '<br>' : '') +
                (sh.line1 ? esc(sh.line1) + '<br>' : '') +
                (sh.line2 ? esc(sh.line2) + '<br>' : '') +
                cityLine + '</div>';
        }
        return lines + ship;
    }

    function loadMyOrders() {
        var box = el('myOrders');
        if (!box) return;
        box.innerHTML = '<div class="acct-orders-loading">Loading your orders…</div>';
        sb.auth.getSession().then(function (s) {
            var token = (s && s.data && s.data.session) ? s.data.session.access_token : null;
            return fetch('/api/my-orders', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sbToken: token })
            }).then(function (r) { return r.json(); });
        }).then(function (d) {
            var orders = (d && d.orders) || [];
            if (!orders.length) {
                box.innerHTML = '<h3>Your Orders</h3><div class="acct-orders-empty">No orders yet. When you place an order it will show up here.</div>';
                return;
            }
            box.innerHTML = '<h3>Your Orders</h3>' + orders.map(function (o) {
                var date = new Date(o.created * 1000).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
                var summary = (o.items || []).map(function (it, i) {
                    return (it.qty > 1 ? it.qty + '× ' : '') + esc(lineText(o, i, it));
                }).join(', ');
                return '<div class="acct-order">' +
                    '<div class="ao-head" role="button" tabindex="0">' +
                      '<div class="ao-top"><span class="ao-no">' + esc(o.orderNo || '') + '</span><span class="ao-total">' + money(o.amount_total) + '</span></div>' +
                      '<div class="ao-date">' + date + ' <span class="ao-chev">&#9662;</span></div>' +
                      '<div class="ao-items">' + summary + '</div>' +
                    '</div>' +
                    '<div class="ao-detail" hidden>' + orderDetail(o) + '</div>' +
                  '</div>';
            }).join('');
        }).catch(function () {
            box.innerHTML = '<h3>Your Orders</h3><div class="acct-orders-empty">Could not load your orders right now.</div>';
        });
    }

    // Expand/collapse an order to reveal its detail (delegated, so it survives reloads).
    function toggleOrder(head) {
        var card = head.parentNode;
        var det = card.querySelector('.ao-detail');
        var open = card.classList.toggle('open');
        if (det) det.hidden = !open;
    }
    el('myOrders').addEventListener('click', function (e) {
        var head = e.target.closest('.ao-head');
        if (head) toggleOrder(head);
    });
    el('myOrders').addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        var head = e.target.closest('.ao-head');
        if (head) { e.preventDefault(); toggleOrder(head); }
    });

    // --- tab switching (Sign In / Create Account) ---
    document.querySelectorAll('.acct-tab').forEach(function (t) {
        t.addEventListener('click', function () {
            var tab = t.dataset.tab;
            document.querySelectorAll('.acct-tab').forEach(function (x) { x.classList.toggle('active', x === t); });
            document.querySelectorAll('.acct-form').forEach(function (f) { f.classList.toggle('active', f.dataset.form === tab); });
        });
    });

    // --- sign in ---
    el('signinForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = el('siBtn'); btn.disabled = true; btn.textContent = 'Signing in…'; setMsg('siMsg', '');
        sb.auth.signInWithPassword({ email: el('siEmail').value.trim(), password: el('siPass').value })
            .then(function (res) {
                if (res.error) { setMsg('siMsg', res.error.message, false); }
                else { setMsg('siMsg', 'Signed in!', true); refreshView(); }
            })
            .catch(function () { setMsg('siMsg', 'Something went wrong. Try again.', false); })
            .finally(function () { btn.disabled = false; btn.textContent = 'Sign In'; });
    });

    // --- create account ---
    el('signupForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = el('suBtn'); btn.disabled = true; btn.textContent = 'Creating…'; setMsg('suMsg', '');
        sb.auth.signUp({
            email: el('suEmail').value.trim(),
            password: el('suPass').value,
            options: { emailRedirectTo: window.location.origin + '/account.html' }
        }).then(function (res) {
            if (res.error) { setMsg('suMsg', res.error.message, false); }
            else if (res.data && res.data.session) { setMsg('suMsg', 'Account created!', true); refreshView(); }
            else { setMsg('suMsg', 'Almost there - check your email to confirm your account.', true); }
        }).catch(function () { setMsg('suMsg', 'Something went wrong. Try again.', false); })
            .finally(function () { btn.disabled = false; btn.textContent = 'Create Account'; });
    });

    // --- forgot password (sends a reset email) ---
    el('forgotLink').addEventListener('click', function () {
        var email = el('siEmail').value.trim();
        if (!email) { setMsg('siMsg', 'Enter your email above first, then click again.', false); return; }
        sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/account.html' })
            .then(function (res) {
                if (res.error) setMsg('siMsg', res.error.message, false);
                else setMsg('siMsg', 'Reset link sent - check your email.', true);
            });
    });

    // --- complete a password reset (arriving from the email link) ---
    sb.auth.onAuthStateChange(function (event) {
        if (event === 'PASSWORD_RECOVERY') show('resetView');
    });
    el('resetForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = el('rpBtn'); btn.disabled = true; btn.textContent = 'Updating…'; setMsg('rpMsg', '');
        sb.auth.updateUser({ password: el('rpPass').value }).then(function (res) {
            if (res.error) { setMsg('rpMsg', res.error.message, false); }
            else { setMsg('rpMsg', 'Password updated!', true); setTimeout(refreshView, 1200); }
        }).catch(function () { setMsg('rpMsg', 'Something went wrong. Try again.', false); })
            .finally(function () { btn.disabled = false; btn.textContent = 'Update Password'; });
    });

    // --- account settings: reveal/hide ---
    el('settingsToggle').addEventListener('click', function () {
        var open = el('settings').classList.toggle('open');
        el('settingsBody').hidden = !open;
        el('settingsToggle').setAttribute('aria-expanded', open ? 'true' : 'false');
    });

    // Confirm the customer's identity before a sensitive change by re-signing in
    // with the password they typed. Resolves true on success, sets msg + false on fail.
    function reauth(password, msgId) {
        if (!currentEmail) { setMsg(msgId, 'Please sign in again.', false); return Promise.resolve(false); }
        return sb.auth.signInWithPassword({ email: currentEmail, password: password }).then(function (res) {
            if (res.error) { setMsg(msgId, 'Current password is incorrect.', false); return false; }
            return true;
        });
    }

    // --- change email ---
    el('emailForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = el('ceBtn'), newEmail = el('ceEmail').value.trim();
        btn.disabled = true; btn.textContent = 'Saving…'; setMsg('ceMsg', '');
        reauth(el('ceCur').value, 'ceMsg').then(function (ok) {
            if (!ok) return;
            return sb.auth.updateUser({ email: newEmail }).then(function (res) {
                if (res.error) { setMsg('ceMsg', res.error.message, false); return; }
                var applied = res.data && res.data.user && (res.data.user.email || '').toLowerCase() === newEmail.toLowerCase();
                if (applied) { setMsg('ceMsg', 'Email updated.', true); el('emailForm').reset(); refreshView(); }
                else { setMsg('ceMsg', 'Almost there - check ' + newEmail + ' to confirm the change.', true); el('emailForm').reset(); }
            });
        }).catch(function () { setMsg('ceMsg', 'Something went wrong. Try again.', false); })
            .finally(function () { btn.disabled = false; btn.textContent = 'Update Email'; });
    });

    // --- change password ---
    el('passForm').addEventListener('submit', function (e) {
        e.preventDefault();
        var btn = el('cpBtn'), newPass = el('cpNew').value;
        btn.disabled = true; btn.textContent = 'Saving…'; setMsg('cpMsg', '');
        reauth(el('cpCur').value, 'cpMsg').then(function (ok) {
            if (!ok) return;
            return sb.auth.updateUser({ password: newPass }).then(function (res) {
                if (res.error) { setMsg('cpMsg', res.error.message, false); return; }
                setMsg('cpMsg', 'Password updated.', true); el('passForm').reset();
            });
        }).catch(function () { setMsg('cpMsg', 'Something went wrong. Try again.', false); })
            .finally(function () { btn.disabled = false; btn.textContent = 'Update Password'; });
    });

    // --- log out ---
    el('logoutBtn').addEventListener('click', function () {
        sb.auth.signOut().then(refreshView);
    });

    refreshView();
})();
