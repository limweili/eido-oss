import { randomUUID } from 'node:crypto'
import type { ProfileGatewayService } from '../src/persistence/profileAgentGateway'
import {
  INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY,
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
  type ProfileAgentCommandBatchReceipt,
  type ProfileAgentInstalledTransport,
} from '../src/persistence/profileAgentCommandInstallation'
import type { ProfileAgentCommandRequest } from '../src/persistence/profileAgentCommandPlan'
import type {
  NormalizedProfileAgentChangeTrailRequest,
  ProfileAgentChangeTrailPage,
} from '../src/persistence/profileAgentChangeTrail'
import type {
  NormalizedProfileAgentCardNeighborsRequest,
  ProfileAgentCardNeighbors,
  ProfileAgentCardSetBounds,
  ProfileAgentCardSetBoundsRequest,
} from '../src/persistence/profileAgentSpatialQuery'
import type {
  NormalizedProfileResultInspectionRequest,
  ProfileResultInspectionPage,
} from '../src/persistence/profileResultInspection'
import {
  profileServiceFailure,
  type ProfileCapabilities,
  type ProfileQueryPage,
  type ProfileQueryRequest,
  type ProfileServiceResult,
  type ProfileStatus,
} from '../src/persistence/profileServiceContract'
import type { ProfileInstallation } from './profileInstallation'
import {
  createProfileUtilityClient,
  ProfileUtilityClientError,
  type ProfileUtilityClient,
  type ProfileUtilityTransport,
} from './profileUtilityClient'
import {
  closeAndJoinProfileUtility,
  requireProfileUtilityExitTimeout,
  terminateAndJoinProfileUtility,
} from './profileUtilityLifecycle'

const DEFAULT_HEADLESS_UTILITY_EXIT_TIMEOUT_MS = 5_000

export type InstalledProfileHeadlessLease = Readonly<
  Omit<
    ProfileGatewayService,
    | 'agentCardNeighbors'
    | 'agentCardSetBounds'
    | 'applyAgentCommandBatch'
    | 'changes'
    | 'inspectResult'
  > & {
    inspectResult(
      request: NormalizedProfileResultInspectionRequest,
    ): Promise<ProfileServiceResult<ProfileResultInspectionPage>>
    changes(
      request: NormalizedProfileAgentChangeTrailRequest,
    ): Promise<ProfileServiceResult<ProfileAgentChangeTrailPage>>
    agentCardNeighbors(
      request: NormalizedProfileAgentCardNeighborsRequest,
    ): Promise<ProfileServiceResult<ProfileAgentCardNeighbors>>
    agentCardSetBounds(
      request: ProfileAgentCardSetBoundsRequest,
    ): Promise<ProfileServiceResult<ProfileAgentCardSetBounds>>
    applyAgentCommandBatch(
      request: ProfileAgentCommandRequest,
    ): Promise<ProfileServiceResult<ProfileAgentCommandBatchReceipt>>
    close(): Promise<void>
  }
>

export type InstalledProfileHeadlessLeaseFactory = Readonly<{
  open(): Promise<ProfileServiceResult<InstalledProfileHeadlessLease>>
}>

export type InstalledProfileHeadlessLeaseFactoryOptions = Readonly<{
  installation: ProfileInstallation
  transport: ProfileAgentInstalledTransport
  createTransport: () => ProfileUtilityTransport
  createRequestId: () => string
  readyTimeoutMs?: number
  utilityExitTimeoutMs?: number
  agentClient?: string
  createAgentSessionId?: () => string
}>

export function createInstalledProfileHeadlessLeaseFactory(
  options: InstalledProfileHeadlessLeaseFactoryOptions,
): InstalledProfileHeadlessLeaseFactory {
  const utilityExitTimeoutMs = requireProfileUtilityExitTimeout(
    options.utilityExitTimeoutMs ?? DEFAULT_HEADLESS_UTILITY_EXIT_TIMEOUT_MS,
  )
  const databasePath = options.installation.databasePath
  return Object.freeze({
    open() {
      return openExistingProfile(options, databasePath, utilityExitTimeoutMs)
    },
  })
}

