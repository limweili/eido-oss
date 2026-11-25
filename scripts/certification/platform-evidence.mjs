import { open } from 'node:fs/promises'
import path from 'node:path'

import {
  parseDeveloperIdCodeSignature,
  parseSignedDmgSignature,
} from '../release-signing/macos-identity.mjs'

const LEAN_TOP_LEVEL = Object.freeze(['dist', 'dist-electron', 'node_modules', 'package.json'])
const LEAN_REQUIRED_TOP_LEVEL = Object.freeze(['dist', 'dist-electron', 'package.json'])
const FORBIDDEN_PATH = /(?:^|\/)(?:docs?|research|prototypes?|retros?|adr|agents?|skills?|tests?|__tests__|fixtures?|tooling|scripts?|ci)(?:\/|$)|\.map$/i
const VECTOR_SURFACE = /(?:^|\/)(?:vectors?|embeddings?|models?|schemas?|indexes?)(?:\/|$)|(?:vector|embedding|model|schema|index)[-_.][^/]+\.(?:bin|db|sqlite|onnx|safetensors|json)$/i
const THIRD_PARTY_VECTOR_DIRECTORY = /^node_modules\/(?:@[^/]+\/)?[^/]+\/(?:[^/]+\/)*(?:vectors?|embeddings?|models?|schemas?|indexes?)$/i
const THIRD_PARTY_RUNTIME_SURFACE = /^node_modules\/.+\.(?:cjs|js|mjs|node|json)$/i
const PRIVATE_BASENAME = /(?:^|\/)[^/]*(?:credential|secret)[^/]*$/i
const PRIVATE_OR_SOURCE = /(?:^|\/)(?:\.env(?:\.[^/]*)?|[^/]*(?:credential|secret)[^/]*|[^/]+\.(?:pem|key|p12|pfx|md|markdown|ts|tsx|jsx|scss|less))$/i
const MACH_O_MAGICS = new Set([
  0xfeedface,
  0xcefaedfe,
  0xfeedfacf,
  0xcffaedfe,
  0xcafebabe,
  0xbebafeca,
  0xcafebabf,
  0xbfbafeca,
])

function isThirdPartyVectorDirectory(normalized, entry) {
  if (!THIRD_PARTY_VECTOR_DIRECTORY.test(normalized)) return false
  // Installed inventories carry authoritative entry types. ASAR listings are
  // path-only strings, so the exact structural basename is the narrow
  // directory signal available at that boundary.
  if (entry && typeof entry === 'object' && 'type' in entry) return entry.type === 'directory'
  return path.posix.extname(path.posix.basename(normalized)) === ''
}

function hasForbiddenVectorSurface(normalized, entry) {
  // Dependencies can require runtime JSON or JavaScript from schema-like
  // directories (for example AJV and js-yaml). Keep that narrow exception
  // path-scoped: app-owned surfaces and dependency binary payloads remain
  // rejected by the certification contract.
  return VECTOR_SURFACE.test(normalized)
    && !THIRD_PARTY_RUNTIME_SURFACE.test(normalized)
    && !isThirdPartyVectorDirectory(normalized, entry)
}

function hasForbiddenPrivateOrSource(normalized) {
  // Runtime dependencies can use credential/secret words in implementation
  // filenames (for example jose and prop-types). Keep those names allowed
  // only for root-scoped runtime dependency suffixes; private extensions and
  // .env files remain rejected everywhere, as do app-owned names.
  return PRIVATE_OR_SOURCE.test(normalized)
    && !(THIRD_PARTY_RUNTIME_SURFACE.test(normalized) && PRIVATE_BASENAME.test(normalized))
}

