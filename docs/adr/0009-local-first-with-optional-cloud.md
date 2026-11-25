# ADR 0009: Local-First With Optional Cloud

Status: accepted

## Context

Eido's current product value includes private, fast, local idea work. Future cloud and multiplayer should expand that value, not replace it.

## Decision

Eido will remain local-first, with cloud and multiplayer treated as optional capabilities. Local boards should continue working without mandatory accounts, network availability, or server round trips.

## Considered Options

- Chosen: local-first core with optional cloud.
- Not chosen: mandatory cloud-first storage as the baseline product assumption.
- Later: add account-backed sync, sharing, team spaces, and hosted storage when the local contracts are strong enough.

## Consequences

- Product: users keep privacy, speed, and ownership for solo work.
- Engineering: shared features must be additive and cannot assume all data always lives online.
- Trade-off: cloud features need careful bridging from local records, events, and assets.
