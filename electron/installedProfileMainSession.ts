import type {
  ProfileBridgeRequest,
  ProfileBridgeResponse,
  ProfileCheckpointWireAck,
} from './profileBridgeContract'
import type {
  InstalledProfileHost,
  InstalledProfileHostStartup,
} from './installedProfileHost'
import type { InstalledProfileShutdownReceipt } from './installedProfileRouter'
import {
  assertTrustedProfileBridgeRequest,
  type ProfileBridgeEvent,
  type ProfileBridgeWebContents,
} from './security'

export type InstalledProfileMainSession = Readonly<{
  startup: InstalledProfileHostStartup
  route(
    event: ProfileBridgeEvent,
    args: readonly unknown[],
  ): Promise<ProfileBridgeResponse>
  shutdown(): Promise<InstalledProfileShutdownReceipt>
}>

export function createInstalledProfileMainSession({
  host,
  target,
  requestCheckpoint,
  onRendererAuthorityAdopted,
}: Readonly<{
  host: InstalledProfileHost
  target: ProfileBridgeWebContents
  requestCheckpoint: () => Promise<ProfileCheckpointWireAck & { ok: true }>
  onRendererAuthorityAdopted?: () => void
}>): InstalledProfileMainSession {
  let checkpointRequired = false
  let recoveryOnly = host.startup.state === 'recovery-required'
  let shutdownPromise: Promise<InstalledProfileShutdownReceipt> | undefined

  const session: InstalledProfileMainSession = Object.freeze({
    startup: host.startup,
    async route(event, args) {
      const request = assertTrustedProfileBridgeRequest(event, target, args)
      const response = await host.route(request)
      if (restoredProfile(request, response)) recoveryOnly = false
      if (acknowledgedHydration(request, response)) {
        recoveryOnly = false
        checkpointRequired = true
        onRendererAuthorityAdopted?.()
      }
      return response
    },
    shutdown() {
      if (shutdownPromise) return shutdownPromise
      shutdownPromise = (async () => {
        try {
          if (!checkpointRequired) {
            if (recoveryOnly) return await host.shutdown(undefined)
            throw new Error('Installed Profile renderer never adopted native authority')
          }
          const checkpoint = await requestCheckpoint()
          return await host.shutdown(Object.freeze({
            nativeGeneration: checkpoint.nativeGeneration,
            revision: checkpoint.revision,
          }))
        } catch (error) {
          try {
            await host.terminate()
          } catch {
            // The checkpoint/router failure is the authoritative shutdown cause.
            // Forced termination is best-effort cleanup and must not mask it.
          }
          throw error
        }
      })()
      return shutdownPromise
    },
  })
  return session
}

function acknowledgedHydration(
  request: ProfileBridgeRequest,
  response: ProfileBridgeResponse,
): boolean {
  return request.operation === 'ack-hydration'
    && response.ok
    && response.operation === request.operation
    && response.requestId === request.requestId
}

function restoredProfile(
  request: ProfileBridgeRequest,
  response: ProfileBridgeResponse,
): boolean {
  return request.operation === 'restore-recovery'
    && response.ok
    && response.operation === request.operation
    && response.requestId === request.requestId
}
