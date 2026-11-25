import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  buildCertificationSet,
  canonicalJson,
  computeProfileRuntimeFingerprint,
  createCertificationEvidenceReference,
  validatePlatformEvidence,
} from './certification-manifest.mjs'

const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..')

async function runCli(arguments_) {
  const options = readArguments(arguments_)
  const [intent, mac, windows] = await Promise.all([
    readJson(options.intent),
    verifyPlatformPacketFiles(options.mac),
    verifyPlatformPacketFiles(options.windows),
  ])
  const certification = buildCertificationSet({
    intent,
    platformEvidence: [mac, windows],
  })
  // The last place the certified source tree and the sealed claim about it are
  // both in hand. Downstream verifiers read the manifest without a source
  // checkout, so the fingerprint is tied to the real tree here, once.
  assertProofReuseMatchesSourceTree(certification)
  const output = path.resolve(options.output)
  await mkdir(output, { recursive: true })
  const manifestPath = path.join(output, 'certification-manifest.json')
  const manifestBytes = Buffer.from(`${JSON.stringify(certification, null, 2)}\n`, 'utf8')
  const reference = createCertificationEvidenceReference({
    certification,
    manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
    fileName: path.basename(manifestPath),
  })
  await Promise.all([
    writeFile(manifestPath, manifestBytes, { flag: 'wx' }),
    writeFile(
      path.join(output, 'certification-reference.json'),
      `${JSON.stringify(reference, null, 2)}\n`,
      { encoding: 'utf8', flag: 'wx' },
    ),
  ])
  process.stdout.write(`${JSON.stringify(reference)}\n`)
}

export async function verifyPlatformPacketFiles(evidenceLocation) {
  const absoluteEvidence = path.resolve(evidenceLocation)
  const packet = validatePlatformEvidence(await readJson(absoluteEvidence))
  const transcriptPath = path.join(path.dirname(absoluteEvidence), 'journey-transcript.json')
  const artifactPath = path.resolve(path.dirname(absoluteEvidence), '..', 'package', packet.artifact.fileName)
  const [transcriptBytes, artifactMetadata, artifactSha256] = await Promise.all([
    readFile(transcriptPath),
    stat(artifactPath),
    sha256File(artifactPath),
  ])
  const transcript = JSON.parse(transcriptBytes.toString('utf8'))
  const transcriptSha256 = createHash('sha256').update(transcriptBytes).digest('hex')
  assert(
    artifactMetadata.isFile()
      && artifactMetadata.size === packet.artifact.bytes
      && artifactSha256 === packet.artifact.sha256,
    'Downloaded sealed artifact does not match its platform packet',
  )
  assert(transcriptSha256 === packet.evidenceSha256, 'Downloaded journey transcript does not match its platform packet')
  for (const key of ['schemaVersion', 'certificationSetId', 'sourceSha', 'semver', 'platform', 'arch', 'target']) {
    assert(transcript[key] === packet[key], `Journey transcript ${key} does not match its platform packet`)
  }
  assert(canonicalJson(transcript.artifact) === canonicalJson(packet.artifact), 'Journey artifact identity does not match its platform packet')
  if (packet.updateArtifact) {
    const updateArtifactPath = path.resolve(
      path.dirname(absoluteEvidence),
      '..',
      'package',
      packet.updateArtifact.fileName,
    )
    const [updateMetadata, updateSha256, updateSha512] = await Promise.all([
      stat(updateArtifactPath),
      sha256File(updateArtifactPath),
      sha512File(updateArtifactPath),
    ])
    assert(
      updateMetadata.isFile()
        && updateMetadata.size === packet.updateArtifact.bytes
        && updateSha256 === packet.updateArtifact.sha256
        && updateSha512 === packet.updateArtifact.sha512,
      'Downloaded macOS update archive does not match its platform packet',
    )
    assert(
      canonicalJson(transcript.updateArtifact) === canonicalJson(packet.updateArtifact),
      'Journey update archive identity does not match its platform packet',
    )
  }
  assert(
    transcript.installedInventory?.sha256 === packet.installedInventory.sha256
      && transcript.installedInventory?.entries?.length === packet.installedInventory.entries,
    'Journey installed inventory does not match its platform packet',
  )
  for (const key of [
    'artifactSigningPosture',
    'signingPosture',
    'nestedSigningPostures',
    'installedPackageIdentity',
    'executionIdentity',
    'proofReuse',
    'reusedProofReferences',
  ]) {
    assert(canonicalJson(transcript[key]) === canonicalJson(packet[key]), `Journey ${key} does not match its platform packet`)
  }
  assert(
    transcript.journey?.transientDriverListenerClosed === packet.listenerEvidence.transientDriverClosed,
    'Journey listener evidence does not match its platform packet',
  )
  return packet
}

export function assertProofReuseMatchesSourceTree(certification, { cwd = REPOSITORY_ROOT } = {}) {
  if (certification.schemaVersion !== 2) return
  const treeSha256 = computeProfileRuntimeFingerprint(certification.sourceSha, { cwd })
  for (const platform of certification.platforms) {
    assert(
      platform.proofReuse.treeSha256 === treeSha256,
      `Sealed proof reuse claims tree ${platform.proofReuse.treeSha256}, but ${certification.sourceSha} `
        + `fingerprints as ${treeSha256}`,
    )
  }
}

function readArguments(arguments_) {
  const names = ['--intent', '--mac', '--windows', '--output']
  if (arguments_.length !== names.length * 2) throw new Error(`Required arguments: ${names.join(', ')}`)
  const result = {}
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index]
    const value = arguments_[index + 1]
    if (!names.includes(name) || result[name.slice(2)] !== undefined || typeof value !== 'string' || value === '') {
      throw new Error(`Required arguments: ${names.join(', ')}`)
    }
    result[name.slice(2)] = value
  }
  return result
}

async function readJson(location) {
  try {
    return JSON.parse(await readFile(path.resolve(location), 'utf8'))
  } catch (error) {
    throw new Error(`Certification input could not be read: ${error.message}`)
  }
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

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isCli) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
