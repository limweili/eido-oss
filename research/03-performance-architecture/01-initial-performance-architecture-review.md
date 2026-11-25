# Initial Performance Architecture Review

> Date: 2026-06-21
> Status: first research pass, not an implementation plan
> Scope: v3 local-first React app, current undo/redo, timeline playback, board rendering, graph storage, and future scale requirements.

## CTO Bottom Line

The current v3 architecture is strong for a prototype: one saved graph, explicit card/connection records, provenance-bearing runs, bounded undo stacks, and an append-only `intentLog` that can support playback. The likely slowdown is not simply "undo/redo is too big." The bigger issue is that the app now has multiple features that repeatedly scan, clone, project, and serialize the whole board.

The next architecture step should be a shared performance substrate:

- a normalized graph record store indexed by id,
- derived graph indexes for incoming/outgoing connections, groups, outputs, and runs,
- a command/event journal shared by undo, playback, persistence, and analytics,
- checkpointed playback projections rather than replaying from the beginning every time,
- viewport-aware canvas rendering and cheaper low-zoom/card-preview modes,
- explicit retention rules that keep undo small but make playback durable.

This is worth treating as foundational work before adding many more features.

## Scale Requirement

Eido should adopt this target before new feature work is planned:

> A board with 5,000 cards, 10,000 connections, 1,000 output versions, and 50,000 coarse timeline events must remain interactive for typing, dragging, selection, zoom/pan, AI streaming, and playback. Playback must work at this scale, but it does not need to preserve every keystroke or animation frame.

Working budgets to validate later:

| Interaction | Target |
| --- | --- |
| Typing in an active card | No visible lag; no full-board serialization per keystroke |
| Dragging selected cards | 60fps target, no full-board playback projection during drag |
| Zoom/pan | No card rerender storm; hidden/offscreen cards should be cheap |
| AI streaming | Batched UI updates; streaming text should not rebuild unrelated outputs |
| Playback scrub | Projection should be bounded by checkpoint delta, not full event history |
| Save | Incremental/event-based persistence; full snapshot only as checkpoint/export |

## Findings

### P0 - Playback Projection Runs Even When Playback Is Closed

Evidence:

- `src/App.tsx:22-26` subscribes the app root to `cards`, `connections`, `outputs`, `runs`, and `intentLog`.
- `src/App.tsx:33-51` constructs `liveBoard`, computes the timeline range, and calls `projectBoardAt(...)` on render.
- `src/App.tsx:113-119` only uses the projection when `playbackOpen` is true.

Why this matters:

`projectBoardAt` is expensive enough to care about. It sorts the event log, reverse-applies all events from the current board to rebuild the beginning, then applies events forward to the target time. Today that work can run even while the user is not in playback. Because `liveBoard` depends on `outputs` and `runs`, AI streaming and result updates can also invalidate playback projection even though `projectBoardAt` only needs cards, connections, and the intent log.

Recommendation:

This should be the first quick validation/fix candidate: gate projection behind `playbackOpen`, remove `outputs` and `runs` from projection dependencies, and add a regression/perf test or profiler mark around projection count.

### P0 - Timeline Scrubbing Is O(events + board) Per Projection

Evidence:

- `src/graph/timeline.ts:47-53` sorts all events every call.
- `src/graph/timeline.ts:68-85` starts from the current board, reverses every event, then applies events up to the target time.
- `src/graph/timeline.ts:87-101` allocates fresh arrays and `Set`s for every projection.
- `src/App.tsx:57-61` only debounces scrub projection by 45ms, so fast scrubbing or playback can still project frequently.

Why this matters:

The current approach is fine for dozens or hundreds of events. It will not hold for tens of thousands. It also guarantees playback gets slower as the user loves the product more.

Recommendation:

Playback should move to a persistent event journal plus periodic checkpoints. Projection should use:

- pre-sorted events,
- binary search by timestamp,
- snapshots/checkpoints every N events or M seconds,
- incremental projection while playing forward,
- coarse semantic event granularity.

For example: create card, delete card, connect cards, move gesture ended, resize gesture ended, run started/completed, version chosen, group changed. Not every keystroke.

### P1 - The Store Uses Arrays As The Primary Interface For Everything

Evidence:

- `SavedBoard` stores `cards`, `connections`, `outputs`, and `runs` as arrays in `src/graph/types.ts:411-419`.
- The Zustand state mirrors those arrays in `src/graph/store.ts:456-463`.
- Lookup helpers are scans: `cardById`, `incomingConnections`, `outgoingConnections`, and `membersOf` in `src/graph/graphHelpers.ts:5-21`.
- Many store actions do repeated `.find`, `.filter`, and `.map` work over full arrays, for example `addConnection` in `src/graph/store.ts:1345-1373` and `beginRun` in `src/graph/store.ts:1588-1716`.

Why this matters:

Arrays keep the code simple, but they make it easy for future features to add hidden O(n) and O(n*m) costs. At thousands of cards and connections, the performance risk is less one bad line and more death by many innocent scans.

Recommendation:

Create a deep graph index module with a small interface. It should expose lookups like `cardById`, `connectionsInto(cardId)`, `connectionsOutOf(cardId)`, `membersOf(groupId)`, `outputForCard(cardId)`, `runsByCard(cardId)`, and `visibleCards(viewport)`. Internally it can start as memoized maps over arrays, then later become a normalized record store or database adapter. The interface is the important seam.

### P1 - Rendering Subscribes Many Card Components To Full Arrays

Evidence:

- `Board` maps all cards into React Flow nodes and all connections into edges in `src/canvas/Board.tsx:537-583`.
- Each card renderer often calls `useGraph((s) => s.cards.find(...))`; examples include `NoteCard` at `src/canvas/cards/NoteCard.tsx:11-16`, `CardShell` at `src/canvas/cards/CardShell.tsx:76-82`, and many other card files.
- `WeightedSignedConnection` does a connection lookup with `s.connections.find(...)` in `src/canvas/connections/WeightedSignedConnection.tsx:21-23`.
- React Flow's own performance docs warn against accessing changing node/edge arrays in components and recommend decoupled state plus memoization: <https://reactflow.dev/learn/advanced-use/performance>.

Why this matters:

Even if each `.find` is small today, a board with thousands of cards means every store update can cause many selectors to rescan and many nodes/edges to receive fresh objects. This is especially risky during dragging, typing, and streaming.

Recommendation:

Short term: add memoized selectors and shallow equality where possible, memoize node/card components, and avoid subscribing components to whole arrays. Medium term: move card/connection reads behind the graph index module. Long term: use viewport culling and maybe a canvas/editor layer designed around indexed records.

### P1 - Movement And Group Membership Reconcile The Whole Board

Evidence:

- `moveCard` calls `reconcileGroupMembership(...)` on every position update in `src/graph/store.ts:1091-1115`.
- `reconcileGroupMembership` maps every card and calls `groupForCard` in `src/graph/store.ts:367-370`.
- `groupForCard` filters all cards to candidate groups and sorts candidates by area in `src/graph/store.ts:342-365`.
- `Board.onNodesChange` calls `moveCard` during position changes in `src/canvas/Board.tsx:585-631`.

Why this matters:

Dragging a card can trigger frequent state updates. If every update scans all cards and sorts group candidates, group support becomes increasingly expensive as the board grows.

Recommendation:

Treat group membership as a spatial index problem. Keep drag-time updates cheap; reconcile group membership at gesture end or against a precomputed group bounds index. For scale, investigate R-tree/grid index options or use the canvas engine's spatial index if we adopt one.

### P1 - Persistence Saves Whole Board Snapshots

Evidence:

- Every committed change calls `persist()` in `src/graph/store.ts:624-659`.
- `persist()` passes `get().snapshot()` to the debounced saver in `src/graph/store.ts:624-628`.
- `snapshot()` returns full arrays for cards, connections, outputs, runs, and intentLog in `src/graph/store.ts:833-845`.
- The IndexedDB/disk save writes a full `SavedBoard` under one board key in `src/graph/save.ts:218-235` and `src/graph/save.ts:320-325`.

Why this matters:

Debouncing helps frequency, but not payload size. Once output versions, assets, runs, and playback events grow, every save payload becomes large. This also makes crash recovery and multi-device sync harder.

Recommendation:

Keep full snapshots as checkpoints/export format, but move ordinary persistence toward append-only operations plus normalized records. A persistent database should store cards, connections, outputs, runs, assets, and events separately.

### P2 - High-Frequency Text And Stream Updates Traverse Output/Card Arrays

Evidence:

- `setCardText` maps over all cards on each text change in `src/graph/store.ts:1049-1057`.
- `appendVersionText` maps over every output and every version in `src/graph/store.ts:1774-1785`.
- `appendTranscriptChunk` maps over every output, every version, and transcript messages in `src/graph/store.ts:2209-2227`.
- `NoteCard` calls `setCardText` directly on textarea `onChange` in `src/canvas/cards/NoteCard.tsx:73-82`.

Why this matters:

Typing and streaming are exactly where users feel latency. These paths should touch only the active card/version plus a tiny number of derived indexes.

Recommendation:

Batch or debounce content writes separately from visual editing state. Store streaming text in a version-indexed structure, update UI at animation-frame cadence, and persist chunks/events on a lower-frequency schedule.

### P2 - Assets Live Inside Card Records As Data URLs

Evidence:

- `CardAsset` stores `dataUrl` in `src/graph/types.ts:49-59`.
- `Card` embeds `assets?: CardAsset[]` in `src/graph/types.ts:123-148`.
- Source-context hashing includes asset data URLs in `src/brain/sourceContext.ts:221-229`.

Why this matters:

Large pasted assets will bloat in-memory board state, saved snapshots, source-context hashes, exports, and playback event payloads. This will become painful before thousands of cards if users paste images/files.

Recommendation:

Assets should become separate blob records keyed by id/hash. Cards should reference asset ids plus lightweight metadata. Hashing and playback should use asset metadata/content hash, not embedded base64 strings.

### P2 - Undo Is Bounded, But Playback And Undo Need Different Storage Rules

Evidence:

- `HISTORY_LIMIT = 50` in `src/graph/history.ts:3-8`.
- Undo/redo stacks are transient Zustand arrays in `src/graph/store.ts:469-470`.
- `intentLog` is persisted in the saved board in `src/graph/types.ts:411-419`.

Why this matters:

The 50-entry undo stack is not likely to be the main memory problem. The architecture risk is conflating short interactive undo with durable playback. Undo wants nearby, exact, reversible diffs. Playback wants persistent, queryable, coarse, explainable events.

Recommendation:

Separate the two formally:

- Undo: bounded in-memory mark/diff stack, maybe persisted only for crash restore.
- Playback: durable event journal with semantic event types, timestamps, actor/source, affected ids, and periodic board checkpoints.

## Reference Repo Lessons

### React Flow

React Flow's performance guidance maps directly to current risks: memoize node/edge components and callbacks, avoid components that depend on frequently changing node/edge arrays, collapse large node trees, and simplify complex styles when node counts grow. Source: <https://reactflow.dev/learn/advanced-use/performance>.

Implication for Eido:

React Flow may still be viable for the next validation round, but only if we respect its performance model. The current app is close to several documented pitfalls.

### tldraw Reference Only

Scope note: tldraw is a reference project only. Eido will not use the tldraw SDK or migrate the canvas/store to tldraw technology in this performance upgrade. The useful material is architectural practice, not dependency adoption.

