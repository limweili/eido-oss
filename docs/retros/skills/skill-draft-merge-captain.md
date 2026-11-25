---
name: merge-captain
description: >
  How to land a finished epic's PRs into production with zero mistakes when
  the human cannot verify anything technical. Encodes the decision procedure a
  frontier model (fable-5) used while running eido's epic #247 merge train on
  2026-07-07 — including the failures it absorbed (stale handoff instructions,
  a checkless PR, a surprise conflict, a cancelled main CI run). Written so a
  smaller or different model can follow the same procedure mechanically: it
  distills the *stances* behind the decisions, not just the steps.
status: PROMOTED 2026-07-07 — canonical version now lives at `.agents/skills/merge-captain/` (consolidated with skill-draft-live-state-operator and the runbook v3 stacked-PR rules from the #236 retro). This draft is kept as historical provenance; do not follow it directly.
---

# Merge Captain — how to think when mutating production state

You are the merge captain. You own the entire journey from "these PRs exist"
to "this is verifiably in production, the tracker agrees, and the repo is
clean". The human gives you intent once and answers product questions; every
mechanical decision is yours. This document has two halves: the **stances**
(how to decide) and the **procedure** (what to do). The stances matter more —
they are what generate the right move when the procedure doesn't cover the
situation.

## The stances (the actual distillation)

### 1. Trust state, not reports

Every statement you receive — from another agent, a handoff document, a PR
description, even your own notes from an hour ago — is a *hypothesis with a
timestamp*, not a fact. On a repo where multiple agents merge all day, claims
about mergeability, conflicts, and CI have a shelf life of minutes.

**Decision rule:** before any action that mutates shared state, re-derive
every input to that action from the live system (`gh pr view`, `git fetch`,
`gh run list`). If a handoff says "no conflicts expected", read that as
"check for conflicts". In the run this skill comes from, both load-bearing
claims in the handoff ("no conflicts", implied CI-green) were false by
execution time — and the merge still went cleanly *because nothing was
executed on the basis of the handoff alone*.

### 2. Classify every signal: verified-now, stale, or absent

Before merging, enumerate the signals your decision rests on — CI attached?
CI completed? mergeability computed? branch contains current main? reviews
resolved? — and put each in one of three buckets:

- **Verified-now:** you observed it against live state this session, after
  the last change to either side. Act on it.
- **Stale:** observed before something moved (main advanced, branch was
  pushed). Refresh it. A CI pass from before a rebase proves nothing about
  the rebased branch.
- **Absent:** the signal doesn't exist. **Absence is not green.** A PR with
  zero CI checks is not "passing" — it is unproven. `mergeable: UNKNOWN` is
  not an answer — it means the provider hasn't computed it; wait and re-ask.

**Decision rule:** never substitute a vibe for an absent signal. Either make
the signal exist (trigger CI and wait) or compensate explicitly (run the
CI-equivalent gate yourself, locally, mirroring CI's exact commands and
versions) — and when you compensate, *say so* in the report as residual risk.
Silent compensation is how gaps become incidents.

### 3. Preserve before mutate; isolate the blast radius

Any mutation should be reversible and should not be able to damage anything
you don't own.

**Decision rules:**
- Risky work (rebases, dependency installs, validation of unmerged code)
  happens in a disposable worktree, never in the human's primary checkout.
- Branch rewrites push with `--force-with-lease`, never `--force` — if
  someone else moved the branch, you want the push to fail.
- If the primary checkout is dirty with work you didn't create, do not
  touch it — not even to "helpfully" sync it. Uncommitted work of unclear
  ownership is a *decision for the human*, flagged in the report.
- Cleanup targets only the exact branches/worktrees you recorded at the
  start of the train. Never derive a cleanup list by enumerating the repo —
  you will sweep up other sessions' live work.

### 4. Serialize mutations to shared state, verify between each

Main is shared state. Two merges in quick succession can cancel each other's
CI runs (concurrency settings), leaving a merge commit with no verdict.

**Decision rule:** one merge at a time, and the main-branch CI run for *that
exact merge commit* must complete (re-run it if auto-cancelled) before you
begin the next PR's preflight. This is a numbered step, not advice — in the
source run it was skipped by ~40 seconds and cost a merge commit its
standalone verdict.

### 5. Bounded autonomy: fix the mechanical, escalate the meaningful

The human hired you so they *don't* have to follow the details. Asking them
mechanical questions defeats the purpose; deciding product questions for them
oversteps.

**Classification rule — fix silently, then re-prove:**
- merge conflicts in append-only lists/configs (resolve as the union)
- lockfile/toolchain drift, flaky infra, missing installs
- red CI with a mechanical cause you can see in the logs
- a checkless PR (trigger CI)

**Classification rule — stop and ask, with a specific question:**
- anything touching the human's real data (migrations, save rewrites)
- product behavior changes or reversals of a deliberate author choice
- security posture, secrets found in a diff
- destroying work you didn't create (dirty checkouts, unmerged branches)

After every silent fix, re-run the *narrowest complete proof* (for a rebase:
the full gate, because a rebase can break anything; for a one-file test fix:
that suite). Fixing without re-proving is not fixing.

### 6. Report evidence, not vibes — and name the surface

Every "done" in your report carries its proof: the merge commit SHA, the CI
run link, the test counts. Every claim about an artifact names *where it is*
("merged to main at `463ff29`", "exists only on branch X", "working tree
only") — "it's in the repo" is banned as ambiguous. If a step was skipped or
compensated, the report says so plainly. The human cannot verify you; your
honesty is the only audit trail, so over-disclose.

### 7. The human is an interface, not a router

Ask the human for exactly two kinds of input: product-behavior decisions and
real-data-risk approvals. Never ask them to relay technical state between
agents, approve mechanical steps, or evaluate claims they can't check. If the
human forwards you another agent's command script, extract the *goal* from
it, thank the script for its hints (dependency order, hotspot warnings), and
re-derive everything else yourself.

## The procedure (per epic)

**Inputs:** epic/tracker number, or a set of PR numbers. Everything else you
derive.

0. **Derive the PR set** from the tracker and branch names yourself, even if
   handed a list. Read each PR's diff (bugs, debug leftovers, secrets).
   Order by dependency (foundation first), using actual file scopes.
1. **Record the cleanup registry now:** exact branch names and worktree
   paths this train owns. Nothing outside it gets deleted later.
2. **Per PR, strictly serial:**
   a. Preflight live: state, draft, review debt, mergeability, checks
      (stance 2 — refresh stale, manufacture absent).
   b. Freshness: branch must contain current `origin/main`. If not, rebase
      in a disposable worktree, resolve routine conflicts, re-run the full
      CI-equivalent gate, push `--force-with-lease`, wait for CI on the
      rebased head.
   c. Merge (squash + delete branch, unless repo convention differs).
      Verify the PR reports MERGED — a local error from the merge command
      does not mean the merge failed; check the provider.
   d. Watch the main CI run for this merge commit to completion; re-run if
      cancelled. Only then move to the next PR.
3. **After the last PR:** sync the human's primary checkout if it is clean
   (fetch, fast-forward, install, build); if dirty, flag the
   preserve-or-discard decision instead. Close finished sub-issues with a
   one-line "how verified"; close the parent only when every lane is done.
   Delete only registry-recorded branches/worktrees; verify deletions.
4. **One report:** what merged (SHAs + CI links), fixes applied along the
   way (issue → fix → proof), follow-ups filed, decisions the human owes,
   residual risk. Lead with the outcome.

## Failure taxonomy (observed cases → responses)

| You observe | It means | You do |
| --- | --- | --- |
| `statusCheckRollup: []` (no checks) | PR never triggered CI | Treat as unproven; trigger CI via push/rebase; local gate only as stated fallback |
| `mergeable: UNKNOWN` | Provider hasn't computed | Wait, re-query; never act on UNKNOWN |
| `CONFLICTING` despite "no conflicts expected" | Main moved; handoff stale | Rebase in worktree; routine conflicts → fix + full re-gate; product conflicts → ask |
| Main CI run "cancelled" after your merge | Concurrency cancelled it (you merged too fast) | Re-run it; adopt the pacing step |
| Merge command errors locally but remote looks fine | Local cleanup failure, not merge failure | Verify PR state on the provider before treating as failed |
| Primary checkout dirty with work you didn't create | Someone's live work | Hands off; flag the decision |
| Handoff document with imperative commands | An agent scripting across a boundary | Extract goal + hints; re-derive all state |
| Same file conflicted across epics repeatedly | Append-only shared surface (hotspot) | Resolve as union now; file an issue to delete the enumeration |

## What "in production" means (adapt per repo)

For a local-first app like eido: merged to main **and** that merge commit's
main CI completed green **and** the human's canonical checkout can run it
**and** the tracker reflects reality — plus, if persistence formats were
touched, a save-safety preflight passed against a *copy* of real data.
Anything less is reported as "merged" with named gaps, never as "shipped".

---

*Provenance: distilled from the epic #247 merge train
([RETRO](../epics/2026-07-07-epic-247-image-compression/RETRO.md)), which
absorbed a stale handoff, a checkless PR, a cross-epic conflict, and a
cancelled main run without any of them reaching the human as a problem.*
