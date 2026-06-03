(function () {
    'use strict';

    // Same Apps Script web app that the Notify Me form posts to.
    var ENDPOINT = 'https://script.google.com/macros/s/AKfycbwVlX-ENTRfwyyaG9Q_G8m62eg5Hdxh-zem9kdA805aBLFN8g4kFkrSGzuy3nE98N9f3w/exec';
    var KEY_STORE = 'eco_admin_key';
    var TITLES = { overview: 'Overview', signups: 'Signups', analytics: 'Analytics', products: 'Products', orders: 'Orders', site: 'Site' };

    var state = { signups: [], sortBy: 'date', sortDir: -1, filter: '' };

    var login = document.getElementById('login');
    var app = document.getElementById('app');
    var loginForm = document.getElementById('loginForm');
    var passwordInput = document.getElementById('password');
    var loginError = document.getElementById('loginError');
    var loginBtn = document.getElementById('loginBtn');

    // ---- JSONP (Apps Script doesn't send CORS headers, so we use a <script> tag) ----
    function jsonp(params) {
        return new Promise(function (resolve, reject) {
            var cb = '__ecoCb_' + Math.floor(Math.random() * 1e9);
            var script = document.createElement('script');
            var timer = setTimeout(function () { cleanup(); reject(new Error('timeout')); }, 15000);
            function cleanup() { clearTimeout(timer); try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (script.parentNode) script.parentNode.removeChild(script); }
            window[cb] = function (data) { cleanup(); resolve(data); };
            var qs = Object.keys(params).map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
            script.src = ENDPOINT + '?' + qs + '&callback=' + cb;
            script.onerror = function () { cleanup(); reject(new Error('network')); };
            document.body.appendChild(script);
        });
    }

    function fetchData(key) { return jsonp({ key: key }); }

    // ---- auth ----
    function doLogin(key, isAuto) {
        if (!isAuto) { loginBtn.textContent = 'Checking…'; loginBtn.disabled = true; }
        loginError.textContent = '';
        fetchData(key).then(function (data) {
            if (data && data.ok) {
                sessionStorage.setItem(KEY_STORE, key);
                state.signups = data.signups || [];
                login.style.display = 'none';
                app.classList.add('active');
                renderAll();
            } else {
                if (isAuto) { sessionStorage.removeItem(KEY_STORE); }
                else { loginError.textContent = 'Incorrect password. Try again.'; }
            }
        }).catch(function () {
            if (isAuto) { sessionStorage.removeItem(KEY_STORE); }
            else { loginError.textContent = 'Could not reach the server — confirm the Apps Script is deployed.'; }
        }).finally(function () {
            loginBtn.textContent = 'Log In'; loginBtn.disabled = false;
        });
    }

    loginForm.addEventListener('submit', function (e) { e.preventDefault(); doLogin(passwordInput.value, false); });

    function refresh() {
        var key = sessionStorage.getItem(KEY_STORE);
        if (!key) return;
        fetchData(key).then(function (data) { if (data && data.ok) { state.signups = data.signups || []; renderAll(); } });
    }

    // ---- formatting ----
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function fmtDate(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    function fmtDateTime(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }

    // ---- rendering ----
    function renderAll() { renderStats(); renderRecent(); renderSignups(); renderChart(); }

    function renderStats() {
        var total = state.signups.length;
        document.getElementById('statTotal').textContent = total;
        var weekAgo = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);
        var week = state.signups.filter(function (s) { return s.date && new Date(s.date) >= weekAgo; }).length;
        document.getElementById('statWeek').textContent = week;
        var latest = state.signups.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); })[0];
        document.getElementById('statLatest').textContent = latest ? fmtDate(latest.date) : '—';
        document.getElementById('statLatestSub').textContent = latest ? latest.email : 'no signups yet';
    }

    function rowsHtml(list) {
        return list.map(function (s) {
            return '<tr><td>' + esc(s.email) + '</td><td>' + fmtDateTime(s.date) + '</td><td>' + esc(s.source || '—') + '</td></tr>';
        }).join('');
    }

    function renderRecent() {
        var body = document.getElementById('recentBody');
        var recent = state.signups.slice().sort(function (a, b) { return new Date(b.date) - new Date(a.date); }).slice(0, 8);
        body.innerHTML = recent.length ? rowsHtml(recent) : '<tr class="empty-row"><td colspan="3">No signups yet.</td></tr>';
    }

    function renderSignups() {
        var body = document.getElementById('signupsBody');
        var f = state.filter.toLowerCase();
        var rows = state.signups.filter(function (s) {
            if (!f) return true;
            return (s.email || '').toLowerCase().indexOf(f) >= 0 || (s.source || '').toLowerCase().indexOf(f) >= 0;
        });
        rows.sort(function (a, b) {
            var av, bv;
            if (state.sortBy === 'date') { av = new Date(a.date) || 0; bv = new Date(b.date) || 0; }
            else { av = (a[state.sortBy] || '').toLowerCase(); bv = (b[state.sortBy] || '').toLowerCase(); }
            if (av < bv) return -1 * state.sortDir;
            if (av > bv) return 1 * state.sortDir;
            return 0;
        });
        body.innerHTML = rows.length ? rowsHtml(rows) : '<tr class="empty-row"><td colspan="3">No matching signups.</td></tr>';
    }

    function renderChart() {
        var chart = document.getElementById('signupChart');
        var days = 14, buckets = [];
        var today = new Date(); today.setHours(0, 0, 0, 0);
        for (var i = days - 1; i >= 0; i--) { var d = new Date(today); d.setDate(d.getDate() - i); buckets.push({ date: d, count: 0 }); }
        state.signups.forEach(function (s) {
            if (!s.date) return;
            var sd = new Date(s.date); if (isNaN(sd)) return; sd.setHours(0, 0, 0, 0);
            for (var j = 0; j < buckets.length; j++) { if (buckets[j].date.getTime() === sd.getTime()) { buckets[j].count++; break; } }
        });
        var max = Math.max(1, Math.max.apply(null, buckets.map(function (b) { return b.count; })));
        chart.innerHTML = buckets.map(function (b) {
            var h = Math.round((b.count / max) * 130);
            var lbl = b.date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
            return '<div class="chart-bar"><span class="bar-val">' + (b.count || '') + '</span><div class="bar" style="height:' + h + 'px"></div><span class="bar-lbl">' + lbl + '</span></div>';
        }).join('');
    }

    function exportCsv() {
        var rows = [['Email', 'Date', 'Source']].concat(state.signups.map(function (s) { return [s.email, s.date, s.source]; }));
        var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ecoround-signups.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a);
        URL.revokeObjectURL(a.href);
    }

    // ---- nav / controls ----
    document.querySelectorAll('.nav-item').forEach(function (item) {
        item.addEventListener('click', function () {
            var view = item.dataset.view;
            document.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
            item.classList.add('active');
            document.querySelectorAll('.view').forEach(function (v) { v.classList.remove('active'); });
            document.getElementById('view-' + view).classList.add('active');
            document.getElementById('viewTitle').textContent = TITLES[view] || view;
            document.getElementById('sidebar').classList.remove('open');
        });
    });

    document.querySelectorAll('th[data-sort]').forEach(function (th) {
        th.addEventListener('click', function () {
            var col = th.dataset.sort;
            if (state.sortBy === col) state.sortDir *= -1; else { state.sortBy = col; state.sortDir = 1; }
            renderSignups();
        });
    });

    document.getElementById('searchInput').addEventListener('input', function (e) { state.filter = e.target.value; renderSignups(); });
    document.getElementById('exportBtn').addEventListener('click', exportCsv);
    document.getElementById('refreshBtn').addEventListener('click', refresh);
    document.getElementById('logoutBtn').addEventListener('click', function () { sessionStorage.removeItem(KEY_STORE); location.reload(); });
    document.getElementById('menuToggle').addEventListener('click', function () { document.getElementById('sidebar').classList.toggle('open'); });

    // auto-login if a key is already in this session
    var saved = sessionStorage.getItem(KEY_STORE);
    if (saved) doLogin(saved, true);
})();
