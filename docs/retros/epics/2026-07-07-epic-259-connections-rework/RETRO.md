# Retro — Epic #259: Connections Rework (idea → PRD → Phase 1 merged), 2026-07-07

Predecessors: [epic #203 retro](../2026-07-07-epic-203-canvas-interaction.md), [epic #182 retro](../2026-07-06-epic-182-orchestrated-fanout.md). This retro covers a different shape of work than those two: not just "implement N issues", but the **full lifecycle** — a fuzzy product feeling ("connections feel underbaked") turned into a stance, ADRs, a PRD, six phased issues, and a merged Phase 1, in roughly one day, with the founder giving only taste-level input.

A companion skill draft distilled from this run lives next to this file:
[`skill-draft-complex-epic-lifecycle.md`](skill-draft-complex-epic-lifecycle.md).

---

## 1. What happened (timeline)

| Step | What | Artifact |
| --- | --- | --- |
| 1 | Founder: "connections feel under-polished; act as my PM; are negative connections needed?" | — |
| 2 | Three parallel evidence scans (canvas UX, context engine, documented intent), each returning file:line facts | agent reports |
| 3 | PM review: stance ("the data model is ahead of the product"), 5 prioritized opportunities, negative-connections position | chat |
| 4 | Founder: "full rework, be ambitious, max 3–5 questions, grill-with-docs, write ADRs as you go" | — |
| 5 | Grilling: 4 questions used (negative semantics, edit surface, strength, motion feel); everything else resolved against docs/code | — |
| 6 | Decisions recorded: 2 ADRs + 3 glossary entries | ADR 0017, ADR 0018 (see §3.1), CONTEXT.md |
| 7 | PRD published with 25 user stories, locked decisions, testing decisions, explicit out-of-scope | [#259](https://github.com/limweili/eido/issues/259) |
| 8 | Six phase issues with native sub-issue + blocked-by links, runnable acceptance criteria | [#260](https://github.com/limweili/eido/issues/260)–[#265](https://github.com/limweili/eido/issues/265) |
| 9 | Phase 1 implemented (characterization tests first, then contracts, auto-orient, reason field, dead-code deletion, docs-sync) | PR [#282](https://github.com/limweili/eido/pull/282), 9 commits |
| 10 | Cross-review found **2 blocking defects** pre-merge; both fixed and re-verified | PR #282 comment thread |
| 11 | One CI failure (lockfile gotcha, §3.2), fixed by restoring `package-lock.json` from main | CI history |
| 12 | Squash-merged to main with green CI; #260 closed | main `84bc8a6` |

State at retro time: #260 CLOSED, #261–#265 OPEN. After #260, the dependency graph allows **#261 (UI lane) and #263 (compiler lane) in parallel**; critical path is #261 → #262; #264 follows #263; #265 needs #260+#261.

## 2. What went well

1. **Evidence before opinion.** The PM review was grounded in three parallel scans that returned file:line facts (e.g. the midpoint badge is `pointer-events: none`; only *incoming* connections feed context; `deepThoughtPolicy` has no production caller). Every product claim traced to code. This is why the founder could approve the direction in one reply.
2. **The question budget worked.** Founder asked for max 3–5 questions; 4 were spent, each a genuine taste decision (negative semantics, edit surface, strength, motion). Everything answerable from docs/code was answered from docs/code. The founder's two *free-text* answers (strength = solid/dotted reporting lines; motion = "one satisfying beat, still after settle") were the highest-leverage inputs of the day and shaped the PRD's language directly.
3. **Decisions became durable artifacts immediately.** ADRs and glossary entries were written during the grilling, not after — so the PRD and all six issues could cite them instead of restating them.
4. **Characterization tests before high-blast-radius change, actually enforced.** The issue mandated pinning current `gatherContext` behavior before refactoring; the PR's first commit is exactly that. The refactor then had a safety net by construction.
5. **Adversarial cross-review earned its cost.** It caught two real blocking defects before merge: the conversation compiler still branching on card kind instead of reading the new contract registry, and missing undo/redo coverage for the new store actions. Both are exactly the class of "plausible but incomplete refactor" bugs that unit-green diffs hide.
6. **Issue contracts were complete enough for zero mid-flight founder input.** Phase 1 went from "go" to merged without a single question back — acceptance criteria were runnable commands, the known gotchas were written into the issue, and blast radius + safety net were declared up front.
7. **Native tracker wiring paid off.** Sub-issue + blocked-by links (not just prose) made the parallelizable lanes machine-readable for the next dispatch.

## 3. What went wrong, root causes, and the fixes adopted

### 3.1 ADR numbering collision + planning-doc drift (the day's biggest process failure)

**What happened.** The grilling session wrote `ADR 0016 (negative connections)` and `ADR 0017 (context contracts)` plus CONTEXT.md glossary entries — but only in the planning worktree's working tree, **uncommitted**. Meanwhile a *different* epic merged its own ADR 0016 to main the same day. The Phase 1 implementer re-created the docs on its branch, correctly renumbering negative-connections to **ADR 0018**. Result: the PRD and two issues cited a wrong ADR number, and the planning worktree held stale duplicate docs whose CONTEXT.md edit would have **deleted the "Follow-up" glossary entry** another epic had since added to main, had it ever been committed.

**Root causes.** (a) Decision docs were parked in a working tree instead of being committed at decision time. (b) Two epics ran the same day sharing one docs surface (CONTEXT.md, the ADR number sequence) with no reservation step.

**Fixes adopted — now rules:**
- **Docs-only decision records commit directly to main the moment they are written** (this was already the stated convention in `docs/retros/README.md`; it exists precisely to prevent this). Committing is what reserves the ADR number.
- **Check main for the next free ADR number at write time**, not the local checkout — planning worktrees are stale by definition.
- **Cleanup done in this retro:** stale local ADR drafts deleted, planning worktree CONTEXT.md reverted, and issue bodies #259/#263/#265 corrected (`ADR 0016` → `ADR 0018`). Canonical decisions: **ADR 0017 = context contracts, ADR 0018 = Avoid/anti-context.**

### 3.2 A known gotcha recurred: memory is not enforcement

The worktree npm-lockfile problem (local npm 11 rewrites `package-lock.json` and drops `@emnapi` entries that CI's npm 10 needs) was already known and recorded — and it still cost one red CI run on PR #282 before being fixed by restoring the lockfile from main.

**Rule adopted:** a recorded gotcha only counts as handled when it is (a) written into every dispatch contract that can trigger it, and (b) ideally guarded mechanically. **Recommended follow-up (file as a small issue):** add a `packageManager`/engines pin or a CI/preflight check that fails fast when lockfile entries are dropped, so this stops depending on anyone's memory.

### 3.3 Merge mechanics on main were uneven today (across all epics, not just this one)

Two observations from today's main history that the merge runbook (§5) now addresses:

- **Mixed merge styles.** Most PRs were squash-merged (the repo convention), but a stacked chain (#243 → #250 → #266) landed as merge commits with extra "sync stack" merges. Stacks force this choice — squashing a stacked parent breaks its children. **Rule: avoid stacked PRs; if a stack is unavoidable, merge bottom-up, one at a time, and accept merge commits for that stack only, deliberately.**
- **Cancelled CI runs on main.** When several merges land in quick succession, CI's concurrency setting cancels the older main runs — two of today's main pushes never got a completed CI verdict of their own. With branch protection off, a bad interaction between two individually-green PRs could slip through unnoticed. **Rule: merge one PR at a time and wait for main's CI to complete (or re-run it if cancelled) before merging the next.**

### 3.4 A precision failure in reporting

The PRD stated the ADRs were "in the repo" when they existed only in an uncommitted working tree. That inflated claim is what let the numbering collision hide. **Rule: claims about artifacts must name the surface — "committed to main", "on branch X", "working tree only". "In the repo" is banned as ambiguous.**

## 4. Where the founder's input mattered — and where better input would have helped

**What was exactly right (keep doing this):**
- Taste-level answers in free text instead of just picking a menu option. "Solid line to your manager, dotted to collaborators" and "one satisfying beat, still after settle" did more to shape the product than any amount of option-picking — they became the PRD's actual language.
- Setting an explicit question budget ("resolve it yourself, 3–5 questions max"). This forced the agent to do its own research and reserved the founder for genuine taste decisions.
- Delegating stance-taking ("take this way further than I can, be ambitious") while retaining veto via the grilling questions.

**Where better input would have helped (small, cheap asks for next time):**
1. **Declare concurrent epics at kickoff.** "There's another epic running today that also touches docs" would have flagged the shared CONTEXT.md/ADR surface before the collision instead of after. One sentence.
2. **State standing mandates once, up front:** merge policy ("merge on green without asking" vs "ask me per PR"), review policy, and interrupt budget. Today's "yes" reply was scope-ambiguous — Phase 1 only, or all six phases? The agent guessed Phase 1 (correctly, but a guess). A kickoff line like "run phases as they unblock; merge on green; interrupt me only for taste" removes every such guess.
3. **Say what "done" means to you per phase.** For UI phases especially: is merged-with-green-CI done, or do you want a 60-second demo in the running app before the next phase starts? (Recommended: demo after #262 and #265, the two feel-heavy phases.)

None of these require technical knowledge — they are coordination declarations, and they are exactly the input a non-technical CTO is best positioned to give.

## 5. The merge runbook — "go merge the epic-X PRs" with zero mistakes

This is the exact procedure for future merge requests. The founder's only job is to say the trigger sentence and answer taste questions; every step below is the agent's.

**Trigger:** founder says *"merge the PRs for epic #N"* (optionally: "and close the issues").

**Per-PR loop — strictly one PR at a time, in dependency order (blocked-by order, foundation first):**
1. **Freshness:** confirm the PR branch contains current `origin/main` (merge main in if behind). If the update touches `package-lock.json`, restore it from main and add any new deps via `npx npm@10` (§3.2).
2. **Green on the up-to-date branch:** CI must pass *after* the freshness update, not before it. Re-run gates locally if CI is stale.
3. **Review debt:** confirm every blocking review finding has a fix commit and a re-verification. No "will fix in follow-up" for blocking findings.
4. **Squash-merge** with a plain-language title ending in the issue ref. Never merge-commit except the deliberate-stack case (§3.3).
5. **Watch main's CI to completion.** If it was auto-cancelled by a newer push, re-run it. Do not start the next PR until main is verifiably green.
6. **Sync siblings:** merge updated main into the next PR's branch before its turn (expect lockfile friction again).

**After the last PR:**
7. Close each resolved issue with a one-line "how verified" comment; close the parent PRD only when all phases are done (per the existing close-issues-after-merge practice).
8. Delete merged branches; remove worktrees **only from the pre-recorded registry, never by sweeping** (per the no-mistakes worktree rule, PR #241).
9. At the time, if anything touched the legacy JSON save format, run the then-current save-safety preflight against a *copy* before calling it production-ready. "Merged to main with green CI + save compatibility verified" was what "in production" meant for that pre-SQLite local-first build.
10. Post a plain-language completion report: what merged, what's now unblocked, any follow-ups filed.

**Perf-gated PRs (e.g. #262):** pin a same-machine baseline from main immediately before measuring; compare ratio/deficit, not absolute fps class; check for EDR/browser load before blaming code (per the epic #203 retro and perf-gate memory).

## 6. Adoptable rules (summary)

1. Decision docs (ADRs, glossary) commit **directly to main at decision time** — committing is the reservation. Check main, not your worktree, for the next ADR number.
2. A recorded gotcha isn't handled until it's in every relevant dispatch contract — and mechanically guarded where possible.
3. Merge one PR at a time; main CI must *complete* (not get cancelled) between merges.
4. No stacked PRs unless deliberate; if deliberate, bottom-up with eyes open.
5. Claims name their surface: "committed to main" ≠ "in my working tree".
6. Kickoff mandates from the founder: merge policy, review policy, interrupt budget, concurrent-epic declaration, per-phase definition of done.
7. Characterization/golden tests land **before** any high-blast-radius refactor, as the first commit.
8. Cross-review with named suspicions stays mandatory for refactors that claim "behavior unchanged" — it caught both real defects today.

## 7. Follow-ups filed or recommended

- [ ] Mechanical lockfile guard (packageManager pin or CI check) — recommend filing as a small issue.
- [ ] Phases #261 + #263 can now run in parallel; #262 carries the perf gate.
- [ ] Founder demo checkpoints after #262 and #265.
