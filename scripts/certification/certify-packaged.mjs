import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import {
  lstat,
  mkdtemp,
  mkdir,
  open,
  readFile,
  readdir,
  readlink,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { createServer } from 'node:net'
import os from 'node:os'
import path from 'node:path'

import {
  MAC_EIDO_COMMAND,
  MAC_EIDO_COMMAND_INSTALL_SCRIPT,
  REMOVE_MAC_EIDO_COMMAND_CANARY,
  renderMacEidoCommandLauncher,
} from '../../electron/eidoCommandLauncher.ts'
import { readNativeProofIdentity } from '../ci/native-desktop-proof.mjs'
import { inspectUnsignedWindowsExecutable, parseProfileCliResponse } from '../electron/proof-host.mjs'
import {
  CERTIFICATION_CONTRACT_VERSIONS,
  CERTIFICATION_INSTALLED_GATEWAY_VERSIONS,
  CERTIFICATION_PACKAGE_IDENTITY,
  CERTIFICATION_REUSED_PROOF,
  canonicalJson,
  validateCertificationIntent,
  validateCurrentCertificationProofReuse,
  validatePlatformEvidence,
} from './certification-manifest.mjs'
import {
  assertArm64MacDeploymentEvidence,
  assertMacDeploymentTargetAtOrBelow,
  assertInstalledRuntimeInventory,
  assertLeanArtifactInventory,
  assertContainedInstalledSymlink,
  assertNotarizedGatekeeperAcceptance,
  enumerateInstalledMachOBinaries,
  parseDeveloperIdSigningPosture,
  parseSignedMacDiskImagePosture,
  parseWindowsAuthenticode,
} from './platform-evidence.mjs'
import {
  MACOS_RELEASE_CREDENTIAL_DIRECTORY,
  productionArtifactName,
  productionDmgIdentifier,
} from '../release-signing/macos-release.mjs'
import { resolveSigningIdentity } from '../release-signing/macos-identity.mjs'

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..')
const profileTools = Object.freeze([
  'profile.status',
  'profile.capabilities',
  'idea.list',
  'graph.query',
  'record.get',
  'mod-template.list',
  'command.batch',
])
const agentDiscoverableCommands = CERTIFICATION_CONTRACT_VERSIONS
  .commandSurface.agentDiscoverableCommands
const agentRunOperations = Object.freeze(['run.submit', 'run.status', 'run.read'])
const requiredAgentEnabledCapabilities = Object.freeze([
  ...CERTIFICATION_CONTRACT_VERSIONS.commandSurface.installedCommands,
  'graph.neighbors',
  'graph.bounds',
  'result.inspect',
  'journey.connected-thought',
  'run.delegation',
])
const platformTarget = Object.freeze({
  darwin: Object.freeze({ arch: 'arm64', target: 'dmg' }),
  win32: Object.freeze({ arch: 'x64', target: 'nsis' }),
})
const timeoutMs = 60_000

class CdpClient {
  static async connect(endpoint) {
    const socket = new WebSocket(endpoint)
    await withTimeout(new Promise((resolve, reject) => {
      socket.addEventListener('open', resolve, { once: true })
      socket.addEventListener('error', reject, { once: true })
    }), 10_000, 'CDP connection')
    return new CdpClient(socket)
  }

  constructor(socket) {
    this.socket = socket
    this.nextId = 1
    this.pending = new Map()
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data))
      if (!message.id) return
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    socket.addEventListener('close', () => {
      for (const pending of this.pending.values()) pending.reject(new Error('CDP connection closed'))
      this.pending.clear()
    })
  }

  send(method, params = {}) {
    const id = this.nextId++
    // Every CDP command is deadline-bounded: an unanswered command with an
    // open socket is otherwise an unbounded await, and certification run 3's
    // macOS leg hung silently until the job-level timeout killed it.
    return withTimeout(new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    }), timeoutMs, `CDP ${method}`)
  }

  close() {
    this.socket.close()
  }
}

// Certification must never hang silently: hosted runs are debugged only from
// this log, and run 3's macOS leg sat 44 minutes with no output before the
// job-level timeout killed it. Stages are breadcrumbed to stderr as the run
// progresses, and a detached watchdog fails closed (skipping graceful cleanup
// — the hosted runner is ephemeral) if certification exceeds its generous
// whole-run budget.
const watchdogMs = 20 * 60_000
const watchdog = setTimeout(() => {
  stage('watchdog: certification exceeded its whole-run budget; failing closed')
  process.exit(1)
}, watchdogMs)
watchdog.unref()

const context = await readContext()
stage(`admitted ${context.platform}-${context.arch} for ${context.intent.certificationSetId}`)
const executionIdentity = await readExecutionIdentity(context)
// Prepare resolves the proof once and the workflow carries that immutable
// record into both native legs. Revalidating it here still recomputes the
// checked-out tree fingerprint, but a new equivalent proof cannot change the
// evidence after native certification has started.
const proofReuse = validateCurrentCertificationProofReuse(context.intent.sourceSha, {
  cwd: repositoryRoot,
  revalidation: context.revalidation,
})
const evidenceIdentity = readNativeProofIdentity({
  cwd: repositoryRoot,
  env: {
    EIDO_DESKTOP_PROOF_TESTED_SHA: context.intent.sourceSha,
    EIDO_DESKTOP_PROOF_HEAD_SHA: context.intent.sourceSha,
    EIDO_DESKTOP_PROOF_EXPECTED_PLATFORM: context.platform,
    EIDO_DESKTOP_PROOF_EXPECTED_ARCH: context.arch,
  },
  requireDeclared: true,
})
const profileRoot = await requireEphemeralProductProfileRoot(context)
const verificationRoot = await mkdtemp(path.join(context.runnerTemp, 'eido-packaged-certification-'))
const artifact = await findArtifact(context)
const artifactBefore = await fileIdentity(artifact)
const updateArchive = context.platform === 'darwin' ? await findMacosUpdateArchive(context) : undefined
const updateArchiveBefore = updateArchive ? await updateArchiveIdentity(updateArchive) : undefined
let installation
let artifactSigningPosture
let seededWindowsPathEntry
let profileRootOwned = false
let transcript
let primaryError

