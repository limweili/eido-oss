# Performance: reduce Playback open cost if browser measurement requires it

## Parent

Parent PRD: #86

## What to build

Use browser measurement to decide whether the Timeline Projector construction cost is visible when opening Playback on large Boards. If it is visible, move projector construction behind a better user experience or faster architecture, such as idle precomputation, a worker, persisted Checkpoints, or progressive Playback readiness.

## Acceptance criteria

- [ ] Browser harness measures Playback open time on the large fixture.
- [ ] Research docs compare user-visible open cost against the Timeline Projector module benchmark.
- [ ] If open cost is acceptable, the issue records evidence and no code change is required.
- [ ] If open cost is not acceptable, implement the smallest measured improvement that keeps Playback correct.
- [ ] Playback scrub remains under the large fixture budget after any change.
- [ ] Existing Timeline Projector tests and benchmarks continue passing.

## Blocked by

- #89
