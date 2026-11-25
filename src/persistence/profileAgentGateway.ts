import {
  PROFILE_GATEWAY_PROTOCOL_VERSION,
  PROFILE_INSPECTION_QUERY_NAMES,
  PROFILE_QUERYABLE_RECORD_KINDS,
  PROFILE_QUERY_LIMITS,
  PROFILE_SERVICE_ERROR_CODES,
  PROFILE_SERVICE_FAILURE_CONTRACTS,
  profileServiceFailure,
  validateProfileQuery,
  type LocalProfileService,
  type NormalizedProfileQuery,
  type ProfileCapabilities,
  type ProfileJsonValue,
  type ProfileQueryPage,
  type ProfileServiceFailure,
  type ProfileServiceResult,
  type ProfileStatus,
} from './profileServiceContract'
import {
  INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_CAPABILITY,
  INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES,
  INSTALLED_PROFILE_AGENT_COMMAND_DESCRIPTORS,
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
  executeInstalledProfileAgentCommandBatch,
  validateInstalledProfileAgentCommandRequest,
  type ProfileAgentCommandBatchReceipt,
} from './profileAgentCommandInstallation'
import {
  PROFILE_AGENT_COMMAND_LIMITS,
  PROFILE_AGENT_COMMAND_RESULT_LIMITS,
  type ProfileAgentCommandName,
} from './profileAgentCommandManifest'
import type { ProfileAgentCommandRequest } from './profileAgentCommandPlan'
import { CARD_CREATOR_KINDS } from '../graph/cardAuthorship'
import { CARD_IDENTITY_PRESETS } from '../graph/cardIdentityPresets'
import { CONVERSATION_STYLES } from '../graph/types'
import { MOD_PART_BOUNDS } from '../mods/growth'
import { MOD_KIND_ORDER, type ModKind } from '../mods/model'
import {
  PROFILE_AGENT_CHANGE_TRAIL_LIMITS,
  validateProfileAgentChangeTrailRequest,
  type NormalizedProfileAgentChangeTrailRequest,
  type ProfileAgentChangeTrailPage,
} from './profileAgentChangeTrail'
import {
  PROFILE_AGENT_SPATIAL_QUERY_LIMITS,
  normalizeProfileAgentCardNeighborsRequest,
  normalizeProfileAgentCardSetBoundsRequest,
  type NormalizedProfileAgentCardNeighborsRequest,
  type ProfileAgentCardNeighbors,
  type ProfileAgentCardSetBounds,
  type ProfileAgentCardSetBoundsRequest,
} from './profileAgentSpatialQuery'
import {
  validateProfileResultInspectionRequest,
  type NormalizedProfileResultInspectionRequest,
  type ProfileResultInspectionPage,
} from './profileResultInspection'
import {
  AGENT_RUN_ARTIFACT_READ_LIMITS,
  AGENT_RUN_VARIATION_LIMITS,
  normalizeAgentRunSubmitRequest,
  type AgentRunArtifactPage,
  type AgentRunJobStatus,
  type AgentRunReadRequest,
  type AgentRunStatusRequest,
  type AgentRunSubmissionReceipt,
  type AgentRunSubmitRequest,
} from '../brain/agentRunContract'
import {
  DEFAULT_AGENT_RUN_APP_CAP,
  DEFAULT_AGENT_RUN_JOB_RETENTION,
  DEFAULT_AGENT_RUN_SESSION_CAP,
} from '../brain/agentRunSession'
import {
  PROFILE_AGENT_RUN_GATEWAY_FAILURES,
  PROFILE_AGENT_RUN_GATEWAY_OPERATIONS,
  profileAgentRunLiveRequiredGatewayFailure,
  profileAgentRunSubmitOutcomeUnknownGatewayFailure,
  type ProfileAgentRunGatewayFailureReason,
  type ProfileAgentRunGatewayInvocationResult,
} from './profileAgentRunGateway'

export type ProfileGatewayService = Pick<LocalProfileService, 'status' | 'capabilities' | 'query'> & Readonly<{
  inspectResult?(
    request: NormalizedProfileResultInspectionRequest,
  ): Promise<ProfileServiceResult<ProfileResultInspectionPage>>
  changes?(
    request: NormalizedProfileAgentChangeTrailRequest,
  ): Promise<ProfileServiceResult<ProfileAgentChangeTrailPage>>
  applyAgentCommandBatch?(
    request: ProfileAgentCommandRequest,
  ): Promise<ProfileServiceResult<ProfileAgentCommandBatchReceipt>>
  agentCardNeighbors?(
    request: NormalizedProfileAgentCardNeighborsRequest,
  ): Promise<ProfileServiceResult<ProfileAgentCardNeighbors>>
  agentCardSetBounds?(
    request: ProfileAgentCardSetBoundsRequest,
  ): Promise<ProfileServiceResult<ProfileAgentCardSetBounds>>
  submitAgentRun?(
    request: AgentRunSubmitRequest,
  ): Promise<ProfileAgentRunGatewayInvocationResult<AgentRunSubmissionReceipt>>
  statusAgentRun?(
    request: AgentRunStatusRequest,
  ): Promise<ProfileAgentRunGatewayInvocationResult<AgentRunJobStatus>>
  readAgentRun?(
    request: AgentRunReadRequest,
  ): Promise<ProfileAgentRunGatewayInvocationResult<AgentRunArtifactPage>>
}>

export const PROFILE_GATEWAY_REQUEST_LIMITS = {
  maxRequestIdBytes: 256,
  maxOperationBytes: 128,
  maxJsonDepth: 32,
  maxJsonNodes: 10_000,
} as const

export const PROFILE_GATEWAY_OPERATION_NAMES = Object.freeze([
  ...PROFILE_INSPECTION_QUERY_NAMES,
  'agent.capabilities',
  'result.inspect',
  'graph.neighbors',
  'graph.bounds',
  'changes.list',
  'command.batch',
  ...PROFILE_AGENT_RUN_GATEWAY_OPERATIONS,
] as const)

export type ProfileGatewayOperationName = (typeof PROFILE_GATEWAY_OPERATION_NAMES)[number]

export const PROFILE_GATEWAY_ADAPTERS = Object.freeze(['cli', 'mcp'] as const)
export type ProfileGatewayAdapter = (typeof PROFILE_GATEWAY_ADAPTERS)[number]

export type ProfileGatewayInputSchema = Readonly<{
  type: 'object'
  properties: Readonly<Record<string, ProfileJsonValue>>
  required?: readonly string[]
  anyOf?: readonly Readonly<{ required: readonly string[] }>[]
  oneOf?: readonly ProfileGatewayInputSchema[]
  additionalProperties: false
}>

export type ProfileGatewayOperationDescription = Readonly<{
  name: ProfileGatewayOperationName
  summary: string
  version: typeof PROFILE_GATEWAY_PROTOCOL_VERSION
  availability: 'installed' | 'live-app'
  adapters: readonly ProfileGatewayAdapter[]
  agentCliDiscoverable: boolean
  mutating: boolean
  schema: Readonly<{
    version: 1
    input: ProfileGatewayInputSchema
  }>
  limits: Readonly<{
    request: typeof PROFILE_GATEWAY_REQUEST_LIMITS
    query?: typeof PROFILE_QUERY_LIMITS
    changes?: typeof PROFILE_AGENT_CHANGE_TRAIL_LIMITS
    spatial?: typeof PROFILE_AGENT_SPATIAL_QUERY_LIMITS
    agentRunArtifacts?: typeof AGENT_RUN_ARTIFACT_READ_LIMITS
    commandBatch?: Readonly<{
      request: typeof PROFILE_AGENT_COMMAND_LIMITS
      result: typeof PROFILE_AGENT_COMMAND_RESULT_LIMITS
    }>
  }>
}>

export function profileGatewayOperationSupportsAdapter(
  operation: ProfileGatewayOperationDescription,
  adapter: ProfileGatewayAdapter,
): boolean {
  return operation.adapters.includes(adapter)
}

export type ProfileGatewayDescription = Readonly<{
  version: typeof PROFILE_GATEWAY_PROTOCOL_VERSION
  failures: readonly Readonly<{
    code: (typeof PROFILE_SERVICE_ERROR_CODES)[number]
    reason?: ProfileAgentRunGatewayFailureReason
    retryable: boolean
    message: string
  }>[]
  operations: readonly ProfileGatewayOperationDescription[]
  agentCapabilities: ProfileAgentCapabilityDiscovery
}>

export type ProfileAgentCapabilityClass = Readonly<{
  version: number
  limits: Readonly<Record<string, number>>
  capabilities: readonly Readonly<{
    name: string
    summary: string
    version: number
    details?: unknown
  }>[]
}>

export type ProfileAgentCapabilityDiscovery = Readonly<{
  version: 1
  commandSurfaceVersion: typeof INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_CAPABILITY.version
  classes: Readonly<{
    enabled: ProfileAgentCapabilityClass
    humanOnly: ProfileAgentCapabilityClass
    systemOnly: ProfileAgentCapabilityClass
    prohibited: ProfileAgentCapabilityClass
  }>
}>

export type ProfileGatewayRequest = Readonly<{
  version: typeof PROFILE_GATEWAY_PROTOCOL_VERSION
  requestId: string
  operation: ProfileGatewayOperationName
  params: Readonly<Record<string, ProfileJsonValue>>
}>

export type ProfileGatewayResult =
  | ProfileStatus
  | ProfileCapabilities
  | ProfileQueryPage
  | ProfileResultInspectionPage
  | ProfileAgentChangeTrailPage
  | ProfileAgentCommandBatchReceipt
  | ProfileAgentCapabilityDiscovery
  | ProfileAgentCardNeighbors
  | ProfileAgentCardSetBounds
  | AgentRunSubmissionReceipt
  | AgentRunJobStatus
  | AgentRunArtifactPage

export type ProfileGatewayResponse =
  | Readonly<{
    version: typeof PROFILE_GATEWAY_PROTOCOL_VERSION
    requestId: string
    ok: true
    result: ProfileGatewayResult
  }>
  | Readonly<{
    version: typeof PROFILE_GATEWAY_PROTOCOL_VERSION
    requestId: string | null
    ok: false
    error: Readonly<Omit<ProfileServiceFailure, 'ok'> & {
      reason?: ProfileAgentRunGatewayFailureReason
    }>
  }>

export type ProfileGatewaySessionService = Readonly<
  ProfileGatewayService & { close(): Promise<void> }
>

export type ProfileGatewaySession = Readonly<{
  describe(): ProfileGatewayDescription
  describeAgentCli(): ProfileGatewayDescription
  invoke(candidate: unknown): Promise<ProfileGatewayResponse>
  close(): Promise<void>
}>

export type ProfileGatewaySessionOptions = Readonly<{
  openService(): Promise<ProfileServiceResult<ProfileGatewaySessionService>>
}>

