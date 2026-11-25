# Performance: batch high-frequency text and stream updates

## Parent

Parent PRD: #86

## What to build

Create a high-frequency update lane for note typing and AI streaming so small text changes do not repeatedly rebuild unrelated Board state, outputs, or persistence payloads. The first implementation should preserve the user experience while batching visual and persisted updates at a safe cadence.

## Acceptance criteria

- [ ] Store and browser benchmarks measure note typing, Output Version append, and transcript chunk append before changes.
- [ ] Note typing remains responsive and preserves current editing behavior.
- [ ] AI stream chunks are batched so unrelated Cards and Outputs are not updated on every chunk.
- [ ] Persistence still receives durable semantic content, but not at a wasteful per-keystroke or per-token cadence.
- [ ] Tests cover final committed note text, appended Output Version text, appended transcript chunks, and cancellation/failure edge cases touched by the change.
- [ ] Benchmarks show improvement for at least one high-frequency path, or docs record why a deeper data-shape change is required.

## Blocked by

- #88
- #89
