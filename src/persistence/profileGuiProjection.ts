import type { IdeaSummary, IntentLogEvent, SavedBoard } from '../graph/types'
import { listModPartIdentities } from '../mods'
import type {
  ProfileModDocument,
  ProfileModIdentityPair,
  ProfileModInstanceRecord,
  ProfileModTemplateRecord,
} from './profileModRecords'
import { validateProfileModDocumentTransport } from './profileModRecords'
import {
  ProfileLogicalProjectionError,
  projectProfileSnapshot,
  type ProfileAssetProjector,
  type ProfileLogicalDocument,
} from './profileLogicalProjection'
import {
  profileServiceFailure,
  type ProfileServiceFailure,
  type ProfileSettingRecord,
  type ProfileSnapshot,
} from './profileServiceContract'
import {
  captureProfileGuiInertJson,
  ProfileGuiJsonCaptureError,
  type ProfileGuiSaveRequest,
} from './profileGuiSaveScheduler'
import { isProfileIntentActorId } from './profileIntentActor'

export const GUI_PROFILE_PROJECTION_VERSION = 2 as const

export type GuiUserModTemplate = Readonly<{
  templateId: string
  mod: ProfileModDocument
}>

export type GuiNewModOrigin =
  | Readonly<{
      kind: 'direct'
      instanceId: string
    }>
  | Readonly<{
      kind: 'stamped'
      instanceId: string
      sourceTemplateId: string
      sourceTemplateVersion: number
      sourceToInstanceIdMap: Readonly<{
        mod: ProfileModIdentityPair
        controls: readonly ProfileModIdentityPair[]
      }>
    }>

// The one Profile setting this build reads. Everything else in
// `profileSettings` is a setting some other build owns: preserved on disk,
// ignored here, and never fatal (ADR 0040).
export const PROFILE_LOCALE_SETTING_ID = 'profile-setting-locale'

// A Profile setting row. `id` is deliberately an open string and `value` is
// any JSON the record contract allows: the row shape is the envelope's
// container and stays fail-closed, while what any particular setting MEANS is
// only this build's business when this build recognises its id.
export type GuiPortableProfileSetting = Readonly<{
  id: string
  recordVersion: ProfileSettingRecord['recordVersion']
  classification: 'portable-profile'
  value: ProfileSettingRecord['value']
}>

export type GuiProfileProjection = Readonly<{
  projectionVersion: typeof GUI_PROFILE_PROJECTION_VERSION
  profileId: string
  activeIdeaId: string
  ideas: readonly IdeaSummary[]
  boardReplacements: Readonly<Record<string, SavedBoard>>
  userModTemplates: readonly GuiUserModTemplate[]
  profileSettings: readonly GuiPortableProfileSetting[]
  newModOrigins: Readonly<Record<string, GuiNewModOrigin>>
}>

export type GuiNewModMaterialization = Readonly<{
  origin: GuiNewModOrigin
  profileId: string
  boardRecordId: string
  cardId: string
  committedAt: string
  mod: ProfileModDocument
  sourceTemplate?: ProfileModTemplateRecord
}>

/**
 * Owner-resolved one-use proof. The native transaction layer authenticates and
 * consumes authorizationId idempotently; this merge enforces its exact binding.
 */
export type GuiOrdinaryNewIdeaAuthorization = Readonly<{
  authorizationId: string
  profileId: string
  baseRevision: number
  ideaId: string
  boardId: string
  createdAt: string
  expiresAt: string
}>

export type GuiProfileOwnerContext = Readonly<{
  trustedActorId: string
  ordinaryNewIdeas: readonly GuiOrdinaryNewIdeaAuthorization[]
}>

export type GuiProfileProjectionRequest = ProfileGuiSaveRequest<
  GuiProfileProjection,
  GuiProfileOwnerContext
>

export type ProfileGuiProjectionDependencies = Readonly<{
  projectAsset: ProfileAssetProjector
  materializeUserModTemplate(input: Readonly<{
    profileId: string
    templateId: string
    committedAt: string
    mod: ProfileModDocument
    existing?: ProfileModTemplateRecord
  }>): ProfileModTemplateRecord
  materializeNewModInstance(input: GuiNewModMaterialization): ProfileModInstanceRecord
}>

