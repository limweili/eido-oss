import { createHash, randomUUID } from 'node:crypto'
import type { CardAsset, IdeaSummary } from '../src/graph/types'
import {
  toProfileLogicalAssetPayload,
} from '../src/persistence/profileAssetKernel'
import {
  ProfileIdeaClosureError,
  preflightProfileIdeaRemap,
  toProfileIdeaClosureDocument,
} from '../src/persistence/profileIdeaClosure'
import {
  ProfileIdeaIdentityRemapError,
  preflightLegacyProfileIdeaRemap,
  remapLegacyProfileIdea,
  remapProfileIdea,
  type ProfileIdeaIdentityAllocation,
} from '../src/persistence/profileIdeaIdentityRemap'
import type {
  ProfileAssetProjector,
  ProfileLogicalDocument,
} from '../src/persistence/profileLogicalProjection'
import {
  canonicalProfilePortableDocumentBytes,
  ProfilePortableArchiveError,
  planProfilePortableArchive,
  readProfilePortableArchive,
  type ProfilePortableArchiveManifest,
} from '../src/persistence/profilePortableArchive'
import { canonicalProfileJson } from '../src/persistence/profileRevisionKernel'
import {
  PROFILE_PORTABLE_LIFECYCLE_VERSION,
  ProfileUnsupportedFutureVersionError,
  profileServiceFailure,
  type ProfileDuplicateIdeaRequest,
  type ProfileIdeaLifecycleReceipt,
  type ProfileImportIdeaClosureRequest,
  type ProfilePortableExportReceipt,
  type ProfilePortableExportRequest,
  type ProfilePortableFreshImportReceipt,
  type ProfilePortableFreshImportRequest,
  type ProfileServiceResult,
} from '../src/persistence/profileServiceContract'
import {
  closeProfilePortableZipSource,
  observeProfilePortableZip,
  writeProfilePortableZip,
  type ProfilePortableZipDestination,
} from './profilePortableZip'
import {
  consumeProfilePortableSource,
  ProfilePortableSourceError,
  type ProfilePortableSource,
} from './profilePortableSource'
import {
  SqliteProfileBlobCapabilityError,
  SqliteProfileBlobCorruptionError,
  SqliteProfileBlobInputError,
  type SqlitePortableStagedBlob,
  type SqliteProfileBlobStore,
} from './sqliteProfileBlobStore'
import type { SqliteProfileRevisionStore } from './sqliteProfileRevisionStore'

export type SqlitePreparedFreshProfileImport = Readonly<{
  operationId: string
  idempotencyKey: string
  requestDigest: string
  integrityRoot: string
  logicalDigest: string
  document: ProfileLogicalDocument
  manifest: ProfilePortableArchiveManifest
  stagedBlobs: readonly SqlitePortableStagedBlob[]
  receipt: ProfilePortableFreshImportReceipt
}>

export type SqliteProfilePortableLifecycle = Readonly<{
  exportPortable(
    request: ProfilePortableExportRequest<ProfilePortableZipDestination>,
  ): Promise<ProfileServiceResult<ProfilePortableExportReceipt>>
  prepareFreshImport(
    request: ProfilePortableFreshImportRequest<ProfilePortableSource>,
  ): Promise<ProfileServiceResult<SqlitePreparedFreshProfileImport>>
  duplicateIdea(
    request: ProfileDuplicateIdeaRequest,
  ): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt>>
  importIdeaClosure(
    request: ProfileImportIdeaClosureRequest<ProfilePortableSource>,
  ): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt>>
}>

export type SqliteProfilePortableLifecycleOptions = Readonly<{
  store: () => SqliteProfileRevisionStore
  blobStore: SqliteProfileBlobStore
  now?: () => string
  createIdentity?: (kind: string) => string
  observeRevision?: (revision: number) => void
}>

