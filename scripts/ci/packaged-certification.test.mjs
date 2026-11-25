import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, lstatSync, readFileSync, realpathSync, readdirSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { pathToFileURL } from 'node:url'

import {
  CERTIFICATION_CONTRACT_VERSIONS,
  CERTIFICATION_PACKAGE_IDENTITY,
  CERTIFICATION_PROFILE_RUNTIME_PATHS,
  CERTIFICATION_PROOF_REVALIDATIONS,
  CERTIFICATION_REUSED_PROOF,
  CERTIFICATION_V1_CONTRACT_VERSIONS,
  CERTIFICATION_V1_RETAINED_SETS,
  NATIVE_DESKTOP_PROOF_GATE_JOBS,
  buildCertificationSet,
  certificationInvalidations,
  computeProfileRuntimeFingerprint,
  createCertificationEvidenceReference,
  isProfileRuntimePath,
  latestCertificationProofRevalidation,
  validateCertificationSet,
  validateCurrentCertificationProofReuse,
  validatePlatformEvidence,
} from '../certification/certification-manifest.mjs'
import { resolveProofRevalidation } from '../certification/proof-revalidation.mjs'
import {
  assertArm64MacDeploymentEvidence,
  assertMacDeploymentTargetAtOrBelow,
  assertInstalledRuntimeInventory,
  assertLeanArtifactInventory,
  assertContainedInstalledSymlink,
  enumerateInstalledMachOBinaries,
  isMachOBinaryHeader,
  assertNotarizedGatekeeperAcceptance,
  parseDeveloperIdSigningPosture,
  parseSignedMacDiskImagePosture,
  parseWindowsAuthenticode,
} from '../certification/platform-evidence.mjs'
import {
  createProductionPackagingConfig,
  notarizeAndStapleProductionApp,
  signProductionDmg,
} from '../../release/packaged/production-builder.mjs'
import {
  MACOS_NOTARIZATION_WAIT_MINUTES,
  MACOS_MEASURED_NOTARIZATION_LATENCY_MINUTES,
  MACOS_RELEASE_CREDENTIAL_DIRECTORY,
  MACOS_RELEASE_JOB_TIMEOUT_MINUTES,
} from '../release-signing/macos-release.mjs'
import addProfileMcpSeaEntry from '../electron/profile-mcp-sea-after-pack.mjs'
import { createCertificationPreparation } from '../certification/prepare-certification.mjs'
import { createStagedPackageManifest } from '../certification/stage-package-input.mjs'
import { createPackagingOptions } from '../certification/package-certification.mjs'
import {
  assertProofReuseMatchesSourceTree,
  verifyPlatformPacketFiles,
} from '../certification/finalize-certification.mjs'

const repositoryRoot = path.resolve(import.meta.dirname, '..', '..')
const certificationPackageManifest = JSON.parse(readFileSync(
  new URL('../../package.json', import.meta.url),
  'utf8',
))
const certificationRuntime = { nodeVersion: '24.12.0', npmVersion: '11.6.2' }
const require = createRequire(import.meta.url)
const { getNodeModuleFileMatcher } = require('app-builder-lib/out/fileMatcher.js')

import {
  certificationSetId,
  digest,
  expectedAuthority,
  expectedTeamId,
  platformEvidence,
  provedTreeSha256,
  resolvedProofRevalidation,
  sourceSha,
} from './fixtures/certification-evidence.mjs'

function validSet() {
  return buildCertificationSet({
    intent: {
      schemaVersion: 1,
      certificationSetId,
      sourceSha,
      semver: '1.2.3-alpha.1',
      promotable: true,
      packageIdentity: CERTIFICATION_PACKAGE_IDENTITY,
    },
    platformEvidence: [platformEvidence('darwin'), platformEvidence('win32')],
  })
}

function v1Journey() {
  return {
    guiEditRestart: true,
    offlineRelaunch: true,
    cliBound: true,
    mcpBound: true,
    uninstall: true,
    reinstall: true,
    firstReleaseMigration: 'not-applicable',
  }
}

function retainedV1PlatformEvidence(platform) {
  const retained = CERTIFICATION_V1_RETAINED_SETS[0]
  const packet = structuredClone(platformEvidence(platform))
  packet.schemaVersion = 1
  packet.certificationSetId = retained.certificationSetId
  packet.sourceSha = retained.sourceSha
  packet.semver = retained.semver
  delete packet.artifactSigningPosture
  delete packet.nestedSigningPostures
  delete packet.updateArtifact
  // Schema-version-1 sets predate production signing (#696): 0.1.1 and 0.1.2
  // shipped ad-hoc signed and are retained exactly as they were.
  if (platform === 'darwin') {
    packet.signingPosture = {
      status: 'ad-hoc',
      cdHash: '0123456789abcdef0123456789abcdef01234567',
      teamIdentifier: null,
      authorities: [],
      hardenedRuntime: 'not-applicable',
    }
  }
  packet.installedPackageIdentity.semver = retained.semver
  // Schema-version-1 packets predate live proof revalidation: they carry the
  // policy-1 shape and cite a historical CERTIFICATION_PROOF_REVALIDATIONS
  // entry, and must keep resolving exactly as sealed.
  packet.proofReuse.schemaVersion = 1
  packet.proofReuse.policyVersion = 1
  delete packet.proofReuse.evidence
  packet.proofReuse.pathSet = retained.proofRevalidation.pathSet
  packet.proofReuse.revalidatedSourceSha = retained.proofRevalidation.revalidatedSourceSha
  packet.proofReuse.checkedSourceSha = retained.sourceSha
  packet.proofReuse.treeSha256 = retained.proofRevalidation.treeSha256
  packet.listenerEvidence.installedAgentTransport = 'stdio-only'
  packet.contractVersions = CERTIFICATION_V1_CONTRACT_VERSIONS
  packet.installedJourney = v1Journey()
  packet.evidenceSha256 = retained.evidenceDigests[`${packet.platform}-${packet.arch}`]
  return packet
}

function syntheticV1Set() {
  const retained = CERTIFICATION_V1_RETAINED_SETS[0]
  const platforms = [
    retainedV1PlatformEvidence('darwin'),
    retainedV1PlatformEvidence('win32'),
  ]
  return {
    schemaVersion: 1,
    certificationSetId: retained.certificationSetId,
    sourceSha: retained.sourceSha,
    semver: retained.semver,
    promotable: true,
    packageIdentity: CERTIFICATION_PACKAGE_IDENTITY,
    platforms,
    contractVersions: CERTIFICATION_V1_CONTRACT_VERSIONS,
    evidenceDigests: retained.evidenceDigests,
    negativeInventory: platforms[0].negativeInventory,
    reusedProofReferences: platforms.flatMap(({ reusedProofReferences }) => reusedProofReferences),
    durability: {
      posixDirectoryEntries: 'flushed-before-sqlite-acknowledgement',
      windowsNamespace: 'best-effort-after-file-flush-rename-reopen-rehash',
    },
  }
}

test('paired certification admission binds both production artifacts and every contract axis', () => {
  const certification = validateCertificationSet(validSet())

  assert.equal(certification.schemaVersion, 2)
  assert.deepEqual(certification.platforms.map(({ schemaVersion }) => schemaVersion), [2, 2])
  assert.equal(certification.certificationSetId, certificationSetId)
  assert.deepEqual(certification.platforms.map(({ platform, arch, target }) => ({ platform, arch, target })), [
    { platform: 'darwin', arch: 'arm64', target: 'dmg' },
    { platform: 'win32', arch: 'x64', target: 'nsis' },
  ])
  assert.deepEqual(certification.contractVersions, CERTIFICATION_CONTRACT_VERSIONS)
  assert.deepEqual(certification.durability, {
    posixDirectoryEntries: 'flushed-before-sqlite-acknowledgement',
    windowsNamespace: 'best-effort-after-file-flush-rename-reopen-rehash',
  })
})

test('surface-v5 certification pins current raw and Agent inventories while retaining historical reads', () => {
  assert.equal(CERTIFICATION_CONTRACT_VERSIONS.commandSurface.installedVersion, 5)
  assert.deepEqual(CERTIFICATION_CONTRACT_VERSIONS.commandSurface.installedCommands, [
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
  ])
  assert.deepEqual(CERTIFICATION_CONTRACT_VERSIONS.commandSurface.agentDiscoverableCommands, [
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
  ])
  assert.deepEqual(CERTIFICATION_CONTRACT_VERSIONS.commandSurface.historicalVersions, [1, 2, 3, 4])
  assert.deepEqual(CERTIFICATION_CONTRACT_VERSIONS.receipt, {
    emittedVersion: 5,
    readableVersions: [1, 2, 3, 4, 5],
  })
  assert.deepEqual(CERTIFICATION_CONTRACT_VERSIONS.agent.run, {
    version: 2,
    operations: ['run.submit', 'run.status', 'run.read'],
    availability: 'live-app',
    adapters: ['cli'],
  })
  assert.equal(CERTIFICATION_CONTRACT_VERSIONS.gateway.tools, 7)
})

