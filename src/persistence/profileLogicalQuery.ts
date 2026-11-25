import {
  ProfileLogicalProjectionError,
  validateProfileLogicalDocument,
  type ProfileLogicalDocument,
  type ProfileLogicalRecordSpec,
} from './profileLogicalProjection'
import { cardMatchesCreatorFilter } from '../graph/cardAuthorship'
import type { Card } from '../graph/types'
import {
  PROFILE_GATEWAY_PROTOCOL_VERSION,
  profileServiceFailure,
  validateProfileQuery,
  type NormalizedProfileQuery,
  type ProfileJsonValue,
  type ProfileQueryItem,
  type ProfileQueryPage,
  type ProfileQueryableRecordKind,
  type ProfileServiceResult,
} from './profileServiceContract'

export function queryProfileLogicalDocument(
  document: ProfileLogicalDocument,
  request: unknown,
): ProfileServiceResult<ProfileQueryPage> {
  const validatedRequest = validateProfileQuery(request)
  if (!validatedRequest.ok) return validatedRequest

  let validatedDocument: ProfileLogicalDocument
  try {
    validatedDocument = validateProfileLogicalDocument(document)
  } catch (error) {
    return profileServiceFailure(
      error instanceof ProfileLogicalProjectionError
        ? 'corrupt-or-recovery-required'
        : 'internal',
    )
  }

  const queryShape = cursorQueryShape(validatedRequest.value)
  let position = 0
  if (validatedRequest.value.cursor !== undefined) {
    const decoded = decodeCursor(validatedRequest.value.cursor)
    if (!decoded.ok) return decoded
    if (decoded.value.gatewayVersion > PROFILE_GATEWAY_PROTOCOL_VERSION) {
      return profileServiceFailure('unsupported-future-version', {
        supportedGatewayProtocolVersion: PROFILE_GATEWAY_PROTOCOL_VERSION,
      })
    }
    if (decoded.value.gatewayVersion !== PROFILE_GATEWAY_PROTOCOL_VERSION) {
      return profileServiceFailure('invalid')
    }
    if (
      decoded.value.profileId !== validatedDocument.head.profileId
      || decoded.value.revision !== validatedDocument.head.revision
    ) {
      return profileServiceFailure('conflict', {
        currentRevision: validatedDocument.head.revision,
      })
    }
    if (JSON.stringify(decoded.value.query) !== JSON.stringify(queryShape)) {
      return profileServiceFailure('invalid')
    }
    position = decoded.value.position
  }

  const matching = validatedDocument.records
    .filter((record) => matchesQuery(record, validatedRequest.value))
    .sort(compareLogicalRecords)
  if (position > matching.length) return profileServiceFailure('invalid')

  const items: ProfileQueryItem[] = []
  let itemBytes = 2 // The exact UTF-8 size of an empty JSON array.
  let nextPosition = position
  while (nextPosition < matching.length && items.length < validatedRequest.value.limit) {
    const record = matching[nextPosition]!
    const item = projectQueryItem(record, validatedRequest.value.projection)
    const encodedBytes = utf8ByteLength(JSON.stringify(item)) + (items.length === 0 ? 0 : 1)
    if (itemBytes + encodedBytes > validatedRequest.value.byteLimit) {
      if (items.length === 0) return profileServiceFailure('invalid')
      break
    }
    items.push(item)
    itemBytes += encodedBytes
    nextPosition += 1
  }

  const truncated = nextPosition < matching.length
  const page: ProfileQueryPage = Object.freeze({
    profileId: validatedDocument.head.profileId,
    revision: validatedDocument.head.revision,
    items: Object.freeze(items),
    ...(truncated ? {
      nextCursor: encodeCursor({
        gatewayVersion: PROFILE_GATEWAY_PROTOCOL_VERSION,
        profileId: validatedDocument.head.profileId,
        revision: validatedDocument.head.revision,
        position: nextPosition,
        query: queryShape,
      }),
    } : {}),
    truncated,
  })
  return { ok: true, value: page }
}

type CursorQueryShape = Readonly<{
  creator?: NormalizedProfileQuery['creator']
  recordKinds?: readonly ProfileQueryableRecordKind[]
  recordIds?: readonly string[]
  ownerIds?: readonly string[]
  parentIds?: readonly (string | null)[]
  projection?: readonly string[]
}>

type ProfileQueryCursor = Readonly<{
  gatewayVersion: number
  profileId: string
  revision: number
  position: number
  query: CursorQueryShape
}>

