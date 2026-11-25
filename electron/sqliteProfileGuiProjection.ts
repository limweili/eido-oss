import { createHash, randomUUID } from 'node:crypto'
import type { CardAsset } from '../src/graph/types'
import {
  readProfileLogicalAssetPayload,
  toProfileLogicalAssetPayload,
  type ProfileLogicalAssetPayload,
} from '../src/persistence/profileAssetKernel'
import {
  GUI_PROFILE_PROJECTION_VERSION,
  mergeGuiProfileProjection,
  ProfileGuiProjectionError,
  profileGuiProjectionFailure,
  type GuiNewModMaterialization,
  type GuiOrdinaryNewIdeaAuthorization,
  type GuiProfileProjectionRequest,
} from '../src/persistence/profileGuiProjection'
import {
  createDirectProfileModInstance,
  createUserProfileModTemplate,
  decodeProfileModRecord,
  stampProfileModTemplate,
  updateProfileModTemplate,
} from '../src/persistence/profileModRecords'
import type { ProfileLogicalDocument } from '../src/persistence/profileLogicalProjection'
import { canonicalProfileJson } from '../src/persistence/profileRevisionKernel'
import {
  profileServiceFailure,
  type ProfileServiceResult,
  type ProfileSnapshot,
} from '../src/persistence/profileServiceContract'
import {
  captureProfileGuiInertJson,
  ProfileGuiJsonCaptureError,
} from '../src/persistence/profileGuiSaveScheduler'
import {
  SqliteProfileBlobCorruptionError,
  SqliteProfileBlobInputError,
  type SqliteProfileBlobStore,
} from './sqliteProfileBlobStore'
import type {
  SqliteProfileGuiProjectionCommitReceipt,
  SqliteProfileRevisionStore,
} from './sqliteProfileRevisionStore'

const ORDINARY_IDEA_AUTHORIZATION_LIFETIME_MS = 5 * 60 * 1_000

export type SqliteProfileGuiProjectionAdapter = Readonly<{
  authorizeOrdinaryIdeaCreate(
    ideaId: string,
  ): Promise<ProfileServiceResult<GuiOrdinaryNewIdeaAuthorization>>
  commitGuiProjection(
    candidate: unknown,
  ): Promise<ProfileServiceResult<SqliteProfileGuiProjectionCommitReceipt>>
}>

