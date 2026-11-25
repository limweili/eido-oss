# ADR 0021: Visual Decay Removed from the Render Path

Status: accepted

Decided in the zoom-bands rework PRD (issue #300, founder decisions 2026-07-09), executed by slice A1 (issue #304). This ADR records the removal, the deliberate wire-format change, and the founder's future path for the feature.

## Context

Visual decay was a purely visual opacity projection that faded cards and connections toward transparency as they went untouched: `cardDecayOpacityMap` derived a board-wide per-card opacity map from the intent log, `opacityForConnectionDecay` projected it onto connections, and a `visualDecayEnabled` board preference (default on) gated it. No consumer in the context layer, compiler, execution layer, playback, persistence, or graph index ever read the decay opacity — the projection was provably visual-only.

Decay was **not slow**: one linear pass, order (cards + events), memoized with no viewport dependency, so it never ran on a pan or zoom frame. It was removed for three other reasons:

1. **Disuse.** `visualDecayEnabled` defaulted on, so every board silently faded — which neither the founder nor his users want.
2. **Coupling.** It was the only source of card opacity < 1 in the live render path, and therefore the sole cause of canvas-layer invariant 5 (the silhouette underlay, the `0.22` visibility floor, the "true opacity, no floor" rule) and of the #126→#158→#178→#215 tug-of-war.
3. **It would have made the zoom-bands epic ship a regression.** Lane C moves hover onto a canvas hit-test firing on essentially every pointermove; with decay alive, `decayOpacityById` (keyed on `hoveredCardId`) would have rebuilt a board-wide N-entry `Map` on every mouse move, invalidating the `nodes`/`edges`/`opacityById` memos with it. Removal makes the hover path touch no opacity map at all.

## Decision

**Delete the projection; do not memoize around it.**

- `src/graph/decay.ts` and its tests are deleted whole. Its imports (`normalizeIntentSignal`, `DEFAULT_INTENT_SIGNAL`) came *from* `intent.ts` and stay there.
- Every producer is removed: the Board decay-map memos and node/edge opacity feed, the connection edge's `decayOpacity`, the Settings toggle and its copy, the store field/setter/commit-state entry, and the `visualDecay` action-contract collection.
- **The intent domain stays untouched**: `intentSignal`, `intentSignalSetAt`, the intent log, `intent.ts`, playback, and the timeline are the KEEP domain. "Decay" here meant only the visual fade.
- The painter (`BoardOverviewLayer`) keeps a now-optional `opacityById` prop with all read sites defaulting to 1; deleting that machinery end-to-end (the prop, `frame.opacity`, the `0.22` floor, the silhouette true-opacity rule) is slice B1's (#309), so the two slices never double-own the file.

### Wire-format change (deliberate)

`makeSavedBoard` no longer writes `visualDecayEnabled`; new saves omit the key. `SavedBoard` keeps the field as `@deprecated` so old saves parse and inspection tools stay honest. No version bump and no migration: unknown/retired keys are ignored on load, and a save-load-compat unit test pins that a board carrying `"visualDecayEnabled": false` still loads and runs.

## Consequences

- Every card and connection renders at full opacity; a card is either drawn or not, never dimmed. The hover path touches no opacity map.
- Canvas-layer invariant 5 loses its only justification; B1 collapses the silhouette-vs-floor branching to a single opaque path.
- The decay scan is gone from the edit path — but measurement (interleaved cross-process A/B, 3 control runs on main@48730b3 vs 3 branch runs) falsified the expectation that the edit-path long-task gate would be born green: one deterministic ~175–195 ms long task sits in the type-in/streaming window with decay present **and** absent. Decay never explained it; its likely carrier is the streaming-commit work (`simulate streaming output chunks`, ~233 ms every run). The gate's interim budget is therefore **1 task / 250 ms total**, taken from the measured control envelope, not zero. A3 (#306, the mount collapse) removes the remaining order-of-board edit-path work and tightens both bounds to 0; if the task survives A3, it belongs to neither slice and needs its own issue.

## Future path (founder decision)

If the untouched-card fade is ever wanted again, it returns as a **per-card property** — set and seen on a single card — not as a board-wide projection recomputed from the whole intent log.

**Naming collision to resolve at that time:** Eido's glossary already uses **Mod** for the AI-instruction modifier card kind, so a per-card visual decay control needs a different name.
