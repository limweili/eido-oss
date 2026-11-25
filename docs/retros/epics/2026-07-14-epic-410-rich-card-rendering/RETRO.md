# Retro — Epic #410: Rich-card rendering architecture

Canonical specification: [#410](https://github.com/limweili/eido/issues/410).
Product lineage: [Epic #300 zoom bands](../../2026-07-e300-zoom-bands.md).
Delivery lineage: [Epic #247 merge train](../2026-07-07-epic-247-image-compression/RETRO.md).

> **Append-only friction ledger with final synthesis.** The entries preserve
> each hiccup as it occurred rather than rewriting the run to look cleaner.
> The closeout synthesis derives outcomes and adopted rules from that evidence.

Each entry records timestamp/wave, symptom, detection evidence, impact, root
cause, unblock/workaround, durable fix or tracker link, and status.

## Friction ledger

### 2026-07-14 · Kickoff — Tracker graph drift

- **Symptom:** #410 was the declared executable spec, but #402–#409 still had Wayfinder #400 as their native parent; #413 had no parent, and the #402→#413→#406 edges existed only in prose.
- **Detection evidence:** live GitHub dependency/sub-issue queries disagreed with the issue bodies and kickoff mandate.
- **Impact:** machine-derived frontier order could omit #413 or treat #400 as a second backlog.
- **Root cause:** issue bodies were updated without updating native tracker relationships.
- **Unblock/workaround:** reparented #402–#409 and #413 under #410 with replacement semantics and added the missing native blocking edges.
- **Durable fix/tracker:** registry ledger records the repaired graph; every wave re-derives native and prose edges before dispatch.
- **Status:** resolved.

### 2026-07-14 · Kickoff — Dirty canonical checkout had to be preserved

- **Symptom:** `/Users/weili/Documents/Projects/eido` was behind main and contained untracked `research/prototype/` material.
- **Detection evidence:** `git status --short` returned `?? research/prototype/`; HEAD did not match verified main.
- **Impact:** syncing or using the canonical checkout for proof risked overwriting owner work and invalidating the local production lane.
- **Root cause:** concurrent local work existed outside the epic registry.
- **Unblock/workaround:** all implementation and proof ran in registered isolated worktrees; merge closeout left the canonical checkout untouched.
- **Durable fix/tracker:** release profile requires preserve-before-mutate and a flagged canonical-lane gap whenever the checkout is dirty.
- **Status:** contained; canonical lane remains intentionally unsynced pending owner cleanup.

### 2026-07-14 · Wave 1 — DevOps SOP landed mid-run

- **Symptom:** PR #415 changed the required command, CI naming, main concurrency, release artifacts, and budget rules after #402 had started.
- **Detection evidence:** current main advanced to `f95bb630…` with new `npm run ci:required`, `Required gate`, and `eido-main-<sha>` artifact contracts.
- **Impact:** #402's stale base and evidence workflow no longer satisfied the live merge contract.
- **Root cause:** the DevOps operating system was delivered concurrently with the benchmark lane.
- **Unblock/workaround:** preserved #402 work, rebased onto `f95bb630…`, re-ran exact-head gates, and used the new main release-object proof.
- **Durable fix/tracker:** every dispatch now reads `release-profile.md` and `devops-operating-system.md` from live `origin/main`, not its kickoff checkout.
- **Status:** resolved.

### 2026-07-14 · Wave 1 — Managed host could not launch Chromium

- **Symptom:** local Playwright/Chromium attempts failed before tests ran with a Mach-port rendezvous permission error.
- **Detection evidence:** base-era and candidate browser launches failed identically on the managed Mac; the release profile records the host limitation.
- **Impact:** local browser correctness and performance runs were unavailable as acceptance evidence.
- **Root cause:** managed-host sandbox/EDR restrictions, not product code.
- **Unblock/workaround:** browser and candidate-performance proof moved to GitHub-hosted provider workflows using synthetic fixtures.
- **Durable fix/tracker:** dispatch contracts treat browser tests as write-only locally and require attached provider evidence on every current PR head.
- **Status:** active environment constraint; workaround established.

### 2026-07-14 · Wave 1 — Expensive capture ran before a cheap choreography probe

- **Symptom:** an early provider attempt consumed about 20 minutes before failing on scenario choreography.
- **Detection evidence:** run [29324640226](https://github.com/limweili/eido/actions/runs/29324640226) failed before producing qualified evidence.
- **Impact:** slow feedback and wasted Actions minutes delayed the baseline.
- **Root cause:** the workflow attempted the full repeated capture before proving every scenario once.
- **Unblock/workaround:** added a bounded one-repetition all-scenario probe and made full capture conditional on that probe.
- **Durable fix/tracker:** every #410 candidate workflow must run a red-capable one-repetition correctness/choreography probe before expensive capture.
- **Status:** resolved and propagated to Wave 2 contracts.

### 2026-07-14 · Wave 1 — Card-body scroll targeted the wrong owner

- **Symptom:** the `card-body-scroll` scenario sent wheel input but observed no `scrollTop` movement.
- **Detection evidence:** run [29326030244](https://github.com/limweili/eido/actions/runs/29326030244) failed at repetition 1.
- **Impact:** the benchmark measured harness choreography rather than the production scroll path.
- **Root cause:** the probe selected a visible rich body instead of the actual production scroll owner.
- **Unblock/workaround:** bound the probe to the production scroll container and reset it before input.
- **Durable fix/tracker:** scenario gates assert concrete before/after scroll movement on the named owner.
- **Status:** resolved.

### 2026-07-14 · Wave 1 — Conversation fixture selector did not match production markup

- **Symptom:** the long Conversation scenario searched for an absent `.transcript` node.
- **Detection evidence:** run [29326217672](https://github.com/limweili/eido/actions/runs/29326217672) failed in the one-repetition probe.
- **Impact:** the full capture correctly stopped, but another provider round was required.
- **Root cause:** synthetic fixture assumptions drifted from the real component structure.
- **Unblock/workaround:** made the synthetic Conversation render the actual long-body path and asserted the production selector before timing.
- **Durable fix/tracker:** fixture choreography must prove element existence and interaction semantics before collecting timing.
- **Status:** resolved.

### 2026-07-14 · Wave 1 — Activation scenarios asserted selection instead of first-click intent

- **Symptom:** hover-before-click and click-before-activation failed even when one physical click entered/focused the live editor.
- **Detection evidence:** runs [29326755243](https://github.com/limweili/eido/actions/runs/29326755243) and [29326983996](https://github.com/limweili/eido/actions/runs/29326983996) failed the unrelated selection-store assertion.
- **Impact:** valid interaction behavior was classified as broken and repeated provider attempts were wasted.
- **Root cause:** the harness used Card selection as a proxy for the actual contract: one click reaches the intended focused live interaction.
- **Unblock/workaround:** asserted exactly one physical click followed by a visible, focused live Note editor.
- **Durable fix/tracker:** activation probes must observe the intended user outcome directly; proxy store state is insufficient.
- **Status:** resolved.

### 2026-07-14 · Wave 1 — First rAF delta mixed incompatible time origins

- **Symptom:** a full 48-run capture completed and was then rejected for an invalid negative frame metric.
- **Detection evidence:** run [29327524608](https://github.com/limweili/eido/actions/runs/29327524608) passed the probe and all repetitions before validation failed.
- **Impact:** the most expensive attempt produced no retainable evidence.
- **Root cause:** the first animation-frame interval subtracted timestamps with mixed semantics.
- **Unblock/workaround:** discarded the synthetic first sample rather than clamping it and preserved subsequent raw intervals.
- **Durable fix/tracker:** shared collector helper has a negative-first-delta regression test; invalid values remain red rather than normalized.
- **Status:** resolved.

### 2026-07-14 · Wave 1 — Validator diagnostics were too late and too vague

- **Symptom:** validation failed before raw JSON was written and did not name the exact invalid field; the proposed collector correction initially lacked a discriminating regression test.
- **Detection evidence:** failure artifact from 29327524608 omitted raw evidence; run [29327879730](https://github.com/limweili/eido/actions/runs/29327879730) was cancelled after pre-acceptance audit found missing field-specific proof.
- **Impact:** diagnosis required another code/review round and could have hidden future schema regressions.
- **Root cause:** validation, diagnostic preservation, and collector tests were designed independently.
- **Unblock/workaround:** added field-specific invariant errors, invalid-only diagnostics, raw preservation, schema/contract/repetition/privacy checks, and regression coverage before retry.
- **Durable fix/tracker:** candidate schemas must reject incomplete status/value pairs and retain enough failure evidence to diagnose without re-running.
- **Status:** resolved.

### 2026-07-14 · Wave 1 — Load-sensitive performance gates produced inherited reds

- **Symptom:** broad performance controls missed thresholds under host load on both candidate and control revisions.
- **Detection evidence:** same-machine main and fork-point controls reproduced the failures; no production path changed in #402.
- **Impact:** an inherited environmental red could have been misattributed to the benchmark PR.
- **Root cause:** EDR/Chrome load contaminates absolute fps/timing gates on the managed laptop.
- **Unblock/workaround:** used interleaved same-machine controls and treated timing reds without controls as hypotheses.
- **Durable fix/tracker:** [#417](https://github.com/limweili/eido/issues/417) carries the load-sensitive control work; candidate decisions compare controlled ratios, not absolute classes.
- **Status:** open follow-up; #402 exonerated.

### 2026-07-14 · Wave 1 — Skip-worktree overlay made a local gate untrustworthy

- **Symptom:** a local checkout could report green while index overlay state hid a file from ordinary status/diff inspection.
- **Detection evidence:** explicit index/worktree inspection disagreed with the apparent clean local gate surface.
- **Impact:** local proof risked testing bytes different from the commit that provider CI would evaluate.
- **Root cause:** hidden `skip-worktree` state survived in a reused worktree.
- **Unblock/workaround:** cleared the overlay, compared the exact commit tree, and relied on clean isolated worktrees plus exact-head provider proof.
- **Durable fix/tracker:** add a mechanical pre-gate check for hidden index bits to the orchestration/CI mirror tooling; file from the ledger at closeout if not already covered.
- **Status:** workaround complete; durable guard pending.

### 2026-07-14 · Wave 1 — Docs-sync PASS included a false CI-report claim

- **Symptom:** documentation implied CI regenerated/verified the checked-in report when the perf report test was excluded from `npm test`.
- **Detection evidence:** workflow/package-script inspection contradicted the first docs-sync report; final Opus review independently confirmed report drift is not CI-gated.
- **Impact:** readers could over-trust future raw/report consistency.
- **Root cause:** docs-sync trusted a claimed command relationship instead of tracing the live workflow and test include/exclude rules.
- **Unblock/workaround:** corrected `TESTING.md`, regenerated the report deterministically by hand, and recorded the limitation explicitly.
- **Durable fix/tracker:** add a non-mutating report-drift CI check; docs-sync reviews must cite the executable workflow path for CI claims.
- **Status:** current docs fixed; CI drift guard pending.

### 2026-07-14 · Wave 1 — Fable usage exhaustion changed review routing

- **Symptom:** an in-progress Fable review was no longer authorized and its partial output could not count as acceptance evidence.
- **Detection evidence:** owner explicitly prohibited Fable 5 due exhausted usage; the review was on stale head `25930dd…`.
- **Impact:** the official cross-vendor review route had to change without weakening independence.
- **Root cause:** model quota/usage changed mid-epic.
- **Unblock/workaround:** terminated/discarded the partial review and routed a fresh final review to Claude Opus 4.8.
- **Durable fix/tracker:** registry reviewer policy prohibits Fable for the epic and records Opus 4.8 as the preferred cross-vendor reviewer.
- **Status:** resolved; policy remains active.

### 2026-07-14 · Wave 1 — Opus found copy and image-evidence blockers

- **Symptom:** copy could be marked `observed` without captured text, and image ingestion/compression was reported as estimated `0ms` although production compression was never invoked.
- **Detection evidence:** Opus session `29b83194-4f14-4979-99e5-262996d196e6` blocked PR #418 at head `9a703ae…`.
- **Impact:** baseline claims were semantically false despite passing mechanics.
- **Root cause:** availability/status semantics allowed vacuous success and conflated absent measurement with a zero duration.
- **Unblock/workaround:** made selection exact-match, left clipboard unavailable/null, reported image ingestion unavailable/null, separated stored bytes from decoded pixels/decode/paint/cache/readiness, captured fresh provider evidence, and re-reviewed.
- **Durable fix/tracker:** evidence schemas require coherent status/value pairs and fixed honest wording for uninstrumented surfaces.
- **Status:** resolved; final Opus session `3f15bad1-92c8-4a99-8270-e99c77e50407` returned PASS.

### 2026-07-14 · Wave 1 — Passive selection was blocked by `user-select: none`

- **Symptom:** text selection on a passive React Flow/Card surface could not be observed even though passive search worked.
- **Detection evidence:** source/style inspection found inherited `user-select: none`; passive `window.find` succeeded while range selection did not.
- **Impact:** the benchmark initially risked claiming unsupported passive selection or testing an impossible path.
- **Root cause:** search and selection have different browser/CSS prerequisites on passive Cards.
- **Unblock/workaround:** measured passive search first, then hover/click activation and exact selection in the focused live editor; added a fast correctness gate before capture.
- **Durable fix/tracker:** search, selection, clipboard, and accessibility remain separate measured capabilities; candidate workflows fail before expensive capture when correctness regresses.
- **Status:** resolved with limitation reported.

### 2026-07-14 · Wave 1 — Report instrumentation remained incomplete

- **Symptom:** React work, GPU/rendition residency, clipboard, paste ingestion, and a complete assistive-technology audit were unavailable; max signed JS-heap growth was noisy.
- **Detection evidence:** final report unavailable-instrumentation ledger and Opus review limitations; JS heap excludes native/GPU caches.
- **Impact:** the baseline cannot support claims outside its measured surfaces.
- **Root cause:** provider/browser instrumentation boundaries and an intentionally bounded #402 scope.
- **Unblock/workaround:** named every unavailable field, used decoded-pixel estimates explicitly, and avoided renderer/image-architecture conclusions.
- **Durable fix/tracker:** candidate lanes must keep stored bytes, decoded pixels, rendition residency, decode, paint, cache, and readiness distinct; heap reporting needs an explicit distribution/GC protocol.
- **Status:** accepted limitation; follow-ups remain for later evidence lanes.

### 2026-07-14 · Merge train — Main-CI helper watched unrelated workflows

- **Symptom:** `main-ci-wait.sh` kept waiting after the exact-main Required gate and release artifact were green because a Dependabot workflow on the same SHA was still running.
- **Detection evidence:** Required run [29337246806](https://github.com/limweili/eido/actions/runs/29337246806) and artifact `8312497149` were complete while the helper remained silent.
- **Impact:** closeout stalled and an unrelated red workflow could have been misclassified as the required gate.
- **Root cause:** the helper selected every workflow by SHA and did not verify `eido-main-<sha>` itself.
- **Unblock/workaround:** independently verified the exact Required gate job and artifact metadata, then stopped the stale helper wait.
- **Durable fix/tracker:** [#419](https://github.com/limweili/eido/issues/419) scopes the helper to Required CI and adds artifact verification/non-blocking workflow reporting.
- **Status:** #402 proof complete; tooling fix open.

### 2026-07-14 · Merge closeout — Cleanup turn had to resume idempotently

- **Symptom:** the merge-captain closeout turn was interrupted after branch/worktree cleanup and registry edits.
- **Detection evidence:** resumed task arrived with merge/CI facts but required live re-verification of deletion and registry state.
- **Impact:** risk of repeating destructive cleanup or leaving registry ownership stale.
- **Root cause:** session-turn interruption during a multi-step closeout.
- **Unblock/workaround:** re-derived PR, issue, run, artifact, local/remote branches, worktrees, canonical status, and JSON validity; performed no duplicate merge/CI mutation.
- **Durable fix/tracker:** closeout steps are idempotent and evidence-carrying; registry records null resources only after verified deletion.
- **Status:** resolved.

### 2026-07-14 · Wave 2A — Registry changed concurrently during dispatch preparation

- **Symptom:** the first `apply_patch` for Wave 2A contracts failed because the root orchestrator had concurrently added reviewer policy and changed run state.
- **Detection evidence:** patch verification could not find the stale `wave-1-running-on-devops-sop` line; live file showed `wave-2a-dispatching` and a new policy block.
- **Impact:** no state was corrupted, but blindly retrying could have overwritten orchestrator changes.
- **Root cause:** registry is a shared coordination surface with concurrent writers.
- **Unblock/workaround:** re-read the live JSON, patched only #403/#413/retro ownership, and validated with `jq empty` before creating worktrees.
- **Durable fix/tracker:** always patch against a fresh registry snapshot and keep changes field-local; consider a mechanical compare-and-swap registry updater.
- **Status:** resolved; no lost fields.

### 2026-07-14 · Wave 2A — Agent thread cap blocked fresh child creation

- **Symptom:** spawning the first #403 supervisor returned `agent thread limit reached`; no child/session was created.
- **Detection evidence:** collaboration spawn failed immediately; live agent list showed root, this coordinator, and two completed-but-reusable task slots.
- **Impact:** both implementation dispatches were temporarily blocked despite registered worktrees and contracts.
- **Root cause:** the harness enforces a four-thread tree cap and completed task identities still occupied reusable slots.
- **Unblock/workaround:** root reused completed canonical tasks `/root/impl_402` for #403 and `/root/tracker_preflight` for #413 with fresh self-contained contracts; registry records those supervisor IDs.
- **Durable fix/tracker:** reserve/reuse task slots at wave planning and report cap failures immediately; never create an unregistered ghost workaround.
- **Status:** unblocked; both supervisors running.

### 2026-07-14 · Wave 2A — New worktree was absent from the code graph

- **Symptom:** codebase-memory rejected the #403 worktree/project as unindexed.
- **Detection evidence:** graph query returned `project not found or not indexed`; the available catalog contained the canonical `Users-weili-Documents-Projects-eido` index but not the new worktree.
- **Impact:** graph-first discovery could not directly address the isolated worker checkout.
- **Root cause:** registering a Git worktree does not register or alias it in codebase-memory.
- **Unblock/workaround:** query the canonical graph at the same landed base, then verify exact snippets/files in the isolated #403 worktree where the graph is insufficient.
- **Durable fix/tracker:** worktree creation should register an index or alias new worktrees to the canonical project when their base matches.
- **Status:** workaround active; durable indexing integration open.

### 2026-07-14 · Wave 2A — Local toolchain differs from CI pins

- **Symptom:** the host exposes Node 24.13/npm 11.6.2 while CI requires Node 20/npm 10.
- **Detection evidence:** #403 supervisor preflight compared local versions with the live release profile.
- **Impact:** an ordinary local install could rewrite `package-lock.json` and drop npm-10-required entries; no mutation occurred.
- **Root cause:** worktree bootstrap does not automatically activate the repository CI toolchain.
- **Unblock/workaround:** both contracts forbid lockfile regeneration/dependency additions; any authorized dependency change must use `npx npm@10`, and provider `npm run ci:required` is authoritative.
- **Durable fix/tracker:** add repository-managed Node/npm activation to worktree bootstrap.
- **Status:** contained; no lockfile change.

### 2026-07-14 · Wave 2A — Actions billing API scope was unavailable

- **Symptom:** `npm run ci:budget` could not read repository-filtered billing data with the current token.
- **Detection evidence:** GitHub returned missing `user` scope; the scripted conservative fallback reported GREEN at $4.66/$50.
- **Impact:** budget accounting intentionally overstates spend but remains safe; no dispatch freeze.
- **Root cause:** current GitHub token lacks billing-read scope.
- **Unblock/workaround:** used the documented gross Eido-minute fallback with no included-minute deduction.
- **Durable fix/tracker:** either grant read-only billing scope or document the conservative fallback as expected preflight state.
- **Status:** operational; data precision limitation remains.

### 2026-07-14 · Wave 2A — #413 indexed its isolated worktree on demand

- **Symptom:** codebase-memory listed canonical/older projects but not the mandated #413 worktree.
- **Detection evidence:** `list_projects` omitted `/Users/weili/Documents/Projects/eido-worktrees/epic-410-413`; the Sol worker emitted a friction checkpoint before discovery.
- **Impact:** querying only the canonical index could misstate branch-local code after edits begin.
- **Root cause:** graph indexing is per worktree and dispatch bootstrap did not create the index.
- **Unblock/workaround:** the #413 worker created a fast index for its isolated worktree, then queried that exact-base graph.
- **Durable fix/tracker:** add “index each dispatched worktree before graph discovery” to the worktree preflight contract.
- **Status:** unblocked; discovery continuing.

### 2026-07-14 23:58 AEST · Wave 2A — Optional zsh glob aborted discovery

- **Symptom:** a diagnostic command ended with `zsh: no matches found: vitest.config.*` after finding relevant component tests.
- **Detection evidence:** #413 Sol checkpoint captured the exact shell error.
- **Impact:** no repo change or lost result, but config discovery stopped early.
- **Root cause:** an unmatched optional glob was passed raw to zsh, whose `nomatch` behavior treats it as an error.
- **Unblock/workaround:** use quoted patterns or enumerate with `rg --files` before filtering.
- **Durable fix/tracker:** dispatch/tooling contracts should prohibit raw optional globs under zsh.
- **Status:** unblocked.

### 2026-07-15 · Wave 2A — #403 supervisor tried to allocate a fifth collaboration thread

- **Symptom:** the reused #403 supervisor reported that its Sol worker could not start because `spawn_agent` hit the four-thread cap.
- **Detection evidence:** checkpoint said no Codex CLI session existed and requested another collaboration slot, while #413 had already launched Sol directly from its supervisor shell.
- **Impact:** #403 implementation started later than #413; no code or RED proof was lost.
- **Root cause:** the supervisor/worker topology was misread: the supervisor is the collaboration thread and must invoke `codex exec` directly, not spawn a second wrapper thread.
- **Unblock/workaround:** instructed `/root/impl_402` to launch fresh `codex exec --model gpt-5.6-sol` directly in the registered worktree with long-running stdin-safe mechanics.
- **Durable fix/tracker:** every reused-supervisor brief must state explicitly that its CLI worker is a subprocess, not a collaboration child; reserve collaboration slots only for supervisors/coordinators.
- **Status:** corrected; awaiting CLI session checkpoint.

### 2026-07-14 23:57 AEST · Wave 2A — #413 provider stream disconnected once

- **Symptom:** the Codex response stream emitted `responses_retry: stream disconnected - retrying sampling request (1/5 in 206ms)`.
- **Detection evidence:** supervisor captured the live CLI stream event.
- **Impact:** brief latency only; the shell session remained alive and no work was lost.
- **Root cause:** transient provider-stream interruption.
- **Unblock/workaround:** built-in retry reconnected successfully; the existing CLI session was retained and polled.
- **Durable fix/tracker:** do not redispatch on a first transient stream retry; preserve/poll the persistent session unless retries exhaust or the process dies.
- **Status:** resolved automatically.

### 2026-07-15 · Wave 2A — Combined required reads were truncated

- **Symptom:** #403's combined required-reading command exceeded its output boundary, and a batch lookup of the repo-local TDD skill path returned no usable content.
- **Detection evidence:** supervisor checkpoint reported truncated combined output and empty batch-path results before any production edit or RED test.
- **Impact:** small preflight delay and a risk that the worker might act without fully loading mandatory contracts.
- **Root cause:** too many long documents were requested in one tool result and file-path assumptions were not verified first.
- **Unblock/workaround:** re-read mandatory files individually in bounded chunks until EOF and verify each direct path before continuing.
- **Durable fix/tracker:** worker bootstrap should cap/sequence required reads and assert successful complete reads per document.
- **Status:** unblocked; required reading continuing before implementation.

### 2026-07-15 · Wave 2A — GitHub app returned 404 for private-repo issues

- **Symptom:** the GitHub connector/app could not read #403 or #410 despite correct repository identifiers.
- **Detection evidence:** connector calls returned 404; authenticated `gh` CLI reported valid repo/workflow scopes.
- **Impact:** tool-path fallback only; tracker state remained verifiable.
- **Root cause:** probable private-repository installation/access gap for the connector.
- **Unblock/workaround:** use authenticated `gh issue view`/API reads for this repository.
- **Durable fix/tracker:** audit the GitHub app installation/access or make the private-repo dispatch profile default to `gh` when connector access is absent.
- **Status:** unblocked; access audit open.

### 2026-07-15 · Wave 2A — #403 graph calls were cancelled inside noninteractive CLI

- **Symptom:** codebase-memory `list_projects` and direct-worktree `search_graph` calls were cancelled before returning inside the fresh Sol CLI.
- **Detection evidence:** #403 worker emitted cancelled MCP call results before any source edit.
- **Impact:** discovery-method degradation only; no implementation state was lost.
- **Root cause:** the CLI child did not inherit a usable noninteractive MCP approval/index state, compounded by the new-worktree indexing gap.
- **Unblock/workaround:** make one canonical same-base graph attempt, then inspect only exact owned files when graph evidence is insufficient, as AGENTS permits.
- **Durable fix/tracker:** CLI child bootstrap should inherit noninteractive MCP approval and auto-index/alias dispatched worktrees.
- **Status:** workaround active.

### 2026-07-15 00:01 AEST · Wave 2A — #413's first RED was only missing dependencies

- **Symptom:** the initial targeted test command could not start Vitest because the new worktree had no installed dependencies.
- **Detection evidence:** unresolved `vite` and `@vitejs/plugin-react` imports ended in `ERR_MODULE_NOT_FOUND` before assertions ran.
- **Impact:** setup failure was correctly rejected as TDD RED proof and delayed the discriminating checkpoint.
- **Root cause:** isolated worktree bootstrap created no `node_modules`.
- **Unblock/workaround:** run lockfile-preserving `npx npm@10 ci`, verify the saved package-lock hash is unchanged, then rerun targeted tests for missing candidate APIs/behavior.
- **Durable fix/tracker:** dispatch preflight should install dependencies with the CI-pinned package manager before asking for RED proof.
- **Status:** active until discriminating RED rerun.

### 2026-07-15 · Wave 2A — #403 dependency bootstrap was missing before RED

- **Symptom:** the fresh #403 worktree had no `node_modules`, which would have made a first test failure setup-only.
- **Detection evidence:** supervisor preflight found dependencies absent before running RED.
- **Impact:** no invalid RED was recorded; a short setup delay occurred.
- **Root cause:** worktree creation does not install dependencies.
- **Unblock/workaround:** ran `npx npm@10 ci`; installed 380 packages, audit was clean, and package-lock SHA-256 remained `775696433b54caff107fcddc90feb37f14974bf422f77c012467959c13523fc3`.
- **Durable fix/tracker:** worktree bootstrap should run npm10 CI plus a before/after lock hash assertion before dispatch.
- **Status:** resolved; discriminating RED still required.

### 2026-07-15 · Wave 2A — #413 proposed a shared `package.json` edit

- **Symptom:** the valid-RED file plan included package scripts even though the registered parallel-wave contract forbids `package.json`/`package-lock.json` as shared hotspots.
- **Detection evidence:** CHECKPOINT_RED listed “package scripts”; registry scope-check showed both package files forbidden and stale Card component path labels.
- **Impact:** proceeding could have broken #403/#413 file disjointness before either PR existed.
- **Root cause:** the worker brief allowed package scripts “if needed,” diverging from the registry-first scope; registry initially named Card files under `src/shared` instead of their actual `src/canvas/cards` paths.
- **Unblock/workaround:** interrupted the Sol turn before implementation, resumed the same CLI session with package files prohibited, direct workflow commands required, and actual Card paths; registry paths/state were corrected.
- **Durable fix/tracker:** generate worker briefs from the validated registry contract rather than maintaining a second prose scope; run scope-check on the declared file plan before first implementation edit.
- **Status:** contained; awaiting CHECKPOINT_SCOPE confirmation.

### 2026-07-15 · Wave 2A — #413 established discriminating RED

- **Symptom:** the candidate rendition seam did not exist and compression instrumentation returned no required stage metrics.
- **Detection evidence:** Sol session `019f60e6-f747-7361-bd37-b498c4fb29b3` ran targeted Vitest after npm10 bootstrap: import of `imageRenditions.ts` failed and the metric expectation received `[]` instead of decode/encode/total/attempt/source/stored/compressed records; exit 1.
- **Impact:** acceptance is now guarded by tests that fail for the intended missing behavior rather than environment setup.
- **Root cause:** current production has one authoritative image reference but no derived-rendition/cache seam or separated compression metric contract.
- **Unblock/workaround:** proceed with the smallest owned seam while keeping 16 existing legacy/save/AI/export compatibility tests green.
- **Durable fix/tracker:** retain the RED assertions and exact base evidence in PR #413's report and provider workflow.
- **Status:** RED proven; implementation active.

### 2026-07-15 · Wave 2A — #403 established discriminating RED

- **Symptom:** small Boards still used whole-board Reading residency instead of spatial visibility.
- **Detection evidence:** Sol session `019f60eb-524f-7773-ad8c-3e9e0ec2a5f9` expected `[visible]` from `createBoardScene` strict-residency planning but received `[visible, far-away]` at the new test's line 231; exit 1 after npm10 bootstrap.
- **Impact:** the core diagnosis is executable and can catch restoration of the whole-board shortcut.
- **Root cause:** current Board Scene planning keeps the small-board all-resident path.
- **Unblock/workaround:** implement the prototype-only residency planner and integration within the registered canvas scope, leaving the production default off.
- **Durable fix/tracker:** preserve the RED characterization and use the same frozen #402 scenarios in the candidate evidence workflow.
- **Status:** RED proven; minimal green active.

### 2026-07-15 00:02 AEST · Wave 2A — A second raw optional glob hit zsh `nomatch`

- **Symptom:** optional top-level `*.d.ts` discovery failed after the worker had already found `src/vite-env.d.ts`.
- **Detection evidence:** #413 checkpoint captured the raw-glob `nomatch` error.
- **Impact:** no lost result or repo change; minor discovery interruption.
- **Root cause:** same unquoted optional-glob behavior as the earlier `vitest.config.*` failure.
- **Unblock/workaround:** read the known file and use `rg --files`-first discovery.
- **Durable fix/tracker:** prohibit raw optional globs under zsh in worker command contracts.
- **Status:** resolved.

### 2026-07-15 00:04 AEST · Wave 2A — Global npm cache ownership blocked a targeted rerun

- **Symptom:** #413's post-implementation `npx -y npm@10 exec` invocation failed before Vitest ran.
- **Detection evidence:** npm reported `EPERM` opening `/Users/weili/.npm/_cacache/tmp/...` and suggested changing root-owned cache files.
- **Impact:** this invocation produced no behavioral result; no repository file changed.
- **Root cause:** host-global npm cache ownership, not candidate code.
- **Unblock/workaround:** use the already-installed worktree-local `./node_modules/.bin/vitest` (or `npx --no-install`) and never sudo or mutate the global cache.
- **Durable fix/tracker:** worktree preflight should use a worktree-local npm cache, then run local binaries after npm10 CI.
- **Status:** active until the direct local-binary rerun completes.

### 2026-07-15 · Wave 2A — #403 provider stream disconnected once

- **Symptom:** the Codex response stream disconnected during candidate instrumentation and scheduled retry 1/5 after 180ms.
- **Detection evidence:** #403 supervisor captured the live CLI retry event; the worker process/session remained alive.
- **Impact:** no command/file state was lost and no implementation delay beyond the retry.
- **Root cause:** transient provider-stream interruption.
- **Unblock/workaround:** retain and monitor the same CLI session; automatic retry resumed sampling.
- **Durable fix/tracker:** treat a single successful stream retry as telemetry, not runner death; escalate only after retries exhaust or the process vanishes.
- **Status:** resolved automatically.

### 2026-07-15 · Wave 2A — #413's bounded browser probe hit the known host denial

- **Symptom:** the single local Playwright probe failed before candidate test code executed.
- **Detection evidence:** Chromium logged `mach_port_rendezvous_mac.cc:159` / `bootstrap_check_in` permission denied (1100).
- **Impact:** no local browser evidence exists, but the failure says nothing about candidate behavior.
- **Root cause:** documented managed-host Chromium restriction, identical to base-era failure.
- **Unblock/workaround:** stopped local retries after one bounded attempt and moved correctness/performance evidence to a dedicated exact-head GitHub workflow.
- **Durable fix/tracker:** keep browser/perf acceptance on provider or unmanaged runners until the host restriction changes.
- **Status:** local path unavailable; provider proof pending.

### 2026-07-15 · Wave 2A — Frozen #402 readiness assumed 131 resident DOM Cards

- **Symptom:** reusing the canonical browser readiness condition would wait for every one of 131 Cards, which a strict viewport-residency candidate must deliberately avoid.
- **Detection evidence:** #403 worker traced the frozen harness readiness predicate before its first provider run and compared it with the candidate's bounded residency contract.
- **Impact:** left unchanged, the candidate workflow would time out or force the very whole-board residency it is meant to measure.
- **Root cause:** #402's runner embedded baseline-specific whole-board DOM readiness rather than a candidate-neutral readiness seam.
- **Unblock/workaround:** keep the frozen scenarios, repetitions, viewports, and metrics, but use a candidate-only passive-resident readiness observation and assert peak DOM stays below 131; canonical #402 files remain untouched.
- **Durable fix/tracker:** benchmark contracts should expose a candidate-neutral readiness predicate/API rather than a whole-board DOM count.
- **Status:** caught before provider run; candidate-only adaptation underway.

### 2026-07-15 · Wave 2A — Small-board connection planning shared the all-visible shortcut

- **Symptom:** the strict-residency candidate could cull Card DOM while still planning connections through the old small-board all-visible shortcut.
- **Detection evidence:** #403 worker inspected `visibleConnections` alongside the new resident-set behavior and found the mismatch before provider evidence.
- **Impact:** connection work and visuals could disagree with resident endpoints, weakening both performance measurement and hit=paint correctness.
- **Root cause:** Card and connection visibility shortcuts were coupled to Board size rather than the candidate resident endpoint set.
- **Unblock/workaround:** add a candidate-mode test requiring edge planning from resident endpoints while leaving the production default unchanged.
- **Durable fix/tracker:** candidate scene planning must derive Cards and Connections from one explicit visibility/residency contract.
- **Status:** RED/coverage being added.

### 2026-07-15 · Wave 2A — #403's npm10 wrapper hit the root-owned global cache

- **Symptom:** the first release-gate wrapper failed before `ci:required` with `EPERM` under `~/.npm/_cacache/tmp`.
- **Detection evidence:** #403 supervisor captured the cache path/error; repository diff and lockfile remained unchanged.
- **Impact:** gate startup delayed, but no product or dependency state changed.
- **Root cause:** host-global npm cache contains root-owned files.
- **Unblock/workaround:** set `npm_config_cache=/tmp/eido-403-npm-cache` and rerun; `npm run ci:required` passed CI tooling 11/11, build/budget, and 1111 tests across 102 files.
- **Durable fix/tracker:** fix npm-cache ownership in host provisioning or standardize a writable per-run cache in release scripts; never use sudo during lane work.
- **Status:** resolved; full local required gate green.

### 2026-07-15 · Wave 2A — #403 provider probe timed out at `connecting`

- **Symptom:** the bounded non-evidence provider probe completed scenarios through `dragging`, entered `connecting`, then hit its 120-second choreography timeout; the full repeated capture did not run.
- **Detection evidence:** [run 29340232649](https://github.com/limweili/eido/actions/runs/29340232649), exact head `e83f5ff0b944429cbc9093c885988fcbf0dbae1d`, failed with `NON-EVIDENCE choreography probe timed out at connecting: choreography`; failure artifact `8313786623` was retained.
- **Impact:** no candidate performance evidence exists from this head; the red remains a correctness-or-harness diagnosis, not a performance result.
- **Root cause:** under diagnosis—either strict residency removed a required connection participant/target or the candidate-only choreography/readiness path cannot observe it.
- **Unblock/workaround:** full capture was correctly gated off; do not widen the timeout or retry unchanged. Inspect the retained trace/context and reproduce with the narrow connecting probe/control before changing code.
- **Durable fix/tracker:** connecting probes must assert participant residency/target visibility and emit progress diagnostics that distinguish candidate behavior from selector/readiness failure.
- **Status:** active red; no acceptance/merge handoff.

### 2026-07-15 · Wave 2A — #403 report generator also had TypeScript syntax errors

- **Symptom:** separate report-generator TypeScript syntax failures appeared after the provider browser red.
- **Detection evidence:** #403 supervisor isolated the compiler failures from run 29340232649's `connecting` choreography timeout.
- **Impact:** candidate report generation is blocked, but it is not the cause of the browser correctness failure and must not distract diagnosis.
- **Root cause:** new report-generator code was committed before a narrow compile/test pass caught its syntax defects.
- **Unblock/workaround:** keep report work secondary; resolve the connecting RED with a discriminating test first, then correct the generator and run targeted typecheck/report tests before the next provider push.
- **Durable fix/tracker:** candidate report generators need a local compile/unit gate before provider capture is triggered.
- **Status:** active, deliberately sequenced after browser diagnosis.

### 2026-07-15 · Wave 2A — #413 provider probe loaded data but rendered zero nodes

- **Symptom:** the fixture API returned 131 Cards and 2 Outputs, but `.react-flow__node` remained absent until the fixed 240-second test timeout; capture/report steps were skipped.
- **Detection evidence:** [run 29340337019](https://github.com/limweili/eido/actions/runs/29340337019), exact head `aa923568fcf3f74ae55c34528c99bcf9a45dab5d`, failed at `page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0)`; artifact `8313878428` was preserved.
- **Impact:** no candidate image evidence is acceptable from this head; the red is startup/integration/page-error diagnosis, not an image-performance result.
- **Root cause:** under diagnosis—the candidate startup flag or React integration may throw/prevent Board mounting after fixture load, or the probe lacks page-error diagnostics.
- **Unblock/workaround:** do not widen timeout or retry unchanged. Inspect retained context, capture page/console errors and mount state, then write a narrow startup/integration RED before a minimal fix.
- **Durable fix/tracker:** every candidate probe should fail fast on `pageerror`/console error and expose fixture-loaded, Board-mounted, and node-count checkpoints separately.
- **Status:** active red; no capture/report/PR acceptance.

### 2026-07-15 · Wave 2A — #403 pushed a diagnosis fix before the requested fresh-Sol checkpoint

- **Symptom:** the implementation worker committed/pushed head `4a49de08704662184ca3802f163aa6487ff2d024` and triggered provider run 29340853766 before a separately requested fresh-Sol review of the connecting fix.
- **Detection evidence:** remote branch advanced from `e83f5ff…` to `4a49de0…`; provider job attached while the supervisor was still expecting the independent review boundary.
- **Impact:** an unreviewed branch head exists remotely and consumes one provider run; no PR, merge, or evidence claim was authorized.
- **Root cause:** the review-before-push checkpoint existed in supervisor coordination prose but was not mechanically enforced in the implementation CLI workflow.
- **Unblock/workaround:** contain shared state: no PR/merge/acceptance; run a distinct fresh `gpt-5.6-sol` adversarial review of `e83f5ff…4a49de0` and the diagnosis before any further push, while treating the provider run only as diagnostic. Official final review remains fresh Opus 4.8; no Fable used.
- **Durable fix/tracker:** enforce a hard pre-push review checkpoint outside the implementation session when a diagnosed provider red requires independent adjudication.
- **Status:** contained; provider run pending and fresh-Sol review required.

### 2026-07-15 · Wave 2A — #403 diagnostic run passed probe then crashed in selection setup

- **Symptom:** diagnostic run 29340853766 advanced beyond the prior connecting timeout but the correctness gate failed immediately with `IndexSizeError` from `Range.setEnd(..., 20)`.
- **Detection evidence:** [run 29340853766](https://github.com/limweili/eido/actions/runs/29340853766), exact head `4a49de08704662184ca3802f163aa6487ff2d024`, failed in `measureCorrectness` because the selected node had no child/offset 20; capture did not run.
- **Impact:** the connecting fix remains unaccepted pending fresh review, and this head produces no candidate evidence.
- **Root cause:** candidate correctness choreography assumes the desired selection lies in one specific child text node; live editor markup/text segmentation violated that assumption.
- **Unblock/workaround:** keep the run diagnostic-only. Complete the fresh-Sol review first, then add a discriminating selection-choreography test/helper that walks actual text nodes while preserving exact selected-text equality; do not weaken the copy/selection contract.
- **Durable fix/tracker:** centralize robust live-editor selection choreography for candidate harnesses rather than copying DOM child/offset assumptions.
- **Status:** active red; no PR/evidence acceptance.

### 2026-07-15 · Wave 2A — #413 debugger looked for scope-check at a stale path

- **Symptom:** the resumed debugger looked for `scripts/scope-check.sh`, which does not exist at repo root.
- **Detection evidence:** supervisor path check found the helper at `.agents/skills/epic-orchestration/scripts/scope-check.sh`; the prior scope run had used the correct path.
- **Impact:** no proof gap or repository change; minor lookup delay.
- **Root cause:** helper location was remembered generically instead of copied from the orchestration skill.
- **Unblock/workaround:** use the exact skill-relative path already present in the worker contract.
- **Durable fix/tracker:** dispatch briefs and scripts should carry the exact scope-check path, not an inferred root-level alias.
- **Status:** resolved.

### 2026-07-15 · Wave 2A — Correction to #403 run 29340853766 detail

- **Symptom:** the prior entry conservatively said the run advanced beyond `connecting`; the complete log/supervisor checkpoint confirms all 16 frozen choreography scenarios passed, including `connecting`, before the separate correctness failure.
- **Detection evidence:** provider probe step completed green at head `4a49de0…`; the next correctness step alone failed on `Range.setEnd` with an element first child.
- **Impact:** the provider run corroborates the structural-identity/gesture-residency fix for the original connecting symptom, but still cannot serve as accepted evidence because correctness and capture failed.
- **Root cause:** original connecting failure and stale candidate selection choreography are independent defects.
- **Unblock/workaround:** keep the run disqualified; hold the TreeWalker-based harness correction uncommitted/unpushed until the fresh-Sol review verdict.
- **Durable fix/tracker:** record provider steps separately—probe, correctness, capture—so a later-stage red does not erase diagnostic evidence or become acceptance by implication.
- **Status:** connecting diagnosis corroborated; overall run remains red/disqualified.

### 2026-07-15 · Wave 2A — #403 implementation session pushed again after containment

- **Symptom:** a Ctrl-C arrived after the implementer's combined typecheck/list/commit/push command had already pushed harness fix `e616db79cf770f39aa45e1b9c5d10a95e287a392` and triggered run 29341064582.
- **Detection evidence:** remote branch advanced from `4a49de0…` to `e616db7…`; provider run attached; the implementation CLI then terminated without a final report.
- **Impact:** a second externally unreviewed diagnostic head/run exists; still no PR, merge, or accepted evidence.
- **Root cause:** interruption cannot unwind an already-started compound shell command, and the implementation session retained git-push authority despite the supervisor review gate.
- **Unblock/workaround:** classify wave 3 diagnostic-only; keep fresh reviewer `019f6106…` on the earlier full candidate and launch a second fresh Sol reviewer for `4a49de0…e616db7` before any further mutation.
- **Durable fix/tracker:** implementation sessions should be denied git-push permission; the supervisor alone pushes after external review. Never combine verify, commit, and push in one interrupt-insensitive command.
- **Status:** contained; implementation session terminated, two review verdicts required.

### 2026-07-15 · Wave 2A — Read-only #403 reviewer could not start Vitest caches

- **Symptom:** the fresh read-only reviewer could not launch Vitest because it attempted to write `node_modules/.vite-temp`; a live issue refresh also hit transient `api.github.com` connectivity.
- **Detection evidence:** reviewer reported sandbox `EPERM` at the Vite temp path and a GitHub connectivity failure; no source/Git mutation occurred.
- **Impact:** the reviewer can adjudicate code causality and tests statically but cannot independently rerun the suite in its current sandbox; it must rely on separately recorded green test evidence.
- **Root cause:** review sandbox makes build-cache paths read-only instead of redirecting ephemeral writes to a disposable location; network was transiently unavailable.
- **Unblock/workaround:** continue exact-head static adversarial review using local issue/ADR/contract text and recorded green targeted runs; do not weaken sandbox source/Git protections.
- **Durable fix/tracker:** reviewer profiles need a writable disposable Vite/Vitest cache while keeping source, index, refs, and remote mutation read-only.
- **Status:** review active with stated rerun limitation.

### 2026-07-15 · Wave 2A — #413 pushed a readiness fix before fresh review

- **Symptom:** diagnostic head `0d0e019a69d9ae74317973c14b3b9be824fd2b8f` and run 29341104491 were pushed before the required fresh review of the readiness/observability change.
- **Detection evidence:** remote branch/run advanced while the supervisor still owed independent review; no PR was opened.
- **Impact:** one unreviewed diagnostic head/run exists, but no evidence or merge acceptance was granted.
- **Root cause:** implementation CLI retained push authority and its continuation contract did not mechanically stop at the external-review boundary.
- **Unblock/workaround:** freeze the head, interrupt implementation, classify the provider run diagnostic-only, and launch fresh read-only Sol review `019f610a-7b2e-77c0-b9aa-dbc712f16957` over `aa92356…0d0e019` before mutation.
- **Durable fix/tracker:** supervisor-only push authority and a hard review gate must apply to provider-red fix loops in every lane.
- **Status:** contained; fresh review active.

### 2026-07-15 · Wave 2A — #413 diagnostics proved the candidate runtime never registered

- **Symptom:** the revised probe still failed startup, now after 30 seconds with explicit state showing `candidateRuntimePresent=false` and `candidateEnabled=false`.
- **Detection evidence:** [run 29341104491](https://github.com/limweili/eido/actions/runs/29341104491), exact head `0d0e019…`, reported `rootChildCount=1`, performance/graph/viewport runtimes present, zero detail/overview nodes, and no console/page errors; capture/report skipped.
- **Impact:** this head is diagnostic-only and supplies no candidate evidence, but it narrows the prior 240-second opaque timeout to runtime registration/gating.
- **Root cause:** not yet proven; the candidate runtime/flag is not wired into app startup observed by the provider even though the workflow sets the candidate environment variable.
- **Unblock/workaround:** fresh review must challenge whether detail-or-overview readiness can mask failure and identify the missing registration seam; next fix requires a narrow runtime-presence RED before another provider push.
- **Durable fix/tracker:** candidate workflows should assert the candidate runtime is present/enabled before fixture load and fail in seconds with build-time environment provenance.
- **Status:** active red; no PR/evidence acceptance.

### 2026-07-15 · Wave 2A — Fresh #403 review found the regression test could pass with churn restored

- **Symptom:** the proposed connecting fix had tests for mount-plan collection identity but no mutation-sensitive assertion on the controlled React Flow `nodes` identity consumed by `Board`.
- **Detection evidence:** fresh read-only Sol review `019f6106-fe56-78c1-ad60-ef6a44a99059` returned BLOCKING at `boardScene.test.ts:836` / `Board.tsx:1354`: reverting the Board dependency to the whole `mountPlan` could pass current tests while restoring identity churn.
- **Impact:** the structural-identity root cause remains plausible but unproven; heads/runs through `e616db7…` are disqualified as acceptance evidence.
- **Root cause:** regression coverage asserted an upstream collection rather than the actual controlled-node identity at the consumer seam.
- **Unblock/workaround:** after reviewer #2 reports, add a Board-level mutation-sensitive RED covering source activation, connect-start, and target hover while unchanged controlled nodes retain identity; then apply the smallest fix and re-prove.
- **Durable fix/tracker:** performance-causality tests must fail when the exact consumer dependency regresses, not merely when a planner collection changes.
- **Status:** BLOCKING; no further mutation/push until both fresh reviews are reconciled.

### 2026-07-15 · Wave 2A — #403 wave-3 provider run was cancelled after review blocked

- **Symptom:** run 29341064582 was already in flight on unreviewed head `e616db7…` when fresh review #1 found a blocking regression-test gap.
- **Detection evidence:** GitHub now reports the exact-head workflow/job `completed/cancelled`.
- **Impact:** no further Actions time or misleading candidate evidence was produced; cancellation is absent proof, never green.
- **Root cause:** provider execution began before the independent review gate.
- **Unblock/workaround:** cancel and mark the run disqualified; reviewer #2 may inspect the delta, but cannot convert the cancelled run into acceptance.
- **Durable fix/tracker:** enforce external review before supervisor push/provider trigger.
- **Status:** cancelled/disqualified.

### 2026-07-15 · Wave 2A — Fresh #403 review found the TreeWalker copy fix could false-pass

- **Symptom:** the harness TreeWalker avoided `IndexSizeError` but selected from offset 0 of the first non-empty node, including whitespace-leading text, rather than canonical first-`\S` semantics.
- **Detection evidence:** fresh read-only reviewer `019f610a-2396-70d2-bd74-6927652c2f0b` returned BLOCKING on `4a49de0…e616db7`; it also found no discriminating rich/whitespace test, unchecked `execCommand` result/content equality, and cleanup not protected by `finally`.
- **Impact:** correctness could report a false pass or leak selection/editor state after an exception; the pushed harness fix and cancelled run remain disqualified.
- **Root cause:** the patch optimized for preventing a DOM exception without preserving the baseline's exact substantive-text/copy semantics.
- **Unblock/workaround:** use a fresh local-only Sol TDD worker to implement an exact semantics/helper, prove rich+whitespace RED→GREEN, require substantive clipboard/content equality, and make cleanup exception-safe; separately add the Board-controlled-node identity regression from reviewer #1.
- **Durable fix/tracker:** candidate harnesses should import one tested semantic helper for selection/copy instead of reimplementing DOM traversal per lane.
- **Status:** BLOCKING; no further push until local fix and fresh diagnostic review pass.

### 2026-07-15 · Wave 2A — User re-confirmed the no-Fable review invariant

- **Symptom:** a long-running, compacted orchestration context could accidentally fall back to the default best-tier Fable route during later cross-validation.
- **Detection evidence:** user explicitly re-confirmed that Fable 5 is forbidden for **all** cross-validation/review in epic #410.
- **Impact:** every future reviewer dispatch must preserve the override; Fable output cannot count as evidence even if available.
- **Root cause:** model-routing defaults and historical references outlive turn context unless the override is durable.
- **Unblock/workaround:** registry `reviewerPolicy` and this retro carry the invariant: use Claude Opus 4.8 at exact model `claude-opus-4-8` maximum, or a fresh Codex `gpt-5.6-sol`/`gpt-5.6-terra` review when appropriate.
- **Durable fix/tracker:** never use Fable as fallback for this epic; every review brief and checkpoint must state the allowed route explicitly.
- **Status:** active invariant, re-confirmed by user.

### 2026-07-15 · Wave 2A — Fresh #413 review proved a lazy-install startup deadlock

- **Symptom:** startup waits for the image candidate runtime before loading the fixture, but the runtime is only installed lazily when `CardAssets` renders after fixture/mount.
- **Detection evidence:** fresh read-only Sol review `019f610a-7b2e-77c0-b9aa-dbc712f16957` returned BLOCKING on `aa92356…0d0e019`; workflow and implementation flags both equal literal `1`, ruling out the earlier flag-mismatch hypothesis.
- **Impact:** run 29341104491 is disqualified; no candidate can start under the current ordering even though provider environment wiring is correct.
- **Root cause:** circular startup order: readiness requires runtime installation, runtime installation requires rendered Card assets, and fixture/render begins after readiness.
- **Unblock/workaround:** a fresh local-only TDD worker must install/observe the runtime at an app-level candidate boundary before fixture readiness, with a discriminating startup-order RED.
- **Durable fix/tracker:** candidate runtime registration belongs at an explicit app/runtime seam, never a leaf component whose render depends on the fixture the runtime is meant to measure.
- **Status:** BLOCKING; no mutation/push yet.

### 2026-07-15 · Wave 2A — #413 readiness diagnostics could mask the real failure

- **Symptom:** the probe explicitly permitted console/page errors, diagnostic handling did not fully preserve the original cause, a timeout helper was unbounded, and error buffers had no cap.
- **Detection evidence:** the same fresh reviewer inspected the readiness predicate and diagnostic wrappers/buffers and returned blocking findings.
- **Impact:** a candidate could appear “ready” despite browser errors, or a secondary timeout/buffer failure could replace the causal startup error.
- **Root cause:** diagnostics were added reactively around a long timeout instead of as a bounded fail-closed contract.
- **Unblock/workaround:** tests must require zero browser errors, bound every diagnostic read/timeout/buffer, preserve the primary error as cause, and fail fast with staged startup state.
- **Durable fix/tracker:** provider probes need one shared bounded diagnostics harness with capped buffers and cause-preserving errors.
- **Status:** BLOCKING; provider run disqualified.

### 2026-07-15 · Wave 2A — Budget command was invoked from the stale orchestrator checkout

- **Symptom:** `npm run ci:budget` returned “Missing script” in `/Users/weili/.codex/worktrees/bca3/eido`.
- **Detection evidence:** that orchestration worktree remains detached at pre-SOP commit `5b8cb813…`, while the budget script landed later in PR #415; no repository file changed.
- **Impact:** the first budget read was absent, not red, and could not support a freeze decision.
- **Root cause:** operational commands were run from the durable registry checkout without checking whether its code version contained the current DevOps tools.
- **Unblock/workaround:** reran from registered clean devops-check worktree `f95bb630…`; budget reported GREEN at $4.77/$50 using the conservative fallback.
- **Durable fix/tracker:** execute operational scripts from a verified-current tool worktree or by an explicit versioned path; durable registry location and executable-tool checkout are separate concerns.
- **Status:** resolved; no budget anomaly.

### 2026-07-15 · Wave 2A — #403 extraction crossed a Board ownership guard

- **Symptom:** `ci:required` failed 1 of 1,115 tests at `test/cursorStyles.test.ts:118`, which expected the `liveCardNodeClassName(...)` decision to remain visible in `Board.tsx` after controlled-node construction was extracted.
- **Detection evidence:** every behavior suite was otherwise green; the source-pin guard alone failed on the extracted ownership seam.
- **Impact:** the local-only fix could not advance to review despite focused behavioral greens; no branch, provider run, or PR moved.
- **Root cause:** the established guard pins Board ownership of the wrapper-class decision, not merely the helper's runtime behavior or physical implementation location.
- **Unblock/workaround:** retained the memoized class resolver in `Board` and injected it into the new hook, then reran `ci:required` GREEN across 104 files and 1,115 tests without weakening or editing the shared guard.
- **Durable fix/tracker:** extraction contracts must inventory source-pin ownership guards alongside behavioral tests; keep policy decisions at the owning module and extract only the mechanical construction seam.
- **Status:** resolved locally; fresh independent review still required before any push.

### 2026-07-15 · Wave 2A — #413 local browser rerun remained host-blocked

- **Symptom:** the completed #413 local fix could not enter its Playwright test because managed Chromium launch failed with the known macOS Mach-port denial.
- **Detection evidence:** focused Vitest was GREEN 33/33, `typecheck` and npm 10.9.8 `ci:required` were GREEN across 104 files and 1,118 tests, and diff/scope checks were GREEN; only the browser launch failed before candidate execution.
- **Impact:** local browser evidence is absent, not green; no provider acceptance, branch advance, PR, or product conclusion follows from the host failure.
- **Root cause:** the managed local host cannot launch Chromium under its current sandbox/port constraints, matching the preflight-known browser-host limitation rather than a candidate test failure.
- **Unblock/workaround:** retain unit/full-gate evidence locally, require fresh read-only review, then run the bounded browser probe on the provider only after reviewed supervisor push.
- **Durable fix/tracker:** keep browser-capable provider proof explicit in the lane contract and distinguish pre-test host denial from candidate red in every evidence ledger entry.
- **Status:** contained; provider proof still required and no extra Actions run has started.

### 2026-07-15 · Wave 2A — #403 local fix crossed the canvas translation boundary

- **Symptom:** fresh read-only Sol review `019f6118-e08d-7083-9cbf-d6c439d3a43d` returned BLOCKING even though the controlled-node mutation regression and exact copy semantics passed.
- **Detection evidence:** the review found React Flow `Node` translation moved from `Board.tsx` into `controlledBoardNodes.ts`, contrary to the canvas-layer boundary, and found an unused/redundant `highlightedCardId` interface dependency.
- **Impact:** the locally green fix cannot advance to commit, provider run, or PR; the remote remains frozen at `e616db7…`.
- **Root cause:** the extraction solved identity stability by moving both mechanical memoization and ownership-sensitive React Flow translation, making the new seam broader than the foundation contract allows.
- **Unblock/workaround:** use a new local-only Sol turn to move/export the hook within `Board.tsx`, update the regression-test import, remove `highlightedCardId`, rerun focused mutation proof and full gates, then require another fresh read-only review.
- **Durable fix/tracker:** canvas performance refactors must preserve the documented translation owner; extract or memoize behavior only inside the owning boundary unless an architecture decision explicitly changes it.
- **Status:** BLOCKING locally; no remote mutation or new Actions run.

### 2026-07-15 · Wave 2A — #413 fail-closed review found four acceptance gaps

- **Symptom:** fresh read-only Sol review `019f611c-589d-7380-bec5-d0daf78f3831` returned BLOCKING after the local fix and all non-browser gates were green.
- **Detection evidence:** the reviewer passed non-circular bootstrap/overview rejection, bounded diagnostic deadline/cause preservation, candidate flag/default-off behavior, and strict scope, but found four gaps: readiness did not prove exactly nine images completed decode and were revalidated; resolver failures could be swallowed; console filtering was source-blind; and artifact writing occurred before the final event/error barrier while upload stayed unconditional.
- **Impact:** the candidate cannot advance to a reviewed supervisor push or provider evidence run; the remote remains frozen at `0d0e019…`.
- **Root cause:** the first diagnostic correction focused on making startup observable and bounded, but its acceptance boundary still treated observed DOM/counts, filtered errors, and pre-final artifact state as sufficient proxies for completed fail-closed evidence.
- **Unblock/workaround:** a new local-only Sol TDD turn must add exact-nine decode/revalidation with pending/reject/tenth-image tests, fail closed on resolver failures at every gate with artifact-validation regression, make console classification source-aware or use a narrow benign allowlist with a generic candidate-origin test, and place a final event barrier/error assertion before artifact write with partial cleanup and an ordering test.
- **Durable fix/tracker:** browser evidence harnesses need an explicit transaction boundary: complete exact resources, reject every causal error channel, drain final events, validate, then atomically publish the artifact or clean up partial output.
- **Status:** BLOCKING locally; no Git mutation or Actions run.

### 2026-07-15 · Wave 2A — #403 boundary repair passed fresh review

- **Symptom:** the prior #403 review blocker required proof that identity stabilization could stay inside the documented `Board.tsx` translation boundary without weakening copy or interaction behavior.
- **Detection evidence:** fresh read-only Sol review `019f6124-0351-7900-a7e6-15e536cf024a` returned PASS with zero blockers after inspecting the complete `e616db7…` plus local diff; Board ownership, redundant-dependency removal, mutation sensitivity, copy semantics, behavior, and scope all passed.
- **Impact:** the local review gate is resolved; provider browser evidence remains the sole non-blocking loose end before candidate acceptance.
- **Root cause:** resolved by narrowing the extraction to an internal `Board.tsx` hook instead of moving React Flow translation ownership.
- **Unblock/workaround:** retain the reviewed diff unchanged for supervisor-controlled commit/push and a bounded exact-head provider probe; keep the isolated report draft out of evidence until provider output exists.
- **Durable fix/tracker:** pair identity/performance mutation tests with architecture-boundary review; a behaviorally green extraction is incomplete if it moves the owning translation seam.
- **Status:** local review PASS; remote still frozen at this checkpoint and provider evidence pending.

### 2026-07-15 · Wave 2A — #413 repair retried a known-unavailable local browser gate

- **Symptom:** the #413 repair worker redundantly attempted local Playwright after the lane had already established that managed Chromium cannot launch on this host because of the macOS Mach-port denial.
- **Detection evidence:** the browser gate was unavailable before candidate execution, matching the earlier host preflight and local rerun rather than producing candidate evidence.
- **Impact:** minor time loss only; the result is non-authoritative and absent, not green or red. No further local browser retries are allowed, and provider proof remains required after review.
- **Root cause:** the worker's verification checklist repeated generic browser validation without inheriting the lane's registered host-capability exclusion.
- **Unblock/workaround:** stop local Playwright retries, complete exact-current-diff `ci:required` plus fresh read-only review, then use the reviewed provider runner once.
- **Durable fix/tracker:** every continuation/fix contract must inherit registered host capability exclusions and mark unavailable gates explicitly so workers do not rediscover known infrastructure limits.
- **Status:** contained; no repository, remote, or Actions mutation from the retry.

### 2026-07-15 · Wave 2A — #413 semantics passed but mutation/cleanup tests remained incomplete

- **Symptom:** fresh read-only Sol review `019f612e-6180-7043-9412-bc829dcd9ff8` returned BLOCKING after the four fail-closed production gaps were repaired and exact-current `ci:required` passed.
- **Detection evidence:** production semantics, standards, scope, default-off behavior, and bounded timeouts passed; npm 10.9.8 `ci:required` was GREEN across 104 files and 1,124 tests. The reviewer found only two discrimination gaps: no same-count replacement/detachment plus derived/purpose mutation tests after decode, and cleanup tests did not seed stale final/temp artifacts across barrier, browser, resolver, validator, and rename failures.
- **Impact:** reviewed production behavior remains promising but cannot advance; the remote stays frozen and no provider run starts.
- **Root cause:** tests covered count loss, source mutation, and selected publication failures but did not mutate every identity attribute at constant cardinality or exercise cleanup from pre-existing artifacts at every failure boundary.
- **Unblock/workaround:** a new local-only Sol TDD turn must add the missing same-count identity mutations and a table-driven stale final/temp cleanup matrix, rerun focused and full gates, then receive another fresh read-only review.
- **Durable fix/tracker:** fail-closed evidence tests must vary identity independently of cardinality and begin failure-path tests from dirty filesystem state; clean-state-only cleanup tests are insufficient.
- **Status:** BLOCKING on test discrimination only; no Git, remote, or Actions mutation.

### 2026-07-15 · Wave 2A — #413 exact-head provider traversal found zero candidate images

- **Symptom:** exact-head provider run [29345311385](https://github.com/limweili/eido/actions/runs/29345311385) failed its bounded one-traversal probe after 60 seconds; repeated capture and report steps were correctly skipped.
- **Detection evidence:** at reviewed head `4141c1df09521141f87be4c9492069cd5b377e77`, diagnostics reported candidate runtime present/enabled, 131 detail nodes and zero overview cards, but `candidateImageCount=0` and `readyCandidateImageCount=0`; console and page error buffers were empty. The original `page.waitForFunction` timeout was preserved as cause, and the failure artifact was retained.
- **Impact:** provider evidence is red/disqualified and cannot support #413; no report, PR, or architecture conclusion may advance from this run.
- **Root cause:** not yet proven. App/runtime startup and Reading detail readiness now succeed, but the candidate image selector/fixture/rendering path produces no matching candidate images under the provider.
- **Unblock/workaround:** freeze the reviewed head, inspect the diagnostic artifact and exact fixture/selector/render path, add a discriminating local test for the proven zero-image condition, and require fresh review before one bounded rerun; do not widen timeouts or retry unchanged.
- **Durable fix/tracker:** candidate readiness contracts must separately prove runtime enablement, detailed-card rendering, and exact asset-selector population so a leaf rendering/selector mismatch fails fast with staged diagnostics.
- **Status:** active diagnosing red; no mutation or rerun authorized yet.

### 2026-07-15 · Wave 2A — #403 evidence review disqualified a green provider artifact

- **Symptom:** fresh read-only evidence/report review `019f6137-92c7-7ad0-9d58-43087cd5af11` returned BLOCKING even though provider run 29343847701 and the local report gates were green.
- **Detection evidence:** the reviewer found a HIGH runtime defect in `Board.tsx`: hover activation ignored `decision.pin` and had no leave-release path, so stale live owners could contaminate provider DOM/memory evidence. It also found a HIGH comparator defect—canonical #402 style total `4147.35` was rendered as `4147.3` by summing rounded scenario values instead of aggregating raw once—plus omitted dragging/connecting readiness regressions and no explicit statement that #406 owns the architecture decision.
- **Impact:** run 29343847701 and artifact 8315286958 are disqualified for acceptance despite successful execution; the raw/report files remain uncommitted and preserved only for diagnosis. A runtime change requires fresh exact-head provider evidence.
- **Root cause:** implementation review concentrated on identity stability and interaction choreography but did not mutation-test the hover pin lifecycle; report generation reused display-rounded intermediates and the narrative review did not enumerate every material regression or decision boundary.
- **Unblock/workaround:** a new local-only Sol TDD turn must honor `decision.pin`, release stale hover ownership, prove the lifecycle with a discriminating RED, aggregate raw values once before formatting, name the dragging/connecting regressions, and assign final selection explicitly to #406. Then require fresh review and a new exact-head provider run before evidence reintegration.
- **Durable fix/tracker:** performance acceptance must combine runtime lifecycle mutation tests with raw-first aggregation invariants; a green benchmark is invalid when the measured runtime has a known state leak or the report is derived from display-rounded intermediates.
- **Status:** BLOCKING; existing artifact/report disqualified, branch frozen, no new provider run authorized.

### 2026-07-15 · Wave 2A — #413 provider red traced to a malformed synthetic PNG

- **Symptom:** the exact-head provider reached all nine fixture asset names through `CardAssets` but never produced nine derived candidate images.
- **Detection evidence:** read-only diagnosis `019f613f-cc58-7a61-a751-5cbea7dc6ad4` computed the fixture PNG's IDAT CRC as `fd50c552` versus stored `5fc5af19` and found an invalid zlib stream. The native resolver therefore correctly caught decoding failure and returned `derived:false`; the readiness gate requires exactly nine `derived:true` images. The artifact independently showed the runtime enabled and every asset name reaching the render path.
- **Impact:** run 29345311385 remains red/disqualified, but the failure is now deterministic and localized to privacy-safe synthetic input rather than production image residency behavior.
- **Root cause:** the benchmark fixture validated filename/type shape but not the structural integrity of its embedded PNG bytes, allowing a corrupt image to enter a gate whose success requires native derivation.
- **Unblock/workaround:** add a public-seam fixture regression that validates PNG chunk CRCs and inflates the combined IDAT stream, prove the existing fixture RED, replace it with a valid deterministic privacy-safe PNG, and rerun all gates plus fresh review before one bounded provider retry.
- **Durable fix/tracker:** synthetic binary fixtures must be structurally decoded or checksum-validated at their public fixture seam; base64 shape and MIME labels are not sufficient evidence of validity.
- **Status:** root cause proven read-only; no edit or provider rerun yet while the diagnosis completes its SVG/diagnostic-contract check.

### 2026-07-15 · Wave 2A — Canonical PNG fixture repair split into non-blocking #420

- **Symptom:** the malformed PNG belongs to the frozen canonical #402 fixture, but #413 explicitly forbids mutating `perfFixtures` and must not rewrite benchmark provenance.
- **Detection evidence:** duplicate search across open issues, including #417 and #419, found no existing CRC/IDAT fixture repair; [issue #420](https://github.com/limweili/eido/issues/420) now records the privacy-safe reproduction and canonical test/repair request.
- **Impact:** #413 can continue with an owned candidate adapter while the canonical fixture repair remains independently tracked; no blocking edge was added.
- **Root cause:** cross-lane ownership correctly prevents a candidate from silently repairing its benchmark source, so the canonical defect needs a separate tracker owner.
- **Unblock/workaround:** preserve the frozen #402 bytes in #413 and use only its registered adapter scope; #420 owns CRC/inflate validation and replacement of the canonical synthetic PNG.
- **Durable fix/tracker:** [#420](https://github.com/limweili/eido/issues/420) — validate and repair the canonical synthetic PNG performance fixture.
- **Status:** filed, non-blocking, no duplicate found.

### 2026-07-15 · Wave 2A — #403 rounding regression test hit binary half-decimal ambiguity

- **Symptom:** the targeted raw-once comparator test used `2700.15`, but JavaScript `toFixed(1)` rendered it as `2700.1` rather than the intuitively expected `2700.2`.
- **Detection evidence:** the comparator RED exposed the mismatch while the worker was separating raw aggregation from display rounding; no production or provider state moved.
- **Impact:** the test could encode an accidental IEEE-754 representation artifact instead of the intended aggregate-once invariant.
- **Root cause:** decimal `2700.15` is not represented as an exact binary half value, so native formatting does not provide the human decimal tie behavior assumed by the fixture.
- **Unblock/workaround:** choose test inputs that discriminate sum-of-rounded from round-once without depending on an inexact half tie, and keep the implementation contract explicit about aggregation before formatting.
- **Durable fix/tracker:** numeric report tests should avoid binary-ambiguous decimal ties unless the production requirement explicitly defines a decimal rounding algorithm and tests that algorithm directly.
- **Status:** active local correction; invalid evidence and remote remain frozen.

### 2026-07-15 · Wave 2A — #413 candidate adapter draft renamed fixture assets

- **Symptom:** the first candidate-owned valid-raster adapter draft changed an asset name while replacing only the malformed/reference bytes.
- **Detection evidence:** supervisor contract review caught the rename before any GREEN claim; the registered repair requires IDs, dimensions, card topology, content, names, and non-reference metadata to remain stable.
- **Impact:** no accepted test or provider state was affected, but an unchecked adapter could have changed fixture semantics while claiming only a binary-validity repair.
- **Root cause:** the adapter implementation treated a synthetic filename as disposable generation metadata rather than part of the preserved benchmark content contract.
- **Unblock/workaround:** preserve every asset name and all non-reference metadata exactly, clone only owned cards/refs, and make the validator assert identity/content preservation alongside raster integrity.
- **Durable fix/tracker:** fixture adapters must define and test an explicit semantic checksum—IDs, names, dimensions, ownership, ordering/topology, and non-reference metadata—not only binary validity.
- **Status:** caught pre-GREEN; correction active locally, canonical fixture and remote untouched.

### 2026-07-15 · Wave 2A — #413 npm 10 gate reused a root-owned cache

- **Symptom:** the first exact npm 10 gate attempt failed with `EPERM` while writing under `~/.npm`.
- **Detection evidence:** focused candidate/resolver/CardAssets tests were GREEN 28/28, typecheck was GREEN, and the failure occurred in the package-manager cache before any code gate; the lane contract already provides an isolated `/tmp` cache.
- **Impact:** no code red or provider evidence; minor gate delay only.
- **Root cause:** the continuation invoked npm 10 without inheriting the worker contract's isolated cache environment, so it reused root-owned cache entries.
- **Unblock/workaround:** rerun unchanged with the registered isolated `/tmp` npm cache and classify the first attempt as environmental, not green or code red.
- **Durable fix/tracker:** encode the isolated cache path in reusable gate commands/environment rather than relying on each continuation to remember it.
- **Status:** contained; isolated-cache rerun pending, remote and canonical fixture untouched.

### 2026-07-15 · Wave 2A — #403 merged, exact-main verified, and cleaned

- **Symptom:** #403 reached its serialized merge gate after final exact-head Required, browser, residency evidence, and official Opus 4.8 review all passed.
- **Detection evidence:** PR [#421](https://github.com/limweili/eido/pull/421) squash-merged as `b72316f996a274475b95aff9277dd1b19437efb0`; exact-main [CI run 29353338347](https://github.com/limweili/eido/actions/runs/29353338347) / Required job `87154764674` completed success, and release artifact `8319113242` (`eido-main-b72316f996a274475b95aff9277dd1b19437efb0`) is unexpired with matching main SHA and digest `sha256:ad24b6147f8a8bdebb7340087e0170acd64e14b709ad91f7270bfd45d246e398`. Issue #403 closed completed.
- **Impact:** the strict-residency candidate evidence is now on main and unblocks its downstream comparison role; no other PR was merged.
- **Root cause:** not a failure entry—the merge captain serialized the one-PR train and required exact-main proof before cleanup.
- **Unblock/workaround:** after confirming no open PR depended on the feature branch, remove the clean dedicated worktree and delete the local and remote `codex/epic-410-403-residency` branches. The founder's canonical checkout remained untouched because it is dirty at `5b8cb813…` with untracked `research/prototype/`.
- **Durable fix/tracker:** exact-main Required plus release artifact remains the production proof; a dirty canonical checkout is reported as an explicit local-production gap, never overwritten during cleanup.
- **Status:** merged/main-verified/tracker-closed/branch-and-worktree-cleaned; canonical sync intentionally absent.

### 2026-07-15 · Wave 2A — Preserve #403 limitations as #406 decision inputs

- **Symptom:** a successful candidate merge could otherwise make non-blocking limitations disappear before #406 compares architectures.
- **Detection evidence:** final Opus review and candidate source/report leave three explicit bounds: unbounded live-owner/select-all sets can exceed the passive 540-Card cap; below-Reading operation still performs spatial queries; and the branch-specific residency evidence workflow becomes inert once its feature branch is deleted.
- **Impact:** none blocks #403, but each affects how #406 interprets scalability, steady-state work, and evidence reproducibility.
- **Root cause:** candidate-specific implementation and workflow constraints are not equivalent to a selected production renderer architecture.
- **Unblock/workaround:** carry all three into #406's evidence comparison and final decision record; do not infer a passive-renderer selection from #403.
- **Durable fix/tracker:** registry ledger entry `decision-inputs` / source issue #403; #406 remains the sole selection owner.
- **Status:** retained for #406 before and after merge.

### 2026-07-15 · Wave 2A — #413 probe passed but repeated capture left one rendition deferred

- **Symptom:** exact-head provider run [29350517083](https://github.com/limweili/eido/actions/runs/29350517083) passed the bounded traversal probe, then timed out during repeated capture with nine purpose-marked and decoded images but only eight derived renditions; one image remained `deferred`.
- **Detection evidence:** head `90f1ae3910ca2fa542d6b19f55679b5f13a744aa` reported `purposeMarked=9`, `derived=8`, `decodedReady=9`, zero resolver/browser errors, and 27 passive plus 9 active requests before the 90-second readiness failure. Report generation was skipped and the diagnostic artifact was preserved.
- **Impact:** the structurally valid candidate raster adapter cleared the prior zero-image defect, but the repeated capture remained red/disqualified and could not produce architecture evidence.
- **Root cause:** repeated traversal still required every purpose-marked image to be derived, even when visibility-aware residency correctly left an image outside the active preload range on its authoritative fallback.
- **Unblock/workaround:** replace exact-nine derivation readiness during repeated traversal with a fail-closed predicate: all nine images must remain decoded/nonblank, resolver failures must remain zero, and every image actually within the candidate's buffered observer range must be derived.
- **Durable fix/tracker:** candidate measurement gates must distinguish nonblank authoritative fallback from required derived-rendition residency; visibility-aware candidates cannot use whole-fixture derivation counts as a readiness proxy.
- **Status:** diagnosed and corrected locally; run remains red/disqualified.

### 2026-07-15 · Wave 2A — Manual geometry did not match IntersectionObserver range semantics

- **Symptom:** provider run [29352350376](https://github.com/limweili/eido/actions/runs/29352350376) again passed the bounded probe but timed out during repeated capture with eight derived and one deferred image after the first range-aware correction.
- **Detection evidence:** old-base head `a9cbd95890c66429ad84242ba6e32b59d2fe2cb5` reported nine purpose-marked/decoded images, one deferred image, zero resolver/browser errors, and 52 passive plus 36 active requests. The push-triggered duplicate run 29352342862 was cancelled by concurrency when the intentional manual dispatch started; it is absent proof.
- **Impact:** a second capture was disqualified and the report remained unavailable; the duplicate trigger consumed only startup seconds but demonstrated avoidable workflow churn.
- **Root cause:** the harness inferred buffered visibility from `getBoundingClientRect()` against an expanded viewport. That approximation can mark an ancestor-clipped image in range even though production's `IntersectionObserver` with `rootMargin: 320px` correctly treats it as out of range.
- **Unblock/workaround:** collect initial observer evidence for every one of the nine targets using the exact `root: null` / `rootMargin: 320px` contract, disconnect deterministically, and base the repeated-readiness predicate on that evidence. Terra reviews `019f618c-7cda-7233-9edf-c77c17999ec3` and `019f619d-929e-7760-a366-cc098c14d884` passed the geometry and observer-contract corrections.
- **Durable fix/tracker:** performance harnesses must observe the production visibility primitive rather than reimplementing its geometry; avoid manually dispatching a same-head workflow while its push trigger is still starting.
- **Status:** corrected and independently reviewed; both earlier runs remain red/disqualified.

### 2026-07-15 · Wave 2A — Broad review attempts timed out without a verdict

- **Symptom:** broad cross-validation attempts `019f6185-387b-79f0-bfa3-8d1fea8f2a02` and local session `22193` timed out or ended without an actionable final verdict.
- **Detection evidence:** neither session supplied a complete PASS/BLOCKING report tied to the exact diff; no output was promoted into acceptance evidence.
- **Impact:** review latency increased, but no unreviewed change was accepted or pushed on the strength of partial output.
- **Root cause:** review scope combined a large accumulated candidate diff, evidence harness semantics, and failure-path analysis in one turn.
- **Unblock/workaround:** route bounded causal deltas to fresh Terra/Sol reviewers, then require one fresh full exact-head Sol review after rebase. Fable 5 was not used and remains prohibited.
- **Durable fix/tracker:** split diagnosis reviews by causal delta and reserve the broad review for a stable exact head; absence or timeout is never green.
- **Status:** unblocked with narrower completed reviews; timed-out sessions remain absent proof.

### 2026-07-15 · Wave 2A — #413 observer proof initially sampled failures too early

- **Symptom:** late-failure review `019f61a4-f4f1-71c3-a225-dfb18cd13199` blocked the first observer-evidence implementation even after the geometry/root-margin reviews passed.
- **Detection evidence:** the runtime snapshot and resolver-failure count could be read before all initial IntersectionObserver callbacks arrived, allowing a late resolver failure to escape the sampled acceptance boundary.
- **Impact:** the branch could not advance to rebase or provider capture despite green focused mechanics.
- **Root cause:** asynchronous range evidence and fail-closed runtime state were sampled in different phases instead of one ordered observation transaction.
- **Unblock/workaround:** await one initial observer result for every current image, ignore callbacks after completion, then sample the runtime snapshot, disconnect in `finally`, and add mutation-sensitive late-failure/observe-rejection tests. Final IO review `019f61a8-ffb8-7943-82ab-46b4b71b64c1` returned PASS with zero blockers.
- **Durable fix/tracker:** asynchronous evidence gates must define ordering explicitly: observe complete target set, sample causal failure state, disconnect/clean up, then evaluate readiness.
- **Status:** resolved and reviewed on the old base.

### 2026-07-15 · Wave 2A — #413 rebased cleanly after #403 changed main

- **Symptom:** #413's reviewed old-base head `92ae2c0…` no longer included current main after #403 merged as `b72316f…`, so its prior head review could not satisfy the new SOP's current-main requirement.
- **Detection evidence:** Terra rebase session `019f61ab-05c4-7283-be2f-4269dd8dc9c0` replayed the six #413 commits onto `b72316f996a274475b95aff9277dd1b19437efb0`, producing `58e297d22e57c688d8453f036aa6f3e0da4227a5`; no conflicts occurred and the clean branch was updated with `--force-with-lease`.
- **Impact:** commit SHAs changed, so old-head evidence could not be treated as current-head proof; no product, architecture, or storage conflict required escalation.
- **Root cause:** intentional serialized landing of #403 advanced main while the independent image candidate was still under review.
- **Unblock/workaround:** rebase only after preserving a clean tree, run the post-rebase canonical gate GREEN across 107 files / 1,157 tests, and obtain fresh full Sol/high review `019f61ac-8b77-7173-a36a-bb6bb891805c` PASS on exact head `58e297d…`.
- **Durable fix/tracker:** every long candidate lane must treat a sibling merge as an evidence boundary: clean rebase, `--force-with-lease`, canonical gate, fresh exact-head review, then provider proof.
- **Status:** resolved; exact rebased provider run active.

### 2026-07-15 · Wave 2A — #413 exact rebased capture reached the expensive evidence phase

- **Symptom:** not a failure; the first reviewed current-main provider attempt needed explicit state recording so an in-progress capture could not be mistaken for green.
- **Detection evidence:** run [29354170706](https://github.com/limweili/eido/actions/runs/29354170706), exact head `58e297d22e57c688d8453f036aa6f3e0da4227a5`, completed install, focused verification, and the bounded traversal probe successfully; repeated candidate capture remained in progress at this checkpoint.
- **Impact:** #413 still has no accepted artifact/report/PR while the expensive phase runs; #404 may continue in its disjoint worktree.
- **Root cause:** none—this is the required probe-before-capture sequence after reviewed rebase.
- **Unblock/workaround:** monitor the existing run without duplicate dispatch; accept only a successful report/artifact tied to the exact rebased head, followed by the remaining PR gates and authorized review route.
- **Durable fix/tracker:** registry records step-level provider state, not only workflow status; `in_progress` is never green.
- **Status:** active at checkpoint; no Fable review used or authorized.

### 2026-07-15 · Wave 2B — #404's first RED was missing dependencies, not behavior

- **Symptom:** the fresh #404 worktree's first targeted Vitest attempt could not start because `node_modules` was absent; a subsequent npm wrapper also encountered the known root-owned global cache.
- **Detection evidence:** the test runner failed before loading the candidate assertion, and npm cache access failed under `~/.npm`; neither failure exercised Card content visibility.
- **Impact:** neither setup failure could count as TDD RED evidence, but no code or lockfile was lost.
- **Root cause:** worktree bootstrap still does not install dependencies, and the host-global npm cache remains partly root-owned.
- **Unblock/workaround:** install with npm 10 using isolated `/tmp/eido-npm-cache-404`, preserve the lockfile, then rerun the unchanged targeted test under Node 20.
- **Durable fix/tracker:** make Node 20/npm 10 plus a writable per-worktree cache and dependency install a mechanical worktree-bootstrap step before RED proof.
- **Status:** setup unblocked; false RED discarded.

### 2026-07-15 · Wave 2B — #404 established a real content-visibility RED

- **Symptom:** with the default-off candidate explicitly enabled, a passive long Note did not expose the required content-visibility body or browser-skippable chunks.
- **Detection evidence:** `CardContentVisibility.test.tsx:78` expected `[data-card-content-visibility]` but received `null` at base `b72316f996a274475b95aff9277dd1b19437efb0`; the corrected Node 20/npm 10 test reached the intended assertion.
- **Impact:** #404 now has a discriminating behavioral guard and may implement the smallest within-Card candidate without confusing infrastructure failure with product RED.
- **Root cause:** current main has strict whole-Card residency from #403 but no within-Card content-visibility/virtualization seam.
- **Unblock/workaround:** continue only in the registered #404 scope, preserving #403's residency authority, production default, Card geometry, interaction, copy/search/accessibility, and synthetic-only evidence contract.
- **Durable fix/tracker:** registry retains the exact command, expected behavior, observed assertion, base SHA, and discarded-infra note.
- **Status:** behavioral RED confirmed; local implementation active and uncommitted.

### 2026-07-15 · Wave 2B — #405 was deliberately serialized behind #404

- **Symptom:** #405 is logically ready after #402, but its cached-passive prototype shares `Board.tsx`, controlled-node identity, Card surfaces, and candidate styling concerns with active #404 work.
- **Detection evidence:** final file-scope preflight found overlap with #404's Board/Card/content surfaces even though the two issues are logically independent candidates.
- **Impact:** dispatching #405 now would violate the epic's disjoint-file wave contract, create a stale-base rebase problem, and weaken attribution of candidate evidence.
- **Root cause:** tracker dependency independence does not imply file-level parallel safety.
- **Unblock/workaround:** keep #405 without a worktree, branch, or worker until #404 lands and exact main is re-derived; then dispatch it as the serialized successor with a fresh scope and Sol implementation route.
- **Durable fix/tracker:** registry carries #405's provisional owned/forbidden surfaces and explicit `blocked-by-wave-serialization-404` state; #406 remains blocked until #405 completes.
- **Status:** intentionally blocked by wave serialization, not by CI or an unresolved product decision.

### 2026-07-15 · Wave 2A — #413 gallery click sat under the fixture topbar for 15 minutes

- **Symptom:** reviewed current-main provider run [29354170706](https://github.com/limweili/eido/actions/runs/29354170706) passed the contract suite, bounded probe, and six repeated traversals, then consumed the remaining 15-minute test timeout trying to open the alpha Card's gallery.
- **Detection evidence:** exact head `58e297d22e57c688d8453f036aa6f3e0da4227a5` reached `measureGallery` line 645; Playwright resolved a visible/enabled/stable `.asset-image-open` button but retried because `.topbar` / its `Performance fixture` label intercepted pointer events 414 times. Capture failed, report generation skipped, and diagnostic artifact `8319855517` was retained. Atomic publication correctly emitted no raw/report evidence.
- **Impact:** the run is red/disqualified and spent about 15 provider minutes after otherwise successful traversal; #413 still has no acceptable evidence or PR.
- **Root cause:** gallery choreography allowed Playwright's scroll-into-view to place the real button beneath the fixed fixture topbar, while the outer test timeout—not a bounded gallery-step timeout—owned the retry loop.
- **Unblock/workaround:** use a harness-only Terra correction that repositions the target below the topbar, performs real hover/focus and one actual user click, and keeps the existing gallery-ready assertions. Do not force-click, DOM-click, widen the timeout, or change product code. Rerun focused/full gates, obtain fresh review, then launch one new bounded provider attempt.
- **Durable fix/tracker:** every physical-click choreography step must assert an unobscured hit point and own a short causal timeout before expensive capture; provider progress should report the last completed traversal/interaction.
- **Status:** diagnosed harness RED; no raw/report accepted, product behavior unchanged, Fable remains prohibited.

### 2026-07-15 · Wave 2B — Repeated setup friction and report drift became owned follow-ups

- **Symptom:** several resolved workarounds still had no durable tracker owner: worktrees lacked pinned tools/dependencies/indexes/writable caches and could hide index bits, while checked-in performance reports were not mechanically compared with their raw artifacts by Required CI.
- **Detection evidence:** duplicate searches across open/closed issues found no worktree-bootstrap or report-drift issue; #417 owns load-sensitive controls, #419 owns exact-main workflow/artifact waiting, and #420 owns the malformed canonical PNG, so none covered these surfaces.
- **Impact:** without follow-ups, later epics could repeat false setup REDs, read-only review failures, graph-index gaps, hidden-worktree ambiguity, or silently stale reports.
- **Root cause:** the DevOps SOP standardized merge gates but did not yet standardize isolated agent-worktree bootstrap or deterministic checked-in report reproduction.
- **Unblock/workaround:** filed non-blocking [#422](https://github.com/limweili/eido/issues/422) for CI-pinned worktree bootstrap, writable caches, graph indexing, and hidden-index-bit checks; filed non-blocking [#423](https://github.com/limweili/eido/issues/423) for a non-mutating Required-CI report drift guard.
- **Durable fix/tracker:** #422 and #423; neither adds a blocking edge to #410 candidate delivery.
- **Status:** filed, non-duplicate, non-blocking.

### 2026-07-15 · Wave 2A — #413 gallery choreography now fails fast and clears the topbar

- **Symptom:** the previous gallery interaction could burn the entire 15-minute capture timeout when Playwright scrolled the button beneath the fixed topbar.
- **Detection evidence:** Terra session `019f61c0-67c4-7332-bdde-e6a510dbaa17` first replayed the original physical-click path and reproduced a fast causal failure, then made the smallest harness-only correction. The corrected full six-traversal path used focus preactivation plus a real locator click and completed gallery interaction in about 6 seconds; 33/33 focused tests and `ci:required` across 107 files / 1,160 tests were GREEN.
- **Impact:** gallery failures now stop in 5 seconds with geometry diagnostics instead of consuming the outer 15-minute test timeout; no product path, timeout ceiling, or evidence schema changed.
- **Root cause:** fixed by moving the camera only when the gallery affordance's hit point does not clear the measured topbar, waiting two frames, rechecking clearance, and retaining the normal physical click.
- **Unblock/workaround:** no force click, DOM click, timeout widening, or production mutation was used. Fresh Sol/high review `019f61c6-b1e2-7872-9e07-642e44ffa35a` returned PASS; supervisor committed/pushed exact head `178a41217d3d43bc12f7ea4b6a739c762db2a5e7` from reviewed `58e297d…` on unchanged main `b72316f…`.
- **Durable fix/tracker:** keep interaction-specific timeouts and unobscured-hit-point geometry in provider choreography while preserving real hover/focus/click semantics.
- **Status:** local RED→GREEN, full gates, and fresh review complete; new exact-head provider run active.

### 2026-07-15 · Wave 2A — #413 provider rerun started only after the reviewed harness fix

- **Symptom:** not a failure; the prior unreviewed-push friction required proof that the next provider attempt respected the external review boundary.
- **Detection evidence:** run [29356029890](https://github.com/limweili/eido/actions/runs/29356029890) started from push head `178a41217d3d43bc12f7ea4b6a739c762db2a5e7` only after Sol PASS. Install and focused contract verification completed; the bounded probe was in progress at this checkpoint.
- **Impact:** no duplicate provider run, PR, report, or acceptance claim exists while the workflow runs.
- **Root cause:** none—this is the corrected supervisor-push sequence.
- **Unblock/workaround:** monitor the existing run; require probe, repeated capture, report regeneration, and artifact provenance to finish on this exact head before advancing.
- **Durable fix/tracker:** registry preserves code review, pushed head, and step-level provider state as separate gates.
- **Status:** active; in-progress is not green and Fable remains prohibited.

### 2026-07-15 · Wave 2B — #404 reached local green without publishing its dirty worktree

- **Symptom:** after the real content-visibility RED, the candidate needed to prove it could cover all owned Card/body/report surfaces without crossing into #403 residency or #413 image ownership.
- **Detection evidence:** the isolated #404 worktree contains exactly 20 modified/untracked owned files; 21 focused tests and `ci:required` across 106 files / 1,125 tests are GREEN. HEAD remains base `b72316f996a274475b95aff9277dd1b19437efb0`, with no commit, push, PR, or provider run.
- **Impact:** implementation is ready for adversarial full-diff inspection, but local green alone cannot become acceptance evidence.
- **Root cause:** resolved incrementally inside the registered content-visibility/Card scope; no infrastructure workaround or product decision is pending at this checkpoint.
- **Unblock/workaround:** freeze the complete dirty diff for a fresh full-scope review, repair any blocker locally, and permit supervisor commit/push only after PASS.
- **Durable fix/tracker:** keep local dirty diff, review verdict, pushed head, provider evidence, and PR gates distinct in the registry.
- **Status:** local implementation/gates GREEN; fresh full-diff review pending, no remote mutation.

### 2026-07-15 · Wave 2A — #413 reviewed gallery fix produced a complete provider artifact

- **Symptom:** not a failure; the just-recorded in-progress run completed while this checkpoint was being reconciled, so success must remain separate from evidence acceptance.
- **Detection evidence:** exact-head run [29356029890](https://github.com/limweili/eido/actions/runs/29356029890) completed success at `178a41217d3d43bc12f7ea4b6a739c762db2a5e7`: bounded probe, repeated capture, deterministic report regeneration, and artifact preservation all passed. Artifact `8320180125`, `image-rendition-candidate-178a41217d3d43bc12f7ea4b6a739c762db2a5e7`, is unexpired, 80,146 bytes, digest `sha256:ed14e1730c93823ea283324a1e1a0b805bee091df6ab3ba736edfc974ff7c726`.
- **Impact:** provider execution is green, but raw/report provenance, privacy, schema, arithmetic, claim fidelity, and exact byte integration still require independent validation; no PR or architecture decision follows yet.
- **Root cause:** none—the harness-only gallery correction removed the last observed choreography blocker on this head.
- **Unblock/workaround:** freeze the successful artifact and head, integrate/validate its raw/report bytes without altering them, run docs/full gates, and require fresh evidence review before any PR acceptance.
- **Durable fix/tracker:** provider workflow success and evidence acceptance remain separate registry states.
- **Status:** provider GREEN; evidence integration/validation pending, not yet accepted.

### 2026-07-15 · Wave 2A — #413 artifact integrity passed, but storage ROI and architecture remain unresolved

- **Symptom:** a green provider artifact could still be over-interpreted as an image/storage or architecture decision before its exact bytes and measurement limits were checked.
- **Detection evidence:** artifact `8320180125` from run 29356029890 contains six traversals with zero resolver failures and zero blank frames; raw SHA-256 is `a63a4de3d989f565161d91c50a4ccaf2fa8dfb430abe8723fcb952e840330b11`, report SHA-256 is `3f70e174292109c469af4c32d2fe6cfd0b14de1977d6a92ea266b25d7448aa3f`. Independent regeneration was byte-identical, and privacy/schema/exact-head provenance checks passed.
- **Impact:** the artifact is qualified for adversarial evidence review, but it does not yet authorize a PR claim or choose the renderer/residency/image architecture.
- **Root cause:** the candidate deliberately measures runtime rendition behavior without a full asset-to-blob migration or a controlled storage experiment; storage impact is therefore unmeasured/confounded by design.
- **Unblock/workaround:** preserve the bounded facts without winner language: peak decoded residency 7.34 MiB / 8 images; peak derived-rendition residency 0.014 MiB / 2 entries; 49 evictions and 49 revocations; cold readiness median 286.2 ms; warm median 589.4 ms; gallery readiness 2,004.5 ms; maximum rendered bounds 380×450; zero offscreen sharper renditions. Fresh Sol/high evidence review `019f61cb-8c96-7bb2-8264-59d97d2f8fb6` must test provenance, arithmetic, claim fidelity, and limitations.
- **Durable fix/tracker:** #406 alone compares candidate evidence and selects architecture; #408 owns cold-data ROI. A candidate report must name counterintuitive or slower warm/gallery measurements and cannot infer storage savings from runtime rendition residency.
- **Status:** artifact integrity/privacy/schema/provenance PASS; adversarial evidence review active, architecture and storage ROI undecided.

### 2026-07-15 · Wave 2A — #413 artifact passed adversarial evidence review without choosing architecture

- **Symptom:** provider and integrity greens still required an independent check that the report did not overstate runtime, storage, or architecture conclusions.
- **Detection evidence:** fresh Sol/high session `019f61cb-8c96-7bb2-8264-59d97d2f8fb6` returned PASS on the exact artifact provenance/bytes, regeneration, privacy/schema, arithmetic, claim fidelity, counterintuitive warm/gallery results, limitations, and #406/#408 decision boundaries.
- **Impact:** #413 may proceed to controlled evidence publication and PR gates, but it is not merged and no architecture or cold-data decision is selected.
- **Root cause:** none—the review gate confirmed the bounded report semantics after the earlier harness repairs.
- **Unblock/workaround:** publish only the reviewed exact-head raw/report bytes, rerun current-head required gates, open the PR, wait for Required plus canaries, and obtain fresh Opus 4.8 final review before merge-captain handoff.
- **Durable fix/tracker:** keep evidence review distinct from final PR review and production verification; Fable is not an allowed substitute.
- **Status:** evidence review PASS; publication/PR/Opus/merge pending.

### 2026-07-15 · Wave 2B — #404 green local gates hid six review blocker groups

- **Symptom:** the 20-file #404 candidate passed focused/full local mechanics, but its evidence path could still publish or validate false/partial results and duplicated a large benchmark harness.
- **Detection evidence:** fresh standards review `019f61cb-2c5c-71b0-bfe6-b2030f46f118` and spec review `019f61cb-2c83-70f1-8188-97909781caf2` both returned BLOCKING. Together they identified six groups: provider probe failure could be bypassed by later steps; checked-in placeholder raw/report data could appear green; publication/upload was non-atomic and could retain partial evidence; correctness/blank-region probes were not mutation-falsifiable; run/job/digest lineage was absent; and the candidate duplicated about 1,248 lines of benchmark choreography.
- **Impact:** local GREEN is insufficient; #404 remains uncommitted/unpushed with no provider evidence or PR, and #405 stays serialized behind it.
- **Root cause:** implementation concentrated on content-visibility behavior and metric coverage while re-creating the benchmark/evidence shell without inheriting the fail-closed, atomic, provenance-rich lessons already learned in #402/#403/#413.
- **Unblock/workaround:** keep the remote frozen and dispatch one fresh Sol TDD correction over the complete dirty diff: make probe failure gate every expensive/publishing step; reject placeholders; publish only complete validated raw/report atomically and clean partial state; add mutations that make correctness/blank probes fail; record exact run/job/head/digests; and extract a bounded shared candidate harness seam without crossing frozen #402 ownership.
- **Durable fix/tracker:** every candidate dispatch must inherit the current fail-closed evidence transaction contract and should reuse a tested harness seam instead of copying benchmark choreography; green mechanics never override adversarial review.
- **Status:** BLOCKING locally on six grouped findings; fresh Sol repair required, remote frozen, Fable not used or permitted.

### 2026-07-15 · Wave 2A — #413 PR opened before reviewed evidence bytes were published

- **Symptom:** PR [#424](https://github.com/limweili/eido/pull/424) opened cleanly at reviewed code head `178a41217d3d43bc12f7ea4b6a739c762db2a5e7`, but the qualified raw/report bytes existed only in provider artifact `8320180125`, not in the branch; the expected research narrative also needed audit at issue-owned path `16`.
- **Detection evidence:** publication audit found no committed candidate raw/report at the PR head. The supervisor initially checked residency document `15`, copied from the adjacent #403 lane, then corrected to `research/03-performance-architecture/16-image-rendition-candidate.md`. Old-head Required run 29356579794 and Browser canary run 29356579853 are green, but they test the incomplete publication head.
- **Impact:** the PR is open but held; external-only evidence and old-head greens cannot satisfy reproducibility or final review, and no Opus/merge handoff is allowed.
- **Root cause:** PR creation occurred after code/evidence review but before the separate publication step integrated exact reviewed bytes and the owned narrative path; the doc audit reused a neighboring lane number instead of the registry contract.
- **Unblock/workaround:** add one evidence-only commit containing the byte-exact reviewed raw/report and issue-owned research doc `16`, verify deterministic regeneration/privacy/schema/provenance again, run full current-head gates and evidence review, then wait for new-head Required/canaries and fresh Opus 4.8. Treat every old-head check as superseded.
- **Durable fix/tracker:** pre-PR publication checklist must prove all owned evidence artifacts and the registry-named research path are committed; never infer numbered research paths from an adjacent candidate.
- **Status:** publication audit BLOCKING; PR #424 held open, no Opus or merge, Fable prohibited.

### 2026-07-15 · Wave 2A — #413 evidence retention test could pass on dead source strings

- **Symptom:** the evidence-only publication diff preserved exact reviewed bytes, scope, and hashes, but its retention test could remain green if slot-16/order strings survived only in dead or commented source.
- **Detection evidence:** fresh review `019f61d6-74e6-76b3-94aa-4ea0003610f0` returned FAIL with one MEDIUM blocker: the source-substring/index path contract was fail-open. Exact raw/report hashes, research-doc scope, and all other publication checks passed.
- **Impact:** PR #424 remains held at old head `178a412…`; the dirty evidence publication diff cannot be committed/pushed or used to refresh Required/Opus until the behavioral retention contract passes review.
- **Root cause:** the test inspected implementation text/order tokens rather than executing the default publication path and observing retained files/ordering.
- **Unblock/workaround:** add a narrow temp-directory TDD test that invokes the default path behavior, proves the expected slot-16/order outputs are actually retained, and fails when the live path is removed even if matching strings remain dead/commented; rerun focused/full gates and a new fresh review.
- **Durable fix/tracker:** retention/publication contracts must test filesystem behavior and exact bytes, never source substrings as a proxy for execution.
- **Status:** one MEDIUM blocker; exact evidence remains preserved locally, PR held, no Opus or merge.

### 2026-07-15 · Wave 2B — #404 discarded a remediation session that left browser state open

- **Symptom:** the first remediation attempt, session `019f61cf-95d4-7b22-a796-51fe51a66ef8`, ended after its prompt left browser state open instead of completing the bounded local-only repair contract.
- **Detection evidence:** supervisor inspection found no usable edits, RED/GREEN evidence, Git mutation, provider run, or review verdict from that session.
- **Impact:** short restart delay only; no partial work or browser result was accepted.
- **Root cause:** the worker turn did not terminate/contain an incidental browser interaction before handing back the remediation checkpoint.
- **Unblock/workaround:** discard the session entirely and start fresh Sol session `019f61d0-2dd7-7b31-a77a-3756fff55cf6` with browser/Git/remote/Fable explicitly forbidden.
- **Durable fix/tracker:** local evidence-harness remediation briefs should prohibit browser launch when the managed host is already known unavailable and require a clean final process/session report.
- **Status:** contained; discarded session is absent proof.

### 2026-07-15 · Wave 2B — #404 remediation is converting review claims into falsifiable seams

- **Symptom:** six grouped review blockers needed incremental mutation-sensitive correction without publishing the still-dirty candidate.
- **Detection evidence:** active Sol session `019f61d0-2dd7-7b31-a77a-3756fff55cf6` has established RED→GREEN for: no-provider flag bypass; pending reports marked non-evidentiary plus a strict captured validator; same run/job/head/fixture/choreography lineage validation; atomic success bundle with separate non-evidence diagnostics; and a `display: contents` contained-child geometry seam. The current RED is the missing `RICH_CONTENT_REGION_IDS` per-region probe contract.
- **Impact:** remediation is progressing, but prior full-gate GREEN and both blocking reviews remain superseded; remote stays frozen.
- **Root cause:** the original evidence shell used aggregate/proxy checks rather than explicit provider state, lineage, atomic publication, and per-region geometry/correctness contracts.
- **Unblock/workaround:** implement the smallest per-region falsifiable probe from the current RED, finish remaining duplication/provenance blockers, rerun exact-current gates, and require fresh standards/spec review before any commit/push.
- **Durable fix/tracker:** preserve each blocker as a mutation-sensitive RED before repair; aggregate “content exists” or “no blank” checks are insufficient when individual long-card regions can disappear.
- **Status:** active local-only remediation; no browser, Git, remote, or Fable use.

### 2026-07-15 · Wave 2A — #413 replaced source-string retention with reviewed filesystem behavior

- **Symptom:** the evidence publication remained held because dead/commented slot-16/order strings could satisfy the first retention test.
- **Detection evidence:** the narrow default-path/temp-directory TDD correction now executes publication behavior and validates retained output. Fresh atomic-retention review `019f61e5-a0fd-7142-b8bc-24beaf53cebb` returned PASS.
- **Impact:** the single publication blocker is resolved; exact evidence may now be present on the PR branch, but new-head CI and final Opus review still gate merge.
- **Root cause:** resolved by replacing source inspection with observable filesystem output and atomic ordering behavior.
- **Unblock/workaround:** supervisor committed exactly five reviewed files as `d3fbb13d137ca6630b0e0c748ad5b826d2e29b6a` and pushed PR #424: research doc `16`, raw JSON, behavioral publication/runtime seam, report test, and Node runtime typing. `git show` preserves raw SHA-256 `a63a4de3d989f565161d91c50a4ccaf2fa8dfb430abe8723fcb952e840330b11` and report SHA-256 `3f70e174292109c469af4c32d2fe6cfd0b14de1977d6a92ea266b25d7448aa3f`.
- **Durable fix/tracker:** evidence-retention acceptance uses executable default-path behavior plus exact committed-byte hashes; implementation-text checks cannot serve as proof.
- **Status:** retention review PASS and exact five-file publication commit pushed; new-head provider/Required/Browser gates active, Opus/merge pending.

### 2026-07-15 · Wave 2A — #413 old-head checks were replaced by three new-head runs

- **Symptom:** pushing the evidence publication commit invalidated all prior PR-head CI even though those older checks were green.
- **Detection evidence:** PR #424 now points to `d3fbb13d137ca6630b0e0c748ad5b826d2e29b6a`; image evidence run 29358399665, Required run 29358403061, and Browser canary run 29358404237 are active at this checkpoint. GitHub reports the PR as UNSTABLE solely because checks are in progress.
- **Impact:** no final review or merge handoff may use `178a412…` results; current-head absence is not green.
- **Root cause:** expected evidence-only head advance.
- **Unblock/workaround:** monitor only the three exact-`d3fbb13…` runs, investigate any red canary, then route a fresh final review to Opus 4.8 before merge captain.
- **Durable fix/tracker:** every publication/evidence commit resets Required, canary, candidate-workflow, and final-review gates together.
- **Status:** active, not green; no Opus or merge yet.

### 2026-07-15 · Wave 2B — #404 remediation completed full local gates and entered dual review

- **Symptom:** the six-blocker repair needed a full exact-current proof after its incremental RED→GREEN slices, while keeping the branch uncommitted.
- **Detection evidence:** the complete dirty scope now contains 23 owned files; `ci:required` is GREEN across 107 files / 1,144 tests. Fresh standards review `019f61e7-a0bd-79d0-a845-f76b43588ef3` and spec review `019f61e7-a082-7882-ac97-4910243e8460` are active.
- **Impact:** the remediation is ready for independent adjudication but remains local-only; no commit/push/provider/PR claim follows from green gates.
- **Root cause:** not a new failure—this checkpoint closes the local repair loop after converting evidence, lineage, atomicity, geometry, and per-region probes into falsifiable seams.
- **Unblock/workaround:** freeze all 23 files until both reviews report; repair any blocker locally and require a new review before supervisor-controlled publication.
- **Durable fix/tracker:** record exact dirty-file count, test count, and both review identities so a partial or single-axis PASS cannot advance the lane.
- **Status:** local gates GREEN; dual adversarial reviews active, remote frozen, Fable prohibited.

### 2026-07-15 · Wave 2A — #413 report test conflated dynamic capture with frozen retained evidence

- **Symptom:** current-head image run [29358399665](https://github.com/limweili/eido/actions/runs/29358399665) passed contract verification, the bounded probe, and repeated capture, then failed only while regenerating/verifying the report.
- **Detection evidence:** at exact head `d3fbb13d137ca6630b0e0c748ad5b826d2e29b6a`, the environment-driven report path generated current run/head provenance and raw SHA-256 `5bd3c95444e2f10a5d7aa4e5946b26ad4adaac5dfe37bbd669920f33345a83f4`, while the same test demanded frozen retained source head `178a412…` and raw SHA `a63a4de3…`. Diagnostic artifact `8321118985` was retained; the workflow is red/disqualified.
- **Impact:** a successful capture cannot be accepted, and PR #424 cannot enter Opus/merge. New-head Required run 29358403061 and Browser canary run 29358404237 are GREEN but will be superseded by the correction commit.
- **Root cause:** one report test mode served two distinct contracts: dynamic environment/current-run evidence and deterministic frozen default-source retention. The current-run mode was incorrectly pinned to historical source constants.
- **Unblock/workaround:** a narrow Terra TDD correction must split dynamic env mode from frozen default mode, prove each with discriminating tests, preserve the committed retained bytes, rerun full gates and fresh review, then push a new head and rerun all three checks. Do not rewrite dynamic capture to masquerade as the frozen source.
- **Durable fix/tracker:** report generators must model source mode explicitly; current provider provenance and retained canonical provenance are separate valid states and cannot share hardcoded assertions.
- **Status:** image canary red/disqualified; Required/Browser greens superseded, no Opus/merge, Fable prohibited.

### 2026-07-15 · Wave 2A — #413 separated retained-source proof from current-run canary proof

- **Symptom:** the `d3fbb13…` image run failed because one test expected both frozen retained provenance and new current-run provenance from the same environment-driven path.
- **Detection evidence:** the Terra mode-split correction received fresh PASS in session `019f61ee-9941-7841-8ad6-cadcbec4422a`. Exact PR head `cb7ee6997fea71d056ed5129809dee077373a176` now has three GREEN checks: image evidence run 29358987293/job 87173911235, Browser 29358990674/job 87173922037, and Required 29358990902/job 87173922767.
- **Impact:** PR #424 is exact-head green and may enter official Opus 4.8 review, but it is not merged and the new canary does not replace the reviewed retained source evidence.
- **Root cause:** resolved by making report mode explicit: default mode verifies frozen retained source `178a412…` / raw `a63a4de3…` / report `3f70e174…`; environment mode verifies its own current head/run/raw/report.
- **Unblock/workaround:** preserve artifact `8321358561` only as supplemental current-head canary evidence: raw SHA-256 `c76b5bfb30b493680289b852af4b0d9e6910c41faef9c3eb6bc396cd0b69efea`, report SHA-256 `288c15dec16a2af4d9c761810688248fb26745d8553c666c5fea6f7c9d889427`. Launch fresh official Opus 4.8 review against exact head `cb7ee699…`; do not merge before PASS.
- **Durable fix/tracker:** every evidence report names its mode and source identity; supplemental current-head recapture cannot silently rewrite the retained decision artifact.
- **Status:** exact-head checks GREEN; official Opus 4.8 launching, no merge, Fable prohibited.

### 2026-07-15 · Wave 2B — #404 replacement reviews found three remaining falsifiability gaps

- **Symptom:** after the 23-file remediation and green full gate, the second standards/spec pass still found three ways the proof could remain vacuous or asymmetric.
- **Detection evidence:** standards session `019f61ed-a0eb-7dd1-b9ef-4f769673ecad` returned BLOCKING. Initial spec session `019f61ed-a0f9-7473-ac73-812e047d3ec9` timed out without a verdict and is absent proof; replacement spec session `019f61ef-e781-7f40-b927-b0b60eb858cb` returned BLOCKING. Remaining findings: validation path B must be held to the same contract as C; live mode must prove `chunkCount > 0`; and `passiveAgain` must prove both content and chunks after returning from live state.
- **Impact:** #404 remains local-only and uncommitted despite 107-file/1,144-test green; #405 remains serialized behind it.
- **Root cause:** the first remediation made the main evidence path fail closed but left an alternate validation path and two lifecycle states with weaker assertions that could pass on empty structure.
- **Unblock/workaround:** fresh Sol remediation session `019f61f0-d2bc-7332-8b33-8ef7dbdc5598` must add three discriminating REDs, apply validation parity, require nonzero live chunks, and assert passive-again content plus chunks; rerun exact-current gates and fresh reviews before Git/remote mutation.
- **Durable fix/tracker:** lifecycle/provenance matrices require symmetric assertions for every labeled path/state; one strict branch cannot stand in for its siblings.
- **Status:** BLOCKING on three focused findings; one spec timeout discarded, replacement verdict retained, remote/Fable forbidden.

### 2026-07-15 · Wave 2A — Official Opus rejected implied motion and capability coverage

- **Symptom:** PR #424 had exact-head green image/Required/Browser checks, but the report implied policy/capability coverage that the evidence did not exercise or validate.
- **Detection evidence:** official Claude Opus 4.8 session `019f61f4-0000-7000-8000-cb7ee6997fea` (result `381aa25c-d488-42e4-b54d-ceb7264b09ee`, 404 seconds) returned FAIL. Blocking findings: `motionDeferred=0` while the 220 ms settle delay exceeded the 180 ms policy boundary, so the motion-defer branch was never evidenced despite report language; search, copy, and accessibility/AX coverage were absent and their limitations were not established by validated probes.
- **Impact:** PR #424 remains held at `cb7ee699…`; existing green checks cannot authorize merge, and no architecture/capability conclusion may use the overstated report.
- **Root cause:** zero event counts were interpreted as successful policy behavior instead of “branch not observed,” and capability limitations were narrated without executable presence/absence validation.
- **Unblock/workaround:** approved harness/report-only correction: Sol designs explicit counters and zero-means-no-policy-evidence semantics; Terra implements mutation-sensitive TDD, validated search/copy/AX limitation probes, a temp-root default report test, and explicit reference-size accounting limitations. Then recapture provider evidence, persist exact bytes, rerun all head checks, and obtain a fresh official Opus 4.8 verdict.
- **Durable fix/tracker:** reports distinguish “zero violations after observed opportunities” from “zero opportunities”; capability limitations need validated probes; review follows every evidence-semantic head change.
- **Status:** official Opus FAIL; no merge, Fable prohibited.

### 2026-07-15 · Wave 2A — Opus also found three nonblocking evidence hygiene defects

- **Symptom:** otherwise bounded evidence contained vacuous or potentially contaminating secondary checks.
- **Detection evidence:** the same Opus result noted: offscreen-deferred coverage could pass vacuously; the default report test wrote to tracked slot `16`; and `referenceSizes` was unbounded and could undercount distinct reference residency.
- **Impact:** none alone was ranked as a merge blocker, but leaving them would weaken reproducibility and future #406 comparison confidence.
- **Root cause:** secondary counters/tests were not designed with the same opportunity-count, temp-root, and bounded-accounting discipline as the main artifact transaction.
- **Unblock/workaround:** include all three in the approved harness/report-only remediation and require fresh provider/persistence/review evidence rather than deferring them.
- **Durable fix/tracker:** tests never write tracked evidence paths; bounded metrics report truncation/undercount risk; vacuity is a first-class evidence status.
- **Status:** included in current #413 remediation, PR held.

### 2026-07-15 · Wave 2B — #404 final-three review found AX and first-click probes still used proxies

- **Symptom:** the three focused remediation findings were repaired, but the next full review still found one accessibility proof that allowed zero structure and two interaction/content paths that did not exercise the intended live regions.
- **Detection evidence:** standards review `019f61fd-b374-7bf0-aaf3-5ede1edf77ee` returned BLOCKING because accessibility evidence did not require positive observed `richTextNodes`/role counts. Spec review `019f61fd-b33b-7a82-a564-11aa8f7a0ccd` returned BLOCKING with two Highs: live Note and conversation-topic paths could report zero chunk markers, and Result/follow-up/transcript first-click coverage hardcoded clicks through `card-head` rather than the real in-region interaction targets.
- **Impact:** #404 remains a 23-file local dirty diff with remote frozen; no provider run, PR, or #405 dispatch can advance.
- **Root cause:** the evidence probes still treated non-error/activation proxies as proof of positive accessibility structure, live content chunking, and intended first-click destination.
- **Unblock/workaround:** fresh Sol TDD session `019f6201-6129-77e3-8480-1744a51d59a1` must establish three discriminating REDs, require positive AX node/role counts, assert live editor chunks for Note/topic, and click real Result/follow-up/transcript regions with the intended one-click outcome. Then rerun full gates and fresh reviews before Git/remote mutation.
- **Durable fix/tracker:** accessibility and first-click contracts require positive observed structure and the actual user target; header activation cannot substitute for an in-body interaction.
- **Status:** BLOCKING on final three evidence gaps; local remediation active, remote/Fable forbidden.

### 2026-07-15 · Wave 2A — #413 Opus remediation design passed before Terra TDD

- **Symptom:** the Opus blockers spanned schema semantics, browser capability probes, vacuity, test isolation, and bounded-accounting limitations; implementing without a constrained design risked another evidence rewrite.
- **Detection evidence:** Sol design review `019f61fc-646c-7013-8cd8-276691957cdb` returned PASS for a four-performance-file harness/report-only plan.
- **Impact:** Terra may implement a bounded correction without changing production image behavior, retained source evidence, or the architecture decision boundary.
- **Root cause:** resolved at design level by separating observed opportunity counts from policy outcomes and separating browser capability limitations from unsupported claims.
- **Unblock/workaround:** schema v2 records validated search/copy/AX limitation probes; motion/offscreen counters publish zero as “no policy evidence” rather than success; the report documents reference-size bookkeeping/undercount caveats; default report tests use a temp root. Terra TDD starts only within the four owned performance files, followed by fresh gates/review/provider/persistence/Opus.
- **Durable fix/tracker:** evidence-schema changes receive a pre-implementation semantics review; zero/opportunity and capability/limitation states are explicit.
- **Status:** design PASS; Terra TDD starting, PR #424 held, no new CI/merge.

### 2026-07-15 · Wave 2B — #404 worktree remained absent from codebase-memory during final remediation

- **Symptom:** codebase-memory MCP returned project-not-found for the registered `epic-410-404` worktree on three attempts.
- **Detection evidence:** the canonical project index existed, but the isolated dirty branch path was not indexed/aliased and could not represent its 23-file remediation diff.
- **Impact:** graph-first discovery was unavailable for the final focused fixes; no code/evidence was lost and the issue remained nonblocking.
- **Root cause:** dispatched worktree creation still does not reliably register a branch-local code graph, the same bootstrap gap tracked in #422.
- **Unblock/workaround:** follow AGENTS.md fallback: inspect only exact owned local source/test files and verify all claims against the isolated worktree rather than a stale canonical graph.
- **Durable fix/tracker:** [#422](https://github.com/limweili/eido/issues/422) owns automatic worktree graph indexing/aliasing as part of agent bootstrap.
- **Status:** workaround active, nonblocking.

### 2026-07-15 · Wave 2A — #413 first remediation review hit its cap without a verdict

- **Symptom:** fresh Sol review `019f620b-0a30-7d01-ae73-77c3c250888e` terminated at its cap before returning a complete PASS/BLOCKING verdict.
- **Detection evidence:** the session produced no final verdict and no actionable finding tied to the complete four-file schema-v2 diff.
- **Impact:** the partial review could not authorize commit/push, but it did not establish a blocker either.
- **Root cause:** review budget/scope exhaustion on the accumulated harness/report semantics.
- **Unblock/workaround:** discard the incomplete result and route the unchanged complete diff to independent fresh Terra review `019f6211-eb6f-7d52-b249-2809fc9a3a08`, which returned PASS with zero blockers.
- **Durable fix/tracker:** capped/no-verdict review is absent proof; an independent complete review may supersede it without treating silence as approval.
- **Status:** resolved by fresh Terra PASS; no Fable used.

### 2026-07-15 · Wave 2A — #413 schema-v2 harness commit advanced the PR and reset all gates

- **Symptom:** not a failure; the reviewed four-file correction had to replace the Opus-failed `cb7ee699…` head and invalidate its greens.
- **Detection evidence:** supervisor committed/pushed exactly four performance files as `fc30f33fee347d33f07e22a274901e33bf7765a3` (`test(perf): publish image rendition limitations (#413)`). Live PR #424 now points to that head. Image run 29361422074, Required run 29361425753, and Browser canary run 29361425796 are active at this checkpoint.
- **Impact:** no previous check or Opus verdict is current; provider recapture/persistence and all exact-head gates must complete before a fresh official Opus review.
- **Root cause:** expected evidence-schema/report head advance.
- **Unblock/workaround:** monitor only the `fc30f33…` runs, preserve schema-v2 artifact bytes if green, promote the reviewed retained report, rerun current-head checks as needed, and launch fresh Opus 4.8 only afterward.
- **Durable fix/tracker:** harness/report-only commits reset candidate evidence, retained promotion, Required, Browser, and official review together.
- **Status:** reviewed commit pushed; three exact-head workflows active, no merge.

### 2026-07-15 · Wave 2B — #404 audit script used zsh's readonly `status` parameter

- **Symptom:** a local audit command failed before completing because it assigned to `status`, a readonly/special parameter in zsh.
- **Detection evidence:** the failure occurred in audit-shell bookkeeping, not Vitest, typecheck, product code, or evidence logic.
- **Impact:** minor audit delay only; no file/Git/remote mutation and no code red.
- **Root cause:** a generic shell variable name collided with zsh's reserved parameter semantics.
- **Unblock/workaround:** rename the variable (or run the intended script under its declared shell), then rerun the unchanged audit. Final local gate remained GREEN across 107 files / 1,203 tests.
- **Durable fix/tracker:** orchestration shell snippets should avoid zsh special parameter names such as `status` and declare shell assumptions explicitly.
- **Status:** unblocked, nonblocking.

### 2026-07-15 · Wave 2B — #404 Final4 reviews started on the 1,203-test remediation diff

- **Symptom:** the AX/live-chunk/in-region-click repair needed another complete two-axis review before any remote mutation.
- **Detection evidence:** exact-current `ci:required` is GREEN across 107 files / 1,203 tests. Fresh standards session `019f6210-0fb8-75a3-9d11-568ac973512f` and spec session `019f6210-0fe7-7393-9cc2-88289e270d0e` are active against the complete 23-file local diff.
- **Impact:** local remediation is mechanically green but unaccepted; branch remains at base `b72316f…` and remote frozen.
- **Root cause:** not a new failure—this is the required review boundary after three more evidence/user-outcome repairs.
- **Unblock/workaround:** wait for both verdicts; repair any blocker locally and require fresh review before supervisor commit/push/provider work.
- **Durable fix/tracker:** every mutation-sensitive repair round receives fresh standards and spec adjudication on the whole diff.
- **Status:** dual reviews active, no browser/Git/remote/Fable.

### 2026-07-15 · Wave 2B — #404 Final4 reviews accepted the complete local diff

- **Symptom:** not a failure; the 23-file AX/live-chunk/in-region-click remediation needed two complete verdicts before its first commit or provider mutation.
- **Detection evidence:** standards session `019f6210-0fb8-75a3-9d11-568ac973512f` and spec session `019f6210-0fe7-7393-9cc2-88289e270d0e`, both fresh `gpt-5.6-sol`, returned PASS with zero blockers against the complete local diff. The exact-current local gate remained GREEN across 107 files / 1,203 tests.
- **Impact:** the supervisor may create the exact reviewed commit, push it, and request provider B/C capture; there is still no provider evidence or PR acceptance signal at this checkpoint.
- **Root cause:** expected review boundary after the fourth evidence-hardening round.
- **Unblock/workaround:** preserve the reviewed file set exactly through commit/push, then require provider B/C evidence and current-head gates. Treat their present absence as absent proof, not green.
- **Durable fix/tracker:** a local review PASS authorizes only the next mutation; it does not substitute for provider evidence, current-head Required/Browser checks, or final adversarial review.
- **Status:** both Final4 reviews PASS; commit/push/provider is the next gate, Fable remains prohibited.

### 2026-07-15 · Wave 2A — #413 schema-v2 current-head probe rejected clipboard proxy semantics

- **Symptom:** the exact-`fc30f33…` Image rendition candidate workflow failed its bounded non-evidence traversal before capture because clipboard readback did not equal the intended substantive selection.
- **Detection evidence:** run `29361422074`, job `87182189030`, failed at `copyFirstSubstantiveCandidateText`; diagnostics remained otherwise healthy (`detailNodeCount=131`, nine purpose-marked/derived/decoded-ready images, zero resolver failures, no console or page errors). Capture/report were correctly skipped. Diagnostic artifact `8322317012` (20,461 bytes, digest `sha256:56ee7bae15b5a15a1dc189522e5cfc64df809c9ddf3b031846747b6789104921`) was retained.
- **Impact:** no schema-v2 provider evidence exists for `fc30f33…`; the red canary is disqualified and PR #424 remains held. Required run `29361425753` and Browser canary `29361425796` were green on that head but will be superseded by the harness correction.
- **Root cause:** the limitation probe used an in-page selection/copy proxy whose clipboard result diverged from the substantive intended browser selection; the image resolver and renderer path were healthy.
- **Unblock/workaround:** route a harness-only repair using real Playwright selection plus the user gesture `Ctrl+C` and clipboard readback, preserving fail-closed mismatch semantics. Rerun provider capture and every current-head gate after review; do not weaken the assertion or change product behavior.
- **Durable fix/tracker:** browser capability evidence must exercise browser-level user input and observable readback; page-evaluated selection/copy proxies are not equivalent proof.
- **Status:** diagnosed red, harness-only correction routed; no evidence/merge, Fable prohibited.

### 2026-07-15 · Wave 2A — #413 remediation gate hit a root-owned npm cache

- **Symptom:** the first full-gate attempt for the clipboard-probe remediation failed when `npx npm@10` encountered root-owned entries under `~/.npm` and returned `EPERM`.
- **Detection evidence:** the failure occurred during package-runner/cache access before the canonical repository gate could adjudicate the harness diff; it was environmental, not a test or product-code failure.
- **Impact:** one local gate attempt was unusable as evidence; no Git, provider, PR, or product mutation resulted.
- **Root cause:** the agent worktree inherited a shared npm cache with incompatible ownership, the bootstrap/cache isolation gap already owned by #422.
- **Unblock/workaround:** use the installed npm 10 binary with a private writable cache, then run the canonical `npm run ci:required` unchanged. The harness repair itself replaces the misleading `execCommand` path with visible DOM selection, a sentinel precondition, real Playwright `Control`/`Meta+C`, exact clipboard readback, cleanup, and fail-closed mismatch behavior.
- **Durable fix/tracker:** agent bootstrap must provide pinned npm plus a per-worktree writable cache; CI evidence should name environmental pre-gate failures separately from code reds.
- **Status:** cache friction unblocked locally; canonical gate and review still required before push/provider rerun.

### 2026-07-15 · Wave 2B — #404 provider C failed closed on clipboard readback after B succeeded

- **Symptom:** provider run `29361644502` completed the B control probe, correctness, and capture plus the C choreography probe, then failed only C correctness because clipboard readback did not equal the substantive intended selection.
- **Detection evidence:** exact head `59448ee6273b3de0b35d60fd2c8ba17916e56b3a`, job `87182953420`; steps 6–9 succeeded, step 10 failed at `copyFirstSubstantiveCandidateText`, and C capture plus B+C report publication/upload were correctly skipped. Only diagnostic artifact `8322496209` was uploaded (16,751 bytes, digest `sha256:90ff93cb38a07fd41b812af3c36385670fc60fb0bc8a98718234263e3930df23`).
- **Impact:** B output cannot become standalone evidence and no C/result bundle exists; #404 remains held with no PR acceptance evidence. Product behavior and the B/C renderer measurements are not implicated by this isolated clipboard mismatch.
- **Root cause:** the same provider-only clipboard variability seen in #413: page-evaluated selection/copy behavior is not stable evidence for a browser user gesture even after the underlying candidate choreography succeeds.
- **Unblock/workaround:** fresh Sol applies the already validated #413 harness pattern—visible DOM selection, sentinel precondition, real Playwright `Control`/`Meta+C`, exact readback, cleanup, and fail-closed mismatch semantics—without changing product behavior. Then rerun local gates/review and the entire atomic B+C provider transaction.
- **Durable fix/tracker:** provider browser capability probes should share one reviewed real-input clipboard seam; partial B or C success stays diagnostic-only unless the atomic B+C+report bundle validates.
- **Status:** diagnosed red, remediation active; publication correctly failed closed, Fable prohibited.

### 2026-07-15 · Wave 2A — #413 real-keyboard clipboard repair advanced PR #424

- **Symptom:** not a new failure; the provider-rejected copy proxy required a three-file harness-only correction and invalidated all `fc30f33…` head greens.
- **Detection evidence:** canonical local gates are GREEN; fresh Terra review `019f6219-d894-7ca2-a922-47d1d8b09c50` returned PASS with zero blockers. The supervisor pushed reviewed head `048902b150e6fb1de7a3d3b9436efc5cde1a05a5` via `--force-with-lease`. New Image provider run `29361958959`, Required run `29361960562`, and Browser canary run `29361960545` started on that exact head.
- **Impact:** the earlier `fc30f33…` Required/Browser greens and copy-probe red are superseded; no current-head provider/CI result or final Opus acceptance exists at this checkpoint.
- **Root cause:** resolved in the harness by replacing the non-equivalent in-page copy path with browser-level keyboard input and observable readback.
- **Unblock/workaround:** monitor the three exact-`048902b…` workflows; retain/promote evidence only after provider success, then obtain fresh official Opus 4.8 review. Any new clipboard mismatch remains red and diagnostic-only.
- **Durable fix/tracker:** clipboard evidence uses visible selection plus real keyboard gesture, exact readback, sentinel/cleanup, and fail-closed semantics across candidate lanes.
- **Status:** reviewed fix pushed; current-head workflows active, no merge/Fable.

### 2026-07-15 · Wave 2A — #413 real-keyboard rerun exposed an earlier selection precondition red

- **Symptom:** exact-`048902b…` provider run `29361958959` failed before the real keyboard copy gesture because the visible synthetic asset-name selection did not exactly equal `synthetic-alpha-square.png`.
- **Detection evidence:** job `87184021046` failed in `selectVisibleCandidateFilename`; renderer diagnostics remained healthy (`detailNodeCount=131`, nine purpose-marked/derived/decoded-ready images, zero resolver failures, no console/page errors). Capture/report were skipped and diagnostic artifact `8322533575` was retained (20,470 bytes, digest `sha256:634ea10e39d54d0a37040a5370bd71a1e77a85734f6e6b1f6c9d24437053437e`). Required `29361960562` and Browser `29361960545` passed on the same head.
- **Impact:** the keyboard repair is mechanically green but still has no provider evidence; the Required/Browser greens are insufficient and will be superseded by any next correction head. PR #424 remains held.
- **Root cause:** provider selection variability occurs before clipboard invocation: the DOM selection range itself is not reliably producing the exact visible filename selection under the provider browser.
- **Unblock/workaround:** diagnose the actual selected text/range from the retained failure context, then repair only the harness selection seam with a mutation-sensitive provider-equivalent test. Preserve exact-match and fail-closed behavior; do not bypass the selection precondition or change product code.
- **Durable fix/tracker:** browser clipboard proof has two independent gates—exact visible selection, then real keyboard/readback—and both require provider-stable observability rather than page-only assumptions.
- **Status:** provider red diagnosed at selection precondition; renderer healthy, no evidence/merge/Fable.

### 2026-07-15 · Wave 2A — #413 remediation routing hit transient model capacity

- **Symptom:** the supervisor turn errored after routing a fresh Sol design because the selected model was temporarily at capacity.
- **Detection evidence:** no repository, provider, PR, CI, or product mutation occurred in the failed orchestration turn.
- **Impact:** dispatch delay only; the selection-precondition diagnosis and fail-closed state were preserved.
- **Root cause:** transient model availability, not task scope or code behavior.
- **Unblock/workaround:** resume the same agent with one fresh Sol retry, then use fresh Terra if Sol remains unavailable. Keep the written contract and evidence boundary unchanged.
- **Durable fix/tracker:** capacity errors are absent work, not review evidence; retry once within the approved route and use the authorized Codex fallback without weakening scope.
- **Status:** immediately unblocked; Fable remains prohibited and no product/CI impact occurred.

### 2026-07-15 · Wave 2A — #413 reached a validated final head and entered merge-captain review

- **Symptom:** not a failure; multiple harness-evidence corrections had to converge on one exact head before PR #424 could leave orchestration.
- **Detection evidence:** final head `aca36ab90e02fbd8ec7c12e487ed938de9ac32fc`; Image provider `29365358434` / job `87195435700`, Required `29365361575`, and Browser `29365361812` all succeeded on that exact head. Provider artifact `8323873668` is 81,681 bytes with digest `sha256:8b14212e4b27e3ccd4cf3393d13d3e6a8bd6d79b646812651216ca4f08c06b18`. Retained schema-v2 evidence validation plus fresh implementation and evidence reviews returned PASS.
- **Impact:** #413 has complete exact-head technical evidence and PR #424 is ready for the dedicated full-lane merge captain; it is still open and unmerged at this checkpoint.
- **Root cause:** resolved sequence of provider-only harness/provenance gaps; no production renderer or storage regression survived.
- **Unblock/workaround:** official Opus 4.8 could not authenticate because its OAuth had expired. Per the owner's standing policy, independent fresh Sol/Terra implementation and evidence reviews supplied the accepted fallback; Fable output remained prohibited and absent. Dispatch one full-lane merge captain to re-derive PR/check/review state and land one at a time.
- **Durable fix/tracker:** cross-vendor unavailability must be explicit; accepted fallback still requires fresh independent complete reviews and exact-head evidence, never a partial or stale verdict.
- **Status:** final evidence/reviews PASS; dedicated merge captain active on open PR #424, no Fable.

### 2026-07-15 · Wave 2B — #404 Final5–10 exposed and repaired an SVG-selector fixture blind spot

- **Symptom:** repeated browser-proof reviews found that the Highlight erase control could satisfy a broad `:last-child` SVG locator intended to prove the passive renderer, producing false-positive interaction evidence.
- **Detection evidence:** FINAL5 through FINAL10 exercised the browser proof until the selector ambiguity was isolated. The repair targets the exact passive-renderer selector; canonical gate is GREEN across 107 files / 1,243 tests and FINAL10 standards/spec reviews, both fresh Sol, returned PASS with zero blockers.
- **Impact:** the reviewed #404 candidate advanced without weakening Highlight behavior or substituting the erase-control SVG for renderer proof.
- **Root cause:** synthetic fixture/locator coverage omitted a sibling SVG control with the same structural position, so earlier tests did not discriminate the intended renderer from an adjacent control.
- **Unblock/workaround:** add the missing fixture shape and assert the exact passive renderer. Commit reviewed fix as `360e5cad4fdbc2c8490f55edb36782100d18373d`; rebase onto current main `b72316f…` was a no-op; push via `--force-with-lease`.
- **Durable fix/tracker:** browser fixtures must include confusing adjacent controls and locators must identify semantic ownership, not incidental child position.
- **Status:** FINAL10 dual PASS and reviewed head pushed; provider evidence still required, Fable prohibited.

### 2026-07-15 · Wave 2B — #404 FINAL10 provider transaction timed out in C correctness

- **Symptom:** run `29368237886` passed the full B control transaction and the C choreography probe, then timed out after 2.1 minutes in C provider correctness.
- **Detection evidence:** exact head `360e5cad4fdbc2c8490f55edb36782100d18373d`, job `87204984915`; B probe/correctness/capture and C probe succeeded. Failure was `NON-EVIDENCE choreography probe timed out at note: provider correctness`. C capture and atomic B+C publication/upload were skipped; diagnostics-only artifact `8325127970` is 21,263 bytes with digest `sha256:bcd08b552c04c52a3f8f204e95e698218be7e209a258265c2b5e5fc4b69ca0bb`.
- **Impact:** the queued in-progress checkpoint is superseded by a genuine red gate; no #404 evidence bundle or PR acceptance exists, and B output remains non-evidence.
- **Root cause:** not yet established. The exact passive-selector repair passed C choreography but provider correctness did not complete within its bounded timeout.
- **Unblock/workaround:** inspect retained timeout context and instrument the bounded C correctness step to identify the stalled operation; keep atomic publication fail-closed and do not widen timeouts without proof.
- **Durable fix/tracker:** provider progress must be recorded per sub-step so a timeout can be localized without treating earlier transaction stages as evidence.
- **Status:** surviving provider red requires diagnosis; no merge, Fable prohibited.

### 2026-07-15 · Tooling friction — `npm exec` argument shape returned EUSAGE

- **Symptom:** a local command used invalid `npm exec` syntax and exited with `EUSAGE` before the intended gate ran.
- **Detection evidence:** failure occurred in command parsing, before repository tests.
- **Impact:** local delay only; no code, Git, provider, or CI mutation.
- **Root cause:** package/argument separation did not match npm 10's `exec` contract.
- **Unblock/workaround:** invoke the repo's canonical npm script or use npm 10's documented `exec --` argument boundary, then rerun the unchanged command.
- **Durable fix/tracker:** copy canonical commands from the release profile and record command-parser failures separately from test reds.
- **Status:** unblocked, non-product.

### 2026-07-15 · Reviewer friction — macOS temporary-directory warnings polluted review output

- **Symptom:** reviewer processes emitted macOS temp/cache warnings while inspecting isolated worktrees.
- **Detection evidence:** warnings did not correspond to changed files, failed assertions, or a review finding.
- **Impact:** noisy logs and slower adjudication only.
- **Root cause:** reviewer subprocesses inherited unsuitable or unwritable temporary-directory defaults.
- **Unblock/workaround:** route reviewer temp/cache state to an explicit private writable directory and judge only complete verdicts.
- **Durable fix/tracker:** #422 owns per-worktree writable temp/cache bootstrap; warnings without a complete verdict are not evidence.
- **Status:** nonblocking workaround applied.

### 2026-07-15 · Shell friction — Markdown backticks triggered command substitution

- **Symptom:** backticks embedded in a shell-bound payload were interpreted as command substitution instead of literal review text.
- **Detection evidence:** the shell altered/attempted to execute prompt content before the intended command completed.
- **Impact:** one orchestration command was discarded; no repository or remote mutation counted.
- **Root cause:** untrusted Markdown text crossed an interpolating shell boundary.
- **Unblock/workaround:** pass review text through a non-interpolating argument/file boundary and avoid embedding backticks in shell command strings.
- **Durable fix/tracker:** orchestration payloads are data, never shell source; malformed turns are absent proof.
- **Status:** unblocked, no product impact.

### 2026-07-15 · Browser friction — nested local Chromium hit MachPort denial

- **Symptom:** a nested Chromium launch on macOS failed with a MachPort permission denial.
- **Detection evidence:** the failure occurred before the requested browser proof and matched the managed-host browser restriction.
- **Impact:** local browser output was absent, not red product evidence.
- **Root cause:** host sandbox/port policy prevents nested Chromium from acquiring the required process capability.
- **Unblock/workaround:** keep local unit/gate work non-browser and route browser/performance proof to the GitHub provider runner.
- **Durable fix/tracker:** browser-host capability is a preflight registry field; never retry nested Chromium as if it were a product test.
- **Status:** provider path used, nonblocking.

### 2026-07-15 · Routing friction — another transient Sol capacity miss

- **Symptom:** a fresh Sol review/diagnosis dispatch temporarily failed at model capacity.
- **Detection evidence:** no complete verdict or file mutation was produced.
- **Impact:** scheduling delay only.
- **Root cause:** transient model availability.
- **Unblock/workaround:** retry Sol once, then use fresh Terra under the owner-approved fallback; retain the same written contract.
- **Durable fix/tracker:** capacity failures are absent work. Fable 5 is never used as the availability fallback.
- **Status:** unblocked through approved routing, no CI/product impact.

### 2026-07-15 · Wave 2A — merge captain landed #413 while the ledger checkpoint was being finalized

- **Symptom:** live reconciliation superseded the recorded merge-captain-active state: PR #424 merged before the checkpoint report was sent.
- **Detection evidence:** PR #424 merged final head `aca36ab90e02fbd8ec7c12e487ed938de9ac32fc` as `b6d9389d047b6e4d87b66e90348d137f6e32fd71` at `2026-07-15T01:31:58Z`; issue #413 is closed completed. Exact-main CI run `29381857203` started on the merge SHA and is still in progress at this checkpoint.
- **Impact:** #413 implementation is landed, but production verification and cleanup are not yet complete; absence of a finished exact-main result is not green.
- **Root cause:** expected concurrent merge-captain progress during ledger reconciliation.
- **Unblock/workaround:** mark merged-pending-main-verification, keep the dedicated captain on exact-main Required/release artifact verification, then clean branch/worktree only after green proof.
- **Durable fix/tracker:** always re-read PR state immediately before publishing a registry checkpoint; distinguish merged from production-verified-cleaned.
- **Status:** merged; exact-main CI active, cleanup pending, Fable prohibited.

### 2026-07-15 · Wave 2A — #413 exact-main production verification turned green

- **Symptom:** not a failure; the merge still owed exact-main Required and release-artifact proof.
- **Detection evidence:** run `29381857203`, Required job `87247001900`, succeeded on merge SHA `b6d9389d047b6e4d87b66e90348d137f6e32fd71`. Unexpired artifact `8330002735` is named `eido-main-b6d9389d047b6e4d87b66e90348d137f6e32fd71` and has digest `sha256:ad05c243a3155d1f35f291dd2ea724d7ad805adcd3a23c07cd4a9e2a99a88dcb`.
- **Impact:** #413 is production verified; only merge-captain branch/worktree cleanup remains.
- **Root cause:** expected post-merge verification boundary.
- **Unblock/workaround:** authorize cleanup only after matching exact-main SHA, Required success, and release artifact identity are all observed.
- **Durable fix/tracker:** merge completion and production verification remain separate registry states.
- **Status:** production verified, cleanup pending; Fable prohibited.

### 2026-07-15 · Wave 2A — #413 cleanup preflight first collided with zsh's reserved `status`

- **Symptom:** the first cleanup preflight aborted before mutation because a shell snippet assigned to zsh's reserved/readonly `status` parameter.
- **Detection evidence:** worktree and branch deletion had not started; no repository state changed in the failed preflight.
- **Impact:** cleanup delay only, with no lost work or partial deletion.
- **Root cause:** generic shell bookkeeping reused a zsh special parameter, repeating the earlier audit-script friction.
- **Unblock/workaround:** rename the variable to `diff_status`, rerun the full preflight, then perform cleanup only after all preservation checks pass.
- **Durable fix/tracker:** orchestration shell snippets must avoid zsh special names in both audit and cleanup paths; a preflight abort is absent mutation.
- **Status:** unblocked before mutation.

### 2026-07-15 · Wave 2A — #413 cleanup completed without touching the dirty canonical checkout

- **Symptom:** not a failure; the production-verified lane still owned one worktree and local/remote feature branch.
- **Detection evidence:** `/Users/weili/Documents/Projects/eido-worktrees/epic-410-413`, local branch `codex/epic-410-413-images`, and its remote ref are all absent after cleanup. The founder checkout remains at `5b8cb813069d9eeaddbec02abcccbcf934e782f4` with untracked `research/prototype/` untouched. Live comparison shows it is now five commits behind `origin/main`; the queued four-commit count was superseded by the #413 merge itself.
- **Impact:** #413 is production-verified-cleaned and no longer consumes an owned worktree/branch slot; unrelated founder state is preserved.
- **Root cause:** expected closeout after exact-main verification.
- **Unblock/workaround:** remove only #413 entries from the owned cleanup arrays after independently confirming all three refs/paths are gone.
- **Durable fix/tracker:** cleanup reports use live ref counts and explicitly preserve dirty canonical checkouts; queued counts may become stale during a merge.
- **Status:** #413 complete and clean; Fable prohibited.

### 2026-07-15 · Wave 2C preflight — #405 contract refreshed read-only while serialization remains

- **Symptom:** not a CI or implementation blocker; #405 cannot safely dispatch while #404 still owns shared `Board.tsx` and `Board.controlledNodes.test.ts` hotspots.
- **Detection evidence:** live `origin/main` is `b6d9389d047b6e4d87b66e90348d137f6e32fd71`; #413 is landed and its authoritative image/rendition API is now a dependency. #405 has no branch/worktree. PR #416 currently owns `package.json` and `package-lock.json`.
- **Impact:** #405 remains operationally serialized behind #404, but its post-#404 worker contract is agent-ready and no longer blocked by #413.
- **Root cause:** deliberate file-scope serialization on Board controlled-node identity; dispatching now would create a shared-hotspot merge conflict and invalidate B/C isolation.
- **Unblock/workaround:** after #404 merges and exact-main is green, re-derive main and dispatch #405 from that SHA. In both B and C explicitly disable #404; enable only #405 in C. Consume the landed #413 API without creating another image cache. Keep package/lock forbidden while PR #416 owns them.
- **Durable fix/tracker:** the refreshed contract requires RED-first tests; provider Linux B/C probe → correctness → capture; same-lineage validation; atomic promotion; exact-head Required/Browser and exact-main release proof. Partial/placeholder artifacts remain non-evidence.
- **Status:** ready contract recorded, dispatch blocked only by #404; Sol/Terra fallback authorized, Fable prohibited.

### 2026-07-15 · Wave 2B — #404 C-correctness hang narrowed to Note-link effect observation

- **Symptom:** provider run `29368237886` timed out in C correctness because the Note-link probe waited indefinitely for a popup that some valid link classes do not create.
- **Detection evidence:** materialization, search, exact copy, and AX probes complete; the hang localizes to Note link activation. A bounded helper seam now proves an external popup link succeeds and a second unmatched anchor fails closed in about 13 seconds instead of hanging; its focused test is GREEN. Exact C remains red while provider-equivalent diagnosis continues.
- **Impact:** #404 still has no candidate evidence bundle and remains serialized ahead of #405. The surviving red is harness semantics, not proof of a renderer/content/AX failure.
- **Root cause:** popup-only observation was unbounded and semantically wrong for same-document/hash, URL-changing, and target-focus/scroll links.
- **Unblock/workaround:** derive the intended link class first, arm one bounded exact observer before the real click, then require the class-specific effect: popup/new page, hash or URL change, or intended target focus/scroll. Clean every observer/listener and fail closed on mismatch or timeout.
- **Durable fix/tracker:** link correctness is an effect union keyed by link class; popup is only one member. Browser probes must arm bounded observers before input and publish no evidence on an unintended effect.
- **Status:** focused helper green; exact C still red. Passive reset, forced dispatch, and timeout inflation are forbidden; Fable prohibited.

### 2026-07-15 · Wave 2C preflight — Dependabot PR #416 blocks only #405's package lane

- **Symptom:** open Dependabot PR #416 is a broad major-version package/lock update with red Required and Browser checks, but it does not overlap #405's current non-package implementation scope.
- **Detection evidence:** PR head `1e74c84e94fdfdb3e46814549d91dcb1062b32d6`, stale base `71f92116828f9d03a7e3de820cf6aa1a1441cdeb`; exactly `package.json` and `package-lock.json` changed. Required run `29337542719` is red on React store-snapshot/infinite-update behavior; Browser run `29337542718` is red on hydration timeouts. The bundle includes majors such as React 19, Zustand 5, TypeScript 7, and Vite-era tooling. It has no review or auto-merge authorization.
- **Impact:** package/lock and any dependency sub-slice remain forbidden to #405. Board/cache/harness work that needs no dependency change is not blocked; #404 serialization remains its only current implementation blocker.
- **Root cause:** Dependabot grouped multiple ecosystem majors on a stale base, crossing subscription, hydration, toolchain, React Flow, and performance-baseline semantics.
- **Unblock/workaround:** take no action on #416. If it lands unexpectedly, rebase #405 and refresh subscription/hydration contracts, toolchain behavior, `@xyflow` compatibility, and performance baselines before trusting any prior evidence.
- **Durable fix/tracker:** dependency ownership is a separate lane; a red broad upgrade never becomes an implicit prerequisite or permission to edit package files.
- **Status:** read-only observation only; #416 open/unstable, no review/auto-merge, Fable prohibited.

### 2026-07-15 · Wave 3 preflight — #406 comparator contract refreshed without reopening product contracts

- **Symptom:** not a testing blocker; architecture selection cannot execute until #404 and #405 are landed, comparable, and exact-main green.
- **Detection evidence:** current main `b6d9389d047b6e4d87b66e90348d137f6e32fd71` is green; #403 and #413 inputs are landed. #406 has no branch/worktree and remains blocked only by #404/#405.
- **Impact:** the post-candidate decision worker is ready with deterministic eligibility, materiality, ranking, and output rules; no architecture is selected early.
- **Root cause:** expected dependency boundary—comparison requires all candidate evidence on normalized fixtures and provider lineage.
- **Unblock/workaround:** veto any candidate that violates correctness/product contracts; compare same-job candidate/control ratios; require materiality `max(10%, 2×MAD/median)`; rank lexicographically by correctness, responsiveness, bounded residency, then risk. Give zero credit to unexercised/zero-opportunity counters. Permit a hybrid only with combined measured proof, and score #413 image behavior on its own decoded/rendition/paint/cache axis.
- **Durable fix/tracker:** #406 must emit exactly one production selection—strict residency, internal virtualization, cached passive rendering, bounded measured hybrid, or no change—plus one image-lifecycle decision and explicit rejected alternatives. Multiple equivalent paths cannot remain open.
- **Status:** full read-only comparator contract recorded; no mutation, Fable prohibited.

### 2026-07-15 · Wave 3 preflight — #407 ADR reconciliation contract hard-blocked on #406

- **Symptom:** #407 cannot responsibly edit ADR or foundation wording before #406 selects and lands one measured architecture.
- **Detection evidence:** issue #407 is open and explicitly blocked by #406; no branch/worktree or mutation exists.
- **Impact:** historical ADR wording and canvas-layer drift are mapped, but no speculative decision or migration is authored.
- **Root cause:** ADR disposition must describe the measured winner and rejected alternatives, not anticipate them.
- **Unblock/workaround:** after #406 merges with green exact-main proof, author the next free selection/disposition ADR; update the ADR index; narrowly reconcile ADRs 0019/0020/0023/0024 and `canvas-layer.md`; touch `CONTEXT.md` only if #406 creates a canonical term. Preserve ADRs 0010/0011/0021 and every LOD/painter/one-graph invariant.
- **Durable fix/tracker:** per-ADR disposition must say accepted, amended, or superseded and why; candidate evidence must not be overstated as production proof. Code, workflows, evidence, packages, storage, migrations, and the production renderer migration remain forbidden.
- **Status:** hard-blocked on #406 merged/exact-main green; read-only contract recorded, Fable prohibited.

### 2026-07-15 · Wave 2B — #404 link diagnosis separated activation success from invalid-target navigation failure

- **Symptom:** after the activation-root fix, focus → Live transition and the real Note-link click succeeded, but the exact popup still failed because the synthetic `.invalid` destination became `chrome-error://chromewebdata/`.
- **Detection evidence:** the activation and first-click path now pass independently. The browser's final popup URL does not preserve the intended `https://example.invalid/eido-404/**` URL/fragment, so exact effect validation correctly stays red.
- **Impact:** the remaining failure is deterministic test-network behavior, not Card activation. Exact C and evidence promotion remain blocked until the intended navigation can be observed without accepting Chrome's error page.
- **Root cause:** the privacy-safe external test target has no network response; Chromium replaces the intended navigation with its internal error document.
- **Unblock/workaround:** fresh Terra session `019f638d-b94a-71d2-b10c-d1a7bc86da55` owns an exact temporary route for only `https://example.invalid/eido-404/**`, returning a minimal privacy-safe response while preserving the requested URL and fragment. Install before click; always unroute in `finally`; add lifecycle/leak tests. `chrome-error://` remains a hard red.
- **Durable fix/tracker:** provider link probes may stub only their exact synthetic route and must preserve browser-visible navigation semantics. Sol transition-listener and localhost substitutions were rejected: transition listeners did not restore exact intended URL proof, while localhost booted a second Eido app and caused a later first-click failure.
- **Status:** Terra implementation active; no passive reset, forced dispatch, timeout inflation, remote mutation, or Fable.

### 2026-07-15 · Wave 2B — #404 redirected C returned before its owned browser process tree

- **Symptom:** an apparent local C completion could have been recorded as green even though its redirected log contained startup output only and the owned Playwright/Chromium and Vite processes were still running.
- **Detection evidence:** audit found Playwright/Chromium process group `90888` and orphan Vite process group `90939`, both launched exclusively from the #404 worktree/cwd, after `npx`/Playwright had returned control. The prior redirected output had no verified terminal C verdict.
- **Impact:** the prior local C result is unverified and supplies no acceptance evidence. B must not start from it, and no commit, push, provider rerun, PR, or merge claim follows.
- **Root cause:** wrapper completion and redirected startup output were mistaken for the owned process tree reaching a terminal test result; the child server/browser lifecycle outlived the command boundary.
- **Unblock/workaround:** verify ownership before mutation, send `TERM` to both owned process groups, and confirm port `5177` is free. Rerun exact C live on a fresh isolated port, bound the owned process tree, and verify both the terminal exit and cleanup before starting B.
- **Durable fix/tracker:** a returned wrapper is not a verdict when owned descendants survive. Browser gates must capture a terminal test result, retain live output, track process-group ownership, and verify port/process cleanup; startup-only logs are absent proof.
- **Status:** stale owned processes cleaned; exact local C unverified and rerun required. No remote mutation; Fable prohibited.

### 2026-07-15 · Wave 4 preflight — #408 cold-data ROI contract refreshed read-only

- **Symptom:** not a testing blocker; #408 cannot measure cold-data ROI or choose a loading seam before #406 lands one architecture with exact-main Required and matching release-artifact proof.
- **Detection evidence:** live `origin/main` is `b6d9389d047b6e4d87b66e90348d137f6e32fd71`; issues #406 and #408 remain open; #408 has no branch/worktree. Its file scope is disjoint from #407's docs-only ADR reconciliation, while #409 explicitly waits for both.
- **Impact:** the secondary cold-data lane is agent-ready without starting speculative storage work. After #406, #407 and #408 may execute in parallel; neither may allow #409 to start alone.
- **Root cause:** cold-data benefit and break-even depend on the selected renderer/residency baseline, while saved-Board lifecycle complexity must be justified independently rather than assumed from render-path evidence.
- **Unblock/workaround:** use deterministic privacy-safe fixtures that independently vary unselected versions, historical follow-ups, provenance/source/compiled instructions, RunRecords, settings, intent/history, and one combined-heavy case while holding visible core content, geometry, selection, image inputs, connections, selected renderer, viewport, choreography, and digests fixed. Partition exact Board bytes and parse/normalize/validate/hydrate/serialize/rewrite from idle heap/index/derivation/readiness/navigation/selection/modal costs, and from on-demand request/load/error/offline/cache/evict/retry/reopen/export costs. Keep compressed image storage, decoded pixels, rendition residency, decode, paint, and image-cache growth separate.
- **Durable fix/tracker:** correctness vetoes protect saved-Board authority, semantic context, execution, playback, provenance, export, offline behavior, search/copy/AX reporting, and bounded loading/error/cache/retry/reopen/serialization lifecycles. Require noisy effects of at least `max(10%, 2 × MAD / median)`; exact bytes count only when rewrite or threshold behavior is material. Choose exactly one of no change, eager loading, or on-demand loading for named payloads. On-demand requires measured benefit, all vetoes, explicit budgets, bounded lifecycle, and a named owner; report break-even without inferring usage frequency. Carry #413's unmeasured-storage, zero-deferral, and narrow search/copy/AX limitations rather than generalizing them.
- **Status:** hard-blocked only by #406 merged/exact-main proof; no branch/worktree or feature mutation. Synthetic temporary `EIDO_DATA_FILE` only; never `~/.eido`, real saves, production preview, current-save browser perf, or migration paths. Provider exact-head proof, RED/GREEN contract tests, `npm run ci:required`, scope, Required/Browser investigation, fresh implementation/evidence reviews, merge captain, and exact-main artifact remain mandatory. Opus 4.8 preferred; fresh Sol/Terra fallback authorized; Fable prohibited.

### 2026-07-15 · Wave 2B — #404 isolated C rerun was terminated before its own bound

- **Symptom:** Terra's isolated C rerun on port `5184` was terminated at 1:27 with exit `143`, before the declared 120-second outer bound plus cleanup grace, so the attempted repair still produced no terminal C verdict.
- **Detection evidence:** the only valid result from this turn is the focused helper suite, 13/13 GREEN. No C phase or overall result is claimable; owned process cleanup after termination did succeed.
- **Impact:** exact local C remains unverified, B remains forbidden, and the preserved local route/helper diff cannot advance to commit, push, provider capture, PR, or merge from this run.
- **Root cause:** orchestration killed the owned test process early instead of allowing its documented outer bound and grace to produce a terminal result, following the earlier false-terminal/orphan lifecycle mistake.
- **Unblock/workaround:** revoke Terra's provider-run authority while preserving its diff. Fresh Sol owns one supervised rerun with live output captured through `tee`, a unique port, a known PGID, explicit terminal-result and exit-code capture, at least 120 seconds plus grace, and ownership-checked cleanup.
- **Durable fix/tracker:** gate supervisors must distinguish a test's bound from the caller's patience window. A signal-derived exit is absent proof unless the test itself reports the intended bounded failure; focused helper greens never substitute for the full C choreography/correctness transaction.
- **Status:** second local C attempt invalid; fresh Sol supervised rerun required. No remote mutation; Fable prohibited.

### 2026-07-15 · Wave 5 preflight — #409 production sequence contract stops before owner kickoff

- **Symptom:** not a testing blocker; #409 cannot publish a trustworthy production graph until both #407 and #408 are merged with exact-main Required and matching release artifacts, and it must not turn planning authority into an implicit implementation kickoff.
- **Detection evidence:** live `origin/main` is `b6d9389d047b6e4d87b66e90348d137f6e32fd71`; issues #407, #408, and #409 remain open; #409 has no branch/worktree. The canonical issue requires agent-sized slices but the epic definition explicitly forbids beginning the final production migration without a new kickoff.
- **Impact:** the final planning lane is agent-ready while production remains safely out of scope. Its output will be one blocked production epic, retained child issues, native blocking edges, and an explicit owner-kickoff blocker—not branches, worktrees, flags, CI runs, PRs, or implementation.
- **Root cause:** an implementation sequence spans shared Board, Card, image, fixture, workflow, and saved-Board hotspots; publishing tickets without exact serialization, conditional pruning, and a stop boundary would create parallel conflicts or silently authorize migration.
- **Unblock/workaround:** after #407/#408 exact-main proof, write the next-free sequence study (expected `21` only if still free) and publish one graph: S0 characterization → S1 Board residency → S2 Note → file-disjoint parallel S3 Result and Conversation; conditional S4 image runtime → S5 gallery/consumers joining S6 integration; conditional S7 cold data; S8 burn-in/docs/cleanup. Omit S4/S5 or S7 completely when the corresponding measured decision is no change, repairing edges rather than leaving placeholder alternatives. Serialize `Board.tsx`, `boardScene*`, residency/interaction, shared activation/geometry/styles, fixtures/choreography/browser config, image resolver/cache/gallery, and save/serialization seams; S3 lanes are parallel only when their entire owned scopes are disjoint.
- **Durable fix/tracker:** every retained issue must state native edges, exact owns/forbids, one user-visible vertical outcome, frozen fidelity/interaction/AX/save obligations, RED-first tests, exact evidence lineage and repetition/materiality policy, memory/image/cache/repeated-traversal budgets, rollback/default owner, synthetic-data safety, CI/review/captain/exact-main gates, docs, cleanup, loose-end disposition, and model route. Map #417/#419/#420/#422/#423 to one ticket/prerequisite or explicit non-blocking owner. Verify one acyclic frontier still blocked by the open owner-kickoff issue after #409 merges, then stop.
- **Status:** hard-blocked on #407 and #408 merged/exact-main proof; planning/tracker-only contract recorded, no mutation. Production implementation requires a new explicit owner kickoff. Opus 4.8 preferred; fresh Sol/Terra fallback authorized; Fable prohibited.

### 2026-07-15 · Wave 2B — #404 supervised phase diagnostic produced the authoritative C RED

- **Symptom:** exact C still timed out, but the fully supervised run returned exit `1` and completed owned-process cleanup, making it the sole authoritative local C phase result after two invalid lifecycle attempts.
- **Detection evidence:** the two reset phases completed in 549 ms and 674 ms; activation completed in 119 ms and 166 ms; click/outcome completed in 239 ms and 229 ms; exact-route cleanup stayed at or below 18.8 ms. No third setup tag appeared before the 120-second bound, and the terminal snapshot showed the Note editor still active.
- **Impact:** exact C is conclusively RED and B remains forbidden. The timings rule out reset, popup/navigation, route cleanup, and the remaining measured first-click path as the surviving wait; no commit, push, provider capture, PR, or merge is authorized.
- **Root cause:** the surviving boundary is an untagged post-anchor focus-retention block while the pinned/focused Note editor remains active.
- **Unblock/workaround:** authorize a fresh focused Sol remediation: first capture an exact RED around the blocking await, preserve the pinned and focused Note contract, then replace the unobservable wait with a bounded observable fail-closed check. Do not skip the assertion/phase. Rerun exact C with terminal, exit, and owned-cleanup proof before B.
- **Durable fix/tracker:** phase diagnostics need tags around every potentially blocking await, not only major choreography steps. Fast preceding effects narrow causality but never convert the final timeout into green; focused remediation must remain mutation-falsifiable and fail closed.
- **Status:** authoritative C RED, focused Sol remediation authorized; no remote mutation, Fable prohibited.

### 2026-07-15 · Runtime friction — Node 20 was available only through a prior npx cache

- **Symptom:** the workspace dependency resolver did not return runtime paths within 60 seconds and had to be terminated; the normal host lookup did not otherwise expose Node 20.
- **Detection evidence:** a previously populated npx cache contained the usable Node 20 runtime. The terminated resolver produced no path result and counts as absent proof.
- **Impact:** bootstrap delay only; the authoritative #404 diagnostic still ran using the verified cached runtime, with no product, Git, provider, or CI mutation caused by the resolver failure.
- **Root cause:** unresolved workspace dependency discovery hang combined with Node 20 not being present on the ordinary host path.
- **Unblock/workaround:** reuse the already verified cached Node 20 executable for the focused loop, keep its path/provenance explicit, and terminate rather than indefinitely wait on the resolver.
- **Durable fix/tracker:** runtime bootstrap should return a bounded failure and document the supported cached fallback; a resolver timeout is tooling friction, never a product-test red or green.
- **Status:** unblocked through cached Node 20; resolver hang remains a DevOps friction item, Fable prohibited.

### 2026-07-15 · Wave 2B — #404 focus helper proved and bounded the redundant-focus stall

- **Symptom:** the focused RED demonstrated that calling `focus()` again can stall when the intended Note editor already retains focus.
- **Detection evidence:** the repaired five-case helper suite is 18/18 GREEN and typecheck is GREEN. It covers already-retained focus, restore plus containment proof, a deliberately stalled focus that fails closed at two seconds, wrong-card rejection, and root replacement without accepting stale ownership.
- **Impact:** the helper now preserves the pinned/focused contract and bounds the known redundant-focus failure. This is focused helper evidence only; it does not make exact C green or authorize B.
- **Root cause:** the helper previously treated focus acquisition as an action to repeat rather than an observable state that might already be satisfied.
- **Unblock/workaround:** return on verified retained focus; otherwise request focus and require bounded containment/ownership evidence, failing closed on stall, wrong Card, or replaced root.
- **Durable fix/tracker:** a late-rejection test initially fired before its assertion handler was attached, causing order-dependent noise. Attach the handler before triggering the deliberate rejection; keep the failure case and two-second bound intact.
- **Status:** helper 18/18 and typecheck GREEN; exact C still required, no remote mutation, Fable prohibited.

### 2026-07-15 · Wave 2B — #404 port-5189 exact C stayed RED and corrected the localization claim

- **Symptom:** the supervised exact C rerun on isolated port `5189` still failed at the same 120-second Note timeout despite the green focus helper.
- **Detection evidence:** test and supervisor both exited `1`; owned process/port cleanup was verified. The terminal snapshot showed an active textbox inside the Live Giant Note with both links present. No monotonic stage tags existed to prove that third setup began.
- **Impact:** B remains blocked and no exact await may yet be named. The prior post-anchor focus-retention attribution is now only a helper-supported hypothesis, not an exact-C root-cause claim; no commit, push, provider capture, PR, or merge follows.
- **Root cause:** still unlocalized between the last observed anchor phase and third setup because the exact choreography lacks a marker at every await boundary.
- **Unblock/workaround:** authorize temporary monotonic stage markers in both console output and page state around every await from anchor cleanup through third setup. Run exactly one supervised C diagnostic; preserve current behavior, timeout, repetitions, assertions, and owned cleanup. Do not skip any phase.
- **Durable fix/tracker:** diagnostics must distinguish helper causality from full-choreography causality. Snapshot state and absent tags narrow observation but cannot prove a phase began; instrumentation is non-evidence and must be removed or explicitly adjudicated after localization.
- **Status:** authoritative exact C RED; one instrumentation-only diagnostic authorized, B blocked, no remote mutation, Fable prohibited.

### 2026-07-15 · Wave 2B — interrupted turn preserved the sole marker diagnostic but exposed a supervisor budget bug

- **Symptom:** after an orchestrator-turn interruption, the full temporary marker patch and sole authorized C diagnostic were still live, but its generated Node supervisor used a 120-second wall-clock deadline that included webserver startup and was therefore shorter than Playwright's own 120-second test bound.
- **Detection evidence:** the existing run is on port `5190` with child process group `40169`, Vite PID `40350`, and supervisor PID `40156`. Read-only reconciliation found the child and Vite still running while the supervisor alone was stopped; no terminal test result exists yet.
- **Impact:** allowing the faulty supervisor deadline to fire would prematurely kill another valid diagnostic; restarting would violate the one-run authorization and could create competing servers/process trees. Current state is in progress, never green or red evidence.
- **Root cause:** the generated supervisor started its deadline before the Playwright webserver was ready, conflating total orchestration wall time with the test runner's bounded execution window.
- **Unblock/workaround:** preserve the marker patch and existing run. `SIGSTOP` only supervisor PID `40156`, leaving owned child PGID `40169` active. Observe the child externally through its terminal result plus 30 seconds grace; only after child exit, `SIGCONT` the supervisor so it can record the result and perform owned cleanup. Do not start a second run or change behavior/timeouts.
- **Durable fix/tracker:** browser supervisors need separate startup, test, and cleanup budgets and must start the test deadline from an observable readiness/test boundary. Interrupted turns require live process/patch reconciliation before retry; a surviving run is continued, not duplicated.
- **Status:** sole diagnostic active under external observation; terminal classification and cleanup pending, B blocked, no remote mutation, Fable prohibited.

### 2026-07-15 · Wave 2B — sole marker child reached exit 1 while its stopped supervisor awaited reaping

- **Symptom:** live reconciliation advanced after the previous checkpoint: child PGID `40169` became defunct and its exit file recorded `1`, while supervisor PID `40156` remained intentionally stopped.
- **Detection evidence:** Vite PID `40350` is absent and port `5190` is free. The stopped supervisor has not yet reaped the child or written its final record, and the marker output has not yet been adjudicated.
- **Impact:** the sole run has a terminal child exit but is not fully cleaned or localized. Exit `1` alone cannot name the blocking await; B and all downstream gates remain blocked.
- **Root cause:** expected intermediate state from stopping only the faulty supervisor so the child could complete without its premature wall-clock deadline.
- **Unblock/workaround:** after the terminal result plus 30-second grace, continue only supervisor PID `40156` so it can record/reap; verify all owned cleanup and inspect the monotonic markers before classifying the diagnostic. Do not launch a second run.
- **Durable fix/tracker:** supervisor intervention protocols must explicitly account for zombie/reap state and separate child terminal observation from final supervisor/cleanup completion.
- **Status:** child exit `1` observed; supervisor reap and marker analysis pending, no remote mutation, Fable prohibited.

### 2026-07-15 · Wave 2B — sole marker diagnostic rooted #404 in stale remounted-locator resolution

- **Symptom:** after the supervisor was continued and reaped the child, the sole port-5190 diagnostic still terminated test/supervisor exit `1/1`, but its markers precisely localized the 120-second Note timeout.
- **Detection evidence:** page and terminal snapshot reached `focus-link-evaluate:start`; Node later emitted `focus-link-evaluate:error`; no page completion marker appeared. `await focusLink.evaluate(...)` held for approximately 116.754 seconds after the focus helper, Live transition, Shift+Tab, and Tab had completed.
- **Impact:** the exact C root is now stale/remounted locator resolution, not the product's pinned focus contract, popup behavior, reset, route cleanup, or first-click outcome. B and all downstream gates remain blocked pending a bounded fix.
- **Root cause:** the stored link locator referred to an element identity invalidated by the Live Card remount; locator resolution could wait nearly the full test timeout before the helper obtained page state.
- **Unblock/workaround:** use one bounded atomic `page.evaluate` rooted in stable activation-root and Card identity, returning structured active-element, Card-mode, containment, identity, and restore-needed states. Only the explicit restore path may reacquire the current Live link. Add an exact RED proving a stale/stalled locator cannot block, retain all five focus-helper cases, remove the temporary markers, and do not raise timeouts or weaken pinned/focused behavior.
- **Durable fix/tracker:** browser helpers must resolve remount-sensitive state from a stable ownership root in one bounded page operation; cached locators cannot cross a representation remount unless their lifecycle is explicitly refreshed. Temporary diagnostic markers are removed after localization.
- **Status:** root cause localized and focused Sol fix authorized; exact C remains RED, B blocked, no remote mutation, Fable prohibited.

### 2026-07-15 · Supervisor friction — overdue cleanup timer signaled an already-dead group

- **Symptom:** after the stopped supervisor was continued, it successfully recorded/reaped and cleaned the run, then an overdue timer attempted `TERM` on the already-dead process group and received `EPERM`.
- **Detection evidence:** supervisor, child, Vite, and port are all absent; the diagnostic record and cleanup completed before the late signal error.
- **Impact:** harmless cleanup noise only; no evidence corruption, product failure, leaked process, or second run.
- **Root cause:** the delayed deadline signal path was still eligible after the externally observed child exit and supervisor continuation.
- **Unblock/workaround:** classify `EPERM` on the already-dead owned group as harmless after independent absence/cleanup proof; do not retry or broaden signals.
- **Durable fix/tracker:** supervisors should cancel deadline and delayed-signal timers before reaping/exit recording, and distinguish already-dead-group errors from failed cleanup.
- **Status:** fully cleaned and unblocked; Fable prohibited.

### 2026-07-15 · Wave 2B — atomic focus seam passed helpers but port-5191 exact C stayed RED

- **Symptom:** the stable-root atomic focus seam reached 22/22 helper tests and typecheck GREEN, yet the supervised exact C run on port `5191` failed at the same 120-second Note correctness timeout.
- **Detection evidence:** test and supervisor both exited `1`; B was not run. Owned cleanup completed, port `5191` is free, and unrelated port `5407` was untouched. This run emitted no finer phase markers.
- **Impact:** the helper fix is not browser-verified and no new exact-C root cause can be claimed. B, commit/push, provider capture, PR, and merge remain blocked.
- **Root cause:** unknown Playwright API call within the Note correctness phase; green helper coverage does not identify the full-browser call that remains pending.
- **Unblock/workaround:** run exactly one source-unchanged supervised C with `DEBUG=pw:api` plus trace and error context. Capture the last Playwright API call begun and the begun call that never completed; preserve behavior, timeout, repetitions, ports, and cleanup. Use that evidence to authorize one bounded TDD fix only.
- **Durable fix/tracker:** every browser timeout diagnosis must distinguish unit/helper proof from end-to-end browser proof. When phase markers are too coarse, prefer the runner's API log and trace before adding more source instrumentation or guessing another root.
- **Status:** helper/typecheck GREEN, exact C RED, one diagnostics-only API trace authorized; B blocked, no remote mutation, Fable prohibited.

### 2026-07-15 · Wave 2B — Playwright API trace rooted the remaining #404 hang in external-target metadata lookup

- **Symptom:** the source-unchanged `DEBUG=pw:api` diagnostic on port `5193` terminated RED/exit `1`; one post-remount metadata call began and did not complete before context close.
- **Detection evidence:** `locator.evaluate` on the external exact-target selector began at approximately 03:27:15 and remained pending until context close at approximately 03:29:12. Shift+Tab, Tab, and the atomic stable-root `page.evaluate` had already succeeded; the atomic call took 38 ms. The terminal snapshot showed the Note Live and active with both links visible.
- **Impact:** exact C remains RED and B remains blocked, but the last noncompleted browser API is now known. Cleanup completed, port `5193` is free, and unrelated port `5407` was untouched.
- **Root cause:** a post-remount Locator-based metadata read waits on an external exact-target element identity that can become stale even though the current Live Note and both links are present.
- **Unblock/workaround:** authorize one bounded TDD fix: eliminate and audit every post-remount `Locator.evaluate` used for Note/link metadata; use bounded atomic `page.evaluate` rooted in stable Card identity plus exact `href` and `target`, returning structured identity/metadata/mode/containment/restore states. Preserve the sole real `locator.click` for intended first-click proof.
- **Durable fix/tracker:** add a RED proving a stalled/remounted locator evaluation cannot block correctness. Keep atomic-focus and five-case helper coverage, do not raise timeouts, and distinguish metadata observation from the one real user interaction.
- **Status:** exact API root localized and one focused Sol TDD fix authorized; no remote mutation, Fable prohibited.

### 2026-07-15 · Wave 2B correction — stalled line 1310 call is blur cleanup, not metadata

- **Symptom:** the previous checkpoint described the stalled external-target `locator.evaluate` too broadly as a metadata lookup.
- **Detection evidence:** exact source correlation identifies line 1310 as `focusLink.evaluate(blur)`. Its passive `focusSelector` ancestor disappears when the Card remounts Live, although the link itself remains visible and interactive.
- **Impact:** the browser root remains valid but the authorized change must stay narrow; there is no evidence for a broad link-metadata rewrite.
- **Root cause:** blur cleanup reused a Locator chained through the pre-remount passive ancestor, so Playwright waited for an ownership path that no longer existed.
- **Unblock/workaround:** use bounded atomic `page.evaluate` rooted in the exact stable Live Card. Blur `document.activeElement` only when contained by that Card and return `blurred`, `already-unfocused`, `wrong-card`, or `missing-card`; fail wrong/missing closed and boundedly observe focus leaving before reset. Retain the one real link click.
- **Durable fix/tracker:** audit remaining post-remount `Locator.evaluate` calls, but expand only where exact evidence shows the same lifecycle fault. Do not widen metadata behavior, raise timeouts, or weaken focus correctness.
- **Status:** semantic correction recorded; one narrow blur-cleanup TDD fix authorized, B blocked, no remote mutation, Fable prohibited.

### 2026-07-15 · Wave 2B — atomic blur fix advanced exact C to a fast first-click observer RED

- **Symptom:** the atomic blur fix reached 31/31 helper tests and typecheck GREEN; exact C on port `5194` no longer hung, but failed after 6.6 seconds at `note first click must be observed inside its rich region` with expected `true`, received `false`.
- **Detection evidence:** test and supervisor exited `1/1`. The stable Card listener received the real click, but its callback re-queried the vanished passive `rootSelector` after the Live remount. B and a repeat run were not started; owned cleanup completed and port `5194` is free.
- **Impact:** the blur lifecycle repair is causally effective, while first-click observation remains RED. No commit, push, provider capture, PR, or merge is authorized.
- **Root cause:** the observer is attached to stable Card ownership but validates rich-region membership through a passive-root query whose ancestor no longer exists after activation, so it reports false despite the real intended click.
- **Unblock/workaround:** validate the real event's `composedPath()` against stable Card identity, the exact current Live anchor `href`/`target`, and an explicit Live or shared rich-region element. Header, wrong Card, wrong link, and detached targets return false; install once and always clean up. Retain the sole real `locator.click`; do not synthesize or dispatch input.
- **Durable fix/tracker:** add mutation-falsifiable cases for vanished passive roots, header/wrong-card/wrong-link/detached paths, and listener cleanup. Do not raise timeouts or replace user-input proof with dispatch.
- **Status:** one bounded composed-path TDD fix authorized; exact C RED, B blocked, Fable prohibited.

### 2026-07-15 · Process-audit friction — fast exit raced PGID capture and truncated cleanup logging

- **Symptom:** the fast port-5194 failure let process teardown race the PGID audit, leaving the cleanup record truncated.
- **Detection evidence:** independent process/port checks established the owned run was gone and port `5194` free; only synthetic owned cleanup required manual completion. No B or second C was started.
- **Impact:** cleanup-evidence noise only; no leaked process, unrelated-process mutation, or product ambiguity.
- **Root cause:** audit/log collection was slower than the short causal browser failure and assumed the process group would remain observable.
- **Unblock/workaround:** verify process and port absence independently, manually remove only synthetic owned artifacts, and record the truncated audit as absent proof rather than retrying the product run.
- **Durable fix/tracker:** create the audit manifest before launch and make cleanup logging atomic so fast exits cannot erase ownership provenance.
- **Status:** cleaned and unblocked; Fable prohibited.

### 2026-07-15 · Wave 2B — durable observer exposed an exact `live-root-missing` RED

- **Symptom:** the durable observer reached 50/50 tests and typecheck GREEN, but supervised exact C on port `5196` failed after 6.3 seconds with the structured reason `live-root-missing`.
- **Detection evidence:** safe scalar diagnostics show target attached, Card attached, target in path, and Card in path are all true; every configured `liveRoot` boolean is false and anchor count is zero. The run exited `1`; cleanup completed and port `5196` is free.
- **Impact:** the event/ownership observer is working and the remaining gap is an inaccurate Live rich-region seam. B was not run, no rule changed, and no implementation/PR claim follows.
- **Root cause:** existing configured Live-root selectors do not match the actual Live markup for this Note despite the intended target and Card being attached and present in the composed path.
- **Unblock/workaround:** authorize a bounded read-only Sol design across the five region components, correctness configuration, and terminal snapshot. Select either explicit per-config Live selectors or one shared stable data attribute; the seam must contain the target, occur in the event path, exclude Card chrome, and require no harness-only product override.
- **Durable fix/tracker:** require an explicit source-to-selector table for all five regions before editing. Do not infer a shared class from one Card type and do not run C during the design pass.
- **Status:** read-only design authorized; no edits, C rerun, B, rule change, remote mutation, or Fable.

### 2026-07-15 · Worktree friction — compacted context carried a stale path suffix

- **Symptom:** a worktree path suffix copied from compacted notes was stale and caused one prelaunch rejection.
- **Detection evidence:** failure happened before browser launch or product mutation; live `git worktree list` returned the authoritative current path.
- **Impact:** scheduling delay only; no duplicate C, process leak, Git mutation, or evidence claim.
- **Root cause:** compacted narrative preserved an outdated path string after worktree state evolved.
- **Unblock/workaround:** re-derive the path from live Git state and resume the unchanged command/contract.
- **Durable fix/tracker:** compacted paths are hints, never execution authority; every launch resolves the registered path against `git worktree list` first.
- **Status:** recovered before launch, Fable prohibited.

### 2026-07-15 · Wave 2B — authoritative scroll drift made #404 ineligible

- **Symptom:** the first instrumented product-contract drift occurs at `content-visibility-activation` even though controlled-node and Card identities remain unchanged.
- **Detection evidence:** passive internal scroll was top/height/max `28090/79303/78439` under `content-visibility: auto` with intrinsic sizing. Live became `21815/22679/21815`, `content-visibility: visible`, and no intrinsic placeholder in 41.6 ms. The browser clamped scroll to the Live maximum; click and settled behavior were otherwise unchanged.
- **Impact:** the candidate cannot preserve long-card internal scroll continuity and is therefore `selectable=false`. It must supply negative evidence to #406 rather than continue product/harness rescue work.
- **Root cause:** the intrinsic placeholder used while browser-skipping content represents a much taller scroll range than fully rendered Live content, so the retained deep scroll position exceeds the Live maximum and is clamped.
- **Unblock/workaround:** no bounded rescue is proven. An `auto` fallback is unproven for unseen content; calibrated intrinsic sizing defeats skipping and introduces cache/lifecycle architecture; anchor restoration is a separate architecture. Keep product contracts frozen. File/retain a rescue follow-up only if #406 explicitly selects work that needs it; otherwise close #404 as ineligible.
- **Durable fix/tracker:** candidate comparison treats correctness vetoes before performance gains. Stable identity and unchanged click/settled behavior cannot compensate for internal-scroll loss.
- **Status:** authoritative candidate-ineligible pivot; no product migration or rescue, Fable prohibited.

### 2026-07-15 · Wave 2B — #404 negative-evidence schema v1 contract

- **Symptom:** the provider workflow previously assumed C must be green, but an authoritative ineligible candidate needs reproducible negative evidence without treating arbitrary failures as success.
- **Detection evidence:** the exact expected negative is internal-scroll continuity only; control B and every other C correctness gate remain green.
- **Impact:** #404 can publish a selectable-false report for #406 while remaining fail closed against unrelated browser, harness, schema, identity, or product failures.
- **Root cause:** positive-only evidence state machines cannot distinguish one validated disqualifying product result from a broken or partially captured run.
- **Unblock/workaround:** schema `candidate-ineligible-v1` requires B all green; C exits `1` with exactly one named failure plus a privacy-safe structured sidecar; the combined classifier is false solely for scroll. Validate finite values, internally consistent heights/maxima, passive top greater than Live max, Live top approximately equal to Live max within tolerance `1`, delta below `-1`, and identical node/Card IDs.
- **Durable fix/tracker:** enforce `pending → B-valid → C-negative → bundle-valid → atomic-publish`. Use `set +e` only around C, capture exit/status, immediately restore shell mode, and publish JSON report plus sidecar atomically. Never parse logs or use `|| true`. Unexpected pass, mismatch, malformed/unsafe sidecar, identity/relationship mismatch, or zero/multiple red gates blocks publication.
- **Status:** exact negative schema contract ready for RED/GREEN implementation and evidence review; product frozen, Fable prohibited.

### 2026-07-15 · Wave 2B — #404 negative-schema/writer slice 2 closed with mutation proof

- **Symptom:** not a surviving failure; the fail-closed schema and writer needed direct proof that each safety boundary detects its matching mutation before workflow/report integration could begin.
- **Detection evidence:** exclusive-create `wx`, destination guard, `finally` cleanup, schema/privacy validation, sole-negative cardinality, and Note relationship/identity contracts all produced RED under mutation. The initial Note test survived its intended mutant, so it was strengthened until the same mutant failed; source was then restored. Focused tests are 224/224 GREEN, typecheck GREEN, and diff check GREEN.
- **Impact:** the core negative-sidecar validator/writer is ready for slice 3 integration without weakening product contracts or treating arbitrary provider failures as accepted negatives.
- **Root cause:** the original Note assertion checked the happy structure but was not discriminating enough to falsify the targeted relationship mutation.
- **Unblock/workaround:** tighten the Note assertion around the exact relational invariant, rerun the mutant to RED, restore intended source, rerun all focused/type/diff gates, and obtain closure from the original adversarial reviewer.
- **Durable fix/tracker:** mutation proof is per safety boundary, and source restoration plus clean GREEN gates are part of the evidence. A test that survives its named mutant does not count, regardless of suite color.
- **Status:** slice 2 complete and adversarial review PASS; slice 3 workflow/report/docs/provider resumed, no remote mutation, Fable prohibited.

### 2026-07-15 · Review friction — broad reviewers recursively invoked code-review

- **Symptom:** two broad reviewer attempts overran the bounded closure request and recursively entered the code-review workflow instead of returning a direct verdict.
- **Detection evidence:** both turns were interrupted; neither produced a complete verdict or edited files.
- **Impact:** review scheduling delay only. Their partial output is absent proof and cannot supplement the original adversarial closure PASS.
- **Root cause:** broad prompts left enough procedural freedom for the reviewer to launch another review mode rather than adjudicate the named prior findings.
- **Unblock/workaround:** interrupt recursive attempts and use terse prior-finding prompts that request a direct PASS/BLOCKING verdict with no nested workflow.
- **Durable fix/tracker:** reviewer prompts must state the exact diff/finding boundary and forbid recursive review orchestration; no-verdict turns are absent, never green.
- **Status:** unblocked through original reviewer closure; no edits or Fable fallback.

### 2026-07-15 · DevOps integration — rebased candidate workflows failed the new experimental policy

- **Class:** CI/DevOps policy drift after rebase.
- **Symptom:** the rebased candidate workflow no longer satisfied the live workflow-policy gate even though its experiment remained manual evidence rather than merge CI.
- **Detection evidence:** the new policy required `# ci-class: experimental` on the first line, dispatch-only triggers, and the exact ` (experimental)` job-name suffix.
- **Root cause:** the candidate branch predated the experimental-workflow contract that had since landed on main.
- **Unblock/workaround:** updated the workflow to all three live conventions, exercised the policy tests, and reran the full canonical `npm run ci:required`; it remained GREEN.
- **Durable prevention:** every candidate rebase must re-read and run the current workflow-policy contract before provider dispatch; pre-rebase workflow validity is not portable proof.
- **Fail-closed status:** resolved without weakening the policy or treating an experimental run as Required evidence.

### 2026-07-15 · Shell friction — zsh reinterpreted prompt backticks and branch refspec text

- **Class:** shell/tooling invocation.
- **Symptom:** backticks embedded in shell-carried prompts and `$branch:`-shaped refspec text were vulnerable to zsh command/parameter parsing instead of reaching the intended tool literally.
- **Detection evidence:** affected invocations failed at shell/refspec parsing rather than at the requested Git or reviewer operation.
- **Root cause:** prompt and refspec data were composed as executable shell text without a literal transport boundary.
- **Unblock/workaround:** quote prompts as literal data, avoid interpolated command strings, and pass explicit full source/destination refs for Git operations.
- **Durable prevention:** use stdin or safely single-quoted prompt files for reviewer text and explicit `refs/heads/...:refs/heads/...` refspecs; never rely on an ambiguous `$branch:` fragment.
- **Fail-closed status:** no ambiguous invocation counted as review, push, or evidence; only the corrected command's result was eligible.

### 2026-07-15 · Scope audit — “base” meant two different change sets

- **Class:** review/scope accounting.
- **Symptom:** a scope check could describe either the current slice delta or the whole feature-branch union, producing apparently conflicting file counts.
- **Detection evidence:** the same branch was narrow relative to its latest slice checkpoint but broad relative to `origin/main`/the issue base.
- **Root cause:** reports named only “the diff” without naming both comparison points.
- **Unblock/workaround:** report the slice delta and whole-branch union separately, with explicit base SHAs/refs and file lists for each.
- **Durable prevention:** every worker, reviewer, and merge handoff must name `slice-base → head` and `issue/main-base → head`; disjoint-wave enforcement uses the whole-branch union while bounded remediation review may use the slice delta.
- **Fail-closed status:** ambiguous scope output is absent proof; no branch is declared in-scope until both comparisons are explicit.

### 2026-07-15 · Review friction — broad recursive review prompts consumed context without verdicts

- **Class:** review orchestration/context budget.
- **Symptom:** broad review attempts traversed large portions of the branch, recursively invoked review machinery, consumed substantial context, and returned no terminal PASS/BLOCKING verdict.
- **Detection evidence:** the attempts were interrupted or exhausted their useful context without a complete verdict; partial analysis made no files authoritative.
- **Root cause:** prompts did not bind the reviewer to exact files, named suspicions, and a terse terminal response.
- **Unblock/workaround:** replace broad recursive requests with fresh exact-file reviews that list the prior findings or concrete suspicions and require one direct PASS/BLOCKING result.
- **Durable prevention:** use wide review only for an intentional first architecture pass; closure rounds receive exact files, exact head, named risks, no nested orchestration, and a strict verdict format.
- **Fail-closed status:** no-verdict and partial reviews remain absent evidence; they never inherit PASS from a different round.

### 2026-07-15 · Provider reporting — Playwright 1.61 encoded the expected negative as one unexpected test

- **Class:** browser-provider/report-schema integration.
- **Symptom:** the intentionally ineligible C run could be misclassified if the workflow expected ordinary green-test JSON semantics.
- **Detection evidence:** Playwright 1.61 represented the qualified negative with `expected = 0` and `unexpected = 1`, plus the exact named terminal failure.
- **Root cause:** the negative-evidence classifier had to distinguish Playwright's reporter semantics from the candidate schema's higher-level “expected disqualifier” meaning.
- **Unblock/workaround:** require the exact `0/1` reporter counts and exact named terminal failure, validate the privacy-safe sidecar and its relational values first, and only then normalize the run into the bounded candidate-ineligible report.
- **Durable prevention:** pin reporter-version semantics in mutation-sensitive contract tests; never infer a qualified negative from exit code or aggregate counts alone.
- **Fail-closed status:** normalization occurs only after sidecar validation; missing, additional, renamed, contradictory, or malformed failures block publication.

### 2026-07-15 · Provider regression — control B connection choreography failed after rebase

- **Class:** provider/browser choreography and diagnostic observability.
- **Symptom:** control B's connection gesture failed after rebase despite prior green runs, and the retained artifact could not show whether hit testing, handle role, event receipt, or connection creation had failed.
- **Detection evidence:** the provider B failure contradicted earlier greens while the artifact lacked the observations needed to localize the changed path.
- **Root cause:** the control proved only its terminal outcome; it did not retain privacy-safe intermediate interaction evidence across a sequence-sensitive gesture.
- **Unblock/workaround:** introduce a diagnostics-only mode with three fresh isolated cohorts plus one sequence-sensitive cohort, recording bounded geometry, normalized element/handle roles, pointer-event receipts, connection-line presence, counts, residency, and a closed failure reason.
- **Durable prevention:** fragile provider choreography needs a cheap, bounded, privacy-safe diagnostic transaction before another expensive evidence capture; diagnostics stay separate from acceptance evidence.
- **Fail-closed status:** prior greens and an under-instrumented artifact do not exonerate the current head; B remains red until the exact current-head diagnostic and control pass.

### 2026-07-15 · Worker launch friction — Codex CLI and runtime bootstrap had four distinct failure modes

- **Class:** agent CLI/toolchain bootstrap.
- **Symptom:** worker launches encountered an empty prompt, repeated runtime discovery, nested-`npx` `EUSAGE`, and accidental exposure to host Node 24/npm 11 instead of pinned Node 20/npm 10.
- **Detection evidence:** each failure occurred before authoritative implementation or gate evidence; the host versions disagreed with the release profile and nested package-runner composition rejected its arguments.
- **Root cause:** prompt transport, runtime resolution, and package-manager selection were rediscovered ad hoc for each subprocess.
- **Unblock/workaround:** provide a non-empty literal prompt through a safe transport, reuse the verified `/tmp/eido-404-node-toolchain` binaries directly, invoke repo-local test binaries without nested `npx`, and verify `node -v`/`npm -v` before gates.
- **Durable prevention:** dispatch bootstrap should resolve and record one Node 20/npm 10 toolchain once, reject empty prompts before launch, and prohibit nested package runners.
- **Fail-closed status:** setup failures are neither product RED nor gate GREEN; only commands executed under verified Node 20/npm 10 count.

### 2026-07-15 · Connection diagnostic publisher — unsafe destination-write mutant was caught

- **Class:** evidence publication atomicity/TDD.
- **Symptom:** a direct destination write would pass the initial existence precheck yet could overwrite a destination created during the publication race.
- **Detection evidence:** replacing atomic `linkSync` publication with direct `writeFileSync(destination, bytes)` produced RED with 2 failures and 18 passes: the publish-failure and TOCTOU no-replace cases failed.
- **Root cause:** an existence precheck cannot serialize another publisher; exclusivity must be enforced by the filesystem operation that creates the destination.
- **Unblock/workaround:** restore same-filesystem `linkSync` no-replace publication, retain exclusive `wx` staging with bounded `EEXIST` retries/exhaustion, clean staging on write/link failure, and assert through the real filesystem that only the destination remains.
- **Durable prevention:** keep mutation-sensitive tests for destination races, staging collisions/exhaustion, write failure, link failure, and zero staging residue.
- **Fail-closed status:** restored focused suite is 20/20 GREEN under Node 20/npm 10; no unsafe mutant remains and publisher errors cannot create acceptance evidence.

### 2026-07-15 · Connection diagnostic schema — privacy and relational mutations were rejected

- **Class:** evidence schema privacy/semantic integrity.
- **Symptom:** raw browser strings or structurally plausible but contradictory observations could leak private data or falsely classify a connection failure.
- **Detection evidence:** the privacy/semantics mutation run produced RED with 10 failures and 27 passes; after restoring the closed validator, the suite was 37/37 GREEN.
- **Root cause:** open-ended tags, classes, selectors, URLs, fields, or tokens and independently validated status fields are insufficient for a privacy-safe relational diagnostic.
- **Unblock/workaround:** accept only normalized closed enums and exact keys, reject raw tags/classes/selectors/URLs and unknown fields/tokens, and validate outcome/failure reason against receipts, handles, line presence, and connection-count relationships.
- **Durable prevention:** retain explicit privacy-canary and contradiction mutants for every schema expansion; additions require a new closed token and relational rule rather than passing raw browser data through.
- **Fail-closed status:** malformed, unknown, contradictory, or privacy-unsafe diagnostics are rejected before writing or publication; 37/37 intended cases are GREEN.

### 2026-07-15 · Durable reviewer-routing policy — Fable remains prohibited

- **Class:** model routing/review evidence.
- **Symptom:** compaction, worker reuse, or vendor unavailability could otherwise reintroduce a reviewer the owner explicitly prohibited.
- **Root cause:** model-routing constraints are easy to lose when they live only in conversational context.
- **Unblock/workaround:** restate the rule in every registry, worker, reviewer, and handoff contract: **NEVER use Fable 5** for review, cross-validation, or evidence. Use exact Claude Opus 4.8 at maximum when available; otherwise dispatch a fresh independent `gpt-5.6-sol` or `gpt-5.6-terra` reviewer.
- **Durable prevention:** any Fable output is invalid and discarded; model/session identity is part of review provenance and is checked before a verdict counts.
- **Fail-closed status:** unavailable Opus does not block the epic because fresh Sol/Terra fallback is authorized, but it never authorizes Fable or stale/partial review evidence.

### 2026-07-15 · #404 connection diagnostic review blocked unsafe reconstruction and publisher races

- **Class:** evidence privacy, atomic publisher, and mutation-test design.
- **Symptom:** a fresh Sol review of the exact two-file connection-diagnostic change returned BLOCKING: validation returned the caller's object, so later `JSON.stringify` could invoke unvalidated `toJSON` or accessors; sparse cohort arrays bypassed `forEach`; `stagingName` could equal the destination; cleanup after a failed exclusive write could delete another publisher's file; and the race test did not separate staging from destination.
- **Root cause:** structural validation was mistaken for canonical data reconstruction, while staging ownership and race mutants did not model distinct competing publishers.
- **Unblock/workaround:** one Sol mutation-sensitive TDD fix must canonically reconstruct the accepted payload, enforce dense ordered cohorts, require a safe staging basename distinct from the destination, track ownership before cleanup, and add direct-write/race mutants that distinguish staging and destination. The same reviewer must re-review before any commit or provider run.
- **Durable prevention:** serializers receive only newly constructed closed-schema data; atomic cleanup removes only a staging file proven owned by the current writer; sparse arrays, accessors/`toJSON`, destination aliasing, and competing-publisher races remain permanent mutants.
- **Fail-closed status:** evidence remains blocked with no remote/provider mutation. **NEVER use Fable 5**; exact Opus 4.8 is the maximum cross-vendor route, with fresh Sol/Terra fallback only.

### 2026-07-15 · Reviewer friction — model-manager refreshes consumed a Sol wiring investigation

- **Class:** reviewer availability and verdict provenance.
- **Symptom:** fresh read-only Sol session `019f64dc-bfa9-74d0-a130-0459b1718852` corroborated the exact #404 seam and scenario-14/first-13 prelude, but repeated model-manager refresh timeouts prevented a final verdict after about eight minutes; the supervisor terminated it.
- **Unblock/workaround:** classify partial output as investigation hints only, never review evidence, and continue from the source/graph-grounded wiring contract already returned by the supervising subagent. No edits, provider run, or remote mutation occurred.
- **Durable prevention:** time-box catalog/model-manager refreshes; preserve partial findings only as non-authoritative hints; when a verdict is still required, dispatch a fresh authorized Sol/Terra reviewer with the bounded contract.
- **Fail-closed status:** no verdict means absent review proof. **NEVER use Fable 5**; exact Opus 4.8 is the maximum cross-vendor route, with fresh Sol/Terra fallback only.

### 2026-07-15 · #404 exact two-file schema blocker repair killed every publisher mutant

- **Class:** mutation-sensitive schema/publisher repair and toolchain compatibility.
- **Detection evidence:** five named mutants failed and were restored: serializing the original object `2/50` RED; sparse/original cohorts `2/50`; staging equal to destination `1/50`; cleanup after failed `wx` `3/50`; direct destination write `2/50`. TDD also exposed an inherited sparse-index hole `1/50` RED, fixed by requiring an own index. Final focused suite is 50/50 GREEN with typecheck and diff clean.
- **Unblock/workaround:** canonical reconstruction, dense own-index cohorts, distinct safe staging, ownership-tracked cleanup, and staging-only atomic writes now enforce the reviewed contract. `Object.hasOwn` was incompatible with the current TypeScript library target, so the own-index guard uses `Object.prototype.hasOwnProperty.call`.
- **Durable prevention:** retain all six mutants; compatibility helpers must preserve the exact own-property semantics rather than changing the TypeScript target or weakening density checks.
- **Fail-closed status:** the same independent reviewer closure is still in flight; no implementation commit, provider run, or remote mutation is authorized until PASS. **NEVER use Fable 5**; exact Opus 4.8 is the maximum cross-vendor route, with fresh Sol/Terra fallback only.

### 2026-07-15 · Reviewer friction — closure supervisor became a ghost after child exit

- **Class:** reviewer lifecycle and lost-result detection.
- **Symptom:** the same-reviewer #404 closure supervisor remained running after its Codex child exited, returned no verdict, and ignored status prompts.
- **Unblock/workaround:** classify the turn as ghost/lost-result and therefore absent review evidence; interrupt the stale supervisor and dispatch a fresh exact-two-file Sol closure reviewer. No branch, provider, or remote mutation occurred.
- **Durable prevention:** monitor both process state and the verdict/result artifact. Child exit without a verdict receives bounded grace, then triggers a fresh authorized review; a lingering supervisor is never treated as green.
- **Fail-closed status:** evidence remained blocked throughout. **NEVER use Fable 5**; exact Opus 4.8 is the maximum cross-vendor route, with fresh Sol/Terra fallback only.

### 2026-07-15 · #404 rebase refresh — three idle supervisors and a stale Node 20 path

- **Class:** collaboration lifecycle, toolchain discovery, and lease-safe refresh.
- **Symptom:** three collaboration rebase supervisors became live-but-idle with no shell, process, or report and were interrupted without mutation. The host defaulted to Node 24/npm 11, while the remembered `brew --prefix node@20` location had no executable; plugin-catalog/model refresh warnings were noisy but nonblocking.
- **Unblock/workaround:** preserve the parent orchestrator-only boundary by dispatching isolated ephemeral Sol CLI session `019f6508-2941-71b0-acfd-724f6fccde22`. It found a clean branch and `origin/main` `53677966…` already at the merge base, so rebase was a no-op. The verified cached toolchain at `/Users/weili/.npm/_npx/35d45ede6343d5f9/node_modules/.bin` supplied Node 20.20.2/npm 10.9.8; `npm run ci:required` passed 25 CI tools, workflow policy/build, bundle 386.1/450, and 112 files/1,556 tests. Force-with-lease moved and remotely verified `a402… → d14…`.
- **Durable prevention:** start a bounded activity timer at supervisor shell launch and fall back to an isolated CLI worker when no process/report appears; verify the actual runtime executable rather than trusting a package-manager prefix; record both expected and resulting lease SHAs.
- **Fail-closed status:** no conflicts occurred, but no PR/current-head remote check or provider evidence exists, so absence remains absent. This retro writer performed no push or PR action. **NEVER use Fable 5**; exact Opus 4.8 is the maximum cross-vendor route, with fresh Sol/Terra fallback only.

### 2026-07-15 · #404 diagnostic wiring — repeated Sol stream disconnects exhausted retries

- **Class:** implementation-worker transport reliability.
- **Symptom:** the Sol wiring session repeatedly disconnected while editing and was terminated after retries four and five rather than yielding a trustworthy terminal report.
- **Unblock/workaround:** preserve the worker's filesystem edits, terminate the unstable session, inspect the exact diff independently, and resume verification or repair in a fresh bounded worker instead of restarting or treating partial output as evidence.
- **Durable prevention:** checkpoint exact scope and worktree state across reconnects, cap transport retries, and separate preserved edits from untrusted session claims.
- **Fail-closed status:** disconnects did not discard edits, but no implementation, test, or review claim counted until independently rerun.

### 2026-07-15 · #404 diagnostic wiring — test typing failed after behavior tests passed

- **Class:** TypeScript test-fixture compatibility.
- **Symptom:** focused behavior tests passed, but typecheck rejected only the new test typing.
- **Unblock/workaround:** dispatch a fresh Terra worker against the exact test seam; it repaired the typing without changing runtime behavior, after which focused tests and typecheck passed.
- **Durable prevention:** include typecheck immediately after the first focused green and keep runtime and test-only type fixes in separate reviewable steps.
- **Fail-closed status:** focused test green did not stand in for typecheck green; both were required before the full gate.

### 2026-07-15 · #404 diagnostic wiring — workflow guards drifted an existing evidence contract

- **Class:** CI contract coupling and slice-scope expansion.
- **Symptom:** the first full `npm run ci:required` was RED in 1 of 1,562 tests because an existing evidence test expected literal `if: success()`/`if: failure()` guards, while diagnostic mode correctly added `diagnostic == false` conditions.
- **Unblock/workaround:** explicitly expand the worker contract by one sixth file, update only the stale workflow-expectation test with a fresh Terra worker, and rerun evidence (153/153), workflow policy (9/9), diagnostic (56/56), typecheck, and the full 1,562-test required gate to green.
- **Durable prevention:** map workflow consumers before declaring file scope; when a correct workflow condition changes, update its structural contract test in the same bounded slice and record the scope expansion before editing.
- **Fail-closed status:** the initial focused greens did not override the full-gate RED; publication remained blocked until the complete gate passed.

### 2026-07-15 · #404 adversarial review — Opus OAuth failed, authorized Sol fallback started immediately

- **Class:** cross-review provider availability.
- **Symptom:** the exact Claude Opus 4.8 review attempt failed immediately because its OAuth credentials had expired.
- **Unblock/workaround:** dispatch a fresh independent `gpt-5.6-sol` reviewer against the same bounded contract; it completed the adversarial review without waiting for credential repair.
- **Durable prevention:** make fresh Sol/Terra fallback part of every review contract so cross-vendor credential failure cannot stall the train, while retaining model/session provenance.
- **Fail-closed status:** the failed Opus attempt supplied no evidence. **Fable 5 was not used and remains prohibited**; only the fresh Sol verdict counted.

### 2026-07-15 · #404 adversarial review — browser-control paths had three P1 failure modes

- **Class:** Playwright control-flow correctness and diagnostic evidence integrity.
- **Symptom:** the Sol reviewer found that `Locator.boundingBox()` could auto-wait for an absent handle until the cohort deadline, timed-out mouse gestures were not cancelled and could contaminate a stale snapshot, and unexpected runtime exceptions after a sample were suppressed as `gesture-timeout`.
- **Unblock/workaround:** block provider execution and require a TDD repair with an injectable runtime seam: immediate atomic handle-presence snapshots, authoritative timeout snapshots plus context disposal and gesture settlement, rethrow of every unexpected error, and a shared outcome classifier used by validation and construction.
- **Durable prevention:** unit-test the real browser-control state machine, including absent-handle auto-wait, uncancelled gesture, stale-state, exception-misclassification, and classifier-divergence mutants; pure fabricated schema inputs are insufficient.
- **Fail-closed status:** the earlier full required gate remained necessary but not sufficient; no commit, provider artifact, PR, or merge is authorized until the P1 repair and closure review pass.

### 2026-07-15 · #404 release preflight — main advanced while the reviewed repair was dirty

- **Class:** parallel-development rebase safety.
- **Symptom:** the latest #404 release preflight showed the branch six commits ahead and one behind current main. The intervening #434 work was disjoint save-safety semantics, but the #404 runtime repair was still dirty and under review.
- **Unblock/workaround:** inspect the incoming change for overlap, record it as semantically disjoint, and deliberately defer rebase until every dirty repair edit is preserved and reviewable; do not risk overwriting or silently resolving behavior-bearing work merely to become current sooner.
- **Durable prevention:** preflight both commit topology and semantic/file overlap; preserve dirty work before rebasing, then rerun `npm run ci:required` and use `git push --force-with-lease` only after the repair checkpoint is safe.
- **Fail-closed status:** being one behind is tracked risk, not an immediate blocker; current-head CI and push evidence must be regenerated after the eventual rebase.

### 2026-07-15 · #404 diagnostic closeout — reviewer restarts and mutation-led repairs

- **Class:** reviewer lifecycle and adversarial runtime evidence integrity.
- **Symptom:** a final reviewer produced no terminal verdict and had to be restarted. Successive fresh Sol reviews then caught late-error suppression, one-sided handle collapse, and spoofable timeout error names as P1/P2 evidence-integrity defects.
- **Unblock/workaround:** treat the hung review as absent proof, restart it with the exact bounded diff, and repair each finding through discriminating TDD mutations before rerunning the same review contract. The final fresh Sol review passed with no blockers; **Fable 5 was not used and remains prohibited**.
- **Durable prevention:** require a terminal verdict artifact, model/session provenance, and mutation tests for error timing, asymmetric handle loss, and typed timeout identity before browser diagnostics count.
- **Fail-closed status:** no provider/browser run or PR exists yet, so review green does not imply evidence green.

### 2026-07-15 · #404 release refresh — preserve, rebase onto #434, gate, lease-safe push

- **Class:** parallel-development branch refresh and new CI operating system.
- **Symptom:** the reviewed diagnostic repair was initially dirty while main advanced through #434, so rebasing immediately could have risked losing or obscuring owned work.
- **Unblock/workaround:** preserve the clean reviewed change in a commit first, verify the incoming #434 line was file- and semantics-disjoint, rebase without conflicts onto main `218dc5af443ac521abbbcad822132c6b73883810`, then run the canonical gate under Node 20.20.2/npm 10.9.8. `npm run ci:required` passed 35/35 tooling tests, workflow/build/typecheck, bundle 386.1/450 KiB gzip, and 113 files/1,577 tests; `git push --force-with-lease` safely published and verified head `dc820d6ec12601781793108fa014f72925733513` with a clean worktree.
- **Durable prevention:** commit reviewed owned work before rebase, inspect incoming semantic overlap, regenerate the complete canonical gate on the rebased head, and always use lease-safe force updates.
- **Fail-closed status:** no conflicts remain, but no PR or provider/browser evidence exists yet; those gates remain pending. **Fable 5 was not used and remains prohibited**.

### 2026-07-15 · #404 provider evidence — diagnostic passed, sequential focus hygiene broke C

- **Class:** provider/browser harness state isolation and evidence observability.
- **Symptom:** the exact-head phase-1 diagnostic succeeded for all four cohorts and its digest validated. In phase 2, provider run [29414393355](https://github.com/limweili/eido/actions/runs/29414393355) passed control B, but the following C harness retained link focus and therefore the Live pin from the preceding activation; it timed out while waiting for the Card to become passive.
- **Root cause:** sequential provider activations did not explicitly release and verify focus before the next candidate gate. The passive expectation was sound; the harness carried activation state across phases.
- **Unblock/workaround:** repair the transition with an explicit focus release plus an observed release verification, retain the passive gate unchanged, and add a regression that reproduces the B-to-C sequence before retrying provider evidence.
- **Observability gap:** the failure upload omitted the staged negative JSON and sidecar, so it could not localize the pre-publication C failure from retained artifacts. The successful four-cohort diagnostic remained diagnostic-only, not acceptance evidence.
- **Durable prevention:** make focus-release/verification a named boundary between sequential provider activations and include staged negative JSON/sidecar in failure-only diagnostics without making them publishable acceptance artifacts.
- **Fail-closed status:** no report or candidate artifact was accepted; only non-evidence diagnostics were retained. The B pass did not override the C harness failure, and provider evidence remained fail closed. **Fable 5 was not used and remains prohibited**.

### 2026-07-15 · #404 repair refresh — main advanced during harness remediation

- **Class:** parallel-development rebase hygiene.
- **Symptom:** `origin/main` advanced to `349ae89ebbf0a1a7dedceb33db5dbc2d5ed0d0b7` while the focus-hygiene repair was being prepared.
- **Unblock/workaround:** the repair worker verified the incoming changes were disjoint, rebased cleanly with no conflicts, and produced new local head `2c4e64e` without guessing at product, architecture, or storage semantics.
- **Durable prevention:** re-derive main before each provider retry and preserve repair edits before any refresh; regenerate exact-head gates and provider evidence after rewritten lineage.
- **Fail-closed status:** rebase success does not qualify the candidate; review, required CI, and provider evidence must be regenerated on the new lineage.

## 2026-07-16 incremental checkpoint — #404 final evidence, landing, and cleanup

This checkpoint continues from retro head `9a69b6e9a619010881313a1f6916c306bc6004f8` and records the final #404 path without rewriting earlier observations.

### #404 ownership seam and fixture scale were larger than the initial slice implied

- **Category:** slice ownership and benchmark capacity.
- **Symptom:** the candidate touched a narrow Card-content idea but its proof crossed the activation owner, provider actions, fixture construction, Playwright workflow, evidence schemas, and report publication. The frozen synthetic rich-card fixture also exceeded 300,000 characters, making naive selectors, waits, and full-tree assertions materially expensive.
- **Root cause:** the product seam is not a CSS property alone; it spans passive/live authority and every interaction that can pin or activate a Card. The benchmark was intentionally giant, but the slice contract did not initially make the cost of repeated whole-fixture queries explicit.
- **Unblock:** keep one owner for the full #404 evidence seam, serialize shared hotspots, use stable Card/region identities and bounded relational probes, and split review-only/evidence-only subtasks without splitting feature ownership.
- **Prevention:** map runtime ownership plus evidence consumers before dispatch; record fixture bytes/characters and expected query complexity in the slice contract; reserve separate owner seams only when files and invariants are disjoint.
- **Fail-closed:** no worker or reviewer could claim a partial CSS/result win as #404 acceptance; only the complete same-lineage bundle counted.

### Selector and highlight drift repeatedly produced plausible but false browser proof

- **Category:** selector fidelity and fixture discrimination.
- **Symptom:** broad descendant and `:last-child` selectors matched adjacent highlight/erase-control SVGs or stale passive roots after activation. Assertions could observe the wrong element while still returning structurally plausible values.
- **Root cause:** the synthetic fixture did not initially distinguish the intended passive renderer from sibling controls, and activation remounts invalidated locators rooted in the passive subtree.
- **Unblock:** add discriminating fixture siblings, use exact renderer/region selectors, anchor ownership at the stable Card, and reacquire the current Live descendant only inside one atomic page evaluation.
- **Prevention:** every selector used as evidence needs a negative sibling case and a remount case; never infer renderer identity from DOM position alone.
- **Fail-closed:** missing, duplicated, stale, or wrong-owner targets became explicit RED outcomes instead of falling through to a nearby element.

### Scale-aware geometry needed separate maximums for ordinary and giant regions

- **Category:** geometry tolerance and workload scaling.
- **Symptom:** one fixed pixel allowance either rejected legitimate giant-card geometry or let meaningful ordinary-card drift through. Early assumptions also embedded fixed 40-pixel offsets that did not survive viewport and content scale changes.
- **Root cause:** region geometry and scroll ranges scale differently; a single magic constant hid whether the test measured rounding, clamp, or real layout drift.
- **Unblock:** replace fixed offsets with relative visible-intersection geometry and scale-aware bounded limits: maximum 4 pixels for ordinary regions and maximum 8 pixels for giant-region cases, with the stricter relational scroll invariants retained.
- **Prevention:** derive tolerances from the measured boundary class and keep mutation tests for the old 40-pixel assumption.
- **Fail-closed:** values outside the correct scale class remain vetoes; the larger giant-card allowance cannot mask ordinary-region failure.

### Positive-validator coupling made the first negative-evidence design unsafe

- **Category:** evidence schema architecture.
- **Symptom:** the initial candidate-ineligible path reused validators built for successful B/C artifacts. A deliberately failed C run could be rejected for being negative, or worse, partially reshaped into a positive-looking artifact.
- **Root cause:** successful-candidate and rejected-candidate lifecycles have different terminal states, cardinality, and publication rules.
- **Unblock:** introduce a closed negative lifecycle and schema, then evolve it from v2 to v3 when the evidence gained matched B/C sidecars, three independently derived vetoes, and explicit unresolved limitations.
- **Prevention:** model positive, diagnostic, and terminal-negative evidence as distinct state machines; shared primitives may be reused, but terminal validators and publishers must not be coupled.
- **Fail-closed:** an unexpected C pass, extra failure, missing veto, positive artifact shape, or mixed lifecycle cannot be published as candidate-ineligible evidence.

### Browser Find and Selection are different oracles

- **Category:** search/copy measurement limitations.
- **Symptom:** headless Chromium's `window.find` returned true for the unique synthetic marker, while `window.getSelection()` did not expose the browser Find UI match.
- **Root cause:** browser Find UI state is not equivalent to DOM Selection API state in headless automation.
- **Unblock:** prove one global marker occurrence, one owning semantic region, and successful browser Find separately; report DOM-selection exposure as `not-exposed` rather than calling search broken or green by proxy.
- **Prevention:** define separate oracles for browser search, DOM selection, clipboard copy, and accessibility; never substitute one API for another.
- **Fail-closed:** the limitation is measured and reported, not waived or converted into an authorized product sacrifice.

### Focus proof needed exact targets, remount awareness, and keyboard-path coverage

- **Category:** activation/focus interaction correctness.
- **Symptom:** redundant `focus()` calls could stall; passive locators became stale after Live remount; retained focus kept Cards pinned across later scenarios; keyboard focus sometimes proved only Card containment, not the intended control.
- **Root cause:** the harness treated focus as a single locator action instead of a state transition across passive/live ownership, remount, and release.
- **Unblock:** use bounded atomic focus helpers that accept already-focused targets, reacquire after remount, require exact intended target/owner containment, cover Shift+Tab/Tab paths, and explicitly release plus verify focus between sequential scenarios.
- **Prevention:** every activation test must cover retained focus, restore, wrong Card, root replacement, keyboard entry, and release; use stable owner identity rather than a stale descendant locator.
- **Fail-closed:** timeout, wrong target, missing Live root, or unverified release aborts the evidence transaction.

### The Result zero-lead retarget was a genuine product veto

- **Category:** first-intent product correctness.
- **Symptom:** one trusted physical click was armed on connected non-interactive Result content; hover activation completed before dispatch, but the click landed on a different target outside the intended rich region while staying inside the same Card.
- **Root cause:** activation changed hit targeting during the zero-lead hover-to-click race. Card, scroller, region root, and prepared target identities surviving ruled out a generic remount or detached-target explanation.
- **Unblock:** encode the exact operands as the closed `result-first-intent-retarget` veto and require the Result gate to reference it; do not rescue the candidate with synthetic dispatch or a second click.
- **Prevention:** future architectures must queue/replay the intended interaction or provide an equivalent true single-click path, tested with a real physical click and zero explicit hover delay.
- **Fail-closed:** one observed trusted retarget is sufficient to make this candidate non-selectable even when all other Result gates pass.

### v2 to v3 schema evolution captured complete B/C relational evidence

- **Category:** evidence completeness and versioning.
- **Symptom:** v2 could express a negative verdict but could not safely prove every B/C boundary, four regional manifestations, control limitations, and unresolved Conversation attribution in one same-run contract.
- **Root cause:** the evidence model grew beyond a single observation sidecar; preserving old open shapes would permit missing or contradictory fields.
- **Unblock:** publish v3 with exact-key B and C sidecars, complete per-region gate tables, canonical fixture/choreography lineage, an exact terminal reporter, ordered three-veto derivation, and a fresh closed verdict object.
- **Prevention:** version schema changes explicitly; require exact keys, canonical serialization, ordered arrays, fresh objects, and relational recomputation rather than permissive spreads.
- **Fail-closed:** v2, mixed-version, partial-table, duplicate/extra-key, or noncanonical v3 inputs cannot reach atomic publication.

### Complete region tables prevented axis masking

- **Category:** correctness matrix design.
- **Symptom:** aggregating by gate or by region could hide a failure on one axis—for example, all copy checks passing while one first-intent region failed, or one region looking green while a different boundary drifted.
- **Root cause:** sparse summaries collapsed a two-dimensional region-by-behavior contract.
- **Unblock:** require every gate for Note, Conversation topic, Result, follow-ups, and Transcript; the only non-pass first-click cell is Result and must reference the accepted retarget veto.
- **Prevention:** retain full closed B/C tables and mutation tests that drop a region, drop a gate, swap rows, or substitute an aggregate boolean.
- **Fail-closed:** absence is never green, and an aggregate pass cannot mask a missing or failing cell.

### Conversation attribution stayed unresolved and became #440

- **Category:** measured limitation and loose-end tracking.
- **Symptom:** isolated B and preactivated C matched within one pixel across the same root-replacement relationship, while full C was stable immediately but drifted only after mutation plus two animation frames and on the away transition.
- **Root cause:** the available evidence could not separate baseline rich-content root-remount anchoring from candidate-specific content-visibility behavior.
- **Unblock:** label the result `measured-unresolved`, preserve all operands in v3, and file [#440](https://github.com/limweili/eido/issues/440) instead of forcing a pass/fail attribution.
- **Prevention:** isolate remount, mutation settling, activation, and away transitions as separate future probes with matched B/C identities.
- **Fail-closed:** unresolved is neither pass nor waiver. It is non-blocking only for rejecting #404, not evidence for selecting another architecture.

### Independent sidecars and the final assembler closed publication ambiguity

- **Category:** evidence provenance, atomicity, and privacy.
- **Symptom:** raw inputs could contain hidden duplicate keys, open object spreads, broad Playwright reporter fields, or B/C observations that looked valid separately but disagreed on lineage.
- **Root cause:** validating raw parser results without publishing canonical validator-owned objects let untrusted bytes influence the final bundle.
- **Unblock:** validate B raw plus independent exact-key B/C sidecars, recompute canonical fixture/choreography digests, derive the verdict in a final assembler, canonicalize the reporter, stage all six files, and atomically rename only after every relation passes.
- **Prevention:** publish only validator-owned canonical bytes; compare independent sidecars and raw lineage; keep duplicate-key, open-schema, raw-spread, and staging-race mutants.
- **Fail-closed:** any mismatch leaves no publication directory; failure diagnostics remain explicitly non-evidence.

### Repeated P1 reviews were productive because each targeted a concrete mutant

- **Category:** adversarial review quality.
- **Symptom:** successive reviews found region-axis masking, a loose input literal, noncanonical lineage, open schemas/raw spreads, fixed sleeps and 40-pixel assumptions, and duplicate-key/raw-reporter publication risks.
- **Root cause:** individual focused greens proved local behavior but did not prove the whole evidence chain against hostile yet parseable inputs or provider timing.
- **Unblock:** stop publication after each P1, write a discriminating RED/mutant, repair minimally, rerun focused tests plus `npm run ci:required`, and request a fresh exact-head review. Final review passed exact head `71a7394e3d43e5014d505f6a37cacb0488b583cf` with no P1/P2.
- **Prevention:** review the evidence lifecycle as well as product code; require concrete counterexamples and preserve the regression mutant that proved each finding.
- **Fail-closed:** prior review passes were superseded whenever the head changed; only the final exact-head verdict counted. Claude Fable 5 was never used and remains prohibited.

### Local browser runs exposed port collisions and wrapper exit-status loss

- **Category:** local test supervision.
- **Symptom:** stale Vite/Playwright processes occupied ports, redirected wrappers returned while owned child process groups survived, and one wrapper reported startup-only output as if the run had ended.
- **Root cause:** the supervisor observed the wrapper rather than the complete child process tree and did not reserve a unique port or retain the child's terminal exit separately.
- **Unblock:** allocate unique ports, record owned PGIDs, tee terminal output, capture the actual child exit code, allow bounded grace, and verify both process disappearance and port release before classifying a run.
- **Prevention:** use one standard supervisor that starts its deadline after readiness, cancels timers before cleanup, records child/supervisor exits, and never conflates shell return with browser completion.
- **Fail-closed:** startup-only logs, orphaned children, premature TERM, and truncated cleanup audits are absent proof, never green or red product evidence.

### Strict environment omission caused false provider assumptions

- **Category:** CI environment semantics.
- **Symptom:** diagnostic and ordinary modes behaved differently when an input/environment variable was omitted rather than explicitly set to false/off.
- **Root cause:** shell truthiness and workflow expression defaults were treated as equivalent to the application's closed enum/boolean contract.
- **Unblock:** normalize workflow inputs explicitly, guard diagnostic-only and ordinary-only steps separately, and test false plus omitted cases in workflow-policy tests.
- **Prevention:** every environment-controlled candidate flag needs a closed parser and an omission test; workflows must spell out which mode owns each step.
- **Fail-closed:** unknown or omitted values cannot bypass probes, correctness, capture, or publication ordering.

### Raw Playwright reporter data was valid input but unsafe output

- **Category:** privacy-safe evidence publication.
- **Symptom:** Playwright JSON included runner-local absolute paths, configuration, and a broad environment snapshot that were unnecessary for reproducing the negative verdict.
- **Root cause:** reporter output was initially treated as a publishable artifact rather than an untrusted validation input.
- **Unblock:** parse the raw reporter for exactly one named terminal failure, then publish only a canonical minimal reporter containing errors, closed stats, one suite/spec/test/result, and the terminal error identity.
- **Prevention:** define a publication allowlist independently of tool output; scan for paths, environment keys, secrets, `.eido`, and private-save markers.
- **Fail-closed:** raw reporter bytes are never published. The accepted six-file artifact contained no runner paths, broad environment, or private content.

### Noncanonical B identity and readiness RPC races blocked otherwise green captures

- **Category:** provider lineage and readiness synchronization.
- **Symptom:** one B artifact carried the wrong candidate identity, and an earlier readiness sequence could observe a response from a stale or not-yet-authoritative browser state.
- **Root cause:** identity was reconstructed from ambient mode rather than validated at capture, while readiness used separate check/action calls that could race state changes.
- **Unblock:** require exact `B-control` identity in raw B and sidecars, then replace the split readiness sequence with one atomic RPC returning the authoritative state used by the next action.
- **Prevention:** bind candidate ID, run/job/head, fixture, choreography, and readiness state at the capture boundary; mutation-test alternate B IDs and stale readiness responses.
- **Fail-closed:** wrong B identity or mismatched readiness aborts before C or final assembly.

### Provider canaries were investigated and the final evidence stayed fail-closed

- **Category:** provider execution and canary policy.
- **Symptom:** sequential focus hygiene, strict Conversation cleanup, and other browser canaries intermittently failed before final evidence. The first exact Conversation cleanup attempt returned `still-focused`; a clean retry was required before the final accepted run.
- **Root cause:** genuine retained browser state and provider scheduling exposed harness assumptions that local focused tests could not reproduce reliably.
- **Unblock:** investigate each red, retain failure diagnostics as non-evidence, repair or rerun only after classifying the cause, and require the ordinary B→C→assembler transaction to complete on one exact head.
- **Prevention:** keep diagnostic cohorts separate from acceptance evidence; require current-head provider identity and inspect every red non-blocking canary rather than ignoring its label.
- **Fail-closed:** no badge-only acceptance, no partial B acceptance, and no artifact promotion after a red stage.

### Final diagnostic and ordinary provider artifacts were independently accepted

- **Category:** provider evidence acceptance.
- **Symptom:** CI success alone could not prove artifact count, bytes, lineage, privacy, or closed verdict semantics.
- **Root cause:** workflow badges attest job conclusion, not the contents of uploaded evidence.
- **Unblock:** independently download and validate diagnostic run [29458803618](https://github.com/limweili/eido/actions/runs/29458803618), artifact `8360409317`, and ordinary run [29459031314](https://github.com/limweili/eido/actions/runs/29459031314), artifact `8360526329`. The diagnostic contained six ordered successful cohorts with connection count 132→133. The ordinary artifact contained exactly six files; replaying the strict publisher regenerated every file byte-for-byte, with canonical fixture digest `sha256:957a860a…` and choreography digest `sha256:33926c8e…`.
- **Prevention:** make artifact download, exact count/name checks, digest capture, canonical replay, privacy scan, and semantic derivation mandatory release-worker steps.
- **Fail-closed:** archive existence or green workflow status alone never qualifies evidence.

### PR #441, merge, and exact-main CI completed the lane

- **Category:** release train and production verification.
- **Symptom:** a reviewed/provider-green branch still lacked current-head Required/browser checks and post-merge main proof.
- **Root cause:** branch evidence and production-main evidence are distinct gates under the new DevOps operating system.
- **Unblock:** open [PR #441](https://github.com/limweili/eido/pull/441) at exact head `71a7394…`; wait for Required run `29459441082` and Browser interactions run `29459441054`, both green; Merge Captain merged one-at-a-time as `e58733e060314dbc41612b785dd533d700e6bc6a`; verify exact-main Required run [29460015936](https://github.com/limweili/eido/actions/runs/29460015936) and release artifact `8360810939`; close #404 and remove branch/worktree.
- **Prevention:** retain separate branch-head, PR-check, merge, main-check, release-artifact, tracker, and cleanup fields in the registry.
- **Fail-closed:** PR mergeability did not substitute for checks; merge did not substitute for exact-main CI; cleanup waited for both.

### Nested PTY polling could falsely look complete

- **Category:** CI monitoring/tool orchestration.
- **Symptom:** a nested `exec`/PTY poll returned a completed outer cell while the inner `gh run watch` session remained alive, making the monitor appear terminal.
- **Root cause:** the orchestration layer reported the lifecycle of the polling call, not the underlying unified shell session.
- **Unblock:** retain and poll the returned session ID, then re-query GitHub directly for final status, conclusion, head SHA, and job steps before reporting completion.
- **Prevention:** monitoring helpers must distinguish cell completion, shell-session completion, and external-run completion; final claims should come from a fresh provider query.
- **Fail-closed:** a returned polling wrapper without a terminal external conclusion is still in progress/absent proof.

### Silent worker and captain reassignments created coordination risk

- **Category:** multi-agent ownership and lifecycle.
- **Symptom:** several workers or captain supervisors became idle, disconnected, or returned no verdict while work continued elsewhere; without explicit registry ownership, two agents could believe they owned release or merge authority.
- **Root cause:** process/session liveness was mistaken for active task ownership, and reassignment was not always recorded at the moment authority changed.
- **Unblock:** revoke stale authority explicitly, classify partial output as absent proof, assign one current owner per implementation/review/release/merge seam, and message the orchestrator at every handoff.
- **Prevention:** registry fields should include current owner, authority scope, exact head, and superseded session; captain authority must be singular per PR train.
- **Fail-closed:** silent or partial sessions cannot mutate remote state or count as review/merge evidence after reassignment.

### Canonical checkout remained dirty and was deliberately not synchronized

- **Category:** user-work preservation.
- **Symptom:** `/Users/weili/Documents/Projects/eido` remained on local main `6ff36e19101c80c9ffdf8781f2ad61ea00ebbeea`, four commits behind `origin/main`, with untracked `research/prototype/`.
- **Root cause:** the canonical checkout contains user-owned untracked work and is not the epic's disposable execution surface.
- **Unblock:** perform all #404, release, merge, and retro work in isolated worktrees; record the canonical checkout state read-only and leave it untouched.
- **Prevention:** every cleanup/sync operation must re-derive canonical dirtiness and require explicit ownership before modifying or deleting user files.
- **Fail-closed:** no reset, checkout, clean, rebase, or synchronization was run in the canonical checkout.

### Safety and model-routing invariants held through #404 closeout

- **Category:** privacy and model policy.
- **Symptom:** long-running reassignment and compaction made it easy to lose exceptional routing/safety instructions.
- **Root cause:** model and save-data restrictions are cross-cutting constraints, not naturally repeated by each technical subtask.
- **Unblock:** repeat the constraints in worker contracts, registry state, review prompts, retro checkpoints, and handoffs.
- **Prevention:** keep `Fable 5` in the registry's prohibited list and require synthetic fixtures in every provider contract; use Claude Opus 4.8 at maximum or fresh GPT-5.6 Sol/Terra fallback.
- **Fail-closed:** **Fable 5 was never used. No real Eido save was inspected or executed.** Partial or unauthorized-model output cannot count as review evidence.

### 2026-07-16 · #405 discovery friction — new worktree absent from codebase-memory index

- **Class:** code discovery and worktree-index freshness.
- **Symptom:** the newly created `/Users/weili/Documents/Projects/eido-worktrees/epic-410-405` worktree was not present in the codebase-memory project catalog, so graph-first discovery could not address the exact branch/worktree source.
- **Root cause:** codebase-memory indexing is asynchronous and keyed per worktree path; creating an isolated worktree does not synchronously create its graph project.
- **Workaround:** treat the missing graph as an explicit discovery limitation, verify the exact worktree/branch/base from Git and the live registry, then use narrowly scoped local source reads and literal/config searches allowed by `AGENTS.md` until the exact worktree is indexed. Do not substitute a graph from another worktree as current source truth.
- **Prevention:** add an index-readiness check to worktree preflight and record the precise project key when available; route an indexing follow-up separately rather than blocking safe source verification.
- **Fail-closed status:** no architectural or ownership inference may rely on a stale sibling-worktree graph. Claims must cite exact local source or remain unverified. No feature/provider/merge mutation and no Fable 5 use occurred.

### 2026-07-16 · Registry drift — #416 remained marked open after closing unmerged

- **Class:** live dependency-state reconciliation and registry freshness.
- **Symptom:** the structurally valid registry still described dependency PR [#416](https://github.com/limweili/eido/pull/416) as open, red, and package-lane-blocking after GitHub showed it closed unmerged at `2026-07-15T06:28:46Z`.
- **Root cause:** the historical PR snapshot was preserved inside the long-lived #405 contract but had no automatic terminal-state refresh when Dependabot closed the PR.
- **Workaround:** re-derive GitHub state read-only, then surgically change only the nested #416 record to `closed-unmerged-no-current-405-blocker`, preserve the historical failed checks, and retain the independent #405 prohibition on `package.json` and `package-lock.json`. Revalidate JSON plus exact #405 worktree/branch/base ownership after the concurrent implementation lane remained active.
- **Prevention:** refresh every referenced PR at lane dispatch and before rebase/push; separate historical evidence from current blocking state with explicit `closedAt`, `mergedAt`, `blockingScope`, and policy fields.
- **Fail-closed status:** stale registry text cannot authorize package edits or suppress a required rebase. #416 creates no current #405 blocker, while package files remain out of scope unless the orchestrator explicitly re-slices them. No PR/tracker/branch/worktree/code mutation, provider run, merge, push, real-save access, or Fable 5 use occurred.

### 2026-07-16 · #405 review-prep agent stayed silent across bounded recovery attempts

- **Class:** reviewer lifecycle, observability, and authority reassignment.
- **Symptom:** the assigned #405 review-prep agent returned no usable progress or terminal checklist across repeated bounded pings and waits, and remained silent after being interrupted twice. The failure recurred when a separate exact-head remediation reviewer stayed silent through its bounded ping window.
- **Root cause:** unknown; no terminal report or trustworthy diagnostic was available, so transport, supervisor, and agent-state causes could not be distinguished.
- **Unblock:** revoke and interrupt each silent session after the bounded window, preserve the implementation worktree untouched, and immediately reroute the exact read-only contract to a fresh authorized GPT-5.6 Sol fallback. The fallback produced a complete exact-head review without extending the stalled authority.
- **Prevention:** give every reviewer an explicit first-update deadline, one bounded ping/wait budget, a terminal artifact requirement, and one recorded authority owner; pre-authorize a fresh Sol/Terra fallback when that budget expires.
- **Fail-closed status:** silence and partial output are absent proof, never green. No review evidence, approval, or finding closure was accepted from either silent agent; Fable 5 remained prohibited and unused.

### 2026-07-16 · #405 worker mistook a rebase/push milestone for task completion

- **Class:** implementation lifecycle and checkpoint/terminal-boundary clarity.
- **Symptom:** the isolated #405 implementation worker completed the requested rebase/push checkpoint, returned a final response, and stopped even though substantial contracted implementation, evidence, review, PR, and release work remained.
- **Root cause:** the follow-up prompt described the immediate checkpoint precisely but did not distinguish it strongly enough from the epic slice's terminal condition, so the worker interpreted checkpoint completion as task completion.
- **Unblock:** preserve the same isolated worktree and worker context, immediately reactivate that worker, and restate the full remaining #405 contract and terminal condition rather than restarting or transferring partially understood WIP.
- **Prevention:** checkpoint prompts must explicitly say **milestone, not completion**, enumerate the work that remains after the checkpoint, and repeat the exact terminal condition that permits a final response.
- **Fail-closed status:** the checkpoint created no accepted PR, provider artifact, review verdict, or completion claim. Evidence remained pending and fail-closed; no merge, real-save access, or Fable 5 use occurred.

### 2026-07-16 · #405 replay timing could duplicate or retarget the first interaction

- **Class:** activation handoff correctness and readiness semantics.
- **Symptom:** the midstream adversarial review found that replay can fire after two animation frames but before the physical pointer sequence produces its native click. The replay deletes the pending intent, so the later native click cannot be recognized and suppressed; the same interaction can execute twice. Re-hit-testing only coordinates against generic controls can also select a different target, while the two-frame timer can remove the passive copy before the intended Live control, content, image, or layout is actually ready.
- **Root cause:** one timeout-like approximation was carrying three separate contracts: Live visual readiness, intended-target readiness, and native-versus-replayed event arbitration. The queued record lacked stable target semantics and replay-state ownership across the complete physical pointer sequence.
- **Current unblock:** pause #405 evidence acceptance; delegate discriminating RED tests for replay-before-native double delivery, delayed Live readiness, and exact-target/modifier behavior, followed by a bounded implementation repair and fresh exact-head review. No fix or green evidence is claimed yet.
- **Durable prevention:** model activation readiness explicitly and keep one intent lifecycle through pointerdown, activation, replay decision, native click, and terminal delivery. Browser gates must use one physical zero-lead click and assert the exact intended action occurs once, including links, Result regions, inputs, media controls, delayed children, and delayed images.
- **Fail-closed status:** a two-frame root-presence check or a synthetic `.click()` unit pass cannot qualify first-intent continuity. Until the REDs are repaired and current-head browser evidence is accepted, #405 remains unapproved.

### 2026-07-16 · #405 giant-card limits were applied after transient allocations

- **Class:** capture work bounding and image-memory accounting.
- **Symptom:** the capture path cloned the complete Live subtree, serialized `outerHTML` plus stylesheet text, encoded the string, and then created SVG/image/canvas/blob intermediates before checking DOM-node and serialized-byte limits. The nominal giant-card bounds therefore did not bound the transient work or peak memory they were meant to control.
- **Root cause:** validation measured the completed representation rather than reserving and checking work before each allocation stage; resident cache accounting was mistaken for total capture-path accounting.
- **Current unblock:** pause giant-card and memory evidence; delegate RED cases using oversized synthetic DOM/style inputs and peak-transient assertions, then require preflight/incremental bounds and explicit transient byte/pixel telemetry. No bound is considered repaired yet.
- **Durable prevention:** define separate pre-allocation budgets for source nodes, stylesheet bytes, serialized markup, SVG decode, canvas pixels, encoded output, and simultaneous peak residency. Reject before cloning or materializing a stage that cannot fit its budget.
- **Fail-closed status:** post-allocation rejection is not bounded work. The candidate cannot claim giant-card safety or memory eligibility until the new REDs, accounting, and repeated-run evidence pass at the exact head.

### 2026-07-16 · #405 passive semantic projection omitted visible rich content

- **Class:** search, copy, clipboard, and accessibility fidelity.
- **Symptom:** the passive semantic shadow projected title, block text, and only an explicitly chosen Result version. It omitted Conversation turns, transcript, follow-ups, and the latest-version fallback, and flattened links, controls, and structure into one clipped text span. No matching browser evidence or explicit limitation artifact accompanied the implementation head.
- **Root cause:** the raster's minimal assistive text was treated as a sufficient semantic substitute without deriving it from the same complete visible-content model as the Live Card or measuring each browser surface independently.
- **Current unblock:** pause semantic-fidelity evidence; delegate RED browser tests for Find, DOM selection, clipboard copy, keyboard traversal, links, and accessibility across long Note, Conversation, Result, follow-up, and transcript regions. Repair the projection or record any surviving limitation as an explicit blocker; neither outcome is claimed yet.
- **Durable prevention:** expose one canonical visible-content projection shared by Live and Passive representations, preserve meaningful structure where the platform requires it, and maintain separate oracles for browser Find, DOM selection, clipboard, links, hit testing, and accessibility.
- **Fail-closed status:** raster fidelity and a clipped partial string cannot authorize search/copy/accessibility sacrifice. Missing region or missing oracle remains absent proof and blocks candidate eligibility.

### 2026-07-16 · #405 theme invalidation was sampled without a wake-up source

- **Class:** cache invalidation fidelity.
- **Symptom:** theme class, `data-theme`, and root style were sampled only when unrelated React dependencies already caused the Card node to render. A theme mutation by itself could leave an unchanged passive node holding a stale raster.
- **Root cause:** the invalidation key included theme state, but no subscribed theme-store signal or DOM mutation observer guaranteed that the key would be recomputed when that state changed.
- **Current unblock:** pause theme/style invalidation evidence; delegate a RED integration test that mutates theme while the Card remains passive, then add an authoritative wake-up seam and rerun exact-head fidelity evidence. No invalidation fix is accepted yet.
- **Durable prevention:** every invalidation-key input must identify both its canonical value and the event/subscription that wakes recomputation; mutation tests should change one input while all other render dependencies remain stable.
- **Fail-closed status:** a pure key-difference unit test does not prove runtime invalidation. Theme/style acceptance remains absent until a passive Card visibly refreshes under the isolated mutation gate.

### 2026-07-16 · #405 eviction and rejection could starve same-key recapture

- **Class:** cache lifecycle and repeated-traversal behavior.
- **Symptom:** the Card retained its last attempted capture key after a completed capture, including a rejected cache insertion. LRU eviction did not notify the evicted Card. Returning to the same unchanged Card could therefore skip recapture indefinitely and fall back to Live when settled or only the lightweight safety net during motion.
- **Root cause:** attempt deduplication was permanent per key rather than scoped to an in-flight or known-resident cache state, and cache eviction/rejection had no ownership signal back to the producer.
- **Current unblock:** pause repeated-traversal, hit-rate, and settled-detail evidence; delegate a RED fill-evict-return test plus rejected-put retry test, then repair lifecycle notification/retry semantics and repeat bounded traversal. No recapture repair is claimed yet.
- **Durable prevention:** distinguish in-flight, resident, rejected, evicted, stale, and retryable states; notify affected Card producers on terminal cache transitions and require return visits to prove bounded recapture without retry storms.
- **Fail-closed status:** cache-budget counters alone do not prove reusable settled detail. Until eviction/rejection recovery passes, repeated-traversal evidence and #405 eligibility remain paused.

### 2026-07-16 · #405 exact-head review still lacked stable intended-target identity

- **Class:** first-intent semantic continuity.
- **Symptom:** the remediation accepted any native click inside the Live root and otherwise re-hit-tested coordinates after activation, so a changed Result region, link, or control could still be counted as the intended action.
- **Root cause:** the queued intent retained coordinates and modifiers but no stable semantic target/region identity spanning Passive-to-Live replacement.
- **Current unblock:** delegate a physical zero-lead RED that moves or replaces the point target during activation, then repair target capture/reacquisition and request a fresh exact-head review. Unresolved; no provider evidence is accepted.
- **Durable prevention:** first-intent gates must bind physical pointer intent to a stable semantic target and assert exactly one action on that target, not merely one click somewhere inside the Card.
- **Fail-closed status:** same-Card delivery and coordinate re-hit-testing are not proof of intended delivery; #405 remains ineligible while retarget survives.

### 2026-07-16 · #405 trusted-activation fail-closed behavior remained product-ineligible

- **Class:** trusted browser interaction fidelity.
- **Symptom:** fallback intentionally dropped popup/modified links, file pickers, media controls, and declared trusted actions after activation lost the native click.
- **Root cause:** synthetic replay cannot recreate browser user activation, while the handoff did not guarantee the original trusted native event survived.
- **Current unblock:** delegate a real physical-click RED for each trusted class and either preserve native delivery or provide a genuinely equivalent single-click path. The telemetry is useful, but the product gap is unresolved.
- **Durable prevention:** classify trusted-activation surfaces before handoff and keep them Live early enough for the original event; never treat a counted blocked fallback as successful continuity.
- **Fail-closed status:** documenting or counting the lost click does not authorize it. Unless solved, this finding makes the cached-passive candidate non-selectable.

### 2026-07-16 · #405 broken images could hold Live readiness forever

- **Class:** activation readiness and image failure handling.
- **Symptom:** readiness required every image to have positive natural dimensions; an image that completed with an error could leave a focused, selected, or editing Card permanently under its Passive raster.
- **Root cause:** the readiness model represented successful decode but had no terminal error/fallback state.
- **Current unblock:** delegate a broken-image RED and define an error-settled readiness state that yields to visible Live error/fallback UI. The current successful-load unit test is insufficient and the issue remains open.
- **Durable prevention:** every asynchronous readiness prerequisite needs success, error, cancellation, and timeout/diagnostic terminal states; ownership must never wait forever on a failed asset.
- **Fail-closed status:** two stable samples with a failed image are not Live-ready evidence. Activation and interaction evidence stays paused until the error path passes.

### 2026-07-16 · #405 capture preflight missed runtime form values and escaping expansion

- **Class:** pre-allocation work bounds.
- **Symptom:** source-tree preflight could pass a small input/textarea attribute or raw text, after which cloning inserted a much larger runtime value or `outerHTML` expanded escaping and allocated beyond the limit.
- **Root cause:** the estimate measured source DOM bytes, not the exact serialized representation produced after runtime-state copying and HTML escaping.
- **Current unblock:** delegate runtime-value and escape-expansion REDs, then use an exact bounded writer or conservative preflight covering post-copy serialized bytes. Transient memory evidence remains paused; no fix is claimed.
- **Durable prevention:** work limits must guard the exact bytes before allocation, including runtime control state, escaping, wrappers, styles, and simultaneous SVG/image/canvas intermediates.
- **Fail-closed status:** post-allocation rejection does not satisfy bounded giant-card work; current capture evidence cannot qualify #405.

### 2026-07-16 · #405 cache retry still lacked terminal-event wake-ups

- **Class:** cache lifecycle and retry ownership.
- **Symptom:** same-key retry was possible only after a revision changed, but rejection, eviction, and later release of blocking pinned entries did not emit the revision that the producer awaited.
- **Root cause:** retry deduplication depended on ambient runtime revision instead of explicit cache terminal events and retryable capacity transitions.
- **Current unblock:** delegate fill/pin-reject-release and evict-return REDs, then add bounded producer notification/retry semantics. The hand-incremented revision unit test does not close the lifecycle.
- **Durable prevention:** make in-flight, resident, rejected, evicted, stale, and retryable states explicit and notify only affected producers without creating retry storms.
- **Fail-closed status:** cache counters and manual revision changes are absent recovery proof; repeated-traversal evidence remains unresolved.

### 2026-07-16 · #405 passive semantics improved text coverage but not AX/search/copy parity

- **Class:** measured semantic limitation.
- **Symptom:** the remediation added latest Result, transcript, follow-up, and Conversation text, but still exposed one clipped plain string with no heading, link, control, focus-order, or spatial selection semantics.
- **Root cause:** content completeness and platform interaction semantics were collapsed into one substring projection and unit test.
- **Current unblock:** delegate separate browser Find, DOM selection, clipboard, keyboard/focus, link, and accessibility gates across all rich regions; repair parity where feasible and record any survivor as an explicit blocker. Unresolved, not waived.
- **Durable prevention:** derive complete visible text canonically, then test each browser semantic surface with its own oracle rather than inferring parity from substring presence.
- **Fail-closed status:** improved text coverage is not accessibility or clipboard proof. Missing or blocked behavior cannot count green or become a pre-authorized sacrifice.

### 2026-07-16 · #405 second rebase gate caught a WIP TypeScript narrowing defect

- **Class:** integration checkpoints and canonical local gates.
- **Symptom:** the second #405 rebase/gate checkpoint exposed a TypeScript null-narrowing failure in the in-progress candidate even though the rebase itself had no conflicts.
- **Root cause:** the WIP had advanced through another integration phase without running the complete canonical type-aware gate at that boundary.
- **Unblock:** the isolated worker repaired the narrowing locally, preserved the remaining WIP, and reran `npm run ci:required` under canonical Node 20/npm 10 to green. No conflict resolution or unrelated overwrite was needed.
- **Prevention:** run typecheck and the canonical required gate after every meaningful integration/rebase phase, not only before publication, so local type drift is caught near its source.
- **Fail-closed status:** the green local gate proved only the repaired checkpoint. #405 provider, browser, review, and candidate evidence remained paused; no completion or selection claim followed. Fable 5 was not used.

### 2026-07-16 · #405 intent-region cap silently broadened late rich-card targets

- **Class:** first-intent coverage and eligibility enforcement.
- **Symptom:** the stable-target index retained only the first 256 matching regions before filtering; later links or controls in long rich Cards could silently fall back to a broad Card/body region and be accepted or replayed as the wrong interaction.
- **Root cause:** a bounded metadata policy changed semantic meaning without emitting a truncation state or target-coverage blocker.
- **Current unblock:** delegate REDs with more than 256 actionable regions and hidden/zero-size leading candidates, then implement a separately bounded complete index or an explicit coverage veto. The issue is unresolved and no provider run is authorized yet.
- **Durable prevention:** every bounded semantic index must expose truncation and never broaden an omitted action into success. The canonical global blocker set—including trusted-native and passive AX/search/copy gaps—must flow into the provider schema and assembler as a structural eligibility veto, not only a transient DOM attribute.
- **Fail-closed status:** omitted target identity, missing blocker metadata, or a validator capable of producing `eligible: true` while any global blocker exists is a hard failure. Current #405 candidacy remains paused.

### 2026-07-16 · #405 malformed surrogate pairs could undercount serialized bytes

- **Class:** pre-allocation byte accounting.
- **Symptom:** the bounded UTF-8 and escaped-HTML walkers treated any high surrogate plus following code unit as a valid pair, skipped the second unit, and could undercount a lone surrogate followed by escapable text before clone/serialization.
- **Root cause:** the estimator did not verify that the second code unit was a low surrogate before applying four-byte pair accounting.
- **Current unblock:** delegate lone-surrogate and control-character REDs, repair both byte walkers, and rerun exact preflight-versus-TextEncoder assertions. No byte-bound fix is claimed.
- **Durable prevention:** byte estimators must match platform encoding for valid pairs, lone surrogates, replacement characters, escaping, and runtime form state; differential/property tests should compare estimates against actual serialized bytes.
- **Fail-closed status:** any undercount that allows allocation before rejection invalidates the giant-card bound and keeps memory evidence paused.

### 2026-07-16 · #405 lacked a Board-wide transient capture reservation

- **Class:** concurrent capture work and memory telemetry.
- **Symptom:** each eligible Card independently began capture after two frames, so many Cards could simultaneously hold markup, SVG, decoded image, canvas pixels, and encoded output even though each Card and the resident cache were individually bounded.
- **Root cause:** per-Card limits and post-capture cache budgets were mistaken for an aggregate in-flight work budget; telemetry recorded resident and failed-attempt peaks but not concurrent transient reservations.
- **Current unblock:** delegate simultaneous-capture REDs, add a Board-wide queue/reservation with bounded concurrency and cancellation, and expose peak in-flight captures, pixels, and transient bytes. The current evidence remains unresolved.
- **Durable prevention:** reserve aggregate transient work before starting capture, release it on every terminal path, and report resident encoded/decoded memory separately from capture-time SVG/image/canvas peaks.
- **Fail-closed status:** a per-Card cap cannot prove Board-wide bounded memory. Without reservation and peak metrics, #405 giant-card and repeated-traversal evidence cannot qualify.

### 2026-07-16 · #405 retry state could leak and permanent rejects could storm

- **Class:** cache retry metadata and terminal-cause fidelity.
- **Symptom:** eviction/rejection bookkeeping survived Card unsubscribe outside cache accounting, while every unrelated release could retry entries that were permanently too large rather than temporarily blocked by pinned capacity.
- **Root cause:** retry state lacked lifecycle cleanup and cache rejection returned one boolean without distinguishing retryable capacity pressure from intrinsic oversize.
- **Current unblock:** delegate many-Card churn plus permanent-reject/release REDs, clean inactive per-Card retry state, and return a closed rejection reason that schedules only retryable cases. No retry repair is accepted yet.
- **Durable prevention:** bound and report auxiliary maps/sets alongside resident metadata; clear them on unsubscribe/terminal rejection and use explicit rejection states with capped retry policy.
- **Fail-closed status:** unreported retry metadata growth or repeated recapture of a permanently rejected entry invalidates bounded-cache evidence and leaves #405 unapproved.

### 2026-07-16 · #405 browser named-entity expansion escaped the pre-clone estimate

- **Class:** serializer-accurate pre-allocation bounds.
- **Symptom:** the revised byte walker handled malformed surrogate pairs but still counted non-breaking spaces as raw UTF-8, while browser `outerHTML` expanded them to `&nbsp;`; enough ordinary NBSP content could pass preflight and allocate an oversized clone/string before the post-check rejected it.
- **Root cause:** the estimator modeled Unicode encoding and selected HTML escapes rather than the browser's complete serialization rules, so it was not a true upper bound.
- **Current unblock:** delegate NBSP and other named-entity normalization REDs, then replace the estimate with a conservative browser-serializer upper bound or a bounded writer. The pre-clone guarantee remains unresolved.
- **Durable prevention:** differential/property tests must compare preflight against actual `outerHTML`/TextEncoder output for text, attributes, form state, entities, malformed Unicode, and controls; any estimate must overcount every supported input.
- **Fail-closed status:** a rejection after expanded `outerHTML` allocation is too late. Giant-card capture and transient-memory evidence remain paused until the browser-serialization bound is proven.

### 2026-07-16 · #405 scheduler bounded concurrency but not cancellation or every transient class

- **Class:** capture cancellation, queue retention, and transient memory telemetry.
- **Symptom:** cleanup only marked a closure canceled: queued jobs retained their Card DOM until reaching the front, in-flight SVG/canvas encoding continued after invalidation or unmount, and one stale/stalled capture could block the single capture slot. Reported reserved bytes omitted queued retained DOM and encoded output.
- **Root cause:** the scheduler bounded job starts but had no cancel handle/AbortSignal or reservation model spanning queued ownership, serialization, SVG/image decode, canvas pixels, and output blob.
- **Current unblock:** delegate queued-cancel, in-flight-cancel/dispose, and stalled-first-job REDs; add immediate queue removal, explicit terminal cancellation for active work, and per-class/current/peak reservation metrics. No scheduler completion is claimed.
- **Durable prevention:** cancellation must be first-class from component effect through scheduler and capture primitives, release every reservation exactly once, and prevent stale work from delaying current visible Cards; telemetry must separate all transient classes from resident cache bytes.
- **Fail-closed status:** finite concurrency alone is not bounded responsive work. Missing cancellation proof or undercounted transient reservations keep #405 memory and settled-detail evidence unapproved.

### 2026-07-16 · #405 browser encoding outlived scheduler cancellation accounting

- **Class:** native-work lifetime, reservation release, and preflight allocation.
- **Symptom:** abort and encode-timeout settled the capture promise immediately, so the scheduler released its only slot and all serialized, decoded, encoded, and pixel reservations even though non-cancellable `canvas.toBlob` could still be running. Repeated unmounts, disposal, or timeouts could therefore overlap hidden browser-native encodes while telemetry reported no in-flight work. Separately, stylesheet rules were collected and joined without an incremental byte bound before serialized-content preflight, so that allocation could exceed the fixed reservation before rejection.
- **Root cause:** external promise settlement was treated as proof that native encoding had terminated, and a post-collection style-text check was treated as a pre-allocation bound. The browser API exposes no cancellation primitive for work already submitted to `toBlob`.
- **Current unblock:** delegate remediation that separates caller cancellation from native-work completion, retaining the scheduler slot and reservations until the encode callback or another proven terminal boundary. Add an integrated late-callback RED showing that cancellation/timeout cannot start a second native encode or zero reservations while the first remains active. Bound stylesheet collection incrementally before appending/joining rules. No fix or provider eligibility is claimed.
- **Durable prevention:** scheduler accounting must follow the lifetime of the underlying resource, not merely its wrapper promise. Every supposedly cancellable browser primitive needs abort-before-start, abort-in-flight, timeout, disposal, never-callback, and late-callback tests; preflight limits must guard allocation as it is constructed rather than inspect an already materialized aggregate.
- **Fail-closed status:** if actual native completion cannot be observed and bounded without deadlocking the queue, the cached-passive candidate is ineligible rather than approximately green. Hidden encode overlap, early reservation release, or unbounded stylesheet aggregation keeps #405 memory evidence and approval paused.

### 2026-07-16 · #405 late-callback accounting repair exposed a never-callback lane wedge

- **Class:** non-cancellable native work, queue liveness, and poisoned-resource policy.
- **Symptom:** retaining the slot and reservations until `canvas.toBlob` called back closed the hidden-overlap gap, but a callback that never arrived left the capture promise, SVG object URL, Board-wide slot, queued Cards, and every reservation alive indefinitely. Timeout and disposal only recorded the requested failure; neither could reach a terminal state without native cooperation.
- **Root cause:** the browser primitive offered no trustworthy cancellation or completion signal beyond its callback. Releasing on the wrapper timeout fabricated native completion and permitted overlap, while waiting forever preserved accounting truth at the cost of permanent lane deadlock. The remediation test covered a late callback but always supplied one, so it did not exercise this fundamental tradeoff.
- **Current unblock:** delegate a fail-closed poisoned-encode design with an explicit unknown/native-still-active state and bounded impact, or move encoding behind a genuinely killable boundary. Add an integrated never-callback RED covering timeout, caller cancellation, disposal, reservation/URL cleanup policy, and progress of a later visible Card, alongside the existing late-callback RED that forbids speculative slot release. No fix is claimed.
- **Durable prevention:** every adapter around a non-cancellable API must specify separate caller, scheduler, resource, and native terminal states. Test both adversarial poles—callback after cancellation and callback never delivered—and require accounting, cleanup, and liveness invariants to hold together rather than optimizing one while silently breaking another.
- **Fail-closed status:** unknown native encode lifetime cannot be labeled released, completed, or green. Until a bounded poisoned-resource policy or killable boundary proves both no hidden overlap and no permanent wedge, the cached-passive candidate is ineligible and #405 memory, responsiveness, and provider evidence remain paused.

### 2026-07-16 · #405 runtime-local poison did not survive a Board remount

- **Class:** coordinator lifetime and cross-generation native-work ownership.
- **Symptom:** poisoning one cached-passive runtime correctly disabled its subscribers, but Board unmount disposed that runtime and a later mount constructed a clean one. The original `toBlob` could still be active and unknown while the new runtime admitted another encode, returning hidden overlap and making the old reservation invisible to current Board telemetry.
- **Root cause:** the poison latch, unknown-native registry, concurrency slot, and counters were closure-local to one disposable Board runtime even though browser-native work can outlive that owner. Disposal ended application ownership but could not terminate the underlying encode.
- **Current unblock:** delegate a shared session/renderer capture coordinator whose poison and unknown reservations survive runtime generations. Add a cross-generation RED: runtime A begins a never-callback encode, is disposed, and runtime B must reject capture and expose the aggregate unknown reservation until an explicit safe boundary. A late callback may clear unknown work but must not silently unpoison the session. No fix is claimed.
- **Durable prevention:** choose coordinator lifetime from the longest-lived resource it governs, and test teardown/remount, route/Board replacement, strict-mode remount, and repeated generation churn whenever native work may survive component disposal.
- **Fail-closed status:** a new runtime is not evidence of a new native lane. Until all generations share one hard concurrency and poison authority, the cached-passive candidate remains ineligible and memory evidence stays paused.

### 2026-07-16 · #405 active-to-unknown reservation handoff was observably non-atomic

- **Class:** telemetry state transition and reservation conservation.
- **Symptom:** poisoning first added the job's full bytes and pixels to unknown-native counters and notified listeners, while active counters and the in-flight slot were removed only in a later promise `finally`. A subscriber or rejecting consumer could sample the same reservation in both categories and report a false doubled current footprint.
- **Root cause:** ownership transfer was split across the rejection handler and asynchronous cleanup, with no transferred marker or single transition that conserved the reservation exactly once before publishing state.
- **Current unblock:** delegate listener-time and promise-catch-time REDs, then atomically move the reservation and slot from active to unknown before any notification or consumer settlement; mark the job transferred so final cleanup cannot release it twice. Preserve separate per-class and aggregate truth. No fix is claimed.
- **Durable prevention:** model reservation movement as a closed state machine and assert conservation at every externally observable callback: queued, active, unknown, resident, released. Tests must sample synchronously inside listeners and rejection handlers, not only after all microtasks drain.
- **Fail-closed status:** conservative overcount is not reproducible current-state evidence when ownership categories overlap. #405 telemetry and candidate approval remain paused until the handoff is atomic and exact.

### 2026-07-16 · #405 shared coordinator ownership was not React StrictMode-safe

- **Class:** render purity, restartable lifecycle, and global subscription cleanup.
- **Symptom:** the Board created the runtime inside `useMemo`, where StrictMode evaluated the factory twice. The ignored runtime subscribed to the module-wide coordinator and had no committed cleanup, while the retained runtime's passive-effect cleanup called irreversible `dispose()` during StrictMode's setup-cleanup-setup replay. The second setup and child effects then reused that already-disposed runtime, so capture rejected as runtime-disposed while the abandoned instance stayed globally rooted.
- **Verified evidence:** an isolated React/jsdom probe against the installed runtime produced `create, create, effect:false, dispose, effect:true, consumer:true`, confirming both the discarded calculation and reuse of the disposed committed resource after replay.
- **Current unblock:** delegate a StrictMode owner RED around the actual Board/runtime boundary: after replay, capture must still schedule, exactly one coordinator listener/lease may remain, and real unmount must release it. Make factory calculation render-pure; attach to the shared coordinator only from committed setup, make setup/cleanup restartable, and separate detach from irreversible destruction or move ownership to a stable provider with explicit leases. No fix is claimed.
- **Durable prevention:** resource factories used during render must not mutate global registries. Every singleton subscription or external lease created by React code needs StrictMode double-calculation, effect replay, abandoned-render, real-unmount, and repeated-remount tests with observable subscriber/resource counts.
- **Fail-closed status:** a dev/benchmark runtime that is already disposed or a globally rooted abandoned runtime invalidates functional and memory evidence. #405 remains ineligible until lifecycle replay and teardown are proven.

### 2026-07-16 · #405 global capture lease still allowed per-runtime queue multiplication

- **Class:** session-wide queue admission and retained-DOM telemetry.
- **Symptom:** the shared coordinator serialized active encoding, but each runtime retained its own full capture queue and queued-DOM counters. With multiple concurrent runtimes, each could admit the configured queue limit, so aggregate pending work grew with runtime count while every individual snapshot appeared locally bounded.
- **Root cause:** only the active lease and unknown-native reservation moved to session scope; queue capacity, fairness, retained DOM, rejection wake-ups, and queue telemetry remained runtime-local despite the coordinator explicitly supporting concurrent Board generations.
- **Current unblock:** delegate a multi-runtime capacity RED that fills queues across runtimes and asserts one global admission bound, aggregate queue depth/retained-DOM visibility, cancellation/disposal release, and eventual progress without starvation. Move queue ownership into the shared coordinator or add atomic global admission reservations around local queues. No fix is claimed.
- **Durable prevention:** any concurrency limit shared across owners must pair with a shared pending-work budget and aggregate metrics. Test capacity across owners and generations, not only one job in each runtime on the normal path.
- **Fail-closed status:** hard active concurrency does not bound queued memory. Until session-wide admission and telemetry are bounded, #405 repeated-traversal and memory evidence remain paused.

### 2026-07-16 · #405 shared admission still scheduled by runtime attachment order

- **Class:** global queue ordering, fairness, and stable capacity ownership.
- **Symptom:** aggregate queue depth and retained DOM became bounded centrally, but jobs remained in per-runtime queues. When the active lease released, coordinator listeners ran in attachment order and each runtime tried to reacquire immediately. A later job from the earlier-attached runtime could therefore overtake an older job in another runtime, and continuous replenishment could starve that other owner indefinitely. Callers also supplied their own queue limit to shared admission, so a runtime with a larger limit could expand the nominal session cap.
- **Root cause:** the coordinator counted pending work but did not own ordered job tickets or a single capacity policy. Set iteration order became an accidental scheduler, and local queue identity took precedence over global enqueue time.
- **Current unblock:** delegate a global ordered-ticket RED: runtime A runs A1, runtime B queues B1, then A queues A2; B1 must run next and remain bounded under repeated A replenishment. Extend it through cancellation and disposal so removing any owner's ticket releases exactly its own retained-DOM reservation and advances the next surviving ticket. Move ticket order, pumping, and one fixed session cap into the coordinator while local runtimes retain only execution callbacks/state. No fix is claimed.
- **Durable prevention:** shared admission, ordering, and capacity must have one owner. Test FIFO or the explicitly chosen fairness policy across heterogeneous owners, bounded wait under continuous producers, cancellation at every queue position, owner teardown, poison drain, and exact reservation conservation.
- **Fail-closed status:** a globally bounded queue is not responsive evidence if visible work can be starved or the cap varies by caller. #405 settled-detail, repeated-traversal, and queue evidence remain paused.

### 2026-07-16 · #405 never-callback SVG load could wedge the global FIFO before encoding

- **Class:** capture-wide deadline and native image-decode lifetime.
- **Symptom:** the ordered global lane had a deadline for `canvas.toBlob`, but the preceding SVG `Image` load waited only for load, error, or external cancellation. If neither image callback arrived while the Card remained mounted, the active lease, decoded/serialized reservations, object URL, and every later FIFO ticket remained blocked forever without reaching the encode deadline.
- **Root cause:** bounded-wait reasoning covered the final encode primitive but not the complete capture pipeline. The SVG load adapter had no typed deadline or unknown-native state, so a pre-encode browser callback could bypass the poison policy entirely.
- **Current unblock:** delegate a synthetic `Image` never-callback RED with a capture-wide deadline. It must prove the active job reaches a typed terminal, shared reservations and SVG URL follow an explicit truthful policy, all Cards fall back Live, and later tickets are drained/rejected rather than falsely reported as progressing. Extend the unknown-native poison model to image decode or move the full raster pipeline behind a killable boundary. No fix is claimed.
- **Durable prevention:** enumerate every asynchronous/native stage under one end-to-end deadline and test success, error, abort, timeout, late callback, and never callback at each boundary. A downstream timeout does not bound an upstream wait.
- **Fail-closed status:** FIFO order is not bounded wait when the head can live forever. #405 responsiveness, transient-memory, and settled-detail evidence remain paused.

### 2026-07-16 · #405 ticket cancellation published global state before local cleanup

- **Class:** reentrant cancellation and mirrored queue conservation.
- **Symptom:** canceling a queued ticket first removed global depth and retained-DOM metrics and synchronously notified coordinator listeners; only after those callbacks returned did the owner splice its local queue and decrement local retained DOM. A retry listener could therefore observe global zero/local one, or enqueue replacement work while the canceled mirror still inflated local current and peak counts. Runtime disposal used the same path.
- **Root cause:** the coordinator owned ticket removal but notification occurred before the owner's cleanup callback completed, splitting one state transition across a reentrant publication boundary.
- **Current unblock:** delegate cancel-listener and dispose-listener REDs that snapshot global/local counts and reentrantly enqueue replacement work. Remove or mark the local mirror before coordinator publication, or have the coordinator invoke an atomic owner cleanup callback before notifying; cancellation must release exactly one ticket and reservation even under reentrancy. No fix is claimed.
- **Durable prevention:** for mirrored state, mutate every authoritative and local view before publishing once. Test state from inside coordinator listeners, retry callbacks, promise catches, and disposal callbacks rather than only after the cancel call returns.
- **Fail-closed status:** transiently contradictory queue telemetry cannot support reproducible capacity evidence. #405 queue accounting and approval remain paused until cancellation is atomic.

### 2026-07-16 · #405 iterative code-review loop reached a clean exact-head pass

- **Checkpoint:** exact head `1ddaa00e49ec6b936a03f641cf3a016fe34ee503` completed the tenth adversarial pass with no P1/P2 code findings. Focused regression evidence was 61/61 green, and the canonical `npm run ci:required` evidence at that head was 1,865 tests green.
- **Verified unblock map:** stable bounded intent identity, overflow veto, trusted-native blocking, and exact first-click routing closed the target/activation blockers; two-sample Live readiness plus terminal image-error handling closed the activation-readiness blocker; serializer-accurate pre-clone bounds, incremental stylesheet accounting, capture-wide decode/encode deadlines, shared unknown-native poison, ordered session FIFO, and exact reservation transfer closed the bounded-work/native-lifetime blockers; explicit rejection reasons, event-driven retry, and lifecycle cleanup closed cache retry/storm/leak blockers; render-pure restartable attach/detach closed StrictMode ownership; global ordered tickets, immutable capacity, exact cancellation/disposal, and reentrant local/global conservation closed session fairness and atomic-metrics blockers.
- **Prevention retained:** keep the adversarial Unicode/entity, long-rich-target, failed-image, pinned-cache retry, never/late native callback, cross-generation poison, StrictMode replay, heterogeneous-owner FIFO, reentrant cancel, and reservation-conservation tests together as the regression envelope. A local happy-path test or a drained microtask snapshot is insufficient by itself.
- **Fail-closed status:** this closes the implementation code-review loop only. Provider benchmark evidence and the structural global compatibility/eligibility validator are still pending; trusted-native, search/copy, and accessibility limitations remain blockers rather than waivers. #405 is not approved, landed, or renderer-selected by this checkpoint.

### 2026-07-16 · #405 evidence schema skipped wrong numeric types and retained open raw keys

- **Class:** closed-schema type integrity and decision-boundary isolation.
- **Symptom:** the nonnegative-number helper validated only values already typed as numbers, so nulls, strings, objects, and fractional count values could cross validation and later crash rendering or distort derived blockers. The inherited raw-artifact assertion also retained unknown nested keys, allowing fields such as `eligible` or `decision` to survive beneath published raw evidence.
- **Root cause:** validation skipped unexpected types instead of rejecting them, count fields lacked safe-integer contracts, and upstream open objects were returned without an exact canonical projection or final deep assertion.
- **Current unblock:** delegate REDs for null, wrong-type, `NaN`-string, fractional count, unknown/deep-extra key, and raw promotion-field inputs; exact-project every raw artifact, enforce finite versus safe-integer rules per field, and revalidate the final evidence object before rendering and publication. No fix is claimed.
- **Durable prevention:** every evidence boundary must reject unexpected types and keys at every depth, and only sanitized canonical objects may reach derivation, Markdown, or retained artifacts.
- **Fail-closed status:** malformed numeric evidence or provider-controlled promotion fields pause canonical evidence generation and keep #405 ineligible.

### 2026-07-16 · #405 measured limitations could escape the canonical blocker set

- **Class:** mandatory-probe coverage and blocker-set completeness.
- **Symptom:** `search: measured-limitation` produced no blocker, while hit testing, dragging, connecting, and fallback probes could be blocked, limited, or not applicable without entering the canonical blocker set. Candidate-C fidelity probes could also be marked not applicable despite being mandatory comparison surfaces.
- **Root cause:** the fixed known-blocker map covered only selected statuses and surfaces, and validation did not require observed results for every mandatory Candidate-C probe.
- **Current unblock:** delegate an exhaustive per-probe status-matrix RED, including missing and duplicate canonical blocker IDs; require observed status wherever the protocol makes a probe mandatory, and map every blocked or measured-limitation result to one canonical blocker or fail validation. No fix is claimed.
- **Durable prevention:** derive validation and blocker mapping from one closed probe registry, with a completeness invariant proving every accepted non-observed status has exactly one fail-closed consequence.
- **Fail-closed status:** incomplete blocker derivation pauses the blocker set, comparison evidence, and renderer selection.

### 2026-07-16 · #405 retained raw digests and executable lineage did not match publication

- **Class:** exact-head paired lineage and retained-byte reproducibility.
- **Symptom:** trusted run, attempt, job, and URL strings were not bound to each artifact's capture lineage; environment and candidate flags were not represented strongly enough to prove that B disabled #404/#405 and C differed only by enabling #405. The assembler hashed input bytes, but publication rewrote normalized pretty JSON, so the reported digest did not identify the retained artifact: one synthetic check produced input `b7e27dd809a64a40a17aca8e0c9c5daf37ec62cf26b29c8f3e08735cefafa6ad` versus published `f6419ca683a62a619e5472fce2ac2a172eee226829a5542fdf6ac8146fea894b`.
- **Root cause:** report claims were assembled from trusted strings and canonical constants without binding them to captured run/job/configuration fields, and hashing happened before a byte-changing reserialization step.
- **Current unblock:** delegate mixed-run, mixed-job, mixed-environment, wrong-flag, and retained-byte digest REDs; bind trusted provenance and executable candidate configuration to every artifact, then hash and verify the exact bytes written or retain the original bytes unchanged. No fix is claimed.
- **Durable prevention:** every narrative lineage claim must derive from a validated field, and every published digest must be recomputed from the retained artifact after writing.
- **Fail-closed status:** unverifiable pairing or a digest for bytes that were not retained pauses lineage, reproducibility, and #405 comparison evidence.

### 2026-07-16 · #405 provider text could inject a contradictory Markdown decision

- **Class:** evidence rendering and Markdown injection.
- **Symptom:** probe detail, image caveat, and lineage strings required only nonempty/privacy-safe content before raw Markdown interpolation. A provider value containing newlines and headings could therefore add a second `Decision` section or an apparent `eligible: true` statement beside the canonical false decision.
- **Root cause:** semantic validation treated arbitrary provider text as render-safe and neither constrained it to a bounded single line nor escaped Markdown control characters.
- **Current unblock:** delegate malicious newline, pipe, link, heading, and control-character REDs that also assert exactly one canonical Decision/eligibility section; restrict structured fields to bounded single-line values and escape any remaining prose at the renderer boundary. No fix is claimed.
- **Durable prevention:** keep provider content structurally separate from decision syntax, encode for the target format, and test the rendered document rather than only the source object.
- **Fail-closed status:** provider-controlled decision-shaped Markdown makes the report unpublishable and keeps #405 evidence paused.

### 2026-07-16 · #405 publication no-overwrite check had a race

- **Class:** atomic no-overwrite publication.
- **Symptom:** publication checked destination existence separately from renaming a deterministic process-scoped temporary file. A concurrent creator or publisher could win between those operations, producing an overwrite or platform-dependent failure despite the no-overwrite contract.
- **Root cause:** the publisher used a check-then-act sequence and an ordinary rename without an exclusive destination claim or guaranteed no-replace primitive.
- **Current unblock:** delegate concurrent-writer plus existing empty-file, nonempty-file, and directory REDs; use an exclusive lock/claim or proven no-replace publication protocol with exact temporary-file cleanup on every terminal path. No fix is claimed.
- **Durable prevention:** exercise publication under races and crash leftovers, and treat exclusivity as an atomic filesystem property rather than a preliminary observation.
- **Fail-closed status:** until no-overwrite is race-safe, publication evidence remains paused and no #405 provider artifact is canonical.

### 2026-07-16 · #405 raw promotion filtering remained open and executable roles were not bound

- **Class:** case-insensitive closed raw schema and executable B/C lineage identity.
- **Symptom:** the remediation rejected five exact promotion-key spellings but a novel synthetic artifact containing `noise.Eligible: true` was retained successfully. A B artifact whose `candidate.id` said `C-candidate` also passed when its command string said B, and trusted `runId=999`, `runAttempt=77`, and `jobIdentity=unrelated-job` passed against a raw source URL ending in `runs/1`.
- **Root cause:** a case-sensitive denylist was layered over an upstream open raw assertion, while commands served as the only role proof and trusted run/job strings were checked for safe text rather than parsed and bound to raw provenance or capture order.
- **Current unblock:** delegate deep unknown-key, casing/alias promotion, wrong-type/fractional raw count, swapped-role, mismatched run/attempt/job, and reversed capture-time REDs. Exact-project every nested raw object with per-field safe-integer contracts, require canonical B/C candidate identities and commands together, and bind parsed GitHub run/job/attempt plus capture order to retained artifacts. No fix is claimed.
- **Durable prevention:** promotion safety must come from an exact allowlisted schema rather than enumerating dangerous spellings, and every reported role or provenance claim must have one validated executable source.
- **Fail-closed status:** open retained raw or unbound role/run identity keeps the whole publication set capable of contradictory claims; #405 lineage and provider evidence remain paused.

### 2026-07-16 · #405 publication revalidated components without rederiving their relationship

- **Class:** canonical bundle derivation and sidecar provenance.
- **Symptom:** publish-time checks revalidated evidence and retained raw separately, but did not recompute performance scenarios from the retained raw bytes or compare them to the evidence metrics. Provider observation sidecar bytes were embedded only as mutable evidence data and were neither retained nor digested, so a shape-valid post-assembly metric or observation mutation could be published with unchanged raw digests.
- **Root cause:** the bundle type was treated as proof that assembly had remained intact, while the publisher checked field validity and raw byte identity without checking the derivation edge between those inputs and the final report.
- **Current unblock:** delegate post-assembly mutation REDs for every derived performance metric, observation, blocker, lineage field, and sidecar byte. Reassemble the canonical evidence inside publication from exact retained/digested raw and sidecar inputs, or verify one canonical full-bundle derivation digest before any write. No fix is claimed.
- **Durable prevention:** validation proves shape; derivation verification proves provenance. Publication boundaries need both, with tests that mutate each component after a valid assembly.
- **Fail-closed status:** independently valid components are not reproducible paired evidence. #405 performance, observation, and provider publication remain paused until their derivation is re-proven.

### 2026-07-16 · #405 image-readiness limitations still escaped the canonical blocker set

- **Class:** first-class image evidence and total blocker derivation.
- **Symptom:** Candidate C correctly rejected `imageReadiness: not-applicable`, but accepted `imageReadiness: measured-limitation` without deriving any image-readiness blocker. A novel probe returned only the six fixed compatibility blockers plus search, leaving the explicit image limitation absent from the canonical set.
- **Root cause:** mandatory measurement validation and blocker derivation were maintained in separate registries, and the latter covered compatibility probes but not the fidelity image-readiness state.
- **Current unblock:** delegate an exhaustive Candidate-C fidelity/status RED that proves every accepted limitation has exactly one canonical blocker; add an image-readiness blocker or reject the limitation state, and explicitly decide whether resolution-capped transient sharpness is a blocker or an accepted measured condition. No fix is claimed.
- **Durable prevention:** generate accepted statuses, mandatory requirements, report rows, and blocker consequences from one total registry spanning compatibility and image/fidelity surfaces.
- **Fail-closed status:** an image limitation omitted from the decision set invalidates first-class image evidence and pauses #405 comparison and renderer selection.

### 2026-07-16 · #405 Markdown-normalized true verdicts bypassed literal guards

- **Class:** target-format encoding and semantic decision isolation.
- **Symptom:** the safer single-line validator still allowed Markdown emphasis markers and decision tokens. A novel image caveat `eligible: **true** and architectureSelectable: **true**` passed validation, rendered both true claims, and still satisfied the checks for one Decision heading, one literal false verdict, and absence of the exact plain-text pattern `eligible: true`.
- **Root cause:** source-character filtering was mistaken for Markdown escaping, and post-render checks inspected literal source rather than Markdown-normalized semantic text; architecture-selectable true claims had no corresponding guard.
- **Current unblock:** delegate emphasis, strike, escape, entity, mixed-case, and whitespace-obfuscation REDs for both eligibility fields; encode provider text for Markdown at the rendering boundary and reject normalized decision-shaped claims outside the assembler-owned verdict. No fix is claimed.
- **Durable prevention:** reserve decision vocabulary to structured assembler fields, escape all provider content for its output context, and test rendered/normalized semantics rather than only heading counts and literal substrings.
- **Fail-closed status:** the evidence JSON remains structurally false-only, but the published report does not. Any provider-rendered true verdict keeps #405 publication untrusted and paused.

### 2026-07-16 · #405 cooperative publication locking did not provide filesystem no-replace

- **Class:** external-writer race, atomic destination ownership, and symlink policy.
- **Symptom:** the new sibling lock serialized cooperating publishers, but an external creator could still make the destination between the final existence check and rename. A novel Node/macOS probe confirmed that renaming a populated staging directory over an existing empty destination directory succeeds and replaces it. A dangling destination symlink failed closed with `ENOTDIR` and cleanup succeeded on that platform, but the implementation declared no portable `lstat`/`realpath` policy for destination or ancestor symlinks.
- **Root cause:** the lock path was advisory to this publisher, while destination ownership still used `existsSync` followed by ordinary replace-capable `renameSync`; filesystem object identity and symlink resolution were not part of the contract.
- **Current unblock:** delegate external empty-directory/file creators at every publication boundary, two cooperating publishers, crash/stale-lock recovery, dangling/live destination symlinks, symlinked ancestors, and exact staging/lock cleanup REDs on supported platforms. Use an atomic no-replace destination claim/protocol and define a fail-closed symlink/realpath policy. No fix is claimed.
- **Durable prevention:** test publication against non-cooperating filesystem actors, not only callers honoring the sibling lock, and verify destination identity atomically immediately through commit.
- **Fail-closed status:** advisory serialization is not no-overwrite. Until external races and symlink semantics are closed, no #405 publication artifact is canonical.

### 2026-07-16 · local synthetic-data validation review required a clean retry

- **Class:** automated review-routing friction.
- **Symptom:** an automated content filter stopped a local synthetic-data validation review before it produced a verdict.
- **Current unblock:** discard the interrupted turn, restate the work as ordinary correctness checking, preserve the exact-head checklist, and rerun it to completion. The retry completed; no result from the stopped turn was accepted.
- **Durable prevention:** lead review requests with their bounded local scope, synthetic inputs, and concrete correctness invariants so automated routing has the intended context.
- **Fail-closed status:** a stopped review supplies no approval. Evidence remains paused until its complete retry returns a verdict.

### 2026-07-16 · #405 nested raw fields still needed explicit projection and numeric bounds

- **Class:** closed JSON shape, primitive types, and numeric integrity.
- **Symptom:** synthetic validation checks showed that some nested raw objects retained undeclared fields and that several timing and count fields lacked complete type or safe-integer bounds.
- **Root cause:** selected nested objects were copied with object spread, while supplemental number validation covered only part of the raw schema.
- **Current unblock:** delegated RED matrices now cover every nested object's exact keys and every primitive's enum, boolean, text, finite-number, nullable, or safe-integer contract; replace spread copies with explicit projection. No fix is claimed.
- **Durable prevention:** generate parsing and validation from one closed schema, or enforce a field-completeness test proving every member is explicitly projected and bounded.
- **Fail-closed status:** raw and derived evidence remain paused until the complete nested schema rejects drift and invalid numbers.

### 2026-07-16 · #405 GitHub run metadata and paired environment needed exact consistency

- **Class:** canonical run identity and paired-environment equivalence.
- **Symptom:** synthetic checks showed that run metadata could satisfy a partial path match and that B/C capacity fields could differ while the pair still reported one environment.
- **Root cause:** run identity validation did not compare every canonical component, and the paired-environment check omitted some stable capacity fields.
- **Current unblock:** delegated RED matrices cover each run-identity component and every B/C environment field; require exact canonical GitHub run metadata and full stable-environment equivalence. No fix is claimed.
- **Durable prevention:** parse run identity into structured fields and derive paired comparison from one complete environment registry so added fields cannot escape validation.
- **Fail-closed status:** lineage, performance comparison, and provider evidence remain paused until run and environment consistency are exact.

### 2026-07-16 · #405 completion metadata needed an atomic whole-set reader contract

- **Class:** atomic completion metadata and whole-publication integrity.
- **Symptom:** completion metadata was written directly to its final name, did not cover every published file digest, and had no canonical reader that rejected partial or mismatched sets.
- **Root cause:** final-name creation was treated as the commit point without a hidden-write/atomic-rename step or a matching reader contract.
- **Current unblock:** delegated REDs cover partial metadata, interrupted writes, missing files, digest drift, and reader rejection; write completion metadata under a hidden name, atomically rename it last, include full file digests, and provide one canonical verifying reader. No fix is claimed.
- **Durable prevention:** test writer and reader together around one atomic marker, and accept success only when the reader verifies the complete artifact set.
- **Fail-closed status:** partial directories remain diagnostics-only, and #405 publication evidence stays paused until completion metadata is atomic and fully verified.

### 2026-07-16 · #405 tagged measurements allowed contradictory status and value combinations

- **Class:** measurement-state implications and sample completeness.
- **Symptom:** synthetic checks at the v5 schema head accepted observed search without a result, unavailable accessibility with a retained count, observed React work without a value, and supported memory without before/after measurements. Frame-interval arrays could also be empty and then analyze as a zero distribution rather than missing evidence.
- **Root cause:** the parser bounded each primitive independently but did not enforce the implications between status, support flags, nullable values, reasons, and required sample arrays.
- **Current unblock:** delegated RED matrices cover every tagged measurement state and its required/forbidden values, plus empty and undersized frame samples for every frozen run; enforce those implications before analysis or retention. No fix is claimed.
- **Durable prevention:** model measurements as closed discriminated states whose constructors make contradictory combinations unrepresentable, and require completeness before computing a distribution.
- **Fail-closed status:** missing measurements cannot be interpreted as observed or zero. Raw performance, correctness, memory, and provider evidence remain paused until every tagged state is internally consistent.

### 2026-07-16 · #405 role and time lineage fields were typed but not fully canonical

- **Class:** canonical run attempt, role description, and capture timestamp formatting.
- **Symptom:** synthetic checks accepted a numerically implausible but length-bounded run-attempt string, descriptions that contradicted the otherwise canonical B/C role IDs, and any timestamp text that the platform parser could order rather than one canonical timestamp representation.
- **Root cause:** digit-text and generic date parsing established loose validity, while free descriptions were left outside the exact role identity contract.
- **Current unblock:** delegated REDs cover leading, oversized, and unsupported run/attempt formats; swapped or ambiguous role descriptions; and noncanonical, timezone-ambiguous, equal, or reversed timestamps. Require supported positive integer formatting, exact role text or removal of identity-bearing descriptions, and canonical ISO-UTC timestamps before ordering. No fix is claimed.
- **Durable prevention:** use structured canonical types for run identity and capture time, and derive every human-readable role label from the validated role enum rather than accepting a second source of truth.
- **Fail-closed status:** exact-run lineage and provider evidence remain paused until attempt, role, and timestamp fields have one canonical representation.

### 2026-07-16 · #405 timing arrays needed realistic positive samples

- **Symptom:** zero or implausibly small frame and scenario-duration samples could produce false zero summaries.
- **Assigned tests/fix:** add positive-sample boundary tests and require realistic metric-specific bounds before computing summaries. No fix is claimed.
- **Prevention:** distribution helpers must reject missing or invalid elapsed samples rather than manufacture zero evidence.
- **Status:** frame, duration, and provider comparison evidence remain paused.

### 2026-07-16 · #405 resident ranges, memory scope, and follow-up needed one rule

- **Symptom:** resident-DOM minimum could exceed maximum, supported memory could omit its descriptive scope, and unavailable measurement follow-up lacked one consistent requirement.
- **Assigned tests/fix:** add range-order, memory-scope, and follow-up permutation tests; enforce ordered bounds, required supported-memory scope, and one follow-up rule. No fix is claimed.
- **Prevention:** validate each tagged measurement as one complete semantic state rather than independent primitives.
- **Status:** DOM, memory, follow-up, and provider evidence remain paused.

### 2026-07-16 · compaction and worker turnover left the live registry behind #405

- **Class:** orchestration state, session turnover, and registry drift.
- **Symptom:** after parent-context compaction and a worker handoff, the registry still named the retired `/root/prepare_404_provider` session and remote head `1ddaa00`, while live worktree, remote, and agent evidence agreed that `/root/resume_405_worker` had completed at `f374cb3483ff32efe2347c88a5906b73bf01627a`. The registry's retro checkpoint also lagged the clean local retro head `281de166e8b442fd352ad038f1562e1fc5ab1b64`, and historical #403/#404/#413 coordination records remained labelled in-flight after those issues landed and were cleaned.
- **Root cause:** compaction preserved the epic contract but not an atomic registry handoff, and completed worker/reviewer records accumulated in active maps instead of being moved to auditable history at lifecycle close.
- **Current unblock:** re-derived live main, local and remote #405 heads, worktree cleanliness, preserved stash, agent roster, tracker state, and retro divergence before editing the ledger. Reconciled #405 to the completed worker/head and exact-head v8 review boundary, retained the full historical records outside active maps, and marked the retro lane as requiring rebase before publication. No implementation, branch, push, PR, issue, or evidence artifact was changed.
- **Durable prevention:** every worker completion or session replacement must atomically update task head, session, review boundary, and lifecycle map before the next dispatch; post-compaction startup must compare registry head/session against `git ls-remote`, worktree HEAD/status, and the live agent roster. Historical coordination records belong in history, while `*InFlight` maps contain only genuinely active sessions.
- **Fail-closed status:** the stale registry was treated as a hint, not proof. #405 remains unpublishable until fresh exact-head review and all later provider/CI gates complete; the parked evidence stash remains preserved. Fable 5 was neither used nor accepted.

### 2026-07-16 · #405 v8 accepted five contradictory or noncanonical evidence states

- **Class:** exact-head schema validation and report consistency.
- **Symptoms:** v8 accepted pair-equal B/C choreography when both arrays were reversed from the canonical benchmark order; accepted B-control blank or missing-representation frames while the report always claimed zero continuity loss; accepted Unicode C1 controls such as U+0085 in trusted text; accepted unsupported memory evidence with a retained scope; and accepted impossible cache states where current entries or bytes exceeded their recorded peak.
- **Delegated v9 tests/fixes:** add REDs for pair-equal-but-noncanonical choreography and bind each sequence to the scenario-major benchmark contract; require B continuity counts to be zero before rendering the zero-loss statement; reject the full Unicode `Cc` category; require unsupported memory scope to be absent; and enforce `current <= peak <= maximum` for entries plus decoded, encoded, and metadata bytes.
- **Prevention:** validate each claim against its canonical source rather than only its peer, derive report prose from validated observations, use Unicode semantic categories instead of ASCII control ranges, and express support and cache measurements as closed states with cross-field invariants.
- **Fail-closed status:** exact-head `f374cb3483ff32efe2347c88a5906b73bf01627a` is blocked by two P1 and three P2 findings. Workflow, provider evidence, publication, PR creation, and architecture selection remain paused until v9 remediation is committed, independently reviewed, and re-gated. No Fable 5 evidence is permitted.

### 2026-07-16 · #405 v9 allowed cached-passive work in the candidate-off control

- **Class:** control isolation and default-off evidence integrity.
- **Symptom:** B-control could declare the #405 candidate off while retaining nonzero cache hits, misses, evictions, peak entries or bytes, capture time, invalidations, raster bytes, or over-budget peaks. Only captures and current entries were required to be zero, so a contaminated control could be published as untouched.
- **Root cause:** B validation covered a partial counter subset, while current/peak/maximum relationships and complete work/occupancy semantics were enforced only for Candidate C.
- **Delegated v10 tests/fix:** add mutation-sensitive REDs for every B cache work and occupancy counter, require all measured B values except configured maxima to be zero, and apply valid budget relationships to both roles before allowing the default-off claim.
- **Prevention:** derive role-specific zero/default-off requirements and shared cache invariants from one exhaustive counter registry so new telemetry cannot escape B validation.
- **Fail-closed status:** v9 head `100854a5dff556660071990a24ce884c6a6bf333` closed all five v8 findings but remains blocked by this P1. Workflow, provider evidence, publication, PR creation, and #406 architecture selection stay paused until v10 remediation is independently reviewed and re-gated. No Fable 5 evidence is permitted.

### 2026-07-16 · #405 v10 first full gate exposed spread-widened tuple inference

- **Class:** TypeScript test-fixture typing and canonical-gate recovery.
- **Symptom:** the first complete `ci:required` run failed type-checking because a spread-generated invalidation test table widened into a union that was not assignable to the expected tuple type, even though the focused runtime assertions were green.
- **Root cause:** composing table rows through object/array spreads relied on contextual tuple inference that did not survive the heterogeneous invalidation cases.
- **Current unblock:** replaced the spread-generated rows with one explicit readonly tuple table, reran the entire canonical gate rather than resuming after typecheck, and obtained green focused 10 files/170 tests plus green `ci:required` 131 files/1,973 tests on exact head `9823121a24d2c4f24853067f34581b7e433ad1c7`.
- **Durable prevention:** declare heterogeneous validation matrices with explicit readonly tuple types at their definition boundary and treat a focused-test pass as incomplete until the full TypeScript gate has checked the composed table.
- **Fail-closed status:** the failed first gate supplied no release evidence. Workflow/provider publication remained paused throughout, and only the complete green rerun advances v10 to fresh exact-head review. No Fable 5 evidence is permitted.

### 2026-07-16 · #405 v10 did not zero-gate B far-jump fallback observation

- **Symptom:** candidate-off B-control accepted `farJumpLightweightFallbackObserved: true` even though every candidate-owned observation must be absent when #405 is disabled.
- **Delegated v11 RED/fix:** mutate the B far-jump observation independently, prove rejection, and require it to be false alongside the exhaustive B work/occupancy zero set.
- **Prevention:** generate B default-off validation from one registry spanning counters, representations, activation, continuity, fidelity, and image behavior so a new candidate-owned field cannot escape.
- **Fail-closed status:** this P1 blocks v10 head `9823121a24d2c4f24853067f34581b7e433ad1c7`; workflow, provider evidence, publication, PR creation, and #406 remain paused.

### 2026-07-16 · #405 v10 did not pair-bind candidate-neutral policy and image values

- **Symptom:** B and C could disagree on cache-policy maxima, stored compressed bytes, decoded-pixel estimates, or rendition-residency measurements while each artifact remained independently valid; source-image values could also diverge from the identical retained raw fixture.
- **Delegated v11 RED/fix:** vary every neutral field across B, C, and retained raw; require identical policy maxima, bind source-image bytes to each other and the fixture, and enforce the declared neutrality relationship for rendition residency.
- **Prevention:** define candidate-neutral telemetry once with its authoritative source and generate pair/raw equality checks from that registry rather than validating roles independently.
- **Fail-closed status:** unpaired neutral values invalidate comparative attribution, so paired evidence and downstream selection stay paused.

### 2026-07-16 · #405 v10 allowed C reuse and captures without historical raster residency

- **Symptom:** Candidate C could report cache hits, captures, and passive representations while all peak entries/bytes and passive raster encoded/decoded accounting remained zero.
- **Delegated v11 RED/fix:** add cross-field mutants for hits/captures/representations against zero peaks and raster bytes; require positive historical residency plus positive encoded/decoded passive-raster accounting whenever reuse or successful capture is claimed.
- **Prevention:** model cache activity, residency, and raster accounting as one semantic state with implication checks, not independent nonnegative counters.
- **Fail-closed status:** the v10 review ran 140/140 focused checks and found no other P1/P2, but these impossible relationships keep workflow/docs/provider evidence and final approval paused. No Fable 5 evidence is permitted.

### 2026-07-16 · host saturation produced rotating unrelated full-gate timeouts

- **Class:** local canonical-gate capacity and evidence reliability.
- **Symptom:** successive full gates timed out in unrelated suites while the same targets passed alone: `ModCard.test.tsx` passed 8/8 in isolation and `renderIndexCache.test.ts` passed 16/16, including its collision case in 989 ms. A later `BottomDock.test.tsx` timeout was investigated, but its exact isolated transcript was lost across compaction and is deliberately not claimed as proof.
- **Root cause evidence:** the 10-logical-core host reported load averages from 21.78/28.55/22.74 up to 31.32/31.24/24.40 while an unrelated worktree ran `tsc` at roughly 156% CPU, several long-lived Playwright/Chrome groups competed for CPU and I/O, and endpoint/indexing services were active. Memory pressure still reported 38% free with no throttled pages. Vitest 4.1.9 otherwise defaulted to nine workers with 5-second test and 10-second hook deadlines, so scheduler contention—not a stable product-test or memory failure—best explained the rotating failures.
- **Current unblock:** left non-owned processes untouched, killed nothing, and did not inflate timeouts. Ran the exact canonical gate with its supported worker override: `VITEST_MAX_WORKERS=2 npx --yes --package=node@20 --package=npm@10 sh -c 'node -v && npm -v && npm run ci:required'`. It completed green at 131 files/2,002 tests; the test phase took 58.45 seconds.
- **Durable prevention:** serialize heavy gates on a saturated shared host; start with `VITEST_MAX_WORKERS=2` and fall back to one worker if contention persists. Preserve normal deadlines so a green run remains meaningful, and record missing transcripts as missing rather than reconstructing evidence after compaction.
- **Performance-evidence boundary:** the owner confirmed the current machine is the bottleneck and offered a clean gaming PC. No hardware move is needed yet: local throttled runs remain correctness-only and local performance numbers are never accepted. Primary performance evidence remains isolated GitHub Actions with paired B/C capture in the same job; an ephemeral self-hosted gaming PC is fallback only if the hosted runner proves unsuitable. Any interference or noise fails the evidence closed.
- **Fail-closed status:** only the complete throttled canonical run counts as gate evidence. Isolated greens diagnose contention but do not replace the full gate. No Fable 5 output was used or accepted.

### 2026-07-16 · #405 v11 final evidence/report validation failed open after assembly

- **Class:** validation-boundary completeness and mutation-sensitive report evidence.
- **Symptom:** v11 correctly enforced pair and source invariants while assembling evidence, but `validateCachedPassiveEvidence` still validated B and C independently and `renderCachedPassiveReport` relied on that final validator. After valid assembly, mutating cache maxima, stored or decoded source-image bytes, or rendition residency to another individually valid value was accepted and printed by the report.
- **Root cause:** `validateObservationPair` was called only at assembly time. Publication and reader paths happened to catch these mutations by reassembling, but the exported final-evidence/report boundary itself remained fail-open.
- **Current unblock:** exact-head review at `fd4a95f037467b56687a3accfb59e7ebf1c37912` ran 181/181 focused checks and found this one P1 with no other P1/P2. Delegated v12 mutation-sensitive REDs now exercise mutate-then-validate and mutate-then-render for policy maxima, authoritative stored/decoded image values, and rendition residency. The repair must split reusable pair validation so final evidence enforces runtime maxima, authoritative observation-image values, B/C neutrality, and rendition equality, while raw-fixture checks remain assembly-only.
- **Durable prevention:** every exported evidence consumer must validate the invariants its output assumes; assembly-time validation is not a substitute for validating a mutable final object at the report boundary. Require mutate-after-assembly REDs whenever evidence passes through more than one exported validator or renderer.
- **Fail-closed status:** workflow, docs, provider capture, publication, PR creation, and #406 remain paused during v12 remediation. No final approval exists, and no Fable 5 evidence is permitted.

### 2026-07-16 · abbreviated #405 v12 SHA was expanded against stale lineage

- **Class:** exact-head handoff identity and reviewer correction.
- **Symptom:** the worker initially reported an abbreviated v12 commit and orchestration expanded it to an incorrect full SHA. A reviewer was dispatched against that stale lineage.
- **Current unblock:** immediately re-read local `git rev-parse HEAD` and the exact remote branch ref, established `f07b485964a64650b678bb57e3f588f3f9c1b5f1` as the sole v12 head, corrected the reviewer, and explicitly discarded the stale-lineage attempt. No verdict or evidence from the wrong head was retained.
- **Durable prevention:** never expand an abbreviated worker SHA from memory, logs, or a prior registry value. Before every handoff or review dispatch, obtain the full local SHA with `git rev-parse HEAD`, obtain the remote exact ref, require equality when pushed, and place that exact 40-character value in the review contract.
- **Fail-closed status:** a review is absent unless its contract and output both name the verified exact head. The corrected v12 review below is the only accepted one. No Fable 5 output was used or accepted.

### 2026-07-16 · #405 v12 closed final-validator pair/source invariants

- **Class:** final evidence/report validation closure.
- **Closure evidence:** v12 head `f07b485964a64650b678bb57e3f588f3f9c1b5f1` added mutation-sensitive final-validator and renderer coverage for runtime maxima, authoritative stored/decoded image values, B/C neutrality, and rendition equality. Schema checks passed 153 tests, the focused suite passed 215 tests, and canonical `ci:required` passed 131 files/2,018 tests.
- **Independent review:** the corrected exact-head review passed with no P1/P2 after 197 tests, `tsc --noEmit`, and diff-check. Local and remote heads matched, the worktree was clean at handoff, and main remained `e58733e060314dbc41612b785dd533d700e6bc6a`.
- **Next lane:** provider workflow and documentation work may resume under `/root/resume_405_worker`; applying the preserved provider/workflow stash is authorized. Publication and architecture selection still require fresh exact-head hosted evidence and later gates.
- **Performance-evidence policy:** local runs remain correctness-only and local performance measurements are never selection evidence. Primary performance evidence is isolated GitHub Actions with paired B/C capture in the same job; an ephemeral clean self-hosted gaming PC is fallback only if hosted runners prove unsuitable. Interference or noise invalidates the run.
- **Fail-closed status:** the schema boundary is approved, not the candidate result. Provider evidence, workflow, docs, publication, PR, and downstream #406 remain gated. No Fable 5 evidence is permitted.

### 2026-07-16 · #405 provider v1 guard sampled phases instead of guarding them

- **Class:** hosted-run isolation, process ownership, and environmental comparability.
- **Symptoms:** each long raw-plus-observation phase took one guard sample after three seconds, so later load or peer work—including the second Playwright command—could escape detection. The guard excluded every descendant of a broad shell root while merely hashing, not matching, the supplied capture command; an unrelated sibling browser or workload could therefore be hidden. It also gated only instantaneous `load1 <= logicalCores`, without constraining B/C load or free-memory drift or evaluating `load5`/`load15`.
- **Root cause:** the first guard treated isolation as a preflight snapshot and process ancestry as sufficient ownership, rather than supervising one exact command tree continuously and comparing both phases under a bounded environmental envelope.
- **Delegated provider-v2 REDs:** start peer/load work after the initial sample and require rejection; inject an unrelated sibling under the owned shell and require detection; mismatch the declared and executed capture commands and require rejection; retain phase maxima and timestamps until the exact owned process exits; reject excessive B/C load or memory drift and sustained load-window saturation.
- **Durable prevention:** bind the guard to the exact normalized command, permit only its intended Playwright root and browser descendants, monitor through process exit, and validate comparable capacity/load/memory envelopes across B and C. Treat telemetry timestamps and maxima as evidence, not diagnostics.
- **Fail-closed status:** head `5e301c88a6d6428b95610d8af14bd0bbdd91311d` remains local and unpushed. No workflow/provider dispatch or local performance capture is allowed during provider-v2 remediation; noisy or incomplete isolation invalidates the run. No Fable 5 evidence is permitted.

### 2026-07-16 · #405 provider v1 shallow-checked runner telemetry at publication

- **Class:** evidence provenance, telemetry validation, and atomic publication.
- **Symptoms:** publication checked only top-level identity and phase names. Invalid per-sample loads, concurrency, timestamp order, environment stability, or command digests could still publish; runner telemetry was not compared with raw OS/CPU/Node/capacity facts, raw capture timestamps were not bound to B/C phase windows, and telemetry was not covered by the publication manifest/digest.
- **Root cause:** the writer created a second shallow acceptance path instead of reusing the complete telemetry validator and treating environmental evidence as part of the atomic artifact set.
- **Delegated provider-v2 REDs:** mutate each nested telemetry field and require writer rejection; mismatch runner versus raw environment/capacity; place B/C raw timestamps outside their guarded phase windows; alter telemetry after manifest creation; and simulate partial writes so no evidence or telemetry artifact can publish alone.
- **Durable prevention:** expose one full runner-telemetry validator to capture and publication, bind environment and phase windows to both raw roles, include telemetry bytes in the manifest/digest, and promote the complete evidence set atomically.
- **Fail-closed status:** guard/workflow-policy 17/17, focused schema/benchmark 186/186, and TypeScript were green, but those gates did not prove nested publication integrity. They authorize no push, provider dispatch, artifact, report, or #406 input. Local performance numbers remain inadmissible; no Fable 5 output is accepted.

### 2026-07-16 · #405 provider v1 authored required measurements and covered fidelity only for Note

- **Class:** browser measurement authenticity, pixel accounting, and card-kind coverage.
- **Symptoms:** pixel-fidelity code closed both `ImageBitmap`s before reading the denominator, so detached widths/heights became zero and the ratio divided by one. First-intent, focus promotion, maximum bounds delta, and paint/composite evidence were authored constants: click occurred only after hover already produced Live authority, geometry was not compared, and paint was hardcoded to zero while reported as measured. Settled fidelity actually compared passive and live pixels only for Note; Result and Conversation merely waited for passive state and returned success.
- **Root cause:** the harness encoded expected outcomes where it needed independent runtime observations, and a shared card-kind loop obscured that only one kind performed the substantive fidelity comparison. Bitmap lifetime was not treated as part of measurement validity.
- **Delegated provider-v2 REDs:** capture bitmap dimensions before close and prove detach ordering; exercise passive focus and zero-lead first click; derive intent delivery and focus from runtime state/event deltas; compare pre/post bounds; measure paint or emit an explicit unavailable state; and require passive-versus-live fidelity images and thresholds independently for Note, Result, and Conversation.
- **Durable prevention:** every reported metric must name its observation source or an explicit unavailable status, tests must mutate runtime outcomes rather than constants, resource lifetime must be asserted around pixel math, and acceptance matrices must enumerate all required card kinds with equivalent substantive probes.
- **Fail-closed status:** the midstream review found five P1 findings and one P2, with this measurement group containing two P1 and the P2. Provider-v2 remediation is active under `/root/resume_405_worker`; the unpushed v1 commit remains historical evidence only. No provider dispatch, local performance acceptance, publication, or Fable 5 evidence is permitted.

### 2026-07-16 · a zsh wrapper converted a green canonical gate into exit 1

- **Class:** root operator-shell friction and exit-code capture.
- **Symptom:** the provider-v2 canonical gate completed successfully, but its surrounding zsh wrapper assigned the result to the readonly reserved parameter `status`. The wrapper itself then exited 1, creating an apparent failure after the repository gate had passed.
- **Root cause:** orchestration glue reused a zsh special parameter name; the failure occurred after `ci:required` and was not produced by repository CI, product tests, or the provider workflow.
- **Current unblock:** kept the first transcript fail-closed, changed only the operator wrapper to capture the child result in `code`, and reran the complete command. The rerun exited 0 with canonical CI-tool tests 47, `ci:required` 131 files/2,027 tests under `VITEST_MAX_WORKERS=2`, plus typecheck, workflow policy, build, and budget green. Candidate tests were 159; guard/workflow tests first passed 20 before the canonical aggregate.
- **Durable prevention:** avoid shell-reserved names in wrappers and prefer direct exit propagation or immediate capture into a known ordinary variable such as `code`; validate the wrapper itself separately when it contributes orchestration evidence.
- **Fail-closed status:** the first wrapper exit 1 supplied no gate proof even though nested output looked green; only the full exit-0 rerun counts. This was root-shell friction, not repo-CI drift. Provider dispatch, local performance acceptance, publication, and Fable 5 evidence remain prohibited during active remediation.

### 2026-07-16 · #405 provider v2 guard rejected the real Playwright web-server tree and left sampling edges open

- **Class:** production-shaped process ownership and continuous phase supervision.
- **Direct repro symptoms:** the allowlist passed a simplified synthetic Playwright tree but rejected the real web-server chain rooted at `npm exec playwright`, which spawns Playwright through `sh`/Node and then the configured `npm run dev` → `sh -c vite` server descendants. Separately, moving a window's declared start earlier than its first sample or its end later than its last sample still validated, leaving unobserved leading/trailing work. Large B/C load changes also passed because each phase was bounded independently but the pair had no drift rule.
- **Root cause:** test fixtures modeled the desired tree instead of the actual Playwright `webServer` lifecycle; internal sample-gap checks did not bind phase boundaries to the first and terminal observations; environment validation checked absolute ceilings without comparing B and C distributions.
- **Delegated provider-v3 REDs:** replay a captured production-shaped npm/sh/Node/Playwright/Vite tree and require acceptance only for the exact owned descendants; inject sibling npm, shell, browser, and Vite processes and require rejection; shift start and end timestamps beyond the sampling allowance; and create individually valid B/C windows with materially different load distributions and require pair rejection.
- **Durable prevention:** derive guard fixtures from the actual command topology, classify ownership by exact ancestry plus command identity rather than executable names alone, require bounded first-sample and terminal edges as well as interior gaps, and validate B/C capacity/load/memory comparability at the pair boundary.
- **Fail-closed status:** exact-head review at `1cc995f4467510c68bf0589170613aa0243a51ba` found three P1 blockers including these process, edge, and load-drift failures. Guard/policy 21/21, schema 162/162, TypeScript, and diff-check were green, but no push, provider dispatch, local performance evidence, publication, or Fable 5 evidence is authorized.

### 2026-07-16 · #405 provider v2 observation sidecars were not bound to their guarded windows

- **Class:** browser observation provenance and phase-window identity.
- **Direct repro symptom:** observation artifacts could retain correct role/head fields while changing or omitting when they were captured and which monitored command produced them; publication accepted sidecars without a `capturedAt` value and command-window digest that matched the corresponding guarded observation phase.
- **Root cause:** raw artifacts gained phase-window binding, but observation sidecars remained a parallel, shallower evidence path without the same temporal and command identity contract.
- **Delegated provider-v3 REDs:** remove or mutate observation `capturedAt`; place it before or after its B/C observation window; swap B and C window digests; bind a sidecar to the raw-capture digest; mutate the guarded window after sidecar creation; and require full publication plus manifest validation to reject every case.
- **Durable prevention:** give every raw and observation artifact one required role-specific window reference containing exact command digest and bounded capture time, validate it against telemetry before assembly, and include the sidecar/window binding in the atomic manifest digest.
- **Fail-closed status:** this P2 joins the three P1 guard blockers in provider-v3 remediation under `/root/resume_405_worker`. Sidecars from v2 are not evidence, and hosted execution remains undispatched. Local measurements and Fable 5 output are never accepted.

### 2026-07-16 · provider-v3 canonical gate needed one worker under renewed host saturation

- **Class:** local correctness-gate capacity and cause-based recovery.
- **Symptom:** the two-worker canonical run reached 130/131 files and 2,032/2,033 tests before `ModCard.test.tsx` timed out its Cmd-Z case at the unchanged 5-second deadline. At the time, Codex, WindowServer, and unowned Chromium processes were saturating the shared host.
- **Diagnosis:** the exact failing test passed alone in 468 ms, ruling against a stable Cmd-Z behavior regression and matching the prior pattern of rotating unrelated timeouts under scheduler pressure. The remaining gate work had otherwise completed, but 130/131 and 2,032/2,033 is still red, not near-green evidence.
- **Current unblock:** did not blindly retry, extend the test timeout, or kill unowned processes. Applied the documented capacity response once by reducing `VITEST_MAX_WORKERS` from two to one and reran the entire canonical gate. That run exited 0 with CI tooling 50/50 and the fast suite at 131 files/2,033 tests; typecheck, workflow policy, build, and budget were green.
- **Durable prevention:** when an unrelated timeout appears under observed host saturation, require a fast isolated discrimination run, then make at most one cause-based full rerun at lower supported concurrency. Preserve ordinary deadlines and record both failed and accepted transcripts; serialize local heavy gates where possible.
- **Fail-closed status:** the two-worker run and isolated 468 ms pass are diagnostic only. The complete one-worker exit-0 rerun is the sole accepted canonical evidence at provider-v3 head `1906a2d67304d50c0cab305da2e1e18c74edea4f`. No local performance numbers, provider dispatch, push, timeout waiver, process kill, or Fable 5 evidence is authorized.

### 2026-07-16 · #405 provider v3 compared phase load but not free-memory distributions

- **Class:** paired hosted-run environmental comparability.
- **Direct repro:** on a synthetic 16 GB host, B-control samples with roughly 15 GB free and C-candidate samples with roughly 11 GB free were both individually valid and the pair passed. The four-gigabyte phase difference could materially change browser/cache pressure while still being attributed to the candidate.
- **Root cause:** the paired phase comparator calculated maximum, median, and interquartile-range drift for normalized CPU load only. Free memory was retained in telemetry and absolutely bounded, but never normalized to host capacity or compared across B and C.
- **Delegated provider-v4 RED/fix:** create individually valid B/C windows whose normalized free-memory maximum, median, or IQR differs materially and require rejection in both the guard/telemetry validator and the publication path; add corresponding near-threshold accepted cases. Compute free-memory ratios against the identical validated host capacity, apply explicit phase max/median/IQR drift limits, and reuse one comparator in guard and publisher.
- **Durable prevention:** every environmental variable retained to establish performance comparability must have an explicit pair-level invariant, not merely an individual range check. Generate guard and publication mutations from the same capacity-normalized distribution registry so a new telemetry dimension cannot escape one boundary.
- **Fail-closed status:** provider-v3 exact-head review closed the prior process-tree, full-window, terminal-state, and observation-binding findings and passed guard/policy 24, schema 168, TypeScript, and diff-check. This sole P1 keeps provider-v4 remediation active under `/root/resume_405_worker`; no push, provider dispatch, local performance acceptance, publication, or Fable 5 evidence is allowed.

### 2026-07-16 · #405 provider v4 closed phase memory comparability

- **Closure:** provider-v4 normalized each free-memory sample to the validated host capacity and applied the same phase maximum, median, and interquartile-range comparison in both guard and publisher validation. The prior 16 GB-host B≈15 GB/C≈11 GB repro is now rejected while near-threshold pairs remain accepted.
- **Verification:** clean local head `602c50fe1c851e7272f91b3430ce207ee44446dd` passed focused guard/policy 24, schema 169, and canonical 131 files/2,034 tests. Independent exact-head review found no P1/P2; all provider-v3 process-tree, full-window, terminal-state, load-drift, and observation-binding protections remained intact.
- **Durable prevention:** keep capacity-normalized CPU and memory distribution comparisons in one shared pair validator consumed by collection and publication, and retain both material-drift rejection and near-threshold acceptance mutations whenever environmental telemetry evolves.
- **Next lane:** final documentation and PR preparation may proceed under `/root/resume_405_worker`, but remote hosted capture remains on hold until the combined final docs/workflow review approves the exact head. Local performance numbers remain inadmissible.
- **Fail-closed status:** this is local evidence-pipeline approval, not provider evidence or candidate selection. The branch remains clean, four commits ahead, and unpushed; no workflow dispatch, publication, PR approval, or Fable 5 evidence is implied.

### 2026-07-16 · #405 final combined review found default-off runtime work behind fabricated B zeros

- **Class:** production default-off behavior and control-evidence authenticity.
- **Symptom:** `Board.tsx` constructed and attached the cached-passive runtime even with the candidate disabled, so the shared coordinator/cache subscribed and the real disabled state reported `runtimeAttached=true` with at least one shared capture listener. The B-control browser harness exited early and authored zero runtime/cache counters instead of observing this work.
- **Root cause:** the hook owned runtime creation and attachment unconditionally, then passed `enabled=false` into an already-live owner. The evidence path treated the feature flag as proof of inactivity rather than measuring the runtime, subscription, and listener state it claimed was zero.
- **Delegated final-default-off RED/fix:** make disabled ownership genuinely inert and lazily create/attach only on enable; prove no coordinator/cache subscription, capture listener, timer, entry, or work counter while disabled; cover enable→disable cleanup and React StrictMode mount/unmount/remount without duplicate owners or leaked listeners; and make B read the same runtime/listener counters as C rather than hardcoding zeros. Mutating the disabled path to attach or increment any counter must fail both browser evidence and schema validation.
- **Durable prevention:** a default-off claim must be a runtime observation, never an inference from configuration. Keep owner lifecycle counters and listener/subscription accounting observable in both roles, require StrictMode lifecycle tests for every lazy global/shared owner, and generate B zero proofs from the exhaustive measured counter registry.
- **Fail-closed status:** final combined head `6b48cff3c2168b3f8cd37b918fcea92de07b71d2` otherwise passed 231 focused tests, 24 guard/policy tests, canonical CI, and diff-check, but this sole P1 invalidates its default-off evidence. Final-default-off remediation is active under `/root/resume_405_worker`; push, provider dispatch, publication, PR approval, local performance acceptance, and Fable 5 evidence remain forbidden.

### 2026-07-16 · #405 default-off closure is implemented and awaiting exact-head review

- **Closure in progress:** at clean local head `be64979d7616bbb235213f3a74b087947850fba4`, the disabled Board path keeps the cached-passive owner `null` and inert, including React StrictMode mount/unmount/remount. Owner creation remains lazy for the enabled path, and enabled teardown still detaches subscriptions/listeners and cleans up the runtime.
- **Evidence repair:** B-control no longer fabricates zero work from the feature flag. A measured owner probe feeds schema v5 with attachment, listener, subscription, and runtime/cache activity state, and the exhaustive disabled validation rejects any observed work. Candidate C uses the same observation boundary.
- **Verification:** focused default-off/runtime/schema coverage passed 180 tests and canonical `ci:required` passed 2,044 tests. The branch is clean, six commits ahead, based directly on current main `e58733e060314dbc41612b785dd533d700e6bc6a`, and remains unpushed.
- **Durable prevention:** retain StrictMode owner/listener-count regressions and measured B schema mutations as permanent default-off gates; do not permit a configuration flag to substitute for observed owner lifecycle or work counters.
- **Fail-closed status:** implementation and gates are green, but closure is not accepted until `/root/review_405_v8_schema` completes a fresh exact-head review. No provider run, push, publication, local performance evidence, or Fable 5 output is authorized.

### 2026-07-16 · #405 default-off P1 closed with final implementation approval

- **Closure:** exact-head review at `be64979d7616bbb235213f3a74b087947850fba4` confirmed the disabled path returns `null` before cache/runtime allocation and performs no attach, detach, update, subscription, shared-listener, or timer work. StrictMode inertness, lazy enabled ownership, and enabled teardown cleanup remain covered.
- **Evidence authenticity:** B reads the content-free development owner probe rather than inferring inactivity from a missing marker. Schema v5 retains those measured owner/runtime fields and rejects every contaminated B field, while production output exposes neither the probe global nor its data.
- **Verification:** final review found no P1/P2 after 208 applicable focused runtime/evidence tests, guard/workflow policy 24/24, canonical `ci:required` with 50 CI-tool tests plus 131 files/2,044 tests, and clean diff/worktree checks.
- **Approval boundary:** implementation, documentation, workflow contract, and evidence machinery are approved for controlled publication/PR preparation. The provider-only report entrypoint and hosted B/C capture were intentionally not run without trusted provider artifacts/environment, so no measured candidate outcome or architecture decision exists yet.
- **Fail-closed status:** hosted provider outcome, artifact validation, PR current-head checks, and merge approval remain pending. Local performance remains inadmissible, and no Fable 5 evidence is permitted.

### 2026-07-16 · #405 published as PR #444 and immediately exposed a provider-sized fixture assumption

- **Publication milestone:** approved head `be64979d7616bbb235213f3a74b087947850fba4` was pushed with force-with-lease and opened ready as PR [#444](https://github.com/limweili/eido/pull/444). Local and remote heads match; main remains `e58733e060314dbc41612b785dd533d700e6bc6a`. The experimental provider workflow remains held.
- **Live check state:** the initial Required gate did not remain queued: run `29480395557`, job `87562574286` failed in CI-tool test 34. Browser interactions run `29480395355` later succeeded, and the nightly shard was skipped by policy. Merge is blocked by Required.
- **Root cause evidence:** `retains a gap-bounded continuous history for a clean command window` hardcoded `freeMemoryBytes=12_000_000_000` while inheriting total host capacity from the executing machine. The 24 GB local host made that fixture valid; the smaller GitHub runner made free memory exceed total memory and correctly triggered `Performance telemetry host capacity is invalid.`
- **Unblock/prevention:** replace host-sized fixture bytes with values derived from the explicit synthetic capacity and add a small-host regression so CI-tool tests are machine-independent. Keep capacity validation strict; do not weaken the production guard to accommodate the test. Require a fresh exact-head Required rerun and investigate the Browser result before merge.
- **Disclosure:** no Fable 5 output, private save data, or local performance number contributed to implementation approval, publication, or this diagnosis. Provider outcome and architecture selection remain absent.

### 2026-07-16 · publication tooling failed while direct GitHub evidence remained available

- **Class:** connector and local dependency-locator friction.
- **Symptoms:** GitHub plugin `fetch_pr` and `list_pr_changed_filenames` returned 404 for valid PR #444 even though repository and workflow access through authenticated `gh` succeeded. The bundled workspace dependency locator also hung for more than 120 seconds and was terminated.
- **Current unblock:** treated connector failures as absent evidence, not proof that the PR was missing. Used `gh pr view`, exact remote refs, and `gh run view --log-failed` to validate the PR/head/checks and diagnose Required. Used the already verified `npx` Node 20/npm 10 path where an explicit toolchain was needed; no state-changing workaround bypassed review or CI.
- **Durable prevention:** keep direct authenticated `gh` metadata/log commands as the documented fallback for connector 404s, place a bounded deadline around dependency discovery, and use the pinned `npx` toolchain only after verifying versions. File connector and locator defects separately rather than weakening evidence gates.
- **Fail-closed status:** the tooling failures neither turn Required green nor authorize merge/provider execution. The live Required red diagnosis remains controlling despite the green Browser canary, and no Fable 5 output is evidence.

### 2026-07-16 · #405 closed the host-dependent CI fixture without weakening the guard

- **Repair:** test-only head `01f6db0b9dff46bfe15cc5030a259e1d572fe12a` replaced inherited host memory in the clean-window fixture with one explicit synthetic 16 GB capacity and 75% free-memory value. Samples, retained windows, and terminal telemetry now share that synthetic capacity; production guard and evidence semantics are unchanged.
- **Local verification:** explicit Node 20.20.2/npm 10.9.8 passed the focused performance-guard suite 13/13, all CI-tool tests 50/50, and `VITEST_MAX_WORKERS=1 npm run ci:required` at 131 files/2,044 tests. Workflow policy and build were green; the bundle was 403.4/450 KiB.
- **Independent review:** routine gpt-5.6-terra exact-head review approved the test-only diff with no P1/P2, confirmed exact parent `be64979d7616bbb235213f3a74b087947850fba4`, and found the diff and worktree clean.
- **Hosted closure:** the replacement Required gate passed at [run 29480887384, job 87564124754](https://github.com/limweili/eido/actions/runs/29480887384/job/87564124754). Browser interactions also passed at [run 29480887332, job 87564124566](https://github.com/limweili/eido/actions/runs/29480887332/job/87564124566), while nightly job `87564125428` was skipped by PR policy. GitHub reports PR #444 `CLEAN` at the exact pushed head.
- **Evidence boundary:** the prior Required failure at [run 29480395557, job 87562574286](https://github.com/limweili/eido/actions/runs/29480395557/job/87562574286) remains retained diagnosis rather than erased history. Exact-head checks and review are green, but provider B/C outcome evidence remains absent and must still fail the product decision closed. No Fable 5, private save data, or local performance measurement was used.

### 2026-07-16 · manual workflow dispatch failed before GitHub created a run

- **Class:** default-branch workflow registration and provider bootstrap.
- **Symptom:** the authorized `gh workflow run` attempt for the cached-passive candidate returned HTTP 404 because `.github/workflows/rich-card-cached-passive-candidate.yml` exists only on PR #444 and is absent from the default branch workflow registry. GitHub created no run, job, attempt, artifact, or performance evidence.
- **Decision and unblock:** keep #405 fail-closed and unmerged rather than treating an absent provider run as evidence. Create one process/bootstrap issue and isolated workflow-only PR under #410/#405 that copies the already-reviewed manual-only workflow bytes onto current main. After that bootstrap lands, dispatch #405's exact workflow ref through the registered default-branch workflow entry.
- **Scope guard:** the bootstrap owns only the workflow file. If current-main workflow policy rejects it because referenced scripts do not yet exist, stop and report the dependency instead of broadening the bootstrap into code, scripts, or docs.
- **Prevention:** any new manual evidence workflow must include a default-branch registration/bootstrap edge before its first required dispatch. A dispatch command that returns before producing a run identifier is tooling/process failure, never a red or green experiment.
- **Disclosure:** no merge, provider workload, artifact, private save data, local performance result, or Fable 5 evidence resulted from the failed dispatch.

### 2026-07-16 · bootstrap canonical gate hit another shared-host timeout

- **Symptom:** the first workflow-only bootstrap `ci:required` run passed workflow policy, build, bundle, and 1,805 behavior tests, then timed out the unrelated content-visibility keyboard-copy case at its unchanged five-second deadline.
- **Diagnosis:** the 10-core host had load average 25.46 with unrelated indexing, UI, and browser work active. The exact timed-out test passed unchanged in 264 ms, with the isolated file invocation completing in 1.02 seconds. The bootstrap diff contained only an unconsumed manual workflow file, so the timeout was retained as diagnostic red rather than attributed to workflow behavior.
- **Current unblock:** changed no code or timeout and killed no unowned process. Made one cause-based full rerun at the already-minimal `VITEST_MAX_WORKERS=1`; it exited 0 with CI tooling 35/35, workflow policy/build/bundle green, and 122 files/1,806 behavior tests passing.
- **Prevention:** continue serializing heavy local gates where possible and require an exact isolated discrimination run before the single lower-concurrency or same-minimal-concurrency recovery run. Near-green output never counts; only the complete exit-0 rerun is accepted.
- **Disclosure:** this is local correctness evidence only, not candidate performance evidence. No Fable 5, private save data, or provider artifact was used.

### 2026-07-16 · workflow registration bootstrap published without widening #405

- **Tracker and isolation:** filed [#446](https://github.com/limweili/eido/issues/446) as a process dependency of #405/#410, reserved its worktree and branch before mutation, and based it on exact main `e58733e060314dbc41612b785dd533d700e6bc6a`.
- **Byte and scope proof:** bootstrap head `bb52ad498597f8411c735a8c8d1775ea9f6624a9` adds only `.github/workflows/rich-card-cached-passive-candidate.yml`. Its blob SHA `4561d91eacab12e13b327a899eb07299d1730efa` exactly matches PR #444 head `01f6db0b9dff46bfe15cc5030a259e1d572fe12a`; no referenced script, docs, code, package, or evidence file moved with it.
- **Publication:** pushed the new branch normally and opened ready PR [#447](https://github.com/limweili/eido/pull/447), referencing #446, #405, and #410. The PR started Required run `29481971541`, job `87567574099`; absence of a completed exact-head result remains absent, never green.
- **Next gate:** a Merge Captain may land #447 only after fresh exact-head checks and review. Then main must go green before retrying #405 provider dispatch through the registered default-branch workflow. This bootstrap itself creates no candidate evidence or merge authorization.
- **Disclosure:** no Fable 5, private save data, provider run, or local performance result was used.

### 2026-07-16 · bootstrap PR reached exact-head Required green

- **Terminal evidence:** PR #447 remained at exact head `bb52ad498597f8411c735a8c8d1775ea9f6624a9`; Required [run 29481971541, job 87567574099](https://github.com/limweili/eido/actions/runs/29481971541/job/87567574099) completed successfully in 1m37s and GitHub changed the PR merge state to `CLEAN`.
- **Remaining gate:** the workflow-only PR is held open for independent routine review and Merge Captain. Required green does not merge it, dispatch #405, or manufacture the still-absent provider evidence.
- **Disclosure:** no Fable 5, private save data, provider run, or local performance evidence was used.

### 2026-07-16 · bootstrap workflow passed independent exact-head review

- **Review closure:** routine gpt-5.6-terra review approved PR #447 head `bb52ad498597f8411c735a8c8d1775ea9f6624a9` with no P1/P2. It independently confirmed the sole workflow diff and blob identity, manual-only trigger, read-only permissions, pinned actions, synthetic guarded sequential B/C capture, success-only validated evidence uploads, and diagnostics-only failure output.
- **Handoff:** with exact-head Required green and review approved, #447 is ready for the dedicated Merge Captain. No merge or #405 provider dispatch occurred in the bootstrap worker.
- **Disclosure:** no Fable 5, private save data, provider run, or local performance evidence was used.

### 2026-07-16 · workflow bootstrap landed, exact-main proof completed, and owned resources were cleaned

- **Landing:** dedicated Merge Captain squash-merged [PR #447](https://github.com/limweili/eido/pull/447) at `0900476641954c2362bae2290b1ff5ade2386776`. GitHub reports the reviewed source head `bb52ad498597f8411c735a8c8d1775ea9f6624a9` as merged, and issue [#446](https://github.com/limweili/eido/issues/446) auto-closed as completed.
- **Exact-main proof:** Required [run 29492280875, job 87601017028](https://github.com/limweili/eido/actions/runs/29492280875/job/87601017028) completed successfully for the exact merge SHA. Release artifact `8372943289`, `eido-main-0900476641954c2362bae2290b1ff5ade2386776`, has digest `sha256:c7041312ebc2a036a0d6382aa5319b9d1eaf4786c9bd8636607ab80e23212efc` and the same exact head identity.
- **Cleanup:** the registry-owned bootstrap worktree, local branch, and remote branch were removed and then independently verified absent. The founder's canonical checkout remained untouched at `e58733e060314dbc41612b785dd533d700e6bc6a` with untracked `research/prototype/`; it was one commit behind live main at this boundary.
- **Dependency transition:** PR [#444](https://github.com/limweili/eido/pull/444) remained open at remote head `01f6db0b9dff46bfe15cc5030a259e1d572fe12a`, one main commit behind at bootstrap closure. Its branch therefore required preservation-aware rebase and a force-with-lease update before the now-registered provider workflow could be dispatched. Provider evidence and architecture selection remained absent.
- **Fail-closed status:** landing the registration workflow unblocked dispatch mechanics only. It did not validate the cached-passive candidate, authorize #444's merge, or create performance evidence. No Fable 5, private save data, or local performance number contributed to the merge or its proof.

### 2026-07-16 · cleanup preflight quoting and squash ancestry caused safe, recoverable friction

- **Class:** merge-cleanup tooling.
- **Symptoms:** the first read-only cleanup preflight used a malformed `gh --jq` shell expression and exited nonzero before any mutation. After the corrected preflight proved the merge and exact-main state, safe `git branch -d` still retained the local bootstrap branch because a squash-merged source tip is not an ancestor of `main`.
- **Unblock:** treated the quoting error as absent preflight evidence and performed no deletion. Re-ran the GitHub query with a correctly quoted filter, then proved PR #447 was merged at the expected source and merge heads, issue #446 was closed, exact-main Required and artifact identities matched, the owned worktree was clean/removable, and the remote branch was gone. Only after those checks did registry-scoped `git branch -D` remove the known squash-source branch; a final worktree/branch/remote probe verified all three absent.
- **Durable prevention:** prefer `gh ... --json` followed by a separately single-quoted `jq` filter for multi-field cleanup predicates, and require the read-only preflight to exit zero before the first mutation. Encode squash-merge cleanup as safe-delete first, then force-delete only after exact merge, main-CI, clean-worktree, and registry-ownership proofs; never interpret `-d` refusal as permission by itself.
- **Fail-closed status:** both frictions occurred before or during registry-scoped cleanup and did not weaken review, merge, or main-CI gates. The canonical dirty checkout was not touched, and no Fable 5 or private data was used.

### 2026-07-16 · #405 rebased without semantic drift and entered hosted provider execution

- **Rebase:** preserved the clean #405 worktree and untouched stash `26baf66127074b6a9ab68103107a883f3c8a0a6d`, then rebased PR #444 onto bootstrap main `0900476641954c2362bae2290b1ff5ade2386776`. The sole conflict was the expected workflow add/add: both sides contained blob `4561d91eacab12e13b327a899eb07299d1730efa`, so retaining main's byte-identical copy left the workflow absent from the PR diff and changed no behavior or evidence semantics.
- **Lineage proof:** pre-rebase head `01f6db0b9dff46bfe15cc5030a259e1d572fe12a` and rebased head `bf5d2e7c48de6a98461966da4bd29763abd075dd` have identical complete tree `702affce4d01f2d0d40bd4a9d424ddce55b6bbdc`; their non-workflow aggregate stable patch-id is identically `12bff4c2fea0c67649a83af6f443c8ff7450f7d0`. Fresh independent gpt-5.6-sol review approved the exact lineage with no P1/P2.
- **Publication and gates:** pushed only with explicit force-with-lease against expected old remote `01f6db0b9dff46bfe15cc5030a259e1d572fe12a`. Local, remote, and PR heads now match; the worktree is clean and PR #444 is `CLEAN`/mergeable. Node 20/npm 10 canonical `ci:required` passed 131 files/2,044 tests; exact-head Required [run 29492857563, job 87602879359](https://github.com/limweili/eido/actions/runs/29492857563/job/87602879359) and Browser [run 29492857568, job 87602879379](https://github.com/limweili/eido/actions/runs/29492857568/job/87602879379) are green.
- **Provider transition:** after the review and current-head gates, registered workflow [run 29493233675, job 87604080241](https://github.com/limweili/eido/actions/runs/29493233675/job/87604080241) started at the exact rebased head, then failed closed during B capture with `Performance evidence found a disallowed owned descendant at PID 3004.` Setup, schema/guard validation, and the pre-B boundary were green; C, publication, and validated evidence upload were skipped. Diagnostic artifact `8373304957` (`sha256:0ae8f27e83ca559c924fc534a5e0a1d52db58e62a83cdaf91064f725cabba1b0`) is explicitly non-evidence. Exact process classification is under diagnosis before any cause-based rerun.
- **Fail-closed status:** the rebase introduced no product, storage, API, documentation, test, or evidence change. Provider work uses synthetic fixtures only; local performance remains inadmissible, and no Fable 5 or private save data was used.

### 2026-07-16 · two read-only/focused probes were discarded rather than normalized into evidence

- **Class:** shell and test-selection tooling.
- **Symptoms:** one read-only zsh probe used `path`, a special tied array variable, so its output was discarded and the probe was rerun with a neutral variable name. Separately, the first focused-test command accidentally included the provider assembler, which correctly rejected the invocation because required hosted artifact paths were absent.
- **Unblock:** changed no production code and supplied no fake artifact paths. Re-ran the shell probe without zsh's reserved variable and ran the intended ten-file candidate unit manifest only; the corrected focused set passed 241/241. The assembler's fail-closed error remains expected proof that provider-only entrypoints cannot be converted into local evidence by omission.
- **Durable prevention:** avoid shell-reserved names such as `path`, `status`, and `commands` in zsh audit snippets. Keep explicit, separately named manifests for artifact-free unit suites and provider assembler/report entrypoints; focused local verification must never glob provider-only executables requiring trusted artifact identity.
- **Fail-closed status:** neither discarded run counts as green or red product evidence. The accepted 241-test unit set, canonical gate, hosted exact-head checks, and independent lineage review are recorded separately; no Fable 5 or private data was used.

### 2026-07-16 · first #405 provider failure proved the guard but under-specified the offending process

- **Symptom:** exact-head provider [run 29493233675, job 87604080241](https://github.com/limweili/eido/actions/runs/29493233675/job/87604080241) correctly stopped B after detecting disallowed owned descendant PID `3004`, but its error and diagnostics retained only the PID. Diagnostic artifact `8373304957` (`sha256:0ae8f27e83ca559c924fc534a5e0a1d52db58e62a83cdaf91064f725cabba1b0`) held provider telemetry only, so it could not distinguish an unexpected workload from a legitimate Playwright/npm descendant missing from the allowlist.
- **Fail-closed behavior:** C, the publisher, and validated evidence upload were skipped. The 675-byte failure artifact is diagnostics-only and non-evidence; no candidate outcome, architecture eligibility, or merge authority can be inferred from it.
- **Bounded unblock:** diagnostic-only head `fa093cd4c1c13f5a48ba3d6b19117c4a133ea89c`, parent `bf5d2e7c48de6a98461966da4bd29763abd075dd`, changes only `scripts/ci/performance-runner-guard.mjs` and its test. A rejected owned descendant reports PID/parent PID, an executable basename, bounded argument shapes, and a command digest; no process is newly allowed and no performance threshold changes. Its initial privacy test covered a representative private path/token case, but acceptance remained explicitly subject to fresh adversarial review.
- **Verification boundary:** focused guard/workflow-policy tests passed 24/24 and canonical Node 20/npm 10 `ci:required` passed 131 files/2,044 tests locally. Exact-head Required [run 29493857561, job 87606091229](https://github.com/limweili/eido/actions/runs/29493857561/job/87606091229) and Browser [run 29493857584, job 87606090859](https://github.com/limweili/eido/actions/runs/29493857584/job/87606090859) then completed green. Fresh Sol review remained in progress at this checkpoint, so a cause-based provider rerun remained held.
- **Durable prevention:** every fail-closed process-classification rejection must emit enough bounded, privacy-safe identity to classify the next action, while never preserving raw command lines, environment, user paths, tokens, or save data. Diagnostic sufficiency and privacy redaction are one coupled test contract.
- **Disclosure:** no Fable 5, private save data, local performance result, provider rerun, or candidate evidence was used.

### 2026-07-16 · adversarial review found the first diagnostic sanitizer was not generally privacy-bounded

- **Class:** P1 privacy and diagnostic-artifact safety.
- **Finding:** fresh Sol review of `fa093cd4c1c13f5a48ba3d6b19117c4a133ea89c` found that a syntactically valid `node_modules/` suffix and arbitrary flag name could survive redaction, while a 10,000-character flag could exceed the intended diagnostic bound. The single representative path/token test did not prove the general privacy claim.
- **RED and remediation:** the owner added failing cases for a private module path, secret flag name/value, and huge flag. The two owned guard files now use explicit known-module and known-flag allowlists, generic placeholders for unknown names, at most 16 argv components plus a truncation marker, at most 80 characters per component, and at most 1,024 serialized bytes. PID, parent PID, and exact command digest remain for classification.
- **Current proof:** the strengthened focused set passed 24/24 and the full canonical gate passed 131 files/2,044 tests. The remediation was committed and pushed clean as `7611a45ead7d1756ac9d97e7d8f0768e8a7d9f12` atop rejected head `fa093cd4c1c13f5a48ba3d6b19117c4a133ea89c`, using an explicit lease. Local, remote, and PR heads agree. Exact-head Required [run 29494293255, job 87607484125](https://github.com/limweili/eido/actions/runs/29494293255/job/87607484125) and Browser [run 29494292763, job 87607482392](https://github.com/limweili/eido/actions/runs/29494292763/job/87607482392) completed green, but fresh rereview found the P2 below; no provider rerun is authorized.
- **Durable prevention:** privacy tests for diagnostic schemas must include adversarial module/package names, option names, inline option values, oversized components, aggregate serialized-size bounds, and negative assertions over every secret token—not only one realistic example.
- **Fail-closed status:** `fa093cd` remains rejected, and `7611a45` remains unapproved because fresh review found the P2 below despite green checks. No provider rerun, candidate evidence, merge, Fable 5, or private save data was used.

### 2026-07-16 · total diagnostic bound preserved privacy but discarded all actionable identity

- **Class:** P2 diagnostic sufficiency under privacy bounds.
- **Finding:** at `7611a45ead7d1756ac9d97e7d8f0768e8a7d9f12`, the 1,024-byte serialized-size invariant throws before returning a diagnostic. A Linux-realistic 15-character executable plus 15 allowlisted module-shaped arguments and one overflow argument therefore yields only `Rejected process diagnostic exceeded its serialized privacy bound.` PID, parent PID, executable basename, argv truncation shape, and command digest all disappear.
- **Severity:** privacy and fail-closed execution remain intact and no secret leaks, so rereview classified this P2 rather than P1. However, the generic fallback recreates the original inability to diagnose the provider's rejected owned descendant and cannot be accepted as the durable unblock.
- **TDD remediation:** the RED requires fixed PID/parent PID/executable/digest identity, `<truncated>` as the final argv component, total serialized size at or below 1,024 bytes, and no overflow-secret leakage. The two-file GREEN builds fixed identity/digest first, admits each shaped argv component only while the next component plus reserved `<truncated>` fits, and falls back to fixed identity plus truncation rather than a generic exception. Guard/workflow-policy tests passed 24/24 and the full canonical gate passed 131 files/2,044 tests.
- **Publication boundary:** the fix was committed and pushed clean as `910df90f8ba4d46bb56e28ccc43bfe7ac0e46288` atop `7611a45ead7d1756ac9d97e7d8f0768e8a7d9f12`, using an explicit lease. Local, remote, and PR heads agree. Fresh exact-head Required [run 29494728358, job 87608886378](https://github.com/limweili/eido/actions/runs/29494728358/job/87608886378) and Browser [run 29494728390, job 87608880792](https://github.com/limweili/eido/actions/runs/29494728390/job/87608880792) completed green.
- **Review closure:** fresh read-only Sol review approved `910df90` with no P1/P2. It verified fixed identity/digest survives every fallback; each argument is admitted only after reserving `<truncated>` and proving complete JSON stays within 1,024 bytes; maximum component/count, exact allowlists, and unknown collapsing remain; and long module, Unicode, 10,000-character flag, 100-argument, truncated-tail digest, and leakage cases pass. No workflow, allowlist, product, storage, API, evidence, docs, or package scope widened.
- **Provider transition:** after exact-head review and checks closed green, one deliberate cause-based rerun started as [run 29494885723, job 87609393801](https://github.com/limweili/eido/actions/runs/29494885723/job/87609393801) at exact head `910df90f8ba4d46bb56e28ccc43bfe7ac0e46288`. It failed closed during B; C, publisher, and validated evidence upload were skipped.
- **Diagnostic success, provider red:** the bounded diagnostic retained PID `2896`, parent PID `2895`, executable `npm`, exact command digest `sha256:665ba87265af63888ab63958fe0e0059a3a3d72c199abcedc9c4082e3fe96350`, and argv shape `run dev <flag> npm run dev --host <file:.1> --port <number> --strictPort`. This is actionable evidence of an owned npm dev-server descendant requiring exact wrapper classification; it is not candidate-performance evidence. Diagnostic artifact `8373965138` (`sha256:262a4c7a0fb5a90354baaa26ab198f63ab637567e2886bff1392938d58032d30`) is diagnostics-only and non-evidence.
- **Durable prevention:** diagnostic size caps must degrade incrementally, never atomically replace the complete record with a generic error. Tests must exercise the maximum allowlisted component combination plus overflow, not only one oversized individual argument.
- **Fail-closed status:** `7611a45` retains its P2 history and `910df90` remains approved diagnostics code, but run `29494885723` is red and produced no candidate outcome or validated evidence. No further rerun, merge, Fable 5, or private-data access is authorized until the npm descendant is classified and any bounded remediation re-reviewed.

### 2026-07-16 · actionable run-2 diagnostics exposed a provider npm process-title topology

- **Root cause:** on the isolated GitHub Actions `ubuntu-24.04` runner, GNU `ps -Ao ... comm,args` combined npm 10's `process.title` with the actual argv. The legitimate owned dev-server child therefore appeared as `npm run dev --   npm run dev --host 127.0.0.1 --port 5177 --strictPort`, while the guard assumed `comm` contributed a single token. Existing exact rules covered ordinary npm, node `npm-cli.js`, shell, and Vite descendants but not this duplicated provider title.
- **First narrow fix and review rejection:** head `ca164e555e663508f8898e61a814424c3118533f`, parent `910df90f8ba4d46bb56e28ccc43bfe7ac0e46288`, changed only the guard and its test. Focused coverage passed 25/25, canonical Node 20/npm 10 `ci:required` passed 131 files/2,044 tests, and exact-head Required [run 29495397492, job 87611041524](https://github.com/limweili/eido/actions/runs/29495397492/job/87611041524) plus Browser [run 29495397458, job 87611041401](https://github.com/limweili/eido/actions/runs/29495397458/job/87611041401) were green. Fresh Sol review nevertheless rejected it at P1: its suffix-matched, case-insensitive regex admitted `python npm run dev -- …` and `npm arbitrary-prefix npm run dev -- …`. Green tests and CI did not override the adversarial counterexamples, and no provider run was dispatched from this head.
- **Anchored closure:** head `ba9a0dd91b6e0bcbe6fda1492b12374793a7c85c`, tree `9cfe1ba215a2b5ba355395ad93ef08ca20b6934b`, requires both executable basename `npm` and a case-sensitive complete-command match. Nine near-miss tests cover arbitrary executable/prefix, wrong script/host, missing or non-numeric port, missing `strictPort`, trailing arguments, and case drift. Focused guard/workflow coverage passed 26 top-level/35 including nested; canonical CI tooling passed 52 top-level/61 including nested, build/budget passed, and behavior passed 131 files/2,044 tests. The explicit force-with-lease publish left local, remote, and PR heads equal and the worktree clean.
- **Exact-head proof and provider transition:** fresh Sol review approved `ba9a0dd` with no P1/P2 after an independent matrix of one exact positive and eleven negatives. Required [run 29495763177, job 87612216022](https://github.com/limweili/eido/actions/runs/29495763177/job/87612216022) and Browser [run 29495763242, job 87612216610](https://github.com/limweili/eido/actions/runs/29495763242/job/87612216610) completed green; nightly job `87612217281` was skipped by policy. Only then was run 3 dispatched exactly once as [run 29495901342, job 87612660664](https://github.com/limweili/eido/actions/runs/29495901342/job/87612660664) at exact head `ba9a0dd`.
- **Run-3 failure exposed the real Linux shape:** run 3 failed closed at B with the same command digest as run 2. Linux `comm` truncates the npm process title to 15 characters, producing `npm run dev --h`; `ps comm,args` then serialized the hash-verified command `npm run dev --h npm run dev --host 127.0.0.1 --port 5177 --strictPort`. The prior fixture's untruncated `--` assumption was wrong. Diagnostic artifact `8374375439` (`sha256:eab0c65b6d340ff91838e09472749b48f004ce5d59486cc5c2a4cfebeea87ff1`, 674 bytes) is non-evidence; provider telemetry `sha256:4231c19700ffe5ae299a50af9e8589e7f054c87de1233de3b86a2ab12afac86d` contains no capture windows. C, publisher, and validated evidence upload were skipped. The exact `--h` cause-specific fix is in progress, and the previously assumed `--` topology becomes a negative case.
- **Mac sample boundary:** a read-only sample at about 21:39 AEST found 66 basename-matched Chrome/Chromium/Playwright processes across 14 POSIX process groups, aggregating 77.9% CPU and 20.6% memory; load averages were 5.62/10.18/10.57. One four-process `chromium_headless_shell` group had lived about 5h30m and busy children totaled about 28.1% CPU. This confirms the Mac is unsuitable for defensible timing/fps evidence and supports the remote-only policy; it does not explain the isolated provider topology failure. No process was killed or modified, and no private argv or data was inspected.
- **Spare-machine option:** a quiet gaming PC can be useful as a secondary replication/debugging lane because it avoids the Mac's 14-group Chromium contention. It cannot silently replace the canonical acceptance lane: hardware, OS, browser, and scheduling differences must be recorded, and the architecture decision still requires the isolated same-job provider B/C comparison unless the executable specification is deliberately amended.
- **Durable prevention:** process-tree allowlists must be derived from the provider's exact `comm,args` serialization and tested as complete anchored shapes. Never generalize one observed wrapper into `npm.*`; constrain command, fixed loopback host, numeric port, terminal flag order, parent ownership, and continuous-window monitoring.
- **Fail-closed status:** runs 2 and 3 remain diagnostics-only and `ca164e5` remains rejected. `ba9a0dd` is locally, remotely, CI, and review approved but provider-red; no candidate result, validated artifact, architecture conclusion, merge, or additional rerun may be inferred or authorized before the exact `comm`-truncation fix passes fresh review and gates. No Fable 5 or private-save access was used.

### 2026-07-16 · provider run 4 passed npm topology, then the absolute load ceiling self-blocked owned capture work

- **Topology closure:** head `9004a7c192406fe9ea5b44e7179ccaa33ca0e0e1`, tree `f5369b0edff945ef1f2c7b30e1baecc1c1455443`, replaced the false untruncated wrapper with the exact case-sensitive Linux `comm` shape `npm run dev --h npm run dev --host 127.0.0.1 --port 5177 --strictPort`, still gated by executable basename `npm`. Its test independently hashes that command to `sha256:665ba87265af63888ab63958fe0e0059a3a3d72c199abcedc9c4082e3fe96350`; the prior `--` form and ten required near misses reject. Focused guard coverage passed 26 top-level/36 including subtests; canonical CI tooling passed 52 top-level/62 including subtests, build/bundle passed at 403.4/450 KiB, and behavior passed 131 files/2,044 tests.
- **Publication proof:** the fix was pushed with an explicit force-with-lease against `ba9a0dd`; local, remote, and PR heads agreed and the worktree was clean. Fresh Sol review approved the exact head with no P1/P2 after one positive and twelve independent negatives. Required [run 29496445717, job 87614402245](https://github.com/limweili/eido/actions/runs/29496445717/job/87614402245) and Browser [run 29496445748, job 87614402364](https://github.com/limweili/eido/actions/runs/29496445748/job/87614402364) completed green; nightly job `87614402884` was skipped by policy.
- **Run-4 symptom:** [run 29496611927, job 87614940299](https://github.com/limweili/eido/actions/runs/29496611927/job/87614940299) reached B on a two-core `ubuntu-24.04` runner, proving the npm topology fix. Its clean pre-B sample was acceptable at load1 `1.79 <= 2`, but the guard then applied the same absolute ceiling while its own owned Playwright/Chromium capture tree was running. The one-minute load tail rose above two and the measurement self-blocked before any capture window completed.
- **Diagnostic boundary:** C, publisher, validated evidence upload, and candidate conclusions were skipped. Artifact `8374654554` (`sha256:38a2f9e45fc85ed2d55432fca158cee9e29738bf61a2f873dbe993aa476c6ea2`, 681 bytes) and extracted telemetry `sha256:4d94ce4185e132a0b5801d8ab8986a89995ed3941fa7c409d32d51613ae9f0a2` are diagnostics-only; the telemetry has only the pre-B sample and no capture windows.
- **Cause-specific RED:** the absolute load ceiling belongs at clean runner boundaries, where it detects pre-existing host pressure. During and terminal samples must still record finite load, free memory, and process classification, while the publisher compares complete B/C load distributions and free-memory drift symmetrically and fails closed on dirty boundaries, asymmetric load, memory drift, or foreign process noise. The first owned-high-load monitor test and symmetric-high-load publisher test are RED on `9004a7c`; implementation and mirrored docs are still pending, so run 5 is forbidden.
- **Durable prevention:** a cleanliness threshold must distinguish exogenous pre-capture contamination from load caused by the owned workload being measured. Applying a lagging one-minute absolute host threshold inside a two-core browser workload can guarantee rejection of every valid sample; removing it entirely would also be wrong. Keep boundary, ownership, finiteness, symmetry, distribution-drift, and memory-drift gates explicit and separately tested.
- **Fail-closed status:** run 4 is red, diagnostics-only, and contains no candidate evidence. The load-gate remediation is uncommitted and has no current-head CI, review, provider authorization, or merge authority. No Fable 5 or private-save access was used.

### 2026-07-16 · repeated manual SHA expansion was rejected by three-way identity proof

- **Class:** handoff/lineage bookkeeping.
- **Symptom:** a handoff again supplied an incorrect 40-character expansion for a short commit identifier. Treating that plausible-looking value as authoritative would have attached review and CI evidence to a nonexistent lineage.
- **Unblock:** discarded the expanded value without using it. Local `git rev-parse HEAD`, the exact remote branch ref, and GitHub PR #444's `headRefOid` independently resolved to `fa093cd4c1c13f5a48ba3d6b19117c4a133ea89c`; parent resolution independently returned `bf5d2e7c48de6a98461966da4bd29763abd075dd`. Registry and retro use only those live-derived identities.
- **Durable prevention:** never expand, pad, autocomplete, or reconstruct a short SHA in prose or across compaction. Before every review, check, workflow dispatch, or registry update, require exact equality across local `rev-parse`, remote ref, and PR head; any mismatch or missing source is a hard evidence stop.
- **Fail-closed status:** the error was caught before review acceptance, provider rerun, merge, or evidence publication. No Fable 5 or private data was involved.

### 2026-07-16 · run-4 load remediation separated clean-host admission from owned capture load

- **Class:** provider guard correctness, paired-environment comparability, and local-host capacity.
- **Symptom:** provider run 4 had already proved the exact Linux npm wrapper topology, but the same absolute `load1 <= logicalCores` rule that admitted the clean pre-B runner was reapplied after the owned Playwright/Chromium tree started. On the two-core hosted runner, the benchmark's own work and the one-minute load tail therefore guaranteed a self-rejection before a capture window could complete.
- **Root cause:** the guard conflated two different questions: whether unrelated pressure contaminated the runner before capture, and whether B and C experienced comparable load while the explicitly owned workload was running. A lagging absolute ceiling is appropriate for the first boundary but is not a valid per-sample acceptance rule for the second.
- **Unblock/workaround:** exact pushed head `3f1e14021a51dccc5d7d4aa939fb6af5c645e4ed` keeps the absolute ceiling at the clean before-B admission boundary. During, terminal, and post-owned-capture samples must still be continuous, finite, nonnegative, retained, and free of unowned peers; the mirrored publisher then rejects asymmetric B/C maximum, median, or interquartile-range load drift and free-memory drift. Dirty boundaries and foreign process trees remain hard failures. Guard/workflow coverage passed 27 top-level/37 including subtests; the candidate set passed 180/180; canonical Node 20/npm 10 with one Vitest worker passed CI tooling 53 top-level/63 including subtests, build/bundle 403.4/450 KiB, and 131 files/2,046 behavior tests.
- **Durable prevention:** define host-admission thresholds, continuous ownership supervision, and paired-distribution comparability as separate invariants with separate positive and negative tests. A benchmark must not reject the load it deliberately owns, and it must not remove the clean-boundary ceiling or use symmetry to excuse pre-existing contamination. Keep performance acceptance on the isolated hosted same-job B-to-C lane; the locally saturated Mac remains correctness-only, and no unchanged or blind provider retry is permitted after a red.
- **Fail-closed status:** runs 1 through 4 remain diagnostics-only: run 1 lacked process identity, run 2 exposed the npm wrapper, run 3 exposed Linux `comm` truncation, and run 4 exposed the self-blocking load rule. None produced validated candidate evidence. At this checkpoint, run 5 remains held until fresh exact-head adversarial review and exact-head Required/Browser checks are independently terminal green; no provider result, eligibility decision, merge authority, local performance number, Fable 5 output, or private-save data is accepted from the remediation alone.

### 2026-07-16 · provider run 5 completed both raw captures, then exposed an npm process-title startup race

- **Class:** CI/provider/tooling process-observation correctness.
- **Symptom and evidence:** [run 29497341516, job 87617342003](https://github.com/limweili/eido/actions/runs/29497341516/job/87617342003) at exact head `3f1e14021a51dccc5d7d4aa939fb6af5c645e4ed` completed B and C raw capture, but the C-observation guard failed closed on owned PID `3989`, parent PID `3988`, executable/shape `npm` / `["npm"]`, digest `sha256:272a6929e242450d6e057983bcc67531c604a661e782a9f6f79d40cf49cfbd69`. C observation, publication, and validated evidence did not complete. Diagnostics-only artifact `8375156875` has archive digest `sha256:0bff39d01b3d7d11c55864610fec7f02d4db4471e7cffac3497b52a0867d5a9e`; no evidence was published.
- **Root cause:** a deterministic 0.2-second reproduction confirmed npm changes its process title during startup. The same PID and exact parent can therefore be sampled first as the root launcher and once as the npm-exec form before stabilizing. This was not a zombie, Linux `comm` truncation, an unowned peer, or a leaked process. A pre-rerun audit also found that every otherwise successful window has the legitimate sample-0-to-sample-1 root-launcher-to-npm-exec digest transition that the downstream publisher would otherwise reject.
- **Unblock/workaround:** no blind rerun. Implement a narrow one-sample transition state machine constrained to the same PID and exact parent, mirror it in guard and publisher, add positive and adversarial negative tests, and retain full owned-tree cleanup. Removing the npm wrapper in favor of direct Node is deferred because it widens shared configuration and provenance scope.
- **Durable prevention:** before another provider rerun, replay retained diagnostics through the publisher and audit every pending later-stage validator, not only the stage that just failed. Require fresh exact-head adversarial review plus exact-head CI before dispatch.
- **Fail-closed status:** run 5 remains diagnostics-only despite completing both raw captures; the rejected observation cannot become candidate evidence by implication. No merge, architecture conclusion, Fable 5 output, real-save access, or private data was accepted.

### 2026-07-16 · a #405-owned focused guard test leaked its process group and contaminated a full gate

- **Class:** local CI/tooling/environment capacity contamination.
- **Symptom and evidence:** a host audit found #405-owned process group `95867`, including PIDs `96023` and `96046`, still alive after about one hour and consuming roughly 90% CPU and 15% RAM in aggregate. Exact cwd ownership pointed to `/Users/weili/Documents/Projects/eido-worktrees/epic-410-405`, and the argv identified the focused guard-test command rather than unrelated Chromium. This load materially contaminated a subsequent full local gate even though that gate reported green.
- **Root cause:** an earlier focused guard command returned while its whole process group remained alive; error/final cleanup did not terminate and verify the complete owned tree.
- **Unblock/workaround:** after proving ownership, sent `SIGTERM` to the entire PGID and verified every owned PID was absent. No `SIGKILL` was needed and no unowned Chromium process was touched. The capacity-contaminated green gate was discarded; exactly one quiet replacement full gate runs with `VITEST_MAX_WORKERS=1`.
- **Durable prevention:** every error and `finally` path must terminate and verify the complete owned process tree. Audit host capacity and owned process groups before authoritative local gates, and never kill a process whose ownership is uncertain.
- **Evidence impact:** provider evidence is unchanged and remains fail-closed. The contaminated local green is not accepted as proof; only the quiet replacement rerun may qualify.

### 2026-07-16 · two independent reviews rejected the npm transition state machine despite green exact-head CI

- **Class:** P1/P2 process-ownership, cleanup, telemetry, and evidence-claim safety.
- **Exact-head boundary:** head `98ba0c8cbe0585957de396d230f20907c9e42121` had green Required [run 29500072623, job 87626505729](https://github.com/limweili/eido/actions/runs/29500072623/job/87626505729) and Browser [run 29500072625, job 87626505791](https://github.com/limweili/eido/actions/runs/29500072625/job/87626505791), but two fresh independent Sol reviews blocked provider dispatch. Green checks did not override either verdict.
- **Findings:** the state machine accepted `stable -> provisional -> stable` reversion; a reparented matured npm process could fall out of the owned ledger and survive; cleanup relied on a stale PID snapshot, missing late descendants and carrying PID-reuse risk; guard and publisher accepted opaque first-to-stable command digests; and one-second polling could not justify the report's continuous-observation claim.
- **Unblock/workaround:** establish five bounded RED controls for those exact failure modes and abandon the npm transition state machine. The replacement direction is #405-only direct Node Playwright/Vite ownership with a random inherited token; `(pid, starttimeTicks)` identity plus PGID/SID tracking across detach/reparent; revalidated whole-group cleanup; exact normalized-command telemetry mirrored in publisher validation; a quiet drain; and honest sampled accounting that records the measured maximum observation gap. This direction is not yet implemented or approved.
- **Durable prevention:** process-safety review must exercise reparenting, PID reuse, late-child creation, opaque-digest substitution, and state reversion. Evidence contracts must distinguish bounded periodic sampling from event-complete or continuous observation claims.
- **Fail-closed status:** provider dispatch remains held until the completed replacement reaches fresh exact-head independent review and exact-head CI. No candidate evidence, merge authority, Fable 5 output, or real-save access follows from `98ba0c8`.

### 2026-07-16 · #405 process-accounting review and required-run timeout blocked provider evidence

- **Review findings at `7e07ca588cf1dfb8ccab84722dd1b99351ebcdfa`:** global `/proc` environment reads created a privacy exposure, while unreadable candidate environments could make owned processes invisible. Cleanup lacked a cumulative identity ledger; negative-PGID signaling had a TOCTOU risk; cancellation could strand detached children. Candidate Playwright configuration could drift, provider preflight omitted Linux ownership fixtures, and provider/publisher timing mirrors mixed monotonic and wall-clock sources.
- **Required-run evidence:** Required [run 29502886017](https://github.com/limweili/eido/actions/runs/29502886017) timed out at 10m because the Linux reparent test spawned an infinite non-detached child without `unref` and then awaited parent exit forever. The Browser interactions canary remained green; it does not convert the Required timeout into acceptance.
- **Exact authorized unblocks:** two-stage candidate discovery; fatal unresolved environments; a cumulative identity ledger with safe cleanup; Linux `pidfd` per-process signaling; cancellation cleanup; config inheritance; explicit preflight; monotonic-only timing mirror; and a bounded, self-cleaning fixture.
- **Evidence boundary:** provider evidence remains fail-closed and no provider performance dispatch occurred. The saturated Mac is invalid for local timing; canonical GitHub same-job evidence remains isolated. The spare gaming PC is contingency/secondary reproduction only, never a substitute for canonical acceptance.
- **Disclosure:** no real save was accessed.

### 2026-07-17 · #405 exact cgroup containment replaced an apparently-green process fix

- **Independent block and repair:** an early Sol review correctly rejected a focused patch despite green mechanics: root identity/ledger threading, detached unknown-child discovery, hard-coded terminal proof, unreadable-root cleanup, buffer zeroing, sticky mutation invalidation, the `rootPids` typo, and PID-based controller kills remained unsound. The repair seeds an exact root `(pid,starttime)`, threads one shared cumulative immutable ledger, scans raw zeroed tokens, derives terminal residual proof from cleanup, and uses pidfd TERM-to-KILL.
- **Rejected assumption:** inheriting the GitHub job cgroup was too broad: it could expose unrelated environments in the same job. The final workaround creates a dedicated exact run-and-attempt child cgroup, moves the controller before it spawns, uses a controller barrier and cgroup-subtree candidate discovery, proves the boundary with an adversarial unrelated parent-cgroup secret test, asserts detached-child exit, and requires empty-before-`rmdir` teardown.
- **Permission-model correction:** chowning only destination `cgroup.procs` may not meet cgroup-v2 common-ancestor migration permissions. The design switched to narrowly constrained non-interactive `sudo` for the exact `mkdir`, tee-to-`cgroup.procs`, and `rmdir` operations; it never chowns/chmods/ACLs a parent, includes a GitHub-hosted Required capability probe, and always cleans up.
- **Evidence boundary:** local Mac Chromium saturation remains unsuitable for timing, but did not cause the deterministic Linux fixture hang; local work stayed correctness-only and provider performance dispatch remained forbidden. Fable 5 was never used.
- **Status:** implementation loop remains fail-closed pending fresh exact-head review, Required proof, and authorized provider execution.

### 2026-07-17 · correction: Required containment proof is deterministic; privileged capability is manual-only

- **Correction:** the preceding wording that described a GitHub-hosted Required capability probe is stale after adversarial review. The Required gate must remain deterministic and mocked. A real cgroup-v2 plus constrained-sudo capability probe is explicit manual experimental evidence only; it is not a Required-gate prerequisite or provider-performance evidence.
- **Mechanical safeguards:** prove the dedicated run-attempt cgroup empty after preflight, before every controller move, after every cleanup, and immediately before `rmdir`. Retain a sticky cgroup-identity digest in the cumulative process ledger; invalidate evidence on any mutation while continuing to drain owned processes. For a vanished proc-to-ps observation, reread starttime to distinguish normal disappearance from PID reuse, and fail closed when candidate identity cannot be read.
- **Controller and readiness review:** rejected child-exit observations can never prove cleanup. Vite readiness retries only network failures, while the exact PID, starttime, and cgroup identity remain pinned throughout.
- **Evidence boundary:** local Mac Chromium saturation invalidates timing but does not block deterministic correctness. The spare clean machine remains a secondary reproduction lane; canonical evidence follows the documented lane. Final Sol rereview found no surviving P0-P2, and Node 20/npm 10 `ci:required` passed. Neither result claims provider-performance evidence.

### 2026-07-17 · Required reparent-fixture red isolated terminal-task cleanup semantics

- **Exact-head gate:** at head `25926c9a5396255174c5934b20a7ffc226a8ccd9`, Required [run 29507253504, job 87651114646](https://github.com/limweili/eido/actions/runs/29507253504/job/87651114646) failed after 4.735 seconds in Linux test `real Linux reparent fixture retains and unrefs a non-detached child`. Of 75 CI-tool tests, 74 passed. `finally` emergency cleanup masked the primary failure, and exhausted Capture cleanup could not prove a bounded quiet ownership-token drain. The deterministic parser/snapshot/ledger RED test also failed before the focused Node 20 run, which now has 49 passing tests and 4 intentional skips.
- **Separate canary:** Browser [run 29507253489, job 87651114772](https://github.com/limweili/eido/actions/runs/29507253489/job/87651114772) was green in about 1m51. It does not waive the Required red.
- **Confirmed cause and diagnostic limit:** the fixture incorrectly required an orphan PPID of 1, although Actions can use a subreaper. It also discarded proc-stat state, so a terminal `Z`/`X`/`x` task retained until adopter reaping looked live and was repeatedly TERM/KILL-signaled. The failed log cannot establish a running leak: state and residual diagnostics were masked. The immediately preceding pidfd capability check passed.
- **Narrow pending unblock:** retain the latest proc state; during cleanup, treat only an exact live-ledger-pinned `Z`/`X`/`x` identity as non-running; never signal a terminal task; and still require three quiet scans. Keep first-seen terminal, unknown/unreadable, identity/cgroup/command mutation, terminal-to-active transition, and running/stopped survivors red. The reparent fixture now proves original PPID, parent exit, unchanged PID/start identity, and changed PPID through a handshake without requiring PID 1; it omits the inherited broad job cgroup and aggregates primary and cleanup errors.
- **Evidence boundary:** final review is pending. Do not claim full-gate or current-head provider proof. Mac Chromium saturation is irrelevant to this deterministic Linux CI defect, and the spare PC is not needed. No provider-performance dispatch, private save access, Fable 5, or unowned-process kill occurred.

### 2026-07-17 · reparent-fixture repair preserved terminal identity semantics and primary failure

- **Friction and scope:** exact-head Required [run 29507253504, job 87651114646](https://github.com/limweili/eido/actions/runs/29507253504/job/87651114646) failed only the Linux real-reparent fixture; Browser [run 29507253489, job 87651114772](https://github.com/limweili/eido/actions/runs/29507253489/job/87651114772) was green. The causes were the orphan-PPID-1 assumption despite hosted child subreapers, dropped Linux state that made `Z`/`X`/`x` tasks look live, `finally` cleanup masking the primary failure, and a provisional dedicated fixture root without exact cgroup containment.
- **Unblock:** body and emergency cleanup now share a cumulative live-identity ledger. Only a previously-live, identity-exact terminal `Z`/`X`/`x` task is non-running and receives no signal; first-seen, mutated, resurrected, or unreadable identities stay red. Three quiet scans plus an empty cgroup remain required; the fixture uses a PPID-change handshake and establishes an exact provisional cgroup, PGID, and SID before spawn; primary and cleanup failures are preserved together. The red-capable provisional-cgroup test changed from `[72]` before the fix to `[72,73]` after it.
- **Verification and host boundary:** focused Node 20/npm 10 is 56 total, 52 pass, and 4 intended skips; final Sol review is green with no P0-P2 and no Fable 5. The founder observed 36 long-lived Chromium groups, and the loaded Mac produced one unrelated 5s DOM-test timeout during a parallel full gate. We neither inspected nor killed unowned processes, nor treated that local timing as evidence; a serialized deterministic gate then passed 132 files/2,067 tests before the final adjustment. The spare gaming PC remains replication-only, and provider-performance dispatch remains forbidden pending parent authorization. Exact-final full gate and push were pending at this entry.

### 2026-07-17 · #405 final exact-head proof cleared deterministic CI, not provider-performance authorization

- **Final lineage and publication:** final #405 head is `89c6dbc7a55887fa746c6f87adbe716b7b2111db`; exact `origin/main` is `0900476641954c2362bae2290b1ff5ade2386776`. Rebase was a clean no-op with no conflicts, and the pre-existing stash was preserved. An explicit force-with-lease updated remote `25926c9` to `89c6dbc`.
- **Exact-final verification:** serialized local Node 20/npm 10 `npm run ci:required` was green with CI tooling 82 total/78 pass/4 intended skips, build green, bundle 403.4/450 KiB, and behavior 132 files/2,067 tests. Exact-head Required [run 29508977256, job 87657141330](https://github.com/limweili/eido/actions/runs/29508977256/job/87657141330) was green in 2m06s; Browser canary [run 29508976223, job 87657137711](https://github.com/limweili/eido/actions/runs/29508976223/job/87657137711) was green in 1m43s, and nightly was skipped. PR: https://github.com/limweili/eido/pull/444.
- **Boundary:** deterministic CI blockage is cleared. Provider-performance dispatch remains forbidden pending parent authorization, and no candidate performance conclusion follows. No Fable 5, private-save access, spare-PC run, or unowned-process kill occurred.

### 2026-07-17 · #405 pre-launch contract review blocked hidden canonical evidence publication

- **Finding and boundary:** before provider dispatch, Sol found a P1: canonical success publication requires hidden `.evidence-complete.json`, while pinned `actions/upload-artifact` at `043fb46` defaults `include-hidden-files` to false. An apparently green run would upload 7 of 8 files and then fail downstream canonical-publication validation. No provider run occurred.
- **TDD and narrow repair:** the workflow-policy test was RED at 11/12 solely for missing `include-hidden-files`; the fix sets `include-hidden-files: true` only on the validated success upload, bridges it to the publisher `CACHED_PASSIVE_PUBLICATION_FILES` commit-marker allowlist, and asserts failure diagnostics remain publication-free with hidden-file default off.
- **Verification and status:** focused Node 20/npm 10 passed 12/12 policy and 200/200 publisher tests. Exact-byte Sol review was green with no P0-P2; same-vendor fallback remained in force and Fable 5 was not used. Full gate, commit/rebase/push, and new exact-head checks were pending; provider dispatch remained forbidden until parent GO.

### 2026-07-17 · #405 hidden-manifest fix closed deterministic launch readiness

- **Final lineage and publication:** hidden-manifest fix head `e893eb2b5c7e55fc8edf831d66799c83b17e79dc`; exact `main` `0900476641954c2362bae2290b1ff5ade2386776`. Rebase was a clean no-op with no conflicts and the pre-existing stash was preserved. Explicit force-with-lease updated `89c6dbc` to `e893eb2`.
- **Exact-head verification:** serialized Node 20/npm 10 `npm run ci:required` was green with 82 CI tools (78 pass/4 intended skips), build, bundle 403.4/450 KiB, and 132 files/2,067 behavior. Required [run 29509893989, job 87660281693](https://github.com/limweili/eido/actions/runs/29509893989/job/87660281693) was green in 2m01; Browser [run 29509893856, job 87660280771](https://github.com/limweili/eido/actions/runs/29509893856/job/87660280771) was green in 1m46; nightly was skipped. Workflow branch digest `b41acb9820cc18ca53363ce2ce2640e888fe43b7261a0a509958f7e77fdbea01`; no experimental run was queued or in progress.
- **Boundary:** launch contract is ready, but no provider dispatch occurred and explicit parent GO remains required. No Fable 5, private-save access, spare-PC run, or unowned-process kill occurred.

### 2026-07-17 · exact-head provider capture failed closed on owned-startup churn classification

- **Class:** provider process-observation TOCTOU classification failure.
- **Symptom and evidence:** exact-head provider [run 29510152647, job 87661189483](https://github.com/limweili/eido/actions/runs/29510152647/job/87661189483) at `e893eb2b5c7e55fc8edf831d66799c83b17e79dc` passed capability preflight and clean before-B; Vite became ready, then the first B capture scan failed closed with `Performance telemetry detected a concurrent workload`. C and publication were skipped. Failure artifact `8380277288` (archive `sha256:befa6e876ca245826904d349be94ff1c02f90a5c32b72ff0c7c6a050d5ae9dec`) contains only `artifacts/capture-staging/providerTelemetry.json` (`sha256:d340f6472d8136c05fe00b076d62b54c61b87f29066930372cbecb0e5bbdfb01`): one clean before-B sample and no capture window. Cleanup and exact cgroup removal passed; the old diagnostics cannot identify an exact culprit.
- **Root cause:** owned procfs was read before global PS. A Playwright, Vite, or Chromium process born in that gap could appear in later PS but be absent from the stale owned set and be classified as foreign. Timing and deterministic RED confirm the owned startup-churn TOCTOU category, not a proven leak; no blind retry occurred.
- **Unblock/workaround:** use PS-first exact pinning: immediately pin every matching workload PID, start-time, and cgroup identity, then read token-owned procfs, with complete PS, pin, and procfs work inside the bounded scan. Exact owned matches pass; persistent foreign work, unreadable or vanished pins, PID reuse, and cgroup mismatch remain red.
- **Durable prevention/limitation:** diagnostics are error-only, fixed-field, capped at eight records/2048 bytes, and omit raw argv, environment, paths, tokens, and reader errors. Persisted provider telemetry schema and thresholds are unchanged.
- **Fail-closed status:** this run is classification-only failure evidence, not candidate evidence. No Fable 5, private-save access, spare-PC run, unowned-process signal, provider retry, candidate conclusion, or merge occurred.

### 2026-07-17 · PS-first repair is locally green, reviewed, and still awaiting publication authority

- **TDD and review:** deterministic old-order RED stabilized at 12 pass, 2 intentional fail, 0 cancelled, 1 skip, with a self-cleaning fixture. The focused guard is 15 pass and 1 intentional Linux skip; four-file controls are 53 pass and 4 skips. Fresh gpt-5.6-sol review found one P2 docs-only overclaim that post-PS work was always caught next scan; docs now state next-scan detection only if still present, and that short-lived between-scan work may be missed when `eventComplete` is false. Final Sol verdict has no P0-P2.
- **Verification and host boundary:** exact-final local canonical Node 20.19.4/npm 10.9.2 passed CI tools 79 pass/4 intended skips, workflow policy, build, bundle 403.4/450 KiB gzip, and 132 files/2,067 behavior tests. One pass installed in 11.7s and built in 12.5s; exact-final installed in 43.0s and built in 107.3s. This real host-contention friction keeps the Mac correctness-only and forbids treating local timing as candidate evidence. The spare gaming PC remains optional secondary replication; canonical performance acceptance remains the fresh hosted same-job lane.
- **Fail-closed status:** the fix is reviewed and locally green, but commit, rebase, push, exact-head Required, and Browser remain pending. Provider retry remains forbidden until a new explicit GO; no Fable 5, private-save access, spare-PC run, unowned-process signal, provider retry, candidate conclusion, or merge occurred.

### 2026-07-17 · #405 PS-first closure restored exact-head deterministic readiness

- **Lineage and publication:** current `origin/main` and merge-base are `e6c80e71c8a9a9833f0c7c19897c72fa51899d24` (design-system docs PR #445). The 44-commit #405 rebase was conflict-free; the new-main nine-path set had zero overlap with the #405 patch; complete pre/post stable patch ID is identically `5369ba76b8668eb7148304e5a0f240bffbc465d4`; and all reviewed file bytes stayed unchanged. New #405 head is `8fd1ad6526f0db73ceff67066f3e95b6345b0887`; explicit force-with-lease updated remote `e893eb2b5c7e55fc8edf831d66799c83b17e79dc` to `8fd1ad6`. Local, remote, and PR heads agree; PR #444 is OPEN, CLEAN, and mergeable. Pre-existing stash `26baf66127074b6a9ab68103107a883f3c8a0a6d` stayed untouched.
- **Verification:** post-rebase canonical Node 20.19.4/npm 10.9.2 gate passed: CI tools 79 pass/4 intended skips, workflow policy, build, bundle 403.4/450 KiB gzip, and 132 files/2,067 behavior tests. Exact-head Required [run 29512711371, job 87669916675](https://github.com/limweili/eido/actions/runs/29512711371/job/87669916675) passed in 2m14s; exact-head Browser non-blocking [run 29512711288, job 87669916375](https://github.com/limweili/eido/actions/runs/29512711288/job/87669916375) passed in 1m42s; nightly was skipped. Fresh final gpt-5.6-sol lineage review approved with no P0-P2.
- **CLI friction/unblock:** experimental workflow ID `314357203` is active; branch workflow blob `3989d7b73f81d5d32ed4641de283fdd9d1c0b041` has sha256 `b41acb9820cc18ca53363ce2ce2640e888fe43b7261a0a509958f7e77fdbea01`; zero experimental runs were queued or active. One read-only `gh workflow view` attempt used an unsupported JSON flag; its output was discarded, and `gh api` supplied the exact workflow/run state without mutation.
- **Fail-closed boundary:** provider remains forbidden until a new explicit GO. No provider retry, candidate evidence, merge, Fable 5, private-save access, spare-PC run, or unowned-process signal occurred.

### 2026-07-17 · #405 second provider run exposed a remaining pin-to-proc ownership gap

- **Class and exact boundary:** authorized provider [run 29513404504, job 87672268244](https://github.com/limweili/eido/actions/runs/29513404504/job/87672268244) ran once at exact head `8fd1ad6526f0db73ceff67066f3e95b6345b0887` and failed closed during the first B scan, before any measurement window. C, boundary validation, publisher replay, and canonical success publication were skipped; no retry occurred.
- **Observed evidence:** the guard reported Chrome PIDs `3117` and `3118`, both with parent PID `3115` and start-time tick `33880`, as `not-owned-at-proc-snapshot` with cgroup relation `unknown`. Cleanup then reported sticky ownership-evidence invalidation after drain, although exact cgroup removal passed. Failure artifact `8381620547` has archive digest `sha256:9a271c7985bb83746daaddf8ddad5ef01580acab61b429487b5f670bf4662c00`; its only retained telemetry has sha256 `916f0e5158bf358e9c78e8e36bc5ac78635e2e9c25b91e75cb482d3a5fc6d2f7`, one clean before-B sample at load1 `1.5` on two logical cores, and zero capture windows.
- **Diagnosis limit:** the retained fields cannot distinguish a legitimate owned Chrome helper whose token was unreadable or absent from a later proc snapshot from a helper pinned and then vanished before that snapshot. The identities are therefore not proven foreign. Successful cgroup removal proves eventual drain only; it does not validate the earlier ownership classification or clear the sticky evidence invalidation.
- **Unblock/workaround:** reproduce the exact lifecycle deterministically at the real seam, then require a bounded atomic pin proof before admitting a short-lived helper: exact kernel identity, dedicated cgroup, inherited raw ownership token, and approved command/ancestry must enter the shared immutable ledger together. Any unreadable or vanished pin remains red, and cleanup must recognize only identities established by that proof. Provider execution remains forbidden until the RED is repaired, deterministic gates and fresh adversarial review pass, and a new explicit GO is issued.
- **Fail-closed status:** run `29513404504` is tooling-diagnosis evidence only, not candidate performance evidence. No provider retry, candidate conclusion, merge, Fable 5, private-save access, spare-PC timing claim, or unowned-process signal occurred.

### 2026-07-17 · #405 pin-time proof cleared exact-head deterministic gates; quiet-host evidence remains separate

- **Evidence-language correction:** the preceding entry's “atomic pin proof” wording was too strong. The implementation consistency-brackets several procfs reads by re-reading stat and cgroup around command/environment inspection; it is not one atomic kernel observation. The provider artifact also proved only that two `chrome`-classified rows reported the same parent PID, not that the parent's exact live ledger identity had been established. These wording corrections prevent tooling diagnosis from becoming an ownership claim.
- **Unblock:** PS-first capture now registers a pin in the shared immutable ledger only for an approved command carrying the inherited token, or for a tokenless Chromium/crashpad helper with an exact live, revalidated ledger parent in the same dedicated cgroup. Raw command/environment buffers are zeroed. Arbitrary tokenless roles, unreadability, mutation, PID reuse, missing exact parents, and cgroup drift stay red; a fully registered helper that vanishes before the later ownership snapshot is retained as bounded owned churn. Exact-ledger cleanup and capped fixed-enum diagnostics cover the same identities.
- **Verification and review:** focused Node 20 tests passed 47 total, 43 pass, and 4 intended Linux-only skips. Canonical Node `20.20.2`/npm `10.9.8` `ci:required` passed 94 CI-tool tests (90 pass/4 skips), workflow policy, build, bundle 403.4/450 KiB gzip, and 132 files/2,067 behavior tests. Fresh gpt-5.6-sol review approved the exact diff at `sha256:9304ac972508ecea45b2f73c235e45efaac5ad1c92437fdb3c2a203d558bb5e8` with no P0-P2 after correcting the two evidence overclaims.
- **Lineage and current-head CI:** fix commit `9e0b8632f4ded60b22464bd963932ddc851f69f6` rebased as a no-op onto `origin/main` `e6c80e71c8a9a9833f0c7c19897c72fa51899d24`, preserved stash `26baf66127074b6a9ab68103107a883f3c8a0a6d`, and was published with force-with-lease. Exact-head Required [run 29516521093, job 87682824032](https://github.com/limweili/eido/actions/runs/29516521093/job/87682824032) passed in 1m58s; Browser non-blocking [run 29516521096, job 87682823917](https://github.com/limweili/eido/actions/runs/29516521096/job/87682823917) passed in 2m01s; nightly was skipped by policy.
- **Host-capacity workaround:** the founder reports 36 long-lived Chromium groups on the Mac. That host remains unsuitable for canonical browser-performance timing, but it did not block the serialized deterministic gate or exact-head CI above. Continue code, unit, build, and required-gate work there; reserve the quiet gaming PC for controlled secondary replication with recorded hardware/OS/browser/build identity. Under the current executable specification it does not silently replace the hosted same-job B/C acceptance lane. The separate host also does not replace the pin-time helper proof because a clean Chromium launch still creates short-lived helpers.
- **Fail-closed status:** deterministic CI and review are clear; provider-performance evidence remains absent and no new provider dispatch is authorized. No provider retry, candidate conclusion, merge, Fable 5, private-save access, spare-PC run, or unowned-process signal occurred.

### 2026-07-17 · #405 third provider attempt failed closed before the first B window

- **Exact lineage and run:** the one authorized experimental dispatch ran as [run 29548306867, job 87785268133](https://github.com/limweili/eido/actions/runs/29548306867/job/87785268133) at reviewed head `9943ba06187ffc3d13f8319fc51f64ef043bb539` on base `5f9fe857aa4b176c802ff4e69b7d4352150aec0c`. Attempt 1 used the expected `workflow_dispatch` event and `codex/epic-410-405-cached-passive` ref. Schema/provider preflight and the clean before-B boundary passed; the first B capture then failed closed before any measurement window.
- **Sanitized failure topology:** the bounded log diagnostic reported Chrome identities `(pid=3094, parent=3091, start=10260)`, `(pid=3095, parent=3091, start=10260)`, and `(pid=3111, parent=3094, start=10264)`. Each was absent from the later owned proc snapshot and retained `reason=not-owned-at-proc-snapshot`, `procOutcome=unapproved-command`, `tokenPresent=false`, with cgroup and exact-parent-ledger relations unknown. These fields do not prove foreign work or safe owned churn; they identify the remaining pin/proc classification seam for diagnosis.
- **Fail-closed result:** the guard sent SIGTERM to the direct Playwright capture, C and all later boundaries were skipped, the publisher never ran, and validated evidence upload was skipped. Cleanup completed, the dedicated cgroup was proven empty and removed, and no retry was issued. Failure artifact `8394825867`, `rich-card-cached-passive-failure-diagnostics-9943ba06187ffc3d13f8319fc51f64ef043bb539`, has archive digest `sha256:77ced4ef3b7d5a8e1f69ac2f43041924769ac2330ed786791652de157b65e693`; its only member is `artifacts/capture-staging/providerTelemetry.json` at `sha256:6552b00b0c7f7f856125307a83510bcd801c634268d5688bf39d7d917490ec33`. Telemetry v3 binds the exact head/run/attempt, contains one clean before-B sample and zero capture windows, and is diagnostics-only—not candidate evidence.
- **Diagnostic-retention gap and next action:** the three-record privacy-bounded diagnostic survives in the GitHub job log but is not present in the uploaded failure artifact, which retains only pre-B telemetry. Offline artifact review therefore loses the exact failure record even though execution remains fail-closed. Fresh gpt-5.6-sol diagnosis is underway before any remediation, new head, review, or provider authorization. Durable follow-up is to preserve the already bounded fixed-field error as an explicit diagnostics-only artifact member without admitting it into telemetry or publication.
- **Disclosure:** no Fable 5, private save data, local performance result, spare-machine result, unowned-process signal, provider retry, candidate conclusion, publication, or merge occurred.

### 2026-07-17 · parallel local Required testing produced load timeouts, not deterministic reds

- **Friction and host evidence:** a parallel local `npm run ci:required` reached every preceding CI-tool, policy, build, and bundle stage, then finished behavior tests with 2 failures among 2,069. Both were five-second timeouts in otherwise unrelated suites: `richCardContentVisibilityProbes.test.ts:378` took about 8.1 seconds and `renderIndexCache.test.ts:265` took about 8.7 seconds. Host load averages were `36.53 / 37.56 / 30.53`. Read-only aggregate-name sampling at the failure boundary observed 38 `node`, 33 CUA `node_repl`, 28 codebase-memory, 24 Chrome renderer, 22 Codex renderer, and 8 Playwright headless-shell processes plus helpers. Those are aggregate matches, not ownership claims; no argv/private data was inspected and no process was signalled or killed.
- **Discrimination and unblock:** the two affected files passed 123/123 when rerun together in isolation with serial execution. A complete replacement gate with `VITEST_MAX_WORKERS=1` then passed 100 CI-tool tests with 4 intended skips, build, the 403.4/450 KiB bundle budget, and all 2,069 behavior tests while observed load remained roughly 22–34. This separates host-contention timing from a repeatable product or tooling failure; the parallel red is retained as capacity evidence and is not promoted into a code defect.
- **Operating workaround:** serialize local Vitest for authoritative correctness gates on this saturated Mac, avoid overlapping full gates, and continue treating all local browser timing as non-canonical. The hosted exact-head Required check remains the current-head deterministic authority, while the isolated same-job hosted B→C workflow remains the canonical performance-evidence lane. A quiet secondary PC may reproduce behavior with recorded provenance but does not silently replace that acceptance contract. No unowned process was killed to manufacture capacity.

### 2026-07-17 · two-axis Sol review froze #405 hardening before another provider run

- **Review outcome:** two fresh independent gpt-5.6-sol axes found blockers in the post-run hardening diff, so its locally green mechanics and the preceding diagnostic run do not authorize publication. The findings cover an executable-identity TOCTOU after reading inherited-token environment evidence; an insufficiently constrained Node suffix/topology admission; a privileged process able to escape the dedicated cgroup before the first sample; readiness that a foreign Vite listener could satisfy; a 50 ms cleanup observation that is weaker than the synthetic-save deletion claim; a missing lifecycle diagnostic at the UI evidence seam; a no-clobber check/write race; and checked-in provenance tied to diagnostic run `29548306867` that can drift from the advancing PR head.
- **Unblock underway:** keep the reviewed state frozen and repair each finding at its causal seam: revalidate executable/kernel identity around environment-derived admission, anchor full Node topology, establish containment before workload execution and sample it continuously, bind readiness to the owned Vite lifecycle, await and verify bounded cleanup plus deletion, require lifecycle diagnostics, make no-clobber publication atomic, and separate immutable diagnostic-run provenance from fresh PR-head evidence. The new controls must be mutation-sensitive, synthetic, and re-reviewed on exact bytes after the canonical gate.
- **Fail-closed status:** provider execution remains held while the hardening design is implemented and reviewed. Run `29548306867` remains diagnostics-only, no candidate evidence or architecture conclusion exists, and no retry, merge, Fable 5 use, private-save access, spare-PC timing claim, or unowned-process signal occurred.

### 2026-07-17 · #405 expanded its harness boundary to close four provider-integrity P1 classes

- **Decision:** the two-axis Sol review made four pre-existing provider-integrity threat classes blocking. The orchestrator explicitly expanded #405's synthetic harness scope to close them instead of weakening the threat model, accepting ambiguous ownership, or narrowing evidence claims after the fact.
- **Selected design:** one immutable `CaptureProcessPolicy` must govern admission, supervision, cleanup, and publication with exact JavaScript/executable/cwd topology and post-environment identity rechecks. Workload launch uses `setpriv` with `NoNewPrivs` containment; Vite readiness is nonce-bound to the owned lifecycle; cancellation gives the controller the first two-second grace period before guard-owned synthetic cleanup; and the lifecycle diagnostic is branded and written through an fd-anchored no-replace transaction. These controls retain fail-closed mutation, PID-reuse, ancestry, containment, cleanup, and provenance semantics.
- **Deferred hardening and boundary:** event-complete observation (for example eBPF), a full hostile-repository sandbox, and scan optimization remain explicit follow-ups rather than hidden acceptance claims. This design adds no container requirement and changes no product behavior, renderer/storage semantics, production data, or real save. Provider execution remains held until implementation, mutation-sensitive tests, canonical gates, and fresh exact-byte review all pass; no Fable 5 is permitted.

### 2026-07-17 · #405 hardening exposed five mechanical and cross-platform frictions

- **Focused-test invocation — symptom/unblock/prevention:** `npm exec vitest` stopped with npm `EUSAGE` before exercising the target suite. The implementer invoked the repository's direct `node_modules/.bin/vitest` binary instead. Focused commands should use the installed pinned binary (or an existing package script) so npm argument parsing is not mistaken for a behavioral RED; the canonical gate remains `npm run ci:required`.
- **Formatting/tool discovery — symptom/unblock/prevention:** the repository has neither Prettier nor a format script, so an assumed formatter could not be an acceptance step. No global formatter or new dependency was introduced; validation used `git diff --check`, `node --check`, focused suites, and the canonical gate. Worker preflight should derive available formatting commands from `package.json` and report their absence instead of inventing one.
- **Cross-platform fixture teardown — symptom/unblock/prevention:** Linux fd-anchored temporary cleanup can use `/proc/self/fd`, while the macOS root-swap fixture teardown has no equivalent procfs path and exercised a different cleanup edge. The fixture keeps Linux fd semantics and macOS root-swap teardown explicit and bounded rather than treating one platform's path as portable. Future root-swap fixtures need per-platform `finally` cleanup and a post-test absence check before their result is accepted.
- **Policy self-audit — symptom/unblock/prevention:** legacy readiness expectations and relative child entrypoints survived beside the new exact ownership design, allowing controller and guard policy to drift. Self-audit caught them before publication; readiness and child launch now derive from one frozen controller policy with canonical exact realpaths. Do not retain parallel “expected” policy fields or admit relative entrypoints at the process-evidence boundary.
- **Docs-sync review noise — symptom/unblock/prevention:** the tracked documentation scan surfaced roughly 500 lines of mechanical review noise around a narrow semantic change. The implementer separated the owned claim audit from mechanical churn and did not widen the patch to absorb it. Future docs-sync passes should scope tracked scans to the owned semantic delta, review generated/mechanical output separately, and never let line volume substitute for drift evidence.
- **Evidence boundary:** these workarounds only unblock implementation and review; they do not qualify provider evidence. The provider remains held pending completed hardening, focused and canonical gates, and fresh exact-byte adversarial review. No push, provider retry, real-save access, process signal, Fable 5 use, product/storage change, or architecture conclusion follows from these mechanics.

### 2026-07-17 · ambiguous review hashing made a frozen dirty delta look concurrently unsafe

- **Hiccup and unblock:** a reviewer compared `origin/main...HEAD` and worktree-inclusive hashes, then treated the intentional frozen 14-file dirty delta as possible concurrent editing. The orchestrator confirmed that no editor was active and pinned the review payload to `HEAD` with the single canonical command `git diff --binary HEAD | shasum -a 256`, whose recorded digest begins `529b20ea`. The review could then distinguish the intended uncommitted delta from branch history without weakening any finding.
- **Prevention and evidence boundary:** every dirty-diff review contract must declare its exact base, byte-hash command, expected scope, and editor-quiescence state; reviewers must not silently substitute a merge-base or mixed history/worktree comparison. Evidence and provider execution remained held throughout, and no Fable 5 output was used.

### 2026-07-17 · second frozen review was a non-approval and widened integrity hardening

- **Certification boundary:** the orchestrator intentionally reopened the diff after the review's early findings, so the prior `529b20ea…` exact-diff certification became invalid immediately. That round is blocker discovery, not approval; the completed replacement must receive a fresh canonical hash, full two-axis review, and explicit verdict.
- **Process and containment blockers/unblock:** ownership admission must bind a stable cwd identity and re-read cmdline after environment inspection. The authority scope moves beneath a root-owned directory in sticky `/tmp` so the workload's same UID cannot rename or replace it; temporary artifacts also require inode identity checks. Every PID listed by `cgroup.procs` must be accounted for, with unreadability red, and the admitted process graph must have one unique root, be acyclic, and make every node reachable. The privileged `sudo` capability probe moves before the controller handshake so the measured lifecycle cannot begin under unresolved privilege state.
- **Observation and seam blockers/unblock:** a sanitized top-level catch must retain bounded failure diagnostics without raw secrets; readiness parsing needs a streaming size cap; configuration must be pure rather than performing environment-dependent work at import; global process discovery is limited to `comm`-only PS data; and production/test seams must be strict so injected fixtures cannot weaken production policy. Research language stays conservative, and any retained run provenance must be checked against PR-head drift before publication.
- **Fail-closed status:** these are required design corrections, not implemented evidence. Provider execution, publication, candidate conclusions, and merge authority remain held until the new diff passes mutation-sensitive focused tests, the canonical gate, and fresh exact-byte review. No Fable 5 output, real-save access, product/storage change, or provider retry was accepted.

### 2026-07-17 · detached orchestrator state hid the live DevOps SOP

- **Tooling/state drift:** the parent orchestration checkout lacked `docs/agents/devops-operating-system.md` even though current `origin/main` contained it. A read-only `git fetch` plus `git show origin/main:docs/agents/devops-operating-system.md` restored the authoritative instructions without changing the detached parent checkout or any user work. Durable rule: when an orchestrator checkout is stale or detached, derive the current ref live and read release/DevOps SOP bytes from `origin/main` before acting; local absence is not evidence that the SOP does not exist.

### 2026-07-17 · readiness cap initially bounded characters only after unbounded allocation

- **Test/security-harness flaw:** the first readiness implementation called `response.text()` and checked length afterward, so a malicious or unexpected response could allocate an unbounded body before the nominal cap rejected it. The fix consumes the response through a streaming reader, enforces the byte limit during receipt, and hard-cancels as soon as byte 129 arrives. Focused readiness coverage passed 4/4, including the over-limit path.
- **Fail-closed boundary:** focused green proves the bounded-reader behavior only. Candidate evidence and provider execution remain held until the complete hardening diff passes canonical gates and fresh exact-byte adversarial review; no Fable 5 output was used.

### 2026-07-17 · scheduled Browser canary exposed four independent main-era reds

- **CI/canary signal:** scheduled Browser [run 29520796224](https://github.com/limweili/eido/actions/runs/29520796224) targeted main-era SHA `e6c80e71…` and started before `5f9fe857…` merged. Startup health passed on all four shards and production smoke passed, but the fail-fast full shards stopped on four distinct tests: `highlightConfine` produced an empty selection instead of `charlie`; `doubleClickToReading` stayed at zoom `0.12` instead of reaching at least `0.324`; `modEditor` timed out after 30 seconds waiting for its preview locator; and `askAi` measured a 409 px model/footer gap against a maximum of 16 px.
- **Investigation and boundary:** exact job logs were triaged separately. Exact deduplication found no open duplicate, so non-blocking incident [#529](https://github.com/limweili/eido/issues/529) was filed with `bug` and `needs-triage` labels. It requires one controlled current-main rerun, per-failure classification, and separate follow-up issues only for failures that reproduce; timeout inflation is explicitly forbidden. This scheduled run is outside #405's committed head: it is neither green nor #405 evidence, and it cannot authorize a #405 code change by itself. #405 evidence and provider execution remain held/fail-closed; no Fable 5 output was used.

### 2026-07-17 · #405 replaced a hostile-child sandbox prescription with a written trusted-repository boundary

- **Scope/review friction:** read-only Sol advisory and implementer comparison showed that the proposed root-owned `/tmp` authority scope, root nonce/Vite middleware, and `sudo` filesystem lifecycle defend against malicious same-UID benchmark code—a threat neither #405 nor #410 requires. That route would add roughly 300–500 lines, while a broader simplification can remove or narrow roughly 800–1,200 hardening lines. The orchestrator therefore explicitly superseded the earlier hostile-child P1 prescription rather than allowing an accidental threat-model expansion to become product scope.
- **Selected measurement-integrity contract:** retain a root-owned leaf-domain cgroup, stable complete PID proof, `NoNewPrivs`, one centralized exact role DAG, pidfd/controller-first cleanup, `comm`-only ambient scanning, bounded sanitized diagnostics, pure configuration, and strict production/test APIs. Drop the privileged runtime scope and nonce middleware, and state plainly that the harness does not claim to sandbox malicious child code in a trusted repository.
- **Unblock and evidence boundary:** the unblock is a written threat contract plus a fresh exact-diff adversarial review, not a silent waiver of findings. Evidence and provider execution remain held/fail-closed until the simplified implementation, tests, canonical gates, and new review close; no Fable 5 output, provider retry, push, or product/storage change was accepted from the scope decision.

### 2026-07-17 · external preservation automation violated #405's commit/push and model-routing holds

- **Incident:** at 15:11 AEST, an external preservation process unexpectedly committed and pushed #405's dirty work as `b6173e0` with message `WIP snapshot before machine wipe — uncommitted local changes preserved verbatim`, although the orchestrator and worker had explicitly forbidden commit and push. The snapshot preserved 18 files at `+3777/-891`; no work appears lost, and the subsequent four-file `+202/-19` delta remained uncommitted.
- **Model-routing violation and quarantine:** the preservation commit added an unauthorized `Co-Authored-By: Claude Fable 5` trailer. Neither the worker nor orchestrator invoked Fable 5, and no Fable output, review, or evidence is accepted. Treat `b6173e0` solely as a byte-preservation snapshot: it is not review approval, candidate evidence, a mergeable head, or provider authority.
- **Intermediate CI is invalid:** Required [run 29556679035](https://github.com/limweili/eido/actions/runs/29556679035) failed CI-tool tests on intermediate active-ledger, `RUNNER_TEMP`, and diagnostic expectations. Browser [run 29556679041](https://github.com/limweili/eido/actions/runs/29556679041) was green, but both runs cover an unauthorized intermediate head and are invalid as acceptance signals; red is not waived and green is not promoted.
- **Unblock and durable prevention:** preserve all bytes and continue remediation/review with Sol only. Freeze the complete cumulative diff, obtain fresh exact-diff review and canonical gates, then amend or rewrite `b6173e0` into the approved lineage with a clean message that removes the false Fable trailer and publish only through `--force-with-lease`; rerun exact-head Required and Browser before any provider dispatch. Preservation and external-push automation must honor explicit worktree commit/push holds, never synthesize model attribution, expose every remote mutation immediately, and validate commit trailers plus expected lease before publication. Evidence and provider execution remain held/fail-closed.
- **Non-blocking follow-up:** filed [#530](https://github.com/limweili/eido/issues/530) (`bug`, `ready-for-agent`, `tier:good`). Its acceptance contract requires preservation to honor registry ownership and mutation holds; recover tracked and untracked bytes through a local rescue/stash or separate quarantine ref without moving the active PR; use an exact recorded lease for any authorized remote update; forbid fabricated model/co-author attribution; retain actor/process, before/after, locator, lease, CI-side-effect, and notification audit data; document emergency recovery/quarantine; and prove behavior only in synthetic fixture repositories. It does not block #405 after the quarantined head is cleanly rewritten and every review/check/provider gate is rerun.

### 2026-07-17 · current main advanced without file overlap while #405's coherent tree was still forming

- **Lineage and scope:** live `origin/main` advanced to `3dbe5dfd95230aa2366f3977ee27c03405d68982`; #405 remains on quarantined `b6173e0…` with merge-base `5f9fe857aa4b176c802ff4e69b7d4352150aec0c` and divergence 46 branch commits / 2 main commits. A path comparison found zero overlap between 41 cumulative #405 scope files and 48 files changed on current main. Rebase therefore looks mechanically low-conflict, but it remains deferred until the worker produces one coherent reviewed tree; any semantic, API, product-behavior, or storage-semantics conflict is a stop rather than a guess.
- **Stale coordination checkout:** the parent worktree is intentionally detached at `5b8cb813069d9eeaddbec02abcccbcf934e782f4` and lacks `docs/agents/devops-operating-system.md`, so direct local reads were missing or stale. `git fetch origin` plus `git show origin/main:docs/agents/devops-operating-system.md` supplied the live SOP without mutating the checkout. Durable rule: stale/detached orchestration sessions read current SOP and documentation blobs from live `origin/main`, never infer authority from local absence.
- **Worker checkpoint:** `b6173e0` remains quarantined. The handoff reported five dirty files at `+613/-204`; live re-derivation after continued Sol work found the same five files at `+651/-243` (`sha256:7c70cc778ed48234665536f8e5b1e99deec4c39223886552bb301106e55890bf`). Production/test harness migration is in progress with no active test hang. Before the latest schema edit, ownership was 43 pass / 0 fail / 3 Linux skips, ambient was 2/2, and controller was 13/13; these focused results must be rerun, and the full Required gate is correctly deferred until the schema/tree is coherent.
- **Exact-main and host boundary:** current-main Required [run 29556939581](https://github.com/limweili/eido/actions/runs/29556939581) is green at `3dbe5df…`, with unexpired artifact `8397796561` (`sha256:ccaaced84357fca111f6cab8526237076731c4f2bcca6bd684186476a3818c5e`, 429,606 bytes). A read-only 15:36 AEST host audit found five long-lived browser roots (`5674`, `52206`, `72943`, `85849`, `97137`), several orphaned to PPID 1; PID `85849` belongs to unrelated `/Users/weili/.codex/worktrees/d3a6/eido`, had lived about 23.5 hours, and its renderer/GPU group was using about 20%+ CPU. No unowned process was killed or mutated. This Mac remains invalid for authoritative timing and local browser parallelism: use serialized deterministic Node gates here, isolated hosted same-job B→C for canonical provider evidence, and the spare gaming PC only for secondary replication. Actions budget remains GREEN at $9.04/$50 (conservative 1,507 rounded Linux minutes across 719 runs; billing API unavailable). #405 evidence/provider remain fail-closed, and no Fable 5 output is accepted.

### 2026-07-17 · long-lived Playwright groups received an ownership-scoped lifecycle follow-up

- **Exact read-only snapshot:** at 15:44 AEST, five Playwright browser PGIDs (`5674`, `52206`, `72943`, `85849`, `97137`) still held four processes each after roughly 23.6–25.8 hours, aggregating about 680 MiB RSS. Four leaders had PPID 1; the fifth sat beneath an orphaned Node parent whose PPID was also 1. PGID `85849` consumed about 15.6% CPU at the issue snapshot. Every leader retained unrelated detached Codex cwd `/Users/weili/.codex/worktrees/d3a6/eido`, but command lines no longer identified the owning task or test. No signal or mutation was sent.
- **Dedupe and durable owner:** filed non-blocking [#531](https://github.com/limweili/eido/issues/531) (`bug`, `ready-for-agent`, `tier:good`). #355, #356, #529, #530, and #352 do not own browser process-tree lifecycle, ownership-scoped cleanup, or orphan attribution. Acceptance requires a synthetic red-capable stranded-tree fixture; full owned-tree teardown on success, failure, cancellation, and interruption; bounded attribution and cleanup diagnostics; and proof that user Chrome plus a second concurrent Playwright session survive.
- **Evidence boundary:** local host-contamination preflight remains fail-closed, so this Mac cannot supply authoritative timing or local browser-parallel evidence. Continue serialized deterministic Node correctness here and isolated hosted same-job B→C for canonical performance evidence; the spare gaming PC remains secondary replication only. No Fable 5 output is accepted.

### 2026-07-17 · pinned npm exec rejected the focused Vitest invocation

- **Toolchain friction:** pinned `npx -y -p node@20 -p npm@10 -c 'npm exec -- vitest …'` selected npm 10.9.8 but returned `EUSAGE` before repo-local Vitest ran. `package.json` and its lockfile remained unchanged, so this was not a behavioral RED.
- **Unblock and proof:** direct pinned Node 20 invocation through `npx -y -p node@20 -c 'node node_modules/vitest/vitest.mjs run …'` ran two files and 206 tests green in 5.21 seconds.
- **Boundary and prevention:** this is focused correctness evidence only; evidence remains fail-closed and the canonical gate still awaits an explicit Node 20/npm 10 wrapper. Provide a canonical helper or document pinned local-bin syntax that avoids `npm exec` argument ambiguity while proving both tool versions. No push, provider run, heavy test, save mutation, or Fable 5 use followed.

### 2026-07-17 · canonical gate caller omitted the local worker cap

- **SOP friction and result:** a preliminary pinned gate used Node 20.20.2/npm 10.9.8 and passed 126 CI-tool tests with four intended skips, build, bundle, and 132 files/2,072 fast tests. The caller omitted external `VITEST_MAX_WORKERS=1`, however, so `ci:required` fanned out multiple Vitest forks on the already saturated host.
- **Containment and evidence boundary:** no process was killed and no rerun or concurrent heavy gate was started. This is preliminary correctness green only, not timing evidence or final exact-head proof; the serialized gate remains owed after review and rebase.
- **Durable prevention:** encode the local worker cap in the canonical executable/helper instead of relying on operator memory. Timing remains fail-closed, and no provider, save-data, or Fable 5 evidence is accepted.

### 2026-07-17 · pinned local toolchain friction received durable owner #532

- **Root cause and tracker:** filed non-blocking [#532](https://github.com/limweili/eido/issues/532) (`bug`, `ready-for-agent`, `tier:low`). Outer `npx -p` exports `npm_config_package` and `npm_config_call`; nested `npm exec` consumes those inherited control variables and returns `EUSAGE`. Separately, the local Required path relied on caller memory for `VITEST_MAX_WORKERS=1`.
- **Acceptance contract:** a canonical helper must prove arbitrary repo-local arguments and exit codes survive a polluted subprocess under asserted Node 20/npm 10 pins, never fall back to npm 11, neutralize inherited npm-exec control variables, enforce the single-worker cap internally, preserve `package-lock.json` byte-for-byte, document the command in both release/DevOps guides, and pass focused plus canonical gates on its exact head.
- **Boundary:** #532 owns tooling only and is non-blocking for #405. It makes no performance, product, storage, or real-save claim.

### 2026-07-17 · exact #405 patch passed scope but both independent Sol reviews blocked

- **Review identity and routing:** exact review patch `sha256:896456b91ba4008e962fb2b5b1dd509d3d80162cf80fc09f4594954204187ec8` passed the 41-file scope check. The single permitted Opus 4.8 attempt failed during CLI input parsing, was not retried, and supplied no accepted output; both axes continued as fresh independent Sol fallbacks and each returned `BLOCK`.
- **Blocking set:** P1s: controller readiness emits `argv: []` and rejects the live controller; unreadable, malformed, or over-cap ambient Node is swallowed; raw-command provenance claims legacy `npx` and the wrong config instead of the direct controller; replay trusts a stale but internally consistent directory. P2s: synthetic scope deletion continues after empty-leaf proof failure, and a decoy argv token is falsely classified as the target.
- **Boundary and next action:** product behavior, storage semantics, LOD behavior, and default-off behavior passed review. The worker fix loop is dispatched, but no commit, push, rebase, provider run, or merge authority follows. An inherited-descendant stdout/stderr cap remains a non-blocking loose end pending worker audit and should be filed only if it survives the fix. No Fable 5 output is used or accepted.

### 2026-07-17 · #405 fix loop closed explicit REDs without weakening production fail-closed behavior

- **Checkpoint:** all six exact-review diagnoses were independently confirmed and the worker recorded eight explicit RED→GREEN closures, including cleanup-order and compatibility-wording cases.
- **Fixture discipline:** focused-suite fallout came from synthetic Node rows that no longer met the stricter classifier. The fix made those fake rows explicit; it did not relax unreadable, malformed, or over-cap production handling and did not widen #405.
- **Evidence boundary:** these are focused fix-loop closures only. No commit, push, rebase, provider dispatch, canonical-gate acceptance, product/storage change, save access, process mutation, or Fable 5 evidence follows.

### 2026-07-17 · inherited descendant logs received bounded privacy follow-up #533

- **Source-confirmed gap:** [#533](https://github.com/limweili/eido/issues/533) (`bug`, `ready-for-agent`, `tier:good`) records that `performance-runner-guard.mjs:1482-1487` launches the controller with inherited stdout/stderr, while `cached-passive-capture-controller.mjs:394-397,423-425` does the same for Vite and Playwright. Fixed CLI summaries wrap errors only, and the 2,048-byte cap governs retained ownership-failure JSON rather than direct child streams. No leak was observed; the gap is an unstated and unenforced descendant-log trust boundary.
- **Acceptance and dedupe:** synthetic sentinels must exercise stdout and stderr across both boundaries; the implementation must either prevent token/environment/path/stack/cause escape or strictly allowlist and document trusted entrypoints, while preserving bounded actionable diagnostics and every nonzero child failure. It must use no real saves. #530 covers preservation authority, #531 browser lifecycle, and #532 the pinned executor/worker cap, so none duplicates this privacy contract.
- **Epic boundary:** #533 is non-blocking to #405/#410 and cannot widen measurement thresholds, renderer behavior, storage, or evidence eligibility. The worker continues the existing bounded fix loop; no provider or merge authority follows.

### 2026-07-17 · frozen #405 fix patch cleared both exact-hash Sol reviews

- **Freeze and local proof:** the cumulative patch from base `9943` froze at `sha256:5d44869e9d08dcdaa7e134083acc85d7532ebb9ccd86a232bc5c5ca03155553c`. Its dirty delta was 14 files `+1715/-1014`; cumulative scope was 19 files `+4856/-1269`; diff-check was green. Eight RED→GREEN closures remained explicit. Focused Node 20 MJS tests passed 103 with four hosted-only skips and zero failures; Vitest passed 206/206; TypeScript was green; and the docs scan was regenerated.
- **Exact review result:** the same two independent Sol reviewers rechecked the stable hash. Spec/evidence and standards/security both returned `PASS` with no P0–P2 findings. Exact Opus 4.8 review was not retried after the earlier CLI parser failure, and no output from that failure was accepted. No Fable 5 was invoked or accepted.
- **Bounded authority:** product, storage, and LOD behavior did not drift. #533 and the workflow-policy assertion-subset/smell debt remain non-blocking ledger items. The frozen patch is approved only for delegated amendment that removes the unauthorized Fable trailer from quarantined `b6173e0…`, followed by fetch/rebase onto current main and a final serialized canonical gate plus exact-head CI. Provider dispatch remains held.

### 2026-07-17 · delegated #405 publisher received a hash-locked publication sequence

- **Authorized sequence:** remove the unauthorized Fable trailer by amending quarantined `b6173e0…`; fetch and rebase onto current `origin/main`; stop on any semantic, product, architecture, or storage conflict; prove blob equivalence to reviewed patch `sha256:5d44869e9d08dcdaa7e134083acc85d7532ebb9ccd86a232bc5c5ca03155553c`; run exactly one serialized Node 20/npm 10 `ci:required`; update the PR body; push with the recorded exact `--force-with-lease`; then wait for exact-head Required and Browser and investigate every red canary.
- **Held boundary:** this authorizes publication preflight only. Provider dispatch/evidence and merge remain held, and absent or stale checks are never green. #533 plus workflow-policy assertion-subset/smell debt remain non-blocking. No product, storage, or LOD drift and no Fable 5 output are accepted.

### 2026-07-17 · delegated #405 publication reached exact-head CI without semantic drift

- **Lineage and equivalence:** the reviewed tree was amended cleanly at immutable pre-rebase head `1eaa3d1`, then rebased with zero conflicts onto main/merge-base `3dbe5dfd95230aa2366f3977ee27c03405d68982`, producing `e9fddad1fb6af830c59563dab4a2f96929d69195`. All 41 branch-path blobs, 19 cumulative-remediation blobs, and 14 reviewed manifests were byte-identical; stash `26baf661` was unchanged; commit metadata contained no WIP or Fable trailer.
- **Final local gate:** the serialized pinned Node 20.20.2/npm 10.9.8 `ci:required` was green: CI tooling 129 pass / four Linux skips / zero fail, policy and build green, bundle 403.4/450 KiB, behavior 2,072/2,072, and lockfile unchanged.
- **Publication and tooling kink:** the PR body was updated. The GitHub connector returned 404 for that update, so the publisher used the authenticated `gh` fallback successfully; this was tooling friction with no product/evidence impact. Exact `--force-with-lease` moved `b6173e0…` to `e9fddad…`, and local, remote, and PR heads converged.
- **Nonterminal boundary:** exact-head Required run `29561460850` / job `87824632013` and Browser run `29561460855` / job `87824631949` were in progress; nightly job `87824632590` was policy-skipped. Provider and merge remain held until terminal current-head evidence. No Fable 5 output is accepted.

### 2026-07-17 · exact-head Required exposed a reproducible Linux reparent-fixture red

- **Symptom/category:** PR #444 head `e9fddad…` failed Required run `29561460850` / job `87824632013` because the Linux-only real-reparent fixture reproducibly returned `active-ledger-mismatch`; superseded run `29556679035` showed the same failure class. Browser canary run `29561460855` was green and nightly was policy-skipped, but neither overrides Required. The serialized Mac gate was green only because this Linux fixture is skipped locally.
- **Root-cause status:** preliminary classification is a branch-owned test/fixture stabilization race under the hosted runner's subreaper, not proven production failure. Production active-ledger behavior must remain fail-closed and cannot be relaxed to make the fixture green.
- **Safe unblock in progress:** an independent diagnosis must reproduce the ordering and identify the exact fixture-side stabilization seam before any change. Evidence, provider dispatch, and merge remain fail-closed and held; no speculative retry or policy weakening is accepted.
- **Tooling kink and durable follow-up:** the CI-inspector instructions name `python`, but this host has no `python` command and exposes only `/usr/bin/python3` (Python 3.9.6). Inspection can proceed with `python3`; the durable fix is portable interpreter discovery or documentation that names `python3`. Preserve a Linux subreaper regression around the eventual fixture fix and require fresh exact-head Required proof. The connector PR-body 404 → authenticated `gh` fallback is already logged above and is not duplicated. No Fable 5 output is used or accepted.

### 2026-07-17 · independent diagnosis replaced the subreaper-timing hypothesis with an exact NoNewPrivs cause

- **Completed diagnosis:** the failure is a deterministic fixture/ledger contract mismatch, not hosted reparent timing. In both Required runs, the ordinary Node fixture has `NoNewPrivs=0`, while the reviewed production active ledger intentionally rejects `false`; the identical `active-ledger-mismatch` is therefore expected from those bytes.
- **Correction and rerun policy:** this supersedes the earlier preliminary hosted-subreaper stabilization-race hypothesis. An unchanged rerun is not justified because it would reproduce the same deterministic precondition mismatch without adding evidence.
- **Bounded unblock:** the delegated, still-uncommitted fix may change only the Linux test fixture: launch it through `setpriv --no-new-privs` and assert both parent and child report NNP `true` before reparent and cleanup assertions run. Production fail-closed ledger behavior must remain byte-for-byte unchanged. Fresh focused review and exact-head gates remain required; provider/evidence/merge stay held, and no Fable 5 output is accepted.

### 2026-07-17 · frozen NoNewPrivs fixture patch passed both independent Sol reviews

- **Exact patch and focused proof:** the one-file patch to `scripts/ci/capture-process-ownership.test.mjs` froze at `sha256:d2d98e929d6567a0792eaeb54542b1d98b721ac94aed5f88ba9e6d5266be2133`, 14 insertions / two deletions. Local focused evidence passed 129 tests with four platform skips.
- **Adversarial review:** two fresh independent Sol reviewers evaluated the exact hash. Spec/test and standards/security both returned `PASS` with no P0–P2 findings. Opus was not retried; no Claude or Fable 5 output was used or accepted.
- **Bounded publication authority:** live `origin/main` remains `3dbe5dfd95230aa2366f3977ee27c03405d68982` and the remote branch remains `e9fddad1fb6af830c59563dab4a2f96929d69195`, so the patch is not yet published. The delegated publisher may create the exact commit, run one serialized Node 20/npm 10 gate, push with an explicit exact `--force-with-lease`, and wait for exact-head Required and Browser. Provider/evidence/merge remain held.

### 2026-07-17 · exact NoNewPrivs fixture patch was committed, gated, and published

- **Commit identity:** exact reviewed patch `sha256:d2d98e929d6567a0792eaeb54542b1d98b721ac94aed5f88ba9e6d5266be2133` became commit `6ed37686a5883584a5b1fcb3b2af208341e8241a`, parent `e9fddad1fb6af830c59563dab4a2f96929d69195`, message `Confine Linux reparent fixture (#405)`. It retained the single-path 14-insertion/two-deletion scope and clean metadata with no WIP or Fable attribution.
- **Final local gate:** the serialized Node 20.20.2/npm 10.9.8 `ci:required` was green: CI tools 129 pass/four skips, policy and build green, bundle 403.4/450 KiB, and behavior 2,072/2,072. Lockfile and protected stash remained unchanged.
- **Publication:** the PR body was verified; explicit exact `--force-with-lease` succeeded; local, remote, and PR heads converged at `6ed37686…`.
- **Nonterminal checks:** Required run `29562851466` / job `87828867470` and Browser run `29562851515` / job `87828867681` were in progress; nightly job `87828883415` was policy-skipped. Provider/evidence/merge remain held, and no Fable 5 output is accepted.

### 2026-07-17 · exact-head Linux regression and Browser canary closed green

- **Converged head:** PR #444 plus local and remote branch remain at `6ed37686a5883584a5b1fcb3b2af208341e8241a`, based on `3dbe5dfd95230aa2366f3977ee27c03405d68982`.
- **Hosted proof:** Required run `29562851466` / job `87828867470` passed in 2m07s, including the exact Linux real-reparent regression that previously failed. Browser canary run `29562851515` / job `87828867681` passed in 2m05s; nightly job `87828883415` was policy-skipped. The NoNewPrivs fixture fix therefore closes the reproducible Required red without changing production fail-closed behavior.
- **Fail-closed boundary:** local and hosted evidence are retained with their platform scopes. No provider run has occurred or been accepted, and merge remains held. A fresh independent Sol provider-readiness review is dispatched; no Fable 5 output is used or accepted.

### 2026-07-17 · dual-axis readiness review authorized exactly one provider dispatch

- **Readiness verdict:** two independent Sol axes passed exact head `6ed37686a5883584a5b1fcb3b2af208341e8241a` with no P0–P2 findings. They confirmed a manual-only same-job B→C workflow, exact-leaf ownership plus cgroup/NoNewPrivs fail-closed checks, atomic no-replace publication, caller-authoritative lineage replay, and the exact hidden-file eight-member allowlist.
- **Budget:** conservative re-audit remained GREEN at $9.17/$50 from 1,528 rounded Linux minutes across 727 runs; one worst-case provider execution adds no more than $0.54. Stale run `29548306867` remains failed-closed diagnostics-only and cannot supply evidence.
- **Single-use authority:** exactly one provider dispatch is delegated to a dedicated Sol runner. No run is claimed yet, no unchanged retry or merge is authorized, and fresh independent evidence review is mandatory after terminal live facts arrive. Provider evidence remains absent; no Fable 5 output is used or accepted.

### 2026-07-17 · the single-use provider authority was consumed exactly once

- **Dispatch identity:** after an unchanged final recheck, the dedicated runner started the command at `2026-07-17T07:41:41.372469000Z`; authenticated `gh` returned at `2026-07-17T07:41:43.107898000Z` with [run 29563893959](https://github.com/limweili/eido/actions/runs/29563893959).
- **Live state:** attempts are 1/1 and the run exists in progress. Uniqueness confirmation, terminal conclusion, and artifact inventory/validation remain pending; no second dispatch or retry is permitted.
- **Evidence boundary:** provider evidence remains absent until terminal artifacts validate and a fresh independent evidence review passes. Merge remains held, and no Fable 5 output is used or accepted.

### 2026-07-17 · sole provider attempt failed at the first B-capture boundary

- **Terminal fact:** [run 29563893959](https://github.com/limweili/eido/actions/runs/29563893959) / job `87832086986` completed `FAILURE` at `2026-07-17T07:45:31Z`. Its first and only failing boundary was step 9, `Capture B raw and observation under one owned process tree`.
- **Fail-closed result:** success evidence is absent. C, publication, and success-upload stages authorize nothing; their exact skipped metadata remains pending terminal API collection. The 1/1 attempt is consumed, with no retry or second dispatch permitted.
- **Safe diagnosis boundary:** the runner is collecting only safe API and artifact metadata, not logs or raw diagnostic contents. Diagnosis is pending and merge remains held. No Fable 5 output is used or accepted.

### 2026-07-17 · terminal provider inventory confirmed one unique failed-closed attempt

- **Uniqueness and identity:** the workflow count moved 8→9 with run `29563893959` as the sole delta, run number 9 on exact branch/ref `codex/epic-410-405-cached-passive`, head `6ed37686a5883584a5b1fcb3b2af208341e8241a`, event `workflow_dispatch`, attempt 1. Runner identity was `GitHub Actions` / `1000000959`.
- **Phase inventory:** B capture ran from `07:42:55Z` to `07:45:26Z`; between-boundary, C, after-boundary, publication, and success upload were skipped. No success artifact, replay, or validation directory exists.
- **Diagnostics-only artifact:** the sole artifact is `8400406667`, `rich-card-cached-passive-failure-diagnostics-6ed37686a5883584a5b1fcb3b2af208341e8241a`, 15,048 bytes, `sha256:13610e648477ada6b940fcca8ff5f132c0bf9209c401f32275ce08c0de44329c`, expiring `2026-07-31T07:45:27Z`. The runner did not download or open it.
- **Diagnosis boundary:** a fresh read-only Sol diagnosis is dispatched. The synthetic diagnostics artifact may be inspected only after inventory and private-data checks pass. Evidence remains absent, retry/merge remain unauthorized, and no Fable 5 output is accepted.

### 2026-07-17 · safe diagnostics inspection isolated a two-read guard race

- **Privacy-safe contents:** artifact digest `sha256:13610e648477ada6b940fcca8ff5f132c0bf9209c401f32275ce08c0de44329c` contained exactly three members: `ownershipFailureDiagnostic.json` (697 bytes, `sha256:5433…`), `providerTelemetry.json` (1,229 bytes, `sha256:ee0a…`), and `richCardCachedPassiveControl.raw.json` (158,343 bytes, `sha256:7350…`). No unexpected, save, environment, token, home, or secret path was present. The diagnostic declared `evidence: false`; telemetry contained before-B only and zero windows; success output was absent.
- **99% root cause:** the branch guard has a two-read race. `ps`/pin captured Chrome PID `3170`, start `10180`, PPID `1`; the second full `/proc` proof was missing. `registerPinnedCaptureWorkloads` returns `unresolved` before consulting the existing valid ledger, producing classifier `not-owned-at-proc-snapshot` / `concurrent-workload`.
- **What remained healthy:** all 48 B repetitions and raw outputs completed; browser, cgroup, and capture paths were healthy; public logs remained redacted. Stale run `29548306867` differs because it failed for `unapproved-command`.
- **Candidate contract pending independent confirmation:** only an already-valid exact immutable ledger identity may disappear after pin. First-seen missing, PID reuse, cgroup/token/NoNewPrivs/role mismatch, unreadable, or mutated identity must stay red. Production, product, storage, LOD, privacy, and atomic publication remain unchanged. No retry is authorized; a second independent analysis is pending, and no Fable 5 output is accepted.

### 2026-07-17 · second independent analysis strengthened and approved the guard-race fix contract

- **Independent PASS:** a fresh Sol analysis approved the candidate only with three cumulative proofs: after the full proof is exactly missing, a separate identity read must return `ENOENT`/`ESRCH` (live, reused, unreadable, or any other error stays red); a later owned snapshot must omit the exact PID/start pair; and the prior valid-ledger role must match the workload class. Quiescence or an unregistered disappearance alone is never sufficient.
- **RED and scope contract:** implementation requires at least seven discriminating RED groups across the new proofs and existing identity/cgroup/token/NoNewPrivs fail-closed cases. Owned code is bounded to `scripts/ci/performance-runner-guard.mjs` and its `.test.mjs`; update `research/03-performance-architecture/18-cached-passive-rich-card-candidate.md` only if the exact behavior contract needs synchronization.
- **Delegated fix loop:** difficult Sol work is active and uncommitted from clean head `6ed37686a5883584a5b1fcb3b2af208341e8241a`. Protected stash `26baf66127074b6a9ab68103107a883f3c8a0a6d` is unchanged; remote/provider/retry/merge remain frozen. No Fable 5 output is used or accepted.

### 2026-07-17 · guard-race fix loop established positive RED→GREEN and the unsafe matrix

- **Positive discrimination:** under Node 20, the focused two-scan test failed unchanged production code with `concurrent-workload`; the independent disappearance proof was unreachable. After the bounded change, the positive case passed 1 with 32 skips and observed two missing events plus two `ENOENT` checks across raw and observation paths.
- **Negative-matrix fixture hiccup:** the nominal control initially passed the ownership predicate but failed final telemetry because its helper omitted the required Vite root and reused command token/PID/cgroup identity. The fixture was corrected with a valid Vite sibling plus per-command identities and fresh tokens; this did not weaken production classification.
- **Unsafe closure and boundary:** the control plus 23 negative cases are green (1 selected / 33 skips), and every unsafe case rejects. The patch remains uncommitted and unpushed; scoped suites and the frozen patch hash are pending. Provider/retry/merge remain frozen, and no Fable 5 output is accepted.

### 2026-07-17 · both fresh adversarial reviews blocked frozen guard patch `d64afb0e…`

- **Spec/test BLOCK:** P1 — proven terminal recurrence or PID reuse after an accepted churn event can bypass the guard through a fully proven later scan and cleanup.
- **Standards/security BLOCK:** P1 — a partial missing record can carry approved role/token/command observations and then be overwritten by ledger data. P1 — the terminal-churn schema/classifier admits unresolved, null, or forged status/pin combinations. P2 — Chromium command/parent policy is duplicated and can drift.
- **Stricter RED contract:** delegated remediation must prove canonical pristine missing only; a closed registration+pin+terminal schema; terminal PID recurrence/reuse rejection across every later scan and cleanup; and a bounded shared-policy audit. The patch stays uncommitted. Provider/retry/merge, full gate, and push remain frozen; no Fable 5 output is accepted.

### 2026-07-17 · revised three-path guard patch cleared both fresh re-reviews

- **Frozen scope and proof:** exact patch `sha256:85c93c383284c99e15fdb55f0ae44545088d82e136dc726c9ea255ac52ceb034` spans three paths at `+625/-18`. The full guard suite passed 37 with one hosted-only skip; the four-file set passed 108 with four expected skips.
- **P1 closures:** explicit RED→GREEN coverage closes partial proof, the closed registration+pin+terminal schema, live pin state, same-PID and new-PID recurrence, and cleanup recurrence. Two fresh independent Sol axes both returned `PASS` with zero P0–P2 findings. The local Chromium policy restatement P2 was accepted and documented.
- **Live lineage and authority:** main/base remain `3dbe5dfd95230aa2366f3977ee27c03405d68982`; remote PR #444 remains open at clean head `6ed37686a5883584a5b1fcb3b2af208341e8241a`, with no rebase required. Delegated publication is limited to the exact commit, one serialized gate, and explicit exact `--force-with-lease`. Provider retry/evidence/merge remain held, and no Fable 5 output is accepted.

### 2026-07-17 · revised guard patch was committed, gated once, and published

- **Exact lineage:** reviewed diff `sha256:85c93c383284c99e15fdb55f0ae44545088d82e136dc726c9ea255ac52ceb034` became commit/head `6efe50f5aac3626c64ab5428c3687e9969a38f40`, parent `6ed37686a5883584a5b1fcb3b2af208341e8241a`, retaining exactly three paths with no metadata pollution.
- **Single local gate:** the one authorized serialized Node 20.20.2/npm 10.9.8 `ci:required` was green: CI tools 138 total / 134 pass / four skips, policy and build green, bundle 403.4/450 KiB, and 2,072 fast behavior tests. Lockfile, worktree, and protected stash remained clean/unchanged.
- **Publication and queued checks:** the PR body was updated; explicit exact `--force-with-lease` succeeded; local, remote, and PR heads converged at `6efe50f5…` on base `3dbe5dfd…`. Required run `29569205033` / job `87848755042` and Browser run `29569205075` / job `87848755438` were queued; nightly was policy-skipped. Provider retry/evidence/merge remain held, and no Fable 5 output is accepted.

### 2026-07-17 · exact-head Required and Browser closed green after guard publication

- **Hosted checks:** head `6efe50f5aac3626c64ab5428c3687e9969a38f40` passed Required run `29569205033` / job `87848755042` in 2m03s and Browser run `29569205075` / job `87848755438` in 1m30s. Nightly job `87848756077` was policy-skipped.
- **Next gate:** a fresh Sol provider-retry-readiness review is in progress against the exact green head.
- **Held boundary:** no provider retry, provider evidence acceptance, or merge is authorized yet. No Fable 5 output is used or accepted.

### 2026-07-17 · unauthorized/unattributed external attempt 2 appeared on stale head `6ed37686…`

- **Live correction:** run `29563893959` now has attempt 2 on the old `6ed37686a5883584a5b1fcb3b2af208341e8241a` head, with `run_started` `08:48:02Z`, created `08:48:04Z`, job `87843894968`, and runner `1000000960`. Both `actor` and `triggering_actor` are `limweili`; because that shared account cannot distinguish the user from concurrent agents/sessions, no attribution guess is made.
- **Terminal result:** B failed after 13 seconds. C, publication, and success upload were skipped; cgroup removal and diagnostics upload succeeded. Artifact `8401781908` is diagnostics-only, 1,371 bytes, `sha256:22b52a17f5289ba10392f51bb7755e3798e5f5aa2530d6908ae0a962da78af4c`, expiring July 31.
- **Authority breach and evidence boundary:** the dedicated authorized runner did not issue this retry, and root had explicitly forbidden one. Branch/PR now point to `6efe50f5…`, making attempt 2 stale; it is neither evidence nor validation. State remains fail-closed.
- **Prevention and next gate:** inventory `run_attempt` and `triggering_actor` before and after every dispatch, and classify shared-token concurrent reruns as external mutation. Fresh Sol retry-readiness review now includes this incident; no new dispatch, evidence acceptance, or merge is authorized. No Fable 5 output is used or accepted.

### 2026-07-17 · fresh retry-readiness review authorized one new exact-head dispatch

- **Dual-axis PASS:** fresh independent Sol spec/test and standards/security review returned `PASS` with zero P0–P2 findings at exact head `6efe50f5aac3626c64ab5428c3687e9969a38f40`. No queued, in-progress, or newer workflow run exists for that exact head.
- **Corrected prior-run accounting:** run `29563893959` is one workflow dispatch with two attempts, both on stale head `6ed37686…` and both fail-closed. Attempt 1 was the sole authorized attempt; external/unattributed attempt 2 does not consume or create delegated authority and remains non-evidence.
- **New bounded authority:** exactly one new `workflow_dispatch` at `6efe50f5…` is authorized through the dedicated Sol runner. `gh run rerun` is forbidden. The runner must inventory `run_attempt` and `triggering_actor` immediately before and after dispatch because attempt 2 proved shared-token concurrent mutation is possible; no automatic retry is authorized.
- **Budget and held gates:** budget is green at $9.21 of $50, 1,535 rounded Linux minutes, with a worst-case new run of $0.54. No run ID is claimed until the live dispatch exists. Evidence acceptance and merge remain held, and no Fable 5 output is used or accepted.

### 2026-07-17 · the single authorized exact-head workflow dispatch is live

- **Live command boundary:** after an unchanged final inventory, the dedicated runner started `gh workflow run` at `2026-07-17T09:27:38.804344000Z`; GitHub returned run `29570038936` at [its live URL](https://github.com/limweili/eido/actions/runs/29570038936), and the command ended at `09:27:40.516841000Z`. `gh run rerun` was never used.
- **Authority consumption:** this is the one newly authorized workflow dispatch. No second dispatch is authorized or issued, and no automatic retry is permitted.
- **Proof still pending:** the run is in progress. Immediate proof of uniqueness, `run_attempt`, exact head, and job identity remains pending; none is inferred from the dispatch response. Evidence acceptance and merge remain held. No Fable 5 output is used or accepted.

### 2026-07-17 · sole new exact-head provider run failed closed at B

- **Immediate proof:** inventory contains ten workflow runs total and exactly one on head `6efe50f5aac3626c64ab5428c3687e9969a38f40`: run `29570038936`, attempt 1, job `87851402886`, runner `1000000963`. The old `6ed37686…` run remains at attempt 2; no rerun or second dispatch occurred.
- **Terminal boundary:** the exact-head run completed `FAILURE` at `2026-07-17T09:29:18Z`; B capture was the first and only failing boundary. C, publication, and success authority remain held, and evidence is absent.
- **Diagnosis boundary:** safe terminal/artifact metadata are still pending. The materially shorter timing indicates a new failure shape until diagnosed; no cause is inferred and no retry is authorized. No Fable 5 output is used or accepted.

### 2026-07-17 · exact-head failure metadata classified diagnostics-only output

- **Uniqueness and timing:** provider inventory moved from 9 to 10 with sole new run `29570038936`, run number 10, `workflow_dispatch`, attempt 1, exact head `6efe50f5…`; the old run remains unchanged at attempt 2. B ran from `09:29:00Z` to `09:29:13Z`, and the run failed at `09:29:18Z`.
- **Fail-closed sequence:** between-boundary, C, after-boundary, publication, and success were skipped. Cgroup cleanup and diagnostic upload succeeded. Success, replay, and validation-directory output are absent.
- **Artifact boundary:** artifact `8402710310`, exact name `rich-card-cached-passive-failure-diagnostics-6efe50f5aac3626c64ab5428c3687e9969a38f40`, is diagnostics-only: 5,246 bytes, `sha256:5de8b4ba1601f567d3c1b6e52f0ea2f17df722f6df8bfdfad696459a23c5ca50`, expiring July 31. The runner did not open it.
- **Next gate:** fresh Sol diagnosis is active. No retry, evidence acceptance, or merge is authorized, and no Fable 5 output is used or accepted.

### 2026-07-17 · filed shared-token rerun provenance and authorization follow-up

- **Deduplication:** read-only inventory of open issues #530–#533 and newer found no duplicate. Those issues cover preservation ownership, orphaned Playwright groups, pinned toolchains, and descendant-log privacy; none owns attempt-level provider-rerun authorization, attribution, stale-head evidence exclusion, or all-attempt budget accounting.
- **Connector friction and unblock:** the GitHub connector returned a repository-search 422 and issue-create 404 despite the authenticated CLI having access. The issue was created through the documented `gh` fallback, then read back to verify its complete body, open state, and labels; no source, provider, or PR mutation was involved.
- **Filed loose end:** [#534](https://github.com/limweili/eido/issues/534), “Make provider reruns explicitly authorized, attributable, and stale-head safe,” is open with `bug`, `ready-for-agent`, and `tier:good`. It requires before/after attempt inventory, auditable single-use authorization, pre-cost fail-closed enforcement, stale-head evidence exclusion, privacy-safe session provenance, parallel/rerun tests, Merge Captain reporting, and all-attempt budget accounting. No Fable 5 output is used or accepted.

### 2026-07-17 · exact-head failure requires instrumentation before any behavioral fix

- **Cross-run conclusion:** the new `6efe50f5…` run and stale `6ed37686…` attempt 2 share the same early generic `scan-failed` plus `cleanup-failed` shape, proving the latest guard patch is not the cause. Vite readiness followed by `Channel closed` is secondary; raw output is absent and the cgroup inventory is empty.
- **Leading seam, bounded confidence:** `readLinuxProcessSnapshotInternal` retries membership inequality but throws when a stable member remains unreadable. Confidence is 0.8 because current diagnostics discard the underlying cause; this is a diagnosis target, not yet a proved fix.
- **Mandatory two-stage design:** fresh independent Sol review returned `PASS` for instrumentation-only first. It requires closed `scanOperation` and `causeCode` enums, module-private authenticity, exact fixed fields, and a detailed RED/privacy matrix. Raw secrets, paths, argv, environment, and error objects are forbidden; outcome, timing, and retry behavior must remain unchanged.
- **Delegation and held gates:** difficult Sol implementation is delegated and remains uncommitted. Behavioral remediation cannot begin until the instrumentation identifies the cause. Provider dispatch/retry, evidence acceptance, and merge remain frozen. No Fable 5 output is used or accepted.

### 2026-07-17 · fresh reviews blocked the first instrumentation patch on two P2 gaps

- **Frozen proof:** instrumentation-only patch `sha256:e2546c39ddcdf92522f1edd9fa9ec7b1c4678e80ce7d4130b7912a9ce761f9ed` spans five paths at `+617/-44`; focused verification passed 137 with four expected skips.
- **Spec/test BLOCK:** P2 — the provider-shaped two-by-two `ENOENT` cross-product is incomplete; only the crossed pairs are covered.
- **Security BLOCK:** P2 — command-before/after `ENOENT` and `ESRCH` are mislabeled `command-unreadable` instead of `proc-missing`, while current negative coverage exercises only `EACCES`. All other reviewed specification, privacy, and behavior-neutrality requirements passed.
- **Bounded remediation:** diagnostic-only remediation is delegated. No behavioral fix, provider dispatch/retry, full gate, push, evidence acceptance, or merge is authorized. No Fable 5 output is used or accepted.

### 2026-07-17 · revised instrumentation patch closed both P2s and gained bounded publication authority

- **Revised frozen proof:** patch `sha256:284798695a79b41100f7f69b82a0e0cd1ed1f6435b0a43ccd0c4ac33f28eb2d2` retains the same five paths at `+625/-45`. Focused ownership/guard verification passed 84 with four expected skips; CI-tools passed 137 with four expected skips.
- **P2 closures:** the complete provider-shaped two-by-two matrix is covered, and command-before/after `ENOENT`/`ESRCH` now classify as `proc-missing`. Both fresh Sol re-review axes returned `PASS` with zero P0–P2 findings.
- **Live lineage:** main and base remain `3dbe5dfd95230aa2366f3977ee27c03405d68982`; remote PR #444 remains clean at `6efe50f5aac3626c64ab5428c3687e9969a38f40`, with no rebase required.
- **Publication boundary:** delegated authority is limited to the exact commit, one serialized gate, and an exact lease. Provider dispatch/evidence acceptance and merge remain held. No source, test, push, or provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · instrumentation published and exact-head Required plus Browser passed

- **Exact publication:** reviewed patch `sha256:284798695a79b41100f7f69b82a0e0cd1ed1f6435b0a43ccd0c4ac33f28eb2d2` became commit/head `8b10482bdad223c2953ffcd1835c41c66f2c3682`, parent `6efe50f5aac3626c64ab5428c3687e9969a38f40`. The PR body update and explicit exact-lease push succeeded.
- **Single local gate:** the sole authorized gate was green: CI-tools 137 passed / four skipped, policy, build, and bundle checks green, and 2,072 fast tests passed. Lockfile, worktree, and protected stash remained clean/unchanged.
- **Hosted exact-head checks:** Required run `29573426807` / job `87862305111` passed in 1m36s; Browser run `29573426754` / job `87862305354` passed in 1m52s. Nightly job `87862306022` was policy-skipped.
- **Next authority boundary:** fresh provider-readiness review is active. No provider dispatch, evidence acceptance, or merge is authorized. No source, test, push, or provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · instrumentation provider readiness passed with one diagnostic-only dispatch authorized

- **Fresh review:** Sol spec review returned `PASS` with zero P0–P2 findings. Security review found no hard violation and retained one nonblocking P2 drift smell: the closed enums are duplicated across seams and could diverge.
- **Live pre-dispatch state:** head remains `8b10482bdad223c2953ffcd1835c41c66f2c3682` on main/base `3dbe5dfd95230aa2366f3977ee27c03405d68982`; Required and Browser remain green. The active provider set is empty and no exact-head provider run exists.
- **Budget:** green at $9.25 of $50 across 1,541 rounded Linux minutes and 733 runs; one worst-case new run adds at most $0.54.
- **Bounded authority:** exactly one new `workflow_dispatch` at `8b10482…` is delegated. Its output is mandatory diagnostics-only even if the run succeeds; it cannot become final evidence. Rerun and an automatic second dispatch are forbidden, and no run ID is claimed before a live dispatch exists. No provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · the single diagnostic-only exact-head dispatch is live

- **Final preflight:** exact head `8b10482…`, main `3dbe5df…`, and hosted checks remained green. Provider inventory contained ten terminal runs with attempt vector `[1,2,1,1,1,1,1,1,1,1]`; the active and exact-`8b10482…` sets were empty. Budget remained $9.25.
- **Live dispatch:** the dedicated runner started `gh workflow run` at `2026-07-17T10:35:04.800223Z` and GitHub returned [run `29573953975`](https://github.com/limweili/eido/actions/runs/29573953975) at `10:35:06.460363Z`, when the command also ended. It was a new workflow dispatch, never a rerun; no second dispatch occurred.
- **Pending proof and fixed classification:** post-dispatch uniqueness, attempt number, and terminal identity remain pending. The run is mandatory diagnostics-only even on success and can never become final evidence; merge remains held. No provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · filed diagnostic-enum parity follow-up

- **Deduplication and classification:** no duplicate exists among open #534 or newer. The repository has no maintenance label, so the bounded, mechanically specified drift defect was filed as `bug`, `ready-for-agent`, and `tier:low`.
- **Filed loose end:** [#535](https://github.com/limweili/eido/issues/535), “Prevent producer and sanitizer diagnostic-enum drift,” requires a canonical typed/generated definition or mechanical parity assertion, a one-sided-enum RED, unchanged unknown-value clamping and module-private authenticity, explicit schema/version migration, privacy preservation, and CI/release documentation.
- **Tooling friction and unblock:** connector search again returned 422 and connector creation returned 404 for the repository. Authenticated `gh` fallback created the issue, and exact readback verified its complete body, labels, and open state. No source, provider, or PR mutation was involved, and no Fable 5 output was used or accepted.

### 2026-07-17 · diagnostic run failed closed and ruled out the snapshot reader as initiator

- **Exact terminal identity:** sole exact-`8b10482…` run `29573953975`, attempt 1, job `87864029050`, runner `1000000966`, failed at B after about two minutes. Post-run inventory contains 11 run IDs: ten at attempt 1 and one at attempt 2, with no active run. Between-boundary, C, after-boundary, publication, and success output are absent.
- **Validated artifact:** artifact `8404299857` is 60,972 bytes, `sha256:a97aba3de90cd4922f53a67cc5dc179c07eb074790506f56d0a63ea14e9588a5`, expiring July 31; its validation directory is exact. The 1,139-byte ownership diagnostic (`sha256:dc2c…`) has exact schema, cap, lineage, `evidence: false`, role `B-control`, and observation authority.
- **New exclusion:** its authenticated records are scan `not-applicable` / `unclassified` and cleanup `not-applicable` / `cleanup-lifecycle`. No snapshot retry occurred, ruling out the authenticated snapshot reader as the initiating error source.
- **Next gate:** fresh Sol diagnosis is inspecting only the remaining privacy-cleared synthetic members and logs. No retry, evidence acceptance, or merge is authorized. No provider or source action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · second diagnostic moved the leading cause to a late authentic leaf child

- **Successful B raw boundary:** all 48 repetitions completed in 115.1 seconds with 458 samples, a 262 ms maximum gap, and quiet count 3. The failure occurs in the B observation guard teardown timeline, not raw capture; the snapshot reader is disproved as the initiator. Artifact, log, and member digests remain preserved.
- **Leading cause at 0.75:** an authentic leaf child can appear after process-table capture, pinning, and registration, then be rejected by `inspectOwnedProcesses` because it is not graph-registered. This remains a hypothesis until the new fallback instrumentation observes it.
- **Independent design verdict:** fresh Sol returned `PASS` for instrumentation-only and `BLOCK` for direct reconciliation. The contract requires separate closed `guard-*` fallback operations; the existing snapshot operation always wins; a private exact inspection brand/cause `unregistered-owned-identity`; deterministic late-child RED coverage; and a privacy/boundary matrix. Behavior, reads, retry, timing, and ledger semantics must not change.
- **Delegation and frozen gates:** difficult Sol implementation is delegated from clean head `8b10482bdad223c2953ffcd1835c41c66f2c3682`. Provider dispatch, evidence acceptance, and merge remain frozen. No provider or source action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · both reviews blocked the second instrumentation patch on authentic sample validation

- **Frozen proof:** patch `sha256:f5b13d9a32d950231c10676d3e5b50f9a49e8f31f1f4a1a0e665ce4e0db3efe2` spans five files at `+523/-83`. Focused verification passed 86 with four expected skips; CI-tools passed 139 with four expected skips.
- **Shared finding:** `concurrentWorkloadError` is privately branded `not-applicable` before the wrapper, and the wrapper preserves it. The generic matrix therefore misses the authentic real-interference path. Spec/test blocks at P1; security blocks at P2.
- **Otherwise green:** all other behavior-neutrality, privacy, deletion, and provider-shaped paths pass.
- **Bounded remediation:** a focused authentic RED→GREEN is delegated. Provider dispatch, full gate, push, evidence acceptance, and merge remain frozen. No provider or source action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · final second-diagnostic patch passed both re-reviews and gained publication authority

- **Final frozen proof:** patch `sha256:595b3acbf3a5ee203387b3bbb83e2765dd4c92aaf3e553068b754adfec7d51f8` is based on clean head `8b10482bdad223c2953ffcd1835c41c66f2c3682`, spans five files at `+700/-86`, passes focused verification 87 / four skips, and passes CI-tools 140 / four skips.
- **Authentic closure:** the real sample-validation path now has explicit RED→GREEN coverage. Both fresh Sol re-review axes returned `PASS` with zero P0–P2 findings; the prior P1/P2 gap is closed.
- **Live lineage:** main remains `3dbe5dfd95230aa2366f3977ee27c03405d68982`, remote PR #444 remains at `8b10482…`, and no rebase is required.
- **Publication boundary:** delegated authority is limited to the exact commit, one serialized gate, and an exact lease. Provider dispatch, evidence acceptance, and merge remain held. No source, test, push, or provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · second diagnostics published green; connector falsely acknowledged PR-body mutation

- **Exact publication:** reviewed patch `sha256:595b3acbf3a5ee203387b3bbb83e2765dd4c92aaf3e553068b754adfec7d51f8` became commit/head `259e8441dbf23142177bf3e7a4b7caa64e589262`, parent `8b10482bdad223c2953ffcd1835c41c66f2c3682`. The sole local gate was green: CI-tools 140 passed / four skipped, build, policy, and bundle green, and 2,072 fast tests passed. Lockfile, worktree, and stash remained clean/unchanged; exact-lease push succeeded.
- **Hosted exact-head checks:** Required run `29576774345` / job `87872903868` and Browser run `29576774347` / job `87872904016` passed. Nightly job `87872904600` was policy-skipped.
- **Connector false-positive:** the PR-body connector reported success, but immediate live read showed unchanged content and zero of 17 required markers. Authenticated `gh` body-file stdin fallback updated the body; live reread measured 8,324 characters with all 17 markers present.
- **Prevention and next gate:** a mutation acknowledgment is never evidence of mutation; mandatory read-after-write verification now gates every connector write. Fresh provider-readiness review is pending. No provider dispatch, evidence acceptance, or merge is authorized, and no Fable 5 output is used or accepted.

### 2026-07-17 · exact-`259e844…` diagnostic readiness passed and one dispatch was authorized

- **Fresh PASS:** Sol provider-readiness review returned `PASS` with zero P0–P2 findings at exact head `259e8441dbf23142177bf3e7a4b7caa64e589262`. Required and Browser remain green; the active provider set and exact-head run set are empty.
- **Budget:** green at $9.32 of $50 across 1,553 rounded Linux minutes and 737 runs; one worst-case new run adds at most $0.54.
- **Bounded authority:** exactly one new `workflow_dispatch` at `259e844…` is delegated and must remain diagnostics-only even on success. Rerun and a second dispatch are forbidden; evidence acceptance and merge remain held. No run ID is claimed until a live dispatch exists, no provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · the single exact-`259e844…` diagnostic dispatch is live

- **Final preflight:** provider inventory contained 11 terminal run IDs—ten at attempt 1 and one at attempt 2—with no active run and no exact-`259e844…` run.
- **Live dispatch:** the dedicated runner started `gh workflow run` at `2026-07-17T11:37:09.481614Z` and GitHub returned [run `29577441653`](https://github.com/limweili/eido/actions/runs/29577441653) at `11:37:11.061292Z`, when the command also ended. This was exactly one new `workflow_dispatch`, never a rerun; no second dispatch occurred.
- **Pending proof:** post-dispatch uniqueness and terminal identity remain pending. The run is diagnostics-only even on success and cannot become evidence; merge remains held. No provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · exact-`259e844…` run failed before B with no retained artifact

- **Terminal boundary:** run `29577441653`, job `87875042972`, runner `GitHub Actions` / `1000000970`, failed in step 8 before B. The step created its output directory, then invoked `node performance-runner-guard.mjs --phase before-b --output …`; the public failure remained redacted and exited 1. B never started, the empty cgroup was removed, the artifact API returned zero artifacts, and the validation directory is empty.
- **Diagnostic seam:** the ownership-boundary CLI performs collect then append before writing output. The surviving failure classes are process-table read, pinning, concurrency, load, phase, output creation, or rename. Load is the strongest current hypothesis but remains unproved.
- **Classification:** the run is indeterminate and fail-closed. It supports no external-interference or branch-causality claim. Fresh Sol audit of a behavior-neutral standalone CLI failure diagnostic is active; load and ownership policy must never be relaxed.
- **Held gates:** no retry, evidence acceptance, or merge is authorized. No source or provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · standalone boundary-failure diagnostic design approved; ownership-schema reuse blocked

- **Independent verdict:** fresh Sol returned `PASS` for a separate `providerBoundaryFailureDiagnostic` and `BLOCK` for reusing the ownership diagnostic schema.
- **Exact contract:** define a version-1 schema with closed operations and causes at one fixed path; reuse the ownership diagnostic's hardened writer mechanics, not its schema. Add `--diagnostics-output` to all three phase calls, upload staging failures, and exclude the diagnostic on success.
- **RED and safety matrix:** deterministic load failure must produce RED coverage alongside privacy, forgery, symlink, and full operation/cause-matrix tests. Behavior, thresholds, retry, and outcome remain unchanged.
- **Delegation and frozen gates:** difficult Sol implementation is delegated from clean head `259e8441dbf23142177bf3e7a4b7caa64e589262` and remains uncommitted. Provider dispatch, evidence acceptance, and merge remain frozen. No source or provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · both reviews blocked standalone diagnostics on the after-C authentication boundary

- **Frozen proof:** patch `sha256:ef9c3b609833690032baa22f0c2280de6c29753896a315b4ac7e1cb2fc6d837a` spans five files at `+679/-91`; CI-tools passed 146 with four expected skips.
- **Shared finding:** both fresh Sol axes found that the final after-C `validatePerformanceRunnerTelemetry` call remains outside the private authenticated phase wrapper. The original operation can fail, but the writer then rejects the unbranded error and emits no standalone diagnostic. Spec/test blocks at P1; standards/security blocks at P2.
- **Otherwise green:** schema, privacy, hardened-writer behavior, workflow routing, and behavior-neutrality checks pass.
- **Bounded remediation:** a phase-sequence authenticated wrapper plus an after-C RED is delegated. Provider dispatch, the full gate, push, evidence acceptance, and merge remain frozen. No source, test, push, or provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · standalone boundary diagnostics passed final review and gained bounded publication authority

- **Final frozen proof:** patch `sha256:c2f63c4f854d2db2ff091b22a6dc7dfa1dbce7c5e37487314d41bda27e778920` is based on head `259e8441dbf23142177bf3e7a4b7caa64e589262`, spans five files at `+747/-92`, passes focused verification 60 / one expected skip, and passes CI-tools 147 / four expected skips.
- **Finding closure:** the after-C failure path now has explicit RED→GREEN coverage through the authenticated phase-sequence boundary. Both fresh Sol re-review axes returned `PASS` with zero P0–P2 findings.
- **Live lineage:** main remains `3dbe5dfd95230aa2366f3977ee27c03405d68982`, remote PR #444 remains at `259e844…`, and no rebase is required.
- **Publication boundary:** delegated authority is limited to the exact commit, one serialized gate, and an exact lease. The PR body requires live read-after-write verification. Provider dispatch, evidence acceptance, and merge remain held. No source, test, push, or provider action is taken by this metadata task, and no Fable 5 output is used or accepted.

### 2026-07-17 · late Chromium child reproduced and bounded replay contract approved

- **Exact-head gates:** PR #444 head `9c3385c9d8077700b7300047c4b70c676d6793a0` passed Required run `29580691391` / job `87885411708` and Browser run `29580691440` / job `87885411763`.
- **Fail-closed diagnostic:** diagnostic-only provider run `29581246088` / job `87887218741` failed during B raw with authentic private `guard-owned-inspection` / `unregistered-owned-identity`. Artifact `8407115394` has digest `sha256:475386c97949fef1d3426944466bfd91b2831119224274da970f528f4e658ee4`; raw, telemetry, evidence, and publication are absent. No blind retry is authorized.
- **Root cause:** an approved late Chromium child appeared between process-table discovery/registration and exact leaf inspection.
- **Unblock contract:** two independent Sol reviews agreed on exactly one private authenticated Chromium candidate and one complete table→pin→proof/register→leaf replay under the original shared 500 ms clock, with no direct ledger insertion. Invalid, multiple, disappearing, and churn cases remain red. Test-first implementation is active; provider remains held.

### 2026-07-17 · first late-child replay patch widened beyond a genuine late child

- **Review split:** exact diff `5e11abb8` received security/privacy `PASS`, but spec/correctness `BLOCK` at P1.
- **Failure mode:** replay discarded the first attempt's pin, proof, and interference state. An already-visible unresolved workload or separate transient ambient workload could recover or disappear before retry and then be omitted, widening acceptance beyond a genuine late child.
- **Held boundary:** evidence and provider remain held and fail-closed; the patch was neither committed nor exercised in a provider run.
- **Unblock in progress:** add RED cases for the same candidate being visible on the first attempt and for separate transient ambient interference; preserve and classify first-attempt state; require the candidate PID to have been absent before replay; then re-review the exact new diff.

### 2026-07-18 · late-child replay P1 and documentation drift closed

- **RED→GREEN closure:** the prior P1 reproduced red and closed by retaining the complete first-attempt state, making ordinary classifier rejection dominate replay, and requiring the candidate PID to be absent from the first process table and pins.
- **Docs-sync repair:** the mandatory generated scan found replay drift in `docs/codebase/TESTING.md` and `research/03-performance-architecture/18-cached-passive-rich-card-candidate.md`; both were repaired and the final scan regenerated deterministically.
- **Writer collision:** the implementation and docs agents briefly both believed they owned those two docs. Implementation wrote first; the docs agent's `apply_patch` failed cleanly, so no content was overwritten or lost. The unblock was an immediate stop, sole-writer reconciliation, and scan-only rerun.
- **Durable prevention:** name exactly one active writer for every shared file and require explicit acknowledgment before another agent mutates it.
- **Final local proof:** #405 diff `ec4f7c0c150865368ff7201ebff0396a62a702fe336eaef4abfa105c6f84a656` passed `ci:required` under Node 20/npm 10; final spec and security reviews both returned `PASS` with no findings. Provider remains held.

### 2026-07-18 · parallel main advance paused #405 publication

- **Process friction:** main advanced through PR #451 while the publisher was committing the exact reviewed eight-file patch, so publication paused as required.
- **Rebase proof:** the publisher fetched and cleanly rebased 52 commits from base `3dbe…` to `48584…` with zero conflicts. The old and new whole-PR binary diffs were identical, the 52-commit range-diff was exact, and #451's three synthetic-fixture files did not overlap #405.
- **Unblock:** fresh post-rebase spec and security reviews both returned `PASS` with no findings; the pinned gate passed 133 files / 2,085 tests. Explicit `--force-with-lease` from `9c3385…` to `7b584…` succeeded, and PR #444's head/base are exact.
- **Hosted checks:** Required run `29589166611` and Browser run `29589165862` passed; Nightly was policy-skipped.
- **Evidence boundary:** this was process/parallel-main friction, unblocked by pause, re-review, pinned gate, and exact lease. Provider remains held with exact-head run count zero, so evidence stayed fail-closed.

### 2026-07-18 · sole canonical provider run failed closed at clean-start load

- **Readiness drift:** the PR body still required a stale two-stage invocation that conflicted with the canonical zero-input workflow and runbook. Readiness treated the checked-in executable contract as authority and surgically corrected only the PR body; no code or provider mutation occurred during that unblock.
- **Single dispatch:** after green budget and current-head checks, canonical run `29591070173` was dispatched exactly once with no input at exact head `7b58…`.
- **Failure boundary:** guard verification passed, then the run failed before B at `sample-validation` / `clean-start-load-threshold-exceeded`. B, C, and publication were skipped; cleanup and failure upload passed.
- **Diagnostic-only output:** artifact `8411095497`, with digest prefix `sha256:0020e1ca…`, contains the exact sole mode-`0600` `providerBoundaryFailureDiagnostic` with `evidence: false`. Raw output, telemetry, save data, and evidence are absent. Cost was about `$0.012`; active-run count is zero and no retry is authorized.
- **Next gate:** the diagnosis loop is active. Neither the local Mac nor a gaming PC is the canonical cause or acceptance lane.

### 2026-07-18 · diagnosis isolated provider self-load and approved bounded quiescence

- **Exact timing and semantic error:** run `29591070173` evaluated clean-start load 34 ms after a CPU-heavy 205-test Vitest phase. The guard misused the one-minute load average as an instantaneous cleanliness signal, so it measured its own recent work rather than a clean provider baseline.
- **Historical evidence and ranking:** across 14 provider runs, 13 retained two-core load samples have mean `1.337` and range `1.01–1.79`; the latest exact numeric is deliberately omitted. The process scan was clean. Guard self-load is the ranked root cause at 90%.
- **Agent-routing friction:** one Sol history worker hit an agent-capacity error; the bounded history task was routed to Terra and completed without blocking diagnosis. No Fable 5 output was used or accepted.
- **Deterministic discrimination:** a standalone Node 20 loop with synthetic high `2.01` followed by low `1.99` reproduced RED three of three; the one-variable `1.99` control was GREEN. This proves the exact existing threshold transition, not a reason to relax it.
- **Safe unblock design:** only `before-B`, inside the guard, may run a full-transaction quiescence loop. It samples every five seconds against a monotonic 60-second bound, requires two consecutive fully clean transactions, and activates only for the exact private load cause. A version-4 transcript plus publisher validation must prove the sequence while preserving the existing ceiling, B/C drift rules, and version-1 failure diagnostics.
- **Forbidden shortcuts and held boundary:** no blind sleep, blind rerun, threshold relaxation, gaming-PC substitution, or instrumentation-only provider run is permitted. Implementation is active; provider evidence remains absent and fail-closed.

### 2026-07-18 · user feedback exposed duplicated provider validation as the self-load source

- **Exact symptom and cost:** the provider job ran 339 preflight cases immediately before measurement—134 Node CI-tool cases plus 205 Vitest cases. They consumed 19.1 seconds of CPU-heavy work, and the `before-B` guard sampled the one-minute load average only 34 ms after they ended. The resulting `clean-start-load-threshold-exceeded` was therefore a predictable echo of our own validation load, not proof of a dirty benchmark window.
- **Category and root cause:** this was CI/test-process overvalidation. Exact-head Required had already proved the broad suite; the provider job repeated much of that proof in the most load-sensitive place. The user correctly challenged the accumulating test bottleneck, which caused us to measure the validation machinery rather than the candidate.
- **Immediate unblock:** keep the existing threshold and all interference rejection, but allow only the exact private before-B load condition to enter a bounded full-transaction quiescence loop: five-second polls, a 60-second monotonic deadline, and two consecutive clean samples. Unknown, process, browser, ownership, provider, and host failures remain immediate red.
- **Revised proportional plan:** broad correctness belongs in one local `ci:required` pass plus the exact-SHA Required check. The evidence lane reuses that green proof, retains only the three provider-specific NNP, pidfd, and cgroup probes at capture time, then runs one reviewed same-job B→C transaction. Avoid repeated full gates and instrumentation-only provider runs so the workflow cannot manufacture the load it subsequently rejects.
- **Durable prevention and fail-closed status:** every performance workflow review must inventory pre-measurement case count, CPU duration, and the delay to its first cleanliness sample. A broad gate immediately before a load-sensitive boundary requires an explicit justification or relocation. Run `29591070173` remained correctly fail-closed: B/C/publication never ran and no evidence was emitted.

### 2026-07-18 · scheduled main canary repeated all four #529 signatures

- **Exact recurrence:** scheduled [Browser canary run `29600464021`](https://github.com/limweili/eido/actions/runs/29600464021) tested exact main `5e06c7cf538d942b7f7efc01800c6b5863f5e0a5`. Startup health passed in every shard, but nightly 1–4 each stopped at their first failure: Ask AI model/footer gap `409` versus `<=16`; painted GROUP double-click zoom `0.12` versus `>=0.324`; highlight selection empty instead of containing `charlie`; and Mod editor preview timing out at 30 seconds.
- **Classification:** these are the same four signatures already recorded in #529, now a second observation on newer main. Their root causes remain unresolved. The canary is non-blocking for #405, but red remains red and none of this output is #405 benchmark evidence.
- **Unblock and prevention:** a concise exact-run/shard evidence comment was appended to [#529](https://github.com/limweili/eido/issues/529#issuecomment-5010053029) instead of creating duplicate issues. Continue the incident's controlled independent-versus-shard investigation, preserve traces, and split only independently reproducible defects. Main Required and its release artifact remain green, while the canary is reported separately as red.
- **Fail-closed status:** no canary failure was waived, relabeled green, or used to accept provider evidence. #405 execution can continue on its independent gate while #529 owns the unresolved browser risks.

### 2026-07-18 · owner removed machine-quiescence machinery from the blocking path

- **Why and execution amendment:** machine CPU/load and ambient Chromium signals are non-authoritative for #410, and the evidence system had started becoming a second product instead of helping select one bounded architecture. Custom CPU cleanliness, cgroup, pidfd, process-ledger, quiescence, and repeated-provider machinery are removed from the blocking path. The replacement is privacy-safe synthetic evidence across broad structural and behavioral surfaces, proportional tests, and independent Standards + Spec review.
- **Unblock and preservation:** the abandoned quiescence WIP remains recoverable as stash `4d81b0e978beb50a1e4837fdcb9bef694bc51480`; the pre-existing protected stash `26baf66127074b6a9ab68103107a883f3c8a0a6d` remains intact. No product worktree, canonical checkout, branch, or stash was mutated by this alignment task.
- **Measured trim:** the GPT-5.6 Terra inventory identified at least 11,534 PR-added lines and 123 cases removable through whole-file deletion/revert before further workflow, schema, mutation-matrix, and documentation consolidation. Multy/registry guidance is now optional memory, not execution authority.
- **Truth boundary:** evidence remains fail-closed and must preserve Reading → Overview → Map behavior, blank-region prevention, preload/hysteresis/safety-net behavior, first-intent delivery, live-card pinning and full interaction, image residency/paint/cache distinctions, and measured search/copy/accessibility limitations. This changes only the evidence/execution method, not #410's product destination, dependency outcome, or status as sole executable specification; no production renderer migration is authorized.
- **Tracker/tooling friction:** the GitHub connector returned a private-repository 404, so the authenticated `gh` fallback posted the amendment and a live read verified [issue comment `5010122429`](https://github.com/limweili/eido/issues/410#issuecomment-5010122429). No Fable 5 output was used or accepted.
- **Status:** owner amendment recorded and blocking path unwedged; implementation/evidence reslicing remains pending.

### 2026-07-18 · #405 removed the provider harness from the architecture-decision path

- **Symptom:** #405 had accumulated roughly 14,000 lines of benchmark/provider machinery and 205 expanded candidate-evidence cases, while the local CPU/Chromium environment could not make that machinery authoritative for the architecture decision.
- **Root cause:** validation had become a parallel product: field-by-field and provider-process proof was repeatedly expanded to accommodate machine noise instead of asking which evidence could still change the decision.
- **Unblock:** removed the CPU-cleanliness, provider-ownership, quiescence, and repeated-capture systems from the blocking path; consolidated the candidate evidence suite from 205 expanded cases to 23 representative broad tests. One canonical `npm run ci:required` had already passed without claiming local browser, CPU, load, or timing evidence.
- **Lasting scope:** retain synthetic structural and behavioral evidence, shared-component reasoning, targeted tests, and independent review. Browser or timing evidence is optional only when it materially resolves product uncertainty; deleted harness complexity is not a prerequisite for #406.
- **Status:** resolved by deletion and replacement, not further accommodation.

### 2026-07-18 · nested `npx vitest` under Node 20 failed before focused tests ran

- **Symptom:** invoking Vitest through nested `npx` inside the Node 20 wrapper exited with npm `EUSAGE`, so the focused candidate suite did not start.
- **Root cause:** the nested package-runner invocation was incompatible with the pinned wrapper path; it was tooling indirection, not a test or product failure.
- **Unblock:** invoked the already-installed runner directly under Node 20 with `node ./node_modules/vitest/vitest.mjs`.
- **Lasting scope:** after lockfile-preserving install, prefer worktree-local binaries for focused checks. Do not reinterpret package-runner startup failures as behavioral REDs or rebuild the test harness around them.
- **Status:** resolved; direct runner is the reliable focused-test path.

### 2026-07-18 · independent review corrected stale documentation and overclaimed evidence

- **Symptom:** independent Standards and Spec review found a stale generated docs-sync scan, legacy design-token use, and evidence fields that claimed zero blank frames, transient sharpness, and image readiness without observing those properties.
- **Root cause:** mechanical documentation/style drift survived the large trim, while the old evidence schema converted missing instrumentation into affirmative success.
- **Unblock:** regenerated the docs-sync output, began the token remediation tracked in the next entry, and changed frame continuity, transient sharpness, and image readiness to explicit `not-measured` blockers. The candidate retains only the actually observed discrete far-jump lightweight/safety representation checkpoint.
- **Lasting scope:** missing instrumentation must stay missing and decision-blocking; it may never be encoded as zero, ready, or continuously observed. Every meaningful lane boundary still receives separate Standards and Spec review.
- **Status:** evidence-semantics correction implemented; final exact-diff re-review remains part of publication readiness.

### 2026-07-18 · semantic-token remediation referenced variables absent from runtime main

- **Symptom:** the first standards remediation replaced legacy variables with semantic names that were not defined on the live runtime path.
- **Root cause:** the remediation followed documentation naming without verifying token availability against the newly rebased executable tree.
- **Unblock:** safe rebase verification caught the product-risk before commit or publication; a compatibility fallback is being prepared rather than guessing at appearance changes.
- **Lasting scope:** style-policy fixes must verify both documented intent and runtime token definition/fallback behavior on current main. A standards correction cannot silently change Card appearance or resolve to an invalid value.
- **Status:** pending verified compatibility fallback; no unsafe token-only change has been committed.

### 2026-07-18 · PR #541 replaced system-specific delivery ceremony with first-principles responsibility

- **Symptom:** #405's dirty worktree and protected stashes predated PR #541, while old Multy-derived topology, registry ceremony, and per-slice validation patterns had already demonstrated repeated coordination and test friction.
- **Root cause:** delivery guidance encoded one earlier execution environment as authority instead of separating stable responsibilities from replaceable mechanisms.
- **Unblock:** preserved the dirty work and both stashes, then rebased onto current main `af48b520…`. The only conflict was a mechanical union in `docs/agents/release-profile.md`; it was resolved without changing product, architecture, or storage semantics. The lane now inherits system-agnostic Epic Orchestration, Merge Captain, risk-led cross-slice testing, and the new write-goal approach.
- **Lasting scope:** workers still isolate owned changes, reviews remain independent, exact-head CI remains required, and Merge Captain lands serially; agent topology, registries, test matrices, and reporting forms are selected from observed risk rather than treated as immutable process. Multy-derived material is optional reference only.
- **Status:** rebased and adopted; no semantic conflict.

### 2026-07-18 · stale parent checkout did not contain the active DevOps contract

- **Symptom:** the long-lived parent orchestration checkout lacked the newer `docs/agents/devops-operating-system.md`, so reading policy there would have produced an incomplete or obsolete delivery contract.
- **Root cause:** durable orchestration context and current executable-policy checkout had diverged during parallel main development.
- **Unblock:** read release and DevOps guidance from the actively rebased #405 worktree/current main instead of inferring policy from the stale parent checkout.
- **Lasting scope:** policy authority follows verified current main, not the physical checkout that happens to hold orchestration memory. When the two differ, use the current isolated worktree for read-only policy and keep owner work preserved.
- **Status:** resolved; stale policy was not applied.

### 2026-07-18 · model fallback remains independent without Fable 5

- **Symptom:** a new delivery process could otherwise reintroduce a default reviewer route that conflicts with the owner's permanent quota constraint.
- **Root cause:** process and model-routing defaults can outlive the session-specific authorization unless every continuation carries the override.
- **Unblock:** retained the explicit route: Claude Opus 4.8 is the maximum preferred cross-vendor reviewer; when unavailable, use a fresh independent GPT-5.6 Sol or Terra review. Fable 5 output is invalid and cannot satisfy any gate.
- **Lasting scope:** preserve this rule across compaction, worker briefs, reviews, handoffs, and Merge Captain closeout regardless of delivery-skill defaults.
- **Status:** active invariant; no Fable 5 output used or accepted.

### 2026-07-18 · semantic-token compatibility fallback closed the pending appearance risk

- **Outcome:** #405 now uses `var(--e-r-card, var(--radius))` at both radius sites and `var(--e-surface-card, var(--paper))` for the passive Card surface. Because current main does not yet define the semantic variables, the existing `12px` radius and `#fffdf8` surface remain exact; future semantic-token authority can take precedence without another component rewrite.
- **Unblock:** the fallback chain resolves the prior product-risk without weakening the standards direction or guessing at a new appearance. The deterministic docs scan was regenerated for rebased head `c7a2a72…` against `origin/main`; it reports 31 changed files and no deleted harness paths.
- **Lasting scope:** semantic-token migrations must preserve current runtime values whenever the new authority is not yet defined, and generated docs evidence must be regenerated from the exact rebased diff after large deletions.
- **Status:** resolved and ready for final exact-diff review; the earlier pending incident remains preserved above.

### 2026-07-18 · #405 landed from current exact-head proof without another broad gate

- **Symptom:** #405 reached landing after a long, costly validation history; repeating a broad local or provider gate would add load and cost without creating newer evidence.
- **Root cause:** earlier handoffs duplicated proof instead of distinguishing current exact-head evidence from stale or absent signals.
- **Unblock/outcome:** reused the exact-head Required result and Browser canary, then squash-merged [PR #444](https://github.com/limweili/eido/pull/444) as `48bd3caeb098d4c868b5860023d21c7f4d968a4e`. Exact-main [run `29635380813`](https://github.com/limweili/eido/actions/runs/29635380813) completed green with unexpired artifact `eido-main-48bd3caeb098d4c868b5860023d21c7f4d968a4e`; #405 closed, #406 unblocked, and budget remained GREEN at `$10.15` with no repeated broad gate.
- **Lasting lesson:** landing should reuse verified current-head proof, then require one exact-merge main verdict and artifact; rerun broad gates only when state changed or evidence is stale, absent, or red.

### 2026-07-18 · immutable cleanup proofs survived a concurrent stash-ordinal change

- **Symptom:** squash ancestry could not by itself justify deleting the #405 branch, and a concurrent stash mutation changed the safety stash's ordinal during cleanup.
- **Root cause:** worktree paths, branch refs, and `stash@{n}` are mutable names; deleting by ancestry or remembered ordinal can destroy unlanded or unrelated work.
- **Unblock/outcome:** proved the reviewed PR-head tree exactly equalled squash commit `48bd3cae…`, classified every safety-stash path as landed, absent, or explicitly superseded, then removed the owned #405 worktree, local and remote branch, and safety stash. Exact-OID re-resolution avoided the ordinal race, while protected stashes `4d81b0e978beb50a1e4837fdcb9bef694bc51480` and `26baf66127074b6a9ab68103107a883f3c8a0a6d` remained intact.
- **Lasting lesson:** cleanup requires tree equivalence plus unique-content proof, and every stash deletion must resolve the intended immutable OID again immediately before mutation; ordinals are display positions, never identities.

### 2026-07-18 · #406 converged after silent workers and exact-boundary review

- **Symptom:** multiple reassigned Sol workers accepted the architecture-selection lane but spent their turns planning without reaching file tools. A later whole-file edit briefly represented the untracked selection report as deleted before it was restored. One landing handoff also claimed the DevOps SOP was absent, and a budget check initially ran from a stale checkout.
- **Root cause:** session activity was mistaken for output, untracked whole-file ownership was fragile, and mutable checkout facts were trusted from handoffs instead of current main.
- **Unblock:** replaced silent workers, restored the report immediately, and used a bounded writer on the smallest stable document. Independent Standards and Spec review then corrected `L`/`G` conflation, saved-reference authority, source links, the decision matrix, invalidation/release rules, conditional Reading ownership, and #409 wording. Canonical-main reads disproved the missing-SOP claim, and the budget helper was rerun from the current checkout.
- **Outcome:** [PR #546](https://github.com/limweili/eido/pull/546) selected one architecture—buffered/hysteretic rich DOM `P ∪ L`, separate bounded `G`, Board-wide safety `S`, and visibility-aware renditions—and landed as `7f2adfec…`. Exact-head Required run `29636980773` and exact-main run `29637089636` were green; artifact `8427452811` matched the merge SHA.
- **Lasting lesson:** replace no-output execution early, protect the first durable skeleton, and re-read policy/budget/live-state predicates at their authoritative checkout. A handoff can carry pointers, never current truth.

### 2026-07-18 · #407 and #408 advanced in parallel with risk-led proof

- **#407 review catch:** the first ADR reconciliation incorrectly implied selection could advance the previous scene and omitted `liveOwnerIds` from the exact mount-plan seam. Independent Standards and Spec review blocked both claims. The repair preserved source behavior: selection/Live ownership remains downstream of scene derivation, and nonempty `L` recomposes residency even when `G` is empty.
- **#408 startup kink:** its fresh worktree had no `node_modules`, so the first Vitest command failed before any test ran. The worker temporarily linked the canonical checkout's lockfile-matched dependency tree, ran two broad deterministic structural tests green, and made no install or lockfile change. The link disappeared with owned-worktree cleanup.
- **Outcome:** [PR #549](https://github.com/limweili/eido/pull/549) reconciled ADRs/foundation docs as `43bf515b…`; [PR #551](https://github.com/limweili/eido/pull/551) selected **no cold-data payload split** as `b6b16d95…`. The cold-data fixture stayed synthetic and used structural byte/visit/cache proxies rather than CPU, heap, or wall-clock claims.
- **Lasting lesson:** parallel lanes need disjoint decisions as well as files. Setup failures are absent tests, not RED behavior; reuse a proven lock-matched dependency tree rather than installing or expanding validation on a constrained host.

### 2026-07-18 · late Node 22 freshness invalidated lineage, not reviewed meaning

- **Symptom:** the Node 22/npm 10 transition landed on main after #407/#408 content had already been reviewed. The host still exposed ambient Node 24/npm 11, and inherited npm user-agent metadata could make `devEngines` report the ambient toolchain even when an exact older binary path was selected.
- **Root cause:** base/toolchain identity changed independently of the reviewed patches, while process environment metadata outlived the binary selection.
- **Unblock:** rebased onto the Node 22 main commit, proved #407's stable patch ID and #408's five reviewed content hashes were unchanged, and reran only the invalidated canonical gate. Exact cached Node 22.23.1/npm 10.9.8 binaries outside the repository were used with inherited user-agent metadata neutralized; package files and lock bytes remained untouched.
- **Lasting lesson:** an identical patch after a mechanical rebase needs lineage proof plus the gate invalidated by the new base, not another full review. Toolchain proof must cover executable identity and inherited npm metadata.

### 2026-07-18 · delivery roles survived provider and thread-topology friction

- **Symptom:** private-repository GitHub connector reads/writes repeatedly returned 404, and the four-direct-child cap prevented fresh wrappers for every implementation, review, publication, and landing role.
- **Root cause:** provider installation coverage and collaboration capacity are environment properties, not product dependencies. The earlier workflow assumed each responsibility required a new session identity.
- **Unblock:** authenticated `gh` supplied read-after-write proof for tracker/PR mutations. Completed Sol/Terra sessions were reused sequentially with fresh why-led contracts, while independence came from a fresh exact-delta review turn rather than a mandatory topology. A partial Fable 5 review had been invoked before the owner prohibited further use; it was discarded and no Fable output was accepted. After the prohibition, no further Fable review was invoked or accepted, and unavailable Opus capacity fell back to fresh independent Sol/Terra as authorized.
- **Process evaluation:** after PR #541 made responsibilities system-agnostic and #405 removed the evidence product, #406 through #409 landed in one 2h55m train. Risk-led shared proof, exact-head reuse, and early worker replacement materially improved throughput without weakening Standards/Spec review or exact-main verification.
- **Lasting lesson:** preserve role responsibilities, evidence boundaries, and mutation safety; change session topology immediately when it adds delay without independence or confidence.

### 2026-07-18 · #409 needed a skeleton before planning could converge

- **Symptom:** two Sol workers produced extensive plans but no file. The replacement Terra writer first created the smallest report skeleton; one subsequent rewrite appeared transiently as delete/add. Owner comments also required real native dependency relationships, not a prose-only graph.
- **Root cause:** a broad planning prompt rewarded exhaustive precomposition, while the tracker handoff was initially treated as documentation rather than shared product state.
- **Unblock:** switched to skeleton-first drafting, verified the final tree after the delete/add representation, and used independent Standards/Spec findings to tighten slice ownership, gates, rollback, optional cold-data treatment, and the release handoff. Publication created planning-only [#553–#562](https://github.com/limweili/eido/issues/553), verified all internal native blocking edges, made S0–S8 native blockers of [#471](https://github.com/limweili/eido/issues/471), and recorded required/excluded classification on [#448](https://github.com/limweili/eido/issues/448). O1 #562 remained optional because #408 selected no payload split.
- **Outcome:** [PR #564](https://github.com/limweili/eido/pull/564) landed the production sequence as `c5fcf8ac…`. The ten fan-out issues remain open, `needs-triage`, and planning-only with no branch/worktree; no renderer migration or default-on rollout began.
- **Lasting lesson:** for document-heavy convergence, create the authoritative skeleton early, then review the concrete graph. Tracker relationships are executable shared state and require live native proof.

### 2026-07-18 · #407–#409 landing proof and cleanup stayed proportional

- **#407:** reviewed head `b0641a8f…`; exact-head Required `29638520281`; merge `43bf515b…`; exact-main `29638795643`; artifact `8427962192`.
- **#408:** reviewed head `7b688c55…`; exact-head Required `29639375762`; merge `b6b16d95…`; exact-main `29639521371`; artifact `8428183030`.
- **#409:** reviewed head `9ecb5bf0…`; exact-head Required `29641830086`; merge `c5fcf8ac…`; exact-main `29642041618`; artifact `8428920335`.
- **Outcome:** each current-head Required and exact-merge main run was green, each release artifact matched its merge SHA, and the clean canonical checkout advanced through the train. The owned #405–#409 worktrees and local/remote implementation branches were removed only after their dependents and exact-main proof were safe.
- **Lasting lesson:** one current-head gate, one serial merge, and one exact-main release object per meaningful slice were sufficient; repeated local/browser/performance proof would not have changed these documentation/structural decisions.

### 2026-07-18 · final stash audit removed only superseded #405 evidence machinery

- **Audit:** stash `4d81b0e978beb50a1e4837fdcb9bef694bc51480` changed six tracked files solely for load quiescence, cgroup/process-provider guards, telemetry v4, and their tests. Current main deletes both `performance-runner-guard` files and explicitly forbids those mechanics in workflow policy. Stash `26baf66127074b6a9ab68103107a883f3c8a0a6d` contained only two early untracked provider-observation files; current main tracks evolved versions with stronger activation/runtime-owner proof and honest `not-measured` continuity, sharpness, and image-readiness fields.
- **Unblock/outcome:** after proving neither stash held a unique required artifact, cleanup re-read each live stash ref to its immutable OID immediately before dropping it, one at a time. Unrelated stashes `02a26fe5…`, `cc8169f3…`, and `faa4caa9…` were reverified and preserved.
- **Resource truth:** no #405–#409 implementation branch/worktree remains. #553–#562 are tracker plans only. The detached `epic-410-devops-check`, orchestrator checkout, canonical checkout, and live-retro worktree were preserved for explicit closeout ownership. `.multy/registry.json` still describes an obsolete #405 frontier; under the PR #541 process it is a stale optional cache, not execution authority.
- **Lasting lesson:** preserve-first cleanup may delete rejected evidence machinery only after content-level supersession proof. Mutable registries should be archived or reconciled at closeout, never allowed to overrule live Git, GitHub, or landed decisions.

## Closeout synthesis

### Landed result

- Issues #402–#409 and #413 reached their intended merged tracker states with current-head Required proof, exact-main green runs, matching release artifacts, and owned implementation cleanup.
- #406 selected one architecture: buffered/hysteretic rich-DOM residency `P ∪ L`, a separate bounded 0–2 hot projection `G`, the Board-wide lightweight safety representation `S`, and visibility-aware image renditions keyed from authoritative saved references. ADRs 0019, 0020, 0023, and 0024 plus the canvas foundation now agree with it.
- #408 selected no cold-data payload split: source-complete eager `SavedBoard` loading remains authoritative because versions, provenance, execution, search, export, and playback still require it and the selected Reading path received no stable benefit from a lazy seam.
- #409 published the planning-only production graph as #553–#562. S0–S8 #553–#561 are native release blockers of #471; optional O1 #562 records the bounded graph-index opportunity. No production renderer migration, storage migration, or default-on rollout began.

### Adopted delivery rules

- Start from product claims and the cheapest authoritative seam. Reuse shared structural and behavioral proof across slices; add a test only when it discriminates a plausible regression.
- Treat setup, dependency, runner, and environment failures as absent capability until the intended test actually executes. Run the canonical broad gate once on a stable head and reuse exact proof until a relevant change invalidates it.
- Replace no-output workers and overgrown evidence systems early. Independent Standards and Spec review remain required at meaningful stable boundaries; mechanically identical rebases need lineage proof and only the invalidated gate.
- Roles are responsibilities, not a mandatory session topology. Live repository, tracker, and delivery state outrank handoffs, static registries, and Multy-derived ceremony.

### Superseded machinery

The final decision does not depend on CPU/load cleanliness, quiescence loops, cgroups, pidfd/process-ledger ownership, repeated provider certification, or machine-sensitive FPS claims. Those systems were removed from the blocking path when they became more complex than the uncertainty they addressed. Multy and `.multy/registry.json` are retained only as historical coordination provenance, never execution authority.

### Follow-up ownership

- #553–#561 own the release-blocking production implementation and reversible rollout; #562 remains optional. #471 owns packaged Mac/Windows certification and stays blocked by every required renderer slice.
- #440 retains the measured-unresolved Conversation scroll-attribution question from the rejected content-visibility candidate. #529 owns the repeated browser-canary signatures, while #356 remains the known browser-flake owner.
- #461 owns any future authoritative blob-storage migration; it is explicitly not required for the selected runtime rendition architecture.
- These follow-ups do not reopen the rejected #404/#405 renderer alternatives or authorize migration without a separate kickoff.

### Resource disposition

Owned superseded stashes `4d81b0e9…` and `26baf661…` were dropped only after content-level proof that main retained every required artifact. Unrelated stashes `02a26fe5…`, `cc8169f3…`, and `faa4caa9…` remain preserved. The #405–#409 implementation branches and worktrees are gone; the retro branch/worktree, detached `epic-410-devops-check`, and stale optional registry are explicitly handed to final Merge Captain publication and cleanup. The canonical and orchestrator checkouts remain preserved on current main.
