import type {
  Block,
  Card,
  CardAuthorship,
  CardAsset,
  CompactionSummary,
  Connection,
  FollowUpMessage,
  Highlight,
  HighlightTag,
  IdeaSummary,
  IntentLogEvent,
  Output,
  OutputVersion,
  RunRecord,
  SavedBoard,
  TranscriptMessage,
} from '../graph/types'
import { isCardAuthorship } from '../graph/cardAuthorship'
import { parseProviderRouteProvenance } from '../graph/providerRouteProvenance'
import { isLinkPreview } from '../shared/linkPreview'
import {
  isLocalHtmlPreview,
  isLocalHtmlPreviewStaticImage,
  isLocalHtmlPreviewStaticImageMetadata,
} from '../shared/localHtmlPreview'
import {
  hydrateProfileLogicalAsset,
  readProfileLogicalAssetPayload,
  toProfileLogicalAssetPayload,
  type ProfileLogicalAssetPayload,
} from './profileAssetKernel'
import {
  createDirectProfileModInstance,
  decodeProfileModRecord,
  validateProfileModDocumentTransport,
  type ProfileModInstanceRecord,
} from './profileModRecords'
import {
  decodeProfileAgentEventRecord,
  PROFILE_AGENT_EVENT_RECORD_VERSION,
  type ProfileAgentEventRecord,
} from './profileAgentEvent'
import {
  PROFILE_CONTRACT_VERSIONS,
  PROFILE_SETTING_RECORD_VERSION,
  type ProfileCompatibility,
  type ProfileContractVersions,
  type ProfileJsonValue,
  type ProfileMigrationLedgerEntry,
  type ProfileQueryableRecordKind,
  type ProfileSettingRecord,
  type ProfileSnapshot,
} from './profileServiceContract'
import { isSettingsEnvelope } from './settingsEnvelope'

type ProjectedRecordKind = ProfileQueryableRecordKind

export type ProfileLogicalSnapshot = ProfileSnapshot

export type ProfileLogicalRecordSpec = Readonly<{
  recordId: string
  kind: ProjectedRecordKind
  ownerId: string
  parentId: string | null
  ordinal: number
  recordVersion: typeof PROFILE_CONTRACT_VERSIONS.record
  payload: ProfileJsonValue
}>

export type ProfileLogicalDocument = Readonly<{
  head: Readonly<{
    profileId: string
    revision: number
    versions: ProfileContractVersions
    activeIdeaId: string
  }>
  records: readonly ProfileLogicalRecordSpec[]
}>

export type ProfileAssetProjector = (asset: CardAsset) => ProfileLogicalAssetPayload
export type ProfileAssetHydrator = (payload: ProfileLogicalAssetPayload) => CardAsset

export class ProfileLogicalProjectionError extends Error {}

/**
 * Applies owner-derived authorship to Card record payloads. Candidate stamps
 * are never authoritative: unchanged Cards retain their stored stamps, new
 * Cards receive both stamps, and changed legacy Cards receive only a last
 * writer so their unknown creation history is never backfilled.
 */
export function stampProfileCardAuthorship(
  currentCandidate: unknown,
  targetCandidate: unknown,
  actor: CardAuthorship,
  options: Readonly<{ logicalMeaning?: 'current' | 'legacy-agent' }> = {},
): ProfileLogicalDocument {
  if (!isCardAuthorship(actor)) fail('Profile commit actor is invalid')
  const current = validateProfileLogicalDocument(currentCandidate)
  const target = validateProfileLogicalDocument(targetCandidate)
  const currentIndex = indexCardAuthorship(current.records)
  const targetIndex = indexCardAuthorship(target.records)
  const currentById = currentIndex.byRecordId
  const cardStampedRecords = target.records.map((record) => {
    if (record.kind !== 'card' || !isPlainRecord(record.payload)) return record
    const before = currentById.get(record.recordId)
    const beforePayload = before?.kind === 'card' && isPlainRecord(before.payload)
      ? before.payload
      : undefined
    const payload = cardPayloadWithoutAuthorship(record.payload)
    if (beforePayload === undefined) {
      const historicalCreator = historicalCardCreator(currentIndex, record.recordId)
      return strictClone({
        ...record,
        payload: {
          ...payload,
          ...(historicalCreator.found
            ? historicalCreator.createdBy === undefined
              ? {}
              : { createdBy: historicalCreator.createdBy }
            : { createdBy: actor }),
          lastModifiedBy: actor,
        },
      })
    }
    const changed = canonicalJson(cardLogicalMeaning(
      currentIndex,
      record.recordId,
      options.logicalMeaning ?? 'current',
    )) !== canonicalJson(cardLogicalMeaning(
      targetIndex,
      record.recordId,
      options.logicalMeaning ?? 'current',
    ))
    return strictClone({
      ...record,
      payload: {
        ...payload,
        ...(beforePayload.createdBy === undefined ? {} : { createdBy: beforePayload.createdBy }),
        ...(changed
          ? { lastModifiedBy: actor }
          : beforePayload.lastModifiedBy === undefined
            ? {}
            : { lastModifiedBy: beforePayload.lastModifiedBy }),
      },
    })
  })
  const records = normalizeNewHistoricalCardSnapshots(
    currentIndex,
    cardStampedRecords,
    actor,
  )
  // `target` came back from validateProfileLogicalDocument above, so the result
  // is a validated document with authorship rewritten inside Card payloads.
  // Nothing structural moved, so re-deriving the whole Profile to learn that
  // again cost a quarter of a second per save on a large Board. Check what this
  // function actually changed instead.
  const stamped = deepFreeze({ head: target.head, records }) as unknown as ProfileLogicalDocument
  assertStampPreservedStructure(target, stamped)
  markValidatedProfileLogicalDocument(stamped)
  return stamped
}

/**
 * Every stamped record must be its target record with the same identity and
 * container position, carrying only valid authorship where this module wrote
 * it. A structural difference here means the stamp changed something it has no
 * business changing, and the document must go back through full validation.
 */
function assertStampPreservedStructure(
  target: ProfileLogicalDocument,
  stamped: ProfileLogicalDocument,
): void {
  if (stamped.records.length !== target.records.length) {
    fail('Profile authorship stamp changed the record set')
  }
  for (const [index, record] of stamped.records.entries()) {
    const before = target.records[index]!
    if (record.recordId !== before.recordId
      || record.kind !== before.kind
      || record.ownerId !== before.ownerId
      || record.parentId !== before.parentId
      || record.ordinal !== before.ordinal
      || record.recordVersion !== before.recordVersion) {
      fail(`Profile authorship stamp moved record ${record.recordId}`)
    }
    if (record.payload === before.payload) continue
    if (record.kind === 'card') {
      assertStampedAuthorship(record.payload, record.recordId)
      assertStampPreservedContent(
        stampedCardContent(record.payload),
        stampedCardContent(before.payload),
        record.recordId,
        'Card',
      )
      continue
    }
    // Past the identity check the payload changed, and the stamp only has
    // business changing a Card or the Card inside a new historical event.
    // Anything else reaching here is a stamp that overstepped.
    if (record.kind !== 'intent-event') {
      fail(`Profile authorship stamp rewrote ${record.kind} content on ${record.recordId}`)
    }
    const event = record.payload
    if (!isPlainRecord(event) || !isPlainRecord(event.data)) {
      fail(`Profile authorship stamp rewrote Intent Log content on ${record.recordId}`)
    }
    assertStampedAuthorship(event.data.card, record.recordId)
    assertStampPreservedContent(
      stampedEventContent(event),
      stampedEventContent(before.payload),
      record.recordId,
      'Intent Log',
    )
  }
}

/**
 * The document this function returns is the one that gets written, so the
 * stamp's own output is the last thing between a Card's content and disk.
 * Authorship is the only thing the stamp is allowed to rewrite; everything
 * else must survive byte for byte. Without this, a bug in the stamp would
 * write Card content nobody asked for, and the read-back after the commit
 * would agree with it, because the read-back compares the database against
 * this same document.
 */
function assertStampPreservedContent(
  stamped: unknown,
  target: unknown,
  recordId: string,
  subject: string,
): void {
  if (canonicalJson(stamped) !== canonicalJson(target)) {
    fail(`Profile authorship stamp rewrote ${subject} content on ${recordId}`)
  }
}

function stampedCardContent(payload: unknown): unknown {
  return isPlainRecord(payload) ? cardPayloadWithoutAuthorship(payload) : payload
}

function stampedEventContent(event: unknown): unknown {
  if (!isPlainRecord(event) || !isPlainRecord(event.data) || !isPlainRecord(event.data.card)) {
    return event
  }
  return {
    ...event,
    data: { ...event.data, card: cardPayloadWithoutAuthorship(event.data.card) },
  }
}

function assertStampedAuthorship(payload: unknown, recordId: string): void {
  if (!isPlainRecord(payload)) return
  if (payload.createdBy !== undefined && !isCardAuthorship(payload.createdBy)) {
    fail(`Profile authorship stamp wrote an invalid creator on ${recordId}`)
  }
  if (payload.lastModifiedBy !== undefined && !isCardAuthorship(payload.lastModifiedBy)) {
    fail(`Profile authorship stamp wrote an invalid last writer on ${recordId}`)
  }
}

function normalizeNewHistoricalCardSnapshots(
  currentIndex: CardAuthorshipIndex,
  targetRecords: readonly ProfileLogicalRecordSpec[],
  actor: CardAuthorship,
): readonly ProfileLogicalRecordSpec[] {
  const currentRecords = currentIndex.records
  const currentRecordIds = new Set(currentRecords.map((record) => record.recordId))
  const currentCards = new Map(currentRecords.flatMap((record) => (
    record.kind === 'card' && isPlainRecord(record.payload)
      ? [[record.recordId, record.payload] as const]
      : []
  )))
  const targetCards = new Map(targetRecords.flatMap((record) => (
    record.kind === 'card' && isPlainRecord(record.payload)
      ? [[record.recordId, record.payload] as const]
      : []
  )))

  return targetRecords.map((record) => {
    if (record.kind !== 'intent-event'
      || currentRecordIds.has(record.recordId)
      || !isPlainRecord(record.payload)) {
      return record
    }
    const event = record.payload
    const type = event.type
    if ((type !== 'card.created' && type !== 'group.created' && type !== 'card.deleted')
      || typeof event.cardId !== 'string'
      || !isPlainRecord(event.data)
      || !isPlainRecord(event.data.card)
      || event.data.card.id !== event.cardId) {
      return record
    }
    const targetCard = targetCards.get(event.cardId)
    const currentCard = currentCards.get(event.cardId)
    let trustedCreatedBy: CardAuthorship | undefined
    let trustedLastModifiedBy: CardAuthorship
    if (type === 'card.deleted') {
      const trustedCard = currentCard ?? targetCard
      if (trustedCard !== undefined) {
        trustedCreatedBy = isCardAuthorship(trustedCard.createdBy)
          ? trustedCard.createdBy
          : undefined
      } else {
        const historicalCreator = historicalCardCreator(currentIndex, event.cardId)
        trustedCreatedBy = historicalCreator.found
          ? historicalCreator.createdBy
          : actor
      }
      trustedLastModifiedBy = actor
    } else if (targetCard !== undefined) {
      trustedCreatedBy = isCardAuthorship(targetCard.createdBy)
        ? targetCard.createdBy
        : undefined
      trustedLastModifiedBy = isCardAuthorship(targetCard.lastModifiedBy)
        ? targetCard.lastModifiedBy
        : actor
    } else {
      // A held or coalesced create→delete sequence can append immutable
      // history without leaving a live Card. Native ownership still supplies
      // the birth actor; embedded candidate stamps never become authoritative.
      trustedCreatedBy = actor
      trustedLastModifiedBy = actor
    }
    const normalizedCard = {
      ...cardPayloadWithoutAuthorship(event.data.card),
      ...(trustedCreatedBy === undefined ? {} : { createdBy: trustedCreatedBy }),
      lastModifiedBy: trustedLastModifiedBy,
    }
    return strictClone({
      ...record,
      payload: {
        ...event,
        data: { ...event.data, card: normalizedCard },
      } as ProfileJsonValue,
    })
  })
}

/**
 * One pass over a document's records, so that per-Card authorship questions
 * cost their own Card instead of the whole Profile. Without this, stamping a
 * save re-scanned every record once per Card: on a 1,000-Card Board that was
 * ~3.3 seconds of the save, and it grew with the square of the Board.
 */
type CardAuthorshipIndex = Readonly<{
  records: readonly ProfileLogicalRecordSpec[]
  byRecordId: ReadonlyMap<string, ProfileLogicalRecordSpec>
  childrenByParentId: ReadonlyMap<string, readonly ProfileLogicalRecordSpec[]>
  groupMembersByGroupId: ReadonlyMap<string, readonly ProfileLogicalRecordSpec[]>
  cardEventsByCardId: ReadonlyMap<string, readonly ProfileLogicalRecordSpec[]>
}>

function indexCardAuthorship(
  records: readonly ProfileLogicalRecordSpec[],
): CardAuthorshipIndex {
  const byRecordId = new Map<string, ProfileLogicalRecordSpec>()
  const childrenByParentId = new Map<string, ProfileLogicalRecordSpec[]>()
  const groupMembersByGroupId = new Map<string, ProfileLogicalRecordSpec[]>()
  const cardEventsByCardId = new Map<string, ProfileLogicalRecordSpec[]>()
  for (const record of records) {
    byRecordId.set(record.recordId, record)
    if (record.parentId !== null) {
      const siblings = childrenByParentId.get(record.parentId)
      if (siblings) siblings.push(record)
      else childrenByParentId.set(record.parentId, [record])
    }
    if (record.kind === 'card' && isPlainRecord(record.payload)) {
      const groupId = record.payload.groupId
      if (typeof groupId === 'string') {
        const members = groupMembersByGroupId.get(groupId)
        if (members) members.push(record)
        else groupMembersByGroupId.set(groupId, [record])
      }
      continue
    }
    if (record.kind === 'intent-event' && isPlainRecord(record.payload)) {
      const cardId = record.payload.cardId
      if (typeof cardId === 'string' && HISTORICAL_CARD_CREATOR_EVENT_TYPES.has(String(record.payload.type))) {
        const events = cardEventsByCardId.get(cardId)
        if (events) events.push(record)
        else cardEventsByCardId.set(cardId, [record])
      }
    }
  }
  for (const members of groupMembersByGroupId.values()) {
    members.sort((left, right) => left.ordinal - right.ordinal || left.recordId.localeCompare(right.recordId))
  }
  for (const events of cardEventsByCardId.values()) {
    events.sort((left, right) => right.ordinal - left.ordinal)
  }
  return {
    records,
    byRecordId,
    childrenByParentId,
    groupMembersByGroupId,
    cardEventsByCardId,
  }
}

const HISTORICAL_CARD_CREATOR_EVENT_TYPES: ReadonlySet<string> = new Set([
  'card.created',
  'group.created',
  'card.deleted',
])

type HistoricalCardCreator =
  | Readonly<{ found: false }>
  | Readonly<{ found: true; createdBy?: CardAuthorship }>

