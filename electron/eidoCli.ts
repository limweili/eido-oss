import type {
  ProfileGatewayDescription,
  ProfileGatewayRequest,
  ProfileGatewayResponse,
} from '../src/persistence/profileAgentGateway'
import type { ProfileJsonValue } from '../src/persistence/profileServiceContract'
import { PROFILE_AGENT_COMMAND_LIMITS } from '../src/persistence/profileAgentCommandManifest'
import { CARD_CREATOR_KINDS } from '../src/graph/cardAuthorship'
import { parseCardDeepLink } from '../src/shared/deepLinks'
import { AGENT_RUN_VARIATION_LIMITS } from '../src/brain/agentRunContract'
import {
  PROFILE_JSON_CLI_EXIT_CODES,
  profileJsonCliExitCodeFor,
  type ProfileJsonCliWriter,
} from './profileJsonCli'
import {
  EIDO_CLI_HELP,
  canonicalEidoCliArgv,
  clearEidoCliUsageDetail,
  closestEidoCliNames,
  duplicateOptionDetail,
  eidoCliUsageError,
  invalidAddressDetail,
  invalidOptionValueDetail,
  missingOptionValueDetail,
  recordEidoCliUsageDetail,
  renderEidoCliHelp,
  renderEidoCliUsageDiagnostic,
  resolveEidoCliHelpTopic,
  takeEidoCliUsageDetail,
  unknownOptionDetail,
  type EidoCliHelpTopic,
  type EidoCliUsageError,
} from './eidoCliCommands'
import {
  deriveEidoCliIdempotencyKey,
  eidoCliOptionConsumesValue,
} from './eidoCliMutationKey'
import { resolveEidoCliValueSources } from './eidoCliValueSources'
import {
  completeEidoCliModConfigure,
  planEidoCliV5,
  projectEidoCliModInspection,
  type EidoCliModConfigurePlan,
  type EidoCliModInspectPlan,
  type EidoCliV5Plan,
} from './eidoCliV5'

export type EidoCliRawIo = Readonly<{
  stdin: AsyncIterable<string | Uint8Array>
  stdout: ProfileJsonCliWriter
  stderr: ProfileJsonCliWriter
}>

export type EidoCliOptions = EidoCliRawIo & Readonly<{
  argv: readonly string[]
  createRequestId(): string
  describeGateway(): ProfileGatewayDescription
  runRaw(io: EidoCliRawIo): Promise<number>
  /** Build-stamped app version, printed by `eido --version`. */
  appVersion?: string
  invoke?: (request: ProfileGatewayRequest) => Promise<Readonly<{
    response: ProfileGatewayResponse
    servedBy: 'live' | 'headless'
    live: Readonly<{
      state: 'served' | 'absent' | 'unavailable'
      reason?: string
      admission?: 'none' | 'admitted' | 'unknown'
      fallback?: 'headless' | 'forbidden'
    }>
  }>>
}>

export type EidoCliIdentity = Readonly<{
  client: string
  sessionId: string
}>

export type EidoCliIdentityPlan =
  | Readonly<{ ok: true; argv: readonly string[]; identity: EidoCliIdentity }>
  | Readonly<{ ok: false }>

export { EIDO_CLI_HELP }
export type { EidoCliUsageError }

const EIDO_CLI_IDENTITY_MAX_BYTES = 128
const EIDO_CLI_UNSAFE_IDENTITY = /[\u0000-\u001f\u007f]/
function stripCliSwitch(
  argv: readonly string[],
  switchName: string,
): Readonly<{ argv: readonly string[]; count: number }> {
  const stripped: string[] = []
  let count = 0
  let consumesOpaqueValue = false
  for (const argument of argv) {
    if (consumesOpaqueValue) {
      stripped.push(argument)
      consumesOpaqueValue = false
      continue
    }
    if (argument === switchName) {
      count += 1
      continue
    }
    stripped.push(argument)
    consumesOpaqueValue = eidoCliOptionConsumesValue(argument)
  }
  return Object.freeze({ argv: Object.freeze(stripped), count })
}

/** Accepts --help, -h, and a leading `help` word at any position. */
function stripEidoCliHelpSwitches(
  argv: readonly string[],
): Readonly<{ argv: readonly string[]; requested: boolean }> {
  const long = stripCliSwitch(argv, '--help')
  const short = stripCliSwitch(long.argv, '-h')
  const word = short.argv[0] === 'help'
  return Object.freeze({
    argv: Object.freeze(word ? short.argv.slice(1) : short.argv),
    requested: long.count > 0 || short.count > 0 || word,
  })
}

/** Canonical spellings mapped back to the shapes the planners already parse. */
function plannerEidoCliArgv(canonical: readonly string[]): readonly string[] {
  if (canonical[0] === 'changes' && canonical[1] === 'list') {
    return ['changes', ...canonical.slice(2)]
  }
  if (canonical[0] === 'card' && (canonical[1] === 'arrange' || canonical[1] === 'layer')) {
    return ['cards', ...canonical.slice(1)]
  }
  return canonical
}

export function planEidoCliIdentity(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  createSessionId: () => string,
): EidoCliIdentityPlan {
  const stripped: string[] = []
  let clientFlag: string | undefined
  let sessionFlag: string | undefined
  let consumesOpaqueValue = false
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]
    if (consumesOpaqueValue) {
      stripped.push(argument!)
      consumesOpaqueValue = false
      continue
    }
    if (argument !== '--agent-client' && argument !== '--agent-session') {
      stripped.push(argument!)
      consumesOpaqueValue = eidoCliOptionConsumesValue(argument)
      continue
    }
    const value = argv[index + 1]
    if (!value) return { ok: false }
    if (argument === '--agent-client') {
      if (clientFlag !== undefined) return { ok: false }
      clientFlag = value
    } else {
      if (sessionFlag !== undefined) return { ok: false }
      sessionFlag = value
    }
    index += 1
  }
  const client = clientFlag ?? environment.EIDO_AGENT_CLIENT ?? 'eido-cli'
  let sessionId: string
  try {
    sessionId = sessionFlag ?? environment.EIDO_AGENT_SESSION_ID ?? createSessionId()
  } catch {
    return { ok: false }
  }
  if (!boundedIdentity(client) || !boundedIdentity(sessionId)) return { ok: false }
  return Object.freeze({
    ok: true as const,
    argv: Object.freeze(stripped),
    identity: Object.freeze({ client, sessionId }),
  })
}

export type EidoCliPlan =
  | EidoCliV5Plan
  | Readonly<{
      kind: 'describe'
      operation?: string
      full: boolean
      pretty: boolean
    }>
  | Readonly<{ kind: 'help'; topic: EidoCliHelpTopic }>
  | Readonly<{ kind: 'version' }>
  | Readonly<{ kind: 'batch' }>

export type EidoCliPlanResult =
  | Readonly<{ ok: true; plan: EidoCliPlan }>
  | Readonly<{ ok: false; error: EidoCliUsageError }>

/** Internal attempt shape. Failures stay anonymous here; planEidoCli names them. */
type EidoCliPlanAttempt =
  | Readonly<{ ok: true; plan: EidoCliPlan }>
  | Readonly<{ ok: false }>

