# ADR 0005: Salvage Local Imports, Strict Sync

Status: accepted

## Context

Local users need recovery and import paths that are forgiving, while future shared sync needs strict guarantees so corrupted or ambiguous data does not spread.

## Decision

Eido will be generous when importing local or legacy data, using diagnostics and repair where reasonable. Future cloud and multiplayer sync paths must be strict: data should pass validation and integrity checks before it can become shared truth.

## Considered Options

- Chosen: local salvage for user recovery, strict admission for sync or shared records.
- Not chosen: reject every imperfect local file, because that risks losing user work.
- Not chosen: accept questionable data into future sync, because that risks corrupting shared state.
- Later: add repair reports, quarantine flows, and sync preflight tooling.

## Consequences

- Product: users get better recovery without compromising future collaboration safety.
- Engineering: import code and sync-admission code must be separate paths with different promises.
- Trade-off: some data may be usable locally but intentionally blocked from sync until repaired.
