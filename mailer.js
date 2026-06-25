/* ============================================================================
 * mailer.js - tiny ZERO-DEPENDENCY SMTP sender (implicit TLS, e.g. Gmail :465)
 * plus the branded order-confirmation email template. Used by the Stripe
 * webhook in server.js to email a customer after a successful checkout.
 *
 * Credentials come from the environment (same pattern as STRIPE_SECRET_KEY):
 *   SMTP_USER  = info@ecoroundholsters.com   (the Google Workspace mailbox)
 *   SMTP_PASS  = a Google APP PASSWORD        (16 chars, NOT the normal password)
 *   SMTP_HOST  = smtp.gmail.com  (default)    SMTP_PORT = 465 (default)
 *   SMTP_FROM_NAME = EcoRound Holsters (default)
 * SMTP_PASS is a secret - it lives only on Railway / local .env, never committed.
 * Mail sent this way is authenticated as info@, so Google DKIM-signs it and it
 * inherits the domain's deliverability (the verified SPF/DKIM/DMARC setup).
 * ==========================================================================*/
'use strict';
const tls = require('tls');

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '465', 10);
const SMTP_USER = process.env.SMTP_USER || '';
const SMTP_PASS = process.env.SMTP_PASS || '';
const FROM_NAME = process.env.SMTP_FROM_NAME || 'EcoRound Holsters';

// True once SMTP creds are present. The webhook checks this so the feature is a
// safe no-op until the owner sets SMTP_PASS on Railway.
function mailerReady() { return !!(SMTP_USER && SMTP_PASS); }

// Strip CR/LF and control chars from a value placed in an SMTP/RFC822 header line,
// so an attacker-influenced field (recipient, subject) can never inject extra
// headers or smuggle body content. Header values are single-line by definition.
function hdr(s) { return String(s == null ? '' : s).replace(/[\r\n\t\f\v\0]+/g, ' ').trim(); }

// Send one HTML email over an implicit-TLS SMTP connection. Resolves once the
// message is accepted (250 after the body); rejects on any unexpected reply,
// socket error, or timeout. Lockstep conversation - we send the next command
// only after the expected reply for the previous one.
function sendMail(opts) {
    return new Promise((resolve, reject) => {
        if (!mailerReady()) return reject(new Error('smtp_not_configured'));
        const to = hdr(opts.to);
        if (to.indexOf('@') < 1) return reject(new Error('bad_recipient'));
        const bcc = hdr(opts.bcc);
        const replyTo = hdr(opts.replyTo || SMTP_USER);
        const subject = hdr(opts.subject);
        const html = String(opts.html || '');

        // Base64 body sidesteps SMTP dot-stuffing and the 998-char line limit.
        const b64 = Buffer.from(html, 'utf8').toString('base64').replace(/(.{1,76})/g, '$1\r\n');
        const headers = [
            'From: ' + hdr(FROM_NAME) + ' <' + SMTP_USER + '>',
            'To: ' + to,
            'Reply-To: ' + replyTo,
            'Subject: ' + subject,
            'MIME-Version: 1.0',
            'Content-Type: text/html; charset=utf-8',
            'Content-Transfer-Encoding: base64',
            'Date: ' + new Date().toUTCString(),
            'Message-ID: <' + Date.now() + '.' + Math.random().toString(36).slice(2) + '@ecoroundholsters.com>'
        ].join('\r\n');
        // message ends with CRLF; the body command appends ".\r\n" -> proper DATA terminator.
        const message = headers + '\r\n\r\n' + b64;

        const rcpts = [to].concat(bcc && bcc.indexOf('@') > 0 ? [bcc] : []);
        const commands = [
            { cmd: 'EHLO ecoroundholsters.com', expect: 250 },
            { cmd: 'AUTH LOGIN', expect: 334 },
            { cmd: Buffer.from(SMTP_USER, 'utf8').toString('base64'), expect: 334 },
            { cmd: Buffer.from(SMTP_PASS, 'utf8').toString('base64'), expect: 235 },
            { cmd: 'MAIL FROM:<' + SMTP_USER + '>', expect: 250 }
        ];
        rcpts.forEach((r) => commands.push({ cmd: 'RCPT TO:<' + r + '>', expect: 250 }));
        commands.push({ cmd: 'DATA', expect: 354 });
        commands.push({ cmd: message + '\r\n.', expect: 250 }); // <body>CRLF.CRLF terminator

        let step = -1;       // -1 = waiting for the 220 greeting
        let buf = '';
        let done = false;
        const socket = tls.connect({ host: SMTP_HOST, port: SMTP_PORT, servername: SMTP_HOST });
        socket.setEncoding('utf8');
        socket.setTimeout(20000);

        function fail(err) {
            if (done) return;
            done = true;
            try { socket.destroy(); } catch (e) { /* ignore */ }
            reject(err instanceof Error ? err : new Error(String(err)));
        }
        function handleReply(code) {
            if (done) return;
            if (step === -1) {
                if (code !== 220) return fail(new Error('SMTP greeting ' + code));
                step = 0;
                return socket.write(commands[0].cmd + '\r\n');
            }
            if (code !== commands[step].expect) {
                return fail(new Error('SMTP step ' + step + ' got ' + code + ', expected ' + commands[step].expect));
            }
            step++;
            if (step < commands.length) {
                socket.write(commands[step].cmd + '\r\n');
            } else {
                done = true;            // body accepted - success
                try { socket.write('QUIT\r\n'); socket.end(); } catch (e) { /* ignore */ }
                resolve(true);
            }
        }

        socket.on('data', (chunk) => {
            buf += chunk;
            // A complete reply ends on a line "NNN " (space after the code);
            // continuation lines use "NNN-". Process the final line when present.
            const lines = buf.split(/\r?\n/);
            for (let i = 0; i < lines.length; i++) {
                if (/^\d{3} /.test(lines[i])) {
                    const code = parseInt(lines[i].slice(0, 3), 10);
                    buf = lines.slice(i + 1).join('\r\n');
                    handleReply(code);
                    return;
                }
            }
        });
        socket.on('timeout', () => fail(new Error('SMTP timeout')));
        socket.on('error', fail);
        socket.on('close', () => { if (!done) fail(new Error('SMTP connection closed')); });
    });
}

