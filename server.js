const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const catalog = require('./catalog');
const mailer = require('./mailer');

const PORT = process.env.PORT || 3000;

// Minimal .env loader for LOCAL dev only. Railway injects real environment
// variables, so there's no .env there and this is a harmless no-op. Never sets
// a key that's already present in the environment.
(function loadDotEnv() {
    try {
        const raw = fs.readFileSync(path.join(__dirname, '.env'), 'utf8');
        raw.split('\n').forEach((line) => {
            line = line.trim();
            if (!line || line[0] === '#') return;
            const eq = line.indexOf('=');
            if (eq < 0) return;
            const key = line.slice(0, eq).trim();
            const val = line.slice(eq + 1).trim().replace(/^['"]|['"]$/g, '');
            if (key && !(key in process.env)) process.env[key] = val;
        });
    } catch (e) { /* no .env file - fine */ }
})();

// The Apps Script web app (same one the Notify Me form posts to).
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwVlX-ENTRfwyyaG9Q_G8m62eg5Hdxh-zem9kdA805aBLFN8g4kFkrSGzuy3nE98N9f3w/exec';

// Stripe secret key comes from the environment - NEVER hardcode it. Until it's
// set, the checkout endpoint returns a friendly "not configured yet" response.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_SESSIONS_URL = 'https://api.stripe.com/v1/checkout/sessions';
// Stripe webhook signing secret (whsec_...). When set (with SMTP creds), a paid
// checkout triggers a branded order-confirmation email. Unset = the webhook is a
// safe no-op, so deploying this can't affect the live site until you configure it.
const STRIPE_WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET || '';
// Optional: BCC the owner on every confirmation (a free "new order" copy).
const OWNER_EMAIL = process.env.OWNER_EMAIL || '';

// --- Admin auth -----------------------------------------------------------
// Secure mode turns on when ADMIN_PASSWORD is set: the dashboard logs in against
// it (constant-time, rate-limited) and receives a signed, expiring session
// token; the Apps Script key then lives ONLY here (APPS_SCRIPT_KEY), never in
// the browser. Until ADMIN_PASSWORD is set, the legacy flow (type the Apps
// Script key, validated by the Apps Script) keeps working - so deploying this
// can never lock you out.
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
const APPS_SCRIPT_KEY = process.env.APPS_SCRIPT_KEY || '';
const SECURE_AUTH = !!ADMIN_PASSWORD;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// Supabase (customer accounts). PUBLIC values - same as the browser client. The
// server verifies an admin using these + the caller's own access token (RLS lets
// a user read their own profile row), so NO Supabase secret is needed here.
const SUPABASE_URL = 'https://ofjjbqchnwlhzncntiwv.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_BgDOuBLrhogRDz62BYvoIA_GMzqo1T3';

const mimeTypes = {
    '.html': 'text/html',
    '.css': 'text/css',
    '.js': 'application/javascript',
    '.json': 'application/json',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.gif': 'image/gif',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2'
};

// ---- small helpers -------------------------------------------------------

function sendJson(res, status, obj) {
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(obj));
}

function readJsonBody(req, cb) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 200000) req.destroy(); });
    req.on('end', () => {
        try { cb(null, JSON.parse(body || '{}')); }
        catch (e) { cb(e); }
    });
}

function originOf(req) {
    const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
    const host = req.headers['host'] || ('localhost:' + PORT);
    return proto + '://' + host;
}

