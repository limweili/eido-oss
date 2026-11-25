import type { Card, CardAsset, IdeaSummary, IntentLogEvent, SavedBoard } from '../graph/types'
import {
  readCardAssetIds,
  readProfileAssetAddReference,
  readProfileAssetRemoveInput,
  readProfileLogicalAssetPayload,
  withCardAssetIds,
  type ProfileLogicalAssetPayload,
} from './profileAssetKernel'
import { decodeProfileModRecord } from './profileModRecords'
import {
  PROFILE_CONTRACT_VERSIONS,
  profileServiceFailure,
  validateInternalProfileAssetCommandBatch,
  validateProfileCommandBatch,
  type ProfileCommandBatch,
  type ProfileCommandBatchReceipt,
  type ProfileCompatibility,
  type ProfileContractVersions,
  type ProfileLogicalRecordKind,
  type ProfileServiceResult,
  type ProfileSnapshot,
} from './profileServiceContract'

export type ProfileRevisionHead = Readonly<{
  profileId: string
  revision: number
  versions: ProfileContractVersions
  activeIdeaId: string
}>

export type ProfileRevisionRecord = Readonly<{
  recordId: string
  kind: Exclude<ProfileLogicalRecordKind, 'recovery-point'>
  ownerId: string
  parentId: string | null
  ordinal: number
  recordVersion: typeof PROFILE_CONTRACT_VERSIONS.record
  createdRevision: number
  updatedRevision: number
  payload: unknown
}>

export type ProfileRevisionDocument = Readonly<{
  head: ProfileRevisionHead
  records: readonly ProfileRevisionRecord[]
}>

export type ProfileCommitIdentity = Readonly<{
  committedAt: string
  commitId: string
  intentEventId: string
}>

export type ProfileRevisionPlan = Readonly<{
  nextHead: ProfileRevisionHead
  upsertedRecords: readonly ProfileRevisionRecord[]
  insertedRecords: readonly ProfileRevisionRecord[]
  deletedRecordIds: readonly string[]
  receipt: ProfileCommandBatchReceipt
}>

export type ProfileAssetHydrator = (payload: ProfileLogicalAssetPayload) => CardAsset

export class ProfileRevisionCorruptionError extends Error {}

type JsonPrimitive = null | boolean | number | string
type CanonicalJson = JsonPrimitive | CanonicalJson[] | { [key: string]: CanonicalJson }

const PROFILE_RECORD_KINDS = new Set<ProfileRevisionRecord['kind']>([
  'profile',
  'compatibility-state',
  'idea',
  'board',
  'card',
  'block',
  'logical-asset',
  'mod-instance',
  'connection',
  'output',
  'output-version',
  'transcript-message',
  'follow-up-message',
  'run',
  'intent-event',
  'board-settings',
  'highlight',
  'highlight-tag',
  'compaction-summary',
  'mod-template',
  'profile-agent-event',
  'profile-setting',
  'migration-ledger-entry',
])

export function canonicalProfileJson(value: unknown): string {
  return JSON.stringify(toCanonicalJson(value, '$'))
}

export function encodeProfileSnapshot(snapshot: ProfileSnapshot): ProfileRevisionDocument {
  requireSupportedSnapshotShape(snapshot)
  const records: ProfileRevisionRecord[] = []
  const recordIds = new Set<string>()
  const append = (record: ProfileRevisionRecord) => {
    if (recordIds.has(record.recordId)) {
      throw new Error(`Profile record ID is not globally unique: ${record.recordId}`)
    }
    recordIds.add(record.recordId)
    records.push(record)
  }
  const revision = requireRevision(snapshot.revision, 'Profile revision')
  append(createRecord({
    recordId: snapshot.profileId,
    kind: 'profile',
    ownerId: snapshot.profileId,
    parentId: null,
    ordinal: 0,
    revision,
    payload: { profileId: snapshot.profileId },
  }))
  append(createRecord({
    recordId: compatibilityRecordId(snapshot.profileId),
    kind: 'compatibility-state',
    ownerId: snapshot.profileId,
    parentId: snapshot.profileId,
    ordinal: 0,
    revision,
    payload: snapshot.compatibility,
  }))

  snapshot.ideas.forEach((idea, ideaOrdinal) => {
    if (!hasOwn(snapshot.boards, idea.id)) {
      throw new Error(`Profile Board is missing for Idea ${idea.id}`)
    }
    const board = snapshot.boards[idea.id]
    if (!board) throw new Error(`Profile Board is missing for Idea ${idea.id}`)
    requireSupportedBoardShape(board, idea.id)
    append(createRecord({
      recordId: idea.id,
      kind: 'idea',
      ownerId: snapshot.profileId,
      parentId: snapshot.profileId,
      ordinal: ideaOrdinal,
      revision,
      payload: idea,
    }))
    const boardId = boardRecordId(idea.id)
    const { cards: _cards, intentLog: _intentLog, ...boardPayload } = board
    append(createRecord({
      recordId: boardId,
      kind: 'board',
      ownerId: idea.id,
      parentId: idea.id,
      ordinal: ideaOrdinal,
      revision,
      payload: boardPayload,
    }))
    board.cards.forEach((card, cardOrdinal) => {
      if (card.assets && card.assets.length > 0) {
        throw new Error(`Profile Card ${card.id} contains inline assets; #461 owns blob-backed hydration`)
      }
      if ((card as unknown as Record<string, unknown>).mod !== undefined || card.modV2 !== undefined) {
        throw new Error(`Profile Card ${card.id} contains a Mod instance not owned by the #459 slice`)
      }
      const { blocks, assets: _assets, ...cardPayload } = card
      append(createRecord({
        recordId: card.id,
        kind: 'card',
        ownerId: boardId,
        parentId: boardId,
        ordinal: cardOrdinal,
        revision,
        payload: cardPayload,
      }))
      blocks.forEach((block, blockOrdinal) => append(createRecord({
        recordId: block.id,
        kind: 'block',
        ownerId: boardId,
        parentId: card.id,
        ordinal: blockOrdinal,
        revision,
        payload: block,
      })))
    })
    ;(board.intentLog ?? []).forEach((event, eventOrdinal) => append(createRecord({
      recordId: event.id,
      kind: 'intent-event',
      ownerId: boardId,
      parentId: boardId,
      ordinal: eventOrdinal,
      revision,
      payload: event,
    })))
  })

  return freezeDocument({
    head: {
      profileId: snapshot.profileId,
      revision,
      versions: cloneJson(snapshot.versions),
      activeIdeaId: snapshot.activeIdeaId,
    },
    records,
  })
}

