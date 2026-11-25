# 01 — Browser Rendering Technologies

The single most consequential architectural decision *if you build the canvas yourself*. If you adopt a mature SDK (tldraw/Excalidraw/React Flow), this is largely decided for you — but you still need to understand it to judge their limits and to know where Eido's text-heavy, graph-heavy workload stresses them.

## The core axis: retained-mode vs immediate-mode

| | **Retained mode** (SVG, DOM, scene-graph libs) | **Immediate mode** (Canvas2D, WebGL, WebGPU) |
|---|---|---|
| Mental model | Browser keeps every shape as an object you mutate | You redraw the frame; browser forgets it instantly |
| Hit-testing / events | Free (DOM events, CSS `:hover`) | You implement it (math + spatial index) |
| Styling | Free (CSS) | You implement it |
| Text editing | Native (contenteditable, IME, selection, a11y) | Painful — must reimplement a text editor |
| Scaling ceiling | Degrades past ~1–3k nodes | Tens of thousands+ of shapes at 60fps |
| Best for | Few rich, interactive, editable elements | Many cheap, mostly-static primitives |

**Pointer 1 from your prompt, resolved for Eido:** the question isn't "which one" — it's "which one *for which layer*." Eido's notes are rich, editable, few-on-screen-at-once → retained/DOM. Eido's connections, indicators, minimap, marquee are many and cheap → immediate. This is exactly the hybrid the mature tools converged on.

## The four technologies

### HTML5 Canvas 2D (immediate)
- Pixel-based, lightweight, great for thousands of paths/strokes/lines.
- You hand-code bounding boxes, hit-testing, redraw scheduling (usually `requestAnimationFrame`).
- **Excalidraw is built on Canvas2D** with a dual-canvas trick (see [03](03-reference-projects.md)). Proven to handle real whiteboards, though it has known slowdowns on very complex scenes ([excalidraw#8136](https://github.com/excalidraw/excalidraw/issues/8136)).

### SVG (retained)
- Every shape is a DOM node. Trivial to style/animate with CSS and attach listeners.
- Falls over past a few thousand nodes (layout/paint cost per element).
- **tldraw historically used SVG for overlays/indicators and is actively migrating them to Canvas2D** — "up to 25x faster rendering" for select/hover over many shapes ([tldraw whats-new 2025](https://tldraw.dev/blog/whats-new-2025), [tldraw#8314](https://github.com/tldraw/tldraw/issues/8314)). A strong signal: even the best React-canvas team is moving *off* SVG for the many-cheap-things layer.

### WebGL (immediate, GPU)
- Hardware-accelerated; the workhorse for high shape counts. **PixiJS** is the leading 2D WebGL renderer (60fps with 8k boxes where Konva managed 23 and Fabric 9 — [canvas-engines-comparison](https://github.com/slaylines/canvas-engines-comparison)).
- Cost: text editing, accessibility, and DOM interop are all your problem. Bad fit for Eido's editable note cards unless you overlay DOM on top.

### WebGPU (immediate, modern GPU + compute)
- Successor to WebGL. As of late 2025 it **ships by default in Chrome, Edge, Firefox, and Safari 26** ([webgpu.com](https://www.webgpu.com/news/webgpu-hits-critical-mass-all-major-browsers/)); Safari 26 covers macOS/iOS/iPadOS/visionOS 26.
- Wins at large data sizes and adds compute shaders (useful for force-directed layout of large graphs, GPU-side culling). Loses to WebGL on tiny workloads due to setup overhead.
- Standard pattern: **WebGPU primary, WebGL fallback** ([openreplay](https://blog.openreplay.com/webgpu-vs-webgl-industry-moving/)).
- For Eido: **overkill at the start.** Revisit only if graphs grow to 10k+ live nodes or you want GPU-accelerated layout/physics.

## What this means for Eido specifically

1. Eido is text-first. **Do not start on a pure WebGL/PixiJS canvas** — you'd be rebuilding a rich-text editor inside a GPU context. That's the trap the IMG.LY/design-tool world lives in, and you explicitly said *this is not a visual design tool*.
2. The right shape is **DOM cards + an immediate-mode edge/indicator layer**. Both tldraw and React Flow do exactly this (React Flow renders nodes as HTML, edges as SVG/Canvas).
3. WebGPU/WebGL is a *later* performance lever for the connection layer and for large-graph layout, not a day-one choice.

**Recommendation:** Don't pick a raw rendering API. Pick an SDK that already implements the hybrid (tldraw or React Flow), and keep WebGPU in your back pocket for the edge/layout layer at scale. Details and trade-offs in [03](03-reference-projects.md) and [07](07-architecture-decisions.md).
