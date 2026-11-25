# ADR 0011: One Graph, Three Views

Status: accepted

## Context

Eido's core thesis is that a user's thoughts form one graph, and that graph is used three ways: the canvas (what the user sees and touches), the semantic context (how thoughts connect and feed each other as meaning), and execution (how connected thoughts run as AI work). Only the canvas is a mature feature today. The context and execution uses exist as embryos inside `brain/compiler.ts` and `brain/runEngine.ts`, but there is no recorded rule keeping all three anchored to one model as the product grows.

## Decision

The saved board graph (cards, connections, outputs, runs, intent log) is the single model. Canvas, semantic context, and execution are projections of it. A projection may keep its own derived state (indexes, caches, plans), but derived state must be rebuildable from the graph and must never become a second source of truth. New features touch the graph through the shared substrate — graph helpers/indexes, context queries, and store actions — not through private copies or view-local data models.

## Considered Options

- Chosen: one persisted graph, three projections, shared substrate modules.
- Not chosen: separate data models per surface (canvas model, context model, workflow model) reconciled later.
- Not chosen: adopting an external graph or workflow engine as the model owner.
- Later: additional projections (search, lineage, agent dashboards) follow the same rule.

## Consequences

- Product: anything expressed on the canvas is automatically part of semantic context and available to execution; no re-entry of thoughts.
- Engineering: the three layers get named seams and in-repo foundation docs (`docs/foundations/`) so features and agents can self-discover where behavior belongs.
- Trade-off: projections must pay the cost of deriving from the graph (indexes, invalidation) instead of keeping convenient private state.
