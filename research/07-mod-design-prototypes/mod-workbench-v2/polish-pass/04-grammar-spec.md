# 04 — Design-language grammar spec (Stream 4)

The ONE grammar for the Mod Workbench prototype. Ground-up, judged only
against the six "done" tests in `../03-polish-goal.md`. Inputs digested:
01-inventory, 02-design-language-audit, 03-fresh-eyes-journey; implementers
should not need to reopen them — every rule ends with a "replaces" table
carrying the offender file:line.

File refs: `wb` = `docs/design/prototypes/mod-workbench-v2.html`,
`css` = `docs/design/prototypes/lib/mod-ui.css`,
`js` = `docs/design/prototypes/lib/mod-ui.js`,
`DESIGN` = `docs/design/prototypes/lib/DESIGN.md`.

---

## Part I — Decision log (contested calls)

### D1 — Jack / payload coding

**Options considered**

- **(a) Keep the 4-glyph payload code, make it self-teaching.** Legend in
  the library, hover labels, richer chips. *Killed:* the glyph differences
  are sub-legible at rendered size (13px dot vs 22×12 capsule vs a 9px
  polyline vs 15px square) — no legend rescues shapes the eye can't
  resolve, so it fails the 5-second test at the jack itself. Worse, the
  code teaches the *wrong* thing: within the signal family coercion is
  TOTAL (DESIGN §signal model) — scalar/span/series glyphs predict nothing
  about what mates with what. The only mating rule in the system is
  signal-vs-artifact. A 4-way code that spends the user's learning budget
  on a distinction with no wiring consequence fails the prediction test.
  It also forces three different jack overhangs (−8/−9/−13px, audit J2)
  and is the direct source of weili's "circles vs ovals look like a bug"
  flag (audit J1).
- **(b) Collapse to fewer glyphs, rely on color/position.** *Killed as a
  standalone:* fixes the silhouette noise but leaves wiring mute — the
  7px-feeling targets, the one grey "CONNECTION CANCELLED" for three
  different failures (fresh-eyes C3/C4), and the accepted-but-meaningless
  wires (C5) all survive. Color can't carry payload meaning because jack
  color already means "source part's accent" (fresh-eyes C2) — a second
  color code would collide.
- **(c) Teach-on-drag (+ the collapse from b). WINNER.** Two silhouettes
  only — round = signal, square = artifact — because two is the number of
  rules that actually govern mating. Payload nuance (a window, a
  trajectory) moves from glyph to *words*, delivered exactly when needed:
  hover chips and drag-time announcements. During a wire drag, compatible
  jacks bloom and name themselves; incompatible ones visibly disable.
  Wins the prediction test (you are told, in words, what the connection
  will carry before you drop), wins the 5-second test (one binary
  silhouette code a stranger meets everywhere), and kills the
  circle-vs-oval defect at the root.

**Kill reasons recorded:** (a) sub-legible glyphs + code predicts nothing
→ fails 5-second and prediction; (b) alone leaves wiring mute → fails
prediction; capsule/polyline glyphs die with (a).

### D2 — Chip taxonomy

**Options considered**

- **(a) One chip component with tone modifiers.** *Killed:* this is what
  exists — nine near-identical bordered capsules where only two are
  clickable (audit C1). Tone modifiers don't survive a 5-second glance;
  the failure is structural, not stylistic.
- **(b) Color-code interactivity (accent = clickable).** *Killed:* accent
  hue is already spoken for (part identity, the color chain). A clickable
  grey chip next to a readout accent chip would invert the rule.
- **(c) Silhouette split. WINNER.** *Pressable chips are slightly-squared;
  readouts are capsules.* This extends DESIGN's existing two-tier radius
  rule ("surfaces slightly-squared; instruments round") into chips:
  anything you press is a 6px-radius bordered button; anything you read
  is a borderless 999px capsule with a wash fill. One glance, one rule,
  zero exceptions. Dead chrome (chips that neither inform a decision nor
  accept a press) is deleted outright.

### D3 — The step accent (color-chain boundary)