export function createProfileGatewaySession(
  options: ProfileGatewaySessionOptions,
): ProfileGatewaySession {
  let admitting = true
  let opening: Promise<ProfileServiceResult<ProfileGatewaySessionService>> | undefined
  let closePromise: Promise<void> | undefined
  const accepted = new Set<Promise<ProfileGatewayResponse>>()

  const acquire = (): Promise<ProfileServiceResult<ProfileGatewaySessionService>> => {
    opening ??= Promise.resolve()
      .then(() => options.openService())
      .catch(() => profileServiceFailure('internal'))
    return opening
  }

  async function withService<Result>(
    invoke: (service: ProfileGatewaySessionService) => Promise<ProfileServiceResult<Result>>,
  ): Promise<ProfileServiceResult<Result>> {
    const opened = await acquire()
    return opened.ok ? invoke(opened.value) : opened
  }

  const lazyService: ProfileGatewayService = Object.freeze({
    status() {
      return withService((service) => service.status())
    },
    capabilities() {
      return withService((service) => service.capabilities())
    },
    query(request) {
      return withService((service) => service.query(request))
    },
    inspectResult(request) {
      return withService((service) => (
        typeof service.inspectResult === 'function'
          ? service.inspectResult(request)
          : Promise.resolve(profileServiceFailure('capability-denied'))
      ))
    },
    changes(request) {
      return withService((service) => (
        typeof service.changes === 'function'
          ? service.changes(request)
          : Promise.resolve(profileServiceFailure('capability-denied'))
      ))
    },
    applyAgentCommandBatch(request) {
      return withService((service) => (
        typeof service.applyAgentCommandBatch === 'function'
          ? service.applyAgentCommandBatch(request)
          : Promise.resolve(profileServiceFailure('capability-denied'))
      ))
    },
    agentCardNeighbors(request) {
      return withService((service) => (
        typeof service.agentCardNeighbors === 'function'
          ? service.agentCardNeighbors(request)
          : Promise.resolve(profileServiceFailure('capability-denied'))
      ))
    },
    agentCardSetBounds(request) {
      return withService((service) => (
        typeof service.agentCardSetBounds === 'function'
          ? service.agentCardSetBounds(request)
          : Promise.resolve(profileServiceFailure('capability-denied'))
      ))
    },
    submitAgentRun(request) {
      return withService((service) => (
        typeof service.submitAgentRun === 'function'
          ? service.submitAgentRun(request)
          : Promise.resolve(profileAgentRunLiveRequiredGatewayFailure('run.submit'))
      ))
    },
    statusAgentRun(request) {
      return withService((service) => (
        typeof service.statusAgentRun === 'function'
          ? service.statusAgentRun(request)
          : Promise.resolve(profileAgentRunLiveRequiredGatewayFailure('run.status'))
      ))
    },
    readAgentRun(request) {
      return withService((service) => (
        typeof service.readAgentRun === 'function'
          ? service.readAgentRun(request)
          : Promise.resolve(profileAgentRunLiveRequiredGatewayFailure('run.read'))
      ))
    },
  })

  const session: ProfileGatewaySession = Object.freeze({
    describe() {
      return INSTALLED_PROFILE_GATEWAY_DESCRIPTION
    },
    describeAgentCli() {
      return INSTALLED_PROFILE_AGENT_CLI_GATEWAY_DESCRIPTION
    },
    invoke(candidate) {
      if (!admitting) {
        return Promise.resolve(createProfileGatewayFailureResponse(
          readSafeRequestId(candidate),
          profileServiceFailure('busy'),
        ))
      }
      const invocation = executeProfileGatewayRequest(lazyService, candidate)
      accepted.add(invocation)
      void invocation.then(
        () => accepted.delete(invocation),
        () => accepted.delete(invocation),
      )
      return invocation
    },
    close() {
      if (closePromise) return closePromise
      admitting = false
      closePromise = (async () => {
        while (accepted.size > 0) await Promise.allSettled([...accepted])
        if (!opening) return
        const opened = await opening
        if (opened.ok) await opened.value.close()
      })()
      return closePromise
    },
  })
  return session
}

type ProfileGatewayOperationPlan = (
  service: ProfileGatewayService,
) => Promise<ProfileServiceResult<ProfileGatewayResult>>

type InstalledProfileGatewayOperationDescriptor = ProfileGatewayOperationDescription & Readonly<{
  agentCliInput?: ProfileGatewayInputSchema
  planner(candidate: unknown): ProfileServiceResult<ProfileGatewayOperationPlan>
}>

const EMPTY_INPUT_SCHEMA = profileGatewayInputSchema({})
const LIST_INPUT_SCHEMA = profileGatewayInputSchema({
  byteLimit: integerSchema(2, PROFILE_QUERY_LIMITS.maxBytes),
  cursor: { type: 'string', minLength: 1 },
  limit: integerSchema(1, PROFILE_QUERY_LIMITS.maxItems),
  projection: stringArraySchema(PROFILE_QUERY_LIMITS.maxProjectionFields),
})
const QUERY_INPUT_SCHEMA = profileGatewayInputSchema({
  creator: { type: 'string', enum: [...CARD_CREATOR_KINDS] },
  recordKinds: {
    type: 'array',
    minItems: 1,
    maxItems: PROFILE_QUERY_LIMITS.maxFilterValues,
    uniqueItems: true,
    items: { type: 'string', enum: [...PROFILE_QUERYABLE_RECORD_KINDS] },
  },
  recordIds: stringArraySchema(PROFILE_QUERY_LIMITS.maxFilterValues, 1),
  ownerIds: stringArraySchema(PROFILE_QUERY_LIMITS.maxFilterValues, 1),
  parentIds: {
    type: 'array',
    minItems: 1,
    maxItems: PROFILE_QUERY_LIMITS.maxFilterValues,
    uniqueItems: true,
    items: { type: ['string', 'null'] },
  },
  limit: integerSchema(1, PROFILE_QUERY_LIMITS.maxItems),
  byteLimit: integerSchema(2, PROFILE_QUERY_LIMITS.maxBytes),
  cursor: { type: 'string', minLength: 1 },
  projection: stringArraySchema(PROFILE_QUERY_LIMITS.maxProjectionFields),
}, { atLeastOneOf: ['recordKinds', 'recordIds', 'ownerIds', 'parentIds', 'creator'] })
const RECORD_GET_INPUT_SCHEMA = profileGatewayInputSchema({
  recordId: { type: 'string', minLength: 1 },
  byteLimit: integerSchema(2, PROFILE_QUERY_LIMITS.maxBytes),
  projection: stringArraySchema(PROFILE_QUERY_LIMITS.maxProjectionFields),
}, { required: ['recordId'] })
const RESULT_INSPECT_INPUT_SCHEMA = profileGatewayInputSchema({
  ideaId: { type: 'string', minLength: 1 },
  resultCardId: { type: 'string', minLength: 1 },
  limit: integerSchema(1, PROFILE_QUERY_LIMITS.maxItems),
  byteLimit: integerSchema(2, PROFILE_QUERY_LIMITS.maxBytes),
  cursor: { type: 'string', minLength: 1 },
}, { required: ['ideaId', 'resultCardId'] })
const CHANGES_INPUT_SCHEMA = profileGatewayInputSchema({
  since: { type: 'integer', minimum: 0 },
  limit: integerSchema(1, PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxItems),
  byteLimit: integerSchema(2, PROFILE_AGENT_CHANGE_TRAIL_LIMITS.maxBytes),
  cursor: { type: 'string', minLength: 1 },
})
const GRAPH_NEIGHBORS_INPUT_SCHEMA = profileGatewayInputSchema({
  ideaId: { type: 'string', minLength: 1 },
  card: { type: 'string', minLength: 1 },
  limit: integerSchema(1, PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxNeighbors),
  byteLimit: integerSchema(
    PROFILE_AGENT_SPATIAL_QUERY_LIMITS.minBytes,
    PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxBytes,
  ),
}, { required: ['ideaId', 'card'] })
const GRAPH_BOUNDS_INPUT_SCHEMA = profileGatewayInputSchema({
  ideaId: { type: 'string', minLength: 1 },
  cards: {
    type: 'array',
    minItems: 1,
    maxItems: PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxBoundingCards,
    items: { type: 'string', minLength: 1 },
  },
}, { required: ['ideaId', 'cards'] })
const RUN_SUBMIT_IDENTITY_PROPERTIES = Object.freeze({
  ideaId: { type: 'string', minLength: 1 },
  targetCardId: { type: 'string', minLength: 1 },
})
const RUN_SUBMIT_VARIATION_PROPERTIES = Object.freeze({
  ...RUN_SUBMIT_IDENTITY_PROPERTIES,
  mode: { type: 'string', enum: ['variations'] },
  variationCount: integerSchema(1, AGENT_RUN_VARIATION_LIMITS.maxCount),
})
const RUN_SUBMIT_INPUT_SCHEMA: ProfileGatewayInputSchema = deepFreeze({
  type: 'object' as const,
  properties: RUN_SUBMIT_VARIATION_PROPERTIES,
  oneOf: [
    {
      type: 'object' as const,
      properties: RUN_SUBMIT_IDENTITY_PROPERTIES,
      required: ['ideaId', 'targetCardId'],
      additionalProperties: false as const,
    },
    {
      type: 'object' as const,
      properties: RUN_SUBMIT_VARIATION_PROPERTIES,
      required: ['ideaId', 'targetCardId', 'mode', 'variationCount'],
      additionalProperties: false as const,
    },
  ],
  additionalProperties: false as const,
})
const RUN_STATUS_INPUT_SCHEMA = profileGatewayInputSchema({
  runId: { type: 'string', minLength: 1 },
}, { required: ['runId'] })
const RUN_READ_INPUT_SCHEMA = profileGatewayInputSchema({
  runId: { type: 'string', minLength: 1 },
  limit: integerSchema(1, AGENT_RUN_ARTIFACT_READ_LIMITS.maxItems),
  byteLimit: integerSchema(2, AGENT_RUN_ARTIFACT_READ_LIMITS.maxBytes),
  cursor: { type: 'string', minLength: 1 },
}, { required: ['runId'] })
const COMMAND_BATCH_INPUT_SCHEMA = commandBatchInputSchema(INSTALLED_PROFILE_AGENT_COMMAND_NAMES)
const AGENT_COMMAND_BATCH_INPUT_SCHEMA = commandBatchInputSchema(
  INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_NAMES,
)

