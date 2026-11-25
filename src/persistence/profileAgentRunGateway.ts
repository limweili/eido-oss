import {
  AGENT_RUN_INTERNAL_MESSAGE,
  AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE,
  AGENT_RUN_GRANT_DENIED_MESSAGE,
  AGENT_RUN_GRANT_REQUIRED_MESSAGE,
  AGENT_RUN_INVALID_REQUEST_MESSAGE,
  AGENT_RUN_LIVE_REQUIRED_MESSAGE,
  AGENT_RUN_NOT_FINISHED_MESSAGE,
  AGENT_RUN_NOT_FOUND_MESSAGE,
  AGENT_RUN_SUBMIT_OUTCOME_UNKNOWN_MESSAGE,
  type AgentRunServiceFailure,
  type AgentRunServiceFailureCode,
  type AgentRunServiceResult,
} from '../brain/agentRunContract'
import type {
  ProfileServiceErrorCode,
  ProfileServiceResult,
} from './profileServiceContract'

export const PROFILE_AGENT_RUN_GATEWAY_OPERATIONS = Object.freeze([
  'run.submit',
  'run.status',
  'run.read',
] as const)

export type ProfileAgentRunGatewayOperation =
  (typeof PROFILE_AGENT_RUN_GATEWAY_OPERATIONS)[number]

export function isProfileAgentRunGatewayOperation(
  candidate: unknown,
): candidate is ProfileAgentRunGatewayOperation {
  return PROFILE_AGENT_RUN_GATEWAY_OPERATIONS.some((operation) => operation === candidate)
}

export type ProfileAgentRunGatewayFailureReason =
  | AgentRunServiceFailureCode
  | 'submit-outcome-unknown'

export type ProfileAgentRunGatewayFailure = Readonly<{
  ok: false
  code: ProfileServiceErrorCode
  reason: ProfileAgentRunGatewayFailureReason
  retryable: boolean
  message: string
}>

export type ProfileAgentRunGatewayResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | ProfileAgentRunGatewayFailure

export type ProfileAgentRunGatewayInvocationResult<Value> =
  | ProfileServiceResult<Value>
  | ProfileAgentRunGatewayFailure

export const PROFILE_AGENT_RUN_GATEWAY_FAILURES = Object.freeze([
  gatewayFailureDescription('live-app-required', 'busy', true, AGENT_RUN_LIVE_REQUIRED_MESSAGE),
  gatewayFailureDescription('invalid', 'invalid', false, AGENT_RUN_INVALID_REQUEST_MESSAGE),
  gatewayFailureDescription('not-found', 'not-found', false, AGENT_RUN_NOT_FOUND_MESSAGE),
  gatewayFailureDescription('run-not-finished', 'busy', true, AGENT_RUN_NOT_FINISHED_MESSAGE),
  gatewayFailureDescription(
    'budget-exhausted',
    'capability-denied',
    false,
    AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE,
  ),
  gatewayFailureDescription('grant-required', 'busy', true, AGENT_RUN_GRANT_REQUIRED_MESSAGE),
  gatewayFailureDescription(
    'grant-denied',
    'capability-denied',
    false,
    AGENT_RUN_GRANT_DENIED_MESSAGE,
  ),
  gatewayFailureDescription('internal', 'internal', true, AGENT_RUN_INTERNAL_MESSAGE),
  gatewayFailureDescription(
    'submit-outcome-unknown',
    'internal',
    false,
    AGENT_RUN_SUBMIT_OUTCOME_UNKNOWN_MESSAGE,
  ),
])

/**
 * Reversible adapter projection: Local Profile Service error codes and their
 * numeric CLI exits stay stable, while `reason` preserves the run-specific
 * action a caller must take.
 */
export function mapProfileAgentRunGatewayFailure(
  operation: ProfileAgentRunGatewayOperation,
  failure: AgentRunServiceFailure,
): ProfileAgentRunGatewayFailure {
  const reason: ProfileAgentRunGatewayFailureReason = operation === 'run.submit'
    && failure.code === 'internal'
    && failure.retryable === false
    ? 'submit-outcome-unknown'
    : failure.code
  return Object.freeze({
    ok: false,
    code: gatewayCategory(failure.code),
    reason,
    retryable: failure.retryable,
    message: failure.message,
  })
}

export function mapProfileAgentRunGatewayResult<Value>(
  operation: ProfileAgentRunGatewayOperation,
  result: AgentRunServiceResult<Value>,
): ProfileAgentRunGatewayResult<Value> {
  return result.ok ? result : mapProfileAgentRunGatewayFailure(operation, result)
}

export function profileAgentRunLiveRequiredGatewayFailure(
  operation: ProfileAgentRunGatewayOperation,
): ProfileAgentRunGatewayFailure {
  return mapProfileAgentRunGatewayFailure(operation, Object.freeze({
    ok: false,
    code: 'live-app-required',
    retryable: true,
    message: AGENT_RUN_LIVE_REQUIRED_MESSAGE,
  }))
}

export function profileAgentRunSubmitOutcomeUnknownGatewayFailure(): ProfileAgentRunGatewayFailure {
  return mapProfileAgentRunGatewayFailure('run.submit', Object.freeze({
    ok: false,
    code: 'internal',
    retryable: false,
    message: AGENT_RUN_SUBMIT_OUTCOME_UNKNOWN_MESSAGE,
  }))
}

function gatewayCategory(code: AgentRunServiceFailureCode): ProfileServiceErrorCode {
  switch (code) {
    case 'live-app-required':
    case 'run-not-finished':
    case 'grant-required':
      return 'busy'
    case 'budget-exhausted':
    case 'grant-denied':
      return 'capability-denied'
    case 'invalid':
    case 'not-found':
    case 'internal':
      return code
  }
}

function gatewayFailureDescription(
  reason: ProfileAgentRunGatewayFailureReason,
  code: ProfileServiceErrorCode,
  retryable: boolean,
  message: string,
) {
  return Object.freeze({ reason, code, retryable, message })
}
