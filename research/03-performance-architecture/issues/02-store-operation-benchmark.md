# Performance: add store operation benchmark for scale fixtures

## Parent

Parent PRD: #86

## What to build

Add a store operation benchmark that runs high-risk Board mutations against deterministic Performance Fixtures. The benchmark should measure the paths most likely to degrade as the Board grows: Card text updates, Output Version streaming, transcript chunk streaming, Card movement, group movement, adding/deleting Cards and Connections, Run/result creation, and Undo/Redo.

## Acceptance criteria

- [ ] A dedicated performance command runs store operation measurements without opening the browser.
- [ ] The benchmark uses deterministic Performance Fixtures rather than hand-built tiny boards.
- [ ] The benchmark covers Card text update, Output Version append, transcript append, single Card move, group move, add/delete Connection, add/delete Card, create/run result placeholder, Undo, and Redo.
- [ ] The report shows operation timing for at least smoke and medium fixtures, and large fixtures where runtime is acceptable.
- [ ] No hard budget is enforced until baseline numbers exist, but the output must be stable enough to compare future changes.
- [ ] Research docs record the first baseline and identify the top measured store bottlenecks.

## Blocked by

- #87
