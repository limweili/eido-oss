import { execFile } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import addProfileMcpSeaEntry, {
  MAC_STANDALONE_BINARIES,
} from '../../scripts/electron/profile-mcp-sea-after-pack.mjs'
import {
  CERTIFICATION_PACKAGE_IDENTITY,
  FULL_SHA,
  validateCertificationIntent,
} from '../../scripts/certification/certification-manifest.mjs'
import {
  assertAcceptedNotarytoolResult,
  createDmgSigningArguments,
  createDmgNotarizationArguments,
  resolveSigningIdentity,
} from '../../scripts/release-signing/macos-identity.mjs'
import {
  MACOS_RELEASE_CREDENTIAL_DIRECTORY,
  productionArtifactName,
  productionDmgIdentifier,
  productionPackageDirectory,
} from '../../scripts/release-signing/macos-release.mjs'

const TARGETS = Object.freeze({
  darwin: Object.freeze({ arch: 'arm64', target: 'dmg' }),
  win32: Object.freeze({ arch: 'x64', target: 'nsis' }),
})
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const execFileAsync = promisify(execFile)

/**
 * Sign the finished DMG with the identity Electron Builder just used for the
 * app, while its temporary keychain is still open.
 *
 * Electron Builder's own `dmg.sign` shortcut stays off: it is incomplete, and
 * it is the outer disk image, the exact bytes a person downloads, that
 * Gatekeeper assesses on first open. This is the signing smoke's proven hook,
 * bound to the production output directory instead of the smoke's fixed path.
 */
export async function signProductionDmg(event, context, run = execFileAsync) {
  const file = typeof event?.file === 'string' ? path.resolve(event.file) : ''
  if (event?.target?.name !== 'dmg' || file !== context.expectedDmgPath) {
    throw new Error('macos-dmg-signing-context-invalid')
  }
  const keychainFile = (await event.packager?.codeSigningInfo?.value)?.keychainFile
  const args = createDmgSigningArguments(
    context.identity,
    keychainFile,
    file,
    context.dmgIdentifier,
  )
  await run('/usr/bin/codesign', args, { timeout: 60_000, windowsHide: true })
}

export async function notarizeAndStapleProductionApp(context, run = execFileAsync) {
  const appPath = path.join(context.appOutDir, 'Eido.app')
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'eido-app-notarization-'))
  const archivePath = path.join(temporaryRoot, 'Eido.app.zip')
  try {
    await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', appPath, archivePath], {
      timeout: 10 * 60_000,
      windowsHide: true,
    })
    const submission = await run('/usr/bin/xcrun', createDmgNotarizationArguments(
      context.identity,
      archivePath,
    ), { timeout: 150 * 60_000, windowsHide: true })
    assertAcceptedNotarytoolResult(submission.stdout)
    await run('/usr/bin/xcrun', ['stapler', 'staple', appPath], { timeout: 60_000, windowsHide: true })
    await run('/usr/bin/xcrun', ['stapler', 'validate', appPath], { timeout: 60_000, windowsHide: true })
    await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', appPath], { timeout: 60_000, windowsHide: true })
    // electron-builder's ZIP target uses `/usr/bin/zip`, which drops the
    // extended attributes carrying the stapled notarization ticket. Create
    // the Squirrel archive from the final stapled app with Apple's archive
    // utility instead. Certification later extracts and validates this exact
    // archive, and compares its app tree with the DMG payload.
    await rm(context.updateZipPath, { force: true })
    await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', appPath, context.updateZipPath], {
      timeout: 10 * 60_000,
      windowsHide: true,
    })
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

