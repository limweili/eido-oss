# Performance Architecture Implementation Pipeline

> Date: 2026-06-21
> Parent PRD: <https://github.com/limweili/eido/issues/86>
> Status: published to GitHub Issues and wired with native sub-issue/dependency relationships.

## Testable Goal For This Performance Upgrade Track

The current implementation target is **Performance Foundation v1**:

- the PRD and issue pipeline are published and linked,
- a unified performance report command exists,
- Timeline Projector large-fixture scrub remains under `100ms` for 100 frames,
- Timeline Projector large-fixture individual projections remain under `5ms` after projector construction,
- store operation benchmarks exist for the identified high-risk Board mutations,
- browser interaction measurement exists for large Board load, pan/zoom, drag, typing, Playback open, Playback scrub, and simulated streaming,
- at least two measured bottlenecks beyond Timeline Playback are improved or explicitly deferred with evidence.

Current local evidence:

- Store bottleneck improved: group reconciliation dropped large-fixture `moveGroup` from `926.92ms` to `2.42ms` in the latest rebased report.
- Browser bottleneck improved: large Board browser load moved from a `120s` timeout to a measured `1019.75ms` after low-zoom Connection simplification, viewport culling, and scoping visual decay to visible Cards.

This goal is intentionally stricter than the first playback fix. It requires measurement across Playback, store operations, and browser interactions before calling the performance foundation complete.

## Published Issues

| Issue | Type | Blocked By | Purpose |
| --- | --- | --- | --- |
| [#87](https://github.com/limweili/eido/issues/87) | AFK | None | Add unified budget report command. |
| [#88](https://github.com/limweili/eido/issues/88) | AFK | #87 | Add store operation benchmark for scale fixtures. |
| [#89](https://github.com/limweili/eido/issues/89) | AFK | #87 | Add browser interaction harness for large Board workflows. |
| [#90](https://github.com/limweili/eido/issues/90) | AFK | #88 | Introduce Graph Index for Board lookups. |
| [#91](https://github.com/limweili/eido/issues/91) | AFK | #89, #90 | Move lookup-heavy render paths to shared indexes. |
| [#92](https://github.com/limweili/eido/issues/92) | AFK | #88, #89, #90 | Optimize drag-time group reconciliation. |
| [#93](https://github.com/limweili/eido/issues/93) | AFK | #88, #89 | Batch high-frequency text and stream updates. |
| [#94](https://github.com/limweili/eido/issues/94) | AFK | #87, #88 | Measure persistence payloads and define retention rules. |
| [#95](https://github.com/limweili/eido/issues/95) | AFK | #89 | Reduce Playback open cost if browser measurement requires it. |
| [#96](https://github.com/limweili/eido/issues/96) | AFK | #87, #88, #89 | Add future-feature performance gate. |

## Execution Order

1. Finish #87 so every future slice has a shared report surface.
2. Finish #88 and #89 to measure store and browser bottlenecks before deeper changes.
3. Finish #90 to give feature code a shared Graph Index.
4. Use #88 and #89 evidence to choose the order of #91, #92, #93, #94, and #95.
5. Finish #96 once the commands and shared modules are stable enough to point feature builders at them.

## Completion Evidence

The performance track is not complete until current-state evidence proves the goal:

- GitHub issue structure reads back correctly from the tracker.
- Local docs match the published issue plan.
- `npm test` passes.
- `npm run build` passes.
- `npm run perf:report` or its successor passes the configured budgets.
- Store and browser benchmark outputs are recorded in the research track.
- Implemented optimizations have before/after measurement or explicit evidence-based deferral.
