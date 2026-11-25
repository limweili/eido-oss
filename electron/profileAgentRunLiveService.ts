import type { ProfileGatewaySessionService } from '../src/persistence/profileAgentGateway'
import { mapProfileAgentRunGatewayResult } from '../src/persistence/profileAgentRunGateway'
import type { ProfileAgentRunRendererBroker } from './profileAgentRunRendererBroker'

export type ProfileAgentRunLiveGatewayMethods = Readonly<{
  submitAgentRun: NonNullable<ProfileGatewaySessionService['submitAgentRun']>
  statusAgentRun: NonNullable<ProfileGatewaySessionService['statusAgentRun']>
  readAgentRun: NonNullable<ProfileGatewaySessionService['readAgentRun']>
}>

export type ProfileAgentRunLiveGatewayService = Readonly<
  ProfileGatewaySessionService & ProfileAgentRunLiveGatewayMethods
>

/**
 * Adds renderer-owned run operations only to an authenticated live socket
 * service. The socket identity is copied once and never accepted from a
 * Gateway payload; closing one connection leaves the app-scoped broker alive.
 */
export function createProfileAgentRunLiveService(
  base: ProfileGatewaySessionService,
  identity: Readonly<{ client: string; sessionId: string }>,
  broker: ProfileAgentRunRendererBroker,
): ProfileAgentRunLiveGatewayService {
  const actor = Object.freeze({
    kind: 'agent' as const,
    client: identity.client,
    sessionId: identity.sessionId,
  })
  return Object.freeze({
    ...base,
    submitAgentRun: async (request) => mapProfileAgentRunGatewayResult(
      'run.submit',
      await broker.dispatch(actor, 'run.submit', request),
    ),
    statusAgentRun: async (request) => mapProfileAgentRunGatewayResult(
      'run.status',
      await broker.dispatch(actor, 'run.status', request),
    ),
    readAgentRun: async (request) => mapProfileAgentRunGatewayResult(
      'run.read',
      await broker.dispatch(actor, 'run.read', request),
    ),
  })
}
