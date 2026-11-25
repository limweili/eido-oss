# 10 — Excalidraw

> Studied from source: `research/repos/excalidraw` (shallow clone, `master`, June 2026). Read-only.
> **Canonical update:** use the later source-verified [Excalidraw Rendering Performance Study](../03-performance-architecture/12-excalidraw-rendering-performance-study.md) for implementation decisions. It corrects this historical note's overly strong claims about immutability, universal RAF throttling, full-scene rendering, and the absence of first-class arrow records.
> **Role for Eido:** the reference for **Canvas2D rendering done well** — the dual-canvas split, memoized culling, per-element canvas caching, and a simple, robust **local-first / reconciliation** model. Its arrows and lines are first-class scene elements, but relationship meaning remains visual-element-centric rather than Eido's semantic Connection model.

---

## 1. Why Excalidraw matters to Eido

Where tldraw ([09](09-tldraw.md)) teaches the *data model*, Excalidraw teaches the *rendering performance discipline* you need if Eido ever renders anything to a raw canvas (its connection/indicator layer almost certainly). It's MIT-licensed, so its patterns **and code** are reusable. It's also the clearest demonstration of the trade-off between "immediate-mode Canvas2D" (fast, but you rebuild text/interaction yourself) and tldraw's "DOM shapes" approach.

---

## 2. Architecture map

| Package | License | Role |
|---------|---------|------|
| `@excalidraw/excalidraw` | MIT | The React editor: `scene/Renderer`, `renderer/staticScene`, `renderer/interactiveScene`, `data/` (persistence) |
| `@excalidraw/element` | MIT | The element model + geometry: `types.ts`, `renderElement.ts`, `bounds.ts`, `binding.ts`, `frame.ts`, `Scene.ts` |
| `@excalidraw/math` | MIT | Coordinate/geometry primitives |
| `@excalidraw/common`, `@excalidraw/utils` | MIT | Shared helpers, LS keys |

Unlike tldraw, there is **no reactive store and no signals**. State is a plain array of readonly-typed element records + an `AppState`; updates commonly replace records, although mutation and explicit cache-deletion paths also exist. Rendering is driven imperatively, with RAF coalescing where the render-throttling policy enables it. This is a meaningfully different philosophy — and the reason Excalidraw is simpler but less suited to "graph as live database."

---

## 3. The element model (`packages/element/src/types.ts`)

Every element is a flat, **`Readonly`** record:

```ts
type _ExcalidrawElementBase = Readonly<{
  id: string
  x, y, width, height, angle      // geometry
  strokeColor, backgroundColor, fillStyle, strokeWidth, ... , opacity   // style
  seed: number                    // stable RoughJS seed (hand-drawn look)
  version: number                 // ++ on every change — for reconciliation
  versionNonce: number            // random; tie-breaker in reconciliation
  index: FractionalIndex | null   // fractional z-order, multiplayer-safe
  isDeleted: boolean              // SOFT delete (tombstone) — sync-friendly
  groupIds: readonly GroupId[]    // grouping (deepest→shallowest)
  frameId: string | null          // containment in a frame
  boundElements: readonly BoundElement[] | null  // ← "edges", but weak (see §5)
  updated: number                 // epoch ms of last change
  link, locked, customData        // escape hatch = customData
}>
```

