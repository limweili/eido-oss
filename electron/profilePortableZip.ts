import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readSync,
  rmdirSync,
  unlinkSync,
  writeSync,
} from 'node:fs'
import path from 'node:path'
import {
  Uint8ArrayReader,
  ZipWriter,
  type ReadableReader,
  type TempStream,
  type WritableWriter,
} from '@zip.js/zip.js'
import {
  PROFILE_PORTABLE_ARCHIVE_PATHS,
  PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS,
  PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA,
  ProfilePortableArchiveError,
  type ProfilePortableArchiveContainerEntry,
  type ProfilePortableArchiveContainerObservation,
  type ProfilePortableArchivePlan,
  type ProfilePortableArchivePlannedEntry,
} from '../src/persistence/profilePortableArchive'

const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50
const LOCAL_FILE_HEADER_BYTES = 30
const CENTRAL_DIRECTORY_HEADER_BYTES = 46
const END_OF_CENTRAL_DIRECTORY_BYTES = 22
const ZIP64_LOCATOR_BYTES = 20
const UTF8_NAME_FLAG = 0x0800
const CLASSIC_VERSION = 20
const UNIX_VERSION_MADE_BY = 0x0314
const FIXED_DOS_TIME = 0
const FIXED_DOS_DATE = 0x0021
const FIXED_MODE = PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA.mode
const FIXED_EXTERNAL_ATTRIBUTES = FIXED_MODE * 0x1_0000
const IO_CHUNK_BYTES = 64 * 1024
const CRC_EVENT_LOOP_YIELD_BYTES = 1024 * 1024

declare const profilePortableZipSourceBrand: unique symbol
declare const profilePortableZipDestinationBrand: unique symbol

/**
 * One operation-scoped archive source. Its physical path is held only by the
 * Electron adapter and is never recoverable from the lifecycle-facing token.
 */
export type ProfilePortableZipSource = Readonly<{
  [profilePortableZipSourceBrand]: true
}>

/**
 * One operation-scoped archive destination. It is one-shot even when writing
 * fails, so a lifecycle operation cannot accidentally publish twice.
 */
export type ProfilePortableZipDestination = Readonly<{
  [profilePortableZipDestinationBrand]: true
}>

export type ProfilePortableZipBlobRequest = Readonly<{
  sha256: string
  size: number
}>

export type ProfilePortableZipBlobOpener = (
  request: ProfilePortableZipBlobRequest,
) => AsyncIterable<Uint8Array> | PromiseLike<AsyncIterable<Uint8Array>>

export type ProfilePortableZipDestinationTestHooks = Readonly<{
  beforePublish?: () => void
}>

type SourceIdentity = Readonly<{
  device: bigint
  inode: bigint
  birthtime: bigint
  size: bigint
  modified: bigint
  changed: bigint
}>

type SourceState = {
  archivePath: string
  descriptor?: number
  identity?: SourceIdentity
  observation?: ProfilePortableArchiveContainerObservation
  observationPromise?: Promise<ProfilePortableArchiveContainerObservation>
  closed: boolean
}

type DestinationState = {
  archivePath: string
  operationTempRoot: string
  testHooks?: ProfilePortableZipDestinationTestHooks
  consumed: boolean
}

const sourceStates = new WeakMap<ProfilePortableZipSource, SourceState>()
const destinationStates = new WeakMap<ProfilePortableZipDestination, DestinationState>()

/** Bind a physical file to an opaque, operation-scoped source token. */
export function createProfilePortableZipSource(archivePath: string): ProfilePortableZipSource {
  const source = opaqueToken<ProfilePortableZipSource>()
  sourceStates.set(source, {
    archivePath: absolutePath(archivePath, 'Portable archive source'),
    closed: false,
  })
  return source
}

/** Bind a physical publication target to an opaque, one-shot destination. */
export function createProfilePortableZipDestination(options: Readonly<{
  archivePath: string
  operationTempRoot: string
  testHooks?: ProfilePortableZipDestinationTestHooks
}>): ProfilePortableZipDestination {
  const destination = opaqueToken<ProfilePortableZipDestination>()
  destinationStates.set(destination, {
    archivePath: absolutePath(options.archivePath, 'Portable archive destination'),
    operationTempRoot: absolutePath(options.operationTempRoot, 'Portable archive operation root'),
    ...(options.testHooks ? { testHooks: options.testHooks } : {}),
    consumed: false,
  })
  return destination
}

/**
 * Close the stable source handle retained by an observation. Entries become
 * unreadable after this call. Closing an unopened source is also supported.
 */
export function closeProfilePortableZipSource(source: ProfilePortableZipSource): void {
  const state = requireSource(source)
  if (state.closed) return
  state.closed = true
  if (state.descriptor !== undefined) {
    closeSync(state.descriptor)
    delete state.descriptor
  }
}

/**
 * Parse and CRC-check a strict, contiguous classic ZIP from one stable file
 * handle. Blob entry methods stream bounded ranges from that handle and never
 * materialize a complete blob.
 */
