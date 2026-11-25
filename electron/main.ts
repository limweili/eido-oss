import { randomUUID } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  fstatSync,
  mkdirSync,
  read as readFileDescriptor,
  realpathSync,
} from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Readable, Writable } from 'node:stream'
import {
  PROFILE_REVIEW_POLICY_PARAMETER,
  PROFILE_REVIEW_POLICY_VERSION,
} from '../src/shared/profileReviewPolicy'
import { words } from '../src/shared/words'
import { createProfileGatewaySession } from '../src/persistence/profileAgentGateway'
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  protocol,
  // The app's only OS-protected-storage import, and the only place the API is
  // named. Every store that uses it is handed `protectedStorage` below, so the
  // consumers can be counted in one place rather than found by grep.
  // `electron/keychainNoPasswordPolicy.test.ts` pins both facts.
  safeStorage,
  session,
  shell,
  utilityProcess,
} from 'electron'
import { installMacosEidoCommand } from './eidoCommandInstaller'
import { createDesktopLaunchIntentDispatcher } from './desktopLaunchIntent'
import {
  createInstalledKeychainMainSession,
  type InstalledKeychainMainSession,
} from './installedKeychainMainSession'
import { KEYCHAIN_BRIDGE_CHANNEL } from './keychainBridgeContract'
import {
  AI_HARNESS_BRIDGE_CHANNEL,
} from './aiHarnessBridgeContract'
import {
  createInstalledAiHarnessMainSession,
  type InstalledAiHarnessMainSession,
} from './aiHarnessMainSession'
import { createLocalCredentialStore, removeRetiredSearchCredential } from './localCredentialStore'
import {
  createReadOnlyCredentialStore,
  resolveProfileCredentialInstallation,
  type ProfileCredentialInstallation,
} from './profileCredentialInstallation'
import type { InstalledProfileHost } from './installedProfileHost'
import { planEidoCliIdentity, runEidoCli, type EidoCliRawIo } from './eidoCli'
import {
  createInstalledProfileMainSession,
  type InstalledProfileMainSession,
} from './installedProfileMainSession'
import {
  createInstalledProfileSessionFactory,
} from './installedProfileSession'
import { acquireInstalledProfileSingleInstance } from './installedProfileSingleInstance'
import {
  PROFILE_BRIDGE_CHANNEL,
} from './profileBridgeContract'
import {
  startProfileLiveGatewayServer,
} from './profileLiveGatewayServer'
import { createInstalledProfileLiveGatewayLifecycle } from './installedProfileLiveGatewayLifecycle'
import {
  finishProfileJsonCliPreflightFailure,
  PROFILE_JSON_CLI_EXIT_CODES,
  runProfileJsonCli,
  type ProfileJsonCliWriter,
} from './profileJsonCli'
import {
  resolveProfileInstallation,
  type ProfileInstallation,
} from './profileInstallation'
import {
  requireProfileProofId,
  resolveProfileAuxiliaryLaunch,
  type ProfileProofRequest,
} from './profileAuxiliaryLaunch'
import {
  resolveProfileLaunchMode,
  type ProfileLaunchMode,
} from './profileLaunchMode'
import { runProfileMcpStdio } from './profileMcpStdio'
import { requestRendererProfileCheckpoint } from './profileRendererCheckpoint'
import { requestRendererProfileAgentBarrier } from './profileRendererAgentBarrier'
import {
  createProfileAgentRunRendererBroker,
  type ProfileAgentRunRendererBroker,
} from './profileAgentRunRendererBroker'
import { createProfileAgentRunLiveService } from './profileAgentRunLiveService'
import { createInstalledProfileSaveIdentity } from './profileSaveIdentity'
import { createEidoProtocolHandler, EIDO_CONNECT_SRC, isEidoProviderRequest } from './protocol'
import { createWindowSecurityPolicy, isTrustedAppUrl } from './security'
import { createSecureWebPreferences, EIDO_APP_URL, registerEidoScheme } from './shellPolicy'
import {
  createInstalledLinkPreviewMainSession,
  type InstalledLinkPreviewMainSession,
} from './installedLinkPreviewMainSession'
import { LINK_PREVIEW_BRIDGE_CHANNEL } from './linkPreviewContract'
import { createLinkPreviewService } from './linkPreviewService'
import { createElectronLocalHtmlPageCapturer } from './localHtmlPageCapturer'
import { createLocalHtmlPreviewService } from './localHtmlPreviewService'
import { createLocalHtmlPreviewSourceStore } from './localHtmlPreviewSourceStore'
const PROFILE_PROOF_ROOT_ARGUMENT = '--eido-profile-proof-root='
const PROFILE_PROOF_OUTPUT_PREFIX = 'EIDO_PROFILE_PROOF:'
const PROFILE_UTILITY_SERVICE_NAME = 'Eido Profile Service'
const PROFILE_TRUSTED_ACTOR_ID = 'eido-desktop-gui'