export function assertLeanArtifactInventory(entries) {
  assert(Array.isArray(entries) && entries.length > 0, 'Lean artifact inventory is empty')
  const topLevel = new Set()
  for (const candidate of entries) {
    assert(typeof candidate === 'string' && candidate.startsWith('/'), 'Lean artifact inventory path is invalid')
    const normalized = candidate.replaceAll('\\', '/').replace(/^\/+/, '')
    assert(normalized !== '' && !normalized.includes('/../') && !normalized.startsWith('../'), 'Lean artifact inventory path escapes its root')
    const root = normalized.split('/')[0]
    assert(LEAN_TOP_LEVEL.includes(root), `lean artifact inventory contains non-runtime tree: ${candidate}`)
    assert(!FORBIDDEN_PATH.test(normalized), `lean artifact inventory contains forbidden docs/test/tooling content: ${candidate}`)
    assert(!hasForbiddenVectorSurface(normalized, candidate), `lean artifact inventory contains a vector/model/schema/index surface: ${candidate}`)
    assert(!hasForbiddenPrivateOrSource(normalized), `lean artifact inventory contains credentials, private source, or internal documentation: ${candidate}`)
    topLevel.add(root)
  }
  assert(LEAN_REQUIRED_TOP_LEVEL.every((root) => topLevel.has(root)), 'Lean artifact inventory is missing a required runtime tree')
  return {
    entries: entries.length,
    topLevelTrees: [...topLevel].sort((left, right) => LEAN_TOP_LEVEL.indexOf(left) - LEAN_TOP_LEVEL.indexOf(right)),
  }
}

export function assertInstalledRuntimeInventory(platform, entries) {
  assert((platform === 'darwin' || platform === 'win32') && Array.isArray(entries) && entries.length > 0,
    'installed runtime allowlist input is invalid')
  for (const entry of entries) {
    const candidate = typeof entry === 'string' ? entry : entry?.path
    assert(typeof candidate === 'string' && candidate !== '', 'installed runtime allowlist path is invalid')
    const normalized = candidate.replaceAll('\\', '/').replace(/^\/+/, '')
    assert(!FORBIDDEN_PATH.test(normalized), `installed runtime allowlist contains forbidden content: ${candidate}`)
    assert(!hasForbiddenVectorSurface(normalized, entry), `installed runtime allowlist contains a vector/model/schema/index surface: ${candidate}`)
    assert(!hasForbiddenPrivateOrSource(normalized), `installed runtime allowlist contains credentials, private source, or internal documentation: ${candidate}`)
    if (platform === 'darwin' && normalized === 'Contents/CodeResources') {
      // `xcrun stapler staple Eido.app` writes the app's notarization ticket
      // here as a regular file. It is not the code-signing resource seal at
      // Contents/_CodeSignature/CodeResources, and stapler explicitly refuses
      // a pre-existing symlink at this path. Preserve the inventory shape so
      // admitting the ticket cannot become a broad path-only exception; the
      // later `stapler validate` call remains the authority for ticket bytes.
      assert(
        typeof entry === 'object'
          && entry !== null
          && entry.type === 'file'
          && Number.isSafeInteger(entry.bytes)
          && entry.bytes > 0
          && /^[0-9a-f]{64}$/.test(entry.sha256 ?? ''),
        'Contents/CodeResources must be a regular stapled-ticket file',
      )
    }
    const allowed = platform === 'darwin'
      ? allowedMacRuntimePath(normalized)
      : allowedWindowsRuntimePath(normalized)
    assert(allowed, `installed runtime allowlist rejected unexpected path: ${candidate}`)
  }
  return { entries: entries.length }
}

/**
 * The installed app and its nested executables, as a person's Mac sees them:
 * signed by Eido's Developer ID Application identity, under the hardened
 * runtime, with a secure timestamp. The signature shapes come from the one
 * signing boundary (scripts/release-signing/macos-identity.mjs) so the release
 * lane and the signing smoke cannot drift apart on what "signed" means.
 */
export function parseDeveloperIdSigningPosture(source, identity) {
  try {
    const signature = parseDeveloperIdCodeSignature(source, identity)
    return {
      status: 'developer-id',
      authority: signature.authority,
      teamIdentifier: signature.teamIdentifier,
      cdHash: signature.cdHash,
      hardenedRuntime: 'enabled',
      secureTimestamp: true,
    }
  } catch {
    throw new Error('macOS Developer ID signing posture is invalid')
  }
}