try {
  assert(!existsSync(profileRoot), 'Certification requires an absent fixed Eido Profile root')
  profileRootOwned = true
  stage(`installing ${path.basename(artifact)}`)
  if (context.platform === 'darwin') {
    artifactSigningPosture = await verifyDmg(artifact, context)
    const installed = await installMac(artifact, verificationRoot)
    installation = installed.installation
  } else {
    const installerPosture = parseWindowsAuthenticode(inspectUnsignedWindowsExecutable(
      artifact,
      { cwd: repositoryRoot },
    ))
    artifactSigningPosture = installerPosture
    installation = await installWindows(artifact, verificationRoot)
    installation.installerPosture = installerPosture
  }

  stage('inspecting installed package')
  const firstInventory = await inspectInstalledPackage(context, installation, artifactBefore, artifact)
  let updatePayloadEvidence
  if (updateArchive && updateArchiveBefore) {
    stage('inspecting macOS update ZIP payload')
    const updateInstallation = await installMacZip(updateArchive, verificationRoot)
    const updateInventory = await inspectInstalledPackage(
      context,
      updateInstallation,
      updateArchiveBefore,
      updateArchive,
    )
    assert(
      updateInventory.installedInventory.sha256 === firstInventory.installedInventory.sha256,
      'DMG and update ZIP do not contain the same signed application tree',
    )
    assert(
      canonicalJson(updateInventory.nestedSigningPostures)
        === canonicalJson(firstInventory.nestedSigningPostures),
      'DMG and update ZIP nested signing postures differ',
    )
    await runChecked('/usr/bin/xcrun', ['stapler', 'validate', updateInstallation.root], {
      timeout: 60_000,
    })
    updatePayloadEvidence = {
      appTreeSha256: updateInventory.installedInventory.sha256,
      matchesManualArtifact: true,
      signingVerified: true,
      nestedSigningVerified: true,
      packageIdentityVerified: true,
      notarizationStaple: 'validated',
      gatekeeper: 'accepted-notarized-developer-id',
    }
    await uninstall(context, updateInstallation)
  }
  const installedJourney = await runInstalledJourney(context, installation, profileRoot)
  stage('uninstalling')
  const firstInstallation = installation
  await uninstall(context, firstInstallation)
  installation = undefined
  if (context.platform === 'win32') {
    await assertWindowsPathRegistration(firstInstallation, {
      owner: 'absent',
      pathEntry: 'absent',
      label: 'owned PATH cleanup after uninstall',
    })
    seededWindowsPathEntry = windowsEidoCommandDirectory(firstInstallation)
    await seedUnownedWindowsPathEntry(seededWindowsPathEntry)
  }
  assert(existsSync(profileRoot), 'Native uninstall unexpectedly removed the user Profile')

  stage('reinstalling')
  const reinstalled = context.platform === 'darwin'
    ? (await installMac(artifact, verificationRoot)).installation
    : await installWindows(artifact, verificationRoot)
  installation = reinstalled
  if (context.platform === 'win32') {
    await assertWindowsPathRegistration(reinstalled, {
      owner: 'absent',
      pathEntry: 'present',
      label: 'pre-existing unowned PATH entry after reinstall',
    })
  }
  const secondInventory = await inspectInstalledPackage(context, reinstalled, artifactBefore, artifact)
  assert(
    secondInventory.installedInventory.sha256 === firstInventory.installedInventory.sha256,
    'Reinstall changed installed production bytes',
  )
  const reinstalledStatus = assertProfileStatus(await runProfileCli(
    reinstalled,
    gatewayRequest('certification-reinstall-status', 'profile.status', {}),
  ))
  assert(
    reinstalledStatus.revision === installedJourney.finalRevision,
    'Reinstall did not reopen the unchanged synthetic Profile revision',
  )
  await uninstall(context, reinstalled)
  installation = undefined
  if (context.platform === 'win32') {
    await assertWindowsPathRegistration(reinstalled, {
      owner: 'absent',
      pathEntry: 'present',
      label: 'pre-existing unowned PATH entry after uninstall',
    })
    await removeSeededWindowsPathEntry(seededWindowsPathEntry)
    seededWindowsPathEntry = undefined
  }
  stage('journeys complete; sealing evidence')

  const artifactAfter = await fileIdentity(artifact)
  assert(artifactAfter.sha256 === artifactBefore.sha256, 'Sealed artifact bytes changed during certification')
  const updateArchiveAfter = updateArchive ? await updateArchiveIdentity(updateArchive) : undefined
  if (updateArchiveBefore && updateArchiveAfter) {
    assert(
      updateArchiveAfter.sha256 === updateArchiveBefore.sha256
        && updateArchiveAfter.sha512 === updateArchiveBefore.sha512
        && updateArchiveAfter.bytes === updateArchiveBefore.bytes,
      'Sealed macOS update archive changed during certification',
    )
  }
  transcript = {
    schemaVersion: 2,
    certificationSetId: context.intent.certificationSetId,
    sourceSha: context.intent.sourceSha,
    semver: context.intent.semver,
    platform: context.platform,
    arch: context.arch,
    target: context.target,
    evidenceIdentity,
    executionIdentity,
    proofReuse,
    artifact: artifactAfter,
    ...(updateArchiveAfter
      ? { updateArtifact: { ...updateArchiveAfter, payloadEvidence: updatePayloadEvidence } }
      : {}),
    artifactSigningPosture,
    installedInventory: firstInventory.installedInventory,
    asarInventory: firstInventory.asarInventory,
    signingPosture: firstInventory.signingPosture,
    nestedSigningPostures: firstInventory.nestedSigningPostures,
    installedPackageIdentity: firstInventory.installedPackageIdentity,
    provenanceBound: true,
    journey: {
      ...installedJourney,
      uninstallPreservedProfile: true,
      reinstallInventoryMatched: true,
      reinstallRevision: reinstalledStatus.revision,
    },
    reusedProofReferences: [CERTIFICATION_REUSED_PROOF[context.platform]],
    durability: {
      posixDirectoryEntries: 'flushed-before-sqlite-acknowledgement',
      windowsNamespace: 'best-effort-after-file-flush-rename-reopen-rehash',
    },
  }
} catch (error) {
  primaryError = error
} finally {
  if (context.platform === 'darwin') await detachAllOwnedMounts(verificationRoot)
  if (installation) await uninstall(context, installation).catch(() => undefined)
  if (seededWindowsPathEntry) {
    await removeSeededWindowsPathEntry(seededWindowsPathEntry)
      .catch((error) => { primaryError ??= error })
  }
  if (profileRootOwned) {
    await removeOwnedProfileRoot(profileRoot, context).catch((error) => { primaryError ??= error })
  }
  await rm(verificationRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

if (primaryError) throw primaryError
assert(!existsSync(profileRoot), 'Disposable certification Profile root was not removed')
assert(!existsSync(verificationRoot), 'Certification verification root was not removed')

const evidenceDirectory = path.join(
  repositoryRoot,
  '.local',
  'packaged-certification',
  context.intent.certificationSetId,
  `${context.platform}-${context.arch}`,
  'evidence',
)
await mkdir(evidenceDirectory, { recursive: true })
const transcriptPath = path.join(evidenceDirectory, 'journey-transcript.json')
const transcriptBytes = Buffer.from(`${JSON.stringify(transcript, null, 2)}\n`, 'utf8')
await writeFile(transcriptPath, transcriptBytes, { flag: 'wx' })
const platformEvidence = validatePlatformEvidence({
  schemaVersion: 2,
  certificationSetId: context.intent.certificationSetId,
  sourceSha: context.intent.sourceSha,
  semver: context.intent.semver,
  platform: context.platform,
  arch: context.arch,
  target: context.target,
  packageIdentity: CERTIFICATION_PACKAGE_IDENTITY,
  artifact: {
    fileName: path.basename(artifact),
    sha256: transcript.artifact.sha256,
    bytes: transcript.artifact.bytes,
  },
  ...(transcript.updateArtifact ? { updateArtifact: transcript.updateArtifact } : {}),
  artifactSigningPosture: transcript.artifactSigningPosture,
  installedInventory: {
    sha256: transcript.installedInventory.sha256,
    entries: transcript.installedInventory.entries.length,
  },
  signingPosture: transcript.signingPosture,
  nestedSigningPostures: transcript.nestedSigningPostures,
  installedPackageIdentity: transcript.installedPackageIdentity,
  executionIdentity: transcript.executionIdentity,
  proofReuse: transcript.proofReuse,
  listenerEvidence: {
    transientDriverClosed: transcript.journey.transientDriverListenerClosed,
    installedAgentTransport: 'owner-only-local-ipc-plus-stdio',
    reusedProofSha256: CERTIFICATION_REUSED_PROOF[context.platform].sha256,
  },
  contractVersions: CERTIFICATION_CONTRACT_VERSIONS,
  installedJourney: {
    guiEditRestart: true,
    offlineRelaunch: true,
    cliBound: true,
    liveCliBound: true,
    agentSurfaceV3Bound: true,
    spatialBound: true,
    changeTrailBound: true,
    agentRunsLiveOnlyBound: true,
    mcpBound: true,
    uninstall: true,
    reinstall: true,
    firstReleaseMigration: 'not-applicable',
  },
  negativeInventory: {
    leanAllowlist: true,
    noVectorSurface: true,
    noUnexpectedListener: true,
    noSourceMaps: true,
    noCredentials: true,
    noPrivateSource: true,
    noInternalDocumentation: true,
    noTestsFixturesOrTooling: true,
  },
  reusedProofReferences: transcript.reusedProofReferences,
  evidenceSha256: sha256Bytes(transcriptBytes),
})
await writeFile(
  path.join(evidenceDirectory, 'platform-evidence.json'),
  `${JSON.stringify(platformEvidence, null, 2)}\n`,
  { encoding: 'utf8', flag: 'wx' },
)
process.stdout.write(`${JSON.stringify({
  status: 'certified',
  certificationSetId: context.intent.certificationSetId,
  platform: context.platform,
  arch: context.arch,
  artifactSha256: platformEvidence.artifact.sha256,
  evidenceSha256: platformEvidence.evidenceSha256,
})}\n`)

async function readContext(env = process.env) {
  const platform = env.EIDO_CERTIFICATION_PLATFORM?.trim()
  const arch = env.EIDO_CERTIFICATION_ARCH?.trim()
  const expected = platformTarget[platform]
  assert(platform === process.platform && arch === process.arch, 'Certification host identity does not match declarations')
  assert(expected?.arch === arch, 'Certification target identity is invalid')
  const [intent, provenance] = await Promise.all([
    readJson(env.EIDO_CERTIFICATION_INTENT_PATH, 'certification intent'),
    readJson(env.EIDO_CERTIFICATION_PROVENANCE_PATH, 'certification provenance'),
  ])
  const revalidationPath = env.EIDO_CERTIFICATION_REVALIDATION_PATH?.trim()
  assert(revalidationPath && path.isAbsolute(revalidationPath), 'Certification revalidation path is invalid')
  const revalidation = await readJson(revalidationPath, 'certification revalidation')
  const validatedIntent = validateCertificationIntent(intent)
  assert(
    provenance?.schemaVersion === 1
      && provenance.kind === 'eido-packaged-certification-provenance'
      && provenance.certificationSetId === validatedIntent.certificationSetId
      && provenance.sourceSha === validatedIntent.sourceSha
      && provenance.semver === validatedIntent.semver
      && provenance.promotable === true
      && canonicalJson(provenance.packageIdentity) === canonicalJson(CERTIFICATION_PACKAGE_IDENTITY)
      && canonicalJson(provenance.contractVersions) === canonicalJson(CERTIFICATION_CONTRACT_VERSIONS),
    'Certification provenance does not match the intent',
  )
  const runnerTemp = env.RUNNER_TEMP?.trim()
  assert(runnerTemp && path.isAbsolute(runnerTemp), 'Certification runner temp root is invalid')
  // The macOS leg certifies a signed artifact, so it needs the expected
  // Developer ID identity to check that artifact against. Resolving it here
  // fails the run before any native spend if the signing environment is
  // missing: an unsigned macOS Release must never reach a person.
  const signingIdentity = platform === 'darwin'
    ? resolveSigningIdentity(env, {
      credentialDirectoryName: MACOS_RELEASE_CREDENTIAL_DIRECTORY,
      // Certification runs after credentials are removed. It verifies; it
      // never signs or notarizes, so it needs only the public identity.
      requireNotarizationIdentity: false,
    })
    : null
  return {
    platform,
    arch,
    target: expected.target,
    intent: validatedIntent,
    provenance,
    revalidation,
    signingIdentity,
    runnerTemp: path.resolve(runnerTemp),
    osUserScope: env.EIDO_CERTIFICATION_OS_USER_SCOPE,
    githubActions: env.GITHUB_ACTIONS,
    ci: env.CI,
  }
}

async function readExecutionIdentity(context_) {
  const npmEntrypoint = process.env.npm_execpath
  assert(npmEntrypoint && path.isAbsolute(npmEntrypoint), 'Certification npm runtime identity is unavailable')
  const npmVersion = (await runChecked(process.execPath, [npmEntrypoint, '--version'])).stdout.trim()
  const expected = context_.platform === 'darwin'
    ? { runnerOs: 'macOS', runnerArch: 'ARM64' }
    : { runnerOs: 'Windows', runnerArch: 'X64' }
  const identity = {
    hostedEnvironment: context_.osUserScope,
    runnerOs: process.env.RUNNER_OS,
    runnerArch: process.env.RUNNER_ARCH,
    runnerName: process.env.RUNNER_NAME,
    imageOs: process.env.ImageOS,
    imageVersion: process.env.ImageVersion,
    node: process.versions.node,
    npm: npmVersion,
  }
  assert(
    identity.hostedEnvironment === 'github-hosted'
      && identity.runnerOs === expected.runnerOs
      && identity.runnerArch === expected.runnerArch
      && [identity.runnerName, identity.imageOs, identity.imageVersion].every((value) => typeof value === 'string' && value.length > 0)
      && identity.node === context_.provenance.toolchain.node
      && identity.npm === context_.provenance.toolchain.npm,
    'Certification runner/toolchain identity does not match provenance',
  )
  return identity
}

async function requireEphemeralProductProfileRoot(context_) {
  assert(
    context_.githubActions === 'true'
      && context_.ci === 'true'
      && context_.osUserScope === 'github-hosted',
    'Production certification requires a GitHub-hosted ephemeral OS user',
  )
  const parent = context_.platform === 'win32'
    ? process.env.APPDATA
    : process.env.HOME && path.join(process.env.HOME, 'Library', 'Application Support')
  assert(parent && path.isAbsolute(parent), 'Certification app-data root is invalid')
  const canonicalParent = await realpath(parent)
  const profileRoot_ = path.join(canonicalParent, 'Eido')
  assert(path.dirname(profileRoot_) === canonicalParent, 'Certification Profile root escaped app data')
  return profileRoot_
}

async function findArtifact(context_) {
  const packageDirectory = path.join(
    repositoryRoot,
    '.local',
    'packaged-certification',
    context_.intent.certificationSetId,
    `${context_.platform}-${context_.arch}`,
    'package',
  )
  const extension = context_.platform === 'darwin' ? '.dmg' : '.exe'
  const entries = (await readdir(packageDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(extension))
  assert(entries.length === 1, 'Certification requires exactly one sealed artifact')
  return path.join(packageDirectory, entries[0].name)
}

async function findMacosUpdateArchive(context_) {
  const packageDirectory = path.join(
    repositoryRoot,
    '.local',
    'packaged-certification',
    context_.intent.certificationSetId,
    `${context_.platform}-${context_.arch}`,
    'package',
  )
  const entries = (await readdir(packageDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.zip'))
  assert(entries.length === 1, 'Certification requires exactly one sealed macOS update ZIP')
  assert(
    entries[0].name === productionArtifactName(context_.intent.semver, context_.arch, 'zip'),
    'macOS update ZIP name does not match the production version and architecture',
  )
  return path.join(packageDirectory, entries[0].name)
}

async function installMac(artifact_, root) {
  const instance = await mkdtemp(path.join(root, 'mac-install-'))
  const mount = path.join(instance, 'mounted-dmg')
  const installRoot = path.join(instance, 'installed')
  await mkdir(mount)
  await mkdir(installRoot)
  await runChecked('/usr/bin/hdiutil', [
    'attach', '-readonly', '-nobrowse', '-mountpoint', mount, artifact_,
  ], { timeout: 60_000 })
  const apps = (await readdir(mount, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
  assert(apps.length === 1, 'DMG must contain exactly one application')
  const mountedApp = path.join(mount, apps[0].name)
  const installedApp = path.join(installRoot, apps[0].name)
  await runChecked('/usr/bin/ditto', [mountedApp, installedApp], { timeout: 60_000 })
  await runChecked('/usr/bin/hdiutil', ['detach', mount], { timeout: 60_000 })
  const executable = path.join(installedApp, 'Contents', 'MacOS', 'Eido')
  assert(existsSync(executable), 'Installed macOS executable is missing')
  return {
    installation: { root: installedApp, executable, installRoot },
  }
}

async function installMacZip(artifact_, root) {
  const instance = await mkdtemp(path.join(root, 'mac-update-'))
  const extracted = path.join(instance, 'extracted')
  await mkdir(extracted)
  await runChecked('/usr/bin/ditto', ['-x', '-k', artifact_, extracted], { timeout: 60_000 })
  const entries = await readdir(extracted, { withFileTypes: true })
  assert(
    entries.length === 1 && entries[0].isDirectory() && entries[0].name === 'Eido.app',
    'Update ZIP top level must contain only Eido.app',
  )
  const appRoot = path.join(extracted, entries[0].name)
  const executable = path.join(appRoot, 'Contents', 'MacOS', 'Eido')
  assert(existsSync(executable), 'Update ZIP application executable is missing')
  return { root: appRoot, executable, installRoot: instance }
}

async function installWindows(artifact_, root) {
  const installParent = path.join(root, 'windows-install')
  const installRoot = path.join(installParent, 'Eido')
  await mkdir(installParent, { recursive: true })
  await rm(installRoot, { recursive: true, force: true })
  await runChecked(artifact_, ['/S', `/D=${installRoot}`], { timeout: 120_000 })
  const executable = path.join(installRoot, 'Eido.exe')
  assert(await waitFor(() => existsSync(executable), 30_000), 'Installed Windows executable is missing')
  return { root: installRoot, executable, installRoot }
}

async function uninstall(context_, installation_) {
  if (context_.platform === 'darwin') {
    await rm(installation_.root, { recursive: true, force: true })
    assert(!existsSync(installation_.root), 'macOS uninstall left the application behind')
    return
  }
  const uninstaller = path.join(installation_.root, 'Uninstall Eido.exe')
  assert(existsSync(uninstaller), 'Windows uninstaller is missing')
  await runChecked(uninstaller, ['/S'], { timeout: 120_000 })
  // The NSIS uninstaller copies itself to %TEMP% and exits immediately while
  // the copy performs the actual cleanup, so every post-uninstall absence
  // check needs a bounded wait — the application executable and the Start
  // Menu shortcut are removed at different moments of that async cleanup
  // (run 6: the shortcut check raced the uninstaller and failed ~2s in while
  // everything else was green).
  assert(await waitFor(() => !existsSync(installation_.executable), 30_000), 'Windows uninstall left the application behind')
  const shortcut = path.join(
    process.env.APPDATA,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Eido.lnk',
  )
  assert(await waitFor(() => !existsSync(shortcut), 30_000), 'Windows uninstall left its Start Menu shortcut behind')
  await rm(installation_.root, { recursive: true, force: true })
}

async function inspectInstalledPackage(context_, installation_, artifactIdentity, artifactLocation) {
  const inventory = await installedTreeInventory(installation_.root)
  assertInstalledRuntimeInventory(context_.platform, inventory.entries)
  const resources = context_.platform === 'darwin'
    ? path.join(installation_.root, 'Contents', 'Resources')
    : path.join(installation_.root, 'resources')
  const embeddedProvenance = await readJson(
    path.join(resources, 'certification-provenance.json'),
    'embedded certification provenance',
  )
  assert(
    canonicalJson(embeddedProvenance) === canonicalJson(context_.provenance),
    'Installed provenance does not match the paired certification intent',
  )
  if (context_.platform === 'darwin') {
    const updaterConfiguration = await readFile(path.join(resources, 'app-update.yml'), 'utf8')
    assert(
      updaterConfiguration
        === 'provider: generic\nurl: https://updates.eido.so/\nupdaterCacheDirName: eido-updater\n',
      'Installed macOS updater configuration does not match the certified generic feed',
    )
  }
  const asarPath = path.join(resources, 'app.asar')
  const asarCli = path.join(repositoryRoot, 'node_modules', '@electron', 'asar', 'bin', 'asar.js')
  const listing = await runChecked(process.execPath, [asarCli, 'list', asarPath])
  const asarEntries = listing.stdout.replaceAll('\\', '/').split(/\r?\n/).filter(Boolean)
  const asarInventory = assertLeanArtifactInventory(asarEntries)
  const installedManifest = await readInstalledAsarManifest(asarCli, asarPath, context_.runnerTemp)
  assert(
    installedManifest.name === 'eido'
      && installedManifest.version === context_.intent.semver
      && installedManifest.main === 'dist-electron/main.cjs'
      && canonicalJson(installedManifest.dependencies) === canonicalJson({}),
    'Installed ASAR package identity does not match the certification intent',
  )
  const installedPackageIdentity = context_.platform === 'darwin'
    ? await inspectMacPackageIdentity(context_, installation_, inventory.entries)
    : await inspectWindowsPackageIdentity(context_, installation_, artifactLocation)

  let signingPosture
  const nestedSigningPostures = []
  if (context_.platform === 'darwin') {
    const expected = {
      expectedAuthority: context_.signingIdentity.expectedAuthority,
      expectedTeamId: context_.signingIdentity.expectedTeamId,
    }
    await runChecked('/usr/bin/codesign', ['--verify', '--deep', '--strict', installation_.root])
    for (const executable of [
      path.join(installation_.root, 'Contents', 'Resources', 'bin', 'eido'),
      path.join(
        installation_.root,
        'Contents',
        'Resources',
        'bin',
        'eido-profile-live-gateway-helper',
      ),
      path.join(
        installation_.root,
        'Contents',
        'Frameworks',
        'Squirrel.framework',
        'Versions',
        'A',
        'Resources',
        'ShipIt',
      ),
    ]) {
      await runChecked('/usr/bin/codesign', ['--verify', '--strict', executable])
      const nestedSignature = await runChecked(
        '/usr/bin/codesign',
        ['--display', '--verbose=4', executable],
      )
      nestedSigningPostures.push({
        path: path.relative(installation_.root, executable).replaceAll('\\', '/'),
        signingPosture: parseDeveloperIdSigningPosture(
          `${nestedSignature.stdout}\n${nestedSignature.stderr}`,
          expected,
        ),
      })
    }
    const signature = await runChecked('/usr/bin/codesign', ['--display', '--verbose=4', installation_.root])
    signingPosture = parseDeveloperIdSigningPosture(`${signature.stdout}\n${signature.stderr}`, expected)
    // The installed app is what the person double-clicks. Gatekeeper must
    // accept it on its own, not merely accept the disk image it arrived in.
    await assessGatekeeper(['--assess', '--type', 'execute', '--verbose=4', installation_.root])
  } else {
    signingPosture = parseWindowsAuthenticode(inspectUnsignedWindowsExecutable(
      installation_.executable,
      { cwd: repositoryRoot },
    ))
    for (const relative of [
      'eido-profile-mcp.exe',
      'resources/bin/eido.exe',
      'resources/bin/eido-profile-live-gateway-helper.exe',
    ]) {
      nestedSigningPostures.push({
        path: relative,
        signingPosture: parseWindowsAuthenticode(inspectUnsignedWindowsExecutable(
          path.join(installation_.root, ...relative.split('/')),
          { cwd: repositoryRoot },
        )),
      })
    }
    assert(canonicalJson(installation_.installerPosture ?? signingPosture) === canonicalJson(signingPosture),
      'Windows installer and installed executable posture differ')
  }
  return {
    artifact: artifactIdentity,
    installedInventory: inventory,
    asarInventory,
    signingPosture,
    nestedSigningPostures,
    installedPackageIdentity,
  }
}

async function readInstalledAsarManifest(asarCli, asarPath, runnerTemp) {
  const extractionRoot = await mkdtemp(path.join(runnerTemp, 'eido-certification-asar-'))
  try {
    await runChecked(process.execPath, [asarCli, 'extract-file', asarPath, 'package.json'], {
      cwd: extractionRoot,
    })
    return JSON.parse(await readFile(path.join(extractionRoot, 'package.json'), 'utf8'))
  } finally {
    await rm(extractionRoot, { recursive: true, force: true })
  }
}

async function inspectMacPackageIdentity(context_, installation_, installedEntries) {
  const plist = path.join(installation_.root, 'Contents', 'Info.plist')
  const resourcesBin = path.join(installation_.root, 'Contents', 'Resources', 'bin')
  const cli = path.join(resourcesBin, 'eido')
  const helper = path.join(resourcesBin, 'eido-profile-live-gateway-helper')
  const machOBinaries = await inspectInstalledMacMachOBinaries(
    installation_.root,
    installedEntries,
  )
  const [
    appId,
    semver,
    executable,
    minimumSystemVersion,
  ] = await Promise.all([
    runChecked('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', plist]),
    runChecked('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleShortVersionString', plist]),
    runChecked('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', plist]),
    runChecked('/usr/libexec/PlistBuddy', ['-c', 'Print :LSMinimumSystemVersion', plist]),
  ])
  assert(appId.stdout.trim() === CERTIFICATION_PACKAGE_IDENTITY.appId, 'Installed macOS bundle identifier drifted')
  assert(semver.stdout.trim() === context_.intent.semver, 'Installed macOS bundle version drifted')
  assert(executable.stdout.trim() === 'Eido', 'Installed macOS executable identity drifted')
  assert(minimumSystemVersion.stdout.trim() === '13.5.0', 'Installed macOS product floor drifted')

  const requiredMachOBinaries = [
    ['main executable', path.relative(installation_.root, installation_.executable)],
    ['CLI', path.relative(installation_.root, cli)],
    ['Live Gateway helper', path.relative(installation_.root, helper)],
  ]
  const requiredEvidence = requiredMachOBinaries.map(([label, relative]) => {
    const evidence = machOBinaries.find((candidate) => candidate.path === relative)
    assert(evidence, `Installed macOS ${label} is not a Mach-O binary`)
    return [label, evidence]
  })
  assert(
    requiredEvidence[0][1].architectures.trim() === 'arm64',
    'Installed macOS executable is not arm64-only',
  )
  assert(
    requiredEvidence[1][1].architectures.trim() === 'arm64',
    'Installed macOS CLI is not arm64-only',
  )
  assert(
    requiredEvidence[2][1].architectures.trim() === 'arm64',
    'Installed macOS Live Gateway helper is not arm64-only',
  )
  for (const [label, evidence] of requiredEvidence) {
    try {
      assertMacDeploymentTargetAtOrBelow(evidence.loadCommands, '13.5.0')
    } catch {
      throw new Error(`Installed macOS ${label} requires newer than macOS 13.5`)
    }
  }
  for (const evidence of machOBinaries) {
    try {
      assertArm64MacDeploymentEvidence(
        evidence.architectures,
        evidence.loadCommands,
        '13.5.0',
      )
    } catch (error) {
      throw new Error(
        `Installed macOS Mach-O ${evidence.path} is incompatible with Friends Alpha: ${error.message}`,
      )
    }
  }
  assert(path.basename(installation_.root) === 'Eido.app', 'Installed macOS product name drifted')
  return {
    appId: CERTIFICATION_PACKAGE_IDENTITY.appId,
    productName: CERTIFICATION_PACKAGE_IDENTITY.productName,
    semver: context_.intent.semver,
    executable: 'Eido',
    architecture: 'arm64',
    metadataSource: 'bundle-plist-and-mach-o',
  }
}

async function inspectInstalledMacMachOBinaries(root, installedEntries) {
  const binaries = await enumerateInstalledMachOBinaries(root, installedEntries)
  assert(binaries.length > 0, 'Installed macOS inventory contains no Mach-O binaries')
  return Promise.all(binaries.map(async (binary) => {
    const [architectures, loadCommands] = await Promise.all([
      runChecked('/usr/bin/lipo', ['-archs', binary.absolute]),
      // otool-classic treats parenthesized Electron helper names as archive
      // member syntax and truncates the real path. vtool reads the same
      // LC_BUILD_VERSION evidence without that path ambiguity.
      runChecked('/usr/bin/vtool', ['-show-build', binary.absolute]),
    ])
    return {
      path: binary.path,
      architectures: architectures.stdout,
      loadCommands: loadCommands.stdout,
    }
  }))
}

async function inspectWindowsPackageIdentity(context_, installation_, artifactLocation) {
  const installer = await readWindowsVersionInfo(artifactLocation)
  const installed = await readWindowsVersionInfo(installation_.executable)
  assert(installer.productName === CERTIFICATION_PACKAGE_IDENTITY.productName, 'Windows installer product name drifted')
  assert(installer.productVersion === context_.intent.semver, 'Windows installer product version drifted')
  assert(installed.productName === CERTIFICATION_PACKAGE_IDENTITY.productName, 'Installed Windows product name drifted')
  const numericVersion = context_.intent.semver.split(/[+-]/, 1)[0]
  assert(
    installed.productVersion === numericVersion || installed.productVersion === `${numericVersion}.0`,
    'Installed Windows executable version drifted',
  )
  const shortcut = path.join(
    process.env.APPDATA,
    'Microsoft',
    'Windows',
    'Start Menu',
    'Programs',
    'Eido.lnk',
  )
  const installedAppId = await readWindowsShortcutAppId(shortcut)
  assert(installedAppId === CERTIFICATION_PACKAGE_IDENTITY.appId, 'Installed Windows AppUserModelID drifted')
  assert(await readPeArchitecture(installation_.executable) === 'x64', 'Installed Windows executable is not x64')
  assert(
    await readPeArchitecture(path.join(installation_.root, 'eido-profile-mcp.exe')) === 'x64',
    'Installed Windows MCP executable is not x64',
  )
  assert(
    await readPeArchitecture(path.join(
      installation_.root,
      'resources',
      'bin',
      'eido.exe',
    )) === 'x64',
    'Installed Windows CLI executable is not x64',
  )
  assert(
    await readPeArchitecture(path.join(
      installation_.root,
      'resources',
      'bin',
      'eido-profile-live-gateway-helper.exe',
    )) === 'x64',
    'Installed Windows Live Gateway helper is not x64',
  )
  return {
    appId: CERTIFICATION_PACKAGE_IDENTITY.appId,
    productName: CERTIFICATION_PACKAGE_IDENTITY.productName,
    semver: context_.intent.semver,
    executable: 'Eido.exe',
    architecture: 'x64',
    metadataSource: 'asar-and-pe-version-resource',
  }
}

async function readWindowsShortcutAppId(shortcut) {
  assert(existsSync(shortcut), 'Installed Windows Start Menu shortcut is missing')
  // The inspected path travels as an environment variable: arguments after
  // `powershell.exe -Command <script>` are concatenated into the command text
  // and never bound to PowerShell's automatic argument array, so positional
  // lookups there always resolve to null (certification run 2, Windows leg).
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$shortcut = Get-Item -LiteralPath $env:EIDO_CERTIFICATION_INSPECT_PATH',
    '$shell = New-Object -ComObject Shell.Application',
    '$folder = $shell.Namespace($shortcut.DirectoryName)',
    '$item = $folder.ParseName($shortcut.Name)',
    "$item.ExtendedProperty('System.AppUserModel.ID')",
  ].join('; ')
  return (await runWindowsInspection(script, shortcut)).stdout.trim()
}

async function readWindowsVersionInfo(executable) {
  assert(existsSync(executable), `Windows version-info target is missing: ${path.basename(executable)}`)
  const script = [
    "$ErrorActionPreference = 'Stop'",
    '$info = (Get-Item -LiteralPath $env:EIDO_CERTIFICATION_INSPECT_PATH).VersionInfo',
    "[ordered]@{ productName = $info.ProductName; productVersion = $info.ProductVersion } | ConvertTo-Json -Compress",
  ].join('; ')
  const result = await runWindowsInspection(script, executable)
  return JSON.parse(result.stdout)
}

function runWindowsInspection(script, inspectedPath) {
  assert(typeof inspectedPath === 'string' && path.isAbsolute(inspectedPath),
    'Windows inspection target path must be absolute')
  return runChecked('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script,
  ], {
    env: { ...cleanElectronEnvironment(process.env), EIDO_CERTIFICATION_INSPECT_PATH: inspectedPath },
  })
}

async function readPeArchitecture(executable) {
  const handle = await open(executable, 'r')
  try {
    const dos = Buffer.alloc(64)
    await handle.read(dos, 0, dos.length, 0)
    assert(dos.subarray(0, 2).toString('ascii') === 'MZ', 'Windows executable lacks an MZ header')
    const peOffset = dos.readUInt32LE(0x3c)
    const pe = Buffer.alloc(6)
    await handle.read(pe, 0, pe.length, peOffset)
    assert(pe.subarray(0, 4).equals(Buffer.from('PE\0\0', 'binary')), 'Windows executable lacks a PE header')
    return pe.readUInt16LE(4) === 0x8664 ? 'x64' : 'unsupported'
  } finally {
    await handle.close()
  }
}

async function runInstalledJourney(context_, installation_, profileRoot_) {
  stage('journey: shipped GUI edit')
  const edited = await runGuiCdpJourney(installation_, { action: 'edit' })
  assert(existsSync(profileRoot_), 'Shipped GUI did not create the installed Profile')
  const profileMetadata = await lstat(profileRoot_)
  assert(profileMetadata.isDirectory() && !profileMetadata.isSymbolicLink(), 'Installed Profile root is unsafe')

  stage('journey: installed PATH command from unrelated cwd')
  const pathStatus = assertProfileStatusResult(assertErgonomicGatewaySuccess(
    await runInstalledEidoPathCommand(context_, installation_, ['status']),
    'headless',
  ))
  stage('journey: installed CLI binding')
  const statusAfterGui = assertProfileStatus(await runProfileCli(
    installation_,
    gatewayRequest('certification-gui-status', 'profile.status', {}),
  ))
  assert(pathStatus.revision === statusAfterGui.revision, 'PATH command observed a different installed Profile revision')
  const capabilities = assertProfileCapabilities(await runProfileCli(
    installation_,
    gatewayRequest('certification-capabilities', 'profile.capabilities', {}),
  ))
  const agentCapabilities = assertAgentCapabilities(await runErgonomicProfileCli(
    installation_,
    ['capabilities'],
  ))
  const runOperations = await Promise.all(agentRunOperations.map((operation) => (
    runErgonomicProfileCli(installation_, ['describe', operation])
  )))
  assertAgentRunOperationDescriptions(runOperations)
  const appClosedRunRejections = []
  for (const arguments_ of [
    [
      'run', 'certification-no-live-card', '--idea', 'certification-no-live-idea',
    ],
    [
      'run', 'status', 'certification-no-live-run',
    ],
    [
      'run', 'read', 'certification-no-live-run',
    ],
  ]) {
    appClosedRunRejections.push(await runErgonomicProfileCliOutcome(installation_, arguments_))
  }
  for (const rejection of appClosedRunRejections) assertAppClosedAgentRunRejection(rejection)
  const cardQuery = assertGatewaySuccess(await runProfileCli(
    installation_,
    gatewayRequest('certification-gui-card', 'graph.query', {
      recordKinds: ['card'],
      recordIds: [edited.cardId],
      limit: 1,
      byteLimit: 8_192,
    }),
  ))
  assert(cardQuery.items?.[0]?.recordId === edited.cardId, 'CLI did not observe the shipped-GUI edit')
  const ideaId = cardQuery.items[0].ownerId?.replace(/^board:/, '')
  assert(typeof ideaId === 'string' && ideaId !== cardQuery.items[0].ownerId, 'GUI Card owner was not a Board')
  const neighbors = assertGatewaySuccess(await runProfileCli(
    installation_,
    gatewayRequest('certification-card-neighbors', 'graph.neighbors', {
      ideaId,
      card: edited.cardId,
      limit: 8,
      byteLimit: 16_384,
    }),
  ))
  assert(neighbors.revision === statusAfterGui.revision, 'Spatial neighbors did not bind the inspected revision')
  assert(neighbors.ideaId === ideaId && neighbors.card?.cardId === edited.cardId, 'Spatial neighbors did not resolve the GUI Card')
  const bounds = assertGatewaySuccess(await runProfileCli(
    installation_,
    gatewayRequest('certification-card-bounds', 'graph.bounds', {
      ideaId,
      cards: [edited.cardId],
    }),
  ))
  assert(bounds.revision === statusAfterGui.revision, 'Spatial bounds did not bind the inspected revision')
  assert(bounds.cards?.length === 1 && bounds.cards[0]?.cardId === edited.cardId, 'Spatial bounds did not resolve the GUI Card')
  const resolvedBox = bounds.cards[0]
  assert(typeof resolvedBox.kind === 'string', 'Spatial bounds omitted the resolved Card kind')
  assert(Number.isFinite(resolvedBox.position?.x) && Number.isFinite(resolvedBox.position?.y), 'Spatial bounds omitted the resolved Card position')
  assert(Number.isFinite(resolvedBox.size?.width) && resolvedBox.size.width > 0
    && Number.isFinite(resolvedBox.size?.height) && resolvedBox.size.height > 0, 'Spatial bounds omitted the resolved Card size')
  assert(Number.isFinite(bounds.bounds?.width) && Number.isFinite(bounds.bounds?.height), 'Spatial bounds are not finite')
  assert(bounds.bounds.x === resolvedBox.position.x && bounds.bounds.y === resolvedBox.position.y
    && bounds.bounds.width === resolvedBox.size.width && bounds.bounds.height === resolvedBox.size.height,
  'Singleton spatial aggregate did not match its resolved Card box')

  stage('journey: offline GUI reopen')
  const reopened = await runGuiCdpJourney(installation_, {
    action: 'offline-reopen',
    expectedCardId: edited.cardId,
  })
  assert(reopened.networkDeniedFromProcessStart, 'Offline relaunch did not deny browser network from process start')
  // The GUI shutdown checkpoint commits the renderer state, advancing the
  // Profile revision even for a read-only reopen. The MCP mutation must bind
  // the revision observed after the last GUI session, not the pre-reopen one
  // (run 5: symmetric command.batch 'conflict' on both platforms).
  const statusAfterReopen = assertProfileStatus(await runProfileCli(
    installation_,
    gatewayRequest('certification-reopen-status', 'profile.status', {}),
  ))
  const mcpRequest = {
    version: 1,
    schemaVersion: 1,
    expectedRevision: statusAfterReopen.revision,
    idempotencyKey: `certification-mcp-${context_.intent.certificationSetId}`,
    dryRun: false,
    commands: [{
      version: 1,
      id: 'certification-mcp-create-title',
      name: 'card.create',
      payload: {
        ideaId,
        kind: 'title',
        position: { x: 640, y: 360 },
        body: 'Packaged certification MCP seam',
      },
    }],
  }
  stage('journey: installed MCP binding')
  const mcp = await runProfileMcp(installation_, mcpRequest)
  stage('journey: final status')
  const finalStatus = assertProfileStatus(await runProfileCli(
    installation_,
    gatewayRequest('certification-final-status', 'profile.status', {}),
  ))
  assert(finalStatus.revision === statusAfterReopen.revision + 1, 'MCP mutation did not advance exactly one revision')
  assert(mcp.receipt.revision === finalStatus.revision, 'MCP receipt did not bind the final revision')
  const changes = assertGatewaySuccess(await runProfileCli(
    installation_,
    gatewayRequest('certification-agent-changes', 'changes.list', {
      since: statusAfterGui.revision,
      limit: 20,
      byteLimit: 64 * 1024,
    }),
  ))
  assert(changes.revision === finalStatus.revision, 'Agent change trail did not bind the final revision')
  assert(changes.items?.some((item) => (
    item.revision === finalStatus.revision
      && item.command?.id === 'certification-mcp-create-title'
      && item.command?.name === 'card.create'
      && item.actor?.kind === 'agent'
  )), 'Agent change trail did not project the packaged MCP mutation')

  return {
    gui: {
      ordinaryProductionArguments: true,
      driver: 'chromium-loopback-cdp-launch-argument',
      cardIdSha256: sha256Bytes(Buffer.from(edited.cardId, 'utf8')),
      revisionAfterEdit: statusAfterGui.revision,
      joinedClose: edited.exitCode === 0,
    },
    liveCli: edited.liveCli,
    offlineRelaunch: {
      networkEmulation: 'offline',
      processLaunchNetwork: 'loopback-deny-proxy',
      sameCardObserved: reopened.cardId === edited.cardId,
      joinedClose: reopened.exitCode === 0,
      revisionAfterReopen: statusAfterReopen.revision,
    },
    cli: {
      exactPlatformEnvelope: true,
      pathCommand: {
        resolvedByCommandName: true,
        unrelatedWorkingDirectory: true,
        servedBy: 'headless',
      },
      contractVersions: statusAfterGui.versions,
      installedSurfaceVersion: capabilities.commandBatch.version,
      commandNames: capabilities.commands,
      agentCapabilities,
      runBoundary: {
        operations: agentRunOperations,
        availability: 'live-app',
        appClosedRejected: agentRunOperations,
        headlessFallback: 'forbidden',
      },
      spatial: {
        neighborsBound: neighbors.revision === statusAfterGui.revision,
        boundsBound: bounds.revision === statusAfterGui.revision,
      },
    },
    mcp,
    changes: {
      revision: changes.revision,
      projectedMutation: true,
    },
    finalRevision: finalStatus.revision,
    transientDriverListenerClosed: edited.driverEndpointClosed && reopened.driverEndpointClosed,
  }
}

async function runGuiCdpJourney(installation_, { action, expectedCardId }) {
  const executable = installation_.executable
  const environment = cleanElectronEnvironment(process.env)
  const denyProxy = action === 'offline-reopen' ? await startDenyProxy() : undefined
  const launchArguments = ['--remote-debugging-port=0']
  if (denyProxy) {
    launchArguments.push(`--proxy-server=${denyProxy.url}`, '--proxy-bypass-list=<-loopback>')
  }
  // No windowsHide here: a real user's installed GUI launch shows a visible
  // window, and libuv's windowsHide passes an SW_HIDE startup hint that can
  // leave the first shown Chromium window invisible — which would hide the
  // very window the ordinary user close seam must target.
  const child = spawn(executable, launchArguments, {
    cwd: path.dirname(executable),
    env: environment,
  })
  let stdout = ''
  let stderr = ''
  let endpoint
  const endpointPromise = new Promise((resolve, reject) => {
    const inspect = (text) => {
      const match = /DevTools listening on (ws:\/\/[^\s]+)/.exec(text)
      if (match && !endpoint) {
        endpoint = match[1]
        resolve(endpoint)
      }
    }
    child.stdout.on('data', (chunk) => { stdout += chunk; inspect(stdout) })
    child.stderr.on('data', (chunk) => { stderr += chunk; inspect(stderr) })
    child.once('error', reject)
  })
  const closed = new Promise((resolve) => child.once('close', (code, signal) => resolve({ code, signal })))
  const timer = setTimeout(() => terminateChild(child), timeoutMs)
  stage(`gui ${action}: launched pid ${child.pid}`)
  try {
    const browserEndpoint = await withTimeout(endpointPromise, timeoutMs, 'GUI DevTools endpoint')
    const pageEndpoint = await waitForPageEndpoint(browserEndpoint)
    const client = await CdpClient.connect(pageEndpoint)
    stage(`gui ${action}: page target connected`)
    await client.send('Runtime.enable')
    await client.send('Page.enable')
    let cardId
    let liveCli
    if (action === 'edit') {
      await waitForEvaluation(client, `Boolean(document.querySelector('[aria-label="Add note"]'))`, 'Add note control visible')
      const before = await evaluate(client, `Array.from(document.querySelectorAll('[data-id]'), element => element.getAttribute('data-id')).filter(Boolean)`)
      await evaluate(client, `document.querySelector('[aria-label="Add note"]').click(); true`)
      cardId = await waitForEvaluation(client, `(() => {
        const before = new Set(${JSON.stringify(before)})
        return Array.from(document.querySelectorAll('[data-id]'), element => element.getAttribute('data-id'))
          .find(id => id && !before.has(id)) || false
      })()`, 'created Card visible')
      const liveStatus = assertErgonomicGatewaySuccess(
        await runErgonomicProfileCli(installation_, ['status']),
        'live',
      )
      assert(
        liveStatus.owner?.route === 'active-owner' && liveStatus.owner?.mode === 'mutable',
        'Ergonomic CLI did not route through the active packaged Profile owner',
      )
      liveCli = {
        servedBy: 'live',
        ownerRoute: liveStatus.owner.route,
        revision: liveStatus.revision,
      }
    } else {
      assert(typeof expectedCardId === 'string', 'Offline GUI reopen requires the edited Card identity')
      const cardVisible = `Array.from(document.querySelectorAll('[data-id]'), element => element.getAttribute('data-id')).includes(${JSON.stringify(expectedCardId)}) && ${JSON.stringify(expectedCardId)}`
      // The page target exists from navigation start while the DOM is still
      // the initial empty document — whose readyState is already 'complete'.
      // Reloading before the app document commits aborts the app's own
      // startup loadURL, which correctly fails closed (run 4: symmetric
      // ERR_ABORTED on both platforms). Gate on the persisted Card being
      // visible in the reopened app document, which the blank initial
      // document can never satisfy, before applying offline emulation and
      // reloading; a driver-scoped marker proves the reloaded document is a
      // fresh one rather than the pre-reload document.
      await waitForEvaluation(client, cardVisible, 'reopened Card visible before offline reload')
      stage(`gui ${action}: reopened Card visible; applying offline emulation and reloading`)
      await evaluate(client, 'window.__eidoCertificationPreReload = true')
      await client.send('Network.enable')
      await client.send('Network.emulateNetworkConditions', {
        offline: true,
        latency: 0,
        downloadThroughput: 0,
        uploadThroughput: 0,
      })
      await client.send('Page.reload', { ignoreCache: true })
      cardId = await waitForEvaluation(
        client,
        `window.__eidoCertificationPreReload === undefined && document.readyState === 'complete' && ${cardVisible}`,
        'offline-reloaded Card visible',
      )
    }
    stage(`gui ${action}: card observed; requesting ordinary user close`)
    client.close()
    // Close through the ordinary user seam (macOS app quit / Windows title-bar
    // close), never a renderer-initiated DOM window.close(): Electron tears the
    // WebContents down for renderer-initiated closes before the main process
    // can run its cancellable close handling, which kills the app's joined
    // Profile shutdown and is not how a real user exits.
    await requestOrdinaryUserClose(child)
    const outcome = await withTimeout(closed, timeoutMs, 'GUI joined close')
    stage(`gui ${action}: exited code ${outcome.code} signal ${outcome.signal}`)
    assert(outcome.code === 0 && outcome.signal === null, `GUI exited without a joined close: ${stderr || stdout}`)
    const origin = new URL(browserEndpoint)
    const driverEndpointClosed = await waitFor(async () => {
      try {
        await fetch(`http://${origin.host}/json/version`, { signal: AbortSignal.timeout(250) })
        return false
      } catch {
        return true
      }
    }, 5_000)
    assert(driverEndpointClosed, 'Transient GUI driver endpoint remained open')
    return {
      cardId,
      exitCode: outcome.code,
      driverEndpointClosed,
      networkDeniedFromProcessStart: Boolean(denyProxy),
      ...(liveCli === undefined ? {} : { liveCli }),
    }
  } catch (error) {
    // Hosted certification is debugged only from this log: surface the app's
    // own output (e.g. EIDO_SHELL_FATAL) and exit state alongside the harness
    // failure instead of discarding them.
    stage(`gui ${action}: failed (${error.message}); exit ${child.exitCode ?? 'running'}/${child.signalCode ?? 'none'}; app output tail: ${JSON.stringify((stderr || stdout).slice(-1500))}`)
    throw error
  } finally {
    clearTimeout(timer)
    if (child.exitCode === null && child.signalCode === null) terminateChild(child)
    await denyProxy?.close()
  }
}

async function requestOrdinaryUserClose(child) {
  assert(child.exitCode === null && child.signalCode === null, 'GUI exited before the user close request')
  if (process.platform === 'darwin') {
    // The quit Apple Event is the ordinary macOS user exit (Cmd-Q / Dock →
    // Quit). It drives Electron's cancellable before-quit path, so the app's
    // joined Profile shutdown runs exactly as it does for a real user.
    await runChecked('/usr/bin/osascript', [
      '-e', `tell application id "${CERTIFICATION_PACKAGE_IDENTITY.appId}" to quit`,
    ], { timeout: timeoutMs })
    return
  }
  // Posting WM_CLOSE to the GUI's visible unowned top-level window is the
  // ordinary Windows user exit (title-bar close button). It drives Electron's
  // cancellable window close path, joining Profile shutdown. The window is
  // selected directly with Win32 EnumWindows because .NET's
  // Process.MainWindowHandle heuristic reported no window on the hosted
  // runner (certification run 3, Windows leg).
  assert(typeof child.pid === 'number', 'GUI process identity is unavailable for the user close request')
  const script = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

public static class EidoCertificationUserClose
{
    private delegate bool EnumWindowsCallback(IntPtr windowHandle, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool EnumWindows(EnumWindowsCallback callback, IntPtr parameter);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern uint GetWindowThreadProcessId(IntPtr windowHandle, out uint processId);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr GetWindow(IntPtr windowHandle, uint command);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr windowHandle);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern bool PostMessage(IntPtr windowHandle, uint message, IntPtr wParameter, IntPtr lParameter);

    private const uint GetWindowOwnerCommand = 4;
    private const uint WindowMessageClose = 0x0010;

    // Returns { top-level windows owned by the process, WM_CLOSE requests posted }.
    public static int[] RequestClose(uint targetProcessId)
    {
        int processWindows = 0;
        int closeRequests = 0;
        EnumWindows(delegate(IntPtr windowHandle, IntPtr parameter)
        {
            uint windowProcessId;
            GetWindowThreadProcessId(windowHandle, out windowProcessId);
            if (windowProcessId == targetProcessId)
            {
                processWindows++;
                if (IsWindowVisible(windowHandle)
                    && GetWindow(windowHandle, GetWindowOwnerCommand) == IntPtr.Zero
                    && PostMessage(windowHandle, WindowMessageClose, IntPtr.Zero, IntPtr.Zero))
                {
                    closeRequests++;
                }
            }
            return true;
        }, IntPtr.Zero);
        return new int[] { processWindows, closeRequests };
    }
}
'@
$targetProcessId = [uint32]$env:EIDO_CERTIFICATION_GUI_PID
$deadline = [DateTime]::UtcNow.AddSeconds(30)
$survey = @(0, 0)
while ($true) {
  $survey = [EidoCertificationUserClose]::RequestClose($targetProcessId)
  if ($survey[1] -gt 0 -or [DateTime]::UtcNow -ge $deadline) { break }
  Start-Sleep -Milliseconds 100
}
if ($survey[1] -eq 0) {
  throw "Installed GUI exposed no visible unowned top-level window to close (process top-level windows: $($survey[0]))"
}
`
  await runChecked('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], {
    timeout: timeoutMs,
    env: { ...cleanElectronEnvironment(process.env), EIDO_CERTIFICATION_GUI_PID: String(child.pid) },
  })
}

async function startDenyProxy() {
  const server = createServer((socket) => socket.destroy())
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address === 'object', 'Offline deny proxy address is unavailable')
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  }
}

async function waitForPageEndpoint(browserEndpoint) {
  const origin = new URL(browserEndpoint)
  let page
  const found = await waitFor(async () => {
    try {
      const response = await fetch(`http://${origin.host}/json/list`, { signal: AbortSignal.timeout(500) })
      const targets = await response.json()
      page = targets.find((target) => target.type === 'page' && target.url?.startsWith('eido://app'))
      return Boolean(page?.webSocketDebuggerUrl)
    } catch {
      return false
    }
  }, timeoutMs)
  assert(found, 'GUI page target was not available')
  return page.webSocketDebuggerUrl
}

