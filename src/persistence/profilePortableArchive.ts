import {
  readProfileLogicalAssetPayload,
  type ProfileLogicalAssetPayload,
} from './profileAssetKernel'
import {
  enumerateProfileAssetDigests,
  type ProfileLogicalDocument,
} from './profileLogicalProjection'
import {
  PROFILE_CONTRACT_VERSIONS,
  type ProfileContractVersions,
} from './profileServiceContract'

export const PROFILE_PORTABLE_ARCHIVE_FORMAT = 'eido-portable' as const

export const PROFILE_PORTABLE_ARCHIVE_PATHS = Object.freeze({
  manifest: 'manifest.json',
  profile: 'profile.json',
  blobPrefix: 'blobs/sha256/',
})

export const PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS = Object.freeze({
  maxEntries: 65_535,
  maxManifestBytes: 16 * 1024 * 1024,
  maxProfileBytes: 64 * 1024 * 1024,
  maxBlobBytes: 2 * 1024 * 1024 * 1024,
  maxTotalContentBytes: 4_000_000_000,
  maxArchiveBytes: 0xffff_ffff,
  maxJsonDepth: 128,
  maxJsonNodes: 2_000_000,
})

export const PROFILE_PORTABLE_ARCHIVE_V1_EXCLUDED_STATE = Object.freeze([
  'caches',
  'credentials',
  'derived-indexes',
  'device-settings',
  'executable-mod-behavior',
  'locks',
  'owner-fence-sidecar',
  'physical-paths',
  'receipts',
  'recovery-generations',
  'sqlite-wal-shm',
] as const)

export const PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA = Object.freeze({
  modifiedAt: '1980-01-01T00:00:00.000Z',
  mode: 0o100600,
  comment: '',
  extraFieldIds: Object.freeze([] as number[]),
})

export type ProfilePortableArchiveErrorCode =
  | 'invalid'
  | 'unsupported-future-version'
  | 'bounds-exceeded'
  | 'integrity-mismatch'

export class ProfilePortableArchiveError extends Error {
  readonly code: ProfilePortableArchiveErrorCode

  constructor(code: ProfilePortableArchiveErrorCode, message: string) {
    super(message)
    this.name = 'ProfilePortableArchiveError'
    this.code = code
  }
}

export type ProfilePortableArchiveSha256 = (
  bytes: Uint8Array,
) => Promise<string> | string

export type ProfilePortableArchiveEntryDescriptor = Readonly<{
  path: string
  mediaType: 'application/vnd.eido.profile+json' | 'application/octet-stream'
  size: number
  sha256: string
}>

export type ProfilePortableArchiveAssetDescriptor = Readonly<{
  logicalAssetId: string
  sha256: string
  size: number
}>

export type ProfilePortableArchiveManifestCore = Readonly<{
  format: typeof PROFILE_PORTABLE_ARCHIVE_FORMAT
  version: typeof PROFILE_CONTRACT_VERSIONS.export
  profile: Readonly<{
    profileId: string
    revision: number
    versions: ProfileContractVersions
  }>
  entries: readonly ProfilePortableArchiveEntryDescriptor[]
  assets: readonly ProfilePortableArchiveAssetDescriptor[]
  excludedState: typeof PROFILE_PORTABLE_ARCHIVE_V1_EXCLUDED_STATE
}>

export type ProfilePortableArchiveManifest = ProfilePortableArchiveManifestCore & Readonly<{
  integrity: Readonly<{
    algorithm: 'sha256'
    root: string
  }>
}>

export type ProfilePortableArchivePlannedContent =
  | Readonly<{ kind: 'bytes'; bytes: Uint8Array }>
  | Readonly<{ kind: 'blob'; sha256: string; size: number }>

export type ProfilePortableArchivePlannedEntry = Readonly<{
  path: string
  kind: 'file'
  compression: 'store'
  encrypted: false
  modifiedAt: typeof PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA.modifiedAt
  mode: typeof PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA.mode
  comment: ''
  extraFieldIds: readonly []
  content: ProfilePortableArchivePlannedContent
}>

export type ProfilePortableArchivePlan = Readonly<{
  manifest: ProfilePortableArchiveManifest
  manifestBytes: Uint8Array
  profileBytes: Uint8Array
  entries: readonly ProfilePortableArchivePlannedEntry[]
}>

