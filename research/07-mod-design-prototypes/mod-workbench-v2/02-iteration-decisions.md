# Mod Workbench V2 — implementation decision log

Status: complete
Purpose: durable rationale and browser evidence for each convergent polish pass.

## Iteration 1 — one reachable authoring loop

Problem: the 45-row palette pushed the compiler below the fold and the page
did not expose a stable Mod identity, workbench status, or navigation between
the board, prompt, and plan.

Decision: preserve the single instrument surface, but add a compact sticky
identity/status header, region jumps, a searchable accordion parts library,
and click/keyboard placement at the next open board cell.

Evidence: browser measurement at 1440 px reduced the open palette from roughly
1906 px to 547 px and moved the compiler from roughly y=1982 to y=1059. No page
errors were observed.

## Iteration 2 — authored meaning and safe composition

Problem: users could tune mechanics but could not see or edit where a control
speaks, what it says, or which default was being changed. Package clicks were
described as starting a Mod even though they appended content, and section
deletion could orphan staged or grouped parts.

Decision:

- put prompt section, authored sentence/frame, live sentence preview, and
  `SET AUTHORED DEFAULT` in control configuration;
- call the seven templates `MOD PACKS`, prevent accidental duplicate insertion,
  and focus/scroll to the inserted pack;
- prevent removal of sections that still own any ordinary, grouped, silent, or
  staged part;
- make prompt cards keyboard-editable;
- label the surface `PROMPT PREVIEW` rather than claiming it is ready to run.

Browser evidence: palette search returned only RADAR for `radar`; a second
Translator insertion left the item count unchanged; the seed rendered with no
page errors and all 12 prompt cards exposed keyboard edit roles.

## Iteration 3 — truthful plans and visualizer provenance

Problem: FORK displayed the leaned route as if selected, the first REVISE
experiment risked presenting guarded work as an observed count, independent
staged curves disappeared when a work chain existed, artifact cycles/fan-out
could be silently omitted, and unwired visualizers could look live.

Decision:

- show every FORK route as conditional and label LEAN as a policy, with route
  selection deferred to run time;
- label REVISE with an authored maximum rather than an observed count. An
  experimental plan-range treatment was implemented in this pass, then
  superseded in Iteration 6 after the repo's governing engine-surface contract
  was re-audited;
- serialize every independent staged curve, and render explicit plan errors for
  cycles or fan-out without a declared policy;
- give all 15 visualizers the same visible/accessible provenance badge:
  `EMPTY`, `CONNECTED PREVIEW`, `PLAN PREVIEW`, `PROMPT PREVIEW`, or `CONFLICT`;
- render WAVE and BRANCHES as neutral empty surfaces until an input is wired;
- stop RADAR from manufacturing 50% vertices, distinguish missing MATRIX,
  GRID, BANDINGS, and SCORE lanes from real zero values, let STEPS honor the
  total signal-coercion contract, and avoid inventing a missing BEAM side;
- make WINDOW intersect only comparable dimensions. Independent constraints
  remain visible as lanes and are explicitly labeled independent rather than
  producing a false shared numeric window.

Browser evidence: the experimental fixture exposed both possible FORK routes
and a bounded REVISE treatment with no page errors. That REVISE representation
is historical evidence, not current behavior. A generated board containing
every visualizer kind exposed a state badge and accessible summary for all 15.
An unwired BRANCHES reported zero branches, zero levels, and no winner.

## Iteration 4 — keyboard, touch, and narrow-screen operation

Problem: ports, visualizer write-back, moving, resizing, and several authoring
actions were pointer-only; connection state was not named; the fixed board
and horizontal prompt compiler were hard to operate at narrow widths.

Decision:

- make every source and destination port a named 24×24 keyboard target;
- support `output Enter → input Enter` connection, picking up an existing input,
  Delete/Backspace disconnect, and Escape cancel;
- name payload family, direction, source, and connected state on every port;
- add keyboard slider semantics to RADAR, LIGHT GRID, READOUT, BEAM, SCORE
  position, and keyboard reset to TRIM;
- add keyboard move and resize for every board part;
- add a visible global UNDO action for connections, removal, authored-default
  changes, resets, keyboard adjustment, move, and resize;
- use an internally scrollable board on desktop, stack the parts library above
  it below 820 px, switch the pack shelf to two columns, and stack prompt
  sections vertically on narrow screens.

Browser evidence: keyboard-connected WARMTH to a newly added READOUT and then
restored the unwired state with UNDO; WARMTH → STEPS coerced to a truthful flat
series while the square artifact family remained non-mating; 1440, 1024, 768, and 390 px
viewports had no page-level horizontal overflow or page errors; every port was
24×24; a wired LIGHT GRID lane changed the source from 72 to 80 with
ArrowRight; and no interactive DOM element lacked visible text or an accessible
label in the focused audit.

## Iteration 5 — adversarial interaction and claims audit

Problem: the adversarial pass found that a cancelled pointer rewire could
destroy the original connection, Undo did not cover additions or the complete
layout displaced by move/resize, browser-native text undo could be hijacked,
RANGE/FILTER/CURVE still required a pointer, and one optional WAVE input made a
valid Narrator appear incomplete.

