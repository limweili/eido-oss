# PRD: Eido Performance Architecture Foundation

## Problem Statement

Eido is beginning to show latency as boards gain more Cards, Connections, Output Versions, Intent Log Events, Undo history, and Playback behavior. The product vision requires users to keep thousands of Cards and Connections on a visual Board while still typing, dragging, zooming, running AI workflows, saving, undoing recent changes, and replaying the meaningful evolution of the Board.

The risk is not a single slow feature. The risk is that many individually useful features keep adding full-board scans, full-board serialization, repeated timeline projection, and high-frequency React updates until the app feels heavy. If this is not addressed now, future feature work will move faster in the short term but create a foundation that cannot support the intended product.

## Solution

Build a shared performance foundation inside the current v3 app. Keep the current product surface and React Flow prototype, but deepen the modules underneath it so future features reuse the same fast paths.

The solution is:

- deterministic Performance Fixtures at realistic scale,
- repeatable performance commands that prove changes help,
- a Timeline Projector that makes Playback fast at large event counts,
- a Graph Index that gives features fast lookup access without repeated array scans,
- browser interaction benchmarks for load, pan, zoom, drag, typing, streaming, and Playback,
- cheaper group-membership reconciliation during drag,
- high-frequency update lanes for typing and streaming,
- persistence and retention rules that separate short Undo from durable Playback.

This is a selective internal rebuild, not a wholesale app rewrite. Eido will not use or migrate to the tldraw SDK or tldraw technology. Reference projects are used only for architectural lessons.

## User Stories

1. As a visual thinker, I want a large Board to remain responsive, so that I can keep all of my thinking in one place.
2. As a visual thinker, I want to create thousands of Cards, so that I do not need to split a messy idea across many separate files.
3. As a visual thinker, I want thousands of Connections to remain navigable, so that dense reasoning still feels usable.
4. As a visual thinker, I want typing in a Card to feel instant, so that the app does not interrupt my thought.
5. As a visual thinker, I want dragging a Card to stay smooth, so that arranging the Board feels physical and direct.
6. As a visual thinker, I want zooming and panning to stay smooth, so that I can move through a large Board without waiting.
7. As a visual thinker, I want Playback to work on large Boards, so that I can understand how my thinking evolved.
8. As a visual thinker, I want Playback to show meaningful actions rather than every keystroke, so that the replay is understandable.
9. As a visual thinker, I want Playback scrub to respond quickly, so that I can jump through time without lag.
10. As a visual thinker, I want opening Playback to be acceptable even on a large Board, so that I can use it confidently during deep work.
11. As a visual thinker, I want Undo to remain fast for recent interactions, so that mistakes are easy to recover from.
12. As a visual thinker, I want Undo and Playback to have different retention rules, so that recent editing stays fast while history remains durable.
13. As a visual thinker, I want generated Output Versions to keep their provenance, so that I know what created each result.
14. As a visual thinker, I want AI streaming not to slow unrelated Cards, so that generated text can arrive without freezing the Board.
15. As a visual thinker, I want group movement to stay fast, so that organizing large clusters does not punish me for having a rich Board.
16. As a visual thinker, I want group membership to remain predictable, so that performance changes do not make grouping feel random.
17. As a visual thinker, I want pasted assets not to bloat every Board operation, so that images and files do not make the app sluggish.
18. As a visual thinker, I want saving to be reliable on large Boards, so that I trust the app with serious work.
19. As a visual thinker, I want exports to keep working, so that performance architecture does not trap my data.
20. As a founder, I want future features to share core performance infrastructure, so that each feature does not invent its own slow history or lookup system.
21. As a founder, I want measurable performance budgets, so that "fast enough" is not subjective.
22. As a founder, I want performance regressions caught before release, so that scale does not silently decay.
23. As a founder, I want the prototype to stay shippable, so that performance work does not become an endless rewrite.
24. As a founder, I want the team to know when a larger rebuild is justified, so that architecture decisions are evidence-based.
25. As an implementer, I want deterministic large Board fixtures, so that performance measurements are comparable across changes.
26. As an implementer, I want a Graph Index interface, so that feature code does not scan full arrays for common lookups.
27. As an implementer, I want lookup-heavy UI code to use shared indexes, so that local feature work stays simple and fast.
28. As an implementer, I want a Timeline Projector interface, so that Playback internals can improve without changing the UI contract.
29. As an implementer, I want browser-level performance tests, so that Node benchmarks are not mistaken for real interaction performance.
30. As an implementer, I want a performance report command, so that I can quickly see whether the Board got faster or slower.
31. As an implementer, I want tests around external behavior, so that performance refactors do not break user workflows.
32. As an implementer, I want clear future-feature gates, so that new work accounts for scale before it is merged.
33. As an implementer, I want the app to keep using the current v3 surface, so that the prototype can continue shipping.
34. As an implementer, I want deep modules with small interfaces, so that the architecture remains understandable.
35. As an implementer, I want persistence rules that preserve full export, so that normalized/internal records do not harm portability.
36. As an implementer, I want coarse semantic events for Playback, so that history is useful without recording every transient UI update.
37. As an implementer, I want high-frequency text and stream updates batched, so that React and persistence do not process every small chunk globally.
38. As an implementer, I want group membership optimized through measured evidence, so that we do not overbuild a spatial index too early.
39. As an implementer, I want the performance architecture documented, so that future agents follow the same rules.
40. As an implementer, I want issue-sized vertical slices, so that each performance improvement is independently verifiable.

## Implementation Decisions

