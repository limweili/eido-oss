import type { Card } from '../graph/types'
import type { ProfileLogicalRecordKind } from './profileServiceContract'

export const PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION = 5 as const

export const PROFILE_AGENT_COMMAND_SURFACE_VERSIONS = Object.freeze([1, 2, 3, 4, 5] as const)

export type ProfileAgentCommandSurfaceVersion =
  (typeof PROFILE_AGENT_COMMAND_SURFACE_VERSIONS)[number]

export const PROFILE_AGENT_COMMAND_LIMITS = Object.freeze({
  maxCommands: 64,
  maxRequestBytes: 256 * 1024,
  maxIdBytes: 512,
  maxCardAddressBytes: 4 * 1024,
  maxIdempotencyKeyBytes: 256,
  maxTextBytes: 128 * 1024,
  maxReasonBytes: 8 * 1024,
  maxAbsoluteCoordinate: 1_000_000,
  maxNearCards: 64,
  maxConversationTurns: 20,
  maxJsonDepth: 32,
  maxJsonNodes: 10_000,
})

export const PROFILE_AGENT_COMMAND_RESULT_LIMITS = Object.freeze({
  maxReceiptBytes: 256 * 1024,
  maxDurableChangeBytes: PROFILE_AGENT_COMMAND_LIMITS.maxRequestBytes * 16,
  maxIntentEventIds: PROFILE_AGENT_COMMAND_LIMITS.maxCommands * 3,
  maxProfileAgentEventIds: PROFILE_AGENT_COMMAND_LIMITS.maxCommands,
})

export const PROFILE_AGENT_CARD_CREATE_KINDS = Object.freeze([
  'note', 'askAi', 'title', 'group', 'conversation',
] as const satisfies readonly Card['kind'][])

export const PROFILE_AGENT_CARD_UPDATE_KINDS = PROFILE_AGENT_CARD_CREATE_KINDS

export const PROFILE_AGENT_CARD_DELETE_KINDS = Object.freeze([
  ...PROFILE_AGENT_CARD_CREATE_KINDS,
  'result',
] as const satisfies readonly Card['kind'][])

const PROFILE_AGENT_CARD_DELETE_EFFECTS = Object.freeze([
  'card',
  'block',
  'connection',
  'output',
  'output-version',
  'transcript-message',
  'follow-up-message',
  'logical-asset',
  'highlight',
  'mod-instance',
] as const satisfies readonly ProfileLogicalRecordKind[])

const PROFILE_AGENT_BOARD_COMMAND_INVENTORY = {
  'card.create': {
    supportedCardKinds: PROFILE_AGENT_CARD_CREATE_KINDS,
    effects: ['card', 'block'],
  },
  'card.update-content': {
    supportedCardKinds: PROFILE_AGENT_CARD_UPDATE_KINDS,
    effects: ['card', 'block'],
    conditionalEffects: true,
  },
  'card.delete': {
    supportedCardKinds: PROFILE_AGENT_CARD_DELETE_KINDS,
    effects: PROFILE_AGENT_CARD_DELETE_EFFECTS,
    conditionalEffects: true,
  },
  'connection.create': {
    supportedCardKinds: ['note', 'askAi', 'result', 'mod', 'group', 'conversation'],
    effects: ['card', 'block', 'connection'],
    conditionalEffects: true,
  },
  'connection.update-meaning': {
    supportedCardKinds: ['note', 'askAi', 'result', 'mod', 'group', 'conversation'],
    effects: ['connection'],
  },
  'connection.delete': {
    supportedCardKinds: ['note', 'askAi', 'result', 'mod', 'group', 'conversation'],
    effects: ['connection'],
  },
} as const satisfies Record<string, Readonly<{
  supportedCardKinds: readonly Card['kind'][]
  effects: readonly ProfileLogicalRecordKind[]
  conditionalEffects?: true
}>>

