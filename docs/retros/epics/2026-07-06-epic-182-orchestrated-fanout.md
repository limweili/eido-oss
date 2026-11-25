# Retro — Epic #182: 12 sub-issues shipped via orchestrated multi-agent fanout

**Date:** 2026-07-06 · **Scope:** issues #183–#194, PRs #195–#232, one day wall-clock
**Cast:** 1 human maintainer · 1 orchestrator (polly) · implementer/reviewer sub-agents
(Claude fable-5 / sonnet, Codex gpt-5.5-high) · 1 merge operator (codex + `no-mistakes` skill)

---

## 1. What we shipped

Epic #182 decomposed the intent-log / commit-funnel / canvas-LOD rework into 12
independently-reviewable slices. All 12 merged, each with its own PR, each
cross-reviewed by a **different vendor** than its implementer.

| Order driver | Slices |
| --- | --- |
| Foundations (parallel wave 1) | #183 hash-unify, #184 diff-unify, #185 domain-gate ADR, #186 shallow-dedup |
| Pinning before blast radius | #187 intent-char-test (characterization snapshots) |
| Core rework (serial, stacked) | #188 commit-events funnel → #189 run-spine → #190 callsite-migrate |
| Parallel lanes (wave 2) | #191 run-lifecycle, #193 card-chrome |
| Tail | #192 board-ctor → #194 lod-policies (perf-gated, last) |

Final merge: dedicated merge-operator sub-agent following `.agents/skills/no-mistakes`
— strict stack order, full local gates per PR (no CI on branches → local proof was
the gate), char-test byte-identity checked at every merge.

## 2. The process, as actually run

1. **Decompose + lane-map first.** The epic was pre-sliced into issues with explicit
   `Blocked by` edges and lane labels. The orchestrator turned that into waves:
   everything parallel-safe dispatched together; stacked work waited.
2. **One worktree + one sub-agent per task** (`.worktrees/<task>`, branch
   `polly/<task>`), tracked in `.polly/registry.json`. Worker drives to green,
   opens its own PR. Orchestrator never writes code.