type ProfileProofSecurity = Readonly<{
  origin: 'eido://app'
  nodeGlobal: 'undefined'
  requireGlobal: 'undefined'
  permissionState: 'denied'
  popupDenied: true
  webviewCapability: 'undefined'
  connectSrc: typeof EIDO_CONNECT_SRC
}>

type ProfileProofCredential = Readonly<{
  localRoundTrip: true
  legacyPlaintextRemoved: true
  linkupRoundTrip: true
}>

type ProfileProofRendererResult =
  | Readonly<{
      phase: 'stamp'
      cardId: string
      modId: string
      security: ProfileProofSecurity
      credential: ProfileProofCredential
    }>
  | Readonly<{
      phase: 'verify'
      cardId: string
      modId: string
      adapter: 'sqlite'
      queryRevision: number
      credential: ProfileProofCredential
    }>

let mainWindow: BrowserWindow | null = null
let installedHost: InstalledProfileHost | undefined
let installedHostStartup: Promise<InstalledProfileHost> | undefined
let installedSession: InstalledProfileMainSession | undefined
let installedAgentRunBroker: ProfileAgentRunRendererBroker | undefined
let installedKeychainSession: InstalledKeychainMainSession | undefined
let installedLinkPreviewSession: InstalledLinkPreviewMainSession | undefined
let installedAiHarnessSession: InstalledAiHarnessMainSession | undefined
let joinedShutdown = false
let shutdownPromise: Promise<void> | undefined
let fatalPromise: Promise<void> | undefined
let profileProofRequest: ProfileProofRequest | undefined
let profileProofRendererResult: ProfileProofRendererResult | undefined
let profileProofExternalRequestCount = 0

const installedLiveGatewayLifecycle = createInstalledProfileLiveGatewayLifecycle((error) => {
  if (!shutdownPromise && !fatalPromise) {
    console.error('EIDO_PROFILE_LIVE_GATEWAY_UNAVAILABLE:', error)
  }
})

function resolveInstalledProfile(argv: readonly string[]): ProfileInstallation {
  return resolveProfileInstallation({
    appData: app.getPath('appData'),
    ...explicitProofRoot(argv),
  })
}

function configurePrimaryBeforeReady(): void {
  registerEidoScheme((schemes) => protocol.registerSchemesAsPrivileged(schemes))
}

function prepareInstalledProfileRoot(installation: ProfileInstallation): void {
  if (app.isReady()) throw new Error('Installed Profile root must be pinned before Electron readiness')
  mkdirSync(installation.userDataRoot, { recursive: true, mode: 0o700 })
  app.setPath('userData', installation.userDataRoot)
}

function explicitProofRoot(argv: readonly string[]): Readonly<{ proofRoot?: string }> {
  const matches = argv.filter((argument) => argument.startsWith(PROFILE_PROOF_ROOT_ARGUMENT))
  if (matches.length > 1) throw new Error('Profile proof root was supplied more than once')
  const proofRoot = matches[0]?.slice(PROFILE_PROOF_ROOT_ARGUMENT.length)
  return proofRoot === undefined ? {} : { proofRoot }
}

function requireDisposableProfileProofRoot(installation: ProfileInstallation): void {
  if (installation.mode !== 'proof' || installation.disposable !== true) {
    throw new Error('Packaged Profile proof requires a disposable explicit root')
  }
  const proofRoot = realpathSync.native(installation.userDataRoot)
  const temporaryRoot = realpathSync.native(os.tmpdir())
  const relative = path.relative(temporaryRoot, proofRoot)
  const basename = path.basename(proofRoot)
  if (relative === ''
    || path.isAbsolute(relative)
    || relative.startsWith(`..${path.sep}`)
    || relative === '..'
    || path.dirname(relative) !== '.'
    || (!basename.startsWith('eido-profile-proof-')
      && !basename.startsWith('eido-profile-signing-'))) {
    throw new Error('Packaged Profile proof requires a disposable explicit root')
  }
}

