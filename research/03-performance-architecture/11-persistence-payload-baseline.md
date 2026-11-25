# 11 — Persistence payload baseline and retention rules (#94)

Measured by `src/performance/persistenceReport.perf.test.ts` (runs with `npm run perf:report`). Numbers from the deterministic performance fixtures, 2026-07-05, local M-series hardware.

## Baseline

| Fixture | Cards | Total | Cards | Connections | Outputs | Runs | Intent log | Serialize |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| smoke | 100 | 206 KB | 25 KB | 33 KB | 5 KB | 7 KB | **137 KB** | 0.3 ms |
| medium | 1,000 | 2.0 MB | 249 KB | 328 KB | 52 KB | 70 KB | **1.34 MB** | 2.9 ms |
| large | 5,000 | 15.9 MB | 1.25 MB | 1.64 MB | 259 KB | 348 KB | **12.4 MB** | 23 ms |

## The finding

**The intent log is ~78% of a large save.** Board content (cards + connections + outputs + runs) is ~3.5 MB at 5k cards; the event history is 12.4 MB and grows without bound. The main amplifier is run events cloning full `RunRecord`s — including `compiledInstruction`, the largest strings on the board (chain plans are already stripped from clones, #139).

Serialization cost (23 ms large) sits on the debounced save path, not on keystrokes, and is acceptable today. Size is the earlier cliff: full-snapshot saves rewrite all 15.9 MB per debounce tick.

## Image payload baseline (#247)

Issue [#247](https://github.com/limweili/eido/issues/247) recorded the first real image-heavy save evidence. The committed reference file is `src/performance/baselines/imagePayload.baseline.json`; it is evidence for comparison, not a live timing gate.

Recorded values from #247:

| Signal | Value |
| --- | ---: |
| Active save size | 84.67 MB |
| Image Data URL payload occurrences | 72.77 MB |
| Active Board image payload | 36.46 MB |
| Stripped save size | 11.89 MB |
| Full `/api/eido/initial` | 30.89s |
| Stripped `/api/eido/initial` | 7.38s |
| Full first contentful paint | ~4.5s |
| Stripped first contentful paint | ~1.1s |
| Isolated 30-image thumbnail load | ~9.8s |

The deterministic gate is byte math only: `src/performance/persistencePayload.test.ts` generates synthetic data URLs of known stored string lengths, asserts total image payload bytes/count/largest asset reporting, and enforces the 200 KB newly-pasted-image budget constant. CI must not assert the live timing values above.

## Retention rules (prototype)

- **Undo**: in-memory only, bounded stack (already true). Never persisted.
- **Playback / intent log**: durable, append-only, but does NOT need full-fidelity clones forever. Rule: keep semantic events verbatim; run events should reference run ids rather than clone records once the event journal lands.
- **Checkpoints** (ADR 0010): a stored projection every N events so playback never replays a full log. Not built; becomes necessary at the journal migration, not before.
- **Output versions**: keep all (user-facing history) — they are small relative to the log.
- **Runs**: keep all; `compiledInstruction` is the provenance the product promises (ADR 0008). If size bites, oldest-run instruction text is the compression target — never deletion of the record.
- **Assets**: currently inline data URLs on cards (fixtures carry none). First board with real images will dominate instantly → assets are the first candidates for blob records (ADR 0004), triggered by symptom, not schedule.
- **Full-board import/export**: explicitly preserved — full snapshots stay correct for export/import/migration regardless of how incremental persistence evolves (ADR 0010's "full-board work is fine off the hot path").

## Trigger for normalized persistence work

Move from full snapshots to normalized records + event journal when ANY of:

1. A real save exceeds **~25 MB** or serialization exceeds **~50 ms** (budget asserted at 120 ms to stay unflaky; investigate well before it trips).
2. The intent log alone exceeds **5× board content** (large fixture is already at ~3.5×; the fixture generator is history-heavy, real boards are watched via the same report against `EIDO_CURRENT_BOARD_DATA_FILE`).
3. Save debounce visibly contends with streaming (symptom: dropped frames during AI streaming with large boards).

## Deferred optimization (evidence, not neglect)

The obvious candidate — stop cloning full `RunRecord`s into run events — changes intent-log semantics that playback consumes, so it is NOT the low-risk quick win #94 allows for. It is the first work item of the event-journal migration above. No other single change moves >5% of the payload.
