import { formatCardDeepLink } from '../shared/deepLinks'
import {
  PROFILE_AGENT_COMMAND_NAMES,
} from './profileAgentCommandManifest'
import {
  PROFILE_GATEWAY_PROTOCOL_VERSION,
  PROFILE_QUERYABLE_RECORD_KINDS,
  profileServiceFailure,
  type ProfileQueryableRecordKind,
  type ProfileServiceResult,
} from './profileServiceContract'

export const PROFILE_AGENT_CHANGE_TRAIL_LIMITS = Object.freeze({
  defaultItems: 50,
  maxItems: 200,
  defaultBytes: 64 * 1024,
  maxBytes: 256 * 1024,
  maxCursorBytes: 256 * 1024,
})

// Change-trail actions include installed storage commands plus ordinary Run
// submissions performed through the trusted live Agent execution seam. A Run
// is not fabricated as a Card command merely to fit the historical shape.
export const PROFILE_AGENT_CHANGE_TRAIL_ACTION_NAMES = Object.freeze([
  ...PROFILE_AGENT_COMMAND_NAMES,
  'run.submit',
] as const)

export type ProfileAgentChangeTrailActionName =
  (typeof PROFILE_AGENT_CHANGE_TRAIL_ACTION_NAMES)[number]

export type ProfileAgentChangeTrailRequest = Readonly<{
  since?: number
  limit?: number
  byteLimit?: number
  cursor?: string
}>

export type NormalizedProfileAgentChangeTrailRequest = Readonly<{
  since: number
  limit: number
  byteLimit: number
  cursor?: string
}>

export type ProfileAgentChangeTrailRecord = Readonly<{
  revision: number
  committedAt: string
  actor: Readonly<{
    kind: 'agent'
    client: string | null
    sessionId: string | null
  }>
  command: Readonly<{
    id: string
    name: ProfileAgentChangeTrailActionName
  }>
  ideaId: string | null
  recordId: string
  recordKind: ProfileQueryableRecordKind
  changeKind: 'insert' | 'update' | 'delete'
  position?: Readonly<{ x: number; y: number }>
}>

export type ProfileAgentChangeTrailItem = ProfileAgentChangeTrailRecord & Readonly<{
  deepLink?: string
}>

export type ProfileAgentChangeTrailPage = Readonly<{
  profileId: string
  revision: number
  since: number
  items: readonly ProfileAgentChangeTrailItem[]
  nextCursor?: string
  truncated: boolean
}>

export type ProfileAgentChangeTrailSource = Readonly<{
  profileId: string
  revision: number
  records: readonly ProfileAgentChangeTrailRecord[]
}>

type ProfileAgentChangeTrailCursor = Readonly<{
  gatewayVersion: number
  profileId: string
  revision: number
  since: number
  position: number
}>

export function validateProfileAgentChangeTrailRequest(
  candidate: unknown,
): ProfileServiceResult<NormalizedProfileAgentChangeTrailRequest> {
  if (!isRecord(candidate)
    || !hasOnlyKeys(candidate, ['byteLimit', 'cursor', 'limit', 'since'])) {
    return profileServiceFailure('invalid')
  }
  const since = candidate.since === undefined ? 0 : candidate.since
  const limit = candidate.limit === undefined
    ? PROFILE_AGENT_CHANGE_TRAIL_LIMITS.defaultItems
    : candidate.limit
  const byteLimit = candidate.byteLimit === undefined
    ? PROFILE_AGENT_CHANGE_TRAIL_LIMITS.defaultBytes
    : candidate.byteLimit
  if (!nonNegativeSafeInteger(since)
    || !positiveSafeInteger(limit)
    || limit > PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxItems
    || !positiveSafeInteger(byteLimit)
    || byteLimit < 2
    || byteLimit > PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxBytes
    || (candidate.cursor !== undefined
      && (!nonEmptyString(candidate.cursor)
        || utf8ByteLength(candidate.cursor) > PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxCursorBytes))) {
    return profileServiceFailure('invalid')
  }
  return {
    ok: true,
    value: Object.freeze({
      since,
      limit,
      byteLimit,
      ...(candidate.cursor === undefined ? {} : { cursor: candidate.cursor }),
    }),
  }
}

