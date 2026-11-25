# Packaged certification evidence

Issue #528 adds a release-train certification boundary for sealed production
packages. It is deliberately separate from `desktop-proof`: desktop proof is an
unpacked, non-promotable PR gate under `dev.eido.shell-proof`; certification
builds `dev.eido.app` as a real DMG plus Squirrel update ZIP or a Windows NSIS
installer and admits only paired production evidence.

## Running the gate

`Packaged certification` is a manual, `main`-only workflow. Supply one unique,
non-`0.0.0` SemVer. The workflow rejects a dispatch unless its SHA is the exact
current `main`, mints one `certificationSetId`, and binds both native jobs to
that ID, SHA, version, target, and embedded provenance.

Before native work is admitted, the `prepare` job resolves the authoritative
proof that stands behind reusing #527's installed Gateway/CLI/MCP evidence. It
fingerprints the Profile-runtime tree at the dispatched SHA
(`CERTIFICATION_PROFILE_RUNTIME_PATHS` / `computeProfileRuntimeFingerprint` in
`scripts/certification/certification-manifest.mjs`), then asks the GitHub
Actions API for successful `Native desktop proof` runs on `main` and finds the
run whose head SHA fingerprints identically. No such run means no dispatch: the
run refuses to spend a native minute on a runtime tree that has no two-platform
proof. The resulting record is carried to each native leg and the final pairing
job as a short-lived admission artifact; those jobs recheck the sealed record
against their exact source tree without querying for a different proof run.

The public desktop build has no account preflight, Clerk variables, commercial
control-plane setup, or analytics configuration requirement (ADR 0051). The
closed historical ledger below describes former builds and does not restore
those deleted runtime paths or prerequisites.

### One path list

`CERTIFICATION_PROFILE_RUNTIME_PATHS` is the single literal that decides both
what moves the fingerprint and what makes `Native desktop proof` do real work.
`docs/agents/release-gates.json` and the `push` path filter in
`.github/workflows/desktop-proof.yml` are pinned to it by
`scripts/ci/workflow-policy.test.mjs`, so the three cannot drift. They used to:
68 of 83 fingerprinted paths were absent from the trigger list, so for those
paths the gate demanded evidence CI never produced.

Entries are either an exact repository path or a `dir/**` prefix
(`electron/**`, `native/profile-live-gateway/**`, `scripts/electron/**`). A
prefix is a **superset** in the workflow trigger and a **filtered rule** in the
fingerprint: the trigger matches every file under the directory, while
`isProfileRuntimePath` ignores `*.test.*`, `*.bench.*`, and `*.perf.*` under
it. That asymmetry is the safe direction. A test-only edit can spend a proof
run the fingerprint did not need; nothing can move the fingerprint without also
triggering the proof.

The list covers non-test `electron/` production files; the Profile/Gateway,
spatial, attribution, renderer-persistence, and delegated-Run closure across
`src/persistence`, `src/desktop`, `src/graph`, `src/brain`, `src/shared`, the
Profile-facing single-class Mod domain modules, `src/ui/cardIdentity.ts` with
`src/graph/cardIdentityPresets.ts`, and `src/main.tsx`; the native Live Gateway
builder and C transport sources; the Windows SEA builder; the packaging and
toolchain configuration; `package-lock.json`; and both Vite configs.
Canvas-only Mod faces, gestures, and chrome remain outside this proof boundary,
and so do three presentation-only leaves that used to be inside it:
`src/ui/tokens.ts` (no `electron/` file imports it), `src/shared/words.ts`
(native dialog and startup-screen copy, never a packaged-proof assertion), and
`src/shared/tokenEstimate.ts`. A parse error in any of them is caught by
typecheck and build long before this gate.

### Proof-reuse revalidation

`CERTIFICATION_REUSED_PROOF.<platform>.sourceSha` names the fixed original
proof **provider**: #527's certification SHA `7cf7f270`. It never changes —
it is the citation for #527's own installed Gateway/CLI/MCP evidence.

Revalidation is what says that provider proof is still representative of the
tree being shipped, and it is resolved live rather than written down.
`scripts/certification/proof-revalidation.mjs` finds the successful
`Native desktop proof` run on `main` (triggered by `push` or
`workflow_dispatch`) whose fingerprinted tree is the tree under certification,
confirms both native gate jobs concluded success, and returns a
machine-written record: workflow, repository, run ID and URL, attempt, event,
branch, head SHA, both job IDs, and the tree fingerprint. That record is sealed
into `proofReuse` in every platform evidence packet and therefore into the
paired manifest. **The audit question "what evidence justified reusing #527 for
this build?" is answered by the build's own immutable evidence**, not by a file
in the repository.

Selection is deterministic: among the runs that prove this exact tree, the
newest wins. The `prepare` job resolves that run once, seals the record into a
short-lived admission artifact, and both native runners plus the final pairing
job consume that exact record. A newer equivalent proof appearing while the
native legs run therefore cannot change the evidence. `finalize-certification.mjs`
still fails closed if the two legs cite different records or if the sealed
fingerprint is not the fingerprint of the certified source tree.

### The closed historical ledger