test('admission fails closed for zero or proof identity, non-promotability, posture drift, and contract drift', () => {
  const cases = [
    { name: 'zero version', mutate: (value) => { value.semver = '0.0.0' }, message: /non-0\.0\.0 SemVer/ },
    { name: 'proof identity', mutate: (value) => { value.packageIdentity.appId = 'dev.eido.shell-proof' }, message: /production package identity/ },
    { name: 'not promotable', mutate: (value) => { value.promotable = false }, message: /promotable/ },
    { name: 'missing mac posture', mutate: (value) => { delete value.platforms[0].signingPosture.cdHash }, message: /hardened runtime and a secure timestamp/ },
    { name: 'unsigned installed mac app', mutate: (value) => { value.platforms[0].signingPosture = { status: 'ad-hoc', cdHash: digest('a').slice(0, 40), teamIdentifier: null, authorities: [], hardenedRuntime: 'not-applicable' } }, message: /Developer ID Application authority/ },
    { name: 'mac app without the hardened runtime', mutate: (value) => { value.platforms[0].signingPosture.hardenedRuntime = 'not-applicable' }, message: /hardened runtime and a secure timestamp/ },
    { name: 'mac app without a secure timestamp', mutate: (value) => { value.platforms[0].signingPosture.secureTimestamp = false }, message: /hardened runtime and a secure timestamp/ },
    { name: 'mac Team ID that does not match its authority', mutate: (value) => { value.platforms[0].signingPosture.teamIdentifier = 'Z9Y8X7W6V5' }, message: /Developer ID Application authority/ },
    { name: 'missing sealed artifact posture', mutate: (value) => { delete value.platforms[0].artifactSigningPosture }, message: /sealed artifact signing posture/ },
    { name: 'unsigned sealed dmg', mutate: (value) => { value.platforms[0].artifactSigningPosture = { status: 'NotSigned', format: 'dmg', diagnostic: 'code-object-is-not-signed-at-all' } }, message: /Developer ID Application authority on the sealed DMG/ },
    { name: 'unnotarized sealed dmg', mutate: (value) => { value.platforms[0].artifactSigningPosture.notarization = 'absent' }, message: /notarized, stapled, Gatekeeper-accepted/ },
    { name: 'gatekeeper-rejected sealed dmg', mutate: (value) => { value.platforms[0].artifactSigningPosture.gatekeeper = 'rejected' }, message: /notarized, stapled, Gatekeeper-accepted/ },
    { name: 'sealed dmg signed under a foreign identifier', mutate: (value) => { value.platforms[0].artifactSigningPosture.identifier = 'com.example.dmg' }, message: /notarized, stapled, Gatekeeper-accepted/ },
    { name: 'missing nested posture', mutate: (value) => { delete value.platforms[0].nestedSigningPostures }, message: /Nested executable signing postures/ },
    { name: 'missing mac updater archive', mutate: (value) => { delete value.platforms[0].updateArtifact }, message: /requires an update archive/ },
    { name: 'signed nested Windows executable', mutate: (value) => { value.platforms[1].nestedSigningPostures[0].signingPosture.status = 'Valid' }, message: /NotSigned posture/ },
    { name: 'unsigned nested mac executable', mutate: (value) => { value.platforms[0].nestedSigningPostures[0].signingPosture.hardenedRuntime = 'not-applicable' }, message: /hardened runtime and a secure timestamp/ },
    {
      name: 'downgraded platform packet',
      mutate: (value) => { value.platforms[0] = retainedV1PlatformEvidence('darwin') },
      message: /schemaVersion does not match/,
    },
    { name: 'windows signer', mutate: (value) => { value.platforms[1].signingPosture.status = 'Valid' }, message: /NotSigned posture/ },
    { name: 'contract mismatch', mutate: (value) => { value.contractVersions.profile.schema = 2 }, message: /contract versions/ },
    { name: 'missing runner identity', mutate: (value) => { delete value.platforms[0].executionIdentity.imageVersion }, message: /execution identity/ },
    { name: 'missing live Agent journey', mutate: (value) => { delete value.platforms[0].installedJourney.liveCliBound }, message: /liveCliBound/ },
    { name: 'stale reused proof', mutate: (value) => { value.platforms[0].proofReuse.relevantPathsUnchanged = false }, message: /proof reuse/ },
    { name: 'unbound listener claim', mutate: (value) => { value.platforms[0].listenerEvidence.transientDriverClosed = false }, message: /listener evidence/ },
    { name: 'installed identity drift', mutate: (value) => { value.platforms[1].installedPackageIdentity.productName = 'Electron' }, message: /installed package identity/i },
    { name: 'extra set digest', mutate: (value) => { value.evidenceDigests.extra = digest('b') }, message: /digest keys/ },
    { name: 'set proof omission', mutate: (value) => { value.reusedProofReferences = [] }, message: /reusable proof|reused proof references/ },
    { name: 'wrong platform proof tuple', mutate: (value) => { value.platforms[0].reusedProofReferences[0].issue = 526 }, message: /does not match #527/ },
  ]

  for (const scenario of cases) {
    const candidate = structuredClone(validSet())
    scenario.mutate(candidate)
    assert.throws(() => validateCertificationSet(candidate), scenario.message, scenario.name)
  }
})

test('retained schema-version-1 packets resolve historical proof without retaining a release manifest', () => {
  const retained = CERTIFICATION_V1_RETAINED_SETS[0]
  const packets = [
    retainedV1PlatformEvidence('darwin'),
    retainedV1PlatformEvidence('win32'),
  ]
  const historical = CERTIFICATION_PROOF_REVALIDATIONS.find(({ revalidatedSourceSha }) => (
    revalidatedSourceSha === retained.proofRevalidation.revalidatedSourceSha
  ))

  assert(historical)
  assert.notEqual(historical, latestCertificationProofRevalidation())
  assert.match(retained.manifestSha256, /^[0-9a-f]{64}$/)
  assert.match(retained.canonicalSha256, /^[0-9a-f]{64}$/)
  assert.deepEqual(packets.map(validatePlatformEvidence).map(({ schemaVersion }) => schemaVersion), [1, 1])
  assert(packets.every((packet) => !Object.hasOwn(packet, 'artifactSigningPosture')))
  assert(packets.every((packet) => !Object.hasOwn(packet, 'nestedSigningPostures')))
  assert.throws(
    () => validateCertificationSet(syntheticV1Set()),
    /canonical manifest does not match/,
  )
})

test('schema-version identity rejects wholesale v2 relabeling and v2 proof downgrade', () => {
  const relabelled = structuredClone(validSet())
  relabelled.schemaVersion = 1
  relabelled.contractVersions = CERTIFICATION_V1_CONTRACT_VERSIONS
  for (const packet of relabelled.platforms) {
    packet.schemaVersion = 1
    delete packet.artifactSigningPosture
    delete packet.nestedSigningPostures
    delete packet.updateArtifact
    packet.contractVersions = CERTIFICATION_V1_CONTRACT_VERSIONS
    packet.listenerEvidence.installedAgentTransport = 'stdio-only'
    packet.installedJourney = v1Journey()
  }
  assert.throws(
    () => validateCertificationSet(relabelled),
    /certificationSetId does not match schemaVersion 1/,
  )

  // A v2 packet may not quietly re-point itself at a closed historical ledger
  // entry. Its own evidence still names the run and head SHA it was sealed
  // against, so the swap no longer describes a real proof run.
  const downgradedProof = structuredClone(validSet())
  const historical = CERTIFICATION_PROOF_REVALIDATIONS.at(-2)
  assert(historical)
  for (const packet of downgradedProof.platforms) {
    packet.proofReuse.pathSet = historical.pathSet
    packet.proofReuse.revalidatedSourceSha = historical.revalidatedSourceSha
    packet.proofReuse.treeSha256 = historical.treeSha256
  }
  assert.throws(
    () => validateCertificationSet(downgradedProof),
    /does not name a successful Native desktop proof run on main/,
  )

  // Nor may it drop back to the policy-1 shape, which carried no evidence at
  // all and would resolve against the closed ledger.
  const downgradedPolicy = structuredClone(validSet())
  for (const packet of downgradedPolicy.platforms) {
    packet.proofReuse.schemaVersion = 1
    packet.proofReuse.policyVersion = 1
    delete packet.proofReuse.evidence
  }
  assert.throws(
    () => validateCertificationSet(downgradedPolicy),
    /proof reuse compatibility is invalid/,
  )

  // The two legs certify one tree, so they may not cite different runs.
  const splitProof = structuredClone(validSet())
  splitProof.platforms[1].proofReuse.evidence.runId += 1
  splitProof.platforms[1].proofReuse.evidence.runUrl
    = `https://github.com/limweili/eido/actions/runs/${splitProof.platforms[1].proofReuse.evidence.runId}`
  assert.throws(
    () => validateCertificationSet(splitProof),
    /cite different proof-reuse revalidations/,
  )
})

test('schema-version-1 admission is closed to unretained v1 identities and mismatched ledger tuples', () => {
  const unretained = retainedV1PlatformEvidence('darwin')
  unretained.certificationSetId = 'eido-cert-v1-unretained-1'
  assert.throws(
    () => validatePlatformEvidence(unretained),
    /not a retained immutable authority/,
  )

  const mismatchedTuple = retainedV1PlatformEvidence('darwin')
  mismatchedTuple.proofReuse.treeSha256 = latestCertificationProofRevalidation().treeSha256
  assert.throws(
    () => validatePlatformEvidence(mismatchedTuple),
    /proof reuse compatibility is invalid/,
  )

  const mutatedManifest = syntheticV1Set()
  mutatedManifest.platforms[0].artifact.sha256 = digest('f')
  assert.throws(
    () => validateCertificationSet(mutatedManifest),
    /canonical manifest does not match/,
  )
})

test('changed bytes require a new set and invalidate only their platform proof plus paired integrity', () => {
  const previous = validSet()
  const changed = structuredClone(previous)
  changed.platforms[0].artifact.sha256 = digest('8')

  assert.throws(
    () => certificationInvalidations(previous, changed),
    /changed certification inputs must use a new certificationSetId/,
  )

  changed.certificationSetId = 'eido-cert-v2-12346-1'
  for (const platform of changed.platforms) platform.certificationSetId = changed.certificationSetId
  const invalidations = certificationInvalidations(previous, changed)
  assert.deepEqual(invalidations, ['darwin-arm64', 'paired-set'])
  assert(!invalidations.includes('win32-x64'))
})

test('downstream reference is digest-addressed without a self-hash cycle', () => {
  assert.deepEqual(createCertificationEvidenceReference({
    certification: validSet(),
    manifestSha256: digest('9'),
    fileName: 'certification-manifest.json',
  }), {
    schemaVersion: 1,
    kind: 'eido-packaged-certification-set',
    certificationSetId,
    sourceSha,
    semver: '1.2.3-alpha.1',
    manifest: { fileName: 'certification-manifest.json', sha256: `sha256:${digest('9')}` },
  })
})

test('downstream reference digest is lowercase sha256:<64-hex>, matching #675s ledger', () => {
  const reference = createCertificationEvidenceReference({
    certification: validSet(),
    manifestSha256: digest('9'),
    fileName: 'certification-manifest.json',
  })
  assert.match(reference.manifest.sha256, /^sha256:[0-9a-f]{64}$/)
})

test('paired finalization re-hashes downloaded sealed bytes and the native transcript', async (context) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eido-certification-packet-'))
  context.after(() => rm(root, { recursive: true, force: true }))
  const evidenceDirectory = path.join(root, 'evidence')
  const packageDirectory = path.join(root, 'package')
  await Promise.all([mkdir(evidenceDirectory), mkdir(packageDirectory)])
  const artifactBytes = Buffer.from('sealed-dmg-bytes')
  const updateArtifactBytes = Buffer.from('sealed-update-zip-bytes')
  const packet = platformEvidence('darwin', {
    artifact: {
      fileName: 'Eido-1.2.3-alpha.1-arm64.dmg',
      bytes: artifactBytes.length,
      sha256: createHash('sha256').update(artifactBytes).digest('hex'),
    },
    updateArtifact: {
      ...platformEvidence('darwin').updateArtifact,
      bytes: updateArtifactBytes.length,
      sha256: createHash('sha256').update(updateArtifactBytes).digest('hex'),
      sha512: createHash('sha512').update(updateArtifactBytes).digest('base64'),
    },
  })
  const transcript = {
    schemaVersion: packet.schemaVersion,
    ...Object.fromEntries(['certificationSetId', 'sourceSha', 'semver', 'platform', 'arch', 'target']
      .map((key) => [key, packet[key]])),
    artifact: packet.artifact,
    updateArtifact: packet.updateArtifact,
    artifactSigningPosture: packet.artifactSigningPosture,
    installedInventory: {
      sha256: packet.installedInventory.sha256,
      entries: Array.from({ length: packet.installedInventory.entries }, (_, index) => ({ path: String(index) })),
    },
    signingPosture: packet.signingPosture,
    nestedSigningPostures: packet.nestedSigningPostures,
    installedPackageIdentity: packet.installedPackageIdentity,
    executionIdentity: packet.executionIdentity,
    proofReuse: packet.proofReuse,
    reusedProofReferences: packet.reusedProofReferences,
    journey: { transientDriverListenerClosed: true },
  }
  const transcriptBytes = Buffer.from(`${JSON.stringify(transcript, null, 2)}\n`)
  packet.evidenceSha256 = createHash('sha256').update(transcriptBytes).digest('hex')
  const packetPath = path.join(evidenceDirectory, 'platform-evidence.json')
  const artifactPath = path.join(packageDirectory, packet.artifact.fileName)
  const updateArtifactPath = path.join(packageDirectory, packet.updateArtifact.fileName)
  await Promise.all([
    writeFile(artifactPath, artifactBytes),
    writeFile(updateArtifactPath, updateArtifactBytes),
    writeFile(path.join(evidenceDirectory, 'journey-transcript.json'), transcriptBytes),
    writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`),
  ])

  assert.deepEqual(await verifyPlatformPacketFiles(packetPath), packet)
  await rm(updateArtifactPath)
  await assert.rejects(
    () => verifyPlatformPacketFiles(packetPath),
    /ENOENT/,
  )
  await writeFile(updateArtifactPath, updateArtifactBytes)
  const substitutedUpdateArtifactBytes = Buffer.from(updateArtifactBytes)
  substitutedUpdateArtifactBytes[0] ^= 0xff
  await writeFile(updateArtifactPath, substitutedUpdateArtifactBytes)
  await assert.rejects(
    () => verifyPlatformPacketFiles(packetPath),
    /Downloaded macOS update archive does not match/,
  )
  await writeFile(updateArtifactPath, updateArtifactBytes)

  const mismatchedUpdateTranscript = structuredClone(transcript)
  mismatchedUpdateTranscript.updateArtifact.sha512 = Buffer.alloc(64, 8).toString('base64')
  const mismatchedUpdateTranscriptBytes = Buffer.from(`${JSON.stringify(mismatchedUpdateTranscript, null, 2)}\n`)
  packet.evidenceSha256 = createHash('sha256').update(mismatchedUpdateTranscriptBytes).digest('hex')
  await Promise.all([
    writeFile(path.join(evidenceDirectory, 'journey-transcript.json'), mismatchedUpdateTranscriptBytes),
    writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`),
  ])
  await assert.rejects(
    () => verifyPlatformPacketFiles(packetPath),
    /Journey update archive identity does not match/,
  )

  const mismatchedTranscript = structuredClone(transcript)
  mismatchedTranscript.artifactSigningPosture = {
    status: 'Valid',
    format: 'dmg',
    diagnostic: 'signed',
  }
  const mismatchedTranscriptBytes = Buffer.from(`${JSON.stringify(mismatchedTranscript, null, 2)}\n`)
  packet.evidenceSha256 = createHash('sha256').update(mismatchedTranscriptBytes).digest('hex')
  await Promise.all([
    writeFile(path.join(evidenceDirectory, 'journey-transcript.json'), mismatchedTranscriptBytes),
    writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`),
  ])
  await assert.rejects(
    () => verifyPlatformPacketFiles(packetPath),
    /Journey artifactSigningPosture does not match/,
  )

  const mismatchedNestedTranscript = structuredClone(transcript)
  mismatchedNestedTranscript.nestedSigningPostures[0].signingPosture.cdHash = 'f'.repeat(40)
  const mismatchedNestedTranscriptBytes = Buffer.from(`${JSON.stringify(mismatchedNestedTranscript, null, 2)}\n`)
  packet.evidenceSha256 = createHash('sha256').update(mismatchedNestedTranscriptBytes).digest('hex')
  await Promise.all([
    writeFile(path.join(evidenceDirectory, 'journey-transcript.json'), mismatchedNestedTranscriptBytes),
    writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`),
  ])
  await assert.rejects(
    () => verifyPlatformPacketFiles(packetPath),
    /Journey nestedSigningPostures does not match/,
  )

  const downgradedTranscript = structuredClone(transcript)
  downgradedTranscript.schemaVersion = 1
  const downgradedTranscriptBytes = Buffer.from(`${JSON.stringify(downgradedTranscript, null, 2)}\n`)
  packet.evidenceSha256 = createHash('sha256').update(downgradedTranscriptBytes).digest('hex')
  await Promise.all([
    writeFile(path.join(evidenceDirectory, 'journey-transcript.json'), downgradedTranscriptBytes),
    writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`),
  ])
  await assert.rejects(
    () => verifyPlatformPacketFiles(packetPath),
    /Journey transcript schemaVersion does not match/,
  )

  const legacyPacket = structuredClone(packet)
  legacyPacket.schemaVersion = 1
  legacyPacket.certificationSetId = 'eido-cert-v1-finalizer-fixture'
  delete legacyPacket.artifactSigningPosture
  delete legacyPacket.nestedSigningPostures
  delete legacyPacket.updateArtifact
  legacyPacket.contractVersions = CERTIFICATION_V1_CONTRACT_VERSIONS
  // A schema-version-1 packet predates production signing and carries the
  // ad-hoc posture it actually had.
  legacyPacket.signingPosture = {
    status: 'ad-hoc',
    cdHash: '0123456789abcdef0123456789abcdef01234567',
    teamIdentifier: null,
    authorities: [],
    hardenedRuntime: 'not-applicable',
  }
  legacyPacket.listenerEvidence.installedAgentTransport = 'stdio-only'
  legacyPacket.installedJourney = v1Journey()
  // A schema-version-1 packet also carries the policy-1 proof reuse shape,
  // resolved against the closed historical ledger rather than live evidence.
  legacyPacket.proofReuse = {
    schemaVersion: 1,
    policyVersion: 1,
    pathSet: CERTIFICATION_V1_RETAINED_SETS[0].proofRevalidation.pathSet,
    providerSourceSha: CERTIFICATION_REUSED_PROOF.darwin.sourceSha,
    revalidatedSourceSha: CERTIFICATION_V1_RETAINED_SETS[0].proofRevalidation.revalidatedSourceSha,
    checkedSourceSha: legacyPacket.sourceSha,
    treeSha256: CERTIFICATION_V1_RETAINED_SETS[0].proofRevalidation.treeSha256,
    relevantPathsUnchanged: true,
  }
  const legacyTranscript = structuredClone(transcript)
  legacyTranscript.schemaVersion = 1
  legacyTranscript.certificationSetId = legacyPacket.certificationSetId
  legacyTranscript.proofReuse = structuredClone(legacyPacket.proofReuse)
  delete legacyTranscript.artifactSigningPosture
  delete legacyTranscript.nestedSigningPostures
  delete legacyTranscript.updateArtifact
  const legacyTranscriptBytes = Buffer.from(`${JSON.stringify(legacyTranscript, null, 2)}\n`)
  legacyPacket.evidenceSha256 = createHash('sha256').update(legacyTranscriptBytes).digest('hex')
  await Promise.all([
    writeFile(path.join(evidenceDirectory, 'journey-transcript.json'), legacyTranscriptBytes),
    writeFile(packetPath, `${JSON.stringify(legacyPacket, null, 2)}\n`),
  ])
  await assert.rejects(
    () => verifyPlatformPacketFiles(packetPath),
    /not a retained immutable authority/,
  )

  packet.evidenceSha256 = createHash('sha256').update(transcriptBytes).digest('hex')
  await Promise.all([
    writeFile(path.join(evidenceDirectory, 'journey-transcript.json'), transcriptBytes),
    writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`),
  ])
  await writeFile(artifactPath, 'tampered-sealed-bytes')
  await assert.rejects(() => verifyPlatformPacketFiles(packetPath), /sealed artifact does not match/)
})

