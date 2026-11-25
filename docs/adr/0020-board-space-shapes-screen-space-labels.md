# ADR 0020: Board-Space Shapes, Screen-Space Labels

Status: accepted; Reading residency and interaction authority amended by ADR 0023 and the issue #406 selection

Reconciliation note (2026-07-19): the board-space shape/screen-space label split, hit-equals-paint rule, pointer-cold scene, zero visual rich DOM below Reading, and bounded 0–2 gesture proxies remain accepted. The [Reading-band architecture selection](../../research/03-performance-architecture/19-reading-band-architecture-selection.md) replaces only the inherited assumption that visual rich-DOM residency and full interaction authority are the same set. Buffered rich DOM supplies ordinary Reading residency (`P`), production Live Card owners pin independently in `L`, and the Board-wide safety representation (`S`) prevents blank navigation. The gesture/proximity overlay (`G`) stays separate and bounded; it is not a cache of Live Cards.

Reconciliation note (2026-07-23): issue #753 made the Reading ownership partition persistent at rest when cold text weight exceeded its first 300,000-unit calibration; the field notes below supersede that ceiling and admission stop. Admitted `P`, exact-visible oversize `O`, and hot `L` own rich DOM; remaining exact-visible overflow owns painted `S` without changing the global Reading band. Hit-equals-paint means one interactive owner per Card: DOM for `P ∪ O ∪ L`, canvas candidates for `S`; complementary underlays are paint but never a second hit target. Visual `L` outside `P ∪ O` enters downstream painter occlusion and settled suppression, while invisible `G` remains excluded.

Field reconciliation note (2026-07-23): the cold ceiling is now 600,000 units and weight rejection skips only that ordered candidate; it does not end later admission. This changes neither hit authority nor painter ownership: rejected exact-visible Cards remain interactive `S`, and independently owned `L` continues to take over downstream.

Field reconciliation note (2026-07-23): up to 10 individually oversize exact-visible Cards now enter the separately accounted native `O` pool. DOM remains the sole paint/hit owner for `P ∪ O ∪ L`; remaining overflow stays interactive `S`. `O` never widens buffered or offscreen residency.

Field reconciliation note (2026-08-21): ADR 0023 now calibrates `O` strictly above 100,000 individual units with a 10-Card exact-visible cap. A 30-Card trial was withdrawn after founder testing found 30 simultaneous ~281,000-unit Cards unusable. It still shares the 540-Card terminal ceiling and never widens look-ahead, preload, or offscreen residency.

