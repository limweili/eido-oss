import { createHash, randomUUID } from 'node:crypto'
import {
  closeSync,
  constants,
  existsSync,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  unlinkSync,
  writeSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import type { CardAsset } from '../src/graph/types'
import {
  hydrateProfileLogicalAsset,
  readProfileAssetAddInput,
  readProfileAssetAddReference,
  readProfileAssetRemoveInput,
  readProfileLogicalAssetPayload,
  toProfileLogicalAssetPayload,
  type ProfileLogicalAssetPayload,
} from '../src/persistence/profileAssetKernel'
import {
  profileServiceFailure,
  validateInternalProfileAssetCommandBatch,
  type ProfileCommandBatch,
  type ProfileServiceResult,
} from '../src/persistence/profileServiceContract'
import type {
  ProfilePortableArchiveBlobStageInput,
  ProfilePortableArchiveBlobStageResult,
} from '../src/persistence/profilePortableArchive'
import {
  assertLiveSqliteProfileOwnershipCapability,
  canonicalizeSqliteProfileDatabasePath,
  SqliteProfileOwnershipCapabilityError,
  type SqliteProfileOwnershipCapability,
} from './sqliteProfileOwnerCapability'

export type SqliteProfileBlobCandidates = Readonly<{
  final: readonly Readonly<{
    sha256: string
    size: number
    referenced: boolean
  }>[]
  staging: Readonly<{
    files: number
    totalBytes: number
  }>
}>

declare const preparedAssetBatchBrand: unique symbol
export type SqlitePreparedProfileAssetBatch = Readonly<{
  [preparedAssetBatchBrand]: true
}>

type PreparedAssetBatchState = Readonly<{
  profileDatabasePath: string
  ownershipCapability: SqliteProfileOwnershipCapability
  batch: ProfileCommandBatch
}>

const preparedAssetBatchStates = new WeakMap<
  SqlitePreparedProfileAssetBatch,
  PreparedAssetBatchState
>()

declare const portableStagedBlobBrand: unique symbol
export type SqlitePortableStagedBlob = Readonly<{
  [portableStagedBlobBrand]: true
}>

type PortableStagedBlobState = {
  profileDatabasePath: string
  ownershipCapability: SqliteProfileOwnershipCapability
  operationId: string
  stagingPath: string
  identity: RegularFileIdentity
  sha256: string
  size: number
  state: 'staged' | 'promoted' | 'discarded'
}

const portableStagedBlobStates = new WeakMap<SqlitePortableStagedBlob, PortableStagedBlobState>()

export type SqliteProfileBlobStore = Readonly<{
  prepareAssetCommandBatch(candidate: unknown): ProfileServiceResult<SqlitePreparedProfileAssetBatch>
  materializeAsset(asset: CardAsset): ProfileLogicalAssetPayload
  hydrateAsset(payload: unknown): CardAsset
  stagePortableBlob(
    operationId: string,
    input: ProfilePortableArchiveBlobStageInput,
  ): Promise<ProfilePortableArchiveBlobStageResult<SqlitePortableStagedBlob>>
  hydratePortableAsset(
    operationId: string,
    payload: unknown,
    handles: readonly SqlitePortableStagedBlob[],
  ): CardAsset
  streamVerifiedBlob(root: Readonly<{ sha256: string; size: number }>): AsyncIterable<Uint8Array>
  verifyPortableBlob(root: Readonly<{ sha256: string; size: number }>): Promise<void>
  publishPortableBlobs(operationId: string, handles: readonly SqlitePortableStagedBlob[]): void
  discardPortableStages(operationId: string): void
  candidates(referencedDigests: readonly string[]): SqliteProfileBlobCandidates
}>

export class SqliteProfileBlobCorruptionError extends Error {}
export class SqliteProfileBlobCapabilityError extends Error {}
export class SqliteProfileBlobInputError extends Error {}

export function readSqlitePreparedProfileAssetBatch(
  prepared: SqlitePreparedProfileAssetBatch,
  ownershipCapability: SqliteProfileOwnershipCapability,
  profileDatabasePath: string,
): ProfileCommandBatch {
  const expectedPath = canonicalizeSqliteProfileDatabasePath(profileDatabasePath)
  const state = preparedAssetBatchStates.get(prepared)
  if (
    !state
    || state.ownershipCapability !== ownershipCapability
    || state.profileDatabasePath !== expectedPath
  ) throw new SqliteProfileBlobCapabilityError('Profile asset batch was not prepared for this owner')
  assertLiveSqliteProfileOwnershipCapability(ownershipCapability, expectedPath)
  return state.batch
}

export function createSqliteProfileBlobStore(options: {
  profileDatabasePath: string
  ownershipCapability: SqliteProfileOwnershipCapability
  testHooks?: {
    afterStageFlush?: () => void
    beforeFinalDurabilityBarrier?: (context: { existingFinal: boolean }) => void
    afterPortableStageFlush?: () => void
    beforePortablePromote?: () => void
  }
}): SqliteProfileBlobStore {
  const profileDatabasePath = canonicalizeSqliteProfileDatabasePath(options.profileDatabasePath)
  const blobRoot = `${profileDatabasePath}.blobs`
  const stagingRoot = path.join(blobRoot, 'staging')
  const hashRoot = path.join(blobRoot, 'sha256')
  const directoryIdentities = new Map<string, DirectoryIdentity>()
  const portableHandlesByOperation = new Map<string, Set<SqlitePortableStagedBlob>>()
  const portableHandleIndexes = new WeakMap<
    readonly SqlitePortableStagedBlob[],
    Readonly<{
      operationId: string
      handles: ReadonlyMap<string, SqlitePortableStagedBlob>
    }>
  >()
  const assertAuthority = () => assertLiveSqliteProfileOwnershipCapability(
    options.ownershipCapability,
    profileDatabasePath,
  )
  sweepAbandonedPortableStages()

  const readFinal = (payload: ProfileLogicalAssetPayload): Buffer => {
    assertAuthority()
    assertBlobDirectoryChain(payload.sha256)
    const finalPath = finalBlobPath(hashRoot, payload.sha256)
    const bytes = readVerifiedRegularFile(finalPath, payload.size)
    const digest = sha256(bytes)
    if (digest !== payload.sha256) {
      throw new SqliteProfileBlobCorruptionError('Reachable Profile blob digest does not match its reference')
    }
    assertAuthority()
    return bytes
  }

  const store: SqliteProfileBlobStore = {
    prepareAssetCommandBatch(candidate) {
      assertAuthority()
      const validation = validateInternalProfileAssetCommandBatch(candidate)
      if (!validation.ok) return validation
      const batch = validation.value
      if (batch.commands.length !== 1) return profileServiceFailure('invalid')
      const command = batch.commands[0]
      if (!command) return profileServiceFailure('invalid')

      try {
        if (command.name === 'card.asset.add') {
          const incoming = readProfileAssetAddInput(command.payload)
          const prepared = readProfileAssetAddReference(command.payload)
          let reference: ReturnType<typeof readProfileAssetAddReference>
          if (incoming) {
            reference = {
              ideaId: incoming.ideaId,
              cardId: incoming.cardId,
              asset: materializeAsset(incoming.asset, !batch.dryRun),
            }
          } else if (prepared) {
            readFinal(prepared.asset)
            reference = prepared
          } else {
            return profileServiceFailure('invalid')
          }
          const normalized = validateInternalProfileAssetCommandBatch({
            ...batch,
            commands: [{ ...command, payload: reference }],
          })
          if (!normalized.ok) return profileServiceFailure('internal')
          assertAuthority()
          return { ok: true, value: prepare(normalized.value) }
        }

        if (command.name === 'card.asset.remove') {
          if (!readProfileAssetRemoveInput(command.payload)) return profileServiceFailure('invalid')
          assertAuthority()
          return { ok: true, value: prepare(validation.value) }
        }
        return profileServiceFailure('capability-denied')
      } catch (error) {
        if (error instanceof SqliteProfileBlobCorruptionError) {
          return profileServiceFailure('corrupt-or-recovery-required')
        }
        if (isProfileAssetInputError(error)) return profileServiceFailure('invalid')
        if (error instanceof SqliteProfileOwnershipCapabilityError) throw error
        return profileServiceFailure('internal')
      }
    },
    materializeAsset(asset) {
      return materializeAsset(asset, true)
    },
    hydrateAsset(payload) {
      const asset = readProfileLogicalAssetPayload(payload)
      if (!asset) throw new SqliteProfileBlobCorruptionError('Logical Profile asset metadata is invalid')
      const bytes = readFinal(asset)
      return hydrateProfileLogicalAsset(asset, `data:${asset.mimeType};base64,${bytes.toString('base64')}`)
    },
    async stagePortableBlob(operationId, input) {
      assertAuthority()
      if (!nonEmptyString(operationId) || !isSha256(input.expectedSha256)
        || typeof input.expectedSize !== 'bigint'
        || input.expectedSize < 0n
        || input.expectedSize > BigInt(input.maxBytes)
        || !Number.isSafeInteger(input.maxBytes)
        || input.maxBytes < 0) {
        throw new SqliteProfileBlobCapabilityError('Portable Profile blob stage request is invalid')
      }
      const iterator = readPortableByteIterator(input.bytes)
      ensureTrackedDirectory(blobRoot)
      ensureTrackedDirectory(stagingRoot)
      const stagingPath = path.join(stagingRoot, `${randomUUID()}.portable-stage`)
      const descriptor = openSync(
        stagingPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
        0o600,
      )
      const digest = createHash('sha256')
      let size = 0
      let streamFinished = false
      try {
        while (true) {
          let next: IteratorResult<unknown>
          try {
            next = await iterator.next()
          } catch {
            throw new SqliteProfileBlobInputError('Portable Profile blob stream failed')
          }
          if (!next || typeof next !== 'object') {
            throw new SqliteProfileBlobInputError('Portable Profile blob stream is invalid')
          }
          if (next.done === true) {
            streamFinished = true
            break
          }
          const chunk = next.value
          if (!(chunk instanceof Uint8Array)) {
            throw new SqliteProfileBlobInputError('Portable Profile blob stream is invalid')
          }
          size += chunk.byteLength
          if (size > input.maxBytes || BigInt(size) > input.expectedSize) {
            throw new SqliteProfileBlobInputError('Portable Profile blob exceeds its staged bound')
          }
          writeAll(descriptor, chunk)
          digest.update(chunk)
        }
        fsyncSync(descriptor)
      } catch (error) {
        closeSync(descriptor)
        unlinkExactStage(stagingPath)
        if (!streamFinished && typeof iterator.return === 'function') {
          try {
            await iterator.return()
          } catch {
            // Preserve the primary stream or destination-storage failure.
          }
        }
        throw error
      }
      closeSync(descriptor)
      options.testHooks?.afterPortableStageFlush?.()
      const actualDigest = digest.digest('hex')
      if (BigInt(size) !== input.expectedSize || actualDigest !== input.expectedSha256) {
        unlinkExactStage(stagingPath)
        throw new SqliteProfileBlobInputError('Portable Profile blob failed staged verification')
      }
      try {
        verifyRegularFile(stagingPath, size, actualDigest)
      } catch (error) {
        unlinkExactStage(stagingPath)
        throw error
      }
      const identity = captureRegularFileIdentity(stagingPath, size)
      assertAuthority()
      const handle = Object.freeze(Object.create(null)) as SqlitePortableStagedBlob
      portableStagedBlobStates.set(handle, {
        profileDatabasePath,
        ownershipCapability: options.ownershipCapability,
        operationId,
        stagingPath,
        identity,
        sha256: actualDigest,
        size,
        state: 'staged',
      })
      const operationHandles = portableHandlesByOperation.get(operationId) ?? new Set()
      operationHandles.add(handle)
      portableHandlesByOperation.set(operationId, operationHandles)
      return Object.freeze({ content: handle, sha256: actualDigest, size: BigInt(size) })
    },
    hydratePortableAsset(operationId, payload, handles) {
      const asset = readProfileLogicalAssetPayload(payload)
      if (!asset) throw new SqliteProfileBlobCorruptionError('Portable logical asset metadata is invalid')
      const handle = portableHandleIndex(operationId, handles).get(
        portableHandleKey(asset.sha256, asset.size),
      )
      if (!handle) throw new SqliteProfileBlobCorruptionError('Portable logical asset has no staged blob')
      const state = readPortableState(handle, operationId)
      if (state.state !== 'staged') {
        throw new SqliteProfileBlobCapabilityError('Portable Profile blob is no longer staged')
      }
      assertSameRegularFileIdentity(state.identity, captureRegularFileIdentity(state.stagingPath, state.size))
      const bytes = readVerifiedRegularFile(state.stagingPath, state.size)
      if (sha256(bytes) !== state.sha256) {
        throw new SqliteProfileBlobCorruptionError('Portable staged Profile blob changed before hydration')
      }
      assertAuthority()
      return hydrateProfileLogicalAsset(asset, `data:${asset.mimeType};base64,${bytes.toString('base64')}`)
    },
    streamVerifiedBlob(root) {
      if (!isSha256(root.sha256) || !Number.isSafeInteger(root.size) || root.size < 0) {
        throw new SqliteProfileBlobCorruptionError('Logical Profile blob root is invalid')
      }
      assertAuthority()
      assertBlobDirectoryChain(root.sha256)
      const location = finalBlobPath(hashRoot, root.sha256)
      return streamVerifiedRegularFile(location, root.size, root.sha256, assertAuthority)
    },
    async verifyPortableBlob(root) {
      for await (const _chunk of store.streamVerifiedBlob(root)) {
        // Exhausting the stream performs its final digest and identity checks.
      }
    },
    publishPortableBlobs(operationId, handles) {
      assertAuthority()
      if (!nonEmptyString(operationId) || new Set(handles).size !== handles.length) {
        throw new SqliteProfileBlobCapabilityError('Portable Profile blob publication request is invalid')
      }
      for (const handle of handles) {
        const state = readPortableState(handle, operationId)
        if (state.state === 'promoted') continue
        if (state.state !== 'staged') {
          throw new SqliteProfileBlobCapabilityError('Portable Profile blob stage cannot be published')
        }
        publishPortableState(state)
      }
      assertAuthority()
    },
    discardPortableStages(operationId) {
      const handles = portableHandlesByOperation.get(operationId)
      if (!handles) return
      for (const handle of handles) {
        const state = readPortableState(handle, operationId)
        if (state.state !== 'staged') continue
        assertSameRegularFileIdentity(state.identity, captureRegularFileIdentity(state.stagingPath, state.size))
        unlinkSync(state.stagingPath)
        state.state = 'discarded'
      }
      portableHandlesByOperation.delete(operationId)
      assertAuthority()
    },
    candidates(referencedDigests) {
      assertAuthority()
      const roots = new Set<string>()
      for (const digest of referencedDigests) {
        if (!isSha256(digest) || roots.has(digest)) {
          throw new SqliteProfileBlobCorruptionError('Profile blob roots are invalid')
        }
        roots.add(digest)
      }

      if (!existsSync(blobRoot)) {
        if (roots.size > 0) throw new SqliteProfileBlobCorruptionError('Reachable Profile blobs are missing')
        return Object.freeze({
          final: Object.freeze([]),
          staging: Object.freeze({ files: 0, totalBytes: 0 }),
        })
      }
      requireDirectory(blobRoot)
      assertTrackedDirectory(blobRoot)
      const final = listFinalCandidates(hashRoot, roots, assertTrackedDirectory)
      for (const digest of roots) {
        const candidate = final.find((entry) => entry.sha256 === digest)
        if (!candidate) throw new SqliteProfileBlobCorruptionError('Reachable Profile blob is missing')
      }
      const staging = listStagingCandidates(stagingRoot, assertTrackedDirectory)
      assertAuthority()
      return Object.freeze({ final: Object.freeze(final), staging: Object.freeze(staging) })
    },
  }
  return Object.freeze(store)

  function prepare(batch: ProfileCommandBatch): SqlitePreparedProfileAssetBatch {
    const prepared = Object.freeze(Object.create(null)) as SqlitePreparedProfileAssetBatch
    preparedAssetBatchStates.set(prepared, Object.freeze({
      profileDatabasePath,
      ownershipCapability: options.ownershipCapability,
      batch,
    }))
    return prepared
  }

  function materializeAsset(asset: CardAsset, promote: boolean): ProfileLogicalAssetPayload {
    assertAuthority()
    const bytes = decodeAssetDataUrl(asset)
    const digest = sha256(bytes)
    if (promote) promoteBlob(bytes, digest)
    assertAuthority()
    return toProfileLogicalAssetPayload(asset, digest)
  }

  function promoteBlob(bytes: Buffer, digest: string): void {
    assertAuthority()
    ensureTrackedDirectory(blobRoot)
    ensureTrackedDirectory(stagingRoot)
    assertTrackedDirectory(blobRoot)
    ensureTrackedDirectory(hashRoot)
    assertTrackedDirectory(blobRoot)
    const prefixRoot = path.join(hashRoot, digest.slice(0, 2))
    ensureTrackedDirectory(prefixRoot)
    const assertChain = () => {
      assertTrackedDirectory(blobRoot)
      assertTrackedDirectory(stagingRoot)
      assertTrackedDirectory(hashRoot)
      assertTrackedDirectory(prefixRoot)
    }
    assertChain()
    const stagingPath = path.join(stagingRoot, `${randomUUID()}.stage`)
    const finalPath = path.join(prefixRoot, digest)
    const descriptor = openSync(
      stagingPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY,
      0o600,
    )
    try {
      assertChain()
      writeFileSync(descriptor, bytes)
      fsyncSync(descriptor)
    } finally {
      closeSync(descriptor)
    }
    options.testHooks?.afterStageFlush?.()
    const staged = readVerifiedRegularFile(stagingPath, bytes.length)
    if (sha256(staged) !== digest) {
      throw new SqliteProfileBlobCorruptionError('Staged Profile blob failed digest verification')
    }
    assertChain()
    assertAuthority()
    if (existsSync(finalPath)) {
      const existing = readVerifiedRegularFile(finalPath, bytes.length)
      if (sha256(existing) !== digest) {
        throw new SqliteProfileBlobCorruptionError('Content-addressed Profile blob is corrupt')
      }
      assertChain()
      assertAuthority()
      options.testHooks?.beforeFinalDurabilityBarrier?.({ existingFinal: true })
      flushPromotedFile(finalPath)
      flushDirectory(prefixRoot)
      const durableExisting = readVerifiedRegularFile(finalPath, bytes.length)
      if (sha256(durableExisting) !== digest) {
        throw new SqliteProfileBlobCorruptionError('Content-addressed Profile blob is corrupt')
      }
      assertChain()
      assertAuthority()
      unlinkSync(stagingPath)
      return
    }
    // Node does not expose renameat/openat. Identity fences before and after
    // contain accidental/Eido-owned replacement; a malicious same-user swap in
    // this syscall window remains an explicit local-filesystem threat residual.
    renameSync(stagingPath, finalPath)
    assertChain()
    options.testHooks?.beforeFinalDurabilityBarrier?.({ existingFinal: false })
    flushPromotedFile(finalPath)
    flushDirectory(stagingRoot)
    flushDirectory(prefixRoot)
    const finalBytes = readVerifiedRegularFile(finalPath, bytes.length)
    if (sha256(finalBytes) !== digest) {
      throw new SqliteProfileBlobCorruptionError('Promoted Profile blob failed digest verification')
    }
    assertChain()
    assertAuthority()
  }

  function readPortableState(
    handle: SqlitePortableStagedBlob,
    operationId: string,
  ): PortableStagedBlobState {
    const state = portableStagedBlobStates.get(handle)
    if (!state
      || state.profileDatabasePath !== profileDatabasePath
      || state.ownershipCapability !== options.ownershipCapability
      || state.operationId !== operationId) {
      throw new SqliteProfileBlobCapabilityError('Portable Profile blob was not staged for this operation')
    }
    assertAuthority()
    return state
  }

  function portableHandleIndex(
    operationId: string,
    handles: readonly SqlitePortableStagedBlob[],
  ): ReadonlyMap<string, SqlitePortableStagedBlob> {
    if (!Array.isArray(handles)) {
      throw new SqliteProfileBlobCapabilityError('Portable Profile blob handle set is invalid')
    }
    const cacheable = Object.isFrozen(handles)
    const cached = cacheable ? portableHandleIndexes.get(handles) : undefined
    if (cached) {
      if (cached.operationId !== operationId) {
        throw new SqliteProfileBlobCapabilityError(
          'Portable Profile blob handle set belongs to a different operation',
        )
      }
      return cached.handles
    }
    const index = new Map<string, SqlitePortableStagedBlob>()
    for (const handle of handles) {
      const state = readPortableState(handle, operationId)
      const key = portableHandleKey(state.sha256, state.size)
      if (index.has(key)) {
        throw new SqliteProfileBlobCapabilityError('Portable Profile blob handle set is ambiguous')
      }
      index.set(key, handle)
    }
    if (cacheable) portableHandleIndexes.set(handles, Object.freeze({ operationId, handles: index }))
    return index
  }

  function publishPortableState(state: PortableStagedBlobState): void {
    assertSameRegularFileIdentity(state.identity, captureRegularFileIdentity(state.stagingPath, state.size))
    ensureTrackedDirectory(blobRoot)
    ensureTrackedDirectory(stagingRoot)
    ensureTrackedDirectory(hashRoot)
    const prefixRoot = path.join(hashRoot, state.sha256.slice(0, 2))
    ensureTrackedDirectory(prefixRoot)
    const finalPath = path.join(prefixRoot, state.sha256)
    options.testHooks?.beforePortablePromote?.()
    if (existsSync(finalPath)) {
      verifyRegularFile(finalPath, state.size, state.sha256)
      flushPromotedFile(finalPath)
      flushDirectory(prefixRoot)
      unlinkSync(state.stagingPath)
    } else {
      renameSync(state.stagingPath, finalPath)
      flushPromotedFile(finalPath)
      flushDirectory(stagingRoot)
      flushDirectory(prefixRoot)
      verifyRegularFile(finalPath, state.size, state.sha256)
    }
    state.state = 'promoted'
    assertAuthority()
  }

  function ensureTrackedDirectory(location: string): void {
    ensureDirectory(location)
    assertTrackedDirectory(location)
  }

  function assertTrackedDirectory(location: string): void {
    const resolved = path.resolve(location)
    const actual = captureDirectoryIdentity(resolved)
    const expected = directoryIdentities.get(resolved)
    if (expected) assertSameDirectoryIdentity(expected, actual)
    else directoryIdentities.set(resolved, actual)
  }

  function assertBlobDirectoryChain(digest: string): void {
    assertTrackedDirectory(blobRoot)
    assertTrackedDirectory(hashRoot)
    assertTrackedDirectory(path.join(hashRoot, digest.slice(0, 2)))
  }

  function sweepAbandonedPortableStages(): void {
    assertAuthority()
    if (!existsSync(blobRoot)) return
    requireDirectory(blobRoot)
    assertTrackedDirectory(blobRoot)
    if (!existsSync(stagingRoot)) return
    requireDirectory(stagingRoot)
    assertTrackedDirectory(stagingRoot)
    let removed = false
    for (const entry of readdirSync(stagingRoot, { withFileTypes: true })) {
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.portable-stage$/i
        .test(entry.name)) continue
      const location = path.join(stagingRoot, entry.name)
      const metadata = lstatSync(location, { bigint: true })
      if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n) {
        throw new SqliteProfileBlobCorruptionError(
          'Abandoned Portable Profile blob stage is not a private regular file',
        )
      }
      unlinkSync(location)
      removed = true
    }
    if (removed) flushDirectory(stagingRoot)
    assertAuthority()
  }
}

