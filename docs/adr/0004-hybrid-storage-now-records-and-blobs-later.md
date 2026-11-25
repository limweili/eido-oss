# ADR 0004: Hybrid Storage Now, Records And Blobs Later

Status: accepted

Review note (2026-07-14): [ADR 0024](0024-image-renditions-are-derived-and-visibility-aware.md) makes the existing records-and-blobs direction concrete for image rendering. The current compressed data URL remains a compatible authoritative reference, while display-sized renditions and decoded surfaces are derived, visibility-aware, and budgeted. Persisting multiple base64 renditions inside Card records is explicitly rejected; moving reference bytes to blob storage remains a separate compatibility-gated migration.

Decision update (2026-07-17): [ADR 0025](0025-sqlite-profile-authority-blobs-and-portable-exports.md) resolves this ADR's deferred production record store. Friends Alpha adopts SQLite WAL as the Profile authority behind the Persistence Port, while retaining this ADR's records-and-content-addressed-blobs direction. The current JSON store is a supported migration input and Portable Export is a separate contract; neither remains the live production authority.

## Context

The prototype still needs to move quickly with local storage, but infinite-canvas scale will require separating small queryable records from large payloads, assets, and history chunks.

## Decision

Eido will use a pragmatic hybrid storage path now while shaping data toward future records and blobs. Core metadata and graph records should become individually addressable, while large text, media, AI outputs, and long event chunks should move toward blob or sidecar-style storage.

## Considered Options

- Chosen: evolve storage in phases, separating records from heavier payloads where the payoff is clear.
- Not chosen: a full database rewrite before validating the product foundations.
- Not chosen: keeping all data forever in one large JSON payload.
- Later: introduce production-grade record stores, blob stores, compaction, and retention policies.

## Consequences

- Product: large boards and long histories can keep loading and exporting predictably.
- Engineering: storage boundaries must become explicit and measurable.
- Trade-off: more storage plumbing is needed before the system looks simple from the outside.
