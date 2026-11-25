import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { stagePackageInput } from './stage-package-input.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

export function createPackagingOptions(inputRoot) {
  return {
    projectDir: path.resolve(inputRoot),
    config: path.join(ROOT, 'release', 'packaged', 'production-builder.mjs'),
    publish: 'never',
  }
}

export async function packageCertification(env = process.env) {
  const inputRoot = await stagePackageInput(env)
  const { build } = await import('electron-builder')
  return build(createPackagingOptions(inputRoot))
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await packageCertification()
}