export async function observeProfilePortableZip(
  source: ProfilePortableZipSource,
): Promise<ProfilePortableArchiveContainerObservation> {
  const state = requireSource(source)
  if (state.closed) invalid('Portable archive source is closed')
  if (state.observation) return state.observation
  if (state.observationPromise) return state.observationPromise

  const observationPromise = observeProfilePortableZipOnce(state)
  state.observationPromise = observationPromise
  try {
    return await observationPromise
  } finally {
    if (state.observationPromise === observationPromise) delete state.observationPromise
  }
}

async function observeProfilePortableZipOnce(
  state: SourceState,
): Promise<ProfilePortableArchiveContainerObservation> {
  try {
    const { descriptor, identity } = openStableSource(state.archivePath)
    state.descriptor = descriptor
    state.identity = identity
    const observation = await parseClassicArchive(state)
    assertSourceIdentity(state)
    state.observation = observation
    return observation
  } catch (error) {
    if (state.descriptor !== undefined) {
      closeSync(state.descriptor)
      delete state.descriptor
    }
    if (error instanceof ProfilePortableArchiveError) throw error
    invalid('Portable archive could not be read')
  }
}

/**
 * Stream a deterministic STORE-only archive to operation-owned staging, close
 * and fsync it, reopen it through the strict reader, and only then publish the
 * destination name. Every blob is SHA-256 verified while zip.js consumes it.
 */
export async function writeProfilePortableZip(input: Readonly<{
  destination: ProfilePortableZipDestination
  plan: ProfilePortableArchivePlan
  openBlob: ProfilePortableZipBlobOpener
}>): Promise<void> {
  const destination = requireDestination(input.destination)
  if (destination.consumed) invalid('Portable archive destination was already consumed')
  destination.consumed = true
  const entries = validatePlan(input.plan)

  if (pathEntryExists(destination.archivePath)) {
    invalid('Portable archive destination already exists')
  }
  ensurePrivateDirectory(destination.operationTempRoot)
  const operationDirectory = mkdtempSync(path.join(destination.operationTempRoot, 'eido-portable-'))
  const liveFiles = new Set<string>()
  // The final archive stage is a hidden sibling of the destination, so the
  // publication rename is always same-filesystem and atomic. Entry buffers may
  // live under the separate operation root because they are never published.
  const archiveStagePath = path.join(
    path.dirname(destination.archivePath),
    `.${path.basename(destination.archivePath)}.${randomUUID()}.stage`,
  )
  let output: FileWritable | undefined
  let published = false

  try {
    output = createFileWritable(archiveStagePath, liveFiles)
    const zipWriter = new ZipWriter<void>(output.writer, writerOptions(
      operationDirectory,
      liveFiles,
    ))
    for (const entry of entries) {
      const reader = entry.content.kind === 'bytes'
        ? new Uint8ArrayReader(new Uint8Array(entry.content.bytes))
        : verifiedBlobReader(
            await input.openBlob({
              sha256: entry.content.sha256,
              size: entry.content.size,
            }),
            entry.content.sha256,
            entry.content.size,
          )
      await zipWriter.add(entry.path, reader, entryOptions())
    }
    await zipWriter.close(new Uint8Array(), { zip64: false })
    output.assertClosed()

    const stagedSource = createProfilePortableZipSource(archiveStagePath)
    try {
      const observation = await observeProfilePortableZip(stagedSource)
      assertWrittenInventory(entries, observation)
    } finally {
      closeProfilePortableZipSource(stagedSource)
    }

    destination.testHooks?.beforePublish?.()
    try {
      // Same-filesystem hard-link publication is atomic and no-replace. Unlike
      // rename(2), it cannot overwrite a destination created in this window.
      linkSync(archiveStagePath, destination.archivePath)
    } catch (error) {
      if (errorCode(error) === 'EEXIST') {
        invalid('Portable archive destination appeared before publication')
      }
      throw error
    }
    published = true
    unlinkSync(archiveStagePath)
    liveFiles.delete(archiveStagePath)
    flushPublishedFile(destination.archivePath)
    flushDirectory(path.dirname(destination.archivePath))
  } catch (error) {
    if (published) {
      try {
        unlinkSync(destination.archivePath)
        flushDirectory(path.dirname(destination.archivePath))
      } catch {
        // Preserve the original failure. A later caller still sees the failed
        // one-shot token and cannot accidentally acknowledge this operation.
      }
    }
    throw error
  } finally {
    output?.dispose()
    for (const file of liveFiles) unlinkIfPresent(file)
    rmdirSync(operationDirectory)
  }
}

