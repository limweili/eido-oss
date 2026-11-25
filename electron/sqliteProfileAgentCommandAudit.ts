import { createHash } from 'node:crypto'
import type { CardAuthorship, IntentClaimedTransitionEvidence } from '../src/graph/types'
import { isCardAuthorship } from '../src/graph/cardAuthorship'
import { cardIdentityPresetSolid } from '../src/graph/cardIdentityPresets'
import { listModPartIdentities, remapModPartIdentities } from '../src/mods'
import {
  PROFILE_AGENT_INSTALLED_ACTOR_ID,
  type ProfileAgentCommandBatchReceipt,
  type ProfileAgentInstalledTransport,
} from '../src/persistence/profileAgentCommandInstallation'
import type { ProfileAgentCommandSurfaceVersion } from '../src/persistence/profileAgentCommandManifest'
import {
  decodeProfileAgentEventRecord,
  PROFILE_AGENT_EVENT_RECORD_VERSION,
} from '../src/persistence/profileAgentEvent'
import {
  planProfileAgentCommandBatch,
  type ProfileAgentCardSetIdentityCommand,
  type ProfileAgentCommandIdDeriver,
  type ProfileAgentCommandPlan,
  type ProfileAgentCommandRequest,
} from '../src/persistence/profileAgentCommandPlan'
import {
  decodeProfileModRecord,
  type ProfileModDocument,
  validateProfileModDocumentTransport,
} from '../src/persistence/profileModRecords'
import { canonicalProfileJson } from '../src/persistence/profileRevisionKernel'
import type {
  ProfileLogicalDocument,
  ProfileLogicalRecordSpec,
} from '../src/persistence/profileLogicalProjection'

export type DurableRecordTransition = Readonly<{
  recordId: string
  changeKind: 'insert' | 'update' | 'delete'
  before: ProfileLogicalRecordSpec | null
  after: ProfileLogicalRecordSpec | null
}>

export type ProfileAgentCommandBindingV1 = Readonly<{
  commandId: string
  events: readonly Readonly<{
    eventId: string
    role: AgentIntentEventRole
    evidence: IntentClaimedTransitionEvidence
  }>[]
}>

export type ProfileAgentModStampProvenanceV1 = Readonly<{
  version: 1
  templateDigest: string
  templateFrame: Readonly<{
    recordId: string
    kind: 'mod-template'
    ownerId: string
    parentId: string
    ordinal: number
    recordVersion: number
    payload: Readonly<Record<string, unknown>>
  }>
}>

export type ProfileAgentCommandBindingV2 = Readonly<{
  commandId: string
  events: readonly Readonly<{
    eventKind: 'intent-event' | 'profile-agent-event'
    eventId: string
    role: AgentIntentEventRole
    evidence: IntentClaimedTransitionEvidence
  }>[]
  stampProvenance?: ProfileAgentModStampProvenanceV1
}>

export type ProfileAgentCommandBinding = ProfileAgentCommandBindingV1 | ProfileAgentCommandBindingV2

export type AgentIntentEventRole =
  | 'card-created'
  | 'card-content-edited'
  | 'ask-model-set'
  | 'card-identity-set'
  | 'cards-arranged'
  | 'card-layer-changed'
  | 'group-members-moved'
  | 'group-container-resized'
  | 'group-members-changed'
  | 'output-version-chosen'
  | 'output-version-acceptance-changed'
  | 'card-deleted'
  | 'connection-created'
  | 'result-card-created'
  | 'source-result-connection-created'
  | 'routed-connection-created'
  | 'connection-changed'
  | 'connection-deleted'
  | 'idea-created'
  | 'idea-activated'
  | 'mod-template-created'
  | 'mod-template-updated'
  | 'mod-template-deleted'
  | 'mod-instance-stamped'
  | 'mod-instance-created'
  | 'mod-instance-configured'
  | 'mod-instance-deleted'

export type AgentOutcomeAttestationContext = Readonly<{
  installedSurfaceVersion: ProfileAgentCommandSurfaceVersion
  profileId: string
  actorId: typeof PROFILE_AGENT_INSTALLED_ACTOR_ID
  transport: ProfileAgentInstalledTransport
  clientTxnId: string
  commitId: string
  committedAt: string
  actor?: CardAuthorship
}>

export type AgentCommandAuditDependencies = Readonly<{
  deriveId: ProfileAgentCommandIdDeriver
  contentSha256: (text: string) => string
  recordDigest: (record: ProfileLogicalRecordSpec) => string
}>

export type AgentRecordCommandOwner = Readonly<{
  recordId: string
  commandIndex: number
}>

function agentReplanMatchesDurableEvidence(
  baseDocument: ProfileLogicalDocument,
  request: ProfileAgentCommandRequest,
  receipt: ProfileAgentCommandBatchReceipt,
  semanticChanges: readonly DurableRecordTransition[],
  intentEvents: readonly Record<string, unknown>[],
  profileAgentEvents: readonly Record<string, unknown>[],
  context: Readonly<{
    profileId: string
    clientTxnId: string
    committedAt: string
    transport: ProfileAgentInstalledTransport
    actor?: CardAuthorship
  }>,
  dependencies: AgentCommandAuditDependencies,
): ProfileAgentCommandPlan | undefined {
  if (receipt.commitId === null) return undefined
  const observedActor = context.actor ?? observedCardAuthorship(semanticChanges)
  const replanned = planProfileAgentCommandBatch(baseDocument, request, {
    profileId: context.profileId,
    actor: {
      id: PROFILE_AGENT_INSTALLED_ACTOR_ID,
      kind: 'agent',
      transport: context.transport,
      client: observedActor?.client ?? 'legacy-agent',
      sessionId: observedActor?.sessionId ?? 'legacy-agent',
    },
    clientTxnId: context.clientTxnId,
    deriveId: dependencies.deriveId,
    contentSha256: dependencies.contentSha256,
    committedAt: context.committedAt,
    commitId: receipt.commitId,
    stampedAt: context.committedAt,
  }, receipt.version)
  if (!replanned.ok
    || canonicalProfileJson(replanned.value.commandResults)
      !== canonicalProfileJson(receipt.commandResults)
    || replanned.value.intentEventDrafts.length !== intentEvents.length
    || replanned.value.profileAgentEventDrafts.length !== profileAgentEvents.length) return undefined

  for (const [index, draft] of replanned.value.intentEventDrafts.entries()) {
    const observed = agentSemanticIntentPayload(intentEvents[index])
    const expected = observedActor === undefined
      && isObjectRecord(draft.event)
      && !intentCarriesCardAuthorship(observed)
      ? removeLegacyCardAuthorshipFromIntent(draft.event)
      : draft.event
    if (observed === undefined
      || canonicalProfileJson(expected) !== canonicalProfileJson(observed)) return undefined
  }
  for (const [index, draft] of replanned.value.profileAgentEventDrafts.entries()) {
    const observed = agentSemanticProfileEventPayload(profileAgentEvents[index])
    if (observed === undefined
      || canonicalProfileJson(draft) !== canonicalProfileJson(observed)) return undefined
  }

  const boardId = replanned.value.ideaId === undefined
    ? undefined
    : `board:${replanned.value.ideaId}`
  const plannedChanges = replanned.value.recordChanges.flatMap((change) => {
    const before = change.operation === 'insert' ? null : change.before
    const after = change.operation === 'delete' ? null : change.after
    const recordId = (after ?? before)?.recordId
    if (recordId === undefined || recordId === boardId) return []
    const observed = semanticChanges.find((candidate) => candidate.recordId === recordId)
    return [Object.freeze({
      recordId,
      changeKind: change.operation === 'replace' ? 'update' as const : change.operation,
      before: observedActor === undefined && !recordCarriesCardAuthorship(observed?.before)
        ? removeLegacyCardAuthorshipFromRecord(before)
        : before,
      after: observedActor === undefined && !recordCarriesCardAuthorship(observed?.after)
        ? removeLegacyCardAuthorshipFromRecord(after)
        : after,
    })]
  }).sort((left, right) => (
    left.recordId < right.recordId ? -1 : left.recordId > right.recordId ? 1 : 0
  ))
  return canonicalProfileJson(plannedChanges) === canonicalProfileJson(semanticChanges)
    ? replanned.value
    : undefined
}

function observedCardAuthorship(
  changes: readonly DurableRecordTransition[],
): CardAuthorship | undefined {
  for (const change of changes) {
    const payload = change.after?.kind === 'card' && isObjectRecord(change.after.payload)
      ? change.after.payload
      : undefined
    if (payload === undefined) continue
    for (const candidate of [payload.lastModifiedBy, payload.createdBy]) {
      if (isCardAuthorship(candidate) && candidate.kind === 'agent') return candidate
    }
  }
  return undefined
}

function recordCarriesCardAuthorship(record: ProfileLogicalRecordSpec | null | undefined): boolean {
  return record?.kind === 'card'
    && isObjectRecord(record.payload)
    && (record.payload.createdBy !== undefined || record.payload.lastModifiedBy !== undefined)
}

function intentCarriesCardAuthorship(event: Record<string, unknown> | undefined): boolean {
  return event !== undefined
    && isObjectRecord(event.data)
    && isObjectRecord(event.data.card)
    && (event.data.card.createdBy !== undefined || event.data.card.lastModifiedBy !== undefined)
}

function removeLegacyCardAuthorshipFromRecord(
  record: ProfileLogicalRecordSpec | null,
): ProfileLogicalRecordSpec | null {
  if (record?.kind !== 'card' || !isObjectRecord(record.payload)) return record
  const { createdBy: _createdBy, lastModifiedBy: _lastModifiedBy, ...payload } = record.payload
  return Object.freeze({ ...record, payload: Object.freeze(payload) })
}

function removeLegacyCardAuthorshipFromIntent(
  event: Record<string, unknown>,
): Record<string, unknown> {
  if (event.type !== 'card.created'
    || !isObjectRecord(event.data)
    || !isObjectRecord(event.data.card)) return event
  const { createdBy: _createdBy, lastModifiedBy: _lastModifiedBy, ...card } = event.data.card
  return Object.freeze({
    ...event,
    data: Object.freeze({ ...event.data, card: Object.freeze(card) }),
  })
}

function agentSemanticProfileEventPayload(
  event: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (event === undefined) return undefined
  const {
    id: _id,
    seq: _seq,
    at: _at,
    profileId: _profileId,
    commitId: _commitId,
    actorId: _actorId,
    clientTxnId: _clientTxnId,
    claimedTransitionEvidence: _claimedTransitionEvidence,
    ...semantic
  } = event
  return semantic
}

function agentSemanticIntentPayload(
  event: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (event === undefined) return undefined
  const {
    id: _id,
    at: _at,
    ideaId: _ideaId,
    commitId: _commitId,
    actorId: _actorId,
    clientTxnId: _clientTxnId,
    seq: _seq,
    data,
    ...semantic
  } = event
  if (data === undefined) return semantic
  if (!isObjectRecord(data)) return undefined
  const { claimedTransitionEvidence: _claimedTransitionEvidence, ...semanticData } = data
  return { ...semantic, data: semanticData }
}

function createAgentModStampProvenance(
  template: ProfileLogicalRecordSpec,
  sourceMod: ProfileModDocument,
  templateId: string,
  templateVersion: number,
  profileId: string,
  recordDigest: AgentCommandAuditDependencies['recordDigest'],
): ProfileAgentModStampProvenanceV1 | undefined {
  if (template.kind !== 'mod-template'
    || template.recordId !== templateId
    || template.ownerId !== profileId
    || template.parentId !== profileId
    || !nonNegativeSafeInteger(template.ordinal)) return undefined
  const decoded = decodeProfileModRecord({
    recordId: template.recordId,
    kind: template.kind,
    ownerId: template.ownerId,
    parentId: template.parentId,
    recordVersion: template.recordVersion,
    payload: template.payload,
  })
  if (!decoded.ok
    || decoded.value.kind !== 'mod-template'
    || decoded.value.payload.templateVersion !== templateVersion
    || canonicalProfileJson(decoded.value.payload.mod) !== canonicalProfileJson(sourceMod)) {
    return undefined
  }
  const normalizedTemplate: ProfileLogicalRecordSpec = Object.freeze({
    ...decoded.value,
    ordinal: template.ordinal,
  })
  if (canonicalProfileJson(normalizedTemplate) !== canonicalProfileJson(template)) return undefined
  const { mod: _mod, ...payload } = decoded.value.payload
  return Object.freeze({
    version: 1 as const,
    templateDigest: recordDigest(normalizedTemplate),
    templateFrame: Object.freeze({
      recordId: decoded.value.recordId,
      kind: decoded.value.kind,
      ownerId: decoded.value.ownerId,
      parentId: decoded.value.parentId,
      ordinal: template.ordinal,
      recordVersion: decoded.value.recordVersion,
      payload: Object.freeze(payload),
    }),
  })
}

function readStoredAgentModStampProvenance(
  storedBindings: unknown,
  commandId: string,
  sourceMod: ProfileModDocument,
  templateId: string,
  templateVersion: number,
  profileId: string,
  recordDigest: AgentCommandAuditDependencies['recordDigest'],
): ProfileAgentModStampProvenanceV1 | undefined {
  if (!Array.isArray(storedBindings)) return undefined
  const matching = storedBindings.filter((candidate) => (
    isObjectRecord(candidate) && candidate.commandId === commandId
  ))
  if (matching.length !== 1
    || !hasExactKeys(matching[0], ['commandId', 'events', 'stampProvenance'])) return undefined
  const candidate = matching[0].stampProvenance
  if (!hasExactKeys(candidate, ['version', 'templateDigest', 'templateFrame'])
    || candidate.version !== 1
    || !validSha256(candidate.templateDigest)
    || !hasExactKeys(candidate.templateFrame, [
      'recordId',
      'kind',
      'ownerId',
      'parentId',
      'ordinal',
      'recordVersion',
      'payload',
    ])) return undefined
  const frame = candidate.templateFrame
  if (frame.recordId !== templateId
    || frame.kind !== 'mod-template'
    || frame.ownerId !== profileId
    || frame.parentId !== profileId
    || !nonNegativeSafeInteger(frame.ordinal)
    || !isObjectRecord(frame.payload)
    || Object.prototype.hasOwnProperty.call(frame.payload, 'mod')) return undefined
  const decoded = decodeProfileModRecord({
    recordId: frame.recordId,
    kind: frame.kind,
    ownerId: frame.ownerId,
    parentId: frame.parentId,
    recordVersion: frame.recordVersion,
    payload: { ...frame.payload, mod: sourceMod },
  })
  if (!decoded.ok
    || decoded.value.kind !== 'mod-template'
    || decoded.value.payload.templateVersion !== templateVersion) return undefined
  const reconstructed: ProfileLogicalRecordSpec = Object.freeze({
    ...decoded.value,
    ordinal: frame.ordinal,
  })
  if (recordDigest(reconstructed) !== candidate.templateDigest) return undefined
  const { mod: _mod, ...payload } = decoded.value.payload
  return Object.freeze({
    version: 1 as const,
    templateDigest: candidate.templateDigest,
    templateFrame: Object.freeze({
      recordId: decoded.value.recordId,
      kind: decoded.value.kind,
      ownerId: decoded.value.ownerId,
      parentId: decoded.value.parentId,
      ordinal: frame.ordinal,
      recordVersion: decoded.value.recordVersion,
      payload: Object.freeze(payload),
    }),
  })
}