export function createSqliteProfileGuiProjectionAdapter(options: Readonly<{
  store(): SqliteProfileRevisionStore
  blobStore: SqliteProfileBlobStore
  now?: () => string
  createAuthorizationId?: () => string
}>): SqliteProfileGuiProjectionAdapter {
  const now = options.now ?? (() => new Date().toISOString())
  const createAuthorizationId = options.createAuthorizationId
    ?? (() => `ordinary-idea-${randomUUID()}`)

  return Object.freeze({
    async authorizeOrdinaryIdeaCreate(ideaId) {
      if (!nonEmptyString(ideaId)) return profileServiceFailure('invalid')
      let createdAt: string
      let expiresAt: string
      let authorizationId: string
      try {
        createdAt = now()
        const createdMilliseconds = Date.parse(createdAt)
        authorizationId = createAuthorizationId()
        if (!canonicalTimestamp(createdAt) || !nonEmptyString(authorizationId)) {
          return profileServiceFailure('internal')
        }
        expiresAt = new Date(
          createdMilliseconds + ORDINARY_IDEA_AUTHORIZATION_LIFETIME_MS,
        ).toISOString()
      } catch {
        return profileServiceFailure('internal')
      }
      const store = options.store()
      const identity = store.currentProfileIdentity()
      return store.issueGuiOrdinaryIdeaAuthorization(Object.freeze({
        authorizationId,
        profileId: identity.profileId,
        baseRevision: identity.revision,
        ideaId,
        boardId: `board:${ideaId}`,
        createdAt,
        expiresAt,
      }))
    },

    async commitGuiProjection(candidate) {
      let request: GuiProfileProjectionRequest
      try {
        request = captureProfileGuiInertJson(candidate, '$request') as GuiProfileProjectionRequest
      } catch (error) {
        if (error instanceof ProfileGuiJsonCaptureError) return profileServiceFailure('invalid')
        return profileServiceFailure('internal')
      }

      const projectionVersion = (
        request as unknown as { projection?: { projectionVersion?: unknown } }
      ).projection?.projectionVersion
      if (Number.isSafeInteger(projectionVersion)
        && Number(projectionVersion) > GUI_PROFILE_PROJECTION_VERSION) {
        return profileServiceFailure('unsupported-future-version')
      }

      const store = options.store()
      const replay = await store.replayGuiProjectionRevision(request)
      if (!replay.ok) return replay
      if (replay.value) return { ok: true, value: replay.value }

      const [snapshot, logicalDocument] = await Promise.all([
        store.snapshot(),
        store.logicalDocument(),
      ])
      if (!snapshot.ok) return snapshot
      if (!logicalDocument.ok) return logicalDocument

      try {
        const merged = mergeGuiProfileProjection(snapshot.value, request, {
          projectAsset: createGuiAssetProjector(
            snapshot.value,
            logicalDocument.value,
            options.blobStore,
          ),
          materializeUserModTemplate(input) {
            const result = input.existing
              ? updateProfileModTemplate(input.existing, {
                  updatedAt: input.committedAt,
                  mod: input.mod,
                })
              : createUserProfileModTemplate({
                  profileId: input.profileId,
                  templateId: input.templateId,
                  createdAt: input.committedAt,
                  mod: input.mod,
                })
            if (!result.ok) throw new ProfileGuiProjectionError('invalid', result.message)
            return result.value
          },
          materializeNewModInstance(input) {
            return materializeNewModInstance(input)
          },
        })
        return store.commitGuiProjectionRevision({
          request,
          candidate: merged.logicalDocument,
        })
      } catch (error) {
        const failure = profileGuiProjectionFailure(error)
        if (failure) return failure
        if (error instanceof SqliteProfileBlobInputError) return profileServiceFailure('invalid')
        if (error instanceof SqliteProfileBlobCorruptionError) {
          return profileServiceFailure('corrupt-or-recovery-required')
        }
        return profileServiceFailure('internal')
      }
    },
  })
}

function createGuiAssetProjector(
  currentSnapshot: ProfileSnapshot,
  currentLogical: ProfileLogicalDocument,
  blobStore: SqliteProfileBlobStore,
): (asset: CardAsset) => ProfileLogicalAssetPayload {
  const existing = new Map<string, Readonly<{
    asset: CardAsset
    payload: ProfileLogicalAssetPayload
  }>>()
  for (const asset of enumerateCurrentAssets(currentSnapshot)) {
    const bytes = Buffer.from(asset.dataUrl.slice(asset.dataUrl.indexOf(',') + 1), 'base64')
    const payload = toProfileLogicalAssetPayload(
      asset,
      createHash('sha256').update(bytes).digest('hex'),
    )
    const hydrated = blobStore.hydrateAsset(payload)
    if (canonicalProfileJson(hydrated) !== canonicalProfileJson(asset)) {
      throw new SqliteProfileBlobCorruptionError(
        `Current logical Profile asset ${asset.id} changed after hydration`,
      )
    }
    const previous = existing.get(asset.id)
    if (previous
      && (canonicalProfileJson(previous.asset) !== canonicalProfileJson(asset)
        || canonicalProfileJson(previous.payload) !== canonicalProfileJson(payload))) {
      throw new SqliteProfileBlobCorruptionError(
        `Current logical Profile asset ${asset.id} has conflicting references`,
      )
    }
    existing.set(asset.id, Object.freeze({ asset: cloneJson(asset), payload }))
  }
  for (const record of currentLogical.records) {
    if (record.kind !== 'logical-asset') continue
    const payload = readProfileLogicalAssetPayload(record.payload)
    const admitted = payload && existing.get(payload.id)
    if (!payload
      || payload.id !== record.recordId
      || !admitted
      || canonicalProfileJson(admitted.payload) !== canonicalProfileJson(payload)) {
      throw new SqliteProfileBlobCorruptionError('Current logical Profile asset inventory is invalid')
    }
  }
  const materializedNew = new Map<string, Readonly<{
    asset: CardAsset
    payload: ProfileLogicalAssetPayload
  }>>()

  return (asset) => {
    const previous = existing.get(asset.id)
    if (previous) {
      if (canonicalProfileJson(previous.asset) !== canonicalProfileJson(asset)) {
        throw new SqliteProfileBlobInputError(
          `GUI projection changed immutable logical asset ${asset.id}`,
        )
      }
      return previous.payload
    }

    const admitted = materializedNew.get(asset.id)
    if (admitted) {
      if (canonicalProfileJson(admitted.asset) !== canonicalProfileJson(asset)) {
        throw new SqliteProfileBlobInputError(
          `GUI projection reuses logical asset ${asset.id} with different bytes or metadata`,
        )
      }
      return admitted.payload
    }
    const payload = blobStore.materializeAsset(asset)
    materializedNew.set(asset.id, Object.freeze({
      asset: cloneJson(asset),
      payload,
    }))
    return payload
  }
}

