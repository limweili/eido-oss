# Mod workbench — visualizer set, second pass (DAW / synth-modulator mining)

Design exploration, 2026-07-16. Concept only — no implementation.
Builds on: `explore-visualizers.md` (first pass — its 9 + rules are law),
`explore-branching.md` (BRANCHES taken), `round4-synthesis.md` (D1 signal
model, D4 contract, D5 build list), `lib/DESIGN.md` (SPEC 03),
ref `13-ableton-m4l-device-collage.png`.

Mandate: mine digital audio workstations and digital synth modulators
specifically, and exhaust the space. This pass considered **26 candidates**.
**3 survive.** The rejection register is §4.

---

## 0 · The gap the first pass left open

The first-pass 9 + BRANCHES consume **scalar slots only**. Meanwhile D1
shipped a three-shape signal model — scalar / span `[lo,hi]` / series
`[(t,v)]` — with a total coercion matrix, and D2 shipped controls that *emit*
spans (range, filter) and series (curve). Today those payloads have exactly
one visual home each: the emitting control's own face. Nothing on the board
can show **two spans against each other** or **two series against each
other**. That relational read is precisely what DAWs are for — arrangement
views, gain-staging chains, composite EQ curves. So the hunting question for
every candidate below was not "what does a DAW show?" but:

> **What relational question about spans and series does no control face and
> no first-pass viz answer?**

Three questions survived: *what happens when* (SCORE), *what's still
allowed* (WINDOW), *what will actually be said* (STEPS).

---

## 1 · Candidate sweep — 26 evaluated

Every candidate got the TAKEN-BY test (does a first-pass viz or a control
face already answer its question?), an input-contract sanity check against
D1's payload shapes, and the determinism test (control state only — no
history, no runtime, no latent space).

