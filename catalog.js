// ============================================================================
// catalog.js — SERVER-SIDE source of truth for pricing.
//
// The browser product pages compute a price for display only. NEVER trust that
// number: a shopper can edit the page and send any price they like. At checkout
// the server recomputes every line total from THIS file, so the amount charged
// is always ours, not the client's.
//
// Money is in integer US cents everywhere to avoid floating-point drift.
// Option keys here must match the `data-key` attributes on the product pages.
// ============================================================================

var FREE_SHIPPING_THRESHOLD = 10000; // $100.00 — orders at/above ship free
var SHIPPING_FLAT = 695;             // $6.95 flat under the threshold

// Per product: base price + the priced add-on keys. Anything a shopper can pick
// that costs nothing (hand, belt-loop size, attachment, washer color) is simply
// absent here and contributes $0 — it still rides along in the line description.
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
    }
};

function clampText(s, max) {
    if (typeof s !== 'string') return '';
    s = s.trim();
    return s.length > max ? s.slice(0, max) : s;
}

// Price a single cart line authoritatively. Throws on an unknown product.
// Unknown option keys contribute $0 (a tampered/extra key can never raise OR
// lower our price below base — it just doesn't match a paid add-on).
function priceItem(item) {
    if (!item || typeof item !== 'object') throw new Error('invalid item');
    var p = PRODUCTS[item.id];
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
function priceCart(items) {
    if (!Array.isArray(items) || items.length === 0) throw new Error('empty cart');
    if (items.length > 50) throw new Error('cart too large');

    var lines = items.map(priceItem);
    var subtotal = lines.reduce(function (sum, l) { return sum + l.unitAmount * l.qty; }, 0);
    var shipping = subtotal >= FREE_SHIPPING_THRESHOLD ? 0 : SHIPPING_FLAT;

    return { lines: lines, subtotal: subtotal, shipping: shipping };
}

module.exports = {
    PRODUCTS: PRODUCTS,
    FREE_SHIPPING_THRESHOLD: FREE_SHIPPING_THRESHOLD,
    SHIPPING_FLAT: SHIPPING_FLAT,
    priceItem: priceItem,
    priceCart: priceCart
};
