# Live Retro - Codebase Simplification Program

Status: **complete, including the fourth/fifth bounded continuation**. The
original program, second-pass follow-up, and third-pass continuation remain
complete through their close-out syntheses below. A founder-authorized fourth
bounded continuation began from
exact `main` SHA `915b4caf` after refreshing live ownership: 73 open issues and
10 open pull requests form the pre-existing exclusion boundary. Two fourth-pass
candidates qualified, were ticketed, and are now landed. Top-half connection
planning #637 landed through PR #640 as squash `f85765d3` after independent
review reshaped it around the indexed graph seam. Independent lower-half
overlay focusability #638 landed through PR #639 as squash `e829a60e`. Both
review axes, hosted PR proof, exact-main Required gates, and SHA-bound release
artifacts passed for both changes. Rich-Card and cached-passive performance work
remains protected. A final fifth-pass audit then landed lower-half #622 and #642
through PRs #643 and #644; both exact-main gates and artifacts passed. Across
this continuation, four PRs remove a net 47 production lines while centralizing
two live policies and deleting two proven duplicate/dead surfaces. Every other
material finding is routed to an existing owner or rejected below threshold;
no remaining unowned candidate plausibly clears the delivered value/risk bar.
The program's exact implementation tip is `2a8f2f55`; repository `main`
subsequently advanced to `6951a700` through unrelated Agent-command PR
#641. That later work is outside the program statistics and does not alter any
program disposition or exact-main artifact.

## Goal

Make Eido materially simpler through source-grounded, behavior-preserving
refactors while leaving user behavior, core capabilities, saved-data
compatibility, architectural intent, security posture, and external contracts
unchanged.

Review every material code area, but do not touch work already represented by
a pre-existing open epic, open issue, or draft pull request. Record that work
as already owned instead of creating a duplicate. For every newly discovered,
unowned opportunity, create an agent-ready GitHub ticket before implementation,
then manage its isolated implementation, independent review, pull request, and
safe merge without making the founder a technical router.

The program is complete when the strongest safe opportunities are landed;
risk-proportional evidence passes or distinguishes pre-existing debt; tracker,
documentation, and delivery state agree; and the architecture report plus this
retro capture implemented changes, deliberate exclusions, reusable lessons,
and residual risk.

An opportunity is fully explored when the current behavior and architectural
intent are known, live ownership has been checked, the deletion test has been
applied, expected performance/leverage/impact and risk have been assessed, the
cheapest discriminating evidence is identified, and the opportunity has an
explicit disposition: implement, defer, exclude as already owned, or reject as
earned complexity. Exploration does not require a code change when evidence
supports one of the other dispositions.

Rank qualified opportunities by risk-adjusted value: expected product or
runtime performance, leverage across callers and tests, complexity or code
removed, and maintainability locality, weighed against behavior, data,
security, compatibility, fan-out, reversibility, and observability risk. The
top 50% receive the implementation, review, and evidence budget first. Work on
the lower 50% is opportunistic and must never delay a higher-ranked item.

This is not an endless cleanup loop. The job is done when every material area
has been reviewed and every discovered opportunity has a disposition; every
unowned item in the top half is landed or has a concrete evidence-backed reason
it cannot or should not land; no remaining unowned candidate plausibly outranks
the completed top half; and another refactor would add less expected value than
its risk, proof cost, or coordination cost. Lower-half items may remain as
ranked tickets or documented deferrals without blocking completion.

## Live opportunity ledger