export function queryProfileAgentChangeTrail(
  source: ProfileAgentChangeTrailSource,
  request: unknown,
): ProfileServiceResult<ProfileAgentChangeTrailPage> {
  const validated = validateProfileAgentChangeTrailRequest(request)
  if (!validated.ok) return validated
  if (!validSource(source)) return profileServiceFailure('corrupt-or-recovery-required')
  const query = validated.value
  if (query.since > source.revision) return profileServiceFailure('invalid')

  let position = 0
  if (query.cursor !== undefined) {
    const decoded = decodeCursor(query.cursor)
    if (!decoded.ok) return decoded
    if (decoded.value.gatewayVersion > PROFILE_GATEWAY_PROTOCOL_VERSION) {
      return profileServiceFailure('unsupported-future-version', {
        supportedGatewayProtocolVersion: PROFILE_GATEWAY_PROTOCOL_VERSION,
      })
    }
    if (decoded.value.gatewayVersion !== PROFILE_GATEWAY_PROTOCOL_VERSION
      || decoded.value.since !== query.since) {
      return profileServiceFailure('invalid')
    }
    if (decoded.value.profileId !== source.profileId
      || decoded.value.revision !== source.revision) {
      return profileServiceFailure('conflict', { currentRevision: source.revision })
    }
    position = decoded.value.position
  }

  const records = source.records
    .filter((record) => record.revision > query.since)
    .sort(compareChangeRecords)
  if (position > records.length) return profileServiceFailure('invalid')

  const items: ProfileAgentChangeTrailItem[] = []
  let itemBytes = 2
  let nextPosition = position
  while (nextPosition < records.length && items.length < query.limit) {
    const item = projectItem(records[nextPosition]!)
    const encodedBytes = utf8ByteLength(JSON.stringify(item)) + (items.length === 0 ? 0 : 1)
    if (itemBytes + encodedBytes > query.byteLimit) {
      if (items.length === 0) return profileServiceFailure('invalid')
      break
    }
    items.push(item)
    itemBytes += encodedBytes
    nextPosition += 1
  }

  const truncated = nextPosition < records.length
  return {
    ok: true,
    value: Object.freeze({
      profileId: source.profileId,
      revision: source.revision,
      since: query.since,
      items: Object.freeze(items),
      ...(truncated ? {
        nextCursor: encodeCursor({
          gatewayVersion: PROFILE_GATEWAY_PROTOCOL_VERSION,
          profileId: source.profileId,
          revision: source.revision,
          since: query.since,
          position: nextPosition,
        }),
      } : {}),
      truncated,
    }),
  }
}