const REQUEST_LIMITS = Object.freeze({
  request: Object.freeze({ ...PROFILE_GATEWAY_REQUEST_LIMITS }),
})
const QUERY_OPERATION_LIMITS = Object.freeze({
  request: REQUEST_LIMITS.request,
  query: Object.freeze({ ...PROFILE_QUERY_LIMITS }),
})
const COMMAND_OPERATION_LIMITS = Object.freeze({
  request: REQUEST_LIMITS.request,
  commandBatch: Object.freeze({
    request: Object.freeze({ ...PROFILE_AGENT_COMMAND_LIMITS }),
    result: Object.freeze({ ...PROFILE_AGENT_COMMAND_RESULT_LIMITS }),
  }),
})
const CHANGES_OPERATION_LIMITS = Object.freeze({
  request: REQUEST_LIMITS.request,
  changes: PROFILE_AGENT_CHANGE_TRAIL_LIMITS,
})
const SPATIAL_OPERATION_LIMITS = Object.freeze({
  request: REQUEST_LIMITS.request,
  spatial: PROFILE_AGENT_SPATIAL_QUERY_LIMITS,
})
const AGENT_RUN_OPERATION_LIMITS = Object.freeze({
  request: REQUEST_LIMITS.request,
  agentRunArtifacts: AGENT_RUN_ARTIFACT_READ_LIMITS,
})

export const INSTALLED_PROFILE_AGENT_CAPABILITY_DISCOVERY: ProfileAgentCapabilityDiscovery =
  deepFreeze({
    version: 1 as const,
    commandSurfaceVersion: INSTALLED_PROFILE_AGENT_DISCOVERABLE_COMMAND_CAPABILITY.version,
    classes: {
      enabled: {
        version: 5,
        limits: {
          maxCommands: PROFILE_AGENT_COMMAND_LIMITS.maxCommands,
          maxRequestBytes: PROFILE_AGENT_COMMAND_LIMITS.maxRequestBytes,
          maxTextBytes: PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes,
          maxNearCards: PROFILE_AGENT_COMMAND_LIMITS.maxNearCards,
          maxConversationTurns: PROFILE_AGENT_COMMAND_LIMITS.maxConversationTurns,
          maxNeighbors: PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxNeighbors,
          maxSpatialBytes: PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxBytes,
          maxAgentRunSessionRuns: DEFAULT_AGENT_RUN_SESSION_CAP.maxRuns,
          maxAgentRunSessionPlannedSteps: DEFAULT_AGENT_RUN_SESSION_CAP.maxPlannedSteps,
          maxAgentRunAppRuns: DEFAULT_AGENT_RUN_APP_CAP.maxRuns,
          maxAgentRunAppPlannedSteps: DEFAULT_AGENT_RUN_APP_CAP.maxPlannedSteps,
          maxAgentRunAppSessions: DEFAULT_AGENT_RUN_APP_CAP.maxSessions,
          maxAgentRunRetainedJobs: DEFAULT_AGENT_RUN_JOB_RETENTION.maxRetainedJobs,
          maxAgentRunArtifactItems: AGENT_RUN_ARTIFACT_READ_LIMITS.maxItems,
          maxAgentRunArtifactBytes: AGENT_RUN_ARTIFACT_READ_LIMITS.maxBytes,
        },
        capabilities: [
          {
            name: 'card.create',
            summary: 'Create agent-authored thought structure at an explicit position or beside canonical anchors.',
            version: 3,
            details: {
              kinds: {
                note: ['body'],
                askAi: ['body'],
                title: ['body'],
                group: ['groupTitle', 'compressionPrompt'],
                conversation: ['topic', 'conversationStyle', 'conversationTurns'],
              },
              placement: { exactlyOneOf: ['position', 'near'], deepLinkViewportIsHintOnly: true },
              result: ['cardId', 'blockId', 'position'],
              effects: ['card', 'block'],
              conditionalEffects: false,
            },
          },
          {
            name: 'card.update-content',
            summary: 'Edit only the domain-owned fields for a supported Card kind.',
            version: 3,
            details: {
              kinds: {
                note: ['body'],
                askAi: ['body'],
                title: ['body'],
                group: ['groupTitle', 'compressionPrompt'],
                conversation: ['topic', 'conversationStyle', 'conversationTurns'],
              },
              effects: ['card', 'block'],
              conditionalEffects: true,
            },
          },
          {
            name: 'card.delete',
            summary: 'Delete supported thought structure or clean up a Result with its full recorded cascade.',
            version: 3,
            details: {
              kinds: ['note', 'askAi', 'title', 'group', 'conversation', 'result'],
              effects: [...INSTALLED_PROFILE_AGENT_COMMAND_DESCRIPTORS['card.delete'].effects],
              conditionalEffects: true,
            },
          },
          {
            name: 'connection.create',
            summary: 'Connect supported Cards; Ask-to-Ask may create an empty structural Result shell.',
            version: 3,
            details: {
              kinds: ['note', 'askAi', 'result', 'mod', 'group', 'conversation'],
              excludedKinds: ['title'],
              effects: ['card', 'block', 'connection'],
              conditionalEffects: true,
            },
          },
          {
            name: 'connection.update-meaning',
            summary: 'Update strength, polarity, reason, or Group mode on an existing Connection.',
            version: 3,
            details: { effects: ['connection'], conditionalEffects: false },
          },
          {
            name: 'connection.delete',
            summary: 'Delete an existing Connection.',
            version: 3,
            details: { effects: ['connection'], conditionalEffects: false },
          },
          {
            name: 'ask.set-model',
            summary: 'Select the model used by an existing Ask Card.',
            version: 5,
            details: {
              ergonomicCli: 'eido ask model CARD --model MODEL',
              effects: ['card'],
            },
          },
          {
            name: 'card.set-identity',
            summary: 'Set or clear one approved visual identity on an eligible non-Title Card, including Mods.',
            version: 5,
            details: {
              ergonomicCli: 'eido card identity CARD (--identity PRESET --fill MODE | --clear)',
              presets: CARD_IDENTITY_PRESETS.map(({ id }) => id),
              fills: ['soft', 'body', 'pattern'],
              effects: ['card', 'mod-instance'],
              conditionalEffects: true,
            },
          },
          {
            name: 'cards.arrange',
            summary: 'Move and optionally resize up to 100 Cards atomically.',
            version: 5,
            details: {
              ergonomicCli: 'eido cards arrange --frames JSON --idea IDEA',
              maxFrames: 100,
              maxAbsoluteCoordinate: PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate,
              effects: ['card'],
            },
          },
          {
            name: 'cards.reorder-layer',
            summary: 'Move up to 100 Cards together to the front or back layer.',
            version: 5,
            details: {
              ergonomicCli: 'eido cards layer front|back CARD…',
              directions: ['front', 'back'],
              maxCards: 100,
              effects: ['card'],
            },
          },
          {
            name: 'group.membership.set',
            summary: 'Add one Card to a Group or remove it from its current Group.',
            version: 5,
            details: {
              ergonomicCli: 'eido group add GROUP MEMBER… | eido group remove MEMBER…',
              effects: ['card'],
            },
          },
          {
            name: 'output.choose-version',
            summary: 'Choose the visible version of one Result Output.',
            version: 5,
            details: {
              ergonomicCli: 'eido result choose OUTPUT --version VERSION --idea IDEA',
              effects: ['output'],
            },
          },
          {
            name: 'output.set-accepted',
            summary: 'Accept or unaccept one Result Output Version.',
            version: 5,
            details: {
              ergonomicCli: 'eido result accept|unaccept OUTPUT --version VERSION --idea IDEA',
              effects: ['output-version'],
            },
          },
          {
            name: 'idea.create',
            summary: 'Create one named inactive Idea and its empty Board as an audited aggregate.',
            version: 4,
            details: {
              result: ['ideaId', 'boardId', 'ideaName'],
              effects: ['idea', 'board'],
              activatesIdea: false,
            },
          },
          {
            name: 'idea.activate',
            summary: 'Switch the active Profile head to an existing Idea without mutating either Board.',
            version: 5,
            details: {
              result: ['previousActiveIdeaId', 'activeIdeaId'],
              effects: ['idea'],
              activatesIdea: true,
            },
          },
          {
            name: 'mod-template.create',
            summary: 'Create one reusable user-owned Mod Template from an ergonomic Mod spec.',
            version: 2,
            details: {
              ergonomicCli: 'eido mod template create TEMPLATE --spec JSON',
              modKinds: [...MOD_KIND_ORDER],
              effects: ['mod-template'],
            },
          },
          {
            name: 'mod-template.update',
            summary: 'Configure one user-owned Mod Template at its expected template version.',
            version: 2,
            details: {
              ergonomicCli: 'eido mod template configure TEMPLATE --template-version N --spec JSON',
              effects: ['mod-template'],
            },
          },
          {
            name: 'mod-template.delete',
            summary: 'Delete one user-owned Mod Template at its expected template version.',
            version: 2,
            details: {
              ergonomicCli: 'eido mod template delete TEMPLATE --template-version N',
              effects: ['mod-template'],
            },
          },
          {
            name: 'mod-instance.stamp',
            summary: 'Stamp a frozen Mod Card from an exact Mod Template version.',
            version: 2,
            details: {
              ergonomicCli: 'eido mod stamp TEMPLATE --template-version N --idea IDEA --x X --y Y',
              effects: ['card', 'block', 'mod-instance'],
            },
          },
          {
            name: 'mod-instance.create',
            summary: 'Create one direct Mod Card from an ergonomic Mod spec at an explicit position.',
            version: 5,
            details: {
              ergonomicCli: 'eido mod create --idea IDEA --spec JSON --x X --y Y',
              modKinds: [...MOD_KIND_ORDER],
              effects: ['card', 'block', 'mod-instance'],
            },
          },
          {
            name: 'mod-instance.configure',
            summary: 'Configure one direct or stamped Mod Card while preserving its identity contract.',
            version: 5,
            details: {
              ergonomicCli: 'eido mod configure CARD --spec JSON',
              effects: ['card', 'mod-instance'],
            },
          },
          {
            name: 'mod-instance.delete',
            summary: 'Delete one Mod Card and its complete recorded closure.',
            version: 5,
            details: {
              ergonomicCli: 'eido mod delete CARD',
              effects: ['card', 'block', 'connection', 'mod-instance'],
            },
          },
          {
            name: 'graph.neighbors',
            summary: 'Read a byte- and item-bounded neighborhood around one Card.',
            version: 1,
          },
          {
            name: 'result.inspect',
            summary: 'Read a bounded Result closure with versions, Run provenance, transcripts, and follow-ups.',
            version: 1,
          },
          {
            name: 'graph.bounds',
            summary: 'Read resolved Card boxes and aggregate bounds for a bounded canonical set.',
            version: 1,
          },
          {
            name: 'journey.connected-thought',
            summary: 'Atomically compose card.create plus connection.create in one command batch.',
            version: 1,
            details: { primitives: ['card.create', 'connection.create'] },
          },
          {
            name: 'run.delegation',
            summary: 'Submit, poll, and read bounded references for a real visible Eido Run.',
            version: 2,
            details: {
              operations: [...PROFILE_AGENT_RUN_GATEWAY_OPERATIONS],
              availability: 'live-app',
              execution: 'ordinary-visible-engine',
              targets: ['askAi', 'conversation'],
              variations: { min: 1, max: 8 },
              artifacts: 'bounded-references-only',
              grantPolicy: {
                active: 'owner-default',
                dormantAvailable: 'first-run-approval',
              },
              budgetUnits: {
                run: 'one accepted submission',
                plannedStep: 'one admitted model call, including Ask, Group compression, Conversation turns, and context compaction',
              },
            },
          },
        ],
      },
      humanOnly: {
        version: 1,
        limits: { maxAgentInvocations: 0 },
        capabilities: [
          {
            name: 'undo.user-stack',
            summary: 'Undo remains a human interaction; Agent commits are deliberately outside it.',
            version: 1,
          },
          {
            name: 'profile.recovery',
            summary: 'Profile recovery and authority repair require explicit human ownership.',
            version: 1,
          },
        ],
      },
      systemOnly: {
        version: 1,
        limits: { maxAgentInvocations: 0 },
        capabilities: [
          {
            name: 'result.create-or-edit',
            summary: 'Result content is authored only by a real execution Run.',
            version: 1,
          },
          {
            name: 'conversation.transcript.write',
            summary: 'Conversation transcript messages are authored only by a Run.',
            version: 1,
          },
          {
            name: 'follow-up.answer.write',
            summary: 'Follow-up answers are authored only by a Run.',
            version: 1,
          },
        ],
      },
      prohibited: {
        version: 1,
        limits: { maxAgentInvocations: 0 },
        capabilities: [
          {
            name: 'connection.title',
            summary: 'Title Cards are spatial labels and are deliberately non-connectable.',
            version: 1,
          },
          {
            name: 'storage.raw-sql-or-generic-patch',
            summary: 'Raw SQL and generic record patches are outside Agent authority.',
            version: 1,
          },
          {
            name: 'credentials.read',
            summary: 'Credential material is never exposed to Agent discovery or reads.',
            version: 1,
          },
        ],
      },
    },
  })