tldraw treats the editor store as a reactive database of records with validation, schema, undo/redo, persistence, and synchronization. Source: <https://tldraw.dev/sdk-features/store>.

tldraw bindings are persistent relationship records, and the binding index updates incrementally so relationship lookups do not require scanning all records. Source: <https://tldraw.dev/sdk-features/bindings>.

tldraw culling hides off-viewport shapes and uses incremental derivations to keep thousands of shapes practical. Source: <https://tldraw.dev/sdk-features/culling>.

tldraw history batches rapid changes into undo steps separated by marks, avoiding every mouse move or keystroke becoming a separate user-facing undo. Source: <https://tldraw.dev/sdk-features/history>.

Implication for Eido:

Borrow the architecture shape: records, indexed relationships, culling, migrations, and marked history. Implement those ideas in Eido's current app where they pay for themselves.

### Excalidraw

Excalidraw's public API distinguishes scene updates, app state, files, and history capture behavior. `captureUpdate` controls whether an update enters undo/redo, and `getFiles` warns that files may exist beyond currently referenced elements. Sources: <https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/props/excalidraw-api> and <https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils>.

Implication for Eido:

Eido should distinguish document records, session state, file/blob storage, and history capture. The current `SavedBoard` bundles too much into one persistence unit.

### n8n

n8n's item linking tracks metadata connecting outputs back to the inputs used to create them. Source: <https://docs.n8n.io/data/data-mapping/data-item-linking/item-linking-concepts/>.

n8n's scaling docs include execution-data pruning and max-count controls. Source: <https://docs.n8n.io/hosting/scaling/execution-data/>.

Implication for Eido:

Generated outputs and playback events need lineage and retention rules. The user should be able to ask "what produced this?" without storing unlimited high-granularity browser memory forever.

## Opportunity Backlog For Further Research

These are opportunities to validate, not implementation tickets yet.

1. **Baseline performance harness**
   Create synthetic boards at 100, 1,000, 5,000, and 10,000 cards/connections. Measure drag, typing, zoom, AI streaming, playback open, playback scrub, save payload size, memory, and long tasks.

2. **Playback projection architecture**
   Prototype event checkpoints, binary-search event lookup, incremental forward playback, and coarse event schemas. Validate that playback remains fast at 50,000 events.

3. **Graph index module**
   Introduce a deep module around graph lookup and derived indexes. First adapter can sit on current arrays; future adapters can use normalized records or a database.

4. **Normalized persistence**
   Research IndexedDB with record stores, SQLite/OPFS, ElectricSQL/SQLite sync options, and whether assets need content-addressed blob storage.

5. **Canvas rendering strategy**
   Benchmark React Flow with proper memoization, hidden/collapsed cards, low-zoom rendering, and viewport culling. Compare the current app against rendering best practices from tldraw and Excalidraw, not against adopting their SDKs.

6. **High-frequency update lane**
   Separate typing and streaming from durable graph commits. Validate batched UI updates and lower-frequency persistence without losing crash safety.

7. **Timeline granularity policy**
   Define exactly which actions belong in durable playback. Do not include every keystroke by default. Prefer summary events like "edited card text" with before/after hashes or periodic text snapshots.

8. **Asset storage strategy**
   Move pasted files/images out of card records and snapshots. Use ids/hashes in graph records.

9. **Future-feature performance governance**
   Make every feature declare read/write scope, event types, indexes needed, expected board scale, and performance acceptance tests.

## Future Feature Requirements

Any future feature should meet these architecture rules:

- It must use shared graph commands/events for durable board changes.
- It must declare whether each change is undoable, playable, persisted, or ephemeral session state.
- It must avoid full-board scans in render paths, drag paths, typing paths, streaming paths, and playback ticks.
- It must use the graph index module for lookups; if a lookup is missing, add it there rather than scanning in a feature component.
- It must avoid storing large blobs directly in cards, connections, runs, output versions, or playback events.
- It must define a playback event shape if the feature changes the board in a way users expect to replay.
- It must define retention rules for any unbounded data it creates.
- It must pass scale fixtures before merge once those fixtures exist.
- It must keep visual rendering separate from semantic graph records. The canvas is an adapter, not the source of truth.
- It must consider low-zoom and offscreen behavior from the start.