export type GuiProfileProjectionMerge = Readonly<{
  snapshot: ProfileSnapshot
  logicalDocument: ProfileLogicalDocument
}>

export class ProfileGuiProjectionError extends Error {
  constructor(
    public readonly code: 'invalid' | 'conflict' | 'unsupported-future-version',
    message: string,
    public readonly currentRevision?: number,
  ) {
    super(message)
    this.name = 'ProfileGuiProjectionError'
  }
}

export function profileGuiProjectionFailure(error: unknown): ProfileServiceFailure | undefined {
  if (!(error instanceof ProfileGuiProjectionError)) return undefined
  return profileServiceFailure(error.code, {
    ...(error.code === 'conflict' && error.currentRevision !== undefined
      ? { currentRevision: error.currentRevision }
      : {}),
  })
}

/**
 * Replaces only the renderer-owned Profile projection. The native snapshot is
 * trusted owner state; this function keeps its compatibility, migration,
 * recovery, and omitted-Board closure while #594 validates the complete result.
 */
export function mergeGuiProfileProjection(
  current: ProfileSnapshot,
  candidate: unknown,
  dependencies: ProfileGuiProjectionDependencies,
): GuiProfileProjectionMerge {
  let captured: unknown
  try {
    captured = captureProfileGuiInertJson(candidate, '$request')
  } catch (error) {
    if (error instanceof ProfileGuiJsonCaptureError) invalid(error.message)
    throw error
  }
  const request = decodeRequest(captured)
  const projection = request.projection
  const ownerContext = request.context
  if (projection.profileId !== current.profileId) {
    invalid('GUI projection targets a different Profile')
  }
  if (request.expectedRevision !== current.revision) {
    throw new ProfileGuiProjectionError(
      'conflict',
      `GUI projection expected revision ${request.expectedRevision}; current revision is ${current.revision}`,
      current.revision,
    )
  }
  if (current.revision >= Number.MAX_SAFE_INTEGER) invalid('Profile revision cannot advance safely')
  if (!isProfileIntentActorId(ownerContext.trustedActorId)) {
    invalid('Trusted GUI actor identity is missing or invalid')
  }

  const currentIdeas = new Map(current.ideas.map((idea) => [idea.id, idea] as const))
  const ordinaryAuthorizations = new Map<string, GuiOrdinaryNewIdeaAuthorization>()
  const ordinaryAuthorizationIds = new Set<string>()
  for (const authorization of ownerContext.ordinaryNewIdeas) {
    if (!hasExactKeys(authorization, [
      'authorizationId',
      'profileId',
      'baseRevision',
      'ideaId',
      'boardId',
      'createdAt',
      'expiresAt',
    ])
      || !nonEmptyString(authorization.authorizationId)
      || authorization.profileId !== current.profileId
      || authorization.baseRevision !== request.expectedRevision
      || !nonEmptyString(authorization.ideaId)
      || authorization.boardId !== `board:${authorization.ideaId}`
      || !canonicalTimestamp(authorization.createdAt)
      || !canonicalTimestamp(authorization.expiresAt)
      || Date.parse(authorization.createdAt) > Date.parse(request.committedAt)
      || Date.parse(authorization.expiresAt) <= Date.parse(request.committedAt)
      || ordinaryAuthorizationIds.has(authorization.authorizationId)
      || ordinaryAuthorizations.has(authorization.ideaId)) {
      invalid('Trusted ordinary-Idea authorization is invalid or duplicated')
    }
    ordinaryAuthorizationIds.add(authorization.authorizationId)
    ordinaryAuthorizations.set(authorization.ideaId, cloneJson(authorization))
  }
  const requestedIdeaIds = new Set<string>()
  for (const idea of projection.ideas) {
    if (!isPlainRecord(idea) || typeof idea.id !== 'string' || idea.id.length === 0) {
      invalid('GUI projection contains an invalid Idea identity')
    }
    if (requestedIdeaIds.has(idea.id)) invalid(`GUI projection duplicates Idea ${idea.id}`)
    requestedIdeaIds.add(idea.id)
    const previous = currentIdeas.get(idea.id)
    if (previous) requireNonRewindingIdea(previous, idea)
  }
  if (!requestedIdeaIds.has(projection.activeIdeaId)) {
    invalid('GUI projection active Idea is missing')
  }

  for (const ideaId of Object.keys(projection.boardReplacements)) {
    if (!requestedIdeaIds.has(ideaId)) {
      invalid(`GUI projection supplies Board ${ideaId} outside its Idea catalog`)
    }
  }

  const boards = Object.create(null) as Record<string, SavedBoard>
  const replacedIdeaIds = new Set<string>()
  const consumedOrdinaryAuthorizations = new Set<string>()
  for (const idea of projection.ideas) {
    const replacement = ownValue(projection.boardReplacements, idea.id)
    const previous = ownValue(current.boards, idea.id)
    if (replacement !== undefined) {
      replacedIdeaIds.add(idea.id)
      requireNonRewindingBoard(previous, replacement, idea.id)
      const intentLog = reconcileIntentPrefix(
        previous,
        replacement,
        idea.id,
        ownerContext.trustedActorId,
      )
      boards[idea.id] = cloneJson(intentLog === undefined
        ? replacement
        : { ...replacement, intentLog })
      continue
    }
    if (!currentIdeas.has(idea.id) || !previous) {
      invalid(`GUI projection new Idea ${idea.id} requires a Board replacement`)
    }
    boards[idea.id] = cloneJson(previous)
  }
  for (const idea of projection.ideas) {
    if (currentIdeas.has(idea.id)) continue
    const authorization = ordinaryAuthorizations.get(idea.id)
    const board = ownValue(boards, idea.id)
    if (!authorization
      || authorization.createdAt !== idea.createdAt
      || Date.parse(idea.updatedAt) < Date.parse(idea.createdAt)
      || Date.parse(idea.lastOpenedAt) < Date.parse(idea.createdAt)
      || !board
      || Date.parse(board.updatedAt) < Date.parse(authorization.createdAt)) {
      invalid(`GUI projection new Idea ${idea.id} lacks matching ordinary-create authorization`)
    }
    consumedOrdinaryAuthorizations.add(idea.id)
  }
  if (consumedOrdinaryAuthorizations.size !== ordinaryAuthorizations.size) {
    invalid('Trusted ordinary-Idea authorization was not consumed exactly once')
  }

  const profileSettings = projection.profileSettings.map(decodePortableProfileSetting)

  const modTemplates = mergeUserModTemplates(
    current,
    projection.userModTemplates,
    request.committedAt,
    dependencies.materializeUserModTemplate,
  )

  const snapshot = deepFreeze(cloneJson({
    profileId: current.profileId,
    revision: current.revision + 1,
    versions: current.versions,
    activeIdeaId: projection.activeIdeaId,
    ideas: [...projection.ideas],
    boards,
    modTemplates,
    modInstances: mergeBoardModInstances(
      current.modInstances,
      projection.ideas,
      boards,
      replacedIdeaIds,
      projection.newModOrigins,
      current.modTemplates,
      modTemplates,
      current.profileId,
      request.committedAt,
      dependencies.materializeNewModInstance,
    ),
    ...(current.profileAgentEvents === undefined
      ? {}
      : { profileAgentEvents: current.profileAgentEvents }),
    profileSettings,
    migrationLedger: current.migrationLedger,
    recoveryPoints: current.recoveryPoints,
    compatibility: current.compatibility,
  } satisfies ProfileSnapshot))
  let logicalDocument: ProfileLogicalDocument
  try {
    logicalDocument = projectProfileSnapshot({
      ...snapshot,
      // #594 projects current logical authority; recovery generations remain a
      // native-owned root set and are preserved only on the returned snapshot.
      recoveryPoints: [],
    }, dependencies.projectAsset)
  } catch (error) {
    if (error instanceof ProfileLogicalProjectionError) {
      invalid(`GUI projection violates the logical Profile contract: ${error.message}`)
    }
    throw error
  }
  return Object.freeze({ snapshot, logicalDocument })
}

