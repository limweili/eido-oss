# Wave A report — grammar foundations

Date: 2026-07-16. Branch: `mod-workbench-polish`, commits `75c4d3d..c1f732b`
(8 commits). Scope: `docs/design/prototypes/lib/*` + `mod-workbench-v2.html`
chrome, per `04-grammar-spec.md` §replaces tables and the rulings in
`07-orchestrator-decisions.md`. No `src/` changes. Waves B/C content
(part faces, journey surfaces) deliberately untouched.

## What changed, per rule section

### R1 — Jacks (commits `75c4d3d`, `d4c66b2`)
- Two silhouettes only: round = signal, square = artifact. The span
  capsule and series polyline die as jack shapes (`JACK_TYPE` map and
  their CSS removed); `nodeDot`/`setType` keep their API and render
  span/series round.
- One −8px overhang for every family and edge (the −9/−13 variants die).
- Every input wears the inward chevron — including all rail dots (the
  lib rail passes `dir:'in'`), wave/radar dot columns, constellation
  DRIFT, score POSITION.
- 24×24 minimum hit area via an invisible `::after` pad on `.mui-node`
  (zero layout churn; the workbench's existing 24px role-button boxes
  stay).
- **Teach-on-drag**: on wire drag or armed keyboard wire, compatible
  inputs bloom (scale 1.3, accent ring, persistent name chip — unnamed
  slots get generic "TAKES A NUMBER"/"TAKES WORK" word-labels for Wave B
  to refine) and incompatible jacks fade to .35, as do cards whose every
  input refuses. Reduced motion keeps ring+chip, drops the scale.
- **Refusals speak at the jack**: family mismatch says "SQUARE PORT ·
  TAKES WORK, NOT A SIGNAL" / "ROUND JACK · TAKES A SIGNAL, NOT WORK";
  words sources say "WORDS · READ ONLY". The keyboard connect path now
  also enforces the family gate (it previously slipped through).
- Drop on an occupied input replaces and announces "… · REPLACED <OLD>";
  a plain unplug announces "UNWIRED"; a miss far from any jack is silent
  ("CONNECTION CANCELLED" dies).

### R2 — Chips (commit `87d0007`)
- One rule shipped in the lib: squared+bordered = press it; capsule =
  read it (`.mui-chip-toggle/-value/-state/-feedback`; state alert wears
  the yellow-dot prefix).
- The persistent `wb-viz-state` badge dies; a state chip renders ONLY
  for UNWIRED / CONFLICT. All 9 "PREVIEW" sites die (status label, plan
  head, chead note, viz badges, curve pill).
- Toggle chips: explorer presets, filter mode, fidelity, strictness now
  bordered rounded-rects with ink-filled/current active. Nav chips
  (WORKBENCH/PROMPT/PLAN) are borderless text + hover underline; UNDO
  became a `.mui-btn` (nav never shares a silhouette with actions).
- Pill grammar: STEP pill dies (verb stays as eyebrow); curve pills read
  `NOW 9/10` / `3 PTS · PEAK 90`; card pill and plan pill are value
  chips (11px value / wash fill, no border).
- `.mui-pill-readout` removed from lib + gallery (zero consumers);
  plate "PROTOTYPE 05" decoration deleted.

### R3 — Type (commit `c41c5b4`)
- Only 9/10/11/13px + 400/500 weights survive. ~50 declarations mapped
  by role (eyebrows→9, labels/buttons→10, values→11, prose→13),
  including SVG text; steps-ladder numerals stay 11px instrument ink.
- Copy shortened instead of shrunk: pack-instance rows keep only the job
  sentence at 9px (the example line left the strip — see deviations);
  chain plan tracks drop the redundant "WORK CHAIN" left label.
- Verification greps (R3.4) return zero hits on `mod-workbench-v2.html`
  and `lib/mod-ui.css`; a runtime computed-style sweep of both live
  pages also found zero sub-9px text nodes.

### R4 — Card shell (commit `c4eb9f8`)
- `.wb-viz` duplicate shell retired: wave and radar rebuild on the lib
  `vizShell` (the old radar SVG class collided with the new `.wb-radar`
  item class and is now `.wb-radar-svg`). One head implementation; viz
  titles join the 10px header grammar.