const PROFILE_AGENT_RESEARCH_COMMAND_INVENTORY = {
  'ask.set-model': {
    supportedCardKinds: ['askAi'],
    effects: ['card'],
  },
  'card.set-identity': {
    supportedCardKinds: ['note', 'askAi', 'result', 'mod', 'group', 'conversation'],
    effects: ['card', 'mod-instance'],
    conditionalEffects: true,
  },
  'cards.arrange': {
    supportedCardKinds: [
      'note', 'askAi', 'result', 'mod', 'title', 'group', 'conversation',
    ],
    effects: ['card'],
    conditionalEffects: true,
  },
  'cards.reorder-layer': {
    supportedCardKinds: [
      'note', 'askAi', 'result', 'mod', 'title', 'group', 'conversation',
    ],
    effects: ['card'],
    conditionalEffects: true,
  },
  'group.membership.set': {
    supportedCardKinds: ['note', 'askAi', 'result', 'mod', 'conversation'],
    effects: ['card'],
    conditionalEffects: true,
  },
  'output.choose-version': {
    supportedCardKinds: ['result'],
    effects: ['output'],
  },
  'output.set-accepted': {
    supportedCardKinds: ['result'],
    effects: ['output-version'],
  },
} as const satisfies Record<string, Readonly<{
  supportedCardKinds: readonly Card['kind'][]
  effects: readonly ProfileLogicalRecordKind[]
  conditionalEffects?: true
}>>

export type ProfileAgentResearchCommandName =
  keyof typeof PROFILE_AGENT_RESEARCH_COMMAND_INVENTORY

// Persisted surfaces v1/v2 retain the exact Board descriptor meaning they
// shipped with. V3 is a new admission surface rather than a reinterpretation
// of durable historical requests or receipts.
const PROFILE_AGENT_LEGACY_BOARD_COMMAND_INVENTORY = {
  'card.create': {
    supportedCardKinds: ['note', 'askAi'],
    effects: ['card', 'block'],
  },
  'card.update-content': {
    supportedCardKinds: ['note', 'askAi'],
    effects: ['block'],
  },
  'card.delete': {
    supportedCardKinds: ['note', 'askAi'],
    effects: PROFILE_AGENT_CARD_DELETE_EFFECTS,
    conditionalEffects: true,
  },
  'connection.create': {
    supportedCardKinds: ['note', 'askAi', 'result', 'mod', 'group', 'conversation'],
    effects: ['card', 'block', 'connection'],
    conditionalEffects: true,
  },
  'connection.update-meaning': PROFILE_AGENT_BOARD_COMMAND_INVENTORY['connection.update-meaning'],
  'connection.delete': PROFILE_AGENT_BOARD_COMMAND_INVENTORY['connection.delete'],
} as const satisfies Record<keyof typeof PROFILE_AGENT_BOARD_COMMAND_INVENTORY, Readonly<{
  supportedCardKinds: readonly Card['kind'][]
  effects: readonly ProfileLogicalRecordKind[]
  conditionalEffects?: true
}>>

export type ProfileAgentBoardCommandName = keyof typeof PROFILE_AGENT_BOARD_COMMAND_INVENTORY

const PROFILE_AGENT_MOD_COMMAND_INVENTORY = {
  'mod-template.create': { effects: ['mod-template'], profileAgentEventCount: 1 },
  'mod-template.update': { effects: ['mod-template'], profileAgentEventCount: 1 },
  'mod-template.delete': { effects: ['mod-template'], profileAgentEventCount: 1 },
  'mod-instance.stamp': {
    effects: ['card', 'block', 'mod-instance'],
    profileAgentEventCount: 0,
  },
  'mod-instance.create': {
    effects: ['card', 'block', 'mod-instance'],
    profileAgentEventCount: 0,
  },
  'mod-instance.configure': {
    effects: ['card', 'mod-instance'],
    profileAgentEventCount: 0,
  },
  'mod-instance.delete': {
    effects: ['card', 'block', 'connection', 'mod-instance'],
    profileAgentEventCount: 0,
  },
} as const satisfies Record<string, Readonly<{
  effects: readonly ProfileLogicalRecordKind[]
  profileAgentEventCount: 0 | 1
}>>

export type ProfileAgentModCommandName = keyof typeof PROFILE_AGENT_MOD_COMMAND_INVENTORY

