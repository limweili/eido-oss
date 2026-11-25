import type { IntentClaimedTransitionEvidence } from '../graph/types'
import { PROFILE_AGENT_COMMAND_LIMITS } from './profileAgentCommandManifest'

export const PROFILE_AGENT_EVENT_RECORD_VERSION = 1 as const

export type ProfileAgentEventDraft =
  | Readonly<{
      version: 1
      type: 'idea.created'
      ideaId: string
      boardId: string
      ideaName: string
    }>
  | Readonly<{
      version: 1
      type: 'idea.activated'
      previousActiveIdeaId: string
      activeIdeaId: string
    }>
  | Readonly<{
      version: 1
      type: 'mod-template.created'
      templateId: string
      templateVersion: number
    }>
  | Readonly<{
      version: 1
      type: 'mod-template.updated'
      templateId: string
      previousTemplateVersion: number
      newTemplateVersion: number
    }>
  | Readonly<{
      version: 1
      type: 'mod-template.deleted'
      templateId: string
      deletedTemplateVersion: number
    }>

type ProfileAgentEventStamp = Readonly<{
  id: string
  seq: number
  at: string
  profileId: string
  commitId: string
  actorId: string
  clientTxnId: string
  claimedTransitionEvidence: IntentClaimedTransitionEvidence
}>

export type ProfileAgentEventPayload = ProfileAgentEventDraft & ProfileAgentEventStamp

export type ProfileAgentEventRecord = Readonly<{
  kind: 'profile-agent-event'
  recordId: string
  ownerId: string
  parentId: string
  recordVersion: typeof PROFILE_AGENT_EVENT_RECORD_VERSION
  payload: ProfileAgentEventPayload
}>

export type ProfileAgentEventFailureCode = 'invalid' | 'unsupported-future-version'

export type ProfileAgentEventResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; code: ProfileAgentEventFailureCode; message: string }>

export function decodeProfileAgentEventRecord(
  value: unknown,
): ProfileAgentEventResult<ProfileAgentEventRecord> {
  const record = inertRecord(value)
  if (!record || !hasExactKeys(record, [
    'kind',
    'ownerId',
    'parentId',
    'payload',
    'recordId',
    'recordVersion',
  ])) return invalid('Profile Agent event record must have the exact record envelope')

  if (futureVersion(record.recordVersion)) {
    return failure(
      'unsupported-future-version',
      `Profile Agent event record version ${String(record.recordVersion)} is not supported`,
    )
  }
  if (record.kind !== 'profile-agent-event'
    || record.recordVersion !== PROFILE_AGENT_EVENT_RECORD_VERSION
    || !validId(record.recordId)
    || !validId(record.ownerId)
    || record.parentId !== record.ownerId) {
    return invalid('Profile Agent event record envelope is invalid')
  }

  const payload = decodePayload(record.payload)
  if (!payload.ok) return payload
  if (payload.value.id !== record.recordId || payload.value.profileId !== record.ownerId) {
    return invalid('Profile Agent event identity does not match its Profile-owned envelope')
  }

  return success(deepFreeze({
    kind: 'profile-agent-event' as const,
    recordId: record.recordId,
    ownerId: record.ownerId,
    parentId: record.parentId,
    recordVersion: PROFILE_AGENT_EVENT_RECORD_VERSION,
    payload: payload.value,
  }))
}

