# Retro — Epic #203: 11 sub-issues shipped via orchestrated multi-agent fanout

**Date:** 2026-07-07 · **Scope:** issues #204–#214, PRs #224–#273, ~one day wall-clock
**Cast:** 1 human maintainer (non-technical coordinator) · 1 orchestrator (polly) ·
implementer/reviewer sub-agents (Claude Code on fable-5 per maintainer mandate;
Codex gpt-5.5 for cross-review until it became unbootable mid-run)
**Companion retro:** [2026-07-06 Epic #182](2026-07-06-epic-182-orchestrated-fanout.md) —
this run inherited its playbook and stress-tested it on a gnarlier surface.

---

## 1. What we shipped

Epic #203 (canvas interaction/performance rework) decomposed into 11 slices across
lanes A–H. All 11 merged — each in its own PR, each adversarially reviewed
before merge, zero post-merge regressions on main.

| Wave | Issues | PRs | Review rounds |
| --- | --- | --- | --- |
| 1 (parallel ×4) | #204 LOD drag freeze, #205 wheel gate, #206 highlight confine, #207 note fidelity | #229, #226, #224, #225 | 2, 1, 2, 2 |
| 2 (after #204 landed) | #208 marquee partial, #209 low-zoom connect | #233, #234 | 1(+1 lost), 1 |
| 3 (after #208) | #210 drag-anywhere, #211 edge clickability | #245, #246 | 1, 2 |
| 4 (after #211) | #212 marquee multi-connection | #270 | 2 |
| 5 (perf lane, deliberately last) | #213 per-frame drag commits → #214 overview rAF | #272, #273 | 1, 1 |

Also produced: 7 follow-up issues filed from the review ledger (#275–#281),
2 corrections posted to issues whose recorded diagnoses turned out stale/wrong
(#212, #213), and 1 pre-existing main bug identified (unmeasured-handle marquee
race, filed as #280).

## 2. What went well (keep doing)

- **Adversarial review caught 5 real, user-facing defects pre-merge** — not style
  nits: drag-outside-window never running `endDrag` (#206), a `force:true` re-measure
  path reintroducing the #117/#118 jitter *with a test codifying the wrong behavior*
  (#207), two tests too weak to catch regressions (#204), clicks selecting invisible
  edges beyond the paint cap (#211), and marquee selecting connectors it never touched
  because React Flow auto-selects edges with only ONE endpoint in the box (#212).
- **Review by disproof, not vibes.** The #212 reviewer went into the installed React
  Flow dist and *disproved the issue's own recorded diagnosis* at source level. The
  #214 reviewer verified the tested scheduler was the wired scheduler (no test
  theater). This depth is what made same-vendor review survivable when Codex died.
- **Verify-the-diagnosis-first discipline.** Contracts told implementers to re-check
  the issue's recorded diagnosis against current code before building. It paid twice:
  #212's "both endpoints" claim was wrong, #213's line numbers were stale post-#143.
  Corrections were posted back to the issues so later slices couldn't be misled.
- **Orchestrator re-ran gates independently, every time.** Worker claims were never
  trusted: typecheck/unit/browser gates re-run locally before every review dispatch
  and every merge. This caught nothing catastrophic *because* it existed — and it
  exonerated two "failures" as environmental (perf flakes under load 45+).
- **Red-before-green test standard.** Reviewers demanded (and implementers delivered)
  new tests proven RED against pre-fix code. This became self-reinforcing culture by
  wave 3 — the #211 fixer volunteered it unprompted.
- **Same-vendor fallback, adversarially framed.** When Codex became unbootable, a
  fresh claude_code session with zero implementer context and an explicit
  "assume the implementer made mistakes and hunt for them" mandate caught the two
  best bugs of the run (#211, #212). Independence comes from context isolation +
  mandate, not only from vendor diversity — though vendor diversity is still first
  choice.
- **Perf lane last, baseline-first.** #213 captured its 500Hz-drag baseline from the
  named pre-change commit *before* touching anything, and #214 ran in cleanup mode
  holding #213's gate numbers. Commits 394→~80, long frames 34→1-10, mid-drag fps
  42→55-59, verified un-gameable (commit counter bumps regardless of persist).
- **Follow-up ledger.** Every non-blocking review finding was logged during the run
  and filed as 7 concrete issues at close-out instead of evaporating.

## 3. What went wrong (root causes + fixes)

| Incident | Root cause | Rule to adopt |
| --- | --- | --- |
| **Wave-1 merge conflict storm**: after merging #229, all 3 remaining wave-1 PRs conflicted; rebase loops needed multiple rounds as each merge invalidated the next PR | All 4 PRs opened against the same base, batch-merged at the end; #204's deep `Board.tsx`/`boardScene.ts` change collided with everyone | **Merge-as-you-go**: merge each PR the moment it passes review + CI, *before* the next same-surface PR opens. Waves 2–5 did this and had exactly one conflict total |
| **`/no-mistakes` reported "not installed" — twice** | The skill exists at `.agents/skills/no-mistakes/` (repo-level, Codex-harness). Epic #182 ran merges via a dedicated merge-operator sub-agent loaded with it; this run the orchestrator couldn't see it in its own registry and merged manually | On any "/skill" the orchestrator doesn't recognize: `ls .agents/skills/` and `~/.claude/skills` FIRST. Merge phases go to a **dedicated merge-operator sub-agent** carrying no-mistakes, as in #182 — not ad-hoc orchestrator merging |
| **#224 CI red on lockfile desync** | Worker regenerated `package-lock.json` with npm 11; CI runs npm 10 | Toolchain pins (`npx npm@10`) belong in the **first** wave's contracts, not learned at merge time. Now a standing contract line |
| **Codex unbootable ×4 (app-server startup timeout)** | First failures under load 45–58 (plausibly capacity); failure #4 at load ~5 killed that theory — the 13-days-uptime host needed a reboot / Codex reinstall. Cross-vendor review lost for half the run | Boot-vs-task triage saved wasted retries, but: **warm each CLI at preflight AND re-warm before each review wave**. A vendor that fails boot twice at low load = down for the run; escalate the fallback decision immediately (we did — cost was one 15-min timer we cancelled) |
| **Runner deaths killed 3 sessions** (208 implementer, 208 review dispatch, 211 implementer) | Host saturation + long-lived runner processes | Fresh dispatch on the intact worktree worked every time. Rule: never resuscitate; re-dispatch |
| **Waited on a ghost review** — the 208 review dispatch was lost with its runner and no session ever existed; orchestrator waited until the *human* noticed | Dispatch handle wasn't verified against a live session after the runner-failure window | After any runner failure, **audit all in-flight dispatches** (`sys_session_list`) — don't assume survivors. A dispatch is only real once its session is listed |
| **Inbox dropped the #211 completion** | Notification lost; orchestrator idle until human prodded "can you continue?" | On any prod/wake with an empty inbox: check session history of ALL outstanding workers before declaring "still waiting" |
| **Host saturation (load 45–58)** | 2+ fable-5 workers each running vite + Playwright concurrently, 13 days uptime | Cap concurrent browser-gate-running workers at ~2 on this machine; reboot the host before an epic run |
| **Claude session limit hit mid-review at the very end** | Long single-day run on fable-5 everywhere | Near a known reset window, don't start a review you can't finish; the re-dispatched reviewer passed cleanly next morning |

## 4. What we'd do differently

1. **Continuous merge train instead of batch-merge.** The single biggest waste was
   the wave-1 storm: ~5 extra fix-dispatches and 3 human check-ins that pure merge
   ordering would have avoided. Merge each green PR immediately; hold same-surface
   dispatches until it lands.
2. **Delegate the merge phase** to a merge-operator sub-agent running
   `.agents/skills/no-mistakes` (the #182 pattern). The orchestrator plans order and
   verifies; the operator executes with hard-stop authority.
3. **Preflight the host, not just the roster**: check uptime/load, warm every CLI,
   verify CI's toolchain versions, confirm session-limit headroom — all before wave 1.
4. **Three+ vendors installed.** With only claude_code + codex, one vendor dying
   forced a same-vendor waiver. Any of opencode / cursor-agent / hermes / pi on PATH
   restores true cross-vendor review instantly.
5. **Verify dispatches after any infrastructure hiccup** (the ghost-review rule above).

## 5. The merge protocol — for "merge these epic PRs, no mistakes"

This is the exact procedure for future epics, designed so the maintainer never needs
to follow the technical details. **Human's only job: say the mandate sentence at the
start, and answer explicit escalations.**

**Mandate sentence (say at epic kickoff or merge time):**
> "Standing mandate: merge every epic PR on green — review PASS + CI green + gates
> re-verified. Same-vendor review pre-authorized if a vendor is down. Only escalate
> waivers, red gates, or contract ambiguity."

With that said once, the merge phase runs autonomously:

1. **Freeze** new same-surface dispatches; snapshot the merge queue ordered by
   dependency edges, then blast radius (deepest/most-shared files first).
2. **Per PR, in order:**
   a. Review verdict must be PASS **on the current head** (a post-review conflict
      resolution that is more than trivial ⇒ sanity re-review of the delta).
   b. Sync with main: if CONFLICTING, dispatch a fix-worker to the existing worktree
      (merge main in — never force-push); re-run gates after.
   c. Verify locally: typecheck + unit + (if UI-touching) browser gate.
   d. Verify remotely: CI SUCCESS, `MERGEABLE`/`CLEAN`.
   e. Squash-merge. Never merge red CI, never merge un-reviewed resolution diffs.
   f. **Immediately** re-check the next PR in queue against moved main (it may have
      just gone CONFLICTING —catch it now, not at its merge turn).
3. **After the last merge:** run the full gate suite on main; close each sub-issue
   with evidence; file the follow-up ledger as issues; comment + close the epic;
   remove worktrees registry-scoped, one at a time, never `--force`.
4. **Hard-stops (escalate to human, do not push through):** any red gate on main,
   any perf-gate red (run controls on main + fork-point first, per #182), any
   reviewer/implementer disagreement lasting 2 rounds, any snapshot/threshold change.

## 6. Where the human's input helped — and how to make it even better

**What worked (keep doing exactly this):**
- "Use fable-5 for the hard items" at kickoff — a clear standing model policy that
  removed per-dispatch decisions for the whole run.
- "Go with same-vendor review, it's fine" — an explicit, recorded waiver at a real
  decision point. That's the coordinator job done right.
- Two nudges that un-stuck the run: "I don't think that Codex review is still
  running" (caught the ghost session) and "can you try to continue?" (caught the
  dropped inbox item). Human-as-watchdog was genuinely load-bearing twice.

**What to add next time (all non-technical):**
1. **Say the mandate sentence at kickoff** (§5). The end-of-epic merge crunch you
   felt happened because merges waited on your per-PR go-ahead; the mandate makes
   green-PR merging autonomous and moves you to exception-handling only.
2. **Host steward role:** before an epic, restart the machine (13 days of uptime
   contributed to runner deaths and boot timeouts) and ask "any CLIs missing?" —
   installing one more vendor CLI is the single highest-leverage thing you can do
   for review quality.
3. **Watchdog cadence:** if no status update for ~30 minutes, ask "status?" — cheap,
   and it caught both silent failures this run.
4. **Session-limit awareness:** if a limit-reset time is known, mention it at kickoff
   so heavy review work isn't started right before the wall.
5. **You never need to read diffs or follow file-level detail.** The system's job is
   to give you a scoreboard (issue → PR → review verdict → merged?) and binary
   questions. If you're ever asked something requiring technical judgment, that's a
   process bug — say so.

## 7. Numbers

- 11/11 slices merged; 11 PRs; ~16 review rounds; worst case r2 (nothing needed 3)
- 5 blocking defects caught pre-merge by review; 0 post-merge regressions
  (main green at close: 558 unit / typecheck / browser 37/37)
- 2 issue diagnoses corrected upstream during the run
- 7 follow-up issues filed (#275–#281); 1 pre-existing main bug discovered and filed
- 4 vendor boot failures, 3 runner deaths, 1 dropped inbox notification, 1 session
  limit hit — all recovered without losing work; ~3 of them cost wall-clock that the
  §3 rules would have saved
- Same-vendor adversarial review caught 2 of the 5 defects — the two subtlest
