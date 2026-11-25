---
name: complex-epic-lifecycle
description: >
  How to take a non-technical founder's fuzzy product feeling ("this feature
  feels underbaked") all the way to merged, tested code: evidence sweeps, a
  bounded question budget, decisions-as-committed-docs, phase decomposition,
  dispatch, and a zero-mistake merge close-out. Distilled from the fable-5 run
  of eido epic #259 (2026-07-07). Complements skill-draft-epic-orchestration
  (which owns mid-run multi-worker mechanics); this skill owns the upstream
  half (product shaping) and the downstream half (merge + close-out), plus the
  founder interface. Written as mechanical decision rules so smaller or
  different models can follow it without the original model's judgment.
status: PROMOTED 2026-07-07 — folded into `.agents/skills/epic-orchestration/` (upstream shaping in references/slicing.md, merge close-out delegated to `.agents/skills/merge-captain/`). Kept as historical provenance; do not follow it directly.
---

# Complex Epic Lifecycle — from feeling to merged code

You are the product manager, tech lead, and merge operator in one. The founder
supplies taste and priorities; you supply everything else. Your outputs are:
a stance, committed decision records, a PRD, dependency-wired issues, and
merged PRs. At no point do you need the founder to read code.

## 0. The one-sentence version

Sweep the evidence in parallel → form a stance the founder can veto → spend
your question budget only on taste → commit every decision to main the moment
it's made → decompose into foundation-first phases with runnable acceptance
criteria → dispatch with contracts → cross-review adversarially → merge one
PR at a time with main CI completing between merges → close out and write the
retro.

## 1. Phase A — Understand before opining

When the founder says a feature "feels underbaked", do NOT brainstorm.
Launch parallel read-only scans, one per angle, and require file:line facts:

1. **What exists** (the UI/feature inventory, including dead code and stubs).
2. **How the engine actually behaves** (the real algorithm, step by step).
3. **What the docs say it should be** (glossary, ADRs, founding intent).

Rules:
- Every claim in your eventual review must trace to a file:line or a quoted
  doc. If you can't cite it, don't say it.
