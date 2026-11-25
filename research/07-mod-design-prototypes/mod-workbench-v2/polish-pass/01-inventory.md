# 01 — Part inventory (Stream 1)

Code-derived inventory of every part in the Mod Workbench prototype.
Sources: `docs/design/prototypes/mod-workbench-v2.html` (workbench host +
visualizers + packs), `docs/design/prototypes/lib/mod-ui.js` (control
lib), cross-checked against `docs/design/prototypes/lib/DESIGN.md`.
All file:line refs are to those files unless noted. This records what IS
plus defect flags; no redesigns proposed.

## What "45 parts" actually means

The palette (`mod-workbench-v2.html:948-1012`) declares five groups whose
counts sum to 45: **Controls 13, Process 3, Steps 7, Visualizers 15, Mod
packs 7.** But the categories are not parallel:

- "Controls 13" includes **GROUP VOICE**, which is not a `ModUI.control`
  at all — it has no `KINDS` entry and is a board frame (`addGroup`,
  `:6482`). So there are only 12 real controls + 1 frame in that group.
- "Mod packs 7" are not parts — each is a **macro** that drops a
  pre-wired cluster of ordinary controls + visualizers onto the board
  (`PACKS`, `:6405`). Counting them as "parts" inflates the number and
  conflates a component with a template.
- STAGE (Process) is not its own component: it is a **slider preset**
  (`libKind = kind === 'stage' ? 'slider'`, `:1806`).
- The 15 "visualizers" include READOUT and READOUT PAIR, which are the
  same builder (`buildReadout`) and carry the **same board label
  "READOUT"** (`KINDS`, `:1135-1136`).

So the honest component count is ~24 distinct UI kinds; "45 parts" is a
palette-row count, not a component count. (Status bar even hardcodes a
stale "15 PARTS · 14 WIRES", `:921`, overwritten at runtime `:6639`.)

---

## Summary table

| Part | Class | Jack shape(s) as coded | Resizable | Defects |
| --- | --- | --- | --- | --- |
| DIAL | control | 1 round out (right) | yes (min 1×1; sz gated on w<96 OR h<96) | 2 |
| SLIDER | control | 1 round out (right) | yes (min 1×1) | 2 |
| SWITCH | control | 1 round out (right) | yes (min 1×1) | 2 |
| COUNT | control | 1 round out (right) | yes (min 1×1) | 2 |
| WORDS | control | 1 round out (right), read-only downstream | yes (min 1×1) | 3 |
| PAD | control | 2 round out (Y top-right, X mid-right) | yes (min 2×2) | 3 |
| RANGE | control | 1 **capsule/oval** out (span) | yes (min 2×1) | 3 |
| FILTER | control | 1 **capsule/oval** out (span) | yes (min 2×1, ideal 2×2) | 4 |
| CURVE | control | 1 **polyline-in-ring** out (series) + 1 **chevron** in (POSITION, left) | yes (min 4×2) | 5 |
| SELECT | control | **none** (jackless) | yes (min 2×1 seg / 2×2 stack) | 3 |
| ORDER | control | 1 round out (scalar = displacement) | yes (min 2×2) | 4 |
| MIXER | control | N round out, one per channel (right, evenly spaced) | yes (min 2×2) | 4 |
| GROUP VOICE | control(frame) | none (frame, not a control) | yes (drag frame; 6×4 default) | 5 |
| STAGE | process | 1 round out (scalar, slider under the hood) | yes (min 1×1; is a slider) | 4 |
| FORK | process | 1 round out (scalar = lean) | yes (min 3×2) | 4 |
| REVISE | process | 1 round out (scalar = passes) | yes (min 2×1; collapses head <78px) | 4 |
| EXPLORE | step | **square** artifact-out + **square** artifact-in + 1 scalar sig-in (BREADTH) | yes (min 3×2) | 3 |
| CLUSTER | step | square out + square in + 1 sig-in (GROUPS) | yes (min 3×2) | 3 |
| CRITIQUE | step | square out + square in + 1 sig-in (STRICTNESS) | yes (min 3×2) | 3 |
| COMPRESS | step | square out + square in + 1 sig-in (HOW HARD) | yes (min 3×2) | 3 |
| REFRAME | step | square out + square in + 0 sig-in | yes (min 3×2) | 3 |
| DEVELOP | step | square out + square in + 1 sig-in (DEPTH) | yes (min 3×2) | 3 |
| COMBINE | step | square out + square in + 0 sig-in | yes (min 3×2) | 3 |
| SEMANTIC WAVE | visualizer | 6 round in-dots (left rail, straddle) | yes (7×4 default, own path) | 4 |
| RADAR | visualizer | N round in-dots (left, variable) | yes (6×4) | 3 |
| LEVELS | visualizer | round in-dots (left rail, variable) | yes (min 3×3) | 2 |
| MATRIX | visualizer | round in-dots (left + top rails) | yes (min 4×3) | 3 |
| LIGHT GRID | visualizer | round in-dots (left, variable) | yes (min 3×2) | 2 |
| BANDINGS | visualizer | round in-dots (left, variable) | yes (min 3×2) | 2 |
| CONSTELLATION | visualizer | round in-dots (left) + DRIFT in-dot (bottom-left) | yes (min 4×4) | 3 |
| BRANCHES | visualizer | round in-dots (left rail, 56px gutter) | yes (min 4×3) | 3 |
| WINDOW | visualizer | round in-dots (left, variable) | yes (min 3×2) | 3 |
| SCORE | visualizer | round in-dots (left, variable) | yes (min 4×3) | 3 |
| READOUT | visualizer | 1 round in-dot (left) | yes (min 2×2) | 2 |
| READOUT PAIR | visualizer | 2 round in-dots (left) | yes (min 2×3) | 3 |
| BEAM | visualizer | round in-dots (left + right rails) | yes (min 3×2) | 3 |
| TRIM | visualizer | round in-dots (left, variable) | yes (min 3×2) | 3 |
| STEPS | visualizer | round in-dots (left rail) | yes (min 3×2) | 3 |
| TRANSLATOR | mod pack | (macro — drops controls+bandings) | n/a | 3 |
| NARRATOR | mod pack | (macro — drops controls+wave+radar) | n/a | 3 |
| EXPLORER | mod pack | (macro — drops branches+5 dials+chips) | n/a | 4 |
| ANCHOR | mod pack | (macro — drops controls+constellation) | n/a | 3 |
| SKEPTIC | mod pack | (macro — drops controls+levels) | n/a | 3 |
| STORYTELLER | mod pack | (macro — drops 3 curves+words+score) | n/a | 3 |
| EDITOR | mod pack | (macro — drops filters+range+switches+window) | n/a | 4 |

