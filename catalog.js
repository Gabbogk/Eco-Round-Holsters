// ============================================================================
// catalog.js - SERVER-SIDE source of truth for pricing.
//
// The browser product pages compute a price for display only. NEVER trust that
// number: a shopper can edit the page and send any price they like. At checkout
// the server recomputes every line total from THIS file, so the amount charged
// is always ours, not the client's.
//
// Money is in integer US cents everywhere to avoid floating-point drift.
// Option keys here must match the `data-key` attributes on the product pages.
// ============================================================================

var FREE_SHIPPING_THRESHOLD = 10000; // $100.00 - orders at/above ship free
var SHIPPING_FLAT = 695;             // $6.95 flat under the threshold

// Product ids that ALWAYS ship free regardless of subtotal (the checkout test item).
var FREE_SHIP_IDS = { 'checkout-test': true };

// Per product: base price + the priced add-on keys. Anything a shopper can pick
// that costs nothing (hand, belt-loop size, attachment, washer color) is simply
// absent here and contributes $0 - it still rides along in the line description.
var PRODUCTS = {
    'ecotuck-iwb': {
        name: 'EcoTuck IWB',
        base: 5500,
        addOns: {
            'finish-carbon': 1000,
            'finish-carbon-2sided': 1500,
            'finish-graphic-kydex': 1500,
            'finish-graphic-carbon': 2000,
            'clip-monoblock': 500,
            'clip-ulti': 1500,
            'addon-claw': 500,
            'addon-washers': 500,
            'addon-molding': 1000
        }
    },
    'ecotwin-iwb': {
        name: 'EcoTwin Sidecar',
        base: 10000,
        addOns: {
            'finish-carbon': 1000,
            'finish-carbon-2sided': 1500,
            'finish-graphic-kydex': 1500,
            'finish-graphic-carbon': 2000,
            'clip-metal': 1000,
            'addon-washers': 500,
            'addon-molding': 1000
        }
    },
    'ecosnug-owb': {
        name: 'EcoSnug OWB',
        base: 6500,
        addOns: {
            'finish-carbon': 1000,
            'finish-carbon-2sided': 1500,
            'finish-graphic-kydex': 1500,
            'finish-graphic-carbon': 2000,
            'addon-washers': 500,
            'addon-molding': 1000
        }
    },
    'ecodraw-owb': {
        name: 'EcoDraw OWB',
        base: 6900,
        addOns: {
            'finish-carbon': 1000,
            'finish-carbon-2sided': 1500,
            'finish-graphic-kydex': 1500,
            'finish-graphic-carbon': 2000,
            'addon-washers': 500,
            'addon-molding': 1000
        }
    },
    'enforcer': {
        name: 'Lock n Load',
        base: 5000,
        addOns: {
            'finish-carbon': 1000,
            'finish-carbon-2sided': 1500,
            'finish-graphic-kydex': 1500,
            'finish-graphic-carbon': 2000
        }
    },
    'suupack': {
        name: 'Suu Pack',
        base: 4000,
        addOns: {
            'finish-carbon': 1000,
            'finish-carbon-2sided': 1500,
            'finish-graphic-kydex': 1500,
            'finish-graphic-carbon': 2000,
            'addon-washers': 500
        }
    },
    // Internal checkout-test item: $0.50 (Stripe's minimum charge - a true 1-cent
    // charge is rejected), free shipping. Reached only via /test-checkout.html
    // (not linked anywhere). Safe to delete this entry once testing is done.
    'checkout-test': {
        name: 'EcoRound Checkout Test',
        base: 50,
        addOns: {}
    }
};

function clampText(s, max) {
    if (typeof s !== 'string') return '';
    s = s.trim();
    return s.length > max ? s.slice(0, max) : s;
}

// Price a single cart line authoritatively. Throws on an unknown product.
// Unknown option keys contribute $0 (a tampered/extra key can never raise OR
// lower our price below base - it just doesn't match a paid add-on).
// Clamp a value to a valid integer cent price in [0, $10,000]. Returns null if
// the value isn't a usable number, so callers can fall back to the default.
function clampCents(n) {
    n = (typeof n === 'string') ? parseInt(n, 10) : Math.round(n);
    if (typeof n !== 'number' || !isFinite(n) || n < 0 || n > 1000000) return null;
    return n;
}