function decodePayload(value: unknown): ProfileAgentEventResult<ProfileAgentEventPayload> {
  const payload = inertRecord(value)
  if (!payload) return invalid('Profile Agent event payload must be an inert object')
  if (futureVersion(payload.version)) {
    return failure(
      'unsupported-future-version',
      `Profile Agent event payload version ${String(payload.version)} is not supported`,
    )
  }
  if (payload.version !== PROFILE_AGENT_EVENT_RECORD_VERSION
    || !validId(payload.id)
    || !positiveSafeInteger(payload.seq)
    || !canonicalTimestamp(payload.at)
    || !validId(payload.profileId)
    || !validId(payload.commitId)
    || !validId(payload.actorId)
    || !validId(payload.clientTxnId)
    || !validClaimedTransitionEvidence(payload.claimedTransitionEvidence)) {
    return invalid('Profile Agent event payload stamps are invalid')
  }

  const common = {
    version: PROFILE_AGENT_EVENT_RECORD_VERSION,
    id: payload.id,
    seq: payload.seq,
    at: payload.at,
    profileId: payload.profileId,
    commitId: payload.commitId,
    actorId: payload.actorId,
    clientTxnId: payload.clientTxnId,
    claimedTransitionEvidence: Object.freeze({
      version: 1 as const,
      count: payload.claimedTransitionEvidence.count,
      sha256: payload.claimedTransitionEvidence.sha256,
    }),
  }

  switch (payload.type) {
    case 'idea.created':
      if (!hasExactKeys(payload, [
        'actorId', 'at', 'boardId', 'claimedTransitionEvidence', 'clientTxnId', 'commitId',
        'id', 'ideaId', 'ideaName', 'profileId', 'seq', 'type', 'version',
      ])
        || !validId(payload.ideaId)
        || !validId(payload.boardId)
        || payload.boardId !== `board:${payload.ideaId}`
        || !boundedNonEmptyText(payload.ideaName)
        || payload.ideaName !== payload.ideaName.trim()) {
        return invalid('Profile Agent Idea-created event is invalid')
      }
      return success(deepFreeze({
        ...common,
        type: payload.type,
        ideaId: payload.ideaId,
        boardId: payload.boardId,
        ideaName: payload.ideaName,
      }))
    case 'idea.activated':
      if (!hasExactKeys(payload, [
        'activeIdeaId', 'actorId', 'at', 'claimedTransitionEvidence', 'clientTxnId', 'commitId',
        'id', 'previousActiveIdeaId', 'profileId', 'seq', 'type', 'version',
      ])
        || !validId(payload.previousActiveIdeaId)
        || !validId(payload.activeIdeaId)
        || payload.previousActiveIdeaId === payload.activeIdeaId) {
        return invalid('Profile Agent Idea-activated event is invalid')
      }
      return success(deepFreeze({
        ...common,
        type: payload.type,
        previousActiveIdeaId: payload.previousActiveIdeaId,
        activeIdeaId: payload.activeIdeaId,
      }))
    case 'mod-template.created':
      if (!hasExactKeys(payload, [
        'actorId', 'at', 'claimedTransitionEvidence', 'clientTxnId', 'commitId', 'id',
        'profileId', 'seq', 'templateId', 'templateVersion', 'type', 'version',
      ])
        || !validId(payload.templateId)
        || !positiveSafeInteger(payload.templateVersion)) {
        return invalid('Profile Agent template-created event is invalid')
      }
      return success(deepFreeze({
        ...common,
        type: payload.type,
        templateId: payload.templateId,
        templateVersion: payload.templateVersion,
      }))
    case 'mod-template.updated':
      if (!hasExactKeys(payload, [
        'actorId', 'at', 'claimedTransitionEvidence', 'clientTxnId', 'commitId', 'id',
        'newTemplateVersion', 'previousTemplateVersion', 'profileId', 'seq', 'templateId',
        'type', 'version',
      ])
        || !validId(payload.templateId)
        || !positiveSafeInteger(payload.previousTemplateVersion)
        || !positiveSafeInteger(payload.newTemplateVersion)
        || payload.newTemplateVersion !== payload.previousTemplateVersion + 1) {
        return invalid('Profile Agent template-updated event is invalid')
      }
      return success(deepFreeze({
        ...common,
        type: payload.type,
        templateId: payload.templateId,
        previousTemplateVersion: payload.previousTemplateVersion,
        newTemplateVersion: payload.newTemplateVersion,
      }))
    case 'mod-template.deleted':
      if (!hasExactKeys(payload, [
        'actorId', 'at', 'claimedTransitionEvidence', 'clientTxnId', 'commitId',
        'deletedTemplateVersion', 'id', 'profileId', 'seq', 'templateId', 'type', 'version',
      ])
        || !validId(payload.templateId)
        || !positiveSafeInteger(payload.deletedTemplateVersion)) {
        return invalid('Profile Agent template-deleted event is invalid')
      }
      return success(deepFreeze({
        ...common,
        type: payload.type,
        templateId: payload.templateId,
        deletedTemplateVersion: payload.deletedTemplateVersion,
      }))
    default:
      return invalid('Profile Agent event type is invalid')
  }
}

function validClaimedTransitionEvidence(
  value: unknown,
): value is IntentClaimedTransitionEvidence {
  const evidence = inertRecord(value)
  return evidence !== undefined
    && hasExactKeys(evidence, ['count', 'sha256', 'version'])
    && evidence.version === 1
    && nonNegativeSafeInteger(evidence.count)
    && typeof evidence.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(evidence.sha256)
}

function inertRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string')) return undefined
  const descriptors = Object.getOwnPropertyDescriptors(value)
  if (Object.values(descriptors).some((descriptor) => (
    !('value' in descriptor) || descriptor.enumerable !== true
  ))) return undefined
  return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) => [
    key,
    descriptor.value,
  ]))
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort()
  const sorted = [...expected].sort()
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index])
}

function futureVersion(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > PROFILE_AGENT_EVENT_RECORD_VERSION
}

function validId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes
}

function boundedNonEmptyText(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function success<Value>(value: Value): ProfileAgentEventResult<Value> {
  return Object.freeze({ ok: true, value })
}

function invalid(message: string): ProfileAgentEventResult<never> {
  return failure('invalid', message)
}

function failure(
  code: ProfileAgentEventFailureCode,
  message: string,
): ProfileAgentEventResult<never> {
  return Object.freeze({ ok: false, code, message })
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value
  const stack: object[] = [value]
  const visited = new WeakSet<object>()
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === 'object') stack.push(child)
    }
    Object.freeze(current)
  }
  return value
}
