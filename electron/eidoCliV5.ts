import { cardIdentityPresetSolid } from '../src/graph/cardIdentityPresets'
import { listModPartIdentities, type Mod, type ModPartIdFactory } from '../src/mods'
import {
  configureModFromErgonomicSpec,
  createModFromErgonomicSpec,
  inspectErgonomicMod,
} from '../src/mods/ergonomic'
import type {
  ProfileGatewayRequest,
  ProfileGatewayResponse,
} from '../src/persistence/profileAgentGateway'
import { PROFILE_AGENT_COMMAND_LIMITS } from '../src/persistence/profileAgentCommandManifest'
import type { ProfileJsonValue, ProfileQueryItem } from '../src/persistence/profileServiceContract'
import { parseCardDeepLink } from '../src/shared/deepLinks'
import { deriveEidoCliIdempotencyKey } from './eidoCliMutationKey'

export type EidoCliV5Plan =
  | Readonly<{
      kind: 'invoke'
      pretty: boolean
      request: ProfileGatewayRequest
    }>
  | EidoCliModInspectPlan
  | EidoCliModConfigurePlan

export type EidoCliModInspectPlan = Readonly<{
  kind: 'mod-inspect'
  pretty: boolean
  request: ProfileGatewayRequest
  target:
    | Readonly<{ kind: 'instance'; cardId: string }>
    | Readonly<{ kind: 'template'; templateId: string }>
}>

export type EidoCliModConfigurePlan = Readonly<{
  kind: 'mod-configure'
  pretty: boolean
  request: ProfileGatewayRequest
  spec: unknown
  target:
    | Readonly<{ kind: 'instance'; ideaId: string; cardId: string }>
    | Readonly<{
        kind: 'template'
        templateId: string
        expectedTemplateVersion: number
      }>
  mutation: MutationIdentity
}>

export type EidoCliV5PlanResult =
  | Readonly<{ ok: true; plan: EidoCliV5Plan }>
  | Readonly<{ ok: false }>

type NamedArguments = Readonly<{
  values: Readonly<Record<string, string>>
  switches: ReadonlySet<string>
}>

type MutationIdentity = Readonly<{
  requestId: string
  expectedRevision: number
  idempotencyKey: string
  commandId: string
  dryRun: boolean
}>

type Command = Readonly<{
  version: 1
  id: string
  name: string
  payload: Readonly<Record<string, ProfileJsonValue>>
}>

const MUTATION_VALUE_OPTIONS = [
  '--expected-revision',
  '--request-id',
  '--idempotency-key',
  '--command-id',
] as const

const MUTATION_SWITCH_OPTIONS = ['--dry-run', '--apply'] as const

