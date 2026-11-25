import { createSourceContextSnapshot, sourceChangeStatus } from '../brain/sourceContext'
import type {
  AppliedMod,
  Card,
  CardAsset,
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
import { listModPartIdentities, remapModPartIdentities } from '../mods/identity'
import {
  hydrateProfileLogicalAsset,
  readProfileLogicalAssetPayload,
  toProfileLogicalAssetPayload,
  type ProfileLogicalAssetPayload,
} from './profileAssetKernel'
import {
  hydrateProfileLogicalDocument,
  projectProfileSnapshot,
  type ProfileAssetProjector,
  type ProfileAssetHydrator,
  type ProfileLogicalDocument,
} from './profileLogicalProjection'
import {
  extractProfileIdeaClosure,
  hydrateProfileIdeaClosure,
  PROFILE_IDEA_REMAP_V1_LIMITS,
  ProfileIdeaClosureError,
} from './profileIdeaClosure'
import {
  createDirectProfileModInstance,
  type ProfileModDocument,
  type ProfileModInstanceRecord,
} from './profileModRecords'
import {
  PROFILE_CONTRACT_VERSIONS,
  type ProfileSnapshot,
} from './profileServiceContract'

export const PROFILE_IDEA_IDENTITY_KINDS = Object.freeze([
  'idea',
  'board',
  'board-settings',
  'card',
  'block',
  'logical-asset',
  'mod-instance',
  'mod-control',
  'connection',
  'output',
  'output-version',
  'transcript-message',
  'follow-up-message',
  'run',
  'execution-step',
  'intent-event',
  'highlight-tag',
  'highlight',
  'compaction-summary',
] as const)

export type ProfileIdeaIdentityKind = (typeof PROFILE_IDEA_IDENTITY_KINDS)[number]

export type ProfileIdeaIdentityAllocation = Readonly<{
  kind: ProfileIdeaIdentityKind
  sourceId: string
  defined: boolean
}>

export type ProfileIdeaIdentityAllocator = (
  identity: ProfileIdeaIdentityAllocation,
) => string

export type ProfileIdeaIdentityMapping = Readonly<{
  kind: ProfileIdeaIdentityKind
  sourceId: string
  targetId: string
  defined: boolean
}>

export type ProfileIdeaIdentityRemapResult = Readonly<{
  document: ProfileLogicalDocument
  identityMap: readonly ProfileIdeaIdentityMapping[]
}>

export class ProfileIdeaIdentityRemapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProfileIdeaIdentityRemapError'
  }
}