| # | DAW/synth source | One-line question it would answer | Verdict |
| --- | --- | --- | --- |
| 1 | Automation-lane stack / arrangement view | What happens *when* — how do the time-shaped qualities align over the answer? | **RECOMMEND → SCORE** |
| 2 | Gate/compressor stack, composite dynamics chain | What's still *allowed* once every limit has spoken — and do the limits agree? | **RECOMMEND → WINDOW** |
| 3 | Step sequencer lane | What will the prompt actually *say* the shape is — the drawn curve in spoken notches? | **RECOMMEND → STEPS** |
| 4 | Spectrum analyzer | Ranked magnitude across qualities | REJECT — LEVELS in different ink; same question |
| 5 | Spectrogram (freq × time heat) | Qualities × timebase intensity | REJECT — SCORE's question in heatmap ink; no two viz share a question |
| 6 | Goniometer / vectorscope (Lissajous) | Joint trajectory of two qualities | REJECT — for scalars it's the pad's own face; for series it draws a path no sentence speaks; unactionable theater |
| 7 | Oscilloscope XY trails | Same as 6 | REJECT — same grounds |
| 8 | Compressor transfer curve (single in→out) | What gets through one constraint | REJECT — the filter control's face already IS the constraint drawn in ink; single-span lens duplicates a control face |
| 9 | Gain-reduction meter | How much a constraint is holding back | FOLD — survives as WINDOW's per-lane "bite" readout, not its own instrument |
| 10 | Mod-matrix send grid (per-cell amounts) | Source→target routing amounts | REJECT — per-cell-input matrix was already rejected round 4 ("a worse light grid"); MATRIX owns two-set influence |
| 11 | ADSR envelope display | The shape over time | REJECT — the curve control's face, verbatim |
| 12 | Arpeggiator / pattern preview | In what *order* things happen | REJECT — no payload carries order; would invent engine surface |
| 13 | Waveform view + loop markers | Which stretch of the answer is under focus | REJECT — reinterprets a value-space span as a time-window; a coercion lie (range/filter constrain *values*, not time) |
| 14 | Phase-correlation needle (−1..+1) | Agreement of two qualities | REJECT — BEAM's geometry (a−b on a needle) in lab clothes; set-agreement is CONSTELLATION's |
| 15 | Tuner (deviation from target) | How far from the preset / house style | REJECT — a board-wide target re-imports the rejected completeness capsule (reads every control, not a wired subset); a pairwise target is BEAM again |
| 16 | Clip-launcher grid | Which scene is armed | REJECT — no scene payload; preset land, not a lens |
| 17 | Crossfader | Which of two sides wins | REJECT — BEAM, horizontal |
| 18 | Wavetable-position display | Where a sweep sits among named shapes | REJECT — no shape-bank payload; named stops already speak in readouts |
| 19 | LFO shape picker | Pick a modulation shape | REJECT — that's a control, and the curve control is it |
| 20 | Stereo-width / mid-side meter | How tight a constraint is | REJECT — a span's width is its own control's readout (`30–70`) |
| 21 | Composite EQ curve (summed responses) | The one combined response | REJECT — summing implies additivity spans don't have; WINDOW's intersection is the honest composition |
| 22 | Sidechain-ducking view | One quality yielding to another over time | FOLD — SCORE's stacked lanes show the hand-off directly |
| 23 | Waveshaper transfer curve | Input→output mapping of a function | REJECT — reinterprets series-over-*time* as in→out map; axis lie |
| 24 | Analog VU needle | The headline number, with inertia | REJECT — READOUT in analog cosplay; a rendering, not a question |
| 25 | Peak-hold / RMS history, loudness histogram | Where values have *been* | REJECT — history is memory, not control state; determinism dies (LEVELS' 1.5s peak tick is the sanctioned maximum of this idea) |
| 26 | Mod-amount ring around a target knob (Ableton style) | How much modulation reaches a control | REJECT — owned by the deferred `bound` wire (v2 register); control-face territory, not a viz |

Also swept and dismissed without full rows: piano roll (no pitch/order
payload), sequencer probability lanes (no probability payload), master
sum-bus meter (an average is a derived READOUT with a weak theory),
send/return bus meters (MATRIX), groove/swing display (no timing runtime),
A/B compare (preset land), signal-flow diagram (the cables already are one).

### Why the space is now exhausted

Every remaining DAW/synth display fails for one of exactly three structural
reasons, and these are properties of the medium, not of imagination:

1. **Duplicate** — its question is already owned by a first-pass viz or by a
   control's own face (spectrum, ADSR, crossfader, VU, transfer curve…).
2. **No honest payload** — it needs a signal shape the model doesn't carry:
   order, pitch, probability, scenes, shape banks (arp, piano roll, clip
   grid, wavetable…). Building it means inventing engine surface, which is a
   controls/signal-model decision, not a visualizer.
3. **Needs a runtime** — it depicts *what happened*, and the medium has no
   transport, no history, no output signal (spectrogram-as-history, RMS
   meters, envelope followers, audio-rate anything). The board's ambient
   "now" is deliberately not a playhead (D1) and nothing may depend on it
   structurally.

A future signal-model expansion (an order payload, a composite-voice wire)
would reopen category 2 — until then, this register closes the space.

---

## 2 · The extended question table

| Visualizer | The question it answers | Way | Slots |
| --- | --- | --- | --- |
| *first-pass 9 + BRANCHES* | *(unchanged)* | | *scalar only* |
| **SCORE** | What happens *when*? — how the time-shaped qualities align, peak, and yield across the answer's arc | one-way | series (+ any, coerced) |
| **WINDOW** | What's still *allowed*? — the room left once every limit has spoken, and whether the limits agree | one-way | span (+ any, coerced) |
| **STEPS** | What will it *say*? — the drawn curve quantized to the spoken notches, sentence-true | one-way | series (1, fixed) |

Cross-checks: SCORE vs the curve face — the face shows *one* shape you drew;
SCORE shows several aligned (the relational read). WINDOW vs the filter face
— the face draws *one* constraint; WINDOW composes *all* of them. STEPS vs
the curve face — the face shows what you *drew*; STEPS shows what will be
*said*. STEPS vs LIGHT GRID — the grid's lanes are one control-value each in
notches; STEPS' columns are one series' spoken points. No collisions.

---

## 3 · Spec sheets

### 3.1 · SCORE — the arrangement view

```
SCORE                            + − ⚙ ×
      ┌─────┆───────┆───────┆───────┆─────┐
  ∿── │ WARM┆    ___┆___    ┆       ┆     │   ∿ series jack glyph
      │  ___┆___/   ┆   \___┆_______┆___  │   each lane = one wired
  ∿── │ DETL┆       ┆    ___┆___    ┆     │   control, stacked, one
      │  ___┆______/┆___/   ┆   \___┆___  │   shared timebase
  o── │ PACE┆═══════┆═══════┆═══════┆═══  │   scalar → flat rule
  ▭── │ LNGT┆▒▒▒▒▒▒▒┆▒▒▒▒▒▒▒┆▒▒▒▒▒▒▒┆▒▒▒  │   span → flat band
      └─────┆───────┆───────┆───────┆─────┘
       START    ¼      MID      ¾     END     ← detent hairlines ┆
```

**Semantic job.** *The arrangement.* Every curve control draws its own shape
alone; SCORE stacks the shaped qualities on one shared timebase so the
*relations* become the picture — warmth peaks at the middle exactly where
detail dips, pace holds flat throughout, length is a constant corridor. It
is the DAW arrangement view / automation-lane stack translated: lanes,
aligned, one clock. The wave says how the idea feels; the curve says how one
quality moves; SCORE says **what happens when, across all of them** — where
qualities collide, hand off, or ignore each other. The sidechain-ducking
read (one quality yielding as another rises) falls out for free.

**Input contract.** Variable-inheriting, one dot per lane, **min 2** — a
one-lane SCORE is the curve control's own face, and the min count is what
enforces the no-duplicate rule structurally. Coercion makes the rail
type-total and each coercion is *informative*, not degraded: series → its
line; scalar → a flat rule (an unshaped quality reads as deliberate
constancy against the shaped ones); span → a flat band (a corridor riding
the whole arc). The input dot re-glyphs per D1 (`setType`) so lane type is
legible at the rail. Lane inherits label (micro caps, left edge of lane) and
line/band accent from its control. Unwired lane: faint flat rule at rest 0.5,
no label.

**Geometry.** `+`/`−` head chrome, radar grammar. Lanes stack top-to-bottom
in slot order, equal heights, FLIP on add/remove. Five vertical hairlines at
the speakable detents (start / quarter / midway / three-quarters / end,
`--mui-line` at the depth-rule weight) run through all lanes — they are the
alignment instrument; the timebase words sit beneath them in micro caps,
hidden under `sm`. Min 4×3 (lanes need height; below it, lanes compress
before labels drop, then labels go to hover chips). Timebase words inherit
from the first wired curve's timebase config; mixed timebases render the
neutral detent words (start/¼/mid/¾/end) — the honest lowest common
denominator.

**One-way.** Deliberately. The curve control owns editing its shape (same
rationale as LEVELS vs sliders: a lane invites reading, not grabbing, and a
two-way lane would be a duplicate, worse curve editor). One sanctioned
gesture: **hover cross-section** — holding the pointer at any x draws a
vertical hairline and a per-lane value chip column ("what's happening at
this moment"). Gesture-owned, so it's honest motion; it is NOT a playhead
(appears under the hand, dies with it, never reaches the compiler — D1
respected).

**Motion.** Line/band geometry settles at `--mui-t-move`/`ease-settle` when
a wired control changes. No idle motion — no sweep, no playhead, nothing
owns one. Reduced motion: transitions snap, cross-section still works
(static hairline).

**Ink.** Ground-recessed well. 2px accent line per series lane (the curve
face's line at lens weight, not the control's 2.4px — a lens is quieter than
the instrument), flat accent rule for scalars, `--accent-tint` band for
spans. Detent hairlines behind everything. Lane separators at `--mui-line`.
No fills under series lines — the band-vs-line distinction is the payload
type made visible.

---

### 3.2 · WINDOW — what the limits leave open

```
WINDOW                           + − ⚙ ×
        0        ┊████████┊         100
      ┌──────────┊────────┊────────────┐
  ▭── │ LNGT ░░░░▐████████████▌░░░░ −46│   ▭ span jack glyph
  ▭── │ FRML ░░░░░░▐██████▌░░░░░░░ −71│   ▐█▌ the allowed band
  o── │ TONE ░░░░░░░░░│░░░░░░░░░░░ PIN│   │ scalar → zero-width pin
      ├──────────┊────────┊────────────┤
      │          ┊████████┊       28–52│   ← THE WINDOW: intersection
      └──────────┊────────┊────────────┘      of every band above
        conflict state: no wash, yellow seam where bands part
```

**Semantic job.** *The remaining room.* Range and filter controls each draw
their own constraint; a mod with three of them has three private pictures
and no composite. WINDOW stacks every wired span on one 0–100 axis and
renders their **intersection** as a highlighted column running through all
lanes plus a summary band at the foot — the room left once every limit has
had its say. It is the gate/compressor *chain* translated: serial dynamics
stages and what survives them all. Its killer read is the failure case:
**limits that disagree** (empty intersection) render as no window and a
yellow seam at the gap — the one place on the whole board where "your
instructions contradict each other" becomes visible before any prompt runs.
The gain-reduction meter survives here as the per-lane **bite** readout: how
much of the full range this limit removes (`−46` = 46% of the range gone).

**Input contract.** Variable-inheriting, one dot per lane, **min 2** — one
constraint already has its own face on its control. Span is the native
type; coercion keeps the rail total and each coercion means something:
scalar → zero-width span, drawn as a **pin** hairline (a committed value —
so wiring a dial in alongside the constraints answers "does my setting even
clear the limits?"; a pin outside the window is a conflict like any other);
series → its min/max envelope span (the curve's full swing must fit — the
strictest honest reading). Dots re-glyph per payload. Lane inherits label +
band accent. Unwired lane: full-width faint band (no constraint = everything
allowed — rest is the identity of intersection, which is exactly right).

**Geometry.** `+`/`−` head chrome. Horizontal lanes, shared 0–100 axis,
foot band for the intersection with its `lo–hi` readout in mono (or the
named stops when every contributing span defines them). Min 3×2. Under `sm`
the bite readouts drop first, then lane labels go to hover chips; the foot
window and its readout are the last thing standing — they are the point.

**One-way.** Deliberately. Dragging a band edge is the range control's own
job, and a write path for spans is new helper surface not worth buying for a
reading lens (same economics as LEVELS). If two-way pressure returns, the
honest gesture is band-drag with range mechanics through a span-aware
`slot.set` — designed, not built.

**Motion.** Band edges and the intersection wash re-flow at
`--mui-t-move`/`ease-settle` on value change. The conflict seam appears with
the same transition — no flash, no pulse; a contradiction is a state, not an
event. No idle motion.

**Ink.** Ground-recessed well. Excluded regions in `--mui-track`-on-ground
(darker, recessed — the honest "closed" ink), allowed band per lane in that
control's `--accent-tint`, pins as 2px ink hairlines. The intersection
column: `--accent-wash` derived from... no viz accent exists, so the window
column is **ink-hatched at low opacity through the lanes and solid ink in
the foot band** — the window belongs to no single control, so it wears ink,
not an accent. Conflict seam: `--mui-yellow`, the sanctioned rare state mark
— its first legitimate job in the whole system. Never red (one red per
screen stays reserved for destructive chrome).

---

### 3.3 · STEPS — the sentence, drawn

```
STEPS                              ⚙ ×
      ┌───────────────────────────────┐
  ∿── │  ▓      ▓ ─hold─ ▓            │   one column per POINT of
      │  ▓      ▓        ▓        ░   │   the wired series (2–5),
      │  ▓      ▓        ▓        ▓   │   placed at its t
      │  ▓      ▓        ▓        ▓   │   10 notches per column —
      │ ─────────────────────────────│   "N of 10", literally
      │  2      9        9        4   │   ← the spoken integers
      │ START  QUART    MID      END  │   ← the spoken words
      └───────────────────────────────┘
```

**Semantic job.** *Emission truth for the series.* The curve face shows the
smooth line you drew; the compiler speaks something coarser — points mapped
to timebase words, values as "N of 10", near-equal neighbors collapsed into
a hold (D6). STEPS renders **exactly the spoken version**: one 10-notch
ladder per control point, placed at its t, integer and timebase word
beneath, and a **hold tie** joining points the speller will collapse ("hold
at 9 of 10 through the middle" renders as two tied columns). It is the step
sequencer translated with a prompt-semantic job the curve face cannot do:
making the gap between *drawn* and *said* visible. When the drawing looks
expressive but STEPS shows `5 5 5 5`, the user learns their shaping was
below the speller's resolution — before the prompt ever runs. The
LEVELS/LIGHT GRID precedent ("the segment ladder is the spoken sentence made
visible") extended from scalar speech to series speech.

**Input contract.** Fixed-inheriting, **1 slot** — capped there; two series
side by side is SCORE's question. Inherits label + accent from the wired
curve. Coercion: scalar → flat line → two tied columns at start/end (the
spoken form of a flat series — honest and deliberately dull); span → flat
band → columns render lo–hi as a lit segment range (band speech). Unwired:
two faint columns at rest, no words.

**Geometry.** No `+`/`−` (fixed slot). Columns positioned proportionally at
their t along the strip (so the rhythm of the points is preserved — a
back-loaded curve *looks* back-loaded), fixed column width, 10 segments per
ladder always (semantic, like LIGHT GRID). Foot rows: integers (mono
tabular), then timebase words (micro caps, from the wired curve's timebase
config — "the steps of the task" prints its step words). Min 3×2; under `sm`
the word row drops first, then the integer row (hover chip carries
`WORD · N`).

**One-way, v1.** The curve control owns shape editing; a paint gesture here
would need series-surgery write-back (move/create the point at a detent) —
real new helper surface. The upgrade path is designed (paint a column →
`quantize`-style series edit through a series-aware `slot.set`) but not
bought. If any second-pass viz earns two-way later, it is this one — the
step-sequencer paint gesture is as delicious as LIGHT GRID's.

**Motion.** On value change, affected ladders run up/down with the LIGHT
GRID's 12ms-per-cell stagger; columns glide to new t positions at
`--mui-t-move`. Hold ties draw in with the same beat. No idle motion — and
explicitly **no ambient-now cursor**: the board clock's sampling is a
coercion concern, never a structural element here (D1).

**Ink.** Recessed well. Ladder wells as recessed capsules (LEVELS anatomy),
lit segments in the wired control's accent, fractional top segment via
`color-mix` saturation, unlit at `--mui-dot`. Hold tie: 2px accent hairline
bridging the tied columns' top segments. Words and integers in the standard
readout ink hierarchy.

---

## 4 · Rejection register (the other 23)

Carried forward for the record — one line each, full reasoning in §1:

spectrum analyzer (LEVELS), spectrogram/heatmap (SCORE's question),
goniometer/vectorscope (pad face / unspoken trajectory), oscilloscope XY
(same), single transfer curve (filter face), gain-reduction meter (folded
into WINDOW's bite), mod-matrix send grid (re-rejected), ADSR display
(curve face), arpeggiator preview (no order payload), waveform + loop
markers (value-span-as-time-window coercion lie), phase-correlation needle
(BEAM), tuner (completeness capsule via the back door), clip launcher (no
scene payload), crossfader (BEAM), wavetable position (no shape bank), LFO
shape picker (is a control), stereo-width meter (control readout),
composite EQ curve (false additivity; WINDOW is the honest composition),
sidechain-ducking view (folded into SCORE), waveshaper transfer (axis lie),
VU needle (READOUT cosplay), history/RMS meters (memory ≠ state), mod-amount
ring (deferred `bound` wire's job).

---

## 5 · System fit

- **Contract surface: zero new clauses.** All three use the existing shell,
  rail (left edge only), slot record (the `type?` field finally earns
  itself), motion charter, and question line. SCORE and WINDOW are
  variable-inheriting; STEPS is fixed-inheriting. All one-way, so no
  write-back extension needed.
- **First real consumers of D1.** These three are what make the span/series
  slot modes, the jack re-glyphing (`setType`), and five of the nine
  coercion-matrix cells load-bearing instead of theoretical. If the coercion
  matrix has bugs, these vizzes find them.
- **New bespoke pieces** (per the contract's bespoke column, all assembled
  from lib primitives): SCORE's detent hairlines + hover cross-section;
  WINDOW's intersection derivation + bite computation + yellow conflict
  seam; STEPS' point-column layout + hold-tie (which must share its
  collapse predicate with the D6 speller — one function, two renderings, or
  the honesty claim is a lie).
- **Build order, slotted into D5's wave B** (none of these blocks wave A):
  1. **WINDOW** — cheapest (static bars + an intersection), first span-slot
     exercise, and its conflict read is immediately valuable to range/filter
     users shipping in wave A.
  2. **SCORE** — the flagship of the three; wants the curve control mature
     and at least two series-emitters on real boards before its taste pass.
  3. **STEPS** — must ship *after* the D6 speller stabilizes, since its
     entire honesty is speaking the speller's output; sharing the collapse
     predicate is the acceptance test.
- **Palette question lines** (tooltip copy, plain words):
  SCORE — "When each quality rises and falls across the answer."
  WINDOW — "How much room your limits leave — and whether they agree."
  STEPS — "What the prompt will actually say about the shape."

## 6 · The claim of exhaustion

26 candidates evaluated; every rejection traces to duplicate-question,
missing-payload, or missing-runtime (§1). With SCORE, WINDOW, and STEPS the
set covers every payload shape relationally (scalars: the first-pass 9;
series×series: SCORE; span×span: WINDOW; series→speech: STEPS) and every
remaining DAW display fails a structural test, not a taste test. The
visualizer space over the current signal model is, to this pass's best
effort, closed. Reopening it requires new signal-model surface (an order
payload, composite voice) — a controls decision, not a visualizer one.
