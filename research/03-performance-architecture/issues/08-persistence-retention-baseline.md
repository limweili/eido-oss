# Performance: measure persistence payloads and define retention rules

## Parent

Parent PRD: #86

## What to build

Measure current save payload behavior and define the first persistence/retention rules for large Boards. This slice should not rewrite the full persistence architecture, but it should make the cost visible and document when to move from full snapshots to normalized records, event journals, blob records, and Checkpoints.

## Acceptance criteria

- [ ] A performance measurement reports SavedBoard snapshot size and save serialization cost for smoke, medium, and large fixtures.
- [ ] The measurement distinguishes Cards, Connections, Outputs, Runs, Intent Log Events, and assets where possible.
- [ ] Research docs define prototype retention rules for Undo, Playback, Checkpoints, Output Versions, Runs, and assets.
- [ ] Full-board import/export remains explicitly preserved.
- [ ] The docs identify the threshold or symptom that would trigger normalized persistence work.
- [ ] If a low-risk save optimization is obvious from measurement, implement it with tests; otherwise defer implementation with evidence.

## Blocked by

- #87
- #88
