# Mod redesign — design references

Reference images for the Mod system UI redesign (wayfinder map: see the
`wayfinder:map` issue). Collected 2026-07-14 from weili.

## North star

**`06-north-star-eq-instrument-flat.png`** — the Nothing Phone EQ (itself
designed by Teenage Engineering). Closest single image to the target feel —
but make a **variation of it, not a copy**. What to take from it:

- **Instrument-flat**: flat, print-like rendering — ink lines, filled dots,
  pill/capsule tracks with dot detents. No gloss, no fake 3D, no skeuomorphic
  shadows.
- Physical *behavior* without physical *rendering*: detents, tick marks, value
  readouts, satisfying drag.
- Monospaced/technical labels, generous whitespace, oversized touch-friendly
  controls.
- One accent color doing focused work (active track, edited value, destructive
  action) against warm neutral surfaces.
- Mode toggle (SIMPLE/ADVANCED) as full pill buttons; profile dropdown +
  add; curve graph as a live visual summary of the slider bank below it.

## Supporting references

| File | What it contributes |
| --- | --- |
| `01-liquid-glass-inspector.webp` | Structure/density reference only (Toolcraft-style inspector: sections, reset-per-section, offset pads, labeled selects). **Not** the skin — we are light, not dark glass. |
| `02-weather-instrument-cards.webp` | Card variety: circular gauges, line-art dials, big mono numerals, mixed card shapes (circle/pill/square) on a quiet field. |
| `03-control-panel-sage.png` | Progress bars + capsule gauges, mono numerals (Aeonik Fono vibe), tick-mark dial. Label style: bold caps title + quiet subtitle + value right-aligned. |
| `04-eq-sliders-gray.png` | Earlier, grayer take on the north-star EQ — dot-detent slider anatomy. |
| `05-teenage-engineering-op1-family.png` | Hardware grid discipline, control grouping, playful-precise energy. Inspiration only — **we design our own tones and accents, not TE orange.** |
| `07-nothing-eq-simple-advanced-dark.png` | The same EQ wearing two faces: Advanced = eight sliders; Simple = one draggable three-axis blob + preset chips. **Key idea: a visualization is another face of the same values** — controls, wiring, and a visual summary of the prompt are one system. |

## `08-delay-reverb-module-grid.png` — the interconnection reference

A delay + reverb effects plugin (added 2026-07-15). This is the reference for
**how many controls live together on one panel** — grid anatomy, hierarchy,
and controls visibly affecting each other.

**What on it is a control surface** (holds a value, user turns it):

- Hero knobs — TIME, FEEDBACK, DECAY, CHOKE: big, one per module's defining
  parameter, mono value readout beneath ("1/4th D", "77.2 %", "9.304 s").
- Utility knobs — GLITCH, DUCKING, FB TILT, S.RATE, PRE, RATE, NUDGE:
  half-size, second row. **Size encodes importance.**
- Vertical sliders — IN/OUT levels at each module's edges; the SEND slider;
  the master gain fader.
- Toggles — SYNC, STEREO, PONG, power switches under CHOKE.
- Dropdowns — "Dark", "Soft Clip".

**What on it is a visualizer** (holds no value, pictures the state):

- The module headers: delay shows concentric echo ripples, reverb shows a
  decaying spectral mountain — each drawn **from the knob values**, not from
  the audio alone.
- Output meters (segmented bars) beside each OUT slider.
- **Knobs that carry their own picture inside**: TIME has ripple rings in its
  face, FEEDBACK has a core that glows hotter as it rises, DECAY contains a
  box filling with liquid, CHOKE has a ring of dots. The control *is* a small
  picture of what it does.
- The tilt curves under IN TILT / OUT TILT — tiny filled slope drawings.

**Lessons for the mod grid:**

1. **Consistent module anatomy**: visualizer on top → titled divider bar →
   hero controls → utility row → mode toggles at the foot. Every module reads
   the same way, so a dense panel stays scannable.
2. **Hierarchy by size**, not by position alone: the defining control is big.
3. **Interconnection is spatial**: the SEND slider physically sits *between*
   the two modules it routes. Wires should live where they act.
4. **Gating is shown by dimming**: RATE and NUDGE are grayed until SYNC is
   on — a wire's effect is visible on the panel, not hidden in a menu.
5. **Signal flow reads left→right**: IN → module → OUT → SEND → module →
   MASTER. A mod's panel can read the same way: shaping → form → compile.
6. One ink + one accent on warm paper; intensity of fill carries state.

## The v2 design-language triad (added 2026-07-15)

The component-library redesign blends exactly three references:

| File | What it contributes |
| --- | --- |
| `09-nothing-eq-advanced-light.png` | The base: gray-on-gray calm, capsule tracks with in-track detent dots, round handles, pill value readouts ("F 110HZ"), mono caps, one red accent working hard. |
| `10-te-ikea-frekvens-poster.png` | The seasoning: graphic confidence — dot-matrix textures, bold black/red(/rare yellow) geometry. |
| `08-delay-reverb-module-grid.png` | The warmth: paper ground, module anatomy, controls that picture their own value. |

`11-wire-interaction-mock.png` is weili's rough sketch of the wire idea
(cables from control output nodes to visualizer input dots). It specifies the
*interaction*, explicitly **not** the look.

## Direction decisions (from the charting session)

- Light instrument look is the skin; instrument-flat is the design language.
- Blend with what Eido already has — this is a **UI skin over the existing
  machinery**. Do not touch infrastructure, architecture, or performance-
  critical paths (e.g. low-level card rendering / LOD).
- Reuse Eido's **existing color schemes**, deployed creatively as accents —
  no new palette required.
- Users can **choose a mod's color** in the builder: customizing form as well
  as function.