test('lean inventory accepts dependency runtime surfaces but rejects private vectors', () => {
  const accepted = [
    '/dist/index.html',
    '/dist/assets/index-a1b2.js',
    '/dist-electron/main.cjs',
    '/dist-electron/preload.cjs',
    '/dist-electron/profile-utility.cjs',
    '/node_modules/@modelcontextprotocol/sdk/dist/cjs/server/index.js',
    '/node_modules/js-yaml/lib/schema',
    '/node_modules/example/vector',
    '/node_modules/example/embeddings',
    '/node_modules/example/models',
    '/node_modules/example/indexes',
    '/node_modules/ajv/dist/refs/json-schema-draft-07.json',
    '/node_modules/js-yaml/lib/schema/core.js',
    '/node_modules/example/models/native.node',
    '/node_modules/jose/dist/webapi/key/generate_secret.js',
    '/node_modules/prop-types/lib/ReactPropTypesSecret.js',
    '/package.json',
  ]
  assert.deepEqual(assertLeanArtifactInventory(accepted), {
    entries: accepted.length,
    topLevelTrees: ['dist', 'dist-electron', 'node_modules', 'package.json'],
  })
  assert.deepEqual(
    assertLeanArtifactInventory(accepted.filter((entry) => !entry.startsWith('/node_modules/'))).topLevelTrees,
    ['dist', 'dist-electron', 'package.json'],
  )

  for (const forbidden of [
    '/docs/adr/0025.md',
    '/dist/assets/app.js.map',
    '/node_modules/example/test/fixture.json',
    '/node_modules/example/models/model.bin',
    '/dist/models/model.json',
    '/dist/schema/model.js',
    '/dist/indexes/index.sqlite',
    '/dist/node_modules/vendor/models/model.json',
    '/dist/node_modules/vendor/models',
    '/dist/models',
    '/node_modules/js-yaml/lib/schema/model.bin',
    '/node_modules/js-yaml/lib/schema/private-key.pem',
    '/node_modules/js-yaml/lib/schema/.env.production',
    '/research/vector-model.bin',
    '/scripts/certification/tool.mjs',
    '/dist/.env.production',
    '/dist/private-key.pem',
    '/dist/README.md',
    '/dist/guide.markdown',
    '/dist/generate_secret.js',
    '/dist/credential-runtime.js',
    '/node_modules/example/secret.pem',
    '/dist-electron/main.ts',
  ]) {
    assert.throws(
      () => assertLeanArtifactInventory([...accepted, forbidden]),
      /lean artifact inventory/,
      forbidden,
    )
  }
})

test('installed runtime inventory is a closed platform allowlist', () => {
  const mac = [
    'Contents/Info.plist',
    'Contents/MacOS/Eido',
    'Contents/Resources/app.asar',
    'Contents/Resources/app-update.yml',
    'Contents/Resources/certification-provenance.json',
    'Contents/Resources/THIRD_PARTY_NOTICES.txt',
    'Contents/Resources/LICENSE',
    'Contents/Resources/LICENSE.electron.txt',
    'Contents/Resources/LICENSES.chromium.html',
    'Contents/Resources/bin',
    'Contents/Resources/bin/eido',
    'Contents/Resources/bin/eido-profile-live-gateway-helper',
    'Contents/Resources/icon.icns',
    'Contents/Frameworks/Electron Framework.framework/Versions/A/Electron Framework',
    'Contents/_CodeSignature/CodeResources',
  ]
  const windows = [
    'Eido.exe',
    'eido-profile-mcp.exe',
    'chrome_100_percent.pak',
    'dxcompiler.dll',
    'dxil.dll',
    'resources.pak',
    'locales/en-US.pak',
    'resources/app.asar',
    'resources/certification-provenance.json',
    'resources/THIRD_PARTY_NOTICES.txt',
    'resources/LICENSE',
    'resources/bin',
    'resources/bin/eido.exe',
    'resources/bin/eido-profile-live-gateway-helper.exe',
    'Uninstall Eido.exe',
  ]
  assert.equal(assertInstalledRuntimeInventory('darwin', mac).entries, mac.length)
  assert.equal(assertInstalledRuntimeInventory('win32', windows).entries, windows.length)
  assert.throws(
    () => assertInstalledRuntimeInventory('darwin', [...mac, 'Contents/Resources/docs/ADR.md']),
    /installed runtime allowlist/,
  )
  assert.throws(
    () => assertInstalledRuntimeInventory('darwin', [...mac, 'Contents/Resources/LICENSE.extra.txt']),
    /installed runtime allowlist/,
  )
  assert.throws(
    () => assertInstalledRuntimeInventory('win32', [...windows, 'research/prototype.json']),
    /installed runtime allowlist/,
  )
  assert.throws(
    () => assertInstalledRuntimeInventory('darwin', [...mac, 'Contents/Frameworks/private-key.pem']),
    /installed runtime allowlist/,
  )
  // Installed inventories carry type metadata. A root-scoped dependency
  // directory must pass the vector surface check before the platform path
  // allowlist rejects it; a file with the same shape remains forbidden.
  assert.throws(
    () => assertInstalledRuntimeInventory('win32', [{
      path: 'node_modules/js-yaml/lib/schema',
      type: 'directory',
    }]),
    /rejected unexpected path/,
  )
  assert.throws(
    () => assertInstalledRuntimeInventory('win32', [{
      path: 'node_modules/js-yaml/lib/schema',
      type: 'file',
      bytes: 1,
      sha256: 'a'.repeat(64),
    }]),
    /vector\/model\/schema\/index surface/,
  )
})

test('production dependency graph compares retained files and their ancestor directories', () => {
  const config = createProductionPackagingConfig({

    EIDO_CERTIFICATION_SET_ID: certificationSetId,
    EIDO_CERTIFICATION_SOURCE_SHA: sourceSha,
    EIDO_CERTIFICATION_SEMVER: '1.2.3-alpha.1',
    EIDO_CERTIFICATION_PLATFORM: 'win32',
    EIDO_CERTIFICATION_ARCH: 'x64',
    EIDO_CERTIFICATION_PROVENANCE_PATH: '/tmp/eido-certification-provenance.json',
  })
  const matcher = getNodeModuleFileMatcher(
    '/tmp/eido-staged-input',
    '/tmp/eido-asar',
    (value) => value,
    {},
    { config, debugLogger: { isEnabled: false } },
  )
  const filter = matcher.createFilter()
  const productionTree = JSON.parse(execFileSync(
    'npm',
    ['ls', '--omit=dev', '--all', '--json', '--long'],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 50 * 1024 * 1024 },
  ))
  const packageRoots = new Set()
  const collectPackageRoots = (node) => {
    if (!node || typeof node !== 'object') return
    if (typeof node.path === 'string' && node.path !== repositoryRoot) packageRoots.add(node.path)
    for (const dependency of Object.values(node.dependencies ?? {})) collectPackageRoots(dependency)
  }
  collectPackageRoots(productionTree)

  const entries = new Set(['/dist/runtime.js', '/dist-electron/main.cjs', '/package.json'])
  const collectRetainedTree = (directory, installedPrefix, realRoot) => {
    let hasRetainedDescendant = false
    for (const child of readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, child.name)
      const metadata = lstatSync(absolute)
      const relative = path.relative(realRoot, absolute).split(path.sep).join('/')
      const modulePath = `${installedPrefix}/${relative}`
      if (metadata.isDirectory()) {
        const retainedDirectory = filter(absolute, {
          moduleFullFilePath: modulePath,
          isDirectory: () => true,
        }) && collectRetainedTree(absolute, installedPrefix, realRoot)
        if (retainedDirectory) {
          entries.add(`/${modulePath}`)
          hasRetainedDescendant = true
        }
      } else if (metadata.isFile() && filter(absolute, {
        moduleFullFilePath: modulePath,
        isDirectory: () => false,
      })) {
        entries.add(`/${modulePath}`)
        hasRetainedDescendant = true
      }
    }
    return hasRetainedDescendant
  }
  for (const packageRoot of packageRoots) {
    const realRoot = realpathSync(packageRoot)
    collectRetainedTree(
      realRoot,
      path.relative(repositoryRoot, packageRoot).split(path.sep).join('/'),
      realRoot,
    )
  }

  assert.equal(entries.has('/node_modules/js-yaml/lib/schema'), true)
  const inventory = assertLeanArtifactInventory([...entries])
  assert.equal(inventory.topLevelTrees.includes('node_modules'), true)
})

test('macOS installed runtime admits only a regular stapled ticket at Contents/CodeResources', () => {
  assert.equal(assertInstalledRuntimeInventory('darwin', [{
    path: 'Contents/CodeResources',
    type: 'file',
    bytes: 3_501,
    sha256: 'a'.repeat(64),
  }]).entries, 1)
  assert.throws(
    () => assertInstalledRuntimeInventory('darwin', [{
      path: 'Contents/CodeResources',
      type: 'symlink',
      target: '_CodeSignature/CodeResources',
    }]),
    /must be a regular stapled-ticket file/,
  )
  assert.throws(
    () => assertInstalledRuntimeInventory('darwin', [{
      path: 'Contents/CodeResources',
      type: 'directory',
    }]),
    /must be a regular stapled-ticket file/,
  )
  assert.throws(
    () => assertInstalledRuntimeInventory('darwin', [{
      path: 'Contents/CodeResources',
      type: 'file',
      bytes: 0,
      sha256: 'a'.repeat(64),
    }]),
    /must be a regular stapled-ticket file/,
  )
  assert.throws(
    () => assertInstalledRuntimeInventory('darwin', [{
      path: 'Contents/NotarizationTicket',
      type: 'file',
      bytes: 3_501,
      sha256: 'a'.repeat(64),
    }]),
    /rejected unexpected path/,
  )
})

test('installed runtime symlinks remain inside the sealed application tree', () => {
  assert.equal(
    assertContainedInstalledSymlink('/tmp/Eido.app', '/tmp/Eido.app/Contents/Frameworks/Thing/Versions/Current', 'A'),
    'A',
  )
  assert.throws(
    () => assertContainedInstalledSymlink('/tmp/Eido.app', '/tmp/Eido.app/Contents/Frameworks/Thing', '../../../../private'),
    /escapes the installed runtime/,
  )
  assert.throws(
    () => assertContainedInstalledSymlink('/tmp/Eido.app', '/tmp/Eido.app/Contents/Frameworks/Thing', '/private/tmp'),
    /must be relative/,
  )
})

test('platform posture parsers require Eido\'s Developer ID on macOS and literal NotSigned on Windows', () => {
  const identity = { expectedAuthority, expectedTeamId }
  const signedApp = [
    'Executable=/tmp/Eido.app/Contents/MacOS/Eido',
    'Identifier=dev.eido.app',
    'Format=app bundle with Mach-O thin (arm64)',
    'CodeDirectory v=20500 size=123 flags=0x10000(runtime) hashes=1+7 location=embedded',
    `Authority=${expectedAuthority}`,
    'Authority=Developer ID Certification Authority',
    'Authority=Apple Root CA',
    `TeamIdentifier=${expectedTeamId}`,
    'Timestamp=18 Aug 2026 at 09:41:00',
    'CDHash=0123456789abcdef0123456789abcdef01234567',
  ].join('\n')

  assert.deepEqual(parseDeveloperIdSigningPosture(signedApp, identity), {
    status: 'developer-id',
    authority: expectedAuthority,
    teamIdentifier: expectedTeamId,
    cdHash: '0123456789abcdef0123456789abcdef01234567',
    hardenedRuntime: 'enabled',
    secureTimestamp: true,
  })

  for (const [name, source] of [
    ['ad-hoc', signedApp.replace(`Authority=${expectedAuthority}\n`, '').replace(`TeamIdentifier=${expectedTeamId}`, 'TeamIdentifier=not set')],
    ['a foreign authority', signedApp.replace(expectedAuthority, 'Developer ID Application: Someone Else (Z9Y8X7W6V5)')],
    ['no hardened runtime', signedApp.replace('flags=0x10000(runtime)', 'flags=0x2(adhoc)')],
    ['no secure timestamp', signedApp.replace('Timestamp=18 Aug 2026 at 09:41:00', 'Timestamp=none')],
  ]) {
    assert.throws(
      () => parseDeveloperIdSigningPosture(source, identity),
      /Developer ID signing posture is invalid/,
      name,
    )
  }

  assert.deepEqual(parseWindowsAuthenticode({
    status: 'NotSigned',
    signerCertificate: null,
    timeStamperCertificate: null,
  }), {
    status: 'NotSigned',
    publisher: null,
    certificateThumbprint: null,
    timestamp: null,
  })
  assert.throws(
    () => parseWindowsAuthenticode({ status: 'Valid', signerCertificate: 'ABC', timeStamperCertificate: null }),
    /NotSigned posture/,
  )
})

