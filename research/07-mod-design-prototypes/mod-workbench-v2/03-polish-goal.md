# 03 — Fine-tooth-comb polish pass: goal statement (v2)

Date: 2026-07-16. Branch: `mod-workbench-polish` (from PR #442 head `ca84dda`).
Scope of edits: `docs/design/prototypes/mod-workbench-v2.html` + `docs/design/prototypes/lib/*`. No `src/`.

## Goal

Rework the Mod Workbench prototype so that a capable stranger — someone who has
never seen Eido, never heard "mod" or "signal payload" — can sit down and,
without onboarding, (a) understand what any single widget does by looking at
it, (b) predict what will happen before they touch it, and (c) narrate the
whole journey their mod takes: **build the board → tune the controls → read
the compiled prompt → understand what will run and in what stages**. All ~45
parts survive. The system's capability is untouched; what gets simplified is
each part's face, settings, sizing behavior, and its visible place in that
journey.

## The Lego principle, operationalized

A part is "Lego-simple" when all four hold:

1. **Face = play surface.** The board-facing card shows exactly what you need
   while *playing*: identity (what am I?), current value (where am I set?),
   and effect (what sentence/behavior do I contribute?). Nothing else.
2. **Settings = tuning surface.** The popover shows what you need while
   *shaping the part itself* — and reads top-down as "which field changes
   what", each field's consequence visible (live preview of the sentence it
   will emit), never a flat wall of inputs.
3. **Grammar teaches composition.** Shape, color, and jack design alone tell
   you what class a part is, what it can connect to, and what flows through
   the wire. If two parts look different, a user can infer why.
4. **Size degrades gracefully.** Each part defines what its face shows at
   small / default / large, with deliberate label placement — never truncated
   or unreadable text, never empty space.

Complexity lives only in what the user *builds*, never in what they *decode*.

## Concrete tests that define "done"

- **The 5-second test, per part.** Fresh-eyes reviewer names each part's job
  from its face alone. Every one of the ~45 parts passes or gets reworked.
- **The prediction test.** Before wiring, a reviewer can say what a
  connection will do; before toggling PLAN or Auto Parts Run, what will
  change on screen. Invalid actions are visibly impossible, not surprising.
- **The one-grammar test.** One documented rule set for jacks (today circles
  *and* ovals), chips, labels, typography, color-chains
  (card ↔ wire ↔ jack ↔ compiler chip), states (wired/unwired, on/off,
  auto/manual). Zero undocumented exceptions in the shipped prototype.
- **The dead-chrome test.** Every text/chrome element on every widget either
  informs a decision or is deleted ("CONNECTED PREVIEW" is the type specimen).
- **The storyline test.** "Mod Pack Instances", the Editor row, PLAN, and
  Auto Parts Run stop being disconnected strips that appear/disappear: the
  UI makes visible how the board *becomes* the prompt and how the prompt
  *becomes* staged calls. A reviewer narrates it end-to-end unprompted.
- **The settings test.** Opening any part's settings, a reviewer states what
  each field controls and sees the consequence before committing.

## Method: explore → independent review → iterate

Getting this right the first time is not expected and not the plan.

- **Ground-up.** PR #442's choices and rounds 00–02 are evidence, not
  constraints. Each part's needs are re-derived from its purpose.
- **Recon before design.** Three independent audits (code-derived part
  inventory; design-language inconsistency audit; fresh-eyes browser
  walkthrough) establish ground truth before anything is redesigned.
- **Explore variants.** Taste-bearing decisions (grammar, card anatomy,
  journey layout) get competing alternatives, not a single guess; the best
  survives comparison, judged against the tests above.
- **Independent adversarial review.** Every implementation wave is reviewed
  by fresh eyes that did not build it, in the running prototype, playing the
  user. Verdicts recorded in `polish-pass/08-review-verdicts.md`. Fail →
  rework or kill the branch attempt; no defending sunk cost.
- **Documented.** Every stream's brief, findings, decisions, and verdicts
  live in `research/07-mod-design-prototypes/mod-workbench-v2/polish-pass/` so the pass
  survives context loss and later sessions can pick it up.

## Non-goals

- Deleting/merging parts, cutting capability, or flattening part classes.
- Onboarding, tours, or tooltips-as-crutch: comprehension must live in the
  widgets themselves.
- Visual restyling for its own sake — every change traces to a failed test.

## Known defects seeding the review (weili, 2026-07-16 screenshots)

1. Jack shapes inconsistent — circles on some parts, pills/ovals on others.
2. Labels unreadable at rendered size; placement (side/bottom/inside) ad hoc.
3. "CONNECTED PREVIEW" chips: dead chrome on every visualizer.
4. Resize behavior undesigned — what shows/hides per size never decided.
5. Settings popovers are flat walls of fields (NOVELTY popover as specimen).
6. "Mod Pack Instances" + Editor row: unexplained concepts, no visible link
   to the board above or compiler below.
7. PLAN / "Auto Parts Run" (ONE PASS ↔ IN STAGES) toggles UI in and out with
   no storyline connecting it to the mod being authored.
8. Part classes differ visually without teaching why they differ or how they
   compose.