function mergeUserModTemplates(
  current: ProfileSnapshot,
  requested: readonly GuiUserModTemplate[],
  committedAt: string,
  materialize: ProfileGuiProjectionDependencies['materializeUserModTemplate'],
): ProfileModTemplateRecord[] {
  const builtIns = current.modTemplates.filter((template) => template.payload.provenance.kind === 'built-in')
  const existingUsers = new Map(current.modTemplates
    .filter((template) => template.payload.provenance.kind === 'user')
    .map((template) => [template.recordId, template] as const))
  const builtInIds = new Set(builtIns.map((template) => template.recordId))
  const seen = new Set<string>()
  const users = requested.map((template, ordinal) => {
    if (!hasExactKeys(template, ['templateId', 'mod'])
      || !nonEmptyString(template.templateId)
      || !validateProfileModDocumentTransport(template.mod).ok) {
      invalid(`GUI projection user Mod template ${ordinal} has an invalid identity`)
    }
    const { templateId, mod } = template
    if (seen.has(templateId)) invalid(`GUI projection duplicates user Mod template ${templateId}`)
    if (builtInIds.has(templateId)) invalid(`GUI projection cannot replace built-in Mod template ${templateId}`)
    seen.add(templateId)
    const existing = existingUsers.get(templateId)
    if (existing && canonicalJson(existing.payload.mod) === canonicalJson(mod)) {
      return cloneJson(existing)
    }
    const record = materialize({
      profileId: current.profileId,
      templateId,
      committedAt,
      mod: deepFreeze(cloneJson(mod)) as ProfileModDocument,
      ...(existing ? { existing: cloneJson(existing) } : {}),
    })
    validateMaterializedUserTemplate(
      record,
      templateId,
      mod,
      existing,
      current.profileId,
      committedAt,
    )
    return cloneJson(record)
  })
  return [...builtIns.map(cloneJson), ...users]
}