export const INSTALLED_PROFILE_GATEWAY_OPERATION_DESCRIPTORS: Readonly<
  Record<ProfileGatewayOperationName, InstalledProfileGatewayOperationDescriptor>
> = Object.freeze({
  'profile.status': createOperationDescriptor({
    name: 'profile.status',
    adapters: ['cli', 'mcp'],
    agentCliDiscoverable: true,
    summary: 'Inspect Profile readiness, ownership, compatibility, and revision.',
    mutating: false,
    input: EMPTY_INPUT_SCHEMA,
    limits: REQUEST_LIMITS,
    validate: validateEmptyParams,
    invoke: (service) => service.status(),
  }),
  'profile.capabilities': createOperationDescriptor({
    name: 'profile.capabilities',
    adapters: ['cli', 'mcp'],
    agentCliDiscoverable: false,
    summary: 'Inspect installed query and command capabilities and their bounds.',
    mutating: false,
    input: EMPTY_INPUT_SCHEMA,
    limits: REQUEST_LIMITS,
    validate: validateEmptyParams,
    invoke: (service) => service.capabilities(),
  }),
  'agent.capabilities': createOperationDescriptor({
    name: 'agent.capabilities',
    adapters: ['cli'],
    agentCliDiscoverable: true,
    summary: 'Inspect the filtered Agent surface in enabled, human-only, system-only, and prohibited classes.',
    mutating: false,
    input: EMPTY_INPUT_SCHEMA,
    limits: REQUEST_LIMITS,
    validate: validateEmptyParams,
    invoke: () => Promise.resolve({ ok: true, value: INSTALLED_PROFILE_AGENT_CAPABILITY_DISCOVERY }),
  }),
  'idea.list': createOperationDescriptor({
    name: 'idea.list',
    adapters: ['cli', 'mcp'],
    agentCliDiscoverable: true,
    summary: 'List bounded Idea records from one consistent Profile revision.',
    mutating: false,
    input: LIST_INPUT_SCHEMA,
    limits: QUERY_OPERATION_LIMITS,
    validate: (params) => validateListParams(params, 'idea'),
    invoke: (service, query) => service.query(query),
  }),
  'graph.query': createOperationDescriptor({
    name: 'graph.query',
    adapters: ['cli', 'mcp'],
    agentCliDiscoverable: true,
    summary: 'Query bounded logical Profile records by kind, identity, exact logical ownerId, parent identity, or Card creator.',
    mutating: false,
    input: QUERY_INPUT_SCHEMA,
    limits: QUERY_OPERATION_LIMITS,
    validate: validateProfileQuery,
    invoke: (service, query) => service.query(query),
  }),
  'result.inspect': createOperationDescriptor({
    name: 'result.inspect',
    adapters: ['cli'],
    agentCliDiscoverable: true,
    summary: 'Inspect a revision-bound Result closure including output versions, Run provenance, transcripts, and follow-ups.',
    mutating: false,
    input: RESULT_INSPECT_INPUT_SCHEMA,
    limits: QUERY_OPERATION_LIMITS,
    validate: validateProfileResultInspectionRequest,
    invoke: (service, request) => (
      typeof service.inspectResult === 'function'
        ? service.inspectResult(request)
        : Promise.resolve(profileServiceFailure('capability-denied'))
    ),
  }),
  'graph.neighbors': createOperationDescriptor({
    name: 'graph.neighbors',
    adapters: ['cli'],
    agentCliDiscoverable: true,
    summary: 'Read a bounded canonical neighborhood around one raw Card id or Card Deep Link.',
    mutating: false,
    input: GRAPH_NEIGHBORS_INPUT_SCHEMA,
    limits: SPATIAL_OPERATION_LIMITS,
    validate: validateCardNeighborsParams,
    invoke: (service, request) => (
      typeof service.agentCardNeighbors === 'function'
        ? service.agentCardNeighbors(request)
        : Promise.resolve(profileServiceFailure('capability-denied'))
    ),
  }),
  'graph.bounds': createOperationDescriptor({
    name: 'graph.bounds',
    adapters: ['cli'],
    agentCliDiscoverable: true,
    summary: 'Read each resolved Card box and aggregate bounds for raw Card ids or Card Deep Links.',
    mutating: false,
    input: GRAPH_BOUNDS_INPUT_SCHEMA,
    limits: SPATIAL_OPERATION_LIMITS,
    validate: validateCardSetBoundsParams,
    invoke: (service, request) => (
      typeof service.agentCardSetBounds === 'function'
        ? service.agentCardSetBounds(request)
        : Promise.resolve(profileServiceFailure('capability-denied'))
    ),
  }),
  'record.get': createOperationDescriptor({
    name: 'record.get',
    adapters: ['cli', 'mcp'],
    agentCliDiscoverable: true,
    summary: 'Read one logical Profile record by stable identity.',
    mutating: false,
    input: RECORD_GET_INPUT_SCHEMA,
    limits: QUERY_OPERATION_LIMITS,
    validate: validateRecordGetParams,
    invoke: async (service, query) => {
      const page = await service.query(query)
      if (!page.ok || page.value.items.length > 0) return page
      return profileServiceFailure('not-found', { currentRevision: page.value.revision })
    },
  }),
  'mod-template.list': createOperationDescriptor({
    name: 'mod-template.list',
    adapters: ['cli', 'mcp'],
    agentCliDiscoverable: true,
    summary: 'List bounded installed Mod template records.',
    mutating: false,
    input: LIST_INPUT_SCHEMA,
    limits: QUERY_OPERATION_LIMITS,
    validate: (params) => validateListParams(params, 'mod-template'),
    invoke: (service, query) => service.query(query),
  }),
  'changes.list': createOperationDescriptor({
    name: 'changes.list',
    adapters: ['cli'],
    agentCliDiscoverable: true,
    summary: 'List bounded Agent-attributed record changes, newest first.',
    mutating: false,
    input: CHANGES_INPUT_SCHEMA,
    limits: CHANGES_OPERATION_LIMITS,
    validate: validateProfileAgentChangeTrailRequest,
    invoke: (service, request) => (
      typeof service.changes === 'function'
        ? service.changes(request)
        : Promise.resolve(profileServiceFailure('capability-denied'))
    ),
  }),
  'command.batch': createOperationDescriptor({
    name: 'command.batch',
    adapters: ['cli', 'mcp'],
    agentCliDiscoverable: true,
    agentCliInput: AGENT_COMMAND_BATCH_INPUT_SCHEMA,
    summary: 'Preview or apply one exact v5 atomic batch; persisted v1–v4 requests remain available only for exact replay.',
    mutating: true,
    input: COMMAND_BATCH_INPUT_SCHEMA,
    limits: COMMAND_OPERATION_LIMITS,
    validate: validateInstalledProfileAgentCommandRequest,
    invoke: (service, request) => executeInstalledProfileAgentCommandBatch(service, request),
  }),
  'run.submit': createOperationDescriptor({
    name: 'run.submit',
    adapters: ['cli'],
    agentCliDiscoverable: true,
    availability: 'live-app',
    summary: 'Run one bounded non-Agentic OpenRouter Ask AI or Conversation target, or 1–8 variations, in the live app.',
    mutating: true,
    input: RUN_SUBMIT_INPUT_SCHEMA,
    limits: AGENT_RUN_OPERATION_LIMITS,
    validate: validateAgentRunSubmitParams,
    invoke: (service, request) => (
      typeof service.submitAgentRun === 'function'
        ? service.submitAgentRun(request)
        : Promise.resolve(profileAgentRunLiveRequiredGatewayFailure('run.submit'))
    ),
  }),
  'run.status': createOperationDescriptor({
    name: 'run.status',
    adapters: ['cli'],
    agentCliDiscoverable: true,
    availability: 'live-app',
    summary: 'Read queued, running, or terminal state for an app-scoped Agent run.',
    mutating: false,
    input: RUN_STATUS_INPUT_SCHEMA,
    limits: AGENT_RUN_OPERATION_LIMITS,
    validate: validateAgentRunStatusParams,
    invoke: (service, request) => (
      typeof service.statusAgentRun === 'function'
        ? service.statusAgentRun(request)
        : Promise.resolve(profileAgentRunLiveRequiredGatewayFailure('run.status'))
    ),
  }),
  'run.read': createOperationDescriptor({
    name: 'run.read',
    adapters: ['cli'],
    agentCliDiscoverable: true,
    availability: 'live-app',
    summary: 'Read a bounded page of Run and output-version references after completion.',
    mutating: false,
    input: RUN_READ_INPUT_SCHEMA,
    limits: AGENT_RUN_OPERATION_LIMITS,
    validate: validateAgentRunReadParams,
    invoke: (service, request) => (
      typeof service.readAgentRun === 'function'
        ? service.readAgentRun(request)
        : Promise.resolve(profileAgentRunLiveRequiredGatewayFailure('run.read'))
    ),
  }),
})