function decodeAssetDataUrl(asset: CardAsset): Buffer {
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(asset.dataUrl)
  if (!match || match[1] !== asset.mimeType || match[2]!.length % 4 !== 0) {
    throw new ProfileAssetInputError('Profile asset data URL is invalid')
  }
  const encoded = match[2]!
  const bytes = Buffer.from(encoded, 'base64')
  if (bytes.toString('base64') !== encoded || bytes.length !== asset.size) {
    throw new ProfileAssetInputError('Profile asset bytes do not match their metadata')
  }
  return bytes
}

function finalBlobPath(hashRoot: string, digest: string): string {
  if (!isSha256(digest)) throw new SqliteProfileBlobCorruptionError('Profile blob digest is invalid')
  const prefixRoot = path.join(hashRoot, digest.slice(0, 2))
  requireDirectory(hashRoot)
  requireDirectory(prefixRoot)
  return path.join(prefixRoot, digest)
}

function readVerifiedRegularFile(location: string, expectedSize: number): Buffer {
  let before: ReturnType<typeof lstatSync>
  try {
    before = lstatSync(location, { bigint: true })
  } catch (error) {
    throw new SqliteProfileBlobCorruptionError(
      readErrorCode(error) === 'ENOENT'
        ? 'Reachable Profile blob is missing'
        : 'Reachable Profile blob is unavailable',
    )
  }
  if (before.isSymbolicLink() || !before.isFile() || before.nlink !== 1n) {
    throw new SqliteProfileBlobCorruptionError('Reachable Profile blob is not a private regular file')
  }
  if (before.size !== BigInt(expectedSize)) {
    throw new SqliteProfileBlobCorruptionError('Reachable Profile blob size does not match its reference')
  }
  let descriptor: number
  try {
    descriptor = openSync(location, constants.O_RDONLY)
  } catch (error) {
    throw new SqliteProfileBlobCorruptionError(
      readErrorCode(error) === 'ENOENT'
        ? 'Reachable Profile blob is missing'
        : 'Reachable Profile blob is unavailable',
    )
  }
  try {
    const opened = fstatSync(descriptor, { bigint: true })
    if (
      !opened.isFile()
      || opened.nlink !== 1n
      || opened.dev !== before.dev
      || opened.ino !== before.ino
      || opened.birthtimeNs !== before.birthtimeNs
      || opened.size !== before.size
    ) throw new SqliteProfileBlobCorruptionError('Reachable Profile blob identity changed while opening')
    return readFileSync(descriptor)
  } catch (error) {
    if (error instanceof SqliteProfileBlobCorruptionError) throw error
    throw new SqliteProfileBlobCorruptionError('Reachable Profile blob is unavailable')
  } finally {
    closeSync(descriptor)
  }
}

