# Activity Portrait Design System

This is a first-pass design system for future exploration. It is intentionally not final product language.

## Design Principles

1. **The board is the composition.** Time windows, grids, and sheets are containers. The board's geography supplies the internal layout.
2. **Recognition beats consistency.** A generated mark can vary if the user can still recognize their own regions, colors, and clusters.
3. **A mark is a journal entry.** The artifact records what happened. It does not demand completion.
4. **Procedural detail must be accountable.** Every major visual decision should trace back to board state, an intent event, or a seeded recipe.
5. **Color starts from the board.** System accent colors can clarify verbs, but user-created region colors carry identity.
6. **Texture is memory, not decoration.** Grain, halftone, spray edges, and overprint should make the artifact feel printed and preserved.
7. **Zoom discloses truth.** The further in the user goes, the more directly the artifact should reveal the actual board and cards.

## Core Objects

| Object | Description | Possible Source Data |
| --- | --- | --- |
| Board portrait | A compressed rendering of a board during a time window. | Board snapshot, event replay, card positions, connections, colors. |
| Activity glyph | A small portrait for a day, session, cluster, or thought set. | Filtered intent events plus board geography. |
| Region mark | A simplified shape representing a familiar board area. | Groups, card clusters, colors, hulls, repeated activity. |
| Connection trace | A visible bridge between thoughts or regions. | `connection.created`, graph paths, cluster-to-cluster links. |
| Return halo | A mark showing renewed work on older material. | Edit or follow-up events on older cards. |
| Density field | Texture and mass that show intensity without turning into a number. | Event counts, edited text volume, interaction count. |
| Recipe | The seed, rules, version, palette, and generated layers behind a portrait. | Generator metadata. |

## Event Verbs

The old proposal used Capture, Connect, Return. The feedback keeps Capture and Connect but asks for a richer vocabulary.

Candidate verbs:

| Verb | Meaning | Visual Direction |
| --- | --- | --- |
| Capture | A new thought enters the board. | Dot, small capsule, or colored seed at board position. |
| Connect | Two thoughts or regions are tied together. | Chord, bridge, ribbon, or overprinted line. |
| Shape | Existing material is edited, moved, grouped, titled, or reorganized. | Contour, resized block, soft frame, or displaced edge. |
| Revisit | Older material becomes active again after time has passed. | Halo, ring, echo dot, or darker overprint around an old point. |
| Gather | A region forms around multiple thoughts. | Translucent rounded rectangle, hull, or modular tile field. |
| Distill | Work resolves into an output, summary, or chosen version. | Solid stamp, core, label tab, or denser center. |
| Thread | A line of thinking persists across windows. | Ribbon, repeated region glow, or path through portraits. |

The system should not force all verbs into every view. A small glyph might expose only three. A detailed portrait can expose more.

## Visual Vocabulary

### Geometry

- dots for thought presence,
- capsules for live strands,
- rounded rectangles for regions and groups,
- arches and half-circles for partial or unresolved work,
- chords for connections,
- rings or halos for revisits,
- dense cores for distillation,
- scribbles and annotation marks for study/exploration views only.

### Color

Use three color layers:

1. **Paper layer:** off-white, soft grey, graphite, faint embossed quiet states.
2. **Board identity layer:** colors extracted from card kinds, group frames, or user-created regions.
3. **Action layer:** optional accents that clarify verbs when board color alone is not enough.

The board identity layer should dominate in portraits. The action layer should behave like notation.

### Texture

- fine grain on all printed surfaces,
- halftone or spray edge where a region has high activity density,
- misregistration for locked procedural tactility,
- multiply-like blending where thoughts overlap,
- roughened connection strokes for human feel.

Texture must be seeded and stable. It should never shimmer during ordinary UI interaction.

## Layout Modes

| Mode | Role | Notes |
| --- | --- | --- |
| Live thumbnail | Small current-state portrait in the board chrome. | Ambient, low-detail, no pressure. |
| Session stamp | A portrait of a focused work session. | Useful for recent work and replay entry points. |
| Day glyph | A compact day-level mark. | Can sit in a strip or study sheet. |
| Week sheet | A row or loose group of day/session glyphs. | Should avoid guilt-driven completion language. |
| Period portrait | Larger month/project/window artifact. | Best home for recognizable board geography. |
| Replay overlay | Zooms from portrait into actual board history. | Should connect to Timeline Playback. |
| Share card | Exportable artifact with optional caption. | Must preserve privacy controls. |

## Interaction Rules

- Hovering a mark should reveal the related board region, not just counts.
- Selecting a mark should offer "show on board" or equivalent navigation.
- Zooming in should preserve meaning while adding detail.
- Labels should be optional and secondary.
- Empty or quiet periods should look like faint paper presence, not missing progress.
- The system should never compare the user to other users.
- The system should avoid streaks unless the user explicitly asks for habit tracking later.

## Component Candidates

| Component | Purpose |
| --- | --- |
| Activity strip | Ambient recent glyphs near the board, probably in or near the bottom dock. |
| Portrait overlay | Full-screen view for a selected window or project. |
| Region inspector | Hover/focus view that maps a visual region back to board cards. |
| Recipe inspector | Research/developer-only view of seed, palette, layers, and event sources. |
| Export sheet | Shareable or archival composition of portraits and captions. |
| Recognition test view | Internal research tool that hides labels and asks what the user recognizes. |

## Tone

Use second-person past tense for product copy:

- "You shaped this corner again."
- "These ideas were tied together."
- "This region came back into focus."

Avoid:

- activity levels,
- grades,
- productivity scores,
- broken streaks,
- leaderboards,
- empty-day warnings.

## First Design Bet

The strongest initial bet is a **period portrait**: a larger artifact for a chosen day, week, month, or named project window that compresses the board's geography with tactile procedural rendering.

This should come before a calendar page. If the portrait works, it can later be arranged into sheets, strips, and timelines.
