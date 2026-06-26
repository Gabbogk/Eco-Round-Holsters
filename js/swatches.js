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
        { name: 'Black', hex: '#1a1a1a' },
        { name: 'Blizzard White', hex: '#ededed' },
        { name: 'Battleship Gray', hex: '#adb2b6' },
        { name: 'Coyote Gray', hex: '#7c7268' },
        { name: 'Gunmetal Gray', hex: '#37393e' },
        { name: 'Desert Tan', hex: '#cfb488' },
        { name: 'Flat Dark Earth - Spring', hex: '#ad9374' },
        { name: 'Flat Dark Earth - Fall', hex: '#8a8174' },
        { name: 'Coyote Brown', hex: '#9b6a3c' },
        { name: 'Desert Fox', hex: '#bd7c39' },
        { name: 'Chocolate Brown', hex: '#4a3526' },
        { name: 'Foliage Green', hex: '#707d6c' },
        { name: 'Olive Drab', hex: '#6a6334' },
        { name: 'Ranger Green', hex: '#565f39' },
        { name: 'Infantry Green', hex: '#1f5a39' },
        { name: 'Blood Red', hex: '#8b1a1d' },
        { name: 'E.M.T. Red', hex: '#d91f25' },
        { name: 'Hunter Orange', hex: '#f25a1f' },
        { name: 'POLICE Blue', hex: '#1c2c63' },
        { name: 'Tiffany Blue', hex: '#78d1cc' },
        { name: 'Purple Haze', hex: '#6d3fa0' },
        { name: 'Bubblegum', hex: '#f486bc' },
        { name: 'Hot Pink', hex: '#ef3d8b' },
        { name: 'Toxic Yellow', hex: '#d3e70e' },
        { name: 'Zombie Green', hex: '#46cf52' }
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

    // Light/laser models for the "weapon-attachment molding" add-on dropdown.
    // Edit ONLY this list to add/remove/reorder - it auto-fills #lightSelect on
    // whichever product pages have the molding add-on (keep it alphabetized).
    var LIGHTS = [
        'Olight Baldr Mini',
        'Olight Baldr Pro',
        'Olight PL X',
        'Streamlight TLR-7 HL-X',
        'Streamlight TLR-7 Sub',
        'Streamlight TLR-7 X',
        'Streamlight TLR-8',
        'Streamlight TLR-9'
    ];
    function fillLights() {
        var sel = document.getElementById('lightSelect');
        if (!sel) return;
        sel.innerHTML = '<option value="">Select your light/laser…</option>';
        LIGHTS.forEach(function (n) {
            var o = document.createElement('option'); o.textContent = n; sel.appendChild(o);
        });
    }

    // Pre-made custom-graphic designs shown in the configurator when a Custom
    // Graphic finish is picked. To add a design, drop its image in
    // images/products/ and add a { name, img } line here - that's it.
    var GRAPHICS = [
        { name: 'Leopard', img: 'images/products/ecotuck-graphic-leopard.jpg' },
        { name: 'Thin Blue Line', img: 'images/products/ecotuck-graphic-blueline.jpg' },
        { name: 'Patriotic (America 250)', img: 'images/products/ecotuck-graphic-patriotic.jpg' }
    ];
    // Render the design picker: stock designs + an "email my own" option. onPick(name,
    // isOwn) fires on each pick and once for the default (first design).
    function renderGraphics(container, onPick) {
        if (!container) return;
        container.innerHTML = '';
        var items = GRAPHICS.concat([{ name: 'Email my own design', own: true }]);
        items.forEach(function (g, i) {
            var cell = document.createElement('button');
            cell.type = 'button';
            cell.className = 'graphic-pick' + (i === 0 ? ' active' : '');
            cell.setAttribute('title', g.name);
            var thumb = document.createElement('span');
            thumb.className = 'graphic-thumb' + (g.own ? ' graphic-own' : '');
            if (g.img) thumb.style.backgroundImage = "url('" + g.img + "')";
            else thumb.textContent = '✉';
            var label = document.createElement('span');
            label.className = 'graphic-label';
            label.textContent = g.own ? 'My own' : g.name;
            cell.appendChild(thumb);
            cell.appendChild(label);
            cell.addEventListener('click', function () {
                var cur = container.querySelector('.graphic-pick.active');
                if (cur) cur.classList.remove('active');
                cell.classList.add('active');
                if (onPick) onPick(g.name, !!g.own);
            });
            container.appendChild(cell);
        });
        if (items[0] && onPick) onPick(items[0].name, !!items[0].own);
    }

    window.EcoSwatch = {
        KYDEX_COLORS: KYDEX_COLORS,
        GRAPHICS: GRAPHICS,
        renderGraphics: renderGraphics,
        WASHER_HEX: WASHER_HEX,
        LIGHTS: LIGHTS,
        fillLights: fillLights,
        renderKydex: function (container, onPick, exclude) {
            if (!container) return;
            // Guard: only re-render when the excluded set changes, so switching
            // between non-double-sided finishes doesn't needlessly reset the color.
            var key = (exclude && exclude.length) ? exclude.slice().sort().join('|') : '';
            if (container.getAttribute('data-excl') === key) return;
            container.setAttribute('data-excl', key);
            var list = (exclude && exclude.length)
                ? KYDEX_COLORS.filter(function (c) { return exclude.indexOf(c.name) === -1; })
                : KYDEX_COLORS;
            render(container, list, 'kydex', onPick);
        },
        renderWashers: function (container, names, onPick) {
            if (typeof names === 'function') { onPick = names; names = null; }
            var list = (names && names.length ? names : DEFAULT_WASHERS).map(function (n) {
                return { name: n, hex: WASHER_HEX[n] || '#888888' };
            });
            render(container, list, 'washer', onPick);
        }
    };

    if (document.readyState !== 'loading') fillLights();
    else document.addEventListener('DOMContentLoaded', fillLights);
})();
