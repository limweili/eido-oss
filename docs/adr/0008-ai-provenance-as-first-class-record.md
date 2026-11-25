# ADR 0008: AI Provenance As First-Class Record

Status: accepted

## Context

Eido creates and transforms ideas through AI runs, outputs, sources, versions, and future agent actions. Users and engineers need to understand where a result came from.

## Decision

AI provenance will be modeled as first-class durable records. Outputs, versions, source context, run metadata, and agent-created changes should be traceable without depending only on rendered UI state.

## Considered Options

- Chosen: keep provenance explicit and queryable.
- Not chosen: store provenance only as incidental card text or debug metadata.
- Later: add richer lineage views, provenance search, and storage compaction for older runs.

## Consequences

- Product: users can trust, inspect, replay, and compare AI-generated work.
- Engineering: provenance needs stable IDs, retention rules, and import/export coverage.
- Trade-off: AI features must write more metadata than a simple result-only flow.