function validateMaterializedUserTemplate(
  record: ProfileModTemplateRecord,
  templateId: string,
  mod: ProfileModDocument,
  existing: ProfileModTemplateRecord | undefined,
  profileId: string,
  committedAt: string,
): void {
  if (record.kind !== 'mod-template'
    || record.recordId !== templateId
    || record.ownerId !== profileId
    || record.parentId !== profileId
    || record.payload.provenance.kind !== 'user'
    || canonicalJson(record.payload.mod) !== canonicalJson(mod)) {
    invalid(`GUI projection user Mod template ${templateId} materialized with conflicting native identity`)
  }
  if (!existing) {
    if (record.payload.templateVersion !== 1
      || record.payload.createdAt !== committedAt
      || record.payload.updatedAt !== committedAt) {
      invalid(`GUI projection new user Mod template ${templateId} has invalid native creation metadata`)
    }
    return
  }
  if (record.payload.templateVersion !== existing.payload.templateVersion + 1
    || Date.parse(committedAt) <= Date.parse(existing.payload.updatedAt)
    || record.payload.updatedAt !== committedAt
    || canonicalJson(templateEnvelopeWithoutPayload(record))
      !== canonicalJson(templateEnvelopeWithoutPayload(existing))
    || canonicalJson(templateImmutablePayload(record))
      !== canonicalJson(templateImmutablePayload(existing))) {
    invalid(`GUI projection user Mod template ${templateId} did not preserve native metadata`)
  }
}

function templateEnvelopeWithoutPayload(record: ProfileModTemplateRecord): Record<string, unknown> {
  const { payload: _payload, ...envelope } = record
  return envelope
}

function templateImmutablePayload(record: ProfileModTemplateRecord): Record<string, unknown> {
  const {
    templateVersion: _templateVersion,
    updatedAt: _updatedAt,
    mod: _mod,
    ...immutable
  } = record.payload
  return immutable
}

