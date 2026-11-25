# Eido design brief · the thinking instrument

Status: canon, unversioned. Authored from PR #442's instrument-flat language (`docs/design/prototypes/lib/DESIGN.md`),
the google-labs design/taste guides, and a source-verified inventory of every Eido surface.
This brief is the taste anchor; `SYSTEM.md` carries the full token and component spec.

## The reference sentence

> Eido looks like a **flat hardware instrument laid over warm paper**, a Teenage
> Engineering control surface printed on a Nothing-EQ-calm gray-on-gray field,
> where **your thoughts are the printed matter and the chrome is the machine**.

Every design decision traces back to that sentence. It carries the negative
constraints for free: paper has no glass, no glow, no gradient shading, no
neon; instruments have no skeuomorphic texture; print has no decoration that
isn't information.

## Two materials, two voices

The single organizing idea of this system. Every pixel in Eido belongs to one
of two materials, and each material speaks in its own voice:

| | **Paper** (the thought) | **Instrument** (the machine) |
|---|---|---|
| What it is | Note bodies, results, transcripts, prose, anything the user reads or writes | Chrome: buttons, labels, values, tools, connections, dialogs' controls |
| Typeface | **Open Sans**: humanist, warm | **JetBrains Mono**: engraved, precise |
| Casing | Sentence case, always | Caps for engraved micro-labels; sentence case at reading length |
| Color | Ink on paper | Ink structure + one accent doing focused work |
| Motion | Still: paper does not move on its own | Physical: lifts, settles, displaces with weight |
| Feels like | A page | A machined panel |

The boundary rule: **if the user could have typed it, it is paper; if the
machine put it there, it is instrument.** A note body is paper. The word
"RUN" on a button is engraved into the instrument. A result's markdown is
paper; the version chips above it are instrument.

This resolves the one thing PR #442's language could not do alone: an
all-mono instrument panel cannot carry reading-length prose. Open Sans is
not decoration: it is the paper material made legible.

## Who this is for, and what they're doing

Eido's user is thinking: sketching half-formed ideas, connecting them,
asking AI to transform them, and judging what came back. The design must
protect the *thinking*, which means:

1. **The canvas is quiet by default.** Chrome whispers; thoughts carry the
   color. The user's attention belongs to their own words.
2. **Five steps ahead.** Every affordance anticipates the next action:
   select a card → its actions appear; finish a connection → the pulse
   travels toward the consumer (showing what the connection *does*); a
   result lands → the paths onward (copy, note, follow up) are already at
   the foot. Never make the user hunt for the obvious next move.
3. **Consequence is visible.** Anything that changes what AI will do shows
   its consequence at the point of change: the Mod context popover showing
   its exact treatment and sentences, the Context peek, the chain preview. The
   instrument never hides its wiring.
4. **No instructions, ever.** Affordances are discovered through hover
   reveal, cursor semantics, consistent placement, and ghost affordances
   shaped like the thing they create. Copy explains *consequences*, not
   *mechanics*.

## The dials (google-labs convention, 1–10)

- **Creativity 4**: the system serves thought; it is confident, not loud.
- **Density 6**: instrument panels are dense but never crowded; generous
  even spacing between dense clusters.
- **Variance 2**: the user's content supplies all the variance; chrome is
  ruthlessly consistent. Learn it once, know it everywhere.
- **Motion 4**: brief, mechanical, caused. Nothing moves that a hand (or a
  run) didn't move.

## Experience principles

1. **Identity top-left, actions top-right, value at the bottom.** On every
   card, panel, and control. Identity (the kind dot, the title) is
   persistent; actions are hover-revealed chrome; state/value reads at the
   foot. (PR #442's placement grammar, applied app-wide.)
2. **Controls carry a picture of their own value.** A connection's line IS
   its strength and polarity; a slider's fill IS its position; a version
   chip row IS the history. Readouts confirm; drawings inform.
3. **One accent doing focused work.** System green means exactly:
   selection, primary action, "helps". Warm red means exactly: avoid,
   destructive. Purple = Mod, blue = conversation, yellow = "needs your
   eye" (source changed, stopped early). A hue never moonlights.
4. **Depth is stated by value, never by resting shadows.** The warm-gray
   surface ladder does the work. The one sanctioned shadow is worn only
   while something is lifted or floating.
5. **State changes color, never geometry.** Selection, focus, hover, and
   editing recolor and re-border; they never resize, reflow, or shift.
6. **Refusal by silence.** Invalid targets don't highlight; disallowed
   actions don't appear. No error flashes for things the user can't do.
7. **Progressive disclosure by intent.** Rest → hover → selection →
   editing, each revealing one more ring of affordance. Popovers before
   panels before modals; a modal only when the decision must block.
8. **Escalate honestly.** Errors that happen (a failed run) speak plainly
   at the point of failure with a next step. No toasts for local events.

## Hard bans (the anti-slop list)

Adopted from the instrument-flat refusals + google-labs anti-patterns:

- No glass: no `backdrop-filter`, no translucent panels, no frosted blur.
- No resting shadows; no glows, ever.
- No gradients as shading (flat-color constructions only: hard-stop caps,
  dot-matrix stamps).
- No pure black, no pure white, no cool grays. One warm-gray family.
- No emojis in UI. No unicode-glyph icons: Lucide strokes only.
- No instructional copy ("click here to…", "drag to…") outside first-use
  one-liners that already exist.
- No AI-cliché copy: elevate, seamless, unleash, powerful, magic.
- No Title Case. Sentence case for words; caps only for engraved mono
  micro-labels.
- No spinners; progress is stated in words ("Running…") with the one
  sanctioned pulse, or shown as skeleton paper.
- No color as the only channel for meaning (pair with symbol, line
  character, or words: the connection grammar already does this).
- Nothing animates longer than 400ms except the camera.
- No new fonts, radii, shadows, or hues outside the token sheet.

## What this system deliberately is not

- **Not a filter-inverted dark theme.** Instrument-flat has designed Light
  and Dark semantic values; identity colors remain data, and the night
  palette changes meanings rather than applying a global visual effect.
- **Not a behavior grab bag.** Existing interaction contracts
  (first-click-selects, hit==paint, band crossfades, one-commit gestures,
  store-owned edge state) stay preserved unless a function change is
  explicitly approved in `PROPOSALS.md`.
- **Not the Mod prototype grid.** The prototype's 72px dealer pitch does not
  transfer; the app canvas keeps free placement. What generalizes is the
  token sheet, the two-voice rule, the surface ladder, the motion charter,
  and the placement grammar.

## Deliverables

1. `SYSTEM.md`, the complete spec: tokens, type, color (UI + user
   palettes), motion, components, states, copy, disclosure rules.
2. `docs/design/design-system/eido-design-system.html`: standalone,
   file://-safe living reference of every key Eido surface in the new
   language (its token region is generated from `src/ui/tokens.ts`).
3. `IMPLEMENTATION.md`: the migration plan.
4. `PROPOSALS.md`: function changes for approval, quarantined.
