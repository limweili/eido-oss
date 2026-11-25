import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CERTIFICATION_CONTRACT_VERSIONS,
  CERTIFICATION_PACKAGE_IDENTITY,
  validateCertificationIntent,
  validateCurrentCertificationProofReuse,
} from './certification-manifest.mjs'
import {
  detectRuntimeToolchain,
  inspectDeclaredToolchain,
  inspectRuntimeToolchain,
} from '../ci/toolchain-policy.mjs'
import { resolveProofRevalidation } from './proof-revalidation.mjs'

const EXACT_VERSION = /^\d+\.\d+\.\d+$/
const REPOSITORY_ROOT = path.resolve(import.meta.dirname, '..', '..')

export function createCertificationPreparation({
  sourceSha,
  semver,
  certificationSetId,
  packageManifest,
  runtime,
  proofRuntime,
}) {
  const intent = validateCertificationIntent({
    schemaVersion: 1,
    certificationSetId,
    sourceSha,
    semver,
    promotable: true,
    packageIdentity: CERTIFICATION_PACKAGE_IDENTITY,
  })
  const { nodeVersion: node, npmVersion: npm } = runtime ?? {}
  if (typeof node !== 'string' || !EXACT_VERSION.test(node)
    || typeof npm !== 'string' || !EXACT_VERSION.test(npm)) {
    throw new Error('Certification requires exact Node and npm versions from the running toolchain')
  }
  const declared = inspectDeclaredToolchain(packageManifest)
  const issues = [
    ...declared.issues,
    ...(declared.toolchain ? inspectRuntimeToolchain(runtime, declared.toolchain) : []),
  ]
  if (issues.length > 0) {
    throw new Error(`Unsupported certification toolchain. ${issues.join(' ')}`)
  }
  const proofReuse = proofRuntime === undefined
    ? undefined
    : validateCurrentCertificationProofReuse(intent.sourceSha, proofRuntime)
  return Object.freeze({
    intent,
    proofReuse,
    provenance: deepFreeze({
      schemaVersion: 1,
      kind: 'eido-packaged-certification-provenance',
      certificationSetId: intent.certificationSetId,
      sourceSha: intent.sourceSha,
      semver: intent.semver,
      promotable: true,
      packageIdentity: CERTIFICATION_PACKAGE_IDENTITY,
      targets: [
        { platform: 'darwin', arch: 'arm64', target: 'dmg' },
        { platform: 'win32', arch: 'x64', target: 'nsis' },
      ],
      toolchain: { node, npm },
      contractVersions: CERTIFICATION_CONTRACT_VERSIONS,
    }),
  })
}

async function runCli(arguments_) {
  const options = readArguments(arguments_, [
    '--source-sha',
    '--semver',
    '--certification-set-id',
    '--output',
  ], ['--revalidation-path'])
  const packageManifest = JSON.parse(await readFile(
    new URL('../../package.json', import.meta.url),
    'utf8',
  ))
  // Admission order matters: resolving the proof revalidation is the step that
  // refuses to spend native minutes on a runtime tree no authoritative
  // two-platform proof covers, so it runs before anything is written.
  const revalidation = options['revalidation-path'] === undefined
    ? resolveProofRevalidation({
      sourceSha: options['source-sha'],
      cwd: REPOSITORY_ROOT,
    })
    : await readJson(options['revalidation-path'], 'certification revalidation')
  const prepared = createCertificationPreparation({
    sourceSha: options['source-sha'],
    semver: options.semver,
    certificationSetId: options['certification-set-id'],
    packageManifest,
    runtime: detectRuntimeToolchain(),
    proofRuntime: { cwd: REPOSITORY_ROOT, revalidation },
  })
  const output = path.resolve(options.output)
  await mkdir(output, { recursive: true })
  await Promise.all([
    writeJsonExclusive(path.join(output, 'certification-intent.json'), prepared.intent),
    writeJsonExclusive(path.join(output, 'certification-provenance.json'), prepared.provenance),
    writeJsonExclusive(path.join(output, 'certification-revalidation.json'), prepared.proofReuse),
  ])
  process.stdout.write(`${JSON.stringify({
    certificationSetId: prepared.intent.certificationSetId,
    intent: path.join(output, 'certification-intent.json'),
    provenance: path.join(output, 'certification-provenance.json'),
    revalidation: path.join(output, 'certification-revalidation.json'),
    proofRunUrl: prepared.proofReuse.evidence.runUrl,
  })}\n`)
}

function readArguments(arguments_, requiredNames, optionalNames = []) {
  const names = [...requiredNames, ...optionalNames]
  if (arguments_.length % 2 !== 0) throw new Error(`Required arguments: ${requiredNames.join(', ')}`)
  const result = {}
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index]
    const value = arguments_[index + 1]
    if (!names.includes(name) || result[name.slice(2)] !== undefined || typeof value !== 'string' || value === '') {
      throw new Error(`Required arguments: ${requiredNames.join(', ')}`)
    }
    result[name.slice(2)] = value
  }
  if (requiredNames.some((name) => result[name.slice(2)] === undefined)) {
    throw new Error(`Required arguments: ${requiredNames.join(', ')}`)
  }
  return result
}

async function readJson(location, description) {
  try {
    return JSON.parse(await readFile(path.resolve(location), 'utf8'))
  } catch (error) {
    throw new Error(`${description} could not be read: ${error.message}`)
  }
}

async function writeJsonExclusive(location, value) {
  await writeFile(location, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' })
}

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])
if (isCli) {
  runCli(process.argv.slice(2)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
