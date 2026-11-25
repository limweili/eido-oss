# Eido Research 2 - Neo4j Source Study

Repo inspected: `research/repos/neo4j`  
Commit: `8f4aa6ad73201a677164bc7664205333ab2847fc`  
Primary docs used:

- [Neo4j Graph Database Concepts](https://neo4j.com/docs/getting-started/graph-database/)
- [Neo4j Relationship Properties](https://neo4j.com/docs/getting-started/data-modeling/guide-data-modeling/)
- [Cypher MATCH](https://neo4j.com/docs/cypher-manual/current/clauses/match/)
- [Cypher Variable-Length Paths](https://neo4j.com/docs/cypher-manual/current/patterns/variable-length-patterns/)
- [Neo4j Graph Data Science - Graph Management](https://neo4j.com/docs/graph-data-science/current/management-ops/graph-creation/)
- [Neo4j Graph Data Science - Running Algorithms](https://neo4j.com/docs/graph-data-science/current/algorithms/syntax/)
- [Neo4j Graph Data Science - PageRank](https://neo4j.com/docs/graph-data-science/current/algorithms/page-rank/)
- [Neo4j Graph Data Science - Dijkstra](https://neo4j.com/docs/graph-data-science/current/algorithms/dijkstra-source-target/)

## Bottom Line

Neo4j is the best conceptual reference for Eido's data model, but probably not a dependency Eido should embed. The important idea is the property graph: nodes and relationships both carry properties, relationships have direction and type, and queries/traversals can select meaningful subgraphs.

That matches the heart of Eido better than a plain document tree or drawing scene.

## Wireframe Fit

| Wireframe object | Property graph fit | Notes |
| --- | --- | --- |
| `IDEA` | Node label `Idea` | Root container and graph namespace. |
| `THOUGHT` | Node label `Thought` plus subgraph boundary | A thought can be a frame, saved query, and semantic scope. |
| `NOTE` | Node label `Note` | Notes are first-class objects, not just text. |
| Line/bullet ports | Node label `Block` or anchor record | Blocks need stable IDs for relationships. |
| Strong/weak arrows | Relationship with properties | Weight, type, direction, polarity, confidence, and recency live on relationships. |
| Output stack `v3` | `Output` node with `OutputVersion` nodes | Versions preserve provenance. |
| `MOD` bubble | Node label `MOD` | A modifier can connect to notes, edges, outputs, or compilation rules. |

## Source Spine

The useful areas are:

- `community/graphdb-api/src/main/java/org/neo4j/graphdb/Entity.java` - shared node/relationship property behavior.
- `community/graphdb-api/src/main/java/org/neo4j/graphdb/Node.java` - node labels, properties, relationships, degree, relationship creation.
- `community/graphdb-api/src/main/java/org/neo4j/graphdb/Relationship.java` - relationship type, direction, endpoints, properties.
- `community/graph-algo/src/main/java/org/neo4j/graphalgo/GraphAlgoFactory.java` - shortest path, all paths, Dijkstra, A* references.
- `community/cypher` - query language implementation area.
- `community/kernel` and storage modules - useful only as conceptual background, not necessary for Eido v1 research.

## What Neo4j Proves

Neo4j's public graph API treats nodes and relationships as entities with properties. Relationships have a start node, end node, type, and properties. That is exactly what Eido's arrows need to be.

The key lesson is that relationship properties are not secondary. In Eido, a connection's weight, sign, type, confidence, source, author, and recency may matter as much as the two things it connects.

Cypher's `MATCH` pattern is also a useful mental model. Eido may not need Cypher, but it needs graph queries like:

```cypher
MATCH (focus)-[r*1..3]->(context)
WHERE r.weight > 0.4
RETURN context
```

In product terms: "From this note or output goal, find nearby context within three steps, prefer strong edges, include constraints separately, and explain what got included."

Neo4j Graph Data Science is useful because it separates the stored graph from algorithm-specific in-memory projections. Eido can copy that idea without using Neo4j: project a subset of the thought graph into memory, then run ranking/traversal algorithms for context compilation.

## Eido Property Graph Hypothesis

Eido's core graph could start with these node labels:

| Node label | Purpose |
| --- | --- |
| `Idea` | Top-level workspace/project. |
| `Thought` | Bounded working context, often visualized as a frame. |
| `Note` | Main editable text card. |
| `Block` | Stable paragraph, bullet, claim, source, or generated chunk inside a note. |
| `MOD` | Reusable modifier: persona, constraint, rubric, style, tool, workflow, or lens. |
| `Output` | Target artifact or answer stack. |
| `OutputVersion` | A generated or edited version with provenance. |
| `Asset` | File, image, URL, audio, transcript, or external source. |
| `Run` | Execution/playback instance over a graph snapshot. |

And these relationship families:

| Relationship family | Meaning |
| --- | --- |
| `CONTAINS` | Idea contains Thought, Thought contains Note, Note contains Block. |
| `SUPPORTS` | One node/block strengthens another. |
| `CONTRADICTS` | One node/block challenges another. |
| `CONSTRAINS` | A rule, boundary, or negative context. |
| `FEEDS` | Input/context should be included downstream. |
| `MODULATES` | MOD changes interpretation, style, or execution. |
| `DERIVED_FROM` | Output/version came from upstream context. |
| `NEXT_VERSION` | Output version lineage. |
| `EXECUTES_BEFORE` | Execution ordering when the graph is in playback mode. |

## Weight, Polarity, And Cost

The sketch shows "strong" and "weak" edges. A common trap is using one numeric field for all graph algorithms. Eido should not do that.

Semantic strength and traversal cost are related but not the same:

- For influence/ranking, stronger edges should usually mean more important.
- For shortest path, stronger edges often need to become lower cost.
- For negative or constraint edges, a negative weight can break algorithms such as Dijkstra. It is better to store `polarity: negative` or `edgeType: CONTRADICTS` and handle those relationships separately.

Possible relationship properties:

```ts
type EidoRelationship = {
  id: string
  type: 'SUPPORTS' | 'CONTRADICTS' | 'CONSTRAINS' | 'FEEDS' | 'MODULATES'
  fromId: string
  toId: string
  weight: number        // semantic strength, 0..1
  polarity: 'positive' | 'negative' | 'neutral'
  hardness: 'soft' | 'hard'
  confidence?: number
  createdBy: 'user' | 'ai' | 'import'
  createdAt: string
  explanation?: string
}
```

## Context Compiler Algorithms

Neo4j suggests several algorithm families that map naturally to Eido:

- Weighted neighborhood expansion: collect nearby context around a focus node.
- Personalized PageRank: rank context by influence from the current focus or output goal.
- Shortest path: explain why a piece of context was included.
- Community detection: discover clusters of related thinking.
- Node similarity: suggest possible connections.

For v1, Eido probably needs deterministic weighted expansion before it needs sophisticated graph science. The system should be able to tell the user why something entered context.

## Why Not Ship Neo4j Directly

Neo4j is powerful, but embedding it directly would add operational weight, license complexity, and a database mental model that may be too heavy for a local-first note app. The repo is GPLv3 licensed. Eido can learn from Neo4j's architecture and docs without importing the database.

A more likely path:

1. Store Eido's graph in the app's own local data layer.
2. Keep nodes and relationships as explicit records.
3. Build in-memory graph projections for context compilation.
4. Add a graph database only if scale or query complexity forces it later.

## Open Questions

- Should `Block` be visible in the graph model from the beginning, or introduced after note editing stabilizes?
- Which relationship types belong in v1, and which can be metadata labels?
- Should Eido expose graph queries to users, or only use them internally?
- How should AI-suggested relationships differ from user-created relationships?
- What is the smallest explainable context algorithm that makes the product feel magical but controllable?