type RegularFileIdentity = Readonly<{
  device: bigint
  inode: bigint
  birthtime: bigint
  size: bigint
}>

function captureRegularFileIdentity(location: string, expectedSize: number): RegularFileIdentity {
  let metadata: ReturnType<typeof lstatSync>
  try {
    metadata = lstatSync(location, { bigint: true })
  } catch {
    throw new SqliteProfileBlobCorruptionError('Portable Profile blob stage is unavailable')
  }
  if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n
    || metadata.size !== BigInt(expectedSize)) {
    throw new SqliteProfileBlobCorruptionError('Portable Profile blob stage identity is invalid')
  }
  return Object.freeze({
    device: metadata.dev,
    inode: metadata.ino,
    birthtime: metadata.birthtimeNs,
    size: metadata.size,
  })
}

function assertSameRegularFileIdentity(
  expected: RegularFileIdentity,
  actual: RegularFileIdentity,
): void {
  if (expected.device !== actual.device
    || expected.inode !== actual.inode
    || expected.birthtime !== actual.birthtime
    || expected.size !== actual.size) {
    throw new SqliteProfileBlobCorruptionError('Portable Profile blob stage identity changed')
  }
}

function verifyRegularFile(location: string, expectedSize: number, expectedDigest: string): void {
  const before = captureRegularFileIdentity(location, expectedSize)
  const descriptor = openSync(location, constants.O_RDONLY)
  const digest = createHash('sha256')
  const buffer = Buffer.allocUnsafe(64 * 1024)
  let total = 0
  try {
    const opened = fstatSync(descriptor, { bigint: true })
    assertSameRegularFileIdentity(before, Object.freeze({
      device: opened.dev,
      inode: opened.ino,
      birthtime: opened.birthtimeNs,
      size: opened.size,
    }))
    while (true) {
      const count = readSync(descriptor, buffer, 0, buffer.byteLength, null)
      if (count === 0) break
      total += count
      digest.update(buffer.subarray(0, count))
    }
  } finally {
    closeSync(descriptor)
  }
  if (total !== expectedSize || digest.digest('hex') !== expectedDigest) {
    throw new SqliteProfileBlobCorruptionError('Portable Profile blob digest does not match its reference')
  }
  assertSameRegularFileIdentity(before, captureRegularFileIdentity(location, expectedSize))
}