3. **Model routing by difficulty** (maintainer-pinned): fable-5 for high-blast-radius
   multi-file work (#184, #185, #188, #189, #191, #194); codex gpt-5.5-high for
   narrow well-scoped slices (#183, #186, #190) and most reviews of Claude PRs;
   sonnet for cheaper bounded tasks (#187, #192, #193).
4. **Cross-vendor review, always.** Reviewer gets diff + acceptance contract only —
   never the implementer's worktree. Blockers → fix-task back to the implementer →
   re-review. Median ~1 fix round; nothing needed 3.
5. **Contract-first pinning before the risky middle.** #187 recorded byte-level
   characterization snapshots of the intent log **against the old code** before
   #188/#189/#190 rewired the write path. Every later PR had to keep those bytes
   identical (or justify an additive-only change in the PR body).
6. **ADR as a gate, not documentation-after.** #185's ADR 0016 was written, reviewed,
   and *amended* (4 review rounds, ended as a 4-shape commit model) before/while the
   funnel landed; its gate outcome was posted to #188/#189 so implementers built
   against a settled contract.
7. **Human pulled in only at real decision points:** ADR sign-offs, the
   undo-compensating-events deferral, two authorized snapshot regenerations, the
   perf-gate waiver. Everything else ran autonomously.
8. **Merge as its own reviewed task.** Merging 12 stacked PRs was delegated to a
   merge operator with an explicit skill, not done ad-hoc — it correctly hard-stopped
   on the one red gate (#232 perf) instead of pushing through.

## 3. What went well (keep doing)

- **Slice quality was the single biggest win.** Small, contract-carrying issues with
  explicit dependency edges meant every dispatch was self-contained; no worker ever
  needed mid-task clarification from the human.
- **Characterization test before the rewrite (#187 → #188).** The snapshot pinned the
  system's observable behavior byte-for-byte; two separate attempts by later PRs to
  "normalize away" drift (#189 stamp-stripping, #190 normalizer masking) were caught
  by reviewers precisely because the pinning contract was explicit.
- **Cross-vendor review caught real defects, not style:** undo/redo bypassing the
  funnel (#188), commit-split blindness (#189), snapshot masking (#190), two
  undeclared behavior changes (#192), an ADR self-contradiction (#185). Same-vendor
  review would likely have shared the implementer's blind spots.
- **Targeted review briefs.** Telling the reviewer *what to be suspicious of*
  ("reconcile the snapshot-unchanged claim", "block if aliasing loses commit-grouping
  sensitivity") consistently produced the highest-value findings.
- **Controls-based perf diagnosis.** When #232's gate went red post-rebase, running
  the same gate on plain `main` **and** the pre-epic fork point (both failed
  identically at ~29fps) exonerated the code in one round — root cause was host
  EDR/MDM load (Kandji ~50% + Huntress ~24% + auditd on a 4-P-core M4).
- **Merge operator with hard-stop authority.** It refused to merge #232 on a red
  gate even though 11 PRs had sailed through — exactly the behavior you want.

## 4. What went wrong (root causes + fixes)

| Incident | Root cause | Fix (done) / rule (adopt) |
| --- | --- | --- |
| Codex workers hung at boot repeatedly | Desktop `~/.codex/config.toml` MCP servers (node_repl 120s cold-start; relevance-ai/jam failing auth) blew the thread-start timeout | Diagnose boot vs task failure FIRST; warm the CLI once before fan-out; consider a headless config profile for agent runs |
| #232 perf gate red after rebase → 1 wasted diagnose/fix loop | Perf gates on a dev machine are environment-sensitive; baseline runs happened on a quiet box, re-runs on a loaded one | Perf harness should record host load alongside fps; run gates in a quiet window; controls (main + fork point) are mandatory before blaming a PR |
| Post-epic cleanup **force-removed two worktrees belonging to another session** | Cleanup list derived from `git worktree list` + branch grep — repo-wide enumeration spans every session's worktrees; `--force` deleted without protest | Registry-scoped cleanup only: exact pre-recorded paths/branches, one at a time; never sweep enumeration output into destructive commands; never `--force` (refusal = live work). Codified in fanout skill + no-mistakes (PR #241) |
| #191 diff contained overlapping hunks from another lane | Worker strayed outside its file scope | Scope check on the diff before review dispatch; caught here, but should be automatic |
| Truncated/empty inbox results from two workers | Worker sessions ended their turn on a progress line | Fall back to `sys_session_get_history` before re-dispatching; require a structured final report in the dispatch brief |
| One worker session crashed on resume | Corrupted CLI session state | Don't resuscitate: close the session, fresh dispatch in a clean worktree — cheaper than debugging harness state |
| Two snapshot regenerations authorized by orchestrator, not maintainer (#189, #202/#220) | Judgment call under time pressure; flagged in-PR both times | Acceptable pattern ONLY with: additive-only change, rationale in the PR body, explicit callout to the human at report time. If any of the three is missing, escalate first |

## 5. "Get it right the first time" — playbook for the next epic

**Before dispatching anything:**
1. Slice to disjoint file scopes with explicit `Blocked by` edges; every issue carries
   its own acceptance contract and verification recipe. (This epic's slicing quality
   is the template.)
2. Identify the contract that pins current behavior; land the characterization test
   as its **own early slice**, before any high-blast-radius rework.
3. Land the ADR/design slice first and treat it as a gate for dependent slices.
4. Warm up each worker CLI once; treat any boot failure as roster-unavailability, not
   a task failure to retry.
5. For perf-gated slices: capture baseline **and host-load snapshot** together;
   pre-agree that red gates get control runs (main + fork point) before any fix work.

**During the run:**
6. Dispatch whole parallel-safe waves at once; never serially babysit.
7. Every dispatch brief includes: worktree path + hard scope boundary, acceptance
   contract, "declare every semantic change in the PR body" (the #1 source of review
   blockers was undeclared behavior changes), structured final-report format, and the
   co-sign trailer.
8. Every review brief includes: the diff, the contract, and 1–3 named suspicions.
9. Diff-scope check before sending to review; snapshot changes require in-PR rationale.
10. Escalate to the human ONLY on: contract ambiguity, snapshot-meaning changes,
    threshold changes, and anything the reviewer and implementer disagree on twice.

**Merging and closing:**
11. Plan merge order at PR-open time (stacks explicit in the scoreboard), merge via a
    dedicated operator with hard-stop authority, close each sub-issue with evidence.
12. Cleanup is registry-scoped, per-target, never forced. The repo is shared:
    enumeration output is read-only.

## 6. Numbers

- 12/12 slices merged; 24+ review rounds; ~8 slices approved by r2, worst case r4 (#185 ADR)
- 0 post-merge regressions: main green (514 tests / typecheck / build) after final merge
- 1 waived gate (perf, #232) — waived on control-run evidence + maintainer sign-off, rationale recorded in-PR
- 2 incidents with data-loss potential (worktree sweep; snapshot masking) — 1 self-inflicted by the orchestrator, 1 caught by cross-review
