# Performance Upgrade Operating Plan

> Date: 2026-06-21
> Status: operating plan for implementation research
> Decision: improve the current v3 app and selectively rebuild internal modules only when measurement proves it is worthwhile. Do not use or migrate to the tldraw SDK.

## Executive Call

We should keep the current app as the product surface and rebuild selectively underneath it. The valuable rebuilds are not "replace the app"; they are deeper modules at the right seams:

- graph lookup/indexing,
- timeline projection/playback,
- command/event capture,
- high-frequency typing/streaming update lanes,
- canvas adapter rendering inputs,
- persistence payload shape.

This keeps the prototype shippable while giving it a foundation that can scale after pre-release.

## Non-Goals

- No tldraw SDK.
- No tldraw migration.
- No wholesale canvas rewrite unless the performance harness proves React Flow cannot meet prototype-scale targets after the obvious fixes.
- No full database rewrite as the first move.
- No feature freeze while we build a perfect future architecture.

## Skill Discipline

This upgrade should explicitly follow these skills and local equivalents:

| Skill | How It Applies |
| --- | --- |
| [diagnosing-bugs](https://github.com/mattpocock/skills/blob/main/skills/engineering/diagnosing-bugs/SKILL.md) | Build a tight performance feedback loop before fixing. For performance regressions, measure first, then test falsifiable hypotheses. |
| [tdd](https://github.com/mattpocock/skills/blob/main/skills/engineering/tdd/SKILL.md) | Use vertical slices: one behavior/perf expectation, one failing test or benchmark, one implementation, then refactor. Avoid writing all tests up front. |
| [domain-modeling](https://github.com/mattpocock/skills/blob/main/skills/engineering/domain-modeling/SKILL.md) | Keep product terms precise: Board, Card, Connection, Playback, Event, Output Version. If a term changes, update glossary/docs as part of the work. |
| [codebase-design](https://github.com/mattpocock/skills/blob/main/skills/engineering/codebase-design/SKILL.md) | Design deep modules with small interfaces. The graph index and timeline projector should hide complexity and become the test surface. |

## Performance Tooling To Build First

These tools are part of the product engineering work, not optional extras.

### 1. Synthetic Board Generator

Create deterministic fixtures:

| Fixture | Cards | Connections | Output Versions | Timeline Events |
| --- | ---: | ---: | ---: | ---: |
| smoke | 100 | 200 | 20 | 500 |
| medium | 1,000 | 2,000 | 200 | 5,000 |
| large | 5,000 | 10,000 | 1,000 | 50,000 |

The generator should produce realistic mixes of notes, groups, Ask AI cards, result cards, connections, runs, and playback events. It must be deterministic by seed so regressions are comparable.

### 2. Timeline Projection Benchmark

Measure:

- `timelineRange(intentLog)`,
- `projectBoardAt(board, start)`,
- `projectBoardAt(board, middle)`,
- `projectBoardAt(board, end)`,
- repeated scrub sequence across 100 time points.

This benchmark should run in Vitest or a Node-compatible harness without opening the browser.

### 3. Store Operation Benchmark

Measure critical operations against synthetic boards:

- set card text,
- append output text,
- append transcript chunk,
- move one card,
- move a group,
- add/delete connection,
- add/delete card,
- create/run result placeholder,
- undo/redo structural change.

The first goal is comparative numbers, not perfect thresholds.

### 4. Browser Interaction Harness

Use Playwright or Chrome performance tracing for:

- load board,
- pan/zoom,
- drag a card,
- type in a note,
- open playback,
- scrub playback,
- stream simulated output chunks.

Record long tasks, approximate FPS, memory, and script time.

### 5. Performance Budget Report

Add a repeatable report command that prints current numbers and compares against previous baselines when available. This becomes the team's "is it still fast?" check.

## Implementation Strategy

### Slice 1 - Measurement Harness

Use the diagnosis loop first. Build a red-capable performance feedback loop: it must drive the actual code path and show when a path exceeds an agreed budget or gets meaningfully worse.

Expected outputs:

- fixture generator,
- timeline benchmark,
- initial baseline report.

Status: implemented for timeline projection. See [03 Slice 1 Baseline And Playback Upgrade](03-slice-1-baseline-and-playback-upgrade.md).

### Slice 2 - Obvious Playback Waste

TDD target:

> When playback is closed, ordinary board updates do not call timeline projection.

Likely change:

- gate projection behind `playbackOpen`,
- remove `outputs` and `runs` from projection dependencies,
- avoid constructing playback-only board data while not in playback.

This is low risk and likely high value.

Status: implemented for the app root playback path. Playback subscriptions now mount only while playback is open. Browser-level interaction measurement is still needed.

### Slice 3 - Timeline Projector Module

Deep module target:

```ts
type TimelineProjector = {
  range: TimelineRange | null
  projectAt(at: string | number | Date): TimelineProjection
}
```

The implementation can start with current arrays, then add sorted-event caching, binary search, and checkpoints behind the interface. Tests should use the interface, not internals.

Status: implemented with sorted-event caching, binary search, and in-memory checkpoints. Future work may move checkpoint construction to a worker or persistent event-journal layer if playback-open cost becomes visible.

### Slice 4 - Graph Index Module

Deep module target:

```ts
type GraphIndex = {
  card(id: string): Card | undefined
  connectionsInto(cardId: string): Connection[]
  connectionsOutOf(cardId: string): Connection[]
  membersOf(groupId: string): Card[]
  outputForCard(cardId: string): Output | undefined
}
```

First adapter: builds maps from current arrays. Later adapter: normalized records or persistent database. Feature code should move to this interface gradually.

### Slice 5 - Drag-Time Group Reconciliation

Use measurement to decide whether to:

- reconcile group membership only on drag end,
- use a precomputed group-bounds index,
- or add a lightweight spatial index.

The public behavior should stay the same: cards still join groups predictably.

### Slice 6 - High-Frequency Update Lane

Typing and streaming should stop paying full board costs. Candidate work:

- local edit buffer for active text areas,
- commit on idle/blur or short debounce,
- stream chunks through animation-frame batching,
- persist semantic chunks or final text separately from UI paint cadence.

### Slice 7 - Persistence Shape

Do this after the graph index/event seams exist. Keep full-board export, but ordinary save can move toward incremental records/checkpoints without changing the UI.

## Rebuild Policy

Selective rebuilds are allowed when they pass this test:

1. Measurement identifies a real bottleneck.
2. The current module has no good seam to fix it locally.
3. The replacement creates a deeper module with a smaller interface.
4. Existing behavior can be protected by tests/benchmarks.
5. The change can ship as a vertical slice without blocking normal app use.

## Future Feature Gate

Before implementing a new feature, answer:

- What board records does it read?
- What board records does it write?
- Is the change undoable?
- Is the change part of playback?
- Is it persisted, ephemeral, or session-only?
- Does it need an index lookup?
- What happens at 5,000 cards and 10,000 connections?
- What synthetic fixture or browser script proves it does not degrade the board?

## First Improvement Candidates

1. Gate playback projection when playback is closed.
2. Add timeline projection benchmark fixtures.
3. Add `TimelineProjector` interface and sorted-event caching.
4. Add `GraphIndex` interface over current arrays.
5. Move card/connection lookup-heavy code paths to the index.
6. Change drag-time group membership to cheaper reconciliation.
7. Add stream batching for output text.

## Confidence

High confidence:

- The current app can be upgraded without a wholesale rewrite.
- Playback projection and full-array scans are real risks.
- A graph index module and timeline projector are the right first seams.
- Testing/benchmark tooling should be built before deeper changes.

Medium confidence until measured:

- How far React Flow can carry the prototype once optimized.
- Whether persistence must move to normalized records before pre-release.
- Which drag/render bottleneck dominates at 5,000 cards.

Low confidence / do not decide yet:

- Any final long-term canvas technology decision.
- Any full database architecture choice.
