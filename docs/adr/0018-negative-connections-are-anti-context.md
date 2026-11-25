# ADR 0018: Negative Connections Are Anti-Context

Status: accepted

Decided in the connections-rework grilling session (2026-07-06), recorded with the PRD (issue #259). The PRD referred to this decision as "ADR 0016"; in the repository it is ADR 0018 because the 0016 slot was already taken.

## Context

Negative connections were framed as "constraints — do not violate," which never matched real usage. The recurring need users actually have is culling: "I've been down this path already — steer away and explore a different shape of ideas." Hard requirements (budget, format, scope) work fine as ordinary connected notes; a special do-not-violate polarity added a second mental model without earning it.

## Decision

A negative connection means **Avoid**: the connected card is an explored dead end the AI should steer away from — not a rule it must obey. The user-facing language is **Helps / Avoid**; an Avoid connection may carry an optional one-line **reason** recording why the path died. The compiler (Phase 4 of #259) frames Avoid-connected cards as "already explored — do not retread," pushing exploration toward structurally different directions rather than merely avoiding their exact words. The invariant that negatives never blend into ordinary context still holds.

For save-file compatibility the stored polarity enum value (`pushesAgainst`) is retained; only the user-facing words change. The reason field is additive — absence means no reason, and no save migration is needed.

## Considered Options

- Chosen: Avoid = anti-context (explored dead ends steer exploration away), reasons optional, hard requirements stay ordinary connected notes.
- Not chosen: keeping "constraints — do not violate" — never matched usage, and hard requirements already work as ordinary notes.
- Not chosen: a separate hard-constraint polarity alongside Avoid — two negative flavors to learn; additive later if ordinary context demonstrably fails.
- Not chosen: true exclusion/mute (hiding a connected card from context) — the AI cannot steer away from what it never sees, and context is opt-in, so unconnected cards are already excluded.

## Consequences

- Product: one simple mental model — connect what matters, mark what to avoid. Dead ends become steering fuel for the next run instead of clutter.
- Engineering: polarity storage is unchanged; the rename is words-only until the Phase 4 compiler rework retires the constraints section.
- Trade-off: users who relied on "do not violate" phrasing express hard requirements as connected notes instead; revisit only if that demonstrably fails.