export function createSqliteProfilePortableLifecycle(
  options: SqliteProfilePortableLifecycleOptions,
): SqliteProfilePortableLifecycle {
  const now = options.now ?? (() => new Date().toISOString())
  const createIdentity = options.createIdentity ?? ((kind: string) => `${kind}-${randomUUID()}`)

  const lifecycle: SqliteProfilePortableLifecycle = {
    async exportPortable(request) {
      if (!validExportRequest(request)) return profileServiceFailure('invalid')
      try {
        const observed = await options.store().logicalDocument()
        if (!observed.ok) return observed
        if (observed.value.head.revision !== request.expectedRevision) {
          return profileServiceFailure('conflict', { currentRevision: observed.value.head.revision })
        }
        const plan = await planProfilePortableArchive({
          document: observed.value,
          sha256,
        })
        await writeProfilePortableZip({
          destination: request.destination,
          plan,
          openBlob: ({ sha256: digest, size }) => (
            options.blobStore.streamVerifiedBlob({ sha256: digest, size })
          ),
        })
        return {
          ok: true,
          value: Object.freeze({
            operationId: request.operationId,
            profileId: observed.value.head.profileId,
            revision: observed.value.head.revision,
            integrityRoot: plan.manifest.integrity.root,
            entryCount: plan.entries.length,
            verified: true,
          }),
        }
      } catch (error) {
        return lifecycleFailure(error)
      }
    },

    async prepareFreshImport(request) {
      if (!validFreshImportRequest(request)) return profileServiceFailure('invalid')
      const operationId = request.operationId
      try {
        const source = consumeProfilePortableSource(request.source)
        if (source.kind !== 'archive') return profileServiceFailure('invalid')
        const read = await readArchive(operationId, source.source, options.blobStore)
        const requestJson = canonicalProfileJson({
          version: request.version,
          operationId,
          idempotencyKey: request.idempotencyKey,
          integrityRoot: read.manifest.integrity.root,
        })
        const importedRecordIds = Object.freeze(read.document.records
          .map((record) => record.recordId)
          .sort(codeUnitCompare))
        const importedAssetIds = Object.freeze(read.manifest.assets
          .map((asset) => asset.logicalAssetId)
          .sort(codeUnitCompare))
        const receipt: ProfilePortableFreshImportReceipt = Object.freeze({
          operationId,
          profileId: read.document.head.profileId,
          revision: read.document.head.revision,
          importedRecordIds,
          importedAssetIds,
          verified: true,
          replayed: false,
        })
        return {
          ok: true,
          value: Object.freeze({
            operationId,
            idempotencyKey: request.idempotencyKey,
            requestDigest: sha256(new TextEncoder().encode(requestJson)),
            integrityRoot: read.manifest.integrity.root,
            logicalDigest: sha256(canonicalProfilePortableDocumentBytes(read.document)),
            document: read.document,
            manifest: read.manifest,
            stagedBlobs: read.stagedBlobs,
            receipt,
          }),
        }
      } catch (error) {
        options.blobStore.discardPortableStages(operationId)
        return lifecycleFailure(error)
      }
    },

    async duplicateIdea(request) {
      if (!validDuplicateRequest(request)) return profileServiceFailure('invalid')
      try {
        const requestEvidence = {
          version: request.version,
          expectedRevision: request.expectedRevision,
          sourceIdeaId: request.sourceIdeaId,
          ...(request.name === undefined ? {} : { name: request.name }),
        }
        const replay = await options.store().replayIdeaLifecycleRevision({
          kind: 'duplicate-idea',
          operationId: request.operationId,
          idempotencyKey: request.idempotencyKey,
          request: requestEvidence,
        })
        if (!replay.ok) return replay
        if (replay.value !== null) {
          options.observeRevision?.(replay.value.revision)
          return { ok: true, value: replay.value }
        }
        const current = await options.store().logicalDocument()
        if (!current.ok) return current
        if (current.value.head.revision !== request.expectedRevision) {
          return profileServiceFailure('conflict', { currentRevision: current.value.head.revision })
        }
        const sourceIdea = readIdea(current.value, request.sourceIdeaId)
        const committedAt = now()
        const targetIdea = createTargetIdea(
          createIdentity,
          request.name ?? `${sourceIdea.name} copy`,
          committedAt,
        )
        const remapped = remapProfileIdea({
          sourceDocument: current.value,
          sourceIdeaId: request.sourceIdeaId,
          destinationDocument: current.value,
          targetIdea,
          hydrateSourceAsset: (payload) => options.blobStore.hydrateAsset(payload),
          allocateIdentity: (identity) => allocate(createIdentity, identity),
        })
        const result = await options.store().commitIdeaLifecycleRevision({
          kind: 'duplicate-idea',
          operationId: request.operationId,
          idempotencyKey: request.idempotencyKey,
          expectedRevision: request.expectedRevision,
          request: requestEvidence,
          candidate: remapped.document,
          targetIdeaId: targetIdea.id,
          importedAssetIds: importedAssetIds(remapped.identityMap),
          committedAt,
        })
        if (result.ok) options.observeRevision?.(result.value.revision)
        return result
      } catch (error) {
        return lifecycleFailure(error)
      }
    },

    async importIdeaClosure(request) {
      if (!validIdeaImportRequest(request)) return profileServiceFailure('invalid')
      const operationId = request.operationId
      try {
        const source = consumeProfilePortableSource(request.source)
        if (source.kind === 'archive') return profileServiceFailure('invalid')
        const sourceEvidence = source.kind === 'idea-closure'
          ? {
              kind: source.kind,
              source: source.closure.source,
              closureDigest: sha256(new TextEncoder().encode(canonicalProfileJson(source.closure))),
            }
          : {
              kind: source.kind,
              digest: sha256(new TextEncoder().encode(canonicalProfileJson(source.source))),
            }
        const requestEvidence = {
          version: request.version,
          expectedRevision: request.expectedRevision,
          source: sourceEvidence,
          ...(request.name === undefined ? {} : { name: request.name }),
        }
        const replay = await options.store().replayIdeaLifecycleRevision({
          kind: 'import-idea',
          operationId,
          idempotencyKey: request.idempotencyKey,
          request: requestEvidence,
        })
        if (!replay.ok) return replay
        if (replay.value !== null) {
          if (source.kind === 'idea-closure') {
            preflightProfileIdeaRemap(source.closure)
            await stageIdeaClosureBlobs(
              operationId,
              source.closure,
              source.openBlob,
              options.blobStore,
            )
            options.blobStore.discardPortableStages(operationId)
          }
          options.observeRevision?.(replay.value.revision)
          return { ok: true, value: replay.value }
        }
        const current = await options.store().logicalDocument()
        if (!current.ok) return current
        if (current.value.head.revision !== request.expectedRevision) {
          return profileServiceFailure('conflict', { currentRevision: current.value.head.revision })
        }
        const committedAt = now()
        let remapped: ReturnType<typeof remapProfileIdea>
        if (source.kind === 'idea-closure') {
          preflightProfileIdeaRemap(source.closure)
          const handles = await stageIdeaClosureBlobs(
            operationId,
            source.closure,
            source.openBlob,
            options.blobStore,
          )
          const sourceDocument = toProfileIdeaClosureDocument(source.closure)
          const sourceIdea = readIdea(sourceDocument, source.closure.source.ideaId)
          const targetIdea = createTargetIdea(
            createIdentity,
            request.name ?? sourceIdea.name,
            committedAt,
          )
          remapped = remapProfileIdea({
            sourceDocument,
            sourceIdeaId: source.closure.source.ideaId,
            destinationDocument: current.value,
            targetIdea,
            hydrateSourceAsset: (payload) => (
              options.blobStore.hydratePortableAsset(operationId, payload, handles)
            ),
            allocateIdentity: (identity) => allocate(createIdentity, identity),
          })
          options.blobStore.publishPortableBlobs(operationId, handles)
          const result = await commitImportedIdea(
            request,
            targetIdea,
            remapped,
            requestEvidence,
            committedAt,
          )
          options.blobStore.discardPortableStages(operationId)
          return result
        }

        const stableLegacy = normalizeLegacySource(source.source, request.name, committedAt, createIdentity)
        preflightLegacyProfileIdeaRemap({
          sourceIdea: stableLegacy.idea,
          sourceBoard: stableLegacy.board,
          importedAt: committedAt,
        })
        const legacyAssets = new Map<string, CardAsset>()
        const targetIdea = createTargetIdea(
          createIdentity,
          request.name ?? stableLegacy.idea.name,
          committedAt,
        )
        remapped = remapLegacyProfileIdea({
          sourceIdea: stableLegacy.idea,
          sourceBoard: stableLegacy.board,
          destinationDocument: current.value,
          targetIdea,
          importedAt: committedAt,
          projectAsset: collectLegacyAsset(legacyAssets),
          allocateIdentity: (identity) => allocate(createIdentity, identity),
        })
        for (const asset of legacyAssets.values()) options.blobStore.materializeAsset(asset)
        return commitImportedIdea(
          request,
          targetIdea,
          remapped,
          requestEvidence,
          committedAt,
        )
      } catch (error) {
        options.blobStore.discardPortableStages(operationId)
        return lifecycleFailure(error)
      }
    },
  }

  async function commitImportedIdea(
    request: ProfileImportIdeaClosureRequest<ProfilePortableSource>,
    targetIdea: IdeaSummary,
    remapped: ReturnType<typeof remapProfileIdea>,
    requestEvidence: unknown,
    committedAt: string,
  ): Promise<ProfileServiceResult<ProfileIdeaLifecycleReceipt>> {
    const result = await options.store().commitIdeaLifecycleRevision({
      kind: 'import-idea',
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      expectedRevision: request.expectedRevision,
      request: requestEvidence,
      candidate: remapped.document,
      targetIdeaId: targetIdea.id,
      importedAssetIds: importedAssetIds(remapped.identityMap),
      committedAt,
    })
    if (result.ok) options.observeRevision?.(result.value.revision)
    return result
  }

  return Object.freeze(lifecycle)
}

