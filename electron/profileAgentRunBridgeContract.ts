import {
  AGENT_RUN_ARTIFACT_READ_LIMITS,
  AGENT_RUN_CONTRACT_VERSION,
  normalizeAgentRunSubmitRequest,
  type AgentRunActor,
  type AgentRunArtifactPage,
  type AgentRunArtifactReference,
  type AgentRunJobStatus,
  type AgentRunReadRequest,
  type AgentRunServiceFailure,
  type AgentRunServiceFailureCode,
  type AgentRunServiceResult,
  type AgentRunStatusRequest,
  type AgentRunSubmissionReceipt,
  type AgentRunSubmitRequest,
} from '../src/brain/agentRunContract'

export const PROFILE_AGENT_RUN_BRIDGE_VERSION = 1 as const
export const PROFILE_AGENT_RUN_BRIDGE_CHANNEL = 'eido:profile-agent-run:v1' as const
export const PROFILE_RENDERER_AGENT_RUN_REQUEST_EVENT =
  'eido:profile-agent-run-request' as const
export const PROFILE_RENDERER_AGENT_RUN_RESPONSE_EVENT =
  'eido:profile-agent-run-response' as const

export const PROFILE_AGENT_RUN_BRIDGE_LIMITS = Object.freeze({
  maxRequestBytes: 16 * 1024,
  maxResponseBytes: 512 * 1024,
  maxTokenBytes: 256,
  maxIdentityBytes: 256,
  maxMessageBytes: 4 * 1024,
})

export type ProfileAgentRunOperation = 'run.submit' | 'run.status' | 'run.read'

type ProfileAgentRunPayloads = Readonly<{
  'run.submit': AgentRunSubmitRequest
  'run.status': AgentRunStatusRequest
  'run.read': AgentRunReadRequest
}>

type ProfileAgentRunResults = Readonly<{
  'run.submit': AgentRunServiceResult<AgentRunSubmissionReceipt>
  'run.status': AgentRunServiceResult<AgentRunJobStatus>
  'run.read': AgentRunServiceResult<AgentRunArtifactPage>
}>

export type ProfileAgentRunWireRequestFor<
  Operation extends ProfileAgentRunOperation,
> = Readonly<{
  version: typeof PROFILE_AGENT_RUN_BRIDGE_VERSION
  kind: 'agent-run-request'
  token: string
  actor: AgentRunActor
  operation: Operation
  payload: ProfileAgentRunPayloads[Operation]
}>

export type ProfileAgentRunWireRequest = {
  [Operation in ProfileAgentRunOperation]: ProfileAgentRunWireRequestFor<Operation>
}[ProfileAgentRunOperation]

export type ProfileAgentRunWireResponseFor<
  Operation extends ProfileAgentRunOperation,
> = Readonly<{
  version: typeof PROFILE_AGENT_RUN_BRIDGE_VERSION
  kind: 'agent-run-response'
  token: string
  operation: Operation
  result: ProfileAgentRunResults[Operation]
}>

export type ProfileAgentRunWireResponse = {
  [Operation in ProfileAgentRunOperation]: ProfileAgentRunWireResponseFor<Operation>
}[ProfileAgentRunOperation]

export function createProfileAgentRunWireRequest<Operation extends ProfileAgentRunOperation>(
  token: string,
  actor: AgentRunActor,
  operation: Operation,
  payload: ProfileAgentRunPayloads[Operation],
): ProfileAgentRunWireRequestFor<Operation> {
  return assertProfileAgentRunWireRequest({
    version: PROFILE_AGENT_RUN_BRIDGE_VERSION,
    kind: 'agent-run-request',
    token,
    actor,
    operation,
    payload,
  }) as ProfileAgentRunWireRequestFor<Operation>
}