// Follow redirects (Apps Script /exec 302-redirects to googleusercontent.com)
function fetchUrl(url, depth) {
    depth = depth || 0;
    return new Promise((resolve, reject) => {
        if (depth > 5) return reject(new Error('too many redirects'));
        https.get(url, (resp) => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                resp.resume();
                return resolve(fetchUrl(resp.headers.location, depth + 1));
            }
            let data = '';
            resp.on('data', (c) => { data += c; });
            resp.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

// POST a form-encoded body to a URL, following Apps Script's 302 redirect (it
// redirects POSTs to a googleusercontent echo). Used to add signups server-side.
function postForm(url, body, depth) {
    depth = depth || 0;
    return new Promise((resolve, reject) => {
        if (depth > 5) return reject(new Error('too many redirects'));
        const r = https.request(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (resp) => {
            if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
                resp.resume();
                return resolve(fetchUrl(resp.headers.location, depth + 1));
            }
            let data = '';
            resp.on('data', (c) => { data += c; });
            resp.on('end', () => resolve(data));
        });
        r.on('error', reject);
        r.write(body);
        r.end();
    });
}

// ---- Stripe (raw HTTPS, no SDK - keeps the zero-dependency server) --------

// Flatten a nested object/array into Stripe's bracketed form-encoding,
// e.g. line_items[0][price_data][unit_amount]=5500
function stripeForm(obj, prefix, pairs) {
    pairs = pairs || [];
    Object.keys(obj).forEach((key) => {
        const val = obj[key];
        const name = prefix ? prefix + '[' + key + ']' : key;
        if (val === null || val === undefined) return;
        if (typeof val === 'object') {
            stripeForm(val, name, pairs);
        } else {
            pairs.push(encodeURIComponent(name) + '=' + encodeURIComponent(val));
        }
    });
    return pairs;
}

function stripePost(url, paramsObj) {
    const body = stripeForm(paramsObj).join('&');
    return new Promise((resolve, reject) => {
        const req = https.request(url, {
            method: 'POST',
            headers: {
                'Authorization': 'Bearer ' + STRIPE_SECRET_KEY,
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': Buffer.byteLength(body)
            }
        }, (resp) => {
            let data = '';
            resp.on('data', (c) => { data += c; });
            resp.on('end', () => {
                let json;
                try { json = JSON.parse(data); } catch (e) { json = {}; }
                resolve({ status: resp.statusCode, json: json });
            });
        });
        req.on('error', reject);
        req.write(body);
        req.end();
    });
}

function stripeGet(url) {
    return new Promise((resolve, reject) => {
        https.get(url, { headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY } }, (resp) => {
            let data = '';
            resp.on('data', (c) => { data += c; });
            resp.on('end', () => {
                let json;
                try { json = JSON.parse(data); } catch (e) { json = {}; }
                resolve({ status: resp.statusCode, json: json });
            });
        }).on('error', reject);
    });
}

// Validate an admin password the same way the dashboard login does: ask the
// Apps Script web app (it returns { ok: true } for the right key). Resolves true/false.
function verifyAdminKey(key) {
    if (!key) return Promise.resolve(false);
    const url = APPS_SCRIPT_URL + '?key=' + encodeURIComponent(key) + '&callback=cb';
    return fetchUrl(url).then((text) => {
        const start = text.indexOf('('), end = text.lastIndexOf(')');
        const json = (start >= 0 && end > start) ? text.slice(start + 1, end) : text;
        let parsed; try { parsed = JSON.parse(json); } catch (e) { parsed = {}; }
        return !!(parsed && parsed.ok);
    }).catch(() => false);
}

// Constant-time secret compare (hash both sides so length never leaks).
function secretEqual(a, b) {
    const ha = crypto.createHash('sha256').update(String(a)).digest();
    const hb = crypto.createHash('sha256').update(String(b)).digest();
    return crypto.timingSafeEqual(ha, hb);
}

// Signed, expiring session token: base64url(payload).hmac. The signing key is
// derived from ADMIN_PASSWORD, so rotating the password invalidates old tokens.
function signSession(ttlMs) {
    const body = Buffer.from(JSON.stringify({ exp: Date.now() + ttlMs })).toString('base64url');
    const sig = crypto.createHmac('sha256', 'eco-sess:' + ADMIN_PASSWORD).update(body).digest('base64url');
    return body + '.' + sig;
}
function validSession(token) {
    if (!SECURE_AUTH || !token || typeof token !== 'string') return false;
    const dot = token.indexOf('.');
    if (dot < 1) return false;
    const body = token.slice(0, dot), sig = token.slice(dot + 1);
    const expect = crypto.createHmac('sha256', 'eco-sess:' + ADMIN_PASSWORD).update(body).digest('base64url');
    if (sig.length !== expect.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return false;
    let p; try { p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch (e) { return false; }
    return !!(p && typeof p.exp === 'number' && Date.now() < p.exp);
}

// GET a Supabase endpoint with the caller's access token + the public apikey.
function supabaseGet(path, token) {
    return new Promise((resolve, reject) => {
        https.get(SUPABASE_URL + path, {
            headers: { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + token }
        }, (resp) => {
            let d = '';
            resp.on('data', (c) => { d += c; });
            resp.on('end', () => { let j; try { j = JSON.parse(d); } catch (e) { j = null; } resolve(j); });
        }).on('error', reject);
    });
}

// True if the Supabase access token belongs to an admin (role='admin' in the
// profiles table). Uses only the token + public key; RLS scopes the read.
function verifySupabaseAdmin(token) {
    if (!token || typeof token !== 'string') return Promise.resolve(false);
    return supabaseGet('/auth/v1/user', token).then((user) => {
        const uid = user && user.id;
        if (!uid) return false;
        return supabaseGet('/rest/v1/profiles?select=role&id=eq.' + encodeURIComponent(uid), token)
            .then((rows) => !!(Array.isArray(rows) && rows[0] && rows[0].role === 'admin'));
    }).catch(() => false);
}

// Resolve true if the request is an authenticated admin: a Supabase admin token,
// a valid secure-login session token, or the Apps Script key (legacy mode).
function authorizeAdmin(data) {
    if (data && data.sbToken) return verifySupabaseAdmin(data.sbToken);
    if (SECURE_AUTH) return Promise.resolve(validSession(data && data.token));
    return verifyAdminKey((data && data.key) || '');
}

// In-memory login rate limiting per IP (resets on restart - fine for one admin).
const loginHits = new Map(); // ip -> { n, first, lockUntil }
const RL_MAX = 8, RL_WINDOW = 15 * 60 * 1000, RL_LOCK = 15 * 60 * 1000;
function clientIp(req) {
    const xff = req.headers['x-forwarded-for'];
    return (xff ? String(xff).split(',')[0].trim() : '') || (req.socket && req.socket.remoteAddress) || 'unknown';
}
function loginLockedFor(ip) {
    const r = loginHits.get(ip);
    if (!r) return 0;
    if (r.lockUntil && Date.now() < r.lockUntil) return Math.ceil((r.lockUntil - Date.now()) / 1000);
    if (r.first && Date.now() - r.first > RL_WINDOW) loginHits.delete(ip);
    return 0;
}
function loginFailed(ip) {
    const now = Date.now();
    let r = loginHits.get(ip);
    if (!r || (r.first && now - r.first > RL_WINDOW)) r = { n: 0, first: now, lockUntil: 0 };
    r.n++;
    if (r.n >= RL_MAX) r.lockUntil = now + RL_LOCK;
    loginHits.set(ip, r);
    return Math.max(0, RL_MAX - r.n);
}

// POST /api/admin-login { password } -> { token }. Secure mode only; returns
// 501 in legacy mode so the dashboard knows to fall back to the Apps Script key.
function handleAdminLogin(req, res) {
    const ip = clientIp(req);
    const lock = loginLockedFor(ip);
    if (lock > 0) return sendJson(res, 429, { error: 'locked', retry_seconds: lock });
    readJsonBody(req, (err, data) => {
        if (err) return sendJson(res, 400, { error: 'bad_request' });
        if (!SECURE_AUTH) return sendJson(res, 501, { error: 'not_configured' });
        const pw = (data && data.password) || '';
        if (!pw || !secretEqual(pw, ADMIN_PASSWORD)) {
            const left = loginFailed(ip);
            return sendJson(res, 401, { error: 'unauthorized', attempts_left: left });
        }
        loginHits.delete(ip);
        sendJson(res, 200, { ok: true, token: signSession(SESSION_TTL_MS) });
    });
}

// Fold the washer color into the "Colored Washers" line so it reads as one thing
// (e.g. "Colored Washers (set of 4): Red") instead of being tacked on at the end.
function mergeWasher(summary, color) {
    if (!color) return summary;
    if (summary.indexOf('Colored Washers (set of 4)') >= 0) {
        return summary.replace('Colored Washers (set of 4)', 'Colored Washers (set of 4): ' + color);
    }
    return summary + ' · Washers: ' + color;
}

// Deterministic, human-friendly EcoRound order number derived purely from the
// Stripe session id. Same id -> same code, so the success page and the admin
// dashboard always agree without storing anything (this server has no database;
// the Stripe session id is the permanent unique handle). Crockford-style base32
// (no I/L/O/U) keeps it unambiguous when typed or read over the phone.
const ORDER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function orderNumber(id) {
    if (!id) return '';
    // Two FNV-1a streams (different seeds) give ~40 bits of spread, encoded as
    // exactly 8 Crockford base32 chars. Collisions stay negligible into the
    // hundreds of thousands of orders, and the Stripe id remains the true key.
    let h1 = 0x811c9dc5, h2 = 0xc2b2ae35;
    for (let i = 0; i < id.length; i++) {
        const c = id.charCodeAt(i);
        h1 = (h1 ^ c) >>> 0; h1 = (h1 + ((h1 << 1) + (h1 << 4) + (h1 << 7) + (h1 << 8) + (h1 << 24))) >>> 0;
        h2 = (h2 ^ c) >>> 0; h2 = (h2 + ((h2 << 1) + (h2 << 4) + (h2 << 7) + (h2 << 8) + (h2 << 24))) >>> 0;
    }
    let n = (h1 >>> 0) * 256 + (h2 & 0xff); // 0 .. 2^40-1
    let out = '';
    for (let k = 0; k < 8; k++) { out = ORDER_ALPHABET[n % 32] + out; n = Math.floor(n / 32); }
    return 'ECO-' + out;
}

// A fresh random EcoRound order number, generated at checkout and stored on the
// Stripe session + payment so it shows on the customer's receipt and in your
// Stripe dashboard. Same 7-char ECO- format as the id-derived fallback above.
function newOrderNumber() {
    const b = crypto.randomBytes(5); // 40 random bits -> exactly 8 base32 chars
    let n = 0;
    for (let i = 0; i < 5; i++) n = n * 256 + b[i];
    let out = '';
    for (let k = 0; k < 8; k++) { out = ORDER_ALPHABET[n % 32] + out; n = Math.floor(n / 32); }
    return 'ECO-' + out;
}

// POST /api/checkout  { items: [{ id, options:[keys], gun, washerColor, summary, qty }] }
// -> { url } of a Stripe Checkout Session. Prices are recomputed server-side
//    from catalog.js; the client's prices are never trusted.
function handleCheckout(req, res) {
    if (!STRIPE_SECRET_KEY) {
        return sendJson(res, 503, {
            error: 'checkout_unconfigured',
            message: 'Checkout isn’t live yet. Email info@ecoroundholsters.com and we’ll take your order directly.'
        });
    }
    readJsonBody(req, (err, data) => {
        if (err) return sendJson(res, 400, { error: 'bad_request' });

        let priced;
        try { priced = catalog.priceCart(data && data.items); }
        catch (e) { return sendJson(res, 400, { error: 'invalid_cart', message: String(e.message || e) }); }

        const origin = originOf(req);

        // Stash a per-line "what to build" summary in metadata (max 50 keys /
        // 500 chars each) so the admin Orders view can show the full config.
        const orderNo = newOrderNumber();
        const customerEmail = (data && typeof data.customerEmail === 'string' && /.+@.+\..+/.test(data.customerEmail)) ? data.customerEmail.slice(0, 200) : '';
        const meta = { order_no: orderNo };
        priced.lines.slice(0, 45).forEach((l, i) => {
            const cfg = mergeWasher(l.summary || 'Custom-configured', l.washerColor);
            const line = l.name + (l.gun ? ' (' + l.gun + ')' : '') + ' | ' + cfg + (l.qty > 1 ? ' (Qty ' + l.qty + ')' : '');
            meta['item_' + i] = line.slice(0, 490);
        });

        const params = {
            mode: 'payment',
            success_url: origin + '/success.html?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: origin + '/cancel.html',
            customer_email: customerEmail || undefined,
            payment_intent_data: { description: 'EcoRound order ' + orderNo, metadata: { order_no: orderNo } },
            phone_number_collection: { enabled: 'true' },
            shipping_address_collection: { allowed_countries: ['US'] },
            line_items: priced.lines.map((l, i) => {
                let desc = mergeWasher(l.summary || 'Custom-configured', l.washerColor);
                if (i === 0) desc = 'Order ' + orderNo + ' · ' + desc; // surface the order # on the receipt/items list
                return {
                    quantity: l.qty,
                    price_data: {
                        currency: 'usd',
                        unit_amount: l.unitAmount,
                        product_data: {
                            name: l.name + (l.gun ? ' - ' + l.gun : ''),
                            description: desc
                        }
                    }
                };
            }),
            shipping_options: [{
                shipping_rate_data: {
                    type: 'fixed_amount',
                    display_name: priced.shipping === 0 ? 'Free shipping' : 'Standard shipping',
                    fixed_amount: { amount: priced.shipping, currency: 'usd' }
                }
            }],
            metadata: meta
        };

        stripePost(STRIPE_SESSIONS_URL, params).then((r) => {
            if (r.status >= 200 && r.status < 300 && r.json && r.json.url) {
                return sendJson(res, 200, { url: r.json.url });
            }
            const msg = (r.json && r.json.error && r.json.error.message) || 'stripe_error';
            sendJson(res, 502, { error: 'stripe_error', message: msg });
        }).catch(() => sendJson(res, 502, { error: 'stripe_unreachable' }));
    });
}

// GET /api/order?session_id=cs_...  -> minimal order info for the success page.
function handleOrder(req, res) {
    if (!STRIPE_SECRET_KEY) return sendJson(res, 503, { error: 'unconfigured' });
    const q = req.url.split('?')[1] || '';
    let id = '';
    q.split('&').forEach((kv) => {
        const p = kv.split('=');
        if (p[0] === 'session_id') id = decodeURIComponent(p[1] || '');
    });
    if (id.indexOf('cs_') !== 0) return sendJson(res, 400, { error: 'bad_session' });

    https.get('https://api.stripe.com/v1/checkout/sessions/' + encodeURIComponent(id),
        { headers: { 'Authorization': 'Bearer ' + STRIPE_SECRET_KEY } }, (resp) => {
            let data = '';
            resp.on('data', (c) => { data += c; });
            resp.on('end', () => {
                let j; try { j = JSON.parse(data); } catch (e) { j = {}; }
                if (resp.statusCode >= 300) return sendJson(res, 502, { error: 'stripe_error' });
                const ometa = j.metadata || {};
                sendJson(res, 200, {
                    order_no: ometa.order_no || orderNumber(id),
                    email: (j.customer_details && j.customer_details.email) || j.customer_email || '',
                    amount_total: j.amount_total,
                    payment_status: j.payment_status
                });
            });
        }).on('error', () => sendJson(res, 502, { error: 'stripe_unreachable' }));
}

// GET /api/catalog -> the product/price list (public; same prices shown on the
// product pages). Powers the admin Products view.
function handleCatalog(req, res) {
    const products = Object.keys(catalog.PRODUCTS).map((id) => {
        const p = catalog.PRODUCTS[id];
        return {
            id: id,
            name: p.name,
            base: p.base,
            addOns: Object.keys(p.addOns).map((k) => ({ key: k, price: p.addOns[k] }))
        };
    });
    sendJson(res, 200, { ok: true, products: products, freeShippingThreshold: catalog.FREE_SHIPPING_THRESHOLD, flatShipping: catalog.SHIPPING_FLAT });
}

// POST /api/orders { key } -> recent PAID Stripe orders, for the admin dashboard.
// Auth: the admin password (validated via Apps Script, same as login). Returns
// 503 until the Stripe key is set, so the dashboard can show a setup state.
function handleOrders(req, res) {
    if (!STRIPE_SECRET_KEY) {
        return sendJson(res, 503, { error: 'stripe_unconfigured', message: 'Add your Stripe key to see orders here.' });
    }
    readJsonBody(req, (err, data) => {
        if (err) return sendJson(res, 400, { error: 'bad_request' });
        authorizeAdmin(data).then((okAuth) => {
            if (!okAuth) return sendJson(res, 401, { error: 'unauthorized' });
            const url = 'https://api.stripe.com/v1/checkout/sessions?limit=25&expand[]=data.line_items';
            return stripeGet(url).then((r) => {
                if (r.status >= 300) {
                    const msg = (r.json && r.json.error && r.json.error.message) || 'stripe_error';
                    return sendJson(res, 502, { error: 'stripe_error', message: msg });
                }
                const orders = (r.json.data || [])
                    .filter((s) => s.payment_status === 'paid')
                    .map((s) => {
                        const cd = s.customer_details || {};
                        const sd = s.shipping_details || s.shipping || (s.collected_information && s.collected_information.shipping_details) || null;
                        const addr = (sd && sd.address) || cd.address || {};
                        const meta = s.metadata || {};
                        const config = [];
                        for (let i = 0; i < 50; i++) { if (meta['item_' + i]) config.push(meta['item_' + i]); else break; }
                        const items = ((s.line_items && s.line_items.data) || []).map((li) => ({
                            description: li.description, qty: li.quantity, amount: li.amount_total
                        }));
                        const custom = config.some((c) => /custom graphic/i.test(c)) ||
                            items.some((it) => /custom graphic/i.test(it.description || ''));
                        return {
                            id: s.id,
                            orderNo: meta.order_no || orderNumber(s.id),
                            created: s.created,
                            amount_total: s.amount_total,
                            currency: s.currency,
                            name: cd.name || (sd && sd.name) || '',
                            email: cd.email || '',
                            phone: cd.phone || '',
                            shipping: {
                                name: (sd && sd.name) || cd.name || '',
                                line1: addr.line1 || '', line2: addr.line2 || '',
                                city: addr.city || '', state: addr.state || '',
                                postal_code: addr.postal_code || '', country: addr.country || ''
                            },
                            items: items,
                            config: config,
                            custom: custom
                        };
                    });
                sendJson(res, 200, { ok: true, orders: orders });
            });
        }).catch(() => sendJson(res, 502, { error: 'upstream_error' }));
    });
}

// POST /api/my-orders { sbToken } -> the signed-in customer's own paid orders.
// The email comes from the VERIFIED Supabase token (never a client param), so a
// customer can only ever see orders that match their own account email.
function handleMyOrders(req, res) {
    if (!STRIPE_SECRET_KEY) return sendJson(res, 200, { ok: true, orders: [] });
    readJsonBody(req, (err, data) => {
        if (err) return sendJson(res, 400, { ok: false, error: 'bad_request' });
        supabaseGet('/auth/v1/user', data && data.sbToken).then((user) => {
            const email = (user && user.email) ? String(user.email).toLowerCase() : '';
            if (!email) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            const url = 'https://api.stripe.com/v1/checkout/sessions?limit=100&expand[]=data.line_items';
            return stripeGet(url).then((r) => {
                if (r.status >= 300) return sendJson(res, 502, { ok: false, error: 'stripe_error' });
                const orders = (r.json.data || []).filter((s) => {
                    const e = (s.customer_details && s.customer_details.email) ? s.customer_details.email.toLowerCase() : '';
                    return s.payment_status === 'paid' && e === email;
                }).map((s) => {
                    const cd = s.customer_details || {};
                    const sd = s.shipping_details || s.shipping || (s.collected_information && s.collected_information.shipping_details) || null;
                    const addr = (sd && sd.address) || cd.address || {};
                    const meta = s.metadata || {};
                    const config = [];
                    for (let i = 0; i < 50; i++) { if (meta['item_' + i]) config.push(meta['item_' + i]); else break; }
                    return {
                        orderNo: meta.order_no || orderNumber(s.id),
                        created: s.created,
                        amount_total: s.amount_total,
                        currency: s.currency,
                        items: ((s.line_items && s.line_items.data) || []).map((li) => ({ description: li.description, qty: li.quantity, amount: li.amount_total })),
                        config: config,
                        shipping: {
                            name: (sd && sd.name) || cd.name || '',
                            line1: addr.line1 || '', line2: addr.line2 || '',
                            city: addr.city || '', state: addr.state || '',
                            postal_code: addr.postal_code || '', country: addr.country || ''
                        }
                    };
                });
                sendJson(res, 200, { ok: true, orders: orders });
            });
        }).catch(() => sendJson(res, 502, { ok: false, error: 'upstream_error' }));
    });
}

// POST /api/signup { email, source } -> adds a signup. The browser posts here
// (same-origin) instead of straight to the Apps Script, so the Apps Script URL
// and key stay on the server and out of public client JS. Attaches APPS_SCRIPT_KEY
// when set (forward-compatible if the Apps Script later requires a key for writes).
function handleSignupSubmit(req, res) {
    readJsonBody(req, (err, data) => {
        if (err) return sendJson(res, 400, { ok: false, error: 'bad_request' });
        const email = (data && data.email ? String(data.email) : '').trim();
        const source = (data && data.source ? String(data.source) : 'web').trim().slice(0, 40);
        if (!email || email.indexOf('@') < 1 || email.length > 200) {
            return sendJson(res, 400, { ok: false, error: 'invalid_email' });
        }
        const form = new URLSearchParams({ email: email, source: source });
        if (APPS_SCRIPT_KEY) form.set('key', APPS_SCRIPT_KEY);
        postForm(APPS_SCRIPT_URL, form.toString())
            .then(() => sendJson(res, 200, { ok: true }))
            .catch(() => sendJson(res, 502, { ok: false, error: 'upstream_error' }));
    });
}

// Admin data proxy: POST /api/signups { key } -> returns the Apps Script JSON.
// Same-origin, so no CORS and nothing for ad-blockers to block.
function handleSignupsApi(req, res) {
    readJsonBody(req, (err, data) => {
        if (err) return sendJson(res, 400, { ok: false, error: 'bad_request' });
        authorizeAdmin(data).then((okAuth) => {
            if (!okAuth) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
            // Token-based auth (Supabase/secure) reads the sheet with the server's
            // APPS_SCRIPT_KEY; legacy auth uses the key the admin typed.
            const scriptKey = APPS_SCRIPT_KEY || (data && data.key) || '';
            const url = APPS_SCRIPT_URL + '?key=' + encodeURIComponent(scriptKey) + '&callback=cb';
            return fetchUrl(url).then((text) => {
                // Strip the JSONP wrapper: cb({...}) -> {...}
                const start = text.indexOf('('), end = text.lastIndexOf(')');
                const json = (start >= 0 && end > start) ? text.slice(start + 1, end) : text;
                res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
                res.end(json);
            });
        }).catch(() => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'upstream_error' }));
        });
    });
}

