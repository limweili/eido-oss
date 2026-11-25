# Mission: Production-Grade Scalability Architecture For Eido

## Why
You want enough architectural judgment to guide coding AI agents and a future team toward decisions that preserve Eido's long-term product shape. The goal is not to become a backend or database expert; it is to translate founder-level product vision into technical constraints agents can obey.

## Success looks like
- Explain what each reference repo scales best: editor state, rendering, execution, graph semantics, or service operations.
- Tell an AI agent where a feature belongs in Eido: graph model, canvas projection, context compiler, run state, worker, or backend boundary.
- Ask for scalability evidence before accepting implementation: source of truth, hot path, derived index or projection, retention rule, and performance gate.
- Protect Eido's "one graph, three views" architecture while still borrowing proven patterns from mature systems.

## Constraints
- Use the repository root as the active Eido implementation.
- Use the local git-ignored reference repos under `/Users/weili/Documents/Projects/eido/research/repos`.
- Prefer practical founder/CTO vocabulary over deep implementation trivia.
- Keep lessons short enough to revisit quickly.

## Out of scope
- Mastering Neo4j, n8n, tldraw, Excalidraw, or Penpot internals.
- Choosing a dependency solely because a reference repo uses it.
- Rewriting Eido's architecture before a specific feature or bottleneck demands it.
