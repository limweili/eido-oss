# Production-Grade Scalability Architecture For Eido Resources

## Knowledge

- Local source: `/Users/weili/Documents/Projects/eido/research/repos/tldraw`
  Use for: reactive editor records, schema migration, shape and binding utilities, incremental derivations, viewport culling.
- Local source: `/Users/weili/Documents/Projects/eido/research/repos/excalidraw`
  Use for: simple canvas scene architecture, dual static/interactive rendering, visibility filtering, restore and repair utilities.
- Local source: `/Users/weili/Documents/Projects/eido/research/repos/n8n`
  Use for: authored graph vs run state, partial execution, execution stacks, waiting state, item lineage, run data retention.
- Local source: `/Users/weili/Documents/Projects/eido/research/repos/neo4j`
  Use for: property graph vocabulary, relationship properties, traversal algorithms, graph query mental models.
- Local source: `/Users/weili/Documents/Projects/eido/research/repos/penpot`
  Use for: SPA plus backend architecture, workers, async backend tasks, pub/sub collaboration, exporter service boundaries.
- Repo research: `research/02-source-studies/05-synthesis-one-graph-three-views.md`
  Use for: Eido's one graph, three views thesis and build/borrow/study matrix.
- Repo research: `research/03-performance-architecture/09-future-feature-performance-gate.md`
  Use for: the checklist every future Eido feature should pass before implementation.
- Repo research: `research/03-performance-architecture/10-next-level-canvas-performance.md`
  Use for: current Eido scene derivation direction inspired by tldraw without adopting tldraw.
- Active app docs: `README.md`
  Use for: the current Eido v3 source boundaries: graph core, brain, canvas, and shared modules.

## Wisdom (Communities)

- The reference repos' issue trackers and PR discussions
  Use for: seeing how maintainers justify architecture tradeoffs under real product pressure.
- Future Eido team review
  Use for: testing whether an agent's implementation explanation is understandable to humans and aligned with the founder vision.

## Gaps

- No Eido-specific long-term sync architecture lesson yet.
- No dedicated lesson yet on line-level anchors and rich-text block identity.
- No dedicated lesson yet on persistence retention for large local-first boards.
