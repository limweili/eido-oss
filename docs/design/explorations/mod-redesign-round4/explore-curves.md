# Curves and time — concept report

Explorer report for the Mod workbench redesign. Scope: the CURVE control, what
"time" means for a one-shot async prompt instrument, the series value type,
jack compatibility, playhead question, interaction, and emission format.

Grounding read: `research/07-mod-design-prototypes/mod-instrument-redesign/lib/DESIGN.md`,
`docs/design/mods/prompt-engine.md` (one-sentence rule, {value} slot,
visualizer-as-intermediary), `prototypes/mod-workbench-v2.html` (srcVal
normalizes every jack to a 0..1 scalar; visualizers hold typed input slots;
compiler renders one card per speaking control; the whole board already shares
one rAF clock).

---

## 1. What IS time here — verdict: DOCUMENT TIME, with timebase as a config

The AI executes once, asynchronously. There is no wall clock the instruction
can reference. So t must be a coordinate the *instruction itself* can point
at. Four candidates, evaluated honestly:

### (a) Document time — t = progression through the answer. **WINNER.**

- Zero new runtime machinery: the curve compiles to one static sentence about
  the *shape of the answer*, exactly like every other control. One-shot,
  deterministic, async-safe.
- Universally applicable: every answer has a beginning, middle, and end.
  (b) and (d) only apply when the task happens to be staged or list-shaped.
- It's what "envelope" already means to weili's audio intuition, transposed:
  attack/decay over the *reading experience* instead of over seconds.