Patterns worth copying for Eido:
- **Immutability + `version`/`versionNonce`/`updated`**: mutations produce *new* objects with bumped version. This powers (a) referential-identity caching (§4.3) and (b) **reconciliation** for collaboration without a full CRDT (`data/reconcile.ts` resolves by version, nonce as tie-break). It's an OT-flavored, last-writer-ish approach — simpler than CRDTs, weaker guarantees. Contrast with [04](04-collaboration-and-local-first.md).
- **Soft delete (`isDeleted`)** rather than removal — the right call for offline/sync and for Eido's "idea evolution timeline" (you can resurrect/trace deleted thoughts).
- **`fractionalIndex`** for ordering that survives concurrent edits (same idea as tldraw's `index`).
- **`customData`** as the per-element escape hatch (tldraw's `meta` equivalent).

---

## 4. The rendering pipeline (the part to study closely)

### 4.1 Dual-canvas architecture
Two stacked `<canvas>` layers:
- **StaticCanvas** — draws the document elements; redraws only when content/viewport/appState change.
- **InteractiveCanvas** — selection boxes, handles, remote cursors, snap lines; redraws constantly and cheaply, *without* touching the static layer.

This is the canonical answer to "keep it smooth": isolate the always-changing ephemeral UI from the expensive document render. **Directly applicable to Eido** even on top of another canvas lib: the "many cheap, always-moving" things (connection lines, weight halos, playback animation) belong on an interactive layer separate from the note cards ([01](01-rendering.md)).

### 4.2 Viewport culling — memoized linear scan (`scene/Renderer.ts`)
- `getRenderableElements()` builds a `canvasNonce = sceneNonce (+ newElement version)` and calls a **`memoize`d** `_getRenderableElements` keyed on `canvasNonce` + viewport params (`zoom, scrollX/Y, width/height, offsets`). If nothing changed, the previous result is returned untouched.
- Inside, `getVisibleCanvasElements()` **linearly scans all elements**, keeping those where `isElementInViewport()` is true.
- `isElementInViewport()` (`element/src/sizeHelpers.ts`) is a plain **AABB intersection**: get element scene bounds `[x1,y1,x2,y2]`, convert viewport corners to scene coords, test overlap.

> **Key contrast with tldraw:** Excalidraw culls with an **O(n) scan that's memoized on a scene nonce**; tldraw culls with a **spatial index + incremental reactive set-diff**. Excalidraw's approach is simpler and totally fine up to low-tens-of-thousands of elements because the scan only reruns when the scene or viewport actually changes. For Eido's scale (hundreds–thousands of nodes), *either* is sufficient — but if graphs grow, tldraw's spatial-index approach (or `rbush`, [06](06-text-input-and-spatial-infra.md)) scales better.

### 4.3 Per-element canvas cache (`element/src/renderElement.ts`)
`elementWithCanvasCache = new WeakMap<ExcalidrawElement, ElementWithCanvas>()`. Each element is rendered once to its **own offscreen canvas**, cached by element *identity*. `generateElementWithCanvas` regenerates only when something visual changed: zoom value, theme, bound-text version, image crop, containing-frame opacity, or (for labeled arrows) angle. On a normal frame, drawing the scene = blitting cached per-element canvases at the right transform — very cheap.

Because updates commonly replace element records, a changed element is usually a *new object* → automatic `WeakMap` miss → regenerate just that one. Explicit mutation/cache-deletion paths mean identity-aware invalidation must still be designed rather than assumed.

### 4.4 Throttling
`renderStaticSceneThrottled = throttleRAF(renderStaticScene)` provides a coalesced path when Excalidraw's render-throttling policy enables it; not every static render call is unconditionally RAF-throttled.

---

## 5. Arrows are scene records; relationship semantics are visual-centric

Arrows and lines are first-class scene element records. Their endpoint relationships exist as:
- `boundElements: BoundElement[]` on an element (a back-reference list), and
- arrow-specific `startBinding` / `endBinding: FixedPointBinding` on linear elements (`binding.ts`).

So an arrow knows what it binds to, and a shape knows what's bound to it, but relationship meaning remains attached to visual elements and bindings rather than a semantic Connection record designed for graph queries. This is fine for a whiteboard and the wrong domain model for Eido, whose Connections carry meaning independently of their painted arrow.

> Lesson: Excalidraw's arrow/binding model is a rendering reference, not a substitute for Eido's semantic Connection model.

---

## 6. Local-first & persistence
- `data/EditorLocalStorage.ts`: thin typed wrapper over `localStorage` (JSON). The full app additionally uses IndexedDB for larger scene/file blobs.
- `data/restore.ts`: normalizes/upgrades loaded scenes — fills defaults, drops invalid elements, repairs bindings — i.e. tolerant loading instead of formal migrations (contrast tldraw's versioned migration sequences; tldraw's is more robust for long-lived docs).
- `data/reconcile.ts`: merges local + remote element arrays using `version`/`versionNonce`. A pragmatic, CRDT-free collaboration story.

---

## 7. What to extract for Eido

1. **Dual-canvas split** — document layer vs ephemeral-interaction layer. Adopt for Eido's connection/playback/indicator rendering regardless of the underlying canvas lib.
2. **Memoize render-input selection on a scene nonce + viewport key** — recompute visible set only when something actually changed.
3. **Per-element offscreen canvas cache via `WeakMap` keyed on element identity with explicit invalidation inputs** — for any expensive passive render.
4. **Immutability + `version`/`versionNonce`/`updated`/`isDeleted`** as a lightweight reconciliation + timeline model (a viable simpler alternative to CRDTs for v1 single-player; see [04](04-collaboration-and-local-first.md)).
5. **Tolerant `restore()` on load** as a complement to formal migrations.
6. **`throttleRAF`** where coalescing matches the render path; do not assume every redraw uses it.

What **not** to copy: the embedded/arrow-specific binding model (§5), and rendering text to canvas (Excalidraw maintains a separate `wysiwyg` DOM overlay for text editing — evidence that canvas-rendered text is painful, reinforcing Eido's DOM-cards choice in [01](01-rendering.md)).

---

## 8. Licensing & feasibility
- **MIT** across all packages — patterns and code are freely reusable in Eido.
- Builds with Yarn workspaces (esbuild for packages, Vite for app per `CLAUDE.md`); not built here. Source reading was sufficient.

---

## 9. Verdict (CTO take)

Excalidraw is the **rendering-performance textbook**, not a data-model template. For Eido, treat it as the source of three concrete, MIT-licensed techniques — **dual-canvas, memoized culling, per-element WeakMap caching** — to apply to whatever canvas substrate we choose. Its element model contributes the *lightweight reconciliation + soft-delete + fractional-index + customData* ideas, which are a credible simpler-than-CRDT path for a single-player v1.

But on the dimension that defines Eido — **Connections as first-class, meaning-bearing objects** — Excalidraw is the wrong model. It makes arrows first-class visual elements while keeping endpoint meaning in visual bindings; Eido's semantic graph must remain independent of its painted representation. Excalidraw teaches Eido how to render a view, not how to be the graph.