function cursorQueryShape(query: NormalizedProfileQuery): CursorQueryShape {
  return Object.freeze({
    ...(query.creator === undefined ? {} : { creator: query.creator }),
    ...(query.recordKinds === undefined ? {} : { recordKinds: query.recordKinds }),
    ...(query.recordIds === undefined ? {} : { recordIds: query.recordIds }),
    ...(query.ownerIds === undefined ? {} : { ownerIds: query.ownerIds }),
    ...(query.parentIds === undefined ? {} : { parentIds: query.parentIds }),
    ...(query.projection === undefined ? {} : { projection: query.projection }),
  })
}

function matchesQuery(record: ProfileLogicalRecordSpec, query: NormalizedProfileQuery): boolean {
  return (
    (query.creator === undefined || (
      record.kind === 'card'
      && cardMatchesCreatorFilter(
        record.payload as unknown as Pick<Card, 'createdBy'>,
        query.creator,
      )
    ))
    && (query.recordKinds === undefined || query.recordKinds.includes(record.kind))
    && (query.recordIds === undefined || query.recordIds.includes(record.recordId))
    && (query.ownerIds === undefined || query.ownerIds.includes(record.ownerId))
    && (query.parentIds === undefined || query.parentIds.includes(record.parentId))
  )
}

function compareLogicalRecords(left: ProfileLogicalRecordSpec, right: ProfileLogicalRecordSpec): number {
  return compareStrings(left.kind, right.kind)
    || compareStrings(left.ownerId, right.ownerId)
    || left.ordinal - right.ordinal
    || compareStrings(left.recordId, right.recordId)
}

function projectQueryItem(
  record: ProfileLogicalRecordSpec,
  projection: readonly string[] | undefined,
): ProfileQueryItem {
  const payload = projection === undefined
    ? cloneAndFreezeJson(record.payload)
    : projectPayload(record.payload, projection)
  return Object.freeze({
    recordId: record.recordId,
    kind: record.kind,
    ownerId: record.ownerId,
    parentId: record.parentId,
    ordinal: record.ordinal,
    recordVersion: record.recordVersion,
    payload,
  })
}

function projectPayload(value: ProfileJsonValue, fields: readonly string[]): ProfileJsonValue {
  if (!isJsonObject(value)) return Object.freeze({})
  return Object.freeze(Object.fromEntries(fields.flatMap((field) => (
    Object.prototype.hasOwnProperty.call(value, field)
      ? [[field, cloneAndFreezeJson(value[field]!)] as const]
      : []
  ))))
}

function cloneAndFreezeJson(value: ProfileJsonValue): ProfileJsonValue {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const clone = value.map(cloneAndFreezeJson)
    Object.freeze(clone)
    return clone
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(value).map(([key, entry]) => [key, cloneAndFreezeJson(entry)]),
  ))
}

function decodeCursor(token: string): ProfileServiceResult<ProfileQueryCursor> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length % 4 === 1) {
      return profileServiceFailure('invalid')
    }
    const json = decodeBase64Url(token)
    if (encodeBase64Url(json) !== token) return profileServiceFailure('invalid')
    const candidate = JSON.parse(json) as unknown
    if (
      !isJsonObject(candidate)
      || !hasExactKeys(candidate, ['gatewayVersion', 'position', 'profileId', 'query', 'revision'])
      || !Number.isSafeInteger(candidate.gatewayVersion)
      || (candidate.gatewayVersion as number) < 1
      || typeof candidate.profileId !== 'string'
      || candidate.profileId.length === 0
      || !Number.isSafeInteger(candidate.revision)
      || (candidate.revision as number) < 0
      || !Number.isSafeInteger(candidate.position)
      || (candidate.position as number) < 0
      || !isJsonObject(candidate.query)
    ) return profileServiceFailure('invalid')

    const queryKeys = ['creator', 'ownerIds', 'parentIds', 'projection', 'recordIds', 'recordKinds']
    if (!Object.keys(candidate.query).every((key) => queryKeys.includes(key))) {
      return profileServiceFailure('invalid')
    }
    const normalized = validateProfileQuery({
      ...candidate.query,
      limit: 1,
      byteLimit: 2,
    })
    if (!normalized.ok) return profileServiceFailure('invalid')
    const normalizedShape = cursorQueryShape(normalized.value)
    if (JSON.stringify(candidate.query) !== JSON.stringify(normalizedShape)) {
      return profileServiceFailure('invalid')
    }
    return {
      ok: true,
      value: Object.freeze({
        gatewayVersion: candidate.gatewayVersion as number,
        profileId: candidate.profileId,
        revision: candidate.revision as number,
        position: candidate.position as number,
        query: normalizedShape,
      }),
    }
  } catch {
    return profileServiceFailure('invalid')
  }
}

function encodeCursor(cursor: ProfileQueryCursor): string {
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
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
}

function isJsonObject(value: unknown): value is Record<string, ProfileJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(compareStrings)
  const sortedExpected = [...expected].sort(compareStrings)
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index])
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