export type ProfilePortableArchiveContainerEntry = Readonly<{
  path: string
  localHeaderPath: string
  headersMatch: boolean
  centralDirectoryOrdinal: number
  kind: 'file' | 'directory' | 'symlink' | 'other'
  compression: 'store' | 'compressed' | 'unsupported'
  encrypted: boolean
  usesDataDescriptor: boolean
  crc32Verified: boolean
  crc32VerifiedOnStream?: true
  compressedSize: bigint
  size: bigint
  localHeaderOffset: bigint
  dataOffset: bigint
  dataEnd: bigint
  modifiedAt: string
  mode: number
  comment: string
  extraFieldIds: readonly number[]
  readBytes(maxBytes: number): Promise<Uint8Array>
  streamBytes(maxBytes: number): AsyncIterable<Uint8Array>
}>

export type ProfilePortableArchiveContainerObservation = Readonly<{
  archiveSize: bigint
  centralDirectoryOffset: bigint
  centralDirectoryRecordsEnd: bigint
  endOfCentralDirectoryOffset: bigint
  endOfCentralDirectoryEnd: bigint
  usesZip64: boolean
  comment: string
  entries: readonly ProfilePortableArchiveContainerEntry[]
}>

export type ProfilePortableArchiveBlobStageInput = Readonly<{
  path: string
  expectedSha256: string
  expectedSize: bigint
  maxBytes: number
  bytes: AsyncIterable<Uint8Array>
}>

export type ProfilePortableArchiveBlobStageResult<StableContent> = Readonly<{
  content: StableContent
  sha256: string
  size: bigint
}>

/**
 * Consumes the supplied stream once, verifies it while writing to operation-owned
 * staging, and returns content detached from the still-live archive source.
 */
export type ProfilePortableArchiveBlobStager<StableContent> = (
  input: ProfilePortableArchiveBlobStageInput,
) => Promise<ProfilePortableArchiveBlobStageResult<StableContent>>

export type ProfilePortableArchiveVerifiedBlob<StableContent> = Readonly<{
  path: string
  sha256: string
  size: bigint
  content: StableContent
}>

export type ProfilePortableArchiveReadResult<StableContent = unknown> = Readonly<{
  manifest: ProfilePortableArchiveManifest
  document: ProfileLogicalDocument
  verifiedBlobs: readonly ProfilePortableArchiveVerifiedBlob<StableContent>[]
}>

export async function planProfilePortableArchive(input: Readonly<{
  document: unknown
  sha256: ProfilePortableArchiveSha256
}>): Promise<ProfilePortableArchivePlan> {
  const document = validateLogicalDocument(input.document)
  const profileBytes = canonicalProfilePortableDocumentBytes(document)
  if (profileBytes.byteLength > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxProfileBytes) {
    fail('bounds-exceeded', 'Portable Profile document exceeds the v1 size bound')
  }

  const assets = readLogicalAssetInventory(document)
  const blobDescriptors = blobEntryDescriptors(assets)
  if (blobDescriptors.length + 2 > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxEntries) {
    fail('bounds-exceeded', 'Portable archive exceeds the v1 entry-count bound')
  }
  const blobBytes = blobDescriptors.reduce((total, entry) => total + entry.size, 0)
  if (blobBytes + profileBytes.byteLength > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxTotalContentBytes) {
    fail('bounds-exceeded', 'Portable archive exceeds the v1 total-content bound')
  }

  const profileDigest = await digestBytes(profileBytes, input.sha256)
  const core: ProfilePortableArchiveManifestCore = {
    format: PROFILE_PORTABLE_ARCHIVE_FORMAT,
    version: PROFILE_CONTRACT_VERSIONS.export,
    profile: {
      profileId: document.head.profileId,
      revision: document.head.revision,
      versions: cloneJson(document.head.versions),
    },
    entries: [
      {
        path: PROFILE_PORTABLE_ARCHIVE_PATHS.profile,
        mediaType: 'application/vnd.eido.profile+json',
        size: profileBytes.byteLength,
        sha256: profileDigest,
      },
      ...blobDescriptors,
    ],
    assets,
    excludedState: PROFILE_PORTABLE_ARCHIVE_V1_EXCLUDED_STATE,
  }
  const root = await digestBytes(encodeCanonicalJson(core), input.sha256)
  const manifest: ProfilePortableArchiveManifest = {
    ...core,
    integrity: { algorithm: 'sha256', root },
  }
  const manifestBytes = encodeCanonicalJson(manifest)
  if (manifestBytes.byteLength > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxManifestBytes) {
    fail('bounds-exceeded', 'Portable archive manifest exceeds the v1 size bound')
  }
  if (blobBytes + profileBytes.byteLength + manifestBytes.byteLength
    > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxTotalContentBytes) {
    fail('bounds-exceeded', 'Portable archive exceeds the v1 total-content bound')
  }

  return {
    manifest: deepFreeze(cloneJson(manifest)),
    manifestBytes,
    profileBytes,
    entries: Object.freeze([
      plannedBytesEntry(PROFILE_PORTABLE_ARCHIVE_PATHS.manifest, manifestBytes),
      plannedBytesEntry(PROFILE_PORTABLE_ARCHIVE_PATHS.profile, profileBytes),
      ...blobDescriptors.map((entry) => plannedBlobEntry(entry.sha256, entry.size)),
    ]),
  }
}

