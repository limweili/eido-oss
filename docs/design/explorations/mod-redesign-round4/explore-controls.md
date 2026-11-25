# Concept: XY Pad + Range controls — two new control families

Explored against: `lib/DESIGN.md` (SPEC 02), `lib/mod-ui.js` (factory
contract), `docs/design/mods/prompt-engine.md` (one-sentence rule, catalog),
ref `12-xy-pad-dark.png`, workbench v2 (jacks, cables, radar write-back).

Verdict up front: **the design system fits.** Both families land with two
new primitives (span signals, multi-jack controls) and zero changes to the
cable model, the card model, or the four-section compiler. One idea in the
brief — in-line cable processors — should be **rejected**, with a cheaper
composable substitute.

---

## 1. Dual-axis XY pad — RECOMMENDED design

**Thesis: a pad is two sliders fused into one gesture.** Everything follows
from refusing to invent a "pair" type: each axis is an ordinary 0–100
scalar with its own jack, its own frame, its own sentence, its own card.
The pad's only novelty is the *gesture* (one drag moves two values) and the
*semantics* (the creator declares a trade-off space: warmth × detail,
formality × energy). Nothing downstream knows pads exist.

### Face (instrument-flat translation of ref 12)

Ref 12 inverted to our language: the dark pad becomes a **recessed well**
(`--mui-track`, radius `--mui-r-well` feel at control scale — use 7px card
radius since it's inside a chip), the dot-grid field is `--mui-dot` (the
Frekvens texture earning its keep), crosshair hairlines are `--mui-line`
tracking the handle full-width/full-height, and the handle is the slider's
round ink handle — accent while dragging, exactly the slider rule.

```
┌────────────────────────────────┐
│ ● TONE                    ⚙ ×  │   head: identity dot + title (standard)
│ ┌──────────────────────────┐●──│── jack: DETAIL (y)
│ │ · · · · ·│· · · · · · ·  │   │
│ │ · · · · ·│· · · · · · ·  │   │
│ │──────────◉───────────────│●──│── jack: WARMTH (x)
│ │ · · · · ·│· · · · · · ·  │   │
│ │ COOL · · │ · · · ·  WARM │   │   axis-end names, micro caps, ink-faint
│ └──────────────────────────┘   │
│          62 · 38               │   readout: x · y, tabular mono
└────────────────────────────────┘
```

- **Crosshair**: two hairlines through the handle (ref 12 verbatim). They
  are the pad's "fill" — the picture of the value.
- **Drag trail**: while dragging, a short fading ink trail (3–4 ghost dots,
  gone in `--mui-t-move`). Ephemeral, motion-token-governed; the resting
  face stays flat. Cut under `prefers-reduced-motion`.
- **Axis-end names** (creator-authored, e.g. COOL/WARM, TERSE/DETAILED):
  micro caps `--mui-ink-faint`, pinned at the four edge midpoints inside
  the well. X ends left/right on the bottom edge; Y ends top/bottom on the
  left edge (horizontal text, never rotated — rotated mono is off-language).
- **Quadrant labels: rejected.** Four more words on the face fights the
  calm; end names already define the quadrants implicitly.
- **Steps per axis**: when stepped, the snap grid draws as slightly larger,
  darker dots *replacing* the texture dots at snap positions (one dot
  field, two weights — never two overlaid grids). Handle snaps per axis
  independently.

### Identity: one control, one accent, two axis sublabels

One identity dot, one title, one accent (system rule: one accent per
control). The axes are **sublabels, not identities**: they appear as the
jack hover-chips, the axis-end names, and the card eyebrows. Two accents
per control was considered and rejected — it breaks the color-well model,
the card model, and the "one accent doing focused work" principle.

### Output contract: two jacks (the multi-jack primitive)

Two output nodes straddling the right border (the sanctioned overhang),
vertically staggered: Y-jack at the well's top-right, X-jack at its
vertical center — each hover-chips its axis name. Each is an ordinary
scalar jack; wiring the X jack to a radar axis behaves exactly like wiring
a slider. **Radar write-back holds for free**: dragging that radar vertex
writes back through the wire and the pad handle slides horizontally.

At `sm` the jacks compress to 14px apart; at `xs` the pad is unsupported
(below). A single "joint" jack carrying an (x,y) pair was rejected — it
would introduce a second cable type that no visualizer input can consume.

### Emission: two sentences, per-axis frames