Jack-shape families as coded (`mod-ui.js:120-166`, glyph classes
`mui-node--span/--series/--artifact`): **scalar = filled round dot**,
**span = dot stretched to a capsule (oval)**, **series = 3-segment
polyline inside the ring**, **artifact = a square port**. Input jacks add
an **inward chevron** (`IN_CHEV`, `:128`) and straddle the LEFT edge;
outputs straddle the RIGHT (8px overhang). This is four different jack
silhouettes on one board — the "circles AND ovals" weili flagged is the
scalar-dot vs span-capsule split, and it is intentional (payload-type
legibility, DESIGN.md "jack glyph language") but nothing on the widget
teaches a stranger why some ports are round and some are oval/square.

---

## CONTROLS

Shared control chrome (`mod-ui.js`, DESIGN.md "Identity and chrome"):
top-left **accent identity dot** (always visible; click → 8-swatch color
well); top-right hover-revealed **sliders glyph** (opens config popup) +
**×** (remove). Anatomy order label→instrument→readout. Size classes
`sz-xs/sm/md/lg` from a ResizeObserver (`:2674`): `xs` when w<96 (dial:
w<96 **or** h<96), `sm` <168, `md` <264, else `lg`; any h<52 forces
`xs`. Label shows from `sm` up; at `xs` it moves to a hover chip
`LABEL · value`. Boards enforce `c.minCells` on drop + resize.

Shared config popover (lib, `openConfig` `:2231`): **Title** input,
**Description** textarea ("What does this control mean…"), then
kind-specific fields (below). The **workbench appends** a creator block
(`decorateCreatorConfig` `:1742`): a rule, a **Prompt section** dropdown,
a **"Says"** frame textarea (per part; teaches `{value}` by example), a
**SET AUTHORED DEFAULT** button, and a live **"PROMPT AT CURRENT VALUE"**
preview. Frame field is suppressed for select/fork/revise (`:1771`);
pad gets **X says / Y says**; stage gets one **"<STOP> says"** per stop.

### DIAL
- **Purpose:** set a single 0–100 magnitude that the prompt speaks as a
  percentage (e.g. WARMTH 60%).
- **Payload:** scalar. **Jack:** one round out-dot, right edge overhang.
- **Face:** 270° faint arc + accent value arc, ink core + needle, mono
  `%` below; stepped → ticks outside the arc (DESIGN.md; `renderDialTicks`).
  Vertical drag (100%≈150px, shift=fine), arrow keys step.
- **Emits (`emitLine` `:3493`):** `frame.replace('{value}', 'N%')` or
  default `Cap(label): N%.`. Pill = `N%`. Per-band frames override when a
  pack supplies `bands` (low/mid/high prose, `:3660`).
- **Settings:** Title, Description, **Steps** (OFF/2–10), **Stop names**
  (only shown when stepped), + workbench Says / section / default / preview.
- **Resize:** min 1×1. Knob squares into free space (`:2688`). At `xs`
  label→hover chip, readout uses `is-abbrev` fallback.
- **Defects:** (1) The **Stop names** field renders in the popup but is
  `display:none` unless Steps≥2 (`:2326-2332`) — a field that silently
  vanishes teaches nothing about when it applies. (2) Dial alone gates
  `xs` on height too (`:2678`), so a wide-but-short dial hides its label
  while a same-box slider keeps it — inconsistent sibling behavior.

### SLIDER
- **Purpose:** same as dial (a 0–100 magnitude) in a horizontal track.
- **Payload:** scalar. **Jack:** one round out, right.
- **Face:** recessed capsule track, accent-tint fill to handle center,
  round ink handle, detent dots when stepped, mono `%` at right.
- **Emits:** identical to dial (`emitLine` treats dial+slider together).
- **Settings:** Title, Description, Steps, Stop names (when stepped),
  Says / section / default / preview.
- **Resize:** min 1×1. `fitScalarReadout` (`:1968`) drops named→numeric
  when the row minus a 50px track floor would overflow.
- **Defects:** (1) DIAL and SLIDER are semantically identical (both a
  0–100 scalar, same `emitLine`, same settings) — two palette rows, one
  concept, nothing tells a stranger when to pick which. (2) Same hidden
  Stop-names field as dial.

### SWITCH
- **Purpose:** a yes/no; ON adds a sentence, OFF says nothing.
- **Payload:** scalar (0 or 100, coerced `:423`). **Jack:** round out, right.
- **Face:** small capsule, ink handle when off / accent track + paper
  handle when on.
- **Emits (`:3501`):** `v<50` → **null (silent)**; else `frame` or
  `Cap(label).`. Pill = ON/OFF.
- **Settings:** Title, Description (no steps/stops), Says / section /
  default / preview.