async function evaluate(client, expression) {
  const response = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  })
  if (response.exceptionDetails) throw new Error('GUI evaluation failed')
  return response.result?.value
}

async function waitForEvaluation(client, expression, label) {
  let value
  const found = await waitFor(async () => {
    try {
      value = await evaluate(client, expression)
      return Boolean(value)
    } catch {
      return false
    }
  }, timeoutMs)
  assert(found, `GUI condition did not become observable: ${label}`)
  return value
}

async function runProfileCli(installation_, request) {
  const executable = process.platform === 'darwin'
    ? path.join(installation_.root, 'Contents', 'Resources', 'bin', 'eido')
    : path.join(installation_.root, 'resources', 'bin', 'eido.exe')
  const result = await runCommand(executable, ['batch'], {
    input: JSON.stringify(request),
    timeout: timeoutMs,
  })
  const response = parseProfileCliResponse(result.stdoutBytes, { envelope: 'standalone' })
  assert(result.code === 0, `Profile CLI failed (${response.error?.code ?? result.code})`)
  assert(result.stderr === '', 'Profile CLI emitted diagnostics on success')
  return response
}

async function runErgonomicProfileCli(installation_, arguments_) {
  const outcome = await runErgonomicProfileCliOutcome(installation_, arguments_)
  assert(outcome.exitCode === 0, `Ergonomic Profile CLI failed (${outcome.exitCode})`)
  assert(outcome.stderr === '', 'Ergonomic Profile CLI emitted diagnostics on success')
  return outcome.response
}