export function hydrateProfileSnapshot(
  document: ProfileRevisionDocument,
  hydrateAsset?: ProfileAssetHydrator,
): ProfileSnapshot {
  validateDocument(document)
  if (document.records.some((record) => record.kind === 'profile-agent-event')) {
    throw new Error('Narrow Profile snapshot projection cannot hydrate Profile Agent events')
  }
  const profileRecord = findOne(document.records, 'profile', document.head.profileId)
  const compatibilityRecord = findOne(
    document.records,
    'compatibility-state',
    compatibilityRecordId(document.head.profileId),
  )
  if (
    profileRecord.ownerId !== document.head.profileId
    || profileRecord.parentId !== null
    || readRequiredString(profileRecord.payload, 'profileId') !== document.head.profileId
  ) {
    throw new Error('Profile record identity does not match the revision head')
  }
  const compatibility = cloneJson(compatibilityRecord.payload) as ProfileCompatibility
  if (
    compatibilityRecord.ownerId !== document.head.profileId
    || compatibilityRecord.parentId !== document.head.profileId
    || compatibility.read !== 'supported'
    || compatibility.write !== 'supported'
    || compatibility.source !== 'friends-alpha'
  ) {
    throw new Error('Profile compatibility record is invalid')
  }

  const ideas = document.records
    .filter((record) => record.kind === 'idea' && record.ownerId === document.head.profileId)
    .sort(byOrdinal)
    .map((record) => {
      const idea = cloneJson(record.payload) as IdeaSummary
      if (
        record.parentId !== document.head.profileId
        || idea.id !== record.recordId
        || typeof idea.name !== 'string'
        || typeof idea.createdAt !== 'string'
        || typeof idea.updatedAt !== 'string'
        || typeof idea.lastOpenedAt !== 'string'
      ) throw new Error(`Profile Idea record ${record.recordId} is invalid`)
      return idea
    })
  const boards = Object.create(null) as Record<string, SavedBoard>
  for (const idea of ideas) {
    const boardId = boardRecordId(idea.id)
    const boardRecord = findOne(document.records, 'board', boardId)
    const boardPayload = cloneJson(boardRecord.payload) as Omit<SavedBoard, 'cards' | 'intentLog'>
    if (
      boardRecord.ownerId !== idea.id
      || boardRecord.parentId !== idea.id
      || boardPayload.version !== 1
      || !Array.isArray(boardPayload.connections)
      || !Array.isArray(boardPayload.outputs)
      || !Array.isArray(boardPayload.runs)
      || typeof boardPayload.updatedAt !== 'string'
    ) {
      throw new Error(`Profile Board record ${boardId} is invalid`)
    }
    const referencedAssetIds = new Set<string>()
    const cards = document.records
      .filter((record) => record.kind === 'card' && record.ownerId === boardId)
      .sort(byOrdinal)
      .map((record) => {
        const storedCardPayload = cloneJson(record.payload) as Record<string, unknown>
        const assetIds = readReachableCardAssetIds(storedCardPayload, record.recordId)
        delete storedCardPayload.assetIds
        const cardPayload = storedCardPayload as Omit<Card, 'blocks' | 'assets'>
        if (
          record.parentId !== boardId
          || !cardPayload
          || cardPayload.id !== record.recordId
          || typeof cardPayload.kind !== 'string'
        ) {
          throw new Error(`Profile Card record ${record.recordId} is invalid`)
        }
        const blocks = document.records
          .filter((block) => (
            block.kind === 'block'
            && block.ownerId === boardId
            && block.parentId === record.recordId
          ))
          .sort(byOrdinal)
          .map((block) => {
            const blockPayload = cloneJson(block.payload) as Card['blocks'][number]
            if (
              blockPayload.id !== block.recordId
              || typeof blockPayload.text !== 'string'
              || (blockPayload.kind !== undefined && typeof blockPayload.kind !== 'string')
            ) throw new Error(`Profile Block record ${block.recordId} is invalid`)
            return blockPayload
          })
        const assets = assetIds.map((assetId, assetOrdinal) => {
          if (referencedAssetIds.has(assetId)) {
            throw new ProfileRevisionCorruptionError(
              `Profile logical asset ${assetId} is referenced more than once`,
            )
          }
          referencedAssetIds.add(assetId)
          const assetRecord = document.records.find((candidate) => (
            candidate.kind === 'logical-asset' && candidate.recordId === assetId
          ))
          if (!assetRecord) {
            throw new ProfileRevisionCorruptionError(
              `Profile logical asset record ${assetId} is missing`,
            )
          }
          const asset = readProfileLogicalAssetPayload(assetRecord.payload)
          if (
            !asset
            || asset.id !== assetRecord.recordId
            || assetRecord.ownerId !== boardId
            || assetRecord.parentId !== record.recordId
            || assetRecord.ordinal !== assetOrdinal
          ) {
            throw new ProfileRevisionCorruptionError(
              `Profile logical asset record ${assetId} is invalid`,
            )
          }
          if (!hydrateAsset) throw new Error('Profile asset hydration is not installed')
          return hydrateAsset(asset)
        })
        return {
          ...cardPayload,
          blocks,
          ...(assets.length === 0 ? {} : { assets }),
        } as Card
      })
    const boardAssetRecords = document.records.filter((record) => (
      record.kind === 'logical-asset' && record.ownerId === boardId
    ))
    if (
      boardAssetRecords.length !== referencedAssetIds.size
      || boardAssetRecords.some((record) => !referencedAssetIds.has(record.recordId))
    ) {
      throw new ProfileRevisionCorruptionError(
        `Profile Board ${boardId} contains an unreferenced logical asset record`,
      )
    }
    const intentLog = document.records
      .filter((record) => record.kind === 'intent-event' && record.ownerId === boardId)
      .sort(byOrdinal)
      .map((record) => {
        const event = cloneJson(record.payload) as IntentLogEvent
        if (
          record.parentId !== boardId
          || event.id !== record.recordId
          || typeof event.at !== 'string'
          || typeof event.type !== 'string'
          || (event.ideaId !== undefined && event.ideaId !== idea.id)
          || !isRecord(event.data)
        ) throw new Error(`Profile Intent event ${record.recordId} is invalid`)
        return event
      })
    boards[idea.id] = {
      ...boardPayload,
      cards,
      ...(intentLog.length > 0 ? { intentLog } : {}),
    }
  }
  const hydratedAssetIds = new Set(
    Object.values(boards).flatMap((board) => (
      board.cards.flatMap((card) => (card.assets ?? []).map((asset) => asset.id))
    )),
  )
  const logicalAssetRecords = document.records.filter((record) => record.kind === 'logical-asset')
  if (
    logicalAssetRecords.length !== hydratedAssetIds.size
    || logicalAssetRecords.some((record) => !hydratedAssetIds.has(record.recordId))
  ) throw new ProfileRevisionCorruptionError('Profile contains an unreferenced logical asset record')
  if (!hasOwn(boards, document.head.activeIdeaId)) {
    throw new Error('Profile active Idea does not have a Board')
  }
  return {
    profileId: document.head.profileId,
    revision: document.head.revision,
    versions: cloneJson(document.head.versions),
    activeIdeaId: document.head.activeIdeaId,
    ideas,
    boards,
    modTemplates: [],
    modInstances: [],
    profileSettings: [],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility,
  }
}

