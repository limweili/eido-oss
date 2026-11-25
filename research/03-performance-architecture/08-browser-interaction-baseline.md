# Browser Interaction Baseline

> Date: 2026-06-22
> Related issues: [#89](https://github.com/limweili/eido/issues/89), [#91](https://github.com/limweili/eido/issues/91), [#95](https://github.com/limweili/eido/issues/95)
> Status: browser harness implemented locally; viewport culling optimized locally

## Command

```sh
npm run perf:browser
```

The command launches the app through Playwright, seeds the deterministic large Performance Fixture, and measures browser-level workflows.

## Covered Workflows

- load large Board fixture
- pan and zoom large Board
- move first note and render
- type in first note and render
- simulate streaming Output chunks
- open Playback
- scrub Playback

The harness also records browser long-task count, total long-task duration, and maximum long-task duration.

## Before / After Signal

The first large-board browser run timed out at `120s` while loading the fixture. It also flooded React Flow edge warnings because the app rendered low-zoom Card previews without handles while still asking React Flow to create thousands of Connections.

Two local optimizations made the harness complete:

- hide Connections when zoomed below the low-zoom Card threshold,
- cull Board rendering to visible Cards and visible Connections while keeping the full Board in the store.
- scope visual decay calculation to visible Cards after rebasing onto `main`'s visual decay feature.

This is the browser-level version of the architecture rule: the canvas renders the graph; it should not become the graph database.

## Latest Output

Sequential run from 2026-06-22:

| Workflow | Time |
| --- | ---: |
| load large Board fixture | 1019.75ms |
| pan and zoom large Board | 1044.47ms |
| move first note and render | 65.81ms |
| type in first note and render | 66.71ms |
| simulate streaming Output chunks | 66.38ms |
| open Playback | 149.32ms |
| scrub Playback | 93.94ms |

Browser responsiveness:

| Long Tasks | Total Long Task Time | Max Long Task |
| ---: | ---: | ---: |
| 13 | 1851.00ms | 406.00ms |

## Interpretation

The browser harness proves the current app can now load and interact with the large fixture, but it also shows remaining UI work:

- pan/zoom is the highest measured browser workflow,
- load still creates long tasks,
- pan/zoom and edit render paths need further tightening before the app feels "lightning fast" at the full target.

## Next Candidates

- Batch high-frequency streaming updates.
- Continue render-path migration toward shared indexes and stable selector inputs.
- Add stricter browser budgets after a few stable baseline runs.