Decided in the zoom-bands rework PRD (issue #300, founder decisions 2026-07-09), executed by slice A3 (issue #306, the mount collapse) with the painter and interaction halves consumed by Lanes B and C. This ADR records how the canvas splits what scales with zoom from what does not, and the mount policy that gives every Card one authoritative representation owner inside its global fidelity band.

## Context

Before this epic, detail was board-derived: massive and text-heavy board classes gated how many real DOM cards mounted, a low-zoom placeholder budget mounted interactive stand-ins, selection promoted individual cards to full nodes at any zoom, and sticky apertures carried mounted sets through gestures. The result was the visible DOM/canvas patchwork ADR 0019 describes — two representations of the same board on screen at once — plus a mount policy whose cost scaled with board class instead of with the viewport. ADR 0019 froze the viewport-derived detail band (`reading` / `overview` / `map`); this ADR records what each band renders and how pointer state stays out of the scene.

## Decision

### Shapes live in board space; labels live in screen space

The canvas draws card **shapes** — rectangles, ports, connection curves — in board coordinates, scaled by the viewport transform: zooming out makes them smaller, exactly like a map. **Labels** (and label-like chrome: badges, selection affordances) are drawn in screen space at a readable pixel size, placed against their board-space anchors: zooming out changes which labels fit, not how big they are. This is the same split every map renderer uses, and it is why one painted tier per band can stay readable at any zoom.

### Below the Reading crossfade, zero mount

Outside the Reading↔Overview crossfade, no Overview or Map Card mounts as a visual rich-DOM node. The bounded transition is intentional. Production mounts the buffered, direction-aware, hysteretic `P` window while the zoom-pure Reading opacity is greater than zero; exact-visible Cards are the first admission tier within both the 540-Card ceiling and the 600,000-unit cumulative ordinary text-weight ceiling. `O` adds no more than 10 exact-visible native owners above the 100,000-unit individual threshold inside the same 540 count, and remaining overflow stays fully painted in `S`. `L` separately owns full Card interaction and is exempt from the cold budget. At Reading opacity zero, the Live owner state machine is disabled, rich DOM unmounts, and canvas interaction takes authority for every Card. Card-dense viewports still force Reading opacity to zero; text length never changes the band.

- The massive / text-heavy / low-zoom / sticky mount policies and below-Reading selection promotion are deleted. Selection below Reading is a painted ring (Lane B), not a mounted node.
- Read-only playback is exempt: it has no canvas overview layer to represent unmounted cards, so it keeps mounting the whole board (up to the full-detail card limit), as before.

### Hit == paint

Every interactive Card has one hit owner. Mounted `P ∪ O ∪ L` receives pointer and keyboard events from its DOM; nonmounted `S` is the scene's canvas `hitTestCandidates`, and the pane-click Card/Connection hit tests run whenever that set is non-empty. Complementary Reading crossfade bodies and motion silhouettes can paint beneath DOM owners, but are deliberately absent from canvas hit membership. A click can select any painter-owned `S` Card and can never select an invisible one (a Card past a paint cap, or a Connection past the painted-Connection cap).

### The hot/cold invariant

The scene is **cold**: `createBoardScene` is a pure function of the board graph projection and the viewport. Pointer state — hovered id, gesture participant ids, drag/connect preview — must never become a scene input (frozen by ADR 0019; this ADR adds the composition that makes that hold under gestures).

Gesture participants and Live owners are a **hot overlay** composed *after* the scene memo by the pure exported `mountPlanForScene({ scene, gestureParticipantIds, liveOwnerIds, cardById })`:

- `mountedCards` — the scene's own visual-DOM Cards plus resolvable Live owners and admitted gesture participants. A Live owner mounts as a full Card when the scene does not already contain it; a participant outside the full-Card set may mount as a proxy.
- `liveCardIds` — the caller's `liveOwnerIds` (`L`), kept separate from proxy membership. Nonempty `L` changes the mount plan even when the participant set is empty.
- `proxyCardIds` — participants only, bounded by the participant set (0–2). A participant mounts as an **invisible** React Flow proxy (Lane C): it enters `nodes` for interaction, but it does not visually occlude the canvas.
- `excludedParticipantIds` — unresolvable participants and participants beyond the 0–2 bound, surfaced rather than silently widening or disappearing from the contract.
- `paintOccludingCardIds` and `overviewSuppressedCardIds` — downstream visual-owner collections. Cold `P ∪ O` and resolvable full `L` enter occlusion; settled fully opaque `P ∪ O ∪ L` enter suppression. A proxy in `G` must never enter either set, or it would silhouette while moving and disappear when settled.
- Only when both `gestureParticipantIds` (`G`) and `liveOwnerIds` (`L`) are empty does the fast path return the scene/caller collections reference-identically. Empty `G` alone is not neutral: nonempty `L` still recomposes the mount plan downstream of the scene.

In production, these proxy instances are `G`, not `L`. `G` stays bounded to 0–2 lightweight or invisible producers and never owns keyboard focus, an editor, internal scroll, active media, or image residency by itself. In Reading, a hover or pointer producer starts or retains the matching Card's `L` owner so the first native intent or gesture completes safely. Below Reading, `G` can preserve manipulation without visual rich DOM or `L` membership.

Why this shape: passing `G` or `L` into `createBoardScene` would put hot interaction lifecycles into the cold scene and could rebuild the bounded but still high-fan-out `nodes` array on identity changes. Weight overflow means Reading `G` may now prepare a painter-owned `S` Card, and `liveOwnerIds` recomposes `mountPlanForScene` without changing `previousScene`. `G` remains bounded and downstream; `L` remains independently owner-driven and may widen visual occlusion/suppression without entering cold residency history.

## Considered Options

- Chosen: band-driven zero-mount below the Reading crossfade, complementary DOM-card/canvas-body opacity inside it, participants composed after the scene, shapes in board space, labels in screen space, hit == paint.
- Not chosen: passing `gestureParticipantIds` into `createBoardScene` — a full scene re-derivation per hover transition on a board this slice uncaps.
- Not chosen: unioning participants into the painter's visual-DOM/suppression sets — turns the moving card into a silhouette and hides it when settled.
- Not chosen: keeping a bounded DOM aperture below Reading (the board-class caps) — it is the root cause of the mixed-representation patchwork (ADR 0019), and the E1 experiment governs whether its classification machinery can also be deleted.

## Consequences

- One visual fidelity band with one owner per Card: below the Reading crossfade the canvas paints everything (Cards, Connections, selection); in Reading, `P ∪ O ∪ L` owns rich DOM and weight-overflow `S` owns paint. Inside the Reading↔Overview window, mounted Cards crossfade with inverse-opacity canvas bodies while `S` stays opaque; DOM and canvas hit authority follow that ownership partition.
- The scene digests are the behaviour proof; A3's re-pin is the large diff that shows the collapse.
- The mid-zoom mount-cap perf gates invert: below the Reading crossfade `fullDetailNodes == 0` (plus at most 2 gesture proxies); selection paints a ring, mounts nothing.
- Full-Card interaction remains available while Reading opacity is positive through `L` activation and first-intent delivery, then becomes unreachable at the zero-opacity endpoint; neither `S` nor a faded-out rich Card may remain an invisible editable target.
- Card-dense viewports above the 540 visible-Card ceiling never reach Reading and remain canvas-painted; text weight can reduce cold `P` within Reading but never changes the band.