export function planEidoCli(
  argv: readonly string[],
  createRequestId: () => string,
): EidoCliPlanResult {
  clearEidoCliUsageDetail()
  const attempt = planEidoCliCommand(argv, createRequestId)
  const detail = takeEidoCliUsageDetail()
  if (attempt.ok) return attempt
  return { ok: false, error: eidoCliUsageError(argv, detail) }
}

function planEidoCliCommand(
  argv: readonly string[],
  createRequestId: () => string,
): EidoCliPlanAttempt {
  // --version is only the version request when it stands alone; elsewhere it
  // remains an ordinary option value carrier (for example `result choose`).
  if (argv.length === 1 && argv[0] === '--version') {
    return { ok: true, plan: { kind: 'version' } }
  }
  const prettyPlan = stripCliSwitch(argv, '--pretty')
  if (prettyPlan.count > 1) {
    recordEidoCliUsageDetail(duplicateOptionDetail('--pretty'))
    return { ok: false }
  }
  const helpPlan = stripEidoCliHelpSwitches(prettyPlan.argv)
  if (helpPlan.requested) {
    const topic = resolveEidoCliHelpTopic(canonicalEidoCliArgv(helpPlan.argv))
    if (topic.kind === 'unknown') {
      recordEidoCliUsageDetail({
        code: 'cli.usage',
        message: `Unknown command ${JSON.stringify(topic.argv.join(' '))}.`,
        hint: 'Run `eido --help` for the command index.',
      })
      return { ok: false }
    }
    return { ok: true, plan: { kind: 'help', topic } }
  }
  const canonical = canonicalEidoCliArgv(helpPlan.argv)
  if (canonical.length === 0) {
    return prettyPlan.count === 0
      ? { ok: true, plan: { kind: 'help', topic: { kind: 'index' } } }
      : { ok: false }
  }
  if (canonical.length === 1 && canonical[0] === 'batch') {
    if (prettyPlan.count === 1) {
      recordEidoCliUsageDetail({
        code: 'cli.usage',
        message: '`eido batch` does not accept --pretty.',
        hint: 'batch emits the unchanged Gateway envelope, byte for byte, so it is never reformatted.',
      })
      return { ok: false }
    }
    return { ok: true, plan: { kind: 'batch' } }
  }
  const command = plannerEidoCliArgv(canonical)
  const operation = command.length === 1
    ? command[0] === 'status'
      ? 'profile.status'
      : command[0] === 'capabilities'
        ? 'agent.capabilities'
        : undefined
    : command.length === 2 && command[0] === 'agent' && command[1] === 'capabilities'
      ? 'agent.capabilities'
    : undefined
  if (operation) {
    return {
      ok: true,
      plan: {
        kind: 'invoke',
        pretty: prettyPlan.count === 1,
        request: {
          version: 1,
          requestId: createRequestId(),
          operation,
          params: {},
        },
      },
    }
  }

  if (command[0] === 'describe') {
    const rest = command.slice(1)
    const full = rest.includes('--full')
    const operands = rest.filter(argument => argument !== '--full')
    const unexpected = operands.find(argument => argument.startsWith('-'))
    if (unexpected !== undefined) {
      recordEidoCliUsageDetail(unknownOptionDetail(unexpected))
      return { ok: false }
    }
    if (operands.length > 1) {
      recordEidoCliUsageDetail({
        code: 'cli.usage',
        message: '`eido describe` accepts at most one operation name.',
      })
      return { ok: false }
    }
    return {
      ok: true,
      plan: {
        kind: 'describe',
        ...(operands[0] === undefined ? {} : { operation: operands[0] }),
        full,
        pretty: prettyPlan.count === 1,
      },
    }
  }

  const v5 = planEidoCliV5(command, prettyPlan.count === 1, createRequestId)
  if (v5 !== undefined) return v5

  if (command[0] === 'idea' && command[1] === 'list') {
    const params = parseListOptions(command.slice(2))
    if (!params) return { ok: false }
    return invokePlan(
      'idea.list',
      params,
      prettyPlan.count === 1,
      createRequestId,
    )
  }
  if (command[0] === 'idea'
    && command[1] === 'create'
    && command[2]
    && !command[2].startsWith('--')) {
    const arguments_ = parseNamedArguments(command.slice(3), {
      values: [
        '--expected-revision',
        '--request-id',
        '--idempotency-key',
        '--command-id',
      ],
      switches: ['--dry-run', '--apply'],
    })
    if (!arguments_) return { ok: false }
    const mutation = mutationIdentity(arguments_, createRequestId, command)
    if (!mutation) return { ok: false }
    return mutationInvokePlan({
      ...mutation,
      pretty: prettyPlan.count === 1,
      command: {
        version: 1,
        id: mutation.commandId,
        name: 'idea.create',
        payload: { name: command[2] },
      },
    })
  }
  if (command[0] === 'idea'
    && command[1] === 'activate'
    && command[2]
    && !command[2].startsWith('--')) {
    const arguments_ = parseNamedArguments(command.slice(3), {
      values: [
        '--expected-revision',
        '--request-id',
        '--idempotency-key',
        '--command-id',
      ],
      switches: ['--dry-run', '--apply'],
    })
    const ideaId = addressId(command[2], 'idea')
    if (!arguments_ || !ideaId) return { ok: false }
    const mutation = mutationIdentity(arguments_, createRequestId, command)
    if (!mutation) return { ok: false }
    return mutationInvokePlan({
      ...mutation,
      pretty: prettyPlan.count === 1,
      command: {
        version: 1,
        id: mutation.commandId,
        name: 'idea.activate',
        payload: { ideaId },
      },
    })
  }
  if (command[0] === 'graph' && command[1] === 'query') {
    const params = parseGraphOptions(command.slice(2))
    if (!params) return { ok: false }
    return invokePlan('graph.query', params, prettyPlan.count === 1, createRequestId)
  }
  if (command[0] === 'graph' && command[1] === 'neighbors' && command[2]) {
    const arguments_ = parseNamedArguments(command.slice(3), {
      values: ['--idea', '--limit', '--byte-limit'],
      switches: [],
    })
    if (!arguments_) return { ok: false }
    const address = resolveCardAddress(command[2], arguments_.values['--idea'])
    const limitValue = arguments_.values['--limit']
    const byteLimitValue = arguments_.values['--byte-limit']
    const limit = limitValue === undefined ? undefined : positiveInteger(limitValue)
    const byteLimit = byteLimitValue === undefined ? undefined : positiveInteger(byteLimitValue)
    if (!address
      || (limitValue !== undefined && limit === undefined)
      || (byteLimitValue !== undefined && byteLimit === undefined)) return { ok: false }
    return invokePlan('graph.neighbors', {
      ideaId: address.ideaId,
      card: address.cardId,
      ...(limit === undefined ? {} : { limit }),
      ...(byteLimit === undefined ? {} : { byteLimit }),
    }, prettyPlan.count === 1, createRequestId)
  }
  if (command[0] === 'graph' && command[1] === 'bounds') {
    const optionIndex = command.findIndex((argument, index) => (
      index >= 2 && argument.startsWith('--')
    ))
    const addressEnd = optionIndex === -1 ? command.length : optionIndex
    const addresses = command.slice(2, addressEnd)
    const arguments_ = parseNamedArguments(command.slice(addressEnd), {
      values: ['--idea'],
      switches: [],
    })
    if (!arguments_ || addresses.length === 0) return { ok: false }
    const resolved = resolveCardSetAddresses(addresses, arguments_.values['--idea'])
    if (!resolved) return { ok: false }
    return invokePlan('graph.bounds', {
      ideaId: resolved.ideaId,
      cards: [...resolved.cardIds],
    }, prettyPlan.count === 1, createRequestId)
  }
  if (command[0] === 'record' && command[1] === 'get' && command[2]) {
    const recordId = addressId(command[2], 'card')
    const options = parseListOptions(command.slice(3))
    if (options && (options.limit !== undefined || options.cursor !== undefined)) {
      recordEidoCliUsageDetail({
        code: 'cli.usage',
        message: '`eido record get` does not support --limit or --cursor.',
        hint: 'It reads exactly one record. It accepts --byte-limit and --projection; use `eido graph query` for a paged list.',
      })
      return { ok: false }
    }
    if (!recordId || !options) return { ok: false }
    return invokePlan(
      'record.get',
      { recordId, ...options },
      prettyPlan.count === 1,
      createRequestId,
    )
  }
  if (command[0] === 'result' && command[1] === 'inspect' && command[2]) {
    const arguments_ = parseNamedArguments(command.slice(3), {
      values: ['--idea', '--limit', '--byte-limit', '--cursor'],
      switches: [],
    })
    if (!arguments_) return { ok: false }
    const address = resolveCardAddress(command[2], arguments_.values['--idea'])
    const limitValue = arguments_.values['--limit']
    const byteLimitValue = arguments_.values['--byte-limit']
    const limit = limitValue === undefined ? undefined : positiveInteger(limitValue)
    const byteLimit = byteLimitValue === undefined ? undefined : positiveInteger(byteLimitValue)
    if (!address
      || (limitValue !== undefined && limit === undefined)
      || (byteLimitValue !== undefined && byteLimit === undefined)) return { ok: false }
    return invokePlan('result.inspect', {
      ideaId: address.ideaId,
      resultCardId: address.cardId,
      ...(limit === undefined ? {} : { limit }),
      ...(byteLimit === undefined ? {} : { byteLimit }),
      ...(arguments_.values['--cursor'] === undefined
        ? {}
        : { cursor: arguments_.values['--cursor'] }),
    }, prettyPlan.count === 1, createRequestId)
  }
  if (command[0] === 'run' && command[1] === 'status' && command[2]
    && command.length === 3) {
    const runId = plainId(command[2])
    if (!runId) return { ok: false }
    return invokePlan(
      'run.status',
      { runId },
      prettyPlan.count === 1,
      createRequestId,
    )
  }
  if (command[0] === 'run' && command[1] === 'read' && command[2]) {
    const runId = plainId(command[2])
    const arguments_ = parseNamedArguments(command.slice(3), {
      values: ['--limit', '--byte-limit', '--cursor'],
      switches: [],
    })
    if (!runId || !arguments_) return { ok: false }
    const limitValue = arguments_.values['--limit']
    const byteLimitValue = arguments_.values['--byte-limit']
    const limit = limitValue === undefined ? undefined : positiveInteger(limitValue)
    const byteLimit = byteLimitValue === undefined ? undefined : positiveInteger(byteLimitValue)
    if ((limitValue !== undefined && limit === undefined)
      || (byteLimitValue !== undefined && byteLimit === undefined)) return { ok: false }
    return invokePlan('run.read', {
      runId,
      ...(limit === undefined ? {} : { limit }),
      ...(byteLimit === undefined ? {} : { byteLimit }),
      ...(arguments_.values['--cursor'] === undefined
        ? {}
        : { cursor: arguments_.values['--cursor'] }),
    }, prettyPlan.count === 1, createRequestId)
  }
  if (command[0] === 'run' && command[1]
    && command[1] !== 'status' && command[1] !== 'read') {
    const arguments_ = parseNamedArguments(command.slice(2), {
      values: ['--idea', '--variations'],
      switches: [],
    })
    if (!arguments_) return { ok: false }
    const address = resolveCardAddress(command[1], arguments_.values['--idea'])
    const variationsValue = arguments_.values['--variations']
    const variationCount = variationsValue === undefined
      ? undefined
      : positiveInteger(variationsValue)
    if (!address
      || (variationsValue !== undefined && (variationCount === undefined
        || variationCount > AGENT_RUN_VARIATION_LIMITS.maxCount))) return { ok: false }
    return invokePlan('run.submit', {
      ideaId: address.ideaId,
      targetCardId: address.cardId,
      ...(variationCount === undefined ? {} : {
        mode: 'variations',
        variationCount,
      }),
    }, prettyPlan.count === 1, createRequestId)
  }
  if (command[0] === 'changes') {
    const params = parseChangesOptions(command.slice(1))
    if (!params) return { ok: false }
    return invokePlan('changes.list', params, prettyPlan.count === 1, createRequestId)
  }
  if (command[0] === 'card' && command[1] === 'create') {
    const arguments_ = parseNamedArguments(command.slice(2), {
      values: [
        '--idea',
        '--kind',
        '--x',
        '--y',
        '--body',
        '--text',
        '--group-title',
        '--compression-prompt',
        '--topic',
        '--conversation-style',
        '--conversation-turns',
        '--connect-from',
        '--strength',
        '--polarity',
        '--reason',
        '--group-mode',
        '--expected-revision',
        '--request-id',
        '--idempotency-key',
        '--command-id',
      ],
      repeatableValues: ['--near'],
      allowEmptyValues: [
        '--body', '--text', '--group-title', '--compression-prompt', '--topic',
      ],
      switches: ['--dry-run', '--apply'],
    })
    if (!arguments_) return { ok: false }
    const ideaId = addressId(arguments_.values['--idea'] ?? '', 'idea')
    const kind = arguments_.values['--kind']
    const xValue = arguments_.values['--x']
    const yValue = arguments_.values['--y']
    const x = finiteNumber(xValue)
    const y = finiteNumber(yValue)
    const near = arguments_.repeatedValues['--near'] ?? []
    const hasPosition = xValue !== undefined || yValue !== undefined
    const resolvedNear = near.length === 0 || !ideaId
      ? undefined
      : resolveCardSetAddresses(near, ideaId)
    if (!ideaId
      || (kind !== 'note'
        && kind !== 'askAi'
        && kind !== 'title'
        && kind !== 'group'
        && kind !== 'conversation')
      || (hasPosition && (x === undefined || y === undefined))
      || hasPosition === (near.length > 0)
      || (near.length > 0 && (!resolvedNear || resolvedNear.ideaId !== ideaId))) return { ok: false }
    const body = arguments_.values['--body']
    const text = arguments_.values['--text']
    const groupTitle = arguments_.values['--group-title']
    const compressionPrompt = arguments_.values['--compression-prompt']
    const topic = arguments_.values['--topic']
    const conversationStyle = arguments_.values['--conversation-style']
    const conversationTurnsValue = arguments_.values['--conversation-turns']
    const conversationTurns = conversationTurnsValue === undefined
      ? undefined
      : positiveInteger(conversationTurnsValue)
    const hasConversationContent = topic !== undefined
      || conversationStyle !== undefined
      || conversationTurnsValue !== undefined
    const connectFrom = arguments_.values['--connect-from']
    const strength = arguments_.values['--strength']
    const polarity = arguments_.values['--polarity']
    const reason = arguments_.values['--reason']
    const groupMode = arguments_.values['--group-mode']
    const hasConnectionMeaning = strength !== undefined
      || polarity !== undefined
      || reason !== undefined
      || groupMode !== undefined
    const connectionSource = connectFrom === undefined
      ? undefined
      : resolveCardAddress(connectFrom, ideaId)
    if ((body !== undefined && text !== undefined)
      || (kind === 'group' && (body !== undefined || text !== undefined))
      || (kind === 'conversation' && (
        body !== undefined
        || text !== undefined
        || groupTitle !== undefined
        || compressionPrompt !== undefined
      ))
      || (kind !== 'group' && (groupTitle !== undefined || compressionPrompt !== undefined))
      || (kind !== 'conversation' && hasConversationContent)
      || (conversationStyle !== undefined && ![
        'debate', 'critique', 'interview', 'collaborate',
      ].includes(conversationStyle))
      || (conversationTurnsValue !== undefined && conversationTurns === undefined)
      || (strength !== undefined && strength !== 'strong' && strength !== 'weak')
      || (polarity !== undefined && polarity !== 'helps' && polarity !== 'pushesAgainst')
      || (groupMode !== undefined && groupMode !== 'full' && groupMode !== 'compress')
      || (connectFrom === undefined && hasConnectionMeaning)
      || (connectFrom !== undefined && (!connectionSource || kind === 'title'))) {
      return { ok: false }
    }
    const mutation = mutationIdentity(arguments_, createRequestId, command)
    if (!mutation) return { ok: false }
    const payload: Record<string, ProfileJsonValue> = { ideaId, kind }
    if (hasPosition) payload.position = { x: x!, y: y! }
    else payload.near = [...resolvedNear!.cardIds]
    if (kind === 'conversation') {
      if (topic !== undefined) payload.topic = topic
      if (conversationStyle !== undefined) payload.conversationStyle = conversationStyle
      if (conversationTurns !== undefined) payload.conversationTurns = conversationTurns
    } else if (kind === 'group') {
      if (groupTitle !== undefined) payload.groupTitle = groupTitle
      if (compressionPrompt !== undefined) payload.compressionPrompt = compressionPrompt
    } else if (body !== undefined) {
      payload.body = body
    } else if (text !== undefined) {
      // Keep the already-shipped explicit-position spelling replayable;
      // near placement has only the surface-v3 domain-shaped form.
      payload[hasPosition && kind !== 'title' ? 'text' : 'body'] = text
    }
    const cardCommand: Readonly<Record<string, ProfileJsonValue>> = {
      version: 1,
      id: mutation.commandId,
      name: 'card.create',
      payload,
    }
    const resolvedConnectionSource = connectionSource ?? undefined
    return mutationInvokePlan({
      ...mutation,
      pretty: prettyPlan.count === 1,
      commands: resolvedConnectionSource === undefined
        ? [cardCommand]
        : [cardCommand, {
            version: 1,
            id: `${mutation.commandId}:connect`,
            name: 'connection.create',
            payload: {
              ideaId,
              from: { cardId: resolvedConnectionSource.cardId },
              to: { createdByCommandId: mutation.commandId },
              ...(strength === undefined ? {} : { strength }),
              ...(polarity === undefined ? {} : { polarity }),
              ...(reason === undefined ? {} : { reason }),
              ...(groupMode === undefined ? {} : { groupMode }),
            },
          }],
    })
  }
  if (command[0] === 'card' && command[1] === 'update' && command[2]) {
    const arguments_ = parseNamedArguments(command.slice(3), {
      values: [
        '--idea',
        '--block',
        '--body',
        '--text',
        '--group-title',
        '--compression-prompt',
        '--topic',
        '--conversation-style',
        '--conversation-turns',
        '--expected-revision',
        '--request-id',
        '--idempotency-key',
        '--command-id',
      ],
      allowEmptyValues: [
        '--body', '--text', '--group-title', '--compression-prompt', '--topic',
      ],
      switches: ['--dry-run', '--apply'],
    })
    if (!arguments_) return { ok: false }
    const address = resolveCardAddress(command[2], arguments_.values['--idea'])
    const blockId = arguments_.values['--block']
    const body = arguments_.values['--body']
    const text = arguments_.values['--text']
    const legacy = blockId !== undefined
    const groupTitle = arguments_.values['--group-title']
    const compressionPrompt = arguments_.values['--compression-prompt']
    const topic = arguments_.values['--topic']
    const conversationStyle = arguments_.values['--conversation-style']
    const conversationTurnsValue = arguments_.values['--conversation-turns']
    const conversationTurns = conversationTurnsValue === undefined
      ? undefined
      : positiveInteger(conversationTurnsValue)
    const hasBodyFamily = !legacy && (body !== undefined || text !== undefined)
    const hasGroupFamily = groupTitle !== undefined || compressionPrompt !== undefined
    const hasConversationFamily = topic !== undefined
      || conversationStyle !== undefined
      || conversationTurnsValue !== undefined
    if (!address
      || (legacy && (text === undefined || body !== undefined))
      || (hasBodyFamily && body !== undefined && text !== undefined)
      || (conversationStyle !== undefined && ![
        'debate', 'critique', 'interview', 'collaborate',
      ].includes(conversationStyle))
      || (conversationTurnsValue !== undefined && conversationTurns === undefined)
      || Number(legacy)
        + Number(hasBodyFamily)
        + Number(hasGroupFamily)
        + Number(hasConversationFamily) !== 1) return { ok: false }
    const mutation = mutationIdentity(arguments_, createRequestId, command)
    if (!mutation) return { ok: false }
    const payload: Record<string, ProfileJsonValue> = {
      ideaId: address.ideaId,
      cardId: address.cardId,
    }
    if (legacy) {
      payload.blockId = blockId!
      payload.text = text!
    } else if (hasBodyFamily) {
      payload.body = body ?? text!
    } else if (hasGroupFamily) {
      if (groupTitle !== undefined) payload.groupTitle = groupTitle
      if (compressionPrompt !== undefined) payload.compressionPrompt = compressionPrompt
    } else {
      if (topic !== undefined) payload.topic = topic
      if (conversationStyle !== undefined) payload.conversationStyle = conversationStyle
      if (conversationTurns !== undefined) payload.conversationTurns = conversationTurns
    }
    return mutationInvokePlan({
      ...mutation,
      pretty: prettyPlan.count === 1,
      command: {
        version: 1,
        id: mutation.commandId,
        name: 'card.update-content',
        payload,
      },
    })
  }
  if (command[0] === 'card' && command[1] === 'delete' && command[2]) {
    const arguments_ = parseNamedArguments(command.slice(3), {
      values: [
        '--idea',
        '--expected-revision',
        '--request-id',
        '--idempotency-key',
        '--command-id',
      ],
      switches: ['--dry-run', '--apply'],
    })
    if (!arguments_) return { ok: false }
    const address = resolveCardAddress(command[2], arguments_.values['--idea'])
    if (!address) return { ok: false }
    const mutation = mutationIdentity(arguments_, createRequestId, command)
    if (!mutation) return { ok: false }
    return mutationInvokePlan({
      ...mutation,
      pretty: prettyPlan.count === 1,
      command: {
        version: 1,
        id: mutation.commandId,
        name: 'card.delete',
        payload: { ideaId: address.ideaId, cardId: address.cardId },
      },
    })
  }
  if (command[0] === 'connection' && command[1] === 'create' && command[2] && command[3]) {
    const arguments_ = parseNamedArguments(command.slice(4), {
      values: [
        '--idea',
        '--strength',
        '--polarity',
        '--reason',
        '--group-mode',
        '--expected-revision',
        '--request-id',
        '--idempotency-key',
        '--command-id',
      ],
      switches: ['--dry-run', '--apply'],
    })
    if (!arguments_) return { ok: false }
    const addresses = resolveConnectionAddresses(
      command[2],
      command[3],
      arguments_.values['--idea'],
    )
    const strength = arguments_.values['--strength']
    const polarity = arguments_.values['--polarity']
    const reason = arguments_.values['--reason']
    const groupMode = arguments_.values['--group-mode']
    if (!addresses
      || (strength !== undefined && strength !== 'strong' && strength !== 'weak')
      || (polarity !== undefined && polarity !== 'helps' && polarity !== 'pushesAgainst')
      || (groupMode !== undefined && groupMode !== 'full' && groupMode !== 'compress')) return { ok: false }
    const mutation = mutationIdentity(arguments_, createRequestId, command)
    if (!mutation) return { ok: false }
    return mutationInvokePlan({
      ...mutation,
      pretty: prettyPlan.count === 1,
      command: {
        version: 1,
        id: mutation.commandId,
        name: 'connection.create',
        payload: {
          ideaId: addresses.ideaId,
          from: { cardId: addresses.fromCardId },
          to: { cardId: addresses.toCardId },
          ...(strength === undefined ? {} : { strength }),
          ...(polarity === undefined ? {} : { polarity }),
          ...(reason === undefined ? {} : { reason }),
          ...(groupMode === undefined ? {} : { groupMode }),
        },
      },
    })
  }
  if (command[0] === 'connection' && command[1] === 'update-meaning' && command[2]) {
    const arguments_ = parseNamedArguments(command.slice(3), {
      values: [
        '--idea',
        '--strength',
        '--polarity',
        '--reason',
        '--group-mode',
        '--expected-revision',
        '--request-id',
        '--idempotency-key',
        '--command-id',
      ],
      switches: ['--clear-reason', '--dry-run', '--apply'],
    })
    if (!arguments_) return { ok: false }
    const connectionId = plainId(command[2])
    const idea = arguments_.values['--idea']
    const ideaId = idea === undefined ? undefined : addressId(idea, 'idea')
    const strength = arguments_.values['--strength']
    const polarity = arguments_.values['--polarity']
    const reason = arguments_.values['--reason']
    const clearReason = arguments_.switches.has('--clear-reason')
    const groupMode = arguments_.values['--group-mode']
    const hasMeaning = strength !== undefined
      || polarity !== undefined
      || reason !== undefined
      || clearReason
      || groupMode !== undefined
    if (!connectionId
      || !ideaId
      || !hasMeaning
      || (reason !== undefined && clearReason)
      || (strength !== undefined && strength !== 'strong' && strength !== 'weak')
      || (polarity !== undefined && polarity !== 'helps' && polarity !== 'pushesAgainst')
      || (groupMode !== undefined && groupMode !== 'full' && groupMode !== 'compress')) return { ok: false }
    const mutation = mutationIdentity(arguments_, createRequestId, command)
    if (!mutation) return { ok: false }
    return mutationInvokePlan({
      ...mutation,
      pretty: prettyPlan.count === 1,
      command: {
        version: 1,
        id: mutation.commandId,
        name: 'connection.update-meaning',
        payload: {
          ideaId,
          connectionId,
          ...(strength === undefined ? {} : { strength }),
          ...(polarity === undefined ? {} : { polarity }),
          ...(reason === undefined && !clearReason ? {} : { reason: clearReason ? null : reason! }),
          ...(groupMode === undefined ? {} : { groupMode }),
        },
      },
    })
  }
  if (command[0] === 'connection' && command[1] === 'delete' && command[2]) {
    const arguments_ = parseNamedArguments(command.slice(3), {
      values: [
        '--idea',
        '--expected-revision',
        '--request-id',
        '--idempotency-key',
        '--command-id',
      ],
      switches: ['--dry-run', '--apply'],
    })
    if (!arguments_) return { ok: false }
    const connectionId = plainId(command[2])
    const idea = arguments_.values['--idea']
    const ideaId = idea === undefined ? undefined : addressId(idea, 'idea')
    if (!connectionId || !ideaId) return { ok: false }
    const mutation = mutationIdentity(arguments_, createRequestId, command)
    if (!mutation) return { ok: false }
    return mutationInvokePlan({
      ...mutation,
      pretty: prettyPlan.count === 1,
      command: {
        version: 1,
        id: mutation.commandId,
        name: 'connection.delete',
        payload: { ideaId, connectionId },
      },
    })
  }
  return { ok: false }
}

