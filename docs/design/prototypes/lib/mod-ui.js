/* ============================================================
   MOD UI — instrument-flat component library (vanilla JS)
   Eido mod builder redesign · lib/mod-ui.js
   Works over file:// — no modules, no imports, no CDNs.
   Exposes one global: ModUI
   ============================================================ */
(function (global) {
  'use strict';

  var SVG_NS = 'http://www.w3.org/2000/svg';

  /* Eido card palette — the 8 accent presets offered in the color well.
     Cobalt #3f78df is RESERVED for the step class (grammar R5/D3) and is
     no swatch: a unique hue = one part you named; the shared cobalt +
     square = the work chain. Rust takes its slot. */
  var PRESETS = [
    '#222222', '#d66be8', '#a946c8', '#b8552f',
    '#48a2ef', '#eca23b', '#24986a', '#f1666d'
  ];
  var DEFAULT_ACCENT = '#a946c8';

  /* ---------------- helpers ---------------- */

  function make(tag, cls, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (parent) parent.appendChild(n);
    return n;
  }
  function makeSvg(tag, attrs, parent) {
    var n = document.createElementNS(SVG_NS, tag);
    if (attrs) for (var k in attrs) n.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(n);
    return n;
  }
  function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }
  function clamp100(v) { return clamp(v, 0, 100); }
  function snapValue(v, steps) {
    v = clamp100(v);
    if (!steps || steps < 2) return v;
    var q = 100 / steps;
    return clamp100(Math.round(v / q) * q);
  }
  function fmtPct(v) { return Math.round(v) + '%'; }
  function num(v, d) { return typeof v === 'number' && !isNaN(v) ? v : d; }

  var reducedMotion = typeof window !== 'undefined' && window.matchMedia
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  /* minimum footprint (cells) — boards enforce; the control reports.
     select reports 2×1 segmented / 2×2 stack (set per instance). */
  var MIN_CELLS = {
    pad:    { w: 2, h: 2 },
    curve:  { w: 4, h: 2 },
    range:  { w: 2, h: 1 },
    filter: { w: 2, h: 1 },
    words:  { w: 2, h: 1 },   /* a 1-cell text field is unusable (05 §WORDS) */
    order:  { w: 2, h: 2 },
    mixer:  { w: 2, h: 2 },   /* 3×2 for 5–6 channels — set per instance */
    fork:   { w: 3, h: 2 },
    revise: { w: 2, h: 1 },
    step:   { w: 3, h: 2 }
  };

  /* Jacks carry TWO silhouettes only (grammar R1): round = signal
     (scalar, span, series — all of them), square = artifact. Payload
     nuance lives in words (hover/drag chips), never in glyph shape. */

  /* the fidelity vocabulary — one vocabulary, specced once, identical on
     every part that carries execution fidelity (curve, fork, steps), and
     the SAME words as the workbench's WHEN IT RUNS lever (journey §4):
     a part pinned STAGED wears it on its face. The lever that resolves
     AUTO is workbench-side. */
  var FIDELITY = ['one-pass', 'in-stages', 'auto'];
  var FIDELITY_WORDS = { 'one-pass': 'ONE CALL', 'in-stages': 'STAGED', 'auto': 'AUTO' };

  /* revise strictness — the LIGHT TOUCH / THOROUGH foot chip */
  var STRICT = ['light', 'thorough'];
  var STRICT_WORDS = { light: 'LIGHT TOUCH', thorough: 'THOROUGH' };

  /* curve x detents — the five speakable positions */
  var CURVE_DETS = [0, 25, 50, 75, 100];
  var CURVE_DET_NAMES = ['START', 'QTR', 'MID', '3QTR', 'END'];
  function curveDetName(t) {
    for (var i = 0; i < CURVE_DETS.length; i++) {
      if (Math.abs(t - CURVE_DETS[i]) < 0.5) return CURVE_DET_NAMES[i];
    }
    return Math.round(t) + '%';
  }

  var FILTER_MODES = ['no-more-than', 'at-least', 'between'];
  var FILTER_MODE_WORDS = {
    'no-more-than': 'NO MORE THAN',
    'at-least': 'AT LEAST',
    'between': 'BETWEEN'
  };

  /* polar point on the dial face (screen coords: y down, angle clockwise) */
  function polar(cx, cy, r, deg) {
    var rad = (deg * Math.PI) / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
  }
  function arcPath(cx, cy, r, a0, a1) {
    var p0 = polar(cx, cy, r, a0);
    var p1 = polar(cx, cy, r, a1);
    var large = a1 - a0 > 180 ? 1 : 0;
    return 'M ' + p0.x.toFixed(3) + ' ' + p0.y.toFixed(3) +
           ' A ' + r + ' ' + r + ' 0 ' + large + ' 1 ' +
           p1.x.toFixed(3) + ' ' + p1.y.toFixed(3);
  }

  /* dial geometry: 270° sweep, gap at the bottom */
  var DIAL = { C: 55, ARC_R: 42, CORE_R: 25, A0: 135, SWEEP: 270 };

  /* ---------------- one-popup-at-a-time ---------------- */

  var currentPopup = null;
  function closePopup() {
    if (!currentPopup) return;
    document.removeEventListener('pointerdown', currentPopup.onDocDown, true);
    if (currentPopup.el.parentNode) currentPopup.el.parentNode.removeChild(currentPopup.el);
    currentPopup = null;
  }

  /* ---------------- node dots ---------------- */

  /* jack silhouette language (grammar R1): round = signal (scalar,
     span and series render round too — payload nuance moves to words),
     square = artifact (the SECOND cable family — wider ink, non-mating
     with signal jacks). `dir` is orthogonal to family: 'out' straddles
     the right edge (default), 'in' straddles the left with an inward
     chevron cue — EVERY input wears the chevron. */
  var IN_CHEV =
    '<svg class="mui-node-chev" viewBox="0 0 10 10" aria-hidden="true">' +
    '<path d="M3.4 2.2 L6.4 5 L3.4 7.8" fill="none" stroke="currentColor"' +
    ' stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  function buildNode(labelText, freestanding, type, dir) {
    var isIn = dir === 'in';
    var wrap = make('span', 'mui-node' + (freestanding ? ' mui-node--free' : '') +
      (isIn ? ' mui-node--in' : ''));
    var dot = make('span', 'mui-node-dot', wrap);
    var chev = null;
    var chip = make('span', 'mui-node-chip', wrap);
    chip.textContent = labelText || '';
    wrap._chip = chip;
    wrap._dir = isIn ? 'in' : 'out';
    wrap.setLabel = function (t) { chip.textContent = t; };
    wrap.setConnected = function (on) { wrap.classList.toggle('is-connected', !!on); };
    function addChev() {
      /* the inward-flow cue lives ON the dot; all input jacks in the
         system straddle the LEFT edge, so a right-pointing chevron reads
         "receives" for every one (curve POSITION, step signals + inlet) */
      if (isIn) { chev = make('span', 'mui-node-chev-wrap', dot); chev.innerHTML = IN_CHEV; }
    }
    /* setType keeps its API, but every signal shape (scalar/span/series)
       renders the ONE round dot; only 'artifact' changes the silhouette */
    wrap.setType = function (t) {
      wrap.classList.remove('mui-node--artifact');
      dot.innerHTML = '';
      if (t === 'artifact') wrap.classList.add('mui-node--artifact');
      addChev();
    };
    wrap.setType(type || 'scalar');
    return wrap;
  }

  /* a quiet-text foot chip that cycles a fixed word set on click — the
     filter mode-chip pattern, factored out. Used by the fidelity chip
     (ONE PASS · IN STAGES · AUTO) and revise's strictness chip
     (LIGHT TOUCH · THOROUGH). Exposes `.value` and `.setValue`. */
  function makeFootChip(states, wordsMap, initial, onCycle, extraCls) {
    var b = document.createElement('button');
    b.type = 'button';
    b.className = 'mui-foot-chip' + (extraCls ? ' ' + extraCls : '');
    var idx = Math.max(0, states.indexOf(initial));
    function paint() { b.textContent = wordsMap[states[idx]]; b.value = states[idx]; }
    b.addEventListener('click', function (e) {
      e.stopPropagation();
      idx = (idx + 1) % states.length;
      paint();
      if (onCycle) onCycle(states[idx]);
    });
    b.setValue = function (v) { var i = states.indexOf(v); if (i >= 0) { idx = i; paint(); } };
    paint();
    return b;
  }

  /** ModUI.nodeDot({label, accent, chipSide:'right'|'left'|'below',
      type:'scalar'|'span'|'series'|'artifact', dir:'in'|'out'}) → element */
  function nodeDot(opts) {
    opts = opts || {};
    var n = buildNode(opts.label || '', true, opts.type || 'scalar', opts.dir);
    if (opts.accent) n.style.setProperty('--accent', opts.accent);
    if (opts.chipSide === 'left') n.classList.add('chip-left');
    if (opts.chipSide === 'below') n.classList.add('chip-below');
    return n;
  }

  /* ---------------- control factory ---------------- */

  function control(opts) {
    opts = opts || {};
    var kind = opts.kind || 'dial';
    var STEPPED = kind === 'dial' || kind === 'slider' ||
                  kind === 'range' || kind === 'filter' || kind === 'curve' ||
                  kind === 'mixer';
    var cfg = {
      label:  opts.label != null ? String(opts.label) : 'CONTROL',
      accent: opts.accent || DEFAULT_ACCENT,
      steps:  STEPPED ? (opts.steps | 0) : 0,
      desc:   opts.desc || ''
    };
    /* named stops: names for the steps+1 detents; spoken and shown
       instead of numbers when the count matches. Range/filter own the
       idea; the SPEC 04 rider extends it to stepped dial/slider (a
       2-stop slider with end names IS the old Blend control). */
    if (kind === 'range' || kind === 'filter' ||
        kind === 'dial' || kind === 'slider') {
      cfg.stops = Array.isArray(opts.stops) ? opts.stops.slice() : null;
      if (cfg.stops && cfg.steps < 2) cfg.steps = Math.max(2, cfg.stops.length - 1);
    }
    /* slider end names — the slider's reason to exist (05 §SLIDER):
       a slider is a position between two named poles; a dial is a bare
       amount. The names render at the track ends and in the readout. */
    if (kind === 'slider') {
      var oe = opts.ends || {};
      cfg.ends = {
        low:  oe.low  != null ? String(oe.low)  : '',
        high: oe.high != null ? String(oe.high) : ''
      };
    }
    /* creator-authored name lists for the SPEC 04 speech kinds */
    function nameList(raw, min, max, fallback) {
      var out = (Array.isArray(raw) ? raw : [])
        .map(function (s) { return String(s).trim(); })
        .filter(function (s) { return s.length; })
        .slice(0, max);
      if (out.length < min) out = fallback.slice();
      return out;
    }
    if (kind === 'select') {
      cfg.options = nameList(opts.options, 2, 7, ['Option A', 'Option B']);
      cfg.frames = cfg.options.map(function (_, i) {
        return (Array.isArray(opts.frames) && opts.frames[i] != null)
          ? String(opts.frames[i]) : '';
      });
    }
    if (kind === 'order') {
      cfg.items = nameList(opts.items, 2, 7, ['First', 'Second', 'Third']);
    }
    if (kind === 'mixer') {
      cfg.channels = nameList(opts.channels, 2, 6, ['A', 'B']);
    }
    /* pad: per-axis config — the axes are sublabels, never identities */
    if (kind === 'pad') {
      function axCfg(a, dl) {
        a = a || {};
        return {
          label: a.label != null ? String(a.label).toUpperCase() : dl,
          low:   a.low  != null ? String(a.low)  : '',
          high:  a.high != null ? String(a.high) : '',
          steps: (a.steps | 0) >= 2 ? (a.steps | 0) : 0
        };
      }
      var oax = opts.axes || {};
      cfg.axes = { x: axCfg(oax.x, 'X'), y: axCfg(oax.y, 'Y') };
    }
    /* curve: timebase — what t means, a creator config, plain words */
    if (kind === 'curve') {
      cfg.timebase = opts.timebase === 'task' || opts.timebase === 'list'
        ? opts.timebase : 'answer';
      /* renamable x-detents — optional creator names for the five
         speakable positions (start/quarter/midway/three-quarters/end).
         Promoted from the deferred register: the task timebase's stage
         names ("exploring/organising/committing"). Up to five. */
      cfg.xdetents = Array.isArray(opts.xdetents) && opts.xdetents.length
        ? opts.xdetents.slice(0, 5).map(function (s) { return String(s); })
        : null;
    }
    /* FORK — compiled routing (the check block, act = paths). Creator
       authors the "look at" question and 2–3 paths, each {name, prose};
       the user's handle is the LEAN scalar. */
    if (kind === 'fork') {
      cfg.lookAt = opts.lookAt != null ? String(opts.lookAt) : '';
      var rawPaths = Array.isArray(opts.paths) ? opts.paths : null;
      cfg.paths = (rawPaths || [{ name: 'Path A' }, { name: 'Path B' }])
        .slice(0, 3).map(function (p, i) {
          p = p || {};
          return {
            name: p.name != null && String(p.name).trim() ? String(p.name) : 'Path ' + (i + 1),
            prose: p.prose != null ? String(p.prose) : ''
          };
        });
      if (cfg.paths.length < 2) cfg.paths.push({ name: 'Path B', prose: '' });
    }
    /* REVISE — compiled feedback (the check block, act = revise). Creator
       authors the metric prose, strictness, and fix-vs-start-over; the
       user's handle is PASSES (0–3, 0 = silent). */
    if (kind === 'revise') {
      cfg.metric = opts.metric != null ? String(opts.metric) : '';
      cfg.strict = STRICT.indexOf(opts.strict) >= 0 ? opts.strict : 'light';
      cfg.redo = opts.redo === 'restart' ? 'restart' : 'fix';
    }
    /* fidelity — opt-in per control (curve / fork carry it; steps use their shell; plain
       shapers never do). The foot chip cycles ONE PASS · IN STAGES · AUTO,
       mirrored in config; default AUTO. */
    var fidelityOn = !!opts.fidelity && (kind === 'curve' || kind === 'fork');
    if (fidelityOn) {
      cfg.fidelity = FIDELITY.indexOf(opts.fidelity) >= 0 ? opts.fidelity : 'auto';
    }

    /* ---- value normalizers for the structured kinds ---- */
    function stopName(v, noNames) {
      if (!noNames && cfg.stops && cfg.steps >= 2 && cfg.stops.length === cfg.steps + 1) {
        var idx = clamp(Math.round(v / (100 / cfg.steps)), 0, cfg.steps);
        return String(cfg.stops[idx]).toUpperCase();
      }
      return String(Math.round(v));
    }
    function normPad(v) {
      v = v || {};
      return {
        x: snapValue(num(v.x, 50), cfg.axes.x.steps),
        y: snapValue(num(v.y, 50), cfg.axes.y.steps)
      };
    }
    function normSpan(v) {
      v = v || {};
      var mode = kind === 'filter'
        ? (FILTER_MODES.indexOf(v.mode) >= 0 ? v.mode : 'no-more-than')
        : 'between';
      var lo = snapValue(num(v.lo, kind === 'filter' ? 0 : 30), cfg.steps);
      var hi = snapValue(num(v.hi, 70), cfg.steps);
      if (hi < lo) { var tmp = lo; lo = hi; hi = tmp; }
      if (mode === 'no-more-than') lo = 0;
      if (mode === 'at-least') hi = 100;
      return { lo: lo, hi: hi, mode: mode };
    }
    function normSeries(arr) {
      var pts = [];
      (Array.isArray(arr) ? arr : []).forEach(function (p) {
        if (!p) return;
        var t = num(Array.isArray(p) ? p[0] : p.t, null);
        var v = num(Array.isArray(p) ? p[1] : p.v, null);
        if (t == null || v == null) return;
        pts.push({ t: clamp100(t), v: snapValue(v, cfg.steps) });
      });
      pts.sort(function (a, b) { return a.t - b.t; });
      /* dedupe near-equal t */
      pts = pts.filter(function (p, i) { return i === 0 || p.t - pts[i - 1].t >= 1; });
      if (pts.length > 5) pts = pts.slice(0, 4).concat([pts[pts.length - 1]]);
      if (!pts.length) pts = [{ t: 0, v: 50 }, { t: 100, v: 50 }];
      if (pts.length === 1) pts = [{ t: 0, v: pts[0].v }, { t: 100, v: pts[0].v }];
      /* endpoints pinned: a curve always spans its whole timebase */
      pts[0].t = 0;
      pts[pts.length - 1].t = 100;
      return pts;
    }

    /* select: the picked option index — a nominal choice */
    function normPick(v) {
      return clamp(v | 0, 0, cfg.options.length - 1);
    }
    /* order: a permutation of authored item indices */
    function normPerm(v) {
      var n = cfg.items.length, seen = {}, out = [];
      (Array.isArray(v) ? v : []).forEach(function (x) {
        x = x | 0;
        if (x >= 0 && x < n && !seen[x]) { seen[x] = 1; out.push(x); }
      });
      for (var i = 0; i < n; i++) if (!seen[i]) out.push(i);
      return out;
    }
    /* mixer: shares always summing to 100 (internal array aligned with
       cfg.channels; get()/set() speak the {channel: share} map) */
    function quantizeShares(shares, pinned) {
      /* largest-remainder over step quanta; deterministic; exact-0
         channels never gain a quantum unless everything is 0 */
      var q = 100 / cfg.steps;
      var quanta = shares.map(function (s) { return s / q; });
      var out = quanta.map(function (x) { return Math.floor(x + 1e-9); });
      var used = out.reduce(function (a, b) { return a + b; }, 0);
      var left = cfg.steps - used;
      var idxs = shares.map(function (_, i) { return i; });
      idxs.sort(function (a, b) {
        var ra = quanta[a] - out[a], rb = quanta[b] - out[b];
        if (a === pinned) ra += 2;               /* the dragged channel wins ties */
        if (b === pinned) rb += 2;
        return rb - ra || a - b;
      });
      var k = 0, n = idxs.length;
      while (left > 0 && k < n * 4) {
        var i = idxs[k % n];
        /* first pass honors "a 0 channel stays 0"; later passes may
           force-place so the sum invariant always wins */
        if (shares[i] > 0 || i === pinned || k >= n) { out[i]++; left--; }
        k++;
      }
      return out.map(function (x) { return x * q; });
    }
    function normShares(v) {
      var n = cfg.channels.length, arr;
      if (Array.isArray(v)) {
        arr = cfg.channels.map(function (_, i) { return Math.max(0, num(v[i], 0)); });
      } else if (v && typeof v === 'object') {
        arr = cfg.channels.map(function (ch) { return Math.max(0, num(v[ch], 0)); });
      } else arr = [];
      var sum = arr.reduce(function (a, b) { return a + b; }, 0);
      if (!arr.length || sum <= 0) {
        arr = cfg.channels.map(function () { return 100 / n; });
      } else {
        arr = arr.map(function (s) { return (s * 100) / sum; });
      }
      if (cfg.steps >= 2) arr = quantizeShares(arr, -1);
      return arr;
    }

    function clampPasses(v) { return clamp(Math.round(num(v, 0)), 0, 3); }

    var value;
    if (kind === 'words') value = typeof opts.value === 'string' ? opts.value : '';
    else if (kind === 'pad') value = normPad(opts.value);
    else if (kind === 'range' || kind === 'filter') value = normSpan(opts.value);
    else if (kind === 'curve') value = normSeries(opts.value);
    else if (kind === 'select') value = normPick(typeof opts.value === 'number' ? opts.value : 0);
    else if (kind === 'order') value = normPerm(opts.value);
    else if (kind === 'mixer') value = normShares(opts.value);
    else if (kind === 'fork') value = clamp100(typeof opts.value === 'number' ? opts.value : 50);
    else if (kind === 'revise') value = clampPasses(typeof opts.value === 'number' ? opts.value : 2);
    /* COUNT defaults small and lives on its own 0–10 scale — "pick how
       many" spawning at 50 read wrong (gate-2 #485), and the face's
       "/ 10" ceiling plus the jack's ×10 story demand the clamp */
    else if (kind === 'count') value = Math.round(clamp(typeof opts.value === 'number' ? opts.value : 3, 0, 10));
    else value = snapValue(typeof opts.value === 'number' ? opts.value : 50, cfg.steps);
    if (kind === 'switch') value = value >= 50 ? 100 : 0;

    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;
    var onConfig = typeof opts.onConfig === 'function' ? opts.onConfig : null;
    /* WHAT IT SAYS NOW (SC4.1): the host supplies the live compiled
       sentence; null means "OFF — says nothing at this value" */
    var saysNow = typeof opts.saysNow === 'function' ? opts.saysNow : null;

    /* --- root scaffold --- */
    var root = make('div', 'mui-control mui-' + kind + ' sz-md');
    root.style.setProperty('--accent', cfg.accent);
    root.setAttribute('data-kind', kind);
    /* class marks (grammar R8): process parts wear the HOLLOW ring —
       round like a control, but they act at run time rather than
       holding a value. Hosts add it for presets (e.g. STAGE). */
    if (kind === 'fork' || kind === 'revise') root.classList.add('is-process');

    /* head row: identity dot + label share one flex line, so their
       centers align structurally at every size */
    var head = make('div', 'mui-head', root);
    var ringBtn = make('button', 'mui-ring-btn', head);
    ringBtn.type = 'button';
    ringBtn.setAttribute('aria-label', 'Color of ' + cfg.label);
    var labelEl = make('div', 'mui-label', head);
    labelEl.textContent = cfg.label;

    var body = make('div', 'mui-body', root);

    var hoverchip = make('span', 'mui-hoverchip', root);

    var chrome = make('div', 'mui-chrome', root);
    var cfgBtn = make('button', 'mui-chrome-btn mui-cfg-btn', chrome);
    cfgBtn.type = 'button';
    cfgBtn.setAttribute('aria-label', 'Configure ' + cfg.label);
    /* "sliders" glyph: two lines with offset knobs */
    /* drawn light and small so it reads as the same visual weight as
       the x beside it; the 19px button box is the hit target */
    cfgBtn.innerHTML =
      '<svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">' +
      '<path d="M2.2 4.6h9.6M2.2 9.4h9.6" stroke="currentColor" stroke-width="1.1"' +
      ' stroke-linecap="round" fill="none"/>' +
      '<circle cx="9.1" cy="4.6" r="1.7" fill="var(--mui-panel)"' +
      ' stroke="currentColor" stroke-width="1.1"/>' +
      '<circle cx="4.9" cy="9.4" r="1.7" fill="var(--mui-panel)"' +
      ' stroke="currentColor" stroke-width="1.1"/></svg>';

    /* × only when the host owns removal semantics */
    var onRemove = typeof opts.onRemove === 'function' ? opts.onRemove : null;
    if (onRemove) {
      var removeBtn = make('button', 'mui-chrome-btn mui-remove-btn', chrome);
      removeBtn.type = 'button';
      removeBtn.textContent = '×';
      removeBtn.setAttribute('aria-label', 'Remove ' + cfg.label);
      removeBtn.addEventListener('click', function (e) {
        e.stopPropagation();
        onRemove(api);
      });
    }

    /* output jacks. Most kinds carry one; the pad carries TWO named
       scalar jacks (the multi-jack primitive): Y at the well's top-right,
       X at vertical center. The mixer carries ONE PER CHANNEL — the
       variable multi-jack (count follows config). SELECT carries NONE:
       a nominal choice has no honest scalar, and total coercion would
       force that lie — jackless by design. */
    var node = null, nodes = {}, inputs = {};
    if (kind === 'pad') {
      var nodeY = buildNode(cfg.axes.y.label, false, 'scalar');
      nodeY.classList.add('mui-node--pady');
      var nodeX = buildNode(cfg.axes.x.label, false, 'scalar');
      nodeX.classList.add('mui-node--padx');
      root.appendChild(nodeY);
      root.appendChild(nodeX);
      /* jack identity without hover (05 §PAD): micro Y / X letters
         beside the two out-dots */
      var padJackY = make('span', 'mui-pad-jacklbl mui-pad-jacklbl--y', root);
      padJackY.textContent = 'Y';
      var padJackX = make('span', 'mui-pad-jacklbl mui-pad-jacklbl--x', root);
      padJackX.textContent = 'X';
      nodes = { x: nodeX, y: nodeY };
      node = nodeX;
    } else if (kind === 'mixer') {
      rebuildMixerJacks();
    } else if (kind !== 'select') {
      node = buildNode(cfg.label, false, 'scalar');
      root.appendChild(node);
      nodes = { out: node };
    }
    function rebuildMixerJacks() {
      for (var k in nodes) {
        if (nodes[k].parentNode) nodes[k].parentNode.removeChild(nodes[k]);
      }
      nodes = {};
      var n = cfg.channels.length;
      cfg.channels.forEach(function (ch, i) {
        var nd = buildNode(ch, false, 'scalar');
        nd.classList.add('mui-node--mix');
        nd.style.top = (((i + 1) / (n + 1)) * 100).toFixed(2) + '%';
        /* jack↔fader pairing (05 §MIXER defect 1): hovering a jack
           highlights its fader; the fader hover blooms the jack */
        nd.addEventListener('pointerenter', function () {
          if (parts.mTracks && parts.mTracks[i]) parts.mTracks[i].classList.add('is-paired');
        });
        nd.addEventListener('pointerleave', function () {
          if (parts.mTracks && parts.mTracks[i]) parts.mTracks[i].classList.remove('is-paired');
        });
        root.appendChild(nd);
        nodes[ch] = nd;
      });
      node = nodes[cfg.channels[0]];
      if (api) { api.node = node; api.nodes = nodes; }
    }

    /* --- per-kind internals --- */
    var parts = {};   // kind-specific element refs

    function configSnapshot() {
      var c = { label: cfg.label, accent: cfg.accent, steps: cfg.steps, desc: cfg.desc };
      if (kind === 'range' || kind === 'filter' ||
          kind === 'dial' || kind === 'slider') {
        c.stops = cfg.stops ? cfg.stops.slice() : null;
      }
      if (kind === 'slider') c.ends = { low: cfg.ends.low, high: cfg.ends.high };
      if (kind === 'select') {
        c.options = cfg.options.slice();
        c.frames = cfg.frames.slice();
      }
      if (kind === 'order') c.items = cfg.items.slice();
      if (kind === 'mixer') c.channels = cfg.channels.slice();
      if (kind === 'pad') {
        c.axes = {
          x: { label: cfg.axes.x.label, low: cfg.axes.x.low, high: cfg.axes.x.high, steps: cfg.axes.x.steps },
          y: { label: cfg.axes.y.label, low: cfg.axes.y.low, high: cfg.axes.y.high, steps: cfg.axes.y.steps }
        };
      }
      if (kind === 'curve') {
        c.timebase = cfg.timebase;
        c.xdetents = cfg.xdetents ? cfg.xdetents.slice() : null;
      }
      if (kind === 'fork') {
        c.lookAt = cfg.lookAt;
        c.paths = cfg.paths.map(function (p) { return { name: p.name, prose: p.prose }; });
      }
      if (kind === 'revise') {
        c.metric = cfg.metric;
        c.strict = cfg.strict;
        c.redo = cfg.redo;
      }
      if (fidelityOn) c.fidelity = cfg.fidelity;
      return c;
    }
    function meta() { return { kind: kind, label: cfg.label, steps: cfg.steps, accent: cfg.accent }; }
    function emitChange() { if (onChange) onChange(getValue(), meta()); }
    function emitConfig() { if (onConfig) onConfig(configSnapshot()); }
    /* Apply an authoring snapshot to another control of the same kind. This
       is intentionally a control-level operation: workbench package duplicate
       uses it to preserve title, description, accent, steps, named stops,
       axes, and process configuration without reaching into private cfg. */
    function applyConfig(next) {
      if (!next) return;
      Object.keys(next).forEach(function (key) {
        cfg[key] = next[key] && typeof next[key] === 'object'
          ? JSON.parse(JSON.stringify(next[key])) : next[key];
      });
      root.style.setProperty('--accent', cfg.accent);
      labelEl.textContent = cfg.label;
      if (kind === 'pad') {
        if (nodes.x) nodes.x.setLabel(cfg.axes.x.label);
        if (nodes.y) nodes.y.setLabel(cfg.axes.y.label);
        renderPadSnaps(); renderPadEnds();
      } else if (kind !== 'mixer') {
        for (var jack in nodes) nodes[jack].setLabel(cfg.label);
      }
      if (kind === 'dial') renderDialTicks();
      if (kind === 'slider' || kind === 'range') renderSliderDetents();
      if (kind === 'slider') renderSliderEnds();
      setValue(value, false);
      updateChipText(); render(); emitConfig();
    }
    function getValue() {
      if (kind === 'pad') return { x: value.x, y: value.y };
      if (kind === 'range' || kind === 'filter') return { lo: value.lo, hi: value.hi, mode: value.mode };
      if (kind === 'curve') return value.map(function (p) { return { t: p.t, v: p.v }; });
      if (kind === 'order') return value.slice();
      if (kind === 'mixer') {
        var map = {};
        cfg.channels.forEach(function (ch, i) { map[ch] = value[i]; });
        return map;
      }
      return value;
    }

    /* ============ DIAL ============ */
    if (kind === 'dial') {
      var svg = makeSvg('svg', { viewBox: '0 0 110 110', role: 'slider', tabindex: '0' }, body);
      svg.setAttribute('aria-label', cfg.label);
      makeSvg('path', {
        'class': 'arc-track',
        d: arcPath(DIAL.C, DIAL.C, DIAL.ARC_R, DIAL.A0, DIAL.A0 + DIAL.SWEEP)
      }, svg);
      parts.ticks = makeSvg('g', { 'class': 'ticks' }, svg);
      /* value arc: d recomputed per render (exact, renderer-independent —
         no dasharray/pathLength tricks); hidden entirely at 0% so round
         caps never draw a phantom dot */
      parts.arc = makeSvg('path', { 'class': 'arc-value', display: 'none' }, svg);
      makeSvg('circle', { 'class': 'core', cx: DIAL.C, cy: DIAL.C, r: DIAL.CORE_R }, svg);
      parts.needleG = makeSvg('g', null, svg);
      makeSvg('line', {
        'class': 'needle',
        x1: DIAL.C + 7, y1: DIAL.C, x2: DIAL.C + DIAL.CORE_R - 4, y2: DIAL.C
      }, parts.needleG);
      parts.svg = svg;
      parts.readout = make('div', 'mui-readout', root);

      /* drag: vertical, 100% per 150px; shift = fine */
      var dragStartY = 0, dragStartV = 0;
      svg.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        svg.setPointerCapture(e.pointerId);
        dragStartY = e.clientY;
        dragStartV = value;
        root.classList.add('is-dragging');
      });
      svg.addEventListener('pointermove', function (e) {
        if (!root.classList.contains('is-dragging')) return;
        var scale = e.shiftKey ? 750 : 150;   /* px for full range */
        setValue(dragStartV + (dragStartY - e.clientY) * (100 / scale), true);
      });
      function endDrag() { root.classList.remove('is-dragging'); }
      svg.addEventListener('pointerup', endDrag);
      svg.addEventListener('pointercancel', endDrag);
      attachKeys(svg);
    }

    /* ============ SLIDER ============ */
    if (kind === 'slider') {
      var track = make('div', 'mui-slider-track', body);
      track.setAttribute('role', 'slider');
      track.setAttribute('tabindex', '0');
      track.setAttribute('aria-label', cfg.label);
      make('div', 'mui-slider-fill', track);
      parts.detentLayer = make('div', null, track);
      parts.handle = make('div', 'mui-slider-handle', track);
      parts.track = track;
      /* end names at both ends of the track (9px micro — tertiary) */
      parts.endLo = make('span', 'mui-slider-end mui-slider-end--lo', track);
      parts.endHi = make('span', 'mui-slider-end mui-slider-end--hi', track);
      parts.readout = make('div', 'mui-readout', body);

      function valueFromEvent(e) {
        var r = track.getBoundingClientRect();
        var hd = parts.handle.offsetWidth || 24;
        var usable = r.width - 8 - hd;
        if (usable <= 0) return value;
        return ((e.clientX - r.left - 4 - hd / 2) / usable) * 100;
      }
      track.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        track.setPointerCapture(e.pointerId);
        root.classList.add('is-dragging');
        setValue(valueFromEvent(e), true);
      });
      track.addEventListener('pointermove', function (e) {
        if (!root.classList.contains('is-dragging')) return;
        setValue(valueFromEvent(e), true);
      });
      function endSDrag() { root.classList.remove('is-dragging'); }
      track.addEventListener('pointerup', endSDrag);
      track.addEventListener('pointercancel', endSDrag);
      attachKeys(track);
    }

    /* ============ SWITCH ============ */
    if (kind === 'switch') {
      var pill = make('div', 'mui-switch-pill', body);
      pill.setAttribute('role', 'switch');
      pill.setAttribute('tabindex', '0');
      pill.setAttribute('aria-label', cfg.label);
      parts.pill = pill;
      pill.addEventListener('click', function () { setValue(value >= 50 ? 0 : 100, true); });
      pill.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault();
          setValue(value >= 50 ? 0 : 100, true);
        }
      });
    }

    /* ============ COUNT ============ */
    if (kind === 'count') {
      var cpill = make('div', 'mui-count-pill', body);
      var minus = make('button', 'mui-count-btn', cpill);
      minus.type = 'button'; minus.textContent = '−';
      minus.setAttribute('aria-label', 'decrease');
      parts.countVal = make('div', 'mui-count-val', cpill);
      var plus = make('button', 'mui-count-btn', cpill);
      plus.type = 'button'; plus.textContent = '+';
      plus.setAttribute('aria-label', 'increase');
      minus.addEventListener('click', function () { setValue(value - 1, true); });
      plus.addEventListener('click', function () { setValue(value + 1, true); });
    }

    /* ============ WORDS ============ */
    if (kind === 'words') {
      var input = make('input', 'mui-field-input mui-words-input', body);
      input.type = 'text';
      /* the empty face teaches (SC3): the ghost placeholder IS the
         would-say hint */
      input.placeholder = 'Type words to add a sentence.';
      input.value = value;
      input.setAttribute('aria-label', cfg.label);
      parts.input = input;
      input.addEventListener('input', function () {
        value = input.value;
        updateChipText();
        emitChange();
      });
    }

    /* ============ PAD ============ */
    if (kind === 'pad') {
      var pwell = make('div', 'mui-pad-well', body);
      pwell.setAttribute('role', 'group');
      pwell.setAttribute('tabindex', '0');
      pwell.setAttribute('aria-label', cfg.label);
      parts.snaps = make('div', 'mui-pad-snaps', pwell);
      parts.chv = make('div', 'mui-pad-ch mui-pad-ch--v', pwell);
      parts.chh = make('div', 'mui-pad-ch mui-pad-ch--h', pwell);
      parts.trail = make('div', 'mui-pad-trail', pwell);
      parts.padHandle = make('div', 'mui-pad-handle', pwell);
      /* axis-end names: X ends on the bottom edge, Y ends on the left
         edge — horizontal text, never rotated */
      parts.endXlo = make('span', 'mui-pad-end mui-pad-end--xlo', pwell);
      parts.endXhi = make('span', 'mui-pad-end mui-pad-end--xhi', pwell);
      parts.endYlo = make('span', 'mui-pad-end mui-pad-end--ylo', pwell);
      parts.endYhi = make('span', 'mui-pad-end mui-pad-end--yhi', pwell);
      parts.well = pwell;
      parts.readout = make('div', 'mui-readout', root);

      var PAD_INSET = 14;
      function padFromEvent(e) {
        var r = pwell.getBoundingClientRect();
        var ux = (e.clientX - r.left - PAD_INSET) / Math.max(1, r.width - 2 * PAD_INSET);
        var uy = (e.clientY - r.top - PAD_INSET) / Math.max(1, r.height - 2 * PAD_INSET);
        return { x: clamp(ux, 0, 1) * 100, y: (1 - clamp(uy, 0, 1)) * 100 };
      }
      /* drag trail: 3–4 ghost dots, gone in --mui-t-move; ephemeral,
         cut entirely under reduced motion */
      var lastGhost = 0;
      function spawnGhost() {
        if (reducedMotion.matches) return;
        var now = Date.now();
        if (now - lastGhost < 45) return;
        lastGhost = now;
        if (parts.trail.childElementCount >= 4) {
          parts.trail.removeChild(parts.trail.firstChild);
        }
        var g = make('span', 'mui-pad-ghost', parts.trail);
        g.style.left = 'calc(' + PAD_INSET + 'px + (100% - ' + (2 * PAD_INSET) + 'px) * ' + (value.x / 100) + ')';
        g.style.top = 'calc(' + PAD_INSET + 'px + (100% - ' + (2 * PAD_INSET) + 'px) * ' + (1 - value.y / 100) + ')';
        setTimeout(function () { if (g.parentNode) g.parentNode.removeChild(g); }, 260);
      }
      pwell.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        pwell.setPointerCapture(e.pointerId);
        root.classList.add('is-dragging');
        setValue(padFromEvent(e), true);
      });
      pwell.addEventListener('pointermove', function (e) {
        if (!root.classList.contains('is-dragging')) return;
        spawnGhost();
        setValue(padFromEvent(e), true);
      });
      function endPadDrag() { root.classList.remove('is-dragging'); }
      pwell.addEventListener('pointerup', endPadDrag);
      pwell.addEventListener('pointercancel', endPadDrag);
      pwell.addEventListener('keydown', function (e) {
        var ix = cfg.axes.x.steps >= 2 ? 100 / cfg.axes.x.steps : (e.shiftKey ? 10 : 1);
        var iy = cfg.axes.y.steps >= 2 ? 100 / cfg.axes.y.steps : (e.shiftKey ? 10 : 1);
        var d = null;
        if (e.key === 'ArrowRight') d = { x: value.x + ix, y: value.y };
        if (e.key === 'ArrowLeft')  d = { x: value.x - ix, y: value.y };
        if (e.key === 'ArrowUp')    d = { x: value.x, y: value.y + iy };
        if (e.key === 'ArrowDown')  d = { x: value.x, y: value.y - iy };
        if (d) { e.preventDefault(); setValue(d, true); }
      });
    }

    /* ============ RANGE ============ */
    if (kind === 'range') {
      var rtrack = make('div', 'mui-slider-track mui-range-track', body);
      rtrack.setAttribute('role', 'group');
      rtrack.setAttribute('aria-label', cfg.label);
      make('div', 'mui-range-band', rtrack);
      parts.detentLayer = make('div', null, rtrack);
      parts.hLo = make('div', 'mui-slider-handle mui-range-handle mui-range-handle--lo', rtrack);
      parts.hHi = make('div', 'mui-slider-handle mui-range-handle mui-range-handle--hi', rtrack);
      [parts.hLo, parts.hHi].forEach(function (handle, i) {
        handle.setAttribute('role', 'slider');
        handle.setAttribute('tabindex', '0');
        handle.setAttribute('aria-label', cfg.label + (i ? ' high edge' : ' low edge'));
      });
      parts.track = rtrack;
      parts.readout = make('div', 'mui-readout', body);

      function rvalFromEvent(e) {
        var r = rtrack.getBoundingClientRect();
        var hd = parts.hLo.offsetWidth || 24;
        var usable = r.width - 8 - hd;
        if (usable <= 0) return 0;
        return clamp100(((e.clientX - r.left - 4 - hd / 2) / usable) * 100);
      }
      function rtol() {
        var r = rtrack.getBoundingClientRect();
        var hd = parts.hLo.offsetWidth || 24;
        var usable = Math.max(1, r.width - 8 - hd);
        return ((hd / 2 + 4) / usable) * 100;
      }
      var rDrag = null;   /* 'lo' | 'hi' | {band offset,width} */
      rtrack.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        rtrack.setPointerCapture(e.pointerId);
        root.classList.add('is-dragging');
        var v = rvalFromEvent(e), tol = rtol();
        var dLo = Math.abs(v - value.lo), dHi = Math.abs(v - value.hi);
        if (Math.min(dLo, dHi) <= tol) {
          rDrag = dLo === dHi ? (v < value.lo ? 'lo' : 'hi') : (dLo < dHi ? 'lo' : 'hi');
        } else if (v > value.lo && v < value.hi) {
          /* band-drag: slide the whole window, width preserved */
          rDrag = { band: true, offset: v - value.lo, width: value.hi - value.lo };
        } else {
          rDrag = dLo <= dHi ? 'lo' : 'hi';
          applyRangeDrag(v);
        }
        (rDrag === 'lo' ? parts.hLo : rDrag === 'hi' ? parts.hHi : null)?.focus();
      });
      function applyRangeDrag(v) {
        if (rDrag === 'lo') {
          setValue({ lo: Math.min(snapValue(v, cfg.steps), value.hi), hi: value.hi }, true);
        } else if (rDrag === 'hi') {
          setValue({ lo: value.lo, hi: Math.max(snapValue(v, cfg.steps), value.lo) }, true);
        } else if (rDrag && rDrag.band) {
          var nl = snapValue(clamp(v - rDrag.offset, 0, 100 - rDrag.width), cfg.steps);
          nl = Math.min(nl, 100 - rDrag.width);
          setValue({ lo: nl, hi: nl + rDrag.width }, true);
        }
      }
      rtrack.addEventListener('pointermove', function (e) {
        if (root.classList.contains('is-dragging') && rDrag) {
          applyRangeDrag(rvalFromEvent(e));
          return;
        }
        /* cursor semantics: handles resize, band grabs */
        var v = rvalFromEvent(e), tol = rtol();
        var onHandle = Math.abs(v - value.lo) <= tol || Math.abs(v - value.hi) <= tol;
        rtrack.style.cursor = onHandle ? 'ew-resize'
          : (v > value.lo && v < value.hi ? 'grab' : 'ew-resize');
      });
      function endRDrag() { root.classList.remove('is-dragging'); rDrag = null; }
      rtrack.addEventListener('pointerup', endRDrag);
      rtrack.addEventListener('pointercancel', endRDrag);
      function rangeKey(edge, e) {
        var inc = cfg.steps >= 2 ? 100 / cfg.steps : (e.shiftKey ? 1 : 5);
        var next = value[edge];
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next += inc;
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next -= inc;
        else if (e.key === 'Home') next = edge === 'lo' ? 0 : value.lo;
        else if (e.key === 'End') next = edge === 'hi' ? 100 : value.hi;
        else return;
        e.preventDefault(); e.stopPropagation();
        next = snapValue(next, cfg.steps);
        setValue(edge === 'lo'
          ? { lo: Math.min(next, value.hi), hi: value.hi }
          : { lo: value.lo, hi: Math.max(next, value.lo) }, true);
      }
      parts.hLo.addEventListener('keydown', function (e) { rangeKey('lo', e); });
      parts.hHi.addEventListener('keydown', function (e) { rangeKey('hi', e); });
    }

    /* ============ FILTER ============ */
    if (kind === 'filter') {
      var fwell = make('div', 'mui-filter-well', body);
      fwell.setAttribute('role', 'group');
      fwell.setAttribute('aria-label', cfg.label);
      var fsvg = makeSvg('svg', { 'class': 'mui-filter-svg' }, fwell);
      parts.fWash = makeSvg('path', { 'class': 'wash' }, fsvg);
      parts.fDets = makeSvg('g', { 'class': 'dets' }, fsvg);
      parts.fCurve = makeSvg('path', { 'class': 'curve' }, fsvg);
      parts.fLoHandle = make('button', 'mui-filter-edge mui-filter-edge--lo', fwell);
      parts.fHiHandle = make('button', 'mui-filter-edge mui-filter-edge--hi', fwell);
      parts.fLoHandle.type = parts.fHiHandle.type = 'button';
      parts.fLoHandle.setAttribute('role', 'slider');
      parts.fHiHandle.setAttribute('role', 'slider');
      parts.fLoHandle.setAttribute('aria-label', cfg.label + ' lower cutoff');
      parts.fHiHandle.setAttribute('aria-label', cfg.label + ' upper cutoff');
      parts.fSvg = fsvg;
      parts.fWell = fwell;
      var ffoot = make('div', 'mui-filter-foot', root);
      parts.modeBtn = make('button', 'mui-filter-mode', ffoot);
      parts.modeBtn.type = 'button';
      parts.modeBtn.setAttribute('aria-label', 'Mode of ' + cfg.label);
      parts.readout = make('div', 'mui-readout', ffoot);

      var FW = 0, FH = 0;
      function fsize() {
        var r = fwell.getBoundingClientRect();
        FW = Math.max(1, r.width); FH = Math.max(1, r.height);
        fsvg.setAttribute('viewBox', '0 0 ' + FW + ' ' + FH);
        renderFilter();
      }
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(fsize).observe(fwell);
      }
      requestAnimationFrame(fsize);

      function fx(v) { return (FW * v) / 100; }
      function rollDown(x0, top, bot, R) {
        return ' L ' + (x0 - R / 2).toFixed(1) + ' ' + top +
               ' C ' + x0.toFixed(1) + ' ' + top + ' ' + x0.toFixed(1) + ' ' + bot +
               ' ' + (x0 + R / 2).toFixed(1) + ' ' + bot;
      }
      function rollUp(x0, top, bot, R) {
        return ' L ' + (x0 - R / 2).toFixed(1) + ' ' + bot +
               ' C ' + x0.toFixed(1) + ' ' + bot + ' ' + x0.toFixed(1) + ' ' + top +
               ' ' + (x0 + R / 2).toFixed(1) + ' ' + top;
      }
      function renderFilter() {
        if (!FW || !parts.fCurve) return;
        var top = Math.min(10, FH * 0.18), bot = FH - Math.min(7, FH * 0.14);
        var R = Math.min(26, FW * 0.18);
        var d = 'M -4 ';
        if (value.mode === 'no-more-than') {
          d += top + rollDown(fx(value.hi), top, bot, R) + ' L ' + (FW + 4) + ' ' + bot;
        } else if (value.mode === 'at-least') {
          d += bot + rollUp(fx(value.lo), top, bot, R) + ' L ' + (FW + 4) + ' ' + top;
        } else {
          d += bot + rollUp(fx(value.lo), top, bot, R) +
               rollDown(fx(value.hi), top, bot, R) + ' L ' + (FW + 4) + ' ' + bot;
        }
        parts.fCurve.setAttribute('d', d);
        parts.fWash.setAttribute('d',
          d + ' L ' + (FW + 4) + ' ' + (FH + 4) + ' L -4 ' + (FH + 4) + ' Z');
        parts.fLoHandle.style.left = value.lo + '%';
        parts.fHiHandle.style.left = value.hi + '%';
        /* stepped: detent dots along the foot of the face */
        while (parts.fDets.firstChild) parts.fDets.removeChild(parts.fDets.firstChild);
        if (cfg.steps >= 2) {
          for (var i = 0; i <= cfg.steps; i++) {
            makeSvg('circle', {
              'class': 'det',
              cx: (fx((100 * i) / cfg.steps) || 2).toFixed(1),
              cy: (FH - 5).toFixed(1), r: 2
            }, parts.fDets);
          }
        }
      }
      parts.renderFilter = renderFilter;

      function activeEdges() {
        return value.mode === 'no-more-than' ? ['hi']
             : value.mode === 'at-least' ? ['lo'] : ['lo', 'hi'];
      }
      function fvalFromEvent(e) {
        var r = fwell.getBoundingClientRect();
        return clamp100(((e.clientX - r.left) / Math.max(1, r.width)) * 100);
      }
      var fDrag = null;
      fwell.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        fwell.setPointerCapture(e.pointerId);
        root.classList.add('is-dragging');
        var v = fvalFromEvent(e);
        var tol = (16 / Math.max(1, fwell.getBoundingClientRect().width)) * 100;
        var edges = activeEdges(), best = null, bestD = Infinity;
        edges.forEach(function (ed) {
          var d = Math.abs(v - value[ed]);
          if (d < bestD) { bestD = d; best = ed; }
        });
        if (bestD <= tol) fDrag = best;
        else if (value.mode === 'between' && v > value.lo && v < value.hi) {
          /* plateau slide: the whole window, width preserved */
          fDrag = { band: true, offset: v - value.lo, width: value.hi - value.lo };
        } else {
          fDrag = best;
          applyFilterDrag(v);
        }
        (fDrag === 'lo' ? parts.fLoHandle : fDrag === 'hi' ? parts.fHiHandle : null)?.focus();
      });
      function applyFilterDrag(v) {
        if (fDrag === 'hi') {
          setValue({ lo: value.lo, hi: Math.max(snapValue(v, cfg.steps), value.mode === 'between' ? value.lo : 0), mode: value.mode }, true);
        } else if (fDrag === 'lo') {
          setValue({ lo: Math.min(snapValue(v, cfg.steps), value.mode === 'between' ? value.hi : 100), hi: value.hi, mode: value.mode }, true);
        } else if (fDrag && fDrag.band) {
          var nl = snapValue(clamp(v - fDrag.offset, 0, 100 - fDrag.width), cfg.steps);
          nl = Math.min(nl, 100 - fDrag.width);
          setValue({ lo: nl, hi: nl + fDrag.width, mode: value.mode }, true);
        }
      }
      fwell.addEventListener('pointermove', function (e) {
        if (root.classList.contains('is-dragging') && fDrag != null) {
          applyFilterDrag(fvalFromEvent(e));
          return;
        }
        var v = fvalFromEvent(e);
        var tol = (16 / Math.max(1, fwell.getBoundingClientRect().width)) * 100;
        var near = activeEdges().some(function (ed) { return Math.abs(v - value[ed]) <= tol; });
        fwell.style.cursor = near ? 'ew-resize'
          : (value.mode === 'between' && v > value.lo && v < value.hi ? 'grab' : 'ew-resize');
      });
      function endFDrag() { root.classList.remove('is-dragging'); fDrag = null; }
      fwell.addEventListener('pointerup', endFDrag);
      fwell.addEventListener('pointercancel', endFDrag);

      function filterKey(edge, e) {
        var inc = cfg.steps >= 2 ? 100 / cfg.steps : (e.shiftKey ? 1 : 5);
        var next = value[edge];
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') next += inc;
        else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') next -= inc;
        else if (e.key === 'Home') next = edge === 'lo' ? 0 : value.lo;
        else if (e.key === 'End') next = edge === 'hi' ? 100 : value.hi;
        else return;
        e.preventDefault(); e.stopPropagation();
        next = snapValue(next, cfg.steps);
        setValue({
          lo: edge === 'lo' ? Math.min(next, value.hi) : value.lo,
          hi: edge === 'hi' ? Math.max(next, value.lo) : value.hi,
          mode: value.mode
        }, true);
      }
      parts.fLoHandle.addEventListener('keydown', function (e) { filterKey('lo', e); });
      parts.fHiHandle.addEventListener('keydown', function (e) { filterKey('hi', e); });

      /* mode chip cycles the three plain-word modes */
      parts.modeBtn.addEventListener('click', function () {
        var next = FILTER_MODES[(FILTER_MODES.indexOf(value.mode) + 1) % FILTER_MODES.length];
        var lo = value.lo, hi = value.hi;
        if (next === 'no-more-than') { hi = hi < 100 ? hi : (lo > 0 ? lo : 70); lo = 0; }
        if (next === 'at-least') { lo = lo > 0 ? lo : (hi < 100 ? hi : 30); hi = 100; }
        if (next === 'between') { if (lo === 0 && hi === 100) { lo = 30; hi = 70; } }
        setValue({ lo: lo, hi: hi, mode: next }, true);
      });
    }

    /* ============ CURVE ============ */
    if (kind === 'curve') {
      var cwell = make('div', 'mui-curve-well', body);
      cwell.setAttribute('role', 'group');
      cwell.setAttribute('aria-label', cfg.label);
      var csvg = makeSvg('svg', { 'class': 'mui-curve-svg' }, cwell);
      parts.cDets = makeSvg('g', { 'class': 'dets' }, csvg);
      parts.cPos = makeSvg('g', { 'class': 'pos' }, csvg);   /* POSITION hairline layer */
      parts.cLine = makeSvg('path', { 'class': 'line' }, csvg);
      parts.cPts = makeSvg('g', { 'class': 'pts' }, csvg);
      parts.cSvg = csvg;
      parts.cWell = cwell;
      /* the scrub affordance is spoken (05 §CURVE defect 4): empty-well
         hover cursor is ew-resize (CSS) + an honest hover cue */
      cwell.title = 'Drag to preview across the answer';
      /* foot row when fidelity is on (chip left, readout right); else the
         plain bottom-centered readout, unchanged */
      if (fidelityOn) {
        parts.foot = make('div', 'mui-foot', root);
        parts.fidChip = makeFootChip(FIDELITY, FIDELITY_WORDS, cfg.fidelity,
          function (v) { cfg.fidelity = v; emitConfig(); }, 'mui-fidelity-chip');
        parts.foot.appendChild(parts.fidChip);
        parts.readout = make('div', 'mui-readout', parts.foot);
      } else {
        parts.readout = make('div', 'mui-readout', root);
      }
      var onScrub = typeof opts.onScrub === 'function' ? opts.onScrub : null;

      /* the POSITION input jack — the FIRST input jack on any control (a
         new lib surface). Straddles the LEFT edge (input rail convention);
         when the workbench feeds a value in, the face draws it as a
         vertical accent hairline and the emission speaks the sampled v.
         Unwired ⇒ no hairline, behaves as today. GAIN stays deferred. */
      var cPosition = null;   /* the wired NOW position 0–100, or null */
      /* POSITION → NOW (ruling #6): renamed everywhere the user reads it;
         the workbench slot key stays 'position' (plumbing, not a face) */
      var posJack = buildNode('NOW — takes a number that moves the NOW marker', false, 'scalar', 'in');
      posJack.classList.add('mui-node--pos');
      /* idle state is visible, not dead-looking: hollow at .5 with a 9px
         NOW micro label until a wire fills it (05 §CURVE defect 2) */
      var nowLbl = make('span', 'mui-node-microlbl', posJack);
      nowLbl.textContent = 'NOW';
      root.appendChild(posJack);
      inputs.position = posJack;

      var CW = 0, CH = 0, CPX = 13, CPY = 11;
      function csize() {
        var r = cwell.getBoundingClientRect();
        CW = Math.max(1, r.width); CH = Math.max(1, r.height);
        csvg.setAttribute('viewBox', '0 0 ' + CW + ' ' + CH);
        renderCurve();
      }
      if (typeof ResizeObserver !== 'undefined') {
        new ResizeObserver(csize).observe(cwell);
      }
      requestAnimationFrame(csize);

      function cxOf(t) { return CPX + ((CW - 2 * CPX) * t) / 100; }
      function cyOf(v) { return CPY + (CH - 2 * CPY) * (1 - v / 100); }
      function ctFromX(px) { return clamp100(((px - CPX) / Math.max(1, CW - 2 * CPX)) * 100); }
      function cvFromY(py) { return clamp100((1 - (py - CPY) / Math.max(1, CH - 2 * CPY)) * 100); }

      /* renamable x-detent name. The creator's names spread evenly across
         the five fixed detents: 3 names → start / midway / end (the common
         3-stage curve — "exploring / organising / committing"); 2 → the
         ends; 5 → one per detent. Detents no name lands on keep the short
         default token (QTR / 3QTR / …); off-detent t speaks the percent. */
      function xdetMap() {
        if (!cfg.xdetents || !cfg.xdetents.length) return null;
        var L = cfg.xdetents.length, m = {};
        if (L === 1) { if (String(cfg.xdetents[0]).trim()) m[0] = cfg.xdetents[0]; return m; }
        for (var i = 0; i < L; i++) {
          var di = Math.round((i / (L - 1)) * 4);
          if (cfg.xdetents[i] && String(cfg.xdetents[i]).trim()) m[di] = cfg.xdetents[i];
        }
        return m;
      }
      function xDetName(t) {
        var m = xdetMap();
        for (var i = 0; i < CURVE_DETS.length; i++) {
          if (Math.abs(t - CURVE_DETS[i]) < 0.5) {
            if (m && m[i]) return String(m[i]).toUpperCase();
            return CURVE_DET_NAMES[i];
          }
        }
        return Math.round(t) + '%';
      }
      parts.xDetName = xDetName;
      /* sample the piecewise-linear series at t — the value the emission
         speaks when POSITION is wired ("what you see" at the hairline) */
      function sampleAt(t) {
        t = clamp100(t);
        var pts = value;
        if (t <= pts[0].t) return pts[0].v;
        for (var i = 1; i < pts.length; i++) {
          if (t <= pts[i].t) {
            var a = pts[i - 1], b = pts[i], span = b.t - a.t || 1;
            return a.v + (b.v - a.v) * ((t - a.t) / span);
          }
        }
        return pts[pts.length - 1].v;
      }
      parts.sampleAt = sampleAt;

      var cActive = -1;   /* dragged/hovered point index, for the readout */
      function renderCurve() {
        if (!CW || !parts.cLine) return;
        while (parts.cDets.firstChild) parts.cDets.removeChild(parts.cDets.firstChild);
        CURVE_DETS.forEach(function (t) {
          makeSvg('circle', { 'class': 'det', cx: cxOf(t).toFixed(1), cy: (CH - 6).toFixed(1), r: 1.9 }, parts.cDets);
        });
        var d = '';
        value.forEach(function (p, i) {
          d += (i ? ' L ' : 'M ') + cxOf(p.t).toFixed(1) + ' ' + cyOf(p.v).toFixed(1);
        });
        parts.cLine.setAttribute('d', d);
        while (parts.cPts.firstChild) parts.cPts.removeChild(parts.cPts.firstChild);
        value.forEach(function (p, i) {
          var point = makeSvg('circle', {
            'class': 'pt' + (i === cDragIdx ? ' is-active' : ''),
            cx: cxOf(p.t).toFixed(1), cy: cyOf(p.v).toFixed(1), r: 5.5,
            'data-i': i, tabindex: '0', role: 'slider',
            'aria-label': cfg.label + ' point ' + (i + 1) + ', ' + xDetName(p.t) + '. Use arrows for value; Control plus left or right for position.',
            'aria-valuemin': '0', 'aria-valuemax': '100',
            'aria-valuenow': Math.round(p.v),
            'aria-valuetext': xDetName(p.t) + ', value ' + Math.round(p.v) + ' percent'
          }, parts.cPts);
          point.addEventListener('focus', function () {
            cActive = i;
            parts.cPts.querySelectorAll('.pt').forEach(function (n, j) {
              n.classList.toggle('is-active', j === i);
            });
            if (parts.fitCurveReadout) parts.fitCurveReadout();
            updateChipText();
          });
          point.addEventListener('keydown', function (e) { curvePointKey(i, e); });
        });
        /* the wired POSITION: a vertical accent hairline + a dot where it
           crosses the curve (the sampled-now the emission reports) */
        while (parts.cPos.firstChild) parts.cPos.removeChild(parts.cPos.firstChild);
        if (cPosition != null) {
          var hx = cxOf(cPosition);
          makeSvg('line', {
            'class': 'pos-line', x1: hx.toFixed(1), y1: '2',
            x2: hx.toFixed(1), y2: (CH - 2).toFixed(1)
          }, parts.cPos);
          makeSvg('circle', {
            'class': 'pos-dot', cx: hx.toFixed(1),
            cy: cyOf(sampleAt(cPosition)).toFixed(1), r: 3.4
          }, parts.cPos);
        }
      }
      parts.renderCurve = renderCurve;

      function hitPoint(e) {
        var r = cwell.getBoundingClientRect();
        var px = e.clientX - r.left, py = e.clientY - r.top;
        var best = -1, bestD = 12;
        value.forEach(function (p, i) {
          var d = Math.hypot(px - cxOf(p.t), py - cyOf(p.v));
          if (d < bestD) { bestD = d; best = i; }
        });
        return best;
      }
      var cDragIdx = -1, cPending = null, cScrubbing = false;
      var cLastDown = { i: -1, at: 0 };
      function deletePoint(i) {
        /* endpoints refuse; 2 points is the floor */
        if (i <= 0 || i >= value.length - 1 || value.length <= 2) return false;
        var pts = value.filter(function (_, j) { return j !== i; });
        cActive = -1;
        setValue(pts, true);
        return true;
      }
      function curvePointKey(i, e) {
        var p = value[i];
        if (!p) return;
        if ((e.key === 'Delete' || e.key === 'Backspace') && i > 0 && i < value.length - 1) {
          e.preventDefault(); e.stopPropagation();
          deletePoint(i);
          requestAnimationFrame(function () {
            var points = parts.cPts.querySelectorAll('.pt');
            if (points[Math.max(0, i - 1)]) points[Math.max(0, i - 1)].focus();
          });
          return;
        }
        var pts = value.map(function (q) { return { t: q.t, v: q.v }; });
        var inc = cfg.steps >= 2 ? 100 / cfg.steps : (e.shiftKey ? 1 : 5);
        var changed = false;
        if (e.ctrlKey && (e.key === 'ArrowLeft' || e.key === 'ArrowRight') && i > 0 && i < pts.length - 1) {
          var tInc = e.shiftKey ? 1 : 5;
          pts[i].t = clamp(pts[i].t + (e.key === 'ArrowRight' ? tInc : -tInc), pts[i - 1].t + 1, pts[i + 1].t - 1);
          changed = pts[i].t !== p.t;
        } else if (e.key === 'ArrowUp' || e.key === 'ArrowRight') {
          pts[i].v = snapValue(p.v + inc, cfg.steps); changed = pts[i].v !== p.v;
        } else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') {
          pts[i].v = snapValue(p.v - inc, cfg.steps); changed = pts[i].v !== p.v;
        } else if (e.key === 'Home') {
          pts[i].v = 0; changed = p.v !== 0;
        } else if (e.key === 'End') {
          pts[i].v = 100; changed = p.v !== 100;
        } else return;
        e.preventDefault(); e.stopPropagation();
        if (!changed) return;
        cActive = i;
        setValue(pts, true);
        requestAnimationFrame(function () {
          var points = parts.cPts.querySelectorAll('.pt');
          if (points[i]) points[i].focus();
        });
      }
      csvg.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        csvg.setPointerCapture(e.pointerId);
        var hit = hitPoint(e);
        /* double-press on a point deletes it (pointerdown-based: the
           native dblclick is suppressed by preventDefault) */
        var now = Date.now();
        if (hit >= 0 && hit === cLastDown.i && now - cLastDown.at < 380) {
          cLastDown = { i: -1, at: 0 };
          deletePoint(hit);
          return;
        }
        cLastDown = { i: hit, at: now };
        if (hit >= 0) {
          cDragIdx = hit; cActive = hit;
          root.classList.add('is-dragging');
          render();
        } else {
          /* empty face: click = add point; horizontal drag = scrub
             (reported via onScrub; the board owns "now") */
          cPending = { x: e.clientX, y: e.clientY };
          cScrubbing = false;
        }
      });
      csvg.addEventListener('pointermove', function (e) {
        var r = cwell.getBoundingClientRect();
        if (cDragIdx >= 0) {
          var pts = value.map(function (p) { return { t: p.t, v: p.v }; });
          var p = pts[cDragIdx];
          p.v = snapValue(cvFromY(e.clientY - r.top), cfg.steps);
          if (cDragIdx > 0 && cDragIdx < pts.length - 1) {  /* endpoints: y-only */
            var raw = ctFromX(e.clientX - r.left);
            var prev = pts[cDragIdx - 1].t, next = pts[cDragIdx + 1].t;
            if (e.shiftKey) {
              p.t = clamp(raw, prev + 1, next - 1);
            } else {
              /* snap to the nearest speakable detent; refuse a detent a
                 neighbor already holds */
              var det = CURVE_DETS.reduce(function (a, b) {
                return Math.abs(b - raw) < Math.abs(a - raw) ? b : a;
              });
              if (det > prev && det < next) p.t = det;
            }
          }
          setValue(pts, true);
          cActive = cDragIdx;
          return;
        }
        if (cPending) {
          if (Math.abs(e.clientX - cPending.x) > 5 || Math.abs(e.clientY - cPending.y) > 5) {
            cScrubbing = true;
          }
          if (cScrubbing && onScrub) onScrub(ctFromX(e.clientX - r.left));
          return;
        }
        /* hover: feed the readout the nearest point */
        var h = hitPoint(e);
        if (h !== cActive) { cActive = h; render(); }
      });
      function endCDrag(e) {
        if (cPending && !cScrubbing && value.length < 5) {
          var r = cwell.getBoundingClientRect();
          var raw = ctFromX(e.clientX - r.left);
          var t = e.shiftKey ? raw : CURVE_DETS.reduce(function (a, b) {
            return Math.abs(b - raw) < Math.abs(a - raw) ? b : a;
          });
          var taken = value.some(function (p) { return Math.abs(p.t - t) < 1; });
          if (!taken) {
            var pts = value.map(function (p) { return { t: p.t, v: p.v }; });
            pts.push({ t: t, v: snapValue(cvFromY(e.clientY - r.top), cfg.steps) });
            setValue(pts, true);
          }
        }
        if (cScrubbing && onScrub) onScrub(null);
        cPending = null; cScrubbing = false;
        if (cDragIdx >= 0) { cDragIdx = -1; root.classList.remove('is-dragging'); render(); }
      }
      csvg.addEventListener('pointerup', endCDrag);
      csvg.addEventListener('pointercancel', function () {
        cPending = null; cScrubbing = false;
        if (cDragIdx >= 0) { cDragIdx = -1; root.classList.remove('is-dragging'); render(); }
      });
      csvg.addEventListener('dblclick', function (e) {
        deletePoint(hitPoint(e));
      });
      csvg.addEventListener('pointerleave', function () {
        if (cDragIdx < 0) { cActive = -1; render(); }
      });
      parts.curveActive = function () { return cActive; };

      /* setInput('position', v|null) — the workbench feeds the wired
         position; the lib owns the hairline + the jack's connected state */
      parts.setInput = function (name, v) {
        if (name !== 'position') return;
        cPosition = (v == null || isNaN(+v)) ? null : clamp100(+v);
        posJack.setConnected(cPosition != null);
        renderCurve();
        updateChipText();
      };
      parts.curvePosition = function () { return cPosition; };

      /* curve readout fit — the named-stops fallback applied to the
         active detent word: the renamable name while it fits its row,
         else the short default token + is-abbrev + the full on the chip */
      parts.fitCurveReadout = function () {
        /* R2.4 pill forms: NOW n/10 when the NOW jack drives the
           hairline; 3 PTS · PEAK 90 at rest; point detail on hover */
        if (cPosition != null && cActive < 0) {
          parts.readout.textContent =
            'NOW ' + Math.round(sampleAt(cPosition) / 10) + '/10';
          root.classList.remove('is-abbrev');
          return;
        }
        var base = value.length + ' PTS';
        var a = cActive;
        if (a < 0 || !value[a]) {
          var peak = Math.round(Math.max.apply(null,
            value.map(function (p) { return p.v; })));
          parts.readout.textContent = base + ' · PEAK ' + peak;
          root.classList.remove('is-abbrev');
          return;
        }
        var vv = Math.round(value[a].v);
        var full = base + ' · ' + xDetName(value[a].t) + ' ' + vv;
        var short = base + ' · ' + curveDetName(value[a].t) + ' ' + vv;
        var row = parts.readout.parentNode;
        var rowW = row ? row.clientWidth : 0;
        var abbrev = false;
        if (cfg.xdetents && rowW > 0 && measureW('mui-readout', full) > rowW) abbrev = true;
        parts.readout.textContent = abbrev ? short : full;
        root.classList.toggle('is-abbrev', abbrev);
      };
    }

    /* ============ SELECT ============ */
    if (kind === 'select') {
      parts.selHost = make('div', 'mui-select-host', body);
      function segmented() { return cfg.options.length <= 4; }
      function rebuildSelect() {
        parts.selHost.innerHTML = '';
        parts.selCells = [];
        var seg = segmented();
        var box = make('div', seg ? 'mui-select-seg' : 'mui-select-stack', parts.selHost);
        box.setAttribute('role', 'radiogroup');
        box.setAttribute('aria-label', cfg.label);
        box.setAttribute('tabindex', '0');
        parts.selBox = box;
        cfg.options.forEach(function (op, i) {
          var cell = make('button', seg ? 'mui-select-cell' : 'mui-select-row', box);
          cell.type = 'button';
          cell.tabIndex = -1;
          cell.textContent = op;
          cell.setAttribute('role', 'radio');
          cell.addEventListener('click', function () { setValue(i, true); });
          parts.selCells.push(cell);
        });
        /* pick on pointerdown + drag-across on the segmented capsule
           (pointer capture retargets the click, so the down does the
           picking; the cell click handler covers keyboard/AT) */
        if (seg) {
          function pickFromEvent(e) {
            var r = box.getBoundingClientRect();
            var i = clamp(Math.floor(((e.clientX - r.left) / Math.max(1, r.width)) * cfg.options.length), 0, cfg.options.length - 1);
            setValue(i, true);
          }
          box.addEventListener('pointerdown', function (e) {
            if (e.button !== 0) return;
            box.setPointerCapture(e.pointerId);
            root.classList.add('is-dragging');
            pickFromEvent(e);
          });
          box.addEventListener('pointermove', function (e) {
            if (!root.classList.contains('is-dragging')) return;
            pickFromEvent(e);
          });
          function endSel() { root.classList.remove('is-dragging'); }
          box.addEventListener('pointerup', endSel);
          box.addEventListener('pointercancel', endSel);
        }
        box.addEventListener('keydown', function (e) {
          var d = 0;
          if (e.key === 'ArrowRight' || e.key === 'ArrowDown') d = 1;
          if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') d = -1;
          if (d) {
            e.preventDefault();
            setValue((value + d + cfg.options.length) % cfg.options.length, true);
          }
        });
      }
      parts.rebuildSelect = rebuildSelect;
      rebuildSelect();
    }

    /* ============ ORDER ============ */
    if (kind === 'order') {
      var owell = make('div', 'mui-order-well', body);
      parts.oNums = make('div', 'mui-order-nums', owell);
      parts.oList = make('div', 'mui-order-list', owell);
      parts.oList.setAttribute('role', 'listbox');
      parts.oList.setAttribute('aria-label', cfg.label);
      parts.oList.setAttribute('tabindex', '0');
      parts.owell = owell;
      parts.readout = make('div', 'mui-readout', root);
      var oSel = 0;   /* keyboard selection (slot index) */

      function rebuildOrder() {
        parts.oNums.innerHTML = '';
        parts.oList.innerHTML = '';
        parts.oTokens = [];
        value.forEach(function (itemIdx, pos) {
          var num = make('span', 'mui-order-num', parts.oNums);
          num.textContent = String(pos + 1);
          var tok = make('div', 'mui-order-token', parts.oList);
          tok.textContent = cfg.items[itemIdx];
          tok.dataset.pos = pos;
          if (pos === 0) {
            tok.classList.add('is-top');
            tok.style.color = inkFor(cfg.accent);
          }
          if (pos === oSel) tok.classList.add('is-sel');
          parts.oTokens.push(tok);
        });
      }
      parts.rebuildOrder = rebuildOrder;

      /* the drag — this kind is the motion charter's showcase */
      var oDrag = null;
      parts.oList.addEventListener('pointerdown', function (e) {
        var tok = e.target.closest('.mui-order-token');
        if (!tok || e.button !== 0) return;
        e.preventDefault();
        parts.oList.setPointerCapture(e.pointerId);
        var startPos = +tok.dataset.pos;
        var pitch = parts.oTokens.length > 1
          ? parts.oTokens[1].offsetTop - parts.oTokens[0].offsetTop
          : tok.offsetHeight;
        oDrag = { tok: tok, startPos: startPos, target: startPos, y0: e.clientY, pitch: pitch };
        oSel = startPos;
        if (!reducedMotion.matches) tok.classList.add('is-lift');
        root.classList.add('is-dragging');
      });
      parts.oList.addEventListener('pointermove', function (e) {
        if (!oDrag) return;
        var dy = e.clientY - oDrag.y0;
        var n = value.length;
        var target = clamp(oDrag.startPos + Math.round(dy / Math.max(1, oDrag.pitch)), 0, n - 1);
        if (!reducedMotion.matches) {
          oDrag.tok.style.transform =
            'translateY(' + dy + 'px) scale(var(--mui-scale-lift))';
          if (target !== oDrag.target) {
            oDrag.target = target;
            /* siblings step aside — FLIP displacement on the move token */
            parts.oTokens.forEach(function (t, p) {
              if (p === oDrag.startPos) return;
              var shift = 0;
              if (p > oDrag.startPos && p <= target) shift = -oDrag.pitch;
              if (p < oDrag.startPos && p >= target) shift = oDrag.pitch;
              t.style.transform = shift ? 'translateY(' + shift + 'px)' : '';
            });
          }
        } else if (target !== oDrag.target) {
          /* reduced motion: reorder snaps, no lift transforms */
          oDrag.target = target;
        }
      });
      function endODrag(e) {
        if (!oDrag) return;
        var d = oDrag;
        oDrag = null;
        root.classList.remove('is-dragging');
        var next = value.slice();
        var moved = next.splice(d.startPos, 1)[0];
        next.splice(d.target, 0, moved);
        oSel = d.target;
        if (reducedMotion.matches || typeof d.tok.animate !== 'function') {
          d.tok.classList.remove('is-lift');
          d.tok.style.transform = '';
          parts.oTokens.forEach(function (t) { t.style.transform = ''; });
          setValue(next, true);
          return;
        }
        /* FLIP settle: measure, commit (rebuild), invert, play */
        var before = {};
        parts.oTokens.forEach(function (t, p) {
          before[value[p]] = t.getBoundingClientRect().top;
        });
        var liftedItem = value[d.startPos];
        setValue(next, true);                 /* rebuilds the rows */
        parts.oTokens.forEach(function (t, p) {
          var item = value[p];
          var dy = (before[item] != null) ? before[item] - t.getBoundingClientRect().top : 0;
          var lifted = item === liftedItem;
          if (!dy && !lifted) return;
          var anim = t.animate(
            [{ transform: 'translateY(' + dy + 'px)' + (lifted ? ' scale(var(--mui-scale-lift))' : '') },
             { transform: 'translateY(0)' + (lifted ? ' scale(1)' : '') }],
            { duration: 220, easing: 'cubic-bezier(.2,.75,.25,1.08)' });
          if (lifted) {
            t.classList.add('is-lift');
            anim.onfinish = function () { t.classList.remove('is-lift'); };
          }
        });
      }
      parts.oList.addEventListener('pointerup', endODrag);
      parts.oList.addEventListener('pointercancel', endODrag);

      /* keyboard: up/down selects, shift+up/down moves */
      parts.oList.addEventListener('keydown', function (e) {
        var d = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
        if (!d) return;
        e.preventDefault();
        var n = value.length;
        if (e.shiftKey) {
          var to = clamp(oSel + d, 0, n - 1);
          if (to === oSel) return;
          var next = value.slice();
          var mv = next.splice(oSel, 1)[0];
          next.splice(to, 0, mv);
          oSel = to;
          setValue(next, true);
        } else {
          oSel = clamp(oSel + d, 0, n - 1);
          render();
        }
      });

      /* displacement: normalized Kendall-tau distance from the authored
         order — 0 untouched, 100 fully reversed. The jack's scalar. */
      parts.displacement = function () {
        var n = value.length, disc = 0, total = (n * (n - 1)) / 2;
        for (var i = 0; i < n; i++) {
          for (var j = i + 1; j < n; j++) if (value[i] > value[j]) disc++;
        }
        return total ? (disc / total) * 100 : 0;
      };
    }

    /* ============ MIXER ============ */
    if (kind === 'mixer') {
      var mrow = make('div', 'mui-mixer-row', body);
      parts.mrow = mrow;
      parts.readout = make('div', 'mui-readout', root);
      var mSel = 0;   /* keyboard channel selection */

      function rebuildMixer() {
        mrow.innerHTML = '';
        parts.mTracks = [];
        cfg.channels.forEach(function (ch, i) {
          var col = make('div', 'mui-mixer-ch', mrow);
          var track = make('div', 'mui-mixer-track', col);
          track.dataset.ch = i;
          make('div', 'mui-mixer-fill', track);
          make('div', 'mui-mixer-handle', track);
          var lb = make('span', 'mui-mixer-lbl', col);
          lb.textContent = ch;
          /* fader hover blooms its own jack (the pairing, other way) */
          col.addEventListener('pointerenter', function () {
            var nd = nodes[ch];
            if (nd) nd.classList.add('is-cand');
          });
          col.addEventListener('pointerleave', function () {
            var nd = nodes[ch];
            if (nd) nd.classList.remove('is-cand');
          });
          parts.mTracks.push(track);
        });
        mrow.setAttribute('role', 'group');
        mrow.setAttribute('aria-label', cfg.label);
        mrow.setAttribute('tabindex', '0');
      }
      parts.rebuildMixer = rebuildMixer;
      rebuildMixer();

      /* drag one fader; the others yield proportionally, live */
      function rebalance(idx, v) {
        v = clamp100(v);
        var shares = value.slice();
        var restOld = 0;
        shares.forEach(function (s, j) { if (j !== idx) restOld += s; });
        var restNew = 100 - v;
        if (restOld <= 0.0001) {
          var others = shares.length - 1;
          shares = shares.map(function (_, j) { return j === idx ? v : restNew / others; });
        } else {
          shares = shares.map(function (s, j) {
            return j === idx ? v : (s * restNew) / restOld;
          });
        }
        if (cfg.steps >= 2) shares = quantizeShares(shares, idx);
        setValue(shares, true);
      }
      var mDrag = -1;
      function shareFromEvent(track, e) {
        var r = track.getBoundingClientRect();
        return clamp100((1 - (e.clientY - r.top) / Math.max(1, r.height)) * 100);
      }
      mrow.addEventListener('pointerdown', function (e) {
        var track = e.target.closest('.mui-mixer-track');
        if (!track || e.button !== 0) return;
        e.preventDefault();
        mrow.setPointerCapture(e.pointerId);
        mDrag = +track.dataset.ch;
        mSel = mDrag;
        root.classList.add('is-dragging');
        parts.mTracks[mDrag].classList.add('is-live');
        rebalance(mDrag, shareFromEvent(track, e));
      });
      mrow.addEventListener('pointermove', function (e) {
        if (mDrag < 0) return;
        rebalance(mDrag, shareFromEvent(parts.mTracks[mDrag], e));
      });
      function endMDrag() {
        if (mDrag >= 0) parts.mTracks[mDrag].classList.remove('is-live');
        mDrag = -1;
        root.classList.remove('is-dragging');
      }
      mrow.addEventListener('pointerup', endMDrag);
      mrow.addEventListener('pointercancel', endMDrag);

      /* keyboard: left/right selects channel, up/down adjusts */
      mrow.addEventListener('keydown', function (e) {
        var n = cfg.channels.length;
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          mSel = clamp(mSel + (e.key === 'ArrowRight' ? 1 : -1), 0, n - 1);
          render();
          return;
        }
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          var inc = cfg.steps >= 2 ? 100 / cfg.steps : (e.shiftKey ? 10 : 2);
          rebalance(mSel, value[mSel] + (e.key === 'ArrowUp' ? inc : -inc));
        }
      });
      parts.mixerSel = function () { return mSel; };
    }

    /* ============ FORK ============ */
    /* compiled routing (the model decides its process at run time). Face:
       an ink junction — one line entering left, fanning to 2–3 path lines
       right, path names at the ends, a round ink LEAN handle on a short
       arc across the fan. The favored path draws at full ink weight, the
       others faint — the control pictures its own value. Value = lean
       scalar; ONE scalar output jack. Emission is workbench-side. */
    if (kind === 'fork') {
      /* the SELECT/FORK split stated on the face (05 §FORK): a permanent
         9px eyebrow — SELECT = you pick now; FORK = AI picks at run time */
      var forkEyebrow = make('div', 'mui-fork-eyebrow');
      forkEyebrow.textContent = 'THE AI PICKS A PATH WHEN IT RUNS';
      root.insertBefore(forkEyebrow, body);
      var kwell = make('div', 'mui-fork-well', body);
      kwell.setAttribute('role', 'slider');
      kwell.setAttribute('tabindex', '0');
      kwell.setAttribute('aria-label', cfg.label);
      var ksvg = makeSvg('svg', { 'class': 'mui-fork-svg' }, kwell);
      parts.kFan = makeSvg('g', { 'class': 'fan' }, ksvg);
      parts.kLabels = makeSvg('g', { 'class': 'labels' }, ksvg);
      parts.kArc = makeSvg('path', { 'class': 'lean-arc' }, ksvg);
      parts.kHandle = makeSvg('circle', { 'class': 'lean-handle', r: '5.5' }, ksvg);
      parts.kSvg = ksvg;
      parts.kWell = kwell;
      parts.foot = make('div', 'mui-foot', root);
      if (fidelityOn) {
        parts.fidChip = makeFootChip(FIDELITY, FIDELITY_WORDS, cfg.fidelity,
          function (v) { cfg.fidelity = v; emitConfig(); }, 'mui-fidelity-chip');
        parts.foot.appendChild(parts.fidChip);
      }
      parts.readout = make('div', 'mui-readout', parts.foot);

      var KW = 0, KH = 0;
      function ksize() {
        var r = kwell.getBoundingClientRect();
        KW = Math.max(1, r.width); KH = Math.max(1, r.height);
        ksvg.setAttribute('viewBox', '0 0 ' + KW + ' ' + KH);
        renderFork();
      }
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(ksize).observe(kwell);
      requestAnimationFrame(ksize);

      /* geometry: junction on the left-center; N paths fan to the right */
      function forkGeom() {
        var N = cfg.paths.length;
        var jx = KW * 0.13, cy = KH / 2;
        var rx = KW * 0.52;                    /* leave the right ~48% for path names */
        var top = KH * 0.2, bot = KH * 0.8;
        var ys = [];
        for (var i = 0; i < N; i++) ys.push(N === 1 ? cy : top + (bot - top) * (i / (N - 1)));
        var angs = ys.map(function (y) { return Math.atan2(y - cy, Math.max(1, rx - jx)); });
        return { N: N, jx: jx, cy: cy, rx: rx, ys: ys, angs: angs, ra: KW * 0.3 };
      }
      /* favored path: the one the lean points to; with 2 paths, dead
         center (lean 50) favors NEITHER — the lean clause drops */
      function forkFavored() {
        var N = cfg.paths.length;
        if (N === 2 && Math.abs(value - 50) < 1) return -1;
        return clamp(Math.round((value / 100) * (N - 1)), 0, N - 1);
      }
      parts.forkFavored = forkFavored;

      function renderFork() {
        if (!KW || !parts.kFan) return;
        var g = forkGeom(), fav = forkFavored();
        while (parts.kFan.firstChild) parts.kFan.removeChild(parts.kFan.firstChild);
        while (parts.kLabels.firstChild) parts.kLabels.removeChild(parts.kLabels.firstChild);
        /* the entering line into the junction */
        makeSvg('line', {
          'class': 'enter', x1: '2', y1: g.cy.toFixed(1),
          x2: g.jx.toFixed(1), y2: g.cy.toFixed(1)
        }, parts.kFan);
        cfg.paths.forEach(function (p, i) {
          makeSvg('line', {
            'class': 'path' + (i === fav ? ' is-fav' : ''),
            x1: g.jx.toFixed(1), y1: g.cy.toFixed(1),
            x2: g.rx.toFixed(1), y2: g.ys[i].toFixed(1)
          }, parts.kFan);
          var tx = makeSvg('text', {
            'class': 'path-lbl' + (i === fav ? ' is-fav' : ''),
            x: (g.rx + 6).toFixed(1), y: (g.ys[i] + 3).toFixed(1)
          }, parts.kLabels);
          tx.textContent = String(p.name).toUpperCase();
        });
        /* the lean arc + handle */
        var a0 = g.angs[0], aN = g.angs[g.N - 1];
        var ah = a0 + (value / 100) * (aN - a0);
        var pa = polar(g.jx, g.cy, g.ra, (a0 * 180) / Math.PI);
        var pb = polar(g.jx, g.cy, g.ra, (aN * 180) / Math.PI);
        parts.kArc.setAttribute('d',
          'M ' + pa.x.toFixed(1) + ' ' + pa.y.toFixed(1) +
          ' A ' + g.ra.toFixed(1) + ' ' + g.ra.toFixed(1) + ' 0 0 1 ' +
          pb.x.toFixed(1) + ' ' + pb.y.toFixed(1));
        var ph = polar(g.jx, g.cy, g.ra, (ah * 180) / Math.PI);
        parts.kHandle.setAttribute('cx', ph.x.toFixed(1));
        parts.kHandle.setAttribute('cy', ph.y.toFixed(1));
      }
      parts.renderFork = renderFork;

      function leanFromEvent(e) {
        var r = kwell.getBoundingClientRect();
        var g = forkGeom();
        var ang = Math.atan2((e.clientY - r.top) - g.cy, Math.max(1, (e.clientX - r.left) - g.jx));
        var a0 = g.angs[0], aN = g.angs[g.N - 1];
        return clamp100(((ang - a0) / (aN - a0)) * 100);
      }
      kwell.addEventListener('pointerdown', function (e) {
        if (e.button !== 0) return;
        e.preventDefault();
        kwell.setPointerCapture(e.pointerId);
        root.classList.add('is-dragging');
        setValue(leanFromEvent(e), true);
      });
      kwell.addEventListener('pointermove', function (e) {
        if (!root.classList.contains('is-dragging')) return;
        setValue(leanFromEvent(e), true);
      });
      function endKDrag() { root.classList.remove('is-dragging'); }
      kwell.addEventListener('pointerup', endKDrag);
      kwell.addEventListener('pointercancel', endKDrag);
      kwell.addEventListener('keydown', function (e) {
        var d = 0;
        if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') d = -1;
        if (e.key === 'ArrowDown' || e.key === 'ArrowRight') d = 1;
        if (!d) return;
        e.preventDefault();
        setValue(value + d * (e.shiftKey ? 2 : 8), true);
      });

      function forkReadout() {
        var fav = forkFavored();
        return fav < 0 ? 'LEAN · EVEN' : 'LEANS · ' + String(cfg.paths[fav].name).toUpperCase();
      }
      parts.forkReadout = forkReadout;
    }

    /* ============ REVISE ============ */
    /* compiled feedback, small. Face: a count capsule (− n +) with n
       small nested arcs above it — the value's own picture. Passes 0–3,
       0 = silent. NO threshold/score numbers on the face (dishonest in
       one call — only passes). Value = passes scalar; ONE scalar jack. */
    if (kind === 'revise') {
      var rvArcsWrap = make('div', 'mui-revise-arcs', body);
      var rvsvg = makeSvg('svg', { 'class': 'mui-revise-svg', viewBox: '0 0 100 44',
        preserveAspectRatio: 'xMidYMax meet' }, rvArcsWrap);
      parts.rvArcs = makeSvg('g', null, rvsvg);
      var rvpill = make('div', 'mui-count-pill mui-revise-pill', body);
      var rvMinus = make('button', 'mui-count-btn', rvpill);
      rvMinus.type = 'button'; rvMinus.textContent = '−';
      rvMinus.setAttribute('aria-label', 'fewer passes');
      parts.rvVal = make('div', 'mui-count-val', rvpill);
      var rvPlus = make('button', 'mui-count-btn', rvpill);
      rvPlus.type = 'button'; rvPlus.textContent = '+';
      rvPlus.setAttribute('aria-label', 'more passes');
      rvMinus.addEventListener('click', function () { setValue(value - 1, true); });
      rvPlus.addEventListener('click', function () { setValue(value + 1, true); });

      parts.foot = make('div', 'mui-foot mui-foot--center', root);
      parts.strictChip = makeFootChip(STRICT, STRICT_WORDS, cfg.strict,
        function (v) { cfg.strict = v; emitConfig(); }, 'mui-strict-chip');
      parts.foot.appendChild(parts.strictChip);

      function renderRevise() {
        /* the word PASSES decodes the arcs (05 §REVISE defect 1); this
           readout is identity — it never sheds */
        parts.rvVal.textContent = value === 0 ? 'OFF' : '×' + value + ' PASSES';
        while (parts.rvArcs.firstChild) parts.rvArcs.removeChild(parts.rvArcs.firstChild);
        /* n nested arcs (ripples), opening downward, above the capsule */
        for (var k = 1; k <= value; k++) {
          var R = 8 + (k - 1) * 9;
          makeSvg('path', {
            'class': 'arc',
            d: 'M ' + (50 - R) + ' 40 A ' + R + ' ' + R + ' 0 0 1 ' + (50 + R) + ' 40'
          }, parts.rvArcs);
        }
      }
      parts.renderRevise = renderRevise;
    }

    /* --- speech row (grammar SC1) — the face's "effect" element: the
       part's live compiled sentence, fed by the host (the same string as
       its compiler card, so face and page always agree). Renders only
       when the WHOLE sentence fits — shed, don't shrink, no ellipsis
       ever. Ghost mode (SC3/ruling #2): an OFF face may show the
       ink-faint sentence it WOULD say. FILTER carries none — its worded
       readout IS the sentence. */
    /* pad and mixer left this list (gate rework #6): their value +
       sentence must read at the default drop size, not only at lg */
    var SPEECH_LG_ONLY = { order: 1, fork: 1, curve: 1 };
    var speechEl = null;
    if (kind !== 'filter') {
      speechEl = make('div', 'mui-speech', root);
      speechEl.style.display = 'none';
    }
    function fitSpeech() {
      if (!speechEl) return;
      var want = !!speechEl.textContent &&
        root.classList.contains('has-say-room') &&
        (!SPEECH_LG_ONLY[kind] || root.classList.contains('sz-lg'));
      speechEl.style.display = want ? '' : 'none';
      if (!want) return;
      /* whole-sentence rule: if it can't fit its 2-line box, it sheds */
      if (speechEl.scrollHeight > speechEl.clientHeight + 1) {
        speechEl.style.display = 'none';
      }
    }

    /* --- keyboard for continuous kinds --- */
    function attachKeys(elm) {
      elm.addEventListener('keydown', function (e) {
        var inc = cfg.steps >= 2 ? 100 / cfg.steps : 1;
        if (e.shiftKey && cfg.steps < 2) inc = 10;
        var v = null;
        if (e.key === 'ArrowUp' || e.key === 'ArrowRight') v = value + inc;
        if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') v = value - inc;
        if (e.key === 'Home') v = 0;
        if (e.key === 'End') v = 100;
        if (v !== null) { e.preventDefault(); setValue(v, true); }
      });
    }

    /* --- render --- */

    function renderDialTicks() {
      while (parts.ticks.firstChild) parts.ticks.removeChild(parts.ticks.firstChild);
      if (cfg.steps < 2) return;
      for (var i = 0; i <= cfg.steps; i++) {
        var a = DIAL.A0 + (DIAL.SWEEP * i) / cfg.steps;
        var p0 = polar(DIAL.C, DIAL.C, DIAL.ARC_R + 6.5, a);
        var p1 = polar(DIAL.C, DIAL.C, DIAL.ARC_R + 10.5, a);
        makeSvg('line', {
          'class': 'tick',
          x1: p0.x.toFixed(2), y1: p0.y.toFixed(2),
          x2: p1.x.toFixed(2), y2: p1.y.toFixed(2)
        }, parts.ticks);
      }
    }

    function renderSliderDetents() {
      while (parts.detentLayer.firstChild) parts.detentLayer.removeChild(parts.detentLayer.firstChild);
      if (cfg.steps < 2) return;
      for (var i = 0; i <= cfg.steps; i++) {
        var d = make('div', 'mui-slider-detent', parts.detentLayer);
        var f = i / cfg.steps;
        d.style.left = 'calc(4px + var(--hd) / 2 + (100% - var(--hd) - 8px) * ' + f + ')';
      }
    }

    /* pad: stepped axes draw the snap grid as slightly larger, darker
       dots — one dot field, two weights, never two overlaid grids */
    function renderPadSnaps() {
      while (parts.snaps.firstChild) parts.snaps.removeChild(parts.snaps.firstChild);
      var sx = cfg.axes.x.steps, sy = cfg.axes.y.steps;
      if (sx < 2 && sy < 2) return;
      var xs = [], ys = [], i;
      if (sx >= 2) for (i = 0; i <= sx; i++) xs.push(i / sx);
      else for (i = 0; i <= 4; i++) xs.push(i / 4);
      if (sy >= 2) for (i = 0; i <= sy; i++) ys.push(i / sy);
      else for (i = 0; i <= 4; i++) ys.push(i / 4);
      xs.forEach(function (fx) {
        ys.forEach(function (fy) {
          var d = make('span', 'mui-pad-snap', parts.snaps);
          d.style.left = 'calc(14px + (100% - 28px) * ' + fx + ')';
          d.style.top = 'calc(14px + (100% - 28px) * ' + fy + ')';
        });
      });
    }

    function renderPadEnds() {
      parts.endXlo.textContent = cfg.axes.x.low;
      parts.endXhi.textContent = cfg.axes.x.high;
      parts.endYlo.textContent = cfg.axes.y.low;
      parts.endYhi.textContent = cfg.axes.y.high;
    }

    function renderSliderEnds() {
      if (!parts.endLo) return;
      var lo = cfg.ends ? cfg.ends.low : '';
      var hi = cfg.ends ? cfg.ends.high : '';
      /* an unnamed pole shows a GHOST end word (gate-2 #485): a fresh
         slider must state its job — a position between two named ends —
         not read as a bare DIAL. Stops own the track's words when set,
         so stepped/named-stop sliders (e.g. STAGE) never ghost. */
      var ghostable = !cfg.stops;
      parts.endLo.textContent = lo || (ghostable ? 'LOW END' : '');
      parts.endHi.textContent = hi || (ghostable ? 'HIGH END' : '');
      parts.endLo.classList.toggle('is-ghost', ghostable && !lo);
      parts.endHi.classList.toggle('is-ghost', ghostable && !hi);
    }

    /* an end name yields to the handle when the handle sits on it, and
       both shed when the track is too narrow to carry them — shed,
       never overlap. Re-run on every render and resize. */
    function fitSliderEnds() {
      if (!parts.endLo) return;
      var tw = parts.track.clientWidth;
      /* measure the actual end words instead of a fixed 150px gate —
         the default 3-wide spawn must carry its (ghost) end names or a
         fresh slider reads as a bare dial (gate-2 #485) */
      parts.endLo.style.display = '';
      parts.endHi.style.display = '';
      var hd0 = parts.handle.offsetWidth || 24;
      var need = parts.endLo.offsetWidth + parts.endHi.offsetWidth + hd0 + 20;
      var roomy = tw >= Math.max(104, need);
      parts.endLo.style.display = roomy ? '' : 'none';
      parts.endHi.style.display = roomy ? '' : 'none';
      if (!roomy) return;
      var hd = parts.handle.offsetWidth || 24;
      var hx = 4 + hd / 2 + (tw - 8 - hd) * clamp100(value) / 100;
      parts.endLo.style.opacity =
        hx < parts.endLo.offsetWidth + 28 ? '0' : '';
      parts.endHi.style.opacity =
        hx > tw - parts.endHi.offsetWidth - 28 ? '0' : '';
    }

    function spanReadout(noNames) {
      if (value.mode === 'no-more-than') return '≤ ' + stopName(value.hi, noNames);
      if (value.mode === 'at-least') return '≥ ' + stopName(value.lo, noNames);
      return stopName(value.lo, noNames) + '–' + stopName(value.hi, noNames);
    }
    /* the sentence-form primary read (05 §RANGE / §FILTER): RANGE reads
       "between 30 and 70" (always two-sided); FILTER leads with the
       limit in words — "NO MORE THAN 40". The numeric spanReadout stays
       the shed fallback. */
    function spanSentence() {
      if (kind === 'filter') {
        if (value.mode === 'no-more-than') return 'NO MORE THAN ' + stopName(value.hi);
        if (value.mode === 'at-least') return 'AT LEAST ' + stopName(value.lo);
        return 'BETWEEN ' + stopName(value.lo) + '–' + stopName(value.hi);
      }
      return 'between ' + stopName(value.lo).toLowerCase() +
             ' and ' + stopName(value.hi).toLowerCase();
    }

    /* named-stop fallback — the label-collapse pattern applied to
       values, measured (never reacting to actual truncation, so it can
       recover on grow). Tiers:
       1. the named form, while it fits its row;
       2. the numeric form (`is-abbrev`) — the full named value moves to
          the hover chip;
       3. filter only: when even chip + numeric can't share the row, the
          mode chip hides (`is-mode-hidden`) — the ≤/≥ glyph and the
          face drawing still carry the mode. No truncated mono caps.
       CSS ellipsis on the readout is the final guard. Re-run on every
       render and every resize (applySize). */
    function measureW(cls, text) {
      var m = parts._meas;
      if (!m) {
        m = parts._meas = make('span', '', root);
        /* inline display pin: the measurer must keep measuring even
           while its borrowed class is display:none (is-mode-hidden) */
        m.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;top:0;' +
                          'white-space:nowrap;pointer-events:none;display:inline-block;';
      }
      m.className = cls;
      m.textContent = text;
      return m.scrollWidth;
    }
    function fitReadout() {
      if (!parts.readout) return;
      var row = parts.readout.parentNode;
      var rowW = row.clientWidth;
      var named = spanSentence(), numeric = spanReadout(true);
      var text = named, abbrev = false, hideMode = false;
      if (rowW > 0) {
        if (kind === 'filter') {
          var modeW = measureW('mui-filter-mode', FILTER_MODE_WORDS[value.mode]) + 8;
          if (named !== numeric && measureW('mui-readout', named) + modeW > rowW) {
            text = numeric; abbrev = true;
          }
          if (measureW('mui-readout', text) + modeW > rowW) hideMode = true;
        } else {
          /* range: the track never shrinks below its 40px minimum */
          var other = 40 + 10;
          if (named !== numeric && measureW('mui-readout', named) + other > rowW) {
            text = numeric; abbrev = true;
          }
        }
      }
      parts.readout.textContent = text;
      root.classList.toggle('is-abbrev', abbrev);
      if (kind === 'filter') root.classList.toggle('is-mode-hidden', hideMode);
    }

    /* dial/slider: whether the stops rider is live */
    function scalarNamed() {
      return (kind === 'dial' || kind === 'slider') &&
        cfg.stops && cfg.steps >= 2 && cfg.stops.length === cfg.steps + 1;
    }
    /* the rider's readout fit — same three-tier fallback as the span
       kinds: named while it fits, numeric + is-abbrev + hover chip when
       it wouldn't. Dial measures against the full readout row; slider
       against the row minus the track's 40px minimum. */
    function fitScalarReadout() {
      if (!parts.readout) return;
      if (!scalarNamed()) {
        /* slider end-name hint (05 §SLIDER): "40% · NEAR RELAXED" while
           it fits; numeric fallback keeps the fitReadout tier rule */
        var base = fmtPct(value), hinted = base;
        if (kind === 'slider' && cfg.ends && (cfg.ends.low || cfg.ends.high)) {
          var end = value <= 45 ? cfg.ends.low : value >= 55 ? cfg.ends.high : '';
          if (end) hinted = base + ' · NEAR ' + String(end).toUpperCase();
        }
        var hRow = parts.readout.parentNode;
        var hAvail = hRow.clientWidth - (kind === 'slider' ? 50 : 0);
        var hAb = hinted !== base && hAvail > 0 &&
          measureW('mui-readout', hinted) > hAvail;
        parts.readout.textContent = hAb ? base : hinted;
        root.classList.toggle('is-abbrev', hAb);
        return;
      }
      var named = stopName(value);
      var row = parts.readout.parentNode;
      var avail = row.clientWidth - (kind === 'slider' ? 50 : 0);
      var abbrev = avail > 0 && measureW('mui-readout', named) > avail;
      parts.readout.textContent = abbrev ? fmtPct(value) : named;
      root.classList.toggle('is-abbrev', abbrev);
    }

    function orderReadout() {
      return value.map(function (i) { return cfg.items[i].toUpperCase(); }).join(' › ');
    }
    function mixerChip() {
      return value.map(function (s) { return Math.round(s); }).join('·');
    }
    /* curve hover chip — the full active detent name (renamable) plus the
       wired POSITION sample, so the collapsed readout never loses words */
    function curveChip() {
      var s = value.length + ' PT';
      var a = parts.curveActive ? parts.curveActive() : -1;
      if (a >= 0 && value[a] && parts.xDetName) {
        s += ' · ' + parts.xDetName(value[a].t) + ' ' + Math.round(value[a].v);
      }
      var pos = parts.curvePosition ? parts.curvePosition() : null;
      if (pos != null && parts.sampleAt) s += ' · @' + Math.round(sampleAtSafe(pos));
      return s;
    }
    function sampleAtSafe(t) { return parts.sampleAt ? parts.sampleAt(t) : 0; }

    function updateChipText() {
      var v = kind === 'words'
        ? (value ? '“' + (value.length > 18 ? value.slice(0, 18) + '…' : value) + '”' : '—')
        : kind === 'switch' ? (value >= 50 ? 'ON' : 'OFF')
        : kind === 'count' ? String(Math.round(value))
        : kind === 'pad' ? Math.round(value.x) + '·' + Math.round(value.y)
        : (kind === 'range' || kind === 'filter') ? spanReadout()
        : kind === 'curve' ? curveChip()
        : kind === 'select' ? String(cfg.options[value] || '').toUpperCase()
        : kind === 'order' ? 'SHUFFLE ' + Math.round(parts.displacement ? parts.displacement() : 0)
        : kind === 'mixer' ? mixerChip()
        : kind === 'fork' ? (parts.forkReadout ? parts.forkReadout() : '')
        : kind === 'revise' ? (value === 0 ? 'OFF' : '×' + value)
        : scalarNamed() ? stopName(value)
        : fmtPct(value);
      hoverchip.textContent = cfg.label + ' · ' + v;

      /* jack word-labels (SC5): payload nuance and hidden coercions
         spoken AT the jack — name · value — what flows. Read-only
         outs say so. Rewritten on every render so the chip is live. */
      var RO = ' · lenses can look, not write';
      if (kind === 'pad') {
        if (nodes.y) nodes.y.setLabel(cfg.label + ' · ' + cfg.axes.y.label + ' · ' +
          Math.round(value.y) + ' — sends a number (0–100)');
        if (nodes.x) nodes.x.setLabel(cfg.label + ' · ' + cfg.axes.x.label + ' · ' +
          Math.round(value.x) + ' — sends a number (0–100)');
      } else if (kind === 'mixer') {
        cfg.channels.forEach(function (ch, i) {
          if (nodes[ch]) nodes[ch].setLabel(ch + ' · ' + Math.round(value[i]) +
            '% — sends this channel’s share (0–100)' + RO);
        });
      } else if (node) {
        var jt;
        if (kind === 'switch') {
          jt = cfg.label + ' · ' + (value >= 50 ? 'ON' : 'OFF') + ' — sends 0 or 100';
        } else if (kind === 'count') {
          jt = cfg.label + ' · ' + Math.round(value) + ' — sends ' +
            Math.round(value) * 10 + ' of 100 (each step is 10)';
        } else if (kind === 'words') {
          jt = cfg.label + ' · ' + String(value).trim().length +
            ' letters — sends how long the text is, not the words' + RO;
        } else if (kind === 'range' || kind === 'filter') {
          jt = cfg.label + ' · ' + spanReadout(true) + ' — sends a window (two numbers)';
        } else if (kind === 'curve') {
          jt = cfg.label + ' · ' + value.length + ' points — sends a shape that changes across the answer';
        } else if (kind === 'order') {
          jt = cfg.label + ' — sends how far you’ve shuffled from the default order (0–100), not the names' + RO;
        } else if (kind === 'fork') {
          jt = cfg.label + ' · ' + (parts.forkReadout ? parts.forkReadout() : '') + ' — sends the lean (0–100)';
        } else if (kind === 'revise') {
          jt = cfg.label + ' · ' + (value === 0 ? 'OFF' : '×' + value) + ' — sends the pass count (0–3, as 0–100)';
        } else {
          jt = cfg.label + ' · ' + (scalarNamed() ? stopName(value) : Math.round(value)) +
            ' — sends a number (0–100' + (scalarNamed() ? '; each stop is a band' : '') + ')';
        }
        node.setLabel(jt);
      }
    }

    function render() {
      if (kind === 'dial') {
        var pct = clamp100(value);
        if (pct < 0.5) {
          parts.arc.setAttribute('display', 'none');
        } else {
          parts.arc.removeAttribute('display');
          parts.arc.setAttribute('d',
            arcPath(DIAL.C, DIAL.C, DIAL.ARC_R, DIAL.A0, DIAL.A0 + (DIAL.SWEEP * pct) / 100));
        }
        parts.needleG.setAttribute('transform',
          'rotate(' + (DIAL.A0 + (DIAL.SWEEP * pct) / 100) + ' ' + DIAL.C + ' ' + DIAL.C + ')');
        fitScalarReadout();
        parts.svg.setAttribute('aria-valuenow', Math.round(pct));
        parts.svg.setAttribute('aria-valuemin', '0');
        parts.svg.setAttribute('aria-valuemax', '100');
      }
      if (kind === 'slider') {
        parts.track.style.setProperty('--t', (clamp100(value) / 100).toFixed(4));
        fitSliderEnds();
        fitScalarReadout();
        parts.track.setAttribute('aria-valuenow', Math.round(value));
        parts.track.setAttribute('aria-valuemin', '0');
        parts.track.setAttribute('aria-valuemax', '100');
      }
      if (kind === 'switch') {
        root.classList.toggle('is-on', value >= 50);
        parts.pill.setAttribute('aria-checked', value >= 50 ? 'true' : 'false');
      }
      if (kind === 'count') {
        /* the ceiling on the face: "3 / 10" — the suffix is tertiary
           (sheds at sm) and matches the jack's ×10 coercion story */
        parts.countVal.textContent = String(Math.round(value));
        var cMax = make('span', 'mui-count-max', parts.countVal);
        cMax.textContent = ' / 10';
      }
      if (kind === 'words' && parts.input.value !== value) {
        parts.input.value = value;
      }
      if (kind === 'pad') {
        parts.well.style.setProperty('--px', (value.x / 100).toFixed(4));
        parts.well.style.setProperty('--py', (1 - value.y / 100).toFixed(4));
        parts.readout.textContent = Math.round(value.x) + ' · ' + Math.round(value.y);
      }
      if (kind === 'range') {
        parts.track.style.setProperty('--tl', (value.lo / 100).toFixed(4));
        parts.track.style.setProperty('--th', (value.hi / 100).toFixed(4));
        fitReadout();
        parts.hLo.setAttribute('aria-valuemin', '0');
        parts.hLo.setAttribute('aria-valuemax', Math.round(value.hi));
        parts.hLo.setAttribute('aria-valuenow', Math.round(value.lo));
        parts.hLo.setAttribute('aria-valuetext', Math.round(value.lo) + ' percent');
        parts.hHi.setAttribute('aria-valuemin', Math.round(value.lo));
        parts.hHi.setAttribute('aria-valuemax', '100');
        parts.hHi.setAttribute('aria-valuenow', Math.round(value.hi));
        parts.hHi.setAttribute('aria-valuetext', Math.round(value.hi) + ' percent');
      }
      if (kind === 'filter') {
        parts.modeBtn.textContent = FILTER_MODE_WORDS[value.mode];
        fitReadout();
        if (parts.renderFilter) parts.renderFilter();
        var loActive = value.mode !== 'no-more-than';
        var hiActive = value.mode !== 'at-least';
        parts.fLoHandle.hidden = !loActive;
        parts.fHiHandle.hidden = !hiActive;
        parts.fLoHandle.tabIndex = loActive ? 0 : -1;
        parts.fHiHandle.tabIndex = hiActive ? 0 : -1;
        parts.fLoHandle.setAttribute('aria-valuemin', '0');
        parts.fLoHandle.setAttribute('aria-valuemax', Math.round(value.mode === 'between' ? value.hi : 100));
        parts.fLoHandle.setAttribute('aria-valuenow', Math.round(value.lo));
        parts.fLoHandle.setAttribute('aria-valuetext', Math.round(value.lo) + ' percent');
        parts.fHiHandle.setAttribute('aria-valuemin', Math.round(value.mode === 'between' ? value.lo : 0));
        parts.fHiHandle.setAttribute('aria-valuemax', '100');
        parts.fHiHandle.setAttribute('aria-valuenow', Math.round(value.hi));
        parts.fHiHandle.setAttribute('aria-valuetext', Math.round(value.hi) + ' percent');
      }
      if (kind === 'curve') {
        if (parts.renderCurve) parts.renderCurve();
        if (parts.fitCurveReadout) parts.fitCurveReadout();
      }
      if (kind === 'fork') {
        if (parts.renderFork) parts.renderFork();
        parts.readout.textContent = parts.forkReadout ? parts.forkReadout() : '';
      }
      if (kind === 'revise') {
        if (parts.renderRevise) parts.renderRevise();
      }
      if (kind === 'select') {
        var ink = inkFor(cfg.accent);
        parts.selCells.forEach(function (cell, i) {
          var on = i === value;
          cell.classList.toggle('is-picked', on);
          /* an option with no sentence renders dashed-hollow — picking
             it will say nothing, and the face says so before the pick */
          cell.classList.toggle('is-frameless', !String(cfg.frames[i] || '').trim());
          cell.style.color = on ? ink : '';
          cell.setAttribute('aria-checked', on ? 'true' : 'false');
        });
      }
      if (kind === 'order') {
        if (parts.rebuildOrder) parts.rebuildOrder();
        parts.readout.textContent = orderReadout();
      }
      if (kind === 'mixer') {
        var sel = parts.mixerSel ? parts.mixerSel() : -1;
        parts.mTracks.forEach(function (t, i) {
          t.style.setProperty('--s', (value[i] / 100).toFixed(4));
          t.classList.toggle('is-sel', i === sel);
          t.setAttribute('aria-label', cfg.channels[i] + ' ' + Math.round(value[i]) + '%');
        });
        parts.readout.textContent =
          value.map(function (s) { return Math.round(s); }).join(' · ');
      }
      updateChipText();
    }

    function setValue(v, fromUser) {
      var next;
      if (kind === 'words') next = String(v == null ? '' : v);
      else if (kind === 'switch') next = clamp100(v) >= 50 ? 100 : 0;
      else if (kind === 'count') next = Math.round(clamp(v, 0, 10));   /* 0–10: the "/ 10" face + ×10 jack story */
      else if (kind === 'pad') next = normPad(v);
      else if (kind === 'range' || kind === 'filter') next = normSpan(v);
      else if (kind === 'curve') next = normSeries(v);
      else if (kind === 'select') next = normPick(v);
      else if (kind === 'order') next = normPerm(v);
      else if (kind === 'mixer') next = normShares(v);
      else if (kind === 'fork') next = clamp100(v);
      else if (kind === 'revise') next = clampPasses(v);
      else next = snapValue(v, cfg.steps);
      var changed = (typeof next === 'object')
        ? JSON.stringify(next) !== JSON.stringify(value)
        : next !== value;
      if (!changed) { render(); return; }
      value = next;
      render();
      if (fromUser) emitChange();
    }

    /* --- popups (config + color well; one open at a time) --- */

    function registerPopup(pop, opener, kindName) {
      function onDocDown(e) {
        if (pop.contains(e.target) || opener.contains(e.target)) return;
        closePopup();
      }
      function onKeyDown(e) {
        if (e.key !== 'Escape') return;
        e.preventDefault();
        closePopup();
        opener.focus();
      }
      document.addEventListener('pointerdown', onDocDown, true);
      pop.addEventListener('keydown', onKeyDown);
      currentPopup = { el: pop, onDocDown: onDocDown, kind: kindName, owner: root };
    }

    function buildSwatches(container, pop) {
      PRESETS.forEach(function (hex) {
        var sw = make('button', 'mui-swatch', container);
        sw.type = 'button';
        sw.style.background = hex;
        sw.setAttribute('aria-label', 'Color ' + hex);
        var active = hex.toLowerCase() === cfg.accent.toLowerCase();
        sw.setAttribute('aria-pressed', String(active));
        if (active) sw.classList.add('is-active');
        sw.addEventListener('click', function () {
          cfg.accent = hex;
          root.style.setProperty('--accent', hex);
          if (pop) pop.style.setProperty('--accent', hex);
          var act = container.querySelector('.is-active');
          if (act) { act.classList.remove('is-active'); act.setAttribute('aria-pressed', 'false'); }
          sw.classList.add('is-active');
          sw.setAttribute('aria-pressed', 'true');
          render();   /* inkFor()-painted text (select pick, order top token) */
          emitConfig();
        });
      });
    }

    /* compact color well — the 8 swatches and nothing else */
    function openColors() {
      closePopup();
      var pop = make('div', 'mui-popup mui-popup--well');
      pop.style.setProperty('--accent', cfg.accent);
      pop.setAttribute('role', 'group');
      pop.setAttribute('aria-label', 'Color of ' + cfg.label);
      var well = make('div', 'mui-popup-swatches', pop);
      buildSwatches(well, pop);
      well.addEventListener('keydown', function (e) {
        if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(e.key) < 0) return;
        var swatches = Array.prototype.slice.call(well.querySelectorAll('.mui-swatch'));
        var i = Math.max(0, swatches.indexOf(document.activeElement));
        if (e.key === 'Home') i = 0;
        else if (e.key === 'End') i = swatches.length - 1;
        else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') i = (i - 1 + swatches.length) % swatches.length;
        else i = (i + 1) % swatches.length;
        e.preventDefault(); swatches[i].focus();
      });
      document.body.appendChild(pop);
      var rr = ringBtn.getBoundingClientRect();
      var pw = pop.offsetWidth, ph = pop.offsetHeight;
      var x = clamp(rr.left - 8, 8, Math.max(8, window.innerWidth - pw - 8));
      var y = rr.bottom + 8;
      if (y + ph > window.innerHeight - 8) y = rr.top - ph - 8;
      y = clamp(y, 8, Math.max(8, window.innerHeight - ph - 8));
      pop.style.left = Math.round(x + window.scrollX) + 'px';
      pop.style.top = Math.round(y + window.scrollY) + 'px';
      registerPopup(pop, ringBtn, 'well');
      requestAnimationFrame(function () {
        var first = well.querySelector('.mui-swatch.is-active') || well.querySelector('.mui-swatch');
        if (first) first.focus();
      });
    }

    function openConfig() {
      closePopup();
      var pop = make('div', 'mui-popup');
      pop.style.setProperty('--accent', cfg.accent);
      pop.setAttribute('role', 'dialog');
      pop.setAttribute('aria-label', 'Configure ' + cfg.label);

      /* a quiet helper line under a field's control */
      function helpLine(field, text) {
        var h = make('div', 'mui-popup-help', field);
        h.textContent = text;
        return h;
      }

      /* WHAT IT SAYS NOW — the live sentence preview, PROMOTED to the
         top (SC4.1). Every field edit below re-renders it immediately
         and flashes: field → consequence, before committing. */
      var fSays = make('div', 'mui-popup-field mui-popup-says', pop);
      make('label', 'mui-popup-label', fSays).textContent = 'What it says now';
      var saysBody = make('div', 'mui-popup-saysbody', fSays);
      var lastSays = null;
      function paintSays() {
        var t = saysNow ? saysNow() : (hoverchip.textContent || '');
        var off = !t;
        saysBody.textContent = off ? 'OFF — says nothing at this value' : t;
        saysBody.classList.toggle('is-off', off);
        if (lastSays !== null && lastSays !== saysBody.textContent && !reducedMotion.matches) {
          saysBody.classList.remove('did-change');
          void saysBody.offsetWidth;
          saysBody.classList.add('did-change');
        }
        lastSays = saysBody.textContent;
      }
      paintSays();
      /* repaint SYNCHRONOUSLY on input (gate-2 #486): the field handlers
         on the target run first (bubble order), so the model is already
         updated — and rAF never fires in a hidden document, which left
         the preview stale exactly while a sentence template was edited */
      pop.addEventListener('input', function () { paintSays(); });
      pop.addEventListener('click', function () {
        paintSays();
        requestAnimationFrame(paintSays);   /* catch post-click async paints */
      });

      /* NAME (SC4.2) */
      var f1 = make('div', 'mui-popup-field', pop);
      make('label', 'mui-popup-label', f1).textContent = 'Name';
      var titleIn = make('input', 'mui-field-input mui-popup-input', f1);
      titleIn.type = 'text';
      titleIn.value = cfg.label;
      titleIn.addEventListener('input', function () {
        cfg.label = titleIn.value.toUpperCase();
        labelEl.textContent = cfg.label;
        updateChipText();   /* jack chips re-compose from the new name */
        emitConfig();
      });

      /* NOTE (SC4.7) — built now, appended LAST (after every
         part-specific and host-appended field): the popover reads
         top-down as "which field changes what", and the note changes
         nothing the prompt ever reads. */
      var noteField = make('div', 'mui-popup-field mui-popup-field--note');
      make('label', 'mui-popup-label', noteField).textContent = 'Note';
      var descIn = make('textarea', 'mui-field-input mui-popup-textarea', noteField);
      descIn.rows = 3;
      descIn.placeholder = 'What does this control mean…';
      descIn.value = cfg.desc;
      descIn.addEventListener('input', function () {
        cfg.desc = descIn.value;
        emitConfig();
      });
      helpLine(noteField, 'For you — the prompt never reads it.');

      /* stepper builder — OFF, 2…10 by default; opts {min, max, off}
         bound a fixed range (the fork's Paths stepper is min 2 / max 3 /
         no OFF) */
      function makeStepper(parent, getN, setN, opts) {
        opts = opts || {};
        var lo = opts.min != null ? opts.min : 2;
        var hi = opts.max != null ? opts.max : 10;
        var offAllowed = opts.off !== false;
        var stepper = make('div', 'mui-popup-steps', parent);
        var sMinus = make('button', null, stepper);
        sMinus.type = 'button'; sMinus.textContent = '−';
        var sVal = make('div', 'val', stepper);
        var sPlus = make('button', null, stepper);
        sPlus.type = 'button'; sPlus.textContent = '+';
        function show() { var n = getN(); sVal.textContent = n < lo ? 'OFF' : String(n); }
        sMinus.addEventListener('click', function () {
          var n = getN();
          setN(n <= lo ? (offAllowed ? 0 : lo) : n - 1); show();
        });
        sPlus.addEventListener('click', function () {
          var n = getN(); setN(n < lo ? lo : Math.min(hi, n + 1)); show();
        });
        show();
        return stepper;
      }
      function afterSteps() {
        if (kind === 'dial') renderDialTicks();
        if (kind === 'slider' || kind === 'range') renderSliderDetents();
        setValue(value, false);   /* re-snap + redraw (filter/curve render in setValue) */
        emitConfig();
      }

      /* STOPS — every stepped kind; the curve's VALUE STOPS quantize y.
         The "steps" word now means exactly one thing per surface
         (ruling #6): config stops are STOPS, the work chain is steps.
         The MIXER swaps this for SNAP below — its stops never had
         names, only a grid. */
      if (STEPPED && kind !== 'pad' && kind !== 'mixer') {
        var f3 = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', f3).textContent =
          kind === 'curve' ? 'Value stops' : 'Stops';
        makeStepper(f3,
          function () { return cfg.steps; },
          function (n) { cfg.steps = n; afterSteps(); });
      }
      /* MIXER SNAP (ruling #3): OFF / 5 / 10 / 25 — the share grid in
         the shares' own units; the inert STOP NAMES field is gone */
      if (kind === 'mixer') {
        var fSnap = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', fSnap).textContent = 'Snap';
        var snapRow = make('div', 'mui-popup-modes', fSnap);
        [['OFF', 0], ['5', 20], ['10', 10], ['25', 4]].forEach(function (o) {
          var b = make('button', 'mui-btn mui-btn--sm' +
            (cfg.steps === o[1] ? ' mui-btn--primary' : ''), snapRow);
          b.type = 'button';
          b.textContent = o[0];
          b.addEventListener('click', function () {
            cfg.steps = o[1];
            afterSteps();
            Array.prototype.forEach.call(snapRow.children, function (c) {
              c.classList.remove('mui-btn--primary');
            });
            b.classList.add('mui-btn--primary');
          });
        });
        helpLine(fSnap, 'Faders land on multiples of this.');
      }

      /* STOP NAMES — range/filter always; dial/slider when stepped
         (the SPEC 04 rider). NO VANISHING FIELDS (SC4): when it does
         not apply it renders disabled with the reason inline. */
      if (kind === 'range' || kind === 'filter' ||
          kind === 'dial' || kind === 'slider') {
        var fS = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', fS).textContent = 'Stop names';
        var stopsIn = make('input', 'mui-field-input mui-popup-input mui-popup-stops', fS);
        stopsIn.type = 'text';
        stopsIn.placeholder = 'a phrase, a paragraph, …';
        stopsIn.style.textTransform = 'none';
        stopsIn.value = cfg.stops ? cfg.stops.join(', ') : '';
        stopsIn.addEventListener('input', function () {
          var names = stopsIn.value.split(',').map(function (s) { return s.trim(); })
            .filter(function (s) { return s.length; });
          cfg.stops = names.length > 1 ? names : null;
          render();
          emitConfig();
        });
        /* the helper speaks the LIVE count — 'N stops need N names',
           never a stale '4' next to a different number (gate rework #4) */
        var stopNameCount = function () { return cfg.steps + 1; };
        var stopsNeedLine = function () {
          var n = stopNameCount();
          return 'One name per stop — ' + n + ' stops need ' + n + ' names.';
        };
        var stopsHelp = helpLine(fS, stopsNeedLine());
        var syncStops = function () {
          var on = kind === 'range' || kind === 'filter' || cfg.steps >= 2;
          stopsIn.disabled = !on;
          fS.classList.toggle('is-disabled', !on);
          stopsHelp.textContent = on ? stopsNeedLine() : 'Turn on STOPS first.';
        };
        syncStops();
        pop.addEventListener('click', syncStops);   /* the stepper lives in this popup */
      }

      /* END NAMES — the slider's two poles (05 §SLIDER) */
      if (kind === 'slider') {
        var fE = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', fE).textContent = 'End names';
        var endRow2 = make('div', 'mui-popup-ends', fE);
        var loEnd = make('input', 'mui-field-input mui-popup-input', endRow2);
        loEnd.type = 'text'; loEnd.placeholder = 'relaxed'; loEnd.value = cfg.ends.low;
        var hiEnd = make('input', 'mui-field-input mui-popup-input', endRow2);
        hiEnd.type = 'text'; hiEnd.placeholder = 'formal'; hiEnd.value = cfg.ends.high;
        loEnd.addEventListener('input', function () {
          cfg.ends.low = loEnd.value; renderSliderEnds(); render(); emitConfig();
        });
        hiEnd.addEventListener('input', function () {
          cfg.ends.high = hiEnd.value; renderSliderEnds(); render(); emitConfig();
        });
        helpLine(fE, 'The two ends the handle slides between.');
      }

      /* comma-list fields for the speech kinds */
      function listField(labelText, get, apply, placeholder) {
        var f = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', f).textContent = labelText;
        var input = make('input', 'mui-field-input mui-popup-input', f);
        input.type = 'text';
        input.placeholder = placeholder || '';
        input.style.textTransform = 'none';
        input.value = get().join(', ');
        input.addEventListener('change', function () {
          var names = input.value.split(',').map(function (s) { return s.trim(); })
            .filter(function (s) { return s.length; });
          apply(names);
          input.value = get().join(', ');
          emitConfig();
        });
        return f;
      }
      if (kind === 'select') {
        listField('Options (2–7)',
          function () { return cfg.options; },
          function (names) {
            cfg.options = nameList(names, 2, 7, cfg.options);
            /* realign frames with the new option list */
            cfg.frames = cfg.options.map(function (op, i) { return cfg.frames[i] || ''; });
            value = normPick(value);
            if (parts.rebuildSelect) parts.rebuildSelect();
            rebuildFrameFields();
            render();
          }, 'founder, teammate, client');
        /* SENTENCES — an accordion, one option open at a time (kills
           the 7-row wall, 05 §SELECT defect 3). A row names its option
           and shows whether it has a sentence yet; opening it reveals
           the one SENTENCE · <OPTION> field. */
        var framesHost = make('div', 'mui-popup-acc-host', pop);
        make('label', 'mui-popup-label', framesHost).textContent = 'Sentences';
        var accBody = make('div', null, framesHost);
        var openIdx = value;   /* start on the picked option */
        function rebuildFrameFields() {
          accBody.innerHTML = '';
          cfg.options.forEach(function (op, i) {
            var row = make('div', 'mui-popup-acc', accBody);
            var head2 = make('button', 'mui-popup-acc-head', row);
            head2.type = 'button';
            var nm = make('span', null, head2);
            nm.textContent = String(op).toUpperCase();
            var st = make('span', 'mui-popup-acc-state', head2);
            function paintState() {
              st.textContent = String(cfg.frames[i] || '').trim() ? '' : 'NO SENTENCE';
            }
            paintState();
            if (i === openIdx) {
              row.classList.add('is-open');
              var f = make('div', 'mui-popup-field', row);
              make('label', 'mui-popup-label', f).textContent =
                'Sentence · ' + String(op).toUpperCase();
              var input = make('input', 'mui-field-input mui-popup-input mui-popup-frame', f);
              input.type = 'text';
              input.placeholder = 'What picking "' + op + '" says…';
              input.style.textTransform = 'none';
              /* rebuilt rows miss the popover-wide aria pass — name the
                 field explicitly (gate-2 #486) */
              input.setAttribute('aria-label', 'Sentence · ' + String(op).toUpperCase());
              input.value = cfg.frames[i] || '';
              input.addEventListener('input', function () {
                cfg.frames[i] = input.value;
                paintState();
                render();   /* frameless cells re-dash live */
                emitConfig();
              });
            }
            head2.addEventListener('click', function () {
              openIdx = openIdx === i ? -1 : i;
              rebuildFrameFields();
            });
          });
        }
        rebuildFrameFields();
      }
      if (kind === 'order') {
        var fItems = listField('Items (2–7)',
          function () { return cfg.items; },
          function (names) {
            cfg.items = nameList(names, 2, 7, cfg.items);
            value = normPerm(null);          /* new list resets to authored order */
            render();
          }, 'clarity, depth, brevity');
        /* the reset consequence stated ON the field (05 §ORDER defect 3) */
        helpLine(fItems, 'Editing the list resets the ranking.');
      }
      if (kind === 'mixer') {
        listField('Channels (2–6)',
          function () { return cfg.channels; },
          function (names) {
            var old = {};
            cfg.channels.forEach(function (ch, i) { old[ch] = value[i]; });
            cfg.channels = nameList(names, 2, 6, cfg.channels);
            value = normShares(old);         /* surviving channels keep weight */
            rebuildMixerJacks();
            if (parts.rebuildMixer) parts.rebuildMixer();
            render();
          }, 'evidence, examples, intuition');
      }

      /* LIMIT TYPE — filter only; three plain-word chips, the same
         state as the face's mode chip (SC4: chip = fast toggle, this
         row = the complete story) */
      if (kind === 'filter') {
        var fM = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', fM).textContent = 'Limit type';
        fM.addEventListener('pointerenter', function () {
          if (parts.modeBtn) parts.modeBtn.classList.add('is-marked');
        });
        fM.addEventListener('pointerleave', function () {
          if (parts.modeBtn) parts.modeBtn.classList.remove('is-marked');
        });
        var modeRow = make('div', 'mui-popup-modes', fM);
        FILTER_MODES.forEach(function (m) {
          var b = make('button', 'mui-btn mui-btn--sm' +
            (value.mode === m ? ' mui-btn--primary' : ''), modeRow);
          b.type = 'button';
          b.textContent = FILTER_MODE_WORDS[m];
          b.addEventListener('click', function () {
            var lo = value.lo, hi = value.hi;
            if (m === 'no-more-than') { hi = hi < 100 ? hi : (lo > 0 ? lo : 70); lo = 0; }
            if (m === 'at-least') { lo = lo > 0 ? lo : (hi < 100 ? hi : 30); hi = 100; }
            if (m === 'between' && lo === 0 && hi === 100) { lo = 30; hi = 70; }
            setValue({ lo: lo, hi: hi, mode: m }, true);
            Array.prototype.forEach.call(modeRow.children, function (c) {
              c.classList.remove('mui-btn--primary');
            });
            b.classList.add('mui-btn--primary');
          });
        });
      }

      /* ACROSS — curve only; what t means, in plain words (was "Over";
         with VALUE STOPS and MOMENT NAMES the curve's three step-ish
         concepts now have unmistakably different names, ruling #6) */
      if (kind === 'curve') {
        var fT = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', fT).textContent = 'Across';
        var sel = make('select', 'mui-field-input mui-popup-select', fT);
        [['answer', 'THE ANSWER'],
         ['task', 'THE STEPS OF THE TASK'],
         ['list', 'EACH ITEM IN A LIST']].forEach(function (o) {
          var op = make('option', null, sel);
          op.value = o[0];
          op.textContent = o[1];
          if (cfg.timebase === o[0]) op.selected = true;
        });
        sel.addEventListener('change', function () {
          cfg.timebase = sel.value;
          emitConfig();
        });
        /* MOMENT NAMES — creator names for the five speakable moments.
           When named, the readout and emission speak the stage words. */
        var fX = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', fX).textContent = 'Moment names';
        var xIn = make('input', 'mui-field-input mui-popup-input mui-popup-stops', fX);
        xIn.type = 'text';
        xIn.placeholder = 'exploring, organising, committing…';
        xIn.style.textTransform = 'none';
        xIn.value = cfg.xdetents ? cfg.xdetents.join(', ') : '';
        xIn.addEventListener('input', function () {
          var names = xIn.value.split(',').map(function (s) { return s.trim(); });
          /* keep positional alignment — a trailing empty means "unnamed" */
          while (names.length && names[names.length - 1] === '') names.pop();
          cfg.xdetents = names.length ? names.slice(0, 5) : null;
          render();
          emitConfig();
        });
        helpLine(fX, 'The five moments: start · early · middle · late · end.');
      }

      /* pad — two axis blocks: axis title, end names, steps */
      if (kind === 'pad') {
        ['x', 'y'].forEach(function (axKey) {
          var ax = cfg.axes[axKey];
          var blk = make('div', 'mui-popup-axis', pop);
          make('div', 'mui-popup-axis-head', blk).textContent = axKey.toUpperCase() + ' AXIS';
          var fa = make('div', 'mui-popup-field', blk);
          make('label', 'mui-popup-label', fa).textContent = 'Axis name';
          var axIn = make('input', 'mui-field-input mui-popup-input', fa);
          axIn.type = 'text';
          axIn.value = ax.label;
          axIn.addEventListener('input', function () {
            ax.label = axIn.value.toUpperCase();
            nodes[axKey].setLabel(ax.label);
            emitConfig();
          });
          var fe = make('div', 'mui-popup-field', blk);
          make('label', 'mui-popup-label', fe).textContent = 'End names';
          var endRow = make('div', 'mui-popup-ends', fe);
          var loIn = make('input', 'mui-field-input mui-popup-input', endRow);
          loIn.type = 'text'; loIn.placeholder = 'low'; loIn.value = ax.low;
          var hiIn = make('input', 'mui-field-input mui-popup-input', endRow);
          hiIn.type = 'text'; hiIn.placeholder = 'high'; hiIn.value = ax.high;
          loIn.addEventListener('input', function () {
            ax.low = loIn.value; renderPadEnds(); emitConfig();
          });
          hiIn.addEventListener('input', function () {
            ax.high = hiIn.value; renderPadEnds(); emitConfig();
          });
          var fs = make('div', 'mui-popup-field', blk);
          make('label', 'mui-popup-label', fs).textContent = 'Stops';
          makeStepper(fs,
            function () { return ax.steps; },
            function (n) {
              ax.steps = n;
              renderPadSnaps();
              setValue(value, false);
              emitConfig();
            });
        });
      }

      /* a quiet prose field for the check block's "look at" line */
      function proseField(labelText, get, set, placeholder) {
        var f = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', f).textContent = labelText;
        var ta = make('textarea', 'mui-field-input mui-popup-textarea', f);
        ta.rows = 2;
        ta.placeholder = placeholder || '';
        ta.value = get();
        ta.addEventListener('input', function () { set(ta.value); emitConfig(); });
        return f;
      }

      /* FORK — the check block: HOW TO DECIDE (was "Look at" — now
         verbally distinct from REVISE's CHECK AGAINST) + 2–3 path
         blocks (the pad's axis-block pattern: a path name + THEN) */
      if (kind === 'fork') {
        var fDecide = proseField('How to decide',
          function () { return cfg.lookAt; },
          function (v) { cfg.lookAt = v; },
          'whether this needs looking things up…');
        helpLine(fDecide, 'What should it weigh up when it gets there?');
        var countField = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', countField).textContent = 'Paths';
        var pathsHost = make('div', null, pop);
        function rebuildPathBlocks() {
          pathsHost.innerHTML = '';
          cfg.paths.forEach(function (p, i) {
            var blk = make('div', 'mui-popup-axis', pathsHost);
            make('div', 'mui-popup-axis-head', blk).textContent = 'PATH ' + (i + 1);
            var fn = make('div', 'mui-popup-field', blk);
            make('label', 'mui-popup-label', fn).textContent = 'Path name';
            var nIn = make('input', 'mui-field-input mui-popup-input', fn);
            nIn.type = 'text'; nIn.value = p.name;
            nIn.addEventListener('input', function () {
              p.name = nIn.value || ('Path ' + (i + 1));
              render(); node.setLabel(cfg.label); emitConfig();
            });
            var fp = make('div', 'mui-popup-field', blk);
            make('label', 'mui-popup-label', fp).textContent = 'Then';
            var pIn = make('input', 'mui-field-input mui-popup-input', fp);
            pIn.type = 'text'; pIn.style.textTransform = 'none';
            pIn.placeholder = 'research first, cite what you find…';
            pIn.value = p.prose;
            pIn.addEventListener('input', function () { p.prose = pIn.value; emitConfig(); });
          });
        }
        makeStepper(countField,
          function () { return cfg.paths.length; },
          function (n) {
            n = clamp(n, 2, 3);
            while (cfg.paths.length < n) cfg.paths.push({ name: 'Path ' + (cfg.paths.length + 1), prose: '' });
            while (cfg.paths.length > n) cfg.paths.pop();
            setValue(value, false);      /* re-fit the favored path */
            rebuildPathBlocks();
            emitConfig();
          }, { min: 2, max: 3, off: false });
        rebuildPathBlocks();
      }

      /* REVISE — the check block: CHECK AGAINST (was "Look at" — the
         bar the draft must clear), HOW STRICT (mirrored from the foot
         chip), IF IT FALLS SHORT */
      if (kind === 'revise') {
        var fMetric = proseField('Check against',
          function () { return cfg.metric; },
          function (v) { cfg.metric = v; },
          'clear enough to skim…');
        helpLine(fMetric, 'The bar the draft must clear.');
        function toggleRow(labelText, states, wordsMap, get, set) {
          var f = make('div', 'mui-popup-field', pop);
          make('label', 'mui-popup-label', f).textContent = labelText;
          var row = make('div', 'mui-popup-modes', f);
          states.forEach(function (s) {
            var b = make('button', 'mui-btn mui-btn--sm' +
              (get() === s ? ' mui-btn--primary' : ''), row);
            b.type = 'button';
            b.textContent = wordsMap[s];
            b.addEventListener('click', function () {
              set(s);
              Array.prototype.forEach.call(row.children, function (c) { c.classList.remove('mui-btn--primary'); });
              b.classList.add('mui-btn--primary');
              emitConfig();
            });
          });
        }
        toggleRow('How strict', STRICT, STRICT_WORDS,
          function () { return cfg.strict; },
          function (s) { cfg.strict = s; if (parts.strictChip) parts.strictChip.setValue(s); });
        /* the face chip and this row are ONE state, rendered twice on
           purpose (SC4): chip = fast toggle, row = the complete story */
        helpLine(pop.lastChild, '(also a chip on the face)');
        toggleRow('If it falls short', ['fix', 'restart'],
          { fix: 'FIX IT', restart: 'START OVER' },
          function () { return cfg.redo; },
          function (s) { cfg.redo = s; });
      }

      /* RUNS — the face's ONE CALL · STAGED · AUTO chip, mirrored in
         settings. AUTO is the ONE spelling of the deferred state (R6) —
         what it follows is helper prose, never a second state word.
         One state, rendered twice on purpose; hovering the row
         highlights the face chip. */
      if (fidelityOn) {
        var RUNS_WORDS = {
          'auto': 'AUTO',
          'one-pass': 'ALWAYS IN THE ONE CALL',
          'in-stages': 'ALWAYS ITS OWN STAGE'
        };
        var fF = make('div', 'mui-popup-field', pop);
        make('label', 'mui-popup-label', fF).textContent = 'Runs';
        var fRow = make('div', 'mui-popup-modes', fF);
        FIDELITY.forEach(function (m) {
          var b = make('button', 'mui-btn mui-btn--sm' +
            (cfg.fidelity === m ? ' mui-btn--primary' : ''), fRow);
          b.type = 'button';
          b.textContent = RUNS_WORDS[m];
          b.addEventListener('click', function () {
            cfg.fidelity = m;
            if (parts.fidChip) parts.fidChip.setValue(m);
            Array.prototype.forEach.call(fRow.children, function (c) { c.classList.remove('mui-btn--primary'); });
            b.classList.add('mui-btn--primary');
            emitConfig();
          });
        });
        helpLine(fF, 'AUTO follows the WHEN IT RUNS lever. (Also a chip on the face.)');
        fF.addEventListener('pointerenter', function () {
          if (parts.fidChip) parts.fidChip.classList.add('is-marked');
        });
        fF.addEventListener('pointerleave', function () {
          if (parts.fidChip) parts.fidChip.classList.remove('is-marked');
        });
      }

      /* NOTE lands LAST (SC4.7) — after every part-specific field and
         after anything the host appends before it */
      pop.appendChild(noteField);

      /* Associate each compact popup control with the visible field label.
         Multi-control fields receive a useful suffix without adding copy. */
      Array.prototype.forEach.call(pop.querySelectorAll('.mui-popup-field'), function (field) {
        var label = field.querySelector(':scope > .mui-popup-label');
        if (!label) return;
        var controls = field.querySelectorAll('input, textarea, select, button');
        Array.prototype.forEach.call(controls, function (control, i) {
          if (control.getAttribute('aria-label')) return;
          var suffix = '';
          if (controls.length > 1) {
            suffix = control.placeholder || control.textContent.trim() || ('option ' + (i + 1));
          }
          control.setAttribute('aria-label', label.textContent + (suffix ? ': ' + suffix : ''));
        });
      });

      /* no color row — color is direct, via the accent ring's well */

      /* place adjacent to the control, flip if offscreen */
      document.body.appendChild(pop);
      var r = root.getBoundingClientRect();
      var pw = pop.offsetWidth, ph = pop.offsetHeight;
      /* viewport-relative placement, then converted to document coords */
      var x = r.right + 12;                                  /* prefer right */
      var y = clamp(r.top, 8, Math.max(8, window.innerHeight - ph - 8));
      if (x + pw > window.innerWidth - 8) x = r.left - pw - 12;   /* flip left */
      if (x < 8) {                                           /* fall below */
        x = clamp(r.left, 8, Math.max(8, window.innerWidth - pw - 8));
        y = clamp(r.bottom + 12, 8, Math.max(8, window.innerHeight - ph - 8));
      }
      pop.style.left = Math.round(x + window.scrollX) + 'px';
      pop.style.top = Math.round(y + window.scrollY) + 'px';

      registerPopup(pop, cfgBtn, 'config');
      titleIn.focus();
      titleIn.select();
    }

    cfgBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var mine = currentPopup && currentPopup.kind === 'config' && currentPopup.owner === root;
      if (mine) { closePopup(); } else { openConfig(); }
    });
    ringBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      var mine = currentPopup && currentPopup.kind === 'well' && currentPopup.owner === root;
      if (mine) { closePopup(); } else { openColors(); }
    });

    /* --- responsive size classes --- */

    function applySize() {
      var w = root.clientWidth, h = root.clientHeight;
      if (!w) return;
      /* ONE width-threshold rule for every kind (SC2) — the dial's
         bespoke h<96 xs gate died with the shared h<52 floor below */
      var sz = (w < 96) ? 'xs' : (w < 168 ? 'sm' : (w < 264 ? 'md' : 'lg'));
      if (h < 52) sz = 'xs';
      /* speech-row room: the face carries its sentence only from two
         rows of height up (h≥2 → ~136px); below that the readout's
         named-value form is the hint (SC1/SC2) */
      root.classList.toggle('has-say-room', h >= 118);
      /* revise packs four zones (arcs / capsule / strictness chip) into
         its 2×1 minimum — collapse the head to the corner-dot treatment
         when short so the body + foot get the height (label → hover chip) */
      if (kind === 'revise' && h < 78) sz = 'xs';
      root.classList.remove('sz-xs', 'sz-sm', 'sz-md', 'sz-lg');
      root.classList.add('sz-' + sz);
      if (kind === 'dial') {
        /* square the knob into the free space */
        var bw = body.clientWidth, bh = body.clientHeight;
        var s = Math.max(24, Math.min(bw, bh));
        parts.svg.style.width = s + 'px';
        parts.svg.style.height = s + 'px';
      }
      /* named stops re-fit whenever the box changes */
      if (kind === 'range' || kind === 'filter') fitReadout();
      if (kind === 'dial' || kind === 'slider') fitScalarReadout();
      if (kind === 'slider') fitSliderEnds();
      if (kind === 'curve' && parts.fitCurveReadout) parts.fitCurveReadout();
      fitSpeech();
    }
    if (typeof ResizeObserver !== 'undefined') {
      var ro = new ResizeObserver(function () { applySize(); });
      ro.observe(root);
    }
    /* first paint */
    requestAnimationFrame(applySize);

    /* --- init --- */
    if (kind === 'dial') renderDialTicks();
    if (kind === 'slider' || kind === 'range') renderSliderDetents();
    if (kind === 'slider') renderSliderEnds();
    if (kind === 'pad') { renderPadSnaps(); renderPadEnds(); }
    render();

    /* --- public handle --- */
    var api = {
      el: root,
      node: node,                       /* primary jack (pad: X, mixer: first channel; select: null) */
      nodes: nodes,                     /* all named jacks (pad {x,y}; mixer per channel; select {}) */
      inputs: inputs,                   /* input jacks (curve: {position}); {} for kinds with none */
      kind: kind,
      minCells: kind === 'select'
        ? (cfg.options.length <= 4 ? { w: 2, h: 1 } : { w: 2, h: 2 })
        : kind === 'mixer'
        /* min-fader-width guard (05 §MIXER): 5–6 channels refuse 2-wide */
        ? (cfg.channels.length > 4 ? { w: 3, h: 2 } : { w: 2, h: 2 })
        : (MIN_CELLS[kind] || { w: 1, h: 1 }),
      get: function () { return getValue(); },
      set: function (v) { setValue(v, false); },
      openConfig: openConfig,
      openColors: openColors,
      applyConfig: applyConfig,
      closeConfig: closePopup,
      setConnected: function (on, jack) {
        if (jack && nodes[jack]) { nodes[jack].setConnected(on); return; }
        for (var k in nodes) nodes[k].setConnected(on);
      },
      /* the speech row (SC1/SC3): the host feeds the part's compiled
         sentence (or, ghost=true, the ink-faint sentence an OFF face
         WOULD say). The lib owns fit-or-shed. */
      setSpeech: function (text, ghost) {
        if (!speechEl) return;
        speechEl.textContent = text || '';
        speechEl.classList.toggle('is-ghost', !!ghost);
        fitSpeech();
      },
      config: configSnapshot
    };
    /* order: the jack's scalar — displacement from the authored order */
    if (kind === 'order') api.displacement = function () { return parts.displacement(); };
    /* curve: the POSITION input jack — the workbench feeds the wired
       position; the lib owns the hairline + the sampled emission */
    if (kind === 'curve') {
      api.setInput = function (name, v) { if (parts.setInput) parts.setInput(name, v); };
      api.position = function () { return parts.curvePosition ? parts.curvePosition() : null; };
      api.sampleAt = function (t) { return parts.sampleAt ? parts.sampleAt(t) : null; };
    }
    /* fork: the favored path index (−1 = even), for the workbench emission */
    if (kind === 'fork') api.favored = function () { return parts.forkFavored ? parts.forkFavored() : -1; };
    /* the execution-fidelity resolution, where a part carries it */
    if (fidelityOn) api.fidelity = function () { return cfg.fidelity; };
    return api;
  }

  /* ---------------- text-on-accent ---------------- */

  var INK = '#232019', PAPER = '#f8f6f1';

  /** ink on light accents, paper on dark ones (YIQ brightness, .55) */
  function inkFor(hex) {
    var h = String(hex || '').replace('#', '');
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var r = parseInt(h.slice(0, 2), 16);
    var g = parseInt(h.slice(2, 4), 16);
    var b = parseInt(h.slice(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return INK;
    var yiq = (r * 299 + g * 587 + b * 114) / 255000;
    return yiq >= 0.55 ? INK : PAPER;
  }

  /* ---------------- card (compiler prompt line) ---------------- */

  /** ModUI.card({title, value, sentence, meta, accent, silent,
        mark:'control'|'process'|'step'})
      → {el, setValue, setSentence}
      `mark` repeats the board class mark on the card eyebrow (grammar
      R8) so board, card, and plan speak the same class language. */
  function card(opts) {
    opts = opts || {};
    var accent = opts.accent || DEFAULT_ACCENT;
    var el = make('div', 'mui-card' + (opts.silent ? ' mui-card--silent' : ''));
    el.style.setProperty('--accent', accent);
    if (!opts.silent) el.style.color = inkFor(accent);

    var eyebrow = make('div', 'mui-card-eyebrow', el);
    if (opts.mark) make('span', 'mui-card-mark mui-card-mark--' + opts.mark, eyebrow);
    var titleEl = make('span', 'mui-card-title', eyebrow);
    titleEl.textContent = opts.title || '';
    var pill = null;
    if (opts.value != null) {
      pill = make('span', 'mui-card-pill', eyebrow);
      pill.textContent = String(opts.value);
    }
    var sentence = make('div', 'mui-card-sentence', el);
    sentence.textContent = opts.sentence || '';
    if (opts.meta) make('div', 'mui-card-meta', el).textContent = opts.meta;

    return {
      el: el,
      setValue: function (v) {
        if (!pill) pill = make('span', 'mui-card-pill', eyebrow);
        pill.textContent = String(v);
      },
      setSentence: function (t) { sentence.textContent = t; }
    };
  }

  /* ---------------- visualizer contract primitives ----------------
     A visualizer is a LENS, not a control: no identity dot, no accent
     of its own — every hue on it is inherited through wires. The lib
     owns the shell, the rail, and the write-back quantizer; the
     drawing inside the well is each visualizer's own. */

  /** ModUI.vizShell({title, well:true, question, onAdd, onMinus, onRemove})
      → {el, head, body, well, setTitle} */
  function vizShell(opts) {
    opts = opts || {};
    var el = make('div', 'mui-viz sz-md');
    var head = make('div', 'mui-viz-head', el);
    var title = make('span', 'mui-viz-title', head);
    title.textContent = opts.title || '';
    /* hover chrome, top-right: optional − / +, then × — one action
       cluster grammar shared with controls (R4.2) */
    var chrome = make('div', 'mui-chrome', el);
    function cbtn(glyph, label, fn, cls) {
      var b = make('button', 'mui-chrome-btn' + (cls ? ' ' + cls : ''), chrome);
      b.type = 'button';
      b.textContent = glyph;
      b.setAttribute('aria-label', label);
      b.title = label;
      b.addEventListener('click', function (e) { e.stopPropagation(); fn(api); });
      return b;
    }
    if (typeof opts.onMinus === 'function') cbtn('−', opts.minusLabel || 'remove input', opts.onMinus, 'mui-vz-minus');
    if (typeof opts.onAdd === 'function') cbtn('+', opts.addLabel || 'add input', opts.onAdd, 'mui-vz-add');
    if (typeof opts.onRemove === 'function') cbtn('×', 'remove', opts.onRemove, 'mui-vz-x');
    var body = make('div', 'mui-viz-body', el);
    var well = null;
    if (opts.well !== false) well = make('div', 'mui-viz-well', body);
    /* the question line — every visualizer declares its one-line job */
    if (opts.question) el.title = opts.question;

    function applySize() {
      var w = el.clientWidth;
      if (!w) return;
      var sz = w < 96 ? 'xs' : w < 168 ? 'sm' : w < 264 ? 'md' : 'lg';
      el.classList.remove('sz-xs', 'sz-sm', 'sz-md', 'sz-lg');
      el.classList.add('sz-' + sz);
    }
    if (typeof ResizeObserver !== 'undefined') {
      new ResizeObserver(applySize).observe(el);
    }
    requestAnimationFrame(applySize);

    var api = {
      el: el,
      head: head,
      body: body,
      well: well,
      setTitle: function (t) { title.textContent = t; }
    };
    return api;
  }

  /** ModUI.rail({edge:'left'|'top'|'right',
                  mode:'fixed-labeled'|'variable-inheriting'|'fixed-inheriting',
                  min, slots, onChange})
      → {el, addSlot, removeSlot, update, slots}

      Slot record: {name, get, set?, rest, accent, labelMode?, type?}
      - name/accent may be values or functions (inheriting modes re-read
        them on update()); a slot is UNWIRED when get() returns null.
      - `set` present ⇒ two-way capable; absent ⇒ never writes.
      - unwired slots render faint ink, never accent.
      - variable mode: per-slot × on hover; removeSlot() takes the last
        unwired slot first, then the last, and refuses below `min`. */
  function rail(opts) {
    opts = opts || {};
    var edge = opts.edge === 'top' || opts.edge === 'right' ? opts.edge : 'left';
    var mode = opts.mode || 'fixed-labeled';
    var el = make('div', 'mui-rail mui-rail--' + edge + ' mui-rail--' + mode);
    var entries = [];
    var min = opts.min != null ? (opts.min | 0) : 0;
    var onChange = typeof opts.onChange === 'function' ? opts.onChange : null;

    function val(v) { return typeof v === 'function' ? v() : v; }
    function wired(s) {
      var v = s.get ? s.get() : null;
      return v !== null && v !== undefined;
    }
    function updateEntry(en) {
      var s = en.slot;
      var name = val(s.name) || '';
      var isw = wired(s);
      en.dot.setLabel(name);
      en.dot.setType(s.type || 'scalar');
      en.dot.setConnected(isw);
      var acc = val(s.accent);
      if (isw && acc) en.dot.style.setProperty('--accent', acc);
      else en.dot.style.removeProperty('--accent');
      en.row.classList.toggle('is-unwired', !isw);
      if (en.lbl) en.lbl.textContent = name;
    }
    function addSlot(slot) {
      var row = make('div', 'mui-rail-slot', el);
      var chipSide = edge === 'right' ? 'left' : edge === 'top' ? 'below' : 'right';
      /* every rail slot is an input — it wears the inward chevron (R1.2) */
      var dot = nodeDot({ label: '', chipSide: chipSide, type: slot.type || 'scalar', dir: 'in' });
      row.appendChild(dot);
      var lbl = null;
      var lm = slot.labelMode || (mode === 'fixed-labeled' ? 'fixed' : 'chip');
      if (lm === 'fixed') lbl = make('span', 'mui-rail-lbl', row);
      if (mode === 'variable-inheriting') {
        var x = make('button', 'mui-rail-x', row);
        x.type = 'button';
        x.textContent = '×';
        x.setAttribute('aria-label', 'remove input');
        x.addEventListener('click', function (e) {
          e.stopPropagation();
          removeEntry(entries.filter(function (en) { return en.slot === slot; })[0]);
        });
      }
      var entry = { slot: slot, row: row, dot: dot, lbl: lbl };
      entries.push(entry);
      updateEntry(entry);
      if (onChange) onChange();
      return dot;
    }
    function removeEntry(en) {
      if (!en || entries.length <= min) return null;
      entries.splice(entries.indexOf(en), 1);
      if (en.row.parentNode) en.row.parentNode.removeChild(en.row);
      if (onChange) onChange();
      return en.slot;
    }
    function removeSlot() {
      if (entries.length <= min) return null;
      var en = null;
      for (var i = entries.length - 1; i >= 0; i--) {
        if (!wired(entries[i].slot)) { en = entries[i]; break; }
      }
      return removeEntry(en || entries[entries.length - 1]);
    }
    (opts.slots || []).forEach(addSlot);
    return {
      el: el,
      addSlot: addSlot,
      removeSlot: removeSlot,
      update: function () { entries.forEach(updateEntry); },
      slots: function () {
        return entries.map(function (en) { return en.slot; });
      }
    };
  }

  /** Write-back quantization: all viz writes go slot.set → control.set();
      the control's value is the only state. Per kind: count → integers,
      stepped → steps, switch → threshold. `words` returns null — refuse
      that wire at CONNECT time, not mid-gesture. */
  function quantize(v, meta) {
    meta = meta || {};
    if (meta.kind === 'words') return null;
    if (meta.kind === 'switch') return clamp100(v) >= 50 ? 100 : 0;
    if (meta.kind === 'count') return Math.round(clamp100(v));
    return snapValue(v, meta.steps | 0);
  }

  /* ---------------- fidelity chip (standalone) ----------------
     The reusable foot chip that carries execution fidelity —
     ONE PASS · IN STAGES · AUTO — cycling on click. Controls opt in via
     control({fidelity:true}); this freestanding form is for the step
     shell and any workbench body that carries fidelity of its own. The
     mod-level FAST◄──►PRECISE lever that resolves AUTO is workbench-side. */
  /** ModUI.fidelityChip({value, onChange}) → {el, get, set} */
  function fidelityChip(opts) {
    opts = opts || {};
    var val = FIDELITY.indexOf(opts.value) >= 0 ? opts.value : 'auto';
    var b = makeFootChip(FIDELITY, FIDELITY_WORDS, val,
      function (v) { val = v; if (opts.onChange) opts.onChange(v); }, 'mui-fidelity-chip');
    return {
      el: b,
      get: function () { return val; },
      set: function (v) { b.setValue(v); val = b.value; }
    };
  }

  /* ---------------- step shell (transformer body) ----------------
     A step is the transformer's board body — a verb-module (EXPLORE,
     CLUSTER, CRITIQUE, …) that takes work in and puts transformed work
     out. It is the third UI class (control / visualizer / step). The lib
     ships the ANATOMY — verb title + identity dot, prose body, artifact-in
     ▣ (left) / artifact-out ▣ (right) in the SECOND cable family (square,
     non-mating with signal jacks), signal inputs below artifact-in, and
     the fidelity foot chip. The verb registry, per-verb signals, and
     artifact CONTENTS are engine-surface / workbench-owned. */
  /** ModUI.stepShell({verb, accent, prose, artifactIn, artifactOut,
        inLabel, outLabel, signals:[{label,accent,type}], fidelity,
        onFidelity, onRemove, question})
      → {el, node (artifact out), inNode (artifact in), signals:[dots],
         setProse, setVerb, fidelity} */
  function stepShell(opts) {
    opts = opts || {};
    var accent = opts.accent || DEFAULT_ACCENT;
    var el = make('div', 'mui-step sz-md');
    el.style.setProperty('--accent', accent);
    el.setAttribute('data-kind', 'step');

    var head = make('div', 'mui-head', el);
    var dot = make('span', 'mui-step-dot', head);   /* identity, always visible */
    var label = make('div', 'mui-label', head);
    label.textContent = String(opts.verb || 'STEP').toUpperCase();

    var chrome = make('div', 'mui-chrome', el);
    /* the gear opens the host's step settings (05 §STEPS: prose + RUNS)
       — steps stopped being the gearless class */
    if (typeof opts.onConfig === 'function') {
      var cfgB = make('button', 'mui-chrome-btn mui-cfg-btn', chrome);
      cfgB.type = 'button';
      cfgB.setAttribute('aria-label', 'Configure ' + (opts.verb || 'step'));
      cfgB.innerHTML =
        '<svg viewBox="0 0 14 14" width="11" height="11" aria-hidden="true">' +
        '<path d="M2.2 4.6h9.6M2.2 9.4h9.6" stroke="currentColor" stroke-width="1.1"' +
        ' stroke-linecap="round" fill="none"/>' +
        '<circle cx="9.1" cy="4.6" r="1.7" fill="var(--mui-panel)"' +
        ' stroke="currentColor" stroke-width="1.1"/>' +
        '<circle cx="4.9" cy="9.4" r="1.7" fill="var(--mui-panel)"' +
        ' stroke="currentColor" stroke-width="1.1"/></svg>';
      cfgB.addEventListener('click', function (e) {
        e.stopPropagation();
        opts.onConfig(shell, cfgB);
      });
    }
    if (typeof opts.onRemove === 'function') {
      var rm = make('button', 'mui-chrome-btn mui-remove-btn', chrome);
      rm.type = 'button'; rm.textContent = '×';
      rm.setAttribute('aria-label', 'remove step');
      rm.addEventListener('click', function (e) { e.stopPropagation(); opts.onRemove(shell); });
    }
    /* permanent 9px port labels — the three-port legend IS the labels
       (05 §STEPS): IN, OUT, and each tune-in's name on the face */
    function portLbl(nd, text, side) {
      var s = make('span', 'mui-node-microlbl' +
        (side === 'left' ? ' mui-node-microlbl--left' : ''), nd);
      s.textContent = text;
      return s;
    }

    var body = make('div', 'mui-step-body', el);
    var prose = make('div', 'mui-step-prose', body);
    prose.textContent = opts.prose || '';

    /* artifact jacks — the SECOND cable family (square ▣). In on the
       left, out on the right (the output-jack overhang). */
    var inNode = null, outNode = null;
    if (opts.artifactIn !== false) {
      inNode = buildNode(opts.inLabel || 'takes the work in', false, 'artifact', 'in');
      inNode.classList.add('mui-step-in');
      portLbl(inNode, 'IN');
      el.appendChild(inNode);
    }
    if (opts.artifactOut !== false) {
      outNode = buildNode(opts.outLabel || 'hands the work on', false, 'artifact', 'out');
      outNode.classList.add('mui-step-out');
      portLbl(outNode, 'OUT', 'left');
      el.appendChild(outNode);
    }

    /* signal inputs — ordinary scalar jacks below artifact-in (a curve's
       NOW-sampled value, a dial into breadth, …): modulation */
    var sigWrap = make('div', 'mui-step-signals', el);
    var sigDots = [];
    (opts.signals || []).forEach(function (s) {
      var nd = buildNode(s.label || '', false, s.type || 'scalar', 'in');
      nd.classList.add('mui-step-signal');
      if (s.accent) nd.style.setProperty('--accent', s.accent);
      portLbl(nd, s.label || '');
      sigWrap.appendChild(nd);
      sigDots.push(nd);
    });

    /* the foot is a RUNS VALUE CHIP (05 §STEPS): the RESOLVED
       destination, live from the host's resolver — "did my chain
       collapse?" answered on the face. The RUNS *setting* moved into
       the settings popover; fidelity state lives here. */
    var fid = typeof opts.fidelity === 'string' ? opts.fidelity : 'auto';
    var runsChip = null;
    if (opts.fidelity) {
      var foot = make('div', 'mui-foot mui-step-foot', el);
      runsChip = make('span', 'mui-chip-value mui-step-runs', foot);
    }
    if (opts.question) el.title = opts.question;

    var shell = {
      el: el,
      node: outNode,                    /* the artifact output jack */
      inNode: inNode,                   /* the artifact input jack */
      signals: sigDots,
      minCells: { w: 3, h: 2 },
      setProse: function (t) { prose.textContent = t; },
      setVerb: function (t) { label.textContent = String(t).toUpperCase(); },
      fidelity: function () { return fid; },
      setFidelity: function (v) {
        if (FIDELITY.indexOf(v) < 0) return;
        fid = v;
        if (opts.onFidelity) opts.onFidelity(v);
      },
      setRuns: function (t) { if (runsChip) runsChip.textContent = t || ''; }
    };
    return shell;
  }

  /* ---------------- export ---------------- */

  global.ModUI = {
    control: control,
    nodeDot: nodeDot,
    card: card,
    vizShell: vizShell,
    rail: rail,
    quantize: quantize,
    inkFor: inkFor,
    fidelityChip: fidelityChip,
    stepShell: stepShell,
    closeConfig: closePopup,
    PRESETS: PRESETS.slice(),
    DEFAULT_ACCENT: DEFAULT_ACCENT
  };

})(typeof window !== 'undefined' ? window : this);
