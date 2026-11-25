# The Mod prompt engine — first principles

Working design for the Mod redesign (pairs with
`prototypes/mod-design-language.html` and `prototypes/mod-prompt-engine.html`).
Question it answers: **for every control surface, what is fixed in the engine,
what does the creator author, and what does the user touch?**

Status: historical design exploration, superseded by
[`single-class-mods-integration.md`](single-class-mods-integration.md) and ADR
0030. References below to the control/target engine describe the retired
system, not current source.

## The one-sentence rule

Every control has one job: **produce zero or more plain sentences,
deterministically**. A mod is an ordered list of sentences routed into four
sections of the final prompt (Background / Boundaries / How to approach it /
The answer). No AI sits between a control and its sentence — same values,
same words, every time.

## The five parts of every control

| Part | What it is | Who owns it |
| --- | --- | --- |
| **Mechanic** | The value's shape and how it is spoken: a slider is a 0–10 number spoken as "7 of 10"; a toggle speaks or stays silent; tags speak as a list. | **Engine** — fixed in code, per kind |
| **Frame** | The words around the value: "Write as if for {value}". Choices get one frame per option; pads get one per axis end; ranges may get one per band. | **Creator** — written when building the mod |
| **Value** | What fills the slot: the drag, the pick, the typed text. | **User** — set while using the mod |
| **Address** | Which of the four sections the sentence lands in. | **Creator** (engine supplies a sensible default per kind) |
| **Look** | Label, color, size, position on the mod. Never reaches the prompt — except the label, which speaks when no frame is written. | **Creator** sets it; user may adjust where allowed |

The user's example, decomposed: label + frame "Write as if for {value}" is the
creator's; "a busy founder" is the user's value; the engine splices them and
addresses the sentence.

## Engine guarantees (never editable)

- **Silence** — a control with nothing to say says nothing: toggle off, empty
  text, empty list. Silent means absent, not "N/A".
- **Fallback** — no frame written → the label speaks: "Detail: 7 of 10". This
  is why a quickly assembled mod works with zero authoring.
- **Determinism** — emission is pure data-to-text. Compile, tooltip, and the
  live tape all read the same lines from one function.
- **Transparency** — every sentence is inspectable at the control (tooltip)
  and at the mod (tape); applied values are recorded in run provenance.
- **Assembly** — section order, dedup, and the dial-intensity preamble are
  engine-owned. Mods are never compacted (ADR 0015).

## The slot

Frames gain a `{value}` slot so the creator can place the value mid-sentence
("Give {value} options, no more"). No slot written → the engine appends the
spoken value after the frame, exactly as today (`lead + value`). This is the
only new syntax; there is no second one.

## Wiring — controls that affect each other

Two primitives, both deterministic, both creator-authored:

- **Gate** — B only speaks when A is on / matches a choice. *"Include
  examples" off mutes the "how many examples" stepper.*
- **Select** — A's choice picks which of B's frames speaks. *Audience =
  CLIENT swaps the warmth dial's phrasing.*