export function planProfileCommand(
  document: ProfileRevisionDocument,
  candidateBatch: unknown,
  identity: ProfileCommitIdentity,
): ProfileServiceResult<ProfileRevisionPlan> {
  validateDocument(document)
  const publicValidation = validateProfileCommandBatch(candidateBatch)
  const validation = publicValidation.ok
    ? publicValidation
    : validateInternalProfileAssetCommandBatch(candidateBatch)
  if (!validation.ok) return validation
  const batch = validation.value
  const command = batch.commands[0]
  if (batch.commands.length !== 1 || !command) {
    return profileServiceFailure('capability-denied')
  }
  if (command.name === 'card.asset.add') {
    return planProfileAssetAdd(document, batch, identity)
  }
  if (command.name === 'card.asset.remove') {
    return planProfileAssetRemove(document, batch, identity)
  }
  if (command.name !== 'card.update-content') return profileServiceFailure('capability-denied')
  const payload = readCardUpdatePayload(command.payload)
  if (!payload) return profileServiceFailure('invalid')
  if (batch.expectedRevision !== document.head.revision) {
    return profileServiceFailure('conflict', { currentRevision: document.head.revision })
  }
  if (!validIdentity(identity)) return profileServiceFailure('internal', { currentRevision: document.head.revision })
  const boardId = boardRecordId(payload.ideaId)
  const board = document.records.find((record) => record.kind === 'board' && record.recordId === boardId)
  const card = document.records.find((record) => (
    record.kind === 'card'
    && record.recordId === payload.cardId
    && record.ownerId === boardId
  ))
  const block = document.records.find((record) => (
    record.kind === 'block'
    && record.recordId === payload.blockId
    && record.ownerId === boardId
    && record.parentId === payload.cardId
  ))
  if (!board || !card || !block) return profileServiceFailure('not-found')

  const affectedIds = [payload.cardId, payload.blockId]
  if (batch.dryRun) {
    return {
      ok: true,
      value: Object.freeze({
        nextHead: document.head,
        upsertedRecords: Object.freeze([]),
        insertedRecords: Object.freeze([]),
        deletedRecordIds: Object.freeze([]),
        receipt: Object.freeze({
          previousRevision: document.head.revision,
          revision: document.head.revision,
          commitId: `dry-run-${identity.commitId}`,
          commandIds: [command.id],
          affectedIds,
          intentEvents: [],
          dryRun: true,
          replayed: false,
        }),
      }),
    }
  }

  const revision = document.head.revision + 1
  if (!Number.isSafeInteger(revision)) return profileServiceFailure('internal', { currentRevision: document.head.revision })
  const existingEvents = document.records
    .filter((record) => record.kind === 'intent-event' && record.ownerId === boardId)
  const eventOrdinal = existingEvents.reduce((maximum, record) => Math.max(maximum, record.ordinal + 1), 0)
  const eventSeq = existingEvents.reduce((maximum, record) => {
    const seq = readOptionalNonNegativeInteger(record.payload, 'seq')
    return Math.max(maximum, seq ?? 0)
  }, 0) + 1
  const event: IntentLogEvent = {
    id: identity.intentEventId,
    at: identity.committedAt,
    ideaId: payload.ideaId,
    type: 'card.content.edited',
    cardId: payload.cardId,
    data: { field: 'body', textLength: payload.text.length },
    commitId: identity.commitId,
    actorId: batch.actor.id,
    clientTxnId: batch.clientTxnId,
    seq: eventSeq,
  }
  const blockPayload = cloneJson(block.payload) as Record<string, unknown>
  blockPayload.text = payload.text
  const boardPayload = cloneJson(board.payload) as Record<string, unknown>
  boardPayload.updatedAt = identity.committedAt
  const compatibility = findOne(
    document.records,
    'compatibility-state',
    compatibilityRecordId(document.head.profileId),
  )
  const upsertedRecords = [
    replaceRecord(block, blockPayload, revision),
    replaceRecord(board, boardPayload, revision),
    replaceRecord(compatibility, compatibility.payload, revision),
  ]
  const insertedRecords = [createRecord({
    recordId: event.id,
    kind: 'intent-event',
    ownerId: boardId,
    parentId: boardId,
    ordinal: eventOrdinal,
    revision,
    payload: event,
  })]
  const receipt: ProfileCommandBatchReceipt = Object.freeze({
    previousRevision: document.head.revision,
    revision,
    commitId: identity.commitId,
    commandIds: [command.id],
    affectedIds,
    intentEvents: [cloneJson(event)],
    dryRun: false,
    replayed: false,
  })
  return {
    ok: true,
    value: Object.freeze({
      nextHead: Object.freeze({ ...document.head, revision }),
      upsertedRecords: Object.freeze(upsertedRecords),
      insertedRecords: Object.freeze(insertedRecords),
      deletedRecordIds: Object.freeze([]),
      receipt,
    }),
  }
}