export function auditAgentCommandRevision(
  request: ProfileAgentCommandRequest,
  receipt: ProfileAgentCommandBatchReceipt,
  changes: readonly DurableRecordTransition[],
  context: Readonly<{
    installedSurfaceVersion: ProfileAgentCommandSurfaceVersion
    profileId: string
    clientTxnId: string
    committedAt: string
    transport: ProfileAgentInstalledTransport
    actor?: CardAuthorship
    baseDocument?: ProfileLogicalDocument
    storedCommandBindings?: unknown
  }>,
  dependencies: AgentCommandAuditDependencies,
): readonly ProfileAgentCommandBinding[] | undefined {
  if (receipt.commitId === null
    || request.commands.length !== receipt.commandResults.length) return undefined
  const ideaIds = new Set(request.commands.flatMap((command) => {
    const payload: unknown = command.payload
    return command.name !== 'idea.activate'
      && isObjectRecord(payload) && typeof payload.ideaId === 'string'
      ? [payload.ideaId]
      : []
  }))
  if (ideaIds.size > 1) return undefined
  const ideaId = [...ideaIds][0]
  const boardId = ideaId === undefined ? undefined : `board:${ideaId}`
  if (boardId !== undefined) {
    const boardChanges = changes.filter((change) => change.recordId === boardId)
    if (boardChanges.length !== 1
      || !validAgentBoardTimestampChange(boardChanges[0]!, context.committedAt)) return undefined
  }
  const intentIds = new Set(receipt.intentEventIds)
  const profileAgentEventIds: readonly string[] = receipt.version === 1
    ? []
    : receipt.profileAgentEventIds
  const profileEventIds = new Set(profileAgentEventIds)
  const intentChanges = changes.filter((change) => intentIds.has(change.recordId))
  if (intentChanges.length !== receipt.intentEventIds.length
    || intentChanges.some((change) => (
      change.changeKind !== 'insert'
      || change.after?.kind !== 'intent-event'
      || !isObjectRecord(change.after.payload)
      || change.after.payload.id !== change.recordId
      || change.after.payload.ideaId !== ideaId
      || change.after.payload.actorId !== PROFILE_AGENT_INSTALLED_ACTOR_ID
      || change.after.payload.clientTxnId !== context.clientTxnId
      || change.after.payload.commitId !== receipt.commitId
      || change.after.payload.at !== context.committedAt
      || (ideaId === undefined || change.after.payload.ideaId !== ideaId)
    ))) return undefined
  const profileEventChanges = changes.filter((change) => profileEventIds.has(change.recordId))
  if (profileEventChanges.length !== profileAgentEventIds.length
    || profileEventChanges.some((change) => {
      if (change.changeKind !== 'insert'
        || change.after?.kind !== 'profile-agent-event'
        || change.after.ownerId !== context.profileId
        || change.after.parentId !== context.profileId) return true
      const decoded = decodeProfileAgentEventRecord({
        recordId: change.after.recordId,
        kind: change.after.kind,
        ownerId: change.after.ownerId,
        parentId: change.after.parentId,
        recordVersion: PROFILE_AGENT_EVENT_RECORD_VERSION,
        payload: change.after.payload,
      })
      return !decoded.ok
        || decoded.value.payload.actorId !== PROFILE_AGENT_INSTALLED_ACTOR_ID
        || decoded.value.payload.clientTxnId !== context.clientTxnId
        || decoded.value.payload.commitId !== receipt.commitId
        || decoded.value.payload.at !== context.committedAt
    })) return undefined
  const semanticChanges = changes.filter((change) => (
    change.recordId !== boardId
    && !intentIds.has(change.recordId)
    && !profileEventIds.has(change.recordId)
  ))
  const baseEffects = {
    inserted: semanticChanges.filter((change) => change.changeKind === 'insert').length,
    updated: semanticChanges.filter((change) => change.changeKind === 'update').length,
    deleted: semanticChanges.filter((change) => change.changeKind === 'delete').length,
    intentEvents: intentChanges.length,
  }
  const effects = receipt.version >= 2
    ? { ...baseEffects, profileAgentEvents: profileEventChanges.length }
    : baseEffects
  if (canonicalProfileJson(effects) !== canonicalProfileJson(receipt.effects)) return undefined

  const intentPayloadById = new Map(intentChanges.map((change) => (
    [change.recordId, change.after!.payload as Record<string, unknown>] as const
  )))
  const profileEventPayloadById = new Map(profileEventChanges.map((change) => (
    [change.recordId, change.after!.payload as Record<string, unknown>] as const
  )))
  const replanned = context.baseDocument === undefined
    ? undefined
    : agentReplanMatchesDurableEvidence(
        context.baseDocument,
        request,
        receipt,
        semanticChanges,
        receipt.intentEventIds.map((eventId) => intentPayloadById.get(eventId)!),
        profileAgentEventIds.map((eventId) => profileEventPayloadById.get(eventId)!),
        context,
        dependencies,
      )
  if (context.baseDocument !== undefined && replanned === undefined) return undefined
  const claimedIntentIds = new Set<string>()
  const claimIntent = (
    predicate: (payload: Record<string, unknown>) => boolean,
  ): Readonly<{ eventId: string; payload: Record<string, unknown> }> | undefined => {
    const eventId = receipt.intentEventIds.find((candidateEventId) => {
      const payload = intentPayloadById.get(candidateEventId)
      return !claimedIntentIds.has(candidateEventId) && payload !== undefined && predicate(payload)
    })
    if (eventId === undefined) return undefined
    claimedIntentIds.add(eventId)
    return Object.freeze({ eventId, payload: intentPayloadById.get(eventId)! })
  }
  const claimedChangeIds = new Set<string>()
  const claimChange = (
    change: DurableRecordTransition | undefined,
  ): DurableRecordTransition | undefined => {
    if (change !== undefined) claimedChangeIds.add(change.recordId)
    return change
  }
  const transitionCommitments = deriveAgentTransitionCommitments(
    request,
    receipt.commandResults,
    receipt.intentEventIds.map((eventId) => intentPayloadById.get(eventId)!),
    semanticChanges.filter((change) => !isProfileAgentSemanticRecordKind(
      (change.after ?? change.before)?.kind,
    )),
    {
      installedSurfaceVersion: context.installedSurfaceVersion,
      profileId: context.profileId,
      actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
      transport: context.transport,
      ...(context.actor === undefined ? {} : { actor: context.actor }),
      clientTxnId: context.clientTxnId,
      commitId: receipt.commitId,
      committedAt: context.committedAt,
    },
    dependencies.recordDigest,
  )
  if (!transitionCommitments) return undefined
  const profileTransitionCommitments = deriveProfileAgentTransitionCommitments(
    request,
    receipt.commandResults,
    profileAgentEventIds.map((eventId) => profileEventPayloadById.get(eventId)!),
    semanticChanges.filter((change) => isProfileAgentSemanticRecordKind(
      (change.after ?? change.before)?.kind,
    )),
    {
      installedSurfaceVersion: context.installedSurfaceVersion,
      profileId: context.profileId,
      actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
      transport: context.transport,
      clientTxnId: context.clientTxnId,
      commitId: receipt.commitId,
      committedAt: context.committedAt,
    },
    dependencies.recordDigest,
  )
  if (!profileTransitionCommitments) return undefined
  const commitmentEventIndexes = new Set<number>()
  for (const commitment of transitionCommitments.values()) {
    const eventId = receipt.intentEventIds[commitment.eventIndex]
    const event = eventId === undefined ? undefined : intentPayloadById.get(eventId)
    const observed = event !== undefined && isObjectRecord(event.data)
      ? event.data.claimedTransitionEvidence
      : undefined
    if (canonicalProfileJson(observed ?? null) !== canonicalProfileJson(commitment.evidence)) return undefined
    commitmentEventIndexes.add(commitment.eventIndex)
    commitment.recordIds.forEach((recordId) => claimedChangeIds.add(recordId))
  }
  if (receipt.intentEventIds.some((eventId, eventIndex) => {
    const event = intentPayloadById.get(eventId)
    return !commitmentEventIndexes.has(eventIndex)
      && event !== undefined
      && isObjectRecord(event.data)
      && event.data.claimedTransitionEvidence !== undefined
  })) return undefined
  const profileCommitmentEventIndexes = new Set<number>()
  for (const commitment of profileTransitionCommitments.values()) {
    const eventId = profileAgentEventIds[commitment.eventIndex]
    const event = eventId === undefined ? undefined : profileEventPayloadById.get(eventId)
    const observed = event?.claimedTransitionEvidence
    if (canonicalProfileJson(observed ?? null) !== canonicalProfileJson(commitment.evidence)) {
      return undefined
    }
    profileCommitmentEventIndexes.add(commitment.eventIndex)
    commitment.recordIds.forEach((recordId) => claimedChangeIds.add(recordId))
  }
  if (profileAgentEventIds.some((_eventId, eventIndex) => (
    !profileCommitmentEventIndexes.has(eventIndex)
  ))) return undefined
  const requireChange = (
    recordId: string,
    kind: ProfileLogicalRecordSpec['kind'],
    changeKind: DurableRecordTransition['changeKind'],
  ): DurableRecordTransition | undefined => claimChange(semanticChanges.find((change) => (
    change.recordId === recordId
    && change.changeKind === changeKind
    && (change.after ?? change.before)?.kind === kind
  )))
  const findChange = (
    recordId: string,
    kind: ProfileLogicalRecordSpec['kind'],
  ): DurableRecordTransition | undefined => claimChange(semanticChanges.find((change) => (
    change.recordId === recordId && (change.after ?? change.before)?.kind === kind
  )))
  const createdCardIdsByCommand = new Map<string, string>()
  const connectionEvidence = new Map<string, {
    initial: Record<string, unknown> | null
    current: Record<string, unknown> | null
  }>()
  const recordConnectionEvidence = (
    recordId: string,
    before: Record<string, unknown> | null,
    after: Record<string, unknown> | null,
  ): boolean => {
    const existing = connectionEvidence.get(recordId)
    if (!existing) {
      connectionEvidence.set(recordId, { initial: before, current: after })
      return true
    }
    if (canonicalProfileJson(existing.current) !== canonicalProfileJson(before)) return false
    existing.current = after
    return true
  }
  const resolveCardReference = (reference: unknown): string | undefined => {
    if (!isObjectRecord(reference)) return undefined
    if (typeof reference.cardId === 'string') return reference.cardId
    if (typeof reference.createdByCommandId === 'string') {
      return createdCardIdsByCommand.get(reference.createdByCommandId)
    }
    return undefined
  }
  const bindings: ProfileAgentCommandBinding[] = []
  for (const [index, command] of request.commands.entries()) {
    const result = receipt.commandResults[index]
    if (!result || result.commandId !== command.id || result.name !== command.name) return undefined
    const expectedId = (purpose: string) => deriveExpectedProfileAgentRecordId(
      request,
      context.profileId,
      command.id,
      purpose,
      dependencies.deriveId,
    )
    const claimedBefore = new Set(claimedIntentIds)
    let stampProvenance: ProfileAgentModStampProvenanceV1 | undefined
    if (command.name === 'idea.create' && result.name === 'idea.create') {
      if (context.installedSurfaceVersion < 4
        || result.ideaId !== expectedId('idea')
        || result.boardId !== `board:${result.ideaId}`
        || result.ideaName !== command.payload.name) return undefined
    } else if (command.name === 'idea.activate' && result.name === 'idea.activate') {
      if (context.installedSurfaceVersion < 5
        || result.activeIdeaId !== command.payload.ideaId
        || result.previousActiveIdeaId === result.activeIdeaId
        || (context.baseDocument !== undefined
          && result.previousActiveIdeaId !== context.baseDocument.head.activeIdeaId)
        || (replanned !== undefined
          && canonicalProfileJson(replanned.headTransition) !== canonicalProfileJson({
            kind: 'active-idea',
            commandId: command.id,
            previousActiveIdeaId: result.previousActiveIdeaId,
            activeIdeaId: result.activeIdeaId,
          }))) return undefined
    } else if (command.name === 'ask.set-model' && result.name === 'ask.set-model') {
      const intent = claimIntent((event) => (
        event.type === 'card.content.edited'
        && event.cardId === result.cardId
        && isObjectRecord(event.data)
        && event.data.field === 'model'
      ))
      if (context.installedSurfaceVersion < 5
        || result.model !== command.payload.model
        || !intent) return undefined
    } else if (command.name === 'card.set-identity' && result.name === 'card.set-identity') {
      const intent = claimIntent((event) => (
        event.type === 'card.content.edited'
        && event.cardId === result.cardId
        && isObjectRecord(event.data)
        && event.data.field === 'identity'
      ))
      if (context.installedSurfaceVersion < 5
        || canonicalProfileJson(result.identity) !== canonicalProfileJson(command.payload.identity)
        || !intent) return undefined
    } else if (command.name === 'cards.arrange' && result.name === 'cards.arrange') {
      const intent = claimIntent((event) => (
        event.type === 'cards.arranged'
        && isObjectRecord(event.data)
        && Array.isArray(event.data.changes)
        && event.data.changes.length > 0
        && event.data.changes.every((entry) => (
          isObjectRecord(entry)
          && typeof entry.cardId === 'string'
          && result.cardIds.includes(entry.cardId)
        ))
      ))
      if (context.installedSurfaceVersion < 5
        || result.cardIds.length !== command.payload.frames.length
        || new Set(result.cardIds).size !== result.cardIds.length
        || !intent) return undefined
    } else if (command.name === 'cards.reorder-layer'
      && result.name === 'cards.reorder-layer') {
      const intent = claimIntent((event) => (
        event.type === 'card.layer.changed'
        && isObjectRecord(event.data)
        && event.data.direction === result.direction
        && Array.isArray(event.data.changes)
        && event.data.changes.length > 0
      ))
      if (context.installedSurfaceVersion < 5
        || result.direction !== command.payload.direction
        || result.cardIds.length !== command.payload.cards.length
        || new Set(result.cardIds).size !== result.cardIds.length
        || !intent) return undefined
    } else if (command.name === 'group.membership.set'
      && result.name === 'group.membership.set') {
      const mappedEvents = mapAgentIntentEventsToCommands(
        request,
        receipt.commandResults,
        receipt.intentEventIds.map((eventId) => intentPayloadById.get(eventId)!),
      )?.[index]
      if (context.installedSurfaceVersion < 5 || mappedEvents === undefined) return undefined
      if (mappedEvents.length > 0) {
        const moved = claimIntent((event) => (
          event.type === 'card.moved'
          && isObjectRecord(event.data)
          && Array.isArray(event.data.moves)
          && event.data.moves.some((entry) => (
            isObjectRecord(entry) && entry.cardId === result.cardId
          ))
        ))
        const resizedCount = mappedEvents.filter(({ role }) => (
          role === 'group-container-resized'
        )).length
        const resized = Array.from({ length: resizedCount }, () => claimIntent((event) => (
          event.type === 'card.resized'
          && typeof event.cardId === 'string'
          && isObjectRecord(event.data)
        )))
        const membership = claimIntent((event) => (
          event.type === 'group.members.changed'
          && isObjectRecord(event.data)
          && isObjectRecord(event.data.memberChanges)
          && Object.prototype.hasOwnProperty.call(event.data.memberChanges, result.cardId)
        ))
        const mappedRoles = mappedEvents.map(({ role }) => role)
        if (!membership
          || resized.some((entry) => entry === undefined)
          || (mappedRoles.includes('group-members-moved') !== (moved !== undefined))) return undefined
      }
    } else if (command.name === 'output.choose-version'
      && result.name === 'output.choose-version') {
      const intent = claimIntent((event) => (
        event.type === 'version.chosen'
        && event.versionId === result.versionId
        && isObjectRecord(event.data)
        && event.data.outputId === result.outputId
        && event.data.nextVersionId === result.versionId
      ))
      if (context.installedSurfaceVersion < 5
        || result.outputId !== command.payload.outputId
        || result.versionId !== command.payload.versionId
        || !intent) return undefined
    } else if (command.name === 'output.set-accepted'
      && result.name === 'output.set-accepted') {
      const intent = claimIntent((event) => (
        event.type === 'version.acceptance.changed'
        && event.versionId === result.versionId
        && isObjectRecord(event.data)
        && event.data.outputId === result.outputId
        && event.data.to === result.accepted
      ))
      if (context.installedSurfaceVersion < 5
        || result.outputId !== command.payload.outputId
        || result.versionId !== command.payload.versionId
        || result.accepted !== command.payload.accepted
        || !intent) return undefined
    } else if (command.name === 'card.create' && result.name === 'card.create') {
      const card = findChange(result.cardId, 'card')
      const block = findChange(result.blockId, 'block')
      const intent = claimIntent((event) => (
        event.type === 'card.created' && event.cardId === result.cardId
      ))
      const data = intent === undefined || !isObjectRecord(intent.payload.data)
        ? undefined
        : intent.payload.data
      const eventCard = data !== undefined && isObjectRecord(data.card) ? data.card : undefined
      const eventBlocks = eventCard !== undefined && Array.isArray(eventCard.blocks)
        ? eventCard.blocks
        : undefined
      const eventBlock = eventBlocks?.find((candidate) => (
        isObjectRecord(candidate) && candidate.id === result.blockId
      ))
      const cardEnvelope = eventCard === undefined
        ? undefined
        : logicalCardEnvelopeFromAgentIntent(eventCard)
      const laterUpdatesBlock = request.commands.slice(index + 1).some((candidate) => (
        candidate.name === 'card.update-content'
        && candidate.payload.cardId === result.cardId
        && agentCardUpdateBodyText(candidate.payload) !== undefined
      ))
      const expectedBody = agentCreatedCardBody(command.payload)
      if (result.cardId !== expectedId('card')
        || result.blockId !== expectedId('block')
        || !intent || !eventCard || !eventBlock || !cardEnvelope
        || eventCard.id !== result.cardId
        || eventCard.kind !== command.payload.kind
        || (eventBlock as Record<string, unknown>).text !== expectedBody
        || (result.position !== undefined
          && canonicalProfileJson(result.position) !== canonicalProfileJson(eventCard.position))
        || (card !== undefined && (card.changeKind !== 'insert'
          || card.after === null
          || !agentCardPayloadMatchesIntent(card.after.payload, cardEnvelope)))
        || (block !== undefined && (block.changeKind !== 'insert'
          || block.after?.parentId !== result.cardId
          || (!laterUpdatesBlock
            && canonicalProfileJson(block.after.payload) !== canonicalProfileJson(eventBlock))))) {
        return undefined
      }
      createdCardIdsByCommand.set(command.id, result.cardId)
    } else if (command.name === 'card.update-content' && result.name === 'card.update-content') {
      const expectedEdits = agentExpectedCardContentEdits(command.payload)
      if (expectedEdits.length === 0) return undefined
      for (const expected of expectedEdits) {
        const intent = claimIntent((event) => {
          if (event.type !== 'card.content.edited'
            || event.cardId !== result.cardId
            || !isObjectRecord(event.data)
            || event.data.field !== expected.field) return false
          if (expected.text === undefined) {
            return event.data.textLength === undefined && event.data.contentSha256 === undefined
          }
          return event.data.textLength === expected.text.length
            && event.data.contentSha256 === dependencies.contentSha256(expected.text)
        })
        if (!intent) return undefined
      }
      const expectedBody = agentCardUpdateBodyText(command.payload)
      const block = expectedBody === undefined ? undefined : findChange(result.blockId, 'block')
      const card = expectedBody === undefined ? findChange(result.cardId, 'card') : undefined
      const laterUpdatesBlock = request.commands.slice(index + 1).some((candidate) => (
        candidate.name === 'card.update-content'
        && candidate.payload.cardId === result.cardId
        && agentCardUpdateBodyText(candidate.payload) !== undefined
      ))
      const terminalBlock = block?.after ?? block?.before
      const laterDelete = request.commands.slice(index + 1).some((candidate) => (
        candidate.name === 'card.delete' && candidate.payload.cardId === result.cardId
      ))
      const deletedCardBlock = laterDelete
        ? findAgentDeletedIntentBlock(
            receipt.intentEventIds,
            intentPayloadById,
            result.cardId,
            result.blockId,
          )
        : undefined
      const commandPayload: unknown = command.payload
      const requestedBlockId = isObjectRecord(commandPayload)
        && typeof commandPayload.blockId === 'string'
        ? commandPayload.blockId
        : undefined
      if (result.cardId !== command.payload.cardId
        || (requestedBlockId !== undefined && result.blockId !== requestedBlockId)
        || (block !== undefined && terminalBlock?.parentId !== result.cardId)
        || (expectedBody !== undefined && !laterUpdatesBlock && laterDelete
          && (!deletedCardBlock || deletedCardBlock.text !== expectedBody))
        || (expectedBody !== undefined && !laterUpdatesBlock && !laterDelete && terminalBlock != null
          && (!isObjectRecord(terminalBlock.payload)
            || terminalBlock.payload.text !== expectedBody))
        || (expectedBody === undefined && !laterDelete && card !== undefined
          && (card.changeKind !== 'update' || card.after?.recordId !== result.cardId))) return undefined
    } else if (command.name === 'card.delete' && result.name === 'card.delete') {
      const intent = claimIntent((event) => (
        event.type === 'card.deleted' && event.cardId === result.cardId
      ))
      const data = intent === undefined || !isObjectRecord(intent.payload.data)
        ? undefined
        : intent.payload.data
      const eventCard = data !== undefined && isObjectRecord(data.card) ? data.card : undefined
      const cardEnvelope = eventCard === undefined
        ? undefined
        : logicalCardEnvelopeFromAgentIntent(eventCard)
      const card = findChange(result.cardId, 'card')
      const createdEarlier = [...createdCardIdsByCommand.values()].includes(result.cardId)
      const reconciledEarlier = request.commands.slice(0, index).some((candidate) => (
        candidate.name === 'card.create'
      ))
      if (result.cardId !== command.payload.cardId
        || !intent || !data || !eventCard || !cardEnvelope
        || (card === undefined && !createdEarlier)
        || (card !== undefined && (card.changeKind !== 'delete'
          || card.before === null
          || (canonicalProfileJson(card.before.payload) !== canonicalProfileJson(cardEnvelope)
            && (!reconciledEarlier
              || !agentCardPayloadMatchesIntent(card.before.payload, cardEnvelope)))))) {
        return undefined
      }
      const eventBlocks = Array.isArray(eventCard.blocks) ? eventCard.blocks : []
      for (const change of semanticChanges.filter((candidate) => (
        candidate.changeKind === 'delete'
        && candidate.before?.kind === 'block'
        && candidate.before.parentId === result.cardId
      ))) {
        const eventBlock = eventBlocks.find((candidate) => (
          isObjectRecord(candidate) && candidate.id === change.recordId
        ))
        const precedingUpdate = [...request.commands.slice(0, index)].reverse().find((candidate) => (
          candidate.name === 'card.update-content'
          && candidate.payload.cardId === result.cardId
          && agentCardUpdateTargetsBlock(candidate.payload, change.recordId)
        ))
        const precedingText = precedingUpdate?.name === 'card.update-content'
          ? agentCardUpdateBodyText(precedingUpdate.payload)
          : undefined
        if (!eventBlock || (canonicalProfileJson(change.before!.payload)
          !== canonicalProfileJson(eventBlock)
          && (precedingText === undefined
            || eventBlock.text !== precedingText
            || !agentBlockPayloadDiffersOnlyByText(change.before!.payload, eventBlock)))) {
          return undefined
        }
      }
      const eventConnections = Array.isArray(data.connections) ? data.connections : []
      const eventConnectionIds = new Set<string>()
      for (const candidate of eventConnections) {
        if (!isObjectRecord(candidate)
          || typeof candidate.id !== 'string'
          || eventConnectionIds.has(candidate.id)
          || !agentConnectionTouchesCard(candidate, result.cardId)
          || !recordConnectionEvidence(candidate.id, candidate, null)) return undefined
        eventConnectionIds.add(candidate.id)
      }
    } else if (command.name === 'connection.create' && result.name === 'connection.create') {
      if ((result.route === 'direct'
        && (result.connectionIds.length !== 1
          || result.connectionIds[0] !== expectedId('connection')
          || result.resultCardId !== null
          || result.resultCreated))
        || (result.route === 'through-result'
          && (result.resultCardId === null
            || result.connectionIds.length !== (result.resultCreated ? 2 : 1)
            || result.connectionIds[result.connectionIds.length - 1] !== expectedId('routed-connection')
            || (result.resultCreated
              && (result.resultCardId !== expectedId('result-card')
                || result.connectionIds[0] !== expectedId('source-result-connection')))))) {
        return undefined
      }
      const connectionPayloads = new Map<string, Record<string, unknown>>()
      for (const connectionId of result.connectionIds) {
        const intent = claimIntent((event) => (
          event.type === 'connection.created' && event.connectionId === connectionId
        ))
        const data = intent === undefined || !isObjectRecord(intent.payload.data)
          ? undefined
          : intent.payload.data
        const connection = data !== undefined && isObjectRecord(data.connection)
          ? data.connection
          : undefined
        if (!connection || connection.id !== connectionId
          || !recordConnectionEvidence(connectionId, null, connection)) return undefined
        connectionPayloads.set(connectionId, connection)
      }
      const fromCardId = resolveCardReference(command.payload.from)
      const toCardId = resolveCardReference(command.payload.to)
      if (!fromCardId || !toCardId) return undefined
      const routedConnection = connectionPayloads.get(
        result.connectionIds[result.connectionIds.length - 1]!,
      )
      if (!routedConnection
        || !agentCreatedConnectionMeaningMatchesCommand(routedConnection, command.payload)) {
        return undefined
      }
      if (result.route === 'direct') {
        if (!agentConnectionHasEndpoints(routedConnection, fromCardId, toCardId)) return undefined
      } else if (result.resultCardId === null
        || !agentConnectionStartsAt(routedConnection, result.resultCardId)
        || !agentConnectionEndsAt(routedConnection, toCardId)) return undefined
      if (result.resultCreated) {
        const resultBlockId = expectedId('result-block')
        const resultCardChange = requireChange(result.resultCardId!, 'card', 'insert')
        const resultBlock = requireChange(resultBlockId, 'block', 'insert')
        const resultIntent = claimIntent((event) => (
          event.type === 'card.created' && event.cardId === result.resultCardId
        ))
        const resultData = resultIntent === undefined || !isObjectRecord(resultIntent.payload.data)
          ? undefined
          : resultIntent.payload.data
        const resultCard = resultData !== undefined && isObjectRecord(resultData.card)
          ? resultData.card
          : undefined
        const resultBlocks = resultCard !== undefined && Array.isArray(resultCard.blocks)
          ? resultCard.blocks
          : undefined
        const resultEventBlock = resultBlocks?.[0]
        const resultCardEnvelope = resultCard === undefined
          ? undefined
          : logicalCardEnvelopeFromAgentIntent(resultCard)
        const sourceResultConnection = connectionPayloads.get(result.connectionIds[0]!)
        if (!result.resultCardId
          || !resultCardChange?.after
          || !resultBlock
          || !resultBlock.after
          || resultBlock.after?.parentId !== result.resultCardId
          || !resultIntent
          || !resultCard
          || resultCard.id !== result.resultCardId
          || resultCard.kind !== 'result'
          || !resultCardEnvelope
          || canonicalProfileJson(resultCardChange.after.payload)
            !== canonicalProfileJson(resultCardEnvelope)
          || resultBlocks?.length !== 1
          || !isObjectRecord(resultEventBlock)
          || resultEventBlock.id !== resultBlockId
          || resultEventBlock.text !== ''
          || canonicalProfileJson(resultBlock.after.payload)
            !== canonicalProfileJson(resultEventBlock)
          || !sourceResultConnection
          || !agentDefaultSourceResultConnection(
            sourceResultConnection,
            fromCardId,
            result.resultCardId,
          )) return undefined
      }
    } else if (command.name === 'connection.update-meaning'
      && result.name === 'connection.update-meaning') {
      const intent = claimIntent((event) => (
        event.type === 'connection.changed' && event.connectionId === result.connectionId
      ))
      const data = intent === undefined || !isObjectRecord(intent.payload.data)
        ? undefined
        : intent.payload.data
      const before = data !== undefined && isObjectRecord(data.before) ? data.before : undefined
      const after = data !== undefined && isObjectRecord(data.after) ? data.after : undefined
      const expectedAfter = before === undefined
        ? undefined
        : agentConnectionAfterMeaningCommand(before, command.payload)
      if (result.connectionId !== command.payload.connectionId
        || !before || !after
        || before.id !== result.connectionId || after.id !== result.connectionId
        || !expectedAfter
        || canonicalProfileJson(after) !== canonicalProfileJson(expectedAfter)
        || !recordConnectionEvidence(result.connectionId, before, after)) return undefined
    } else if (command.name === 'connection.delete' && result.name === 'connection.delete') {
      const intent = claimIntent((event) => (
        event.type === 'connection.deleted' && event.connectionId === result.connectionId
      ))
      const data = intent === undefined || !isObjectRecord(intent.payload.data)
        ? undefined
        : intent.payload.data
      const connection = data !== undefined && isObjectRecord(data.connection)
        ? data.connection
        : undefined
      if (result.connectionId !== command.payload.connectionId
        || !connection || connection.id !== result.connectionId
        || !recordConnectionEvidence(result.connectionId, connection, null)) return undefined
    } else if ((command.name === 'mod-template.create' && result.name === 'mod-template.create')
      || (command.name === 'mod-template.update' && result.name === 'mod-template.update')
      || (command.name === 'mod-template.delete' && result.name === 'mod-template.delete')) {
      if (context.installedSurfaceVersion < 2) return undefined
    } else if (command.name === 'mod-instance.stamp' && result.name === 'mod-instance.stamp') {
      if (context.installedSurfaceVersion < 2) return undefined
      const card = findChange(result.cardId, 'card')
      const block = findChange(result.blockId, 'block')
      const instance = findChange(result.instanceId, 'mod-instance')
      const intent = claimIntent((event) => (
        event.type === 'card.created' && event.cardId === result.cardId
      ))
      const data = intent === undefined || !isObjectRecord(intent.payload.data)
        ? undefined
        : intent.payload.data
      const eventCard = data !== undefined && isObjectRecord(data.card) ? data.card : undefined
      const eventBlocks = eventCard !== undefined && Array.isArray(eventCard.blocks)
        ? eventCard.blocks
        : undefined
      const eventBlock = eventBlocks?.find((candidate) => (
        isObjectRecord(candidate) && candidate.id === result.blockId
      ))
      const cardEnvelope = eventCard === undefined
        ? undefined
        : logicalCardEnvelopeFromAgentIntent(eventCard)
      const requestCanonicalJson = canonicalProfileJson({
        version: request.version,
        schemaVersion: request.schemaVersion,
        expectedRevision: request.expectedRevision,
        commands: request.commands,
      })
      const expectedInstanceId = dependencies.deriveId({
        profileId: context.profileId,
        actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
        idempotencyKey: request.idempotencyKey,
        requestCanonicalJson,
        commandId: command.id,
        purpose: 'mod-instance',
        sourceId: command.payload.templateId,
        ordinal: 0,
      })
      const expectedControlMap = result.idMap.controls.map((pair, ordinal) => ({
        sourceId: pair.sourceId,
        instanceId: dependencies.deriveId({
          profileId: context.profileId,
          actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
          idempotencyKey: request.idempotencyKey,
          requestCanonicalJson,
          commandId: command.id,
          purpose: 'mod-control',
          sourceId: pair.sourceId,
          ordinal,
        }),
      }))
      const instanceMod = instance?.after !== null
        && instance?.after !== undefined
        && isObjectRecord(instance.after.payload)
        ? validateProfileModDocumentTransport(instance.after.payload.mod)
        : undefined
      const instancePartIds = instanceMod?.ok
        ? listModPartIdentities(instanceMod.value).map(({ sourceId }) => sourceId)
        : undefined
      if (result.cardId !== expectedId('card')
        || result.blockId !== expectedId('block')
        || result.instanceId !== expectedInstanceId
        || result.source.templateId !== command.payload.templateId
        || result.source.templateVersion !== command.payload.expectedTemplateVersion
        || result.idMap.mod.sourceId !== command.payload.templateId
        || result.idMap.mod.instanceId !== result.instanceId
        || canonicalProfileJson(result.idMap.controls)
          !== canonicalProfileJson(expectedControlMap)
        || !intent || !eventCard || !eventBlock || !cardEnvelope
        || eventCard.id !== result.cardId
        || eventCard.kind !== 'mod'
        || card?.changeKind !== 'insert'
        || card.after === null
        || !agentCardPayloadMatchesIntent(card.after.payload, cardEnvelope)
        || block?.changeKind !== 'insert'
        || block.after?.parentId !== result.cardId
        || canonicalProfileJson(block.after.payload) !== canonicalProfileJson(eventBlock)
        || instance?.changeKind !== 'insert'
        || instance.after?.parentId !== result.cardId
        || !isObjectRecord(instance.after.payload)
        || !isObjectRecord(instance.after.payload.source)
        || instance.after.payload.source.kind !== 'template'
        || instance.after.payload.source.templateId !== result.source.templateId
        || instance.after.payload.source.templateVersion !== result.source.templateVersion
        || canonicalProfileJson(instance.after.payload.idMap)
          !== canonicalProfileJson(result.idMap)
        || canonicalProfileJson(instancePartIds)
          !== canonicalProfileJson(result.idMap.controls.map(({ instanceId }) => instanceId))
        || canonicalProfileJson(instance.after.payload.mod) !== canonicalProfileJson(eventCard.modV2)) {
        return undefined
      }
      if (!instanceMod?.ok) return undefined
      let sourceMod: ProfileModDocument
      try {
        sourceMod = remapModPartIdentities(instanceMod.value, ({ sourceId, ordinal }) => {
          const pair = result.idMap.controls[ordinal]
          if (pair?.instanceId !== sourceId) {
            throw new Error('Stamped Mod instance identity order differs from its result map')
          }
          return pair.sourceId
        }).value
      } catch {
        return undefined
      }
      if (canonicalProfileJson(listModPartIdentities(sourceMod).map(({ sourceId }) => sourceId))
        !== canonicalProfileJson(result.idMap.controls.map(({ sourceId }) => sourceId))) {
        return undefined
      }
      if (replanned !== undefined) {
        const sourceTemplates = replanned.modStampSourceTemplates.filter((candidate) => (
          candidate.commandId === command.id
        ))
        if (sourceTemplates.length !== 1) return undefined
        stampProvenance = createAgentModStampProvenance(
          sourceTemplates[0]!.template,
          sourceMod,
          result.source.templateId,
          result.source.templateVersion,
          context.profileId,
          dependencies.recordDigest,
        )
      } else {
        stampProvenance = readStoredAgentModStampProvenance(
          context.storedCommandBindings,
          command.id,
          sourceMod,
          result.source.templateId,
          result.source.templateVersion,
          context.profileId,
          dependencies.recordDigest,
        )
      }
      if (stampProvenance === undefined) return undefined
      createdCardIdsByCommand.set(command.id, result.cardId)
    } else if (command.name === 'mod-instance.create'
      && result.name === 'mod-instance.create') {
      if (context.installedSurfaceVersion < 5) return undefined
      const card = findChange(result.cardId, 'card')
      const block = findChange(result.blockId, 'block')
      const instance = findChange(result.instanceId, 'mod-instance')
      const intent = claimIntent((event) => (
        event.type === 'card.created' && event.cardId === result.cardId
      ))
      const data = intent === undefined || !isObjectRecord(intent.payload.data)
        ? undefined
        : intent.payload.data
      const eventCard = data !== undefined && isObjectRecord(data.card) ? data.card : undefined
      const eventBlocks = eventCard !== undefined && Array.isArray(eventCard.blocks)
        ? eventCard.blocks
        : undefined
      const eventBlock = eventBlocks?.find((candidate) => (
        isObjectRecord(candidate) && candidate.id === result.blockId
      ))
      const cardEnvelope = eventCard === undefined
        ? undefined
        : logicalCardEnvelopeFromAgentIntent(eventCard)
      const requestCanonicalJson = canonicalProfileJson({
        version: request.version,
        schemaVersion: request.schemaVersion,
        expectedRevision: request.expectedRevision,
        commands: request.commands,
      })
      const expectedInstanceId = dependencies.deriveId({
        profileId: context.profileId,
        actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
        idempotencyKey: request.idempotencyKey,
        requestCanonicalJson,
        commandId: command.id,
        purpose: 'mod-instance',
        sourceId: command.id,
        ordinal: 0,
      })
      const laterConfigure = request.commands.slice(index + 1).some((candidate) => (
        candidate.name === 'mod-instance.configure'
        && candidate.payload.cardId === result.cardId
      ))
      const laterDelete = request.commands.slice(index + 1).some((candidate) => (
        (candidate.name === 'mod-instance.delete' || candidate.name === 'card.delete')
        && candidate.payload.cardId === result.cardId
      ))
      const instancePayload = instance?.after !== null && instance?.after !== undefined
        && isObjectRecord(instance.after.payload)
        ? instance.after.payload
        : undefined
      const instanceMod = instancePayload === undefined
        ? undefined
        : validateProfileModDocumentTransport(instancePayload.mod)
      if (result.cardId !== expectedId('card')
        || result.blockId !== expectedId('block')
        || result.instanceId !== expectedInstanceId
        || result.source.kind !== 'direct'
        || !intent || !eventCard || !eventBlock || !cardEnvelope
        || eventCard.id !== result.cardId
        || eventCard.kind !== 'mod'
        || canonicalProfileJson(eventCard.modV2) !== canonicalProfileJson(command.payload.mod)
        || (card === undefined && !laterDelete)
        || (card !== undefined && (card.changeKind !== 'insert'
          || card.after === null
          || !agentCardPayloadMatchesIntent(card.after.payload, cardEnvelope)))
        || (block === undefined && !laterDelete)
        || (block !== undefined && (block.changeKind !== 'insert'
          || block.after?.parentId !== result.cardId
          || canonicalProfileJson(block.after.payload) !== canonicalProfileJson(eventBlock)))
        || (instance === undefined && !laterDelete)
        || (instance !== undefined && (instance.changeKind !== 'insert'
          || instance.after?.ownerId !== `board:${command.payload.ideaId}`
          || instance.after.parentId !== result.cardId
          || !instancePayload
          || !isObjectRecord(instancePayload.source)
          || instancePayload.source.kind !== 'direct'
          || instancePayload.createdAt !== context.committedAt
          || !instanceMod?.ok
          || (!laterConfigure
            && canonicalProfileJson(instancePayload.mod)
              !== canonicalProfileJson(command.payload.mod))))) return undefined
      createdCardIdsByCommand.set(command.id, result.cardId)
    } else if (command.name === 'mod-instance.configure'
      && result.name === 'mod-instance.configure') {
      const intent = claimIntent((event) => (
        event.type === 'card.content.edited'
        && event.cardId === result.cardId
        && isObjectRecord(event.data)
        && event.data.field === 'modControl'
      ))
      const instanceChange = semanticChanges.find((change) => (
        change.recordId === result.instanceId
        && (change.after ?? change.before)?.kind === 'mod-instance'
      ))
      const createdEarlier = receipt.commandResults.slice(0, index).some((candidate) => (
        (candidate.name === 'mod-instance.create' || candidate.name === 'mod-instance.stamp')
        && candidate.cardId === result.cardId
        && candidate.instanceId === result.instanceId
      ))
      const laterWriter = request.commands.slice(index + 1).some((candidate) => (
        (candidate.name === 'mod-instance.configure'
          || candidate.name === 'mod-instance.delete'
          || candidate.name === 'card.delete')
        && candidate.payload.cardId === result.cardId
      ))
      const terminalPayload = instanceChange?.after !== null
        && instanceChange?.after !== undefined
        && isObjectRecord(instanceChange.after.payload)
        ? instanceChange.after.payload
        : undefined
      if (context.installedSurfaceVersion < 5
        || result.cardId !== command.payload.cardId
        || !intent
        || (!instanceChange && !createdEarlier)
        || (instanceChange !== undefined
          && (instanceChange.after ?? instanceChange.before)?.parentId !== result.cardId)
        || (!laterWriter && (!terminalPayload
          || canonicalProfileJson(terminalPayload.mod)
            !== canonicalProfileJson(command.payload.mod)))) return undefined
    } else if (command.name === 'mod-instance.delete'
      && result.name === 'mod-instance.delete') {
      const intent = claimIntent((event) => (
        event.type === 'card.deleted' && event.cardId === result.cardId
      ))
      const data = intent === undefined || !isObjectRecord(intent.payload.data)
        ? undefined
        : intent.payload.data
      const eventCard = data !== undefined && isObjectRecord(data.card) ? data.card : undefined
      const instanceChange = semanticChanges.find((change) => (
        change.recordId === result.instanceId
        && change.changeKind === 'delete'
        && change.before?.kind === 'mod-instance'
      ))
      const createdEarlier = receipt.commandResults.slice(0, index).some((candidate) => (
        (candidate.name === 'mod-instance.create' || candidate.name === 'mod-instance.stamp')
        && candidate.cardId === result.cardId
        && candidate.instanceId === result.instanceId
      ))
      if (context.installedSurfaceVersion < 5
        || result.cardId !== command.payload.cardId
        || !intent || !eventCard
        || eventCard.id !== result.cardId || eventCard.kind !== 'mod'
        || eventCard.modV2 === undefined
        || !Array.isArray(data?.connections)
        || !Array.isArray(data?.outputs) || data.outputs.length !== 0
        || (!instanceChange && !createdEarlier)
        || (instanceChange !== undefined
          && (instanceChange.before?.ownerId !== `board:${command.payload.ideaId}`
            || instanceChange.before.parentId !== result.cardId
            || !isObjectRecord(instanceChange.before.payload)
            || canonicalProfileJson(instanceChange.before.payload.mod)
              !== canonicalProfileJson(eventCard.modV2)))) return undefined
    } else {
      return undefined
    }
    const claimedByCommand = receipt.intentEventIds.filter((eventId) => (
      claimedIntentIds.has(eventId) && !claimedBefore.has(eventId)
    ))
    const commitments = [...transitionCommitments.values()]
      .filter((commitment) => commitment.commandIndex === index)
      .sort((left, right) => left.eventIndex - right.eventIndex)
    const expectedEventIds = commitments.map((commitment) => (
      receipt.intentEventIds[commitment.eventIndex]
    ))
    if (expectedEventIds.some((eventId) => eventId === undefined)
      || canonicalProfileJson(claimedByCommand) !== canonicalProfileJson(expectedEventIds)) {
      return undefined
    }
    const profileCommitments = [...profileTransitionCommitments.values()]
      .filter((commitment) => commitment.commandIndex === index)
      .sort((left, right) => left.eventIndex - right.eventIndex)
    bindings.push(Object.freeze({
      commandId: command.id,
      events: Object.freeze([
        ...commitments.map((commitment) => Object.freeze({
          ...(context.installedSurfaceVersion >= 2 ? { eventKind: 'intent-event' as const } : {}),
          eventId: receipt.intentEventIds[commitment.eventIndex]!,
          role: commitment.role,
          evidence: commitment.evidence,
        })),
        ...profileCommitments.map((commitment) => Object.freeze({
          eventKind: 'profile-agent-event' as const,
          eventId: profileAgentEventIds[commitment.eventIndex]!,
          role: commitment.role,
          evidence: commitment.evidence,
        })),
      ]),
      ...(stampProvenance === undefined ? {} : { stampProvenance }),
    }))
  }
  for (const [connectionId, evidence] of connectionEvidence) {
    const change = findChange(connectionId, 'connection')
    if (evidence.initial === null && evidence.current === null) {
      if (change !== undefined) return undefined
      continue
    }
    if (!change) {
      if (canonicalProfileJson(evidence.initial) === canonicalProfileJson(evidence.current)) continue
      return undefined
    }
    if (evidence.initial === null) {
      if (change.changeKind !== 'insert' || change.after === null
        || canonicalProfileJson(change.after.payload) !== canonicalProfileJson(evidence.current)) {
        return undefined
      }
    } else if (evidence.current === null) {
      if (change.changeKind !== 'delete' || change.before === null
        || canonicalProfileJson(change.before.payload) !== canonicalProfileJson(evidence.initial)) {
        return undefined
      }
    } else if (change.changeKind !== 'update' || change.before === null || change.after === null
      || canonicalProfileJson(change.before.payload) !== canonicalProfileJson(evidence.initial)
      || canonicalProfileJson(change.after.payload) !== canonicalProfileJson(evidence.current)) {
      return undefined
    }
  }
  if (semanticChanges.some((change) => (
    change.before !== null
    && change.after !== null
    && change.before.ordinal !== change.after.ordinal
    && !agentOrdinalShiftMatchesClaimedDeletes(change, semanticChanges, claimedChangeIds)
  ))) return undefined
  for (const change of semanticChanges) {
    if (!claimedChangeIds.has(change.recordId)
      && agentStructuralOrdinalNormalization(change, semanticChanges, claimedChangeIds)) {
      claimedChangeIds.add(change.recordId)
    }
  }
  if (semanticChanges.some((change) => !claimedChangeIds.has(change.recordId))) return undefined
  if (claimedIntentIds.size !== receipt.intentEventIds.length) return undefined
  return Object.freeze(bindings)
}