- **Resize:** min 1×1.
- **Defects:** (1) A switch at OFF emits nothing but still occupies a
  board cell and shows a face — the "silence when off" rule is invisible
  until you read the compiler. (2) Default value differs per instance
  (NO HEDGING ships at 0, NOTHING INVENTED at 100, `:6318-6319`) with no
  face cue which polarity is "active."

### COUNT
- **Purpose:** an integer quantity (e.g. SOURCES 3).
- **Payload:** scalar, stored as integer, scaled ×10 for the wire
  (`scalarFromRaw` `:1185`). **Jack:** round out, right.
- **Face:** capsule `− N +`.
- **Emits (`:3497`):** `frame.replace('{value}', 'N')` or `Cap(label): N.`
- **Settings:** Title, Description, Says / section / default / preview.
- **Resize:** min 1×1.
- **Defects:** (1) The wire value is `count×10` (0–10 → 0–100), an
  invisible unit change: a lens reading COUNT=3 shows "30", surprising a
  stranger. (2) No max is surfaced on the face; write-back rounds to 0–10
  (`:1288`) but the face gives no ceiling cue.

### WORDS
- **Purpose:** free text inserted into the prompt (e.g. THE READER).
- **Payload:** scalar *length* proxy for read-only lenses
  (`min(len,32)/32*100`, `:1186`); the text itself rides in the sentence.
  **Jack:** round out, but **every write surface refuses it**
  (`canWriteBack` excludes words `:1275`; grid/radar refuse at connect).
- **Face:** one-line mono field (`.mui-field-input`), accent caret+border
  on focus, geometry unchanged.
- **Emits (`:3505`):** empty → **null (silent)**; else `frame` or
  `Cap(label): text.`
- **Settings:** Title, Description, Says / section / default / preview.
- **Resize:** min 1×1 (label default w4×1 on drop).
- **Defects:** (1) The out-jack is drawn identically to a real scalar
  jack but is **read-only downstream** — a stranger can wire it into a
  writable lens and the connection silently no-ops or is refused, with no
  visible difference on the jack. (2) The "length as scalar" coercion is
  a hidden semantic (a longer sentence reads as a higher value on a
  gauge) nothing explains. (3) Empty = silent, same invisible-silence
  problem as switch.

### PAD
- **Purpose:** two fused 0–100 axes in one gesture (e.g. MEET THEM:
  LEVEL × READING).
- **Payload:** two scalars `{x,y}`. **Jacks:** TWO round out-dots —
  **Y at the well's top-right** (`mui-node--pady`), **X at vertical
  center** (`mui-node--padx`) (`:483-491`). Jack identity = axis
  sublabel on the hover chip.
- **Face:** recessed dot-grid well, two crosshair hairlines, round ink
  handle, drag trail; axis-end names show at `lg` only; readout `x · y`
  drops at `sm`.
- **Emits:** TWO cards (one per axis, eyebrow `TITLE · AXIS`, `:3575`).
  Per-axis `frames.x/frames.y`, or per-band `padBands` prose
  (`:3585`), or default `Cap(name): N%.` A null band = silent.
- **Settings:** Title, Description, then **X AXIS / Y AXIS** blocks each
  with **Axis title**, **End names** (low/high), **Steps**; workbench
  adds **X says / Y says**.
- **Resize:** min 2×2. At `sm` (its minimum) the readout drops.
- **Defects:** (1) TWO jacks on the right edge at different heights with
  no on-face label — which dot is X vs Y is only knowable by hover chip.
  (2) Axis-end names (the only thing explaining the quadrants) appear
  **only at `lg`** — at the common 2×2 min the pad is an unlabeled well.
  (3) Emits two cards from one widget; a stranger sees one control
  produce two prompt lines with no visual link back.

### RANGE
- **Purpose:** constrain a value to a window ("between A and B"); it
  constrains, it does not set.
- **Payload:** span `{lo,hi,mode:'between'}`. **Jack:** one **capsule
  (oval)** out — the span glyph.
- **Face:** capsule track, two ink handles, accent-tint band between,
  band-drag slides the window. Readout `30–70` or named stops.
- **Emits (`spanPhrase` `:3324`):** "between <lo> and <hi>" (stop names
  lowercased). Pill `LO–HI`.
- **Settings:** Title, Description, **Steps**, **Stop names** (always
  shown for range), Says / section / default / preview.
- **Resize:** min 2×1. `fitReadout` (`:1936`) named→numeric fallback.
- **Defects:** (1) The oval jack has no on-widget explanation that it
  carries a *pair* (span), not a number — a stranger reads it as "a
  fatter dot." (2) RANGE (always "between") vs FILTER (three modes
  including between) overlap heavily; nothing on either face says why two
  parts exist for one span concept. (3) Stop names is a bare comma field
  ("a phrase, a paragraph, …") with no indication it must have exactly
  steps+1 entries to be spoken.

### FILTER
- **Purpose:** a one-sided or two-sided limit drawn as a roll-off curve
  ("no more than / at least / between").
- **Payload:** span `{lo,hi,mode}`. **Jack:** one **capsule (oval)** out.
- **Face:** ink roll-off curve over a dot-grid well, `--accent-wash`
  under the pass region, a **mode chip** (foot-left, cycles on click).
- **Emits:** `spanPhrase` — "no more than <hi>" / "at least <lo>" /
  "between…". Pill `≤HI` / `≥LO` / `LO–HI`.
- **Settings:** Title, Description, Steps, Stop names, **Mode** (three
  plain-word buttons NO MORE THAN / AT LEAST / BETWEEN), Says / section /
  default / preview.
- **Resize:** min 2×1, ideal 2×2. `fitReadout` with a third tier that
  hides the mode chip.
- **Defects:** (1) Same oval-jack legibility gap as range. (2) Mode
  lives in **two places** (the foot chip AND a config field) with no cue
  they are the same setting. (3) Heavy overlap with RANGE (see above).
  (4) The roll-off-curve face is an audio-EQ metaphor ("low-pass")
  translated to plain words in the sentence but NOT on the face — a
  stranger sees a mystery curve, not a limit.