const INSTALLED_PROFILE_GATEWAY_DESCRIPTION: ProfileGatewayDescription = Object.freeze({
  version: PROFILE_GATEWAY_PROTOCOL_VERSION,
  failures: Object.freeze([
    ...PROFILE_SERVICE_ERROR_CODES.map((code) => Object.freeze({
      code,
      ...PROFILE_SERVICE_FAILURE_CONTRACTS[code],
    })),
    ...PROFILE_AGENT_RUN_GATEWAY_FAILURES,
  ]),
  operations: Object.freeze(PROFILE_GATEWAY_OPERATION_NAMES.map((name) => (
    publicOperationDescription(INSTALLED_PROFILE_GATEWAY_OPERATION_DESCRIPTORS[name])
  ))),
  agentCapabilities: INSTALLED_PROFILE_AGENT_CAPABILITY_DISCOVERY,
})

const INSTALLED_PROFILE_AGENT_CLI_GATEWAY_DESCRIPTION: ProfileGatewayDescription = Object.freeze({
  ...INSTALLED_PROFILE_GATEWAY_DESCRIPTION,
  operations: Object.freeze(PROFILE_GATEWAY_OPERATION_NAMES.flatMap((name) => {
    const descriptor = INSTALLED_PROFILE_GATEWAY_OPERATION_DESCRIPTORS[name]
    if (!descriptor.agentCliDiscoverable) return []
    return [publicOperationDescription(
      descriptor,
      descriptor.agentCliInput ?? descriptor.schema.input,
    )]
  })),
})

function publicOperationDescription(
  descriptor: InstalledProfileGatewayOperationDescriptor,
  input: ProfileGatewayInputSchema = descriptor.schema.input,
): ProfileGatewayOperationDescription {
  return Object.freeze({
    name: descriptor.name,
    summary: descriptor.summary,
    version: descriptor.version,
    availability: descriptor.availability,
    adapters: descriptor.adapters,
    agentCliDiscoverable: descriptor.agentCliDiscoverable,
    mutating: descriptor.mutating,
    schema: Object.freeze({ version: descriptor.schema.version, input }),
    limits: descriptor.limits,
  })
}

export async function executeProfileGatewayRequest(
  service: ProfileGatewayService,
  candidate: unknown,
): Promise<ProfileGatewayResponse> {
  const validation = validateGatewayRequest(candidate)
  if (!validation.ok) {
    return createProfileGatewayFailureResponse(readSafeRequestId(candidate), validation)
  }
  const request = validation.value
  const descriptor = Object.prototype.hasOwnProperty.call(
    INSTALLED_PROFILE_GATEWAY_OPERATION_DESCRIPTORS,
    request.operation,
  )
    ? INSTALLED_PROFILE_GATEWAY_OPERATION_DESCRIPTORS[request.operation]
    : undefined
  if (!descriptor) {
    return createProfileGatewayFailureResponse(
      request.requestId,
      profileServiceFailure('capability-denied'),
    )
  }

  try {
    const planned = descriptor.planner(request.params)
    if (!planned.ok) return createProfileGatewayFailureResponse(request.requestId, planned)
    const result = await planned.value(service)
    if (!result.ok) return createProfileGatewayFailureResponse(request.requestId, result)
    return Object.freeze({
      version: PROFILE_GATEWAY_PROTOCOL_VERSION,
      requestId: request.requestId,
      ok: true,
      result: result.value,
    })
  } catch {
    return createProfileGatewayFailureResponse(
      request.requestId,
      request.operation === 'run.submit'
        ? profileAgentRunSubmitOutcomeUnknownGatewayFailure()
        : profileServiceFailure('internal'),
    )
  }
}

export function createProfileGatewayFailureResponse(
  requestId: string | null,
  failure: ProfileServiceFailure & Readonly<{ reason?: ProfileAgentRunGatewayFailureReason }>,
): ProfileGatewayResponse {
  const error = Object.freeze({
    code: failure.code,
    retryable: failure.retryable,
    message: failure.message,
    ...(failure.reason === undefined ? {} : { reason: failure.reason }),
    ...(failure.currentRevision === undefined ? {} : { currentRevision: failure.currentRevision }),
    ...(failure.supportedVersions === undefined
      ? {}
      : { supportedVersions: Object.freeze({ ...failure.supportedVersions }) }),
    ...(failure.supportedGatewayProtocolVersion === undefined
      ? {}
      : { supportedGatewayProtocolVersion: failure.supportedGatewayProtocolVersion }),
  })
  return Object.freeze({
    version: PROFILE_GATEWAY_PROTOCOL_VERSION,
    requestId,
    ok: false,
    error,
  })
}

function validateListParams(
  candidate: unknown,
  kind: 'idea' | 'mod-template',
): ProfileServiceResult<NormalizedProfileQuery> {
  if (!isJsonObject(candidate)
    || !hasOnlyKeys(candidate, ['byteLimit', 'cursor', 'limit', 'projection'])) {
    return profileServiceFailure('invalid')
  }
  const query = validateProfileQuery({
    ...candidate,
    recordKinds: [kind],
  })
  return query
}

function validateRecordGetParams(candidate: unknown): ProfileServiceResult<NormalizedProfileQuery> {
  if (!isJsonObject(candidate)
    || !hasOnlyKeys(candidate, ['byteLimit', 'projection', 'recordId'])) {
    return profileServiceFailure('invalid')
  }
  return validateProfileQuery({
    recordIds: [candidate.recordId],
    limit: 1,
    ...(candidate.byteLimit === undefined ? {} : { byteLimit: candidate.byteLimit }),
    ...(candidate.projection === undefined ? {} : { projection: candidate.projection }),
  })
}

function validateCardNeighborsParams(
  candidate: unknown,
): ProfileServiceResult<NormalizedProfileAgentCardNeighborsRequest> {
  const request = normalizeProfileAgentCardNeighborsRequest(candidate)
  return request === undefined ? profileServiceFailure('invalid') : { ok: true, value: request }
}

function validateCardSetBoundsParams(
  candidate: unknown,
): ProfileServiceResult<ProfileAgentCardSetBoundsRequest> {
  const request = normalizeProfileAgentCardSetBoundsRequest(candidate)
  return request === undefined ? profileServiceFailure('invalid') : { ok: true, value: request }
}

function validateAgentRunSubmitParams(
  candidate: unknown,
): ProfileServiceResult<AgentRunSubmitRequest> {
  const normalized = normalizeAgentRunSubmitRequest(candidate)
  if (!normalized) return profileServiceFailure('invalid')
  return Object.freeze({
    ok: true,
    value: normalized.mode === 'run'
      ? Object.freeze({
          ideaId: normalized.ideaId,
          targetCardId: normalized.targetCardId,
        })
      : Object.freeze({
          ideaId: normalized.ideaId,
          targetCardId: normalized.targetCardId,
          mode: 'variations',
          variationCount: normalized.variationCount,
        }),
  })
}

function validateAgentRunStatusParams(
  candidate: unknown,
): ProfileServiceResult<AgentRunStatusRequest> {
  if (!isJsonObject(candidate)
    || !hasExactKeys(candidate, ['runId'])
    || !boundedAgentRunIdentity(candidate.runId)) return profileServiceFailure('invalid')
  return Object.freeze({ ok: true, value: Object.freeze({ runId: candidate.runId }) })
}

function validateAgentRunReadParams(
  candidate: unknown,
): ProfileServiceResult<AgentRunReadRequest> {
  if (!isJsonObject(candidate)
    || !hasOnlyKeys(candidate, ['runId', 'limit', 'byteLimit', 'cursor'])
    || !Object.prototype.hasOwnProperty.call(candidate, 'runId')
    || !boundedAgentRunIdentity(candidate.runId)
    || (candidate.limit !== undefined
      && (!positiveSafeInteger(candidate.limit)
        || candidate.limit > AGENT_RUN_ARTIFACT_READ_LIMITS.maxItems))
    || (candidate.byteLimit !== undefined
      && (!positiveSafeInteger(candidate.byteLimit)
        || candidate.byteLimit < 2
        || candidate.byteLimit > AGENT_RUN_ARTIFACT_READ_LIMITS.maxBytes))
    || (candidate.cursor !== undefined
      && (!boundedAgentRunText(
        candidate.cursor,
        AGENT_RUN_ARTIFACT_READ_LIMITS.maxCursorBytes,
      )))) return profileServiceFailure('invalid')
  return Object.freeze({
    ok: true,
    value: Object.freeze({
      runId: candidate.runId,
      ...(candidate.limit === undefined ? {} : { limit: candidate.limit }),
      ...(candidate.byteLimit === undefined ? {} : { byteLimit: candidate.byteLimit }),
      ...(candidate.cursor === undefined ? {} : { cursor: candidate.cursor }),
    }),
  })
}

function boundedAgentRunIdentity(candidate: unknown): candidate is string {
  return boundedAgentRunText(candidate, 256)
}

function boundedAgentRunText(candidate: unknown, maxBytes: number): candidate is string {
  return typeof candidate === 'string'
    && candidate.length > 0
    && utf8ByteLength(candidate) <= maxBytes
}

function positiveSafeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && (candidate as number) > 0
}

function validateEmptyParams(candidate: unknown): ProfileServiceResult<undefined> {
  return isJsonObject(candidate) && hasExactKeys(candidate, [])
    ? { ok: true, value: undefined }
    : profileServiceFailure('invalid')
}

function createOperationDescriptor<Validated, Result extends ProfileGatewayResult>(
  options: Readonly<{
    name: ProfileGatewayOperationName
    adapters: readonly ProfileGatewayAdapter[]
    agentCliDiscoverable: boolean
    agentCliInput?: ProfileGatewayInputSchema
    availability?: ProfileGatewayOperationDescription['availability']
    summary: string
    mutating: boolean
    input: ProfileGatewayInputSchema
    limits: ProfileGatewayOperationDescription['limits']
    validate(candidate: unknown): ProfileServiceResult<Validated>
    invoke(
      service: ProfileGatewayService,
      validated: Validated,
    ): Promise<ProfileServiceResult<Result>>
  }>,
): InstalledProfileGatewayOperationDescriptor {
  const schema = Object.freeze({
    version: 1 as const,
    input: options.input,
  })
  return Object.freeze({
    name: options.name,
    adapters: Object.freeze([...options.adapters]),
    agentCliDiscoverable: options.agentCliDiscoverable,
    ...(options.agentCliInput === undefined
      ? {}
      : { agentCliInput: options.agentCliInput }),
    summary: options.summary,
    version: PROFILE_GATEWAY_PROTOCOL_VERSION,
    availability: options.availability ?? 'installed',
    mutating: options.mutating,
    schema,
    limits: options.limits,
    planner(candidate: unknown): ProfileServiceResult<ProfileGatewayOperationPlan> {
      const validated = options.validate(candidate)
      if (!validated.ok) return validated
      return {
        ok: true,
        value: (service) => options.invoke(service, validated.value),
      }
    },
  })
}

