# Mod workbench — expanding the visualizer set (concept)

Design exploration, 2026-07-16. Concept only — no implementation.
Builds on: `lib/DESIGN.md` (SPEC 02 instrument-flat), `prototypes/mod-workbench-v2.html`
(SEMANTIC WAVE + TONE OF VOICE radar), `docs/design/mods/prompt-engine.md`
(deterministic, 60fps, control-state-only, human-centric semantic space),
reference `13-ableton-m4l-device-collage.png`.

---

## The one rule that makes the set coherent

Every visualizer answers **one question about the idea being shaped**, and no
two visualizers answer the same question. A visualizer that can't state its
question in one line doesn't ship.

| Visualizer | The question it answers | Way |
| --- | --- | --- |
| SEMANTIC WAVE *(exists)* | How does the idea *feel in motion*? — energy, texture, turbulence | one-way |
| RADAR *(exists)* | What *shape* is the idea? — balance across named qualities | two-way |
| **LEVELS** | Which quality *dominates*, and how much headroom is left? | one-way |
| **LIGHT GRID** | How much have I *committed*, in discrete notches — and how charged is the whole board? | two-way |
| **BANDINGS** | What's the *mix*? — proportion, what dominates the blend | one-way |
| **MATRIX** | How do *sources bear on targets*? — cross-influence of two sets | one-way (v1) |
| **CONSTELLATION** | Is the idea *coherent or scattered*? — agreement between qualities | one-way |
| **READOUT** | What's the *headline number*? | two-way |
| **BEAM** | Which way does a *trade-off* lean? | two-way (coupled) |

Explicitly rejected: a **meter bridge** as its own visualizer — it is LEVELS at
1-cell height (a size class, not a new question). A **histogram/curve** viz is
the Curve *control's* own face, not a lens. A "completeness capsule" survives
in the engine doc but is out of scope here — it reads every control, not a
wired subset, so it lives outside this contract.

A second rule, extracted from the wave and made law for everything below:

> **Motion is a slot.** A visualizer may animate an idle dimension only if a
> wired input *owns* that motion (the wave's SPEED input owns its phase rate).
> Unowned idle shimmer is decoration and is banned. Change-transitions
> (`--mui-t-move`, `--mui-ease-settle`) are always honest — they depict the
> hand that moved the value.

---

## 1 · LEVELS — the mixing desk

```
LEVELS                          ⚙ ×
      ┌────────────────────────────┐
  o── │  ▓   ░   ▓   ░           │   ▓ lit segment (accent)
  o── │  ▓   ▓   ▓   ░   ─peak   │   ░ unlit segment (faint dot)
  o── │  ▓   ▓   ▓   ▓          │   ─ falling peak tick
  o── │  ▓   ▓   ▓   ▓          │
      │  ▓   ▓   ▓   ▓          │
      │ ─────────────────────── │
      │  72  58  81  35         │   mono readouts, tabular
      │ WARM PACE DETL SCOP     │   inherited titles, micro caps
      └────────────────────────────┘
```

**Semantic job.** Instant *ranked magnitude* — which quality is loudest right
now, by how much, and how close to the ceiling. The radar gives shape-gestalt;
LEVELS gives the console read: exact rank order plus headroom. It is the M4L
collage's segmented meters, verbatim in spirit.

**Input contract.** Variable/inheriting (radar-style). One dot per bar, min 2,
no hard max (bars compress). Bar title inherits the wired control's label; bar
segments and readout take the wired control's accent. Unwired bar: rest value
0, faint ink, no label — the dot alone, exactly like the radar's unlabeled
axis.

**Geometry.** `+`/`−` in head chrome, radar grammar exactly (− takes last
unwired first, then unplugs the last). Vertical bars, equal widths, FLIP
compression when a bar is added/removed. Min 3×3 cells. Below `sm` height the
numeric readout row drops first, then titles (hover chip takes over) — same
label-collapse rule as controls.

**One-way.** Deliberately. Bars invite reading, not grabbing; the two-way
"bank of faders" niche is already owned by actual slider controls on the
board. A two-way LEVELS would be a duplicate control, not a lens.

**Motion.** Segment count settles over `--mui-t-move` with `ease-settle` —
segments light in sequence, a fast run up the ladder, not a fade. One honest
extra: a **peak tick** that holds the highest recent value for ~1.5s then
falls. It is a function of the value trajectory the user just made — same
honesty class as the wave's phase — never of anything hidden. Reduced motion:
tick renders at current value, no fall.

**Ink.** This is a natural dot-matrix home: each bar is a recessed capsule
well (`--mui-track`) holding **10 stacked segments** — and 10 is not
arbitrary: the engine speaks sliders as *"N of 10"*, so the segment ladder is
the spoken sentence made visible. Lit = accent; unlit = `--mui-dot` (the
detent-dots-through-fill trick, vertical). Fractional top segment renders at
proportional `color-mix` saturation. Peak tick = 2px accent hairline.

---

## 2 · LIGHT GRID — the commitment board

```
LIGHT GRID                       ⚙ ×
      ┌───────────────────────────┐
  o── │  ● ● ● ● ● ● ● ◐ ○ ○   │  row per input (or flipped:
  o── │  ● ● ● ○ ○ ○ ○ ○ ○ ○   │  column per input)
  o── │  ● ● ● ● ● ● ● ● ● ◐   │  ● lit LED (accent)
  o── │  ○ ○ ○ ○ ○ ○ ○ ○ ○ ○   │  ◐ fractional (saturation)
      └───────────────────────────┘  ○ off (faint dot)
        exactly 10 LEDs per lane — "7 of 10", literally
```

**Semantic job.** Two reads at two distances. Up close: each lane is a value
in **discrete notches** — the same "N of 10" the prompt will actually say, one
LED per notch. At arm's length: **how charged is the whole board** — the
fraction of lit cells is the mod's overall activation. The wave shows how the
idea *moves*; the grid shows how much has been *committed*. LEVELS is analog
comparison; the grid is quantized dosage plus coverage gestalt.

**Input contract.** Variable/inheriting. One dot per lane, min 1 (a
one-lane grid is a legitimate 10-step meter), add lanes freely. Lane inherits
label + accent from its control. Unwired lane: all-off LEDs in faint ink.
Config popup holds one geometry choice: **lanes run as rows or as columns**
(weili's "grids in columns or rows"). Flipping is presentation only — never
changes wiring.

**Geometry.** `+`/`−` head chrome per the standard. LED pitch is fixed
(circle, ~45% gap — the lib's dot-field texture at instrument scale); the well
grows/shrinks the LED diameter, never the count: **always 10 per lane**,
because the count is semantic. Min 3×2 cells.

**Two-way.** Yes — the strongest two-way case after the radar. Click or drag
across a lane sets the value to that notch; write-back quantizes through the
slot (`count` rounds to its own integers; stepped controls snap to their
steps; `words` refuses, same rule as the radar vertex). The gesture is
delicious: painting a value in LEDs. While dragging, the active lane's LEDs
render at full accent and the handle-equivalent is the leading LED at
`--mui-scale-lift`.

**Motion.** LEDs light/extinguish in a 12ms-per-cell stagger run from the old
notch to the new — the change literally travels. No idle animation, ever: a
grid that twinkles is a lie.

**Ink.** THE motif home. Circles, not squares — squares read as pixels
(screen), circles read as LEDs (instrument), and circles are already the lib's
detent/dot vocabulary. Off-LEDs at `--mui-dot`, lit at lane accent, fractional
top LED via `color-mix` saturation. The well is `--mui-ground` recessed, so
lit accents sit on warm paper like the Frekvens poster.

---

## 3 · BANDINGS — the sediment core

```
BANDINGS                         ⚙ ×
      ┌───────────────────────────┐
  o── │███████████████████████████│  ← thick band: dominant
      │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
  o── │▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒│
  o── │░░░░░░░░░░░░░░░░░░░░░░░░░░░│  ← thin band: minor voice
      │░░░░░░░░░░░░░░░░░░░░░░░░░░░│
      └───────────────────────────┘
        band THICKNESS = share of whole; shade = fixed per accent
```

**Semantic job.** *Composition* — the mix, as strata. Every other numeric viz
shows absolute values; BANDINGS normalizes to share-of-whole, so it answers
"what dominates the blend and by what proportion" — the question you ask of a
Blend/Mixer-flavored mod. The gestalt read is a color climate: a mod that is
mostly warm accents *looks* warm before you read a single label.

**Input contract.** Variable/inheriting, one dot per band, min 2 (one band is
no mix). Band color is derived from the wired control's accent —
`color-mix(accent 30–60%, ground)` by band rank, tints always derived, never
hand-picked (lib rule, verbatim). Unwired band: hairline-only ghost stratum at
zero thickness contribution. Labels: micro caps riding the band's left edge,
hidden under `sm`, hover chip fallback.

**Geometry.** `+`/`−` head chrome standard. Horizontal strata filling the well
top-to-bottom in slot order (slot order = stratum order — the dot column
literally aligns with its band). Min 3×2. Zero-value bands collapse to a 2px
hairline, never disappear — silence is visible as a seam, matching the
engine's "silent means absent, not N/A" but keeping the wiring legible.

**One-way.** Proportions are coupled — dragging one boundary would write to
two controls at once with no honest mapping. Reading lens only.

**Motion.** Boundary re-flow at `--mui-t-move`/`ease-settle` — strata breathe
*only when a value changes*. No idle drift, no grain animation (tempting,
banned).

**Ink.** Flat fills separated by `--mui-line` hairlines. No gradients inside a
band — instrument-flat means each band is one ink. The banding *between*
bands is the picture. This is the one viz that is almost pure color; it earns
the lib's multi-accent budget because every hue on it is inherited, none
chosen.

---

## 4 · MATRIX — the influence table (weili's sketch)

```
MATRIX                            ×
             o    o    o    o        ← column rail (targets), top
            NOVEL DETL SCOP CONF
      ┌───────────────────────────┐
  o── │  ●    •    ◉    ·   │ COMPLEX
  o── │  •    ◉    •    ●   │ EVIDNC     dot SIZE = row × col
  o── │  ·    •    ●    ◉   │ PROGRSS    dot INK  = row accent
      └───────────────────────────┘
       hover: ghost row below / ghost col right (dashed) = add
```

**Semantic job.** *Cross-influence between two named sets* — sources (rows)
against targets (columns). Cell dot size = how strongly this source currently
bears on this target. No other viz relates two distinct sets; the radar and
LEVELS relate members of one set to each other. This is the reading for mods
that shape *interactions* (e.g. how Evidence-pressure should bear on Scope vs
Confidence).

**Input contract & the honesty question.** A cell holds no value of its own —
a matrix with per-cell inputs is just a worse light grid. The matrix is an
**outer-product lens**: rows and columns each inherit a wired control, and
cell(i,j) renders `√(rowᵢ · colⱼ)` (geometric mean — 0 on either side kills
the cell, matching the engine's silence semantics; a muted source influences
nothing). Two rails of inheriting dots: **row rail straddles the left edge**
(the standard column), **column rail straddles the top edge** — the first
consumer of a generalized rail primitive (see contract). Min 2×2 wired-capable
slots per rail. Per-cell accent: the dot wears the **row (source) accent** —
sources own the ink, targets own the geometry (column position + their share
of the size). One accent axis, not a mud of mixes.

**Geometry.** No `+`/`−` here — with two axes a single +/− is ambiguous.
Instead the lib's own preferred grammar: **growth affordances are ghosts of
the thing they create** — on hover, a dashed ghost row under the last row and
a dashed ghost column right of the last column; click to add. Per-slot × on
rail-dot hover removes (min 2 enforced). Min 4×3 cells; cell pitch fixed, well
scrolls never — the matrix refuses to shrink below legible dots (min dot 3px,
max ~14px).

**One-way (v1), deliberately.** A dot has two parents; dragging it cannot
honestly write back one value. Options rejected: proportional split (spooky
action on two controls), row-header mini-sliders (duplicate controls). If
two-way pressure returns, the honest handle is dragging a **rail dot's
adjacent header lozenge**, which is just… a slider. Leave it one-way.

**Motion.** Dot radius settles per value change (`ease-settle`, slight
overshoot — dots *pop* to size). Row/col add/remove uses FLIP: existing cells
glide to their new pitch. Nothing idles.

**Ink.** Hairline grid (`--mui-line`), solid ink-accent dots on `--mui-panel`
cells — the well here is *not* recessed; a table is chrome, not a signal
field. Row labels left of the grid, column labels rotated? No — never rotate
mono caps; column labels sit horizontal above their column, truncated with
hover chip. Zero-value cell: a `--mui-dot` speck (the detent dot), so the grid
texture never goes blank.

---

## 5 · CONSTELLATION — the coherence read *(invented; ref 13's node clusters)*

```
CONSTELLATION                    ⚙ ×
      ┌───────────────────────────┐
  o── │        ●─────●            │  node radius-from-center = value
  o── │       ╱ ╲   ╱             │  edge opacity = agreement of
  o── │      ●───╲ ╱              │    its two endpoint values
  o── │       ╲   ●               │  tight bright web = focused idea
      │        ╲ ╱                │  sprawled faint web = scattered
      │         ●                 │
      └───────────────────────────┘
```

**Semantic job.** *Coherence vs sprawl.* Nodes sit on fixed compass bearings
(slot order), each at distance-from-center = its value; every pair is joined
by an edge whose opacity/weight = how much the two values **agree**
(1 − |vᵢ − vⱼ|). A mod where all qualities pull together renders as a tight,
bright, near-regular web; a mod at war with itself renders as a sprawled,
faint scatter. The matrix shows *directed* cross-influence between two sets;
the constellation shows *mutual* agreement within one set. It is the Guitar
Clusters / Auto Jungle display from ref 13, given a semantic job instead of a
musical one.

**Input contract.** Variable/inheriting, min 3 (two points have no gestalt),
`+`/`−` standard chrome. Node fill = wired control's accent (exactly the
colored node-dots in ref 13); unwired node parks at center-distance rest 0.5
in faint ink, edge-less. Labels: micro caps just outside each node's bearing,
radar-tip style, only when wired.

**Geometry.** Min 4×4 cells — it needs air. Bearings recompute on add/remove
with FLIP-style glide along the arc.

**One-way.** Dragging a node along its bearing *could* write back
(radar-vertex mechanics, same math). But the radar already owns "steer the
shape" — a two-way constellation would answer the radar's question with worse
handles. One-way keeps its job pure: it is the *diagnosis* lens, the radar is
the *steering* lens. If a mod carries both, they will disagree in exactly the
informative way (balanced shape, low coherence).

**Motion.** This is where "motion is a slot" pays off: the constellation
carries one **fixed labeled slot, DRIFT**, beneath the inheriting set. Wired,
it owns a slow orbital wobble of the nodes (amplitude = its value) — the
living cluster of ref 13. Unwired: perfectly static. Value changes glide
nodes along their bearing at `--mui-t-move` and re-weight edges over the same
beat. Hybrid input modes on one visualizer are sanctioned by exactly this
pattern (the wave is all-fixed, the radar all-variable; the constellation is
variable + one fixed motion slot).

**Ink.** Ground-recessed well, hairline edges (`--mui-line` at variable
opacity), accent-filled nodes with ink ring (the lib's connected-jack
rendering, enlarged). No fills between edges — a web, not a blob (the blob is
the radar's silhouette; don't echo it).

---

## 6 · READOUT — the headline *(invented; ref 13's big numerals)*

```
READOUT              ⚙ ×      two-slot variant:
      ┌───────────┐            ┌─────────────┐
  o── │   7 2     │        o── │  8 0        │
      │  ────     │        o── │  5 6        │
      │  WARMTH   │            │ WARM · PACE │
      └───────────┘            └─────────────┘
        drag digits vertically = drag the control
```

**Semantic job.** *The headline number.* One value promoted to the biggest
thing on the mod — the "80 56" panel of ref 13. Every other viz is a field;
this is a figure. Its place is the **Simple face** (engine doc): preset chips,
one readout, done. It also answers the density problem — a 2×2-cell viz for
when a mod has no room for a field.

**Input contract.** Fixed, 1 slot (a **READOUT PAIR** variant carries 2 —
capped there; three big numbers is a LEVELS). Inherits label + accent. Value
renders in the engine's own speech: sliders/dials as `72`, counts as the
integer, switch as `ON`/`—`, words refuse the wire (nothing to numeral).
Unwired: `--` in faint ink.

**Geometry.** Min 2×2 cells (pair: 2×3). Digits scale to the well
(headline type is the point); label in micro caps beneath, pill-readout
family styling.

**Two-way.** Yes — vertical drag on the digits writes back through the slot
with dial mechanics (100% ≈ 150px, shift = fine, arrows step). It is a dial
with the arc removed and the readout promoted; the write-back rules are
already paid for.

**Motion.** Odometer roll: digits tick through intermediate values over
`--mui-t-move` — the change itself is the animation. No idle blink (an LCD
that blinks unprompted is broken).

**Ink.** The one sanctioned place mono goes poster-size inside a component.
Tabular JBM, ink digits, 2px accent hairline under the numeral block (the
pill-readout's accent hairline, stretched). Panel chrome, no recessed well —
a readout is a chip, not a field.

---

## 7 · BEAM — the trade-off *(invented, small)*

```
BEAM                              ×
      ┌───────────────────────────┐
  o── │ BREVITY ────▲──────── DETAIL │ o
      │         ────────           │
      └───────────△───────────────┘
        beam tilts toward the heavier end; ▲ rides the ratio
```

**Semantic job.** *Which way a two-quality tension leans.* Mods constantly
pair opposing qualities (brevity/detail, freedom/constraint, novelty/rigor);
LEVELS shows both magnitudes but not the *lean*. The beam is one glance:
tilted left, marker position = ratio. Cheap, tiny (min 3×1), and honest.

**Input contract.** Fixed, exactly 2 slots — but the end labels *inherit*
wired control titles (fixed count, inheriting names: the third slot-mode
combination, sanctioned). Left dot on the left edge, right dot on the right
edge — the first right-edge input, mirroring the control's output overhang.
Each end's cap takes its control's accent.

**Two-way, coupled — flagged.** Dragging the marker toward A raises A and
lowers B by the same delta: one gesture, two writes, both visible on their
controls in real time. This is the only sanctioned coupled write in the set,
and it is honest precisely because both wired controls visibly move while you
drag. If that reads as spooky in prototype, demote to one-way without redesign.

**Motion.** Tilt settles with `ease-settle` overshoot — the one place the
physical metaphor is literal. No idle sway.

**Ink.** Capsule track (recessed), ink fulcrum triangle, round ink marker
(accent while dragging — slider handle rules), end caps as accent-tinted
pill-readout stubs.

---

## SYSTEM PASS — the visualizer contract

What the lib standardizes vs what stays bespoke. Test applied to each piece:
*would two visualizers implement it identically?* If yes, lib. If no, bespoke
— but built from composable primitives.

### Standardized (lib-owned)

1. **The viz shell.** Panel chip, head bar (`title` micro-caps left,
   hover-revealed action cluster right: optional `+`/`−`, then `×`), body,
   optional recessed well (`--mui-r-well`, ground fill) — the well is
   opt-out (matrix, readout are chrome-bodied). Grab-to-move on head, corner
   dot-stair resize, ResizeObserver → `sz-*` classes, per-viz min size in
   cells. **A visualizer has no accent of its own** — no identity dot in the
   head; every hue on it is inherited through wires. (This is the visual
   grammar that says "lens, not control" at a glance.)

2. **The slot.** One record: `{name, get, set?, rest, accent, labelMode}`.
   - `rest`: every slot declares its unwired value; unwired renders in faint
     ink, never in accent. (The wave already does this informally.)
   - **Three sanctioned slot modes**, declared per rail:
     `fixed-labeled` (wave: permanent micro label, fixed count),
     `variable-inheriting` (radar: `+`/`−`, name = wired control's title,
     min count, "− removes last-unwired-first"),
     `fixed-inheriting` (beam/readout: fixed count, inherited names).
   - `set` present ⇒ two-way capable; absent ⇒ the lib never lets a gesture
     write.

3. **The input rail.** The dot column, generalized:
   `rail({edge: left|top|right, mode, min, slots})` — straddling dots
   (8px outside, mirroring the output jack overhang), hover label chips,
   per-slot × (variable mode), spacing/justify rules. Matrix consumes
   `left` + `top`; beam consumes `left` + `right`. One primitive, three
   edges.

4. **Growth chrome, two sanctioned grammars.** `+`/`−` head buttons for
   one-axis growth (radar, levels, grid, bandings, constellation); **ghost
   row/column** (dashed hairline, wash fill — the lib's ghost-growth rule)
   for two-axis growth (matrix). Never both on one viz.

5. **Write-back rules** (two-way visualizers): all writes go through
   `slot.set` → `control.set()` — the control's value is the only state,
   never mirrored; the lib helper quantizes per kind (count → integers,
   stepped → steps, switch → threshold, words → refuse wire at connect
   time); during a viz gesture the wired control visibly moves (one state,
   many handles — engine doc, verbatim); write gestures respect the lib's
   drag conventions (shift = fine, arrows step where focusable).

6. **Accent inheritance.** Per-slot visual elements wear their wired
   control's accent; multi-element visualizers are multi-accent by
   construction; where a viz needs *one* accent (the wave), it declares a
   **primary slot** and inherits from there. Unwired = `--mui-ink-faint`.

7. **The motion charter.** `draw(state, t)` pure; shared rAF loop feeds `t`;
   `prefers-reduced-motion` freezes `t` and kills transforms;
   change-transitions use the lib tokens; **idle motion must be owned by a
   wired slot** (wave SPEED, constellation DRIFT) — otherwise static.

8. **The question line.** Every registered visualizer declares its
   one-line semantic job (shows as the palette tooltip / config description).
   Soft enforcement of "no two answer the same question."

### Bespoke (per visualizer)

- **The drawing itself** — canvas vs SVG, layout inside the well, all
  geometry math (wave's sines, radar's polygon, matrix's outer product).
  This is the "each unique to itself" weili asked to protect; the contract
  deliberately stops at the well's edge.
- **Two-way gesture semantics** — vertex drag vs lane paint vs digit drag vs
  beam slide. The *write path* is standard; the *hand motion* is the
  instrument's personality.
- **Derived-value semantics** — matrix's geometric mean, constellation's
  agreement function, bandings' normalization. These are each viz's honest
  little theory of its question; standardizing them would flatten the set.
- **Extra affordances** a viz invents (matrix ghost rails, levels peak
  ticks) — provided they're assembled from lib primitives (hairlines, dots,
  ghosts, tokens).

---

## Ranked build order

1. **LEVELS.** Cheapest full exercise of the variable-inheriting contract
   outside the radar — building it forces the slot/rail extraction while the
   code is still small, and it's instantly legible payoff (the M4L meters).
   Design the rail primitive *knowing* matrix and beam need top/right edges;
   build only `left` here.
2. **MATRIX.** weili's own sketch — highest signal that it's wanted — and the
   hardest test of the contract (dual rails, ghost growth, derived cells).
   Doing it second, while the rail primitive is a day old, means the
   primitive gets designed for two edges instead of retrofitted.
3. **LIGHT GRID.** The motif home and the second two-way surface; depends on
   the write-back helper the radar half-owns — extracting it here pays for
   readout and beam too. Ship with orientation flip.
4. **READOUT (+ pair).** Near-trivial once write-back is a helper; unlocks
   the Simple face story and small-mod density. Slot in beside grid work.
5. **BANDINGS.** No new mechanics at all (variable rail + one-way draw) but
   heavy taste-tuning — proportions, shade derivation, hairline weights.
   Schedule it when the eye is calibrated by the four above.
6. **CONSTELLATION.** The showpiece and the hardest honesty case (agreement
   function + DRIFT slot). Build last of the majors, when "motion is a slot"
   has been proven on the wave and the contract is frozen — it's the viz most
   likely to tempt decorative motion, so it benefits from going last.
7. **BEAM.** A one-day filler whenever the write-back helper exists; also the
   trial balloon for coupled two-way — if it feels spooky, one-way it and
   lose nothing.

Rationale for the cut line: 1–4 pressure-test every clause of the contract
(both slot modes, three rail edges, both growth grammars, one-way and two-way,
derived values). 5–7 add range but no new contract surface — they can slip
without blocking the lib.