**Options considered**

- **(a) Per-step instance hues, like controls.** *Killed:* steps are a
  class of verbs, not identities — giving EXPLORE a purple would claim an
  identity semantics the system doesn't have, burn 7 of a small hue
  budget, and break "same look = same class" for the one part family
  where class IS the meaning.
- **(b) Neutral slate/ink for steps.** *Killed:* steps vanish into
  chrome; the compiler and plan lose the ability to point at the step
  family at all.
- **(c) One reserved class accent, boundary made legible. WINNER.** All
  steps keep ONE cobalt (`#3f78df`) — but it becomes *reserved*: it is
  removed from the control swatch palette so no control can ever wear the
  step blue, and every step-colored surface (identity mark, compiler
  chip, plan segment) also wears the SQUARE class mark. The rule a
  stranger infers: *a unique hue = one part you named; the shared cobalt
  + square = the work chain.* Artifact cables stay ink — "color is a
  signal's identity; ink is the work itself" becomes a real, stated rule
  instead of an undeclared `!important` (audit Co3).

### D4 — State words and invisible silence

**Options considered**

- **(a) Keep per-surface wording, fix only the worst.** *Killed:* five
  spellings for one semantic is the defect (audit S1); partial fixes
  leave the one-grammar test failing by definition.
- **(b) One five-word lexicon, spoken on the face AND in the compiler.
  WINNER.** Exactly one spelling each — `OFF`, `UNWIRED`, `CONFLICT`,
  `AUTO`, `READY` (plus the un-ready form `NEEDS <X>`). A part that
  currently contributes nothing wears it on its face (wash fill + `OFF`
  state chip) and its compiler card agrees (`--silent` wash card, pill
  `OFF`). Silence becomes visible at both ends of the journey.

### D5 — Feedback placement

**Options considered**

- **(a) Promote the library footer to a proper status bar.** *Killed:* a
  better-dressed whisper is still a whisper — feedback 1600px from the
  action fails the prediction test's "invalid actions are visibly
  impossible, not surprising" clause (fresh-eyes B3/C3/F7 all trace to
  distance, not styling).
- **(b) Anchored feedback chips. WINNER.** One rule: *feedback renders at
  the thing that changed.* Wire feedback at the jack, add/undo feedback
  at the part, copy/export feedback at the button. The footer channel
  retires; a visually-hidden live region keeps AT parity.

---

## Part II — Token table

Additions and changes to the DESIGN token set. Everything not listed here
is unchanged and still binds.

### Type (the whole ladder — nothing else is sanctioned)

| Token | Value | Use |
| --- | --- | --- |
| `--mui-fs-micro` | 9px caps, ls `--mui-ls-wide` | chips (all four kinds), eyebrows, jack chips, field labels, sublabels |
| `--mui-fs-label` | 10px caps, ls `--mui-ls` | control/card titles, buttons, section names, nav chips, feedback chips |
| `--mui-fs-value` | 11px tabular | readouts, pill values, plan sample values |
| `--mui-fs-sentence` | 13px sentence case | card sentences, step prose, plan prose, popover previews |

- **Hard floor: 9px. No `font-size` below 9px anywhere, including SVG
  `<text>`.** Copy that doesn't fit at its sanctioned size is shortened
  or moved to a hover chip — never shrunk.
- **Weights: 400 (sentence text) and 500 (caps labels/chips) only.**
  600/700 die. Emphasis = ink vs ink-soft, or an ink-filled chip; never
  weight.
- Instrument numerals drawn inside a well (readout odometer, STEPS
  ladder numerals) are instrument ink, not UI text: exempt from the
  ladder but never below 11px.

### Jacks

| Token | Value | Note |
| --- | --- | --- |
| signal jack | 13px round dot, 1.5px ink ring | the only signal silhouette |
| artifact jack | 15px square, 2px radius, 2px ring | the only other silhouette |
| jack overhang | −8px, all families, all edges | kills −9/−13 variants |
| jack hit area | **24×24px minimum** | invisible hit zone on `.mui-node` and every rail dot |
| drag bloom | scale 1.3, accent ring | compatible candidates during wire drag |
| drag fade | opacity .35 | incompatible jacks + their cards during drag |
| input cue | inward chevron, **every input jack** | including all viz rail dots |

