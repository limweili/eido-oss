# Handover: Production Scalability Teaching Track

## Current status

- Track status: active.
- Completed lessons: 2 of about 7 core lessons.
- Latest completed lesson: `lessons/0002-one-graph-three-projections.html`.
- Next lesson to teach: Lesson 0003, "Hot Paths And Performance Gates".
- Learning records: none recorded yet. Do not mark mastery until the user has demonstrated the concept back in their own words or applied it to an Eido decision.

## Teaching mission

Teach enough production-grade scalability architecture for the founder to guide coding AI agents and a future team. The goal is practical architectural taste: knowing what to ask for, what to reject, and how to express long-term Eido constraints in agent instructions.

## What the user has covered

- Scalability is not one thing. Different systems scale different pressures: rendering, editor state, graph semantics, execution history, async work, collaboration, and operations.
- Eido should protect a "one graph, three projections" architecture: canvas projection, linear document projection, and execution/context projection should come from one canonical graph rather than becoming separate source-of-truth systems.
- Reference repo strengths discussed so far:
  - tldraw: editor state, schema migration, reactive derivations, viewport/canvas scalability.
  - Excalidraw: simple scene model, repair/restore utilities, static vs interactive rendering.
  - n8n: authored workflow graph separated from execution state, partial runs, waiting state, item lineage, retention.
  - Neo4j: graph vocabulary, traversals, relationship properties, query mental models.
  - Penpot: SPA plus backend services, workers, exporter boundaries, pub/sub collaboration.

## Next lesson outline

Lesson 0003 should teach "hot paths and performance gates".

Cover:

- What a hot path is in founder language: the repeated path users feel every day.
- How mature repos isolate hot paths instead of optimizing everything.
- Eido examples: canvas pan/zoom, node editing, context compilation, run playback, save/load.
- The agent instruction pattern: "Before implementing, identify the source of truth, derived projection, hot path, invalidation rule, and performance gate."
- A simple exercise where the user classifies one proposed Eido feature by its hot path and scalability risk.

Suggested output:

- Add `lessons/0003-hot-paths-and-performance-gates.html`.
- Add `reference/0003-hot-paths-and-performance-gates.html` only if it helps compare repos.
- Add a learning record only after the user demonstrates understanding.

## How to continue with the teach skill

Use the `teach` skill and this folder as the course workspace:

```text
Please use teach and continue the production scalability course at docs/archive/learning/production-scalability.
```

Ground future lessons in local source when available:

- `/Users/weili/Documents/Projects/eido/research/repos/tldraw`
- `/Users/weili/Documents/Projects/eido/research/repos/excalidraw`
- `/Users/weili/Documents/Projects/eido/research/repos/n8n`
- `/Users/weili/Documents/Projects/eido/research/repos/neo4j`
- `/Users/weili/Documents/Projects/eido/research/repos/penpot`

Use the repository root as the active Eido implementation unless the user explicitly asks about older prototypes.

## Guardrails for future teaching agents

- Keep lessons short, concrete, and founder-useful.
- Translate repo architecture into Eido decisions, not trivia.
- Ask the user to restate the decision rule before creating learning records.
- Prefer agent-ready phrasing the founder can paste into implementation prompts.
- Do not turn the track into a generic scalability course; always bring it back to Eido's graph, canvas, context compiler, execution model, and future collaboration/sync boundaries.
