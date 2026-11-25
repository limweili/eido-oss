import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

export const FULL_SHA = /^[0-9a-f]{40}$/
export const SHA256 = /^[0-9a-f]{64}$/

export const CERTIFICATION_PACKAGE_IDENTITY = Object.freeze({
  appId: 'dev.eido.app',
  productName: 'Eido',
  classification: 'production',
})
export const CERTIFICATION_REUSED_PROOF = deepFreeze({
  darwin: {
    issue: 527,
    sourceSha: '7cf7f270108c9fe5bc2f8fe0e944790162ca0609',
    sha256: '4e30db8645a918fcd7434944c0aec32505b7a70ac375cd916e74f05301f268cb',
  },
  win32: {
    issue: 527,
    sourceSha: '7cf7f270108c9fe5bc2f8fe0e944790162ca0609',
    sha256: '435b26ee76a24dc7b9b972633153ef68f2b1dec5f131e6322dfaa4b2502fbbb3',
  },
})

// The authoritative two-platform proof that stands behind every reuse of
// #527's installed Gateway/CLI/MCP certification. The job names are GitHub
// check names and must match the rendered matrix job name byte for byte,
// em dash included; `docs/agents/release-gates.json` and
// `.github/workflows/desktop-proof.yml` are pinned to these strings by
// `scripts/ci/workflow-policy.test.mjs`.
export const NATIVE_DESKTOP_PROOF_WORKFLOW = 'Native desktop proof'
export const NATIVE_DESKTOP_PROOF_WORKFLOW_FILE = 'desktop-proof.yml'
export const NATIVE_DESKTOP_PROOF_ALLOWED_EVENTS = Object.freeze([
  'push',
  'workflow_dispatch',
])
export const NATIVE_DESKTOP_PROOF_GATE_JOBS = Object.freeze([
  'Native desktop proof \u2014 macos-15 (arm64)',
  'Native desktop proof \u2014 windows-2025 (x64)',
])

// The one path list that decides two things at once: which files move the
// packaged-certification runtime fingerprint, and which files make the
// `Native desktop proof` gate run for real. `docs/agents/release-gates.json`
// and the `push` path filter in `.github/workflows/desktop-proof.yml` are
// pinned to this array by `scripts/ci/workflow-policy.test.mjs`, so the three
// cannot drift apart.
//
// Entries are either an exact repository path or a `dir/**` prefix. A prefix
// entry is a superset in the workflow and a filtered rule in the fingerprint:
// the trigger matches every file under the directory, the fingerprint ignores
// `*.test.*`, `*.bench.*`, and `*.perf.*` files under it. That direction is
// the safe one. A test-only edit can spend a proof run that the fingerprint
// did not need, but no edit can move the fingerprint without also triggering
// the proof.
//
// The list is kept sorted and unique so two branches append in the same place
// and a conflict is a real disagreement rather than an artifact of ordering.
export const CERTIFICATION_PROFILE_RUNTIME_PATHS = Object.freeze([
  '.github/node-version',
  '.github/workflows/desktop-proof.yml',
  'build/eido-path.nsh',
  'docs/agents/release-gates.json',
  'electron-builder.yml',
  'electron/**',
  'native/profile-live-gateway/**',
  'package-lock.json',
  'package.json',
  'scripts/ci/desktop-proof-scope.mjs',
  'scripts/ci/native-desktop-proof.mjs',
  'scripts/ci/toolchain-policy.mjs',
  'scripts/electron/**',
  'src/App.tsx',
  'src/brain/agentRunContract.ts',
  'src/brain/agentRunExecutor.ts',
  'src/brain/agentRunSession.ts',
  'src/brain/chainStaleness.ts',
  'src/brain/compiler.ts',
  'src/brain/contextCompaction.ts',
  'src/brain/conversationCompiler.ts',
  'src/brain/executionPlan.ts',
  'src/brain/followUpThread.ts',
  'src/brain/groupDigestFreshness.ts',
  'src/brain/modBlock.ts',
  'src/brain/modelWindows.ts',
  'src/brain/openRouter.ts',
  'src/brain/runEngine.ts',
  'src/brain/runLifecycle.ts',
  'src/brain/sourceContext.ts',
  'src/brain/transcript.ts',
  'src/desktop/agentRunExecutionAdapter.ts',
  'src/desktop/installedProfileRendererRuntime.ts',
  'src/desktop/packagedProfileProof.ts',
  'src/desktop/profileAgentMutationBarrier.ts',
  'src/desktop/profileAgentRunBridgeHandler.ts',
  'src/desktop/profileAgentRunRendererRuntime.ts',
  'src/desktop/profileAgentRunRendererService.ts',
  'src/electron-api.d.ts',
  'src/graph/agentCardPlacement.ts',
  'src/graph/agentSpatialRead.ts',
  'src/graph/cardAuthorship.ts',
  'src/graph/cardIdentityPresets.ts',
  'src/graph/cardPlacement.ts',
  'src/graph/connectionAddition.ts',
  'src/graph/contextBudget.ts',
  'src/graph/contextContracts.ts',
  'src/graph/contextQuery.ts',
  'src/graph/graphHelpers.ts',
  'src/graph/graphIndex.ts',
  'src/graph/profileLiveAuthorityMerge.ts',
  'src/graph/profileModOrigins.ts',
  'src/graph/profileRendererPersistence.ts',
  'src/graph/resultCardPlacement.ts',
  'src/graph/store.ts',
  'src/graph/types.ts',
  'src/main.tsx',
  'src/mods/card.ts',
  'src/mods/growth.ts',
  'src/mods/identity.ts',
  'src/mods/index.ts',
  'src/mods/model.ts',
  'src/mods/normalizer.ts',
  'src/mods/prompt.ts',
  'src/mods/seeds.ts',
  'src/mods/snapshot.ts',
  'src/persistence/profileAgentChangeTrail.ts',
  'src/persistence/profileAgentCommandInstallation.ts',
  'src/persistence/profileAgentCommandManifest.ts',
  'src/persistence/profileAgentCommandPlan.ts',
  'src/persistence/profileAgentEvent.ts',
  'src/persistence/profileAgentGateway.ts',
  'src/persistence/profileAgentModCommandPlan.ts',
  'src/persistence/profileAgentRunGateway.ts',
  'src/persistence/profileAgentSpatialQuery.ts',
  'src/persistence/profileAssetKernel.ts',
  'src/persistence/profileBuiltInMods.ts',
  'src/persistence/profileGuiProjection.ts',
  'src/persistence/profileGuiSaveScheduler.ts',
  'src/persistence/profileIdeaClosure.ts',
  'src/persistence/profileIdeaIdentityRemap.ts',
  'src/persistence/profileIntentActor.ts',
  'src/persistence/profileLogicalProjection.ts',
  'src/persistence/profileLogicalQuery.ts',
  'src/persistence/profileModRecords.ts',
  'src/persistence/profilePortableArchive.ts',
  'src/persistence/profileRevisionKernel.ts',
  'src/persistence/profileServiceContract.ts',
  'src/persistence/profileTransportContract.ts',
  'src/shared/deepLinks.ts',
  'src/shared/ids.ts',
  'src/shared/stableHash.ts',
  'src/shared/tokenEstimate.ts',
  'src/types/electron-browser-boundary.d.ts',
  'src/ui/cardIdentity.ts',
  'tsconfig.electron.json',
  'vite.config.ts',
  'vite.electron.config.ts',
])

const RUNTIME_PATH_PREFIXES = Object.freeze(CERTIFICATION_PROFILE_RUNTIME_PATHS
  .filter((entry) => entry.endsWith('/**'))
  .map((entry) => entry.slice(0, -2)))
const RUNTIME_PATH_FILES = Object.freeze(CERTIFICATION_PROFILE_RUNTIME_PATHS
  .filter((entry) => !entry.endsWith('/**')))
const NON_RUNTIME_FILE = /\.(?:test|bench|perf)\.[cm]?[jt]sx?$/

// True when `file` is inside the fingerprinted tree named by
// CERTIFICATION_PROFILE_RUNTIME_PATHS. Exported so the workflow-policy suite
// can prove the `dir/**` triggers and this rule stay equivalent.
export function isProfileRuntimePath(file) {
  if (RUNTIME_PATH_FILES.includes(file)) return true
  return RUNTIME_PATH_PREFIXES.some((prefix) => file.startsWith(prefix)) && !NON_RUNTIME_FILE.test(file)
}

// Deterministically fingerprints the tree named by CERTIFICATION_PROFILE_RUNTIME_PATHS
// at an exact Git revision. Pure and side-effect-free beyond the read-only
// `git ls-tree`; used by the certification harness to fail closed on drift, by
// the PR-time scope decision in `.github/workflows/desktop-proof.yml`, and by
// proof-revalidation resolution to recognise a proof run that already covered
// this exact tree.
export function computeProfileRuntimeFingerprint(sourceSha, { cwd } = {}) {
  const listing = spawnSync('git', [
    'ls-tree', '-r', sourceSha, '--',
    ...RUNTIME_PATH_PREFIXES.map((prefix) => prefix.slice(0, -1)),
    ...RUNTIME_PATH_FILES,
  ], { encoding: 'utf8', cwd })
  assert(listing.status === 0, `Profile runtime fingerprint git ls-tree failed: ${listing.stderr}`)
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean).filter((line) => (
    isProfileRuntimePath(line.slice(line.indexOf('\t') + 1))
  )).sort()
  return createHash('sha256').update(`${entries.join('\n')}\n`, 'utf8').digest('hex')
}

