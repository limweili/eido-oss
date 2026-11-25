# Epic #448 Friends Alpha — running retro (orchestrator log)

Short friction log kept during the run; distilled at closeout. One line per item.

- 2026-07-22 kickoff: #528 body (r8) still mandated signed certification and named closed
  #469/#470 as blockers after spec r3 went unsigned-first — spec amendments to cross-epic
  tickets did not propagate at r3 time. Cost: one extra reconciliation lane at kickoff.
- 2026-07-22 kickoff: #528 "Blocks: #471" pointed at a closed ticket; live J2 consumer is
  #684. Same propagation gap.
- 2026-07-22: a wrapper agent's isolated worktree was garbage-collected while the wrapper
  idled waiting on a child recon agent (harness treats a stopped agent's unchanged worktree
  as collectable). Lesson: wrappers should touch/branch their worktree *before* spawning
  children, or carry recon in-prompt instead of sub-spawning.
- 2026-07-22 overnight: ALL wrapper agents waiting on long background codex runs stalled —
  codex finished (commits on 5 lane branches) but background-Bash completion never re-invoked
  the stopped wrappers, so nothing was pushed or PR'd for ~9h until the founder noticed.
  Biggest friction of the run so far. Lesson: don't let wrappers idle on background-Bash
  notifications for codex runs; have them poll synchronously (sleep-loop within Bash timeout,
  repeated), OR the orchestrator must maintain its own liveness sweep (cron/loop) instead of
  trusting wake-on-completion. Silver lining: work survived on branches; recovery was cheap.
- 2026-07-22: stall root cause found (J1 wrapper self-report): running codex via
  `nohup … & disown` inside a backgrounded Bash call makes the Bash exit immediately —
  the harness fires "task complete" for the wrapper script, not codex, and the wrapper
  sleeps forever. Fix for future wrappers: run codex as a plain foreground command inside
  a `run_in_background` Bash call (no nohup/disown), or poll a PID/report file in a loop.
- 2026-07-22: orchestrator sent a "your worktree was GC'd" recovery premise to the C1
  wrapper based on a directory listing taken while the agent was suspended; the wrapper
  found its worktree intact on resume, verified before acting, and declined the risky
  recovery steps against the canonical checkout. Two lessons: (a) suspended agents'
  worktrees can be absent-then-restored — a point-in-time `ls` is not ground truth;
  (b) workers verifying orchestrator claims before acting is exactly right — keep
  phrasing recovery instructions as conditionals ("if X is missing, then…"), not facts.
