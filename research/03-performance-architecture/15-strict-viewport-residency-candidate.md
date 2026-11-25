# Strict viewport Card residency candidate (#403)

Status: **retained historical evidence — the candidate, workflow, and report harness are removed.**

## Historical evidence lineage

The #403 run compared strict viewport residency with the frozen #402 baseline on
the exact tested commit recorded below. Its synthetic artifact and measurements
remain as historical decision evidence; no current command can recapture or
refresh this candidate because the candidate source, dedicated workflow, and
publication/report harness were retired after the buffered native-DOM residency
architecture was selected.

- Frozen #402 baseline: [provider run](https://github.com/limweili/eido/actions/runs/29335289304) at <code>1e8900fb38432b00f807c45125395baf634483f1</code>.
- Fresh #403 provider run: [provider run](https://github.com/limweili/eido/actions/runs/29347243906) at exact tested commit <code>79803eeaeae23dbda385a8d4afde2e23c56b6721</code>; provider <code>github-actions</code>, runner <code>GitHub Actions 1000000662</code>, captured 2026-07-14T15:56:05.798Z, linux 6.17.0-1018-azure, Chromium 149.0.7827.55.
- Fresh artifact: id <code>8316686511</code>, name <code>rich-card-residency-candidate-79803eeaeae23dbda385a8d4afde2e23c56b6721</code>, archive digest <code>sha256:cf2db0dddfbf200b5f08e6e3b2364036dcbafa03951e334a84f1cb5852d6d181</code>.
- Historical raw payload SHA-256: <code>f6419ca683a62a619e5472fce2ac2a172eee226829a5542fdf6ac8146fea894b</code> (the raw payload is no longer checked into the repository).

## Fixed controls and privacy

Both artifacts use schema <code>2</code>, contract <code>eido-rich-card-reading-v1</code>, fixture <code>rich-card-board-v1</code> (131 Cards, 132 Connections, 2 Outputs), 48 runs, the same 16 scenario IDs, exact scenario-major ordering, and three repetitions. The payload contains benchmark metadata and measurements only; the fixture is deterministic and synthetic, the schema privacy scan passed, and no real save path or real-user content is present.

The candidate uses a 900px symmetric preload margin, 1350px retention hysteresis, 900px direction projection with a 450px query margin, and a 540-Card resident-DOM ceiling. The 131-Card fixture did not exercise that ceiling. Exact viewport visibility, resident DOM membership, activation ownership/pinning, gesture participation, and lightweight safety coverage remain separate sets. These set names do not imply distinct resident and live renderers. All queries use the spatial render index, including small Boards.

Baseline and candidate ran on separate shared GitHub-hosted runners. Timing changes are comparative cross-run signals, not same-machine causal proof or stable budgets.

## Fixture and storage preparation comparison

These values come directly from each artifact's fixture record. Generation and serialization are single provider observations rather than repeated scenario distributions; their cross-run timing change is disclosed but is not causal evidence.

| Signal | #402 baseline | #403 candidate | change |
| --- | ---: | ---: | ---: |
| Fixture generation ms | 23.2 | 18.2 | -21.8% |
| Cards | 131 | 131 | +0.0% |
| Connections | 132 | 132 | +0.0% |
| Outputs | 2 | 2 | +0.0% |
| Board JSON bytes | 360372 | 360372 | +0.0% |
| Fixture serialization ms | 0.7 | 1.3 | +103.0% |
| Stored image bytes | 2375 | 2375 | +0.0% |
| Decoded-pixel estimate bytes | 51019524 | 51019524 | +0.0% |

Fixture serialization increased 0.7 → 1.3 (+103.0%), while fixture generation improved 23.2 → 18.2. Board JSON, stored-image bytes, and decoded-pixel estimate remained fixed.

## Aggregate comparison

Every additive aggregate below sums the raw run values and rounds only for display. P95 and worst values are recalculated directly from the raw runs.

