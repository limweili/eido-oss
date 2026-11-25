# Excalidraw Rendering Performance Study

> Re-verified: 2026-08-20
>
> Official upstream: [`excalidraw/excalidraw`](https://github.com/excalidraw/excalidraw)
>
> Pinned source: [`e160ff7ba0641fba729c528482de5277ffb19c58`](https://github.com/excalidraw/excalidraw/tree/e160ff7ba0641fba729c528482de5277ffb19c58) (upstream `master` on 2026-08-20; commit dated 2026-08-16)
>
> Previous donor snapshot: `069982606dd7178c13e6c2293ede756c6767d3bc`
>
> Question: how does Excalidraw keep pan, zoom, and drag smooth with very large text, and which parts can Eido safely adopt without losing native Card behavior?

## Decision

The user's proposed invariant is right—**pixels already visible when motion begins should remain continuously visible throughout pan, zoom, and drag**—but Excalidraw does not achieve it by virtualizing the visible lines of one giant text element.

Excalidraw's decisive trick is simpler:

1. Ordinary scene text is Canvas2D paint, not a persistent rich DOM tree.
2. Each element is rasterized into a persistent per-element canvas and normal frames copy those cached pixels.
3. A position-only move does not invalidate the raster.
4. Pan and drag work is coalesced to animation frames.
5. Continuous zoom deliberately scales the existing raster, then refreshes its resolution after motion settles.
6. Only the text element being edited switches to a native DOM editor.

That architecture makes a million characters cheap **after** their initial layout/rasterization because motion no longer revisits those characters. It does not make a million live DOM descendants cheap.

Eido should copy the invariant—**retain already-painted work across motion**—not Excalidraw's exact renderer. A controlled Eido A/B rejected the manual raster-overlay translation: installing and retiring the duplicate Card cover added roughly 116–156 ms stalls at gesture boundaries. After isolating zoom opacity as a standard, non-inherited value on each shallow React Flow Card wrapper, the fully live-DOM variant measured 16.8 ms pan p95 and 17.0 ms zoom p95, with a 33.4 ms maximum frame and no long tasks. It also avoided every capture, decode, cover-swap, fidelity, and interaction-authority problem.

The adopted Eido translation is therefore **retained live Card surfaces**. Keep every mounted Card's existing browser-painted DOM visible; ensure camera/zoom styles change only on shallow wrappers instead of inheriting through rich descendants; prevent board geometry and selection churn from rerendering semantic Markdown/transcript subtrees; and preserve DOM identity across motion. No gesture-time opacity-to-empty and no duplicate raster surface participate in correctness.

Scroll position is separate bounded UI memory: a 1,024-entry true LRU keyed by `(Idea id, Card id)`. Recent Cards restore their native scroll state across ordinary DOM eviction/remount; ordinary LRU eviction is allowed and falls back to that Card's default position.

## Evidence Labels

- **Source fact** means the pinned upstream code or an explicitly linked maintainer statement says or implements it.
- **Repository observation** means it was verified in this Eido checkout on 2026-08-20.
- **Controlled measurement** means a disposable benchmark against the pinned upstream production build; it is evidence for mechanism and relative cost, not a portable product guarantee.
- **Inference** means it follows from the source but is not an upstream claim.
- **Adopted direction** is the Eido architecture selected by the repository experiment and decisive runtime A/B.

## What Excalidraw Actually Does

### 1. It separates editor UI from high-frequency canvas state

**Source fact.** Excalidraw keeps scene elements as lightweight records and composes three viewport-sized, absolutely positioned Canvas2D layers: static scene content, the element currently being created, and interactive UI such as selection handles. The canvas wrappers subscribe to narrow state slices and use custom memo comparisons.

- [Canvas composition](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L2573-L2656)
- [Canvas stacking styles](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/css/styles.scss#L104-L134)
- [Static canvas comparison surface](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/canvases/StaticCanvas.tsx#L77-L134)
- [Interactive canvas comparison surface](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/canvases/InteractiveCanvas.tsx#L235-L311)

Current source also deliberately excludes high-frequency camera/canvas transients from the editor's `UIAppState`, so canvas motion need not rerender the surrounding React UI.

- [`UIAppState` omissions](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/types.ts#L564-L582)
- [Layer UI's narrow subscription](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/LayerUI.tsx#L701-L739)

Historical maintainer descriptions agree with the current implementation: Excalidraw cofounder vjeux summarized the two core optimizations as RoughJS **shape caching** and canvas caching—draw once, then copy pixels ([maintainer comment](https://github.com/excalidraw/excalidraw/issues/1051#issuecomment-602279999)). The later static/interactive canvas split was introduced as a large-scene optimization ([PR #6759](https://github.com/excalidraw/excalidraw/pull/6759)).

### 2. It culls whole elements, not lines inside an element

**Source fact.** `Renderer.getVisibleCanvasElements()` scans the non-deleted element map and retains elements whose bounds intersect the viewport. The static scene renderer iterates that visible set.

- [Whole-element visible-set scan](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/scene/Renderer.ts#L47-L87)
- [Viewport/bounds intersection](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/sizeHelpers.ts#L49-L84)
- [Static renderer consumes visible elements](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/renderer/staticScene.ts#L285-L392)
- [Visible-set memoization inputs](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/scene/Renderer.ts#L159-L228)

This scan is `O(n)` in scene element count. There is no spatial index and no paragraph, line, or tile culling inside one text element.

### 3. Each ordinary element has a persistent raster cache

**Source fact.** Non-export rendering first paints an element into a detached `HTMLCanvasElement`. `elementWithCanvasCache` stores the result in a `WeakMap` keyed by the mutable element object. Normal scene frames then use `drawImage()` to blit the cached raster at its current scene position.

- [Per-element canvas creation and scale limits](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/renderElement.ts#L135-L270)
- [Raster cache lookup and invalidation](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/renderElement.ts#L534-L584)
- [Cached raster blit](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/renderElement.ts#L586-L665)
- [Normal non-export path uses the cache](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/renderElement.ts#L905-L984)

RoughJS geometry has an independent identity-keyed cache, so unchanged shapes also avoid path regeneration ([`ShapeCache`](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/shape.ts#L82-L164)).

Each element canvas is capped at 32,767 pixels on either axis and 16,777,216 pixels in area. Oversized elements are rasterized at a reduced scale rather than allocating an unbounded bitmap. At four decoded bytes per pixel, the area cap is still approximately 64 MiB for one full-size RGBA surface; it is a safety ceiling, not a sensible per-Card Eido budget.

### 4. Position changes preserve the cached pixels

**Source fact.** Dragging mutates element coordinates through `scene.mutateElement()` while preserving the element object's identity. Cache invalidation covers render-affecting geometry such as width, height, file, and points; `x` and `y` do not evict the element raster or RoughJS shape.

- [Drag coordinate mutation](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/dragElements.ts#L204-L220)
- [Mutation and cache invalidation rules](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/mutateElement.ts#L77-L143)

**Inference.** Once a huge text element has a valid raster, dragging it changes only where the bitmap is copied. It does not split, measure, wrap, or repaint that text on every pointer event.

### 5. Text layout is front-loaded, not virtualized

**Source fact.** Ordinary text rendering splits `element.text` on newlines and calls Canvas2D `fillText()` once for each rendered line while generating the element raster.

- [Canvas text rendering](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/renderElement.ts#L477-L527)
- [Line measurement](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/textMeasurements.ts#L12-L26)
- [Eager wrapping work](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/textWrapping.ts#L397-L478)
- [Per-font character-width cache](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/textMeasurements.ts#L179-L208)

There is no whole-string layout cache or within-element line virtualizer. Initial paste, layout, wrapping, and raster generation can therefore still be expensive. The win is that those costs are not repeated during motion.

#### Important “one million characters” paste nuance

**Source fact.** Normal empty-canvas paste, unless plain paste is requested, splits hard-newline text into separate non-empty text elements and wraps long lines to a bounded width. A large multiline document pasted through this path may therefore become many independently cullable elements rather than one giant text element ([paste path](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L4843-L4929)).

**Inference.** A million-character demo can benefit from both cached pixels and element-level culling depending on how its content was imported. It is not evidence that Excalidraw can keep a million rich DOM nodes live or that it virtualizes the visible lines of one giant element.

### 6. Pan and drag are latest-event, once-per-frame work

**Source fact.** `throttleRAF` retains the latest call arguments and invokes work at most once per animation frame. The official app enables render throttling; pan, drag, and the static renderer use RAF-coalesced paths.

- [`throttleRAF`](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/common/src/utils.ts#L154-L195)
- [Official app enables throttling](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/excalidraw-app/App.tsx#L154-L157)
- [Pan handler](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L8939-L9012)
- [Drag pointer coalescing](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L10478-L10485)
- [Static render coalescing](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/renderer/staticScene.ts#L488-L507)

The reusable package gates the throttled React renderer on its environment/feature flag; this is not a claim that every embedding or every render path is unconditionally throttled ([selection policy](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/reactUtils.ts#L34-L61)).

### 7. Continuous zoom reuses stale-resolution pixels, then refines

**Source fact.** During pinch/wheel zoom Excalidraw sets `shouldCacheIgnoreZoom`. A zoom mismatch then does not invalidate each element canvas, so the existing bitmap is resampled during the gesture. After 300 ms without more wheel input the flag is reset and settled rendering may regenerate at the final resolution.

- [Zoom-aware cache invalidation](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/renderElement.ts#L539-L584)
- [Wheel zoom reuse and idle reset](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L13715-L13734)
- [Settled reset path](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L13824-L13828)
- [Cached-image smoothing during transient zoom](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/renderElement.ts#L919-L939)

This is temporal quality reuse, not semantic LOD: content remains present while transient sharpness is allowed to soften.

### 8. It redraws the viewport; it does not use dirty rectangles

**Source fact.** The static path clears or fills the viewport canvas and loops over the current visible elements. The performance comes from cheap cached blits and layer separation, not dirty-region accumulation.

- [Viewport clear/fill bootstrap](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/renderer/helpers.ts#L32-L85)
- [Static scene paint loop](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/renderer/staticScene.ts#L236-L392)

### 9. Active editing is a representation switch

**Source fact.** A text element stores semantic `originalText` and derived/render-ready `text`. While it is edited, the renderer removes that element from the canvas scene and `textWysiwyg()` creates one absolutely positioned native `<textarea>`. Submission removes the editor and restores canvas rendering.

- [Semantic and derived text fields](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/types.ts#L235-L257)
- [WYSIWYG edits `originalText`](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/wysiwyg/textWysiwyg.tsx#L199-L225)
- [Editing text excluded from canvas](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/scene/Renderer.ts#L89-L117)
- [Native textarea creation](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/wysiwyg/textWysiwyg.tsx#L427-L464)
- [Editor teardown](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/wysiwyg/textWysiwyg.tsx#L983-L1022)

**Transferable lesson.** Keep semantic authority separate from motion mechanics. Excalidraw can switch representations because ordinary text is already a canvas element; Eido's decisive A/B does not justify the same switch. An Eido Card's native surface remains live in both settled and motion states.

### 10. It does not use OffscreenCanvas or a render worker

**Source fact plus checkout-wide negative search.** At the pinned SHA, scene rasterization explicitly creates ordinary DOM canvases. The checkout contains no `OffscreenCanvas`, `transferControlToOffscreen`, or `createImageBitmap` render path. The worker pool used near the editor is for WOFF2 font subsetting, not scene paint.

- [Ordinary canvas creation](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/renderElement.ts#L202-L270)
- [Worker-pool module](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/workers.ts#L5-L10)
- [Font-subsetting worker consumer](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/subset/subset-main.ts#L8-L48)

PR #6759 mentioned OffscreenCanvas/workers as future analysis, which further confirms that they were not the optimization delivered by the layer split ([PR #6759](https://github.com/excalidraw/excalidraw/pull/6759)).

### 11. It also defers or declines non-essential work

**Source fact.** Excalidraw contains workload-specific escape hatches outside the core scene renderer. Font-family hover preview is skipped above 200 selected text elements or 5,000 combined characters ([guard](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/actions/actionProperties.tsx#L1145-L1167)). Local persistence is debounced by 300 ms before serializing the element array ([timeout](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/excalidraw-app/app_constants.ts#L1-L9), [save path](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/excalidraw-app/data/LocalData.ts#L73-L147)).

These do not explain cached motion, but they reinforce the larger policy: interaction-critical frames should not inherit unrelated preview or persistence work. Deferred work can still create a release/settle spike and must be measured there.

### 12. “One million characters” is not an upstream performance contract

**Source fact plus checkout-wide search.** The pinned root scripts expose test, typecheck, lint, and build tasks but no checked-in browser performance gate for a million-character scene. A manual timing/FPS helper exists, but the production renderer does not call it; an unrelated ordering microbenchmark is skipped.

- [Root scripts](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/package.json#L51-L91)
- [Manual debug helper](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/common/debug.ts#L7-L153)
- [Skipped ordering microbenchmark](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/tests/sortElements.test.ts#L412-L445)

### 13. Canvas selection and clipboard are model-backed, not a semantic DOM mirror

**Source fact.** Excalidraw retains structured application data separately from the bitmap: `ExcalidrawElement` is a JSON-serializable union of scene records, and a text record stores both render-ready `text` and semantic `originalText`. That model supports collaboration, editing, hit-testing, and serialization; it is not itself a DOM or accessibility tree.

- [JSON-serializable scene-record model](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/types.ts#L201-L216)
- [Text record fields](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/types.ts#L235-L257)

**Source fact.** Ordinary settled text is painted with Canvas2D `fillText()`. Pointer selection geometrically hit-tests scene records, then writes their IDs into `appState.selectedElementIds`; drag-box selection computes which records lie within a temporary selection rectangle. `getSelectedElements()` resolves those IDs back to records. Selection borders and handles are themselves painted on the interactive canvas. At rest, ordinary canvas text can therefore be selected only as an object, not as a browser `Selection` over DOM text.

- [Ordinary text paint](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/renderElement.ts#L480-L526)
- [Geometric element hit-testing](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L6451-L6509)
- [Pointer selection updates `selectedElementIds`](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L9417-L9557)
- [Drag-box selection resolves contained records](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L11305-L11346)
- [Model-backed selected-element lookup](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/selection.ts#L161-L213)
- [Canvas-painted selection affordances](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/renderer/interactiveScene.ts#L1917-L1957)

**Source fact.** Default object copy also comes from the structured, JSON-serializable scene model. The copy action gathers selected records and serializes Excalidraw JSON; the clipboard writer places that JSON in both Excalidraw's custom MIME type and `text/plain`. Human-readable text extraction is a separate **Copy text** command that concatenates whole selected text elements—it is not arbitrary native selection of at-rest canvas glyphs, and the serializable model is not an AX mirror.

- [Selected-record copy action](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/actions/actionClipboard.tsx#L23-L53)
- [Clipboard JSON and MIME payloads](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/clipboard.ts#L143-L210)
- [Explicit whole-element Copy text command](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/actions/actionClipboard.tsx#L254-L285)
- [Whole-text concatenation](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/element/src/textElement.ts#L519-L533)

Separate **Copy as SVG** and **Copy as PNG** commands export a visual rendition; they do not make ordinary canvas glyphs natively selectable ([source](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/actions/actionClipboard.tsx#L124-L252)).

**Source fact.** On canvas paste, `parseClipboard()` recognizes serialized Excalidraw records in the clipboard text payload; the app restores and duplicates those records into the scene, then selects the new objects. Non-Excalidraw plain text follows the text-import path described in section 5.

- [Clipboard payload recognition](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/clipboard.ts#L520-L555)
- [Canvas paste routing](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L4585-L4639)
- [Record restoration, duplication, and selection](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L4642-L4774)

**Source fact.** For ordinary text elements, native substring selection and copy return only during editing. `textWysiwyg()` creates a focusable `<textarea>` containing `originalText`; the document copy and cut handlers deliberately return for writable targets, including that WYSIWYG textarea, leaving the browser to handle its selection. Teardown removes the textarea and returns the element to canvas paint.

- [Native editing textarea](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/wysiwyg/textWysiwyg.tsx#L427-L463)
- [Object copy/cut handlers yield to writable controls](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L4297-L4327)
- [WYSIWYG and textarea are writable targets](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/common/src/utils.ts#L77-L92)
- [Textarea teardown](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/wysiwyg/textWysiwyg.tsx#L842-L863)

Pasting an Excalidraw object payload into that active textarea takes the opposite bridge: the editor extracts text from the copied elements and inserts it at the native textarea range rather than inserting shapes ([source](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/wysiwyg/textWysiwyg.tsx#L531-L580)).

**Source fact plus checkout-wide negative search.** The interactive scene's complete JSX is one `<canvas>` whose only child is the localized generic “Drawing canvas” fallback, while the editor root—not each ordinary scene element—is the focusable DOM target. Its markup supplies no per-element roles, tab stops, or live announcements for ordinary shapes or settled text. Narrow DOM exceptions exist—the active native textarea, frame-name overlays, and embeddables rendered as titled iframes—but they do not form a general per-element semantic/AX mirror. Surrounding editor controls do use ARIA labels and roles, so this finding is specifically about scene content rather than the entire application UI.

- [Interactive canvas DOM surface](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/canvases/InteractiveCanvas.tsx#L202-L231)
- [Focusable editor root](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L2340-L2396)
- [Frame-name DOM overlay](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L2118-L2277)
- [Titled iframe overlay](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/App.tsx#L2023-L2048)
- [ARIA-labelled toolbar controls](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/components/Tools.tsx#L275-L293)

**Inference, not upstream-stated policy.** The implementation leaves ordinary at-rest canvas elements without continuous per-element native focus, text selection, or AX nodes, and compensates with model selection, model-driven clipboard commands, and a temporary native editor. The pinned source does not document that limitation as an explicit accessibility policy.

**Inference — Eido implication and adopted direction.** Excalidraw's working clipboard commands do not prove that pixels preserve browser semantics. Eido's mounted Card DOM remains the one visual, interaction, and AX surface during motion: board selection may remain application state, but native Card text selection/copy, links, controls, focus, headings, labels, and reading order must not be replaced by a raster or a duplicate hidden semantic tree. This strengthens the retained-live-DOM decision; the transferable lesson is narrow invalidation, not Excalidraw's observed at-rest semantic limitation.

## Controlled Upstream Benchmark

**Controlled measurement.** A disposable harness built the pinned source in production mode and ran it in headless Chromium 151 on an Apple M4 / 24 GB / macOS 26.5 host at 1,200 × 800 and DPR 1. It injected synthetic saved scenes, instrumented Canvas2D `fillText`/`drawImage`, animation frames, and long tasks, then exercised 72 pan updates, 72 drag updates, and 48 continuous zoom updates. Synthetic scene injection intentionally bypassed paste/wrapping cost so this measures steady-state render topology rather than text import.

| Stored scene | Pan p95 | Drag p95 | Active zoom p95 | Measured motion work |
| --- | ---: | ---: | ---: | --- |
| 1 element / 1,000 characters | 17.6 ms | 17.3 ms | 16.8 ms | About 1 cached bitmap/frame; 0 `fillText` |
| 1 element / 1,000,000-character single line | 16.8 ms | 17.4 ms | 17.7 ms | About 1 cached bitmap/frame; 0 `fillText` |
| 1 element / 1,000,000 characters / 10,000 lines | 17.2 ms | 17.6 ms | 17.6 ms | One 107 × 32,766 cache; 0 `fillText` during motion |
| 100 overlapping visible elements / 1,000,000 total characters | 17.0 ms | 17.7 ms | **50.0 ms** | About 100 blits/frame; repeated 51–58 ms long tasks during zoom |
| 1,000 vertically stacked elements / 1,000,000 total characters | 17.1 ms | 17.2 ms | 17.6 ms | About 18 visible blits; all 1,000 bounds scanned |

The short and one-million-character single-line scenes both produced an 820 × 45 cache because their visible geometry was the same. The 250,000-pixel-tall, 10,000-line element hit the height cap and produced a 107 × 32,766 cache. Already-cached elements made zero `fillText` calls during pan/drag. Two newly visible elements in the 1,000-element case were rasterized lazily. Visible caches regenerated once after zoom settled; one million-character single-line run recorded a 99 ms settle long task, but a repeat did not, so the exact duration is host-sensitive while the deferred-work mechanism is not.

The focused upstream clipboard/throttle tests passed 31/31, corroborating normal-paste line splitting and latest-arguments RAF behavior.

### Measurement interpretation and limits

- Steady-state text byte count inside **one cached element** was not the dominant motion cost.
- Visible surface cardinality and raster area still matter: 100 overlapping visible caches made continuous zoom miss a 60 Hz frame budget badly.
- Culling 1,000 element bounds was cheaper here than painting 100 overlapping caches, but the scan remains linear.
- Absolute values are not portable across browser, device, DPR, headless/headed mode, or scene geometry.
- The one-million-character single line retained all bytes but clipped them into an 800-pixel-wide visual box; it did not display one million simultaneously discernible glyphs.
- Canvas2D may be GPU-accelerated internally by a browser, but the upstream application does not force a particular GPU pipeline.
- This benchmark says nothing about native DOM Markdown layout, accessibility, selection, controls, or nested scrolling.

**Durable conclusion.** Excalidraw's win is retained rendering: after a cache exists, motion cost tracks the number/area of visible raster surfaces far more than their source text length. This establishes the value of retaining painted work, not the implementation Eido should copy. Eido's own A/B selected retained live DOM and rejected duplicate Card covers.

## What Excalidraw Does Not Prove

1. **It does not prove within-item virtualization.** One text element is rasterized as a whole.
2. **It does not prove rich DOM can move cheaply.** At-rest text is pixels; Markdown nodes, links, buttons, inputs, and nested scroll regions are not analogous.
3. **It does not solve Eido scroll retention.** Ordinary canvas text has no nested scroll. Its temporary WYSIWYG even resets `scrollTop` during style refresh ([source](https://github.com/excalidraw/excalidraw/blob/e160ff7ba0641fba729c528482de5277ffb19c58/packages/excalidraw/wysiwyg/textWysiwyg.tsx#L360-L424)).
4. **It is not unbounded.** Initial text layout/rasterization remains proportional to text, raster caches live on the main thread, and whole-element culling remains `O(n)`.
5. **Its cache is not an Eido-ready memory policy.** A `WeakMap` tied to live element identities has no explicit LRU or decoded-byte budget.
6. **Many small objects remain a different failure mode.** An upstream user report describes degradation with roughly 8,000+ visible objects and about 30 fps around 10,000–14,000 objects. This is field evidence, not a controlled benchmark, but it is consistent with per-element scan/blit overhead ([issue #8136](https://github.com/excalidraw/excalidraw/issues/8136)).
7. **Clipboard parity is not semantic parity.** Settled-object copy serializes scene records, and Copy text is a separate whole-element command; neither supplies native range selection or a general per-element AX representation for ordinary canvas content.

## Eido's Current Gap

**Repository observation.** Eido's semantic graph, incremental spatial index, pointer-cold scene, and bounded interaction overlays are already stronger primitives than Excalidraw's simple scene scan. The hot mismatch was not the mere presence of rich React/DOM Cards. It was allowing a per-frame zoom style to inherit through each rich subtree, plus letting node geometry and selection churn reach semantic Markdown/transcript renderers.

The initial Result-only optimization hid `.result-highlight-root` and `.transcript` with `opacity: 0` during node/camera motion (`src/styles/040-cards-prose.css`). `Board.tsx` toggles `data-viewport-motion` imperatively at the gesture boundary, which is a useful no-React-churn seam. The opacity behavior itself is rejected because it makes visible content disappear—the exact continuity failure reported by the user—and applies only to Result-like bodies.

The legacy, default-off #405 cached-passive experiment lineage has been removed
as part of the one-renderer closeout. Its DOM-to-raster snapshot, bounded cache,
capture runtime, alternate node type, adapter alias, candidate workflow, and
publication harness were experiment-only code; none remains build-selectable or
reachable from the Board.

The experiment was rejected as both a persistent substitute and a **gesture-only Card cover**. In the decisive Eido A/B, installing and retiring the duplicate surface introduced roughly 116–156 ms gesture-boundary stalls. The approach also requires a full subtree walk and style serialization, image decode/composition, duplicate-surface invalidation, and rules for transferring visual and interaction authority. Those costs exist even when the pixels themselves move cheaply.

After zoom opacity was moved to a standard, non-inherited value on each shallow `.eido-visual-card-node`, the fully live-DOM variant measured 16.8 ms pan p95 and 17.0 ms zoom p95, with a 33.4 ms maximum frame and no long tasks in the same decisive comparison. `contain: layout style` bounds each React Flow node, and semantic renderers are kept stable when only geometry or selection changes. The result keeps the browser's already-painted Card surface without an application-owned raster duplicate. The gesture-only capture/cache files were experiment artifacts and were removed rather than becoming architecture for this lane.

## Adopted Eido Architecture: Retained Live Card Surfaces

The durable contract is generic across **all Card types**:

1. **The native Card DOM is the sole visual, semantic, and interaction surface.** There is no motion-time image that can become stale or take authority from the Card.
2. **Motion changes only shallow properties.** Pan, zoom, and drag update the board transform and standard, non-inherited opacity on the shallow Card wrapper. Rich descendants do not inherit per-frame style changes.
3. **Semantic work follows semantic change.** Markdown, transcript, follow-up, media, and control subtrees rerender only when content or interaction state they consume changes, not because board position, camera zoom, or unrelated selection changed.
4. **DOM identity survives motion.** Native scroll, focus, selection, controls, accessibility relationships, and browser paint/compositor state remain attached to the same elements.
5. **There is no gesture-boundary capture or cover swap.** Gesture start and settle do not walk the Card tree, serialize styles, decode an image, or install/remove a duplicate surface.
6. **Visible content never becomes an optimization fallback.** The opacity-to-empty path remains rejected; content continuity is part of correctness.
7. **The seam belongs to the common Card shell/node.** Result is the pathological performance fixture, not a separate renderer. Notes, Ask AI, Conversation, image/media, and future Card types inherit the same shallow invalidation boundary.

The Excalidraw ideas that transfer are retained rendering, narrow invalidation, latest-input RAF coalescing, layer separation, and allowing the renderer to reuse already-painted work during transient zoom. In Eido, the browser's paint/compositor pipeline provides the retained surface; Eido does not manually rasterize each Card. Result-specific memoization may still remove pathological semantic work, but it is an implementation refinement within this shared architecture.

## Scroll Position Is Bounded Board-Scoped UI Memory

The user's “move the Card, then it snaps back to the top” report cannot be delegated to a raster cache.

**Repository observation and adopted direction.** Eido maintains a Board/Idea-scoped registry keyed by `(Idea id, Card id)`. It is a true least-recently-used map capped at 1,024 entries. Capturing a position and reading/restoring one both refresh recency; inserting entry 1,025 evicts the least-recently-used Card. This ordinary eviction is expected and correct—an evicted Card returns to its default position on a later remount.

Each retained entry stores:

- exact `scrollTop` and `scrollLeft`;
- scroll ratios for restoration across different representation geometry; and
- distance from the bottom for consumers that preserve bottom-pinned behavior.

Restoration rules:

1. The same native representation restores exact offsets, bounded to its current maximums, before paint.
2. A representation with different geometry can restore the stored relative ratios.
3. Consumers can use distance-from-bottom to preserve bottom-pinned streaming behavior without overriding a reader who moved away from the bottom.
4. Pan, drag, zoom, and selection do not clear the entry. Normal LRU pressure may evict it.

This is transient UI memory, not graph/Profile truth and not part of any raster-cache key.

## Rejected Approaches

| Approach | Decision | Reason |
| --- | --- | --- |
| Hide long text with `opacity: 0` during motion | Reject | Fast but visibly disruptive; violates continuity and fails the user's stated requirement. |
| Keep the opacity rule but add it to every Card | Reject | Generalizes the defect rather than the optimization. |
| Reimplement all Cards as Canvas2D | Reject | Loses rich Markdown layout, native selection/copy, controls, accessibility, nested scrolling, and established Card behavior. |
| Treat a cached image as a persistent passive Card | Reject | Reopens already-observed activation and semantic-authority failures. |
| Use a raster/image cover only during gestures | Reject | The decisive Eido A/B measured roughly 116–156 ms stalls while installing and retiring the cover; retained live DOM was faster and preserved one interaction surface. |
| Virtualize only Result transcript lines | Secondary experiment only | Can reduce settled DOM cost, but rich Markdown has variable heights/anchors and it does not solve motion for other Card types. |
| Capture the DOM synchronously when a gesture starts | Reject | Moves an unbounded serialization/style/raster cost onto the latency-critical frame and can still flash blank. |
| Capture the entire hidden height of a huge Card | Reject | Wasteful and potentially enormous; only a small internal scrollport is visible. |
| Make OffscreenCanvas/workers the primary explanation | Reject | Excalidraw's pinned scene renderer does not use them; cache reuse and layer separation are the proven mechanism. |
| Treat `will-change`, layer promotion, or `contain` as the decision by themselves | Reject | They are adjuncts. The selected mechanism is shallow non-inherited motion styling plus semantic render stability, verified against the pathological Card. |
| Port Excalidraw's `O(n)` culling | Reject | Eido already owns an incremental spatial index and should keep it. |

## Proof Required Before Calling It Buttery Smooth

The appropriate proof is one representative pathological Card and one mixed-board fixture, measured on the same browser/device profile before and after the change.

Record:

- pan, zoom, and Card-drag frame cadence (`p50`, `p95`, worst frame, dropped/long frames);
- gesture-start and gesture-end maximum frames and long tasks, so boundary stalls cannot hide behind a steady-state percentile;
- main-thread scripting, style recalculation, layout, paint, and compositing time;
- descendant style invalidation and React semantic-render/Markdown-parse counts during motion;
- confirmation that no Card capture, image decode, or cover-install work occurs at a gesture boundary;
- visual continuity—no one-frame disappearance, stale substitute, or surface swap;
- exact scroll retention after repeated pan, drag, zoom, selection, and any renderer remount; and
- interaction parity for focus, keyboard, links, text selection/copy, controls, editing, search/highlights, and accessibility.

The decisive A/B already supplies the mechanism baseline: live DOM reached 16.8 ms pan p95 and 17.0 ms zoom p95, with a 33.4 ms maximum frame and no long tasks, while the raster cover exposed 116–156 ms boundary stalls. Production acceptance now uses raw paired `AB` and `BA` control/stress runs: stress maximum is bounded by `max(control max + 2 cadence + 2, control max × 1.5)`, stress p95 stays within `max(control p95 + cadence + 2, control p95 × 1.35)`, missed frames add at most two per phase and four aggregate, long tasks do not increase, and completion stays within the control-relative bound. The old absolute host maximum is retired because a short-control outlier cannot establish a universal content penalty. Tests should assert shallow style isolation, semantic render stability, scroll-registry scope/LRU eviction, and visible continuity—not an image format or capture budget.

## What Changed From the 2026-07-14 Study

The earlier study's central observations survived the current-source comparison: viewport culling, per-element rasters, RoughJS caches, zoom-time reuse, giant-canvas caps, layer separation, RAF coalescing, and active-editor DOM promotion are still present.

This revision adds or corrects the points needed for the current bug:

- pins every primary-source claim to current upstream SHA `e160ff7`;
- makes explicit that the scene is fully cleared/redrawn and does not use dirty rectangles;
- makes explicit that no scene `OffscreenCanvas`, `ImageBitmap`, WebGL, or render-worker path is responsible;
- distinguishes whole-element culling from within-text virtualization;
- records normal paste's newline-to-elements behavior as a possible explanation for million-character demos;
- records position-only cache preservation and current camera/UI state isolation;
- separates Excalidraw's editing model from Eido's independent scroll-retention requirement;
- records both persistent and gesture-only raster Card covers as rejected by the decisive Eido A/B;
- selects retained live DOM through shallow non-inherited motion styles and semantic render stability;
- distinguishes model-backed canvas selection/clipboard from native text selection and confirms that ordinary scene content has no general per-element AX mirror;
- records scroll restoration as a 1,024-entry true LRU keyed by `(Idea id, Card id)`, with ordinary eviction allowed; and
- rejects opacity-to-empty as incompatible with visible continuity.

## Related Eido Decisions

- [ADR 0010 — Massive boards and history before user scale](../../docs/adr/0010-massive-boards-and-history-before-user-scale.md)
- [ADR 0019 — Viewport-derived detail bands](../../docs/adr/0019-viewport-derived-detail-bands.md)
- [ADR 0020 — Board-space shapes and screen-space labels](../../docs/adr/0020-board-space-shapes-screen-space-labels.md)
- [ADR 0023 — Buffered passive Cards and hover activation](../../docs/adr/0023-buffered-passive-cards-and-hover-activation.md)
- [ADR 0024 — Image renditions are derived and visibility-aware](../../docs/adr/0024-image-renditions-are-derived-and-visibility-aware.md)

This study does not authorize a wholesale Canvas renderer migration or a raster Card cover. It provides the source-grounded retained-rendering invariant and records Eido's measured live-DOM translation.