/** Returns undefined only when argv belongs to the older CLI planner. */
export function planEidoCliV5(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult | undefined {
  try {
    if (argv[0] === 'ask' && argv[1] === 'model') {
      return planAskModel(argv, pretty, createIdentity)
    }
    if (argv[0] === 'card' && argv[1] === 'identity') {
      return planCardIdentity(argv, pretty, createIdentity)
    }
    if (argv[0] === 'cards') return planCards(argv, pretty, createIdentity)
    if (argv[0] === 'group' && (argv[1] === 'add' || argv[1] === 'remove')) {
      return planGroupMembership(argv, pretty, createIdentity)
    }
    if (argv[0] === 'result'
      && (argv[1] === 'choose' || argv[1] === 'accept' || argv[1] === 'unaccept')) {
      return planResultMutation(argv, pretty, createIdentity)
    }
    if (argv[0] === 'mod') return planMod(argv, pretty, createIdentity)
    return undefined
  } catch {
    return { ok: false }
  }
}

export function projectEidoCliModInspection(
  plan: EidoCliModInspectPlan,
  response: ProfileGatewayResponse,
): unknown | undefined {
  const found = readMod(plan.target, response)
  if (!found) return undefined
  try {
    const inspected = inspectErgonomicMod(found.mod)
    const { context, ...spec } = inspected
    return Object.freeze({
      version: 1 as const,
      profileId: found.profileId,
      revision: found.revision,
      target: plan.target.kind === 'instance'
        ? Object.freeze({
            kind: 'instance' as const,
            cardId: plan.target.cardId,
            instanceId: found.item.recordId,
            source: cloneJson((found.item.payload as Record<string, unknown>).source),
          })
        : Object.freeze({
            kind: 'template' as const,
            templateId: plan.target.templateId,
            templateVersion: (found.item.payload as Record<string, unknown>).templateVersion,
          }),
      spec: Object.freeze(spec),
      context: Object.freeze(context),
    })
  } catch {
    return undefined
  }
}

export function completeEidoCliModConfigure(
  plan: EidoCliModConfigurePlan,
  response: ProfileGatewayResponse,
): ProfileGatewayRequest | undefined {
  const found = readMod(plan.target, response)
  if (!found) return undefined
  try {
    const createId = partIdFactory(plan.mutation.commandId, plan.spec)
    let mod: Mod
    try {
      mod = configureModFromErgonomicSpec(found.mod, plan.spec, createId)
    } catch (error) {
      const replaySpec = exactConfigureReplaySpec(found.mod, plan.spec, createId)
      if (replaySpec === undefined) throw error
      mod = configureModFromErgonomicSpec(found.mod, replaySpec, createId)
    }
    const command = plan.target.kind === 'instance'
      ? makeCommand(plan.mutation.commandId, 'mod-instance.configure', {
          ideaId: plan.target.ideaId,
          cardId: plan.target.cardId,
          mod: asJson(mod),
        })
      : makeCommand(plan.mutation.commandId, 'mod-template.update', {
          templateId: plan.target.templateId,
          expectedTemplateVersion: plan.target.expectedTemplateVersion,
          mod: asJson(mod),
        })
    return commandBatchRequest(plan.mutation, [command])
  } catch {
    return undefined
  }
}

function planAskModel(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  const card = argv[2]
  if (!card) return invalid()
  const args = parseNamedArguments(argv.slice(3), {
    values: ['--idea', '--model', ...MUTATION_VALUE_OPTIONS],
    switches: MUTATION_SWITCH_OPTIONS,
  })
  const address = args && resolveCardAddress(card, args.values['--idea'])
  const model = args?.values['--model']
  if (!args || !address || !boundedString(model, PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes)) {
    return invalid()
  }
  return mutationPlan(args, pretty, createIdentity, argv, (mutation) => [
    makeCommand(mutation.commandId, 'ask.set-model', {
      ideaId: address.ideaId,
      card: { cardId: address.cardId },
      model,
    }),
  ])
}

function planCardIdentity(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  const card = argv[2]
  if (!card) return invalid()
  const args = parseNamedArguments(argv.slice(3), {
    values: ['--idea', '--identity', '--fill', ...MUTATION_VALUE_OPTIONS],
    switches: ['--clear', ...MUTATION_SWITCH_OPTIONS],
  })
  if (!args) return invalid()
  const address = resolveCardAddress(card, args.values['--idea'])
  const clear = args.switches.has('--clear')
  const preset = args.values['--identity']
  const fill = args.values['--fill']
  if (!address
    || (clear && (preset !== undefined || fill !== undefined))
    || (!clear && (!preset || cardIdentityPresetSolid(preset) === undefined
      || (fill !== 'soft' && fill !== 'body' && fill !== 'pattern')))) return invalid()
  return mutationPlan(args, pretty, createIdentity, argv, (mutation) => [
    makeCommand(mutation.commandId, 'card.set-identity', {
      ideaId: address.ideaId,
      card: { cardId: address.cardId },
      identity: clear ? null : { preset: preset!, fill: fill! },
    }),
  ])
}

function planCards(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  if (argv[1] === 'arrange') {
    const args = parseNamedArguments(argv.slice(2), {
      values: ['--idea', '--frames', ...MUTATION_VALUE_OPTIONS],
      switches: MUTATION_SWITCH_OPTIONS,
    })
    if (!args) return invalid()
    const frames = parseFrames(args.values['--frames'], args.values['--idea'])
    if (!frames) return invalid()
    return mutationPlan(args, pretty, createIdentity, argv, (mutation) => [
      makeCommand(mutation.commandId, 'cards.arrange', {
        ideaId: frames.ideaId,
        frames: asJson(frames.frames),
      }),
    ])
  }
  if (argv[1] !== 'layer' || (argv[2] !== 'front' && argv[2] !== 'back')) return invalid()
  const split = splitPositionals(argv.slice(3))
  if (split.positionals.length === 0 || split.positionals.length > 100) return invalid()
  const args = parseNamedArguments(split.options, {
    values: ['--idea', ...MUTATION_VALUE_OPTIONS],
    switches: MUTATION_SWITCH_OPTIONS,
  })
  const addresses = args && resolveCardSet(split.positionals, args.values['--idea'])
  if (!args || !addresses) return invalid()
  return mutationPlan(args, pretty, createIdentity, argv, (mutation) => [
    makeCommand(mutation.commandId, 'cards.reorder-layer', {
      ideaId: addresses.ideaId,
      cards: addresses.cardIds.map(cardId => ({ cardId })),
      direction: argv[2]!,
    }),
  ])
}

function planGroupMembership(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  const add = argv[1] === 'add'
  const split = splitPositionals(argv.slice(2))
  const group = add ? split.positionals[0] : undefined
  const members = add ? split.positionals.slice(1) : split.positionals
  if ((add && !group)
    || members.length === 0
    || members.length > PROFILE_AGENT_COMMAND_LIMITS.maxCommands) return invalid()
  const args = parseNamedArguments(split.options, {
    values: ['--idea', ...MUTATION_VALUE_OPTIONS],
    switches: MUTATION_SWITCH_OPTIONS,
  })
  const resolved = args && resolveCardSet(
    add ? [group!, ...members] : members,
    args.values['--idea'],
  )
  if (!args || !resolved) return invalid()
  const groupId = add ? resolved.cardIds[0]! : undefined
  const memberIds = add ? resolved.cardIds.slice(1) : resolved.cardIds
  return mutationPlan(args, pretty, createIdentity, argv, (mutation) => (
    memberIds.map((cardId, index) => makeCommand(
      indexedCommandId(mutation.commandId, index),
      'group.membership.set',
      {
        ideaId: resolved.ideaId,
        card: { cardId },
        group: groupId === undefined ? null : { cardId: groupId },
      },
    ))
  ))
}

function planResultMutation(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  const outputId = plainId(argv[2])
  const args = parseNamedArguments(argv.slice(3), {
    values: ['--idea', '--version', ...MUTATION_VALUE_OPTIONS],
    switches: MUTATION_SWITCH_OPTIONS,
  })
  const ideaId = args ? addressId(args.values['--idea'], 'idea') : undefined
  const versionId = args ? plainId(args.values['--version']) : undefined
  if (!args || !ideaId || !outputId || !versionId) return invalid()
  const choose = argv[1] === 'choose'
  return mutationPlan(args, pretty, createIdentity, argv, (mutation) => [
    makeCommand(
      mutation.commandId,
      choose ? 'output.choose-version' : 'output.set-accepted',
      choose
        ? { ideaId, outputId, versionId }
        : { ideaId, outputId, versionId, accepted: argv[1] === 'accept' },
    ),
  ])
}

function planMod(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  if (argv[1] === 'template') return planModTemplate(argv, pretty, createIdentity)
  if (argv[1] === 'inspect') return planModInspect(argv, pretty, createIdentity)
  if (argv[1] === 'configure') return planModConfigure(argv, pretty, createIdentity)
  if (argv[1] === 'create') return planModCreate(argv, pretty, createIdentity)
  if (argv[1] === 'delete') return planModDelete(argv, pretty, createIdentity)
  if (argv[1] === 'connect') return planModConnect(argv, pretty, createIdentity)
  if (argv[1] === 'stamp') return planModStamp(argv, pretty, createIdentity)
  return invalid()
}

function planModInspect(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  const card = argv[2]
  const args = parseNamedArguments(argv.slice(3), { values: ['--idea'], switches: [] })
  const address = card && args ? resolveCardAddress(card, args.values['--idea']) : null
  if (!address) return invalid()
  return {
    ok: true,
    plan: {
      kind: 'mod-inspect',
      pretty,
      target: { kind: 'instance', cardId: address.cardId },
      request: gatewayRequest(createIdentity(), 'graph.query', {
        recordKinds: ['mod-instance'],
        parentIds: [address.cardId],
        limit: 2,
      }),
    },
  }
}

function planModConfigure(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  const card = argv[2]
  const args = parseNamedArguments(argv.slice(3), {
    values: ['--idea', '--spec', ...MUTATION_VALUE_OPTIONS],
    switches: MUTATION_SWITCH_OPTIONS,
  })
  const address = card && args ? resolveCardAddress(card, args.values['--idea']) : null
  const spec = args ? parseJson(args.values['--spec']) : undefined
  const mutation = args ? mutationIdentity(args, createIdentity, argv) : null
  if (!address || spec === undefined || !mutation) return invalid()
  return {
    ok: true,
    plan: {
      kind: 'mod-configure',
      pretty,
      target: { kind: 'instance', ideaId: address.ideaId, cardId: address.cardId },
      request: gatewayRequest(createIdentity(), 'graph.query', {
        recordKinds: ['mod-instance'],
        parentIds: [address.cardId],
        limit: 2,
      }),
      spec,
      mutation,
    },
  }
}

function planModCreate(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  const args = parseNamedArguments(argv.slice(2), {
    values: [
      '--idea', '--spec', '--x', '--y', '--connect-to', '--strength',
      ...MUTATION_VALUE_OPTIONS,
    ],
    switches: MUTATION_SWITCH_OPTIONS,
  })
  if (!args) return invalid()
  const ideaId = addressId(args.values['--idea'], 'idea')
  const x = finiteNumber(args.values['--x'])
  const y = finiteNumber(args.values['--y'])
  const spec = parseJson(args.values['--spec'])
  const strength = args.values['--strength'] ?? 'strong'
  const connectTo = args.values['--connect-to']
  const target = connectTo === undefined ? undefined : resolveCardAddress(connectTo, ideaId)
  if (!ideaId || !boundedCoordinate(x) || !boundedCoordinate(y) || spec === undefined
    || (strength !== 'strong' && strength !== 'weak')
    || (connectTo !== undefined && !target)) return invalid()
  return mutationPlan(args, pretty, createIdentity, argv, (mutation) => {
    const mod = createModFromErgonomicSpec(
      spec,
      partIdFactory(mutation.commandId, spec),
    )
    return [
      makeCommand(mutation.commandId, 'mod-instance.create', {
        ideaId,
        mod: asJson(mod),
        position: { x, y },
      }),
      ...(target === undefined ? [] : [makeCommand(
        `${mutation.commandId}:connect`,
        'connection.create',
        {
          ideaId,
          from: { createdByCommandId: mutation.commandId },
          to: { cardId: target!.cardId },
          strength,
          polarity: 'helps',
        },
      )]),
    ]
  })
}

function planModDelete(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  const card = argv[2]
  const args = parseNamedArguments(argv.slice(3), {
    values: ['--idea', ...MUTATION_VALUE_OPTIONS],
    switches: MUTATION_SWITCH_OPTIONS,
  })
  const address = card && args ? resolveCardAddress(card, args.values['--idea']) : null
  if (!address || !args) return invalid()
  return mutationPlan(args, pretty, createIdentity, argv, (mutation) => [
    makeCommand(mutation.commandId, 'mod-instance.delete', {
      ideaId: address.ideaId,
      cardId: address.cardId,
    }),
  ])
}

function planModConnect(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  const from = argv[2]
  const to = argv[3]
  const args = parseNamedArguments(argv.slice(4), {
    values: ['--idea', '--strength', ...MUTATION_VALUE_OPTIONS],
    switches: MUTATION_SWITCH_OPTIONS,
  })
  const addresses = from && to && args
    ? resolveConnectionAddresses(from, to, args.values['--idea'])
    : null
  const strength = args?.values['--strength'] ?? 'strong'
  if (!args || !addresses || (strength !== 'strong' && strength !== 'weak')) return invalid()
  return mutationPlan(args, pretty, createIdentity, argv, (mutation) => [
    makeCommand(mutation.commandId, 'connection.create', {
      ideaId: addresses.ideaId,
      from: { cardId: addresses.fromCardId },
      to: { cardId: addresses.toCardId },
      strength,
      polarity: 'helps',
    }),
  ])
}

function planModStamp(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  const templateId = plainId(argv[2])
  const args = parseNamedArguments(argv.slice(3), {
    values: [
      '--template-version', '--idea', '--x', '--y', '--connect-to', '--strength',
      ...MUTATION_VALUE_OPTIONS,
    ],
    switches: MUTATION_SWITCH_OPTIONS,
  })
  if (!args) return invalid()
  const expectedTemplateVersion = positiveInteger(args.values['--template-version'])
  const ideaId = addressId(args.values['--idea'], 'idea')
  const x = finiteNumber(args.values['--x'])
  const y = finiteNumber(args.values['--y'])
  const strength = args.values['--strength'] ?? 'strong'
  const connectTo = args.values['--connect-to']
  const target = connectTo === undefined ? undefined : resolveCardAddress(connectTo, ideaId)
  if (!templateId || !expectedTemplateVersion || !ideaId
    || !boundedCoordinate(x) || !boundedCoordinate(y)
    || (strength !== 'strong' && strength !== 'weak')
    || (connectTo !== undefined && !target)) return invalid()
  return mutationPlan(args, pretty, createIdentity, argv, (mutation) => [
    makeCommand(mutation.commandId, 'mod-instance.stamp', {
      ideaId,
      templateId,
      expectedTemplateVersion,
      position: { x, y },
    }),
    ...(target === undefined ? [] : [makeCommand(
      `${mutation.commandId}:connect`,
      'connection.create',
      {
        ideaId,
        from: { createdByCommandId: mutation.commandId },
        to: { cardId: target!.cardId },
        strength,
        polarity: 'helps',
      },
    )]),
  ])
}

function planModTemplate(
  argv: readonly string[],
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  if (argv[2] === 'list') {
    const params = parseListOptions(argv.slice(3))
    return params === null
      ? invalid()
      : invoke('mod-template.list', params, pretty, createIdentity)
  }
  if (argv[2] === 'inspect') {
    const templateId = plainId(argv[3])
    if (!templateId || argv.length !== 4) return invalid()
    return {
      ok: true,
      plan: {
        kind: 'mod-inspect',
        pretty,
        target: { kind: 'template', templateId },
        request: gatewayRequest(createIdentity(), 'record.get', { recordId: templateId }),
      },
    }
  }
  const templateId = plainId(argv[3])
  if (!templateId) return invalid()
  if (argv[2] === 'create') {
    const args = parseNamedArguments(argv.slice(4), {
      values: ['--spec', ...MUTATION_VALUE_OPTIONS],
      switches: MUTATION_SWITCH_OPTIONS,
    })
    const spec = args ? parseJson(args.values['--spec']) : undefined
    if (!args || spec === undefined) return invalid()
    return mutationPlan(args, pretty, createIdentity, argv, (mutation) => {
      const mod = createModFromErgonomicSpec(
        spec,
        partIdFactory(mutation.commandId, spec),
      )
      return [makeCommand(mutation.commandId, 'mod-template.create', {
        templateId,
        mod: asJson(mod),
      })]
    })
  }
  if (argv[2] === 'delete') {
    const args = parseNamedArguments(argv.slice(4), {
      values: ['--template-version', ...MUTATION_VALUE_OPTIONS],
      switches: MUTATION_SWITCH_OPTIONS,
    })
    const expectedTemplateVersion = args
      ? positiveInteger(args.values['--template-version'])
      : undefined
    if (!args || !expectedTemplateVersion) return invalid()
    return mutationPlan(args, pretty, createIdentity, argv, (mutation) => [
      makeCommand(mutation.commandId, 'mod-template.delete', {
        templateId,
        expectedTemplateVersion,
      }),
    ])
  }
  if (argv[2] !== 'configure') return invalid()
  const args = parseNamedArguments(argv.slice(4), {
    values: ['--template-version', '--spec', ...MUTATION_VALUE_OPTIONS],
    switches: MUTATION_SWITCH_OPTIONS,
  })
  const expectedTemplateVersion = args
    ? positiveInteger(args.values['--template-version'])
    : undefined
  const spec = args ? parseJson(args.values['--spec']) : undefined
  const mutation = args ? mutationIdentity(args, createIdentity, argv) : null
  if (!args || !expectedTemplateVersion || spec === undefined || !mutation) return invalid()
  return {
    ok: true,
    plan: {
      kind: 'mod-configure',
      pretty,
      target: { kind: 'template', templateId, expectedTemplateVersion },
      request: gatewayRequest(createIdentity(), 'record.get', { recordId: templateId }),
      spec,
      mutation,
    },
  }
}

function parseFrames(
  value: string | undefined,
  explicitIdea: string | undefined,
): Readonly<{
  ideaId: string
  frames: readonly ProfileJsonValue[]
}> | null {
  const parsed = parseJson(value)
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) return null
  const cards: string[] = []
  const rawFrames: Array<Record<string, unknown>> = []
  for (const entry of parsed) {
    if (!isRecord(entry)
      || !hasExactOptionalKeys(entry, ['card', 'x', 'y'], ['width', 'height'])
      || typeof entry.card !== 'string'
      || !boundedCoordinate(entry.x)
      || !boundedCoordinate(entry.y)
      || ((entry.width === undefined) !== (entry.height === undefined))
      || (entry.width !== undefined
        && (!boundedDimension(entry.width) || !boundedDimension(entry.height)))) {
      return null
    }
    cards.push(entry.card)
    rawFrames.push(entry)
  }
  const addresses = resolveCardSet(cards, explicitIdea)
  if (!addresses || new Set(addresses.cardIds).size !== addresses.cardIds.length) return null
  return {
    ideaId: addresses.ideaId,
    frames: rawFrames.map((frame, index) => ({
      card: { cardId: addresses.cardIds[index]! },
      position: { x: frame.x as number, y: frame.y as number },
      ...(frame.width === undefined
        ? {}
        : { size: { width: frame.width as number, height: frame.height as number } }),
    })),
  }
}