function planProfileAssetAdd(
  document: ProfileRevisionDocument,
  batch: ProfileCommandBatch,
  identity: ProfileCommitIdentity,
): ProfileServiceResult<ProfileRevisionPlan> {
  const command = batch.commands[0]
  const payload = readProfileAssetAddReference(command?.payload)
  if (!command || !payload) return profileServiceFailure('invalid')
  if (batch.expectedRevision !== document.head.revision) {
    return profileServiceFailure('conflict', { currentRevision: document.head.revision })
  }
  if (!validIdentity(identity)) return profileServiceFailure('internal', { currentRevision: document.head.revision })
  const boardId = boardRecordId(payload.ideaId)
  const board = document.records.find((record) => record.kind === 'board' && record.recordId === boardId)
  const card = document.records.find((record) => (
    record.kind === 'card'
    && record.recordId === payload.cardId
    && record.ownerId === boardId
  ))
  if (!board || !card) return profileServiceFailure('not-found')
  const assetIds = readCardAssetIds(card.payload)
  if (
    assetIds.includes(payload.asset.id)
    || document.records.some((record) => record.recordId === payload.asset.id)
  ) return profileServiceFailure('invalid')
  const affectedIds = [payload.cardId, payload.asset.id]
  if (batch.dryRun) return dryRunAssetPlan(document, command.id, affectedIds, identity)

  const revision = nextRevision(document)
  if (!revision) return profileServiceFailure('internal', { currentRevision: document.head.revision })
  const eventPosition = nextIntentPosition(document, boardId)
  const event = createAssetIntentEvent(
    batch,
    identity,
    payload.ideaId,
    payload.cardId,
    payload.asset.id,
    'add',
    eventPosition.seq,
  )
  const boardPayload = cloneJson(board.payload) as Record<string, unknown>
  boardPayload.updatedAt = identity.committedAt
  const compatibility = findOne(
    document.records,
    'compatibility-state',
    compatibilityRecordId(document.head.profileId),
  )
  const upsertedRecords = [
    replaceRecord(card, withCardAssetIds(card.payload, [...assetIds, payload.asset.id]), revision),
    replaceRecord(board, boardPayload, revision),
    replaceRecord(compatibility, compatibility.payload, revision),
  ]
  const insertedRecords = [
    createRecord({
      recordId: payload.asset.id,
      kind: 'logical-asset',
      ownerId: boardId,
      parentId: payload.cardId,
      ordinal: assetIds.length,
      revision,
      payload: payload.asset,
    }),
    createRecord({
      recordId: event.id,
      kind: 'intent-event',
      ownerId: boardId,
      parentId: boardId,
      ordinal: eventPosition.ordinal,
      revision,
      payload: event,
    }),
  ]
  const receipt = assetReceipt(document, batch, identity, affectedIds, event, revision)
  return {
    ok: true,
    value: Object.freeze({
      nextHead: Object.freeze({ ...document.head, revision }),
      upsertedRecords: Object.freeze(upsertedRecords),
      insertedRecords: Object.freeze(insertedRecords),
      deletedRecordIds: Object.freeze([]),
      receipt,
    }),
  }
}

