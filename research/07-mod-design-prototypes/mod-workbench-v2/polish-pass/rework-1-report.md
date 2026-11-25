# Rework wave 1 — report

Date: 2026-07-16. Input contracts: `08-review-verdicts.md` (7-item rework
list + per-test FAIL evidence) and `08-codex-review.md` (2 majors, 3
minors, 1 nit). Commits `0332ac1..03cb34f` (10), verified live at
1600×1000 against `http://localhost:8123/mod-workbench-v2.html`,
screenshot-first then DOM-assert, zero console errors after every fix
group.

## Verdict rework list (ordered)

### 1. Run strip wording — FIXED (`0332ac1`)

- The arithmetic reconciles one way, stated once: *the prompt rides
  along with every call; each card is one call — N calls in all.* The
  head count, THE RUN pill, and the lead sentence all derive from the
  same `callRangeText`; "STAGED CALL" can no longer render.
- ONE CALL lever + call cards (pinned parts) now explains itself:
  "THE LEVER SAYS ONE CALL — THIS PART IS PINNED TO ALWAYS RUN AS ITS
  OWN STAGE."
- The silent 14→13 SENTENCES change speaks at the count that changes:
  flipping the lever shows "1 SENTENCE MOVED INTO THE RUN" (and "…MOVED
  BACK INTO THE PROMPT" on return) anchored at the page-head count.
- Evidence: seed board asserts `14 SENTENCES · 1 CALL` / pill `1 CALL` /
  "…— 1 call in all." in ONE CALL; `13 SENTENCES · 4 CALLS` / "…— 4
  calls in all." in STAGED. Lever position and strip agree in all four
  states (2 lever positions × cards/no-cards).

### 2. Wiring feedback — FIXED (`276041e`), one sub-point disputed

- **Pre-drop replacement warning**: hovering a live wire over an
  occupied input shows `DROP TO REPLACE <SOURCE>` on the jack's chip;
  the label restores when the wire moves away. Post-drop `… · REPLACED
  <SOURCE>` chip at the jack was already present and confirmed firing
  (the reviewer's exact NO HEDGING → WINDOW LENGTH repro now shows both
  the warning and the replaced chip). The replace was already a single
  undo step; undo chips now anchor at the jack.
- **Why teach-on-drag read as "not firing"**: it fired on every drag
  path (fresh output drag, occupied-slot pickup, keyboard arm — all
  route through `teachStart`), but the bloom ring was
  `box-shadow: 0 0 0 1.5px var(--accent)` and unwired candidates carry
  no `--accent`, so the ring never drew on exactly the slots most
  likely to be targets. Fixed with an ink fallback. Second factor: for
  a signal drag ~18 of 19 slots are legal (coercion within the signal
  family is total, by design), so "highlight legal targets" is mostly
  the fade of the few illegal ones — that fade, the chips, and the ring
  now all render.
- **Jack typing — disputed, resolved the "stop drawing" way**: grammar
  D1/R1.1 deliberately makes scalar→span legal (coercion is TOTAL
  inside the signal family; the only enforced rule is signal vs
  artifact). The glyphs already render one round silhouette; the
  remaining place that taught a phantom type system was ARIA ("span
  input" retyping to "scalar input" after a connect). ARIA now says
  `signal input` / `work artifact input`, payload nuance stays in the
  chip words. Enforcing span-only slots would contradict the ratified
  grammar, so the verdict's "or stop drawing them as different types"
  branch is the one implemented.

### 3. Pack chip states — FIXED (`63b8ea0`)

- Root cause of "READY — FILL IT IN": the chip's `hidden` attribute was
  defeated by its CSS `display: flex`, and the text/ARIA were written
  unconditionally. READY now renders no suffix, no stale ARIA
  ("TRANSLATOR is ready."), and the chip actually hides. DOM-asserted
  before/after filling THE READER.
- Tidy wording uses the prompt cards' display names: "Two parts are
  named alike — EXAMPLES and EXAMPLES 2. Rename one?"
- Bonus (test-5 row 3): SHOW BOTH now pans the board to the first
  duplicate and flashes the parts themselves, not only their chips.

### 4. STAGE popover — FIXED (`550a9ce`)

- STAGE loses the slider's raw STOPS stepper (it counted intervals —
  the "STOPS 2 above three sentences" mismatch) and the generic STOP
  NAMES field. One STAGES editor replaces them: count stepper (2–6),
  and per-stage NAME + SENTENCE rows; the number always equals the rows
  (asserted: STAGES 3 ↔ 3 rows; + → STAGES 4 ↔ 4 rows, stops and
  frames arrays track).
- The "4 stops need 4 names" boilerplate is now live-count everywhere
  it remains legitimate: LENGTH (5 stops) asserts "5 stops need 5
  names."

### 5. Placement & wire routing — FIXED (`8e4408b`)

- Root cause found for every overlap sighting (seed pairs, "REVISE
  landed half under THE READER", pack balloons): push-resolution
  animates via CSS transitions, and in a hidden document (the review
  harness's browser pane reports `document.hidden: true` even while
  screenshotting) transitions freeze at t=0 — the model was always
  overlap-free while the DOM stayed at pre-push positions. `placePushed`
  now lands directly whenever animation can't run. Asserted: 0 DOM-rect
  overlaps at load and after dropping NARRATOR onto occupied space
  (was 14 pairs).
- Pack pre-wires stop ballooning for the same reason — members land in
  their resolved cluster.
- Wires draw UNDER card faces: `#wireLayer` z-index 1 vs items' 2,
  raised to 25 only while a wire is dragged so the live cable stays
  visible. Asserted after enlarging WARMTH to 5×4.

### 6. Face floor — FIXED (`9a9341f`, `03cb34f`)

- **PAD / MIXER**: land 3 wide, keep value readouts at sm
  (`50 · 50` / per-channel shares), and speak their sentence at the
  default drop size (removed from the lg-only speech list). Verified on
  fresh drops: "Pad x: 50%. Pad y: 50%." / "Weigh the answer 50% on a,
  50% on b." on the face.
- **FORK**: eyebrow rewritten "THE AI PICKS A PATH WHEN IT RUNS" (who
  decides, not a timing riddle); the bias chip names itself:
  `LEAN · EVEN`.
- **READOUT**: the state chip floats over the top-right corner at sm/xs
  (the OFF-chip rule, generalized to all lenses) so the full title
  renders — asserted `scrollWidth <= clientWidth` for "READOUT" at
  default size. Same fix covers "TECHNICAL DEP…": that dial now ships
  3 wide in the TRANSLATOR pack.
- **GROUP VOICE**: drops under its library name — the "THE VOICE" alias
  is gone from frame tab and prompt group.
- **SELECT**: a picked-but-sentence-less option wears a solid accent
  ring over its dashes (picked ≠ unpicked at a glance) and the ghost
  line ("No sentence for OPTION B yet.") now fits its two-line box so
  it actually renders at the default size.
- **BEAM**: while the invitation line shows, the instrument fades to
  .22 (all lenses) — no more strike-through.
- **Work steps**: prose keeps a 26px gutter and the jack micro-labels
  (IN / OUT / BREADTH…) wear paper chips; prose clears the foot chip
  (asserted: prose bottom 102 < foot top 108 at min size).
- **Pressable vs readout chips** (test 3): pressables (toggle / foot /
  filter-mode) now sit on the raised ground with a resting shadow —
  distinct in practice, not only in border color.
- **CURVE "AUTO overlaps NOW" — not reproducible**: measured rects at
  the minimum size (4×2): AUTO chip y101–125, NOW label y63–73, 28px
  clear; at any larger size they separate further, and a wired NOW
  hides the label entirely. No change made; if the reviewer can name a
  size that reproduces it, it's a one-line CSS fix.

### 7. Undo depth — PARTIALLY DISPUTED, remainder FIXED (`0332ac1`)

- **"Depth 1" does not reproduce**: the stack has held 40 entries since
  Wave A. Live assert: add DIAL, add SWITCH, flip lever → four
  sequential undos ("switch WHEN IT RUNS…", "add SWITCH", "add DIAL",
  "add EXPLORE" from an earlier drop) each correct. The reviewer's
  session most likely had one undoable action at that point (lever and
  their preset path weren't in the stack — see next line).
- **Lever now undoable** ("Undo switch WHEN IT RUNS to STAGED").
  Preset picker load/save/rename/delete already pushed undo; the load
  entry now anchors its chip at the pack frame.
- **Undo chip at the acted-on element**: `pushUndo` takes an optional
  anchor; wire connects/disconnects/moves, value adjustments,
  moves/resizes, lever flips, pack on/off, and preset loads all anchor
  their UNDID chip at the restored object (falls back to the UNDO
  button when the object is gone).

## Codex review items

| Item | Status |
| --- | --- |
| MAJOR: no `pointercancel` on compiler card/section drags | FIXED (`03d7c4e`) — cancel takes the Escape path (return home, unlisten). Proven by simulated pointerdown/move/pointercancel: mid-drag the card sits on `document.body`; after cancel it is back in its section, spacer removed, no listeners left. Handler registered on the same target (document) as pointermove/pointerup. |
| MAJOR: 12/14/16px type-ladder violations | FIXED (`c95e04a`) — palette caret, pack menu ⋯, tidy caret → 10px; chrome buttons → 10px; count −/+ → 11px; section ghost + → 13px. `grep -E 'font-size: (1[24568]|[0-8]…)px'` over workbench + lib returns zero; 600/700 weights already clean. |
| MINOR: gallery teaches banned grammar (RANGE capsule, CURVE series jack, "silent") | FIXED (`fb9cd1b`) — notes state the one round signal silhouette with payload in words; OFF replaces silent; "Fidelity chip" section renamed "Runs chip". |
| MINOR: DESIGN.md + gallery stale fidelity vocabulary | FIXED (`fb9cd1b`) — RUNS chip (`ONE CALL · STAGED · AUTO`; settings AUTO / ALWAYS IN THE ONE CALL / ALWAYS ITS OWN STAGE); `FAST ◄──► PRECISE` → WHEN IT RUNS (`ONE CALL ⟷ STAGED`) + THE RUN footer. Internal `fidelity` keys deliberately keep their names (plumbing, not faces) — noted inline in DESIGN. |
| MINOR: orphaned `.wb-config-preview` CSS | FIXED (`fb9cd1b`) — deleted. |
| NIT: stale `.wb-ghost-say` comment | FIXED (`fb9cd1b`) — deleted. |

## State-word sweep (verdict test 3, beyond the ordered list)

- `AUTO` is the one spelling in RUNS settings rows (was FOLLOWS THE
  MOD); "AUTO follows the WHEN IT RUNS lever" is helper prose.
- `OFF` is the one spelling in the pack menu: TURN THIS PACK OFF / BACK
  ON (was SILENCE/UNSILENCE), matching feedback and ARIA.
- ARIA says Wired/Unwired everywhere (was Connected/Unconnected on
  jacks and slots).

## Disputed / deferred

1. **Scalar→span acceptance** (test 2/3): by ratified grammar (D1 —
   coercion inside the signal family is total), not a bug. The teach
   now says what will happen in words before the drop; ARIA stops
   claiming slot types. If the gate still wants span slots to refuse
   scalars, that is a grammar change, not a fix.
2. **CURVE AUTO/NOW overlap**: not reproducible at any accepted size
   (measurements above).
3. **Undo depth 1**: not reproducible; depth-40 stack demonstrated.
   The real gaps (lever, chip placement) are fixed.
4. **Full multi-step undo of *every* gesture** (e.g. mid-popover
   keystrokes) unchanged — out of the verdict's minimum bar.

## Verification

Method per tooling notes: served via `python3 -m http.server 8123`,
driven in the browser pane at 1600×1000, screenshot first then
DOM-assert, reload (with cache-busting query) after every file change.
Zero console errors across seed load, the six-face drop board, pack
drop onto occupied space, lever round-trips, STAGE/LENGTH popovers,
wire drag with replacement, pointercancel simulation, and a 5×4 resize.
One environment caveat recorded for future reviewers: the browser pane
reports `document.hidden: true`, so anything that only settles via CSS
transitions never settles there — the placement fix removes the
workbench's dependence on that, but screenshots of *other* transition
effects (FLIP ghosts) may still catch them mid-flight.
