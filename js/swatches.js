/* ============================================================================
 * swatches.js - shared color swatch picker for the product configurators.
 *
 * Single source of truth for the solid Kydex colors + washer colors. The
 * swatch shows the real color, so the NAME is just a label that rides along
 * into the cart / checkout / admin build sheet. Names are EcoRound's own.
 *
 * Usage on a product page (after this script loads):
 *     EcoSwatch.renderKydex(el, function (name, hex) { state.kydexColor = name; });
 *     EcoSwatch.renderWashers(el, function (name, hex) { state.washerColor = name; });
 * The render fires the callback once for the first (default) color too, so the
 * page's state is initialized without hardcoding the first name in two places.
 * ==========================================================================*/
(function () {
    'use strict';

    // Solid Kydex sheet colors we cut. To add/remove a color, edit ONLY this
    // list - every product page renders from it. hex is the on-screen swatch.
    var KYDEX_COLORS = [
        { name: 'Jet Black',      hex: '#1a1a1a' },
        { name: 'Arctic White',   hex: '#ededed' },
        { name: 'Silver Gray',    hex: '#adb2b6' },
        { name: 'Stone Gray',     hex: '#7c7268' },
        { name: 'Onyx Gray',      hex: '#37393e' },
        { name: 'Khaki',          hex: '#cfb488' },
        { name: 'Sand Earth',     hex: '#ad9374' },
        { name: 'Dusk Earth',     hex: '#8a8174' },
        { name: 'Saddle Tan',     hex: '#9b6a3c' },
        { name: 'Caramel',        hex: '#bd7c39' },
        { name: 'Espresso',       hex: '#4a3526' },
        { name: 'Sage Green',     hex: '#707d6c' },
        { name: 'Field Olive',    hex: '#6a6334' },
        { name: 'Recon Green',    hex: '#565f39' },
        { name: 'Forest Green',   hex: '#1f5a39' },
        { name: 'Garnet',         hex: '#8b1a1d' },
        { name: 'Rescue Red',     hex: '#d91f25' },
        { name: 'Blaze Orange',   hex: '#f25a1f' },
        { name: 'Blue',           hex: '#1c2c63' },
        { name: 'Sky',            hex: '#78d1cc' },
        { name: 'Royal Purple',   hex: '#6d3fa0' },
        { name: 'Pink',           hex: '#f486bc' },
        { name: 'Neon Pink',      hex: '#ef3d8b' },
        { name: 'Yellow',         hex: '#d3e70e' },
        { name: 'Atomic Green',   hex: '#46cf52' }
    ];

    // Colored washer hardware (set of 4). The +$5 add-on price lives in the
    // catalog/page; these are just the color choices once it's enabled. Every
    // page shares DEFAULT_WASHERS; to add a washer color, add its hex here AND
    // its name to the list below. Master name -> hex map; unknown -> gray.
    var WASHER_HEX = {
        Red: '#c0392b', Green: '#3aa856', Blue: '#2563b0', Pink: '#e85d9c', Purple: '#7d3f9a',
        Copper: '#b87333', Gold: '#c9a227', Silver: '#cdd2d7', Black: '#1a1a1a'
    };
    var DEFAULT_WASHERS = ['Red', 'Green', 'Blue', 'Pink', 'Purple', 'Copper', 'Gold', 'Silver', 'Black'];

    function render(container, colors, kind, onPick) {
        if (!container) return;
        container.innerHTML = '';
        var washer = kind === 'washer';
        colors.forEach(function (c, i) {
            var cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'swatch' + (washer ? ' swatch-washer' : '') + (i === 0 ? ' active' : '');
            cell.setAttribute('aria-label', c.name);
            cell.setAttribute('title', c.name);

            var chip = document.createElement('span');
            chip.className = 'swatch-chip';
            chip.style.background = c.hex;

            var label = document.createElement('span');
            label.className = 'swatch-label';
            label.textContent = c.name;

            cell.appendChild(chip);
            cell.appendChild(label);
            cell.addEventListener('click', function () {
                var cur = container.querySelector('.swatch.active');
                if (cur) cur.classList.remove('active');
                cell.classList.add('active');
                if (onPick) onPick(c.name, c.hex);
            });
            container.appendChild(cell);
        });
        if (colors[0] && onPick) onPick(colors[0].name, colors[0].hex);
    }

    window.EcoSwatch = {
        KYDEX_COLORS: KYDEX_COLORS,
        WASHER_HEX: WASHER_HEX,
        renderKydex: function (container, onPick) { render(container, KYDEX_COLORS, 'kydex', onPick); },
        renderWashers: function (container, names, onPick) {
            if (typeof names === 'function') { onPick = names; names = null; }
            var list = (names && names.length ? names : DEFAULT_WASHERS).map(function (n) {
                return { name: n, hex: WASHER_HEX[n] || '#888888' };
            });
            render(container, list, 'washer', onPick);
        }
    };
})();
