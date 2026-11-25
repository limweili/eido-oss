# ADR 0019: Viewport-Derived Detail Bands

Status: accepted; Reading residency and cost authority amended by ADR 0023, issue #406, and issue #753

Reconciliation note (2026-07-19): this ADR remains accepted for the visual Detail Band contract. The [Reading-band architecture selection](../../research/03-performance-architecture/19-reading-band-architecture-selection.md) first amended the inherited Reading residency and cost assumption: viewport-visible Cards (`V`) were ordinarily covered by a buffered, direction-aware, hysteretic rich-DOM resident set (`P`), bounded at the real 540-Card occupancy ceiling; a lightweight Board-wide representation (`S`) prevented blank regions while detail prepared. Interaction-owning Cards were independently pinned in downstream `L`. That change removed the old 300,000-character Board-wide eligibility cap because one long Note could demote every Card. `boardDetailTextWeight` remained observable but no longer affected the band. The 2026-07-23 note below further refines only per-Card residency; the zoom thresholds, opacity curves, deadband, settle gate, and visible-card occupancy behavior remain unchanged.

Reconciliation note (2026-07-23): issue #753 restored text-weight protection at the correct local seam. Its first slice used a deterministic, hysteretic visible-first `P` prefix and a 300,000-unit per-viewport ceiling; the field notes below supersede that calibration and admission stop. The global band still ignores text length, exact-visible overflow remains fully painted in `S`, and hot `L` is exempt. Current Reading authority is therefore native DOM for `P ∪ O ∪ L` or painter ownership for `S`. This supersedes this ADR's original same-representation-per-screen wording without changing thresholds, opacity curves, deadband, settle, or the 540-visible-Card whole-viewport demotion.

Field reconciliation note (2026-07-23): founder testing exposed head-of-line starvation in that strict prefix: one 4.8-million-unit visible Card stopped admission with only 120,363 of 300,000 units used, leaving later tiny Cards painter-owned until hover. The repaired policy retains the same tier order and prior-resident hysteresis but scans for a deterministic ordered subsequence within 600,000 units. A candidate that exceeds the remaining weight stays fully painted in `S` without starving later ordered candidates; the 540-Card count ceiling remains terminal and hot `L` remains exempt.

Field reconciliation note (2026-07-23): exact-visible Cards individually above 600,000 now have a separate hard-capped `O` pool of 10 native Card owners. `O` is viewport-local, prior-visible-first, counted inside 540, separately weighed, and unavailable to look-ahead/preload/offscreen retention. This changes individual Reading ownership only; Detail Bands and their occupancy demotion remain unchanged.

Field reconciliation note (2026-08-21): ADR 0023 now calibrates `O` strictly above 100,000 individual units with a 10-Card exact-visible cap. A 30-Card trial was withdrawn after founder testing found 30 simultaneous ~281,000-unit Cards unusable. The ordinary `P` pool remains 600,000 cumulative units; `P ∪ O` still shares 540 and Detail Bands remain unchanged.

