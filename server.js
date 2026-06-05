const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const catalog = require('./catalog');

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
    } catch (e) { /* no .env file — fine */ }
})();

// The Apps Script web app (same one the Notify Me form posts to).
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwVlX-ENTRfwyyaG9Q_G8m62eg5Hdxh-zem9kdA805aBLFN8g4kFkrSGzuy3nE98N9f3w/exec';

// Stripe secret key comes from the environment — NEVER hardcode it. Until it's
// set, the checkout endpoint returns a friendly "not configured yet" response.
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';
const STRIPE_SESSIONS_URL = 'https://api.stripe.com/v1/checkout/sessions';

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

// ---- Stripe (raw HTTPS, no SDK — keeps the zero-dependency server) --------

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
        const params = {
            mode: 'payment',
            success_url: origin + '/success.html?session_id={CHECKOUT_SESSION_ID}',
            cancel_url: origin + '/cancel.html',
            phone_number_collection: { enabled: 'true' },
            shipping_address_collection: { allowed_countries: ['US'] },
            line_items: priced.lines.map((l) => {
                let desc = l.summary || 'Custom-configured';
                if (l.washerColor) desc += ' · Washers: ' + l.washerColor;
                return {
                    quantity: l.qty,
                    price_data: {
                        currency: 'usd',
                        unit_amount: l.unitAmount,
                        product_data: {
                            name: l.name + (l.gun ? ' — ' + l.gun : ''),
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
            }]
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
                sendJson(res, 200, {
                    email: (j.customer_details && j.customer_details.email) || j.customer_email || '',
                    amount_total: j.amount_total,
                    payment_status: j.payment_status
                });
            });
        }).on('error', () => sendJson(res, 502, { error: 'stripe_unreachable' }));
}

// Admin data proxy: POST /api/signups { key } -> returns the Apps Script JSON.
// Same-origin, so no CORS and nothing for ad-blockers to block.
function handleSignupsApi(req, res) {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 100000) req.destroy(); });
    req.on('end', () => {
        let key = '';
        try { key = (JSON.parse(body || '{}').key) || ''; } catch (e) { key = ''; }
        const url = APPS_SCRIPT_URL + '?key=' + encodeURIComponent(key) + '&callback=cb';
        fetchUrl(url).then((text) => {
            // Strip the JSONP wrapper: cb({...}) -> {...}
            const start = text.indexOf('(');
            const end = text.lastIndexOf(')');
            const json = (start >= 0 && end > start) ? text.slice(start + 1, end) : text;
            res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
            res.end(json);
        }).catch(() => {
            res.writeHead(502, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: 'upstream_error' }));
        });
    });
}

const server = http.createServer((req, res) => {
    const urlPath = req.url.split('?')[0];

    if (req.method === 'POST' && urlPath === '/api/signups') return handleSignupsApi(req, res);
    if (req.method === 'POST' && urlPath === '/api/checkout') return handleCheckout(req, res);
    if (req.method === 'GET' && urlPath === '/api/order') return handleOrder(req, res);

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