type GatewayJsonSchema = Record<string, ProfileJsonValue>

function commandBatchInputSchema(commandNames: readonly string[]): ProfileGatewayInputSchema {
  const commandSchemas = commandNames.map((name) => (
    profileAgentCommandInputSchema(name as ProfileAgentCommandName)
  ))
  return profileGatewayInputSchema({
    version: {
      type: 'integer',
      const: 1,
      description: 'Gateway command-envelope version. Fresh admission uses installed command surface v5.',
    },
    schemaVersion: { type: 'integer', const: 1 },
    expectedRevision: {
      type: 'integer',
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
      description: 'Required optimistic Profile revision; inspect first and pin every mutation.',
    },
    idempotencyKey: boundedUtf8StringSchema(
      PROFILE_AGENT_COMMAND_LIMITS.maxIdempotencyKeyBytes,
      true,
      'Reuse only for an exact retry of the same batch and transport.',
    ),
    dryRun: {
      type: 'boolean',
      description: 'true previews without writes; false applies. Ergonomic CLI requires exactly one of --dry-run or --apply.',
    },
    commands: {
      type: 'array',
      minItems: 1,
      maxItems: PROFILE_AGENT_COMMAND_LIMITS.maxCommands,
      description: 'One atomic ordered batch. Fresh v5 commands are discriminated exactly below; persisted v1–v4 batches remain replay-only.',
      items: {
        oneOf: commandSchemas,
      },
    },
  }, {
    required: [
      'version',
      'schemaVersion',
      'expectedRevision',
      'idempotencyKey',
      'dryRun',
      'commands',
    ],
  })
}

function profileAgentCommandInputSchema(name: ProfileAgentCommandName): GatewayJsonSchema {
  return exactObjectSchema({
    version: { type: 'integer', const: 1 },
    id: boundedUtf8StringSchema(
      PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes,
      true,
      'Unique command id within this ordered batch; createdByCommandId references earlier commands by this value.',
    ),
    name: { type: 'string', const: name },
    payload: profileAgentCommandPayloadSchema(name),
  }, ['version', 'id', 'name', 'payload'], profileAgentCommandCliDescription(name))
}

function profileAgentCommandCliDescription(name: ProfileAgentCommandName): string {
  switch (name) {
    case 'card.create': return 'Ergonomic CLI: eido card create …'
    case 'card.update-content': return 'Ergonomic CLI: eido card update …'
    case 'card.delete': return 'Ergonomic CLI: eido card delete CARD [--idea IDEA].'
    case 'connection.create': return 'Ergonomic CLI: eido connection create FROM TO [meaning options]; Mod wiring uses eido mod connect MOD TARGET [--strength strong|weak].'
    case 'connection.update-meaning': return 'Ergonomic CLI: eido connection update-meaning CONNECTION [meaning options].'
    case 'connection.delete': return 'Ergonomic CLI: eido connection delete CONNECTION [--idea IDEA].'
    case 'mod-template.create': return 'Ergonomic CLI: eido mod template create TEMPLATE --spec JSON.'
    case 'mod-template.update': return 'Ergonomic CLI: eido mod template configure TEMPLATE --template-version N --spec JSON.'
    case 'mod-template.delete': return 'Ergonomic CLI: eido mod template delete TEMPLATE --template-version N.'
    case 'mod-instance.stamp': return 'Ergonomic CLI: eido mod stamp TEMPLATE --template-version N --idea IDEA --x X --y Y [--connect-to CARD --strength strong|weak].'
    case 'mod-instance.create': return 'Ergonomic CLI: eido mod create --idea IDEA --spec JSON --x X --y Y [--connect-to CARD --strength strong|weak].'
    case 'mod-instance.configure': return 'Ergonomic CLI: eido mod configure CARD --spec JSON [--idea IDEA].'
    case 'mod-instance.delete': return 'Ergonomic CLI: eido mod delete CARD [--idea IDEA].'
    case 'idea.create': return 'Ergonomic CLI: eido idea create NAME.'
    case 'idea.activate': return 'Ergonomic CLI: eido idea activate IDEA.'
    case 'ask.set-model': return 'Ergonomic CLI: eido ask model CARD --model MODEL [--idea IDEA].'
    case 'card.set-identity': return 'Ergonomic CLI: eido card identity CARD (--identity PRESET --fill MODE | --clear) [--idea IDEA]. Title Cards are spatial labels and reject identity changes. On a Mod Card, setting also updates the accent; clear keeps that accent.'
    case 'cards.arrange': return 'Ergonomic CLI: eido cards arrange --frames JSON --idea IDEA; CLI frames use {card,x,y,width?,height?}.'
    case 'cards.reorder-layer': return 'Ergonomic CLI: eido cards layer front|back CARD… [--idea IDEA].'
    case 'group.membership.set': return 'Ergonomic CLI: eido group add GROUP MEMBER… or eido group remove MEMBER… [--idea IDEA].'
    case 'output.choose-version': return 'Ergonomic CLI: eido result choose OUTPUT --version VERSION --idea IDEA.'
    case 'output.set-accepted': return 'Ergonomic CLI: eido result accept|unaccept OUTPUT --version VERSION --idea IDEA.'
  }
}

function profileAgentCommandPayloadSchema(name: ProfileAgentCommandName): GatewayJsonSchema {
  switch (name) {
    case 'card.create':
      return cardCreatePayloadSchema()
    case 'card.update-content':
      return cardUpdatePayloadSchema()
    case 'card.delete':
      return ideaRecordPayloadSchema('cardId')
    case 'connection.create':
      return exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        from: cardReferenceSchema(),
        to: cardReferenceSchema(),
        strength: { type: 'string', enum: ['strong', 'weak'] },
        polarity: { type: 'string', enum: ['helps', 'pushesAgainst'] },
        reason: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxReasonBytes, false),
        groupMode: { type: 'string', enum: ['full', 'compress'] },
      }, ['ideaId', 'from', 'to'])
    case 'connection.update-meaning':
      return exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        connectionId: commandIdSchema('Connection id.'),
        strength: { type: 'string', enum: ['strong', 'weak'] },
        polarity: { type: 'string', enum: ['helps', 'pushesAgainst'] },
        reason: {
          type: ['string', 'null'],
          'x-eido-maxUtf8Bytes': PROFILE_AGENT_COMMAND_LIMITS.maxReasonBytes,
          description: `String is limited to ${PROFILE_AGENT_COMMAND_LIMITS.maxReasonBytes} UTF-8 bytes; null clears it.`,
        },
        groupMode: { type: 'string', enum: ['full', 'compress'] },
      }, ['ideaId', 'connectionId'], undefined, {
        anyOf: ['strength', 'polarity', 'reason', 'groupMode'].map((field) => ({ required: [field] })),
      })
    case 'connection.delete':
      return ideaRecordPayloadSchema('connectionId')
    case 'mod-template.create':
      return exactObjectSchema({
        templateId: commandIdSchema('User Mod template id.'),
        mod: profileModDocumentSchema(),
      }, ['templateId', 'mod'])
    case 'mod-template.update':
      return exactObjectSchema({
        templateId: commandIdSchema('User Mod template id.'),
        expectedTemplateVersion: positiveSafeIntegerSchema(),
        mod: profileModDocumentSchema(),
      }, ['templateId', 'expectedTemplateVersion', 'mod'])
    case 'mod-template.delete':
      return exactObjectSchema({
        templateId: commandIdSchema('User Mod template id.'),
        expectedTemplateVersion: positiveSafeIntegerSchema(),
      }, ['templateId', 'expectedTemplateVersion'])
    case 'mod-instance.stamp':
      return exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        templateId: commandIdSchema('Source Mod template id.'),
        expectedTemplateVersion: positiveSafeIntegerSchema(),
        position: cardPositionSchema(),
      }, ['ideaId', 'templateId', 'expectedTemplateVersion', 'position'])
    case 'mod-instance.create':
      return exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        mod: profileModDocumentSchema(),
        position: cardPositionSchema(),
      }, ['ideaId', 'mod', 'position'])
    case 'mod-instance.configure':
      return exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        cardId: commandIdSchema('Mod Card id.'),
        mod: profileModDocumentSchema(),
      }, ['ideaId', 'cardId', 'mod'])
    case 'mod-instance.delete':
      return ideaRecordPayloadSchema('cardId')
    case 'idea.create':
      return exactObjectSchema({
        name: boundedUtf8StringSchema(
          PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes,
          true,
          'Trimmed Idea display name must remain non-empty.',
        ),
      }, ['name'])
    case 'idea.activate':
      return exactObjectSchema({ ideaId: commandIdSchema('Existing Idea id.') }, ['ideaId'])
    case 'ask.set-model':
      return exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        card: cardReferenceSchema(),
        model: boundedUtf8StringSchema(
          PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes,
          true,
          'Trimmed model identifier must remain non-empty.',
        ),
      }, ['ideaId', 'card', 'model'])
    case 'card.set-identity':
      return exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        card: cardReferenceSchema(),
        identity: {
          description: 'On a Mod Card, a preset also sets the Mod accent; clear keeps that accent.',
          oneOf: [
            {
              type: 'null',
              description: 'Clear the Card fill; an existing Mod accent remains unchanged.',
            },
            exactObjectSchema({
              preset: {
                type: 'string',
                enum: CARD_IDENTITY_PRESETS.map(({ id }) => id),
              },
              fill: { type: 'string', enum: ['soft', 'body', 'pattern'] },
            }, ['preset', 'fill']),
          ],
        },
      }, ['ideaId', 'card', 'identity'])
    case 'cards.arrange':
      return exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        frames: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          description: 'Ergonomic --frames JSON uses flat x/y/width?/height? entries and compiles to these frames.',
          items: exactObjectSchema({
            card: cardReferenceSchema(),
            position: cardPositionSchema(),
            size: cardSizeSchema(),
          }, ['card', 'position']),
        },
      }, ['ideaId', 'frames'])
    case 'cards.reorder-layer':
      return exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        cards: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          items: cardReferenceSchema(),
        },
        direction: { type: 'string', enum: ['front', 'back'] },
      }, ['ideaId', 'cards', 'direction'])
    case 'group.membership.set':
      return exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        card: cardReferenceSchema(),
        group: {
          oneOf: [
            { type: 'null', description: 'Remove the Card from its current Group.' },
            cardReferenceSchema(),
          ],
        },
      }, ['ideaId', 'card', 'group'])
    case 'output.choose-version':
      return outputVersionPayloadSchema(false)
    case 'output.set-accepted':
      return outputVersionPayloadSchema(true)
  }
}