| Opportunity | Ownership | Status | Disposition |
| --- | --- | --- | --- |
| 1. Retire the rejected within-Card content-visibility experiment | [#597](https://github.com/limweili/eido/issues/597), [PR #611](https://github.com/limweili/eido/pull/611) | Top half; landed | Squash `c2bf6b40` is on `main` and its tree exactly matches reviewed head `348eaac6`; net -16,557 LOC, 294 focused tests, complete 137-test CI-tool proof, design/type/build/bundle/full-suite comparison, hosted Required/browser gates and both review axes pass; #597 closed automatically. |
| 2. Use the Graph Index at remaining live lookup call sites | [#602](https://github.com/limweili/eido/issues/602), [PR #609](https://github.com/limweili/eido/pull/609) | Top half; landed | Squash `49c91002` is on `main` and its tree exactly matches reviewed head `a5df5951`; focused 27/27 Vitest assertions, 4/4 Playwright journeys, typecheck, hosted Required gate, and hosted browser canary passed; independent Standards and Spec reviews passed and #602 closed automatically. |
| 3. Narrow the Card residency planner to passive membership | [#600](https://github.com/limweili/eido/issues/600), [PR #610](https://github.com/limweili/eido/pull/610) | Top half; landed | Squash `f81f6608` is on `main` and its tree exactly matches reviewed head `186c5489`; net -71 LOC; author/reviewer canvas proof, typecheck, hosted Required gate, and hosted browser canary passed; both review axes passed and #600 closed automatically. |
| 4. Consolidate graph-store Connection replacement commits | [#603](https://github.com/limweili/eido/issues/603), [PR #608](https://github.com/limweili/eido/pull/608) | Top half; landed | Squash `a9387430` is on `main`; net -45 LOC, focused 43/43 and typecheck pass after live-main rebase, independent Standards and Spec reviews passed, hosted Required gate passed, and #603 closed automatically. |
| 5. Shrink `BoardScene` to runtime-consumed values | [#601](https://github.com/limweili/eido/issues/601), [PR #615](https://github.com/limweili/eido/pull/615) | Lower half; landed | Squash `08228a66` is on `main` and its tree exactly matches reviewed head `461e653c`; stable patch ID/range-diff survived #597, #606, and #604 with no conflict; net -200 LOC, 175 focused scene/residency tests, 105 authoritative scene tests, runtime mount proof, typecheck, full-suite baseline comparison, hosted Required/browser gates and both review axes pass; #601 closed automatically. |
| 6. Delete obsolete test-only brain helper surface | [#606](https://github.com/limweili/eido/issues/606), [PR #613](https://github.com/limweili/eido/pull/613) | Lower half; landed | Squash `94cada57` is on `main` and its tree exactly matches reviewed head `9be51627`; net -57 LOC, 72 reviewer-focused tests, typecheck, full-suite baseline comparison, symbol/diff checks, docs-sync, hosted Required gate and both review axes pass; #606 closed automatically. |
| 7. Centralize Output Version mutation traversal | [#604](https://github.com/limweili/eido/issues/604), [PR #614](https://github.com/limweili/eido/pull/614) | Lower half; landed | Squash `cdccc237` is on `main` and its tree exactly matches reviewed head `aed69a6f`; ten compatible traversals now share one private visit-all helper for net -4 LOC; 61 focused tests, typecheck, full-suite baseline comparison, exact rebase identity, hosted Required gate and both review axes pass; #604 closed automatically. |
| 8. Share cloned-Card insertion between duplicate and paste | [#605](https://github.com/limweili/eido/issues/605), [PR #616](https://github.com/limweili/eido/pull/616) | Lower half; landed | Squash `f2a9bad8` is on `main` and its tree exactly matches reviewed head `82ba7e0c`; one narrow post-clone insertion seam removes 19 LOC while preserving caller policy; 42 focused store/undo tests, typecheck, full-suite baseline comparison, hosted Required gate, exact rebase identity and both review axes pass; #605 closed automatically. |
| 9. Delete the orphaned pre-promotion BoardScene snapshot | [#620](https://github.com/limweili/eido/issues/620), [PR #623](https://github.com/limweili/eido/pull/623) | Second pass; landed | Squash `ff8be98a` is on `main`; the sole tracked file under `versions/` was deleted for net -21,742 LOC / -345,341 bytes. The active root BoardScene test and snapshot were unchanged; 105 focused tests, 1,867 full-suite tests, typecheck, both review axes, the hosted PR gate, and exact-main gate passed. |
| 10. Centralize live Output Version selection | [#621](https://github.com/limweili/eido/issues/621), [PR #625](https://github.com/limweili/eido/pull/625) | Second pass; landed | Squash `e9d83d61` is on `main`; six eligible live callers now delegate to one read-only graph helper. Production is +4 net LOC and focused helper proof adds 21 LOC, so the leverage is semantic locality rather than deletion. 194 focused tests, the 1,872-test full suite, typecheck, both review axes, hosted Required/browser gates, and exact-main Required/artifact passed. #255-owned compiler/source-context/run-engine files remain untouched. |
| 11. Share the system media-query store lifecycle | [#622](https://github.com/limweili/eido/issues/622), [PR #643](https://github.com/limweili/eido/pull/643) | Fifth pass; lower half; landed | Squash `b90870fb` is on `main`; one narrow media-query store owns the two proven lazy cache/subscriber lifecycles while theme and motion retain their public names and semantic fallbacks. Production is +36/-54 (net -18), clearing the deletion test; focused tests passed 14/14 with pinned typecheck, uniqueness/diff checks, both independent review axes, and hosted PR Required. Exact-main Required and artifact `eido-main-b90870fbc4fcb8ecc98963eedd07dcd21232a83b` passed, and #622 closed automatically. |
| 12. Deduplicate the original Eido wireframe asset | [#628](https://github.com/limweili/eido/issues/628), [PR #631](https://github.com/limweili/eido/pull/631) | Third pass; top half; landed | Squash `36ef1eaa` is on `main`; the documented `intent/` original is retained and the byte-identical 2,084,960-byte research copy is deleted. Both review axes, canonical hash/link/reference proof, hosted PR Required, exact-main Required, and artifact `eido-main-36ef1eaa055f471197c3851508c30992e0651f12` passed. No runtime code changed; the surrounding historical narrative was preserved while its live link, planned tree, and canonical-location note were corrected. |
| 13. Centralize the Highlight Tag deletion flow | [#629](https://github.com/limweili/eido/issues/629), [PR #633](https://github.com/limweili/eido/pull/633) | Third pass; lower half; landed | Squash `dde7c794` is on `main`; one Highlight-specific hook now hides the shared confirmation and graph mutation while reporting success so tray-close policy stays local. Production is net -5 LOC; 12 focused tests, 1,861 full-suite product tests, typecheck, both review axes, hosted Required and Browser canary, exact-main Required, and artifact `eido-main-dde7c7946e73e491682c40344f1c32f2e8cf2922` passed. Seventeen unchanged Electron path-alias assertions remained red only in the non-canonical temporary worktree harness. |
| 14. Delete the unreachable model-window refresh path | [closed #636](https://github.com/limweili/eido/issues/636), [#466 comment](https://github.com/limweili/eido/issues/466#issuecomment-5014013026) | Fourth pass; already owned; ticket closed; comment only | The 21-line OpenRouter refresh export has zero production, test, dynamic, or historical callers, but #466 owns packaged network egress. Cross-lane review caught the relationship before any edit: #636 was closed, implementation stopped cleanly, and the deletion plus cached-read invariants were routed to the security owner. |
| 15. Centralize connection-admission planning | [#637](https://github.com/limweili/eido/issues/637), [PR #640](https://github.com/limweili/eido/pull/640) | Fourth pass; top half; landed | Squash `f85765d3` is on `main`; one pure graph-layer plan now serves canvas preview and graph mutation through the cached `BoardGraphIndex`, while the store retains ids, mutation, placement, commits, undo, events, and pulses. Production is +95/-96 (net -1); total PR is +129/-120. Focused proof passed 79/79 with pinned typecheck, source scans, diff checks, hosted Required, browser interactions, and both independent review axes. Exact-main Required and artifact `eido-main-f85765d3466ffe824edd1a76f708706dedb4cc87` passed, and #637 closed automatically. |
| 16. Share the overlay focusable-element selector | [#638](https://github.com/limweili/eido/issues/638), [PR #639](https://github.com/limweili/eido/pull/639) | Fourth pass; lower half; landed | Squash `e829a60e` is on `main`; one private overlay-local selector replaces both copies for +10/-18 production lines. Focus/dialog tests passed 10/10; typecheck/build/bundle/tooling and uniqueness/byte-equivalence checks passed; the complete suite matched the same 1,908/1,925 clean-base inventory; both independent review axes and hosted PR proof passed. Exact-main Required and SHA-bound artifact `eido-main-e829a60ecf4ab8eee87fa241843d4b1712f68691` passed, and #638 closed automatically. |
| 17. Delete unreachable shared copy entries | [#642](https://github.com/limweili/eido/issues/642), [PR #644](https://github.com/limweili/eido/pull/644) | Fifth pass; lower half; landed | Squash `2a8f2f55` is on `main`; exhaustive exact-key, string-key, dynamic-read, enumeration, test, and open-PR checks proved twenty `words` properties cannot reach UI or runtime errors. The patch is exactly 0 additions/20 production deletions with no replacement abstraction or caller change. Copy tests passed 4/4 with pinned typecheck/absence/diff checks, hosted PR Required, and both independent review axes rerun after rebase. Exact-main Required and artifact `eido-main-2a8f2f551aa71169ecf157b21309b6679fc1a9b0` passed, and #642 closed automatically. |
| Prune unreachable semantic undo variants | [#276 comment](https://github.com/limweili/eido/issues/276#issuecomment-5013802103) | Already owned; comment only | ADR 0016 and two independent audits prove five unconstructed `HistoryAction` variants, their builders, preparation, and replay support leave about 250-280 removable LOC. Fold the deletion into the active mixed-delete undo lane; do not create a competing issue or patch. |
| Delete the dormant Version-provenance projection | [#562 comment](https://github.com/limweili/eido/issues/562#issuecomment-5013822837) | Already owned; comment only | `provenanceForVersion` and `VersionProvenance` have no callers and retain the superseded linear lookup shape. Delete rather than migrate them when Version Context ownership starts; retain only live run-index callers. |
| Contract duplicate design-prototype mirrors | [PR #443 comment](https://github.com/limweili/eido/pull/443#issuecomment-5013792018) | Already owned; comment only | Seventeen byte-identical pairs across the live design and research prototype roots duplicate 3,465,509 tracked bytes. Elect one canonical root after the active draft settles, repoint references, and delete proven-identical mirrors first. |
| Share the browser Blob-to-data-URL adapter | [#247 comment](https://github.com/limweili/eido/issues/247#issuecomment-5013795699) | Already owned; comment only | Clipboard ingestion and image compression carry the same eight-line `FileReader` adapter; `File` already satisfies `Blob`. Move the literal adapter only after the active image epic settles, without absorbing compression or clipboard policy. |
| Generate cross-runtime skill mirrors from one authoring source | [PR #299 comment](https://github.com/limweili/eido/pull/299#issuecomment-5013794694) | Already owned; comment only | Thirty byte-identical files duplicate 99,090 bytes across `.agents` and `.claude`, but both discovery roots are real and Git symlinks are unsafe on Windows. Preserve the parity test until the active skill lane can prove a portable materialization path. |
| Unify workflow parsing behind one fail-closed module | [#545 comment](https://github.com/limweili/eido/issues/545#issuecomment-5013998958) | Fourth pass; already owned; comment only | Two CI policy modules independently parse the same `jobs:` YAML seam in 33 LOC, repeat the exact two-space assumption, and expose complementary raw-block versus metadata shapes. #545 should replace both—not add a third adapter—with one deep parsed-workflow interface while keeping each policy local. |
| Consolidate native SQLite test fixtures | [#520 comment](https://github.com/limweili/eido/issues/520#issuecomment-5014297739) | Fifth pass; already owned; comment only | Four native suites repeat the same revision-7 Profile, command batch, owner options, disposable database, root registry, and cleanup ledger. The active SQLite/Profile epic should adopt one test-only fixture authority when those tests next move, preserving scenario-local faults and recovery identity; estimated deletion is 160–230 LOC. |
| Deepen the fake-GitHub Merge Captain harness | [#414 comment](https://github.com/limweili/eido/issues/414#issuecomment-5014297752) | Fifth pass; already owned; comment only | Thirteen fake-`gh` scenarios in the 1,214-line classifier suite repeat process lifecycle and PR-envelope setup. Extract only command lifecycle, gate execution, snapshot defaults, and guaranteed cleanup inside the existing classifier owner; keep provider programs and ordering visible. Estimated deletion is 120–180 LOC. |
| Share packaged native-proof plumbing | [#528 comment](https://github.com/limweili/eido/issues/528#issuecomment-5014297748) | Fifth pass; already owned; comment only | Packaged browser and SQLite proofs repeat executable/resource layout, output-root derivation, assertions, and runtime identity. #528 should own a small shared proof foundation as terminal consumers grow while keeping scenario orchestration separate; present deletion is only 20–35 LOC. |
| Delete the stale machine-specific prototype launcher | [PR #443 comment](https://github.com/limweili/eido/pull/443#issuecomment-5014001090) | Fourth pass; already owned; comment only | A six-line/264-byte `proto` entry targets a worktree 135 commits behind `main`; the same config already contains the documented root-relative living-reference launcher. Remove the stale adapter after the draft settles and keep the current launcher. |
| Remove duplicate production-test data cleanup | [#531 comment](https://github.com/limweili/eido/issues/531#issuecomment-5014003939) | Fourth pass; already owned; comment only | Production Playwright config exit/signal handlers and `globalTeardown` independently remove the same data file plus `.boards` sidecar. Once #531 owns the lifecycle, retain one ownership-scoped cleanup seam and delete the teardown module/config property; do not generalize through protected performance configs. |
| Reuse canonical stable serialization if legacy storage merge survives | [#520 comment](https://github.com/limweili/eido/issues/520#issuecomment-5014025809) | Fourth pass; already owned; comment only | `storageMerge` repeats the shared recursive key-sorted serializer exactly for one caller. Let the active Profile/#252 owners decide retention first; if the module survives, import the existing authority and delete about eight net LOC, otherwise retire it with the legacy seam. |
| Consolidate Profile boundary primitives | [#520 comment](https://github.com/limweili/eido/issues/520#issuecomment-5014335239) | Fifth pass; already owned; comment only | Seven active persistence modules carry fifteen exact copies of `isPlainRecord`, `canonicalTimestamp`, and `deepFreeze`. The Profile epic should elect one narrowly named JSON-boundary authority when #520/#595/#525/#463 reconcile these files, preserving byte-identical compatibility/security semantics and keeping higher-level validation local; estimated deletion is 48–55 production LOC. |
| Delete the now-unreachable Markdown preview branch | [#354 comment](https://github.com/limweili/eido/issues/354#issuecomment-5014030810) | Fourth pass; rich-card owner; comment only | `NoteCard` calls the preview helper only when fixed height is true and passes that same true flag, so the helper always returns the original text; the false branch also uses the original text. The owner can delete the module, implementation-pinned test, import, and stale cap prose for roughly 45–50 net LOC without changing rendering. |
| Delete superseded Result-card viewport wrappers | [#354 comment](https://github.com/limweili/eido/issues/354#issuecomment-5014049538) | Fourth pass; rich-card owner; comment only | Two functions explicitly labelled compatibility wrappers retain roughly 30–36 production LOC and only five test consumers after Board adopted the all-card growth planner. Migrate authoritative assertions to that canonical interface when the active rich-card lane owns the files. |
| Contract five obsolete granular Mod-control actions | [#525 comment](https://github.com/limweili/eido/issues/525#issuecomment-5014039249) | Fourth pass; already owned; comment only | Five GraphState setters have only test/action-inventory consumers after `ModEditor` moved to whole-control replacement. They retain roughly 100–125 production LOC and duplicate live range/options normalization. Remove them before the Agent Gateway defines its own atomic Mod command seam. |
| Remove retired Result follow-up write actions | [#598 comment](https://github.com/limweili/eido/issues/598#issuecomment-5014076393) | Fourth pass; already owned; comment only | `setFollowUpCollapsed` and `clearFollowUpThread` have no production callers but remain advertised by the future action inventory. Delete the stale writers and contract entries while retaining persisted `collapsed` data and cleared-event read/playback compatibility for old saves. |
| Share two literal canvas interaction mechanics after active work settles | [#279 comment](https://github.com/limweili/eido/issues/279#issuecomment-5014046565) | Fourth pass; lower half; already owned; comment only | BottomDock/UndoControls repeat an exact editable-element predicate, while three rich result cards repeat copy-feedback state and timers. Preserve Board's different descendant-aware predicate and current clipboard failure behavior; defer the card-local hook until protected performance work settles. |
| Retire the rejected cached-passive Card experiment | [#533](https://github.com/limweili/eido/issues/533) | Already owned | Excluded; this program did not refactor its behavior, decision, privacy rules, or evidence meaning. #597 changed only compatibility references/assertions required to remove the retired sibling flag and preserved the frozen v8 lineage key. |
| Share rich-Card performance harness setup | [#533 comment](https://github.com/limweili/eido/issues/533#issuecomment-5013616003) | Already owned; comment only | The two large performance drivers share substantial setup, but rich-Card performance is active work. Record the obvious future parameterized-runner option on the existing issue; do not create a competing ticket or patch. |
| Share the common graph-store test reset baseline | [original #598 comment](https://github.com/limweili/eido/issues/598#issuecomment-5013630217), [expanded inventory](https://github.com/limweili/eido/issues/598#issuecomment-5014310945) | Fifth pass confirmed; already owned; comment only | The original seven-suite sample expands to 19 non-performance test-local reset functions totaling roughly 385 LOC, plus about 30 suites with similar Card/Connection fixtures. A careful test-only authority could remove 220–320 net LOC, but the consumers cross active run, resize, undo, connection, and agent-interface lanes. Keep #598 as semantic owner and migrate only when those seams settle. |
| Consolidate Timeline Projector direction handling | [#417 comment](https://github.com/limweili/eido/issues/417#issuecomment-5013632501) | Already owned; comment only | `applyEvent` and `reverseEvent` repeat symmetric cases, but create/delete asymmetry is real and timeline scrub/playback is active. Recommend only a literal direction-aware reducer inside the existing seam; avoid a generic operation table. |
| Remove the digest-selection compatibility adapter | [#255 comment](https://github.com/limweili/eido/issues/255#issuecomment-5013682801) | Already owned; comment only | #621's first review correctly identified a new Middle Man, but deleting it requires changing #255-owned `runEngine.ts`. Preserve the adapter at that live ownership seam and let #255 migrate its two consumers directly when safe. |
| Consolidate SQLite fenced reads and sidecar authority proof | [PR #599](https://github.com/limweili/eido/pull/599), [epic #520](https://github.com/limweili/eido/issues/520), [#594](https://github.com/limweili/eido/issues/594), [#595](https://github.com/limweili/eido/issues/595), [#465](https://github.com/limweili/eido/issues/465) | Already owned | Excluded; this is an active one-writer security seam, not opportunistic cleanup territory. |
| Retire the proof-only packaged SQLite wiring | [#465](https://github.com/limweili/eido/issues/465), [#528](https://github.com/limweili/eido/issues/528), [#448](https://github.com/limweili/eido/issues/448), [#471](https://github.com/limweili/eido/issues/471) | Already owned | Excluded until the production installation and terminal native certification decide which proof remains authoritative. |
| Delete unused provenance and lineage projections | [epic #598](https://github.com/limweili/eido/issues/598), [#523](https://github.com/limweili/eido/issues/523), [#562](https://github.com/limweili/eido/issues/562) | Already owned | Excluded; the live agent-interface/provenance investigation needs the current source-grounded starting surface. |
| Consolidate Idea activation/reset and metadata policy | [#595](https://github.com/limweili/eido/issues/595), [#594](https://github.com/limweili/eido/issues/594), [#463](https://github.com/limweili/eido/issues/463), [#465](https://github.com/limweili/eido/issues/465) | Already owned | Excluded; current Profile/Idea lifecycle and persistence work owns these seams. |
| Share Ask/group-digest streaming settlement | Adjacent [#255](https://github.com/limweili/eido/issues/255) | Rejected | Marginal 20-30 LOC deletion does not justify obscuring intentionally different failure propagation or colliding in `runEngine.ts`. |
| Reuse the canonical reasoning-effort value list in Settings | None | Fourth pass; rejected below ticket threshold | The six-value UI list exactly repeats `graph/types.ts`, but replacing its one local line with one value import removes only about one net LOC and no observed drift. Tracker, review, and merge cost exceeds the bounded benefit. |
| Delete the unused graph-index cache-stats wrapper | Adjacent [#353](https://github.com/limweili/eido/issues/353), [#354](https://github.com/limweili/eido/issues/354), [#562](https://github.com/limweili/eido/issues/562) | Fourth pass; rejected below ticket threshold | The definition-only diagnostic wrapper is three lines over still-live counters. Deletion would save less than its performance/Version coordination and evidence cost, so no ticket was created. |
| Collapse selected canvas renderer, image resolver, Mod renderers, or distinct runners | Architectural decisions and active feature owners | Rejected | Earned complexity: these modules hide materially different interaction, ownership, cache, or cancellation rules behind useful interfaces. |

## Live friction log

### 2026-07-19 - Worktree creation needs an existing execution directory

**Observed.** The first #642 worktree-creation command declared the
not-yet-created worktree itself as its execution directory, so the command was
rejected before the shell launched. No branch, worktree, or repository file was
changed.

**Immediate handling.** Retry the same explicit worktree creation from the
existing parent repository, then verify the new worktree base before editing.

**Opportunity.** Worktree orchestration should distinguish the command's
existing control directory from its future target directory. A small preflight
can require `cwd` to exist and the target not to exist before creation.

### 2026-07-19 - Serial landing preserved exact-main attribution

**Observed.** PR #639 was independently ready while PR #640 was still changing
under review. Merging both before proving the first main commit would have made
a failure or missing release artifact harder to attribute and could have
cancelled useful evidence through unrelated branch movement.

**Immediate handling.** Mark only #639 ready, re-derive its exact base/head,
scope, closing issue, hosted gate, and mergeability, then squash it alone.
Pause the train until `e829a60ecf4ab8eee87fa241843d4b1712f68691`
had both a successful exact-main Required run and artifact
`eido-main-e829a60ecf4ab8eee87fa241843d4b1712f68691`. #638 closed
automatically; #640 remained draft and untouched.

**Opportunity.** Independent lanes should stay parallel through discovery,
implementation, and review, but shared-state landing remains serial. A green
PR is readiness evidence; exact-main proof plus its release object is landed
outcome evidence.

### 2026-07-19 - A stale focused-test path briefly undercounted proof

**Observed.** The first rerun after the indexed #637 correction named
`src/canvas/connectionFeel.test.ts`, but the live file is
`src/graph/connectionFeel.test.ts`. The runner therefore exercised three of the
four promised files without failing, which could have made the reported scope
look complete when it was not.

**Immediate handling.** Discover the authoritative file from source, rerun all
four named suites, and report the corrected 79/79 result. Keep the PR draft and
invalidate its older hosted/review evidence again because the implementation
head and then the base both changed.

**Opportunity.** Focused proof commands should resolve paths from the current
tree before execution, and evidence summaries should count both discovered
files and assertions. A green command proves only what it actually selected.

### 2026-07-19 - A larger inventory was not a new owner

**Observed.** The fifth-pass harness lane expanded a seven-suite reset-helper
sample into 19 local `resetStore` implementations and initially labelled the
larger 220–320 LOC opportunity unowned. The live ledger already routed the same
semantic refactor to #598 because its callers cross active run, resize, undo,
connection, and agent-interface work.

**Immediate handling.** Do not create the proposed ticket. Reconcile #640's
temporary file overlap, then add the stronger inventory and deletion estimate
to #598 while preserving the original ownership decision.

**Opportunity.** Opportunity identity is semantic, not proportional to newly
counted lines. Every later audit must compare candidates with the program's own
disposition ledger as well as live GitHub titles, bodies, paths, and symbols.

### 2026-07-19 - The first shared planner failed the deletion test

**Observed.** #637's first isolated draft correctly made canvas validation and
store mutation consume one connection-admission policy, but a 66-line plan
module plus consumer plumbing turned 77 removed lines into roughly 18 net new
production lines. The seam was deeper, yet the ticket's claimed deletion and
this program's simplification premise were not met.

**Immediate handling.** Hold publication and ask the implementation lane to
remove interface ceremony—particularly the repeated rejected-plan object—while
keeping the policy explicit and readable. If the shared plan cannot become
net-negative, require an evidence-backed reason to amend or reject the ticket
instead of quietly redefining success.

**Opportunity.** Centralization is not automatically simplification. Every new
authority needs a whole-patch deletion test that counts adapter and type
ceremony, not only the duplicated branches it replaces.

**Review follow-up.** Independent Spec review then found that issue #637 still
required the rejected-object representation the deletion test had disproved,
and that its named store suite did not directly prove reverse non-consumer
connections can coexist. Amend the ticket transparently to the selected
`null | direct | throughResult` interface, add only the missing store-level
regression, invalidate both reviews on the new head, and rerun them.

**Standards follow-up.** The parallel Standards review found a deeper inherited
problem: the proposed authority accepted raw Card/Connection arrays and scanned
them during React Flow connect validation, conflicting with the foundation's
indexed-read and no-full-board-hot-path invariants. Hold the otherwise green PR,
amend #637 to require the existing narrow `BoardGraphIndex` seam, return IDs
rather than whole Card records, remove the now-unneeded helper widening, and
invalidate hosted proof plus both reviews again. Centralizing a violation would
make it harder—not easier—to remove later.

### 2026-07-19 - Policy comparison found leverage that dead-code scans missed

**Observed.** Zero-caller, duplicate-file, and exact-function sweeps mostly
returned owned or shallow cleanup. The independent policy/test lane instead
compared two live consumers and found that canvas connection validation
explicitly promises to mirror `store.addConnection`: two active
implementations of one core admission policy, each with different side effects
around it. The same lane found a smaller byte-identical selector across the two
overlay focus adapters.

**Immediate handling.** Re-check both findings against the full live issue,
PR, and draft-PR inventory; publish #637 and #638 before implementation; rank
the core connection seam above the literal overlay extraction; and dispatch
only the top item until an independent slot returns.

**Opportunity.** Future simplification audits should deliberately combine
dead-code and literal-duplication scans with a policy-equivalence lane that asks
which live modules claim to mirror one another. The highest-leverage duplicate
may share behavior rather than syntax.

### 2026-07-19 - Literal ownership search missed a semantic security owner

**Observed.** Source and history proved `refreshModelWindows` unreachable, and
literal tracker searches for the symbol, module, and "model window" returned no
owner. #636 was therefore published and dispatched. The independent runtime
lane then identified the broader contract: open #466 owns packaged network
egress, including this dormant OpenRouter endpoint.

**Immediate handling.** Interrupt the isolated implementation before its first
edit, verify the worktree remained clean, close #636 with the ownership reason,
and copy the source evidence plus cached-value compatibility invariants to #466.
No code or user behavior changed.

**Opportunity.** Ownership qualification needs a semantic boundary pass—not
only path, symbol, title, and body matches—before publishing or dispatching a
ticket. Security, persistence, performance, and release contracts should act as
explicit veto categories in every opportunistic audit.

### 2026-07-19 - Graph collection projections returned cardinalities, not values

**Observed.** A fourth-pass duplicate-name query projected
`collect(f.file_path)` and `collect(f.qualified_name)`, but the graph transport
serialized the collections as strings such as `"4"` and `"2"` rather than the
paths and symbols. The counts proved multiplicity but could not identify a
candidate.

**Immediate handling.** Re-expand each surviving symbol through bounded
`search_graph` calls and validate the concrete implementations in source. Do
not use the lossy collection projection as ticket evidence.

**Opportunity.** Collection-valued Cypher results need a stable structured
serialization contract, or an explicit diagnostic when only cardinality can
be returned.

### 2026-07-19 - Tracker search rejected an assumed result field

**Observed.** The first fourth-pass ownership search requested a generic
`type` field from `gh search issues`; this installed CLI exposes
`isPullRequest` instead. The first retry then passed repository and state
qualifiers inside the search string, while this CLI expects `--repo` and
`--state` flags; both probes failed before returning any ownership data.

**Immediate handling.** Use the command's returned field inventory, retry with
`isPullRequest` plus explicit repository/state flags, and treat failed results
as no evidence rather than empty ownership matches.

**Opportunity.** Tracker audit recipes should pin the accepted JSON projection
or discover it once up front so a schema mismatch cannot masquerade as a clean
ownership search.

### 2026-07-19 - Fourth-pass zero-inbound graph scan closed the transport

**Observed.** The refreshed exact-`main` graph again classified helpers in
`*.test.ts(x)` files as production. A broad zero-inbound `OPTIONAL MATCH`
aggregation then closed the codebase-memory MCP transport instead of returning
a bounded result, reproducing the third-pass warning that caller counts and
test classification are not yet authoritative. An independent policy lane
later triggered the same failure from `search_code`; subsequent `index_status`
calls also returned `Transport closed`, proving the failure persisted beyond
one query shape.

**Immediate handling.** Keep graph-first discovery, but retrieve the paginated
function inventory, rank numeric fields locally, filter test paths from their
filenames, and validate every survivor against source and live ownership. Do
not retry the unbounded aggregation, treat post-failure graph calls as
unavailable, or infer dead code from graph in-degree alone.

**Opportunity.** The graph interface should classify compound test suffixes,
bound or reject explosive aggregations before execution, and return a typed
diagnostic without taking down the shared transport.

### 2026-07-19 - Graph metric queries looked authoritative but ranked strings

**Observed.** The refreshed knowledge graph was healthy, but broad Cypher
queries sorted numeric complexity fields lexicographically, treated several
browser/performance tests as production, and returned misleading partial
clusters when compound path predicates were applied. An independent tooling
lane also saw `OPTIONAL MATCH` caller counts inflate into Cartesian-looking
8,000-10,000 values. The first result set therefore overrepresented fixture
property functions and hid `Board` despite its much higher numeric complexity.
Large responses were also truncated before the relevant rows.

**Immediate handling.** Keep structural discovery graph-first, but page the
complete `search_graph` result set, rank its numeric fields in the orchestrator,
exclude owned/test paths explicitly, and validate every surviving candidate in
source. This recovered the real 3,377-function inventory and prevented a noisy
metric from becoming a ticket.

**Opportunity.** The graph query interface should expose metric properties as
numbers, make test classification reliable for `.browser.test` and `.perf`
files, and warn when a predicate or sort is being evaluated with string
semantics. Audit recipes should prefer paginated graph search plus local
ranking until that contract is explicit.

### 2026-07-19 - The text patcher cannot delete a binary duplicate

**Observed.** Issue #628 proved two PNGs byte-identical before editing, but the
required patch path tried to decode the deletion target as UTF-8 and rejected
the combined patch at byte zero. The failure was atomic; neither the Markdown
link nor the binary changed.

**Immediate handling.** Apply the one-line Markdown edit with the patcher, then
use exact-path `git rm` only for the already SHA-256- and `cmp`-verified duplicate.
Recheck the retained asset hash, resolved link, removed-path references, and
exact byte delta afterward.

**Opportunity.** Binary deletion is a normal refactor operation. The editing
path should detect non-text targets and support exact-path deletion without
attempting a text decode, while retaining the same narrow-target safeguards.

### 2026-07-19 - A rendered-link check missed the document's planned tree

**Observed.** The first #628 patch repointed the live Markdown image and removed
the binary, but the same research brief still named the old asset in a fenced
"planned folder structure" block. The path was descriptive rather than a live
link, so link-resolution proof passed; independent Spec review correctly found
that the ticket's stronger no-stale-reference criterion had not.
The first correction then unnecessarily changed the historical plan sentence
from future to present tense; the same reviewer caught that semantic drift.

**Immediate handling.** Update the tree entry to name the retained canonical
`intent/` asset, preserve the surrounding historical narrative, search both the
full removed path and the asset basename, and return the amended patch to both
review axes. Restore the original plan sentence verbatim rather than modernizing
prose that does not need to change.

**Opportunity.** Deletion proof should distinguish executable links from
descriptive inventories but search both. A resolved replacement link proves
rendering; only a repository-wide basename/path search proves that the removed
artifact no longer survives in documentation.

### 2026-07-19 - Required behavior proof is red on a macOS path alias

**Observed.** The untouched baseline passed toolchain policy, CI-tool tests,
design-system authority, workflow policy, type-check/build, and bundle budget.
The fast behavior suite passed 2,318 of 2,320 tests. Both failures are in the
Electron scratch-user-data tests: the implementation canonicalizes macOS
`/var` to `/private/var`, while the assertions compare the non-canonical path.

**Immediate handling.** Pin the baseline to commit `b02e1ec3` and treat these
two assertions as pre-existing host/path evidence. Refactor lanes reuse that
inventory instead of repeatedly diagnosing or opportunistically fixing it.

**Opportunity.** Temp-path tests should compare canonical filesystem identity,
not spelling. Host aliases should be normalized at the test seam so a security
check can remain strict without becoming machine-specific.

### 2026-07-19 - Architecture selection did not contract losing experiments

**Observed.** ADR 0023 terminally rejects both within-Card content visibility
and cached-passive Cards, and states that no losing renderer remains open. The
active Board still exposes both candidate switches, while their prototype,
tests, evidence publishers, and manual workflows account for more than 20,000
lines. The selected buffered rich-DOM path has already shipped.

**Immediate handling.** Treat contraction as a first-class refactor rather
than another architecture decision. Publish one ticket per unowned experiment
and prove the ordinary selected path is unchanged. The live ownership check
found that cached-passive work is related to pre-existing open issue #533, so
only content visibility entered this program as #597.

**Opportunity.** Every architecture-selection closeout should carry an explicit
retire list for losing implementations, feature switches, tests, workflows,
and runbooks. Historical evidence can remain as archaeology; executable
alternatives should have a named owner or be removed in the selection train.

### 2026-07-19 - Repository graph was stale for the active worktree

**Observed.** The structural knowledge graph contained many nearby Eido
worktrees but not the exact checkout. A fresh moderate index was required
before the audit could use call and dependency evidence. Similarity queries
also returned parser/empty-result errors despite the advertised edge schema.

**Immediate handling.** Index the exact checkout, use graph results for symbol
and call discovery, and fall back to targeted literal search only where the
graph cannot answer.

**Opportunity.** Codebase-memory should identify the active worktree
automatically and ship query-contract coverage for every edge advertised by
its schema. Nearby branch indexes are unsafe substitutes during refactoring.

### 2026-07-19 - Ownership policy arrived after the first ticket

**Observed.** Ticket #597 was published before the program had an explicit
rule to exclude pre-existing open epics, issues, and draft pull requests. A
subsequent live search found #533 before a duplicate cached-passive ticket was
created, so no conflicting work began.

**Immediate handling.** Add a live GitHub ownership search as a qualification
gate before every future ticket and implementation dispatch. Newly created
program tickets remain owned by this program; pre-existing open work is only
recorded and excluded.

**Opportunity.** Opportunistic refactor programs should declare their external
ownership exclusion at kickoff, alongside behavior and data-safety boundaries,
so discovery cannot accidentally become duplicate delivery.

### 2026-07-19 - The open-ended audit needed a convergence rule

**Observed.** A full-codebase simplification brief can always discover another
small cleanup. Without an explicit definition of explored and a value/risk
cutoff, low-leverage polish can consume the same attention as changes that
remove whole rejected architectures or hot-path complexity.

**Immediate handling.** Give every candidate a disposition, rank qualified
work by risk-adjusted performance, leverage, impact, and deletion, and reserve
the delivery budget for the top half. Lower-half work proceeds only when it is
independent and cannot delay higher-value integration.

**Opportunity.** Future opportunistic programs should declare their ranking
model and marginal-value stop condition in the kickoff goal. Completeness means
the important decisions are made and the strongest work is landed, not that no
possible cleanup remains.

### 2026-07-19 - The audit base advanced while discovery was running

**Observed.** The initial checkout was detached at `b02e1ec3`. Refreshing the
delivery base before opening implementation work moved the program to current
`origin/main` at `42a2e3bd`, including `40c6bd3c` and roughly 2,600 lines of new
SQLite Profile ownership code and proof. The earlier baseline and persistence
audit therefore do not prove the new head.

**Immediate handling.** Re-index the exact current worktree, re-establish the
baseline on `42a2e3bd`, and treat older persistence findings as hypotheses until
revalidated. The new ownership code is also checked against its issue/PR state
before it can enter the opportunity set.

**Opportunity.** Long-running repository audits need a named source snapshot
for discovery and a mandatory live-base reconciliation before ticketing or
implementation. Findings can survive base movement; proof and ownership claims
cannot.

### 2026-07-19 - The refreshed main baseline added twelve ownership-test failures

**Observed.** Re-running the required local toolchain first at `42a2e3bd` and
again after #599 landed as current `origin/main` `c5152e88` passed install
policy, all 140 CI-tool tests, design-system authority, workflow policy,
type-check/build, and the 438.4 KiB / 450 KiB bundle budget. At the final audit
head the fast suite passed 2,335 of 2,349 tests. The two known
scratch-user-data failures remain, and twelve SQLite Profile revision-store
tests fail before their assertions because the capability helper canonicalizes
the Profile path from macOS `/var` to `/private/var` but compares it with a
sidecar path that was only lexically resolved. The newly merged blob tests add
no failures. After #607 added strict Mod records, #600's full-suite comparison
on `a9387430` passed 2,342 tests and exposed a fifteenth failure: one new Mod
store case reaches the same path-capability alias check. Its 108 focused canvas
tests and typecheck pass, so the added failure is independently attributable
to the advancing baseline, not residency logic. #597's independent Standards
review then reproduced the same fifteen-file inventory on `49c91002` while all
changed-file, workflow-policy, design-authority, typecheck, build, and bundle
checks passed; #601 reproduced the same 2-file/15-test split with no Electron
or storage changes, confirming the baseline across a third unrelated refactor.

**Immediate handling.** Pin the fourteen-test inventory at `c5152e88` and the
fifteen-test inventory after #607 as versioned pre-existing proof. They are
unrelated to the simplification candidates and are not silently repaired
inside a refactor. Each implementation lane must compare against the inventory
for its exact shared base rather than treating one stale count as universal.

**Opportunity.** Security-sensitive path capabilities need one explicit
filesystem-identity policy applied consistently to every related path. Tests
for newly landed ownership code should run on a host with macOS path aliases,
or carry a focused alias case, before the merge train declares the baseline
green.

### 2026-07-19 - Rejected experiments share an evidence contract

**Observed.** The cached-passive candidate is excluded from this program
because open issue #533 already owns it, but its workflow, capture commands,
and evidence schema record the rejected content-visibility switch as explicitly
off. Removing the content-visibility executable path therefore leaves a small
set of references inside otherwise out-of-scope cached-passive machinery.

**Immediate handling.** Treat those references as compatibility fallout of
#597, not permission to refactor cached-passive behavior. Remove only the
retired sibling flag and its assertions where required for a coherent build;
preserve cached-passive runtime behavior, evidence meaning, privacy work, and
all #533-owned decisions. A checkpoint caught a proposed rename of the
serialized `contentVisibility` lineage key before commit; default to retaining
that legacy evidence key with its constant selected value rather than changing
an out-of-scope external schema or forcing a schema-version bump.

**Opportunity.** Experimental evidence should bind the production invariants
it needs, not the names of every sibling experiment that happened to be off.
Independent candidates then remain independently removable after an
architecture decision.

### 2026-07-19 - Live ownership changed during the audit

**Observed.** Electron simplification hypotheses were initially inspected on
current main at `42a2e3bd`; PR #599 then appeared against the same SQLite
authority files while the lane was still reviewing them and landed as
`c5152e88` before ticket qualification finished. Open epic #598 also appeared
and claimed source-grounded provenance and execution inventory work. Related
ownership already existed, but the new epic and PR made the collisions
immediate rather than theoretical. Later, ready [PR #612](https://github.com/limweili/eido/pull/612)
appeared for #462's native SQLite recovery seam while simplification delivery
was underway and landed as `91380054`. It remains isolated to the already-
excluded persistence area and has zero file overlap with the top-ranked #597
patch; open simplification branches are nevertheless refreshed because shared-
base proof is versioned even when patches do not overlap.

**Immediate handling.** Advance the orchestration base and exact-worktree graph
to `c5152e88`, re-establish the required baseline, exclude the SQLite
authority/refinement and provenance/lineage lanes, and keep delivery branches
away from those owned decisions. Re-run ownership checks immediately before
every remaining ticket and implementation dispatch.

**Opportunity.** Repository-wide opportunistic programs need ownership as a
live gate, not a kickoff snapshot. Issue and draft-PR inventories should be
cheap to refresh and candidates should retain the exact last-checked head and
timestamp.

### 2026-07-19 - Isolated worktrees do not inherit the verified dependency tree

**Observed.** The first implementation branches correctly started in isolated
worktrees, but a fresh worktree has no `node_modules`. The ambient host exposes
unsupported Node 24/npm 11, and a generic workspace-dependency probe hung while
an agent tried to locate the pinned Node 22/npm 10 runtime. The same gap
recurred in #600: a focused-test probe reached Vite configuration before
dependency installation even though the bootstrap command appeared later in
the task envelope. The close-out HTML verifier exposed the same class from a
different direction: an ESM script placed in `/tmp` resolved Playwright from
its own directory rather than the repository's installed dependency tree.

**Immediate handling.** Stop the generic probe and use the repository-owned
launcher directly: `node scripts/ci/local-toolchain.mjs -- npm ci`, followed by
focused commands through the same launcher. This keeps each worktree
reproducible without borrowing an untracked dependency tree from another
branch. Keep dependency-using verification scripts inside the resolved
workspace or import the workspace package by an explicit file URL.

**Opportunity.** Worktree dispatch should make one canonical bootstrap command
an explicit first precondition, not merely include it among later evidence
steps. A dependency locator is not a substitute for the repository's own
executable toolchain contract and should time out quickly when it cannot
improve that answer.

### 2026-07-19 - Browser-test naming crosses runner discovery boundaries

**Observed.** After rebasing #602 onto the first landed simplification, a
focused file search returned both Vitest suites and
`BottomDock.browser.test.ts`. Passing that combined list to Vitest produced a
runner error before any browser assertion because the browser file is a
Playwright suite. Typecheck and the four actual Vitest files remained green.

**Immediate handling.** Classify focused tests by the repository's runner
contract instead of forwarding filename matches to one runner, and rerun the
browser seam through its declared Playwright command. Do not count the mixed-
runner invocation as product evidence or a code regression.

**Opportunity.** Test-file naming or a small repository-owned focused-test
router should make runner ownership unambiguous. A suffix that is discoverable
by two incompatible runners adds avoidable friction to risk-proportional
verification.

### 2026-07-19 - Deleting the feature did not delete its lowest-level parser shape

**Observed.** Both independent #597 reviews found the same leftover after the
large candidate deletion: ordinary Markdown still flowed through the retired
candidate's private segment grouper. It grouped lists and tables into chunks,
then its only consumer immediately joined those chunks back into the exact
document string. Standards review also caught a research sentence describing
scroll drift as the “sole” veto even though ADR 0023 records scroll drift,
live-to-passive re-entry drift, and first-intent retargeting.

**Immediate handling.** Do not publish #597 yet. Delete the private segment
grouping and return the already-built HTML parts as one byte-identical string;
use the existing Markdown goldens as the authoritative behavior proof. Correct
the archaeology sentence against ADR 0023, rerun the two affected seams, and
have both review axes confirm the amended head.

**Opportunity.** Architecture contraction should trace a rejected concept all
the way into shared utility internals, not stop at exported names, flags, or
files. Decision archaeology should be checked against its governing ADR during
the same closeout, because a tense/status rewrite can preserve code truth while
quietly weakening decision truth.

### 2026-07-19 - Focused workflow proof missed the global workflow inventory

**Observed.** #597's focused workflow-policy tests and validator passed after
the retired experimental workflow was deleted, but the hosted Required gate
failed in `toolchain-policy.test.mjs`. A separate migration-inventory assertion
still expected nine Node workflows and ten jobs; the correct post-contraction
inventory is eight workflows and nine jobs. The failure was exact-head CI
policy drift, not product behavior.

**Immediate handling.** Diagnose the hosted log through the CI-fix workflow,
update only the authoritative inventory totals, and run the complete CI-tool
suite before amending and re-reviewing #597. Do not waive or rerun the failed
gate without changing its stale premise.

**Opportunity.** A workflow-deletion task envelope must include all repository
governance inventories, not only tests named after workflow policy. Prefer one
derived inventory assertion or a single canonical policy command so deleting a
workflow cannot leave a second hard-coded count outside the focused proof set.

### 2026-07-19 - A private traversal helper nearly narrowed legacy no-op input

**Observed.** #604's first typecheck caught that
`RunRecord.producedVersionId` remains optional for legacy saves. The repeated
inline loops naturally no-op when given `undefined`; the first helper signature
accepted only a string and would have made that compatibility behavior
unrepresentable even though the traversal body itself was equivalent.

**Immediate handling.** Keep the private helper input `string | undefined`,
retain visit-all matching behavior, and let every caller continue owning its
commit/transient/no-op policy. Typecheck is green after restoring the legacy
shape; focused store behavior still decides whether the abstraction is safe.

**Opportunity.** When centralizing permissive inline traversal, derive the
helper contract from every caller's real domain type—including malformed and
legacy states—before deriving it from the common happy path. Type errors during
refactoring are compatibility evidence, not merely syntax friction.

### 2026-07-19 - Nested review fan-out competed with central scheduling

**Observed.** The #604 builder opened its independent Standards reviewer, but
the four-agent ceiling rejected the parallel Spec reviewer while #601 was using
another slot for current-base integration. Earlier #601 also finished without
its own review children because delivery slots were already occupied. The code
was not blocked, but review topology became an accidental function of which
child asked first.

**Immediate handling.** Keep the finished implementation isolated, let the
active reviewer complete, and launch every missing review axis centrally as
slots return. Do not collapse Standards and Spec into one verdict merely to fit
the concurrency ceiling.

**Opportunity.** The orchestrator should reserve review capacity explicitly or
own all review fan-out; builders should report readiness rather than racing to
spawn children when the program already has multiple live lanes. Parallelism
is useful only when its scheduling remains legible at the system level.

### 2026-07-19 - Graph discovery availability differed between agents

**Observed.** The main orchestration session could query the exact-worktree
codebase graph for #605, but the isolated implementation agent found its graph
transport closed when it began the same ticket. The preferred discovery path
therefore was not consistently available across the agent tree.

**Immediate handling.** Reuse the main session's source-grounded symbol
inventory, then let the isolated lane fall back to targeted `rg` and direct
reads as the repository instructions allow. The implementation remains bounded
to the two already-qualified store actions, so this is delivery friction rather
than an evidence gap.

**Opportunity.** Worktree-aware codebase-memory access should be inherited and
health-checked as part of subagent startup. A discovery service that works only
in the orchestrator silently shifts every delegated lane onto slower fallback
search and makes evidence quality depend on session topology.

### 2026-07-19 - The host HTML linter predates the report format

**Observed.** The final standalone founder review loaded cleanly in Chromium,
but the host's legacy `tidy` binary treated HTML5 elements such as `main` and
`section` as unknown and decoded UTF-8 punctuation as invalid bytes. Its exit
status described the validator's age, not the report rendered by users.

**Immediate handling.** Validate the actual product seam: render desktop and
mobile viewports in the repository's pinned Playwright runtime, assert no page
or console errors or horizontal overflow, and exercise the embedded comment
payload. All twenty review anchors initialized and the comment round-trip
passed.

**Opportunity.** Standalone HTML artifacts should have one repository-owned
HTML5/browser smoke command. Do not combine an obsolete SGML-era linter with a
modern browser check and count the former's format mismatch as product risk.

### 2026-07-19 - Visual report QA did not prove accessibility

**Observed.** Desktop/mobile rendering, zero console errors, contained
overflow, and a working comment round-trip still missed six accessibility
defects: a stale anchor count, two text-rich flows flattened behind `role=img`,
mobile table headers removed from the accessibility tree, insufficient
light-theme accent contrast, a skipped heading level, and a selection-comment
trigger exposed only after mouse interaction.

**Immediate handling.** Treat the independent artifact review as a distinct
evidence seam. Restore semantic tables inside scroll containers, keep flow text
as ordinary readable descendants, darken the light accent, repair the heading
outline, and capture Shift+Arrow keyboard selection. Rerun responsive browser,
comment-payload, and independent accessibility review on the amended file.

**Opportunity.** The founder-review template should ship automated semantic,
contrast, heading-outline, and keyboard-selection checks alongside visual
screenshots. “Looks correct” and “loads without errors” are necessary evidence,
not accessibility proof.

### 2026-07-19 - The retro index is a shared append-only hotspot

**Observed.** Final docs reconciliation needs to index this program in
`docs/retros/README.md`; open ready PR #299 also adds one older retro to the
same list. Its patch is a disjoint entry, not ownership of this program, but
both delivery trains mutate a shared hand-maintained index.

**Immediate handling.** Inspect #299's exact patch before editing, keep this
change to two additive entries, and re-derive mergeability immediately before
the docs merge. Do not alter or absorb #299's pairing retro.

**Opportunity.** Append-only artifact catalogs should be generated from file
metadata or split into independently owned fragments. A central Markdown list
turns unrelated documentation closeouts into avoidable coordination points.

### 2026-07-19 - An owned simplification needed a comment, not a competing ticket

**Observed.** The second-pass similarity audit found that the two rich-Card
performance drivers share most of their harness. The duplication is obvious,
but rich-Card performance remains active under #533 and related work. A new
ticket would split ownership and could cause a well-meant refactor to invalidate
performance evidence while that evidence is still changing.

**Immediate handling.** Exclude the files from this program and leave the
parameterized-runner recommendation as a non-blocking comment on #533. The
existing owner can absorb it when safe or leave it until the active work closes.

**Opportunity.** The ticket-first rule needs an owned-work corollary: when an
obvious cleanup sits inside an active issue, prefer one precise issue comment
over either silence or duplicate tracking. Ownership remains singular while the
observation is not lost.

### 2026-07-19 - Tracker mutations had two unequal delivery paths

**Observed.** The connected GitHub mutation path returned a 404 while publishing
the second-pass orphan-snapshot ticket and again while opening #621's pull
request. The authenticated repository CLI created both successfully, after
which normal tracker reads confirmed their identities and state.

**Immediate handling.** Treat the connector failure as transport friction, use
the already-authenticated CLI fallback, and verify the created issue before
dispatch. No candidate or acceptance criterion changed because of the fallback.

**Opportunity.** Tracker integrations should expose repository-resolution and
authorization failures distinctly from a missing endpoint. Orchestrators should
retain one verified fallback so issue and pull-request policy do not become
dependent on a single transport.

**Fourth-pass recurrence.** A connector-first read returned a false 404 for
accessible security issue #466 while qualifying the model-refresh finding.
Authenticated `gh` immediately returned the issue. The failed read was treated
as no evidence—not as “unowned”—and the CLI result supplied the semantic owner
that stopped #636 before any edit. The same connector later returned 404 while
creating #638's draft PR; authenticated `gh` published PR #639 from the already
pushed branch, and a tracker read verified the resulting identity.

**Fifth-pass recurrence.** The connector again returned a false 404 while
creating #622's draft PR after its branch was already pushed. Authenticated
`gh` published PR #643, and a read-back verified its exact base, head, draft
state, closing issue, and clean remote branch. No implementation or tracker
scope changed.

### 2026-07-19 - The budget reader failed its own high-volume target

**Observed.** The pre-merge `ci:budget` guard failed closed three times because
its complete Actions-run pagination crossed the 30-second subprocess ceiling.
A fresh complete 14-page run capture let the canonical estimator advance, but
sequential per-run job enumeration made 516 provider calls and reached the
five-minute overall deadline. Direct GitHub identity, rate-limit, and repository
reads were healthy; the authoritative billing endpoint instead requires an
additional user credential scope.

**Immediate handling.** Hold all merges while the budget is `UNKNOWN`. Use the
policy-authorized native-equivalent path with the same complete run inventory,
repository pricing and validation functions, 30-second request ceiling, and
five-minute overall ceiling, but twelve bounded concurrent job readers. That
complete conservative read covered 1,205 current-month runs and 1,271 billable
jobs: 2,719 rounded minutes and $18.63 gross spend with no included minutes
deducted, a `GREEN` result. Record the scaling defect on existing burn-in issue
[#431](https://github.com/limweili/eido/issues/431#issuecomment-5013665468).

**Opportunity.** A high-volume safety guard must remain usable at its declared
volume. Preserve fail-closed coverage, duplicate, timestamp, label, and deadline
checks, but replace one-process-per-run sequential enumeration with a bounded
batch or concurrent aggregate owned by the DevOps burn-in lane.

**Third-pass recurrence.** The canonical guard again passed toolchain policy
but failed closed when its first `gh` subprocess reached the 30-second ceiling.
The same policy-authorized, twelve-reader native equivalent then completed a
fresh, fully validated inventory in 54.7 seconds: 1,246 current-month runs,
1,315 billable jobs, 2,842 rounded minutes, and $19.56 conservative gross spend
with no included minutes deducted. The result remained `GREEN`; no merge began
while the guard was `UNKNOWN`. This larger sample reinforces the existing #431
diagnosis, so it is evidence for that owner rather than a new refactor ticket.

**Fourth-pass recurrence.** Before PRs #639/#640, the canonical guard again
passed toolchain policy but returned `UNKNOWN` when its first `gh` process hit
30 seconds. The merge train remained frozen. The same complete, bounded
twelve-reader equivalent validated 15 run pages, 1,296 current-month runs,
1,365 billable jobs, 2,986 rounded minutes, and $20.428 conservative gross
spend in 65.6 seconds, deducting no included minutes. The result was `GREEN`;
the token still lacks the billing API's `user` scope. This is another sample
for #431's existing reader-scaling owner, not permission for a competing patch.

### 2026-07-19 - Known worktree verification friction recurred

**Observed.** The deletion-only #620 lane again found no dependency tree in its
isolated worktree. A generic dependency locator hung for more than 55 seconds,
ambient Node 24 violated the pinned Node 22 contract, a direct Vitest root flag
retained the wrong current directory, and macOS `/var` versus `/private/var`
temporary-path spelling produced sixteen false failures until the scratch path
was canonicalized.

**Immediate handling.** Use the repository launcher, install only in the
isolated lane, run from the worktree itself, and canonicalize its synthetic
temporary directory. The resulting focused suite passed 105/105, the full suite
1,867/1,867, and typecheck passed; no private save was read.

**Opportunity.** The earlier startup lesson remains unimplemented operationally:
dispatch should make pinned-toolchain bootstrap, exact worktree cwd, and a
canonical synthetic temp root explicit preconditions rather than rediscovered
recovery steps.

**Third-pass recurrence.** The #629 lane again started under ambient Node 24 and
npm 11 while repository policy requires Node 22.23.1 and npm 10.9.8; generic
workspace dependency discovery then ran for more than a minute without yielding.
The pinned npm-exec launcher restored the intended toolchain. Its full suite
passed 1,861 product tests, but seventeen Electron harness cases compared the
same `/var` and `/private/var` paths textually and failed; the two directly
affected behavior suites passed 12/12 from the canonical worktree path. This is
the same known harness alias, so it changes neither #629's product verdict nor
its ownership disposition.

**Fourth-pass recurrence.** #638's bundled runtime lookup again hung before
yielding a usable toolchain. The lane switched to the exact pinned Node
22.23.1/npm 10.9.8 path, then proved 10/10 focused tests, typecheck, and a full
1,908-pass/17-known-alias inventory identical to clean `303b498a`. The repeated
startup cost remains orchestration debt, not evidence against the refactor.

### 2026-07-19 - Founder-report browser bootstrap failed before page load

**Observed.** The preferred browser client failed twice during runtime setup
with `Cannot redefine property: process`; it never opened or evaluated the
report. The troubleshooting service was unavailable because setup failed before
creating its browser agent. This is absent browser capability, not a report
render verdict.

**Immediate handling.** Do not infer a browser pass and do not keep resetting
the same failed runtime. The report's CSS, comment engine, schema, and stable
anchors were unchanged; updates were content-only. Run proportional static
proof instead: unique IDs, 20 labeled review anchors, balanced disclosure/table
structure, valid embedded comment JSON, required final evidence, zero
whitespace errors, comment extraction, and opening the standalone file all
passed. Interactive browser proof remains inherited from the unchanged shell.

**Opportunity.** Browser-client bootstrap needs compatibility coverage against
the current persistent Node runtime, and its setup failure should still expose
troubleshooting documentation without requiring a successfully created agent.

### 2026-07-19 - A zsh loop variable shadowed the executable search path

**Observed.** A read-only cleanup preflight used `path` as its loop variable.
In zsh, lowercase `path` is tied to `PATH`, so the first assignment replaced the
executable search list and each intended `git status` check stopped at
`command not found`. No worktree or branch was changed.

**Immediate handling.** Treat the failed command as no evidence, switch to the
task-specific `wt_dir` name, and rerun cleanliness checks before removing only
the four landed implementation worktrees.

**Opportunity.** Shell snippets should avoid zsh's tied parameter names as well
as conventional uppercase environment variables; task-specific names make the
target and mutation scope easier to audit.

### 2026-07-19 - The ready transition repeated proof for an unchanged SHA

**Observed.** After both independent reviews and the hosted Required gate passed
on exact head `5d936d26`, changing PR #645 from draft to ready enqueued the same
Required workflow again for that unchanged commit and temporarily changed the
merge state from clean to unstable.

**Immediate handling.** Reuse the completed exact-SHA proof as authoritative
evidence, avoid manufacturing another local gate, and let branch protection's
duplicate hosted run finish. This retro append now changes the head, so its own
new exact-SHA gate and narrow review refresh replace both earlier runs.

**Opportunity.** Required workflows triggered by both synchronization and ready
events should deduplicate identical commit SHAs, or branch protection should
accept an existing successful check with the same name and evidence identity.

## Fourth/fifth-pass close-out synthesis

The founder-authorized continuation qualified two genuinely unowned fourth-pass
opportunities, ticketed them before implementation, and landed both. PR #640
made one indexed graph authority decide connection rejection, ADR 0017
orientation, directional dedupe, source role, and Ask-to-Ask Result routing for
both canvas preview and store mutation. PR #639 made one overlay-local selector
serve both focus adapters. Independent review materially improved #640 before
landing: the first planner failed the deletion test, the second lacked a direct
store reverse-direction proof, and the third still entrenched raw-array scans
on the connect-drag hot path. The final seam is net -1 production LOC and uses
only cached `BoardGraphIndex` reads.

The fifth pass then spent spare budget on the earlier lower-half #622 ticket and
one newly qualified ticket, #642. PR #643 replaced the duplicated theme/motion
media-query lifecycle for net -18 production LOC. PR #644 deleted exactly 20
unreachable shared-copy entries with no additions, caller changes, literal
replacements, or new abstraction. All four continuation PRs received separate
Standards and Spec review on their final heads, hosted Required proof, serial
merge, exact-main Required proof, and SHA-bound release artifacts. Their
production patches remove 47 net lines; GitHub's whole-PR statistics include
#640's added regression tests and therefore record 175 additions / 212
deletions, or 37 net lines removed.

Ownership stayed singular. Ten fourth-pass findings were routed to #466, #545,
PR #443, #531, #520, #354, #525, #598, and #279 rather than patched. The fifth
pass added Profile-test and boundary recommendations to #520, fake-provider
harness evidence to #414, packaged-proof plumbing to #528, and a stronger
19-suite reset inventory to its existing #598 owner. The apparent #636 model
refresh ticket was closed before any edit when independent review found the
broader #466 security boundary. Rich-Card/cached-passive performance, private
saves, active persistence, and all other open-issue/draft-PR behavior remained
untouched.

Across the complete program, the exact landed PR inventory is #608, #609, #610,
#611, #613, #614, #615, #616, #623, #625, #631, #633, #639, #640, #643, and
#644: **542 additions / 39,251 deletions, or 38,709 net lines removed across 16
PRs**, plus the separately measured 2,084,960-byte binary deletion in #631.

The bounded stop condition is met again. Every material fifth-pass candidate
has an explicit implementation, owner, exclusion, or rejection disposition;
both current unowned candidates and the only worthwhile deferred ticket are
closed and exact-main green; no remaining unowned candidate plausibly outranks
the delivered top half; and the surviving micro-cleanups would cost more in
proof, interface ceremony, or active-owner coordination than they remove.

## Third-pass close-out synthesis

The third bounded audit qualified seven new opportunities after treating every
earlier candidate as already explored. Two were genuinely unowned: #628 and
#629. Both received tickets before implementation and landed through isolated
worktrees, strict deletion gates, independent Standards and Spec review, hosted
PR gates, serial merges, exact-main Required gates, and SHA-bound release
artifacts. Five higher-collision opportunities were returned to their live
owners as precise comments instead of competing patches: semantic undo on #276,
Version provenance on #562, design mirrors on draft PR #443, the shared image
adapter on #247, and cross-runtime skill mirrors on PR #299.

PR #631 removed a byte-identical 2,084,960-byte PNG while retaining the
documented original and changing no runtime lines. PR #633 centralized the two
compatible Highlight Tag deletion flows for **5 net production lines removed**.
Combined with the original program and second pass, final GitHub PR statistics
record **38,672 net lines removed across twelve landed refactors**, plus the
2.08 MB exact binary deletion that line counts do not represent.

Behavior and ownership remained fixed. #633 preserved the occupied-tag danger
dialog, cancel path, single deletion, tray-close-on-success rule, and panel
stay-open rule. No saved-data, security, external-contract, rich-Card,
cached-passive, persistence, image-migration, or other owned behavior changed.
The full current-month Actions inventory remained conservatively `GREEN` at
$19.56 gross before the train; neither merge began while the canonical reader's
known scaling defect left budget state `UNKNOWN`.

At the third-pass checkpoint, the stop condition was met for a third time: all
seven new findings had explicit dispositions; both unowned candidates were
landed, closed, and exact-main green; all five owned findings were recorded with
their current owners; and rejected shallow helpers failed the deletion or
semantic-equivalence test. Lower-half #622 was then the only earlier deferred
ticket and could not delay stronger product work; the fourth/fifth synthesis
above records its later deletion-test pass and landing.

## Second-pass close-out synthesis

The marginal audit qualified three unowned candidates. Risk-adjusted ranking
put #620 and #621 in the top half; both landed through isolated worktrees,
focused and full behavior proof, independent Standards and Spec review, hosted
PR gates, exact-main Required gates, and SHA-bound release artifacts. #622 is a
lower-half ticket with an explicit deletion test and must not delay the stronger
work.

The second pass removed 21,742 lines through #623 and added 25 net lines through
#625, for **21,717 net lines removed**. The latter deliberately spends 21 test
lines and four production lines to put one Output-version domain rule behind a
single read-only graph interface; its value is six eliminated drift points, not
a misleading net-deletion claim. Combined with the original program, GitHub PR
statistics now record **38,667 net lines removed** across ten landed refactors.

Active ownership remained singular. Rich-Card performance, Timeline Projector,
graph-store test reset, and the final #255 digest adapter recommendation were
recorded as comments on their existing issues rather than competing tickets or
patches. No rich-Card performance, cached-passive, timeline, persistence,
provenance, private-save, or other owned path was changed.

The stop condition is met again: every second-pass candidate has an explicit
disposition; the complete top half is landed and exact-main green; the only
unowned lower-half item is ticketed; owned opportunities are returned to their
current owners; and no remaining unowned candidate plausibly outranks the work
completed. Another scan would now cost more coordination and proof than its
expected simplification value.

## Original close-out synthesis

### Outcome

The program reviewed all ten material areas, qualified eight unowned
opportunities, created a ticket before implementing each one, and landed all
eight through independently reviewed pull requests. Implementation `main` is
reconciled through `f2a9bad8`.

GitHub's final PR statistics record 287 inserted lines and 17,237 deleted lines:
**16,950 net lines removed**. The top-ranked half produced 16,670 of those net
deletions, led by contracting the terminally rejected content-visibility
architecture. The lower half removed another 280 net lines and narrowed the
Canvas, brain, and graph-store interfaces without delaying top-half delivery.

Every hosted Required gate passed. Browser gates passed where the changed seam
carried one. Each branch received separate Standards and Spec review, and every
squash-merged tree was compared with its reviewed head. Focused behavior,
typecheck, build, design, bundle, CI-policy, and full-suite comparison evidence
was selected in proportion to each change's risk. No private save was accessed.

### Definition of done

- Every material code area has a source-grounded purpose and disposition in
  the ledger and founder review.
- Every qualified unowned candidate landed; all eight program issues are
  closed and all eight linked PRs are merged.
- The top four landed before lower-ranked integration consumed the merge
  budget, and no remaining unowned candidate plausibly outranks them.
- Already-owned persistence, lifecycle, provenance, image, and release work
  remained untouched. Cached-passive behavior and decisions also remained
  untouched; #597 changed only compatibility fallout from deleting its sibling
  flag. Earned renderer, runner, cache, security, and cancellation complexity
  remained intact.
- The repeated fifteen-test macOS path-alias inventory stayed identical across
  unrelated lanes and belongs to the excluded persistence/security ownership
  area, not to any simplification patch.
- Further candidates offered less expected value than their behavior risk,
  evidence cost, or ownership collision. The marginal-value stop condition is
  therefore met.

### What worked

- Risk ranking made the delivery order unambiguous: delete a rejected
  architecture first, then deepen hot or high-fan-out seams, then spend spare
  budget on small local consolidations.
- Ticket-first qualification plus repeated live ownership checks prevented the
  program from duplicating #533, #598, #599, #612, or the wider #520 train.
- Separate implementation worktrees kept the Graph, Canvas, and brain lanes
  independent. Serializing the two `store.ts` changes avoided artificial
  conflicts while still allowing review and CI to overlap.
- Stable patch IDs, range-diffs, exact merge bases, and landed-tree comparison
  let review evidence survive unrelated `main` advances without pretending an
  old base was current.
- The user-supplied live-retro, ownership-exclusion, risk-ranking, and explicit
  done rules materially improved scope control and convergence.

### What should improve

- Architecture selection should have retired losing executable paths when ADR
  0023 closed. Leaving them live created most of this program's deletion work.
- The initial #597 envelope should have included the global workflow inventory;
  hosted CI found the stale count after narrower workflow checks passed.
- Review capacity should be reserved centrally at dispatch. Nested fan-out
  briefly made review order depend on the four-agent ceiling.
- Worktree startup should prove the canonical toolchain and graph transport
  immediately. Agents lost time discovering missing dependencies or falling
  back from codebase-memory after implementation had begun.
- Runner ownership should be explicit enough that a browser test cannot be
  accidentally forwarded to Vitest by a focused filename search.

### Adoptable rules

1. Close every architecture-selection epic with an executable retire list:
   flags, branches, CSS, tests, evidence builders, reports, workflows, and
   policy inventories.
2. Treat open-issue and draft-PR ownership as a live qualification gate, not a
   kickoff snapshot.
3. Give every open-ended cleanup program a ranked opportunity ledger and a
   marginal-value stop rule before implementation starts.
4. Bootstrap isolated worktrees with the repository-owned launcher first, and
   health-check structural discovery before delegating source investigation.
5. Reserve independent review slots centrally; builders report readiness and
   reviewers do not race for capacity.
6. After every base advance, prove patch identity, rerun only invalidated
   evidence, and compare the landed tree to the reviewed tree.
7. When deleting a workflow or experimental path, search every global policy
   inventory in addition to the feature-named proof.

## Lineage

This program follows the
[2026-07-14 Epic #410 rich-Card rendering architecture retro](../2026-07-14-epic-410-rich-card-rendering/RETRO.md).
That epic selected buffered rich DOM and terminally rejected content visibility
and cached-passive Cards; this review contracted the unowned executable residue
of that decision while leaving the still-owned cached-passive behavior and
evidence policy to #533.
