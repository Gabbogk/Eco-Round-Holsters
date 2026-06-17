/* ============================================================================
 * guns-data.js - shared firearm make -> model list.
 *
 * One source of truth for the homepage gun-finder AND the product-page Make/Model
 * dropdowns, so they never drift apart. A gun that's not here can still be ordered
 * via the "I don't see my firearm" request flow (firearm-request.html).
 * Exposes window.GUN_DATA = { 'Make': ['Model', ...], ... }.
 * ==========================================================================*/
window.GUN_DATA = {
    'Glock': ['G17', 'G19', 'G19X', 'G26', 'G43', 'G43X', 'G45', 'G48'],
    'Sig Sauer': ['P320', 'P365', 'P365X', 'P365XL', 'P226', 'P229', 'P238', 'P938'],
    'Smith & Wesson': ['M&P Shield', 'M&P Shield Plus', 'M&P 2.0', 'SD9 VE', 'CSX'],
    'Springfield Armory': ['Hellcat', 'Hellcat Pro', 'XD-S', 'XD-M', 'Echelon', '1911'],
    'Ruger': ['LCP MAX', 'Security-9', 'SR9c', 'MAX-9', 'LC9s', '57'],
    'Beretta': ['92FS', 'PX4 Storm', 'APX', 'Nano', 'M9A3'],
    'CZ': ['P-07', 'P-10C', 'P-10S', '75 Compact', 'Shadow 2'],
    'FN': ['FN 509', 'FN 509 Tactical', 'FNX-45', 'Five-seveN'],
    'HK': ['VP9', 'VP9SK', 'P30', 'P30SK', 'USP Compact'],
    'Walther': ['PDP', 'PPQ', 'PPS M2', 'CCP M2', 'P99'],
    'Taurus': ['G2C', 'G3C', 'GX4', 'TX22', '856'],
    'Kimber': ['Micro 9', 'K6s', 'R7 Mako', '1911 Custom'],
    'Canik': ['TP9 Elite SC', 'TP9SF', 'METE MC9', 'Rival']
};