function decodeRequest(candidate: unknown): GuiProfileProjectionRequest {
  if (!hasExactKeys(candidate, [
    'generation',
    'expectedRevision',
    'clientTxnId',
    'idempotencyKey',
    'committedAt',
    'context',
    'projection',
  ])) invalid('Request is not the exact GUI save envelope')
  if (!positiveSafeInteger(candidate.generation)
    || !nonNegativeSafeInteger(candidate.expectedRevision)
    || !nonEmptyString(candidate.clientTxnId)
    || !nonEmptyString(candidate.idempotencyKey)
    || !canonicalTimestamp(candidate.committedAt)
    || !hasExactKeys(candidate.context, ['trustedActorId', 'ordinaryNewIdeas'])
    || !isProfileIntentActorId(candidate.context.trustedActorId)
    || !Array.isArray(candidate.context.ordinaryNewIdeas)
    || !hasExactKeys(candidate.projection, [
    'projectionVersion',
    'profileId',
    'activeIdeaId',
    'ideas',
    'boardReplacements',
    'userModTemplates',
    'profileSettings',
    'newModOrigins',
  ])) {
    invalid('Request is not the exact GUI projection envelope')
  }
  const projection = candidate.projection
  if (projection.projectionVersion !== GUI_PROFILE_PROJECTION_VERSION) {
    if (Number.isSafeInteger(projection.projectionVersion)
      && Number(projection.projectionVersion) > GUI_PROFILE_PROJECTION_VERSION) {
      throw new ProfileGuiProjectionError(
        'unsupported-future-version',
        `GUI projection version ${String(projection.projectionVersion)} is not supported`,
      )
    }
    invalid(`GUI projection version must be ${GUI_PROFILE_PROJECTION_VERSION}`)
  }
  if (!nonEmptyString(projection.profileId)
    || !nonEmptyString(projection.activeIdeaId)
    || !Array.isArray(projection.ideas)
    || !isPlainRecord(projection.boardReplacements)
    || !Array.isArray(projection.userModTemplates)
    || !Array.isArray(projection.profileSettings)
    || !isPlainRecord(projection.newModOrigins)) {
    invalid('GUI projection envelope fields are invalid')
  }
  return candidate as unknown as GuiProfileProjectionRequest
}

function mergeBoardModInstances(
  existing: readonly ProfileModInstanceRecord[],
  ideas: readonly IdeaSummary[],
  boards: Readonly<Record<string, SavedBoard>>,
  replacedIdeaIds: ReadonlySet<string>,
  newModOrigins: Readonly<Record<string, GuiNewModOrigin>>,
  previousModTemplates: readonly ProfileModTemplateRecord[],
  nextModTemplates: readonly ProfileModTemplateRecord[],
  profileId: string,
  committedAt: string,
  materializeNewModInstance: ProfileGuiProjectionDependencies['materializeNewModInstance'],
): ProfileModInstanceRecord[] {
  const result: ProfileModInstanceRecord[] = []
  const consumedOrigins = new Set<string>()
  const usedInstanceRecordIds = new Set(existing.map((instance) => instance.recordId))
  const availableModTemplates = [...previousModTemplates, ...nextModTemplates]
  for (const idea of ideas) {
    const ownerId = `board:${idea.id}`
    const boardInstances = existing.filter((instance) => instance.ownerId === ownerId)
    if (!replacedIdeaIds.has(idea.id)) {
      result.push(...boardInstances.map(cloneJson))
      continue
    }
    const board = ownValue(boards, idea.id)
    if (!board) invalid(`GUI projection Board ${idea.id} is missing during Mod reconciliation`)
    for (const card of board.cards) {
      if (card.modV2 === undefined) continue
      const matches = boardInstances.filter((instance) => instance.parentId === card.id)
      if (matches.length === 0) {
        const rawOrigin = ownValue(newModOrigins, card.id)
        if (!rawOrigin) invalid(`GUI projection new Mod Card ${card.id} is missing its origin`)
        const origin = decodeNewModOrigin(rawOrigin, card.id, card.modV2, availableModTemplates)
        if (usedInstanceRecordIds.has(origin.instanceId)) {
          invalid(`GUI projection Mod instance ${origin.instanceId} conflicts with an existing native identity`)
        }
        const sourceTemplate = origin.kind === 'stamped'
          ? findTemplateVersion(
              availableModTemplates,
              origin.sourceTemplateId,
              origin.sourceTemplateVersion,
            )
          : undefined
        const materialized = materializeNewModInstance({
          origin,
          profileId,
          boardRecordId: ownerId,
          cardId: card.id,
          committedAt,
          mod: deepFreeze(cloneJson(card.modV2)) as ProfileModDocument,
          ...(sourceTemplate
            ? { sourceTemplate: deepFreeze(cloneJson(sourceTemplate)) }
            : {}),
        })
        if (materialized.recordId !== origin.instanceId
          || materialized.ownerId !== ownerId
          || materialized.parentId !== card.id) {
          invalid(`GUI projection new Mod on Card ${card.id} materialized with conflicting native identity`)
        }
        validateMaterializedNewMod(materialized, origin, committedAt)
        usedInstanceRecordIds.add(origin.instanceId)
        consumedOrigins.add(card.id)
        result.push(cloneJson(materialized))
        continue
      }
      if (matches.length !== 1 || !matches[0]) {
        invalid(`GUI projection Mod Card ${card.id} has ambiguous native provenance`)
      }
      const instance = matches[0]
      result.push(cloneJson({
        ...instance,
        payload: { ...instance.payload, mod: card.modV2 },
      }) as ProfileModInstanceRecord)
    }
  }
  const originIds = Object.keys(newModOrigins)
  if (originIds.length !== consumedOrigins.size
    || originIds.some((originId) => !consumedOrigins.has(originId))) {
    invalid('GUI projection contains an unused or conflicting new Mod origin')
  }
  return result
}