/**
 * The sealed DMG: the exact bytes a person downloads. A disk image carries no
 * hardened runtime, so the guarantees are authority, Team ID, the identifier
 * this lane signed with, and a secure timestamp. Notarization and Gatekeeper
 * are observed separately and folded in by the caller.
 */
export function parseSignedMacDiskImagePosture(source, identity) {
  try {
    const signature = parseSignedDmgSignature(source, identity)
    return {
      status: 'developer-id',
      format: 'dmg',
      identifier: signature.identifier,
      authority: signature.authority,
      teamIdentifier: signature.teamIdentifier,
      cdHash: signature.cdHash,
      secureTimestamp: true,
    }
  } catch {
    throw new Error('macOS sealed DMG signing posture is invalid')
  }
}

/**
 * Gatekeeper's own verdict, which is the question a person's first double-click
 * actually asks. Only a notarized Developer ID source counts: `spctl` also
 * accepts locally trusted and developer-mode sources, and neither of those
 * would hold on someone else's Mac.
 */
export function assertNotarizedGatekeeperAcceptance(output) {
  const text = String(output)
  assert(/:\s*accepted\s*$/m.test(text), 'Gatekeeper rejected the certified artifact')
  assert(
    /^source=Notarized Developer ID\s*$/m.test(text),
    'Gatekeeper accepted the certified artifact from an unexpected source',
  )
  return 'accepted-notarized-developer-id'
}

export function assertMacDeploymentTargetAtOrBelow(source, maximum) {
  const target = /\bminos\s+(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(source)
  const ceiling = /^(\d+)\.(\d+)(?:\.(\d+))?$/.exec(maximum)
  if (!target || !ceiling) {
    throw new Error('macOS deployment target evidence is invalid')
  }
  const targetParts = target.slice(1).map((part) => Number(part ?? 0))
  const ceilingParts = ceiling.slice(1).map((part) => Number(part ?? 0))
  const firstDifference = targetParts.findIndex(
    (part, index) => part !== ceilingParts[index],
  )
  if (firstDifference !== -1
    && targetParts[firstDifference] > ceilingParts[firstDifference]) {
    throw new Error(`macOS deployment target exceeds ${maximum}`)
  }
  return targetParts.join('.')
}

export function isMachOBinaryHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) return false
  const magic = (
    (bytes[0] << 24)
    | (bytes[1] << 16)
    | (bytes[2] << 8)
    | bytes[3]
  ) >>> 0
  return MACH_O_MAGICS.has(magic)
}

export async function enumerateInstalledMachOBinaries(root, entries) {
  assert(path.isAbsolute(root) && Array.isArray(entries), 'Installed macOS inventory is invalid')
  const resolvedRoot = path.resolve(root)
  const binaries = []
  for (const entry of entries) {
    if (entry?.type !== 'file') continue
    assert(typeof entry.path === 'string' && entry.path !== '', 'Installed macOS inventory path is invalid')
    const absolute = path.resolve(resolvedRoot, entry.path)
    const relative = path.relative(resolvedRoot, absolute)
    assert(
      relative !== ''
        && !relative.startsWith(`..${path.sep}`)
        && relative !== '..'
        && !path.isAbsolute(relative),
      'Installed macOS inventory path escapes its root',
    )
    const input = await open(absolute, 'r')
    const header = new Uint8Array(4)
    try {
      const { bytesRead } = await input.read(header, 0, header.byteLength, 0)
      if (isMachOBinaryHeader(header.subarray(0, bytesRead))) {
        binaries.push({ path: entry.path, absolute })
      }
    } finally {
      await input.close()
    }
  }
  return binaries
}

export function assertArm64MacDeploymentEvidence(architectures, loadCommands, maximum) {
  if (typeof architectures !== 'string' || architectures.trim() !== 'arm64') {
    throw new Error('Installed macOS Mach-O is not arm64-only')
  }
  return assertMacDeploymentTargetAtOrBelow(loadCommands, maximum)
}

