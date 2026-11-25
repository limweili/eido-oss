import type { CardAsset } from '../graph/types'
import {
  hydrateProfileLogicalAsset,
  readProfileLogicalAssetPayload,
  type ProfileLogicalAssetPayload,
} from './profileAssetKernel'
import {
  hydrateProfileLogicalDocument,
  validateProfileLogicalDocument,
  type ProfileAssetHydrator,
  type ProfileLogicalDocument,
  type ProfileLogicalRecordSpec,
} from './profileLogicalProjection'
import {
  PROFILE_CONTRACT_VERSIONS,
  type ProfileContractVersions,
  type ProfileSnapshot,
} from './profileServiceContract'

export const PROFILE_IDEA_CLOSURE_FORMAT = 'eido-idea-closure' as const
export const PROFILE_IDEA_CLOSURE_VERSION = 1 as const

export const PROFILE_IDEA_REMAP_V1_LIMITS = Object.freeze({
  maxUniqueDecodedAssetBytes: 16 * 1024 * 1024,
  maxHydratedDataUrlCodeUnits: 24 * 1024 * 1024,
})

export type ProfileIdeaClosureAsset = Readonly<{
  logicalAssetId: string
  sha256: string
  size: number
  mimeType: string
}>

export type ProfileIdeaClosure = Readonly<{
  format: typeof PROFILE_IDEA_CLOSURE_FORMAT
  version: typeof PROFILE_IDEA_CLOSURE_VERSION
  source: Readonly<{
    profileId: string
    revision: number
    versions: ProfileContractVersions
    ideaId: string
  }>
  records: readonly ProfileLogicalRecordSpec[]
  assets: readonly ProfileIdeaClosureAsset[]
}>

export type HydratedProfileIdeaClosure = Readonly<{
  closure: ProfileIdeaClosure
  document: ProfileLogicalDocument
  snapshot: ProfileSnapshot
  assets: ReadonlyMap<string, ProfileLogicalAssetPayload>
}>

export type ProfileIdeaClosureErrorCode = 'invalid' | 'idea-remap-too-large'

export class ProfileIdeaClosureError extends Error {
  readonly code: ProfileIdeaClosureErrorCode

  constructor(code: ProfileIdeaClosureErrorCode, message: string) {
    super(message)
    this.name = 'ProfileIdeaClosureError'
    this.code = code
  }
}

export function extractProfileIdeaClosure(
  candidate: unknown,
  ideaId: string,
): ProfileIdeaClosure {
  if (!nonEmptyString(ideaId)) fail('invalid', 'Profile Idea closure identity is invalid')
  let document: ProfileLogicalDocument
  try {
    document = validateProfileLogicalDocument(candidate)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown logical projection failure'
    fail('invalid', `Profile Idea source document is invalid: ${message}`)
  }
  const boardId = boardRecordId(ideaId)
  const idea = document.records.find((record) => (
    record.kind === 'idea'
    && record.recordId === ideaId
    && record.ownerId === document.head.profileId
    && record.parentId === document.head.profileId
  ))
  const board = document.records.find((record) => (
    record.kind === 'board'
    && record.recordId === boardId
    && record.ownerId === ideaId
    && record.parentId === ideaId
  ))
  if (!idea || !board) fail('invalid', `Profile does not contain Idea ${ideaId}`)

  const records = document.records
    .filter((record) => record.recordId === ideaId || record.recordId === boardId || record.ownerId === boardId)
    .map(cloneJson)
    .sort(compareRecords)
  const closure = Object.freeze({
    format: PROFILE_IDEA_CLOSURE_FORMAT,
    version: PROFILE_IDEA_CLOSURE_VERSION,
    source: Object.freeze({
      profileId: document.head.profileId,
      revision: document.head.revision,
      versions: cloneJson(document.head.versions),
      ideaId,
    }),
    records: Object.freeze(records),
    assets: Object.freeze(readAssets(records).map(toDescriptor)),
  }) satisfies ProfileIdeaClosure
  // Validate the selected closure independently of every omitted Idea.
  toProfileIdeaClosureDocument(closure)
  return closure
}