export async function runEidoCli(options: EidoCliOptions): Promise<number> {
  await warnDeprecatedTextAlias(options)
  const resolved = await resolveEidoCliValueSources(options.argv, options.stdin)
  if (!resolved.ok) return writeEidoCliUsageFailure(options, resolved.error)
  const planned = planEidoCli(resolved.argv, options.createRequestId)
  if (!planned.ok) return writeEidoCliUsageFailure(options, planned.error)
  const plan = planned.plan
  if (plan.kind === 'help') {
    try {
      await options.stdout.write(renderEidoCliHelp(plan.topic))
      return PROFILE_JSON_CLI_EXIT_CODES.success
    } catch {
      return PROFILE_JSON_CLI_EXIT_CODES.internal
    }
  }
  if (plan.kind === 'version') {
    try {
      await options.stdout.write(`eido ${options.appVersion ?? 'version-unknown'}\n`)
      return PROFILE_JSON_CLI_EXIT_CODES.success
    } catch {
      return PROFILE_JSON_CLI_EXIT_CODES.internal
    }
  }
  if (plan.kind === 'batch') {
    return options.runRaw({
      stdin: options.stdin,
      stdout: options.stdout,
      stderr: options.stderr,
    })
  }
  if (plan.kind === 'describe') {
    const description = options.describeGateway()
    const value = plan.operation === undefined
      ? (plan.full ? description : describeEidoCliOperationSummary(description))
      : description.operations.find(operation => operation.name === plan.operation)
    if (!value) {
      const names = description.operations.map(operation => operation.name)
      const closest = closestEidoCliNames(plan.operation!, names)
      return writeEidoCliUsageFailure(options, {
        code: 'cli.usage',
        message: `Unknown operation ${JSON.stringify(plan.operation!)}.`,
        command: ['describe'],
        hint: closest.length > 0
          ? `Closest operations: ${closest.join(', ')}. Run \`eido describe\` for the full list.`
          : 'Run `eido describe` for the list of operations.',
      })
    }
    try {
      await options.stdout.write(`${JSON.stringify(value, null, plan.pretty ? 2 : undefined)}\n`)
      return PROFILE_JSON_CLI_EXIT_CODES.success
    } catch {
      return PROFILE_JSON_CLI_EXIT_CODES.internal
    }
  }
  if (plan.kind === 'mod-inspect' || plan.kind === 'mod-configure') {
    return runEidoCliModWorkflow(options, plan)
  }
  if (options.invoke) {
    try {
      const invoked = await options.invoke(plan.request)
      const output = Object.freeze({
        ...invoked.response,
        cli: Object.freeze({
          version: 1 as const,
          servedBy: invoked.servedBy,
          live: invoked.live,
        }),
      })
      await options.stdout.write(`${JSON.stringify(output, null, plan.pretty ? 2 : undefined)}\n`)
      if (invoked.response.ok) return PROFILE_JSON_CLI_EXIT_CODES.success
      try {
        await options.stderr.write(
          `Eido Profile inspection failed (${invoked.response.error.code}).\n`,
        )
      } catch {
        // JSON remains the machine-readable outcome.
      }
      return profileJsonCliExitCodeFor(invoked.response.error.code)
    } catch {
      return PROFILE_JSON_CLI_EXIT_CODES.internal
    }
  }
  if (!plan.pretty) {
    return options.runRaw({
      stdin: encodedRequest(plan.request),
      stdout: options.stdout,
      stderr: options.stderr,
    })
  }
  let captured = ''
  const exitCode = await options.runRaw({
    stdin: encodedRequest(plan.request),
    stdout: { write: value => { captured += value } },
    stderr: options.stderr,
  })
  if (captured.length === 0 && exitCode !== PROFILE_JSON_CLI_EXIT_CODES.success) {
    return exitCode
  }
  try {
    const value = JSON.parse(captured) as unknown
    await options.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
    return exitCode
  } catch {
    return PROFILE_JSON_CLI_EXIT_CODES.internal
  }
}

