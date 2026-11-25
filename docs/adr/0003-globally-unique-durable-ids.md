# ADR 0003: Globally Unique Durable IDs

Status: accepted

## Context

Cards, connections, runs, outputs, assets, events, and future sync records must survive imports, exports, agent edits, offline work, and possible multiplayer merges.

## Decision

Eido will use globally unique durable identifiers for domain records and events. IDs should be generated without relying on a central counter and should remain stable across storage, export, import, replay, and future sync.

## Considered Options

- Chosen: globally unique IDs for durable domain objects and events.
- Not chosen: array indexes, timestamps alone, or local incrementing counters as durable identity.
- Later: add explicit identity namespaces or prefixes if scale, debugging, or sync operations need them.

## Consequences

- Product: users and agents can move boards and data between environments with fewer collisions.
- Engineering: APIs need to treat IDs as durable contract fields, not incidental implementation details.
- Trade-off: IDs become less human-readable than simple counters.