| Signal | #402 baseline | #403 candidate | change |
| --- | ---: | ---: | ---: |
| Total observed scenario duration ms | 74876.1 | 68009.5 | -9.2% |
| Pooled p95 frame interval ms | 166.8 | 133.4 | -20.0% |
| Slow frames | 581 | 557 | -4.1% |
| Missed frames | 2875 | 2395 | -16.7% |
| Long tasks | 510 | 400 | -21.6% |
| Long-task duration ms | 51588.0 | 40795.0 | -20.9% |
| Peak resident Card DOM | 131 | 126 | -3.8% |
| Style/layout proxy ms | 4147.4 | 3671.3 | -11.5% |
| Paint/composite proxy ms | 2313.0 | 1930.6 | -16.5% |
| Peak observed JS heap growth bytes | 84229640 | 106696644 | +26.7% |
| Blank frames | 0 | 0 | unavailable |
| Missing-representation frames | 0 | 0 | unavailable |
| Worst lightweight readiness ms | 1490.1 | 1204.0 | -19.2% |
| Worst detailed readiness ms | 650.2 | 674.6 | +3.7% |
| Worst settled-image readiness ms | 552.4 | 377.5 | -31.7% |
| Board Scene derivations | 584 | 594 | +1.7% |
| Card-metric visits | 10692 | 10692 | +0.0% |
| Decoded-image count | 54 | 54 | +0.0% |
| Image decode ms | 195.6 | 243.7 | +24.6% |
| Image-cache growth bytes | unavailable | unavailable | unavailable |

JS heap excludes native DOM, decoded images, compositor surfaces, and GPU textures. Image-cache growth is unavailable in both artifacts, so neither JS heap nor the cache field establishes total media residency.

### Aggregate adverse signals

These are all aggregate signals whose fresh candidate value is numerically higher in an adverse direction; no materiality threshold was applied.

| Signal | #402 baseline | #403 candidate | change |
| --- | ---: | ---: | ---: |
| Peak observed JS heap growth bytes | 84229640 | 106696644 | +26.7% |
| Worst detailed readiness ms | 650.2 | 674.6 | +3.7% |
| Board Scene derivations | 584 | 594 | +1.7% |
| Image decode ms | 195.6 | 243.7 | +24.6% |

## Measured takeaways and material regressions

- Peak resident Card DOM fell from 131/131 to 126/131 Cards (-3.8%), with 0 blank and 0 missing-representation frames. The peak change is only -3.8% on this 131-Card fixture, the 540-Card ceiling was not exercised, and the far-jump peak remained 126; this is not a whole-Board scaling proof.
- Aggregate long tasks, slow/missed frames, total long-task time, style/layout, and paint/composite improved, but aggregate peak JS heap growth increased 84229640.0 → 106696644.0 (+26.7%), worst detailed readiness increased 650.2 → 674.6, Board Scene derivations increased 584 → 594, and observed image decode time increased 195.6 → 243.7 (+24.6%).
- Rare far jump is the clearest navigation regression: median duration 426.9 → 671.8, p95 frame interval 133.3 → 166.7, slow frames 13 → 18, missed frames 50 → 88, long tasks 11 → 21, long-task time 765.0 → 1540.0, style/layout 35.9 → 106.8, and median interaction latency 304.3 → 445.6.
- Direction reversal regressed median duration 2461.2 → 2708.4, long tasks 43 → 55, long-task time 4321.0 → 5321.0, and style/layout 528.6 → 598.2. Rapid zoom-out also regressed p95 frame interval 166.7 → 183.4, missed frames 86 → 106, and long-task time 1539.0 → 1777.0.
- Memory signals are mixed and potentially material: typing peak JS heap growth increased 84229640 → 106696644, while card-body-scroll changed from -36366260 to 62310904 bytes. These are Chromium JS-heap signals, not DOM/native/GPU totals, and the raw image-cache-growth field remains unavailable.
- Image decode time regressed for both cold traversal (94.5 → 115.5) and warm revisit (101.2 → 128.2). Warm settled-image readiness was effectively flat but slightly higher (266.8 → 266.9); detailed readiness improved for both image scenarios.

The tables and ledger below disclose every reported scenario metric, including small adverse movements. Cross-run noise means a numeric increase is a signal to retain, not causal proof that residency produced it.

## Scenario comparison: responsiveness

Arrows are #402 baseline → #403 candidate. Duration and interaction are three-run medians; frame p95 pools raw intervals; slow/missed frames, long-task count, and long-task duration sum the three raw repetitions.