/**
 * Reuses the durable transition commitments to recover which command owns each
 * user-meaningful record change. Board timestamp rows and immutable audit-event
 * rows are evidence for the revision, not change-trail items.
 */
export function deriveAgentRecordCommandOwners(
  request: ProfileAgentCommandRequest,
  receipt: ProfileAgentCommandBatchReceipt,
  changes: readonly DurableRecordTransition[],
  context: Readonly<{
    installedSurfaceVersion: ProfileAgentCommandSurfaceVersion
    profileId: string
    clientTxnId: string
    committedAt: string
    transport: ProfileAgentInstalledTransport
    actor?: CardAuthorship
  }>,
  recordDigest: AgentCommandAuditDependencies['recordDigest'],
): readonly AgentRecordCommandOwner[] | undefined {
  if (receipt.commitId === null || request.commands.length !== receipt.commandResults.length) {
    return undefined
  }
  const ideaIds = new Set(request.commands.flatMap((command) => {
    const payload: unknown = command.payload
    return command.name !== 'idea.activate'
      && isObjectRecord(payload) && typeof payload.ideaId === 'string'
      ? [payload.ideaId]
      : []
  }))
  if (ideaIds.size > 1) return undefined
  const ideaId = [...ideaIds][0]
  const boardId = ideaId === undefined ? undefined : `board:${ideaId}`
  const intentIds = new Set(receipt.intentEventIds)
  const profileAgentEventIds: readonly string[] = receipt.version === 1
    ? []
    : receipt.profileAgentEventIds
  const profileEventIds = new Set(profileAgentEventIds)
  const intentPayloadById = new Map(changes.flatMap((change) => (
    intentIds.has(change.recordId)
      && change.changeKind === 'insert'
      && change.after?.kind === 'intent-event'
      && isObjectRecord(change.after.payload)
      ? [[change.recordId, change.after.payload] as const]
      : []
  )))
  const profileEventPayloadById = new Map(changes.flatMap((change) => (
    profileEventIds.has(change.recordId)
      && change.changeKind === 'insert'
      && change.after?.kind === 'profile-agent-event'
      && isObjectRecord(change.after.payload)
      ? [[change.recordId, change.after.payload] as const]
      : []
  )))
  if (intentPayloadById.size !== receipt.intentEventIds.length
    || profileEventPayloadById.size !== profileEventIds.size) return undefined

  const semanticChanges = changes.filter((change) => (
    change.recordId !== boardId
    && !intentIds.has(change.recordId)
    && !profileEventIds.has(change.recordId)
  ))
  const attestationContext: AgentOutcomeAttestationContext = Object.freeze({
    installedSurfaceVersion: context.installedSurfaceVersion,
    profileId: context.profileId,
    actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
    transport: context.transport,
    ...(context.actor === undefined ? {} : { actor: context.actor }),
    clientTxnId: context.clientTxnId,
    commitId: receipt.commitId,
    committedAt: context.committedAt,
  })
  const intentCommitments = deriveAgentTransitionCommitments(
    request,
    receipt.commandResults,
    receipt.intentEventIds.map(eventId => intentPayloadById.get(eventId)!),
    semanticChanges.filter((change) => !isProfileAgentSemanticRecordKind(
      (change.after ?? change.before)?.kind,
    )),
    attestationContext,
    recordDigest,
  )
  const profileCommitments = deriveProfileAgentTransitionCommitments(
    request,
    receipt.commandResults,
    profileAgentEventIds.map(eventId => profileEventPayloadById.get(eventId)!),
    semanticChanges.filter((change) => isProfileAgentSemanticRecordKind(
      (change.after ?? change.before)?.kind,
    )),
    attestationContext,
    recordDigest,
  )
  if (!intentCommitments || !profileCommitments) return undefined

  const ownerByRecordId = new Map<string, number>()
  for (const commitment of [...intentCommitments.values(), ...profileCommitments.values()]) {
    for (const recordId of commitment.recordIds) {
      if (ownerByRecordId.has(recordId)) return undefined
      ownerByRecordId.set(recordId, commitment.commandIndex)
    }
  }
  if (semanticChanges.some(change => !ownerByRecordId.has(change.recordId))) return undefined
  return Object.freeze(semanticChanges.map((change) => Object.freeze({
    recordId: change.recordId,
    commandIndex: ownerByRecordId.get(change.recordId)!,
  })))
}