const PROFILE_AGENT_IDEA_COMMAND_INVENTORY = {
  'idea.create': { effects: ['idea', 'board'], profileAgentEventCount: 1 },
  'idea.activate': { effects: ['idea'], profileAgentEventCount: 1 },
} as const satisfies Record<string, Readonly<{
  effects: readonly ProfileLogicalRecordKind[]
  profileAgentEventCount: 1
}>>

export type ProfileAgentIdeaCommandName = keyof typeof PROFILE_AGENT_IDEA_COMMAND_INVENTORY
export type ProfileAgentCommandName =
  | ProfileAgentBoardCommandName
  | ProfileAgentResearchCommandName
  | ProfileAgentModCommandName
  | ProfileAgentIdeaCommandName

export const PROFILE_AGENT_MOD_COMMAND_NAMES = Object.freeze(
  Object.keys(PROFILE_AGENT_MOD_COMMAND_INVENTORY) as ProfileAgentModCommandName[],
)

const PROFILE_AGENT_V3_MOD_COMMAND_NAMES = Object.freeze([
  'mod-template.create',
  'mod-template.update',
  'mod-template.delete',
  'mod-instance.stamp',
] as const satisfies readonly ProfileAgentModCommandName[])

export const PROFILE_AGENT_IDEA_COMMAND_NAMES = Object.freeze(
  Object.keys(PROFILE_AGENT_IDEA_COMMAND_INVENTORY) as ProfileAgentIdeaCommandName[],
)

export type ProfileAgentCommandDescriptor = Readonly<{
  name: ProfileAgentCommandName
  payloadVersion: 1
  dryRun: true
  supportedCardKinds?: readonly Card['kind'][]
  effects: readonly ProfileLogicalRecordKind[]
  conditionalEffects?: true
  profileAgentEventCount: 0 | 1
}>

export const PROFILE_AGENT_BOARD_COMMAND_NAMES = Object.freeze(
  Object.keys(PROFILE_AGENT_BOARD_COMMAND_INVENTORY) as ProfileAgentBoardCommandName[],
)

export const PROFILE_AGENT_RESEARCH_COMMAND_NAMES = Object.freeze(
  Object.keys(PROFILE_AGENT_RESEARCH_COMMAND_INVENTORY) as ProfileAgentResearchCommandName[],
)

const PROFILE_AGENT_RESEARCH_COMMAND_DESCRIPTORS: Readonly<
  Record<ProfileAgentResearchCommandName, ProfileAgentCommandDescriptor>
> = Object.freeze(Object.fromEntries(PROFILE_AGENT_RESEARCH_COMMAND_NAMES.map((name) => {
  const inventory = PROFILE_AGENT_RESEARCH_COMMAND_INVENTORY[name]
  return [name, Object.freeze({
    name,
    payloadVersion: 1 as const,
    dryRun: true as const,
    supportedCardKinds: Object.freeze([...inventory.supportedCardKinds]),
    effects: Object.freeze([...inventory.effects]),
    profileAgentEventCount: 0 as const,
    ...('conditionalEffects' in inventory && inventory.conditionalEffects
      ? { conditionalEffects: true as const }
      : {}),
  })]
})) as Record<ProfileAgentResearchCommandName, ProfileAgentCommandDescriptor>)

export const PROFILE_AGENT_BOARD_COMMAND_DESCRIPTORS: Readonly<
  Record<ProfileAgentBoardCommandName, ProfileAgentCommandDescriptor>
> = Object.freeze(Object.fromEntries(PROFILE_AGENT_BOARD_COMMAND_NAMES.map((name) => {
  const inventory = PROFILE_AGENT_BOARD_COMMAND_INVENTORY[name]
  return [name, Object.freeze({
    name,
    payloadVersion: 1 as const,
    dryRun: true as const,
    supportedCardKinds: Object.freeze([...inventory.supportedCardKinds]),
    effects: Object.freeze([...inventory.effects]),
    profileAgentEventCount: 0 as const,
    ...('conditionalEffects' in inventory && inventory.conditionalEffects
      ? { conditionalEffects: true as const }
      : {}),
  })]
})) as Record<ProfileAgentBoardCommandName, ProfileAgentCommandDescriptor>)