function streamVerifiedRegularFile(
  location: string,
  expectedSize: number,
  expectedDigest: string,
  assertAuthority: () => void,
): AsyncIterable<Uint8Array> {
  return (async function* stream() {
    const before = captureRegularFileIdentity(location, expectedSize)
    const descriptor = openSync(location, constants.O_RDONLY)
    const digest = createHash('sha256')
    const buffer = Buffer.allocUnsafe(64 * 1024)
    let total = 0
    let bytesSinceYield = 0
    try {
      const opened = fstatSync(descriptor, { bigint: true })
      assertSameRegularFileIdentity(before, Object.freeze({
        device: opened.dev,
        inode: opened.ino,
        birthtime: opened.birthtimeNs,
        size: opened.size,
      }))
      while (true) {
        const count = readSync(descriptor, buffer, 0, buffer.byteLength, null)
        if (count === 0) break
        total += count
        bytesSinceYield += count
        digest.update(buffer.subarray(0, count))
        yield new Uint8Array(buffer.subarray(0, count))
        if (bytesSinceYield >= 1024 * 1024) {
          bytesSinceYield = 0
          await new Promise<void>((resolve) => setImmediate(resolve))
        }
      }
    } finally {
      closeSync(descriptor)
    }
    if (total !== expectedSize || digest.digest('hex') !== expectedDigest) {
      throw new SqliteProfileBlobCorruptionError('Portable Profile blob digest does not match its reference')
    }
    assertSameRegularFileIdentity(before, captureRegularFileIdentity(location, expectedSize))
    assertAuthority()
  })()
}