// --- branded order-confirmation email ------------------------------------
function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) {
        return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c];
    });
}
function money(cents) { return '$' + ((cents || 0) / 100).toFixed(2); }

// order = { orderNo, email, items:[{text, qty, amount}], shipping:{name,line1,line2,city,state,postal_code,country},
//           subtotal, shippingCost, tax, total, custom(bool), notes(string) }
function renderOrderEmail(order) {
    const o = order || {};
    const items = o.items || [];
    const sh = o.shipping || {};
    const green = '#9a7b00', greenLt = '#f8d000', dark = '#1a1a1a', ink = '#2b2b2b', muted = '#777';

    const rows = items.map(function (it) {
        const qty = (it.qty > 1) ? '<span style="color:' + muted + ';">&nbsp;&times;&nbsp;' + it.qty + '</span>' : '';
        return '<tr>' +
            '<td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:' + ink + ';line-height:1.5;">' + esc(it.text || '') + qty + '</td>' +
            '<td style="padding:10px 0;border-bottom:1px solid #eee;font-size:14px;color:' + ink + ';text-align:right;white-space:nowrap;vertical-align:top;">' + money(it.amount) + '</td>' +
            '</tr>';
    }).join('');

    const shipName = sh.name ? esc(sh.name) + '<br>' : '';
    const cityLine = [sh.city, sh.state].filter(Boolean).map(esc).join(', ') + (sh.postal_code ? ' ' + esc(sh.postal_code) : '');
    const shipBlock = (sh.line1 || sh.city) ?
        '<tr><td style="padding:22px 0 0;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:' + muted + ';font-weight:bold;">Shipping to</td></tr>' +
        '<tr><td style="padding:6px 0 0;font-size:14px;color:' + ink + ';line-height:1.55;">' +
        shipName + (sh.line1 ? esc(sh.line1) + '<br>' : '') + (sh.line2 ? esc(sh.line2) + '<br>' : '') + cityLine +
        '</td></tr>' : '';

    const customBox = o.custom ?
        '<tr><td style="padding:20px 0 0;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf7da;border:1px solid #efe2a6;border-radius:8px;">' +
        '<tr><td style="padding:14px 16px;font-size:13px;color:' + ink + ';line-height:1.55;">' +
        '<strong style="color:' + green + ';">Your order includes a custom graphic.</strong><br>' +
        'Reply to this email with your artwork (a PNG or high-resolution image) so we can start your build. The sooner we have it, the sooner we ship.' +
        '</td></tr></table></td></tr>' : '';

    // Customer order notes (collapsed to a single line server-side). Echoed back so
    // the customer sees their instructions were received; the owner gets them via BCC.
    const notesBlock = o.notes ?
        '<tr><td style="padding:20px 0 0;">' +
        '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fafafa;border:1px solid #eee;border-radius:8px;">' +
        '<tr><td style="padding:14px 16px;">' +
        '<div style="font-size:12px;letter-spacing:1px;text-transform:uppercase;color:' + muted + ';font-weight:bold;margin-bottom:6px;">Your notes</div>' +
        '<div style="font-size:14px;color:' + ink + ';line-height:1.6;">' + esc(o.notes) + '</div>' +
        '</td></tr></table></td></tr>' : '';

    const shippingLabel = (o.shippingCost === 0) ? 'Free' : money(o.shippingCost);
    // Tax row only when tax was actually charged (registered locations); omitted otherwise.
    const taxRow = (o.tax > 0) ?
        '<tr><td style="padding:4px 0 0;font-size:14px;color:' + muted + ';">Tax</td><td style="padding:4px 0 0;font-size:14px;color:' + ink + ';text-align:right;">' + money(o.tax) + '</td></tr>' : '';

    const html =
'<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
'<body style="margin:0;padding:0;background:#f4f4f4;">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 12px;"><tr><td align="center">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">' +
    // header
    '<tr><td style="background:' + dark + ';padding:26px 28px;text-align:center;">' +
      '<div style="font-size:24px;font-weight:bold;letter-spacing:3px;"><span style="color:' + greenLt + ';">ECO</span><span style="color:#ffffff;">ROUND</span></div>' +
      '<div style="font-size:10px;letter-spacing:4px;color:#b8b8b8;margin-top:3px;">HOLSTERS</div>' +
    '</td></tr>' +
    // body
    '<tr><td style="padding:30px 28px 8px;">' +
      '<h1 style="margin:0 0 6px;font-size:21px;color:' + ink + ';">Order confirmed</h1>' +
      '<p style="margin:0 0 18px;font-size:14px;color:' + muted + ';line-height:1.6;">Thanks for your order. We have it and we are getting started - here are the details.</p>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf7da;border-radius:8px;margin-bottom:8px;"><tr>' +
        '<td style="padding:12px 16px;font-size:12px;letter-spacing:1px;text-transform:uppercase;color:' + muted + ';">Order number</td>' +
        '<td style="padding:12px 16px;font-size:16px;font-weight:bold;color:' + green + ';text-align:right;letter-spacing:.5px;">' + esc(o.orderNo || '') + '</td>' +
      '</tr></table>' +
    '</td></tr>' +
    // items + totals
    '<tr><td style="padding:14px 28px 0;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rows +
        '<tr><td style="padding:12px 0 0;font-size:14px;color:' + muted + ';">Subtotal</td><td style="padding:12px 0 0;font-size:14px;color:' + ink + ';text-align:right;">' + money(o.subtotal) + '</td></tr>' +
        '<tr><td style="padding:4px 0 0;font-size:14px;color:' + muted + ';">Shipping</td><td style="padding:4px 0 0;font-size:14px;color:' + ink + ';text-align:right;">' + shippingLabel + '</td></tr>' +
        taxRow +
        '<tr><td style="padding:10px 0 0;font-size:16px;font-weight:bold;color:' + ink + ';border-top:2px solid #eee;">Total</td><td style="padding:10px 0 0;font-size:16px;font-weight:bold;color:' + ink + ';text-align:right;border-top:2px solid #eee;">' + money(o.total) + '</td></tr>' +
      '</table>' +
    '</td></tr>' +
    // shipping + custom + lead time
    '<tr><td style="padding:6px 28px 0;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + shipBlock + notesBlock + customBox + '</table></td></tr>' +
    '<tr><td style="padding:22px 28px 0;"><p style="margin:0;font-size:13px;color:' + muted + ';line-height:1.6;">Every holster is made to order. Your current build and ship time is about <strong style="color:' + ink + ';">2-3 weeks</strong>. We will email tracking when it ships.</p></td></tr>' +
    '<tr><td style="padding:18px 28px 0;"><p style="margin:0;font-size:13px;color:' + muted + ';line-height:1.6;">Questions? Just reply to this email or reach us at <a href="mailto:info@ecoroundholsters.com" style="color:' + green + ';">info@ecoroundholsters.com</a>.</p></td></tr>' +
    // footer
    '<tr><td style="padding:26px 28px 28px;"><hr style="border:none;border-top:1px solid #eee;margin:0 0 14px;">' +
      '<p style="margin:0;font-size:11px;color:#aaa;line-height:1.6;">EcoRound Holsters &middot; <a href="https://www.ecoroundholsters.com" style="color:#aaa;">ecoroundholsters.com</a><br>You are receiving this because you placed an order with us.</p>' +
    '</td></tr>' +
  '</table>' +
'</td></tr></table></body></html>';

    return { subject: 'Order ' + (o.orderNo || '') + ' confirmed - EcoRound Holsters', html: html };
}

