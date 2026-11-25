import {
  planProfileAgentCommandBatch,
  validateProfileAgentCommandRequest,
  type ProfileAgentCommandRequest,
  type ProfileAgentCommandResult,
  type ProfileAgentRecordChange,
} from './profileAgentCommandPlan'
import {
  INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY,
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
  PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
  PROFILE_AGENT_COMMAND_DESCRIPTORS,
  PROFILE_AGENT_COMMAND_LIMITS,
  PROFILE_AGENT_COMMAND_RESULT_LIMITS,
  selectProfileAgentCommandSurface,
  type ProfileAgentCommandName,
  type ProfileAgentCommandDescriptor,
  type ProfileAgentCommandSurfaceVersion,
} from './profileAgentCommandManifest'
import {
  createProfileCapabilities,
  profileServiceFailure,
  type ProfileAdapterKind,
  type ProfileCapabilities,
  type ProfileServiceResult,
} from './profileServiceContract'

export {
  INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_CAPABILITY,
  INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES,
  INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY,
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
  PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
  PROFILE_AGENT_COMMAND_RESULT_LIMITS,
  type ProfileAgentCommandBatchCapability,
  type ProfileAgentCommandCapabilityDescriptor,
} from './profileAgentCommandManifest'

export const PROFILE_AGENT_COMMAND_RECEIPT_VERSION =
  PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION
export const PROFILE_AGENT_COMMAND_RECEIPT_VERSIONS = Object.freeze([1, 2, 3, 4, 5] as const)
export const PROFILE_AGENT_INSTALLED_ACTOR_ID = 'local-agent' as const

export type ProfileAgentInstalledTransport = 'cli' | 'mcp'

export type ProfileAgentCommandEffectsSummaryV1 = Readonly<{
  inserted: number
  updated: number
  deleted: number
  intentEvents: number
}>

export type ProfileAgentCommandEffectsSummaryV2 = ProfileAgentCommandEffectsSummaryV1 & Readonly<{
  profileAgentEvents: number
}>

export type ProfileAgentCommandEffectsSummary =
  | ProfileAgentCommandEffectsSummaryV1
  | ProfileAgentCommandEffectsSummaryV2

type ProfileAgentCommandBatchReceiptBase = Readonly<{
  kind: 'agent-command-batch'
  previousRevision: number
  revision: number
  proposedRevision: number
  commitId: string | null
  commandResults: readonly ProfileAgentCommandResult[]
  intentEventIds: readonly string[]
  dryRun: boolean
  replayed: boolean
}>

export type ProfileAgentCommandBatchReceiptV1 = ProfileAgentCommandBatchReceiptBase & Readonly<{
  version: 1
  effects: ProfileAgentCommandEffectsSummaryV1
}>

export type ProfileAgentCommandBatchReceiptV2 = ProfileAgentCommandBatchReceiptBase & Readonly<{
  version: 2
  effects: ProfileAgentCommandEffectsSummaryV2
  profileAgentEventIds: readonly string[]
}>

export type ProfileAgentCommandBatchReceiptV3 = ProfileAgentCommandBatchReceiptBase & Readonly<{
  version: 3
  effects: ProfileAgentCommandEffectsSummaryV2
  profileAgentEventIds: readonly string[]
}>

export type ProfileAgentCommandBatchReceiptV4 = ProfileAgentCommandBatchReceiptBase & Readonly<{
  version: 4
  effects: ProfileAgentCommandEffectsSummaryV2
  profileAgentEventIds: readonly string[]
}>

export type ProfileAgentCommandBatchReceiptV5 = ProfileAgentCommandBatchReceiptBase & Readonly<{
  version: 5
  effects: ProfileAgentCommandEffectsSummaryV2
  profileAgentEventIds: readonly string[]
}>

export type ProfileAgentCommandBatchReceipt =
  | ProfileAgentCommandBatchReceiptV1
  | ProfileAgentCommandBatchReceiptV2
  | ProfileAgentCommandBatchReceiptV3
  | ProfileAgentCommandBatchReceiptV4
  | ProfileAgentCommandBatchReceiptV5

type InstalledProfileAgentCommandDescriptor = ProfileAgentCommandDescriptor & Readonly<{
  version: 1
  schema: Readonly<{
    version: 1
    validateRequest: typeof validateInstalledProfileAgentCommandRequest
  }>
  planner: typeof planProfileAgentCommandBatch
  executor: 'applyAgentCommandBatch'
}>