function historicalCardCreator(
  index: CardAuthorshipIndex,
  cardId: string,
): HistoricalCardCreator {
  // Newest first, and only this Card's create/delete events.
  const candidates = index.cardEventsByCardId.get(cardId) ?? []
  const fromEvents = (types: ReadonlySet<string>): HistoricalCardCreator => {
    let found = false
    for (const record of candidates) {
      const event = record.payload as Record<string, unknown>
      if (!types.has(String(event.type)) || event.cardId !== cardId || !isPlainRecord(event.data)) continue
      const card = event.data.card
      if (!isPlainRecord(card) || card.id !== cardId) continue
      found = true
      if (isCardAuthorship(card.createdBy)) return { found: true, createdBy: card.createdBy }
    }
    return found ? { found: true } : { found: false }
  }

  const deletion = fromEvents(new Set(['card.deleted']))
  if (deletion.found && deletion.createdBy !== undefined) return deletion
  const creation = fromEvents(new Set(['card.created', 'group.created']))
  if (creation.found && creation.createdBy !== undefined) return creation
  return deletion.found || creation.found ? { found: true } : { found: false }
}

function cardLogicalMeaning(
  index: CardAuthorshipIndex,
  cardId: string,
  semantics: 'current' | 'legacy-agent',
): Readonly<{
  recordClosure: readonly ProfileLogicalRecordSpec[]
  orderedGroupMemberIds: readonly string[]
}> {
  const own = index.byRecordId.get(cardId)
  const cardRecord = own?.kind === 'card' ? own : undefined
  // The closure is this Card plus the records parented to it, which the index
  // already groups. Everything else in the Profile is irrelevant to it.
  const closureSource = [
    ...(own === undefined ? [] : [own]),
    ...(index.childrenByParentId.get(cardId) ?? []).filter((record) => record.recordId !== cardId),
  ]
  const recordClosure = closureSource.flatMap((record) => {
    if (record.recordId !== cardId && record.parentId !== cardId) return []
    if (record.kind !== 'card' || !isPlainRecord(record.payload)) return [record]
    return [{
      ...record,
      // Board Card ordinals are container bookkeeping. Group member order is
      // attributed to the Group below; reindexing after an unrelated delete
      // must not claim that every shifted Card was edited.
      ordinal: semantics === 'current' && record.recordId === cardId ? 0 : record.ordinal,
      payload: cardPayloadWithoutAuthorship(record.payload) as ProfileJsonValue,
    }]
  }).sort((left, right) => (
    left.kind < right.kind ? -1
      : left.kind > right.kind ? 1
        : left.recordId < right.recordId ? -1
          : left.recordId > right.recordId ? 1
            : 0
  ))
  const orderedGroupMemberIds = semantics === 'current' && cardRecord
    && isPlainRecord(cardRecord.payload)
    && cardRecord.payload.kind === 'group'
    ? (index.groupMembersByGroupId.get(cardId) ?? []).map((record) => record.recordId)
    : []
  return { recordClosure, orderedGroupMemberIds }
}

// THE STRICT CONTENT SURFACE, NAMED ONCE SO A TEST CAN HOLD IT.
//
// Every list below is a closed set that an already-installed build carries its
// own copy of. Add a key here, or add a member to a closed value set here, and
// the build a person downgrades to refuses the whole record, which the revision
// store then reports as a corrupt Profile for everything they own (ADR 0040).
// That is correct for CONTENT, which must fail closed, and catastrophic for a
// preference, which must fail soft inside a settings envelope instead.
//
// The lists used to be array literals inline in each validator, where nothing
// could see them. They are named here so `strictContentSurface.test.ts` pins
// them: growing one is now a deliberate, reviewed act instead of a one-line
// change that no check notices. That test is the gate hard stops 1 and 3 of
// docs/agents/persisting-a-new-setting.md rely on.
//
// The envelope keys (`meta` on the Card, `settings` on the Board and the Idea,
// `aiSettings` on the Board) appear in these key lists because the strict
// allowlists have to admit the container. What lives INSIDE them is not pinned
// by anything and must never be: growing a settings envelope is the correct
// move, and it is free.
export const STRICT_CONTENT_SURFACE = {
  keys: {
    board: [
      'version',
      'cards',
      'connections',
      'outputs',
      'runs',
      'highlights',
      'highlightTags',
      'intentLog',
      'visualDecayEnabled',
      'aiSettings',
      // The Board's own settings envelope (ADR 0040), for Board-level
      // preferences that are not AI settings. Validated as an open plain record
      // and never key by key.
      //
      // KNOWN AND ACCEPTED COST: adding this key protects nothing already
      // shipped. Every installed build carries its own copy of this allowlist
      // and refuses a Board the first time one actually carries `settings`, so
      // the release that first WRITES a Board-level setting is the release older
      // builds start failing. That break is deliberate, is paid exactly once, and
      // every release after it is safe forever. There is no way to design around
      // it: the same `hasOnlyKeys` that makes the break is what makes the
      // tolerance real from here on.
      'settings',
      'compactionSummaries',
      'updatedAt',
    ],
    idea: ['id', 'name', 'createdAt', 'updatedAt', 'lastOpenedAt', 'settings'],
    card: [
      'id',
      'kind',
      'createdBy',
      'lastModifiedBy',
      'title',
      'headerColor',
      'headerFill',
      'blocks',
      'assets',
      'linkPreview',
      'localHtmlPreview',
      'compressionPrompt',
      'mod',
      'modV2',
      'model',
      'conversationStyle',
      'conversationTurns',
      // LEGACY, READ-ONLY. The Note body scale moved into the settings envelope
      // (graph/noteFontSize.ts) and nothing writes this key any more, but it
      // MUST stay on the allowlist: `hasOnlyKeys` fails a Card on a stranger
      // key, and every Profile already saved carries `fontSize`. Dropping it
      // here would fail those Cards, fail the projection, and report the whole
      // revision as corrupt, which is the exact failure the envelope exists to
      // prevent. It keeps its original strict union for the same reason.
      'fontSize',
      'source',
      'agentic',
      'zIndex',
      'position',
      'size',
      'groupId',
      'meta',
    ],
    block: ['id', 'text', 'kind'],
    // `connection.meta` is NOT a settings envelope. It is an open record with
    // two content fields checked by value, so an unknown key inside it already
    // survives, but a foreign value under `groupMode` still fails closed.
    connection: ['id', 'from', 'to', 'strength', 'polarity', 'role', 'reason', 'meta'],
    output: ['id', 'resultCardId', 'versions', 'chosenVersionId'],
    outputVersion: [
      'id',
      'number',
      'text',
      'createdAt',
      'fromRunId',
      'digestKey',
      'accepted',
      'transcript',
      'provisional',
      'provisionalReason',
      'provisionalMessage',
      'followUpThread',
      'sourceContext',
      'sourceChangeDismissedSignature',
    ],
    followUpThread: ['messages', 'collapsed'],
    followUpMessage: ['id', 'role', 'text', 'createdAt', 'status', 'toolSteps'],
    transcriptMessage: [
      'id', 'speakerKind', 'speakerName', 'participantCardId', 'text', 'turnNumber', 'streaming',
    ],
  },
  // The closed value sets still on the strict path. A new member costs the same
  // downgrade break as a new key: the older build was not compiled to accept
  // the value and refuses the record carrying it. Inside an envelope the
  // opposite holds, so a new look or a new style belongs in a setting
  // contract's `choices`, where widening is free.
  closedValues: {
    cardKind: ['note', 'askAi', 'result', 'mod', 'group', 'conversation', 'title'],
    cardHeaderFill: ['half', 'full', 'pattern'],
    cardConversationStyle: ['debate', 'critique', 'interview', 'collaborate'],
    cardLegacyFontSize: ['small', 'medium', 'large'],
    blockKind: ['line', 'heading', 'bullet', 'generated'],
    connectionStrength: ['strong', 'weak'],
    connectionPolarity: ['helps', 'pushesAgainst'],
    connectionRole: ['feeds', 'modifies'],
    connectionGroupMode: ['full', 'compress'],
    outputVersionProvisionalReason: ['canceled', 'failed'],
    transcriptSpeakerKind: ['participant', 'user'],
    followUpMessageRole: ['user', 'assistant'],
    followUpMessageStatus: ['complete', 'streaming', 'stopped', 'failed'],
  },
} as const

const CARD_KINDS = new Set<Card['kind']>(STRICT_CONTENT_SURFACE.closedValues.cardKind)
const INTENT_EVENT_TYPES = new Set<IntentLogEvent['type']>([
  'card.created',
  'group.created',
  'card.deleted',
  'card.moved',
  'card.resized',
  'cards.arranged',
  'card.layer.changed',
  'card.content.edited',
  'group.members.changed',
  'connection.created',
  'connection.deleted',
  'connection.changed',
  'run.started',
  'run.continued',
  'run.completed',
  'run.failed',
  'run.canceled',
  'group.compression.started',
  'group.compression.completed',
  'group.compression.failed',
  'group.compression.canceled',
  'version.chosen',
  'version.acceptance.changed',
  'version.note.created',
  'followup.message.added',
  'followup.message.finished',
  'followup.thread.cleared',
])
const HISTORICAL_CARD_EVENT_TYPES = new Set<IntentLogEvent['type']>([
  'card.created',
  'group.created',
  'card.deleted',
])