// --- Stripe webhook: branded order-confirmation email ---------------------
// Read the RAW request body (signature verification needs the exact bytes).
function readRawBody(req, cb) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1000000) req.destroy(); });
    req.on('end', () => cb(null, body));
    req.on('error', (e) => cb(e));
}

// Verify the Stripe-Signature header (HMAC-SHA256 of "t.payload" with the
// webhook secret), with a 5-minute timestamp tolerance to block replays.
function verifyStripeSignature(rawBody, header) {
    if (!STRIPE_WEBHOOK_SECRET || !header) return false;
    let t = ''; const v1 = [];
    String(header).split(',').forEach((kv) => {
        const i = kv.indexOf('=');
        if (i < 0) return;
        const k = kv.slice(0, i).trim(), val = kv.slice(i + 1).trim();
        if (k === 't') t = val; else if (k === 'v1') v1.push(val);
    });
    const ts = parseInt(t, 10);
    if (!ts || !v1.length || Math.abs(Date.now() / 1000 - ts) > 300) return false;
    const expected = crypto.createHmac('sha256', STRIPE_WEBHOOK_SECRET).update(t + '.' + rawBody, 'utf8').digest('hex');
    return v1.some((v) => {
        try { return v.length === expected.length && crypto.timingSafeEqual(Buffer.from(v), Buffer.from(expected)); }
        catch (e) { return false; }
    });
}