function writeAll(descriptor: number, bytes: Uint8Array): void {
  let offset = 0
  while (offset < bytes.byteLength) {
    offset += writeSync(descriptor, bytes, offset, bytes.byteLength - offset)
  }
}

function readPortableByteIterator(value: unknown): AsyncIterator<unknown> {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) {
    throw new SqliteProfileBlobInputError('Portable Profile blob stream is invalid')
  }
  let iteratorFactory: unknown
  try {
    iteratorFactory = (value as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator]
  } catch {
    throw new SqliteProfileBlobInputError('Portable Profile blob stream is invalid')
  }
  if (typeof iteratorFactory !== 'function') {
    throw new SqliteProfileBlobInputError('Portable Profile blob stream is invalid')
  }
  let iterator: unknown
  try {
    iterator = iteratorFactory.call(value)
  } catch {
    throw new SqliteProfileBlobInputError('Portable Profile blob stream is invalid')
  }
  if ((typeof iterator !== 'object' && typeof iterator !== 'function')
    || iterator === null
    || typeof (iterator as { next?: unknown }).next !== 'function') {
    throw new SqliteProfileBlobInputError('Portable Profile blob stream is invalid')
  }
  return iterator as AsyncIterator<unknown>
}

function unlinkExactStage(location: string): void {
  try {
    unlinkSync(location)
  } catch (error) {
    if (readErrorCode(error) !== 'ENOENT') throw error
  }
}