export function projectProfileSnapshot(
  candidate: ProfileLogicalSnapshot,
  projectAsset: ProfileAssetProjector,
  { validateLocalAssetBytes = true }: Readonly<{ validateLocalAssetBytes?: boolean }> = {},
): ProfileLogicalDocument {
  assertInertJson(candidate, '$snapshot')
  const snapshot = strictClone(candidate)
  validateSnapshotEnvelope(snapshot)

  const records: ProfileLogicalRecordSpec[] = []
  const recordIds = new Set<string>()
  const consumedModInstances = new Set<string>()
  const assetMetadataById = new Map<string, ProfileLogicalAssetPayload>()
  const append = (record: ProfileLogicalRecordSpec) => {
    if (recordIds.has(record.recordId)) {
      fail(`Profile logical record ID is not globally unique: ${record.recordId}`)
    }
    recordIds.add(record.recordId)
    records.push(record)
  }
  const materialize = (asset: CardAsset, path: string) => {
    validateCardAsset(asset, path)
    const projected = projectAsset(asset)
    assertInertJson(projected, `${path}.metadata`)
    const metadata = readProfileLogicalAssetPayload(projected)
    if (!metadata || metadata.id !== asset.id) fail(`${path} asset metadata is invalid`)
    const expected = toProfileLogicalAssetPayload(asset, metadata.sha256)
    if (canonicalJson(expected) !== canonicalJson(metadata)) {
      fail(`${path} asset metadata does not match the hydrated asset`)
    }
    const previous = assetMetadataById.get(metadata.id)
    if (previous && canonicalJson(previous) !== canonicalJson(metadata)) {
      fail(`Profile logical asset ${metadata.id} changes identity across current or historical state`)
    }
    assetMetadataById.set(metadata.id, metadata)
    return metadata
  }

  append(record(snapshot.profileId, 'profile', snapshot.profileId, null, 0, {
    profileId: snapshot.profileId,
  }))
  append(record(
    compatibilityRecordId(snapshot.profileId),
    'compatibility-state',
    snapshot.profileId,
    snapshot.profileId,
    0,
    snapshot.compatibility,
  ))

  snapshot.ideas.forEach((idea, ideaOrdinal) => {
    validateIdea(idea, `$snapshot.ideas[${ideaOrdinal}]`)
    const board = ownValue(snapshot.boards, idea.id)
    if (!board) fail(`Profile Board is missing for Idea ${idea.id}`)
    const boardId = boardRecordId(idea.id)

    append(record(idea.id, 'idea', snapshot.profileId, snapshot.profileId, ideaOrdinal, idea))
    validateBoard(board, `$snapshot.boards.${idea.id}`)
    append(record(boardId, 'board', idea.id, idea.id, 0, {
      version: board.version,
      updatedAt: board.updatedAt,
      // The Board's settings envelope rides on the Board record itself, not on
      // a child record of its own: it is one open bag, and giving it a record
      // would give it an identity, an ordinal, and a duplicate check that a bag
      // of preferences has no use for. Absent stays absent so a Board that
      // never carried one is byte-identical to one written before the envelope.
      ...(board.settings === undefined ? {} : { settings: board.settings }),
    }))

    const cardIds = new Set(board.cards.map((card) => card.id))
    board.cards.forEach((card, cardOrdinal) => {
      const path = `$snapshot.boards.${idea.id}.cards[${cardOrdinal}]`
      validateCard(card, path, validateLocalAssetBytes)
      const { blocks, assets, modV2, ...cardEnvelope } = card
      const projectedAssets = (assets ?? []).map((asset, assetOrdinal) => {
        const metadata = materialize(asset, `${path}.assets[${assetOrdinal}]`)
        append(record(metadata.id, 'logical-asset', boardId, card.id, assetOrdinal, metadata))
        return metadata.id
      })
      append(record(card.id, 'card', boardId, boardId, cardOrdinal, {
        ...cardEnvelope,
        ...(projectedAssets.length === 0 ? {} : { assetIds: projectedAssets }),
      }))
      blocks.forEach((block, blockOrdinal) => {
        validateBlock(block, `${path}.blocks[${blockOrdinal}]`)
        append(record(block.id, 'block', boardId, card.id, blockOrdinal, block))
      })

      const instances = snapshot.modInstances.filter((instance) => instance.parentId === card.id)
      if (modV2 === undefined && instances.length !== 0) {
        fail(`Profile Card ${card.id} has a Mod record but no Card.modV2`)
      }
      if (modV2 !== undefined) {
        if (instances.length !== 1) fail(`Profile Card ${card.id} must own exactly one Mod instance record`)
        const instance = instances[0]
        if (!instance) fail(`Profile Card ${card.id} Mod instance is missing`)
        const decoded = decodeProfileModRecord(instance)
        if (!decoded.ok || decoded.value.kind !== 'mod-instance') {
          fail(`Profile Card ${card.id} Mod instance record is invalid`)
        }
        if (instance.ownerId !== boardId || canonicalJson(instance.payload.mod) !== canonicalJson(modV2)) {
          fail(`Profile Card ${card.id} does not match its Mod instance record`)
        }
        consumedModInstances.add(instance.recordId)
        append(record(
          instance.recordId,
          'mod-instance',
          instance.ownerId,
          instance.parentId,
          0,
          instance.payload,
        ))
      }
    })

    board.connections.forEach((connection, ordinal) => {
      validateConnection(connection, `$snapshot.boards.${idea.id}.connections[${ordinal}]`)
      if (!cardIds.has(connection.from.cardId) || !cardIds.has(connection.to.cardId)) {
        fail(`Profile Connection ${connection.id} has a dangling Card endpoint`)
      }
      append(record(connection.id, 'connection', boardId, boardId, ordinal, connection))
    })

    board.outputs.forEach((output, outputOrdinal) => {
      validateOutput(output, `$snapshot.boards.${idea.id}.outputs[${outputOrdinal}]`)
      if (!cardIds.has(output.resultCardId)) {
        fail(`Profile Output ${output.id} has a dangling result Card`)
      }
      const { versions, ...outputPayload } = output
      append(record(output.id, 'output', boardId, boardId, outputOrdinal, outputPayload))
      const versionIds = new Set(versions.map((version) => version.id))
      if (output.chosenVersionId !== undefined && !versionIds.has(output.chosenVersionId)) {
        fail(`Profile Output ${output.id} has a dangling chosen Version`)
      }
      versions.forEach((version, versionOrdinal) => {
        validateOutputVersion(version, `$snapshot.boards.${idea.id}.outputs[${outputOrdinal}].versions[${versionOrdinal}]`)
        const { transcript, followUpThread, ...versionPayload } = version
        append(record(version.id, 'output-version', boardId, output.id, versionOrdinal, {
          ...versionPayload,
          transcript: { present: transcript !== undefined },
          followUpThread: {
            present: followUpThread !== undefined,
            ...(followUpThread?.collapsed === undefined ? {} : { collapsed: followUpThread.collapsed }),
          },
        }))
        ;(transcript ?? []).forEach((message, ordinal) => {
          validateTranscriptMessage(message, `${version.id}.transcript[${ordinal}]`)
          append(record(message.id, 'transcript-message', boardId, version.id, ordinal, message))
        })
        ;(followUpThread?.messages ?? []).forEach((message, ordinal) => {
          validateFollowUpMessage(message, `${version.id}.followUpThread.messages[${ordinal}]`)
          append(record(message.id, 'follow-up-message', boardId, version.id, ordinal, message))
        })
      })
    })

    board.runs.forEach((run, ordinal) => {
      validateRun(run, `$snapshot.boards.${idea.id}.runs[${ordinal}]`)
      append(record(run.id, 'run', boardId, boardId, ordinal, run))
    })
    ;(board.intentLog ?? []).forEach((event, ordinal) => {
      validateIntentEvent(
        event,
        `$snapshot.boards.${idea.id}.intentLog[${ordinal}]`,
        validateLocalAssetBytes,
      )
      if (event.ideaId !== undefined && event.ideaId !== idea.id) {
        fail(`Profile Intent event ${event.id} belongs to a different Idea`)
      }
      append(record(
        event.id,
        'intent-event',
        boardId,
        boardId,
        ordinal,
        projectIntentEvent(event, materialize, validateLocalAssetBytes),
      ))
    })

    if (board.aiSettings !== undefined) {
      validateBoardSettings(board.aiSettings, `$snapshot.boards.${idea.id}.aiSettings`)
      append(record(
        boardSettingsRecordId(boardId),
        'board-settings',
        boardId,
        boardId,
        0,
        board.aiSettings,
      ))
    }
    ;(board.highlightTags ?? []).forEach((tag, ordinal) => {
      validateHighlightTag(tag, `$snapshot.boards.${idea.id}.highlightTags[${ordinal}]`)
      append(record(tag.id, 'highlight-tag', boardId, boardId, ordinal, tag))
    })
    const tagIds = new Set((board.highlightTags ?? []).map((tag) => tag.id))
    ;(board.highlights ?? []).forEach((highlight, ordinal) => {
      validateHighlight(highlight, `$snapshot.boards.${idea.id}.highlights[${ordinal}]`)
      if (!cardIds.has(highlight.cardId) || !tagIds.has(highlight.tagId)) {
        fail(`Profile Highlight ${highlight.id} has a dangling Card or Tag`)
      }
      append(record(highlight.id, 'highlight', boardId, boardId, ordinal, highlight))
    })
    ;(board.compactionSummaries ?? []).forEach((summary, ordinal) => {
      validateCompactionSummary(summary, `$snapshot.boards.${idea.id}.compactionSummaries[${ordinal}]`)
      append(record(
        compactionSummaryRecordId(boardId, summary.cardId),
        'compaction-summary',
        boardId,
        boardId,
        ordinal,
        summary,
      ))
    })
  })

  if (Object.keys(snapshot.boards).length !== snapshot.ideas.length) {
    fail('Profile contains a Board outside its Idea set')
  }
  if (!snapshot.ideas.some((idea) => idea.id === snapshot.activeIdeaId)) {
    fail('Profile active Idea is missing')
  }
  validateSnapshotReferences(snapshot)
  if (consumedModInstances.size !== snapshot.modInstances.length) {
    fail('Profile contains an unconsumed Mod instance record')
  }

  snapshot.modTemplates.forEach((template, ordinal) => {
    const decoded = decodeProfileModRecord(template)
    if (!decoded.ok || decoded.value.kind !== 'mod-template') {
      fail(`Profile Mod template ${template.recordId} is invalid`)
    }
    if (template.ownerId !== snapshot.profileId || template.parentId !== snapshot.profileId) {
      fail(`Profile Mod template ${template.recordId} has the wrong owner`)
    }
    append(record(template.recordId, 'mod-template', snapshot.profileId, snapshot.profileId, ordinal, template.payload))
  })
  const profileAgentEvents = (snapshot.profileAgentEvents ?? []).map((event) => {
    const decoded = decodeProfileAgentEventRecord(event)
    if (!decoded.ok) fail(`Profile Agent event ${event.recordId} is invalid`)
    if (decoded.value.ownerId !== snapshot.profileId
      || decoded.value.parentId !== snapshot.profileId) {
      fail(`Profile Agent event ${event.recordId} has the wrong owner`)
    }
    return decoded.value
  })
  validateProfileAgentEventSequences(profileAgentEvents)
  profileAgentEvents.forEach((event, ordinal) => {
    append(record(
      event.recordId,
      'profile-agent-event',
      snapshot.profileId,
      snapshot.profileId,
      ordinal,
      event.payload,
    ))
  })
  snapshot.profileSettings.forEach((setting, ordinal) => {
    validateProfileSetting(setting, `$snapshot.profileSettings[${ordinal}]`)
    append(record(setting.id, 'profile-setting', snapshot.profileId, snapshot.profileId, ordinal, setting))
  })
  snapshot.migrationLedger.forEach((entry, ordinal) => {
    validateMigrationEntry(entry, `$snapshot.migrationLedger[${ordinal}]`)
    append(record(entry.id, 'migration-ledger-entry', snapshot.profileId, snapshot.profileId, ordinal, entry))
  })

  const document: ProfileLogicalDocument = {
    head: {
      profileId: snapshot.profileId,
      revision: snapshot.revision,
      versions: strictClone(snapshot.versions),
      activeIdeaId: snapshot.activeIdeaId,
    },
    records,
  }
  validateRecordOrdinals(document.records)
  // Deliberately NOT marked as validated. This projector is the writer and
  // `hydrateProfileLogicalDocument` is the reader; they are two bodies of code
  // that must agree, not one authority. A field the writer emits and the reader
  // refuses has to fail the save while the work is still in memory, because the
  // alternative is a Profile that reports "Saved" and then cannot be opened
  // again. The store reads every projection back once before it writes.
  return deepFreeze(strictClone(document))
}

function indexKey(kind: string, id: string): string {
  return `${kind}\u0000${id}`
}

function pushIndexed<Value>(index: Map<string, Value[]>, key: string, value: Value): void {
  const existing = index.get(key)
  if (existing) existing.push(value)
  else index.set(key, [value])
}

