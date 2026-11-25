# 03 — Open-Source Reference Projects

Don't build the canvas from scratch. Study (and probably adopt) these. Grouped by how relevant their *model* is to Eido.

---

## Tier 1 — Closest to Eido's actual data shape

### React Flow / Svelte Flow (xyflow)
**License: MIT.** The single most aligned reference, because Eido's data is *literally* nodes + edges, not freeform drawing.

- **Model:** nodes are **HTML elements** (so rich text, inputs, anything React lives inside them — perfect for editable note cards); edges are SVG/Canvas paths with bezier routing; explicit handles/anchors connect nodes.
- Solves exactly the mechanics you listed: anchoring nodes together, bezier connection curves, drag-and-drop, mapping structural coordinates, multi-selection.
- The de-facto base for node-based AI tools (Flowise, Langflow, n8n-style builders all resemble it) — which is also Eido's "automations/playback" surface. Building Eido's canvas *and* its orchestration UI on the same node/edge primitive is a real architectural win.
- **Limit:** it's a node-graph editor, not an "infinite freeform whiteboard." If you want the loose, sketchy "I'm creating not diagramming" feel, you'd be adding that on top.

**Steal:** the node-as-DOM + edge-as-overlay split; the handle/connection system; the controlled-vs-uncontrolled node state model.

---

## Tier 2 — Best-in-class infinite canvas engines

### tldraw
**License: source-available, *commercial license required* for commercial use** ([github.com/tldraw/tldraw](https://github.com/tldraw/tldraw)). This is a real gate — decide early.

The most instructive architecture in the space. Internals (from [tldraw DeepWiki](https://deepwiki.com/tldraw/tldraw) + docs):

- **`@tldraw/state`** — a fine-grained **signals** reactive system (atoms + computeds). The editor exposes state as reactive signals (`editor.getCurrentPageShapes()` etc.) that auto-update dependents. This is how the canvas stays fast: only what changed recomputes.
- **`@tldraw/store`** — a reactive in-memory record DB. Records (`TLShape`, `TLBinding`, pages, assets, camera) are JSON-serializable; queries are computed values that update automatically.
- **`@tldraw/tlschema`** — schema + migrations for records (matters a lot for a note app where users keep documents for years).
- **`ShapeUtil`** — defines each shape type's geometry, rendering, hit-testing, behavior. Eido's "note", "thought component", "output node" would each be a custom shape.
- **`BindingUtil`** — typed connections between shapes (the arrow-to-box mechanism). **This is the natural home for Eido's weighted/typed/negative connections.**
- **Camera/viewport** system handles zoom-to-cursor, panning, coordinate transforms; rendering does **shape culling** so off-screen shapes aren't rendered.
- **Sync:** the store is observable → syncable via tldraw sync, Yjs, or custom WebSocket (see [04](04-collaboration-and-local-first.md)).

**Steal (even if you don't use it):** the signals-store-schema separation, ShapeUtil/BindingUtil extensibility pattern, and the "store is just observable records" approach to persistence/sync. This is the cleanest mental model for "the graph is the product, the canvas is a view."

### Excalidraw
**License: MIT.** The reference for *Canvas2D done well*.

Internals (from [Excalidraw DeepWiki rendering](https://deepwiki.com/excalidraw/excalidraw/5.1-canvas-rendering-pipeline)):

- **Dual-canvas architecture:** `StaticCanvas` (document elements, redraws only when content/viewport changes) + `InteractiveCanvas` (selection handles, cursors, hints — redraws constantly, cheaply). **This is the key performance pattern** and directly answers "how do I keep it fast."
- **Viewport culling:** `Renderer.getRenderableElements()` filters via `isElementInViewport()` → `visibleElements`, **memoized** on viewport params + `sceneNonce`.
- **Per-element canvas caching** in a `WeakMap`, invalidated only when visual props change.
- **Throttling** redraws via `requestAnimationFrame`.
- Canvas size limits (max 16,777,216px² / 32,767px/side) with auto scale-down — a real gotcha for "infinite" canvases.

**Steal:** dual-canvas split, memoized culling, per-element caching. Even if you use React Flow/tldraw, these patterns inform your custom edge/indicator layer.

---

## Tier 3 — General-purpose rendering engines (lower-level building blocks)

| Library | License | Model | When you'd reach for it |
|---------|---------|-------|------------------------|
| **PixiJS** | MIT | WebGL/WebGPU 2D scene graph; submits display tree to GPU each frame | Only if the connection/particle layer needs tens of thousands of GPU-drawn elements. Fastest (60fps @ 8k boxes). Bad at text editing. |
| **Konva** | MIT | Canvas2D scene graph + node model, built-in drag/drop + events, React/Vue/Svelte bindings | A middle ground if you want a scene-graph with events but not a full whiteboard SDK. ~23fps @ 8k boxes. |
| **Fabric.js** | MIT | OOP Canvas2D with built-in selection/scale/rotate bounding boxes, SVG parsing | Design-editor ergonomics out of the box. Slowest at scale (~9fps @ 8k boxes). You scoped *out* visual design, so less relevant. |

(Benchmarks: [canvas-engines-comparison](https://github.com/slaylines/canvas-engines-comparison).)

---

## Recommendation / decision path

1. **If you can pay tldraw's commercial license** → strongest foundation; richest extensibility (ShapeUtil/BindingUtil map perfectly onto notes/connections); you inherit camera, culling, snapping, persistence hooks.
2. **If you need MIT** → **React Flow** is the most aligned (its node/edge model IS Eido), and it doubles as the substrate for your automations/playback UI. Add freeform "canvas feel" on top.
3. **Either way, study Excalidraw's dual-canvas + memoized culling** for whatever custom rendering you add.
4. **PixiJS/Konva/Fabric** are components, not foundations — pull them in only for a specific measured need.

The live cross-cutting decision — *freeform whiteboard feel* (tldraw/Excalidraw) **vs** *structured node-graph* (React Flow) — is a product/feel question, surfaced in [README](README.md#what-still-needs-a-human-decision) and [07](07-architecture-decisions.md).
