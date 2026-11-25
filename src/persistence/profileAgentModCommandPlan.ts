import { placeCreatedCard, reconcileGroupMembership } from '../graph/cardPlacement'
import type { Card, SavedBoard } from '../graph/types'
import { listModPartIdentities, type Mod } from '../mods'
import type {
  ProfileAgentCommandResult,
  ProfileAgentModCommand,
  ProfileAgentModCommandName,
} from './profileAgentCommandPlan'
import { isProfileBuiltInModTemplateId } from './profileBuiltInMods'
import type { ProfileLogicalRecordSpec } from './profileLogicalProjection'
import {
  createDirectProfileModInstance,
  createUserProfileModTemplate,
  deleteProfileModTemplate,
  stampProfileModTemplate,
  updateProfileModTemplate,
  updateProfileModTemplateWithinRevision,
  type ProfileModFailureCode,
} from './profileModRecords'
import {
  profileServiceFailure,
  type ProfileServiceErrorCode,
  type ProfileServiceResult,
  type ProfileSnapshot,
} from './profileServiceContract'

export type ProfileAgentModCommandDescriptor = Readonly<{
  name: ProfileAgentModCommandName
  payloadVersion: 1
  scope: 'profile' | 'idea'
  dryRun: true
  reads: readonly ProfileLogicalRecordSpec['kind'][]
  effects: readonly ProfileLogicalRecordSpec['kind'][]
}>

export const PROFILE_AGENT_MOD_COMMAND_DESCRIPTORS: Readonly<
  Record<ProfileAgentModCommandName, ProfileAgentModCommandDescriptor>
> = deepFreeze({
  'mod-template.create': {
    name: 'mod-template.create',
    payloadVersion: 1,
    scope: 'profile',
    dryRun: true,
    reads: [],
    effects: ['mod-template'],
  },
  'mod-template.update': {
    name: 'mod-template.update',
    payloadVersion: 1,
    scope: 'profile',
    dryRun: true,
    reads: ['mod-template'],
    effects: ['mod-template'],
  },
  'mod-template.delete': {
    name: 'mod-template.delete',
    payloadVersion: 1,
    scope: 'profile',
    dryRun: true,
    reads: ['mod-template'],
    effects: ['mod-template'],
  },
  'mod-instance.stamp': {
    name: 'mod-instance.stamp',
    payloadVersion: 1,
    scope: 'idea',
    dryRun: true,
    reads: ['mod-template'],
    effects: ['card', 'block', 'mod-instance'],
  },
  'mod-instance.create': {
    name: 'mod-instance.create',
    payloadVersion: 1,
    scope: 'idea',
    dryRun: true,
    reads: [],
    effects: ['card', 'block', 'mod-instance'],
  },
  'mod-instance.configure': {
    name: 'mod-instance.configure',
    payloadVersion: 1,
    scope: 'idea',
    dryRun: true,
    reads: ['card', 'mod-instance'],
    effects: ['card', 'mod-instance'],
  },
  'mod-instance.delete': {
    name: 'mod-instance.delete',
    payloadVersion: 1,
    scope: 'idea',
    dryRun: true,
    reads: ['card', 'mod-instance'],
    effects: ['card', 'block', 'connection', 'mod-instance'],
  },
})

type ProfileAgentLegacyModCommand = Exclude<
  ProfileAgentModCommand,
  { name: 'mod-instance.configure' | 'mod-instance.delete' }
>

export type ProfileAgentModCommandStep = Readonly<{
  result: ProfileAgentCommandResult
  placedCard?: Card
}>

export type ProfileAgentModCommandStepContext = Readonly<{
  snapshot: ProfileSnapshot
  board?: SavedBoard
  boardRecordId?: string
  profileId: string
  currentRevision: number
  committedAt: string
  stampedAt: string
  templateChangedInRevision: boolean
  isIdReserved: (id: string) => boolean
  reserveId: (id: string) => void
  derive: (
    purpose: 'card' | 'block' | 'mod-instance' | 'mod-control',
    source?: Readonly<{ sourceId: string; ordinal: number }>,
  ) => string | undefined
}>