async function runErgonomicProfileCliOutcome(installation_, arguments_) {
  const executable = process.platform === 'darwin'
    ? path.join(installation_.root, 'Contents', 'Resources', 'bin', 'eido')
    : path.join(installation_.root, 'resources', 'bin', 'eido.exe')
  const result = await runCommand(executable, arguments_, { timeout: timeoutMs })
  assert(result.stdoutBytes[0] === 0x7b, 'Ergonomic Profile CLI stdout did not begin with JSON')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(result.stdoutBytes)
  assert(text.endsWith('\n') && !text.includes('\n\n'), 'Ergonomic Profile CLI framing is invalid')
  return Object.freeze({
    response: JSON.parse(text),
    exitCode: result.code,
    stderr: result.stderr,
  })
}

async function runInstalledEidoPathCommand(context_, installation_, arguments_) {
  const executable = process.platform === 'darwin'
    ? path.join(installation_.root, 'Contents', 'Resources', 'bin', 'eido')
    : path.join(installation_.root, 'resources', 'bin', 'eido.exe')
  const workingDirectory = await mkdtemp(path.join(context_.runnerTemp, 'eido-path-cwd-'))
  let commandRegistration
  try {
    const environment = cleanElectronEnvironment(process.env)
    commandRegistration = await installedEidoCommandSearchPath(
      context_,
      installation_,
      executable,
    )
    const inheritedPath = Object.entries(environment)
      .find(([key]) => key.toUpperCase() === 'PATH')?.[1] ?? ''
    for (const key of Object.keys(environment)) {
      if (key.toUpperCase() === 'PATH') delete environment[key]
    }
    if (process.platform === 'win32') {
      environment.PATH = commandRegistration.searchPath
      const resolved = await runCommand('where.exe', ['eido'], {
        cwd: workingDirectory,
        env: environment,
        timeout: timeoutMs,
      })
      assert(resolved.code === 0, `Installed eido PATH resolution failed (${resolved.code})`)
      const firstResolution = resolved.stdout.split(/\r?\n/u).find(Boolean)
      assert(
        canonicalWindowsPath(firstResolution) === canonicalWindowsPath(executable),
        'Installed eido command name resolved to a different executable',
      )
    } else {
      assert(
        inheritedPath.split(path.delimiter).some((entry) => path.resolve(entry)
          === commandRegistration.commandDirectory),
        'Installed macOS PATH proof requires /usr/local/bin on the fresh shell PATH',
      )
      environment.PATH = inheritedPath
      assert(
        await realpath(path.join(commandRegistration.commandDirectory, 'eido'))
          === await realpath(executable),
        'Installed eido command name resolved to a different executable',
      )
    }
    const result = await runCommand('eido', arguments_, {
      cwd: workingDirectory,
      env: environment,
      timeout: timeoutMs,
    })
    assert(result.code === 0, `Installed eido PATH command failed (${result.code})`)
    assert(result.stderr === '', 'Installed eido PATH command emitted diagnostics on success')
    assert(result.stdoutBytes[0] === 0x7b, 'Installed eido PATH command stdout did not begin with JSON')
    const text = new TextDecoder('utf-8', { fatal: true }).decode(result.stdoutBytes)
    assert(text.endsWith('\n') && !text.includes('\n\n'), 'Installed eido PATH command framing is invalid')
    return JSON.parse(text)
  } finally {
    try {
      await commandRegistration?.cleanup()
    } finally {
      await rm(workingDirectory, { recursive: true, force: true })
    }
  }
}