async function readArchive(
  operationId: string,
  source: Parameters<typeof observeProfilePortableZip>[0],
  blobStore: SqliteProfileBlobStore,
): Promise<Readonly<{
  document: ProfileLogicalDocument
  manifest: ProfilePortableArchiveManifest
  stagedBlobs: readonly SqlitePortableStagedBlob[]
}>> {
  try {
    const container = await observeProfilePortableZip(source)
    const read = await readProfilePortableArchive({
      container,
      sha256,
      stageBlob: (input) => blobStore.stagePortableBlob(operationId, input),
    })
    return Object.freeze({
      document: read.document,
      manifest: read.manifest,
      stagedBlobs: Object.freeze(read.verifiedBlobs.map((blob) => blob.content)),
    })
  } finally {
    closeProfilePortableZipSource(source)
  }
}

async function stageIdeaClosureBlobs(
  operationId: string,
  closure: Parameters<typeof preflightProfileIdeaRemap>[0] & { assets: readonly Readonly<{
    sha256: string
    size: number
  }>[] },
  openBlob: (request: Readonly<{ sha256: string; size: number }>) => (
    AsyncIterable<Uint8Array> | Promise<AsyncIterable<Uint8Array>>
  ),
  blobStore: SqliteProfileBlobStore,
): Promise<readonly SqlitePortableStagedBlob[]> {
  const roots = new Map<string, number>()
  for (const asset of closure.assets) {
    const previous = roots.get(asset.sha256)
    if (previous !== undefined && previous !== asset.size) {
      throw new ProfileIdeaIdentityRemapError('Profile Idea blob has conflicting sizes')
    }
    roots.set(asset.sha256, asset.size)
  }
  const handles: SqlitePortableStagedBlob[] = []
  for (const [digest, size] of [...roots].sort(([left], [right]) => codeUnitCompare(left, right))) {
    const bytes = await openBlob({ sha256: digest, size })
    const staged = await blobStore.stagePortableBlob(operationId, {
      path: `blobs/sha256/${digest}`,
      expectedSha256: digest,
      expectedSize: BigInt(size),
      maxBytes: size,
      bytes,
    })
    handles.push(staged.content)
  }
  return Object.freeze(handles)
}