- Keep the current v3 app and current visual product surface.
- Do not use or migrate to the tldraw SDK or tldraw technology.
- Use reference projects only for architectural practice: records, indexed relationships, culling, marked history, file separation, provenance, and retention rules.
- Treat a large Board as 5,000 Cards, 10,000 Connections, 1,000 Output Versions, and 50,000 coarse Intent Log Events.
- Use deterministic Performance Fixtures as the baseline for performance work.
- Keep full-board snapshots for import, export, migration, and explicit checkpoints.
- Stop putting full-board work on typing, dragging, streaming, ordinary render, or animation-frame Playback.
- Keep Undo as a bounded, fast, user-facing stack.
- Keep Playback as durable, semantic history with Checkpoints.
- Build performance improvements as deep modules with small testable interfaces.
- The Timeline Projector is the interface for Playback projection. It can use sorted events, binary search, Checkpoints, workers, or persisted journal data behind the same contract.
- The Graph Index will be the interface for common Board lookups: Card by id, Connections into/out of a Card, group members, Output for Card, Runs for Card, and eventually viewport-visible Cards.
- Feature code should move toward shared Graph Index reads instead of local array scans.
- Browser interaction measurement is required before deciding whether React Flow can carry the prototype through the next scale target.
- Drag-time group membership should be optimized after measurement. The likely first move is reconciling membership on gesture end or using precomputed group bounds.
- Typing and streaming should use a high-frequency update lane that batches visual updates and persistence commits.
- Image performance is an active lane of the rich-card upgrade. Measure paste compression, Board payload, first decode, decoded-pixel residency, thumbnail/passive rendering, gallery activation, pan/zoom, and repeated traversal independently. Use ADR 0024's one-reference/many-derived-renditions boundary; do not assume compressed storage bytes predict runtime cost.
- Asset storage should still evolve from Card-embedded data URLs toward records and blobs, but a full storage migration is not required before a visibility-aware rendition resolver can improve runtime behavior.
- Persistence should eventually move toward normalized records and event/checkpoint persistence. This is not the first implementation slice unless save payload size becomes the dominant measured bottleneck.
- Every future feature should answer the performance gate questions before implementation: what records it reads/writes, whether it is Undoable, whether it participates in Playback, whether it needs indexes, and how it behaves at the large Board target.

## Testing Decisions

- Tests should prove external behavior through module interfaces and app workflows, not private implementation details.
- Performance tests should be deterministic and comparable.
- Node/Vitest benchmarks are useful for module-level timing, especially Timeline Projector and store operations.
- Browser tests are required for user-perceived performance: load, pan, zoom, drag, type, open Playback, scrub Playback, and simulated stream chunks.
- The existing `npm test` suite should remain fast and should not run heavy benchmarks by default.
- Heavy benchmarks should run through explicit performance commands.
- The Performance Fixtures must be tested for deterministic shape and expected sizes.
- Timeline Projector tests must prove projection correctness across creation, movement, deletion, Connections, groups, and intent changes.
- Graph Index tests must prove lookup correctness and stable behavior when arrays change.
- Store operation benchmarks should cover card text, output text, transcript chunks, moving Cards, moving groups, adding/deleting Cards and Connections, run/result creation, and Undo/Redo.
- Browser tests should capture enough metrics to compare regressions: long tasks, script time, approximate frame timing, and relevant operation durations.
- Image-heavy browser fixtures should vary image count, reference dimensions, visible size, cache warmth, and camera speed while reporting compressed bytes separately from decoded-pixel and rendition-cache residency.
- The performance report should print current measurements and, when a baseline exists, compare against it.
- The PRD success target for this phase is:
  - `npm test` passes,
  - `npm run build` passes,
  - `npm run perf:timeline` passes,
  - large fixture 100-frame Timeline Projector scrub remains under 100ms on the local benchmark command,
  - large fixture individual Timeline Projector projection remains under 5ms after projector construction,
  - a store operation benchmark exists for the identified high-risk operations,
  - a browser interaction harness exists for large Board load, pan/zoom, drag, typing, Playback open, Playback scrub, and simulated stream chunks,
  - at least two additional measured bottlenecks beyond Timeline Playback are improved or explicitly deferred with evidence.

## Out of Scope

- Replacing the current canvas with a new canvas engine.
- Migrating to tldraw or using the tldraw SDK.
- Building full multiplayer/collaboration infrastructure.
- Building a complete database sync architecture.
- Guaranteeing final production-scale performance beyond the prototype target.
- Preserving every keystroke in Playback.
- Making Undo unbounded or durable for all time.
- Rewriting every feature to use normalized records in one pass.
- Moving all reference assets to blob storage in the first implementation phase. The image-rendering and decoded-residency lane is in scope; the compatibility-sensitive storage migration remains independently gated.

## Further Notes

The first implemented slice already added deterministic fixtures, `npm run perf:timeline`, a checkpointed Timeline Projector, and playback-only app subscriptions. The large fixture 100-frame Playback scrub improved from roughly 1300ms to roughly 67ms, with an acceptable one-time large-board projector build cost around 100-120ms.

The next implementation work should build the remaining measurement harnesses and then attack bottlenecks in measured order. The expected next targets are Graph Index, drag/group reconciliation, high-frequency text/stream batching, browser interaction budgets, visibility-aware image renditions/decoded residency, and persistence payload strategy.

This PRD should remain the parent issue for the performance architecture program. Implementation issues should be thin vertical slices and should each include a measurable verification command or manual browser measurement.
