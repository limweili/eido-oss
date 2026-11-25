import type {
  Card,
  Connection,
  ConversationStyle,
  IdeaSummary,
  IntentLogEventDraft,
  SavedBoard,
} from '../graph/types'
import { boardAiSettingsOf } from '../graph/boardAiSettings'
import { isCardAuthorship } from '../graph/cardAuthorship'
import { findAgentCardPlacement } from '../graph/agentCardPlacement'
import { cardIdentityPresetSolid, type CardIdentityPresetId } from '../graph/cardIdentityPresets'
import {
  planCardFrameArrangement,
  planCardLayerOrder,
  planGroupMembership,
  type CardLayerDirection,
} from '../graph/cardOrganization'
import { placeCreatedCard, reconcileGroupMembership } from '../graph/cardPlacement'
import { planConnectionAddition } from '../graph/connectionAddition'
import { contractFor } from '../graph/contextContracts'
import { createGraphIndex } from '../graph/graphIndex'
import { findResultCardPosition } from '../graph/resultCardPlacement'
import { DEFAULT_CONVERSATION_STYLE, DEFAULT_CONVERSATION_TURNS } from '../brain/conversationCompiler'
import { DEFAULT_COMPRESSION_PROMPT } from '../brain/groupDigestFreshness'
import { listModPartIdentities } from '../mods'
import {
  hydrateProfileLogicalAsset,
  type ProfileLogicalAssetPayload,
} from './profileAssetKernel'
import {
  hydrateProfileLogicalDocument,
  projectProfileSnapshot,
  stampProfileCardAuthorship,
  validateProfileLogicalDocument,
  ProfileLogicalDocument,
  ProfileLogicalRecordSpec,
} from './profileLogicalProjection'
import { planProfileAgentModCommandStep } from './profileAgentModCommandPlan'
import type { ProfileAgentEventDraft } from './profileAgentEvent'
import {
  validateProfileModDocumentTransport,
  type ProfileModDocument,
  type ProfileModInstanceRecord,
  type ProfileModTemplateRecord,
} from './profileModRecords'
import { resolveProfileAgentCardAddresses } from './profileAgentSpatialQuery'
import {
  PROFILE_CONTRACT_VERSIONS,
  profileServiceFailure,
  type ProfileJsonValue,
  type ProfileServiceResult,
} from './profileServiceContract'
import {
  PROFILE_AGENT_BOARD_COMMAND_NAMES,
  PROFILE_AGENT_CARD_DELETE_KINDS,
  PROFILE_AGENT_COMMAND_LIMITS,
  PROFILE_AGENT_COMMAND_RESULT_LIMITS,
  PROFILE_AGENT_IDEA_COMMAND_NAMES,
  PROFILE_AGENT_MOD_COMMAND_NAMES,
  PROFILE_AGENT_RESEARCH_COMMAND_NAMES,
  type ProfileAgentCommandSurfaceVersion,
  type ProfileAgentBoardCommandName,
  type ProfileAgentIdeaCommandName,
  type ProfileAgentModCommandName,
  type ProfileAgentResearchCommandName,
} from './profileAgentCommandManifest'

export {
  PROFILE_AGENT_BOARD_COMMAND_DESCRIPTORS,
  PROFILE_AGENT_BOARD_COMMAND_NAMES,
  PROFILE_AGENT_COMMAND_LIMITS,
  PROFILE_AGENT_IDEA_COMMAND_NAMES,
  PROFILE_AGENT_MOD_COMMAND_NAMES,
  PROFILE_AGENT_RESEARCH_COMMAND_NAMES,
  type ProfileAgentBoardCommandName,
  type ProfileAgentCommandDescriptor,
  type ProfileAgentIdeaCommandName,
  type ProfileAgentModCommandName,
  type ProfileAgentResearchCommandName,
} from './profileAgentCommandManifest'

export {
  PROFILE_AGENT_MOD_COMMAND_DESCRIPTORS,
  type ProfileAgentModCommandDescriptor,
} from './profileAgentModCommandPlan'

export type ProfileAgentCardReference =
  | Readonly<{ cardId: string }>
  | Readonly<{ createdByCommandId: string }>

export type ProfileAgentCardPosition = Readonly<{ x: number; y: number }>

export type ProfileAgentCardPlacement =
  | Readonly<{ position: ProfileAgentCardPosition; near?: never }>
  | Readonly<{ near: readonly string[]; position?: never }>

type ProfileAgentLegacyCardCreatePayload = Readonly<{
  ideaId: string
  kind: 'note' | 'askAi'
  position: ProfileAgentCardPosition
  text?: string
}>

type ProfileAgentV3BodyCardCreatePayload = Readonly<{
  ideaId: string
  kind: 'note' | 'askAi' | 'title'
  body: string
}> & ProfileAgentCardPlacement

type ProfileAgentV3GroupCardCreatePayload = Readonly<{
  ideaId: string
  kind: 'group'
  groupTitle: string
  compressionPrompt: string
}> & ProfileAgentCardPlacement

type ProfileAgentV3ConversationCardCreatePayload = Readonly<{
  ideaId: string
  kind: 'conversation'
  topic: string
  conversationStyle: ConversationStyle
  conversationTurns: number
}> & ProfileAgentCardPlacement

export type ProfileAgentCardCreateCommand = Readonly<{
  version: 1
  id: string
  name: 'card.create'
  payload:
    | ProfileAgentLegacyCardCreatePayload
    | ProfileAgentV3BodyCardCreatePayload
    | ProfileAgentV3GroupCardCreatePayload
    | ProfileAgentV3ConversationCardCreatePayload
}>

type ProfileAgentLegacyCardUpdateContentPayload = Readonly<{
  ideaId: string
  cardId: string
  blockId: string
  text: string
}>

type ProfileAgentV3BodyCardUpdatePayload = Readonly<{
  ideaId: string
  cardId: string
  body: string
}>

type ProfileAgentV3GroupCardUpdatePayload = Readonly<{
  ideaId: string
  cardId: string
  groupTitle?: string
  compressionPrompt?: string
}>

type ProfileAgentV3ConversationCardUpdatePayload = Readonly<{
  ideaId: string
  cardId: string
  topic?: string
  conversationStyle?: ConversationStyle
  conversationTurns?: number
}>

export type ProfileAgentCardUpdateContentCommand = Readonly<{
  version: 1
  id: string
  name: 'card.update-content'
  payload:
    | ProfileAgentLegacyCardUpdateContentPayload
    | ProfileAgentV3BodyCardUpdatePayload
    | ProfileAgentV3GroupCardUpdatePayload
    | ProfileAgentV3ConversationCardUpdatePayload
}>

export type ProfileAgentCardDeleteCommand = Readonly<{
  version: 1
  id: string
  name: 'card.delete'
  payload: Readonly<{ ideaId: string; cardId: string }>
}>

export type ProfileAgentConnectionCreateCommand = Readonly<{
  version: 1
  id: string
  name: 'connection.create'
  payload: Readonly<{
    ideaId: string
    from: ProfileAgentCardReference
    to: ProfileAgentCardReference
    strength?: Connection['strength']
    polarity?: Connection['polarity']
    reason?: string
    groupMode?: NonNullable<Connection['meta']>['groupMode']
  }>
}>

export type ProfileAgentConnectionUpdateMeaningCommand = Readonly<{
  version: 1
  id: string
  name: 'connection.update-meaning'
  payload: Readonly<{
    ideaId: string
    connectionId: string
    strength?: Connection['strength']
    polarity?: Connection['polarity']
    reason?: string | null
    groupMode?: NonNullable<Connection['meta']>['groupMode']
  }>
}>

export type ProfileAgentConnectionDeleteCommand = Readonly<{
  version: 1
  id: string
  name: 'connection.delete'
  payload: Readonly<{ ideaId: string; connectionId: string }>
}>

export type ProfileAgentBoardCommand =
  | ProfileAgentCardCreateCommand
  | ProfileAgentCardUpdateContentCommand
  | ProfileAgentCardDeleteCommand
  | ProfileAgentConnectionCreateCommand
  | ProfileAgentConnectionUpdateMeaningCommand
  | ProfileAgentConnectionDeleteCommand

export type ProfileAgentAskSetModelCommand = Readonly<{
  version: 1
  id: string
  name: 'ask.set-model'
  payload: Readonly<{
    ideaId: string
    card: ProfileAgentCardReference
    model: string
  }>
}>

export type ProfileAgentCardSetIdentityCommand = Readonly<{
  version: 1
  id: string
  name: 'card.set-identity'
  payload: Readonly<{
    ideaId: string
    card: ProfileAgentCardReference
    identity: null | Readonly<{
      preset: CardIdentityPresetId
      fill: 'soft' | 'body' | 'pattern'
    }>
  }>
}>

export type ProfileAgentCardsArrangeCommand = Readonly<{
  version: 1
  id: string
  name: 'cards.arrange'
  payload: Readonly<{
    ideaId: string
    frames: readonly Readonly<{
      card: ProfileAgentCardReference
      position: ProfileAgentCardPosition
      size?: Readonly<{ width: number; height: number }>
    }>[]
  }>
}>

export type ProfileAgentCardsReorderLayerCommand = Readonly<{
  version: 1
  id: string
  name: 'cards.reorder-layer'
  payload: Readonly<{
    ideaId: string
    cards: readonly ProfileAgentCardReference[]
    direction: CardLayerDirection
  }>
}>

export type ProfileAgentGroupMembershipSetCommand = Readonly<{
  version: 1
  id: string
  name: 'group.membership.set'
  payload: Readonly<{
    ideaId: string
    card: ProfileAgentCardReference
    group: ProfileAgentCardReference | null
  }>
}>

export type ProfileAgentOutputChooseVersionCommand = Readonly<{
  version: 1
  id: string
  name: 'output.choose-version'
  payload: Readonly<{ ideaId: string; outputId: string; versionId: string }>
}>

export type ProfileAgentOutputSetAcceptedCommand = Readonly<{
  version: 1
  id: string
  name: 'output.set-accepted'
  payload: Readonly<{
    ideaId: string
    outputId: string
    versionId: string
    accepted: boolean
  }>
}>

export type ProfileAgentResearchCommand =
  | ProfileAgentAskSetModelCommand
  | ProfileAgentCardSetIdentityCommand
  | ProfileAgentCardsArrangeCommand
  | ProfileAgentCardsReorderLayerCommand
  | ProfileAgentGroupMembershipSetCommand
  | ProfileAgentOutputChooseVersionCommand
  | ProfileAgentOutputSetAcceptedCommand

export type ProfileAgentModTemplateCreateCommand = Readonly<{
  version: 1
  id: string
  name: 'mod-template.create'
  payload: Readonly<{
    templateId: string
    mod: ProfileModDocument
  }>
}>

export type ProfileAgentModTemplateUpdateCommand = Readonly<{
  version: 1
  id: string
  name: 'mod-template.update'
  payload: Readonly<{
    templateId: string
    expectedTemplateVersion: number
    mod: ProfileModDocument
  }>
}>

export type ProfileAgentModTemplateDeleteCommand = Readonly<{
  version: 1
  id: string
  name: 'mod-template.delete'
  payload: Readonly<{
    templateId: string
    expectedTemplateVersion: number
  }>
}>

export type ProfileAgentModInstanceStampCommand = Readonly<{
  version: 1
  id: string
  name: 'mod-instance.stamp'
  payload: Readonly<{
    ideaId: string
    templateId: string
    expectedTemplateVersion: number
    position: Readonly<{ x: number; y: number }>
  }>
}>

export type ProfileAgentModInstanceCreateCommand = Readonly<{
  version: 1
  id: string
  name: 'mod-instance.create'
  payload: Readonly<{
    ideaId: string
    mod: ProfileModDocument
    position: Readonly<{ x: number; y: number }>
  }>
}>

export type ProfileAgentModInstanceConfigureCommand = Readonly<{
  version: 1
  id: string
  name: 'mod-instance.configure'
  payload: Readonly<{
    ideaId: string
    cardId: string
    mod: ProfileModDocument
  }>
}>

export type ProfileAgentModInstanceDeleteCommand = Readonly<{
  version: 1
  id: string
  name: 'mod-instance.delete'
  payload: Readonly<{ ideaId: string; cardId: string }>
}>

export type ProfileAgentModCommand =
  | ProfileAgentModTemplateCreateCommand
  | ProfileAgentModTemplateUpdateCommand
  | ProfileAgentModTemplateDeleteCommand
  | ProfileAgentModInstanceStampCommand
  | ProfileAgentModInstanceCreateCommand
  | ProfileAgentModInstanceConfigureCommand
  | ProfileAgentModInstanceDeleteCommand

export type ProfileAgentIdeaCreateCommand = Readonly<{
  version: 1
  id: string
  name: 'idea.create'
  payload: Readonly<{ name: string }>
}>

export type ProfileAgentIdeaActivateCommand = Readonly<{
  version: 1
  id: string
  name: 'idea.activate'
  payload: Readonly<{ ideaId: string }>
}>

export type ProfileAgentCommand =
  | ProfileAgentBoardCommand
  | ProfileAgentResearchCommand
  | ProfileAgentModCommand
  | ProfileAgentIdeaCreateCommand
  | ProfileAgentIdeaActivateCommand

export type ProfileAgentCommandRequest = Readonly<{
  version: 1
  schemaVersion: 1
  expectedRevision: number
  idempotencyKey: string
  dryRun: boolean
  commands: readonly ProfileAgentCommand[]
}>

export type ProfileAgentTrustedAttribution = Readonly<{
  profileId: string
  actor: Readonly<{
    id: string
    kind: 'agent'
    transport: 'cli' | 'mcp' | 'test'
    client: string
    sessionId: string
  }>
  clientTxnId: string
}>

export type ProfileAgentBoardDerivedIdPurpose =
  | 'card'
  | 'block'
  | 'connection'
  | 'result-card'
  | 'result-block'
  | 'source-result-connection'
  | 'routed-connection'