Deferred, deliberately: **scale** (A shifting B's value) — it breaks the
"what you see is what it says" promise, since B would display one value and
speak another. Revisit only with a visible-affordance design.

Wiring is data on the mod (`wires: [{from, to, kind, when}]`), consulted by
the emitter before a control speaks. It extends the spec, not the engine's
guarantees.

## Displays — the prompt made visible

A second part class besides controls. A **display never speaks and holds no
value of its own** — it is a lens over controls it is wired to (a third wire
kind: **feed**). Because emission is deterministic, the picture is as truthful
as the tape: same values, same shape, same sentences.

- Display types are engine-owned (like control mechanics): **radar** (N dials
  → the mod's shape), **meter** (one summary value), **graph** (a curve-ish
  set), **readout** (an LCD strip of the key choices).
- The creator picks a display, wires controls into it, names the axes.
- Displays are **two-way**: dragging a radar vertex writes back through the
  wire to the control. One state, many handles — never a second copy.

## Visualizers — the intermediary (refined 2026-07-15)

Displays, promoted. The design brief: **the live experience is shaping, not
generation**. While the user turns controls, the primary feedback is a
picture, not prose — the prompt text is a compilation artifact.

- **Deterministic and instant.** A visualizer is a pure function of current
  control values — never of the AI's response — and updates at frame rate.
  Same values, same picture, always. This is the same guarantee emission
  already has; the visualizer and the sentence are two renderings of one
  state.
- **Human-centric semantic space.** Axes are named intent qualities the
  creator wires in (warmth, specificity, constraint, autonomy…) — never a
  model's internals.
- **Demoted, not broken, transparency.** The tape (the emitted sentences) is
  no longer the front of the experience; it folds away behind an inspect
  affordance. The guarantee stands — every sentence remains inspectable at
  the control and at the mod — but reading it is optional, like viewing
  page source.
- **Two visualizer families**, beyond the wired lenses (radar/meter/graph):
  - **Oscilloscope** — semantic properties as an animated wave field; turning
    a control reshapes the wave immediately. Feels like *playing* the
    instruction. One-way (feed wires only).
  - **Capsule** — the whole instruction as a single evolving object that
    gains structure, density, and definition as controls speak. It pictures
    the instruction's *completeness*, not the AI's output. One-way; reads
    every control, not a wired subset.
- **Controls carry their own picture.** Where a mechanic affords it, the
  control's face is a miniature visualizer of its own value (a dial's fill
  intensity, a curve's slope drawing) — reference 08's knobs-with-pictures.
- AI execution stays asynchronous and out of scope for the visualizer:
  shaping and reviewing results are separate phases.

## Presets and faces — Simple / Advanced

The Nothing EQ pattern (reference 07): the same values wearing two faces.

- A **preset** is a named value-set the creator saves ("Balanced",
  "Punchy"…). Using one is a one-tap write to many controls. Presets are
  data on the template; instances may add their own.
- A mod can carry two faces, both assembled by the creator: **Simple** (a
  display + preset chips + at most a couple of controls) and **Advanced**
  (the full faceplate). The user flips; values are shared, so the faces can
  never disagree. The tape tells the truth for both.

## Permissions — what the creator lets the user do

Per control: `relabel` (rename on the board — today's behavior), `recolor`,
`addRows` (growing lists). Per mod: color, from the card palette. Defaults
match today's behavior so existing mods are unaffected.

## Appearance and color

- Mod color and per-control color both draw from the **card header palette**
  (`HEADER_COLORS` in `src/canvas/cards/CardShell.tsx`, 12 colors), with the
  same ink-contrast and soft-tint derivation. One palette across the app.
- Placement is a snap grid: each control has a span (1–3 of 3 columns);
  order + span is the whole layout model. Appearance never emits.

## The catalog, decomposed

"Spoken as" is the engine's fixed mechanic. Creator column excludes what all
controls share (label, frame, address, color, placement, wiring).

| Control | Value (user) | Spoken as (engine) | Creator also authors |
| --- | --- | --- | --- |
| Slider / Dial | number 0–10 | "«frame»: N of 10" | min/max/step; optional per-band frames |
| Range | pair | "between «low» and «high»" | named points on the scale ("short"… "a full report") |
| Number | integer | "exactly N" | min/max |
| Buttons / List / Picture pick | one choice | the picked option's frame | the options + one frame each |
| Position (3×3) | cell | "main point at «row», «col» detail" | row names + column names |
| Switch | on/off | on → frame; off → silent (optional off-frame) | the rule; optional off-frame |
| Checklist | set of bools | one sentence per checked item | items + one frame each |
| Actions | — (buttons) | never speaks | which actions to offer (reset / invert / surprise) |
| Short text | one line | "«frame» {value}" | placeholder |
| Long text | free text | spoken verbatim (frame optional prefix) | placeholder |
| Tags | list | "«frame»: a, b, c" | suggested tags |
| Growing list | rows (label + number) | one slider-sentence per row, user-labeled | the row template; row limit |
| Attach | a file | "match the attached «name»" (+ content to Background) | what kind of reference to ask for |
| Pad | two numbers | one sentence per axis | axis-end names + frames |
| Curve | 3–5 numbers | "opens at X, mid Y, closes Z" | the quality being shaped; point count |
| Blend | position 0–10 | phrased shift between two ends | both end names + frames |
| Mixer | small matrix | per column, the dominant row's frame | row names + column names |
| Group / Voice block | — | nothing (layout only) | which controls sit inside |

## The three modes, mapped

- **Using** = values + allowed relabels/rows/colors. Touch the front.
- **Creating** = frames, options, addresses, defaults, limits, permissions,
  arrangement, mod color. Author the parts.
- **Wiring** = gates and selects between sibling controls. Connect the parts.

## What has to exist (build list, mapped to today's seams)

1. **New control kinds** in the `ModControl` union + the two registries
   (renderer, emitter) — the established extension path. No new seam.
2. **Value spellers** per new kind (curve trio, matrix, pair…) — engine-side,
   pure functions.
3. **Frames with slots** — extend `meaning` handling with `{value}`; add
   per-option/per-end/per-band frame storage for the kinds that need it
   (per-option already exists for choice/segmented; xyPad has axis ends).
4. **Wires** — new optional `wires` array on the mod spec (`gate`, `select`,
   `feed`); emitter consults gates/selects; displays read feeds; normalizer
   drops dangling wires; editor UI to author them.
5. **Displays + presets** — display part types (radar/meter/graph/readout)
   in the renderer registry only (no emitter entry — they never speak);
   `presets` array on the spec; Simple/Advanced face assignment per part.
6. **Permissions** — optional `userCan` per control; defaults = today.
7. **Appearance** — optional `color` (mod + control), `span` per control;
   normalizer defaults; canvas renderer reads them.
8. **Unchanged**: four sections, applyMods assembly, provenance, digest,
   never-compact, template/instance stamping, library seam, save format
   (all additions optional-with-defaults, so existing saves normalize clean).