function agentModInstanceIdentityAccentChange(
  change: DurableRecordTransition,
  cardId: string,
  solid: string,
): boolean {
  if (change.changeKind !== 'update'
    || change.before?.kind !== 'mod-instance'
    || change.after?.kind !== 'mod-instance'
    || change.before.parentId !== cardId
    || change.after.parentId !== cardId
    || !isObjectRecord(change.before.payload)
    || !isObjectRecord(change.after.payload)
    || !isObjectRecord(change.before.payload.mod)
    || !isObjectRecord(change.after.payload.mod)) return false
  const { payload: _beforePayload, ...beforeEnvelope } = change.before
  const { payload: _afterPayload, ...afterEnvelope } = change.after
  const { mod: beforeMod, ...beforeProvenance } = change.before.payload
  const { mod: afterMod, ...afterProvenance } = change.after.payload
  const { accent: beforeAccent, ...beforeModRest } = beforeMod
  const { accent: afterAccent, ...afterModRest } = afterMod
  return beforeAccent !== solid
    && afterAccent === solid
    && canonicalProfileJson(beforeEnvelope) === canonicalProfileJson(afterEnvelope)
    && canonicalProfileJson(beforeProvenance) === canonicalProfileJson(afterProvenance)
    && canonicalProfileJson(beforeModRest) === canonicalProfileJson(afterModRest)
}

function agentCardIdentityChange(
  change: DurableRecordTransition,
  cardId: string,
  identity: ProfileAgentCardSetIdentityCommand['payload']['identity'],
  actor: CardAuthorship,
): boolean {
  if (change.changeKind !== 'update'
    || change.recordId !== cardId
    || change.before?.kind !== 'card'
    || change.after?.kind !== 'card'
    || !isObjectRecord(change.before.payload)
    || !isObjectRecord(change.after.payload)) return false
  const { payload: _beforePayload, ...beforeEnvelope } = change.before
  const { payload: _afterPayload, ...afterEnvelope } = change.after
  if (canonicalProfileJson(beforeEnvelope) !== canonicalProfileJson(afterEnvelope)) return false
  const expected = { ...change.before.payload }
  if (identity === null) {
    delete expected.headerColor
    delete expected.headerFill
  } else {
    const solid = cardIdentityPresetSolid(identity.preset)
    if (solid === undefined) return false
    expected.headerColor = solid
    expected.headerFill = identity.fill === 'soft'
      ? 'half'
      : identity.fill === 'body'
        ? 'full'
        : 'pattern'
  }
  expected.lastModifiedBy = actor
  return canonicalProfileJson(change.before.payload)
      !== canonicalProfileJson(change.after.payload)
    && canonicalProfileJson(expected) === canonicalProfileJson(change.after.payload)
}

