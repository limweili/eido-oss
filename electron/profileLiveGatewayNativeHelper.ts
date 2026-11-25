import {
  classifyProfileLiveGatewayAbsent,
  classifyProfileLiveGatewayUnavailable,
  type ProfileLiveGatewayInvocationResult,
} from './profileLiveGatewayTransport'

export const PROFILE_LIVE_GATEWAY_HELPER_EXIT = Object.freeze({
  endpointAbsent: 20,
  peerRejected: 21,
  transportFailed: 22,
  invalidFrame: 23,
})

export type ProfileLiveGatewayHelperTermination =
  | Readonly<{ kind: 'exit'; code: number }>
  | Readonly<{ kind: 'signal'; signal: string }>
  | Readonly<{ kind: 'spawn-error'; code?: string }>

export function classifyProfileLiveGatewayHelperTermination(
  termination: ProfileLiveGatewayHelperTermination,
): ProfileLiveGatewayInvocationResult {
  if (termination.kind !== 'exit') {
    return classifyProfileLiveGatewayUnavailable('transport-failure', 'unknown')
  }
  switch (termination.code) {
    case PROFILE_LIVE_GATEWAY_HELPER_EXIT.endpointAbsent:
      return classifyProfileLiveGatewayAbsent('endpoint-not-found')
    case PROFILE_LIVE_GATEWAY_HELPER_EXIT.peerRejected:
      return classifyProfileLiveGatewayUnavailable('peer-rejected', 'none')
    case PROFILE_LIVE_GATEWAY_HELPER_EXIT.invalidFrame:
      return classifyProfileLiveGatewayUnavailable('protocol-failure', 'admitted')
    case 0:
      return classifyProfileLiveGatewayUnavailable('disconnected', 'unknown')
    default:
      return classifyProfileLiveGatewayUnavailable('transport-failure', 'unknown')
  }
}
