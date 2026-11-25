---
name: live-state-operator
description: >
  How to execute multi-step operations against live, shared, mutable external
  state (GitHub PRs, CI, remote branches, running servers) so that no step
  fires on a wrong assumption and no mistake compounds. Distilled from the
  fable-5 merge endgame of eido epic #236 (2026-07-07): five PRs in two
  stacked trains, one mid-run incident contained at zero damage. Written for
  smaller or different models: it encodes the decision procedure, not raw
  intelligence. Complements skill-draft-merge-captain (merge mechanics) and
  skill-draft-epic-orchestration (dispatch/coordination); this one is the
  layer underneath both — how the operator decides what to trust, when to
  act, and when to freeze.
status: PROMOTED 2026-07-07 — folded into `.agents/skills/merge-captain/references/stances.md`. Kept as historical provenance; do not follow it directly.
---

# Live-State Operator — how the operator thinks

You are operating on a system that other people and other agents are mutating
while you work. Your job is not speed; it is that **every irreversible action
fires on verified-current state, and no surprise ever gets a second
irreversible action stacked on top of it**. Everything below is a rule you can
follow mechanically.

## 0. The one-sentence version

Treat all instructions as intent, re-derive facts live; classify every action
by reversibility and spend your verification immediately before the
irreversible ones; treat missing data as missing, never as good; on surprise,
freeze and report instead of improvising; propagate every lesson to all
remaining steps the moment you learn it.

## 1. Instructions are intent; state is derived, never inherited

Any plan, handoff note, command list, or "it's green, just merge it" claim —
from the founder, another agent, or your own earlier turn — describes the
world **at the time it was written**. You act in a later world.

- Before the first action, re-derive the ground truth yourself: what exists,
  what state it's in, what depends on what. For a PR train: every PR's state,
  head, base, mergeability, and checks — and a dependency map (whose branch is
  whose base).
- When given exact commands, extract the *goal* and re-choose the mechanics.
  In the source incident, the founder's own command (`--delete-branch` on a
  stacked PR's base) was the bug; executing it verbatim caused GitHub to close
  the dependent PR. The command list was intent wearing a procedure costume.
- The check that counts is the one **seconds before** the irreversible action.
  A verification done three steps ago is a historical document.

## 2. Classify every action by reversibility, and gate accordingly

Three classes, three costs of being wrong:

| Class | Examples | Gate |
| --- | --- | --- |
| Read | `gh pr view`, `git ls-remote`, running tests | Free — do liberally, in parallel |
| Reversible | retarget a PR, create a temp worktree, push a branch | Verify inputs, act, verify outcome |
| Irreversible / expensive to undo | merge, delete a branch, close an issue, force-push, restart a server | Fresh state read immediately before; explicit expected-state predicate; stop on any mismatch |

Two corollaries:

- **Preserve before destroy.** Delete a resource only after everything that
  depends on it is safe. Keeping a merged branch an extra hour costs nothing;
  resurrecting a deleted base branch to reopen a closed PR costs an incident.
  When unsure whether anything depends on it: keep it, delete at the end.
- **Never chain two irreversible actions without re-reading state between
  them.** The world moves — other agents merged four unrelated PRs into this
  repo *during* the source run.

## 3. Silence is not a signal — the three-valued check

Every gate check returns one of three values, and you must not collapse them
to two:

1. **Verified pass** — the check ran and is green. Proceed.
2. **Verified fail** — the check ran and is red. Stop; never merge red.
3. **No data** — empty check list, `mergeable: UNKNOWN`, a cancelled run, a
   tool that errored. **This is not a pass.** It demands compensating proof
   or waiting, never a shrug.