async function runEidoCliModWorkflow(
  options: EidoCliOptions,
  plan: EidoCliModInspectPlan | EidoCliModConfigurePlan,
): Promise<number> {
  try {
    const read = await invokeEidoCliRequest(options, plan.request)
    if (!read) return PROFILE_JSON_CLI_EXIT_CODES.internal
    if (!read.response.ok) return writeInvokedEidoCliResponse(options, plan.pretty, read)
    if (plan.kind === 'mod-inspect') {
      const inspection = projectEidoCliModInspection(plan, read.response)
      if (inspection === undefined) {
        return writeEidoCliUsageFailure(options, {
          code: 'cli.usage',
          message: 'That address does not hold one inspectable Mod.',
          command: ['mod', 'inspect'],
        })
      }
      await options.stdout.write(`${JSON.stringify(Object.freeze({
        version: 1,
        requestId: read.response.requestId,
        ok: true,
        result: inspection,
        cli: Object.freeze({
          version: 1 as const,
          servedBy: read.servedBy,
          live: read.live,
        }),
      }), null, plan.pretty ? 2 : undefined)}\n`)
      return PROFILE_JSON_CLI_EXIT_CODES.success
    }
    const request = completeEidoCliModConfigure(plan, read.response)
    if (!request) {
      return writeEidoCliUsageFailure(options, {
        code: 'cli.usage',
        message: 'The supplied --spec could not configure that Mod.',
        command: ['mod', 'configure'],
      })
    }
    const configured = await invokeEidoCliRequest(options, request)
    return configured
      ? writeInvokedEidoCliResponse(options, plan.pretty, configured)
      : PROFILE_JSON_CLI_EXIT_CODES.internal
  } catch {
    return PROFILE_JSON_CLI_EXIT_CODES.internal
  }
}