Exactly the existing catalog line ("Pad — one sentence per axis"). Each
axis carries its own frame with `{value}`; fallback is the slider fallback
per axis ("Warmth: 7 of 10"). Two compiler cards, both in the control's
accent, eyebrows "TONE · WARMTH" / "TONE · DETAIL", each with its own
value pill. A single joint frame with two slots ("balance {x} against {y}")
is a nice-to-have — **defer it**; it complicates silence rules (when is a
joint sentence silent?) and the per-axis default already reads well.

### Config popup

Title, description (shared), then **two axis blocks**, each: axis title,
low-end name, high-end name, steps (OFF, 2–10). Same stepper component as
dial/slider. No color row (color lives in the well, per SPEC 02).

### Size classes

The pad needs area; it is the first control with a **minimum footprint**.

| Size | Footprint | Shows |
| --- | --- | --- |
| lg | 4×3+ cells | face + end names + crosshair + `62 · 38` readout |
| md | 3×2 | face + crosshair + readout; end names drop |
| sm | 2×2 (minimum) | face + crosshair only; hover chip reads `TONE · 62·38` |
| xs | — | **not supported** — palette/resize enforce the 2×2 minimum |

Rationale: a sub-2×2 pad can't be dragged with any precision and the two
jacks collide. Refusing a size is more honest than shipping a bad one.

---

## 2. Range controls — RECOMMENDED: two siblings on one value

**Thesis: a range doesn't set, it constrains.** Semantically new: the
sentence is a boundary, not a position — so ranges **default-address to
the Boundaries section** (sliders default to How-to-approach). That one
routing default is most of the "filter" feel.

Ship two kinds sharing one value shape (`[lo, hi]` on 0–100 + a mode):

### 2a. Range slider — the compact workhorse (1 row tall)

```
┌────────────────────────────────────┐
│ ● FORMALITY                   ⚙ ×  │
│  (──·──●━━━━━·━━━━━●──·──)  30–70 ●│─ jack
└────────────────────────────────────┘
     lo-handle    hi-handle   readout
```