export const INSTALLED_PROFILE_AGENT_COMMAND_DESCRIPTORS: Readonly<
  Record<ProfileAgentCommandName, InstalledProfileAgentCommandDescriptor>
> = Object.freeze(Object.fromEntries(
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES.map((name) => [
    name,
    Object.freeze({
      ...PROFILE_AGENT_COMMAND_DESCRIPTORS[name],
      version: 1 as const,
      schema: Object.freeze({
        version: 1 as const,
        validateRequest: validateInstalledProfileAgentCommandRequest,
      }),
      planner: planProfileAgentCommandBatch,
      executor: 'applyAgentCommandBatch' as const,
    }),
  ]),
) as Record<ProfileAgentCommandName, InstalledProfileAgentCommandDescriptor>)

export function validateInstalledProfileAgentCommandRequest(
  candidate: unknown,
): ProfileServiceResult<ProfileAgentCommandRequest> {
  return validateProfileAgentCommandRequestForSurface(
    candidate,
    PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
  )
}

export function validateProfileAgentCommandRequestForSurface(
  candidate: unknown,
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): ProfileServiceResult<ProfileAgentCommandRequest> {
  const surface = selectProfileAgentCommandSurface(surfaceVersion)
  if (!surface) return profileServiceFailure('unsupported-future-version')
  return validateProfileAgentCommandRequest(candidate, surface.names, surfaceVersion)
}

export function createInstalledProfileAgentCapabilities(
  adapter: ProfileAdapterKind,
): ProfileCapabilities {
  const base = createProfileCapabilities(adapter)
  return Object.freeze({
    ...base,
    commands: INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
    commandBatch: INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY,
  })
}

export async function executeInstalledProfileAgentCommandBatch(
  service: Readonly<{
    applyAgentCommandBatch?(
      request: ProfileAgentCommandRequest,
    ): Promise<ProfileServiceResult<ProfileAgentCommandBatchReceipt>>
  }>,
  candidate: unknown,
): Promise<ProfileServiceResult<ProfileAgentCommandBatchReceipt>> {
  const request = validateInstalledProfileAgentCommandRequest(candidate)
  if (!request.ok) return request
  const executors = new Set(request.value.commands.map((command) => (
    INSTALLED_PROFILE_AGENT_COMMAND_DESCRIPTORS[command.name]?.executor
  )))
  if (executors.size !== 1 || !executors.has('applyAgentCommandBatch')) {
    return profileServiceFailure('capability-denied')
  }
  if (typeof service.applyAgentCommandBatch !== 'function') {
    return profileServiceFailure('capability-denied')
  }
  const result = await service.applyAgentCommandBatch(request.value)
  if (!result.ok) return result
  return isInstalledProfileAgentCommandBatchSuccessForRequest(result.value, request.value)
    ? result
    : profileServiceFailure('internal')
}

export function isInstalledProfileAgentCommandBatchSuccessForRequest(
  candidate: unknown,
  request: ProfileAgentCommandRequest,
): candidate is ProfileAgentCommandBatchReceipt {
  if (!isInstalledOrReplayedProfileAgentCommandReceipt(candidate)) return false
  const validatedRequest = validateProfileAgentCommandRequestForSurface(request, candidate.version)
  if (!validatedRequest.ok) return false
  if (candidate.version === 1) return true
  const expectedProfileAgentEventCount = validatedRequest.value.commands.reduce(
    (count, command) => (
      count + PROFILE_AGENT_COMMAND_DESCRIPTORS[command.name].profileAgentEventCount
    ),
    0,
  )
  return candidate.effects.profileAgentEvents === expectedProfileAgentEventCount
    && (
      expectedProfileAgentEventCount !== validatedRequest.value.commands.length
      || candidate.effects.intentEvents === 0
    )
}

export function isInstalledOrReplayedProfileAgentCommandReceipt(
  candidate: unknown,
): candidate is ProfileAgentCommandBatchReceipt {
  return isProfileAgentCommandBatchReceiptForSurface(
    candidate,
    PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
  ) || ((
    isProfileAgentCommandBatchReceiptForSurface(candidate, 1)
    || isProfileAgentCommandBatchReceiptForSurface(candidate, 2)
    || isProfileAgentCommandBatchReceiptForSurface(candidate, 3)
    || isProfileAgentCommandBatchReceiptForSurface(candidate, 4)
  ) && candidate.replayed === true)
}