function agentStructuralOrdinalNormalization(
  change: DurableRecordTransition,
  changes: readonly DurableRecordTransition[],
  claimedChangeIds: ReadonlySet<string>,
): boolean {
  if (change.changeKind !== 'update'
    || !change.before
    || !change.after
    || !['card', 'connection', 'output', 'highlight'].includes(change.before.kind)
    || change.before.kind !== change.after.kind) return false
  const { ordinal: _beforeOrdinal, ...before } = change.before
  const { ordinal: _afterOrdinal, ...after } = change.after
  if (canonicalProfileJson(before) !== canonicalProfileJson(after)) return false
  return agentOrdinalShiftMatchesClaimedDeletes(change, changes, claimedChangeIds)
}

function agentOrdinalShiftMatchesClaimedDeletes(
  change: DurableRecordTransition,
  changes: readonly DurableRecordTransition[],
  claimedChangeIds: ReadonlySet<string>,
): boolean {
  if (change.changeKind !== 'update'
    || !change.before
    || !change.after
    || !['card', 'connection', 'output', 'highlight'].includes(change.before.kind)
    || change.before.kind !== change.after.kind) return false
  const collectionKey = agentRecordCollectionKey(change.before)
  const precedingDeletes = changes.filter((candidate) => (
    claimedChangeIds.has(candidate.recordId)
    && candidate.changeKind === 'delete'
    && candidate.before !== null
    && agentRecordCollectionKey(candidate.before) === collectionKey
    && candidate.before.ordinal < change.before!.ordinal
  )).length
  return precedingDeletes > 0
    && change.after.ordinal === change.before.ordinal - precedingDeletes
}

function logicalCardEnvelopeFromAgentIntent(
  card: Record<string, unknown>,
): Record<string, unknown> | undefined {
  if (!Array.isArray(card.blocks)) return undefined
  const { blocks: _blocks, assets, mod: _mod, modV2: _modV2, ...envelope } = card
  if (assets === undefined) return envelope
  if (!Array.isArray(assets)) return undefined
  const assetIds = assets.map((asset) => (
    isObjectRecord(asset) && typeof asset.id === 'string' ? asset.id : undefined
  ))
  if (assetIds.some((assetId) => assetId === undefined)) return undefined
  return assetIds.length === 0 ? envelope : { ...envelope, assetIds }
}

function findAgentDeletedIntentBlock(
  intentEventIds: readonly string[],
  intentPayloadById: ReadonlyMap<string, Record<string, unknown>>,
  cardId: string,
  blockId: string,
): Record<string, unknown> | undefined {
  for (const eventId of intentEventIds) {
    const event = intentPayloadById.get(eventId)
    if (!event || event.type !== 'card.deleted' || event.cardId !== cardId
      || !isObjectRecord(event.data) || !isObjectRecord(event.data.card)
      || !Array.isArray(event.data.card.blocks)) continue
    const block = event.data.card.blocks.find((candidate) => (
      isObjectRecord(candidate) && candidate.id === blockId
    ))
    if (isObjectRecord(block)) return block
  }
  return undefined
}

function agentBlockPayloadDiffersOnlyByText(
  before: unknown,
  after: Record<string, unknown>,
): boolean {
  if (!isObjectRecord(before)) return false
  const { text: _beforeText, ...beforeRest } = before
  const { text: _afterText, ...afterRest } = after
  return canonicalProfileJson(beforeRest) === canonicalProfileJson(afterRest)
}

type AgentExpectedCardContentEdit = Readonly<{
  field: 'body' | 'title' | 'groupPrompt' | 'conversationSettings'
  text?: string
}>

function agentCreatedCardBody(payload: unknown): string | undefined {
  if (!isObjectRecord(payload)) return undefined
  if (typeof payload.text === 'string') return payload.text
  if (typeof payload.body === 'string') return payload.body
  if (typeof payload.topic === 'string') return payload.topic
  return payload.kind === 'group' ? '' : undefined
}

function agentExpectedCardContentEdits(payload: unknown): readonly AgentExpectedCardContentEdit[] {
  if (!isObjectRecord(payload)) return Object.freeze([])
  if (typeof payload.text === 'string') {
    return Object.freeze([{ field: 'body', text: payload.text }])
  }
  if (typeof payload.body === 'string') {
    return Object.freeze([{ field: 'body', text: payload.body }])
  }
  const edits: AgentExpectedCardContentEdit[] = []
  if (typeof payload.groupTitle === 'string') {
    edits.push(Object.freeze({ field: 'title', text: payload.groupTitle }))
  }
  if (typeof payload.compressionPrompt === 'string') {
    edits.push(Object.freeze({ field: 'groupPrompt', text: payload.compressionPrompt }))
  }
  if (typeof payload.topic === 'string') {
    edits.push(Object.freeze({ field: 'body', text: payload.topic }))
  }
  if (typeof payload.conversationStyle === 'string'
    || typeof payload.conversationTurns === 'number') {
    edits.push(Object.freeze({ field: 'conversationSettings' }))
  }
  return Object.freeze(edits)
}

function agentCardUpdateBodyText(payload: unknown): string | undefined {
  if (!isObjectRecord(payload)) return undefined
  if (typeof payload.text === 'string') return payload.text
  if (typeof payload.body === 'string') return payload.body
  return typeof payload.topic === 'string' ? payload.topic : undefined
}

function agentCardUpdateTargetsBlock(payload: unknown, blockId: string): boolean {
  if (!isObjectRecord(payload) || agentCardUpdateBodyText(payload) === undefined) return false
  return typeof payload.blockId !== 'string' || payload.blockId === blockId
}

function agentConnectionTouchesCard(
  connection: Record<string, unknown>,
  cardId: string,
): boolean {
  return agentConnectionEndpoint(connection.from) === cardId
    || agentConnectionEndpoint(connection.to) === cardId
}

function agentConnectionStartsAt(
  connection: Record<string, unknown>,
  cardId: string,
): boolean {
  return agentConnectionEndpoint(connection.from) === cardId
}

function agentConnectionEndsAt(
  connection: Record<string, unknown>,
  cardId: string,
): boolean {
  return agentConnectionEndpoint(connection.to) === cardId
}

function agentConnectionHasEndpoints(
  connection: Record<string, unknown>,
  leftCardId: string,
  rightCardId: string,
): boolean {
  const from = agentConnectionEndpoint(connection.from)
  const to = agentConnectionEndpoint(connection.to)
  return (from === leftCardId && to === rightCardId)
    || (from === rightCardId && to === leftCardId)
}

function agentConnectionEndpoint(candidate: unknown): string | undefined {
  return isObjectRecord(candidate) && typeof candidate.cardId === 'string'
    ? candidate.cardId
    : undefined
}

function agentCreatedConnectionMeaningMatchesCommand(
  connection: Record<string, unknown>,
  payload: Readonly<{
    strength?: unknown
    polarity?: unknown
    reason?: unknown
    groupMode?: unknown
  }>,
): boolean {
  if (typeof connection.id !== 'string'
    || !isObjectRecord(connection.from)
    || !isObjectRecord(connection.to)
    || typeof connection.role !== 'string') return false
  const reason = typeof payload.reason === 'string' && payload.reason.trim()
    ? payload.reason.trim()
    : undefined
  const expected = {
    id: connection.id,
    from: connection.from,
    to: connection.to,
    strength: payload.strength,
    polarity: payload.polarity,
    role: connection.role,
    ...(reason === undefined ? {} : { reason }),
    ...(payload.groupMode === undefined ? {} : { meta: { groupMode: payload.groupMode } }),
  }
  return canonicalProfileJson(connection) === canonicalProfileJson(expected)
}

function agentDefaultSourceResultConnection(
  connection: Record<string, unknown>,
  sourceCardId: string,
  resultCardId: string,
): boolean {
  return canonicalProfileJson(connection) === canonicalProfileJson({
    id: connection.id,
    from: { cardId: sourceCardId },
    to: { cardId: resultCardId },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  })
}

function agentConnectionAfterMeaningCommand(
  before: Record<string, unknown>,
  payload: Readonly<{
    strength?: unknown
    polarity?: unknown
    reason?: unknown
    groupMode?: unknown
  }>,
): Record<string, unknown> {
  const after: Record<string, unknown> = {
    ...before,
    ...(payload.strength === undefined ? {} : { strength: payload.strength }),
    ...(payload.polarity === undefined ? {} : { polarity: payload.polarity }),
    ...(payload.groupMode === undefined
      ? {}
      : {
          meta: {
            ...(isObjectRecord(before.meta) ? before.meta : {}),
            groupMode: payload.groupMode,
          },
        }),
  }
  if (Object.prototype.hasOwnProperty.call(payload, 'reason')) {
    const reason = typeof payload.reason === 'string' ? payload.reason.trim() : ''
    if (reason) after.reason = reason
    else delete after.reason
  }
  return after
}

function deriveExpectedProfileAgentRecordId(
  request: ProfileAgentCommandRequest,
  profileId: string,
  commandId: string,
  purpose: string,
  deriveId: ProfileAgentCommandIdDeriver,
): string {
  const requestCanonicalJson = canonicalProfileJson({
    version: request.version,
    schemaVersion: request.schemaVersion,
    expectedRevision: request.expectedRevision,
    commands: request.commands,
  })
  return deriveId({
    profileId,
    actorId: PROFILE_AGENT_INSTALLED_ACTOR_ID,
    idempotencyKey: request.idempotencyKey,
    requestCanonicalJson,
    commandId,
    purpose,
  } as Parameters<ProfileAgentCommandIdDeriver>[0])
}

function validAgentBoardTimestampChange(
  change: DurableRecordTransition,
  committedAt: string,
): boolean {
  if (change.changeKind !== 'update'
    || change.before?.kind !== 'board'
    || change.after?.kind !== 'board'
    || !isObjectRecord(change.before.payload)
    || !isObjectRecord(change.after.payload)
    || change.after.payload.updatedAt !== committedAt) return false
  const { updatedAt: _beforeUpdatedAt, ...beforePayload } = change.before.payload
  const { updatedAt: _afterUpdatedAt, ...afterPayload } = change.after.payload
  return canonicalProfileJson({ ...change.before, payload: beforePayload })
    === canonicalProfileJson({ ...change.after, payload: afterPayload })
}

type AgentClaimedTransitionShape = Readonly<{
  recordId: string
  kind: ProfileLogicalRecordSpec['kind']
  operation: DurableRecordTransition['changeKind']
  beforeDigest: string | null
  afterDigest: string | null
  claim:
    | 'record-birth'
    | 'record-last-write'
    | 'record-death'
    | 'card-delete-cascade'
    | 'delete-reindex'
    | 'card-create-group-reconciliation'
  rootId?: string
}>

type AgentTransitionCommitment = Readonly<{
  commandIndex: number
  eventIndex: number
  role: AgentIntentEventRole
  evidence: IntentClaimedTransitionEvidence
  shapes: readonly AgentClaimedTransitionShape[]
  recordIds: readonly string[]
}>

type AgentMappedIntentEvent = Readonly<{
  eventIndex: number
  role: AgentIntentEventRole
}>

export function attachAgentClaimedTransitionEvidence(
  request: ProfileAgentCommandRequest,
  plan: ProfileAgentCommandPlan,
  context: AgentOutcomeAttestationContext,
  recordDigest: AgentCommandAuditDependencies['recordDigest'],
): ProfileAgentCommandPlan | undefined {
  const events = plan.intentEventDrafts.map((draft) => (
    isObjectRecord(draft.event) ? draft.event : undefined
  ))
  if (events.some((event) => event === undefined)) return undefined
  const changes = plan.recordChanges.map((change): DurableRecordTransition => {
    const before = change.operation === 'insert' ? null : change.before
    const after = change.operation === 'delete' ? null : change.after
    return Object.freeze({
      recordId: (after ?? before)!.recordId,
      changeKind: change.operation === 'replace' ? 'update' : change.operation,
      before,
      after,
    })
  })
  const derived = deriveAgentTransitionCommitments(
    request,
    plan.commandResults,
    events as Record<string, unknown>[],
    changes.filter((change) => !isProfileAgentSemanticRecordKind(
      (change.after ?? change.before)?.kind,
    )),
    context,
    recordDigest,
  )
  if (!derived) return undefined
  const profileEvents = plan.profileAgentEventDrafts.map((event) => (
    isObjectRecord(event) ? event : undefined
  ))
  if (profileEvents.some((event) => event === undefined)) return undefined
  const profileDerived = deriveProfileAgentTransitionCommitments(
    request,
    plan.commandResults,
    profileEvents as Record<string, unknown>[],
    changes.filter((change) => isProfileAgentSemanticRecordKind(
      (change.after ?? change.before)?.kind,
    )),
    context,
    recordDigest,
  )
  if (!profileDerived) return undefined
  const evidenceByEventIndex = new Map(
    [...derived.values()].map((commitment) => [commitment.eventIndex, commitment.evidence] as const),
  )
  const drafts = plan.intentEventDrafts.map((draft, index) => {
    const evidence = evidenceByEventIndex.get(index)
    if (evidence === undefined) return draft
    const event = draft.event as Record<string, unknown>
    if (!isObjectRecord(event.data)) return draft
    return Object.freeze({
      ...draft,
      event: Object.freeze({
        ...event,
        data: Object.freeze({ ...event.data, claimedTransitionEvidence: evidence }),
      }) as ProfileAgentCommandPlan['intentEventDrafts'][number]['event'],
    })
  })
  const profileEvidenceByEventIndex = new Map(
    [...profileDerived.values()].map((commitment) => (
      [commitment.eventIndex, commitment.evidence] as const
    )),
  )
  const profileDrafts = plan.profileAgentEventDrafts.map((draft, index) => {
    const evidence = profileEvidenceByEventIndex.get(index)
    if (evidence === undefined) return draft
    return Object.freeze({
      ...draft,
      claimedTransitionEvidence: evidence,
    }) as ProfileAgentCommandPlan['profileAgentEventDrafts'][number]
  })
  return Object.freeze({
    ...plan,
    intentEventDrafts: Object.freeze(drafts),
    profileAgentEventDrafts: Object.freeze(profileDrafts),
  })
}

type AgentTransitionOwner = Readonly<{
  commandIndex: number
  eventIndex: number
  role: AgentIntentEventRole
  claim: AgentClaimedTransitionShape['claim']
  rootId?: string
}>

