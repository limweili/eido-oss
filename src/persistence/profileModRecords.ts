import type { ProfileJsonValue } from './profileServiceContract'
import {
  listModPartIdentities,
  normalizeMod,
  remapModPartIdentities,
  type Mod,
} from '../mods'

export const PROFILE_MOD_RECORD_VERSION = 2 as const

export type ProfileModFailureCode =
  | 'invalid'
  | 'unsupported-future-version'
  | 'immutable-built-in'

export type ProfileModResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | Readonly<{ ok: false; code: ProfileModFailureCode; message: string }>

export type ProfileModDocument = Mod

export type ProfileModTemplateRecord = Readonly<{
  kind: 'mod-template'
  recordId: string
  ownerId: string
  parentId: string
  recordVersion: typeof PROFILE_MOD_RECORD_VERSION
  payload: Readonly<{
    templateVersion: number
    provenance: Readonly<{ kind: 'built-in' | 'user' }>
    createdAt: string
    updatedAt: string
    mod: ProfileModDocument
  }>
}>

export type ProfileModIdentityPair = Readonly<{
  sourceId: string
  instanceId: string
}>

export type ProfileModTemplateInstancePayload = Readonly<{
  source: Readonly<{
    kind: 'template'
    templateId: string
    templateVersion: number
  }>
  idMap: Readonly<{
    mod: ProfileModIdentityPair
    controls: readonly ProfileModIdentityPair[]
  }>
  stampedAt: string
  mod: ProfileModDocument
}>

export type ProfileModDirectInstancePayload = Readonly<{
  source: Readonly<{ kind: 'direct' }>
  createdAt: string
  mod: ProfileModDocument
}>

type ProfileModInstanceEnvelope<Payload> = Readonly<{
  kind: 'mod-instance'
  recordId: string
  ownerId: string
  parentId: string
  recordVersion: typeof PROFILE_MOD_RECORD_VERSION
  payload: Payload
}>

export type ProfileModTemplateInstanceRecord = ProfileModInstanceEnvelope<ProfileModTemplateInstancePayload>
export type ProfileModDirectInstanceRecord = ProfileModInstanceEnvelope<ProfileModDirectInstancePayload>
export type ProfileModInstanceRecord = ProfileModTemplateInstanceRecord | ProfileModDirectInstanceRecord

export type ProfileModRecord = ProfileModTemplateRecord | ProfileModInstanceRecord

export type CreateUserProfileModTemplateInput = Readonly<{
  profileId: string
  templateId: string
  createdAt: string
  mod: unknown
}>

export type UpdateProfileModTemplateInput = Readonly<{
  updatedAt: string
  mod: unknown
}>

export type ProfileModTemplateDeletion = Readonly<{
  recordId: string
  ownerId: string
  expectedTemplateVersion: number
}>

export type StampProfileModTemplateInput = Readonly<{
  boardRecordId: string
  cardId: string
  instanceId: string
  controlIds: readonly string[]
  stampedAt: string
}>

export type CreateDirectProfileModInstanceInput = Readonly<{
  boardRecordId: string
  cardId: string
  instanceId: string
  createdAt: string
  mod: unknown
}>

export function createUserProfileModTemplate(
  input: CreateUserProfileModTemplateInput,
): ProfileModResult<ProfileModTemplateRecord> {
  return decodeProfileModRecord({
    kind: 'mod-template',
    recordId: input.templateId,
    ownerId: input.profileId,
    parentId: input.profileId,
    recordVersion: PROFILE_MOD_RECORD_VERSION,
    payload: {
      templateVersion: 1,
      provenance: { kind: 'user' },
      createdAt: input.createdAt,
      updatedAt: input.createdAt,
      mod: input.mod,
    },
  }) as ProfileModResult<ProfileModTemplateRecord>
}

export function updateProfileModTemplate(
  record: ProfileModTemplateRecord,
  input: UpdateProfileModTemplateInput,
): ProfileModResult<ProfileModTemplateRecord> {
  return updateProfileModTemplateWithTimestampPolicy(record, input, 'advance')
}

/**
 * Advances a template already changed by an earlier command in the same
 * atomic Profile revision. One revision has one trusted commit timestamp, so
 * its intermediate template versions intentionally share that timestamp.
 */
export function updateProfileModTemplateWithinRevision(
  record: ProfileModTemplateRecord,
  input: UpdateProfileModTemplateInput,
): ProfileModResult<ProfileModTemplateRecord> {
  return updateProfileModTemplateWithTimestampPolicy(record, input, 'same-revision')
}