In the source run, three of five PRs had zero CI checks (the workflow only
triggered on PRs targeting main, and retargeting doesn't start a run). Each
got a local CI mirror in a disposable environment instead. Also learned: a
*cancelled* CI run on the target branch (concurrency groups cancel older runs
when merges land close together) means your merge was never validated —
confirm a completed green run at/after your commit, re-running if needed.

Scale compensating proof to blast radius: changed-area tests for a small
middle-of-train PR; full suite + typecheck + build for the last PR in a train,
because it composes with everything before it.

## 4. Stop-on-surprise: the containment rule

Before each step, know what state you expect after it (write the predicate
down if you can: `state=OPEN, base=main, mergeStateStatus=CLEAN`). After the
step, check.

On mismatch:

1. **Freeze.** Do not run the next planned step. Do not retry the same step.
2. **Report raw observations**, expected vs actual, verbatim field values —
   not your interpretation of them.
3. **Say explicitly what you did NOT do** ("I did not run the #250 or #266
   merge commands"). The reader must know the blast radius is contained.
4. **Do not improvise destructive recovery.** Reopening PRs, recreating
   branches, force operations — these are decisions to make deliberately (or
   escalate), not reflexes. The incident that goes bad is almost never the
   first surprise; it's the improvised fix to the first surprise.

If you hold standing authorization to self-recover ("fix anything mechanical
without asking"), diagnosis still comes before repair, and the repair gets the
same gates as any other action.

## 5. Propagate lessons mid-run, not at the retro

The moment a step fails in a new way, scan **all remaining planned steps** for
the same shape and re-plan them before continuing. In the source run, the trap
discovered on train 1 (base deletion closed the stacked PR) was pre-empted on
train 2 without being asked: merge parent keeping its branch → explicitly
retarget the child → verify CLEAN → merge child → only then delete the
consumed branch. Zero surprises the second time.

A lesson applied only to the step that taught it is half-learned.

## 6. Prove in disposable environments; leave the live one alone

- Never validate in the user's working checkout. It is dirty with their work,
  shared with other agents, and your validation must not depend on or disturb
  it. Use a temp worktree at the exact ref under test.
- The disposable environment installs its **own** dependencies
  (`npm ci --ignore-scripts`); borrowing the live checkout's `node_modules`
  imports its corruption (the source run hit a missing package exactly this
  way).
- Clean up **exactly what you created** — the one path you recorded at
  creation time. Never derive a cleanup list by enumerating the system
  (`git worktree list`, branch globs): enumeration surfaces other sessions'
  live work, and sweeping it destroys it.
- If a change *could* touch real user data (saves, databases, config), the
  data's safety procedure outranks your task procedure. Test on synthetic
  fixtures; the real data is never in the blast radius of a validation.

## 7. Flake triage: locate the failure before blaming the change

A test failure during compensating proof is a fork, not a verdict:

- **In the changed area** → treat as a real blocker until proven otherwise.
- **Outside the changed area, under load** (parallel jobs, timeouts) → rerun
  that test alone. Isolated pass ⇒ load flake: record it, proceed. Isolated
  fail ⇒ real, investigate.
- Never "rerun until green" on the full suite — that launders real failures.

## 8. The escalation boundary

Decide yourself (mechanical): merge order, retargeting, conflict resolution in
append-only lists, re-running CI, branch cleanup, dependency installs, flake
triage, temp-environment management.

Escalate (judgment that belongs to the owner): product-behavior reversals,
anything that can lose user data, force-push/history rewrites, secrets, scope
changes, and any recovery whose failure mode is worse than the incident.

When escalating: exact current state, 2–3 concrete options, and your
recommendation first. A non-technical owner should be able to answer with one
word.

## 9. Reporting discipline

- **Outcome first**, in the owner's language, then proof: merge SHAs,
  timestamps, test counts, verified branch states. Claims name their surface
  ("merged to main at `8c3d5f1`", "verified by `git ls-remote` returning
  nothing") — "it's done" is banned.
- State what you did **not** do and why ("did not sync local main; it holds
  your unrelated in-flight work").
- Residual risk only when real, but always when real ("this PR merged with no
  provider CI; local mirror covered typecheck + full suite + build").
- Between steps, one line of narration when direction changes; the full
  picture lives in the final report.

## 10. Worked example (compressed): a stacked merge train

Given "merge PRs A→B→C, stacked": map heads/bases and mark A's and B's
branches do-not-delete-yet (§1) → merge A *without* deleting its branch (§2)
→ retarget B to main explicitly, wait, require OPEN/main/CLEAN (§1, §4) → B
has no checks ⇒ local CI mirror in a temp worktree with its own deps (§3, §6)
→ fresh state read, merge B, keep its branch → same for C, full-suite proof
since it's last (§3) → merge C → delete the two consumed branches, verify by
ls-remote (§2, §9) → confirm a completed green main run at/after the last
merge (§3) → report SHAs, closed issues, deleted branches, residual risk (§9).
Any deviation at any arrow: §4.

Full merge mechanics live in `skill-draft-merge-captain.md` and §5 of the
epic #236 retro (`RETRO.md` beside this file); this skill is why those steps
are shaped the way they are.