// CLOSED HISTORICAL RECORD. Do not append. Do not edit.
//
// These 48 entries were hand-written, one per PR, while proof-reuse
// revalidation was a bookkeeping chore. Revalidation is now resolved live
// from the `Native desktop proof` workflow at dispatch time
// (scripts/certification/proof-revalidation.mjs) and recorded inside the
// certification evidence bundle, so nothing appends here again. The array
// survives for exactly one reason: retained schema-v1 evidence packets cite
// the entry they were sealed against, and those immutable packets must keep
// resolving. `scripts/ci/packaged-certification.test.mjs` pins the length and
// the last entry so a hand append fails in PR CI.
export const CERTIFICATION_PROOF_REVALIDATIONS = deepFreeze([
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '7cf7f270108c9fe5bc2f8fe0e944790162ca0609',
    treeSha256: '89b52becc7cdfc02a10cbd383437268c4e5d77e7465fca6a0d1f6564c31c0bb4',
    evidence: {
      kind: 'certification-provider',
      issue: 527,
      note: 'Original #527 packaged Gateway/CLI/MCP certification provider SHA.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '82ba9f9b45a413e400a14a34c1bc2b5aa9d4044a',
    treeSha256: '1ef532cdb65cd1702615932d1615e5ddbf7735b56ba6f7fd69fc956adc128ae6',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29853441307,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29853441307',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      event: 'push',
      conclusion: 'success',
      note: 'PR #460 (commit 82ba9f9) changed electron/sqliteRuntime.ts, electron/sqliteProfileBlobStore.ts, and electron/sqliteProfileOwnerCapability.ts after #527 landed. The required two-platform native desktop-proof matrix (packaged GUI stamp, offline reopen, JSON CLI, MCP stdio) ran green on this exact pushed main SHA, re-proving the packaged Profile boundary at the changed bytes and re-validating #527 reuse per ADR 0028.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '60d1764aa06020a0d8e4d63c504acb6d40c6ed08',
    treeSha256: '0b531b5164622fb323c1f31ab72df209ef5723f76c30b258547cd2aa4a9541b0',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29893020195,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29893020195',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #709 head 60d1764 added serialized update discovery and consent across the Electron runtime after #527 landed. The required two-platform native desktop-proof matrix (packaged GUI stamp, offline reopen, JSON CLI, MCP stdio) ran green on this exact PR head, re-proving the packaged Profile boundary at the changed bytes and re-validating #527 reuse per ADR 0028.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '8089bc661cffd54d9ccf1f19298e05073e71bb1e',
    treeSha256: '535b3808ef863dfc79895153ae572f67e331475664db861aa6e3029c54e335f0',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29891627455,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29891627455',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #676 (epic #448 slice C1) added electron/keychainStore.ts, electron/keychainBridgeContract.ts, and electron/installedKeychainMainSession.ts, and changed electron/main.ts, electron/preload.ts, and electron/security.ts to move the AI provider credential into Electron-main-owned OS-protected safeStorage behind a new versioned IPC bridge. The required two-platform native desktop-proof matrix (packaged GUI stamp, offline reopen, JSON CLI, MCP stdio) ran green on this exact PR head SHA, re-proving the packaged Profile boundary at the changed bytes and re-validating #527 reuse per ADR 0028.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '8e67937b60f6848528f1c22536663f808453528a',
    treeSha256: '8b96e4c67385b20d3e85798b231d0763dda796ac3d05e1d4a4f860f400859c80',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29894155010,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29894155010',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #707 merge-refresh head 8e67937 combined the already-proven keychain credential and packaged-egress runtime with the already-landed serialized update discovery runtime from main. The conflict resolution preserved both independent bridge integrations without changing the reviewed credential, security, or egress files. The required two-platform native desktop-proof matrix ran green on this exact refreshed PR head, re-proving the composed packaged Profile boundary and re-validating #527 reuse per ADR 0028.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '4039f73a57f8dc6dd11f405f5c611530e4bf009a',
    treeSha256: '4efe72efb8fc37737e538b5cb4c9c7bb98f479d3df80276b428b9199426e3e96',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29897420395,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29897420395',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #728 (epic #448 slice B2) added electron/updateInstallHandoff.ts and electron/updateRestartCoordinator.ts, and changed electron/main.ts, electron/updateMainSession.ts, and electron/updateEndpoints.ts to implement the verified Windows in-place update installer handoff, gating install restart on the joined checkpoint/flushed-receipt persistence drain, plus a follow-up fix so a benign quit-vs-install ownership race aborts the install quietly instead of escalating to a fatal exit. The required two-platform native desktop-proof matrix (packaged GUI stamp, offline reopen, JSON CLI, MCP stdio) ran green on this exact PR head SHA, re-proving the packaged Profile boundary at the changed bytes and re-validating #527 reuse per ADR 0028.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'adfa721ad0a8d4a49ab7eb0a8b25736e7b0b7bd3',
    treeSha256: 'dbfccc28a1192d3dff34bef69d89c664571e9be3787ba3fc3284aaaf92578127',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29904323758,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29904323758',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #708 changed electron/keychainStore.ts so an undecryptable or zero-byte protected-credential blob (OS keychain reset, machine migration, or a corrupted file) degrades to an empty key and is best-effort scrubbed, instead of throwing and fail-closing app startup. No bridge/session/renderer files changed. The required two-platform native desktop-proof matrix ran green on the original exact PR runtime head 6119748; the immediately preceding B2 entry independently proves main\'s Electron changes. Rebase source adfa721 composes those independently proven runtime changes without altering either patch, and its combined fingerprint is recorded here for exact-head revalidation before merge.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '947364c1e59d4fe8406ba4d9426e2c546908edf5',
    treeSha256: 'b43c3577e61c165d39a513f556cc62b50044f749176b9ef606f188341afce2a6',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29932542921,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29932542921',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #777 runtime head 947364c changed the ordinary-Idea bridge and renderer persistence so the native owner-issued createdAt becomes the exact creation timestamp for the new Idea and Board, while retaining strict native authorization equality. The required two-platform native desktop-proof jobs (macOS job 88965719238 and Windows job 88965719296) both ran green on this exact PR runtime head, re-proving the packaged Profile boundary at the changed bytes and re-validating #527 reuse per ADR 0028.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '132ed54a2daaa8ae01e88958da7f171a85912369',
    treeSha256: '11394c629fbf38242527208605609a70750ecdac944ab5d4e2253e6dad0d9594',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29934354881,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29934354881',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #778 runtime head 132ed54 replaced Electron safeStorage with the password-free account-private local credential file, contained valid credential-storage failures outside Profile hydration, disabled the cookie-encryption fuse, and aligned packaged proof with the strict v1 file boundary on top of merged #777. The required two-platform native desktop-proof jobs (macOS job 88971938238 and Windows job 88971938142) both ran green on this exact PR runtime head, including packaged launch, credential round-trip, offline reopen, JSON CLI, MCP stdio, and artifact preservation, re-proving the packaged Profile boundary at the changed bytes and re-validating #527 reuse per ADR 0028.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'c99f589a0e5098766bc801c6f527245ee33272a0',
    treeSha256: '06e147a7c750f183da480a438c57b58eb2db24ca6a90fc0b11fe9bb40b055e19',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29937674838,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29937674838',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 88983329051,
        windows2025X64: 88983329109,
      },
      event: 'workflow_dispatch',
      conclusion: 'success',
      note: 'PR #785 runtime head c99f589 added the DOM-free Mods v2 model, prompt, identity, and normalization foundation and extended fingerprinted src/graph/types.ts with the additive Card.modV2 type seam; the new runtime modules remain unreachable until a downstream integration lane imports them. The authorized exact-head Native desktop proof workflow_dispatch run 29937674838 ran green on this exact runtime head: macOS job 88983329051 and Windows job 88983329109 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, and MCP stdio boundary at the changed bytes and re-validating #527 reuse per ADR 0028. The following ledger-only commit does not change the fingerprinted tree.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'db8d79164909fffaf1604fc047ae5491b0a49235',
    treeSha256: '6127bf1109c5281103067ad9a6bb9f1c186731b85b10d171dbd57eed7bd63146',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29946187280,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29946187280',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 89012026518,
        windows2025X64: 89012026641,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #802 runtime head db8d791 repaired #765\'s packaged Profile v2 proof to stamp an authoritative current built-in Mod, persist and query its distinct native instance identity, and verify offline reopen while aligning the existing smoke with the shared v2 Gateway contract. Native desktop proof run 29946187280 ran green on this exact runtime head: macOS job 89012026518 and Windows job 89012026641 both succeeded, re-proving the packaged Profile v2 stamp and reopen plus JSON CLI and MCP stdio across both release OSes and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'b367ee8bd2456a7dbfe95e426ad4f75ba115513b',
    treeSha256: 'a20a142b2232708d085fb8ad397ecda174b6f80375a5e3c46d5c7b5d94a5254c',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29948336263,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29948336263',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 89019390734,
        windows2025X64: 89019390622,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #804 runtime head b367ee8 compiled current Mods v2 through one shared Ask, Conversation, and Context Peek projection, preserved ordered duplicate-wire provenance through Conversation runs, and deleted the obsolete compiler and Conversation emitter path on top of #765. Native desktop proof run 29948336263 ran green on this exact runtime head: macOS job 89019390734 and Windows job 89019390622 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, and MCP stdio boundary across both release OSes and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '1ece94beef1c5da361bb9f21a26f28a2a34ecd60',
    treeSha256: '0d6937c69148b0ef778cd4ebdb17bf93869ba2c2c9f62166fd120b1c36fa9958',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29949382826,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29949382826',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 89022926014,
        windows2025X64: 89022925982,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #806 runtime head 1ece94b moved the four Agent Gateway Mod verbs onto the v2 document, protected authoritative built-in IDs, preserved nested stamp provenance, and bound clean v2 stamp audit evidence to independently anchored source history while retaining strict historical reopen. Native desktop proof run 29949382826 ran green on this exact runtime head: macOS job 89022926014 and Windows job 89022925982 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, and MCP stdio boundary across both release OSes and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '1641c7d59f9b9510906ac677db1d7d9b51fa3c82',
    treeSha256: '8133d6b6dad29e68bce3756b243849bb6b9aedf433d296af19e95ffe65b7cf06',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29951936960,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29951936960',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 89031518759,
        windows2025X64: 89031518829,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #809 runtime head 1641c7d completed #750 across the single-class Mod canvas, shared Ask and Conversation compilation, Profile v2 storage, Agent Gateway commands, and the v2-only cutover while preserving immutable historical run provenance and composing the latest default-main canvas fixes. Native desktop proof run 29951936960 ran green on this exact runtime head: macOS job 89031518759 and Windows job 89031518829 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, and MCP stdio boundary across both release OSes and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'c3327687aa8de370970b7adfb98fc84d314b3ab6',
    treeSha256: '134194e55fdacf7e7e09114b9c34230b11972e1867161bf0856d859bbc61124b',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 29960078671,
      runUrl: 'https://github.com/limweili/eido/actions/runs/29960078671',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 89058736363,
        windows2025X64: 89058736306,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #815 runtime head c332768 (#813) added the recovery-only start-fresh escape hatch: an incompatible or unreadable Profile is set aside byte-for-byte in the recovery quarantine through a resumable reserved/quarantined/staged/promoted/completed sidecar operation, a freshly seeded Profile is promoted in its place, and the packaged bridge, utility protocol, router, and repair screen gained the matching start-fresh operation. Native desktop proof run 29960078671 ran green on this exact runtime head: macOS job 89058736363 and Windows job 89058736306 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, and MCP stdio boundary across both release OSes and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'fd96ebc73ff43534e2f6e5b1fb9437819ad68535',
    treeSha256: '5e40cfb038d2c880231768b914a1c78ae861007943a69a69eb7a2b727aa9d0e5',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 30331914885,
      runUrl: 'https://github.com/limweili/eido/actions/runs/30331914885',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 90188745141,
        windows2025X64: 90188745123,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #821 runtime head fd96ebc repaired the locked optional @emnapi/wasi-threads version required by the pinned npm clean install and overrode MDXEditor\'s vulnerable js-yaml dependency without changing Profile source or public contracts. Native desktop proof run 30331914885 ran green on this exact runtime head: macOS job 90188745141 and Windows job 90188745123 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, and MCP stdio boundary across both release OSes and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '9e351e1ee00686720184a294f49d83a4d4c5d7c5',
    treeSha256: '22e3a38c189a16aa67b86dc12587414650918809be2e9d24cfb8168f459725b5',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 30338368827,
      runUrl: 'https://github.com/limweili/eido/actions/runs/30338368827',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 90208141515,
        windows2025X64: 90208141429,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #823 runtime head 9e351e1 recovered and completed the canvas and Ask AI quality-of-life pass, including the canonical Result follow-up composer, Markdown presentation, and cross-LOD selection behavior. Native desktop proof run 30338368827 ran green on this exact runtime head: macOS job 90208141515 and Windows job 90208141429 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, and MCP stdio boundary across both release OSes and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '28dae15526a24a12d40e1b1ce3877c0072cc8e09',
    treeSha256: 'f34df76ff46f6ff00eb93a5ce522991ef6af601f78d1d707d425eba458a6321f',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 30339707154,
      runUrl: 'https://github.com/limweili/eido/actions/runs/30339707154',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 90212281305,
        windows2025X64: 90212281244,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #822 runtime head 28dae15 refreshed ten locked patch/minor dependencies, including Electron, MDXEditor, the Model Context Protocol SDK, XYFlow, Playwright, Vite, and Vitest, without changing Profile source or public contracts. Native desktop proof run 30339707154 ran green on this exact runtime head: macOS job 90212281305 and Windows job 90212281244 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, and MCP stdio boundary across both release OSes and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '7d16440dd7813923304e6c6b93775133374d6b6e',
    treeSha256: 'cfb3500f1f32749dec4c9b67618ca973a878ea419cbe587393eada5394083039',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 30340554013,
      runUrl: 'https://github.com/limweili/eido/actions/runs/30340554013',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 90214962407,
        windows2025X64: 90214962237,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #822 runtime head 7d16440 retained the six patch/minor dependency updates that stayed within the audited bundle and interaction constraints: Electron, the Model Context Protocol SDK, zip.js, Immer, Playwright, and Vitest. Native desktop proof run 30340554013 ran green on this exact runtime head: macOS job 90214962407 and Windows job 90214962237 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, and MCP stdio boundary across both release OSes and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'ebe48727baa48b69c530d61a515f439ceb848a89',
    treeSha256: '3370c4fb51f95c0b84288269076766da13fc16eff30016e01302f19337f5da0e',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 30341706399,
      runUrl: 'https://github.com/limweili/eido/actions/runs/30341706399',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 90218544355,
        windows2025X64: 90218544396,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #758 runtime head ebe4872 composed the Friends Alpha standalone Agent CLI, same-user live Gateway, surface-v3 mutations, spatial/history reads, and delegated Runs with the current QOL and audited dependency baseline. Native desktop proof run 30341706399 ran green on this exact runtime head: macOS job 90218544355 and Windows job 90218544396 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '20ecd641562157f46398f44726e83a59b362473e',
    treeSha256: '133933a64514a4d66f1669d515c78c07d998ff5b322216fec0ea4f4c1b5d53ab',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 30437236380,
      runUrl: 'https://github.com/limweili/eido/actions/runs/30437236380',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 90527738442,
        windows2025X64: 90527738405,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #825 runtime head 20ecd64 moved whole-Profile capture off the synchronous packaged note-input path while preserving immediate editor state and flushing the latest renderer state at editor completion, lifecycle operations, Agent barriers, and authoritative checkpoints. Native desktop proof run 30437236380 ran green on this exact runtime head: macOS job 90527738442 and Windows job 90527738405 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'f7d1cdbd745606f72fcc7f11b5eb7bdc4983e1b7',
    treeSha256: '9451de9743865482d20022e56565aaa1852fb101cbf9f10a6d46b101bad010e7',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 30446862841,
      runUrl: 'https://github.com/limweili/eido/actions/runs/30446862841',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 90559265894,
        windows2025X64: 90559265956,
      },
      event: 'workflow_dispatch',
      conclusion: 'success',
      note: 'PR #827 integrated runtime head f7d1cdb composed current main with the canvas LOD, Markdown, and Result follow-up changes. Its fingerprinted delta is limited to shared words and UI tokens used by packaged Card identity; no Profile, Gateway, persistence, or save-format behavior changed. Native desktop proof run 30446862841 ran green on this exact integrated head: macOS job 90559265894 and Windows job 90559265956 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'ccdca05bb2af6dcfb79c0fc2e8f0ab9e4a9c00e5',
    treeSha256: '07b266a46f1a48d9acfccd87ee3805e90df93c141dd314118aef1d73d06db8ea',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 30985189023,
      runUrl: 'https://github.com/limweili/eido/actions/runs/30985189023',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 92238236626,
        windows2025X64: 92238236658,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #842 runtime head ccdca05 adds copy-first automatic Profile salvage, verified recovery generations, record-axis-1 adjacent-Board repair, and a narrow APFS remount rebind when only st_dev changed while inode, birth time, Profile identity, revision high-water, logical projection, and blobs still validate. Native desktop proof run 30985189023 ran green on this exact runtime head: macOS job 92238236626 and Windows job 92238236658 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '7fb53466e68aba0a0b67b5868698e9a3f25b2c41',
    treeSha256: 'cf11e12230396679196efa2dccadddca7fa9965cad57b308f4606bfee4dbe9cd',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 30987923522,
      runUrl: 'https://github.com/limweili/eido/actions/runs/30987923522',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 92246910298,
        windows2025X64: 92246910210,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #843 runtime head 7fb5346 restores the canonical exact-15 Agent command discovery order used by packaged certification and expands native-proof path policy so future Agent Gateway changes cannot bypass the two-platform boundary. Native desktop proof run 30987923522 ran green on this exact runtime head: macOS job 92246910298 and Windows job 92246910210 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '34cff5233e5f091a53c814d8c02c7c828f0d7eb2',
    treeSha256: 'de9d0bf29be8abda073a53f6cf779990de84abc2f14110524e37008bc9fb8baf',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31503068324,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31503068324',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 93817725512,
        windows2025X64: 93817725393,
      },
      event: 'workflow_dispatch',
      conclusion: 'success',
      note: 'PR #847 runtime head 34cff52 changes one fingerprinted file, src/ui/tokens.ts, and changes only declarative design-token values in it: the daylight interactive boundary, the daylight functional ink twins, and the night surface ladder. No Profile, Gateway, persistence, bridge, or renderer-runtime file moved, and no token feeds a boundary decision. The path set covers the Card-identity token closure by design, so the fingerprint fails closed regardless of what inside tokens.ts moved. Native desktop proof run 31503068324 was dispatched at this exact runtime head and ran green: macOS job 93817725512 and Windows job 93817725393 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commits retain this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'f68442628b81184ee95e86fbc0abf2fa3bf9e826',
    treeSha256: '60fb125704e2fbfa1cfdb74b6f02bd5bbf40aa72e179b8309c8571bbea15ad04',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31572724444,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31572724444',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94037990735,
        windows2025X64: 94037990873,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #850 runtime head f684426 adds production-only PostHog app-open analytics, permits only the official US and EU PostHog ingest origins through the Electron CSP, and keeps all Profile, canvas, thought, prompt, and provider data out of the event. No Profile, Gateway, persistence, bridge, or save-format behavior changed. Native desktop proof run 31572724444 ran green on this exact runtime head: macOS job 94037990735 and Windows job 94037990873 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'ce998dafac1ad633a1f1f80d57e5c8db9a2af350',
    treeSha256: '7b53999bf65d43554c4a1a8718e6c0ac2b8581cfa9e95b4abd13c7490933e228',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31596310908,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31596310908',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94112584972,
        windows2025X64: 94112585118,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #850 runtime head ce998da expands PostHog into explicit-consent, production-only product analytics with a persistent installation pseudonym, per-launch session IDs, a closed typed event contract, main-process transport, privacy controls, and outcome-bound canvas, AI, import, export, onboarding, and feature-adoption events. The analytics settings live outside the Profile and private content remains outside event properties. Native desktop proof run 31596310908 ran green on this exact runtime head: macOS job 94112584972 and Windows job 94112585118 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'aec4ccc0daf42f4256fa47ffa9b83046173b9461',
    treeSha256: 'ff26eeaf920c8865af3f6326c3b39215326fa2935906ba0cdd89898a9bab7469',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31606394352,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31606394352',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94146318293,
        windows2025X64: 94146318211,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #850 runtime head aec4ccc changes only the founder-approved analytics-consent copy in src/shared/words.ts. No analytics event, transport, identity, privacy, Profile, Gateway, persistence, bridge, or save-format behavior changed. Native desktop proof run 31606394352 ran green on this exact runtime head: macOS job 94146318293 and Windows job 94146318211 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '954952df13cf4cfc0686097069f2a1970dc7a923',
    treeSha256: '3e99e4e809ac550e719c9b407b0862a296f3fcae3e003bdcc34597226def55ff',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31723618499,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31723618499',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94526437304,
        windows2025X64: 94526437356,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #852 runtime head 954952d changes playback projection and transport presentation so recorded events advance at equal intervals with 2×, 5×, and 10× controls and a minimal 90vw transport. No Profile, Gateway, persistence, bridge, save-format, or timestamp-storage behavior changed. Native desktop proof run 31723618499 ran green on this exact runtime head: macOS job 94526437304 and Windows job 94526437356 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'ee1143db7d3dda3e04bdbec452e3248a6eca0371',
    treeSha256: 'c7793ab2501ff0237b7e9132256ae335c232331da22f5a2433bfa60aafae0112',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31790198552,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31790198552',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94735143035,
        windows2025X64: 94735143184,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #884 runtime head ee1143d adds a provider-neutral Electron boundary for locally authenticated AI harness CLIs and records provider identity with AI runs. It does not change the SQLite schema, Profile ownership, blob storage, or Gateway/CLI/MCP contracts. Native desktop proof run 31790198552 ran green on this exact runtime head: macOS job 94735143035 and Windows job 94735143184 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '248a7aa354d7021f9dd72f05449c0216e31488b9',
    treeSha256: '542d94de52c4201878495e6acd3aa2b1a5c627b2f24ae9f2164e8792f4b00027',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31797404819,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31797404819',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94757407450,
        windows2025X64: 94757406107,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #884 runtime head 248a7aa completes adversarial hardening of the local AI harness boundary: joined process-tree shutdown, strict Conversation provider/model continuation provenance, documented Claude effort mapping, Antigravity answer-event filtering, streamed/terminal output reconciliation, and bounded incompatible-output errors. It does not change the SQLite schema, Profile ownership, blob storage, or Gateway/CLI/MCP contracts. Native desktop proof run 31797404819 ran green on this exact runtime head: macOS job 94757407450 and Windows job 94757406107 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '69367959d24eb6bf52caa9d854cd1f5a0c2e15d0',
    treeSha256: '808a4b30749e49e39f36bfad8a1f661b56bf46ed1ff2e2c1dc337ffde4211c57',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31817505278,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31817505278',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94822612397,
        windows2025X64: 94822612408,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #885 runtime head 6936795 composes the optional Eido Account and Hosted AI bridges, provider-neutral BYOK/Hosted/local execution planning, Account presentation/runtime, and strict main-process Hosted request authority while preserving local Profile, Board, Gateway, CLI, and MCP ownership. It also fixes the packaged preload boundary so renderer and preload bundles do not import main-only Node modules. Native desktop proof run 31817505278 ran green on this exact pushed head: macOS job 94822612397 and Windows job 94822612408 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '56f014ee1a88e91ac1d4c0c764ace265e25fa2a7',
    treeSha256: 'ab9cc506c3812e0d0be3ac6e995f76106fdaac2514f512c5c3ae9eb3654f5da8',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31819502320,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31819502320',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94829107856,
        windows2025X64: 94829107960,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #885 runtime head 56f014e moves packaged Profile, Account, Hosted AI, and global recovery ownership into an explicit desktop renderer island while compiling those authorities out of the browser build. Normal desktop and release packaging use the real desktop target, the browser remains BYOK-only, StrictMode cleanup revokes Hosted authority, and the production bundle stays within both size budgets. Native desktop proof run 31819502320 ran green on this exact pushed head: macOS job 94829107856 and Windows job 94829107960 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '50dff8114b6b02ce4b2da3b579772bd047e83edd',
    treeSha256: 'fa4cb853cd69a0ac6a70b0f99fa74126989e8ad6578611b61ba484c9b8608651',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31824126562,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31824126562',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94844092577,
        windows2025X64: 94844092522,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #889 runtime head 50dff81 makes Result follow-up authority begin before asynchronous AI access admission, binds pending and live work to its exact Board/version destination, exposes truthful pending cancellation to the renderer, suppresses canceled late denials, and revokes work when that destination is lost while preserving it across unrelated authoritative Profile updates. Native desktop proof run 31824126562 ran green on this exact pushed head: macOS job 94844092577 and Windows job 94844092522 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '9500d5dfa38e8697541b3c2760e00cd05b4a5dfe',
    treeSha256: 'e4d4d349eb38f43761ed48cf0011d46a48dac6bd228be1f7a2d42b3cd901262e',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31825264837,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31825264837',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94848953393,
        windows2025X64: 94848952285,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #889 runtime head 9500d5d completes the Result follow-up lifecycle repair while preserving the Graph Index as the single Result-card/output lookup authority for authoritative Board replacement and deletion. The exact destination-provenance comparison and selective cancellation behavior are unchanged from the independently reviewed runtime. Native desktop proof run 31825264837 attempt 2 ran green on this exact pushed head: macOS job 94848953393 and Windows job 94848952285 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only and documentation commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '604754ccd9dffbe547f1e7661b1bce76776b5c97',
    treeSha256: '960fc0bbd04a9069af6e6429bdf88748ae68682d698139e7d0f84e68647c98a9',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 31837569000,
      runUrl: 'https://github.com/limweili/eido/actions/runs/31837569000',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 94887166586,
        windows2025X64: 94887166525,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #896 runtime head 604754c adds a fail-closed injected Paid Hosted route and private model catalog over the existing strict Electron main/IPC/OpenRouter transport, while live composition remains explicitly Free-only without real reconciliation-backed delivery and provider-usage finality. It also serializes each Free or Paid reservation finish through one per-operation promise across normal completion and revocation. Native desktop proof run 31837569000 ran green on this exact pushed head: macOS job 94887166586 and Windows job 94887166525 both succeeded, exercising the native Live Gateway security seam and re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. This evidence does not claim a real Paid-provider execution. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '8416ce24dc65538b49d6d26388ad817096a9ec26',
    treeSha256: 'dc814cd31c6799ff856813564e8a709908ff248245d432c5a8d95950e722b521',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32141256518,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32141256518',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 95724177840,
        windows2025X64: 95724177728,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #955 runtime head 8416ce2 gives an Ask AI Card its own web reach and puts Linkup behind it. Inside the fingerprinted tree the change is the OpenRouter boundary running the tool loop itself (openRouter.ts), the run engine building the tool set and carrying research depth and job identity (runEngine.ts), the Card and run shapes that hold reach, depth, tool steps and the wire record (types.ts, store.ts, main.tsx), the persisted validator admitting those same fields (profileLogicalProjection.ts), and user-visible words (words.ts). The persisted validator widens by addition only: existing records stay valid, and the SQLite schema, Profile ownership, blob storage, and Gateway/CLI/MCP contracts are untouched. The packaged network boundary widened at #957 to Linkup and the keyless page reader, which is a reviewed diff in electron/protocol.ts and now matched by the packaged proof. Native desktop proof run 32141256518 ran green on this exact runtime head: macOS job 95724177840 and Windows job 95724177728 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '768e57cb6305bace9aeb904127d15b0a81203ee9',
    treeSha256: '7a17bba800af3be99e2a7006ea6f5a9fb795231d75cc48e52f208ee9c0f77ea2',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32145907750,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32145907750',
      jobs: [
        'Native desktop proof \u2014 macos-15 (arm64)',
        'Native desktop proof \u2014 windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 95739460209,
        windows2025X64: 95739460265,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #955 head 768e57cb merges main and renumbers this epic ADRs around main own ADR 0032. Nothing that runs changed since the 8416ce2 entry: the whole delta inside the fingerprinted tree is 13 comment lines in openRouter.ts, runEngine.ts, store.ts, types.ts, profileLogicalProjection.ts and words.ts, each an ADR citation moving up one number. The fingerprint is taken over file content rather than over compiled output, so a comment counts and the previous record could not be reused. The behaviour this proves is therefore the same behaviour entry 16 proved, re-established at the exact merged head the reviewer will read. Native desktop proof run 32145907750 ran green on it: macOS job 95739460209 and Windows job 95739460265 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '5a83d8a0b39411af9fa0adb182894bd9d6f9df9c',
    treeSha256: '329f2f979274941b6df0c8179e37eae301675b2d33f01b9a115cb4e6e1d55c1c',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32148870196,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32148870196',
      jobs: [
        'Native desktop proof \u2014 macos-15 (arm64)',
        'Native desktop proof \u2014 windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 95749397178,
        windows2025X64: 95749397381,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #979 head 5a83d8a asks an Eido-owned hostname for the update feed. Inside the fingerprinted tree the whole delta against main is electron/updateEndpoints.ts: the feed origin constant, updateFeedAssetUrl building that address instead of a provider URL, and the allowlist admitting the feed hostname at a single asset path while keeping the GitHub redirect hops it currently lands on. No request loosens: every hop is still validated before it is contacted. The head also carries main at 776b8eff, whose runtime tree entry 17 proved at 768e57cb, so this entry re-establishes that proof at the merged head plus the address change. Nothing touches the SQLite schema, Profile ownership, blob storage, or Gateway/CLI/MCP contracts. Native desktop proof run 32148870196 ran green on this exact runtime head: macOS job 95749397178 and Windows job 95749397381 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'a931ee7290120517449f2f84eef1c22a60669e04',
    treeSha256: '7e1b8be5c3685527af2869b541d3da93a7f7f301ca127398bfe3b9149339638c',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32154584199,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32154584199',
      jobs: [
        'Native desktop proof \u2014 macos-15 (arm64)',
        'Native desktop proof \u2014 windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 95768594949,
        windows2025X64: 95768595463,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'Integration head a931ee72 carries the 2026-08-19 orchestration run for epic #853 onto the monetization branch. Inside the fingerprinted tree the delta is the merge of main PR #955 reach work with this epic AI access resolver across src/brain, the composite account snapshot v2 projection across electron/ and src/desktop, the provider mutation finality authority (service only, outside this path set), the src/brain/webReachMode.ts to src/brain/reachMode.ts rename with its symbol updates, and ADR citation renumbering in comments. The persisted card meta key value stays reachMode, so no Board projection changed. Native desktop proof run 32154584199 ran green on this exact head: macOS job 95768594949 and Windows job 95768595463 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes, and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged because scripts/certification is outside the profile-runtime-v1 path set.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '362f9c0daf1be7263099b1eb31733794f26811e7',
    treeSha256: '877d52d189609fda8aa2da6f353d410b5fed0277bc3776e7e6cb50648b579655',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32241660866,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32241660866',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 96033429176,
        windows2025X64: 96033428917,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #1052 head 362f9c0d carries the whole signed update-delivery lane (#793, #977, #978, #972) and the production macOS signing lane (#696) onto main at ba9f04c4, so the delta inside the fingerprinted tree is the largest since entry 1 and is described here rather than enumerated. New modules: updateFreshnessStore (monotonic publishedAt with an upper bound against local time), updateRecallStore (recall persisted across restarts), updateFeedPublicKey (the compiled Ed25519 key), macosDmgVerifier (Developer ID and Gatekeeper verification pinned to team 5NKAWT8L78 before the image is mounted, plus 0o700 staging and an exclusive 0o600 write), and macosAppSwapPort (stage beside the target, complete by rename, roll back on failure, paths passed as positional arguments, target derived from process.execPath). Changed: updateFeed verifies the signature over raw bytes before any parsing and rejects malformed recall fields; updateDiscovery surfaces a persisted recall on every path that fails to yield a verified manifest, not only when the feed is unreachable; updateEndpoints retires the GitHub release and CDN hops now that R2 serves the feed directly, leaving one asset path on the owned hostname; updateOrchestrator holds the renderer download URL to the manifest trust rules and the recall drain to a flushed receipt; updateBridgeContract carries the flush evidence; updateMainSession and updateInstallHandoff wire the macOS in-place path. Nothing touches the SQLite schema, Profile ownership, blob storage, or the Gateway, CLI and MCP contracts. The head also carries main at ba9f04c4, whose runtime tree entry 18 proved at 5a83d8a0, so this entry re-establishes that proof at the merged head plus the update-delivery and signing deltas. Native desktop proof run 32241660866 ran green on this exact runtime head: macOS job 96033429176 and Windows job 96033428917 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'a40a4e440f7129beebaa195ac50ac9f3f2fc2a1a',
    treeSha256: '1a1ee632b2ff51b5a12c9b965f7ecd2760a912497f110f41a73d8541df496f8f',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32251304288,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32251304288',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 96062717551,
        windows2025X64: 96062717767,
      },
      event: 'workflow_dispatch',
      conclusion: 'success',
      note: 'PR #1064 head a40a4e44 changes exactly one file inside the fingerprinted tree: src/shared/words.ts gains settingsSaveFailed, the sentence Settings shows when the OS credential store refuses the key write. Nothing inside electron/, the Gateway, the CLI, the MCP relay, the SQLite schema, or Profile ownership changes; the rest of the PR (ModalShell initial focus, the SettingsModal close paths, the overlay stylesheet) sits outside the fingerprinted closure. Native desktop proof run 32251304288 ran green on this exact runtime head: macOS job 96062717551 and Windows job 96062717767 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes, and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '4a32b33ca3a90260f6156ce8dc165446a9db6d62',
    treeSha256: '060c4f1e6e471add2abcc4f38edecec92ca17a00447c7143ac716bb9382be83f',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32269583562,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32269583562',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 96122461848,
        windows2025X64: 96122461700,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #1071 head 4a32b33c adds automatic context compaction to a Result Card and to the agentic tool loop. Four files inside the fingerprinted tree change: src/brain/openRouter.ts (loop compaction, the typed context-overflow refusal, and reading the usage every stream already reports), src/brain/modelWindows.ts (context windows read from OpenRouter public model catalog instead of a hand-kept table, plus device-local corrections a provider proved by refusing), src/brain/runLifecycle.ts (one added error-message branch), and src/shared/words.ts (two added strings). Nothing inside electron/, the Gateway, the CLI, the MCP relay, the SQLite schema, or Profile ownership changes. The same head also amends scripts/electron/packaged-smoke.mjs, which is outside the fingerprinted closure: the packaged surface proof pinned the ABSENCE of the model-list endpoint that #676 had deleted as dead code, and now pins its presence because the catalog is load-bearing; the zero-external-request egress proof is unchanged and still green. Native desktop proof run 32269583562 ran green on this exact head: macOS job 96122461848 and Windows job 96122461700 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes, and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '8c6f5a46097c9dbaf06ff66aa7bbd841760c625e',
    treeSha256: '2ac2d6e95bea4f4bc7780c419f75b52ed3564dd1801af80a2065a138dee8dee9',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32279841298,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32279841298',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 96155742694,
        windows2025X64: 96155743202,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #1102 head 8c6f5a46 renames the Hosted AI model catalog property from tier to fundingRoute across the served snapshot, the Electron main validator, and the renderer model filter (issue #1079). This entry re-baselines two separate deltas, because the epic branch had already drifted without an append before this branch existed. At base head 0ae265d8 the recomputed fingerprint was already 5636a221 rather than the 7e1b8be5 entry 39 recorded at a931ee72, so the required gate was red on the epic branch for reasons unrelated to this rename. That inherited drift is nine lane merges (#1040, #1041, #1042, #1043, #1044, #1045, #1047, #1051, #1060) across the capability gate, account session, and CLI gate lanes, changing 16 files inside the fingerprinted tree: electron/accountControlPlaneClient.ts, electron/accountRefreshTokenStore.ts, electron/desktopAccountConfiguration.ts, electron/desktopAccountSession.ts, electron/eidoCliEntitlement.ts, electron/eidoCliEntitlementStore.ts, electron/eidoCliGate.ts, electron/localCredentialStore.ts, electron/main.ts, electron/profileJsonCli.ts, electron/profileLiveGatewayServer.ts, src/brain/runEngine.ts, src/brain/runLifecycle.ts, src/graph/store.ts, src/persistence/profileAgentGateway.ts, and src/shared/words.ts. PR #1073 is the merge immediately before the base head and is docs-only, two Markdown files, so it contributed nothing to the drift and must not be read as its cause. On top of that inherited set this branch changes only electron/accountControlPlaneClient.ts; the new electron/hostedSnapshotFundingRouteWire.test.ts is outside the path set, which excludes test files. Nothing here touches the packaged Profile boundary, because the renamed field is a hosted account snapshot wire property and no published build carries the account settings or any control plane client code at all. A cheaper shape was available and was not taken: a green proof run already existed on the base head, so two appends would have separated the inherited drift from this branch at no extra cost. Native desktop proof run 32279841298 ran green on this exact PR head: macOS job 96155742694 and Windows job 96155743202 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes, and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged because scripts/certification is outside the profile-runtime-v1 path set.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '4c875be589e107901fd55fa5f058d74f9337e2a3',
    treeSha256: '9686174fe4787c098019b6ef9b5b0f95045bda53e34abf5c3125f3797c11fb94',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32288275906,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32288275906',
      jobs: [
        'Native desktop proof \u2014 macos-15 (arm64)',
        'Native desktop proof \u2014 windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 96185189534,
        windows2025X64: 96185189200,
      },
      event: 'workflow_dispatch',
      conclusion: 'success',
      note: 'PR #1106 head 4c875be5 tells a paying subscriber that a withheld capability is paused rather than telling them to subscribe (issue #1095). Inside the fingerprinted tree the delta is one file, src/shared/words.ts, which adds the withheld upgrade-screen title, reason, and detail plus the withheld capability-row label and detail. Everything that routes on those words lives outside this path set: src/desktop/hostedUpgradePresentation.ts, src/desktop/hostedAccountPresentation.ts, src/canvas/SettingsModal.tsx, and three control-plane domain files. Nothing under electron/ is touched and no published build carries any of it. The change is what a locked control says and which copy identifier its press forwards, never what an account may do: a withheld entry\'s state stays unavailable before and after, which is what the capability gate reads. No inherited drift needs separating here, so this entry re-baselines only this branch delta. The base head b7bdd5c4 recomputes to 2ac2d6e95bea4f4bc7780c419f75b52ed3564dd1801af80a2065a138dee8dee9, exactly the treeSha256 the previous entry recorded at 8c6f5a46, which is the cheaper two-entry shape that entry said was available and not taken. Native desktop proof run 32288275906 ran green on this exact head: macOS job 96185189534 and Windows job 96185189200 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes, and re-validating #527 reuse per ADR 0028. That green is attempt 2, and attempt 1 failed. Recorded rather than smoothed over, so a later reader comparing run numbers is not left with an unexplained failure. Attempt 1 jobs 96182896658 (macOS) and 96182897103 (Windows) both failed at the same step, Exercise the native Live Gateway security seam, each hitting that step\'s three-minute limit with no test output at all from the second command in it, scripts/electron/profile-live-gateway-helper.test.mjs. Every wait inside that file is capped at ten seconds, so the stall sat ahead of them, in the unbounded native compiler invocation that file builds its helper with. Read as environmental rather than a fault in this code, on the strongest evidence available: run 32288279147 for PR #1108, whose head carries this branch delta plus more, ran the identical step to success at the same wall-clock minute, in 12 seconds on macOS and 41 seconds on Windows. One caveat on the cause, since three proof runs were dispatched together: GitHub hosted runners are separate virtual machines, so shared CPU is not the mechanism, and any contention would have to be external to the runner, such as a toolchain or package fetch. Event is workflow_dispatch rather than pull_request because the proof workflow\'s pull_request path filter covers 15 of the 84 files this fingerprint names and not src/shared/words.ts, so the gate went red with no run able to clear it through the normal flow; that mismatch is recorded on issue #1107 and is not resolved here. The following ledger-only commit retains this runtime fingerprint unchanged because scripts/certification is outside the profile-runtime-v1 path set.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '2d388f9b24d712d9e11cefa8fb1c2099a49bce61',
    treeSha256: '939506605aaba226f0279f275a4829c2e796df8434d78d5c0c38057e311c9d35',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32288279147,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32288279147',
      jobs: [
        'Native desktop proof \u2014 macos-15 (arm64)',
        'Native desktop proof \u2014 windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 96182907350,
        windows2025X64: 96182907061,
      },
      event: 'workflow_dispatch',
      conclusion: 'success',
      note: 'PR #1108 head 2d388f9b makes every locked control say what state it is in and route somewhere (issue #1096). Stacked on PR #1106, so this entry cites only its own delta, measured from 4c875be5 rather than from the base of the stack: the previous entry already re-baselined that branch and its treeSha256 is the one this one supersedes. Inside the fingerprinted tree the delta is again one file, src/shared/words.ts, which adds the lockedControlName helper that builds a locked control\'s accessible name from the capability entry\'s own copy identifier, the paused half of that name, the words for a Hosted model row locked because the account cannot run rather than because a plan is missing, and a paused placeholder for the locked Linkup key field. The ten other changed files are outside this path set: src/canvas/SettingsModal.tsx, src/canvas/cards/AskAiCard.tsx, src/canvas/hosted/useCapabilityGate.ts, src/desktop/installedHostedAccountRuntime.ts, src/styles/100-overlays.css, docs/codebase/CONCERNS.md, and four test files, which the fingerprint excludes by rule. Nothing under electron/ is touched and no published build carries any of it. Shown versus permitted is unchanged throughout: every edit is to the words a control wears and the screen its press opens, and no display state decides what an account may do. Native desktop proof run 32288279147 ran green on this exact head at the first attempt: macOS job 96182907350 and Windows job 96182907061 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes, and re-validating #527 reuse per ADR 0028. This run is also the evidence the previous entry leans on for reading its own first-attempt failure as environmental, because this head carries that branch delta plus more and ran the step that timed out there to success at the same wall-clock minute. Event is workflow_dispatch rather than pull_request for the same reason recorded in the previous entry: the proof workflow\'s pull_request path filter covers 15 of the 84 files this fingerprint names and not src/shared/words.ts, so the gate cannot be cleared through the normal flow. That mismatch is recorded on issue #1107 and is not resolved here. The following ledger-only commit retains this runtime fingerprint unchanged because scripts/certification is outside the profile-runtime-v1 path set.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: '5f0f3fe20359b690c988ca32b0f205854e8438be',
    treeSha256: '07e653af67c5baa4d1460ec067491812fe4a8c97956bd651eef8b0e01237f6d8',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32322268004,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32322268004',
      jobs: [
        'Native desktop proof — macos-15 (arm64)',
        'Native desktop proof — windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 96286638283,
        windows2025X64: 96286638077,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #1069 head 5f0f3fe2 composes the macOS in-place update repair with main at 8c229f9b. The update delta is confined to the update path: macosUpdateStagingRoot.ts gives every attempt its own root so an interrupted attempt can no longer poison the next one, macosAppSwapPort.ts replaces the silent detached shell with a logged, bounded, rename-based exchange that copies with /usr/bin/ditto and verifies the outcome after the rename rather than trusting its exit code, macosDmgVerifier.ts adopts the same copy tool, updateInstallHandoff.ts and updateMainSession.ts route every abandon path to a surface the person actually sees and reconcile the previous attempt at the next launch, updateAttemptJournal.ts and updateDiagnosticsLog.ts record what happened, updateBridgeContract.ts and updateOrchestrator.ts carry install progress and outcomes to the renderer, productAnalyticsContract.ts and productAnalyticsService.ts add the two consent-gated update events with a closed failure-code set and a hand-named property allowlist, and UpdateNotice.tsx with words.ts and 130-update-notice.css report progress and failure to the person. The merged half carries #1071 run and Result Card compaction, whose own runtime entry recorded 4a32b33c. Nothing on either side touches the SQLite schema, Profile ownership, blob storage, recovery, or the Gateway, CLI, and MCP contracts. Native desktop proof run 32322268004 ran green on this exact composed head: macOS job 96286638283 and Windows job 96286638077 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes, and re-validating #527 reuse per ADR 0028. The following ledger-only commit retains this runtime fingerprint unchanged.',
    },
  },
  {
    schemaVersion: 1,
    pathSet: 'profile-runtime-v1',
    revalidatedSourceSha: 'fa457ac40d80ee2e7f6cc77e5479d0f79a3b4207',
    treeSha256: 'efbaecdb8e1d927d969696a6b671eaf41de6f9a568da93bcdb344db17fa718f9',
    evidence: {
      kind: 'native-desktop-proof-workflow-run',
      workflow: 'Native desktop proof',
      runId: 32348075434,
      runUrl: 'https://github.com/limweili/eido/actions/runs/32348075434',
      jobs: [
        'Native desktop proof \u2014 macos-15 (arm64)',
        'Native desktop proof \u2014 windows-2025 (x64)',
      ],
      jobIds: {
        macos15Arm64: 96361007392,
        windows2025X64: 96361007096,
      },
      event: 'pull_request',
      conclusion: 'success',
      note: 'PR #1132 head fa457ac4 renames the served hosted account snapshot section that says whether a subscription is current from plan to subscription, so that in Eido plan means only an Execution Plan (issue #1084). Inside the fingerprinted tree the delta is four files. Three are under electron/: accountControlPlaneClient.ts, where the exact key set, the section validator, and the relationship checks move to the new name and the retired hosted-plan copy identifiers become hosted-subscription; desktopAccountController.ts, where the subscribe precondition reads the renamed section; and eidoCliEntitlement.ts, one comment line. The fourth is src/shared/words.ts, which renames the account panel and upgrade-screen message identifiers from plan to subscription. The English copy those identifiers resolve to is unchanged, so nothing a person reads moves here; naming the Tier to the person is issue #1085. Six further electron/ files changed are tests, which the fingerprint excludes by rule, including the new electron/hostedSnapshotSubscriptionSectionWire.test.ts that pins the desktop half of the renamed wire contract with hand-written literals. Nothing here touches the packaged Profile boundary: the renamed section is a hosted account snapshot wire property, and no published build carries the issuer, client id, and control plane origin needed to fetch a snapshot at all, so no installed copy has ever validated one. No inherited drift needs separating here, which is the cheaper two-entry shape a previous entry recommended: base head 294e0ccd recomputes to 939506605aaba226f0279f275a4829c2e796df8434d78d5c0c38057e311c9d35, exactly the treeSha256 the previous entry recorded at 2d388f9b, so this entry re-baselines only this branch delta. Native desktop proof run 32348075434 ran green on this exact head at the first attempt: macOS job 96361007392 and Windows job 96361007096 both succeeded, re-proving the packaged GUI stamp, offline reopen, JSON CLI, MCP stdio boundary, and standalone CLI journey across both release OSes, and re-validating #527 reuse per ADR 0028. Event is pull_request rather than the workflow_dispatch the previous two entries needed, because this delta changes three electron/ files and those are inside the proof workflow path filter; the filter gap recorded on issue #1107 is unchanged and still unresolved. Two commits follow this proven head and neither changes the fingerprinted runtime tree: the merge of base head 294e0ccd, whose only delta is one added file under services/ai-control-plane/test, and the ledger-only commit carrying this entry, because scripts/certification is outside the profile-runtime-v1 path set.',
    },
  },
])