test('the sealed DMG posture requires Eido\'s identity, its own identifier, and a Gatekeeper verdict', () => {
  const identity = {
    expectedAuthority,
    expectedTeamId,
    expectedIdentifier: 'dev.eido.app.dmg',
  }
  const signedDmg = [
    'Executable=/tmp/Eido-1.2.3-arm64.dmg',
    'Identifier=dev.eido.app.dmg',
    'Format=disk image',
    `Authority=${expectedAuthority}`,
    `TeamIdentifier=${expectedTeamId}`,
    'Timestamp=18 Aug 2026 at 09:41:00',
    'CDHash=9123456789abcdef0123456789abcdef01234567',
  ].join('\n')

  assert.deepEqual(parseSignedMacDiskImagePosture(signedDmg, identity), {
    status: 'developer-id',
    format: 'dmg',
    identifier: 'dev.eido.app.dmg',
    authority: expectedAuthority,
    teamIdentifier: expectedTeamId,
    cdHash: '9123456789abcdef0123456789abcdef01234567',
    secureTimestamp: true,
  })

  for (const [name, source] of [
    ['unsigned', 'Executable=/tmp/Eido-1.2.3-arm64.dmg: code object is not signed at all'],
    ['a foreign identifier', signedDmg.replace('Identifier=dev.eido.app.dmg', 'Identifier=com.example.dmg')],
    ['a foreign team', signedDmg.replace(`TeamIdentifier=${expectedTeamId}`, 'TeamIdentifier=Z9Y8X7W6V5')],
    ['no secure timestamp', signedDmg.replace('Timestamp=18 Aug 2026 at 09:41:00', 'Timestamp=none')],
  ]) {
    assert.throws(
      () => parseSignedMacDiskImagePosture(source, identity),
      /sealed DMG signing posture is invalid/,
      name,
    )
  }

  assert.equal(
    assertNotarizedGatekeeperAcceptance('/tmp/Eido.app: accepted\nsource=Notarized Developer ID\norigin=Developer ID Application: Wei Li Lim'),
    'accepted-notarized-developer-id',
  )
  // A locally trusted or developer-mode acceptance would not hold on anyone
  // else's Mac, so it is not an acceptance this lane recognises.
  assert.throws(
    () => assertNotarizedGatekeeperAcceptance('/tmp/Eido.app: accepted\nsource=Unnotarized Developer ID'),
    /unexpected source/,
  )
  assert.throws(
    () => assertNotarizedGatekeeperAcceptance('/tmp/Eido.app: rejected\nsource=Notarized Developer ID'),
    /Gatekeeper rejected/,
  )
})

test('production packaging signs macOS with Eido\'s Developer ID and leaves Windows deliberately unsigned', () => {
  const common = {

    EIDO_CERTIFICATION_SET_ID: certificationSetId,
    EIDO_CERTIFICATION_SOURCE_SHA: sourceSha,
    EIDO_CERTIFICATION_SEMVER: '1.2.3-alpha.1',
    EIDO_CERTIFICATION_PROVENANCE_PATH: '/tmp/eido-certification-provenance.json',
  }
  const signingEnvironment = {
    RUNNER_TEMP: '/tmp/eido-runner',
    EIDO_MACOS_EXPECTED_TEAM_ID: expectedTeamId,
    EIDO_MACOS_EXPECTED_AUTHORITY: expectedAuthority,
    EIDO_MACOS_NOTARIZATION_API_KEY_ID: 'A1B2C3D4E5',
    EIDO_MACOS_NOTARIZATION_API_ISSUER: '11111111-2222-3333-4444-555555555555',
  }
  const mac = createProductionPackagingConfig({
    ...common,
    ...signingEnvironment,
    EIDO_CERTIFICATION_PLATFORM: 'darwin',
    EIDO_CERTIFICATION_ARCH: 'arm64',
  })
  const windows = createProductionPackagingConfig({
    ...common,
    EIDO_CERTIFICATION_PLATFORM: 'win32',
    EIDO_CERTIFICATION_ARCH: 'x64',
  })

  for (const config of [mac, windows]) {
    assert.equal(config.appId, 'dev.eido.app')
    assert.equal(config.productName, 'Eido')
    assert.equal(config.extraMetadata.version, '1.2.3-alpha.1')
    assert.equal(config.asar, true)
    assert.equal(config.afterPack, addProfileMcpSeaEntry)
    assert.deepEqual(config.files, [
      'dist/**/*',
      'dist-electron/**/*',
      'package.json',
      '!**/*.[mM][dD]',
      '!**/*.[mM][aA][rR][kK][dD][oO][wW][nN]',
      '!**/*.[tT][sS]',
      '!**/*.[tT][sS][xX]',
      '!**/*.[jJ][sS][xX]',
      '!**/*.[sS][cC][sS][sS]',
      '!**/*.[lL][eE][sS][sS]',
      '!**/*.[pP][eE][mM]',
      '!**/*.[kK][eE][yY]',
      '!**/*.[pP]12',
      '!**/*.[pP][fF][xX]',
      '!**/.[eE][nN][vV]',
      '!**/.[eE][nN][vV].*',
      '!**/*.[mM][aA][pP]',
      '!**/{[dD][oO][cC],[dD][oO][cC][sS],[rR][eE][sS][eE][aA][rR][cC][hH],[pP][rR][oO][tT][oO][tT][yY][pP][eE],[pP][rR][oO][tT][oO][tT][yY][pP][eE][sS],[rR][eE][tT][rR][oO],[rR][eE][tT][rR][oO][sS],[aA][dD][rR],[aA][gG][eE][nN][tT],[aA][gG][eE][nN][tT][sS],[sS][kK][iI][lL][lL],[sS][kK][iI][lL][lL][sS],[tT][eE][sS][tT],[tT][eE][sS][tT][sS],__[tT][eE][sS][tT][sS]__,[fF][iI][xX][tT][uU][rR][eE],[fF][iI][xX][tT][uU][rR][eE][sS],[tT][oO][oO][lL][iI][nN][gG],[sS][cC][rR][iI][pP][tT],[sS][cC][rR][iI][pP][tT][sS],[cC][iI]}/**',
      '!**/{[vV][eE][cC][tT][oO][rR],[vV][eE][cC][tT][oO][rR][sS],[eE][mM][bB][eE][dD][dD][iI][nN][gG],[eE][mM][bB][eE][dD][dD][iI][nN][gG][sS],[mM][oO][dD][eE][lL],[mM][oO][dD][eE][lL][sS],[sS][cC][hH][eE][mM][aA],[sS][cC][hH][eE][mM][aA][sS],[iI][nN][dD][eE][xX],[iI][nN][dD][eE][xX][eE][sS]}/**/*.{[bB][iI][nN],[dD][bB],[sS][qQ][lL][iI][tT][eE],[oO][nN][nN][xX],[sS][aA][fF][eE][tT][eE][nN][sS][oO][rR][sS]}',
      '!**/*{[vV][eE][cC][tT][oO][rR],[eE][mM][bB][eE][dD][dD][iI][nN][gG],[mM][oO][dD][eE][lL],[sS][cC][hH][eE][mM][aA],[iI][nN][dD][eE][xX]}[-_.]*.{[bB][iI][nN],[dD][bB],[sS][qQ][lL][iI][tT][eE],[oO][nN][nN][xX],[sS][aA][fF][eE][tT][eE][nN][sS][oO][rR][sS]}',
    ])
    assert.equal(config.extraResources.length, config === mac ? 4 : 3)
    assert.equal(config.extraResources[0].to, 'certification-provenance.json')
    assert.equal(config.extraResources[1].to, 'THIRD_PARTY_NOTICES.txt')
    assert.equal(config.extraResources[2].to, 'LICENSE')
    assert.equal(readFileSync(config.extraResources[2].from, 'utf8'), readFileSync(path.join(repositoryRoot, 'LICENSE'), 'utf8'))
  }
  assert.equal(mac.extraResources[3].to, 'app-update.yml')
  assert.equal(
    readFileSync(mac.extraResources[3].from, 'utf8'),
    'provider: generic\nurl: https://updates.eido.so/\nupdaterCacheDirName: eido-updater\n',
  )

  // macOS: signed with the exact Developer ID identity, hardened, with the
  // narrow entitlements the smoke proved sufficient, and the outer DMG signed
  // by the explicit hook rather than the builder's incomplete shortcut.
  assert.deepEqual(mac.mac.target, [{ target: 'dmg', arch: ['arm64'] }])
  assert.equal(mac.mac.identity, 'Wei Li Lim (A1B2C3D4E5)')
  assert.deepEqual(mac.mac.binaries, [
    'Contents/Resources/bin/eido',
    'Contents/Resources/bin/eido-profile-live-gateway-helper',
  ])
  assert.equal(mac.mac.hardenedRuntime, true)
  assert.equal(
    mac.mac.entitlements,
    `/tmp/eido-runner/${MACOS_RELEASE_CREDENTIAL_DIRECTORY}/entitlements.plist`,
  )
  assert.equal(mac.mac.entitlementsInherit, mac.mac.entitlements)
  assert.equal(mac.mac.notarize, false)
  assert.equal(mac.forceCodeSigning, true)
  assert.equal(mac.dmg.sign, false)
  assert.equal(mac.dmg.writeUpdateInfo, false)
  // Nothing but the app and the Applications link is visible in the opened
  // volume: the volume icon is off, and a background colour keeps dmgbuild
  // from copying a background image into the volume root.
  assert.equal(mac.dmg.icon, null)
  assert.equal(mac.dmg.backgroundColor, '#ffffff')
  assert.equal(mac.dmg.background, undefined)
  assert.deepEqual(mac.dmg.window, { width: 540, height: 380 })
  assert.equal(typeof mac.artifactBuildCompleted, 'function')
  assert.equal(typeof mac.afterSign, 'function')
  assert.equal(typeof mac.afterAllArtifactBuild, 'function')
  assert.equal(mac.mac.minimumSystemVersion, '13.5.0')
  assert.equal(mac.mac.icon, path.join(repositoryRoot, 'release', 'packaged', 'icons', 'icon.icns'))

  // A macOS release cannot be built unsigned by accident: with no identity in
  // the environment the config itself refuses to exist.
  assert.throws(
    () => createProductionPackagingConfig({
      ...common,
      RUNNER_TEMP: '/tmp/eido-runner',
      EIDO_CERTIFICATION_PLATFORM: 'darwin',
      EIDO_CERTIFICATION_ARCH: 'arm64',
    }),
    /macos-signing-.*-missing/,
  )

  // Windows: unsigned by decision. No identity, no hardened runtime, no
  // signing hook, and an empty cscLink so nothing on the runner is discovered.
  assert.deepEqual(windows.win.target, [{ target: 'nsis', arch: ['x64'] }])
  assert.equal(windows.mac.identity, null)
  assert.equal(windows.mac.hardenedRuntime, false)
  assert.equal(windows.forceCodeSigning, false)
  assert.equal(windows.win.cscLink, '')
  assert.equal(windows.win.signExecutable, false)
  assert.equal(windows.artifactBuildCompleted, undefined)
  assert.equal(windows.afterSign, undefined)
  assert.equal(windows.afterAllArtifactBuild, undefined)
  assert.equal(windows.win.icon, path.join(repositoryRoot, 'release', 'packaged', 'icons', 'icon.ico'))
  assert.equal(windows.nsis.include, path.join(repositoryRoot, 'build', 'eido-path.nsh'))
  assert.equal(windows.nsis.perMachine, false)
  assert.equal(windows.nsis.deleteAppDataOnUninstall, false)
})

test('production dependency collection excludes certifier-private dependency content', () => {
  const config = createProductionPackagingConfig({

    EIDO_CERTIFICATION_SET_ID: certificationSetId,
    EIDO_CERTIFICATION_SOURCE_SHA: sourceSha,
    EIDO_CERTIFICATION_SEMVER: '1.2.3-alpha.1',
    EIDO_CERTIFICATION_PLATFORM: 'win32',
    EIDO_CERTIFICATION_ARCH: 'x64',
    EIDO_CERTIFICATION_PROVENANCE_PATH: '/tmp/eido-certification-provenance.json',
  })
  // Exercise Electron Builder's dependency matcher, which receives only the
  // config's negations when it copies production modules into the ASAR.
  const matcher = getNodeModuleFileMatcher(
    '/tmp/eido-staged-input',
    '/tmp/eido-asar',
    (value) => value,
    {},
    { config, debugLogger: { isEnabled: false } },
  )
  const filter = matcher.createFilter()
  const included = (modulePath) => filter(
    `/tmp/dependency/${modulePath}`,
    {
      moduleFullFilePath: `node_modules/${modulePath}`,
      isDirectory: () => false,
    },
  )

  for (const rejectedPath of [
    '@codemirror/legacy-modes/mode/README.md',
    '@codemirror/legacy-modes/mode/README.MD',
    '@types/node/README.md',
    'hosted-git-info/node_modules/lru-cache/README.md',
    'postject/README.markdown',
    'postject/README.MarkDown',
    '@lezer/markdown/src/extension.ts',
    '@lezer/markdown/src/extension.TS',
    '@lezer/markdown/src/extension.tsx',
    '@lezer/markdown/src/extension.jsx',
    '@lezer/markdown/src/theme.scss',
    '@lezer/markdown/src/theme.less',
    '@lezer/markdown/runtime.pem',
    '@lezer/markdown/runtime.KEY',
    '@lezer/markdown/runtime.p12',
    '@lezer/markdown/runtime.PfX',
    '@lezer/markdown/.env',
    '@lezer/markdown/.env.production',
    '@lezer/markdown/test/fixture.js',
    '@lezer/markdown/TESTS/fixture.js',
    '@lezer/markdown/docs/reference.js',
    '@lezer/markdown/src/extension.js.map',
    '@lezer/markdown/src/extension.JS.MAP',
    '@lezer/markdown/models/model.bin',
    '@lezer/markdown/dist/model-v1.SaFeTeNsOrS',
  ]) {
    assert.equal(included(rejectedPath), false, rejectedPath)
  }
  assert.equal(included('@codemirror/legacy-modes/mode/diff.js'), true)
  assert.equal(included('@lezer/markdown/dist/markdown.js'), true)
  assert.equal(included('@lezer/markdown/dist/config.json'), true)
  assert.equal(included('@lezer/markdown/VECTORS/runtime.json'), true)
  assert.equal(included('@lezer/markdown/model-v1.json'), true)
  assert.equal(included('@lezer/markdown/models/native.node'), true)
  assert.equal(included('@lezer/markdown/managed-credential.js'), true)
  assert.equal(included('@lezer/markdown/managed-SECRET.js'), true)
  assert.equal(included('jose/dist/webapi/key/generate_secret.js'), true)
  assert.equal(included('prop-types/lib/ReactPropTypesSecret.js'), true)
  assert.equal(included('ajv/dist/refs/json-schema-draft-06.json'), true)
  assert.equal(included('@lezer/markdown/dist/native.node'), true)
  assert.equal(included('@lezer/markdown/LICENSE'), true)
  assert.equal(included('@lezer/markdown/THIRD_PARTY_NOTICES.txt'), true)
})