function ensureDirectory(location: string): void {
  if (!existsSync(location)) {
    mkdirSync(location)
    flushDirectory(path.dirname(location))
  }
  requireDirectory(location)
}

function flushPromotedFile(location: string): void {
  // Reopen read/write because Windows rejects fsync on read-only file handles.
  // Flushing after rename is the strongest Node primitive for the renamed file;
  // POSIX additionally requires and receives a destination-directory fsync.
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
    // Node directory handles cannot be fsynced on Windows (EPERM). The final
    // file is still reopened read/write and flushed above; POSIX must not skip
    // the directory-entry durability barrier.
    if (process.platform !== 'win32' || readErrorCode(error) !== 'EPERM') throw error
  } finally {
    if (descriptor !== undefined) closeSync(descriptor)
  }
}

type DirectoryIdentity = Readonly<{
  device: bigint
  inode: bigint
  birthtime: bigint
  canonicalPath: string
}>

function captureDirectoryIdentity(location: string): DirectoryIdentity {
  try {
    const resolved = path.resolve(location)
    const canonicalPath = realpathSync.native(resolved)
    const metadata = lstatSync(resolved, { bigint: true })
    if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
      throw new SqliteProfileBlobCorruptionError('Profile blob directory is invalid')
    }
    if (comparablePath(canonicalPath) !== comparablePath(resolved)) {
      throw new SqliteProfileBlobCorruptionError('Profile blob directory escapes its canonical root')
    }
    return Object.freeze({
      device: metadata.dev,
      inode: metadata.ino,
      birthtime: metadata.birthtimeNs,
      canonicalPath,
    })
  } catch (error) {
    if (error instanceof SqliteProfileBlobCorruptionError) throw error
    throw new SqliteProfileBlobCorruptionError(
      readErrorCode(error) === 'ENOENT'
        ? 'Profile blob directory is missing'
        : 'Profile blob directory is unavailable',
    )
  }
}

