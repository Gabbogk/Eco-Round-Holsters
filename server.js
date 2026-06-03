const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;

// The Apps Script web app (same one the Notify Me form posts to).
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwVlX-ENTRfwyyaG9Q_G8m62eg5Hdxh-zem9kdA805aBLFN8g4kFkrSGzuy3nE98N9f3w/exec';

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

    if (req.method === 'POST' && urlPath === '/api/signups') {
        return handleSignupsApi(req, res);
    }

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