### CURVE
- **Purpose:** a value that changes across the answer/task/list (a
  trajectory), 2–5 points.
- **Payload:** series `[{t,v}]`. **Jacks:** one **polyline-in-ring** out
  (series, right) **and** one **inward-chevron** in-dot POSITION (left,
  `c.inputs.position`) — the only input jack on any control.
- **Face:** recessed well, accent line, ink point handles; click=add,
  drag=move, double-press=delete; X snaps to 5 detents; horizontal
  face-drag = scrub gesture. Wired POSITION draws a vertical hairline +
  sample dot. Optional fidelity foot chip.
- **Emits (`spellSeries` `:3397`):** e.g. "open at 3 of 10, build to 9
  of 10 by the middle, settle at 5 of 10 by the end." With POSITION wired
  it switches to a sampled-now-plus-trajectory clause (`:3435`). Pill
  `3PT ↥90` or `N/10 PREVIEW`.
- **Settings:** Title, Description, **Y steps**, **Over** (timebase
  dropdown: THE ANSWER / THE STEPS OF THE TASK / EACH ITEM IN THE LIST),
  **Detent names** (rename the 5 x-positions), **Fidelity** (ONE PASS /
  IN STAGES / AUTO), Says / section / default / preview.
- **Resize:** min 4×2. `fitCurveReadout` collapses the active-detent name
  to a hover chip.
- **Defects:** (1) TWO jacks of two different silhouettes (series out,
  scalar-chevron in) on opposite edges with no on-face legend — the most
  jack-dense control and the least self-explaining. (2) The POSITION
  input only *does* something when wired; unwired the left chevron dot is
  dead-looking chrome a stranger can't interpret. (3) "Y steps" vs the
  x-detents (named separately) is two different step concepts in one
  popup with near-identical labels. (4) The scrub gesture (drag empty
  face) is undiscoverable and has no cursor/label cue. (5) The `↥90` pill
  glyph is cryptic (peak value).

### SELECT
- **Purpose:** pick one of N named options, each carrying its own
  sentence frame (e.g. FOUNDER / TEAMMATE / CLIENT).
- **Payload:** **none — jackless by design** (`node=null`, `:482`,
  DESIGN.md "Jackless by design"). Composition is via its sentence, not a
  wire.
- **Face:** 2–4 options → segmented capsule (picked cell accent-filled);
  5–7 → vertical stack; no readout row (the face is the readout).
- **Emits (`selectFrame` `:3341`):** the picked option's authored frame
  verbatim; empty frame = **silent**. Pill = OPTION (uppercased).
- **Settings:** Title, Description, **Options (2–7)** comma list, then
  one **Frame · <OPTION>** field per option. **No Says field** (`:1771`);
  **no steps.**
- **Resize:** `minCells` is dynamic — `{2,1}` segmented if ≤4 options
  else `{2,2}` stack (`:2719`); the face auto-switches on count.
- **Defects:** (1) SELECT is the **only control with no jack** but looks
  otherwise like a control — a stranger has no way to know it can't be
  wired (refusal-by-silence means the jack simply isn't there, which
  reads as "missing" not "by design"). (2) An option with an empty frame
  silently drops the whole card; nothing on the face flags a
  frameless option. (3) The per-option Frame fields can grow to 7 rows —
  the "wall of fields" problem the goal calls out.

### ORDER
- **Purpose:** drag-to-rank a set of named items (e.g. clarity › depth ›
  brevity).
- **Payload:** scalar = **displacement** (Kendall-tau distance from
  authored order, 0–100, `c.displacement()` `:1175`). **Jack:** one
  round out.
- **Face:** capsule tokens in a well, fixed rank-numeral slots, rank-1
  accent-filled; FLIP-displacement on drag. Readout `A › B › C`.
- **Emits (`orderSequence` `:3351`):** "clarity, then depth, then
  brevity." Default frame `Priorities: {value}.` Pill = top item + `›`.
- **Settings:** Title, Description, **Items (2–7)** comma list, Says /
  section / default / preview.
- **Resize:** min 2×2; rank numerals drop first under `sm`.
- **Defects:** (1) The jack emits **displacement** (a shuffle distance,
  0–100), NOT the ranking — a stranger wiring ORDER into a gauge sees a
  number that has nothing to do with the item names, deeply
  unintuitive; hover chip says `SHUFFLE 33` but the value is meaningless
  without context. (2) `baseScalar` returns null and `scalarFromRaw`
  returns 0 for order (`:1184`) — TRIM/base reads treat it as always-zero,
  a silent special-case. (3) Editing the item list resets the ranking to
  authored order with no warning. (4) Two-way write refused
  (`canWriteBack` `:1275`) but jack looks writable.

### MIXER
- **Purpose:** split 100% across 2–6 named channels (shares always sum to
  100).
- **Payload:** `{channel: share}`. **Jacks:** **one round out per
  channel** (the variable multi-jack), evenly spaced on the right edge
  (`mui-node--mix`, `:505-512`); jacks follow config edits.
- **Face:** N slim vertical faders, accent-tint fill, round ink handles;
  dragging one rebalances the rest; channel sublabels beneath. Readout
  `50 · 30 · 20` drops under `sm`.
- **Emits (`mixerShares` `:3358`):** descending "50% on evidence, 30% on
  examples, 20% on intuition"; 100% special-cased "entirely on…"; zero
  channels omitted. Default frame `Weigh the answer {value}.` Pill = top
  channel + value.
- **Settings:** Title, Description, **Steps** (quantize shares), **Stop
  names** field is generated (mixer is in the STEPPED set `:206`) though
  semantically odd, **Channels (2–6)** comma list, Says / section /
  default / preview.