async function startApplication(
  installation: ProfileInstallation,
  credentialInstallation: ProfileCredentialInstallation,
): Promise<void> {
  await app.whenReady()
  if (shutdownPromise || fatalPromise) return

  installApplicationMenu()

  protocol.handle('eido', createEidoProtocolHandler(path.join(app.getAppPath(), 'dist')))
  const securityPolicy = createWindowSecurityPolicy((url) => shell.openExternal(url))
  session.defaultSession.setPermissionCheckHandler(securityPolicy.checkPermission)
  session.defaultSession.setPermissionRequestHandler(securityPolicy.denyPermissionRequest)
  // macOS uses its native dictionary. Chromium's other implementations can download one.
  if (process.platform !== 'darwin') session.defaultSession.setSpellCheckerEnabled(false)
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] },
    ({ url, method }, callback) => {
      if (profileProofRequest) profileProofExternalRequestCount += 1
      callback({ cancel: !isEidoProviderRequest(url, method) })
    },
  )

  const sessions = createInstalledProfileSessions(installation)

  let pendingTerminalLoss: Error | undefined
  const hostStartup = sessions.openActive({
    trustedActorId: PROFILE_TRUSTED_ACTOR_ID,
    createIdentity: createInstalledProfileSaveIdentity,
    createHydrationEpoch: randomUUID,
    acquireRendererAgentMutationBarrier() {
      const target = mainWindow?.webContents
      if (!target || target.isDestroyed()) {
        throw new Error('Installed Profile renderer cannot acquire the Agent mutation barrier')
      }
      return requestRendererProfileAgentBarrier({
        ipc: ipcMain,
        target,
        createToken: randomUUID,
      })
    },
    onRendererAgentMutationBarrierFailure(error) {
      console.error('EIDO_PROFILE_LIVE_GATEWAY_UNAVAILABLE:', error)
      void failClosed(error)
    },
    choosePortableExportPath: choosePortableExportPath,
    choosePortableImportPath: choosePortableImportPath,
    onTerminalLoss(loss) {
      pendingTerminalLoss = loss.error
      if (installedHost) void failClosed(loss.error)
    },
  })
  installedHostStartup = hostStartup
  try {
    installedHost = await hostStartup
  } finally {
    if (installedHostStartup === hostStartup) installedHostStartup = undefined
  }
  if (pendingTerminalLoss) throw pendingTerminalLoss
  if (shutdownPromise) {
    await shutdownPromise
    return
  }
  if (fatalPromise) {
    await fatalPromise
    return
  }

  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: createSecureWebPreferences(
      path.join(app.getAppPath(), 'dist-electron', 'preload.cjs'),
    ),
  })
  mainWindow = window
  installedAgentRunBroker = createProfileAgentRunRendererBroker({
    ipc: ipcMain,
    target: window.webContents,
    createToken: randomUUID,
  })
  if (profileProofRequest?.phase === 'verify') {
    window.webContents.session.enableNetworkEmulation({ offline: true })
  }
  installedSession = createInstalledProfileMainSession({
    host: installedHost,
    target: window.webContents,
    requestCheckpoint: () => requestRendererProfileCheckpoint({
      ipc: ipcMain,
      target: window.webContents,
      createToken: randomUUID,
    }),
    onRendererAuthorityAdopted() {
      startInstalledProfileLiveGateway(installation, installedHost!)
    },
  })
  // Inspect credential files before calling these methods. Use asynchronous
  // protection so a Keychain authorization prompt leaves Profile IPC running.
  // Linux's async fallback can use a fixed key independently of the backend
  // selector, so keep the backend check and crypto on the same API there.
  const protectedStorage = process.platform === 'linux' ? safeStorage : {
    isEncryptionAvailable: () => safeStorage.isAsyncEncryptionAvailable(),
    encryptString: (plainText: string) => safeStorage.encryptStringAsync(plainText),
    async decryptString(ciphertext: Buffer) {
      return (await safeStorage.decryptStringAsync(ciphertext)).result
    },
  }
  const credentialStore = createLocalCredentialStore({
    userDataRoot: credentialInstallation.userDataRoot,
    protection: protectedStorage,
  })
  const linkupCredentialStore = createLocalCredentialStore({
    userDataRoot: credentialInstallation.userDataRoot,
    credential: 'linkup',
    protection: protectedStorage,
  })
  const readOnly = credentialInstallation.access === 'read-only'
  // ADR 0034 retired the search key. Anyone who pasted one into an older build
  // still has it on disk, so it is deleted on the way past rather than left.
  // Never under read-only access: that mode points the credential root at the
  // real product Profile while the Board itself is disposable, and its whole
  // promise is that a development review cannot write there. An ordinary
  // launch on the same Profile does the deleting.
  if (!readOnly) void removeRetiredSearchCredential(credentialInstallation.userDataRoot)
  installedKeychainSession = createInstalledKeychainMainSession({
    store: readOnly ? createReadOnlyCredentialStore(credentialStore) : credentialStore,
    stores: {
      linkup: readOnly ? createReadOnlyCredentialStore(linkupCredentialStore) : linkupCredentialStore,
    },
    target: window.webContents,
  })
  installedLinkPreviewSession = createInstalledLinkPreviewMainSession({
    service: createLinkPreviewService(),
    localService: createLocalHtmlPreviewService({
      sources: createLocalHtmlPreviewSourceStore({ userDataRoot: installation.userDataRoot }),
      capture: createElectronLocalHtmlPageCapturer(),
      openPath: (sourcePath) => shell.openPath(sourcePath),
    }),
    target: window.webContents,
  })
  installedAiHarnessSession = createInstalledAiHarnessMainSession({
    target: window.webContents,
  })

  ipcMain.handle(PROFILE_BRIDGE_CHANNEL, (event, ...args: unknown[]) => {
    const active = installedSession
    if (!active) throw new Error('Installed Profile bridge is unavailable')
    return active.route(event, args)
  })
  ipcMain.handle(KEYCHAIN_BRIDGE_CHANNEL, (event, ...args: unknown[]) => {
    const active = installedKeychainSession
    if (!active) throw new Error('Installed Keychain bridge is unavailable')
    return active.route(event, args)
  })
  ipcMain.handle(LINK_PREVIEW_BRIDGE_CHANNEL, (event, ...args: unknown[]) => {
    const active = installedLinkPreviewSession
    if (!active) throw new Error('Installed link preview bridge is unavailable')
    return active.route(event, args)
  })
  ipcMain.handle(AI_HARNESS_BRIDGE_CHANNEL, (event, ...args: unknown[]) => {
    const active = installedAiHarnessSession
    if (!active) throw new Error('AI harness bridge is unavailable')
    return active.route(event, args)
  })

  window.webContents.on('will-navigate', securityPolicy.preventNavigation)
  window.webContents.on('will-attach-webview', securityPolicy.preventWebview)
  window.webContents.setWindowOpenHandler(securityPolicy.handleWindowOpen)
  window.webContents.on('render-process-gone', (_event, details) => {
    void failClosed(new Error(`Eido renderer terminated: ${details.reason}`))
  })
  window.webContents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
    if (isMainFrame) void failClosed(new Error(`Eido renderer failed to load (${code}): ${description}`))
  })
  window.webContents.on('did-navigate-in-page', (
    _event,
    currentUrl,
    isMainFrame,
    frameProcessId,
    frameRoutingId,
  ) => {
    if (!profileProofRequest || !isMainFrame) return
    const mainFrame = window.webContents.mainFrame
    if (frameProcessId !== mainFrame.processId || frameRoutingId !== mainFrame.routingId) {
      void failClosed(new Error('Packaged Profile proof result came from an unexpected frame'))
      return
    }
    try {
      profileProofRendererResult = readProfileProofRendererResult(currentUrl, profileProofRequest)
    } catch (error) {
      void failClosed(error instanceof Error ? error : new Error('Packaged Profile proof failed'))
      return
    }
    window.close()
  })
  window.on('close', (event) => {
    if (joinedShutdown) return
    event.preventDefault()
    if (fatalPromise) return
    if (profileProofRequest && !profileProofRendererResult) {
      try {
        profileProofRendererResult = readProfileProofRendererResult(
          window.webContents.getURL(),
          profileProofRequest,
        )
      } catch (error) {
        void failClosed(error instanceof Error ? error : new Error('Packaged Profile proof failed'))
        return
      }
    }
    void requestJoinedShutdown()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
    if (!joinedShutdown && !fatalPromise) {
      void failClosed(new Error('Eido renderer closed before Profile shutdown joined'))
    }
  })

  const applicationUrl = new URL(EIDO_APP_URL)
  applicationUrl.searchParams.set('profile-mode', installedHost.startup.state)
  if (credentialInstallation.access === 'read-only') {
    applicationUrl.searchParams.set(
      PROFILE_REVIEW_POLICY_PARAMETER,
      PROFILE_REVIEW_POLICY_VERSION,
    )
  }
  if (profileProofRequest) {
    applicationUrl.searchParams.set('profile-proof-phase', profileProofRequest.phase)
    if (profileProofRequest.phase === 'verify') {
      applicationUrl.searchParams.set('profile-proof-card-id', profileProofRequest.cardId)
      applicationUrl.searchParams.set('profile-proof-mod-id', profileProofRequest.modId)
      applicationUrl.searchParams.set('profile-proof-revision', String(profileProofRequest.revision))
    }
  }
  await window.loadURL(applicationUrl.toString())
  if (!window.isDestroyed()) window.show()
}

