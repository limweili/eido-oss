# Architecture: introduce Graph Index for Board lookups

## Parent

Parent PRD: #86

## What to build

Introduce a Graph Index deep module that provides fast, shared lookup access for the current array-backed Board. The first implementation can build maps from arrays, but feature code should consume the Graph Index interface rather than repeating local scans.

## Acceptance criteria

- [ ] The Graph Index exposes Card by id, Connections into a Card, Connections out of a Card, group members, Output for Card, and Runs for Card.
- [ ] The first implementation works over the current array-backed Board state.
- [ ] Tests prove lookup correctness for Cards, Connections, groups, Outputs, and Runs.
- [ ] Existing graph helper behavior is preserved or cleanly adapted through the new module.
- [ ] The interface is documented in the performance architecture research track.
- [ ] The store operation benchmark can compare at least one indexed lookup path against the previous scan-based helper.

## Blocked by

- #88