function validateMaterializedNewMod(
  record: ProfileModInstanceRecord,
  origin: GuiNewModOrigin,
  committedAt: string,
): void {
  if (origin.kind === 'direct') {
    if (record.recordId !== origin.instanceId
      || record.payload.source.kind !== 'direct'
      || !('createdAt' in record.payload)
      || record.payload.createdAt !== committedAt) {
      invalid(`GUI projection new Mod ${record.recordId} has invalid direct native metadata`)
    }
    return
  }
  if (record.payload.source.kind !== 'template'
    || !('stampedAt' in record.payload)
    || !('idMap' in record.payload)
    || record.payload.source.templateId !== origin.sourceTemplateId
    || record.payload.source.templateVersion !== origin.sourceTemplateVersion
    || record.payload.stampedAt !== committedAt
    || canonicalJson(record.payload.idMap) !== canonicalJson(origin.sourceToInstanceIdMap)) {
    invalid(`GUI projection new Mod ${record.recordId} has invalid stamped native metadata`)
  }
}

function decodeNewModOrigin(
  candidate: GuiNewModOrigin,
  cardId: string,
  mod: ProfileModDocument,
  templates: readonly ProfileModTemplateRecord[],
): GuiNewModOrigin {
  if (!validateProfileModDocumentTransport(mod).ok) {
    invalid(`GUI projection new Mod Card ${cardId} does not satisfy the current Mod schema`)
  }
  const instanceParts = listModPartIdentities(mod)
  if (hasExactKeys(candidate, ['kind', 'instanceId'])
    && candidate.kind === 'direct'
    && nonEmptyString(candidate.instanceId)
    && candidate.instanceId !== cardId
    && !instanceParts.some((part) => part.sourceId === candidate.instanceId)) {
    return Object.freeze({ kind: 'direct', instanceId: candidate.instanceId })
  }
  if (isPlainRecord(candidate) && candidate.kind === 'direct') {
    invalid(`GUI projection new Mod Card ${cardId} has an invalid direct origin`)
  }
  if (!hasExactKeys(candidate, [
    'kind',
    'instanceId',
    'sourceTemplateId',
    'sourceTemplateVersion',
    'sourceToInstanceIdMap',
  ])
    || candidate.kind !== 'stamped'
    || !nonEmptyString(candidate.instanceId)
    || candidate.instanceId === cardId
    || !nonEmptyString(candidate.sourceTemplateId)
    || !positiveSafeInteger(candidate.sourceTemplateVersion)
    || !hasExactKeys(candidate.sourceToInstanceIdMap, ['mod', 'controls'])
    || !validIdentityPair(candidate.sourceToInstanceIdMap.mod)
    || !Array.isArray(candidate.sourceToInstanceIdMap.controls)
    || !candidate.sourceToInstanceIdMap.controls.every(validIdentityPair)) {
    invalid(`GUI projection new Mod Card ${cardId} has an invalid stamped origin`)
  }
  const template = findTemplateVersion(
    templates,
    candidate.sourceTemplateId,
    candidate.sourceTemplateVersion,
  )
  const sourceParts = template ? listModPartIdentities(template.payload.mod) : []
  const sourceIds = [
    candidate.sourceToInstanceIdMap.mod.sourceId,
    ...candidate.sourceToInstanceIdMap.controls.map((pair) => pair.sourceId),
  ]
  const instanceIds = [
    candidate.sourceToInstanceIdMap.mod.instanceId,
    ...candidate.sourceToInstanceIdMap.controls.map((pair) => pair.instanceId),
  ]
  if (!template
    || template.payload.templateVersion !== candidate.sourceTemplateVersion
    || candidate.sourceToInstanceIdMap.mod.sourceId !== template.recordId
    || candidate.sourceToInstanceIdMap.mod.instanceId !== candidate.instanceId
    || candidate.sourceToInstanceIdMap.controls.length !== sourceParts.length
    || candidate.sourceToInstanceIdMap.controls.length !== instanceParts.length
    || candidate.sourceToInstanceIdMap.controls.some((pair, index) => (
      pair.sourceId !== sourceParts[index]?.sourceId
        || pair.instanceId !== instanceParts[index]?.sourceId
    ))
    || new Set(sourceIds).size !== sourceIds.length
    || new Set(instanceIds).size !== instanceIds.length
    || sourceIds.some((sourceId) => instanceIds.includes(sourceId))) {
    invalid(`GUI projection new Mod Card ${cardId} cannot verify its stamped template origin`)
  }
  return deepFreeze(cloneJson(candidate))
}