export function readProfileIdeaClosure(candidate: unknown): ProfileIdeaClosure {
  assertInertJson(candidate)
  if (!isPlainRecord(candidate) || !hasExactKeys(candidate, [
    'assets',
    'format',
    'records',
    'source',
    'version',
  ]) || candidate.format !== PROFILE_IDEA_CLOSURE_FORMAT
    || candidate.version !== PROFILE_IDEA_CLOSURE_VERSION
    || !isPlainRecord(candidate.source)
    || !hasExactKeys(candidate.source, ['ideaId', 'profileId', 'revision', 'versions'])
    || !nonEmptyString(candidate.source.profileId)
    || !nonEmptyString(candidate.source.ideaId)
    || !nonNegativeSafeInteger(candidate.source.revision)
    || !Array.isArray(candidate.records)
    || !Array.isArray(candidate.assets)) {
    fail('invalid', 'Profile Idea closure envelope is invalid')
  }
  const closure = cloneJson(candidate) as ProfileIdeaClosure
  if (canonicalJson(closure.source.versions) !== canonicalJson(PROFILE_CONTRACT_VERSIONS)) {
    fail('invalid', 'Profile Idea closure versions are unsupported')
  }
  if (canonicalJson([...closure.records].sort(compareRecords)) !== canonicalJson(closure.records)
    || canonicalJson(readAssets(closure.records).map(toDescriptor)) !== canonicalJson(closure.assets)) {
    fail('invalid', 'Profile Idea closure is not canonical or complete')
  }
  const document = toProfileIdeaClosureDocumentUnchecked(closure)
  try {
    validateProfileLogicalDocument(document)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown logical projection failure'
    fail('invalid', `Profile Idea closure is invalid: ${message}`)
  }
  return freezeClosure(closure)
}

export function toProfileIdeaClosureDocument(candidate: unknown): ProfileLogicalDocument {
  const closure = isTrustedClosure(candidate) ? candidate : readProfileIdeaClosure(candidate)
  const document = toProfileIdeaClosureDocumentUnchecked(closure)
  try {
    validateProfileLogicalDocument(document)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown logical projection failure'
    fail('invalid', `Profile Idea closure is invalid: ${message}`)
  }
  return document
}

export function hydrateProfileIdeaClosure(
  candidate: unknown,
  hydrateAsset: ProfileAssetHydrator,
): HydratedProfileIdeaClosure {
  const closure = isTrustedClosure(candidate) ? candidate : readProfileIdeaClosure(candidate)
  preflightProfileIdeaRemap(closure)
  const document = toProfileIdeaClosureDocument(closure)
  const assets = new Map(readAssets(closure.records).map((asset) => [asset.id, asset] as const))
  const dataUrlByContent = new Map<string, string>()
  let snapshot: ProfileSnapshot
  try {
    snapshot = hydrateProfileLogicalDocument(document, (payload): CardAsset => {
      const metadata = assets.get(payload.id)
      if (!metadata || canonicalJson(metadata) !== canonicalJson(payload)) {
        fail('invalid', `Profile Idea asset ${payload.id} is outside its verified closure`)
      }
      const cacheKey = `${payload.sha256}\0${payload.mimeType}`
      let dataUrl = dataUrlByContent.get(cacheKey)
      if (dataUrl === undefined) {
        dataUrl = hydrateAsset(payload).dataUrl
        dataUrlByContent.set(cacheKey, dataUrl)
      }
      return hydrateProfileLogicalAsset(payload, dataUrl)
    })
  } catch (error) {
    if (error instanceof ProfileIdeaClosureError) throw error
    const message = error instanceof Error ? error.message : 'unknown logical projection failure'
    fail('invalid', `Profile Idea closure hydration failed: ${message}`)
  }
  return Object.freeze({ closure, document, snapshot, assets })
}

