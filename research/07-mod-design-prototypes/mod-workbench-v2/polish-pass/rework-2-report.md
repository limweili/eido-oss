# Rework wave 2 — report

Date: 2026-07-17. Input contracts: GitHub issues #484–#489 (from
`08-review-verdicts.md` gate round 2). Commits `81db814..3a038f0` (6, one
per ticket), verified live at 1600×1000 against
`http://localhost:8123/mod-workbench-v2.html`, screenshot-first then
DOM-assert. Zero console errors after every fix group and after the
final 12-check regression sweep.

Environment caveat (same as both review rounds): the browser pane
reports `document.hidden = true`, so rAF/ResizeObserver-dependent
behavior is starved. Every fix below was designed to land without
animation or rAF (direct DOM state), and each acceptance criterion was
verified either live or structurally as noted.

## #484 — Staged foot chips show real call numbers — FIXED (`81db814`)

**Fix.** One numbering source: `stepRunsWord` now reads the same
item→call-word map (`computeRunCards().labels`) the run strip's cards
are titled from — the chain-local `indexOf + 1` that pinned every chip
to "CALL 1" is gone. `refresh()` computes the map once per pass and
hands it to every foot chip, so chips and strip can never diverge.
The pinned-step ONE CALL copy is one sentence now: *"The lever says ONE
CALL, but this pinned part always runs as its own call. The prompt
above rides along with it — 1 call in all."* (pluralizes for N parts;
the separate contradicting note row is deleted).

**Evidence.** 3-step chain (EXPLORE→CLUSTER→CRITIQUE) on the seed
board: STAGED chips `→ CALL 1 / 2 / 3` = strip cards `CALL 1 · EXPLORE`,
`CALL 2 · CLUSTER`, `CALL 3 · CRITIQUE` (arc renumbered to `CALLS 4–6`).
Removing CLUSTER renumbers both surfaces together (`CALL 2 · CRITIQUE`,
chip `→ CALL 2`). Lever toggled fast↔precise repeatedly — no desync.

- [x] ≥3 steps: each chip number equals its run-strip card number
- [x] Toggling ONE CALL ↔ STAGED repeatedly never desyncs
- [x] Removing a step renumbers both surfaces together (reorder = same
      single source; wiring order drives both)
- [x] Pinned-step ONE CALL copy reads in one pass

## #485 — Spawn faces carry identity — FIXED (`8b91e64`)

- **REVISE** spawns 2×2 (`KINDS.revise h:2`; min stays 2×1): the name
  renders at spawn, the ×2 PASSES capsule stays one line (slimmed at
  sm), and grown faces scale the arcs (sm 28px → md 34px → lg 44px,
  heavier strokes) with a four-line speech box so the full compiled
  sentence renders — no dead beige expanse. Verified at 2×2 and 5×3:
  name + arcs + capsule + LIGHT TOUCH + sentence, nothing clipped.
- **SLIDER** spawns 4 wide (`dropW: 4` — palette drops only; packs and
  the seed keep their 3-wide layout) and unnamed poles wear GHOST end
  words `LOW END · HIGH END` (faint italic, suppressed when stops own
  the track, so STAGE never ghosts). `fitSliderEnds` now measures the
  actual end words instead of a fixed 150px gate, so the ends render at
  drop size. A fresh SLIDER and a fresh DIAL side-by-side read as
  different instruments (screenshot).
- **COUNT** defaults to 3 and is clamped 0–10 in the lib (matching the
  `/ 10` face and the jack's "sends 30 of 100 (each step is 10)" story;
  host write-back was already 0–10).
- **GROUP VOICE** palette row carries `DROPS 3 PARTS` (the packs' own
  chip), matching what placement does.