async function installedEidoCommandSearchPath(context_, installation_, executable) {
  const executableDirectory = path.dirname(executable)
  if (process.platform === 'darwin') {
    assert(
      context_.githubActions === 'true'
        && context_.ci === 'true'
        && context_.osUserScope === 'github-hosted',
      'Installed macOS PATH proof refuses a non-ephemeral OS user',
    )
    const command = MAC_EIDO_COMMAND
    const commandDirectory = path.dirname(command)
    assert(await pathEntryIsAbsent(command), 'Installed macOS PATH target is already occupied')
    const source = await realpath(executable)
    const launcher = renderMacEidoCommandLauncher(source)
    let owned = false
    try {
      await runChecked('/usr/bin/sudo', [
        '/bin/sh', '-c', MAC_EIDO_COMMAND_INSTALL_SCRIPT, 'eido-install', command, source, launcher,
      ], {
        timeout: timeoutMs,
      })
      owned = true
      assert(
        (await lstat(command)).isFile() && (await readFile(command, 'utf8')) === launcher,
        'Installed macOS PATH launcher did not target the installed package',
      )
      return {
        commandDirectory,
        searchPath: undefined,
        cleanup: () => removeOwnedMacPathCanary(command, launcher),
      }
    } catch (error) {
      if (owned) await removeOwnedMacPathCanary(command, launcher)
      throw error
    }
  }
  const registration = await readWindowsPathRegistration()
  assert(
    canonicalWindowsPath(registration.owner) === canonicalWindowsPath(executableDirectory),
    'Windows installer did not own the installed eido PATH entry',
  )
  assert(
    windowsPathContains(registration.path, executableDirectory),
    'Windows installer did not add the eido command directory to user PATH',
  )
  assert(
    path.win32.normalize(installation_.root).toLowerCase()
      === path.win32.normalize(path.resolve(executableDirectory, '..', '..')).toLowerCase(),
    'Windows eido PATH entry escaped the installed package',
  )
  return {
    commandDirectory: executableDirectory,
    searchPath: [registration.machinePath, registration.path].filter(Boolean).join(path.delimiter),
    cleanup: async () => undefined,
  }
}

