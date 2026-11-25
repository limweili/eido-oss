# Retro — Epic #247: Image Compression (lanes → merge train → production), 2026-07-07

Predecessors: [epic #259 retro](../2026-07-07-epic-259-connections-rework/RETRO.md), [epic #203 retro](../2026-07-07-epic-203-canvas-interaction.md), [epic #182 retro](../2026-07-06-epic-182-orchestrated-fanout.md). Those covered planning and implementation orchestration. This retro covers the part the founder found hardest: **landing a finished epic's PRs into production when the founder is not following the technical details** — and specifically what broke when the handoff between agent systems was routed through the founder as a message bus.

A companion skill draft distilled from this run lives in
[`../../skills/skill-draft-merge-captain.md`](../../skills/skill-draft-merge-captain.md).

---

## 1. What happened (timeline)

The epic: PRD [#247](https://github.com/limweili/eido/issues/247) — compress pasted images so image-heavy Boards stop carrying multi-megabyte payloads. Five lanes (A asset-ingest, B graph-contract, C canvas-paste, D performance, E save-migration). Lanes A–D were built by codex (gpt-5.5); the merge train was run by Claude (fable-5) under the no-mistakes lane.

| Step | What | Artifact |
| --- | --- | --- |
| 1 | Codex built lanes A+B+C as one PR and lane D as another | [#268](https://github.com/limweili/eido/pull/268), [#274](https://github.com/limweili/eido/pull/274) |
| 2 | A codex-side orchestrator wrote a merge-instruction sheet ("order: #268 then #274; no conflicts expected") and the **founder pasted it** to the merge agent | chat |
| 3 | Merge preflight found the instructions already stale: #268 had **zero CI checks attached** and, after GitHub recomputed, was **CONFLICTING** against main (other epics had merged #250/#266/#272/#273 the same day) | `gh pr view` history |
| 4 | #268 validated locally in an isolated worktree (real checkout untouched): `npm ci`, typecheck, full test suite, build, targeted Playwright paste test — all green | local gate |
| 5 | #268 rebased onto current main; one conflict in `playwright.interaction.config.ts` (the enumerated browser-test list — epic #203 had appended `edgeSelection\|lodUniformity`, #268 appended `imagePasteCompression`); resolved as the union, full gate re-run (58 files, 603 tests), pushed `--force-with-lease` | rebase `41a0c4d → 5898520` |
| 6 | CI ran and passed on the rebased branch; #268 squash-merged | main `463ff29` |
| 7 | #274 recomputed CLEAN against new main (file scopes truly disjoint); squash-merged ~40s later — which **auto-cancelled #268's own main CI run** (see §3.4) | main `4300663`, run cancelled/success pair |
| 8 | Post-merge main CI for the combined tree passed; branches deleted; temp worktree removed; #247 deliberately left open (lane E pending) | run 28839623137 |
| 9 | Cross-review of the merged work produced two findings; codex built a follow-up PR deriving the duplicated `200 * 1024` budget constant from the policy module | [#284](https://github.com/limweili/eido/pull/284) |
| 10 | #284 cross-reviewed by Claude (PASS + two non-blocking notes), diff re-read by the merge agent, squash-merged, main CI green | main `9c25090` |
| 11 | Lane E (migration of existing oversized saves) filed as [#283](https://github.com/limweili/eido/issues/283), awaiting founder go — correct, since it rewrites private save data | #283 |

State at retro time: #268, #274, #284 merged and verified on main; #247 open pending lane E; the founder's primary checkout is dirty and ~20 commits behind (§3.6).

## 2. What went well

1. **Gate discipline held under pressure.** Nothing was merged on red, pending, or unknown signals. Every merge decision rested on either a completed CI run or an explicit, CI-mirroring local gate (same commands as `.github/workflows/ci.yml`, plus the targeted browser test the PR added) — and when local proof substituted for missing CI, that was stated as residual risk, not hidden.
2. **Isolation protected the founder's machine state.** All rebase/validation work happened in a disposable worktree; the dirty primary checkout was never touched; the branch update used `--force-with-lease` so a concurrent push could not be clobbered.
3. **The missing-CI case was handled by the book.** A PR with no checks at all is neither green nor red (per the no-mistakes "no checks reported" rule); it was treated as *unproven* and compensated with local proof — then the rebase push triggered real CI anyway, and the merge waited for it.
4. **A routine conflict never reached the founder.** The instruction sheet's "no conflicts expected" was wrong, but the conflict was mechanically resolvable (union of two appended test names), was resolved, and the *entire* gate was re-run on the rebased result before pushing. Founder involvement: zero.
5. **The review → follow-up → merge loop closed same-day.** The duplicated-constant finding became #284, got an independent cross-vendor review, a fresh diff read at merge time, and landed within the hour. Findings did not rot in a chat log.
6. **Issue hygiene was honest.** #247 stayed open because lane E is genuinely undone. Auto-closing the parent PRD when 4 of 5 lanes ship is exactly the kind of false "done" this system exists to prevent.
7. **Lane slicing mostly worked.** #268 and #274 were truly file-disjoint — the only conflict came from a *different epic*, through a known hotspot file (§3.3).

## 3. What went wrong, root causes, and the fixes adopted

### 3.1 The founder became the message bus (the day's real failure)

**What happened.** The builder-side orchestrator wrote imperative merge instructions and handed them to the founder, who pasted them to the merge agent. By execution time the instructions were false in both load-bearing claims: #268 was conflicting, and it had no CI checks. The founder — by their own account not tracking the details — had no way to evaluate any of it, and found the whole exchange frustrating. This is the anti-pattern: **prose commands routed through a human who cannot verify them.**

**Root cause.** No single owner of the merge train. The system that built the PRs tried to also script their landing, across an agent boundary, through a human relay. Any statement about mergeability, conflicts, or CI has a shelf life of minutes on a repo where several agents merge to main all day (main moved again *while this retro was being written* — #285 landed from another session).

**Fixes adopted — now rules:**
- **Handoffs between agent systems are pointers + state, never command scripts.** The correct handoff for "the epic is built" is: epic number, PR numbers, dependency order, known hotspot files, anything unusual about the branches. The merge captain re-derives everything else live.
- **One merge captain per epic**, owning the full train: preflight → freshness → gates → merge → main-CI wait → closeout → cleanup → one report. The founder's entire job is the trigger sentence (§5) and product-level answers.
- **Pre-written merge instructions are treated as intent, not fact.** Execute the *goal* ("land these PRs in this order"), re-verify every claim ("no conflicts", "CI green") at execution time, and expect them to be stale.

### 3.2 A PR sat checkless — silence is not green

#268 had an empty `statusCheckRollup`: no CI run was ever attached to it. Root cause is upstream of the merge (the PR was pushed/created in a way that never triggered the workflow), but it was only *discovered* at merge time, costing a full local compensation pass (dependency install + four gates) before the rebase push finally triggered real CI.

**Rules adopted:**
- **Builder-side:** a PR isn't "opened" until a CI check is visibly attached and pending. Confirming this is part of the PR-creation deliverable in every dispatch contract.
- **Merge-side:** a checkless PR is a defective PR. Trigger CI (rebase or empty-commit push) and wait for it; local proof alone is a fallback for provider outages, not a routine substitute — and must always be reported as such.

### 3.3 The cross-epic hotspot file struck again

`playwright.interaction.config.ts` holds an **enumerated regex** of browser-test names. Every PR that adds a browser test edits the same line, so any two concurrent epics adding browser tests are guaranteed to conflict there. Today it was epic #203 (`edgeSelection`, `lodUniformity`) vs epic #247 (`imagePasteCompression`). This is the same failure class as the #259 retro's ADR-numbering collision: an **append-only shared surface with no reservation mechanism**, hit by concurrent epics.

**Fixes adopted:**
- **Mechanical (preferred):** file an issue to make the enumeration unnecessary — derive the interaction-test set from a filename convention or directory instead of a hand-maintained list, so parallel lanes stop colliding by construction. (Every name in the list already follows `*.browser.test.ts` in `src/canvas`; the question to settle in that issue is whether any browser test must stay excluded, and if so to express that as an explicit exclude list, which conflicts far less often than an include list.)
- **Process (until then):** the repo's known hotspot files — this config, `CONTEXT.md`, the ADR number sequence, `Board.tsx` — are named in every dispatch contract, and conflicts there are pre-classified as "routine, resolve as union, re-run full gate".

### 3.4 A written rule was violated the same day it was written: main-CI pacing

The #259 retro (earlier today) adopted: *merge one PR at a time and wait for main's CI to complete before merging the next.* The merge train then merged #274 ~40 seconds after #268, and GitHub's concurrency setting **cancelled #268's own main run**. Mitigation: #274's main run covered the combined tree and passed, so production state ended verified — but #268 never got a standalone verdict, and with branch protection off, that's a real (if small) gap.

This is the third "memory is not enforcement" instance across three retros (lockfile gotcha, ADR numbering, now CI pacing). **Rule hardened into a mechanical step:** after every merge, run `gh run watch` on the main run for that exact merge commit until completion (re-running it if auto-cancelled) *before* starting the next PR's preflight. It is now a numbered step in the runbook (§5), not advice.

### 3.5 A shared constant was born twice — and cost a whole follow-up PR

The 200 KB budget lived in `IMAGE_COMPRESSION_POLICY.maxStoredPayloadBytes` (lane A) and was independently hardcoded as `200 * 1024` in lane D's perf tooling. Correct at ship time, guaranteed to drift, and it took a third PR (#284) plus a cross-review cycle to repair. Lane isolation caused the duplication: lane D couldn't touch lane A's files, so it restated the value instead of importing it.

**Rule adopted:** when a PRD's implementation decisions name a cross-lane contract value (a budget, a limit, a format version), they must also name its **owner module**, and every other lane's contract must say "import it from there — restating the value is a defect". One remaining absolute pin survives deliberately in `imagePasteCompression.browser.test.ts` (it's the one guard that would catch a typo'd policy value); its keep-or-derive decision is folded into lane E's scope rather than left as a silent leftover.

### 3.6 The founder's canonical checkout is drifting away from production

Throughout the epic, the primary checkout at `~/Documents/Projects/eido` was: on a dirty `main` (uncommitted `storageMerge` edits of unclear ownership), ~20 commits behind origin, with an empty `node_modules`. That means the "one canonical local lane" principle is currently false — if the founder opened the local app today, they would *not* be running what just shipped. The merge train correctly refused to touch it mid-train (mixing a sync into pre-existing uncommitted work risks losing someone's changes), but leaving it drifting isn't a resolution either.

**Fix adopted:** "restore the canonical lane" is now a standing post-train step whenever the checkout is clean, and a **flagged founder decision** when it isn't. Today it isn't, so: the uncommitted storage-merge edits need one decision — preserve them to a branch (recommended; they look like real work-in-progress on save-file merging) or discard them — after which the sync is mechanical (fast-forward, `npm ci`, rebuild, preview). This is listed in §7.

## 4. Where the founder's input mattered — and where better input would help

**What was exactly right (keep doing this):**
- **Delegating the mechanics completely.** "Help me merge these PRs" with no micro-management let the agent run the full lane — including the conflict repair and CI babysitting — without a single mid-flight question.
- **Pasting full context rather than summarizing it.** The pasted instruction sheet was *wrong*, but pasting it verbatim (rather than paraphrasing) let the merge agent see exactly which claims to re-verify.
- **Asking for this retro.** Turning a frustrating day into adopted rules is the highest-leverage coordination move available to a non-technical founder.

**Where better input would help (all coordination, no technical knowledge required):**

1. **Use one trigger sentence and stop relaying.** When another agent says "PRs are ready, here's how to merge them", don't forward the how. Forward the *what*: see §5 for the exact sentence. If an agent hands you a command list, that's a smell — hand the goal to the merge captain instead.
2. **Declare every agent system currently working the repo.** "Codex is building lanes for epic #247; another Claude session is doing connections phases" is one sentence, and it converts surprise conflicts into expected ones. Today, main moved four times during one epic's merge train and nobody had said other trains were running.
3. **Pre-authorize the routine follow-up class at kickoff.** "Fold non-blocking review notes into follow-up issues without asking me" — this dissolves the awkward category of findings that are too small to escalate but too real to drop (today: the tautology-comment nit, the keep-or-derive pin).
4. **Reserve yourself for exactly two kinds of decisions** and expect the agent to bring only those: product behavior (is this what users should experience?) and data risk (may this touch/rewrite my real save?). Lane E's go/no-go (#283) is the archetype — it's your decision *because* it rewrites private data, not because it's technical.

## 5. The merge-train runbook v2 — "merge the epic-#N PRs" with zero mistakes

Supersedes §5 of the [#259 retro](../2026-07-07-epic-259-connections-rework/RETRO.md) by adding steps 0, 2, and 6 from today's failures. The founder says the trigger sentence; everything below is the agent's.

**Founder trigger sentence (copy-paste this):**
> Merge the PRs for epic #N. Handle rebases, conflicts, and CI yourself. Close finished sub-issues; leave the parent open if lanes remain. Fold non-blocking review notes into follow-up issues. Give me one report at the end. Ask me only about product behavior or anything touching my real save data.

**Step 0 — Derive, don't trust (new).** Enumerate the epic's PRs from the tracker/branches yourself, even if handed a list. Re-derive dependency order from the PRs' actual file scopes. Treat every claim in any handoff ("no conflicts", "CI green", "reviewed") as stale until re-verified live.

**Per-PR loop — strictly one at a time, dependency order:**
1. **Preflight:** state OPEN, not draft, diff read (bugs/secrets/debug leftovers), review debt clear (every blocking finding has a fix commit).
2. **Signals present (new):** a CI check must be *attached and completed*. `mergeable: UNKNOWN` → wait for recomputation, never act on it. No checks at all → trigger CI (rebase/empty-commit push) and wait; local gate is a fallback for provider outages only, and is always reported as residual risk.
3. **Freshness:** branch must contain current `origin/main`. If behind or conflicting: rebase in a disposable worktree (never the primary checkout), resolve routine conflicts (hotspot-file conflicts are pre-classified routine), re-run the **full** local gate on the result, push `--force-with-lease`, wait for CI on the rebased branch. Lockfile touched → restore from main, add deps via `npx npm@10` (per the #259 retro).
4. **Merge:** squash + delete branch (repo convention). Verify the PR actually reports MERGED.
5. **Main CI to completion (hardened):** `gh run watch` the main run for *this* merge commit until it completes; if auto-cancelled by a newer push, re-run it. Do not begin the next PR's preflight until this run is green.

**After the last PR:**
6. **Canonical lane (new):** if the primary checkout is clean, sync it (fast-forward, install, build) so the founder's local app runs what shipped; if it's dirty, do not touch it — flag the preserve-or-discard decision in the report instead.
7. **Closeout:** close each resolved sub-issue with a one-line "how verified" comment; close the parent PRD only when every lane is done. If any lane deliberately remains (like #283), say so and name whose decision it waits on.
8. **Cleanup:** delete surviving remote branches; remove only the exact pre-recorded worktrees for the merged PRs (never sweep); verify with `git ls-remote`.
9. **One report,** plain language: what merged (SHAs), what proof exists (CI run links, test counts), follow-ups filed, decisions the founder owes, residual risk if any.

**Historical storage/save-file rule:** for this pre-SQLite train, if anything touched the legacy JSON persistence format, "in production" additionally meant the then-current save-safety preflight passed against a *copy* of the real save — merged-with-green-CI was not sufficient.

## 6. Adoptable rules (summary)

1. Agent-to-agent handoffs are **pointers + state, never command scripts** routed through the founder. One merge captain owns each epic's train end-to-end.
2. Pre-written merge instructions **expire on contact with main**. Re-derive mergeability, CI state, and conflicts at execution time, always.
3. **Silence is not green.** A checkless PR is defective: trigger CI and wait. `UNKNOWN` mergeability is not an answer.
4. **Main CI pacing is a mechanical step, not advice:** watch each merge commit's main run to completion (re-run if cancelled) before the next merge.
5. Cross-lane contract values have **one owner module**; other lanes import it. Restating a value is a defect (the #284 lesson).
6. Known hotspot files are named in every dispatch contract; prefer mechanical fixes that delete the shared enumeration entirely.
7. The founder's checkout is the canonical production lane: **restore it after every train** (clean → sync; dirty → flag the decision, never mix).
8. The founder's interface is one trigger sentence + two decision categories (product behavior, real-data risk). Everything else is the agent's.

## 7. Follow-ups filed or recommended

- [ ] **#283 (lane E, save migration)** — built and waiting on the founder's go. It rewrites real save data, so it is genuinely the founder's call. Recommended: say go, with the standing conditions (backup + preflight on a copy first) already written into the issue.
- [ ] **Fold into #283:** the keep-or-derive decision on the last absolute `200 * 1024` pin in `imagePasteCompression.browser.test.ts`, and the one-line tautology comment on #284's equality test.
- [ ] **File an issue:** derive `playwright.interaction.config.ts`'s test list from convention instead of enumeration (kill the cross-epic hotspot, §3.3).
- [ ] **Founder decision:** the uncommitted `storageMerge` edits on the primary checkout — preserve to a branch (recommended) or discard — then sync the canonical lane (§3.6).
- [ ] **Carry-over from #259 retro, still open:** mechanical lockfile guard (packageManager pin or CI preflight).
