# Slice 1 Baseline And Playback Upgrade

> Date: 2026-06-21
> Status: implemented in v3 app
> Scope: deterministic scale fixtures, timeline benchmark command, playback projection gating, and checkpointed timeline projection.

## What Changed

- Added deterministic performance fixtures for `smoke`, `medium`, and `large` boards.
- Added `npm run perf:timeline` for a repeatable timeline projection benchmark.
- Added `createTimelineProjector(...)` as the playback projection seam.
- Gated timeline projection behind `playbackOpen` in `App.tsx`.
- Moved playback subscriptions/effects into a playback-only component so normal editing does not subscribe the app root to playback inputs.
- Removed `outputs` and `runs` from the app-level playback projection dependency path.
- Added checkpointed timeline projection behind the projector interface.

## Current Fixture Sizes

| Fixture | Cards | Connections | Output Versions | Timeline Events |
| --- | ---: | ---: | ---: | ---: |
| smoke | 100 | 200 | 20 | 500 |
| medium | 1,000 | 2,000 | 200 | 5,000 |
| large | 5,000 | 10,000 | 1,000 | 50,000 |

## Latest Baseline

Command:

```sh
npm run perf:timeline
```

Budget report command:

```sh
npm run perf:report
```

Results from 2026-06-21:

| Fixture | Range | Build Projector | Start Projection | Middle Projection | End Projection | Legacy Middle Projection | 100-Frame Scrub |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| smoke | 0.15ms | 0.65ms | 0.07ms | 0.05ms | 0.02ms | 0.26ms | 2.95ms |
| medium | 0.68ms | 5.01ms | 0.03ms | 0.17ms | 0.84ms | 1.79ms | 10.39ms |
| large | 6.96ms | 101.25ms | 0.01ms | 0.81ms | 0.79ms | 23.92ms | 66.95ms |

## Before / After Signal

The first benchmark run before checkpointing showed the large fixture doing a 100-frame scrub in about `1300ms`. After checkpointing, that dropped to about `71ms`.

The trade-off is that large-board playback now pays a one-time projector build cost of roughly `100-120ms`. That is acceptable for the prototype because:

- normal editing no longer pays playback projection costs while playback is closed,
- playback scrubbing becomes much cheaper,
- the cost sits behind one module interface that can later move to workers, persisted checkpoints, or a database-backed event journal.

## CTO Interpretation

This confirms the current app can keep moving without a wholesale rebuild. The right move is selective internal rebuilds:

- keep the current React app and product surface,
- deepen core modules under it,
- measure every scale-sensitive feature through repeatable fixtures and browser harnesses,
- only replace larger architecture pieces when the benchmark proves the current seam cannot carry the load.

## Next Research Slice

The next slice should add browser-level measurements for real interaction costs:

- loading a large board,
- pan/zoom,
- dragging a card,
- typing in a note,
- opening playback,
- scrubbing playback,
- simulated streaming output.

After that, the likely implementation candidates are:

- `GraphIndex` for card/connection/output lookups,
- cheaper group membership reconciliation during drag,
- high-frequency text/stream batching,
- persisted playback checkpoints or worker-backed projector construction if playback open cost becomes user-visible.
