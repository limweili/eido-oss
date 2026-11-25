# Eido Research 2 - Excalidraw Source Study

Repo inspected: `research/repos/excalidraw`  
Commit: `069982606dd7178c13e6c2293ede756c6767d3bc`  
Primary docs used:

- [Excalidraw API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api)
- [Excalidraw Restore Utilities](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/restore)

## Bottom Line

Excalidraw is an excellent reference for a lightweight, high-performance, permissively licensed drawing canvas. It is less natural as Eido's core model because Eido's edges need to be semantic relationships, not only arrow endpoints.

Excalidraw is probably more valuable as a source of rendering, scene, persistence, and UX lessons than as the engine for Eido's property graph.

## Wireframe Fit

| Wireframe object | Excalidraw fit | Notes |
| --- | --- | --- |
| `IDEA` | App/document wrapper | Excalidraw scenes are document-like but not semantically typed. |
| `THOUGHT` | Frame-like element | Frames and magic frames can group visual elements. |
| `NOTE` | Text or container+text | Possible, but note editing is not the center of the model. |
| Line/bullet ports | Weak fit | Internal text anchors are not first-class. |
| Strong/weak arrows | Visual fit, semantic weak fit | Arrows can bind to elements, but relationships are embedded in drawing elements. |
| Output stack `v3` | Custom elements or metadata | Possible, but would become an Eido layer on top. |
| `MOD` bubble | Shape with `customData` | Easy visually, but semantics live outside the core model. |

## Source Spine

The useful areas are:

- `packages/element/src/types.ts` - element model, custom data, frame IDs, bound elements, text containers.
- `packages/element/src/binding.ts` - arrow/line binding model.
- `packages/element/src/frame.ts` - frame membership and frame-like helpers.
- `packages/element/src/Scene.ts` - scene indexes, element maps, frame maps, selected-element caches.
- `packages/excalidraw/components/canvases/StaticCanvas.tsx` - static render layer.
- `packages/excalidraw/components/canvases/InteractiveCanvas.tsx` - interaction overlay layer.
- `packages/excalidraw/scene/Renderer.ts` - visible element filtering, renderable maps, scene nonce.
- `packages/excalidraw/renderer/staticScene.ts` - static scene drawing and frame clipping.
- `packages/excalidraw/data/restore.ts` - scene restoration, binding repair, dimensions, index normalization.
- `packages/excalidraw/data/json.ts` - serialization.

## What Excalidraw Proves

Excalidraw proves that a canvas can feel fast and direct with a comparatively simple model. Elements carry position, size, angle, styles, version fields, grouping, frame membership, links, lock state, deletion state, and `customData`.

The `StaticCanvas` and `InteractiveCanvas` split is important. A canvas product does not need one monolithic rendering layer. Excalidraw separates durable scene drawing from interaction overlays like selection, cursors, handles, and animations. Eido may need a similar split: stable notes and edges below, active editing affordances above.

The renderer maintains visibility filtering and renderable element maps. This is directly relevant to Eido if it supports hundreds or thousands of notes.

The restore utilities are also valuable. Excalidraw explicitly repairs bindings, dimensions, and fractional indices when restoring scene data. This is a reminder that long-lived canvas documents will drift unless the app has repair and migration machinery.

The public API exposes scene updates through `updateScene` with `elements` and `appState`, and restore utilities can merge local elements while preserving newer versions/nonces. That is a useful persistence and import/export pattern.

## Where It Fights Eido

Excalidraw's relationship model is visual first. Arrows and lines can have start/end bindings, but the semantic relationship is attached to the arrow element. Eido needs the reverse: the relationship is the product object, and the visible arrow is one rendering of it.

For the wireframe, the hardest mismatch is line-level anchoring. Excalidraw can bind arrows to elements, but note lines or paragraphs are not naturally separate graph nodes. Eido could make each bullet a separate text element, but that would turn note editing into canvas editing. That is likely the wrong feel for a note-taking-first app.

`customData` is helpful, but it is not enough by itself. It lets Eido attach metadata to Excalidraw elements, but the semantic graph would still be an application layer outside the canvas model.

## What To Borrow

- Dual canvas architecture: static scene plus interactive overlay.
- Fast visibility filtering and renderable element maps.
- Simple JSON scene serialization.
- Version/versionNonce concepts for conflict and freshness tracking.
- Restore/repair utilities for document health.
- Frame grouping and frame membership patterns.
- The product lesson that canvas UX should feel immediate and low-friction.

## What To Avoid

- Using arrows as the source of truth for Eido relationships.
- Modeling rich notes as a pile of independent text boxes.
- Copying drawing-tool affordances that make Eido feel like a sketchpad instead of a thought workspace.
- Assuming MIT license makes it architecturally free. It is legally easy to reuse, but the data model may still be the wrong center.

## Role In Eido Research

Excalidraw is a strong fallback reference if Eido builds a custom canvas instead of adopting tldraw. It is also useful for comparing complexity: tldraw offers a deeper extensible editor/store, while Excalidraw demonstrates how far a simpler scene model can go.

For Eido, I would treat Excalidraw as a rendering and interaction reference, not the semantic engine.

## Open Questions

- Should Eido optimize first for freehand sketch feel or structured note feel?
- Would Eido ever need hand-drawn/freeform visual style, or is the sketch just a conceptual artifact?
- If Eido builds its own canvas, should it follow Excalidraw's dual-canvas model or use SVG/DOM for semantic objects?
- How much of Excalidraw's restore/repair approach should be copied into Eido's graph migrations?