export function hydrateProfileLogicalDocument(
  candidate: unknown,
  hydrateAsset: ProfileAssetHydrator,
  {
    validateLocalAssetBytes = true,
    detach = true,
    roundTrip = true,
  }: Readonly<{
    validateLocalAssetBytes?: boolean
    detach?: boolean
    // Re-projecting the hydrated snapshot and comparing it with the source
    // proves the projector and the hydrator agree about this document. That is
    // a property of the document, not of the read, so a caller holding an
    // already-validated document can build its snapshot without paying for the
    // proof again.
    roundTrip?: boolean
  }> = {},
): ProfileLogicalSnapshot {
  const document = decodeDocument(candidate)
  // Hydration is the Profile's structural check as well as its reader. When a
  // caller only wants the check, the deep copy of every payload is pure waste:
  // the snapshot is discarded, and the source records are already frozen.
  const detached = <Value>(value: Value): Value => (detach ? strictClone(value) : value)
  const detachedForEdit = (value: Record<string, unknown>): Record<string, unknown> => (
    detach ? strictClone(value) : { ...value }
  )
  validateRecordOrdinals(document.records)
  const consumed = new Set<string>()
  const consume = (record: ProfileLogicalRecordSpec) => {
    if (consumed.has(record.recordId)) fail(`Profile record ${record.recordId} was consumed more than once`)
    consumed.add(record.recordId)
    return record
  }
  // Hydration used to answer every "which records are mine?" question by
  // scanning the whole document, once per Card, per Output, per Version. On a
  // 1,000-Card Board that was ~0.85s per hydration, and hydration runs inside
  // every document validation, several times per save. These indexes make each
  // lookup cost its own records.
  const byKindAndRecordId = new Map<string, ProfileLogicalRecordSpec[]>()
  const byKindAndOwnerId = new Map<string, ProfileLogicalRecordSpec[]>()
  for (const record of document.records) {
    pushIndexed(byKindAndRecordId, indexKey(record.kind, record.recordId), record)
    pushIndexed(byKindAndOwnerId, indexKey(record.kind, record.ownerId), record)
  }
  const ownedCache = new Map<string, readonly ProfileLogicalRecordSpec[]>()
  const ownedByParentCache = new Map<string, ReadonlyMap<string, readonly ProfileLogicalRecordSpec[]>>()

  const one = (kind: ProjectedRecordKind, recordId: string) => {
    const matches = byKindAndRecordId.get(indexKey(kind, recordId)) ?? []
    if (matches.length !== 1 || !matches[0]) fail(`Profile ${kind} record ${recordId} is missing or duplicated`)
    return consume(matches[0])
  }
  const owned = (kind: ProjectedRecordKind, ownerId: string): readonly ProfileLogicalRecordSpec[] => {
    const key = indexKey(kind, ownerId)
    const cached = ownedCache.get(key)
    if (cached) return cached
    const sorted = [...(byKindAndOwnerId.get(key) ?? [])].sort(byOrdinal)
    ownedCache.set(key, sorted)
    return sorted
  }
  // Same ordered result as owned(...).filter(by parent), grouped once.
  const ownedByParent = (
    kind: ProjectedRecordKind,
    ownerId: string,
    parentId: string,
  ): readonly ProfileLogicalRecordSpec[] => {
    const key = indexKey(kind, ownerId)
    let grouped = ownedByParentCache.get(key)
    if (!grouped) {
      const next = new Map<string, ProfileLogicalRecordSpec[]>()
      for (const record of owned(kind, ownerId)) {
        if (record.parentId === null) continue
        pushIndexed(next, record.parentId, record)
      }
      grouped = next
      ownedByParentCache.set(key, next)
    }
    return grouped.get(parentId) ?? []
  }

  const profile = one('profile', document.head.profileId)
  if (profile.ownerId !== document.head.profileId || profile.parentId !== null
    || !isPlainRecord(profile.payload) || profile.payload.profileId !== document.head.profileId) {
    fail('Profile record does not match the document head')
  }
  const compatibilityRecord = one('compatibility-state', compatibilityRecordId(document.head.profileId))
  const compatibility = detached(compatibilityRecord.payload) as ProfileCompatibility
  validateCompatibility(compatibility)
  if (compatibilityRecord.ownerId !== document.head.profileId
    || compatibilityRecord.parentId !== document.head.profileId) {
    fail('Profile compatibility record has the wrong owner')
  }

  const ideaRecords = owned('idea', document.head.profileId)
  const ideas = ideaRecords.map((record, ordinal) => {
    consume(record)
    if (record.parentId !== document.head.profileId || record.ordinal !== ordinal) {
      fail(`Profile Idea record ${record.recordId} has invalid containment`)
    }
    const idea = detached(record.payload) as IdeaSummary
    validateIdea(idea, `$records.${record.recordId}`)
    if (idea.id !== record.recordId) fail(`Profile Idea record ${record.recordId} has invalid identity`)
    return idea
  })
  const boards = Object.create(null) as Record<string, SavedBoard>
  const modInstances: ProfileModInstanceRecord[] = []
  const storedAssets = new Map<string, ProfileLogicalAssetPayload>()

  for (const idea of ideas) {
    const boardId = boardRecordId(idea.id)
    const boardRecord = one('board', boardId)
    if (boardRecord.ownerId !== idea.id || boardRecord.parentId !== idea.id || boardRecord.ordinal !== 0
      || !isPlainRecord(boardRecord.payload) || boardRecord.payload.version !== 1
      || !nonEmptyString(boardRecord.payload.updatedAt)
      || (boardRecord.payload.settings !== undefined
        && !isSettingsEnvelope(boardRecord.payload.settings))) {
      fail(`Profile Board record ${boardId} is invalid`)
    }
    const boardSettings = boardRecord.payload.settings as SavedBoard['settings']
    const cardRecords = owned('card', boardId)
    const cards = cardRecords.map((cardRecord, cardOrdinal) => {
      consume(cardRecord)
      if (cardRecord.parentId !== boardId || cardRecord.ordinal !== cardOrdinal || !isPlainRecord(cardRecord.payload)) {
        fail(`Profile Card record ${cardRecord.recordId} has invalid containment`)
      }
      const cardPayload = detachedForEdit(cardRecord.payload)
      const assetIds = readStringArray(cardPayload.assetIds, `${cardRecord.recordId}.assetIds`)
      delete cardPayload.assetIds
      const blockRecords = ownedByParent('block', boardId, cardRecord.recordId)
      const blocks = blockRecords.map((blockRecord, blockOrdinal) => {
        consume(blockRecord)
        if (blockRecord.ordinal !== blockOrdinal) fail(`Profile Block ${blockRecord.recordId} has invalid order`)
        const block = detached(blockRecord.payload) as Block
        validateBlock(block, `$records.${blockRecord.recordId}`)
        if (block.id !== blockRecord.recordId) fail(`Profile Block ${blockRecord.recordId} has invalid identity`)
        return block
      })
      const assets = assetIds.map((assetId, assetOrdinal) => {
        const assetRecord = one('logical-asset', assetId)
        if (assetRecord.ownerId !== boardId || assetRecord.parentId !== cardRecord.recordId
          || assetRecord.ordinal !== assetOrdinal) {
          fail(`Profile logical asset ${assetId} has invalid containment`)
        }
        const metadata = readProfileLogicalAssetPayload(assetRecord.payload)
        if (!metadata || metadata.id !== assetId) fail(`Profile logical asset ${assetId} is invalid`)
        rememberAsset(storedAssets, metadata)
        return hydrateVerifiedAsset(metadata, hydrateAsset)
      })
      const instanceRecords = ownedByParent('mod-instance', boardId, cardRecord.recordId)
      let modV2: Card['modV2']
      if (instanceRecords.length > 0) {
        if (instanceRecords.length !== 1 || instanceRecords[0]?.ordinal !== 0) {
          fail(`Profile Card ${cardRecord.recordId} has invalid Mod containment`)
        }
        const instanceRecord = consume(instanceRecords[0])
        const decoded = decodeProfileModRecord({
          kind: 'mod-instance',
          recordId: instanceRecord.recordId,
          ownerId: instanceRecord.ownerId,
          parentId: instanceRecord.parentId ?? '',
          recordVersion: instanceRecord.recordVersion,
          payload: instanceRecord.payload,
        })
        if (!decoded.ok || decoded.value.kind !== 'mod-instance') {
          fail(`Profile Mod instance ${instanceRecord.recordId} is invalid`)
        }
        modInstances.push(decoded.value)
        modV2 = detached(decoded.value.payload.mod)
      }
      const card = {
        ...cardPayload,
        blocks,
        ...(assets.length === 0 ? {} : { assets }),
        ...(modV2 === undefined ? {} : { modV2 }),
      } as Card
      validateCard(card, `$records.${cardRecord.recordId}`, validateLocalAssetBytes)
      if (card.id !== cardRecord.recordId) fail(`Profile Card ${cardRecord.recordId} has invalid identity`)
      return card
    })

    const connections = owned('connection', boardId).map((record, ordinal) => {
      consume(record)
      requireBoardChild(record, boardId, ordinal)
      const value = detached(record.payload) as Connection
      validateConnection(value, `$records.${record.recordId}`)
      if (value.id !== record.recordId) fail(`Profile Connection ${record.recordId} has invalid identity`)
      return value
    })
    const outputs = owned('output', boardId).map((outputRecord, outputOrdinal) => {
      consume(outputRecord)
      requireBoardChild(outputRecord, boardId, outputOrdinal)
      if (!isPlainRecord(outputRecord.payload)) fail(`Profile Output ${outputRecord.recordId} is invalid`)
      const outputPayload = detached(outputRecord.payload) as Omit<Output, 'versions'>
      const versions = ownedByParent('output-version', boardId, outputRecord.recordId)
        .map((versionRecord, versionOrdinal) => {
          consume(versionRecord)
          if (versionRecord.ordinal !== versionOrdinal || !isPlainRecord(versionRecord.payload)) {
            fail(`Profile Output Version ${versionRecord.recordId} has invalid containment`)
          }
          const payload = detachedForEdit(versionRecord.payload)
          const transcriptState = readContainerState(payload.transcript, `${versionRecord.recordId}.transcript`, false)
          const followUpState = readContainerState(payload.followUpThread, `${versionRecord.recordId}.followUpThread`, true)
          delete payload.transcript
          delete payload.followUpThread
          const transcript = ownedByParent('transcript-message', boardId, versionRecord.recordId)
            .map((messageRecord, ordinal) => {
              consume(messageRecord)
              if (messageRecord.ordinal !== ordinal) fail(`Transcript ${messageRecord.recordId} has invalid order`)
              const message = detached(messageRecord.payload) as TranscriptMessage
              validateTranscriptMessage(message, `$records.${messageRecord.recordId}`)
              if (message.id !== messageRecord.recordId) fail(`Transcript ${messageRecord.recordId} has invalid identity`)
              return message
            })
          const followUps = ownedByParent('follow-up-message', boardId, versionRecord.recordId)
            .map((messageRecord, ordinal) => {
              consume(messageRecord)
              if (messageRecord.ordinal !== ordinal) fail(`Follow-up ${messageRecord.recordId} has invalid order`)
              const message = detached(messageRecord.payload) as FollowUpMessage
              validateFollowUpMessage(message, `$records.${messageRecord.recordId}`)
              if (message.id !== messageRecord.recordId) fail(`Follow-up ${messageRecord.recordId} has invalid identity`)
              return message
            })
          if (!transcriptState.present && transcript.length > 0) {
            fail(`Profile Output Version ${versionRecord.recordId} hides transcript children`)
          }
          if (!followUpState.present && followUps.length > 0) {
            fail(`Profile Output Version ${versionRecord.recordId} hides follow-up children`)
          }
          const version = {
            ...payload,
            ...(transcriptState.present ? { transcript } : {}),
            ...(followUpState.present ? {
              followUpThread: {
                messages: followUps,
                ...(followUpState.collapsed === undefined ? {} : { collapsed: followUpState.collapsed }),
              },
            } : {}),
          } as OutputVersion
          validateOutputVersion(version, `$records.${versionRecord.recordId}`)
          if (version.id !== versionRecord.recordId) fail(`Profile Output Version ${versionRecord.recordId} has invalid identity`)
          return version
        })
      const output = { ...outputPayload, versions }
      validateOutput(output, `$records.${outputRecord.recordId}`)
      if (output.id !== outputRecord.recordId) fail(`Profile Output ${outputRecord.recordId} has invalid identity`)
      return output
    })
    const runs = owned('run', boardId).map((record, ordinal) => {
      consume(record)
      requireBoardChild(record, boardId, ordinal)
      const run = detached(record.payload) as unknown as RunRecord
      validateRun(run, `$records.${record.recordId}`)
      if (run.id !== record.recordId) fail(`Profile Run ${record.recordId} has invalid identity`)
      return run
    })
    const intentLog = owned('intent-event', boardId).map((record, ordinal) => {
      consume(record)
      requireBoardChild(record, boardId, ordinal)
      const event = hydrateIntentEvent(record.payload, (metadata) => {
        rememberAsset(storedAssets, metadata)
        return hydrateVerifiedAsset(metadata, hydrateAsset)
      })
      validateIntentEvent(event, `$records.${record.recordId}`, validateLocalAssetBytes)
      if (event.id !== record.recordId || (event.ideaId !== undefined && event.ideaId !== idea.id)) {
        fail(`Profile Intent event ${record.recordId} has invalid identity or ownership`)
      }
      return event
    })
    const boardSettingsRecords = owned('board-settings', boardId)
    let aiSettings: SavedBoard['aiSettings']
    if (boardSettingsRecords.length > 0) {
      if (boardSettingsRecords.length !== 1) fail(`Profile Board ${boardId} has duplicate settings`)
      const settingsRecord = consume(boardSettingsRecords[0])
      requireBoardChild(settingsRecord, boardId, 0)
      if (settingsRecord.recordId !== boardSettingsRecordId(boardId)) {
        fail(`Profile Board ${boardId} settings identity is invalid`)
      }
      const settings = detached(settingsRecord.payload)
      validateBoardSettings(settings, `$records.${settingsRecord.recordId}`)
      aiSettings = settings
    }
    const highlightTags = owned('highlight-tag', boardId).map((record, ordinal) => {
      consume(record)
      requireBoardChild(record, boardId, ordinal)
      const tag = detached(record.payload) as HighlightTag
      validateHighlightTag(tag, `$records.${record.recordId}`)
      if (tag.id !== record.recordId) fail(`Profile Highlight Tag ${record.recordId} has invalid identity`)
      return tag
    })
    const highlights = owned('highlight', boardId).map((record, ordinal) => {
      consume(record)
      requireBoardChild(record, boardId, ordinal)
      const highlight = detached(record.payload) as Highlight
      validateHighlight(highlight, `$records.${record.recordId}`)
      if (highlight.id !== record.recordId) fail(`Profile Highlight ${record.recordId} has invalid identity`)
      return highlight
    })
    const compactionSummaries = owned('compaction-summary', boardId).map((record, ordinal) => {
      consume(record)
      requireBoardChild(record, boardId, ordinal)
      const summary = detached(record.payload) as CompactionSummary
      validateCompactionSummary(summary, `$records.${record.recordId}`)
      if (record.recordId !== compactionSummaryRecordId(boardId, summary.cardId)) {
        fail(`Profile compaction summary ${record.recordId} has invalid identity`)
      }
      return summary
    })
    const board: SavedBoard = {
      version: 1,
      updatedAt: boardRecord.payload.updatedAt as string,
      cards,
      connections,
      outputs,
      runs,
      ...(intentLog.length === 0 ? {} : { intentLog }),
      ...(aiSettings === undefined ? {} : { aiSettings }),
      ...(boardSettings === undefined ? {} : { settings: detached(boardSettings) }),
      ...(highlights.length === 0 ? {} : { highlights }),
      ...(highlightTags.length === 0 ? {} : { highlightTags }),
      ...(compactionSummaries.length === 0 ? {} : { compactionSummaries }),
    }
    validateBoard(board, `$records.${boardId}`)
    boards[idea.id] = board
  }

  if (!hasOwn(boards, document.head.activeIdeaId)) fail('Profile active Idea is missing')
  const modTemplates = owned('mod-template', document.head.profileId).map((record, ordinal) => {
    consume(record)
    if (record.parentId !== document.head.profileId || record.ordinal !== ordinal) {
      fail(`Profile Mod template ${record.recordId} has invalid containment`)
    }
    const decoded = decodeProfileModRecord({
      kind: 'mod-template',
      recordId: record.recordId,
      ownerId: record.ownerId,
      parentId: record.parentId,
      recordVersion: record.recordVersion,
      payload: record.payload,
    })
    if (!decoded.ok || decoded.value.kind !== 'mod-template') {
      fail(`Profile Mod template ${record.recordId} is invalid`)
    }
    return decoded.value
  })
  const profileAgentEvents = owned('profile-agent-event', document.head.profileId)
    .map((record, ordinal): ProfileAgentEventRecord => {
      consume(record)
      if (record.parentId !== document.head.profileId || record.ordinal !== ordinal) {
        fail(`Profile Agent event ${record.recordId} has invalid containment`)
      }
      const decoded = decodeProfileAgentEventRecord({
        kind: record.kind,
        recordId: record.recordId,
        ownerId: record.ownerId,
        parentId: record.parentId,
        recordVersion: PROFILE_AGENT_EVENT_RECORD_VERSION,
        payload: record.payload,
      })
      if (!decoded.ok) fail(`Profile Agent event ${record.recordId} is invalid`)
      return decoded.value
    })
  validateProfileAgentEventSequences(profileAgentEvents)
  const profileSettings = owned('profile-setting', document.head.profileId).map((record, ordinal) => {
    consume(record)
    if (record.parentId !== document.head.profileId || record.ordinal !== ordinal) {
      fail(`Profile setting ${record.recordId} has invalid containment`)
    }
    const setting = detached(record.payload) as ProfileSettingRecord
    validateProfileSetting(setting, `$records.${record.recordId}`)
    if (setting.id !== record.recordId) fail(`Profile setting ${record.recordId} has invalid identity`)
    return setting
  })
  const migrationLedger = owned('migration-ledger-entry', document.head.profileId).map((record, ordinal) => {
    consume(record)
    if (record.parentId !== document.head.profileId || record.ordinal !== ordinal) {
      fail(`Profile migration entry ${record.recordId} has invalid containment`)
    }
    const entry = detached(record.payload) as ProfileMigrationLedgerEntry
    validateMigrationEntry(entry, `$records.${record.recordId}`)
    if (entry.id !== record.recordId) fail(`Profile migration entry ${record.recordId} has invalid identity`)
    return entry
  })

  const snapshot: ProfileLogicalSnapshot = {
    profileId: document.head.profileId,
    revision: document.head.revision,
    versions: detached(document.head.versions),
    activeIdeaId: document.head.activeIdeaId,
    ideas,
    boards,
    modTemplates,
    modInstances,
    ...(profileAgentEvents.length === 0 ? {} : { profileAgentEvents }),
    profileSettings,
    migrationLedger,
    recoveryPoints: [],
    compatibility,
  }
  validateSnapshotReferences(snapshot)
  if (consumed.size !== document.records.length) fail('Profile logical document contains an unconsumed record')

  if (roundTrip) {
    const projected = projectProfileSnapshot(snapshot, (asset) => {
      const metadata = storedAssets.get(asset.id)
      if (!metadata) fail(`Hydrated Profile asset ${asset.id} has no logical metadata`)
      const expected = toProfileLogicalAssetPayload(asset, metadata.sha256)
      if (canonicalJson(expected) !== canonicalJson(metadata)) {
        fail(`Hydrated Profile asset ${asset.id} does not match logical metadata`)
      }
      return metadata
    }, { validateLocalAssetBytes })
    if (canonicalDocument(projected) !== canonicalDocument(document)) {
      fail('Profile logical document does not round-trip canonically')
    }
  }
  return detached(snapshot)
}

export function enumerateProfileAssetDigests(candidate: unknown): readonly string[] {
  const document = validateProfileLogicalDocument(candidate)
  const digests = new Set(readProfileLogicalAssets(document.records).map((asset) => asset.sha256))
  return Object.freeze([...digests].sort())
}

export function enumerateProfileLogicalAssetIds(
  records: readonly ProfileLogicalRecordSpec[],
): readonly string[] {
  return Object.freeze(readProfileLogicalAssets(records).map((asset) => asset.id))
}

/**
 * Documents this module produced and deep-froze. Validating one of them again
 * cannot find anything new, because nothing can have changed it since. A save
 * used to hand the same document through validation up to eight times; each
 * pass rebuilt the whole Profile, and on a 1,000-Card Board that was seconds.
 */
const validatedDocuments = new WeakSet<object>()

function markValidatedProfileLogicalDocument(document: ProfileLogicalDocument): void {
  validatedDocuments.add(document)
  decodedDocuments.add(document)
}

export function validateProfileLogicalDocument(candidate: unknown): ProfileLogicalDocument {
  if (typeof candidate === 'object' && candidate !== null && validatedDocuments.has(candidate)) {
    return candidate as ProfileLogicalDocument
  }
  const document = decodeDocument(candidate)
  hydrateProfileLogicalDocument(document, (payload) => (
    hydrateProfileLogicalAsset(payload, `data:${payload.mimeType};base64,`)
  ), { validateLocalAssetBytes: false, detach: false })
  validatedDocuments.add(document)
  return document
}

const TRANSPORT_VALIDATION_ASSET_DIGEST = '0'.repeat(64)

/**
 * Reuses the authoritative logical projector as the renderer/utility transport
 * decoder. The synthetic digest validates every path-free asset field without
 * claiming that transport validation rehashes bytes.
 */
export function validateProfileSnapshotTransport(candidate: unknown): ProfileSnapshot {
  assertInertJson(candidate, '$transportSnapshot')
  const snapshot = strictClone(candidate) as ProfileSnapshot
  if (!isPlainRecord(snapshot) || !Array.isArray(snapshot.recoveryPoints)) {
    fail('Profile transport snapshot envelope is invalid')
  }
  projectProfileSnapshot(
    { ...snapshot, recoveryPoints: [] },
    (asset) => toProfileLogicalAssetPayload(asset, TRANSPORT_VALIDATION_ASSET_DIGEST),
  )
  for (const [index, point] of snapshot.recoveryPoints.entries()) {
    if (!hasExactKeys(point, ['createdAt', 'id', 'recordVersion', 'revision', 'verified'])
      || !nonEmptyString(point.id)
      || point.recordVersion !== PROFILE_CONTRACT_VERSIONS.record
      || !nonNegativeSafeInteger(point.revision)
      || typeof point.verified !== 'boolean'
      || !canonicalTimestamp(point.createdAt)) {
      fail(`Profile recovery point ${index} is invalid`)
    }
  }
  return deepFreeze(snapshot)
}