// The path set name every proof-reuse record carries. It labels the rule, not
// the membership: CERTIFICATION_PROFILE_RUNTIME_PATHS may gain or lose a file
// without the label moving, because the fingerprint already fails closed on
// any such change.
export const CERTIFICATION_PROOF_PATH_SET = 'profile-runtime-v1'

// Resolves only retained schema-v1 packets, which cite a historical entry.
export function latestCertificationProofRevalidation() {
  return CERTIFICATION_PROOF_REVALIDATIONS.at(-1)
}

// Turns a resolved proof revalidation (see proof-revalidation.mjs) into the
// proofReuse block that is sealed into a platform evidence packet. The caller
// supplies the revalidation; this function independently recomputes the
// fingerprint of the tree actually being certified and refuses to seal a
// packet whose tree is not the one the cited proof run covered.
export function validateCurrentCertificationProofReuse(
  sourceSha,
  {
    cwd,
    computeFingerprint = computeProfileRuntimeFingerprint,
    revalidation,
  } = {},
) {
  assert(FULL_SHA.test(sourceSha ?? ''), 'Certification proof reuse sourceSha must be a full SHA')
  assert(typeof computeFingerprint === 'function', 'Certification proof reuse fingerprint provider is invalid')
  assertResolvedProofRevalidation(revalidation)
  const treeSha256 = computeFingerprint(sourceSha, { cwd })
  assert(
    treeSha256 === revalidation.treeSha256,
    'Relevant Profile runtime paths do not match the resolved Native desktop proof run '
      + `(${revalidation.evidence.runUrl}); the certified tree ${treeSha256} is not the tree that run proved `
      + `(${revalidation.treeSha256}). Run Native desktop proof on this tree before certifying `
      + '(see docs/agents/packaged-certification.md)',
  )
  return deepFreeze({
    schemaVersion: 2,
    policyVersion: 2,
    pathSet: revalidation.pathSet,
    providerSourceSha: CERTIFICATION_REUSED_PROOF.darwin.sourceSha,
    revalidatedSourceSha: revalidation.revalidatedSourceSha,
    checkedSourceSha: sourceSha,
    treeSha256,
    relevantPathsUnchanged: true,
    evidence: structuredClone(revalidation.evidence),
  })
}

