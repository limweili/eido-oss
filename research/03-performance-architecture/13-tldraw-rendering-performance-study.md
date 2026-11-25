# tldraw Rendering-Continuity Study

> Date: 2026-07-14
> Donor snapshot: `research/repos/tldraw` at `846e39a811fbaa43199d1e7e9a424413225a9f80`
> Source policy: first-party source code and tests from the pinned donor snapshot only
> Question: what does tldraw actually do during very fast pan/zoom, and which parts should Eido adopt to remain visually continuous without keeping every rich card live?

## TL;DR

tldraw's answer is simpler—and more memory-hungry—than a tiled canvas or snapshot renderer:

1. **Every shape on the page remains mounted in the DOM.** A culled shape is not unmounted or replaced with a cached image; its containers are set to `display: none`.
2. **Culling uses the exact viewport.** There is no viewport overscan, velocity look-ahead, or predictive preload in the culling path.
3. **Camera movement is a single CSS transform on the shared shape layer.** The transform and culling visibility changes run through immediate, unthrottled reactive effects, so both can complete before the browser paints a camera update.
4. **Large boards freeze zoom-dependent rendering decisions while the camera moves.** The real layer still scales continuously, but expensive detail, style, and asset-resolution decisions can keep using the zoom captured at gesture start and refresh after the camera has been idle for 64 ms.
5. **Interaction is deliberately suspended during motion.** A full-viewport hit-test blocker covers the canvas until the camera returns to idle. Selected and actively edited shapes are exempt from culling.
6. **Rich text has a real passive-to-active boundary.** Passive text is static HTML. Only the actively edited shape creates a TipTap editor; the static copy is hidden while the editor is active. This is the closest tldraw analogue to Eido's Card activation.
7. **Media upgrades are visibility-aware, not proactively prefetched.** A culled image/video keeps its previously resolved URL but does not resolve a new one. A first-time offscreen asset can therefore lack a ready visual when it first crosses the exact viewport edge.
8. **There is no general staged/priority renderer or passive bitmap cache.** tldraw relies on resident DOM, synchronous visibility toggles, memoized shape internals, and the browser compositor.

This means tldraw does **not** itself satisfy the founder's complete Eido contract. It normally feels continuous because hidden shapes are already constructed, but it has no static visual bridge if the culling work misses a frame, no preload band, and no full-fidelity fallback beyond the viewport. Copying it literally would preserve Eido's current whole-board rich-DOM cost.

The transferable design is a **native-DOM residency path**:

- retain Eido's board-wide lightweight canvas representation as a never-blank safety net;
- keep a generous, hysteretic preload band around the viewport (Eido already uses a 1,800-screen-pixel Reading query margin when it windows);
- keep complete native Card DOM for the bounded resident window and compose additive Live owners above it;
- move the camera and Card geometry through shallow transforms while semantic descendants stay stable; and
- activate hovered/focused/selected/editing Cards in that same native surface, pinning them until interaction ownership ends.

Cached passive/raster Cards were investigated historically and rejected: they
transfer visual and interaction authority, lose native semantics before
activation, and add capture/eviction complexity without an accepted motion win.

The current Reading/Overview/Map appearances, thresholds, crossfades, hit-equals-paint contract, and pointer-cold scene remain fixed. The architectural decision still to prove is **how passive Reading cards are rendered and budgeted**, not whether to change Eido's LOD design.

## The Founder Contract Used for This Study

The recommendations below treat these as fixed product requirements:

- Zoomed-out appearance and the current Eido LOD bands do not change.
- A fast pan or zoom must not expose blank holes or obvious card-edge clipping.
- The board should feel already loaded during motion; a temporarily non-interactive static representation is acceptable.
- Eido should preload beyond the viewport boundary.
- A rare jump to an unprepared distant region may briefly show the lightweight Board representation while detail loads.
- Hover, keyboard focus, and programmatic focus should begin Card activation before click so the first intended interaction normally reaches a Live Card.
- Once a user activates a card, its internal content must be fully navigable and interactive.
- Search, copying, and accessibility regressions are risks to record, not performance levers to spend unless the measured alternatives are insufficient.
- Stationary cards must finish crisp, correctly sized, and interactive, with no focus, selection, caret, or card-scroll loss.

