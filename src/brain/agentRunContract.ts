import type { AgentRunAttribution } from '../graph/types'

export const AGENT_RUN_CONTRACT_VERSION = 2 as const

export const AGENT_RUN_LIVE_REQUIRED_MESSAGE =
  'Open Eido to run AI. Headless agent runs are not available.'
export const AGENT_RUN_NOT_FOUND_MESSAGE = 'The requested agent run was not found.'
export const AGENT_RUN_NOT_FINISHED_MESSAGE =
  'The agent run is still in progress. Poll status before reading its artifacts.'
export const AGENT_RUN_INVALID_REQUEST_MESSAGE = 'The agent run request is invalid.'
export const AGENT_RUN_INTERNAL_MESSAGE = 'The agent run did not complete.'
export const AGENT_RUN_SUBMIT_OUTCOME_UNKNOWN_MESSAGE =
  'The agent run submission outcome is unknown. Do not retry this submission.'
export const AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE =
  'Agent run budget is exhausted. Raise the cap or run from the app.'
export const AGENT_RUN_GRANT_REQUIRED_MESSAGE =
  'Approve this agent session in Eido before its first run.'
export const AGENT_RUN_GRANT_DENIED_MESSAGE =
  'This agent session is not approved to run AI in Eido.'

export const AGENT_RUN_ARTIFACT_READ_LIMITS = Object.freeze({
  defaultItems: 50,
  maxItems: 200,
  defaultBytes: 64 * 1024,
  maxBytes: 256 * 1024,
  maxCursorBytes: 4 * 1024,
})

export const AGENT_RUN_VARIATION_LIMITS = Object.freeze({
  maxCount: 8,
})

export type AgentRunTerminalStatus = 'done' | 'failed' | 'canceled'
export type AgentRunStatus = 'queued' | 'running' | AgentRunTerminalStatus
export type AgentRunMode = 'run' | 'variations'
export type AgentRunTargetKind = 'ask' | 'conversation'

export type AgentRunActor = AgentRunAttribution

/** Caller-controlled payload. Attribution, transport, and credentials are
 * deliberately absent; the live app supplies all three at its trusted seam. */
export type AgentRunSubmitRequestV1 = Readonly<{
  ideaId: string
  targetCardId: string
}>

export type AgentRunSubmitRequestV2 = Readonly<{
  ideaId: string
  targetCardId: string
  mode: 'variations'
  variationCount: number
}>

export type AgentRunSubmitRequest = AgentRunSubmitRequestV1 | AgentRunSubmitRequestV2

export type NormalizedAgentRunSubmitRequest = Readonly<{
  ideaId: string
  targetCardId: string
  mode: AgentRunMode
  /** One ordinary run is one execution; variations are explicitly bounded. */
  variationCount: number
}>

export function normalizeAgentRunSubmitRequest(
  candidate: unknown,
): NormalizedAgentRunSubmitRequest | undefined {
  if (!isRecord(candidate)
    || !boundedText(candidate.ideaId, 256)
    || !boundedText(candidate.targetCardId, 256)) return undefined
  const keys = Object.keys(candidate)
  if (keys.length === 2 && hasOnlyKeys(candidate, ['ideaId', 'targetCardId'])) {
    return Object.freeze({
      ideaId: candidate.ideaId,
      targetCardId: candidate.targetCardId,
      mode: 'run',
      variationCount: 1,
    })
  }
  if (keys.length !== 4
    || !hasOnlyKeys(candidate, ['ideaId', 'mode', 'targetCardId', 'variationCount'])
    || candidate.mode !== 'variations'
    || !positiveInteger(candidate.variationCount)
    || candidate.variationCount > AGENT_RUN_VARIATION_LIMITS.maxCount) return undefined
  return Object.freeze({
    ideaId: candidate.ideaId,
    targetCardId: candidate.targetCardId,
    mode: candidate.mode,
    variationCount: candidate.variationCount,
  })
}