- Recessed capsule track (the slider's); **two** round ink handles;
  accent-tint **band** between them — one continuous body, both ends flat
  and tucked under their handles (extends the SPEC 02 slider-fill rule to
  two ends). Detent dots show through the band.
- **Drag the band to slide the whole window** (width preserved) — the
  gesture that makes it feel like an instrument, not a form widget.
  Handles: `ew-resize`; band: grab/`--mui-scale-lift` feel.
- Readout: `30–70` tabular mono (en-dash, no spaces), right-aligned like
  the slider's %.

### 2b. Filter — the hero face control (min 2×1, ideal 2×2)

The pass-filter idea, kept — but the audio metaphor lives **only in the
drawing**; the words stay plain (per the plain-language rule, no
"low-pass" anywhere in UI). Three modes:

| Mode (UI words) | Value | Face drawing | Speaks |
| --- | --- | --- | --- |
| NO MORE THAN | `[0, hi]` | shelf high on the left, ink roll-off at `hi` | "…no more than {hi}" |
| AT LEAST | `[lo, 100]` | roll-on at `lo`, shelf high right | "…at least {lo}" |
| BETWEEN | `[lo, hi]` | plateau between two roll-offs | "…between {lo} and {hi}" |

```
┌──────────────────────────────────┐
│ ● EXAMPLES                  ⚙ ×  │
│ ┌────────────────────────────┐   │
│ │━━━━━━━━━━━━┓ · · · · · · · │   │  ink curve on dot-grid;
│ │ · · · · · ·┃· · · · · · ·  │   │  accent wash under the curve
│ │ · · · · · ·┗━━━━━━━━━━━━━━ │●──│─ jack
│ └────────────────────────────┘   │
│  NO MORE THAN            ≤ 3     │  mode chip (click cycles) · readout
└──────────────────────────────────┘
```

- **The face IS the constraint drawn in ink**: a 2px ink curve over the
  dot-grid, `--accent-wash` filling the pass region under it. This is the
  purest expression yet of "controls carry a picture of their own value"
  (ref 08's lesson).
- Drag the roll-off edge(s) horizontally to move `lo`/`hi`; in BETWEEN,
  drag the plateau to slide the window. Mode is a micro-caps chip at the
  foot (click cycles; also in config).
- A fourth "AVOID" (notch) mode was considered and **cut**: "avoid mid
  formality" is a semantic corner case; three modes cover the brief.
- **Named stops** (from the existing catalog): the creator may name detent
  points ("a phrase", "a paragraph", "a full report"); when named, the
  spoken value uses the name — "no longer than a paragraph" — and the
  readout shows the name. This is where ranges become genuinely humane.

### 2c. Range dial — considered, REJECTED for v1

An accent arc segment between two stops on the 270° dial reads beautifully
at rest but drags terribly: the dial's mechanic is vertical-drag, and two
handles on an arc demand polar manipulation that falls apart under ~sm.
The range slider covers the semantics at every size the dial could occupy.
Revisit only if a circular quality (hue-like) ever appears.

### 2d. In-line cable processors — REJECTED (the big system call)

A gate that sits on a cable and clips values flowing through it would
open a **third part class** (processors) and make cable topology semantic
(chains, ordering). Three strikes:

1. It breaks "what you see is what it says" — the slider shows 90, the
   radar shows a clipped 70. This is precisely why `scale` wiring was
   already deferred in mod-prompt-engine.md.
2. Feed wires only paint pictures — displays never speak — so a clamp on
   a feed changes the picture without changing the prompt. A lying
   visualizer is worse than none.
3. Every downstream surface (compiler cards, provenance, tape) would need
   a chain-resolution story.

**The composable substitute — the `bound` wire (v2, optional):** wire a
range's jack to another *control*. The target draws the permitted band on
its own track (accent-wash zone through which detents show); the range
still speaks its own Boundaries sentence; the target still speaks its own
value. Two honest sentences, zero hidden math, and the constraint is
visible on the panel — ref 08's "gating is shown by dimming" lesson. No
new part class; it's a third wire kind next to gate/select/feed.

### Wired range at a visualizer

- **Input dot**: a scalar feed fills the dot; a span feed stretches it into
  a tiny **capsule** (a widened dot = a band). One glyph rule, learnable
  in one glance.
- **Radar axis fed by a range**: the spoke wears an accent-wash **band
  wedge** between `lo` and `hi` radii; the vertex sits at the window
  center. **Write-back = drag vertex slides the window** (width
  preserved) — the same gesture as the band-drag on the control. Width
  editing stays on the control (edge handles on a radar spoke would be
  fiddly; deferred).
- **Compiler card**: value pill reads `30–70` (or the named stops:
  `SHORT–MEDIUM`); sentence as emitted. Nothing else changes.

---

## 3. System question — the minimal new primitives

Current model: one 0–100 scalar per control, one jack, one sentence.

**Primitive 1 — the span signal.** Every signal on a cable is `[lo, hi]`;
a scalar is the zero-width span (`lo === hi`). One signal type, not two.
Renderers branch on width: zero-width → dot/vertex/pill-%, nonzero →
capsule/band-wedge/`lo–hi` pill. Write-back on a span moves its center.
Existing controls emit zero-width spans and nothing about them changes.

**Primitive 2 — multi-jack controls.** A control may expose N *named*
scalar/span jacks (pad = 2; future curve = 3–5, mixer = columns). Each
jack is individually wireable and indistinguishable downstream from a
whole control's jack. Jack identity = sublabel + the control's accent.

**Already covered, no new primitive:** multi-sentence emission (checklist
does it today; pad emits two), per-axis/per-mode frames (the existing
per-option frame storage pattern), filter mode (plain config data),
Boundaries default-addressing (per-kind address default, engine-owned).

**Explicitly rejected primitives:** pair-valued `(x,y)` cables (two jacks
decompose it), in-line cable processors (2d above), scale wiring (stays
deferred).

Composability check: cables ✓ (span-or-scalar, one type), visualizer
inputs ✓ (dot→capsule rule), compiler cards ✓ (pill text only), radar
write-back ✓ (center-drag), config popup ✓ (axis blocks reuse the
stepper), size classes ✓ (pad adds a min-footprint rule).

---

## 4. Open risks

1. **Span write-back ambiguity** — vertex drag moves the center; width is
   uneditable from the visualizer. If users expect width editing there,
   we need spoke edge-handles (deferred; watch for it in testing).
2. **Two jacks at small sizes** — at `sm` the pad's jacks sit ~14px apart;
   cable-grab precision needs verifying in hand. Fallback: enlarge jack
   hit areas beyond their 10px visual.
3. **Config popup growth** — the pad's two axis blocks are the biggest
   popup yet; it must not become a form. If it sprawls, split into a
   two-tab popup (per-axis) rather than scrolling.
4. **Snap-grid vs texture-grid** on the pad face — two dot weights must
   read as one field; needs a tuned specimen, not just the rule.
5. **Frames-with-two-slots demand** — if creators ask for joint pad
   sentences ("balance {x} against {y}"), the silence semantics need
   design before the syntax ships.
6. **`bound` wire scope creep** — it flirts with constraint solving. Hold
   the line: it paints a band and speaks a sentence; it never moves or
   clamps the target's value.