export async function readProfilePortableArchive<StableContent>(input: Readonly<{
  container: ProfilePortableArchiveContainerObservation
  sha256: ProfilePortableArchiveSha256
  stageBlob: ProfilePortableArchiveBlobStager<StableContent>
}>): Promise<ProfilePortableArchiveReadResult<StableContent>> {
  const entries = validateContainerEntries(input.container)
  const byPath = new Map(entries.map((entry) => [entry.path, entry]))
  const manifestEntry = byPath.get(PROFILE_PORTABLE_ARCHIVE_PATHS.manifest)
  const profileEntry = byPath.get(PROFILE_PORTABLE_ARCHIVE_PATHS.profile)
  if (!manifestEntry || !profileEntry) fail('invalid', 'Portable archive is missing its manifest or Profile entry')
  if (manifestEntry.size > BigInt(PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxManifestBytes)) {
    fail('bounds-exceeded', 'Portable archive manifest exceeds the v1 size bound')
  }
  if (profileEntry.size > BigInt(PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxProfileBytes)) {
    fail('bounds-exceeded', 'Portable Profile document exceeds the v1 size bound')
  }

  const manifestBytes = await readExactBytes(
    manifestEntry,
    PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxManifestBytes,
  )
  const manifestValue = parseCanonicalJson(manifestBytes, 'manifest')
  const manifest = decodeManifest(manifestValue)
  if (!equalBytes(manifestBytes, encodeCanonicalJson(manifest))) {
    fail('invalid', 'Portable archive manifest is not canonical JSON')
  }

  const expectedRoot = await digestBytes(manifestCore(manifest), input.sha256)
  if (expectedRoot !== manifest.integrity.root) {
    fail('integrity-mismatch', 'Portable archive manifest integrity root does not match')
  }

  const expectedPaths = [
    PROFILE_PORTABLE_ARCHIVE_PATHS.manifest,
    ...manifest.entries.map((entry) => entry.path),
  ]
  if (!sameStrings(canonicalEntryOrder(entries.map((entry) => entry.path)), expectedPaths)) {
    fail('invalid', 'Portable archive entry inventory does not match its manifest')
  }

  const profileBytes = await readExactBytes(
    profileEntry,
    PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxProfileBytes,
  )
  const profileValue = parseCanonicalJson(profileBytes, 'Profile')
  const document = validateLogicalDocument(profileValue)
  if (!equalBytes(profileBytes, canonicalProfilePortableDocumentBytes(document))) {
    fail('invalid', 'Portable Profile entry is not canonical JSON')
  }

  if (manifest.profile.profileId !== document.head.profileId
    || manifest.profile.revision !== document.head.revision
    || canonicalJson(manifest.profile.versions) !== canonicalJson(document.head.versions)) {
    fail('integrity-mismatch', 'Portable archive manifest does not describe its Profile document')
  }

  const expectedAssets = readLogicalAssetInventory(document)
  if (canonicalJson(manifest.assets) !== canonicalJson(expectedAssets)) {
    fail('integrity-mismatch', 'Portable archive asset inventory does not match its Profile document')
  }
  const expectedDescriptors = [
    {
      path: PROFILE_PORTABLE_ARCHIVE_PATHS.profile,
      mediaType: 'application/vnd.eido.profile+json' as const,
      size: profileBytes.byteLength,
      sha256: await digestBytes(profileBytes, input.sha256),
    },
    ...blobEntryDescriptors(expectedAssets),
  ]
  if (canonicalJson(manifest.entries) !== canonicalJson(expectedDescriptors)) {
    fail('integrity-mismatch', 'Portable archive entry descriptors do not match its logical closure')
  }

  const verifiedBlobs: ProfilePortableArchiveVerifiedBlob<StableContent>[] = []
  for (const descriptor of manifest.entries) {
    const entry = byPath.get(descriptor.path)
    if (!entry || entry.size !== BigInt(descriptor.size)) {
      fail('integrity-mismatch', `Portable archive entry ${descriptor.path} has the wrong size`)
    }
    if (descriptor.path === PROFILE_PORTABLE_ARCHIVE_PATHS.profile) continue
    const staged = await input.stageBlob({
      path: descriptor.path,
      expectedSha256: descriptor.sha256,
      expectedSize: entry.size,
      maxBytes: PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxBlobBytes,
      bytes: boundedEntryBytes(entry, PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxBlobBytes),
    })
    if (!isPlainRecord(staged) || !hasExactKeys(staged, ['content', 'sha256', 'size'])
      || !isSha256(staged.sha256) || staged.sha256 !== descriptor.sha256
      || typeof staged.size !== 'bigint' || staged.size !== entry.size) {
      fail('integrity-mismatch', `Portable archive entry ${descriptor.path} has the wrong digest`)
    }
    verifiedBlobs.push(Object.freeze({
      path: descriptor.path,
      sha256: descriptor.sha256,
      size: entry.size,
      content: staged.content as StableContent,
    }))
  }

  return {
    manifest,
    document,
    verifiedBlobs: Object.freeze(verifiedBlobs),
  }
}