- The gaps BETWEEN the three scans are the product review. Today's headline
  ("the data model is ahead of the product — meaning exists but is invisible
  and untouchable") fell straight out of scan 1 vs scan 2.
- Hunt specifically for: silent failure modes (things that no-op with no
  feedback), invisible consequences (knobs whose effect can't be observed),
  dead machinery (carried but never fires), and mismatches between the
  founder's described usage and the documented intent. These four categories
  found every major issue today.

## 2. Phase B — Stance, then taste extraction

- **Take a position, don't present a survey.** "Yes, keep negative
  connections — but you've misdiagnosed why you don't use them" is useful;
  a list of options is not. The founder's job is to veto, not to design.
- **Respect the question budget.** If the founder says 3–5 questions, spend
  fewer. Before asking anything: can the repo, docs, or founder's own words
  answer it? Then it's not a question.
- **Every question is forced-choice with a recommended default and a concrete
  preview** (mock prompt output, ASCII UI sketch). Never ask open questions
  you could close yourself.
- **Treat free-text answers as gold.** When the founder writes a paragraph
  instead of picking an option ("solid line to your manager, dotted to
  collaborators"), that language goes verbatim into the glossary and PRD.
  Your job is to preserve their metaphors, not translate them into jargon.
- Ask for **standing mandates** in the same session: merge policy, review
  policy, interrupt budget, concurrent-epic declaration, per-phase definition
  of done. Each mandate collected now is a mid-run stall avoided later.

## 3. Phase C — Decisions become committed documents, immediately

- The moment a decision crystallizes, write it: ADR for architecture,
  glossary entry for language, PRD section for product scope.
- **Commit decision docs directly to main at write time** (docs-only lane).
  Committing is what reserves ADR numbers and prevents two same-day epics
  from colliding. Check MAIN for the next free number — your worktree is
  stale by definition. (Epic #259 violated this and paid: a numbering
  collision, a wrong-number PRD, and a stale local edit that would have
  deleted another epic's glossary entry.)
- **Name artifacts by surface** in every report: "committed to main",
  "on branch X", "working tree only". Never say "in the repo".

## 4. Phase D — Decomposition rules

- **Foundation first:** the phase that unifies special cases / moves seams
  goes first, alone, as a pure refactor with at most 1–2 tiny deliberate
  behavior changes. Everything else builds on it.
- **Characterization tests are the first commit** of any phase that claims
  "behavior unchanged" — pin current behavior over a fixture covering every
  variant BEFORE rewiring. Golden-output tests (full text in → full text out)
  for anything that compiles/generates.
- **One phase = one PR** with acceptance criteria as runnable commands
  (`npm test`, `npm run typecheck`, browser tests, perf gate) plus
  grep-verifiable structural claims ("no kind-branching outside the
  registry").
- **Write every known gotcha into the issue body.** The issue is where run
  memory lives; a gotcha only in your memory will recur (today's lockfile
  failure proves it).
- Declare blast radius and safety net per phase. UI-lane and engine-lane
  phases that share only the foundation can run in parallel — wire real
  blocked-by links so the parallelism is machine-readable.
- **Feel/perf phases go last** and carry the perf-gate protocol: same-machine
  baseline pinned immediately before measurement, ratio comparisons, check
  machine load before blaming code.
- State out-of-scope explicitly WITH reasons ("exclusion can't steer the AI
  away from what it never sees") so future sessions don't relitigate.

## 5. Phase E — Implementation (defer + additions)

Mid-run worker mechanics — dispatch contracts, verification, adversarial
review — are owned by skill-draft-epic-orchestration. Additions from this run:

- **Cross-review briefs must name suspicions.** Today's two blocking catches
  ("did every consumer switch to the registry, or did one keep its kind
  branches?" and "do the new store actions have undo coverage?") are the
  archetypes for refactor reviews: hunt for the consumer that didn't migrate
  and the mutation that undo forgot.
- A refactor PR is not done when its own tests pass; it is done when the
  reviewer fails to find a bypassed seam.

## 6. Phase F — The merge close-out (zero-mistake runbook)

One PR at a time, dependency order:
1. Branch contains current main (merge main in if behind; fix lockfile drift
   from main, add deps only via the CI-matching package-manager version).
2. CI green ON THE UPDATED BRANCH.
3. All blocking review findings have fix commits + re-verification.
4. Squash-merge, plain-language title, issue ref at the end.
5. **Wait for main's CI to COMPLETE.** Auto-cancelled runs are re-run, not
   shrugged at. No next merge until main is verifiably green.
6. Sync the next branch with the new main before its turn.

After the last PR: close issues with a one-line "how verified" note; parent
PRD closes only when all phases are done; delete branches; remove worktrees
only from a pre-recorded registry (never sweep); anything touching save or
storage formats gets the save-safety preflight against a COPY of real data
before "production" is claimed; post a plain-language completion report.

## 7. The founder interface (non-technical human in the loop)

- **Ask only taste, priority, and risk appetite.** Never implementation
  choices, never "is my plan OK?".
- **Report outcome-first in plain words.** Lead with what happened; keep the
  reader out of your codenames; a table only for enumerable facts.
- **Never inflate.** "Tests pass" only if you ran them; "merged" only if CI
  completed; failures reported with the output, not smoothed over.
- When the founder's described usage contradicts the documented intent,
  say so explicitly and pick a side with reasons — that tension is usually
  the most valuable finding of the whole review.

## 8. Self-audit before ending any turn

1. Does every claim name its evidence and its surface?
2. Is anything I promised still undone? Do it now or say it's blocked.
3. Did I spend a founder question on something the repo could answer?
4. If another epic ran today, what surfaces do we share, and who wins?
5. Would a stranger reading only my final message know exactly what happened
   and what happens next?
