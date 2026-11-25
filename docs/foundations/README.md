# Layer Foundations

Eido is one graph used three ways (ADR 0011). These documents are the standing map of the three projections: what exists today (with source evidence), the invariants every feature must keep, and the future work each layer is prepared for.

**If a feature touches how thoughts connect, feed AI, or run — read the matching foundation doc first.** These docs exist so any agent or engineer can self-discover where new behavior belongs instead of inventing a parallel system.

| Layer | Doc | One-line scope |
| --- | --- | --- |
| Canvas | [canvas-layer.md](canvas-layer.md) | Rendering and interacting with the graph at speed-of-thought |
| Semantic context | [context-layer.md](context-layer.md) | What feeds a thought: deterministic neighborhood queries over the graph |
| Execution | [execution-layer.md](execution-layer.md) | Running AI over the graph: plans, steps, provenance |

The Local Profile is a supporting authority boundary, not a fourth graph projection. Changes to persistence, ownership, migration/recovery, Portable Export, or agent access must also follow [persistence-layer.md](persistence-layer.md).

## Shared rules across all three

- The saved board graph is the only source of truth. Projections derive; they never own data (ADR 0011).
- Derived state (indexes, scenes, plans) must be rebuildable from the graph and maintained incrementally from changes, never rebuilt on hot paths (ADR 0010, ADR 0012).
- Results of execution re-enter the graph as outputs/versions with provenance (ADR 0008) and immediately become context for the next thought — that loop is the product.
- Full-board scans are acceptable only for import, export, migration, and checkpointing (CONTEXT.md performance principles).

## How these docs stay alive

When a change alters a layer's seams, invariants, or roadmap, update the matching doc in the same PR (the `docs-sync` skill covers this). Each doc has a "Future work" section — treat it as the layer's backlog of prepared-for capabilities; delete entries as they ship.