| Scenario | median duration ms | p95 frame interval ms | slow/missed frames | long tasks / duration ms | median interaction ms |
| --- | ---: | ---: | ---: | ---: | ---: |
| ordinary-reading-pan | 1721.5 → 1429.8 | 166.6 → 116.6 | slow 57 → 56; missed 183 → 131 | 42 → 26 / 3537.0 → 2427.0 | 1352.6 → 1140.3 |
| exceptionally-fast-pan | 810.6 → 539.4 | 150.0 → 116.6 | slow 26 → 11; missed 89 → 42 | 14 → 11 / 1402.0 → 818.0 | 438.8 → 333.6 |
| rapid-zoom-out | 930.5 → 925.7 | 166.7 → 183.4 | slow 21 → 22; missed 86 → 106 | 13 → 14 / 1539.0 → 1777.0 | 832.6 → 867.0 |
| direction-reversal | 2461.2 → 2708.4 | 150.1 → 133.3 | slow 82 → 85; missed 249 → 268 | 43 → 55 / 4321.0 → 5321.0 | 867.9 → 884.0 |
| rare-far-programmatic-jump | 426.9 → 671.8 | 133.3 → 166.7 | slow 13 → 18; missed 50 → 88 | 11 → 21 / 765.0 → 1540.0 | 304.3 → 445.6 |
| post-gesture-settle | 1393.8 → 1107.5 | 166.6 → 100.0 | slow 37 → 30; missed 124 → 67 | 27 → 14 / 2276.0 → 1210.0 | 1326.2 → 1047.0 |
| card-body-scroll | 3710.3 → 3437.3 | 150.0 → 116.8 | slow 82 → 75; missed 382 → 327 | 67 → 52 / 6594.0 → 5270.0 | 99.3 → 89.5 |
| selection | 754.5 → 726.2 | 400.0 → 400.0 | slow 12 → 11; missed 102 → 96 | 12 → 11 / 1723.0 → 1572.0 | 693.5 → 655.4 |
| hover-before-click | 861.5 → 791.6 | 366.7 → 366.7 | slow 16 → 15; missed 106 → 93 | 15 → 9 / 1771.0 → 1361.0 | 756.3 → 688.4 |
| click-before-activation | 893.4 → 856.9 | 383.4 → 416.6 | slow 17 → 17; missed 111 → 102 | 12 → 7 / 1740.0 → 1580.0 | 780.6 → 750.5 |
| editing-activation | 895.5 → 840.7 | 383.2 → 416.7 | slow 16 → 15; missed 108 → 101 | 11 → 9 / 1646.0 → 1542.0 | 768.6 → 716.9 |
| typing | 5905.1 → 4755.8 | 183.4 → 133.4 | slow 105 → 98; missed 818 → 604 | 164 → 105 / 16203.0 → 9930.0 | 5000.3 → 3893.0 |
| dragging | 2024.5 → 1990.5 | 166.7 → 166.6 | slow 47 → 54; missed 269 → 253 | 44 → 45 / 4732.0 → 4522.0 | 1939.8 → 1874.8 |
| connecting | 1094.9 → 974.4 | 116.7 → 50.1 | slow 34 → 37; missed 101 → 62 | 16 → 7 / 1448.0 → 697.0 | 856.3 → 713.6 |
| cold-image-traversal | 615.3 → 402.4 | 250.0 → 166.6 | slow 12 → 8; missed 71 → 35 | 13 → 8 / 1366.0 → 746.0 | 546.5 → 332.7 |
| warm-image-revisit | 381.5 → 374.4 | 149.9 → 133.3 | slow 4 → 5; missed 26 → 20 | 6 → 6 / 525.0 → 482.0 | 250.2 → 233.6 |

## Scenario comparison: residency, rendering, memory, readiness

Rendering proxies sum raw repetitions. Peak/worst values are raw maxima. Readiness is lightweight/detailed/settled-image milliseconds.