- [x] REVISE named at spawn; large REVISE has no dead expanse
- [x] Fresh SLIDER visibly differs from fresh DIAL and states its job
- [x] Fresh COUNT reads sensibly (3 / 10)
- [x] GROUP VOICE palette promise matches placement
- [~] Formal fresh-eyes 5-second re-test = gate round 3 (#490); all
      four faces verified by screenshot at spawn size here

## #486 — Live WHAT IT SAYS NOW + undoable template edits — FIXED (`8de885b`)

**Fix.** The popover repaints `WHAT IT SAYS NOW` **synchronously** on
every input (the old `requestAnimationFrame(paintSays)` never fired in
a hidden document — the reviewer's exact staleness). Template edits
enter undo history: one labeled entry per edit session (armed on focus,
pushed with the first keystroke, restores the pre-session template) —
for the SENTENCE textarea, pad's per-axis sentences, STAGE's per-stage
sentences, and SELECT's per-option sentences (delegated onto the lib's
accordion inputs; restore goes through `applyConfig({frames})`).
Sentence textareas carry explicit aria-labels; SELECT's rebuilt
accordion inputs get `Sentence · <OPTION>` (they previously lost the
popover-wide aria pass on rebuild).

**Evidence (all live).** DIAL: typing `Warmth cranked to {value},
please.` updated the preview to "Warmth cranked to 72%, please." on
each keystroke; undo chip `edit WARMTH sentence` restored the default.
SELECT: per-option field updated preview live; `edit SELECT sentence ·
option a` restored `frames`. STAGE: stage-2 sentence updated the
preview live; `edit stage 2 (ORGANISING) sentence` restored the frame.

- [x] SENTENCE template edits update WHAT IT SAYS NOW live, same popover
- [x] Works for per-option (SELECT) and per-stage (STAGE) fields
- [x] Labeled undo restores the prior template
- [x] Sentence textareas expose aria-labels

## #487 — Collision-free placement — FIXED (`80b5038`)

**Fix.** One occupancy model in board pixels: item cards **plus every
frame halo** (group frames and pack halos — 12px side margins + the
tab band), which the old cell probe ignored. Every drop path probes it:

- Single parts land at the nearest fully-free cell to the drop point
  (click and drag-drop); the old `resolvePush` stays as a belt but the
  probed cell is already free.
- Packs probe their **real** extents (`PACK_FOOTPRINT`, derived from
  each builder — narrator is 13×9, not the nominal 6×5) inflated by
  halo + tab headroom. Per-member pushes on a crowded board were the
  scatter mechanism (they tore another group's members apart and left
  its frame stretched over foreign cards) — with a genuinely free
  probe they are no-ops.
- GROUP VOICE probes 6×4 + halo; `settleFrameHalo` afterwards pushes
  any foreign card out of the frame's margin band via the ordinary push
  resolver with a fractional-cell active rect (pixel-honest).
- The pack ghost now previews the TRUE landing cell — the same snap the
  click commits, so the preview never promises a refused spot.
- The seeded TRANSLATOR moved one row down (5,15): its tab band rested
  over STAGE's row and EXPLORE sat inside the frame's bbox from first
  load.

**Evidence.** Model-level audit (item×item, frame×foreign-item,
frame×frame, pixel-exact): seed board **0 overlaps**; after 13 hostile
drops all aimed at occupied cell (2,2) — 10 mixed parts + 2 packs +
1 group voice, 51 parts / 5 frames — **0 overlaps**. Dwell-rearrange
code path untouched.

- [x] 10 drops on a crowded board: zero resting overlaps (cards, tabs,
      frames) — audited at pixel level
- [x] Pack ghost placement respects the same rule (and previews it)
- [x] Dwell-rearrange behavior unchanged (no edits to that path)
- [~] "Verified interactively in a visible browser pane": this pane is
      `document.hidden=true`; fixes avoid animation/rAF entirely
      (drop-time placement is synchronous model state, asserted on DOM
      rects). Native drag-drop and mid-gesture ghost tracking need the
      #490 visible-browser pass.

## #488 — Replace copy and slot naming — FIXED (`b5c80aa`)

**Fix.** `slotDisplayName` now returns a stable ROLE name, never the
wired source: per-lens role words (`BANDINGS · BAND 2`, `LEVELS · BAR
1`, `BEAM · SIDE 1`, …), `EXPLORE · WORK IN`, `AXIS n`, `POSITION`,
step tune-ins by their signal names; rail slots with authored fixed
names keep them. Used in the replace/connect messages, the connect
undo labels, and slot ARIA. And one source can no longer feed two
inputs of the same part — the wire MOVES (old slot cleared inside the
same undo entry, feedback says `· MOVED FROM <slot>`), which is what
produced two bands wearing one name.

**Evidence (live, reviewer's exact repro).** BANDINGS wired from
EXAMPLES 2; dropping BIG PICTURE on that band now reads **"BIG PICTURE
CONNECTED TO BANDINGS · BAND 1 · REPLACED EXAMPLES 2"** — displaced
source and destination named distinctly. Post-replace band labels are
unique (`BIG PICTURE`, empty, empty). ARIA: `BANDINGS · BAND 1 — signal
input. Wired from EXAMPLES 2.` Pre-drop warning (`DROP TO REPLACE
<src>`, from rework 1) confirmed in the `startWire` hover path — code
asserted; mid-gesture hover itself is not observable in this pane ⚠.

- [x] Replace message: no name in both roles
- [x] Post-replace multi-input labels distinct and correct
- [x] Pre-drop DROP TO REPLACE names the displaced source (structural;
      re-observe mid-hover in #490)

## #489 — Grammar dust batch — FIXED (`3a038f0`)

- **Pressable chips = raised KEYS** (the squared+border treatment that
  failed both rounds is gone): solid raised fill + a hard 2px
  under-edge shadow + hover lift + press-down travel, on
  `.mui-chip-toggle` (incl. the pack status chip), `.mui-foot-chip`,
  `.mui-filter-mode`, `.wb-chip`, `.wb-pack-preset`. Readout capsules
  stay flat and borderless. Gallery specimen + tag updated ("raised
  key = press it · flat capsule = read it"), DESIGN.md chip rule
  rewritten. Verified side-by-side in the gallery chips row.
- **Enter/Space activate every focusable chrome control**: a document
  delegate covers `role="button"` elements without their own key
  handling and makes activation hold under synthetic (untrusted) key
  events; native buttons keep their native path (`e.isTrusted` guard —
  no double-fire). Verified: synthetic Enter opens a step's Configure
  popover; synthetic Space removes a step. Controls with bespoke
  handlers (jacks, slots, cards, palette rows) preventDefault first
  and are unaffected.
- **No internal ids in accessible names**: slot ARIA goes through the
  role names from #488. Sweep of every `[aria-label]` on a busy board:
  zero `s\d+` matches (was "s32 — signal input").
- **No two placed parts share an accent**: auto-assignment takes the
  first UNUSED preset; when all 8 presets are on the board it
  synthesizes a new hue maximally distant from every accent in play.
  Authored accents (seed, pack builders) also yield when their hex is
  already placed (`resolveAccent`) — a second TRANSLATOR pack no longer
  duplicates the first's hues. The step class cobalt stays shared by
  design (R5.2). Verified: seed board 0 duplicates; +10 dials + a
  second translator, still 0.
- **Invite text ≥4.5:1 and un-struck**: the invite line is `#5d574a`
  (≈6.2:1 on the panel) and sits on its own translucent panel pill
  (`box-decoration-break: clone`), so nothing — including BEAM's beam —
  can strike through the words. BEAM screenshot: line fades behind, the
  sentence reads clean.

- [~] Fresh-eyes pressable/readout sort = gate round 3; treatment now
      differs in fill, depth, and motion, not border only
- [x] Enter/Space activate all focusable chrome
- [x] No internal ids in any accessible name
- [x] No two simultaneously-placed parts share an accent
- [x] Invite ≥4.5:1; BEAM invite legible

## Not fully verifiable in this pane (for #490's visible browser)

1. Mid-gesture states: pointer-drag wire hover (`DROP TO REPLACE` while
   hovering), floating-drag ghost tracking, pack ghost riding the
   cursor (registration is rAF-gated; landing logic itself is verified).
2. ResizeObserver size-class re-evaluation on manual resize (forced
   classes were used to verify each size's layout rules).
3. The three fresh-eyes judgments marked [~] above (5-second faces,
   chip sorting) — they need eyes, not asserts.

## Regression sweep

Final fresh load: 12 scripted checks across all six tickets — 12 PASS,
zero console errors for the whole session (drops, wiring, lever
toggles, popovers, undo chain, pack + group placement).
