# Next-Level Canvas Performance Architecture

> Date: 2026-06-25
> Status: active architecture direction
> Evidence: local tldraw checkout at `/Users/weili/Documents/Projects/eido/research/repos/tldraw` (`846e39a`) and Eido PR #119 follow-up work.

## Purpose

PR #119 moved Eido from naive React-node rendering toward a canvas/DOM hybrid: far zoom is map-like, massive mid zoom is coherent canvas mid-detail, near zoom has a bounded DOM aperture, and pan regressions are covered. This document defines the next performance step: turn that hybrid into an explicit scene derivation system rather than leaving LOD policy scattered inside `Board.tsx`.

The direction is inspired by tldraw, but does not adopt the tldraw SDK. The reusable lesson is architectural: a board should be typed records plus derived indexes, and each view should consume those derivations.

## tldraw Techniques To Copy

### Incremental adjacency

In tldraw, `packages/editor/src/lib/editor/derivations/bindingsIndex.ts` builds a `Map<ShapeId, Binding[]>` from binding records, then updates it from store history diffs using `getDiffSince(lastComputedEpoch)`. It only copies arrays for changed shape IDs and returns the previous map when nothing changed.

Eido translation:

- Create a `connectionsByCardId` / graph adjacency derivation that updates from changed Connections instead of rebuilding from every Connection.
- Share that derivation between canvas edge rendering, context compilation, selection affordances, and future line/block-anchor traversal.
- Treat weighted/signed Connections as first-class graph edges, not only React Flow edges.

### Viewport culling as a derived set

In tldraw, `notVisibleShapes.ts` derives offscreen shape IDs from viewport bounds and a spatial query. It fast-paths "everything visible", avoids unnecessary subscriptions, and returns the same Set object when contents are unchanged. `useShapeCulling.tsx` centralizes DOM display toggles so each shape does not own its own culling subscription.

Eido translation:

- Make visible/culled card IDs a stable derived result of viewport plus the spatial index.
- Exempt selected, editing, and focused cards from culling/promotion churn.
- Keep the DOM promotion set stable across panning when contents have not changed.
- Centralize culling/promotion policy in a Board Scene module, not individual card components.

### Shape and binding seams

tldraw's `ShapeUtil` and `BindingUtil` keep shape geometry, component rendering, indicators, hit testing, and binding lifecycle behavior behind per-type utilities.

Eido translation:

- Eventually define Eido card-kind utilities for geometry, text weight, mid-detail summary, hit testing, and edit promotion behavior.
- Define Connection utilities for semantic edge rendering, endpoint lifecycle, polarity/weight display, and future block anchors.
- Keep `Board.tsx` as an adapter from Eido records to the current renderer.

### Schema and migration discipline

tldraw records are validated and migratable. Eido does not need tldraw's schema package now, but long-lived boards need the same discipline.

Eido translation:

- New render metadata and future anchor records should be migratable Board records, not transient view hacks.
- Multiplayer later should stream record diffs or operations, not whole-board snapshots on every edit.

## Current Implementation Slice

The `src/canvas/boardScene.ts` module is now the first deep scene seam.

It receives:

- Cards and Connections.
- Outputs, so generated-result text weight belongs to the scene derivation instead of `Board.tsx`.
- The spatial `BoardRenderIndex`.
- Viewport, settled viewport, and viewport size.
- Tool-independent interaction state such as read-only, low zoom, navigation activity, selected cards, and connection visibility.
- The previous scene, when available, so derived Set/Map identities can be reused when their contents have not changed.

It returns:

- Explicit zoom band: far, mid, near, or editing.
- Visible cards and visible connections.
- Visible and culled card ID sets.
- Planned DOM detail cards.
- Canvas card/connection flags.
- Overview suppression IDs.
- Whether React Flow should render normal edges.
- The overview margin.
- Cached card summaries and text weights for canvas mid-detail rendering.
- Canvas hit-test candidates, so the Board adapter does not need to scan all visible cards itself.

This is not a full tldraw-style reactive store yet. It is a pragmatic step that moves LOD, DOM/canvas promotion, card summaries, text-weight derivation, and canvas hit testing behind a small interface, making the next derivations testable without React.

## Recommended Architecture Path

### Implemented small slice

`boardScene` now owns the first four deepening tasks:

- Card text weight, summaries, and text-heavy classification are reusable scene derivations.
- Stable Set/Map identities are reused for unchanged planned IDs, card summaries, and card weights.
- Zoom bands are explicit: far, mid, near, editing.
- Canvas hit-test candidates are returned by the scene and consumed by `Board.tsx`.

### Next small slice

Deepen `boardScene` further:

- Make the selected/editing/focused DOM promotion inputs explicit instead of treating selection as the editing band.
- Split scene derivation from renderer-specific flags once a second renderer needs it.
- Add a browser interaction gate proving canvas-rendered mid-zoom cards are selectable from the overview layer.

### Medium-term refactor

Introduce graph indexes inspired by tldraw's binding index:

- `cardsById`
- `connectionsByCardId`
- `boundsByCardId`
- `visibleCardIds`
- `culledCardIds`
- `cardSummariesById`
- `connectionVisibilityById`

These should be shared by the canvas, compiler, playback, and performance runtime. The deletion test should pass: if the indexes disappear, their logic would otherwise reappear across many callers.

### Long-term direction

Choose one of two paths deliberately:

- MIT-only path: borrow the tldraw store/state ideas but keep Eido's renderer. This avoids SDK licensing and keeps the product graph in Eido's language.
- Licensed canvas path: adopt tldraw editor if the business decision is acceptable, mapping Eido Cards to ShapeUtils and Connections to BindingUtils.

Either path should preserve Eido's "one graph, three views" model: the Board is the truth, and canvas/compiler/playback are projections.

## Performance Gates

- Done: a scene unit test for stable identity when card content/visible IDs do not change.
- Done: a scene unit test for canvas hit-test candidate ordering.
- Done: a browser test proving canvas-rendered mid-zoom cards are selectable.
- Done: a rich text-heavy board perf test where summary derivation updates once per card content change, not per movement frame.
- Done: a dense connection perf test that proves edge planning scales from adjacency, not full scans.
- Done: a current-board validation path that copies the user's private saved board into a temp perf store and runs a skipped-by-default browser gate against it.

## Risks

- A scene module can become shallow if it only mirrors `Board.tsx` names. It must own behavior: zoom bands, promotion, culling, summaries, hit testing, and connection LOD.
- Canvas text can become the next bottleneck if summaries are not cached by card/version.
- Line-level anchors should start as stable internal block IDs, not as visible child shapes for every paragraph.
- tldraw's full editor remains a licensing decision; do not accidentally depend on SDK-only packages in production code.