async function parseClassicArchive(
  state: SourceState,
): Promise<ProfilePortableArchiveContainerObservation> {
  const descriptor = requireDescriptor(state)
  const identity = requireIdentity(state)
  if (identity.size > BigInt(PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxArchiveBytes)) {
    bounds('Portable archive exceeds the v1 classic-ZIP size bound')
  }
  if (identity.size < BigInt(END_OF_CENTRAL_DIRECTORY_BYTES)) {
    invalid('Portable archive is shorter than a classic ZIP envelope')
  }
  const archiveSize = Number(identity.size)
  const eocdOffset = archiveSize - END_OF_CENTRAL_DIRECTORY_BYTES
  const eocd = readExact(descriptor, eocdOffset, END_OF_CENTRAL_DIRECTORY_BYTES)
  if (u32(eocd, 0) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
    invalid('Portable archive EOCD is not exactly at archive end')
  }
  const diskNumber = u16(eocd, 4)
  const directoryDisk = u16(eocd, 6)
  const diskEntries = u16(eocd, 8)
  const totalEntries = u16(eocd, 10)
  const centralDirectorySize = u32(eocd, 12)
  const centralDirectoryOffset = u32(eocd, 16)
  const commentLength = u16(eocd, 20)
  if (diskNumber !== 0 || directoryDisk !== 0 || diskEntries !== totalEntries
    || totalEntries === 0 || commentLength !== 0) {
    invalid('Portable archive EOCD metadata is not canonical')
  }
  if (totalEntries > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxEntries) {
    bounds('Portable archive exceeds the v1 entry-count bound')
  }
  if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
    invalid('Portable archive has a central-directory gap, overlap, or trailing record')
  }
  if (eocdOffset >= ZIP64_LOCATOR_BYTES
    && u32(readExact(descriptor, eocdOffset - ZIP64_LOCATOR_BYTES, 4), 0)
      === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE) {
    invalid('Portable archive ZIP64 metadata is forbidden')
  }

  const centralEntries: ParsedCentralEntry[] = []
  const exactPaths = new Set<string>()
  const foldedPaths = new Set<string>()
  let centralCursor = centralDirectoryOffset
  for (let ordinal = 0; ordinal < totalEntries; ordinal += 1) {
    if (centralCursor + CENTRAL_DIRECTORY_HEADER_BYTES > eocdOffset) {
      invalid('Portable archive central directory is truncated')
    }
    const header = readExact(descriptor, centralCursor, CENTRAL_DIRECTORY_HEADER_BYTES)
    if (u32(header, 0) !== CENTRAL_DIRECTORY_SIGNATURE) {
      if (u32(header, 0) === ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
        invalid('Portable archive ZIP64 metadata is forbidden')
      }
      invalid('Portable archive central-directory record is invalid')
    }
    const nameLength = u16(header, 28)
    const extraLength = u16(header, 30)
    const entryCommentLength = u16(header, 32)
    const recordEnd = centralCursor + CENTRAL_DIRECTORY_HEADER_BYTES
      + nameLength + extraLength + entryCommentLength
    if (recordEnd > eocdOffset) invalid('Portable archive central-directory record is truncated')
    const rawName = readExact(descriptor, centralCursor + CENTRAL_DIRECTORY_HEADER_BYTES, nameLength)
    const entry = parseCentralEntry(header, rawName, ordinal, centralCursor, recordEnd)
    const folded = entry.path.toLowerCase()
    if (exactPaths.has(entry.path) || foldedPaths.has(folded)) {
      invalid(`Portable archive entry ${entry.path} is duplicated or case-colliding`)
    }
    exactPaths.add(entry.path)
    foldedPaths.add(folded)
    centralEntries.push(entry)
    centralCursor = recordEnd
    if ((ordinal + 1) % 256 === 0) await yieldToEventLoop()
  }
  if (centralCursor !== eocdOffset) {
    invalid('Portable archive has unaccounted central-directory bytes or a duplicate EOCD')
  }

  const observedEntries: ProfilePortableArchiveContainerEntry[] = []
  let localCursor = 0
  let totalContentBytes = 0n
  for (const central of centralEntries) {
    if (central.localHeaderOffset !== localCursor) {
      invalid('Portable archive has a preamble, local-entry gap, overlap, or reordered data')
    }
    const local = parseLocalEntry(descriptor, central)
    totalContentBytes += BigInt(central.size)
    if (totalContentBytes > BigInt(PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxTotalContentBytes)) {
      bounds('Portable archive exceeds the v1 total-content bound')
    }
    if (central.path.startsWith(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix)
      && central.size > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxBlobBytes) {
      bounds(`Portable archive blob ${central.path} exceeds the v1 size bound`)
    }
    const verifyCrcOnStream = central.path.startsWith(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix)
    if (!verifyCrcOnStream
      && await crc32Range(descriptor, local.dataOffset, central.size) !== central.crc32) {
      integrity(`Portable archive entry ${central.path} failed its CRC32 check`)
    }
    const dataEnd = local.dataOffset + central.size
    localCursor = dataEnd
    observedEntries.push(Object.freeze({
      path: central.path,
      localHeaderPath: local.path,
      headersMatch: true,
      centralDirectoryOrdinal: central.ordinal,
      kind: 'file',
      compression: 'store',
      encrypted: false,
      usesDataDescriptor: false,
      crc32Verified: !verifyCrcOnStream,
      ...(verifyCrcOnStream ? { crc32VerifiedOnStream: true as const } : {}),
      compressedSize: BigInt(central.compressedSize),
      size: BigInt(central.size),
      localHeaderOffset: BigInt(central.localHeaderOffset),
      dataOffset: BigInt(local.dataOffset),
      dataEnd: BigInt(dataEnd),
      modifiedAt: PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA.modifiedAt,
      mode: FIXED_MODE,
      comment: '',
      extraFieldIds: Object.freeze([]),
      readBytes: (maxBytes) => readObservedBytes(state, central.path, local.dataOffset, central.size, maxBytes),
      streamBytes: (maxBytes) => streamObservedBytes(
        state,
        local.dataOffset,
        central.size,
        maxBytes,
        verifyCrcOnStream ? central.crc32 : undefined,
      ),
    }))
    if ((central.ordinal + 1) % 256 === 0) await yieldToEventLoop()
  }
  if (localCursor !== centralDirectoryOffset) {
    invalid('Portable archive has unaccounted data before its central directory')
  }

  return Object.freeze({
    archiveSize: BigInt(archiveSize),
    centralDirectoryOffset: BigInt(centralDirectoryOffset),
    centralDirectoryRecordsEnd: BigInt(eocdOffset),
    endOfCentralDirectoryOffset: BigInt(eocdOffset),
    endOfCentralDirectoryEnd: BigInt(archiveSize),
    usesZip64: false,
    comment: '',
    entries: Object.freeze(observedEntries),
  })
}