function validateLogicalDocument(candidate: unknown): ProfileLogicalDocument {
  try {
    enumerateProfileAssetDigests(candidate)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown logical projection failure'
    fail('invalid', `Portable Profile document is invalid: ${message}`)
  }
  return cloneJson(candidate) as ProfileLogicalDocument
}

export function canonicalProfilePortableDocumentBytes(
  document: ProfileLogicalDocument,
): Uint8Array {
  const canonicalDocument = {
    head: document.head,
    records: [...document.records].sort((left, right) => codeUnitCompare(left.recordId, right.recordId)),
  }
  return encodeCanonicalJson(canonicalDocument)
}

function readLogicalAssetInventory(
  document: ProfileLogicalDocument,
): readonly ProfilePortableArchiveAssetDescriptor[] {
  const assets = new Map<string, ProfileLogicalAssetPayload>()
  const remember = (candidate: unknown) => {
    const asset = readProfileLogicalAssetPayload(candidate)
    if (!asset) fail('invalid', 'Portable Profile contains invalid logical asset metadata')
    const previous = assets.get(asset.id)
    if (previous && canonicalJson(previous) !== canonicalJson(asset)) {
      fail('invalid', `Portable logical asset ${asset.id} changes metadata inside one Profile`)
    }
    assets.set(asset.id, asset)
  }

  for (const record of document.records) {
    if (record.kind === 'logical-asset') remember(record.payload)
    if (record.kind !== 'intent-event' || !isPlainRecord(record.payload)
      || !['card.created', 'group.created', 'card.deleted'].includes(String(record.payload.type))
      || !isPlainRecord(record.payload.data) || !isPlainRecord(record.payload.data.card)) continue
    const historicalAssets = record.payload.data.card.assets
    if (historicalAssets === undefined) continue
    if (!Array.isArray(historicalAssets)) fail('invalid', 'Portable historical asset inventory is invalid')
    historicalAssets.forEach(remember)
  }

  const digestSizes = new Map<string, number>()
  const result = [...assets.values()]
    .sort((left, right) => codeUnitCompare(left.id, right.id))
    .map((asset) => {
      const previousSize = digestSizes.get(asset.sha256)
      if (previousSize !== undefined && previousSize !== asset.size) {
        fail('integrity-mismatch', `Portable blob ${asset.sha256} has conflicting logical sizes`)
      }
      if (asset.size > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxBlobBytes) {
        fail('bounds-exceeded', `Portable blob ${asset.sha256} exceeds the v1 size bound`)
      }
      digestSizes.set(asset.sha256, asset.size)
      return {
        logicalAssetId: asset.id,
        sha256: asset.sha256,
        size: asset.size,
      }
    })
  return deepFreeze(result)
}