async function pathEntryIsAbsent(candidate) {
  try {
    await lstat(candidate)
    return false
  } catch (error) {
    if (error?.code === 'ENOENT') return true
    throw error
  }
}

async function removeOwnedMacPathCanary(command, launcher) {
  const result = await runCommand('/usr/bin/sudo', [
    '/bin/sh',
    '-c',
    REMOVE_MAC_EIDO_COMMAND_CANARY,
    'eido-path-cleanup',
    command,
    launcher,
  ], { timeout: timeoutMs })
  assert(
    result.code === 0,
    `Installed macOS PATH canary changed before cleanup and was left untouched: ${result.stderr}`,
  )
  assert(await pathEntryIsAbsent(command), 'Installed macOS PATH canary cleanup failed')
}

function windowsEidoCommandDirectory(installation_) {
  return path.join(installation_.root, 'resources', 'bin')
}

function canonicalWindowsPath(candidate) {
  if (typeof candidate !== 'string' || candidate.trim() === '') return undefined
  const unquoted = candidate.trim().replace(/^"(.*)"$/u, '$1')
  return path.win32.normalize(unquoted).replace(/[\\/]+$/u, '').toLowerCase()
}

function windowsPathContains(userPath, candidate) {
  const expected = canonicalWindowsPath(candidate)
  return typeof userPath === 'string'
    && userPath.split(';').some((entry) => canonicalWindowsPath(entry) === expected)
}

