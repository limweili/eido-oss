import {
  assertProfileAgentRunWireRequest,
  PROFILE_AGENT_RUN_BRIDGE_VERSION,
  PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT,
  PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT,
  type ProfileAgentRunWireRequest,
  type ProfileAgentRunWireResponse,
} from '../../electron/profileAgentRunBridgeContract'
import {
  AGENT_RUN_INTERNAL_MESSAGE,
  AGENT_RUN_SUBMIT_OUTCOME_UNKNOWN_MESSAGE,
} from '../brain/agentRunContract'
import type { ProfileAgentRunRendererService } from './profileAgentRunRendererService'

/**
 * Installs the renderer half of the bounded main/preload/renderer run bridge.
 * The app-scoped service is injected once by bootstrap; this handler neither
 * owns provider material nor exposes model output across the bridge.
 */
export function registerProfileAgentRunBridgeHandler(
  target: EventTarget,
  service: Pick<ProfileAgentRunRendererService, 'dispatch'>,
): () => void {
  let registered = true

  const respond = (response: ProfileAgentRunWireResponse): void => {
    if (!registered) return
    target.dispatchEvent(new CustomEvent(PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT, {
      detail: response,
    }))
  }

  const handle = async (request: ProfileAgentRunWireRequest): Promise<void> => {
    try {
      const candidate = await service.dispatch(request) as ProfileAgentRunWireResponse
      if (candidate.token !== request.token || candidate.operation !== request.operation) {
        throw new Error('Profile Agent run renderer response correlation changed')
      }
      respond(candidate)
    } catch {
      respond(internalResponse(request))
    }
  }

  const listener: EventListener = (event) => {
    let request: ProfileAgentRunWireRequest
    try {
      request = assertProfileAgentRunWireRequest((event as CustomEvent<unknown>).detail)
    } catch {
      return
    }
    void handle(request)
  }

  target.addEventListener(PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT, listener)
  return () => {
    if (!registered) return
    registered = false
    target.removeEventListener(PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT, listener)
  }
}

function internalResponse(request: ProfileAgentRunWireRequest): ProfileAgentRunWireResponse {
  if (request.operation === 'run.submit') {
    return rendererWireResponse(request.token, request.operation, Object.freeze({
      ok: false as const,
      code: 'internal' as const,
      retryable: false,
      message: AGENT_RUN_SUBMIT_OUTCOME_UNKNOWN_MESSAGE,
    }))
  }
  const failure = Object.freeze({
    ok: false as const,
    code: 'internal' as const,
    retryable: true,
    message: AGENT_RUN_INTERNAL_MESSAGE,
  })
  if (request.operation === 'run.status') {
    return rendererWireResponse(request.token, request.operation, failure)
  }
  return rendererWireResponse(request.token, request.operation, failure)
}

function rendererWireResponse<Operation extends ProfileAgentRunWireResponse['operation']>(
  token: string,
  operation: Operation,
  result: Extract<ProfileAgentRunWireResponse, { operation: Operation }>['result'],
): Extract<ProfileAgentRunWireResponse, { operation: Operation }> {
  return Object.freeze({
    version: PROFILE_AGENT_RUN_BRIDGE_VERSION,
    kind: 'agent-run-response',
    token,
    operation,
    result,
  }) as Extract<ProfileAgentRunWireResponse, { operation: Operation }>
}
