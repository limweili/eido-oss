# ADR 0017: Context Contracts Per Card Kind

Status: accepted

Decided in the connections-rework grilling session (2026-07-06), recorded with the PRD (issue #259). The PRD referred to this decision as "ADR 0017" and to the anti-context decision as "ADR 0016"; in the repository the anti-context decision is ADR 0018 because the 0016 slot was already taken.

## Context

Connection behavior was special-cased by card kind across four layers: the context query skipped titles and treated mods as modifiers inline, the store's connect path hardcoded the mod role and the ask-through-result routing, the compiler branched on result and group kinds to pick contribution text, and the connection tray showed the group-mode control behind its own kind check. Every future card kind would have to touch traversal internals, the connect path, the compiler, and the canvas — multiplying the bug surface with each addition (issue #259).

## Decision

Every card kind declares its connection behavior in one static **context contract** in the graph layer (`src/graph/contextContracts.ts`):

- **canConsume** — can it be the target of a feeds connection (a card that runs on gathered context)? Asks and Conversations can; notes, results, mods, groups, and titles cannot. Connect gestures auto-orient toward the one consuming endpoint.
- **contributes** — what it places into a consumer's context: its body text, its chosen output version, its group content (members or digest per the connection's group mode), its dials (mods shape HOW the run thinks, selected with the modifies relation), or nothing (titles are labels, not thought).
- **traversal** — whether upstream walks may pick it up beyond the first hop, and whether the walk continues past it into its own sources. Results and groups are barriers: chains own results, digests own groups.
- **connectionDefaults** — whether it can be a connection endpoint at all, the role a new connection gets when it is the source, and whether consumer-to-consumer wires route through its visible Result card.
- **conversationInput** — what it becomes when wired into a Conversation: a scheduled participant, Shared Conversation Context, top-level guidance, or nothing.
- **presentation** — what its connections offer in editing surfaces (today: whether the group-mode choice appears).

The context query, the store's connect path, ask-through-result routing, the compiler (Ask and Conversation alike), and connection rendering read the registry; none of them branches on card kind directly for connection behavior. The existing special cases (title skip, mod role, ask-through-result routing, group modes) became contract entries with behavior unchanged, guarded by characterization tests over every card kind and both polarities.

## Considered Options

- Chosen: one static registry in the graph layer, read by all four consumer layers.
- Not chosen: per-kind classes or handlers with virtual methods — heavier indirection than a table of declarative fields, and invites behavior to drift into the handlers.
- Not chosen: leaving the special cases inline and documenting them — every new card kind keeps multiplying the bug surface across four layers.

## Consequences

- Product: a future card kind plugs into connections, context, and rendering by writing one contract, not by editing traversal or compiler internals.
- Engineering: kind-specific connection behavior is grep-verifiable in one file; the consumers stay generic. The conversation compiler reads the same registry (conversationInput) to decide who speaks, what is shared, and what guides.
- Trade-off: the contract's fields encode today's behaviors; genuinely new behaviors (new contribution shapes, new routing rules) still require extending the contract type — deliberately, in one place.