// The shape a live-resolved revalidation must have before it may seal a
// packet. Kept here, beside the packet assertions, so the resolver and the
// evidence reader cannot disagree about what a revalidation is.
export function assertResolvedProofRevalidation(value) {
  assertRecord(value, 'resolved proof revalidation')
  assert(value.schemaVersion === 2, 'Resolved proof revalidation must be schemaVersion 2')
  assert(value.pathSet === CERTIFICATION_PROOF_PATH_SET, 'Resolved proof revalidation names an unknown path set')
  assert(FULL_SHA.test(value.revalidatedSourceSha ?? ''), 'Resolved proof revalidation must name a full proved SHA')
  assert(SHA256.test(value.treeSha256 ?? ''), 'Resolved proof revalidation must carry a tree fingerprint')
  assertProofRevalidationEvidence(value.evidence, value.revalidatedSourceSha)
}

function assertProofRevalidationEvidence(value, revalidatedSourceSha) {
  assertRecord(value, 'proof revalidation evidence')
  assert(
    value.kind === 'native-desktop-proof-workflow-run'
      && value.workflow === NATIVE_DESKTOP_PROOF_WORKFLOW
      && Number.isSafeInteger(value.runId) && value.runId > 0
      && Number.isSafeInteger(value.runAttempt) && value.runAttempt > 0
      && value.runUrl === `https://github.com/${value.repository}/actions/runs/${value.runId}`
      && isBoundedText(value.repository)
      && NATIVE_DESKTOP_PROOF_ALLOWED_EVENTS.includes(value.event)
      && value.branch === 'main'
      && value.conclusion === 'success'
      && value.headSha === revalidatedSourceSha,
    'Proof revalidation evidence does not name a successful Native desktop proof run on main',
  )
  assert(
    Array.isArray(value.jobs)
      && value.jobs.length === NATIVE_DESKTOP_PROOF_GATE_JOBS.length
      && NATIVE_DESKTOP_PROOF_GATE_JOBS.every((name, index) => value.jobs[index]?.name === name)
      && value.jobs.every((job) => job.conclusion === 'success' && Number.isSafeInteger(job.id) && job.id > 0),
    'Proof revalidation evidence must record both native gate jobs concluding success',
  )
}