type ParsedCentralEntry = Readonly<{
  ordinal: number
  path: string
  crc32: number
  compressedSize: number
  size: number
  localHeaderOffset: number
}>

function parseCentralEntry(
  header: Uint8Array,
  rawName: Uint8Array,
  ordinal: number,
  _recordOffset: number,
  _recordEnd: number,
): ParsedCentralEntry {
  const versionMadeBy = u16(header, 4)
  const versionNeeded = u16(header, 6)
  const flags = u16(header, 8)
  const compressionMethod = u16(header, 10)
  const modifiedTime = u16(header, 12)
  const modifiedDate = u16(header, 14)
  const crc32 = u32(header, 16)
  const compressedSize = u32(header, 20)
  const size = u32(header, 24)
  const extraLength = u16(header, 30)
  const commentLength = u16(header, 32)
  const diskNumber = u16(header, 34)
  const internalAttributes = u16(header, 36)
  const externalAttributes = u32(header, 38)
  const localHeaderOffset = u32(header, 42)
  const entryPath = decodePath(rawName)
  if (!isSafeArchivePath(entryPath)) invalid(`Portable archive entry ${entryPath} has an unsafe path`)
  if (versionMadeBy !== UNIX_VERSION_MADE_BY || versionNeeded !== CLASSIC_VERSION
    || flags !== UTF8_NAME_FLAG || compressionMethod !== 0
    || modifiedTime !== FIXED_DOS_TIME || modifiedDate !== FIXED_DOS_DATE
    || compressedSize !== size || extraLength !== 0 || commentLength !== 0
    || diskNumber !== 0 || internalAttributes !== 0
    || externalAttributes !== FIXED_EXTERNAL_ATTRIBUTES) {
    invalid(`Portable archive entry ${entryPath} has non-canonical or hostile metadata`)
  }
  return Object.freeze({
    ordinal,
    path: entryPath,
    crc32,
    compressedSize,
    size,
    localHeaderOffset,
  })
}

function parseLocalEntry(
  descriptor: number,
  central: ParsedCentralEntry,
): Readonly<{ path: string; dataOffset: number }> {
  if (central.localHeaderOffset + LOCAL_FILE_HEADER_BYTES > requireFileSize(descriptor)) {
    invalid(`Portable archive local header for ${central.path} is truncated`)
  }
  const header = readExact(descriptor, central.localHeaderOffset, LOCAL_FILE_HEADER_BYTES)
  if (u32(header, 0) !== LOCAL_FILE_HEADER_SIGNATURE) {
    invalid(`Portable archive local header for ${central.path} is invalid`)
  }
  const versionNeeded = u16(header, 4)
  const flags = u16(header, 6)
  const compressionMethod = u16(header, 8)
  const modifiedTime = u16(header, 10)
  const modifiedDate = u16(header, 12)
  const crc32 = u32(header, 14)
  const compressedSize = u32(header, 18)
  const size = u32(header, 22)
  const nameLength = u16(header, 26)
  const extraLength = u16(header, 28)
  const rawName = readExact(
    descriptor,
    central.localHeaderOffset + LOCAL_FILE_HEADER_BYTES,
    nameLength,
  )
  const localPath = decodePath(rawName)
  if (versionNeeded !== CLASSIC_VERSION || flags !== UTF8_NAME_FLAG
    || compressionMethod !== 0 || modifiedTime !== FIXED_DOS_TIME
    || modifiedDate !== FIXED_DOS_DATE || crc32 !== central.crc32
    || compressedSize !== central.compressedSize || size !== central.size
    || extraLength !== 0 || localPath !== central.path) {
    invalid(`Portable archive local and central headers disagree for ${central.path}`)
  }
  const dataOffset = central.localHeaderOffset + LOCAL_FILE_HEADER_BYTES + nameLength
  if (dataOffset + central.size > requireFileSize(descriptor)) {
    invalid(`Portable archive data for ${central.path} is truncated`)
  }
  return Object.freeze({ path: localPath, dataOffset })
}

async function readObservedBytes(
  state: SourceState,
  entryPath: string,
  dataOffset: number,
  size: number,
  maxBytes: number,
): Promise<Uint8Array> {
  requireBound(maxBytes, 'Portable archive read bound')
  if (entryPath.startsWith(PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix)) {
    bounds(`Portable archive blob ${entryPath} must be streamed`)
  }
  if (size > maxBytes) bounds(`Portable archive entry ${entryPath} exceeds its read bound`)
  assertSourceIdentity(state)
  const bytes = readExact(requireDescriptor(state), dataOffset, size)
  assertSourceIdentity(state)
  return bytes
}

