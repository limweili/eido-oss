# Eido design system · full specification

Status: canon. There is one design system and it is this one; it carries no
version number, because a versioned system invites a second one to exist
beside it. Reads with `BRIEF.md` (the taste anchor). Values here are
normative prose; the machine source of truth for every token value is
`src/ui/tokens.ts`, which generates the app's CSS, the canvas painter
palettes, and the living reference's token region (`npm run design:sync`).
The living reference (`docs/design/design-system/eido-design-system.html`)
is the reference rendering **for chrome and component recipes**; canvas
surfaces (bands, crossfades, dense boards) are validated in the real app
at each migration slice's gate, never in the standalone gallery. Nothing in this spec changes behavior: see
`PROPOSALS.md` for the approved function-change scope.

Naming: CSS custom properties use the `--e-` prefix (Eido), three tiers:

1. **Primitive**: raw values, meaningless alone (`--e-gray-2`, `--e-space-4`).
   Never referenced by components. (In practice the primitive tier is this
   document's tables; the shipped CSS may inline primitives into semantic
   tokens to stay lean.)
2. **Semantic**: meaning, theme-aware (`--e-surface-card`, `--e-text-soft`,
   `--e-go`). The only tier components may consume. Dark theme swaps
   values here and nowhere else.
3. **Component**: scoped overrides only where a component must deviate
   (`--e-card-radius`). Keep thin; a fat component tier means tier 2 is wrong.

Instance-scoped derivations (`--identity-*`) are declared on the
identity-bearing element, never `:root` (they must resolve against the local
identity color).

---

## 1. Color

### 1.0 The color rules · components pick meanings, meanings pick colors

The mirror of §2.6: no component invents a color. Every piece of chrome
names a **meaning**; the token layer resolves it to the mode's value.
Everything in §1.1–§1.8 is these rules substantiated.

1. **Name the meaning, never the hex.** A control asks for `avoid`
   (`var(--e-avoid…)`), never `#bb4326`. That's why the same DELETE
   button is `#bb4326` by day and `#d77355` at night without one line of
   its code changing: dark mode retunes tokens, never components.
2. **Four families, never mixed.** Ink & paper (neutrals: depth and
   reading), functional (go / avoid / mod / convo / attention: what the
   UI *means*), brand (green / blue / amber: what Eido sounds like),
   user identity (12: what the user owns). A color from one family never
   does another family's job.
3. **A hue never moonlights.** One meaning per hue, one hue per meaning.
4. **One meaning, four forms: each form has one job.**
   | Form | Job |
   |---|---|
   | dot | the smallest signal: status dots, ticks, pulse |
   | `-ink` twin | the only form that carries words: colored text and interactive borders |
   | wash | ground under a notice, always derived (§1.3), never hand-picked |
   | solid | the act itself: fill on the one instrument that performs it |
5. **Words never touch a raw solid hue.** Text is ink/ink-soft on paper,
   the `-ink` twin on washes and outlines, `--e-on-solid` on solid fills.
   (Attention is the standing exception: always ink text.)
6. **Solids are rationed.** Loudness rises dot → ink twin → wash → solid,
   one step at a time. One green primary per surface, so a card foot, a
   modal footer and the dock each get one and no surface gets two; avoid
   solid only inside a confirm; a surface at rest earns at most one
   functional accent.
7. **Color is the last lever.** Hierarchy spends voice → weight → color →
   size (§2.5); if color is doing the first job, the surface is
   under-designed. Color never carries a signal alone: a symbol, word,
   or line style always rides along.

### 1.1 The surface ladder (one warm grey family)

Depth is stated by value. Recessed things are darker than their host;
floating things are lighter. No resting shadows anywhere on the ladder.

| Token | Value | Role |
|---|---|---|
| `--e-surface-recessed` | `#dcd7cc` | tracks, wells, scrub troughs, pre blocks' deepest tier |
| `--e-surface-ground` | `#e8e4dc` | the canvas board: the world's floor |
| `--e-surface-panel` | `#f1eee8` | chrome panels: top bar, dock, side panels, modal bodies |
| `--e-surface-card` | `#f8f6f1` | cards: paper riding above the board |
| `--e-surface-floating` | `#fcfaf6` | popovers, menus, tooltips-on-paper: the highest step |
| `--e-surface-field` | `#e9e5dd` | content wells: code blocks, skeletons, your chat bubble |
| `--e-field-bg` | `#fcfaf6` | inputs, textareas, pickers: the brightest paper, at rest and in focus alike |
| `--e-field-hover` | `#e9e5dd` | the input hover dip: one step down, then back |

Rules:
- A surface may only sit on a surface at least one step below it.
- The board dot grid: `radial-gradient(circle 1px at 1px 1px, rgba(35,32,25,.11) 98%, transparent)`
  at `22px 22px` on ground (keeps the current 22px pitch; ink dots replace
  the current cool `#e0dccf` dots).
- Modals sit on a dim veil `rgba(35,32,25,.32)` (kept from current app).

### 1.2 The ink ladder

| Token | Value | Contrast (worst surface) | Role |
|---|---|---|---|
| `--e-ink` | `#232019` | 11.3:1 | primary text, icons, structure, handles |
| `--e-ink-soft` | `#5f594c` | 4.85:1 | secondary text, labels, **placeholders** |
| `--e-ink-faint` | `#847d70` | 2.6:1 | decoration only: disabled and locked controls, dot textures, ghost affordances, never information (a locked control's fact lives in its accessible name and tooltip, §7) |
| `--e-line` | `rgba(35,32,25,.16)` | - | hairlines: dividers, non-interactive borders |
| `--e-line-strong` | `rgba(35,32,25,.52)` | 3.07:1 | interactive borders: fields, popover edges |
| `--e-dot` | `rgba(35,32,25,.26)` | - | detent dots, ticks, board texture accents |

Hard rule: anything the user must *read* uses ink or ink-soft. Faint is
never the only carrier of information. That rule reaches past text: a numeral
that states order, a grip that says draggable and a chevron that says
expandable are all information, so they take ink-soft, not faint. Faint keeps
what it was written for: spent keys, dot textures and ghost frames.

`--e-line-strong` is a boundary, not decoration, so it answers to the 3:1 floor
in §11 rather than to taste. At `.28` it measured 1.73 to 1.80:1 across the
daylight ladder, under the floor and under the night value that had already
been rejected for exactly this. `.52` puts daylight at 3.07 to 3.36:1, the same
band the night ladder holds at `.44`. One rule, both themes. `--e-line` stays
at `.16`: it divides, it does not bound.

### 1.3 Functional colors (each hue is one semantic family)

Every functional hue is a pair: the `solid` (fills, strokes) and an
`-ink` twin (text on washes and light surfaces), the naming pattern a
future dark theme extends without renames.

| Hue | Solid | -ink twin | Means exactly |
|---|---|---|---|
| go | `#2f6f5e` | `#2b6656` | selection, primary action, "Helps", focus ring, kept |
| avoid | `#bb4326` | `#9f3b21` | "Avoid" connections, destructive actions, failures |
| mod | `#6a4fb0` | `#664ca9` | Mod kind + `modifies` connections |
| convo | `#3466c2` | `#2f5cb0` | Conversation kind, streaming voice |
| attention | `#e9a820` | `#805b06` | "needs your eye": source changed, stopped early, conflicts: the solid is **fill only**, always under ink text (7.8:1) |

The twin is a real second lightness. go and mod used to be the *same hex* as
their solids, which made "two lightnesses" a claim with no measurement behind
it, and on the 20% selected wash the family read 4.15 to 4.44:1, under 4.5.
Each twin now steps down by the smallest uniform sRGB scale that clears 4.5 on
both the 12% and the 20% wash and on every surface where functional text is
allowed (4.61 to 6.45:1). Hue and chroma ratios are untouched; only lightness
moved.

- Washes are derived, never hand-picked:
  `color-mix(in srgb, <solid> 12%, var(--e-wash-base))`: 12% at rest, 20%
  selected/active; **attention alone uses 18%** (the deepest wash its ink
  twin still passes on). `--e-wash-base` defaults to the card surface.
- Text on washes always uses the `-ink` twin.
- `--e-on-solid: #f8f6f1` is the text on go/avoid/mod/convo/ink solids
  (all ≥ 4.6:1): a semantic token, never an alias of a surface, so dark
  can't silently break it. Ink text on attention (yellow never carries
  paper text).
- Functional-color text never sits on `--e-surface-recessed` (go there is
  4.12:1); recessed hosts values in plain ink only.
- Completion is a fact, not a call to action: "Done" / "Up to date" read
  in ink-soft, not green.