function blobEntryDescriptors(
  assets: readonly ProfilePortableArchiveAssetDescriptor[],
): readonly ProfilePortableArchiveEntryDescriptor[] {
  const blobs = new Map<string, number>()
  for (const asset of assets) {
    const previous = blobs.get(asset.sha256)
    if (previous !== undefined && previous !== asset.size) {
      fail('integrity-mismatch', `Portable blob ${asset.sha256} has conflicting sizes`)
    }
    blobs.set(asset.sha256, asset.size)
  }
  return Object.freeze([...blobs.entries()]
    .sort(([left], [right]) => codeUnitCompare(left, right))
    .map(([sha256, size]) => ({
      path: blobPath(sha256),
      mediaType: 'application/octet-stream' as const,
      size,
      sha256,
    })))
}

function decodeManifest(value: unknown): ProfilePortableArchiveManifest {
  if (!hasExactKeys(value, [
    'assets',
    'entries',
    'excludedState',
    'format',
    'integrity',
    'profile',
    'version',
  ])) fail('invalid', 'Portable archive manifest envelope is invalid')
  if (value.format !== PROFILE_PORTABLE_ARCHIVE_FORMAT) {
    fail('invalid', 'Portable archive format is invalid')
  }
  if (Number.isSafeInteger(value.version) && Number(value.version) > PROFILE_CONTRACT_VERSIONS.export) {
    fail('unsupported-future-version', 'Portable archive version is newer than this Eido build')
  }
  if (value.version !== PROFILE_CONTRACT_VERSIONS.export) {
    fail('invalid', 'Portable archive version is invalid')
  }
  if (!hasExactKeys(value.profile, ['profileId', 'revision', 'versions'])
    || !nonEmptyString(value.profile.profileId)
    || !nonNegativeSafeInteger(value.profile.revision)
    || canonicalJson(value.profile.versions) !== canonicalJson(PROFILE_CONTRACT_VERSIONS)) {
    fail('invalid', 'Portable archive Profile identity or versions are invalid')
  }
  if (!Array.isArray(value.entries) || !Array.isArray(value.assets)) {
    fail('invalid', 'Portable archive manifest inventories are invalid')
  }
  const entries = value.entries.map((entry, index) => decodeEntryDescriptor(entry, index))
  if (!sameStrings(entries.map((entry) => entry.path), canonicalEntryOrder(entries.map((entry) => entry.path)))) {
    fail('invalid', 'Portable archive entry descriptors are not in canonical order')
  }
  const assets = value.assets.map((asset, index) => decodeAssetDescriptor(asset, index))
  const sortedAssets = [...assets].sort((left, right) => codeUnitCompare(left.logicalAssetId, right.logicalAssetId))
  if (canonicalJson(assets) !== canonicalJson(sortedAssets)
    || new Set(assets.map((asset) => asset.logicalAssetId)).size !== assets.length) {
    fail('invalid', 'Portable archive assets are not uniquely and canonically ordered')
  }
  if (canonicalJson(value.excludedState) !== canonicalJson(PROFILE_PORTABLE_ARCHIVE_V1_EXCLUDED_STATE)) {
    fail('invalid', 'Portable archive excluded-state contract is invalid')
  }
  if (!hasExactKeys(value.integrity, ['algorithm', 'root'])
    || value.integrity.algorithm !== 'sha256' || !isSha256(value.integrity.root)) {
    fail('invalid', 'Portable archive integrity declaration is invalid')
  }
  return deepFreeze(cloneJson({
    format: value.format,
    version: value.version,
    profile: value.profile,
    entries,
    assets,
    excludedState: value.excludedState,
    integrity: value.integrity,
  })) as unknown as ProfilePortableArchiveManifest
}

