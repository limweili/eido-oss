# 05 — Per-part face / settings / resize specs (Stream 5)

Date: 2026-07-16. Inputs: `01-inventory.md` (ground truth),
`04-grammar-spec.md` (BINDING — R-rules and tokens referenced throughout),
`06-journey-redesign.md` (context: THE PAGE, pack halos, RUNS words),
`../03-polish-goal.md` (5-second / settings / size tests = acceptance).
File refs as in the inventory (`wb` / `js` / `css`).

Covers every palette row: 13 Controls (incl. GROUP VOICE), 3 Process,
7 Steps, 15 Visualizers, 7 Mod packs. Conventions first; entries only
record deltas from the conventions.

---

## Shared conventions (SC)

### SC1 — Face anatomy

Every board part uses the R4 shell and header
(`[class mark] [TITLE] … [state chip] [hover: gear ×]`). Below the header:

- **Instrument** — the play surface (knob, track, well…). Never sheds.
- **Readout** — the current value in the part's own terms (R2.4 value
  grammar: `62%`, `ON`, `×3`, `3 / 10`, `between 30 and 70`, a stop name).
- **Speech row** — NEW, the "effect" element: the part's live compiled
  sentence, 13px sentence case, ink-soft, max 2 lines. Renders only when
  the WHOLE sentence fits (shed, don't shrink — no ellipsis ever); when it
  doesn't fit, the readout's *named-value* form is the hint and the full
  sentence lives on the title hover chip and in THE PAGE. The speech row is
  the same string as the part's compiler card — face and page always agree.
- Each entry names its **primary read**: the one element a 5-second glance
  should land on.

### SC2 — Sizes and shedding (extends R4.5)

- Size classes from the lib thresholds (`xs/sm/md/lg`), unchanged.
- **Universal shed order:** ① speech row → ② the part's named *tertiary*
  row (foot chips, sublabels, numerals) → ③ readout long form → short form
  (named → numeric) → ④ at `xs`, title → hover chip `LABEL · value`.
- **Never sheds:** class mark, instrument, jacks, state chip.
- **Default drop size** (per entry) must show identity + value + hint
  (speech row where h≥2; named-value readout where h=1). Satisfies R4.2's
  full-title rule.
- **Min size** = smallest at which the instrument is still operable AND the
  face is not unlabeled (R4.5). Parts refuse smaller.
- All parts are resizable unless the entry says otherwise.
- DIAL's bespoke `h<96 → xs` gate dies; all controls share the width
  thresholds + the lib-wide `h<52 → xs` rule (fixes inventory DIAL defect 2).

### SC3 — Silence has a face, and a prediction ghost

Per R4.3/R6: a part contributing nothing wears wash fill + `OFF` state
chip. ADDITION (grammar-extension, flagged in Conflicts §): where the face
has a speech row, an OFF part shows a **ghost speech row** — ink-faint, the
sentence it WOULD say if active (switch: its ON sentence; empty WORDS:
"Type words to add a sentence."). The compiler card stays per R6.2 (no
fabricated sentence); the ghost lives on the face only, because the face is
where the prediction test happens.

### SC4 — Settings popover template

Top-down order, all parts that have settings:

1. **WHAT IT SAYS NOW** — the live sentence preview, PROMOTED to the top
   (was the greyed last-row "PROMPT AT CURRENT VALUE"). Every field edit
   below re-renders it immediately and flashes the changed words. This is
   the teaching element: field → consequence, before committing.
2. **NAME** (was "Title").
3. *Part-specific fields* (per entry), grouped, most-reached-for first.
4. **SENTENCE** (was "Says") — "What this part says in the prompt.
   `{value}` is where the current setting goes." Per-part example
   placeholder unchanged.
5. **WHERE IT GOES** (was "Prompt section") — section dropdown.
6. **MAKE THIS THE DEFAULT** (was "SET AUTHORED DEFAULT") — helper text:
   "TRIM measures how far you've moved from this."
7. **NOTE** (was "Description") — helper: "For you — the prompt never
   reads it." (Compile-leak decision flagged in Conflicts §.)

**No vanishing fields.** A field that doesn't currently apply renders
disabled with an inline reason ("Turn on STOPS first"), never
`display:none` (fixes the hidden Stop-names defect, `js:2326`).

**Quantize renames** (kills the "steps" triple meaning): the config field
"Steps" → **STOPS** (`OFF / 2–10`); "Stop names" → **STOP NAMES**, helper
"One name per stop — 4 stops need 4 names." The count-vs-names dependency
is stated, not silent (fixes RANGE defect 3).

**Duplicated foot chips** (filter mode, fork/curve/step RUNS, revise
strictness): the face chip and the settings row are one state, rendered
twice on purpose — chip = fast toggle, settings row = the complete story.
The settings row carries a micro note "(also a chip on the face)" and
hovering it highlights the face chip.

### SC5 — Jack word-labels (per R1.3)

Hover/drag chip templates; entries give the filled-in text.

- number out: `NAME · 62 — sends a number (0–100)`
- window out: `NAME · 30–70 — sends a window (two numbers)`
- shape out: `NAME · 3 points — sends a shape that changes across the answer`
- read-only outs (words/order/mixer) append `· lenses can look, not write`
- work out (steps): `hands the work on`
- work in (steps): `takes the work in`
- tune in (steps): `SIGNAL — takes a number that tunes this step`
- viz rail in: `takes a number — shown as <lane/bar/axis…>`

All jacks per R1: round signal / square artifact, chevroned inputs,
24×24 hit, teach-on-drag bloom/fade. Entries list count + sides only.

### SC6 — Visualizer conventions

- No identity mark, no accent, ins only (R8). One shell (`vizShell`, R4.1).
- **One self-description per lens**: the palette tooltip, the hover title,
  and the empty-state line are one string (single source; fixes WINDOW's
  two descriptions).
- **Empty face teaches**: unwired, the well shows one plain invitation line
  (13px ink-soft) + `UNWIRED` state chip; both die on first wire. This
  replaces `EMPTY · WIRE INPUT` and every "PREVIEW" chip (R2.3).
- Wired: the wired sources' NAMES are the lens's labels (secondary, 9px,
  wire-accent seam). **Names are secondary, numerals are tertiary** — at
  `sm` numerals shed, names stay; no lens is ever unlabeled at an accepted
  size (R4.5; kills the five bespoke `display:none` ladders).
- **Settings: none** for all 15 lenses (explicitly decided — a lens is
  configured by wiring; growth chrome `+`/`−` stays face chrome). No gear.
- Rail dots pair visibly: hovering a lane/bar/axis blooms its rail dot and
  vice versa.

### SC7 — Palette rows

Per R8.4: class mark at left, name, and a **stated job** — one short verb
phrase, ≤6 words, distinct within the palette (this is where the
DIAL/SLIDER, RANGE/FILTER, SELECT/FORK disambiguation is stated flat-out).
Tooltips carry the longer one-liner.

---

## CONTROLS

### DIAL — job: "Set one amount."
- **Face (default 2×2):** header; knob (primary read) + `62%` readout;
  speech row ("Warmth: 62%."). Stepped → ticks + stop name = tertiary.
- **Sizes:** min 1×1. Shed per SC2; at 1×1 knob + `62%` only, title on
  hover chip. Width-only `xs` gating (SC2).
- **Settings (SC4):** WHAT IT SAYS NOW · NAME · STOPS · STOP NAMES
  (disabled until STOPS on) · SENTENCE · WHERE IT GOES · DEFAULT · NOTE.
- **Jacks:** 1 round out, right. Chip: `WARMTH · 62 — sends a number (0–100)`.
- **Disambiguation:** DIAL = one headline amount; big-value read. Palette:
  "Set one amount."
- Changes vs current: + speech row; xs gate unified; Stop-names no longer
  hidden; preview promoted.

### SLIDER — job: "Slide between two named ends."
- **Face (default 3×1):** header; track (primary read) with **end names**
  at both ends (9px micro — NEW field, the slider's reason to exist);
  readout `40% · NEAR RELAXED` (named-value hint at h=1). Speech row at h≥2.
- **Sizes:** min 1×1. Tertiary = end names; then named→numeric readout
  (existing `fitScalarReadout` keeps its rule).
- **Settings:** SC4 + **END NAMES** (low / high, e.g. RELAXED / FORMAL) +
  STOPS + STOP NAMES.
- **Jacks:** 1 round out, right. Chip: `FORMALITY · 40 — sends a number (0–100)`.
- **Disambiguation vs DIAL:** a slider is a position between two named
  poles; a dial is a bare amount. The end names make that visible.
- Changes vs current: + end names (new setting + face labels); named-value
  readout; preview promoted.

### SWITCH — job: "Say one thing — or nothing."
- **Face (default 2×1):** header; capsule toggle (primary read); readout
  `ON` / `OFF`. OFF → wash + `OFF` chip per SC3. At h≥2 speech row (ON:
  its sentence; OFF: ghost of the ON sentence — the polarity teacher).
- **Sizes:** min 1×1. Tertiary = readout word (toggle state is visible
  without it).
- **Settings:** SC4 (no stops). SENTENCE helper: "Spoken when ON. OFF says
  nothing."
- **Jacks:** 1 round out, right. Chip: `NO HEDGING · ON — sends 0 or 100`.
- Changes vs current: silence visible (wash + OFF chip + ghost sentence);
  preview promoted.

### COUNT — job: "Pick how many."
- **Face (default 2×1):** header; `− 3 +` capsule (primary read); readout
  **`3 / 10`** — the ceiling is now on the face (fixes defect 2). Speech
  row at h≥2 ("Sources: 3.").
- **Sizes:** min 1×1. Tertiary = `/ 10` suffix.
- **Settings:** SC4.
- **Jacks:** 1 round out, right. Chip: **`SOURCES · 3 — sends 30 of 100
  (each step is 10)`** — the ×10 coercion spoken where it flows (fixes
  defect 1); a lens reading "30" is now predicted, not a surprise.
- Changes vs current: `/ 10` ceiling on face; jack chip declares the ×10;
  preview promoted.

### WORDS — job: "Type words the prompt will use."
- **Face (default 4×1):** header; text field (primary read). Empty → wash +
  `OFF` chip + ghost placeholder "Type words to add a sentence." At h≥2
  speech row shows the full compiled sentence.
- **Sizes:** min 2×1 (raised from 1×1 — a 1-cell text field is unusable).
- **Settings:** SC4.
- **Jacks:** 1 round out, right. Chip: **`THE READER · 10 letters — sends
  how long the text is, not the words · lenses can look, not write`** —
  both hidden semantics (length proxy, read-only) spoken at the jack;
  drag-time fade (R1.4/R1.7) covers the rest.
- Changes vs current: empty-state visible; jack declares length-proxy +
  read-only; min raised; preview promoted.

### PAD — job: "Two amounts in one gesture."
- **Face (default 2×2):** header; dot-grid well + handle (primary read);
  **axis end names at the well edges from `sm` up** (9px — no longer
  lg-only; they are the pad's only self-explanation, so they are
  *secondary*, fixing defect 2). Readout `40 · 65` = tertiary. Speech rows
  (two short clauses, one per axis) at lg only.
- **Jack labels on the face:** micro letters **`Y`** and **`X`** (9px)
  beside the two out-dots (fixes defect 1 — jack identity without hover).
- **Sizes:** min 2×2.
- **Settings:** WHAT IT SAYS NOW (shows BOTH sentences — teaches the
  two-cards behavior, defect 3) · NAME · X AXIS block (AXIS NAME · END
  NAMES · STOPS · SENTENCE) · Y AXIS block (same) · WHERE IT GOES ·
  DEFAULT · NOTE.
- **Jacks:** 2 round out, right (Y top, X mid). Chips: `MEET THEM · X ·
  40 — sends a number (0–100)` / same for Y.
- Changes vs current: axis names from sm; X/Y face letters; dual-sentence
  preview; preview promoted.

### RANGE — job: "Keep it between two points."
- **Face (default 3×1):** header; two-handle track (primary read); readout
  **`between 30 and 70`** (or stop names) — the readout IS the sentence
  fragment, so the hint is built in. Speech row at h≥2.
- **Sizes:** min 2×1. Tertiary: none beyond SC2 (named→numeric readout
  fallback stays).
- **Settings:** SC4 + STOPS + STOP NAMES (always shown, with the
  count-dependency helper).
- **Jacks:** 1 round out, right (capsule silhouette dies per R1.1). Chip:
  **`NOVELTY · 30–70 — sends a window (two numbers)`**.
- **Disambiguation vs FILTER:** RANGE is always two-sided — "keep it
  between". Palette job says so.
- Changes vs current: oval jack → round + worded chip; sentence-form
  readout; preview promoted.

### FILTER — job: "Cap it from one side."
- **Face (default 2×2):** header; roll-off curve over well; **primary read
  = the limit in words**: readout `NO MORE THAN 40` / `AT LEAST 25` /
  `BETWEEN 30–70` (the EQ metaphor gets a plain-words caption, fixing
  defect 4). Mode chip (foot-left) = toggle chip per R2, cycles modes;
  tertiary. Speech row not needed — the readout is the sentence.
- **Sizes:** min 2×1 (curve flattens to a band at h=1); ideal 2×2.
  Shed: mode chip → readout short form (`≤40`).
- **Settings:** SC4 + **LIMIT TYPE** (NO MORE THAN / AT LEAST / BETWEEN —
  same state as the face chip, SC6-noted) + STOPS + STOP NAMES.
- **Jacks:** 1 round out, right. Chip: `LENGTH · ≤40 — sends a window
  (two numbers)`.
- **Disambiguation vs RANGE:** FILTER's home mode is one-sided; its face
  leads with the limit words. Palette: "Cap it from one side."
- Changes vs current: worded readout; mode duplication declared;
  round jack; preview promoted.

### CURVE — job: "Make a value change across the answer."
- **Face (default 4×2):** header; line + point handles in well (primary
  read); readout per R2.4: `3 PTS · PEAK 90`, or `NOW 9/10` when the NOW
  jack is wired. Speech row (the spelled trajectory) at lg — it's long, so
  at md the R2.4 pill form is the hint. Active-moment name = tertiary
  (existing collapse-to-chip rule stays).
- **NOW jack (was POSITION):** renamed; unwired it renders hollow at .5
  opacity with a 9px `NOW` micro label (no longer dead-looking chrome,
  defect 2); wired it fills and drives the hairline + `NOW n/10` readout.
- **Scrub affordance:** `ew-resize` cursor on empty-well hover + hover
  chip "drag to preview across the answer" (defect 4 — cheap, honest cue).
- **Sizes:** min 4×2.
- **Settings:** WHAT IT SAYS NOW · NAME · **ACROSS** (was "Over": THE
  ANSWER / THE STEPS OF THE TASK / EACH ITEM IN A LIST) · **VALUE STOPS**
  (was "Y steps") · **MOMENT NAMES** (was "Detent names"; helper "the five
  moments: start · early · middle · late · end") — the two step concepts
  now have unmistakably different names (defect 3) · **RUNS** (journey
  words: FOLLOWS THE MOD / ALWAYS IN THE ONE CALL / ALWAYS ITS OWN STAGE)
  · SENTENCE · WHERE IT GOES · DEFAULT · NOTE.
- **Jacks:** 1 round out right (`WARMTH ARC · 3 points — sends a shape that
  changes across the answer`); 1 round in left (`NOW — takes a number that
  moves the NOW marker`).
- Changes vs current: POSITION→NOW + visible idle state; pill forms per
  R2.4; VALUE STOPS / MOMENT NAMES split; scrub cue; preview promoted.

### SELECT — job: "You pick one of these, now."
- **Face (default 3×2, grown from 2×1):** header; segmented capsule /
  stack (primary read); **speech row = the picked option's sentence** —
  essential here, because the option word alone ("FOUNDER") isn't the
  effect. A frameless option renders its cell dashed-hollow; picking it →
  wash + `OFF` chip + ghost "No sentence for FOUNDER yet — add one in
  settings." (fixes defect 2).
- **Sizes:** min 2×1 segmented / 2×2 stack (dynamic rule stays); speech
  row sheds first per SC2.
- **Settings:** WHAT IT SAYS NOW · NAME · OPTIONS (2–7) · one **SENTENCE ·
  <OPTION>** field per option, grouped in a collapsed "SENTENCES" section
  that opens one option at a time (kills the 7-row wall, defect 3) ·
  WHERE IT GOES · DEFAULT · NOTE. (No shared SENTENCE field — per-option
  only, as today.)
- **Jacks:** none, by design. Drag-time it never blooms and fades like any
  incompatible target (R1.4) — that is the teach; no apology chrome.
- **Disambiguation vs FORK:** SELECT = you choose at build time. Palette:
  "You pick one, now."
- Changes vs current: default size up; picked-sentence on face; frameless
  option visible; accordion sentences; preview promoted.

### ORDER — job: "Rank what matters most."
- **Face (default 2×2):** header; token well with rank slots (primary
  read); readout `clarity › depth › brevity`. Speech row at lg ("Clarity,
  then depth, then brevity."). Rank numerals = tertiary.
- **Sizes:** min 2×2.
- **Settings:** WHAT IT SAYS NOW · NAME · ITEMS (2–7; inline warning ON
  the field: "Editing the list resets the ranking" — defect 3) · SENTENCE ·
  WHERE IT GOES · DEFAULT · NOTE.
- **Jacks:** 1 round out, right. Chip: **`PRIORITIES — sends how far
  you've shuffled from the default order (0–100), not the names · lenses
  can look, not write`** (defects 1+4 spoken at the jack).
- Changes vs current: shuffle-distance declared; reset warning inline;
  preview promoted.

### MIXER — job: "Split 100% across parts."
- **Face (default 2×2):** header; N faders + channel sublabels (primary
  read; sublabels are *secondary* — they never shed before the readout);
  readout `50 · 30 · 20` = tertiary. Speech row at lg.
- **Jack↔fader pairing:** hovering a fader blooms its jack; hovering a
  jack highlights its fader + shows `EVIDENCE · 50% — sends this
  channel's share (0–100) · lenses can look, not write` (fixes defect 1).
- **Sizes:** min 2×2 for ≤4 channels, **3×2 for 5–6** (min-fader-width
  guard, fixes defect 4).
- **Settings:** WHAT IT SAYS NOW · NAME · CHANNELS (2–6) · **SNAP**
  (OFF / 5 / 10 / 25 — replaces the inherited STOPS + the meaningless
  STOP NAMES field, defect 2; flagged in Conflicts §) · SENTENCE · WHERE
  IT GOES · DEFAULT · NOTE.
- **Jacks:** N round out, right, one per channel, vertically ordered to
  match sublabel order.
- Changes vs current: pairing hover; per-channel chips; stray stop-names
  removed; channel-count min guard; preview promoted.

### GROUP VOICE — job: "Fuse several controls into one sentence."
- **Class:** board frame, not a control. Palette row moves visually per
  R8.2: dashed-frame icon, listed after the 12 controls with a hairline
  separator (row copy: "A frame — drop controls inside").
- **Face (frame, default 6×4):** dashed halo + tab (accent dot · editable
  NAME · gear · ×). Tab gains a **speech row**: the resolved group
  sentence (members' current values substituted), 13px, max 2 lines —
  the frame finally shows what it says. Gated (a member is OFF) → tab
  state chip **`OFF — <MEMBER> is off`** + wash tint (the hidden mute rule
  made visible, defect 3).
- **Sizes:** free drag; tab always fits its name (R4.2).
- **Settings (tab gear — NEW popover):** WHAT IT SAYS NOW · NAME ·
  **THE GROUP'S SENTENCE** — a builder where each member appears as an
  insertable chip; clicking a chip drops its slot into the text (typing
  `{MEMBER}` still works, but nobody has to know that — kills the raw
  token jargon, defect 2) · member list with each member's speak-state
  (`WARMTH · 62%` / `OFF`).
- **Jacks:** none (frame).
- Changes vs current: palette declassified from "13th control"; sentence
  on tab; gate visible; token syntax hidden behind chips; the
  `"— silent: NAME says nothing"` compiler string dies (R6.3).

---

## PROCESS

Class mark: hollow accent ring (R8.1) — "round like a control, but hollow:
it acts at run time." All three carry it; that ring is what separates
STAGE from SLIDER at a glance.

### STAGE — job: "Say which phase the work is in."
- **Face (default 3×1):** header (hollow ring mark); 3-stop slider with
  named detents; **primary read = the stop name** (`ORGANISING`). Speech
  row at h≥2 (the stage's sentence).
- **Sizes:** min 2×1 (raised from 1×1 — three named stops need width).
- **Settings:** WHAT IT SAYS NOW · NAME · **STAGES** — one row per stage:
  stage NAME + its SENTENCE side by side (the stop and its frame finally
  live together, defect 3) · WHERE IT GOES · DEFAULT · NOTE.
- **Jacks:** 1 round out, right. Chip: `STAGE · ORGANISING — sends a
  number (0–100; each stage is a band)`.
- **Copy fix:** palette tooltip → "Tell the AI which phase the work is in
  — each phase speaks its own sentence." (kills the "preview?" framing,
  defect 1). IN STAGES behavior narrated by THE RUN (journey §4), not here.
- Changes vs current: hollow-ring mark (≠ slider, defect 2); stop+sentence
  paired rows; tooltip rewrite; preview promoted.

### FORK — job: "The AI picks a path when it runs."
- **Face (default 3×2):** header + **permanent eyebrow `DECIDES WHEN IT
  RUNS`** (9px micro — the SELECT/FORK split stated on the face);
  junction fan + LEAN handle (primary read = the fan with the favored
  path at full ink); readout `LEANS · PLAN A` / `EVEN`. Speech row at lg
  (scaffold is long; md hint = readout).
- **Sizes:** min 3×2. Tertiary = RUNS foot chip.
- **Settings:** WHAT IT SAYS NOW · NAME · **HOW TO DECIDE** (was "Look
  at"; helper "What should it weigh up when it gets there?") · PATHS
  (2–3) · per-path: PATH NAME + **THEN** (its instructions) · **RUNS**
  (SC6-noted chip duplicate) · WHERE IT GOES · NOTE. (No SENTENCE field —
  the scaffold is generated, as today.)
- **Jacks:** 1 round out, right. Chip: `FORK · leans PLAN A — sends the
  lean (0–100)`.
- Changes vs current: run-time eyebrow; HOW TO DECIDE rename; preview
  promoted; hollow-ring mark.

### REVISE — job: "Draft, check, redo — up to n times."
- **Face (default 2×1):** header (hollow ring); `− n +` capsule + nested
  arcs; **readout `×2 PASSES`** / `OFF` — the word PASSES decodes the arcs
  (defect 1). 0 → wash + `OFF` chip + ghost speech "Would check the draft
  before showing it." Speech row at h≥2.
- **Sizes:** min 2×1; head-collapse behavior stays but the `×n PASSES` /
  `OFF` readout never sheds (identity at the collapsed size, defect 3).
- **Settings:** WHAT IT SAYS NOW · NAME · **CHECK AGAINST** (was "Look
  at"; helper "The bar the draft must clear" — now verbally distinct from
  FORK's HOW TO DECIDE, defect 4) · **HOW STRICT** (LIGHT TOUCH /
  THOROUGH; face-chip duplicate noted) · **IF IT FALLS SHORT** (FIX IT /
  START OVER) · WHERE IT GOES · NOTE.
- **Jacks:** 1 round out, right. Chip: `REVISE · ×2 — sends the pass
  count (0–3, as 0–100)`.
- Changes vs current: PASSES word on face; CHECK AGAINST rename; OFF
  ghost; preview promoted.

---

## STEPS (the work chain)

Palette group renamed **"Work steps"** (the group header; the class stays
"step" internally) — with the STOPS rename (SC4) and the LADDER rename
(below), the word "steps" now means exactly one thing per surface.

Shared spec (all 7): cobalt class accent + solid square mark (R8/D3).
**Face (default 3×2):** header (square mark · VERB); body = the
instruction prose at 13px — the prose IS the speech row, so every step
passes the effect test natively (primary read = verb + prose). Foot =
**RUNS value chip**: `→ ONE CALL` / `→ CALL 3` / `AUTO`, live from the
resolver — the visible answer to "did my chain collapse?" (defect 4).
**Sizes:** min 3×2; tertiary = RUNS chip; prose never truncates — if it
can't fit whole, it sheds to the verb + first clause authored short form
(steps' prose is authored ≤ 12 words; keep it so).
**Settings (NEW — steps currently have none):** WHAT THIS CALL SAYS
(live preview of its clause/call card) · **WHAT IT DOES** (the prose,
editable) · **RUNS** (FOLLOWS THE MOD / ALWAYS IN THE ONE CALL / ALWAYS
ITS OWN STAGE). No NAME field — the verb is fixed identity, stated in the
popover ("EXPLORE — a fixed step").
**Jacks:** square in left (`takes the work in`), square out right
(`hands the work on`), plus the round tune-in below-left where present,
each with a 9px micro name label on the face (the three-port legend is
the labels themselves).

| Step | Tune-in jack + chip text | Notes |
| --- | --- | --- |
| EXPLORE | `BREADTH — takes a number that tunes this step: how wide to range` | |
| CLUSTER | `GROUPS — … : how many groups to sort into` | |
| CRITIQUE | `STRICTNESS — … : how hard to judge` | |
| COMPRESS | `HOW HARD — … : how much to cut` | |
| REFRAME | none | settings note: "This step has no tuning input." |
| DEVELOP | `DEPTH — … : how far to build it out` | |
| COMBINE | none | same note as REFRAME |

The note (in settings + palette tooltip) is the whole answer to the
REFRAME/COMBINE asymmetry (defect 3) — no fake jacks, one honest line.

- Changes vs current (all steps): settings gear added (prose + RUNS);
  RUNS foot chip shows the resolved destination; micro jack labels;
  square/round mating taught at drag time (R1.4), spoken at hover (SC5).

---

## VISUALIZERS

SC6 governs; entries list: default/min size, empty-state line (= the ONE
self-description), rails, and deltas. "Names/numerals" shed per SC6.

### SEMANTIC WAVE (default 7×4, min 5×3 — raised so 6 labeled rails fit)
- Empty line: "Wire feelings in — the line moves the way the idea feels."
- Rails: 6 round ins, left, renamed to what each visibly does:
  **HEIGHT · SPEED · RIPPLE · STEADY · SNAP (was GRID — it snaps the line
  into blocky levels) · ECHOES (was WAVES — extra ghost lines)**. Chip:
  `SPEED — takes a number, shown as how fast the line moves`.
- Changes: input renames; min raised; state chip only when UNWIRED;
  bespoke build path migrates to `vizShell` (R4.1).

### RADAR (default 6×4, min 4×4)
- Empty line: "Wire qualities in — the shape shows their balance."
- Rails: N round ins, left; `+`/`−` head chrome stays, relabeled with
  hover chips `add an axis` / `remove an axis`.
- Two-way vertices: draggable verts get a visible grab dot (ring +
  center); read-only sources (WORDS) render plain — the write-back
  affordance is finally drawn (defect 2).
- Changes: grab-dot affordance; +/− labeled; UNWIRED-only chip.

### LEVELS (default 4×3, min 3×3)
- Empty line: "Wire numbers in to compare them side by side."
- Rails: variable, left. Names secondary, `N of 10` numerals tertiary
  (fixes the unlabeled-bars defect).

### MATRIX (default 5×4, min 4×3)
- Empty line: "Wire sources on the left, targets on top."
- Rails: left + top; each rail gets a 9px axis caption — `FROM` (left) /
  `ONTO` (top) — the missing axis legend (defect 2). Rail labels stop
  ellipsizing: shortened per SC2 or full on hover chip (defect 1).

### LIGHT GRID (default 4×2, min 3×2)
- Empty line: "Wire a number in — it fills in notches, like a meter."
- Rails: variable, left. Refuses WORDS with the R1.5 jack-chip reason.

### BANDINGS (default 4×2, min 3×2)
- Empty line: "Wire shares in — thicker band, bigger share."
- Band names secondary (never shed before numerals; fixes `:418`).

### CONSTELLATION (default 4×4, min 4×4)
- Empty line: "Wire values in — tight cluster means a coherent idea."
- Rails: left, plus **DRIFT** in-dot bottom-left kept, but captioned
  `DRIFT — takes a number, shown as how much the stars wander` and drawn
  on the same rail spine (one input region, defect 1).

### BRANCHES (default 7×4, min 4×3)
- Empty line: "Wire in how to explore — the tree shows wide vs deep."
- State: `PLAN PREVIEW` dies; wired = no chip (its wires + the RUN cards
  are its status).
- 56px gutter: labels move INTO the well top-left (stacked micro labels)
  below 5 cols wide, freeing the gutter (defect 1).

### WINDOW (default 4×2, min 3×2)
- ONE description (both surfaces): **"How much room your limits leave —
  and whether they agree."** (defect 2 resolved; the VIZC question string
  is replaced by this.)
- Empty line: same string. CONFLICT state per R6 (chip + yellow seam;
  seam legend = the chip word itself sitting next to it).
- Lane labels secondary; bite numerals tertiary.

### SCORE (default 5×3, min 4×3)
- Empty line: "Wire arcs in — each lane shows one quality over the answer."
- `MIXED TIMEBASES` → `CONFLICT` chip, hover chip detail "two timebases —
  unwire one" (R6.1).

### READOUT (default 2×2, min 2×2)
- Empty line: "Wire one number in — big and readable."
- Two-way drag kept; the odometer gets the grab-dot cue like RADAR.
- Title: `READOUT`.

### READOUT PAIR (default 2×3, min 2×3)
- Board title renders **`READOUT PAIR`** (distinct `KINDS` label per
  R4.6 — the collision fix).
- Empty line: "Wire two numbers in to watch them together."

### BEAM (default 4×2, min 3×2)
- Empty line: "Wire one side against the other — the beam tips."
- Rails: left AND right; each end captioned by its wired source's name at
  the beam end (the two-sides-one-tradeoff cue, defect 1). Ratio readout
  tertiary.

### TRIM (default 4×3, min 3×2)
- Empty line: "Shows how far each wired part sits from its default."
- Foot caption **`vs each part's default`** (9px, secondary — the
  invisible reference made visible, defect 2; pairs with the MAKE THIS
  THE DEFAULT rename). Lane names secondary, numerals tertiary (fixes
  `:616`). Sources with no default sense (words/select/span/series) render
  the lane dashed with hover "no default to measure against" (defect 3).

### LADDER (was the STEPS visualizer; default 4×3, min 3×2)
- Renamed — the third "steps" meaning dies. Palette + board title:
  **LADDER**.
- One description: "The exact words the prompt will use for a shape."
- `PROMPT PREVIEW` chip dies (R2.3); wired = no chip.

---

## MOD PACKS (palette entries)

Per R8.3 the row is a *cluster*, not a tile: mini stack of 3 ghost tiles +
name + job sentence + value chip **`DROPS N PARTS`**. Hover chip lists the
drop ("6 parts + a frame: THE READER, MEET THEM, …"). Click/drag → the
journey §3 staging ghost (frame + faint parts + job sentence; Esc
cancels). After landing, all management lives on the halo frame tab
(journey §3) — packs have no settings popover of their own. Jacks: n/a.
Required fields surface as the frame's `NEEDS <X>` chip AND wash+`OFF` on
the empty control itself (the two ends agree; fixes systemic defect 5).

| Pack | Palette row job (≤6 words) | Chip | Notes |
| --- | --- | --- | --- |
| TRANSLATOR | "Fit the answer to its reader" | DROPS 6 PARTS | `NEEDS THE READER` until filled |
| NARRATOR | "Shape how the answer sounds" | DROPS 8 PARTS | two anchor lenses (WAVE + RADAR) shown in the ghost |
| EXPLORER | "Set how ideas are explored" | DROPS 7 PARTS | SURVEY / BALANCED / DECIDE chips move OFF the BRANCHES lens onto the frame tab as toggle chips (bespoke lens chrome dies; flagged in Conflicts §) |
| ANCHOR | "Keep everything tied to one point" | DROPS 5 PARTS | `NEEDS THE POINT` until filled |
| SKEPTIC | "Set the proof burden" | DROPS 6 PARTS | |
| STORYTELLER | "Shape movement, opening to close" | DROPS 6 PARTS | three CURVEs — ghost preview shows the arcs |
| EDITOR | "Set hard limits and safeguards" | DROPS 6 PARTS | its WINDOW lens lands honestly chip-less (wired = no chip), fixing defect 4 |

- Changes vs current (all packs): cluster silhouette + DROPS chip; staging
  ghost; strip capabilities move to the frame tab (journey §3); required
  fields visible at both ends; "instance" never appears.

---

## CONFLICTS FOR ORCHESTRATOR

1. **NOTE (Description) compile leak.** I spec NOTE as "never spoken"
   (SC4.7). Journey §5 instead keeps the leak and lints it ("CONFIDENCE's
   note is being read out"). Both can't hold: if NOTE never compiles, that
   lint row is dead. Recommend: stop compiling + drop the lint row.
2. **OFF ghost speech row (SC3).** R6.2 bans fabricated sentences on
   *compiler cards*; I add a ghosted would-say sentence on *faces*. This is
   an extension of R4.3 (wash + chip), not a contradiction, but grammar
   should ratify it so it isn't an undocumented exception (one-grammar
   test).
3. **MIXER field removal.** Dropping the inert STOP NAMES field and
   renaming its STOPS to SNAP trims a (meaningless) settings surface —
   arguably brushes the "no capability cut" non-goal. Needs a nod.
4. **EXPLORER preset chips.** Journey §3's frame tab already has a PRESET
   picker (variations: STOCK/…); EXPLORER's SURVEY/BALANCED/DECIDE are
   *value* presets of its dials. I put them on the frame tab as a second
   row of toggle chips; folding them into the variation picker instead
   would conflate two systems. Journey should confirm the tab can carry
   both.
5. **Pack halo vs GROUP VOICE settings.** I give GROUP VOICE a tab gear +
   sentence-builder popover. Journey open question 3 may reuse the same
   frame class for pack halos — pack frames must NOT inherit the voice
   popover (they get the preset picker instead). Decide the frame-class
   split at code time.
6. **Renames beyond grammar's list** (need sign-off since 04 didn't spec
   them): STEPS viz → **LADDER**; palette group "Steps" → **"Work steps"**;
   config "Steps" → **STOPS** (and mixer's → SNAP); curve POSITION →
   **NOW**; "Over" → **ACROSS**; "Y steps"/"Detent names" → **VALUE
   STOPS** / **MOMENT NAMES**; FORK/REVISE "Look at" → **HOW TO DECIDE** /
   **CHECK AGAINST**. All are label-only; no behavior changes.
7. **Default drop sizes grew** for SELECT (2×1→3×2) and defaults now must
   fit speech rows — board density drops slightly vs current seeds; the
   demo board layout (Stream 6/7 territory) may need re-seeding.