function deriveAgentTransitionCommitments(
  request: ProfileAgentCommandRequest,
  commandResults: ProfileAgentCommandPlan['commandResults'],
  events: readonly Record<string, unknown>[],
  changes: readonly DurableRecordTransition[],
  context: AgentOutcomeAttestationContext,
  recordDigest: AgentCommandAuditDependencies['recordDigest'],
): ReadonlyMap<number, AgentTransitionCommitment> | undefined {
  const mappedByCommand = mapAgentIntentEventsToCommands(request, commandResults, events)
  if (!mappedByCommand) return undefined
  const owners = new Map<string, AgentTransitionOwner>()
  const assign = (
    change: DurableRecordTransition | undefined,
    owner: AgentTransitionOwner,
  ): boolean => {
    if (!change || owners.has(change.recordId)) return false
    owners.set(change.recordId, owner)
    return true
  }
  const mappedEvent = (
    commandIndex: number,
    role: AgentIntentEventRole,
  ): AgentMappedIntentEvent | undefined => [...(mappedByCommand[commandIndex] ?? [])]
    .reverse()
    .find((event) => event.role === role)
  const createdCardIdsBeforeCommand = new Set<string>()
  const createdBlockIdsBeforeCommand = new Set<string>()
  const createdConnectionIdsBeforeCommand = new Set<string>()
  const createdModInstanceIdsByCard = new Map<string, string>()

  for (const [commandIndex, command] of request.commands.entries()) {
    const result = commandResults[commandIndex]
    if (!result || result.commandId !== command.id || result.name !== command.name) return undefined
    if (command.name === 'idea.create' && result.name === 'idea.create') {
      // Profile-scoped Idea creation binds the separate Profile Agent event stream.
    } else if (command.name === 'card.create' && result.name === 'card.create') {
      createdCardIdsBeforeCommand.add(result.cardId)
      createdBlockIdsBeforeCommand.add(result.blockId)
      continue
    }
    if ((command.name === 'mod-instance.stamp' && result.name === 'mod-instance.stamp')
      || (command.name === 'mod-instance.create' && result.name === 'mod-instance.create')) {
      createdCardIdsBeforeCommand.add(result.cardId)
      createdBlockIdsBeforeCommand.add(result.blockId)
      createdModInstanceIdsByCard.set(result.cardId, result.instanceId)
      continue
    }
    if (command.name === 'connection.create' && result.name === 'connection.create') {
      result.connectionIds.forEach((connectionId) => createdConnectionIdsBeforeCommand.add(connectionId))
      continue
    }
    if ((command.name === 'card.delete' && result.name === 'card.delete')
      || (command.name === 'mod-instance.delete' && result.name === 'mod-instance.delete')) {
      const mapped = mappedEvent(
        commandIndex,
        command.name === 'card.delete' ? 'card-deleted' : 'mod-instance-deleted',
      )
      const event = mapped === undefined ? undefined : events[mapped.eventIndex]
      const claims = event === undefined ? undefined : agentCardDeleteCascadeClaims({
        event,
        cardId: result.cardId,
        boardId: `board:${command.payload.ideaId}`,
        commandIndex,
        request,
        changes,
        createdCardIdsBeforeCommand,
        createdBlockIdsBeforeCommand,
        createdConnectionIdsBeforeCommand,
        createdModInstanceIdsByCard,
      })
      if (!mapped || !claims || claims.some((change) => !assign(change, {
        commandIndex,
        eventIndex: mapped.eventIndex,
        role: mapped.role,
        claim: 'card-delete-cascade',
        rootId: result.cardId,
      }))) return undefined
      continue
    }
    if (command.name === 'connection.delete' && result.name === 'connection.delete') {
      const mapped = mappedEvent(commandIndex, 'connection-deleted')
      const change = changes.find((candidate) => (
        candidate.recordId === result.connectionId && candidate.changeKind === 'delete'
      ))
      if (change !== undefined && (!mapped || !assign(change, {
        commandIndex,
        eventIndex: mapped.eventIndex,
        role: mapped.role,
        claim: 'record-death',
        rootId: result.connectionId,
      }))) return undefined
    }
  }

  for (const [commandIndex, command] of request.commands.entries()) {
    const result = commandResults[commandIndex]!
    if (command.name === 'card.create' && result.name === 'card.create') {
      const mapped = mappedEvent(commandIndex, 'card-created')
      if (!mapped) return undefined
      for (const recordId of [result.cardId, result.blockId]) {
        const change = changes.find((candidate) => (
          candidate.recordId === recordId && candidate.changeKind === 'insert'
        ))
        if (change !== undefined && !assign(change, {
          commandIndex,
          eventIndex: mapped.eventIndex,
          role: mapped.role,
          claim: 'record-birth',
        })) return undefined
      }
      continue
    }
    if (command.name === 'mod-instance.stamp' && result.name === 'mod-instance.stamp') {
      const mapped = mappedEvent(commandIndex, 'mod-instance-stamped')
      if (!mapped) return undefined
      for (const recordId of [result.cardId, result.blockId, result.instanceId]) {
        const change = changes.find((candidate) => (
          candidate.recordId === recordId && candidate.changeKind === 'insert'
        ))
        if (change !== undefined && !assign(change, {
          commandIndex,
          eventIndex: mapped.eventIndex,
          role: mapped.role,
          claim: 'record-birth',
        })) return undefined
      }
      continue
    }
    if (command.name === 'mod-instance.create' && result.name === 'mod-instance.create') {
      const mapped = mappedEvent(commandIndex, 'mod-instance-created')
      if (!mapped) return undefined
      for (const recordId of [result.cardId, result.blockId, result.instanceId]) {
        const change = changes.find((candidate) => (
          candidate.recordId === recordId && candidate.changeKind === 'insert'
        ))
        if (change !== undefined && !assign(change, {
          commandIndex,
          eventIndex: mapped.eventIndex,
          role: mapped.role,
          claim: 'record-birth',
        })) return undefined
      }
      continue
    }
    if (command.name !== 'connection.create' || result.name !== 'connection.create') continue
    if (result.resultCreated) {
      const resultCardEvent = mappedEvent(commandIndex, 'result-card-created')
      const sourceEvent = mappedEvent(commandIndex, 'source-result-connection-created')
      if (!resultCardEvent || !sourceEvent || result.resultCardId === null) return undefined
      const resultEvent = events[resultCardEvent.eventIndex]
      const resultBlockId = isObjectRecord(resultEvent?.data)
        && isObjectRecord(resultEvent.data.card)
        && Array.isArray(resultEvent.data.card.blocks)
        && isObjectRecord(resultEvent.data.card.blocks[0])
        && typeof resultEvent.data.card.blocks[0].id === 'string'
        ? resultEvent.data.card.blocks[0].id
        : undefined
      if (!resultBlockId) return undefined
      for (const recordId of [result.resultCardId, resultBlockId]) {
        const change = changes.find((candidate) => (
          candidate.recordId === recordId && candidate.changeKind === 'insert'
        ))
        if (change !== undefined && !assign(change, {
          commandIndex,
          eventIndex: resultCardEvent.eventIndex,
          role: resultCardEvent.role,
          claim: 'record-birth',
        })) return undefined
      }
      const sourceChange = changes.find((candidate) => (
        candidate.recordId === result.connectionIds[0] && candidate.changeKind === 'insert'
      ))
      if (sourceChange !== undefined && !assign(sourceChange, {
        commandIndex,
        eventIndex: sourceEvent.eventIndex,
        role: sourceEvent.role,
        claim: 'record-birth',
      })) return undefined
    }
    const routedRole: AgentIntentEventRole = result.route === 'direct'
      ? 'connection-created'
      : 'routed-connection-created'
    const routedEvent = mappedEvent(commandIndex, routedRole)
    const routedId = result.connectionIds[result.connectionIds.length - 1]
    const routedChange = routedId === undefined ? undefined : changes.find((candidate) => (
      candidate.recordId === routedId && candidate.changeKind === 'insert'
    ))
    if (!routedEvent || (routedChange !== undefined && !assign(routedChange, {
      commandIndex,
      eventIndex: routedEvent.eventIndex,
      role: routedEvent.role,
      claim: 'record-birth',
    }))) return undefined
  }

  for (const commandIndex of [...request.commands.keys()].reverse()) {
    const command = request.commands[commandIndex]!
    const result = commandResults[commandIndex]
    if (!result || result.commandId !== command.id || result.name !== command.name) return undefined
    let role: AgentIntentEventRole | undefined
    let matchingChanges: readonly DurableRecordTransition[] = []
    if (command.name === 'ask.set-model' && result.name === 'ask.set-model') {
      role = 'ask-model-set'
      matchingChanges = changes.filter((change) => (
        change.recordId === result.cardId && change.changeKind === 'update'
        && change.after?.kind === 'card'
      ))
    } else if (command.name === 'card.set-identity' && result.name === 'card.set-identity') {
      role = 'card-identity-set'
      const solid = command.payload.identity === null
        ? undefined
        : cardIdentityPresetSolid(command.payload.identity.preset)
      if (command.payload.identity !== null && solid === undefined) return undefined
      const cardAlreadyOwned = owners.has(result.cardId)
      const cardChanges = cardAlreadyOwned
        ? []
        : changes.filter((change) => (
            change.recordId === result.cardId
            && change.changeKind === 'update'
            && change.after?.kind === 'card'
          ))
      if (!cardAlreadyOwned
        && (cardChanges.length !== 1
          || context.actor === undefined
          || !agentCardIdentityChange(
            cardChanges[0]!,
            result.cardId,
            command.payload.identity,
            context.actor,
          ))) return undefined
      const modInstanceChanges = command.payload.identity === null
        ? []
        : changes.filter((change) => (
            !owners.has(change.recordId)
            && change.changeKind === 'update'
            && change.after?.kind === 'mod-instance'
            && change.after.parentId === result.cardId
          ))
      if (modInstanceChanges.length > 1
        || (solid !== undefined && modInstanceChanges.some((change) => (
          !agentModInstanceIdentityAccentChange(change, result.cardId, solid)
        )))) return undefined
      matchingChanges = [...cardChanges, ...modInstanceChanges]
    } else if (command.name === 'cards.arrange' && result.name === 'cards.arrange') {
      role = 'cards-arranged'
      const mapped = mappedEvent(commandIndex, role)
      const event = mapped === undefined ? undefined : events[mapped.eventIndex]
      const changedIds = isObjectRecord(event?.data) && Array.isArray(event.data.changes)
        ? new Set(event.data.changes.flatMap((entry) => (
            isObjectRecord(entry) && typeof entry.cardId === 'string' ? [entry.cardId] : []
          )))
        : undefined
      if (!changedIds) return undefined
      matchingChanges = changes.filter((change) => (
        changedIds.has(change.recordId) && change.changeKind === 'update'
        && change.after?.kind === 'card'
      ))
    } else if (command.name === 'cards.reorder-layer'
      && result.name === 'cards.reorder-layer') {
      role = 'card-layer-changed'
      const mapped = mappedEvent(commandIndex, role)
      const event = mapped === undefined ? undefined : events[mapped.eventIndex]
      const changedIds = isObjectRecord(event?.data) && Array.isArray(event.data.changes)
        ? new Set(event.data.changes.flatMap((entry) => (
            isObjectRecord(entry) && typeof entry.cardId === 'string' ? [entry.cardId] : []
          )))
        : undefined
      if (!changedIds) return undefined
      matchingChanges = changes.filter((change) => (
        changedIds.has(change.recordId) && change.changeKind === 'update'
        && change.after?.kind === 'card'
      ))
    } else if (command.name === 'group.membership.set'
      && result.name === 'group.membership.set') {
      const mappedGroupEvents = mappedByCommand[commandIndex]
      if (mappedGroupEvents === undefined) return undefined
      if (mappedGroupEvents.length === 0) continue
      const membershipMapped = mappedEvent(commandIndex, 'group-members-changed')
      const membershipEvent = membershipMapped === undefined
        ? undefined
        : events[membershipMapped.eventIndex]
      const memberIds = isObjectRecord(membershipEvent?.data)
        && isObjectRecord(membershipEvent.data.memberChanges)
        ? new Set(Object.keys(membershipEvent.data.memberChanges))
        : undefined
      if (!membershipMapped || !memberIds) return undefined
      for (const change of changes.filter((candidate) => (
        !owners.has(candidate.recordId)
        && memberIds.has(candidate.recordId)
        && candidate.changeKind === 'update'
        && candidate.after?.kind === 'card'
      ))) {
        if (!assign(change, {
          commandIndex,
          eventIndex: membershipMapped.eventIndex,
          role: membershipMapped.role,
          claim: 'record-last-write',
        })) return undefined
      }
      const movedMapped = mappedEvent(commandIndex, 'group-members-moved')
      const movedEvent = movedMapped === undefined ? undefined : events[movedMapped.eventIndex]
      const movedIds = isObjectRecord(movedEvent?.data) && Array.isArray(movedEvent.data.moves)
        ? new Set(movedEvent.data.moves.flatMap((entry) => (
            isObjectRecord(entry) && typeof entry.cardId === 'string' ? [entry.cardId] : []
          )))
        : new Set<string>()
      for (const change of changes.filter((candidate) => (
        !owners.has(candidate.recordId)
        && movedIds.has(candidate.recordId)
        && candidate.changeKind === 'update'
        && candidate.after?.kind === 'card'
      ))) {
        if (!movedMapped || !assign(change, {
          commandIndex,
          eventIndex: movedMapped.eventIndex,
          role: movedMapped.role,
          claim: 'record-last-write',
        })) return undefined
      }
      for (const resizedMapped of (mappedByCommand[commandIndex] ?? []).filter(({ role }) => (
        role === 'group-container-resized'
      ))) {
        const resizedEvent = events[resizedMapped.eventIndex]
        const resizedCardId = typeof resizedEvent?.cardId === 'string'
          ? resizedEvent.cardId
          : undefined
        if (!resizedCardId) return undefined
        const change = changes.find((candidate) => (
          !owners.has(candidate.recordId)
          && candidate.recordId === resizedCardId
          && candidate.changeKind === 'update'
          && candidate.after?.kind === 'card'
        ))
        if (change !== undefined && !assign(change, {
          commandIndex,
          eventIndex: resizedMapped.eventIndex,
          role: resizedMapped.role,
          claim: 'record-last-write',
        })) return undefined
      }
      continue
    } else if (command.name === 'output.choose-version'
      && result.name === 'output.choose-version') {
      role = 'output-version-chosen'
      matchingChanges = changes.filter((change) => (
        change.recordId === result.outputId && change.changeKind === 'update'
        && change.after?.kind === 'output'
      ))
    } else if (command.name === 'output.set-accepted'
      && result.name === 'output.set-accepted') {
      role = 'output-version-acceptance-changed'
      matchingChanges = changes.filter((change) => (
        change.recordId === result.versionId && change.changeKind === 'update'
        && change.after?.kind === 'output-version'
      ))
    } else if (command.name === 'mod-instance.configure'
      && result.name === 'mod-instance.configure') {
      role = 'mod-instance-configured'
      matchingChanges = changes.filter((change) => (
        (change.recordId === result.cardId || change.recordId === result.instanceId)
        && change.changeKind === 'update'
        && (change.after?.kind === 'card' || change.after?.kind === 'mod-instance')
      ))
    } else {
      continue
    }
    const mapped = role === undefined ? undefined : mappedEvent(commandIndex, role)
    if (!mapped) return undefined
    for (const change of matchingChanges) {
      if (owners.has(change.recordId)) continue
      if (!assign(change, {
        commandIndex,
        eventIndex: mapped.eventIndex,
        role: mapped.role,
        claim: 'record-last-write',
      })) return undefined
    }
  }

  const groupClaims = agentCardGroupReconciliationClaims(events, changes)
  if (groupClaims === undefined) return undefined
  const unownedGroupClaims = groupClaims.filter((change) => !owners.has(change.recordId))
  const groupOwnerIndex = request.commands.findIndex((command) => (
    command.name === 'card.create'
    || command.name === 'mod-instance.stamp'
    || command.name === 'mod-instance.create'
  ))
  if (unownedGroupClaims.length > 0 && groupOwnerIndex < 0) return undefined
  const groupClaimIds = new Set(unownedGroupClaims.map((change) => change.recordId))
  for (const change of changes) {
    if (owners.has(change.recordId) || change.changeKind !== 'update') continue
    const candidates: AgentTransitionOwner[] = []
    const lastWriterIndex = [...request.commands.keys()].reverse().find((commandIndex) => {
      const command = request.commands[commandIndex]!
      return (change.after?.kind === 'block'
        && command.name === 'card.update-content'
        && command.payload.cardId === change.after.parentId
        && agentCardUpdateBodyText(command.payload) !== undefined)
        || (change.after?.kind === 'card'
          && command.name === 'card.update-content'
          && command.payload.cardId === change.recordId)
        || (change.after?.kind === 'connection'
          && command.name === 'connection.update-meaning'
          && command.payload.connectionId === change.recordId)
    })
    if (lastWriterIndex !== undefined) {
      const role: AgentIntentEventRole = change.after?.kind === 'block'
        || change.after?.kind === 'card'
        ? 'card-content-edited'
        : 'connection-changed'
      const mapped = mappedEvent(lastWriterIndex, role)
      if (!mapped) return undefined
      candidates.push(Object.freeze({
        commandIndex: lastWriterIndex,
        eventIndex: mapped.eventIndex,
        role: mapped.role,
        claim: 'record-last-write',
      }))
    }
    if (groupClaimIds.has(change.recordId)) {
      const ownerCommand = request.commands[groupOwnerIndex]
      const mapped = groupOwnerIndex < 0
        ? undefined
        : mappedEvent(
            groupOwnerIndex,
            ownerCommand?.name === 'mod-instance.stamp'
              ? 'mod-instance-stamped'
              : ownerCommand?.name === 'mod-instance.create'
                ? 'mod-instance-created'
              : 'card-created',
          )
      const result = commandResults[groupOwnerIndex]
      if (!mapped || (result?.name !== 'card.create'
        && result?.name !== 'mod-instance.stamp'
        && result?.name !== 'mod-instance.create')) {
        return undefined
      }
      candidates.push(Object.freeze({
        commandIndex: groupOwnerIndex,
        eventIndex: mapped.eventIndex,
        role: mapped.role,
        claim: 'card-create-group-reconciliation',
        rootId: result.cardId,
      }))
    }
    const claimedIds = new Set(owners.keys())
    if (agentOrdinalShiftMatchesClaimedDeletes(change, changes, claimedIds)) {
      const causal = changes.filter((candidate) => (
        candidate.changeKind === 'delete'
        && candidate.before !== null
        && owners.has(candidate.recordId)
        && change.before !== null
        && agentRecordCollectionKey(candidate.before) === agentRecordCollectionKey(change.before)
        && candidate.before.ordinal < change.before.ordinal
      )).sort((left, right) => (
        owners.get(right.recordId)!.eventIndex - owners.get(left.recordId)!.eventIndex
      ))[0]
      const owner = causal === undefined ? undefined : owners.get(causal.recordId)
      if (!owner) return undefined
      candidates.push(Object.freeze({
        ...owner,
        claim: 'delete-reindex',
        rootId: owner.rootId ?? causal!.recordId,
      }))
    }
    const winner = candidates.sort((left, right) => (
      right.eventIndex - left.eventIndex
      || (left.claim < right.claim ? -1 : left.claim > right.claim ? 1 : 0)
    ))[0]
    if (!winner || !assign(change, winner)) return undefined
  }
  if (changes.some((change) => !owners.has(change.recordId))) return undefined

  const commitments = new Map<number, AgentTransitionCommitment>()
  for (const [commandIndex, mappedEvents] of mappedByCommand.entries()) {
    const command = request.commands[commandIndex]
    const result = commandResults[commandIndex]
    if (!command || !result) return undefined
    for (const mapped of mappedEvents) {
      const semanticIntent = agentSemanticIntentPayload(events[mapped.eventIndex])
      if (semanticIntent === undefined) return undefined
      const ownedChanges = changes.filter((change) => (
        owners.get(change.recordId)?.eventIndex === mapped.eventIndex
      ))
      const shapes = ownedChanges.map((change) => {
        const owner = owners.get(change.recordId)!
        return agentClaimedTransitionShape(
          change,
          owner.claim,
          owner.rootId,
          recordDigest,
        )
      })
      commitments.set(mapped.eventIndex, agentTransitionCommitment({
        request,
        context,
        commandIndex,
        command,
        result,
        eventIndex: mapped.eventIndex,
        role: mapped.role,
        semanticIntent,
        shapes,
      }))
    }
  }
  return commitments.size === events.length ? commitments : undefined
}

