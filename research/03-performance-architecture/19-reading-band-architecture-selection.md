# Reading-band architecture selection

Status: selected by issue #406 and implemented by the #553–#561 production
train on 2026-07-19. This document preserves the synthetic selection evidence;
the production contract now lives in ADRs 0019, 0020, 0023, and 0024 plus the
canvas foundation.

## Decision and why

Select one bounded architecture:

1. Use the rich-DOM residency seam measured by
   [#403](15-strict-viewport-residency-candidate.md), expanded from an exact
   viewport cut to a buffered preload/look-ahead window with hysteresis.
2. Keep the existing Board-wide lightweight canvas safety representation.
   Keep interaction-owning Cards in live rich DOM, and use a separate bounded
   hot overlay for hover/proximity transitions and active pointer manipulation.
3. Pair that renderer policy with
   [#413's visibility-aware image-rendition candidate](16-image-rendition-candidate.md).
   The saved Card asset/reference remains authoritative; runtime renditions do
   not require an asset-to-blob or save-format migration.

This is the only architecture carried forward. It preserves rich Cards wherever
interaction requires them, bounds ordinary rich-DOM residency, prevents blank
navigation through the safety layer and preload window, and gives image
residency an explicit authority rather than assuming that DOM count also bounds
decoded pixels.

## Normalized evidence matrix

The rows use the same decision axes. Timing values from different provider runs
are evidence within their own lane, not a universal device ranking.

| Evidence | Responsiveness / long tasks | DOM, layout, and paint | Memory and images | Settled fidelity and continuity | Search, selection, copy, keyboard, AX, and editing | Complexity / operational risk | #406 verdict |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [#402 current rich-Card baseline](14-rich-card-reading-baseline.md) | Frozen 16-scenario, 48-run control exposes substantial slow-frame and long-task work; it is not a candidate improvement. | Peak resident rich DOM is **131/131 Cards** in every listed scenario; layout and paint therefore scale with whole-Board materialization on this fixture. | Stored payload is 2,375 bytes and decoded pixels are a 48.66 MiB source-dimension estimate; native decoder, compositor, GPU, and rendition-cache residency are unavailable. | Current Reading behavior is the visual control; retained runs report zero blank and zero missing-representation frames. | Mounted rich DOM preserves the product seam. Narrow search, selection, and AX probes exist; baseline copy was unavailable and whole-Board completeness was not established. Long-Card editing/scrolling remains current behavior. | Lowest migration risk, but unbounded rich DOM is the measured scaling risk. | **Terminally rejected as the final architecture; retained as canonical control.** |
| [#403 strict-viewport residency](15-strict-viewport-residency-candidate.md) | Historical candidate evidence: aggregate duration, long tasks, style/layout, and paint improved, but direction reversal and rare far jump regressed; timing and JS-heap signals are mixed. | Ordinary pan peaked at **80** resident Cards and exceptionally fast pan at **72**, versus 131 baseline. The **540-Card ceiling was unexercised** by the 131-Card fixture, so this was a seam proof rather than a large-Board ceiling proof. | JS heap is mixed and excludes native/GPU totals; observed cold/warm decode time regressed. It supplied no rendition policy. | Zero blank/missing frames were observed. Resident Cards remained ordinary rich components, so no passive-to-live renderer handoff was measured. | Mounted synthetic search, selection, copy, and AX probes ran; AX counts were not completeness evidence. Editing, first click, internal scrolling, gestures, media pins, and long Card choreography used resident rich DOM. Offscreen Find and whole-Board semantics remained unproved. | Moderate: render index, preload, directional look-ahead, retention hysteresis, owner pins, safety coverage, and settlement had to agree. An exact viewport cut alone was too brittle. | **Strict viewport is retired and non-selectable; buffered native-DOM residency with hysteresis, safety, and owner pins is the selected production basis.** |
| [#404 within-Card content visibility](17-within-card-virtualization-candidate.md) | No performance win can override the negative correctness result; candidate timing is not accepted as selection evidence. | DOM is retained and eagerly constructed; browser heuristics may skip some off-internal-viewport layout/paint but do not reduce DOM. | Image scope and stored references are unchanged; no image-residency result. | Ordered activation regions produced scroll drift, Transcript live-to-passive re-entry drift also failed, and Conversation attribution remains measured-unresolved. | Note/Result/follow-up/Transcript scroll manifestations and a **Result first-intent retarget** violate interaction continuity. The candidate cannot be justified by retained native semantics when activation itself loses state or intent. | High browser-heuristic and intrinsic-size risk, with difficult activation/re-entry attribution and no authoritative per-element “skipped” bit. | **Terminally rejected; `architectureSelectable: false`; no equivalent content-visibility alternative remains open.** |
| [#405 cached-passive Cards](18-cached-passive-rich-card-candidate.md) | Hosted-runner CPU/FPS/timing is directional and non-blocking; no absolute renderer win was established. | A cached raster fits the prepared representation seam, but frame-by-frame continuity, transient sharpness, and capture-after-image-readiness were **not measured** and cannot be represented as zero loss. | The prototype separates encoded raster bytes, decoded pixels, cache growth, and capture work, but exact GPU/rendition residency remains unavailable and it does not replace #413 image truth. | Settled structural/functional observations do not prove motion sharpness or capture readiness. Never-blank, first-click, pin, and long-Card requirements remain gates, not a promotion claim. | Passive pixels block trusted native activation, exact DOM selection/copy, normal keyboard traversal, descendant link semantics, full AX structure, and retained browser Find. Live promotion does not erase those pre-activation blockers. | Highest renderer complexity: capture lifecycle, invalidation, poisoning, budgets, raster fidelity, activation authority, intent routing, and duplicate representations. | **Terminally rejected; candidate-ineligible and non-selectable.** |
| [#413 visibility-aware renditions](16-image-rendition-candidate.md) | Traversal/readiness and paint were measured, but motion/offscreen deferral branches were unexercised; this is not a general renderer timing result. | It changes image resolution/residency, not rich-DOM residency. Blank replacements were zero only in the measured traversal. | Peak decoded residency was **7.34 MiB**, peak derived rendition residency about **0.01 MiB**, and reference-aware LRU recorded **52 eviction/revocation events**. Persistence/storage impact is **unmeasured and confounded** by substituted fixture MIME/bytes. | Measured traversal stayed visually present; zero motion/offscreen counters are not evidence those branches work. Gallery activation preserved Card bounds. | Visible mounted caption Find/copy and one matching image AX role were observed. Unmounted/offscreen indexing, complete focus/keyboard behavior, reading order, and assistive-technology behavior remain unmeasured. | Moderate and orthogonal: purpose/size keys, asynchronous derivation, object-URL lifetime, reference-aware LRU, and budgets need one owner. | **Selected as the companion image policy, not as a renderer.** |

No losing renderer remains open as an equivalent alternative.

## Runtime sets and precedence

Let each set contain Card identities except where the gesture-proxy row
explicitly contains proxy instances:

- **Visible (`V`)** — Cards whose painted Reading representation intersects
  the current viewport under the existing scene/LOD policy.
- **Preload-resident (`P`)** — `V` plus the buffered preload window,
  directional navigation look-ahead, and recently departed Cards retained by
  hysteresis. `P` is the ordinary bounded rich-DOM reading band.
- **Live owners (`L`)** — Reading-band Cards whose rich DOM is required by
  hover or activation preparation, focus, selection, editing, internal
  scrolling, pointer-gesture ownership, active media, or keyboard focus. Any
  one live owner pins the Card independently of `P`.
- **Hot-overlay proxies (`G`)** — the existing bounded **0–2 lightweight or
  invisible proxy producers** for hover/proximity transitions and pointer
  drag, resize, or connection manipulation. `G` is not rich Card DOM and never
  owns keyboard focus, an editor, internal scroll, or active media. In Reading,
  rich-Card hover or pointer ownership starts or retains the matching `L` pin;
  below Reading, `G` may preserve hover or manipulation without mounting visual
  rich DOM or entering `L`.
- **Active editors (`E`)** — Cards owning an editor or IME/composition
  session. By definition **`E ⊆ L`**; the separate name makes the
  no-editor-loss release gate explicit.
- **Safety representations (`S`)** — lightweight Board-wide painted Cards
  available outside rich-DOM residency and during rapid camera motion. They
  prevent blank regions but claim neither full Card semantics nor interaction
  authority.

The ordinary rich-DOM residency set is therefore **`P ∪ L`**, not
`P ∪ L ∪ G ∪ E`. `E` is already inside `L`; `G` is a separate bounded
proxy overlay. Pins win over reading-band eviction. `S` remains independently
available across the Board.

## Invalidation and retention contract

| Authority / set | Admission and retention | Recompute or invalidate on | Release / eviction rule |
| --- | --- | --- | --- |
| `V` | Current viewport intersection under authoritative scene/LOD membership. | Camera or viewport change; Card geometry; Reading/Overview/Map LOD transition, thresholds, occupancy, deadband, or crossfade state. | Recalculate with the scene. Leaving `V` does not immediately remove rich DOM because `P` hysteresis or `L` may retain it. |
| `P` | `V`, buffered preload, direction look-ahead, and the hysteresis tail. | Camera direction/speed, viewport, Card geometry, spatial-index result, LOD membership, buffer policy, hysteresis deadline, or camera-settlement state. | Release only after the Card is outside the active and directional buffers, hysteresis expires, settlement permits release, and the Card is not in `L`. |
| `L` | In Reading, any hover/activation-prepared, focus, selection, editing, internal-scroll, pointer-gesture-owner, active-media, or keyboard-focus lifecycle. Owners are additive. | Owner begin/end/cancel, Reading-band entry/exit, focus transfer, selection change, editor/composition lifecycle, scroll settlement, gesture settlement, media play/pause/end, Card removal, or identity replacement. Card content, theme, or geometry updates rerender the live Card but do not clear ownership. | Release only when every live owner has ended. A Reading hover/gesture owner survives until its `G` producer can no longer receive or complete the interaction; a below-Reading `G` producer creates no `L` owner. Then `P` decides ordinary residency. |
| `G` | At most two lightweight/invisible producers for hover/proximity transitions or pointer drag, resize, and connection endpoints. In Reading, a rich-Card hover/gesture producer starts or retains the matching `L` owner; below Reading it need not mount rich DOM or enter `L`. | Hover/proximity enter/leave, pointer start/move/end/cancel, LOD band, endpoint change, camera transform, Card geometry, resize dimensions, connection target, or post-gesture settlement. | Remove when proximity ends or pointer completion/cancel settles. Clear a corresponding Reading `L` owner only after first-intent or manipulation delivery is safe; below Reading there is no corresponding `L` owner to clear. |
| `E` | Active editor, caret, selection, or IME/composition session; always a subset of `L`. | Editor mount/unmount, composition start/end/cancel, focus transfer, Card deletion, content commit, and geometry/theme changes that require rerender without remounting the editor. | Leave only after the editor/composition lifecycle ends safely. Editor release removes one `L` owner, never all unrelated owners. |
| `S` | Board-wide lightweight scene representation, including regions outside `P ∪ L`. | Saved Card addition/removal, kind/appearance/theme or geometry change, scene/LOD/occupancy state, camera/viewport, and crossfade state. Content detail that `S` does not render must not create false semantic authority. | Remains available Board-wide; replace atomically with the next scene snapshot rather than evicting it as rich DOM. |
| Image renditions | Demand keyed by the authoritative saved Card asset/reference, rendition purpose, and requested display size. A visible, `P`, or `L` visual consumer may pin a demanded rendition; `E` is already within `L`. A `G` proxy alone never pins image residency unless the same Card also has a visible/preload/live visual consumer. | Saved asset reference or content change; rendition purpose; size/density demand; Card geometry; image readiness; theme when pixels depend on it; decoder failure; or cache-policy/version change. | Revoke an object URL only after the last visual consumer reference and every residency/owner pin clear. Enforce decoded and derived-rendition budgets with reference-aware LRU; never evict the authoritative saved asset/reference. |

Saved Card asset/reference and content are authoritative. Compressed byte counts
are accounting signals for storage cost; they do not identify an asset, grant
runtime ownership, or replace the saved reference. Derived keys, object URLs,
decoded surfaces, and eviction metadata are disposable runtime state.

## Activation and navigation flow

1. Ordinary navigation preloads rich DOM in `P` before Cards enter `V`;
   look-ahead follows camera direction and hysteresis prevents boundary churn.
2. In Reading, rich-Card hover, focus, or activation preparation adds the Card
   to `L` before click. The first click must reach its intended live control;
   if preparation loses the race, queue/replay the intent or provide an
   equivalent single-click route. Below Reading, `G` may retain hover/proximity
   or manipulation authority without visual rich DOM or `L` membership.
3. Once live, long Notes, Conversations, and Results retain full internal
   scrolling, links, selection, editing, keyboard navigation, and controls.
   Focus, selection, editing, scrolling, gestures, keyboard focus, and active
   media keep the Card in `L` until their lifecycles end.
4. Hover/proximity and pointer drag, resize, or connect may use `G` through
   transition or gesture settlement. In Reading, the matching rich Card starts
   or retains `L` so first intent and full interaction survive. Below Reading,
   the proxy may remain lightweight or invisible without entering `L`.
5. A rare far jump may initially show `S` while the new `P` window loads
   detailed Cards. Ordinary and exceptionally fast navigation must never expose
   blank Board regions.
6. Deactivation waits for ownership release, camera settlement, and
   hysteresis. Gradual visual handoff must not create a hit target that outlives
   its paint.

## Preserved canvas truths

This selection does not change the current Reading → Overview → Map
appearances, thresholds, deadband, occupancy behavior, or gradual crossfades.
The existing scene remains authoritative for LOD membership and occupancy.
Camera settlement continues to gate expensive release, and buffering must not
introduce a new zoom band or discontinuity. Hit-testing equals painted
interactive membership: invisible, safety-only, or faded-out representations
cannot retain unintended rich-DOM interaction authority.

## Image authority and accounting

The selected companion policy retains the saved Card asset/reference and its
content as storage truth. Runtime may derive visibility-appropriate renditions
without rewriting that model. Production evidence and gates report separately:

- compressed storage bytes as accounting, never identity or authority;
- decoded source-pixel residency;
- decoded derived-rendition residency;
- paint/upload cost for the representation actually drawn; and
- cache growth, eviction/revocation, and reuse across navigation.

Visible, preloading, and live-owner visual consumers—including editor and
active-media owners—retain their referenced rendition. A `G` proxy alone does
not retain image residency. Release requires last-reference and pin clearance.
Retain #413's 8 MiB decoded and 2 MiB derived-rendition gates
as provisional evidence thresholds, not universal device guarantees. #409 must
carry device calibration and the unexercised motion/offscreen policy branches
as explicit gates.

## Measured limitations and uncertainty

- Search, copy, link activation, keyboard operation, and accessibility-tree
  behavior are not pre-authorized sacrifices. The safety layer is not evidence
  that these capabilities work.
- #405 timing remains directional and non-blocking. It cannot establish an
  absolute activation, frame-rate, or device budget. Frame continuity,
  transient sharpness, and capture-after-image-readiness remain not measured.
- #413's persistence conclusion is confounded by fixture MIME/byte
  substitution. Its motion- and offscreen-deferral branches were not exercised.
- Available reports do not establish universal GPU upload, raster-cache,
  browser, device-memory, display-density, or low-power-device behavior.
- Far-jump sharpness and activation continuity require direct observation.
  Missing instrumentation remains `not measured`, never encoded as zero loss.

## Downstream boundaries at selection time

- **#407** reconciled this one decision with ADRs 0019, 0020, 0023, and 0024
  plus the canvas foundation. It clarified authority; the rejected renderers
  remain terminal unless new contradictory evidence appears.
- **#408** measured cold-data ROI after renderer selection. Versions,
  provenance, settings, and other cold data remain a secondary lane and cannot
  substitute for the selected residency/image policy.
- **#409** produced the agent-sized sequence and native dependency graph. The
  later #570 kickoff changed its rollout mechanics to direct shipping with
  `git revert` as rollback, while retaining never-blank navigation, first-click
  delivery, `L`/`E` ownership, bounded `G`, long-Card continuity, LOD fidelity,
  image authority, and these semantic outcomes:
  - browser Find across offscreen or unmounted Cards;
  - whole-Board selection and copy;
  - keyboard traversal across residency changes; and
  - accessibility-tree completeness and focus continuity.

Those semantic outcomes are now production through graph-derived Board search
and copy plus bounded Card focus/accessibility entry. Native browser Find still
observes mounted DOM only; that documented limitation is not counted as a
performance benefit.

This selection document itself authorized no code, persistence-format, storage,
or production-default change. The separate #570 kickoff later authorized the
direct-ship implementation. It changed no saved format or storage semantics and
introduced no renderer flag, canary, staged default, or recovery control.