function cardCreatePayloadSchema(): GatewayJsonSchema {
  const common = {
    ideaId: commandIdSchema('Idea id.'),
    position: cardPositionSchema(),
    near: {
      type: 'array',
      minItems: 1,
      maxItems: PROFILE_AGENT_COMMAND_LIMITS.maxNearCards,
      description: 'Raw Card ids or Card Deep Links; duplicate addresses are normalized.',
      items: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxCardAddressBytes, true),
    },
  }
  return {
    type: 'object',
    description: 'One current Card-kind payload. Exactly one of position or near is required; the explicit-position note/Ask text spelling remains accepted for replay compatibility.',
    anyOf: [
      exactObjectSchema({
        ideaId: common.ideaId,
        kind: { type: 'string', enum: ['note', 'askAi'] },
        position: common.position,
        text: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false),
      }, ['ideaId', 'kind', 'position']),
      placeableCardCreateVariant(
        ['note', 'askAi'],
        { body: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false) },
      ),
      placeableCardCreateVariant(
        ['title'],
        { body: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false) },
      ),
      placeableCardCreateVariant(['group'], {
        groupTitle: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false),
        compressionPrompt: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false),
      }),
      placeableCardCreateVariant(['conversation'], {
        topic: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false),
        conversationStyle: { type: 'string', enum: [...CONVERSATION_STYLES] },
        conversationTurns: integerSchema(1, PROFILE_AGENT_COMMAND_LIMITS.maxConversationTurns),
      }),
    ],
  }
}

function placeableCardCreateVariant(
  kinds: readonly string[],
  kindProperties: Record<string, ProfileJsonValue>,
): GatewayJsonSchema {
  return exactObjectSchema({
    ideaId: commandIdSchema('Idea id.'),
    kind: { type: 'string', enum: [...kinds] },
    position: cardPositionSchema(),
    near: {
      type: 'array',
      minItems: 1,
      maxItems: PROFILE_AGENT_COMMAND_LIMITS.maxNearCards,
      items: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxCardAddressBytes, true),
    },
    ...kindProperties,
  }, ['ideaId', 'kind'], undefined, {
    oneOf: [{ required: ['position'] }, { required: ['near'] }],
  })
}

function cardUpdatePayloadSchema(): GatewayJsonSchema {
  return {
    type: 'object',
    description: 'The payload shape selects legacy Block text, body text, Group fields, or Conversation fields.',
    oneOf: [
      exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        cardId: commandIdSchema('Card id.'),
        blockId: commandIdSchema('Block id.'),
        text: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false),
      }, ['ideaId', 'cardId', 'blockId', 'text']),
      exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        cardId: commandIdSchema('Card id.'),
        body: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false),
      }, ['ideaId', 'cardId', 'body']),
      exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        cardId: commandIdSchema('Group Card id.'),
        groupTitle: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false),
        compressionPrompt: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false),
      }, ['ideaId', 'cardId'], undefined, {
        anyOf: [{ required: ['groupTitle'] }, { required: ['compressionPrompt'] }],
      }),
      exactObjectSchema({
        ideaId: commandIdSchema('Idea id.'),
        cardId: commandIdSchema('Conversation Card id.'),
        topic: boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxTextBytes, false),
        conversationStyle: { type: 'string', enum: [...CONVERSATION_STYLES] },
        conversationTurns: integerSchema(1, PROFILE_AGENT_COMMAND_LIMITS.maxConversationTurns),
      }, ['ideaId', 'cardId'], undefined, {
        anyOf: [
          { required: ['topic'] },
          { required: ['conversationStyle'] },
          { required: ['conversationTurns'] },
        ],
      }),
    ],
  }
}

function ideaRecordPayloadSchema(recordField: 'cardId' | 'connectionId'): GatewayJsonSchema {
  return exactObjectSchema({
    ideaId: commandIdSchema('Idea id.'),
    [recordField]: commandIdSchema(`${recordField === 'cardId' ? 'Card' : 'Connection'} id.`),
  }, ['ideaId', recordField])
}

function outputVersionPayloadSchema(accepted: boolean): GatewayJsonSchema {
  return exactObjectSchema({
    ideaId: commandIdSchema('Idea id.'),
    outputId: commandIdSchema('Output id.'),
    versionId: commandIdSchema('Output Version id.'),
    ...(accepted ? { accepted: { type: 'boolean' } } : {}),
  }, accepted
    ? ['ideaId', 'outputId', 'versionId', 'accepted']
    : ['ideaId', 'outputId', 'versionId'])
}

function cardReferenceSchema(): GatewayJsonSchema {
  return {
    type: 'object',
    description: 'Use a stable Card id, or reference an earlier Card-creating command in this batch.',
    oneOf: [
      exactObjectSchema({ cardId: commandIdSchema('Existing Card id.') }, ['cardId']),
      exactObjectSchema({
        createdByCommandId: commandIdSchema('Earlier Card-creating command id.'),
      }, ['createdByCommandId']),
    ],
  }
}

function cardPositionSchema(): GatewayJsonSchema {
  return exactObjectSchema({
    x: boundedCoordinateSchema(),
    y: boundedCoordinateSchema(),
  }, ['x', 'y'])
}

function cardSizeSchema(): GatewayJsonSchema {
  return exactObjectSchema({
    width: boundedDimensionSchema(),
    height: boundedDimensionSchema(),
  }, ['width', 'height'])
}

function boundedCoordinateSchema(): GatewayJsonSchema {
  return {
    type: 'number',
    minimum: -PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate,
    maximum: PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate,
  }
}

function boundedDimensionSchema(): GatewayJsonSchema {
  return {
    type: 'number',
    exclusiveMinimum: 0,
    maximum: PROFILE_AGENT_COMMAND_LIMITS.maxAbsoluteCoordinate,
  }
}

function commandIdSchema(description?: string): GatewayJsonSchema {
  return boundedUtf8StringSchema(PROFILE_AGENT_COMMAND_LIMITS.maxIdBytes, true, description)
}

function positiveSafeIntegerSchema(): GatewayJsonSchema {
  return integerSchema(1, Number.MAX_SAFE_INTEGER) as GatewayJsonSchema
}

function profileModDocumentSchema(): GatewayJsonSchema {
  return {
    description: 'Canonical ProfileModDocument. Ergonomic Mod CLI --spec uses exact v1 {version,kind,title,identity,treatment,state} and compiles to this persisted form. Nested part ids must be non-blank and globally unique; unknown inert JSON extensions are preserved, while a retired root id is forbidden.',
    oneOf: MOD_KIND_ORDER.map((kind) => profileModKindSchema(kind)),
  }
}

function profileModKindSchema(kind: ModKind): GatewayJsonSchema {
  return extensibleProfileModObjectSchema({
    kind: { type: 'string', const: kind },
    title: { type: 'string' },
    accent: { type: 'string', minLength: 1 },
    state: profileModStateSchema(kind),
    treatOverride: {
      type: ['string', 'null'],
      description: 'null uses the engine treatment; a string must already be the canonical treatment override.',
    },
  }, ['kind', 'title', 'accent', 'state', 'treatOverride'], undefined, true)
}

function profileModStateSchema(kind: ModKind): GatewayJsonSchema {
  switch (kind) {
    case 'slider':
    case 'dial':
      return extensibleProfileModObjectSchema({
        steps: optionalStepsSchema(10),
        stops: stringListSchema(),
        items: boundedModPartsSchema(kind, valueModItemSchema()),
      }, ['steps', 'stops', 'items'])
    case 'count':
      return extensibleProfileModObjectSchema({
        mode: { type: 'string', enum: ['number', 'percent', 'ratio'] },
        steps: integerSchema(2, 10),
        items: boundedModPartsSchema('count', extensibleProfileModObjectSchema({
          id: modPartIdSchema(),
          label: { type: 'string' },
          n: {
            type: 'integer',
            minimum: 0,
            maximum: 10,
            description: 'At most 10 in number mode; otherwise at most the enclosing steps value.',
          },
          frame: { type: 'string' },
        }, ['id', 'label', 'n', 'frame'])),
      }, ['mode', 'steps', 'items'])
    case 'switch':
      return extensibleProfileModObjectSchema({
        items: boundedModPartsSchema('switch', extensibleProfileModObjectSchema({
          id: modPartIdSchema(),
          label: { type: 'string' },
          on: { type: 'boolean' },
          frame: { type: 'string' },
        }, ['id', 'label', 'on', 'frame'])),
      }, ['items'])
    case 'pad':
      return extensibleProfileModObjectSchema({
        axes: extensibleProfileModObjectSchema({
          x: padAxisSchema(),
          y: padAxisSchema(),
        }, ['x', 'y']),
        v: extensibleProfileModObjectSchema(
          { x: percentSchema(), y: percentSchema() },
          ['x', 'y'],
        ),
      }, ['axes', 'v'])
    case 'select':
      return extensibleProfileModObjectSchema({
        picked: {
          type: 'integer',
          minimum: 0,
          maximum: MOD_PART_BOUNDS.select.max - 1,
          description: 'Must index the enclosing options array.',
        },
        options: boundedModPartsSchema('select', framedLabelSchema()),
      }, ['picked', 'options'])
    case 'order':
      return extensibleProfileModObjectSchema({
        items: boundedModPartsSchema('order', framedLabelSchema()),
        perm: {
          type: 'array',
          minItems: MOD_PART_BOUNDS.order.min,
          maxItems: MOD_PART_BOUNDS.order.max,
          uniqueItems: true,
          description: 'A complete permutation with the same length as items.',
          items: integerSchema(0, MOD_PART_BOUNDS.order.max - 1),
        },
        frame: { type: 'string' },
      }, ['items', 'perm', 'frame'])
    case 'filter':
      return extensibleProfileModObjectSchema({
        steps: optionalStepsSchema(10),
        stops: stringListSchema(),
        lanes: boundedModPartsSchema('filter', filterLaneSchema()),
      }, ['steps', 'stops', 'lanes'])
    case 'mixer':
      return extensibleProfileModObjectSchema({
        frame: { type: 'string' },
        items: boundedModPartsSchema('mixer', valueModItemSchema(false)),
      }, ['frame', 'items'], 'Mixer item values must be non-negative and sum to exactly 100 (within 1e-9).')
    case 'radar':
      return extensibleProfileModObjectSchema({
        steps: optionalStepsSchema(10),
        axes: boundedModPartsSchema('radar', extensibleProfileModObjectSchema({
          id: modPartIdSchema(),
          label: { type: 'string' },
          v: percentSchema(),
          frame: { type: 'string' },
        }, ['id', 'label', 'v'])),
      }, ['steps', 'axes'])
    case 'matrix':
      return extensibleProfileModObjectSchema({
        steps: integerSchema(2, 5),
        stepNames: {
          type: 'array',
          minItems: 2,
          maxItems: 5,
          description: 'Length must equal steps.',
          items: { type: 'string' },
        },
        rows: boundedModPartsSchema('matrix', matrixLabelSchema()),
        cols: boundedModPartsSchema('matrix', matrixLabelSchema()),
        cells: {
          type: 'array',
          minItems: MOD_PART_BOUNDS.matrix.min,
          maxItems: MOD_PART_BOUNDS.matrix.max,
          description: 'One row per rows entry, one value per cols entry; every value is less than steps.',
          items: {
            type: 'array',
            minItems: MOD_PART_BOUNDS.matrix.min,
            maxItems: MOD_PART_BOUNDS.matrix.max,
            items: integerSchema(0, 4),
          },
        },
      }, ['steps', 'stepNames', 'rows', 'cols', 'cells'])
  }
}

