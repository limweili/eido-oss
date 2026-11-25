# ADR 0010: Massive Boards And History Before User Scale

Status: accepted

Review note (2026-07-14): the rich-card performance contract now lives in [ADR 0023](0023-buffered-passive-cards-and-hover-activation.md), and image runtime residency in [ADR 0024](0024-image-renditions-are-derived-and-visibility-aware.md). Massive-Board gates must vary rich-Card complexity, image count, source pixel dimensions, decoded-pixel residency, and repeated navigation—not Card count and compressed save bytes alone.

## Context

Eido's near-term scalability risk is the board itself: huge canvases, long histories, many AI outputs, and many local records. Millions of users matter later, after the single-board foundations are strong.

## Decision

Eido will optimize first for massive boards, massive history, heavy AI provenance, and many agent edits within a local-first product. Internet-scale multi-tenant operations are a later-stage concern.

## Considered Options

- Chosen: solve board, history, storage, rendering, and agent-scale foundations first.
- Deferred: millions of users, large hosted multi-tenancy, billing-scale operations, and global collaboration infrastructure.
- Not chosen: optimize early for user-count scale while leaving board-size scale fragile.

## Consequences

- Product: the core creative experience can handle ambitious boards before broad distribution.
- Engineering: performance gates should focus on board behavior, storage payloads, projections, import/export, and agent-command stability.
- Trade-off: some cloud-platform decisions stay provisional until the local and single-board architecture is proven.