// Strip the "Order ECO-… · " prefix the checkout adds to the first line item's
// description, so the email build text doesn't repeat the order number.
function stripOrderPrefix(s) { return String(s || '').replace(/^Order\s+ECO-\w+\s*·\s*/i, ''); }

const emailedSessions = new Set(); // best-effort in-memory dedupe (resets on restart)

// POST /api/stripe-webhook - on checkout.session.completed, email the customer a
// branded confirmation. Acknowledges Stripe immediately, then sends async (the
// order is already safely recorded in Stripe + the admin dashboard, so a missed
// email is non-fatal). No-op until STRIPE_WEBHOOK_SECRET + SMTP creds are set.
function handleStripeWebhook(req, res) {
    if (!STRIPE_WEBHOOK_SECRET || !mailer.mailerReady() || !STRIPE_SECRET_KEY) {
        return sendJson(res, 200, { ok: true, skipped: 'not_configured' });
    }
    readRawBody(req, (err, raw) => {
        if (err) return sendJson(res, 400, { error: 'bad_request' });
        if (!verifyStripeSignature(raw, req.headers['stripe-signature'])) {
            return sendJson(res, 400, { error: 'bad_signature' });
        }
        let event;
        try { event = JSON.parse(raw); } catch (e) { return sendJson(res, 400, { error: 'bad_json' }); }
        sendJson(res, 200, { received: true }); // ack fast; do the work after
        if (event.type !== 'checkout.session.completed') return;
        const session = event.data && event.data.object;
        if (!session || (session.payment_status !== 'paid' && session.payment_status !== 'no_payment_required')) return;
        if (emailedSessions.has(session.id)) return;
        emailedSessions.add(session.id);
        sendOrderConfirmation(session.id).catch((e) => {
            emailedSessions.delete(session.id); // let a Stripe retry try again
            console.error('[webhook] order email failed:', e && e.message);
        });
    });
}