type EidoCliInvoked = Readonly<{
  response: ProfileGatewayResponse
  servedBy: 'live' | 'headless'
  live: Readonly<{
    state: 'served' | 'absent' | 'unavailable'
    reason?: string
    admission?: 'none' | 'admitted' | 'unknown'
    fallback?: 'headless' | 'forbidden'
  }>
}>

async function invokeEidoCliRequest(
  options: EidoCliOptions,
  request: ProfileGatewayRequest,
): Promise<EidoCliInvoked | undefined> {
  if (options.invoke) return options.invoke(request)
  let captured = ''
  const exitCode = await options.runRaw({
    stdin: encodedRequest(request),
    stdout: { write: value => { captured += value } },
    stderr: options.stderr,
  })
  if (captured.length === 0 && exitCode !== PROFILE_JSON_CLI_EXIT_CODES.success) return undefined
  const response = JSON.parse(captured) as ProfileGatewayResponse
  if (!response || response.version !== 1 || typeof response.ok !== 'boolean') return undefined
  return {
    response,
    servedBy: 'headless',
    live: { state: 'absent', admission: 'none', fallback: 'headless' },
  }
}

async function writeInvokedEidoCliResponse(
  options: EidoCliOptions,
  pretty: boolean,
  invoked: EidoCliInvoked,
): Promise<number> {
  const output = Object.freeze({
    ...invoked.response,
    cli: Object.freeze({
      version: 1 as const,
      servedBy: invoked.servedBy,
      live: invoked.live,
    }),
  })
  await options.stdout.write(`${JSON.stringify(output, null, pretty ? 2 : undefined)}\n`)
  if (invoked.response.ok) return PROFILE_JSON_CLI_EXIT_CODES.success
  try {
    await options.stderr.write(
      `Eido Profile inspection failed (${invoked.response.error.code}).\n`,
    )
  } catch {
    // JSON remains the machine-readable outcome.
  }
  return profileJsonCliExitCodeFor(invoked.response.error.code)
}

