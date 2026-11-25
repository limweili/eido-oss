import type { CardAsset, CardAssetKind } from '../graph/types'
import { PROFILE_CONTRACT_VERSIONS } from './profileServiceContract'

export type ProfileLogicalAssetPayload = Readonly<{
  id: string
  assetVersion: typeof PROFILE_CONTRACT_VERSIONS.asset
  kind: CardAssetKind
  name: string
  mimeType: string
  size: number
  createdAt: string
  sha256: string
  width?: number
  height?: number
  originalSize?: number
  originalMimeType?: string
  compression?: 'compressed'
}>

export type ProfileAssetAddInput = Readonly<{
  ideaId: string
  cardId: string
  asset: CardAsset
}>

export type ProfileAssetAddReference = Readonly<{
  ideaId: string
  cardId: string
  asset: ProfileLogicalAssetPayload
}>

export type ProfileAssetRemoveInput = Readonly<{
  ideaId: string
  cardId: string
  assetId: string
}>

const CARD_ASSET_FIELDS = new Set([
  'id',
  'kind',
  'name',
  'mimeType',
  'dataUrl',
  'size',
  'createdAt',
  'width',
  'height',
  'originalSize',
  'originalMimeType',
  'compression',
])

const LOGICAL_ASSET_FIELDS = new Set([
  'id',
  'assetVersion',
  'kind',
  'name',
  'mimeType',
  'size',
  'createdAt',
  'sha256',
  'width',
  'height',
  'originalSize',
  'originalMimeType',
  'compression',
])

export function readProfileAssetAddInput(value: unknown): ProfileAssetAddInput | undefined {
  if (!hasExactFields(value, ['asset', 'cardId', 'ideaId'])) return undefined
  const asset = readCardAsset(value.asset)
  if (!asset || !isNonEmptyString(value.ideaId) || !isNonEmptyString(value.cardId)) return undefined
  return Object.freeze({ ideaId: value.ideaId, cardId: value.cardId, asset })
}

export function readProfileAssetAddReference(
  value: unknown,
): ProfileAssetAddReference | undefined {
  if (!hasExactFields(value, ['asset', 'cardId', 'ideaId'])) return undefined
  const asset = readProfileLogicalAssetPayload(value.asset)
  if (!asset || !isNonEmptyString(value.ideaId) || !isNonEmptyString(value.cardId)) return undefined
  return Object.freeze({ ideaId: value.ideaId, cardId: value.cardId, asset })
}

export function readProfileAssetRemoveInput(value: unknown): ProfileAssetRemoveInput | undefined {
  if (!hasExactFields(value, ['assetId', 'cardId', 'ideaId'])) return undefined
  if (
    !isNonEmptyString(value.ideaId)
    || !isNonEmptyString(value.cardId)
    || !isNonEmptyString(value.assetId)
  ) return undefined
  return Object.freeze({
    ideaId: value.ideaId,
    cardId: value.cardId,
    assetId: value.assetId,
  })
}

export function toProfileLogicalAssetPayload(
  asset: CardAsset,
  sha256: string,
): ProfileLogicalAssetPayload {
  const validated = readCardAsset(asset)
  if (!validated || !isSha256(sha256)) throw new Error('Profile asset metadata is invalid')
  const { dataUrl: _dataUrl, ...metadata } = validated
  return Object.freeze({
    ...metadata,
    assetVersion: PROFILE_CONTRACT_VERSIONS.asset,
    sha256,
  })
}

export function readProfileLogicalAssetPayload(
  value: unknown,
): ProfileLogicalAssetPayload | undefined {
  if (!isPlainRecord(value) || !hasOnlyFields(value, LOGICAL_ASSET_FIELDS)) return undefined
  if (
    !isNonEmptyString(value.id)
    || value.assetVersion !== PROFILE_CONTRACT_VERSIONS.asset
    || !isCardAssetKind(value.kind)
    || !isAssetName(value.name)
    || !isMimeType(value.mimeType)
    || !isNonNegativeInteger(value.size)
    || !isNonEmptyString(value.createdAt)
    || !isSha256(value.sha256)
    || !validOptionalPositiveInteger(value.width)
    || !validOptionalPositiveInteger(value.height)
    || !validOptionalNonNegativeInteger(value.originalSize)
    || !validOptionalMimeType(value.originalMimeType)
    || (value.compression !== undefined && value.compression !== 'compressed')
  ) return undefined
  return Object.freeze({
    id: value.id,
    assetVersion: PROFILE_CONTRACT_VERSIONS.asset,
    kind: value.kind,
    name: value.name,
    mimeType: value.mimeType,
    size: value.size,
    createdAt: value.createdAt,
    sha256: value.sha256,
    ...(value.width === undefined ? {} : { width: value.width }),
    ...(value.height === undefined ? {} : { height: value.height }),
    ...(value.originalSize === undefined ? {} : { originalSize: value.originalSize }),
    ...(value.originalMimeType === undefined ? {} : { originalMimeType: value.originalMimeType }),
    ...(value.compression === undefined ? {} : { compression: value.compression }),
  })
}

