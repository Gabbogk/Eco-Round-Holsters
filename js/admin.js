(function () {
    'use strict';

    // Same Apps Script web app that the Notify Me form posts to.
    var ENDPOINT = 'https://script.google.com/macros/s/AKfycbwVlX-ENTRfwyyaG9Q_G8m62eg5Hdxh-zem9kdA805aBLFN8g4kFkrSGzuy3nE98N9f3w/exec';
    var KEY_STORE = 'eco_admin_key';
    var TITLES = { overview: 'Overview', signups: 'Signups', analytics: 'Analytics', products: 'Products', orders: 'Orders', site: 'Site' };

    var state = { signups: [], sortBy: 'date', sortDir: -1, filter: '', orders: [], catalog: [], checkoutLive: false };

    // Friendly names for the priced option keys in catalog.js (for the Products view).
    var OPT_LABELS = {
        'finish-carbon': 'Carbon Fiber', 'finish-carbon-2sided': 'Double-Sided Carbon',
        'finish-graphic-kydex': 'Custom Graphic (Kydex)', 'finish-graphic-carbon': 'Custom Graphic (Carbon)',
        'clip-monoblock': 'Monoblock clip', 'clip-ulti': 'Ulti-Clip', 'clip-metal': 'Metal clip',
        'addon-claw': 'Concealment claw', 'addon-washers': 'Colored washers', 'addon-molding': 'Light/laser molding'
    };

    var login = document.getElementById('login');
    var app = document.getElementById('app');
    var loginForm = document.getElementById('loginForm');
    var passwordInput = document.getElementById('password');
    var loginError = document.getElementById('loginError');
    var loginBtn = document.getElementById('loginBtn');

    // ---- fetch through our own server (same-origin proxy; no CORS, ad-blocker-proof) ----
    function fetchData(key) {
        return fetch('/api/signups', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ key: key })
        }).then(function (r) {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.json();
        });
    }

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
                loadCatalog();
                loadOrders(key);
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
        loadCatalog();
        loadOrders(key);
    }

    // ---- formatting ----
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
    function fmtDate(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }); }
    function fmtDateTime(iso) { if (!iso) return ''; var d = new Date(iso); return isNaN(d) ? iso : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }); }
    function fmtMoney(cents) { return '$' + (Math.round(cents || 0) / 100).toFixed(2); }

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

    // ---- products (read-only catalog from /api/catalog) ----
    function loadCatalog() {
        fetch('/api/catalog').then(function (r) { return r.json(); }).then(function (d) {
            if (d && d.ok) { state.catalog = d.products || []; renderProducts(); }
        }).catch(function () {});
    }
    function renderProducts() {
        var body = document.getElementById('productsBody');
        var cnt = document.getElementById('productsCount');
        if (!state.catalog.length) { body.innerHTML = '<tr class="empty-row"><td colspan="3">No products found.</td></tr>'; return; }
        if (cnt) cnt.textContent = state.catalog.length + ' products';
        body.innerHTML = state.catalog.map(function (p) {
            var chips = p.addOns.length
                ? p.addOns.map(function (a) { return '<span class="opt-chip">' + esc(OPT_LABELS[a.key] || a.key) + ' <b>+' + fmtMoney(a.price) + '</b></span>'; }).join('')
                : '<span style="color:var(--a-dim)">No paid add-ons</span>';
            return '<tr><td><strong>' + esc(p.name) + '</strong></td><td>' + fmtMoney(p.base) + '</td><td><div class="opt-chips">' + chips + '</div></td></tr>';
        }).join('');
    }

    // ---- orders (live from Stripe via /api/orders) ----
    function loadOrders(key) {
        fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key: key }) })
            .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
            .then(function (res) {
                if (res.status === 200 && res.j && res.j.ok) {
                    state.orders = res.j.orders || []; state.checkoutLive = true;
                    renderOrders('ok'); setPaymentsStatus('live');
                } else if (res.status === 503) {
                    state.orders = []; state.checkoutLive = false;
                    renderOrders('unconfigured'); setPaymentsStatus('pending');
                } else if (res.status === 401) {
                    renderOrders('unauthorized'); setPaymentsStatus('pending');
                } else {
                    renderOrders('error'); setPaymentsStatus('pending');
                }
                renderOrderStats();
            })
            .catch(function () { renderOrders('error'); renderOrderStats(); });
    }

    var CART_SVG = '<svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2"><circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6"/></svg>';

    function renderOrders(mode) {
        var c = document.getElementById('ordersContent');
        if (!c) return;
        if (mode === 'unconfigured') {
            c.innerHTML = '<div class="panel"><div class="setup"><span class="badge-soon">Checkout not live yet</span>' + CART_SVG +
                '<h3>Your orders will appear here</h3>' +
                '<p>Add your <strong>Stripe key</strong> and every paid order shows up here automatically — customer, items, and total, pulled live from Stripe.</p>' +
                '<p class="hint">Until then, customers see an "email us to order" message at checkout.</p></div></div>';
            return;
        }
        if (mode === 'unauthorized') { c.innerHTML = '<div class="panel"><div class="setup"><h3>Session expired</h3><p>Please log out and back in.</p></div></div>'; return; }
        if (mode === 'error') { c.innerHTML = '<div class="panel"><div class="setup"><h3>Couldn’t load orders</h3><p>Stripe may be unreachable right now. Try Refresh.</p></div></div>'; return; }
        if (!state.orders.length) {
            c.innerHTML = '<div class="panel"><div class="setup">' + CART_SVG + '<h3>No orders yet</h3><p>Checkout is live — paid orders will show up here as they come in.</p></div></div>';
            return;
        }
        var revenue = state.orders.reduce(function (s, o) { return s + (o.amount_total || 0); }, 0);
        var rows = state.orders.map(function (o) {
            var items = (o.items || []).map(function (it) { return '<span class="oi">' + (it.qty > 1 ? it.qty + '× ' : '') + esc(it.description) + '</span>'; }).join('');
            return '<tr><td>' + fmtDateTime(o.created * 1000) + '</td>' +
                '<td class="order-cust"><strong>' + (esc(o.name) || '—') + '</strong><small>' + esc(o.email) + '</small></td>' +
                '<td class="order-items">' + items + '</td>' +
                '<td class="order-total">' + fmtMoney(o.amount_total) + '</td></tr>';
        }).join('');
        c.innerHTML = '<div class="panel">' +
            '<div class="summary-row"><div><div class="s-val">' + fmtMoney(revenue) + '</div><div class="s-lbl">Revenue</div></div>' +
            '<div><div class="s-val">' + state.orders.length + '</div><div class="s-lbl">Paid orders</div></div></div>' +
            '<div class="table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Items</th><th>Total</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
            '<p class="panel-note" style="margin-top:14px;">Up to 25 most recent paid orders. Refunds, payouts and full details live in your <a href="https://dashboard.stripe.com" target="_blank" rel="noopener" style="color:var(--a-primary-hover)">Stripe Dashboard</a>.</p>' +
            '</div>';
    }

    function renderOrderStats() {
        var revEl = document.getElementById('statRevenue'), revSub = document.getElementById('statRevenueSub');
        var ordEl = document.getElementById('statOrders'), ordSub = document.getElementById('statOrdersSub');
        if (!state.checkoutLive) {
            revEl.textContent = '—'; ordEl.textContent = '—';
            revSub.textContent = 'add Stripe key to enable';
            ordSub.textContent = 'awaiting checkout setup';
            return;
        }
        var revenue = state.orders.reduce(function (s, o) { return s + (o.amount_total || 0); }, 0);
        revEl.textContent = fmtMoney(revenue); revSub.textContent = 'paid orders (Stripe)';
        ordEl.textContent = state.orders.length; ordSub.textContent = 'paid to date';
    }

    function setPaymentsStatus(mode) {
        var el = document.getElementById('statusPayments');
        if (!el) return;
        if (mode === 'live') { el.textContent = 'Live'; el.className = 'status-pill live'; }
        else { el.textContent = 'Pending key'; el.className = 'status-pill pending'; }
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