function mutationPlan(
  args: NamedArguments,
  pretty: boolean,
  createIdentity: () => string,
  intent: readonly string[],
  commands: (mutation: MutationIdentity) => readonly Command[],
): EidoCliV5PlanResult {
  const mutation = mutationIdentity(args, createIdentity, intent)
  if (!mutation) return invalid()
  return {
    ok: true,
    plan: {
      kind: 'invoke',
      pretty,
      request: commandBatchRequest(mutation, commands(mutation)),
    },
  }
}

function mutationIdentity(
  args: NamedArguments,
  createIdentity: () => string,
  intent: readonly string[],
): MutationIdentity | null {
  const expectedRevision = nonNegativeInteger(args.values['--expected-revision'])
  const dryRun = args.switches.has('--dry-run')
  const apply = args.switches.has('--apply')
  if (expectedRevision === undefined || dryRun === apply) return null
  const requestId = args.values['--request-id'] ?? createIdentity()
  const idempotencyKey = args.values['--idempotency-key']
    ?? deriveEidoCliIdempotencyKey(intent)
  const commandId = args.values['--command-id'] ?? `command:${idempotencyKey}`
  if (!boundedString(requestId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
    || !boundedString(idempotencyKey, PROFILE_AGENT_COMMAND_LIMITS.maxIdempotencyKeyBytes)
    || !boundedString(commandId, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)) return null
  return { requestId, expectedRevision, idempotencyKey, commandId, dryRun }
}

function commandBatchRequest(
  mutation: MutationIdentity,
  commands: readonly Command[],
): ProfileGatewayRequest {
  return gatewayRequest(mutation.requestId, 'command.batch', {
    version: 1,
    schemaVersion: 1,
    expectedRevision: mutation.expectedRevision,
    idempotencyKey: mutation.idempotencyKey,
    dryRun: mutation.dryRun,
    commands: asJson(commands),
  })
}

function makeCommand(
  id: string,
  name: string,
  payload: Readonly<Record<string, ProfileJsonValue>>,
): Command {
  return { version: 1, id, name, payload }
}

function gatewayRequest(
  requestId: string,
  operation: ProfileGatewayRequest['operation'],
  params: Readonly<Record<string, ProfileJsonValue>>,
): ProfileGatewayRequest {
  return { version: 1, requestId, operation, params }
}

function invoke(
  operation: ProfileGatewayRequest['operation'],
  params: Readonly<Record<string, ProfileJsonValue>>,
  pretty: boolean,
  createIdentity: () => string,
): EidoCliV5PlanResult {
  return {
    ok: true,
    plan: {
      kind: 'invoke',
      pretty,
      request: gatewayRequest(createIdentity(), operation, params),
    },
  }
}

function readMod(
  target: EidoCliModInspectPlan['target'] | EidoCliModConfigurePlan['target'],
  response: ProfileGatewayResponse,
): Readonly<{
  profileId: string
  revision: number
  item: ProfileQueryItem
  mod: Mod
}> | undefined {
  if (!response.ok) return undefined
  const result: unknown = response.result
  if (!isRecord(result)
    || typeof result.profileId !== 'string'
    || !Number.isSafeInteger(result.revision)
    || !Array.isArray(result.items)) return undefined
  const items = result.items.filter(isQueryItem)
  if (items.length !== result.items.length) return undefined
  const item = target.kind === 'instance'
    ? items.filter((candidate) => (
        candidate.kind === 'mod-instance' && candidate.parentId === target.cardId
      ))
    : items.filter((candidate) => (
        candidate.kind === 'mod-template' && candidate.recordId === target.templateId
      ))
  if (item.length !== 1) return undefined
  const payload = item[0]!.payload
  if (!isRecord(payload) || !isRecord(payload.mod)) return undefined
  return {
    profileId: result.profileId,
    revision: result.revision as number,
    item: item[0]!,
    mod: payload.mod as unknown as Mod,
  }
}

function isQueryItem(value: unknown): value is ProfileQueryItem {
  return isRecord(value)
    && typeof value.recordId === 'string'
    && typeof value.kind === 'string'
    && typeof value.ownerId === 'string'
    && (value.parentId === null || typeof value.parentId === 'string')
    && Number.isSafeInteger(value.ordinal)
    && Number.isSafeInteger(value.recordVersion)
    && Object.prototype.hasOwnProperty.call(value, 'payload')
}

function partIdFactory(commandId: string, spec: unknown): ModPartIdFactory {
  const kind = isRecord(spec) && typeof spec.kind === 'string' ? spec.kind : 'mod'
  return (role, ordinal) => `mod-part:${commandId}:${kind}-${role}:${ordinal}`
}

/** An applied configure that added members must be able to reach the durable
 * idempotency ledger on exact retry. We only restore omitted ids when the live
 * member at that exact role/ordinal already has the command-derived id. */
function exactConfigureReplaySpec(
  existing: Mod,
  spec: unknown,
  createId: ModPartIdFactory,
): unknown | undefined {
  const replay = cloneJson(spec)
  const parts = ergonomicSpecParts(replay)
  const identities = listModPartIdentities(existing)
  if (!parts || parts.length !== identities.length) return undefined
  let restored = 0
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index]!
    if (Object.prototype.hasOwnProperty.call(part, 'id')) continue
    const identity = identities[index]!
    const expected = createId(identity.role, identity.ordinal)
    if (identity.sourceId !== expected) return undefined
    part.id = expected
    restored += 1
  }
  return restored > 0 ? replay : undefined
}