## What tldraw Actually Does

### 1. It retains every shape DOM subtree and culls with `display: none`

`getRenderingShapes()` walks every shape on the current page. `ShapesLayer` maps the entire result to React `Shape` components. The shape-culling context keeps a registry of both foreground and background containers and changes only their CSS `display` value between `block` and `none`.

The source explicitly documents the policy: culled shapes are “still rendered to the DOM,” with `display` set to `none`.

Sources:

- `packages/editor/src/lib/editor/Editor.ts:4607-4694` — all current-page shapes enter the rendering list.
- `packages/editor/src/lib/components/default-components/DefaultCanvas.tsx:203-223` — the full list maps to `Shape` components.
- `packages/editor/src/lib/editor/shapes/ShapeUtil.ts:365-374` — culling contract and default `canCull()` behavior.
- `packages/editor/src/lib/components/Shape.tsx:121-158` — shape containers register with central culling while their inner JSX remains mounted.
- `packages/editor/src/lib/hooks/useShapeCulling.tsx:36-75` — initial and subsequent `display: none` / `display: block` toggles.

**User-visible implication:** re-entry normally does not wait for React to rebuild the shape or for an iframe to remount. The browser only needs to expose a subtree that already exists. This is tldraw's main anti-pop-in trick.

**Cost implication:** DOM nodes, static rich text, iframes, videos, component state, and other per-shape memory remain resident for the whole page. Culling saves layout/paint for hidden subtrees; it does not save their construction or most of their retained memory.

### 2. Culling is exact-viewport, not overscanned or predictive

The non-visible derivation takes `getViewportPageBounds()` directly and asks the spatial index which shape bounds intersect it. The viewport box is exactly `(-camera.x, -camera.y, screenWidth / zoom, screenHeight / zoom)`. The RBush query returns intersections with that box. No expansion, velocity vector, direction bias, or secondary preload bounds appears in this path.

Sources:

- `packages/editor/src/lib/editor/derivations/notVisibleShapes.ts:6-20` — direct exact-viewport visibility query.
- `packages/editor/src/lib/editor/Editor.ts:4224-4233` — exact page-space viewport construction.
- `packages/editor/src/lib/editor/managers/SpatialIndexManager/SpatialIndexManager.ts:197-215` — viewport-oriented spatial query.
- `packages/editor/src/lib/editor/managers/SpatialIndexManager/RBushIndex.ts:35-47` — bounds-intersection search.

**Correction:** tldraw does not “preload slightly beyond the viewport.” It avoids most entry stalls by retaining all shape DOM, not by rendering an approach zone.

**Edge behavior:** an ordinary shape becomes `display: block` when its bounds first intersect the viewport. If synchronous work keeps up, this occurs before the next paint and looks seamless. If the main thread stalls, there is no overscanned visual already waiting outside the edge.

### 3. Culled shapes visually disappear; there is no static snapshot underneath

The culling controller sets both shape containers to `display: none`. It does not rasterize them, keep a thumbnail visible, or place a cached canvas tile below them. The outer canvas clips overflow at the viewport edge.

Sources:

- `packages/editor/src/lib/hooks/useShapeCulling.tsx:39-55` — initial `display` state.
- `packages/editor/src/lib/hooks/useShapeCulling.tsx:63-74` — culling updates.
- `packages/editor/editor.css:297-308` — canvas viewport uses `overflow: clip` and strict containment.

**Correction:** “tldraw keeps a static render of offscreen shapes” is false for this snapshot. The hidden DOM subtree is a *warm implementation object*, not a visible cached representation.

### 4. Camera motion is one shared layer transform plus immediate culling

The camera reactor imperatively sets a single `scale(...) translate(...)` transform on the shared HTML shape layer. Shape-local geometry and positioning are separately memoized/reactive, so camera movement does not require React to reposition every shape. `useQuickReactor` is explicitly unthrottled and executes effects synchronously whenever captured signals change. The central culling controller also uses it.