export type ProfileAgentCommandCapabilityDescriptor = Readonly<{
  name: ProfileAgentCommandName
  version: ProfileAgentCommandSurfaceVersion
  payloadVersion: 1
  supportedCardKinds?: readonly Card['kind'][]
  effects: readonly ProfileLogicalRecordKind[]
  conditionalEffects: boolean
}>

export type ProfileAgentCommandBatchCapability = Readonly<{
  version: ProfileAgentCommandSurfaceVersion
  limits: Readonly<{
    maxCommands: number
    maxRequestBytes: number
    maxAbsoluteCoordinate: number
    maxDurableChangeBytes: number
  }>
  descriptors: readonly ProfileAgentCommandCapabilityDescriptor[]
}>

export type ProfileAgentCommandSurface = Readonly<{
  version: ProfileAgentCommandSurfaceVersion
  names: readonly ProfileAgentCommandName[]
  capability: ProfileAgentCommandBatchCapability
}>

const PROFILE_AGENT_MOD_COMMAND_DESCRIPTORS: Readonly<
  Record<ProfileAgentModCommandName, ProfileAgentCommandDescriptor>
> = Object.freeze(Object.fromEntries(PROFILE_AGENT_MOD_COMMAND_NAMES.map((name) => [
  name,
  Object.freeze({
    name,
    payloadVersion: 1 as const,
    dryRun: true as const,
    effects: Object.freeze([...PROFILE_AGENT_MOD_COMMAND_INVENTORY[name].effects]),
    profileAgentEventCount: PROFILE_AGENT_MOD_COMMAND_INVENTORY[name].profileAgentEventCount,
  }),
])) as Record<ProfileAgentModCommandName, ProfileAgentCommandDescriptor>)

const PROFILE_AGENT_IDEA_COMMAND_DESCRIPTORS: Readonly<
  Record<ProfileAgentIdeaCommandName, ProfileAgentCommandDescriptor>
> = Object.freeze(Object.fromEntries(PROFILE_AGENT_IDEA_COMMAND_NAMES.map((name) => [
  name,
  Object.freeze({
    name,
    payloadVersion: 1 as const,
    dryRun: true as const,
    effects: Object.freeze([...PROFILE_AGENT_IDEA_COMMAND_INVENTORY[name].effects]),
    profileAgentEventCount: PROFILE_AGENT_IDEA_COMMAND_INVENTORY[name].profileAgentEventCount,
  }),
])) as Record<ProfileAgentIdeaCommandName, ProfileAgentCommandDescriptor>)

export const PROFILE_AGENT_COMMAND_DESCRIPTORS: Readonly<
  Record<ProfileAgentCommandName, ProfileAgentCommandDescriptor>
> = Object.freeze({
  ...PROFILE_AGENT_BOARD_COMMAND_DESCRIPTORS,
  ...PROFILE_AGENT_RESEARCH_COMMAND_DESCRIPTORS,
  ...PROFILE_AGENT_MOD_COMMAND_DESCRIPTORS,
  ...PROFILE_AGENT_IDEA_COMMAND_DESCRIPTORS,
})

const PROFILE_AGENT_V3_COMMAND_NAMES = Object.freeze([
  ...PROFILE_AGENT_BOARD_COMMAND_NAMES,
  ...PROFILE_AGENT_V3_MOD_COMMAND_NAMES,
] as const)

const PROFILE_AGENT_V4_COMMAND_NAMES = Object.freeze([
  ...PROFILE_AGENT_V3_COMMAND_NAMES,
  'idea.create' as const,
] as const)

export const PROFILE_AGENT_COMMAND_NAMES = Object.freeze([
  ...PROFILE_AGENT_V4_COMMAND_NAMES,
  ...PROFILE_AGENT_RESEARCH_COMMAND_NAMES,
  'mod-instance.create' as const,
  'mod-instance.configure' as const,
  'mod-instance.delete' as const,
  'idea.activate' as const,
] as const)