function ergonomicSpecParts(spec: unknown): Record<string, unknown>[] | undefined {
  if (!isRecord(spec) || !isRecord(spec.state) || typeof spec.kind !== 'string') return undefined
  const state = spec.state
  const arrayParts = (key: string) => (
    Array.isArray(state[key]) && state[key].every(isRecord)
      ? state[key] as Record<string, unknown>[]
      : undefined
  )
  switch (spec.kind) {
    case 'slider':
    case 'dial':
    case 'count':
    case 'switch':
    case 'order':
    case 'mixer':
      return arrayParts('items')
    case 'filter':
      return arrayParts('lanes')
    case 'select':
      return arrayParts('options')
    case 'radar':
      return arrayParts('axes')
    case 'matrix': {
      const rows = arrayParts('rows')
      const columns = arrayParts('cols')
      return rows && columns ? [...rows, ...columns] : undefined
    }
    case 'pad': {
      if (!isRecord(state.axes) || !isRecord(state.axes.x) || !isRecord(state.axes.y)) {
        return undefined
      }
      return [state.axes.x, state.axes.y]
    }
    default:
      return undefined
  }
}

function parseNamedArguments(
  argv: readonly string[],
  allowed: Readonly<{ values: readonly string[]; switches: readonly string[] }>,
): NamedArguments | null {
  const values: Record<string, string> = {}
  const switches = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (!option) return null
    if (allowed.switches.includes(option)) {
      if (switches.has(option)) return null
      switches.add(option)
      continue
    }
    if (!allowed.values.includes(option) || values[option] !== undefined) return null
    const value = argv[index + 1]
    if (value === undefined || value.length === 0) return null
    values[option] = value
    index += 1
  }
  return { values, switches }
}