/** Validate one current renderer Board with the same deep logical rules used
 * by a full Profile, while synthesizing only the native Mod envelopes that a
 * renderer projection has not materialized yet. */
export function validateSavedBoardTransport(candidate: unknown): SavedBoard {
  assertInertJson(candidate, '$transportBoard')
  const board = strictClone(candidate) as SavedBoard
  validateBoard(board, '$transportBoard')
  const intentIdeaIds = new Set((board.intentLog ?? [])
    .map((event) => event.ideaId)
    .filter((ideaId): ideaId is string => ideaId !== undefined))
  if (intentIdeaIds.size > 1) fail('Profile transport Board contains mixed Idea history')
  const ideaId = [...intentIdeaIds][0] ?? 'transport-idea'
  const profileId = 'transport-profile'
  const boardId = boardRecordId(ideaId)
  const modInstances: ProfileModInstanceRecord[] = []
  for (const card of board.cards) {
    if (card.modV2 === undefined) continue
    const created = createDirectProfileModInstance({
      boardRecordId: boardId,
      cardId: card.id,
      instanceId: `transport-mod-instance:${card.id}`,
      createdAt: board.updatedAt,
      mod: card.modV2,
    })
    if (!created.ok) fail(`Profile transport Mod on Card ${card.id} is invalid`)
    modInstances.push(created.value)
  }
  projectProfileSnapshot({
    profileId,
    revision: 0,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: ideaId,
    ideas: [{
      id: ideaId,
      name: 'Transport validation',
      createdAt: board.updatedAt,
      updatedAt: board.updatedAt,
      lastOpenedAt: board.updatedAt,
    }],
    boards: { [ideaId]: board },
    modTemplates: [],
    modInstances,
    profileSettings: [],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }, (asset) => toProfileLogicalAssetPayload(asset, TRANSPORT_VALIDATION_ASSET_DIGEST))
  return deepFreeze(board)
}

export function validateIdeaSummaryTransport(candidate: unknown): IdeaSummary {
  assertInertJson(candidate, '$transportIdea')
  const idea = strictClone(candidate) as IdeaSummary
  validateIdea(idea, '$transportIdea')
  return deepFreeze(idea)
}

/**
 * Documents this module already decoded and froze. Decoding walks, clones and
 * freezes every record, and validation immediately hands its result to
 * hydration, which used to decode it a second time for nothing.
 */
const decodedDocuments = new WeakSet<object>()

function decodeDocument(candidate: unknown): ProfileLogicalDocument {
  if (typeof candidate === 'object' && candidate !== null && decodedDocuments.has(candidate)) {
    return candidate as ProfileLogicalDocument
  }
  assertInertJson(candidate, '$document')
  if (!hasExactKeys(candidate, ['head', 'records']) || !isPlainRecord(candidate.head)
    || !Array.isArray(candidate.records)) {
    fail('Profile logical document envelope is invalid')
  }
  if (!hasExactKeys(candidate.head, ['activeIdeaId', 'profileId', 'revision', 'versions'])
    || !nonEmptyString(candidate.head.profileId)
    || !nonEmptyString(candidate.head.activeIdeaId)
    || !nonNegativeSafeInteger(candidate.head.revision)) {
    fail('Profile logical document head is invalid')
  }
  validateVersions(candidate.head.versions)
  const records = candidate.records.map((value, index) => decodeRecord(value, index))
  const ids = new Set<string>()
  for (const record of records) {
    if (ids.has(record.recordId)) fail(`Profile logical record ID is duplicated: ${record.recordId}`)
    ids.add(record.recordId)
  }
  // `records` are already detached copies from decodeRecord, so cloning the
  // assembled document again would copy the whole Profile for nothing.
  const document = deepFreeze({
    head: strictClone(candidate.head),
    records,
  }) as unknown as ProfileLogicalDocument
  decodedDocuments.add(document)
  return document
}

function decodeRecord(value: unknown, index: number): ProfileLogicalRecordSpec {
  if (!hasExactKeys(value, [
    'kind',
    'ordinal',
    'ownerId',
    'parentId',
    'payload',
    'recordId',
    'recordVersion',
  ])) fail(`Profile logical record ${index} envelope is invalid`)
  if (!nonEmptyString(value.recordId) || !nonEmptyString(value.ownerId)
    || (value.parentId !== null && !nonEmptyString(value.parentId))
    || !nonNegativeSafeInteger(value.ordinal) || !isProjectedKind(value.kind)) {
    fail(`Profile logical record ${index} identity is invalid`)
  }
  if (value.recordVersion !== PROFILE_CONTRACT_VERSIONS.record) {
    fail(`Profile logical record ${value.recordId} version is unsupported`)
  }
  return strictClone(value) as ProfileLogicalRecordSpec
}

function record(
  recordId: string,
  kind: ProjectedRecordKind,
  ownerId: string,
  parentId: string | null,
  ordinal: number,
  payload: unknown,
): ProfileLogicalRecordSpec {
  if (!nonEmptyString(recordId) || !nonEmptyString(ownerId)
    || (parentId !== null && !nonEmptyString(parentId)) || !nonNegativeSafeInteger(ordinal)) {
    fail(`Profile ${kind} record identity is invalid`)
  }
  assertInertJson(payload, `$record.${recordId}.payload`)
  return {
    recordId,
    kind,
    ownerId,
    parentId,
    ordinal,
    recordVersion: PROFILE_CONTRACT_VERSIONS.record,
    payload: strictClone(payload) as ProfileJsonValue,
  }
}

function cardPayloadWithoutAuthorship(payload: Record<string, unknown>): Record<string, unknown> {
  const clone = strictClone(payload) as Record<string, unknown>
  delete clone.createdBy
  delete clone.lastModifiedBy
  return clone
}

function validateSnapshotEnvelope(snapshot: ProfileLogicalSnapshot): void {
  if (!nonEmptyString(snapshot.profileId) || !nonNegativeSafeInteger(snapshot.revision)
    || !nonEmptyString(snapshot.activeIdeaId) || !Array.isArray(snapshot.ideas)
    || !isPlainRecord(snapshot.boards) || !Array.isArray(snapshot.modTemplates)
    || !Array.isArray(snapshot.modInstances)
    || (snapshot.profileAgentEvents !== undefined && !Array.isArray(snapshot.profileAgentEvents))
    || !Array.isArray(snapshot.profileSettings)
    || !Array.isArray(snapshot.migrationLedger) || !Array.isArray(snapshot.recoveryPoints)) {
    fail('Profile snapshot envelope is invalid')
  }
  validateVersions(snapshot.versions)
  validateCompatibility(snapshot.compatibility)
  if (snapshot.recoveryPoints.length !== 0) {
    fail('Profile recovery points are owned by the recovery module, not logical projection')
  }
}

function validateSnapshotReferences(snapshot: ProfileLogicalSnapshot): void {
  if (!snapshot.ideas.some((idea) => idea.id === snapshot.activeIdeaId)) fail('Profile active Idea is missing')
  for (const idea of snapshot.ideas) {
    const board = ownValue(snapshot.boards, idea.id)
    if (!board) fail(`Profile Board is missing for Idea ${idea.id}`)
    const cardsById = new Map(board.cards.map((card) => [card.id, card]))
    const cardIds = new Set(cardsById.keys())
    const tagIds = new Set((board.highlightTags ?? []).map((tag) => tag.id))
    for (const card of board.cards) {
      if (card.groupId !== undefined
        && (card.groupId === card.id || cardsById.get(card.groupId)?.kind !== 'group')) {
        fail(`Profile Card ${card.id} has a dangling group`)
      }
    }
    for (const connection of board.connections) {
      if (!cardIds.has(connection.from.cardId) || !cardIds.has(connection.to.cardId)) {
        fail(`Profile Connection ${connection.id} has a dangling Card endpoint`)
      }
    }
    for (const output of board.outputs) {
      if (!cardIds.has(output.resultCardId)) fail(`Profile Output ${output.id} has a dangling result Card`)
      if (output.chosenVersionId !== undefined
        && !output.versions.some((version) => version.id === output.chosenVersionId)) {
        fail(`Profile Output ${output.id} has a dangling chosen Version`)
      }
    }
    for (const highlight of board.highlights ?? []) {
      if (!cardIds.has(highlight.cardId) || !tagIds.has(highlight.tagId)) {
        fail(`Profile Highlight ${highlight.id} has a dangling Card or Tag`)
      }
    }
  }
}

function validateBoard(board: SavedBoard, path: string): void {
  if (!isPlainRecord(board) || !hasOnlyKeys(board, STRICT_CONTENT_SURFACE.keys.board)
    || board.version !== 1 || !canonicalTimestamp(board.updatedAt)
    || !Array.isArray(board.cards) || !Array.isArray(board.connections)
    || !Array.isArray(board.outputs) || !Array.isArray(board.runs)
    || (board.intentLog !== undefined && !Array.isArray(board.intentLog))
    || (board.highlights !== undefined && !Array.isArray(board.highlights))
    || (board.highlightTags !== undefined && !Array.isArray(board.highlightTags))
    || (board.compactionSummaries !== undefined && !Array.isArray(board.compactionSummaries))) {
    fail(`${path} is not a current SavedBoard`)
  }
  if (board.visualDecayEnabled !== undefined) fail(`${path}.visualDecayEnabled is retired`)
  if (board.aiSettings !== undefined) validateBoardSettings(board.aiSettings, `${path}.aiSettings`)
  if (board.settings !== undefined && !isSettingsEnvelope(board.settings)) {
    fail(`${path}.settings is not a current settings envelope`)
  }
}

// The Idea gets the same tolerated envelope, on the same terms and at the same
// one-time cost as the Board's. The key list moves from `hasExactKeys` to
// `hasOnlyKeys` to allow it: that is not a loosening, because every one of the
// five content fields is still required by its own value check below. Only the
// settings envelope is optional.
function validateIdea(idea: IdeaSummary, path: string): void {
  if (!isPlainRecord(idea)
    || !hasOnlyKeys(idea, STRICT_CONTENT_SURFACE.keys.idea)
    || !nonEmptyString(idea.id) || typeof idea.name !== 'string'
    || !canonicalTimestamp(idea.createdAt) || !canonicalTimestamp(idea.updatedAt)
    || !canonicalTimestamp(idea.lastOpenedAt)
    || (idea.settings !== undefined && !isSettingsEnvelope(idea.settings))) {
    fail(`${path} is not a current Idea`)
  }
}

function validateCard(card: Card, path: string, validateLocalAssetBytes = true): void {
  if (!isPlainRecord(card) || !hasOnlyKeys(card, STRICT_CONTENT_SURFACE.keys.card)
    || !nonEmptyString(card.id) || !CARD_KINDS.has(card.kind)
    || (card.createdBy !== undefined && !isCardAuthorship(card.createdBy))
    || (card.lastModifiedBy !== undefined && !isCardAuthorship(card.lastModifiedBy))
    || !Array.isArray(card.blocks) || !isPoint(card.position)
    || (card.assets !== undefined && !Array.isArray(card.assets))
    || (card.linkPreview !== undefined && (card.kind !== 'note' || !isLinkPreview(card.linkPreview)))
    || (card.localHtmlPreview !== undefined
      && (card.kind !== 'note' || !isLocalHtmlPreview(card.localHtmlPreview)))
    || (card.linkPreview !== undefined && card.localHtmlPreview !== undefined)
    || (card.title !== undefined && typeof card.title !== 'string')
    || (card.headerColor !== undefined && typeof card.headerColor !== 'string')
    || (card.headerFill !== undefined
      && !isOneOf(card.headerFill, STRICT_CONTENT_SURFACE.closedValues.cardHeaderFill))
    || (card.compressionPrompt !== undefined && typeof card.compressionPrompt !== 'string')
    || (card.model !== undefined && !nonEmptyString(card.model))
    || (card.conversationStyle !== undefined
      && !isOneOf(card.conversationStyle, STRICT_CONTENT_SURFACE.closedValues.cardConversationStyle))
    || (card.conversationTurns !== undefined && !positiveSafeInteger(card.conversationTurns))
    || (legacyCardFontSize(card) !== undefined
      && !isOneOf(legacyCardFontSize(card), STRICT_CONTENT_SURFACE.closedValues.cardLegacyFontSize))
    || (card.source !== undefined && !isCardSource(card.source))
    || (card.agentic !== undefined && typeof card.agentic !== 'boolean')
    || (card.zIndex !== undefined && !finiteNumber(card.zIndex))
    || (card.size !== undefined && !isSize(card.size))
    || (card.groupId !== undefined && !nonEmptyString(card.groupId))
    // `meta` is the Card's settings envelope (settingsEnvelope.ts). It is
    // checked for its container shape and nothing else: an unknown key or a
    // value from a build this one has never met is a preference, never a
    // corrupt Card. Only a container that is not a plain object fails closed.
    || (card.meta !== undefined && !isSettingsEnvelope(card.meta))) fail(`${path} is not a current Card`)
  card.blocks.forEach((block, index) => validateBlock(block, `${path}.blocks[${index}]`))
  ;(card.assets ?? []).forEach((asset, index) => validateCardAsset(asset, `${path}.assets[${index}]`))
  if (card.localHtmlPreview?.assetId !== undefined) {
    const previewAsset = card.assets?.find((asset) => asset.id === card.localHtmlPreview?.assetId)
    if (!previewAsset
      || !isLocalHtmlPreviewStaticImageMetadata(previewAsset)
      || (validateLocalAssetBytes && !isLocalHtmlPreviewStaticImage(previewAsset))) {
      fail(`${path}.localHtmlPreview has no matching static image asset`)
    }
  }
  if (ownValue(card as unknown as Record<string, unknown>, 'mod') !== undefined) {
    fail(`${path}.mod is a retired legacy Mod payload`)
  }
  if (card.modV2 !== undefined) validateCardMod(card.modV2, `${path}.modV2`)
}

function validateBlock(block: Block, path: string): void {
  if (!isPlainRecord(block) || !hasOnlyKeys(block, STRICT_CONTENT_SURFACE.keys.block)
    || !nonEmptyString(block.id) || typeof block.text !== 'string'
    || (block.kind !== undefined
      && !isOneOf(block.kind, STRICT_CONTENT_SURFACE.closedValues.blockKind))) {
    fail(`${path} is not a current Block`)
  }
}

function validateCardAsset(asset: CardAsset, path: string): void {
  if (!isPlainRecord(asset) || !nonEmptyString(asset.id) || !['image', 'file'].includes(asset.kind)
    || !nonEmptyString(asset.name) || !nonEmptyString(asset.mimeType) || !nonEmptyString(asset.dataUrl)
    || !nonNegativeSafeInteger(asset.size) || !nonEmptyString(asset.createdAt)) {
    fail(`${path} is not a current Card asset`)
  }
}

