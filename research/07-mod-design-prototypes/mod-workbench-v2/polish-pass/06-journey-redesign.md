# 06 — Journey redesign (Stream 6)

Date: 2026-07-16. Inputs: `03-fresh-eyes-journey.md` (primary),
`01-inventory.md` (packs / plan / mod-level chrome), `02-design-language-audit.md`
(chrome findings), `mod-workbench-v2.html` as coded. Acceptance bar: the
storyline, prediction, and dead-chrome tests in `../03-polish-goal.md`, judged
at a 1000px-tall viewport. Ground-up: mod-level surfaces may move, rename,
restructure, re-time. No capability deleted.

---

## 1. The narration script

What a stranger should be able to say after ten minutes, unprompted
(10 sentences — this is the test artifact for Stream 8):

1. "This is a workbench: I drag parts from the library onto the board and
   wire them together."
2. "Each part says one thing about the answer I want — a knob for warmth,
   a rule for length."
3. "As I build, the page on the right writes itself: every part becomes one
   plain sentence in the prompt."
4. "Touch a part and its sentence flashes; click a sentence and the board
   shows me its part."
5. "A pack drops a ready-made group of parts inside a named frame, with a
   preset picker on the frame."
6. "The frame, its parts, and their sentences all carry the same tag, so I
   know what came from where."
7. "The bottom of the page says how this will run: one call to the AI, or
   staged calls."
8. "When I switch to staged, I watch the step and arc sentences move down
   into numbered call cards."
9. "Amber notes point out things to tidy — two length rules, an unnamed
   dial — before I use it."
10. "When it reads right, I copy the prompt or export the mod from the top
    of the page."

Every design decision below exists to make one of these sentences true.

---

## 2. Two journey layouts

### 2.0 The shared layout rule (derived first, not a layout choice)

The walkthrough's two worst blockers (scroll void A6; plan at maximum scroll
depth H2/H3) are both symptoms of one architecture: **the journey is stacked
vertically down a scrolling page, so cause (board) and effect (prompt/plan)
can never be on screen together at 1000px.** Any layout that keeps the
prompt below the board fails the storyline test *by geometry* before a pixel
is styled. So the rule both candidates obey:

> **The page never scrolls.** The window is one fixed screen of zones.
> Exactly three regions scroll internally, each visibly framed: the library
> (its list), the board (pans both axes), and the prompt surface (its own
> document). Nothing is ever "below the fold" because there is no fold.

This is the conceptual fix for the scroll void — the sticky-header/void bug
cannot exist because the body never has a scroll position. It is a layout
rule, not a CSS patch. The current stacked-page arrangement is therefore not
one of the two candidates; it is dead on arrival against test geometry.
What remains genuinely contested is **where the prompt surface lives**.

### 2.1 Layout A — THE DESK RETURN (persistent bottom dock)

The board on top; a fixed-height dock (~280px) across the bottom of the
window holding the prompt and the run plan. Modeled on a synth bench: you
play up top, the sheet lies flat in front of you.

- **Zones:** header (52px) / library (left 168px) / board (center+right,
  ~640px tall) / dock (full width, 280px, internal horizontal scroll).
- **Per phase:** empty board → dock shows one line "Every part you add
  writes one sentence here." Building → chips appear in section columns
  laid side-by-side (the current `.secs` row, relocated). Packs → a pack
  gets a tinted column group in the dock. Run → the dock's right end holds
  the run toggle and, when staged, call segments as a horizontal lane
  (the current `plan-track` drawing, which is natively landscape).
- **Board↔prompt link:** wires visually plunge off the board's bottom edge
  toward the dock — "down compiles" as literal geometry. Touch a part,
  its chip pulses in the dock; click a chip, the board pans to the part.
- **Pack membership:** halo frame on the board (same in both layouts,
  §3) + tinted column group in the dock.
- **Feedback:** at the acted-on element on the board; dock events (copy,
  export, regroup) at the dock header.