- **Resize:** min 2×2; readout drops under `sm`.
- **Defects:** (1) N jacks on the right edge, one accent for all
  (channel identity only on hover chip) — indistinguishable dots, a
  stranger can't tell which fader each maps to. (2) Mixer inherits the
  **Steps + Stop names** fields from the STEPPED branch (`:2309`) but
  "stop names" is meaningless for share-of-whole — a stray field. (3)
  Write-back refused but jacks look writable. (4) At the 2×2 min with
  6 channels the faders are unreadably thin (no min-channel-width guard).

### GROUP VOICE
- **Purpose:** fuse several member controls into ONE authored sentence
  with member-value slots (members stop speaking their own cards).
- **Payload:** none — it is a **board frame** (`addGroup` `:6482`), not a
  `ModUI.control`; no `KINDS` entry, sized 6×4 (`:3131`).
- **Face:** dashed-hairline frame with a `--accent-wash` fill and a
  **tab** (accent dot + editable title + ×) at top-left; members inside
  glow on hover.
- **Emits (`resolveVoice` `:6455`):** the authored `voice` string with
  `{MEMBER LABEL}` tokens replaced by each member's spoken value; a
  silent member mutes the whole sentence (gate semantics). Pill =
  `N PARTS`.
- **Settings:** no lib popup — its config IS the inline title + voice
  template + which controls sit inside the frame.
- **Resize:** frame drag; members re-detected by geometry.
- **Defects:** (1) Sits in the "Controls" palette group (count 13) but is
  categorically different (a frame that consumes controls) — no visual or
  copy cue that it is a container, not an instrument. (2) The `{LABEL}`
  token syntax in the voice template is raw jargon a stranger won't guess
  (`token.replace`, `:6466`). (3) Silent-member gate ("one silent member
  mutes everything") is a hidden, surprising rule. (4) Its silent card
  prints `"— silent: NAME says nothing"` (`:6475`) — meta chrome leaking
  into the compiler. (5) No jack, no accent-dot-as-control identity — it
  breaks the shared control grammar entirely.

---

## PROCESS

### STAGE
- **Purpose:** preview one of the work's authored phases (EXPLORING /
  ORGANISING / COMMITTING) and emit that phase's frame.
- **Under the hood:** a **stepped slider** (`libKind='slider'`, `:1806`),
  steps = stops−1, stops = `STAGE_STOPS` (`:1722`). **Payload:** scalar.
  **Jack:** one round out.
- **Face:** slider with named-stop detents (EXPLORING/ORGANISING/
  COMMITTING).
