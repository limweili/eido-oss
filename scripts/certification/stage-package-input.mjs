import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  CERTIFICATION_PACKAGE_IDENTITY,
  validateCertificationIntent,
} from './certification-manifest.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const TARGETS = Object.freeze({ darwin: 'arm64', win32: 'x64' })

export function createStagedPackageManifest(sourceManifest, semver) {
  assert.equal(sourceManifest?.name, 'eido', 'Staged package source name is invalid')
  assert.equal(sourceManifest?.main, 'dist-electron/main.cjs', 'Staged package entry point is invalid')
  validateCertificationIntent({
    schemaVersion: 1,
    certificationSetId: 'eido-cert-v2-staging-validation',
    sourceSha: '0000000000000000000000000000000000000000',
    semver,
    promotable: true,
    packageIdentity: CERTIFICATION_PACKAGE_IDENTITY,
  })
  return {
    name: sourceManifest.name,
    version: semver,
    main: sourceManifest.main,
    license: 'GPL-3.0-only',
    dependencies: {},
  }
}

export async function stagePackageInput(env = process.env) {
  const platform = env.EIDO_CERTIFICATION_PLATFORM?.trim()
  const arch = env.EIDO_CERTIFICATION_ARCH?.trim()
  assert.equal(TARGETS[platform], arch, 'Staged package target identity is invalid')
  const intent = validateCertificationIntent({
    schemaVersion: 1,
    certificationSetId: env.EIDO_CERTIFICATION_SET_ID?.trim(),
    sourceSha: env.EIDO_CERTIFICATION_SOURCE_SHA?.trim(),
    semver: env.EIDO_CERTIFICATION_SEMVER?.trim(),
    promotable: true,
    packageIdentity: CERTIFICATION_PACKAGE_IDENTITY,
  })
  const inputRoot = path.join(
    ROOT,
    '.local',
    'packaged-certification',
    intent.certificationSetId,
    `${platform}-${arch}`,
    'input',
  )
  const packageManifest = JSON.parse(await fs.readFile(path.join(ROOT, 'package.json'), 'utf8'))
  const stagedManifest = createStagedPackageManifest(packageManifest, intent.semver)

  await Promise.all([
    fs.access(path.join(ROOT, 'dist')),
    fs.access(path.join(ROOT, 'dist-electron')),
  ])
  await fs.rm(inputRoot, { recursive: true, force: true })
  await fs.mkdir(inputRoot, { recursive: true })
  await Promise.all([
    fs.cp(path.join(ROOT, 'dist'), path.join(inputRoot, 'dist'), { recursive: true }),
    fs.cp(path.join(ROOT, 'dist-electron'), path.join(inputRoot, 'dist-electron'), { recursive: true }),
  ])
  await fs.writeFile(path.join(inputRoot, 'package.json'), `${JSON.stringify(stagedManifest, null, 2)}\n`, {
    flag: 'wx',
  })
  return inputRoot
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const inputRoot = await stagePackageInput()
  process.stdout.write(`${inputRoot}\n`)
}
