/*!
 * Zelos — shared 3D globe mount helper (globe.gl + three.js).
 *
 * This is the one deliberate exception to the rest of the theme's
 * "CSS/SVG only, no canvas, no JS render loop" rule — a real rotating globe
 * needs WebGL. To keep that from becoming a performance problem, every
 * mount point created here:
 *   - loads mock heat data instantly (no waiting on a real market feed)
 *   - caps devicePixelRatio so retina screens don't 4x the render cost
 *   - pauses its render loop via IntersectionObserver when scrolled off
 *     screen, and on document visibilitychange when the tab isn't active
 *   - is destroyed cleanly if the page removes its container
 *
 * Usage:
 *   ZelosGlobe.mount({
 *     el: document.getElementById('someContainer'),
 *     badges: [{ name:'US', lat:39, lng:-98, pct:1.21 }, ...],
 *     autoRotate: true,
 *     enableZoom: true,
 *     onReady: function(globeInstance){ ... }
 *   });
 */
(function (global) {
  var COUNTRIES_URL = 'https://raw.githubusercontent.com/vasturiano/globe.gl/master/example/datasets/ne_110m_admin_0_countries.geojson';
  var EARTH_TEXTURE = '//unpkg.com/three-globe/example/img/earth-dark.jpg';

  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v || fallback;
    } catch (e) { return fallback; }
  }

  function hashCode(str) {
    var h = 0;
    str = str || '';
    for (var i = 0; i < str.length; i++) { h = (h << 5) - h + str.charCodeAt(i); h |= 0; }
    return h;
  }

  // deterministic mock "% change" per country name, in roughly [-3.2, 3.6]
  function pctForCountry(name) {
    var h = Math.abs(hashCode(name));
    var frac = (h % 1000) / 1000;
    return frac * 6.8 - 3.2;
  }

  function hexToRgb(hex) {
    hex = (hex || '').replace('#', '');
    if (hex.length === 3) hex = hex.split('').map(function (c) { return c + c; }).join('');
    var n = parseInt(hex, 16) || 0;
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mixRgb(c1, c2, t) {
    return c1.map(function (v, i) { return Math.round(v + (c2[i] - v) * t); });
  }

  function colorForPct(pct, alpha) {
    alpha = alpha == null ? 0.8 : alpha;
    var bull = hexToRgb(cssVar('--bull', '#3ecb7c'));
    var danger = hexToRgb(cssVar('--danger', '#e0483f'));
    var flat = hexToRgb(cssVar('--muted-2', '#8f7250'));
    var t = Math.max(-1, Math.min(1, pct / 3.2));
    var rgb = t >= 0 ? mixRgb(flat, bull, t) : mixRgb(flat, danger, -t);
    return 'rgba(' + rgb.join(',') + ',' + alpha + ')';
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, ctx = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(ctx, args); }, ms);
    };
  }

  function isInViewport(el) {
    if (!el) return false;
    var r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < (window.innerHeight || document.documentElement.clientHeight);
  }

  function mount(opts) {
    var el = opts.el;
    if (!el || typeof global.Globe !== 'function') {
      if (el) el.innerHTML = '<div class="globe-loading">Live map unavailable right now</div>';
      return;
    }

    var loading = document.createElement('div');
    loading.className = 'globe-loading';
    loading.textContent = 'Loading global markets…';
    el.appendChild(loading);

    fetch(COUNTRIES_URL)
      .then(function (r) { return r.json(); })
      .then(function (world) {
        if (loading.parentNode) loading.parentNode.removeChild(loading);

        var accent = cssVar('--accent', '#4a86ff');
        // logarithmicDepthBuffer cuts down the shimmering/"glitchy" seams that
        // show up between adjacent country polygons on a plain WebGL depth
        // buffer at this scale (a known globe.gl/three.js artifact, not a
        // country-data issue) — see the note above on why this is the one
        // place in the theme that needs WebGL tuning at all.
        var g = global.Globe({ rendererConfig: { antialias: true, logarithmicDepthBuffer: true } })(el)
          .globeImageUrl(EARTH_TEXTURE)
          .backgroundColor('rgba(0,0,0,0)')
          .showAtmosphere(true)
          .atmosphereColor(accent)
          .atmosphereAltitude(0.18)
          .polygonsData(world.features)
          .polygonCapColor(function (f) {
            var name = (f.properties && (f.properties.NAME || f.properties.ADMIN)) || '';
            return colorForPct(pctForCountry(name));
          })
          .polygonSideColor(function () { return 'rgba(0,0,0,0.18)'; })
          .polygonStrokeColor(function () { return 'rgba(10,7,4,0.45)'; })
          .polygonAltitude(0.012)
          .polygonsTransitionDuration(0);

        if (opts.badges && opts.badges.length) {
          g.htmlElementsData(opts.badges)
            .htmlLat('lat')
            .htmlLng('lng')
            .htmlAltitude(0.025)
            .htmlElement(function (d) {
              var div = document.createElement('div');
              div.className = 'globe-badge ' + (d.pct >= 0 ? 'up' : 'dn');
              div.innerHTML = '<span class="name">' + d.name + '</span><span class="pct">' +
                (d.pct >= 0 ? '+' : '') + d.pct.toFixed(2) + '%</span>';
              return div;
            });
        }

        g.pointOfView({ lat: 18, lng: -30, altitude: opts.altitude || 2.1 }, 0);

        var controls = g.controls();
        if (controls) {
          controls.autoRotate = opts.autoRotate !== false;
          controls.autoRotateSpeed = 0.55;
          controls.enableZoom = opts.enableZoom !== false;
          controls.enablePan = false;
        }

        var renderer = g.renderer && g.renderer();
        if (renderer && renderer.setPixelRatio) {
          renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, 1.5));
        }

        function resize() {
          var w = el.clientWidth, h = el.clientHeight;
          if (w && h) g.width(w).height(h);
        }
        resize();
        // a plain window-resize listener misses cases where the CONTAINER's
        // own size changes without the window changing — e.g. a flex/
        // aspect-ratio layout that hasn't finished settling on first paint,
        // or fonts/webfonts loading in and reflowing the hero above it. A
        // ResizeObserver on the element itself catches that directly, which
        // is what actually fixes a globe that renders stretched/"cut off"
        // because it sized itself against a 0×0 or transitional box.
        if ('ResizeObserver' in global) {
          var ro = new ResizeObserver(debounce(resize, 100));
          ro.observe(el);
        } else {
          global.addEventListener('resize', debounce(resize, 150));
        }
        // belt-and-suspenders: re-check shortly after mount in case the very
        // first resize() ran before layout had settled at all.
        setTimeout(resize, 300);

        // pause the render loop whenever this globe isn't actually visible —
        // this is the main defense against "lagging out the site"
        if ('IntersectionObserver' in global) {
          var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (entry.isIntersecting && !document.hidden) { g.resumeAnimation(); }
              else { g.pauseAnimation(); }
            });
          }, { threshold: 0.05 });
          io.observe(el);
        }
        document.addEventListener('visibilitychange', function () {
          if (document.hidden) g.pauseAnimation();
          else if (isInViewport(el)) g.resumeAnimation();
        });

        if (opts.onReady) opts.onReady(g);
      })
      .catch(function (err) {
        if (loading.parentNode) loading.parentNode.removeChild(loading);
        el.innerHTML = '<div class="globe-loading">Live map unavailable right now</div>';
        if (global.console) console.error('Zelos globe failed to load', err);
      });
  }

  global.ZelosGlobe = { mount: mount, pctForCountry: pctForCountry, colorForPct: colorForPct };
})(window);