`CERTIFICATION_PROOF_REVALIDATIONS` is a **closed historical record of 48
entries. Nothing appends to it again.** It was hand-edited once per pull
request, forked between branches, produced array-end merge conflicts, and
blocked pull requests on bookkeeping that never caught a defect. It survives
for exactly one reason: retained schema-v1 evidence packets cite the entry they
were sealed against, and those immutable packets must keep resolving.
`scripts/ci/packaged-certification.test.mjs` pins its length and last entry so
a hand append fails in PR CI.

The entries below are kept as the historical narrative of how the tree moved
while the ledger was live.

- Entry 0 is the #527 provider SHA itself (`7cf7f270`, `treeSha256`
  `89b52bec…`) — the tree exactly as #527 certified it.
- Entry 1 (`82ba9f9b45a413e400a14a34c1bc2b5aa9d4044a`, `treeSha256`
  `1ef532cd…`) records that PR #460 changed `electron/sqliteRuntime.ts`,
  `electron/sqliteProfileBlobStore.ts`, and `electron/sqliteProfileOwnerCapability.ts`
  after #527 landed, and that the required two-platform native desktop-proof
  matrix (packaged GUI stamp, offline reopen, JSON CLI, MCP stdio) ran green
  on that exact pushed `main` SHA — [run `29853441307`](https://github.com/limweili/eido/actions/runs/29853441307),
  both `Native desktop proof — macos-15 (arm64)` and
  `Native desktop proof — windows-2025 (x64)` jobs `success`. Per ADR 0028
  ("prove once at the authoritative seam, reuse that proof everywhere until a
  relevant change invalidates it"), that green required-gate run at the new
  bytes is authoritative re-validation of #527's reuse — it re-proves the
  packaged Profile boundary at the changed source, without re-running #527's
  own command × transport × OS matrix.
- Entry 2 (`60d1764aa06020a0d8e4d63c504acb6d40c6ed08`, `treeSha256`
  `0b531b51…`) records that PR #709 added serialized update discovery and consent
  across the Electron runtime, and that the exact-head required native desktop
  matrix ran green on the PR head — [run `29893020195`](https://github.com/limweili/eido/actions/runs/29893020195),
  both supported jobs `success`. The subsequent ledger-only commit does not
  change the fingerprinted runtime tree, so this exact-head evidence remains
  authoritative for the recorded bytes.
- Entry 3 (`8089bc661cffd54d9ccf1f19298e05073e71bb1e`, `treeSha256`
  `535b3808…`) records PR #707's keychain credential and packaged-egress runtime
  before its main refresh — [run `29891627455`](https://github.com/limweili/eido/actions/runs/29891627455),
  both supported jobs `success`.
- Entry 4 (`8e67937b60f6848528f1c22536663f808453528a`, `treeSha256`
  `8b96e4c6…`) records the mechanically refreshed PR #707 runtime composed with
  the already-landed update-discovery bridge. The credential, security, and
  egress files remained byte-identical to the reviewed PR head, while the exact
  composed head passed both supported jobs in [run `29894155010`](https://github.com/limweili/eido/actions/runs/29894155010).
  The following ledger-only commit does not change that fingerprinted tree.
- Entry 5 (`4039f73a57f8dc6dd11f405f5c611530e4bf009a`, `treeSha256`
  `4efe72ef…`) records PR #728's B2 update-install handoff and restart
  coordination runtime. The required two-platform native desktop-proof matrix
  ran green on this exact PR head in [run `29897420395`](https://github.com/limweili/eido/actions/runs/29897420395),
  proving both supported native boundaries before the change landed on main.
- Entry 6 (`adfa721ad0a8d4a49ab7eb0a8b25736e7b0b7bd3`, `treeSha256`
  `dbfccc28…`) records PR #708 changing `electron/keychainStore.ts` so an
  undecryptable or zero-byte protected-credential blob (OS keychain reset,
  machine migration, or a corrupted file) degrades to an empty key and is
  best-effort scrubbed instead of throwing and fail-closing app startup; no
  bridge, session, or renderer files changed. The required two-platform
  native desktop-proof matrix ran green on the original exact #708 runtime
  head, while entry 5 independently proves main's B2 runtime —
  [run `29904323758`](https://github.com/limweili/eido/actions/runs/29904323758),
  both `Native desktop proof — macos-15 (arm64)` and
  `Native desktop proof — windows-2025 (x64)` jobs `success`. Rebase source
  `adfa721` composes the two independently proven changes; the combined
  fingerprint is recorded for exact-head revalidation before merge. The
  following ledger-only commit does not change that fingerprinted tree.
- Entry 22 (`ccdca05bb2af6dcfb79c0fc2e8f0ab9e4a9c00e5`,
  `treeSha256` `07b266a4…`) records PR #842's copy-first automatic Profile
  salvage, verified recovery generation, record-axis-1 adjacent-Board repair,
  and narrow APFS device-only remount rebind. The exact-head required native
  desktop matrix ran green in [run `30985189023`](https://github.com/limweili/eido/actions/runs/30985189023):
  macOS arm64 job `92238236626` and Windows x64 job `92238236658` both
  succeeded. The following ledger-only commit does not change the
  fingerprinted runtime tree.
- Entry 23 (`7fb53466e68aba0a0b67b5868698e9a3f25b2c41`,
  `treeSha256` `cf11e122…`) records PR #843 restoring the canonical exact-15
  Agent command discovery order used by packaged certification and adding the
  Agent Gateway to native-proof path policy. The exact-head required native
  desktop matrix ran green in [run `30987923522`](https://github.com/limweili/eido/actions/runs/30987923522):
  macOS arm64 job `92246910298` and Windows x64 job `92246910210` both
  succeeded. The following ledger-only commit does not change the
  fingerprinted runtime tree.
- Entry 24 (`34cff5233e5f091a53c814d8c02c7c828f0d7eb2`,
  `treeSha256` `de9d0bf2…`) records PR #847 changing exactly one fingerprinted
  file, `src/ui/tokens.ts`, and changing only declarative token values in it:
  the daylight interactive boundary, the daylight functional ink twins, and the
  night surface ladder. The path set covers the Card-identity token closure by
  design, so the fingerprint fails closed on any byte of that file, including
  a colour. The native desktop matrix was dispatched at this exact head and ran
  green in [run `31503068324`](https://github.com/limweili/eido/actions/runs/31503068324):
  macOS arm64 job `93817725512` and Windows x64 job `93817725393` both
  succeeded. The following ledger-only and documentation commits do not change
  the fingerprinted runtime tree.
- Entry 25 (`f68442628b81184ee95e86fbc0abf2fa3bf9e826`,
  `treeSha256` `60fb1257…`) records PR #850 adding a production-only PostHog
  app-open event and allowing only the official US and EU PostHog ingest
  origins through the Electron CSP. No Profile, Gateway, persistence, bridge,
  or save-format behavior changed. The exact-head native desktop matrix ran
  green in [run `31572724444`](https://github.com/limweili/eido/actions/runs/31572724444):
  macOS arm64 job `94037990735` and Windows x64 job `94037990873` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 26 (`ce998dafac1ad633a1f1f80d57e5c8db9a2af350`,
  `treeSha256` `7b53999b…`) records PR #850 expanding PostHog into an
  explicit-consent, production-only product-analytics boundary with a
  persistent installation pseudonym, per-launch sessions, a typed event
  allowlist, main-process transport, privacy controls, and outcome-bound
  canvas, AI, onboarding, import, export, and feature-adoption events. The
  exact-head native desktop matrix ran green in [run `31596310908`](https://github.com/limweili/eido/actions/runs/31596310908):
  macOS arm64 job `94112584972` and Windows x64 job `94112585118` both
  succeeded. The following ledger-only commit does not change the
  fingerprinted runtime tree.
- Entry 27 (`aec4ccc0daf42f4256fa47ffa9b83046173b9461`,
  `treeSha256` `ff26eeaf…`) records PR #850 changing only the
  founder-approved analytics-consent copy in `src/shared/words.ts`. No
  analytics event, transport, identity, privacy, Profile, Gateway,
  persistence, bridge, or save-format behavior changed. The exact-head native
  desktop matrix ran green in [run `31606394352`](https://github.com/limweili/eido/actions/runs/31606394352):
  macOS arm64 job `94146318293` and Windows x64 job `94146318211` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 28 (`954952df13cf4cfc0686097069f2a1970dc7a923`,
  `treeSha256` `3e99e4e…`) records PR #852 changing playback projection and
  transport presentation so events advance at equal intervals with 2×, 5×,
  and 10× controls and a minimal 90vw transport. No Profile, Gateway,
  persistence, bridge, save-format, or timestamp-storage behavior changed.
  The exact-head native desktop matrix ran green in [run `31723618499`](https://github.com/limweili/eido/actions/runs/31723618499):
  macOS arm64 job `94526437304` and Windows x64 job `94526437356` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 29 (`ee1143db7d3dda3e04bdbec452e3248a6eca0371`,
  `treeSha256` `c7793ab2…`) records PR #884 adding a provider-neutral Electron
  boundary for locally authenticated AI harness CLIs and persisting provider
  identity with AI runs. It does not change the SQLite schema, Profile
  ownership, blob storage, or Gateway/CLI/MCP contracts. The exact-head native
  desktop matrix ran green in [run `31790198552`](https://github.com/limweili/eido/actions/runs/31790198552):
  macOS arm64 job `94735143035` and Windows x64 job `94735143184` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 30 (`248a7aa354d7021f9dd72f05449c0216e31488b9`,
  `treeSha256` `542d94de…`) records the adversarial hardening of PR #884's
  local AI harness boundary: joined process-tree shutdown, strict Conversation
  provider/model continuation provenance, documented Claude effort mapping,
  Antigravity answer-event filtering, streamed/terminal reconciliation, and
  bounded incompatible-output errors. It does not change the SQLite schema,
  Profile ownership, blob storage, or Gateway/CLI/MCP contracts. The exact-head
  native desktop matrix ran green in [run `31797404819`](https://github.com/limweili/eido/actions/runs/31797404819):
  macOS arm64 job `94757407450` and Windows x64 job `94757406107` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 31 (`69367959d24eb6bf52caa9d854cd1f5a0c2e15d0`,
  `treeSha256` `808a4b30…`) records PR #885's optional Eido Account and Hosted
  AI bridge/runtime composition, provider-neutral BYOK/Hosted/local execution
  planning, and the packaged preload fix that keeps main-only Node modules out
  of renderer and sandboxed preload bundles. The exact-head native desktop
  matrix ran green in [run `31817505278`](https://github.com/limweili/eido/actions/runs/31817505278):
  macOS arm64 job `94822612397` and Windows x64 job `94822612408` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 32 (`56f014ee1a88e91ac1d4c0c764ace265e25fa2a7`,
  `treeSha256` `ab9cc506…`) records PR #885 moving packaged Profile, Account,
  Hosted AI, and global recovery ownership into an explicit desktop renderer
  island while compiling those authorities out of the browser build. Normal
  desktop and release packaging use the real desktop target, the browser
  remains BYOK-only, StrictMode cleanup revokes Hosted authority, and the
  production bundle stays within both size budgets. The exact-head native
  desktop matrix ran green in [run `31819502320`](https://github.com/limweili/eido/actions/runs/31819502320):
  macOS arm64 job `94829107856` and Windows x64 job `94829107960` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 33 (`50dff8114b6b02ce4b2da3b579772bd047e83edd`,
  `treeSha256` `fa4cb853…`) records PR #889 making Result follow-up authority
  begin before asynchronous AI access admission, binding pending and live work
  to its exact Board/version destination, exposing truthful pending cancellation,
  suppressing canceled late denials, and revoking only work whose durable
  destination is lost. The exact-head native desktop matrix ran green in
  [run `31824126562`](https://github.com/limweili/eido/actions/runs/31824126562):
  macOS arm64 job `94844092577` and Windows x64 job `94844092522` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 34 (`9500d5dfa38e8697541b3c2760e00cd05b4a5dfe`,
  `treeSha256` `e4d4d349…`) records PR #889 completing the same Result follow-up
  lifecycle repair while preserving the Graph Index as the single Result-card
  and output lookup authority for authoritative Board replacement and deletion.
  The exact destination-provenance and selective cancellation behavior are
  unchanged. Native desktop proof
  [run `31825264837`](https://github.com/limweili/eido/actions/runs/31825264837)
  attempt 2 completed green on this exact runtime head: macOS arm64 job
  `94848953393` and Windows x64 job `94848952285` both succeeded. The following
  ledger-only and documentation commit does not change the fingerprinted runtime
  tree.
- Entry 35 (`604754ccd9dffbe547f1e7661b1bce76776b5c97`,
  `treeSha256` `960fc0bb…`) records PR #896's fail-closed injected Paid Hosted
  route, private model catalog, and per-operation serialization of reservation
  finish. Native desktop proof
  [run `31837569000`](https://github.com/limweili/eido/actions/runs/31837569000)
  ran green on the exact head: macOS arm64 job `94887166586` and Windows x64
  job `94887166525` both succeeded. It does not claim a real Paid-provider
  execution. The exact full evidence note remains in the ledger object.
- Entry 36 (`8416ce24dc65538b49d6d26388ad817096a9ec26`,
  `treeSha256` `dc814cd3…`) records PR #955 giving an Ask AI Card its own web
  reach with Linkup behind it. Inside the fingerprinted tree that is the
  OpenRouter boundary running the tool loop itself, the run engine building the
  tool set and carrying research depth and job identity, the Card and run
  shapes that hold reach, depth, tool steps and the wire record, the persisted
  validator admitting those same fields, and user-visible words. The validator
  widens by addition only, so existing records stay valid, and it does not
  change the SQLite schema, Profile ownership, blob storage, or Gateway/CLI/MCP
  contracts. The packaged network boundary widened at #957 to Linkup and the
  keyless page reader, as a reviewed diff in `electron/protocol.ts` now matched
  by the packaged proof. The exact-head native desktop matrix ran green in
  [run `32141256518`](https://github.com/limweili/eido/actions/runs/32141256518):
  macOS arm64 job `95724177840` and Windows x64 job `95724177728` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 37 (`768e57cb6305bace9aeb904127d15b0a81203ee9`,
  `treeSha256` `7a17bba8…`) records PR #955 merging main and renumbering this
  epic's ADRs around main's own ADR 0032. Nothing that runs changed since entry
  36: the whole delta inside the fingerprinted tree is 13 comment lines across
  `openRouter.ts`, `runEngine.ts`, `store.ts`, `types.ts`,
  `profileLogicalProjection.ts` and `words.ts`, each an ADR citation moving up
  one number. The fingerprint is taken over file content rather than over
  compiled output, so a comment counts and entry 36's record could not be
  reused. The behaviour proved here is therefore the behaviour entry 36 proved,
  re-established at the exact merged head a reviewer reads. The exact-head
  native desktop matrix ran green in
  [run `32145907750`](https://github.com/limweili/eido/actions/runs/32145907750):
  macOS arm64 job `95739460209` and Windows x64 job `95739460265` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 38 (`5a83d8a0b39411af9fa0adb182894bd9d6f9df9c`,
  `treeSha256` `329f2f97…`) records PR #979 asking an Eido-owned hostname for
  the update feed. Inside the fingerprinted tree the whole delta against main
  is `electron/updateEndpoints.ts`: the feed origin constant,
  `updateFeedAssetUrl` building that address instead of a provider URL, and the
  allowlist admitting the feed hostname at a single asset path while keeping
  the GitHub redirect hops it currently lands on. No request loosens, because
  every hop is still validated before it is contacted. The head also carries
  main at `776b8eff`, whose runtime tree entry 37 proved at `768e57cb`, so this
  entry re-establishes that proof at the merged head plus the address change.
  It does not change the SQLite schema, Profile ownership, blob storage, or
  Gateway/CLI/MCP contracts. The exact-head native desktop matrix ran green in
  [run `32148870196`](https://github.com/limweili/eido/actions/runs/32148870196):
  macOS arm64 job `95749397178` and Windows x64 job `95749397381` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 39 (`a931ee7290120517449f2f84eef1c22a60669e04`,
  `treeSha256` `7e1b8be5…`) records the 2026-08-19 orchestration run for epic
  #853 arriving on the monetization branch. Inside the fingerprinted tree that
  is the merge of entry 37's reach work with this epic's shared AI access
  resolver across `src/brain`, the composite account snapshot v2 projection
  across `electron/` and `src/desktop`, the `webReachMode.ts` to `reachMode.ts`
  rename with its symbol updates, and a second round of ADR citation
  renumbering in comments after the two branches were found to have numbered
  ADRs 0032 to 0037 twice. The persisted Card `meta` key value stays
  `reachMode`, so no Board projection changed and no migration is implied. The
  provider mutation finality authority landed in the same run sits under
  `services/ai-control-plane/`, outside this path set. The exact-head native
  desktop matrix ran green in
  [run `32154584199`](https://github.com/limweili/eido/actions/runs/32154584199):
  macOS arm64 job `95768594949` and Windows x64 job `95768595463` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree, because `scripts/certification` is
  outside `profile-runtime-v1`.
- Entry 40 (`362f9c0daf1be7263099b1eb31733794f26811e7`,
  `treeSha256` `877d52d1…`) records PR #1052's signed update-delivery and
  production macOS signing integration. The exact-head native desktop matrix
  ran green in
  [run `32241660866`](https://github.com/limweili/eido/actions/runs/32241660866):
  macOS arm64 job `96033429176` and Windows x64 job `96033428917` both
  succeeded. The exact full evidence note remains in the ledger object.
- Entry 41 (`a40a4e440f7129beebaa195ac50ac9f3f2fc2a1a`,
  `treeSha256` `1a1ee632…`) records PR #1064. Inside the fingerprinted tree the
  whole delta is one added string in `src/shared/words.ts`: the sentence
  Settings shows when the OS credential store refuses the key write. Nothing
  that runs in `electron/`, the Gateway, the CLI, the MCP relay, the SQLite
  schema, or Profile ownership changes, and the rest of the PR sits outside the
  fingerprinted closure. As with entry 37, the fingerprint is taken over file
  content, so copy counts. The exact-head native desktop matrix ran green in
  [run `32251304288`](https://github.com/limweili/eido/actions/runs/32251304288):
  macOS arm64 job `96062717551` and Windows x64 job `96062717767` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 42 (`4a32b33ca3a90260f6156ce8dc165446a9db6d62`,
  `treeSha256` `060c4f1e…`) records PR #1071, automatic context compaction for a
  Result Card and for the agentic tool loop. Four files inside the fingerprinted
  tree change: `src/brain/openRouter.ts` (loop compaction, the typed
  context-overflow refusal, and reading the usage every stream already reports),
  `src/brain/modelWindows.ts` (context windows read from OpenRouter's public
  model catalog instead of a hand-kept table, plus device-local corrections a
  provider proved by refusing a request as too long), `src/brain/runLifecycle.ts`
  (one added error-message branch), and `src/shared/words.ts` (two added
  strings). Nothing that runs in `electron/`, the Gateway, the CLI, the MCP
  relay, the SQLite schema, or Profile ownership changes. The same head also
  amends `scripts/electron/packaged-smoke.mjs`, which is outside the
  fingerprinted closure: that proof pinned the ABSENCE of the model-list
  endpoint #676 had deleted as dead code, and now pins its presence, because the
  catalog is what windows are read from. The claim #676 was protecting is
  unchanged and still proved at the same seam: the packaged egress report still
  asserts zero external requests, and the catalog is fetched only alongside a
  completion the person asked for, with their own key, on the one host the CSP
  already allows. The exact-head native desktop matrix ran green in
  [run `32269583562`](https://github.com/limweili/eido/actions/runs/32269583562):
  macOS arm64 job `96122461848` and Windows x64 job `96122461700` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree.
- Entry 43 (`8c6f5a46097c9dbaf06ff66aa7bbd841760c625e`,
  `treeSha256` `2ac2d6e9…`) re-baselines two separate deltas at once, which is
  why it is larger than a single change would justify. The first is drift the
  epic branch had already accumulated without an append: nine lane merges
  (#1040, #1041, #1042, #1043, #1044, #1045, #1047, #1051, #1060) changed 16
  files inside the fingerprinted tree, so the gate was already red at base head
  `0ae265d8` with a recomputed fingerprint of `5636a221…`. The second is issue
  #1079's rename of the Hosted AI model catalog property from `tier` to
  `fundingRoute`, which touches `electron/accountControlPlaneClient.ts`. The
  exact-head native desktop matrix ran green in
  [run `32279841298`](https://github.com/limweili/eido/actions/runs/32279841298):
  macOS arm64 job `96155742694` and Windows x64 job `96155743202` both
  succeeded. The following ledger-only and documentation commit does not
  change the fingerprinted runtime tree, because `scripts/certification` is
  outside `profile-runtime-v1`.

  **A cheaper shape was available and was not taken.** A green proof run
  already existed on the base head, so two appends, one for the inherited
  drift and one for the new change, would have separated someone else's drift
  from this branch's at no extra cost. Prefer that split when you inherit an
  unappended tree.

- Entries 44 and 45 carry their own notes in
  `scripts/certification/certification-manifest.mjs` and were never written up
  here: `4c875be589e107901fd55fa5f058d74f9337e2a3` (PR #1106, issue #1095) and
  `2d388f9b24d712d9e11cefa8fb1c2099a49bce61` (PR #1108, issue #1096). Read the
  ledger for those two rather than this list. The prose here is a convenience;
  the ledger is the authority, and this gap is why.
- Entry 46 (`5f0f3fe20359b690c988ca32b0f205854e8438be`,
  `treeSha256` `07e653af…`) records PR #1069's macOS in-place update repair
  composed with PR #1071's context compaction. The exact-head native desktop
  matrix ran green in
  [run `32322268004`](https://github.com/limweili/eido/actions/runs/32322268004):
  macOS arm64 job `96286638283` and Windows x64 job `96286638077` both
  succeeded. The exact full evidence note remains in the ledger object.
- Entry 47, the latest entry (`fa457ac40d80ee2e7f6cc77e5479d0f79a3b4207`, `treeSha256`
  `efbaecdb...`) records PR #1132 renaming the served hosted account snapshot's
  `plan` section to `subscription`, so that in Eido `plan` means only an
  Execution Plan (issue #1084). Inside the fingerprinted tree the delta is four
  files: `electron/accountControlPlaneClient.ts`, where the exact key set, the
  section validator, and the relationship checks move to the new name and the
  retired `hosted-plan-*` copy identifiers become `hosted-subscription-*`;
  `electron/desktopAccountController.ts`, where the subscribe precondition
  reads the renamed section; `electron/eidoCliEntitlement.ts`, one comment
  line; and `src/shared/words.ts`, which renames account panel and
  upgrade-screen message identifiers only. The English copy those identifiers
  resolve to is unchanged, so nothing a person reads moves here. Six further
  changed `electron/` files are tests, which the fingerprint excludes by rule.
  No inherited drift needed separating: base head `294e0ccd` recomputes to
  `93950660...`, exactly the `treeSha256` its epic-parent predecessor
  `2d388f9b` (now entry 45) recorded, so this entry re-baselines only this
  branch delta, which is the cheaper two-entry shape entry 43 said to prefer.
  The exact-head native desktop matrix ran green
  at the first attempt in [run `32348075434`](https://github.com/limweili/eido/actions/runs/32348075434):
  macOS arm64 job `96361007392` and Windows x64 job `96361007096` both
  succeeded. The event is `pull_request` rather than the `workflow_dispatch`
  entries 44 and 45 needed, because this delta changes three `electron/`
  files and those are inside the proof workflow's path filter; the filter gap
  on issue #1107 is unchanged and still unresolved. Two commits follow the
  proven head and neither changes the fingerprinted runtime tree: the merge of
  base head `294e0ccd`, whose only delta is one added file under
  `services/ai-control-plane/test`, and the ledger-only commit carrying the
  entry, because `scripts/certification` is outside `profile-runtime-v1`.

**There is no next entry. Do not append.** When a change touches the
fingerprinted tree, the required `Native desktop proof` gate runs on the pull
request at its exact head, and the `push` run on `main` proves the merged tree.
The next certification dispatch resolves that run by itself. No file is edited,
no commit is added to a pull request branch, and two branches cannot fork the
record because no branch holds it.

What to do when a certification dispatch is refused with
`No successful Native desktop proof run on main covers the runtime tree`:

- the change is not on `main` yet, so land it and let the `push` run prove it;
  or
- the change landed but the `push` run was cancelled or failed, so re-run it;
  or
- the tree is older than the resolver's 100-run window, in which case dispatch
  `Native desktop proof` manually against the SHA being certified.

None of those is a file edit. If a dispatch is ever blocked by something that
would be fixed by editing a repository file, that is a defect in this design,
not a chore to do by hand.

Each GitHub-hosted native job runs `npm run release:package` followed by
`npm run release:certify`. The two legs are separate jobs, not one matrix job,
because only macOS carries a signing identity; their shared steps are held
identical by `scripts/ci/packaged-certification.test.mjs`.

The macOS arm64 job signs every Release with Eido's Developer ID Application
identity under the hardened runtime, notarizes and staples `Eido.app`, creates
the updater ZIP from that final app, and independently notarizes and staples
the sealed DMG. Certification extracts the ZIP and requires its app tree and
nested signing postures to match the DMG installation; it also validates the
app's staple and Gatekeeper result, the exact packaged `app-update.yml`, and the
embedded Squirrel `ShipIt` signature. An unsigned, unhardened, unstapled,
Gatekeeper-rejected, mismatched, or substituted package fails the release rather
than reaching a person. Signing is described in `docs/release/macos-signing.md`.

The Windows x64 job creates a real NSIS installer and requires the installer,
installed GUI executable, MCP entry, packaged `eido`, and Live Gateway helper to
report `NotSigned`, with no publisher, thumbprint, or timestamp. Windows is
unsigned by decision, not omission (spec #975): Eido does not buy an
Authenticode certificate, and users accept one SmartScreen warning at first
install. The gate fails just as loudly on an unexpectedly signed Windows
artifact as on a broken one, so that decision cannot drift unobserved.

The native journey uses the shipped GUI, standalone `eido`, one-shot JSON CLI,
and stdio MCP entry. It creates a synthetic Profile under the fixed production
location of a declared GitHub-hosted ephemeral OS user, checks restart/offline
reopen, owner-only live IPC, surface-v5 discovery/spatial mutation, resolved
Card-box bounds, and change history,
app-closed rejection of live-only delegated Runs, and exact-seven MCP
exclusion. It does not execute a paid model or infer a successful real-provider
Run. It then uninstalls without deleting the Profile, reinstalls the same sealed
bytes, and removes only that owned synthetic root. The harness refuses local or
self-hosted execution so it cannot touch a developer's real Profile.
It also resolves `eido` by command name from an unrelated working directory on
both hosts. The Windows leg requires the NSIS-owned user `PATH` registration;
it proves that an owned entry is removed on uninstall and that a seeded
pre-existing entry remains unowned and survives uninstall. The macOS native
desktop leg installs the launcher at `/usr/local/bin/eido` on its GitHub-hosted
ephemeral OS user, resolves it by command name in natural PATH order, and
verifies the launcher's contents before cleanup. The
production certification repeats the fixed-target canary against the installed
DMG bytes and composes it with the app's explicit administrator-mediated
install-command offer.
The exact-head native desktop proof also runs the focused Live Gateway helper
suite on each supported host before packaging; its path gate includes the
builder and native C transport sources, so permission, peer, framing, or
compiler-path changes cannot bypass that proof.
The offline process starts behind an intentional loopback deny proxy before its
first navigation, then applies Chromium offline emulation before reloading the
window. The temporary proxy and DevTools listener must both close.

This workflow produces exact-main paired evidence and retains the DMG, macOS
updater ZIP, and NSIS installer for the founder-confirmed release version. Since
#696 it is also the Developer ID signing and notarization lane for macOS; it is
still not an updater or promotion ceremony.
It is not a required PR check, has no experimental suffix, and is intentionally
absent from `release-gates.json`. Its sealed packages, native packets, paired
manifest, and reference are retained for three days. A release consumer must
copy the digest-addressed result into its own durable ledger; an artifact URL
is transport, not identity.

## Output contract

The current harness writes schema-version-2 journey transcripts, platform
packets, and `certification-manifest.json` so the sealed installer, the current
macOS packet's `updateArtifact`, and named nested executables' signing postures
are mandatory and downgrade-resistant. The update artifact binds the ZIP's
filename, byte count, SHA-256, SHA-512, matching app-tree digest, package
identity, nested signing verification, staple, and Gatekeeper result.
Schema-version-2 macOS postures require the Developer ID identity; the retained
schema-version-1 sets (0.1.1 and 0.1.2) predate production signing and keep the
ad-hoc posture they actually had. The exact expected authority is checked on the
macOS runner itself against the signing environment; the paired finalizer, which
deliberately holds no signing identity, re-checks the posture structurally and
binds it by digest.
Current set IDs begin `eido-cert-v2-`; preparation rejects any other prefix
before native spend. `validatePlatformEvidence` binds a schema-version-1 packet
to a named retained set's source, SemVer, transcript digest, and historical
proof tuple. `validateCertificationSet` additionally requires the canonical
parsed manifest to match that retained authority exactly. The external
reference still binds the raw manifest bytes. A v2 manifest may contain only v2
platform packets.

The source repository pins the raw and canonical hashes of named historical v1
sets, but does not retain their real manifests as test fixtures. Those manifests
are release evidence and belong only in an authorized durable evidence store,
not in Git. Compatibility changes are checked manually against the exact
externally retained manifest by first matching its raw SHA-256, then applying
`validateCertificationSet`; CI uses synthetic v1 packets to exercise historical
proof resolution and verifies that a synthetic full manifest cannot satisfy the
canonical retained-set authority. This keeps the production allowlist closed
without turning source control into a second release-evidence ledger.

- `certification-manifest.json` is the full paired record. It contains the set
  ID, exact source SHA, SemVer, production package identity, both platform
  packets, every contract version, actual sealed-artifact, enclosing-app/GUI,
  and named nested-executable signing postures, artifact and installed inventory
  hashes, native journey results, negative inventory, reused proof references,
  runner image and actual Node/npm identity, and evidence digests.
- `certification-reference.json` remains schema version 1 because its shape is
  unchanged. It is the stable dependency-ledger input for
  issue #675. It identifies the manifest by filename and a lowercase
  `sha256:<64-hex>` digest without embedding an expiring Actions URL or
  creating a manifest self-hash cycle. The `sha256:` prefix matches how
  #675's ledger (`scripts/release/release-planning.mjs`) addresses its own
  platform evidence entries, so #675 can consume this reference verbatim
  without a transcription step — mechanically, via
  `node scripts/release/release-planning.mjs resolve-dependency --reference
  <certification-reference.json>` after the target is declared.

The reference has this deliberately small shape:

```json
{
  "schemaVersion": 1,
  "kind": "eido-packaged-certification-set",
  "certificationSetId": "eido-cert-v2-123456789-1",
  "sourceSha": "0123456789abcdef0123456789abcdef01234567",
  "semver": "1.2.3-alpha.1",
  "manifest": {
    "fileName": "certification-manifest.json",
    "sha256": "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
  }
}
```

A consumer first verifies `manifest.sha256` against the exact manifest bytes,
then applies `validateCertificationSet` from
`scripts/certification/certification-manifest.mjs`. Admission fails closed for
zero versions, proof/smoke identity, non-promotable records, an incomplete
platform pair, wrong signing posture, contract drift, negative-inventory drift,
or digest mismatch.

Before writing that manifest, the pair job independently re-hashes each
downloaded DMG/ZIP/EXE and journey transcript, verifies byte counts, and checks that
the transcript's sealed-artifact, enclosing-app/GUI, and named nested-executable
signing postures, installed identity, inventory, runner, proof-reuse, and
listener observations match its platform packet. Claimed digests alone are
never admitted.

The authoritative contract block records:

- all seven Profile axes (`profile`, `schema`, `record`, `asset`, `app`,
  `command`, `export`) at v1, except the physical `record` envelope at v2
  (the single-class Mods record advance shipped by #809);
- Gateway protocol and compatibility v1 with exactly seven MCP tools;
- external Agent batch, request, and command schemas v1, plus ledger and event
  v1;
- delegated Agent Run contract v2 (`run.submit`, `run.status`, `run.read`),
  live-app-only over the CLI;
- installed command surface v5 raw exact-22, Agent-discoverable exact-15,
  and historical v1/v2/v3/v4 replay (with the v1 exact-six subset recorded explicitly);
- emitted receipt v5 and readable receipts v1/v2/v3/v4/v5.

The platform packet's `evidenceSha256` addresses its immutable native journey
transcript. The paired manifest repeats those digests under keys
`darwin-arm64` and `win32-x64`; the external reference then addresses the full
manifest bytes. Any rebuild, re-sign, repack, metadata change, installed-tree
change, or evidence change requires a new `certificationSetId`.
`certificationInvalidations` invalidates the changed platform packet and paired
integrity, leaving an unchanged platform packet reusable.

## Evidence boundary

Certification adds proof only for sealed-byte identity, actual signing posture,
the installed production seams, the smallest native
install/relaunch/offline/uninstall/reinstall journey, lean installed contents,
and paired-set integrity. The platform packets cite the final digest-addressed
#527 proof provider, which composes the already-landed proof from #459, #460,
#462, #463, #521, #465, #619, #524, and #525. The certification harness does
not rerun their rollback, previous-good recovery, archive/remap, blob closure,
WAL/kill/contention, command matrix, framing, parity, replay, or attribution
coverage.

The negative inventory is closed: the ASAR is limited to built renderer output,
compiled Electron main/preload utilities, any required production runtime
dependencies, and runtime metadata. Required static assets may appear only
inside the built renderer tree. Source maps, research/prototypes, design or
internal documentation, ADRs, agent instructions, tests, fixtures, tooling,
credentials, private source, vectors, models, schemas, indexes, and unexpected
listeners reject the packet.
The installed-tree digest includes files, directories, and contained relative
symlinks; an escaping symlink is rejected. Installed metadata must independently
report the production bundle/product name, exact package SemVer, executable,
and architecture (macOS plist plus every installed Mach-O; Windows ASAR, installed shortcut
AppUserModelID, and both shipped PE headers/version resources) before the
embedded provenance is accepted. On macOS, the plist must declare the Friends
Alpha product floor of 13.5; every installed Mach-O must be arm64-only and have
a deployment target no newer than that floor.

The durability declaration follows ADR 0025: POSIX directory entries are
flushed before SQLite acknowledgement; Windows namespace durability remains
best effort after file flush, rename, reopen, and rehash. Certification records
that distinction; it does not claim stronger Windows guarantees.

There is no first-release legacy migration in this slice, so the installed
journey records `firstReleaseMigration: "not-applicable"`.