// --- "your order shipped" email (lighter than the order confirmation) ---
function renderShippedEmail(o) {
    const oo = o || {};
    const linkGold = '#9a7b00', dark = '#1a1a1a', ink = '#2b2b2b', muted = '#777', gold = '#f8d000';
    const trackBtn = oo.trackingUrl
        ? '<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding:20px 0 2px;"><a href="' + oo.trackingUrl + '" style="display:inline-block;background:' + gold + ';color:#1a1a1a;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-weight:bold;font-size:14px;letter-spacing:.5px;padding:12px 24px;border-radius:8px;">Track your package</a></td></tr></table>'
        : '';
    const html =
'<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>' +
'<body style="margin:0;padding:0;background:#f4f4f4;">' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:24px 12px;"><tr><td align="center">' +
  '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;">' +
    '<tr><td style="background:' + dark + ';padding:26px 28px;text-align:center;">' +
      '<div style="font-size:24px;font-weight:bold;letter-spacing:3px;"><span style="color:' + gold + ';">ECO</span><span style="color:#ffffff;">ROUND</span></div>' +
      '<div style="font-size:10px;letter-spacing:4px;color:#b8b8b8;margin-top:3px;">HOLSTERS</div>' +
    '</td></tr>' +
    '<tr><td style="padding:30px 28px;">' +
      '<h1 style="margin:0 0 6px;font-size:21px;color:' + ink + ';">Your order is on its way</h1>' +
      '<p style="margin:0 0 18px;font-size:14px;color:' + muted + ';line-height:1.6;">Good news - order <strong style="color:' + ink + ';">' + esc(oo.orderNo || '') + '</strong> has shipped.</p>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#fdf7da;border-radius:8px;"><tr><td style="padding:14px 16px;font-size:14px;color:' + ink + ';line-height:1.6;">Carrier: <strong>' + esc(oo.carrier || '') + '</strong><br>Tracking number: <strong>' + esc(oo.tracking || '') + '</strong></td></tr></table>' +
      trackBtn +
      '<p style="margin:18px 0 0;font-size:13px;color:' + muted + ';line-height:1.6;">Questions? Just reply to this email or reach us at <a href="mailto:info@ecoroundholsters.com" style="color:' + linkGold + ';">info@ecoroundholsters.com</a>.</p>' +
    '</td></tr>' +
    '<tr><td style="padding:0 28px 28px;"><hr style="border:none;border-top:1px solid #eee;margin:0 0 14px;"><p style="margin:0;font-size:11px;color:#aaa;line-height:1.6;">EcoRound Holsters &middot; <a href="https://www.ecoroundholsters.com" style="color:#aaa;">ecoroundholsters.com</a></p></td></tr>' +
  '</table>' +
'</td></tr></table></body></html>';
    return { subject: 'Your EcoRound order ' + (oo.orderNo || '') + ' has shipped', html: html };
}

module.exports = { sendMail: sendMail, mailerReady: mailerReady, renderOrderEmail: renderOrderEmail, renderShippedEmail: renderShippedEmail };
