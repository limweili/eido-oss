import addProfileMcpSeaEntry from '../../scripts/electron/profile-mcp-sea-after-pack.mjs'

export const windowsSigningSmokeBuildArguments = Object.freeze([
  '--config',
  'release/signing-smoke/windows-builder.mjs',
  '--win',
  'nsis',
  '--x64',
  '--publish',
  'never',
])

export default {
  appId: 'dev.eido.windows-signing-smoke',
  productName: 'Eido Windows Signing Smoke',
  artifactName: 'Eido-Windows-Signing-Smoke-${version}-${arch}.${ext}',
  extraMetadata: {
    version: '0.0.0',
  },
  directories: {
    output: '.local/windows-signing-smoke',
  },
  asar: true,
  afterPack: addProfileMcpSeaEntry,
  npmRebuild: false,
  forceCodeSigning: true,
  files: [
    'dist/**/*',
    'dist-electron/**/*',
    'package.json',
    '!**/*.map',
  ],
  extraResources: [
    {
      from: 'electron/shell-manifest.json',
      to: 'shell-manifest.json',
    },
    {
      from: 'release/signing-smoke/windows-manifest.json',
      to: 'windows-signing-smoke-manifest.json',
    },
  ],
  win: {
    target: [{ target: 'nsis', arch: ['x64'] }],
    requestedExecutionLevel: 'asInvoker',
    signExecutable: true,
    signExts: ['.exe'],
    verifyUpdateCodeSignature: true,
  },
  nsis: {
    include: 'build/eido-path.nsh',
    oneClick: true,
    perMachine: false,
    runAfterFinish: false,
    createDesktopShortcut: false,
    createStartMenuShortcut: true,
    shortcutName: 'Eido Windows Signing Smoke',
    uninstallDisplayName: 'Eido Windows Signing Smoke 0.0.0',
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