function boundedIdentity(
  candidate: string,
  maxBytes = EIDO_CLI_IDENTITY_MAX_BYTES,
): boolean {
  return candidate.length > 0
    && !EIDO_CLI_UNSAFE_IDENTITY.test(candidate)
    && new TextEncoder().encode(candidate).byteLength <= maxBytes
}

async function* encodedRequest(request: ProfileGatewayRequest): AsyncGenerator<Uint8Array> {
  yield new TextEncoder().encode(JSON.stringify(request))
}

/**
 * stdout carries the machine-readable envelope in the same shape as a Gateway
 * failure; stderr carries the human line that names the offending token.
 */
export async function writeEidoCliUsageFailure(
  io: Readonly<{ stdout: ProfileJsonCliWriter; stderr: ProfileJsonCliWriter }>,
  error: EidoCliUsageError,
  requestId?: string,
): Promise<number> {
  try {
    await io.stdout.write(`${JSON.stringify({
      version: 1,
      requestId: requestId ?? null,
      ok: false,
      error,
    })}\n`)
  } catch {
    // Exit status remains the stable machine signal when stdout is unavailable.
  }
  try {
    await io.stderr.write(renderEidoCliUsageDiagnostic(error))
  } catch {
    // Exit status remains the stable machine signal when diagnostics are unavailable.
  }
  return PROFILE_JSON_CLI_EXIT_CODES.invalid
}

/** One line per operation instead of every schema. */
function describeEidoCliOperationSummary(
  description: ProfileGatewayDescription,
): ProfileJsonValue {
  return {
    version: 1,
    operations: description.operations.map(operation => ({
      name: operation.name,
      summary: operation.summary,
      mutating: operation.mutating,
    })),
    hint: 'Run `eido describe <operation>` for one full schema, or `eido describe --full` for all of them.',
  } as ProfileJsonValue
}

/** A deprecation notice must not change stdout or the exit code. */
async function warnDeprecatedTextAlias(options: EidoCliOptions): Promise<void> {
  if (!usesEidoCliOptionToken(options.argv, '--text')) return
  try {
    await options.stderr.write(
      '--text is a deprecated alias for --body and will be removed. Use --body.\n',
    )
  } catch {
    // The command outcome remains authoritative.
  }
}

