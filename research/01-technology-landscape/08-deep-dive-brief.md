# 08 — Deep-Dive Research Brief: tldraw · Excalidraw · n8n · Neo4j

> **Status: PLAN ONLY.** No cloning or code exploration has been performed yet. This document defines *what* to research, *where* to look, *how*, and *what to produce* — pending your go-ahead on the acquisition strategy in §8.

This brief extends the landscape research in [01–07](README.md). Those docs surveyed the *option space*. This one is a **focused, hands-on source-reading plan** against four mature codebases that, together, contain every subsystem Eido needs. The goal is not to copy any one tool — it's to understand how each *solved a problem Eido shares*, extract the pattern, and decide build-vs-borrow-vs-buy per subsystem.

---

## 0. Framing — Eido as a synthesis of four "technology donors"

Eido is a **note-taking app first**, with deliberate crossover into canvas, workflow, and graph-database territory. It is a *new class of tool for ideation & context creation* — not a replacement for any donor. Each repo is studied as a **donor of one subsystem**:

| Donor | Eido subsystem it informs | What we extract | Likely posture |
|-------|---------------------------|-----------------|----------------|
| **tldraw** | Infinite canvas engine, reactive document store, custom shapes/bindings, camera/culling, persistence/sync | Architecture **+ possibly the SDK itself** | Borrow/buy (license gate) |
| **Excalidraw** | Canvas2D rendering pipeline, viewport culling, local-first/IndexedDB, element model, export | Architecture + patterns (MIT — code reusable) | Borrow patterns |
| **n8n** | Node-graph **execution engine**, node/connection data model, expression system, editor canvas | Execution semantics for "playback/automation" | Borrow patterns (license-aware) |
| **Neo4j** | Property-graph data model, traversal/pathfinding, weighted graph algorithms (PageRank/centrality), query language | The **graph model + context-compiler** mathematics ([05](05-ai-context-engine.md)) | Study concepts; likely *not* embed |

The thesis to validate: **Eido = (tldraw/Excalidraw canvas) × (n8n execution) × (Neo4j graph semantics) × (a note editor), fused by the context compiler that is Eido's actual IP.** This brief tests whether that fusion is sound and where the seams are.

---

## 1. Per-donor research plan

Each donor section: **role · key questions · where to look · what to extract · build feasibility · licensing.**

### 1.1 tldraw — the canvas engine & reactive store
**Role for Eido:** the strongest candidate for the actual canvas foundation, and the cleanest reference for "the document is a reactive record store; the canvas is a view."