export function preflightProfileIdeaRemap(candidate: unknown): Readonly<{
  uniqueDecodedAssetBytes: number
  hydratedDataUrlCodeUnits: number
}> {
  const closure = isTrustedClosure(candidate) ? candidate : readProfileIdeaClosure(candidate)
  const digestSizes = new Map<string, number>()
  const countedContents = new Set<string>()
  let uniqueDecodedAssetBytes = 0
  let hydratedDataUrlCodeUnits = 0
  for (const asset of closure.assets) {
    const previousSize = digestSizes.get(asset.sha256)
    if (previousSize !== undefined && previousSize !== asset.size) {
      fail('invalid', `Profile Idea blob ${asset.sha256} has conflicting sizes`)
    }
    if (previousSize === undefined) digestSizes.set(asset.sha256, asset.size)
    const contentKey = `${asset.sha256}\0${asset.mimeType}`
    if (!countedContents.has(contentKey)) {
      countedContents.add(contentKey)
      uniqueDecodedAssetBytes += asset.size
    }
    hydratedDataUrlCodeUnits += `data:${asset.mimeType};base64,`.length + 4 * Math.ceil(asset.size / 3)
    if (uniqueDecodedAssetBytes > PROFILE_IDEA_REMAP_V1_LIMITS.maxUniqueDecodedAssetBytes
      || hydratedDataUrlCodeUnits > PROFILE_IDEA_REMAP_V1_LIMITS.maxHydratedDataUrlCodeUnits) {
      fail('idea-remap-too-large', 'Profile Idea asset closure exceeds the v1 remap hydration bound')
    }
  }
  return Object.freeze({ uniqueDecodedAssetBytes, hydratedDataUrlCodeUnits })
}

function toProfileIdeaClosureDocumentUnchecked(closure: ProfileIdeaClosure): ProfileLogicalDocument {
  const profileId = closure.source.profileId
  const records: ProfileLogicalRecordSpec[] = [
    {
      recordId: profileId,
      kind: 'profile',
      ownerId: profileId,
      parentId: null,
      ordinal: 0,
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      payload: { profileId },
    },
    {
      recordId: `compatibility:${profileId}`,
      kind: 'compatibility-state',
      ownerId: profileId,
      parentId: profileId,
      ordinal: 0,
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      payload: { read: 'supported', write: 'supported', source: 'friends-alpha' },
    },
    ...closure.records.map((record) => (
      record.kind === 'idea' ? { ...cloneJson(record), ordinal: 0 } : cloneJson(record)
    )),
  ]
  return cloneJson({
    head: {
      profileId,
      revision: closure.source.revision,
      versions: closure.source.versions,
      activeIdeaId: closure.source.ideaId,
    },
    records,
  })
}

function readAssets(records: readonly ProfileLogicalRecordSpec[]): ProfileLogicalAssetPayload[] {
  const assets = new Map<string, ProfileLogicalAssetPayload>()
  const remember = (value: unknown) => {
    const asset = readProfileLogicalAssetPayload(value)
    if (!asset) fail('invalid', 'Profile Idea contains invalid logical asset metadata')
    const previous = assets.get(asset.id)
    if (previous && canonicalJson(previous) !== canonicalJson(asset)) {
      fail('invalid', `Profile Idea logical asset ${asset.id} changes metadata`)
    }
    assets.set(asset.id, asset)
  }
  for (const record of records) {
    if (record.kind === 'logical-asset') remember(record.payload)
    if (record.kind !== 'intent-event' || !isPlainRecord(record.payload)
      || !['card.created', 'group.created', 'card.deleted'].includes(String(record.payload.type))
      || !isPlainRecord(record.payload.data) || !isPlainRecord(record.payload.data.card)) continue
    const historical = record.payload.data.card.assets
    if (historical === undefined) continue
    if (!Array.isArray(historical)) fail('invalid', 'Historical Profile Idea assets are invalid')
    historical.forEach(remember)
  }
  return [...assets.values()].sort((left, right) => codeUnitCompare(left.id, right.id))
}

