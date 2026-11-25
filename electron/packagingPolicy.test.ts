import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repositoryRoot = path.resolve(import.meta.dirname, '..')

async function readJson(relativePath: string): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), 'utf8')) as Record<string, unknown>
}

const PROOF_SIGNING_REQUIREMENTS = [
  { name: 'ambient certificate suppression', pattern: /(?:^|\n)cscLink: ''\r?$/m },
  { name: 'non-release signing policy', pattern: /(?:^|\n)forceCodeSigning: false\r?$/m },
  { name: 'macOS identity suppression', pattern: /(?:^|\n)mac:\r?\n  identity: null\r?$/m },
  { name: 'Windows executable signing suppression', pattern: /(?:^|\n)win:\r?\n  signExecutable: false\r?$/m },
  { name: 'Apple Silicon ad-hoc reset', pattern: /(?:^|\n)  resetAdHocDarwinSignature: true\r?$/m },
] as const

function assertProofSigningConfig(builderConfig: string) {
  for (const requirement of PROOF_SIGNING_REQUIREMENTS) {
    if (!requirement.pattern.test(builderConfig)) {
      throw new Error(`Electron proof signing policy lost ${requirement.name}`)
    }
  }
}

describe('non-promotable installed Profile package policy', () => {
  it('pins desktop command routing, the approved toolchain, and packaged Profile utility proof', async () => {
    const packageJson = await readJson('package.json')
    const devDependencies = packageJson.devDependencies as Record<string, string>
    const scripts = packageJson.scripts as Record<string, string>

    expect(packageJson.main).toBe('dist-electron/main.cjs')
    expect(devDependencies.electron).toBe('43.8.3')
    expect(devDependencies['electron-builder']).toBe('26.18.0')
    expect(devDependencies['@electron/fuses']).toBe('2.1.3')
    expect(scripts.start).toBe('npm run ci:runtime --silent && npm run desktop')
    expect(scripts.dev).toBe('npm run ci:runtime --silent && vite')
    expect(scripts.desktop).toBe(
      'npm run ci:runtime --silent && npm run build -- --mode desktop-proof && npm run build:electron && electron .',
    )
    expect(scripts['release:package']).toBe(
      'npm run ci:runtime --silent && npm run build -- --mode desktop-proof && npm run build:electron && node scripts/certification/package-certification.mjs',
    )
    expect(scripts.build).toBe(
      'npm run ci:runtime --silent && tsc -b && vite build',
    )
    expect(scripts.build).not.toContain('desktop-proof')
    expect(scripts['build:electron']).toContain('npm run ci:runtime --silent')
    expect(scripts['build:electron']).toContain('--mode profile-utility')
    expect(scripts['desktop:package:dir']).toContain('vite build --mode desktop-proof')
    expect(scripts['desktop:package:dir']).toContain('electron-builder --dir --publish never')
    expect(scripts['desktop:smoke']).toBe(
      'npm run ci:runtime --silent && npm run desktop:package:dir && node scripts/electron/packaged-smoke.mjs',
    )
    expect(Object.keys(scripts).filter((name) => name === 'desktop' || name.startsWith('desktop:'))).toEqual([
      'desktop',
      'desktop:package:dir',
      'desktop:smoke',
    ])
  })

  it('marks the non-promotable issue-465 Profile authority as installed', async () => {
    expect(await readJson('electron/shell-manifest.json')).toEqual({
      schemaVersion: 1,
      scope: '#465',
      promotable: false,
      profileAuthority: 'installed',
    })
  })

  it('keeps the ASAR, fuse, signing, and proof-artifact boundaries', async () => {
    const builderConfig = await readFile(path.join(repositoryRoot, 'electron-builder.yml'), 'utf8')
    const packagedSmoke = await readFile(path.join(repositoryRoot, 'scripts/electron/packaged-smoke.mjs'), 'utf8')

    expect(builderConfig).toContain('asar: true')
    expect(builderConfig).toContain('- dist-electron/**/*')
    expect(builderConfig).not.toContain('from: scripts/eido/eido')
    expect(builderConfig).not.toContain('to: bin/eido')
    expect(() => assertProofSigningConfig(builderConfig)).not.toThrow()
    expect(builderConfig).toContain("'!**/*.map'")
    expect(builderConfig).not.toContain('sqlite-proof-manifest')
    expect(builderConfig).toContain('runAsNode: false')
    expect(builderConfig).toContain('enableCookieEncryption: false')
    expect(builderConfig).toContain('enableNodeOptionsEnvironmentVariable: false')
    expect(builderConfig).toContain('enableNodeCliInspectArguments: false')
    expect(builderConfig).toContain('enableEmbeddedAsarIntegrityValidation: true')
    expect(builderConfig).toContain('onlyLoadAppFromAsar: true')
    expect(builderConfig).toContain('grantFileProtocolExtraPrivileges: false')
    expect(builderConfig).not.toMatch(/(?:^|\n)publish:/)
    expect(builderConfig).not.toMatch(/(?:^|\n)(?:nsis|dmg|mas|appx):/)
    expect(builderConfig).not.toContain('signAndEditExecutable')

    expect(packagedSmoke).toContain("'/dist-electron/profile-utility.cjs'")
    expect(packagedSmoke).toContain('assertProofSigningBoundary(executable)')
    expect(packagedSmoke).toContain("scope: 'main-executable'")
    expect(packagedSmoke).toContain('inspectUnsignedWindowsExecutable(executable')
    expect(packagedSmoke).toContain("output.includes('Signature=adhoc')")
    expect(packagedSmoke).toContain("output.includes('TeamIdentifier=not set')")
    expect(packagedSmoke).toContain('provePackagedEidoPathCommand(outputRoot)')
    expect(packagedSmoke).toContain('eidoPathCommand,')
    expect(packagedSmoke).toContain("path.join(outputRoot, 'proof-evidence.json')")
    expect(packagedSmoke).not.toContain('sqlite-proof-evidence.json')
  })

  it('wires Windows PATH ownership into production packaging and native lifecycle proof', async () => {
    const [builder, certification] = await Promise.all([
      readFile(path.join(repositoryRoot, 'release/packaged/production-builder.mjs'), 'utf8'),
      readFile(path.join(repositoryRoot, 'scripts/certification/certify-packaged.mjs'), 'utf8'),
    ])

    expect(builder).toContain("include: path.join(ROOT, 'build', 'eido-path.nsh')")
    expect(certification).toContain('seedUnownedWindowsPathEntry(seededWindowsPathEntry)')
    expect(certification).toContain("label: 'owned PATH cleanup after uninstall'")
    expect(certification).toContain("label: 'pre-existing unowned PATH entry after uninstall'")
  })

  it('fails closed when any proof signing guard drifts', async () => {
    const builderConfig = await readFile(path.join(repositoryRoot, 'electron-builder.yml'), 'utf8')

    for (const requirement of PROOF_SIGNING_REQUIREMENTS) {
      const mutated = builderConfig.replace(requirement.pattern, '\n# signing guard removed')
      expect(mutated, requirement.name).not.toBe(builderConfig)
      expect(
        () => assertProofSigningConfig(mutated),
        requirement.name,
      ).toThrow(requirement.name)
    }
  })

  it('keeps Node-bearing Electron declarations out of the root renderer type program', async () => {
    const rootTsconfig = await readJson('tsconfig.json')
    const electronTsconfig = await readJson('tsconfig.electron.json')
    const rootOptions = rootTsconfig.compilerOptions as Record<string, unknown>
    const electronOptions = electronTsconfig.compilerOptions as Record<string, unknown>
    const boundary = await readFile(
      path.join(repositoryRoot, 'src/types/electron-browser-boundary.d.ts'),
      'utf8',
    )
    expect(rootOptions.types).toEqual([])
    expect(rootOptions.paths).toEqual({
      electron: ['./src/types/electron-browser-boundary.d.ts'],
    })
    expect(electronOptions.types).toEqual(['node', 'vite/client', 'vitest/globals'])
    expect(boundary).toContain('export {}')
  })
})
