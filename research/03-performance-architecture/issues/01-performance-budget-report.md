# Performance: add unified budget report command

## Parent

Parent PRD: #86

## What to build

Add one performance report entry point that runs the currently available performance measurements and prints a concise, comparable report for the Board scale target. The command should start with Timeline Projector metrics and be designed so store and browser measurements can be added without changing the developer workflow.

## Acceptance criteria

- [ ] A single documented command prints the current performance budget report.
- [ ] The report includes the smoke, medium, and large Performance Fixture sizes.
- [ ] The report includes Timeline Projector build time, individual projection time, and 100-frame scrub time.
- [ ] The report marks pass/fail for the current Timeline Projector target: large fixture 100-frame scrub under 100ms and individual projections under 5ms after projector construction.
- [ ] The report is excluded from normal `npm test` unless explicitly requested.
- [ ] The research performance docs record the command and the latest baseline output.

## Blocked by

None - can start immediately.