Sources:

- `packages/editor/src/lib/components/default-components/DefaultCanvas.tsx:94-114` — shared-layer camera transform.
- `packages/editor/src/lib/components/Shape.tsx:63-104` — independent, imperative shape transform/size updates.
- `packages/state-react/src/lib/useQuickReactor.ts:4-10,44-53` — immediate, unthrottled effect contract.
- `packages/state/src/lib/EffectScheduler.ts:91-117` — no custom scheduler means execute immediately.
- `packages/editor/src/lib/components/default-components/DefaultCanvas.tsx:246-263` — central immediate culling reactor.

Wheel and pointer-pan events update the camera immediately. A continuous animation-frame tick drives inertial/animated work and the moving-to-idle timeout, but ordinary camera writes are not themselves deferred into a staged renderer.

Sources:

- `packages/editor/src/lib/editor/Editor.ts:3500-3538` — camera commit and camera-state tick.
- `packages/editor/src/lib/editor/Editor.ts:11119-11163` — immediate wheel zoom/pan camera writes.
- `packages/editor/src/lib/editor/Editor.ts:11282-11293` — immediate pointer-pan camera writes.
- `packages/editor/src/lib/editor/managers/TickManager/TickManager.ts:26-47` — animation-frame tick loop.

**User-visible implication:** the already-painted layer moves as one compositor-friendly surface. Culling changes can run in the same state propagation before paint. If work does fall behind, the likely failure is a held/stuttering frame or a just-entered blank area—not a separately animated loading state.

### 5. Zoom-dependent quality decisions freeze during motion on large pages

tldraw distinguishes the physical camera zoom from an “efficient” zoom used by expensive component decisions. Above 500 shapes, the efficient zoom stays at the value captured when the camera began moving. It returns to the real zoom after the camera has been idle for the configured 64 ms. Consumers use this value for text outlines, freehand/detail choices, patterns, media resolution/controls, notes, frames, arrows, and other zoom-sensitive work.

Sources:

- `packages/editor/src/lib/editor/Editor.ts:3142-3185` — debounced and efficient zoom semantics.
- `packages/editor/src/lib/options.ts:142-151,337-340` — enabled by default above 500 shapes.
- `packages/editor/src/lib/editor/Editor.ts:4704-4722` — moving state and settle timeout.
- `packages/editor/src/lib/options.ts:311-315` — 64 ms default camera-moving timeout.
- `packages/editor/src/lib/components/default-components/DefaultCanvas.tsx:66-92` — text-outline LOD uses efficient zoom.
- `packages/tldraw/src/lib/shapes/shared/useImageOrVideoAsset.ts:110-115` — asset resolution uses efficient zoom.

**User-visible implication:** geometry scales continuously because the shared layer uses the real camera zoom, while some details can remain at their gesture-start choice and update after settle. This is a deliberate “reuse now, sharpen/re-evaluate later” strategy, although it is DOM/CSS reuse rather than an element-bitmap cache.

### 6. Motion temporarily wins over interaction

Whenever the camera moves, tldraw places a full-viewport pointer-event blocker above the canvas. It remains until the moving timeout expires. Hover is recomputed when idle. This prevents accidental iframe, text, or shape interactions while the camera is still moving.

Sources:

- `packages/editor/src/lib/components/default-components/DefaultCanvas.tsx:369-379` — blocker follows camera state.
- `packages/editor/editor.css:1506-1519` — blocker covers the viewport and captures pointer events.
- `packages/tldraw/src/lib/defaultSideEffects.ts:8-15` — hover refresh on return to idle.

**User-visible implication:** content is intentionally non-interactive during motion and becomes interactive shortly after it stops. That matches the founder's allowance for a passive visual during navigation, provided Eido's settle interval remains imperceptible and the activated card is not discarded.

### 7. Selected and editing shapes stay visible; dragging inherits selection

The visible-set derivation first identifies offscreen shapes. `getCulledShapes()` then removes the active editing shape and every selected shape from the culled set. A shape util may also opt out of culling altogether. There is no generic hovered-shape exception.

Sources:

- `packages/editor/src/lib/editor/Editor.ts:5694-5751` — editing and selected exceptions with stable-set caching.
- `packages/editor/src/lib/editor/shapes/ShapeUtil.ts:365-374` — per-shape `canCull()` escape hatch.
- `packages/tldraw/src/test/notVisibleShapes.test.ts:274-297` — selected offscreen shape remains not-visible but is removed from culled shapes.

**Eido translation:** clicked, selected, editing, dragging, resizing, internally scrolling, or focus-owning cards should be pinned in the live set even if they cross the preload boundary. They should demote only after the interaction is complete and a passive representation is ready.

### 8. Rich text has a concrete passive-to-active seam

Passive rich text is rendered once to static HTML. The editable TipTap surface returns `null` unless the shape is actively editing; on edit it constructs a TipTap editor, focuses it, and destroys it on cleanup. CSS hides the static rich-text copy while the editor is active, and the source explicitly works to keep static and edit-mode whitespace/layout consistent.

Sources:

- `packages/tldraw/src/lib/shapes/shared/RichTextLabel.tsx:73-84,126-196` — static HTML plus conditional editor surface.
- `packages/tldraw/src/lib/shapes/text/RichTextArea.tsx:119-230` — create, focus, update, and destroy the active TipTap editor.
- `packages/tldraw/src/lib/shapes/text/RichTextArea.tsx:232-258` — no editor DOM when not editing.
- `packages/editor/editor.css:498-504,634-655` — switch between static and editing representations.
- `packages/editor/editor.css:714-750` — explicit static/edit layout-parity concern.

This clarifies **Card activation** in non-technical terms: a Card can look complete while it is passive; activation replaces or covers that passive view with the real interactive Card/editor at exactly the same position and size. Deactivation reverses the process after interaction ownership ends.

tldraw activates at the text editor seam, not at whole-shape residency: the static shape DOM is already mounted. Eido's experiment is broader because a Card contains Markdown, controls, transcript rows, internal scrolling, provenance, and sometimes media.

### 9. Embeds and video become interactive only in editing state

tldraw keeps an embed iframe mounted but disables pointer events and keyboard tab entry until the shape is editing. Video controls are likewise enabled only while editing. This cleanly separates a visually present object from an interaction-authoritative one.

Sources:

- `packages/tldraw/src/lib/shapes/embed/EmbedShapeUtil.tsx:166-214,254-280` — iframe remains present; editing controls pointer events and tab order.
- `packages/tldraw/src/lib/shapes/video/VideoShapeUtil.tsx:132-176,178-225` — active editing focuses video and enables controls.

**Eido translation:** a passive Conversation or Result may be a non-interactive render while moving, but activation must give the Live Card authority for internal scrolling, links, buttons, text selection, editing, and media controls. The passive layer must stop receiving hits once activation begins.

### 10. Asset work is paused offscreen, but first entry is not proactively warmed

The image/video asset hook skips URL resolution while its shape is culled. It retains the last resolved URL and only updates when a different URL arrives. After the first resolution, scale-dependent URL upgrades are debounced for 500 ms. This avoids fetching new image variants during zoom motion, but it does not warm never-seen offscreen assets.

Sources:

- `packages/tldraw/src/lib/shapes/shared/useImageOrVideoAsset.ts:45-70` — retained asset/URL state.
- `packages/tldraw/src/lib/shapes/shared/useImageOrVideoAsset.ts:81-115` — culled shapes skip resolution.
- `packages/tldraw/src/lib/shapes/shared/useImageOrVideoAsset.ts:116-149` — URL deduplication, immediate first resolution, and 500 ms later upgrades.

**User-visible trade-off:** a previously seen image can reappear immediately from its retained DOM/browser state. A first-seen image crossing the exact viewport boundary may still show a placeholder or wait for an async URL/load. This is weaker than the Eido requirement and is one reason Eido needs an approach zone or a guaranteed fallback layer.

### 11. There is no general staged or priority rendering queue

The shape list is rendered as one React mapping. Visibility updates loop across the central container registry. Searches of the editor and built-in shape renderer show no generic idle-callback, task-priority, deferred-value, or incremental visible-shape queue in this path. The available staging mechanisms are narrower:

- exact visibility culling;
- immediate shared-layer transform;
- memoized inner shape rendering;
- frozen zoom-dependent decisions while moving;
- 500 ms asset-variant debounce; and
- active-edit-only rich text.

Sources:

- `packages/editor/src/lib/components/default-components/DefaultCanvas.tsx:203-223,246-263` — one shape map and one central culling pass.
- `packages/editor/src/lib/components/Shape.tsx:14-24,161-196` — inner render memoization.
- `packages/editor/src/lib/editor/Editor.ts:4748-4797` — stable ID order and sort-permutation cache, not a priority queue.

## Comparison to the Fixed Eido Contract

| Contract area | tldraw at this snapshot | Fit for Eido |
| --- | --- | --- |
| No blank holes during ordinary pan | Usually achieved because every shape is already mounted and unhide is synchronous | Useful principle, but whole-board rich Card DOM is the cost Eido is trying to remove |
| Exceptionally fast pan | Exact-edge unhide; no visible fallback if work misses a frame | Insufficient by itself |
| Preload beyond viewport | None in the culling path | Eido should keep/add a buffered approach zone |
| Static render during motion | No; culled shapes disappear, visible shapes remain their live DOM | Eido retains the lightweight canvas safety net and keeps resident native Card DOM; no raster seam is adopted |
| Smooth zoom | Shared layer scales continuously; expensive zoom decisions freeze on large boards | Strongly transferable |
| Crisp after settle | Efficient zoom returns to current zoom after idle | Transferable with an explicit settled refresh gate |
| Interaction after activation | Motion blocker yields to selected/editing surfaces; embeds and video become interactive in edit mode | Transferable |
| Active card never culled | Selected and editing shapes are pinned | Transferable and should be expanded to focus/internal-scroll/drag ownership |
| Rich content cost | Static HTML for every rich-text shape; only one TipTap editor | Transferable at the editor seam, but Eido passive Cards are much heavier |
| Search/copy/accessibility | Static rich text is marked `aria-hidden` when not editing; canvas interaction owns selection semantics | Does not establish Eido's required accessibility/search behavior |
| Memory | Whole-page DOM and component state remain resident | Do not copy without a hard memory/residency budget |
| Dynamic media | Iframes/video can stay mounted but interaction is gated; asset upgrades pause offscreen | State continuity is good, memory can be expensive |

## Corrections to Earlier Assumptions

- **“tldraw culls by unmounting offscreen shapes.”** False at this snapshot. It retains their DOM and toggles `display`.
- **“tldraw uses viewport overscan or predictive bounds.”** False in the core culling derivation. The query is the exact viewport.
- **“Culled tldraw shapes remain as cached/static visuals.”** False. They are visually absent; only their hidden implementation subtree remains warm.
- **“tldraw avoids all zoom-time rendering changes by moving a cached picture.”** Too strong. The whole DOM layer scales with the camera, while selected expensive consumers use a gesture-start zoom value. There is no general board bitmap.
- **“tldraw progressively mounts visible shapes by priority.”** False for this path. All current-page shapes are mapped and mounted; culling is a CSS visibility operation.
- **“Activation means a Card visibly changes into a different shape.”** It should not. tldraw's rich-text handoff hides a layout-matched static copy and activates the editor at the same geometry. For Eido, activation is an authority/residency change that is visually neutral.
- **“tldraw proves static rendering preserves native accessibility.”** It does not. Passive rich text is `aria-hidden`, and the canvas application supplies separate interaction/accessibility machinery.

## Final Recommendation for Eido

### Adopt a four-layer continuity contract

