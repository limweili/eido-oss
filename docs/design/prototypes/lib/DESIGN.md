# MOD UI — design system spec (lib 05)

The foundation component library for the Mod builder redesign. Design
language: **instrument-flat** — flat ink-line rendering, physical behavior
(detents, snaps, drags, weight) without skeuomorphism. Single light theme.

Files: `mod-ui.css` (tokens + styles), `mod-ui-font.css` (embedded
JetBrains Mono, base64 data URIs), `mod-ui.js` (components, global
`ModUI`, file://-safe), `gallery.html` (specimen page).

SPEC 03 added: the **signal model** (scalar / span / series + a total
coercion matrix), the **jack glyph language**, four new control kinds
(**pad, range, filter, curve**), the **multi-jack** and **min-footprint**
primitives, and the **visualizer contract** (shell, slot, rail,
write-back, motion charter). Everything in SPEC 02 still binds.

SPEC 04 (the speech round) adds three kinds — **select** (one-of-N
nominal, jackless by design), **order** (drag-to-rank, scalar
displacement jack), **mixer** (shares always summing to 100, one jack
per channel — the **variable multi-jack**, the round's one new lib
surface) — plus the **named-stops rider** on stepped dial/slider (which
dissolves the old Blend control). The coercion matrix gains ZERO cells:
every shipped jack is an ordinary scalar, or absent.

SPEC 05 (the PROCESS axis, lib half) opens two seams and adds two kinds:
the **control-input jack** (the curve gains ONE scalar **POSITION**
input — the first input jack on any control, a new lib surface — drawing
the wired position as a hairline and sampling its emission; GAIN stays
deferred), **renamable x-detents** on the curve (creator stage words:
exploring / organising / committing), the **FORK** kind (compiled
routing — an ink junction with a LEAN handle, one scalar jack, the
**check-block** config), the **REVISE** kind (compiled feedback — a
passes count with nested arcs, one scalar jack), the **RUNS foot
chip** (`ONE CALL · STAGED · AUTO`, opt-in per control), and the
**artifact jack glyph** (a SQUARE port — the SECOND cable family, which
does NOT join signal coercion) with a thin **step shell** helper. The
coercion matrix again gains ZERO cells: the POSITION input is an ordinary
scalar; the artifact family is a separate, non-mating connector.
**STAGE is NOT a new kind** — it is the slider kind plus named stops
(SPEC 04's rider), which emits; ship it as a preset, not a component.

## What came from each reference

| Reference | Taken |
| --- | --- |
| `09-nothing-eq-advanced-light.png` (Nothing EQ, light) | Gray-on-gray calm; capsule slider tracks with **dot detents inside the track**; big round handles; accent fill; mono letterspaced caps; pill value readouts ("F 110HZ") with a tinted cap + accent hairline; one accent doing focused work; generous even spacing. |
| `10-te-ikea-frekvens-poster.png` (TE × IKEA Frekvens) | Seasoning only: dot-matrix as the recurring texture (board dot fields, masthead block); black/red(/rare yellow) graphic punch in the gallery chrome; bold-but-sparse structure. |
| `08-delay-reverb-module-grid.png` (delay/reverb plugin) | Warm paper ground; module anatomy (label → instrument → readout); **controls that carry a picture of their own value** (the dial's arc, the slider's fill, the switch's thrown handle); mono value readouts under controls; capsule toggles. |
| `12-xy-pad-dark.png` (XY pad) | The pad face, translated to instrument-flat: dark well → recessed track well; dot-grid field; crosshair hairlines tracking the handle; one round handle. Paper/ink/accent, never dark. |

## The signal model (SPEC 03)

A cable payload has exactly ONE of three shapes:

| Shape | Value | Emitted by |
| --- | --- | --- |
| **scalar** | one 0–100 number | dial, slider, switch, count, each pad axis |
| **span** | `{lo, hi, mode}` on 0–100 | range, filter |
| **series** | `[{t, v}]`, both 0–100, 2–5 points, endpoints pinned at t=0/100 | curve |

Coercion is **TOTAL — every cable always plugs**; there are no typed-jack
errors. The workbench implements this matrix; the lib ships the glyphs
and this spec:

| from \ into | scalar slot | span slot | series slot |
| --- | --- | --- | --- |
| **scalar** | as-is | zero-width span | flat line |
| **span** `[lo,hi]` | center | as-is | flat band (two flat lines / band) |
| **series** `[(t,v)]` | sampled at "now" | min/max envelope of the series | as-is |

"Now" is the board's shared rAF clock sweeping 0→100 ambiently (~5s
period). A horizontal drag on a curve's face (not on a point) is the
**scrub gesture**: it broadcasts a momentary "now" board-wide and the
ambient sweep resumes on release. There is NO playhead object, no
transport UI, and nothing about "now" ever reaches the compiler — the
control reports the gesture (`onScrub`), the board owns the clock.

### Jack silhouettes — two, only (grammar R1)

- **round 13px dot = signal** — scalar, span, and series all render the
  same round jack. Within the signal family coercion is TOTAL, so shape
  differences would teach a distinction with no wiring consequence.
- **square 15px port = artifact** — the second cable family, non-mating.

Payload nuance (a window, a trajectory) lives in **words**, delivered
when needed: the jack hover chip and the teach-on-drag chips. Every
input jack wears the inward chevron; every jack overhang is −8px; every
jack carries a 24×24px minimum hit area. `node.setType(t)` keeps its
API — `span`/`series` render round; only `artifact` changes silhouette.
During a wire drag, compatible inputs bloom (scale 1.3, accent ring,
persistent name chip — `.is-cand`) and incompatible ones fade to .35
(`.is-mute`): the drag is the legend.

### The multi-jack primitive

A control may expose N **named** jacks (pad = 2, fixed; mixer = one per
channel, 2–6, **config-driven — the variable multi-jack**, SPEC 04's one
new lib surface). Each is an ordinary scalar jack downstream —
indistinguishable from a whole control's jack. Jack identity = the
sublabel (axis / channel name, carried on the hover chip) + the
control's accent. The lib owns rendering, hover chips, and jack
add/remove when config changes (`c.nodes`, e.g. `{x, y}` or one key per
channel); the workbench owns wiring — its normalizer drops dangling
wires when a channel is removed. `c.node` remains the primary jack for
single-jack consumers.

### Jackless by design: select

SELECT emits **no cable payload at all** — `c.node` is null, no jack is
rendered. A nominal choice has no honest scalar (CLIENT is not "50
between FOUNDER and BOARD"), and the total-coercion guarantee would
force exactly that lie into every wire. Precedent: words already emits
no payload. This is a design statement, not an omission: SELECT's
composition channels are its sentence, group-voice slots, and (when the
wiring round lands) the `select` wire that swaps frames downstream.
ORDER's jack stays an ordinary scalar for the same discipline — a
fourth `order` payload shape is deferred until a native consumer exists.

### The control-input jack (SPEC 05) — legal only for the curve's POSITION

Until SPEC 05 every control was output-only. The curve now grows ONE
scalar **input** jack, **POSITION**, and the seam is deliberately narrow:
*it opens once, for POSITION only.* The rule that legalizes it is *the
face is already a picture* — a wired position is drawn as a vertical
accent hairline on the well, with a dot where it crosses the curve (the
sampled-now the emission speaks); unwired, no hairline, and the control
behaves exactly as before. Total coercion already lets any scalar plug
there, so the workbench feeds it via `c.setInput('position', v|null)`;
`c.position()` and `c.sampleAt(t)` expose the wired value and its sample
for the emission. **GAIN stays deferred** (same seam, no second opening
this round), and no other control grows an input jack.

**Input-jack anatomy** (a lib surface, reused by steps and every rail
dot): an input straddles the **LEFT** edge (mirroring the output
overhang on the right) and wears an **inward chevron** cue on the dot —
**every input in the system wears it**, including visualizer rail dots —
so *in* reads distinct from *out* at a glance and not only by which edge
it sits on. Its hover chip points inward. The family silhouette
(round signal / square artifact) is orthogonal to direction.

### Two cable families (SPEC 05) — signal round, artifact square

There is a SECOND cable family. **Signal** cables (scalar / span /
series) obey total coercion, unchanged. **Artifact** cables carry a
transformer's work-product (a draft, a cluster set, a critique) and do
**NOT** join the coercion matrix — an artifact has no honest scalar, and
faking one would put a lie in the matrix that holds the signal model
together. The two families are drawn as different connectors and are
**non-mating**:

| Family | Glyph | Cable | Coercion |
| --- | --- | --- | --- |
| **signal** | round dot | thin, accent | total (unchanged) |
| **artifact** | a **SQUARE** port, wider ink | wider, **ink** | none — separate family |

**Cable color is a rule, not an override:** a signal cable wears its
source control's accent ("color is a signal's identity"); an artifact
cable is always ink ("ink is the work itself").

**Refusal is visible, then spoken.** A non-mating jack fades during the
drag (teach-on-drag) instead of highlighting; dropping near a refused
slot speaks the reason in a feedback chip at the jack ("SQUARE PORT ·
TAKES WORK, NOT A SIGNAL"). No error toasts, no red states. Artifact
**contents** are engine-surface — the prototype renders the family
(jacks, cables, the plan strip) but never fabricates an artifact's
content.

## Tokens

### Color

| Token | Value | Role |
| --- | --- | --- |
| `--mui-ground` | `#e8e4dc` | page / board field (warm paper) |
| `--mui-panel` | `#f1eee8` | control chip — one step lighter than ground |
| `--mui-raised` | `#f8f6f1` | popup / floating surfaces — two steps lighter |
| `--mui-track` | `#dcd7cc` | recessed capsule wells (slider, switch, count) |
| `--mui-field` | `#e9e5dd` | text input wells |
| `--mui-ink` | `#232019` | near-black warm ink: structure, cores, handles, text |
| `--mui-ink-soft` | `#7b756a` | labels, secondary text |
| `--mui-ink-faint` | `#a49d90` | tertiary / placeholders |
| `--mui-line` | `rgba(35,32,25,.16)` | hairlines everywhere |
| `--mui-dot` | `rgba(35,32,25,.26)` | detent dots, arc ticks |
| `--mui-red` | `#d8452f` | warm signal red — destructive/reset actions and the UI's own accent |
| `--mui-yellow` | `#e9a820` | rare secondary state mark ONLY (never a base color) |

Surface logic: three steps of the same warm gray — ground → panel → raised.
Recessed things (tracks, wells) are darker than their panel; floating things
are lighter. Depth is stated by value, never by resting shadows — the one
sanctioned shadow is `--mui-shadow-lift`, worn only while something is
lifted or floating (popups, dragged cards). See Motion.

### Per-control accent

`--accent` is set per instance. The 8 presets in the color well come from
Eido's card palette:

`#222222 #d66be8 #a946c8 #b8552f #48a2ef #eca23b #24986a #f1666d`
(default `#a946c8`)

Cobalt `#3f78df` is **reserved for the step class** (grammar R5.2) and is
not a swatch: a unique hue means one part the user named; the shared
cobalt + square mark means the work chain. Hosts assign new-part accents
**least-used-first** so repeats never read as false relationships.

Tints are always derived, never hand-picked, and the derivations are
declared **at instance scope** (`.mui-control`, `.mui-popup`, `.mui-node`,
`.mui-chip-value`, `.mui-card`) — never on `:root`, where they would
freeze against the default accent (a custom property resolves its `var()`s
where it is declared):

- `--accent-tint`: `color-mix(in srgb, var(--accent) 30%, var(--mui-track))` — slider fill
- `--accent-wash`: `color-mix(in srgb, var(--accent) 12%, var(--mui-panel))` — silent cards, soft washes

Text on solid accent is chosen by luminance: `ModUI.inkFor(hex)` returns
ink (`#232019`) on light accents and paper (`#f8f6f1`) on dark ones
(YIQ brightness, threshold 0.55).

### Type

All UI text is mono: **JetBrains Mono** (400/500/700), embedded as base64
data URIs in `mod-ui-font.css` with `font-display: block`, so pages work
over file:// with no network and no installed fonts; the system mono
stack (`ui-monospace, "SF Mono", Menlo, Consolas, monospace`) is the
fallback. JBM runs wider than SF Mono, so caps tracking is one step
tighter than the SF-Mono-era values. The grotesque
(`"Helvetica Neue", Helvetica, Arial`) exists only for poster-scale gallery
chrome, never inside components.

| Token | Value | Use |
| --- | --- | --- |
| `--mui-fs-label` | 10px, caps, ls 0.09em (`--mui-ls`) | control labels, buttons |
| `--mui-fs-value` | 11px, tabular | readouts, pill values |
| `--mui-fs-micro` | 9px, caps, ls 0.09–0.14em (`--mui-ls-wide`) | chips, popup field labels, card eyebrows |
| card sentence | 13px, sentence case | the one place mono speaks at reading size |

No control-kind sub-labels anywhere — a dial never says "DIAL".

### Radii — the two-tier rule

**Surfaces are slightly-squared; instruments are round.** Anything that is
chrome (a card, a panel, a button, a popup, a board well) takes a small
radius from the scale below. Anything that is instrument anatomy — tracks,
handles, jacks, detent dots, swatches, knob cores — is a full capsule or
circle (`999px` / `50%`), because roundness there is the physics of the
control, not decoration.

| Token | Value | Use |
| --- | --- | --- |
| `--mui-r-card` | 7px | control chips, cards |
| `--mui-r-chip` | 6px | buttons, input fields, small tiles |
| `--mui-r-pop` | 8px | popups, floating palettes |
| `--mui-r-well` | 10px | board wells / large containers |
| capsule / circle | 999px / 50% | tracks, handles, pills, jacks, dots, swatches |

### Rhythm

| Token | Value |
| --- | --- |
| `--mui-cell` / `--mui-gap` | 64px / 8px → 72px board pitch |
| spacing scale | 4 / 8 / 12 / 16 / 24 / 32 |

## Motion — tactile weight

The aesthetic is a physical instrument: things get **picked up, displace
their neighbors, and settle with weight**. Nothing fades vaguely; things
move because a hand moved them.

| Token | Value | Use |
| --- | --- | --- |
| `--mui-t-fast` | 120ms | hover, press, reveal |
| `--mui-t-move` | 220ms | displacement, settle, swap |
| `--mui-ease-out` | `cubic-bezier(.25,.6,.25,1)` | standard decel |
| `--mui-ease-settle` | `cubic-bezier(.2,.75,.25,1.08)` | drops/landings — slight overshoot |
| `--mui-scale-press` | .97 | pressed elements |
| `--mui-scale-lift` | 1.02 | lifted/dragged elements |
| `--mui-shadow-lift` | soft double shadow | **the one sanctioned shadow** — worn only while lifted/floating |

Rules:

- Pressed things scale to `--mui-scale-press` (`.mui-btn:active`,
  `.mui-pressable:active`).
- Lifted things (`.mui-lifted`) scale to `--mui-scale-lift` and wear
  `--mui-shadow-lift`. On release they settle with `--mui-ease-settle`.
- **FLIP is the sanctioned technique** for list/grid displacement: measure,
  reorder DOM, invert with a transform, play to identity over
  `--mui-t-move` with `--mui-ease-settle`. The lib ships the vocabulary
  (tokens + classes); consumers (the workbench compiler drag) ship the
  drag code.
- `prefers-reduced-motion: reduce` kills all transform motion and keeps
  opacity changes. It also freezes the visualizer clock `t` and cuts the
  pad's drag trail (never spawned).
- **Idle motion is a slot** — see the motion charter in the visualizer
  contract: a visualizer may animate at rest only if a wired input owns
  that motion; unowned shimmer is banned.

## Layout & alignment rules

- **Grid rhythm**: everything sits on the 72px pitch (64px cell + 8px gap).
  A control's footprint is cells; components adapt to whatever box they get
  (ResizeObserver → size classes `sz-xs/sm/md/lg`).
- **Min footprint (SPEC 03)**: some kinds refuse sizes — refusing a size is
  more honest than shipping a bad one. Pad 2×2, curve 4×2, filter 2×1;
  SPEC 04: order 2×2, mixer 2×2, select 2×1 segmented / 2×2 stack;
  SPEC 05: fork 3×2, revise 2×1, step 3×2;
  everything else 1×1. The control reports its floor as `c.minCells`
  (`{w, h}` in cells); **boards enforce it** (palette drop + resize).
- **Anatomy order is fixed**: label (top, left-aligned) → instrument
  (centered in remaining space) → readout (bottom, centered; slider: inline
  right). Every control reads the same way, so dense boards stay scannable.
- **Label visibility**: labels show from `sm` up. At `xs` the label is
  removed and moves to a hover chip above the control reading
  `LABEL · value`.
- **Named-stop fallback (SPEC 03; extended to dial/slider by the SPEC 04
  rider)** — the label-collapse pattern applied to values: a readout
  speaks its named stops only while the named form fits its row. When it
  would overflow, the readout falls back to the numeric form (`≤ 100`,
  `50%`), the control is marked `is-abbrev`, and the full named value
  moves to the hover chip (`LABEL · ≤ A FULL REPORT`) — shown on hover at
  any size, like the `xs` label chip. CSS ellipsis on the readout is the
  final guard. Re-fit runs on every value change and every resize; a
  readout never overflows its chip. Fit is measured per kind: dial
  against its full readout row, slider/range against the row minus the
  track's 40px minimum, filter against mode chip + gap (with the
  chip-hides third tier).
- **The named-stops rider (SPEC 04)** — when a dial/slider has steps, the
  config may name each of the steps+1 stops (the same comma field range
  and filter use). The readout and the spoken value use the stop name
  when the value sits on a stop, numeric otherwise, with the fallback
  rule above. **This dissolves the old catalog's Blend control**: a
  2-stop slider with end-named stops IS a blend — one kind fewer.
- **Optical centering**: the dial's 270° arc opens downward, so the knob
  sits a hair high in its box and the % readout fills the gap.
- **The node overhang**: the output jack straddles the right border
  (8px outside). This is the one sanctioned overflow; hidden chips are
  `display:none` so they never create layout overflow.
- **One accent per control; one red per screen.** Yellow only as a rare
  state mark.

## Progressive disclosure — no instructions, ever

No surface carries instructional copy. Affordances are discovered by:

1. **Hover reveal** — chrome appears when the pointer arrives, at
   `--mui-t-fast`.
2. **Cursor semantics** — `ew-resize`/`ns-resize` on tracks and knobs,
   `crosshair` on jacks, `pointer` on buttons.
3. **Consistent placement** — identity/color lives **top-left** (always
   visible); actions live **top-right** (hover-revealed); value lives at
   the bottom. Learn it once, know it everywhere.
4. **Growth affordances are ghosts of the thing they create** — an
   "add section" affordance is a ghost column (dashed hairline, wash
   fill), not a labeled pill. The shape teaches the outcome.

## Identity and chrome on a control (standard)

**Identity is persistent; actions are hover-revealed.**

- **Top-left — the accent dot (identity, always visible).** A small SOLID
  circle (~10px) filled with the control's accent, like an Eido card's
  identity color. It is not chrome: it never hides, and the label sits
  permanently to its right — the space is reserved in layout, nothing
  slides on hover. **Alignment is structural:** the dot and the title are
  flex siblings in one head row (`.mui-head`, `align-items: center`), so
  their vertical centers are the same line by construction — never tuned
  with absolute offsets, so font or size changes cannot re-break it.
  Clicking the dot opens the **compact color well** — the 8 swatches and
  nothing else. Its hover affordance is a slight scale/brighten only. At
  `xs` the head collapses to just the dot (~7px), pinned in the corner —
  it may be the only identity visible.
- **Top-right — actions (chrome, appear on hover):** the "sliders"
  settings glyph (two lines with offset knobs, inline SVG) opening the
  config popup — title, description, steps, **no color row**; and beside
  it a remove **×**, drawn only when the host passes `onRemove` (the lib
  draws it, the host owns the semantics).

Neither corner may collide with the % readout (identity and actions live
in the top corners; value lives at the bottom).

## Text fields — state changes color, never geometry

One field style, `.mui-field-input`, is shared by the words control, the
popup title input, and the popup textarea. A field is a surface, not an
instrument, so it takes the chip radius (6px) — **no capsules**. Quiet
hairline border at rest; accent border on focus; `outline: none` wherever
the style applies (instruments keep their offset focus ring; fields never
get one — their focus IS the border). Background may shift (field →
raised).

**Rule: focus/selection may change color and border, never shape or
size.** Same box, same radius, same dimensions in every state. The
workbench's edit-in-place cites this rule.

## The button standard

Every clickable in the system is either a `.mui-btn` or an explicitly
defined quiet text affordance (specimen tags, ghost growth affordances).
Nothing else is clickable. A `.mui-btn` is:

- rounded-rect `--mui-r-chip` (6px), 1px ink border, transparent body
- mono caps `--mui-fs-label`, ink text
- quiet hover: neutral ink wash fill; press: `--mui-scale-press`
- variants: `.mui-btn--primary` (ink-filled, paper text),
  `.mui-btn--icon` (square, glyph only), `.mui-btn--sm` (22px)
- **glyph optical weight**: icon glyphs are drawn smaller and lighter
  than their button box so sibling buttons read as equals — the control
  chrome's sliders glyph is ~11px at a 1.1 stroke next to the ×, both in
  the same 19px hit target. Match weight by eye, not by box size.

## Component anatomy (in words)

- **Dial** — 270° faint track arc, gap at the bottom; accent value arc over
  it (round caps, `d` computed exactly per render, hidden at 0%); solid ink
  core; light needle; mono % below. Stepped → ticks outside the arc.
  Vertical drag (100% ≈ 150px, shift = fine), arrow keys step.
- **Slider** — recessed capsule track; accent-tint fill running as **one
  continuous body** from the track's left cap to the **handle center**:
  left end rounded by the capsule, **right edge flat, tucked under the
  handle** — never a detached lozenge. Round ink handle (accent while
  dragging); detent dots visible through the fill when stepped; mono % at
  right.
- **Switch** — small capsule; ink handle on track when off; accent track
  with paper handle when on. Value 0/100.
- **Count** — capsule with − / mono integer / +.
- **Words** — one-line mono text in a quiet 6px field (`.mui-field-input`);
  accent caret and border on focus, geometry unchanged.
- **Pad** (SPEC 03) — two sliders fused into one gesture. Recessed
  dot-grid well (ref 12 in instrument-flat), two crosshair hairlines
  tracking the handle (the pad's picture of its own value), round ink
  handle (accent while dragging). While dragging, a short ink trail (3–4
  ghost dots, gone in `--mui-t-move`; never spawned under reduced
  motion). ONE identity, ONE accent; the axes are **sublabels** — they
  live in the jack hover chips, the axis-end names, and the card
  eyebrows. Axis-end names (creator-authored, e.g. COOL/WARM) are micro
  caps in `--mui-ink-faint`, X ends on the bottom edge, Y ends on the
  left edge, horizontal text, never rotated; they show at `lg` only. No
  quadrant labels. Stepped axes draw the snap grid as slightly larger,
  darker dots REPLACING texture dots — one dot field, two weights.
  Readout `62 · 38`; at `sm` (the 2×2 minimum) the readout drops and the
  hover chip carries `LABEL · x·y`. TWO scalar jacks on the right edge:
  Y at the well's top-right, X at vertical center. Value `{x, y}`.
  Emits two sentences / two cards (eyebrows `TITLE · AXIS`). Config:
  shared title + description, then two axis blocks (axis title, low/high
  end names, steps OFF/2–10 each). Arrows move X, up/down move Y.
- **Range** (SPEC 03) — a range **constrains, it does not set**. The
  slider's capsule track with TWO round ink handles and an accent-tint
  band between them: one continuous body, FLAT at both ends, each end
  tucked under its handle center (the slider-fill rule extended to two
  ends). Detent dots show through the band when stepped. **Band-drag
  slides the whole window, width preserved** — handles `ew-resize`, band
  grabs. Readout `30–70` (en-dash, no spaces), or the named stops when
  defined (`A SENTENCE–A PARAGRAPH`; numeric fallback when the row would
  overflow — see the named-stop fallback rule). Value
  `{lo, hi, mode:'between'}`.
  Span jack. Emits ONE constraint sentence; default-addresses the
  Boundaries-like section (workbench routing).
- **Filter** (SPEC 03) — the hero-face sibling of range, same value
  shape `{lo, hi, mode}`. The face IS the constraint drawn in ink: a 2px
  ink roll-off curve over the dot-grid well, `--accent-wash` under the
  pass region. Three modes in plain words — the audio metaphor lives
  only in the drawing, never "low-pass": NO MORE THAN `[0,hi]` /
  AT LEAST `[lo,100]` / BETWEEN `[lo,hi]`. Drag the roll-off edges
  horizontally; in BETWEEN, drag the plateau to slide the window (width
  preserved). The mode chip (micro caps, foot-left, a sanctioned quiet
  text affordance) cycles on click; mode also lives in config. Named
  stops speak: `≤ A PARAGRAPH` — with the numeric fallback when the foot
  row would overflow (see the named-stop fallback rule). Min 2×1,
  ideal 2×2.
- **Curve** (SPEC 03) — the series control: the slider's anatomy bent
  into 2D. Recessed well, 2.4px accent line, round ink point handles
  (accent while dragging). Click empty face = add point; drag point =
  move (endpoints y-only); double-press a point = delete (endpoints
  refuse; 2 points is the floor; 5 the cap). **X snaps to the five
  speakable detents** — start / quarter / midway / three-quarters / end,
  drawn as dot detents in the well; shift-drag places freely. Y inherits
  the steps config (the popup labels it "Y steps"). Readout: point count
  plus the active/hovered point in detent words — `3 PT · MID 90`.
  Series **output** jack. Config: title, description, timebase
  dropdown ("the answer" / "the steps of the task" / "each item in the
  list"), y-steps. Horizontal drag on empty face = the scrub gesture
  (reported via `onScrub(t)`, `onScrub(null)` on release).
  **SPEC 05** adds three things: (1) the **POSITION input jack** —
  `setInput('position', v|null)` draws the wired position as a vertical
  accent hairline + a sample dot where it crosses the curve, and
  `position()` / `sampleAt(t)` feed the emission; unwired behaves as
  before (see the control-input jack). (2) **renamable x-detents** —
  `xdetents` names the five detents in the creator's stage words; the
  names spread evenly across the fixed detents (3 names → start / midway
  / end, e.g. "exploring / organising / committing"), the readout speaks
  them (`3 PT · ORGANISING 90`), and the named-stop fallback demotes a
  too-long name to the default token + hover chip. (3) an opt-in
  **fidelity foot chip** (`fidelity: true|'auto'|…`), chip left / readout
  right in a foot row.
- **Select** (SPEC 04) — one-of-N, **nominal**. 2–4 options: a segmented
  capsule track, cells split by hairlines, the picked cell wearing solid
  accent with `inkFor()` text — the pick is shown by fill, never by a
  floating indicator. 5–7 options: a vertical stack of quiet capsule
  rows, picked row accent-filled (the face auto-switches on the count).
  Pick on pointerdown, drag-across on the capsule, arrow keys cycle.
  Value = the picked option index. Options are creator-authored (comma
  list, 2–7) and each option carries its own frame — one quiet field per
  option in config. **No output jack** (see "Jackless by design").
  No readout row (the face is the readout); hover chip `LABEL · OPTION`.
  Min 2×1 segmented / 2×2 stack (reported per instance via `minCells`).
- **Order** (SPEC 04) — drag-to-rank, **the motion charter's showcase**.
  Capsule tokens in a recessed well; faint rank numerals live in a fixed
  slot column (slots stay put, tokens move); rank-1 alone wears solid
  accent — the podium is in the ink. Drag a token: it lifts
  (`--mui-scale-lift` + the one sanctioned shadow), passed siblings
  FLIP-displace at `--mui-t-move`/`ease-settle`, release settles with
  weight (measure → commit → invert → play). Reduced motion: reorder
  snaps, no lift transforms. Keyboard: up/down selects, shift+up/down
  moves. Items creator-authored (comma list, 2–7); editing the list
  resets to the authored order. Value = the permutation (array of
  authored item indices). ONE scalar jack whose value is
  **displacement** — normalized Kendall-tau distance from the authored
  order (0 untouched, 100 fully reversed), exposed as
  `c.displacement()`; hover chip `LABEL · SHUFFLE 33`. Readout speaks
  the sequence: `CLARITY › DEPTH › BREVITY`. Min 2×2; numerals drop
  first under `sm`.
- **Mixer** (SPEC 04) — share-of-whole; **the sum invariant is control
  state**. N slim vertical faders (2–6 creator-authored channels) in one
  face: the slider's anatomy rotated and multiplied — recessed capsule
  tracks, accent-tint fill from the bottom cap to the handle center
  (flat top, tucked under the handle), round ink handle (accent while
  dragging). Dragging one fader takes the value and the others yield
  proportionally in the same frame; a channel at exactly 0 stays 0
  through others' rebalances (a silenced channel is a decision). Steps
  quantize shares with largest-remainder re-rounding, so the sum stays
  exactly 100. Keyboard: left/right selects a channel, up/down adjusts.
  Value = `{channel: share}` summing to 100. One scalar jack per
  channel (the variable multi-jack), evenly spaced on the right edge,
  hover-chipping its channel name; jacks follow config edits. Channel
  sublabels micro caps beneath, never rotated; share readout
  `50 · 30 · 20` drops under `sm` (hover chip `LABEL · 50·30·20`).
  One accent for all fills — channel identity is the sublabel;
  downstream, BANDINGS differentiates by rank-derived shades. Min 2×2.
- **Fork** (SPEC 05) — compiled routing; **the model decides its process
  at run time** (select routes the *board*, at set time; FORK routes the
  *model*, at run time — different layer, replaces neither). Face: an ink
  **junction** — one line entering left, fanning to 2–3 path lines right,
  path names in micro caps at the ends, a round ink **LEAN** handle on a
  short arc across the fan. The favored path draws at full ink weight,
  the others faint — the control pictures its own value. Value = the
  **lean** scalar (what to do when it's a coin flip); with 2 paths, dead
  center (lean 50) favors neither and the readout drops to `EVEN`; with
  3, center favors the unsure middle (the pressure valve). Drag the
  handle along the arc; arrow keys nudge. Readout `LEANS · LOOK IT UP`.
  ONE scalar **output** jack. Config = the **check block** (below). Min
  3×2. Emission is workbench-side (`favored()` exposes the leaned index).
- **Revise** (SPEC 05) — compiled feedback, small. Face: a count capsule
  (`− n +`) with **n small nested arcs above it** — the value's own
  picture. Passes 0–3; **0 = silent** (OFF, no arcs — the engine silence
  rule). **No threshold/score numbers on the face** — a score is a lie in
  one call; only passes are honest. Value = the passes scalar; ONE scalar
  jack. Config = the check block: metric prose (look-at), strictness
  (`LIGHT TOUCH / THOROUGH`, a foot chip mirrored in config), and a
  fix-vs-start-over toggle. Min 2×1 — at that minimum the head collapses
  to the corner-dot treatment so arcs / capsule / strictness chip clear
  one another (label → hover chip). Emission is workbench-side.
- **RUNS chip** (SPEC 05, journey §4) — the reusable foot chip that
  says how a part runs: `ONE CALL · STAGED · AUTO`, cycling on click
  (the filter mode-chip pattern), default AUTO. In settings the same
  state reads AUTO / ALWAYS IN THE ONE CALL / ALWAYS ITS OWN STAGE.
  Opt in per control with `fidelity: true` (curve / fork carry it;
  steps carry it; **plain shapers never do** — a shaper has no second
  form). It is mirrored in config and exposed as `c.fidelity()` (the
  internal key keeps its name; only faces changed words).
  `ModUI.fidelityChip({value, onChange})` is the freestanding version
  for the step shell and any workbench body. The **mod-level WHEN IT
  RUNS lever** (`ONE CALL ⟷ STAGED`) that resolves every AUTO is
  workbench-side, not a lib surface.
- **Step shell** (SPEC 05) — the transformer's board body, the **third
  and last UI class** (control / visualizer / step). A verb-module
  (EXPLORE, CLUSTER, CRITIQUE, …) that takes work in and puts transformed
  work out: it is not a control (its output is a work-product, not a
  sentence, and it holds no shaper value) and not a visualizer (it acts).
  Anatomy: panel chip, **verb** as the label + a square identity dot,
  the creator's instruction **prose** as the body, **artifact-in ▣** on
  the left / **artifact-out ▣** on the right (the second cable family),
  **signal inputs** (ordinary scalar jacks) below artifact-in as
  modulation, and the fidelity foot chip. `ModUI.stepShell({verb, prose,
  signals, fidelity, …})` ships the anatomy; the **verb registry, the
  per-verb signals, and the artifact contents are engine-surface /
  workbench-owned** (see the in-lib-vs-workbench note under the check
  block). Min 3×2.
- **The check block** (SPEC 05, shared config anatomy) — controllers all
  say the same sentence: *watch something, and when it crosses a line,
  act.* One config anatomy serves both faces (the words "classifier",
  "evaluator", "threshold", "signal" never appear):

  | Field | Config label | e.g. |
  | --- | --- | --- |
  | watch | "look at" | "whether this needs looking things up" |
  | bands | (paths / verdicts) | 2–3 named outcomes |
  | act | "then" | a path's prose / revise / redo / stop |
  | limit | "at most" | passes budget |

  FORK's config is look-at + 2–3 **path blocks** (the pad's axis-block
  pattern: a name + its "then" prose each, a 2–3 stepper). REVISE's is
  the metric (look-at) + strictness + fix-vs-start-over. Bands/scores and
  the loop guard are engine-surface — a threshold face becomes honest
  only there.
- **Output node** — hollow ink-ringed dot astride the right edge; hover →
  accent fill + ink label chip; connected → filled. Exposed as `c.node`
  (all jacks on `c.nodes`), free of library pointer handlers.
  `ModUI.nodeDot({label, accent, chipSide, type, dir})` is the
  freestanding version. Glyph per payload type — see the jack glyph
  language. **Input nodes** (`dir: 'in'`) straddle the left edge with the
  inward chevron; **artifact nodes** (`type: 'artifact'`) are the square
  port. Curve input jacks live on `c.inputs` (e.g. `{position}`).
- **Config popup** — title input, description textarea, steps stepper
  (OFF, 2…10 — dial/slider/range/filter/mixer, and the curve's y).
  Range/filter (always) and stepped dial/slider (the rider) add a
  stop-names field (comma-separated; spoken when the count matches
  steps+1); filter adds the mode chips; curve adds the timebase
  dropdown; pad swaps the single stepper for two axis blocks; select
  adds the options list + one frame field per option; order adds the
  items list; mixer adds the channels list (jacks follow); the curve
  adds a **detent-names** field; **fork** adds the check block (look-at +
  2–3 path blocks via a Paths stepper); **revise** adds the check block
  (metric + strictness + fix/start-over); parts that carry fidelity add
  a **fidelity** row mirroring the foot chip.
  Live-applies, positions adjacent, dismisses on outside pointerdown,
  one popup at a time (the color well counts — opening either closes
  the other).
- **Color well** — the compact 8-swatch palette popup opened from the
  accent dot. Swatch = circle; active swatch wears an ink ring.
- **Chips** — the four-kind taxonomy (grammar R2). One rule: **a
  pressable chip is a raised KEY — solid fill, hard under-edge shadow,
  hover lift, press-down travel; a readout is a flat capsule.** (The
  border-only treatment failed two fresh-eyes reviews.) `.mui-chip-toggle`
  (raised key, ink border, active = ink fill), nav chips (borderless
  caps text + hover underline, host-styled), `.mui-chip-value` (capsule,
  wash fill, no border), `.mui-chip-state` (capsule, hairline, shown
  ONLY while non-nominal: OFF / UNWIRED / CONFLICT / NEEDS <X>; `.is-alert`
  adds the yellow-dot prefix), `.mui-chip-feedback` (capsule, solid ink,
  anchored at the thing that changed, ~2.4s life).
  `.mui-pill-readout` is retired (zero consumers).

## Card (`.mui-card`)

The compiler's prompt lines are **solid accent cards** — bold, like mobile
task-card UIs. Anatomy, top to bottom:

1. **Eyebrow row** — the control's title, micro caps, tracking-wide; on
   the right a **miniature value pill** (`.mui-card-pill`, e.g. "72%") in
   a translucent counter-color.
2. **Sentence** — the primary text, 13px mono, the biggest thing on the
   card.
3. **Meta line** (optional) — quiet description at micro size, ~70%
   opacity.

Ground: solid `--accent`; text color from `ModUI.inkFor(accent)` — ink on
light accents, paper on dark ones. Radius `--mui-r-card`. **Silent
variant** (`.mui-card--silent`): the accent wash instead of full accent,
ink text, for muted/inactive lines. Cards are the primary consumers of the
motion language: they lift, displace, and settle.

## The visualizer contract (SPEC 03, lib-owned)

A visualizer is a **lens, not a control**. The lib standardizes eight
clauses; the drawing inside the well, the gesture personalities, and
each viz's derived-value semantics stay bespoke.

1. **The viz shell** (`ModUI.vizShell`). Panel chip; head bar with the
   micro-caps title left and hover-revealed chrome right (optional
   `−`/`+`, then `×`); body; optional recessed well (opt-out — a matrix
   or readout is chrome-bodied); per-kind min size in cells.
   **A visualizer has NO identity dot and no accent of its own — every
   hue on it is inherited through wires.** That is the visual grammar
   that says "lens, not control" at a glance.
2. **The slot.** One record: `{name, get, set?, rest, accent,
   labelMode?, type?}`. `rest` is the unwired value; unwired slots render
   **faint ink, never accent**. `set` present ⇒ two-way capable; absent ⇒
   the lib never lets a gesture write. A slot is unwired when `get()`
   returns null. `name`/`accent` may be functions (inheriting modes
   re-read them on `rail.update()`).
3. **Three sanctioned slot modes**, declared per rail:
   `fixed-labeled` (wave — permanent micro label, fixed count),
   `variable-inheriting` (radar — `+`/`−` head chrome, name = wired
   control's title, min count, "− removes last-unwired-first"),
   `fixed-inheriting` (beam / readout — fixed count, inherited names).
4. **The input rail** (`ModUI.rail({edge, mode, min, slots})`). The
   input dot column generalized to three edges — `left`, `top`, `right` —
   with straddling dots (8px outside, mirroring the output-jack
   overhang), hover label chips (below the dot on top rails), and a
   per-slot `×` on hover in variable mode. Matrix consumes left + top;
   beam consumes left + right. One primitive, three edges.
5. **Growth chrome, two grammars.** `+`/`−` head buttons for one-axis
   growth; a **ghost row/column** (dashed hairline, wash fill — the
   ghost-growth rule) for two-axis growth. Never both on one viz.
6. **Write-back.** All writes go `slot.set` → `control.set()` — the
   control's value is the ONLY state, never mirrored. `ModUI.quantize(v,
   {kind, steps})` is the shared quantizer: count → integers, stepped →
   steps, switch → threshold; **words returns null — refuse that wire at
   CONNECT time**, never mid-gesture. During a viz gesture the wired
   control visibly moves (one state, many handles).
7. **The motion charter.** `draw(state, t)` is pure; one shared rAF
   clock feeds `t`; `prefers-reduced-motion` freezes `t` and kills
   transforms. **Idle motion must be owned by a wired slot** (the wave's
   SPEED, the constellation's DRIFT) — unowned shimmer is decoration and
   is banned. Change-transitions on the lib's motion tokens
   (`--mui-t-move`, `--mui-ease-settle`) are always honest — they depict
   the hand that moved the value.
8. **The question line.** Every visualizer declares its one-line
   semantic job (`question`, surfaced as the palette tooltip). No two
   visualizers answer the same question.

## Rejected / deferred (round 4 register)

**REJECTED — do not build:**

- Range dial (two handles on a 270° arc drag terribly; the range slider
  covers the semantics at every size).
- In-line cable processors (a third part class; makes cable topology
  semantic; shows one value, speaks another).
- Pair-valued `(x,y)` cables (two named jacks decompose it; no input
  could consume a pair).
- Joint two-slot pad frames (silence semantics undesigned; per-axis
  default reads well).
- Playhead object / transport UI (promises a runtime the medium doesn't
  have; scrub-as-gesture + the ambient clock give every preview benefit).
- Per-point compiler cards (breaks one-card-per-control; points aren't
  independently addressable).
- Separate envelope / LFO / sequencer kinds (all one curve with configs).
- Filter AVOID/notch mode (a semantic corner case; three modes cover it).

**DEFERRED to v2 — designed, not built:**

- `bound` wire — a range's jack wired to another control paints the
  permitted band on that control's track; it NEVER clamps or moves the
  target's value. Two honest sentences, zero hidden math.
- Curve GAIN input jack — one scalar input scaling all v; the face draws
  the authored curve as a ghost line and the effective curve solid;
  emission speaks the effective values.
- Per-segment curvature (stored as tension −100..100, spoken only
  coarsely: "build quickly, then level off").
- Creator-renamable x-detents (the task timebase's stage names).
- Conversation timebase (needs persistent-mod runtime; the series model
  already carries the data).
- Composite-voice wire.

## Rejected / deferred (round 5 register)

**REJECTED — do not build:**

- Order-native visualizers (SEQUENCE / arpeggiator preview / PODIUM /
  bump chart / Sankey / consensus ring) — a single order's best picture
  is ORDER's own face; every relational order-lens dies on
  cross-control item identity (the board has no shared name space).
- Donut / proportion visualizer — BANDINGS' question verbatim; the
  honest composition is MIXER wired into BANDINGS (normalization
  becomes the identity function).
- Per-item rank jacks on ORDER — rank-as-magnitude lies in every weight
  lens; variable multi-jack is earned only where values ARE magnitudes.
- Symbol payload (select's option as a cable) — nominal→scalar has no
  honest coercion cell; jackless SELECT is the design statement.
- Dice / surprise control — breaks determinism as a control; a reroll
  would be an Action, not a kind.
- Blend control — dissolved by the named-stops rider (a 2-stop slider
  with end names IS a blend).
- ORDER × MIXER fused mega-control — anti-Lego; compose ORDER + MIXER
  (+ group voice) instead.
- Two-way BANDINGS as the mixer — the sum invariant is state;
  visualizers hold no state (the crispest proof MIXER earns kindhood).
- Group jack / group-as-signal — a sentence is not a signal.
- Nested groups, viz-in-group — v2 questions at the earliest.
- STAGE as a new kind (SPEC 05) — it is the slider kind + named stops
  (which emits); ships as a preset configuration, not a component.
- Branch cards on FORK (SPEC 05) — one decide-scaffold card, never a card
  per branch: a branching one call does not have is a picture that lies.
- Score / threshold on the REVISE face (SPEC 05) — a 0–10 dial pictures a
  number that never exists in one call; only passes are honest on the
  face. The score is engine-surface (the judge loop).

**DEFERRED:**

- `order` cable payload (a fourth shape: a permutation of named items;
  glyph: three stacked dashes of decreasing length in the ring; coerces
  to value slots via its displacement scalar). Build the moment a
  native consumer exists — none does.
- ORDER → renamable-x-detents feed (an order of stages naming a curve's
  detent columns) — a wiring-round question; recorded so neither piece
  is designed into a corner.
- **Curve GAIN input jack** (SPEC 05) — the second control-input opening;
  one scalar scaling all v, face drawing authored ghost + effective solid.
  Deliberately held: POSITION opened the seam once this round, GAIN waits.
- Per-segment curvature (carried from round 4).
- Growing ORDER (user-added items) — belongs with a growing-list kind
  and the addRows permission.
- **Per-path gate jacks on FORK** (SPEC 05) — a path speaking only on its
  branch ("cite sources" on LOOK IT UP) makes cable topology semantic
  (the rejected in-line-processor smell) and needs gate-wire UI the
  workbench lacks. V2.
- **Artifact contents / the run plan** (SPEC 05) — the executing chain,
  decision points, judge loops, artifact payloads, provenance, and
  intervention are **engine-surface**. The prototype simulates THE PLAN
  (a pure function of board state) and never fabricates runtime results.
  The mod-level WHEN IT RUNS lever (`ONE CALL ⟷ STAGED`) and THE RUN
  footer are workbench surfaces, not lib components.

## Public API

```js
const c = ModUI.control({
  kind: 'dial'|'slider'|'switch'|'count'|'words'
      | 'pad'|'range'|'filter'|'curve'
      | 'select'|'order'|'mixer'
      | 'fork'|'revise',       // SPEC 05 process kinds
  label, value, accent, steps, desc,
  stops,                   // range/filter + stepped dial/slider (the rider):
                           //   names for the steps+1 detents
  axes,                    // pad: {x:{label,low,high,steps}, y:{…}}
  timebase,                // curve: 'answer'|'task'|'list'
  xdetents,                // curve: up to 5 detent names (spread over the 5)
  fidelity,                // curve/fork: true|'one-pass'|'in-stages'|'auto'
  options, frames,         // select: 2–7 names + per-option frames
  items,                   // order: 2–7 names (the authored order)
  channels,                // mixer: 2–6 names (one jack each)
  lookAt, paths,           // fork: the check block — question + [{name,prose}]
  metric, strict, redo,    // revise: metric prose + 'light'|'thorough' + 'fix'|'restart'
  onChange(value, {kind,label,steps,accent}),
  onConfig(cfg),           // cfg mirrors config() below
  onScrub(tOrNull),        // curve only: the scrub gesture, board-owned "now"
  onRemove(api)            // optional; presence shows the × affordance
});
c.el  c.node  c.nodes      // named jacks: {out}, pad {x,y}, mixer per channel;
                           //   select: node === null, nodes === {} (jackless)
c.inputs                   // input jacks: curve {position}; {} otherwise
c.kind  c.minCells         // {w, h} in cells — boards enforce
c.get()  c.set(v)          // value shapes: number · {x,y} · {lo,hi,mode} ·
                           //   [{t,v}] · index · [perm] · {channel: share} ·
                           //   fork: lean number · revise: passes 0–3
c.displacement()           // order only: 0–100, the jack's scalar
c.setInput(name, v|null)   // curve: 'position' — draws hairline, samples emission
c.position()  c.sampleAt(t)// curve: the wired position + the series sample
c.favored()                // fork: the leaned path index (−1 = even)
c.fidelity()               // where fidelity is enabled: the resolution word
c.openConfig()  c.openColors()  c.closeConfig()
c.setConnected(bool, jack?)  c.config()

ModUI.card({title, value, sentence, meta, accent, silent})
  // → {el, setValue(text), setSentence(text)}
ModUI.vizShell({title, well:true, question, onAdd, onMinus, onRemove})
  // → {el, head, body, well, setTitle}
ModUI.rail({edge:'left'|'top'|'right', mode, min, slots, onChange})
  // → {el, addSlot(slot), removeSlot(), update(), slots()}
ModUI.fidelityChip({value, onChange})            // → {el, get(), set(v)}
ModUI.stepShell({verb, accent, prose, artifactIn, artifactOut,
                 signals:[{label,accent,type}], fidelity, onFidelity,
                 onRemove, question})
  // → {el, node (artifact out), inNode (artifact in), signals:[dots],
  //    minCells, setProse, setVerb, fidelity}
ModUI.quantize(v, {kind, steps})   // → number | null (words: refuse at connect)
ModUI.inkFor(hex)          // → '#232019' | '#f8f6f1'
ModUI.nodeDot({label, accent, chipSide, type, dir})   // + el.setType(t)
  //   type: 'scalar'|'span'|'series'|'artifact'  ·  dir: 'in'|'out'
ModUI.closeConfig()   ModUI.PRESETS   ModUI.DEFAULT_ACCENT
```
