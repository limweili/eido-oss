# Live retro — Epic #491: App-wide design-system delivery

Canonical epic: [#491](https://github.com/limweili/eido/issues/491)
Approved design-system source: [PR #445](https://github.com/limweili/eido/pull/445)
Delivery-process reset: [PR #541](https://github.com/limweili/eido/pull/541) and
[PR #542](https://github.com/limweili/eido/pull/542)

> **CLOSED RETRO — epic #491 is complete.** This file records observed
> outcomes, friction, decisions, and open questions. Mutable delivery state
> below is a dated snapshot, not a source of truth. Re-derive PR, issue, branch,
> and CI state before acting.

The retro is deliberately separate from implementation coordination. It lives
on its own branch and worktree, and it does not use `.multy` as an input or
state store.

## Why this epic exists

PR #445 established an approved design system, but the running app still mixed
raw values, native controls, duplicate typography recipes, light-only painted
chrome, and inconsistent overlay and interaction grammar. Epic #491 is meant to
make the design system architectural: one token authority, one primitive and
overlay vocabulary, role-owning components, coherent canvas/DOM rendering, and
drift resistance across the whole app.

The enduring product and safety truths are:

- preserve Eido's graph, semantic-context, execution, and saved-board behavior
  unless #491 explicitly approves a functional change;
- treat card and tag colours forward-only—new choices use the new identity
  system, while old raw values are neither migrated nor treated as a visual
  compatibility target;
- never use the private Eido save as development or validation material;
- preserve focus ownership, accessible roles, responsive composition, and
  interaction intent while presentation changes;
- finish as one coherent app, not a collection of individually restyled pages.

## Snapshot — 2026-07-18 AEST

This is orientation for the retro reviewer only.

| Area | Observed state |
| --- | --- |
| Process baseline | PR #542 is landed at `97518985`; the clean orchestration checkout rebased to that exact `origin/main` commit without conflict |
| Integration | `codex/491-design-integration` at `1e69b546` after #509 landed |
| Completed child slices | 16 of 18: #492, #496, #497, #494, #495, #498, #499, #501, #500, #506, #502, #503, #505, #504, #508, #509 |
| #503 Mod controls | landed at `ad26a8b2`; Required repair preserved reviewed tree `15dda36c` |
| #505 prose | landed at `d97d6fd4`; reviewed tree `fbd21071`, Required and Browser green |
| #504 AI/version chrome | PR #563 landed as `6c538882`; reviewed tree `894edf3a`, Required and Browser green |
| #508 overlays/context rows | PR #566 landed as `8948a410`; reviewed tree `e14f1c58`, Required green, optional Browser red classified |
| #509 playback transport | PR #568 landed as `1e69b546`; reviewed tree `8987914a`, Required green, optional Browser red classified |
| Active product tail | #507 began from exact integration `1e69b546`, then #510; no #507 outcome claimed here |
| External release dependencies | #408 and #410 remain open; #409 sequencing remains relevant to terminal certification |
| Data boundary | private save untouched; scratch-only evidence where a rendered app was genuinely needed |

### Closure addendum — #507 (recorded 2026-07-19 AEST)

This addendum advances the historical snapshot above without rewriting it.

| Area | Exact closure fact |
| --- | --- |
| Landing | [PR #575](https://github.com/limweili/eido/pull/575) squash-landed on the integration branch as `97fa4424b5d122c9d825e80f28229bf918040be1`, with parent `1e69b546ad31f26f0c2dddc7937b987178c3bfcf` and tree `8efce129214f804846f98886e02b06356ed2223c` |
| Reviewed source | The landed tree is byte-identical to preserved source head `c13fb70c53c3da39e029e9bad3183bffb82a6e92`; package-lock and private save data remained untouched |
| Exact Required | [Run 29649899040](https://github.com/limweili/eido/actions/runs/29649899040) passed 69/69 CI-tool tests, 39 design-system evidence records, type-check/build, the 419.9/450 KiB gzip budget, and 2,155 behavior tests across 168 files |
| Hosted browser | [PR smoke](https://github.com/limweili/eido/actions/runs/29649446675) and the requested [four-shard full canary](https://github.com/limweili/eido/actions/runs/29649469577) both ran at exact source head `c13fb70c`; their optional failures were investigated and classified rather than blindly waived or rerun |
| Closure record | [Issue #507 evidence comment](https://github.com/limweili/eido/issues/507#issuecomment-5011815592) records the exact lineage, gate, exemption ledger, browser disposition, reviews, and residual risk |
| Epic frontier | #507 is complete, making 17 of 18 design slices integrated. Main independently advanced to `02ebc589b4cfe77af0beb14a40c221ff7ab9ac03`; #510 must re-derive live integration, main, and dependency state before certification |

### Renderer production addendum — #555 and #554 (recorded 2026-07-19 AEST)

This addendum records the first two renderer-production slices on main without
rewriting the earlier design-integration snapshot.

| Area | Exact closure fact |
| --- | --- |
| Image renditions (#555) | [PR #581](https://github.com/limweili/eido/pull/581) landed source head `04003baf` on main as `cc2f9a80`. [Exact PR-head Required](https://github.com/limweili/eido/actions/runs/29652214024) and [exact landed-main Required](https://github.com/limweili/eido/actions/runs/29652865146) passed; the bounded Codex 5.6 Sol [Standards + Spec review](https://github.com/limweili/eido/pull/581#issuecomment-5012105046) passed with no blocker. |
| Bounded Reading residency (#554) | [PR #582](https://github.com/limweili/eido/pull/582) landed repaired source head `2a481600` on main as `ccd54bca`. [Exact PR-head Required](https://github.com/limweili/eido/actions/runs/29653306993) and [exact landed-main Required](https://github.com/limweili/eido/actions/runs/29653399237) passed. Four obsolete whole-Board value-dump snapshot groups and their large generated entries were retired because direct invariants already owned the behavior and refreshing them would have made proof exceed the product change. |
| Red and review disposition | The initial #554 Required red was a stale lexical pin for the deliberately retired `strictResidencyCandidate` name; it was deleted without a replacement regex. The first Sol review separately found a real authority defect: exported `P`/`S` still described planner candidates when Reading mounted nothing. The repair exports actual mounted editable `P`, derives `S = V − P`, and keeps hysteresis in a separate internal history set. A bounded [closure verifier](https://github.com/limweili/eido/pull/582#issuecomment-5012162454) resolved the finding. |
| CI economy | Redundant ready-for-review replacement runs were cancelled once current exact-head proof was already green. Optional browser canaries remained visible evidence but were not promoted into unrelated delivery gates. |

## What has gone well

### Foundations were landed before consumers

The epic first established stylesheet ownership, token/painter authority,
primitives, overlays, theme/reduced motion, card identity, and app chrome. That
made later lanes choose roles and shared behavior instead of inventing another
local dialect.

### Independent review caught product and architectural defects

The highest-value reviews were not cosmetic audits:

- #500 exposed live resize frames whose painted connections detached from the
  card and forced a bounded hot-geometry seam instead of accepting visual lag;
- #506 caught nested Escape ownership, editable-key capture, focus return,
  contrast, and responsive panel geometry;
- #502 caught a whole-wire hover path that walked every visible adjacency
  bucket on pointer animation frames despite a nominal connection cap;
- #503 caught interactive micro/caps typography, undersized/coarse-pointer hit
  areas, immediate editor unmount, and a shared Tooltip change tested only
  through an oversized consumer suite.

These findings justify exact Standards and Spec review at meaningful stable
boundaries. They do not justify repeating every earlier gate after a
mechanically identical lineage change.

### Continuous landing reduced speculative stacking

The merge captain landed ready work one change at a time into the integration
branch and verified the shared target before the next mutation. #506 landed at
`3d023105` with its reviewed tree preserved exactly. Main stayed unchanged.

### Data safety remained explicit

Colour work was kept forward-only, storage formats were not changed, and visual
checks used synthetic scratch saves after verifying the served data path.
Private user data was never needed to prove this design migration.

### Founder feedback changed the run immediately

The owner identified that Computer Use, Playwright, and test creation had become
a throughput bottleneck. The run changed course before closeout: evidence is
now chosen by material uncertainty, existing proof is reused, visual inspection
is perceptual rather than behavioral, and broad matrices are removed when a
stronger seam or composed journey covers the same regression.

## Friction ledger

### 2026-07-17 · The original delivery method became the work

- **Symptom:** lanes accumulated large test matrices, repeated exact-head full
  gates, repeated browser journeys, screenshots, and Computer Use passes.
- **Impact:** validation capacity competed with implementation capacity and
  made safe mechanical refreshes feel like new feature deliveries.
- **Root cause:** delivery guidance encoded one successful harness/topology as a
  universal runbook; issue acceptance text also described evidence per consumer
  instead of claims at shared seams.
- **Correction:** owner feedback established frugal tests, causal Playwright,
  perceptual-only Computer Use, and evidence reuse across consumers.
- **Status:** corrected for the remaining run; old evidence remains historical.

### 2026-07-17 · Computer Use was treated as a broad acceptance oracle

- **Symptom:** visual sessions attempted to validate timing, drag feel, complex
  gesture choreography, and many theme/viewport combinations.
- **Impact:** slow feedback and false confidence risk: Computer Use can judge
  hierarchy and composition but is a poor oracle for timing and nuanced motion.
- **Root cause:** “visual work needs visual review” was expanded beyond the
  perceptual questions the tool can answer.
- **Correction:** reserve it for representative Light/Dark composition,
  responsive balance, palette appearance, playback identity, and terminal
  integrated coherence. Code, focused tests, or causal browser journeys own
  interaction semantics.
- **Status:** adopted.

### 2026-07-17 · Playwright evidence grew horizontally

- **Symptom:** consumer suites duplicated primitive state, contrast, theme, and
  responsive assertions; #503 alone added a 586-line Mod browser specimen.
- **Impact:** long test authoring and execution, more flakes, and review energy
  spent maintaining evidence machinery.
- **Root cause:** each lane tried to prove local completeness instead of
  inheriting authoritative shared-primitive proof.
- **Correction:** #503 removed 481 lines of duplicate matrix coverage, added one
  focused Tooltip seam test, and retained only distinct observed regressions:
  real range-pointer overlap/re-grab and one compact editor
  scroll/header/preview/exit journey.
- **Status:** repaired locally; exact review pending.

### 2026-07-18 · PR #541 changed the process while the epic was running

- **Symptom:** main advanced to `af48b520` with rewritten Epic Orchestration,
  Merge Captain, and the new Write Goal skill while product work continued on a
  separate integration branch.
- **Impact:** the active run could either keep an obsolete method or risk
  destabilizing product branches by rewriting them.
- **Root cause:** useful process evolution landed concurrently with a long epic.
- **Correction:** rebased only the clean orchestration worktree onto #541,
  left feature/integration history untouched, read the new core skills and Eido
  release adapter, and applied the principles to the remaining frontier.
- **Status:** resolved without product-branch churn.

### 2026-07-18 · The active goal mixed destination and mechanics

- **Symptom:** the goal named branch topology, orchestration tools, review
  choreography, and validation methods alongside the product outcome.
- **Impact:** a method change looked like a goal change, and procedural text
  could outrank learning from the run.
- **Root cause:** the goal had become a durable destination plus a live runbook.
- **Correction:** distill the durable compass to why, product/safety truths,
  observable done, owner boundary, and risk-led evidence philosophy. Keep
  changing mechanics in the live plan.
- **Status:** adopted; future goal rewrites should pass Write Goal's tool-swap,
  strategy-swap, completion, traceability, evidence, and compaction tests.

### 2026-07-18 · An optional browser red was initially noisy, not blocking

- **Symptom:** PR #540's hosted browser canary failed the inherited Picker
  opacity-transition probe while its Required gate and connection-specific
  causal evidence were green.
- **Impact:** a naive “all red blocks” policy would have launched another broad
  rerun/debug campaign unrelated to #502.
- **Root cause:** optional and required signals were not separated at the point
  of interpretation.
- **Correction:** classified the exact failure as an unchanged optional Picker
  probe, confirmed the #502 interaction claim still had direct proof, reported
  the red, and started no rerun campaign.
- **Status:** resolved for the landing decision; the unrelated probe remains an
  honest optional-signal concern.

### 2026-07-18 · Risk-led review still found a real #502 architecture defect

- **Symptom:** whole-wire hover invoked the general render-index query on each
  hover rAF. Its diagnostic contract continued after `maxConnections` to count
  every visible adjacency candidate; card discovery could also cover the whole
  board at Map zoom.
- **Impact:** pointer movement could trigger full-board work, violating the
  canvas-layer invariant even though behavioral tests passed.
- **Root cause:** a test proved one callback per rAF and identity-only React
  updates, but did not bound the work inside that callback.
- **Correction:** one red-capable tracer now covers prefix parity, bounded
  adjacency visits, and no render-index/card discovery inside the hover frame.
  The frame reads a precomputed graph/viewport-keyed prefix; cold diagnostics
  keep full omission counts.
- **Status:** repaired locally at `c256400d`; closure review pending.

### 2026-07-18 · #503 evidence covered many pixels but missed shared seams

- **Symptom:** the Mod lane had extensive theme/contrast/browser evidence, yet
  interactive text bypassed type roles, hit targets missed the contract,
  ModEditor skipped exit presence, and the global Tooltip change lacked a
  Tooltip-level regression.
- **Impact:** expensive evidence did not discriminate the most important
  standards failures.
- **Root cause:** proof was attached to the consumer specimen rather than the
  shared public seams and repository rules.
- **Correction:** repair type roles and hit boundaries at their owners, use
  shared exit presence, add the focused Tooltip test, and retain only distinct
  composed Mod journeys.
- **Status:** repaired locally at `fd3d50c`; exact review pending.

### 2026-07-18 · Ready-state CI repeated exact-head proof automatically

- **Symptom:** marking #506 ready spawned replacement Required and Browser runs
  despite green exact-head checks already existing.
- **Impact:** the merge paused on new unknown signals and consumed another CI
  round.
- **Root cause:** provider workflow behavior on draft-to-ready transition.
- **Correction:** merge captain treated new checks as unknown, froze mutation,
  and waited rather than launching compensation. Both passed; #506 then landed.
- **Status:** safe but worth reviewing: decide whether repository policy can
  avoid redundant ready-triggered work without weakening exact-head proof.

### 2026-07-18 · A shell interpolation mistake mangled two review comments

- **Symptom:** Markdown backticks embedded in a shell command were interpreted
  by zsh before `gh` posted the comments.
- **Impact:** PR #540 and #518 briefly contained malformed review text.
- **Root cause:** review bodies were interpolated into a shell command instead
  of passed as literal files.
- **Correction:** immediately replaced both comments with exact `--body-file`
  content and deleted the temporary files.
- **Status:** resolved; future multiline/Markdown GitHub writes use literal
  files or a non-shell structured API.

### 2026-07-18 · The coordination registry accumulated sediment

- **Symptom:** `.multy/registry.json` became large, stale in places, and mixed
  current ownership with extensive historical evidence.
- **Impact:** maintaining the cache consumed attention and risked competing with
  GitHub/Git as the actual sources of truth.
- **Root cause:** completed ownership and evidence were appended rather than
  archived; the registry inherited an older harness-centered process.
- **Correction:** owner directed the run to ignore `.multy` entirely under the
  new system-agnostic skills. Live facts are re-derived from Git, GitHub, CI,
  worktrees, and exact reviews; the retro is a separate committed artifact.
- **Status:** adopted from this entry forward.

### 2026-07-18 · Lean lane checks omitted a known cross-slice contract

- **Symptom:** #503 passed its focused Mod/Tooltip tests, typecheck, diff check,
  independent repair review, and hosted Browser, but exact-head Required failed
  `CardShell.styles.test.ts`.
- **Impact:** landing froze for another repair cycle. The failure mixed one real
  semantic regression (`.mod-control .val` lost Mod ink) with two stale source
  assertions (local `font-weight: 600` despite the shared `t-value` role, and a
  selector for a Mod `<label>` no current renderer emits).
- **Root cause:** the proportional local gate selected the directly edited Mod
  and Tooltip seams but omitted an existing downstream CardShell governance
  test that explicitly enumerated Mod roles. Separately, that governance test
  had drifted behind the new type-role architecture.
- **Correction:** restore semantic Mod ink and exact identity-soft ownership;
  keep weight in the SYSTEM-approved `t-value` role; delete only dead/stale
  assertions. Preserve the green hosted Browser result because this static CSS
  repair does not change pointer or timing behavior, then require a new
  exact-head Required run.
- **Lesson:** risk-led testing means following declared contract edges, not only
  testing the edited file. A small owning-seam set should include known
  governance consumers; Required remains the broad backstop, and its reds still
  need classification rather than automatic test appeasement.
- **Status:** resolved. Independent closure passed; replacement Required was
  green. Its automatically triggered Browser run failed only the unchanged
  Ask/Conversation Picker transition-start probe, while the same suite had
  passed on the immediately preceding head and the repair touched only Mod
  semantic CSS/test authority. The merge captain reported that optional red,
  reused the unchanged interaction proof, and landed reviewed tree `15dda36c`
  as integration `ad26a8b2` without a rerun campaign.

### 2026-07-18 · A browser tracer skipped the transition named by the spec

- **Symptom:** #505's prose geometry tracer waited for Open Sans before its first
  Reading measurement, so it could not fail when fallback dimensions were
  cached, the card went offscreen in Overview, and the font became ready while
  the card was unmounted.
- **Impact:** passive/editor typography looked aligned at the tested steady
  state, but stale footprints could still affect Overview bounds, connection
  endpoints, and hit geometry until remount.
- **Root cause:** the browser proof asserted the final appearance while
  normalizing away the causal ordering the issue explicitly named.
- **Correction:** retain one browser test, but make its single journey exercise
  fallback measurement → offscreen unmount → font-ready invalidation → remount
  and representative geometry. The implementation belongs to Board's
  event-driven measurement owner, with no per-card or per-frame work.
- **Lesson:** fewer browser tests must be more discriminating. When timing is
  causal, the test should control the transition instead of waiting it away.
- **Status:** resolved and landed. The RED timed out on the retained fallback
  footprint; the GREEN uses one O(1), event-driven Board cache invalidation at
  font readiness and normal ResizeObserver repopulation after remount. One
  causal journey then proved final Overview, connection-hover, and card-hit
  geometry. Required and Browser both passed at reviewed tree `fbd21071`, which
  landed as integration `d97d6fd4`.

### 2026-07-18 · #504's first consumer test repeated inherited proof

- **Symptom:** a proposed 525-line test repeated version-switcher, primitive,
  residency, transcript, runner, and store lifecycle matrices already owned by
  narrower seams.
- **Impact:** the proof was larger than the distinct integration risk and would
  have made future shared-contract changes expensive to interpret.
- **Correction:** trim it to 167 lines by reusing those owning-seam tests, then
  keep one composed seam for the Conversation, Group, dialog, and failure
  integration that is genuinely new in #504.
- **Lesson:** risk-led consumer tests attach to distinct consumer boundaries;
  they do not replay unchanged lifecycle matrices merely because a consumer
  composes those systems.
- **Status:** adopted and landed in PR #563. The focused composed test remained
  the consumer proof; unchanged owning seams and exact-head CI supplied the rest.

### 2026-07-18 · Lane width, not agent availability, stalled #504 execution

- **Symptom:** two broad slice-3B dispatches produced useful analysis but left
  the worktree clean instead of crossing into implementation.
- **Impact:** parallel capacity existed, yet the context and patch surface were
  wide enough that dispatch did not translate into commits.
- **Correction:** preserve the analysis, replace the clean stalled execution,
  and reslice it into narrower Conversation and Group patches. Both produced
  immediate parallel commits.
- **Lesson:** lane width and context load can be the real constraint. A clean
  stalled lane is cheap to replace losslessly when its findings are handed to
  smaller, independently committable slices.
- **Status:** adopted during active #504 implementation.

### 2026-07-18 · Source precedence prevented a backwards visual repair

- **Symptom:** independent Standards review initially requested visible speaker
  labels based on the older SYSTEM §8.5 conversation example.
- **Impact:** accepting the finding mechanically would have restored UI that the
  live #504 contract and living prototype explicitly replace with accessible
  side-and-shape differentiation.
- **Correction:** compare the sources at the disputed boundary, apply the more
  specific live issue and prototype direction, and ask the reviewer to
  reconcile the finding. The reviewer withdrew it.
- **Lesson:** independent review is evidence, not an authority shortcut. When
  sources appear to conflict, establish their scope and precedence before
  repairing code.
- **Status:** resolved before PR #563 landed; no backwards repair was made.

### 2026-07-18 · Stable broad proof was reused across narrow #504 closure

- **Symptom:** after local Required passed at stable #504 head `e503` (165 files,
  2,138 tests), two narrow closure findings remained.
- **Impact:** repeating the full local gate after each repair would have spent
  broad-suite time without adding evidence at the changed boundaries.
- **Correction:** prove each closure finding with focused affected-seam tests
  and reserve hosted exact-head CI for the combined current lineage.
- **Lesson:** a stable broad gate remains valid evidence for unchanged surfaces.
  Narrow repairs need discriminating local proof plus one exact-head backstop,
  not automatic replay of every earlier broad check.
- **Status:** resolved. Hosted Required and Browser both passed at exact feature
  head `df851682`; merge captain preserved reviewed tree `894edf3a` when it
  landed PR #563 as integration `6c538882` and closed #504 with evidence.

### 2026-07-18 · PR #542 made the adaptive process executable

- **Symptom:** the orchestration checkout still carried PR #541's process while
  main had advanced through PR #542 to `9751898514b8fa80541e21e2c303436e3575a063`.
- **Correction:** fetch `origin`, rebase the clean orchestration checkout to that
  exact commit, and leave active product lanes untouched. The rebase was
  conflict-free; the worktree remained clean and `package-lock.json` was
  unchanged.
- **Evidence:** the repository's exact declared Node `22.23.1` and npm `10.9.8`
  ran Required successfully: tooling 56/56, build/typecheck, 134 files and 1,922
  tests, with the bundle at 403.4 of 450 KiB gzip.
- **Lesson:** process refresh and product lineage are separate decisions. Apply
  the new adaptive, risk-led responsibilities immediately without destabilizing
  in-flight integration history.
- **Status:** adopted through #508. Focused lane evidence was reused, while one
  composed gate was reserved for the integrated boundary.

### 2026-07-18 · An unbounded reviewer became the throughput anti-pattern

- **Symptom:** the preferred Opus 4.8 helper could not authenticate because its
  OAuth session had expired. An evidence-equivalent native Codex 5.6 Sol review
  was used under the owner's explicit model constraint, but one Standards run
  consumed 213,176 tokens without producing a final verdict and was terminated.
- **Impact:** the review spent more compute and coordination capacity than the
  bounded #508 boundary justified.
- **Counter-evidence:** its paired Spec review did converge and found two
  actionable defects: Settings copy had drifted from the approved prototype,
  and a local fixed-height override defeated the shared 80vh overlay limit.
- **Correction:** independent review remains valuable, but each reviewer now
  needs an explicit scope, evidence inputs, output contract, and stopping/token
  budget. Helper limitations may use a named native fallback without weakening
  the review axis.
- **Status:** adopted; the useful Spec findings are being repaired and #508 is
  not yet complete at this point in the chronology.

### 2026-07-18 · #508 bounded review and proof around the changed boundary

- **Outcome:** PR #566 closed #508 and squash-landed only into the integration
  branch as `8948a410f59c341b33c892065932b2c0cd2029ec`, preserving exact reviewed
  tree `e14f1c58dfa15dc4eb601b331a4db83c03d0e5be`. Main remained unchanged.
- **Proportional proof:** the integrated overlay and ContextRow boundary used
  eight focused files with 34 tests plus one nested
  Group → Version → Escape → Confirm browser journey. Final exact-head
  [Required](https://github.com/limweili/eido/actions/runs/29643955887/job/88078899491)
  then passed 166 files and 2,146 tests, with the bundle at 419.8 of 450 KiB
  gzip.
- **Optional signal:** the hosted
  [Browser canary](https://github.com/limweili/eido/actions/runs/29643955866/job/88078899458)
  failed stale `.modal.peek` and `.context-item` selectors after the approved
  ModalShell and ContextRow migration; its other 11 tests passed. The drift was
  investigated, deferred to #507, and did not veto unrelated #508 work.
- **Review economy:** independent Codex 5.6 Sol Standards and Spec closure
  reviews both passed after receiving only the 9 KiB repair delta, using about
  7k tokens each. This corrected the earlier runaway full-workflow review while
  retaining independent exact-boundary scrutiny.
- **Lesson:** feed closure reviewers the changed evidence boundary, keep one
  current-head Required backstop, and classify optional canaries by causal
  relevance. More context and more tests are not stronger proof when they do
  not change the integration decision.
- **Status:** resolved and landed; #509 started from integration `8948a410`, but
  this record makes no claim about its outcome.

### 2026-07-18 · #509 kept localized transport proof proportional

- **Outcome:** PR #568 closed #509 and squash-landed only into the integration
  branch as `1e69b546ad31f26f0c2dddc7937b987178c3bfcf`, preserving exact reviewed
  tree `8987914a22de408a3318c1c0474a887624e9980b`. Main remained unchanged at
  `1447287e38246693a6ca5f0f010018704f6f5877`.
- **Proof:** exact local Required passed 35/35 tooling tests, build/typecheck,
  167 files and 2,148 tests, with the bundle at 420.0 of 450 KiB gzip. Hosted
  exact-head [Required](https://github.com/limweili/eido/actions/runs/29645101211/job/88081926463)
  also passed.
- **Review:** independent Standards and Spec axes passed. Standards review
  caused a focused accessibility repair: the visible event progress now exposes
  named `progressbar` semantics instead of leaving the count visually legible
  but semantically incomplete.
- **Evidence choice:** no local browser or Computer Use pass was repeated for a
  localized transport seam that preserved timing, camera, scrub, and projection
  machinery. Focused component and source evidence owned the change; terminal
  representative perception remains with #510.
- **Optional signal:** the hosted
  [Browser canary](https://github.com/limweili/eido/actions/runs/29645101228/job/88081925651)
  reached the already-classified stale `.modal.peek` selector from #508 after 11
  tests passed. #507 owns that selector convergence, so the unrelated optional
  red did not veto #509.
- **Capacity:** Actions spend was conservatively green at $11.56 of the $50
  budget before landing.
- **Status:** resolved and landed; #507 began from exact integration
  `1e69b546`, but this record makes no claim about its outcome.

### 2026-07-19 · #507 closed the app-wide migration at one integrated boundary

- **Outcome:** PR #575 completed #507 on the #491 integration branch as
  `97fa4424`, directly above `1e69b546`, while preserving reviewed tree
  `8efce129` and source head `c13fb70c` exactly. The source branch remains
  available rather than being destroyed during integration.
- **Required proof:** exact landed-SHA run `29649899040` was green: 69 tooling
  tests, 39 narrow design-authority evidence records, type-check/build,
  419.9 of 450 KiB gzip, and 2,155 behavior tests in 168 files. This was the
  broad composed proof; focused source-lane evidence was reused instead of
  replaying the same broad gate after every mechanical assembly step.
- **Accepted review repairs:** the production drift gate includes `.ts` as
  well as CSS/TSX authorities; Settings scope labels now use the shared
  hairline/no-fill scope Chip and shared keyboard-accessible Tooltip instead
  of local fill/colour styling and native `title`; and the reduced-motion
  deep-link target-ring duration now wins the production cascade. Each repair
  received focused affected-seam proof, while unchanged Tooltip and motion
  evidence remained reusable.
- **Hosted browser disposition:** smoke run `29649446675` and full four-shard
  canary `29649469577` both exercised exact head `c13fb70c`. Their five
  optional debts were source-grounded:
  1. Picker scoped a stale locator from the heading parent instead of the
     modal's `role=dialog`.
  2. The broad activation glob discovered a production-only fixture against
     an empty scratch save, while the dedicated production regression passed
     1/1 in the same hosted run.
  3. Reading wire geometry asserted a raw `5.5±0.05px` hosted fractional
     measurement even though #507 only symmetrically namespaced the unchanged
     11px handle owner and the failure artifact showed the wire attached.
  4. Edge-selection waiting timed out while its screenshot already showed all
     seeded nodes; #507 did not change that wait or mount path.
  5. The Overview silhouette probe still required `<150px`, predating the
     base branch's intentional 250px natural Card growth cap.
- **Process lesson:** optional red remained visible and was investigated, but
  did not become an unrelated veto. No redundant browser rerun was launched.
  A slow helper was stopped once it ceased producing decision value; completed
  independent proof and a bounded source-grounded fallback were retained.
  This is the adaptive process in practice: reuse evidence across slices that
  share a primitive, spend broad compute once at the consequential boundary,
  and preserve review capacity for unresolved risk.
- **Status:** #507 is complete. The remaining browser items are optional
  canary/test debt, not unproven #507 acceptance claims.

### 2026-07-19 · Renderer proof helpers became tripwires, while bounded review changed what shipped

- **Symptom:** auto-refreshing the #554 full-Board snapshots proposed a generated
  evidence diff larger than the residency implementation. Later, a closure
  helper invoked the bulky `code-review` skill despite receiving a bounded
  prompt and began expanding beyond the three-file repair boundary.
- **Correction:** retire the obsolete snapshot value dumps and retain their
  direct owning invariants. Interrupt the expanding helper once it stopped
  producing decision value, then use an evidence-equivalent native verifier
  over the three changed files and the one disputed `P`/`S` contract. Cancel
  redundant ready-state CI and let optional canaries keep their declared
  non-blocking status.
- **Lesson:** snapshot refreshers and review wrappers are proof-volume
  tripwires when their machinery rivals the product delta; stop and reslice to
  the smallest native check. Keep adversarial review where it can still change
  the shipping decision: the first bounded Sol review caught the real
  below-Reading representation-authority mismatch that focused tests and the
  stale lexical failure had not exposed.
- **Status:** adopted for the renderer train. #555 and #554 are landed on main
  with exact-head and landed-main Required proof; no replacement evidence
  apparatus was added.

## Open decision after #507 — #510 release semantics

[#510](https://github.com/limweili/eido/issues/510) remains the terminal
integration-certification slice, but its current contract still names any
production slices from now-closed [#409](https://github.com/limweili/eido/issues/409)
and packaged-target evidence that is also owned by open
[#471](https://github.com/limweili/eido/issues/471). Before #510 executes, the
orchestrator must re-derive state from integration `97fa4424`, main
`02ebc589`, and the live release issues, then decide whether #510 owns only
design-integration certification or composes one packaged proof cycle with
#471. That ownership/sequencing question is an open release decision. It does
not reopen or block completed #507.

## The evidence economy now in use

| Material claim | Authoritative proof | Reuse boundary |
| --- | --- | --- |
| Tokens, primitives, roles, overlays | Static review plus focused public-seam tests and required CI | Consumers inherit until the shared contract changes or they add a distinct boundary |
| Canvas interaction composition | A few causal journeys for resize/wire/focus plus bounded-work seam tests | Re-run only when hit/paint geometry, browser timing ownership, or the composed path changes |
| Prose/editor metrics | One loaded-font passive→editor tracer and one complete Markdown fixture | Named consumers inherit role proof; add a consumer case only for distinct layout behavior |
| Visual coherence | Representative Light/Dark and responsive review at meaningful combined heads | Not an oracle for timing, drag feel, or complex gesture correctness |
| Save/data safety | Static storage/save diff and scratch-only rendered evidence | Any persistence/schema/migration change invalidates this proof and requires the save-safety process |

Testing is sufficient when the highest-risk claims have direct discriminating
proof, representative composition is covered, lower-risk work is explained by
static reasoning or required CI, and another test would not change the decision
to integrate.

## Rules adopted for the rest of #491

1. Preserve the durable goal; adapt mechanics to live state and evidence.
2. Slice for coherent value and collision risk, not maximum agent count.
3. Give workers why-led contracts with owned/protected surfaces and proof to
   reuse.
4. Prove shared behavior once at its authoritative seam.
5. Keep regression coverage for observed failures, data safety, and interaction
   invariants; remove duplicate matrices before commit.
6. Use Playwright only when browser behavior is causal and one journey can
   answer the question.
7. Use Computer Use only for perceptual judgments code cannot settle.
8. Review Standards and Spec independently at meaningful stable boundaries;
   closure review covers the repair delta and affected context.
9. A mechanical lineage update gets lineage/affected-seam proof, not a full
   delivery replay.
10. Merge Captain re-derives readiness and performs one consequential mutation
    at a time.
11. Optional red evidence is investigated and reported without silently becoming
    a required veto.
12. Keep mutable run state out of the goal and keep the retro separate from
    implementation coordination.
13. Bound reviewer scope and compute explicitly; terminate a run that cannot
    produce its contracted verdict, while preserving useful evidence already
    returned by an independent axis.

## What we should review in the separate retro session

1. **When did validation first exceed decision value?** Identify the first
   commit/PR where a smaller seam or composed journey would have been enough.
2. **Which issue acceptance clauses should be rewritten?** Several still imply
   per-card, per-theme, per-viewport matrices that conflict with the adopted
   evidence economy.
3. **Could Standards review move earlier?** #503's type-role and hit-area findings
   were statically visible before its large browser suite existed.
4. **How should visual taste review be staged?** Decide which intermediate heads
   genuinely need perceptual review and what belongs only at terminal
   integration.
5. **Can draft-to-ready CI duplication be removed safely?** Preserve current-head
   truth without paying for identical replacement runs.
6. **What is the smallest recovery record after compaction?** GitHub/Git/CI are
   authoritative; determine whether a short committed run note is useful or if
   the live plan alone is enough.
7. **Should the old issue-level delivery contracts be amended now or only in the
   next epic template?** Avoid another layer of contradictory rules.
8. **Which findings are specific to #491 versus reusable process knowledge?** Put
   only cross-context responsibilities in core skills; keep Eido policy in the
   release profile and one-off incidents here.

## Early metrics worth preserving

- 18 child slices in the epic; 16 integrated by this snapshot.
- Independent review found multiple user-facing or architectural blockers before
  integration, including one pointer-frame complexity defect invisible to
  behavioral tests.
- #503's evidence reset removed 481 lines from one browser matrix while retaining
  the two distinct regression journeys.
- #506's final refresh and landing reused prior proof and required no local
  browser or Computer Use replay.
- Main remained untouched by this epic's runtime design slices through
  integration `1e69b546`; its external baseline advanced independently and is
  re-derived before every terminal decision.
- #507 brought the integration count to 17 of 18 at `97fa4424`; its exact
  landed-SHA Required proof covered 168 files and 2,155 tests, while five
  browser-canary failures were classified without a redundant rerun.
- The exact-toolchain process refresh at `97518985` passed 1,922 Required tests
  with the lockfile untouched; one unbounded Sol review consumed 213,176 tokens
  without a verdict, providing a concrete baseline for reviewer budgets.

These numbers are not productivity scores. They are evidence for discussing
where coordination, review, and validation created or consumed decision value.

## Source pointers

- [Epic #491](https://github.com/limweili/eido/issues/491)
- [Run-level delivery-process clarification](https://github.com/limweili/eido/issues/491#issuecomment-5010285980)
- [PR #541 — system-agnostic delivery skills](https://github.com/limweili/eido/pull/541)
- [PR #542 — adaptive, risk-led delivery guidance](https://github.com/limweili/eido/pull/542)
- [PR #517 / issue #506 landing](https://github.com/limweili/eido/pull/517)
- [PR #540 / #502 bounded-work review](https://github.com/limweili/eido/pull/540#issuecomment-5010313625)
- [PR #518 / #503 standards review](https://github.com/limweili/eido/pull/518#issuecomment-5010313624)
- [PR #547 / #505 prose and font-readiness delivery](https://github.com/limweili/eido/pull/547)
- [PR #563 / #504 AI and version chrome delivery](https://github.com/limweili/eido/pull/563)
- [PR #566 / #508 overlays and shared context-row delivery](https://github.com/limweili/eido/pull/566)
- [PR #568 / #509 playback-transport delivery](https://github.com/limweili/eido/pull/568)
- [PR #575 / #507 app-wide design-system convergence](https://github.com/limweili/eido/pull/575)
- [#507 exact closure evidence](https://github.com/limweili/eido/issues/507#issuecomment-5011815592)
- [#510 terminal design-integration certification](https://github.com/limweili/eido/issues/510)
- [#471 packaged-target combined certification](https://github.com/limweili/eido/issues/471)
- [Design-system rule book](../../../design/design-system/SYSTEM.md)
- [Eido release profile](../../../agents/release-profile.md)

## Maintenance contract

Append or amend this living retro only when a new event changes a lesson,
decision, outcome, or open question. Do not mirror routine task status. At epic
close, add a final synthesis with shipped outcomes, residual risks, adopted
rules, and links to the exact landed/main proof.

### 2026-07-19 · ADR 0028 reset stale evidence and dependency assumptions

- **Process update:** owner feedback is now durable in ADR 0028 and the
  repository Evidence philosophy: proof is proportional to consequence, reused
  across unchanged authoritative seams, and stopped when more evidence cannot
  change the next action. Fixed per-slice test matrices, repeated local broad
  gates, and second-generation validators are retired ceremony, not hidden
  acceptance requirements.
- **Preserved rebase:** the root orchestration checkout, #553 worktree, and this
  dedicated retro worktree were preserved and rebased onto exact main
  `6f1ae400e281fed1cded4b0bdafc98a072ff5b42`. The retro replayed its existing
  history. Its only conflict was mechanical in `docs/retros/README.md`; the
  resolution kept main's current index and the living-retro registration. No
  product, package/lock, storage, private-save, or `.multy` state was involved.
- **Evidence economy:** exact-main
  [Required run 29650888038](https://github.com/limweili/eido/actions/runs/29650888038/job/88096917631)
  passed at `6f1ae400`. That current proof was reused instead of running another
  local broad gate for a history-preserving rebase and retro-only edit.
- **Live re-derivation:** current source already makes `createBoardScene`
  pointer-cold, composes Live owners and bounded `G ≤ 2` downstream, and exposes
  the relevant counters and existing LOD/hit/painter/digest proof. This
  invalidated the old assumption that #553 required a new validator, harness,
  benchmark, browser journey, or duplicated authority test. It also invalidated
  the assumed #553 → #555 mechanism: the image-rendition resolver and its
  authoritative export/AI consumers are an independent source seam, so #555 can
  proceed alongside residency work once collision ownership is clear.
- **Tracker amendments:** the live records now carry the
  [#491 ADR 0028 delivery amendment](https://github.com/limweili/eido/issues/491#issuecomment-5011941640),
  [#570 renderer evidence amendment](https://github.com/limweili/eido/issues/570#issuecomment-5011942482),
  and [#510 certification ownership amendment](https://github.com/limweili/eido/issues/510#issuecomment-5011943920).
  They preserve product and safety outcomes while retiring evidence mechanics
  that no longer discriminate the shipping decision.
- **Resolved release ownership:** the earlier open #510/#471 question is no
  longer open. #510 owns exact combined source/design integration, including
  representative font, theme, token/painter, accessibility, and geometry
  proof. #471 owns actual macOS arm64 and Windows x64 packaged-runtime
  certification on the identical source SHA and #528 artifact set. A rebuild
  still invalidates packaged evidence; #510 no longer duplicates it before it
  can unblock #471.
- **Lesson:** implementation evidence can show that planned work already exists
  or that a dependency edge has no mechanism. The correct response is to
  reslice, amend, or close with traceable existing proof—not manufacture a
  no-op product change or PR to satisfy the old plan. #553 remains open while
  its smallest evidence delta and issue disposition are completed; this entry
  does not claim closure.

### 2026-07-19 · #556 and #560 established the shared pending-rendition boundary

- **Landings:** [PR #583](https://github.com/limweili/eido/pull/583) closed #556
  and landed on main as `438a5b5c`; exact-main
  [Required run 29653968683](https://github.com/limweili/eido/actions/runs/29653968683)
  passed. Unrelated #521 then advanced main to `ad07f908`, and the active lanes
  rebased mechanically.
- **Closure:** [PR #585](https://github.com/limweili/eido/pull/585) closed #560
  and landed on main as `5519f20e`. Exact PR-head
  [Required run 29654929513](https://github.com/limweili/eido/actions/runs/29654929513)
  and exact-main
  [Required run 29655130600](https://github.com/limweili/eido/actions/runs/29655130600)
  passed.
- **Defect and lineage:** the real defect was shared ownership of pending
  rendition claim, invalidation, and revocation. The product patch-id survived
  the mechanical rebase, so the lineage move did not become a new product
  change.
- **Frontier:** #558 and #559 have been resliced, while #557 remains active.
  This entry claims no outcome for those lanes.

### 2026-07-19 · ADR 0028 stopped incomplete reviews and exposed #558's useful counterexample

- **Stopped audit:** a Sol static audit found the ownership coherent, but its
  optional execution used ambient Node v24 and continued without producing
  more decision value. It was stopped at 62,993 tokens and recorded
  **INCOMPLETE / no finding**, not rerun or treated as a pass.
- **Second incomplete review:** a separate independent #558 review also
  exceeded its budget without a verdict. It was stopped and recorded
  **INCOMPLETE**, rather than replaced with more reviewer machinery.
- **Discriminating evidence:** #558 Required supplied the useful counterexample:
  build and type-check were green, and the browser canary was green, while the
  raw main bundle measured 750.2 KiB against the 750 KiB cap. The lane was
  released for one lazy-load repair, not another review or checker cycle.
- **Lesson:** under ADR 0028, incomplete review stays honestly incomplete and
  completed evidence directs the next product action. A bounded failing
  product signal is more useful than spending further budget trying to turn an
  optional reviewer into a verdict.

### 2026-07-19 · The renderer train closed with causal fixes and reused proof

- **Keyboard accessibility (#559):** [PR #587](https://github.com/limweili/eido/pull/587)
  froze at source head `50177aca`. Its first Required run found a genuine
  750.4/750 KiB main-bundle red; a semantic string-deduplication repair brought
  the product source back within budget without changing behavior. Bounded
  review passed, and that verdict was reused across the semantic-no-op cleanup.
  The repaired head passed exact PR-head
  [Required run 29656193462](https://github.com/limweili/eido/actions/runs/29656193462/job/88110905150),
  landed on main as `5ae487e1`, and passed exact-main
  [Required run 29656280929](https://github.com/limweili/eido/actions/runs/29656280929/job/88111127846)
  plus release artifact `8432978638`.
- **Long-card interaction (#557):** [PR #588](https://github.com/limweili/eido/pull/588)
  froze at source head `08eeeb95`. The repair replaced an attempted scroll-
  restoration state machine with the causal boundary: point hit-testing no
  longer competes with Lexical's root-end selection. Results also retain their
  complete content instead of truncating content before rendering. Existing
  proof was sufficient and discriminating: the three-card browser journey
  passed 3/3, Result coverage passed 18/18, cursor coverage passed 10/10, and
  the exact main bundle was 767,991/768,000 bytes. A local Required failure was
  only the host's equivalent `/var` versus `/private/var` aliases, so it was
  classified and not rerun. Exact PR-head
  [Required run 29656856791](https://github.com/limweili/eido/actions/runs/29656856791/job/88112659548)
  passed; the change landed on main as `54de0bb5`, then exact-main
  [Required run 29656946448](https://github.com/limweili/eido/actions/runs/29656946448/job/88112901672)
  and release artifact `8433173749` passed. This closed #440's root cause.
- **Evidence lesson:** direct gates changed what shipped in both lanes; broader
  or repeated proof would not have. Exact 12–40 byte bundle overages were fixed
  in product source without building a checker v2, and a bounded reviewer
  verdict remained valid across semantic-no-op cleanup.
- **Frontier:** renderer issues #553–#560 are complete. #561 now owns the active
  integration boundary.

### 2026-07-19 · #591 refreshed the integration boundary with proof concentrated at its owners

- **Semantic refresh:** #591 used semantic rebase and composition to bring the
  integration boundary forward. Cross-review stayed frugal: cleanup was
  bounded to the changed composition instead of reopening already-proven
  product seams.
- **Perceptual finding:** bounded Light/Dark visual QA found editor contrast at
  1.89. The repair was made at the owning prose seam and raised the contrast to
  9.08, so consumers inherit the correction from its authority.
- **Native-host finding:** the exact Windows native host caught a doubled-drive
  file-URL defect and proved its repair. A stale test that required `inherit`
  was deleted because that behavior had been intentionally retired; it was not
  replaced with another implementation pin.
- **Exact final proof:** exact #591 head `9b868bdd` passed
  [Required run 29660062153](https://github.com/limweili/eido/actions/runs/29660062153)
  and exact-native
  [run 29660062151](https://github.com/limweili/eido/actions/runs/29660062151);
  the browser canary was green.
- **Evidence lesson:** reuse proof for unchanged authoritative seams, add
  evidence only where semantic composition or the target host creates a new
  falsifiable question, and stop once the exact-head signals answer it. This
  entry records the final reviewed head and its proof only; it makes no merge
  or landing claim for #591.

### 2026-07-19 · Epic #491 closed through identity-preserving promotion

- **Integration closure:** [PR #591](https://github.com/limweili/eido/pull/591)
  merged into the integration branch as `ef4ffb96` with tree `27341527`.
  Reviewed-head proof remained valid by tree identity, and #510 closed.
- **Main promotion:** [PR #592](https://github.com/limweili/eido/pull/592)
  promoted the integration lineage to main through ancestry-preserving merge
  `b02e1ec3`. Exact-main
  [Required run 29660641783, job 88122601343](https://github.com/limweili/eido/actions/runs/29660641783/job/88122601343)
  was green, release artifact `8434236120` was produced, and exact-main native
  [run 29660641846](https://github.com/limweili/eido/actions/runs/29660641846)
  was green. #491 then closed.
- **Provider-state friction:** draft → ready duplicated checks for an unchanged
  head and tree. Those replacement checks were provider-state friction, not
  new evidence. Merge Captain stopped redundant watching and reused the valid
  identity-preserved proof; after promotion, exact-main Required and native
  remained the terminal evidence.
- **Residual boundary and safety:** #471 still owns actual macOS arm64 and
  Windows x64 packaged-runtime certification on the identical source SHA and
  #528 artifact set; a rebuild still invalidates that packaged evidence. No
  save data, `.multy` state, or lockfile changed during this closeout.