export const CERTIFICATION_CONTRACT_VERSIONS = deepFreeze({
  profile: {
    profile: 1,
    schema: 1,
    record: 2,
    asset: 1,
    app: 1,
    command: 1,
    export: 1,
  },
  gateway: {
    protocol: 1,
    compatibility: 1,
    tools: 7,
  },
  agent: {
    batchSchema: 1,
    requestSchema: 1,
    commandSchema: 1,
    ledger: 1,
    event: 1,
    run: {
      version: 2,
      operations: ['run.submit', 'run.status', 'run.read'],
      availability: 'live-app',
      adapters: ['cli'],
    },
  },
  commandSurface: {
    installedVersion: 5,
    installedCommands: [
      'card.create',
      'card.update-content',
      'card.delete',
      'connection.create',
      'connection.update-meaning',
      'connection.delete',
      'mod-template.create',
      'mod-template.update',
      'mod-template.delete',
      'mod-instance.stamp',
      'idea.create',
      'ask.set-model',
      'card.set-identity',
      'cards.arrange',
      'cards.reorder-layer',
      'group.membership.set',
      'output.choose-version',
      'output.set-accepted',
      'mod-instance.create',
      'mod-instance.configure',
      'mod-instance.delete',
      'idea.activate',
    ],
    agentDiscoverableCommands: [
      'card.create',
      'card.update-content',
      'card.delete',
      'connection.create',
      'connection.update-meaning',
      'connection.delete',
      'ask.set-model',
      'card.set-identity',
      'cards.arrange',
      'cards.reorder-layer',
      'group.membership.set',
      'output.choose-version',
      'output.set-accepted',
      'idea.create',
      'idea.activate',
    ],
    historicalVersions: [1, 2, 3, 4],
    historicalVersion: 1,
    historicalCommands: [
      'card.create',
      'card.update-content',
      'card.delete',
      'connection.create',
      'connection.update-meaning',
      'connection.delete',
    ],
  },
  receipt: {
    emittedVersion: 5,
    readableVersions: [1, 2, 3, 4, 5],
  },
})

