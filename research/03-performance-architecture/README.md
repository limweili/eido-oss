# Eido Performance Architecture Research

> Status: active research track. This folder is for scale and performance architecture decisions before PRDs, issues, or implementation.

## Purpose

Eido's long-term target is a board that can hold thousands of cards, connections, AI outputs, and playback events while still feeling instant. This track exists so performance becomes a product architecture principle, not a late cleanup phase.

## Documents

| Doc | Purpose |
| --- | --- |
| [01 Initial Performance Architecture Review](01-initial-performance-architecture-review.md) | First CTO review of current code, reference repo lessons, opportunities, future-feature requirements, and recommended research process. |
| [02 Performance Upgrade Operating Plan](02-performance-upgrade-operating-plan.md) | How we will execute the upgrade inside the current app: test tools, skill discipline, rebuild policy, and first implementation slices. |
| [03 Slice 1 Baseline And Playback Upgrade](03-slice-1-baseline-and-playback-upgrade.md) | First implemented measurement slice: scale fixtures, timeline benchmark, playback gating, checkpointed projector, and benchmark results. |
| [04 Performance Upgrade PRD](04-performance-upgrade-prd.md) | Product requirements, architecture decisions, testing decisions, and success gates for the performance foundation. |
| [05 Implementation Pipeline](05-implementation-pipeline.md) | Published GitHub issue pipeline, dependency order, and testable Performance Foundation v1 goal. |
| [06 Performance Budget Report Baseline](06-performance-budget-report-baseline.md) | Unified `perf:report` command, current Timeline Projector budget coverage, and latest pass/fail baseline. |
| [07 Store Operation Baseline](07-store-operation-baseline.md) | Store benchmark command, covered operations, first bottleneck evidence, and group reconciliation before/after results. |
| [08 Browser Interaction Baseline](08-browser-interaction-baseline.md) | Playwright browser harness, large Board workflow timings, viewport-culling before/after evidence, and remaining UI bottlenecks. |
| [09 Future Feature Performance Gate](09-future-feature-performance-gate.md) | Required questions, shared modules, commands, and rules future features must follow. |
| [10 Performance Foundation Retro](10-performance-foundation-retro.md) | Workflow retro on goal setting, PR/issue lifecycle, CI mirroring, benchmark recording, and next-process improvements. |
| [11 Persistence Payload Baseline](11-persistence-payload-baseline.md) | Save size and serialization baseline per fixture, retention rules per collection, and the triggers for normalized persistence work. |
| [10 Next-Level Canvas Performance Architecture](10-next-level-canvas-performance.md) | tldraw-inspired scene derivation direction, the `boardScene` module, and next render/index gates. |
| [12 Excalidraw Rendering Performance Study](12-excalidraw-rendering-performance-study.md) | Canonical source-verified explanation of Excalidraw's culling, per-element raster caches, zoom-time reuse, canvas layering, and active-editor seam, with the current Eido and ADR audit. |
| [13 tldraw Rendering-Continuity Study](13-tldraw-rendering-performance-study.md) | Source-verified explanation of tldraw's retained whole-page DOM, exact-viewport culling, camera-motion interaction block, efficient zoom, and active-editor seam, with the Eido continuity trade-offs. |
| [14 Rich Card Reading Baseline](14-rich-card-reading-baseline.md) | Retained raw-browser evidence and generated baseline report for the current rich Card Reading implementation; no renderer winner or policy change. |
| [15 Strict Viewport Residency Candidate](15-strict-viewport-residency-candidate.md) | Retained historical #403 comparison against the frozen rich Card baseline. The strict-viewport candidate, workflow, and report harness were removed after #406 selected buffered native-DOM residency; this document is not runnable evidence. |
| [16 Visibility-Aware Image Rendition Candidate](16-image-rendition-candidate.md) | Issue #413's prototype evidence for purpose/size-derived runtime renditions, reference-aware eviction, and separate decoded/rendition accounting; persistence impact remains confounded and production remains unchanged. |
| [17 Within-Card Virtualization / Content-Visibility Candidate](17-within-card-virtualization-candidate.md) | Issue #404 is terminally rejected and non-selectable (`architectureSelectable: false`) after the content-visibility-activation scroll-drift veto; #597 removed its runtime, flag, and evidence workflow. No equivalent alternative remains open. |
| [18 Cached Passive Rich Card Candidate](18-cached-passive-rich-card-candidate.md) | Issue #405's retained historical record of the bounded cached-passive prototype, structural/functional outcome, and explicit compatibility blockers. The proposal is terminally rejected; its source lineage, build flag, workflow, and publication harness were removed, so this document is evidence history rather than a runnable candidate. |
| [19 Reading-band Architecture Selection](19-reading-band-architecture-selection.md) | Issue #406's single selected architecture: buffered rich-DOM residency with the existing safety/hot-overlay seams and visibility-aware derived image renditions; losing candidates remain terminally rejected and the selected architecture is now production. |
| [20 Cold-data Loading ROI](20-cold-data-roi.md) | Issue #408's deterministic structural study and terminal eager-loading decision: cold payloads affect initial bytes/residency/persistence but add no stable Reading-navigation visits, while the runtime has no safe partial-record lifecycle seam. |
| [21 Rich Card Production Implementation Sequence](21-rich-card-production-implementation-sequence.md) | Issue #409's nine-slice vertical production sequence and native blocker graph, reconciled after the #570 direct-ship implementation and ADR 0028 evidence policy. |
| [22 Card-Facade Reference Architecture Claim Audit](22-card-facade-reference-architecture-study.md) | Primary-source audit of what tldraw, Miro, Notion, and Figma actually cull, retain, activate, and expose semantically—and which alleged inactive-Card facade claims their public evidence does not support. |
| [23 Chromium Same-DOM Soft-Containment Envelope](23-chromium-soft-containment-envelope.md) | Issues #1152/#1154's durable source and disposable measurements: Card-root `content-visibility: auto` produced no exact-visible material win, paragraph-level containment broke geometry/semantics, and #1157/#1168 permanently deleted the experiment with no production mechanism. |
| [23 Native-Semantic Continuity Oracle](23-native-semantic-continuity-oracle.md) | Issue #1153's retained adoption contract and final BLOCK evidence: the mandatory headed/native Find gate was not measured, so #1157 selected DELETE and #1168 removed the disposable #1156 artifacts. |
| [24 Save-to-Disk Responsiveness Research](24-save-to-disk-responsiveness-research.md) | Primary-source research and an Eido-specific low-maintenance decision matrix for coalesced autosave, in-memory authority, idle/background capture, lifecycle flushes, and when to defer delta persistence. |

## Working Principles

- The canvas should render the graph. It should not be the graph.
- Undo should be short, fast, and user-facing. Playback should be persistent, queryable, and intentionally coarser.
- Full-board work is allowed for import, export, migration, and explicit checkpointing. It should not sit on ordinary typing, dragging, streaming, or playback ticks.
- Future features must share graph indexes, command/event infrastructure, and persistence rules rather than creating their own local history systems.
- Image performance must distinguish compressed storage bytes from decoded-pixel and display-rendition residency (ADR 0024).
- tldraw is a reference project only. Eido will not use the tldraw SDK or migrate to tldraw technology in this performance upgrade.