export type ProfileAgentDerivedIdPurpose =
  | ProfileAgentBoardDerivedIdPurpose
  | 'idea'
  | 'mod-instance'
  | 'mod-control'

type ProfileAgentDerivedIdScopeBase = Readonly<{
  profileId: string
  actorId: string
  idempotencyKey: string
  requestCanonicalJson: string
  commandId: string
}>

export type ProfileAgentDerivedIdScope = ProfileAgentDerivedIdScopeBase & (
  | Readonly<{ purpose: ProfileAgentBoardDerivedIdPurpose }>
  | Readonly<{ purpose: 'idea' }>
  | Readonly<{ purpose: 'mod-instance'; sourceId: string; ordinal: 0 }>
  | Readonly<{ purpose: 'mod-control'; sourceId: string; ordinal: number }>
)

export type ProfileAgentCommandIdDeriver = (scope: ProfileAgentDerivedIdScope) => string

export type ProfileAgentCommandTrustedContext = ProfileAgentTrustedAttribution & Readonly<{
  deriveId: ProfileAgentCommandIdDeriver
  contentSha256: (text: string) => string
  commitId?: string
  committedAt?: string
  stampedAt?: string
}>

export type ProfileAgentCommandScope =
  | Readonly<{ kind: 'profile' }>
  | Readonly<{ kind: 'idea'; ideaId: string }>

type ProfileAgentAuthorizedCommandBatch = ProfileAgentCommandRequest & Readonly<{
  scope: ProfileAgentCommandScope
  attribution: ProfileAgentTrustedAttribution
  requestCanonicalJson: string
}>

export type ProfileAgentRecordChange =
  | Readonly<{ operation: 'insert'; after: ProfileLogicalRecordSpec }>
  | Readonly<{ operation: 'replace'; before: ProfileLogicalRecordSpec; after: ProfileLogicalRecordSpec }>
  | Readonly<{ operation: 'delete'; before: ProfileLogicalRecordSpec }>

export type ProfileAgentLogicalIntentEventDraft = Readonly<{
  ideaId: string
  event: ProfileJsonValue
}>

export type ProfileAgentCommandResult =
  | Readonly<{
      commandId: string
      name: 'idea.create'
      ideaId: string
      boardId: string
      ideaName: string
    }>
  | Readonly<{
      commandId: string
      name: 'idea.activate'
      previousActiveIdeaId: string
      activeIdeaId: string
    }>
  | Readonly<{
      commandId: string
      name: 'card.create'
      cardId: string
      blockId: string
      position?: ProfileAgentCardPosition
    }>
  | Readonly<{
      commandId: string
      name: 'card.update-content'
      cardId: string
      blockId: string
    }>
  | Readonly<{
      commandId: string
      name: 'card.delete'
      cardId: string
    }>
  | Readonly<{
      commandId: string
      name: 'connection.create'
      route: 'direct'
      connectionIds: readonly [string]
      resultCardId: null
      resultCreated: false
    }>
  | Readonly<{
      commandId: string
      name: 'connection.create'
      route: 'through-result'
      connectionIds: readonly string[]
      resultCardId: string
      resultCreated: boolean
    }>
  | Readonly<{
      commandId: string
      name: 'connection.update-meaning'
      connectionId: string
    }>
  | Readonly<{
      commandId: string
      name: 'connection.delete'
      connectionId: string
    }>
  | Readonly<{
      commandId: string
      name: 'ask.set-model'
      cardId: string
      model: string
    }>
  | Readonly<{
      commandId: string
      name: 'card.set-identity'
      cardId: string
      identity: ProfileAgentCardSetIdentityCommand['payload']['identity']
    }>
  | Readonly<{
      commandId: string
      name: 'cards.arrange'
      cardIds: readonly string[]
    }>
  | Readonly<{
      commandId: string
      name: 'cards.reorder-layer'
      cardIds: readonly string[]
      direction: CardLayerDirection
    }>
  | Readonly<{
      commandId: string
      name: 'group.membership.set'
      cardId: string
      groupId: string | null
    }>
  | Readonly<{
      commandId: string
      name: 'output.choose-version'
      outputId: string
      versionId: string
    }>
  | Readonly<{
      commandId: string
      name: 'output.set-accepted'
      outputId: string
      versionId: string
      accepted: boolean
    }>
  | Readonly<{
      commandId: string
      name: 'mod-template.create'
      templateId: string
      templateVersion: number
    }>
  | Readonly<{
      commandId: string
      name: 'mod-template.update'
      templateId: string
      previousTemplateVersion: number
      newTemplateVersion: number
    }>
  | Readonly<{
      commandId: string
      name: 'mod-template.delete'
      templateId: string
      deletedTemplateVersion: number
    }>
  | Readonly<{
      commandId: string
      name: 'mod-instance.stamp'
      cardId: string
      blockId: string
      instanceId: string
      source: Readonly<{ kind: 'template'; templateId: string; templateVersion: number }>
      idMap: Readonly<{
        mod: Readonly<{ sourceId: string; instanceId: string }>
        controls: readonly Readonly<{ sourceId: string; instanceId: string }>[]
      }>
    }>
  | Readonly<{
      commandId: string
      name: 'mod-instance.create'
      cardId: string
      blockId: string
      instanceId: string
      source: Readonly<{ kind: 'direct' }>
    }>
  | Readonly<{
      commandId: string
      name: 'mod-instance.configure'
      cardId: string
      instanceId: string
    }>
  | Readonly<{
      commandId: string
      name: 'mod-instance.delete'
      cardId: string
      instanceId: string
    }>

export type ProfileAgentCommandPlan = Readonly<{
  version: 1
  profileId: string
  scope: ProfileAgentCommandScope
  ideaId?: string
  baseRevision: number
  proposedRevision: number
  dryRun: boolean
  attribution: ProfileAgentTrustedAttribution
  idempotency: Readonly<{
    key: string
    requestCanonicalJson: string
  }>
  revisionAudit?: Readonly<{
    kind: 'profile-revision'
    commitId: string
    committedAt: string
  }>
  headTransition?: Readonly<{
    kind: 'active-idea'
    commandId: string
    previousActiveIdeaId: string
    activeIdeaId: string
  }>
  commandResults: readonly ProfileAgentCommandResult[]
  recordChanges: readonly ProfileAgentRecordChange[]
  intentEventDrafts: readonly ProfileAgentLogicalIntentEventDraft[]
  profileAgentEventDrafts: readonly ProfileAgentEventDraft[]
  modStampSourceTemplates: readonly Readonly<{
    commandId: string
    template: ProfileLogicalRecordSpec
  }>[]
  affectedRecords: readonly Readonly<{
    recordId: string
    kind: ProfileLogicalRecordSpec['kind']
    operation: ProfileAgentRecordChange['operation']
  }>[]
}>

/** @deprecated Use ProfileAgentCommandPlan; retained for #524 callers. */
export type ProfileAgentBoardCommandPlan = ProfileAgentCommandPlan

export function planProfileAgentCommandBatch(
  document: ProfileLogicalDocument,
  candidate: unknown,
  trustedContext: ProfileAgentCommandTrustedContext,
  surfaceVersion: ProfileAgentCommandSurfaceVersion = 2,
): ProfileServiceResult<ProfileAgentBoardCommandPlan> {
  if (!isPlainRecord(trustedContext)
    || typeof trustedContext.deriveId !== 'function'
    || typeof trustedContext.contentSha256 !== 'function') {
    return profileServiceFailure('internal')
  }
  const authorized = authorizeProfileAgentCommandRequest(candidate, trustedContext, surfaceVersion)
  if (!authorized.ok) return authorized
  return planProfileAgentCommandBatchAuthorized(
    document,
    authorized.value,
    trustedContext,
    surfaceVersion,
  )
}

