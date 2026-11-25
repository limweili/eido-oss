# Round 4 synthesis — SPEC 03 decisions (design lead)

Source reports: explore-controls.md, explore-curves.md, explore-visualizers.md,
explore-branching.md (same directory). This doc is the arbitration — where
reports collide, THIS wins.

## D1. The signal model (arbitration of controls-vs-curves collision)

The controls report says "every cable is a span [lo,hi]"; the curves report
adds a SERIES [(t,v)]. Unified: a cable payload has ONE of three shapes, with
a TOTAL coercion matrix — every cable always plugs, no typed-jack errors:

| from \ into | scalar slot | span slot | series slot |
| --- | --- | --- | --- |
| scalar | as-is | zero-width span | flat line |
| span [lo,hi] | center | as-is | flat band (two flat lines / band) |
| series [(t,v)] | sampled at "now" | min/max envelope of the series | as-is |

- "now" = the board's shared rAF clock sweeping 0→100 ambiently (~5s period);
  scrub gesture (horizontal drag on a curve face, not on a point) broadcasts
  a momentary "now" board-wide; release resumes ambient. NO playhead object,
  no transport UI, nothing about "now" ever reaches the compiler.
- Input dot glyphs: scalar = filled dot (today); span = dot stretched to a
  small capsule; series = tiny 3-segment polyline in the ring. Same at output
  jacks so a cable's type is legible at both ends.

## D2. New controls (lib citizens, ModUI.control kinds)

1. `pad` — XY. Per controls report §1 in full: recessed dot-grid well,
   crosshair hairlines, round ink handle (accent while dragging), drag trail
   (3-4 ghost dots, gone in t-move, cut under reduced motion), axis-end names
   micro caps (never rotated), no quadrant labels. ONE identity/accent; axes
   are sublabels. TWO scalar jacks right edge (Y top-right of well, X at
   vertical center), hover-chip axis names. Emits two sentences / two cards
   ("TONE · WARMTH"). Config: shared title+desc, two axis blocks (axis title,
   low/high end names, steps OFF/2-10). Min footprint 2×2 — first control
   that refuses a size; palette/resize enforce. Stepped axes: snap dots as
   slightly larger darker dots REPLACING texture dots (one field, two
   weights).
2. `range` — two-handle slider. Two ink handles, accent band between (flat
   both ends, tucked under handles — SPEC 02 fill rule extended). Band-drag
   slides whole window (width preserved). Readout `30–70`. Emits ONE
   constraint sentence; default-addresses Boundaries.
3. `filter` — hero face sibling of range, same value [lo,hi]+mode. Modes in
   plain words: NO MORE THAN [0,hi] / AT LEAST [lo,100] / BETWEEN [lo,hi].
   Face = 2px ink shelf/roll-off curve over dot-grid, accent wash under the
   pass region. Drag roll-off edges horizontally; BETWEEN plateau drag slides
   window. Mode chip micro-caps at foot, click cycles. Named stops speak
   ("no longer than a paragraph"). Min 2×1, ideal 2×2. AVOID/notch mode CUT.
4. `curve` — series control. Per curves report §4: recessed well, 2.4px
   accent line, round ink point handles (accent while dragging), click empty
   face = add point, drag point (endpoints y-only), dblclick deletes
   (endpoints refuse), 2–5 points. X snaps to 5 speakable detents
   (start/quarter/midway/three-quarters/end, dot detents in the well);
   shift-drag free. Y inherits steps config. Readout "MID 90" style + point
   count. Config: title, desc, timebase dropdown (the answer / the steps of
   the task / each item in the list), y-steps. Min 4×2. v1 linear,
   output-only (one series jack).

REJECTED (do not build): range dial, in-line cable processors, pair-valued
(x,y) cables, joint two-slot pad frames, playhead object, per-point compiler
cards, separate envelope/LFO/sequencer kinds.
DEFERRED to v2 (record in DESIGN.md backlog, do not build): `bound` wire
(range→control paints band, never clamps), curve GAIN input jack
(ghost-authored + solid-effective face), segment curvature, renamable
x-detents, conversation timebase, composite-voice wire.

