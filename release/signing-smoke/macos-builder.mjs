import { execFile } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import addProfileMcpSeaEntry, {
  MAC_STANDALONE_BINARIES,
} from '../../scripts/electron/profile-mcp-sea-after-pack.mjs'
import {
  createDmgSigningArguments as createSharedDmgSigningArguments,
} from '../../scripts/release-signing/macos-identity.mjs'

const MANIFEST = Object.freeze({
  schemaVersion: 1,
  evidenceKind: 'macos-signing-smoke',
  scope: '#469',
  promotable: false,
  platform: 'darwin',
  arch: 'arm64',
  appId: 'dev.eido.signing-smoke.macos',
  productName: 'Eido macOS Signing Smoke',
  version: '0.0.0',
  profileAuthority: Object.freeze({
    state: 'installed',
    dataRoot: 'disposable',
    certification: 'not-certified',
  }),
})

const artifactName = 'eido-macos-signing-smoke-non-promotable-0.0.0-arm64.dmg'
const artifactPath = path.resolve('.local', 'macos-signing-smoke', artifactName)
const dmgIdentifier = `${MANIFEST.appId}.dmg`
const execFileAsync = promisify(execFile)

export function createDmgSigningArguments(identity, keychainFile, dmgPath) {
  if (typeof dmgPath !== 'string' || path.resolve(dmgPath) !== artifactPath) {
    throw new Error('macos-dmg-signing-context-invalid')
  }
  try {
    return createSharedDmgSigningArguments(identity, keychainFile, dmgPath, dmgIdentifier)
  } catch {
    throw new Error('macos-dmg-signing-context-invalid')
  }
}

export async function signMacosSmokeDmg(event, identity, run = execFileAsync) {
  if (event?.target?.name !== 'dmg' || path.resolve(event?.file ?? '') !== artifactPath) {
    throw new Error('macos-dmg-signing-context-invalid')
  }
  const keychainFile = (await event.packager?.codeSigningInfo?.value)?.keychainFile
  const args = createDmgSigningArguments(identity, keychainFile, event.file)
  await run('/usr/bin/codesign', args, { timeout: 60_000, windowsHide: true })
}

export function createMacosSigningSmokeConfig(env = process.env) {
  const expectedAuthority = env.EIDO_MACOS_EXPECTED_AUTHORITY?.trim()
  const expectedTeamId = env.EIDO_MACOS_EXPECTED_TEAM_ID?.trim()
  const runnerTemp = env.RUNNER_TEMP?.replace(/[\\/]+$/, '')
  const authority = /^Developer ID Application: (.+) \(([A-Z0-9]{10})\)$/.exec(expectedAuthority ?? '')
  if (
    !/^[A-Z0-9]{10}$/.test(expectedTeamId ?? '')
    || !runnerTemp
    || !authority
    || authority[1].trim() === ''
    || authority[2] !== expectedTeamId
  ) {
    throw new Error('macos-signing-builder-config-invalid')
  }

  const entitlementsPath = `${runnerTemp}/eido-macos-signing-smoke/entitlements.plist`
  const identityQualifier = `${authority[1]} (${authority[2]})`
  const signingIdentity = { expectedAuthority, expectedTeamId }
  return {
    appId: MANIFEST.appId,
    productName: MANIFEST.productName,
    artifactName: 'eido-macos-signing-smoke-non-promotable-0.0.0-arm64.${ext}',
    afterPack: addProfileMcpSeaEntry,
    artifactBuildCompleted: (event) => signMacosSmokeDmg(event, signingIdentity),
    extraMetadata: {
      version: MANIFEST.version,
    },
    asar: true,
    npmRebuild: false,
    forceCodeSigning: true,
    directories: {
      output: '.local/macos-signing-smoke',
    },
    files: [
      'dist/**/*',
      'dist-electron/**/*',
      'package.json',
      '!**/*.map',
    ],
    extraResources: [
      { from: 'electron/shell-manifest.json', to: 'shell-manifest.json' },
      { from: 'release/signing-smoke/macos-manifest.json', to: 'macos-manifest.json' },
    ],
    mac: {
      identity: identityQualifier,
      binaries: MAC_STANDALONE_BINARIES,
      hardenedRuntime: true,
      notarize: false,
      entitlements: entitlementsPath,
      entitlementsInherit: entitlementsPath,
      target: [{ target: 'dmg', arch: ['arm64'] }],
    },
    dmg: {
      sign: false,
      writeUpdateInfo: false,
    },
    electronFuses: {
      resetAdHocDarwinSignature: true,
      runAsNode: false,
      enableCookieEncryption: false,
      enableNodeOptionsEnvironmentVariable: false,
      enableNodeCliInspectArguments: false,
      enableEmbeddedAsarIntegrityValidation: true,
      onlyLoadAppFromAsar: true,
      loadBrowserProcessSpecificV8Snapshot: false,
      grantFileProtocolExtraPrivileges: false,
    },
  }
}

export default function macosSigningSmokeConfig() {
  return createMacosSigningSmokeConfig(process.env)
}
