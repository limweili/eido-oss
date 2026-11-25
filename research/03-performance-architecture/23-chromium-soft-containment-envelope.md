# Chromium Same-DOM Soft-Containment Envelope (#1154)

> Re-verified: 2026-08-21
>
> Upstream question: which browser primitive can skip distant layout or paint for a complete fixed-height one-million-character Card without detaching nodes or changing geometry?
>
> Decision: **research retained; adoption DELETE (#1157).** The source and disposable measurements found no primitive that earns production adoption under Eido's exact-geometry, native-semantics, complete-DOM contract. The #1156 negative-control probe and its four repository artifacts were deleted by #1168; this note preserves the durable source and measurement evidence only.

Production closeout note (2026-08-21): #1165 retained the full native Card DOM and rejected own-drag blanking. The production motion authority is the native path's raw paired `AB`/`BA` control/stress envelope; the historical `<50 ms` condition below belongs only to the deleted soft-containment candidate and is not an absolute host cutoff for the adopted renderer. Native browser toolbar Find remains inherited from unchanged complete visible DOM; `window.find` is an automatable smoke only, not toolbar automation.

## Executive answer

Chromium has two materially different containment families:

1. `contain: layout style paint` (or `contain: content`) scopes invalidation and clips paint, but does not skip the descendants of an exact-visible Card. It is a useful isolation adjunct, not a distant-paint accelerator.
2. `content-visibility: auto` can skip descendant layout and paint only while the element is not close to the viewport. An exact-visible fixed-height Card is close to the viewport, so applying it to the Card or its scrollport preserves the complete DOM and geometry but does not skip the million-character body. Applying it to each paragraph/block is the only way to skip distant content inside an exact-visible Card; that is effectively within-Card virtualization, and both Chromium's intrinsic-size model and Eido's prior candidate produce unstable scroll geometry and incomplete cold semantics.

`content-visibility: hidden` skips paint and hit-testing unconditionally. It keeps nodes and state, but it is a hard hidden interval, not a soft complete native Card: selection, links, controls, and visible accessibility cannot remain authoritative.

The practical answer for #1156 was therefore: test Card-root `content-visibility: auto` only to prove the expected null result, with an explicit fixed size and no per-block intrinsic placeholders. That negative-control probe was run and then deleted under #1157/#1168. Paragraph-level `auto`, `hidden`, and spacer ledgers remain rejected within-Card virtualization seams; no same-DOM soft-containment candidate remains open.

## Evidence labels and scope

- **Upstream fact** is a W3C CSS specification, Chromium source/test, or official Electron/Chrome release document.
- **Eido measurement** is the now-deleted disposable Playwright probe described below. It was not the production performance runner and is not a product guarantee.
- **Repository observation** is a fact recorded by an existing Eido study or source document.
- **Inference** is the architectural conclusion drawn from those facts.

The probe was a new temporary file at `/tmp/eido-soft-containment-probe.mjs`; its JSON output was `/tmp/eido-soft-containment-probe.json`. Neither is a repository artifact. It used a synthetic fixed 804 × 504 Card with a 440 px internal scrollport, 5,000 semantic paragraph nodes, and 1,073,907 body-text characters (slightly above the one-million-character target). It compared no containment, `contain: layout style paint`, `content-visibility: auto` on the scrollport, `content-visibility: auto` on the Card, `content-visibility: auto` on every paragraph, and `content-visibility: hidden` on every paragraph. The same probe ran in Chromium 151.0.7922.34 and in the repository's Electron 43.2.0 runtime (Chromium 150.0.7871.129), headless, DPR 1, 960 × 700, with GPU disabled.

The synthetic fixture deliberately tested browser behavior, not React or Eido's graph. It was never an adoption result for #1156; the repository fixture and runner were deleted after the mandatory headed/native Find gate remained unmeasured.

## Upstream facts

### Containment scopes work; it does not make visible descendants disappear

**Upstream fact.** The CSS Containment specification defines layout containment as an isolation boundary for layout dependencies, style containment as an isolation boundary for style-affecting descendants, and paint containment as clipping ink overflow. Paint containment lets the user agent reason about the contained paint box, but it does not state that a visible subtree may be omitted. The Chrome containment explainer describes `contain: content` as `layout paint` and `contain: strict` as `size layout paint`; size containment is the part that permits layout omission.

- [CSS Containment Level 2 — containment types](https://drafts.csswg.org/css-contain-2/#containment)
- [CSS Containment Level 2 — paint containment and viewport proximity](https://drafts.csswg.org/css-contain-2/#containment-paint)
- [Chrome's CSS containment explainer](https://developer.chrome.com/blog/css-containment)

**Inference for Eido.** `contain: layout style paint` on the existing Card/node seam can reduce propagation from a Card and keep paint bounded, but it cannot satisfy the question's “skip distant layout or paint” requirement while the Card is exact-visible. This is why Eido's retained-DOM study can use containment as an adjunct without calling it a soft-containment renderer.

### `content-visibility: auto` is proximity-gated and adds size containment only when skipped

**Upstream fact.** For `content-visibility: auto`, layout, style, and paint containment persist; while the element is not close to the viewport, Chromium also applies size containment and skips the contents' rendering work. “Close” is based on the element's paint-containment overflow clip edge intersecting the viewport or a user-agent-defined margin. Focus, selection, and other “relevant to the user” reasons keep an auto subtree from being skipped. The element's own box still renders; the display-lock implementation skips child processing.

- [CSS Containment Level 2 — `content-visibility`](https://drafts.csswg.org/css-contain-2/#content-visibility)
- [Chromium Display Lock README](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/display_lock/README.md) (the implementation notes that self rendering always occurs and checks apply to child rendering)
- [Chromium Display Lock context](https://chromium.googlesource.com/chromium/src/+/f67c4d7dd61ed21a1493aca65b1004c74b31e91f/third_party/blink/renderer/core/display_lock/display_lock_context.cc) (auto lock/unlock, invalidation, scroll and activation paths)

**Inference for Eido.** Applying `content-visibility: auto` to the Card or its internal scrollport cannot skip a body that is exact-visible. Applying it to the body blocks can skip distant blocks, but the Card then has many independent proximity/size decisions and no longer has one exact content geometry. That is the same seam as hard within-Card virtualization, which #1151 explicitly excludes.

### Intrinsic size is a placeholder/remembered size, not the actual distant geometry

**Upstream fact.** `contain-intrinsic-size` supplies the explicit intrinsic size used when size containment makes the contents unavailable to layout. `auto` can use a last remembered size, but that size is recorded at ResizeObserver delivery and is state on the element, not a proof that all current descendants have their exact layout. The CSS Sizing specification warns that size guesses can cause scrollbars or hidden content. Its overflow rules also distinguish the hypothetical intrinsic size from actual content when deciding whether an `overflow: auto` element has scrollbars.

- [CSS Sizing Level 4 — overriding contained intrinsic sizes](https://drafts.csswg.org/css-sizing-4/#contain-intrinsic-size)
- [CSS Sizing Level 4 — last remembered size](https://drafts.csswg.org/css-sizing-4/#last-remembered)
- [CSS Sizing Level 4 — interaction with `overflow: auto`](https://drafts.csswg.org/css-sizing-4/#cis-scrollbars)

**Inference for Eido.** A fixed outer Card can keep its own `getBoundingClientRect()` stable with explicit dimensions. That does not make `scrollHeight`, the maximum internal scroll offset, range rectangles, or card-relative anchors exact when descendants are represented by intrinsic placeholders.

### `content-visibility: hidden` is an explicit hard hidden state

**Upstream fact.** The original Chromium feature description states that `content-visibility: hidden` prevents the subtree from being drawn or hit-tested while retaining the DOM/state and applying containment. Chromium's accessibility implementation treats `content-visibility: hidden` subtrees as hidden; `content-visibility: auto` is treated specially for screen readers because accessibility navigation and Find-in-Page may need to activate it.

- [Chromium's Chrome 85 feature announcement](https://blog.chromium.org/2020/07/chrome-85-upload-streaming-human.html#css-content-visibility)
- [Chromium AX object handling of display-locked content](https://chromium.googlesource.com/chromium/src/+/da024b1d5f4d248ce4f062af9d8eb4df6dd84e63/blink/renderer/modules/accessibility/ax_object.cc)

**Inference for Eido.** `hidden` cannot be the permitted soft interval: a user-visible exact Card cannot simultaneously retain native link/control hit testing, native selection, and visible accessibility while its content is hard hidden.

### Unlocking and skipping have observable lifecycle work

**Upstream fact.** Chromium's `DisplayLockContext` marks style for recalculation when an auto context becomes locked, blocks/restores dirty-bit propagation, removes/rebuilds the affected AX subtree, marks layout/pre-paint/paint/compositor state dirty on unlock, and schedules a `contentvisibilityautostatechange` task. The same source explicitly keeps an auto subtree unlocked for two lifecycle frames for Find-in-Page, fragment navigation, `scrollIntoView`, and simulated click activation, because visibility is determined at the end of a subsequent frame.

- [Chromium Display Lock lifecycle and invalidation source](https://chromium.googlesource.com/chromium/src/+/f67c4d7dd61ed21a1493aca65b1004c74b31e91f/third_party/blink/renderer/core/display_lock/display_lock_context.cc)
- [Chromium's `contentvisibilityautostatechange` implementation](https://chromium.googlesource.com/chromium/src/+/refs/heads/main/third_party/blink/renderer/core/display_lock/content_visibility_auto_state_change_event.cc)
- [Chromium source change introducing the state-change event](https://chromium.googlesource.com/chromium/src/+/7330cd84b2a8bafdf5a794e57b8f2cd8b6e3626c%5E%21/)

**Inference for Eido.** A Card crossing the containment boundary is not a free CSS toggle. It has style/layout/pre-paint/paint and AX invalidation obligations, and direct activation may wait across a browser lifecycle boundary. Eido's acceptance must measure transition frames and not only steady-state transform frames.

### Browser tests document the difficult semantics

**Upstream fact.** Chromium's Web Platform Tests cover nested `content-visibility: auto` scroll targets, `scrollIntoView` through nested auto subtrees, auto-state relevancy when content is offscreen/focused/selected, selection interactions, and auto-state transition events. These are not claims that every application layout is correct; they are evidence that these operations are special browser lifecycle paths rather than inert DOM operations.

- [Nested auto subtree can be scrolled to](https://chromium.googlesource.com/external/github.com/web-platform-tests/wpt/+/master/css/css-contain/content-visibility/content-visibility-auto-nested-scroll.html)
- [Nested auto subtree plus `scrollIntoView`](https://chromium.googlesource.com/external/github.com/web-platform-tests/wpt/+/master/css/css-contain/content-visibility/content-visibility-vs-scrollIntoView-001.html)
- [Auto relevancy updates for proximity, focus, and selection](https://chromium.googlesource.com/external/github.com/web-platform-tests/wpt/+/master/css/css-contain/content-visibility/content-visibility-auto-relevancy-updates.html)
- [Auto selection regression/crash coverage](https://chromium.googlesource.com/external/github.com/web-platform-tests/wpt/+/master/css/css-contain/content-visibility/content-visibility-auto-selection-crash.html)
- [Auto state-change event coverage](https://chromium.googlesource.com/external/github.com/web-platform-tests/wpt/+/master/css/css-contain/content-visibility/content-visibility-auto-state-changed.html)

### Accessibility and Find are intended to activate auto content, not prove exact Card geometry

**Upstream fact.** Chrome's first-party content-visibility guidance says offscreen `auto` content remains in the DOM and accessibility tree and can be searched/navigated. Chromium's AX source explains why: for a screen reader, auto display-locked subtrees are treated as visible so text navigation and Find can work. The guidance also warns that calling rendering-forcing DOM APIs on skipped content defeats the optimization. This is an accessibility/search contract, not a guarantee that `innerText`, range rectangles, scroll metrics, or the entire AX subtree are synchronously materialized at all times.

- [Chrome/Web.dev content-visibility guidance](https://web.dev/articles/content-visibility)
- [Chromium AX handling for auto/hidden display locks](https://chromium.googlesource.com/chromium/src/+/da024b1d5f4d248ce4f062af9d8eb4df6dd84e63/blink/renderer/modules/accessibility/ax_object.cc)

**Inference for Eido.** A green DOM-presence check was insufficient. The deleted #1156 probe had to test native selection, browser Find, link/control hit testing, focus, AX roles/names, `scrollHeight`, range rectangles, and card-relative scroll anchors separately. Its mandatory headed/native Find observation remained unmeasured, so #1157 correctly chose DELETE; no browser optimization remains pending adoption.

### Electron support is present in the current product runtime

**Repository observation.** The repository pins `electron` to `43.2.0` in `package.json`/`package-lock.json`.

**Upstream fact.** The official Electron v43.2.0 release identifies its Chromium engine as `150.0.7871.129`. Chrome shipped `content-visibility` in Chrome 85, so the CSS property itself is well inside the current Electron support envelope. The state-change event and implementation details should still be treated as Chromium-version-specific and measured in the actual packaged runtime.

- [Repository dependency pin](../../package.json#L88)
- [Electron v43.2.0 release and Chromium version](https://releases.electronjs.org/release/v43.2.0)
- [Electron release schedule](https://releases.electronjs.org/schedule)
- [Chrome 85 content-visibility announcement](https://developer.chrome.com/blog/new-in-chrome-85)

## Eido measurement

### Probe setup

The fixture was intentionally a complete, fixed-height native DOM tree, not an approximate spacer:

| Item | Probe value |
| --- | ---: |
| Card border box | 804 × 504 CSS px |
| Internal scrollport | 440 CSS px high, `overflow: auto` |
| Semantic descendants | 5,000 `<p>` blocks plus a tail link |
| Body text | 1,073,907 characters in `textContent` |
| Browser runner | Playwright 1.62, headless, DPR 1, GPU disabled |
| Chromium | 151.0.7922.34 (Chrome for Testing) |
| Electron | 43.2.0 / Chromium 150.0.7871.129 |

Each arm captured Card geometry, node count, body text length, `scrollHeight`/`scrollTop` at top/middle/bottom, a native Range selection in the tail block, a CDP accessibility tree summary, and 120 shallow transform frames. It also listened for `contentvisibilityautostatechange`. The motion number is the rAF gap p95/max for a synthetic transform, not a claim about Eido's React Flow path.

### Exact-visible Card and scrollport: containment preserved geometry but did not skip work

The no-containment control, `contain: layout style paint`, `content-visibility: auto` on the scrollport, and `content-visibility: auto` on the Card all retained the full 5,000-node/1,073,907-character DOM. In both Chromium and Electron they reported the same fixed geometry and `scrollHeight` of 323,194 px (max scroll 322,754 px), retained the tail selection, and exposed the same 25,003-node CDP AX-tree summary.

The 120-frame transform results were noise-level equivalent:

| Arm | Chromium 151 p95 / max | Electron 43.2 p95 / max | State-change events |
| --- | ---: | ---: | ---: |
| No containment | 17.7 / 18.7 ms | 17.6 / 18.6 ms | 0 |
| `contain: layout style paint` | 17.9 / 18.6 ms | 16.8 / 18.4 ms | 0 |
| `content-visibility: auto` on scrollport | 16.8 / 18.4 ms | 17.3 / 18.3 ms | 0 |
| `content-visibility: auto` on Card | 17.7 / 18.6 ms | 17.4 / 18.7 ms | 0 |

**Eido measurement.** The exact-visible auto arms did not skip their body: no auto state transition occurred during the test, and neither arm was materially closer to the short control than the ordinary native DOM arm. The Card-root arm was therefore a historical #1156 negative control, not a source-backed performance win or production seam.

### Per-paragraph `content-visibility: auto`: it skips, but geometry is not exact

Applying `content-visibility: auto; contain-intrinsic-block-size: auto 32px` to every paragraph retained the DOM and `textContent`, but it replaced distant block geometry with intrinsic estimates until those blocks approached the internal viewport. The result was not a stable scroll coordinate system:

| Measurement | No containment | Per-paragraph auto |
| --- | ---: | ---: |
| Initial `scrollHeight` | 323,194 px | 200,748 px |
| Middle request / resulting `scrollTop` | 161,597 / 161,597 | 100,374 / 101,040 |
| Bottom request / resulting `scrollTop` | 322,754 / 322,754 | 200,748 / 201,414 |
| `scrollHeight` after visiting bottom | 323,194 px | 203,906 px, then 203,955 px after returning top |
| Cold `body.innerText` | 1,078,929 chars | 5,655 chars |
| CDP AX-tree node summary | 25,003 | 5,111 |

The block arm emitted 1,173 auto state-change events during the scroll/transition sequence in each engine. Its transform p95 was still 17.0 ms (Chromium) / 17.1 ms (Electron), with no >=50 ms frame in this shallow synthetic motion; the saving was not visible in this motion arm because the transform itself was compositor-friendly. The cost was correctness: the same user request mapped to changing coordinates and changing total scroll extent.

**Eido measurement caveat.** The `innerText` and CDP AX counts are diagnostics of the cold skipped state, not a claim that Chromium's browser Find or every screen reader fails. Chrome's upstream contract deliberately activates auto content for Find/AX. They do show that “all DOM nodes remain attached” is not equivalent to “all native semantic/layout surfaces are synchronously complete.” The browser Find protocol command used by the deleted probe was not exposed by that Playwright/CDP build; the mandatory headed/native Find gate therefore remained not measured and blocked adoption.

### Per-paragraph `content-visibility: hidden`: hard hidden semantics

The `hidden` arm retained 5,000 DOM nodes and 1,073,907 `textContent` characters, but cold `body.innerText` was only 22 characters, native Range selection returned zero selected characters, and its AX summary was 5,010 nodes rather than the ordinary 25,003. Its fixed placeholder `scrollHeight` was 200,024 px and never became the ordinary 323,194 px. This is a deliberate hard-hidden state, not an eligible soft-containment mechanism.

### Transition observations

**Eido measurement.** A separate tiny fixture moved a root `content-visibility: auto` Card offscreen and back using both layout `top` and a CSS transform. Chromium 151 and Electron 43.2.0 each emitted `skipped: true` and `skipped: false` events after the expected rAF settling. No event was emitted while the Card stayed exact-visible. This demonstrates the transition boundary, not a portable duration budget.

**Upstream fact.** Chromium's implementation schedules the state-change event as a task and explicitly keeps auto content unlocked for two lifecycle frames for Find-in-Page, fragment navigation, `scrollIntoView`, and simulated clicks. The deleted probe therefore measured first transition, steady motion, and return-to-interaction separately. A smooth CSS fade is not the same thing as a browser display-lock transition and must not be assumed to hide the work.

## Candidate decision matrix

| Candidate | Same complete DOM | Exact fixed Card geometry | Skips distant child layout/paint while Card is exact-visible | Native semantics | Decision |
| --- | --- | --- | --- | --- | --- |
| `contain: layout style paint` / `contain: content` | Yes | Yes with existing explicit Card bounds | No | Yes | Keep only as an unrelated invalidation/paint-boundary adjunct; it is not a soft-containment answer |
| `content-visibility: auto` on Card root | Yes | Yes with explicit height/intrinsic fallback | No while exact-visible; yes only when Card is already distant | Intended to preserve auto AX/Find, but transitions need gates | Historical #1156 negative control; deleted, not adopted |
| `content-visibility: auto` on internal scrollport | Yes | Outer Card can stay fixed | No while scrollport is exact-visible | Same caveat; geometry reads can unlock | Reject as a performance answer |
| `content-visibility: auto` on each semantic block | Yes in DOM, not in rendered/layout state | No: intrinsic sizes evolve as blocks enter | Yes | Cold native surface is not complete; activation/Find/selection can unlock | Reject; this is within-Card virtualization in disguise |
| `content-visibility: hidden` | Yes in DOM/state | Placeholder geometry only | Yes | No visible hit testing/selection; hidden AX semantics | Reject |
| `contain-intrinsic-size` alone | Yes | Placeholder/remembered size only | No | Yes | Not a skipping primitive |

## What #1156 measured before deletion

The deleted #1156 probe applied `content-visibility: auto` to one fixed Card root, set explicit Card dimensions, and avoided per-block intrinsic sizes. Its durable measurement contract required:

1. exact one-million-character completeness and stable DOM identity before/after every arm;
2. Card `getBoundingClientRect()`, internal `clientHeight`, `scrollHeight`, `scrollTop`, bottom distance, and a selected text Range before/after pan, zoom, and Card drag;
3. native text selection/copy, trusted link activation, keyboard focus, browser Find, and AX roles/names in the exact-visible and transition states;
4. `contentvisibilityautostatechange` timing and skipped/not-skipped state for the Card, including transform motion through the viewport boundary;
5. DevTools trace evidence for style recalculation, layout, pre-paint, paint, compositor work, and long tasks at gesture start, steady frames, settle, and first post-settle interaction; and
6. paired short/stress frame p95/max with an explicit rejection for any transition frame at or above 50 ms.

The decisive negative result is not “Chromium lacks the property.” It is: the only placement that skips work inside an exact-visible Card also changes the coordinate/semantic surface that Eido promises to preserve. Card-root `auto` had no measurable exact-visible skipped state or near-control improvement, and the mandatory headed/native Find gate was not measured. #1157 therefore selected DELETE; #1168 removed the probe, runner, partial evidence note, and disposable decision note. No production flag, style, dependency, instrumentation, runtime allocation, or dormant configuration was introduced or retained for this branch.

## Relation to existing Eido evidence

- [Excalidraw Rendering Performance Study](12-excalidraw-rendering-performance-study.md) establishes retained rendering and narrow invalidation, but its ordinary text is Canvas2D pixels and does not prove rich native DOM containment.
- [tldraw Rendering-Continuity Study](13-tldraw-rendering-performance-study.md) establishes resident DOM/compositor continuity and explicitly leaves `content-visibility` as a prototype question; it does not prove exact internal scroll geometry.
- [Within-Card Virtualization / Content-Visibility Candidate](17-within-card-virtualization-candidate.md) is Eido's prior decision archaeology. It records scroll drift, live-to-passive re-entry drift, and first-intent retargeting as candidate-ineligible and says the runtime/flag/evidence workflow was removed by #597. The present source/probe result independently reached the same boundary: paragraph-level `auto` is not eligible under the current contract, and the newer Card-root negative control was also deleted after #1157's binary decision.
- [Card-Facade Reference Architecture Claim Audit](22-card-facade-reference-architecture-study.md) remains the parent research context; this note does not revive a facade or alternate renderer.

## Source ledger

The primary sources used here are the W3C CSS Containment/Sizing specifications, Chromium Blink Display Lock and accessibility source, Chromium's WPT tests, and official Chrome/Electron release documentation. No secondary performance article or vendor marketing claim is used as an adoption proof.