function findTemplateVersion(
  templates: readonly ProfileModTemplateRecord[],
  templateId: string,
  templateVersion: number,
): ProfileModTemplateRecord | undefined {
  return templates.find((template) => template.recordId === templateId
    && template.payload.templateVersion === templateVersion)
}

function validIdentityPair(value: unknown): value is ProfileModIdentityPair {
  return hasExactKeys(value, ['sourceId', 'instanceId'])
    && nonEmptyString(value.sourceId)
    && nonEmptyString(value.instanceId)
    && value.sourceId !== value.instanceId
}

function reconcileIntentPrefix(
  previous: SavedBoard | undefined,
  replacement: SavedBoard,
  ideaId: string,
  trustedActorId: string,
): IntentLogEvent[] | undefined {
  if (previous?.intentLog === undefined && replacement.intentLog === undefined) {
    return undefined
  }
  const prefix = previous?.intentLog ?? []
  const next = replacement.intentLog ?? []
  const mismatchIndex = prefix.findIndex(
    (event, index) => canonicalJson(intentEventWithoutOwnerCardAuthorship(event))
      !== canonicalJson(intentEventWithoutOwnerCardAuthorship(next[index])),
  )
  if (next.length < prefix.length || mismatchIndex !== -1) {
    invalid(`GUI projection Board ${ideaId} must retain the exact append-only Intent prefix`)
  }
  if (next.slice(prefix.length).some((event) => event.actorId !== trustedActorId)) {
    invalid(`GUI projection Board ${ideaId} contains an Intent suffix without trusted actor attribution`)
  }
  let previousAt = prefix.length === 0
    ? Number.NEGATIVE_INFINITY
    : Date.parse(prefix[prefix.length - 1]!.at)
  for (const event of next.slice(prefix.length)) {
    const eventAt = Date.parse(event.at)
    if (!canonicalTimestamp(event.at) || eventAt < previousAt) {
      invalid(`GUI projection Board ${ideaId} contains a rewinding Intent suffix timestamp`)
    }
    previousAt = eventAt
  }
  return [...prefix.map(cloneJson), ...next.slice(prefix.length).map(cloneJson)]
}