| Scenario | peak DOM | style/layout ms | paint/composite ms | max JS heap growth bytes | worst readiness ms (light/detail/image) |
| --- | ---: | ---: | ---: | ---: | ---: |
| ordinary-reading-pan | 131 → 80 | 290.8 → 253.0 | 111.0 → 79.5 | 19211940 → 23213528 | 1490.1 → 1204.0 / 650.2 → 492.6 / unavailable → unavailable |
| exceptionally-fast-pan | 131 → 72 | 232.4 → 178.4 | 37.5 → 22.7 | 39811408 → 6561828 | 1362.1 → 1012.2 / 529.1 → 385.9 / unavailable → unavailable |
| rapid-zoom-out | 131 → 103 | 217.9 → 228.7 | 111.0 → 87.9 | 31751508 → 2536420 | 1259.8 → 611.5 / 499.0 → 370.4 / unavailable → unavailable |
| direction-reversal | 131 → 96 | 528.6 → 598.2 | 142.6 → 112.4 | 61444696 → 26235792 | 471.5 → 374.4 / 467.6 → 415.0 / unavailable → unavailable |
| rare-far-programmatic-jump | 131 → 126 | 35.9 → 106.8 | 49.0 → 44.7 | 12838928 → 13610372 | 636.2 → 641.0 / 427.0 → 430.5 / unavailable → unavailable |
| post-gesture-settle | 131 → 80 | 243.3 → 198.6 | 75.4 → 52.9 | 30797888 → 4999936 | 1381.7 → 984.3 / 592.3 → 417.7 / unavailable → unavailable |
| card-body-scroll | 131 → 96 | 594.4 → 525.3 | 442.1 → 435.4 | -36366260 → 62310904 | 1380.5 → 973.5 / 583.6 → 510.6 / unavailable → unavailable |
| selection | 131 → 80 | 148.7 → 124.8 | 81.2 → 73.7 | 39312040 → 21479876 | 1008.2 → 737.1 / 580.9 → 470.3 / unavailable → unavailable |
| hover-before-click | 131 → 80 | 149.0 → 121.0 | 88.5 → 75.2 | 40171400 → 10156456 | 619.3 → 508.1 / 149.9 → 119.9 / unavailable → unavailable |
| click-before-activation | 131 → 80 | 149.7 → 126.7 | 96.1 → 84.2 | 33313528 → 27606116 | 611.9 → 527.1 / 152.8 → 159.8 / unavailable → unavailable |
| editing-activation | 131 → 80 | 152.7 → 130.0 | 91.4 → 79.6 | 32161444 → 6875588 | 640.4 → 503.0 / 138.6 → 117.4 / unavailable → unavailable |
| typing | 131 → 80 | 717.0 → 530.3 | 630.5 → 494.8 | 84229640 → 106696644 | 721.2 → 669.1 / 150.9 → 179.5 / unavailable → unavailable |
| dragging | 131 → 100 | 227.2 → 201.8 | 165.7 → 153.6 | 63094356 → 12203056 | 1077.6 → 1050.6 / 634.3 → 674.6 / unavailable → unavailable |
| connecting | 131 → 100 | 223.4 → 120.4 | 96.3 → 96.7 | 27677856 → 25640488 | 811.5 → 825.3 / 251.4 → 235.7 / unavailable → unavailable |
| cold-image-traversal | 131 → 88 | 140.8 → 123.3 | 79.6 → 23.9 | 31651784 → 18811236 | 0.0 → 0.0 / 511.9 → 327.8 / 552.4 → 377.5 |
| warm-image-revisit | 131 → 88 | 95.5 → 103.9 | 15.1 → 13.7 | 25338172 → 4472672 | 0.0 → 0.0 / 223.6 → 214.6 / 266.8 → 266.9 |

## Scenario comparison: Board work, images, safety

Image values are decoded count/decode milliseconds. Cache growth is explicitly unavailable when the harness emitted <code>null</code>.

| Scenario | Scene derivations | Card-metric visits | image count/decode ms | image-cache growth bytes | blank/missing frames |
| --- | ---: | ---: | ---: | ---: | ---: |
| ordinary-reading-pan | 84 → 78 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| exceptionally-fast-pan | 20 → 18 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| rapid-zoom-out | 46 → 54 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| direction-reversal | 96 → 100 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| rare-far-programmatic-jump | 12 → 12 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| post-gesture-settle | 46 → 42 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| card-body-scroll | 52 → 62 | 396 → 396 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| selection | 0 → 0 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| hover-before-click | 0 → 0 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| click-before-activation | 0 → 0 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| editing-activation | 0 → 0 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| typing | 156 → 156 | 10296 → 10296 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| dragging | 42 → 42 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| connecting | 6 → 6 | 0 → 0 | 0 → 0 / unavailable → unavailable | unavailable → unavailable | 0 → 0/0 → 0 |
| cold-image-traversal | 12 → 12 | 0 → 0 | 27 → 27 / 94.5 → 115.5 | unavailable → unavailable | 0 → 0/0 → 0 |
| warm-image-revisit | 12 → 12 | 0 → 0 | 27 → 27 / 101.2 → 128.2 | unavailable → unavailable | 0 → 0/0 → 0 |

## Complete observed adverse-delta ledger

This ledger is deliberately unthresholded: every reported scenario value that increased in an adverse performance/work/readiness direction appears here. It prevents favorable aggregate results from hiding local regressions.