async function* streamObservedBytes(
  state: SourceState,
  dataOffset: number,
  size: number,
  maxBytes: number,
  expectedCrc32?: number,
): AsyncIterable<Uint8Array> {
  requireBound(maxBytes, 'Portable archive stream bound')
  if (size > maxBytes) bounds('Portable archive entry exceeds its stream bound')
  assertSourceIdentity(state)
  const descriptor = requireDescriptor(state)
  let offset = 0
  let crc = 0xffff_ffff
  let bytesSinceYield = 0
  while (offset < size) {
    const length = Math.min(IO_CHUNK_BYTES, size - offset)
    const chunk = readExact(descriptor, dataOffset + offset, length)
    if (expectedCrc32 !== undefined) crc = appendCrc32(crc, chunk)
    yield chunk
    offset += length
    bytesSinceYield += length
    if (bytesSinceYield >= CRC_EVENT_LOOP_YIELD_BYTES) {
      bytesSinceYield = 0
      await yieldToEventLoop()
    }
  }
  if (expectedCrc32 !== undefined && (crc ^ 0xffff_ffff) >>> 0 !== expectedCrc32) {
    integrity('Portable archive blob failed its CRC32 check')
  }
  assertSourceIdentity(state)
}

function validatePlan(plan: ProfilePortableArchivePlan): readonly ProfilePortableArchivePlannedEntry[] {
  if (!plan || !Array.isArray(plan.entries) || plan.entries.length < 2
    || plan.entries.length > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxEntries) {
    invalid('Portable archive plan has an invalid entry inventory')
  }
  const paths = new Set<string>()
  let total = 0n
  let estimatedArchiveSize = BigInt(END_OF_CENTRAL_DIRECTORY_BYTES)
  for (let ordinal = 0; ordinal < plan.entries.length; ordinal += 1) {
    const entry = plan.entries[ordinal]
    if (!entry || !isSafeArchivePath(entry.path) || paths.has(entry.path)
      || entry.kind !== 'file' || entry.compression !== 'store' || entry.encrypted
      || entry.modifiedAt !== PROFILE_PORTABLE_ARCHIVE_V1_ENTRY_METADATA.modifiedAt
      || entry.mode !== FIXED_MODE || entry.comment !== ''
      || !Array.isArray(entry.extraFieldIds) || entry.extraFieldIds.length !== 0) {
      invalid('Portable archive plan contains non-canonical metadata')
    }
    paths.add(entry.path)
    const expectedPath = ordinal === 0
      ? PROFILE_PORTABLE_ARCHIVE_PATHS.manifest
      : ordinal === 1
        ? PROFILE_PORTABLE_ARCHIVE_PATHS.profile
        : undefined
    if (expectedPath && entry.path !== expectedPath) {
      invalid('Portable archive plan does not begin with manifest.json and profile.json')
    }
    let size: number
    if (entry.content.kind === 'bytes') {
      if (!(entry.content.bytes instanceof Uint8Array) || ordinal > 1) {
        invalid(`Portable archive byte entry ${entry.path} is invalid`)
      }
      size = entry.content.bytes.byteLength
    } else {
      if (ordinal < 2 || !isSha256(entry.content.sha256)
        || entry.path !== `${PROFILE_PORTABLE_ARCHIVE_PATHS.blobPrefix}${entry.content.sha256}`
        || !Number.isSafeInteger(entry.content.size) || entry.content.size < 0
        || entry.content.size > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxBlobBytes) {
        invalid(`Portable archive blob entry ${entry.path} is invalid`)
      }
      size = entry.content.size
    }
    if (ordinal === 0 && size > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxManifestBytes) {
      bounds('Portable archive manifest exceeds the v1 size bound')
    }
    if (ordinal === 1 && size > PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxProfileBytes) {
      bounds('Portable Profile document exceeds the v1 size bound')
    }
    total += BigInt(size)
    const nameBytes = new TextEncoder().encode(entry.path).byteLength
    estimatedArchiveSize += BigInt(
      LOCAL_FILE_HEADER_BYTES + nameBytes + size + CENTRAL_DIRECTORY_HEADER_BYTES + nameBytes,
    )
  }
  if (total > BigInt(PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxTotalContentBytes)) {
    bounds('Portable archive exceeds the v1 total-content bound')
  }
  if (estimatedArchiveSize > BigInt(PROFILE_PORTABLE_ARCHIVE_V1_BOUNDS.maxArchiveBytes)) {
    bounds('Portable archive exceeds the v1 classic-ZIP size bound')
  }
  const expectedOrder = [...plan.entries].sort(comparePlannedEntries).map((entry) => entry.path)
  if (!sameStrings(plan.entries.map((entry) => entry.path), expectedOrder)) {
    invalid('Portable archive plan entry order is not canonical')
  }
  return Object.freeze([...plan.entries])
}

