import {
  ProfileLogicalProjectionError,
  validateProfileLogicalDocument,
  type ProfileLogicalDocument,
  type ProfileLogicalRecordSpec,
} from './profileLogicalProjection'
import {
  PROFILE_GATEWAY_PROTOCOL_VERSION,
  PROFILE_QUERY_LIMITS,
  profileServiceFailure,
  type ProfileJsonValue,
  type ProfileQueryItem,
  type ProfileServiceResult,
} from './profileServiceContract'
import { isProfileTransportQueryPage } from './profileTransportContract'

export type ProfileResultInspectionRequest = Readonly<{
  ideaId: string
  resultCardId: string
  limit?: number
  byteLimit?: number
  cursor?: string
}>

export type NormalizedProfileResultInspectionRequest = Readonly<{
  ideaId: string
  resultCardId: string
  limit: number
  byteLimit: number
  cursor?: string
}>

export type ProfileResultInspectionPage = Readonly<{
  profileId: string
  revision: number
  ideaId: string
  resultCardId: string
  items: readonly ProfileQueryItem[]
  nextCursor?: string
  truncated: boolean
}>

type ProfileResultInspectionCursor = Readonly<{
  gatewayVersion: number
  profileId: string
  revision: number
  ideaId: string
  resultCardId: string
  position: number
}>

export function validateProfileResultInspectionRequest(
  request: unknown,
): ProfileServiceResult<NormalizedProfileResultInspectionRequest> {
  if (!isJsonObject(request)
    || !hasExactOptionalKeys(
      request,
      ['ideaId', 'resultCardId'],
      ['byteLimit', 'cursor', 'limit'],
    )
    || !boundedString(request.ideaId, PROFILE_QUERY_LIMITS.maxFilterValueBytes)
    || !boundedString(request.resultCardId, PROFILE_QUERY_LIMITS.maxFilterValueBytes)) {
    return profileServiceFailure('invalid')
  }

  const limit = request.limit === undefined ? PROFILE_QUERY_LIMITS.defaultItems : request.limit
  if (!Number.isSafeInteger(limit)
    || Number(limit) < 1
    || Number(limit) > PROFILE_QUERY_LIMITS.maxItems) {
    return profileServiceFailure('invalid')
  }

  const byteLimit = request.byteLimit === undefined
    ? PROFILE_QUERY_LIMITS.defaultBytes
    : request.byteLimit
  if (!Number.isSafeInteger(byteLimit)
    || Number(byteLimit) < 2
    || Number(byteLimit) > PROFILE_QUERY_LIMITS.maxBytes) {
    return profileServiceFailure('invalid')
  }

  if (request.cursor !== undefined
    && !boundedString(request.cursor, PROFILE_QUERY_LIMITS.maxCursorBytes)) {
    return profileServiceFailure('invalid')
  }

  return {
    ok: true,
    value: Object.freeze({
      ideaId: request.ideaId,
      resultCardId: request.resultCardId,
      limit: Number(limit),
      byteLimit: Number(byteLimit),
      ...(request.cursor === undefined ? {} : { cursor: request.cursor }),
    }),
  }
}

export function inspectProfileLogicalResult(
  document: ProfileLogicalDocument,
  request: unknown,
): ProfileServiceResult<ProfileResultInspectionPage> {
  const validatedRequest = validateProfileResultInspectionRequest(request)
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
    if (decoded.value.profileId !== validatedDocument.head.profileId
      || decoded.value.revision !== validatedDocument.head.revision) {
      return profileServiceFailure('conflict', {
        currentRevision: validatedDocument.head.revision,
      })
    }
    if (decoded.value.ideaId !== validatedRequest.value.ideaId
      || decoded.value.resultCardId !== validatedRequest.value.resultCardId) {
      return profileServiceFailure('invalid')
    }
    position = decoded.value.position
  }

  const closure = collectResultClosure(validatedDocument, validatedRequest.value)
  if (!closure.ok) return closure
  if (position > closure.value.length) return profileServiceFailure('invalid')

  const items: ProfileQueryItem[] = []
  let itemBytes = 2
  let nextPosition = position
  while (nextPosition < closure.value.length && items.length < validatedRequest.value.limit) {
    const item = toQueryItem(closure.value[nextPosition]!)
    const encodedBytes = utf8ByteLength(JSON.stringify(item)) + (items.length === 0 ? 0 : 1)
    if (itemBytes + encodedBytes > validatedRequest.value.byteLimit) {
      if (items.length === 0) return profileServiceFailure('invalid')
      break
    }
    items.push(item)
    itemBytes += encodedBytes
    nextPosition += 1
  }

  const truncated = nextPosition < closure.value.length
  return {
    ok: true,
    value: Object.freeze({
      profileId: validatedDocument.head.profileId,
      revision: validatedDocument.head.revision,
      ideaId: validatedRequest.value.ideaId,
      resultCardId: validatedRequest.value.resultCardId,
      items: Object.freeze(items),
      ...(truncated ? {
        nextCursor: encodeCursor({
          gatewayVersion: PROFILE_GATEWAY_PROTOCOL_VERSION,
          profileId: validatedDocument.head.profileId,
          revision: validatedDocument.head.revision,
          ideaId: validatedRequest.value.ideaId,
          resultCardId: validatedRequest.value.resultCardId,
          position: nextPosition,
        }),
      } : {}),
      truncated,
    }),
  }
}