export type AgentRunSubmissionReceipt = Readonly<{
  version: typeof AGENT_RUN_CONTRACT_VERSION
  runId: string
  ideaId: string
  targetCardId: string
  actor: AgentRunActor
  status: 'queued'
  submittedAt: string
  plannedStepIds: readonly string[]
  reusedStepIds: readonly string[]
}>

export type AgentRunJobStatus = Readonly<{
  version: typeof AGENT_RUN_CONTRACT_VERSION
  runId: string
  ideaId: string
  targetCardId: string
  actor: AgentRunActor
  status: AgentRunStatus
  submittedAt: string
  startedAt?: string
  finishedAt?: string
  plannedStepIds: readonly string[]
  executedStepIds: readonly string[]
  reusedStepIds: readonly string[]
  artifactCount: number
  error?: string
}>

export type AgentRunStatusRequest = Readonly<{ runId: string }>

export type AgentRunReadRequest = AgentRunArtifactReadRequest & Readonly<{
  runId: string
}>

export type AgentRunServiceFailureCode =
  | 'live-app-required'
  | 'invalid'
  | 'not-found'
  | 'run-not-finished'
  | 'budget-exhausted'
  | 'grant-required'
  | 'grant-denied'
  | 'internal'

export type AgentRunServiceFailure = Readonly<{
  ok: false
  code: AgentRunServiceFailureCode
  retryable: boolean
  message: string
}>

export type AgentRunServiceResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | AgentRunServiceFailure

export type AgentRunLiveService = Readonly<{
  submit(request: AgentRunSubmitRequest): Promise<AgentRunServiceResult<AgentRunSubmissionReceipt>>
  status(request: AgentRunStatusRequest): Promise<AgentRunServiceResult<AgentRunJobStatus>>
  read(request: AgentRunReadRequest): Promise<AgentRunServiceResult<AgentRunArtifactPage>>
}>

export type AgentRunArtifactReference = Readonly<{
  kind: 'run-record'
  recordId: string
  cardId: string
}> | Readonly<{
  kind: 'output-version'
  recordId: string
  outputId: string
  versionId: string
  cardId: string
}>

export type AgentRunArtifactReadRequest = Readonly<{
  limit?: number
  byteLimit?: number
  cursor?: string
}>

export type AgentRunArtifactPage = Readonly<{
  runId: string
  status: AgentRunTerminalStatus
  items: readonly AgentRunArtifactReference[]
  nextCursor?: string
  truncated: boolean
}>

export type AgentRunArtifactSource = Readonly<{
  runId: string
  status: AgentRunTerminalStatus
  artifacts: readonly AgentRunArtifactReference[]
}>

export type AgentRunArtifactReadResult =
  | Readonly<{ ok: true; value: AgentRunArtifactPage }>
  | Readonly<{
      ok: false
      code: 'invalid' | 'conflict'
      retryable: boolean
      message: string
    }>

type AgentRunArtifactCursor = Readonly<{
  version: typeof AGENT_RUN_CONTRACT_VERSION
  runId: string
  artifactCount: number
  position: number
}>

