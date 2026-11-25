# Performance: move lookup-heavy render paths to shared indexes

## Parent

Parent PRD: #86

## What to build

Move lookup-heavy render and selector paths toward the shared Graph Index so Card and Connection rendering does not repeatedly scan full arrays during ordinary Board updates. The slice should focus on the highest-impact render paths found by the browser harness and preserve the current UI.

## Acceptance criteria

- [ ] The browser harness identifies at least one render or selector bottleneck before changes.
- [ ] The selected Card/Connection render paths use shared indexed lookups or stable selector inputs.
- [ ] Current visible behavior is unchanged for the affected Card and Connection types.
- [ ] Existing tests pass, and targeted tests cover any moved lookup behavior.
- [ ] Browser measurements show improvement or the research docs record why the measured bottleneck moved elsewhere.
- [ ] New render code follows the future-feature performance gate: no repeated full-array scans in hot render paths.

## Blocked by

- #89
- #90