export function assertProfileAgentRunWireRequest(
  candidate: unknown,
): ProfileAgentRunWireRequest {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, [
      'version',
      'kind',
      'token',
      'actor',
      'operation',
      'payload',
    ])
    || candidate.version !== PROFILE_AGENT_RUN_BRIDGE_VERSION
    || candidate.kind !== 'agent-run-request'
    || !boundedText(candidate.token, PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxTokenBytes)
    || !validActor(candidate.actor)
    || !validOperation(candidate.operation)
    || !validRequestPayload(candidate.operation, candidate.payload)
    || encodedBytes(candidate) > PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxRequestBytes) {
    throw new Error('Agent run renderer request is invalid')
  }
  return Object.freeze({
    version: PROFILE_AGENT_RUN_BRIDGE_VERSION,
    kind: 'agent-run-request',
    token: candidate.token,
    actor: freezeActor(candidate.actor),
    operation: candidate.operation,
    payload: freezeRequestPayload(
      candidate.operation,
      candidate.payload as AgentRunSubmitRequest | AgentRunStatusRequest | AgentRunReadRequest,
    ),
  }) as ProfileAgentRunWireRequest
}

export function createProfileAgentRunWireResponse<Operation extends ProfileAgentRunOperation>(
  token: string,
  operation: Operation,
  result: ProfileAgentRunResults[Operation],
): ProfileAgentRunWireResponseFor<Operation> {
  return assertProfileAgentRunWireResponse({
    version: PROFILE_AGENT_RUN_BRIDGE_VERSION,
    kind: 'agent-run-response',
    token,
    operation,
    result,
  }) as ProfileAgentRunWireResponseFor<Operation>
}

export function assertProfileAgentRunWireResponse(
  candidate: unknown,
): ProfileAgentRunWireResponse {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, [
      'version',
      'kind',
      'token',
      'operation',
      'result',
    ])
    || candidate.version !== PROFILE_AGENT_RUN_BRIDGE_VERSION
    || candidate.kind !== 'agent-run-response'
    || !boundedText(candidate.token, PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxTokenBytes)
    || !validOperation(candidate.operation)
    || !validResult(candidate.operation, candidate.result)
    || encodedBytes(candidate) > PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxResponseBytes) {
    throw new Error('Agent run renderer response is invalid')
  }
  return Object.freeze({
    version: PROFILE_AGENT_RUN_BRIDGE_VERSION,
    kind: 'agent-run-response',
    token: candidate.token,
    operation: candidate.operation,
    result: freezeResult(
      candidate.operation,
      candidate.result as ProfileAgentRunResults[ProfileAgentRunOperation],
    ),
  }) as ProfileAgentRunWireResponse
}

function validOperation(candidate: unknown): candidate is ProfileAgentRunOperation {
  return candidate === 'run.submit' || candidate === 'run.status' || candidate === 'run.read'
}

function validRequestPayload(
  operation: ProfileAgentRunOperation,
  candidate: unknown,
): boolean {
  if (operation === 'run.submit') return validSubmit(candidate)
  if (operation === 'run.status') return validStatusRequest(candidate)
  return validReadRequest(candidate)
}

function freezeRequestPayload(
  operation: ProfileAgentRunOperation,
  candidate: AgentRunSubmitRequest | AgentRunStatusRequest | AgentRunReadRequest,
): AgentRunSubmitRequest | AgentRunStatusRequest | AgentRunReadRequest {
  if (operation === 'run.submit') {
    const payload = candidate as AgentRunSubmitRequest
    const normalized = normalizeAgentRunSubmitRequest(payload)!
    return normalized.mode === 'run'
      ? Object.freeze({ ideaId: normalized.ideaId, targetCardId: normalized.targetCardId })
      : Object.freeze({
          ideaId: normalized.ideaId,
          targetCardId: normalized.targetCardId,
          mode: 'variations',
          variationCount: normalized.variationCount,
        })
  }
  if (operation === 'run.status') {
    const payload = candidate as AgentRunStatusRequest
    return Object.freeze({ runId: payload.runId })
  }
  const payload = candidate as AgentRunReadRequest
  return Object.freeze({
    runId: payload.runId,
    ...(payload.limit === undefined ? {} : { limit: payload.limit }),
    ...(payload.byteLimit === undefined ? {} : { byteLimit: payload.byteLimit }),
    ...(payload.cursor === undefined ? {} : { cursor: payload.cursor }),
  })
}

