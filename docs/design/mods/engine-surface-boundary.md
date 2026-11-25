# Mod redesign — the engine-surface boundary

What the `mod-workbench-v2` prototype **simulates** (a deterministic drawing
derived purely from board state) versus what is **real-runtime PRD work** (the
run plan, executed for real against a model). The locked decision is "a UI skin
over existing machinery": the compiled forms stand alone, every part on the
board is fully useful at FAST, and nothing below ships in the PRD's first cut.

Sources: `round5-synthesis.md` (arbitration 6–7), `explore-controllers.md`
(§C5, §E), `lib/DESIGN.md` (SPEC 05, round-5 deferred register).

## The line, in one sentence

The prototype draws **THE PLAN** — a pure function of board state — and never
fabricates a runtime result. It renders the *shape* of the work (which calls,
in what order, modulated by what values); it never runs the work, stores an
artifact, judges an output, or claims a timing.

## Simulated here (prototype, deterministic from board state)

| Surface | What the prototype does | Where |
| --- | --- | --- |
| **STAGE** | a slider preset with named stops that EMIT ("we are organising now"); its scalar jack wires like any other | `addControl('stage')`, `stagePhrase` |
| **Curve POSITION** | a wired scalar draws the hairline + sampled dot on the curve face; emission switches to sampled-now-plus-trajectory | `setInput('position')` (lib), `curveSampledClause` |
| **FORK compiled** | ONE decide-scaffold card ("First decide … If … lean toward"); pill `→ PATH` | `forkScaffold`, `forkPill` |
| **REVISE compiled** | ONE card ("Draft … read it back against … up to N passes"); 0 passes = silent | `revisePhrase` |
| **Fidelity resolution** | per-item chip (`ONE PASS · IN STAGES · AUTO`) + the mod-level `FAST◄──►PRECISE` lever resolving every AUTO | `resolvedFidelity`, the `#modLever` |
| **Artifact cables** | a second connector family (square ports, wider ink) that chains step→step and **refuses** to mate with signal jacks (by silence) | `isArtifactRef`, `nearestSlot` family gate, `wire--artifact` |
| **Step compiled clause** | a step at ONE PASS degrades to "As part of the work: {prose}" | `cardSpecs` step branch |
| **THE PLAN strip** | the transformer chain (artifact-cable order) as stage segments: verb + the modulating signals **sampled at that stage's position** + prose; `N CALLS` pill | `planTracks`, `renderPlan` |
| **SCORE POSITION** | a wired STAGE draws a persistent, wire-owned cursor + per-lane sample chips; two-way drag rides the mod through its lifecycle | `drawScoreCursor` |
| **STEPS the lens** | the D6-spelled ladder of a curve — spoken integers, stage words, hold-ties; **shares** the speller's collapse predicate | `renderStepsViz`, `seriesGroups` |

All of the above are pure functions of `(control values, wires, fidelity
resolutions, artifact-cable order, check-block config, modulation sampling)`.
No network, no persistence, no randomness.

## Engine-surface — real-runtime PRD work (NOT in the prototype)

The prototype renders the family and the plan; it never fabricates any of this:

- **Executing the chain.** Making the real transformer calls; the artifact
  **contents** (a draft, a cluster set, a critique) are never faked — no
  lorem-ipsum. The plan strip shows the calls, not their outputs.
- **Decision points (FORK executed).** A real classify call over the look-at
  question, then launching the chosen path (which in the PRD may itself name a
  chain). Priority-one when the engine opens — cheapest, biggest behaviour delta.
- **Judge loops (REVISE executed).** generate → judge call scoring the metric →
  bands (strong/light/accept) pick the revision instruction → repeat ≤ passes.
  Scores, bands, and the loop guard (accept band + at-most limit) are all
  engine-surface — a threshold face becomes honest only here.
- **Artifact storage & inspection.** Holding intermediate work-products,
  letting the user open one, retrying a failed stage.
- **Per-stage provenance.** Which call produced which output, with what inputs.
- **Intervention.** Pausing between stages, editing an artifact, resuming.
- **AUTO-resolution heuristics.** The real logic behind AUTO (the prototype
  resolves AUTO purely by the mod lever; the engine would weigh cost/complexity).
- **The verb catalog as an engine registry.** Each verb = a fixed mechanic +
  creator prose, the control-emitter pattern at the call level. The prototype
  ships a fixed demo set (`STEP_VERBS`); the engine owns the real registry.
- **Spend guards, cost display, timing.** THE PLAN must never claim a timing.

## The one big record

Everything executed is one engine feature — **the run plan** — a deterministic
derivation from board state to an ordered structure of real calls: chains
(transformers), decision points (FORK), loops with guards (REVISE + stopping
conditions). Same authoring surface, two fidelities; THE PLAN strip is its
exact preview. Priority order when the engine work opens: executed FORK first,
transformer chains second, judge loops last.

## The guardrail

The run plan stays a **derivation from board state**, never a canvas of its
own. The board is the only authoring surface; the plan is always a projection.
The moment stages become free-dragged nodes with their own wires, it stops
being an instrument and becomes a workflow builder — out of scope by design.