/** Mutates only the synthetic working snapshot owned by the batch aggregator. */
export function planProfileAgentModCommandStep(
  command: ProfileAgentLegacyModCommand,
  context: ProfileAgentModCommandStepContext,
): ProfileServiceResult<ProfileAgentModCommandStep> {
  if (command.name === 'mod-template.create') {
    if (isProfileBuiltInModTemplateId(command.payload.templateId)) {
      return profileServiceFailure('capability-denied')
    }
    if (context.snapshot.modTemplates.some((template) => (
      template.recordId === command.payload.templateId
    ))) {
      return conflict(context.currentRevision)
    }
    if (context.isIdReserved(command.payload.templateId)) {
      return profileServiceFailure('invalid')
    }
    const created = createUserProfileModTemplate({
      profileId: context.profileId,
      templateId: command.payload.templateId,
      createdAt: context.committedAt,
      mod: command.payload.mod,
    })
    if (!created.ok) return modFailure(created.code)
    context.snapshot.modTemplates.push(created.value)
    reserveModDocument(context, created.value.recordId, created.value.payload.mod)
    return success({
      result: Object.freeze({
        commandId: command.id,
        name: command.name,
        templateId: created.value.recordId,
        templateVersion: created.value.payload.templateVersion,
      }),
    })
  }

  if (command.name === 'mod-instance.create') {
    if (!context.board || !context.boardRecordId) return profileServiceFailure('invalid')
    for (const { sourceId } of listModPartIdentities(command.payload.mod)) {
      if (context.isIdReserved(sourceId)) return profileServiceFailure('invalid')
    }
    const cardId = context.derive('card')
    const blockId = context.derive('block')
    const instanceId = context.derive('mod-instance', {
      sourceId: command.id,
      ordinal: 0,
    })
    if (!cardId || !blockId || !instanceId) {
      return profileServiceFailure('internal', { currentRevision: context.currentRevision })
    }
    const created = createDirectProfileModInstance({
      boardRecordId: context.boardRecordId,
      cardId,
      instanceId,
      createdAt: context.committedAt,
      mod: command.payload.mod,
    })
    if (!created.ok) return modFailure(created.code)
    const placedCard = placeCreatedCard(context.board.cards, {
      id: cardId,
      kind: 'mod',
      blocks: [{ id: blockId, text: '' }],
      position: { ...command.payload.position },
      modV2: cloneJson(created.value.payload.mod),
      ...(created.value.payload.mod.kind === 'radar' || created.value.payload.mod.kind === 'pad'
        ? { size: { width: 400, height: 350 } }
        : {}),
    })
    context.board.cards = reconcileGroupMembership([...context.board.cards, placedCard])
    context.snapshot.modInstances.push(created.value)
    reserveModDocument(context, created.value.recordId, created.value.payload.mod)
    return success({
      placedCard,
      result: Object.freeze({
        commandId: command.id,
        name: command.name,
        cardId,
        blockId,
        instanceId,
        source: created.value.payload.source,
      }),
    })
  }

  const templateIndex = context.snapshot.modTemplates.findIndex((template) => (
    template.recordId === command.payload.templateId
  ))
  const template = context.snapshot.modTemplates[templateIndex]
  if (!template) return profileServiceFailure('not-found')
  if (template.payload.templateVersion !== command.payload.expectedTemplateVersion) {
    return conflict(context.currentRevision)
  }

  if (command.name === 'mod-template.update') {
    const update = context.templateChangedInRevision
      ? updateProfileModTemplateWithinRevision
      : updateProfileModTemplate
    const updated = update(template, {
      updatedAt: context.committedAt,
      mod: command.payload.mod,
    })
    if (!updated.ok) return modFailure(updated.code)
    context.snapshot.modTemplates[templateIndex] = updated.value
    reserveModDocument(context, updated.value.recordId, updated.value.payload.mod)
    return success({
      result: Object.freeze({
        commandId: command.id,
        name: command.name,
        templateId: updated.value.recordId,
        previousTemplateVersion: template.payload.templateVersion,
        newTemplateVersion: updated.value.payload.templateVersion,
      }),
    })
  }

  if (command.name === 'mod-template.delete') {
    const deleted = deleteProfileModTemplate(template)
    if (!deleted.ok) return modFailure(deleted.code)
    context.snapshot.modTemplates.splice(templateIndex, 1)
    return success({
      result: Object.freeze({
        commandId: command.id,
        name: command.name,
        templateId: deleted.value.recordId,
        deletedTemplateVersion: deleted.value.expectedTemplateVersion,
      }),
    })
  }

  if (!context.board || !context.boardRecordId) return profileServiceFailure('invalid')
  const cardId = context.derive('card')
  const blockId = context.derive('block')
  const instanceId = context.derive('mod-instance', {
    sourceId: template.recordId,
    ordinal: 0,
  })
  const controlIds = listModPartIdentities(template.payload.mod).map(({ sourceId, ordinal }) => (
    context.derive('mod-control', { sourceId, ordinal })
  ))
  if (!cardId || !blockId || !instanceId || controlIds.some((id) => id === undefined)) {
    return profileServiceFailure('internal', { currentRevision: context.currentRevision })
  }
  const stamped = stampProfileModTemplate(template, {
    boardRecordId: context.boardRecordId,
    cardId,
    instanceId,
    controlIds: controlIds as string[],
    stampedAt: context.stampedAt,
  })
  if (!stamped.ok) return modFailure(stamped.code)
  const placedCard = placeCreatedCard(context.board.cards, {
    id: cardId,
    kind: 'mod',
    blocks: [{ id: blockId, text: '' }],
    position: { ...command.payload.position },
    modV2: cloneJson(stamped.value.payload.mod),
    ...(stamped.value.payload.mod.kind === 'radar' || stamped.value.payload.mod.kind === 'pad'
      ? { size: { width: 400, height: 350 } }
      : {}),
  })
  context.board.cards = reconcileGroupMembership([...context.board.cards, placedCard])
  context.snapshot.modInstances.push(stamped.value)
  return success({
    placedCard,
    result: Object.freeze({
      commandId: command.id,
      name: command.name,
      cardId,
      blockId,
      instanceId,
      source: stamped.value.payload.source,
      idMap: stamped.value.payload.idMap,
    }),
  })
}

function conflict(currentRevision: number) {
  return profileServiceFailure('conflict', { currentRevision })
}

function modFailure(code: ProfileModFailureCode) {
  return profileServiceFailure(mapModFailure(code))
}

function mapModFailure(code: ProfileModFailureCode): ProfileServiceErrorCode {
  switch (code) {
    case 'unsupported-future-version': return 'unsupported-future-version'
    case 'immutable-built-in': return 'capability-denied'
    case 'invalid': return 'invalid'
  }
}

function success(value: ProfileAgentModCommandStep): ProfileServiceResult<ProfileAgentModCommandStep> {
  return { ok: true, value: Object.freeze(value) }
}

function reserveModDocument(
  context: ProfileAgentModCommandStepContext,
  recordId: string,
  mod: Mod,
): void {
  context.reserveId(recordId)
  for (const { sourceId } of listModPartIdentities(mod)) context.reserveId(sourceId)
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object') return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}