export function hydrateProfileLogicalAsset(
  payload: ProfileLogicalAssetPayload,
  dataUrl: string,
): CardAsset {
  const validated = readProfileLogicalAssetPayload(payload)
  if (!validated || !dataUrl.startsWith(`data:${validated.mimeType};base64,`)) {
    throw new Error('Profile asset hydration is invalid')
  }
  const { assetVersion: _assetVersion, sha256: _sha256, ...metadata } = validated
  return Object.freeze({ ...metadata, dataUrl })
}

export function readCardAssetIds(payload: unknown): readonly string[] {
  if (!isPlainRecord(payload)) throw new Error('Profile Card payload is invalid')
  const value = payload.assetIds
  if (value === undefined) return Object.freeze([])
  if (
    !Array.isArray(value)
    || value.some((assetId) => !isNonEmptyString(assetId))
    || new Set(value).size !== value.length
  ) throw new Error('Profile Card asset IDs are invalid')
  return Object.freeze([...value])
}

export function withCardAssetIds(
  payload: unknown,
  assetIds: readonly string[],
): Record<string, unknown> {
  if (!isPlainRecord(payload)) throw new Error('Profile Card payload is invalid')
  if (
    assetIds.some((assetId) => !isNonEmptyString(assetId))
    || new Set(assetIds).size !== assetIds.length
  ) throw new Error('Profile Card asset IDs are invalid')
  const clone = { ...payload }
  if (assetIds.length === 0) delete clone.assetIds
  else clone.assetIds = [...assetIds]
  return clone
}

function readCardAsset(value: unknown): CardAsset | undefined {
  if (!isPlainRecord(value) || !hasOnlyFields(value, CARD_ASSET_FIELDS)) return undefined
  if (
    !isNonEmptyString(value.id)
    || !isCardAssetKind(value.kind)
    || !isAssetName(value.name)
    || !isMimeType(value.mimeType)
    || !isNonEmptyString(value.dataUrl)
    || !isNonNegativeInteger(value.size)
    || !isNonEmptyString(value.createdAt)
    || !validOptionalPositiveInteger(value.width)
    || !validOptionalPositiveInteger(value.height)
    || !validOptionalNonNegativeInteger(value.originalSize)
    || !validOptionalMimeType(value.originalMimeType)
    || (value.compression !== undefined && value.compression !== 'compressed')
  ) return undefined
  return Object.freeze({
    id: value.id,
    kind: value.kind,
    name: value.name,
    mimeType: value.mimeType,
    dataUrl: value.dataUrl,
    size: value.size,
    createdAt: value.createdAt,
    ...(value.width === undefined ? {} : { width: value.width }),
    ...(value.height === undefined ? {} : { height: value.height }),
    ...(value.originalSize === undefined ? {} : { originalSize: value.originalSize }),
    ...(value.originalMimeType === undefined ? {} : { originalMimeType: value.originalMimeType }),
    ...(value.compression === undefined ? {} : { compression: value.compression }),
  })
}

function hasExactFields(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  return isPlainRecord(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',')
}

function hasOnlyFields(value: Record<string, unknown>, allowed: ReadonlySet<string>): boolean {
  return Object.keys(value).every((key) => allowed.has(key))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function validOptionalPositiveInteger(value: unknown): value is number | undefined {
  return value === undefined || isPositiveInteger(value)
}

function validOptionalNonNegativeInteger(value: unknown): value is number | undefined {
  return value === undefined || isNonNegativeInteger(value)
}

function validOptionalMimeType(value: unknown): value is string | undefined {
  return value === undefined || isMimeType(value)
}

function isCardAssetKind(value: unknown): value is CardAssetKind {
  return value === 'image' || value === 'file'
}

function isMimeType(value: unknown): value is string {
  return typeof value === 'string'
    && /^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value)
}

function isAssetName(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && !value.includes('/')
    && !value.includes('\\')
    && !value.includes('\0')
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}
