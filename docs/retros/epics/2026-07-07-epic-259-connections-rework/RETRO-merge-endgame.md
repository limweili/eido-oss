# Retro — Epic #259 Merge Endgame: Phases 2–6 + docs landed, epic closed (2026-07-08)

Companion to the lifecycle retro in this folder ([`RETRO.md`](RETRO.md)), which ended at **"Phase 1 merged, #261–#265 open."** This one covers everything after: the downstream **merge endgame** — Phases 2–6 and the docs-sync all reconciled, cross-reviewed, and squash-merged one at a time, then the epic closed out end-to-end.

Predecessor merge retros whose rules were tested here: [epic #247 merge train](../2026-07-07-epic-247-image-compression/RETRO.md), [epic #236 merge endgame](../2026-07-07-epic-236-follow-up-threads/RETRO.md). Both warned "avoid stacked PRs." This epic was a six-deep stack — so it is the clean experiment for what that warning costs when ignored.

---

## 1. What happened (timeline)

| Step | What | Artifact |
| --- | --- | --- |
| 1 | Phase 2 implemented (pill + popover, hover, tray removal), cross-reviewed PASS r1 | PR [#287](https://github.com/limweili/eido/pull/287) → `83757bb` |
| 2 | Phase 3 (perf-gated feel/pulse): original Claude worker **died — Claude usage exhausted mid-epic** | — |
| 3 | **Recovery detour:** the orchestration dir + registry had been deleted; a Codex re-dispatch boot-failed because its terminal spawns there. Rebuilt dir + registry, re-dispatched. | — |
| 4 | Pivot: **all remaining implement + review ran on Codex** (same-vendor, separate sessions), Claude being out | — |
| 5 | Phase 3 review **FAIL** — playback pulse regression introduced by a main-merge **conflict resolution** — → fix → **PASS** | PR [#289](https://github.com/limweili/eido/pull/289) |
| 6 | Founder pinned polly's brain to Opus 4.8 High | — |
| 7 | Phase 4 (compiler sections): review **FAIL** (SHARED CONTEXT leak for Avoid→Conversation) → fix → **PASS** | PR [#294](https://github.com/limweili/eido/pull/294) → `fdd217b` |
| 8 | **Near-miss:** polly told the founder "merge #294 now" off a shallow check; the paired **merge captain** held it — draft, zero CI, no review verdict on the PR, 8 behind main | PR #294 thread |
| 9 | Phase 5 (context preview): review **FAIL** (compaction-drift seam + raw `conn-*` ids) → fix → **PASS** | PR [#296](https://github.com/limweili/eido/pull/296) → `2be768d` |
| 10 | Phase 6 (mark-as-explored): review **PASS** r1 | PR [#297](https://github.com/limweili/eido/pull/297) → `20f7656` |
| 11 | Docs-sync: review **FAIL** (docs quoted the section heading with ASCII `--`; compiler emits an em dash `—`) → fix | PR [#298](https://github.com/limweili/eido/pull/298) → `d7d7935` |
| 12 | Each stacked PR, after its parent squash-merged, needed a **main→branch reconciliation** (Phase 5: 7 files; Phase 6: 3; docs: 3), each **independently re-reviewed on the reconciled head** | reconcile + review sessions |
| 13 | Close-out: founder checkout fast-forwarded (was clean) `d4bf003`→`d7d7935`; 6 sub-issues closed (4 manually); epic closed; worktrees removed; local branches deleted | main `d7d7935` |

State at retro time: **#259 CLOSED**, all six sub-issues (#260–#265) CLOSED, all seven PRs merged, main CI green between every merge.

## 2. What went well

1. **The paired merge-captain caught the epic's most dangerous moment.** polly said "merge #294 now" after checking only base-branch + GitHub's `MERGEABLE/CLEAN`. The captain re-derived the real gate independently and held: the PR was still a **draft**, had **zero CI checks attached**, carried **no review verdict on the PR itself**, and was **8 commits behind main**. Independent re-derivation of merge-readiness — not trusting the proposer — is what turned a potential "founder merges an unproven PR" into a non-event. The division of labour (polly reconciles + reviews; captain re-derives + merges; neither trusts the other's word) held under stress.
2. **Cross-review kept catching real blocking defects by construction — even same-vendor.** After Claude ran out, Codex reviewed Codex, but in fresh sessions instructed to *verify by construction, not read the description*. It still caught, on three separate PRs: a `SHARED CONTEXT` leak for Avoid-connected Conversation inputs (#294), a context-preview compaction-drift seam plus raw-id UI leakage (#296), and an em-dash heading mismatch in docs (#298). Fresh-context construction beats description-reading regardless of vendor.
3. **Reconciliation was treated as first-class, reviewable work — not plumbing.** Every squash-then-reconcile produced a new head that had never been reviewed as-merged. Each got an **independent review on the reconciled head**, plus a mechanical **diff-scope check** (diff vs main must be *only* that phase) and a **merged-tree preservation grep** (all earlier streams still present — no silent reverts). On the one shared-file auto-merge (`store.ts`, touched by both Phase 6 and the #293 storage fix) the check was tightened to "diff is additive, `+32/-0`, deletes zero #293 lines." This rigor was a direct debt paid from Phase 3, whose real regression came from a *clean-looking* conflict resolution.
4. **Verify-don't-trust, on every head.** polly re-ran the full gate (typecheck/unit/browser/build) itself on each reconciled head rather than trusting worker or CI reports, and scope-checked every diff. Worker gate counts were confirmed, never assumed.
5. **Graceful degradation when a whole vendor went dark.** Claude usage exhausting mid-epic did not stall the train — implement and review both moved to Codex without a re-plan, and the blind-spot cost was named openly to the founder rather than hidden.
6. **The guardrails worked and were respected.** The blast-radius policy correctly blocked an irreversible remote-branch deletion; polly did not fight it — it split the reversible local cleanup from the irreversible remote op and handed the latter off. Committing docs-only work and refusing to touch a dirty founder checkout followed the same "reversible now, irreversible with a human" instinct.
7. **Close-out was verified, not assumed.** Sub-issues were closed with real PR/commit references; the founder checkout was synced **only after confirming it was clean** (a fast-forward, never a touch of dirty state); worktrees removed against the live list, not swept blindly.

## 3. What went wrong, root causes, and the rules adopted

### 3.1 "Merge now" off a shallow check — the endgame's biggest near-miss

**What happened.** polly recommended the founder merge #294 immediately, having verified only that the base was `main` and GitHub reported `MERGEABLE/CLEAN`. The captain's independent re-derivation found four disqualifiers on the exact head: still a **draft**, **zero CI checks attached** (in a repo whose CI runs on every PR — silence = defective, not fine), **no review verdict recorded on the PR**, and **8 commits behind main** (missing Phase 3 and the #293 storage fix).

**Root cause.** Conflating GitHub's `MERGEABLE/CLEAN` with *merge-ready*. That flag means only "no textual merge conflict against the base" — it says nothing about draft state, CI, review, or freshness. A single green-looking API field was treated as a gate.

**Rule adopted.** **Merge-readiness is a checklist, never one field.** A PR is mergeable only when, on the *exact* head to be merged: draft is lifted; CI is *attached* AND green (zero checks = defective, never "silently ok"); an adversarial review verdict is recorded **on the PR**; and the branch contains current `origin/main`. `MERGEABLE/CLEAN` is a precondition, not the verdict.

### 3.2 Review verdicts lived in session state, not on the PR

**What happened.** polly ran diff+contract reviews inside ephemeral sub-agent sessions and recorded the verdicts only in its own orchestration notes. When the captain went to gate #294, it could find **no approval anywhere on the PR** — a real, load-bearing gap (§3.1's disqualifier #3).

**Root cause.** The durable record was written where the *proposer* looks (session state), not where the *next actor* looks (the PR).

**Rule adopted.** **Post the review verdict as a PR comment at decision time.** The PR is the record of record; a verdict the next actor can't find on the PR does not exist. (Fixed mid-stream — every subsequent reconciliation review verdict was posted to its PR, including the FAIL→fixed on #298.)

### 3.3 Squash + a six-deep stack = recurring reconciliation toil *and* the epic's only real regression

**What happened.** Because the repo squash-merges but the phases were a stack, **every phase after its parent merged needed a fresh main→branch reconciliation with conflicts** (Phase 5: 7 files including the compiler seam; Phase 6: 3; docs: 3). Each reconciliation was a new regression surface — and Phase 3's actual shipped-then-caught regression (the playback pulse refiring) came from exactly such a main-merge conflict resolution silently dropping a guard.

**Root cause.** Stacked slicing was chosen for logical dependency, but squash-merge breaks stacks: a squashed parent forces each child to reconcile against a history it no longer shares. The #247 and #236 retros already carry the rule "avoid stacked PRs"; it was not heeded here.

**Rule adopted (reaffirmed, now operational).** Prefer **non-stacked, independently-mergeable slices**. When a stack is genuinely unavoidable: (a) every reconciled head gets an **independent review**, never gates-only; (b) every reconciliation gets a **diff-scope check** (the diff vs main must be *only* the intended phase) and a **merged-tree preservation check** (grep the merged tree to prove no earlier stream was reverted — a dropped stream shows as a deletion or missing line, not always as a conflict); (c) shared-file auto-merges get an **additive-diff assertion** (e.g. `store.ts` `+N/-0`, deletes zero prior-stream lines). Textually-clean ≠ semantically-correct.

### 3.4 CI did not attach on un-draft

**What happened.** Un-drafting #294 (`ready_for_review`) did **not** trigger the CI workflow, so its only gate for a while was a local run. Later PRs got CI because a *push* to the head triggered it.

**Root cause.** The workflow's trigger events don't reliably include `ready_for_review`; un-draft alone leaves a PR checkless.

**Rule adopted.** Don't trust un-draft to start CI. Ensure CI is **attached and green on the exact merge head** — push to the head (or re-run) and confirm — before handoff. Treat "zero checks" as defective, never as implicit pass. (Recommend a small follow-up: add `ready_for_review` to the workflow triggers.)

### 3.5 Stacked PRs didn't auto-close their sub-issues

**What happened.** #261/#263/#264/#265 stayed **open after their PRs merged**; only #260 and #262 auto-closed. Manual close-out was needed.

**Root cause.** The closing keywords (`Closes #…`) resolved against the **stacked base branch**, not `main`, so merging to main never fired GitHub's auto-close.

**Rule adopted.** For stacked PRs, either target closing keywords at `main` explicitly, or **plan manual sub-issue close-out** as a close-out step. Don't assume auto-close fired — verify each sub-issue's state at the end.

### 3.6 Orchestration state lived in a deletable scratch dir

**What happened.** The registry and orchestration directory (`eido-worktrees/feat-connection-rework`) were deleted mid-epic, boot-failing a Codex re-dispatch (its terminal spawns there) and forcing a rebuild-and-recover detour. That directory is *still* a stray non-git folder.

**Root cause.** Durable orchestration state (the registry) was parked in an ephemeral location that nothing protected.

**Rule adopted.** Orchestration state lives in a **durable, repo-anchored location**, not a scratch worktree that a cleanup can vaporize. (Follow-up: relocate the registry; remove the stray dir.)

### 3.7 Single-vendor review is a degraded mode, and the roster was too thin to avoid it

**What happened.** With Claude exhausted and only `claude_code` + `codex` installed (no `opencode`/`cursor`/`hermes`/`pi`), every review after the pivot was Codex-reviews-Codex. It caught real defects — but shared-model blind spots stayed shared.

**Root cause.** Cross-vendor review needs ≥2 *available* vendors; a two-vendor roster where one is exhausted collapses to same-vendor. The independent-model cross-check was a single point of failure.

**Rule adopted.** Treat single-vendor review as an explicit **degraded mode**: name the blind-spot risk at the plan gate and get human acknowledgement (done here, if retroactively). **Widen the installed vendor roster** so cross-vendor review survives one vendor's outage.

### 3.8 A couple of round-2 review skips (logged, not hidden)

Two fix rounds (a comment-only doc fix, and the `--`→`—` punctuation fix on #298) were verified directly against code ground truth rather than sent through a fresh round-2 review. Defensible speed/rigor trades for mechanical, exactly-specified fixes — and each was **stated openly** to the captain/founder as a judgment call rather than passed silently. The rule is not "never skip" but "**never skip silently**": a skipped round is a decision that gets named.

## 4. Adoptable rules (summary)

1. **Merge-readiness is a checklist, never one field.** On the exact head: draft lifted, CI attached AND green, review verdict **on the PR**, fresh vs main. `MERGEABLE/CLEAN` is a precondition, not a verdict.
2. **Post review verdicts on the PR at decision time.** A verdict the next actor can't find on the PR does not exist.
3. **Prefer non-stacked slices.** If stacked is unavoidable: independent review of every reconciled head + diff-scope check + merged-tree preservation check + additive-diff assertion on shared files.
4. **Reconciliation is reviewable work, not plumbing.** Textually-clean ≠ semantically-correct; the clean-looking merge is exactly where the last regression hid.
5. **CI must be attached AND green on the exact merge head.** Zero checks = defective. Don't trust un-draft to start it.
6. **Stacked PRs need explicit sub-issue close-out.** Verify each issue's state at the end; auto-close won't fire through a stacked base.
7. **Durable orchestration state lives in a durable place**, never a scratch worktree.
8. **Single-vendor review is degraded mode** — declare it, get human ack, and widen the roster so it's rarely forced.
9. **Never skip a review round silently** — a skip is a named decision.
10. **Split reversible from irreversible; respect the guardrail.** The blast-radius block was correct — route irreversible ops to a human, don't retry around them.

## 5. Follow-ups

- [ ] **Delete 6 merged remote branches** `polly/259-{docs-sync,phase2-connection-surface,phase3-feel,phase4-compiler,phase5-context-preview,phase6-deadend-gesture}` — polly is policy-blocked from irreversible remote deletion; one-click "Delete branch" on each merged PR, or the merge captain prunes them now that the worktrees are gone.
- [ ] **Relocate the orchestration registry** to a durable location; remove the stray non-git `eido-worktrees/feat-connection-rework` dir.
- [ ] **Widen the review-vendor roster** (install `opencode`/`cursor`/`hermes`/`pi`) so cross-vendor review survives a single vendor's outage.
- [ ] **Add `ready_for_review` to the CI workflow triggers** so un-drafting reliably attaches checks (§3.4).
- [ ] **Product follow-ups (non-blocking):** marking *unconnected* cards as explored (Phase-6 scope-narrowing); zoom-compensation for the gesture header button; group-mode copy alternatives (#287 description). Spin out as fresh issues if wanted.