### Chips

| Kind | Silhouette | Border | Fill | Type | Cursor |
| --- | --- | --- | --- | --- | --- |
| toggle chip | rounded-rect `--mui-r-chip` (6px), min-height 22px | 1px ink | transparent; **active = ink fill, paper text** | 10px caps 500 | pointer |
| nav chip | borderless text, 10px caps | none | none; hover = underline | 10px caps 500 | pointer |
| value chip | capsule 999px, padding 2px 8px | **none** | `--accent-wash` (or 8% ink wash when unaccented) | 9px caps / 11px value | default |
| state chip | capsule 999px, padding 2px 8px | 1px `--mui-line` | none | 9px caps, ink-soft | default |
| state chip (alert) | capsule | 1px ink | none | 9px caps ink + 6px `--mui-yellow` dot prefix | default |
| feedback chip | capsule | none | solid ink, paper text | 10px caps | default |

Rule of thumb a stranger can learn in one glance: **squared + bordered =
press it; capsule = read it.**

### Color

| Token | Value | Note |
| --- | --- | --- |
| `STEP_ACCENT` | `#3f78df` | **reserved** — the step class only; never a swatch |
| control swatches | `#222222 #d66be8 #a946c8 #48a2ef #eca23b #24986a #f1666d #b8552f` | `#3f78df` removed, rust `#b8552f` added; default stays `#a946c8` |
| swatch assignment | least-used-first | auto-assign picks the swatch with fewest instances on board (kills the purple pile-up, fresh-eyes F1) |
| `--mui-yellow` | conflict only | the ONE meaning; silent-member tooltip loses it |
| artifact cables | ink, declared | signal cables accent; stated as a rule, not an `!important` |

### Motion / affordance

| Token | Value |
| --- | --- |
| feedback chip life | enter `--mui-t-fast`, hold 2400ms, fade `--mui-t-move` |
| resize handle opacity | .18 rest / .50 card hover / .90 handle hover |

---

## Part III — The rules

### R1 — Jacks: two silhouettes, taught at drag time

1. **Silhouettes.** Round 13px dot = signal (scalar, span, series — all of
   them). Square 15px port = artifact. Nothing else. The span capsule and
   the series polyline are deleted as jack shapes; `nodeDot({type})`
   keeps its API but renders `span`/`series` as round.