function validResult(operation: ProfileAgentRunOperation, candidate: unknown): boolean {
  if (!isRecord(candidate)) return false
  if (candidate.ok === false) return validFailure(candidate)
  if (candidate.ok !== true || !hasExactKeys(candidate, ['ok', 'value'])) return false
  if (operation === 'run.submit') return validReceipt(candidate.value)
  if (operation === 'run.status') return validJobStatus(candidate.value)
  return validArtifactPage(candidate.value)
}

function freezeResult(
  operation: ProfileAgentRunOperation,
  candidate: ProfileAgentRunResults[ProfileAgentRunOperation],
): ProfileAgentRunResults[ProfileAgentRunOperation] {
  if (!candidate.ok) return Object.freeze({ ...candidate })
  if (operation === 'run.submit') {
    const value = candidate.value as AgentRunSubmissionReceipt
    return Object.freeze({ ok: true, value: freezeReceipt(value) })
  }
  if (operation === 'run.status') {
    const value = candidate.value as AgentRunJobStatus
    return Object.freeze({ ok: true, value: freezeJobStatus(value) })
  }
  const value = candidate.value as AgentRunArtifactPage
  return Object.freeze({ ok: true, value: freezeArtifactPage(value) })
}

function validActor(candidate: unknown): candidate is AgentRunActor {
  return isRecord(candidate)
    && hasExactKeys(candidate, ['kind', 'client', 'sessionId'])
    && candidate.kind === 'agent'
    && boundedIdentity(candidate.client)
    && boundedIdentity(candidate.sessionId)
}

function freezeActor(actor: AgentRunActor): AgentRunActor {
  return Object.freeze({ kind: 'agent', client: actor.client, sessionId: actor.sessionId })
}

function validSubmit(candidate: unknown): candidate is AgentRunSubmitRequest {
  return normalizeAgentRunSubmitRequest(candidate) !== undefined
}

function validStatusRequest(candidate: unknown): candidate is AgentRunStatusRequest {
  return isRecord(candidate)
    && hasExactKeys(candidate, ['runId'])
    && boundedIdentity(candidate.runId)
}

function validReadRequest(candidate: unknown): candidate is AgentRunReadRequest {
  return isRecord(candidate)
    && hasOnlyKeys(candidate, ['runId', 'limit', 'byteLimit', 'cursor'])
    && Object.prototype.hasOwnProperty.call(candidate, 'runId')
    && boundedIdentity(candidate.runId)
    && (candidate.limit === undefined
      || (positiveInteger(candidate.limit)
        && candidate.limit <= AGENT_RUN_ARTIFACT_READ_LIMITS.maxItems))
    && (candidate.byteLimit === undefined
      || (positiveInteger(candidate.byteLimit)
        && candidate.byteLimit >= 2
        && candidate.byteLimit <= AGENT_RUN_ARTIFACT_READ_LIMITS.maxBytes))
    && (candidate.cursor === undefined
      || boundedText(candidate.cursor, AGENT_RUN_ARTIFACT_READ_LIMITS.maxCursorBytes))
}

function validFailure(candidate: Record<string, unknown>): candidate is AgentRunServiceFailure {
  return hasExactKeys(candidate, ['ok', 'code', 'retryable', 'message'])
    && candidate.ok === false
    && validFailureCode(candidate.code)
    && typeof candidate.retryable === 'boolean'
    && boundedText(candidate.message, PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxMessageBytes)
}

function validFailureCode(candidate: unknown): candidate is AgentRunServiceFailureCode {
  return candidate === 'live-app-required'
    || candidate === 'invalid'
    || candidate === 'not-found'
    || candidate === 'run-not-finished'
    || candidate === 'budget-exhausted'
    || candidate === 'grant-required'
    || candidate === 'grant-denied'
    || candidate === 'internal'
}

