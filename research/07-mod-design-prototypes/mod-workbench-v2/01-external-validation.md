# Mod Workbench V2 — external validation

Status: research complete; implementation implications integrated through five prototype passes
Researched: 2026-07-16
Scope: `docs/design/prototypes/mod-workbench-v2.html`
Evidence policy: official manuals, standards, specifications, and first-party
documentation only.

## Executive finding

The instrument-flat direction is sound, but a trustworthy authoring tool must
make four models explicit that the current prototype sometimes blends:

1. **Authored value** — the setting the Mod author chose.
2. **Incoming modulation** — a value supplied by a live connection.
3. **Compiled plan** — what calls and transformations Eido intends to make.
4. **Observed run** — what actually happened during one execution.

The external evidence supports keeping tactile controls, patch cords, exposed
modulation, macros, presets, and a compact front panel. It does **not** support
using continuous animation as evidence that an unwired visualizer has data, or
using a deterministic plan drawing as if it were a run trace.

The strongest product move is therefore refinement, not redirection:

- preserve the visual language;
- make port direction and payload type redundant and legible;
- expose the normal/default value that operates while a port is unwired;
- separate `PREVIEW`, `PLAN`, and `RUN` states in wording and motion;
- add the ordinary authoring safety net: undo/redo, reset/default, duplicate,
  remove, bypass, presets/variations, and inspectable mappings;
- keep a playable front panel while moving mapping and uncommon configuration
  behind a deliberate authoring surface.

## 1. Patching semantics

### 1.1 Direction is a contract, not a cable aesthetic