2. **Direction.** Inputs straddle the LEFT (or top, for top rails) edge
   and **every input wears the inward chevron** — including all
   visualizer rail dots, which today are bare. Outputs straddle the
   RIGHT edge. Fill = wired state: hollow when unwired, filled (with the
   wire's accent) when connected. Unchanged: hover = accent + name chip.
3. **Payload in words, not glyphs.** The jack hover chip speaks the
   payload plainly: `NOVELTY · 30–70 (A WINDOW)`, `WARMTH ARC · 3 POINTS
   (CHANGES ACROSS THE ANSWER)`, `BREADTH · TAKES A NUMBER`. Chips are
   9px caps on ink — the existing `.mui-node-chip`, kept.
4. **Teach-on-drag.** On wire-drag start (or click-to-arm): every
   *compatible* input jack blooms (scale 1.3, accent ring) and shows its
   name chip persistently for the duration of the drag; every
   *incompatible* jack and its card fade to .35 opacity. The nearest
   candidate keeps the existing `is-hover` accent fill. Refusal is
   visible before the drop — this is the legend; there is no legend
   panel.
5. **Refusal and replacement speak at the jack.** Dropping near a refused
   slot: feedback chip AT THE JACK with the reason (`WORDS — READ ONLY`,
   `SQUARE PORT — TAKES WORK, NOT A SIGNAL`). Dropping on an *occupied*
   input **replaces** the existing wire (no more silent CANCELLED), with
   a feedback chip `REPLACED <OLD SOURCE>`; undo covers regret. A miss
   far from any jack simply drops the wire — no message (a non-event
   needs no eulogy).
6. **Hit targets.** 24×24px minimum invisible hit area on every jack and
   rail dot (pad the `.mui-node` box or use `::after`).
7. **Read-only jacks.** WORDS/ORDER/MIXER outputs refuse write-back; this
   is now visible only when it matters — during a drag *from* a two-way
   lens, they fade like any incompatible jack (rule 4 covers it).

**Replaces**

| Rule | Current offender |
| --- | --- |
| R1.1 | `js:62` (`JACK_TYPE` span/series map — types collapse to render round), `css:833–850` (`.mui-node--span`, `.mui-node--series` glyph CSS — delete), DESIGN §jack glyphs (rewrite: "round signal vs square artifact" becomes literally true, resolving audit J4) |
| R1.1 | `css:834` (−13px span overhang), `css:889` (−9px artifact) → all −8px |
| R1.2 | `js:2896` rail `nodeDot` calls — add `dir:'in'` chevron on every rail dot; `css:862–876` chevron anatomy (keep, now universal) |
| R1.4 | `wb:2538–2552` (`nearestSlot` — candidacy exists; add bloom/fade classes + persistent chips), `wb:2544` comment (refusal-by-silence stays; silence gains a face) |
| R1.5 | `wb:2630` (`CONNECTION CANCELLED` in `palHint`), `wb:2617–2629` (steal/refusal messages → feedback chips at the jack), `wb:2097` (keyboard-wire refusal reason → at the jack) |
| R1.6 | `css:293–304` (`.mui-node` 16px box → 24px hit), rail dot equivalents |
| R1.7 | `js:1275` (`canWriteBack` — logic stays; visibility now via R1.4 fade) |

### R2 — Chips: pressable vs readout, and dead chrome dies

1. **The one rule.** Interactive chips are slightly-squared, bordered,
   and respond to hover/press (`--mui-scale-press`); readout chips are
   borderless capsules. No bordered capsule may be non-interactive; no
   rounded-rect may be inert. (Token table, Part II.)
2. **The full chip set** — every chip in the app is one of these four:
   - **Value chip** — a value the user set or a live sample. Capsule,
     wash fill. E.g. compiler card pill, plan-seg sample.
   - **State chip** — one of the five lexicon words (R6) or `NEEDS <X>`,
     shown ONLY while the state is non-nominal. Capsule, hairline. A
     wired, healthy part shows NO state chip.
   - **Toggle chip** — presses that change state: filter mode, fidelity,
     EXPLORER presets, ONE PASS / IN STAGES. Rounded-rect, bordered;
     the active option is ink-filled.
   - **Nav chip** — presses that move the viewport (WORKBENCH / PROMPT /
     PLAN). Borderless caps text + hover underline. **Nav must not share
     a silhouette with actions** — UNDO is a `.mui-btn`, not a nav chip
     (fresh-eyes I1).
3. **Dead chrome dies.** The `wb-viz-state` badge is deleted as a
   persistent surface. Its replacement: a state chip that appears only
   for `UNWIRED`, `CONFLICT`, and `NEEDS <X>`; the word pair
   `CONNECTED PREVIEW` and its kin (`PLAN PREVIEW`, `PROMPT PREVIEW`)
   never render — a wired lens's wires are its own status.
   **The word "PREVIEW" is banned from chips** (all 9 audit sites).
4. **One value grammar in the compiler pill.** The card pill always reads
   `<value>` in the part's own terms — `72%`, `ON`/`OFF`, `×3`, `≤ 40`,
   `30–70`, `A › B`, a stop name — and never a type word. The literal
   `STEP` pill dies (a step card carries no pill; its verb is the
   eyebrow). Curve pills drop the cryptic forms: `9/10 PREVIEW` and
   `3PT ↥90` become `NOW 9/10` (position-wired) and `3 PTS · PEAK 90`.
5. **Dead lib surface.** `.mui-pill-readout` (zero workbench consumers)
   is removed from the lib (gallery specimen goes with it).

**Replaces**

| Rule | Current offender |
| --- | --- |
| R2.2 | `wb:274–282` (`.wb-viz-state`), `wb:856` (`.plan-pill` → state/value chip), `wb:39` (`.plate .chip` `SPEC 05` — decoration; delete or make a value chip), `wb:660` (`.wb-chip` → toggle chip spec), `wb:64` (`.wb-jump` → nav chip spec), `wb:882` (`.plan-seg-sample` → value chip), `css:804` (`.mui-card-pill` → value chip) |
| R2.3 | `wb:4647–4670` (`updateVizState` — keep the ARIA summary, render a chip only for `empty`/`error` keys), audit C3 (off-contract badge) |
| R2.3 | "PREVIEW" sites: `wb:920, 1034, 1048, 3617, 4655–4657, 6633, 6636` |
| R2.4 | `wb:3535–3665` (`pillFor` grammars, incl. `STEP` at `wb:3570`, curve at `wb:3616`) |
| R2.5 | `css:710` (`.mui-pill-readout`), `gallery.html:287–289` |

### R3 — Type: four sizes, 9px floor

1. Only the four ladder sizes (Part II) plus the instrument-numeral
   exemption exist. The 13-step workbench ladder
   (`6.8 / 7 / 7.5 / 8 / 8.5 / 9.5 / 10.5 / 12 / 20`) is deleted.
2. **Mechanical mapping** — every current size maps by role, never by
   nearest number:

   | Current | Role | Becomes |
   | --- | --- | --- |
   | 6.8px (`wb:277` viz state) | state | 9px state chip — but only when it survives R2.3 |
   | 7px (`wb:157–162` pack kind/example/scope) | meta | 9px; copy shortened to fit (Stream 6 owns the pack-row copy) |
   | 7.5px (`wb:118` config-preview strong; `wb:865` plan-track-label) | eyebrow | 9px |
   | 8px (31 decls: `wb:64` wb-jump, `wb:660` wb-chip, `wb:898` steps-word SVG, hints, etc.) | labels/buttons | 10px; eyebrow-role ones 9px |
   | 8.5px (`wb:39` plate chip, `wb:856` plan-pill, `wb:882` plan-seg-sample) | chips | 9px caps or 11px value per chip kind |
   | 9.5px | label | 10px |
   | 10.5px (`wb:889` plan-seg-prose) | prose | 13px sentence |
   | 12px (step prose) | prose | 13px sentence |
   | 20px (readout odometer) | instrument numeral | exempt (≥11px, drawn in the well) |

3. **What gets rewritten instead of shrunk:** pack-instance meta
   (job/example/scope) keeps only the job sentence at 9px in the strip —
   example and scope move into the pack's popover; the plan track label
   drops its redundant left half (`WORK CHAIN` already appears in the
   segment verbs). If promoted text overflows, shorten the copy or move
   it to a hover chip — the size never gives.
4. Verification is mechanical:
   `grep -nE 'font-size:\s*[0-8](\.[0-9]+)?px' mod-workbench-v2.html lib/mod-ui.css`
   must return zero hits; `font-weight: 6|700` likewise (the weight rule,
   Part II).

**Replaces**

| Rule | Current offender |
| --- | --- |
| R3.1–2 | audit T1: 46 sub-9px declarations, `wb` passim (representatives above) |
| R3.2 | `wb:277` (T2, 6.8px), `wb:118`, `wb:157–162`, `wb:865` |
| R3.4 | audit T4 weights: `wb:38, 67, 84, 153, 661, 702, 855, 878` (600), `wb:534, 898` (700) |
| eyebrow unification (one 9px spec) | audit T3: `css:1540` (9px lib viz title) vs `wb:269` (10px wb viz head) — both become the R4 header at 10px title / 9px eyebrow |

### R4 — Card anatomy: one header grammar, visible states

1. **One shell.** Every board part — control, process, step, visualizer —
   is `border: 1px var(--mui-line)`, radius `--mui-r-card` (7px), padding
   10px 12px (the existing good baseline). The duplicate workbench viz
   shell (`.wb-viz`) is retired; all 15 lenses build on the lib
   `vizShell` so there is exactly one head implementation.
2. **One header grammar**, left to right:
   `[class mark] [TITLE 10px caps] ..... [state chip, if any] [hover actions]`.
   - Class mark per R8 (solid dot / hollow ring / square / none).
   - Title ellipsizes; a truncated title's full name lives on the hover
     chip. **A part's default drop size must render its full authored
     title** — "R…" at birth is a spec violation (default sizing per
     part is Stream 5's table; this is the constraint it satisfies).
   - Hover actions top-right, same cluster everywhere: settings glyph
     (whenever the part has any setting — steps and visualizers included;
     the two-settings-philosophies split dies), then `×`. Viz `−`/`+`
     growth chrome stays hover-revealed per the contract, with ≥19px
     targets.
3. **States.**
   - rest: hairline border.
   - hover: border-color `--mui-ink-faint`; chrome + resize handle
     reveal.
   - selected: border-color `--mui-ink` (matches the unified marquee
     feedback).
   - off/silent (contributes nothing now): face wears `--accent-wash`
     fill + state chip `OFF` (R6).
   - muted/disabled (pack mute): whole card at .45 opacity + `OFF` chip.
4. **Resize is discoverable.** The 24px dot-matrix corner is visible at
   rest (opacity .18), .50 on card hover, .90 on handle hover; cursor
   `nwse-resize` unchanged. (Board reflow behavior on resize is a journey
   concern — Stream 6.)
5. **Size classes shed uniformly.** One shared rule replaces the five
   bespoke `display:none` ladders: at `md+` everything shows; at `sm` the
   part drops its *tertiary* row (foot labels, numerals, sublabels — each
   part names its tertiary row in Stream 5's table); at `xs` the label
   moves to the hover chip (existing lib rule). No lens may go fully
   unlabeled at a size it accepts — if a size can't carry the name, the
   part refuses the size (`minCells`).
6. Name collision fix: READOUT PAIR's board title renders "READOUT PAIR"
   (distinct `KINDS` label), ending the two-lenses-one-name defect.

**Replaces**

| Rule | Current offender |
| --- | --- |
| R4.1 | audit A2: `css:1515` (`.mui-viz`) vs `wb:261` (`.wb-viz`) — one shell |
| R4.2 | fresh-eyes #15 (gearless steps/viz), `wb:2067` (unlabeled radar `+`/`−`), E5/B8 truncated titles ("R…", "TECHNICAL DEP…") |
| R4.3 | invisible silence sites — see R6 replaces |
| R4.4 | `wb:236–246` (`.wb-rz` opacity 0 at rest; fresh-eyes E1) |
| R4.5 | audit A3 bespoke hide rules: `wb:351–352, 418, 468–469, 514, 616–617` |
| R4.6 | `js:1135–1136` (`KINDS` label collision), fresh-eyes B8/F… palette-vs-board name mismatch |

### R5 — Color: the chain is the law; the boundary is marked

1. **The chain stays, verbatim** (audit Co1, the one consistent system):
   control accent → wire stroke → input dot fill → compiler card ground →
   plan sample tint. This is the template every colored surface follows.
2. **The step boundary** (D3): steps keep the single reserved cobalt
   `#3f78df`; the swatch palette drops it (rust `#b8552f` replaces it) so
   the cobalt can only ever mean "the work chain". Every cobalt surface
   also carries the square class mark: the step's identity square, a
   small square glyph in the eyebrow of step compiler cards and plan
   segments. Hue + glyph together make the class legible even next to
   the remaining sky-blue swatch.
3. **Cables:** signal = thin, accent (unchanged); artifact = wider, ink —
   now a stated rule in DESIGN and a plain CSS rule, not an `!important`
   ambush.
4. **Yellow means conflict.** Only the WINDOW conflict seam and the
   CONFLICT alert chip may use `--mui-yellow`. The silent-member tooltip
   restyles to ink-on-wash.
5. **Assignment:** new parts take the least-used swatch on the board
   (kills round-robin repeats reading as false relationships).

**Replaces**

| Rule | Current offender |
| --- | --- |
| R5.2 | audit Co2: `wb:1952` (`STEP_ACCENT`), `wb:1966`, `wb:3999` (plan segments) — value stays, boundary marked; `js` `PRESETS` + DESIGN §per-control accent (swatch swap) |
| R5.3 | audit Co3: `wb:815` (`.wire--artifact .wire-vis` `!important`) |
| R5.4 | audit Co4: `wb:654` (`.wb-mtip.silent` yellow) — `wb:496` conflict seam stays |
| R5.5 | fresh-eyes F1/B4 (round-robin purple pile-up) |

### R6 — State words: one lexicon, silence has a face

1. **The lexicon** — one spelling each, used verbatim everywhere (face
   chips, compiler pills, plan, pack strip, ARIA):

   | Semantic | The word | Never again |
   | --- | --- | --- |
   | contributes nothing at current value | `OFF` | `—`, `(X — silent)`, "silent" |
   | no wire in a jack/lens | `UNWIRED` | `EMPTY · WIRE INPUT`, blank |
   | limits cannot all hold / inputs disagree | `CONFLICT` | `MIXED TIMEBASES` (becomes `CONFLICT`, hover chip carries the detail "two timebases — unwire one") |
   | resolution deferred to the mod lever | `AUTO` | — |
   | a pack/mod has everything it needs | `READY` / `NEEDS <X>` | 8px static status text |

2. **Invisible silence dies.** A part emitting nothing (switch off,
   empty WORDS, REVISE 0, SELECT on a frameless option, a muted pack
   member) shows it on its face — wash fill + `OFF` state chip (R4.3) —
   AND in the compiler: the silent card is `.mui-card--silent` (wash
   ground, ink text) with pill `OFF`, eyebrow = the part's name, and no
   fabricated sentence. Face and card always agree.
3. The switch readout-lens headline reads `OFF`, not `—` (S2). The group
   frame's `"— silent: NAME says nothing"` meta-string dies; a silent
   member renders the group's card as silent per rule 2.

**Replaces**

| Rule | Current offender |
| --- | --- |
| R6.1 | audit S1: `wb:3537` (`OFF` pill — spelling survives, becomes the standard), `wb:5778` (`—`), `wb:3561`, `wb:4655` (`EMPTY · WIRE INPUT`), `wb:4658–4659` (`CONFLICT` / `MIXED TIMEBASES`) |
| R6.2 | `cardSpecs` "(LABEL — silent)" sites (`wb` passim), fresh-eyes F4 (six ghost chips) |
| R6.3 | `wb:5778`, `wb:6475` (group meta-string) |
| R6.1 READY | fresh-eyes G2 (`NEEDS READER` as 8px decoration → state chip, and a press on it focuses the empty field — the chip is then a toggle chip by R2) |

### R7 — Feedback: at the thing that changed

1. **The rule.** Every confirmation and every refusal renders as a
   **feedback chip** (ink capsule, paper text, 10px caps, hold 2.4s)
   anchored to the element it concerns. If that element is off-viewport,
   it is scrolled into view first. No global whisper channel.
2. Placement map (exhaustive):
   - wire made / replaced / refused → at the input jack (R1.5).
   - part added → the part lands selected, at the nearest free cell to
     the *visible* board center, with chip `ADDED` above it.
   - undo → at the restored/changed object, chip `UNDID · <label>`.
   - copy / export / view-as-text → at the button pressed; VIEW AS TEXT
     additionally scrolls the revealed text panel into view (a revealed
     surface must arrive in the viewport).
   - config changes (authored default set, etc.) → at the popover field
     or the part.
   - pack added → chip at the pack's board cluster (journey linkage
     beyond this is Stream 6).
3. The library footer (`.pal-hint`) returns to being a palette label
   (counts only). A visually-hidden `aria-live` region mirrors every
   feedback chip for AT.

**Replaces**

| Rule | Current offender |
| --- | --- |
| R7.1 | `wb:107` + `wb:1013` (`.pal-hint` as global 8px status channel) |
| R7.2 | `wb:2630` / `wb:2617–2629` (wiring), fresh-eyes B3 (add out of focus), `wb:1099` (undo), fresh-eyes F7 (copy/export), F6 (VIEW AS TEXT no scroll-to), `wb:1785` (authored default), `wb:2917` (duplicate) |
| R7.3 | internal-id leaks in announcements (`DIAL CONNECTED TO S3`, fresh-eyes #14) — feedback chips speak part + jack *names* only |

### R8 — Class legibility: silhouette teaches the taxonomy

1. **Four class marks**, one header slot (R4.2):

   | Class | Mark | Accent | Jacks | The inference a stranger makes |
   | --- | --- | --- | --- | --- |
   | control | solid round dot | per-instance hue | round out, right | "a value I set; my color flows down my wire" |
   | process (stage / fork / revise) | **hollow round ring** (2px, accent) | per-instance hue | round out, right | "round like a control, but hollow — it acts at run time rather than holding a value" |
   | step | solid square | class cobalt | square in/out + round signal-ins (chevroned) | "square + shared blue = the work chain; all squares are one family" |
   | visualizer | none | none (inherits by wire) | round ins only, no outs | "no identity, no output — it only shows me things" |

   The mark repeats on the part's compiler card eyebrow, so board, card,
   and plan all speak the same class language (reinforces the R5 chain).
2. **Group frame:** keeps its dashed-hairline + tab anatomy — the
   silhouette already says "container". Its palette row wears a dashed
   frame icon, so the library stops presenting it as a 13th control.
3. **Packs are macros, and the library says so.** A pack's palette row is
   visually a *cluster*, not a tile: a mini stack of 3 ghost tiles
   (dashed hairline, wash fill — the ghost-growth rule: an affordance is
   a ghost of what it creates) + the count as a value chip `DROPS 6
   PARTS`. Nothing is deleted or renamed; the silhouette alone tells a
   stranger that clicking drops a cluster, not a part. (What the pack
   strip below the board is FOR is Stream 6.)
4. Part palette rows for the four real classes carry their class mark at
   left, so the taxonomy is learnable *before* the first drop.

**Replaces**

| Rule | Current offender |
| --- | --- |
| R8.1 | audit A1: `css:237` (control dot), `css:1849` (step dot), viz no-dot (contract) — the marks stay; process gains the ring (today STAGE/FORK/REVISE wear the control dot, indistinguishable from dials: inventory STAGE defect 2) |
| R8.1 | compiler-card eyebrow mark: `wb` card build sites (with R2.4) |
| R8.2 | inventory GROUP VOICE defect 1 (sits among controls with no container cue), `wb:948–1012` palette rows |
| R8.3 | fresh-eyes B9/#3 (packs detonate unannounced), `wb:1000–1012` pack rows, `PACKS` `wb:6405` |
| R8.4 | `wb:948–1012` (palette rows carry only names + tooltips today) |

---

## Out of scope (deliberately left to later streams)

- **Stream 5:** per-part face contents at each size (which row is
  "tertiary" per R4.5), default drop sizes that satisfy R4.2's
  full-title constraint, popover field order + live sentence preview,
  the WAVE input renames, DIAL-vs-SLIDER guidance, pad axis-name
  visibility, which settings each part's gear opens.
- **Stream 6:** everything storyline — the pack strip's purpose and
  board↔strip↔compiler linkage, PLAN / AUTO PARTS RUN narration and the
  ONE PASS ↔ IN STAGES copy, the below-the-fold/scroll architecture,
  compiler chip → part navigation, duplicate-instruction lint,
  board-reflow-on-resize behavior, section header copy.
- **Not chosen here:** any part deletion, merger, or capability change
  (goal non-goals). The coercion matrix, silence-when-off semantics,
  and refusal-by-silence *mechanics* are untouched — only their
  visibility changes.
