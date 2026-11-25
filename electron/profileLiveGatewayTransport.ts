import type {
  ProfileGatewayRequest,
  ProfileGatewayResponse,
} from '../src/persistence/profileAgentGateway'

export type ProfileLiveGatewayIdentity = Readonly<{
  client: string
  sessionId: string
}>

export type ProfileLiveGatewayAbsentReason =
  | 'locator-not-found'
  | 'endpoint-not-found'

export type ProfileLiveGatewayUnavailable =
  | Readonly<{
    state: 'unavailable'
    reason: 'locator-rejected' | 'peer-rejected' | 'token-rejected'
    admission: 'none'
    fallback: 'forbidden'
  }>
  | Readonly<{
    state: 'unavailable'
    reason: 'protocol-failure'
    admission: 'none' | 'admitted'
    fallback: 'forbidden'
  }>
  | Readonly<{
    state: 'unavailable'
    reason: 'transport-failure' | 'disconnected'
    admission: 'none' | 'unknown'
    fallback: 'forbidden'
  }>

export type ProfileLiveGatewayInvocationResult =
  | Readonly<{
    state: 'served'
    response: ProfileGatewayResponse
  }>
  | Readonly<{
    state: 'absent'
    reason: ProfileLiveGatewayAbsentReason
    admission: 'none'
    fallback: 'headless'
  }>
  | ProfileLiveGatewayUnavailable

export type ProfileLiveGatewayClient = Readonly<{
  invoke(
    request: ProfileGatewayRequest,
    identity: ProfileLiveGatewayIdentity,
  ): Promise<ProfileLiveGatewayInvocationResult>
}>

export type ProfileLiveGatewayServer = Readonly<{
  close(): Promise<void>
  terminate(): Promise<void>
}>

export function classifyProfileLiveGatewayServed(
  response: ProfileGatewayResponse,
): ProfileLiveGatewayInvocationResult {
  return Object.freeze({ state: 'served' as const, response })
}

export function classifyProfileLiveGatewayAbsent(
  reason: ProfileLiveGatewayAbsentReason,
): ProfileLiveGatewayInvocationResult {
  return Object.freeze({
    state: 'absent' as const,
    reason,
    admission: 'none' as const,
    fallback: 'headless' as const,
  })
}

export function classifyProfileLiveGatewayUnavailable(
  reason: ProfileLiveGatewayUnavailable['reason'],
  admission: ProfileLiveGatewayUnavailable['admission'],
): ProfileLiveGatewayUnavailable {
  return Object.freeze({
    state: 'unavailable' as const,
    reason,
    admission,
    fallback: 'forbidden' as const,
  }) as ProfileLiveGatewayUnavailable
}