- `--e-agent-unadopted-accent` is the named role for AI-created Card work
  that the user has not yet reshaped. It reuses the attention-ink value
  (this work still needs the user's eye) and recolours the head hairline. A
  user edit removes the role; it does not change the Card's durable creator.
  **Open, and deliberately so:** the hairline was dashed as well, which gave
  the state a second channel. The dash was retired because a dashed line
  under a Card title reads as an editable field, and an editable field is
  what the title actually is (§6.1a). Until the state gets a non-colour
  channel back, it is the one signal in the system riding hue alone. The
  candidate is the §6.10c attention mark, which already means "needs your
  eye" and already carries its own words; minting it here is a function
  change and needs the founder's call, not a designer's.

**Minting a new functional hue** (e.g. a future "voice" kind) is a
checklist: solid + `-ink` twin (≥4.5:1 on card and ground) + the wash
formula + a row in this table + a second channel (symbol, line character,
or words) + the moonlighting check (no existing hue already means it).

### 1.4 Brand palette (the product's own voice)

Three namespaces never mix: **functional** (§1.3, UI meaning), **brand**
(here), and the **user identity palette** (§1.5, the color well). Brand
colors appear in brand moments (the wordmark, onboarding, empty-state
accents, Mod compiler cards, marketing) and never carry UI semantics or
enter the user's picker.

| Token | Value | Role |
|---|---|---|
| `--e-brand-green` | `#2f6f5e` | the core: the one hue that is both brand and go |
| `--e-brand-blue` | `#3568c6` | counterpoint. Brand solids carry text, so each brand hue clears 4.5:1 with `--e-on-solid`; `#3f78df` measured 3.92 and was the last failing text pair in daylight. `#3568c6` is the identity palette's own blue, so the fix mints no new hue. |
| `--e-brand-amber` | `#eca23b` | warm counterpoint (ink text) |

Brand moments may use the bold solid-card recipe (eyebrow + value pill +
mono sentence on a solid brand ground: the PR #442 card anatomy).

### 1.5 User identity palette (what the user may pick for cards)

Twelve identities. Each is a set, not a hex: `{solid, on-solid, tint}`.
Four fill modes: none · soft (12% head wash) · body (solid head, 50% body
tint) · **pattern** (the section hatch: fine 45° hairlines of the
identity across the body, the way a technical drawing hatches a cut
material: 1px lines on an 8px pitch at 20% identity, while the head stays
a clear label plate with the soft 10% wash. Texture never sits under the
title; at far zoom the hatch settles into a light tint and still reads).
The picker shows solids; fill modes derive from the set. The forward
palette uses these hue identities; six values are retuned for contrast and
warm-paper harmony (marked ●). On-solid is now **assigned per identity**.

| Identity | Solid | On-solid | Notes |
|---|---|---|---|
| Coral | `#f1666d` | ink | value kept; on-color corrected (old luma picked paper, 2.8:1) |
| Red | `#c9282e` ● | paper | deepened from `#d72e35` (4.49→5.08) |
| Amber | `#eca23b` | ink | |
| Orange | `#b5540f` ● | paper | deepened from `#d76519` |
| Mint | `#65b563` | ink | |
| Green | `#1b7550` ● | paper | deepened from `#24986a` |
| Sky | `#48a2ef` | ink | |
| Blue | `#3568c6` ● | paper | deepened from `#3f78df` (4.7:1 with paper text) |
| Orchid | `#d66be8` | ink | |
| Purple | `#9c3fba` ● | paper | deepened from `#a946c8` (4.42→5.07) |
| Slate | `#8b939c` | ink | the one cool voice: user data may be cool; chrome never is |
| Charcoal | `#2e2b25` ● | paper | warmed from `#222222` |

- `tint = color-mix(in srgb, solid 12%, var(--e-surface-card))` (soft fill
  mode); body-fill mode = `color-mix(in srgb, solid 50%, var(--e-surface-card))`
  with the assigned on-solid for the header (current fill-mode behavior kept).
- Previously saved custom colors remain supported. Their on-color starts
  from the approved warm ink/paper roles; if a mid-gap color makes both
  roles miss AA, the resolver tightens the nearer role toward its
  black/white endpoint only as far as the first 8-bit color that reaches
  4.5:1. The identity solid itself is not altered. The picker itself offers
  only the twelve approved identities.
- Body-fill text resolves against the exact 50% sRGB tint in each theme.
  Primary, soft, go, avoid, mod, convo, and attention foregrounds start
  from that theme's semantic token roles; a passing readable role is
  retained exactly and a failing role is minimally tightened toward black
  or white. Faint remains the unmodified decoration-only theme role from
  §1.2 and never carries readable text. The results are component-owned
  `--identity-body-*` foregrounds. A card never redefines `--e-*`, and
  controls/washes with their own surface keep their normal semantic
  foreground roles.
- User colors carry no system meaning; system meaning always adds a second
  channel (symbol, line character, words).
- Every colour-choice surface uses the shared ColourPicker in §6.2c; a
  surface supplies domain-owned values and labels but never rebuilds the
  swatch geometry, selection state, focus behavior, or keyboard contract.
  The card color well lays the twelve out **column-major in a 6×2 grid**. Each
  related light/dark pair stacks in one column, ordered left to right as
  Coral/Red, Amber/Orange, Mint/Green, Sky/Blue, Orchid/Purple, then the
  neutral Slate/Charcoal pair. The four fill modes form a 2×2 block before
  the divider and color well. Fill-mode controls and identity swatches are
  matching 18px circles; the picked mode and identity each wear a 1.5px ink
  circle offset 2px from the control. Identity swatches have accessible names
  but no hover or keyboard tooltip; the four fill modes retain their
  explanatory tooltips.
- The palette policy is forward-only (PROPOSALS P5). The accepted input is
  an opaque six-digit hex from the palette or a previously saved custom
  value. Unsupported legacy shapes and invalid values render through the
  safe default identity without mutating or writing back to the save. Live
  and playback cards share the same resolver. This work neither migrates
  historical colors nor promises to preserve an old palette.

### 1.6 Highlight palette

The ten highlight tags are theme token pairs `{wash, dot}`
(`--e-hl-<name>`, `--e-hl-<name>-dot`); text on a wash is always
`--e-ink`. In light mode the washes keep their current light values
(contrast-safe under dark ink by construction); active-tag chrome pairs
the swatch with the tag name so color is never the only identifier. The tag
chooser uses the shared ColourPicker (§6.2c): the ten dots form a
column-major 5×2 well, with accessible tag names and no colour tooltip.

**In dark mode the wash deepens instead of staying light** (the way
editors highlight on dark surfaces): each tag gets a saturated
night-tone wash (~L 30%) in the same hue family, retuned to the
instrument's warmth, and the ink, now paper-white, reads on top; dots
brighten so the tag stays legible. All dark washes clear 7:1 under
`--e-ink`. A highlighted phrase reads as a colored band in the page, not
a light strip glaring out of it.

**The daylight dot is reinforcement, not the identifier, and that is a
decision.** Measured against its own wash, the ten light dots run 1.56 to
2.68:1; the ten dark dots run 3.45 to 5.30:1. Raising the light dots to 3:1
costs the palette its character (yellow lands near olive) and *narrows* the
worst hue separation between two dots, so it trades a real loss for a
theoretical gain. It is allowed to stand because the dot is never alone: the
wash is the identity, the dot repeats it, and the tag carries its name in
words. §11's "meaning never rides color alone" is satisfied by the name. Anyone
proposing to make the dot the sole identifier must fix the ratios first.

### 1.7 Dark mode · the instrument at night

Designed from the ground up, not inverted. Requested by weili in review
(2026-07-16); the living reference toggles live from its nav. Four principles:

1. **Warm graphite, never blue-black.** The night is anchored on the card
   surface, the material everything reads on, and every other shade is derived
   from that anchor. The anchor is `#2b2725` (weili approved `#282828` on
   2026-08-11; the value was warmed to `#2b2725` on 2026-08-11, a shift of
   dE*ab 2.43, roughly one just-noticeable step). The reason is §1.1's own
   title: **one** warm grey family, not a warm one by day and a neutral one at
   night. Light carries a* ~ +1 / b* ~ +2.5 and dark ink is warm paper
   (`#ece7db`), so a neutral ladder underneath warm ink was the only cold thing
   in the product. Night now runs a* ~ +0.9 / b* ~ +2.2, inside light's own
   range. To revert to neutral graphite, substitute `#161616` / `#1b1b1b` /
   `#1e1e1e` / `#232323` / `#282828` / `#343434` at identical L*.

   **The ladder does not merely survive; it mirrors.** Dark does not invent its
   own order. Each surface keeps the rung it holds by day, so both themes step
   recessed < ground < field < panel < card < floating. Before this, `panel` and
   `card` swapped places at night: a card inside a panel read as paper by day
   and as a recessed well after dark, so the same component changed meaning with
   the theme. Adjacency contrast now tracks light within a few hundredths
   (field-on-card 1.120 vs 1.163, card-on-ground 1.158 vs 1.174, card-on-panel
   1.070 vs 1.072). Only `floating` steps further at night (+6.0 L* against
   light's +1.4), because the lift shadow that separates it by day does almost
   no work against a dark ground.
2. **Ink becomes paper.** Text flips to warm off-white; ink-solid chrome
   (tooltips, pressed keys, active menu rows, the segmented pick) flips
   to paper labels: lit signs in the dark.
3. **Solids brighten one step and wear night text.** Go/avoid/mod/convo
   lift toward the lamp; `--e-on-solid` becomes near-black night: words
   are cut into the solid, not printed white on it. Amber already glows
   and keeps its ink (`--e-ink-on-bright`, the one token identical in
   both modes). Functional *text* always rides the `-ink` twins
   (danger labels, running/failed states, prose links): the twins are
   the text-safe voice in both modes; raw solids are fills and lines.
4. **Light replaces shadow.** Elevation is stated by the lighter surface
   and a stronger hairline; the one lift shadow deepens
   (`rgba(10,8,6,.44/.58)`) but structure never depends on it.

| Token | Light | Dark |
|---|---|---|
| `--e-surface-recessed` | `#dcd7cc` | `#181512` |
| `--e-surface-ground` | `#e8e4dc` | `#1e1b19` |
| `--e-surface-field` | `#e9e5dd` | `#211e1c` |
| `--e-surface-panel` | `#f1eee8` | `#25221f` |
| `--e-surface-card` | `#f8f6f1` | `#2b2725` **(the anchor)** |
| `--e-surface-floating` | `#fcfaf6` | `#383432` |
| `--e-field-bg` / `-hover` | `#fcfaf6` / `#e9e5dd` | `#211e1c` / `#262321`. By day inputs are the brightest paper and hover dips; at night they stay recessed and hover lifts |
| `--e-ink` / soft / faint | `#232019` / `#5f594c` / `#847d70` | `#ece7db` / `#b8b0a0` / `#8b8375` |
| `--e-line` / strong | ink at .16 / **.52** | paper-ink at .15 / **.44**. Both themes now measure 3.1 to 3.8:1 on this boundary. Daylight was the worse of the two at .28 (1.73 to 1.80:1) and was fixed second |
| `--e-go` / `-ink` | `#2f6f5e` / `#2b6656` | `#4d9d84` / `#7fc4ab` |
| `--e-avoid` / `-ink` | `#bb4326` / `#9f3b21` | `#d77355` / `#ec9f85`. Avoid was the weakest functional voice at night (4.06:1 on card); it now sits at go's own lightness |
| `--e-mod` / `-ink` | `#6a4fb0` / `#664ca9` | `#a68ae0` / `#bfa8ee` |
| `--e-convo` / `-ink` | `#3466c2` / `#2f5cb0` | `#6d97e8` / `#93b4f0` |
| `--e-attention` / `-ink` | `#e9a820` / `#805b06` | `#e9a820` / `#e3b458` |
| `--e-agent-unadopted-accent` | `#805b06` | `#e3b458` |
| `--e-on-solid` | `#f8f6f1` | `#1d1a18`. Semantic, so it does **not** follow ground |
| `--e-veil` / deep | ink at .32 / .78 | `rgba(20,17,12,.55)` / `.85`. Warm near-black; pure black is banned |
| `--e-brand-green` / blue / amber | `#2f6f5e` / `#3568c6` / `#eca23b` | `#4d9d84` / `#6f9ce8` / `#eca23b` |

All dark text pairs re-verified ≥ 4.5:1 on the graphite ladder (soft ink
and every functional `-ink` twin on card; every solid against night text).
Washes, tints, and hatches derive automatically: every recipe is
a `color-mix` against surface tokens, so the same rules recolor
themselves. User identity solids are data and do not change; the darkest
identities (charcoal) rely on the swatch hairline in the picker. Painted
canvas palettes (Overview/Map) take night values from the same token
module. The effective Light/Dark theme is passed explicitly to every live
and playback Board so DOM chrome and canvas painting cannot diverge
(IMPLEMENTATION slice 05; P7).

### 1.8 Grain · the ceremonial register (textured color)

Requested by weili (2026-07-16, with riso/grain references). A second
register of color for the few moments that deserve ceremony: flat brand
fields with soft hue bleeds under a printed grain. Everything stays flat:
the grain is what the color is *made of* (riso ink, spray, print),
never light falling on it.

The recipe: four flat layers, in order:

1. **One flat brand field.** Green, blue, amber, or paper. Never a user
   color, never a functional hue: ceremony speaks in the brand's voice.
2. **At most two soft bleeds.** Large off-center radial washes of the
   neighbouring brand hues, like ink soaking into the sheet.
3. **The grain.** One monochrome fractal noise (SVG `feTurbulence`,
   `fractalNoise`, baseFrequency ~0.8), overlay-blended at ~50%. The
   same grain texture everywhere: one material, not a texture library.
   It never animates.
4. **One flat thing on top.** A glyph or a line of type on its own
   layer above the grain: text is never textured itself.

Where it's allowed: onboarding, empty states, Idea gallery covers,
milestone moments (a playback finishing), brand cards. **Never on
working chrome**: buttons, cards, fields, menus, and anything the user
operates stay clean; and at most one textured surface is visible at a
time. Scarcity is the whole trick: the register reads as ceremony only
because the instrument around it is plain.

Reference classes in the living reference: `.e-grain` (noise layer + z-order
contract) with `.field-green` / `.field-paper` soft-field recipes.

---

## 2. Typography · two voices

### 2.1 Faces

- **Instrument voice: JetBrains Mono** (400 / 500 / 700), self-hosted.
  `font-feature-settings: "calt" 0` everywhere (no code ligatures in UI);
  `font-variant-numeric: tabular-nums` is inherent: all live-updating
  numbers use this face.
- **Paper voice: Open Sans** (400 / 600 / 700 + italic 400), self-hosted.
  Italic exists only in the paper voice (mono italic reads as code comments).
- Fallbacks: `ui-monospace, "SF Mono", Menlo, Consolas, monospace` and
  `system-ui, "Segoe UI", Helvetica, Arial, sans-serif`.

Optical size compensation: JetBrains Mono runs wide with a tall x-height;
set it 1–2px smaller than adjacent Open Sans for equal optical weight.
The scales below already encode this.

**The floor is 11px.** Nothing readable renders below it, in either voice.
Small things get *quieter*, not smaller. Below the title line, caps,
tracking, and soft/faint ink do the de-emphasis work, never point size.
(Single-glyph marks like the connection pill's `+ − ~` are glyphs, not
text, and sit outside the floor.)

### 2.2 Instrument scale (JetBrains Mono)

| Token | Size/leading | Weight | Case/tracking | Use |
|---|---|---|---|---|
| `--e-type-micro` | 11/1.2 | 500 | caps, +0.08em | eyebrows ("WHAT SHOULD AI DO?"), badges, scope chips, never interactive |
| `--e-type-label` | 12/1.2 | 500 | caps, +0.06em | engraved verbs on chrome: RUN, COPY, CONTEXT; tab labels; tool names |
| `--e-type-ui` | 13/1.4 | 400 | sentence | menu items, hints, meta lines, popover fields: machine phrases at length |
| `--e-type-value` | 13/1.2 (12 compact in card feet, chips, badges) | 500 | tabular | readouts, counts, versions (v1 v2), times, coordinates |
| `--e-type-title` | 14/1.35 | 500 | sentence | card titles, panel titles, modal section heads |
| `--e-type-display` | 16/1.3 | 700 | sentence | modal h2s, the brand word "Eido" |
| `--e-type-title-canvas` | 24/1.3 (fitted 11-200 on a drawn Title card) | 700 | sentence | Title cards, the canvas landmark size. Backed by `--e-fs-title-canvas`; before that token existed every consumer hardcoded `24px`. A Title card carrying an explicit box sizes its type to that box instead of to the step, inside the bounds named by `TITLE_CARD_TYPE_METRICS` in `src/canvas/cards/titleCardFontFit.ts` (see the fitted-landmark rule below); 24 stays the resting size for one that carries no box |

**The fitted landmark.** The Title card is the one role whose size the
founder authors directly: it is a label drawn at a size, so its type fills
the box it was drawn at and shrinks to stay inside a box it outgrew. The
fit is the largest whole pixel size whose wrapped text still fits the
card's inner box, clamped to 11px (the §2.1 floor) and 200px. Leading stays
the 1.3 ratio at every fitted size, so a banner-sized label keeps the same
proportions as a small one. Words stay whole: a size that would split a word
is rejected, and mid-word breaking survives only as the floor's safety net.
This is a box rule, not a new ladder step: no other role fits, and the Title
card takes no other size. It follows that a Title card has no low-detail
stand-in either: zoomed out, the canvas painter draws the same fitted type at
board scale rather than a card shape with a fixed-size name.

Caps rule: caps only for engraved labels of one or two words (measure in
characters for i18n: ≤12 chars engraved; longer localizations drop to
sentence case automatically). Any machine phrase longer than that is
`--e-type-ui` sentence case (caps at length is shouting). **Sanctioned
exceptions:** card eyebrows are engraved questions ("WHAT SHOULD AI DO?"):
micro caps at any length, never interactive; and tooltips: instrument
labels in the ink pill, always caps regardless of length (§6.7).

**The tracking ladder.** Four steps, picked by case and size, never by feel:

| Token | Value | Who rides it |
|---|---|---|
| `--e-tracking-caps-s` | `.08em` | micro caps (11px): the smallest caps need the most air |
| `--e-tracking-caps` | `.06em` | label caps (12px): engraved verbs, tool names, field labels |
| `--e-tracking-mono` | `.04em` | mono in sentence case: values, meta lines, swatch names |
| `--e-tracking-display` | `.02em` | mono at display and canvas-title size, because tracking that helps at 11px shouts at 24px |

Prose takes no tracking at all, and nothing sits between the steps. This was
the last unnamed axis in the system: eight distinct values were in use before
it was written down.

The type tier is delivered as classes (`.t-micro`, `.t-label`, …), not
custom properties: governance greps for class usage.

### 2.3 Paper scale (Open Sans)

| Token | Size/leading | Use |
|---|---|---|
| `--e-prose-s` | 14/1.55 | note "Small", result excerpts, thread bubbles |
| `--e-prose-m` | 15/1.6 | note "Medium" (default), results, transcripts |
| `--e-prose-l` | 18/1.6 | note "Large" |
| `--e-prose-hint` | 13/1.5 | conversational helper copy (settings hints, empty-state bodies) |

Measure: card widths already bound prose to a comfortable measure; panels
cap prose at 65ch.

**The editorial ladder** (`--e-fs-editorial-*`) is the fifth scale and the
only one fenced off by surface rather than by role. Four steps for headings,
34 / 26 / 20 / 16, roughly 1.3 apart, plus an 18/1.5 lede that is body copy
under a title and not a fifth step. It is for surfaces a person **reads**:
this reference, onboarding, empty boards, milestones. It is forbidden in
working chrome, where a 26px heading inside a dock or a panel is exactly the
failure the fence exists to stop. Headings tighten as they grow (1.1 at 34,
1.35 at 16), because a leading that opens up a paragraph leaves a hole
between two lines of a title.

### 2.4 Prose (markdown) hierarchy · inside notes, results, transcripts

Scaled relative to the card's prose size (`1em` = the card's base):

| Element | Spec |
|---|---|
| h1 | 1.30em / 600 / 1.3 leading, 1em space above, 0.4em below |
| h2 | 1.15em / 600, 1em above, 0.4em below |
| h3 | 1.0em / 700, 0.9em above, 0.4em below |
| bold / italic | 600 / italic (paper voice only) |
| list | 1.4em indent, `–` markers for ul (print voice), tabular numbers for ol |
| blockquote | 2px `--e-line-strong` left rule, 0.75em indent, ink-soft |
| inline code | JetBrains Mono 0.85em on `--e-surface-field`, radius 4, padding 0.1em 0.35em |
| code block | JetBrains Mono 0.85em/1.5 on `--e-surface-field`, radius 6, padding 10px 12px |
| table | hairline `--e-line` rules, header row 600 + `--e-surface-field` |
| link | `--e-go`, underline `text-underline-offset: 2px`; hover: darker via `color-mix` |
| strikethrough | `del` in ink-faint, matching strike color: struck thoughts recede, they don't shout |
| task list | 13px square check box (radius 4, hairline); done = solid go + on-solid check, text drops to ink-soft (no strike, the box already says it) |
| hr | 1px `--e-line` |

The passive markdown render and the rich editor share this sheet: the
geometry contract (invariant: selecting a card must not reflow it) makes
one stylesheet mandatory, not optional. The full vocabulary is specimened
in the living reference's type section; anything the editor can emit must appear
there before it ships.

Links keep that exact underline, color, text metrics, and position in both
states. A passive link activates normally. In the editor, pasting a direct URL
over selected prose wraps that prose as a link; selecting a link opens a compact
floating preview with open, edit, and remove actions. Editing exposes only
the destination and uses the §6.6 floating-surface recipe; it never enters
document flow or changes Card geometry.

### 2.5 How information travels · the hierarchy rules

These decide every surface's reading order; components apply them, they
never re-derive them per card.

1. **Hierarchy is voice → weight → color → size, in that order.** A title
   differs from its body by switching voice (mono over sans) before it
   differs by size. Adjacent roles stay within one ladder step: big jumps
   are reserved for the canvas Title card.
2. **Top to bottom: eyebrow → title → body → meta.** Each step down loses
   exactly one of {weight, size, ink}, never two at once, so no line falls
   off a cliff.
3. **Left to right: identity → name → status.** The leftmost slot carries
   what something *is* (kind dot, rank, glyph), the middle its name, the
   right edge its state: the same reading order on card heads, context
   rows, list rows, and the dock.
4. **A label belongs to what it labels.** Air above a heading ≥ 2× the gap
   below it; eyebrows sit 8px above their content and ≥ 12px below what
   precedes them.
5. **One left rail per surface.** Every text block inside a card starts on
   the same 14px inset; modals use 20px; plates 24px. Indentation is
   reserved for quoted or nested content.

### 2.6 Components pick roles, roles pick sizes

No component invents a size, weight, or tracking. Every piece of text
declares a **role**, and the role resolves to exactly one recipe from §2.2.
If a component seems to need a new size, the fix is choosing a different
role, or cutting the text, never a local `font-size`.

| The text is… | Role | Recipe |
|---|---|---|
| an eyebrow, badge, scope chip, never interactive | **micro** | mono caps 11px, widest tracking |
| an engraved verb: button, tab, tool name, field label | **label** | mono caps 12px, wide tracking |
| a machine sentence: menu row, status line, toast, link | **ui** | mono sentence 13px |
| a reading value: count, timestamp, version, model id | **value** | mono tabular 13px (12 compact) |
| a surface's name (card title, panel title) | **title** | mono medium 14px |
| the one headline on a screen or empty state | **display** | mono bold 16px |
| the user's or the AI's words | **prose** | sans 14/15/18 |
| an aside that may be skipped | **hint** | sans 13px, soft ink (`--e-prose-hint`) |

**Buttons speak one voice.** Every capsule button is an **engraved verb**:
one or two words, label recipe (`RUN`, `CANCEL`, `DETAILS`). If the
action seems to need a sentence, the sentence goes in the surface's body
or hint and the button stays a verb; machine phrases (ui recipe) have
their own homes: menu rows, links, status lines, toasts. There is no
second voice on a capsule: `.sm` and dense placements shrink the
capsule's padding, never the type. Between them, LABEL and UI dress every
control in the kit; nothing wears a third style.

### 2.7 The group heading

A heading that names a group of rows is not one of those rows. Set it smaller
and no heavier than the things it governs and it reads as the weakest item on
the panel instead of the break between two groups. One shape, everywhere a
group gets named: rail, list, panel, menu, modal.

| Part | Recipe |
|---|---|
| Type | mono caps at `--e-fs-micro`, **weight 700**. The one place micro is bold; micro is 500 everywhere else |
| Ink | `--e-ink-soft`. Weight does the ranking, so the heading outranks its rows without out-shouting them (§2.5 rule 1: voice, then weight, and colour later) |
| The break | a **hairline underlining the label, the full width of whatever it heads**. Not a rule beside the label: that is decoration, and its length is an accident of how long the word happens to be. Same shape at every scale, so a rail, a panel and a document all break the same way |
| Space | larger above than below, so the heading binds to the group it opens (§2.5 rule 4). The label clears its own underline by `--e-sp-1` at micro, `--e-sp-2` at the larger scale |
| Optional parts | **one** leading mark (a highlight's colour dot, a kind glyph) and **one** trailing aside at the far end of the same line, above the underline (a count, a switch). No third thing |

A group heading is never interactive, never wraps, and never carries a verb.
The same shape one scale up (title recipe, sentence case, same full-width
underline) heads a body that reads like a document rather than a list of
controls. Callout labels (§6.7a) take this recipe in a functional ink and no
underline: the tinted surface is already the break.

---

## 3. Space, shape, line, depth

### 3.1 Spacing

Scale: `4 / 8 / 12 / 16 / 24 / 32 / 48` governs **layout**: gaps,
margins, section rhythm. The named steps: 4 glyph↔glyph, 8 within a
cluster, 12 cluster↔cluster, 16 surface padding, 24 sections inside a
surface, 32/48 page regions.

**The ladder governs space between things, not space inside a control.**
Outer space (gaps, margins, stacking) comes off the seven steps. Inner
padding is whatever optically centres the content in the height the ladder
already assigned, so `7px 14px` inside a 36px card head is correct and not a
violation. The recipes are fixed and enumerated in the reference (§06
Sizing), thirteen of them, and a side panel body is not a modal body; do not
invent a fourteenth. The reference is the count, because it renders them.

Two ratios decide which step to reach for:

- **Proximity**: a label sits ≥ 2× closer to what it labels than to what
  precedes it (§2.5 rule 4).
- **Grouping**: space between groups ≥ 2× the space within one.
  Whitespace is the grouping tool; boxes and rules are the fallback when
  space alone can't carry it.

**Whitespace is a subtraction tool, not leftover.** When a surface feels
crowded, the first move is removing or demoting an element, never
compressing the gaps to fit more in. Empty space is what makes what
remains read as intentional: page regions breathe at 32/48, surfaces keep
their full padding even when content is short, and a control never
crowds the edge of its container. If everything can't fit at the scale's
spacing, the surface is holding too much.

**Where the token is required, and where the literal is correct.** The
distinction was assumed for a long time and never written down, so both halves
drifted. Page and surface layout answers to the ladder and names it: gaps,
margins and section rhythm in authored stylesheets use `var(--e-sp-*)`, because
rhythm retyped in three hundred places is not rhythm, it is a habit.
Component-internal insets stay literal: `5px 12px` on a button is drawn to the
glyph, and calling it `--e-sp-1` would claim a relationship that does not
exist. Arranging specimens inside a gallery plate follows the inset rule, not
the ladder, because a demo row is composition rather than page structure. If
you cannot say which of the two a number is, it is layout.

**Component-internal insets** may use 2px half-steps for optical centering
(a 26px button can't hold 8px vertical padding). The reference CSS is
normative for insets, and the reference's own §06 Sizing table is the
enumeration: buttons `2 12 0` at both 26 and 24, chips `1 9 0`, card head
`7×14` (36px min-height), card body `12–14 × 14`, menus `4×8` rows in a
6px popover, panels `16`, modals `20 × 20`. The vertical values are
top-heavy rather than symmetric because a caps mono label sits above its own
optical centre; the horizontal ones carry the letter-spacing correction from
§2.2, so the printed `12` is `12 - .03em` on the right and `12 + .03em` on
the left. Read the table, not this list, when the two disagree.

### 3.2 Radius · the two-tier rule

Surfaces are slightly-squared; instruments are round.

| Token | Value | Use |
|---|---|---|
| `--e-r-inner` | 4px | nested elements inside 6px-radius parents: menu rows, inline code, skeletons |
| `--e-r-chip` | 6px | buttons, fields, chips, thumbnails |
| `--e-r-card` | 8px | canvas cards, popovers |
| `--e-r-well` | 10px | panels, wells, dock |
| `--e-r-modal` | 12px | modals |
| capsule / circle | 999px / 50% | pills, toggles, handles, kind dots, swatches, sliders, the connection pill |

Never mix rounded and sharp corners in one view; never introduce another
radius. (1–2px marks like scrub ticks are marks, not surfaces.)

### 3.3 Borders

- Structure hairline: 1px `--e-line`.
- Interactive boundary: 1px `--e-line-strong` (fields) or 1px `--e-ink`
  (quiet buttons).
- Cards: 1px `--e-line-strong`.
- Focus/selection never changes border *width*: see states (§7).

### 3.4 Elevation & z

Depth = surface value. The one shadow:
`--e-shadow-lift: 0 2px 4px rgba(35,32,25,.08), 0 12px 30px rgba(35,32,25,.16)`,
worn only while lifted (dragging) or floating (popovers, menus, modals,
tooltips, the dock does NOT wear it; the dock rests).

Z scale (tokenized, no improvisation):
`--e-z-canvas-chrome: 6` (in-card chrome) · `--e-z-lifted: 30` ·
`--e-z-dock: 40` · `--e-z-panel: 45` (side panels) · `--e-z-popover: 60` ·
`--e-z-chrome-barrier: 70` (the top bar) · `--e-z-modal: 80` ·
`--e-z-toast: 90`.

The top bar is a hard barrier. No floating surface may paint across it: the
bar ranks above every popover-level surface, and a floating layer's world
starts at the bar's bottom edge (`--e-topbar-height`, read by
`useFloatingLayer`) rather than at the top of the document. Modals and toasts
stay above the barrier, because they legitimately cover the whole window.

The transformed canvas layer keeps its own private scale, which the ladder
above never reaches: React Flow gives every Card node the layer the Board
hands it, so a floating surface that must follow the canvas transform (the
connection editor) reads `--e-z-canvas-floating`, one step above the ceiling
every Card layer is capped at.

### 3.5 The height ladder

Every boxed instrument snaps to one of five heights. Two instruments in
the same row share a step; nothing invents a height between steps.

| Step | Height | Who rides it |
|---|---|---|
| field row | 30px | fields, textarea first-rows, pickers, buttons sitting beside a field (`field-mate`) |
| standard | 26px | buttons, segmented controls, compact pickers: the working capsule |
| compact | 24px | `.sm` buttons and every card-foot instrument (icon keys included) |
| inline | 22px | instruments embedded in another instrument's chrome: card-head actions, context-row keys |
| chip | 20px | passive labels: chips, badges, version pills, not controls |

Menu and list rows are not boxed instruments; they size from their type
plus 8px vertical padding (28px at ui size). A wash or callout sitting in
a control row wears the row's step so the line reads level.

---

## 4. Iconography

- **Lucide** (already shipped), stroke `1.75`, sizes `14 / 16 / 18`.
  Default 16. Icons inherit `currentColor`. One stroke width for all
  chrome: a heavier icon is not emphasis, it is a second icon family.
- Optical weight is matched by eye: a glyph is drawn ~2px smaller than a
  sibling wordmark of equal box so buttons read as equals.
- Icon-only buttons always carry a tooltip (instrument voice) and an
  `aria-label`.
- No unicode glyphs as icons. The sanctioned text glyphs that ARE
  vocabulary: the connection pill's `+ − ~` (polarity symbols, reused by the
  stepper's keys), version chips' `v1 v2`, and the menu check `✓` (a mark, not
  an icon).

---

## 5. Motion charter

Doctrine: things get picked up, displace their neighbors, and settle with
weight. Nothing fades vaguely; things move because a hand (or a run) moved
them. Paper never moves on its own.

| Token | Value | Use |
|---|---|---|
| `--e-t-fast` | 120ms | hover, press, chrome reveal, color shifts |
| `--e-t-exit` | 140ms | anything leaving (accelerate out, `--e-ease-in`) |
| `--e-t-move` | 220ms | displacement, settle, swap, toggle throw |
| `--e-t-camera` | 360ms | viewport flights (the connection settle keeps its own 260ms beat) |
| `--e-t-intent` | 600ms | tooltip intent delay: resting on a key must mean asking, not passing through |
| `--e-t-stream` | 1s | the one sanctioned perpetual pulse |
| `--e-t-fade` | 120ms | opacity-only fades (reduced motion caps this at 80ms) |
| `--e-t-move-far` | 320ms | displacements over ~120px: long moves land on `--e-ease-out`, no overshoot |
| `--e-ease-out` | `cubic-bezier(.25,.6,.25,1)` | standard decel (enters, moves) |
| `--e-ease-in` | `cubic-bezier(.5,0,.75,.4)` | exits only |
| `--e-ease-settle` | `cubic-bezier(.2,.75,.25,1.08)` | drops, landings, toggle throws |
| `--e-scale-press` | .97 | pressed buttons/pills |
| `--e-scale-lift` | 1.02 | dragged cards/tokens (+ `--e-shadow-lift`) |

Rules:
1. Enter decelerates, exit accelerates, exits run shorter (120–140ms).
2. **No layout-affecting animation.** Position/size move only via
   `transform`; visibility only via `opacity`. Paint-only color, border,
   and ring/shadow transitions are sanctioned (a selection ring is paint,
   not depth), but never `width`/`height`/`top`/`left`/margins.
3. The existing **connection beats are canon** (settle 260ms, pulse travel
   620ms +180ms delay, polarity crossfade 200ms): they already obey this
   charter and are kept to the frame.
4. Streaming is the one sanctioned perpetual motion (the pulsing dot),
   allowed only while work is genuinely in flight.
5. Menus/popovers enter with 4px rise + fade at `--e-t-fast`; exit fade
   only at `--e-t-exit`. Modals: veil fades, panel rises 8px + fades at
   `--e-t-move`.
6. **Exits are implemented, not implied**: an exiting element stays
   mounted until `animationend`; menus/popovers/toasts fade out at
   `--e-t-exit` (no reverse rise).
7. **Interrupted motion retargets from its current position.** CSS
   transitions do this natively; JS-driven beats must cancel via a run id
   and animate from the live value. A restart-from-zero is a bug.
8. **Distance scales the move**: `--e-t-move` + `--e-ease-settle`
   (overshoot) for moves ≤ ~80px; longer displacement uses
   `--e-t-move-far` + `--e-ease-out`: overshoot on long moves reads as
   jelly, not weight.
9. Hover reversal reuses the enter timing (hover-out is not an "exit").
10. `prefers-reduced-motion`: transform durations drop to **1ms, not
   0ms, so `animationend` still fires and beats retire** (the current
   app's own trick); opacity fades cap at 80ms via `--e-t-fade`; camera
   flights become jumps; the pulse dots hold still. One shared runtime
   motion mode drives both the document token override and every JS camera
   call; semantic playback timing remains unchanged.
11. Staggering is reserved, not yet sanctioned: no list stagger ships
   until a surface earns it.

Canon beats kept from the current app, with their exemptions:

| Beat | Value | Status |
|---|---|---|
| connection settle | 260ms overshoot-rebound on stroke-width | kept; SVG stroke-* gets a scoped exemption from the transform/opacity rule (connection + playback grammar only) |
| connection pulse | 620ms travel, +180ms delay, `cubic-bezier(.3,0,.4,1)`, dot fades in by 12% | kept to the frame |
| polarity flip | 200ms crossfade | kept |
| card fly-to | 360ms → `--e-t-camera` | kept |
| deep-link flash | 1.65s box-shadow ring | kept in behavior, **re-spec at migration** as an opacity ring overlay (box-shadow animation violates rule 2) |
| edge hover | opacity/stroke-width | retimed to `--e-t-fast`/`--e-t-exit` at migration |

---

## 6. Core controls (the instrument kit)

### 6.1 Buttons · one standard, five variants

Anatomy: `--e-r-chip` box, 26px on the height ladder (§3.5), JetBrains
Mono. One voice (§2.6): the engraved verb, label recipe, ≤2 words,
always. A longer thought moves to the surface's body or a menu row; it
never stretches the button.

| Variant | Recipe | Use |
|---|---|---|
| **primary** | solid `--e-go`, paper text; hover `color-mix(in srgb, var(--e-go) 88%, var(--e-ink))`; press scale .97 | THE next action, one per view: RUN, CREATE, DONE. Never in the bottom dock's persistent tool bar, which has no state to propose (§8.9); the dock's contextual tray may still carry go for a real proposed action such as Group selection |
| **quiet** | transparent, 1px `--e-ink` border, ink text; hover ink wash `rgba(35,32,25,.07)` | ordinary actions: Context, Duplicate, Close |
| **ghost** | no border, ink-soft text; hover ink wash + ink text | tertiary/inline verbs: DISMISS, RE-RUN ALL, SHOW TEXT |
| **danger** | transparent, 1px `--e-avoid` border, avoid text; hover avoid wash 10% | Delete, Remove connection |
| **danger-confirm** | solid `--e-avoid`, `--e-on-solid` text | the destructive key inside a confirm, and nowhere else. Counted separately because it is the one place a raw avoid solid is allowed to carry words, which makes it a variant with its own rule rather than a state of danger |

Variants also include `sm` (24px compact, for card feet). Icon buttons:
26×26 quiet box, 16px glyph; in card feet 24×24 with a 14px glyph.
**Hit expansion**: small chrome (icon keys, version chips, pills, kind
dots) keeps its visual size and gains an invisible inset −4px (or larger)
hit area: visual ≠ hit target. Toggled tools (dock) show
active state as solid ink fill + paper glyph (an engraved pressed key),
NOT green (green = go, not "current mode").

Buttons never change size between states; while running, the button
yields to a quiet CANCEL and the state word wears the pulse (§6.11).

### 6.2 Fields

`--e-field-bg` bg, 1px `--e-line-strong` border, radius 6,
`--e-type-ui` for machine values / paper voice for prose textareas.
**The fill never changes state**: rest and focus share `--e-field-bg`;
only hover dips to `--e-field-hover` (and returns). Focus: border →
`--e-go` plus the flush inset go ring from §7, `outline: none` (the
border IS the focus), caret `--e-go`.
Placeholder `--e-ink-soft`. State changes the boundary's color, never
the geometry, never the fill.

**On a floating host the field takes `--e-surface-field` instead.** By day
`--e-field-bg` and `--e-surface-floating` are the same value, so an input
inside a popover, a menu, a modal or a toast had only its border to prove it
existed. `--e-surface-field` is the rung named for this job and had no consumer
until now. The field stays a well on every host, which is what §1.1 already
requires: a surface sits on a surface at least one step below it. At night the
field is a well by default, so the rule changes nothing there.

### 6.2b Picker (replaces every native `<select>`)

The OS dropdown is foreign chrome; the picker is the designed replacement,
same semantics. Trigger = a field (same box, same states) with the current
value and a chevron that rotates 180° while open; menu = a floating
surface (§6.6) of option rows, the current one marked with a check at the
row's **right edge**: option text keeps one left rail and the row's
padding reads uniform on both sides. Open on click/Enter/Space; arrows
move; Escape and outside-pointerdown close; open trigger wears the field's
focus grammar (go border, fill unchanged). Long values ellipsize in the
trigger, never wrap.
(Used by four surfaces: Ask model, Conversation style, Group model, and
playback speed. The first three replace native `select` elements; playback moves from its current segmented control to the
approved compact Picker. Settings model choices remain radio option cards.)

### 6.2c ColourPicker (the one colour-choice module)

Every surface that lets a person choose a colour imports the shared
ColourPicker primitive. Palettes remain domain-owned data, but the module owns
the rendering and behavior: circular 18px swatches on 22px tracks, two rows,
column-major flow, and the palette's meaningful left-to-right hue order. The
chosen swatch wears a 1.5px `--e-ink` outline offset 2px; an unchosen
focus-visible swatch turns its own border `--e-go`. Hover turns the control's
border ink; press uses the shared `.97` scale. Swatches are named radio controls
with one tab stop; Left/Right moves across visible columns, Up/Down moves within
a column, and Home/End reach the bounds.

Colour swatches never show hover or keyboard tooltips: their accessible name
is sufficient and tooltips obscure adjacent choices. A consumer may prepend
the module's optional 2×2 circular style-mode block and divider. Those modes
use the same size, ring, and radio contract, and may keep explanatory
tooltips because they describe treatment rather than hue. Coarse pointers keep
the circles visually unchanged and expand each track/hit target to 40px.

### 6.3 Segmented choice

Capsule track on `--e-surface-recessed`; cells split by hairlines; the
picked cell wears solid ink with paper text (chrome chooses, so ink; the
green stays reserved). Label-size caps cells. **One scoped exception:** inside
a Mod, the card's chosen accent is that Mod's ink, so the picked cell wears the
accent. The exception covers the value channel only (what is set, how much,
which one) and never leaves the card. Hover, focus and press are unchanged. Pick on pointerdown; drag-across;
arrows cycle. (Used by: connection polarity, strength swatches keep their
drawn-stroke vocabulary, reasoning effort. Note text size moved off this
control to the Stepper, §6.4b, once three named choices became a six-step
ladder.)

Settings uses the deliberate comfortable variant for Theme and Reasoning:
a 30px track (the field-row rung, so it agrees with the fields beside it) with
26px cells. The compact primitive remains for dense card controls. A completed or cancelled pointer
gesture, including a window blur, ends drag-across immediately; hovering a
selected cell preserves its paper-on-ink label.

### 6.4 Toggle

Two toggles, two jobs. The **preference toggle** is a capsule 40×22 with a
16px ink handle: it states a setting and is pressed with a pointer. The
**instrument switch** inside a Mod is 52×28 with a 20px handle, because it
rides the instrument ladder one rung above the control it resembles and is
thrown with a thumb. Both use the same throw, never a fade.

Capsule 40×22, recessed track; ink handle 16px; on = `--e-go` track,
paper handle, throw settles 220ms `--e-ease-settle`.

### 6.4b Stepper

The one control for a small bounded integer (Conversation turns, Note text
size's six-step ladder, and any count a slider would over-serve). A
pill-shaped `--e-surface-recessed` well holding two round keys and one value:
`−` key, tabular value, `+` key. It rides the 26 step, `.sm` the 24; keys are
28 wide and inherit the well's height by default.

- The bottom dock's Note-size stepper is the one scoped exception: rather than
  inherit an ambient panel height, it fixes its own complete height and width
  so it reads as one more key in the dock's strip instead of a form control
  that wandered in from a settings panel (`.dock-stepper` in
  `090-dock.css`). Its keys and glyphs are otherwise unchanged from the shared
  recipe below.

- Keys are ink-soft at rest, ink on hover over the ordinary ink wash. The
  stepper is a general instrument, so it never borrows a functional or Mod
  accent for its hover: a hue inside a stepper would be decoration (§1.0 rule 3).
- At either end of the range the spent key drops to `--e-ink-faint` and loses
  its pointer. It keeps its place; the well never resizes under the thumb (§7).
- Each key carries an `aria-label` naming the thing it changes, and the value
  is `aria-live="polite"` because pressing a key moves a number that is not on
  the key.
- The `−` and `+` marks are sanctioned text glyphs, the same vocabulary as the
  connection pill's `+ − ~` (§4). They are not icons and never become SVG.

### 6.5 Chips & badges

**A chip is one word.** If the fact needs more words, the chip shows the
mark or shortest word and the rest becomes its tooltip: `TARGET`, `SAVED`
(tooltip "Saved with this Idea"), `LATEST` (was "Up to date"), attention
`!` (tooltip "Source changed"). A chip that reads like a sentence is a
callout wearing the wrong clothes.

The Ask AI Card's fixed CLI mode is the one icon-only status-chip exception
(D15). It uses the compact icon-key's 24px square geometry, a 14px terminal
glyph, and a selected go border rather than the pill recipe. Its accessible
name and tooltip both say `CLI MODE`. It is a statement, not a switch: choosing
the local provider elsewhere establishes the mode, so the indicator does not
pretend to offer an action.

**Interactive chips share one grammar** (version chips are the canonical
case): the **fill is the state** (kept = solid go, interrupted =
attention wash, plain = recessed) and never changes for any other reason;
**hover dips the fill one shade** (the same one-step move as
`--e-field-hover`, never an ink flip, never a solid swap); **selection
is a 1.5px ink outline**, offset 1px, on whichever chip is chosen,
including washed and solid ones. Fill says what it is; the outline says
you're looking at it.

- **Status chip**: `--e-type-micro` caps on a wash of its functional color
  with matching `-ink` text (e.g. attention chip = attention wash +
  `--e-attention-ink` text). Radius 999.
- **Count badge**: `--e-type-value` on `--e-surface-recessed`, radius 999,
  20px, the chip step of the height ladder (§3.5), level with its chip
  neighbours.
- **Scope chip** (`SAVED`, "Saved with this Idea" → `IDEA`, "This
  device only" → `DEVICE`):
  micro caps, hairline border, no fill.

### 6.6 Menus & popovers

`--e-surface-floating`, 1px `--e-line-strong`, radius 8, `--e-shadow-lift`,
padding 6; items 28px rows, `--e-type-ui`, radius 4, hover ink-wash,
active row = ink fill + paper text (never green). Destructive rows in
avoid. Enter: rise 4px + fade 120ms. One popover at a time, outside
pointerdown + Escape dismiss.

### 6.7 Tooltips

Ink pill (`--e-ink` bg, ground text), `--e-type-micro`; 4px 9px padding,
radius 999,
appears at `--e-t-fast` after the `--e-t-intent` delay (the delay is on
enter only; exit fades immediately at `--e-t-exit`); shows on
`:focus-visible` as well as hover; never wraps twice. Tooltip labels are
always caps (`SELECT · V`, `TURN INTO A NOTE`); the shared tooltip primitive
owns that casing so every caller inherits it.

**One stadium, whatever the shortcut is drawn from.** The pill centres its own
content, and a shortcut that is a drawn key rather than a typed letter (MOVE's
spacebar) is sized to the label's own line so it cannot grow the box. The
primitive owns this for the same reason it owns the casing: otherwise the one
tip carrying a glyph stands taller than its neighbours and its label rides
below the pill's centre.

**A tip is placed, not merely positioned.** It is measured before it shows,
and three numbers decide where it lands:

| Rule | Number | Why |
|---|---|---|
| Waits before it appears | `--e-t-intent` (600ms) | resting on a key must mean asking, not passing through |
| Sits above, flips below | 8px gap | below only when above will not fit; the gap is a **transparent border**, not empty space, so the pointer can travel from control to tip without crossing dead space (WCAG 1.4.13 hoverable) |
| Stays inside the viewport | 8px inset | slid sideways from centre when the centred position would overflow; a tip near an edge moves rather than getting cut. A tip wider than the window is left centred rather than pinned to one side |
| Wraps at most once | 216px max width | one break is a long name; two is a paragraph, and a paragraph does not belong in a box that disappears |
| Escape closes every tip | any tip | a tip covers what is under it, and "move the pointer" is not a way out (WCAG 1.4.13 dismissable) |

A tip appears on `:focus-visible`, never on click: you already know what you
just pressed. A resting tip is `display: none`, not merely transparent, because
an absolutely positioned invisible box still counts toward its ancestors'
scrollable overflow and grows phantom scrollbars.

**Prose wears its own dress.** A tooltip whose content ends like a sentence
(terminal `.`, `?`, `!` or `…`) is prose the control genuinely owns: the
globe's reach hints and the harness hint (#964). The shared primitive detects
it, the way it owns the caps casing, and swaps the pill for a wrapped block:
sentence case at natural tracking, `--e-r-card` radius, the same ink surface
and micro face, wrapping to its 36ch measure. Labels never end with
punctuation, so every label keeps the pill above unchanged. Prose stays one
breath long, states a fact owned elsewhere (the reach hints restate what
Settings' key hint says), and never grows into a paragraph: that still belongs
in a callout.

**A tooltip is never the only copy of a fact** (see §10). It is a picture of
something the accessible name already says. It is not help text: name the thing
and give its shortcut. Explanations belong in a callout (§6.7a), questions in a
modal. Colour swatches carry no tip at all: the accessible name is enough, and a
pill over a palette hides the next four colours.

### 6.7a Callout panels

An aside that is not body copy: a signpost, a caution, a note about what just
happened.

A callout is a **surface**, not a decorated paragraph. Tinted well
(`color-mix(in srgb, <tone> 12%, <the surface underneath>)`), `--e-r-well`
radius, no border and no rule. The tint mixes into whatever the callout is
lying on, so the same component reads native on a card, a panel and the board.
**There is no left edge bar.** A 2px rule down the left edge is the most
borrowed device in software, it says nothing about this app, and it collides
with the side panel's resize edge, which is a real affordance and needs that
position to itself.

It stacks: the label owns the first line, the words own the rest. A label in a
left column is fine at three words and wrong at eight, because the column has to
be as wide as its longest label and every shorter one leaves a hole.

The label takes the §2.7 group-heading recipe (mono micro caps at 700) in the
tone's `-ink` colour; the body takes prose. Four tones and no fifth: **attention**
(the default), **go** (a signpost), **avoid** (a caution), **convo** (something
running). Identity is a user's colour and never a callout's.

A callout never takes focus and carries no buttons. If it needs an action it is
a modal; if it leaves on its own it is a toast. One sanctioned exception,
founder decision 2026-08-18 (#971): the research depth choice on the Ask AI
card (§8.3) rides inside the attention callout as one segmented control of
four equal cells, because there the callout is holding a press and the control
sets the dial that press will spend on. It commits nothing; the card's own Run
key is still the consent, so the callout remains a thing that explains rather
than a thing that acts. A modal here would put a ceremony between a person and
a decision the callout has already explained. No other callout carries a
control.

### 6.8 Cursor semantics

Eleven cursors, and no twelfth. A cursor is the only label a gesture gets, so
the list is closed: `default` select · `pointer` buttons, pills, chips and
links · `text` editable prose · `grab`/`grabbing` the pan tool, card drag and
any grip · `crosshair` ports · `ew-resize`/`ns-resize` scrubs, sliders and
seams · `nwse-resize`/`nesw-resize` the four card corners, each pointing along
the diagonal it moves · `row-resize` a ranked row that only travels vertically
· custom highlighter SVG over readable text in highlight mode. A new component
picks from this list; it never invents a cursor. The cursor is also where
locked and disabled part ways (§7): a disabled control drops to `default`
because pressing it goes nowhere, and a locked control keeps `pointer`
because pressing it opens the upgrade screen.

### 6.9 Modals

Veil `rgba(35,32,25,.32)`; panel `--e-surface-panel`, radius 12, lift
shadow, max 80vh. Header: `--e-type-display` title + `--e-type-ui`
subtitle (paper voice for conversational subtitles) + quiet × (top-right).
Body sections separated by hairlines; section heads `--e-type-title`.
Footer right-aligned: ghost/quiet actions left of the one primary.
All modals: Escape closes, focus enters on open, returns on close
(focus-trap completeness is a code task noted in IMPLEMENTATION.md).

### 6.10 Toasts

One kind: a floating paper chip (surface-floating, hairline, lift shadow,
radius 8) top-right, `--e-type-ui` ink text + optional functional dot.
Auto-dismiss 4.2s (kept). Toasts only for events with no local home
(deep-link failures); local events speak locally.

### 6.10b The callout · one in-card voice

Anything inside a card that needs the user's eye speaks through **one
component**: a wash strip (radius 6, functional hue mixed into the card
surface) carrying a bold mono mark in the hue's `-ink` twin and an ink
sentence in paper voice. The hue says what kind: attention 18% wash with
`!` (stopped drafts, source drift), avoid 12% wash with `!` (errors:
"Check your AI key or connection."), go/convo 10% for
the rare positive or conversational aside. Never colored body text, never
a second style for errors: if it needs the eye, it's a callout; the
one-signal rule (§8.4) still governs when one may appear.

**A callout never repeats what a state word already says.** When the card
foot reads "Couldn't run", the callout carries only the new fact or the
next step ("Check your AI key or connection."): restating the failure
spends the reader's eye twice on one event.

### 6.11 Loading & progress

- **The pulse is the universal "running" signal.** Any in-flight state
  word wears a 7px pulsing dot (1s, currentColor) after it ("Running ●",
  "Writing ●", "Saving ●") and drops the ellipsis. The word names the
  work; the pulse says it's alive. One grammar everywhere something runs.
- **Skeleton paper, never spinners**, for content that is about to be
  replaced wholesale: surface-field blocks at the rhythm of the prose
  lines they stand in for, and no shimmer on them. This is the sanctioned
  answer, not a shipped one: nothing in the product needs a skeleton
  today, so nothing in the product has one. A spinner remains banned
  whether or not a skeleton is in use.

---

## 7. State grammar (applies to every component)

| State | Channel | Spec |
|---|---|---|
| rest | - | as specced |
| hover | color only | ink wash `rgba(35,32,25,.07)` on chrome; chrome reveal at 120ms |
| pressed | scale | .97, 120ms |
| focus-visible | one line, doubled in weight | the control's own boundary turns go (`border-color: var(--e-go)`, like fields, the border IS the focus) **and thickens to 2px** via `box-shadow: inset 0 0 0 1px var(--e-go)` sitting flush against it, so the indicator has the area WCAG 2.4.13 asks for and focus is never carried by colour alone. Inset, so no geometry moves. On ink- or go-solid controls both the border and the inset ring flip to `--e-on-solid` (go on ink is 2.75:1). Borderless round instruments (kind dots, ports, seg cells) wear a single go ring since they have no border to repurpose. Never two *separate* lines around one control |
| selected | one selection line | the control's own border turns go, no halo, no second ring. Two controls preserve their interior state channel with a 1.5px ink outline instead: chips, whose fill is their state, and circular palette choices, whose fill previews the chosen color or style; palette outlines sit 2px outside the control. |
| editing | caret only | selection already rings the card: the caret is the editing signal; never a second ring inside the card |
| disabled | dedicated tokens | ink-faint text, `--e-line` border, no wash on hover, cursor default, never opacity on the whole control |
| locked | disabled greys, live behavior | ink-faint text, `--e-line` border, exactly the disabled greys, but **cursor pointer**, the ordinary hover wash, the standard focus treatment, and a real click that opens the upgrade screen; never `aria-disabled`, never opacity on the whole control |
| running | words + pulse | label swap at reserved width; the state word wears the pulse dot (no ellipsis); streaming prose ends with the standalone dot |
| error | local words | avoid text + plain sentence at the point of failure, with a next step |

**The go ring answers to §11's 3:1 floor like any other boundary.** Go on an
ink fill measures 2.75:1 by day and 2.63:1 at night, so a control whose rest
state is a solid ink fill flips its focus boundary to `--e-on-solid` exactly as
a go-solid control does. That covers the active segment, the active menu row
and the active nav link. Flip the colour; never thicken the line, and never add
a second one.

Compound precedence (highest wins where channels collide):
editing > selected > focus-visible > hover > rest. Selected+hover = both
(wash under ring). Running suppresses hover reveal of destructive chrome.

**Locked is not disabled.** Disabled means "this cannot be used right now":
non-interactive, cursor default, no click, exactly as specced above and
unchanged. Locked means the capability exists and this person is not entitled
to it, so the control's job is to explain and route. It shares disabled's
greys, and everything else about it stays alive: the pointer cursor says it
goes somewhere, hover and focus behave as on any live control, and its click
opens the upgrade screen. It carries `data-locked="true"`, never `disabled`
and never `aria-disabled`, because a screen reader that hears "dimmed" walks
past a doorway; instead the accessible name says what unlocks it ("Web mode.
Subscription feature."-shaped, per §9's plain-fact voice). A gated capability
is greyed, **never hidden**: hiding makes the product look smaller instead of
saying what the subscription offers. This deliberately reverses the earlier
rule against showing unusable controls (founder decision 2026-08-19, epic
#987; the reach side is amended in ADR 0037) and it reverses it only for
entitlement: a control that is broken, empty, or situationally impossible
still uses disabled or absence, exactly as before. Locked and disabled never
co-occur on one control.

---

## 8. The canvas surfaces (Eido-specific specs)

### 8.1 Card shell

- Paper: `--e-surface-card`, 1px `--e-line-strong`, radius 8, **no resting
  shadow** (today's `--shadow` is removed: separation comes from the
  darker ground; this is the single most visible change).
- Dragging: `--e-scale-lift` is NOT applied to canvas cards (zoom owns
  scale); the lift shadow alone marks the airborne card.
- Head (min-height 36px, hairline below; inset 7×14, the 14px rail): **kind dot** (10px circle,
  identity color, opens color popover: the accent-dot pattern) → title
  (`--e-type-title`, mono; untitled shows kind label in ink-soft + "edit"
  hint chip on selection) → hover-revealed head actions right.
- Selected: the card's own 1px border turns `--e-go`, one line, no halo.
  Geometry untouched (border width constant).
- Eyebrows ("WHAT SHOULD AI DO?"): `--e-type-micro` caps, ink-soft.
- Foot, **the foot-action grammar**: at most ONE engraved primary verb
  (RUN, START, SEND) as a compact primary button; every secondary action
  is a 24px quiet icon key with a tooltip carrying its name; more than
  six actions, or whenever keys plus the state word would exceed the
  foot's width, fold into a `⋯` overflow menu; the state word reads at the
  right (`--e-type-value`: "Ready" / "Running ●" / "Done" / "Up to date" /
  "Couldn't run" in its functional color; running wears the pulse). Words in a card foot are
  clutter: the icons + tooltips + the overflow menu carry the verbs.
  A positive latched icon (Kept, Web mode) uses one selected treatment with
  `aria-pressed`: `--e-go` boundary, a light go wash, and `--e-go-ink` icon.
- Kind accents: Mod cards tint their head hairline + dot with `--e-mod`;
  Conversation with `--e-convo`; Group frames keep the dashed hairline
  frame grammar (1.5px dashed `--e-line-strong`) over a translucent Card
  wash (45% resting, 55% selected). The dash is the Group's outer frame and
  only that: the head hairline inside a Group is an ordinary solid one,
  because a container that says "group" twice says it worse. During Board motion the canvas silhouette
  owns that wash and the DOM frame yields it, preserving the same opacity.
- Creator accent: an AI-created Card whose latest reshaping is not by the
  user recolours the ordinary/kind head hairline to
  `--e-agent-unadopted-accent`. The line stays solid, at the ordinary
  hairline weight. The user's first edit adopts the Card visually and
  restores its ordinary/kind hairline; its creator never changes. See §1.5
  for the open question this leaves.
- **Selection · move · resize** (the direct-manipulation grammar):
  - Selected: ring per above; the four corner handles (9px go circles,
    instruments are round; corners only, never edges) pop in with the
    ring (fast fade + settle from .5 scale). Deselect hides them.
  - Move: after 5px of travel the card lifts (shadow only); wires stay
    attached; drop settles the shadow over the move beat.
  - Resize: **zero animation while dragging**: the card tracks the
    pointer exactly and paper reflows live; easing between a hand and its
    object reads as lag. A floating mono readout (`248 × 152`, tabular
    numerals, floating surface + hairline) rides the grabbed corner and
    fades on release (exit beat).
  - Limits keep the app's existing geometry contract: min width 200 and
    min height 120. A user-fixed-height card may scroll its paper; the
    design migration does not replace that established behavior with a
    content-height minimum. The living reference mirrors the 200×120 minimum and
    fixed-height body-scrolling contract.
  - Sizes remain geometry contracts (growth cap, fixed-height scrolling,
    measured footprints); this grammar restyles the handles and adds the
    readout, nothing else.
- Connector nodes and the connection pill keep their geometry owners in
  `zoomChrome.ts`. The connector node holds **13px through Map, Overview,
  and normal Reading**, then grows smoothly with a close-up Card to a 24px
  cap. The pill retains its 12–40px clamp.
- Growth-cap and passive/editor geometry contracts: untouched (invariants
  5, 13).

### 8.2 Note card

Body = paper voice on a six-step ladder (14/15/18/22/28/34), set by the dock
Note-size stepper (§6.4b); step 2 (15px) is the default and matches the
retired Medium choice. Placeholder "Write a thought…" in
ink-soft italic (paper voice may italicize). Prose hierarchy per §2.4.

**Attachment panels.** A Note's attachments do not flow through its body. They
ride carousels pinned to the bottom of the Card, images first and previews
second, each present only when it carries something. A panel is one
horizontally scrolling track of evenly sized tiles on the recessed surface,
tiles at chip radius on a hairline, and the tile a gesture last landed on wears
the go boundary the image gallery uses for its current thumbnail; a resting
panel marks nothing. Every attached image is in the track: there is no
"+N more" veil and no count at which an image stops existing, because the
Card's width decides only how much of a track is on screen. Image tiles are 4:3
and contain their image whole; preview tiles share the track evenly, never
narrower than the token width and never wider than the track. Filenames ride
the tooltip and the image's alt text, and the trash key surfaces on tile hover
or keyboard focus rather than spending a caption row.

A panel's height reads the Card's height and nothing else: a clamp of a share
of it between a floor and a ceiling (`--e-attachment-panel-height-min` /
`-share` / `-max`). At the floor a website preview keeps title, description and
site row with the cover image cropped away to nothing; every pixel of Card
height above the floor goes to that image until the ceiling shows the preview
whole. An auto-height Note holds the floor, because a Card that measures itself
from its content cannot also be the thing its panel is a share of. Non-image
attachments stay as file rows in the flowing body.

A Note created by pasting one website URL keeps its ordinary editable prose
body and places one website preview in the previews panel at the bottom of the
same Card container. The visible Note text preserves the pasted label while the
preview owns the normalized destination. A declared page image owns the cover
region above the copy, sized by the panel's own height rule; below it the
information ladder is title (title voice), description (paper voice, ink-soft),
then favicon/domain/open mark (UI voice, ink-soft). Missing metadata collapses
to a Globe-marked website card with hostname, full wrapping URL, and the same
open affordance—never a broken-image tile or an empty Card. Loading uses the
shared running state word. A persistent compact action rail offers Refresh (or
Retry after fallback) and Remove preview, which removes only the optional
projection and preserves the Note prose, without nesting either action inside
the external link. The refresh control stays mounted through its loading cycle
so keyboard focus does not fall away; a persistent polite status reports
loading, ready, and fallback. Hover changes only the paper wash; press uses the
shared .97 scale; focus doubles the go boundary inward without moving geometry.
All variants retain one external-link target. Editing prose does not remove or
replace the attached preview; only Remove preview does so, as one undoable
action. A local HTML preview uses this same composition but owns its persisted
static JPEG separately from ordinary Note image attachments.

### 8.3 Ask AI card

Eyebrow micro caps → instruction (paper voice) → model row (label "MODEL"
micro caps + picker §6.2b) → foot per the foot-action grammar:
primary RUN (swaps to quiet CANCEL while running), then icon keys: the
globe (the reach cycle) first, eye (Context), route (What will run), state
word right. Error sentence below the body in avoid, paper voice.

The globe is one icon key that cycles Off → Web mode → Research mode → Off,
no word, no menu, no second control; its accessible name and tooltip name
the state it is **in**, never the press that would leave it, because a
three-way cycle cannot say "turn on" without lying about one step (founder
decision 2026-08-18; the armed tooltips are the §6.7 prose dress). Off and
Web wear the ordinary quiet-key/go-tint toggle grammar; Research steps into
attention, the "needs your eye" hue, with no arming animation (the arming
ring was tried and removed, same date). With no Linkup key the cycle skips
Research rather than offering a state that cannot run. On a local harness,
the reach control becomes the fixed CLI mode indicator from §6.5: a selected
go square with the Lucide terminal glyph and `CLI MODE` as both accessible
name and tooltip. It cannot cycle because the harness brings its own tools.
When the subscription does not cover reach, the globe wears §7's locked
state instead: it **holds at Off**, and every press opens the upgrade screen
rather than cycling, because cycling into a mode the person is not entitled
to would arm a run that cannot happen. Its accessible name and tooltip say
what unlocks it. The two absences stay distinct: no Linkup key is a missing
capability, so the cycle silently skips Research exactly as before; no
subscription is a missing entitlement, so the whole cycle locks and routes
(founder decision 2026-08-19, epic #987; ADR 0037's amendment carries the
reversal).
The first Run press on a research-armed Card is held by an attention callout
(§6.7a) stating that research keeps working for minutes once it starts, and
carrying one segmented control of four equal cells, S / M / L / XL, cheapest
first. A depth press only sets the dial: it commits nothing and can be changed
as often as a person likes. The press that spends is a second press of Run,
which the callout names, so choosing and spending are two separate acts and
there is a moment in between to change your mind (founder decision
2026-08-18, #971). Run stays primary Run throughout, because Run is what the
question asks for; cycling the globe off research stands the question down,
which is the right control for it because the question is about the mode.
Segmented rather than four loose keys because this is one question with four
answers, and its chosen cell takes the §7 selected treatment, a solid ink
pill: the keys wore an attention tint first and a tint inside a callout
already washed attention did not read as "this one" (founder report, same
day). The chosen depth's time and dollar numbers stand beside the control as
plain text, which is the one sanctioned price on the face because it sits
exactly where the finger is spending. Standing text, never a tooltip: a
tooltip is drawn on the document rather than in the Card, so on a coloured
Card it arrives as a black pill from another palette and lands on the sentence
it was explaining. Anything that must wear the Card's colour has to be Card
content. A Resume key appears beside Run only while a paid job's id is
standing with no run listening; it re-attaches by polling and never submits.

### 8.4 Result card

- Version chips obey the chip grammar (§6.5): **fill = state, outline =
  selection, hover = one-shade dip.** The viewed version wears a 1.5px
  ink outline, whichever it is; the fill never swaps on selection.
  **The pill is the signal**: kept = the whole pill solid go;
  interrupted = the attention wash with no word: the color says it, the
  tooltip carries the reason ("Stopped early, kept as a draft"). Chips
  sit on the card's paper surface, so both signals stand clear of any
  identity fill.
- Meta row, **details, not controls**: plain mono micro text in
  ink-soft, items separated by `·` (`fable-5 · ! Source changed`); the
  source-changed note reads in attention-ink with its `!` mark. Nothing
  in this row looks like a pill: pills are for things you press
  (versions above it). Its popover uses sentence case. Changed sources are
  navigable text rows without a repeated "Changed" label; a missing source
  remains plain text marked "Deleted". Dismiss uses the ordinary quiet button.
- Output: paper voice prose (§2.4).
- **One signal per event.** The title never changes: a Result card is
  always titled like a Result card. When the versions row is present, the
  interrupted pill IS the whole signal (wash + tooltip); no callout may
  repeat it. The callout (§6.10b, attention or avoid variant) appears
  only when there is no pill to point at: a lone stopped draft, or an
  error that produced nothing. Never both.
- Follow-up thread, **texting grammar**: your bubbles align right on the
  field surface; AI bubbles align left on card surface with an ink
  hairline (`--e-line-strong`, the border stays in the ink family, no
  functional hue on paper); asymmetric chat radii (12px, 4px on the
  speaking corner); max-width 85%; 10px between bubbles; no name labels:
  the sides say who's talking. Each settled AI bubble offers Copy and
  Turn into a note as quiet inline actions. Streaming dot per §6.11. The
  composer is a multiline message bar that starts at one line, grows with
  its content, and never exposes native resize chrome: the standard prose
  textarea field + a
  round go send key carrying an **arrow-up glyph** (send is upward; never a
  paper-plane, planes tilt and read off-brand). No explanatory copy under
  the composer: the thread explains itself. While a reply streams, the
  textarea remains editable for the next draft; only its send key is disabled.
  Copy confirmation opens immediately on activation rather than waiting for
  tooltip intent.
- Foot per the foot-action grammar, all icon keys: copy · note (Turn into
  a note) · variations · speech bubble (Follow up) · check (Keep this,
  latches go-green when kept) · eye (Context); quiet CANCEL appears while
  running. Result feet carry actions only, never a Ready, Running, Done, or
  failure status indicator. In-flight state remains visible through Cancel and
  the body or transcript pulse; failures use the one next-step callout.
  Tooltips carry the full verb names.

### 8.5 Conversation & its result

Same grammar; speaker labels micro caps in `--e-convo`; interjection
composer = field + primary Send/Continue.

### 8.6 Mod card

A Mod is one complete instrument face, not a generic Card containing a bag of
controls. Eleven kinds (slider, dial, count, switch, pad, select, order,
filter, mixer, radar, and matrix) each make the picture of the value the direct
control. The React shell owns head, foot, and chrome; the kind face owns its
imperative DOM and rAF-coalesced gesture paint. Mid-gesture frames stay local and
one store commit lands on release or discrete step.

The head uses the Mod's chosen identity for its hairline and face accent. The
gear opens compact settings and option-prompt controls; the eye opens the exact
treatment and sentences the Mod contributes. There is no expanded editor,
use/build split, generic control picker, target picker, or per-control prompt
tooltip. Inline `e-edit` title and option renaming follows the ordinary
Card-title contract rather than departing from it: invisible at rest,
underlined on hover, go-line on focus, Enter commits, and Escape restores. One
editable-name affordance, everywhere; there is no second one and no pencil, no
chip and no "edit" label anywhere in the system.

**The underline never moves the words.** An editable name carries a
`border-bottom: 1px solid transparent` at rest, and a head centres its
children, so the box is 1px taller than its own line and centring the box puts
the text half a pixel high. Two corrections, both on the title, both required:
`margin-bottom: -1.5px` pulls the underline out of the layout so the LINE
centres and the underline hangs below the words; `margin-top: .5px` is optical,
putting the **cap band** (baseline to cap height) on the head's centre rather
than the font box, which reserves descender room a title's caps never use. The
hit-target pseudo splits the same half pixel back the other way
(`inset: -3.5px 0 -2.5px`, `-11.5px 0 -10.5px` on a coarse pointer) so the
target sits level even though the type deliberately does not. Verified across
every card and Mod head in the living reference: cap band within 0.13px of
centre, target within 0.01px. Mod colour selection imports the
shared §6.2c ColourPicker with the 12 User identities and no custom-hex entry.
Removal controls use the 16px light-chip circle; nested members keep stable IDs.

Geometry and behaviour, verified against `src/mods/` and `src/styles/05*`:

- Head 36 high. Head, face and foot inset 14 (the deliberate off-ladder
  gutter). Rows inside the face 12 apart. Label truncates first; the value
  keeps 176 before it ellipses.
- Face is the scroller (`overflow: auto`), so a tall face never paints over
  the foot, and it may scroll down but **never sideways**. A face that needs
  more width than it has is a layout bug in that face, not a licence to
  scroll: wrap the row, or raise the floor.
- **A Mod has its own floor, and it is not the Card's.** 200 x 120 holds a
  title and a line of body, which is all an ordinary Card owes anyone; a Mod
  owes a working instrument. Width floor **260** for every kind, set by the
  widest face (filter, three mode keys side by side). Height floor is that
  kind's measured face height plus **88** of Card chrome (head 41 + foot 45 +
  two hairlines): count 208, switch 208, slider 220, filter 242, order 258,
  mixer 298, dial 306, pad 314, matrix 322, select 324, radar 362. These are
  measured off the live specimens in the reference's Mods section, not
  asserted; a face that changes height moves its floor with it. No maximum.
  Once height-locked, well faces (pad, radar, mixer, matrix) stretch to a 110
  floor each; row faces keep their heights and carry the surplus as empty
  paper.
- Part bounds (`MOD_PART_BOUNDS`): slider 1-8, dial 1-12, count 1-6, switch
  1-8, select 2-7, order 2-7, pad fixed at 2, radar 3-8, mixer 2-6, filter
  1-3, matrix 1-6 a side. The remove key is absent at the floor, not
  disabled; the head plus is absent at the ceiling.
- Growth is a head key. Matrix is the sole exception and grows from its own
  dashed ghost row and column, because a grid grows two ways and one key
  cannot say which. Pad never grows.
- `steps` is the one cross-kind setting: slider detents, dial ticks, count
  percent and ratio maths, filter stops, matrix level names. Named stops beat
  numbered ones wherever the kind supports them.
- The accent is the **value channel only** (fill, arc, top token, picked
  cell), per the §6.3 scoped exception. Hover, focus and press stay on the
  shared grammar: one 7% ink wash, one go line, `--e-scale-press`.
- Every face is fully keyboard-operable (tab to parts, arrows to move value,
  Home/End to the ends). A drag-only face is unfinished. When the card is not
  the single selection under the select tool, the face is `inert`; nothing
  greys out.
- The eye popover is editable, not a read-out: the treatment sentence can be
  overridden per Mod. A Mod wired to a Conversation shapes the whole
  exchange; wired to a participant it stays in that participant's compile.

### 8.7 Connections

- Connector node, the app-wide standard from the Mod-card prototype:
  13px circle straddling the left/right card edge, `--e-surface-ground`
  fill, 1.5px `--e-ink` ring, `crosshair` cursor, and a 24px invisible
  target. Hover/focus fills and rings it with `--e-go`; there is no tooltip
  or label. The node keeps the same 13px screen footprint through Map,
  Overview, and normal Reading, then grows with close-up zoom to a 24px cap.
  Rich DOM changes the connector's actual layout-box size for that curve,
  never its anchor via a CSS scale transform; the box remains centred on the
  outer card frame and the edge derives that same centre from the reactive
  measured node frame at every zoom.
  Below Reading the canvas painter draws it and its exact painted disc remains
  the hit-test geometry.
- Line grammar, **four words, then color**: thick (3px) or thin (1.5px)
  says strength; solid or dotted (one pattern: `stroke-dasharray: 0.1 7`,
  round caps) says certainty of the path; color says the kind: Helps
  solid `--e-go`, Avoid dotted `--e-avoid`, Mod dotted `--e-mod`, the
  drawing preview dotted go. Ghost (playback) is a *state*, not a stroke:
  the same line at .42 opacity. The fixed-pixel painter below Reading
  (Overview and Map) collapses every wire to the thin 1.5px weight so
  connections do not outweigh card silhouettes at low detail. No other dash
  pattern exists. Hover +1.2px. In rich DOM detail the curve terminates at
  the exact center of each connector node. Its compact closed arrowhead uses
  the connector's own zoom curve, a 3px base overhang and the slimmer shared
  ratio, and inherits the line's semantic color; it is never a neutral grey.
  If the remote Card leaves bounded DOM residency during close zoom, the
  canvas layer carries the same incident wire and arrow without a visual gap.
- **The whole wire is the control.** Preserve the existing 28px DOM
  interaction stroke and use the same shared hit geometry in painted bands:
  hovering anywhere along it grows the midpoint pill (the same 1.35
  growth), and clicking anywhere along it selects the
  connection and opens the editor. The pill is the anchor, the line is
  the target: nobody should have to hunt a 20px circle.
- The midpoint pill: capsule (instrument!), 20px, polarity symbol
  `+ − ~` in the functional color on its wash, hairline border; hover
  scale 1.35 (kept) with its ring drawn as a child layer so ring and
  growth move as one; selected = go ring. **No tooltip**: the pill's
  meaning is its symbol, and the click is cheap. Zoom clamps kept
  (12–40px).
- The popover editor: floating surface per §6.6; polarity segmented
  control; strength stays **drawn line swatches** (the strokes are the
  vocabulary, labels "Direct"/"Light" beside them); Avoid reason field;
  danger row "Remove connection".
- Creation preview dash + connection beats: kept to the frame.

### 8.8 Top bar

Panel surface, hairline below, 44px. Brand "Eido" `--e-type-display`
700. Idea pill = quiet capsule button (current name + chevron), with the
save state directly beside it as `--e-type-value` ink-soft (the compact
`Saved` and failure strings stay; in-flight Saving follows
§6.11 and drops its ellipsis): the fact
sits next to the thing it describes. Right cluster: HIGHLIGHTS (count
badge), PLAYBACK, SETTINGS as quiet/label buttons.

### 8.9 Bottom dock

A **machined panel, not glass**: `--e-surface-panel`, 1px
`--e-line-strong`, radius 10, NO blur, NO shadow (it rests). Tool keys
26×26; active tool = solid ink key + paper glyph, and hovering the key you
are already holding dips that solid one shade rather than dropping it for the
ordinary ink wash (§6.4). Every other key is a quiet key: transparent, ink
glyph, ink wash on hover, press scale, and no border of its own even when it
is spent, because an ink-faint glyph already says a key is unavailable.
Divider hairlines between clusters.

**Key order, left to right, by frequency of reach**: SELECT first (the
resting tool), then MOVE (Spacebar), HIGHLIGHTER | creators (ADD NOTE, ASK AI,
CONVERSATION, ADD MOD, TITLE) | UNDO, REDO last (the least-pressed keys live
at the end).

**Nothing in the bar wears go.** Ink marks the current tool, and only the
three canvas tools hold a state at all: every creator fires on click and is
finished. A green key among keys whose fill means "the tool you are holding"
claims a state it does not have, so ADD NOTE is a quiet key like the creators
beside it. Go still marks the primary action on surfaces that have one (§6.1);
the bar is not one of those surfaces, because it is an instrument tray rather
than a place where a next step is proposed.

**The bar's geometry is sacred.** It never grows, shrinks, or re-centers
: muscle memory owns every key's position. Contextual actions (copy
link, duplicate, bring forward, delete-in-avoid) live in a **tray**: a
second machined layer, same panel material, top corners rounded, that
slides out from *behind* the bar and docks flush on its top edge while
something is selected, and slides back behind it when nothing is. The
tray is icons with tooltips, never text buttons, and never floats free
of the bar. Tooltips per §6.7 with shortcut (`SELECT · V`).

### 8.10 Panels (Highlights), Settings, peeks, previews, manager, gallery, playback

- Board Search: panel surface with no accent hairline. A result row contains the
  Card's clean title and its visible body only; searchable
  provenance, run details, connection meaning, and settings may establish a
  match but never repeat inside the row. Titles ellipsize and body copy wraps;
  the result lane never scrolls horizontally. On desktop the panel's left edge
  is a pointer- and keyboard-operable vertical separator that adjusts the
  panel width within its token-authority recipe: 360px default, 280px minimum,
  720px maximum, 16px keyboard steps, and 64px viewport inset (double-click
  restores the default). Its invisible target follows §10's 24px/40px rule
  with no visible edge marker.
  At the 720px sheet breakpoint the panel fills the viewport and the resize
  edge disappears.
  A `Created by` segmented control (`All` / `AI-created` / `User-created`)
  filters the graph-derived result set before paging. Legacy Cards with no
  provenance count as user-created; user-adopted AI Cards remain AI-created.
  Activating any filtered result uses the same select, camera, and keyboard-
  focus jump as unfiltered search.
- Highlights panel: panel surface, left hairline; tag groups with dot +
  name + count; rows quote in paper voice, source in mono value; row
  verbs ghost icons.
- Settings: modal per §6.9, with no header band: the title belongs to the
  left nav rail, the close key sits above the scrolling panel, and `Done` is
  the one footer action. The categories are Context, AI Models, Board, and
  Privacy. Each panel is a category heading followed by bordered card groups;
  a group begins with a title and hint, then uses split rows for a label/control
  pair or field-surface radio cards for a choice. AI Models owns user-supplied
  OpenRouter and Linkup keys and supported local AI tools. No account, hosted
  route, upgrade, billing, credit, or subscription controls exist (ADR 0051).
  Board owns Theme, running-card confirmation, and context fitting; Privacy owns
  sharing and Board Info. Theme, credentials, counters, and the wire record are
  device-local; remaining Idea settings stay with the current Idea.
- Renderer counters: a device-local, default-off Toggle lives under Settings
  → Privacy → Board Info. On is a fixed bottom-right 320px readout at panel z,
  using the token-authority width recipe, floating surface, strong hairline,
  card radius, and lift shadow. Its title, hint, group, label, and numeric
  values use title, hint, micro, ui, and value roles. The readout has no
  controls or tab stops, is pointer-transparent, and leaves focus on the
  Settings Toggle. Off unmounts it and performs no polling. Its complete state
  grammar is therefore off = absent/no work; on = rest-only, with no hover,
  pressed, or focus state.
- Context peek / chain preview / version context, **the context row**,
  one component wherever context is shown: the peek is a *ranked
  playlist*, and **the rows carry the explanation: the panel earns no
  prose**. No "everything this Ask sees" subtitle, no "1 card gets
  reused" sentence: the head is title + count badge, and every fact
  rides a row (the reused card is a dimmed row with a `REUSED` chip, not
  a hint below the list). Row anatomy left→right: rank numeral (ui-size
  mono tabular, ink-faint, centered on the grip column, same size as
  the row text, order is meaning), six-dot grab grip (ink-faint, ink on
  hover, `grab` cursor), an 18px drawn line glyph (the connection's own
  stroke: solid/dashed at its weight in its polarity color; the wire
  vocabulary carried over, small), title (mono ui, one line, ellipsis),
  status chip, chevron. Rows expand (chevron flips) to a mono meta line
  (`DIRECT · HOP 1`) plus the sent text in paper voice through the shared
  Markdown renderer.
  - **The normal case is silent**: a fully-included row shows no status
    at all; only exceptions speak: as chips per §6.5 (`SHORTENED`
    attention chip, `REUSED` scope chip). No bespoke status voice.
  - **The trims-first fold**: a dashed hairline labeled `TRIMS FIRST`
    (micro caps, ink-soft, it's a boundary marker, not an alarm) sits
    at the budget boundary; rows below it get shortened first.
    Reordering across the fold is how the user spends the budget: no
    slider, no numbers.
  - Sections: THE TASK (the instruction, paper voice) · mod chips ·
    BUILD ON · INFLUENCES · ALREADY EXPLORED (avoid rows keep the glyph,
    no rank, no grip: you can't reorder what's excluded).
  - Mid-drag: the row lifts (shadow + strong border, `grabbing` cursor);
    hovering a prospective slot animates the surrounding rows into their
    preview order before drop. Reduced motion collapses that displacement.
  - SHOW TEXT (quiet verb, bordered, it must read pressable) is the one
    raw-text exception: it opens the exact compiled text in a mono pre on
    field surface.
- Idea manager, the Idea gallery: the current Idea rides a green grain
  cover (§1.8's sanctioned Idea-cover use, the modal's one textured
  surface) carrying a `CURRENT` micro eyebrow, an inline rename
  field (display role, on-solid; commits on blur/Enter, empty reverts),
  and a mono meta line (`N cards · updated today, 09:12`). Cover verbs
  (Duplicate / Export / Import, danger Delete) sit on plain panel below
  the cover, never on the texture. Creating is one field + the view's
  single green primary CREATE. Every other Idea is a shelf row: the
  whole row is the open control (name title-role, humanized updated
  stamp, arrow affordance) with a ghost trash key that deletes after the
  §6.9 confirm.
- Image gallery: ink-veil lightbox (`rgba(35,32,25,.78)`), paper stage,
  mono value "2 / 5", quiet nav keys.
- Playback transport: panel surface strip, four instruments and no more,
  play as a **go icon key** (the triangle IS the verb; no word), the
  scrub (one unmarked recessed track + round ink thumb),
  the count as a bare value (`5/14`, one line, never stacked), and speed
  as a **compact picker** (2× / 5× / 10×). Events occupy equal positions
  from the first event at the scrub's start to the last event at its end;
  because that spacing is uniform, the track carries no redundant event
  marks. The centered strip is at most 90% of the viewport wide. Recorded
  timestamp gaps do not create idle playback time. No EXIT key: the panel's
  own close is the exit.
- Empty state: paper voice, heading `--e-type-display`, body
  `--e-prose-hint`, one primary button. Ghost-affordance illustration:
  the **ghost graph**: two dashed card shapes joined by a dotted go
  wire, the first card holding a faint asterisk; it sketches the first
  graph the user is about to draw, not just one card.

---

### 8.11 The painted world (Overview and Map bands)

Below Reading zoom the entire visible app is canvas-painted
(`BoardOverviewLayer`), not DOM, today from hardcoded constants that
have already drifted from the CSS. The system's rule: **one color
authority**. The token sheet lives in a TS module that generates the CSS
`:root` AND feeds the painter palettes, so both worlds always agree (and
dark stays possible). Painter-owned kind colors and strokes, painted edge
colors, and label ink are token-derived. A mounted Card's motion silhouette
is the deliberate exception to painter boundary ink: it is fill-only, uses
the shared Card-shell radius transformed by zoom, and leaves normal and
selected borders entirely to the DOM owner. These roles are specified at
migration in the slices that move the tokens and theme/board input
(IMPLEMENTATION slices 02/05).

### 8.12 Marquee

Box-select rectangle: 1.5px dashed `--e-go` on a 10% go wash, radius 2px
(a mark, not a surface). Select owns the marquee at every canvas LOD; Move
owns primary-button camera pan. Cards touched by the live rectangle acquire
the selection grammar immediately. Holding the rectangle at a viewport edge
may pan the canvas and extend the same selection beyond the original view.
Release never fits or recenters the viewport; the selected set stays where the
user framed it and can be moved together.

## 9. Copy system

Voice: **a friend across the table**, direct, casual, warm, plain words
(the words.ts discipline, warmed up). It's a fun app, not a SaaS app;
fun comes from dry warmth, never jokes, emoji, or exclamation marks.

1. Talk like a friend: you, your, contractions, always ("Too much to
   send?" not "When there is too much to send").
2. One line, then stop. If a sentence can lose a clause, it loses it;
   details live behind a click.
3. Fun is dry warmth ("Send it all: big chains might not fit.").
4. Two speakers: the machine engraves verbs; the friend explains
   consequences ("Quietly added to every run. Your cards never see it.").
5. Never SaaS: configure, manage, enable, workspace, preferences,
   optimize, leverage, seamless.
6. Say what happens: buttons name their action, confirms repeat the
   consequence, errors give the next step.

- **Machine speech** (engraved): single verbs, caps, mono: RUN, COPY,
  CONTEXT, PLAY. Never more than two words engraved.
- **Conversational copy** (paper voice): full sentences, sentence case,
  end punctuation. Explains consequences, not mechanics: "This discussion
  travels with the card when you connect it to another card."
- Buttons say what they do ("Delete group", never "OK"/"Yes"). Confirms
  repeat object + consequence ("Delete this group? The cards inside stay
  on your board.").
- Errors: what happened → what to do next. No "Oops", no blame, no
  exclamation marks in system text.
- **Punctuation follows grammar, not position.** A hint that is a sentence
  takes a full stop; a hint that is a fragment or a list of terms takes none.
  "Tooltips appear after 600ms of real intent." and "solid only inside a
  confirm" are both correct, and neither may borrow the other's ending.
- **The em dash is banned**, in product copy and in writing about the
  product, as punctuation and as a glyph. A pause takes a comma, colon,
  semicolon, or a rewrite; a dash standing for "no value here" is an en
  dash. Copy arrives from many hands and an em dash is invisible in review,
  so `src/shared/words.test.ts` pins the ban at the words boundary.
- One string per job. If two places ask for the same thing, they ask in the
  same words: a second phrasing reads as a second feature.
- One term per concept (CONTEXT.md is the glossary): card, note,
  connection (never edge/link in UI), Idea, Mod, run.
- **The surface the user owns is the board, lowercase, always.** Not "the
  canvas", not "this Board", not "your workspace". `canvas` names the
  rendering layer in ADR 0011 and stays in engineering speech; a reader who
  meets both words assumes they are two places. British spelling throughout
  user-facing copy: colour, behaviour, organise.
- In-flight copy is the bare state word plus the shared pulse from §6.11:
  `Running`, `Writing`, `Saving`. The pulse carries aliveness, so the word
  never carries an ellipsis.
- Forbidden-vocabulary audits inspect user-visible strings at the shared
  `words.ts` boundary and rendered copy. Internal identifiers, comments,
  and test names are implementation language, not UI copy.
- Numbers speak in mono tabular; dates in `--e-type-value`.

---

## 10. Sizing, density & responsive

**Three height ladders.** Controls: 30 field row / 26 standard / 24 compact /
22 inline / 20 chip. Frames: 44 top bar / 36 card head and dock / 28 menu
row. Instruments: 32 / 30 / 28 / 24. An instrument rides one rung above the
control it resembles, because it is thrown or dragged rather than clicked.
A sixth control height is a bug, not a variant.

**Eight surface widths.** 940 / 860 / 640 / 560 / 360 / 300 / 260 / 200.
Nothing between them.

**Grid.** `minmax(0, 1fr)`, never a bare `1fr`: bare `1fr` refuses to shrink
below its content and is how a page learns to scroll sideways.

- One density. The canvas's density instrument is zoom (detail bands are
  design tokens: Reading ≥ 0.325 / Overview / Map ≤ 0.15, kept exactly).
  A board is not a page, so the canvas has no breakpoints: zoom does the
  same job continuously instead of in two jumps.
- Chrome adapts at exactly two viewport breakpoints, 720 and 560, plus one
  `pointer: coarse` query. Panels become sheets ≤720px; the dock
  horizontal-scrolls (kept).
- Hit areas ≥24px always (visual size may be smaller, the hit-expansion
  pattern in §6.1 closes the gap), ≥40px on coarse pointers. On coarse
  pointers and keyboard focus, hover-revealed chrome shows on selection
  and `:focus-within` instead.
- Responsive specimens (720px sheets, 560px dock) are produced at their
  migration slices' gates: the gallery is desktop-first.

## 11. Accessibility contract

- Text ≥ 4.5:1 on its surface (§1 tables are pre-verified); large text and
  non-text boundaries ≥ 3:1.
- Focus visible on every interactive element (§7); focus is never removed
  without a replacement channel.
- Meaning never rides color alone (line character, symbols, words double
  every hue).
- Reduced motion per §5 rule 10. All type in px today; a rem migration is noted
  in IMPLEMENTATION.md as a code-level follow-up.
- Icon-only controls carry names (aria-label + tooltip).
- **A tooltip is never the only copy of a fact.** `data-tip` is a picture of
  something the accessible name already says. If the tip carries an object
  count ("delete 3 cards"), a shortcut, or the only explanation of a chip, the
  name carries it too. A `<span>` cannot hold focus, so a tip on one is
  mouse-only by construction.
- **State is a fact, not a fill.** A toggled tool, a chosen segment, a kept
  version and an active row each carry the matching attribute (`aria-pressed`,
  `aria-checked`, `aria-current`) alongside the visual. A control whose class
  moves while its attribute stays put reports the opposite of what it shows,
  which is worse than reporting nothing.
- **Arrows point; Enter chooses, except where moving *is* the choice.** A menu
  or a listbox separates moving the cursor from committing a value: arrow keys
  that commit there make an intermediate choice irreversible, because Escape has
  nothing left to undo. A radio group is the sanctioned exception. Selection
  follows focus in a radio group (the ARIA practice, and what `Segmented` and
  `ColourPicker` ship), because every option is reachable, every one is
  reversible by another arrow press, and a group that needed Enter would report
  a checked option the reader never chose. A ranked list dragged by its grip is
  the same case: the arrow *is* the reorder.
- **A control that looks operable is operable.** A resize cursor and a handle
  are a promise. Sliders, pads and scrub bars carry `role`, value attributes
  and a key handler, or they are drawn as pictures and say so.
- **Specimens are not the thing they depict.** A modal specimen printed in the
  page body drops `aria-modal`; a notice specimen drops `role="status"`;
  prose headings inside a card specimen take `role="presentation"`. Otherwise
  the gallery hides its own page, announces fake updates on load, and files
  "Morning bread program" in the document outline.
- Every scrollable region is a tab stop, and every table column header has a
  `scope`.

## 12. Governance

- New work consumes semantic tokens only; a PR adding a raw hex, a fifth
  radius, a new shadow, or a new font size fails review.
- Raw geometry values are limited to the system recipe/token authority and
  the exact shared canvas owners named by the canvas-layer contract:
  `paintedPortGeometry`, `paintedBadgeRadius` /
  `paintedConnectionBadgeGeometry`, `planPaintedConnections`, and the
  shared badge-suppression predicate. A whole-wire hit-width constant must
  live at that shared paint/hit seam with parity coverage, not in a
  component. User colour data and fixtures are data, not authored design
  values. Components choose roles; they do not invent values.
- A new component ships with its state row (rest/hover/pressed/focus/
  selected/disabled/locked/running where applicable) in the living reference
  gallery.
- The gallery holds itself to §11 as strictly as the app does. It is the only
  artifact a reader can operate before they operate Eido, so a keyboard trap or
  an unnamed control there is a defect in the system, not in a demo.
- Copy lands in words.ts, in the voice of §9.
- Function changes route through PROPOSALS.md: never through a restyle.