function deriveProfileAgentTransitionCommitments(
  request: ProfileAgentCommandRequest,
  commandResults: ProfileAgentCommandPlan['commandResults'],
  events: readonly Record<string, unknown>[],
  changes: readonly DurableRecordTransition[],
  context: AgentOutcomeAttestationContext,
  recordDigest: AgentCommandAuditDependencies['recordDigest'],
): ReadonlyMap<number, AgentTransitionCommitment> | undefined {
  if (context.installedSurfaceVersion < 2 && events.length !== 0) return undefined
  const mappedByCommand = new Map<number, AgentMappedIntentEvent>()
  let eventIndex = 0
  for (const [commandIndex, command] of request.commands.entries()) {
    const result = commandResults[commandIndex]
    if (!result || result.commandId !== command.id || result.name !== command.name) return undefined
    let expected: Record<string, unknown> | undefined
    let role: AgentIntentEventRole | undefined
    if (command.name === 'idea.create' && result.name === 'idea.create') {
      role = 'idea-created'
      expected = {
        version: 1,
        type: 'idea.created',
        ideaId: result.ideaId,
        boardId: result.boardId,
        ideaName: result.ideaName,
      }
    } else if (command.name === 'idea.activate' && result.name === 'idea.activate') {
      role = 'idea-activated'
      expected = {
        version: 1,
        type: 'idea.activated',
        previousActiveIdeaId: result.previousActiveIdeaId,
        activeIdeaId: result.activeIdeaId,
      }
    } else if (command.name === 'mod-template.create' && result.name === 'mod-template.create') {
      role = 'mod-template-created'
      expected = {
        version: 1,
        type: 'mod-template.created',
        templateId: result.templateId,
        templateVersion: result.templateVersion,
      }
    } else if (command.name === 'mod-template.update' && result.name === 'mod-template.update') {
      role = 'mod-template-updated'
      expected = {
        version: 1,
        type: 'mod-template.updated',
        templateId: result.templateId,
        previousTemplateVersion: result.previousTemplateVersion,
        newTemplateVersion: result.newTemplateVersion,
      }
    } else if (command.name === 'mod-template.delete' && result.name === 'mod-template.delete') {
      role = 'mod-template-deleted'
      expected = {
        version: 1,
        type: 'mod-template.deleted',
        templateId: result.templateId,
        deletedTemplateVersion: result.deletedTemplateVersion,
      }
    }
    if (!expected || !role) continue
    const observed = agentSemanticProfileEventPayload(events[eventIndex])
    if (!observed || canonicalProfileJson(observed) !== canonicalProfileJson(expected)) {
      return undefined
    }
    mappedByCommand.set(commandIndex, Object.freeze({ eventIndex, role }))
    eventIndex += 1
  }
  if (eventIndex !== events.length) return undefined

  const ownerByRecordId = new Map<string, Readonly<{
    commandIndex: number
    mapped: AgentMappedIntentEvent
    claim: AgentClaimedTransitionShape['claim']
  }>>()
  for (const change of changes) {
    const record = change.after ?? change.before
    if (!isProfileAgentSemanticRecordKind(record?.kind)) return undefined
    const matchingIndexes = request.commands.flatMap((command, commandIndex) => {
      const result = commandResults[commandIndex]
      if (record?.kind === 'idea' || record?.kind === 'board') {
        if (command.name === 'idea.create'
          && result?.name === 'idea.create'
          && (change.recordId === result.ideaId || change.recordId === result.boardId)) {
          return [commandIndex]
        }
        return record.kind === 'idea'
          && command.name === 'idea.activate'
          && result?.name === 'idea.activate'
          && change.recordId === result.activeIdeaId
          ? [commandIndex]
          : []
      }
      return (command.name === 'mod-template.create'
        || command.name === 'mod-template.update'
        || command.name === 'mod-template.delete')
        && command.payload.templateId === change.recordId
        ? [commandIndex]
        : []
    })
    const commandIndex = record.kind === 'idea' || record.kind === 'board'
      ? change.changeKind === 'insert'
        ? matchingIndexes.find((index) => request.commands[index]?.name === 'idea.create')
        : record.kind === 'idea' && change.changeKind === 'update'
          ? matchingIndexes.find((index) => request.commands[index]?.name === 'idea.activate')
          : undefined
      : change.changeKind === 'insert'
        ? matchingIndexes.find((index) => request.commands[index]?.name === 'mod-template.create')
        : change.changeKind === 'update'
          ? [...matchingIndexes].reverse().find((index) => (
              request.commands[index]?.name === 'mod-template.update'
              || request.commands[index]?.name === 'mod-template.create'
            ))
          : [...matchingIndexes].reverse().find((index) => (
              request.commands[index]?.name === 'mod-template.delete'
            ))
    const mapped = commandIndex === undefined ? undefined : mappedByCommand.get(commandIndex)
    if (commandIndex === undefined || !mapped || ownerByRecordId.has(change.recordId)) return undefined
    ownerByRecordId.set(change.recordId, Object.freeze({
      commandIndex,
      mapped,
      claim: change.changeKind === 'insert'
        ? 'record-birth'
        : change.changeKind === 'update'
          ? 'record-last-write'
          : 'record-death',
    }))
  }

  const commitments = new Map<number, AgentTransitionCommitment>()
  for (const [commandIndex, mapped] of mappedByCommand) {
    const command = request.commands[commandIndex]
    const result = commandResults[commandIndex]
    const semanticIntent = agentSemanticProfileEventPayload(events[mapped.eventIndex])
    if (!command || !result || !semanticIntent) return undefined
    const shapes = changes.flatMap((change) => {
      const owner = ownerByRecordId.get(change.recordId)
      return owner?.mapped.eventIndex === mapped.eventIndex
        ? [agentClaimedTransitionShape(change, owner.claim, undefined, recordDigest)]
        : []
    })
    commitments.set(mapped.eventIndex, agentTransitionCommitment({
      request,
      context,
      commandIndex,
      command,
      result,
      eventIndex: mapped.eventIndex,
      role: mapped.role,
      semanticIntent,
      shapes,
    }))
  }
  return commitments.size === events.length ? commitments : undefined
}

function isProfileAgentSemanticRecordKind(
  kind: ProfileLogicalRecordSpec['kind'] | undefined,
): kind is 'idea' | 'board' | 'mod-template' {
  return kind === 'idea' || kind === 'board' || kind === 'mod-template'
}

function agentClaimedTransitionShape(
  change: DurableRecordTransition,
  claim: AgentClaimedTransitionShape['claim'],
  rootId: string | undefined,
  recordDigest: AgentCommandAuditDependencies['recordDigest'],
): AgentClaimedTransitionShape {
  const record = change.after ?? change.before!
  return Object.freeze({
    recordId: change.recordId,
    kind: record.kind,
    operation: change.changeKind,
    beforeDigest: change.before === null ? null : recordDigest(change.before),
    afterDigest: change.after === null ? null : recordDigest(change.after),
    claim,
    ...(rootId === undefined ? {} : { rootId }),
  })
}

function agentTransitionCommitment(
  input: Readonly<{
    request: ProfileAgentCommandRequest
    context: AgentOutcomeAttestationContext
    commandIndex: number
    command: ProfileAgentCommandRequest['commands'][number]
    result: ProfileAgentCommandPlan['commandResults'][number]
    eventIndex: number
    role: AgentIntentEventRole
    semanticIntent: Record<string, unknown>
    shapes: readonly AgentClaimedTransitionShape[]
  }>,
): AgentTransitionCommitment {
  const shapes = [...input.shapes].sort((left, right) => {
    const leftCanonical = canonicalProfileJson(left)
    const rightCanonical = canonicalProfileJson(right)
    return leftCanonical < rightCanonical ? -1 : leftCanonical > rightCanonical ? 1 : 0
  })
  const canonical = canonicalProfileJson({
    eventVersion: 1,
    installedSurfaceVersion: input.context.installedSurfaceVersion,
    request: input.request,
    trustedContext: {
      profileId: input.context.profileId,
      actorId: input.context.actorId,
      transport: input.context.transport,
      clientTxnId: input.context.clientTxnId,
      commitId: input.context.commitId,
      committedAt: input.context.committedAt,
    },
    commandIndex: input.commandIndex,
    command: input.command,
    result: input.result,
    eventRole: input.role,
    intent: input.semanticIntent,
    shapes,
  })
  return Object.freeze({
    commandIndex: input.commandIndex,
    eventIndex: input.eventIndex,
    role: input.role,
    evidence: Object.freeze({
      version: 1,
      count: shapes.length,
      sha256: profileAgentRequestDigest(`eido.agent-command-outcome.v1\0${canonical}`),
    }),
    shapes: Object.freeze(shapes),
    recordIds: Object.freeze(shapes.map((shape) => shape.recordId)),
  })
}

function agentGroupMembershipReachedBefore(
  events: readonly Record<string, unknown>[],
  endExclusive: number,
  cardId: string,
  groupId: string | null,
): boolean {
  let found = false
  let latestGroupId: string | null = null
  for (const event of events.slice(0, endExclusive)) {
    if (event.type !== 'group.members.changed'
      || !isObjectRecord(event.data)
      || !isObjectRecord(event.data.memberChanges)) continue
    const change = event.data.memberChanges[cardId]
    if (!isObjectRecord(change)
      || (change.to !== undefined && typeof change.to !== 'string')) continue
    found = true
    latestGroupId = typeof change.to === 'string' ? change.to : null
  }
  return found && latestGroupId === groupId
}