function planProfileAssetRemove(
  document: ProfileRevisionDocument,
  batch: ProfileCommandBatch,
  identity: ProfileCommitIdentity,
): ProfileServiceResult<ProfileRevisionPlan> {
  const command = batch.commands[0]
  const payload = readProfileAssetRemoveInput(command?.payload)
  if (!command || !payload) return profileServiceFailure('invalid')
  if (batch.expectedRevision !== document.head.revision) {
    return profileServiceFailure('conflict', { currentRevision: document.head.revision })
  }
  if (!validIdentity(identity)) return profileServiceFailure('internal', { currentRevision: document.head.revision })
  const boardId = boardRecordId(payload.ideaId)
  const board = document.records.find((record) => record.kind === 'board' && record.recordId === boardId)
  const card = document.records.find((record) => (
    record.kind === 'card'
    && record.recordId === payload.cardId
    && record.ownerId === boardId
  ))
  const asset = document.records.find((record) => (
    record.kind === 'logical-asset'
    && record.recordId === payload.assetId
    && record.ownerId === boardId
    && record.parentId === payload.cardId
  ))
  if (!board || !card || !asset || !readProfileLogicalAssetPayload(asset.payload)) {
    return profileServiceFailure('not-found')
  }
  const assetIds = readCardAssetIds(card.payload)
  if (!assetIds.includes(payload.assetId)) return profileServiceFailure('not-found')
  const affectedIds = [payload.cardId, payload.assetId]
  if (batch.dryRun) return dryRunAssetPlan(document, command.id, affectedIds, identity)

  const revision = nextRevision(document)
  if (!revision) return profileServiceFailure('internal', { currentRevision: document.head.revision })
  const remainingAssetIds = assetIds.filter((assetId) => assetId !== payload.assetId)
  const eventPosition = nextIntentPosition(document, boardId)
  const event = createAssetIntentEvent(
    batch,
    identity,
    payload.ideaId,
    payload.cardId,
    payload.assetId,
    'remove',
    eventPosition.seq,
  )
  const boardPayload = cloneJson(board.payload) as Record<string, unknown>
  boardPayload.updatedAt = identity.committedAt
  const compatibility = findOne(
    document.records,
    'compatibility-state',
    compatibilityRecordId(document.head.profileId),
  )
  const reorderedAssets = remainingAssetIds.flatMap((assetId, ordinal) => {
    const record = document.records.find((candidate) => (
      candidate.kind === 'logical-asset'
      && candidate.recordId === assetId
      && candidate.ownerId === boardId
      && candidate.parentId === payload.cardId
    ))
    if (!record) throw new Error(`Profile logical asset ${assetId} is missing`)
    return record.ordinal === ordinal ? [] : [replaceRecordOrdinal(record, ordinal, revision)]
  })
  const upsertedRecords = [
    replaceRecord(card, withCardAssetIds(card.payload, remainingAssetIds), revision),
    ...reorderedAssets,
    replaceRecord(board, boardPayload, revision),
    replaceRecord(compatibility, compatibility.payload, revision),
  ]
  const insertedRecords = [createRecord({
    recordId: event.id,
    kind: 'intent-event',
    ownerId: boardId,
    parentId: boardId,
    ordinal: eventPosition.ordinal,
    revision,
    payload: event,
  })]
  const receipt = assetReceipt(document, batch, identity, affectedIds, event, revision)
  return {
    ok: true,
    value: Object.freeze({
      nextHead: Object.freeze({ ...document.head, revision }),
      upsertedRecords: Object.freeze(upsertedRecords),
      insertedRecords: Object.freeze(insertedRecords),
      deletedRecordIds: Object.freeze([payload.assetId]),
      receipt,
    }),
  }
}