// Fetch the full session (with line items), shape it, and send the email.
function sendOrderConfirmation(sessionId) {
    const url = STRIPE_SESSIONS_URL + '/' + encodeURIComponent(sessionId) + '?expand[]=line_items';
    return stripeGet(url).then((r) => {
        if (r.status >= 300 || !r.json) throw new Error('stripe_fetch_' + r.status);
        const s = r.json;
        const meta = s.metadata || {};
        const cd = s.customer_details || {};
        const email = ((cd.email || s.customer_email) || '').trim();
        if (!email) throw new Error('no_customer_email');
        const sd = s.shipping_details || s.shipping || (s.collected_information && s.collected_information.shipping_details) || null;
        const addr = (sd && sd.address) || cd.address || {};
        const config = [];
        for (let i = 0; i < 50; i++) { if (meta['item_' + i]) config.push(meta['item_' + i]); else break; }
        const liData = (s.line_items && s.line_items.data) || [];
        const items = liData.map((li, i) => ({ text: config[i] || stripOrderPrefix(li.description), qty: li.quantity, amount: li.amount_total }));
        const custom = config.some((c) => /custom graphic/i.test(c)) || items.some((it) => /custom graphic/i.test(it.text || ''));
        const order = {
            orderNo: meta.order_no || orderNumber(s.id),
            email: email,
            items: items,
            shipping: {
                name: (sd && sd.name) || cd.name || '',
                line1: addr.line1 || '', line2: addr.line2 || '',
                city: addr.city || '', state: addr.state || '',
                postal_code: addr.postal_code || '', country: addr.country || ''
            },
            subtotal: s.amount_subtotal,
            shippingCost: (s.total_details && s.total_details.amount_shipping) || 0,
            total: s.amount_total,
            custom: custom
        };
        const mail = mailer.renderOrderEmail(order);
        return mailer.sendMail({ to: email, bcc: OWNER_EMAIL, subject: mail.subject, html: mail.html, replyTo: 'info@ecoroundholsters.com' })
            .then(() => console.log('[webhook] order email sent for ' + order.orderNo + ' to ' + email));
    });
}