Decision:

- keep a picked-up cable connected until a compatible drop commits an atomic,
  reversible move; a click on the input remains an explicit unplug;
- snapshot and restore the complete displaced layout for move/resize, and add
  Undo for palette additions and direct control adjustments;
- leave `Cmd/Ctrl+Z` to editable text fields;
- expose separate low/high sliders for RANGE, mode-aware cutoff sliders for
  FILTER, and keyboard-editable CURVE points (value, position, delete);
- distinguish required and optional visualizer slots in completeness state;
- label the scrollable board for assistive technology, give it a quiet arrow
  continuation glyph, and let its focused surface pan with arrow keys.

Browser evidence:

- all 45 palette entries produced 98 parts, no overlaps, all 15 visualizer
  kinds, 859 named visible interactive elements, no sub-24px core target, and
  no browser error;
- cancelled WAVE rewiring retained all 14 cables; click-unplug reduced the
  count to 13 and Undo restored the exact original source;
- add, direct-adjust, move, and resize all round-tripped through Undo; native
  text undo changed only the text field;
- RANGE `30→35`, FILTER `25→30`, and CURVE value `50→55` plus position
  `50→55` worked from the keyboard, with focus retained; an interior CURVE
  point could be deleted while endpoints remained guarded;
- Narrator reported a valid five-input connected preview with its sixth WAVE
  slot optional;
- every one of the 12 seeded control configuration dialogs opened with a
  specific accessible name, closed on Escape, and returned focus;
- 1440px and 390px screenshots were visually inspected; 390px retained zero
  page overflow and an internally pannable canvas.

## Iteration 6 — final-review remediation

Problem: the two-axis final review found package instances had no common
lifecycle, compiler structure still relied on pointer drag and partial Undo,
MATRIX cells had no semantic identity, BRANCHES depicted a fabricated winner,
and several changes drifted from the locked signal, color, fidelity, and
progressive-disclosure rules.

Decision:

- create a package-instance rack with rename, stock restore, named variation
  save/load/rename/delete, prompt/process mute, duplicate, remove, and Undo;
- keep that lifecycle outside the compact MODS shelf, and make each instance
  state its job, example outcome, prompt/process scope, and defining-input
  completeness;
- make compiler cards/groups move with `Alt+Arrow`, sections move with
  `Alt+Left/Right`, and make add/remove/rename/edit/reorder operations undoable;
- give each MATRIX cell row/column/value semantics and arrow-key navigation;
- render BRANCHES as authored breadth/depth/prune/wander/commit policy only,
  with no winner, loser, reward, or observed route;
- make a continuous pointer adjustment one Undo transaction;
- restore total signal coercion, silent non-mating cable families, one compiled
  REVISE card (silent at zero) without a fidelity chip, neutral visualizer state
  badges, one rare conflict mark, and affordance glyphs instead of instructional
  surface copy.

Browser evidence:

- all 45 palette entries still produced 98 parts, zero overlaps, all 15
  visualizer kinds, seven managed package instances, 996 named visible
  interactive/semantic elements, zero page overflow, and no browser errors;
- every package shipped `STOCK` plus two purposeful variations; a configured
  Narrator duplicated its name, selected `PUNCHY` variation, `WARMTH 88`, and
  remapped internal cables; a deeper audit also proved duplication of an
  authored sentence, authored default, description, and deliberate part
  absence; restore stock recreated an individually deleted part, and one Undo
  returned to the absent part, `PUNCHY`, and value 88;
- direct control, TRIM reset, lens-keyboard, and Explorer-chip edits expose
  `CUSTOM · UNSAVED`; their Undo transactions restore both values and the exact
  previous named variation/chip face;
- Translator and Anchor report `NEEDS READER` / `NEEDS POINT` until their
  defining text exists, while the other five packs report `READY`; each pack
  also names its contribution scope and a concrete example outcome;
- named-variation save/rename uses an in-bay instrument-flat editor rather than
  browser chrome; Enter commits, Escape cancels, and both paths restore focus;
- mute removed only that instance's prompt contribution; remove and Undo
  restored both instances;
- compiler card move, section move, section rename, section add, and section
  delete each round-tripped through one Undo;
- MATRIX cells named both dimensions and value/missing state, STEPS accepted a
  scalar as a flat series, BRANCHES reported `winner: null`, and REVISE value
  two emitted one bounded compiler card with no fidelity chip or plan track;
  REVISE at zero emitted a silent card.

## Prototype boundary and unresolved product decisions

The workbench now exports an authoring-only Mod specification and copies the
compiled prompt, but it intentionally does not claim persistence, execution,
or an observed run. Those require product/runtime contracts outside this HTML
prototype.

The following should remain explicit follow-on product decisions rather than
being simulated here:

- durable save/autosave and import of the exported Mod schema;
- observed-run telemetry, values, timing, and failure state;
- redo and a visible history browser beyond the implemented bounded Undo stack.