function dryRunAssetPlan(
  document: ProfileRevisionDocument,
  commandId: string,
  affectedIds: string[],
  identity: ProfileCommitIdentity,
): ProfileServiceResult<ProfileRevisionPlan> {
  return {
    ok: true,
    value: Object.freeze({
      nextHead: document.head,
      upsertedRecords: Object.freeze([]),
      insertedRecords: Object.freeze([]),
      deletedRecordIds: Object.freeze([]),
      receipt: Object.freeze({
        previousRevision: document.head.revision,
        revision: document.head.revision,
        commitId: `dry-run-${identity.commitId}`,
        commandIds: [commandId],
        affectedIds,
        intentEvents: [],
        dryRun: true,
        replayed: false,
      }),
    }),
  }
}

function createAssetIntentEvent(
  batch: ProfileCommandBatch,
  identity: ProfileCommitIdentity,
  ideaId: string,
  cardId: string,
  assetId: string,
  action: 'add' | 'remove',
  seq: number,
): IntentLogEvent {
  return {
    id: identity.intentEventId,
    at: identity.committedAt,
    ideaId,
    type: 'card.content.edited',
    cardId,
    data: { field: 'assets', action, assetId },
    commitId: identity.commitId,
    actorId: batch.actor.id,
    clientTxnId: batch.clientTxnId,
    seq,
  }
}

function assetReceipt(
  document: ProfileRevisionDocument,
  batch: ProfileCommandBatch,
  identity: ProfileCommitIdentity,
  affectedIds: string[],
  event: IntentLogEvent,
  revision: number,
): ProfileCommandBatchReceipt {
  return Object.freeze({
    previousRevision: document.head.revision,
    revision,
    commitId: identity.commitId,
    commandIds: [batch.commands[0]!.id],
    affectedIds,
    intentEvents: [cloneJson(event)],
    dryRun: false,
    replayed: false,
  })
}

function nextRevision(document: ProfileRevisionDocument): number | undefined {
  const revision = document.head.revision + 1
  return Number.isSafeInteger(revision) ? revision : undefined
}

function nextIntentPosition(
  document: ProfileRevisionDocument,
  boardId: string,
): { ordinal: number; seq: number } {
  const events = document.records.filter((record) => (
    record.kind === 'intent-event' && record.ownerId === boardId
  ))
  return {
    ordinal: events.reduce((maximum, record) => Math.max(maximum, record.ordinal + 1), 0),
    seq: events.reduce((maximum, record) => {
      const seq = readOptionalNonNegativeInteger(record.payload, 'seq')
      return Math.max(maximum, seq ?? 0)
    }, 0) + 1,
  }
}