function updateProfileModTemplateWithTimestampPolicy(
  record: ProfileModTemplateRecord,
  input: UpdateProfileModTemplateInput,
  timestampPolicy: 'advance' | 'same-revision',
): ProfileModResult<ProfileModTemplateRecord> {
  const decoded = decodeProfileModRecord(record)
  if (!decoded.ok) return decoded
  if (decoded.value.kind !== 'mod-template') return invalid('Expected a Mod template record')
  if (decoded.value.payload.provenance.kind === 'built-in') {
    return failure('immutable-built-in', 'Built-in Mod templates cannot be updated at runtime')
  }
  const previousUpdatedAt = Date.parse(decoded.value.payload.updatedAt)
  const nextUpdatedAt = Date.parse(input.updatedAt)
  const validTimestamp = canonicalTimestamp(input.updatedAt) && (
    timestampPolicy === 'advance'
      ? nextUpdatedAt > previousUpdatedAt
      : nextUpdatedAt === previousUpdatedAt
  )
  if (!validTimestamp) {
    return invalid('Profile Mod template updatedAt must advance monotonically')
  }
  if (decoded.value.payload.templateVersion >= Number.MAX_SAFE_INTEGER) {
    return invalid('Profile Mod templateVersion cannot advance safely')
  }

  return decodeProfileModRecord({
    ...decoded.value,
    payload: {
      ...decoded.value.payload,
      templateVersion: decoded.value.payload.templateVersion + 1,
      updatedAt: input.updatedAt,
      mod: input.mod,
    },
  }) as ProfileModResult<ProfileModTemplateRecord>
}

export function deleteProfileModTemplate(
  record: ProfileModTemplateRecord,
): ProfileModResult<ProfileModTemplateDeletion> {
  const decoded = decodeProfileModRecord(record)
  if (!decoded.ok) return decoded
  if (decoded.value.kind !== 'mod-template') return invalid('Expected a Mod template record')
  if (decoded.value.payload.provenance.kind === 'built-in') {
    return failure('immutable-built-in', 'Built-in Mod templates cannot be deleted at runtime')
  }
  return success(Object.freeze({
    recordId: decoded.value.recordId,
    ownerId: decoded.value.ownerId,
    expectedTemplateVersion: decoded.value.payload.templateVersion,
  }))
}

export function createDirectProfileModInstance(
  input: CreateDirectProfileModInstanceInput,
): ProfileModResult<ProfileModDirectInstanceRecord> {
  return decodeProfileModRecord({
    kind: 'mod-instance',
    recordId: input.instanceId,
    ownerId: input.boardRecordId,
    parentId: input.cardId,
    recordVersion: PROFILE_MOD_RECORD_VERSION,
    payload: {
      source: { kind: 'direct' },
      createdAt: input.createdAt,
      mod: input.mod,
    },
  }) as ProfileModResult<ProfileModDirectInstanceRecord>
}

export function stampProfileModTemplate(
  record: ProfileModTemplateRecord,
  input: StampProfileModTemplateInput,
): ProfileModResult<ProfileModTemplateInstanceRecord> {
  const decoded = decodeProfileModRecord(record)
  if (!decoded.ok) return decoded
  if (decoded.value.kind !== 'mod-template') return invalid('Expected a Mod template record')
  if (!nonEmptyString(input.boardRecordId)
    || !nonEmptyString(input.cardId)
    || !nonEmptyString(input.instanceId)) {
    return invalid('Profile Mod stamp ownership or instance identity is invalid')
  }
  if (!canonicalTimestamp(input.stampedAt)
    || Date.parse(input.stampedAt) < Date.parse(decoded.value.payload.updatedAt)) {
    return invalid('Profile Mod stampedAt precedes its source template revision')
  }
  const sourceParts = listModPartIdentities(decoded.value.payload.mod)
  if (!Array.isArray(input.controlIds)
    || input.controlIds.length !== sourceParts.length) {
    return invalid('Profile Mod stamp requires one fresh ID for every current nested member')
  }

  const sourceIds = new Set<string>([
    decoded.value.recordId,
    ...sourceParts.map(({ sourceId }) => sourceId),
  ])
  const instanceIds = new Set<string>()
  for (const id of [input.instanceId, ...input.controlIds]) {
    if (!nonEmptyString(id) || sourceIds.has(id) || instanceIds.has(id)) {
      return invalid('Profile Mod stamp identities must be fresh and unique')
    }
    instanceIds.add(id)
  }

  let remapped: ReturnType<typeof remapModPartIdentities<ProfileModDocument>>
  try {
    remapped = remapModPartIdentities(
      decoded.value.payload.mod,
      ({ ordinal }) => input.controlIds[ordinal]!,
    )
  } catch {
    return invalid('Profile Mod stamp identities must be fresh and unique')
  }
  return decodeProfileModRecord({
    kind: 'mod-instance',
    recordId: input.instanceId,
    ownerId: input.boardRecordId,
    parentId: input.cardId,
    recordVersion: PROFILE_MOD_RECORD_VERSION,
    payload: {
      source: {
        kind: 'template',
        templateId: decoded.value.recordId,
        templateVersion: decoded.value.payload.templateVersion,
      },
      idMap: {
        mod: {
          sourceId: decoded.value.recordId,
          instanceId: input.instanceId,
        },
        controls: remapped.mappings.map(({ sourceId, instanceId }) => ({
          sourceId,
          instanceId,
        })),
      },
      stampedAt: input.stampedAt,
      mod: remapped.value,
    },
  }) as ProfileModResult<ProfileModTemplateInstanceRecord>
}