Decided in the zoom-bands rework PRD (issue #300, founder decisions 2026-07-09), frozen by the additive band slice (issue #305), and visually retuned on 2026-07-13. This ADR is the interface contract Lanes B (painter/labels), C (interaction), D (chrome), and E (gates) consume; they reference this document, never the diff that introduced it.

## Context

Zooming a large board mixed representations at one camera height: a budget of real DOM cards mounted near the viewport centre while everything else was canvas paint, so the DOM/canvas split was visible on screen. Detail was board-derived (massive/text-heavy board classes gated rendering) instead of viewport-derived, the mid zoom range was never designed, and the old `far`/`mid`/`near`/`editing` zoom bands plus scattered canvas-tier thresholds encoded the split in several places at once.

## Decision

One global **detail band** is derived per viewport and exposed on the board scene. Every Card on screen shares that fidelity band; lifecycle ownership within Reading is budgeted per Card between rich DOM and the already-present painted safety representation. The band may change as the user navigates, and detail may finish loading only over an existing Board representation—never blank space.

### The frozen enum and thresholds

```ts
export type DetailBand = 'reading' | 'overview' | 'map' // lowercase — frozen; Lane C must use lowercase

export const READING_BAND_MIN_ZOOM = 0.325
export const MAP_BAND_MAX_ZOOM = 0.15
export const BAND_CROSSFADE_HALF_WIDTH = 0.15
```

- `READING_BAND_MIN_ZOOM = 0.325` — Reading starts here. The second visual retune places the transition 50% farther out than 0.65, while the surrounding card crossfade signals the approaching loss of editability instead of switching abruptly.
- `MAP_BAND_MAX_ZOOM = 0.15` — Map starts here; Overview spans 0.15–0.325. At 0.15 a default card is 39×18 screen px and its corner radius makes the rectangle read as a lozenge, not a card; the existing `< 0.12` painted-connection and badge caps sit wholly inside the Map band.
- `BAND_CROSSFADE_HALF_WIDTH = 0.15` — the ±15% **multiplicative** crossfade window half-width `bandCrossfade` applies to the thresholds. It yields two disjoint windows (Reading↔Overview `0.27625 → 0.37375`, Overview↔Map `0.1275 → 0.1725`), so at most two adjacent representations are ever co-visible. The zoom-pure curve and shared layer-opacity plan live in `detailBands.ts`; this ADR freezes the value, not the implementation.

Retuning any of these is a change to three named constants plus a scene-digest re-pin; nothing architectural is threshold-dependent.

### Accepted performance trade-off for the 0.325 Reading threshold

The founder accepted the `0.325` retune after interactive testing on 2026-07-13 because it places the transition at a substantially more natural navigation distance. Halving the previous `0.65` threshold doubles the board-space width and height visible at the same screen size, so a uniformly populated board can expose roughly four times as many cards. That additional full-detail opportunity is an intentional usability-over-head trade-off, not an assumption that editable DOM cards are free.

The expected product case at this camera height is materially fewer than 100 simultaneously visible Cards; reaching several hundred requires an unusually dense or overlapping layout. Visible-card occupancy remains the whole-viewport safety boundary: more than 540 visible Cards forces Reading opacity to zero and keeps the scene canvas-rendered. Text length cannot change the band. Within an admitted Reading viewport, cumulative ordinary per-Card weight bounds cold `P` at 600,000 units; separately, at most 10 exact-visible `O` Cards above 100,000 individual units may mount. Remaining overflow stays painted. The 540-Card value is a degradation ceiling, not a promise that every device will animate 540 complex editable Cards at 60 fps.

The residual risk is accepted: sparse and ordinary boards keep the more natural threshold, while pathological density degrades to Overview. If real measurements show jank below the existing occupancy ceiling, prefer an adaptive visible-card/device-capability threshold over globally moving ordinary boards back to the less natural transition distance.

### The band decider

`bandForScene` is a **pure function of `(zoom, occupancy, settleState, previousBand)`**. It hides the two zoom thresholds, the visible-card occupancy demotion, the Schmitt-trigger deadband, and the settle gate behind one scalar:

- **Nominal band:** `reading` at zoom ≥ 0.325, `map` at ≤ 0.15, `overview` between.
- **Schmitt-trigger deadband:** a band is entered at its nominal threshold but left only past the far edge of its crossfade window (Reading holds until zoom ≤ 0.27625; Map holds until zoom ≥ 0.1725), so zoom jitter on a threshold cannot flicker representations. The deadband reuses the crossfade window edges: a band flip happens exactly where its crossfade completes.
- **Occupancy demotion:** a viewport with more visible cards than the detail budget demotes Reading to Overview. Occupancy can only push toward Map, never promote.
- **Settle gate:** transition toward settled Reading detail is blocked while the viewport moves. ADR 0023 permits prepared passive detail to move immediately and finish loading after navigation, while the Board-wide safety net prevents blank frames; demotion toward Map is always allowed, so motion can never show more detail than the viewport has earned.
- **Seed (`previousBand === null`):** the nominal band from zoom **with the occupancy demotion applied**—no deadband, no settle gate. **This deliberately deviates from issue #305's written criterion**, which said "seed (`previousScene === null`) = zoom-only nominal band". The two seed readings collided with #305's unchanged-viewport stability criterion: on a Card-dense viewport at Reading zoom, a zoom-only seed can mount a first `reading` frame that occupancy rejects on the next authoritative scene derivation, tearing down detail without a viewport change. The adoption discussion cited selection as one possible same-viewport derivation trigger; that example is historical and no longer describes the current Board, where selection is explicitly excluded from scene inputs. Stability remains load-bearing, and occupancy is stateless per-frame input rather than history, so it applies at seed. The contract was amended in the open by the orchestrator: [#305 amendment comment](https://github.com/limweili/eido/issues/305#issuecomment-4934286311).
- **Re-derivation tolerance:** viewport and graph inputs may still produce a new scene at the same camera, but the decider keys deadband and settle only to authoritative viewport/settlement state—never call counts. Selection and Live ownership are composed downstream of the cold scene; they neither re-derive it nor advance `previousScene`. Same authoritative inputs therefore preserve the same band and deadband.

### The frozen scene surface (additive)

The additive scene surface introduced by this decision was:

```ts
band: DetailBand          // the single global level-of-detail step for this viewport
fullyDetailed: boolean    // current Reading-rich readiness covers every visible Card
readingCardOpacity: number // effective visual-DOM card opacity; 0 when occupancy forbids Reading
admittedDetailTextWeight: number // cold P only; hot L is exempt
oversizePassiveCardIds: ReadonlySet<string> // exact-visible O admitted outside ordinary weight
oversizePassiveTextWeight: number // separately accounted combined O weight
detailTextWeightBudget: number   // the 600,000-unit cold-residency ceiling
weightDemotedCardIds: ReadonlySet<string> // visible S left on the painter by cold residency bounds

export type CanvasDisplayPriority = 'landmark' | 'user-authored' | 'system-generated'

export type CanvasCardSummary = {
  label: string
  preview: string
  displayPriority: CanvasDisplayPriority
}
```

The old and new band models coexisted when this surface landed; that migration is complete. In production, `fullyDetailed` remains a visual-readiness signal rather than the definition of residency or interaction authority. It is false whenever exact-visible `S` remains, whether from a rare far jump or the weight boundary. `P`, `L`, the active-editor subset, and the bounded gesture-proxy overlay are separate authorities defined by ADR 0023.

`displayPriority` freezes the product meaning of a card's displayed name at the scene seam so painters and label layers never re-infer it from raw card fields: **landmark** = structural anchor (group or title card); **user-authored** = a human wrote the words the label shows (a typed title on any kind, or a note/question body the label derives from); **system-generated** = kind fallbacks ("Untitled note", "Result") and AI-produced result text. Hover and selection **override** priority at draw time (Lane B); they do not reclassify the card, so they stay out of the scene. A richer `nameSource` enum was considered and rejected: nothing in the epic consumes it, and an unused enum variant is a promise the seam must keep forever.

### The scene is pointer-cold

`createBoardScene` is a pure function of the **board graph projection and the viewport**. Pointer state — hovered id, gesture participant ids, drag/connect preview — must never become an input to it; it lives in the adapter hot path. "Cold" does not mean infrequent: viewport changes still re-derive the scene on navigation frames, so A4 separately lifts graph-wide card metrics out of this function into a viewport-independent graph metric projection. The proof obligations are counters: `sceneDerivations` (incremented once per `createBoardScene` call) proves pointer storms do not re-derive the scene; A4's `cardMetricDerivations` / `cardMetricVisits` prove viewport-only derivations do no graph-metric work.

## Considered Options

- Chosen: three viewport-derived bands with frozen thresholds, a Schmitt deadband reusing the crossfade window, occupancy demotion, a settle gate, and a frozen three-value display priority at the scene seam.
- Not chosen: keeping board-derived detail (massive/text-heavy classes gating rendering) — it is the root cause of the visible DOM/canvas patchwork.
- Not chosen: `named: boolean` on card summaries — it supplies only the bottom two of the four label tiers, forcing painters to ask `card.kind === 'group'` to find landmarks: product semantics re-inferred exactly where this seam exists to prevent it.
- Not chosen: a six-variant `CanvasNameSource` — no consumer in the epic; widen later if one appears.
- Not chosen: keying the deadband off derivation counts or `previousScene` advancing—legitimate authoritative graph or scene inputs can produce a new scene at the same camera. Selection and Live changes are downstream and must never be treated as scene progress; call-count state would make the band depend on incidental derivation history rather than its declared inputs.

## Consequences

- Lanes B/C/D/E build against `band`, `readingCardOpacity`, `fullyDetailed`, and `displayPriority` without reading scene internals; retuning thresholds cannot ripple past three constants and a digest re-pin.
- Compact scene digests continue to pin representative band, priority, connection, far-zoom, and read-only behavior. Residency itself is proven by direct `V`/`P`/`S`, occupancy, underlay, and identity invariants; the obsolete whole-Board value dumps were retired when production `P` deliberately made their old all-Cards membership false.
- At adoption, the old and new band models coexisted while consumers migrated. That rollout is complete; this sentence records history rather than an unfinished deletion contract.
- Occupancy applying at seed means a board can render its first frame in Overview at Reading zoom; this is the same trade the demotion rule makes everywhere (uniform-but-simpler beats detailed-but-mixed) and it keeps re-derivation stable.
- The Reading↔Overview window remains a deliberate cross-band exception to strict zero-mount Overview: while Reading opacity is greater than zero, admitted `P ∪ O ∪ L` rich visuals fade against inverse-opacity Overview bodies while nonmounted `S` stays fully opaque. DOM owns hits for `P ∪ O ∪ L`; canvas body hits use the `S` candidate set. Rich DOM unmounts and canvas takes authority for every Card only when Reading opacity reaches zero. Card-density-demoted scenes skip this exception and remain canvas-only.
