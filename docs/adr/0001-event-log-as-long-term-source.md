# ADR 0001: Event Log As Long-Term Source

Status: accepted

## Context

Eido needs to support very large boards, long creative histories, undo, playback, export, diagnostics, and future sync without making every feature depend on one fragile serialized board snapshot.

## Decision

Eido will treat the event log as the long-term source of truth for meaningful board actions. Snapshots, checkpoints, indexes, and projections are cache layers that make reads fast, but they must remain derivable from the underlying event stream.

## Considered Options

- Chosen: append meaningful events and project the current board state from them.
- Not chosen: make one mutable board snapshot the only truth, because it becomes brittle for undo, replay, diagnostics, and future sync.
- Later: compact, chunk, and archive old event ranges so massive history stays practical.

## Consequences

- Product: users can eventually get richer history, playback, recovery, and provenance.
- Engineering: state changes need stable event semantics, projection code, and integrity checks.
- Trade-off: writes and migrations become more structured than direct object mutation.

## Clarification (2026-07-06, ADR 0016)

"Source of truth" here means the permanent long-term **record**, not the runtime source. ADR 0016 supersedes the runtime-projection portion of this decision: the chosen option's phrase "project the current board state from them" no longer applies to live state. The event log is the durable, append-only account of meaningful board actions — the substrate for playback, audit, and provenance — and history-facing projections (timeline, playback, provenance views) must remain derivable from it. Live board state is state-first: cards, outputs, and runs are durable schema objects mutated through the commit funnel, not rebuilt from the log at runtime, and undo does not derive from the log tail. See ADR 0016 for the full boundary and its flip condition.