export function hydrateProfileModInstance(
  value: unknown,
): ProfileModResult<ProfileModDocument> {
  const decoded = decodeProfileModRecord(value)
  if (!decoded.ok) return decoded
  if (decoded.value.kind !== 'mod-instance') return invalid('Expected a Mod instance record')
  return success(decoded.value.payload.mod)
}

export function decodeProfileModRecord(value: unknown): ProfileModResult<ProfileModRecord> {
  const jsonError = jsonValidationError(value, '$', new WeakSet<object>())
  if (jsonError) return invalid(jsonError)
  if (!isPlainRecord(value)) return invalid('Profile Mod record must be an object')

  const record = cloneJson(value) as Record<string, unknown>
  if (record.recordVersion !== PROFILE_MOD_RECORD_VERSION) {
    if (Number.isSafeInteger(record.recordVersion) && Number(record.recordVersion) > PROFILE_MOD_RECORD_VERSION) {
      return failure(
        'unsupported-future-version',
        `Profile Mod record version ${String(record.recordVersion)} is not supported`,
      )
    }
    return invalid(`Profile Mod recordVersion must be ${PROFILE_MOD_RECORD_VERSION}`)
  }
  if (record.kind === 'mod-template') {
    const error = validateTemplateRecord(record)
    if (error) return invalid(error)
    return success(deepFreeze(record) as ProfileModTemplateRecord)
  }
  if (record.kind === 'mod-instance') {
    const error = validateInstanceRecord(record)
    if (error) return invalid(error)
    return success(deepFreeze(record) as ProfileModInstanceRecord)
  }
  return invalid('Profile Mod record kind is invalid')
}

/** Validate one current renderer-owned Mod document with the same strict,
 * inert JSON and current-schema rules used by native Profile Mod records. */
export function validateProfileModDocumentTransport(
  value: unknown,
): ProfileModResult<ProfileModDocument> {
  const jsonError = jsonValidationError(value, '$transportMod', new WeakSet<object>())
  if (jsonError) return invalid(jsonError)
  const mod = cloneJson(value)
  const modError = validateModDocument(mod, '$transportMod')
  if (modError) return invalid(modError)
  return success(deepFreeze(mod) as ProfileModDocument)
}

export function encodeProfileModRecord(
  record: ProfileModRecord,
): ProfileModResult<ProfileJsonValue> {
  const decoded = decodeProfileModRecord(record)
  if (!decoded.ok) return decoded
  return success(cloneJson(decoded.value) as ProfileJsonValue)
}

function validateTemplateRecord(record: Record<string, unknown>): string | undefined {
  if (!nonEmptyString(record.recordId)) return 'Profile Mod template recordId is invalid'
  if (!nonEmptyString(record.ownerId)) return 'Profile Mod template ownerId is invalid'
  if (record.parentId !== record.ownerId) return 'Profile Mod template must be owned by its Profile'
  if (!isPlainRecord(record.payload)) return 'Profile Mod template payload is invalid'

  const payload = record.payload
  if (!positiveSafeInteger(payload.templateVersion)) {
    return 'Profile Mod templateVersion is invalid'
  }
  if (!isPlainRecord(payload.provenance)
    || (payload.provenance.kind !== 'built-in' && payload.provenance.kind !== 'user')) {
    return 'Profile Mod template provenance is invalid'
  }
  if (!canonicalTimestamp(payload.createdAt) || !canonicalTimestamp(payload.updatedAt)) {
    return 'Profile Mod template timestamps are invalid'
  }
  if (Date.parse(payload.updatedAt) < Date.parse(payload.createdAt)) {
    return 'Profile Mod template updatedAt precedes createdAt'
  }

  const modError = validateModDocument(payload.mod, '$.payload.mod')
  if (modError) return modError
  return undefined
}