function createProfileAgentCommandSurface(
  version: ProfileAgentCommandSurfaceVersion,
  names: readonly ProfileAgentCommandName[],
): ProfileAgentCommandSurface {
  const frozenNames = Object.freeze([...names])
  const capability: ProfileAgentCommandBatchCapability = Object.freeze({
    version,
    limits: Object.freeze({
      maxCommands: PROFILE_AGENT_COMMAND_LIMITS.maxCommands,
      maxRequestBytes: PROFILE_AGENT_COMMAND_LIMITS.maxRequestBytes,
      maxAbsoluteCoordinate: PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate,
      maxDurableChangeBytes: PROFILE_AGENT_COMMAND_RESULT_LIMITS.maxDurableChangeBytes,
    }),
    descriptors: Object.freeze(frozenNames.map((name) => {
      const baseDescriptor = PROFILE_AGENT_COMMAND_DESCRIPTORS[name]
      const surfaceMeaning = version < 3 && name in PROFILE_AGENT_LEGACY_BOARD_COMMAND_INVENTORY
        ? PROFILE_AGENT_LEGACY_BOARD_COMMAND_INVENTORY[
            name as keyof typeof PROFILE_AGENT_LEGACY_BOARD_COMMAND_INVENTORY
          ]
        : baseDescriptor
      return Object.freeze({
        name: baseDescriptor.name,
        version,
        payloadVersion: baseDescriptor.payloadVersion,
        ...(version < 3 || !('supportedCardKinds' in surfaceMeaning)
          ? {}
          : { supportedCardKinds: surfaceMeaning.supportedCardKinds }),
        effects: surfaceMeaning.effects,
        conditionalEffects: 'conditionalEffects' in surfaceMeaning
          && surfaceMeaning.conditionalEffects === true,
      })
    })),
  })
  return Object.freeze({ version, names: frozenNames, capability })
}

const PROFILE_AGENT_COMMAND_SURFACES: Readonly<
  Record<ProfileAgentCommandSurfaceVersion, ProfileAgentCommandSurface>
> = Object.freeze({
  1: createProfileAgentCommandSurface(1, PROFILE_AGENT_BOARD_COMMAND_NAMES),
  2: createProfileAgentCommandSurface(2, PROFILE_AGENT_V3_COMMAND_NAMES),
  3: createProfileAgentCommandSurface(3, PROFILE_AGENT_V3_COMMAND_NAMES),
  4: createProfileAgentCommandSurface(4, PROFILE_AGENT_V4_COMMAND_NAMES),
  5: createProfileAgentCommandSurface(5, PROFILE_AGENT_COMMAND_NAMES),
})

export function selectProfileAgentCommandSurface(
  candidate: unknown,
): ProfileAgentCommandSurface | undefined {
  return candidate === 1 || candidate === 2 || candidate === 3 || candidate === 4
    || candidate === 5
    ? PROFILE_AGENT_COMMAND_SURFACES[candidate]
    : undefined
}

const INSTALLED_PROFILE_AGENT_COMMAND_SURFACE =
  PROFILE_AGENT_COMMAND_SURFACES[PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION]

export const INSTALLED_PROFILE_AGENT_COMMAND_NAMES =
  INSTALLED_PROFILE_AGENT_COMMAND_SURFACE.names

export const INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY =
  INSTALLED_PROFILE_AGENT_COMMAND_SURFACE.capability

// Raw compatibility keeps all 22 installed commands, including the native Mod
// lifecycle. Agent command-batch discovery stays narrower: Mod work is taught
// and adapted by the ergonomic CLI verbs, never as raw command JSON.
export const INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES = Object.freeze([
  ...PROFILE_AGENT_BOARD_COMMAND_NAMES,
  ...PROFILE_AGENT_RESEARCH_COMMAND_NAMES,
  'idea.create' as const,
  'idea.activate' as const,
] as const satisfies readonly ProfileAgentCommandName[])

export const INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_CAPABILITY =
  createProfileAgentCommandSurface(
    PROFILE_AGENT_COMMAND_BATCH_CAPABILITY_VERSION,
    INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES,
  ).capability