test('dependency filtering preserves pinned runtime package references', async () => {
  const config = createProductionPackagingConfig({

    EIDO_CERTIFICATION_SET_ID: certificationSetId,
    EIDO_CERTIFICATION_SOURCE_SHA: sourceSha,
    EIDO_CERTIFICATION_SEMVER: '1.2.3-alpha.1',
    EIDO_CERTIFICATION_PLATFORM: 'win32',
    EIDO_CERTIFICATION_ARCH: 'x64',
    EIDO_CERTIFICATION_PROVENANCE_PATH: '/tmp/eido-certification-provenance.json',
  })
  const matcher = getNodeModuleFileMatcher(
    '/tmp/eido-staged-input',
    '/tmp/eido-asar',
    (value) => value,
    {},
    { config, debugLogger: { isEnabled: false } },
  )
  const filter = matcher.createFilter()
  const packageRoot = await mkdtemp(path.join(os.tmpdir(), 'eido-ajv-filter-'))
  const dependencyRoot = path.join(packageRoot, 'node_modules')
  try {
    await mkdir(dependencyRoot, { recursive: true })
    for (const packageName of [
      'ajv',
      'fast-deep-equal',
      'fast-uri',
      'json-schema-traverse',
      'require-from-string',
      'js-yaml',
      'jose',
      'prop-types',
    ]) {
      const source = path.join(repositoryRoot, 'node_modules', packageName)
      const destination = path.join(dependencyRoot, packageName)
      await cp(source, destination, {
        recursive: true,
        filter: (candidate) => {
          const stat = lstatSync(candidate)
          const modulePath = path.relative(repositoryRoot, candidate).split(path.sep).join('/')
          return filter(candidate, {
            moduleFullFilePath: modulePath,
            isDirectory: () => stat.isDirectory(),
          })
        },
      })
    }

    const filteredAjvEntry = path.join(dependencyRoot, 'ajv', 'dist', 'ajv.js')
    assert.match(readFileSync(filteredAjvEntry, 'utf8'), /json-schema-draft-07\.json/)
    assert.equal(
      existsSync(path.join(dependencyRoot, 'jose', 'dist', 'webapi', 'key', 'generate_secret.js')),
      true,
    )
    assert.equal(
      existsSync(path.join(dependencyRoot, 'prop-types', 'lib', 'ReactPropTypesSecret.js')),
      true,
    )
    assert.doesNotThrow(() => {
      const Ajv = require(path.join(dependencyRoot, 'ajv'))
      new Ajv()
    })
    assert.doesNotThrow(() => {
      require(path.join(dependencyRoot, 'js-yaml'))
    })
    await assert.doesNotReject(async () => {
      const jose = await import(pathToFileURL(
        path.join(dependencyRoot, 'jose', 'dist', 'webapi', 'index.js'),
      ).href)
      assert.equal(typeof jose.generateSecret, 'function')
    })
    const previousNodeEnv = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      assert.equal(typeof require(path.join(dependencyRoot, 'prop-types')).string, 'function')
    } finally {
      if (previousNodeEnv === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previousNodeEnv
    }
    assert.equal(
      existsSync(path.join(dependencyRoot, 'ajv', 'dist', 'refs', 'json-schema-draft-07.json')),
      true,
    )
    assert.equal(existsSync(path.join(dependencyRoot, 'js-yaml', 'lib', 'schema', 'core.js')), true)
  } finally {
    await rm(packageRoot, { recursive: true, force: true })
  }
})

test('the DMG signing hook signs only the sealed artifact this run produced', async () => {
  const identity = {
    expectedAuthority,
    expectedTeamId,
  }
  const expectedDmgPath = '/tmp/package/Eido-1.2.3-arm64.dmg'
  const context = { identity, dmgIdentifier: 'dev.eido.app.dmg', expectedDmgPath }
  const packager = { codeSigningInfo: { value: Promise.resolve({ keychainFile: '/tmp/keychain.db' }) } }
  const calls = []
  await signProductionDmg(
    { target: { name: 'dmg' }, file: expectedDmgPath, packager },
    context,
    (command, args) => {
      calls.push([command, args])
      return Promise.resolve({ stdout: '', stderr: '' })
    },
  )
  assert.deepEqual(calls, [[
    '/usr/bin/codesign',
    [
      '--sign', expectedAuthority,
      '--timestamp',
      '--identifier', 'dev.eido.app.dmg',
      '--keychain', '/tmp/keychain.db',
      expectedDmgPath,
    ],
  ]])

  for (const event of [
    { target: { name: 'zip' }, file: expectedDmgPath, packager },
    { target: { name: 'dmg' }, file: '/tmp/package/Other.dmg', packager },
    { target: { name: 'dmg' }, file: expectedDmgPath, packager: { codeSigningInfo: { value: Promise.resolve({}) } } },
  ]) {
    await assert.rejects(
      () => signProductionDmg(event, context, () => Promise.reject(new Error('must not run'))),
      /signing-context-invalid/,
    )
  }
})

test('the macOS update ZIP is recreated with ditto only after the app is notarized and stapled', async () => {
  const calls = []
  const updateZipPath = '/tmp/package/Eido-1.2.3-arm64.zip'
  await notarizeAndStapleProductionApp({
    appOutDir: '/tmp/package/mac-arm64',
    updateZipPath,
    identity: {
      notarizationKeyPath: '/tmp/notary.p8',
      notarizationApiKeyId: 'A1B2C3D4E5',
      notarizationApiIssuer: '11111111-2222-3333-4444-555555555555',
    },
  }, async (command, args) => {
    calls.push([command, args])
    return args.includes('notarytool')
      ? { stdout: '{"status":"Accepted"}', stderr: '' }
      : { stdout: '', stderr: '' }
  })

  const stapleAt = calls.findIndex(([, args]) => args[0] === 'stapler' && args[1] === 'staple')
  const archiveAt = calls.findLastIndex(([command, args]) => (
    command === '/usr/bin/ditto' && args.at(-1) === updateZipPath
  ))
  assert.ok(stapleAt >= 0)
  assert.ok(archiveAt > stapleAt)
  assert.deepEqual(calls[archiveAt], [
    '/usr/bin/ditto',
    ['-c', '-k', '--keepParent', '/tmp/package/mac-arm64/Eido.app', updateZipPath],
  ])
})

test('macOS notarization waits and job limits exceed the measured Apple queue', () => {
  // Apple's queue was measured at 74 to 99 minutes on the first submissions
  // from this Team ID. Both the wait and the job limit must sit above the
  // slowest measurement, and the job limit must exceed the wait so a late
  // notarization fails with a readable error rather than a killed job.
  assert.equal(MACOS_MEASURED_NOTARIZATION_LATENCY_MINUTES.observedMaximum, 99)
  assert.ok(
    MACOS_NOTARIZATION_WAIT_MINUTES > MACOS_MEASURED_NOTARIZATION_LATENCY_MINUTES.observedMaximum,
    'notarization wait must exceed the slowest measured queue',
  )
  assert.ok(
    MACOS_RELEASE_JOB_TIMEOUT_MINUTES > MACOS_NOTARIZATION_WAIT_MINUTES,
    'the macOS job limit must exceed its own notarization wait',
  )
  const workflow = readFileSync(new URL('../../.github/workflows/packaged-certification.yml', import.meta.url), 'utf8')
  const macJob = workflow.slice(workflow.indexOf('\n  certify-macos:\n'), workflow.indexOf('\n  certify-windows:\n'))
  assert.match(macJob, new RegExp(`\n    timeout-minutes: ${MACOS_RELEASE_JOB_TIMEOUT_MINUTES}\n`))
})

test('the macOS release leg signs, notarizes, and destroys credentials before it uploads', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/packaged-certification.yml', import.meta.url), 'utf8')
  const macJob = workflow.slice(workflow.indexOf('\n  certify-macos:\n'), workflow.indexOf('\n  certify-windows:\n'))
  const windowsJob = workflow.slice(workflow.indexOf('\n  certify-windows:\n'), workflow.indexOf('\n  pair:\n'))

  // The identity is unreachable without an environment binding, so a missing
  // binding fails the release rather than silently producing unsigned bytes.
  assert.match(macJob, /\n    environment: macos-signing-smoke\n/)

  const order = [
    'Preflight the signing identity before native spend',
    'Build the sealed, signed production installer',
    'Notarize and staple the sealed DMG',
    'Remove signing credentials from the runner',
    'Certify installed GUI, CLI, MCP, lifecycle, inventory, and posture',
    'Preserve sealed bytes and digest-addressed native evidence',
  ].map((name) => macJob.indexOf(`- name: ${name}`))
  assert.ok(order.every((index) => index !== -1), 'the macOS leg is missing a signing step')
  assert.deepEqual(order, [...order].sort((left, right) => left - right), 'macOS signing steps are out of order')
  assert.match(macJob, /- name: Remove signing credentials from the runner\n        if: \$\{\{ always\(\) \}\}/)

  // The workflow and the signing code must agree on the one directory that ever
  // holds credential material, or cleanup would remove the wrong tree.
  for (const line of [
    `APP_BUILDER_TMP_DIR: \${{ runner.temp }}/${MACOS_RELEASE_CREDENTIAL_DIRECTORY}`,
    `CSC_LINK: \${{ runner.temp }}/${MACOS_RELEASE_CREDENTIAL_DIRECTORY}/certificate.p12`,
  ]) {
    assert.ok(macJob.includes(line), `the macOS leg must set ${line}`)
  }

  // Credential material is named only by the steps that must have it.
  const credentialSteps = [...macJob.matchAll(/- name: (.+)\n([\s\S]*?)(?=\n      - name: |$)/g)]
    .filter(([, , body]) => /secrets\.EIDO_MACOS/.test(body))
    .map(([, name]) => name.trim())
  assert.deepEqual(credentialSteps, [
    'Preflight the signing identity before native spend',
    'Build the sealed, signed production installer',
  ])

  // Windows is a separate job with no environment and no signing credentials,
  // so the identity is never even reachable from the unsigned leg.
  assert.doesNotMatch(windowsJob, /environment:/)
  assert.doesNotMatch(windowsJob, /secrets\.EIDO_MACOS/)
  assert.doesNotMatch(windowsJob, /release-signing/)
  assert.match(windowsJob, /CSC_IDENTITY_AUTO_DISCOVERY: 'false'/)
  // The signed leg must not disable identity discovery: Electron Builder reads
  // that flag before it will use the certificate this lane supplies.
  assert.doesNotMatch(macJob, /CSC_IDENTITY_AUTO_DISCOVERY/)
})

test('both certification legs stay in step on everything except signing', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/packaged-certification.yml', import.meta.url), 'utf8')
  const stepNames = (job) => [...job.matchAll(/- name: (.+)/g)].map(([, name]) => name.trim())
  const macJob = workflow.slice(workflow.indexOf('\n  certify-macos:\n'), workflow.indexOf('\n  certify-windows:\n'))
  const windowsJob = workflow.slice(workflow.indexOf('\n  certify-windows:\n'), workflow.indexOf('\n  pair:\n'))
  const signingOnly = new Set([
    'Preflight the signing identity before native spend',
    'Notarize and staple the sealed DMG',
    'Remove signing credentials from the runner',
  ])
  const macShared = stepNames(macJob)
    .filter((name) => !signingOnly.has(name))
    .map((name) => name.replace('sealed, signed production installer', 'sealed production installer'))
  // The two legs were one matrix job before signing forced them apart. Keeping
  // their shared steps identical is what stops the split from becoming drift.
  assert.deepEqual(macShared, stepNames(windowsJob))
})

test('macOS deployment evidence cannot exceed the Friends Alpha floor', () => {
  assert.equal(assertMacDeploymentTargetAtOrBelow('    minos 12.0\n', '13.5.0'), '12.0.0')
  assert.equal(assertMacDeploymentTargetAtOrBelow('    minos 13.5\n', '13.5.0'), '13.5.0')
  assert.throws(
    () => assertMacDeploymentTargetAtOrBelow('    minos 13.5.1\n', '13.5.0'),
    /exceeds 13\.5\.0/,
  )
  assert.throws(
    () => assertMacDeploymentTargetAtOrBelow('no deployment command', '13.5.0'),
    /evidence is invalid/,
  )
})

test('macOS certification recognizes every thin and fat Mach-O byte order', () => {
  for (const magic of [
    'feedface',
    'cefaedfe',
    'feedfacf',
    'cffaedfe',
    'cafebabe',
    'bebafeca',
    'cafebabf',
    'bfbafeca',
  ]) {
    assert.equal(isMachOBinaryHeader(Buffer.from(magic, 'hex')), true, magic)
  }
  assert.equal(isMachOBinaryHeader(Buffer.from('feedfa', 'hex')), false)
  assert.equal(isMachOBinaryHeader(Buffer.from('7f454c46', 'hex')), false)
})