async function openExistingProfile(
  options: InstalledProfileHeadlessLeaseFactoryOptions,
  databasePath: string,
  utilityExitTimeoutMs: number,
): Promise<ProfileServiceResult<InstalledProfileHeadlessLease>> {
  let client: ProfileUtilityClient
  try {
    const sessionId = (options.createAgentSessionId ?? randomUUID)()
    client = createProfileUtilityClient(options.createTransport(), {
      initialize: Object.freeze({
        route: 'exclusive-headless-owner',
        databasePath,
        transport: options.transport,
        actor: Object.freeze({
          client: options.agentClient ?? `eido-${options.transport}`,
          sessionId,
        }),
      }),
      createRequestId: options.createRequestId,
      ...(options.readyTimeoutMs === undefined ? {} : { readyTimeoutMs: options.readyTimeoutMs }),
    })
  } catch {
    return profileServiceFailure('internal')
  }

  let startup: Awaited<ReturnType<ProfileUtilityClient['ready']>>
  try {
    startup = await client.ready()
  } catch (error) {
    const failure = error instanceof ProfileUtilityClientError ? error.failure : undefined
    await terminateAndJoinProfileUtility(client, utilityExitTimeoutMs)
    return failure ?? profileServiceFailure('internal')
  }

  if (startup.state === 'recovery-required') {
    await closeAndJoinProfileUtility(client, utilityExitTimeoutMs)
    return profileServiceFailure('corrupt-or-recovery-required', {
      currentRevision: startup.currentRevision,
    })
  }

  try {
    const initialStatus = await client.request('status', Object.freeze({}))
    if (!initialStatus.ok) {
      await closeAndJoinProfileUtility(client, utilityExitTimeoutMs)
      return initialStatus
    }
    assertHeadlessStatus(initialStatus.value, startup.revision)
    const initialCapabilities = await client.request('capabilities', Object.freeze({}))
    if (!initialCapabilities.ok) {
      await closeAndJoinProfileUtility(client, utilityExitTimeoutMs)
      return initialCapabilities
    }
    assertSqliteCapabilities(initialCapabilities.value)
    return {
      ok: true,
      value: createLease(
        client,
        initialStatus.value.profileId,
        initialStatus.value.revision,
        utilityExitTimeoutMs,
      ),
    }
  } catch (error) {
    await terminateAndJoinProfileUtility(client, utilityExitTimeoutMs)
    throw error
  }
}

function createLease(
  client: ProfileUtilityClient,
  profileId: string,
  revision: number,
  utilityExitTimeoutMs: number,
): InstalledProfileHeadlessLease {
  let admitting = true
  let observedRevision = revision
  let fifo: Promise<void> = Promise.resolve()
  let closePromise: Promise<void> | undefined

  function enqueue<Result>(
    operation: () => Promise<ProfileServiceResult<Result>>,
    correlate: (value: Result) => void,
  ): Promise<ProfileServiceResult<Result>> {
    if (!admitting) return Promise.resolve(profileServiceFailure('busy'))
    const guarded = async (): Promise<ProfileServiceResult<Result>> => {
      try {
        const result = await operation()
        if (result.ok) correlate(result.value)
        return result
      } catch (error) {
        admitting = false
        await terminateAndJoinProfileUtility(client, utilityExitTimeoutMs)
        throw error
      }
    }
    const result = fifo.then(guarded, guarded)
    fifo = result.then(() => undefined, () => undefined)
    return result
  }

  const lease: InstalledProfileHeadlessLease = Object.freeze({
    status() {
      return enqueue(
        () => client.request('status', Object.freeze({})),
        (value) => assertHeadlessStatus(value, observedRevision, profileId),
      )
    },
    capabilities() {
      return enqueue(
        () => client.request('capabilities', Object.freeze({})),
        assertSqliteCapabilities,
      )
    },
    query(request: ProfileQueryRequest) {
      return enqueue(
        () => client.request('query', Object.freeze({ request })),
        (value) => assertHeadlessQuery(value, profileId, observedRevision),
      )
    },
    inspectResult(request: NormalizedProfileResultInspectionRequest) {
      return enqueue(
        () => client.request('inspect-result', Object.freeze({ request })),
        (value) => assertHeadlessResultInspection(value, request, profileId, observedRevision),
      )
    },
    changes(request: NormalizedProfileAgentChangeTrailRequest) {
      return enqueue(
        () => client.request('changes', Object.freeze({ request })),
        (value) => assertHeadlessChanges(value, request, profileId, observedRevision),
      )
    },
    agentCardNeighbors(request: NormalizedProfileAgentCardNeighborsRequest) {
      return enqueue(
        () => client.request('agent-card-neighbors', Object.freeze({ request })),
        (value) => assertHeadlessSpatial(value, request.ideaId, profileId, observedRevision),
      )
    },
    agentCardSetBounds(request: ProfileAgentCardSetBoundsRequest) {
      return enqueue(
        () => client.request('agent-card-set-bounds', Object.freeze({ request })),
        (value) => assertHeadlessSpatial(value, request.ideaId, profileId, observedRevision),
      )
    },
    applyAgentCommandBatch(request: ProfileAgentCommandRequest) {
      return enqueue(
        () => client.request('apply-agent-command-batch', Object.freeze({ request })),
        (value) => {
          observedRevision = nextObservedAgentRevision(value, observedRevision)
        },
      )
    },
    close() {
      if (closePromise) return closePromise
      admitting = false
      closePromise = fifo.then(
        () => closeAndJoinProfileUtility(client, utilityExitTimeoutMs).then(() => undefined),
        () => closeAndJoinProfileUtility(client, utilityExitTimeoutMs).then(() => undefined),
      )
      return closePromise
    },
  })
  return lease
}