function parseListOptions(argv: readonly string[]): Readonly<Record<string, ProfileJsonValue>> | null {
  const params: Record<string, ProfileJsonValue> = {}
  const projection: string[] = []
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]
    const value = argv[index + 1]
    if (!option || value === undefined || value.length === 0) return null
    switch (option) {
      case '--limit': {
        const parsed = positiveInteger(value)
        if (parsed === undefined || params.limit !== undefined) return null
        params.limit = parsed
        break
      }
      case '--byte-limit': {
        const parsed = positiveInteger(value)
        if (parsed === undefined || params.byteLimit !== undefined) return null
        params.byteLimit = parsed
        break
      }
      case '--cursor':
        if (params.cursor !== undefined) return null
        params.cursor = value
        break
      case '--projection':
        if (projection.includes(value)) return null
        projection.push(value)
        break
      default:
        return null
    }
  }
  if (projection.length > 0) params.projection = projection
  return params
}

function splitPositionals(argv: readonly string[]): Readonly<{
  positionals: readonly string[]
  options: readonly string[]
}> {
  const optionIndex = argv.findIndex(value => value.startsWith('--'))
  return optionIndex === -1
    ? { positionals: argv, options: [] }
    : { positionals: argv.slice(0, optionIndex), options: argv.slice(optionIndex) }
}

