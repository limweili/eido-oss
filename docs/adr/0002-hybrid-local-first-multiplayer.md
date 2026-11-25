# ADR 0002: Hybrid Local-First Multiplayer

Status: accepted

## Context

Eido is local-only for now, but the foundations should not block future multiplayer on the same infinite canvas.

## Decision

Eido will keep a local-first interaction model while designing actions so they can later pass through a coordinating sync layer. Local actions should feel immediate, while future shared-board acceptance should be deterministic: the first completed conflicting action wins, and simultaneous actions must still receive unique event identities using a randomized or hash-like suffix.

## Considered Options

- Chosen: hybrid local-first, with optimistic local work and a future coordinating layer for shared boards.
- Not chosen: purely server-authoritative interaction for all boards, because it would make offline and local-only use feel worse.
- Not chosen: purely peer-to-peer conflict handling, because it would make correctness harder for future production sync.
- Later: add server-side admission, cursors, presence, and rare-conflict diagnostics.

## Consequences

- Product: Eido can stay fast and private today while leaving room for collaborative boards.
- Engineering: every action needs stable identity, causal metadata, and deterministic tie-breaking.
- Trade-off: the app must avoid assuming that "local state changed" always means "durably accepted by a shared board."