function boundedModPartsSchema(kind: ModKind, items: GatewayJsonSchema): GatewayJsonSchema {
  return {
    type: 'array',
    minItems: MOD_PART_BOUNDS[kind].min,
    maxItems: MOD_PART_BOUNDS[kind].max,
    items,
  }
}

function valueModItemSchema(percent = true): GatewayJsonSchema {
  return extensibleProfileModObjectSchema({
    id: modPartIdSchema(),
    label: { type: 'string' },
    v: percent ? percentSchema() : { type: 'number', minimum: 0 },
    frame: { type: 'string' },
  }, ['id', 'label', 'v', 'frame'])
}

function framedLabelSchema(): GatewayJsonSchema {
  return extensibleProfileModObjectSchema({
    id: modPartIdSchema(),
    label: { type: 'string' },
    frame: { type: 'string' },
  }, ['id', 'label', 'frame'])
}

function matrixLabelSchema(): GatewayJsonSchema {
  return extensibleProfileModObjectSchema({
    id: modPartIdSchema(),
    label: { type: 'string' },
  }, ['id', 'label'])
}

function padAxisSchema(): GatewayJsonSchema {
  return extensibleProfileModObjectSchema({
    id: modPartIdSchema(),
    label: { type: 'string' },
    lo: { type: 'string' },
    hi: { type: 'string' },
    steps: optionalStepsSchema(10),
    frame: { type: 'string' },
  }, ['id', 'label', 'lo', 'hi', 'steps', 'frame'])
}

function filterLaneSchema(): GatewayJsonSchema {
  const common = {
    id: modPartIdSchema(),
    label: { type: 'string' },
    frame: { type: 'string' },
  }
  return {
    oneOf: [
      extensibleProfileModObjectSchema({
        ...common,
        mode: { type: 'string', const: 'no-more-than' },
        lo: { type: 'number', const: 0 },
        hi: percentSchema(),
      }, ['id', 'label', 'mode', 'lo', 'hi', 'frame']),
      extensibleProfileModObjectSchema({
        ...common,
        mode: { type: 'string', const: 'at-least' },
        lo: percentSchema(),
        hi: { type: 'number', const: 100 },
      }, ['id', 'label', 'mode', 'lo', 'hi', 'frame']),
      extensibleProfileModObjectSchema({
        ...common,
        mode: { type: 'string', const: 'between' },
        lo: percentSchema(),
        hi: percentSchema(),
      }, ['id', 'label', 'mode', 'lo', 'hi', 'frame'], 'lo must be less than or equal to hi.'),
    ],
  }
}

function modPartIdSchema(): GatewayJsonSchema {
  return {
    type: 'string',
    minLength: 1,
    description: 'Non-blank stable part id; unique across all nested parts in this Mod.',
  }
}

function optionalStepsSchema(maximum: number): GatewayJsonSchema {
  return {
    oneOf: [
      { type: 'integer', const: 0 },
      integerSchema(2, maximum),
    ],
    description: '0 disables snapping; otherwise use an integer from 2 through the stated maximum.',
  }
}

function percentSchema(): GatewayJsonSchema {
  return { type: 'number', minimum: 0, maximum: 100 }
}

function stringListSchema(): GatewayJsonSchema {
  return { type: 'array', items: { type: 'string' } }
}

function boundedUtf8StringSchema(
  maxBytes: number,
  nonEmpty: boolean,
  description?: string,
): GatewayJsonSchema {
  return {
    type: 'string',
    ...(nonEmpty ? { minLength: 1 } : {}),
    'x-eido-maxUtf8Bytes': maxBytes,
    description: [description, `Maximum ${maxBytes} UTF-8 bytes.`].filter(Boolean).join(' '),
  }
}

function extensibleProfileModObjectSchema(
  properties: Record<string, ProfileJsonValue>,
  required: readonly string[],
  description?: string,
  forbidRootId = false,
): GatewayJsonSchema {
  return {
    type: 'object',
    properties,
    required: [...required],
    ...(description === undefined ? {} : { description }),
    ...(forbidRootId ? { not: { required: ['id'] } } : {}),
    additionalProperties: true,
  }
}

function exactObjectSchema(
  properties: Record<string, ProfileJsonValue>,
  required: readonly string[],
  description?: string,
  constraints: Readonly<{
    anyOf?: readonly Readonly<{ required: readonly string[] }>[]
    oneOf?: readonly Readonly<{ required: readonly string[] }>[]
  }> = {},
): GatewayJsonSchema {
  return {
    type: 'object',
    properties,
    ...(required.length === 0 ? {} : { required: [...required] }),
    ...(description === undefined ? {} : { description }),
    ...(constraints.anyOf === undefined
      ? {}
      : { anyOf: constraints.anyOf.map(({ required: fields }) => ({ required: [...fields] })) }),
    ...(constraints.oneOf === undefined
      ? {}
      : { oneOf: constraints.oneOf.map(({ required: fields }) => ({ required: [...fields] })) }),
    additionalProperties: false,
  }
}

function profileGatewayInputSchema(
  properties: Record<string, ProfileJsonValue>,
  constraints: Readonly<{
    required?: readonly string[]
    atLeastOneOf?: readonly string[]
  }> = {},
): ProfileGatewayInputSchema {
  const required = constraints.required ?? []
  const atLeastOneOf = constraints.atLeastOneOf ?? []
  return deepFreeze({
    type: 'object' as const,
    properties,
    ...(required.length === 0 ? {} : { required }),
    ...(atLeastOneOf.length === 0
      ? {}
      : { anyOf: atLeastOneOf.map((name) => ({ required: [name] })) }),
    additionalProperties: false as const,
  })
}

function integerSchema(minimum: number, maximum: number): ProfileJsonValue {
  return { type: 'integer', minimum, maximum }
}

function stringArraySchema(maxItems: number, minItems = 0): ProfileJsonValue {
  return {
    type: 'array',
    ...(minItems === 0 ? {} : { minItems }),
    maxItems,
    uniqueItems: true,
    items: { type: 'string', minLength: 1 },
  }
}

function deepFreeze<Value>(value: Value): Value {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) deepFreeze(child)
    Object.freeze(value)
  }
  return value
}

function validateGatewayRequest(candidate: unknown): ProfileServiceResult<ProfileGatewayRequest> {
  if (
    !isInertJson(candidate)
    || !isJsonObject(candidate)
    || !hasExactKeys(candidate, ['operation', 'params', 'requestId', 'version'])
    || !Number.isSafeInteger(candidate.version)
    || (candidate.version as number) < 1
  ) return profileServiceFailure('invalid')
  if ((candidate.version as number) > PROFILE_GATEWAY_PROTOCOL_VERSION) {
    return profileServiceFailure('unsupported-future-version', {
      supportedGatewayProtocolVersion: PROFILE_GATEWAY_PROTOCOL_VERSION,
    })
  }
  if (
    candidate.version !== PROFILE_GATEWAY_PROTOCOL_VERSION
    || typeof candidate.requestId !== 'string'
    || candidate.requestId.length === 0
    || utf8ByteLength(candidate.requestId) > PROFILE_GATEWAY_REQUEST_LIMITS.maxRequestIdBytes
    || typeof candidate.operation !== 'string'
    || candidate.operation.length === 0
    || utf8ByteLength(candidate.operation) > PROFILE_GATEWAY_REQUEST_LIMITS.maxOperationBytes
    || !isJsonObject(candidate.params)
  ) return profileServiceFailure('invalid')
  return {
    ok: true,
    value: Object.freeze({
      version: PROFILE_GATEWAY_PROTOCOL_VERSION,
      requestId: candidate.requestId,
      operation: candidate.operation as ProfileGatewayRequest['operation'],
      params: Object.freeze(candidate.params),
    }),
  }
}

/** Exported so a boundary gate can correlate its refusal with the request. */
export function readSafeRequestId(candidate: unknown): string | null {
  if (!isJsonObject(candidate)) return null
  const descriptor = Object.getOwnPropertyDescriptor(candidate, 'requestId')
  return descriptor
    && 'value' in descriptor
    && typeof descriptor.value === 'string'
    && descriptor.value.length > 0
    && utf8ByteLength(descriptor.value) <= PROFILE_GATEWAY_REQUEST_LIMITS.maxRequestIdBytes
    ? descriptor.value
    : null
}

function isInertJson(candidate: unknown): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [{ value: candidate, depth: 0 }]
  const seen = new WeakSet<object>()
  let nodes = 0
  while (pending.length > 0) {
    const current = pending.pop()!
    nodes += 1
    if (nodes > PROFILE_GATEWAY_REQUEST_LIMITS.maxJsonNodes) return false
    if (current.depth > PROFILE_GATEWAY_REQUEST_LIMITS.maxJsonDepth) return false
    if (
      current.value === null
      || typeof current.value === 'boolean'
      || typeof current.value === 'string'
    ) continue
    if (typeof current.value === 'number') {
      if (!Number.isFinite(current.value)) return false
      continue
    }
    if (typeof current.value !== 'object' || seen.has(current.value)) return false
    seen.add(current.value)

    if (Array.isArray(current.value)) {
      const keys = Reflect.ownKeys(current.value)
      if (
        keys.some((key) => typeof key !== 'string')
        || keys.length !== current.value.length + 1
        || !keys.includes('length')
      ) return false
      for (let index = 0; index < current.value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(current.value, String(index))
        if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false
        pending.push({ value: descriptor.value, depth: current.depth + 1 })
      }
      continue
    }

    const prototype = Object.getPrototypeOf(current.value)
    if (prototype !== Object.prototype && prototype !== null) return false
    for (const key of Reflect.ownKeys(current.value)) {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(current.value, key)
      if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return false
      pending.push({ value: descriptor.value, depth: current.depth + 1 })
    }
  }
  return true
}

function isJsonObject(value: unknown): value is Record<string, ProfileJsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && hasOnlyKeys(value, expected)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