## D3. Multi-jack primitive

A control may expose N NAMED jacks (pad=2). Each is an ordinary scalar jack
downstream. Jack identity = axis sublabel + control accent. Lib owns
rendering + hover chips; workbench owns wiring.

## D4. The visualizer contract (lib-owned)

Adopt the visualizer report's SYSTEM PASS §1–8 verbatim as spec:
1. Viz shell: panel chip, head bar (micro-caps title left; hover chrome
   right: optional +/−, then ×), optional recessed well (opt-out), per-kind
   min size. **Visualizers have NO accent of their own — no identity dot;
   every hue inherited through wires.** That's what says "lens, not control".
2. Slot record `{name, get, set?, rest, accent, labelMode}`; rest values
   render faint ink; `set` present = two-way capable.
3. Slot modes (three, sanctioned): fixed-labeled (wave), variable-inheriting
   (radar: +/−, min count, − removes last-unwired-first), fixed-inheriting
   (beam/readout).
4. Input RAIL primitive: `rail({edge: left|top|right, mode, min, slots})` —
   straddling dots, hover chips, per-slot × in variable mode. Matrix uses
   left+top; beam uses left+right.
5. Growth grammars: +/− head chrome for one-axis growth; ghost row/col for
   two-axis (matrix). Never both on one viz.
6. Write-back: all writes via slot.set → control.set(); control value is the
   ONLY state; per-kind quantization (count→int, stepped→steps,
   switch→threshold, words→refuse at connect); wired control visibly moves
   during viz gestures.
7. Motion charter: draw(state,t) pure; shared rAF clock; reduced-motion
   freezes t + kills transforms; idle motion MUST be owned by a wired slot
   (wave SPEED, constellation DRIFT); unowned shimmer banned;
   change-transitions on lib tokens always allowed.
8. Every visualizer declares a one-line question (palette tooltip). No two
   answer the same question.

## D5. New visualizers (workbench, all 8 — user said exhaust the options)

Build per the visualizer report spec sheets, order: LEVELS → MATRIX →
LIGHT GRID → READOUT(+pair variant) → BANDINGS → CONSTELLATION → BEAM →
BRANCHES (branching report, FULL version not the fan fallback).
Key locked details:
- LEVELS: variable-inheriting bars, 10 segments/bar (the spoken "N of 10"
  made visible), falling peak tick (~1.5s hold), one-way, min 3×3, readout
  row drops first under sm.
- MATRIX: outer-product lens, cell = √(row·col), dot wears ROW (source)
  accent; dual rails left+top; ghost row/col growth (no +/−); one-way; min
  4×3; zero cell = --mui-dot speck; never rotate labels.
- LIGHT GRID: variable-inheriting lanes, ALWAYS 10 LEDs/lane (semantic),
  circles not squares, rows-or-columns flip in config (presentation only),
  TWO-WAY paint gesture with 12ms/cell stagger, fractional LED via color-mix
  saturation, min 3×2.
- READOUT: fixed-inheriting 1 slot (pair variant 2, capped), digits scale to
  well, TWO-WAY vertical drag (dial mechanics), odometer roll on change,
  min 2×2 (pair 2×3), unwired shows `--`.
- BANDINGS: variable-inheriting strata, thickness = share-of-whole
  (normalized), shade DERIVED from accent by rank (color-mix 30-60%, never
  hand-picked), zero band = 2px hairline seam, one-way, min 3×2.
- CONSTELLATION: nodes on fixed compass bearings, distance = value, edge
  opacity = 1−|vi−vj| agreement; variable-inheriting min 3 + ONE fixed
  labeled slot DRIFT owning idle wobble (unwired = static); one-way (radar
  owns steering); min 4×4.
- BEAM: fixed-2 inheriting, left+right edge dots, tilt + ratio marker,
  COUPLED two-way (one drag writes both, both controls visibly move) —
  flagged experiment, demote to one-way only if it feels wrong in hand.