function validateConnection(connection: Connection, path: string): void {
  if (!isPlainRecord(connection) || !hasOnlyKeys(connection, STRICT_CONTENT_SURFACE.keys.connection)
    || !nonEmptyString(connection.id)
    || !validAnchor(connection.from) || !validAnchor(connection.to)
    || !isOneOf(connection.strength, STRICT_CONTENT_SURFACE.closedValues.connectionStrength)
    || !isOneOf(connection.polarity, STRICT_CONTENT_SURFACE.closedValues.connectionPolarity)
    || !isOneOf(connection.role, STRICT_CONTENT_SURFACE.closedValues.connectionRole)
    || (connection.reason !== undefined && typeof connection.reason !== 'string')
    || (connection.meta !== undefined && (!isPlainRecord(connection.meta)
      || (connection.meta.contextOrder !== undefined && !finiteNumber(connection.meta.contextOrder))
      || (connection.meta.groupMode !== undefined
        && !isOneOf(connection.meta.groupMode, STRICT_CONTENT_SURFACE.closedValues.connectionGroupMode))))) {
    fail(`${path} is not a current Connection`)
  }
}

function validateOutput(output: Output, path: string): void {
  if (!isPlainRecord(output) || !hasOnlyKeys(output, STRICT_CONTENT_SURFACE.keys.output)
    || !nonEmptyString(output.id) || !nonEmptyString(output.resultCardId)
    || !Array.isArray(output.versions)
    || (output.chosenVersionId !== undefined && !nonEmptyString(output.chosenVersionId))) {
    fail(`${path} is not a current Output`)
  }
  output.versions.forEach((version, index) => validateOutputVersion(version, `${path}.versions[${index}]`))
}

function validateOutputVersion(version: OutputVersion, path: string): void {
  if (!isPlainRecord(version) || !hasOnlyKeys(version, STRICT_CONTENT_SURFACE.keys.outputVersion)
    || !nonEmptyString(version.id) || !positiveSafeInteger(version.number)
    || typeof version.text !== 'string' || !canonicalTimestamp(version.createdAt)
    || !nonEmptyString(version.fromRunId)
    || (version.digestKey !== undefined && !nonEmptyString(version.digestKey))
    || (version.accepted !== undefined && typeof version.accepted !== 'boolean')
    || (version.transcript !== undefined && !Array.isArray(version.transcript))
    || (version.provisional !== undefined && typeof version.provisional !== 'boolean')
    || (version.provisionalReason !== undefined
      && !isOneOf(version.provisionalReason, STRICT_CONTENT_SURFACE.closedValues.outputVersionProvisionalReason))
    || (version.provisionalMessage !== undefined && typeof version.provisionalMessage !== 'string')
    || (version.followUpThread !== undefined
      && (!isPlainRecord(version.followUpThread)
        || !hasOnlyKeys(version.followUpThread, STRICT_CONTENT_SURFACE.keys.followUpThread)
        || !Array.isArray(version.followUpThread.messages)
        || (version.followUpThread.collapsed !== undefined
          && typeof version.followUpThread.collapsed !== 'boolean')))
    || (version.sourceContext !== undefined && !validSourceContext(version.sourceContext))
    || (version.sourceChangeDismissedSignature !== undefined
      && !nonEmptyString(version.sourceChangeDismissedSignature))) {
    fail(`${path} is not a current Output Version`)
  }
  ;(version.transcript ?? []).forEach((message, index) => (
    validateTranscriptMessage(message, `${path}.transcript[${index}]`)
  ))
  ;(version.followUpThread?.messages ?? []).forEach((message, index) => (
    validateFollowUpMessage(message, `${path}.followUpThread.messages[${index}]`)
  ))
}

function validateTranscriptMessage(message: TranscriptMessage, path: string): void {
  if (!isPlainRecord(message) || !hasOnlyKeys(message, STRICT_CONTENT_SURFACE.keys.transcriptMessage)
    || !nonEmptyString(message.id)
    || !isOneOf(message.speakerKind, STRICT_CONTENT_SURFACE.closedValues.transcriptSpeakerKind)
    || !nonEmptyString(message.speakerName)
    || (message.participantCardId !== undefined && !nonEmptyString(message.participantCardId))
    || typeof message.text !== 'string'
    || (message.turnNumber !== undefined && !positiveSafeInteger(message.turnNumber))
    || (message.streaming !== undefined && typeof message.streaming !== 'boolean')) {
    fail(`${path} is not a current transcript message`)
  }
}

function validateFollowUpMessage(message: FollowUpMessage, path: string): void {
  if (!isPlainRecord(message)
    || !hasOnlyKeys(message, STRICT_CONTENT_SURFACE.keys.followUpMessage)
    || !nonEmptyString(message.id)
    || !isOneOf(message.role, STRICT_CONTENT_SURFACE.closedValues.followUpMessageRole)
    || typeof message.text !== 'string' || !canonicalTimestamp(message.createdAt)
    || !isOneOf(message.status, STRICT_CONTENT_SURFACE.closedValues.followUpMessageStatus)
    || !validToolSteps(message.toolSteps)) {
    fail(`${path} is not a current follow-up message`)
  }
}

function validateRun(run: RunRecord, path: string): void {
  if (!isPlainRecord(run) || !hasOnlyKeys(run, [
    'id',
    'startedAt',
    'finishedAt',
    'askAiCardId',
    'model',
    'provider',
    'usedCardIds',
    'usedConnectionIds',
    'usedGroupDigests',
    'modIds',
    'appliedMods',
    'compiledInstruction',
    'producedVersionId',
    'status',
    'triggeredBy',
    'aiAccessPhases',
    'errorMessage',
    'kind',
    'conversation',
    'contextBudget',
    'plan',
    'toolSteps',
    'agentic',
  ]) || !nonEmptyString(run.id) || !canonicalTimestamp(run.startedAt)
    || (run.finishedAt !== undefined && !canonicalTimestamp(run.finishedAt))
    || !nonEmptyString(run.askAiCardId) || !nonEmptyString(run.model)
    || (run.provider !== undefined
      && !PERSISTED_PROVIDER_IDS.includes(run.provider as string))
    || !isStringArray(run.usedCardIds) || !isStringArray(run.usedConnectionIds)
    || (run.usedGroupDigests !== undefined && (!Array.isArray(run.usedGroupDigests)
      || run.usedGroupDigests.some((digest) => !isPlainRecord(digest)
        || !hasExactKeys(digest, ['groupCardId', 'versionId', 'connectionId'])
        || !nonEmptyString(digest.groupCardId) || !nonEmptyString(digest.versionId)
        || !nonEmptyString(digest.connectionId))))
    || !isStringArray(run.modIds) || !Array.isArray(run.appliedMods)
    || run.appliedMods.some((applied) => !validAppliedMod(applied))
    || typeof run.compiledInstruction !== 'string'
    || (run.producedVersionId !== undefined && !nonEmptyString(run.producedVersionId))
    || !['running', 'done', 'failed', 'canceled'].includes(run.status)
    || (run.triggeredBy !== undefined && (!isPlainRecord(run.triggeredBy)
      || !hasExactKeys(run.triggeredBy, ['kind', 'client', 'sessionId'])
      || run.triggeredBy.kind !== 'agent' || !nonEmptyString(run.triggeredBy.client)
      || !nonEmptyString(run.triggeredBy.sessionId)))
    || (run.aiAccessPhases !== undefined && (!Array.isArray(run.aiAccessPhases)
      || run.aiAccessPhases.length < 1
      || run.aiAccessPhases.length > 100
      || run.aiAccessPhases.some((phase) => parseProviderRouteProvenance(phase) === undefined)))
    || (run.errorMessage !== undefined && typeof run.errorMessage !== 'string')
    || (run.kind !== undefined && !['ask', 'groupDigest', 'conversation'].includes(run.kind))
    || (run.conversation !== undefined && !validConversationProvenance(run.conversation))
    || (run.contextBudget !== undefined && !validRunContextBudget(run.contextBudget))
    || (run.plan !== undefined && !validExecutionPlan(run.plan))
    || (run.agentic !== undefined && run.agentic !== true)
    || !validToolSteps(run.toolSteps)) fail(`${path} is not a current Run`)
}

// A step's kind is checked for shape, not for membership (ADR 0035). The key
// set stays closed, so nothing unknown rides in; the vocabulary stays open, so
// steps recorded by a later build open here instead of taking the whole Profile
// down with them. One function, because a run and a follow-up record the same
// thing and must never disagree about what it looks like.
function validToolSteps(value: unknown): boolean {
  if (value === undefined) return true
  return Array.isArray(value) && value.every((step) => isPlainRecord(step)
    && hasOnlyKeys(step, ['kind', 'detail', 'title'])
    && nonEmptyString(step.kind)
    && typeof step.detail === 'string'
    && (step.title === undefined || typeof step.title === 'string'))
}

function validateCardMod(value: Card['modV2'], path: string): void {
  if (!validateProfileModDocumentTransport(value).ok) fail(`${path} is not a current Mod`)
}

function validSourceContext(value: unknown): boolean {
  return hasExactKeys(value, ['version', 'sources'])
    && value.version === 1
    && Array.isArray(value.sources)
    && value.sources.every((source) => (
      hasOnlyKeys(source, ['cardId', 'kind', 'label', 'groupMode', 'hash'])
      && nonEmptyString(source.cardId)
      && CARD_KINDS.has(source.kind as Card['kind'])
      && typeof source.label === 'string'
      && nonEmptyString(source.hash)
      && (source.groupMode === undefined || ['full', 'compress'].includes(source.groupMode as string))
    ))
}

function validAppliedMod(value: unknown): boolean {
  if (!hasOnlyKeys(value, [
    'modVersion', 'modCardId', 'participantCardId', 'controlValues', 'appliedInstructions',
  ])
    || !nonEmptyString(value.modCardId)
    || (value.participantCardId !== undefined && !nonEmptyString(value.participantCardId))
    || !isStringArray(value.appliedInstructions)) return false

  if (value.modVersion === undefined) {
    return hasOnlyKeys(value, [
      'modCardId', 'participantCardId', 'controlValues', 'appliedInstructions',
    ]) && isPlainRecord(value.controlValues)
  }
  if (value.modVersion !== 2 || !hasExactKeys(value.controlValues, ['schema', 'kind', 'state'])
    || value.controlValues.schema !== 'mod-v2') return false
  return validateProfileModDocumentTransport({
    kind: value.controlValues.kind,
    title: '',
    accent: 'transport-validation',
    state: value.controlValues.state,
    treatOverride: null,
  }).ok
}

function validConversationProvenance(value: unknown): boolean {
  if (!hasExactKeys(value, ['settings', 'participants', 'sharedContext', 'topLevelMods', 'turns'])
    || !hasExactKeys(value.settings, ['topic', 'style', 'turnsPerParticipant'])
    || typeof value.settings.topic !== 'string'
    || !['debate', 'critique', 'interview', 'collaborate'].includes(value.settings.style as string)
    || !positiveSafeInteger(value.settings.turnsPerParticipant)
    || !Array.isArray(value.participants) || !Array.isArray(value.sharedContext)
    || !Array.isArray(value.topLevelMods) || !Array.isArray(value.turns)) return false
  if (value.participants.some((participant) => (
    !hasOnlyKeys(participant, ['cardId', 'name', 'model', 'role', 'participantMods'])
    || !nonEmptyString(participant.cardId) || !nonEmptyString(participant.name)
    || !nonEmptyString(participant.model) || typeof participant.role !== 'string'
    || (participant.participantMods !== undefined
      && (!Array.isArray(participant.participantMods)
        || participant.participantMods.some((mod) => !validConversationMod(mod))))
  ))) return false
  if (value.sharedContext.some((context) => (
    !hasExactKeys(context, ['cardId', 'label', 'text'])
    || !nonEmptyString(context.cardId) || typeof context.label !== 'string' || typeof context.text !== 'string'
  ))) return false
  if (value.topLevelMods.some((mod) => !validConversationMod(mod))) return false
  return value.turns.every((turn) => (
    hasExactKeys(turn, ['speakerName', 'participantCardId', 'currentTurn', 'totalTurns', 'instruction'])
    && nonEmptyString(turn.speakerName) && nonEmptyString(turn.participantCardId)
    && positiveSafeInteger(turn.currentTurn) && positiveSafeInteger(turn.totalTurns)
    && Number(turn.currentTurn) <= Number(turn.totalTurns) && typeof turn.instruction === 'string'
  ))
}

function validConversationMod(value: unknown): boolean {
  return hasExactKeys(value, ['cardId', 'label', 'instructions'])
    && nonEmptyString(value.cardId) && typeof value.label === 'string'
    && isStringArray(value.instructions)
}

function validRunContextBudget(value: unknown): boolean {
  return hasExactKeys(value, [
    'budgetTokens',
    'estimatedTokens',
    'finalTokens',
    'compactedCardIds',
    'droppedCardIds',
    'mode',
  ])
    && nonNegativeSafeInteger(value.budgetTokens)
    && nonNegativeSafeInteger(value.estimatedTokens)
    && nonNegativeSafeInteger(value.finalTokens)
    && isStringArray(value.compactedCardIds)
    && isStringArray(value.droppedCardIds)
    && ['never', 'when-needed', 'eager'].includes(value.mode as string)
}

function validExecutionPlan(value: unknown): boolean {
  return hasExactKeys(value, ['version', 'rootCardId', 'steps'])
    && value.version === 1
    && nonEmptyString(value.rootCardId)
    && Array.isArray(value.steps)
    && value.steps.every((step) => (
      hasOnlyKeys(step, ['id', 'kind', 'cardId', 'dependsOn', 'connectionId', 'contextPolicy'])
      && nonEmptyString(step.id)
      && ['ask', 'groupDigest'].includes(step.kind as string)
      && nonEmptyString(step.cardId)
      && isStringArray(step.dependsOn)
      && (step.connectionId === undefined || nonEmptyString(step.connectionId))
      && (step.contextPolicy === undefined || (
        hasExactKeys(step.contextPolicy, ['name', 'version'])
        && nonEmptyString(step.contextPolicy.name)
        && positiveSafeInteger(step.contextPolicy.version)
      ))
    ))
}