async function readWindowsPathRegistration() {
  const script = `
$ErrorActionPreference = 'Stop'
$userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
$machinePath = [Environment]::GetEnvironmentVariable('Path', 'Machine')
$owner = $null
$key = Get-ItemProperty -LiteralPath 'HKCU:\\Software\\Eido' -ErrorAction SilentlyContinue
if ($null -ne $key) { $owner = $key.CliPathEntryOwner }
[Console]::Out.Write((@{ path = $userPath; machinePath = $machinePath; owner = $owner } | ConvertTo-Json -Compress))
`
  const result = await runChecked('powershell.exe', [
    '-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
    '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64'),
  ], { timeout: timeoutMs })
  const registration = JSON.parse(result.stdout)
  assert(
    typeof registration.path === 'string'
      && typeof registration.machinePath === 'string'
      && (registration.owner === null || typeof registration.owner === 'string'),
    'Windows eido PATH registration evidence is invalid',
  )
  return registration
}

async function assertWindowsPathRegistration(installation_, expectation) {
  const commandDirectory = windowsEidoCommandDirectory(installation_)
  const matches = (registration) => {
    const ownerMatches = expectation.owner === 'present'
      ? canonicalWindowsPath(registration.owner) === canonicalWindowsPath(commandDirectory)
      : registration.owner === null || registration.owner.trim() === ''
    const pathEntryPresent = windowsPathContains(registration.path, commandDirectory)
    return ownerMatches
      && pathEntryPresent === (expectation.pathEntry === 'present')
  }
  assert(
    await waitFor(async () => matches(await readWindowsPathRegistration()), 30_000),
    `Windows ${expectation.label} evidence did not converge`,
  )
}

async function writeWindowsUserPath(userPath) {
  await runChecked('reg.exe', [
    'ADD', 'HKCU\\Environment',
    '/v', 'Path',
    '/t', 'REG_EXPAND_SZ',
    '/d', userPath,
    '/f',
  ], { timeout: timeoutMs })
}

async function seedUnownedWindowsPathEntry(commandDirectory) {
  const registration = await readWindowsPathRegistration()
  assert(
    registration.owner === null || registration.owner.trim() === '',
    'Certification PATH seed owner already exists',
  )
  assert(
    !windowsPathContains(registration.path, commandDirectory),
    'Certification PATH seed already exists',
  )
  const next = registration.path === ''
    ? commandDirectory
    : `${registration.path};${commandDirectory}`
  await writeWindowsUserPath(next)
  await assertWindowsPathRegistration({ root: path.resolve(commandDirectory, '..', '..') }, {
    owner: 'absent',
    pathEntry: 'present',
    label: 'pre-existing unowned PATH seed',
  })
}

async function removeSeededWindowsPathEntry(commandDirectory) {
  const registration = await readWindowsPathRegistration()
  const next = registration.path
    .split(';')
    .filter((entry) => entry !== '' && canonicalWindowsPath(entry) !== canonicalWindowsPath(commandDirectory))
    .join(';')
  await writeWindowsUserPath(next)
  const cleaned = await readWindowsPathRegistration()
  assert(!windowsPathContains(cleaned.path, commandDirectory), 'Certification PATH seed cleanup failed')
}

async function runProfileMcp(installation_, request) {
  const entry = process.platform === 'win32'
    ? path.join(installation_.root, 'eido-profile-mcp.exe')
    : installation_.executable
  const arguments_ = ['--eido-profile-mcp']
  const input = [
    {
      jsonrpc: '2.0', id: 1, method: 'initialize', params: {
        protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'eido-certification', version: '1.0.0' },
      },
    },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'command.batch', arguments: request } },
    {
      jsonrpc: '2.0',
      id: 4,
      method: 'tools/call',
      params: {
        name: 'run.submit',
        arguments: { ideaId: 'certification-no-mcp-idea', targetCardId: 'certification-no-mcp-card' },
      },
    },
    {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'run.status', arguments: { runId: 'certification-no-mcp-run' } },
    },
    {
      jsonrpc: '2.0', id: 6, method: 'tools/call',
      params: { name: 'run.read', arguments: { runId: 'certification-no-mcp-run' } },
    },
  ].map((value) => `${JSON.stringify(value)}\n`).join('')
  const result = await runCommand(entry, arguments_, { input, timeout: timeoutMs })
  assert(
    result.code === 0 && result.stderr === '',
    `Packaged MCP session failed (code ${result.code}): ${JSON.stringify((result.stderr || result.stdout).slice(-1500))}`,
  )
  assert(result.stdoutBytes[0] === 0x7b, 'Packaged MCP stdout did not begin at byte zero')
  const text = new TextDecoder('utf-8', { fatal: true }).decode(result.stdoutBytes)
  assert(text.endsWith('\n') && !text.includes('\n\n'), 'Packaged MCP framing is invalid')
  const messages = text.trimEnd().split('\n').map((line) => JSON.parse(line))
  const byId = new Map(messages.map((message) => [message.id, message]))
  assert(canonicalJson(byId.get(1)?.result?.capabilities) === canonicalJson({ tools: {} }), 'MCP capabilities are not tools-only')
  assert(canonicalJson(byId.get(2)?.result?.tools?.map(({ name }) => name)) === canonicalJson(profileTools), 'MCP tool inventory changed')
  for (const id of [4, 5, 6]) {
    assert(
      byId.get(id)?.error?.code === -32602 && byId.get(id)?.result === undefined,
      `MCP did not reject CLI-only Agent run operation request ${id}`,
    )
  }
  const response = byId.get(3)?.result?.structuredContent
  assert(
    response?.ok === true,
    `MCP command batch failed: ${JSON.stringify(response ?? byId.get(3) ?? null)?.slice(0, 1500)}`,
  )
  assert(response.result?.version === 5 && response.result?.replayed === false, 'MCP did not emit a fresh receipt v5')
  assert(
    Number.isFinite(response.result?.commandResults?.[0]?.position?.x)
      && Number.isFinite(response.result?.commandResults?.[0]?.position?.y),
    'MCP surface-v5 Card creation did not return its chosen position',
  )
  return {
    byteZeroJson: true,
    tools: profileTools,
    agentRunsRejected: agentRunOperations,
    command: request.commands[0].name,
    receipt: response.result,
    responseAfterUtilityJoin: true,
  }
}

function assertProfileStatus(response) {
  return assertProfileStatusResult(assertGatewaySuccess(response))
}

function assertProfileStatusResult(result) {
  assert(result.state === 'ready' && result.owner?.route === 'exclusive-headless-owner', 'Profile status did not use the installed headless owner')
  assert(canonicalJson(result.versions) === canonicalJson(CERTIFICATION_CONTRACT_VERSIONS.profile), 'Installed Profile contract versions changed')
  return result
}

function assertProfileCapabilities(response) {
  const result = assertGatewaySuccess(response)
  assert(result.adapter === 'sqlite', 'Installed capabilities did not report SQLite')
  assert(result.commandBatch?.version === 5, 'Installed command surface is not v5')
  assert(canonicalJson(result.commands) === canonicalJson(CERTIFICATION_CONTRACT_VERSIONS.commandSurface.installedCommands), 'Raw installed command surface is not exact-22')
  assert(canonicalJson(result.versions) === canonicalJson(CERTIFICATION_INSTALLED_GATEWAY_VERSIONS),
    'Installed Gateway contract versions changed')
  return result
}

