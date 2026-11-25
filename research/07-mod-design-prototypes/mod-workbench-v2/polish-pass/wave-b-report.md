# Wave B report — part faces + settings

Date: 2026-07-16. Branch: `mod-workbench-polish`, commits `43710bb..` (5
commits on top of Wave A's `c1f732b`). Scope: `docs/design/prototypes/lib/*`
+ `mod-workbench-v2.html` per `05-part-specs.md` and rulings #1/#3/#6 in
`07-orchestrator-decisions.md`. Journey surfaces (compiler strip, plan
strip, pack strips, header lever) untouched — Wave C's.

## What changed, per part class

### Controls (commit `43710bb` + settings in `5dfca0e`)

- **Speech row (SC1/SC3)** shipped as a lib face element: every control
  face can carry its live compiled sentence — the SAME string as its
  compiler card (host-fed via `api.setSpeech`). OFF faces show the
  ink-faint ghost would-say (ruling #2): switch → its ON sentence, empty
  WORDS → "Type words to add a sentence.", frameless SELECT pick →
  "No sentence for X yet — add one in settings.", REVISE 0 → "Would
  check the draft before showing it." (extends Wave A deviation 1). The
  old `.wb-ghost-say` bottom overlay died. Fit rule: whole-sentence or
  shed — no ellipsis ever; per-kind lg-only gates for pad/order/mixer/
  fork/curve.
- **DIAL** — bespoke `h<96` xs gate died; one width rule (SC2).
- **SLIDER** — END NAMES land: face micro labels at the track ends
  (measure-shed, handle-proximity yield), named-value readout
  `40% · NEAR RELAXED`, END NAMES settings field.
- **SWITCH** — ghost rides the speech row; OFF chip relocates to the
  top-right corner at sm/xs so the full title keeps its row (closes
  Wave A deviation 6).
- **COUNT** — face reads `3 / 10` (suffix = tertiary, sheds at sm);
  jack chip speaks the ×10: `SOURCES · 3 — sends 30 of 100 (each step
  is 10)`.
- **WORDS** — min 2×1; ghost placeholder; jack chip declares the length
  proxy AND read-only: `… · 10 letters — sends how long the text is,
  not the words · lenses can look, not write`.
- **PAD** — axis end names from sm up (were lg-only); permanent micro
  `Y`/`X` letters beside the two out-dots; dual-sentence settings
  (SENTENCE · X / SENTENCE · Y).
- **RANGE** — readout IS the sentence fragment: `between 30 and 70`
  (numeric fallback via the existing fit tiers); jack chip `— sends a
  window (two numbers)`.
- **FILTER** — primary read is the limit in words: `NO MORE THAN 40` /
  `AT LEAST 25` / `BETWEEN 30–70`; mode chip stays the fast toggle,
  duplicated on purpose with the settings LIMIT TYPE row (hover-marks
  the face chip).
- **CURVE** — POSITION → **NOW** everywhere the user reads it (jack
  label, slot display name, announcements); unwired NOW renders hollow
  at .5 with a visible 9px NOW micro label; `ew-resize` scrub cursor +
  "Drag to preview across the answer" cue; readout forms per R2.4:
  `3 PTS · PEAK 90` at rest, `NOW n/10` when wired.
- **SELECT** — default drop 3×2; the speech row carries the picked
  option's SENTENCE; frameless options render dashed-hollow before and
  after the pick; settings SENTENCES accordion (one option open at a
  time). Jackless stays jackless.
- **ORDER** — jack chip declares the shuffle-distance semantics +
  read-only; ITEMS field carries the reset warning inline.
- **MIXER** — jack↔fader pairing both ways (hover fader blooms jack,
  hover jack highlights fader); per-channel chips `EVIDENCE · 50% —
  sends this channel's share (0–100) · lenses can look, not write`;
  min 3×2 for 5–6 channels; SNAP (OFF/5/10/25) replaces STOPS and the
  inert STOP NAMES (ruling #3).
- **GROUP VOICE** — declassified from 13th control: palette row moves
  behind a hairline with a dashed frame mark and "A frame — drop
  controls inside." The frame gains a tab gear opening a NEW popover
  (WHAT IT SAYS NOW · NAME · THE GROUP'S SENTENCE with member chips
  that insert slots — `{TOKEN}` syntax hidden · member speak-states);
  the halo reserves a top band for a speech row showing the RESOLVED
  sentence; gated (a member OFF) → tab chip `OFF — <MEMBER> IS OFF`,
  dotted halo, ghosted sentence with `⟨…⟩` at the silent slot.

### Settings template (SC4, commit `5dfca0e`)

- **WHAT IT SAYS NOW promoted to the top** of every popover (lib-owned,
  host-fed via `saysNow`), repainting + flashing on every edit; the old
  bottom "PROMPT AT CURRENT VALUE" block died.
- Order everywhere: SAYS NOW · NAME · part-specific · SENTENCE · WHERE
  IT GOES · MAKE THIS THE DEFAULT · NOTE (lib builds NOTE, appends it
  last; host inserts its block before it).
- **NOTE never compiles (ruling #1)**: `descSentence` and every card
  `meta` died — no compiler surface reads the note; helper says "For
  you — the prompt never reads it."
- **Renames (ruling #6)**, label-only: Title→NAME, Steps→STOPS,
  Y steps→VALUE STOPS, Detent names→MOMENT NAMES (+ five-moments
  helper), Over→ACROSS, Stop names→STOP NAMES (+ count-dependency
  helper), fork Look at→HOW TO DECIDE, path Name→PATH NAME, revise Look
  at→CHECK AGAINST, Strictness→HOW STRICT, When it falls short→IF IT
  FALLS SHORT, Fidelity→RUNS (journey words: FOLLOWS THE MOD / ALWAYS
  IN THE ONE CALL / ALWAYS ITS OWN STAGE), Says→SENTENCE (+ {value}
  helper), Prompt section→WHERE IT GOES, SET AUTHORED DEFAULT→MAKE THIS
  THE DEFAULT (+ TRIM helper), Description→NOTE, pad Axis title→AXIS
  NAME, pad Steps→STOPS.
- **No vanishing fields**: dial/slider STOP NAMES renders disabled with
  "Turn on STOPS first." instead of `display:none` (fixes `js:2326`).
- **Duplicated chips declared** (SC4): filter LIMIT TYPE, revise HOW
  STRICT, and RUNS rows carry "(also a chip on the face)"; hovering the
  RUNS/LIMIT TYPE row marks the face chip.
- STAGE: per-stop sentences read `SENTENCE · EXPLORING` etc.; the
  slider-only END NAMES field is removed for stages.

### Work steps (commit `4a2ee84`)

- **Settings gear added** (closes Wave A deviation 4 for steps): WHAT
  THIS CALL SAYS (live clause/call preview) · the fixed identity
  ("EXPLORE — a fixed step.") · WHAT IT DOES (prose) · RUNS (journey
  words). No NAME field by design.
- **RUNS foot chip is now a value chip from the resolver**: `AUTO · →
  ONE CALL` / `AUTO · → CALL n` — the chain-collapse answer on the
  face; the toggle moved into settings (`shell.setFidelity`).
- **Permanent 9px port labels** IN / OUT / <SIGNAL> — the three-port
  legend is the labels themselves.
- **Jack words (SC5)**: out `hands the work on`, in `takes the work
  in`, tune-ins per verb (`BREADTH — takes a number that tunes this
  step: how wide to range`, GROUPS/STRICTNESS/HOW HARD/DEPTH likewise).
  REFRAME/COMBINE answer their asymmetry in settings + palette tooltip:
  "This step has no tuning input."

### Visualizers (commit `45baf86`)

- **One self-description per lens (SC6)**: `VIZ_ONE` is the single
  source for the palette tooltip, the hover title, and a NEW
  empty-face invitation line (13px, centered in the well, dies on the
  first wire). Canvas-drawn `UNWIRED` scrawls in wave/branches/ladder
  died for it; the UNWIRED state chip stays.
- **STEPS the lens → LADDER** (ruling #6): board title, palette row,
  description.
- **SEMANTIC WAVE**: GRID→SNAP, WAVES→ECHOES; six shown-as chip texts;
  min raised to 5×3.
- **RADAR**: min 4×4; `+`/`−` labeled "add an axis"/"remove an axis";
  grab ring drawn only around verts a drag would actually write back.
- **MATRIX**: `ONTO →` / `FROM ↓` axis legend; row/column chips speak
  shown-as.
- **WINDOW**: the one description ("How much room your limits leave —
  and whether they agree.") replaces the old VIZC question.
- **TRIM**: foot caption `VS EACH PART'S DEFAULT` (pairs with the MAKE
  THIS THE DEFAULT rename); lanes with no default sense render dashed
  with "No default to measure against" on hover.
- **BEAM** default 4×2; READOUT PAIR keeps its distinct title; rail-in
  chips across levels/grid/bandings/constellation/window/score/readout/
  beam/trim speak `takes a number — shown as <what>`; CONSTELLATION's
  DRIFT and SCORE's POSITION carry their own shown-as words.
- **Settings: none, on purpose** — all 15 lenses have no gear (0/26
  gears verified live); a lens is configured by wiring.

### Palette (commit `10d5975`)

- Every row states its JOB under its name (SC7): the DIAL/SLIDER,
  RANGE/FILTER, SELECT/FORK disambiguations said flat out; tooltips
  carry the longer line (FORK's says "SELECT is you choosing now; FORK
  decides when it runs.").
- Group header Steps → **Work steps**; STAGE tooltip rewritten to "Tell
  the AI which phase the work is in — each phase speaks its own
  sentence."; pack rows gain their job sentence over the DROPS chip.
- Gallery kept current: NOW jack idle state, speech row, slider end
  names, ×2 PASSES, step RUNS chip + port labels all render as
  specimens.

## Deviations / smallest-choice calls

1. **Slider end names shed by measure, not size class alone**: on
   tracks under 150px the names shed entirely, and the name nearest the
   handle yields (opacity 0) — the spec's 9px-at-both-ends is honored
   only where it physically fits; the readout hint carries the names
   below that.
2. **Speech-row size gate is height-based** (`h≥118px` ≈ 2 rows) plus
   the whole-fit check, not the sz-* width classes — a 2×2 dial is
   width-class sm but the spec's default face includes the sentence, so
   fit decides, not the class.
3. **STAGE's stops and sentences are adjacent, not composited**: STOPS +
   STOP NAMES (lib) followed by `SENTENCE · <STOP>` rows (host) — the
   spec's single name+sentence rows per stage would need a bespoke
   stage popover; the pairing is now legible by naming, logged as a
   follow-up.
4. **MIXER min-cells are read at creation**: raising channels 4→5 via
   settings does not retroactively raise an existing part's board
   minimum (the next drop honors it). Board enforcement of live min
   changes is resize plumbing left for the journey wave.
5. **BRANCHES keeps its 56px gutter at all widths** — the spec's
   "labels move into the well below 5 cols" is not implemented; its min
   (4×3) keeps the gutter legible. Logged for the reviewer.
6. **READOUT's odometer grab cue not added** — two-way drag works and
   the cursor signals it (`ns-resize`); the RADAR-style grab-dot ring
   was not ported to the odometer digits.
7. **CONSTELLATION's DRIFT dot stays at its bottom-left home** — it
   gained the shown-as caption via its chip, but was not redrawn onto
   the shared rail spine.
8. **Palette job lines slightly exceed six words in three rows**
   (STAGE, FORK, REVISE) — the spec's own job phrasings were kept over
   the word limit.
9. **EXPLORER preset chips stay on the BRANCHES lens** (SURVEY/BALANCED/
   DECIDE) — ruling #4 moves them to the pack frame tab, which is
   journey §3 surface (Wave C owns pack halos/tabs).
10. **`aria-label` on palette rows now includes the job text** ("Add
    DIAL Set one amount.") — verbose but harmless; Wave C's palette
    pass can trim.

## Verification evidence

Served via background `python3 -m http.server 8123` (launch.json's proto
runner can't chdir on this host). Tooling note confirmed and extended:
in the Browser pane, **rAF and ResizeObserver only run while frames are
being composited** — taking a screenshot pumps frames; deep asserts were
DOM/computed-style queries run after a screenshot pump. No programmatic
scrolls before screenshots.

- **Zero console errors** on `mod-workbench-v2.html` and
  `lib/gallery.html` after every commit, including with all 45 palette
  rows placed (98 parts on board).
- **One of every part placed** (45 palette clicks → 98 parts incl.
  packs): no errors, all faces render.
- **Every settings popover opened live** (65 control/process popovers):
  first field `What it says now`, last field `Note`, in all 65; step
  popovers open from all 7 gears (first field `What this call says`);
  0/26 visualizers have a gear.
- **WHAT IT SAYS NOW is live**: editing SENTENCE re-renders the top
  preview (dial: `Warmth: 72%.` → template edits repaint on input).
- **NOTE never compiles**: set `SECRET NOTE NEVER SPOKEN` as a note →
  absent from VIEW AS TEXT; zero `.mui-card-meta` nodes on the page.
- **Faces**: COUNT `3 / 10`; RANGE `between 30 and 70`; FILTER
  `NO MORE THAN A SECTION` (named stops); CURVE `3 PTS · PEAK 90` and
  NOW micro label (wired seed hides it, idle probe shows it); SELECT
  frameless cells dashed (2 of 3) with picked-sentence speech row and
  the repair ghost on a frameless pick; REVISE `×2 PASSES`; FORK
  eyebrow `DECIDES WHEN IT RUNS`; GROUP VOICE frame speaks
  `Consider 3 approaches, developing each thoroughly, for a busy
  founder.` and gates with `OFF — READER IS OFF` when READER empties.
- **Sizes**: 1×1 dial → xs, knob + `72%` only, title on the hover chip
  (`WARMTH · 72%`), speech shed; 5×1 slider → lg with both end names +
  `40% · NEAR RELAXED`; screenshot-confirmed at both.
- **Steps**: EXPLORE→CLUSTER chain reads `AUTO · → ONE CALL` both at
  ONE PASS and `AUTO · → CALL 1` / `AUTO · → CALL 2` at IN STAGES;
  port labels IN/OUT/BREADTH on the face; tune chip `BREADTH — takes a
  number that tunes this step: how wide to range`.
- **Teach-on-drag**: arming WARMTH bloomed 103 compatible inputs, all
  with per-part word labels (`…HEIGHT — takes a number, shown as how
  tall the line swings`, `NOW — takes a number that moves the NOW
  marker`, `takes a number — shown as a bar, out of 10`, …) — Wave A's
  generic fallbacks no longer appear on the seeded board.
- **9px floor**: runtime computed-style sweep with all 98 parts placed
  found **zero** text nodes (HTML or SVG) below 9px.
- **Palette**: 13 control jobs render; GROUP VOICE is the separated
  last row with one frame mark; group header reads "Work steps";
  LADDER row present; search still matches job words (`between` →
  slider + range).

## Hand-off notes for Wave C

- `ModUI.control` now accepts `saysNow` (top-of-popover preview) and
  exposes `setSpeech(text, ghost)` — the journey page can reuse both.
- Steps expose `shell.setRuns(text)` / `shell.setFidelity(v)`;
  `stepRunsWord(it)` is the resolver-to-words helper.
- The GROUP VOICE tab gear/popover is voice-frame-only; pack halo
  frames must NOT inherit it (ruling #5) — build the pack tab as a
  sibling variant.
- EXPLORER's SURVEY/BALANCED/DECIDE chips await the frame tab
  (ruling #4), still on the BRANCHES lens today.
- `VIZ_ONE` is the single lens-description source — the journey page
  should read it rather than restating.
