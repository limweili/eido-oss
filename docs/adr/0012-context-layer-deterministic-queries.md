# ADR 0012: Context Layer As Deterministic Graph Queries

Status: accepted

## Context

Today the only consumer of "what context feeds this thought" is the AI compiler, which walks connections with hardcoded rules (one hop plus a strong-only second hop) mixed into prompt assembly in `brain/compiler.ts`. Future features need the same answers — multi-hop context, chains of reasoning, lineage views, context previews — and must all agree on what the neighborhood of a thought is. Neo4j is a reference point for how graph systems keep such queries fast: indexes maintained incrementally from the change that mutated the data, never rebuilt from scratch on the hot path.

## Decision

Semantic context is served by one seam in graph core: a context query module that answers "which cards and connections feed this card, in what order, and why" as plain data. Queries are deterministic and explainable — same graph, same policy, same answer — and each query carries a named, versioned policy (hop depth, which strengths/polarities/roles to follow) instead of hardcoded rules at call sites. Consumers (compiler, previews, future lineage and multi-hop features) receive a selection of card/connection IDs with the reason each was included, and do their own rendering or assembly. As boards grow, the module is backed by incrementally maintained adjacency/graph indexes fed by the store's change stream; consumers never scan full arrays.

## Considered Options

- Chosen: one deterministic query seam with versioned policies, index-backed over time.
- Not chosen: each feature walking `board.connections` with its own rules.
- Not chosen: embeddings/similarity ranking as the definition of context (may layer on later; the deterministic graph answer stays the base).
- Later: k-hop policies, weighted path scoring, context budgets (token limits), worker-owned indexes for very large boards.

## Consequences

- Product: every surface agrees on what context means; users can always be shown why something was included.
- Engineering: traversal logic leaves the compiler; policies become testable data; index maintenance follows the incremental-from-changes rule (see ADR 0001, ADR 0010).
- Trade-off: an extra layer between features and the raw arrays; features must express needs as policies rather than ad-hoc walks.