function enumerateCurrentAssets(snapshot: ProfileSnapshot): readonly CardAsset[] {
  const assets: CardAsset[] = []
  for (const board of Object.values(snapshot.boards)) {
    for (const card of board.cards) assets.push(...(card.assets ?? []))
    for (const event of board.intentLog ?? []) {
      if (!event.data || typeof event.data !== 'object' || Array.isArray(event.data)) continue
      const card = 'card' in event.data ? event.data.card : undefined
      if (!card || typeof card !== 'object' || Array.isArray(card) || !('assets' in card)) continue
      const historicalAssets = card.assets
      if (Array.isArray(historicalAssets)) assets.push(...historicalAssets as CardAsset[])
    }
  }
  return Object.freeze(assets)
}

function materializeNewModInstance(input: GuiNewModMaterialization) {
  if (input.origin.kind === 'direct') {
    const result = createDirectProfileModInstance({
      boardRecordId: input.boardRecordId,
      cardId: input.cardId,
      instanceId: input.origin.instanceId,
      createdAt: input.committedAt,
      mod: input.mod,
    })
    if (!result.ok) throw new ProfileGuiProjectionError('invalid', result.message)
    return result.value
  }
  if (!input.sourceTemplate) {
    throw new ProfileGuiProjectionError('invalid', 'Stamped GUI Mod source template is missing')
  }
  const stamped = stampProfileModTemplate(input.sourceTemplate, {
    boardRecordId: input.boardRecordId,
    cardId: input.cardId,
    instanceId: input.origin.sourceToInstanceIdMap.mod.instanceId,
    controlIds: input.origin.sourceToInstanceIdMap.controls.map((pair) => pair.instanceId),
    stampedAt: input.committedAt,
  })
  if (!stamped.ok) throw new ProfileGuiProjectionError('invalid', stamped.message)
  const retainedEnvelope = decodeProfileModRecord({
    ...stamped.value,
    payload: {
      ...stamped.value.payload,
      mod: input.mod,
    },
  })
  if (!retainedEnvelope.ok || retainedEnvelope.value.kind !== 'mod-instance') {
    throw new ProfileGuiProjectionError(
      retainedEnvelope.ok ? 'invalid' : retainedEnvelope.code === 'unsupported-future-version'
        ? 'unsupported-future-version'
        : 'invalid',
      retainedEnvelope.ok ? 'Stamped GUI Mod materialization changed kind' : retainedEnvelope.message,
    )
  }
  return retainedEnvelope.value
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}
