# Eido — Technology Research

> Where ideas find their form. A spatial thinking tool where a graph of notes and weighted connections becomes the context that drives AI generation.

This folder is an **exploration**, not a decision. It maps the technology landscape required to build Eido, expands the starting research prompt with the dimensions Eido's idea actually demands (above all: the **graph-as-context AI layer**, which the original prompt underweighted), and surfaces the architectural trade-offs you'll have to make.

_Last researched: June 2026. Web-sourced claims are cited inline; treat version/pricing facts as point-in-time._

---

## How to read this folder

| Doc | Question it answers |
|-----|--------------------|
| [01-rendering.md](01-rendering.md) | How do pixels get on screen? Canvas vs SVG vs WebGL/WebGPU; retained vs immediate mode. |
| [02-languages-and-shells.md](02-languages-and-shells.md) | TypeScript, Rust/Wasm, native (Tauri/Electron/Swift). What language buys you what. |
| [03-reference-projects.md](03-reference-projects.md) | What to steal from tldraw, Excalidraw, React Flow, PixiJS, Fabric, Konva. |
| [04-collaboration-and-local-first.md](04-collaboration-and-local-first.md) | CRDTs (Yjs/Automerge/Loro), sync backends, IndexedDB, offline-first. |
| [05-ai-context-engine.md](05-ai-context-engine.md) | **The heart of Eido.** Graph → context, weighted edges, GraphRAG, node-based agent orchestration. |
| [06-text-input-and-spatial-infra.md](06-text-input-and-spatial-infra.md) | Rich-text node editing (TipTap/Lexical), voice capture, spatial indexing for culling/hit-testing. |
| [07-architecture-decisions.md](07-architecture-decisions.md) | The three bottlenecks + a synthesized recommended stack and the real fork-in-the-road decisions. |
| [08-deep-dive-brief.md](08-deep-dive-brief.md) | **Plan.** Hands-on source-reading brief across tldraw, Excalidraw, n8n, Neo4j — what/where/how, phases, licensing. |
| [09-tldraw.md](09-tldraw.md) | **Source study.** Reactive record store + signals; shapes/bindings as a property graph; incremental adjacency index; DOM culling. `@tldraw/state`+`@tldraw/store` are MIT. |
| [10-excalidraw.md](10-excalidraw.md) | **Source study.** Canvas2D rendering: dual-canvas, memoized culling, per-element WeakMap cache; lightweight reconciliation. Edges *not* first-class (instructive). MIT. |
| [11-n8n.md](11-n8n.md) | **Source study.** Execution engine for "playback": stack machine + `waitingExecution` (series/parallel/merge/loop), item-stream data, expressions, partial runs. Vue Flow canvas. Fair-code. |
| [12-neo4j.md](12-neo4j.md) | **Source study (no embed).** Property-graph model; index-free adjacency; Cypher/GQL traversal; weighted pathfinding + Personalized PageRank/centrality/communities for the context compiler. GPLv3. |

> **Deferred:** doc `13-synthesis-and-decisions.md` (combining/selecting technologies for Eido) is the **separate combination pass** you asked to run later — not written yet.

---

## The one-paragraph synthesis

Eido is **not primarily a drawing tool** — it's a *thought graph that feeds an AI context engine*. That reframes the whole stack. The canvas is the interface; the graph is the product. Most of the hard, differentiating work is **not** in rendering (mature SDKs solve that) — it's in (a) modelling weighted/typed/negative connections, (b) deterministically compiling a subgraph into an LLM context window, and (c) the "playback" execution model that turns a path through the graph into an agent run. The rendering and collaboration questions in the original prompt are mostly *solved problems you should buy or borrow*; the context-compilation and orchestration questions are *the parts only you can build* and where the product lives or dies.

## The biggest insight from the research

The original prompt frames the central decision as **"retained vs immediate mode" rendering**. For Eido that is the *wrong* primary axis, because:

- Eido's atoms are **text notes**, not brush strokes. Text wants to live in the DOM (selection, editing, accessibility, IME). Pure WebGL canvases (PixiJS) make rich-text editing miserable.
- Eido must support **"100s of connections"** and large graphs — so you *do* need culling and a fast spatial index, but you likely don't need 60fps rendering of 100k brush strokes.
- The winning pattern used by the mature tools (tldraw, Excalidraw) is **hybrid**: a fast immediate-mode layer (canvas/WebGL) for the "many cheap things" (connection lines, indicators, minimap, selection) + DOM/HTML for the "few expensive things" (the editable note cards in view). See [01](01-rendering.md) and [03](03-reference-projects.md).

## Provisional recommended stack (a starting hypothesis, not a verdict)

This is the path of least resistance to a real prototype that tests the *idea*, not the rendering:

- **Shell:** Web-first (TypeScript/React). Wrap later with **Tauri 2** if you want a native desktop/mobile app (it now does iOS/Android too) — far lighter than Electron.
- **Canvas:** **tldraw SDK** as the canvas foundation (camera, culling, custom shapes/bindings, snapping all solved) — *but check licensing* (source-available, commercial license required). Fallback if licensing is a blocker: **React Flow** (node+edge model is closer to Eido's actual data shape than a freeform whiteboard) or building on **Excalidraw's** dual-canvas pattern.
- **Note content:** **TipTap** (ProseMirror) for rich-text inside nodes — best Yjs story.
- **State/graph:** **Yjs** as the CRDT + local-first store (IndexedDB via `y-indexeddb`), sync deferred until multiplayer is actually needed. Single-player local-first first.
- **Spatial index:** **rbush** (R-tree) for culling + hit-testing if you build your own; tldraw/React Flow give you this for free.
- **AI context engine:** custom — a deterministic "context compiler" that walks the graph from a focus node, honoring edge weight/sign/type, with depth-decay and a token budget. Borrow ideas from **LightRAG/GraphRAG** but you do *not* need a heavyweight GraphRAG pipeline to start.
- **Orchestration ("playback"/automations):** model on **LangGraph**'s graph-execution semantics, but the graph IS the user's canvas graph — this is the genuinely novel surface.

See [07-architecture-decisions.md](07-architecture-decisions.md) for the reasoning and the decisions that are still genuinely open.

## What still needs a human decision

These are flagged throughout but collected here — they're product/business calls, not research outputs:

1. **Web vs native-first** (changes language/runtime choices).
2. **tldraw licensing** — willing to pay a commercial license, or must it be MIT-licensed foundations?
3. **Whiteboard model vs node-graph model** — freeform canvas (tldraw/Excalidraw) or structured nodes+edges (React Flow). Eido's data is closer to the latter, but the *feel* you describe ("creating, not diagramming") leans former.
4. **How opinionated the AI context compiler is** — deterministic/explainable vs embedding-similarity/automatic. This is the core IP decision.