// Schema v1 is the immutable certification contract that origin/main admitted
// before sealed-artifact and nested-executable posture became retained fields.
// Keep this one frozen compatibility authority; schema v2 uses the live pins
// above and must not downgrade to this surface.
export const CERTIFICATION_V1_CONTRACT_VERSIONS = deepFreeze({
  profile: {
    profile: 1,
    schema: 1,
    record: 2,
    asset: 1,
    app: 1,
    command: 1,
    export: 1,
  },
  gateway: {
    protocol: 1,
    compatibility: 1,
    tools: 7,
  },
  agent: {
    batchSchema: 1,
    requestSchema: 1,
    commandSchema: 1,
    ledger: 1,
    event: 1,
  },
  commandSurface: {
    installedVersion: 2,
    installedCommands: [
      'card.create',
      'card.update-content',
      'card.delete',
      'connection.create',
      'connection.update-meaning',
      'connection.delete',
      'mod-template.create',
      'mod-template.update',
      'mod-template.delete',
      'mod-instance.stamp',
    ],
    historicalVersion: 1,
    historicalCommands: [
      'card.create',
      'card.update-content',
      'card.delete',
      'connection.create',
      'connection.update-meaning',
      'connection.delete',
    ],
  },
  receipt: {
    emittedVersion: 2,
    readableVersions: [1, 2],
  },
})

// Schema v1 had no in-packet discriminator that could distinguish an immutable
// v1 manifest from a v2 object whose schema label and retained posture fields
// were rewritten. Admit only named retained v1 sets. The external reference
// binds exact manifest bytes through manifestSha256; validateCertificationSet
// independently binds the parsed object through canonicalSha256. Packet
// identity, transcript digests, and proof tuples reject standalone relabelling.
export const CERTIFICATION_V1_RETAINED_SETS = deepFreeze([
  {
    certificationSetId: 'eido-cert-v1-29954394648-1',
    sourceSha: '6ba51738147262009345be0326140f7e7ea43a1a',
    semver: '0.1.1',
    manifestSha256: '68007efca9b9f179a683e412dcea851418aed5e78d1bafec5da19b785488ff7e',
    canonicalSha256: '6a91e2647fb4e23a16d58a125c0549ffc623c96335e97ebb513f7b12129b0be8',
    evidenceDigests: {
      'darwin-arm64': '321a46f03a43ab8eaea95bf9578adfa089264c9d58abff8c31652b5b97dedf4e',
      'win32-x64': 'a308715ad883e41f19914596d6da9e262ab206bdc16dd5d990a9a1e461f8fbd7',
    },
    proofRevalidation: {
      pathSet: 'profile-runtime-v1',
      revalidatedSourceSha: '1641c7d59f9b9510906ac677db1d7d9b51fa3c82',
      treeSha256: '8133d6b6dad29e68bce3756b243849bb6b9aedf433d296af19e95ffe65b7cf06',
    },
  },
  {
    certificationSetId: 'eido-cert-v1-29994427935-1',
    sourceSha: '4f3cdbcc9d1087aad8a16cced6c41edb03040409',
    semver: '0.1.2',
    manifestSha256: 'ed002d137d48d1e78fa7d295cec8da39733ca36753bd6f1e51de3eeed8a85981',
    canonicalSha256: 'af2841c87b7f118a4f740a7d15e66258b4a27b7f499826c6dc338833033820a1',
    evidenceDigests: {
      'darwin-arm64': '5919534a89ebefed7fafd8dbf56ad2499ce31abeebfa181567df5b3c32b30452',
      'win32-x64': '4eaaf60add934894968aaec554ded27093b7672e523f8ce3ff2b1ea4e8d76d8e',
    },
    proofRevalidation: {
      pathSet: 'profile-runtime-v1',
      revalidatedSourceSha: 'c3327687aa8de370970b7adfb98fc84d314b3ab6',
      treeSha256: '134194e55fdacf7e7e09114b9c34230b11972e1867161bf0856d859bbc61124b',
    },
  },
])

// The installed Gateway version envelope the certification journey requires
// from `profile.capabilities`. Split from CERTIFICATION_CONTRACT_VERSIONS
// because it mixes gateway and profile axes; pinned here (not derived from
// src) so a source contract bump still fails closed until this authority is
// deliberately moved. `src/persistence/certificationContractPins.test.ts`
// cross-checks both pins against the source contracts in PR CI.
export const CERTIFICATION_INSTALLED_GATEWAY_VERSIONS = deepFreeze({
  gateway: 1, schema: 1, record: 2, command: 1, export: 1, compatibility: 1,
})

const REQUIRED_PLATFORMS = Object.freeze([
  Object.freeze({ platform: 'darwin', arch: 'arm64', target: 'dmg' }),
  Object.freeze({ platform: 'win32', arch: 'x64', target: 'nsis' }),
])
const REQUIRED_NEGATIVE_INVENTORY = Object.freeze([
  'leanAllowlist',
  'noVectorSurface',
  'noUnexpectedListener',
  'noSourceMaps',
  'noCredentials',
  'noPrivateSource',
  'noInternalDocumentation',
  'noTestsFixturesOrTooling',
])
const REQUIRED_JOURNEY = Object.freeze([
  'guiEditRestart',
  'offlineRelaunch',
  'cliBound',
  'liveCliBound',
  'agentSurfaceV3Bound',
  'spatialBound',
  'changeTrailBound',
  'agentRunsLiveOnlyBound',
  'mcpBound',
  'uninstall',
  'reinstall',
])
const REQUIRED_V1_JOURNEY = Object.freeze([
  'guiEditRestart',
  'offlineRelaunch',
  'cliBound',
  'mcpBound',
  'uninstall',
  'reinstall',
])
const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/
const CERTIFICATION_SET_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/

export function validateCertificationIntent(value) {
  assertRecord(value, 'certification intent')
  assert(value.schemaVersion === 1, 'Certification intent schemaVersion must be 1')
  assert(CERTIFICATION_SET_ID.test(value.certificationSetId ?? ''), 'Certification intent has an invalid certificationSetId')
  assert(
    value.certificationSetId.startsWith('eido-cert-v2-'),
    'New certification intent requires an eido-cert-v2-* certificationSetId',
  )
  assert(FULL_SHA.test(value.sourceSha ?? ''), 'Certification intent sourceSha must be a full SHA')
  assertSemver(value.semver)
  assert(value.promotable === true, 'Certification intent must be explicitly promotable')
  assertProductionIdentity(value.packageIdentity)
  return deepFreeze(structuredClone(value))
}

export function validatePlatformEvidence(value) {
  assertRecord(value, 'platform certification evidence')
  assert(
    value.schemaVersion === 1 || value.schemaVersion === 2,
    'Platform evidence schemaVersion must be 1 or 2',
  )
  assert(CERTIFICATION_SET_ID.test(value.certificationSetId ?? ''), 'Platform evidence certificationSetId is invalid')
  assertCertificationSetIdSchema(value.certificationSetId, value.schemaVersion, 'Platform evidence')
  assert(FULL_SHA.test(value.sourceSha ?? ''), 'Platform evidence sourceSha must be a full SHA')
  assertSemver(value.semver)
  assertProductionIdentity(value.packageIdentity)

  const expected = REQUIRED_PLATFORMS.find(({ platform }) => platform === value.platform)
  assert(expected !== undefined, 'Platform evidence has an unsupported platform')
  assert(value.arch === expected.arch && value.target === expected.target, 'Platform evidence target identity is invalid')
  assertArtifact(value.artifact, expected.target)
  if (value.schemaVersion === 2 && value.platform === 'darwin') {
    assert(value.updateArtifact !== undefined, 'Current macOS certification requires an update archive')
    assertUpdateArtifact(value.updateArtifact)
  } else {
    assert(value.updateArtifact === undefined, 'Only current macOS certification may carry an update archive')
  }
  if (value.schemaVersion === 2) {
    assertArtifactSigningPosture(value.platform, value.artifactSigningPosture)
    assertNestedSigningPostures(value.platform, value.nestedSigningPostures, value.schemaVersion)
  }
  assertRecord(value.installedInventory, 'installed inventory')
  assert(SHA256.test(value.installedInventory.sha256 ?? ''), 'Installed inventory digest must be SHA-256')
  assert(Number.isSafeInteger(value.installedInventory.entries) && value.installedInventory.entries > 0, 'Installed inventory entry count is invalid')
  assertSigningPosture(value.platform, value.signingPosture, value.schemaVersion)
  assertInstalledPackageIdentity(value.platform, value.installedPackageIdentity, value.semver)
  assertExecutionIdentity(value.platform, value.executionIdentity)
  assertProofReuse(value.proofReuse, value.sourceSha, value.schemaVersion)
  assertCanonicalEqual(
    value.contractVersions,
    value.schemaVersion === 1 ? CERTIFICATION_V1_CONTRACT_VERSIONS : CERTIFICATION_CONTRACT_VERSIONS,
    'Platform contract versions do not match certification authority',
  )
  assertJourney(value.installedJourney, value.schemaVersion)
  assertNegativeInventory(value.negativeInventory)
  assertReusedProofReferences(value.reusedProofReferences, value.platform)
  assertListenerEvidence(value.listenerEvidence, value.platform, value.schemaVersion)
  assert(SHA256.test(value.evidenceSha256 ?? ''), 'Platform evidence digest must be SHA-256')
  if (value.schemaVersion === 1) assertRetainedV1PlatformEvidence(value)
  return deepFreeze(structuredClone(value))
}