export function applyProfileRevisionPlan(
  document: ProfileRevisionDocument,
  plan: ProfileRevisionPlan,
): ProfileRevisionDocument {
  if (plan.receipt.dryRun) return document
  if (
    plan.receipt.previousRevision !== document.head.revision
    || plan.nextHead.revision !== document.head.revision + 1
  ) {
    throw new Error('Profile revision plan does not advance the supplied document')
  }
  const replacements = new Map(plan.upsertedRecords.map((record) => [record.recordId, record] as const))
  const existingIds = new Set(document.records.map((record) => record.recordId))
  const deletions = new Set(plan.deletedRecordIds)
  if (deletions.size !== plan.deletedRecordIds.length) {
    throw new Error('Profile revision plan deletes a record more than once')
  }
  for (const recordId of deletions) {
    if (!existingIds.has(recordId) || replacements.has(recordId)) {
      throw new Error(`Profile revision plan deletes invalid record ${recordId}`)
    }
  }
  for (const record of plan.insertedRecords) {
    if (existingIds.has(record.recordId) || replacements.has(record.recordId) || deletions.has(record.recordId)) {
      throw new Error(`Profile revision plan inserts duplicate record ${record.recordId}`)
    }
  }
  let matchedReplacements = 0
  const records = document.records.flatMap((record) => {
    if (deletions.has(record.recordId)) return []
    const replacement = replacements.get(record.recordId)
    if (replacement) matchedReplacements += 1
    return [replacement ?? record]
  })
  if (matchedReplacements !== replacements.size) {
    throw new Error('Profile revision plan upserts an unknown record')
  }
  return freezeDocument({
    head: plan.nextHead,
    records: [...records, ...plan.insertedRecords],
  })
}

function requireSupportedSnapshotShape(snapshot: ProfileSnapshot): void {
  if (snapshot.versions.profile !== PROFILE_CONTRACT_VERSIONS.profile
    || snapshot.versions.schema !== PROFILE_CONTRACT_VERSIONS.schema
    || snapshot.versions.record !== PROFILE_CONTRACT_VERSIONS.record
    || snapshot.versions.asset !== PROFILE_CONTRACT_VERSIONS.asset
    || snapshot.versions.app !== PROFILE_CONTRACT_VERSIONS.app
    || snapshot.versions.command !== PROFILE_CONTRACT_VERSIONS.command
    || snapshot.versions.export !== PROFILE_CONTRACT_VERSIONS.export) {
    throw new Error('Profile snapshot versions are unsupported')
  }
  requireEmpty(snapshot.modTemplates, 'Mod templates')
  requireEmpty(snapshot.modInstances, 'Mod instances')
  requireEmpty(snapshot.profileAgentEvents ?? [], 'Profile Agent events')
  requireEmpty(snapshot.profileSettings, 'Profile settings')
  requireEmpty(snapshot.migrationLedger, 'Migration ledger')
  requireEmpty(snapshot.recoveryPoints, 'Recovery points')
  if (Object.keys(snapshot.boards).length !== snapshot.ideas.length) {
    throw new Error('Profile snapshot contains Boards outside the supported Idea set')
  }
}

function requireSupportedBoardShape(board: SavedBoard, ideaId: string): void {
  requireEmpty(board.connections, `Board ${ideaId} connections`)
  requireEmpty(board.outputs, `Board ${ideaId} outputs`)
  requireEmpty(board.runs, `Board ${ideaId} runs`)
  requireEmpty(board.highlights ?? [], `Board ${ideaId} highlights`)
  requireEmpty(board.highlightTags ?? [], `Board ${ideaId} highlight tags`)
  requireEmpty(board.compactionSummaries ?? [], `Board ${ideaId} compaction summaries`)
  if (board.aiSettings !== undefined) throw new Error(`Board ${ideaId} settings are outside #459`)
  if (board.visualDecayEnabled !== undefined) throw new Error(`Board ${ideaId} legacy visual decay is outside #459`)
}

function validateDocument(document: ProfileRevisionDocument): void {
  requireRevision(document.head.revision, 'Profile revision')
  if (!document.head.profileId || !document.head.activeIdeaId) throw new Error('Profile revision head is invalid')
  if (canonicalProfileJson(document.head.versions) !== canonicalProfileJson(PROFILE_CONTRACT_VERSIONS)) {
    throw new Error('Profile revision head versions are unsupported')
  }
  const recordIds = new Set<string>()
  for (const record of document.records) {
    if (!PROFILE_RECORD_KINDS.has(record.kind)) throw new Error(`Unsupported Profile record kind ${record.kind}`)
    if (!record.recordId || recordIds.has(record.recordId)) throw new Error('Profile record IDs are invalid')
    recordIds.add(record.recordId)
    requireRevision(record.createdRevision, 'Profile record created revision')
    requireRevision(record.updatedRevision, 'Profile record updated revision')
    if (record.updatedRevision < record.createdRevision || record.updatedRevision > document.head.revision) {
      throw new Error(`Profile record ${record.recordId} has an invalid revision range`)
    }
    if (!Number.isSafeInteger(record.ordinal) || record.ordinal < 0) {
      throw new Error(`Profile record ${record.recordId} has an invalid ordinal`)
    }
    if (record.kind === 'mod-template' || record.kind === 'mod-instance') {
      const decoded = decodeProfileModRecord(record)
      if (!decoded.ok) {
        throw new ProfileRevisionCorruptionError(
          `Profile Mod record ${record.recordId} is invalid: ${decoded.message}`,
        )
      }
    }
    canonicalProfileJson(record.payload)
  }
}