function validateInstanceRecord(record: Record<string, unknown>): string | undefined {
  if (!nonEmptyString(record.recordId)) return 'Profile Mod instance recordId is invalid'
  if (!nonEmptyString(record.ownerId)) return 'Profile Mod instance ownerId is invalid'
  if (!nonEmptyString(record.parentId)) return 'Profile Mod instance parentId is invalid'
  if (!isPlainRecord(record.payload)) return 'Profile Mod instance payload is invalid'

  const payload = record.payload
  if (!isPlainRecord(payload.source)
    || (payload.source.kind !== 'template' && payload.source.kind !== 'direct')) {
    return 'Profile Mod instance source provenance is invalid'
  }

  const modError = validateModDocument(payload.mod, '$.payload.mod')
  if (modError) return modError

  if (payload.source.kind === 'direct') {
    if (!canonicalTimestamp(payload.createdAt)) return 'Direct Profile Mod instance createdAt is invalid'
    if ('templateId' in payload.source
      || 'templateVersion' in payload.source
      || 'idMap' in payload
      || 'stampedAt' in payload) {
      return 'Direct Profile Mod instance cannot claim template provenance or an identity map'
    }
    return undefined
  }

  if (!nonEmptyString(payload.source.templateId)
    || !positiveSafeInteger(payload.source.templateVersion)
    || !canonicalTimestamp(payload.stampedAt)) {
    return 'Stamped Profile Mod instance provenance is invalid'
  }
  if ('createdAt' in payload
    || !isPlainRecord(payload.idMap)
    || !isPlainRecord(payload.idMap.mod)
    || !Array.isArray(payload.idMap.controls)) {
    return 'Stamped Profile Mod instance identity map is invalid'
  }

  const modMap = payload.idMap.mod
  if (modMap.sourceId !== payload.source.templateId
    || modMap.instanceId !== record.recordId
    || modMap.sourceId === modMap.instanceId) {
    return 'Profile Mod instance Mod identity map is invalid'
  }
  const sourceIds = new Set<string>([modMap.sourceId as string])
  const instanceIds = new Set<string>([modMap.instanceId as string])
  const pairs: Record<string, unknown>[] = []
  for (let index = 0; index < payload.idMap.controls.length; index += 1) {
    const pair = payload.idMap.controls[index]
    if (!isPlainRecord(pair)
      || !nonEmptyString(pair.sourceId)
      || !nonEmptyString(pair.instanceId)
      || sourceIds.has(pair.sourceId)
      || instanceIds.has(pair.instanceId)) {
      return `Profile Mod instance control identity map entry ${index} is invalid`
    }
    pairs.push(pair)
    sourceIds.add(pair.sourceId)
    instanceIds.add(pair.instanceId)
  }
  for (const pair of pairs) {
    if (pair.sourceId === pair.instanceId
      || instanceIds.has(pair.sourceId as string)
      || sourceIds.has(pair.instanceId as string)) {
      return 'Profile Mod instance identity map does not contain fresh identities'
    }
  }
  return undefined
}

function validateModDocument(value: unknown, path: string): string | undefined {
  if (!isPlainRecord(value)) return `${path} must be an object`
  // Browser-load normalization is allowed to repair legacy data. Profile
  // authority uses the same current-schema predicate but accepts only the
  // unchanged branch, so repaired or filtered data always fails explicitly.
  const normalized = normalizeMod(value)
  if (normalized !== value) return `${path} does not satisfy the current Mod schema`
  return undefined
}

function jsonValidationError(
  value: unknown,
  path: string,
  ancestors: WeakSet<object>,
): string | undefined {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return undefined
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return `${path} contains a non-finite number`
    return Object.is(value, -0) ? `${path} contains negative zero, which JSON cannot preserve` : undefined
  }
  if (typeof value !== 'object') return `${path} contains a non-JSON value`
  if (ancestors.has(value)) return `${path} contains a cycle`
  ancestors.add(value)

  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) {
      return `${path} contains a non-standard array prototype`
    }
    if (Object.getOwnPropertySymbols(value).length > 0) return `${path} contains a symbol key`
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== value.length + 1
      || names.some((name) => name !== 'length'
        && (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= value.length))) {
      return `${path} contains a sparse or extended array`
    }
    for (let index = 0; index < value.length; index += 1) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) return `${path} contains a sparse array`
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor)) return `${path}[${index}] is executable`
      const error = jsonValidationError(descriptor.value, `${path}[${index}]`, ancestors)
      if (error) return error
    }
    ancestors.delete(value)
    return undefined
  }

  if (!isPlainRecord(value)) return `${path} contains a non-plain object`
  if (Object.getOwnPropertySymbols(value).length > 0) return `${path} contains a symbol key`
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor)) return `${path}.${key} is not inert JSON data`
    const error = jsonValidationError(descriptor.value, `${path}.${key}`, ancestors)
    if (error) return error
  }
  ancestors.delete(value)
  return undefined
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deepFreeze(entry)
  return Object.freeze(value)
}

function success<Value>(value: Value): ProfileModResult<Value> {
  return Object.freeze({ ok: true, value })
}

function invalid(message: string): ProfileModResult<never> {
  return failure('invalid', message)
}

function failure(code: ProfileModFailureCode, message: string): ProfileModResult<never> {
  return Object.freeze({ ok: false, code, message })
}
