import type { ProfileGuiSaveIdentity } from '../src/persistence/profileGuiSaveScheduler'
import type { ProfileServiceResult } from '../src/persistence/profileServiceContract'
import type {
  ProfileGatewaySessionService,
} from '../src/persistence/profileAgentGateway'
import type {
  ProfileBridgeImportIdeaClosureRequest,
  ProfileBridgePortableExportRequest,
  ProfileBridgeRequest,
  ProfileBridgeResponse,
} from './profileBridgeContract'
import {
  createInstalledProfileRouter,
  MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY,
  type InstalledProfileAgentIdentity,
  type InstalledProfileRendererCheckpoint,
  type InstalledProfileRouter,
  type InstalledProfileShutdownReceipt,
} from './installedProfileRouter'
import {
  createProfileUtilityClient,
  type ProfileUtilityTerminalLoss,
  type ProfileUtilityTransport,
} from './profileUtilityClient'
import type {
  ProfileUtilityActiveInitializePayload,
  ProfileUtilityReadyMessage,
} from './profileUtilityProtocol'
import {
  requireProfileUtilityExitTimeout,
  terminateAndJoinProfileUtility,
} from './profileUtilityLifecycle'
import type { InstalledProfileAgentMutationBarrier } from './profileRendererAgentBarrier'

export type InstalledProfileHost = Readonly<{
  startup: InstalledProfileHostStartup
  route(request: ProfileBridgeRequest): Promise<ProfileBridgeResponse>
  openAgentService(
    identity: InstalledProfileAgentIdentity,
  ): ProfileServiceResult<ProfileGatewaySessionService>
  pauseAgentAdmission(): Promise<() => void>
  flushForUpdate(
    rendererCheckpoint: InstalledProfileRendererCheckpoint,
  ): Promise<InstalledProfileShutdownReceipt & { state: 'flushed' }>
  shutdown(
    rendererCheckpoint?: InstalledProfileRendererCheckpoint,
  ): Promise<InstalledProfileShutdownReceipt>
  shutdownForMacosUpdate(
    rendererCheckpoint: InstalledProfileRendererCheckpoint,
  ): Promise<InstalledProfileShutdownReceipt & { state: 'flushed' }>
  terminate(): Promise<void>
}>

export type InstalledProfileHostStartup = ProfileUtilityReadyMessage<'active-owner'>

export type InstalledProfileHostOptions = Readonly<{
  transport: ProfileUtilityTransport
  initialize: ProfileUtilityActiveInitializePayload
  trustedActorId: string
  createRequestId: () => string
  createIdentity: () => ProfileGuiSaveIdentity
  createHydrationEpoch: () => string
  acquireRendererAgentMutationBarrier?: () => Promise<InstalledProfileAgentMutationBarrier>
  onRendererAgentMutationBarrierFailure?: (error: Error) => void
  utilityReadyTimeoutMs?: number
  utilityExitTimeoutMs?: number
  choosePortableExportPath?: (
    request: ProfileBridgePortableExportRequest,
  ) => Promise<string | undefined>
  choosePortableImportPath?: (
    request: ProfileBridgeImportIdeaClosureRequest,
  ) => Promise<string | undefined>
  onTerminalLoss?: (loss: ProfileUtilityTerminalLoss) => void
}>

/** Own the complete main-side installed authority seam. Utility transport and
 * client protocol remain private; callers can only route typed bridge work or
 * close/terminate the single acquired owner. */
export async function createInstalledProfileHost(
  options: InstalledProfileHostOptions,
): Promise<InstalledProfileHost> {
  const utilityExitTimeoutMs = options.utilityExitTimeoutMs ?? 5_000
  requireProfileUtilityExitTimeout(utilityExitTimeoutMs)
  const client = createProfileUtilityClient(options.transport, {
    initialize: options.initialize,
    createRequestId: options.createRequestId,
    ...(options.utilityReadyTimeoutMs === undefined
      ? {}
      : { readyTimeoutMs: options.utilityReadyTimeoutMs }),
  })
  let startupLoss: ProfileUtilityTerminalLoss | undefined
  let stopForwardingTerminalLoss: () => void = () => undefined
  const stopTrackingStartupLoss = client.onTerminalLoss((loss) => {
    startupLoss = loss
  })
  let router: InstalledProfileRouter
  let startup: InstalledProfileHostStartup
  try {
    const ready = await client.ready()
    if (ready.route !== 'active-owner') {
      throw new Error('Installed Profile host acquired the wrong utility route')
    }
    startup = ready
    router = await createInstalledProfileRouter({
      client,
      trustedActorId: options.trustedActorId,
      createIdentity: options.createIdentity,
      createHydrationEpoch: options.createHydrationEpoch,
      acquireRendererAgentMutationBarrier: options.acquireRendererAgentMutationBarrier,
      onRendererAgentMutationBarrierFailure: options.onRendererAgentMutationBarrierFailure,
      onShutdownUtilityTerminationRequested: () => stopForwardingTerminalLoss(),
      utilityExitTimeoutMs,
      choosePortableExportPath: options.choosePortableExportPath,
      choosePortableImportPath: options.choosePortableImportPath,
    })
    if (startupLoss) throw startupLoss.error
  } catch (error) {
    stopTrackingStartupLoss()
    await terminateAndJoinProfileUtility(client, utilityExitTimeoutMs)
    throw error
  }

  stopTrackingStartupLoss()
  stopForwardingTerminalLoss = options.onTerminalLoss
    ? client.onTerminalLoss(options.onTerminalLoss)
    : () => undefined
  let terminatePromise: Promise<void> | undefined
  return Object.freeze({
    startup,
    route: (request) => router.route(request),
    openAgentService: (identity) => router.openAgentService(identity),
    pauseAgentAdmission: () => router.pauseAgentAdmission(),
    flushForUpdate: (rendererCheckpoint) => router.flushForUpdate(rendererCheckpoint),
    shutdown: (rendererCheckpoint) => router.shutdown(rendererCheckpoint),
    async shutdownForMacosUpdate(rendererCheckpoint) {
      const receipt = await router.shutdown(
        rendererCheckpoint,
        MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY,
      )
      if (receipt.state !== 'flushed') {
        throw new Error('macOS update shutdown did not retain a flushed Profile receipt')
      }
      return receipt
    },
    terminate() {
      if (!terminatePromise) {
        // This owner requested cleanup after another authoritative failure.
        // Do not let the client's intentional termination sentinel recursively
        // replace that initiating failure through the external loss observer.
        stopForwardingTerminalLoss()
        const attempt = terminateAndJoinProfileUtility(client, utilityExitTimeoutMs).then(() => undefined)
        terminatePromise = attempt
        void attempt.catch(() => {
          if (terminatePromise === attempt) terminatePromise = undefined
        })
      }
      return terminatePromise
    },
  })
}
