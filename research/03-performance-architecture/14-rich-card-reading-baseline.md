# Rich Card Reading baseline (#402)

Status: **baseline evidence only — No renderer winner and no renderer/LOD policy change.**

## Reproduce

Regenerate this report from the retained raw browser artifact with `npm run perf:report`.
Capture command(s): `npm run perf:rich-card:capture`. Raw schema/contract: `2` / `eido-rich-card-reading-v1`.

## Environment and noise

- Provider: github-actions; OS: linux 6.17.0-1018-azure; CPU: AMD EPYC 9V74 80-Core Processor; logical cores: 2; memory: 8323981312 bytes.
- Browser: Chromium 149.0.7827.55; viewport: 1440×1000 @ 1; Node: v20.20.2.
- Commit: `1e8900fb38432b00f807c45125395baf634483f1`; captured: 2026-07-14T13:12:56.132Z.
- Shared hosted runner: true. Repeated timing distributions are comparative evidence, not a stable absolute machine budget.
- Noise caveat: GitHub-hosted runners are shared and not a stable same-machine timing gate; three repetitions expose spread but do not remove host noise.
- Noise caveat: Chromium headless paint/composite behavior and software/GPU availability can differ from the managed Mac product environment.
- Noise caveat: The harness records observed JS heap and trace events; it cannot observe GPU texture residency or production React work without new instrumentation.

## Frozen workload

The candidate-neutral `rich-card-board-v1` contains 131 Cards, 132 Connections, and 2 Outputs. Each of 16 scenario IDs runs 3 times in scenario-major order. Choreography is frozen in `RICH_CARD_BENCHMARK_CONTRACT` for #403/#404/#405/#413.

## Observed browser metrics

| Scenario | median duration ms | p95 frame interval ms | slow frames | long tasks | peak Card DOM | style/layout ms | paint/composite ms | blank/missing frames | detailed ready ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| ordinary-reading-pan | 1721.5 | 166.6 | 57 | 42 | 131 | 290.8 | 111.0 | 0/0 | 650.2 |
| exceptionally-fast-pan | 810.6 | 150.0 | 26 | 14 | 131 | 232.4 | 37.5 | 0/0 | 529.1 |
| rapid-zoom-out | 930.5 | 166.7 | 21 | 13 | 131 | 217.9 | 111.0 | 0/0 | 499.0 |
| direction-reversal | 2461.2 | 150.1 | 82 | 43 | 131 | 528.6 | 142.6 | 0/0 | 467.6 |
| rare-far-programmatic-jump | 426.9 | 133.3 | 13 | 11 | 131 | 35.9 | 49.0 | 0/0 | 427.0 |
| post-gesture-settle | 1393.8 | 166.6 | 37 | 27 | 131 | 243.3 | 75.4 | 0/0 | 592.3 |
| card-body-scroll | 3710.3 | 150.0 | 82 | 67 | 131 | 594.4 | 442.1 | 0/0 | 583.6 |
| selection | 754.5 | 400.0 | 12 | 12 | 131 | 148.7 | 81.2 | 0/0 | 580.9 |
| hover-before-click | 861.5 | 366.7 | 16 | 15 | 131 | 149.0 | 88.5 | 0/0 | 149.9 |
| click-before-activation | 893.4 | 383.4 | 17 | 12 | 131 | 149.7 | 96.1 | 0/0 | 152.8 |
| editing-activation | 895.5 | 383.2 | 16 | 11 | 131 | 152.7 | 91.4 | 0/0 | 138.6 |
| typing | 5905.1 | 183.4 | 105 | 164 | 131 | 717.0 | 630.5 | 0/0 | 150.9 |
| dragging | 2024.5 | 166.7 | 47 | 44 | 131 | 227.2 | 165.7 | 0/0 | 634.3 |
| connecting | 1094.9 | 116.7 | 34 | 16 | 131 | 223.4 | 96.3 | 0/0 | 251.4 |
| cold-image-traversal | 615.3 | 250.0 | 12 | 13 | 131 | 140.8 | 79.6 | 0/0 | 511.9 |
| warm-image-revisit | 381.5 | 149.9 | 4 | 6 | 131 | 95.5 | 15.2 | 0/0 | 223.6 |