## Recommended Process From Here

### Step 1 - Baseline And Reproduce

Build a deterministic performance harness. Use synthetic boards and scripted interactions so we can reproduce latency and compare architecture candidates. This is the diagnosis feedback loop.

Outputs:

- perf fixture generator,
- measurement script or Playwright/Chrome trace harness,
- current baseline report,
- top measured bottlenecks.

### Step 2 - Reference Repo Validation

Deepen source research only where it answers a measured problem:

- React Flow: controlled vs uncontrolled store patterns, culling/visibility, memoization limits.
- tldraw reference patterns: store records, culling, bindings, history marks, migrations, sync.
- Excalidraw: scene/render architecture, restore/repair, file storage, history capture.
- n8n: execution lineage, pruning, partial execution, run state.

Outputs:

- short source notes per bottleneck,
- decision matrix for optimizing the current React Flow app versus selectively rebuilding specific internals, informed by reference repo patterns.

### Step 3 - Architecture Candidates

Produce 2-3 candidate architectures with tradeoffs inside the current app:

- conservative React Flow optimization,
- React Flow plus a deeper graph/event substrate,
- selective rebuild of the canvas adapter or graph store internals if measurement proves it is worth it.

Each candidate should cover graph storage, canvas rendering, undo, playback, persistence, assets, output provenance, future collaboration, and migration path.

### Step 4 - Decision And ADRs

Pick a path and record the decision as ADRs before implementation. Important ADRs likely include:

- graph store and index interface,
- playback event journal and checkpoint policy,
- canvas engine posture,
- persistence/database choice,
- asset storage policy,
- feature performance acceptance rules.

### Step 5 - PRDs

Turn the chosen architecture into PRDs:

- performance harness PRD,
- graph index PRD,
- event journal/playback PRD,
- normalized persistence PRD,
- canvas scaling PRD,
- asset storage PRD,
- future feature governance PRD.

### Step 6 - Issues

Break PRDs into independently shippable issues. Prefer tracer-bullet slices that deliver one end-to-end capability at a time: measure, introduce seam, migrate one read path, migrate one write path, verify.

### Step 7 - Implementation

Implement in risk order:

1. Baseline harness.
2. Low-risk quick wins.
3. Graph index seam.
4. Playback projection rewrite.
5. Persistence normalization.
6. Canvas rendering/culling architecture.
7. Asset storage and retention.

## Initial Recommendation

Do not jump directly to a new canvas framework. First, measure and remove the most obvious architectural waste: closed-playback projection, repeated timeline sorting/replay, render-time full-array subscriptions, and drag-time group reconciliation. In parallel, research the larger architecture around the graph index and event journal because those are likely to stay valuable as Eido selectively rebuilds internals while keeping the current app usable.

The core CTO recommendation is:

> Build the shared graph/event/performance substrate before adding many more features. Make feature builders faster by giving them deep modules with small interfaces, not by asking every feature builder to remember every performance rule manually.

## Open Questions For The Next Pass

- What is the actual measured cost of playback projection today at 1,000 and 5,000 events?
- Can React Flow meet the target if we memoize selectors, gate projection, collapse/low-zoom cards, and cull hidden regions?
- Which tldraw/Excalidraw best practices should Eido copy into its own architecture without adopting their SDKs?
- Should durable storage be IndexedDB record stores, SQLite over OPFS, a local server-side SQLite file, or another local-first database?
- What exact event types belong in timeline playback, and what should be compacted?
- What retention defaults should the product promise to users for undo, playback, outputs, and assets?