- Resize handle visible at rest: .18 / .50 card hover / .90 handle hover.
- One hookable size-shedding rule replaces the five bespoke
  `display:none` ladders: `.wb-shed` (tertiary row, drops at sm) and
  `.wb-shed-xs` (label row, drops at xs) — Wave B names each part's
  tertiary row.
- READOUT PAIR gets a distinct board title (name-collision fix).
- Gear placement: controls/process parts already carry the settings
  gear; steps and visualizers currently have no settings surface, so no
  dead gear was added — which settings each part's gear opens is
  Stream 5 / Wave B's table (see deviations).

### R5 — Color (commit `3aa5e94`)
- Cobalt `#3f78df` is reserved for the step class and removed from the
  swatch palette; rust `#b8552f` takes its slot. Every control seed,
  pack part, and gallery specimen that wore cobalt moved to rust.
- New parts take the least-used swatch on the board (verified live:
  sequential adds pick distinct swatches instead of always-purple).
- Artifact cables get their ink stroke at draw time; the `!important`
  died; the rule ("color is a signal's identity; ink is the work
  itself") is stated in DESIGN.md. The temp drag wire also draws ink
  for artifact sources.
- Yellow = conflict only: the silent-member tooltip restyled ink-on-wash.

### R6 — State words + ruling #2 (commit `6cd9f27`)
- One lexicon: OFF / UNWIRED / CONFLICT / AUTO / READY / NEEDS <X>.
  Replaced: readout `—`→OFF, `EMPTY · WIRE INPUT`→UNWIRED chip,
  `MIXED TIMEBASES`→CONFLICT (detail on the title/hover), `MUTED`→OFF,
  `NO SIGNAL`/`WIRE INPUT`/`WIRE LANE`/`WIRE PLAN INPUTS`/`no shape`→
  UNWIRED, status `PROMPT PREVIEW`→READY.
- Silent compiler cards: eyebrow = part name, pill OFF, **no fabricated
  sentence** (all `(X — silent)` strings and the group's "says nothing"
  meta-string die). Face and card verified to agree live.
- Faces of silent parts wear wash + OFF chip; switch and words faces add
  the ghosted would-say sentence (ruling #2). Muted pack members fade
  to .45 with the OFF chip.
- A pack's NEEDS <X> status is now a pressable chip that scrolls to and
  focuses the empty field (fresh-eyes G2).

### R7 — Feedback (commit `d4c66b2`)
- `showFeedback(anchor, text)`: ink capsule at the thing that changed,
  2.4s hold + fade, scrolls off-viewport anchors into view first, and
  mirrors into a visually-hidden `aria-live` region.
- Placement map landed: wiring at the input jack; part added → lands
  focused at the nearest free cell to the *visible* board center with
  an ADDED chip; copy/export/view-as-text at the button (VIEW AS TEXT
  scrolls the revealed panel into view); config default at the popover
  button; pack actions at the pack row; undo at the undo button (see
  deviations). Internal slot tags (`s3`) never leak — `slotDisplayName`
  falls back to INPUT.
- The library footer is a palette label again (counts only); its
  `aria-live` role moved to the hidden mirror; the hover "explain"
  channel died (row tooltips carry the job).

### R8 — Class marks (commit `c1f732b`)
- Solid dot = control, hollow ring = process (fork/revise in the lib,
  STAGE host-side), square = step, no mark = viz. On the workbench the
  ring draws via the 24px hit-box `::after`.
- The mark repeats on compiler card eyebrows (`ModUI.card({mark})`) and
  chain plan segments wear the cobalt square (`.plan-seg.is-step`).
- Palette rows carry their class mark at left (viz rows keep a hidden
  slot for alignment); the group row wears a dashed frame icon; pack
  rows are ghost-cluster rows (3 stacked dashed minis) with a
  `DROPS N PARTS` value chip.

### Docs kept true
`lib/DESIGN.md`: jack section rewritten to the two-silhouette grammar,
cable-color rule stated, swatch palette + least-used-first documented,
chip taxonomy replaces the pill-readout entry. `lib/gallery.html` stays
the living specimen: jack silhouettes section, chip taxonomy specimen,
silent-card specimen (no fabricated sentence), rust accents, process
ring and step square all render there.

## Deviations / smallest-choice calls (logged per brief)

1. **Ghost would-say limited to switch + words.** Ruling #2 says faces
   MAY ghost the would-say sentence. For kinds silent *by authored
   choice* (frameless select option, zeroed mixer, REVISE 0) a ghost
   would fabricate meaning, and REVISE's foot chip leaves no room — they
   get wash + OFF chip only.
2. **Pack example line removed, not relocated.** R3.3 says example and
   scope "move into the pack's popover", but no pack popover exists and
   the pack strip is Wave C's surface. The job sentence stays at 9px;
   the example survives on the palette row tooltip. Wave C can rehome it.
3. **Undo feedback anchors at the undo button**, not the restored
   object: undo commands are closures with no object handle. Rewiring
   ~30 pushUndo sites for anchors is Wave B/C-adjacent plumbing; the
   chip still names what was undone.
4. **No gear added to steps/visualizers.** "Gear wherever settings
   exist": today those parts have no settings surface, and a gear that
   opens nothing is dead chrome. The chrome cluster and classes are
   ready; Wave B's per-part settings table decides what each gear opens.
5. **ONE PASS / IN STAGES lever left as a lever.** R2 lists it under
   toggle chips, but the orchestrator assigns "PLAN / AUTO PARTS RUN
   narration and the ONE PASS ↔ IN STAGES copy" to Wave C. Its type
   moved onto the ladder (10px/500); its anatomy is Wave C's call.
6. **OFF chip can crowd short titles** (e.g. "NO HEDGING" at 2×1
   truncates while OFF). Default drop sizes that satisfy the full-title
   constraint are Stream 5's table (Wave B); flagged for it.
7. **Teach chips can overlap on dense rails** (matrix at small pitch)
   since candidate chips are persistent during a drag. Accepted for the
   prototype; Wave B's per-part pass can thin matrix rail chips.
8. **Gallery masthead keeps its 700-weight display type** — DESIGN.md
   sanctions the grotesque for poster-scale gallery chrome; the weight
   rule targets component text (both verification greps exclude the
   gallery page shell; its component specimens are compliant).

## Verification evidence

- Served via background `python3 -m http.server 8123` (launch.json
  "proto" runner cannot chdir on this host).
- **Both pages load clean**: zero console errors on
  `mod-workbench-v2.html` and `lib/gallery.html` after every commit.
- **Teach-on-drag**: armed WARMTH → 14 compatible inputs bloomed with
  word-label chips, 0 fades (scalar mates with everything on the seed
  board); armed a step's artifact-out → 4 signal-only cards faded, only
  the artifact port stayed live.
- **Replace-not-cancel**: full pointer sequence (down → moves → up,
  pointer-capture stubbed because synthetic events can't hold capture)
  from WARMTH onto the occupied RIPPLE slot: candidate hover mid-drag,
  drop replaced DETAIL, chip "WARMTH CONNECTED TO RIPPLE · REPLACED
  DETAIL" at the jack, teach state cleared, slot ref updated; undo
  restored the seed wire.
- **Invalid connection**: artifact source onto a signal slot → refused,
  chip "ROUND JACK · TAKES A SIGNAL, NOT WORK", no wire made.
- **Switch OFF**: face wash + OFF chip + ghost "Do not hedge."; compiler
  card silent with pill OFF and empty sentence; instruction count
  dropped 12→11. Screenshot-confirmed.
- **9px floor**: spec greps zero hits; runtime computed-style sweeps of
  both pages found zero rendered text below 9px.
- **Plan strip**: lever → IN STAGES shows THE PLAN, "3 CALLS", 13px
  segment prose, curve track keeps its label, chain tracks drop theirs.
- **Least-used swatches**: two successive adds picked `#222222` then
  `#a946c8` (the two least-used), not default purple.
- Tooling note: the Browser-pane screenshot compositor wedges on
  programmatic scrolls of these long pages (stale frames); deep-scroll
  surfaces were verified via DOM/computed-style queries instead. Worth
  knowing for the Wave-A spot-gate reviewer.

## Hand-off notes for Waves B/C

- Size-shedding hooks: mark tertiary rows `wb-shed`, label rows
  `wb-shed-xs` (levels/bandings/window/score/trim already tagged).
- Teach word-labels: replace the generic "TAKES A NUMBER"/"TAKES WORK"
  chip fallbacks with per-part payload words (R1.3 examples).
- `ModUI.card({mark})` and `.mui-chip-*` classes are the shared
  vocabulary for the journey surfaces.
- `leastUsedSwatch()` only counts board items; pack-authored accents are
  explicit and unaffected.