function mapAgentIntentEventsToCommands(
  request: ProfileAgentCommandRequest,
  commandResults: ProfileAgentCommandPlan['commandResults'],
  events: readonly Record<string, unknown>[],
): readonly (readonly AgentMappedIntentEvent[])[] | undefined {
  if (request.commands.length !== commandResults.length) return undefined
  let cursor = 0
  const mapped: AgentMappedIntentEvent[][] = []
  const take = (
    role: AgentIntentEventRole,
    predicate: (event: Record<string, unknown>) => boolean,
  ): AgentMappedIntentEvent | undefined => {
    const event = events[cursor]
    if (!event || !predicate(event)) return undefined
    return Object.freeze({ eventIndex: cursor++, role })
  }
  for (const [index, command] of request.commands.entries()) {
    const result = commandResults[index]
    if (!result || result.commandId !== command.id || result.name !== command.name) return undefined
    const indexes: AgentMappedIntentEvent[] = []
    if ((command.name === 'idea.create' && result.name === 'idea.create')
      || (command.name === 'idea.activate' && result.name === 'idea.activate')) {
      // Profile-scoped Idea commands bind the separate Profile Agent event stream.
    } else if (command.name === 'ask.set-model' && result.name === 'ask.set-model') {
      const mappedEvent = take('ask-model-set', (event) => (
        event.type === 'card.content.edited'
        && event.cardId === result.cardId
        && isObjectRecord(event.data)
        && event.data.field === 'model'
      ))
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'card.set-identity' && result.name === 'card.set-identity') {
      const mappedEvent = take('card-identity-set', (event) => (
        event.type === 'card.content.edited'
        && event.cardId === result.cardId
        && isObjectRecord(event.data)
        && event.data.field === 'identity'
      ))
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'cards.arrange' && result.name === 'cards.arrange') {
      const mappedEvent = take('cards-arranged', (event) => (
        event.type === 'cards.arranged'
        && isObjectRecord(event.data)
        && Array.isArray(event.data.changes)
        && event.data.changes.every((change) => (
          isObjectRecord(change)
          && typeof change.cardId === 'string'
          && result.cardIds.includes(change.cardId)
        ))
      ))
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'cards.reorder-layer'
      && result.name === 'cards.reorder-layer') {
      const mappedEvent = take('card-layer-changed', (event) => (
        event.type === 'card.layer.changed'
        && isObjectRecord(event.data)
        && event.data.direction === result.direction
        && Array.isArray(event.data.changes)
      ))
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'group.membership.set'
      && result.name === 'group.membership.set') {
      if (!agentGroupMembershipReachedBefore(
        events,
        cursor,
        result.cardId,
        result.groupId,
      )) {
        const moved = take('group-members-moved', (event) => (
          event.type === 'card.moved'
          && isObjectRecord(event.data)
          && Array.isArray(event.data.moves)
        ))
        if (moved !== undefined) indexes.push(moved)
        while (events[cursor]?.type === 'card.resized') {
          const resized = take('group-container-resized', (event) => (
            event.type === 'card.resized'
            && typeof event.cardId === 'string'
            && isObjectRecord(event.data)
          ))
          if (resized === undefined) return undefined
          indexes.push(resized)
        }
        const changed = take('group-members-changed', (event) => (
          event.type === 'group.members.changed'
          && isObjectRecord(event.data)
          && isObjectRecord(event.data.memberChanges)
          && Object.prototype.hasOwnProperty.call(event.data.memberChanges, result.cardId)
        ))
        if (changed === undefined) return undefined
        indexes.push(changed)
      }
    } else if (command.name === 'output.choose-version'
      && result.name === 'output.choose-version') {
      const mappedEvent = take('output-version-chosen', (event) => (
        event.type === 'version.chosen'
        && event.versionId === result.versionId
        && isObjectRecord(event.data)
        && event.data.outputId === result.outputId
      ))
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'output.set-accepted'
      && result.name === 'output.set-accepted') {
      const mappedEvent = take('output-version-acceptance-changed', (event) => (
        event.type === 'version.acceptance.changed'
        && event.versionId === result.versionId
        && isObjectRecord(event.data)
        && event.data.outputId === result.outputId
        && event.data.to === result.accepted
      ))
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'card.create' && result.name === 'card.create') {
      const mappedEvent = take(
        'card-created',
        (event) => event.type === 'card.created' && event.cardId === result.cardId,
      )
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'card.update-content' && result.name === 'card.update-content') {
      const expectedEdits = agentExpectedCardContentEdits(command.payload)
      if (expectedEdits.length === 0) return undefined
      for (const expected of expectedEdits) {
        const mappedEvent = take('card-content-edited', (event) => (
          event.type === 'card.content.edited'
          && event.cardId === result.cardId
          && isObjectRecord(event.data)
          && event.data.field === expected.field
        ))
        if (mappedEvent === undefined) return undefined
        indexes.push(mappedEvent)
      }
    } else if (command.name === 'card.delete' && result.name === 'card.delete') {
      const mappedEvent = take(
        'card-deleted',
        (event) => event.type === 'card.deleted' && event.cardId === result.cardId,
      )
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'connection.create' && result.name === 'connection.create') {
      if (result.resultCreated) {
        const cardEvent = take('result-card-created', (event) => (
          event.type === 'card.created' && event.cardId === result.resultCardId
        ))
        const sourceConnectionId = result.connectionIds[0]
        const sourceEvent = take('source-result-connection-created', (event) => (
          event.type === 'connection.created' && event.connectionId === sourceConnectionId
        ))
        if (cardEvent === undefined || sourceEvent === undefined) return undefined
        indexes.push(cardEvent, sourceEvent)
      }
      const routedConnectionId = result.connectionIds[result.connectionIds.length - 1]
      const routedEvent = take(
        result.route === 'direct' ? 'connection-created' : 'routed-connection-created',
        (event) => (
        event.type === 'connection.created' && event.connectionId === routedConnectionId
        ),
      )
      if (routedEvent === undefined) return undefined
      indexes.push(routedEvent)
    } else if (command.name === 'connection.update-meaning'
      && result.name === 'connection.update-meaning') {
      const mappedEvent = take('connection-changed', (event) => (
        event.type === 'connection.changed' && event.connectionId === result.connectionId
      ))
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'connection.delete' && result.name === 'connection.delete') {
      const mappedEvent = take('connection-deleted', (event) => (
        event.type === 'connection.deleted' && event.connectionId === result.connectionId
      ))
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if ((command.name === 'mod-template.create' && result.name === 'mod-template.create')
      || (command.name === 'mod-template.update' && result.name === 'mod-template.update')
      || (command.name === 'mod-template.delete' && result.name === 'mod-template.delete')) {
      // Profile-scoped template commands bind their separate Profile Agent event stream.
    } else if (command.name === 'mod-instance.stamp' && result.name === 'mod-instance.stamp') {
      const mappedEvent = take(
        'mod-instance-stamped',
        (event) => event.type === 'card.created' && event.cardId === result.cardId,
      )
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'mod-instance.create' && result.name === 'mod-instance.create') {
      const mappedEvent = take(
        'mod-instance-created',
        (event) => event.type === 'card.created' && event.cardId === result.cardId,
      )
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'mod-instance.configure'
      && result.name === 'mod-instance.configure') {
      const mappedEvent = take('mod-instance-configured', (event) => (
        event.type === 'card.content.edited'
        && event.cardId === result.cardId
        && isObjectRecord(event.data)
        && event.data.field === 'modControl'
      ))
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else if (command.name === 'mod-instance.delete'
      && result.name === 'mod-instance.delete') {
      const mappedEvent = take(
        'mod-instance-deleted',
        (event) => event.type === 'card.deleted' && event.cardId === result.cardId,
      )
      if (mappedEvent === undefined) return undefined
      indexes.push(mappedEvent)
    } else return undefined
    mapped.push(indexes)
  }
  return cursor === events.length ? Object.freeze(mapped.map((indexes) => Object.freeze(indexes))) : undefined
}

function agentCardDeleteCascadeClaims(input: Readonly<{
  event: Record<string, unknown>
  cardId: string
  boardId: string
  commandIndex: number
  request: ProfileAgentCommandRequest
  changes: readonly DurableRecordTransition[]
  createdCardIdsBeforeCommand: ReadonlySet<string>
  createdBlockIdsBeforeCommand: ReadonlySet<string>
  createdConnectionIdsBeforeCommand: ReadonlySet<string>
  createdModInstanceIdsByCard: ReadonlyMap<string, string>
}>): DurableRecordTransition[] | undefined {
  if (input.event.type !== 'card.deleted'
    || input.event.cardId !== input.cardId
    || !isObjectRecord(input.event.data)
    || !isObjectRecord(input.event.data.card)) return undefined
  const data = input.event.data
  const eventCard = data.card as Record<string, unknown>
  const cardEnvelope = logicalCardEnvelopeFromAgentIntent(eventCard)
  if (!cardEnvelope) return undefined
  const claims: DurableRecordTransition[] = []
  const claimDelete = (
    recordId: string,
    kind: ProfileLogicalRecordSpec['kind'],
    allowMissing: boolean,
  ): DurableRecordTransition | undefined | null => {
    const matches = input.changes.filter((change) => (
      change.recordId === recordId
      && change.changeKind === 'delete'
      && change.before?.kind === kind
    ))
    if (matches.length === 0) return allowMissing ? null : undefined
    if (matches.length !== 1) return undefined
    claims.push(matches[0]!)
    return matches[0]
  }

  const cardChange = claimDelete(
    input.cardId,
    'card',
    input.createdCardIdsBeforeCommand.has(input.cardId),
  )
  if (cardChange === undefined
    || (cardChange !== null && cardChange.before !== null
      && canonicalProfileJson(cardChange.before.payload)
        !== canonicalProfileJson(cardEnvelope)
      && (!input.request.commands.slice(0, input.commandIndex).some((command) => (
        command.name === 'card.create'
      )) || !agentCardPayloadMatchesIntent(cardChange.before.payload, cardEnvelope)))) return undefined

  const memberIds = data.memberIds
  if (eventCard.kind === 'group') {
    if (!Array.isArray(memberIds)
      || memberIds.some((memberId) => typeof memberId !== 'string')
      || new Set(memberIds).size !== memberIds.length) return undefined
    const memberClaims = input.changes.filter((change) => (
      change.changeKind === 'update'
      && change.before?.kind === 'card'
      && change.after?.kind === 'card'
      && isObjectRecord(change.before.payload)
      && isObjectRecord(change.after.payload)
      && change.before.payload.groupId === input.cardId
      && change.after.payload.groupId === undefined
      && agentCardGroupReconciliationChange(change)
    ))
    if (canonicalProfileJson(memberClaims.map((change) => change.recordId).sort())
      !== canonicalProfileJson((memberIds as string[]).slice().sort())) return undefined
    claims.push(...memberClaims)
  } else if (memberIds !== undefined) {
    return undefined
  }

  const eventBlocks = Array.isArray(eventCard.blocks) ? eventCard.blocks : undefined
  if (!eventBlocks) return undefined
  const eventBlockIds = new Set<string>()
  for (const candidate of eventBlocks) {
    if (!isObjectRecord(candidate)
      || typeof candidate.id !== 'string'
      || eventBlockIds.has(candidate.id)) return undefined
    eventBlockIds.add(candidate.id)
    const change = claimDelete(
      candidate.id,
      'block',
      input.createdBlockIdsBeforeCommand.has(candidate.id),
    )
    if (change === undefined) return undefined
    if (change !== null) {
      const precedingUpdate = [...input.request.commands.slice(0, input.commandIndex)].reverse()
        .find((command) => command.name === 'card.update-content'
          && command.payload.cardId === input.cardId
          && agentCardUpdateTargetsBlock(command.payload, candidate.id as string))
      const precedingText = precedingUpdate?.name === 'card.update-content'
        ? agentCardUpdateBodyText(precedingUpdate.payload)
        : undefined
      if (change.before?.parentId !== input.cardId
        || (canonicalProfileJson(change.before.payload) !== canonicalProfileJson(candidate)
          && (precedingText === undefined
            || candidate.text !== precedingText
            || !agentBlockPayloadDiffersOnlyByText(change.before.payload, candidate)))) return undefined
    }
  }
  if (input.changes.some((change) => (
    change.changeKind === 'delete'
    && change.before?.kind === 'block'
    && change.before.parentId === input.cardId
    && !eventBlockIds.has(change.recordId)
  ))) return undefined

  const eventAssets = eventCard.assets === undefined
    ? []
    : Array.isArray(eventCard.assets) ? eventCard.assets : undefined
  if (!eventAssets) return undefined
  const eventAssetIds = new Set<string>()
  for (const candidate of eventAssets) {
    if (!isObjectRecord(candidate)
      || typeof candidate.id !== 'string'
      || eventAssetIds.has(candidate.id)) return undefined
    eventAssetIds.add(candidate.id)
    const change = claimDelete(candidate.id, 'logical-asset', false)
    if (!change || change.before?.ownerId !== input.boardId
      || change.before.parentId !== input.cardId
      || canonicalProfileJson(change.before.payload) !== canonicalProfileJson(candidate)) return undefined
  }
  if (input.changes.some((change) => (
    change.changeKind === 'delete'
    && change.before?.kind === 'logical-asset'
    && change.before.parentId === input.cardId
    && !eventAssetIds.has(change.recordId)
  ))) return undefined

  const eventConnections = Array.isArray(data.connections) ? data.connections : undefined
  if (!eventConnections) return undefined
  const eventConnectionIds = new Set<string>()
  for (const candidate of eventConnections) {
    if (!isObjectRecord(candidate)
      || typeof candidate.id !== 'string'
      || eventConnectionIds.has(candidate.id)
      || !agentConnectionTouchesCard(candidate, input.cardId)) return undefined
    eventConnectionIds.add(candidate.id)
    const change = claimDelete(
      candidate.id,
      'connection',
      input.createdConnectionIdsBeforeCommand.has(candidate.id),
    )
    if (change === undefined) return undefined
  }

  const outputClaims = agentDeletedOutputClosureClaims(
    Array.isArray(data.outputs) ? data.outputs : [],
    input.cardId,
    input.boardId,
    input.changes,
  )
  if (!outputClaims) return undefined
  claims.push(...outputClaims)

  const highlightClaims = input.changes.filter((change) => (
    change.changeKind === 'delete'
    && change.before?.kind === 'highlight'
    && isObjectRecord(change.before.payload)
    && change.before.payload.cardId === input.cardId
  ))
  if (highlightClaims.some((change) => change.before?.ownerId !== input.boardId)) return undefined
  claims.push(...highlightClaims)

  const modClaims = input.changes.filter((change) => (
    change.changeKind === 'delete'
    && change.before?.kind === 'mod-instance'
    && change.before.parentId === input.cardId
  ))
  const netZeroCreatedInstanceId = input.createdModInstanceIdsByCard.get(input.cardId)
  if (modClaims.length > 1
    || (eventCard.modV2 === undefined && modClaims.length !== 0)
    || (eventCard.modV2 !== undefined
      && modClaims.length === 0 && netZeroCreatedInstanceId === undefined)
    || (eventCard.modV2 !== undefined && modClaims.length === 1
      && (modClaims[0]?.before?.ownerId !== input.boardId
        || !isObjectRecord(modClaims[0]?.before?.payload)
        || canonicalProfileJson(modClaims[0]!.before!.payload.mod)
          !== canonicalProfileJson(eventCard.modV2)))) return undefined
  claims.push(...modClaims)

  return claims.length === new Set(claims.map((change) => change.recordId)).size
    ? claims
    : undefined
}

type AgentExpectedDeletedRecord = Readonly<{
  kind: ProfileLogicalRecordSpec['kind']
  parentId: string
  ordinal?: number
  payload: unknown
}>

function agentDeletedOutputClosureClaims(
  outputs: readonly unknown[],
  cardId: string,
  boardId: string,
  changes: readonly DurableRecordTransition[],
): DurableRecordTransition[] | undefined {
  const expected = new Map<string, AgentExpectedDeletedRecord>()
  const append = (recordId: unknown, record: AgentExpectedDeletedRecord): boolean => {
    if (typeof recordId !== 'string' || recordId.length === 0 || expected.has(recordId)) return false
    expected.set(recordId, record)
    return true
  }
  for (const candidate of outputs) {
    if (!isObjectRecord(candidate)
      || candidate.resultCardId !== cardId
      || !Array.isArray(candidate.versions)) return undefined
    const { versions, ...outputPayload } = candidate
    if (!append(candidate.id, { kind: 'output', parentId: boardId, payload: outputPayload })) {
      return undefined
    }
    for (const [versionOrdinal, versionCandidate] of versions.entries()) {
      if (!isObjectRecord(versionCandidate)) return undefined
      const transcript = versionCandidate.transcript
      const followUpThread = versionCandidate.followUpThread
      if (transcript !== undefined && !Array.isArray(transcript)) return undefined
      if (followUpThread !== undefined && (!isObjectRecord(followUpThread)
        || !Array.isArray(followUpThread.messages))) return undefined
      const {
        transcript: _transcript,
        followUpThread: _followUpThread,
        ...versionPayload
      } = versionCandidate
      if (!append(versionCandidate.id, {
        kind: 'output-version',
        parentId: candidate.id as string,
        ordinal: versionOrdinal,
        payload: {
          ...versionPayload,
          transcript: { present: transcript !== undefined },
          followUpThread: {
            present: followUpThread !== undefined,
            ...(isObjectRecord(followUpThread) && followUpThread.collapsed !== undefined
              ? { collapsed: followUpThread.collapsed }
              : {}),
          },
        },
      })) return undefined
      for (const [ordinal, message] of (transcript ?? []).entries()) {
        if (!isObjectRecord(message) || !append(message.id, {
          kind: 'transcript-message',
          parentId: versionCandidate.id as string,
          ordinal,
          payload: message,
        })) return undefined
      }
      const followUpMessages = isObjectRecord(followUpThread) ? followUpThread.messages : []
      for (const [ordinal, message] of (followUpMessages as unknown[]).entries()) {
        if (!isObjectRecord(message) || !append(message.id, {
          kind: 'follow-up-message',
          parentId: versionCandidate.id as string,
          ordinal,
          payload: message,
        })) return undefined
      }
    }
  }
  const claims: DurableRecordTransition[] = []
  for (const [recordId, record] of expected) {
    const matches = changes.filter((change) => (
      change.recordId === recordId
      && change.changeKind === 'delete'
      && change.before?.kind === record.kind
    ))
    const change = matches[0]
    if (matches.length !== 1
      || !change?.before
      || change.before.ownerId !== boardId
      || change.before.parentId !== record.parentId
      || (record.ordinal !== undefined && change.before.ordinal !== record.ordinal)
      || canonicalProfileJson(change.before.payload) !== canonicalProfileJson(record.payload)) {
      return undefined
    }
    claims.push(change)
  }
  const outputIds = new Set(outputs.flatMap((output) => (
    isObjectRecord(output) && typeof output.id === 'string' ? [output.id] : []
  )))
  if (changes.some((change) => (
    change.changeKind === 'delete'
    && change.before?.kind === 'output'
    && isObjectRecord(change.before.payload)
    && change.before.payload.resultCardId === cardId
    && !outputIds.has(change.recordId)
  ))) return undefined
  return claims
}

function agentCardGroupReconciliationClaims(
  events: readonly Record<string, unknown>[],
  changes: readonly DurableRecordTransition[],
): DurableRecordTransition[] | undefined {
  const createdCardEnvelopeById = new Map<string, Record<string, unknown>>()
  for (const event of events) {
    if (event.type !== 'card.created'
      || typeof event.cardId !== 'string'
      || !isObjectRecord(event.data)
      || !isObjectRecord(event.data.card)) continue
    const envelope = logicalCardEnvelopeFromAgentIntent(event.data.card)
    if (!envelope || createdCardEnvelopeById.has(event.cardId)) return undefined
    createdCardEnvelopeById.set(event.cardId, envelope)
  }
  const claims: DurableRecordTransition[] = []
  for (const change of changes) {
    const record = change.after ?? change.before
    if (record?.kind !== 'card') continue
    if (change.changeKind === 'insert' && change.after) {
      const eventEnvelope = createdCardEnvelopeById.get(change.recordId)
      if (!eventEnvelope) continue
      if (canonicalProfileJson(change.after.payload) === canonicalProfileJson(eventEnvelope)) continue
      if (!agentCardPayloadMatchesIntent(change.after.payload, eventEnvelope)) return undefined
      // The inserted Card is owned by its ordinary card.create binding. Its
      // own post-placement groupId is not an "another Card" reconciliation.
      continue
    }
    if (change.changeKind === 'update'
      && agentCardGroupReconciliationChange(change)
      && canonicalProfileJson(change.before?.payload) !== canonicalProfileJson(change.after?.payload)) {
      claims.push(change)
    }
  }
  return claims
}

function agentCardPayloadMatchesIntent(
  recordPayload: unknown,
  intentPayload: Record<string, unknown>,
): boolean {
  if (!isObjectRecord(recordPayload)) return false
  const { groupId: _recordGroupId, ...recordRest } = recordPayload
  const { groupId: _intentGroupId, ...intentRest } = intentPayload
  return canonicalProfileJson(recordRest) === canonicalProfileJson(intentRest)
}

function agentCardGroupReconciliationChange(change: DurableRecordTransition): boolean {
  if (change.changeKind !== 'update'
    || change.before?.kind !== 'card'
    || change.after?.kind !== 'card'
    || !isObjectRecord(change.before.payload)
    || !isObjectRecord(change.after.payload)) return false
  if (canonicalProfileJson(change.before.payload.groupId ?? null)
    === canonicalProfileJson(change.after.payload.groupId ?? null)) return false
  const {
    groupId: _beforeGroupId,
    createdBy: _beforeCreatedBy,
    lastModifiedBy: _beforeLastModifiedBy,
    ...beforePayload
  } = change.before.payload
  const {
    groupId: _afterGroupId,
    createdBy: _afterCreatedBy,
    lastModifiedBy: _afterLastModifiedBy,
    ...afterPayload
  } = change.after.payload
  const { ordinal: _beforeOrdinal, payload: _beforePayload, ...beforeEnvelope } = change.before
  const { ordinal: _afterOrdinal, payload: _afterPayload, ...afterEnvelope } = change.after
  return canonicalProfileJson(beforeEnvelope) === canonicalProfileJson(afterEnvelope)
    && canonicalProfileJson(beforePayload) === canonicalProfileJson(afterPayload)
}

function agentRecordCollectionKey(record: ProfileLogicalRecordSpec): string {
  switch (record.kind) {
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

function profileAgentRequestDigest(json: string): string {
  return createHash('sha256').update(json).digest('hex')
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isObjectRecord(value)
    && Object.keys(value).sort().join(',') === [...keys].sort().join(',')
}

function nonNegativeSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0)
}

function validSha256(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}
