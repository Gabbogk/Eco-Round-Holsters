(function () {
    'use strict';

    var sb = window.sb; // Supabase client (from supabase-client.js)
    if (!sb || !sb.auth) { var _le = document.getElementById('loginError'); if (_le) _le.textContent = 'Could not load the sign-in service. Please refresh.'; return; }
    var TITLES = { overview: 'Overview', signups: 'Signups', analytics: 'Analytics', products: 'Products', orders: 'Orders', site: 'Site' };

    var state = { signups: [], sortBy: 'date', sortDir: -1, filter: '', orders: [], catalog: [], checkoutLive: false, orderFilter: '' };

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
    var emailInput = document.getElementById('email');
    var passwordInput = document.getElementById('password');
    var loginError = document.getElementById('loginError');
    var loginBtn = document.getElementById('loginBtn');

    // ---- auth (Supabase) ----
    // The admin signs in with their Supabase account; only a profile with role
    // 'admin' gets in. Protected API calls carry the Supabase access token.
    var adminToken = null;
    function syncToken() {
        return sb.auth.getSession().then(function (s) {
            adminToken = (s && s.data && s.data.session) ? s.data.session.access_token : null;
            return adminToken;
        });
    }
    sb.auth.onAuthStateChange(function (e, session) { adminToken = session ? session.access_token : null; });
    function authBody() { return JSON.stringify({ sbToken: adminToken }); }

    // Resolve { user, admin } for the current session.
    function checkAdmin() {
        return sb.auth.getUser().then(function (res) {
            var u = res && res.data ? res.data.user : null;
            if (!u) return { user: null, admin: false };
            return sb.from('profiles').select('role').eq('id', u.id).single()
                .then(function (pr) { return { user: u, admin: !!(pr && pr.data && pr.data.role === 'admin') }; })
                .catch(function () { return { user: u, admin: false }; });
        });
    }

    // Signups via our server (it adds the Apps Script key server-side).
    function fetchSignups() {
        return fetch('/api/signups', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: authBody()
        }).then(function (r) {
            if (!r.ok) throw new Error('http ' + r.status);
            return r.json();
        });
    }

    function enterApp() {
        login.style.display = 'none';
        app.classList.add('active');
        syncToken().then(function () {
            fetchSignups().then(function (data) { state.signups = (data && data.signups) || []; renderAll(); })
                .catch(function () { renderAll(); });
            loadCatalog();
            loadOrders();
        });
    }

    // Manual login with a Supabase account; only admins get in.
    function doLogin(email, password) {
        loginBtn.textContent = 'Signing in…'; loginBtn.disabled = true;
        loginError.textContent = '';
        sb.auth.signInWithPassword({ email: email, password: password }).then(function (res) {
            if (res.error) { loginError.textContent = res.error.message; return; }
            return checkAdmin().then(function (st) {
                if (!st.admin) { loginError.textContent = 'This account is not an admin.'; return sb.auth.signOut(); }
                enterApp();
            });
        }).catch(function () {
            loginError.textContent = 'Could not sign in. Try again.';
        }).finally(function () {
            loginBtn.textContent = 'Log In'; loginBtn.disabled = false;
        });
    }

    // Auto-login if an admin session already exists (e.g. arriving from the header).
    function tryAutoLogin() {
        checkAdmin().then(function (st) { if (st.admin) enterApp(); });
    }

    loginForm.addEventListener('submit', function (e) { e.preventDefault(); doLogin(emailInput.value.trim(), passwordInput.value); });

    function refresh() {
        fetchSignups().then(function (data) { if (data && data.ok) { state.signups = data.signups || []; renderAll(); } });
        loadCatalog();
        loadOrders();
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
        document.getElementById('statLatest').textContent = latest ? fmtDate(latest.date) : '-';
        document.getElementById('statLatestSub').textContent = latest ? latest.email : 'no signups yet';
    }

    function rowsHtml(list) {
        return list.map(function (s) {
            return '<tr><td>' + esc(s.email) + '</td><td>' + fmtDateTime(s.date) + '</td><td>' + esc(s.source || '-') + '</td></tr>';
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
    function dollars(cents) { return ((cents || 0) / 100).toFixed(2); }
    function priceField(pid, attr, val, cents) {
        return '<span class="po-in"><span class="po-cur">$</span><input class="price-input" type="number" min="0" step="0.01" ' +
            attr + '="' + esc(val) + '" data-pid="' + esc(pid) + '" value="' + dollars(cents) + '"></span>';
    }
    function renderProducts() {
        var body = document.getElementById('productsBody');
        var cnt = document.getElementById('productsCount');
        if (!state.catalog.length) { body.innerHTML = '<tr class="empty-row"><td colspan="3">No products found.</td></tr>'; return; }
        if (cnt) cnt.textContent = state.catalog.length + ' products';
        body.innerHTML = state.catalog.map(function (p) {
            var opts = p.addOns.length
                ? '<div class="price-opts">' + p.addOns.map(function (a) {
                    return '<label class="price-opt"><span class="po-name">' + esc(OPT_LABELS[a.key] || a.key) + '</span>' +
                        priceField(p.id, 'data-addon', a.key, a.price) + '</label>';
                }).join('') + '</div>'
                : '<span style="color:var(--a-dim)">No paid add-ons</span>';
            return '<tr><td><strong>' + esc(p.name) + '</strong></td>' +
                '<td>' + priceField(p.id, 'data-field', 'base', p.base) + '</td>' +
                '<td>' + opts + '</td></tr>';
        }).join('');
    }

    // Collect every price input into the override blob the server expects (dollars
    // -> integer cents). A blank/invalid field becomes null, which the server
    // sanitizes back to the built-in default - so you can never save a broken price.
    function gatherPrices() {
        var products = {};
        document.querySelectorAll('#productsBody .price-input').forEach(function (inp) {
            var pid = inp.dataset.pid; if (!pid) return;
            if (!products[pid]) products[pid] = { addOns: {} };
            var v = parseFloat(inp.value);
            var cents = isFinite(v) ? Math.round(v * 100) : null;
            if (inp.dataset.field === 'base') products[pid].base = cents;
            else if (inp.dataset.addon) products[pid].addOns[inp.dataset.addon] = cents;
        });
        return { products: products };
    }

    function savePrices() {
        var btn = document.getElementById('savePricesBtn');
        var msg = document.getElementById('pricesMsg');
        if (!adminToken) { msg.textContent = 'Not signed in.'; msg.className = 'prices-msg err'; return; }
        var lbl = btn.textContent;
        btn.disabled = true; btn.textContent = 'Saving…'; msg.textContent = ''; msg.className = 'prices-msg';
        fetch('/api/prices', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sbToken: adminToken, prices: gatherPrices() })
        }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
            .then(function (res) {
                if (res.status === 200 && res.j && res.j.ok) {
                    msg.textContent = '✓ Saved - live on the store now.'; msg.className = 'prices-msg ok';
                    loadCatalog();
                } else {
                    msg.textContent = (res.j && res.j.message) || 'Could not save. Try again.'; msg.className = 'prices-msg err';
                }
            }).catch(function () { msg.textContent = 'Network error - try again.'; msg.className = 'prices-msg err'; })
            .finally(function () { btn.disabled = false; btn.textContent = lbl; });
    }

    // ---- orders (live from Stripe via /api/orders) ----
    function loadOrders() {
        fetch('/api/orders', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: authBody() })
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
                '<p>Add your <strong>Stripe key</strong> and every paid order shows up here automatically - customer, items, and total, pulled live from Stripe.</p>' +
                '<p class="hint">Until then, customers see an "email us to order" message at checkout.</p></div></div>';
            return;
        }
        if (mode === 'unauthorized') { c.innerHTML = '<div class="panel"><div class="setup"><h3>Session expired</h3><p>Please log out and back in.</p></div></div>'; return; }
        if (mode === 'error') { c.innerHTML = '<div class="panel"><div class="setup"><h3>Couldn’t load orders</h3><p>Stripe may be unreachable right now. Try Refresh.</p></div></div>'; return; }
        if (!state.orders.length) {
            c.innerHTML = '<div class="panel"><div class="setup">' + CART_SVG + '<h3>No orders yet</h3><p>Checkout is live - paid orders will show up here as they come in.</p></div></div>';
            return;
        }
        var revenue = state.orders.reduce(function (s, o) { return s + (o.amount_total || 0); }, 0);
        c.innerHTML = '<div class="panel">' +
            '<div class="summary-row"><div><div class="s-val">' + fmtMoney(revenue) + '</div><div class="s-lbl">Revenue</div></div>' +
            '<div><div class="s-val">' + state.orders.length + '</div><div class="s-lbl">Paid orders</div></div></div>' +
            '<div class="toolbar"><input type="text" id="orderSearch" placeholder="Search by order #, name, email, or item…"><button class="btn-ghost" id="ordersExport">⤓ Export CSV</button></div>' +
            '<div class="table-wrap"><table><thead><tr><th>Order #</th><th>Date</th><th>Customer</th><th>Items</th><th>Total</th><th></th></tr></thead><tbody id="ordersTbody"></tbody></table></div>' +
            '<p class="panel-note" style="margin-top:14px;">Click a row for the shipping address + build sheet. Up to 25 most recent paid orders; full history in your <a href="https://dashboard.stripe.com" target="_blank" rel="noopener" style="color:var(--a-primary-hover)">Stripe Dashboard</a>.</p>' +
            '</div>';
        renderOrderRows();
        var srch = document.getElementById('orderSearch');
        if (srch) { srch.value = state.orderFilter || ''; srch.addEventListener('input', function (e) { state.orderFilter = e.target.value; renderOrderRows(); }); }
        var exp = document.getElementById('ordersExport');
        if (exp) exp.addEventListener('click', ordersExportCsv);
        var tbody = document.getElementById('ordersTbody');
        if (tbody) tbody.addEventListener('click', function (e) {
            var msb = e.target.closest('.mark-shipped-btn');
            if (msb) { e.stopPropagation(); markShipped(msb); return; }
            var row = e.target.closest('.order-row');
            if (!row) return;
            var i = row.getAttribute('data-row');
            var detail = tbody.querySelector('.order-detail-row[data-detail="' + i + '"]');
            if (detail) { detail.hidden = !detail.hidden; row.classList.toggle('expanded', !detail.hidden); }
        });
    }

    function orderMatches(o, f) {
        if (!f) return true;
        var hay = ((o.orderNo || '') + ' ' + o.name + ' ' + o.email + ' ' + (o.phone || '') + ' ' +
            (o.items || []).map(function (i) { return i.description; }).join(' ') + ' ' +
            (o.config || []).join(' ')).toLowerCase();
        return hay.indexOf(f) >= 0;
    }

    function fmtAddr(sh) {
        if (!sh || !sh.line1) return '';
        var parts = [esc(sh.line1)];
        if (sh.line2) parts.push(esc(sh.line2));
        parts.push(esc([sh.city, sh.state, sh.postal_code].filter(Boolean).join(', ')));
        if (sh.country && sh.country !== 'US') parts.push(esc(sh.country));
        return parts.filter(Boolean).join('<br>');
    }

    // Display-side merge for older orders whose config still has " | Washers: X"
    // tacked on the end (new orders are already merged server-side).
    function mergeWasher(text) {
        var wm = text.match(/\s*\|\s*Washers:\s*([^|]+?)\s*$/i);
        if (!wm) return text;
        var color = wm[1].trim();
        var body = text.slice(0, wm.index);
        return body.indexOf('Colored Washers (set of 4)') >= 0
            ? body.replace('Colored Washers (set of 4)', 'Colored Washers (set of 4): ' + color)
            : body + ' · Washers: ' + color;
    }

    function renderOrderDetail(o, i) {
        var sh = o.shipping || {};
        var addr = fmtAddr(sh);
        var ship = '<div class="od-block"><div class="od-h">Ship to</div><div>' +
            (addr ? esc(sh.name || o.name) + '<br>' + addr : '<span class="od-dim">No shipping address on file</span>') + '</div></div>';
        var contact = '<div class="od-block"><div class="od-h">Contact</div><div>' +
            (o.email ? '<a href="mailto:' + esc(o.email) + '">' + esc(o.email) + '</a>' : '-') +
            (o.phone ? '<br>' + esc(o.phone) : '') + '</div></div>';
        var build = (o.config && o.config.length)
            ? o.config.map(function (c) {
                var m = c.match(/\s*\(Qty (\d+)\)\s*$/);
                var text = mergeWasher(m ? c.slice(0, m.index) : c);
                var q = m ? m[1] : '1';
                return '<li><span class="oi-qty">' + q + 'x</span> ' + esc(text) + '</li>';
            }).join('')
            : (o.items || []).map(function (it) { return '<li>' + '<span class="oi-qty">' + (it.qty || 1) + 'x</span> ' + esc(it.description) + '</li>'; }).join('');
        var buildBlock = '<div class="od-block od-build"><div class="od-h">Build sheet</div><ul>' + build + '</ul></div>';
        var customNote = o.custom ? '<div class="od-custom">⚑ Custom-graphic order - confirm the customer has emailed their artwork to info@ecoroundholsters.com.</div>' : '';
        var ref = '<div class="od-ref"><span class="od-ordno">' + esc(o.orderNo || '') + '</span> &middot; ' + esc(o.id) + ' &middot; <a href="https://dashboard.stripe.com" target="_blank" rel="noopener">Open in Stripe</a></div>';
        return '<div class="od-grid">' + ship + contact + buildBlock + '</div>' +
            '<div class="od-block od-fulfill" data-ff="' + i + '">' + buildFulfill(o, i) + '</div>' + customNote + ref;
    }

    // The mark-shipped control (or current shipped status) for an order's detail view.
    function buildFulfill(o, i) {
        var ff = o.fulfillment || {};
        var shipped = ff.status === 'shipped';
        var opts = ['USPS', 'UPS', 'FedEx', 'Other'].map(function (c) {
            return '<option' + (ff.carrier === c ? ' selected' : '') + '>' + c + '</option>';
        }).join('');
        var status = shipped
            ? '<div class="ship-status">&#10003; Shipped via <strong>' + esc(ff.carrier || '') + '</strong> &middot; ' +
                (ff.trackingUrl ? '<a href="' + esc(ff.trackingUrl) + '" target="_blank" rel="noopener">' + esc(ff.tracking || '') + '</a>' : esc(ff.tracking || '')) + '</div>'
            : '<div class="ship-status">In production - not shipped yet.</div>';
        return '<div class="od-h">Fulfillment</div>' + status +
            '<div class="ship-form">' +
              '<select class="ship-carrier">' + opts + '</select>' +
              '<input class="ship-tracking" type="text" placeholder="Tracking number" value="' + esc(ff.tracking || '') + '">' +
              '<button class="btn-ghost mark-shipped-btn" data-sid="' + esc(o.id) + '" data-row="' + i + '">' + (shipped ? 'Update tracking' : 'Mark as shipped') + '</button>' +
              '<span class="ship-msg"></span>' +
            '</div>';
    }

    // POST the carrier + tracking to the server, email the customer, update the row in place.
    function markShipped(btn) {
        var idx = parseInt(btn.getAttribute('data-row'), 10);
        var sid = btn.getAttribute('data-sid');
        var wrap = btn.closest('.od-fulfill');
        if (!wrap) return;
        var carrier = wrap.querySelector('.ship-carrier').value;
        var tracking = wrap.querySelector('.ship-tracking').value.trim();
        var msg = wrap.querySelector('.ship-msg');
        if (!tracking) { msg.textContent = 'Enter a tracking number.'; msg.className = 'ship-msg err'; return; }
        var label = btn.textContent;
        btn.disabled = true; btn.textContent = 'Saving…'; msg.textContent = ''; msg.className = 'ship-msg';
        fetch('/api/mark-shipped', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sbToken: adminToken, sessionId: sid, carrier: carrier, tracking: tracking })
        }).then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
            .then(function (res) {
                if (res.status === 200 && res.j && res.j.ok) {
                    if (state.orders[idx]) state.orders[idx].fulfillment = res.j.fulfillment;
                    wrap.innerHTML = buildFulfill(state.orders[idx], idx);
                    var m2 = wrap.querySelector('.ship-msg');
                    if (m2) { m2.textContent = '✓ Saved - customer notified by email.'; m2.className = 'ship-msg ok'; }
                } else {
                    msg.textContent = (res.j && res.j.message) || 'Could not save. Try again.'; msg.className = 'ship-msg err';
                    btn.disabled = false; btn.textContent = label;
                }
            }).catch(function () {
                msg.textContent = 'Network error - try again.'; msg.className = 'ship-msg err';
                btn.disabled = false; btn.textContent = label;
            });
    }

    function renderOrderRows() {
        var tbody = document.getElementById('ordersTbody');
        if (!tbody) return;
        var f = (state.orderFilter || '').toLowerCase();
        var html = state.orders.map(function (o, i) {
            if (!orderMatches(o, f)) return '';
            var items = (o.items || []).map(function (it) { return '<span class="oi">' + '<span class="oi-qty">' + (it.qty || 1) + 'x</span> ' + esc(it.description) + '</span>'; }).join('');
            var badge = o.custom ? ' <span class="order-badge">Custom graphic</span>' : '';
            return '<tr class="order-row" data-row="' + i + '">' +
                '<td class="order-no">' + (esc(o.orderNo) || '-') + '</td>' +
                '<td>' + fmtDateTime(o.created * 1000) + '</td>' +
                '<td class="order-cust"><strong>' + (esc(o.name) || '-') + '</strong><small>' + esc(o.email) + '</small></td>' +
                '<td class="order-items">' + items + badge + '</td>' +
                '<td class="order-total">' + fmtMoney(o.amount_total) + '</td>' +
                '<td class="order-caret" aria-hidden="true">▾</td></tr>' +
                '<tr class="order-detail-row" data-detail="' + i + '" hidden><td colspan="6">' + renderOrderDetail(o, i) + '</td></tr>';
        }).join('');
        tbody.innerHTML = html || '<tr class="empty-row"><td colspan="6">No matching orders.</td></tr>';
    }

    function ordersExportCsv() {
        var cols = ['Order #', 'Date', 'Name', 'Email', 'Phone', 'Address', 'Items', 'Total', 'Custom', 'Stripe ID'];
        var rows = [cols].concat(state.orders.map(function (o) {
            var sh = o.shipping || {};
            var addr = [sh.line1, sh.line2, sh.city, sh.state, sh.postal_code, sh.country].filter(Boolean).join(', ');
            var items = (o.config && o.config.length ? o.config : (o.items || []).map(function (it) { return (it.qty || 1) + 'x ' + it.description; })).join(' || ');
            return [o.orderNo || '', fmtDateTime(o.created * 1000), o.name, o.email, o.phone, addr, items, (o.amount_total / 100).toFixed(2), o.custom ? 'yes' : '', o.id];
        }));
        var csv = rows.map(function (r) { return r.map(function (c) { return '"' + String(c == null ? '' : c).replace(/"/g, '""') + '"'; }).join(','); }).join('\n');
        var blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = 'ecoround-orders.csv';
        document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(a.href);
    }

    function renderOrderStats() {
        var revEl = document.getElementById('statRevenue'), revSub = document.getElementById('statRevenueSub');
        var ordEl = document.getElementById('statOrders'), ordSub = document.getElementById('statOrdersSub');
        if (!state.checkoutLive) {
            revEl.textContent = '-'; ordEl.textContent = '-';
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
    document.getElementById('logoutBtn').addEventListener('click', function () { sb.auth.signOut().then(function () { location.reload(); }); });
    (function () { var spb = document.getElementById('savePricesBtn'); if (spb) spb.addEventListener('click', savePrices); })();
    document.getElementById('menuToggle').addEventListener('click', function () { document.getElementById('sidebar').classList.toggle('open'); });

    // auto-login if a session is already stored
    tryAutoLogin();
})();
