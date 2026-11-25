# Rich Card Production Implementation Sequence

> Status: implemented by issues #553–#561 under the separate [#570](https://github.com/limweili/eido/issues/570) kickoff on 2026-07-19. This document preserves #409's dependency and decision history. #570 superseded its planned flags, canaries, recovery controls, and future default-on step: every slice shipped directly with `git revert` as rollback. ADR 0028 superseded fixed proof ceremony: reuse authoritative slice evidence and add only proof that could change what ships. No saved-format migration occurred.

## Durable goal

Make Reading-band navigation cost depend on the bounded visual and interaction working set instead of unrelated offscreen rich content, while preserving Eido's current Reading → Overview → Map appearance, thresholds, occupancy behavior, Schmitt deadband, settle gate, complementary crossfades, graph truth, and complete Live Card behavior. Ordinary and exceptionally fast movement must expose no blank Board region; rare far jumps may briefly use the lightweight Board safety representation while rich Cards become ready.

The selected architecture is the one recorded in [19 Reading-band Architecture Selection](19-reading-band-architecture-selection.md): viewport-visible `V`, buffered/hysteretic rich-DOM preload residents `P`, independently pinned Live Cards `L`, the existing bounded 0–2 gesture proxies `G`, active editors `E ⊆ L`, and the Board-wide lightweight safety representation `S`. Ordinary rich Card DOM is `P ∪ L`; `G` is a separate interaction projection. In Reading, a rich-Card hover or gesture producer starts or retains the matching `L` pin. Below Reading, `G` may preserve lightweight/invisible manipulation without rich DOM or `L` membership.

[20 Cold-data Loading ROI](20-cold-data-roi.md) terminally selects no production cold-data split. Saved Boards remain eagerly materialized. One optional `VersionContext` lookup issue is published for traceability but remains non-blocking and planning-only; it is not part of the renderer release train.

## Frozen product and architecture contracts

