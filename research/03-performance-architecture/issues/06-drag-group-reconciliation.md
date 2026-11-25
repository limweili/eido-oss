# Performance: optimize drag-time group reconciliation

## Parent

Parent PRD: #86

## What to build

Measure and optimize group membership reconciliation during Card drag. The current behavior should remain predictable, but drag-time work should avoid repeated full-board scans and group sorting on every movement update where possible.

## Acceptance criteria

- [ ] Store and browser benchmarks measure single Card drag and group movement before changes.
- [ ] Group membership behavior remains externally consistent for entering, leaving, and moving within groups.
- [ ] Drag-time reconciliation uses the cheapest measured viable approach, such as gesture-end reconciliation or precomputed group bounds.
- [ ] Tests cover group membership outcomes after drag/move operations.
- [ ] Browser measurements show drag improvement on medium or large fixtures, or docs record why another bottleneck dominates.
- [ ] Undo and Intent Log Event behavior for movement remains correct.

## Blocked by

- #88
- #89
- #90