function validateIntentEvent(
  event: IntentLogEvent,
  path: string,
  validateLocalAssetBytes = true,
): void {
  if (!isPlainRecord(event) || !nonEmptyString(event.id) || !canonicalTimestamp(event.at)
    || !INTENT_EVENT_TYPES.has(event.type) || !isPlainRecord(event.data)
    || (event.ideaId !== undefined && !nonEmptyString(event.ideaId))
    || (event.commitId !== undefined && !nonEmptyString(event.commitId))
    || (event.actorId !== undefined && !nonEmptyString(event.actorId))
    || (event.clientTxnId !== undefined && !nonEmptyString(event.clientTxnId))
    || (event.seq !== undefined && !nonNegativeSafeInteger(event.seq))) {
    fail(`${path} is not a current Intent event`)
  }
  const invalid = () => fail(`${path} Intent event payload is invalid for ${event.type}`)
  switch (event.type) {
    case 'card.created':
    case 'group.created': {
      if (!hasIntentKeys(event, ['cardId']) || !nonEmptyString(event.cardId)
        || !hasOnlyKeys(event.data, event.type === 'card.created'
          ? ['card', 'sourceCardId', 'claimedTransitionEvidence']
          : ['card', 'memberChanges'])
        || !isPlainRecord(event.data.card) || event.data.card.id !== event.cardId
        || (event.type === 'card.created' && event.data.sourceCardId !== undefined
          && !nonEmptyString(event.data.sourceCardId))
        || (event.type === 'card.created'
          && !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence))) invalid()
      validateCard(event.data.card, `${path}.data.card`, validateLocalAssetBytes)
      if (event.type === 'group.created' && event.data.memberChanges !== undefined
        && !validMemberChanges(event.data.memberChanges)) invalid()
      return
    }
    case 'card.deleted': {
      if (!hasIntentKeys(event, ['cardId']) || !nonEmptyString(event.cardId)
        || !hasOnlyKeys(event.data, [
          'card', 'connections', 'memberIds', 'outputs', 'claimedTransitionEvidence',
        ])
        || !isPlainRecord(event.data.card)
        || event.data.card.id !== event.cardId || !Array.isArray(event.data.connections)
        || (event.data.memberIds !== undefined
          && !isStringArray(event.data.memberIds))
        || (event.data.outputs !== undefined && !Array.isArray(event.data.outputs))
        || !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence)) invalid()
      validateCard(event.data.card, `${path}.data.card`, validateLocalAssetBytes)
      event.data.connections.forEach((connection, index) => (
        validateConnection(connection, `${path}.data.connections[${index}]`)
      ))
      ;(event.data.outputs ?? []).forEach((output, index) => {
        validateOutput(output, `${path}.data.outputs[${index}]`)
        output.versions.forEach((version, versionIndex) => (
          validateOutputVersion(version, `${path}.data.outputs[${index}].versions[${versionIndex}]`)
        ))
      })
      return
    }
    case 'card.moved':
      if (!hasIntentKeys(event, ['cardId']) || !nonEmptyString(event.cardId)
        || !hasOnlyKeys(event.data, ['moves', 'claimedTransitionEvidence'])
        || !Array.isArray(event.data.moves)
        || event.data.moves.some((move) => !hasOnlyKeys(move, [
          'cardId', 'from', 'to', 'previousGroupId', 'nextGroupId',
        ]) || !nonEmptyString(move.cardId)
          || !isPoint(move.from) || !isPoint(move.to)
          || (move.previousGroupId !== undefined && !nonEmptyString(move.previousGroupId))
          || (move.nextGroupId !== undefined && !nonEmptyString(move.nextGroupId)))
        || !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence)) invalid()
      return
    case 'card.resized':
      if (!hasIntentKeys(event, ['cardId']) || !nonEmptyString(event.cardId)
        || !hasOnlyKeys(event.data, ['from', 'to', 'claimedTransitionEvidence'])
        || (event.data.from !== undefined && !isSize(event.data.from))
        || (event.data.to !== undefined && !isSize(event.data.to))
        || !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence)) invalid()
      return
    case 'cards.arranged':
      if (!hasIntentKeys(event, ['cardId']) || !nonEmptyString(event.cardId)
        || !hasOnlyKeys(event.data, ['changes', 'claimedTransitionEvidence'])
        || !validCardsArrangedChanges(event.data.changes)
        || event.data.changes[0]?.cardId !== event.cardId
        || !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence)) invalid()
      return
    case 'card.layer.changed':
      if (!hasIntentKeys(event, ['cardId']) || !nonEmptyString(event.cardId)
        || !hasOnlyKeys(event.data, ['direction', 'changes', 'claimedTransitionEvidence'])
        || !['front', 'back'].includes(event.data.direction)
        || !validCardLayerChanges(event.data.changes)
        || event.data.changes[0]?.cardId !== event.cardId
        || !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence)) invalid()
      return
    case 'card.content.edited':
      if (!hasIntentKeys(event, ['cardId']) || !nonEmptyString(event.cardId)
        || !validCardContentEditedData(event.data)) invalid()
      return
    case 'group.members.changed':
      if (!hasIntentKeys(event, ['cardId']) || !nonEmptyString(event.cardId)
        || !hasOnlyKeys(event.data, ['memberChanges', 'claimedTransitionEvidence'])
        || !validMemberChanges(event.data.memberChanges)
        || !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence)) invalid()
      return
    case 'connection.created':
    case 'connection.deleted':
      if (!hasIntentKeys(event, ['connectionId']) || !nonEmptyString(event.connectionId)
        || !hasOnlyKeys(event.data, ['connection', 'claimedTransitionEvidence'])
        || !isPlainRecord(event.data.connection)
        || event.data.connection.id !== event.connectionId
        || !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence)) invalid()
      validateConnection(event.data.connection, `${path}.data.connection`)
      return
    case 'connection.changed':
      if (!hasIntentKeys(event, ['connectionId']) || !nonEmptyString(event.connectionId)
        || !hasOnlyKeys(event.data, ['before', 'after', 'claimedTransitionEvidence'])
        || !isPlainRecord(event.data.before)
        || !isPlainRecord(event.data.after) || event.data.before.id !== event.connectionId
        || event.data.after.id !== event.connectionId
        || !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence)) invalid()
      validateConnection(event.data.before, `${path}.data.before`)
      validateConnection(event.data.after, `${path}.data.after`)
      return
    case 'run.started':
    case 'run.continued':
    case 'run.completed':
    case 'run.failed':
    case 'run.canceled':
      if (!hasIntentKeys(event, ['runId']) || !nonEmptyString(event.runId)
        || !hasOnlyKeys(event.data, ['run', 'message']) || !isPlainRecord(event.data.run)
        || event.data.run.id !== event.runId
        || (event.data.message !== undefined && typeof event.data.message !== 'string')) invalid()
      validateRun(event.data.run, `${path}.data.run`)
      return
    case 'group.compression.started':
    case 'group.compression.completed':
    case 'group.compression.failed':
    case 'group.compression.canceled':
      if (!hasIntentKeys(event, ['cardId', 'runId', 'versionId'])
        || !nonEmptyString(event.cardId) || !nonEmptyString(event.runId)
        || (event.versionId !== undefined && !nonEmptyString(event.versionId))
        || !hasOnlyKeys(event.data, ['run', 'message'])
        || !isPlainRecord(event.data.run) || event.data.run.id !== event.runId
        || (event.data.message !== undefined && typeof event.data.message !== 'string')) invalid()
      validateRun(event.data.run, `${path}.data.run`)
      return
    case 'version.chosen':
      if (!hasIntentKeys(event, ['versionId']) || !nonEmptyString(event.versionId)
        || !hasOnlyKeys(event.data, [
          'outputId', 'previousVersionId', 'nextVersionId', 'claimedTransitionEvidence',
        ])
        || !nonEmptyString(event.data.outputId)
        || !nonEmptyString(event.data.nextVersionId) || event.data.nextVersionId !== event.versionId
        || (event.data.previousVersionId !== undefined && !nonEmptyString(event.data.previousVersionId))
        || !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence)) invalid()
      return
    case 'version.acceptance.changed':
      if (!hasIntentKeys(event, ['versionId']) || !nonEmptyString(event.versionId)
        || !hasOnlyKeys(event.data, ['outputId', 'from', 'to', 'claimedTransitionEvidence'])
        || !nonEmptyString(event.data.outputId)
        || typeof event.data.from !== 'boolean'
        || typeof event.data.to !== 'boolean'
        || event.data.from === event.data.to
        || !validOptionalClaimedTransitionEvidence(event.data.claimedTransitionEvidence)) invalid()
      return
    case 'version.note.created':
      if (!hasIntentKeys(event, ['versionId', 'cardId'])
        || !nonEmptyString(event.versionId) || !nonEmptyString(event.cardId)
        || !hasOnlyKeys(event.data, [
          'outputId', 'resultCardId', 'noteCardId', 'source', 'sourceMessageId', 'textLength',
        ])
        || !nonEmptyString(event.data.noteCardId)
        || !['version', 'followup', 'conversation'].includes(event.data.source)
        || (event.data.outputId !== undefined && !nonEmptyString(event.data.outputId))
        || (event.data.resultCardId !== undefined && !nonEmptyString(event.data.resultCardId))
        || (event.data.sourceMessageId !== undefined && !nonEmptyString(event.data.sourceMessageId))
        || !nonNegativeSafeInteger(event.data.textLength)) invalid()
      return
    case 'followup.message.added':
    case 'followup.message.finished':
      if (!hasIntentKeys(event, ['versionId']) || !nonEmptyString(event.versionId)
        || !hasOnlyKeys(event.data, ['outputId', 'resultCardId', 'message'])
        || (event.data.outputId !== undefined && !nonEmptyString(event.data.outputId))
        || (event.data.resultCardId !== undefined && !nonEmptyString(event.data.resultCardId))
        || !isPlainRecord(event.data.message)) invalid()
      validateFollowUpMessage(event.data.message, `${path}.data.message`)
      return
    case 'followup.thread.cleared':
      if (!hasIntentKeys(event, ['versionId']) || !nonEmptyString(event.versionId)
        || !hasOnlyKeys(event.data, ['outputId', 'resultCardId', 'previousMessages'])
        || (event.data.outputId !== undefined && !nonEmptyString(event.data.outputId))
        || (event.data.resultCardId !== undefined && !nonEmptyString(event.data.resultCardId))
        || !Array.isArray(event.data.previousMessages)) invalid()
      event.data.previousMessages.forEach((message, index) => (
        validateFollowUpMessage(message, `${path}.data.previousMessages[${index}]`)
      ))
      return
  }
}

function hasIntentKeys(event: IntentLogEvent, extra: readonly string[]): boolean {
  return hasOnlyKeys(event, [
    'id', 'at', 'ideaId', 'commitId', 'actorId', 'clientTxnId', 'seq', 'type', 'data', ...extra,
  ])
}

function validMemberChanges(value: unknown): boolean {
  if (!isPlainRecord(value)) return false
  return Object.entries(value).every(([cardId, change]) => (
    nonEmptyString(cardId)
    && hasOnlyKeys(change, ['from', 'to'])
    && (change.from === undefined || nonEmptyString(change.from))
    && (change.to === undefined || nonEmptyString(change.to))
  ))
}

// The provider names a Profile on disk may legitimately hold. Written out
// rather than read from the app's provider list on purpose: this is a wire
// contract, and a retired name stays readable here long after the app stops
// offering it. 'gemini' is retired (the Gemini CLI is deprecated) and is read
// only so an older Profile still opens.
//
// This list now serves the RUN record only. A Run says which provider actually
// answered, which is content by ADR 0040's definition and stays fail-closed. A
// Board's `aiSettings.provider` says which provider to use NEXT, which is a
// setting, and its accepted names are declared once in graph/boardAiSettings.ts.
const PERSISTED_PROVIDER_IDS: readonly string[] = [
  'openrouter', 'claude-code', 'codex', 'antigravity', 'gemini',
]

// `aiSettings` is the Board's settings envelope (graph/boardAiSettings.ts). It
// is checked for its container shape and NOTHING ELSE.
//
// It used to be checked key by key, against a closed key list and closed value
// sets for `provider`, `reasoningEffort`, and `compactionMode`. That made every
// growth of the bag a downgrade break, and the bag grew twice (commits 8352bb65
// and 190d3753): the build before each of those refused the Board, and a
// refused Board is reported as a corrupt Profile revision, so an unfamiliar
// reasoning rung cost a person every Board they owned. ADR 0040 forbids exactly
// that. The values are resolved at read time instead, where an unrecognised one
// costs a default and nothing else.
//
// Only rule 3 survives here: a container that is not a plain object is
// corruption of a container, not an unrecognised setting.
function validateBoardSettings(
  value: unknown,
  path: string,
): asserts value is NonNullable<SavedBoard['aiSettings']> {
  if (!isSettingsEnvelope(value)) fail(`${path} is not a current Board settings envelope`)
}

function validateHighlightTag(tag: HighlightTag, path: string): void {
  if (!isPlainRecord(tag) || !hasExactKeys(tag, ['id', 'name', 'color', 'createdAt'])
    || !nonEmptyString(tag.id) || !nonEmptyString(tag.name)
    || !nonEmptyString(tag.color) || !canonicalTimestamp(tag.createdAt)) {
    fail(`${path} is not a current Highlight Tag`)
  }
}

function validateHighlight(highlight: Highlight, path: string): void {
  if (!isPlainRecord(highlight) || !hasExactKeys(highlight, [
    'id', 'cardId', 'tagId', 'text', 'occurrence', 'createdAt',
  ]) || !nonEmptyString(highlight.id) || !nonEmptyString(highlight.cardId)
    || !nonEmptyString(highlight.tagId) || typeof highlight.text !== 'string'
    || !nonNegativeSafeInteger(highlight.occurrence) || !canonicalTimestamp(highlight.createdAt)) {
    fail(`${path} is not a current Highlight`)
  }
}

function validateCompactionSummary(summary: CompactionSummary, path: string): void {
  if (!isPlainRecord(summary) || !hasExactKeys(summary, [
    'cardId', 'fingerprint', 'summary', 'model', 'createdAt',
  ]) || !nonEmptyString(summary.cardId) || !nonEmptyString(summary.fingerprint)
    || typeof summary.summary !== 'string' || !nonEmptyString(summary.model)
    || !canonicalTimestamp(summary.createdAt)) fail(`${path} is not a current compaction summary`)
}

function validateProfileSetting(setting: ProfileSettingRecord, path: string): void {
  if (!isPlainRecord(setting) || !hasExactKeys(setting, [
    'id', 'recordVersion', 'classification', 'value',
  ]) || !nonEmptyString(setting.id)
    || setting.recordVersion !== PROFILE_SETTING_RECORD_VERSION
    || setting.classification !== 'portable-profile' || !hasOwn(setting, 'value')) {
    fail(`${path} is not a current Profile setting`)
  }
}

function validateMigrationEntry(entry: ProfileMigrationLedgerEntry, path: string): void {
  if (!isPlainRecord(entry) || !hasExactKeys(entry, [
    'id',
    'recordVersion',
    'source',
    'sourceVersion',
    'targetVersion',
    'completedAt',
    'sourceRetained',
  ]) || !nonEmptyString(entry.id)
    || entry.recordVersion !== PROFILE_CONTRACT_VERSIONS.record
    || !['eido-v3', 'friends-alpha'].includes(entry.source)
    || !positiveSafeInteger(entry.sourceVersion) || !positiveSafeInteger(entry.targetVersion)
    || !canonicalTimestamp(entry.completedAt) || entry.sourceRetained !== true) {
    fail(`${path} is not a current migration entry`)
  }
}

function validateCompatibility(value: ProfileCompatibility): void {
  if (!isPlainRecord(value) || !hasExactKeys(value, ['read', 'write', 'source'])
    || value.read !== 'supported' || value.write !== 'supported'
    || value.source !== 'friends-alpha') fail('Profile compatibility is invalid')
}

function validateVersions(value: unknown): asserts value is ProfileContractVersions {
  if (!isPlainRecord(value) || canonicalJson(value) !== canonicalJson(PROFILE_CONTRACT_VERSIONS)) {
    fail('Profile versions are unsupported')
  }
}