- Models demonstrably follow coarse positional instructions ("open with…,
  close with…") — this is the best-obeyed interpretation of the four.

Emitted (warmth 20→90→40, 3 points):
> "Warmth over the answer: open cool (2 of 10), build to very warm (9 of 10)
> through the middle, and settle back to moderate (4 of 10) by the end."

### (b) Task time — t = stages (research → draft → polish)

Compiles fine as a static instruction ("as you work: research coolly, draft
warm, polish moderate") but only meaningful when the task HAS stages, and the
stage names are task-specific — the curve can't know them. Verdict: valid,
but it's really document time with creator-named x-detents. Fold it in via
the timebase config (below), don't make it a separate primitive.

> "As you work through this: start the research cool (2 of 10), let the
> draft run very warm (9 of 10), then polish at a moderate warmth (4 of 10)."

### (c) Conversation time — t = turns

The honest problem: mods shape one async run. A per-turn evolving mod needs a
turn counter and re-emission per turn — runtime state the engine deliberately
doesn't have. It CAN compile to a standing instruction ("early in the
conversation stay formal; relax as it develops"), which a model will roughly
follow, but Eido's mods aren't persistent system prompts today. Verdict:
**defer**. If mods ever attach to a persistent conversation, revisit; the
series primitive below already carries the data it would need.

### (d) Sequence position — t = items in a list

> "For the first items keep warmth low (2 of 10); peak (9 of 10) around the
> middle of the list; ease to 4 of 10 for the last items."

Perfectly coherent — and it is document time again, where the document is
enumerable. Fold in via timebase config.

### The timebase config

t's meaning IS a config choice on the curve — one dropdown in the config
popup, plain words, creator-owned (it's frame authoring, not a user value):

| Timebase (creator picks) | Sentence scaffold |
| --- | --- |
| **the answer** (default) | "open… through the middle… by the end" |
| **the steps of the task** | "as you work: first… then… finally" (creator may rename x-detents) |
| **each item in the list** | "for the first items… mid-list… the last items" |

Same value model, same picture, same jack — only the speller's scaffold
changes. Conversation time is deliberately absent from the menu.

---

## 2. The series primitive

New value type beside the scalar:

```
SERIES = [(t, v), ...]   // both 0–100, sorted by t, unique t
                          // 2–5 points; endpoints t=0 and t=100 always exist
```

- **Min 2 points** (the endpoints, undeletable — a curve always spans its
  whole timebase). **Max 5** — DESIGN.md's catalog already says "3–5 numbers",
  and it's the ceiling at which the sentence stays readable. More points than
  a model can obey is false precision wearing a UI.
- v1 segments are **linear**. Per-segment curvature (drag the segment,
  audio-style) is the first v2 upgrade; when added it's stored as tension
  −100..100 and spoken only coarsely ("build quickly, then level off" /
  "rise gently"). Don't ship it first — three features (curvature, quantize,
  gain) at once over-eggs v1.

### Jack compatibility — total coercion, cables stay dumb

The composability win: **every cable always plugs.** Two value types, four
rules, no rejected connections, no typed-jack error states:

| From \ into | scalar slot | series slot |
| --- | --- | --- |
| **scalar** | as today | constant series (flat line) |
| **series** | sampled at "now" (see §3) | passed whole |

- **Series → series slot** (a bars/graph visualizer, or a future curve-shaped
  input): the visualizer draws the whole shape directly. The existing `graph`
  display in mod-prompt-engine.md ("a curve-ish set") is exactly this slot.
- **Series → scalar slot** (e.g. the semantic wave's HEIGHT): the slot reads
  v(now). Since visualizers already animate on the shared rAF clock (see
  `loop(t)` in mod-workbench-v2.html), "now" sweeps 0→100 on an ambient loop
  (~5s period) — **the wave breathes through the envelope.** This stays
  inside the visualizer guarantee: it's a pure function of (values, phase),
  periodic and deterministic — the same guarantee `drawWave(it, t)` already
  exercises.
- **Scalar → series slot**: a flat line. Free, obvious, teaches the type.

### Scalar → curve (the gain input) — yes, and it legalizes the deferred wire

Audio instinct: a dial modulating the curve's overall gain. The engine doc
deferred `scale` wires because "B would display one value and speak another."
The curve is the one control where that objection dissolves: **its face is
already a picture.** Give the curve exactly one input jack, GAIN (scales all
v). The face draws the authored curve as a ghost line and the *effective*
curve solid; emission speaks the effective values. What you see is literally
what it says. Ship as the curve's v2 alongside curvature — v1 curve is
output-only.

---

## 3. The playhead question — a gesture, not an object

Should the board grow a global playhead/transport? **No.** A persistent
playhead falsely promises runtime — the AI reads the whole instruction at
once; there is no moment when "now = 40%" is true of execution. A transport
bar would be the one piece of chrome that lies about the medium.

What's actually wanted is *preview-at-t*, and two existing mechanisms cover it:

1. **The ambient clock (already exists).** The shared rAF loop gives every
   series consumer the same phase for free — two curves feeding two
   visualizers sweep in sync with zero new state.
2. **Scrub as a gesture.** Dragging horizontally along a curve's x-axis (on
   the face, not on a point) broadcasts that t as "now" to all series
   consumers for the duration of the drag — every wired visualizer snaps to
   that moment; release, and the ambient loop resumes. Playhead-as-gesture:
   momentary, board-wide, owns no UI, saves no state, never emits.

Ownership: the workbench (board) owns the clock and the scrub broadcast; the
curve control merely reports the gesture. Nothing about "now" ever reaches
the compiler.

---

## 4. Interaction spec (the control face)

Audio-native, mapped onto the lib's instrument-flat grammar:

- **Face**: a recessed well (track color) spanning the control, the curve as
  a 2.4px accent line, points as round ink handles (accent while dragging) —
  the slider's anatomy bent into 2D. The face is the control's own miniature
  visualizer, per the "controls carry their own picture" rule.
- **Click empty face** → add point at (x, y). **Drag point** → move (x and
  y; endpoints y-only). **Double-click point** → delete (endpoints refuse).
- **X-axis snaps to speakable detents**: start / quarter / midway /
  three-quarters / end (5 dot detents in the well, same dot language as the
  slider track). Shift-drag for free placement. This is "what you see is
  what it says" applied to time — the picture only lets you place a point
  where the sentence has a word for it.
- **Y-axis**: inherits the existing steps config (OFF, 2…10), same as
  dial/slider.
- **Readout** (bottom, per anatomy order): the point count and hovered/active
  point as "MID 90" in the pill-readout style.
- **Config popup**: title (= the quality being shaped), description,
  timebase dropdown (§1), y-steps stepper. Point count is implicit in the
  face — no numeric field for it.
- **Footprint**: 4×2 cells minimum (a curve needs width to be draggable).

---

## 5. Emission — one card, one sentence, phase clauses

**One sentence with an inline shape description wins.** Rationale: the
compiler's grammar is one card per speaking control; a curve is one control,
so one card. Per-point cards would break card anatomy (whose pill? whose
frame?), bloat the tape, and imply the points are independently addressable
when they're one gesture. The sentence carries the shape as clauses.

Engine mechanic (the speller — pure function, engine-owned):

1. Map each point's t to its detent word per the timebase scaffold.
2. Speak v in the established "N of 10" spoken scale, with a coarse
   qualitative word (low/moderate/high/very high) so the number never stands
   alone.
3. Collapse near-equal adjacent points ("hold at 9 of 10 through the
   middle") — precision the model can't use is dropped at the speller, which
   also keeps 5-point curves honest.

Fallback (no frame): `"Warmth over the answer: open at 2 of 10, build to
9 of 10 by the middle, settle at 4 of 10 by the end."`

Frame with slot — the {value} slot receives the whole spoken shape, keeping
the one-slot rule intact: frame `"Vary the warmth of the writing: {value}."`
→ `"Vary the warmth of the writing: open at 2 of 10, build to 9 of 10 by the
middle, settle at 4 of 10 by the end."`

Card: eyebrow = title, pill = point count + peak ("3PT ↥90"), sentence as
above. Silent state: a flat curve at the default is NOT silent (a deliberate
"hold steady at 5 of 10" is information); the curve is silent only when
gated, like any control.

---

## 6. Minimal primitive set (the recommendation)

| # | Primitive | What it is | Lives in |
| --- | --- | --- | --- |
| 1 | **SERIES value type** | [(t,v)] 0–100, 2–5 pts, fixed endpoints | engine (value model) |
| 2 | **Curve control** | the face, points, detents, config, output jack | **LIBRARY** (`mod-ui.js` kind `curve`) |
| 3 | **Coercion rules** | the 2×2 table in §2 — every cable plugs | workbench (wiring layer) |
| 4 | **Ambient clock + scrub gesture** | shared phase; momentary broadcast "now" | workbench (board) |
| 5 | **Series speller** | series + timebase → clause list | engine (emitter, pure fn) |
| 6 | **Bars/graph visualizer** | first native series slot | workbench (visualizers) |

Library vs workbench: the curve *control* (rendering, pointer math, detents,
config popup) is a lib citizen like dial/slider — reusable, board-agnostic.
Everything that involves other items — cables, coercion, clock, scrub
broadcast, the speller, visualizers — stays in the workbench, matching the
existing split (lib ships `nodeDot`; the board ships wiring). One lib
addition beyond the control: a series variant of the jack glyph (a tiny
3-segment polyline inside the ring instead of a plain dot) so a cable's type
is legible at both ends.

v2 backlog, in order: segment curvature (spoken coarsely) → GAIN input jack
(ghost+solid face) → creator-renamable x-detents for the task timebase.

---

## 7. Alternatives considered

- **Global playhead object / transport bar** — rejected: promises a runtime
  the medium doesn't have; scrub-as-gesture + shared clock gives every
  preview benefit with no standing UI or state.
- **One card per point/phase in the compiler** — rejected: breaks
  one-card-per-control, bloats the tape, implies independent addressability.
- **Conversation time as a timebase** — deferred: needs persistent-mod
  runtime that doesn't exist; series data model already supports it later.
- **Separate "envelope", "LFO", "sequencer" controls** — rejected: they're
  all one series-emitting curve with different timebases/configs; the modular
  answer is one primitive + config, not a family.
- **Free-form x placement, spoken as percentages** ("at 37% of the way
  through") — rejected: models don't obey it and the sentence reads like a
  spec, not an instruction. Detents keep speech and picture in lockstep.
- **Averaging a series into a scalar slot** — rejected: a silent lie (shows
  motion, feeds a mean). Sampling at the ambient/scrubbed now keeps the
  picture truthful.

## 8. Risks

- **Model obedience is coarse.** 3 phases: reliable. 5 points: doubtful. The
  speller's collapse rule and the 5-point cap are the mitigations; if testing
  shows even 5 is too many, drop the cap to 4 — the primitive doesn't change.
- **Animated sampling could read as nondeterminism.** Mitigation: the sweep
  is periodic and phase-locked to the shared clock; scrubbing makes the
  relationship graspable in one gesture.
- **Scope creep toward a DAW.** Curvature, gain, renamable detents, and any
  future transport must each re-justify against "the instrument shapes an
  instruction" — the moment a feature only makes sense with a runtime clock,
  it's out.
- **Timebase confusion.** Three timebases share one face; the config popup
  must preview the scaffold sentence live (the tape already does this) so the
  creator sees the words change as they flip the dropdown.