export function summarizeProfileAgentCommandEffects(
  changes: readonly ProfileAgentRecordChange[],
  intentEventCount: number,
): ProfileAgentCommandEffectsSummaryV2
export function summarizeProfileAgentCommandEffects(
  changes: readonly ProfileAgentRecordChange[],
  intentEventCount: number,
  profileAgentEventCount: number,
  surfaceVersion: 1,
): ProfileAgentCommandEffectsSummaryV1
export function summarizeProfileAgentCommandEffects(
  changes: readonly ProfileAgentRecordChange[],
  intentEventCount: number,
  profileAgentEventCount: number,
  surfaceVersion: 2,
): ProfileAgentCommandEffectsSummaryV2
export function summarizeProfileAgentCommandEffects(
  changes: readonly ProfileAgentRecordChange[],
  intentEventCount: number,
  profileAgentEventCount: number,
  surfaceVersion: 3,
): ProfileAgentCommandEffectsSummaryV2
export function summarizeProfileAgentCommandEffects(
  changes: readonly ProfileAgentRecordChange[],
  intentEventCount: number,
  profileAgentEventCount: number,
  surfaceVersion: 4,
): ProfileAgentCommandEffectsSummaryV2
export function summarizeProfileAgentCommandEffects(
  changes: readonly ProfileAgentRecordChange[],
  intentEventCount: number,
  profileAgentEventCount: number,
  surfaceVersion: 5,
): ProfileAgentCommandEffectsSummaryV2
export function summarizeProfileAgentCommandEffects(
  changes: readonly ProfileAgentRecordChange[],
  intentEventCount: number,
  profileAgentEventCount: number,
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): ProfileAgentCommandEffectsSummary
export function summarizeProfileAgentCommandEffects(
  changes: readonly ProfileAgentRecordChange[],
  intentEventCount: number,
  profileAgentEventCount = 0,
  surfaceVersion: ProfileAgentCommandSurfaceVersion = PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
): ProfileAgentCommandEffectsSummary {
  if (surfaceVersion === 1 && profileAgentEventCount !== 0) {
    throw new Error('Profile Agent surface 1 cannot summarize Profile Agent events')
  }
  const base = {
    inserted: changes.filter((change) => change.operation === 'insert').length,
    updated: changes.filter((change) => change.operation === 'replace').length,
    deleted: changes.filter((change) => change.operation === 'delete').length,
    intentEvents: intentEventCount,
  }
  return surfaceVersion >= 2
    ? Object.freeze({ ...base, profileAgentEvents: profileAgentEventCount })
    : Object.freeze(base)
}

export function isProfileAgentCommandBatchReceipt(
  candidate: unknown,
): candidate is ProfileAgentCommandBatchReceiptV5 {
  return isProfileAgentCommandBatchReceiptForSurface(
    candidate,
    PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
  )
}