function comparePlannedEntries(
  left: ProfilePortableArchivePlannedEntry,
  right: ProfilePortableArchivePlannedEntry,
): number {
  const rank = (entryPath: string) => entryPath === PROFILE_PORTABLE_ARCHIVE_PATHS.manifest
    ? 0
    : entryPath === PROFILE_PORTABLE_ARCHIVE_PATHS.profile ? 1 : 2
  return rank(left.path) - rank(right.path)
    || (left.path < right.path ? -1 : left.path > right.path ? 1 : 0)
}

function writerOptions(operationDirectory: string, liveFiles: Set<string>) {
  return {
    level: 0,
    compressionMethod: 0,
    zip64: false,
    dataDescriptor: false,
    extendedTimestamp: false,
    useUnicodeFileNames: true,
    keepOrder: true,
    useWebWorkers: false,
    version: CLASSIC_VERSION,
    versionMadeBy: UNIX_VERSION_MADE_BY,
    msDosCompatible: false,
    internalFileAttributes: 0,
    externalFileAttributes: FIXED_EXTERNAL_ATTRIBUTES,
    unixMode: FIXED_MODE,
    createTempStream: () => createFileTempStream(operationDirectory, liveFiles),
  } as const
}

function entryOptions() {
  return {
    level: 0,
    compressionMethod: 0,
    zip64: false,
    dataDescriptor: false,
    extendedTimestamp: false,
    useUnicodeFileNames: true,
    useWebWorkers: false,
    lastModDate: new Date(1980, 0, 1, 0, 0, 0, 0),
    version: CLASSIC_VERSION,
    versionMadeBy: UNIX_VERSION_MADE_BY,
    msDosCompatible: false,
    internalFileAttributes: 0,
    externalFileAttributes: FIXED_EXTERNAL_ATTRIBUTES,
    unixMode: FIXED_MODE,
    comment: '',
    extraField: new Map<number, Uint8Array>(),
  } as const
}

function verifiedBlobReader(
  iterable: AsyncIterable<Uint8Array>,
  expectedSha256: string,
  expectedSize: number,
): ReadableReader & { size: number } {
  if (!iterable || typeof iterable[Symbol.asyncIterator] !== 'function') {
    invalid('Portable blob source is not an async byte stream')
  }
  const iterator = iterable[Symbol.asyncIterator]()
  const digest = createHash('sha256')
  let observedSize = 0
  let complete = false
  return {
    size: expectedSize,
    readable: new ReadableStream<Uint8Array>({
      async pull(controller) {
        try {
          const next = await iterator.next()
          if (next.done) {
            if (observedSize !== expectedSize) {
              integrity('Portable blob source returned the wrong byte length')
            }
            if (digest.digest('hex') !== expectedSha256) {
              integrity('Portable blob source digest does not match its planned path')
            }
            complete = true
            controller.close()
            return
          }
          if (!(next.value instanceof Uint8Array)) {
            integrity('Portable blob source returned a non-byte chunk')
          }
          observedSize += next.value.byteLength
          if (observedSize > expectedSize) {
            bounds('Portable blob source exceeded its planned size')
          }
          digest.update(next.value)
          controller.enqueue(next.value)
        } catch (error) {
          controller.error(error)
        }
      },
      async cancel() {
        if (!complete) await iterator.return?.()
      },
    }),
  }
}

type FileWritable = Readonly<{
  writer: WritableWriter & { size: number }
  assertClosed(): void
  dispose(): void
}>

function createFileWritable(filePath: string, liveFiles: Set<string>): FileWritable {
  let descriptor: number | undefined = openSync(
    filePath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  )
  liveFiles.add(filePath)
  let position = 0
  let closed = false
  const writer = {
    size: 0,
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        if (!(chunk instanceof Uint8Array) || descriptor === undefined) {
          throw new Error('Portable archive output is not writable')
        }
        writeAll(descriptor, chunk, position)
        position += chunk.byteLength
      },
      close() {
        if (descriptor === undefined) return
        fsyncSync(descriptor)
        closeSync(descriptor)
        descriptor = undefined
        closed = true
      },
      abort() {
        if (descriptor === undefined) return
        closeSync(descriptor)
        descriptor = undefined
      },
    }),
  }
  return Object.freeze({
    writer,
    assertClosed() {
      if (!closed || descriptor !== undefined) {
        throw new Error('Portable archive writer did not close and fsync its staging file')
      }
    },
    dispose() {
      if (descriptor !== undefined) {
        closeSync(descriptor)
        descriptor = undefined
      }
    },
  })
}