function validReceipt(candidate: unknown): candidate is AgentRunSubmissionReceipt {
  return isRecord(candidate)
    && hasExactKeys(candidate, [
      'version',
      'runId',
      'ideaId',
      'targetCardId',
      'actor',
      'status',
      'submittedAt',
      'plannedStepIds',
      'reusedStepIds',
    ])
    && candidate.version === AGENT_RUN_CONTRACT_VERSION
    && boundedIdentity(candidate.runId)
    && boundedIdentity(candidate.ideaId)
    && boundedIdentity(candidate.targetCardId)
    && validActor(candidate.actor)
    && candidate.status === 'queued'
    && boundedText(candidate.submittedAt, PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxIdentityBytes)
    && validIds(candidate.plannedStepIds)
    && validIds(candidate.reusedStepIds)
}

function freezeReceipt(value: AgentRunSubmissionReceipt): AgentRunSubmissionReceipt {
  return Object.freeze({
    version: AGENT_RUN_CONTRACT_VERSION,
    runId: value.runId,
    ideaId: value.ideaId,
    targetCardId: value.targetCardId,
    actor: freezeActor(value.actor),
    status: 'queued',
    submittedAt: value.submittedAt,
    plannedStepIds: Object.freeze([...value.plannedStepIds]),
    reusedStepIds: Object.freeze([...value.reusedStepIds]),
  })
}

function validJobStatus(candidate: unknown): candidate is AgentRunJobStatus {
  if (!isRecord(candidate)
    || !hasOnlyKeys(candidate, [
      'version',
      'runId',
      'ideaId',
      'targetCardId',
      'actor',
      'status',
      'submittedAt',
      'startedAt',
      'finishedAt',
      'plannedStepIds',
      'executedStepIds',
      'reusedStepIds',
      'artifactCount',
      'error',
    ])
    || !hasRequiredKeys(candidate, [
      'version',
      'runId',
      'ideaId',
      'targetCardId',
      'actor',
      'status',
      'submittedAt',
      'plannedStepIds',
      'executedStepIds',
      'reusedStepIds',
      'artifactCount',
    ])) return false
  return candidate.version === AGENT_RUN_CONTRACT_VERSION
    && boundedIdentity(candidate.runId)
    && boundedIdentity(candidate.ideaId)
    && boundedIdentity(candidate.targetCardId)
    && validActor(candidate.actor)
    && validJobState(candidate.status)
    && boundedText(candidate.submittedAt, PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxIdentityBytes)
    && optionalBoundedText(candidate.startedAt, PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxIdentityBytes)
    && optionalBoundedText(candidate.finishedAt, PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxIdentityBytes)
    && validIds(candidate.plannedStepIds)
    && validIds(candidate.executedStepIds)
    && validIds(candidate.reusedStepIds)
    && nonNegativeInteger(candidate.artifactCount)
    && optionalBoundedText(candidate.error, PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxMessageBytes)
}

function freezeJobStatus(value: AgentRunJobStatus): AgentRunJobStatus {
  return Object.freeze({
    version: AGENT_RUN_CONTRACT_VERSION,
    runId: value.runId,
    ideaId: value.ideaId,
    targetCardId: value.targetCardId,
    actor: freezeActor(value.actor),
    status: value.status,
    submittedAt: value.submittedAt,
    ...(value.startedAt === undefined ? {} : { startedAt: value.startedAt }),
    ...(value.finishedAt === undefined ? {} : { finishedAt: value.finishedAt }),
    plannedStepIds: Object.freeze([...value.plannedStepIds]),
    executedStepIds: Object.freeze([...value.executedStepIds]),
    reusedStepIds: Object.freeze([...value.reusedStepIds]),
    artifactCount: value.artifactCount,
    ...(value.error === undefined ? {} : { error: value.error }),
  })
}

