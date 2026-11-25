# Mod Workbench V2 — accessibility and truthful workflow evidence

Status: specialist research lane, 2026-07-16
Scope: accessibility semantics for custom controls, drag/patch alternatives,
canvas/SVG visualizers, and truthful plan/run representation.
Method: primary sources only (W3C/WHATWG/OMG/OpenTelemetry). This report does
not propose a new visual direction; it defines behavioral and semantic gates
for polishing the existing instrument-flat workbench.

## Executive decision

Keep the physical-instrument surface, but make every graphical gesture an
enhancement over an explicit operable model. The product must distinguish:

1. **Authored shape** — what the Mod author configured.
2. **Compiled plan** — possible or budgeted calls before execution.
3. **Observed run** — operations and artifacts actually recorded during one
   execution.

This follows two independent bodies of primary evidence. WCAG requires the
same function to remain operable without drag-only or pointer-only input, and
requires equivalent text for informative graphics
([WCAG 2.2, 2.1.1, 2.5.7 and 1.1.1](https://www.w3.org/TR/WCAG22/)). BPMN
separates conditional, exclusive, inclusive, parallel, and loop execution
semantics, while OpenTelemetry defines traces/spans as records of actual
operations with timestamps; neither supports presenting a design-time drawing
as proof of a completed run
([BPMN 2.0.2](https://www.omg.org/spec/BPMN/2.0.2/PDF),
[OpenTelemetry tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/)).

## A. Accessibility findings and direct implications

### A1. All functions need keyboard operation; drag needs a simple-pointer alternative

- WCAG 2.2 requires all functionality to be keyboard-operable unless the
  *underlying function* truly depends on a movement path; selecting an item,
  placing it at an endpoint, changing a value, or connecting two endpoints does
  not inherently depend on a drawn path
  ([WCAG 2.2, SC 2.1.1](https://www.w3.org/TR/WCAG22/#keyboard)).
- WCAG 2.2 also requires every drag operation to have a single-pointer method
  that does not require dragging. W3C examples include selecting an item and
  then selecting its destination, and move buttons for reordering
  ([Understanding SC 2.5.7](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements)).

Direct implications for
[`mod-workbench-v2.html`](../../../docs/design/prototypes/mod-workbench-v2.html):

- The palette entries at source lines 842–902 are draggable `div` elements.
  Keep drag-to-place, but expose each as a real button (or a button inside a
  list item) so click, `Enter`, or `Space` adds it. Announce the new part and
  move focus to it or provide a predictable “added” action target.
- Board movement currently depends on pointer drag. Add a focused-part command
  surface: **Move**, arrow-key movement by grid cell, and direct **Position**
  fields. Pointer drag may remain the fast path.
- Cable patching currently starts from pointer events on jacks. Add a two-step
  path: activate **Connect from [source]**, then choose a compatible destination
  from a labelled list or activate a destination jack. Add **Disconnect** and
  **Replace connection** actions without requiring a cable gesture.
- Reordering prompt cards/sections needs Move earlier/later commands in
  addition to tactile drag. The alternative should update the same ordering
  model so pointer and keyboard can never disagree.
- Do not use deprecated ARIA drag states as the solution. WAI-ARIA 1.2 marks
  `aria-grabbed` and `aria-dropeffect` deprecated; provide ordinary operable
  controls and state announcements instead
  ([WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)).

### A2. Target size: 24 CSS px is the AA floor; 44 CSS px is the robust target

- WCAG 2.2 AA requires pointer targets to be at least 24×24 CSS px or meet its
  spacing/equivalent-control exceptions
  ([SC 2.5.8](https://www.w3.org/TR/WCAG22/#target-size-minimum)).
- WCAG 2.2 AAA sets 44×44 CSS px for targets, specifically improving touch and
  limited-dexterity operation
  ([SC 2.5.5](https://www.w3.org/TR/WCAG22/#target-size-enhanced)).

Direct implications:

- Treat 24×24 CSS px as a release gate for every jack, resize handle, remove
  control, colour/config button, palette entry, step fidelity chip, plan action,
  and visualizer action. Spacing exceptions must be measured, not assumed.
- Target 44×44 CSS px for frequent or consequential actions: adding parts,
  patching, choosing run posture, moving parts, and delete/undo. The visible
  glyph may stay small; its hit area can grow invisibly without diluting the
  instrument-flat look.
- Dense jack clusters need either 24 px non-overlapping hit regions or an
  equivalent 44 px connection menu. A tiny visible port plus a large invisible
  overlapping hit box is not sufficient because overlapping targets create
  ambiguity.

### A3. Sliders, dials, stages, and ranges need value semantics, not only graphics

- The ARIA slider pattern requires a focusable slider with `aria-valuemin`,
  `aria-valuemax`, `aria-valuenow`, an accessible name, and `aria-valuetext`
  when the numeric value is not user-friendly. Arrow keys change one step;
  `Home`/`End` set extrema; `Page Up`/`Page Down` are optional larger steps
  ([WAI-ARIA APG slider](https://www.w3.org/WAI/ARIA/apg/patterns/slider/)).
- A multi-thumb range requires **each thumb** to be focusable and to expose its
  own constrained min/max/current value; tab order remains stable regardless
  of thumb position
  ([WAI-ARIA APG multi-thumb slider](https://www.w3.org/WAI/ARIA/apg/patterns/slider-multithumb/)).
- W3C warns that custom slider gestures can be unreliable with touch assistive
  technology and says production use must be tested on touch-primary devices
  ([WAI-ARIA APG slider warning](https://www.w3.org/WAI/ARIA/apg/patterns/slider/#about-this-pattern)).

Direct implications:

- The current dial and one-thumb slider have a promising base: focus, arrow
  keys, min/max/current value. Add `aria-valuetext` for authored bands and named
  stops, especially STAGE: announce “Organising, 2 of 3,” not “50.”
- Add `Page Up`/`Page Down` for useful coarse adjustment and expose the same
  coarse/fine convention consistently across dials and sliders. Do not make
  `Shift` the only discoverable way to adjust coarsely.
- The current RANGE is a focusable `role="group"` with no keyboard operation
  and no independently exposed low/high values. Replace its accessibility
  surface with two stable, labelled slider thumbs (Low/High), plus optional
  numeric fields; preserve the existing visual rail.
- FILTER should expose Mode as a real named choice and each active threshold as
  a focusable value control. A graphical `group` does not communicate its
  values or make its edges operable.
- A 2D PAD has no standard “two-axis slider” role. Preserve the pad for direct
  manipulation, but provide labelled X and Y sliders/fields as an equivalent
  editor. Its `role="group"` alone conveys neither current values nor actions.
- CURVE needs a structured point editor: select a point, edit position/value,
  add, remove, and move earlier/later. Double-press deletion must not be the
  only removal path. ORDER and MIXER similarly need keyboard-operable list/value
  editors backed by the same state as their graphical surfaces.

### A4. Composite controls need one coherent focus model

- WAI-ARIA requires authors to manage focus for composite roles and keep a
  consistent active descendant when users leave and return. Every interactive
  part must be focusable or have a documented equivalent method
  ([WAI-ARIA 1.2, Managing Focus](https://www.w3.org/TR/wai-aria-1.2/#managingfocus)).
- APG recommends one tab stop for a composite, with roving `tabindex` or
  `aria-activedescendant`; arrow-key behavior should follow the familiar
  pattern for that widget
  ([APG keyboard interface](https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/)).
- A toolbar containing three or more related controls should normally be one
  tab stop with arrow-key navigation, while avoiding conflicts with sliders
  that need the same arrow keys
  ([APG toolbar pattern](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)).

Direct implications:

- Define the keyboard hierarchy before adding more `tabindex="0"`: page
  regions → board parts → controls/actions within a part. A user should not
  tab through dozens of ports and chrome buttons just to reach Prompt or Plan.
- The mod-level ONE PASS / IN STAGES radiogroup already updates
  `aria-checked`, but both radio buttons remain ordinary tab stops. Use native
  radios or roving tabindex; arrow keys move/check, `Tab` enters/exits once.
- Each part’s colour, configure, remove, and fidelity actions can be a labelled
  toolbar only if their arrow keys do not steal input from the part’s slider.
  A simpler alternative is a single **Part actions** menu.
- Keep visible focus distinct from selected, connected, patched, favoured,
  default, and currently edited states. Do not use accent colour alone for any
  of those distinctions.

### A5. Dialog/popover behavior must match its semantics

- A modal dialog moves focus inside on open, contains the tab sequence, closes
  on `Escape`, makes the rest of the page inert, has an accessible name and a
  visible close action, and generally restores focus to the invoking control
  ([APG modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)).

Direct implications:

- The configuration popup currently uses `role="dialog"`, focuses its first
  field, and handles `Escape`, but does not behave as a modal. Choose one model
  deliberately: (a) a true modal with focus containment/inert background and a
  visible close button, or (b) a non-modal anchored popover with explicit
  popover semantics and reliable focus return. Do not label it modal unless
  background interaction is actually prevented.
- The colour swatch popup currently has neither a dialog identity nor an
  explicit composite focus model. Give it a named group/list of colour buttons,
  move focus into it when opened, support `Escape`, and restore the opener.
- Closing any popup because its owner part was deleted must send focus to the
  nearest logical part or board action, as WAI-ARIA advises after removal of a
  focused element
  ([WAI-ARIA 1.2, Managing Focus](https://www.w3.org/TR/wai-aria-1.2/#managingfocus)).

### A6. Canvas and SVG visualizers require equivalent, current text

- WCAG 1.1.1 requires a text alternative serving the equivalent purpose of
  informative non-text content. For a complex chart/diagram, W3C recommends a
  short identification plus a longer equivalent description and, when
  practical, the underlying data in a table
  ([Understanding SC 1.1.1](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content.html)).
- WHATWG requires canvas fallback content that conveys essentially the same
  function or purpose. An interactive canvas should have a one-to-one mapping
  between interactive regions and focusable fallback elements
  ([HTML Standard, canvas](https://html.spec.whatwg.org/multipage/canvas.html#the-canvas-element)).
- SVG 2 makes direct-child `title` and `desc` text available through
  accessibility APIs; meaningful substructures should be grouped and named,
  while purely presentational groups need no alternative text
  ([SVG 2, `title` and `desc`](https://www.w3.org/TR/SVG/struct.html#DescriptionAndTitleElements)).

Direct implications for all 15 visualizers:

- Give every visualizer shell a stable visible title and a generated textual
  summary that states **what question it answers**, its connected inputs, the
  current interpreted values, and whether it is authored, planned, or observed.
- Canvas visualizers (including WAVE and BRANCHES) need fallback content inside
  the canvas or an explicitly associated adjacent summary. If the adjacent
  summary is complete, mark the bitmap presentation as redundant so assistive
  technology does not encounter an unnamed object.
- SVG visualizers need a top-level `title`/`desc` or an associated HTML summary.
  Name only meaningful groups (series, axes, branch alternatives), not every
  decorative tick/dot. Do not rely on SVG `<text>` nodes being discovered in a
  useful reading order.
- For MATRIX, SCORE, LEVELS, BANDINGS, READOUT/PAIR, BEAM, TRIM, WINDOW, GRID,
  RADAR, CONSTELLATION and STEPS, expose current source/value pairs as semantic
  HTML (list/table/definition list) and treat the drawing as the alternate
  spatial view. A visual change must update the text from the same state.
- A visualizer that supports direct manipulation must have equivalent labelled
  controls. A descriptive paragraph alone does not replace input functionality.

## B. Workflow and process-graph findings

### B1. Use a three-state evidence model: authored, planned, observed

- BPMN uses theoretical tokens to define the behavior of a process diagram and
  explicitly says execution tools need not implement literal tokens. A diagram
  is therefore a behavioral model, not execution evidence
  ([BPMN 2.0.2, “Understanding the Behavior of Diagrams”](https://www.omg.org/spec/BPMN/2.0.2/PDF)).
- OpenTelemetry defines a span as one recorded operation with parentage,
  timestamps, attributes, events and status. Start/end timestamps reflect the
  real operation; a trace is a tree of related observed spans
  ([OpenTelemetry tracing API, Span](https://opentelemetry.io/docs/specs/otel/trace/api/#span)).
- Sampling deliberately reduces the spans collected/exported, so even a trace
  view cannot claim exhaustive counts unless the instrumentation and sampling
  policy guarantee completeness
  ([OpenTelemetry tracing SDK, Sampling](https://opentelemetry.io/docs/specs/otel/trace/sdk/#sampling)).

Direct implications:

- Add an always-visible evidence badge to each process representation:
  **AUTHORED**, **PLANNED**, or **OBSERVED RUN**. Colour is supplementary; the
  word is required.
- Keep **THE PLAN** deterministic and static. Never animate it as if executing.
  If a future run view exists, populate it only from engine events/spans, show a
  run identity/time, and label incomplete telemetry.
- The BRANCHES visualizer is currently described in source as “drawn before the
  search runs.” Its user-facing title/summary must say **planned search shape**.
  Synthetic scores, pruned stubs, and a “winner” are previews, not outcomes.
- STAGE currently asks “Where in the work are we right now?” That wording is a
  runtime claim. In authoring, rename the question to “Which phase should this
  setting describe/apply to?” or “Preview phase.” Reserve “current stage” and
  `aria-current="step"` for an observed live run
  ([WAI-ARIA 1.2, `aria-current`](https://www.w3.org/TR/wai-aria-1.2/#aria-current)).

### B2. Branches must disclose exclusive, inclusive, or parallel semantics

- A diverging **exclusive** gateway takes only one path for a process instance;
  if no condition matches, an optional default path is taken, otherwise
  execution errors
  ([BPMN 2.0.2, §10.6.2](https://www.omg.org/spec/BPMN/2.0.2/PDF)).
- A diverging **inclusive** gateway evaluates every condition and can take any
  combination of matching paths; a **parallel** gateway takes every outgoing
  path without evaluating conditions and waits for all incoming paths when
  joining
  ([BPMN 2.0.2, §§10.6.3–10.6.4](https://www.omg.org/spec/BPMN/2.0.2/PDF)).
- A conditional flow is traversed only if its Boolean condition is true; a
  default flow is traversed only when the other outgoing conditions are false
  ([BPMN 2.0.2, §8.5.1](https://www.omg.org/spec/BPMN/2.0.2/PDF)).

Direct implications:

- The current FORK should explicitly mean **choose one** if it is exclusive.
  Show its question/condition, all possible paths, and the default/failure case.
  Do not present the currently favoured path as already selected unless the
  author has explicitly forced it.
- If Mods need “run all” or “run every matching path,” create separately named
  semantics (Parallel and Any matching, or equivalent plain language). Do not
  hide these materially different costs behind the same fork icon.
- Before execution, render a conditional branch as **selected at run** and show
  a call budget/range. After execution, an observed run may mark the selected
  path and skipped alternatives, with evidence from that run.
- Where no condition matches and no default exists, surface a plan validation
  error rather than silently choosing the visually favoured branch.

### B3. Loop counts are exact only in narrow cases

- BPMN standard loops repeat while a Boolean condition remains true; a numeric
  maximum is a cap, not a promise. The condition can be tested before or after
  each iteration
  ([BPMN 2.0.2, §10.3.8](https://www.omg.org/spec/BPMN/2.0.2/PDF)).
- BPMN multi-instance activities may have exact cardinality from an integer
  expression or data collection and may execute sequentially or in parallel.
  If the cardinality/condition is merely documented and not executable, the
  model cannot be formally executed
  ([BPMN 2.0.2, §10.3.8](https://www.omg.org/spec/BPMN/2.0.2/PDF)).

Direct implications:

- REVISE “up to N” is a guarded loop. Render a budget such as **1 draft + up to
  N check/revise cycles**, not `CHECK ×N` as an unconditional actual count.
- The plan pill currently counts rendered segments, so a `CHECK ×N` segment
  contributes one “CALL” regardless of N. Replace the single scalar with a
  truthful formula or range derived from the same execution contract. Define
  whether checking and revising are one model call or two; the UI cannot infer
  that from prose.
- Use **exactly N** only for a fixed, executable cardinality. Use **up to N** for
  capped condition loops, **0..N** when the condition is tested before the
  first iteration, and **1..N** when one iteration necessarily occurs. Use
  **unknown until run** when no finite cap is defined.
- If parallel calls are supported, distinguish total call count from sequential
  depth; “4 calls” and “4 stages” are not equivalent cost/time statements.

### B4. Artifact wires are dependencies, not completion evidence

- W3C PROV defines an Activity as something occurring over time that uses or
  generates Entities; `used`, `wasGeneratedBy`, and `wasInformedBy` form
  provenance chains
  ([W3C PROV-O](https://www.w3.org/TR/prov-o/#description-starting-point-terms)).

Direct implications:

- Keep square artifact cables: they communicate a valuable data-dependency
  family distinct from scalar modulation. But label them as **artifact input →
  transform → artifact output**, not as evidence the transform has run.
- In Plan, an artifact cable determines order/dependency. In Observed Run, link
  actual artifact identities and the operation that generated each one. A
  configured empty input must be distinguishable from an observed missing or
  failed artifact.
- Detect cycles in step chains before rendering call order. A cycle is not a
  valid linear plan merely because the diagram can draw it; require explicit
  loop semantics and a guard/cap.

## C. Required implementation gates for this prototype

These are evidence-backed acceptance checks, not optional polish:

1. **Keyboard-only authoring:** add, select, configure, move, resize (or choose
   an equivalent size), connect, disconnect, reorder, edit, remove, undo, and
   inspect Prompt/Plan without pointer drag
   ([WCAG 2.2, SC 2.1.1](https://www.w3.org/TR/WCAG22/#keyboard)).
2. **Single-pointer non-drag authoring:** every draggable outcome has click/tap
   controls
   ([WCAG 2.2, SC 2.5.7](https://www.w3.org/TR/WCAG22/#dragging-movements)).
3. **Target audit:** automated bounding-box report plus hands-on touch check;
   24 px AA floor, 44 px preferred for primary/destructive actions
   ([WCAG 2.2, SC 2.5.8](https://www.w3.org/TR/WCAG22/#target-size-minimum)).
4. **Control semantics:** Accessibility-tree inspection confirms name, role,
   value/state, and keyboard behavior for each control kind; RANGE exposes two
   thumbs, named-stage sliders expose value text
   ([APG slider patterns](https://www.w3.org/WAI/ARIA/apg/patterns/slider/)).
5. **Popup focus:** open, tab through, escape, outside-close, owner deletion,
   and focus restoration are tested for configure and colour surfaces
   ([APG dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)).
6. **15 visualizer alternatives:** each has a current generated summary; every
   interactive graphic has equivalent controls; canvas fallback and SVG naming
   are checked in the accessibility tree
   ([WHATWG canvas](https://html.spec.whatwg.org/multipage/canvas.html#the-canvas-element),
   [SVG 2](https://www.w3.org/TR/SVG/struct.html#DescriptionAndTitleElements)).
7. **Truthful plan fixtures:** exclusive branch, no-match branch, parallel
   branch, fixed cardinality, capped pre-test loop, capped post-test loop,
   uncapped loop, and cyclic artifact graph all produce explicit and correct
   plan labels/count ranges
   ([BPMN 2.0.2](https://www.omg.org/spec/BPMN/2.0.2/PDF)).
8. **No runtime theatre:** before a real engine run, no UI says “running,”
   “completed,” “winner,” exact elapsed time, or exact actual calls. Observed
   claims require a run ID and recorded operation evidence; sampling/incomplete
   telemetry is disclosed
   ([OpenTelemetry tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/),
   [OpenTelemetry sampling](https://opentelemetry.io/docs/specs/otel/trace/sdk/#sampling)).

## D. Rejected shortcuts

- **“The prototype is visual, so an ARIA label on the canvas is enough.”**
  Rejected: complex visualizers need equivalent information, and interactive
  regions need equivalent functionality
  ([WCAG 1.1.1](https://www.w3.org/TR/WCAG22/#non-text-content),
  [WHATWG canvas](https://html.spec.whatwg.org/multipage/canvas.html#the-canvas-element)).
- **“Click-to-add makes the whole workbench accessible.”** Rejected: it covers
  one palette action, not movement, patching, resizing, curve editing, range
  editing, or reordering
  ([WCAG 2.1.1](https://www.w3.org/TR/WCAG22/#keyboard)).
- **“A plan diagram may show the branch it expects to win.”** Rejected unless
  visibly labelled as a simulation/preview; an exclusive condition selects a
  path for a process instance at execution
  ([BPMN 2.0.2, §10.6.2](https://www.omg.org/spec/BPMN/2.0.2/PDF)).
- **“Up to N” can be displayed as N calls.”** Rejected: a loop maximum is a cap,
  while runtime loop counters are execution state
  ([BPMN 2.0.2, §10.3.8](https://www.omg.org/spec/BPMN/2.0.2/PDF)).

## Primary-source index

- [W3C Web Content Accessibility Guidelines 2.2](https://www.w3.org/TR/WCAG22/)
- [W3C WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)
- [W3C ARIA Authoring Practices Guide](https://www.w3.org/WAI/ARIA/apg/)
- [WHATWG HTML Standard — canvas](https://html.spec.whatwg.org/multipage/canvas.html#the-canvas-element)
- [W3C SVG 2 — document structure](https://www.w3.org/TR/SVG/struct.html#DescriptionAndTitleElements)
- [OMG BPMN 2.0.2 formal specification](https://www.omg.org/spec/BPMN/2.0.2/PDF)
- [OpenTelemetry tracing API](https://opentelemetry.io/docs/specs/otel/trace/api/)
- [OpenTelemetry tracing SDK / sampling](https://opentelemetry.io/docs/specs/otel/trace/sdk/#sampling)
- [W3C PROV-O](https://www.w3.org/TR/prov-o/)