export function isProfileResultInspectionPage(
  candidate: unknown,
): candidate is ProfileResultInspectionPage {
  if (!isJsonObject(candidate)
    || !hasExactOptionalKeys(
      candidate,
      ['ideaId', 'items', 'profileId', 'resultCardId', 'revision', 'truncated'],
      ['nextCursor'],
    )
    || !boundedString(candidate.ideaId, PROFILE_QUERY_LIMITS.maxFilterValueBytes)
    || !boundedString(candidate.resultCardId, PROFILE_QUERY_LIMITS.maxFilterValueBytes)) {
    return false
  }
  const { ideaId: _ideaId, resultCardId: _resultCardId, ...queryPage } = candidate
  return isProfileTransportQueryPage(queryPage)
}

function collectResultClosure(
  document: ProfileLogicalDocument,
  request: NormalizedProfileResultInspectionRequest,
): ProfileServiceResult<readonly ProfileLogicalRecordSpec[]> {
  const boardId = `board:${request.ideaId}`
  const idea = document.records.find(record => (
    record.kind === 'idea'
    && record.recordId === request.ideaId
  ))
  const resultCard = document.records.find(record => (
    record.kind === 'card'
    && record.recordId === request.resultCardId
    && record.ownerId === boardId
    && record.parentId === boardId
    && isJsonObject(record.payload)
    && record.payload.kind === 'result'
  ))
  if (!idea || !resultCard) {
    return profileServiceFailure('not-found', { currentRevision: document.head.revision })
  }

  const records: ProfileLogicalRecordSpec[] = []
  const seenRecordIds = new Set<string>()
  const append = (record: ProfileLogicalRecordSpec | undefined) => {
    if (record && !seenRecordIds.has(record.recordId)) {
      records.push(record)
      seenRecordIds.add(record.recordId)
    }
  }
  append(resultCard)

  const outputs = document.records.filter(record => (
    record.kind === 'output'
    && record.ownerId === boardId
    && record.parentId === boardId
    && isJsonObject(record.payload)
    && record.payload.resultCardId === request.resultCardId
  )).sort(compareOwnedRecords)
  for (const output of outputs) {
    append(output)
    const versions = document.records.filter(record => (
      record.kind === 'output-version'
      && record.ownerId === boardId
      && record.parentId === output.recordId
    )).sort(compareOwnedRecords)
    for (const version of versions) {
      append(version)
      const fromRunId = isJsonObject(version.payload)
        && typeof version.payload.fromRunId === 'string'
        ? version.payload.fromRunId
        : undefined
      if (fromRunId !== undefined) {
        append(document.records.find(record => (
          record.kind === 'run'
          && record.recordId === fromRunId
          && record.ownerId === boardId
          && record.parentId === boardId
        )))
      }
      for (const messageKind of ['transcript-message', 'follow-up-message'] as const) {
        document.records.filter(record => (
          record.kind === messageKind
          && record.ownerId === boardId
          && record.parentId === version.recordId
        )).sort(compareOwnedRecords).forEach(append)
      }
    }
  }
  return { ok: true, value: Object.freeze(records) }
}

function toQueryItem(record: ProfileLogicalRecordSpec): ProfileQueryItem {
  return Object.freeze({
    recordId: record.recordId,
    kind: record.kind,
    ownerId: record.ownerId,
    parentId: record.parentId,
    ordinal: record.ordinal,
    recordVersion: record.recordVersion,
    payload: cloneAndFreezeJson(record.payload),
  })
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

function decodeCursor(token: string): ProfileServiceResult<ProfileResultInspectionCursor> {
  try {
    if (!/^[A-Za-z0-9_-]+$/.test(token) || token.length % 4 === 1) {
      return profileServiceFailure('invalid')
    }
    const json = decodeBase64Url(token)
    if (encodeBase64Url(json) !== token) return profileServiceFailure('invalid')
    const candidate = JSON.parse(json) as unknown
    if (!isJsonObject(candidate)
      || !hasExactKeys(candidate, [
        'gatewayVersion',
        'ideaId',
        'position',
        'profileId',
        'resultCardId',
        'revision',
      ])
      || !Number.isSafeInteger(candidate.gatewayVersion)
      || Number(candidate.gatewayVersion) < 1
      || typeof candidate.profileId !== 'string'
      || candidate.profileId.length === 0
      || !Number.isSafeInteger(candidate.revision)
      || Number(candidate.revision) < 0
      || !boundedString(candidate.ideaId, PROFILE_QUERY_LIMITS.maxFilterValueBytes)
      || !boundedString(candidate.resultCardId, PROFILE_QUERY_LIMITS.maxFilterValueBytes)
      || !Number.isSafeInteger(candidate.position)
      || Number(candidate.position) < 0) {
      return profileServiceFailure('invalid')
    }
    return {
      ok: true,
      value: Object.freeze({
        gatewayVersion: Number(candidate.gatewayVersion),
        profileId: candidate.profileId,
        revision: Number(candidate.revision),
        ideaId: candidate.ideaId,
        resultCardId: candidate.resultCardId,
        position: Number(candidate.position),
      }),
    }
  } catch {
    return profileServiceFailure('invalid')
  }
}

function encodeCursor(cursor: ProfileResultInspectionCursor): string {
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

function isJsonObject(value: unknown): value is Record<string, ProfileJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(compareStrings)
  const sortedExpected = [...expected].sort(compareStrings)
  return keys.length === sortedExpected.length
    && keys.every((key, index) => key === sortedExpected[index])
}

function hasExactOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  return required.every(key => Object.prototype.hasOwnProperty.call(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key))
}

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && utf8ByteLength(value) <= maxBytes
}

function compareOwnedRecords(
  left: ProfileLogicalRecordSpec,
  right: ProfileLogicalRecordSpec,
): number {
  return left.ordinal - right.ordinal || compareStrings(left.recordId, right.recordId)
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