function assertHeadlessStatus(
  status: ProfileStatus,
  revision: number,
  profileId = status.profileId,
): void {
  if (status.profileId !== profileId
    || status.revision !== revision
    || status.state !== 'ready'
    || status.owner.mode !== 'mutable'
    || status.owner.route !== 'exclusive-headless-owner'
    || status.dirty !== 'clean') {
    throw new Error('Headless Profile status did not match the acquired authority')
  }
}

function assertSqliteCapabilities(capabilities: ProfileCapabilities): void {
  if (capabilities.adapter !== 'sqlite'
    || !sameExactStringArray(capabilities.commands, INSTALLED_PROFILE_AGENT_COMMAND_NAMES)
    || JSON.stringify(capabilities.commandBatch)
      !== JSON.stringify(INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY)) {
    throw new Error('Headless Profile capabilities did not describe installed command authority')
  }
}

function nextObservedAgentRevision(
  receipt: ProfileAgentCommandBatchReceipt,
  observedRevision: number,
): number {
  if (receipt.dryRun) {
    if (receipt.previousRevision !== observedRevision || receipt.revision !== observedRevision) {
      throw new Error('Headless Agent dry-run did not match the observed Profile head')
    }
    return observedRevision
  }
  if (receipt.replayed) {
    if (receipt.revision > observedRevision) {
      throw new Error('Headless Agent replay was ahead of the observed Profile head')
    }
    return observedRevision
  }
  if (receipt.previousRevision !== observedRevision
    || receipt.revision !== observedRevision + 1) {
    throw new Error('Headless Agent commit did not advance the observed Profile head exactly once')
  }
  return receipt.revision
}

function sameExactStringArray(actual: readonly string[], expected: readonly string[]): boolean {
  return actual.length === expected.length
    && actual.every((entry, index) => entry === expected[index])
}

function assertHeadlessQuery(
  page: ProfileQueryPage,
  profileId: string,
  revision: number,
): void {
  if (page.profileId !== profileId || page.revision !== revision) {
    throw new Error('Headless Profile query did not match the acquired authority')
  }
}

function assertHeadlessResultInspection(
  page: ProfileResultInspectionPage,
  request: NormalizedProfileResultInspectionRequest,
  profileId: string,
  revision: number,
): void {
  if (page.profileId !== profileId
    || page.revision !== revision
    || page.ideaId !== request.ideaId
    || page.resultCardId !== request.resultCardId) {
    throw new Error('Headless Result inspection did not match the acquired authority')
  }
}

function assertHeadlessChanges(
  page: ProfileAgentChangeTrailPage,
  request: NormalizedProfileAgentChangeTrailRequest,
  profileId: string,
  revision: number,
): void {
  if (page.profileId !== profileId
    || page.revision !== revision
    || page.since !== request.since) {
    throw new Error('Headless Profile changes did not match the acquired authority')
  }
}

function assertHeadlessSpatial(
  result: ProfileAgentCardNeighbors | ProfileAgentCardSetBounds,
  ideaId: string,
  profileId: string,
  revision: number,
): void {
  if (result.profileId !== profileId
    || result.revision !== revision
    || result.ideaId !== ideaId) {
    throw new Error('Headless Profile spatial read did not match the acquired authority')
  }
}