- **Emits (`stagePhrase` `:3452`):** the frame of the stage the value
  lands on (`STAGE_FRAMES`, e.g. "We are still exploring — widen before
  narrowing.") or silent. Pill = the stop name.
- **Settings:** slider popup (Title, Description, Steps, Stop names)
  **plus** workbench-injected **"<STOP> says"** frame per stop (`:1768`).
- **Resize:** min 1×1 (slider floor).
- **Defects:** (1) Palette tooltip "Which authored phase should these
  settings preview?" (`:968`) frames STAGE as a *preview toggle*, but it
  emits a real prompt sentence — the mental model is muddled. (2) It is a
  slider wearing a different name and glyph (`◑`) in the palette; a
  stranger can't tell it from SLIDER except by trying it. (3) The stage
  frames live in a separate injected settings section from the stops that
  name them — edit one, hunt for the other. (4) Its `IN STAGES` behavior
  (feeding THE PLAN) only appears when the mod lever is thrown — appearing/
  disappearing UI (goal-flagged).

### FORK
- **Purpose:** let the model decide its own path at run time, with a lean
  toward one path on a coin-flip.
- **Payload:** scalar = lean. **Jack:** one round out (`favored()`
  exposes the leaned index).
- **Face:** ink junction — one line in, fans to 2–3 path lines, path
  names in micro caps, a LEAN handle on an arc; favored path at full ink.
  Readout `LEANS · <PATH>` or `EVEN`. Optional fidelity foot chip.
- **Emits (`forkScaffold` `:3455`):** "First decide — <look-at>? If
  <path A> — <prose>. … When it could go either way, lean toward
  <path>." One decide-scaffold card (never per-branch). Pill `→ PATH` or
  `EVEN`.
- **Settings:** Title, Description, **Look at** (prose textarea), **Paths**
  stepper (2–3), then **PATH n** blocks each with **Name** + **Then**
  prose; **Fidelity** row. **No Says field.**
- **Resize:** min 3×2.
- **Defects:** (1) FORK vs SELECT: both "choose a path," one at set-time
  (select) one at run-time (fork) — the distinction is deep-engine and
  invisible to a stranger; the faces don't teach it. (2) The junction/
  LEAN-arc face is abstract — "lean 50 = EVEN" (`:3474`) needs the
  readout to decode; a stranger sees a fan diagram. (3) The check-block
  vocabulary ("Look at" / "Then") is intentionally plain but the *concept*
  (a runtime classifier) has no on-face anchor. (4) Fidelity setting
  duplicated (foot chip + config row) like filter's mode.

### REVISE
- **Purpose:** draft, self-check against a metric, and revise up to n
  passes before showing (0 = off).
- **Payload:** scalar = passes (0–3). **Jack:** one round out.
- **Face:** a `− n +` count capsule with **n nested arcs above it**;
  0 = no arcs (silent). No score/threshold numbers on the face.
- **Emits (`revisePhrase` `:3480`):** "Draft the answer, then read it
  back against this: <metric>. If it falls short, revise/start over. Up
  to n passes before you show me." 0 → silent. Pill `×n` or `OFF`.
- **Settings:** Title, Description, **Look at** (metric prose), **Strictness**
  (LIGHT TOUCH / THOROUGH toggle), **When it falls short** (FIX IT /
  START OVER toggle). **No Says field.**
- **Resize:** min 2×1; head collapses to corner-dot when h<78 (`:2684`)
  so arcs/capsule/chip clear.
- **Defects:** (1) The nested-arcs face is a novel glyph with no legend —
  a stranger reads "n arcs" as decoration, not "n passes." (2)
  "Strictness" appears as a foot chip AND a config toggle (third instance
  of the duplicated-chip pattern: filter mode, fork fidelity, revise
  strictness). (3) At its 2×1 min the head collapses and the only
  identity is a corner dot — very terse. (4) The metric prose sits in
  "Look at," a phrase shared with FORK but meaning something different
  (a quality bar vs a decision question).

---

## STEPS (transformer verb-modules)

All 7 share `ModUI.stepShell` (`addStep` `:1962`, `STEP_VERBS` `:1953`),
accent `#3f78df` (`STEP_ACCENT`), min 3×2. Anatomy: panel chip, **verb**
label + **square identity dot**, instruction **prose** as body,
**artifact-in (square) on the left**, **artifact-out (square) on the
right**, **signal scalar in-dots below artifact-in** (modulation), and a
**fidelity foot chip**. A step is not a control (its output is a
work-product, `c.get()` returns null, `:1995`) and speaks a degraded
CLAUSE when ONE PASS ("As part of the work: …", `:3566`).

| Verb | Purpose (prose shipped) | Signal in-jacks |
| --- | --- | --- |
| EXPLORE | "Range widely — ten unlike directions before settling." | BREADTH |
| CLUSTER | "Sort what's here into groups and name each one." | GROUPS |
| CRITIQUE | "Read it back hard and mark every weak spot." | STRICTNESS |
| COMPRESS | "Cut to the essential — one tight version." | HOW HARD |
| REFRAME | "Say the same thing from a different angle." | (none) |
| DEVELOP | "Take the strongest thread and build it out." | DEPTH |
| COMBINE | "Weave the separate pieces into one whole." | (none) |

- **Payload:** artifact (the **second cable family** — square ports, wider
  ink, `typeOfRef → 'artifact'` `:1166`). Artifact jacks are **non-mating**
  with signal jacks (refusal by silence, `:2009/:2023`). Signal in-dots
  are ordinary scalars.
- **Settings:** the step shell has no lib config popup in the same shape;
  the prose + verb + signals + fidelity are the surface (verb registry is
  engine/workbench-owned per DESIGN.md).
- **Resize:** min 3×2 (from `shell.minCells`).
- **Defects (common to all 7):** (1) A step exposes **three port types on
  one widget** — square artifact-in (left), square artifact-out (right),
  round scalar signal-in (below-left) — with no on-face legend
  distinguishing "work in" from "modulation in"; both are on the left
  edge. (2) The square-vs-round jack distinction (artifact vs signal) is
  the deepest jack-language rule and the least explained on the widget.
  (3) REFRAME and COMBINE have **zero signal jacks**, so they look like a
  different, simpler part than their 5 siblings with no explanation for
  the asymmetry. (4) When resolved to ONE PASS a step's rich transform
  degrades to a flat prose clause with no visual signal that the artifact
  chain collapsed.

---

## VISUALIZERS

Two build paths: WAVE and RADAR are bespoke (`addViz` `:2037`, own
head/well/dot-column); the other 13 use the lib `vizShell` + `rail`
contract (`addVizC` `:4613`, `VIZC` `:4546`). **A visualizer has no
identity dot and no accent of its own** (DESIGN.md) — every hue is
inherited through wires. Each declares a one-line **question**
(palette tooltip). None emit; all consume. Every viz carries a
**`wb-viz-state` chip** driven by `updateVizState` (`:4647`).

**The state chip is the goal's "dead chrome" flag.** Values
(`:4654-4661`): `EMPTY · WIRE INPUT` (unwired), **`CONNECTED PREVIEW`**
(any wire), `PLAN PREVIEW` (branches), `PROMPT PREVIEW` (steps),
`CONFLICT` (window empty), `MIXED TIMEBASES` (score), and an optional
`· k/n` required-slot tail. For 11 of 15 lenses the chip only ever says
"EMPTY · WIRE INPUT" → "CONNECTED PREVIEW" — a binary that restates what
the wires already show. This is the chrome weili called meaningless.

Shared resize defect: nearly every lens **drops its labels/numbers at
`sz-sm`/`sz-xs`** via CSS (`.wb-lv-num`+`.wb-lv-name` `:351`;
`.wb-bd-lbl` `:418`; `.wb-tr-ro/-name/-foot` `:616`; `.wb-wd-bite/-lbl`
`:468`; `.wb-sc-words` `:514`; `.mui-viz.sz-sm` on readout digits). So at
common board sizes a lens becomes an unlabeled abstract shape — the
"resize behavior unconsidered" flag, systemically.

### SEMANTIC WAVE (`wave`, 7×4)
- **Question:** "How does the idea feel in motion?"
- **Inputs (`WAVE_INPUTS` `:1144`, 6 dots, left column):** HEIGHT (amp),
  SPEED (freq), RIPPLE, STEADY, GRID, WAVES (optional). Round scalar
  in-dots.
- **Face:** an animated waveform in a well offset 56px from the left for
  the dot column (`.wb-well.is-wave` `:294`). Idle motion owned by SPEED.
- **Defects:** (1) 6 input dots with tiny labels down the left edge — at
  `sm` the labels are cramped; the 56px gutter eats the well on a
  narrow board. (2) "GRID"/"RIPPLE"/"STEADY" are abstract wave
  parameters a stranger can't map to meaning without the wired control.
  (3) Carries the CONNECTED PREVIEW chip. (4) Bespoke build path diverges
  from the 13 contract lenses (different head/chrome code) — subtle
  inconsistency.

### RADAR (`radar`, 6×4)
- **Question:** "What shape is the idea?"
- **Inputs:** N axes (variable), added/removed via `+`/`−` head chrome
  (`:2067`); vertices are **two-way draggable** (write-back) except words
  (refused).
- **Face:** polygon over spoke axes; unwired verts faint.
- **Defects:** (1) `+`/`−` head buttons add "points" with no label of
  what a point is until wired. (2) Draggable vertices (a hidden two-way
  affordance) look identical to fixed ones. (3) CONNECTED PREVIEW chip.

### LEVELS (`levels`, min 3×3)
- **Question:** "Which quality dominates, and how much headroom is left?"
- Variable left rail; 10-segment vertical bars, `N of 10` numerals.
- **Defects:** (1) `.wb-lv-num` + `.wb-lv-name` both `display:none` at
  sm/xs (`:351`) — bars become unlabeled at small sizes. (2) CONNECTED
  PREVIEW chip.

### MATRIX (`matrix`, min 4×3)
- **Question:** "How do sources bear on targets?"
- Left + top rails (`ModUI.rail` two edges); dot-size cells; a **ghost
  row/column** growth affordance.
- **Defects:** (1) Rail labels clamped to 44–52px with ellipsis
  (`:396-397`) — long control names truncate silently. (2) Two rails of
  dots (left = sources, top = targets) with no axis legend saying which
  is which. (3) CONNECTED PREVIEW chip.

### LIGHT GRID (`grid`, min 3×2)
- **Question:** "How much have I committed, in discrete notches?"
- Variable rail; LED lanes; refuses words at connect.
- **Defects:** (1) "notches" concept opaque without a wired source. (2)
  CONNECTED PREVIEW chip.

### BANDINGS (`bandings`, min 3×2)
- **Question:** "What is the mix — what dominates the blend?"
- Horizontal strata, thickness = share; band labels.
- **Defects:** (1) `.wb-bd-lbl` hidden at sm/xs (`:418`) — bands lose
  names. (2) CONNECTED PREVIEW chip.

### CONSTELLATION (`constellation`, min 4×4)
- **Question:** "Is the idea coherent or scattered?"
- Web of nodes; unwired nodes hollow; a **DRIFT** input (bottom-left,
  `.wb-cn-drift`) owns idle motion.
- **Defects:** (1) The DRIFT dot sits apart (bottom-left) from the main
  left rail with a separate label — two input regions, unexplained. (2)
  Node coherence metric is abstract. (3) CONNECTED PREVIEW chip.

### BRANCHES (`branches`, min 4×3)
- **Question:** "What search shape should the plan allow?"
- Canvas tree; labels ride a 56px wave-style gutter (`:439`).
- **State chip:** shows **PLAN PREVIEW** when wired (`:4656`) — one of
  the few non-binary chips.
- **Defects:** (1) 56px label gutter shrinks the well on narrow boards.
  (2) "search shape" is planning jargon. (3) The chip flips to a
  different vocabulary ("PLAN") than sibling lenses ("CONNECTED") with no
  explanation.

### WINDOW (`window`, min 3×2)
- **Question:** "Where do limits on the same dimension overlap or
  conflict?" (palette tooltip is a *different* wording: "How much room
  your limits leave — and whether they agree," `:994`).
- Overlapping limit lanes; intersection wears ink; a **conflict seam** in
  `--mui-yellow`; empty intersection → **CONFLICT** state chip.
- **Defects:** (1) `.wb-wd-bite` + `.wb-wd-lbl` hidden at sm/xs
  (`:468`). (2) **Two different one-line descriptions** for the same part
  (VIZC question `:4560` vs palette tooltip `:994`) — inconsistent
  self-description. (3) The yellow conflict seam is the only sanctioned
  yellow but has no legend. (4) CONNECTED PREVIEW / CONFLICT chip.

### SCORE (`score`, min 4×3)
- **Question:** "When each quality rises and falls across the answer."
- Multi-lane arrangement view over a timebase; **MIXED TIMEBASES** error
  state when wired curves disagree (`:4659`).
- **Defects:** (1) `.wb-sc-words` hidden at sm/xs (`:514`). (2) "MIXED
  TIMEBASES" error is jargon a stranger can't act on. (3) CONNECTED
  PREVIEW chip.

### READOUT (`readout`, min 2×2)
- **Question:** "What is the headline number?"
- One left in-dot; big odometer digits + hairline + name + sub; **two-way**
  vertical drag writes the source (dial mechanics, `:buildReadout`).
- **Defects:** (1) The board head title is **"READOUT"** — identical to
  READOUT PAIR (`KINDS` label collision `:1135-1136`). (2) CONNECTED
  PREVIEW chip.

### READOUT PAIR (`readoutpair`, min 2×3)
- **Question:** "What are the two headline numbers?"
- Two stacked readout cells (`buildReadout` with `pair`).
- **Defects:** (1) **Board title renders "READOUT"** (not "READOUT
  PAIR") because `addVizC` uses `K.label` and both KINDS entries are
  `'READOUT'` — a stranger cannot tell the two lenses apart once placed.
  (2) Palette says "READOUT PAIR" (`:997`) but the widget says "READOUT"
  — palette/board name mismatch. (3) CONNECTED PREVIEW chip.

### BEAM (`beam`, min 3×2)
- **Question:** "Which way does a trade-off lean?"
- Left **and** right rails (two inputs); a tilting beam with fulcrum,
  markers, end labels, ratio readout.
- **Defects:** (1) Inputs on both left and right edges (unusual for a
  lens) with no cue the two sides are the two ends of one trade-off. (2)
  Fulcrum/ratio chrome is dense at min size. (3) CONNECTED PREVIEW chip.

### TRIM (`trim`, min 3×2)
- **Question:** "Where you've moved off the author's setup — and by how
  much."
- Variable rail; per-lane bars measuring departure from each control's
  **authored default** (`baseScalar` `:1191`); center spine, foot label.
- **Defects:** (1) `.wb-tr-ro/-name/-foot` all hidden at sm/xs (`:616`)
  — at small sizes TRIM is bars with no names, values, or footer. (2)
  Depends on the invisible "authored default" concept (set via a config
  button); a stranger has no idea what the bars measure against.
  (3) Returns null base for words/select/span/series controls
  (`:1193`) — those lanes silently read flat. (4) CONNECTED PREVIEW chip.

### STEPS (`steps`, min 3×2)
- **Question:** "What the prompt will actually say about the shape."
- Left rail; draws the D6 speller's ladder (shares `seriesGroups`
  `:6108`).
- **State chip:** **PROMPT PREVIEW** when wired (`:4657`).
- **Defects:** (1) Name collision of concept: "STEPS" the visualizer vs
  the "Steps" palette group (the 7 transformer verbs) vs the "Steps"
  config field (quantization) — three unrelated meanings of one word.
  (2) The chip flips to "PROMPT PREVIEW" vocabulary, unlike siblings. (3)
  "the shape" in the question is vague.

---

## MOD PACKS (macros, not parts)

Each pack (`PACKS` `:6405`) is a `drop*` function that finds-or-creates a
compiler section and drops a **pre-wired, pre-authored cluster** of stock
controls + one anchor visualizer, then registers a **pack instance** in
the "MOD PACK INSTANCES" strip (`renderPackRack` `:2989`) with STOCK +
shipped variations (`PACK_VARIATION_PATCHES` `:2779`). `PACK_META`
(`:2809`) gives each a job/example/scope/required-fields.

| Pack | Job (`PACK_META`) | Section | Drops (controls → anchor viz) |
| --- | --- | --- | --- |
| TRANSLATOR | Fit the answer to its reader | READER | words THE READER, pad MEET THEM, dials EXAMPLES/TECHNICAL DEPTH/BIG PICTURE → **BANDINGS** |
| NARRATOR | Shape how the answer sounds | VOICE | dials WARMTH/PACE/DETAIL, sliders CONFIDENCE/FORMALITY, words WRITE AS IF FOR → **WAVE + RADAR** |
| EXPLORER | Set how ideas are explored and chosen | APPROACH | 5 dials BREADTH/DEPTH/PRUNE/WANDER/COMMIT + SURVEY/BALANCED/DECIDE chips → **BRANCHES** |
| ANCHOR | Keep every move tied to one point | APPROACH | words THE POINT, dials STRAY/TIE BACK, switch ONE ARGUMENT → **CONSTELLATION** (STRAY→DRIFT) |
| SKEPTIC | Set the proof burden | PROOF | dials EVIDENCE/SHOW DOUBT, count SOURCES, switch COUNTERCASE, filter SPECULATION → **LEVELS** |
| STORYTELLER | Shape movement opening→close | SHAPE OF THE ANSWER | curves TENSION/DETAIL/WARMTH, words OPEN WITH/CLOSE WITH → **SCORE** |
| EDITOR | Set hard limits and safeguards | RULES | filter LENGTH, range NOVELTY, filter JARGON, switches NO HEDGING/NOTHING INVENTED → **WINDOW** |

- **Purpose:** a one-drop "starter kit" — pure wiring + authored frames +
  placement (the Lego rule; every piece is a stock control/viz).
- **Settings:** the pack-instance card (`renderPackRack`) shows name,
  kind, purpose, example, scope, required-field status, a **variation
  select** (STOCK + shipped + CUSTOM), mute, duplicate, remove, and an
  inline editor.
- **Defects (systemic):** (1) The **"MOD PACK INSTANCES" strip** (`:1027`)
  is an unexplained second surface below the board with no visible link
  to the controls it spawned (goal-flagged). (2) Packs are counted as
  "parts" (7 of the 45) but behave nothing like a part — dropping one
  spawns 5–8 widgets + a section, which a stranger won't anticipate from
  a single palette row. (3) EXPLORER additionally injects **preset chips**
  (SURVEY/BALANCED/DECIDE, `:6239`) onto its BRANCHES viz — a bespoke
  control surface that exists on no other pack, inconsistent. (4) EDITOR
  and SKELETON packs pre-wire a viz (WINDOW/LEVELS) whose CONNECTED
  PREVIEW chip is immediately lit, so the chip conveys nothing from the
  first frame. (5) `required` fields (TRANSLATOR needs THE READER, ANCHOR
  needs THE POINT) gate completeness silently in the strip, disconnected
  from the empty control on the board.

---

## Cross-cutting / mod-level chrome (context for later streams)

- **AUTO PARTS RUN lever** (plate, `:932`): ONE PASS / IN STAGES radio
  that resolves every part set to AUTO. Disconnected from the board;
  throwing it reveals/hides THE PLAN — appearing/disappearing UI
  (goal-flagged).
- **THE PLAN strip** (`:1045`, `hidden` by default): a second compiler
  region, visible only when something resolves to IN STAGES; shows
  `PLAN PREVIEW · k CALLS`. No logical bridge from the authored mod
  (goal-flagged).
- **PROMPT COMPILER header** (`:1035`): COPY PROMPT / EXPORT MOD / VIEW AS
  TEXT buttons ("the Editor row") + note "AUTHORING PREVIEW · NO RUN
  ENGINE."
- **Silent-card convention:** silent parts print `"(LABEL — silent)"`
  cards (`cardSpecs`, many sites) or `"— silent: NAME says nothing"`
  (group) — parenthetical meta-chrome leaking into the prompt preview.