function normalizeLegacySource(
  source: Readonly<{ idea?: unknown; board: unknown }>,
  requestedName: string | undefined,
  importedAt: string,
  createIdentity: (kind: string) => string,
): Readonly<{ idea: IdeaSummary; board: unknown }> {
  const idea = source.idea
  if (isIdeaSummary(idea)) return Object.freeze({ idea, board: source.board })
  const sourceIdea: IdeaSummary = Object.freeze({
    id: createIdentity('legacy-source-idea'),
    name: requestedName ?? 'Imported idea',
    createdAt: importedAt,
    updatedAt: importedAt,
    lastOpenedAt: importedAt,
  })
  return Object.freeze({ idea: sourceIdea, board: source.board })
}

function collectLegacyAsset(assets: Map<string, CardAsset>): ProfileAssetProjector {
  return (asset) => {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(asset.dataUrl)
    if (!match || match[1] !== asset.mimeType || match[2]!.length % 4 !== 0) {
      throw new ProfileIdeaIdentityRemapError('Legacy Idea asset data URL is invalid')
    }
    const bytes = Buffer.from(match[2]!, 'base64')
    if (bytes.toString('base64') !== match[2] || bytes.length !== asset.size) {
      throw new ProfileIdeaIdentityRemapError('Legacy Idea asset bytes do not match metadata')
    }
    const previous = assets.get(asset.id)
    if (previous && canonicalProfileJson(previous) !== canonicalProfileJson(asset)) {
      throw new ProfileIdeaIdentityRemapError(`Legacy Idea asset ${asset.id} changes metadata`)
    }
    assets.set(asset.id, asset)
    return toProfileLogicalAssetPayload(asset, createHash('sha256').update(bytes).digest('hex'))
  }
}