function toDescriptor(asset: ProfileLogicalAssetPayload): ProfileIdeaClosureAsset {
  return Object.freeze({
    logicalAssetId: asset.id,
    sha256: asset.sha256,
    size: asset.size,
    mimeType: asset.mimeType,
  })
}

function isTrustedClosure(value: unknown): value is ProfileIdeaClosure {
  return isPlainRecord(value)
    && value.format === PROFILE_IDEA_CLOSURE_FORMAT
    && value.version === PROFILE_IDEA_CLOSURE_VERSION
    && Object.isFrozen(value)
}

function compareRecords(left: ProfileLogicalRecordSpec, right: ProfileLogicalRecordSpec): number {
  return codeUnitCompare(left.recordId, right.recordId)
}

function boardRecordId(ideaId: string): string {
  return `board:${ideaId}`
}

function assertInertJson(value: unknown): void {
  const pending: Array<{ value: unknown; depth: number; exit?: boolean }> = [{ value, depth: 0 }]
  const ancestors = new WeakSet<object>()
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    if (current.exit) {
      if (typeof current.value === 'object' && current.value !== null) ancestors.delete(current.value)
      continue
    }
    nodes += 1
    if (current.depth > 128 || nodes > 2_000_000) fail('invalid', 'Profile Idea closure exceeds its JSON bound')
    if (current.value === null || typeof current.value === 'boolean' || typeof current.value === 'string') continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value) || Object.is(current.value, -0)) {
        fail('invalid', 'Profile Idea closure contains a lossy JSON number')
      }
      continue
    }
    if (typeof current.value !== 'object' || ancestors.has(current.value)) {
      fail('invalid', 'Profile Idea closure contains a non-JSON value or cycle')
    }
    ancestors.add(current.value)
    pending.push({ ...current, exit: true })
    const descriptors = Object.getOwnPropertyDescriptors(current.value)
    const names = Object.getOwnPropertyNames(current.value)
    if (Object.getOwnPropertySymbols(current.value).length > 0) {
      fail('invalid', 'Profile Idea closure contains symbol fields')
    }
    if (Array.isArray(current.value)) {
      if (Object.getPrototypeOf(current.value) !== Array.prototype || names.length !== current.value.length + 1) {
        fail('invalid', 'Profile Idea closure contains a sparse or extended array')
      }
    } else if (!isPlainRecord(current.value)) {
      fail('invalid', 'Profile Idea closure contains a non-plain object')
    }
    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (Array.isArray(current.value) && key === 'length') continue
      if (!descriptor.enumerable || !('value' in descriptor)) {
        fail('invalid', 'Profile Idea closure contains executable or hidden data')
      }
      pending.push({ value: descriptor.value, depth: current.depth + 1 })
    }
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (!isPlainRecord(value)) {
    const encoded = JSON.stringify(value)
    if (encoded === undefined) fail('invalid', 'Profile Idea closure contains a non-JSON value')
    return encoded
  }
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
}

function freezeClosure(closure: ProfileIdeaClosure): ProfileIdeaClosure {
  closure.records.forEach((record) => deepFreeze(record))
  closure.assets.forEach((asset) => deepFreeze(asset))
  deepFreeze(closure.source)
  Object.freeze(closure.records)
  Object.freeze(closure.assets)
  return Object.freeze(closure)
}

function deepFreeze(value: unknown): void {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return
  Object.freeze(value)
  Object.values(value).forEach(deepFreeze)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function fail(code: ProfileIdeaClosureErrorCode, message: string): never {
  throw new ProfileIdeaClosureError(code, message)
}
