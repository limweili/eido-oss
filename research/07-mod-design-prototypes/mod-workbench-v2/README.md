# Mod Workbench V2 research index

This directory is the durable research memory for polishing
docs/design/prototypes/mod-workbench-v2.html in PR #442.

## Read in this order

1. [00-goal-and-research-protocol.md](00-goal-and-research-protocol.md) —
   completion bar, mandatory evidence loop, and compaction recovery.
2. [01-external-validation.md](01-external-validation.md) — primary-source
   synthesis across modular patching, DAW/device authoring, all controls,
   all 15 visualizers, process primitives, Mod packages, and implementation
   gates.
3. [02-iteration-decisions.md](02-iteration-decisions.md) — implemented
   decisions, rationale, focused browser evidence, and remaining gates.
4. [_standards-workflow-partial.md](_standards-workflow-partial.md) — the
   specialist standards/workflow audit (WAI/WCAG, BPMN, and OpenTelemetry;
   filename retained from the research lane handoff).

## Current research-backed decisions

Accepted:

- preserve instrument-flat controls, patch cords, typed payloads, compact
  package surfaces, named variations, and deeper authoring behind them;
- distinguish factory default, authored default, current value, unwired normal
  value, and effective/modulated value;
- distinguish authored preview, compiled plan, running state, and observed run;
- expose mapping provenance, compatibility, reset, and reversible edits;
- give every visualizer an empty/default/connected/error state and a text
  equivalent;
- preserve total coercion across scalar/span/series signals, while the visibly
  different signal/artifact connector families refuse each other by silence.

Rejected:

- unwired animation or accent that looks like live data;
- silent failure inside the signal family (all signal shapes coerce);
- exact pre-run call counts for conditional branches or guarded revision;
- pointer-only wiring, adjustment, or structural editing;
- treating a package click as “start” when it only appends below the fold.

## Research sources

Only primary or first-party sources govern decisions here: Ableton and Bitwig
manuals, VCV Rack manuals/API/release notes, Cycling '74 documentation,
Make Noise manuals, W3C/WAI standards and patterns, and official workflow
specifications/documentation. Claim-level links live in the research report.

## Status

- Baseline and Iteration 1: completed and browser-checked.
- External research gate: completed.
- Iteration 2: completed and browser-checked. The workbench now exposes the
  prompt destination and authored speech beside mechanic settings, names the
  authored default explicitly, prevents hidden/staged controls being orphaned
  by section deletion, makes compiler cards keyboard-editable, fixes palette
  search hiding, treats package actions as additive managed instances, and
  labels preview state without claiming readiness.
- Iteration 3: completed and browser-checked. Conditional process work now
  exposes possibilities, broken artifact topology is explicit, and all 15
  visualizers share a truthful provenance grammar. Its experimental REVISE
  plan-range treatment was superseded in Iteration 6 by the governing local
  compiler-card contract.
- Iteration 4: completed and browser-checked. Ports, core write-back lenses,
  movement, and resizing have keyboard paths; connection state is named; key
  structural edits have Undo; and the workbench has a narrow-screen mode.
- Iteration 5: completed. The adversarial pass closed cancellation-safe cable
  moves, full-layout undo for move/resize, add and direct-adjust undo,
  text-field-native undo, optional visualizer inputs, keyboard editing for
  RANGE/FILTER/CURVE, and discoverable canvas panning.
- Iteration 6: completed, browser-checked, and independently re-reviewed. It
  restores the locked signal/color/progressive-disclosure rules, makes
  BRANCHES policy-only, gives MATRIX semantic cells, makes compiler structure
  keyboard-movable and undoable, makes pointer adjustment gesture-atomic, and
  gives every added pack a shared lifecycle and two purposeful shipped
  variations. Pack cards now state their job, example, compiler scope, and
  defining-input completeness; authored edits expose an unsaved custom state.
  REVISE is again one bounded compiler card and is silent at zero, as required
  by the engine-surface design.
- Goal completion audit: satisfied. Independent final reviews reported no
  remaining spec P0/P1/P2, no hard design-standard violation, and no runtime
  audit failure. Prototype syntax, diff hygiene, docs-sync, and the 98-part
  browser stress test pass; the repo build remains unavailable only because
  this worktree has no installed `tsc` executable.