function decodeEntryDescriptor(value: unknown, index: number): ProfilePortableArchiveEntryDescriptor {
  if (!hasExactKeys(value, ['mediaType', 'path', 'sha256', 'size'])
    || !isCanonicalContentPath(value.path) || !nonNegativeSafeInteger(value.size)
    || !isSha256(value.sha256)
    || (value.mediaType !== 'application/vnd.eido.profile+json'
      && value.mediaType !== 'application/octet-stream')) {
    fail('invalid', `Portable archive entry descriptor ${index} is invalid`)
  }
  if (value.path === PROFILE_PORTABLE_ARCHIVE_PATHS.profile) {
    if (value.mediaType !== 'application/vnd.eido.profile+json'
      || value.size > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxProfileBytes) {
      fail('invalid', 'Portable Profile entry descriptor is invalid')
    }
  } else if (!isBlobPath(value.path) || value.mediaType !== 'application/octet-stream'
    || value.sha256 !== value.path.slice(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix.length)
    || value.size > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxBlobBytes) {
    fail('invalid', `Portable blob entry descriptor ${index} is invalid`)
  }
  return cloneJson(value) as ProfilePortableArchiveEntryDescriptor
}

function decodeAssetDescriptor(value: unknown, index: number): ProfilePortableArchiveAssetDescriptor {
  if (!hasExactKeys(value, ['logicalAssetId', 'sha256', 'size'])
    || !nonEmptyString(value.logicalAssetId) || !isSha256(value.sha256)
    || !nonNegativeSafeInteger(value.size)
    || value.size > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxBlobBytes) {
    fail('invalid', `Portable archive asset descriptor ${index} is invalid`)
  }
  return cloneJson(value) as ProfilePortableArchiveAssetDescriptor
}

function validateContainerEntries(
  container: ProfilePortableArchiveContainerObservation,
): readonly ProfilePortableArchiveContainerEntry[] {
  const candidates = container.entries
  if (!Array.isArray(candidates) || candidates.length === 0) {
    fail('invalid', 'Portable archive has no entries')
  }
  if (candidates.length > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxEntries) {
    fail('bounds-exceeded', 'Portable archive exceeds the v1 entry-count bound')
  }
  const paths = new Set<string>()
  const foldedPaths = new Set<string>()
  if (container.usesZip64 !== false || container.comment !== ''
    || container.archiveSize < 0n || container.centralDirectoryOffset < 0n
    || container.centralDirectoryRecordsEnd <= container.centralDirectoryOffset
    || container.endOfCentralDirectoryOffset !== container.centralDirectoryRecordsEnd
    || container.endOfCentralDirectoryEnd - container.endOfCentralDirectoryOffset !== 22n
    || container.endOfCentralDirectoryEnd !== container.archiveSize
    || container.archiveSize > BigInt(PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxArchiveBytes)
    || container.centralDirectoryOffset > 0xffff_ffffn
    || container.centralDirectoryRecordsEnd > 0xffff_ffffn
    || container.endOfCentralDirectoryOffset > 0xffff_ffffn
    || container.endOfCentralDirectoryEnd > 0xffff_ffffn) {
    fail('invalid', 'Portable archive central-directory layout is invalid')
  }
  let total = 0n
  for (let index = 0; index < candidates.length; index += 1) {
    const entry = candidates[index]
    if (!entry) fail('invalid', 'Portable archive contains a sparse entry inventory')
    if (!isSafeArchivePath(entry.path) || entry.localHeaderPath !== entry.path || !entry.headersMatch) {
      fail('invalid', `Portable archive entry ${entry.path} has inconsistent or unsafe headers`)
    }
    const folded = entry.path.toLocaleLowerCase('en-US')
    if (paths.has(entry.path) || foldedPaths.has(folded)) {
      fail('invalid', `Portable archive entry ${entry.path} is duplicated or case-colliding`)
    }
    paths.add(entry.path)
    foldedPaths.add(folded)
    const isBlob = entry.path.startsWith(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix)
    const hasCanonicalCrcProof = isBlob
      ? entry.crc32Verified === false && entry.crc32VerifiedOnStream === true
      : entry.crc32Verified === true && entry.crc32VerifiedOnStream === undefined
    if (entry.centralDirectoryOrdinal !== index
      || entry.kind !== 'file' || entry.compression !== 'store' || entry.encrypted
      || entry.usesDataDescriptor || !hasCanonicalCrcProof
      || entry.size < 0n || entry.compressedSize < 0n
      || entry.size > 0xffff_ffffn || entry.compressedSize > 0xffff_ffffn
      || entry.compressedSize !== entry.size
      || entry.localHeaderOffset < 0n || entry.dataOffset <= entry.localHeaderOffset
      || entry.dataEnd < entry.dataOffset || entry.dataEnd > container.centralDirectoryOffset
      || entry.localHeaderOffset > 0xffff_ffffn || entry.dataOffset > 0xffff_ffffn
      || entry.dataEnd > 0xffff_ffffn
      || entry.dataEnd - entry.dataOffset !== entry.size
      || entry.modifiedAt !== PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA.modifiedAt
      || entry.mode !== PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA.mode
      || entry.comment !== '' || !Array.isArray(entry.extraFieldIds)
      || entry.extraFieldIds.length !== 0) {
      fail('invalid', `Portable archive entry ${entry.path} has non-canonical or hostile metadata`)
    }
    if (isBlob && entry.size > BigInt(PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxBlobBytes)) {
      fail('bounds-exceeded', `Portable archive blob ${entry.path} exceeds the v1 size bound`)
    }
    total += entry.size
    if (total > BigInt(PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxTotalContentBytes)) {
      fail('bounds-exceeded', 'Portable archive exceeds the v1 total-content bound')
    }
  }
  const expectedOrder = canonicalEntryOrder(candidates.map((entry) => entry.path))
  if (!sameStrings(candidates.map((entry) => entry.path), expectedOrder)) {
    fail('invalid', 'Portable archive central-directory order is not canonical')
  }
  if (candidates[0]?.localHeaderOffset !== 0n) {
    fail('invalid', 'Portable archive contains an unaccounted preamble')
  }
  for (let index = 1; index < candidates.length; index += 1) {
    const previous = candidates[index - 1]
    const current = candidates[index]
    if (previous && current && current.localHeaderOffset !== previous.dataEnd) {
      fail('invalid', 'Portable archive entries overlap or contain unaccounted gaps')
    }
  }
  if (candidates[candidates.length - 1]?.dataEnd !== container.centralDirectoryOffset) {
    fail('invalid', 'Portable archive contains unaccounted data before its central directory')
  }
  return Object.freeze([...candidates])
}