VCV Rack describes patching as connecting a module **output** to an **input**,
and permits multiple cables to fan out from an output. It also lets users move
either plug of an existing cable. [VCV Rack — Getting
Started](https://vcvrack.com/manual/GettingStarted)

Cycling '74 likewise models connections as cords between object **outlets** and
**inlets**, supports reconnecting either end, and provides mouse-free creation
and deletion. [Cycling '74 — Patch
Cords](https://docs.cycling74.com/userguide/patch_cords/)

**Implication for V2**

- Keep one stable spatial grammar everywhere: sources/outlets on the right,
  destinations/inlets on the left. Do not make a user rediscover direction per
  component.
- Let a user begin a cable from either compatible end, but show direction while
  dragging and after connection (port labels, source/target tooltip, or a small
  directional detail). Curvature and color alone are insufficient.
- Reconnecting one endpoint should preserve the other and remain undoable.
- Every pointer-only patch action needs an equivalent selection-and-connect
  operation; see the accessibility section.

### 1.2 “Modular” does not imply one payload family

VCV Rack intentionally permits audio, CV, pitch, gate, trigger, and clock
signals over the same kind of cable; the port's meaning supplies the contract.
[VCV Rack — Getting Started](https://vcvrack.com/manual/GettingStarted)

Max takes a different, equally established approach: its patcher distinguishes
event messages, block audio signals, multichannel signals, CPU matrices, and
GPU textures as different cord kinds, and supports type-specific probing.
[Cycling '74 — Patch
Cords](https://docs.cycling74.com/userguide/patch_cords/)

Max also distinguishes a discrete message sent at a moment from an ongoing
signal relationship evaluated continuously. [Cycling '74 — How MSP
Works](https://docs.cycling74.com/max7/tutorials/03_msphowmspworks)

**Implication for V2**

The prototype's separate scalar-signal and artifact families are reasonable,
but they are an Eido semantic choice rather than a universal synthesizer rule.
Make that choice teachable:

| Family | Meaning in V2 | Required redundant cues |
| --- | --- | --- |
| Scalar/control signal | A value sampled or read by another control, step, or visualizer | round port, source/target label, color/accent, `VALUE`/unit in inspection |
| Artifact/work | A generated or transformed piece of work passed between steps | square port, heavier neutral cable, `WORK IN`/`WORK OUT`, content/status inspection |
| Process/event | A discrete decision, trigger, or run transition, if V2 exposes it at all | distinct event glyph, verb label, never visually conflated with a continuously varying scalar |

- Do not silently ignore an incompatible target. While dragging, dim invalid
  ports, keep valid ports visible, and on attempted drop state the reason and
  the expected type.
- A port label and accessible name must describe payload and direction, for
  example `BREADTH — scalar input` or `CRITIQUE — work output`.
- If V2 has no user-authored event cable, keep process sequencing in the plan
  model instead of inventing a third visible cable family prematurely.

### 1.3 Unwired does not mean undefined

VCV Rack's port API explicitly distinguishes connected and disconnected ports.
Its “normal” value is used only while no cable is connected; a connected cable
replaces that value. The API also exposes `isConnected()` independently from
the carried value. [VCV Rack — Port API](https://vcvrack.com/docs-v2/structrack_1_1engine_1_1Port)

Hardware follows the same useful concept. Make Noise documents internal
normalled connections that work without a patch cable and are interrupted or
replaced when a cable is inserted. [Make Noise — Shared System
Manual](https://www.makenoisemusic.com/wp-content/uploads/2024/03/bg-sharedsystemmanual.pdf)

**Implication for V2**

Every visualizer input and modulatable step input needs an inspectable state:

- `UNWIRED · USING DEFAULT 50%`
- `WIRED · WARMTH 62%`
- `WIRED · STAGE-SAMPLED 38%`
- `MISSING REQUIRED INPUT`

Do not use “default” for three different things. Name these separately:

- **factory default** — shipped by the part or Mod package;
- **authored default** — saved by this Mod's author;
- **current value** — the value on the surface now;
- **normal value** — the fallback read by an unwired input;
- **live/effective value** — authored/normal value plus or replaced by incoming
  modulation, according to the declared mapping rule.

The existing `USE CURRENT AS DEFAULT` action should say which default it
changes and offer undo. A normalled input should show a subtle internal/default
route so removing a cable does not appear to make a value come from nowhere.

### 1.4 Multiple connections require declared composition

VCV Rack historically allowed output fan-out, and Rack 2.5 added multiple
cables on an input with an explicit summing rule: audio and control voltages
sum, while gates/triggers combine logically. [VCV Rack 2.5 release
notes](https://vcvrack.com/news/2024-04-21-Rack-2.5)

**Implication for V2**

- Output fan-out is intuitive and should remain possible.
- An input must declare one of: `single/replace`, `sum`, `average`, `min/max`,
  `ordered list`, or another domain-specific composition. Do not let a second
  cable silently overwrite the first while both remain visible.
- For the current prototype, `single/replace` is the safest scalar-input rule;
  a drop onto an occupied input should preview “Replace WARMTH with PACE?” and
  be undoable. Artifact inputs should remain single and ordered through the
  work chain unless a step explicitly supports merge.

### 1.5 A cable should be inspectable

Max supports hovering to probe cord contents, as well as breakpoints and watch
points that reveal what flowed and can pause execution. [Cycling '74 — Patch
Cords](https://docs.cycling74.com/userguide/patch_cords/)

Bitwig makes modulation routings inspectable from both the source and the
target; it shows assigned and possible destinations during mapping and lets a
user clear one mapping or all mappings. [Bitwig — Unified Modulation
System](https://www.bitwig.com/userguide/latest/the_unified_modulation_system/)

**Implication for V2**

Selecting or focusing a cable should reveal:

- source and target;
- payload family;
- base/normal value;
- mapping/range/polarity or sampling rule;
- current effective value when a real value exists;
- remove, bypass, and reconnect actions.

Cable animation should mean observed activity only. Selection or focus should
use a steady highlight, not a fake pulse.

## 2. Device and Mod authoring workflows

### 2.1 Separate playable surface from mapping surface

Ableton Racks use Macro Controls to expose the most important parameters while
allowing the underlying device chain to be hidden. Mapping mode highlights
mappable parameters, shows assignments in a mapping browser, and supports
per-mapping minimum/maximum ranges and inversion. [Ableton Live 12 — Racks and
Macro Controls](https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/)

Bitwig similarly keeps modulation sources compact and reveals additional
parameters only when requested. It preserves manual control of the target and
shows both the modulation range and current value. [Bitwig — Unified
Modulation System](https://www.bitwig.com/userguide/latest/the_unified_modulation_system/)

**Implication for V2**

V2 needs two named working modes, even if they share one canvas:

- **PLAY / TRY** — tune controls, select presets, compare outcomes, inspect the
  prompt and plan; structural edits are de-emphasized.
- **BUILD / MAP** — add, remove, rename, configure speech, connect, set mapping
  range/polarity/sampling, change defaults, and author package metadata.

The current control-configuration popup is the seed of Build/Map mode. It
should not be the only place a user discovers whether a setting is connected,
what it says, or what default it uses. Keep essential state visible; put rare
mapping detail in an inspector.

### 2.2 Presets need identity, comparison, and scope

Ableton stores Rack Macro states as named variations that can be created,
launched, overwritten, renamed, duplicated, deleted, and selectively exclude
individual macros. [Ableton Live 12 — Macro Control
Variations](https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/)

Ableton separately distinguishes ordinary saved presets from default presets,
and asks before overwriting an existing default. [Ableton Live 12 — Working
with Instruments and Effects](https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/)

**Implication for V2**

The Explorer `SURVEY / BALANCED / DECIDE` chips validate the variation idea,
but every Mod package should expose the same coherent model:

- `Save variation…`
- `Update variation` with confirmation or undo
- `Duplicate`
- `Rename`
- `Delete`
- `Set as authored default`
- `Restore authored default`
- `Restore factory package`
- optional per-control `Keep when switching variations`

Variation changes should preview exactly which controls will move. Package,
Mod, and current-board defaults must never share one unlabeled “default” action.

### 2.3 Authoring needs ordinary reversible operations

VCV Rack provides undo/redo for all patch-editing actions, revert to the saved
state, periodic autosave, clear cables, and parameter reset to default.
[VCV Rack — Menu Bar](https://vcvrack.com/manual/MenuBar) and [VCV Rack — Key
Commands](https://vcvrack.com/manual/KeyCommands)

Bitwig applies cut, copy, duplicate, delete, move, replace, layer, and rename to
devices. [Bitwig — Working with
Devices](https://www.bitwig.com/userguide/latest/working_with_devices/)

**Implication for V2**

The prototype is not authoring-complete until these actions are consistently
available and undoable for controls, steps, visualizers, cables, groups,
sections, and packages:

- select; multi-select where useful;
- move and keyboard nudge;
- duplicate/copy/paste;
- delete with a recoverable undo;
- reset a parameter;
- restore a part or package;
- bypass/disable without destroying wiring;
- rename and add help/description text.

The existing TRIM spine reset is useful but too specialized to carry the whole
reset model. Every adjustable surface needs the same discoverable reset gesture
plus a visible command; exact value entry and fine adjustment are also standard
in VCV Rack. [VCV Rack — Key
Commands](https://vcvrack.com/manual/KeyCommands)

### 2.4 Live modulation must remain legible

Bitwig highlights current and potential targets during routing, keeps the
target's base control operable, and displays both modulation range and current
value. It also allows one source to address multiple destinations, each with
its own amount. [Bitwig — Unified Modulation
System](https://www.bitwig.com/userguide/latest/the_unified_modulation_system/)

**Implication for V2**

When a control is modulated, its face should distinguish:

- authored/base position;
- modulation span or mapping;
- current/effective position;
- source identity.

TRIM should remain “departure from authored default,” not double as a live
modulation meter. A dial/slider's own ring or track is the more local place to
show base versus effective value. If a process samples a curve only at stage
boundaries, label it `SAMPLED AT STAGE`, not `LIVE`.

## 3. Review of the 15 visualizers

External tools consistently treat meters, scopes, maps, and probes as views of
real values or flows. Ableton uses device meters to reveal low or absent
signals, while Max probes a cord's actual contents. [Ableton Live 12 — Working
with Instruments and Effects](https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/),
[Cycling '74 — Patch Cords](https://docs.cycling74.com/userguide/patch_cords/)

Therefore every V2 visualizer needs a visible provenance state. The following
review applies the evidence to each current part without changing its creative
form:

| Visualizer | Legitimate user job | Required truth/polish change |
| --- | --- | --- |
| Semantic Wave | Feel the combined character of several scalar settings | Label as a semantic preview, not measured output. Unwired rails must show normal/default values or an empty prompt; motion cannot imply a run. |
| Radar | Compare a small set of named qualities at once | Keep axis names and values visible/focusable; show authored versus effective shape if modulated; reject axes with incompatible units or explain normalization. |
| Levels | Compare magnitudes and remaining headroom | Name the scale and whether it is relative, normalized, or literal. “Headroom” must not imply a hard capacity unless one exists. |
| Matrix | Inspect source-to-target relationships | Cells need row/column headers, keyboard navigation, and an accessible table equivalent. Distinguish mapping existence from mapping strength. |
| Light Grid | See discrete commitment/notches | State denominator and current count; if interactive, expose each notch or one slider-like aggregate with exact value. Do not communicate state by light/color alone. |
| Bandings | See proportional composition | Show labels and percentages; declare whether values are normalized to 100%. Preserve readable labels at narrow widths. |
| Constellation | Inspect coherence/scatter metaphorically | Call it a preview or heuristic. Expose the contributing controls and text summary; never present generated geometry as measured semantic truth. |
| Branches | Preview breadth, depth, pruning, and likely selection | Treat as a plan/scenario. Do not animate as executed search without run events. Label estimated/conditional branch counts and expose the formula. |
| Window | Reconcile lower/upper constraints and contradictions | Name every bound and contradiction in text. Contradiction is a persistent state, not a transient flash. Offer a jump to the conflicting controls. |
| Score | See how qualities are intended to vary across an answer | Label horizontal domain (`START → END`, stages, or sections) and curve interpolation. It is authored shape, not observed prose analysis unless backed by output data. |
| Readout | Surface one headline value | Always include name, value, and unit/meaning; do not show a plausible fallback as live data. |
| Readout Pair | Compare two headline values | State the relationship: independent, ratio, range, or trade-off. Do not imply comparability when units differ. |
| Beam | Understand a two-sided trade-off | Label both poles and neutral point; expose exact value and keyboard reset. Motion should track input only. |
| Trim | See departure from authored defaults and reset deliberately | Preserve a stable shared scale, show signed deltas and current/default values, and make reset available beyond the small spine target. Do not use it as a modulation display. |
| Steps | Read the compiled spoken shape/process sequence | Clearly label `PROMPT PREVIEW` or `PLAN`. Provide ordered text, call/step identity, and source links; do not imply completed work. |

### Global visualizer states

Every visualizer should implement the same state grammar:

1. **Empty** — no required input and no declared normal value.
2. **Default preview** — unwired, driven by named normal/authored defaults.
3. **Connected preview** — real current authored/modulated inputs, but no run.
4. **Plan** — deterministic intended structure.
5. **Running** — only when runtime events exist.
6. **Observed result** — derived from a completed run, with run identity.
7. **Error/contradiction** — persistent, explained, and actionable.

Only the states that make sense for a given visualizer need appear. The key is
that visually similar animation must not stand for several different truths.

## 4. Review of controls, process primitives, steps, and packages

### 4.1 All controls need a shared contract

VCV Rack's component API configures a parameter's range, default, label, unit,
and optional description, and its UI exposes exact entry and reset. [VCV Rack —
Plugin API Guide](https://vcvrack.com/manual/PluginGuide), [VCV Rack — Key
Commands](https://vcvrack.com/manual/KeyCommands)

Apply the following minimum contract to all 13 V2 control kinds (`DIAL`,
`SLIDER`, `SWITCH`, `COUNT`, `WORDS`, `PAD`, `RANGE`, `FILTER`, `CURVE`,
`SELECT`, `ORDER`, `MIXER`, `GROUP VOICE`):

- durable name and one-sentence purpose;
- type, range/domain, unit, exact current value, authored default;
- clear low/high or off/on semantics;
- reset and exact entry where applicable;
- keyboard and touch operation;
- compiled sentence preview and silent/invalid state;
- incoming/outgoing mapping inspection;
- validation before contradictory or impossible values compile;
- consistent selected, hover, focus, disabled, modulated, error, and default
  states.

Specific cautions:

- `PAD` needs separately named X/Y values and keyboard control per axis.
- `RANGE` and `FILTER` need explicit inclusive/exclusive semantics and a text
  statement of the active rule.
- `CURVE` needs point selection, exact point values, interpolation, add/remove,
  and a non-pointer editing route.
- `ORDER` needs move-up/move-down actions in addition to drag.
- `MIXER` needs a declared total/normalization rule.
- `GROUP VOICE` should explain why one silent member suppresses the whole
  sentence and offer a repair path; silent gating must not look like data loss.

### 4.2 Process primitives must distinguish authoring from execution

VCV defines trigger signals as short gates that cause an event, distinct from
continuous CV. Max similarly separates scheduled messages from continuously
evaluated signal networks. [VCV Rack — Getting
Started](https://vcvrack.com/manual/GettingStarted), [Cycling '74 — How MSP
Works](https://docs.cycling74.com/max7/tutorials/03_msphowmspworks)

**Implications**

- `STAGE` is an authored coordinate or named stop until a run emits an actual
  stage event. Its UI should say whether it selects, previews, or reports.
- `FORK` defines a decision policy and possible routes. Before execution it
  should show conditions and possible calls, not a chosen historical route.
- `REVISE` defines a guarded loop. Its pass count is a maximum/condition before
  execution and an observed count afterward. These must never share one label.
- The seven step modules (`EXPLORE`, `CLUSTER`, `CRITIQUE`, `COMPRESS`,
  `REFRAME`, `DEVELOP`, `COMBINE`) should consistently expose `WORK IN`,
  `WORK OUT`, optional scalar inputs, purpose text, empty-input behavior,
  failure behavior, and how their prompt instruction enters the compiler.

### 4.3 The seven packages need a common lifecycle

The current palette lists seven “Start with a Mod” packages: Translator,
Narrator, Explorer, Anchor, Skeptic, Storyteller, and Editor. The source comment
calling them “THE SIX PACKS” is stale and should not become product language.

Each package should ship with:

- a one-sentence job and an example outcome;
- factory defaults and at least two purposeful named variations;
- a compact front panel and inspectable underlying parts/mappings;
- an authored-default/reset model;
- a completeness check for required text inputs;
- a package-level duplicate, rename, bypass, delete, and restore action;
- a clear list of prompt sections and process effects it contributes;
- a narrow-layout arrangement that preserves reading/patch direction.

### Repo-contract resolution: signal compatibility vs family mismatch

External tools support both typed rejection and permissive signal patching,
but this prototype has a locked local contract in
`docs/design/prototypes/lib/DESIGN.md`: scalar, span, and series signals use a
total coercion matrix, while the square artifact family and round signal family
are visibly non-mating and refuse each other without an error state. Iteration
6 follows that repo contract. Accessibility comes from redundant glyph,
direction, family, and connected-state names—not an error toast that would
contradict the visual language.

### Repo-contract resolution: REVISE stays in the compiler

External workflow evidence establishes that a guarded loop has an authored
maximum before execution and an observed count only afterward. The local
engine-surface contract further fixes how this prototype represents that fact:
`docs/design/mods/engine-surface-boundary.md` requires one compiled REVISE card
(`Draft … read it back … up to N passes`) and silence at zero. Therefore V2
does not add a REVISE plan track or pre-run call count. An observed pass/call
trace remains runtime work outside this prototype.

Package-specific validation questions for the next build iteration:

| Package | Must answer before “polished” |
| --- | --- |
| Translator | Can a user describe the reader, expertise, and reading mode without generating contradictory assumptions? |
| Narrator | Can a user see the combined voice and the exact sentences each tone control contributes? |
| Explorer | Do named postures preview changed values, and is branch count labeled planned/estimated rather than executed? |
| Anchor | Does the constellation admit that coherence is heuristic, and can the user see which rule pulled a point away? |
| Skeptic | Are source count, evidence strength, doubt, speculation, and countercase independent and compilable without overclaiming verification? |
| Storyteller | Are curves described as intended answer shape, with exact points and an accessible editor? |
| Editor | Do hard constraints surface contradictions persistently and jump directly to the two settings that conflict? |

## 5. Truthful process and run-plan visualization

### 5.1 A definition, a plan, and an execution are separate artifacts

AWS Step Functions separates the declarative state-machine definition from an
execution's status, timestamps, inputs/outputs, transition count, and complete
event history. Its graph is a representation of workflow logic; execution
details are recorded only after a run. [AWS — Workflow states](https://docs.aws.amazon.com/step-functions/latest/dg/workflow-states.html),
[AWS — Viewing execution details](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)

**Implication for V2**

Use explicit nouns and provenance:

- `PROMPT` — compiled instructions;
- `PLAN` — intended calls, possible paths, limits, and sampling points;
- `RUN` — one identified execution;
- `TRACE` — observed events/calls from that run;
- `RESULT` — artifacts emitted by that run.

`THE PLAN` may be deterministic about structure without claiming a route was
taken. It should not use pulsing, elapsed time, success color, “completed,” or
past-tense language unless connected to runtime events.

### 5.2 Conditional branches make pre-run counts conditional

In Step Functions, a Choice state evaluates rules at runtime and transitions to
the matching next state; a recommended default handles the no-match case.
[AWS — Choice workflow state](https://docs.aws.amazon.com/step-functions/latest/dg/state-choice.html)

**Implication for V2**

- A Fork plan should show every possible route and its condition/policy.
- Before evaluation, display a range or qualified count such as `2 BASE CALLS
  + 1 OF 3 BRANCHES`, not one exact historical total.
- During a run, mark only the selected route and retain the rejected possibilities
  as plan context.
- After a run, show the observed branch, decision input/reason where available,
  and actual calls. Do not redraw the plan as if alternatives never existed.

### 5.3 Iteration count depends on data and policy

Step Functions' Map state runs the same workflow steps for each item in an
input dataset; the number of executions follows the dataset, and each iteration
has inspectable execution history. [AWS — Map workflow
state](https://docs.aws.amazon.com/step-functions/latest/dg/state-map.html)

Retry policies separately declare a maximum number of attempts and conditions;
the actual number of retries is known only from execution history. [AWS —
Handling errors](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-error-handling.html)

**Implication for V2**

- `REVISE` must label its authored bound as `UP TO N REVISIONS` or `MAX N
  PASSES`, not `N CALLS`.
- If every pass necessarily contains draft, judge, and revise calls, show the
  formula and a min/max call range. If the guard can stop early, exact calls are
  unknown before execution.
- After execution, show `2 OF 4 PASSES USED`, with per-pass result/status, and
  calculate calls from trace events rather than the authored maximum.
- A branch-search count must say whether it is breadth, candidates generated,
  candidates evaluated, survivors, or final selections. These are not
  interchangeable.

### 5.4 Loops and branches need both graph and table/text views

Step Functions offers graph, table, tree, timeline, and event-history views;
individual branch/iteration nodes carry name, type, status, and detail. [AWS —
Viewing execution details](https://docs.aws.amazon.com/step-functions/latest/dg/concepts-view-execution-details.html)

**Implication for V2**

The visual plan should have an adjacent ordered text/table equivalent that
lists:

- stable step/call identity;
- type (`CALL`, `CHOICE`, `LOOP`, `TRANSFORM`);
- prerequisite/input artifact;
- possible next states;
- condition or maximum;
- planned versus observed status;
- output artifact when observed.

This also supplies the nonvisual alternative required for accessibility and
makes cycles, fan-out, skipped stages, and dropped steps testable. A compiler
that cannot serialize its plan to this list should not claim the diagram is a
complete run plan.

## 6. Accepted, rejected, and conditional design claims

### Accepted

- **Keep patch cords and visible modulation.** Established modular and DAW
  systems use them to make relationships inspectable. [VCV Rack — Getting
  Started](https://vcvrack.com/manual/GettingStarted), [Bitwig — Unified
  Modulation System](https://www.bitwig.com/userguide/latest/the_unified_modulation_system/)
- **Keep typed signal and artifact families.** Max validates distinct cord
  semantics, although V2 must teach its own types explicitly. [Cycling '74 —
  Patch Cords](https://docs.cycling74.com/userguide/patch_cords/)
- **Keep compact package surfaces backed by deeper authoring.** Ableton Racks
  validate hiding internal complexity behind mapped macros. [Ableton Live 12 —
  Racks](https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/)
- **Keep named Explorer postures and extend the model.** Ableton variations
  validate named snapshots with create/update/duplicate/delete semantics.
  [Ableton Live 12 — Macro Control
  Variations](https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/)

### Rejected

- **“Animated means connected/live.”** Official patch systems expose actual
  connection and meter/probe state; animation without data is misleading.
- **“A cable can fail silently because incompatible ports are visually
  different.”** Established mapping tools explicitly highlight destinations
  and expose mappings; V2 needs immediate reasoned feedback.
- **“Default” is one concept.** Normal/unwired value, authored default, factory
  default, current value, and effective modulated value are different states.
- **“The plan's call count is the run's call count.”** Branches and guarded
  revision make pre-run counts conditional unless the engine has already
  resolved every decision.

### Conditional

- **Allow multiple cables into one scalar input only** after a composition rule
  and value display exist.
- **Show continuously moving visualizers only** when the motion is explicitly
  labeled as semantic preview or is driven by actual runtime values.
- **Let a visualizer write back into controls only** in a named edit/mapping
  mode, with focus semantics, undo, and a visible base/effective distinction.

## 7. Implementation gates derived from this research

Before a material V2 change lands, verify:

- [ ] Port direction and payload type have text/accessibility equivalents.
- [ ] Invalid patching produces an immediate, specific reason.
- [ ] Unwired, default-driven, connected, planned, running, and observed states
      are not conflated.
- [ ] Every adjustable part exposes value, domain/unit, default, reset, and
      keyboard operation.
- [ ] Every structural edit is undoable.
- [ ] Package/variation/factory/authored defaults are separately named.
- [ ] Modulation shows source, base value, effective value, and mapping rule.
- [ ] Branch and revise counts distinguish possible/maximum from observed.
- [ ] Every visualizer has an accessible name, summary, and source-value route.
- [ ] Desktop, narrow, keyboard-only, screen-reader, and touch alternatives are
      covered by the accompanying standards findings.

## Primary-source bibliography

- [Ableton Live 12 — Instrument, Drum and Effect Racks](https://www.ableton.com/en/live-manual/12/instrument-drum-and-effect-racks/)
- [Ableton Live 12 — Working with Instruments and Effects](https://www.ableton.com/en/live-manual/12/working-with-instruments-and-effects/)
- [Bitwig — The Unified Modulation System](https://www.bitwig.com/userguide/latest/the_unified_modulation_system/)
- [Bitwig — Working with Devices](https://www.bitwig.com/userguide/latest/working_with_devices/)
- [Cycling '74 — How MSP Works](https://docs.cycling74.com/max7/tutorials/03_msphowmspworks)
- [Cycling '74 — Patch Cords](https://docs.cycling74.com/userguide/patch_cords/)
- [Make Noise — Shared System Manual](https://www.makenoisemusic.com/wp-content/uploads/2024/03/bg-sharedsystemmanual.pdf)
- [VCV Rack — Getting Started](https://vcvrack.com/manual/GettingStarted)
- [VCV Rack — Key Commands](https://vcvrack.com/manual/KeyCommands)
- [VCV Rack — Menu Bar](https://vcvrack.com/manual/MenuBar)
- [VCV Rack — Plugin API Guide](https://vcvrack.com/manual/PluginGuide)
- [VCV Rack — Port API](https://vcvrack.com/docs-v2/structrack_1_1engine_1_1Port)
- [VCV Rack 2.5 release notes](https://vcvrack.com/news/2024-04-21-Rack-2.5)