// Windows stays unsigned by decision (spec #975): Eido does not buy an
// Authenticode certificate, and users accept one SmartScreen warning at first
// install. This parser is the gate that keeps that decision explicit: a
// Windows artifact that suddenly reports a signer fails certification just as
// hard as one that reports a broken signature.
export function parseWindowsAuthenticode(value) {
  if (value?.status !== 'NotSigned'
    || value.signerCertificate !== null
    || value.timeStamperCertificate !== null) {
    throw new Error('Windows NotSigned posture is invalid')
  }
  return {
    status: 'NotSigned',
    publisher: null,
    certificateThumbprint: null,
    timestamp: null,
  }
}

export function assertContainedInstalledSymlink(root, link, target) {
  assert(path.isAbsolute(root) && path.isAbsolute(link), 'Installed symlink paths must be absolute')
  assert(typeof target === 'string' && target.length > 0 && !path.isAbsolute(target), 'Installed symlink target must be relative')
  const relative = path.relative(path.resolve(root), path.resolve(path.dirname(link), target))
  assert(relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative),
    'Installed symlink target escapes the installed runtime')
  return target
}

function allowedMacRuntimePath(value) {
  return value === 'Contents'
    || value === 'Contents/MacOS'
    || value === 'Contents/Resources'
    || value === 'Contents/Frameworks'
    || value === 'Contents/_CodeSignature'
    || /^Contents\/Resources\/[^/]+\.lproj$/.test(value)
    || value === 'Contents/Info.plist'
    || value === 'Contents/PkgInfo'
    || value === 'Contents/MacOS/Eido'
    || value === 'Contents/Resources/app.asar'
    || value === 'Contents/Resources/app-update.yml'
    || value === 'Contents/Resources/certification-provenance.json'
    || value === 'Contents/Resources/bin'
    || value === 'Contents/Resources/bin/eido'
    || value === 'Contents/Resources/bin/eido-profile-live-gateway-helper'
    || value === 'Contents/Resources/THIRD_PARTY_NOTICES.txt'
    || value === 'Contents/Resources/LICENSE'
    || value === 'Contents/Resources/LICENSE.electron.txt'
    || value === 'Contents/Resources/LICENSES.chromium.html'
    || value === 'Contents/Resources/icon.icns'
    || /^Contents\/Resources\/[^/]+\.lproj\/(?:locale\.pak|InfoPlist\.strings)$/.test(value)
    || value.startsWith('Contents/Frameworks/')
    || value === 'Contents/CodeResources'
    || value === 'Contents/_CodeSignature/CodeResources'
}

function allowedWindowsRuntimePath(value) {
  return value === 'locales'
    || value === 'resources'
    || value === 'Eido.exe'
    || value === 'eido-profile-mcp.exe'
    || value === 'Uninstall Eido.exe'
    || value === 'LICENSE.electron.txt'
    || value === 'LICENSES.chromium.html'
    || /^(?:chrome_(?:100|200)_percent\.pak|d3dcompiler_47\.dll|dxcompiler\.dll|dxil\.dll|ffmpeg\.dll|icudtl\.dat|libEGL\.dll|libGLESv2\.dll|resources\.pak|snapshot_blob\.bin|v8_context_snapshot\.bin|vk_swiftshader\.dll|vk_swiftshader_icd\.json|vulkan-1\.dll)$/.test(value)
    || /^locales\/[A-Za-z0-9-]+\.pak$/.test(value)
    || value === 'resources/app.asar'
    || value === 'resources/certification-provenance.json'
    || value === 'resources/bin'
    || value === 'resources/bin/eido.exe'
    || value === 'resources/bin/eido-profile-live-gateway-helper.exe'
    || value === 'resources/THIRD_PARTY_NOTICES.txt'
    || value === 'resources/LICENSE'
}

function assert(condition, message = 'assertion failed') {
  if (!condition) throw new Error(message)
}
