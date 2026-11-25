# ADR 0027: Semantic Vector Indexes Are Derived and Deferred

Status: accepted

## Context

Future Eido features may use local embeddings and SQLite vector search to find semantically related thoughts. `sqlite-vec` is attractive because it runs locally and can integrate with SQLite, but its current pre-v1 format and extension lifecycle are still evolving. Friends Alpha does not yet have an approved embedding model, indexing policy, product interaction, resource budget, or extension security contract.

## Decision

Vector search implementation is **deferred from the SQLite Profile and Friends Alpha specifications**. The architecture reserves only a rebuildable **Semantic Index** boundary: embeddings, vector tables, model/version metadata, and extension-specific state are derived from authoritative Profile records, may live in a disposable sidecar database, and must be safe to delete and rebuild.

A future semantic policy must remain explicitly labeled and separate from Eido's deterministic Context Layer. Similarity may propose or rank additional material only under a versioned policy; it never silently changes graph connections, replaces the saved graph, or becomes required to open and edit offline.

## Considered Options

- Chosen: record the derived-index boundary now and defer implementation to a separate specification.
- Not chosen: put embeddings or `sqlite-vec` virtual tables into the Alpha compatibility floor, because extension, embedding-model, schema, performance, and privacy decisions are unresolved.
- Not chosen: make vectors authoritative Board data, because embeddings are model-dependent projections that must be replaceable.
- Not chosen: let semantic similarity silently replace deterministic graph/context queries, because that would make execution inputs unexplained and unstable.

## Consequences

- The SQLite Profile schema must not block attaching a future sidecar index, but the current implementation adds no vector dependency, native extension, embedding model, migration, or UI.
- Portable Exports exclude derived embeddings by default; a fresh Profile can rebuild them from authoritative records once a future feature is approved.
- The backlog specification must choose the embedding source, privacy model, resource budgets, update/rebuild policy, Mac/Windows native-extension verification, and labeled context-query behavior before implementation.