| Scenario | signal | #402 baseline | #403 candidate | change |
| --- | --- | ---: | ---: | ---: |
| ordinary-reading-pan | max observed JS heap growth bytes | 19211940 | 23213528 | +20.8% |
| rapid-zoom-out | p95 frame interval ms | 166.7 | 183.4 | +10.0% |
| rapid-zoom-out | slow frames | 21 | 22 | +4.8% |
| rapid-zoom-out | missed frames | 86 | 106 | +23.3% |
| rapid-zoom-out | long tasks | 13 | 14 | +7.7% |
| rapid-zoom-out | long-task duration ms | 1539.0 | 1777.0 | +15.5% |
| rapid-zoom-out | median interaction latency ms | 832.6 | 867.0 | +4.1% |
| rapid-zoom-out | style/layout ms | 217.9 | 228.7 | +5.0% |
| rapid-zoom-out | Board Scene derivations | 46 | 54 | +17.4% |
| direction-reversal | median duration ms | 2461.2 | 2708.4 | +10.0% |
| direction-reversal | slow frames | 82 | 85 | +3.7% |
| direction-reversal | missed frames | 249 | 268 | +7.6% |
| direction-reversal | long tasks | 43 | 55 | +27.9% |
| direction-reversal | long-task duration ms | 4321.0 | 5321.0 | +23.1% |
| direction-reversal | median interaction latency ms | 867.9 | 884.0 | +1.9% |
| direction-reversal | style/layout ms | 528.6 | 598.2 | +13.2% |
| direction-reversal | Board Scene derivations | 96 | 100 | +4.2% |
| rare-far-programmatic-jump | median duration ms | 426.9 | 671.8 | +57.4% |
| rare-far-programmatic-jump | p95 frame interval ms | 133.3 | 166.7 | +25.1% |
| rare-far-programmatic-jump | slow frames | 13 | 18 | +38.5% |
| rare-far-programmatic-jump | missed frames | 50 | 88 | +76.0% |
| rare-far-programmatic-jump | long tasks | 11 | 21 | +90.9% |
| rare-far-programmatic-jump | long-task duration ms | 765.0 | 1540.0 | +101.3% |
| rare-far-programmatic-jump | median interaction latency ms | 304.3 | 445.6 | +46.5% |
| rare-far-programmatic-jump | style/layout ms | 35.9 | 106.8 | +197.5% |
| rare-far-programmatic-jump | max observed JS heap growth bytes | 12838928 | 13610372 | +6.0% |
| rare-far-programmatic-jump | worst lightweight readiness ms | 636.2 | 641.0 | +0.7% |
| rare-far-programmatic-jump | worst detailed readiness ms | 427.0 | 430.5 | +0.8% |
| card-body-scroll | max observed JS heap growth bytes | -36366260 | 62310904 | unavailable |
| card-body-scroll | Board Scene derivations | 52 | 62 | +19.2% |
| click-before-activation | p95 frame interval ms | 383.4 | 416.6 | +8.7% |
| click-before-activation | worst detailed readiness ms | 152.8 | 159.8 | +4.6% |
| editing-activation | p95 frame interval ms | 383.2 | 416.7 | +8.7% |
| typing | max observed JS heap growth bytes | 84229640 | 106696644 | +26.7% |
| typing | worst detailed readiness ms | 150.9 | 179.5 | +19.0% |
| dragging | slow frames | 47 | 54 | +14.9% |
| dragging | long tasks | 44 | 45 | +2.3% |
| dragging | worst detailed readiness ms | 634.3 | 674.6 | +6.4% |
| connecting | slow frames | 34 | 37 | +8.8% |
| connecting | paint/composite ms | 96.3 | 96.7 | +0.3% |
| connecting | worst lightweight readiness ms | 811.5 | 825.3 | +1.7% |
| cold-image-traversal | image decode ms | 94.5 | 115.5 | +22.3% |
| warm-image-revisit | slow frames | 4 | 5 | +25.0% |
| warm-image-revisit | style/layout ms | 95.5 | 103.9 | +8.9% |
| warm-image-revisit | worst settled-image readiness ms | 266.8 | 266.9 | +0.1% |
| warm-image-revisit | image decode ms | 101.2 | 128.2 | +26.7% |

## Activation and interaction correctness

At tested commit <code>79803eeaeae23dbda385a8d4afde2e23c56b6721</code>, resident non-proxy Cards are already ordinary rich interactive Card components. Hover, focus, and click change activation ownership and residency pinning only; liveCardIds do not select a distinct component. The equivalent single-click path is the already-rich resident Card receiving that click through its existing event target; the click is not consumed merely to activate, and this candidate neither remounts a different live renderer nor measures replay. Focus, selection/editing, internal scroll, gestures, and active media contribute the explicit owner pins exercised here. Long Note, Result, and Conversation body-scroll scenarios remain in the frozen choreography.