const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];

    if (req.method === 'POST' && urlPath === '/api/admin-login') return handleAdminLogin(req, res);
    if (req.method === 'POST' && urlPath === '/api/signup') return handleSignupSubmit(req, res);
    if (req.method === 'POST' && urlPath === '/api/signups') return handleSignupsApi(req, res);
    if (req.method === 'POST' && urlPath === '/api/checkout') return handleCheckout(req, res);
    if (req.method === 'POST' && urlPath === '/api/stripe-webhook') return handleStripeWebhook(req, res);
    if (req.method === 'GET' && urlPath === '/api/order') return handleOrder(req, res);
    if (req.method === 'GET' && urlPath === '/api/catalog') return handleCatalog(req, res);
    if (req.method === 'POST' && urlPath === '/api/orders') return handleOrders(req, res);
    if (req.method === 'POST' && urlPath === '/api/my-orders') return handleMyOrders(req, res);

    let filePath = path.join(__dirname, urlPath === '/' ? '/index.html' : urlPath);
    const ext = path.extname(filePath);
    const contentType = mimeTypes[ext] || 'application/octet-stream';

    fs.readFile(filePath, (err, content) => {
        if (err) {
            fs.readFile(path.join(__dirname, 'index.html'), (e, fallback) => {
                res.writeHead(e ? 500 : 200, { 'Content-Type': 'text/html' });
                res.end(e ? 'Server Error' : fallback);
            });
            return;
        }
        res.writeHead(200, { 'Content-Type': contentType });
        res.end(content);
    });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
