# Cached Passive Rich Card Candidate

Status: **retained historical record; candidate and evidence harness removed.** Issue [#405](https://github.com/limweili/eido/issues/405) produced a bounded prototype and functional evidence surface. It did not produce an accepted absolute performance baseline, and this document makes no quiet-runner or stable-FPS claim. The source lineage, build flag, workflow, and publication harness were removed after the native-DOM architecture was selected.

## Decision snapshot

The historical prototype demonstrated that a cached passive representation could sit behind the Board Scene residency/representation seam without changing the saved Board model or image storage. That source lineage is removed; the retained record describes the former Reading → Overview → Map experiment, its zoom thresholds, occupancy behavior, deadband, settle gate, gradual crossfades, and lightweight Board-wide safety net.

That structural fit is not enough to make the candidate selectable. A passive raster cannot supply several native DOM behaviors before activation, so the closed result remains `candidate-ineligible` and `architectureSelectable: false`. A favorable timing comparison cannot override those functional blockers.

## What the prototype covers

- Buffered and hysteretic Passive Card residency above the lightweight safety net.
- Cached settled Note, Result, and Conversation representations with bounded entry, metadata, encoded-byte, decoded-pixel, and capture-work accounting.
- Capture suppression during camera motion and refresh after settling.
- Hover/focus promotion before click, first-intent routing, and Live Card pinning while focus, selection, editing, internal scrolling, gestures, or active media require authority.
- Long Note, Conversation, and Result interaction after the Card becomes live.
- Separate accounting for stored compressed bytes, decoded source pixels, passive-raster residency, paint/composite work, and cache growth.

The implementation does not require or evaluate a full asset-to-blob migration.

## Functional and structural outcome

| Question | Outcome |
| --- | --- |
| Could the former representation use the prepared Board seam without changing the three zoom appearances? | Historically yes; the retired prototype fit behind the seam. It is no longer selectable or controlled by a build flag. |
| Could former default-off behavior be checked directly? | Yes, in the retired evidence harness. B's content-free owner observation required zero runtime/cache allocations, attach/detach/update calls, subscribers, and shared-capture listeners rather than inferring success from an absent marker. |
| Could promotion and live interaction be exercised? | Yes, in the retired synthetic observation. It covered focus/hover promotion, first-intent accounting, pinning, internal navigation, and long rich-card content once live. |
| Can the passive representation preserve native rich-DOM behavior before promotion? | No. The compatibility limitations below are intrinsic to the raster representation. |
| Does this lane establish an absolute performance win? | No. Shared hosted-runner timing is directional and non-blocking. |

These statements preserve historical structural contracts and executable observations from the retired harness. The candidate implementation and evidence harness were removed, so this document is not runnable and no earlier failed or partial hosted attempt is accepted as a paired B/C measurement.

## Compatibility limitations

The following are measured or reported limitations, not authorized product sacrifices:

| Limitation | Consequence while the Card is passive |
| --- | --- |
| Trusted native activation | Replayed intent cannot mint the trusted browser event required by popups, modified links, file controls, and some media controls. |
| DOM selection | Passive pixels cannot provide exact native rich-text selection. |
| Clipboard copy | Passive pixels cannot provide the rich subtree's exact native clipboard content. |
| Keyboard traversal | Passive descendants are absent from normal keyboard traversal. |
| Link semantics | Descendant links do not retain native pre-activation behavior. |
| Accessibility structure | The passive raster does not retain the full rich-DOM accessibility tree. |
| Browser search | No retained passive-state browser-find probe exists, so search remains unmeasured and blocking for selection. |

Capture failure, runtime poisoning, unknown native encode/decode reservations, missing or blank representations, incomplete first-intent accounting, image-readiness gaps, and budget overflow also invalidate the candidate observation. Chromium does not expose exact GPU texture or rendition residency here. The fixture uses prepared data URLs, so production paste-time ingestion and compression are not evaluated.

## Historical evidence disposition

The paired B/C experiment and its publication harness are retained here only to
explain the candidate-ineligible decision. They are not runnable evidence
surfaces: the alternate Card renderer, capture/cache runtime, candidate tests,
manual workflow, and publication checks were deleted during the native-DOM
closeout. No future dispatch or rebaseline should be inferred from this record.

CPU load, free-memory cleanliness, FPS cleanliness, and wall-clock stability
were never evidence gates for the experiment. The retained timing values show
direction within the historical paired run, but they are noisy diagnostics
rather than absolute budgets, merge blockers, or proof that one renderer is
globally faster.

## Privacy and data safety

The historical workflow used only `createRichCardBenchmarkBoard()` and a
temporary synthetic save. It was never authorized to inspect or run against
`~/.eido/eido-v3-ideas.json`, `EIDO_CURRENT_BOARD_DATA_FILE`, another real Eido
save, or any private data source.

The fixture contains synthetic Notes, Conversations, Results, and prepared image data URLs. Published raw captures and observations therefore describe the synthetic workload only. No result from this lane authorizes the final production renderer migration.