function resolveCardAddress(
  value: string,
  explicitIdea: string | undefined,
): Readonly<{ ideaId: string; cardId: string }> | null {
  const link = parseCardDeepLink(value)
  const explicitIdeaId = explicitIdea === undefined ? undefined : addressId(explicitIdea, 'idea')
  if (link) {
    if (explicitIdea !== undefined && explicitIdeaId !== link.ideaId) return null
    return { ideaId: link.ideaId, cardId: link.cardId }
  }
  const cardId = plainId(value)
  return cardId && explicitIdeaId ? { ideaId: explicitIdeaId, cardId } : null
}

function resolveCardSet(
  values: readonly string[],
  explicitIdea: string | undefined,
): Readonly<{ ideaId: string; cardIds: readonly string[] }> | null {
  const explicitIdeaId = explicitIdea === undefined ? undefined : addressId(explicitIdea, 'idea')
  if (explicitIdea !== undefined && explicitIdeaId === undefined) return null
  const links = values.map(parseCardDeepLink)
  const cardIds = values.map((value, index) => links[index]?.cardId ?? plainId(value))
  const ideaIds = [explicitIdeaId, ...links.map(link => link?.ideaId)]
    .filter((value): value is string => value !== undefined)
  if (cardIds.some(value => value === undefined)
    || ideaIds.length === 0
    || new Set(ideaIds).size !== 1) return null
  return { ideaId: ideaIds[0]!, cardIds: cardIds as string[] }
}