function assertSameDirectoryIdentity(expected: DirectoryIdentity, actual: DirectoryIdentity): void {
  if (
    expected.device !== actual.device
    || expected.inode !== actual.inode
    || expected.birthtime !== actual.birthtime
    || comparablePath(expected.canonicalPath) !== comparablePath(actual.canonicalPath)
  ) throw new SqliteProfileBlobCorruptionError('Profile blob directory identity changed')
}

function comparablePath(location: string): string {
  const normalized = path.normalize(location)
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function requireDirectory(location: string): void {
  let metadata: ReturnType<typeof lstatSync>
  try {
    metadata = lstatSync(location, { bigint: true })
  } catch {
    throw new SqliteProfileBlobCorruptionError('Profile blob directory is missing')
  }
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new SqliteProfileBlobCorruptionError('Profile blob directory is invalid')
  }
}

function listFinalCandidates(
  hashRoot: string,
  roots: ReadonlySet<string>,
  assertDirectory: (location: string) => void,
): Array<{ sha256: string; size: number; referenced: boolean }> {
  if (!existsSync(hashRoot)) return []
  assertDirectory(hashRoot)
  const candidates: Array<{ sha256: string; size: number; referenced: boolean }> = []
  for (const prefix of readdirSync(hashRoot, { withFileTypes: true })) {
    if (!/^[a-f0-9]{2}$/.test(prefix.name)) continue
    const prefixRoot = path.join(hashRoot, prefix.name)
    if (prefix.isSymbolicLink() || !prefix.isDirectory()) continue
    assertDirectory(prefixRoot)
    for (const entry of readdirSync(prefixRoot, { withFileTypes: true })) {
      if (!isSha256(entry.name) || !entry.name.startsWith(prefix.name)) continue
      const metadata = safeCandidateFile(path.join(prefixRoot, entry.name))
      if (!metadata) continue
      candidates.push({
        sha256: entry.name,
        size: metadata.size,
        referenced: roots.has(entry.name),
      })
    }
  }
  return candidates.sort((left, right) => left.sha256.localeCompare(right.sha256))
}