async function readExactBytes(
  entry: ProfilePortableArchiveContainerEntry,
  maxBytes: number,
): Promise<Uint8Array> {
  if (entry.size > BigInt(maxBytes)) {
    fail('bounds-exceeded', `Portable archive entry ${entry.path} exceeds its bound`)
  }
  const bytes = await entry.readBytes(maxBytes)
  if (!(bytes instanceof Uint8Array) || BigInt(bytes.byteLength) !== entry.size) {
    fail('integrity-mismatch', `Portable archive entry ${entry.path} returned the wrong byte length`)
  }
  return new Uint8Array(bytes)
}

async function* boundedEntryBytes(
  entry: ProfilePortableArchiveContainerEntry,
  maxBytes: number,
): AsyncIterable<Uint8Array> {
  let observedSize = 0n
  for await (const chunk of entry.streamBytes(maxBytes)) {
    if (!(chunk instanceof Uint8Array)) {
      fail('integrity-mismatch', `Portable archive entry ${entry.path} returned a non-byte chunk`)
    }
    observedSize += BigInt(chunk.byteLength)
    if (observedSize > BigInt(maxBytes)) {
      fail('bounds-exceeded', `Portable archive entry ${entry.path} exceeded its stream bound`)
    }
    yield chunk
  }
  if (observedSize !== entry.size) {
    fail('integrity-mismatch', `Portable archive entry ${entry.path} streamed the wrong byte length`)
  }
}

function parseCanonicalJson(bytes: Uint8Array, label: string): unknown {
  if (bytes.byteLength >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    fail('invalid', `Portable ${label} JSON must not contain a BOM`)
  }
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    fail('invalid', `Portable ${label} JSON is not valid UTF-8`)
  }
  try {
    const value = JSON.parse(text) as unknown
    assertInertJson(value, `$${label}`)
    return value
  } catch (error) {
    if (error instanceof ProfilePortableArchiveError) throw error
    fail('invalid', `Portable ${label} JSON is invalid`)
  }
}

function manifestCore(manifest: ProfilePortableArchiveManifest): Uint8Array {
  return encodeCanonicalJson({
    format: manifest.format,
    version: manifest.version,
    profile: manifest.profile,
    entries: manifest.entries,
    assets: manifest.assets,
    excludedState: manifest.excludedState,
  })
}