export function createProductionPackagingConfig(env = process.env) {
  const platform = env.EIDO_CERTIFICATION_PLATFORM?.trim()
  const arch = env.EIDO_CERTIFICATION_ARCH?.trim()
  const target = TARGETS[platform]
  if (!target || target.arch !== arch) {
    throw new Error('Production certification target identity is invalid')
  }
  const intent = validateCertificationIntent({
    schemaVersion: 1,
    certificationSetId: env.EIDO_CERTIFICATION_SET_ID?.trim(),
    sourceSha: env.EIDO_CERTIFICATION_SOURCE_SHA?.trim(),
    semver: env.EIDO_CERTIFICATION_SEMVER?.trim(),
    promotable: true,
    packageIdentity: CERTIFICATION_PACKAGE_IDENTITY,
  })
  if (!FULL_SHA.test(intent.sourceSha)) {
    throw new Error('Production certification source SHA is invalid')
  }
  const provenancePath = env.EIDO_CERTIFICATION_PROVENANCE_PATH?.trim()
  if (!provenancePath || !path.isAbsolute(provenancePath)) {
    throw new Error('Production certification provenance path must be absolute')
  }
  const outputDirectory = productionPackageDirectory(intent.certificationSetId, platform, arch)
  const signing = platform === 'darwin' ? macSigning(env, intent, outputDirectory) : null

  return {
    appId: CERTIFICATION_PACKAGE_IDENTITY.appId,
    productName: CERTIFICATION_PACKAGE_IDENTITY.productName,
    artifactName: 'Eido-${version}-${arch}.${ext}',
    extraMetadata: { version: intent.semver },
    directories: {
      output: outputDirectory,
    },
    asar: true,
    npmRebuild: false,
    // macOS is signed with Eido's Developer ID; Windows is deliberately not.
    // `forceCodeSigning` makes the macOS leg fail the build rather than quietly
    // emit an unsigned artifact if the identity cannot be used.
    forceCodeSigning: platform === 'darwin',
    afterPack: addProfileMcpSeaEntry,
    ...(signing ? { artifactBuildCompleted: signing.artifactBuildCompleted } : {}),
    ...(signing ? { afterSign: signing.afterSign } : {}),
    ...(signing ? { afterAllArtifactBuild: signing.afterAllArtifactBuild } : {}),
    files: [
      'dist/**/*',
      'dist-electron/**/*',
      'package.json',
      // Electron Builder's dependency collector copies nested package files
      // separately from the app tree; keep third-party internal docs out too.
      // Character classes mirror certification's case-insensitive private
      // content policy because Electron Builder's globs are case-sensitive.
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
      // Dependency packages may require schema-like runtime JavaScript and
      // JSON; exclude only the binary vector surfaces certification rejects.
      '!**/{[vV][eE][cC][tT][oO][rR],[vV][eE][cC][tT][oO][rR][sS],[eE][mM][bB][eE][dD][dD][iI][nN][gG],[eE][mM][bB][eE][dD][dD][iI][nN][gG][sS],[mM][oO][dD][eE][lL],[mM][oO][dD][eE][lL][sS],[sS][cC][hH][eE][mM][aA],[sS][cC][hH][eE][mM][aA][sS],[iI][nN][dD][eE][xX],[iI][nN][dD][eE][xX][eE][sS]}/**/*.{[bB][iI][nN],[dD][bB],[sS][qQ][lL][iI][tT][eE],[oO][nN][nN][xX],[sS][aA][fF][eE][tT][eE][nN][sS][oO][rR][sS]}',
      '!**/*{[vV][eE][cC][tT][oO][rR],[eE][mM][bB][eE][dD][dD][iI][nN][gG],[mM][oO][dD][eE][lL],[sS][cC][hH][eE][mM][aA],[iI][nN][dD][eE][xX]}[-_.]*.{[bB][iI][nN],[dD][bB],[sS][qQ][lL][iI][tT][eE],[oO][nN][nN][xX],[sS][aA][fF][eE][tT][eE][nN][sS][oO][rR][sS]}',
    ],
    extraResources: [
      {
        from: path.resolve(provenancePath),
        to: 'certification-provenance.json',
      },
      {
        from: path.join(ROOT, 'release', 'packaged', 'THIRD_PARTY_NOTICES.txt'),
        to: 'THIRD_PARTY_NOTICES.txt',
      },
      {
        from: path.join(ROOT, 'LICENSE'),
        to: 'LICENSE',
      },
      ...(platform === 'darwin' ? [{
        // electron-updater reads this before its wrapper cache can be created.
        // Keep it packaging-owned and deterministic; runtime setFeedURL then
        // pins the same generic origin for the current process.
        from: path.join(ROOT, 'release', 'packaged', 'app-update.yml'),
        to: 'app-update.yml',
      }] : []),
    ],
    mac: {
      // The app, its framework, and both standalone binaries are signed with
      // the Developer ID Application identity under the hardened runtime, which
      // is what lets a person open Eido without the unidentified-developer
      // warning and what makes Apple's notary service accept the result.
      identity: signing?.identityQualifier ?? null,
      binaries: MAC_STANDALONE_BINARIES,
      hardenedRuntime: platform === 'darwin',
      entitlements: signing?.entitlementsPath,
      entitlementsInherit: signing?.entitlementsPath,
      // afterSign notarizes and staples Eido.app before the DMG is made, and
      // recreates the Squirrel ZIP with ditto from that same final app tree.
      // The outer DMG is independently notarized and stapled afterwards.
      notarize: false,
      minimumSystemVersion: '13.5.0',
      target: [{ target: 'dmg', arch: ['arm64'] }],
      icon: path.join(ROOT, 'release', 'packaged', 'icons', 'icon.icns'),
    },
    dmg: {
      // Signed by `artifactBuildCompleted` above, not by this incomplete
      // built-in shortcut. Update metadata stays off so signing cannot stale a
      // precomputed blockmap.
      sign: false,
      writeUpdateInfo: false,
      // The opened volume holds Eido.app and the Applications link, and
      // nothing else a person can see. Left to its defaults, Electron Builder
      // copies a stock window background and the app icon into the volume
      // root as `.background.tiff` and `.VolumeIcon.icns`, and those are the
      // two files people found sitting next to the app.
      //
      // `icon: null` is the documented opt out of the volume icon; the cost
      // is the generic disk icon on the mounted volume. The background has to
      // be a colour, not a null: `background: null` still falls through to the
      // stock image, and dmgbuild writes any background *image* into the
      // volume as a file. That is also why the painted drag arrow cannot be
      // kept, since `builtin-arrow` lands as `.background.tiff` exactly like a
      // custom image would. White is the only choice Electron Builder offers
      // here, and it is a shade off the near-white the stock image already
      // painted.
      //
      // Layout is unchanged: the same 540x380 window, the app on the left at
      // (130, 220) and Applications on the right at (410, 220), so the drag
      // still reads without the artwork. `.DS_Store` stays, because it is what
      // carries that layout and Finder never lists it.
      icon: null,
      backgroundColor: '#ffffff',
      window: { width: 540, height: 380 },
    },
    win: {
      // Windows artifacts ship unsigned by decision, not by omission: Eido does
      // not buy an Authenticode certificate, and users accept one SmartScreen
      // warning at first install (spec #975, "Out of Scope"). The Windows leg
      // therefore keeps `cscLink: ''` and `forceCodeSigning: false` so no
      // ambient certificate in the environment can be picked up silently.
      ...(platform === 'darwin' ? {} : { cscLink: '' }),
      target: [{ target: 'nsis', arch: ['x64'] }],
      requestedExecutionLevel: 'asInvoker',
      signExecutable: false,
      signExts: ['.exe'],
      verifyUpdateCodeSignature: false,
      icon: path.join(ROOT, 'release', 'packaged', 'icons', 'icon.ico'),
    },
    nsis: {
      include: path.join(ROOT, 'build', 'eido-path.nsh'),
      oneClick: true,
      perMachine: false,
      runAfterFinish: false,
      createDesktopShortcut: false,
      createStartMenuShortcut: true,
      shortcutName: 'Eido',
      uninstallDisplayName: `Eido ${intent.semver}`,
      deleteAppDataOnUninstall: false,
      packElevateHelper: false,
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

/**
 * The macOS signing half of the production config. Fails closed: with no
 * identity in the environment this throws, so a macOS release cannot be built
 * unsigned by accident.
 */
function macSigning(env, intent, outputDirectory) {
  const identity = resolveSigningIdentity(env, {
    credentialDirectoryName: MACOS_RELEASE_CREDENTIAL_DIRECTORY,
    // afterSign notarizes the app before constructing its DMG and updater ZIP,
    // so this packaging process needs the explicit notary identity too.
    requireNotarizationIdentity: true,
  })
  const context = {
    identity,
    dmgIdentifier: productionDmgIdentifier(),
    expectedDmgPath: path.join(
      outputDirectory,
      productionArtifactName(intent.semver, 'arm64', 'dmg'),
    ),
    expectedZipPath: path.join(
      outputDirectory,
      productionArtifactName(intent.semver, 'arm64', 'zip'),
    ),
  }
  return {
    identityQualifier: identity.identityQualifier,
    entitlementsPath: identity.entitlementsPath,
    artifactBuildCompleted: (event) => signProductionDmg(event, context),
    afterSign: (event) => notarizeAndStapleProductionApp({
      identity,
      appOutDir: event.appOutDir,
      updateZipPath: context.expectedZipPath,
    }),
    afterAllArtifactBuild: () => [context.expectedZipPath],
  }
}

export default function productionPackagingConfig() {
  return createProductionPackagingConfig(process.env)
}