function listStagingCandidates(
  stagingRoot: string,
  assertDirectory: (location: string) => void,
): { files: number; totalBytes: number } {
  if (!existsSync(stagingRoot)) return { files: 0, totalBytes: 0 }
  assertDirectory(stagingRoot)
  let files = 0
  let totalBytes = 0
  for (const entry of readdirSync(stagingRoot, { withFileTypes: true })) {
    if (!/^[a-f0-9-]+\.(?:stage|portable-stage)$/i.test(entry.name)) continue
    const metadata = safeCandidateFile(path.join(stagingRoot, entry.name))
    if (!metadata) continue
    files += 1
    totalBytes += metadata.size
  }
  return { files, totalBytes }
}

function safeCandidateFile(location: string): { size: number } | undefined {
  try {
    const metadata = lstatSync(location, { bigint: true })
    if (metadata.isSymbolicLink() || !metadata.isFile() || metadata.nlink !== 1n) return undefined
    const size = Number(metadata.size)
    return Number.isSafeInteger(size) && size >= 0 ? { size } : undefined
  } catch {
    return undefined
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function portableHandleKey(digest: string, size: number): string {
  return `${digest}\0${size}`
}

function isSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

class ProfileAssetInputError extends SqliteProfileBlobInputError {}

function isProfileAssetInputError(error: unknown): error is ProfileAssetInputError {
  return error instanceof ProfileAssetInputError
}

function readErrorCode(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  return error.code
}