export function pageAgentRunArtifacts(
  source: AgentRunArtifactSource,
  request: unknown,
): AgentRunArtifactReadResult {
  if (!validSource(source) || !isRecord(request)
    || !hasOnlyKeys(request, ['byteLimit', 'cursor', 'limit'])) {
    return invalid()
  }
  const limit = request.limit ?? AGENT_RUN_ARTIFACT_READ_LIMITS.defaultItems
  const byteLimit = request.byteLimit ?? AGENT_RUN_ARTIFACT_READ_LIMITS.defaultBytes
  if (!positiveInteger(limit) || limit > AGENT_RUN_ARTIFACT_READ_LIMITS.maxItems
    || !positiveInteger(byteLimit) || byteLimit < 2
    || byteLimit > AGENT_RUN_ARTIFACT_READ_LIMITS.maxBytes
    || (request.cursor !== undefined
      && (!boundedText(request.cursor, AGENT_RUN_ARTIFACT_READ_LIMITS.maxCursorBytes)))) {
    return invalid()
  }

  let position = 0
  if (request.cursor !== undefined) {
    const cursor = decodeCursor(request.cursor)
    if (!cursor || cursor.version !== AGENT_RUN_CONTRACT_VERSION) return invalid()
    if (cursor.runId !== source.runId || cursor.artifactCount !== source.artifacts.length) {
      return Object.freeze({
        ok: false,
        code: 'conflict',
        retryable: true,
        message: 'The agent run artifacts changed. Restart the bounded read.',
      })
    }
    position = cursor.position
  }
  if (position > source.artifacts.length) return invalid()

  const items: AgentRunArtifactReference[] = []
  let encodedBytes = 2
  let nextPosition = position
  while (nextPosition < source.artifacts.length && items.length < limit) {
    const item = source.artifacts[nextPosition]!
    const itemBytes = utf8Bytes(JSON.stringify(item)) + (items.length === 0 ? 0 : 1)
    if (encodedBytes + itemBytes > byteLimit) {
      if (items.length === 0) return invalid()
      break
    }
    items.push(item)
    encodedBytes += itemBytes
    nextPosition += 1
  }

  const truncated = nextPosition < source.artifacts.length
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      runId: source.runId,
      status: source.status,
      items: Object.freeze(items),
      ...(truncated ? {
        nextCursor: encodeCursor({
          version: AGENT_RUN_CONTRACT_VERSION,
          runId: source.runId,
          artifactCount: source.artifacts.length,
          position: nextPosition,
        }),
      } : {}),
      truncated,
    }),
  })
}

function validSource(source: AgentRunArtifactSource): boolean {
  return isRecord(source)
    && hasOnlyKeys(source, ['artifacts', 'runId', 'status'])
    && boundedText(source.runId, 256)
    && (source.status === 'done' || source.status === 'failed' || source.status === 'canceled')
    && Array.isArray(source.artifacts)
    && source.artifacts.every(validArtifact)
}

function validArtifact(candidate: unknown): candidate is AgentRunArtifactReference {
  if (!isRecord(candidate) || !boundedText(candidate.recordId, 256)
    || !boundedText(candidate.cardId, 256)) return false
  if (candidate.kind === 'run-record') {
    return hasOnlyKeys(candidate, ['cardId', 'kind', 'recordId'])
  }
  return candidate.kind === 'output-version'
    && hasOnlyKeys(candidate, ['cardId', 'kind', 'outputId', 'recordId', 'versionId'])
    && boundedText(candidate.outputId, 256)
    && boundedText(candidate.versionId, 256)
    && candidate.recordId === candidate.versionId
}

function encodeCursor(cursor: AgentRunArtifactCursor): string {
  return encodeURIComponent(JSON.stringify(cursor))
}

function decodeCursor(candidate: string): AgentRunArtifactCursor | undefined {
  try {
    const decoded = JSON.parse(decodeURIComponent(candidate)) as unknown
    if (!isRecord(decoded)
      || !hasOnlyKeys(decoded, ['artifactCount', 'position', 'runId', 'version'])
      || decoded.version !== AGENT_RUN_CONTRACT_VERSION
      || !boundedText(decoded.runId, 256)
      || !nonNegativeInteger(decoded.artifactCount)
      || !nonNegativeInteger(decoded.position)) return undefined
    return decoded as AgentRunArtifactCursor
  } catch {
    return undefined
  }
}

function invalid(): AgentRunArtifactReadResult {
  return Object.freeze({
    ok: false,
    code: 'invalid',
    retryable: false,
    message: 'The agent run artifact read request is invalid.',
  })
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

function hasOnlyKeys(candidate: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(candidate).every((key) => keys.includes(key))
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

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