export function isProfileAgentCommandBatchReceiptForSurface(
  candidate: unknown,
  surfaceVersion: 1,
): candidate is ProfileAgentCommandBatchReceiptV1
export function isProfileAgentCommandBatchReceiptForSurface(
  candidate: unknown,
  surfaceVersion: 2,
): candidate is ProfileAgentCommandBatchReceiptV2
export function isProfileAgentCommandBatchReceiptForSurface(
  candidate: unknown,
  surfaceVersion: 3,
): candidate is ProfileAgentCommandBatchReceiptV3
export function isProfileAgentCommandBatchReceiptForSurface(
  candidate: unknown,
  surfaceVersion: 4,
): candidate is ProfileAgentCommandBatchReceiptV4
export function isProfileAgentCommandBatchReceiptForSurface(
  candidate: unknown,
  surfaceVersion: 5,
): candidate is ProfileAgentCommandBatchReceiptV5
export function isProfileAgentCommandBatchReceiptForSurface(
  candidate: unknown,
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): candidate is ProfileAgentCommandBatchReceipt
export function isProfileAgentCommandBatchReceiptForSurface(
  candidate: unknown,
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): candidate is ProfileAgentCommandBatchReceipt {
  const surface = selectProfileAgentCommandSurface(surfaceVersion)
  if (!surface
    || !isRecord(candidate)
    || !hasExactKeys(candidate, surfaceVersion >= 2
      ? [
          'commandResults',
          'commitId',
          'dryRun',
          'effects',
          'intentEventIds',
          'kind',
          'previousRevision',
          'profileAgentEventIds',
          'proposedRevision',
          'replayed',
          'revision',
          'version',
        ]
      : [
          'commandResults',
          'commitId',
          'dryRun',
          'effects',
          'intentEventIds',
          'kind',
          'previousRevision',
          'proposedRevision',
          'replayed',
          'revision',
          'version',
        ])
    || candidate.kind !== 'agent-command-batch'
    || candidate.version !== surfaceVersion
    || !nonNegativeSafeInteger(candidate.previousRevision)
    || candidate.proposedRevision !== candidate.previousRevision + 1
    || !nonNegativeSafeInteger(candidate.revision)
    || typeof candidate.dryRun !== 'boolean'
    || typeof candidate.replayed !== 'boolean'
    || !Array.isArray(candidate.commandResults)
    || candidate.commandResults.length === 0
    || candidate.commandResults.length > PROFILE_AGENT_COMMAND_LIMITS.maxCommands
    || !candidate.commandResults.every((result) => (
      validCommandResult(result, surface.names, surfaceVersion)
    ))
    || !validEffects(candidate.effects, surfaceVersion)
    || !Array.isArray(candidate.intentEventIds)
    || candidate.intentEventIds.length > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxIntentEventIds
    || new Set(candidate.intentEventIds).size !== candidate.intentEventIds.length
    || !candidate.intentEventIds.every((id) => boundedNonEmptyString(id, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes))) {
    return false
  }
  let profileAgentEventIds: unknown[] | undefined
  if (surfaceVersion >= 2) {
    if (!Array.isArray(candidate.profileAgentEventIds)
      || candidate.profileAgentEventIds.length
        > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxProfileAgentEventIds
      || new Set(candidate.profileAgentEventIds).size !== candidate.profileAgentEventIds.length
      || !candidate.profileAgentEventIds.every((id) => (
        boundedNonEmptyString(id, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
      ))) {
      return false
    }
    profileAgentEventIds = candidate.profileAgentEventIds
  }
  if (candidate.dryRun) {
    if (candidate.revision !== candidate.previousRevision
      || candidate.commitId !== null
      || candidate.intentEventIds.length !== 0
      || (surfaceVersion >= 2 && profileAgentEventIds?.length !== 0)
      || candidate.replayed) return false
  } else if (
    candidate.revision !== candidate.proposedRevision
    || !boundedNonEmptyString(candidate.commitId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
  ) return false
  if (surfaceVersion >= 2 && !candidate.dryRun) {
    const effects = candidate.effects as ProfileAgentCommandEffectsSummaryV2
    if (effects.intentEvents !== candidate.intentEventIds.length
      || effects.profileAgentEvents !== profileAgentEventIds?.length) {
      return false
    }
  }
  try {
    return new TextEncoder().encode(JSON.stringify(candidate)).byteLength
      <= PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxReceiptBytes
  } catch {
    return false
  }
}

function validEffects(
  candidate: unknown,
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): candidate is ProfileAgentCommandEffectsSummary {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, surfaceVersion >= 2
      ? ['deleted', 'inserted', 'intentEvents', 'profileAgentEvents', 'updated']
      : ['deleted', 'inserted', 'intentEvents', 'updated'])
    || !nonNegativeSafeInteger(candidate.inserted)
    || !nonNegativeSafeInteger(candidate.updated)
    || !nonNegativeSafeInteger(candidate.deleted)
    || !nonNegativeSafeInteger(candidate.intentEvents)
    || candidate.intentEvents > PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxIntentEventIds) {
    return false
  }
  return surfaceVersion === 1
    || (nonNegativeSafeInteger(candidate.profileAgentEvents)
      && candidate.profileAgentEvents <= PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxProfileAgentEventIds)
}

