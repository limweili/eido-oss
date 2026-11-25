# Card-Facade Reference Architecture Claim Audit

> Date: 2026-08-21
> tldraw snapshot: [`c2c2eba669bdb9fc2d5cb0a830665a55636132c2`](https://github.com/tldraw/tldraw/commit/c2c2eba669bdb9fc2d5cb0a830665a55636132c2), committed 2026-08-20
> Source policy: official product documentation, first-party engineering publications, and pinned official source code only
> Scope: factual comparison of tldraw, Miro, Notion, and Figma; no Eido renderer decision or production change

## Decision

The broad claim that **tldraw, Miro, Notion, and Figma all keep a lightweight inactive Card facade and mount the full representation only on activation is false**.

The products expose four different boundaries that should not be treated as one technique:

1. **Paint culling:** stop painting an offscreen object while retaining its implementation.
2. **Edit overlay:** show a passive representation, then create a rich editor only while editing.
3. **Summary/detail navigation:** show a Card-sized projection whose click opens the full record elsewhere.
4. **Runtime suspension:** retain native scene output and state while running custom code or heavyweight UI only during interaction.

Only Miro's published text/code-widget architecture directly documents a canvas view replaced in place by an HTML editor on activation. tldraw has a narrower static-HTML-to-TipTap editing seam, but its full passive text DOM remains mounted. Notion verifies summary Cards that open full pages, not a rendering optimization. Figma's ordinary canvas objects use a custom scene renderer rather than passive DOM Cards; Figma Widgets provide a qualified runtime-suspension analogy.

| Product | What is directly verified | What is not verified | Verdict on the broad claim |
| --- | --- | --- | --- |
| tldraw | Whole-page React/SVG/HTML shape residency; exact-viewport `display: none` culling; one camera transform; passive HTML text plus edit-only TipTap | Generic snapshot, raster, line-windowing, or whole-Card activation facade | **False for shapes; true only at the rich-text editor seam** |
| Miro | Canvas-rendered text hidden under an edit-only positioned HTML editor; compact/detail Card contracts; historical object-specific LOD | Current universal implementation for every object; current culling, cache, residency, or snapshot policy | **Strong narrow precedent, not a universal current claim** |
| Notion | A database Card is a projection of a full page and opens it in peek/full-page modes | Whether page/Card DOM is absent, premounted, virtualized, cached, or recreated on activation | **True as product navigation; unsupported as renderer architecture** |
| Figma | Retained scenegraph and custom GPU renderer; separate accessibility Mirror DOM; Widget code/iframe UI activated on demand | Ordinary-object bitmap/DOM swaps, text editor overlay mechanics, object culling/cache policy | **False for ordinary objects; qualified runtime precedent for Widgets** |

## Terms Used in This Audit

This study uses **facade** only when one representation stands in for a richer representation across an explicit boundary. It distinguishes:

- **Visual facade:** a cheaper visible representation replaces a more expensive visible one.
- **Interaction facade:** the same visible object remains, but expensive controls or execution are unavailable until activation.
- **Semantic projection:** a subset of a richer record is displayed as a Card and opens that record elsewhere.
- **Culling:** a rendering/residency decision based on visibility; culling alone is not activation.

An object that is merely selected, culled, hidden, or moved by a shared transform has not thereby crossed a facade boundary.

## tldraw: Retained DOM With an Edit-Only Seam

All tldraw facts below are pinned to official source commit [`c2c2eba669bdb9fc2d5cb0a830665a55636132c2`](https://github.com/tldraw/tldraw/commit/c2c2eba669bdb9fc2d5cb0a830665a55636132c2).

### Rendering and DOM residency

**Fact.** tldraw is DOM/SVG-first for shapes, not a Canvas2D scene renderer. `ShapesLayer` maps `editor.getRenderingShapes()` to React `Shape` components; a separate `<canvas>` handles overlays and debug geometry ([shape layer](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/components/default-components/DefaultCanvas.tsx#L190-L210), [overlay canvas](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/components/default-components/CanvasOverlays.tsx#L18-L85)).

**Fact.** The render list walks every non-hidden shape on the current page, not only viewport-intersecting shapes. The flat, stable list is explicitly designed to preserve DOM nodes across reparenting and avoid iframe reloads ([render-list construction](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/editor/Editor.ts#L4644-L4732), [stable ordering](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/editor/Editor.ts#L4786-L4835)).

**Fact.** This is retained implementation, not a passive snapshot. tldraw even exposes a stable app-owned element contract whose element is not recreated or relocated by culling, reparenting, or ordinary rerenders ([contract](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/editor/shapes/ShapeUtil.ts#L1010-L1049), [implementation](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/components/Shape.tsx#L164-L231)).

### Object culling and motion

**Fact.** A per-page RBush spatial index supplies viewport-intersection candidates ([index manager](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/editor/managers/SpatialIndexManager/SpatialIndexManager.ts#L16-L36), [RBush query](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/editor/managers/SpatialIndexManager/RBushIndex.ts#L22-L47)). The culling derivation uses the exact viewport AABB and builds the offscreen complement from all current-page IDs; a shape can opt out with `canCull=false` ([derivation](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/editor/derivations/notVisibleShapes.ts#L12-L70)). Selected and actively edited shapes are excluded from the culled set ([exceptions](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/editor/Editor.ts#L5742-L5787)).

**Fact.** Culling does not unmount or replace a shape. A central ref registry switches the real wrapper between `display: none` and `display: block` ([culling hook](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/hooks/useShapeCulling.tsx#L29-L86), [official in-repo documentation](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/apps/docs/content/sdk-features/culling.mdx#L20-L26)).

**Fact.** Camera motion imperatively updates one CSS transform on the shared HTML layer ([camera effect](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/components/default-components/DefaultCanvas.tsx#L95-L101), [transform calculation](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/utils/getHtmlLayerTransform.ts#L5-L21)). Shape placement is also written directly to wrapper styles, while the expensive inner JSX is memoized on shape `props` and `meta`; x/y-only changes therefore do not rerender the content ([memo boundary](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/components/Shape.tsx#L16-L26), [imperative geometry](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/components/Shape.tsx#L65-L106), [content equality](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/utils/areShapesContentEqual.ts#L3-L10)).

**Fact.** On pages above 500 shapes by default, tldraw freezes zoom-dependent detail at the gesture-start level during camera motion and catches up after the camera's 64 ms idle timeout ([efficient zoom](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/editor/Editor.ts#L3210-L3254), [motion state](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/editor/Editor.ts#L4742-L4759), [defaults](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/options.ts#L315-L342)). A transparent full-canvas hit-test blocker covers the canvas during camera motion; it changes interaction, not visuals ([component](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/components/default-components/DefaultCanvas.tsx#L341-L351), [CSS](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/editor.css#L1565-L1578)).

### Text rendering and editing

**Fact.** Passive rich text is complete HTML generated from the whole rich-text document and inserted with `dangerouslySetInnerHTML`; it is not line-windowed, canvas text, or a raster ([static conversion](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/tldraw/src/lib/shapes/shared/RichTextLabel.tsx#L73-L84), [passive label](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/tldraw/src/lib/shapes/shared/RichTextLabel.tsx#L126-L203)). Plain text similarly creates one `<div>` per hard line ([plain label](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/tldraw/src/lib/shapes/shared/PlainTextLabel.tsx#L116-L139)).

**Fact.** There is a genuine edit overlay seam. CSS hides the passive rich text while `RichTextArea` creates a TipTap/ProseMirror editor only when `isEditing`; the component returns `null` at rest and destroys the editor on cleanup ([visibility switch](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/editor.css#L537-L543), [editor lifecycle](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/tldraw/src/lib/shapes/text/RichTextArea.tsx#L119-L234), [inactive return](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/tldraw/src/lib/shapes/text/RichTextArea.tsx#L236-L258)).

**Inference.** This saves editor machinery at rest, but not the cost of displaying a huge passive text shape: the complete passive HTML remains mounted. It is therefore an editor facade, not evidence that tldraw makes a million-character live-DOM Card cheap during motion.

### Selection, clipboard, and accessibility

**Fact.** Passive canvas content is not ordinary selectable document text. The editor container applies `user-select: none`, restoring native selection for inputs and editable surfaces; passive rich text is `aria-hidden`, changing state during edit ([selection CSS](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/editor.css#L279-L308), [rich-text accessibility state](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/tldraw/src/lib/shapes/shared/RichTextLabel.tsx#L126-L140)).

**Fact.** Shape copy is model-driven: tldraw serializes selected shape records/assets into its HTML payload and derives `text/plain` through shape utilities. While editing, clipboard interception yields to native browser behavior ([serialization](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/tldraw/src/lib/ui/hooks/useClipboardEvents.ts#L702-L778), [edit-mode exception](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/tldraw/src/lib/ui/hooks/useClipboardEvents.ts#L863-L908)).

**Fact.** The editor root is `role="application"`; a separate live region announces selection from shape model text/ARIA descriptors and reading order ([root role](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/TldrawEditor.tsx#L340-L349), [live region](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/tldraw/src/lib/ui/components/A11y.tsx#L59-L135)).

**Limit.** tldraw's default page cap is 4,000 shapes ([option](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/options.ts#L289-L293), [creation enforcement](https://github.com/tldraw/tldraw/blob/c2c2eba669bdb9fc2d5cb0a830665a55636132c2/packages/editor/src/lib/editor/Editor.ts#L8498-L8551)). Its passive text renderer contains no internal line/paragraph virtualization in the reviewed path.

### tldraw verdict

tldraw is strong evidence for stable DOM identity, exact-viewport paint culling, one imperative camera transform, memoized inner content, motion-time detail freezing, and edit-only rich editor machinery. It is evidence **against** the claim that a generic passive raster or lightweight whole-shape facade explains its canvas performance.

## Miro: A Direct Canvas-to-Editor Handoff, Narrowly Proven

Miro is proprietary, so the detailed implementation evidence is first-party Miro Engineering reporting from 2021–2024 plus current official product/developer documentation. Historical implementation facts are not treated as guarantees about the 2026 renderer.

### Canvas rendering and editor activation

**Fact, 2023 first-party engineering report.** Miro described its boards as heavily Canvas-based: almost everything visible on the board, excluding overlaid UI, was a continuously updated image. Its renderer consumed styled HTML and drew text through Canvas2D. Double-clicking a text widget hid the canvas-rendered text and placed an HTML editor containing the same content at the same location; finishing returned the HTML output to the canvas renderer ([Miro Engineering, “Why we developed a code block widget”](https://medium.com/miro-engineering/why-we-developed-a-code-block-widget-in-miro-f6c5ec23085c)).

**Fact, 2023 follow-up.** For the code widget, no editor existed when the click reached the canvas. Miro loaded and positioned the editor over the widget, mapped click coordinates to a caret position, and kept the editor only for the editing interaction. During resize, it temporarily used simplified wrapping and indentation without syntax highlighting so readable geometry remained while expensive decoration was omitted ([Miro Engineering, “How we integrated a code editor”](https://medium.com/miro-engineering/how-we-integrated-a-code-editor-on-the-miro-canvas-a41e0eff7f21)).

**Fact, 2024 first-party report.** Miro measured entry into edit mode and return to the canvas representation for the code widget. It reported that 80% of observed code blocks contained fewer than 1,000 characters and that edit entry for those blocks remained under 200 ms; other tested cases remained under one second ([Miro Engineering research report](https://medium.com/miro-engineering/the-miro-code-block-widget-an-approach-backed-by-research-684ad5d2a1cd)). These are historical product measurements, not current Eido targets or Miro guarantees.

**Inference.** This is the closest direct precedent in the comparison: readable passive pixels remain until the user requests an editor, the editor is mounted only for the active object, and the passive renderer resumes afterward. The resize treatment also demonstrates a fidelity ladder that removes expensive decoration without blanking the object's readable content.

### Object LOD, Cards, and current limits

**Fact, historical and object-specific.** Miro's 2021 pen-widget renderer used raster level-of-detail images at selected zoom levels. Disabling LOD harmed FPS; the project later replaced those raster LODs with a simplified vector LOD and changed curve storage to reduce memory ([Miro Engineering, “Fighting for bytes in the frontend”](https://medium.com/miro-engineering/fighting-for-bytes-in-the-frontend-419c48103ef8)). This is evidence of LOD for pen strokes, not bitmap snapshots for every Card.

**Fact, current product contracts.** A native Miro Card has a compact board view and a detail view in which all fields can be viewed and edited ([Card developer documentation](https://developers.miro.com/docs/card-1)). App Cards expose preview fields that may be a subset of detailed fields, and a control opens a detailed modal that may contain app-hosted iframe UI ([App Card documentation](https://developers.miro.com/docs/app-card)). Miro help says Card descriptions appear after expansion and title plus description is limited to 20,000 symbols ([Cards help](https://help.miro.com/hc/en-us/articles/360020911193-Cards)).

**Fact, current content limits.** Regular Miro text objects are limited to 6,000 symbols; over-limit pasted text becomes a Miro Doc. Sticky notes are limited to about 3,000 symbols ([Text help](https://help.miro.com/hc/en-us/articles/360017572094-Text), [Sticky Notes help](https://help.miro.com/hc/en-us/articles/360017572054-Sticky-notes)). A million-character single-object demonstration is therefore not comparable to a regular Miro text or Card object.

**Unknown.** Public Miro sources do not disclose the current whole-board culling algorithm, spatial index, overscan, dirty-region policy, per-object cache invalidation, cache eviction, worker/offscreen rendering, or offscreen DOM/object residency. The Card preview/detail contract does not establish whether detail DOM is precreated or mounted on demand.

### Selection, clipboard, and accessibility

**Fact.** Miro supplies object-level copy commands that copy content as text or the visual result as PNG; this is not evidence of native DOM range selection over passive canvas text ([Copy as text or image](https://help.miro.com/hc/en-us/articles/4413451973266-Copy-as-text-or-as-an-image)).

**Fact.** Miro exposes a screen-reader-oriented board overview/table of contents. Users navigate to objects, focus them, press Enter to edit, and return to the overview with Escape ([Assistive technology help](https://help.miro.com/hc/en-us/articles/4403828752274-How-to-access-Miro-boards-with-assistive-technologies)). These semantics are supplied separately from the canvas pixels.

### Miro verdict

Miro verifies a real passive-canvas-to-active-DOM edit facade for text/code widgets and verifies compact/detail Card products. It does not verify that every current Miro object uses a cached facade, that the same machinery handles million-character objects, or that Miro preserves native browser selection/accessibility through pixels alone.

## Notion: A Product Projection, Not a Verified Renderer Facade

### Card projection and page activation

**Fact.** Every Notion database row or board/gallery Card is a complete Notion page. Clicking it opens that page in a peek and it can be expanded to full-page mode ([Introduction to databases](https://www.notion.com/help/intro-to-databases)). Gallery Cards may preview the page cover, a media property, the first page-content block, or no preview; visible properties are configured separately ([Gallery view](https://www.notion.com/help/galleries)). Database pages may open in side peek, center peek, or full page; side peek leaves the database view available beside the page ([Views, filters and sorts](https://www.notion.com/help/views-filters-and-sorts)).

**Inference.** This is a genuine semantic projection: the Card intentionally displays a subset of a richer page. It proves a product-level summary/detail boundary, not a paint-time optimization.

### Rendering, residency, and virtualization

**Fact, historical architecture.** Notion's 2021 data-model account describes records being loaded into memory, page content being laid out, and the page being rendered with React. Toggle children render when expanded and page children render after navigation into that page ([The data model behind Notion](https://www.notion.com/blog/data-model-behind-notion)).

**Fact, narrowly scoped example.** Notion documents viewport-plus-overscan virtualization for its custom-emoji picker ([How we built custom emoji](https://www.notion.com/blog/how-we-built-custom-emoji)). That component does not establish virtualization for database Cards or ordinary page blocks.

**Fact.** Current performance guidance says databases with more pages, properties, and views can be slower; multiple visible inline databases add load, and one open linked-database view improves performance because only that view listens for updates ([Optimize database performance](https://www.notion.com/help/optimize-database-load-times-and-performance)).

**Unknown.** No reviewed official source establishes whether unopened page DOM is absent, preloaded, premounted offscreen, cached, reused across peeks, or discarded on close. No reviewed official source documents Card/row virtualization, ordinary page-block virtualization, object culling, snapshots, or gesture-time rendering for Notion boards. Notion's board view is also a database view, not evidence about an infinite pan/zoom scene.

### Text editing, selection, clipboard, and accessibility

**Fact.** Notion supports whole-block and multi-block selection, partial text selection across block boundaries, and cut/copy/paste of that partial text. Escape moves from editing to block selection; Enter edits a selected text block or opens a nested page ([Writing and editing basics](https://www.notion.com/help/writing-and-editing-basics), [Keyboard shortcuts](https://www.notion.com/help/keyboard-shortcuts)).

**Unknown.** Official sources reviewed here do not disclose whether current Notion text uses `contenteditable`, textareas, another DOM editor, or an edit overlay. Notion's Trust Center lists an Accessibility Conformance Report, but its content requires a request; no public first-party implementation account established its Card DOM/ARIA residency strategy ([Notion Trust Center](https://trust.notion.com/)).

### Notion verdict

Notion is a strong reference for designing a compact projection of richer page state. It is not public evidence for the technical claim that inactive Cards are lightweight render facades whose full DOM is mounted only on activation.

## Figma: One Scene Renderer, Plus a Qualified Widget Runtime Seam

### Ordinary canvas rendering

**Fact.** Figma's authoritative document structure is a retained scenegraph: a tree of layer nodes ([Behind the feature: autosave](https://www.figma.com/blog/behind-the-feature-autosave/)). Figma historically described its renderer as a highly optimized, tile-based WebGL engine with its own compositor and text layout ([Building a professional design tool on the web](https://www.figma.com/blog/building-a-professional-design-tool-on-the-web/)). Its current published architecture uses a C++ renderer compiled to Wasm, WebGPU with a WebGL fallback, shader-based rendering, batched draw submission/render passes, and cached/reused WebGPU bind groups ([Figma rendering powered by WebGPU](https://www.figma.com/blog/figma-rendering-powered-by-webgpu/), [gaming-world architecture](https://www.figma.com/blog/how-figma-draws-inspiration-from-the-gaming-world/)).

**Fact.** Figma has documented time-slicing that prioritizes local edits over remote-user rendering changes ([Keeping Figma fast](https://www.figma.com/blog/keeping-figma-fast/)). That is work scheduling, not an activation-time facade.

**Fact.** Comment pins are live React/HTML overlays. Figma improved their pan performance by removing high-frequency viewport updates from Redux and translating one parent overlay instead of recomputing/translating each pin ([React at 60fps](https://www.figma.com/blog/improving-scrolling-comments-in-figma/)). This is an O(1) motion update, not a visual-representation swap.

**Unknown.** Public sources reviewed here do not disclose the ordinary canvas's object/frustum or occlusion-culling algorithm, spatial-index implementation, current tile selection/cache policy, line virtualization, per-object snapshots, gesture capture, dirty regions, zoom LOD, scene-render worker/`OffscreenCanvas`, or text-editor overlay mechanics. Figma's documented Layers-panel windowing applies to that list UI, not the design canvas ([Layers-panel performance](https://www.figma.com/blog/improving-performance-in-the-layers-panel/)).

### Text, selection, clipboard, and accessibility

**Fact.** Figma's help documentation describes custom text rendering and an edit mode entered by double-click or Enter, but not the implementation of the caret/editor surface ([Guide to text](https://help.figma.com/hc/en-us/articles/360039956434-Guide-to-text-in-Figma-Design)). A textarea, `contenteditable` overlay, or suppression of separately rendered text cannot be inferred from that behavior.

**Fact.** Current Figma canvas visuals are not traditional HTML/DOM. Figma reports that the canvas ordinarily has one focus-holding `<input>` and separately derives an internal accessibility tree for every layer. A visually hidden React **Mirror DOM** is incrementally updated from that tree, and Mirror DOM focus synchronizes bidirectionally with canvas selection ([Building accessibility into a canvas-based product](https://www.figma.com/blog/building-accessibility-into-a-canvas-based-product/)). The Mirror DOM is a semantic/accessibility representation, not the visible inactive object.

**Fact.** Users select scene objects/layers and copy/paste those objects through Figma commands ([Select layers and objects](https://help.figma.com/hc/en-us/articles/360040449873-Select-layers-and-objects), [Copy and paste objects](https://help.figma.com/hc/en-us/articles/4409078832791-Copy-and-paste-objects)). These behaviors do not reveal the current clipboard serialization or visual DOM residency.

### The qualified Figma Widgets precedent

**Fact.** A Figma Widget's visible output is composed from Figma-native layer-like components such as `Frame`, `Text`, `Image`, and `SVG`, derived synchronously from serialized synced state ([Widget API reference](https://developers.figma.com/docs/widgets/api/api-reference/), [Prototyping Widget UI](https://developers.figma.com/docs/widgets/prototyping-widget-ui/)).

**Fact.** Widget custom code runs in response to user interaction on the initiating client. Many Widgets may sit on the canvas, but only one Widget may run for a user at a time; a click handler normally terminates after it completes ([How Widgets run](https://developers.figma.com/docs/widgets/how-widgets-run/), [Working with Widgets](https://developers.figma.com/docs/widgets/working-with-widgets/), [Handling user events](https://developers.figma.com/docs/widgets/handling-user-events/)). Complex HTML UI may be opened temporarily as a separate modal iframe with `showUI()`; it does not replace the on-canvas object in place ([`showUI()`](https://developers.figma.com/docs/plugins/api/properties/figma-showui/), [Widgets versus plugins](https://developers.figma.com/docs/widgets/widgets-vs-plugins/)).

**Inference.** Widgets demonstrate retained native scene output and synced state with heavyweight custom execution or iframe UI activated on demand. This is a runtime/interaction seam, not evidence that Figma converts ordinary inactive objects to bitmaps or mounts their full DOM on click.

### Figma verdict

Figma is evidence for separating semantic state, visual rendering, accessibility semantics, and optional active runtime. It is not evidence for the claimed ordinary-object inactive-card/full-DOM swap.

## Cross-Product Fact Matrix

| Concern | tldraw | Miro | Notion | Figma |
| --- | --- | --- | --- | --- |
| At-rest visual | Full React/SVG/HTML shape DOM | Canvas pixels for the documented text/code-widget path | Database Card projection | Custom GPU scene rendering; Widgets become native scene layers |
| Offscreen culling | Exact viewport via RBush; wrapper `display: none`; DOM retained | Current algorithm/residency undisclosed | Undisclosed for Cards/pages | Ordinary-canvas algorithm undisclosed |
| Pan/zoom motion | One HTML-layer transform; memoized shape content; efficient zoom freezes detail | Current universal mechanism undisclosed; object-specific historical LOD | Not an infinite-canvas precedent | Custom renderer; one-parent transform for HTML comment pins |
| Passive text | Complete HTML document/lines | Canvas2D in documented path | Current implementation undisclosed | Custom rendering; implementation details undisclosed |
| Active editor | TipTap created only for active rich text | Positioned HTML editor created only for active text/code widget | Behavior documented; implementation undisclosed | Behavior documented; ordinary editor surface undisclosed |
| Native text selection at rest | Disabled; model selection/copy instead | Canvas path requires explicit object commands | Cross-block text selection supported | Scene selection plus separate input/semantic machinery |
| Clipboard | Model records/assets plus derived plain text; native during edit | Explicit object copy-as-text/image | Native-feeling partial text and block commands | Object/layer commands; current encoding undisclosed |
| Accessibility | `role=application`, model-derived live region; passive text hidden from AX | Separate board overview/object navigation | Public implementation details not established | Incremental accessibility tree plus hidden Mirror DOM |
| Closest real facade | Static HTML to TipTap editor | Canvas text to DOM editor; compact/detail Card | Card summary to page/peek | Widget native scene output to active runtime/optional iframe |

## Claims This Evidence Rejects

The following statements should not appear in Eido architecture rationale as established facts:

- “tldraw rasterizes inactive shapes or huge text and restores their DOM on click.”
- “tldraw unmounts offscreen shapes.”
- “Miro uses bitmap snapshots for every current Card or supports million-character regular text objects.”
- “Notion virtualizes or unmounts database Card/page DOM until the Card opens.”
- “Figma replaces ordinary inactive objects with lightweight bitmaps and mounts full DOM on activation.”
- “Figma's Layers-panel windowing proves canvas-object virtualization.”
- “Canvas pixels preserve browser text selection, links, clipboard behavior, search, focus, and accessibility without a separate semantic system.”

## Defensible Reference Claims

The source-backed statements are narrower:

1. **tldraw:** retains full shape DOM, hides offscreen wrappers, transforms one camera layer, memoizes shape content, and creates its rich editor only while editing.
2. **Miro:** has published a direct canvas-text-to-positioned-HTML-editor handoff and a readable, reduced-detail resize state for code widgets; current Cards also have compact/detail product contracts.
3. **Notion:** database Cards are configurable projections of full pages that open in peek/full-page views; public sources do not explain renderer residency.
4. **Figma:** ordinary visuals come from a custom scene renderer; accessibility uses a separate incremental semantic mirror; Widgets persist native scene output while custom code or optional iframe UI is activated on interaction.

These facts support separating **semantic truth**, **settled visual representation**, **active editor/runtime**, and **accessibility/clipboard behavior**. They do not, by themselves, select Eido's implementation. Eido's own measured evidence and product invariants remain authoritative for that decision.

## Relationship to Existing Eido Research

- [12 Excalidraw Rendering Performance Study](12-excalidraw-rendering-performance-study.md) is the pinned source and benchmark study for Excalidraw's Canvas2D raster-cache architecture and current Eido implications.
- [13 tldraw Rendering-Continuity Study](13-tldraw-rendering-performance-study.md) remains the deeper donor study for tldraw's retained-DOM continuity behavior. This document refreshes the source pin and uses tldraw only in the cross-vendor claim audit.
- [19 Reading-band Architecture Selection](19-reading-band-architecture-selection.md) records Eido's selected Reading architecture; vendor analogy does not supersede Eido's own selection evidence.