export function buildCertificationSet({ intent: intentCandidate, platformEvidence }) {
  const intent = validateCertificationIntent(intentCandidate)
  assert(Array.isArray(platformEvidence), 'Certification requires platform evidence')
  const platforms = platformEvidence.map(validatePlatformEvidence)
    .sort((left, right) => REQUIRED_PLATFORMS.findIndex(({ platform }) => platform === left.platform)
      - REQUIRED_PLATFORMS.findIndex(({ platform }) => platform === right.platform))

  assert(platforms.length === REQUIRED_PLATFORMS.length, 'Certification requires exactly two platform packets')
  assert(
    platforms.every(({ schemaVersion }) => schemaVersion === 2),
    'New certification sets require schemaVersion 2 platform evidence',
  )
  for (let index = 0; index < REQUIRED_PLATFORMS.length; index += 1) {
    const actual = platforms[index]
    const expected = REQUIRED_PLATFORMS[index]
    assert(
      actual.platform === expected.platform && actual.arch === expected.arch && actual.target === expected.target,
      `Certification is missing ${expected.platform}-${expected.arch}`,
    )
    for (const key of ['certificationSetId', 'sourceSha', 'semver']) {
      assert(actual[key] === intent[key], `Platform evidence ${key} does not match the certification intent`)
    }
    assertCanonicalEqual(actual.packageIdentity, intent.packageIdentity, 'Platform package identity does not match intent')
  }

  const certification = {
    schemaVersion: 2,
    certificationSetId: intent.certificationSetId,
    sourceSha: intent.sourceSha,
    semver: intent.semver,
    promotable: true,
    packageIdentity: intent.packageIdentity,
    platforms,
    contractVersions: CERTIFICATION_CONTRACT_VERSIONS,
    evidenceDigests: Object.fromEntries(platforms.map((packet) => [
      `${packet.platform}-${packet.arch}`,
      packet.evidenceSha256,
    ])),
    negativeInventory: Object.fromEntries(REQUIRED_NEGATIVE_INVENTORY.map((key) => [
      key,
      platforms.every((packet) => packet.negativeInventory[key] === true),
    ])),
    reusedProofReferences: mergeProofReferences(platforms),
    durability: {
      posixDirectoryEntries: 'flushed-before-sqlite-acknowledgement',
      windowsNamespace: 'best-effort-after-file-flush-rename-reopen-rehash',
    },
  }
  return validateCertificationSet(certification)
}

export function validateCertificationSet(value) {
  assertRecord(value, 'certification set')
  assert(
    value.schemaVersion === 1 || value.schemaVersion === 2,
    'Certification schemaVersion must be 1 or 2',
  )
  assert(CERTIFICATION_SET_ID.test(value.certificationSetId ?? ''), 'Certification has an invalid certificationSetId')
  assertCertificationSetIdSchema(value.certificationSetId, value.schemaVersion, 'Certification')
  assert(FULL_SHA.test(value.sourceSha ?? ''), 'Certification sourceSha must be a full SHA')
  assertSemver(value.semver)
  assert(value.promotable === true, 'Certification admission requires promotable: true')
  assertProductionIdentity(value.packageIdentity)
  assert(Array.isArray(value.platforms) && value.platforms.length === 2, 'Certification requires both platform packets')
  const platforms = value.platforms.map(validatePlatformEvidence)
  assert(
    platforms.every(({ schemaVersion }) => schemaVersion === value.schemaVersion),
    'Certification schemaVersion does not match its platform evidence',
  )
  assertCanonicalEqual(platforms.map(({ platform, arch, target }) => ({ platform, arch, target })), REQUIRED_PLATFORMS, 'Certification platform pair is invalid')
  for (const platform of platforms) {
    for (const key of ['certificationSetId', 'sourceSha', 'semver']) {
      assert(platform[key] === value[key], `Certification ${key} does not match platform evidence`)
    }
    assertCanonicalEqual(platform.packageIdentity, value.packageIdentity, 'Certification package identity does not match platform evidence')
  }
  assertCanonicalEqual(
    value.contractVersions,
    value.schemaVersion === 1 ? CERTIFICATION_V1_CONTRACT_VERSIONS : CERTIFICATION_CONTRACT_VERSIONS,
    'Certification contract versions do not match authority',
  )
  assertNegativeInventory(value.negativeInventory)
  assertReusedProofReferences(value.reusedProofReferences)
  assertCanonicalEqual(value.reusedProofReferences, mergeProofReferences(platforms), 'Certification reused proof references do not match its platform packets')
  assertRecord(value.evidenceDigests, 'certification evidence digests')
  assertCanonicalEqual(
    Object.keys(value.evidenceDigests).sort(),
    REQUIRED_PLATFORMS.map(({ platform, arch }) => `${platform}-${arch}`).sort(),
    'Certification evidence digest keys do not match the platform pair',
  )
  for (const platform of platforms) {
    assert(
      value.evidenceDigests[`${platform.platform}-${platform.arch}`] === platform.evidenceSha256,
      'Certification evidence digest does not match its platform packet',
    )
  }
  // Both legs certify one tree, so both must cite the same resolved proof run.
  // Two legs that disagree mean the tree or the proof moved between them.
  // Retained schema-v1 sets keep their own authority below and are not
  // re-judged by this rule.
  if (value.schemaVersion === 2) {
    assertCanonicalEqual(
      platforms[1].proofReuse,
      platforms[0].proofReuse,
      'Certification platform packets cite different proof-reuse revalidations',
    )
  }
  if (value.schemaVersion === 1) assertRetainedV1CertificationSet(value, platforms)
  assertCanonicalEqual(value.durability, {
    posixDirectoryEntries: 'flushed-before-sqlite-acknowledgement',
    windowsNamespace: 'best-effort-after-file-flush-rename-reopen-rehash',
  }, 'Certification durability declaration does not match ADR 0025')
  return deepFreeze(structuredClone(value))
}

export function certificationInvalidations(previousCandidate, nextCandidate) {
  const previous = validateCertificationSet(previousCandidate)
  const next = validateCertificationSet(nextCandidate)
  const invalidations = []

  for (const expected of REQUIRED_PLATFORMS) {
    const left = previous.platforms.find(({ platform }) => platform === expected.platform)
    const right = next.platforms.find(({ platform }) => platform === expected.platform)
    if (canonicalJson({
      schemaVersion: left.schemaVersion,
      artifact: left.artifact,
      updateArtifact: left.updateArtifact,
      ...(left.schemaVersion === 2
        ? {
            artifactSigningPosture: left.artifactSigningPosture,
            nestedSigningPostures: left.nestedSigningPostures,
          }
        : {}),
      inventory: left.installedInventory,
      signingPosture: left.signingPosture,
      installedPackageIdentity: left.installedPackageIdentity,
      executionIdentity: left.executionIdentity,
      proofReuse: left.proofReuse,
      listenerEvidence: left.listenerEvidence,
      evidenceSha256: left.evidenceSha256,
    }) !== canonicalJson({
      schemaVersion: right.schemaVersion,
      artifact: right.artifact,
      updateArtifact: right.updateArtifact,
      ...(right.schemaVersion === 2
        ? {
            artifactSigningPosture: right.artifactSigningPosture,
            nestedSigningPostures: right.nestedSigningPostures,
          }
        : {}),
      inventory: right.installedInventory,
      signingPosture: right.signingPosture,
      installedPackageIdentity: right.installedPackageIdentity,
      executionIdentity: right.executionIdentity,
      proofReuse: right.proofReuse,
      listenerEvidence: right.listenerEvidence,
      evidenceSha256: right.evidenceSha256,
    })) invalidations.push(`${expected.platform}-${expected.arch}`)
  }

  const pairChanged = invalidations.length > 0 || canonicalJson({
    schemaVersion: previous.schemaVersion,
    sourceSha: previous.sourceSha,
    semver: previous.semver,
    contractVersions: previous.contractVersions,
  }) !== canonicalJson({
    schemaVersion: next.schemaVersion,
    sourceSha: next.sourceSha,
    semver: next.semver,
    contractVersions: next.contractVersions,
  })
  if (pairChanged) invalidations.push('paired-set')
  if (invalidations.length > 0 && previous.certificationSetId === next.certificationSetId) {
    throw new Error('changed certification inputs must use a new certificationSetId')
  }
  return invalidations
}

export function createCertificationEvidenceReference({ certification: candidate, manifestSha256, fileName }) {
  const certification = validateCertificationSet(candidate)
  assert(SHA256.test(manifestSha256 ?? ''), 'Certification manifest digest must be SHA-256')
  assertSafeFileName(fileName)
  // #675's ledger (scripts/release/release-planning.mjs) requires a lowercase
  // `sha256:<64-hex>` digest, matching how it addresses its own platform
  // evidence entries. Emit that exact shape so #675 can consume this
  // reference without a transcription step.
  return deepFreeze({
    schemaVersion: 1,
    kind: 'eido-packaged-certification-set',
    certificationSetId: certification.certificationSetId,
    sourceSha: certification.sourceSha,
    semver: certification.semver,
    manifest: { fileName, sha256: `sha256:${manifestSha256}` },
  })
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value))
}

export function sha256CanonicalJson(value) {
  return createHash('sha256').update(`${canonicalJson(value)}\n`, 'utf8').digest('hex')
}

function assertArtifact(value, target) {
  assertRecord(value, 'sealed artifact')
  assertSafeFileName(value.fileName)
  assert(value.fileName.toLowerCase().endsWith(target === 'dmg' ? '.dmg' : '.exe'), 'Sealed artifact file does not match its target')
  assert(SHA256.test(value.sha256 ?? ''), 'Sealed artifact digest must be SHA-256')
  assert(Number.isSafeInteger(value.bytes) && value.bytes > 0, 'Sealed artifact byte count is invalid')
}

function assertUpdateArtifact(value) {
  assertRecord(value, 'sealed macOS update archive')
  assertSafeFileName(value.fileName)
  assert(value.fileName.toLowerCase().endsWith('.zip'), 'macOS update archive must be a ZIP')
  assert(SHA256.test(value.sha256 ?? ''), 'macOS update archive digest must be SHA-256')
  assert(/^(?:[A-Za-z0-9+/]{4}){21}[A-Za-z0-9+/]{2}==$/.test(value.sha512 ?? ''), 'macOS update archive digest must be SHA-512 base64')
  assert(Number.isSafeInteger(value.bytes) && value.bytes > 0, 'macOS update archive byte count is invalid')
  assertRecord(value.payloadEvidence, 'macOS update archive payload evidence')
  assert(
    SHA256.test(value.payloadEvidence.appTreeSha256 ?? '')
      && value.payloadEvidence.matchesManualArtifact === true
      && value.payloadEvidence.signingVerified === true
      && value.payloadEvidence.nestedSigningVerified === true
      && value.payloadEvidence.packageIdentityVerified === true
      && value.payloadEvidence.notarizationStaple === 'validated'
      && value.payloadEvidence.gatekeeper === 'accepted-notarized-developer-id',
    'macOS update archive payload was not fully certified',
  )
}

function assertProductionIdentity(value) {
  assertCanonicalEqual(value, CERTIFICATION_PACKAGE_IDENTITY, 'Certification requires the production package identity')
  const identityText = canonicalJson(value).toLowerCase()
  assert(!identityText.includes('proof') && !identityText.includes('smoke'), 'Certification rejects smoke/proof identity')
}

function assertArtifactSigningPosture(platform, value) {
  if (platform === 'darwin') {
    assertRecord(value, 'macOS sealed artifact signing posture')
    const authority = assertDeveloperIdAuthority(
      value.authority,
      value.teamIdentifier,
      'macOS certification requires a Developer ID Application authority on the sealed DMG',
    )
    assert(
      value.status === 'developer-id'
        && value.format === 'dmg'
        && value.identifier === `${CERTIFICATION_PACKAGE_IDENTITY.appId}.dmg`
        && /^[0-9a-f]{40,64}$/.test(value.cdHash ?? '')
        && value.secureTimestamp === true
        && value.notarization === 'stapled'
        && value.gatekeeper === 'accepted-notarized-developer-id',
      'macOS certification requires a signed, timestamped, notarized, stapled, Gatekeeper-accepted sealed DMG',
    )
    return authority
  }
  // Windows artifacts are unsigned by decision, not by omission: Eido does not
  // buy an Authenticode certificate, and users accept one SmartScreen warning
  // at first install (spec #975). This gate holds that decision in place: it
  // fails just as loudly on an unexpectedly signed installer as on a
  // half-signed one, so the posture can never drift unobserved.
  assertCanonicalEqual(
    value,
    {
      status: 'NotSigned',
      publisher: null,
      certificateThumbprint: null,
      timestamp: null,
    },
    'Windows certification requires an actually unsigned sealed NSIS installer',
  )
  return null
}

