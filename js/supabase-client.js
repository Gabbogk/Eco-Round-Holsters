/* ============================================================================
 * supabase-client.js - shared Supabase browser client.
 *
 * These two values are PUBLIC by design: the publishable key is meant to ship
 * in the browser. Access control is enforced by Supabase Row Level Security,
 * not by keeping this key secret (so it's fine in a public repo). The secret
 * key (sb_secret_...) NEVER goes here - it lives only on the server.
 *
 * Requires the supabase-js UMD library to be loaded first (window.supabase).
 * Exposes the ready-to-use client as window.sb.
 * ==========================================================================*/
(function () {
    'use strict';
    var SUPABASE_URL = 'https://ofjjbqchnwlhzncntiwv.supabase.co';
    var SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_BgDOuBLrhogRDz62BYvoIA_GMzqo1T3';

    if (!window.supabase || !window.supabase.createClient) {
        console.error('[supabase-client] supabase-js library not loaded');
        return;
    }
    // Persisted session (localStorage) so the customer stays logged in across
    // pages and tabs - that's what lets the header reflect login state sitewide.
    window.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
})();