function createFileTempStream(operationDirectory: string, liveFiles: Set<string>): TempStream {
  const filePath = path.join(operationDirectory, `${randomUUID()}.entry.stage`)
  let writeDescriptor: number | undefined = openSync(
    filePath,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
    0o600,
  )
  liveFiles.add(filePath)
  let readDescriptor: number | undefined
  let writePosition = 0
  let readPosition = 0
  let writableClosed = false
  let releaseWritableClosed: (() => void) | undefined
  const writableClosedSignal = new Promise<void>((resolve) => {
    releaseWritableClosed = resolve
  })
  const closeWrite = () => {
    if (writeDescriptor === undefined) return
    closeSync(writeDescriptor)
    writeDescriptor = undefined
    writableClosed = true
    releaseWritableClosed?.()
    releaseWritableClosed = undefined
  }
  const closeRead = () => {
    if (readDescriptor === undefined) return
    closeSync(readDescriptor)
    readDescriptor = undefined
  }
  return {
    writable: new WritableStream<Uint8Array>({
      write(chunk) {
        if (!(chunk instanceof Uint8Array) || writeDescriptor === undefined) {
          throw new Error('Portable archive entry buffer is not writable')
        }
        writeAll(writeDescriptor, chunk, writePosition)
        writePosition += chunk.byteLength
      },
      close() {
        // This buffer is replayed into the fsynced archive and then deleted;
        // making the transient copy durable only doubles large-export I/O.
        closeWrite()
      },
      abort() {
        closeWrite()
      },
    }),
    readable: new ReadableStream<Uint8Array>({
      async pull(controller) {
        await writableClosedSignal
        if (!writableClosed) throw new Error('Portable archive entry buffer was not closed')
        if (readDescriptor === undefined) readDescriptor = openSync(filePath, constants.O_RDONLY)
        const remaining = writePosition - readPosition
        if (remaining === 0) {
          closeRead()
          controller.close()
          return
        }
        const length = Math.min(IO_CHUNK_BYTES, remaining)
        const chunk = readExact(readDescriptor, readPosition, length)
        readPosition += chunk.byteLength
        controller.enqueue(chunk)
      },
      cancel() {
        closeRead()
      },
    }),
    dispose() {
      closeWrite()
      closeRead()
      unlinkIfPresent(filePath)
      liveFiles.delete(filePath)
    },
  }
}

function assertWrittenInventory(
  planned: readonly ProfilePortableArchivePlannedEntry[],
  observed: ProfilePortableArchiveContainerObservation,
): void {
  if (observed.entries.length !== planned.length) {
    integrity('Portable archive writer emitted the wrong number of entries')
  }
  for (let index = 0; index < planned.length; index += 1) {
    const expected = planned[index]
    const actual = observed.entries[index]
    const size = expected?.content.kind === 'bytes'
      ? expected.content.bytes.byteLength
      : expected?.content.size
    if (!expected || !actual || actual.path !== expected.path || actual.size !== BigInt(size ?? -1)) {
      integrity('Portable archive writer emitted an unexpected entry inventory')
    }
  }
}

function openStableSource(archivePath: string): { descriptor: number; identity: SourceIdentity } {
  const before = lstatSync(archivePath, { bigint: true })
  if (before.isSymbolicLink() || !before.isFile()) invalid('Portable archive source is not a regular file')
  const descriptor = openSync(archivePath, constants.O_RDONLY)
  try {
    const identity = identityOf(descriptor)
    if (identity.device !== before.dev || identity.inode !== before.ino
      || identity.birthtime !== before.birthtimeNs || identity.size !== before.size) {
      invalid('Portable archive source identity changed while opening')
    }
    return { descriptor, identity }
  } catch (error) {
    closeSync(descriptor)
    throw error
  }
}

function assertSourceIdentity(state: SourceState): void {
  const expected = requireIdentity(state)
  const actual = identityOf(requireDescriptor(state))
  if (actual.device !== expected.device || actual.inode !== expected.inode
    || actual.birthtime !== expected.birthtime || actual.size !== expected.size
    || actual.modified !== expected.modified || actual.changed !== expected.changed) {
    integrity('Portable archive source changed during its operation')
  }
}

function identityOf(descriptor: number): SourceIdentity {
  const metadata = fstatSync(descriptor, { bigint: true })
  if (!metadata.isFile()) invalid('Portable archive source handle is not a regular file')
  return Object.freeze({
    device: metadata.dev,
    inode: metadata.ino,
    birthtime: metadata.birthtimeNs,
    size: metadata.size,
    modified: metadata.mtimeNs,
    changed: metadata.ctimeNs,
  })
}

async function crc32Range(descriptor: number, offset: number, size: number): Promise<number> {
  let crc = 0xffff_ffff
  let consumed = 0
  let bytesSinceYield = 0
  while (consumed < size) {
    const chunk = readExact(descriptor, offset + consumed, Math.min(IO_CHUNK_BYTES, size - consumed))
    crc = appendCrc32(crc, chunk)
    consumed += chunk.byteLength
    bytesSinceYield += chunk.byteLength
    if (bytesSinceYield >= CRC_EVENT_LOOP_YIELD_BYTES) {
      bytesSinceYield = 0
      await yieldToEventLoop()
    }
  }
  return (crc ^ 0xffff_ffff) >>> 0
}

function appendCrc32(initial: number, bytes: Uint8Array): number {
  let crc = initial | 0
  let offset = 0
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (; offset + 8 <= bytes.byteLength; offset += 8) {
    const first = (crc ^ view.getInt32(offset, true)) | 0
    const second = view.getInt32(offset + 4, true)
    crc = CRC32_TABLES[7]![first & 0xff]!
      ^ CRC32_TABLES[6]![(first >>> 8) & 0xff]!
      ^ CRC32_TABLES[5]![(first >>> 16) & 0xff]!
      ^ CRC32_TABLES[4]![(first >>> 24) & 0xff]!
      ^ CRC32_TABLES[3]![second & 0xff]!
      ^ CRC32_TABLES[2]![(second >>> 8) & 0xff]!
      ^ CRC32_TABLES[1]![(second >>> 16) & 0xff]!
      ^ CRC32_TABLES[0]![(second >>> 24) & 0xff]!
  }
  for (; offset < bytes.byteLength; offset += 1) {
    crc = CRC32_TABLES[0]![(crc ^ bytes[offset]!) & 0xff]! ^ (crc >>> 8)
  }
  return crc | 0
}

