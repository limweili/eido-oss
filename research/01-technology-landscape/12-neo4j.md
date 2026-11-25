# 12 — Neo4j

> Studied from source + docs: `research/repos/neo4j` (shallow clone, `master`, June 2026). **Study-only by design — Eido will not embed or ship Neo4j** (see §7). Read-only; nothing built or run.
> **Role for Eido:** the formal reference for the **semantic graph view** — the property-graph data model, weighted traversal/pathfinding, and the graph algorithms that turn a graph of weighted connections into *relevance*. This is the theoretical backbone of Eido's context compiler ([05](05-ai-context-engine.md)).

---

## 1. Why Neo4j matters to Eido (and why we won't embed it)

Eido's core IP is "compile the right slice of a weighted thought-graph into LLM context." That is, formally, a **weighted graph traversal + relevance-ranking** problem — the exact problem Neo4j has industrialized for 15 years. We study it to *steal the model and the algorithms*, then reimplement the small subset Eido needs in-memory in TypeScript. We do **not** embed Neo4j because (a) it's GPLv3 (copyleft — incompatible with a proprietary app), (b) it's a multi-million-LOC JVM database built for billions of nodes on disk, and (c) Eido's per-user graph is hundreds–thousands of nodes, which fits comfortably in memory ([09](09-tldraw.md) already shows a live in-memory adjacency index doing this).

---

## 2. The property-graph model (the part to adopt)

From the core API (`community/graphdb-api/.../graphdb/`):

- **`Node`** — has **labels** (types/categories) and **properties** (key→value). Created relationships via `node.createRelationshipTo(otherNode, type)`.
- **`Relationship`** — "a relationship between two nodes… has a **start node, an end node, and a `RelationshipType`**. You can attach **properties** to relationships" (via the shared `Entity` interface). So edges are **directed, typed, and carry arbitrary properties** — first-class, not embedded references.
- **`Direction`** — `OUTGOING | INCOMING | BOTH`, with `reverse()`. Traversals are direction-aware.
- **`Entity`** — both nodes and relationships are property containers (uniform property API).

> **This is identical, conceptually, to tldraw's records** ([09](09-tldraw.md)): node-with-props + directed-typed-edge-with-props. Three independent mature systems — Neo4j (database), tldraw (canvas), n8n (workflow) — all converged on **the property graph**. That convergence is the strongest possible signal that Eido's model should be: *notes = nodes (labels + props), connections = relationships (type + direction + props)*, where Eido's edge props are exactly `{ weight, sign, kind }` from your sketch.

### Eido edge ≙ Neo4j relationship
| Your sketch | Neo4j relationship field |
|-------------|--------------------------|
| strong/weak (slider) | property `weight: float` |
| the ✕ negative edge | property `sign: -1` (or a distinct `RelationshipType`) |
| hard/soft, the coil "modifier" | `RelationshipType` (`SUPPORTS`, `MODIFIES`, `CONTRADICTS`, …) |
| arrow direction | `OUTGOING`/`INCOMING` (native) |

---

## 3. Index-free adjacency (why traversal is cheap — and why Eido doesn't need a DB)

Neo4j's performance trick: each node stores **direct pointers to its relationships**, so "get my neighbors" is a local O(degree) pointer-walk, not a table join/scan. Traversal cost scales with the *portion of graph you touch*, not total graph size. This is why graph databases beat relational DBs at multi-hop queries.

**Implication for Eido:** you get the *same* property (O(local) traversal) from an **in-memory adjacency map** — precisely tldraw's reactive `bindingsIndex` (`Map<nodeId, edge[]>`, incrementally maintained — [09](09-tldraw.md)). At Eido's scale, an in-memory adjacency index *is* index-free adjacency. So the lesson from Neo4j here is the *data structure*, not the database.

---

## 4. Cypher / GQL — the declarative traversal language

Neo4j's query language **Cypher** (now converging with the ISO **GQL** standard; the `community/cypher` module is the engine) expresses subgraph queries as ASCII-art patterns:

```cypher
MATCH (focus:Note {id:$id})-[r:SUPPORTS|MODIFIES*1..3]->(n:Note)
WHERE r.weight > 0.3
RETURN n, r
```

Relevant features Eido's compiler conceptually needs:
- **Pattern matching** on node labels + relationship types.
- **Variable-length paths** (`*1..3`) — "everything within N hops of my focus node."
- **Property predicates** (`WHERE r.weight > …`, honoring sign).
- **Path/aggregation** functions.

> **For Eido:** you almost certainly should *not* embed a Cypher engine. But the *shape* of a Cypher query — "from a focus node, traverse typed edges up to N hops, filtered/weighted by edge properties, return the subgraph" — is a clean specification of what the context compiler does. Treat it as the **design template for the compiler's internal traversal API** ([05](05-ai-context-engine.md)), not a dependency. (The language itself — openCypher/GQL — is openly specified even though Neo4j the product is GPLv3.)

