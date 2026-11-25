# Generative Board Portrait Model

This document sketches how a procedural activity language could be generated from Eido's existing one-graph model.

It is not an implementation plan yet.

## Data Sources

Eido already treats the board graph as the source of truth, with projections for canvas, semantic context, execution, and playback. A board portrait should follow the same rule.

Potential inputs:

- board id,
- time window,
- card ids, kinds, positions, sizes, colors, and group membership,
- connection ids, endpoints, strengths, roles, and directions,
- intent log events,
- output/version provenance where accepted generated work matters,
- timeline replay or checkpoint data for historic positions.

Avoid deriving meaning from current React/canvas rendering state. The portrait should be rebuildable from saved graph and event data.

## Generator Pipeline

```text
board graph + time window + generator version
-> replay or query board state for the window
-> detect active cards, regions, groups, and connections
-> normalize board geography into portrait coordinates
-> extract board identity palette
-> classify activity events into visual verbs
-> generate deterministic primitives from stable seeds
-> layer regions, dots, chords, halos, density, and texture
-> export image plus editable recipe metadata
```

## Coordinate Model

The generator should preserve spatial recognizability while adapting to small portrait formats.

Candidate coordinate steps:

1. Compute the active board bounds for the selected window.
2. Include nearby inactive landmarks so the user can orient themselves.
3. Normalize positions into portrait space while preserving relative region placement.
4. Apply controlled compression to reduce empty space without collapsing distant clusters.
5. Preserve distinctive long-distance connections as arcs or routes.
6. Store the transform in the recipe.

The output should feel like a low-detail zoomed-out board, tightened into a graphic study.

## Visual Primitive Mapping

| Source | Primitive | Notes |
| --- | --- | --- |
| New card | Dot, capsule, small tile | Position comes from where the card appeared in the board. |
| Edited older card | Halo, ring, overprint echo | Distinguish shaping from new capture. |
| Group or region | Rounded block, translucent hull | Pull from user-created group/frame color when available. |
| Connection | Chord, bridge, or ribbon | Use source and target positions, with seeded curvature. |
| Dense local work | Grain, halftone, larger core | Avoid raw count labels in primary view. |
| Cross-region work | Strong bridge or route | Preserve relation between distant regions. |
| Accepted output/version | Stamp or dense center | Count only if it becomes meaningful board material. |

## Seed Strategy

The generator needs randomness for organic variety, but the randomness must be locked.

Recommended seed inputs:

```text
boardId
timeWindowStart
timeWindowEnd
generatorVersion
eventIds
cardIds
connectionIds
```

Use stable sub-seeds for each generated layer:

```text
portraitSeed = hash(boardId, window, generatorVersion)
cardSeed = hash(portraitSeed, cardId, firstRelevantEventId)
connectionSeed = hash(portraitSeed, connectionId, createdEventId)
textureSeed = hash(portraitSeed, "texture", layerName)
```

Rules:

- A hover state must never reroll a mark.
- A resize should rescale the transform, not change the generated composition.
- Generator changes need versioning because old portraits should not silently redraw into a new style.
- If permanence becomes product-critical, store a recipe or baked image snapshot for finalized portraits.

## Locking Model

There are two possible meanings of "locked":

1. **Reconstructible lock:** The mark can be regenerated exactly because event data, seeds, and generator version are stable.
2. **Archived lock:** The mark is saved as recipe metadata or an image snapshot after formation.

The research preference is:

- use reconstructible lock for live exploration,
- use archived lock for shareable or ceremonial artifacts,
- always include generator version in exported recipes.

## Historic Position Problem

Recognizability depends on location. But boards move.

Possible policies:

| Policy | Benefit | Risk |
| --- | --- | --- |
| Use current position | Matches the board the user sees today. | Old activity can drift away from where it happened. |
| Use event-time position | Preserves the actual historic shape. | May differ from the user's current memory after rearrangement. |
| Use region anchors | Stable if semantic regions persist. | Needs region detection or explicit user grouping. |
| Hybrid | Recent windows use current-ish position; finalized portraits use event-time position. | More complex to explain. |

Initial hypothesis:

- Period portraits should use event-time position.
- Live thumbnails can use current position.
- Zoom/replay should make the distinction visible.

## Recognizability Tests

The system should be evaluated with recognition tests, not only aesthetic review.

Test ideas:

- Show a portrait without labels and ask the user to point to familiar board regions.
- Ask which portrait belongs to which board among several similar boards.
- Compare calendar-first glyphs against board-geography glyphs.
- Move cards after a portrait forms and verify whether the old mark still feels valid.
- Show multiple generator seeds and ask which ones preserve the user's mental map.

Success looks like:

- the user can identify their own board,
- the user can recognize at least a few regions,
- the user trusts that the artifact came from their work,
- the user wants to revisit or share it.

## Performance Posture

This should be a derived projection, not a hot-path canvas feature.

Near-term rule:

- Generate portraits off the interaction path.
- Reuse timeline playback/checkpoint concepts where possible.
- Treat full-window generation as export, overlay, or idle work.
- Do not add full-board scans to typing, dragging, streaming, or animation frames.

The canvas foundation rule still applies: the canvas renders the graph; it should not become the graph database.