- BRANCHES: per branching report in full — 5 fixed labeled dots (BREADTH/
  DEPTH/PRUNE/WANDER/COMMIT), root-left→leaves-right, depth rules, taper,
  cut ticks, ghost dot-trail rollouts breathing ~4s phase-offset, ONE reward
  bead leaf→root per ~6s cycle, COMMIT brings the accent (all-ink at 0,
  winning path colors/thickens as it rises, losers fade), accent from
  COMMIT's wire. Structure-vs-modulation determinism (mulberry32 keyed on
  structural indices only; drags morph, never reshuffle; breadth/depth
  grow/retract with drawn-length interpolation). SILENT — no emitter.
  Footprint 7×4, min 4×3. Clamp ~40 segments; winner always survives.
- Rejected: meter bridge, per-cell-input matrix, two-way constellation,
  composite voice.

## D6. Emission additions (workbench compiler)

- Range/filter: one sentence, mode-worded ("no more than {hi}" / "at least
  {lo}" / "between {lo} and {hi}"), named stops when defined; card pill
  `30–70` or named `SHORT–MEDIUM`; default section = a Boundaries-like
  section (workbench sections are user-defined — route to the seeded RULES
  section, and make kind→default-section a small registry).
- Pad: two cards, eyebrows "TITLE · AXIS", per-axis frames, slider fallback.
- Curve: ONE card. Speller: map t to timebase scaffold words, speak v as
  "N of 10" + coarse qualitative word, collapse near-equal adjacent points
  ("hold at 9 of 10 through the middle"). Card pill = "3PT ↥90" (count +
  peak). Flat-at-default curve is NOT silent. Fallback sentence: "Warmth over
  the answer: open at 2 of 10, build to 9 of 10 by the middle, settle at 4 of
  10 by the end."

## D7. EXPLORER preset

Palette gains a MODS section with one entry: EXPLORER — drops BRANCHES
pre-wired to five dials (BREADTH/DEPTH/PRUNE/WANDER/COMMIT) with the
pre-authored per-band frames from the branching report §4, all addressed to
the seeded "HOW TO APPROACH IT"-like section (use existing seeded sections;
if none fits, the preset creates its own section "APPROACH").

## D8. Scope split

- LIB (first): D1 glyphs + coercion doc, D2 four control kinds, D3
  multi-jack, D4 contract primitives (shell, slot, rail, write-back helper,
  motion charter), gallery specimens for all new kinds + rail/shell, DESIGN
  .md = SPEC 03. Workbench-agnostic.
- WORKBENCH (second, two waves): wave A = signal payloads + coercion +
  ambient clock/scrub + palette + LEVELS/MATRIX/LIGHT GRID/READOUT + pad/
  range/filter/curve as board items + emission (D6). Wave B = BANDINGS/
  CONSTELLATION/BEAM/BRANCHES + EXPLORER preset + wave-breathes-through-
  envelope (series→scalar at wave inputs) + full re-verify.
- Wave/radar refactor onto the contract: allowed but NOT required; do not
  regress them. If refactoring is cheap and de-risks, do it in wave A.

## D9. Cap arbitration (added after explore-visualizers-2.md, weili's 10-max rule)

weili capped the set at 10 visualizers total. The 2 existing + his 5 named
picks (LEVELS, LIGHT GRID, BANDINGS, MATRIX, BRANCHES) all survive, leaving
3 slots for invented lenses out of 6 contenders:

- IN: **SCORE** (what happens when — the time-lane payoff of the curve
  work), **WINDOW** (what's still allowed — the span payoff of the filter
  work; contradiction seam is the reserved yellow's first honest job),
  **CONSTELLATION** (coherent or scattered — the ref-13 charm).
- CUT: **READOUT** (thinnest question; belongs to the Simple face, which
  this prototype doesn't carry — deferred, not killed), **BEAM** (the XY
  pad's own face shows a two-quality lean), **STEPS** (curve face + its
  compiler card already tell the spoken-quantization story; the
  drawn-vs-said gap alone doesn't earn a slot).

Final 10: wave, radar, LEVELS, MATRIX, LIGHT GRID, BANDINGS, CONSTELLATION,
BRANCHES, WINDOW, SCORE.