function intentEventWithoutOwnerCardAuthorship(
  event: IntentLogEvent | undefined,
): IntentLogEvent | undefined {
  if (!event
    || (event.type !== 'card.created'
      && event.type !== 'group.created'
      && event.type !== 'card.deleted')) {
    return event
  }
  const {
    createdBy: _createdBy,
    lastModifiedBy: _lastModifiedBy,
    ...card
  } = event.data.card
  return {
    ...event,
    data: {
      ...event.data,
      card,
    },
  } as IntentLogEvent
}

function requireNonRewindingIdea(previous: IdeaSummary, next: IdeaSummary): void {
  if (next.createdAt !== previous.createdAt) {
    invalid(`GUI projection Idea ${next.id} cannot rewrite createdAt`)
  }
  for (const field of ['updatedAt', 'lastOpenedAt'] as const) {
    if (Date.parse(next[field]) < Date.parse(previous[field])) {
      invalid(`GUI projection Idea ${next.id} cannot rewind ${field}`)
    }
  }
}

function requireNonRewindingBoard(
  previous: SavedBoard | undefined,
  next: SavedBoard,
  ideaId: string,
): void {
  if (previous && Date.parse(next.updatedAt) < Date.parse(previous.updatedAt)) {
    invalid(`GUI projection Board ${ideaId} cannot rewind updatedAt`)
  }
}

// The row's CONTAINER stays fail-closed: a row that is not a well-formed
// Profile setting record is corruption, and the strict validators keep owning
// it. What the row MEANS does not. A setting whose id this build does not
// recognise is a preference belonging to another build: it is carried through
// verbatim and never inspected, because refusing it here is how a person who
// downgrades once loses their whole Profile over a setting nothing reads
// (ADR 0040).
function decodePortableProfileSetting(
  candidate: GuiPortableProfileSetting,
  ordinal: number,
): GuiPortableProfileSetting {
  if (!hasExactKeys(candidate, ['id', 'recordVersion', 'classification', 'value'])
    || !nonEmptyString(candidate.id)
    || candidate.recordVersion !== 1
    || candidate.classification !== 'portable-profile') {
    invalid(`GUI projection Profile setting ${ordinal} is not an admitted portable setting`)
  }
  if (candidate.id !== PROFILE_LOCALE_SETTING_ID) {
    return deepFreeze(cloneJson(candidate)) as GuiPortableProfileSetting
  }
  if (!hasExactKeys(candidate.value, ['locale']) || !canonicalLocale(candidate.value.locale)) {
    invalid(`GUI projection Profile setting ${ordinal} is not an admitted portable setting`)
  }
  return deepFreeze(cloneJson(candidate)) as GuiPortableProfileSetting
}

function canonicalLocale(value: unknown): value is string {
  if (!nonEmptyString(value) || value.length > 64) return false
  try {
    return Intl.getCanonicalLocales(value)[0] === value
  } catch {
    return false
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(sortJson(value))
}

function sortJson(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortJson)
  if (!isPlainRecord(value)) return value
  const result = Object.create(null) as Record<string, unknown>
  for (const key of Object.keys(value).sort()) result[key] = sortJson(value[key])
  return result
}

function hasExactKeys(value: unknown, expected: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false
  const actual = Object.keys(value)
  return actual.length === expected.length && expected.every((key) => hasOwn(value, key))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
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

function ownValue<Value>(value: Readonly<Record<string, Value>>, key: string): Value | undefined {
  return hasOwn(value, key) ? value[key] : undefined
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function deepFreeze<Value>(value: Value): Value {
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deepFreeze(entry)
  return Object.freeze(value)
}

function invalid(message: string): never {
  throw new ProfileGuiProjectionError('invalid', message)
}