**Against the tests at 1600×1000:**
- Storyline: passes the board→prompt seam; the plan lane is visible without
  travel. The "wires plunge into the dock" metaphor is the strongest single
  image either layout offers.
- Prediction: the run toggle sits directly above the lane it changes —
  consequence is where you look.
- Dead chrome: neutral.
- **Geometry failure:** header 52 + dock 280 leaves **~640px of board**.
  The seeded demo board is ~900px tall; a single pack cluster is ~500px.
  The primary work surface is cropped worst on exactly the viewport we
  must serve, and every board pan is a chance to lose the plot.
- **Document failure:** a 280px-tall dock forces the prompt into
  side-by-side section columns — which is the *current* `.secs` layout,
  the one the walkthrough showed has no reading order and hides its own
  VIEW AS TEXT panel off the right edge (F6). A prompt is a portrait
  document; a dock is a landscape slot.
- **Regroup failure:** when ONE CALL flips to STAGED, chips must travel
  *horizontally* from their section column to the plan lane — across a
  dock that scrolls horizontally, so the move can exit the visible area.
  The one moment we must stage as visible motion can still happen
  off-screen (H2's failure, shrunk but not fixed).

### 2.2 Layout B — THE PAGE BESIDE THE BENCH (persistent right panel)

The board center; a full-height panel (~400px wide) on the right holding
the prompt as a single vertical document that ends in the run plan. Modeled
on writing at a bench with the page beside you: the prompt is a *document*,
so it gets a portrait surface.

- **Zones:** header (52px: identity, mod name, UNDO — nothing else) /
  library (left 168px, internal scroll) / board (center, ~1000px wide ×
  ~940px tall, pans both axes) / THE PAGE (right 400px, full height,
  internal vertical scroll).
- **THE PAGE, top to bottom:** panel head ("THE PROMPT · written live from
  the board" + COPY · EXPORT · PLAIN TEXT) → notices row (§5 lint) →
  sections stacked vertically, each chip a full-width row (color seam ·
  name · value · its sentence) → **THE RUN** footer (always present, §4):
  run toggle, consequence sentence, call cards when staged.
- **Per phase:** empty board → "The prompt is empty. Every part you add
  writes one sentence here." Building → each new chip slides into its
  section; the sentence *is* the row, no truncation into pills-only.
  Packs → a tagged section group appears (§3). Run → THE RUN footer
  restates the call count live; staged → call cards grow in place.
- **Board↔prompt↔plan link:** one vertical document = the journey read
  top-to-bottom *while the board stays fully visible beside it*. Touch a
  part → its chip flashes; click a chip → board pans to the part and its
  halo flashes (chip click no longer means "edit" — edit moves to a pencil
  on the row, fixing F1's wrong affordance). Prompt and plan are one
  surface, so build→prompt→plan is a single eye path, never a navigation.
- **Pack membership:** halo frame on board + tagged section group in the
  page, same accent, same name (§3).
- **Feedback:** at the acted-on element (board toast at the part / jack;
  page events at the page head). The library footer whisper survives only
  as an `aria-live` mirror for assistive tech, never as the primary channel.

**Against the tests at 1600×1000:**
- Storyline: passes end-to-end; prompt reads as the document it will
  actually become, in the order it will be copied — sections down, run at
  the end. Regrouping is a *vertical* reflow inside a 400px column that is
  always fully in view.
- Prediction: the run toggle lives inside THE RUN, touching the cards it
  regroups; the consequence sentence updates in the same breath.
- Dead chrome: the panel head and run footer each carry actions or state;
  no "PREVIEW" filler survives (§4, §6).
- Cost: board loses ~400px of *width*. At 1600×1000 width is the cheap
  dimension (the window is 1.6:1); the board keeps ~1000×940 visible and
  pans for the rest. Below ~1200px window width the page collapses to a
  drawer (open question, §7).

### 2.3 Verdict

**Layout B — THE PAGE BESIDE THE BENCH — wins.**

Kill reasons for A (the dock), recorded:

1. **It spends the scarce dimension.** At 1000px tall, the dock taxes board
   *height* — the axis the seeded demo already overflows — while B taxes
   width, which the 1.6:1 viewport has to spare.
2. **It re-creates the failed compiler.** A 280px dock forces side-by-side
   section columns — the exact `.secs` arrangement whose reading order and
   hidden text panel the walkthrough flagged. B's vertical document *is*
   the prompt's native shape and the copy-out order.
3. **The climax can still leave the screen.** Horizontal chip travel across
   a horizontally-scrolling dock can exit view; B's regroup is a vertical
   reflow inside an always-visible column. The storyline's payoff moment
   must be un-missable, and only B guarantees it.
4. A's genuine advantage — wires plunging into the dock — is one cosmetic
   image; B keeps the causal link with pulse + pan-to-part in both
   directions, which is what the prediction test actually measures.

Carry-over from A into B: the plunge idea survives in miniature — the
board's right edge carries a faint "→ THE PROMPT" seam where the panel
begins, and a chip flash draws a brief connector from part to panel edge.
(Cheap, optional; cut if it reads as decoration — dead-chrome test governs.)

---

## 3. The pack story

A pack must *arrive*, not detonate (B9/G1/G4). Three moments:

**On click/drag from the library — staging preview.** The cursor carries a
ghost: a dashed frame at drop size containing the pack's parts as faint
outlines, the pack name on the frame tab, and its job sentence under the
name ("Fit the answer to its reader."). Nothing is created yet. Click to
place, Esc to cancel. The stranger sees *before committing* that one row
becomes six parts inside one named frame — the prediction test for packs.

**On landing — the halo frame.** The parts materialize inside a persistent
**pack frame**: a dashed halo (the GROUP VOICE frame pattern, reused) with
a tab at top-left carrying:

- the pack **name** (editable, as today)
- its **job sentence** in plain words ("Set hard limits and safeguards.")
- a **preset picker**: `PRESET: STOCK ▾` — this is what the inventory calls
  the variation select (STOCK / QUICK READ / DEEP DIVE / CUSTOM + save).
  "Preset" is the user word for the whole variation system; "stock" reads
  fine as a preset name. Rename/save/delete of a preset live inside the
  picker's open state, not as five bare glyphs.
- a **status chip** when incomplete: `NEEDS THE READER — fill it in`,
  clickable, pans to the empty field and focuses it (fixes G2).
- overflow menu (⋯) holding: mute pack ("Silence this pack"), duplicate,
  remove — today's icon row (G3), behind one affordance with plain labels.

**The strip dies.** "MOD PACK INSTANCES" (`mod-workbench-v2.html:1026-1029`,
CSS `:135-180`, `renderPackRack` `:2989`) is deleted as a surface. Every
capability it held moves to the frame tab above. The pack's *explanation*
(job, example) moves to the staging ghost + frame tab; its *management*
(presets, mute, duplicate, remove) moves to the tab's picker + menu. Nothing
is lost; the orphan surface is.

**One visible relationship, pack↔parts↔chips.** The frame carries the pack's
accent as its halo tint. In THE PAGE, the pack's chips sit under a group
header: accent seam + pack name + job sentence + the same status chip when
incomplete. Hovering the frame tab highlights the group in the page;
hovering the group header flashes the halo. Membership is never a fact you
remember — it is drawn in both places.

**Auto-naming.** On spawn, if a part's name already exists on the board, the
new part gets a numbered name (`EXAMPLES 2`) *and* a lint notice appears
("Two parts are named EXAMPLES — rename one?", §5). Chips from a pack always
carry the pack name as a small eyebrow (`TRANSLATOR · EXAMPLES 2`), so even
identical base names can't produce two indistinguishable chips (F5's
duplicate-name half; the duplicate-*rule* half is §5).

**What the Editor row was.** For the record: the dropdown labeled
"READER PROMPT / RULES PROMPT" was the pack's rules-prompt selector — the
variation system. In user language it is now simply the preset picker on
the frame. The word "instance" never appears anywhere.

---

## 4. The run story

**The words.** "AUTO PARTS RUN · ONE PASS ⟷ IN STAGES" dies. The concept in
plain words: *when this mod runs, does it make one call to the AI or
several staged calls.* The toggle is relabeled and re-homed:

- Label: **WHEN IT RUNS** — options **ONE CALL** / **STAGED**.
- Home: not the header. It lives at the top of **THE RUN**, the always-
  present footer of THE PAGE — on the surface it changes, touching the
  cards it regroups. (Header keeps identity + UNDO only.)

**THE RUN never no-ops.** It is never hidden (`#plan` loses its `hidden`
default, `:1045`, `renderPlan` `:4056-4057`). Its three states:

1. **ONE CALL:**
   > "Everything above goes to the AI as one prompt — one call."
   Plus one honesty line, once, replacing "AUTHORING PREVIEW · NO RUN
   ENGINE": "Nothing runs from this page — copy or export to use it."
2. **STAGED, but nothing stages:**
   > "Nothing here runs in stages yet. Steps, forks, and arcs become their
   > own calls — add one, or switch back to ONE CALL."
   (This is the current PLAN-button dead click, H1, turned into a sentence
   that teaches what would change.)
3. **STAGED, with staged work:** the call cards.
   > "The prompt above goes first. Then each card below is its own call —
   > 4 calls in all." (Fork ranges: "4 or 5 calls — the fork picks one of
   > two routes when it runs.")

**Call cards** (vertical list, replacing the horizontal `plan-track`):

- `CALL 1 · EXPLORE — Range widely — ten unlike directions before settling.
  (BREADTH 10/10)`
- `CALLS 2–4 · WARMTH ARC — warmth held at 3/10, then 9/10, then 4/10 —
  one call per stage.`
- `CALL 5 · FORK · DECIDES ITS OWN ROUTE — First decide: which way to go.
  Then path A or path B — one of the two runs.`

Each card keeps its part's accent and name; conditional segments say
"one of the two runs" instead of the bare "POSSIBLE".

**Chips regroup visibly — nothing vanishes.** Flipping to STAGED animates
each affected chip (FLIP) from its section down into its call card. In the
vacated section slot a grey **stub** remains: `EXPLORE → runs as CALL 1`,
clickable, scrolls to the card. So the section never silently loses
content, the instruction count never mysteriously drops (H2), and the
transformation is watchable inside one always-visible column. Flipping back
animates them home and removes the stubs.

**Per-part fidelity, same words.** The per-part setting (curve/fork/step
"FIDELITY: ONE PASS / IN STAGES / AUTO") is renamed to match:
**RUNS: FOLLOWS THE MOD ▾ / ALWAYS IN THE ONE CALL / ALWAYS ITS OWN
STAGE.** A part pinned to its own stage shows a small `STAGED` tag on its
board face — the header lever and the part setting finally speak one
language (fixes H4's orphaned echo, and audit S4's four-widget scatter).

---

## 5. Contradiction lint

A visible, plain-words nudge on the prompt surface — never a modal.

**Where:** a **notices row** at the top of THE PAGE, under the panel head.
Collapsed: an amber dot + `2 THINGS TO TIDY`. Expanded (click): one row per
notice, each a single sentence + one action. Additionally, each affected
chip carries a thin amber left seam (the sanctioned `--mui-yellow` rare
state mark — this is its one legitimate meaning; the silent-member tooltip
loses it, per audit Co4).

**What it catches (launch set), with exact copy:**

| Condition | Detection | Notice copy | Action |
| --- | --- | --- | --- |
| Two rules on one dimension | ≥2 chips in one section with the same base label (the two LENGTHs), or same-label parts board-wide | "LENGTH is set twice — the prompt says it two ways." | SHOW BOTH (flashes both chips) |
| Unnamed part speaking | part label equals its kind name (DIAL, SLIDER…) and it emits | "This dial has no name — its sentence is just 'Dial: 50%.'" | NAME IT (opens title field) |
| Placeholder prose | frame/paths/look-at still byte-equal to stock text (FORK's tautology) | "FORK still says the starter text — give its paths real names." | OPEN (opens settings) |
| Pack incomplete | `packCompleteness` ≠ READY (`:2818`) | "TRANSLATOR needs THE READER filled in." | GO THERE (pans + focuses) |
| Orphan description in prompt | description compiled as a standalone sentence (F3's floating "How strongly to commit to opinions.") | "CONFIDENCE's note is being read out as a sentence." | SHOW |

Rules: notices persist while true and disappear when fixed — no dismissal
state to manage. The count in the collapsed row is the only badge. Copy
style: name the thing, say what the prompt does wrong, offer one verb.

---

## 6. Navigation truth

- **WORKBENCH / PROMPT / PLAN header buttons are deleted** (`:923-928`,
  handler `:6675-6686`). Under the no-page-scroll rule there is nothing to
  jump to: the board, the prompt, and the run are all always on screen.
  Honest tabs were the fallback if zones couldn't fit; they can, so no
  tabs. UNDO stays in the header, now visually alone — an action no longer
  disguised among fake tabs (I1).
- **Scroll void:** fixed by construction (§2.0) — `body` never scrolls, the
  sticky plate and its void cannot occur. The three internal scroll areas
  each show a frame edge so "this region scrolls" is visible.
- **VIEW AS TEXT** becomes **PLAIN TEXT**, a toggle in the page head that
  swaps the chip document for the compiled `<pre>` *in the same panel
  viewport* (fixes F6's off-screen append). Same surface, two renderings —
  visibly a mode of the page, not a hidden appendix.
- **Header counts** ("PROMPT PREVIEW · 15 PARTS · 14 WIRES") leave the
  header. Parts/wires belong to the board (small board-corner readout);
  sentence and call counts belong to THE PAGE ("12 sentences · one call"
  in the page head, live). The ● status dot dies (A2, audit C2).
- **Feedback rule** (systemic, replaces the whisper channel B3/C3/F7/I2):
  feedback renders where the action happened — a toast tag at the new part
  ("DIAL ADDED"), at the jack on wiring errors with the *reason*
  ("ALREADY WIRED — unplug first" / "NEEDS A RANGE, GOT A NUMBER"), at the
  button on copy/export. `#palHint` remains only as an off-screen
  `aria-live` mirror.

---

## 7. Implementation checklist

Wave-c work (Stream 7), mapped to current code. All refs
`docs/design/prototypes/mod-workbench-v2.html` unless noted.

**Layout shell**
- [ ] Replace page flow with fixed grid: header / library / board / page.
      Body `overflow: hidden`. Rework `.plate` (`:29-70`), `.cols` (`:72`),
      `.boardWrap` (`:183-198`), and move `<section class="compiler">`
      (`:1031-1054`) into the right panel. Delete sticky offsets
      (`:32`, `:76`, `:185`).
- [ ] `.secs` horizontal flex (`:682`) → vertical section stack; chip =
      full-width row (name · value · sentence). Mobile fallback block
      (`:794-806`) becomes the <1200px drawer variant.
- [ ] Delete `.wb-jumps` markup (`:923-928`) + handler (`:6675-6686`);
      keep `#undoBtn`.
- [ ] Header slims to identity + mod name + UNDO; status (`:918-922`,
      updater near `:6639`) moves: parts/wires → board corner, sentences/
      calls → page head.

**Run surface**
- [ ] Move lever markup (`:929-939`) into THE RUN footer; relabel WHEN IT
      RUNS · ONE CALL / STAGED. `modLever` semantics (`:3287-3303`)
      unchanged.
- [ ] `#plan` never hidden (`:1045`, `renderPlan` `:4052-4083`); implement
      the three states of §4; `plan-track` horizontal segments (`:867`,
      `:4060-4082`) → vertical call cards.
- [ ] Regroup animation + stubs: on lever change, FLIP affected chips
      between section and call card; stub row `X → runs as CALL n` in
      `renderCompiler` (`:3775`), driven by `inStages(it)` (`:3303`).
      Kill the "As part of the work: …" silent degradation note mismatch
      (`cardSpecs` `:3542`, step clause `:3566`).
- [ ] Rename per-part FIDELITY chips/settings to RUNS: FOLLOWS THE MOD /
      ALWAYS IN THE ONE CALL / ALWAYS ITS OWN STAGE (foot chips
      lib `mod-ui.css:1106`; config rows for curve/fork/step). Add `STAGED`
      face tag for pinned parts.

**Packs**
- [ ] Staging ghost on pack drag/click before creation, in
      `dropPaletteKind` (`:3179-3186`).
- [ ] Pack halo frame: reuse/adapt the group frame (`addGroup` `:6482`) to
      wrap spawned parts; tab = name + job (`PACK_META` `:2809-2817`) +
      preset picker + status chip + ⋯ menu. Wire `createPackInstance`
      (`:2838-2860`) to create the frame.
- [ ] Delete pack bay markup (`:1026-1029`), CSS (`:135-180`); port
      `renderPackRack` behaviors (`:2989-3092`) — variation select→preset
      picker, mute/duplicate/remove→menu, completeness→status chip
      (`packCompleteness` `:2818`).
- [ ] Auto-number colliding names in the pack drop functions
      (`:6216-6380`) or centrally in `createPackInstance`; add pack
      eyebrow to chips in `renderCompiler`; page group header per pack.

**Lint**
- [ ] New `lintPrompt()` over `compilerEntries` (`:4181`) + `cardSpecs`:
      duplicate base labels, kind-named emitters, stock-text frames,
      `packCompleteness`, orphan descriptions (F3 leak — chip subtitle
      compile path in `renderCompiler`). Notices row component in page
      head; amber chip seam (respect audit Co4: yellow = state mark only).

**Linking + feedback**
- [ ] Chip click → select + pan board to part (reuse `scrollIntoView`
      pattern `:3188`) + halo flash; edit moves to a pencil on the row
      (current click-to-edit at `:4141` / `startCardEdit` `:4086`).
      Part touch → chip flash.
- [ ] Site-local toast component; reroute the ~20 `palHint.textContent`
      writes (`:1099-3909` passim) to it; keep `#palHint` as visually-
      hidden `aria-live`.
- [ ] Wiring refusals: reason text at the jack (`slotRefusalReason`
      call sites `:2621`, `:2629`; cancelled path `:2630`).
- [ ] PLAIN TEXT in-place toggle (`#txt` `:1053`; handler near `:3840`).

**Depends on other streams:** chip anatomy, state-word lexicon, and type
sizes come from Stream 4's grammar spec; part faces from Stream 5. This doc
fixes *where surfaces live and what they say*, not their tokens.

## 8. Open questions left for implementation

1. **<1200px behavior:** page collapses to a right drawer or bottom sheet —
   pick in the browser, judged by the same tests at 1280×800.
2. **Stub vs gray-tag** for regrouped chips: stubs are specced; if they
   read as clutter in practice, fall back to the chip staying in place,
   grayed, tagged `CALL 2`. A/B in the running prototype.
3. **Pack halo implementation:** reuse GROUP VOICE's frame (risk: inherits
   its voice/gate semantics) vs a new lighter frame class. Decide at code
   time; the visible contract above is fixed either way.
4. **Board→panel connector flash** (the carried-over plunge idea): keep
   only if it survives the dead-chrome test in situ.
5. **Call ordering** when several chains + arcs + forks coexist: current
   `planTracks()` order is accepted as-is; revisit only if the vertical
   card list makes an ordering feel wrong.