function readIdea(document: ProfileLogicalDocument, ideaId: string): IdeaSummary {
  const record = document.records.find((candidate) => (
    candidate.kind === 'idea' && candidate.recordId === ideaId
  ))
  if (!record || !isIdeaSummary(record.payload)) {
    throw new ProfileIdeaIdentityRemapError(`Profile does not contain Idea ${ideaId}`)
  }
  return record.payload
}

function createTargetIdea(
  createIdentity: (kind: string) => string,
  name: string,
  timestamp: string,
): IdeaSummary {
  if (!nonEmptyString(name) || !canonicalTimestamp(timestamp)) {
    throw new ProfileIdeaIdentityRemapError('Target Idea metadata is invalid')
  }
  return Object.freeze({
    id: createIdentity('idea'),
    name,
    createdAt: timestamp,
    updatedAt: timestamp,
    lastOpenedAt: timestamp,
  })
}

function allocate(
  createIdentity: (kind: string) => string,
  identity: ProfileIdeaIdentityAllocation,
): string {
  return createIdentity(identity.kind)
}

function importedAssetIds(
  mappings: readonly Readonly<{ kind: string; targetId: string; defined: boolean }>[],
): readonly string[] {
  return Object.freeze(mappings
    .filter((mapping) => mapping.kind === 'logical-asset' && mapping.defined)
    .map((mapping) => mapping.targetId)
    .sort(codeUnitCompare))
}