- 2026-07-22: concurrent non-epic sessions merged a docs reorganization (PR #701) that
  moved files the #669 docs-repair branch edits — cross-session collision on main. Lesson:
  check for concurrent sessions touching the same surfaces at dispatch, or accept rebase cost.
- 2026-07-22: wrapper-stall recurred even with the corrected codex invocation (plain
  foreground command inside run_in_background Bash) — three wrappers idled after codex
  exited; the orchestrator /loop liveness sweep caught and resumed them within one
  heartbeat (~25 min). Conclusion: wake-on-background-completion for stopped wrappers is
  unreliable in this harness version; the liveness sweep is the real safety net, not a
  backup. Cost per incident dropped from ~9h (overnight) to <25 min.
- 2026-07-22: first real hosted certification run (29892395401) failed on both platforms
  with harness-only bugs — a TDZ crash reachable only at runtime and an installed-runtime
  allowlist missing stock Electron files (dxcompiler.dll). Lesson: an allowlist built from
  reading docs/specs needs one real-run calibration pass per platform before it gates;
  budget for one red first run of any new gate against real artifacts.
- 2026-07-22: the certification gate took SIX red runs to calibrate, every failure
  harness-side, each run exactly one journey deeper (allowlist → close seam → CDP
  readiness race → MCP revision binding → uninstall timing). Zero product defects — the
  app's fail-closed behaviors are what exposed each harness bug. Lessons: (a) "one red
  calibration run" was optimistic by 5× for a gate that drives a real GUI through real
  user seams; (b) the round-3 investment in stage breadcrumbs + bounded waits + output
  tails paid for itself immediately — every later round was diagnosed from logs in
  minutes; (c) routing rounds 2-6 to the best tier with a persistent lane (same agent
  kept context across rounds) beat re-dispatching cold each time.
- 2026-07-22: every electron/** PR trips the certification fingerprint drift test and
  needs a CERTIFICATION_PROOF_REVALIDATIONS ledger append (C1, B2, #708 — three times
  this run). Working as designed, but the re-baseline is manual each time; if the
  cadence of electron changes rises post-alpha, consider tooling the append.
- 2026-07-22: GitHub silently stopped delivering pull_request events for one branch
  (alpha/708-keychain-degrade) — pushes, close/reopen, and empty commits all created
  zero workflow runs while other branches worked fine. Root cause never found.
  Workaround that held: `gh workflow run ci.yml --ref <branch>` (workflow_dispatch)
  reports checks on the head SHA and satisfies required gates. Keep workflow_dispatch
  triggers on required workflows — it turned a hard blocker into a ten-minute detour.
- 2026-07-22: merge-captain wrappers reliably complete the merge but stall before
  post-merge side tasks (workflow dispatch); orchestrator now does post-merge
  dispatches itself. Smallest-safe-direct-action beats a second delegation hop.
- 2026-07-22 scope cut: the delivery system had grown to roughly 15,000 lines
  around a small packaging core. Preserve the landed foundations, move mature
  automation to backlog epic #740, and reduce #448 to exact-byte publication
  (#742), one real canary per platform, then sharing with friends.
- 2026-07-22 scope cut: six certification calibration reds found zero product
  defects and only harness faults. That evidence yield trips ADR 0028's
  stop-and-reslice rule; reuse the green packaged proof instead of extending it.
- 2026-07-22 scope cut: tracker and operational state had drifted — #528 was
  closed and green while planning and research surfaces still described it as
  open or unresolved. Live tracker edges and #448 r4 outrank dormant machinery.
- 2026-07-22 scope cut: standing updater/artifact maintenance would flag the
  lean manual-download Alpha as unplanned. Keep the weekly dependency audit,
  but make mature release maintenance manual-only until #740 is re-triaged.

## 2026-07-23 alpha.7 human-canary incident

- The macOS human canary exposed two consecutive Eido Safe Storage Keychain sheets
  and a new-Board failure. The independent root causes were two Eido Keychain
  consumers (the credential store and cookie-encryption fuse) and separately issued
  Board `createdAt` timestamps at the renderer/native authorization boundary.
- Board and credential repairs ran as separate parallel lanes. The first credential
  native proof went red on both hosts because stale proof vocabulary ran after a
  healthy app stamp; higher-risk review then caught real orphan-temp cleanup and
  renderer-storage failure-containment gaps. The revalidation ledger stayed behind
  native green, and `ci:budget UNKNOWN` was disposed as non-product telemetry under
  ADR 0028 instead of growing another gate.
- Keep one real human canary per supported platform. When the storage model changes,
  update evidence vocabulary in the same slice. Optional credential faults must
  degrade AI setup, never block Profile startup.

## 2026-07-23 0.1.1 release run

- First plain-version release under the #788 naming policy; the founder named
  `0.1.1` explicitly. Certified at `6ba5173`, set `eido-cert-v1-29954394648-1`,
  published immutably to limweili/eido-releases with re-downloaded
  digest-verified assets.
- The first certification dispatch failed closed on both platforms for the same
  root cause class: reviewed changes had landed without moving the certification
  authority. #789's custom icon replaced `electron.icns` with `icon.icns` in the
  installed inventory, and #809's single-class Mods advanced the Profile record
  envelope to v2 while the harness still pinned v1. One reconciliation PR
  (#811) repaired both pins; the re-dispatch went green first try.
- Lesson: a PR that changes packaged installed content or bumps any pinned
  Profile/Gateway contract version should move the packaged-certification
  authority (`scripts/certification/`) in the same train. The fail-closed
  design converts the omission into a dead release dispatch, which is safe but
  costs a full native certification cycle.