export function validateProfileAgentCommandRequest(
  candidate: unknown,
  allowedCommandNames: readonly ProfileAgentCommand['name'][],
  surfaceVersion: ProfileAgentCommandSurfaceVersion = 2,
): ProfileServiceResult<ProfileAgentCommandRequest> {
  const captured = captureRequest(candidate)
  if (!captured) return profileServiceFailure('invalid')
  if (!hasExactKeys(captured, [
    'commands',
    'dryRun',
    'expectedRevision',
    'idempotencyKey',
    'schemaVersion',
    'version',
  ])) return profileServiceFailure('invalid')
  if (futureVersion(captured.version) || futureVersion(captured.schemaVersion)) {
    return profileServiceFailure('unsupported-future-version', {
      supportedVersions: PROFILE_CONTRACT_VERSIONS,
    })
  }
  if (
    captured.version !== PROFILE_CONTRACT_VERSIONS.command
    || captured.schemaVersion !== PROFILE_CONTRACT_VERSIONS.schema
    || !nonNegativeSafeInteger(captured.expectedRevision)
    || typeof captured.dryRun !== 'boolean'
    || !boundedNonEmptyString(captured.idempotencyKey, PROFILE_AGENT_COMMAND_LIMITS.maxIdempotencyKeyBytes)
    || !Array.isArray(captured.commands)
    || captured.commands.length === 0
    || captured.commands.length > PROFILE_AGENT_COMMAND_LIMITS.maxCommands
  ) return profileServiceFailure('invalid')

  const commands: ProfileAgentCommand[] = []
  const commandIds = new Set<string>()
  const allowed = new Set(allowedCommandNames)
  let scope: ProfileAgentCommandScope | undefined
  for (const candidateCommand of captured.commands) {
    if (!hasExactKeys(candidateCommand, ['id', 'name', 'payload', 'version'])) {
      return profileServiceFailure('invalid')
    }
    if (futureVersion(candidateCommand.version)) {
      return profileServiceFailure('unsupported-future-version', {
        supportedVersions: PROFILE_CONTRACT_VERSIONS,
      })
    }
    if (candidateCommand.version !== PROFILE_CONTRACT_VERSIONS.command
      || !boundedNonEmptyString(candidateCommand.id, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
      || typeof candidateCommand.name !== 'string'
      || !isPlainRecord(candidateCommand.payload)) {
      return profileServiceFailure('invalid')
    }
    if (!allowed.has(candidateCommand.name as ProfileAgentCommand['name'])) {
      return profileServiceFailure('capability-denied')
    }
    const normalized = normalizeCommand(candidateCommand, surfaceVersion)
    if (normalized === 'future') {
      return profileServiceFailure('unsupported-future-version', {
        supportedVersions: PROFILE_CONTRACT_VERSIONS,
      })
    }
    if (normalized === 'denied') return profileServiceFailure('capability-denied')
    if (!normalized || commandIds.has(normalized.id)) return profileServiceFailure('invalid')
    commandIds.add(normalized.id)
    const commandScope = scopeForCommand(normalized)
    if (scope !== undefined && !sameCommandScope(scope, commandScope)) {
      return profileServiceFailure('invalid')
    }
    scope = commandScope
    commands.push(normalized)
  }
  if (!scope) return profileServiceFailure('invalid')
  if (commands.some((command) => command.name === 'idea.activate') && commands.length !== 1) {
    return profileServiceFailure('invalid')
  }
  return {
    ok: true,
    value: deepFreeze({
      version: PROFILE_CONTRACT_VERSIONS.command,
      schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
      expectedRevision: captured.expectedRevision,
      idempotencyKey: captured.idempotencyKey,
      dryRun: captured.dryRun,
      commands,
    }),
  }
}

function authorizeProfileAgentCommandRequest(
  candidate: unknown,
  trustedContext: ProfileAgentCommandTrustedContext,
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): ProfileServiceResult<ProfileAgentAuthorizedCommandBatch> {
  if (!validTrustedAttribution(trustedContext)) return profileServiceFailure('invalid')
  const validated = validateProfileAgentCommandRequest(candidate, [
    ...PROFILE_AGENT_BOARD_COMMAND_NAMES,
    ...PROFILE_AGENT_RESEARCH_COMMAND_NAMES,
    ...PROFILE_AGENT_MOD_COMMAND_NAMES,
    ...PROFILE_AGENT_IDEA_COMMAND_NAMES,
  ], surfaceVersion)
  if (!validated.ok) return validated
  const request = validated.value
  const scope = scopeForCommand(request.commands[0]!)
  if (
    request.commands.some(requiresProfileRevisionAudit)
    && (!boundedNonEmptyString(trustedContext.commitId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
      || !canonicalTimestamp(trustedContext.committedAt))
  ) return profileServiceFailure('internal')
  if (
    request.commands.some((command) => command.name === 'mod-instance.stamp')
    && !canonicalTimestamp(trustedContext.stampedAt)
  ) return profileServiceFailure('internal')

  const attribution = freezeJsonClone({
    profileId: trustedContext.profileId,
    actor: trustedContext.actor,
    clientTxnId: trustedContext.clientTxnId,
  }) as ProfileAgentTrustedAttribution
  const semanticRequest = {
    version: PROFILE_CONTRACT_VERSIONS.command,
    schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    expectedRevision: request.expectedRevision,
    commands: request.commands,
  }
  const requestCanonicalJson = canonicalJson(semanticRequest)
  const authorized = {
    version: PROFILE_CONTRACT_VERSIONS.command,
    schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    expectedRevision: request.expectedRevision,
    idempotencyKey: request.idempotencyKey,
    dryRun: request.dryRun,
    commands: request.commands,
    scope,
    attribution,
    requestCanonicalJson,
  }
  return { ok: true, value: deepFreeze(authorized) as ProfileAgentAuthorizedCommandBatch }
}

function planProfileAgentCommandBatchAuthorized(
  document: ProfileLogicalDocument,
  batch: ProfileAgentAuthorizedCommandBatch,
  trustedContext: ProfileAgentCommandTrustedContext,
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): ProfileServiceResult<ProfileAgentBoardCommandPlan> {
  let validatedDocument: ProfileLogicalDocument
  try {
    validatedDocument = validateProfileLogicalDocument(document)
  } catch {
    return profileServiceFailure('corrupt-or-recovery-required')
  }
  if (batch.attribution.profileId !== validatedDocument.head.profileId) {
    return profileServiceFailure('invalid')
  }
  if (batch.expectedRevision !== validatedDocument.head.revision) {
    return profileServiceFailure('conflict', { currentRevision: validatedDocument.head.revision })
  }
  const proposedRevision = validatedDocument.head.revision + 1
  if (!Number.isSafeInteger(proposedRevision)) {
    return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
  }

  const assetMetadata = new Map<string, ProfileLogicalAssetPayload>()
  let snapshot
  try {
    snapshot = cloneJson(hydrateProfileLogicalDocument(validatedDocument, (payload) => {
      assetMetadata.set(payload.id, payload)
      return hydrateProfileLogicalAsset(payload, `data:${payload.mimeType};base64,`)
    }, { validateLocalAssetBytes: false }))
  } catch {
    return profileServiceFailure('corrupt-or-recovery-required')
  }
  const ideaId = batch.scope.kind === 'idea' ? batch.scope.ideaId : undefined
  const board = ideaId === undefined ? undefined : snapshot.boards[ideaId]
  if (ideaId !== undefined && !board) return profileServiceFailure('not-found')

  const usedIds = new Set(validatedDocument.records.map((record) => record.recordId))
  for (const template of snapshot.modTemplates) {
    for (const { sourceId } of listModPartIdentities(template.payload.mod)) usedIds.add(sourceId)
  }
  for (const instance of snapshot.modInstances) {
    for (const { sourceId } of listModPartIdentities(instance.payload.mod)) usedIds.add(sourceId)
    if ('idMap' in instance.payload) {
      usedIds.add(instance.payload.idMap.mod.sourceId)
      usedIds.add(instance.payload.idMap.mod.instanceId)
      for (const pair of instance.payload.idMap.controls) {
        usedIds.add(pair.sourceId)
        usedIds.add(pair.instanceId)
      }
    }
  }
  const derive = (
    commandId: string,
    purpose: ProfileAgentDerivedIdPurpose,
    source?: Readonly<{ sourceId: string; ordinal: number }>,
  ) => {
    let derived: unknown
    try {
      const baseScope: ProfileAgentDerivedIdScopeBase = {
        profileId: validatedDocument.head.profileId,
        actorId: batch.attribution.actor.id,
        idempotencyKey: batch.idempotencyKey,
        requestCanonicalJson: batch.requestCanonicalJson,
        commandId,
      }
      let scope: ProfileAgentDerivedIdScope
      if (purpose === 'mod-instance') {
        if (!source || source.ordinal !== 0) return undefined
        scope = Object.freeze({ ...baseScope, purpose, sourceId: source.sourceId, ordinal: 0 })
      } else if (purpose === 'mod-control') {
        if (!source || !nonNegativeSafeInteger(source.ordinal)) return undefined
        scope = Object.freeze({ ...baseScope, purpose, ...source })
      } else {
        scope = Object.freeze({ ...baseScope, purpose })
      }
      derived = trustedContext.deriveId(scope)
    } catch {
      return undefined
    }
    if (!boundedNonEmptyString(derived, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes) || usedIds.has(derived)) {
      return undefined
    }
    usedIds.add(derived)
    return derived
  }

  const intentEventDrafts: ProfileAgentLogicalIntentEventDraft[] = []
  const profileAgentEventDrafts: ProfileAgentEventDraft[] = []
  const modStampSourceTemplates: Array<Readonly<{
    commandId: string
    template: ProfileLogicalRecordSpec
  }>> = []
  const commandResults: ProfileAgentCommandResult[] = []
  let headTransition: ProfileAgentCommandPlan['headTransition']
  const createdCardsByCommandId = new Map<string, Card>()
  const changedModTemplateIds = new Set<string>()
  const initialGroupIdByCardId = new Map(
    board?.cards.map((card) => [card.id, card.groupId] as const) ?? [],
  )
  for (const command of batch.commands) {
    if (command.name === 'idea.create') {
      const createdIdeaId = derive(command.id, 'idea')
      if (!createdIdeaId) {
        return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
      }
      const boardId = `board:${createdIdeaId}`
      const committedAt = trustedContext.committedAt
      if (!boundedNonEmptyString(boardId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || usedIds.has(boardId)
        || !canonicalTimestamp(committedAt)) {
        return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
      }
      usedIds.add(boardId)
      const idea: IdeaSummary = {
        id: createdIdeaId,
        name: command.payload.name,
        createdAt: committedAt,
        updatedAt: committedAt,
        lastOpenedAt: committedAt,
      }
      const emptyBoard: SavedBoard = {
        version: 1,
        cards: [],
        connections: [],
        outputs: [],
        runs: [],
        highlights: [],
        highlightTags: [],
        intentLog: [],
        compactionSummaries: [],
        updatedAt: committedAt,
      }
      snapshot.ideas.push(idea)
      snapshot.boards[createdIdeaId] = emptyBoard
      commandResults.push(Object.freeze({
        commandId: command.id,
        name: command.name,
        ideaId: createdIdeaId,
        boardId,
        ideaName: command.payload.name,
      }))
      profileAgentEventDrafts.push(Object.freeze({
        version: 1,
        type: 'idea.created',
        ideaId: createdIdeaId,
        boardId,
        ideaName: command.payload.name,
      }))
      continue
    }
    if (command.name === 'idea.activate') {
      const targetIdea = snapshot.ideas.find((idea) => idea.id === command.payload.ideaId)
      if (!targetIdea) return profileServiceFailure('not-found')
      if (!snapshot.boards[command.payload.ideaId]) {
        return profileServiceFailure('corrupt-or-recovery-required')
      }
      const previousActiveIdeaId = snapshot.activeIdeaId
      if (previousActiveIdeaId === command.payload.ideaId) return profileServiceFailure('invalid')
      const committedAt = trustedContext.committedAt
      if (!canonicalTimestamp(committedAt)) {
        return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
      }
      targetIdea.lastOpenedAt = Date.parse(committedAt) < Date.parse(targetIdea.lastOpenedAt)
        ? targetIdea.lastOpenedAt
        : committedAt
      snapshot.activeIdeaId = command.payload.ideaId
      headTransition = Object.freeze({
        kind: 'active-idea',
        commandId: command.id,
        previousActiveIdeaId,
        activeIdeaId: command.payload.ideaId,
      })
      commandResults.push(Object.freeze({
        commandId: command.id,
        name: command.name,
        previousActiveIdeaId,
        activeIdeaId: command.payload.ideaId,
      }))
      profileAgentEventDrafts.push(Object.freeze({
        version: 1,
        type: 'idea.activated',
        previousActiveIdeaId,
        activeIdeaId: command.payload.ideaId,
      }))
      continue
    }
    if (isProfileAgentResearchCommand(command)) {
      if (!board || ideaId === undefined) return profileServiceFailure('invalid')
      if (command.name === 'ask.set-model') {
        const target = resolveCardReference(board.cards, createdCardsByCommandId, command.payload.card)
        if (target === 'invalid') return profileServiceFailure('invalid')
        if (!target) return profileServiceFailure('not-found')
        if (target.kind !== 'askAi') return profileServiceFailure('capability-denied')
        // Read through the settings envelope, never off the raw bag. A Board
        // whose model list came from a build this one has never met would
        // otherwise throw here instead of denying the command, and a throw in
        // command planning is a far worse outcome than a denial (ADR 0040). A
        // Board with no AI settings at all still denies, exactly as before.
        if (!(boardAiSettingsOf(board)?.models ?? []).includes(command.payload.model)) {
          return profileServiceFailure('capability-denied')
        }
        if (target.model === command.payload.model) return profileServiceFailure('invalid')
        target.model = command.payload.model
        intentEventDrafts.push(freezeIntentDraft(ideaId, {
          type: 'card.content.edited',
          cardId: target.id,
          data: { field: 'model' },
        }))
        commandResults.push(Object.freeze({
          commandId: command.id,
          name: command.name,
          cardId: target.id,
          model: command.payload.model,
        }))
        continue
      }
      if (command.name === 'card.set-identity') {
        const target = resolveCardReference(board.cards, createdCardsByCommandId, command.payload.card)
        if (target === 'invalid') return profileServiceFailure('invalid')
        if (!target) return profileServiceFailure('not-found')
        if (target.kind === 'title') {
          return profileServiceFailure('capability-denied')
        }
        let modInstanceIndex: number | undefined
        if (target.kind === 'mod') {
          if (target.modV2 === undefined) return profileServiceFailure('capability-denied')
          const instanceIndexes = snapshot.modInstances.flatMap((instance, index) => (
            instance.parentId === target.id ? [index] : []
          ))
          if (instanceIndexes.length !== 1) {
            return instanceIndexes.length === 0
              ? profileServiceFailure('not-found')
              : profileServiceFailure('corrupt-or-recovery-required')
          }
          modInstanceIndex = instanceIndexes[0]!
          const instance = snapshot.modInstances[modInstanceIndex]!
          if ('idMap' in instance.payload
            && !stampedModOriginMatchesKnownTemplate(instance, snapshot.modTemplates)) {
            return profileServiceFailure('corrupt-or-recovery-required')
          }
        }
        if (command.payload.identity === null) {
          if (target.headerColor === undefined && target.headerFill === undefined) {
            return profileServiceFailure('invalid')
          }
          delete target.headerColor
          delete target.headerFill
        } else {
          const solid = cardIdentityPresetSolid(command.payload.identity.preset)
          if (!solid) return profileServiceFailure('invalid')
          const fill = command.payload.identity.fill === 'soft'
            ? 'half'
            : command.payload.identity.fill === 'body'
              ? 'full'
              : 'pattern'
          if (target.headerColor === solid
            && target.headerFill === fill
            && (target.kind !== 'mod' || target.modV2?.accent === solid)) {
            return profileServiceFailure('invalid')
          }
          target.headerColor = solid
          target.headerFill = fill
          if (target.kind === 'mod' && target.modV2 !== undefined
            && modInstanceIndex !== undefined) {
            const instance = snapshot.modInstances[modInstanceIndex]!
            const styledMod = { ...target.modV2, accent: solid }
            target.modV2 = styledMod
            snapshot.modInstances[modInstanceIndex] = replaceProfileModInstanceDocument(
              instance,
              cloneJson(styledMod),
            )
          }
        }
        intentEventDrafts.push(freezeIntentDraft(ideaId, {
          type: 'card.content.edited',
          cardId: target.id,
          data: { field: 'identity' },
        }))
        commandResults.push(Object.freeze({
          commandId: command.id,
          name: command.name,
          cardId: target.id,
          identity: cloneJson(command.payload.identity),
        }))
        continue
      }
      if (command.name === 'cards.arrange') {
        const resolvedFrames: Array<{
          cardId: string
          position: ProfileAgentCardPosition
          size?: Readonly<{ width: number; height: number }>
        }> = []
        const cardIds = new Set<string>()
        for (const frame of command.payload.frames) {
          const card = resolveCardReference(board.cards, createdCardsByCommandId, frame.card)
          if (card === 'invalid') return profileServiceFailure('invalid')
          if (!card) return profileServiceFailure('not-found')
          if (cardIds.has(card.id)) return profileServiceFailure('invalid')
          cardIds.add(card.id)
          resolvedFrames.push({
            cardId: card.id,
            position: { ...frame.position },
            ...(frame.size === undefined ? {} : { size: { ...frame.size } }),
          })
        }
        const beforeCards = board.cards
        const arranged = planCardFrameArrangement(beforeCards, resolvedFrames)
        if (!arranged.ok) {
          return arranged.reason === 'card-not-found'
            ? profileServiceFailure('not-found')
            : profileServiceFailure('invalid')
        }
        board.cards = arranged.cards
        if (!appendCardsArrangedIntentEvent(
          intentEventDrafts,
          ideaId,
          beforeCards,
          board.cards,
        )) return profileServiceFailure('invalid')
        refreshCreatedCardReferences(createdCardsByCommandId, board.cards)
        commandResults.push(Object.freeze({
          commandId: command.id,
          name: command.name,
          cardIds: Object.freeze([...cardIds]),
        }))
        continue
      }
      if (command.name === 'cards.reorder-layer') {
        const cardIds: string[] = []
        const seen = new Set<string>()
        for (const reference of command.payload.cards) {
          const card = resolveCardReference(board.cards, createdCardsByCommandId, reference)
          if (card === 'invalid') return profileServiceFailure('invalid')
          if (!card) return profileServiceFailure('not-found')
          if (seen.has(card.id)) return profileServiceFailure('invalid')
          seen.add(card.id)
          cardIds.push(card.id)
        }
        const beforeCards = board.cards
        board.cards = planCardLayerOrder(beforeCards, cardIds, command.payload.direction)
        if (!appendCardLayerIntentEvent(
          intentEventDrafts,
          ideaId,
          beforeCards,
          board.cards,
          command.payload.direction,
        )) return profileServiceFailure('invalid')
        refreshCreatedCardReferences(createdCardsByCommandId, board.cards)
        commandResults.push(Object.freeze({
          commandId: command.id,
          name: command.name,
          cardIds: Object.freeze(cardIds),
          direction: command.payload.direction,
        }))
        continue
      }
      if (command.name === 'group.membership.set') {
        const card = resolveCardReference(board.cards, createdCardsByCommandId, command.payload.card)
        const group = command.payload.group === null
          ? null
          : resolveCardReference(board.cards, createdCardsByCommandId, command.payload.group)
        if (card === 'invalid' || group === 'invalid') return profileServiceFailure('invalid')
        if (!card || group === undefined) return profileServiceFailure('not-found')
        if (card.groupId === group?.id) {
          // A prior command in this same batch may have reframed the Group and
          // geometrically absorbed this later requested member. Preserve the
          // public multi-member `group add/remove` operation by treating that
          // reached intermediate state as a no-op. A standalone mutation that
          // was already unchanged at admission remains invalid.
          if (initialGroupIdByCardId.has(card.id)
            && initialGroupIdByCardId.get(card.id) === group?.id) {
            return profileServiceFailure('invalid')
          }
          commandResults.push(Object.freeze({
            commandId: command.id,
            name: command.name,
            cardId: card.id,
            groupId: group?.id ?? null,
          }))
          continue
        }
        const beforeCards = board.cards
        const membership = planGroupMembership(beforeCards, card.id, group?.id ?? null)
        if (!membership.ok) {
          return membership.reason === 'card-not-found' || membership.reason === 'group-not-found'
            ? profileServiceFailure('not-found')
            : profileServiceFailure('invalid')
        }
        board.cards = membership.cards
        appendStructuralIntentEvents(intentEventDrafts, ideaId, beforeCards, board.cards)
        appendGroupMembershipIntentEvent(intentEventDrafts, ideaId, beforeCards, board.cards, group?.id)
        refreshCreatedCardReferences(createdCardsByCommandId, board.cards)
        commandResults.push(Object.freeze({
          commandId: command.id,
          name: command.name,
          cardId: card.id,
          groupId: group?.id ?? null,
        }))
        continue
      }
      const output = board.outputs.find((candidate) => candidate.id === command.payload.outputId)
      const version = output?.versions.find((candidate) => candidate.id === command.payload.versionId)
      if (!output || !version) return profileServiceFailure('not-found')
      if (command.name === 'output.choose-version') {
        if (output.chosenVersionId === version.id) return profileServiceFailure('invalid')
        const previousVersionId = output.chosenVersionId
        output.chosenVersionId = version.id
        intentEventDrafts.push(freezeIntentDraft(ideaId, {
          type: 'version.chosen',
          versionId: version.id,
          data: {
            outputId: output.id,
            ...(previousVersionId === undefined ? {} : { previousVersionId }),
            nextVersionId: version.id,
          },
        }))
        commandResults.push(Object.freeze({
          commandId: command.id,
          name: command.name,
          outputId: output.id,
          versionId: version.id,
        }))
        continue
      }
      if (Boolean(version.accepted) === command.payload.accepted) {
        return profileServiceFailure('invalid')
      }
      const previousAccepted = Boolean(version.accepted)
      version.accepted = command.payload.accepted
      intentEventDrafts.push(freezeIntentDraft(ideaId, {
        type: 'version.acceptance.changed',
        versionId: version.id,
        data: {
          outputId: output.id,
          from: previousAccepted,
          to: command.payload.accepted,
        },
      }))
      commandResults.push(Object.freeze({
        commandId: command.id,
        name: command.name,
        outputId: output.id,
        versionId: version.id,
        accepted: command.payload.accepted,
      }))
      continue
    }
    if (isProfileAgentModCommand(command)) {
      if (command.name === 'mod-instance.configure'
        || command.name === 'mod-instance.delete') {
        if (!board || ideaId === undefined) return profileServiceFailure('invalid')
        const cardIndex = board.cards.findIndex((card) => card.id === command.payload.cardId)
        const card = board.cards[cardIndex]
        if (!card) return profileServiceFailure('not-found')
        if (card.kind !== 'mod' || card.modV2 === undefined) {
          return profileServiceFailure('capability-denied')
        }
        const instanceIndexes = snapshot.modInstances.flatMap((instance, index) => (
          instance.parentId === card.id ? [index] : []
        ))
        if (instanceIndexes.length !== 1) {
          return instanceIndexes.length === 0
            ? profileServiceFailure('not-found')
            : profileServiceFailure('corrupt-or-recovery-required')
        }
        const instanceIndex = instanceIndexes[0]!
        const instance = snapshot.modInstances[instanceIndex]!
        if (command.name === 'mod-instance.configure') {
          if ('idMap' in instance.payload
            && !stampedModOriginMatchesKnownTemplate(instance, snapshot.modTemplates)) {
            return profileServiceFailure('corrupt-or-recovery-required')
          }
          if (!validModConfigureIdentityTransition(
            instance.payload.mod,
            command.payload.mod,
            (id) => usedIds.has(id),
          )) {
            return profileServiceFailure('invalid')
          }
          const configuredMod = cloneJson(command.payload.mod)
          card.modV2 = configuredMod
          snapshot.modInstances[instanceIndex] = replaceProfileModInstanceDocument(
            instance,
            cloneJson(configuredMod),
          )
          for (const { sourceId } of listModPartIdentities(configuredMod)) usedIds.add(sourceId)
          intentEventDrafts.push(freezeIntentDraft(ideaId, {
            type: 'card.content.edited',
            cardId: card.id,
            data: { field: 'modControl' },
          }))
          commandResults.push(Object.freeze({
            commandId: command.id,
            name: command.name,
            cardId: card.id,
            instanceId: instance.recordId,
          }))
          continue
        }
        const projectedCard = projectCardForIntent(card, assetMetadata)
        if (!projectedCard) {
          return profileServiceFailure('internal', {
            currentRevision: validatedDocument.head.revision,
          })
        }
        const deletedConnections = board.connections.filter((connection) => (
          connection.from.cardId === card.id || connection.to.cardId === card.id
        ))
        board.cards.splice(cardIndex, 1)
        board.connections = board.connections.filter((connection) => (
          connection.from.cardId !== card.id && connection.to.cardId !== card.id
        ))
        snapshot.modInstances.splice(instanceIndex, 1)
        intentEventDrafts.push(freezeIntentDraft(ideaId, cloneJson({
          type: 'card.deleted',
          cardId: card.id,
          data: {
            card: projectedCard,
            connections: cloneJson(deletedConnections),
            outputs: [],
          },
        }) as ProfileJsonValue))
        commandResults.push(Object.freeze({
          commandId: command.id,
          name: command.name,
          cardId: card.id,
          instanceId: instance.recordId,
        }))
        continue
      }
      const stampTemplateOrdinal = command.name === 'mod-instance.stamp'
        ? snapshot.modTemplates.findIndex((template) => (
            template.recordId === command.payload.templateId
          ))
        : -1
      const stampTemplate = stampTemplateOrdinal < 0
        ? undefined
        : snapshot.modTemplates[stampTemplateOrdinal]
      const stampSourceTemplate = stampTemplate === undefined
        ? undefined
        : Object.freeze({
            commandId: command.id,
            template: Object.freeze({
              recordId: stampTemplate.recordId,
              kind: 'mod-template' as const,
              ownerId: stampTemplate.ownerId,
              parentId: stampTemplate.parentId,
              ordinal: stampTemplateOrdinal,
              recordVersion: stampTemplate.recordVersion,
              payload: cloneJson(stampTemplate.payload) as ProfileLogicalRecordSpec['payload'],
            }),
          })
      const boardRecordId = ideaId === undefined
        ? undefined
        : validatedDocument.records.find((record) => (
            record.kind === 'board' && record.ownerId === ideaId
          ))?.recordId
      const step = planProfileAgentModCommandStep(command, {
        snapshot,
        board,
        boardRecordId,
        profileId: validatedDocument.head.profileId,
        currentRevision: validatedDocument.head.revision,
        committedAt: trustedContext.committedAt as string,
        stampedAt: trustedContext.stampedAt as string,
        templateChangedInRevision: 'templateId' in command.payload
          && changedModTemplateIds.has(command.payload.templateId),
        isIdReserved: (id) => usedIds.has(id),
        reserveId: (id) => { usedIds.add(id) },
        derive: (purpose, source) => derive(command.id, purpose, source),
      })
      if (!step.ok) return step
      const result = step.value.result
      commandResults.push(result)
      if (result.name === 'mod-instance.stamp') {
        if (!stampSourceTemplate
          || stampSourceTemplate.template.recordId !== result.source.templateId
          || !isPlainRecord(stampSourceTemplate.template.payload)
          || stampSourceTemplate.template.payload.templateVersion
            !== result.source.templateVersion) {
          return profileServiceFailure('internal', {
            currentRevision: validatedDocument.head.revision,
          })
        }
        modStampSourceTemplates.push(stampSourceTemplate)
      }
      if (result.name === 'mod-template.create' || result.name === 'mod-template.update') {
        changedModTemplateIds.add(result.templateId)
      }
      switch (result.name) {
        case 'mod-template.create':
          profileAgentEventDrafts.push(Object.freeze({
            version: 1,
            type: 'mod-template.created',
            templateId: result.templateId,
            templateVersion: result.templateVersion,
          }))
          break
        case 'mod-template.update':
          profileAgentEventDrafts.push(Object.freeze({
            version: 1,
            type: 'mod-template.updated',
            templateId: result.templateId,
            previousTemplateVersion: result.previousTemplateVersion,
            newTemplateVersion: result.newTemplateVersion,
          }))
          break
        case 'mod-template.delete':
          profileAgentEventDrafts.push(Object.freeze({
            version: 1,
            type: 'mod-template.deleted',
            templateId: result.templateId,
            deletedTemplateVersion: result.deletedTemplateVersion,
          }))
          break
      }
      if (step.value.placedCard && ideaId !== undefined) {
        createdCardsByCommandId.set(command.id, step.value.placedCard)
        intentEventDrafts.push(freezeIntentDraft(ideaId, {
          type: 'card.created',
          cardId: step.value.placedCard.id,
          data: { card: cloneJson(step.value.placedCard) },
        }))
      }
      continue
    }
    if (!board || ideaId === undefined) return profileServiceFailure('invalid')
    if (command.name === 'card.create') {
      const cardId = derive(command.id, 'card')
      const blockId = derive(command.id, 'block')
      if (!cardId || !blockId) {
        return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
      }
      let position: ProfileAgentCardPosition
      if ('near' in command.payload && command.payload.near !== undefined) {
        const placement = findAgentCardPlacement({
          cards: board.cards,
          connections: board.connections,
          anchorCardIds: command.payload.near,
          kind: command.payload.kind,
          maxAbsoluteCoordinate: PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate,
        })
        if (!placement.ok) {
          return placement.reason === 'anchor-not-found'
            ? profileServiceFailure('not-found', {
                currentRevision: validatedDocument.head.revision,
              })
            : profileServiceFailure('invalid', {
                currentRevision: validatedDocument.head.revision,
              })
        }
        position = placement.position
      } else {
        position = { ...command.payload.position }
      }
      const body = 'text' in command.payload
        ? command.payload.text ?? ''
        : 'body' in command.payload
          ? command.payload.body
          : 'topic' in command.payload
            ? command.payload.topic
            : ''
      const placedCard = placeCreatedCard(board.cards, {
        id: cardId,
        kind: command.payload.kind,
        blocks: [{ id: blockId, text: body }],
        position,
        ...(command.payload.kind === 'title' ? { size: { width: 320, height: 82 } } : {}),
        ...('groupTitle' in command.payload ? {
          title: command.payload.groupTitle,
          compressionPrompt: command.payload.compressionPrompt,
        } : {}),
        ...('topic' in command.payload ? {
          conversationStyle: command.payload.conversationStyle,
          conversationTurns: command.payload.conversationTurns,
        } : {}),
      })
      board.cards = reconcileGroupMembership([...board.cards, placedCard])
      const createdCard = board.cards[board.cards.length - 1]
      if (!createdCard || createdCard.id !== cardId) {
        return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
      }
      createdCardsByCommandId.set(command.id, createdCard)
      intentEventDrafts.push(freezeIntentDraft(ideaId, {
        type: 'card.created',
        cardId,
        data: { card: cloneJson(placedCard) },
      }))
      commandResults.push(Object.freeze({
        commandId: command.id,
        name: command.name,
        cardId,
        blockId,
        ...(surfaceVersion >= 3 ? { position: Object.freeze({ ...placedCard.position }) } : {}),
      }))
      continue
    }
    if (command.name === 'card.update-content') {
      const update = command.payload
      const target = board.cards.find((card) => card.id === update.cardId)
      if (!target) return profileServiceFailure('not-found')
      let currentBlock = target.blocks[0]
      if (!currentBlock) return profileServiceFailure('not-found')
      const appendContentEdit = (
        field: 'body' | 'title' | 'groupPrompt' | 'conversationSettings',
        text?: string,
      ): boolean => {
        if (text === undefined) {
          intentEventDrafts.push(freezeIntentDraft(ideaId, {
            type: 'card.content.edited', cardId: target.id, data: { field },
          }))
          return true
        }
        const contentSha256 = trustedContext.contentSha256(text)
        if (!/^[0-9a-f]{64}$/.test(contentSha256)) return false
        intentEventDrafts.push(freezeIntentDraft(ideaId, {
          type: 'card.content.edited',
          cardId: target.id,
          data: { field, textLength: text.length, contentSha256 },
        }))
        return true
      }
      if (isLegacyCardUpdatePayload(update)) {
        if (target.kind !== 'note' && target.kind !== 'askAi') {
          return profileServiceFailure('capability-denied')
        }
        const blockIndex = target.blocks.findIndex((block) => block.id === update.blockId)
        if (blockIndex < 0) return profileServiceFailure('not-found')
        currentBlock = target.blocks[blockIndex]
        if (!currentBlock) return profileServiceFailure('not-found')
        target.blocks[blockIndex] = { ...currentBlock, text: update.text }
        if (!appendContentEdit('body', update.text)) {
          return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
        }
      } else if (isBodyCardUpdatePayload(update)) {
        if (target.kind !== 'note' && target.kind !== 'askAi' && target.kind !== 'title') {
          return profileServiceFailure('capability-denied')
        }
        target.blocks[0] = { ...currentBlock, text: update.body }
        if (!appendContentEdit('body', update.body)) {
          return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
        }
      } else if (isGroupCardUpdatePayload(update)) {
        if (target.kind !== 'group') return profileServiceFailure('capability-denied')
        if (update.groupTitle !== undefined) {
          target.title = update.groupTitle
          if (!appendContentEdit('title', update.groupTitle)) {
            return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
          }
        }
        if (update.compressionPrompt !== undefined) {
          target.compressionPrompt = update.compressionPrompt
          if (!appendContentEdit('groupPrompt', update.compressionPrompt)) {
            return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
          }
        }
      } else {
        if (target.kind !== 'conversation') return profileServiceFailure('capability-denied')
        if (update.topic !== undefined) {
          target.blocks[0] = { ...currentBlock, text: update.topic }
          if (!appendContentEdit('body', update.topic)) {
            return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
          }
        }
        if (update.conversationStyle !== undefined) {
          target.conversationStyle = update.conversationStyle
        }
        if (update.conversationTurns !== undefined) {
          target.conversationTurns = update.conversationTurns
        }
        if (update.conversationStyle !== undefined
          || update.conversationTurns !== undefined) {
          appendContentEdit('conversationSettings')
        }
      }
      commandResults.push(Object.freeze({
        commandId: command.id,
        name: command.name,
        cardId: target.id,
        blockId: currentBlock.id,
      }))
      continue
    }
    if (command.name === 'card.delete') {
      const cardIndex = board.cards.findIndex((card) => card.id === command.payload.cardId)
      const deleted = board.cards[cardIndex]
      if (!deleted) return profileServiceFailure('not-found')
      const kindAllowed = surfaceVersion < 3
        ? deleted.kind === 'note' || deleted.kind === 'askAi'
        : PROFILE_AGENT_CARD_DELETE_KINDS.some((kind) => kind === deleted.kind)
      if (!kindAllowed) return profileServiceFailure('capability-denied')
      const projectedCard = projectCardForIntent(deleted, assetMetadata)
      if (!projectedCard) {
        return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
      }
      const deletedConnections = board.connections.filter((connection) => (
        connection.from.cardId === deleted.id || connection.to.cardId === deleted.id
      ))
      const deletedOutputs = board.outputs.filter((output) => output.resultCardId === deleted.id)
      const memberIds = deleted.kind === 'group'
        ? board.cards
            .filter((card) => card.groupId === deleted.id)
            .map((card) => card.id)
            .sort(compareStrings)
        : undefined
      board.cards = board.cards
        .filter((card) => card.id !== deleted.id)
        .map((card) => {
          if (deleted.kind !== 'group' || card.groupId !== deleted.id) return card
          const { groupId: _groupId, ...ungrouped } = card
          return ungrouped
        })
      board.connections = board.connections.filter((connection) => (
        connection.from.cardId !== deleted.id && connection.to.cardId !== deleted.id
      ))
      board.outputs = board.outputs.filter((output) => output.resultCardId !== deleted.id)
      if (board.highlights !== undefined) {
        board.highlights = board.highlights.filter((highlight) => highlight.cardId !== deleted.id)
      }
      snapshot.modInstances = snapshot.modInstances.filter((instance) => instance.parentId !== deleted.id)
      intentEventDrafts.push(freezeIntentDraft(ideaId, cloneJson({
        type: 'card.deleted',
        cardId: deleted.id,
        data: {
          card: projectedCard,
          connections: deletedConnections,
          ...(memberIds === undefined ? {} : { memberIds }),
          outputs: deletedOutputs,
        },
      }) as ProfileJsonValue))
      commandResults.push(Object.freeze({
        commandId: command.id,
        name: command.name,
        cardId: deleted.id,
      }))
      continue
    }
    if (command.name === 'connection.create') {
      const fromResolution = resolveCardReference(board.cards, createdCardsByCommandId, command.payload.from)
      const toResolution = resolveCardReference(board.cards, createdCardsByCommandId, command.payload.to)
      if (fromResolution === 'invalid' || toResolution === 'invalid') return profileServiceFailure('invalid')
      if (!fromResolution || !toResolution) return profileServiceFailure('not-found')
      if (fromResolution.id === toResolution.id) return profileServiceFailure('invalid')
      if (surfaceVersion >= 5
        && (fromResolution.kind === 'mod' || toResolution.kind === 'mod')) {
        if (fromResolution.kind !== 'mod'
          || (toResolution.kind !== 'askAi' && toResolution.kind !== 'conversation')
          || command.payload.polarity !== 'helps'
          || command.payload.reason !== undefined
          || command.payload.groupMode !== undefined) {
          return profileServiceFailure('invalid')
        }
      }
      const fromContract = contractFor(fromResolution.kind)
      const toContract = contractFor(toResolution.kind)
      if (!fromContract.connectionDefaults.connectable || !toContract.connectionDefaults.connectable) {
        return profileServiceFailure('capability-denied')
      }

      // A batch mutates this synthetic Board between commands. Build a fresh
      // index for every connection plan so admission sees earlier commands;
      // the shared identity cache intentionally assumes immutable arrays.
      const graph = createGraphIndex(board)
      const addition = planConnectionAddition(graph, fromResolution.id, toResolution.id)
      if (!addition) return profileServiceFailure('invalid')
      const source = graph.cardById(addition.sourceCardId)
      const target = graph.cardById(addition.targetCardId)
      if (!source || !target) {
        return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
      }
      if (command.payload.groupMode !== undefined && source.kind !== 'group') {
        return profileServiceFailure('invalid')
      }
      if (addition.kind === 'throughResult') {
        let routedSource = addition.resultCardId === null
          ? undefined
          : graph.cardById(addition.resultCardId)
        if (addition.resultCardId !== null && !routedSource) {
          return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
        }
        const connectionIds: string[] = []
        let resultCreated = false
        if (!routedSource) {
          // The empty Result shell is graph structure, not generated output.
          // It is the same reversible Ask-chain shape the canvas creates;
          // only a Run may add Output, versions, or generated content.
          const resultCardId = derive(command.id, 'result-card')
          const resultBlockId = derive(command.id, 'result-block')
          const sourceResultConnectionId = derive(command.id, 'source-result-connection')
          if (!resultCardId || !resultBlockId || !sourceResultConnectionId) {
            return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
          }
          routedSource = {
            id: resultCardId,
            kind: 'result',
            blocks: [{ id: resultBlockId, text: '' }],
            position: findResultCardPosition(board.cards, source),
          }
          const sourceResult = defaultConnection(
            sourceResultConnectionId,
            addition.sourceCardId,
            routedSource.id,
            'feeds',
          )
          board.cards.push(routedSource)
          board.connections.push(sourceResult)
          resultCreated = true
          connectionIds.push(sourceResultConnectionId)
          intentEventDrafts.push(
            freezeIntentDraft(ideaId, {
              type: 'card.created',
              cardId: routedSource.id,
              data: { card: cloneJson(routedSource) },
            }),
            freezeIntentDraft(ideaId, {
              type: 'connection.created',
              connectionId: sourceResult.id,
              data: { connection: cloneJson(sourceResult) },
            }),
          )
        }
        const routedConnectionId = derive(command.id, 'routed-connection')
        if (!routedConnectionId) {
          return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
        }
        const routed = connectionWithMeaning(
          routedConnectionId,
          routedSource.id,
          addition.targetCardId,
          'feeds',
          command.payload,
        )
        board.connections.push(routed)
        connectionIds.push(routed.id)
        intentEventDrafts.push(freezeIntentDraft(ideaId, {
          type: 'connection.created',
          connectionId: routed.id,
          data: { connection: cloneJson(routed) },
        }))
        commandResults.push(Object.freeze({
          commandId: command.id,
          name: command.name,
          route: 'through-result',
          connectionIds: Object.freeze(connectionIds),
          resultCardId: routedSource.id,
          resultCreated,
        }))
        continue
      }
      const connectionId = derive(command.id, 'connection')
      if (!connectionId) {
        return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
      }
      const created = connectionWithMeaning(
        connectionId,
        addition.sourceCardId,
        addition.targetCardId,
        addition.role,
        command.payload,
      )
      if (surfaceVersion >= 5 && fromResolution.kind === 'mod'
        && created.role !== 'modifies') {
        return profileServiceFailure('internal', {
          currentRevision: validatedDocument.head.revision,
        })
      }
      board.connections.push(created)
      intentEventDrafts.push(freezeIntentDraft(ideaId, {
        type: 'connection.created',
        connectionId: created.id,
        data: { connection: cloneJson(created) },
      }))
      commandResults.push(Object.freeze({
        commandId: command.id,
        name: command.name,
        route: 'direct',
        connectionIds: Object.freeze([created.id] as [string]),
        resultCardId: null,
        resultCreated: false,
      }))
      continue
    }
    if (command.name === 'connection.update-meaning') {
      const connectionIndex = board.connections.findIndex((connection) => (
        connection.id === command.payload.connectionId
      ))
      const before = board.connections[connectionIndex]
      if (!before) return profileServiceFailure('not-found')
      const source = board.cards.find((card) => card.id === before.from.cardId)
      if (!source) return profileServiceFailure('not-found')
      if (command.payload.groupMode !== undefined && source.kind !== 'group') {
        return profileServiceFailure('invalid')
      }
      if (surfaceVersion >= 5 && source.kind === 'mod'
        && ((command.payload.polarity !== undefined && command.payload.polarity !== 'helps')
          || command.payload.groupMode !== undefined
          || hasOwn(command.payload, 'reason'))) {
        return profileServiceFailure('invalid')
      }
      const after: Connection = {
        ...before,
        ...(command.payload.strength === undefined ? {} : { strength: command.payload.strength }),
        ...(command.payload.polarity === undefined ? {} : { polarity: command.payload.polarity }),
        ...(command.payload.groupMode === undefined
          ? {}
          : { meta: { ...before.meta, groupMode: command.payload.groupMode } }),
      }
      if (hasOwn(command.payload, 'reason')) {
        const reason = command.payload.reason?.trim()
        if (reason) after.reason = reason
        else delete after.reason
      }
      if (canonicalJson(before) === canonicalJson(after)) return profileServiceFailure('invalid')
      board.connections[connectionIndex] = after
      intentEventDrafts.push(freezeIntentDraft(ideaId, {
        type: 'connection.changed',
        connectionId: after.id,
        data: { before: cloneJson(before), after: cloneJson(after) },
      }))
      commandResults.push(Object.freeze({
        commandId: command.id,
        name: command.name,
        connectionId: after.id,
      }))
      continue
    }
    if (command.name === 'connection.delete') {
      const connectionIndex = board.connections.findIndex((connection) => (
        connection.id === command.payload.connectionId
      ))
      const deleted = board.connections[connectionIndex]
      if (!deleted) return profileServiceFailure('not-found')
      board.connections.splice(connectionIndex, 1)
      intentEventDrafts.push(freezeIntentDraft(ideaId, {
        type: 'connection.deleted',
        connectionId: deleted.id,
        data: { connection: cloneJson(deleted) },
      }))
      commandResults.push(Object.freeze({
        commandId: command.id,
        name: command.name,
        connectionId: deleted.id,
      }))
      continue
    }
    return profileServiceFailure('capability-denied')
  }

  if (intentEventDrafts.length > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxIntentEventIds) {
    return profileServiceFailure('invalid', { currentRevision: validatedDocument.head.revision })
  }

  snapshot.revision = proposedRevision
  let targetDocument: ProfileLogicalDocument
  try {
    targetDocument = projectProfileSnapshot(snapshot, (asset) => {
      const metadata = assetMetadata.get(asset.id)
      if (!metadata) throw new Error(`Profile asset ${asset.id} metadata is unavailable`)
      return metadata
    })
    targetDocument = stampProfileCardAuthorship(validatedDocument, targetDocument, {
      kind: 'agent',
      client: batch.attribution.actor.client,
      sessionId: batch.attribution.actor.sessionId,
    }, {
      // Persisted v1/v2 receipts replay their original ordinal-sensitive Card
      // attribution exactly. Surface v3 owns Group-member meaning and ignores
      // incidental top-level Board reindexing.
      logicalMeaning: surfaceVersion >= 3 ? 'current' : 'legacy-agent',
    })
    for (let index = 0; index < intentEventDrafts.length; index += 1) {
      const draft = intentEventDrafts[index]!
      const event = draft.event
      if (!isPlainRecord(event)
        || event.type !== 'card.created'
        || typeof event.cardId !== 'string'
        || !isPlainRecord(event.data)
        || !isPlainRecord(event.data.card)) continue
      const cardRecord = targetDocument.records.find((record) => (
        record.kind === 'card' && record.recordId === event.cardId
      ))
      if (!cardRecord || !isPlainRecord(cardRecord.payload)) continue
      intentEventDrafts[index] = freezeIntentDraft(draft.ideaId, {
        ...event,
        data: {
          ...event.data,
          card: {
            ...event.data.card,
            createdBy: cardRecord.payload.createdBy,
            lastModifiedBy: cardRecord.payload.lastModifiedBy,
          },
        },
      } as ProfileJsonValue)
    }
  } catch {
    return profileServiceFailure('internal', { currentRevision: validatedDocument.head.revision })
  }
  const recordChanges = diffLogicalRecords(validatedDocument, targetDocument)
  const affectedRecords = recordChanges.map((change) => {
    const record = change.operation === 'delete' ? change.before : change.after
    return Object.freeze({
      recordId: record.recordId,
      kind: record.kind,
      operation: change.operation,
    })
  })
  const value: ProfileAgentBoardCommandPlan = {
    version: 1,
    profileId: validatedDocument.head.profileId,
    scope: batch.scope,
    ...(ideaId === undefined ? {} : { ideaId }),
    baseRevision: validatedDocument.head.revision,
    proposedRevision,
    dryRun: batch.dryRun,
    attribution: batch.attribution,
    idempotency: Object.freeze({
      key: batch.idempotencyKey,
      requestCanonicalJson: batch.requestCanonicalJson,
    }),
    ...(batch.commands.some(requiresProfileRevisionAudit) ? {
      revisionAudit: Object.freeze({
        kind: 'profile-revision' as const,
        commitId: trustedContext.commitId as string,
        committedAt: trustedContext.committedAt as string,
      }),
    } : {}),
    ...(headTransition === undefined ? {} : { headTransition }),
    commandResults: Object.freeze(commandResults),
    recordChanges: Object.freeze(recordChanges),
    intentEventDrafts: Object.freeze(intentEventDrafts),
    profileAgentEventDrafts: Object.freeze(profileAgentEventDrafts),
    modStampSourceTemplates: Object.freeze(modStampSourceTemplates),
    affectedRecords: Object.freeze(affectedRecords),
  }
  return { ok: true, value: deepFreeze(value) }
}

function normalizeCommand(
  value: unknown,
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): ProfileAgentCommand | 'future' | 'denied' | undefined {
  if (!hasExactKeys(value, ['id', 'name', 'payload', 'version'])) return undefined
  if (futureVersion(value.version)) return 'future'
  if (
    value.version !== PROFILE_CONTRACT_VERSIONS.command
    || !boundedNonEmptyString(value.id, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
    || typeof value.name !== 'string'
    || !isPlainRecord(value.payload)
  ) return undefined
  if (
    !PROFILE_AGENT_BOARD_COMMAND_NAMES.includes(value.name as ProfileAgentBoardCommandName)
    && !PROFILE_AGENT_RESEARCH_COMMAND_NAMES.includes(value.name as ProfileAgentResearchCommandName)
    && !PROFILE_AGENT_MOD_COMMAND_NAMES.includes(value.name as ProfileAgentModCommandName)
    && !PROFILE_AGENT_IDEA_COMMAND_NAMES.includes(value.name as ProfileAgentIdeaCommandName)
  ) return 'denied'

  const payload = value.payload
  switch (value.name as
    | ProfileAgentBoardCommandName
    | ProfileAgentResearchCommandName
    | ProfileAgentModCommandName
    | ProfileAgentIdeaCommandName) {
    case 'idea.create': {
      if (surfaceVersion < 4) return 'denied'
      if (!hasExactKeys(payload, ['name']) || typeof payload.name !== 'string') return undefined
      const name = payload.name.trim()
      if (!boundedNonEmptyString(name, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes)) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'idea.create',
        payload: { name },
      }
    }
    case 'idea.activate': {
      if (surfaceVersion < 5) return 'denied'
      if (!hasExactKeys(payload, ['ideaId'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)) {
        return undefined
      }
      return {
        version: 1,
        id: value.id,
        name: 'idea.activate',
        payload: { ideaId: payload.ideaId },
      }
    }
    case 'ask.set-model': {
      if (surfaceVersion < 5) return 'denied'
      if (!hasExactKeys(payload, ['card', 'ideaId', 'model'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !validCardReference(payload.card)
        || typeof payload.model !== 'string') return undefined
      const model = payload.model.trim()
      if (!boundedNonEmptyString(model, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes)) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'ask.set-model',
        payload: { ideaId: payload.ideaId, card: cloneCardReference(payload.card), model },
      }
    }
    case 'card.set-identity': {
      if (surfaceVersion < 5) return 'denied'
      if (!hasExactKeys(payload, ['card', 'ideaId', 'identity'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !validCardReference(payload.card)) return undefined
      if (payload.identity === null) {
        return {
          version: 1,
          id: value.id,
          name: 'card.set-identity',
          payload: { ideaId: payload.ideaId, card: cloneCardReference(payload.card), identity: null },
        }
      }
      if (!hasExactKeys(payload.identity, ['fill', 'preset'])
        || typeof payload.identity.preset !== 'string'
        || cardIdentityPresetSolid(payload.identity.preset) === undefined
        || (payload.identity.fill !== 'soft'
          && payload.identity.fill !== 'body'
          && payload.identity.fill !== 'pattern')) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'card.set-identity',
        payload: {
          ideaId: payload.ideaId,
          card: cloneCardReference(payload.card),
          identity: {
            preset: payload.identity.preset as CardIdentityPresetId,
            fill: payload.identity.fill,
          },
        },
      }
    }
    case 'cards.arrange': {
      if (surfaceVersion < 5) return 'denied'
      if (!hasExactKeys(payload, ['frames', 'ideaId'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !Array.isArray(payload.frames)
        || payload.frames.length === 0
        || payload.frames.length > 100) return undefined
      const frames: ProfileAgentCardsArrangeCommand['payload']['frames'][number][] = []
      for (const frame of payload.frames) {
        if (!hasOnlyKeys(frame, ['card', 'position', 'size'])
          || !hasRequiredKeys(frame, ['card', 'position'])
          || !validCardReference(frame.card)
          || !hasExactKeys(frame.position, ['x', 'y'])
          || !boundedCoordinate(frame.position.x)
          || !boundedCoordinate(frame.position.y)
          || (frame.size !== undefined
            && (!hasExactKeys(frame.size, ['height', 'width'])
              || !boundedDimension(frame.size.width)
              || !boundedDimension(frame.size.height)))) return undefined
        frames.push({
          card: cloneCardReference(frame.card),
          position: { x: frame.position.x, y: frame.position.y },
          ...(frame.size === undefined
            ? {}
            : { size: { width: frame.size.width, height: frame.size.height } }),
        })
      }
      return {
        version: 1,
        id: value.id,
        name: 'cards.arrange',
        payload: { ideaId: payload.ideaId, frames },
      }
    }
    case 'cards.reorder-layer': {
      if (surfaceVersion < 5) return 'denied'
      if (!hasExactKeys(payload, ['cards', 'direction', 'ideaId'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !Array.isArray(payload.cards)
        || payload.cards.length === 0
        || payload.cards.length > 100
        || payload.cards.some((card) => !validCardReference(card))
        || (payload.direction !== 'front' && payload.direction !== 'back')) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'cards.reorder-layer',
        payload: {
          ideaId: payload.ideaId,
          cards: payload.cards.map(cloneCardReference),
          direction: payload.direction,
        },
      }
    }
    case 'group.membership.set': {
      if (surfaceVersion < 5) return 'denied'
      if (!hasExactKeys(payload, ['card', 'group', 'ideaId'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !validCardReference(payload.card)
        || (payload.group !== null && !validCardReference(payload.group))) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'group.membership.set',
        payload: {
          ideaId: payload.ideaId,
          card: cloneCardReference(payload.card),
          group: payload.group === null ? null : cloneCardReference(payload.group),
        },
      }
    }
    case 'output.choose-version':
    case 'output.set-accepted': {
      if (surfaceVersion < 5) return 'denied'
      const acceptedCommand = value.name === 'output.set-accepted'
      const keys = acceptedCommand
        ? ['accepted', 'ideaId', 'outputId', 'versionId']
        : ['ideaId', 'outputId', 'versionId']
      if (!hasExactKeys(payload, keys)
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedNonEmptyString(payload.outputId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedNonEmptyString(payload.versionId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || (acceptedCommand && typeof payload.accepted !== 'boolean')) return undefined
      return acceptedCommand
        ? {
            version: 1,
            id: value.id,
            name: 'output.set-accepted',
            payload: {
              ideaId: payload.ideaId,
              outputId: payload.outputId,
              versionId: payload.versionId,
              accepted: payload.accepted as boolean,
            },
          }
        : {
            version: 1,
            id: value.id,
            name: 'output.choose-version',
            payload: {
              ideaId: payload.ideaId,
              outputId: payload.outputId,
              versionId: payload.versionId,
            },
          }
    }
    case 'card.create': {
      if (surfaceVersion >= 3) {
        return normalizeV3CardCreateCommand(value.id, payload)
      }
      if (
        !hasOnlyKeys(payload, ['ideaId', 'kind', 'position', 'text'])
        || !hasRequiredKeys(payload, ['ideaId', 'kind', 'position'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || (payload.kind !== 'note' && payload.kind !== 'askAi')
        || !hasExactKeys(payload.position, ['x', 'y'])
        || !boundedCoordinate(payload.position.x)
        || !boundedCoordinate(payload.position.y)
        || (payload.text !== undefined && !boundedString(payload.text, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes))
      ) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'card.create',
        payload: {
          ideaId: payload.ideaId,
          kind: payload.kind,
          position: { x: payload.position.x, y: payload.position.y },
          text: payload.text ?? '',
        },
      }
    }
    case 'card.update-content': {
      if (surfaceVersion >= 3) {
        return normalizeV3CardUpdateCommand(value.id, payload)
      }
      if (
        !hasExactKeys(payload, ['blockId', 'cardId', 'ideaId', 'text'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedNonEmptyString(payload.cardId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedNonEmptyString(payload.blockId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedString(payload.text, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes)
      ) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'card.update-content',
        payload: {
          ideaId: payload.ideaId,
          cardId: payload.cardId,
          blockId: payload.blockId,
          text: payload.text,
        },
      }
    }
    case 'card.delete': {
      if (
        !hasExactKeys(payload, ['cardId', 'ideaId'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedNonEmptyString(payload.cardId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
      ) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'card.delete',
        payload: { ideaId: payload.ideaId, cardId: payload.cardId },
      }
    }
    case 'connection.create': {
      if (
        !hasOnlyKeys(payload, ['from', 'groupMode', 'ideaId', 'polarity', 'reason', 'strength', 'to'])
        || !hasRequiredKeys(payload, ['from', 'ideaId', 'to'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !validCardReference(payload.from)
        || !validCardReference(payload.to)
        || !validOptionalStrength(payload.strength)
        || !validOptionalPolarity(payload.polarity)
        || !validOptionalGroupMode(payload.groupMode)
        || (payload.reason !== undefined
          && !boundedString(payload.reason, PROFILE_AGENT_COMMAND_LIMITS.maxReasonBytes))
      ) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'connection.create',
        payload: {
          ideaId: payload.ideaId,
          from: cloneCardReference(payload.from),
          to: cloneCardReference(payload.to),
          strength: payload.strength ?? 'strong',
          polarity: payload.polarity ?? 'helps',
          ...(payload.reason?.trim() ? { reason: payload.reason.trim() } : {}),
          ...(payload.groupMode === undefined ? {} : { groupMode: payload.groupMode }),
        },
      }
    }
    case 'connection.update-meaning': {
      if (
        !hasOnlyKeys(payload, ['connectionId', 'groupMode', 'ideaId', 'polarity', 'reason', 'strength'])
        || !hasRequiredKeys(payload, ['connectionId', 'ideaId'])
        || !['strength', 'polarity', 'reason', 'groupMode'].some((key) => hasOwn(payload, key))
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedNonEmptyString(payload.connectionId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !validOptionalStrength(payload.strength)
        || !validOptionalPolarity(payload.polarity)
        || !validOptionalGroupMode(payload.groupMode)
        || (payload.reason !== undefined && payload.reason !== null
          && !boundedString(payload.reason, PROFILE_AGENT_COMMAND_LIMITS.maxReasonBytes))
      ) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'connection.update-meaning',
        payload: {
          ideaId: payload.ideaId,
          connectionId: payload.connectionId,
          ...(payload.strength === undefined ? {} : { strength: payload.strength }),
          ...(payload.polarity === undefined ? {} : { polarity: payload.polarity }),
          ...(payload.reason === undefined
            ? {}
            : { reason: payload.reason?.trim() ? payload.reason.trim() : null }),
          ...(payload.groupMode === undefined ? {} : { groupMode: payload.groupMode }),
        },
      }
    }
    case 'connection.delete': {
      if (
        !hasExactKeys(payload, ['connectionId', 'ideaId'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedNonEmptyString(payload.connectionId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
      ) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'connection.delete',
        payload: { ideaId: payload.ideaId, connectionId: payload.connectionId },
      }
    }
    case 'mod-template.create': {
      if (
        !hasExactKeys(payload, ['mod', 'templateId'])
        || !boundedNonEmptyString(payload.templateId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
      ) return undefined
      const mod = normalizeProfileAgentModDocument(payload.mod)
      if (mod === 'future') return 'future'
      if (!mod) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'mod-template.create',
        payload: {
          templateId: payload.templateId,
          mod,
        },
      }
    }
    case 'mod-template.update': {
      if (
        !hasExactKeys(payload, ['expectedTemplateVersion', 'mod', 'templateId'])
        || !boundedNonEmptyString(payload.templateId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !positiveSafeInteger(payload.expectedTemplateVersion)
      ) return undefined
      const mod = normalizeProfileAgentModDocument(payload.mod)
      if (mod === 'future') return 'future'
      if (!mod) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'mod-template.update',
        payload: {
          templateId: payload.templateId,
          expectedTemplateVersion: payload.expectedTemplateVersion,
          mod,
        },
      }
    }
    case 'mod-template.delete': {
      if (
        !hasExactKeys(payload, ['expectedTemplateVersion', 'templateId'])
        || !boundedNonEmptyString(payload.templateId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !positiveSafeInteger(payload.expectedTemplateVersion)
      ) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'mod-template.delete',
        payload: {
          templateId: payload.templateId,
          expectedTemplateVersion: payload.expectedTemplateVersion,
        },
      }
    }
    case 'mod-instance.stamp': {
      if (
        !hasExactKeys(payload, ['expectedTemplateVersion', 'ideaId', 'position', 'templateId'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedNonEmptyString(payload.templateId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !positiveSafeInteger(payload.expectedTemplateVersion)
        || !hasExactKeys(payload.position, ['x', 'y'])
        || !boundedCoordinate(payload.position.x)
        || !boundedCoordinate(payload.position.y)
      ) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'mod-instance.stamp',
        payload: {
          ideaId: payload.ideaId,
          templateId: payload.templateId,
          expectedTemplateVersion: payload.expectedTemplateVersion,
          position: { x: payload.position.x, y: payload.position.y },
        },
      }
    }
    case 'mod-instance.create': {
      if (surfaceVersion < 5) return 'denied'
      if (!hasExactKeys(payload, ['ideaId', 'mod', 'position'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !hasExactKeys(payload.position, ['x', 'y'])
        || !boundedCoordinate(payload.position.x)
        || !boundedCoordinate(payload.position.y)) {
        return undefined
      }
      const mod = normalizeProfileAgentModDocument(payload.mod)
      if (mod === 'future') return 'future'
      if (!mod) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'mod-instance.create',
        payload: {
          ideaId: payload.ideaId,
          mod,
          position: { x: payload.position.x, y: payload.position.y },
        },
      }
    }
    case 'mod-instance.configure': {
      if (surfaceVersion < 5) return 'denied'
      if (!hasExactKeys(payload, ['cardId', 'ideaId', 'mod'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedNonEmptyString(payload.cardId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)) {
        return undefined
      }
      const mod = normalizeProfileAgentModDocument(payload.mod)
      if (mod === 'future') return 'future'
      if (!mod) return undefined
      return {
        version: 1,
        id: value.id,
        name: 'mod-instance.configure',
        payload: { ideaId: payload.ideaId, cardId: payload.cardId, mod },
      }
    }
    case 'mod-instance.delete': {
      if (surfaceVersion < 5) return 'denied'
      if (!hasExactKeys(payload, ['cardId', 'ideaId'])
        || !boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
        || !boundedNonEmptyString(payload.cardId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)) {
        return undefined
      }
      return {
        version: 1,
        id: value.id,
        name: 'mod-instance.delete',
        payload: { ideaId: payload.ideaId, cardId: payload.cardId },
      }
    }
  }
}

function normalizeV3CardCreateCommand(
  commandId: string,
  payload: Record<string, unknown>,
): ProfileAgentCardCreateCommand | undefined {
  if (!boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
    || !['note', 'askAi', 'title', 'group', 'conversation'].includes(String(payload.kind))) {
    return undefined
  }

  // Surface 3 keeps the already-shipped explicit-position note/Ask spelling
  // byte-semantically replayable. New inputs normalize to the domain-shaped
  // variants below; surfaces 1/2 never see those new shapes.
  if ((payload.kind === 'note' || payload.kind === 'askAi')
    && hasOnlyKeys(payload, ['ideaId', 'kind', 'position', 'text'])
    && hasRequiredKeys(payload, ['ideaId', 'kind', 'position'])
    && hasExactKeys(payload.position, ['x', 'y'])
    && boundedCoordinate(payload.position.x)
    && boundedCoordinate(payload.position.y)
    && (payload.text === undefined
      || boundedString(payload.text, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes))) {
    return {
      version: 1,
      id: commandId,
      name: 'card.create',
      payload: {
        ideaId: payload.ideaId,
        kind: payload.kind,
        text: payload.text ?? '',
        position: { x: payload.position.x, y: payload.position.y },
      },
    }
  }

  const placement = normalizeV3CardPlacement(payload.ideaId, payload)
  if (!placement) return undefined
  if (payload.kind === 'note' || payload.kind === 'askAi' || payload.kind === 'title') {
    if (!hasOnlyKeys(payload, ['body', 'ideaId', 'kind', 'near', 'position'])
      || (payload.body !== undefined
        && !boundedString(payload.body, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes))) return undefined
    return {
      version: 1,
      id: commandId,
      name: 'card.create',
      payload: {
        ideaId: payload.ideaId,
        kind: payload.kind,
        body: payload.body ?? (payload.kind === 'title' ? 'Untitled label' : ''),
        ...placement,
      },
    }
  }
  if (payload.kind === 'group') {
    if (!hasOnlyKeys(payload, [
      'compressionPrompt', 'groupTitle', 'ideaId', 'kind', 'near', 'position',
    ])
      || (payload.groupTitle !== undefined
        && !boundedString(payload.groupTitle, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes))
      || (payload.compressionPrompt !== undefined
        && !boundedString(payload.compressionPrompt, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes))) {
      return undefined
    }
    return {
      version: 1,
      id: commandId,
      name: 'card.create',
      payload: {
        ideaId: payload.ideaId,
        kind: 'group',
        groupTitle: payload.groupTitle ?? 'New group',
        compressionPrompt: payload.compressionPrompt ?? DEFAULT_COMPRESSION_PROMPT,
        ...placement,
      },
    }
  }
  if (!hasOnlyKeys(payload, [
    'conversationStyle', 'conversationTurns', 'ideaId', 'kind', 'near', 'position', 'topic',
  ])
    || (payload.topic !== undefined
      && !boundedString(payload.topic, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes))
    || (payload.conversationStyle !== undefined && !validConversationStyle(payload.conversationStyle))
    || (payload.conversationTurns !== undefined
      && !validConversationTurns(payload.conversationTurns))) return undefined
  return {
    version: 1,
    id: commandId,
    name: 'card.create',
    payload: {
      ideaId: payload.ideaId,
      kind: 'conversation',
      topic: payload.topic ?? '',
      conversationStyle: payload.conversationStyle ?? DEFAULT_CONVERSATION_STYLE,
      conversationTurns: payload.conversationTurns ?? DEFAULT_CONVERSATION_TURNS,
      ...placement,
    },
  }
}

function normalizeV3CardPlacement(
  ideaId: string,
  payload: Record<string, unknown>,
): ProfileAgentCardPlacement | undefined {
  const hasPosition = hasOwn(payload, 'position')
  const hasNear = hasOwn(payload, 'near')
  if (hasPosition === hasNear) return undefined
  if (hasPosition) {
    if (!hasExactKeys(payload.position, ['x', 'y'])
      || !boundedCoordinate(payload.position.x)
      || !boundedCoordinate(payload.position.y)) return undefined
    return { position: { x: payload.position.x, y: payload.position.y } }
  }
  if (!Array.isArray(payload.near)
    || payload.near.length === 0
    || payload.near.length > PROFILE_AGENT_COMMAND_LIMITS.maxNearCards
    || payload.near.some((address) => (
      !boundedNonEmptyString(address, PROFILE_AGENT_COMMAND_LIMITS.maxCardAddressBytes)
    ))) return undefined
  const resolved = resolveProfileAgentCardAddresses(ideaId, payload.near as string[])
  return resolved.ok ? { near: resolved.cardIds } : undefined
}

function normalizeV3CardUpdateCommand(
  commandId: string,
  payload: Record<string, unknown>,
): ProfileAgentCardUpdateContentCommand | undefined {
  if (!boundedNonEmptyString(payload.ideaId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
    || !boundedNonEmptyString(payload.cardId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)) {
    return undefined
  }
  if (hasExactRecordKeys(payload, ['blockId', 'cardId', 'ideaId', 'text'])) {
    if (!boundedNonEmptyString(payload.blockId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
      || !boundedString(payload.text, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes)) return undefined
    return {
      version: 1,
      id: commandId,
      name: 'card.update-content',
      payload: {
        ideaId: payload.ideaId,
        cardId: payload.cardId,
        blockId: payload.blockId,
        text: payload.text,
      },
    }
  }
  if (hasExactRecordKeys(payload, ['body', 'cardId', 'ideaId'])) {
    if (!boundedString(payload.body, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes)) return undefined
    return {
      version: 1,
      id: commandId,
      name: 'card.update-content',
      payload: { ideaId: payload.ideaId, cardId: payload.cardId, body: payload.body },
    }
  }
  if (hasOnlyKeys(payload, ['cardId', 'compressionPrompt', 'groupTitle', 'ideaId'])
    && (hasOwn(payload, 'groupTitle') || hasOwn(payload, 'compressionPrompt'))) {
    if ((payload.groupTitle !== undefined
      && !boundedString(payload.groupTitle, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes))
      || (payload.compressionPrompt !== undefined
        && !boundedString(payload.compressionPrompt, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes))) {
      return undefined
    }
    return {
      version: 1,
      id: commandId,
      name: 'card.update-content',
      payload: {
        ideaId: payload.ideaId,
        cardId: payload.cardId,
        ...(hasOwn(payload, 'groupTitle') ? { groupTitle: payload.groupTitle as string } : {}),
        ...(hasOwn(payload, 'compressionPrompt')
          ? { compressionPrompt: payload.compressionPrompt as string }
          : {}),
      },
    }
  }
  if (hasOnlyKeys(payload, [
    'cardId', 'conversationStyle', 'conversationTurns', 'ideaId', 'topic',
  ]) && ['topic', 'conversationStyle', 'conversationTurns'].some((field) => hasOwn(payload, field))) {
    if ((payload.topic !== undefined
      && !boundedString(payload.topic, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes))
      || (payload.conversationStyle !== undefined && !validConversationStyle(payload.conversationStyle))
      || (payload.conversationTurns !== undefined
        && !validConversationTurns(payload.conversationTurns))) return undefined
    return {
      version: 1,
      id: commandId,
      name: 'card.update-content',
      payload: {
        ideaId: payload.ideaId,
        cardId: payload.cardId,
        ...(hasOwn(payload, 'topic') ? { topic: payload.topic as string } : {}),
        ...(hasOwn(payload, 'conversationStyle')
          ? { conversationStyle: payload.conversationStyle as ConversationStyle }
          : {}),
        ...(hasOwn(payload, 'conversationTurns')
          ? { conversationTurns: payload.conversationTurns as number }
          : {}),
      },
    }
  }
  return undefined
}

function validConversationStyle(value: unknown): value is ConversationStyle {
  return value === 'debate'
    || value === 'critique'
    || value === 'interview'
    || value === 'collaborate'
}

function validConversationTurns(value: unknown): value is number {
  return positiveSafeInteger(value)
    && value <= PROFILE_AGENT_COMMAND_LIMITS.maxConversationTurns
}

function isLegacyCardUpdatePayload(
  payload: ProfileAgentCardUpdateContentCommand['payload'],
): payload is ProfileAgentLegacyCardUpdateContentPayload {
  return 'blockId' in payload
}

function isBodyCardUpdatePayload(
  payload: ProfileAgentCardUpdateContentCommand['payload'],
): payload is ProfileAgentV3BodyCardUpdatePayload {
  return 'body' in payload
}

function isGroupCardUpdatePayload(
  payload: ProfileAgentCardUpdateContentCommand['payload'],
): payload is ProfileAgentV3GroupCardUpdatePayload {
  return 'groupTitle' in payload || 'compressionPrompt' in payload
}

function normalizeProfileAgentModDocument(
  value: unknown,
): ProfileModDocument | 'future' | undefined {
  const validation = validateProfileModDocumentTransport(value)
  if (validation.ok) return validation.value
  return validation.code === 'unsupported-future-version' ? 'future' : undefined
}

function isProfileAgentModCommand(command: ProfileAgentCommand): command is ProfileAgentModCommand {
  return PROFILE_AGENT_MOD_COMMAND_NAMES.includes(command.name as ProfileAgentModCommandName)
}

function replaceProfileModInstanceDocument(
  instance: ProfileModInstanceRecord,
  mod: ProfileModDocument,
): ProfileModInstanceRecord {
  if ('idMap' in instance.payload) {
    const payload = instance.payload
    return {
      kind: instance.kind,
      recordId: instance.recordId,
      ownerId: instance.ownerId,
      parentId: instance.parentId,
      recordVersion: instance.recordVersion,
      payload: {
        source: payload.source,
        idMap: payload.idMap,
        stampedAt: payload.stampedAt,
        mod: cloneJson(mod),
      },
    }
  }
  const payload = instance.payload
  return {
    kind: instance.kind,
    recordId: instance.recordId,
    ownerId: instance.ownerId,
    parentId: instance.parentId,
    recordVersion: instance.recordVersion,
    payload: {
      source: payload.source,
      createdAt: payload.createdAt,
      mod: cloneJson(mod),
    },
  }
}

function isProfileAgentResearchCommand(
  command: ProfileAgentCommand,
): command is ProfileAgentResearchCommand {
  return PROFILE_AGENT_RESEARCH_COMMAND_NAMES.includes(
    command.name as ProfileAgentResearchCommandName,
  )
}

function refreshCreatedCardReferences(
  createdCardsByCommandId: Map<string, Card>,
  cards: readonly Card[],
): void {
  const cardsById = new Map(cards.map((card) => [card.id, card] as const))
  for (const [commandId, previous] of createdCardsByCommandId) {
    const current = cardsById.get(previous.id)
    if (current) createdCardsByCommandId.set(commandId, current)
  }
}

function appendCardsArrangedIntentEvent(
  drafts: ProfileAgentLogicalIntentEventDraft[],
  ideaId: string,
  beforeCards: readonly Card[],
  afterCards: readonly Card[],
): boolean {
  const beforeById = new Map(beforeCards.map((card) => [card.id, card] as const))
  const changes = afterCards.flatMap((after) => {
    const before = beforeById.get(after.id)
    if (!before || sameCardArrangement(before, after)) return []
    return [{
      cardId: after.id,
      before: cardArrangementState(before),
      after: cardArrangementState(after),
    }]
  })
  const first = changes[0]
  if (!first) return false
  drafts.push(freezeIntentDraft(ideaId, {
    type: 'cards.arranged',
    cardId: first.cardId,
    data: { changes },
  }))
  return true
}

function appendCardLayerIntentEvent(
  drafts: ProfileAgentLogicalIntentEventDraft[],
  ideaId: string,
  beforeCards: readonly Card[],
  afterCards: readonly Card[],
  direction: CardLayerDirection,
): boolean {
  const beforeById = new Map(beforeCards.map((card) => [card.id, card] as const))
  const changes = afterCards.flatMap((after) => {
    const before = beforeById.get(after.id)
    if (!before || before.zIndex === after.zIndex || after.zIndex === undefined) return []
    return [{
      cardId: after.id,
      ...(before.zIndex === undefined ? {} : { from: before.zIndex }),
      to: after.zIndex,
    }]
  })
  const first = changes[0]
  if (!first) return false
  drafts.push(freezeIntentDraft(ideaId, {
    type: 'card.layer.changed',
    cardId: first.cardId,
    data: { direction, changes },
  }))
  return true
}

function cardArrangementState(card: Card): Readonly<{
  position: Card['position']
  size?: Card['size']
  groupId?: string
}> {
  return {
    position: { ...card.position },
    ...(card.size === undefined ? {} : { size: { ...card.size } }),
    ...(card.groupId === undefined ? {} : { groupId: card.groupId }),
  }
}

function sameCardArrangement(left: Card, right: Card): boolean {
  return left.position.x === right.position.x
    && left.position.y === right.position.y
    && sameOptionalSize(left.size, right.size)
    && left.groupId === right.groupId
}

function appendStructuralIntentEvents(
  drafts: ProfileAgentLogicalIntentEventDraft[],
  ideaId: string,
  beforeCards: readonly Card[],
  afterCards: readonly Card[],
): void {
  const beforeById = new Map(beforeCards.map((card) => [card.id, card] as const))
  const moves: Array<{
    cardId: string
    from: Card['position']
    to: Card['position']
    previousGroupId?: string
    nextGroupId?: string
  }> = []
  for (const after of afterCards) {
    const before = beforeById.get(after.id)
    if (!before) continue
    if (before.position.x !== after.position.x
      || before.position.y !== after.position.y
      || before.groupId !== after.groupId) {
      moves.push({
        cardId: after.id,
        from: { ...before.position },
        to: { ...after.position },
        ...(before.groupId === undefined ? {} : { previousGroupId: before.groupId }),
        ...(after.groupId === undefined ? {} : { nextGroupId: after.groupId }),
      })
    }
  }
  if (moves.length > 0) {
    drafts.push(freezeIntentDraft(ideaId, {
      type: 'card.moved',
      cardId: moves[0]!.cardId,
      data: { moves },
    }))
  }
  for (const after of afterCards) {
    const before = beforeById.get(after.id)
    if (!before || sameOptionalSize(before.size, after.size)) continue
    drafts.push(freezeIntentDraft(ideaId, {
      type: 'card.resized',
      cardId: after.id,
      data: {
        ...(before.size === undefined ? {} : { from: { ...before.size } }),
        ...(after.size === undefined ? {} : { to: { ...after.size } }),
      },
    }))
  }
}

function appendGroupMembershipIntentEvent(
  drafts: ProfileAgentLogicalIntentEventDraft[],
  ideaId: string,
  beforeCards: readonly Card[],
  afterCards: readonly Card[],
  requestedGroupId: string | undefined,
): void {
  const beforeGroups = new Map(beforeCards.map((card) => [card.id, card.groupId] as const))
  const memberChanges: Record<string, { from?: string; to?: string }> = {}
  let changedGroupId = requestedGroupId
  for (const after of afterCards) {
    const from = beforeGroups.get(after.id)
    const to = after.groupId
    if (from === to) continue
    memberChanges[after.id] = {
      ...(from === undefined ? {} : { from }),
      ...(to === undefined ? {} : { to }),
    }
    changedGroupId ??= to ?? from
  }
  if (!changedGroupId || Object.keys(memberChanges).length === 0) return
  drafts.push(freezeIntentDraft(ideaId, {
    type: 'group.members.changed',
    cardId: changedGroupId,
    data: { memberChanges },
  }))
}

function sameOptionalSize(left: Card['size'], right: Card['size']): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && left.width === right.width && left.height === right.height
}

function requiresProfileRevisionAudit(command: ProfileAgentCommand): boolean {
  return isProfileAgentModCommand(command)
    || isProfileAgentResearchCommand(command)
    || command.name === 'idea.create'
    || command.name === 'idea.activate'
}

function scopeForCommand(command: ProfileAgentCommand): ProfileAgentCommandScope {
  switch (command.name) {
    case 'idea.create':
    case 'idea.activate':
    case 'mod-template.create':
    case 'mod-template.update':
    case 'mod-template.delete':
      return Object.freeze({ kind: 'profile' })
    default:
      return Object.freeze({ kind: 'idea', ideaId: command.payload.ideaId })
  }
}

function sameCommandScope(left: ProfileAgentCommandScope, right: ProfileAgentCommandScope): boolean {
  return left.kind === right.kind
    && (left.kind === 'profile' || (right.kind === 'idea' && left.ideaId === right.ideaId))
}

function captureRequest(value: unknown): Record<string, unknown> | undefined {
  const state = { nodes: 0, ancestors: new WeakSet<object>() }
  const clone = captureInertJson(value, 0, state)
  if (!isPlainRecord(clone)) return undefined
  if (utf8Bytes(JSON.stringify(clone)) > PROFILE_AGENT_COMMAND_LIMITS.maxRequestBytes) return undefined
  return clone
}

function captureInertJson(
  value: unknown,
  depth: number,
  state: { nodes: number; ancestors: WeakSet<object> },
): ProfileJsonValue | undefined {
  state.nodes += 1
  if (
    state.nodes > PROFILE_AGENT_COMMAND_LIMITS.maxJsonNodes
    || depth > PROFILE_AGENT_COMMAND_LIMITS.maxJsonDepth
  ) return undefined
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') return finiteJsonNumber(value) ? value : undefined
  if (typeof value !== 'object' || state.ancestors.has(value)) return undefined
  state.ancestors.add(value)
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length > 0) {
        return undefined
      }
      const names = Object.getOwnPropertyNames(value)
      if (
        names.length !== value.length + 1
        || names.some((name) => name !== 'length'
          && (!/^(0|[1-9]\d*)$/.test(name) || Number(name) >= value.length))
      ) return undefined
      const clone: ProfileJsonValue[] = []
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
        if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined
        const captured = captureInertJson(descriptor.value, depth + 1, state)
        if (captured === undefined) return undefined
        clone.push(captured)
      }
      return clone
    }
    if (!isPlainRecord(value) || Object.getOwnPropertySymbols(value).length > 0) return undefined
    const clone = Object.create(null) as Record<string, ProfileJsonValue>
    for (const key of Object.getOwnPropertyNames(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable) return undefined
      const captured = captureInertJson(descriptor.value, depth + 1, state)
      if (captured === undefined) return undefined
      clone[key] = captured
    }
    return clone
  } finally {
    state.ancestors.delete(value)
  }
}

function validTrustedAttribution(value: ProfileAgentTrustedAttribution): boolean {
  return isPlainRecord(value)
    && boundedNonEmptyString(value.profileId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
    && hasExactKeys(value.actor, ['client', 'id', 'kind', 'sessionId', 'transport'])
    && boundedNonEmptyString(value.actor.id, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
    && value.actor.kind === 'agent'
    && ['cli', 'mcp', 'test'].includes(value.actor.transport)
    && isCardAuthorship({
      kind: value.actor.kind,
      client: value.actor.client,
      sessionId: value.actor.sessionId,
    })
    && boundedNonEmptyString(value.clientTxnId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
}

function validCardReference(value: unknown): value is ProfileAgentCardReference {
  return (
    hasExactKeys(value, ['cardId'])
    && boundedNonEmptyString(value.cardId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
  ) || (
    hasExactKeys(value, ['createdByCommandId'])
    && boundedNonEmptyString(value.createdByCommandId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
  )
}

function cloneCardReference(value: ProfileAgentCardReference): ProfileAgentCardReference {
  return 'cardId' in value ? { cardId: value.cardId } : { createdByCommandId: value.createdByCommandId }
}

function validOptionalStrength(value: unknown): value is Connection['strength'] | undefined {
  return value === undefined || value === 'strong' || value === 'weak'
}

function validOptionalPolarity(value: unknown): value is Connection['polarity'] | undefined {
  return value === undefined || value === 'helps' || value === 'pushesAgainst'
}

function validOptionalGroupMode(
  value: unknown,
): value is NonNullable<Connection['meta']>['groupMode'] | undefined {
  return value === undefined || value === 'full' || value === 'compress'
}

function resolveCardReference(
  cards: readonly Card[],
  createdCardsByCommandId: ReadonlyMap<string, Card>,
  reference: ProfileAgentCardReference,
): Card | 'invalid' | undefined {
  if ('cardId' in reference) return cards.find((card) => card.id === reference.cardId)
  return createdCardsByCommandId.get(reference.createdByCommandId) ?? 'invalid'
}

function defaultConnection(
  id: string,
  fromCardId: string,
  toCardId: string,
  role: Connection['role'],
): Connection {
  return {
    id,
    from: { cardId: fromCardId },
    to: { cardId: toCardId },
    strength: 'strong',
    polarity: 'helps',
    role,
  }
}

function connectionWithMeaning(
  id: string,
  fromCardId: string,
  toCardId: string,
  role: Connection['role'],
  meaning: ProfileAgentConnectionCreateCommand['payload'],
): Connection {
  const reason = meaning.reason?.trim()
  return {
    id,
    from: { cardId: fromCardId },
    to: { cardId: toCardId },
    strength: meaning.strength ?? 'strong',
    polarity: meaning.polarity ?? 'helps',
    role,
    ...(reason ? { reason } : {}),
    ...(meaning.groupMode === undefined ? {} : { meta: { groupMode: meaning.groupMode } }),
  }
}

function diffLogicalRecords(
  before: ProfileLogicalDocument,
  after: ProfileLogicalDocument,
): ProfileAgentRecordChange[] {
  const beforeById = new Map(before.records.map((record) => [record.recordId, record]))
  const afterIds = new Set<string>()
  const changes: ProfileAgentRecordChange[] = []
  for (const record of after.records) {
    afterIds.add(record.recordId)
    const previous = beforeById.get(record.recordId)
    if (!previous) {
      changes.push(Object.freeze({ operation: 'insert', after: record }))
    } else if (canonicalJson(previous) !== canonicalJson(record)) {
      changes.push(Object.freeze({ operation: 'replace', before: previous, after: record }))
    }
  }
  for (const record of before.records) {
    if (!afterIds.has(record.recordId)) changes.push(Object.freeze({ operation: 'delete', before: record }))
  }
  return changes
}

function freezeIntentDraft(
  ideaId: string,
  event: IntentLogEventDraft | ProfileJsonValue,
): ProfileAgentLogicalIntentEventDraft {
  return deepFreeze({
    ideaId,
    event: cloneJson(event) as ProfileJsonValue,
  })
}

function projectCardForIntent(
  card: Card,
  assetMetadata: ReadonlyMap<string, ProfileLogicalAssetPayload>,
): ProfileJsonValue | undefined {
  const projected = cloneJson(card) as unknown as Record<string, unknown>
  if (card.assets !== undefined) {
    const assets: ProfileLogicalAssetPayload[] = []
    for (const asset of card.assets) {
      const metadata = assetMetadata.get(asset.id)
      if (!metadata) return undefined
      assets.push(metadata)
    }
    projected.assets = assets
  }
  return projected as ProfileJsonValue
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function validModConfigureIdentityTransition(
  existing: ProfileModDocument,
  configured: ProfileModDocument,
  isReserved: (id: string) => boolean,
): boolean {
  if (existing.kind !== configured.kind) return false
  const existingById = new Map(
    listModPartIdentities(existing).map((identity) => [identity.sourceId, identity] as const),
  )
  for (const identity of listModPartIdentities(configured)) {
    const previous = existingById.get(identity.sourceId)
    if (previous) {
      if (previous.role !== identity.role
        || (configured.kind === 'pad' && previous.ordinal !== identity.ordinal)) {
        return false
      }
      continue
    }
    if (configured.kind === 'pad' || isReserved(identity.sourceId)) return false
  }
  return true
}

function stampedModOriginMatchesKnownTemplate(
  instance: ProfileModInstanceRecord,
  templates: readonly ProfileModTemplateRecord[],
): boolean {
  if (!('idMap' in instance.payload)) return false
  const { idMap, source } = instance.payload
  if (idMap.mod.sourceId !== source.templateId
    || idMap.mod.instanceId !== instance.recordId) {
    return false
  }
  const template = templates.find((candidate) => (
    candidate.recordId === source.templateId
    && candidate.payload.templateVersion === source.templateVersion
  ))
  if (!template) return true

  const sourceParts = listModPartIdentities(template.payload.mod)
  if (sourceParts.length !== idMap.controls.length) return false
  const currentPartsById = new Map(
    listModPartIdentities(instance.payload.mod).map((identity) => (
      [identity.sourceId, identity] as const
    )),
  )
  return idMap.controls.every((pair, index) => {
    const sourcePart = sourceParts[index]
    if (!sourcePart || pair.sourceId !== sourcePart.sourceId) return false
    const currentPart = currentPartsById.get(pair.instanceId)
    return currentPart === undefined
      || (currentPart.role === sourcePart.role
        && (instance.payload.mod.kind !== 'pad'
          || currentPart.ordinal === sourcePart.ordinal))
  })
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isPlainRecord(value)) return value
  const result = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value).sort()) result[key] = sortJson(value[key])
  return result
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function freezeJsonClone(value: unknown): unknown {
  return deepFreeze(cloneJson(value))
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value
  const stack: object[] = [value]
  const visited = new WeakSet<object>()
  while (stack.length > 0) {
    const current = stack.pop()
    if (!current || visited.has(current)) continue
    visited.add(current)
    for (const child of Object.values(current)) {
      if (child !== null && typeof child === 'object') stack.push(child)
    }
    Object.freeze(current)
  }
  return value
}

function futureVersion(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) > PROFILE_CONTRACT_VERSIONS.command
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function canonicalTimestamp(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}

function finiteJsonNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

function boundedCoordinate(value: unknown): value is number {
  return finiteJsonNumber(value)
    && Math.abs(value) <= PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate
}

function boundedDimension(value: unknown): value is number {
  return finiteJsonNumber(value)
    && value > 0
    && value <= PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate
}

function boundedNonEmptyString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0 && utf8Bytes(value) <= maxBytes
}

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && utf8Bytes(value) <= maxBytes
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function hasExactRecordKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  return Object.keys(value).sort().join(',') === [...expected].sort().join(',')
}

function hasRequiredKeys(value: Record<string, unknown>, required: readonly string[]): boolean {
  return required.every((key) => hasOwn(value, key))
}

function hasExactKeys(
  value: unknown,
  expected: readonly string[],
): value is Record<string, unknown> {
  return isPlainRecord(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',')
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