1. **Board truth remains lightweight and always resident.** Card/Connection records, spatial index entries, layout bounds, and current Overview/Map paint remain available for the whole board.
2. **A never-blank motion safety net stays underneath Reading cards.** The existing canvas representation should continue to move with the camera even in Reading, normally occluded by higher-fidelity layers. It is the last-resort frame for a pan that outruns all prepared detail.
3. **Native Reading Cards occupy a buffered resident window.** Keep complete Card DOM for the viewport plus a generous margin. Keep a trailing margin and hysteresis so reversing direction cannot churn cards at the boundary. Bias additional work in the current velocity direction, but cap it.
4. **Live ownership is additive within that native path.** Clicked, selected, editing, dragging/resizing, focus-owning, internally scrolling, or media-playing Cards are pinned. There is one native Card renderer; passive residency is a lifecycle state, not a bitmap representation.

This separates four concepts that Eido currently partly conflates: **what exists**, **what can be seen during motion**, **what is rendered at full Reading fidelity**, and **what currently accepts interaction**.

### Reuse tldraw's temporal tricks

- Move the prepared visual layers with one camera transform rather than recomputing card internals on every motion event.
- During active pan/zoom, keep the already-mounted native Card surface visible while only shallow geometry changes.
- Freeze expensive zoom-dependent content/layout decisions during motion and refresh them only after settle.
- Block or route card-internal interaction while the camera is moving, then return authority immediately at settle.
- Keep active Cards pinned beyond the normal culling window.
- For images/media, keep the previous valid visual while a sharper/current resource resolves; never replace it with blank.

### Do not copy tldraw's exact-edge, whole-DOM policy

Eido already has a better spatial preparation primitive: `DETAIL_CULL_MARGIN_PX = 1800`, converted from screen pixels to board space by the render index. That margin is currently bypassed when a small eligible board chooses whole-board detail, but it is the right *kind* of boundary for a buffered passive window.

Sources:

- `src/canvas/boardScene.ts:648-676` — current whole-board shortcut and window query.
- `src/canvas/boardScene.ts:703-725` — current Reading detail residency.
- `src/canvas/boardScene.ts:32-33` — current 1,800 px Reading margin and 300 px Overview margin.
- `src/canvas/renderPlanning.ts:626-639` — screen-space margin conversion and intersection.

The exact 1,800 px value should be benchmarked, not silently frozen into the successor architecture. The key contract is screen-space buffering plus hysteresis and a board-wide fallback, not a specific number.

### Define Card activation precisely

For this epic, **Card activation** should mean:

> The passive representation stays visible at the same bounds while Eido creates or reveals the live Card. Once the live Card is ready, it takes visual and pointer authority without resizing, jumping, blanking, losing scroll/focus, or changing the current LOD. The passive copy is then hidden, not destroyed until a later safe point.

Hover should start this handoff before click, and the activated Card should remain pinned while it owns focus, selection, editing, internal scrolling, a gesture, or active media. For long Notes, Conversations, and Results, activation gives full internal scrolling and all normal links, controls, selection, copy, and editing. Within-card virtualization may still limit which far-away transcript rows are live, but navigating inside the card must cause them to appear before they enter its internal viewport.

### Keep the current LOD contract fixed

ADR 0019 already freezes the Reading/Overview/Map thresholds, deadband, settle gate, and crossfades while residency is measured. ADR 0020 already freezes board-space shapes, screen-space labels, painter/hit parity, and bounded hot proxies. This study supplies no evidence to reopen those choices.

Sources:

- `docs/adr/0019-viewport-derived-detail-bands.md:3-5,15-49` — accepted visual-band and settle contract.
- `docs/adr/0020-board-space-shapes-screen-space-labels.md:3-5,15-41` — accepted painter, interaction, and mount boundaries.

ADR 0023 records the accepted passive/live authority contract without rewriting
the accepted history. The selected production path is complete native Card DOM
with bounded residency and additive Live owners; the cached-passive prototype
and its cache/eviction machinery were rejected and removed. ADR 0024 separately
governs image rendition and decoded-surface residency.

## What the User Should Notice

If the recommendation succeeds:

- During a normal pan, cards ahead of the viewport are already prepared; nothing pops in at the edge.
- During a very fast pan, the canvas never becomes empty. Prepared static Cards move immediately; if the pan outruns them, the existing lightweight board representation remains underneath until they catch up.
- During zoom, Cards may be fractionally softer or keep their pre-gesture internal detail for a moment, but they do not disappear, resize, or change LOD unexpectedly. They become crisp just after motion stops.
- Clicking into a resident Card keeps the same native content in place. Long Notes, Conversations, and Results become internally scrollable and interactive.
- Editing, selection, dragging, resizing, focus, caret position, text selection, internal scroll position, and active media survive navigation.
- Revisited areas usually appear immediately from a bounded cache. Very old areas may be regenerated, but the safety-net representation prevents blank space.
- Overview and Map look and behave as they do now.

Failure modes that should fail the epic's browser gates:

- a blank card rectangle or empty canvas region during camera motion;
- clipping at the preload boundary;
- a card changing dimensions when it becomes live;
- a soft/static Card remaining after settle;
- the first activation click being lost without a clear activation affordance;
- lost focus, selection, caret, Card scroll, or media state;
- a visible stationary card that looks interactive but ignores input; or
- unbounded cache growth on a long navigation session.

## Founder Decisions After The Study

### 1. Extreme pan fidelity versus bounded memory — resolved

No bounded preload window can guarantee that an arbitrary jump to a never-visited, far-away region already has a resident native Card. The founder chose bounded memory:

- Guarantee no blank by showing the always-resident lightweight Eido Card representation for a few frames if the native Card is not yet resident. A short detail load on a rare far jump is accepted.
- Do not build and retain a full-fidelity static render for every Card on the Board merely to eliminate this rare load.

tldraw chooses a version of the alternative by retaining every live shape DOM subtree. It does not prove that choice is viable for Eido's much heavier Cards.

### 2. First-click semantics on a Passive Card — resolved at contract level

Hover, keyboard focus, or programmatic focus starts activation before click. The normal first click should therefore reach the intended Live Card control rather than being spent only on activation. The prototype still needs to prove direct-control hit continuity and provide event replay or a safe fallback for clicks that arrive before activation finishes.

### 3. Dynamic media while passive — resolved

A static representation necessarily freezes video, animation, and iframe state. Keeping those surfaces live preserves motion/state but retains their memory and process cost.

- **Decision:** pause/freeze media in passive Cards, retain the last frame/thumbnail, and restore the live surface when activated. Pin explicitly playing or user-controlled media in the live set.

Search, copying, and accessibility do not require a founder decision yet under the stated contract: preserve them for visible stationary/live Cards, record whole-board browser-find/accessibility limitations of passive/offscreen Cards, and spend that capability only if measurements show it is necessary.

## Prototype Questions That Source Reading Cannot Settle

1. How large should the base preload margin be on target laptops, and how much velocity-biased look-ahead can be added without background work causing the jank it is meant to prevent?
2. Is strict viewport DOM residency plus Eido's existing 1,800 px margin already sufficient, making snapshots unnecessary? **Resolved: buffered native residency plus the Board safety net is selected.**
3. Can a full-fidelity passive Card render be generated cheaply and reliably for Markdown, syntax highlighting, images, transcript rows, custom fonts, and embedded media? **Resolved: the cached-raster route is rejected for native continuity and its implementation is removed.**
4. What cache unit is best: per-Card bitmap, per-Card static DOM, rendered HTML, browser `content-visibility`, or a hybrid by Card kind? **Resolved: no Card-raster cache is part of production; generic image renditions remain governed separately by ADR 0024.**
5. What pixel/byte budget and eviction policy prevents static renders from merely exchanging CPU cost for memory pressure?
6. Can the passive/live overlap preserve exact dimensions, font metrics, scroll position, and first-click intent in Chromium, Safari, and Firefox?
7. Do long Conversations and Results also need internal row virtualization after Card-level residency is fixed?
8. What settle delay produces crisp refresh without thrashing when a trackpad gesture sends a long tail of events?
9. Can the existing Overview painter safely remain as the Reading safety net without becoming perceptible through alpha seams or crossfade differences?

These are benchmark/prototype questions, not permission to loosen the visual-continuity contract. The benchmark should include exceptionally fast pan, rapid zoom-out, direction reversal at the viewport edge, far programmatic navigation, first activation, internal Card scrolling, active editing, and a long revisit loop that exposes cache growth.