function assertAgentCapabilities(response) {
  const result = assertErgonomicGatewaySuccess(response, 'headless')
  assert(result.version === 1 && result.commandSurfaceVersion === 5, 'Agent capability discovery is not surface v5')
  assert(canonicalJson(Object.keys(result.classes ?? {}).sort()) === canonicalJson([
    'enabled', 'humanOnly', 'prohibited', 'systemOnly',
  ]), 'Agent capability discovery classes changed')
  const enabled = result.classes.enabled?.capabilities?.map(({ name }) => name)
  assert(Array.isArray(enabled), 'Agent enabled capability discovery is missing')
  for (const capability of requiredAgentEnabledCapabilities) {
    assert(enabled.includes(capability), `Agent capability discovery omitted ${capability}`)
  }
  const discoverableCommands = enabled.filter((name) => agentDiscoverableCommands.includes(name))
  assert(
    canonicalJson(discoverableCommands) === canonicalJson(CERTIFICATION_CONTRACT_VERSIONS.commandSurface.agentDiscoverableCommands),
    'Agent command-batch discovery is not exact-15',
  )
  const delegatedRuns = result.classes.enabled.capabilities.find(({ name }) => name === 'run.delegation')
  assert(
    canonicalJson(delegatedRuns?.details?.operations) === canonicalJson(agentRunOperations)
      && delegatedRuns?.version === 2
      && delegatedRuns?.details?.availability === 'live-app'
      && canonicalJson(delegatedRuns?.details?.targets) === canonicalJson(['askAi', 'conversation'])
      && canonicalJson(delegatedRuns?.details?.variations) === canonicalJson({ min: 1, max: 8 })
      && delegatedRuns?.details?.artifacts === 'bounded-references-only',
    'Agent run discovery did not retain its live-only bounded-reference contract',
  )
  return result
}

function assertAgentRunOperationDescriptions(descriptions) {
  assert(descriptions.length === agentRunOperations.length, 'Agent run operation discovery is incomplete')
  for (let index = 0; index < agentRunOperations.length; index += 1) {
    const operation = descriptions[index]
    const name = agentRunOperations[index]
    assert(
      operation?.name === name
        && operation.version === 1
        && operation.availability === 'live-app'
        && canonicalJson(operation.adapters) === canonicalJson(['cli'])
        && operation.agentCliDiscoverable === true
        && operation.mutating === (name === 'run.submit'),
      `Agent run operation discovery changed for ${name}`,
    )
  }
}

function assertAppClosedAgentRunRejection(outcome) {
  const response = outcome.response
  assert(outcome.exitCode === 4, 'App-closed Agent run rejection changed exit category')
  assert(outcome.stderr === 'Eido Profile inspection failed (busy).\n', 'App-closed Agent run diagnostic changed')
  assert(
    response?.ok === false
      && response.error?.code === 'busy'
      && response.error?.reason === 'live-app-required'
      && response.error?.retryable === true
      && response.cli?.version === 1
      && response.cli?.servedBy === 'live'
      && response.cli?.live?.state === 'absent'
      && response.cli?.live?.admission === 'none'
      && response.cli?.live?.fallback === 'forbidden',
    'App-closed Agent run did not fail before headless fallback as a retryable live-app requirement',
  )
}

function assertErgonomicGatewaySuccess(response, servedBy) {
  assert(
    response?.cli?.version === 1 && response.cli.servedBy === servedBy,
    `Ergonomic Profile CLI did not report the ${servedBy} route`,
  )
  if (servedBy === 'live') {
    assert(response.cli.live?.state === 'served', 'Live ergonomic Profile CLI did not report served admission')
  }
  return assertGatewaySuccess(response)
}

function assertGatewaySuccess(response) {
  assert(response?.ok === true, `Gateway request failed: ${response?.error?.code ?? 'invalid-response'}`)
  return response.result
}

function gatewayRequest(requestId, operation, params) {
  return { version: 1, requestId, operation, params }
}

async function installedTreeInventory(root) {
  const entries = []
  await walk(root, '')
  entries.sort((left, right) => left.path.localeCompare(right.path, 'en'))
  const digest = createHash('sha256')
  for (const entry of entries) digest.update(`${canonicalJson(entry)}\n`, 'utf8')
  return { sha256: digest.digest('hex'), entries }

  async function walk(current, relative) {
    const children = await readdir(current, { withFileTypes: true })
    children.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const child of children) {
      const absolute = path.join(current, child.name)
      const childRelative = relative ? `${relative}/${child.name}` : child.name
      const metadata = await lstat(absolute)
      if (metadata.isSymbolicLink()) {
        const target = await readlink(absolute)
        assertContainedInstalledSymlink(root, absolute, target)
        entries.push({ path: childRelative, type: 'symlink', target })
      } else if (metadata.isDirectory()) {
        entries.push({ path: childRelative, type: 'directory' })
        await walk(absolute, childRelative)
      } else if (metadata.isFile()) {
        entries.push({
          path: childRelative,
          type: 'file',
          bytes: metadata.size,
          sha256: await sha256File(absolute),
        })
      } else {
        throw new Error(`Installed inventory contains unsupported entry: ${childRelative}`)
      }
    }
  }
}

async function fileIdentity(location) {
  const metadata = await stat(location)
  assert(metadata.isFile() && metadata.size > 0, 'Sealed artifact is not a nonempty file')
  return { fileName: path.basename(location), bytes: metadata.size, sha256: await sha256File(location) }
}

async function updateArchiveIdentity(location) {
  const identity = await fileIdentity(location)
  return { ...identity, sha512: await sha512File(location) }
}

function sha256File(location) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha256')
    const input = createReadStream(location)
    input.on('data', (chunk) => digest.update(chunk))
    input.on('error', reject)
    input.on('end', () => resolve(digest.digest('hex')))
  })
}

function sha512File(location) {
  return new Promise((resolve, reject) => {
    const digest = createHash('sha512')
    const input = createReadStream(location)
    input.on('data', (chunk) => digest.update(chunk))
    input.on('error', reject)
    input.on('end', () => resolve(digest.digest('base64')))
  })
}

function sha256Bytes(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

/**
 * Verify the sealed DMG that will actually be published: our Developer ID
 * signature, a valid notarization staple, and Gatekeeper's own acceptance.
 * Every one of these is a release-blocking condition. An artifact that fails
 * here fails the release rather than reaching a person.
 */
async function verifyDmg(artifact_, context_) {
  await runChecked('/usr/bin/hdiutil', ['verify', artifact_], { timeout: 60_000 })
  await runChecked('/usr/bin/codesign', ['--verify', '--strict', '--verbose=4', artifact_], { timeout: 60_000 })
  const signature = await runChecked(
    '/usr/bin/codesign',
    ['--display', '--verbose=4', artifact_],
    { timeout: 60_000 },
  )
  const posture = parseSignedMacDiskImagePosture(
    `${signature.stdout}\n${signature.stderr}`,
    {
      expectedAuthority: context_.signingIdentity.expectedAuthority,
      expectedTeamId: context_.signingIdentity.expectedTeamId,
      expectedIdentifier: productionDmgIdentifier(),
    },
  )
  // The staple is what lets a first open succeed without a network round trip
  // to Apple. Without it an offline first launch is a warning, not an app.
  await runChecked('/usr/bin/xcrun', ['stapler', 'validate', artifact_], { timeout: 60_000 })
  const gatekeeper = await assessGatekeeper([
    '--assess',
    '--type', 'open',
    '--context', 'context:primary-signature',
    '--verbose=4',
    artifact_,
  ])
  return { ...posture, notarization: 'stapled', gatekeeper }
}

async function assessGatekeeper(args) {
  const assessment = await runChecked('/usr/sbin/spctl', args, { timeout: 60_000 })
  return assertNotarizedGatekeeperAcceptance(`${assessment.stdout}\n${assessment.stderr}`)
}

async function removeOwnedProfileRoot(candidate, context_) {
  const expected = await requireEphemeralProductProfileRoot(context_)
  assert(candidate === expected && path.basename(candidate) === 'Eido', 'Refusing to remove an unowned Profile root')
  await rm(candidate, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
}

async function detachAllOwnedMounts(root) {
  if (process.platform !== 'darwin') return
  const entries = await readdir(root, { withFileTypes: true })
  for (const entry of entries) {
    const mount = path.join(root, entry.name, 'mounted-dmg')
    if (existsSync(mount)) spawnSync('/usr/bin/hdiutil', ['detach', '-force', mount], { timeout: 60_000 })
  }
}

function cleanElectronEnvironment(source) {
  const environment = { ...source }
  delete environment.ELECTRON_RUN_AS_NODE
  delete environment.NODE_OPTIONS
  return environment
}

function runChecked(command, args, options = {}) {
  return runCommand(command, args, options).then((result) => {
    assert(result.code === 0, `${path.basename(command)} failed: ${result.stderr || result.stdout}`)
    return result
  })
}

function runCommand(command, args, {
  input,
  timeout = 30_000,
  env = cleanElectronEnvironment(process.env),
  cwd = repositoryRoot,
} = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env,
      windowsHide: true,
    })
    const stdout = []
    const stderr = []
    let settled = false
    const timer = setTimeout(() => fail(new Error(`${path.basename(command)} timed out`)), timeout)
    child.stdout.on('data', (chunk) => stdout.push(Buffer.from(chunk)))
    child.stderr.on('data', (chunk) => stderr.push(Buffer.from(chunk)))
    child.once('error', fail)
    child.once('close', (code, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      const stdoutBytes = Buffer.concat(stdout)
      resolve({
        code,
        signal,
        stdoutBytes,
        stdout: stdoutBytes.toString('utf8'),
        stderr: Buffer.concat(stderr).toString('utf8'),
      })
    })
    child.stdin.end(input)

    function fail(error) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      terminateChild(child)
      reject(error)
    }
  })
}

function terminateChild(child) {
  if (process.platform === 'win32' && child.pid) {
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true })
  } else if (child.pid) {
    child.kill('SIGKILL')
  }
}

async function waitFor(predicate, duration) {
  const deadline = Date.now() + duration
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return false
}

async function withTimeout(promise, duration, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${label} timed out`)), duration) }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function readJson(location, description) {
  assert(typeof location === 'string' && path.isAbsolute(location), `${description} path must be absolute`)
  try {
    return JSON.parse(await readFile(location, 'utf8'))
  } catch (error) {
    throw new Error(`${description} could not be read: ${error.message}`)
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

// Progress breadcrumb on stderr (stdout carries only the final JSON result).
// Hosted certification is debugged exclusively from its log, so every stage
// must be visible even when a later stage hangs or the job is cancelled.
function stage(label) {
  process.stderr.write(`EIDO_CERTIFY_STAGE ${new Date().toISOString()} ${label}\n`)
}