function createRecord(input: {
  recordId: string
  kind: ProfileRevisionRecord['kind']
  ownerId: string
  parentId: string | null
  ordinal: number
  revision: number
  payload: unknown
}): ProfileRevisionRecord {
  return Object.freeze({
    recordId: input.recordId,
    kind: input.kind,
    ownerId: input.ownerId,
    parentId: input.parentId,
    ordinal: input.ordinal,
    recordVersion: PROFILE_CONTRACT_VERSIONS.record,
    createdRevision: input.revision,
    updatedRevision: input.revision,
    payload: cloneJson(input.payload),
  })
}

function replaceRecord(
  record: ProfileRevisionRecord,
  payload: unknown,
  updatedRevision: number,
): ProfileRevisionRecord {
  return Object.freeze({
    ...record,
    updatedRevision,
    payload: cloneJson(payload),
  })
}

function replaceRecordOrdinal(
  record: ProfileRevisionRecord,
  ordinal: number,
  updatedRevision: number,
): ProfileRevisionRecord {
  return Object.freeze({ ...record, ordinal, updatedRevision })
}

function freezeDocument(document: {
  head: ProfileRevisionHead
  records: readonly ProfileRevisionRecord[]
}): ProfileRevisionDocument {
  return Object.freeze({
    head: Object.freeze({ ...document.head, versions: cloneJson(document.head.versions) }),
    records: Object.freeze(document.records.map((record) => Object.freeze({
      ...record,
      payload: cloneJson(record.payload),
    }))),
  })
}

function readCardUpdatePayload(value: unknown): {
  ideaId: string
  cardId: string
  blockId: string
  text: string
} | undefined {
  if (!isRecord(value)) return undefined
  const keys = Object.keys(value).sort()
  if (keys.join(',') !== 'blockId,cardId,ideaId,text') return undefined
  const { ideaId, cardId, blockId, text } = value
  if (
    typeof ideaId !== 'string' || ideaId.length === 0
    || typeof cardId !== 'string' || cardId.length === 0
    || typeof blockId !== 'string' || blockId.length === 0
    || typeof text !== 'string'
  ) return undefined
  return { ideaId, cardId, blockId, text }
}

function validIdentity(identity: ProfileCommitIdentity): boolean {
  return identity.committedAt.length > 0 && identity.commitId.length > 0 && identity.intentEventId.length > 0
}

function boardRecordId(ideaId: string): string {
  return `board:${ideaId}`
}

function compatibilityRecordId(profileId: string): string {
  return `compatibility:${profileId}`
}

function readReachableCardAssetIds(payload: unknown, cardId: string): readonly string[] {
  try {
    return readCardAssetIds(payload)
  } catch {
    throw new ProfileRevisionCorruptionError(`Profile Card ${cardId} asset references are invalid`)
  }
}

function findOne(
  records: readonly ProfileRevisionRecord[],
  kind: ProfileRevisionRecord['kind'],
  recordId: string,
): ProfileRevisionRecord {
  const record = records.find((candidate) => candidate.kind === kind && candidate.recordId === recordId)
  if (!record) throw new Error(`Profile ${kind} record ${recordId} is missing`)
  return record
}

function byOrdinal(left: ProfileRevisionRecord, right: ProfileRevisionRecord): number {
  return left.ordinal - right.ordinal || left.recordId.localeCompare(right.recordId)
}

function requireRevision(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid`)
  return value
}

function requireEmpty(values: readonly unknown[], label: string): void {
  if (values.length > 0) throw new Error(`${label} are not owned by the #459 transactional slice`)
}

function readRequiredString(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== 'string') throw new Error(`Profile ${key} is invalid`)
  return value[key]
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function readOptionalNonNegativeInteger(value: unknown, key: string): number | undefined {
  if (!isRecord(value)) return undefined
  const candidate = value[key]
  return Number.isSafeInteger(candidate) && Number(candidate) >= 0 ? Number(candidate) : undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(canonicalProfileJson(value)) as Value
}

function toCanonicalJson(value: unknown, path: string): CanonicalJson {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`Profile JSON number is invalid at ${path}`)
    return Object.is(value, -0) ? 0 : value
  }
  if (Array.isArray(value)) {
    return value.map((entry, index) => {
      if (entry === undefined) throw new Error(`Profile JSON array contains undefined at ${path}[${index}]`)
      return toCanonicalJson(entry, `${path}[${index}]`)
    })
  }
  if (isRecord(value)) {
    const normalized = Object.create(null) as Record<string, CanonicalJson>
    for (const key of Object.keys(value).sort()) {
      const entry = value[key]
      if (entry !== undefined) normalized[key] = toCanonicalJson(entry, `${path}.${key}`)
    }
    return normalized
  }
  throw new Error(`Profile JSON value is invalid at ${path}`)
}
