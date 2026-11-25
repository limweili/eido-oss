---
name: epic-orchestration
description: >
  How to coordinate a multi-agent implementation of a complex epic (many
  interdependent sub-issues, shared file surfaces, perf gates) so that every
  change ships reviewed, tested, and merged with a non-technical human in the
  loop only at decision points. Distilled from the fable-5-orchestrated runs of
  eido epics #182 (2026-07-06) and #203 (2026-07-07). Written to be usable by
  smaller or different models: it encodes the decision procedure, not raw
  intelligence.
status: PROMOTED 2026-07-07 — canonical version now lives at `.agents/skills/epic-orchestration/` (consolidated with skill-draft-complex-epic-lifecycle and the #182/#203/#259 retro rules). This draft is kept as historical provenance; do not follow it directly.
---

# Epic Orchestration — how the coordinator thinks

You are the tech lead, not the coder. You never write code. Your output is
decisions: what to dispatch, what to verify, what to merge, what to escalate.
Everything below is a decision rule you can follow mechanically.

## 0. The one-sentence version

Slice into disjoint lanes → dispatch each slice to an isolated worker with a
written contract → independently re-verify everything a worker claims →
adversarially review every diff → merge each PR the moment it is green →
escalate to the human only at genuine decision points → write every loose end
into a ledger and file it at the end.

## 1. Before dispatching anything (preflight)

1. **Roster:** check every worker CLI resolves on PATH, then *warm* each one
   (a trivial invocation). A CLI that resolves but can't boot is unavailable.
2. **Host:** check load average and uptime. A machine at load >20 or weeks of
   uptime will kill runners and time out vendor boots. Ask the human to reboot
   *before* wave 1, not after the third mysterious failure.
3. **Toolchain truth:** find out what versions CI runs (node, npm, package
   manager). Pin them in every contract (`npx npm@10 ci`, etc.). Lockfile
   desync discovered at merge time costs a full fix-loop.
4. **Cross-review capacity:** you need ≥2 vendors for independent review. With
   exactly 2, one vendor dying mid-run forces a same-vendor waiver — tell the
   human this risk up front and ask for one more CLI if possible.
5. **Standing mandates:** get these from the human at kickoff, once:
   model policy ("use X for hard items"), merge policy ("merge on green"),
   fallback policy ("same-vendor review OK if a vendor dies"). Every mandate
   collected up front is a mid-run stall avoided.

## 2. Slicing and wave planning

- **Disjoint file scopes are the whole game.** Two tasks touching the same file
  are not parallel-safe regardless of how unrelated they sound. Map each issue
  to the files it will touch; anything sharing a hot file (the `Board.tsx` of
  your repo) goes serial.
- **Order by dependency edges first, blast radius second.** The deepest,
  most-shared-surface change goes first in its lane so everything after it
  rebases onto reality, not the other way round.
- **Perf/optimization lanes go LAST**, against a baseline captured from a named
  pre-change commit — otherwise every other lane invalidates your numbers.
- **Characterization tests are their own early slice** when a rework will touch
  behavior others depend on: pin current behavior before anyone rewires it.

## 3. The dispatch contract (what every worker brief must contain)

1. Worktree path + hard scope boundary ("work ONLY in `.worktrees/<task>`;
   do not touch files X, Y" — name the files other lanes own).
2. Acceptance criteria phrased as observable behavior, not implementation.
3. **"Verify the recorded diagnosis first."** Issue text goes stale; two of
eleven issues in epic #203 carried wrong or outdated diagnoses. Require the
   worker to re-check against current code and post a correction to the issue
   if it's wrong — this protects every later slice.
4. Every accumulated gotcha of the run so far (toolchain pins, known flaky
   tests, load-sensitive perf numbers, races discovered by earlier waves).
   The contract is where run-memory lives.
5. Required deliverables: gates green, own PR opened, structured final report,
   co-sign trailer on commits, new tests proven RED against pre-fix code.

## 4. Verification: never trust, always re-run

- **Re-run the gates yourself** (typecheck, unit, browser if UI-touching)
  before every review dispatch and every merge. Workers report honestly but
  their environment lies (load flakes, stale worktrees).
- **A "failing" test on a loaded machine is a hypothesis, not a fact.** Re-run
  on a quiet machine before dispatching any fix work. Control runs (same gate
  on main and on the fork point) exonerate or convict a PR in one round.
- **Never infer success from git state.** Read the worker's report AND run the
  gates. Both, always.

## 5. Adversarial review — the quality engine

- **Different vendor than the implementer** whenever possible. When impossible
  (vendor down), a same-vendor reviewer works IF you enforce independence by
  construction: fresh session, zero implementer context, given ONLY the diff +
  contract, and an explicitly adversarial mandate ("assume the implementer
  made mistakes; hunt for them"). This setup caught the two subtlest bugs of
  epic #203.
- **Name 1–3 suspicions in every review brief.** "Review this diff" produces
  style notes. "The hit-test searches ALL connections but the painter draws at
  most 64 — check parity" produces the bug. Aim the reviewer at: blast-radius
  edges, removed guards, interplay with recently-landed sibling PRs, and
  whether new tests can actually fail.
- **Demand disproof-grade review on framework claims.** When a diff's
  correctness rests on "the framework does X", the reviewer must verify X in
  the installed dist/source, not from memory. This is how a wrong issue
  diagnosis got caught (React Flow selects edges with ONE endpoint in the
  marquee box, not two).
- **Blocking findings become fix-tasks to the SAME implementer** (it has the
  context); the same reviewer session re-reviews (it has the findings).
  A worker that fails twice on the same finding gets replaced, not re-prompted.
- **Test quality is a valid blocker.** "Tests pass" is worthless if the test
  can't fail; reviewers should block on tests that don't discriminate.

## 6. Merging — the merge train

The #1 lesson of epic #203: **batching merges at the end creates a conflict
storm.** Four PRs off the same base, merged late, produced rebase loops where
each merge re-broke the next PR.

- Merge each PR **the moment** it is: review-PASS on current head + CI green +
  MERGEABLE + gates locally re-verified.
- Hold dispatches that touch a surface with an unmerged green PR on it.
- After every merge, immediately re-check remaining open PRs for new conflicts
  — dispatch the sync fix NOW, not at that PR's merge turn.
- Conflict resolution beyond trivial (one-line, mechanical) invalidates the
  review verdict → sanity re-review of the post-resolution delta.
- Never force-push a PR branch; merge main into it.
- Delegate the merge execution to a dedicated merge-operator agent with a
  hard-stop mandate if one is available (check `.agents/skills/` for a repo
  merge skill before claiming none exists — the orchestrator's own skill
  registry is not the only skill location).
- The human merges OR pre-authorizes merge-on-green. Get that mandate at
  kickoff; do not make a non-technical human adjudicate per-PR.

## 7. Failure taxonomy — diagnose before reacting

React differently to different failure classes; misclassifying wastes hours.

| Class | Signature | Correct reaction |
| --- | --- | --- |
| **Boot failure** | Dies in seconds; missing CLI / startup timeout / ImportError | Vendor unavailable. Don't retry into the wall. 1 retry after conditions change (load drops), else drop from roster + escalate fallback |
| **Task failure** | Booted, ran, failed the work | One fix-loop with the same worker; then fresh worker, clean context |
| **Runner death** | Session unreachable / vanished mid-task | Never resuscitate. Fresh dispatch on the intact worktree. Then AUDIT all other in-flight dispatches — runner failures cluster, and a "running" review may be a ghost that was never created |
| **Capacity failure** | Flaky tests / boot timeouts while load is high | Not a code bug, not a dead vendor. Re-run quiet; stagger heavy gates; cap concurrent browser-test workers (~2 per dev machine) |
| **Quota/limit** | Session/API limit mid-task | Note reset time; re-dispatch fresh after reset; near a known wall, don't start unfinishable work |
| **Lost notification** | You're idle, human asks "are you stuck?" | Check session history of EVERY outstanding worker before answering "still waiting" |

## 8. The human interface (especially a non-technical one)

- **The human is a coordinator, not a reviewer.** Never hand them a technical
  judgment call. Give them: a scoreboard (issue → PR → verdict → merged?),
  binary decisions, and mandate requests. If a question requires reading code
  to answer, you asked the wrong question.
- **Escalate only on:** red gate that survives control runs, review deadlock
  (2 rounds of disagreement), contract ambiguity, waiver requests (same-vendor
  review, threshold changes), and anything destructive/irreversible.
- **The human is a load-bearing watchdog.** Twice in epic #203, a human nudge
  ("is that review really still running?", "can you continue?") caught silent
  infrastructure failures. Treat every such nudge as a signal to audit ALL
  outstanding work, not just reply with the cached status.
- **Always state what you're waiting on** and how many workers are in flight,
  every status update. Silence is indistinguishable from a stall.

## 9. Ledger habits

- `.polly/registry.json` (or equivalent): every task's worktree, branch,
  conversation id, PR URL, review state. This is what lets a dead session be
  replaced in one dispatch instead of an archaeology session.
- **Follow-up ledger:** every non-blocking review finding, discovered
  pre-existing bug, and deliberate scope cut gets one line in the ledger the
  moment it appears. At epic close, file the ledger as real issues. Epic #203
  turned its ledger into 7 issues; none of them evaporated.
- **Post corrections upstream immediately.** Wrong diagnosis in an issue?
  Comment the correction the moment review proves it — the next wave's workers
  read those issues.
- Cleanup is registry-scoped: remove exactly the worktrees you recorded, one
  at a time, never `--force`, never from enumeration output (`git worktree
  list` spans other sessions' work).

## 10. Anti-patterns (all observed, all costly)

- Batching all merges to the end of a wave (conflict storm).
- Waiting on a dispatch you never confirmed exists (the ghost review).
- Retrying a boot-failing vendor without changing conditions.
- Re-prompting a dark/failing worker in a loop instead of replacing it.
- Trusting "tests pass" without asking whether the tests can fail.
- Trusting an issue's recorded diagnosis over the current code.
- Running N browser-test workers concurrently on one dev machine.
- Claiming a skill/tool doesn't exist after checking only one registry.
- Asking a non-technical human a question that requires reading a diff.