function installApplicationMenu(): void {
  if (process.platform !== 'darwin' || !app.isPackaged) return
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    {
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        {
          label: 'Install “eido” Command…',
          click: () => { void offerMacosEidoCommandInstall() },
        },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        { type: 'separator' },
        { role: 'front' },
      ],
    },
  ]))
}

async function offerMacosEidoCommandInstall(): Promise<void> {
  const choice = await dialog.showMessageBox({
    type: 'info',
    title: 'Install eido command',
    message: 'Make the eido command available in Terminal?',
    detail: 'Eido will install a command launcher at /usr/local/bin/eido. macOS may ask for an administrator password.',
    buttons: ['Install', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
  })
  if (choice.response !== 0) return
  try {
    await installMacosEidoCommand(process.resourcesPath)
    await dialog.showMessageBox({
      type: 'info',
      title: 'eido command installed',
      message: 'The eido command is ready in Terminal.',
      buttons: ['OK'],
    })
  } catch {
    await dialog.showMessageBox({
      type: 'error',
      title: 'Could not install eido command',
      message: 'Eido left the existing command unchanged.',
      detail: 'If another file already uses /usr/local/bin/eido, remove or rename it and try again.',
      buttons: ['OK'],
    })
  }
}

async function runInstalledProfileJsonCli(argv: readonly string[]): Promise<void> {
  const stdout = createProfileJsonCliWriter(process.stdout)
  const stderr = createProfileJsonCliWriter(process.stderr)
  let installation: ProfileInstallation
  const identity = planEidoCliIdentity([], process.env, randomUUID)
  try {
    if (!identity.ok) throw new Error('Installed CLI identity is invalid')
    installation = resolveInstalledProfile(argv)
    if (installation.mode === 'proof') requireDisposableProfileProofRoot(installation)
    prepareInstalledProfileRoot(installation)
  } catch {
    const exitCode = await finishProfileJsonCliPreflightFailure({ stdout, stderr })
    app.exit(exitCode)
    return
  }

  const exitCode = await runProfileJsonCli({
    openService: async () => {
      await app.whenReady()
      return createInstalledProfileSessions(
        installation,
        identity.identity,
      ).existingOnly.cli.open()
    },
    stdin: createProfileJsonCliInput(),
    stdout,
    stderr,
  })
  app.exit(exitCode)
}

async function runInstalledEidoCli(argv: readonly string[]): Promise<void> {
  const stdout = createProfileJsonCliWriter(process.stdout)
  const stderr = createProfileJsonCliWriter(process.stderr)
  let installation: ProfileInstallation | undefined
  const identity = planEidoCliIdentity(
    argv.slice(2).filter(argument => !argument.startsWith(PROFILE_PROOF_ROOT_ARGUMENT)),
    process.env,
    randomUUID,
  )

  const prepareRawMode = (): ProfileInstallation => {
    if (installation) return installation
    const candidate = resolveInstalledProfile(argv)
    if (candidate.mode === 'proof') requireDisposableProfileProofRoot(candidate)
    prepareInstalledProfileRoot(candidate)
    installation = candidate
    return candidate
  }
  const openService = async () => {
    if (!identity.ok) throw new Error('Installed CLI identity is invalid')
    const selected = prepareRawMode()
    await app.whenReady()
    return createInstalledProfileSessions(selected, identity.identity).existingOnly.cli.open()
  }
  const discovery = createProfileGatewaySession({ openService })
  const runRaw = async (io: EidoCliRawIo): Promise<number> => {
    try {
      prepareRawMode()
    } catch {
      return finishProfileJsonCliPreflightFailure(io)
    }
    return runProfileJsonCli({
      openService,
      ...io,
    })
  }

  const exitCode = await runEidoCli({
    argv: identity.ok ? identity.argv : ['--invalid-cli-identity'],
    createRequestId: randomUUID,
    describeGateway: () => discovery.describeAgentCli(),
    stdin: createProfileJsonCliInput(),
    stdout,
    stderr,
    runRaw,
  })
  await discovery.close()
  app.exit(exitCode)
}

async function runInstalledProfileMcp(): Promise<void> {
  let streams: Readonly<{ stdin: Readable; stdout: Writable; stderr: Writable }>
  try {
    streams = createInstalledProfileMcpStreams()
  } catch {
    app.exit(1)
    return
  }

  const shutdownController = new AbortController()
  const requestShutdown = (): void => shutdownController.abort()
  process.on('SIGINT', requestShutdown)
  process.on('SIGTERM', requestShutdown)
  let gateway: ReturnType<typeof createProfileGatewaySession> | undefined
  let exitCode = 0
  try {
    // The external MCP entry is always fixed to this Eido installation. Proofs seed a
    // disposable ordinary app-data root before invoking this unmodified production path.
    const installation = resolveInstalledProfile([])
    prepareInstalledProfileRoot(installation)
    const sessions = createInstalledProfileSessions(installation)
    gateway = createProfileGatewaySession({
      openService: async () => {
        await app.whenReady()
        return sessions.existingOnly.mcp.open()
      },
    })
    await runProfileMcpStdio({
      gateway,
      createRequestId: randomUUID,
      shutdownSignal: shutdownController.signal,
      ...streams,
    })
  } catch {
    await gateway?.close().catch(() => undefined)
    await writeProfileMcpFatalDiagnostic(streams.stderr)
    exitCode = 1
  } finally {
    process.removeListener('SIGINT', requestShutdown)
    process.removeListener('SIGTERM', requestShutdown)
  }
  app.exit(exitCode)
}

function createInstalledProfileMcpStreams(): Readonly<{
  stdin: Readable
  stdout: Writable
  stderr: Writable
}> {
  if (process.platform !== 'win32') {
    return Object.freeze({
      stdin: process.stdin,
      stdout: process.stdout,
      stderr: process.stderr,
    })
  }

  // The package-owned SEA relay reserves Electron's native fd 1 and carries the MCP
  // channels on dedicated overlapped pipes so Chromium cannot prelude protocol stdout.
  for (const descriptor of [3, 4, 5]) fstatSync(descriptor)
  return Object.freeze({
    stdin: createReadStream('', { fd: 3, autoClose: false }),
    stdout: createWriteStream('', { fd: 4, autoClose: false }),
    stderr: createWriteStream('', { fd: 5, autoClose: false }),
  })
}

function writeProfileMcpFatalDiagnostic(stderr: Writable): Promise<void> {
  return new Promise((resolve) => {
    try {
      stderr.write('Eido Profile MCP failed.\n', 'utf8', () => resolve())
    } catch {
      resolve()
    }
  })
}

function createProfileJsonCliInput(): AsyncIterable<Uint8Array> {
  if (process.platform !== 'win32') return process.stdin
  // Electron replaces process.stdin with an EOF stream on Windows but leaves inherited fd 0 available.
  return readProfileJsonCliInput(0)
}

async function* readProfileJsonCliInput(fileDescriptor: number): AsyncGenerator<Uint8Array> {
  while (true) {
    const buffer = Buffer.allocUnsafe(64 * 1024)
    const bytesRead = await new Promise<number>((resolve, reject) => {
      readFileDescriptor(fileDescriptor, buffer, 0, buffer.byteLength, null, (error, count) => {
        if (error) reject(error)
        else resolve(count)
      })
    })
    if (bytesRead === 0) return
    yield buffer.subarray(0, bytesRead)
  }
}

function createInstalledProfileSessions(
  installation: ProfileInstallation,
  cliIdentity?: Readonly<{ client: string; sessionId: string }>,
) {
  return createInstalledProfileSessionFactory({
    installation,
    createTransport: () => utilityProcess.fork(
      path.join(app.getAppPath(), 'dist-electron', 'profile-utility.cjs'),
      [],
      {
        serviceName: PROFILE_UTILITY_SERVICE_NAME,
        stdio: ['ignore', 'ignore', 'ignore'],
      },
    ),
    createRequestId: randomUUID,
    ...(cliIdentity === undefined
      ? {}
      : {
          cliAgentClient: cliIdentity.client,
          createCliAgentSessionId: () => cliIdentity.sessionId,
        }),
  })
}

function startInstalledProfileLiveGateway(
  installation: ProfileInstallation,
  host: InstalledProfileHost,
): void {
  if (shutdownPromise || fatalPromise) return
  const runBroker = installedAgentRunBroker
  if (!runBroker) {
    console.error('EIDO_PROFILE_LIVE_GATEWAY_UNAVAILABLE: renderer run broker is unavailable')
    return
  }
  const platform = process.platform
  if (platform !== 'darwin' && platform !== 'win32') {
    console.error('EIDO_PROFILE_LIVE_GATEWAY_UNAVAILABLE: unsupported platform')
    return
  }
  const helperName = platform === 'win32'
    ? 'eido-profile-live-gateway-helper.exe'
    : 'eido-profile-live-gateway-helper'
  const helperPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin', helperName)
    : path.join(app.getAppPath(), 'dist-electron', helperName)
  installedLiveGatewayLifecycle.start(() => startProfileLiveGatewayServer({
    installation,
    platform,
    helperPath,
    openService: (identity) => {
      const opened = host.openAgentService(identity)
      return opened.ok
        ? Object.freeze({
            ok: true as const,
            value: createProfileAgentRunLiveService(opened.value, identity, runBroker),
          })
        : opened
    },
    onFailure(error) {
      console.error('EIDO_PROFILE_LIVE_GATEWAY_UNAVAILABLE:', error)
    },
  }))
}

async function stopInstalledProfileLiveGateway(force: boolean): Promise<void> {
  return installedLiveGatewayLifecycle.stop(force)
}

function createProfileJsonCliWriter(stream: NodeJS.WriteStream): ProfileJsonCliWriter {
  return Object.freeze({
    write(value: string): Promise<void> {
      return new Promise((resolve, reject) => {
        stream.write(value, 'utf8', (error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    },
  })
}

function requestJoinedShutdown(): Promise<void> {
  if (shutdownPromise) return shutdownPromise
  installedAgentRunBroker?.close()
  shutdownPromise = (async () => {
    try {
      await shutdownAiHarnesses()
      await stopInstalledProfileLiveGateway(false)
      const activeSession = installedSession
      if (activeSession) {
        const receipt = await requestJoinedPersistenceDrain()
        if (profileProofRequest) emitProfileProofResult(profileProofRequest, receipt)
      } else {
        const activeHost = installedHost ?? await installedHostStartup
        await activeHost?.terminate()
      }

    } catch (error) {
      await failClosed(error instanceof Error ? error : new Error('Installed Profile shutdown failed'))
      return
    }
    joinedShutdown = true
    releaseRendererBridges()
    const window = mainWindow
    if (window && !window.isDestroyed()) window.destroy()
    app.quit()
  })()
  return shutdownPromise
}

function requestJoinedPersistenceDrain(): Promise<Awaited<ReturnType<InstalledProfileMainSession['shutdown']>>> {
  const activeSession = installedSession
  if (!activeSession) {
    return Promise.reject(new Error('Installed Profile session is unavailable for joined shutdown'))
  }
  return activeSession.shutdown()
}

function emitProfileProofResult(
  request: ProfileProofRequest,
  receipt: Awaited<ReturnType<InstalledProfileMainSession['shutdown']>>,
): void {
  const renderer = profileProofRendererResult
  if (!renderer || renderer.phase !== request.phase || receipt.state !== 'flushed') {
    throw new Error('Packaged Profile proof did not reach a flushed joined shutdown')
  }
  if (request.phase === 'verify') {
    if (renderer.phase !== 'verify'
      || renderer.cardId !== request.cardId
      || renderer.modId !== request.modId
      || renderer.queryRevision !== request.revision) {
      throw new Error('Packaged Profile proof reopen did not match the first launch')
    }
  }
  console.log(`${PROFILE_PROOF_OUTPUT_PREFIX}${JSON.stringify({
    phase: request.phase,
    cardId: renderer.cardId,
    modId: renderer.modId,
    credential: renderer.credential,
    egress: {
      externalRequestCount: profileProofExternalRequestCount,
    },
    ...(renderer.phase === 'stamp'
      ? { security: renderer.security }
      : {
          adapter: renderer.adapter,
          queryRevision: renderer.queryRevision,
          offline: {
            scope: 'window-session',
            networkEmulationEnabled: true,
          },
        }),
    nativeGeneration: receipt.generation,
    revision: receipt.revision,
    logicalClose: true,
    utilityJoined: true,
  })}`)
}

function readProfileProofRendererResult(
  currentUrl: string,
  request: ProfileProofRequest,
): ProfileProofRendererResult {
  const url = new URL(currentUrl)
  if (!isTrustedAppUrl(currentUrl)
    || url.searchParams.get('profile-proof-phase') !== request.phase
    || url.searchParams.get('profile-proof-result') !== 'passed') {
    throw new Error('Packaged Profile proof renderer did not report success')
  }
  const cardId = requireProfileProofId(
    url.searchParams.get('profile-proof-result-card-id'),
    'card',
  )
  const modId = requireProfileProofId(url.searchParams.get('profile-proof-result-mod-id'), 'Mod')
  const credential = Object.freeze({
    localRoundTrip: url.searchParams.get('profile-proof-credential-round-trip') === 'true',
    legacyPlaintextRemoved: url.searchParams.get('profile-proof-legacy-plaintext-removed') === 'true',
    linkupRoundTrip: url.searchParams.get('profile-proof-linkup-round-trip') === 'true',
  })
  if (!credential.localRoundTrip
    || !credential.legacyPlaintextRemoved
    || !credential.linkupRoundTrip) {
    throw new Error('Packaged credential proof failed')
  }
  if (request.phase === 'stamp') {
    const security = Object.freeze({
      origin: url.searchParams.get('profile-proof-origin'),
      nodeGlobal: url.searchParams.get('profile-proof-node-global'),
      requireGlobal: url.searchParams.get('profile-proof-require-global'),
      permissionState: url.searchParams.get('profile-proof-permission-state'),
      popupDenied: url.searchParams.get('profile-proof-popup-denied') === 'true',
      webviewCapability: url.searchParams.get('profile-proof-webview-capability'),
      connectSrc: url.searchParams.get('profile-proof-connect-src'),
    })
    if (security.origin !== 'eido://app'
      || security.nodeGlobal !== 'undefined'
      || security.requireGlobal !== 'undefined'
      || security.permissionState !== 'denied'
      || security.popupDenied !== true
      || security.webviewCapability !== 'undefined'
      || security.connectSrc !== EIDO_CONNECT_SRC) {
      throw new Error('Packaged Profile proof renderer security boundary failed')
    }
    return Object.freeze({
      phase: request.phase,
      cardId,
      modId,
      security: security as ProfileProofSecurity,
      credential: credential as ProfileProofCredential,
    })
  }
  const queryRevision = Number(url.searchParams.get('profile-proof-query-revision'))
  if (url.searchParams.get('profile-proof-adapter') !== 'sqlite'
    || !Number.isSafeInteger(queryRevision)
    || queryRevision <= 0) {
    throw new Error('Packaged Profile proof query evidence was invalid')
  }
  return Object.freeze({
    phase: request.phase,
    cardId,
    modId,
    adapter: 'sqlite',
    queryRevision,
    credential: credential as ProfileProofCredential,
  })
}

function failClosed(error: Error): Promise<void> {
  if (fatalPromise) return fatalPromise
  if (joinedShutdown) return Promise.resolve()
  installedAgentRunBroker?.close()
  fatalPromise = (async () => {
    console.error('EIDO_SHELL_FATAL:', error)
    try {
      await stopInstalledProfileLiveGateway(true)
      let activeHost = installedHost
      if (!activeHost && installedHostStartup) {
        try {
          activeHost = await installedHostStartup
        } catch {
          // Failed host acquisition already terminates and joins its utility.
        }
      }
      await activeHost?.terminate()
      await shutdownAiHarnesses()
    } catch (terminationError) {
      console.error('EIDO_PROFILE_TERMINATION_FATAL:', terminationError)
    } finally {
      if (joinedShutdown) return
      releaseRendererBridges()
      const window = mainWindow
      if (window && !window.isDestroyed()) window.destroy()
      app.exit(1)
    }
  })()
  return fatalPromise
}

function releaseRendererBridges(): void {
  installedSession = undefined
  installedAgentRunBroker?.close()
  installedAgentRunBroker = undefined
  installedKeychainSession = undefined
  installedLinkPreviewSession?.close()
  installedLinkPreviewSession = undefined
  installedAiHarnessSession = undefined
  ipcMain.removeHandler(PROFILE_BRIDGE_CHANNEL)
  ipcMain.removeHandler(KEYCHAIN_BRIDGE_CHANNEL)
  ipcMain.removeHandler(LINK_PREVIEW_BRIDGE_CHANNEL)
  ipcMain.removeHandler(AI_HARNESS_BRIDGE_CHANNEL)
}

async function shutdownAiHarnesses(): Promise<void> {
  const active = installedAiHarnessSession
  installedAiHarnessSession = undefined
  await active?.close()
}

async function choosePortableExportPath(): Promise<string | undefined> {
  const choice = await dialog.showSaveDialog({
    title: words.profileExportDialogTitle,
    defaultPath: 'eido-profile.zip',
    filters: [{ name: words.profileArchiveFileType, extensions: ['zip'] }],
  })
  return choice.canceled ? undefined : choice.filePath
}

async function choosePortableImportPath(): Promise<string | undefined> {
  const choice = await dialog.showOpenDialog({
    title: words.profileImportDialogTitle,
    properties: ['openFile'],
    filters: [
      { name: words.profilePortableDataFileType, extensions: ['zip', 'json'] },
    ],
  })
  return choice.canceled ? undefined : choice.filePaths[0]
}

let profileLaunchMode: ProfileLaunchMode | undefined
try {
  profileLaunchMode = resolveProfileLaunchMode(process.argv)
} catch {
  process.stderr.write('Eido launch mode is invalid.\n')
  app.exit(1)
}

if (profileLaunchMode === 'json') {
  void runInstalledProfileJsonCli(process.argv).catch(() => {
    app.exit(PROFILE_JSON_CLI_EXIT_CODES.internal)
  })
} else if (profileLaunchMode === 'mcp') {
  void runInstalledProfileMcp()
} else if (profileLaunchMode === 'cli') {
  void runInstalledEidoCli(process.argv).catch(() => {
    app.exit(PROFILE_JSON_CLI_EXIT_CODES.internal)
  })
} else if (profileLaunchMode === 'gui') {
  const installedAppData = app.getPath('appData')
  const profileInstallation = resolveInstalledProfile(process.argv)
  const auxiliaryLaunch = resolveProfileAuxiliaryLaunch({
    argv: process.argv,
    installation: profileInstallation,
    isPackaged: app.isPackaged,
  })
  if (auxiliaryLaunch.kind !== 'ordinary') {
    requireDisposableProfileProofRoot(profileInstallation)
  }
  const credentialInstallation = resolveProfileCredentialInstallation({
    appData: installedAppData,
    profileInstallation,
    launch: auxiliaryLaunch,
  })
  profileProofRequest = auxiliaryLaunch.kind === 'proof'
    ? auxiliaryLaunch.request
    : undefined
  const launchIntents = createDesktopLaunchIntentDispatcher({
    activatePrimary: () => {
      const window = mainWindow
      if (!window || window.isDestroyed()) return
      if (window.isMinimized()) window.restore()
      window.show()
      window.focus()
    },
  })
  const singleInstanceAdmission = acquireInstalledProfileSingleInstance({
    initialArgv: process.argv,
    dispatchLaunchIntent: (request) => launchIntents.dispatch(request),
    prepareLockIdentity: () => prepareInstalledProfileRoot(profileInstallation),
    requestLock: () => app.requestSingleInstanceLock(),
    onSecondInstance: (listener) => app.on(
      'second-instance',
      (_event, commandLine) => listener(commandLine),
    ),
  })

  if (singleInstanceAdmission === 'rejected') {
    console.error('EIDO_LAUNCH_INTENT_REJECTED: external launch request was denied')
    app.exit(1)
  } else if (singleInstanceAdmission === 'busy') {
    console.error('EIDO_PROFILE_BUSY: another Eido instance owns the installed Profile')
    app.exit(2)
  } else {
    configurePrimaryBeforeReady()
    app.on('before-quit', (event) => {
      if (joinedShutdown) return
      event.preventDefault()
      if (fatalPromise) return
      void requestJoinedShutdown()
    })
    app.on('window-all-closed', () => {
      if (joinedShutdown || fatalPromise) return
      void requestJoinedShutdown()
    })
    void startApplication(profileInstallation, credentialInstallation).catch((error) => {
      void failClosed(error instanceof Error ? error : new Error('Eido shell startup failed'))
    })
  }
}