function resolveConnectionAddresses(
  from: string,
  to: string,
  explicitIdea: string | undefined,
): Readonly<{ ideaId: string; fromCardId: string; toCardId: string }> | null {
  const resolved = resolveCardSet([from, to], explicitIdea)
  return resolved
    ? {
        ideaId: resolved.ideaId,
        fromCardId: resolved.cardIds[0]!,
        toCardId: resolved.cardIds[1]!,
      }
    : null
}

function addressId(value: string | undefined, part: 'card' | 'idea'): string | undefined {
  if (!value) return undefined
  const link = parseCardDeepLink(value)
  return link ? (part === 'card' ? link.cardId : link.ideaId) : plainId(value)
}

function plainId(value: string | undefined): string | undefined {
  return boundedString(value, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
    && !value.includes('://')
    ? value
    : undefined
}

function parseJson(value: string | undefined): unknown | undefined {
  if (!value) return undefined
  try {
    return JSON.parse(value) as unknown
  } catch {
    return undefined
  }
}

function finiteNumber(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function boundedCoordinate(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && !Object.is(value, -0)
    && Math.abs(value) <= PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate
}

function boundedDimension(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && !Object.is(value, -0)
    && value > 0
    && value <= PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate
}

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= maxBytes
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value || !/^[1-9][0-9]*$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function nonNegativeInteger(value: string | undefined): number | undefined {
  if (!value || !/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

function indexedCommandId(base: string, index: number): string {
  return index === 0 ? base : `${base}:${index + 1}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactOptionalKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
): boolean {
  const keys = Object.keys(value)
  return required.every(key => keys.includes(key))
    && keys.every(key => required.includes(key) || optional.includes(key))
}

function asJson(value: unknown): ProfileJsonValue {
  return value as ProfileJsonValue
}

function cloneJson(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown
}

function invalid(): Readonly<{ ok: false }> {
  return { ok: false }
}