function projectIntentEvent(
  event: IntentLogEvent,
  projectAsset: (asset: CardAsset, path: string) => ProfileLogicalAssetPayload,
  validateLocalAssetBytes = true,
): ProfileJsonValue {
  const clone = strictClone(event) as unknown as Record<string, unknown>
  if (!HISTORICAL_CARD_EVENT_TYPES.has(event.type)) return clone as ProfileJsonValue
  const data = clone.data
  if (!isPlainRecord(data) || !isPlainRecord(data.card)) fail(`Profile Intent event ${event.id} Card is invalid`)
  const card = data.card as unknown as Card
  validateCard(card, `$intent.${event.id}.data.card`, validateLocalAssetBytes)
  const storedCard = strictClone(card) as unknown as Record<string, unknown>
  if (card.assets !== undefined) {
    storedCard.assets = card.assets.map((asset, index) => projectAsset(asset, `$intent.${event.id}.data.card.assets[${index}]`))
  }
  data.card = storedCard
  return clone as ProfileJsonValue
}

function hydrateIntentEvent(
  value: unknown,
  hydrateAsset: (payload: ProfileLogicalAssetPayload) => CardAsset,
): IntentLogEvent {
  if (!isPlainRecord(value) || !nonEmptyString(value.type) || !nonEmptyString(value.id)
    || !isPlainRecord(value.data)) fail('Profile Intent event payload is invalid')
  const clone = strictClone(value) as Record<string, unknown>
  if (!HISTORICAL_CARD_EVENT_TYPES.has(value.type as IntentLogEvent['type'])) return clone as IntentLogEvent
  const data = clone.data as Record<string, unknown>
  if (!isPlainRecord(data.card)) fail(`Profile Intent event ${value.id} Card is invalid`)
  const card = data.card as Record<string, unknown>
  if (card.assets !== undefined) {
    if (!Array.isArray(card.assets)) fail(`Profile Intent event ${value.id} assets are invalid`)
    card.assets = card.assets.map((asset) => {
      const metadata = readProfileLogicalAssetPayload(asset)
      if (!metadata) fail(`Profile Intent event ${value.id} contains invalid asset metadata`)
      return hydrateAsset(metadata)
    })
  }
  data.card = card
  clone.data = data
  return clone as IntentLogEvent
}

function storedIntentAssets(value: unknown): ProfileLogicalAssetPayload[] {
  if (!isPlainRecord(value) || !HISTORICAL_CARD_EVENT_TYPES.has(value.type as IntentLogEvent['type'])
    || !isPlainRecord(value.data) || !isPlainRecord(value.data.card)) return []
  const assets = value.data.card.assets
  if (assets === undefined) return []
  if (!Array.isArray(assets)) fail(`Profile Intent event ${String(value.id)} assets are invalid`)
  return assets.map((asset) => {
    const metadata = readProfileLogicalAssetPayload(asset)
    if (!metadata) fail(`Profile Intent event ${String(value.id)} asset metadata is invalid`)
    return metadata
  })
}

function hydrateVerifiedAsset(
  metadata: ProfileLogicalAssetPayload,
  hydrateAsset: ProfileAssetHydrator,
): CardAsset {
  const asset = hydrateAsset(metadata)
  assertInertJson(asset, `$asset.${metadata.id}`)
  validateCardAsset(asset, `$asset.${metadata.id}`)
  const expected = toProfileLogicalAssetPayload(asset, metadata.sha256)
  if (canonicalJson(expected) !== canonicalJson(metadata)) {
    fail(`Hydrated Profile asset ${metadata.id} does not match logical metadata`)
  }
  return strictClone(asset)
}

function rememberAsset(
  assets: Map<string, ProfileLogicalAssetPayload>,
  metadata: ProfileLogicalAssetPayload,
): void {
  const previous = assets.get(metadata.id)
  if (previous && canonicalJson(previous) !== canonicalJson(metadata)) {
    fail(`Profile logical asset ${metadata.id} changes identity across current or historical state`)
  }
  assets.set(metadata.id, metadata)
}

function readProfileLogicalAssets(
  records: readonly ProfileLogicalRecordSpec[],
): readonly ProfileLogicalAssetPayload[] {
  const assets = new Map<string, ProfileLogicalAssetPayload>()
  for (const record of records) {
    if (record.kind === 'logical-asset') {
      const metadata = readProfileLogicalAssetPayload(record.payload)
      if (!metadata) fail(`Profile logical asset ${record.recordId} is invalid`)
      rememberAsset(assets, metadata)
    }
    if (record.kind === 'intent-event') {
      for (const metadata of storedIntentAssets(record.payload)) rememberAsset(assets, metadata)
    }
  }
  return [...assets.values()].sort((left, right) => (
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  ))
}

function readContainerState(
  value: unknown,
  path: string,
  allowCollapsed: boolean,
): { present: boolean; collapsed?: boolean } {
  if (!isPlainRecord(value) || typeof value.present !== 'boolean'
    || Object.keys(value).some((key) => key !== 'present' && (key !== 'collapsed' || !allowCollapsed))
    || (value.collapsed !== undefined && typeof value.collapsed !== 'boolean')) {
    fail(`${path} container state is invalid`)
  }
  return {
    present: value.present,
    ...(value.collapsed === undefined ? {} : { collapsed: value.collapsed }),
  }
}

function validateRecordOrdinals(records: readonly ProfileLogicalRecordSpec[]): void {
  const groups = new Map<string, ProfileLogicalRecordSpec[]>()
  for (const record of records) {
    const key = collectionKey(record)
    const group = groups.get(key) ?? []
    group.push(record)
    groups.set(key, group)
  }
  for (const group of groups.values()) {
    const ordinals = group.map((record) => record.ordinal).sort((left, right) => left - right)
    if (ordinals.some((ordinal, index) => ordinal !== index)) {
      fail(`Profile ${group[0]?.kind ?? 'record'} ordinals are duplicated or non-contiguous`)
    }
  }
}

function validateProfileAgentEventSequences(
  events: readonly ProfileAgentEventRecord[],
): void {
  let previousSequence: number | undefined
  for (const event of events) {
    if (previousSequence !== undefined && event.payload.seq <= previousSequence) {
      fail('Profile Agent event sequences must be strictly increasing in owner order')
    }
    previousSequence = event.payload.seq
  }
}

function collectionKey(record: ProfileLogicalRecordSpec): string {
  switch (record.kind) {
    case 'board':
    case 'block':
    case 'logical-asset':
    case 'mod-instance':
    case 'output-version':
    case 'transcript-message':
    case 'follow-up-message':
      return `${record.kind}:${record.parentId ?? ''}`
    default:
      return `${record.kind}:${record.ownerId}`
  }
}

function requireBoardChild(record: ProfileLogicalRecordSpec, boardId: string, ordinal: number): void {
  if (record.parentId !== boardId || record.ordinal !== ordinal) {
    fail(`Profile ${record.kind} record ${record.recordId} has invalid Board containment`)
  }
}

function canonicalDocument(document: ProfileLogicalDocument): string {
  return canonicalJson({
    head: document.head,
    records: [...document.records].sort((left, right) => left.recordId.localeCompare(right.recordId)),
  })
}

function canonicalJson(value: unknown): string {
  assertInertJson(value, '$canonical')
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isPlainRecord(value)) return value
  const result = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value).sort()) result[key] = sortJson(value[key])
  return result
}

function assertInertJson(value: unknown, path: string, ancestors = new WeakSet<object>()): void {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail(`${path} contains a lossy JSON number`)
    return
  }
  if (typeof value !== 'object') fail(`${path} contains a non-JSON value`)
  if (ancestors.has(value)) fail(`${path} contains a cycle`)
  ancestors.add(value)
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail(`${path} has a non-standard array prototype`)
    if (Object.getOwnPropertySymbols(value).length > 0) fail(`${path} contains a symbol key`)
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== value.length + 1
      || names.some((name) => name !== 'length'
        && (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= value.length))) {
      fail(`${path} contains a sparse or extended array`)
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor)) fail(`${path}[${index}] is executable`)
      assertInertJson(descriptor.value, `${path}[${index}]`, ancestors)
    }
    ancestors.delete(value)
    return
  }
  if (!isPlainRecord(value)) fail(`${path} contains a non-plain object`)
  if (Object.getOwnPropertySymbols(value).length > 0) fail(`${path} contains a symbol key`)
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor)) fail(`${path}.${key} is not inert JSON data`)
    assertInertJson(descriptor.value, `${path}.${key}`, ancestors)
  }
  ancestors.delete(value)
}

function strictClone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deepFreeze(entry)
  return Object.freeze(value)
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  return isPlainRecord(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',')
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

// Membership in a closed value set from STRICT_CONTENT_SURFACE. It takes
// `unknown` so a pinned set stays a plain list of strings at its declaration
// instead of needing a cast at every call site.
function isOneOf(value: unknown, allowed: readonly string[]): boolean {
  return typeof value === 'string' && allowed.includes(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function ownValue<Value>(value: Record<string, Value>, key: string): Value | undefined {
  return hasOwn(value, key) ? value[key] : undefined
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function isProjectedKind(value: unknown): value is ProjectedRecordKind {
  return typeof value === 'string'
    && value !== 'recovery-point'
    && [
      'profile', 'idea', 'board', 'card', 'block', 'connection', 'output', 'output-version', 'run',
      'transcript-message', 'follow-up-message', 'intent-event', 'logical-asset', 'board-settings',
      'highlight', 'highlight-tag', 'compaction-summary', 'mod-template', 'mod-instance',
      'profile-agent-event', 'compatibility-state', 'migration-ledger-entry', 'profile-setting',
    ].includes(value)
}

function validAnchor(value: unknown): boolean {
  return hasOnlyKeys(value, ['cardId', 'blockId']) && nonEmptyString(value.cardId)
    && (value.blockId === undefined || nonEmptyString(value.blockId))
}

function isPoint(value: unknown): boolean {
  return hasExactKeys(value, ['x', 'y']) && finiteNumber(value.x) && finiteNumber(value.y)
}

function isSize(value: unknown): boolean {
  return hasExactKeys(value, ['width', 'height']) && finiteNumber(value.width) && finiteNumber(value.height)
    && Number(value.width) > 0 && Number(value.height) > 0
}

// A note's web provenance: where the text was read from and when. `title` is
// optional because a page without a usable one is still a legitimate source.
// The retired top-level Note scale. The Card type no longer declares it, so
// the read goes through a cast: a Profile written before the scale moved into
// the settings envelope still carries the field, and this validator still
// holds it to the union it shipped with.
function legacyCardFontSize(card: Card): unknown {
  return (card as { fontSize?: unknown }).fontSize
}

function isCardSource(value: unknown): boolean {
  return isPlainRecord(value)
    && hasOnlyKeys(value, ['url', 'retrievedAt', 'title'])
    && nonEmptyString(value.url)
    && canonicalTimestamp(value.retrievedAt)
    && (value.title === undefined || typeof value.title === 'string')
}

function validCardsArrangedChanges(value: unknown): value is Array<{
  cardId: string
  before: { position: Card['position']; size?: Card['size']; groupId?: string }
  after: { position: Card['position']; size?: Card['size']; groupId?: string }
}> {
  if (!Array.isArray(value) || value.length === 0) return false
  const cardIds = new Set<string>()
  return value.every((change) => {
    if (!hasExactKeys(change, ['cardId', 'before', 'after'])
      || !nonEmptyString(change.cardId)
      || cardIds.has(change.cardId)
      || !validCardArrangementState(change.before)
      || !validCardArrangementState(change.after)
      || canonicalJson(change.before) === canonicalJson(change.after)) return false
    cardIds.add(change.cardId)
    return true
  })
}

function validCardArrangementState(value: unknown): value is {
  position: Card['position']
  size?: Card['size']
  groupId?: string
} {
  return hasOnlyKeys(value, ['position', 'size', 'groupId'])
    && isPoint(value.position)
    && (value.size === undefined || isSize(value.size))
    && (value.groupId === undefined || nonEmptyString(value.groupId))
}

function validCardLayerChanges(value: unknown): value is Array<{
  cardId: string
  from?: number
  to: number
}> {
  if (!Array.isArray(value) || value.length === 0) return false
  const cardIds = new Set<string>()
  return value.every((change) => {
    if (!hasOnlyKeys(change, ['cardId', 'from', 'to'])
      || !nonEmptyString(change.cardId)
      || cardIds.has(change.cardId)
      || (change.from !== undefined && !finiteNumber(change.from))
      || !finiteNumber(change.to)
      || change.from === change.to) return false
    cardIds.add(change.cardId)
    return true
  })
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => nonEmptyString(entry))
}

function readStringArray(value: unknown, path: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some((entry) => !nonEmptyString(entry))
    || new Set(value).size !== value.length) fail(`${path} is invalid`)
  return [...value] as string[]
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function validOptionalContentSha256(value: unknown): boolean {
  return value === undefined || (typeof value === 'string' && /^[0-9a-f]{64}$/.test(value))
}

function validCardContentEditedData(value: unknown): boolean {
  if (!isPlainRecord(value)
    || ![
      'body', 'title', 'groupPrompt', 'modControl', 'conversationSettings', 'model', 'identity',
      'assets',
    ].includes(value.field as string)
    || !validOptionalClaimedTransitionEvidence(value.claimedTransitionEvidence)) return false
  if (value.field === 'assets') {
    return hasOnlyKeys(value, ['field', 'action', 'assetId', 'claimedTransitionEvidence'])
      && ['add', 'remove'].includes(value.action as string)
      && nonEmptyString(value.assetId)
  }
  if (value.field === 'model' || value.field === 'identity') {
    return hasOnlyKeys(value, ['field', 'claimedTransitionEvidence'])
  }
  return hasOnlyKeys(value, [
    'field', 'textLength', 'contentSha256', 'claimedTransitionEvidence',
  ])
    && (value.textLength === undefined || nonNegativeSafeInteger(value.textLength))
    && validOptionalContentSha256(value.contentSha256)
}

function validOptionalClaimedTransitionEvidence(value: unknown): boolean {
  return value === undefined || (isPlainRecord(value)
    && hasExactKeys(value, ['version', 'count', 'sha256'])
    && value.version === 1
    && nonNegativeSafeInteger(value.count)
    && typeof value.sha256 === 'string'
    && /^[0-9a-f]{64}$/.test(value.sha256))
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0)
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function byOrdinal(left: ProfileLogicalRecordSpec, right: ProfileLogicalRecordSpec): number {
  return left.ordinal - right.ordinal || left.recordId.localeCompare(right.recordId)
}

function boardRecordId(ideaId: string): string {
  return `board:${ideaId}`
}

function compatibilityRecordId(profileId: string): string {
  return `compatibility:${profileId}`
}

function boardSettingsRecordId(boardId: string): string {
  return `board-settings:${boardId}`
}

function compactionSummaryRecordId(boardId: string, cardId: string): string {
  return `compaction-summary:${boardId}:${cardId}`
}

function fail(message: string): never {
  throw new ProfileLogicalProjectionError(message)
}