export function isProfileAgentChangeTrailPage(
  candidate: unknown,
): candidate is ProfileAgentChangeTrailPage {
  if (!isRecord(candidate)
    || !hasOnlyKeys(candidate, [
      'items',
      'nextCursor',
      'profileId',
      'revision',
      'since',
      'truncated',
    ])
    || !nonEmptyString(candidate.profileId)
    || !nonNegativeSafeInteger(candidate.revision)
    || !nonNegativeSafeInteger(candidate.since)
    || candidate.since > candidate.revision
    || !Array.isArray(candidate.items)
    || candidate.items.length > PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxItems
    || utf8ByteLength(JSON.stringify(candidate.items)) > PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxBytes
    || typeof candidate.truncated !== 'boolean'
    || (candidate.truncated
      ? !nonEmptyString(candidate.nextCursor)
      : candidate.nextCursor !== undefined)
    || (typeof candidate.nextCursor === 'string'
      && utf8ByteLength(candidate.nextCursor) > PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxCursorBytes)) {
    return false
  }
  const identities = new Set<string>()
  let previous: ProfileAgentChangeTrailRecord | undefined
  for (const item of candidate.items) {
    if (!isRecord(item)
      || !hasOnlyKeys(item, [
        'actor',
        'changeKind',
        'command',
        'committedAt',
        'deepLink',
        'ideaId',
        'position',
        'recordId',
        'recordKind',
        'revision',
      ])
      || !positiveSafeInteger(item.revision)
      || item.revision <= candidate.since
      || item.revision > candidate.revision
      || !nonEmptyString(item.committedAt)
      || !isRecord(item.actor)
      || !hasExactKeys(item.actor, ['client', 'kind', 'sessionId'])
      || item.actor.kind !== 'agent'
      || (item.actor.client !== null && !nonEmptyString(item.actor.client))
      || (item.actor.sessionId !== null && !nonEmptyString(item.actor.sessionId))
      || !isRecord(item.command)
      || !hasExactKeys(item.command, ['id', 'name'])
      || !nonEmptyString(item.command.id)
      || !PROFILE_AGENT_CHANGE_TRAIL_ACTION_NAMES.includes(
        item.command.name as ProfileAgentChangeTrailActionName,
      )
      || (item.ideaId !== null && !nonEmptyString(item.ideaId))
      || !nonEmptyString(item.recordId)
      || !PROFILE_QUERYABLE_RECORD_KINDS.includes(item.recordKind as ProfileQueryableRecordKind)
      || (item.changeKind !== 'insert'
        && item.changeKind !== 'update'
        && item.changeKind !== 'delete')
      || (item.position !== undefined
        && (item.recordKind !== 'card' || !validPosition(item.position)))) return false
    const expectedDeepLink = item.recordKind === 'card' && item.ideaId !== null
      ? formatCardDeepLink('eido://app/', { ideaId: item.ideaId, cardId: item.recordId })
      : undefined
    if (item.deepLink !== expectedDeepLink) return false
    const normalized = item as unknown as ProfileAgentChangeTrailRecord
    if (previous !== undefined && compareChangeRecords(previous, normalized) > 0) return false
    previous = normalized
    const identity = `${item.revision}\u0000${item.recordId}`
    if (identities.has(identity)) return false
    identities.add(identity)
  }
  return true
}

function projectItem(record: ProfileAgentChangeTrailRecord): ProfileAgentChangeTrailItem {
  const { position, ...recordWithoutPosition } = record
  const deepLink = record.recordKind === 'card' && record.ideaId !== null
    ? formatCardDeepLink('eido://app/', { ideaId: record.ideaId, cardId: record.recordId })
    : undefined
  return Object.freeze({
    ...recordWithoutPosition,
    actor: Object.freeze({ ...record.actor }),
    command: Object.freeze({ ...record.command }),
    ...(position === undefined
      ? {}
      : { position: Object.freeze({ ...position }) }),
    ...(deepLink === undefined ? {} : { deepLink }),
  })
}