Lightweight representation readiness and blank/missing frames are reported separately from detailed readiness. Interaction latency, memory deltas, image decode/readiness, and Board work remain in the raw per-run records rather than being collapsed into one score.

## Images: observed versus estimated

### Deterministic estimates

Observed browser measures: first/warm image decode duration/count, settled image readiness, JS heap, trace paint/composite, and cold-versus-warm traversal after a Chromium cache clear. Stored image payload (2375 bytes), Board JSON (360372 bytes), and serialization (0.66ms) are deterministic fixture measures. Decoded-pixel residency (51019524 bytes) is a deterministic width × height × 4 estimate based on the fixture's actual SVG/PNG dimensions, not an observed GPU allocation. Decoded-image/cache-growth bytes are explicitly unavailable because JS heap excludes native decoder and GPU caches. Ingestion/compression is **unavailable**: fixture data URLs are prebuilt deterministically; production paste compression is not invoked or timed. Blob storage or migration is not required or measured here.

## Search, selection, copy, and accessibility observations

- Search: **observed**, found=true. window.find over the mounted synthetic giant Note.
- Selection: **observed**, selected characters=20. DOM Selection matched a non-whitespace substring rendered by the live synthetic giant Note editor.
- Clipboard copy: **unavailable**, copied characters=unavailable. System clipboard copy was not invoked or read by this browser harness.
- Accessibility: **observed**, rich-text AX nodes=626. Chromium Accessibility.getFullAXTree static-text count; not a complete assistive-technology audit.

## Ranked, falsifiable cost profile

Scores are a predeclared ordinal evidence grade: 3 = direct/strong signal, 2 = suggestive proxy, 1 = observed but inconclusive. The rank never compares milliseconds with counts and does not select a candidate.

| Rank | contributor | evidence score | evidence | falsification |
| ---: | --- | ---: | --- | --- |
| 1 | whole-board-residency | 3.0 | Peak resident Card DOM was 131/131 Cards (100.0%). | Repeat unchanged choreography with bounded residency; this contributor falls if offscreen Card DOM and memory scale with the viewport instead of Board size. |
| 2 | rich-markdown-transcript-materialization | 2.0 | Worst observed detailed readiness across rich-body activation/scroll/image entry was 583.6ms, with 91 long tasks. Baseline-only attribution is suggestive, not causal. | Hold residency constant and replace only passive rich bodies with inert equivalents; the contributor falls if readiness, long tasks, and style/layout remain unchanged. |
| 3 | style-layout-paint | 2.0 | Observed CDP/trace deltas totalled 4147.4ms style/layout and 2313.0ms paint/composite (8.6% of measured scenario duration). | Hold scripting and DOM population constant while isolating visual containment; the contributor falls if frame gaps do not track reduced rendering time. |
| 4 | store-invalidation | 2.0 | Board observability reported 10692 Card-metric visits (81.6 Board equivalents); React work is unavailable, so this remains a proxy. | Repeat typing and selection with scoped store subscriptions; the contributor falls if Card-metric visits disappear without improving interaction latency or React work. |
| 5 | graph-wide-derivation | 1.0 | Board Scene observability reported 584 derivations across the frozen workload, but no isolated timing attribution exists in this baseline. | Memoize graph-invariant derivations while preserving camera updates; the contributor falls if derivation counts drop but frame/interaction distributions do not. |

## Unavailable instrumentation ledger

- React work: **unavailable**. The production root exposes no React Profiler timing and forbidden Card/renderer instrumentation was not added. Follow-up: Add a benchmark-only Profiler at the application root or a React-supported performance track, then populate the existing reactWork field without changing this schema or renderer policy.
- GPU texture residency and compositor-only time are not directly exposed by this harness. Decoded pixels are explicitly estimated; trace paint/composite is observed main-thread/browser work, not a GPU-memory reading.
- Search, DOM selection, clipboard copy, and accessibility tree completeness are not performance-waived. This baseline measures current DOM selection separately from clipboard copy, which remains explicitly unavailable until a harness invokes and reads it.

## Interpretation boundary

No renderer winner. This artifact characterizes the current Reading implementation only. It does not implement buffered residency, activation/pinning, event replay, image renditions, a far-jump fallback, or any migration. Existing Reading/Overview/Map thresholds, occupancy, deadband, settle behavior, representations, and crossfades are unchanged.