This evidence reduces DOM residency; it does not measure a passive renderer or an interaction-authority handoff. #406 must weigh this architectural limitation; no passive renderer architecture is selected here.

The complete scenario tables retain activation latency, p95-frame, detailed-readiness, dragging, connecting, and body-scroll deltas. In particular, click-before-activation and editing-activation p95 frame intervals increased even though their median interaction latency improved; dragging slow frames and detailed readiness also regressed.

## Search, copy, accessibility, and safety

| Probe | #402 baseline | #403 candidate |
| --- | --- | --- |
| Search | observed; found=true | observed; found=true |
| DOM selection | observed; selected characters=20 | observed; selected characters=20 |
| Clipboard copy | unavailable; copied characters=unavailable | observed; copied characters=20 |
| Accessibility tree | observed; rich-text AX nodes=626 | observed; rich-text AX nodes=583 |

Candidate clipboard copy is now observed rather than unavailable. The static rich-text AX-node count fell from 626 to 583; culling makes that count non-comparable as a completeness win, and the CDP tree is not an assistive-technology audit.

Offscreen browser-find coverage was not established: <code>window.find</code> observes the mounted synthetic giant Note, not culled offscreen Cards. Whole-Board search, whole-Board copy, and complete keyboard/screen-reader traversal therefore remain explicit compatibility risks, not waived behavior. Never-blank safety observed 0 blank and 0 missing-representation frames; the independent coverage probe counts a visible Card only when either DOM or the lightweight canvas representation owns it.

## Warm/cold traversal and overscan interpretation

| Scenario | peak DOM | image decode ms | worst detailed ready ms | worst settled-image ready ms |
| --- | ---: | ---: | ---: | ---: |
| cold-image-traversal | 131 → 88 | 94.5 → 115.5 | 511.9 → 327.8 | 552.4 → 377.5 |
| warm-image-revisit | 131 → 88 | 101.2 → 128.2 | 223.6 → 214.6 | 266.8 → 266.9 |

The symmetric preload handled ordinary direction changes, look-ahead spent extra residency only in the measured camera direction, and the wider retention window prevented exact-edge churn. A rare far jump could initially rely on the lightweight canvas safety representation while detailed DOM settled. The historical provider artifact retained per-run detailed/lightweight readiness, frame, long-task, DOM, heap, Board-work, and image records; it is no longer a repository artifact or runnable report input.

## Image and storage limits

The deterministic fixture values stayed fixed at 2375 stored image bytes, 360372 Board JSON bytes, and 51019524 decoded-pixel-estimate bytes. Decoded-pixel residency is an estimate from source dimensions × 4, not an observed decoder, compositor, GPU texture, or rendition-cache allocation. The candidate does not implement ADR 0024 image renditions; decoded image/cache growth is unavailable, JS heap cannot establish native image residency, and the equal decoded count does not offset the higher observed decode time.

Image ingestion/compression is **unavailable**: Fixture data URLs are prebuilt deterministically; production paste compression is not invoked or timed. Cold/warm traversal, decode, and readiness timings remain shared-runner signals. No blob/storage migration or save-format change was measured or required; the provider artifact contains only the deterministic synthetic fixture.

## Instrumentation limitations

- React work: **unavailable**. The production root exposes no React Profiler timing and forbidden Card/renderer instrumentation was not added. Follow-up: Add a benchmark-only Profiler at the application root or a React-supported performance track, then populate the existing reactWork field without changing this schema or renderer policy.
- GPU texture residency, native decoded-image memory, compositor-only time, and image-cache growth are unavailable. Decoded pixels are estimated; trace paint/composite and JS heap are partial browser signals.
- Browser find, clipboard copy, DOM selection, and the CDP accessibility tree are narrow synthetic probes, not whole-Board or assistive-technology completeness audits.

## Boundary

This was one architecture candidate, not a production renderer selection. It changed no save format, Card renderer, image pipeline, Detail Band threshold, deadband, occupancy threshold, opacity curve, or default production path. Its environment flag, issue-specific workflow, and report harness are removed; this document is historical evidence only.

Issue #406 selected the buffered native-DOM residency architecture. Issue #403 changed no production default and leaves no selectable strict-viewport candidate.