const CRC32_TABLES = (() => {
  const tables = Array.from({ length: 8 }, () => new Int32Array(256))
  for (let seed = 0; seed < 256; seed += 1) {
    let value = seed
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
    }
    tables[0]![seed] = value
  }
  for (let table = 1; table < tables.length; table += 1) {
    for (let seed = 0; seed < 256; seed += 1) {
      const previous = tables[table - 1]![seed]!
      tables[table]![seed] = (previous >>> 8) ^ tables[0]![previous & 0xff]!
    }
  }
  return tables
})()

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

function readExact(descriptor: number, position: number, length: number): Uint8Array {
  if (!Number.isSafeInteger(position) || position < 0
    || !Number.isSafeInteger(length) || length < 0) {
    invalid('Portable archive contains an invalid byte range')
  }
  const bytes = new Uint8Array(length)
  let read = 0
  while (read < length) {
    const count = readSync(descriptor, bytes, read, length - read, position + read)
    if (count === 0) invalid('Portable archive is truncated')
    read += count
  }
  return bytes
}

function writeAll(descriptor: number, bytes: Uint8Array, position: number): void {
  let written = 0
  while (written < bytes.byteLength) {
    const count = writeSync(descriptor, bytes, written, bytes.byteLength - written, position + written)
    if (count === 0) throw new Error('Portable archive staging write made no progress')
    written += count
  }
}

function u16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint16(offset, true)
}

function u32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(offset, true)
}

function decodePath(bytes: Uint8Array): string {
  if (bytes.byteLength === 0) invalid('Portable archive entry path is empty')
  let decoded: string
  try {
    decoded = new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    invalid('Portable archive entry path is not valid UTF-8')
  }
  const encoded = new TextEncoder().encode(decoded)
  if (encoded.byteLength !== bytes.byteLength
    || encoded.some((byte, index) => byte !== bytes[index])) {
    invalid('Portable archive entry path is not canonical UTF-8')
  }
  return decoded
}

function isSafeArchivePath(value: string): boolean {
  if (value.length === 0 || value.includes('\\') || value.includes('\0')
    || value.startsWith('/') || /^[a-z]:/i.test(value)) return false
  return value.split('/').every((segment) => segment.length > 0 && segment !== '.' && segment !== '..')
}

function isSha256(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value)
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index])
}

function requireBound(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) invalid(`${label} is invalid`)
}

function ensurePrivateDirectory(location: string): void {
  if (!existsSync(location)) mkdirSync(location, { recursive: true, mode: 0o700 })
  const metadata = lstatSync(location)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error('Portable archive operation root is not a directory')
  }
}

function flushPublishedFile(location: string): void {
  const descriptor = openSync(location, constants.O_RDWR)
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function flushDirectory(location: string): void {
  let descriptor: number | undefined
  try {
    descriptor = openSync(location, constants.O_RDONLY)
    fsyncSync(descriptor)
  } catch (error) {
    if (process.platform !== 'win32' || errorCode(error) !== 'EPERM') throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

function unlinkIfPresent(location: string): void {
  try {
    unlinkSync(location)
  } catch (error) {
    if (errorCode(error) !== 'ENOENT') throw error
  }
}

function pathEntryExists(location: string): boolean {
  try {
    lstatSync(location)
    return true
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return false
    throw error
  }
}

function absolutePath(value: string, label: string): string {
  if (typeof value !== 'string' || value.length === 0) invalid(`${label} path is invalid`)
  return path.resolve(value)
}

function requireSource(source: ProfilePortableZipSource): SourceState {
  const state = sourceStates.get(source)
  if (!state) invalid('Portable archive source token is invalid')
  return state
}

function requireDestination(destination: ProfilePortableZipDestination): DestinationState {
  const state = destinationStates.get(destination)
  if (!state) invalid('Portable archive destination token is invalid')
  return state
}

function requireDescriptor(state: SourceState): number {
  if (state.closed || state.descriptor === undefined) invalid('Portable archive source is closed')
  return state.descriptor
}

function requireIdentity(state: SourceState): SourceIdentity {
  if (!state.identity) invalid('Portable archive source was not opened')
  return state.identity
}

function requireFileSize(descriptor: number): number {
  const size = fstatSync(descriptor, { bigint: true }).size
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) bounds('Portable archive file is too large')
  return Number(size)
}

function opaqueToken<Token>(): Token {
  return Object.freeze(Object.create(null)) as Token
}

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code?: unknown }).code)
    : undefined
}

function invalid(message: string): never {
  throw new ProfilePortableArchiveError('invalid', message)
}

function bounds(message: string): never {
  throw new ProfilePortableArchiveError('bounds-exceeded', message)
}

function integrity(message: string): never {
  throw new ProfilePortableArchiveError('integrity-mismatch', message)
}