test('macOS certification enumerates every regular Mach-O in the installed inventory', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'eido-mach-o-inventory-'))
  try {
    await Promise.all([
      writeFile(path.join(root, 'Eido'), Buffer.from('cffaedfe00000000', 'hex')),
      writeFile(path.join(root, 'Framework'), Buffer.from('cafebabf00000000', 'hex')),
      writeFile(path.join(root, 'app.asar'), Buffer.from('7b226e616d65223a', 'hex')),
    ])
    const binaries = await enumerateInstalledMachOBinaries(root, [
      { path: 'Eido', type: 'file' },
      { path: 'Framework', type: 'file' },
      { path: 'app.asar', type: 'file' },
      { path: 'Alias', type: 'symlink', target: 'Eido' },
    ])
    assert.deepEqual(binaries.map(({ path: name }) => name), ['Eido', 'Framework'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('macOS package inspection uses vtool for parenthesized Electron helper paths', () => {
  const harness = readFileSync(new URL('../certification/certify-packaged.mjs', import.meta.url), 'utf8')
  assert.match(harness, /runChecked\('\/usr\/bin\/vtool', \['-show-build', binary\.absolute\]\)/)
  assert.doesNotMatch(harness, /runChecked\('\/usr\/bin\/otool', \['-l', binary\.absolute\]\)/)
})

test('installed certification resolves eido by command name from an unrelated cwd', () => {
  const harness = readFileSync(new URL('../certification/certify-packaged.mjs', import.meta.url), 'utf8')
  assert.match(harness, /runInstalledEidoPathCommand\(context_, installation_, \['status'\]\)/)
  assert.match(harness, /parseProfileCliResponse\(result\.stdoutBytes, \{ envelope: 'standalone' \}\)/)
  assert.match(
    harness,
    /const pathStatus = assertProfileStatusResult\(assertErgonomicGatewaySuccess\(/,
  )
  assert.doesNotMatch(
    harness,
    /assertProfileStatus\(assertErgonomicGatewaySuccess\(/,
  )
  assert.match(harness, /runCommand\('eido', arguments_, \{/)
  assert.match(harness, /cwd: workingDirectory/)
  assert.match(harness, /const command = MAC_EIDO_COMMAND/)
  assert.match(harness, /environment\.PATH = inheritedPath/)
  assert.match(harness, /\[registration\.machinePath, registration\.path\]/)
  assert.match(harness, /MAC_EIDO_COMMAND_INSTALL_SCRIPT, 'eido-install', command, source, launcher/)
  assert.match(harness, /cleanup: \(\) => removeOwnedMacPathCanary\(command, launcher\)/)
  assert.match(harness, /runCommand\('where\.exe', \['eido'\]/)
  assert.match(harness, /firstResolution.*canonicalWindowsPath\(executable\)/s)
  assert.match(harness, /GetEnvironmentVariable\('Path', 'User'\)/)
  assert.match(harness, /CliPathEntryOwner/)
})

test('Windows PATH cleanup uses the NSIS uninstall-side string helper', () => {
  const installer = readFileSync(new URL('../../build/eido-path.nsh', import.meta.url), 'utf8')
  const uninstallMacro = installer.match(/!macro customUnInstall([\s\S]*?)!macroend/)?.[1] ?? ''
  assert.match(
    installer,
    /!ifdef BUILD_UNINSTALLER\s+\$\{UnStrRep\}\s+!else\s+\$\{StrStr\}\s+\$\{StrRep\}\s+!endif/,
  )
  assert.match(installer, /\$\{UnStrRep\}/)
  assert.match(uninstallMacro, /\$\{UnStrRep\}/)
  assert.doesNotMatch(uninstallMacro, /\$\{StrRep\}/)
  assert.doesNotMatch(installer, /^eido_path_install_done:/m)
})

test('every installed Mach-O must be arm64-only and target macOS 13.5 or earlier', () => {
  assert.equal(
    assertArm64MacDeploymentEvidence('arm64\n', '    minos 13.5\n', '13.5.0'),
    '13.5.0',
  )
  assert.throws(
    () => assertArm64MacDeploymentEvidence('x86_64 arm64\n', '    minos 13.5\n', '13.5.0'),
    /not arm64-only/,
  )
  assert.throws(
    () => assertArm64MacDeploymentEvidence('arm64\n', '    minos 14.0\n', '13.5.0'),
    /exceeds 13\.5\.0/,
  )
})

test('production packaging refuses zero version, wrong target, and missing provenance', () => {
  const environment = {

    EIDO_CERTIFICATION_SET_ID: certificationSetId,
    EIDO_CERTIFICATION_SOURCE_SHA: sourceSha,
    EIDO_CERTIFICATION_SEMVER: '1.2.3',
    EIDO_CERTIFICATION_PLATFORM: 'darwin',
    EIDO_CERTIFICATION_ARCH: 'arm64',
    EIDO_CERTIFICATION_PROVENANCE_PATH: '/tmp/provenance.json',
  }
  assert.throws(
    () => createProductionPackagingConfig({ ...environment, EIDO_CERTIFICATION_SEMVER: '0.0.0' }),
    /non-0\.0\.0 SemVer/,
  )
  assert.throws(
    () => createProductionPackagingConfig({ ...environment, EIDO_CERTIFICATION_ARCH: 'x64' }),
    /target identity/,
  )
  assert.throws(
    () => createProductionPackagingConfig({ ...environment, EIDO_CERTIFICATION_PROVENANCE_PATH: '' }),
    /provenance path/,
  )
})

test('staged package metadata prevents Electron Builder from auto-copying bundled dependencies', () => {
  assert.deepEqual(createStagedPackageManifest({
    name: 'eido',
    main: 'dist-electron/main.cjs',
  }, '1.2.3-alpha.1'), {
    name: 'eido',
    version: '1.2.3-alpha.1',
    main: 'dist-electron/main.cjs',
    license: 'GPL-3.0-only',
    dependencies: {},
  })
})

test('production builder resolves dependencies only from the staged application root', () => {
  const options = createPackagingOptions('/tmp/eido-staged-input')
  assert.equal(options.projectDir, '/tmp/eido-staged-input')
  assert.match(options.config, /release\/packaged\/production-builder\.mjs$/)
  assert.equal(options.publish, 'never')
})

test('release certification rejects non-main dispatches instead of succeeding through skipped jobs', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/packaged-certification.yml', import.meta.url), 'utf8')
  assert.match(workflow, /test "\$GITHUB_REF" = "refs\/heads\/main"/)
  assert.match(workflow, /certification_set_id=eido-cert-v2-\$\{GITHUB_RUN_ID\}-\$\{GITHUB_RUN_ATTEMPT\}/)
  assert.doesNotMatch(workflow, /certification_set_id=eido-cert-v1-/)
  assert.doesNotMatch(workflow, /^\s+if: github\.ref == 'refs\/heads\/main'$/m)
  assert.doesNotMatch(workflow, /^\s+(?:push|pull_request|schedule|workflow_run):/m)
})

test('sealed production builds do not require an Eido account or telemetry service', () => {
  const workflow = readFileSync(new URL('../../.github/workflows/packaged-certification.yml', import.meta.url), 'utf8')
  assert.doesNotMatch(workflow, /VITE_CLERK|VITE_EIDO_ACCOUNT|VITE_EIDO_CONTROL_PLANE|account-preflight/)
  assert.doesNotMatch(workflow, /Validate production analytics configuration/)
  const macJob = workflow.slice(workflow.indexOf('\n  certify-macos:\n'), workflow.indexOf('\n  certify-windows:\n'))
  const windowsJob = workflow.slice(workflow.indexOf('\n  certify-windows:\n'), workflow.indexOf('\n  pair:\n'))
  for (const job of [macJob, windowsJob]) {
    assert.match(job, /VITE_EIDO_RELEASE_VERSION: \$\{\{ inputs\.semver \}\}/)
  }
})

test('certification GUI journey closes through ordinary user seams, not renderer close', () => {
  const harness = readFileSync(new URL('../certification/certify-packaged.mjs', import.meta.url), 'utf8')
  // Renderer-initiated DOM close tears the WebContents down before Electron's
  // cancellable close handling, killing the app's joined Profile shutdown
  // (observed as certification run 2's macOS EIDO_SHELL_FATAL).
  assert.doesNotMatch(harness, /Runtime\.evaluate'[^]{0,200}?window\.close/)
  assert.match(harness, /requestOrdinaryUserClose/)
  assert.match(harness, /tell application id/)
  // Windows closes via WM_CLOSE (0x0010) to the GUI's visible unowned
  // top-level window, selected with Win32 EnumWindows: .NET's
  // Process.MainWindowHandle heuristic reported no window on the hosted
  // runner (run 3), and a hidden GUI launch would mask the user seam.
  assert.match(harness, /EnumWindows/)
  assert.match(harness, /WindowMessageClose = 0x0010/)
  assert.match(harness, /IsWindowVisible/)
  assert.doesNotMatch(harness, /CloseMainWindow/)
  // The GUI spawn must not pass windowsHide: libuv turns it into an SW_HIDE
  // startup hint that can leave the first shown Chromium window invisible.
  const journey = harness.slice(harness.indexOf('async function runGuiCdpJourney'), harness.indexOf('async function requestOrdinaryUserClose'))
  const guiSpawn = /const child = spawn\(executable, launchArguments, \{[^}]*\}\)/.exec(journey)
  assert(guiSpawn, 'GUI spawn call not found')
  assert.doesNotMatch(guiSpawn[0], /windowsHide/)
  // The multiline close script must survive PowerShell argument parsing.
  assert.match(harness, /-EncodedCommand/)
  // Arguments after `powershell.exe -Command <script>` are concatenated into
  // the command text and never bound to $args, so `$args[0]` is always null
  // there (observed as certification run 2's Windows null LiteralPath).
  assert.doesNotMatch(harness, /\$args\[/)
})

test('offline reopen reloads only after the reopened app document shows the Card', () => {
  const harness = readFileSync(new URL('../certification/certify-packaged.mjs', import.meta.url), 'utf8')
  // The page target exists from navigation start while the DOM is still the
  // blank initial document (readyState already 'complete'); reloading before
  // the app document commits aborts the app's startup loadURL and the shell
  // correctly fails closed (run 4: symmetric ERR_ABORTED on both platforms).
  const reopenGate = harness.indexOf('reopened Card visible before offline reload')
  const reload = harness.indexOf("client.send('Page.reload'")
  assert(reopenGate !== -1, 'reopened-Card gate missing')
  assert(reload !== -1, 'offline reload missing')
  assert(reopenGate < reload, 'offline reload must follow the reopened-Card gate')
  // The reloaded document is proven fresh via a driver-scoped marker.
  assert.match(harness, /__eidoCertificationPreReload/)
})

test('MCP mutation binds the Profile revision observed after the last GUI session', () => {
  const harness = readFileSync(new URL('../certification/certify-packaged.mjs', import.meta.url), 'utf8')
  // The GUI shutdown checkpoint commits renderer state, advancing the Profile
  // revision even for a read-only reopen; a pre-reopen expectedRevision hits
  // command.batch's 'conflict' branch (run 5: symmetric on both platforms).
  assert.match(harness, /expectedRevision: statusAfterReopen\.revision/)
  const reopenStatus = harness.indexOf("gatewayRequest('certification-reopen-status'")
  const mcpBinding = harness.indexOf('expectedRevision: statusAfterReopen.revision')
  assert(reopenStatus !== -1 && mcpBinding !== -1 && reopenStatus < mcpBinding)
  assert.match(harness, /finalStatus\.revision === statusAfterReopen\.revision \+ 1/)
})

test('Windows post-uninstall absence checks ride out the async NSIS cleanup', () => {
  const harness = readFileSync(new URL('../certification/certify-packaged.mjs', import.meta.url), 'utf8')
  // The NSIS uninstaller exits immediately while a %TEMP% copy performs the
  // real cleanup; instantaneous existence checks race its deletion ordering
  // (run 6: the shortcut check failed while everything else was green).
  assert.match(harness, /await waitFor\(\(\) => !existsSync\(installation_\.executable\), 30_000\)/)
  assert.match(harness, /await waitFor\(\(\) => !existsSync\(shortcut\), 30_000\)/)
  assert.match(harness, /label: 'owned PATH cleanup after uninstall'/)
  assert.match(harness, /seedUnownedWindowsPathEntry\(seededWindowsPathEntry\)/)
  assert.match(harness, /label: 'pre-existing unowned PATH entry after uninstall'/)
  assert.match(harness, /removeSeededWindowsPathEntry\(seededWindowsPathEntry\)/)
})

test('Windows unowned PATH fixture writes the bounded user registry value directly', () => {
  const harness = readFileSync(new URL('../certification/certify-packaged.mjs', import.meta.url), 'utf8')
  const fixture = harness.match(
    /async function seedUnownedWindowsPathEntry[\s\S]*?async function runProfileMcp/,
  )?.[0] ?? ''

  assert.match(
    harness,
    /runChecked\('reg\.exe', \[\s*'ADD', 'HKCU\\\\Environment',\s*'\/v', 'Path',\s*'\/t', 'REG_EXPAND_SZ'/,
  )
  assert.doesNotMatch(fixture, /runChecked\('powershell\.exe'/)
  assert.doesNotMatch(fixture, /CliPathEntryOwner/)
})

test('certification harness cannot hang silently: bounded CDP commands, stages, watchdog', () => {
  const harness = readFileSync(new URL('../certification/certify-packaged.mjs', import.meta.url), 'utf8')
  // Run 3's macOS leg hung 44 minutes with no output until the job-level
  // timeout killed it; hosted certification is debugged exclusively from its
  // log, so every await must be deadline-bounded and every stage visible.
  assert.match(harness, /timeoutMs, `CDP \$\{method\}`/)
  assert.match(harness, /EIDO_CERTIFY_STAGE/)
  assert.match(harness, /watchdog/)
})

test('reusable proof freshness names the shipped relay and Profile dependency closure', () => {
  // The relay and the C transport are covered by their directory prefixes
  // rather than by name, so membership is asserted through the rule.
  for (const dependency of [
    'scripts/electron/profile-live-gateway-helper.mjs',
    'scripts/electron/profile-mcp-sea-after-pack.mjs',
    'native/profile-live-gateway/main.c',
    'native/profile-live-gateway/transport.h',
    'native/profile-live-gateway/transport_macos.c',
    'native/profile-live-gateway/transport_windows.c',
    'electron/main.ts',
  ]) assert(isProfileRuntimePath(dependency), dependency)

  for (const dependency of [
    'src/brain/agentRunContract.ts',
    'src/brain/agentRunExecutor.ts',
    'src/brain/agentRunSession.ts',
    'src/brain/chainStaleness.ts',
    'src/brain/contextCompaction.ts',
    'src/brain/executionPlan.ts',
    'src/brain/modelWindows.ts',
    'src/brain/openRouter.ts',
    'src/brain/runEngine.ts',
    'src/brain/runLifecycle.ts',
    'src/desktop/agentRunExecutionAdapter.ts',
    'src/desktop/profileAgentMutationBarrier.ts',
    'src/desktop/profileAgentRunBridgeHandler.ts',
    'src/desktop/profileAgentRunRendererRuntime.ts',
    'src/desktop/profileAgentRunRendererService.ts',
    'src/graph/agentCardPlacement.ts',
    'src/graph/agentSpatialRead.ts',
    'src/graph/cardAuthorship.ts',
    'src/graph/profileLiveAuthorityMerge.ts',
    'src/graph/profileRendererPersistence.ts',
    'src/graph/store.ts',
    'src/main.tsx',
    'src/persistence/profileAgentCommandPlan.ts',
    'src/persistence/profileAgentChangeTrail.ts',
    'src/persistence/profileAgentRunGateway.ts',
    'src/persistence/profileAgentSpatialQuery.ts',
    'src/graph/cardPlacement.ts',
    'src/graph/connectionAddition.ts',
    'src/graph/graphIndex.ts',
    'src/brain/modBlock.ts',
    'src/desktop/packagedProfileProof.ts',
    'src/persistence/profileBuiltInMods.ts',
    'src/ui/cardIdentity.ts',
    'src/graph/cardIdentityPresets.ts',
    'src/mods/card.ts',
    'src/mods/growth.ts',
    'src/mods/identity.ts',
    'src/mods/index.ts',
    'src/mods/model.ts',
    'src/mods/normalizer.ts',
    'src/mods/prompt.ts',
    'src/mods/seeds.ts',
    'src/mods/snapshot.ts',
    'src/brain/sourceContext.ts',
    'src/shared/deepLinks.ts',
  ]) assert(CERTIFICATION_PROFILE_RUNTIME_PATHS.includes(dependency), dependency)

  // cardIdentityPresets.ts was a hole: electron/eidoCliV5.ts and
  // src/persistence/profileAgentCommandPlan.ts both import
  // cardIdentityPresetSolid from it, so its values travel into the packaged
  // CLI and into persisted command plans. It is fingerprinted now.
  for (const importer of ['electron/eidoCliV5.ts', 'src/persistence/profileAgentCommandPlan.ts']) {
    assert.match(
      readFileSync(path.join(repositoryRoot, importer), 'utf8'),
      /cardIdentityPresetSolid/,
      importer,
    )
  }

  // tokenEstimate.ts is NOT presentation. src/brain/compiler.ts,
  // cardContextCompaction.ts and conversationCompaction.ts all import
  // estimateTokens, and those decide what is sent to the model, so a change
  // here changes packaged runtime behaviour. It stays inside the boundary.
  assert(CERTIFICATION_PROFILE_RUNTIME_PATHS.includes('src/shared/tokenEstimate.ts'))
  for (const importer of [
    'src/brain/compiler.ts',
    'src/brain/cardContextCompaction.ts',
    'src/brain/conversationCompaction.ts',
  ]) {
    assert.match(
      readFileSync(path.join(repositoryRoot, importer), 'utf8'),
      /estimateTokens/,
      importer,
    )
  }

  // Presentation-only leaves are deliberately outside the boundary. Nothing
  // under electron/ imports tokens.ts; words.ts reaches native dialogs and the
  // fail-closed startup screen but no packaged-proof assertion; and a parse
  // error in either is caught by typecheck and build long before this gate.
  for (const presentationOnly of ['src/ui/tokens.ts', 'src/shared/words.ts']) {
    assert.equal(isProfileRuntimePath(presentationOnly), false, presentationOnly)
  }
})

test('reusable proof freshness binds only the Profile and Agent Mod dependency closure', () => {
  const expectedModPaths = [
    'src/mods/card.ts',
    'src/mods/growth.ts',
    'src/mods/identity.ts',
    'src/mods/index.ts',
    'src/mods/model.ts',
    'src/mods/normalizer.ts',
    'src/mods/prompt.ts',
    'src/mods/seeds.ts',
    'src/mods/snapshot.ts',
  ]
  assert.deepEqual(
    CERTIFICATION_PROFILE_RUNTIME_PATHS
      .filter((candidate) => candidate.startsWith('src/mods/'))
      .toSorted(),
    expectedModPaths,
  )

  for (const stalePath of [
    'src/brain/applyMods.ts',
    'src/brain/modControlEmitters.ts',
    'src/graph/modLibrary.ts',
    'src/graph/modNormalizer.ts',
  ]) {
    assert.equal(existsSync(path.join(repositoryRoot, stalePath)), false, stalePath)
    assert.equal(CERTIFICATION_PROFILE_RUNTIME_PATHS.includes(stalePath), false, stalePath)
  }

  for (const overbroadPath of [
    'src/mods/commit.ts',
    'src/mods/chrome/contextPopover.tsx',
    'src/mods/chrome/identityWell.tsx',
    'src/mods/chrome/index.ts',
    'src/mods/faces/countFace.ts',
    'src/mods/faces/dialFace.ts',
    'src/mods/faces/families/complex.ts',
    'src/mods/faces/families/options.ts',
    'src/mods/faces/families/rows.ts',
    'src/mods/faces/families/wells.ts',
    'src/mods/faces/filterFace.ts',
    'src/mods/faces/host.ts',
    'src/mods/faces/index.ts',
    'src/mods/faces/inlineEdit.ts',
    'src/mods/faces/matrixFace.ts',
    'src/mods/faces/mixerFace.ts',
    'src/mods/faces/orderFace.ts',
    'src/mods/faces/padFace.ts',
    'src/mods/faces/pointerGesture.ts',
    'src/mods/faces/popoverControls.ts',
    'src/mods/faces/radarFace.ts',
    'src/mods/faces/registry.ts',
    'src/mods/faces/selectFace.ts',
    'src/mods/faces/settings.ts',
    'src/mods/faces/sliderFace.ts',
    'src/mods/faces/switchFace.ts',
    'src/mods/faces/types.ts',
  ]) {
    assert.equal(CERTIFICATION_PROFILE_RUNTIME_PATHS.includes(overbroadPath), false, overbroadPath)
  }
})

test('the proof-reuse ledger is closed: no pull request may hand-append it', () => {
  // The check this replaces compared the fingerprint at HEAD to the last
  // ledger entry, so any pull request touching the runtime tree was blocked
  // until a human hand-wrote a new entry. It fired 37 times and never caught a
  // defect: the same fingerprint is enforced at dispatch, and the tree is
  // proved by the required Native desktop proof gate. The ledger is now a
  // closed historical record, kept only so retained schema-v1 packets keep
  // resolving, and this is what stops it growing again.
  assert.equal(CERTIFICATION_PROOF_REVALIDATIONS.length, 48)
  assert.equal(
    latestCertificationProofRevalidation().revalidatedSourceSha,
    'fa457ac40d80ee2e7f6cc77e5479d0f79a3b4207',
    'CERTIFICATION_PROOF_REVALIDATIONS is closed. Proof reuse is resolved live from the Native desktop '
      + 'proof workflow at dispatch time and recorded in the certification evidence bundle; nothing appends '
      + 'here (see docs/agents/packaged-certification.md)',
  )
  assert(CERTIFICATION_PROOF_REVALIDATIONS.every(({ schemaVersion }) => schemaVersion === 1))

  // Every retained schema-v1 set must still find the entry it was sealed
  // against, which is the only reason the array survives.
  for (const retained of CERTIFICATION_V1_RETAINED_SETS) {
    assert(
      CERTIFICATION_PROOF_REVALIDATIONS.some((entry) => (
        entry.pathSet === retained.proofRevalidation.pathSet
        && entry.revalidatedSourceSha === retained.proofRevalidation.revalidatedSourceSha
        && entry.treeSha256 === retained.proofRevalidation.treeSha256
      )),
      retained.certificationSetId,
    )
  }

  // The gate that replaced the ledger has to be the one CI actually runs.
  const manifest = readFileSync(new URL('../certification/certification-manifest.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(manifest, /append a fresh CERTIFICATION_PROOF_REVALIDATIONS entry/)
  const prepare = readFileSync(new URL('../certification/prepare-certification.mjs', import.meta.url), 'utf8')
  assert.match(prepare, /resolveProofRevalidation/)
  const certify = readFileSync(new URL('../certification/certify-packaged.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(certify, /resolveProofRevalidation/)
  assert.match(certify, /EIDO_CERTIFICATION_REVALIDATION_PATH/)
})

test('finalization ties the sealed proof-reuse claim to the real certified tree', () => {
  // The manifest travels to verifiers that have no source checkout, so this is
  // the last place the claimed tree and the actual tree are both in hand.
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot, encoding: 'utf8' }).trim()
  const treeSha256 = computeProfileRuntimeFingerprint(headSha, { cwd: repositoryRoot })
  const honest = {
    schemaVersion: 2,
    sourceSha: headSha,
    platforms: [{ proofReuse: { treeSha256 } }, { proofReuse: { treeSha256 } }],
  }
  assert.doesNotThrow(() => assertProofReuseMatchesSourceTree(honest, { cwd: repositoryRoot }))

  const lying = structuredClone(honest)
  lying.platforms[1].proofReuse.treeSha256 = digest('9')
  assert.throws(
    () => assertProofReuseMatchesSourceTree(lying, { cwd: repositoryRoot }),
    /Sealed proof reuse claims tree/,
  )

  // Retained schema-v1 sets predate the live record and are left alone.
  assert.doesNotThrow(() => assertProofReuseMatchesSourceTree(
    { ...lying, schemaVersion: 1 },
    { cwd: repositoryRoot },
  ))

  // And the finalizer actually runs it on every set it seals.
  const finalize = readFileSync(new URL('../certification/finalize-certification.mjs', import.meta.url), 'utf8')
  assert.match(
    finalize,
    /const certification = buildCertificationSet\(\{[\s\S]*?\}\)\n(?:\s*\/\/[^\n]*\n)*\s*assertProofReuseMatchesSourceTree\(certification\)/,
  )
})

test('the fingerprint at HEAD is whatever the tree says, and never blocks a pull request', async () => {
  // The live fingerprint is computable and stable, and no file in the
  // repository has to be edited to record what it currently is.
  const actual = computeProfileRuntimeFingerprint('HEAD', { cwd: repositoryRoot })
  assert.match(actual, /^[0-9a-f]{64}$/)
  assert.equal(actual, computeProfileRuntimeFingerprint('HEAD', { cwd: repositoryRoot }))

  // Sensitivity is proved on a throwaway repository rather than on this one's
  // history, because CI checks out shallow and HEAD~1 may not exist there.
  const root = await mkdtemp(path.join(os.tmpdir(), 'eido-fingerprint-'))
  try {
    const git = (...arguments_) => execFileSync('git', arguments_, { cwd: root, encoding: 'utf8' }).trim()
    git('init', '-q', '-b', 'main')
    git('config', 'user.email', 'proof@example.invalid')
    git('config', 'user.name', 'Proof')
    git('config', 'commit.gpgsign', 'false')
    await mkdir(path.join(root, 'electron'), { recursive: true })
    const write = (file, body) => writeFile(path.join(root, file), body, 'utf8')
    const commit = async (message) => {
      git('add', '-A')
      git('commit', '-q', '-m', message)
      return computeProfileRuntimeFingerprint('HEAD', { cwd: root })
    }

    await write('electron/main.ts', 'export const runtime = 1\n')
    await write('electron/main.test.ts', 'test one\n')
    await write('README.md', 'unrelated\n')
    const first = await commit('first')

    await write('electron/main.ts', 'export const runtime = 2\n')
    const moved = await commit('runtime moved')
    assert.notEqual(moved, first, 'a fingerprinted file changed, so the fingerprint must move')

    await write('README.md', 'still unrelated\n')
    await write('electron/main.test.ts', 'test two\n')
    assert.equal(
      await commit('unrelated and test-only churn'),
      moved,
      'unfingerprinted paths and test files must never move the fingerprint',
    )
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('proof-reuse resolution accepts an exact successful workflow dispatch on main', () => {
  const runs = {
    workflow_runs: [
      {
        id: 11,
        name: 'Native desktop proof',
        conclusion: 'success',
        event: 'workflow_dispatch',
        head_branch: 'main',
        head_sha: 'b'.repeat(40),
        run_attempt: 1,
      },
    ],
  }
  const runRequests = []
  const api = (route) => {
    if (route.includes('/runs?')) {
      runRequests.push(route)
      assert.match(route, /event=(?:push|workflow_dispatch)&branch=main&per_page=100$/)
      return route.includes('event=workflow_dispatch') ? runs : { workflow_runs: [] }
    }
    if (route.endsWith('/jobs?per_page=100')) {
      return {
        jobs: NATIVE_DESKTOP_PROOF_GATE_JOBS.map((name, index) => ({
          id: 500 + index,
          name,
          conclusion: 'success',
        })),
      }
    }
    throw new Error(`unexpected route ${route}`)
  }
  const fingerprints = { [sourceSha]: digest('7'), ['b'.repeat(40)]: digest('7') }

  const resolved = resolveProofRevalidation({
    sourceSha,
    repository: 'limweili/eido',
    api,
    ensureCommit: () => {},
    computeFingerprint: (sha) => fingerprints[sha],
  })
  assert.equal(resolved.revalidatedSourceSha, 'b'.repeat(40))
  assert.equal(resolved.evidence.runId, 11)
  assert.equal(resolved.evidence.event, 'workflow_dispatch')
  assert.deepEqual(
    runRequests.map((route) => route.match(/event=([^&]+)/)?.[1]),
    ['push', 'workflow_dispatch'],
  )
})

test('proof-reuse resolution deduplicates and bounds the newest allowed-event window', () => {
  const run = (id, event, headSha, headBranch = 'main') => ({
    id,
    name: 'Native desktop proof',
    conclusion: 'success',
    event,
    head_branch: headBranch,
    head_sha: headSha,
    run_attempt: 1,
  })
  const sha9 = '9'.repeat(40)
  const sha8 = '8'.repeat(40)
  const sha7 = '7'.repeat(40)
  const sha6 = '6'.repeat(40)
  const sourceFingerprint = digest('0')
  const fingerprints = {
    [sourceSha]: sourceFingerprint,
    [sha9]: digest('9'),
    [sha8]: digest('8'),
    [sha7]: sourceFingerprint,
    [sha6]: sourceFingerprint,
  }
  const requestedEvents = []
  const inspected = []
  const api = (route) => {
    if (route.includes('/runs?')) {
      const event = route.match(/event=([^&]+)/)?.[1]
      requestedEvents.push(event)
      assert.match(route, /branch=main&per_page=3$/)
      return event === 'push'
        ? {
            workflow_runs: [
              { ...run(1002, 'push', sha6), conclusion: 'failure' },
              run(9, 'push', sha9),
              run(7, 'push', sha7),
            ],
          }
        : {
            workflow_runs: [
              run(9, 'push', sha9),
              run(8, 'workflow_dispatch', sha8),
              run(6, 'workflow_dispatch', sha6),
              run(1001, 'schedule', sha6),
            ],
          }
    }
    if (route.endsWith('/jobs?per_page=100')) {
      assert.match(route, /\/runs\/7\//)
      return {
        jobs: NATIVE_DESKTOP_PROOF_GATE_JOBS.map((name, index) => ({
          id: 600 + index,
          name,
          conclusion: 'success',
        })),
      }
    }
    throw new Error(`unexpected route ${route}`)
  }

  const resolved = resolveProofRevalidation({
    sourceSha,
    repository: 'limweili/eido',
    api,
    ensureCommit: (sha) => inspected.push(sha),
    computeFingerprint: (sha) => fingerprints[sha],
    window: 3,
  })

  assert.deepEqual(requestedEvents, ['push', 'workflow_dispatch'])
  assert.deepEqual(inspected, [sha9, sha8, sha7])
  assert.equal(resolved.evidence.runId, 7)
})

test('proof-reuse resolution refuses disallowed runs and uncovered trees', () => {
  const runs = {
    workflow_runs: [
      {
        id: 10,
        name: 'Native desktop proof',
        conclusion: 'success',
        event: 'push',
        head_branch: 'main',
        head_sha: 'b'.repeat(40),
        run_attempt: 1,
      },
    ],
  }
  const api = (route) => {
    if (route.includes('/runs?')) return runs
    if (route.endsWith('/jobs?per_page=100')) {
      return {
        jobs: NATIVE_DESKTOP_PROOF_GATE_JOBS.map((name, index) => ({
          id: 500 + index,
          name,
          conclusion: 'success',
        })),
      }
    }
    throw new Error(`unexpected route ${route}`)
  }
  const fingerprints = { [sourceSha]: digest('7'), ['b'.repeat(40)]: digest('7') }
  const ensureCommit = () => {}

  const resolved = resolveProofRevalidation({
    sourceSha,
    repository: 'limweili/eido',
    api,
    ensureCommit,
    computeFingerprint: (sha) => fingerprints[sha],
  })
  assert.equal(resolved.revalidatedSourceSha, 'b'.repeat(40))
  assert.equal(resolved.evidence.runId, 10)
  assert.equal(resolved.treeSha256, digest('7'))

  for (const disallowed of ['pull_request', 'schedule']) {
    assert.throws(
      () => resolveProofRevalidation({
        sourceSha,
        repository: 'limweili/eido',
        api: (route) => (route.includes('/runs?')
          ? { workflow_runs: [{ ...runs.workflow_runs[0], event: disallowed }] }
          : api(route)),
        ensureCommit,
        computeFingerprint: (sha) => fingerprints[sha],
      }),
      /No successful Native desktop proof run on main covers the runtime tree/,
      disallowed,
    )
  }

  assert.throws(
    () => resolveProofRevalidation({
      sourceSha,
      repository: 'limweili/eido',
      api: (route) => (route.includes('/runs?')
        ? { workflow_runs: [{ ...runs.workflow_runs[0], head_branch: 'release' }] }
        : api(route)),
      ensureCommit,
      computeFingerprint: (sha) => fingerprints[sha],
    }),
    /No successful Native desktop proof run on main covers the runtime tree/,
  )

  // The tree moved and no run covers it. This is the admission that must stay
  // at least as strict as the constant it replaced.
  assert.throws(
    () => resolveProofRevalidation({
      sourceSha,
      repository: 'limweili/eido',
      api,
      ensureCommit,
      computeFingerprint: (sha) => (sha === sourceSha ? digest('8') : digest('7')),
    }),
    /No successful Native desktop proof run on main covers the runtime tree/,
  )

  // A run whose native jobs did not both conclude success is not proof.
  assert.throws(
    () => resolveProofRevalidation({
      sourceSha,
      repository: 'limweili/eido',
      api: (route) => (route.includes('/runs?') ? runs : {
        jobs: NATIVE_DESKTOP_PROOF_GATE_JOBS.map((name, index) => ({
          id: 500 + index,
          name,
          conclusion: index === 0 ? 'success' : 'skipped',
        })),
      }),
      ensureCommit,
      computeFingerprint: (sha) => fingerprints[sha],
    }),
    /must record both native gate jobs concluding success/,
  )

  // Resolution is deterministic: the newest run that proved this tree wins.
  const many = {
    workflow_runs: [30, 20, 10].map((id) => ({
      id,
      name: 'Native desktop proof',
      conclusion: 'success',
      event: 'push',
      head_branch: 'main',
      head_sha: 'b'.repeat(40),
      run_attempt: 1,
    })),
  }
  assert.equal(
    resolveProofRevalidation({
      sourceSha,
      repository: 'limweili/eido',
      api: (route) => (route.includes('/runs?')
        ? (route.includes('event=push') ? many : { workflow_runs: [] })
        : api(route)),
      ensureCommit,
      computeFingerprint: (sha) => fingerprints[sha],
    }).evidence.runId,
    30,
  )
})

test('sealed admission stays fixed when a newer equivalent proof appears between phases', () => {
  const run = (id, headSha) => ({
    id,
    name: 'Native desktop proof',
    conclusion: 'success',
    event: 'push',
    head_branch: 'main',
    head_sha: headSha,
    run_attempt: 1,
  })
  const firstProofSha = 'b'.repeat(40)
  const newerProofSha = 'd'.repeat(40)
  const fingerprints = {
    [sourceSha]: provedTreeSha256,
    [firstProofSha]: provedTreeSha256,
    [newerProofSha]: provedTreeSha256,
  }
  let phase = 'prepare'
  let runListCalls = 0
  const api = (route) => {
    if (route.includes('/runs?')) {
      runListCalls += 1
      return {
        workflow_runs: phase === 'prepare'
          ? [run(20, firstProofSha)]
          : [run(30, newerProofSha), run(20, firstProofSha)],
      }
    }
    if (route.endsWith('/jobs?per_page=100')) {
      return {
        jobs: NATIVE_DESKTOP_PROOF_GATE_JOBS.map((name, index) => ({
          id: 700 + index,
          name,
          conclusion: 'success',
        })),
      }
    }
    throw new Error(`unexpected route ${route}`)
  }
  const proofAtAdmission = resolveProofRevalidation({
    sourceSha,
    repository: 'limweili/eido',
    api,
    ensureCommit: () => {},
    computeFingerprint: (sha) => fingerprints[sha],
  })
  assert.equal(proofAtAdmission.evidence.runId, 20)
  assert.equal(runListCalls, 2)

  // A newer equivalent proof is now visible. A re-resolving native leg would
  // select run 30, but the leg receives and validates the sealed run-20 record.
  phase = 'native'
  const liveAfterAdmission = resolveProofRevalidation({
    sourceSha,
    repository: 'limweili/eido',
    api,
    ensureCommit: () => {},
    computeFingerprint: (sha) => fingerprints[sha],
  })
  assert.equal(liveAfterAdmission.evidence.runId, 30)
  assert.equal(runListCalls, 4)

  const preparedNative = createCertificationPreparation({
    sourceSha,
    semver: '1.2.3',
    certificationSetId,
    packageManifest: certificationPackageManifest,
    runtime: certificationRuntime,
    proofRuntime: {
      revalidation: proofAtAdmission,
      computeFingerprint: (sha) => fingerprints[sha],
    },
  })
  assert.equal(preparedNative.proofReuse.evidence.runId, 20)
  assert.equal(runListCalls, 4, 'native preparation must not resolve proof again')
})

test('preparation records the local toolchain identity for each native leg', () => {
  const prepared = createCertificationPreparation({
    sourceSha,
    semver: '1.2.3-alpha.1',
    certificationSetId,
    packageManifest: certificationPackageManifest,
    runtime: certificationRuntime,
  })

  assert.equal(prepared.intent.promotable, true)
  assert.deepEqual(prepared.provenance.toolchain, { node: '24.12.0', npm: '11.6.2' })
  assert.deepEqual(prepared.provenance.targets, [
    { platform: 'darwin', arch: 'arm64', target: 'dmg' },
    { platform: 'win32', arch: 'x64', target: 'nsis' },
  ])
  assert.deepEqual(prepared.provenance.contractVersions, CERTIFICATION_CONTRACT_VERSIONS)
  const anotherNativeLeg = createCertificationPreparation({
    sourceSha,
    semver: '1.2.3-alpha.1',
    certificationSetId,
    packageManifest: certificationPackageManifest,
    runtime: { nodeVersion: '24.21.0', npmVersion: '11.18.0' },
  })
  assert.deepEqual(anotherNativeLeg.intent, prepared.intent)
  assert.deepEqual(anotherNativeLeg.provenance.toolchain, { node: '24.21.0', npm: '11.18.0' })
})

test('preparation refuses incomplete and unsupported runtime identities', () => {
  assert.throws(() => createCertificationPreparation({
    sourceSha,
    semver: '1.2.3',
    certificationSetId,
    packageManifest: certificationPackageManifest,
    runtime: { nodeVersion: '24', npmVersion: '11.6.2' },
  }), /exact Node and npm versions/)
  assert.throws(() => createCertificationPreparation({
    sourceSha,
    semver: '1.2.3',
    certificationSetId,
    packageManifest: certificationPackageManifest,
    runtime: { nodeVersion: '22.0.0', npmVersion: '11.6.2' },
  }), /Unsupported certification toolchain/)
})

test('preparation rejects a legacy set identity before native certification spend', () => {
  assert.throws(() => createCertificationPreparation({
    sourceSha,
    semver: '1.2.3',
    certificationSetId: 'eido-cert-v1-accidental-next-run',
    packageManifest: certificationPackageManifest,
    runtime: certificationRuntime,
  }), /eido-cert-v2-/)
})

test('preparation rejects a tree the resolved proof run did not cover, before the native matrix', () => {
  let inspectedSourceSha
  assert.throws(() => createCertificationPreparation({
    sourceSha,
    semver: '1.2.3',
    certificationSetId,
    packageManifest: certificationPackageManifest,
    runtime: certificationRuntime,
    proofRuntime: {
      revalidation: resolvedProofRevalidation,
      computeFingerprint(candidate) {
        inspectedSourceSha = candidate
        return digest('0')
      },
    },
  }), /Relevant Profile runtime paths do not match the resolved Native desktop proof run/)
  assert.equal(inspectedSourceSha, sourceSha)

  // Admission also refuses a revalidation that is not a real resolved record,
  // so a caller cannot hand-write one to get past the gate.
  const forged = structuredClone(resolvedProofRevalidation)
  forged.evidence.conclusion = 'failure'
  assert.throws(() => createCertificationPreparation({
    sourceSha,
    semver: '1.2.3',
    certificationSetId,
    packageManifest: certificationPackageManifest,
    runtime: certificationRuntime,
    proofRuntime: { revalidation: forged, computeFingerprint: () => provedTreeSha256 },
  }), /does not name a successful Native desktop proof run on main/)

  const workflow = readFileSync(new URL('../../.github/workflows/packaged-certification.yml', import.meta.url), 'utf8')
  for (const job of ['certify-macos', 'certify-windows']) {
    assert.match(workflow, new RegExp(`\\n  ${job}:\\n[\\s\\S]*?\\n    needs: prepare\\n`))
  }
  // Admission resolves the proof run before anything is written, then the
  // native legs consume the exact sealed record from the prepare job.
  assert.match(workflow, /Validate certification admission before native spend/)
  assert.equal(workflow.match(/--revalidation-path/g).length, 3)
  assert.match(workflow, /name: eido-certification-admission-\$\{\{ steps\.identity\.outputs\.certification_set_id \}\}/)
  assert.equal(workflow.match(/--name "eido-certification-admission-\$\{EIDO_CERTIFICATION_SET_ID\}"/g).length, 2)
  assert.equal(workflow.match(/--name "eido-certification-admission-\$\{CERTIFICATION_SET_ID\}"/g).length, 1)
  assert.equal(workflow.match(/GH_TOKEN: \$\{\{ github\.token \}\}/g).length, 9)
  assert.equal(workflow.match(/^ {10}fetch-depth: 0$/gm).length, 4)
})

test('preparation seals the resolved proof run into the packet it prepares', () => {
  const prepared = createCertificationPreparation({
    sourceSha,
    semver: '1.2.3',
    certificationSetId,
    packageManifest: certificationPackageManifest,
    runtime: certificationRuntime,
    proofRuntime: {
      revalidation: resolvedProofRevalidation,
      computeFingerprint(candidate, options) {
        assert.equal(candidate, sourceSha)
        assert.deepEqual(options, { cwd: undefined })
        return provedTreeSha256
      },
    },
  })

  assert.deepEqual(prepared.proofReuse, validateCurrentCertificationProofReuse(sourceSha, {
    revalidation: resolvedProofRevalidation,
    computeFingerprint: () => provedTreeSha256,
  }))
  // The audit answer travels with the build, not with the repository: the run
  // that justified reusing #527 is readable from the sealed packet.
  assert.equal(prepared.proofReuse.evidence.runUrl, resolvedProofRevalidation.evidence.runUrl)
  assert.equal(prepared.proofReuse.providerSourceSha, CERTIFICATION_REUSED_PROOF.darwin.sourceSha)
  assert.deepEqual(
    prepared.proofReuse.evidence.jobs.map(({ name }) => name),
    [...NATIVE_DESKTOP_PROOF_GATE_JOBS],
  )
})