function validExportRequest(
  request: unknown,
): request is ProfilePortableExportRequest<ProfilePortableZipDestination> {
  return isPlainRecord(request)
    && hasExactKeys(request, ['destination', 'expectedRevision', 'operationId', 'version'])
    && validBaseRequest(request)
    && Number.isSafeInteger(request.expectedRevision)
    && Number(request.expectedRevision) >= 0
    && request.destination !== null
    && typeof request.destination === 'object'
}

function validFreshImportRequest(
  request: unknown,
): request is ProfilePortableFreshImportRequest<ProfilePortableSource> {
  return isPlainRecord(request)
    && hasExactKeys(request, ['idempotencyKey', 'operationId', 'source', 'version'])
    && validBaseRequest(request)
    && nonEmptyString(request.idempotencyKey)
    && request.source !== null
    && typeof request.source === 'object'
}

function validDuplicateRequest(request: unknown): request is ProfileDuplicateIdeaRequest {
  return isPlainRecord(request)
    && hasExactKeys(request, [
      'expectedRevision',
      'idempotencyKey',
      ...(request.name === undefined ? [] : ['name']),
      'operationId',
      'sourceIdeaId',
      'version',
    ])
    && validRevisionMutationRequest(request)
    && nonEmptyString(request.sourceIdeaId)
    && validOptionalName(request.name)
}

function validIdeaImportRequest(
  request: unknown,
): request is ProfileImportIdeaClosureRequest<ProfilePortableSource> {
  return isPlainRecord(request)
    && hasExactKeys(request, [
      'expectedRevision',
      'idempotencyKey',
      ...(request.name === undefined ? [] : ['name']),
      'operationId',
      'source',
      'version',
    ])
    && validRevisionMutationRequest(request)
    && request.source !== null
    && typeof request.source === 'object'
    && validOptionalName(request.name)
}

function validRevisionMutationRequest(request: Record<string, unknown>): boolean {
  return validBaseRequest(request)
    && nonEmptyString(request.idempotencyKey)
    && Number.isSafeInteger(request.expectedRevision)
    && Number(request.expectedRevision) >= 0
}

function validBaseRequest(request: Record<string, unknown>): boolean {
  return request.version === PROFILE_PORTABLE_LIFECYCLE_VERSION && nonEmptyString(request.operationId)
}

function validOptionalName(name: unknown): name is string | undefined {
  return name === undefined || nonEmptyString(name)
}

function isIdeaSummary(value: unknown): value is IdeaSummary {
  return isPlainRecord(value)
    && Object.keys(value).sort().join(',') === 'createdAt,id,lastOpenedAt,name,updatedAt'
    && nonEmptyString(value.id)
    && nonEmptyString(value.name)
    && canonicalTimestamp(String(value.createdAt))
    && canonicalTimestamp(String(value.updatedAt))
    && canonicalTimestamp(String(value.lastOpenedAt))
}

function canonicalTimestamp(value: string): boolean {
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function lifecycleFailure(error: unknown): ProfileServiceResult<never> {
  if (error instanceof ProfileIdeaClosureError && error.code === 'idea-remap-too-large') {
    return profileServiceFailure('idea-remap-too-large')
  }
  if (error instanceof ProfileUnsupportedFutureVersionError
    || error instanceof ProfilePortableArchiveError && error.code === 'unsupported-future-version') {
    return profileServiceFailure('unsupported-future-version')
  }
  if (error instanceof SqliteProfileBlobCorruptionError) {
    return profileServiceFailure('corrupt-or-recovery-required')
  }
  if (error instanceof ProfilePortableArchiveError
    || error instanceof ProfileIdeaClosureError
    || error instanceof ProfileIdeaIdentityRemapError
    || error instanceof ProfilePortableSourceError
    || error instanceof SqliteProfileBlobInputError
    || error instanceof SqliteProfileBlobCapabilityError
    || error instanceof TypeError) {
    return profileServiceFailure('invalid')
  }
  return profileServiceFailure('internal')
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