/** True when the token appears in option position, never as an option value. */
function usesEidoCliOptionToken(argv: readonly string[], token: string): boolean {
  let consumesOpaqueValue = false
  for (const argument of argv) {
    if (consumesOpaqueValue) {
      consumesOpaqueValue = false
      continue
    }
    if (argument === token) return true
    consumesOpaqueValue = eidoCliOptionConsumesValue(argument)
  }
  return false
}

function invokePlan(
  operation: ProfileGatewayRequest['operation'],
  params: Readonly<Record<string, ProfileJsonValue>>,
  pretty: boolean,
  createRequestId: () => string,
): EidoCliPlanAttempt {
  return {
    ok: true,
    plan: {
      kind: 'invoke',
      pretty,
      request: {
        version: 1,
        requestId: createRequestId(),
        operation,
        params,
      },
    },
  }
}

function parseListOptions(argv: readonly string[]): Readonly<Record<string, ProfileJsonValue>> | null {
  const params: Record<string, ProfileJsonValue> = {}
  const projection: string[] = []
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]
    const value = argv[index + 1]
    if (!option) return null
    if (value === undefined || value.length === 0) {
      recordEidoCliUsageDetail(missingOptionValueDetail(option))
      return null
    }
    switch (option) {
      case '--limit': {
        const parsed = boundedIntegerOption(option, value, params.limit !== undefined)
        if (parsed === undefined) return null
        params.limit = parsed
        break
      }
      case '--byte-limit': {
        const parsed = boundedIntegerOption(option, value, params.byteLimit !== undefined)
        if (parsed === undefined) return null
        params.byteLimit = parsed
        break
      }
      case '--cursor':
        if (params.cursor !== undefined) {
          recordEidoCliUsageDetail(duplicateOptionDetail(option))
          return null
        }
        params.cursor = value
        break
      case '--projection':
        if (projection.includes(value)) {
          recordEidoCliUsageDetail(duplicateOptionDetail(`${option} ${value}`))
          return null
        }
        projection.push(value)
        break
      default:
        recordEidoCliUsageDetail(unknownOptionDetail(option))
        return null
    }
  }
  if (projection.length > 0) params.projection = projection
  return params
}

function parseChangesOptions(
  argv: readonly string[],
): Readonly<Record<string, ProfileJsonValue>> | null {
  const arguments_ = parseNamedArguments(argv, {
    values: ['--since', '--limit', '--byte-limit', '--cursor'],
    switches: [],
  })
  if (!arguments_) return null
  const sinceValue = arguments_.values['--since']
  const limitValue = arguments_.values['--limit']
  const byteLimitValue = arguments_.values['--byte-limit']
  const since = sinceValue === undefined ? undefined : nonNegativeInteger(sinceValue)
  const limit = limitValue === undefined ? undefined : positiveInteger(limitValue)
  const byteLimit = byteLimitValue === undefined ? undefined : positiveInteger(byteLimitValue)
  if ((sinceValue !== undefined && since === undefined)
    || (limitValue !== undefined && limit === undefined)
    || (byteLimitValue !== undefined && byteLimit === undefined)) return null
  return {
    ...(since === undefined ? {} : { since }),
    ...(limit === undefined ? {} : { limit }),
    ...(byteLimit === undefined ? {} : { byteLimit }),
    ...(arguments_.values['--cursor'] === undefined
      ? {}
      : { cursor: arguments_.values['--cursor'] }),
  }
}

function parseGraphOptions(argv: readonly string[]): Readonly<Record<string, ProfileJsonValue>> | null {
  const params: Record<string, ProfileJsonValue> = {}
  const values = {
    recordKinds: [] as string[],
    recordIds: [] as string[],
    ownerIds: [] as string[],
    parentIds: [] as string[],
    projection: [] as string[],
  }
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index]
    const value = argv[index + 1]
    if (!option) return null
    if (value === undefined || value.length === 0) {
      recordEidoCliUsageDetail(missingOptionValueDetail(option))
      return null
    }
    switch (option) {
      case '--creator':
        if (params.creator !== undefined) {
          recordEidoCliUsageDetail(duplicateOptionDetail(option))
          return null
        }
        if (!CARD_CREATOR_KINDS.includes(value as (typeof CARD_CREATOR_KINDS)[number])) {
          recordEidoCliUsageDetail(invalidOptionValueDetail(option, value))
          return null
        }
        params.creator = value
        break
      case '--kind':
        if (!appendUnique(values.recordKinds, value)) return null
        break
      case '--record':
      case '--card': {
        const recordId = addressId(value, 'card')
        if (!recordId || !appendUnique(values.recordIds, recordId)) {
          recordEidoCliUsageDetail(invalidAddressDetail(value))
          return null
        }
        break
      }
      case '--owner': {
        const ownerId = plainId(value)
        if (!ownerId || !appendUnique(values.ownerIds, ownerId)) return null
        break
      }
      case '--idea': {
        const ideaId = addressId(value, 'idea')
        const ownerId = ideaId === undefined ? undefined : `board:${ideaId}`
        if (!ownerId || !appendUnique(values.ownerIds, ownerId)) return null
        break
      }
      case '--parent': {
        const parentId = addressId(value, 'card')
        if (!parentId || !appendUnique(values.parentIds, parentId)) return null
        break
      }
      case '--limit': {
        const parsed = boundedIntegerOption(option, value, params.limit !== undefined)
        if (parsed === undefined) return null
        params.limit = parsed
        break
      }
      case '--byte-limit': {
        const parsed = boundedIntegerOption(option, value, params.byteLimit !== undefined)
        if (parsed === undefined) return null
        params.byteLimit = parsed
        break
      }
      case '--cursor':
        if (params.cursor !== undefined) {
          recordEidoCliUsageDetail(duplicateOptionDetail(option))
          return null
        }
        params.cursor = value
        break
      case '--projection':
        if (!appendUnique(values.projection, value)) {
          recordEidoCliUsageDetail(duplicateOptionDetail(`${option} ${value}`))
          return null
        }
        break
      default:
        recordEidoCliUsageDetail(unknownOptionDetail(option))
        return null
    }
  }
  for (const [key, entries] of Object.entries(values)) {
    if (entries.length > 0) params[key] = entries
  }
  return Object.keys(params).length > 0 ? params : null
}