function validArtifactPage(candidate: unknown): candidate is AgentRunArtifactPage {
  if (!isRecord(candidate)
    || !hasOnlyKeys(candidate, ['runId', 'status', 'items', 'nextCursor', 'truncated'])
    || !hasRequiredKeys(candidate, ['runId', 'status', 'items', 'truncated'])
    || !boundedIdentity(candidate.runId)
    || !validTerminalState(candidate.status)
    || !Array.isArray(candidate.items)
    || candidate.items.length > AGENT_RUN_ARTIFACT_READ_LIMITS.maxItems
    || !candidate.items.every(validArtifact)
    || typeof candidate.truncated !== 'boolean'
    || !optionalBoundedText(candidate.nextCursor, AGENT_RUN_ARTIFACT_READ_LIMITS.maxCursorBytes)) {
    return false
  }
  return candidate.truncated
    ? boundedText(candidate.nextCursor, AGENT_RUN_ARTIFACT_READ_LIMITS.maxCursorBytes)
    : candidate.nextCursor === undefined
}

function freezeArtifactPage(value: AgentRunArtifactPage): AgentRunArtifactPage {
  return Object.freeze({
    runId: value.runId,
    status: value.status,
    items: Object.freeze(value.items.map(freezeArtifact)),
    ...(value.nextCursor === undefined ? {} : { nextCursor: value.nextCursor }),
    truncated: value.truncated,
  })
}

function validArtifact(candidate: unknown): candidate is AgentRunArtifactReference {
  if (!isRecord(candidate)
    || !boundedIdentity(candidate.recordId)
    || !boundedIdentity(candidate.cardId)) return false
  if (candidate.kind === 'run-record') {
    return hasExactKeys(candidate, ['kind', 'recordId', 'cardId'])
  }
  return candidate.kind === 'output-version'
    && hasExactKeys(candidate, ['kind', 'recordId', 'outputId', 'versionId', 'cardId'])
    && boundedIdentity(candidate.outputId)
    && boundedIdentity(candidate.versionId)
    && candidate.recordId === candidate.versionId
}

function freezeArtifact(value: AgentRunArtifactReference): AgentRunArtifactReference {
  return value.kind === 'run-record'
    ? Object.freeze({ kind: value.kind, recordId: value.recordId, cardId: value.cardId })
    : Object.freeze({
        kind: value.kind,
        recordId: value.recordId,
        outputId: value.outputId,
        versionId: value.versionId,
        cardId: value.cardId,
      })
}

function validIds(candidate: unknown): candidate is readonly string[] {
  return Array.isArray(candidate) && candidate.every(boundedIdentity)
}

function validJobState(candidate: unknown): boolean {
  return candidate === 'queued'
    || candidate === 'running'
    || validTerminalState(candidate)
}

function validTerminalState(candidate: unknown): boolean {
  return candidate === 'done' || candidate === 'failed' || candidate === 'canceled'
}

function encodedBytes(candidate: unknown): number {
  try {
    const encoded = JSON.stringify(candidate)
    return encoded === undefined ? Number.POSITIVE_INFINITY : utf8Bytes(encoded)
  } catch {
    return Number.POSITIVE_INFINITY
  }
}

function boundedIdentity(candidate: unknown): candidate is string {
  return boundedText(candidate, PROFILE_AGENT_RUN_BRIDGE_LIMITS.maxIdentityBytes)
}

function optionalBoundedText(candidate: unknown, maxBytes: number): boolean {
  return candidate === undefined || boundedText(candidate, maxBytes)
}

function boundedText(candidate: unknown, maxBytes: number): candidate is string {
  return typeof candidate === 'string'
    && candidate.length > 0
    && utf8Bytes(candidate) <= maxBytes
}

function positiveInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && (candidate as number) > 0
}

function nonNegativeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && (candidate as number) >= 0
}

function utf8Bytes(candidate: string): number {
  return new TextEncoder().encode(candidate).byteLength
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

function hasExactKeys(candidate: Record<string, unknown>, keys: readonly string[]): boolean {
  return hasOnlyKeys(candidate, keys) && Object.keys(candidate).length === keys.length
}

function hasOnlyKeys(candidate: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(candidate).every((key) => keys.includes(key))
}

function hasRequiredKeys(candidate: Record<string, unknown>, keys: readonly string[]): boolean {
  return keys.every((key) => Object.prototype.hasOwnProperty.call(candidate, key))
}