- Do not retune the Reading/Overview/Map thresholds, occupancy thresholds, deadband, settle behavior, or gradual complementary crossfades.
- The saved Board graph remains authoritative; Board Scene state and runtime image renditions are derived and rebuildable.
- `S` is always lightweight and Board-wide. It guarantees representation continuity, not rich semantics or interaction authority.
- Hover begins activation. Focus, selection, editing, internal scroll, and active media pin matching rich Cards in `L`; Reading rich-Card gesture ownership does too. Below Reading, `G` may remain proxy-only.
- A click that wins the race against activation must still reach its intended link, control, editor, or other target through queued/replayed intent or an equivalent single-click path.
- Long Notes, Conversations, and Results become fully navigable and interactive when Live.
- The existing hot overlay remains bounded to 0–2 drag/resize/connect proxies. Keyboard activity belongs to `L`, never `G`.
- Image identity remains the saved Card asset/reference. Compressed storage bytes, decoded source pixels, derived-rendition residency, paint/upload cost, and cache growth are separate measurements.
- Runtime rendition work does not depend on a full reference-asset blob migration. Existing issue [#461](https://github.com/limweili/eido/issues/461) owns that separate #448/#520 compatibility lane; #409 creates no duplicate and no renderer dependency on it.
- Browser Find/search, text selection/copy, clipboard, links, keyboard/focus, and accessibility limitations are gates, not accepted losses.
- Production implementation required a separate explicit kickoff; #570 supplied it and retained every product and safety contract above.

## Dependency graph and frontier

```text
S0 cold Board Scene seam authority
├── S1 buffered P + hysteresis + never-blank S
│   └── S2 Live L/G/E activation + first intent
│       ├── S3 long rich-Card interaction
│       ├── S4 Board semantic-content access
│       ├── S5 keyboard/focus/accessibility continuity
│       └──────────────────────────────┐
└── S6 image reference → rendition    │
    └──────────────────────────────┐   │
S1 + S2 + S6 ─────────────────────┴── S7 image residency/traversal/gallery
S3 + S4 + S5 + S7 ─────────────────── S8 saved-Board compatibility/integration/docs
```

Native internal blockers are exact:

- S1 ← S0.
- S2 ← S1.
- S3, S4, and S5 ← S2.
- S6 ← S0.
- S7 ← S1 + S2 + S6.
- S8 ← S3 + S4 + S5 + S7.

At planning time the initial implementation frontier was **S0 only**. The graph then allowed S1/S6 and S3/S4/S5 to advance in parallel where live ownership remained disjoint. #570 supplied the separate kickoff, re-derived the live frontier, and the completed train preserved these native edges.

## Shared proof and invalidation policy

Existing reports and tests are reusable evidence only while the behavior, fixture, instrumentation, browser/runtime, environment, and relevant implementation seam remain equivalent. A slice names reused proof in its PR and reruns the cheapest direct behavior gate at the authoritative seam. Any change to residency membership, camera/settle state, Card geometry, LOD/crossfade policy, activation ownership, event routing, semantic access, focus order, accessibility projection, image reference/purpose/size, cache policy, fixture content, measurement instrumentation, browser major version, or hardware/software environment invalidates the affected proof and requires fresh capture.

[The canonical #402 control](14-rich-card-reading-baseline.md) mounted **131/131** rich Cards in every listed scenario while retaining zero blank and zero missing-representation frames. The retained historical [#403 evidence](15-strict-viewport-residency-candidate.md) observed ordinary/exceptionally-fast pan rich Card DOM peaks of **80/72** on that 131-Card fixture and did not exercise its 540-Card ceiling; the strict-viewport candidate is retired and non-selectable. [#413](16-image-rendition-candidate.md) observed **7.34 MiB** peak decoded residency under an **8 MiB** threshold, about **0.01 MiB** derived-rendition residency under **2 MiB**, and **52** reference-aware evictions/revocations. These are provisional structural gates, not universal device promises. Production slices may tighten them with controlled evidence but may not silently loosen them or invent replacement budgets. Cross-provider absolute timings are not thresholds.

Functional proof runs once at its direct seam on a meaningful exact head and is reused until a named invalidation occurs. Repeated structural traversals may exercise membership and lifecycle loops, but they are not CPU- or timing-authoritative. The expensive controlled repetition policy is reserved for the small named subset in the shared measurement plan.

## S0 — Make the cold Board Scene seam authoritative

**Why and demo.** Establish an inspectable cold/hot boundary. The cold Board Scene owns `V` and the graph/camera/geometry/LOD/spatial inputs from which `P` and `S` are planned. The downstream hot adapter owns `L`, `G`, and `E` lifecycles and composes them after the scene. A deterministic demo shows identical visual output while counters prove pointer-only motion does not rebuild cold scene state.

- **Blocked by:** landed reports 19 and 20. **Blocks:** S1 and S6.
- **Owned surfaces:** cold Board Scene `V`/`P`/`S` inputs and plan/types, downstream composition boundary for `L`/`G`/`E`, focused unit/behavior tests, synthetic fixture counters.
- **Protected surfaces:** saved graph/storage, Card-kind rendering, frozen LOD constants, painter geometry, React Flow boundary, pointer-cold scene derivation.
- **User-visible acceptance:** appearance, hit-equals-paint, and all current interaction behavior are unchanged. `createBoardScene` stays a pure pointer-free graph/viewport projection; hot hover, focus, selection, editor, scroll, gesture, media, and keyboard lifecycles never become scene inputs. Downstream composition keeps `G` at 0–2, preserves `E ⊆ L`, and defines ordinary rich DOM as `P ∪ L`.
- **Direct proof and invalidation:** Board Scene behavior/digest tests, pointer-storm/full-board-work counters, LOD uniformity, and overview ghosting. Scene/type/composition changes invalidate this proof.
- **Recovery outcome:** the live implementation must provide a directly testable path back to current scene and mount behavior with the same saved graph and no conversion; choose the mechanism from the code that exists when S0 starts.
- **Rollout/docs:** land the seam with unchanged mount policy; update the canvas foundation with the cold/hot authority and counters in the same PR.

## S1 — Buffered preload residency and never-blank continuity

**Why and demo.** Pan slowly, pan exceptionally fast, reverse direction, zoom, and far-jump across the synthetic rich-Card fixture. `P` uses a viewport buffer, bounded direction-aware look-ahead, and hysteresis; `S` covers every Board region. Ordinary motion shows ready rich Cards, while a rare far jump may briefly show lightweight Cards and then settle to rich detail without a blank frame.

- **Blocked by:** S0. **Blocks:** S2 and S7.
- **Owned surfaces:** `P` membership policy behind Board Scene, spatial-query inputs, camera direction/settle integration, readiness and residency counters, direct navigation gates.
- **Protected surfaces:** frozen LOD/occupancy/deadband/crossfade constants, Board painter/hit geometry, saved graph, Card content implementations.
- **User-visible acceptance:** 0 blank frames and 0 missing visible Card representations for ordinary, fast, reversal, zoom, and far-jump journeys; settled visible Reading Cards become detailed; `P` is bounded and retained by hysteresis; no interaction frame performs unrelated full-Board rich work. Treat #403's 80/72 peaks and unexercised 540 ceiling as provisional evidence, not universal promises.
- **Structural plateau gate:** after repeated ordinary/fast/reversal/return traversals and settlement, `P ∪ L` membership, admission/release churn, retained rich Card count, detached DOM, and JS heap when observable must reach a bounded steady band rather than grow monotonically. Cards outside `P` with no `L` owner release after hysteresis. This is structural lifecycle evidence only, never CPU/FPS/timing authority.
- **Direct proof and invalidation:** one deterministic functional navigation journey proves representation/readiness plus the plateau counters; only the named S1 navigation performance subset receives controlled repetition. Margin, projection, hysteresis, spatial-index, fixture, or browser changes invalidate corresponding #403 reuse.
- **Recovery outcome:** a directly testable fallback restores current Reading mounting while preserving Board-wide representation and saved state; select the live mechanism during implementation.
- **Rollout/docs:** counters first, then bounded canary; update ADRs 0019/0023 and the canvas foundation with exact policy and recovery behavior in the same PR.

## S2 — Live activation, first-intent continuity, and owner pins

**Why and demo.** Hover or focus prepares a passive Card, then the first click follows a link, operates a control, edits text, starts internal scroll, or starts media without a sacrificial click. Drag/resize/connect shows at most two lightweight proxies; Reading rich-Card participants retain the matching Live owner.

- **Blocked by:** S1. **Blocks:** S3, S4, S5, and S7.
- **Owned surfaces:** activation state machine, hover/focus preparation, first-intent queue/replay or equivalent route, additive `L` owners, editor `E`, conditional Reading gesture-to-Live bridge, lifecycle tests.
- **Protected surfaces:** `G` renderer and 0–2 bound, Card business logic, saved mutations/undo, link meaning, focus/editor semantics.
- **User-visible acceptance:** activation races deliver the first intended link/control/editor/media action exactly once; focus, selection, editing, internal scroll, and active media independently pin `L`; Reading gesture producers start/retain matching `L`; below Reading, `G` may manipulate without rich DOM or `L`; releasing one owner cannot evict a Card held by another; `E ⊆ L`; keyboard never creates `G`.
- **Structural plateau gate:** repeated hover/focus/select/edit/scroll/gesture/media activation and release cycles must leave `P ∪ L`, owner counts, activation churn, detached DOM, and JS heap when observable in a bounded steady band with no leaked pin or monotonic growth. This lifecycle loop is explicitly non-CPU- and non-timing-authoritative.
- **Direct proof and invalidation:** one direct first-intent matrix at the activation seam plus owner-lifecycle and below-Reading proxy proof. Event routing, owner enumeration, Card link/control integration, or settlement changes invalidate it.
- **Recovery outcome:** users can complete the same first interaction exactly once through a tested route that retains rich DOM when handoff is unsafe; implementation chooses the least invasive live fallback.
- **Rollout/docs:** enable by interaction family only after counters; update ADRs 0020/0023 and the canvas foundation with state transitions and conditional `G`→`L` rules.

## S3 — Complete long rich-Card interaction journeys

**Why and demo.** On synthetic giant Note, Conversation, and Result Cards, enter Live state and navigate top to bottom, follow links, select/edit content, operate anchors/follow-ups/controls, internally scroll, and use playback/media without scroll, focus, selection, or first-intent drift.

- **Blocked by:** S2. **Blocks:** S8.
- **Owned surfaces:** Live integration for long Note/Conversation/Result bodies and their representative direct browser journeys.
- **Protected surfaces:** Card data model, Markdown meaning/geometry, editor commands, Result/Conversation behavior, global residency policy.
- **User-visible acceptance:** all long content and descendant links/controls are reachable once Live; internal scrolling stays pinned; activation/re-entry preserves intended scroll/focus/selection; Result first intent reaches its target; Conversation ownership is attributable; editing and playback remain correct; no silent truncation.
- **Direct proof and invalidation:** one representative direct journey per distinct Card integration boundary, reusing S2's activation proof. Card layout, activation, scroll-container, editor, link, follow-up, or playback changes invalidate only the affected journey.
- **Recovery outcome:** an affected Card kind remains fully usable as retained Live rich DOM for the session, with saved content unchanged; the implementation selects and tests the per-kind recovery switch or route.
- **Rollout/docs:** admit one Card kind at a time; synchronize Card/canvas behavior documentation with supported Live owners and limits.

## S4 — Board semantic-content access

**Why and demo.** A synthetic Board with visible and offscreen long content proves that residency does not make words undiscoverable or uncopyable.

- **Blocked by:** S2. **Blocks:** S8.
- **Owned surfaces:** Board semantic-content access for browser Find or explicit Board search, text selection, whole-Board selection/copy, copy commands, and clipboard behavior only.
- **Protected surfaces:** links and first intent (S2/S3), keyboard/focus/accessibility (S5), saved Board schema/round trips (S8), visual residency policy (S1/S2).
- **User-visible acceptance:** behavior for offscreen/unmounted browser Find and Board search is explicit and directly proven; visible text selection stays exact; whole-Board selection/copy and clipboard operations expose intended content without silently omitting unmounted Cards. If native browser equivalence cannot be retained, an equivalent product path needs a separately approved product decision before renderer default-on.
- **Direct proof and invalidation:** one direct Find/search journey and one selection/copy/clipboard journey at the public Board seam. Semantic-index/mirror membership, DOM mounting, selection model, copy serialization, or clipboard routing invalidates the affected proof.
- **Recovery outcome:** users retain a tested path to find and copy the same intended Board content while the optimized path is disabled or bypassed; implementation chooses the live recovery mechanism.
- **Rollout/docs:** ship measured semantics before default-on; document native behavior, any approved equivalent, and measured limitations without treating them as performance wins.

## S5 — Keyboard, focus, and accessibility continuity

**Why and demo.** A keyboard-only and assistive-technology-oriented journey crosses residency boundaries, activates a Card, traverses its controls, leaves and returns, and retains predictable focus and accessible structure.

- **Blocked by:** S2. **Blocks:** S8.
- **Owned surfaces:** keyboard traversal, programmatic focus activation, focus recovery/order, accessibility-tree membership/completeness, roles/names/states, and direct AT-oriented checks.
- **Protected surfaces:** Find/search/selection/copy/clipboard (S4), link first intent (S2/S3), saved Board compatibility (S8), visual representation and painter policy.
- **User-visible acceptance:** keyboard traversal remains predictable as Cards enter/leave `P`; programmatic focus activates and pins `L`; focus never falls into an unmounted void; the accessible tree exposes required Board/Card/control content and state. Measurement alone cannot approve a loss; a limitation requires a separate product decision before default-on.
- **Direct proof and invalidation:** one representative keyboard/focus journey and one accessibility snapshot/AT-oriented seam proof. Focus order, activation routing, semantic projection, DOM membership, or role/name/state changes invalidate it.
- **Recovery outcome:** keyboard and assistive-technology users can reach and operate the same required content through a directly tested fallback with stable focus; implementation chooses the mechanism from live semantics.
- **Rollout/docs:** gate before default-on and synchronize accessibility/canvas documentation with actual behavior and known limits.

## S6 — Image reference-to-rendition resolver

**Why and demo.** Paste a synthetic image, keep its authoritative Card reference, and request purpose/size-appropriate thumbnail and Reading renditions without changing saved identity or requiring blobs. At the consumer seam, export and AI requests demonstrably receive a suitable authoritative reference, never a thumbnail or disposable derived-cache object.

- **Blocked by:** S0. **Blocks:** S7.
- **Owned surfaces:** image demand key `(saved reference, purpose, display size)`, derived resolver, paste/display integration, export/AI reference routing, resolver invalidation tests.
- **Protected surfaces:** authoritative saved Card asset/reference, existing compression compatibility, Board schema and round trips (S8), end-to-end export compatibility (S8), gallery residency (S7).
- **User-visible acceptance:** derived renditions are rebuildable and never serialized as authority; compressed bytes and decoded pixels stay separate; reference/content/purpose/size changes invalidate the right rendition; identical consumers share reference-aware work. Export and AI adapters always resolve a suitable authoritative reference and cannot receive a thumbnail, object URL, or evictable derived cache entry as source truth.
- **Direct proof and invalidation:** resolver key/invalidation tests plus direct export-consumer and AI-consumer seam assertions. Encoder, saved reference, purpose taxonomy, sizing policy, or consumer adapter changes invalidate the affected proof. Full save/reload and produced-export compatibility are reserved for S8.
- **Recovery outcome:** every image consumer can fall back to the authoritative saved reference with no data rewrite and no thumbnail substituted for export/AI; implementation selects and directly proves the route.
- **Rollout/docs:** ship resolver dark, then thumbnail/Reading purposes independently; update ADR 0024 and the canvas foundation with authority, accounting, and invalidation rules.

## S7 — Image residency, traversal, paint, and gallery activation

**Why and demo.** Traverse an image-heavy synthetic Board repeatedly, move images on/offscreen, settle, and open the gallery. The demo distinguishes paste time, first decode, decoded residency, derived bytes, paint/upload, settled sharpness, gallery readiness, and return-visit cache behavior.

- **Blocked by:** S1, S2, and S6. **Blocks:** S8.
- **Owned surfaces:** visibility-aware warming, Live/image pins, decoded/derived budgets, reference-aware LRU eviction/revocation, gallery activation, image performance instrumentation.
- **Protected surfaces:** saved reference authority and export/AI routing (S6), Card/LOD appearance, S1 residency policy, saved Board round trip/export output (S8).
- **User-visible acceptance:** no blank Card region during motion; visible/Live images settle sharp; gallery activation reuses S2's already-proven first-intent route rather than defining a second owner; offscreen and motion-deferral branches are exercised; last-reference eviction revokes safely; repeated traversal plateaus. Start with #413's provisional 8 MiB decoded and 2 MiB derived thresholds and 52 eviction/revocation events; change them only from controlled production evidence.
- **Direct proof and invalidation:** separate direct functional proof for paste/display, first decode, deferral, readiness, gallery, and eviction; only the named S7 image traversal receives controlled repeated performance runs. Reference/purpose/size keys, browser/runtime, cache budgets, fixture, or instrumentation changes invalidate proof.
- **Recovery outcome:** visible and gallery images remain usable from the authoritative reference when warming or derived caches are bypassed, and cleanup remains reference-safe; implementation chooses the live mechanism.
- **Rollout/docs:** counters → thumbnail → Reading → gallery; synchronize ADR 0024 and image/canvas operating documentation with measured limits.

## Existing deferred compatibility lane — #461

[Issue #461](https://github.com/limweili/eido/issues/461) already owns the full reference-asset blob migration in the external #448/#520 compatibility lane. #409 must not create a duplicate. #461 has no native blocking edge into S0–S8, is not a renderer-train or #471 certification prerequisite, and cannot delay S6/S7 runtime rendition gains. Its later implementation remains subject to save-safety, migration/rollback, export/AI, and representative-data compatibility gates under its own authorization.

## S8 — Integrated saved-Board compatibility and docs

**Why and demo.** One synthetic external-boundary journey loads an existing Board through the production storage adapter, changes it through the graph store, saves it, clears runtime state, reloads it, and serializes the same production Idea export. The complete Board equality check covers graph, content, outputs, runs, intent history, settings, compaction summaries, and authoritative asset references.

- **Blocked by:** S3, S4, S5, and S7. **Blocks:** packaged #471 certification. **Does not block:** #410 closeout.
- **Owned surfaces:** the saved-Board load/save/reload and export seam, its single synthetic journey, the cross-slice claim map, and final ADR/foundation/research synchronization.
- **Protected surfaces:** saved format and asset authority, frozen LOD constants, unrelated context/execution behavior, eager cold-data loading, and private save data.
- **User-visible acceptance:** synthetic existing and newly saved state round-trips without losing graph, content, or asset identity; produced exports retain authoritative references; exact-head Required is green; affected docs agree with production.
- **Direct proof and invalidation:** the one compatibility journey is invalidated only by SavedBoard normalization/schema, store load/snapshot/save, the disk API envelope, export serialization, or CardAsset authority. Renderer claims reuse their owning slice proof until one of those primitives changes.
- **Honest absence:** current integration adds no authoritative JS-heap, detached-DOM, native decoder/GPU/upload, or controlled timing signal. Those remain `not-measured`; S0–S7's structural counters and direct seam proof are not repeated.
- **Shipping:** S8 lands directly as the production renderer integration. There is no release control, staged default, or recovery path beyond `git revert`.

## Epic claim-to-proof map

| Epic claim | Owning slice | Required direct proof |
| --- | --- | --- |
| Current detail bands and gradual crossfades are unchanged | S0, S1 | LOD uniformity and exact thresholds/opacity assertions |
| Ordinary and fast movement never shows blank Board regions | S1 | slow/fast/reversal/far-jump representation and readiness proof |
| Rich DOM is bounded to `P ∪ L`; `G` stays 0–2 | S0–S2 | set counters, plateau gates, and pointer/gesture proof |
| First intent, links, controls, and all Live owners are correct | S2, S3 | activation matrix, conditional owner proof, long-Card journeys |
| Long Notes, Conversations, and Results remain fully navigable | S3 | scroll/edit/link/control/follow-up/playback journeys |
| Find/search/selection/copy/clipboard do not hide content | S4 | direct Board semantic-content access journeys |
| Keyboard/focus/accessibility continuity survives residency | S5 | keyboard/focus and accessibility seam proof |
| Image authority never leaks to derived thumbnails for export/AI | S6, S8 | consumer seam assertions plus integrated export compatibility |
| Image decode/residency/paint/traversal are bounded separately | S7 | staged image proof, controlled traversal, eviction/revocation |
| Saved Boards and authoritative exports remain compatible | S8 | one synthetic load/save/reload/export journey |
| Cold-data work does not distract from the render path | S8 | eager `SavedBoard`; O1 optional; no cold-split issue |

## Shared risk-led test and measurement plan

1. Use deterministic synthetic, privacy-safe fixtures only. Never inspect or run against a real Eido save for S0–S8.
2. Prove shared primitives once at their authoritative seam and reuse that proof until a relevant implementation, fixture, environment, or contract change invalidates it.
3. S8 adds one external-boundary load/save/reload/export journey. It does not repeat browser composition, navigation, activation, semantic, accessibility, or image-lifecycle journeys because the integration slice did not change those primitives.
4. S1 and S7 retain their controlled structural/performance evidence. S8 does not repeat it absent a named invalidation; proof volume is not a substitute for changed risk.
5. Unavailable structural, heap, detached-DOM, native decoder/GPU/upload, and controlled timing signals remain `not-measured`, never zero or green. Do not build a second evidence system to manufacture them.
6. Run the repository's Required gate at a frozen production PR head and verify the hosted Required check at that exact head. Investigate a relevant red check once; checks ending in `(non-blocking)` retain their optional status.

## Required release handoff to #448 and packaged certification #471

The [#409 owner amendment](https://github.com/limweili/eido/issues/409#issuecomment-4993181295) makes tracker publication fail closed. Closing #409, retaining a prototype branch, or enabling an experiment flag cannot satisfy #471. Before #409 closes, actual planning issues for S0–S8 and O1 must exist, the native edges below must be verified, S0–S8 must be native blockers of #471, and #448 must record required/excluded work in the release manifest. The [published #448 renderer manifest](https://github.com/limweili/eido/issues/448#issuecomment-5010962971) records that classification. Empty, placeholder-only, or unresolved fan-out cannot close #409.

### Selected architecture and decision evidence

The only selected architecture is [report 19](19-reading-band-architecture-selection.md), reconciled by ADRs 0019, 0020, 0023, and 0024 and the canvas foundation: buffered/hysteretic rich DOM `P ∪ L`, separate bounded `G`, Board-wide `S`, and reference-authoritative visibility-aware image renditions. [Report 20](20-cold-data-roi.md) supplies the explicit no-change evidence for eager `SavedBoard` loading.

### S8 closeout evidence policy

S8 records the exact slice heads and authoritative proof for S0–S7, its one compatibility journey, and the frozen-head Required result. Structural or performance signals absent from those owning seams remain `not-measured`; S8 does not recreate them. Packaged release evidence remains owned by #471.

### Fail-closed tracker publication and classification

The published tracker units and their verified release relationships are recorded below.

| Unit | Tracker issue | Native blocked by | Release class and #471 treatment |
| --- | --- | --- | --- |
| S0 cold Board Scene seam | [#553](https://github.com/limweili/eido/issues/553) | none | **Release-blocking**; native #471 blocker |
| S1 buffered residency/safety | [#554](https://github.com/limweili/eido/issues/554) | S0 | **Release-blocking**; native #471 blocker |
| S2 activation/first intent | [#556](https://github.com/limweili/eido/issues/556) | S1 | **Release-blocking**; native #471 blocker |
| S3 long rich Cards | [#557](https://github.com/limweili/eido/issues/557) | S2 | **Release-blocking**; native #471 blocker |
| S4 Board semantic-content access | [#558](https://github.com/limweili/eido/issues/558) | S2 | **Release-blocking**; native #471 blocker |
| S5 keyboard/focus/accessibility | [#559](https://github.com/limweili/eido/issues/559) | S2 | **Release-blocking**; native #471 blocker |
| S6 image reference→rendition resolver | [#555](https://github.com/limweili/eido/issues/555) | S0 | **Release-blocking**; native #471 blocker |
| S7 image residency/traversal/gallery | [#560](https://github.com/limweili/eido/issues/560) | S1 + S2 + S6 | **Release-blocking**; native #471 blocker |
| S8 compatibility/integration/docs | [#561](https://github.com/limweili/eido/issues/561) | S3 + S4 + S5 + S7 | **Release-blocking**; native #471 blocker |
| O1 optional `VersionContext` lookup | [#562](https://github.com/limweili/eido/issues/562) | none; no edge into S0–S8 | **Optional / excluded**; never a #471 blocker |
| Cold-data payload split | no issue by decision | n/a | **No change / excluded**; report 20 found no safe, useful split |
| Existing blob migration | [#461](https://github.com/limweili/eido/issues/461) | external #448/#520 lane only | **Deferred external compatibility work**; no duplicate and no renderer/#471 dependency |

S0–S8 and O1 were published as planning-only work. #570 later supplied the separate implementation kickoff and re-derived files, CI, proof currency, and parallel safety from live main.

#570 superseded the planned per-slice recovery controls with direct shipping and `git revert`; the saved Board format remained unchanged.

## Historical issue publication contract

Before #409 closed, it required:

1. Create actual S0–S8 release-blocking subissues and the optional O1 issue, and record every actual issue link in the table above.
2. Add the exact native internal blockers from the graph and verify them live.
3. Add S0–S8 individually as native blockers of #471; exclude O1, the no-change cold split, and #461.
4. Apply `needs-triage`, state planning-only in every issue, and forbid implementation until a separate kickoff.
5. Copy the slice's why, observable outcome, owned/protected scope, direct proof and invalidation boundary, and recovery outcome. Choose the concrete recovery mechanism only after inspecting the live implementation.
6. Re-derive file ownership because `Board.tsx`, `boardScene.ts`, fixtures, and browser configuration cannot be assumed parallel.

## #409 acceptance audit

- Board Scene seam begins the serial spine: S0.
- Nine narrow, demoable, fresh-context production slices: S0–S8.
- Native blocker graph and frontier: exact dependency section plus tracker-publication table.
- Performance evidence is derived from #402/#403/#413 and retained at its S1/S7 owning seams; S8 adds no redundant performance journey.
- Frozen fidelity, appearance, editing, links, first intent, gestures, and playback: contracts plus S0–S3/S8.
- Find/search/text selection/copy/clipboard: S4 only.
- Keyboard/focus/accessibility continuity: S5 only.
- Image reference authority, export/AI routing, residency, gallery, and traversal: S6/S7, integrated by S8.
- `P ∪ L` retention/churn and owner lifecycle: S1/S2, explicitly non-timing-authoritative; unavailable heap/detached-DOM signals remain `not-measured`.
- Saved-Board round trip and produced-export compatibility: S8.
- Cold-data split omitted as an explicit no-change; O1 is optional; existing #461 is external and non-blocking.
- Documentation/ADR synchronization is paired with S0/S1/S2/S6/S7 and audited in S8.
- S8 closes direct renderer integration and remains a #471 blocker, never a #410 closeout blocker.
- Fail-closed issue publication and native #471 blockers were required before #409 closed.

## Boundary

#409 completed planning after the S0–S8/O1 tracker publication above was verified. #570 separately authorized the direct renderer implementation without LOD retuning, a cold-data split, or a blob migration. S8 integrates that production train without a flag or future default step and remains a blocker of packaged #471 certification, never #410 closeout.