function plannedBytesEntry(path: string, bytes: Uint8Array): ProfilePortableArchivePlannedEntry {
  return {
    path,
    kind: 'file',
    compression: 'store',
    encrypted: false,
    ...PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA,
    extraFieldIds: [],
    content: { kind: 'bytes', bytes: new Uint8Array(bytes) },
  }
}

function plannedBlobEntry(sha256: string, size: number): ProfilePortableArchivePlannedEntry {
  return {
    path: blobPath(sha256),
    kind: 'file',
    compression: 'store',
    encrypted: false,
    ...PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA,
    extraFieldIds: [],
    content: { kind: 'blob', sha256, size },
  }
}

function blobPath(sha256: string): string {
  if (!isSha256(sha256)) fail('invalid', 'Portable blob digest is invalid')
  return `${PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix}${sha256}`
}

function isBlobPath(path: string): boolean {
  return path.startsWith(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix)
    && isSha256(path.slice(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix.length))
}

function isCanonicalContentPath(value: unknown): value is string {
  return value === PROFILE_PORTABLE_ARCHIVE_PATHS.profile
    || (typeof value === 'string' && isBlobPath(value))
}

function isSafeArchivePath(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0 || value.includes('\\')
    || value.includes('\0') || value.startsWith('/') || /^[a-z]:/i.test(value)) return false
  const segments = value.split('/')
  return segments.every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function canonicalEntryOrder(paths: readonly string[]): string[] {
  return [...paths].sort((left, right) => {
    const leftRank = entryRank(left)
    const rightRank = entryRank(right)
    return leftRank - rightRank || codeUnitCompare(left, right)
  })
}

function entryRank(path: string): number {
  if (path === PROFILE_PORTABLE_ARCHIVE_PATHS.manifest) return 0
  if (path === PROFILE_PORTABLE_ARCHIVE_PATHS.profile) return 1
  return 2
}

function encodeCanonicalJson(value: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalJson(value))
}

function canonicalJson(value: unknown): string {
  assertInertJson(value, '$canonical')
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isPlainRecord(value)) return value
  const result = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value).sort(codeUnitCompare)) result[key] = sortJson(value[key])
  return result
}

function assertInertJson(
  value: unknown,
  path: string,
  ancestors = new WeakSet<object>(),
  depth = 0,
  budget = { nodes: 0 },
): void {
  budget.nodes += 1
  if (depth > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxJsonDepth
    || budget.nodes > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxJsonNodes) {
    fail('bounds-exceeded', `${path} exceeds the portable JSON complexity bound`)
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail('invalid', `${path} contains a lossy JSON number`)
    return
  }
  if (typeof value !== 'object') fail('invalid', `${path} contains a non-JSON value`)
  if (ancestors.has(value)) fail('invalid', `${path} contains a cycle`)
  ancestors.add(value)
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype
      || Object.getOwnPropertySymbols(value).length > 0) {
      fail('invalid', `${path} contains a non-standard JSON array`)
    }
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== value.length + 1
      || names.some((name) => name !== 'length'
        && (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= value.length))) {
      fail('invalid', `${path} contains a sparse or extended array`)
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor)) fail('invalid', `${path}[${index}] is executable`)
      assertInertJson(descriptor.value, `${path}[${index}]`, ancestors, depth + 1, budget)
    }
    ancestors.delete(value)
    return
  }
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    fail('invalid', `${path} contains a non-plain JSON object`)
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor)) {
      fail('invalid', `${path}.${key} is not inert JSON data`)
    }
    assertInertJson(descriptor.value, `${path}.${key}`, ancestors, depth + 1, budget)
  }
  ancestors.delete(value)
}

async function digestBytes(bytes: Uint8Array, sha256: ProfilePortableArchiveSha256): Promise<string> {
  const digest = await sha256(new Uint8Array(bytes))
  if (!isSha256(digest)) fail('invalid', 'Portable archive SHA-256 adapter returned an invalid digest')
  return digest
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index])
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return isPlainRecord(value)
    && sameStrings(Object.keys(value).sort(codeUnitCompare), [...expected].sort(codeUnitCompare))
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
  return Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0)
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

function fail(code: ProfilePortableArchiveErrorCode, message: string): never {
  throw new ProfilePortableArchiveError(code, message)
}