// Merge admin price overrides over the built-in defaults, producing the effective
// product map the server prices against. Only KNOWN product ids + KNOWN add-on
// keys are ever touched (the option set is fixed in code), and every value is
// clamped - a malformed/hostile override can never invent products or wild prices.
function effectiveProducts(overrides) {
    var out = {};
    Object.keys(PRODUCTS).forEach(function (id) {
        var d = PRODUCTS[id];
        var addOns = {};
        Object.keys(d.addOns).forEach(function (k) { addOns[k] = d.addOns[k]; });
        out[id] = { name: d.name, base: d.base, addOns: addOns };
    });
    var ov = overrides && overrides.products;
    if (ov && typeof ov === 'object') {
        Object.keys(out).forEach(function (id) {
            var o = ov[id];
            if (!o || typeof o !== 'object') return;
            var b = clampCents(o.base);
            if (b !== null) out[id].base = b;
            if (o.addOns && typeof o.addOns === 'object') {
                Object.keys(out[id].addOns).forEach(function (k) {
                    if (k in o.addOns) { var v = clampCents(o.addOns[k]); if (v !== null) out[id].addOns[k] = v; }
                });
            }
        });
    }
    return out;
}

// Turn whatever the admin form submitted into a clean, complete override blob to
// persist: every known product + add-on, validated/clamped, defaults where the
// input is missing or invalid. This is what gets stored (never raw client input).
function sanitizeOverrides(input) {
    var src = (input && input.products) || {};
    var products = {};
    Object.keys(PRODUCTS).forEach(function (id) {
        var d = PRODUCTS[id];
        var s = src[id] || {};
        var base = clampCents(s.base);
        var addOns = {};
        Object.keys(d.addOns).forEach(function (k) {
            var v = (s.addOns && (k in s.addOns)) ? clampCents(s.addOns[k]) : null;
            addOns[k] = (v !== null) ? v : d.addOns[k];
        });
        products[id] = { base: (base !== null ? base : d.base), addOns: addOns };
    });
    return { products: products };
}

function priceItem(item, products) {
    products = products || PRODUCTS;
    if (!item || typeof item !== 'object') throw new Error('invalid item');
    var p = products[item.id];
    if (!p) throw new Error('unknown product: ' + item.id);

    var unit = p.base;
    var opts = Array.isArray(item.options) ? item.options : [];
    for (var i = 0; i < opts.length; i++) {
        if (Object.prototype.hasOwnProperty.call(p.addOns, opts[i])) {
            unit += p.addOns[opts[i]];
        }
    }

    var qty = parseInt(item.qty, 10);
    if (!(qty >= 1)) qty = 1;
    if (qty > 20) qty = 20;

    return {
        id: item.id,
        name: p.name,
        gun: clampText(item.gun, 80),
        washerColor: clampText(item.washerColor, 24),
        summary: clampText(item.summary, 200),
        unitAmount: unit,
        qty: qty
    };
}

// Price a whole cart. Returns { lines:[...], subtotal, shipping }.
function priceCart(items, products) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('empty cart');
    if (items.length > 50) throw new Error('cart too large');
    products = products || PRODUCTS;

    var lines = items.map(function (it) { return priceItem(it, products); });
    var subtotal = lines.reduce(function (sum, l) { return sum + l.unitAmount * l.qty; }, 0);
    var shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT;
    if (lines.length && lines.every(function (l) { return FREE_SHIP_IDS[l.id]; })) shipping = 0;

    return { lines: lines, subtotal: subtotal, shipping: shipping };
}

module.exports = {
    PRODUCTS: PRODUCTS,
    FREE_SHIPPING_THRESHOLD: FREE_SHIPPING_THRESHOLD,
    SHIPPING_FLAT: SHIPPING_FLAT,
    priceItem: priceItem,
    priceCart: priceCart,
    effectiveProducts: effectiveProducts,
    sanitizeOverrides: sanitizeOverrides
};