/**
 * The exact Developer ID identity is checked on the macOS runner itself, from
 * the signing environment, before this evidence is written. Here, where the
 * paired set is finalized on a runner that deliberately holds no signing
 * identity, the check is structural: a Developer ID Application authority
 * whose embedded Team ID matches the separately recorded Team ID. Both packets
 * are digest-addressed, so a posture cannot be edited after the fact.
 */
function assertDeveloperIdAuthority(authority, teamIdentifier, message) {
  const parsed = /^Developer ID Application: (.+) \(([A-Z0-9]{10})\)$/.exec(authority ?? '')
  assert(
    parsed !== null
      && parsed[1].trim() !== ''
      && /^[A-Z0-9]{10}$/.test(teamIdentifier ?? '')
      && parsed[2] === teamIdentifier,
    message,
  )
  return { name: parsed[1], teamId: parsed[2] }
}

function assertNestedSigningPostures(platform, value, schemaVersion) {
  const expectedPaths = platform === 'darwin'
    ? [
        'Contents/Resources/bin/eido',
        'Contents/Resources/bin/eido-profile-live-gateway-helper',
        'Contents/Frameworks/Squirrel.framework/Versions/A/Resources/ShipIt',
      ]
    : [
        'eido-profile-mcp.exe',
        'resources/bin/eido.exe',
        'resources/bin/eido-profile-live-gateway-helper.exe',
      ]
  assert(Array.isArray(value), 'Nested executable signing postures are invalid')
  assertCanonicalEqual(
    value.map((entry) => entry?.path),
    expectedPaths,
    'Nested executable signing posture paths do not match the production target',
  )
  for (const entry of value) {
    assertRecord(entry, 'nested executable signing posture')
    assertSigningPosture(platform, entry.signingPosture, schemaVersion)
  }
}

function assertSigningPosture(platform, value, schemaVersion) {
  assertRecord(value, `${platform} signing posture`)
  if (platform === 'darwin') {
    // Schema-version-1 sets predate production signing (#696) and are retained
    // immutably; they record the ad-hoc posture they actually had. Everything
    // built since must carry Eido's Developer ID under the hardened runtime.
    if (schemaVersion === 1) {
      assert(
        value.status === 'ad-hoc'
          && /^[0-9a-f]{40,64}$/.test(value.cdHash ?? '')
          && value.teamIdentifier === null
          && Array.isArray(value.authorities)
          && value.authorities.length === 0
          && value.hardenedRuntime === 'not-applicable',
        'macOS certification requires exact ad-hoc signing posture with no Team ID',
      )
      return
    }
    assertDeveloperIdAuthority(
      value.authority,
      value.teamIdentifier,
      'macOS certification requires a Developer ID Application authority and matching Team ID',
    )
    assert(
      value.status === 'developer-id'
        && /^[0-9a-f]{40,64}$/.test(value.cdHash ?? '')
        && value.hardenedRuntime === 'enabled'
        && value.secureTimestamp === true,
      'macOS certification requires Developer ID signing with the hardened runtime and a secure timestamp',
    )
    return
  }
  assert(
    value.status === 'NotSigned'
      && value.publisher === null
      && value.certificateThumbprint === null
      && value.timestamp === null,
    'Windows certification requires exact NotSigned posture with no Authenticode identity',
  )
}

function assertExecutionIdentity(platform, value) {
  assertRecord(value, 'platform execution identity')
  const expected = platform === 'darwin'
    ? { runnerOs: 'macOS', runnerArch: 'ARM64' }
    : { runnerOs: 'Windows', runnerArch: 'X64' }
  assert(
    value.hostedEnvironment === 'github-hosted'
      && value.runnerOs === expected.runnerOs
      && value.runnerArch === expected.runnerArch
      && isBoundedText(value.runnerName)
      && isBoundedText(value.imageOs)
      && isBoundedText(value.imageVersion)
      && /^\d+\.\d+\.\d+$/.test(value.node ?? '')
      && /^\d+\.\d+\.\d+$/.test(value.npm ?? ''),
    'Platform execution identity is invalid',
  )
}

function assertInstalledPackageIdentity(platform, value, semver) {
  assertRecord(value, 'installed package identity')
  assertCanonicalEqual(value, {
    appId: CERTIFICATION_PACKAGE_IDENTITY.appId,
    productName: CERTIFICATION_PACKAGE_IDENTITY.productName,
    semver,
    executable: platform === 'darwin' ? 'Eido' : 'Eido.exe',
    architecture: platform === 'darwin' ? 'arm64' : 'x64',
    metadataSource: platform === 'darwin'
      ? 'bundle-plist-and-mach-o'
      : 'asar-and-pe-version-resource',
  }, 'Installed package identity does not match the production target')
}

function assertProofReuse(value, sourceSha, evidenceSchemaVersion) {
  assertRecord(value, 'proof reuse compatibility')
  if (evidenceSchemaVersion === 2) {
    // A live-resolved record. It carries its own evidence, so it is read on
    // its own terms rather than against a repository constant: the packet must
    // name a successful two-platform proof run on main, and its tree
    // fingerprint must be the one that run covered. The binding of that
    // fingerprint to the certified source tree is made where the source tree
    // exists: prepare-certification.mjs before native spend, certify-packaged.mjs
    // on each native runner, and finalize-certification.mjs when the pair is
    // sealed.
    assert(
      value.schemaVersion === 2
        && value.policyVersion === 2
        && value.pathSet === CERTIFICATION_PROOF_PATH_SET
        && value.providerSourceSha === CERTIFICATION_REUSED_PROOF.darwin.sourceSha
        && value.checkedSourceSha === sourceSha
        && SHA256.test(value.treeSha256 ?? '')
        && value.relevantPathsUnchanged === true,
      'Platform proof reuse compatibility is invalid',
    )
    assertResolvedProofRevalidation({
      schemaVersion: 2,
      pathSet: value.pathSet,
      revalidatedSourceSha: value.revalidatedSourceSha,
      treeSha256: value.treeSha256,
      evidence: value.evidence,
    })
    return
  }
  const revalidation = CERTIFICATION_PROOF_REVALIDATIONS.find((entry) => (
    entry.pathSet === value.pathSet
    && entry.revalidatedSourceSha === value.revalidatedSourceSha
    && entry.treeSha256 === value.treeSha256
  ))
  assert(
    value.schemaVersion === 1
      && value.policyVersion === 1
      && revalidation !== undefined
      && value.pathSet === revalidation.pathSet
      && value.providerSourceSha === CERTIFICATION_REUSED_PROOF.darwin.sourceSha
      && value.revalidatedSourceSha === revalidation.revalidatedSourceSha
      && value.checkedSourceSha === sourceSha
      && SHA256.test(value.treeSha256 ?? '')
      && value.treeSha256 === revalidation.treeSha256
      && value.relevantPathsUnchanged === true,
    'Platform proof reuse compatibility is invalid',
  )
}

function assertCertificationSetIdSchema(certificationSetId, schemaVersion, label) {
  assert(
    certificationSetId.startsWith(`eido-cert-v${schemaVersion}-`),
    `${label} certificationSetId does not match schemaVersion ${schemaVersion}`,
  )
}

function assertRetainedV1CertificationSet(value, platforms) {
  const retained = CERTIFICATION_V1_RETAINED_SETS.find(({ certificationSetId }) => (
    certificationSetId === value.certificationSetId
  ))
  assert(retained !== undefined, 'Certification schema-version-1 set is not a retained immutable authority')
  assert(
    retained.sourceSha === value.sourceSha && retained.semver === value.semver,
    'Certification schema-version-1 identity does not match its retained immutable authority',
  )
  assertCanonicalEqual(
    value.evidenceDigests,
    retained.evidenceDigests,
    'Certification schema-version-1 evidence digests do not match its retained immutable authority',
  )
  for (const platform of platforms) {
    assertCanonicalEqual(
      {
        pathSet: platform.proofReuse.pathSet,
        revalidatedSourceSha: platform.proofReuse.revalidatedSourceSha,
        treeSha256: platform.proofReuse.treeSha256,
      },
      retained.proofRevalidation,
      'Certification schema-version-1 proof reuse does not match its retained immutable authority',
    )
  }
  assert(
    sha256CanonicalJson(value) === retained.canonicalSha256,
    'Certification schema-version-1 canonical manifest does not match its retained immutable authority',
  )
}

function assertRetainedV1PlatformEvidence(value) {
  const retained = CERTIFICATION_V1_RETAINED_SETS.find(({ certificationSetId }) => (
    certificationSetId === value.certificationSetId
  ))
  assert(retained !== undefined, 'Platform evidence schema-version-1 set is not a retained immutable authority')
  assert(
    retained.sourceSha === value.sourceSha && retained.semver === value.semver,
    'Platform evidence schema-version-1 identity does not match its retained immutable authority',
  )
  assert(
    retained.evidenceDigests[`${value.platform}-${value.arch}`] === value.evidenceSha256,
    'Platform evidence schema-version-1 digest does not match its retained immutable authority',
  )
  assertCanonicalEqual(
    {
      pathSet: value.proofReuse.pathSet,
      revalidatedSourceSha: value.proofReuse.revalidatedSourceSha,
      treeSha256: value.proofReuse.treeSha256,
    },
    retained.proofRevalidation,
    'Platform evidence schema-version-1 proof reuse does not match its retained immutable authority',
  )
}

function assertListenerEvidence(value, platform, schemaVersion) {
  assertRecord(value, 'listener evidence')
  const required = CERTIFICATION_REUSED_PROOF[platform]
  assert(
    value.transientDriverClosed === true
      && value.installedAgentTransport === (
        schemaVersion === 1 ? 'stdio-only' : 'owner-only-local-ipc-plus-stdio'
      )
      && value.reusedProofSha256 === required.sha256,
    'Platform listener evidence is invalid',
  )
}

function assertJourney(value, schemaVersion) {
  assertRecord(value, 'installed journey')
  const required = schemaVersion === 1 ? REQUIRED_V1_JOURNEY : REQUIRED_JOURNEY
  for (const key of required) assert(value[key] === true, `Installed journey did not prove ${key}`)
  assert(value.firstReleaseMigration === 'not-applicable', 'First release migration must be not-applicable')
}

function assertNegativeInventory(value) {
  assertRecord(value, 'negative inventory')
  for (const key of REQUIRED_NEGATIVE_INVENTORY) assert(value[key] === true, `Negative inventory did not prove ${key}`)
}

function assertReusedProofReferences(value, platform) {
  assert(Array.isArray(value) && value.length > 0, 'Certification must cite reusable proof')
  for (const reference of value) {
    assertRecord(reference, 'reused proof reference')
    assert(Number.isSafeInteger(reference.issue) && reference.issue > 0, 'Reused proof issue is invalid')
    assert(FULL_SHA.test(reference.sourceSha ?? ''), 'Reused proof sourceSha must be a full SHA')
    assert(SHA256.test(reference.sha256 ?? ''), 'Reused proof digest must be SHA-256')
  }
  if (platform) {
    assertCanonicalEqual(value, [CERTIFICATION_REUSED_PROOF[platform]], 'Platform reused proof reference does not match #527')
  }
}

function mergeProofReferences(platforms) {
  const references = new Map()
  for (const platform of platforms) {
    for (const reference of platform.reusedProofReferences) {
      references.set(`${reference.issue}:${reference.sourceSha}:${reference.sha256}`, reference)
    }
  }
  return [...references.values()].sort((left, right) => left.issue - right.issue)
}

function assertSemver(value) {
  const match = typeof value === 'string' ? SEMVER.exec(value) : null
  assert(match && !(match[1] === '0' && match[2] === '0' && match[3] === '0'), 'Certification requires a non-0.0.0 SemVer')
}

function assertSafeFileName(value) {
  assert(typeof value === 'string' && value.length > 0 && !/[\\/\0\r\n]/.test(value), 'Certification artifact file name is invalid')
}

function assertRecord(value, description) {
  assert(value !== null && typeof value === 'object' && !Array.isArray(value), `${description} is invalid`)
}

function isBoundedText(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\0\r\n]/.test(value)
}

function assertCanonicalEqual(actual, expected, message) {
  assert(canonicalJson(actual) === canonicalJson(expected), message)
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]))
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}