function validCommandResult(
  candidate: unknown,
  allowedCommandNames: readonly ProfileAgentCommandName[],
  surfaceVersion: ProfileAgentCommandSurfaceVersion,
): candidate is ProfileAgentCommandResult {
  if (!isRecord(candidate)
    || !boundedNonEmptyString(candidate.commandId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
    || !allowedCommandNames.includes(candidate.name as ProfileAgentCommandName)) {
    return false
  }
  switch (candidate.name) {
    case 'idea.create':
      return surfaceVersion >= 4
        && hasExactKeys(candidate, [
          'boardId', 'commandId', 'ideaId', 'ideaName', 'name',
        ])
        && validId(candidate.ideaId)
        && candidate.boardId === `board:${candidate.ideaId}`
        && boundedNonEmptyString(candidate.ideaName, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes)
    case 'idea.activate':
      return surfaceVersion >= 5
        && hasExactKeys(candidate, [
          'activeIdeaId', 'commandId', 'name', 'previousActiveIdeaId',
        ])
        && validId(candidate.previousActiveIdeaId)
        && validId(candidate.activeIdeaId)
        && candidate.previousActiveIdeaId !== candidate.activeIdeaId
    case 'card.create':
      return hasExactKeys(candidate, surfaceVersion >= 3
        ? ['blockId', 'cardId', 'commandId', 'name', 'position']
        : ['blockId', 'cardId', 'commandId', 'name'])
        && validId(candidate.cardId) && validId(candidate.blockId)
        && (surfaceVersion < 3 || validPosition(candidate.position))
    case 'card.update-content':
      return hasExactKeys(candidate, ['blockId', 'cardId', 'commandId', 'name'])
        && validId(candidate.cardId) && validId(candidate.blockId)
    case 'card.delete':
      return hasExactKeys(candidate, ['cardId', 'commandId', 'name']) && validId(candidate.cardId)
    case 'connection.create':
      return hasExactKeys(candidate, [
        'commandId',
        'connectionIds',
        'name',
        'resultCardId',
        'resultCreated',
        'route',
      ])
        && (candidate.route === 'direct' || candidate.route === 'through-result')
        && Array.isArray(candidate.connectionIds)
        && candidate.connectionIds.length >= 1
        && candidate.connectionIds.length <= 2
        && candidate.connectionIds.every(validId)
        && typeof candidate.resultCreated === 'boolean'
        && (candidate.resultCardId === null || validId(candidate.resultCardId))
    case 'connection.update-meaning':
    case 'connection.delete':
      return hasExactKeys(candidate, ['commandId', 'connectionId', 'name'])
        && validId(candidate.connectionId)
    case 'ask.set-model':
      return surfaceVersion >= 5
        && hasExactKeys(candidate, ['cardId', 'commandId', 'model', 'name'])
        && validId(candidate.cardId)
        && boundedNonEmptyString(candidate.model, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes)
    case 'card.set-identity':
      return surfaceVersion >= 5
        && hasExactKeys(candidate, ['cardId', 'commandId', 'identity', 'name'])
        && validId(candidate.cardId)
        && validIdentityResult(candidate.identity)
    case 'cards.arrange':
      return surfaceVersion >= 5
        && hasExactKeys(candidate, ['cardIds', 'commandId', 'name'])
        && validIdList(candidate.cardIds)
    case 'cards.reorder-layer':
      return surfaceVersion >= 5
        && hasExactKeys(candidate, ['cardIds', 'commandId', 'direction', 'name'])
        && validIdList(candidate.cardIds)
        && (candidate.direction === 'front' || candidate.direction === 'back')
    case 'group.membership.set':
      return surfaceVersion >= 5
        && hasExactKeys(candidate, ['cardId', 'commandId', 'groupId', 'name'])
        && validId(candidate.cardId)
        && (candidate.groupId === null || validId(candidate.groupId))
    case 'output.choose-version':
      return surfaceVersion >= 5
        && hasExactKeys(candidate, ['commandId', 'name', 'outputId', 'versionId'])
        && validId(candidate.outputId)
        && validId(candidate.versionId)
    case 'output.set-accepted':
      return surfaceVersion >= 5
        && hasExactKeys(candidate, ['accepted', 'commandId', 'name', 'outputId', 'versionId'])
        && validId(candidate.outputId)
        && validId(candidate.versionId)
        && typeof candidate.accepted === 'boolean'
    case 'mod-template.create':
      return hasExactKeys(candidate, [
        'commandId', 'name', 'templateId', 'templateVersion',
      ])
        && validId(candidate.templateId)
        && positiveSafeInteger(candidate.templateVersion)
    case 'mod-template.update':
      return hasExactKeys(candidate, [
        'commandId', 'name', 'newTemplateVersion', 'previousTemplateVersion', 'templateId',
      ])
        && validId(candidate.templateId)
        && positiveSafeInteger(candidate.previousTemplateVersion)
        && positiveSafeInteger(candidate.newTemplateVersion)
        && candidate.newTemplateVersion === candidate.previousTemplateVersion + 1
    case 'mod-template.delete':
      return hasExactKeys(candidate, [
        'commandId', 'deletedTemplateVersion', 'name', 'templateId',
      ])
        && validId(candidate.templateId)
        && positiveSafeInteger(candidate.deletedTemplateVersion)
    case 'mod-instance.stamp':
      return hasExactKeys(candidate, [
        'blockId', 'cardId', 'commandId', 'idMap', 'instanceId', 'name', 'source',
      ])
        && validId(candidate.cardId)
        && validId(candidate.blockId)
        && validId(candidate.instanceId)
        && isRecord(candidate.source)
        && hasExactKeys(candidate.source, ['kind', 'templateId', 'templateVersion'])
        && candidate.source.kind === 'template'
        && validId(candidate.source.templateId)
        && positiveSafeInteger(candidate.source.templateVersion)
        && isRecord(candidate.idMap)
        && hasExactKeys(candidate.idMap, ['controls', 'mod'])
        && validIdMapEntry(candidate.idMap.mod)
        && Array.isArray(candidate.idMap.controls)
        && candidate.idMap.controls.every(validIdMapEntry)
    case 'mod-instance.create':
      return surfaceVersion >= 5
        && hasExactKeys(candidate, [
          'blockId', 'cardId', 'commandId', 'instanceId', 'name', 'source',
        ])
        && validId(candidate.blockId)
        && validId(candidate.cardId)
        && validId(candidate.instanceId)
        && isRecord(candidate.source)
        && hasExactKeys(candidate.source, ['kind'])
        && candidate.source.kind === 'direct'
    case 'mod-instance.configure':
    case 'mod-instance.delete':
      return surfaceVersion >= 5
        && hasExactKeys(candidate, ['cardId', 'commandId', 'instanceId', 'name'])
        && validId(candidate.cardId)
        && validId(candidate.instanceId)
    default:
      return false
  }
}

function validIdList(candidate: unknown): boolean {
  return Array.isArray(candidate)
    && candidate.length > 0
    && candidate.length <= 100
    && new Set(candidate).size === candidate.length
    && candidate.every(validId)
}

function validIdentityResult(candidate: unknown): boolean {
  if (candidate === null) return true
  return isRecord(candidate)
    && hasExactKeys(candidate, ['fill', 'preset'])
    && [
      'coral', 'red', 'amber', 'orange', 'mint', 'green',
      'sky', 'blue', 'orchid', 'purple', 'slate', 'charcoal',
    ].includes(String(candidate.preset))
    && (candidate.fill === 'soft' || candidate.fill === 'body' || candidate.fill === 'pattern')
}

function validIdMapEntry(candidate: unknown): boolean {
  return isRecord(candidate)
    && hasExactKeys(candidate, ['instanceId', 'sourceId'])
    && validId(candidate.instanceId)
    && validId(candidate.sourceId)
}

function validId(candidate: unknown): candidate is string {
  return boundedNonEmptyString(candidate, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
}

function validPosition(candidate: unknown): boolean {
  return isRecord(candidate)
    && hasExactKeys(candidate, ['x', 'y'])
    && finiteBoundedCoordinate(candidate.x)
    && finiteBoundedCoordinate(candidate.y)
}

function finiteBoundedCoordinate(candidate: unknown): candidate is number {
  return typeof candidate === 'number'
    && Number.isFinite(candidate)
    && !Object.is(candidate, -0)
    && Math.abs(candidate) <= PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate
}

function boundedNonEmptyString(candidate: unknown, maxBytes: number): candidate is string {
  return typeof candidate === 'string'
    && candidate.length > 0
    && new TextEncoder().encode(candidate).byteLength <= maxBytes
}

function nonNegativeSafeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && Number(candidate) >= 0
}

function positiveSafeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && Number(candidate) > 0
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  if (candidate === null || typeof candidate !== 'object' || Array.isArray(candidate)) return false
  const prototype = Object.getPrototypeOf(candidate)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(candidate).sort()
  const sorted = [...expected].sort()
  return keys.length === sorted.length && keys.every((key, index) => key === sorted[index])
}
