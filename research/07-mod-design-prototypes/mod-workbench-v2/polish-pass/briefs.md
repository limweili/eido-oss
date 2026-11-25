# Stream briefs (4–8)

All streams: read `../03-polish-goal.md` first — the six "done" tests are the
acceptance bar. Inputs are the recon docs in this folder. Ground-up: recon
describes what IS; you decide what SHOULD BE from part purpose + the tests.

## Stream 4 — Design-language grammar spec (`04-grammar-spec.md`)

Inputs: 01-inventory, 02-design-language-audit, 03-fresh-eyes-journey.
Decide the ONE grammar: jack shapes/payload coding (resolve circle-vs-oval —
either make the payload code legible on the face or collapse it), chip
taxonomy (interactive vs readout must be distinguishable; dead chrome dies),
type ladder (4 sizes, 9px floor), card anatomy (header, states, resize
affordance), color chain (control→wire→jack→card→compiler chip; fix the step
class), state words (one spelling for off/empty/unwired).
Taste-bearing → produce 2–3 competing options for the contested calls (jack
coding, chip taxonomy), argue them against the tests, pick one, record why.
Output: a spec implementers follow mechanically — rules + tokens + per-rule
"replaces X at file:line" mapping. No implementation.

## Stream 5 — Per-part face/settings/resize specs (`05-part-specs.md`)

Inputs: 01-inventory + 04-grammar-spec. For EVERY part: face contents at
small/default/large (identity, value, effect — nothing else), label
placement, settings popover redesign (field order, grouping, live sentence
preview, plain-language field names), what moves face↔settings, jack layout
per grammar. Not uniform — usable; but every deviation justified by the
part's purpose. Flag parts whose current face fails the 5-second test worst.

## Stream 6 — Journey redesign (`06-journey-redesign.md`)

Inputs: 03-fresh-eyes-journey + 01-inventory (packs/plan sections) +
04-grammar-spec when available. Redesign the storyline surfaces: how the
board visibly becomes the prompt (compiler strip), what "Mod Pack Instances"
and the Editor row are FOR and how they earn a legible place (rename,
re-locate, or restructure — capability stays), how PLAN / Auto Parts Run
(ONE PASS ↔ IN STAGES) becomes a narratable continuation of authoring rather
than appearing/disappearing UI. Produce 2 competing journey layouts, argue
against the storyline + prediction tests, pick one.

## Stream 7 — Implementation waves

Wave per surface: (a) grammar/tokens in lib + workbench chrome,
(b) part faces + settings, (c) journey surfaces. Each wave = one worker with
the relevant spec sections; verify in browser before claiming done.

## Stream 8 — Adversarial review gate (`08-review-verdicts.md`)

After each wave: fresh-eyes browser reviewer (did NOT build it) replays the
Stream-3 walkthrough + runs the six goal tests. Verdict per test:
pass / fail(evidence). Fail → rework ticket or kill. Cross-vendor second
opinion (codex) on the final state.