function addressId(value: string, part: 'card' | 'idea'): string | undefined {
  const link = parseCardDeepLink(value)
  if (link) {
    const candidate = part === 'card' ? link.cardId : link.ideaId
    return boundedIdentity(candidate, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
      ? candidate
      : undefined
  }
  return plainId(value)
}

function plainId(value: string): string | undefined {
  return boundedIdentity(value, PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes)
    && !value.includes('://')
    ? value
    : undefined
}

function resolveCardAddress(
  value: string,
  explicitIdea: string | undefined,
): Readonly<{ ideaId: string; cardId: string }> | null {
  const link = parseCardDeepLink(value)
  if (link) {
    const explicitIdeaId = explicitIdea === undefined ? undefined : addressId(explicitIdea, 'idea')
    if (explicitIdea !== undefined && explicitIdeaId !== link.ideaId) return null
    return { ideaId: link.ideaId, cardId: link.cardId }
  }
  const cardId = addressId(value, 'card')
  const ideaId = explicitIdea === undefined ? undefined : addressId(explicitIdea, 'idea')
  if (!cardId) recordEidoCliUsageDetail(invalidAddressDetail(value))
  else if (!ideaId) {
    recordEidoCliUsageDetail({
      code: 'cli.usage',
      message: `Address ${JSON.stringify(value)} needs --idea IDEA, or use a Card Deep Link.`,
    })
  }
  return cardId && ideaId ? { ideaId, cardId } : null
}

function resolveConnectionAddresses(
  from: string,
  to: string,
  explicitIdea: string | undefined,
): Readonly<{ ideaId: string; fromCardId: string; toCardId: string }> | null {
  const fromLink = parseCardDeepLink(from)
  const toLink = parseCardDeepLink(to)
  const fromCardId = fromLink?.cardId ?? addressId(from, 'card')
  const toCardId = toLink?.cardId ?? addressId(to, 'card')
  const explicitIdeaId = explicitIdea === undefined ? undefined : addressId(explicitIdea, 'idea')
  const ideaIds = [fromLink?.ideaId, toLink?.ideaId, explicitIdeaId]
    .filter((value): value is string => value !== undefined)
  if (!fromCardId || !toCardId || ideaIds.length === 0 || new Set(ideaIds).size !== 1) return null
  return { ideaId: ideaIds[0]!, fromCardId, toCardId }
}

function resolveCardSetAddresses(
  values: readonly string[],
  explicitIdea: string | undefined,
): Readonly<{ ideaId: string; cardIds: readonly string[] }> | null {
  const explicitIdeaId = explicitIdea === undefined ? undefined : addressId(explicitIdea, 'idea')
  if (explicitIdea !== undefined && explicitIdeaId === undefined) return null
  const links = values.map(value => parseCardDeepLink(value))
  const cardIds = values.map((value, index) => links[index]?.cardId ?? addressId(value, 'card'))
  const ideaIds = [explicitIdeaId, ...links.map(link => link?.ideaId)]
    .filter((value): value is string => value !== undefined)
  if (cardIds.some(cardId => cardId === undefined)
    || ideaIds.length === 0
    || new Set(ideaIds).size !== 1) return null
  return { ideaId: ideaIds[0]!, cardIds: cardIds as string[] }
}

function appendUnique(values: string[], value: string): boolean {
  if (values.includes(value)) return false
  values.push(value)
  return true
}

/** Reports the offending option and value instead of failing anonymously. */
function boundedIntegerOption(
  option: string,
  value: string,
  duplicate: boolean,
): number | undefined {
  if (duplicate) {
    recordEidoCliUsageDetail(duplicateOptionDetail(option))
    return undefined
  }
  const parsed = positiveInteger(value)
  if (parsed === undefined) recordEidoCliUsageDetail(invalidOptionValueDetail(option, value))
  return parsed
}

function positiveInteger(value: string): number | undefined {
  if (!/^[1-9][0-9]*$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}

type NamedArguments = Readonly<{
  values: Readonly<Record<string, string>>
  repeatedValues: Readonly<Record<string, readonly string[]>>
  switches: ReadonlySet<string>
}>

function parseNamedArguments(
  argv: readonly string[],
  allowed: Readonly<{
    values: readonly string[]
    repeatableValues?: readonly string[]
    allowEmptyValues?: readonly string[]
    switches: readonly string[]
  }>,
): NamedArguments | null {
  const values: Record<string, string> = {}
  const repeatedValues: Record<string, string[]> = {}
  const switches = new Set<string>()
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index]
    if (!option) return null
    if (allowed.switches.includes(option)) {
      if (switches.has(option)) {
        recordEidoCliUsageDetail(duplicateOptionDetail(option))
        return null
      }
      switches.add(option)
      continue
    }
    const repeatable = allowed.repeatableValues?.includes(option) === true
    if (!allowed.values.includes(option) && !repeatable) {
      recordEidoCliUsageDetail(unknownOptionDetail(option))
      return null
    }
    if (!repeatable && values[option] !== undefined) {
      recordEidoCliUsageDetail(duplicateOptionDetail(option))
      return null
    }
    const value = argv[index + 1]
    if (value === undefined
      || (value.length === 0 && allowed.allowEmptyValues?.includes(option) !== true)) {
      recordEidoCliUsageDetail(missingOptionValueDetail(option))
      return null
    }
    if (repeatable) {
      const entries = repeatedValues[option] ?? []
      entries.push(value)
      repeatedValues[option] = entries
    } else {
      values[option] = value
    }
    index += 1
  }
  return { values, repeatedValues, switches }
}

function mutationIdentity(
  arguments_: NamedArguments,
  createIdentity: () => string,
  intent: readonly string[],
): Readonly<{
  requestId: string
  expectedRevision: number
  idempotencyKey: string
  commandId: string
  dryRun: boolean
}> | null {
  const expectedRevision = nonNegativeInteger(arguments_.values['--expected-revision'])
  const dryRun = arguments_.switches.has('--dry-run')
  const apply = arguments_.switches.has('--apply')
  if (expectedRevision === undefined) {
    const supplied = arguments_.values['--expected-revision']
    recordEidoCliUsageDetail(supplied === undefined
      ? {
          code: 'cli.usage',
          message: 'Every mutation needs --expected-revision N. Read N from `eido status`.',
        }
      : invalidOptionValueDetail('--expected-revision', supplied))
    return null
  }
  if (dryRun === apply) {
    recordEidoCliUsageDetail({
      code: 'cli.usage',
      message: 'Every mutation needs exactly one of --dry-run or --apply.',
      hint: '--apply is the confirmation bypass (the --yes equivalent); preview first with --dry-run.',
    })
    return null
  }
  const requestId = arguments_.values['--request-id'] ?? createIdentity()
  const idempotencyKey = arguments_.values['--idempotency-key']
    ?? deriveEidoCliIdempotencyKey(intent)
  const commandId = arguments_.values['--command-id'] ?? `command:${idempotencyKey}`
  return { requestId, expectedRevision, idempotencyKey, commandId, dryRun }
}

function mutationInvokePlan(input: Readonly<{
  requestId: string
  expectedRevision: number
  idempotencyKey: string
  commandId: string
  dryRun: boolean
  pretty: boolean
  command?: Readonly<Record<string, ProfileJsonValue>>
  commands?: readonly Readonly<Record<string, ProfileJsonValue>>[]
}>): EidoCliPlanAttempt {
  const commands = input.commands ?? (input.command === undefined ? [] : [input.command])
  return {
    ok: true,
    plan: {
      kind: 'invoke',
      pretty: input.pretty,
      request: {
        version: 1,
        requestId: input.requestId,
        operation: 'command.batch',
        params: {
          version: 1,
          schemaVersion: 1,
          expectedRevision: input.expectedRevision,
          idempotencyKey: input.idempotencyKey,
          dryRun: input.dryRun,
          commands: [...commands],
        },
      },
    },
  }
}

function finiteNumber(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function nonNegativeInteger(value: string | undefined): number | undefined {
  if (value === undefined || !/^(?:0|[1-9][0-9]*)$/.test(value)) return undefined
  const parsed = Number(value)
  return Number.isSafeInteger(parsed) ? parsed : undefined
}