export function remapProfileIdea(input: Readonly<{
  sourceDocument: unknown
  sourceIdeaId: string
  destinationDocument: unknown
  targetIdea: IdeaSummary
  /** Hydrates verified source bytes because freshness fingerprints include asset data. */
  hydrateSourceAsset: ProfileAssetHydrator
  allocateIdentity: ProfileIdeaIdentityAllocator
}>): ProfileIdeaIdentityRemapResult {
  const sourceClosure = extractProfileIdeaClosure(input.sourceDocument, input.sourceIdeaId)
  const hydratedSource = hydrateProfileIdeaClosure(sourceClosure, input.hydrateSourceAsset)
  const source = {
    document: hydratedSource.document,
    snapshot: hydratedSource.snapshot,
    assets: hydratedSource.assets,
  }
  const destination = readLogicalProfile(input.destinationDocument, 'destination')
  assertInertJson(input.targetIdea, '$targetIdea')
  const targetIdea = cloneJson(input.targetIdea)
  if (!nonEmptyString(input.sourceIdeaId) || !nonEmptyString(targetIdea.id)) {
    fail('Profile Idea source or target identity is invalid')
  }
  if (targetIdea.id === input.sourceIdeaId) fail('Profile Idea remap requires a fresh target Idea identity')
  if (destination.snapshot.ideas.some((idea) => idea.id === targetIdea.id)) {
    fail(`Destination Profile already contains Idea ${targetIdea.id}`)
  }

  const sourceIdea = source.snapshot.ideas.find((idea) => idea.id === input.sourceIdeaId)
  const sourceBoard = source.snapshot.boards[input.sourceIdeaId]
  if (!sourceIdea || !sourceBoard) fail(`Source Profile does not contain Idea ${input.sourceIdeaId}`)
  const sourceBoardId = boardRecordId(sourceIdea.id)
  const sourceInstances = source.snapshot.modInstances.filter((instance) => instance.ownerId === sourceBoardId)

  const collector = new IdentityCollector()
  collector.apply('idea', sourceIdea.id, 'definition')
  transformBoard(sourceBoard, collector)
  sourceInstances.forEach((instance) => transformModInstance(instance, sourceBoardId, collector))

  const sourceReserved = new Set<string>([
    ...source.document.records.map((record) => record.recordId),
    ...collector.entries().map((entry) => entry.sourceId),
  ])
  const preservedModSourceIds = readPreservedModSourceIds(sourceInstances)
  preservedModSourceIds.forEach((id) => sourceReserved.add(id))

  const destinationReserved = readCompleteReservedIds(destination)
  const targetBoardId = boardRecordId(targetIdea.id)
  const occupied = new Set<string>([
    ...sourceReserved,
    ...destinationReserved,
    ...preservedModSourceIds,
  ])
  reserveFresh(targetIdea.id, occupied, 'target Idea')
  occupied.add(targetIdea.id)
  reserveFresh(targetBoardId, occupied, 'target Board')
  occupied.add(targetBoardId)
  const targetSettingsId = boardSettingsRecordId(targetBoardId)
  reserveFresh(targetSettingsId, occupied, 'target Board settings')
  occupied.add(targetSettingsId)

  const mappings = new Map<string, ProfileIdeaIdentityMapping>()
  rememberMapping(mappings, {
    kind: 'idea',
    sourceId: sourceIdea.id,
    targetId: targetIdea.id,
    defined: true,
  })
  rememberMapping(mappings, {
    kind: 'board',
    sourceId: sourceBoardId,
    targetId: targetBoardId,
    defined: true,
  })
  if (sourceBoard.aiSettings !== undefined) {
    rememberMapping(mappings, {
      kind: 'board-settings',
      sourceId: boardSettingsRecordId(sourceBoardId),
      targetId: targetSettingsId,
      defined: true,
    })
  }

  for (const identity of collector.entries()) {
    if (identity.kind === 'idea') continue
    const targetId = input.allocateIdentity(identity)
    if (!nonEmptyString(targetId) || targetId === identity.sourceId) {
      fail(`Allocator did not produce a fresh ${identity.kind} identity for ${identity.sourceId}`)
    }
    if (occupied.has(targetId)) {
      fail(`Allocator produced reserved or duplicated identity ${targetId}`)
    }
    occupied.add(targetId)
    rememberMapping(mappings, { ...identity, targetId })
  }

  const mapper = new IdentityMapper(mappings)
  for (const summary of sourceBoard.compactionSummaries ?? []) {
    const sourceId = compactionSummaryRecordId(sourceBoardId, summary.cardId)
    const targetId = compactionSummaryRecordId(targetBoardId, mapper.apply('card', summary.cardId, 'reference'))
    if (occupied.has(targetId)) fail(`Derived compaction-summary identity collides: ${targetId}`)
    occupied.add(targetId)
    rememberMapping(mappings, {
      kind: 'compaction-summary',
      sourceId,
      targetId,
      defined: true,
    })
  }

  const targetBoard = transformBoard(sourceBoard, mapper)
  rebaseSourceFreshness(sourceBoard, targetBoard)
  const targetInstances = sourceInstances.map((instance) => (
    transformModInstance(instance, targetBoardId, mapper)
  ))
  const assets = new Map(destination.assets)
  for (const [sourceAssetId, metadata] of source.assets) {
    if (!mapper.has('logical-asset', sourceAssetId)) continue
    const targetAssetId = mapper.apply('logical-asset', sourceAssetId, 'definition')
    if (assets.has(targetAssetId)) fail(`Remapped logical asset collides: ${targetAssetId}`)
    assets.set(targetAssetId, Object.freeze({ ...metadata, id: targetAssetId }))
  }

  const boards = Object.create(null) as Record<string, SavedBoard>
  for (const [ideaId, board] of Object.entries(destination.snapshot.boards)) boards[ideaId] = cloneJson(board)
  boards[targetIdea.id] = targetBoard
  const merged: ProfileSnapshot = {
    ...cloneJson(destination.snapshot),
    activeIdeaId: targetIdea.id,
    ideas: [...cloneJson(destination.snapshot.ideas), targetIdea],
    boards,
    modInstances: [...cloneJson(destination.snapshot.modInstances), ...targetInstances],
    recoveryPoints: [],
  }

  let document: ProfileLogicalDocument
  try {
    document = projectProfileSnapshot(merged, assetProjector(assets), {
      validateLocalAssetBytes: false,
    })
    hydrateProfileLogicalDocument(document, placeholderAssetHydrator, {
      validateLocalAssetBytes: false,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown logical projection failure'
    fail(`Remapped Profile failed complete logical validation: ${message}`)
  }
  return Object.freeze({
    document,
    identityMap: Object.freeze([...mappings.values()].sort(compareMappings)),
  })
}

export function preflightLegacyProfileIdeaRemap(input: Readonly<{
  sourceIdea: unknown
  sourceBoard: unknown
  importedAt: string
}>): Readonly<{
  uniqueDecodedAssetBytes: number
  hydratedDataUrlCodeUnits: number
}> {
  const assetsById = new Map<string, CardAsset>()
  const contentsByMime = new Map<string, Map<string, Readonly<{
    digest: string
    size: number
  }>>>()
  let nextDigest = 1
  let uniqueDecodedAssetBytes = 0
  let hydratedDataUrlCodeUnits = 0
  projectLegacyProfileIdeaSource({
    ...input,
    cloneSource: false,
    projectAsset: (asset) => {
      const { encoded, decodedSize } = readCanonicalLegacyAssetData(asset)
      const previousAsset = assetsById.get(asset.id)
      if (previousAsset && !sameLegacyAsset(previousAsset, asset)) {
        fail(`Legacy Idea asset ${asset.id} changes metadata`)
      }
      if (!previousAsset) {
        assetsById.set(asset.id, asset)
        hydratedDataUrlCodeUnits += asset.dataUrl.length
      }
      let contents = contentsByMime.get(asset.mimeType)
      if (!contents) {
        contents = new Map()
        contentsByMime.set(asset.mimeType, contents)
      }
      let content = contents.get(encoded)
      if (!content) {
        content = Object.freeze({
          digest: (nextDigest++).toString(16).padStart(64, '0'),
          size: decodedSize,
        })
        contents.set(encoded, content)
        uniqueDecodedAssetBytes += decodedSize
      }
      if (content.size !== decodedSize) fail('Legacy Idea asset bytes change size')
      if (uniqueDecodedAssetBytes > PROFILE_IDEA_REMAP_V1_LIMITS.maxUniqueDecodedAssetBytes
        || hydratedDataUrlCodeUnits > PROFILE_IDEA_REMAP_V1_LIMITS.maxHydratedDataUrlCodeUnits) {
        throw new ProfileIdeaClosureError(
          'idea-remap-too-large',
          'Legacy Idea asset closure exceeds the v1 remap hydration bound',
        )
      }
      return toProfileLogicalAssetPayload(asset, content.digest)
    },
  })
  return Object.freeze({ uniqueDecodedAssetBytes, hydratedDataUrlCodeUnits })
}

export function remapLegacyProfileIdea(input: Readonly<{
  sourceIdea: unknown
  sourceBoard: unknown
  destinationDocument: unknown
  targetIdea: IdeaSummary
  importedAt: string
  projectAsset: ProfileAssetProjector
  allocateIdentity: ProfileIdeaIdentityAllocator
}>): ProfileIdeaIdentityRemapResult {
  const source = projectLegacyProfileIdeaSource({
    sourceIdea: input.sourceIdea,
    sourceBoard: input.sourceBoard,
    importedAt: input.importedAt,
    projectAsset: input.projectAsset,
    cloneSource: true,
  })
  return remapProfileIdea({
    sourceDocument: source.document,
    sourceIdeaId: source.idea.id,
    destinationDocument: input.destinationDocument,
    targetIdea: input.targetIdea,
    hydrateSourceAsset: legacyCurrentAssetHydrator(source.board),
    allocateIdentity: input.allocateIdentity,
  })
}

function projectLegacyProfileIdeaSource(input: Readonly<{
  sourceIdea: unknown
  sourceBoard: unknown
  importedAt: string
  projectAsset: ProfileAssetProjector
  cloneSource: boolean
}>): Readonly<{
  idea: IdeaSummary
  board: SavedBoard
  document: ProfileLogicalDocument
}> {
  assertInertJson(input.sourceIdea, '$legacy.idea')
  assertInertJson(input.sourceBoard, '$legacy.board')
  if (!isPlainRecord(input.sourceIdea) || !isPlainRecord(input.sourceBoard)) {
    fail('Legacy Idea and Board must be current-schema objects')
  }
  const sourceIdea = (input.cloneSource ? cloneJson(input.sourceIdea) : input.sourceIdea) as IdeaSummary
  const sourceBoardCandidate = (
    input.cloneSource ? cloneJson(input.sourceBoard) : input.sourceBoard
  ) as SavedBoard
  const sourceBoardId = boardRecordId(String(sourceIdea.id))
  const modInstances: ProfileModInstanceRecord[] = []
  if (!Array.isArray(sourceBoardCandidate.cards)) fail('Legacy Idea Board is not a current SavedBoard')
  const sourceBoard = stripRetiredLegacyCardMods(sourceBoardCandidate)
  for (const card of sourceBoard.cards) {
    if (card.modV2 === undefined) continue
    const result = createDirectProfileModInstance({
      boardRecordId: sourceBoardId,
      cardId: card.id,
      instanceId: legacySourceModInstanceRecordId(sourceIdea.id, card.id),
      createdAt: input.importedAt,
      mod: card.modV2,
    })
    if (!result.ok) fail(`Imported Mod cannot become an honest direct instance: ${result.message}`)
    modInstances.push(result.value)
  }
  const sourceSnapshot: ProfileSnapshot = {
    profileId: `profile:legacy-import:${String(sourceIdea.id)}`,
    revision: 0,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: sourceIdea.id,
    ideas: [sourceIdea],
    boards: { [sourceIdea.id]: sourceBoard },
    modTemplates: [],
    modInstances,
    profileSettings: [],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
  let sourceDocument: ProfileLogicalDocument
  try {
    sourceDocument = projectProfileSnapshot(sourceSnapshot, input.projectAsset)
  } catch (error) {
    if (error instanceof ProfileIdeaClosureError) throw error
    const message = error instanceof Error ? error.message : 'unknown logical projection failure'
    fail(`Legacy Idea does not satisfy the current logical schema: ${message}`)
  }
  return Object.freeze({ idea: sourceIdea, board: sourceBoard, document: sourceDocument })
}

function stripRetiredLegacyCardMods(board: SavedBoard): SavedBoard {
  const stripCard = (card: Card): Card => {
    const { mod: _retiredLegacyMod, ...currentCard } = card as unknown as Record<string, unknown>
    return currentCard as Card
  }
  const cards = board.cards.map(stripCard)
  if (board.intentLog === undefined) return { ...board, cards }
  const intentLog = board.intentLog.map((event): IntentLogEvent => {
    switch (event.type) {
      case 'card.created':
        return {
          ...event,
          data: { ...event.data, card: stripCard(event.data.card) },
        }
      case 'group.created':
        return {
          ...event,
          data: { ...event.data, card: stripCard(event.data.card) },
        }
      case 'card.deleted':
        return {
          ...event,
          data: { ...event.data, card: stripCard(event.data.card) },
        }
      default:
        return event
    }
  })
  return { ...board, cards, intentLog }
}

function readCanonicalLegacyAssetData(asset: CardAsset): Readonly<{
  encoded: string
  decodedSize: number
}> {
  if (typeof asset.dataUrl !== 'string' || typeof asset.mimeType !== 'string') {
    fail('Legacy Idea asset data URL is invalid')
  }
  const match = /^data:([^;,]+);base64,([A-Za-z0-9+/]*={0,2})$/.exec(asset.dataUrl)
  if (!match || match[1] !== asset.mimeType || match[2]!.length % 4 !== 0) {
    fail('Legacy Idea asset data URL is invalid')
  }
  const encoded = match[2]!
  const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0
  const dataLength = encoded.length - padding
  if (padding > 0) {
    const value = base64Value(encoded[dataLength - 1]!)
    if (value < 0 || padding === 2 && (value & 0x0f) !== 0
      || padding === 1 && (value & 0x03) !== 0) {
      fail('Legacy Idea asset data URL is not canonical base64')
    }
  }
  const decodedSize = encoded.length / 4 * 3 - padding
  if (!Number.isSafeInteger(decodedSize) || decodedSize < 0 || decodedSize !== asset.size) {
    fail('Legacy Idea asset bytes do not match metadata')
  }
  return Object.freeze({ encoded, decodedSize })
}

function base64Value(character: string): number {
  const code = character.charCodeAt(0)
  if (code >= 65 && code <= 90) return code - 65
  if (code >= 97 && code <= 122) return code - 97 + 26
  if (code >= 48 && code <= 57) return code - 48 + 52
  if (character === '+') return 62
  if (character === '/') return 63
  return -1
}

function sameLegacyAsset(left: CardAsset, right: CardAsset): boolean {
  return left.id === right.id
    && left.kind === right.kind
    && left.name === right.name
    && left.mimeType === right.mimeType
    && left.dataUrl === right.dataUrl
    && left.size === right.size
    && left.createdAt === right.createdAt
}

type IdentityRole = 'definition' | 'reference'

type IdentityTransformer = {
  apply(kind: ProfileIdeaIdentityKind, sourceId: string, role: IdentityRole): string
}

class IdentityCollector implements IdentityTransformer {
  private readonly identities = new Map<string, ProfileIdeaIdentityAllocation>()
  private readonly recordKinds = new Map<string, ProfileIdeaIdentityKind>()

  apply(kind: ProfileIdeaIdentityKind, sourceId: string, role: IdentityRole): string {
    if (!nonEmptyString(sourceId)) fail(`Encountered an invalid ${kind} identity`)
    if (isLogicalRecordIdentity(kind)) {
      const previousKind = this.recordKinds.get(sourceId)
      if (previousKind !== undefined && previousKind !== kind) {
        fail(`Logical identity ${sourceId} is ambiguous between ${previousKind} and ${kind}`)
      }
      this.recordKinds.set(sourceId, kind)
    }
    const key = identityKey(kind, sourceId)
    const previous = this.identities.get(key)
    this.identities.set(key, {
      kind,
      sourceId,
      defined: previous?.defined === true || role === 'definition',
    })
    return sourceId
  }

  entries(): ProfileIdeaIdentityAllocation[] {
    return [...this.identities.values()].sort(compareAllocations)
  }
}

class IdentityMapper implements IdentityTransformer {
  constructor(private readonly mappings: ReadonlyMap<string, ProfileIdeaIdentityMapping>) {}

  apply(kind: ProfileIdeaIdentityKind, sourceId: string, _role: IdentityRole): string {
    const mapping = this.mappings.get(identityKey(kind, sourceId))
    if (!mapping) fail(`Identity ${kind}:${sourceId} was not collected before remapping`)
    return mapping.targetId
  }

  has(kind: ProfileIdeaIdentityKind, sourceId: string): boolean {
    return this.mappings.has(identityKey(kind, sourceId))
  }
}

function transformBoard(board: SavedBoard, identities: IdentityTransformer): SavedBoard {
  const clone = cloneJson(board)
  clone.cards = clone.cards.map((card) => transformCard(card, identities))
  clone.connections = clone.connections.map((connection) => transformConnection(connection, identities))
  clone.outputs = clone.outputs.map((output) => transformOutput(output, identities))
  clone.runs = clone.runs.map((run) => transformRun(run, identities))
  const transformedIntentLog = clone.intentLog?.map((event) => transformIntentEvent(event, identities))
  if (clone.highlightTags !== undefined) {
    clone.highlightTags = clone.highlightTags.map((tag) => transformHighlightTag(tag, identities))
  }
  if (clone.highlights !== undefined) {
    clone.highlights = clone.highlights.map((highlight) => transformHighlight(highlight, identities))
  }
  if (clone.compactionSummaries !== undefined) {
    clone.compactionSummaries = clone.compactionSummaries.map((summary) => ({
      ...summary,
      cardId: identities.apply('card', summary.cardId, 'reference'),
    }))
  }
  return transformedIntentLog === undefined
    ? clone
    : { ...clone, intentLog: transformedIntentLog }
}

function transformCard(card: Card, identities: IdentityTransformer): Card {
  const clone = cloneJson(card)
  clone.id = identities.apply('card', clone.id, 'definition')
  clone.blocks = clone.blocks.map((block) => ({
    ...block,
    id: identities.apply('block', block.id, 'definition'),
  }))
  if (clone.assets !== undefined) {
    clone.assets = clone.assets.map((asset) => ({
      ...asset,
      id: identities.apply('logical-asset', asset.id, 'definition'),
    }))
  }
  if (clone.localHtmlPreview?.assetId !== undefined) {
    clone.localHtmlPreview = {
      ...clone.localHtmlPreview,
      assetId: identities.apply('logical-asset', clone.localHtmlPreview.assetId, 'reference'),
    }
  }
  if (clone.groupId !== undefined) clone.groupId = identities.apply('card', clone.groupId, 'reference')
  if (clone.modV2 !== undefined) clone.modV2 = transformModDocument(clone.modV2, identities)
  return clone
}

function transformModDocument(
  mod: ProfileModDocument,
  identities: IdentityTransformer,
): ProfileModDocument {
  const targets = listModPartIdentities(mod).map((identity) => ({
    ...identity,
    targetId: identities.apply('mod-control', identity.sourceId, 'definition'),
  }))
  if (targets.every(({ sourceId, targetId }) => sourceId === targetId)) return cloneJson(mod)
  return remapModPartIdentities(
    mod,
    ({ ordinal }) => targets[ordinal]!.targetId,
  ).value
}

function transformModInstance(
  instance: ProfileModInstanceRecord,
  targetBoardId: string,
  identities: IdentityTransformer,
): ProfileModInstanceRecord {
  const targetRecordId = identities.apply('mod-instance', instance.recordId, 'definition')
  const envelope = {
    ...cloneJson(instance),
    recordId: targetRecordId,
    ownerId: targetBoardId,
    parentId: identities.apply('card', instance.parentId, 'reference'),
  }
  const mod = transformModDocument(instance.payload.mod, identities)
  if ('idMap' in instance.payload) {
    return {
      ...envelope,
      payload: {
        ...cloneJson(instance.payload),
        mod,
        idMap: {
          ...cloneJson(instance.payload.idMap),
          mod: {
            ...cloneJson(instance.payload.idMap.mod),
            instanceId: identities.apply(
              'mod-instance',
              instance.payload.idMap.mod.instanceId,
              'definition',
            ),
          },
          controls: instance.payload.idMap.controls.map((pair) => ({
            ...cloneJson(pair),
            instanceId: identities.apply('mod-control', pair.instanceId, 'definition'),
          })),
        },
      },
    }
  }
  return {
    ...envelope,
    payload: {
      ...cloneJson(instance.payload),
      mod,
    },
  }
}

function transformConnection(
  connection: Connection,
  identities: IdentityTransformer,
): Connection {
  const clone = cloneJson(connection)
  clone.id = identities.apply('connection', clone.id, 'definition')
  clone.from.cardId = identities.apply('card', clone.from.cardId, 'reference')
  clone.to.cardId = identities.apply('card', clone.to.cardId, 'reference')
  if (clone.from.blockId !== undefined) {
    clone.from.blockId = identities.apply('block', clone.from.blockId, 'reference')
  }
  if (clone.to.blockId !== undefined) {
    clone.to.blockId = identities.apply('block', clone.to.blockId, 'reference')
  }
  return clone
}

function transformOutput(output: Output, identities: IdentityTransformer): Output {
  const clone = cloneJson(output)
  clone.id = identities.apply('output', clone.id, 'definition')
  clone.resultCardId = identities.apply('card', clone.resultCardId, 'reference')
  if (clone.chosenVersionId !== undefined) {
    clone.chosenVersionId = identities.apply('output-version', clone.chosenVersionId, 'reference')
  }
  clone.versions = clone.versions.map((version) => transformOutputVersion(version, identities))
  return clone
}

function transformOutputVersion(
  version: OutputVersion,
  identities: IdentityTransformer,
): OutputVersion {
  const clone = cloneJson(version)
  clone.id = identities.apply('output-version', clone.id, 'definition')
  clone.fromRunId = identities.apply('run', clone.fromRunId, 'reference')
  if (clone.transcript !== undefined) {
    clone.transcript = clone.transcript.map((message) => transformTranscriptMessage(message, identities))
  }
  if (clone.followUpThread !== undefined) {
    clone.followUpThread.messages = clone.followUpThread.messages.map((message) => (
      transformFollowUpMessage(message, identities)
    ))
  }
  if (clone.sourceContext !== undefined) {
    clone.sourceContext.sources = clone.sourceContext.sources.map((source) => ({
      ...source,
      cardId: identities.apply('card', source.cardId, 'reference'),
    }))
  }
  return clone
}

function transformTranscriptMessage(
  message: TranscriptMessage,
  identities: IdentityTransformer,
): TranscriptMessage {
  const clone = cloneJson(message)
  clone.id = identities.apply('transcript-message', clone.id, 'definition')
  if (clone.participantCardId !== undefined) {
    clone.participantCardId = identities.apply('card', clone.participantCardId, 'reference')
  }
  return clone
}

function transformFollowUpMessage(
  message: FollowUpMessage,
  identities: IdentityTransformer,
): FollowUpMessage {
  const clone = cloneJson(message)
  clone.id = identities.apply('follow-up-message', clone.id, 'definition')
  return clone
}

function transformRun(run: RunRecord, identities: IdentityTransformer): RunRecord {
  const clone = cloneJson(run)
  clone.id = identities.apply('run', clone.id, 'definition')
  clone.askAiCardId = identities.apply('card', clone.askAiCardId, 'reference')
  clone.usedCardIds = clone.usedCardIds.map((id) => identities.apply('card', id, 'reference'))
  clone.usedConnectionIds = clone.usedConnectionIds.map((id) => (
    identities.apply('connection', id, 'reference')
  ))
  if (clone.usedGroupDigests !== undefined) {
    clone.usedGroupDigests = clone.usedGroupDigests.map((digest) => ({
      groupCardId: identities.apply('card', digest.groupCardId, 'reference'),
      versionId: identities.apply('output-version', digest.versionId, 'reference'),
      connectionId: identities.apply('connection', digest.connectionId, 'reference'),
    }))
  }
  clone.modIds = clone.modIds.map((id) => identities.apply('card', id, 'reference'))
  clone.appliedMods = clone.appliedMods.map((applied) => remapAppliedModControlIdentities({
    ...applied,
    modCardId: identities.apply('card', applied.modCardId, 'reference'),
    ...(applied.participantCardId === undefined ? {} : {
      participantCardId: identities.apply('card', applied.participantCardId, 'reference'),
    }),
  }, (id) => identities.apply('mod-control', id, 'reference')))
  if (clone.producedVersionId !== undefined) {
    clone.producedVersionId = identities.apply('output-version', clone.producedVersionId, 'reference')
  }
  if (clone.conversation !== undefined) {
    clone.conversation.participants = clone.conversation.participants.map((participant) => ({
      ...participant,
      cardId: identities.apply('card', participant.cardId, 'reference'),
      ...(participant.participantMods === undefined ? {} : {
        participantMods: participant.participantMods.map((mod) => ({
          ...mod,
          cardId: identities.apply('card', mod.cardId, 'reference'),
        })),
      }),
    }))
    clone.conversation.sharedContext = clone.conversation.sharedContext.map((context) => ({
      ...context,
      cardId: identities.apply('card', context.cardId, 'reference'),
    }))
    clone.conversation.topLevelMods = clone.conversation.topLevelMods.map((mod) => ({
      ...mod,
      cardId: identities.apply('card', mod.cardId, 'reference'),
    }))
    clone.conversation.turns = clone.conversation.turns.map((turn) => ({
      ...turn,
      participantCardId: identities.apply('card', turn.participantCardId, 'reference'),
    }))
  }
  if (clone.contextBudget !== undefined) {
    clone.contextBudget.compactedCardIds = clone.contextBudget.compactedCardIds.map((id) => (
      identities.apply('card', id, 'reference')
    ))
    clone.contextBudget.droppedCardIds = clone.contextBudget.droppedCardIds.map((id) => (
      identities.apply('card', id, 'reference')
    ))
  }
  if (clone.plan !== undefined) {
    clone.plan.rootCardId = identities.apply('card', clone.plan.rootCardId, 'reference')
    clone.plan.steps = clone.plan.steps.map((step) => ({
      ...step,
      id: identities.apply('execution-step', step.id, 'definition'),
      cardId: identities.apply('card', step.cardId, 'reference'),
      dependsOn: step.dependsOn.map((id) => identities.apply('execution-step', id, 'reference')),
      ...(step.connectionId === undefined ? {} : {
        connectionId: identities.apply('connection', step.connectionId, 'reference'),
      }),
    }))
  }
  return clone
}

export function remapAppliedModControlIdentities(
  applied: AppliedMod,
  remapControlId: (sourceId: string) => string,
): AppliedMod {
  if (applied.modVersion !== 2) return applied
  return {
    ...applied,
    controlValues: remapModPartIdentities(
      applied.controlValues,
      ({ sourceId }) => remapControlId(sourceId),
    ).value,
  }
}

function transformIntentEvent(
  event: IntentLogEvent,
  identities: IdentityTransformer,
): IntentLogEvent {
  const clone = cloneJson(event)
  clone.id = identities.apply('intent-event', clone.id, 'definition')
  if (clone.ideaId !== undefined) clone.ideaId = identities.apply('idea', clone.ideaId, 'reference')
  switch (clone.type) {
    case 'card.created':
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      clone.data.card = transformCard(clone.data.card, identities)
      if (clone.data.sourceCardId !== undefined) {
        clone.data.sourceCardId = identities.apply('card', clone.data.sourceCardId, 'reference')
      }
      return clone
    case 'group.created':
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      clone.data.card = transformCard(clone.data.card, identities)
      if (clone.data.memberChanges !== undefined) {
        clone.data.memberChanges = transformMemberChanges(clone.data.memberChanges, identities)
      }
      return clone
    case 'card.deleted':
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      clone.data.card = transformCard(clone.data.card, identities)
      clone.data.connections = clone.data.connections.map((connection) => (
        transformConnection(connection, identities)
      ))
      if (clone.data.memberIds !== undefined) {
        clone.data.memberIds = clone.data.memberIds.map((id) => identities.apply('card', id, 'reference'))
      }
      if (clone.data.outputs !== undefined) {
        clone.data.outputs = clone.data.outputs.map((output) => transformOutput(output, identities))
      }
      return clone
    case 'card.moved':
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      clone.data.moves = clone.data.moves.map((move) => ({
        ...move,
        cardId: identities.apply('card', move.cardId, 'reference'),
        ...(move.previousGroupId === undefined ? {} : {
          previousGroupId: identities.apply('card', move.previousGroupId, 'reference'),
        }),
        ...(move.nextGroupId === undefined ? {} : {
          nextGroupId: identities.apply('card', move.nextGroupId, 'reference'),
        }),
      }))
      return clone
    case 'card.resized':
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      return clone
    case 'cards.arranged':
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      clone.data.changes = clone.data.changes.map((change) => ({
        ...change,
        cardId: identities.apply('card', change.cardId, 'reference'),
        before: {
          ...change.before,
          ...(change.before.groupId === undefined ? {} : {
            groupId: identities.apply('card', change.before.groupId, 'reference'),
          }),
        },
        after: {
          ...change.after,
          ...(change.after.groupId === undefined ? {} : {
            groupId: identities.apply('card', change.after.groupId, 'reference'),
          }),
        },
      }))
      return clone
    case 'card.layer.changed':
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      clone.data.changes = clone.data.changes.map((change) => ({
        ...change,
        cardId: identities.apply('card', change.cardId, 'reference'),
      }))
      return clone
    case 'card.content.edited':
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      if (clone.data.field === 'assets') {
        clone.data.assetId = identities.apply('logical-asset', clone.data.assetId, 'reference')
      }
      return clone
    case 'group.members.changed':
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      clone.data.memberChanges = transformMemberChanges(clone.data.memberChanges, identities)
      return clone
    case 'connection.created':
    case 'connection.deleted':
      clone.connectionId = identities.apply('connection', clone.connectionId, 'reference')
      clone.data.connection = transformConnection(clone.data.connection, identities)
      return clone
    case 'connection.changed':
      clone.connectionId = identities.apply('connection', clone.connectionId, 'reference')
      clone.data.before = transformConnection(clone.data.before, identities)
      clone.data.after = transformConnection(clone.data.after, identities)
      return clone
    case 'run.started':
    case 'run.continued':
    case 'run.completed':
    case 'run.failed':
    case 'run.canceled':
      clone.runId = identities.apply('run', clone.runId, 'reference')
      clone.data.run = transformRun(clone.data.run, identities)
      return clone
    case 'group.compression.started':
    case 'group.compression.completed':
    case 'group.compression.failed':
    case 'group.compression.canceled':
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      clone.runId = identities.apply('run', clone.runId, 'reference')
      if (clone.versionId !== undefined) {
        clone.versionId = identities.apply('output-version', clone.versionId, 'reference')
      }
      clone.data.run = transformRun(clone.data.run, identities)
      return clone
    case 'version.chosen':
      clone.versionId = identities.apply('output-version', clone.versionId, 'reference')
      clone.data.outputId = identities.apply('output', clone.data.outputId, 'reference')
      if (clone.data.previousVersionId !== undefined) {
        clone.data.previousVersionId = identities.apply(
          'output-version', clone.data.previousVersionId, 'reference',
        )
      }
      clone.data.nextVersionId = identities.apply('output-version', clone.data.nextVersionId, 'reference')
      return clone
    case 'version.acceptance.changed':
      clone.versionId = identities.apply('output-version', clone.versionId, 'reference')
      clone.data.outputId = identities.apply('output', clone.data.outputId, 'reference')
      return clone
    case 'version.note.created':
      clone.versionId = identities.apply('output-version', clone.versionId, 'reference')
      clone.cardId = identities.apply('card', clone.cardId, 'reference')
      clone.data.noteCardId = identities.apply('card', clone.data.noteCardId, 'reference')
      if (clone.data.outputId !== undefined) {
        clone.data.outputId = identities.apply('output', clone.data.outputId, 'reference')
      }
      if (clone.data.resultCardId !== undefined) {
        clone.data.resultCardId = identities.apply('card', clone.data.resultCardId, 'reference')
      }
      if (clone.data.sourceMessageId !== undefined) {
        const kind = clone.data.source === 'conversation' ? 'transcript-message' : 'follow-up-message'
        clone.data.sourceMessageId = identities.apply(kind, clone.data.sourceMessageId, 'reference')
      }
      return clone
    case 'followup.message.added':
    case 'followup.message.finished':
      clone.versionId = identities.apply('output-version', clone.versionId, 'reference')
      if (clone.data.outputId !== undefined) {
        clone.data.outputId = identities.apply('output', clone.data.outputId, 'reference')
      }
      if (clone.data.resultCardId !== undefined) {
        clone.data.resultCardId = identities.apply('card', clone.data.resultCardId, 'reference')
      }
      clone.data.message = transformFollowUpMessage(clone.data.message, identities)
      return clone
    case 'followup.thread.cleared':
      clone.versionId = identities.apply('output-version', clone.versionId, 'reference')
      if (clone.data.outputId !== undefined) {
        clone.data.outputId = identities.apply('output', clone.data.outputId, 'reference')
      }
      if (clone.data.resultCardId !== undefined) {
        clone.data.resultCardId = identities.apply('card', clone.data.resultCardId, 'reference')
      }
      clone.data.previousMessages = clone.data.previousMessages.map((message) => (
        transformFollowUpMessage(message, identities)
      ))
      return clone
  }
}

function transformMemberChanges(
  changes: Record<string, { from?: string; to?: string }>,
  identities: IdentityTransformer,
): Record<string, { from?: string; to?: string }> {
  return Object.fromEntries(Object.entries(changes).map(([cardId, change]) => [
    identities.apply('card', cardId, 'reference'),
    {
      ...(change.from === undefined ? {} : { from: identities.apply('card', change.from, 'reference') }),
      ...(change.to === undefined ? {} : { to: identities.apply('card', change.to, 'reference') }),
    },
  ]))
}

function transformHighlightTag(
  tag: HighlightTag,
  identities: IdentityTransformer,
): HighlightTag {
  const clone = cloneJson(tag)
  clone.id = identities.apply('highlight-tag', clone.id, 'definition')
  return clone
}

function transformHighlight(
  highlight: Highlight,
  identities: IdentityTransformer,
): Highlight {
  const clone = cloneJson(highlight)
  clone.id = identities.apply('highlight', clone.id, 'definition')
  clone.cardId = identities.apply('card', clone.cardId, 'reference')
  clone.tagId = identities.apply('highlight-tag', clone.tagId, 'reference')
  return clone
}

function rebaseSourceFreshness(sourceBoard: SavedBoard, targetBoard: SavedBoard): void {
  if (sourceBoard.outputs.length !== targetBoard.outputs.length) {
    fail('Remapped Profile changed the Output inventory before freshness rebasing')
  }
  for (let outputIndex = 0; outputIndex < sourceBoard.outputs.length; outputIndex += 1) {
    const sourceOutput = sourceBoard.outputs[outputIndex]
    const targetOutput = targetBoard.outputs[outputIndex]
    if (!sourceOutput || !targetOutput || sourceOutput.versions.length !== targetOutput.versions.length) {
      fail('Remapped Profile changed the Output Version inventory before freshness rebasing')
    }
    for (let versionIndex = 0; versionIndex < sourceOutput.versions.length; versionIndex += 1) {
      const sourceVersion = sourceOutput.versions[versionIndex]
      const targetVersion = targetOutput.versions[versionIndex]
      if (!sourceVersion || !targetVersion) fail('Remapped Profile lost an Output Version')
      rebaseVersionFreshness(sourceBoard, sourceVersion, targetBoard, targetVersion)
    }
  }
}

function rebaseVersionFreshness(
  sourceBoard: SavedBoard,
  sourceVersion: OutputVersion,
  targetBoard: SavedBoard,
  targetVersion: OutputVersion,
): void {
  delete targetVersion.sourceChangeDismissedSignature
  if (!sourceVersion.sourceContext) {
    if (targetVersion.sourceContext) fail(`Remapped source context ${sourceVersion.id} appeared unexpectedly`)
    return
  }
  if (!targetVersion.sourceContext) fail(`Remapped source context ${sourceVersion.id} disappeared`)
  if (sourceVersion.sourceContext.sources.length !== targetVersion.sourceContext.sources.length) {
    fail(`Remapped source context ${sourceVersion.id} changed its reference inventory`)
  }

  const sourceWithoutDismissal = cloneJson(sourceVersion)
  delete sourceWithoutDismissal.sourceChangeDismissedSignature
  const sourceStatus = sourceChangeStatus(sourceBoard, sourceWithoutDismissal)
  const sourceChanges = new Map((sourceStatus?.changes ?? []).map((change) => [
    sourceContextKey(change.cardId, change.groupMode),
    change,
  ]))
  const currentTarget = cloneJson(createSourceContextSnapshot(
    targetBoard,
    targetVersion.sourceContext.sources.map((source) => ({
      cardId: source.cardId,
      ...(source.groupMode === undefined ? {} : { groupMode: source.groupMode }),
    })),
  ))
  const currentTargetByRef = new Map(currentTarget.sources.map((source) => [
    sourceContextKey(source.cardId, source.groupMode),
    source,
  ]))

  for (let index = 0; index < sourceVersion.sourceContext.sources.length; index += 1) {
    const sourceFingerprint = sourceVersion.sourceContext.sources[index]
    const targetFingerprint = targetVersion.sourceContext.sources[index]
    if (!sourceFingerprint || !targetFingerprint) fail('Remapped Profile lost a source-context fingerprint')
    const sourceChange = sourceChanges.get(sourceContextKey(
      sourceFingerprint.cardId,
      sourceFingerprint.groupMode,
    ))
    const targetCurrent = currentTargetByRef.get(sourceContextKey(
      targetFingerprint.cardId,
      targetFingerprint.groupMode,
    ))
    if (!sourceChange) {
      if (!targetCurrent) fail(`Fresh source ${sourceFingerprint.cardId} disappeared during remap`)
      targetFingerprint.hash = targetCurrent.hash
      continue
    }
    if (sourceChange.reason === 'changed') {
      if (!targetCurrent) fail(`Changed source ${sourceFingerprint.cardId} disappeared during remap`)
      if (targetFingerprint.hash === targetCurrent.hash) {
        targetFingerprint.hash = `stale-after-remap:${targetFingerprint.hash}`
      }
    } else if (targetCurrent) {
      fail(`Deleted source ${sourceFingerprint.cardId} reappeared during remap`)
    }
  }

  const wasDismissed = sourceStatus !== null
    && sourceVersion.sourceChangeDismissedSignature === sourceStatus.signature
  if (!wasDismissed) return
  const targetStatus = sourceChangeStatus(targetBoard, targetVersion)
  if (!targetStatus) fail(`Dismissed source changes for ${sourceVersion.id} became fresh during remap`)
  targetVersion.sourceChangeDismissedSignature = targetStatus.signature
}

function readLogicalProfile(
  candidate: unknown,
  label: string,
  hydrateAsset: ProfileAssetHydrator = placeholderAssetHydrator,
): {
  document: ProfileLogicalDocument
  snapshot: ProfileSnapshot
  assets: Map<string, ProfileLogicalAssetPayload>
} {
  try {
    const snapshot = hydrateProfileLogicalDocument(candidate, hydrateAsset, {
      validateLocalAssetBytes: hydrateAsset !== placeholderAssetHydrator,
    })
    const document = cloneJson(candidate) as ProfileLogicalDocument
    return { document, snapshot, assets: readAssetMetadata(document) }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown logical projection failure'
    fail(`Profile Idea ${label} document is invalid: ${message}`)
  }
}

function legacyCurrentAssetHydrator(board: SavedBoard): ProfileAssetHydrator {
  const currentAssets = new Map<string, CardAsset>()
  for (const card of board.cards) {
    for (const asset of card.assets ?? []) currentAssets.set(asset.id, asset)
  }
  return (payload) => {
    const current = currentAssets.get(payload.id)
    return current === undefined
      ? placeholderAssetHydrator(payload)
      : hydrateProfileLogicalAsset(payload, current.dataUrl)
  }
}

function readAssetMetadata(document: ProfileLogicalDocument): Map<string, ProfileLogicalAssetPayload> {
  const assets = new Map<string, ProfileLogicalAssetPayload>()
  const remember = (value: unknown) => {
    const metadata = readProfileLogicalAssetPayload(value)
    if (!metadata) fail('Profile Idea contains invalid logical asset metadata')
    const previous = assets.get(metadata.id)
    if (previous && JSON.stringify(previous) !== JSON.stringify(metadata)) {
      fail(`Profile logical asset ${metadata.id} changes metadata`)
    }
    assets.set(metadata.id, metadata)
  }
  for (const record of document.records) {
    if (record.kind === 'logical-asset') remember(record.payload)
    if (record.kind !== 'intent-event' || !isPlainRecord(record.payload)
      || !['card.created', 'group.created', 'card.deleted'].includes(String(record.payload.type))
      || !isPlainRecord(record.payload.data) || !isPlainRecord(record.payload.data.card)) continue
    const historicalAssets = record.payload.data.card.assets
    if (historicalAssets === undefined) continue
    if (!Array.isArray(historicalAssets)) fail('Historical logical asset inventory is invalid')
    historicalAssets.forEach(remember)
  }
  return assets
}

function readCompleteReservedIds(profile: ReturnType<typeof readLogicalProfile>): Set<string> {
  const reserved = new Set(profile.document.records.map((record) => record.recordId))
  const collector = new IdentityCollector()
  for (const idea of profile.snapshot.ideas) {
    collector.apply('idea', idea.id, 'definition')
    const board = profile.snapshot.boards[idea.id]
    if (board) transformBoard(board, collector)
  }
  profile.snapshot.modInstances.forEach((instance) => (
    transformModInstance(instance, instance.ownerId, collector)
  ))
  collector.entries().forEach((identity) => reserved.add(identity.sourceId))
  for (const template of profile.snapshot.modTemplates) {
    reserved.add(template.recordId)
    listModPartIdentities(template.payload.mod).forEach(({ sourceId }) => reserved.add(sourceId))
  }
  readPreservedModSourceIds(profile.snapshot.modInstances).forEach((id) => reserved.add(id))
  return reserved
}

function readPreservedModSourceIds(instances: readonly ProfileModInstanceRecord[]): Set<string> {
  const ids = new Set<string>()
  for (const instance of instances) {
    if (!('idMap' in instance.payload)) continue
    ids.add(instance.payload.source.templateId)
    ids.add(instance.payload.idMap.mod.sourceId)
    instance.payload.idMap.controls.forEach((pair) => ids.add(pair.sourceId))
  }
  return ids
}

function legacySourceModInstanceRecordId(ideaId: string, cardId: string): string {
  return `mod-instance:legacy-import:${ideaId}:${cardId}`
}

function assetProjector(assets: ReadonlyMap<string, ProfileLogicalAssetPayload>): ProfileAssetProjector {
  return (asset: CardAsset) => {
    const metadata = assets.get(asset.id)
    if (!metadata) fail(`Profile Idea asset ${asset.id} has no logical metadata`)
    return metadata
  }
}

function placeholderAssetHydrator(payload: ProfileLogicalAssetPayload): CardAsset {
  return hydrateProfileLogicalAsset(payload, `data:${payload.mimeType};base64,`)
}

function rememberMapping(
  mappings: Map<string, ProfileIdeaIdentityMapping>,
  mapping: ProfileIdeaIdentityMapping,
): void {
  const key = identityKey(mapping.kind, mapping.sourceId)
  const previous = mappings.get(key)
  if (previous && previous.targetId !== mapping.targetId) {
    fail(`Identity ${mapping.kind}:${mapping.sourceId} received two targets`)
  }
  mappings.set(key, Object.freeze(mapping))
}

function reserveFresh(id: string, occupied: ReadonlySet<string>, label: string): void {
  if (!nonEmptyString(id) || occupied.has(id)) fail(`The ${label} identity is invalid or reserved: ${id}`)
}

function compareAllocations(
  left: ProfileIdeaIdentityAllocation,
  right: ProfileIdeaIdentityAllocation,
): number {
  return codeUnitCompare(left.kind, right.kind) || codeUnitCompare(left.sourceId, right.sourceId)
}

function compareMappings(left: ProfileIdeaIdentityMapping, right: ProfileIdeaIdentityMapping): number {
  return compareAllocations(left, right)
}

function identityKey(kind: ProfileIdeaIdentityKind, id: string): string {
  return `${kind}\0${id}`
}

function sourceContextKey(cardId: string, groupMode: string | undefined): string {
  return `${cardId}\0${groupMode ?? ''}`
}

function isLogicalRecordIdentity(kind: ProfileIdeaIdentityKind): boolean {
  return !['board', 'board-settings', 'mod-control', 'execution-step', 'compaction-summary'].includes(kind)
}

function boardRecordId(ideaId: string): string {
  return `board:${ideaId}`
}

function boardSettingsRecordId(boardId: string): string {
  return `board-settings:${boardId}`
}

function compactionSummaryRecordId(boardId: string, cardId: string): string {
  return `compaction-summary:${boardId}:${cardId}`
}

function assertInertJson(
  value: unknown,
  path: string,
  ancestors = new WeakSet<object>(),
  depth = 0,
  budget = { nodes: 0 },
): void {
  budget.nodes += 1
  if (depth > 128 || budget.nodes > 2_000_000) fail(`${path} exceeds the legacy import JSON bound`)
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || Object.is(value, -0)) fail(`${path} contains a lossy JSON number`)
    return
  }
  if (typeof value !== 'object') fail(`${path} contains a non-JSON value`)
  if (ancestors.has(value)) fail(`${path} contains a cycle`)
  ancestors.add(value)
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
      fail(`${path} contains a non-standard JSON array`)
    }
    const names = Object.getOwnPropertyNames(value)
    if (names.length !== value.length + 1
      || names.some((name) => name !== 'length'
        && (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= value.length))) {
      fail(`${path} contains a sparse or extended array`)
    }
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      if (!descriptor || !('value' in descriptor)) fail(`${path}[${index}] is executable`)
      assertInertJson(descriptor.value, `${path}[${index}]`, ancestors, depth + 1, budget)
    }
    ancestors.delete(value)
    return
  }
  if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) {
    fail(`${path} contains a non-plain JSON object`)
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!descriptor.enumerable || !('value' in descriptor)) fail(`${path}.${key} is not inert JSON data`)
    assertInertJson(descriptor.value, `${path}.${key}`, ancestors, depth + 1, budget)
  }
  ancestors.delete(value)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function codeUnitCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function fail(message: string): never {
  throw new ProfileIdeaIdentityRemapError(message)
}
