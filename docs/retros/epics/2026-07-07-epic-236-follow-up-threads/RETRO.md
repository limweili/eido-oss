# Retro — Epic #236: Follow-up Threads (merge endgame), 2026-07-07

Predecessors: [epic #259 retro](../2026-07-07-epic-259-connections-rework/RETRO.md), [epic #203 retro](../2026-07-07-epic-203-canvas-interaction.md), [epic #182 retro](../2026-07-06-epic-182-orchestrated-fanout.md), and the epic #247 merge-train retro + `skill-draft-merge-captain.md` (PR [#291](https://github.com/limweili/eido/pull/291), still open at time of writing).

This retro covers a different failure surface than its predecessors: not implementation, but the **merge endgame of an epic that shipped as two stacked PR trains**. Five PRs, five issues, one live incident (a PR silently closed by GitHub mid-train), and a founder who — correctly — did not want to be the one tracking base branches and retarget timing.

A companion skill draft distilled from this run lives next to this file:
[`skill-draft-live-state-operator.md`](skill-draft-live-state-operator.md).

---

## 1. What shipped

The epic: every result card takes follow-up questions, and the thread travels with the card (PRD #236), hardened across four follow-on issues found by review.

| PR | Issue | What | Merge commit | Merged (UTC) |
| --- | --- | --- | --- | --- |
| [#243](https://github.com/limweili/eido/pull/243) | #236 | Follow-up threads flow into downstream context, group digests, and the source fingerprint; one shared seam (`followUpThread.ts`); pinned byte-identical baselines for thread-less boards | `1b3af22` | 02:25 |
| [#250](https://github.com/limweili/eido/pull/250) | #248 | Streaming replies stay card-only until settled; context and fingerprint share one filter so the badge flips exactly once | `13679de` | 02:37 |
| [#266](https://github.com/limweili/eido/pull/266) | #251 | Replies orphaned at `streaming` (page reload mid-stream) settle to `stopped` at the board-load seam | `8e42ae4` | 03:20 |
| [#285](https://github.com/limweili/eido/pull/285) | #267 | Duplicating a board mid-stream settles the copy's snapshot; live board untouched; undo/redo transient documented as accepted | `57559db` | 04:43 |
| [#288](https://github.com/limweili/eido/pull/288) | #286 | Duplicate aborts live follow-up streams first (the Stop button's exact path), so the copy's `stopped` is truthful and final | `8c3d5f1` | 04:55 |

End state, verified: all five issues **CLOSED** (auto-close via per-issue `Closes` keywords worked), all five head branches plus both consumed base branches **deleted** (confirmed by `git ls-remote`, not assumed), and **main's CI green** at and after the last merge commit.

Stack shape at merge time: `#243 → #250 → #266` (each based on the previous PR's branch) and `#285 → #288`. This shape is what made the endgame hard.

## 2. The incident (and why it's the headline)

The founder's original instruction sheet was three commands, each `gh pr merge N --merge --delete-branch`, with the note "after #243 merges and its branch deletes, #250 auto-retargets to main and should show CLEAN."

What actually happened after merging #243 and deleting `polly/issue-236`:

> #250: `state: CLOSED`, `mergeStateStatus: DIRTY`, `mergeable: CONFLICTING`

GitHub did **not** retarget #250. It closed it. Deleting a branch that is an open PR's base is allowed to close that PR; auto-retarget is a courtesy that fires *sometimes* (it depends on the child branch being fully contained in the merge — the "sync stack" merge commits on #250 broke that containment). A closed PR cannot be retargeted, and a PR whose base branch no longer exists cannot be reopened — so recovery required recreating `polly/issue-236` as a temporary ref at the merge commit, reopening #250, retargeting it to main, and deleting the temp ref.

The stop-on-surprise checkpoint worked exactly as designed: the operator froze after the first merge instead of firing command two into a closed PR, reported the raw state, and the recovery ran cleanly. Cost: ~15 minutes and one founder round-trip. Without the checkpoint, the failure mode is much worse: improvised recovery, or a "merge" of the wrong thing.

The remaining four merges then used the corrected procedure (see §5) and had zero surprises — including the second stack, where the same trap was waiting.

## 3. What went well

1. **Stop points caught the incident before it compounded.** The founder's "if any step surprises you, stop there and tell me" was the single highest-value input of the day. The operator never chained a second irreversible action onto a surprising first one.
2. **State was re-derived immediately before every merge.** Every `gh pr merge` was preceded by a fresh `OPEN / base / MERGEABLE / CLEAN` read seconds earlier. No merge fired on stale or assumed state. (This is the same rule the #247 retro adopted after its stale-handoff failure — it held.)
3. **"No checks reported" was treated as no-data, not green.** Three of five PRs (#250, #266, #288) reached merge with an empty check list (root cause in §4.2). Each got compensating local proof in a disposable worktree, scaled to risk: changed-area tests for #250 (27 tests), changed-area + typecheck for #266 (34 tests), and a full CI mirror for #288 (full suite 620 tests + typecheck + production build) since it was the train's last car.
4. **The lesson propagated forward mid-run.** The trap discovered on train 1 was pre-empted on train 2: #285 merged *without* deleting its branch, #288 was explicitly retargeted (`gh pr edit 288 --base main`) while the base still existed, verified CLEAN after a recompute pause, and only then was the consumed branch deleted.
5. **Save-safety held on a storage-touching PR.** #266 changes the board-load path; validation used only synthetic fetch-stubbed fixtures in a temp worktree. The real `~/.eido` save was never in the blast radius, under the then-current legacy JSON safety rules.
6. **Flake triage was disciplined.** #288's full-suite run had one timeout in `VersionSwitcher.test.tsx` — a file the PR doesn't touch, under parallel typecheck load. It was rerun isolated (17/17 pass) before being classified as load flake rather than blocker. The changed-area tests were all green on first run.
7. **Cleanup was verified, not assumed.** Every branch deletion was confirmed with `git ls-remote --heads`; the founder's dirty local `main` (unrelated in-flight work, another session's unpushed commit) was deliberately left untouched and reported as such.
8. **Issue closeout needed zero manual fixes.** Per-issue `Closes #N` keywords in the PR bodies (a rule from the #182 retro) meant all five issues auto-closed.

## 4. What went wrong, root causes, fixes adopted

### 4.1 The instruction sheet encoded the trap

The founder handed exact commands, and command one (`--delete-branch` on a stacked base) *was* the bug. This is not a founder failure — it's a delegation-interface failure: when a non-technical coordinator writes mechanics, the agent inherits their mistakes with authority attached. The agent executed a verbatim command list where it should have treated the commands as intent and re-derived the mechanics.

**Rule adopted:** merge instructions from anyone — founder, another agent, a handoff doc — are **intent, not procedure**. The operator maps the PR graph itself and chooses the mechanics. Specifically: before merging anything, list every PR in scope with its head and base, and mark every branch that is another open PR's base as **do-not-delete-yet**.

### 4.2 Stacked PRs get zero CI — by construction

`.github/workflows/ci.yml` triggers on `pull_request: branches: [main]`. A PR based on another PR's branch never matches, so it never gets a check run. Worse: retargeting a PR to main fires an `edited` event, which is not in the default trigger types — so even after retarget, no run starts. Result: #250, #266, and #288 were merged into production with no provider CI ever having run on their branches, covered only by local proof.

**Fix to file as a follow-up issue (one-line change, code lane so not done in this docs commit):** remove the `branches: [main]` filter from the `pull_request` trigger. Checks attach to the head SHA, so a run done while stacked survives the retarget. This closes the gap completely and makes rule §5.5 a rare fallback instead of routine.

### 4.3 Main's CI run for a merge can be silently cancelled

The main-branch run for #243's merge commit was **cancelled** by the workflow's `cancel-in-progress` concurrency group when another PR (from a different lane — several agents were merging into this repo concurrently today) landed close behind. Coverage came only transitively from the next green run. The #259 retro already flagged this pattern; it recurred because nothing enforces it.

**Rule re-adopted, sharpened:** after each merge, confirm a **completed green** main run exists at or after your merge commit before merging the next PR; re-run if cancelled. When multiple agents share the repo, this is the only way to know your merge composed with theirs.

### 4.4 Deep stacks made the endgame a multi-hour coordination dance

Three PRs deep on train 1 meant three ordered merges, two retarget windows, two branch-deletion decisions — each a chance to trip. The founder spent the day sequencing steps they had no context for, which is exactly the work they're trying to delegate. Stacks also forced merge commits instead of the repo's squash convention (squashing a stacked parent orphans its children) and added noisy "sync stack" merge commits to history.

**Rules adopted:** (a) avoid stacking more than one PR deep; land slices into main promptly instead of building towers; (b) when a stack exists anyway, one trigger sentence hands the whole train to the operator (§6) — the founder should never be the sequencer.

### 4.5 Small proof-environment gotcha

Symlinking the primary checkout's `node_modules` into a temp worktree failed (`immer` missing — the shared tree was incomplete, consistent with the known [[worktree-npm-lockfile-gotcha]] churn). `npm ci --ignore-scripts` in the temp worktree is cheap (~1–12s here) and hermetic. **Rule:** disposable proof environments install their own dependencies; never borrow the live checkout's.

## 5. The merge-train runbook (v3)

Supersedes the sequencing habits from #182/#203 and extends the merge-captain v2 runbook (PR #291) with the stacked-PR rules. This is what "merge the epic PRs" executes:

1. **Map the train.** For every PR in scope: number, head branch, base branch, draft/state, checks. Build the dependency order (a PR whose base is another PR's head merges after it). Mark every branch that is an open PR's base as *do-not-delete-yet*.
2. **Merge bottom-up, one PR at a time.** Never fire the next merge while the previous one's consequences are unverified.
3. **Never delete a branch that is another open PR's base.** Merge that PR *without* `--delete-branch`. Auto-retarget is not a guarantee — base deletion can close the dependent PR outright, and the closed+dead-base state is painful to recover.
4. **Retarget explicitly, then verify.** `gh pr edit <next> --base main`, wait ~5–10s for recompute, then require exactly `state: OPEN`, `baseRefName: main`, `mergeable: MERGEABLE`, `mergeStateStatus: CLEAN`. Anything else → stop (rule 9).
5. **Checkless PR → compensating proof.** If `statusCheckRollup` is empty, mirror CI in a disposable worktree at the PR head: `npm ci --ignore-scripts`, changed-area tests + typecheck minimum; full `npm test` + `npm run build` for the last PR in a train (it composes with everything before it). Remove exactly the worktree you created. Never merge on `mergeable: UNKNOWN`.
6. **Re-read state immediately before the merge command.** The check in step 4 goes stale; the one that counts is seconds before `gh pr merge`.
7. **Watch main's run per merge.** A completed green main run at/after your merge commit, re-run if the concurrency group cancelled it, before starting the next PR.
8. **Delete consumed branches only at the end**, dependents merged, then verify with `git ls-remote --heads` (empty output = gone).
9. **Any surprise → freeze and report.** Expected vs actual, verbatim, plus what was *not* executed. Never improvise a destructive recovery; branch resurrection and PR reopening are decisions, not reflexes.
10. **Closeout:** issues closed (per-issue `Closes` keywords; close stragglers manually with evidence), branch list clean, one report with merge SHAs, proof evidence, and residual risk.

## 6. Founder interface — what to say next time

You coordinated well today; the improvements are all about giving *less* detail, not more.

**Keep doing:**
- The stop points. "If any step surprises you, stop there and tell me" prevented the incident from compounding. As trust grows, upgrade it to: *"if something surprises you, diagnose it; fix it yourself if it's mechanical; stop only if it touches product behavior or my data."* Today's #250 recovery didn't actually need you — it needed authorization you could grant in advance.
- Staged checkpoints on first-of-a-kind operations. This was the first stacked-train merge; checkpointing it was right. The *second* stack ran on one sentence — that's the trajectory.

**Change:**
1. **State outcomes, not commands.** The trap was inside a command you wrote. "Merge PRs 243, 250, 266 — they're stacked, handle the order and cleanup" is strictly better than three exact `gh` invocations: it delegates the mechanics to the party that can verify them.
2. **One trigger sentence per epic, up front.** The updated canonical form:
   > *"Merge the PRs for epic #N: [list, or 'find them']. They may be stacked — handle merge order, retargeting, CI proof, and branch cleanup yourself. Close finished issues. Fix anything mechanical without asking. Stop only for product behavior, my real save data, or anything destructive you can't undo. One report at the end."*
3. **You never need to know what a base branch is.** If an agent's plan requires you to track retarget timing or branch lifetimes, the plan is wrong — send it back with "make this a one-sentence job for me."

**What you will still be asked about (correctly):** product-behavior reversals, anything that can lose data or touch `~/.eido`, force-pushes/history rewrites, secrets. Everything else is mechanics and is the operator's job.

## 7. Follow-ups to file

1. **CI on all PRs** — drop `branches: [main]` from the `pull_request` trigger in `.github/workflows/ci.yml` so stacked PRs get checks and retargets don't create blind spots. One line; highest leverage per character of any fix in this retro.
2. **Stack policy** — record in the orchestration playbook: max stack depth 1 (a PR may stack on one unmerged parent, never deeper); prefer landing slices to main.
3. **Merge-captain skill consolidation** — PR #291's `skill-draft-merge-captain.md` plus this retro's §5 should merge into one runbook when #291 lands; the stacked-PR rules (§5.1, 5.3, 5.4, 5.8) are the delta.
