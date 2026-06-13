/* ============================================================================
 * account.js - sign in / create account / reset password on /account.html,
 * powered by Supabase Auth (window.sb from supabase-client.js).
 * ==========================================================================*/
(function () {
    'use strict';
    var sb = window.sb;
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
            if (user) { el('whoEmail').textContent = user.email || ''; show('signedInView'); }
            else { show('authView'); }
        });
    }

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

    // --- log out ---
    el('logoutBtn').addEventListener('click', function () {
        sb.auth.signOut().then(refreshView);
    });

    refreshView();
})();
