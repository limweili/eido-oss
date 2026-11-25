# Wave C report — journey surfaces

Date: 2026-07-16. Branch: `mod-workbench-polish`, commits `4492ac1..`
(6 commits on top of Wave B's `6a2d5a7`). Scope: `mod-workbench-v2.html`
+ `lib/mod-ui.js` / `lib/gallery.html` (fidelity words only), per
`06-journey-redesign.md` (binding: the PAGE BESIDE THE BENCH layout +
its §7 checklist) and rulings #1/#4/#5/#7 in `07-orchestrator-decisions.md`.

## What changed, per surface

### Layout shell (commit `4492ac1`)

- **The page never scrolls (§2.0), by construction.** `body` is
  `overflow: hidden`; the window is a fixed grid of zones — 52px header,
  then library (168px) / board (1fr) / THE PAGE (400px). Exactly three
  regions scroll internally: the library list, the board (pans both
  axes), and the page's section stack. The sticky plate, its scroll
  void, and the below-the-fold compiler cannot exist because the body
  never has a scroll position. Verified: `scrollHeight − clientHeight
  = 0` on body and documentElement at 1280×1000.
- **THE PAGE** is one vertical document: panel head ("THE PROMPT ·
  WRITTEN LIVE FROM THE BOARD" + live `N SENTENCES · N STAGED CALLS`
  count + COPY PROMPT / EXPORT / PLAIN TEXT) → notices row → sections
  stacked vertically, full-width chips → **THE RUN**, an always-present
  pinned footer (its body scrolls internally past ~46% panel height, so
  the lever is never off screen). The empty page teaches: "The prompt
  is empty. Every part you add writes one sentence here."
- **Nav truth (§6):** WORKBENCH/PROMPT/PLAN header buttons and their
  handler are deleted; UNDO stands alone in the header. VIEW AS TEXT is
  now **PLAIN TEXT**, an in-place toggle that swaps the chip document
  for the compiled `<pre>` in the same panel viewport (button carries a
  pressed state). Parts/wires count moved to a board-corner readout;
  sentence/call counts to the page head; the ● status dot died.
- Section drag + Alt-arrow reorder converted from horizontal to
  vertical (sections stack now).
- **<1200px (§8 Q1):** THE PAGE collapses to a right **drawer** with an
  edge tab handle ("THE PROMPT") — the drawer keeps the no-page-scroll
  rule and the whole document; a bottom sheet would re-create the dock
  that lost in §2. Smoke-verified at 1100×800.

### THE RUN (commit `3799d03`)

- Never hidden, three states exactly per §4: ONE CALL → "Everything
  above goes to the AI as one prompt — one call." + the one honesty
  line "NOTHING RUNS FROM THIS PAGE — COPY OR EXPORT TO USE IT" (the
  old "AUTHORING ONLY · NO RUN ENGINE" chrome died for it); STAGED
  with nothing staged → the teaching sentence; staged → lead sentence
  ("The prompt above goes first. Then each card below is its own call —
  N calls in all.") + numbered **vertical call cards**.
- Call cards: a chain step is one card per call (`CALL 1 · EXPLORE —
  Range widely…`, square cobalt class mark); an arc groups its stages
  into one card (`CALLS 2–4 · WARMTH ARC — Warmth arc held at 3/10,
  then 9/10, then 4/10 — one call per stage.`); a fork is one card
  (`CALLS n–m · FORK · DECIDES ITS OWN ROUTE — First decide: … Then a
  or b — one of the two runs.`) and the lead sentence adds "The fork
  picks one of its routes when it runs." Plan errors render as a
  double-bordered FIX THE PLAN card.
- **WHEN IT RUNS lever** lives in THE RUN's head, touching the cards it
  regroups: label WHEN IT RUNS, ends ONE CALL / STAGED (semantics of
  `modLever` unchanged).
- **Regroup is watchable, nothing vanishes:** flipping the lever
  FLIP-animates a labeled ghost for each affected chip between its
  section slot and its call card (both directions, reduced-motion
  skips, capped at 12); the vacated slot keeps a grey **stub**
  (`EXPLORE → RUNS AS CALL 1`), clickable — it scrolls to and flashes
  the call card. Section instruction counts never silently drop.
- One language: the per-part fidelity foot chip (lib) now reads
  **ONE CALL · STAGED · AUTO** — the lever's own words; a part pinned
  to its own stage wears STAGED on its face. Gallery specimens updated.

### Packs (commit `73565dc`)

- **Staging ghost (§3):** clicking a pack row stages a ghost — dashed
  frame at drop size, pack name + job sentence on its tab, N faint part
  outlines, and a CLICK TO PLACE · ESC CANCELS hint — riding the cursor
  over the board. Nothing is created until the click; Esc cancels.
- **Halo frame (ruling #5):** the landed pack lives inside a persistent
  `wb-group` frame (the GROUP VOICE base class) with a **pack tab
  variant** — no popover inheritance. Tab: editable name · job sentence
  · `PRESET: STOCK ▾` picker · pressable `NEEDS THE READER — FILL IT IN`
  status (pans + focuses the empty field) · ⋯ menu (SILENCE THIS PACK /
  DUPLICATE / RESTORE STOCK / REMOVE PACK, plain words). The halo wears
  the pack's accent (least-used swatch at creation). Frame tabs (voice
  and pack) now paint above overlapping parts — the halo stays beneath.
- **The preset picker absorbs the ex-"Editor row"**: load any preset,
  SAVE THESE VALUES AS…, RENAME / DELETE THIS PRESET (STOCK locked,
  CUSTOM · UNSAVED shown unsaved) — the whole variation system behind
  one affordance, with undo on every operation. The word "instance"
  appears nowhere.
- **The strip is dead.** "MOD PACK INSTANCES" markup, CSS, and
  `renderPackRack` are deleted; every capability moved to the frame tab.
- **EXPLORER value presets (ruling #4):** SURVEY / BALANCED / DECIDE
  moved off the BRANCHES lens onto the frame tab as a second, visually
  distinct toggle-chip row below the picker row (closes Wave B
  deviation 9).
- **Pack↔parts↔chips linkage:** chips of pack members carry the pack
  name as an eyebrow tag (`TRANSLATOR · EXAMPLES 2`); in THE PAGE the
  pack's chips sit under a group header (accent seam · name · job ·
  NEEDS chip). Hovering the frame tab highlights the page group;
  hovering the group header flashes the halo.
- **Auto-numbering:** a spawned part whose base name already exists on
  the board is renamed (`EXAMPLES 2`) at pack creation; completeness
  checks, shipped preset patches, and the duplicate-name lint all
  compare by base label, so nothing breaks and the notice still fires.

### Lint notices (commit `3c8d2b6`)

- Amber row atop THE PAGE: collapsed `● N THINGS TO TIDY`, expanded one
  plain sentence + one action per notice. Never a modal; no dismissal
  state — a notice persists while true and disappears when fixed
  (verified live: renaming the dial removed its row and the whole strip).
- Launch set: duplicate rules/names ("LENGTH is set twice — the prompt
  says it two ways." / "Two parts are named EXAMPLES — rename one?" →
  SHOW BOTH flashes both chips and both faces); unnamed emitter ("This
  dial has no name — its sentence is just 'Dial: 50%.'" → NAME IT opens
  settings with the NAME field selected); placeholder FORK ("FORK still
  says the starter text — give its paths real names." → OPEN lands on
  HOW TO DECIDE); incomplete pack ("TRANSLATOR needs THE READER filled
  in." → GO THERE pans + focuses). **No note-leak row** (ruling #1).
- Affected chips wear a thin amber left seam — `--mui-yellow`'s one
  sanctioned meaning (audit Co4).

### Linking + feedback (commit `60b423c`)

- Chip click no longer edits (F1): it pans the board to the part and
  flashes it; a hover pencil on every chip (and group card) carries the
  edit. Text lines stay click-to-edit — they are page-native.
- Hovering a chip lifts its part; touching any part flashes its
  sentence in THE PAGE, scrolling it into view if needed — the
  board→prompt causal link drawn on every interaction.

### Demo re-seed (commit `1e17045`, ruling #7)

- The seed is a first-load specimen of the whole journey: the wired
  voice cluster (wiring), a pinned-STAGED EXPLORE step (THE RUN opens
  with a CALL 1 card and the APPROACH section shows its stub), and a
  pre-placed TRANSLATOR pack (halo frame + tab + NEEDS THE READER
  notice + the intentional EXAMPLES/EXAMPLES 2 duplicate-name notice —
  2 THINGS TO TIDY at rest, both real and both fixable).

## Deviations / smallest-choice calls

1. **Native-drag packs skip the ghost.** HTML5 DnD can't carry the
   staging ghost reliably; a drag names its own drop point, so drag
   still places directly. The click path (the palette's primary
   gesture) gets the full stage→place→cancel loop. Keyboard Enter
   places directly at the visible board center (announced).
2. **Preset save/rename use an inline name form inside the picker
   popover**, not a second dialog — "inside the picker's open state"
   per §3, one level deep.
3. **The board→panel connector flash (§2.3 carry-over) is cut** — §8 Q4
   says keep only if it survives the dead-chrome test; the pan +
   bidirectional flash already draw the causal link, so the connector
   would be decoration.
4. **Stubs shipped, no gray-tag fallback needed** (§8 Q2): in situ the
   stub row reads as a receipt, not clutter.
5. **FLIP ghosts are name capsules, not full chip clones** — a
   full-size accent card flying across the panel gap read as a smear;
   the labeled capsule in the part's accent keeps the eye on the
   motion. Capped at 12 ghosts per flip.
6. **Fork numbering counts the decide call**: a fork card reads
   `CALLS n–m` (2 calls) where the spec sketch showed `CALL 5`; the
   run's call count already counted the decide call before this wave,
   and the card should not contradict it.
7. **Pack accent = least-used swatch at creation** — the spec fixes the
   halo carries "the pack's accent" but not its source; packs join the
   same distribution rule as parts (R5.5).
8. **Settings RUNS rows keep Wave B's long journey words**
   (FOLLOWS THE MOD / ALWAYS IN THE ONE CALL / ALWAYS ITS OWN STAGE);
   only the face chip adopted the lever's short words (ONE CALL /
   STAGED / AUTO). Face = state, settings = consequence sentence.
9. **Window CONFLICT counts are no longer aggregated anywhere** — the
   header status that summed them died; the conflict stays visible on
   the lens (CONFLICT chip + yellow seam). Adding it to the lint row is
   a candidate follow-up, but it is not in §5's launch set.
10. **Undo feedback still anchors at the undo button** (Wave A
    deviation 3 stands — closure-based undo commands have no object
    handle; out of this wave's scope).

## Verification evidence

Served via background `python3 -m http.server 8123`; viewport
1280×1000 (drawer smoke-checked at 1100×800). Screenshot-first, then
DOM asserts (rAF/ResizeObserver only run while frames composite — the
Wave A/B tooling note held). No programmatic scrolls before screenshots.

- **Zero console errors** on `mod-workbench-v2.html` and
  `lib/gallery.html` after every commit and after the full walk below.
- **No scroll void by construction:** body and documentElement scroll
  deltas are 0; the run lever, board, library, and page head are all on
  screen at 1280×1000 — nothing the storyline needs is below a fold,
  because there is no fold.
- **The storyline, as observed** (narration script §1, sentences
  keyed):
  - (1–3) Clicking DIAL in the library landed a part at the visible
    board center and its chip appeared in VOICE; the page head count
    ticked live (12→13 sentences).
  - (4) Touching WARMTH on the board flashed `Warmth: 72%.` in the
    page; clicking the FORMALITY chip panned the board to the slider
    and flashed it; the chip's pencil opened sentence editing.
  - (5) Clicking TRANSLATOR staged the ghost — dashed frame, name +
    job tab, six faint outlines, CLICK TO PLACE · ESC CANCELS; Esc
    cancelled with nothing created; clicking the board placed the pack
    inside a persistent halo frame; "TRANSLATOR PACK ADDED" at the
    landing.
  - (6) The frame tab (name · job · PRESET: STOCK ▾ · NEEDS READER —
    FILL IT IN · ⋯) and the page's READER group header carry the same
    accent and name; hovering the tab highlighted the page group,
    hovering the header flashed the halo; every pack chip reads
    `TRANSLATOR · <PART>` (the auto-numbered `TRANSLATOR · EXAMPLES 2`
    included).
  - (7) THE RUN at ONE CALL reads "Everything above goes to the AI as
    one prompt — one call." with the honesty line; at STAGED with
    nothing stageable it teaches what would change (asserted on an
    empty-fidelity board state).
  - (8) Flipping to STAGED: a FLIP ghost flew the WARMTH ARC chip into
    `CALLS 2–4 · WARMTH ARC — Warmth arc held at 3/10, then 9/10, then
    4/10 — one call per stage.`; the section kept the stub `WARMTH ARC
    → RUNS AS CALLS 2–4`; `CALL 1 · EXPLORE` sat above it; the pill
    read 4 CALLS. Flipping back removed the movable stub and card;
    the pinned EXPLORE kept its stub and card — counts never dropped.
    Clicking a stub scrolled to and flashed its call card.
  - (9) 2 THINGS TO TIDY expanded to the duplicate-name row and the
    pack row; NAME IT opened the new dial's settings with NAME
    selected — typing URGENCY made the notice (and the strip) vanish;
    GO THERE focused THE READER's input. SHOW BOTH flashes both chips
    and faces. Affected chips wear the amber seam.
  - (10) PLAIN TEXT swapped the chips for the compiled text in the
    same viewport (`## VOICE …`) and back; COPY PROMPT reported
    "PROMPT COPIED · N WORDS" at the button; EXPORT reported "MOD SPEC
    EXPORTED · AUTHORING DATA ONLY"; UNDO removed the added dial
    (verified count 23→22) and re-enabled correctly.
- **Preset picker live:** rows STOCK / SURVEY / DECIDE with the current
  one marked; loading STOCK restored dial values (85/30/… → 50/50/…);
  SAVE/RENAME/DELETE guard STOCK and unsaved CUSTOM. Explorer chips on
  the tab applied SURVEY (85, 30, 15, 75, 10) and synced the picker.
- **Drawer (<1200px):** at 1100×800 the page hides behind a THE PROMPT
  edge tab; opening it slides the full document (notices, chips, THE
  RUN + lever) over the board.

## Hand-off notes for the Wave C gate (Stream 8)

- The narration script's ten sentences are all demonstrable in the
  running prototype; sentence 8 (watching chips move) is the one that
  needs a human eye on the FLIP motion — DOM asserts only prove ghosts
  spawn and land.
- `computeRunCards()` is the single source for call numbering — stubs,
  cards, and the lead sentence all read it; if call ordering ever feels
  wrong (§8 Q5), change it in one place.
- Known cosmetic: the pack halo can visually overlap unrelated parts'
  regions when the board is dense (background wash only; tabs stay
  reachable). The synthetic-pointer quirk in the Browser-pane harness
  (CDP hover does not emit pointermove) is a tooling note, not a bug —
  real pointers drive the staging ghost.
