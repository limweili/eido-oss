import path from 'node:path'
import type { ProfileGuiSaveIdentity } from '../src/persistence/profileGuiSaveScheduler'
import type {
  ProfileBridgeImportIdeaClosureRequest,
  ProfileBridgePortableExportRequest,
} from './profileBridgeContract'
import {
  createInstalledProfileHeadlessLeaseFactory,
  type InstalledProfileHeadlessLeaseFactory,
} from './installedProfileHeadlessLease'
import {
  createInstalledProfileHost,
  type InstalledProfileHost,
} from './installedProfileHost'
import type { ProfileInstallation } from './profileInstallation'
import type {
  ProfileUtilityTerminalLoss,
  ProfileUtilityTransport,
} from './profileUtilityClient'
import type { InstalledProfileAgentMutationBarrier } from './profileRendererAgentBarrier'

export const EIDO_PROFILE_PORTABLE_TEMP_RELATIVE_PATH = path.join(
  'tmp',
  'profile-portable-operations',
)

export type InstalledProfileActiveSessionOptions = Readonly<{
  trustedActorId: string
  createIdentity: () => ProfileGuiSaveIdentity
  createHydrationEpoch: () => string
  acquireRendererAgentMutationBarrier?: () => Promise<InstalledProfileAgentMutationBarrier>
  onRendererAgentMutationBarrierFailure?: (error: Error) => void
  choosePortableExportPath?: (
    request: ProfileBridgePortableExportRequest,
  ) => Promise<string | undefined>
  choosePortableImportPath?: (
    request: ProfileBridgeImportIdeaClosureRequest,
  ) => Promise<string | undefined>
  onTerminalLoss?: (loss: ProfileUtilityTerminalLoss) => void
}>

export type InstalledProfileSessionFactory = Readonly<{
  installation: ProfileInstallation
  existingOnly: Readonly<{
    cli: InstalledProfileHeadlessLeaseFactory
    mcp: InstalledProfileHeadlessLeaseFactory
  }>
  openActive(options: InstalledProfileActiveSessionOptions): Promise<InstalledProfileHost>
}>

export function createInstalledProfileSessionFactory({
  installation,
  createTransport,
  createRequestId,
  utilityReadyTimeoutMs,
  utilityExitTimeoutMs,
  cliAgentClient,
  createCliAgentSessionId,
}: Readonly<{
  installation: ProfileInstallation
  createTransport: () => ProfileUtilityTransport
  createRequestId: () => string
  utilityReadyTimeoutMs?: number
  utilityExitTimeoutMs?: number
  cliAgentClient?: string
  createCliAgentSessionId?: () => string
}>): InstalledProfileSessionFactory {
  const createExistingOnly = (transport: 'cli' | 'mcp') => (
    createInstalledProfileHeadlessLeaseFactory({
      installation,
      transport,
      createTransport,
      createRequestId,
      ...(transport === 'cli' && cliAgentClient !== undefined
        ? { agentClient: cliAgentClient }
        : {}),
      ...(transport === 'cli' && createCliAgentSessionId !== undefined
        ? { createAgentSessionId: createCliAgentSessionId }
        : {}),
      ...(utilityReadyTimeoutMs === undefined ? {} : { readyTimeoutMs: utilityReadyTimeoutMs }),
      ...(utilityExitTimeoutMs === undefined ? {} : { utilityExitTimeoutMs }),
    })
  )
  const existingOnly = Object.freeze({
    cli: createExistingOnly('cli'),
    mcp: createExistingOnly('mcp'),
  })
  return Object.freeze({
    installation,
    existingOnly,
    openActive(options) {
      return createInstalledProfileHost({
        transport: createTransport(),
        initialize: Object.freeze({
          route: 'active-owner',
          databasePath: installation.databasePath,
          portableTempRoot: path.join(
            installation.userDataRoot,
            EIDO_PROFILE_PORTABLE_TEMP_RELATIVE_PATH,
          ),
        }),
        trustedActorId: options.trustedActorId,
        createRequestId,
        createIdentity: options.createIdentity,
        createHydrationEpoch: options.createHydrationEpoch,
        acquireRendererAgentMutationBarrier: options.acquireRendererAgentMutationBarrier,
        onRendererAgentMutationBarrierFailure: options.onRendererAgentMutationBarrierFailure,
        ...(utilityReadyTimeoutMs === undefined ? {} : { utilityReadyTimeoutMs }),
        ...(utilityExitTimeoutMs === undefined ? {} : { utilityExitTimeoutMs }),
        ...(options.choosePortableExportPath === undefined
          ? {}
          : { choosePortableExportPath: options.choosePortableExportPath }),
        ...(options.choosePortableImportPath === undefined
          ? {}
          : { choosePortableImportPath: options.choosePortableImportPath }),
        ...(options.onTerminalLoss === undefined
          ? {}
          : { onTerminalLoss: options.onTerminalLoss }),
      })
    },
  })
}
