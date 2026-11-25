# Process: add future-feature performance gate

## Parent

Parent PRD: #86

## What to build

Turn the performance architecture principles into a lightweight gate for future feature work. The gate should make feature builders answer how a feature reads/writes Board records, whether it participates in Undo or Playback, whether it needs indexes, and how it is verified at scale.

## Acceptance criteria

- [ ] A repo doc defines the future-feature performance gate in plain language.
- [ ] The gate references Board, Card, Connection, Output, Run, Intent Log Event, Undo, Playback, Timeline Projector, Graph Index, and Performance Fixture using glossary terms.
- [ ] The gate tells feature builders which benchmark or browser harness to run for common feature types.
- [ ] The gate is linked from the performance architecture research index.
- [ ] The gate avoids requiring every feature builder to understand all internals; it points them to reusable modules and commands.
- [ ] The docs state clearly that Eido is not adopting tldraw SDK or technology.

## Blocked by

- #87
- #88
- #89
