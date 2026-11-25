# Mod instrument redesign — session record (2026-07-14, updated 2026-07-16)

## 2026-07-16 update 6 — round 5 (expansion: speech, packs, process)

Cap on visualizers REMOVED mid-round (weili); roster settled at 14
(10 + READOUT + BEAM restored + STEPS on merit + TRIM new). Round 5 is a
SPEECH + PROCESS round, not a picture round.

Explorations (all in docs/design/explorations/mod-redesign-round5/):
packs (6 preset instruments), primitives (ORDER/MIXER/SELECT/GROUP
VOICE), controllers (envelope/routing/feedback → shapers/transformers/
controllers taxonomy), third visualizer pass (TRIM + STEPS). Synthesis
arbitrates; two orthogonal axes (UI kind × execution tier), everything
today a SHAPER.

Wave 1 (lib SPEC 04): SELECT (jackless), ORDER (drag-to-rank, Kendall-tau
displacement jack), MIXER (N faders summing exactly 100, variable
multi-jack), named-stops rider (dissolves Blend). 47/47 + independent 7/7,
mixer sum-100 confirmed across a drag sweep.

Wave 2 (workbench): three speech controls on the board; GROUP VOICE
(fuses members into one authored sentence, members don't self-emit, a
muted member mutes the sentence, tooltip underlines each member's part);
READOUT(+pair)/BEAM/TRIM visualizers; six packs (NARRATOR/EDITOR/SKEPTIC/
STORYTELLER/TRANSLATOR/ANCHOR) + EXPLORER preset chips. ANCHOR shipped
(DRIFT←STRAY earns it); BEAM kept coupled-two-way. 155 checks + my
independent GROUP-VOICE fusion + pack-drop + TRIM verification.

Wave 3 (process axis) — SHIPPED. 3a (lib SPEC 05): curve POSITION input
jack (first control-input seam) + renamable stage detents; FORK + REVISE
on one check-block anatomy; fidelity chip (ONE PASS/IN STAGES/AUTO);
square artifact jack glyph + ModUI.stepShell (second cable family). 3b
(workbench): palette CONTROLS/PROCESS/STEPS/VISUALIZERS/MODS; STAGE +
curve POSITION wiring (emission flips to sampled-now form); FORK/REVISE
cards; mod-head FAST◄──►PRECISE lever resolving AUTO; 7 step verb-modules
(EXPLORE…COMBINE) chained by artifact cables that refuse to mate with
signal jacks; THE PLAN strip (N-call executed-envelope simulation,
IN-STAGES only); SCORE POSITION cursor; STEPS visualizer (roster now 15).
Engine-surface (run plan, real execution) recorded in
docs/design/mods/engine-surface-boundary.md, NOT built (skin-over-
machinery boundary). 3a 181 checks, 3b 185 checks; independent verify
10/10 each.

Two working copies kept in sync: research/.../prototypes (../lib/) and
docs/design/prototypes (lib/) — the tracked snapshot; both SPEC 05,
runnable standalone.

## 2026-07-15 (updated 2026-07-16) — earlier rounds below

## 2026-07-15 update 5 — round 3 polish

weili: compiler drag weight "feels good" (motion language validated in hand).
Four fixes, all independently verified (11/11 Playwright checks):

28. **Typeface is JetBrains Mono** (weili's pick), embedded as base64 woff2
    data URIs in `lib/mod-ui-font.css` (400/500/700, OFL, file://-safe);
    `--mui-mono` token lists it first with the system-mono stack as
    fallback. Tracking tightened for the wider face (0.12→0.09em,
    0.18→0.14em).
29. **Dot/title alignment is structural**: identity dot and label live in
    one `.mui-head` flex row (`align-items:center`) — centers align by
    construction, never by absolute offsets.
30. **Icon glyphs match by eye, not by box**: the settings glyph slimmed
    (11px, lighter stroke) to the ×'s optical weight; both keep the 19×19
    hit target.
31. **Board overlap is unreachable**: dashboard-style push-down with
    preview-from-home, commit-on-drop, no gravity (whitespace is
    compositional). Neighbors re-resolve live from their pre-gesture
    homes — dragging back lets them flow home. Applies to drag, resize,
    and palette drops; displaced items glide on the motion tokens; cables
    stay glued (rAF re-render, drift <1.5px). **Dwell gate (weili round
    3b)**: displacement registers only after the same push outcome holds
    500ms (weili tuned up from 300) — fast fly-overs move nothing; free
    cells snap instantly;
    once registered it holds (no flicker); a drop before the dwell still
    resolves the push at drop, so overlap stays unreachable. Resize
    pushes immediately (deliberate claim, no fly-over path).
32. **Board drag floats like the compiler drag**: pickup lifts the item
    (.mui-lifted) and it rides the pointer continuously off-grid; a
    dashed full-footprint ghost snaps cell-to-cell marking the landing
    spot; release glides the item into the cell on the settle curve.
    All push/dwell logic keys off the ghost's candidate cell; cables
    follow the floating jack. Reduced motion = direct snap as before.

## 2026-07-15 update 4 — SPEC 02: the details round

weili's verdict on SPEC 01: "80% there — the little details matter." The round
was run system-first (lib/DESIGN.md is the spec of record) and independently
validated with Playwright (19/19 substantive checks). New system rules, all
in `lib/DESIGN.md`:

21. **Radius two-tier rule**: surfaces slightly-squared (cards/controls 7px,
    chips/buttons/fields 6px, wells 10px); instruments (tracks, handles,
    jacks, dots) stay fully round.
22. **One button standard** (`.mui-btn`): 6px rounded-rect, variants
    primary/icon/sm. No pills, no ad-hoc buttons.
23. **Identity vs chrome**: the accent dot is IDENTITY — persistent, solid,
    top-left (like an Eido card's color); it opens the color well directly.
    Actions (settings glyph, ×) are CHROME — hover-revealed, top-right.
24. **State changes color, never geometry**: one field style for all text
    inputs (6px, accent border on focus, no default outline); edit-in-place
    keeps a card's exact fill/radius/size (contenteditable sentence).
25. **Motion language**: tokens (120ms fast / 220ms move, settle curve with
    slight overshoot), `.mui-lifted` + the ONE sanctioned shadow; FLIP is
    the displacement technique. Compiler drag is pointer-based (no native
    DnD): pickup lifts, siblings open a real gap, drop settles.
26. **Cards are solid**: `ModUI.card` — accent fill, ink/paper by luminance
    (`ModUI.inkFor`), anatomy = eyebrow (title) + value pill / sentence /
    quiet meta (description). Silent = wash variant.
27. **Progressive disclosure**: no instructional copy anywhere; ghost
    affordances are full-size ghosts of what they create (+ SECTION is a
    ghost column); slider fill is one continuous body ending flat under the
    handle; radar has − (removes last unwired axis first, min 3) and
    unwired axes render no tip label.

## 2026-07-15 update 3 — component library + workbench v2 (prototype 05)

Built by two reviewed subagents against three new references (09 Nothing EQ
advanced light = base calm, 10 TE×IKEA Frekvens poster = dot-matrix/graphic
seasoning, 08 plugin = warmth; 11 = weili's wire-interaction sketch, look
explicitly not prescribed by it).

- **`lib/`** — the standalone component library, the foundation everything
  builds on now: `DESIGN.md` (token spec), `mod-ui.css`, `mod-ui.js`
  (global `ModUI`, file://-safe), `gallery.html` (specimen page). Controls:
  dial/slider/switch/count/words, uniform factory, per-control accent
  (8 card-palette presets), title, description, steps (config popup),
  output node with hover label chip, size-adaptive down to 1×1.
  30/30 headless checks.
- **`prototypes/mod-workbench-v2.html`** — supersedes prototype 04:
  patch-cable wiring (drag from a control's output jack into a visualizer
  input dot; cables in the source accent; click a connected dot to unplug,
  drag to re-route), wave with a labeled 6-dot left input column
  (HEIGHT/SPEED/RIPPLE/STEADY/GRID/WAVES — labels name parameters, cables
  carry connections), radar with variable axes (+ POINT, min 3, remove on
  hover), axis tips inheriting connected control titles live, two-way
  vertices, compiler carrying descriptions (chip subtext + own sentence in
  the assembled text). 23/23 headless checks.
- CSS gotcha worth remembering: custom properties resolve `var()` at the
  scope where they are DECLARED — accent-derived tints must be declared
  wherever the instance `--accent` lands, never on `:root`.

**New decisions (2026-07-15, round 2):**

18. Design language v2 = blend of refs 09+10+08: three-step warm gray
    surfaces, ink structure, system red reserved for system signals,
    dot-matrix as the recurring texture, capsule tracks with in-track
    detents, pill readouts, mono caps, no control-kind sub-labels anywhere.
19. Wiring is patch cables: output jack on every control (right edge),
    input dots on visualizers (left column); no "connected to X" text —
    the cable is the information; labels appear on hover chips.
20. Wave inputs fixed at 6 (named parameters); radar axes variable and
    label-inheriting. Controls are configured via a per-control popup:
    title, description (feeds the compiler), steps (interval snapping),
    accent from an 8-swatch card-palette well.

## 2026-07-15 update 2 — the workbench (prototype 04)

**`prototypes/mod-builder-workbench.html`** — standalone file, open directly
in a browser (deliberately NOT a claude.ai artifact, per weili). The full
builder loop in one page:

- Board: drag controls/visualizers from a palette, snap to a 72px grid,
  move by title bar, resize by corner, overlap allowed.
- Controls: dial, slider, switch, count, words. Double-click a label to
  rename; labels feed the compiler.
- Visualizers with **jacks**: click ◇ to wire any control into an input.
  Semantic wave has 6 (height/speed/ripple/steady/grid + WAVES = how many
  echo waves, e.g. wired to an examples count). Radar has 5 axes, takes its
  labels from the wired controls, and **writes back** (drag its points).
- Compiler: sections are **fully user-defined** (rename/add/reorder/delete),
  lines drag between sections, click a line to edit its sentence
  (`{value}` slot), + TEXT for free lines, VIEW AS TEXT for the assembled
  prompt.

**New decisions from weili's feedback (2026-07-15):**

12. Values are **percent points** everywhere (0–100%), not 0–10.
13. Knob design: **minimal** — solid dark core, light needle, one value
    arc, % readout. Not the detent-ring dial from prototypes 01–03.
14. The fixed four sections (Background/Boundaries/Approach/Answer) are
    **too restrictive for creators** — sections are user-defined in the
    builder. (Engine mapping TBD: user sections could compile into the four
    engine targets or replace them — open thread.)
15. Semantic wave is the favorite visualizer; its echo-wave count is a
    wireable input (anything count-like).
16. Instruction capsule: **concept liked, visualizer disliked** — keep the
    completeness idea, find a different picture.
17. Radar (tone-of-voice, from prototype 02) joins the visualizer set,
    two-way as before.

## 2026-07-15 update — interconnection + visualizers

- New reference `references/08-delay-reverb-module-grid.png` (a delay/reverb
  plugin): the model for module anatomy, size-as-hierarchy, spatial wiring
  (the SEND slider between modules), and gating shown by dimming. Full
  breakdown in `references/README.md`.
- **Prototype 03** — `prototypes/mod-instrument-grid.html` — the Capsule
  language evolved into an interconnected instrument grid ("WRITE-UP" mod):
  VOICE module (semantic-wave visualizer + dials that draw their own value),
  AUDIENCE patch-bay strip (a select wire feeding both modules), SHAPE module
  (instruction-capsule visualizer, length range, format, sections), MASTER
  (intensity, formed-% meter, folded instruction drawer).
  Live: https://claude.ai/code/artifact/20917d15-7a62-4132-9c92-85d3f49f97f9
- New engine concept (weili's design brief, now in `mod-prompt-engine.md` →
  "Visualizers — the intermediary"): the live experience is **shaping, not
  generation**; the prompt is a compilation artifact, folded away by default
  (transparency demoted, not broken); visualizers are deterministic, 60fps,
  drawn only from control state; two families — **oscilloscope** (semantic
  wave) and **capsule** (instruction completeness as one evolving object);
  controls carry their own picture in their face.
- Implicit direction: weili asked for tweaks to **the Capsule variant**
  specifically — treat Capsule as the leading design-language candidate.

Working folder for the Mod system UI redesign effort. Pick-up point for the
next session. Everything here is also merged into the repo under
`docs/design/` (PR #411); this folder is the local research copy.

## What this effort is

Redesign the Mod system UI: a new design language ("instrument-flat", a
variation of the Nothing Phone EQ — see `references/`), a templatized control
kit inspired by Toolcraft's patterns (clean-room, license forbids code reuse),
and a drag-and-drop WYSIWYG mod builder. Destination: a **build-ready PRD**
that goes into epic-orchestration. Wayfinder map drafted but **deliberately
not published yet** — weili wants the prototypes to settle first so the map
reflects the final direction.

## Live artifacts (claude.ai, interactive)

- Prototype 01 — design language, full control catalog, 3 variants:
  https://claude.ai/code/artifact/8a183894-24b9-4831-ac66-a13ddb9a5628
- Prototype 02 — the prompt engine (radar face, presets, creating/using,
  wiring): https://claude.ai/code/artifact/f5d2b53c-1977-4763-8afd-3e818197881d

Sources: `prototypes/`. Engine write-up: `mod-prompt-engine.md`.

## Decisions locked so far

1. Destination = build-ready PRD (building happens later as an epic).
2. Design language is system-wide but applied Mod-first; rest of app later.
3. Toolcraft = clean-room patterns only (uniform value/onChange, schema
   registry, token theming). No code copied.
4. Skin: light instrument look; **instrument-flat** (flat ink-line rendering,
   physical behavior — detents, ticks, mono readouts).
5. North star: Nothing Phone EQ (refs 06 + 07) — a variation, not a copy.
6. **UI skin only** over existing machinery. No changes to infrastructure,
   architecture, perf-critical paths (LOD/card rendering untouched).
7. Colors: Eido's existing palette; mod + per-control colors from the card
   header palette (`HEADER_COLORS`, `src/canvas/cards/CardShell.tsx`, 12
   colors) — one palette across the app. Users pick mod/control colors
   (form customization, never affects the prompt).
8. Builder layout: snap grid, resize + drag to reorder, dashboard-style.
9. Three modes: **Using** (quick value edits, relabel, + adds rows),
   **Creating** (drag/drop arrangement + authoring frames), **Wiring**
   (controls affecting controls).
10. Engine model (see `mod-prompt-engine.md`): one-sentence rule; five parts
    (mechanic=engine, frame=creator, value=user, address=creator,
    look=creator/user); frames get a `{value}` slot; wiring = gate + select
    (+ feed for displays); scale deferred deliberately.
11. Displays: never speak, hold no value — two-way lenses wired over
    controls (radar, meter, graph, readout). Presets = named value-sets.
    Faces: Simple (display + presets) / Advanced (full faceplate), same
    values, creator-assembled.

## Open threads for next session

- Refine both prototypes — weili: "more work and a lot more refinement to do".
- Pick a design-language variant (Capsule / Tick / Paper) or a blend.
- React to per-control emitted lines (control-to-prompt mapping, together).
- Does creating-mode authoring feel powerful enough? Does gate + select
  cover the wiring cases?
- Then: publish the wayfinder map (draft ticket list lives in the session;
  re-derive from this doc — tickets roughly: control-to-prompt mapping,
  Using mode, Creating mode builder, Wiring mode + data-model decision,
  combined interaction model, mod colors, library UX, migration, PRD).

## Repo state

- Branch `claude/mod-system-ui-redesign-ab0db7`, PR #411 (docs/design only).
- Existing engine seams this builds on: `src/brain/modControlEmitters.ts`,
  `src/brain/applyMods.ts`, `src/graph/types.ts` (ModControl union),
  `src/canvas/cards/modControlRenderers.tsx`, ADR 0022.
