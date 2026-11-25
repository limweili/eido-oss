# Performance: add browser interaction harness for large Board workflows

## Parent

Parent PRD: #86

## What to build

Add a browser-level performance harness that measures real user interaction workflows on a large Board. The harness should verify that Node/Vitest micro-benchmarks are not hiding UI costs. It should cover loading a large Board, pan/zoom, dragging a Card, typing in a note, opening Playback, scrubbing Playback, and simulated streaming Output chunks.

## Acceptance criteria

- [ ] A documented command launches the app and runs browser interaction measurements.
- [ ] The harness can load or seed a deterministic large Performance Fixture.
- [ ] The harness measures large Board load, pan/zoom, Card drag, note typing, Playback open, Playback scrub, and simulated stream chunks.
- [ ] The output includes operation durations and at least one browser-level responsiveness signal such as long tasks, script time, or frame timing.
- [ ] The harness produces pass/fail hooks for future budgets even if first-run budgets are recorded as baseline-only.
- [ ] Research docs record the first browser baseline and identify the top measured UI bottlenecks.

## Blocked by

- #87