---

## 5. Weighted pathfinding & graph algorithms (the compiler's math)

### 5.1 Bundled weighted pathfinding (`community/graph-algo/`)
The community core ships classic weighted algorithms, and their design is worth copying directly:
- **`CostEvaluator`** — a pluggable interface that returns the **cost of traversing a relationship** (typically derived from a property like `weight`). This abstraction — *cost as a function of an edge's properties* — is exactly how Eido should compute traversal cost from `weight`/`sign`/`kind`/recency.
- **`CostAccumulator` / `WeightedPath`** — accumulate cost along a path.
- **`Dijkstra`, `DijkstraBidirectional`, `AStar`, `TraversalAStar`** — weighted shortest-path implementations.

> **Pattern to steal:** make Eido's compiler relevance score a **pluggable cost/score function over an edge** (`score(edge, depth) = f(weight, sign, kind, recencyDecay, hopDecay)`), mirroring `CostEvaluator`. Then "closest/most-relevant thoughts to the focus" is a weighted traversal with that cost.

### 5.2 Higher-order algorithms (Neo4j GDS — documented, not in community core)
Neo4j's **Graph Data Science** library (separate, and not bundled in this community repo, but its algorithm semantics are the reference) provides the ranking/structure algorithms that map 1:1 onto Eido compiler features:

| GDS algorithm | What it computes | Eido use in the context compiler |
|---------------|------------------|----------------------------------|
| **Personalized PageRank** (seeded at the focus node) | importance of every node *relative to the focus* | **the core relevance signal** — "which thoughts matter most, given where I am" |
| **Weighted shortest path / cost** | distance honoring edge weights | distance-decay term ([05](05-ai-context-engine.md)) |
| **Degree / betweenness / closeness centrality** | structurally important nodes | surface "load-bearing" thoughts; rank crystallized components |
| **Community detection** (Louvain/Leiden) | clusters of densely-connected nodes | "summarize/zoom out this region of the canvas"; GraphRAG-style community summaries |
| **Node similarity / node embeddings** (FastRP, node2vec) | structural/semantic similarity | the *opt-in semantic suggestion* layer ("connect this with yesterday's thought") |

These are the same primitives the GraphRAG literature recommends ([05 §2](05-ai-context-engine.md): edge-weighted PageRank, distance decay, community summaries). Neo4j gives them rigorous, named, well-understood definitions to implement against.

---

## 6. Storage & scale (context for the build-vs-not decision)
Neo4j is engineered for **ACID transactions over billions of nodes on disk**, with native graph storage, page cache, and a record storage engine (`community/record-storage-engine/`). This is wildly beyond Eido's needs (a personal idea graph). The takeaway is the opposite of "use Neo4j": Eido's scale means **in-memory + persisted-as-records** ([09](09-tldraw.md), [10](10-excalidraw.md)) is correct, and a heavyweight graph DB would be over-engineering.

---

## 7. Licensing & feasibility — why study-only is the right call
- **Neo4j Community Edition is GPLv3** (confirmed in every source header: "GNU General Public License… version 3"). GPLv3's copyleft is **incompatible with shipping a proprietary Eido**; Enterprise is commercial. **Do not embed.**
- The **openCypher / ISO GQL** language spec is open — safe to take inspiration from the query *shape*.
- **If Eido ever truly needs an embedded graph store** (it likely won't at personal scale), evaluate permissively-licensed embeddable options instead — e.g. **Kùzu** (embeddable, columnar, Cypher-compatible, MIT-style license), **graphology** + `graphology-metrics`/`graphology-communities-louvain` (in-memory JS, MIT), or **ngraph** (MIT). These are flagged for the later combination pass, not chosen here.
- Did not build (multi-million-LOC JVM/Gradle project); model + algorithm study via source headers, core API javadoc, and docs was the appropriate and sufficient method.

---

## 8. Verdict (CTO take)

Neo4j's contribution to Eido is **conceptual, and it is decisive for the part that matters most.** It (a) confirms the **property-graph data model** — the same model tldraw and n8n independently use — as the correct foundation for nodes + weighted/typed/directed connections; and (b) hands Eido a **rigorous, named algorithm toolkit** for the context compiler: *Personalized PageRank seeded at the focus node* as the central relevance signal, *weighted shortest path with a pluggable `CostEvaluator`-style cost function* for distance-decay, *community detection* for region summaries, and *node embeddings* for opt-in semantic suggestion.

The build decision is clear and was correct to make upfront: **adopt the model and the algorithms; reimplement the needed subset in-memory in TypeScript; embed no graph database.** In the "one graph, three views" framing, Neo4j is the archetype of the *semantic view* — but for Eido that view is a set of **pure functions over the same in-memory property-graph records** that the canvas view (tldraw) and execution view (n8n) operate on. One graph; the semantic view is just the algorithms you run over it.