function validSource(source: ProfileAgentChangeTrailSource): boolean {
  if (!isRecord(source)
    || !hasExactKeys(source, ['profileId', 'records', 'revision'])
    || !nonEmptyString(source.profileId)
    || !nonNegativeSafeInteger(source.revision)
    || !Array.isArray(source.records)) return false
  const identities = new Set<string>()
  for (const record of source.records) {
    if (!isRecord(record)
      || !hasOnlyKeys(record, [
        'actor',
        'changeKind',
        'command',
        'committedAt',
        'ideaId',
        'position',
        'recordId',
        'recordKind',
        'revision',
      ])
      || !positiveSafeInteger(record.revision)
      || record.revision > source.revision
      || !nonEmptyString(record.committedAt)
      || !isRecord(record.actor)
      || !hasExactKeys(record.actor, ['client', 'kind', 'sessionId'])
      || record.actor.kind !== 'agent'
      || (record.actor.client !== null && !nonEmptyString(record.actor.client))
      || (record.actor.sessionId !== null && !nonEmptyString(record.actor.sessionId))
      || !isRecord(record.command)
      || !hasExactKeys(record.command, ['id', 'name'])
      || !nonEmptyString(record.command.id)
      || !PROFILE_AGENT_CHANGE_TRAIL_ACTION_NAMES.includes(
        record.command.name as ProfileAgentChangeTrailActionName,
      )
      || (record.ideaId !== null && !nonEmptyString(record.ideaId))
      || !nonEmptyString(record.recordId)
      || !PROFILE_QUERYABLE_RECORD_KINDS.includes(
        record.recordKind as ProfileQueryableRecordKind,
      )
      || (record.changeKind !== 'insert'
        && record.changeKind !== 'update'
        && record.changeKind !== 'delete')
      || (record.position !== undefined
        && (record.recordKind !== 'card' || !validPosition(record.position)))) return false
    const identity = `${record.revision}\u0000${record.recordId}`
    if (identities.has(identity)) return false
    identities.add(identity)
  }
  return true
}

function validPosition(candidate: unknown): candidate is Readonly<{ x: number; y: number }> {
  return isRecord(candidate)
    && hasExactKeys(candidate, ['x', 'y'])
    && typeof candidate.x === 'number'
    && Number.isFinite(candidate.x)
    && typeof candidate.y === 'number'
    && Number.isFinite(candidate.y)
}

function compareChangeRecords(
  left: ProfileAgentChangeTrailRecord,
  right: ProfileAgentChangeTrailRecord,
): number {
  return right.revision - left.revision
    || compareStrings(left.recordId, right.recordId)
    || compareStrings(left.command.id, right.command.id)
}

function decodeCursor(token: string): ProfileServiceResult<ProfileAgentChangeTrailCursor> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length % 4 === 1) {
      return profileServiceFailure('invalid')
    }
    const json = decodeBase64Url(token)
    if (encodeBase64Url(json) !== token) return profileServiceFailure('invalid')
    const candidate = JSON.parse(json) as unknown
    if (!isRecord(candidate)
      || !hasExactKeys(candidate, [
        'gatewayVersion',
        'position',
        'profileId',
        'revision',
        'since',
      ])
      || !positiveSafeInteger(candidate.gatewayVersion)
      || !nonEmptyString(candidate.profileId)
      || !nonNegativeSafeInteger(candidate.revision)
      || !nonNegativeSafeInteger(candidate.since)
      || !nonNegativeSafeInteger(candidate.position)) {
      return profileServiceFailure('invalid')
    }
    return {
      ok: true,
      value: Object.freeze({
        gatewayVersion: candidate.gatewayVersion,
        profileId: candidate.profileId,
        revision: candidate.revision,
        since: candidate.since,
        position: candidate.position,
      }),
    }
  } catch {
    return profileServiceFailure('invalid')
  }
}

function encodeCursor(cursor: ProfileAgentChangeTrailCursor): string {
  return encodeBase64Url(JSON.stringify(cursor))
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index]!)
  }
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

function decodeBase64Url(value: string): string {
  const standard = value.replace(/-/gu, '+').replace(/_/gu, '/')
  const padded = standard + '='.repeat((4 - standard.length % 4) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

function hasOnlyKeys(candidate: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(candidate).every(key => allowed.includes(key))
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate)
  return keys.length === expected.length && expected.every(key => (
    Object.prototype.hasOwnProperty.call(candidate, key)
  ))
}

function nonEmptyString(candidate: unknown): candidate is string {
  return typeof candidate === 'string' && candidate.length > 0
}

function nonNegativeSafeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && (candidate as number) >= 0
}

function positiveSafeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && (candidate as number) > 0
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