**Key questions**
- How does the **signals system** (`@tldraw/state`) achieve fine-grained reactivity, and how does the **store** (`@tldraw/store`) expose records as computed/reactive queries? Can Eido's graph (nodes + weighted edges) live as `TLRecord`s without fighting the model?
- How are **custom shapes** (`ShapeUtil`) and **bindings** (`BindingUtil`) defined? Can a "note" be a shape, each *line* a sub-handle, and a weighted/negative/modifier connection a `BindingUtil`? (This is the crux of mapping the [hand-sketch](#) onto tldraw.)
- How does the **camera/viewport** model coordinate transforms, zoom-to-cursor, and **culling** of off-screen shapes?
- How does **persistence** (`getSnapshot`/`loadSnapshot`, `tldraw/sync`) work, and how observable is the store for an external CRDT (Yjs)?
- **Schema migrations** — how are long-lived documents versioned? (Critical for a notes app users keep for years.)

**Where to look**
- `packages/state/`, `packages/store/`, `packages/tlschema/` — reactivity, records, schema/migrations.
- `packages/editor/src/lib/editor/Editor.ts` — the god-object; camera, selection, shape lifecycle.
- `packages/editor/` shape/culling internals; `packages/tldraw/` default shapes & tools.
- `packages/sync-core/` + `apps/dotcom/sync-worker/` — sync architecture (Durable Objects).
- Docs: tldraw.dev/docs — Editor, Shapes, Bindings, Persistence, Collaboration.

**Extract:** the store/signals/schema separation; ShapeUtil/BindingUtil extension surface; culling approach; the "observable store → external sync" seam.

**Build feasibility:** runs locally (pnpm); `apps/examples` is the fast way to prototype custom shapes/bindings.
**Licensing:** ⚠️ source-available, **commercial license required**. We can study freely; *shipping on it* is a paid decision. Flagged as open decision in [README](README.md).

---

### 1.2 Excalidraw — Canvas2D rendering & local-first
**Role for Eido:** the reference for *building* (not buying) a performant canvas, and for a clean MIT-licensed local-first model.

**Key questions**
- How does the **dual-canvas** architecture (`StaticCanvas` vs `InteractiveCanvas`) partition work, and how does that map to Eido's "few editable note cards + many cheap edges/indicators" split ([01](01-rendering.md))?
- **Viewport culling**: how does `Renderer.getRenderableElements()` / `isElementInViewport()` filter, and how is it **memoized** (sceneNonce, viewport key)? What's the per-element canvas cache (`WeakMap`) invalidation logic?
- The **element data model** (`ExcalidrawElement`) and **scene** management — how minimal can an element be? How are bound text / containers / frames modelled (relevant to Eido's "note contains lines" and "THOUGHT contains notes")?
- **Local-first**: how is state persisted to `localStorage`/IndexedDB, and how does `restore()` handle schema drift?
- Coordinate system: scene → viewport transform math.

**Where to look**
- `packages/excalidraw/renderer/` — `staticScene.ts`, `interactiveScene.ts`, `renderElement.ts`.
- `packages/excalidraw/scene/` — `Renderer`, `Scene`, visibility/`isElementInViewport`.
- `packages/element/` — element types, bound text, frames, containment.
- `packages/excalidraw/data/` — `restore`, `localStorage`, export.
- `packages/math/` — coordinate/geometry helpers.

**Extract:** dual-canvas split, memoized culling, per-element caching, element-model minimalism, restore/migration approach.
**Build feasibility:** easy (Vite/pnpm). Good for spiking a custom edge/indicator layer.
**Licensing:** **MIT** — patterns *and* code are reusable. The "safe" donor.

---

### 1.3 n8n — node-graph execution engine ("playback")
**Role for Eido:** the reference for turning a graph into an *execution* — directly informs Eido's "playback / automations / simulations" ([05 §3](05-ai-context-engine.md)). n8n is the most mature OSS example of "a visual node graph that actually runs."

**Key questions**
- **Data model**: how are nodes (`INode`) and **connections** (`IConnections`) represented? n8n connects by *node name + connection type + input/output index* — how does that compare to Eido's port-per-line + weighted/typed edges?
- **Execution engine**: how does `WorkflowExecute` determine run order, handle branching/merging, fan-out/fan-in, and loops? How is per-node run data threaded through (`IRunExecutionData`, `runData`)? **This is the model for Eido's series/parallel/debate-loop playback.**
- **Expressions**: how does the `={{ }}` expression system let one node reference another's output? (Analogue: how Eido nodes reference upstream context.)
- **Sub-workflows / partial execution / "run from here"** — analogues to Eido playback from a focus node and reusable MOD components.
- **Editor canvas**: n8n's front-end canvas — confirm current implementation (it migrated toward **Vue Flow**, the Vue sibling of React Flow). Validates Flow-family libraries for a *runnable* node canvas, and shows how execution state overlays the canvas (node status, pinned data, live run animation).
- **Async/streaming & error handling** per node — relevant to long-running LLM calls in Eido.

**Where to look**
- `packages/workflow/src/` — `Workflow.ts`, `Expression.ts`, interfaces (`INode`, `IConnections`, `INodeExecutionData`).
- `packages/core/src/` — `WorkflowExecute.ts` (the execution engine — the single most important file), execution lifecycle.
- `packages/cli/` — how runs are orchestrated/queued.
- `packages/frontend/editor-ui/` (Vue) — canvas, node rendering, connection UI, run overlays.
- `packages/nodes-base/` — node definition shape (the "node manifest" pattern → Eido's node-type registry).

**Extract:** the execution-order algorithm, run-data threading, expression/reference model, partial-execution semantics, canvas-run-state overlay UX.
**Build feasibility:** large pnpm/turbo monorepo; can run the editor, but **source-reading the execution engine matters more than running it**.
**Licensing:** ⚠️ **Sustainable Use License (fair-code), not OSI open-source.** Fine to study; reuse of code has restrictions (esp. hosting-as-a-service). Treat as *architecture reference*, not a code-lift source.

---

### 1.4 Neo4j — graph model, traversal & weighted algorithms
**Role for Eido:** the deepest reference for the **graph semantics underneath the context compiler** ([05](05-ai-context-engine.md)) — property graphs, weighted traversal, pathfinding, and centrality/PageRank that map onto "which connected thoughts matter most."

**Key questions**
- The **property-graph model**: nodes, relationships, properties, relationship *types* and *direction*. How does Eido's weight/sign/type-on-edge map onto relationship properties? (Direct fit — relationships are first-class and carry properties, unlike many graph libs.)
- **Index-free adjacency** & storage: *why* graph traversal is O(local) not O(table-scan), and whether that matters at Eido's scale (hundreds–thousands of nodes per user → likely in-memory is fine; this tells us *when* a real graph store earns its place).
- **Cypher / GQL**: the declarative pattern-match + variable-length path traversal model. Could a Cypher-like internal query power "compile context from this focus within radius N honoring weights"? (Note: Cypher is now converging with the **ISO GQL** standard — language is open even though Neo4j the product isn't fully.)
- **Weighted algorithms** (via Graph Data Science concepts): **Personalized PageRank**, weighted shortest path (Dijkstra/A*), closeness/betweenness centrality, community detection. These are *exactly* the relevance-ranking primitives the compiler needs ([05 §2](05-ai-context-engine.md): edge-weighted PageRank, distance decay).

**Where to look** *(study-oriented — we will NOT build this 2M+-LOC Java codebase)*
- `community/` modules: `kernel/`, `graphdb-api/`, `cypher/`, `record-storage-engine/`, `values/` — read selectively for the *model*, not to compile.
- Docs: property-graph model, Cypher manual (variable-length & weighted paths), GDS algorithm docs (PageRank/centrality/pathfinding) — the algorithm *semantics* are the deliverable.
- Compare against **embeddable alternatives** for Eido's actual needs: **Kùzu** (embedded, MIT-ish, Cypher-like, columnar), **KuzuDB/DuckDB-PGQ**, in-memory JS graph libs (**graphology**, **ngraph**), or just adjacency in the CRDT. *The research output is a recommendation on whether Eido needs a graph DB at all, or just graph algorithms over an in-memory structure.*

**Extract:** the property-graph mental model (esp. relationships-with-properties = Eido edges), variable-length/weighted traversal semantics, and the specific algorithms to reimplement in the compiler.
**Build feasibility:** ❌ do not build. Study source + docs; prototype algorithms in TS against a synthetic Eido graph.
**Licensing:** Community = **GPLv3** (copyleft — embedding has obligations); Enterprise = commercial. **Strong reason to study-not-embed**, and to prefer permissive embeddable alternatives or a hand-rolled graph layer. openCypher/GQL the *language* is openly specified.

---

## 2. Cross-cutting synthesis questions (the real payoff)

These can only be answered after the per-donor reads; they're the reason to do all four together:

1. **One graph or two?** Is Eido's *canvas graph* (tldraw/Excalidraw shapes) the same object as its *execution graph* (n8n) and its *semantic graph* (Neo4j)? Or three projections of one model? (Hypothesis: one CRDT-backed property graph, three views.)
2. **Edge richness reconciliation.** tldraw bindings, n8n connections, and Neo4j relationships each model "an edge" differently. Which abstraction best carries Eido's weight + sign + type + direction without contortion?
3. **Reactive store vs execution engine.** tldraw's signals store is *reactive/pull*; n8n's engine is *imperative/push*. How do they coexist — does playback read a snapshot, or run live against the reactive store?
4. **Where does the context compiler sit** relative to all three? (Likely: a pure function over the property graph, invoked by the execution engine, rendered by the canvas.)
5. **Rendering reconciliation.** If we adopt tldraw's renderer, do Excalidraw's culling/dual-canvas lessons still apply, or are they redundant? (Determines build-vs-buy on the canvas.)
6. **Local-first across all of it** — can the unified graph live in one Yjs/CRDT doc that satisfies canvas, execution, and semantic queries simultaneously ([04](04-collaboration-and-local-first.md))?

---

## 3. Method & tooling

**Per-repo recon protocol (applied identically to each):**
1. **Map**: read `README`, `package.json`/`build.gradle`, top-level dirs; produce a one-page architecture map + dependency graph of packages.
2. **Locate the spine**: identify the 3–7 files that carry the subsystem we care about (listed per donor above).
3. **Trace one path end-to-end**: e.g. in n8n, trace a 3-node workflow from trigger → `WorkflowExecute` → run data. In tldraw, trace a shape from store record → ShapeUtil → render. In Excalidraw, trace a frame from scene change → cull → static-canvas draw.
4. **Extract the pattern** into prose + a minimal pseudo-code/TS sketch in the donor's output doc.
5. **Note the seam**: where Eido would plug in, diverge, or reject the pattern.

**Tools/techniques:** `git` (shallow/blobless clone), ripgrep/Grep for symbol tracing, reading entry files, dependency-graph inspection via package manifests, and (only for tldraw/Excalidraw/n8n-editor) running the dev server / examples to observe behavior. For Neo4j, docs + selective source reading + TS algorithm prototypes — **no build**. I'll lean on the `Explore` agent for broad fan-out symbol hunts where useful, and read spine files directly.

**What I will NOT do:** build Neo4j; exhaustively read n8n's 400+ node integrations; treat any single repo as "the answer." Time goes to the *spine files* and the *synthesis*.

---

## 4. Phase plan

| Phase | Work | Output |
|-------|------|--------|
| **0 · Acquire** | Shallow/blobless clone the 4 repos into `research/repos/` (gitignored). Verify sizes, generate per-repo dir tree. | `research/repos/*`, updated `.gitignore` |
| **1 · Recon** | One-page architecture map per repo (§3 steps 1–2). | `09`–`12` doc stubs (map sections) |
| **2 · Deep dives** | Spine-file traces + pattern extraction per donor (§1 questions, §3 steps 3–5). | `09` tldraw, `10` excalidraw, `11` n8n, `12` neo4j |
| **3 · Synthesis** | Answer §2 cross-cutting questions; build-vs-borrow-vs-buy matrix; unified data-model proposal; ADRs for the open decisions. | `13-synthesis-and-decisions.md` + `docs/adr/` entries |
| **4 · (optional) Spike** | Headless TS prototype of the unified property-graph + context compiler + a 3-node playback, informed by all four. | `research/spikes/` |

---

## 5. Deliverables / folder structure

```
research/
  08-deep-dive-brief.md          ← this file
  09-tldraw-deepdive.md          ← canvas engine, store, shapes/bindings, culling, sync
  10-excalidraw-deepdive.md      ← rendering pipeline, culling, local-first, element model
  11-n8n-deepdive.md             ← execution engine, connection model, expressions, run overlay
  12-neo4j-deepdive.md           ← property-graph model, traversal, weighted algos, build-vs-not
  13-synthesis-and-decisions.md  ← one-graph-three-views proposal, build/borrow/buy, ADRs
  repos/                         ← cloned source (gitignored, not committed)
    tldraw/  excalidraw/  n8n/  neo4j/
  spikes/                        ← optional headless prototypes
```

Each deep-dive doc follows a fixed template: *Role · Architecture map · Spine files · Traced example · Patterns to extract · Seams for Eido · Licensing/feasibility · Verdict.*

---

## 6. Constraints, risks & licensing (decide before depending on anything)

| Repo | License | Implication for Eido |
|------|---------|----------------------|
| tldraw | Source-available, commercial license required | Free to study; **paid to ship on**. Open product decision. |
| Excalidraw | MIT | Safe to reuse code & patterns. |
| n8n | Sustainable Use License (fair-code, not OSI) | Study freely; **code reuse restricted** (esp. SaaS). Architecture reference only. |
| Neo4j | GPLv3 (Community) / commercial (Enterprise) | Copyleft — **avoid embedding**. Study model; prefer permissive embeddable graph (Kùzu/graphology) or hand-rolled. |

**Other risks:** (a) repo size/build time — Neo4j and n8n are large; mitigated by shallow clones + study-not-build for Neo4j. (b) Architectural mismatch — donors model "edges" incompatibly (§2.2); the synthesis must resolve this, not paper over it. (c) Over-borrowing — the temptation to adopt four heavyweight systems; the compiler is small and ours, and most donor machinery should be *learned from, not imported*.

---

## 7. Decisions I need from you (before Phase 0)

1. **Clone strategy** — I recommend **shallow + blobless** (`--depth 1 --filter=blob:none`) into `research/repos/` to minimize disk/time, especially for Neo4j & n8n. OK, or do you want full history on any of them?
2. **Build/run scope** — I recommend: *run* tldraw examples, Excalidraw, and the n8n editor where it accelerates understanding; **do not build Neo4j** (study source + docs + TS algorithm prototypes). Agree?
3. **Neo4j depth** — confirm the goal is to extract the *graph model + algorithms* for an in-Eido compiler (likely with a permissive embeddable graph), **not** to ship Neo4j itself. If you actually want Neo4j (or a Cypher engine) embedded, that changes the plan.
4. **Output granularity** — five docs (09–13) as above, or do you want per-donor ADRs / a single consolidated report instead?
