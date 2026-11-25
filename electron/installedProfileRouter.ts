import type {
  GuiOrdinaryNewIdeaAuthorization,
  GuiProfileOwnerContext,
} from '../src/persistence/profileGuiProjection'
import {
  createProfileGuiSaveScheduler,
  type ProfileGuiSaveFlushResult,
  type ProfileGuiSaveIdentity,
  type ProfileGuiSaveScheduler,
} from '../src/persistence/profileGuiSaveScheduler'
import {
  INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY,
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
  type ProfileAgentCommandBatchReceipt,
} from '../src/persistence/profileAgentCommandInstallation'
import type { ProfileAgentCommandRequest } from '../src/persistence/profileAgentCommandPlan'
import type { ProfileGatewaySessionService } from '../src/persistence/profileAgentGateway'
import {
  profileServiceFailure,
  type ProfileDuplicateIdeaRequest,
  type ProfileIdeaLifecycleReceipt,
  type ProfileServiceFailure,
  type ProfileServiceResult,
  type ProfileSnapshot,
} from '../src/persistence/profileServiceContract'
import {
  PROFILE_BRIDGE_VERSION,
  type ProfileBridgeFailure,
  type ProfileBridgeImportIdeaClosureRequest,
  type ProfileBridgeOperation,
  type ProfileBridgeOperationResults,
  type ProfileBridgePortableExportRequest,
  type ProfileBridgeRequest,
  type ProfileBridgeResponse,
  type ProfileBridgeSuccess,
  type RendererProfileProjection,
} from './profileBridgeContract'
import type { ProfileUtilityClient, ProfileUtilityExit } from './profileUtilityClient'
import { terminateAndJoinProfileUtility } from './profileUtilityLifecycle'
import type { ProfileUtilityOperationResults } from './profileUtilityProtocol'
import type { InstalledProfileAgentMutationBarrier } from './profileRendererAgentBarrier'

export type InstalledProfileRouterOptions = Readonly<{
  client: ProfileUtilityClient
  trustedActorId: string
  createIdentity: () => ProfileGuiSaveIdentity
  createHydrationEpoch: () => string
  acquireRendererAgentMutationBarrier?: () => Promise<InstalledProfileAgentMutationBarrier>
  onRendererAgentMutationBarrierFailure?: (error: Error) => void
  onShutdownUtilityTerminationRequested?: () => void
  utilityExitTimeoutMs?: number
  choosePortableExportPath?: (
    request: ProfileBridgePortableExportRequest,
  ) => Promise<string | undefined>
  choosePortableImportPath?: (
    request: ProfileBridgeImportIdeaClosureRequest,
  ) => Promise<string | undefined>
}>

export const MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY: unique symbol = Symbol(
  'macos-update-profile-shutdown-capability',
)

export type InstalledProfileShutdownCapability =
  typeof MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY

export type InstalledProfileRouter = Readonly<{
  route(request: ProfileBridgeRequest): Promise<ProfileBridgeResponse>
  openAgentService(
    identity: InstalledProfileAgentIdentity,
  ): ProfileServiceResult<ProfileGatewaySessionService>
  pauseAgentAdmission(): Promise<() => void>
  flushForUpdate(
    rendererCheckpoint: InstalledProfileRendererCheckpoint,
  ): Promise<InstalledProfileShutdownReceipt & { state: 'flushed' }>
  shutdown(
    rendererCheckpoint?: InstalledProfileRendererCheckpoint,
    capability?: InstalledProfileShutdownCapability,
  ): Promise<InstalledProfileShutdownReceipt>
}>

export type InstalledProfileAgentIdentity = Readonly<{
  client: string
  sessionId: string
}>

export type InstalledProfileRendererCheckpoint = Readonly<{
  nativeGeneration: number
  revision: number
}>

export type InstalledProfileShutdownReceipt =
  | Readonly<{ state: 'flushed'; generation: number; revision: number }>
  | Readonly<{ state: 'recovery-only'; revision: number }>

type ScheduledCommit = Readonly<{
  scheduler: ProfileGuiSaveScheduler<RendererProfileProjection, GuiProfileOwnerContext>
}>

type SchedulerFlushReceipt = Readonly<{
  generation: number
  revision: number
}>

type GuardedLifecycleOperation = 'duplicate-idea' | 'import-idea-closure'

type RendererRehydrationGuard =
  | Readonly<{ kind: 'conflict' | 'recovery'; revision: number }>
  | Readonly<{
      kind: 'lifecycle'
      revision: number
      operation: GuardedLifecycleOperation
      requestEvidence: string
      receipt: ProfileIdeaLifecycleReceipt
      sourcePath?: string
    }>

export async function createInstalledProfileRouter(
  options: InstalledProfileRouterOptions,
): Promise<InstalledProfileRouter> {
  const utilityExitTimeoutMs = options.utilityExitTimeoutMs ?? 5_000
  if (!Number.isSafeInteger(utilityExitTimeoutMs)
    || utilityExitTimeoutMs <= 0
    || utilityExitTimeoutMs > 60_000) {
    throw new Error('Profile utility exit timeout is invalid')
  }
  let admitting = true
  let terminalLoss = false
  let recoveryRequired = false
  let recoveryCurrentRevision: number | undefined
  let authoritativeProfileId: string | undefined
  let rendererRehydrationGuard: RendererRehydrationGuard | undefined
  let pendingHydrationAcknowledgement: Readonly<{
    epoch: string
    revision: number
  }> | undefined
  let acceptedHydrationAcknowledgement: Readonly<{
    epoch: string
    revision: number
  }> | undefined
  let scheduler: ProfileGuiSaveScheduler<RendererProfileProjection, GuiProfileOwnerContext> | undefined
  let fifo: Promise<void> = Promise.resolve()
  let agentMutationFifo: Promise<void> = Promise.resolve()
  let agentAdmissionPaused = false
  let shutdownPromise: Promise<InstalledProfileShutdownReceipt> | undefined
  let shutdownCheckpoint: InstalledProfileRendererCheckpoint | undefined
  let terminalTerminationPromise: Promise<ProfileUtilityExit> | undefined
  let shutdownUtilityTerminationRequested = false
  const pendingOrdinaryCreates = new Map<string, GuiOrdinaryNewIdeaAuthorization>()
  const issuedAuthorizationBindings = new Map<string, string>()
  const issuedHydrationEpochs = new Set<string>()

  options.client.onTerminalLoss(() => {
    if (shutdownUtilityTerminationRequested) return
    terminalLoss = true
    admitting = false
  })

  const ready = await options.client.ready()
  if (ready.state === 'recovery-required') {
    recoveryRequired = true
    recoveryCurrentRevision = ready.currentRevision
  } else {
    const hydrated = await hydrateAndReset(ready.revision)
    if (!hydrated.ok) {
      throw new Error(`Installed Profile hydration failed: ${hydrated.message}`)
    }
  }

  function createScheduler(
    initialRevision: number,
  ): ProfileGuiSaveScheduler<RendererProfileProjection, GuiProfileOwnerContext> {
    // Ordinary Idea creation and authorization refresh both replace the
    // scheduler mid-session. The renderer correlates every commit receipt
    // against one rising native generation, so the replacement continues the
    // outgoing count; restarting it reads to the renderer as a rewound
    // authority and fails the Profile closed.
    return createProfileGuiSaveScheduler({
      initialRevision,
      initialGeneration: scheduler?.inspect().latestGeneration ?? 0,
      createIdentity: options.createIdentity,
      async submit(request) {
        const result = await options.client.request(
          'commit-gui-projection',
          Object.freeze({
            generation: request.generation,
            expectedRevision: request.expectedRevision,
            clientTxnId: request.clientTxnId,
            idempotencyKey: request.idempotencyKey,
            committedAt: request.committedAt,
            context: request.context,
            rendererProjection: request.projection,
          }),
        )
        if (!result.ok) return result
        const expectedAuthorizationIds = request.context.ordinaryNewIdeas.map(
          (authorization) => authorization.authorizationId,
        )
        if (result.value.generation !== request.generation
          || result.value.clientTxnId !== request.clientTxnId
          || result.value.idempotencyKey !== request.idempotencyKey
          || result.value.previousRevision !== request.expectedRevision
          || request.expectedRevision >= Number.MAX_SAFE_INTEGER
          || result.value.revision !== request.expectedRevision + 1
          || !sameExactStringSet(result.value.authorizationIds, expectedAuthorizationIds)) {
          protocolCorruption('Profile utility returned an uncorrelated GUI commit receipt')
        }
        for (const authorization of request.context.ordinaryNewIdeas) {
          if (pendingOrdinaryCreates.get(authorization.ideaId)?.authorizationId
            === authorization.authorizationId) {
            const ideaId = authorization.ideaId
            pendingOrdinaryCreates.delete(ideaId)
          }
        }
        return Object.freeze({ ok: true as const, revision: result.value.revision })
      },
      async confirmRevision(expectedRevision) {
        const result = await options.client.request(
          'confirm-revision',
          Object.freeze({ expectedRevision }),
        )
        if (!result.ok) throw new Error(result.message)
        if (result.value.revision !== expectedRevision
          || result.value.durable !== true
          || result.value.dirty !== false) {
          protocolCorruption('Profile utility returned an invalid revision confirmation')
        }
        return result.value
      },
    })
  }

  async function hydrate(
    expectedRevision?: number,
  ): Promise<ProfileServiceResult<ProfileSnapshot>> {
    const hydrated = await options.client.request('hydrate', Object.freeze({}))
    if (!hydrated.ok) return hydrated
    if (authoritativeProfileId !== undefined
      && hydrated.value.profileId !== authoritativeProfileId) {
      protocolCorruption('Profile utility hydration changed authoritative Profile identity')
    }
    if (expectedRevision !== undefined && hydrated.value.revision !== expectedRevision) {
      protocolCorruption('Profile utility hydration revision did not match native high-water')
    }
    authoritativeProfileId ??= hydrated.value.profileId
    return hydrated
  }

  async function hydrateAndReset(
    expectedRevision?: number,
  ): Promise<ProfileServiceResult<ProfileSnapshot>> {
    const hydrated = await hydrate(expectedRevision)
    if (!hydrated.ok) return hydrated
    scheduler = createScheduler(hydrated.value.revision)
    recoveryRequired = false
    recoveryCurrentRevision = undefined
    return hydrated
  }

  function enqueue<Result>(
    operation: () => Promise<Result>,
    request?: ProfileBridgeRequest,
  ): Promise<Result> {
    const guardedOperation = async (): Promise<Result> => {
      if (terminalLoss) throw new Error('Installed Profile authority is terminal')
      try {
        const deniedRevision = request === undefined
          ? undefined
          : guardedAdmissionDeniedRevision(request, rendererRehydrationGuard)
        if (deniedRevision !== undefined) {
          throw new InstalledProfileGuardDeniedError(deniedRevision)
        }
        const result = await operation()
        if (terminalLoss) throw new Error('Installed Profile authority became terminal')
        return result
      } catch (error) {
        if (error instanceof InstalledProfileGuardDeniedError) throw error
        await startTerminalTermination()
        throw error
      }
    }
    const result = fifo.then(guardedOperation, guardedOperation)
    fifo = result.then(() => undefined, () => undefined)
    return result
  }

  function startTerminalTermination(): Promise<ProfileUtilityExit> {
    terminalLoss = true
    admitting = false
    terminalTerminationPromise ??= terminateAndJoinProfileUtility(
      options.client,
      utilityExitTimeoutMs,
    )
    return terminalTerminationPromise
  }

  function startJoinedShutdownTermination(): Promise<ProfileUtilityExit> {
    if (!shutdownUtilityTerminationRequested) {
      shutdownUtilityTerminationRequested = true
      try {
        options.onShutdownUtilityTerminationRequested?.()
      } catch {
        // Withdrawal of an observer cannot prevent bounded utility cleanup.
      }
    }
    terminalTerminationPromise ??= terminateAndJoinProfileUtility(
      options.client,
      utilityExitTimeoutMs,
    )
    return terminalTerminationPromise
  }

  function protocolCorruption(message: string): never {
    void startTerminalTermination().catch(() => undefined)
    throw new Error(message)
  }

  async function flushActiveScheduler(): Promise<ProfileServiceResult<SchedulerFlushReceipt>> {
    if (!scheduler) return profileServiceFailure('corrupt-or-recovery-required')
    return flushScheduler(scheduler)
  }

  async function flushScheduler(
    activeScheduler: ProfileGuiSaveScheduler<RendererProfileProjection, GuiProfileOwnerContext>,
  ): Promise<ProfileServiceResult<SchedulerFlushReceipt>> {
    let retriedUncertain = false
    while (true) {
      const flushed = await activeScheduler.flush()
      if (terminalLoss) throw new Error('Installed Profile authority became terminal while flushing')
      if (!flushed.ok
        && flushed.kind === 'uncertain'
        && !retriedUncertain
        && activeScheduler.retryUncertain()) {
        retriedUncertain = true
        continue
      }
      if (!flushed.ok && flushed.kind === 'conflict') {
        requireRendererRehydration(Object.freeze({
          kind: 'conflict',
          revision: flushed.currentRevision,
        }))
      }
      return schedulerFlushResult(flushed)
    }
  }

  async function scheduleRendererCommit(
    rendererProjection: RendererProfileProjection,
  ): Promise<ScheduledCommit | ProfileServiceFailure | SchedulerFlushReceipt> {
    if (rendererRehydrationGuard !== undefined) {
      return profileServiceFailure('conflict', {
        currentRevision: rendererRehydrationGuard.revision,
      })
    }
    if (!scheduler) return profileServiceFailure('corrupt-or-recovery-required')
    let applicable = applicableAuthorizations(rendererProjection, pendingOrdinaryCreates)
    if (applicable.length > 0) {
      const prior = await flushActiveScheduler()
      if (!prior.ok) return prior
      const stale = applicable.filter((authorization) => (
        authorization.baseRevision !== prior.value.revision
      ))
      if (stale.length > 0) {
        for (const authorization of stale) {
          const refreshed = await options.client.request(
            'authorize-ordinary-idea-create',
            Object.freeze({ ideaId: authorization.ideaId }),
          )
          if (!refreshed.ok) return refreshed
          validateOrdinaryAuthorization(
            refreshed.value,
            authorization.ideaId,
            prior.value.revision,
          )
          pendingOrdinaryCreates.set(authorization.ideaId, refreshed.value)
        }
        scheduler = createScheduler(prior.value.revision)
        applicable = applicableAuthorizations(rendererProjection, pendingOrdinaryCreates)
      }
    }
    if (!scheduler) return profileServiceFailure('internal')
    const activeScheduler = scheduler
    activeScheduler.schedule(rendererProjection, Object.freeze({
      trustedActorId: options.trustedActorId,
      ordinaryNewIdeas: Object.freeze(applicable),
    }))
    if (applicable.length === 0) return Object.freeze({ scheduler: activeScheduler })
    // Keep the FIFO closed until the one-use authorization is consumed. A
    // later projection must never capture the same native proof.
    const result = await flushScheduler(activeScheduler)
    return result.ok ? result.value : result
  }

  async function routeHealthy(request: ProfileBridgeRequest): Promise<ProfileBridgeResponse> {
    switch (request.operation) {
      case 'commit-gui-projection': {
        const rendererProjection = captureRendererProjection(request.payload.projection)
        return enqueue(async () => {
          const scheduled = await scheduleRendererCommit(rendererProjection)
          if ('ok' in scheduled) return bridgeFailure(request, scheduled)
          if ('scheduler' in scheduled) {
            const flushed = await flushScheduler(scheduled.scheduler)
            return flushed.ok
              ? bridgeGuiCommitSuccess(request, flushed.value)
              : bridgeFailure(request, flushed)
          }
          return bridgeGuiCommitSuccess(request, scheduled)
        }, request)
      }
      case 'create-ordinary-idea':
        return enqueue(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return bridgeFailure(request, flushed)
          const currentRevision = flushed.value.revision
          const ideaId = request.payload.ideaId as string
          const authorized = await options.client.request(
            'authorize-ordinary-idea-create',
            Object.freeze({ ideaId }),
          )
          if (!authorized.ok) return bridgeFailure(request, authorized)
          validateOrdinaryAuthorization(authorized.value, ideaId, currentRevision)
          scheduler = createScheduler(authorized.value.baseRevision)
          pendingOrdinaryCreates.set(ideaId, authorized.value)
          return bridgeSuccess(request, Object.freeze({
            ideaId,
            authorized: true as const,
            createdAt: authorized.value.createdAt,
          }))
        }, request)
      case 'duplicate-idea':
        return enqueue(() => runIdeaMutator(
          request,
          'duplicate-idea',
          request.payload.request as ProfileDuplicateIdeaRequest,
        ), request)
      case 'import-idea-closure':
        return enqueue(async () => {
          const portableRequest = request.payload.request as ProfileBridgeImportIdeaClosureRequest
          const currentRevisionBeforeCall = await lifecycleCurrentHighWater(
            'import-idea-closure',
            portableRequest,
          )
          if (typeof currentRevisionBeforeCall !== 'number') {
            return bridgeFailure(request, currentRevisionBeforeCall)
          }
          const activeGuard = rendererRehydrationGuard
          const guardedSourcePath = activeGuard?.kind === 'lifecycle'
            && activeGuard.operation === 'import-idea-closure'
            && activeGuard.requestEvidence === lifecycleRequestEvidence(
              'import-idea-closure',
              portableRequest,
            )
            ? activeGuard.sourcePath
            : undefined
          const sourcePath = guardedSourcePath
            ?? await options.choosePortableImportPath?.(portableRequest)
          if (!sourcePath) return bridgeSuccess(request, Object.freeze({ cancelled: true as const }))
          const imported = await options.client.request('import-idea-closure', Object.freeze({
            request: portableRequest,
            sourcePath,
          }))
          if (!imported.ok) return bridgeFailure(request, imported)
          if (imported.value.kind !== 'import-idea') {
            protocolCorruption('Profile utility returned the wrong import lifecycle kind')
          }
          const currentRevision = acceptLifecycleReceipt(
            'import-idea-closure',
            portableRequest,
            imported.value,
            currentRevisionBeforeCall,
            sourcePath,
          )
          if (!isExactActiveGuardReplay(
            'import-idea-closure',
            portableRequest,
            imported.value,
            currentRevision,
            sourcePath,
          )) {
            requireRendererRehydration(lifecycleGuard(
              'import-idea-closure',
              portableRequest,
              imported.value,
              currentRevision,
              sourcePath,
            ))
          }
          return bridgeSuccess(request, imported.value)
        }, request)
      case 'restore-recovery':
        return enqueue(() => restoreRecovery(request, true), request)
      case 'start-fresh':
        // Start fresh is a recovery-only escape hatch. A healthy Profile never
        // offers it, so a healthy-route request is an invalid renderer state.
        return enqueue(async () => bridgeFailure(request, profileServiceFailure('invalid')), request)
      case 'export-portable':
        return enqueue(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return bridgeFailure(request, flushed)
          const portableRequest = request.payload.request as ProfileBridgePortableExportRequest
          const destinationPath = await options.choosePortableExportPath?.(portableRequest)
          if (!destinationPath) return bridgeSuccess(request, Object.freeze({ cancelled: true as const }))
          const exported = await options.client.request(
            'export-portable',
            Object.freeze({
              request: portableRequest,
              destinationPath,
            }),
          )
          if (!exported.ok) return bridgeFailure(request, exported)
          if (exported.value.operationId !== portableRequest.operationId
            || exported.value.profileId !== authoritativeProfileId
            || exported.value.revision !== portableRequest.expectedRevision
            || exported.value.revision !== flushed.value.revision) {
            protocolCorruption('Profile utility returned an uncorrelated portable export receipt')
          }
          return bridgeSuccess(request, exported.value)
        }, request)
      case 'inspect-recovery':
        return enqueue(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return bridgeFailure(request, flushed)
          const inspected = await options.client.request('inspect-recovery', Object.freeze({}))
          if (inspected.ok) validateRecoveryInspection(inspected.value, flushed.value.revision)
          return recoveryInspectionResponse(
            request,
            inspected,
          )
        }, request)
      case 'hydrate':
        return enqueue(async () => {
          let expectedRevision = rendererRehydrationGuard?.revision
          if (expectedRevision === undefined) {
            const flushed = await flushActiveScheduler()
            if (!flushed.ok) return bridgeFailure(request, flushed)
            expectedRevision = flushed.value.revision
          }
          const hydrated = await hydrate(expectedRevision)
          if (!hydrated.ok) return bridgeFailure(request, hydrated)
          const guard = rendererRehydrationGuard
          if (guard?.kind === 'lifecycle'
            && guard.revision === guard.receipt.revision
            && (hydrated.value.activeIdeaId !== guard.receipt.targetIdeaId
              || !hydrated.value.ideas.some((idea) => idea.id === guard.receipt.targetIdeaId)
              || !Object.prototype.hasOwnProperty.call(
                hydrated.value.boards,
                guard.receipt.targetIdeaId,
              ))) {
            protocolCorruption('Hydration did not contain the guarded lifecycle target')
          }
          const acknowledgement = createHydrationAcknowledgement(hydrated.value.revision)
          if (!acknowledgement.ok) return bridgeFailure(request, acknowledgement)
          return bridgeSuccess(request, Object.freeze({
            intentActorId: options.trustedActorId,
            snapshot: hydrated.value,
            acknowledgement: acknowledgement.value,
          }))
        }, request)
      case 'ack-hydration':
        return enqueue(async () => {
          const pending = pendingHydrationAcknowledgement
          const replay = acceptedHydrationAcknowledgement
          if (!pending
            && replay
            && request.payload.epoch === replay.epoch
            && request.payload.revision === replay.revision) {
            return bridgeSuccess(request, Object.freeze({
              acknowledged: true as const,
              epoch: replay.epoch,
              revision: replay.revision,
            }))
          }
          if (!pending
            || rendererRehydrationGuard?.revision !== pending.revision
            || request.payload.epoch !== pending.epoch
            || request.payload.revision !== pending.revision) {
            protocolCorruption('Renderer hydration acknowledgement did not match issued authority')
          }
          scheduler = createScheduler(pending.revision)
          pendingHydrationAcknowledgement = undefined
          acceptedHydrationAcknowledgement = pending
          rendererRehydrationGuard = undefined
          return bridgeSuccess(request, Object.freeze({
            acknowledged: true as const,
            epoch: pending.epoch,
            revision: pending.revision,
          }))
        }, request)
      case 'flush':
        return enqueue(async () => {
          const flushed = await flushActiveScheduler()
          return flushed.ok
            ? bridgeSuccess(request, flushed.value)
            : bridgeFailure(request, flushed)
        }, request)
      case 'runtime-probe':
      case 'status':
      case 'capabilities':
      case 'query':
        return enqueue(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return bridgeFailure(request, flushed)
          switch (request.operation) {
            case 'runtime-probe':
              return serviceResponse(
                request,
                await options.client.request('runtime-probe', Object.freeze({})),
              )
            case 'status': {
              const status = await options.client.request('status', Object.freeze({}))
              if (status.ok && (
                status.value.profileId !== authoritativeProfileId
                || status.value.revision !== flushed.value.revision
                || status.value.state !== 'ready'
                || status.value.dirty !== 'clean'
                || status.value.owner.mode !== 'mutable'
                || status.value.owner.route !== 'active-owner'
              )) {
                protocolCorruption('Profile utility returned impossible installed status evidence')
              }
              return serviceResponse(request, status)
            }
            case 'capabilities': {
              const capabilities = await options.client.request('capabilities', Object.freeze({}))
              if (capabilities.ok && capabilities.value.adapter !== 'sqlite') {
                protocolCorruption('Profile utility returned the wrong installed adapter capability')
              }
              return serviceResponse(request, capabilities)
            }
            case 'query': {
              const queried = await options.client.request(
                'query',
                Object.freeze({ request: request.payload.request }),
              )
              if (queried.ok
                && (queried.value.profileId !== authoritativeProfileId
                  || queried.value.revision !== flushed.value.revision)) {
                protocolCorruption('Profile utility returned an uncorrelated query page')
              }
              return serviceResponse(request, queried)
            }
          }
        }, request)
    }
  }

  async function runIdeaMutator(
    request: ProfileBridgeRequest<'duplicate-idea'>,
    operation: 'duplicate-idea',
    lifecycleRequest: ProfileDuplicateIdeaRequest,
  ): Promise<ProfileBridgeResponse> {
    const currentRevisionBeforeCall = await lifecycleCurrentHighWater(operation, lifecycleRequest)
    if (typeof currentRevisionBeforeCall !== 'number') {
      return bridgeFailure(request, currentRevisionBeforeCall)
    }
    const mutated = await options.client.request(operation, Object.freeze({ request: lifecycleRequest }))
    if (!mutated.ok) return bridgeFailure(request, mutated)
    if (mutated.value.kind !== 'duplicate-idea') {
      protocolCorruption('Profile utility returned the wrong duplicate lifecycle kind')
    }
    const currentRevision = acceptLifecycleReceipt(
      operation,
      lifecycleRequest,
      mutated.value,
      currentRevisionBeforeCall,
      undefined,
    )
    if (!isExactActiveGuardReplay(
      operation,
      lifecycleRequest,
      mutated.value,
      currentRevision,
      undefined,
    )) {
      requireRendererRehydration(lifecycleGuard(
        operation,
        lifecycleRequest,
        mutated.value,
        currentRevision,
        undefined,
      ))
    }
    return bridgeSuccess(request, mutated.value)
  }

  async function lifecycleCurrentHighWater(
    operation: GuardedLifecycleOperation,
    request: ProfileDuplicateIdeaRequest | ProfileBridgeImportIdeaClosureRequest,
  ): Promise<number | ProfileServiceFailure> {
    const guard = rendererRehydrationGuard
    if (guard?.kind === 'lifecycle'
      && guard.operation === operation
      && guard.requestEvidence === lifecycleRequestEvidence(operation, request)) {
      return guard.revision
    }
    const flushed = await flushActiveScheduler()
    return flushed.ok ? flushed.value.revision : flushed
  }

  function acceptLifecycleReceipt(
    operation: GuardedLifecycleOperation,
    request: ProfileDuplicateIdeaRequest | ProfileBridgeImportIdeaClosureRequest,
    receipt: ProfileIdeaLifecycleReceipt,
    currentRevisionBeforeCall: number,
    sourcePath: string | undefined,
  ): number {
    const expectedKind = operation === 'duplicate-idea' ? 'duplicate-idea' : 'import-idea'
    const evidence = lifecycleRequestEvidence(operation, request)
    const activeGuard = rendererRehydrationGuard
    const prior = activeGuard?.kind === 'lifecycle'
      && activeGuard.operation === operation
      && activeGuard.requestEvidence === evidence
      ? activeGuard
      : undefined
    if (receipt.kind !== expectedKind
      || receipt.operationId !== request.operationId
      || receipt.previousRevision !== request.expectedRevision
      || request.expectedRevision >= Number.MAX_SAFE_INTEGER
      || receipt.revision !== request.expectedRevision + 1
      || (prior !== undefined && (
        prior.operation !== operation
        || prior.requestEvidence !== evidence
        || !sameLifecycleReceiptEvidence(receipt, prior.receipt)
        || receipt.replayed !== true
        || prior.sourcePath !== sourcePath
      ))
      || (prior === undefined && (
        receipt.replayed
          ? currentRevisionBeforeCall < receipt.revision
          : currentRevisionBeforeCall !== request.expectedRevision
      ))) {
      protocolCorruption('Profile utility returned invalid lifecycle receipt evidence')
    }
    return receipt.replayed ? currentRevisionBeforeCall : receipt.revision
  }

  function lifecycleGuard(
    operation: GuardedLifecycleOperation,
    request: ProfileDuplicateIdeaRequest | ProfileBridgeImportIdeaClosureRequest,
    receipt: ProfileIdeaLifecycleReceipt,
    revision: number,
    sourcePath: string | undefined,
  ): RendererRehydrationGuard {
    return Object.freeze({
      kind: 'lifecycle',
      revision,
      operation,
      requestEvidence: lifecycleRequestEvidence(operation, request),
      receipt,
      ...(sourcePath === undefined ? {} : { sourcePath }),
    })
  }

  function isExactActiveGuardReplay(
    operation: GuardedLifecycleOperation,
    request: ProfileDuplicateIdeaRequest | ProfileBridgeImportIdeaClosureRequest,
    receipt: ProfileIdeaLifecycleReceipt,
    revision: number,
    sourcePath: string | undefined,
  ): boolean {
    const guard = rendererRehydrationGuard
    return guard?.kind === 'lifecycle'
      && guard.operation === operation
      && guard.requestEvidence === lifecycleRequestEvidence(operation, request)
      && guard.revision === revision
      && guard.sourcePath === sourcePath
      && receipt.replayed === true
      && sameLifecycleReceiptEvidence(receipt, guard.receipt)
  }

  function validateOrdinaryAuthorization(
    authorization: GuiOrdinaryNewIdeaAuthorization,
    ideaId: string,
    baseRevision: number,
  ): void {
    const evidence = JSON.stringify([
      authorization.authorizationId,
      authorization.profileId,
      authorization.baseRevision,
      authorization.ideaId,
      authorization.boardId,
      authorization.createdAt,
      authorization.expiresAt,
    ])
    const priorEvidence = issuedAuthorizationBindings.get(authorization.authorizationId)
    if (authorization.ideaId !== ideaId
      || authorization.baseRevision !== baseRevision
      || authorization.profileId !== authoritativeProfileId
      || authorization.boardId !== `board:${ideaId}`
      || (priorEvidence !== undefined && (
        priorEvidence !== evidence
        || pendingOrdinaryCreates.get(ideaId)?.authorizationId !== authorization.authorizationId
      ))) {
      protocolCorruption('Profile utility returned an invalid ordinary-create authorization')
    }
    issuedAuthorizationBindings.set(authorization.authorizationId, evidence)
  }

  function requireRendererRehydration(guard: RendererRehydrationGuard): void {
    rendererRehydrationGuard = guard
    pendingHydrationAcknowledgement = undefined
    acceptedHydrationAcknowledgement = undefined
  }

  function createHydrationAcknowledgement(
    revision: number,
  ): ProfileServiceResult<Readonly<{ epoch: string; revision: number }>> {
    pendingHydrationAcknowledgement = undefined
    acceptedHydrationAcknowledgement = undefined
    if (rendererRehydrationGuard === undefined) {
      rendererRehydrationGuard = Object.freeze({ kind: 'conflict', revision })
    } else if (rendererRehydrationGuard.revision !== revision) {
      protocolCorruption('Hydration acknowledgement revision changed the active guard')
    }
    let epoch: string
    try {
      epoch = options.createHydrationEpoch()
    } catch {
      protocolCorruption('Installed Profile hydration epoch creation failed')
    }
    if (!boundedHydrationEpoch(epoch) || issuedHydrationEpochs.has(epoch)) {
      protocolCorruption('Installed Profile hydration epoch was invalid or reused')
    }
    issuedHydrationEpochs.add(epoch)
    const acknowledgement = Object.freeze({ epoch, revision })
    pendingHydrationAcknowledgement = acknowledgement
    return Object.freeze({ ok: true as const, value: acknowledgement })
  }

  async function restoreRecovery(
    request: ProfileBridgeRequest<'restore-recovery'>,
    flushFirst: boolean,
  ): Promise<ProfileBridgeResponse> {
    let expectedRevision = recoveryCurrentRevision
    if (flushFirst) {
      const flushed = await flushActiveScheduler()
      if (!flushed.ok) return bridgeFailure(request, flushed)
      expectedRevision = flushed.value.revision
    }
    if (expectedRevision === undefined) {
      return bridgeFailure(request, profileServiceFailure('internal'))
    }
    const restored = await options.client.request('restore-recovery', Object.freeze({
      candidateId: request.payload.candidateId,
    }))
    if (!restored.ok) return bridgeFailure(request, restored)
    if (restored.value.selectedCandidateId !== request.payload.candidateId
      || restored.value.revision === undefined
      || restored.value.previousRevision === undefined
      || restored.value.previousRevision !== expectedRevision
      || restored.value.revision <= restored.value.previousRevision) {
      protocolCorruption('Profile utility returned an invalid recovery restore receipt')
    }
    recoveryRequired = false
    recoveryCurrentRevision = undefined
    pendingOrdinaryCreates.clear()
    requireRendererRehydration(Object.freeze({
      kind: 'recovery',
      revision: restored.value.revision,
    }))
    return bridgeSuccess(request, Object.freeze({
      mode: 'restore' as const,
      selectedCandidateId: restored.value.selectedCandidateId,
      rejectedCandidateIds: restored.value.rejectedCandidateIds,
      quarantinedCurrentState: restored.value.quarantinedCurrentState,
      previousRevision: restored.value.previousRevision,
      revision: restored.value.revision,
    }))
  }

  function validateRecoveryInspection(
    inspection: ProfileUtilityOperationResults['inspect-recovery'],
    expectedRevision: number,
  ): void {
    if (inspection.currentRevision !== expectedRevision
      || (inspection.selectedCandidateId !== undefined
        && !inspection.candidates.some(
          (candidate) => candidate.id === inspection.selectedCandidateId,
        ))) {
      protocolCorruption('Profile utility returned invalid recovery inspection evidence')
    }
  }

  async function routeRecovery(request: ProfileBridgeRequest): Promise<ProfileBridgeResponse> {
    if (request.operation === 'inspect-recovery') {
      return enqueue(async () => {
        const inspected = await options.client.request('inspect-recovery', Object.freeze({}))
        if (inspected.ok) {
          if (recoveryCurrentRevision === undefined) {
            protocolCorruption('Recovery inspection had no trusted native high-water')
          }
          validateRecoveryInspection(inspected.value, recoveryCurrentRevision)
          recoveryCurrentRevision = inspected.value.currentRevision
        }
        return recoveryInspectionResponse(request, inspected)
      }, request)
    }
    if (request.operation === 'restore-recovery') {
      return enqueue(() => restoreRecovery(request, false), request)
    }
    if (request.operation === 'start-fresh') {
      return enqueue(() => startFreshProfile(request), request)
    }
    return bridgeFailure(request, profileServiceFailure('corrupt-or-recovery-required'))
  }

  function openAgentService(
    identity: InstalledProfileAgentIdentity,
  ): ProfileServiceResult<ProfileGatewaySessionService> {
    if (!admitting || terminalLoss || agentAdmissionPaused) return profileServiceFailure('busy')
    if (!validAgentIdentity(identity)) return profileServiceFailure('invalid')
    const trustedIdentity = Object.freeze({ ...identity })
    let sessionAdmitting = true
    let closePromise: Promise<void> | undefined
    const accepted = new Set<Promise<unknown>>()

    function admit<Result>(
      operation: () => Promise<ProfileServiceResult<Result>>,
    ): Promise<ProfileServiceResult<Result>> {
      if (!sessionAdmitting || !admitting || agentAdmissionPaused) {
        return Promise.resolve(profileServiceFailure('busy'))
      }
      if (recoveryRequired) {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required', {
          ...(recoveryCurrentRevision === undefined
            ? {}
            : { currentRevision: recoveryCurrentRevision }),
        }))
      }
      const result = enqueue(operation)
      accepted.add(result)
      void result.then(
        () => accepted.delete(result),
        () => accepted.delete(result),
      )
      return result
    }

    function trackAccepted<Result>(
      result: Promise<ProfileServiceResult<Result>>,
    ): Promise<ProfileServiceResult<Result>> {
      accepted.add(result)
      void result.then(
        () => accepted.delete(result),
        () => accepted.delete(result),
      )
      return result
    }

    function reportBarrierFailure(error: unknown): void {
      admitting = false
      try {
        options.onRendererAgentMutationBarrierFailure?.(
          error instanceof Error ? error : new Error('Renderer Agent mutation barrier failed'),
        )
      } catch {
        // Barrier failure observation cannot change a durable Agent receipt.
      }
    }

    function admitAgentMutation(
      request: ProfileAgentCommandRequest,
    ): Promise<ProfileServiceResult<ProfileAgentCommandBatchReceipt>> {
      if (!sessionAdmitting || !admitting || agentAdmissionPaused) {
        return Promise.resolve(profileServiceFailure('busy'))
      }
      if (recoveryRequired) {
        return Promise.resolve(profileServiceFailure('corrupt-or-recovery-required', {
          ...(recoveryCurrentRevision === undefined
            ? {}
            : { currentRevision: recoveryCurrentRevision }),
        }))
      }
      const run = async (): Promise<ProfileServiceResult<ProfileAgentCommandBatchReceipt>> => {
        const acquireBarrier = options.acquireRendererAgentMutationBarrier
        if (!acquireBarrier) return profileServiceFailure('internal')
        let barrier: InstalledProfileAgentMutationBarrier
        try {
          barrier = await acquireBarrier()
        } catch (error) {
          reportBarrierFailure(error)
          return profileServiceFailure('internal')
        }

        let outcome: ProfileServiceResult<ProfileAgentCommandBatchReceipt>
        let committedRevision: number | undefined
        let mutationDispatched = false
        let mutationOutcomeAmbiguous = false
        let knownDurableOutcome: ProfileServiceResult<ProfileAgentCommandBatchReceipt> | undefined
        try {
          const admitted = await enqueue(async () => {
            const flushed = await flushActiveScheduler()
            if (!flushed.ok) return { outcome: flushed }
            if (barrier.checkpoint.nativeGeneration !== flushed.value.generation
              || barrier.checkpoint.revision !== flushed.value.revision) {
              protocolCorruption('Renderer Agent barrier did not match active Profile authority')
            }
            mutationDispatched = true
            const applied = await options.client.request(
              'apply-agent-command-batch',
              Object.freeze({
                request,
                transport: 'cli' as const,
                actor: trustedIdentity,
              }),
            )
            if (!applied.ok) {
              mutationOutcomeAmbiguous = !request.dryRun && (
                applied.code === 'internal'
                || applied.code === 'corrupt-or-recovery-required'
              )
              return { outcome: applied }
            }
            const nextRevision = nextLiveAgentRevision(applied.value, flushed.value.revision)
            if (nextRevision === undefined) {
              protocolCorruption('Live Agent command receipt did not match active Profile authority')
            }
            if (nextRevision > flushed.value.revision) {
              knownDurableOutcome = applied
              committedRevision = nextRevision
              scheduler = createScheduler(nextRevision)
              requireRendererRehydration(Object.freeze({
                kind: 'conflict',
                revision: nextRevision,
              }))
              return { outcome: applied, committedRevision: nextRevision }
            }
            return { outcome: applied }
          })
          outcome = admitted.outcome
          committedRevision = admitted.committedRevision
        } catch (error) {
          if (!mutationDispatched) {
            try {
              await barrier.cancel()
            } catch (barrierError) {
              reportBarrierFailure(barrierError)
            }
          } else if (committedRevision !== undefined && knownDurableOutcome !== undefined) {
            try {
              await barrier.complete(committedRevision)
            } catch (barrierError) {
              reportBarrierFailure(barrierError)
            }
            reportBarrierFailure(error)
            return knownDurableOutcome
          } else {
            // Once utility mutation dispatch begins, a thrown transport or
            // validation path is commit-ambiguous. Never release the renderer
            // onto the old base; withdraw admission and let application-level
            // terminal handling reconcile on restart.
            reportBarrierFailure(error)
          }
          throw error
        }

        try {
          if (committedRevision !== undefined) {
            await barrier.complete(committedRevision)
          } else if (mutationOutcomeAmbiguous) {
            // A resolved utility failure can still follow an indeterminate
            // COMMIT boundary. Keep the renderer on hold and withdraw live
            // admission exactly as for a thrown post-dispatch transport loss.
            reportBarrierFailure(new Error('Live Agent mutation outcome is uncertain'))
          } else {
            await barrier.cancel()
          }
        } catch (error) {
          // Completion is post-commit when committedRevision is present. The
          // exact durable outcome remains canonical even if live projection
          // delivery must be withdrawn and retried on restart.
          reportBarrierFailure(error)
        }
        return outcome
      }
      const result = agentMutationFifo.then(run, run)
      agentMutationFifo = result.then(() => undefined, () => undefined)
      return trackAccepted(result)
    }

    const service: ProfileGatewaySessionService = Object.freeze({
      status() {
        return admit(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return flushed
          const status = await options.client.request('status', Object.freeze({}))
          if (status.ok && (
            status.value.profileId !== authoritativeProfileId
            || status.value.revision !== flushed.value.revision
            || status.value.state !== 'ready'
            || status.value.dirty !== 'clean'
            || status.value.owner.mode !== 'mutable'
            || status.value.owner.route !== 'active-owner'
          )) {
            protocolCorruption('Live Agent status did not match active Profile authority')
          }
          return status
        })
      },
      capabilities() {
        return admit(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return flushed
          const capabilities = await options.client.request('capabilities', Object.freeze({}))
          if (capabilities.ok && (
            capabilities.value.adapter !== 'sqlite'
            || !sameExactStringArray(
              capabilities.value.commands,
              INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
            )
            || JSON.stringify(capabilities.value.commandBatch)
              !== JSON.stringify(INSTALLED_PROFILE_AGENT_COMMAND_CAPABILITY)
          )) {
            protocolCorruption('Live Agent capabilities did not match installed authority')
          }
          return capabilities
        })
      },
      query(request) {
        return admit(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return flushed
          const queried = await options.client.request('query', Object.freeze({ request }))
          if (queried.ok && (
            queried.value.profileId !== authoritativeProfileId
            || queried.value.revision !== flushed.value.revision
          )) {
            protocolCorruption('Live Agent query did not match active Profile authority')
          }
          return queried
        })
      },
      inspectResult(request) {
        return admit(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return flushed
          const inspected = await options.client.request(
            'inspect-result',
            Object.freeze({ request }),
          )
          if (inspected.ok && (
            inspected.value.profileId !== authoritativeProfileId
            || inspected.value.revision !== flushed.value.revision
            || inspected.value.ideaId !== request.ideaId
            || inspected.value.resultCardId !== request.resultCardId
          )) {
            protocolCorruption('Live Agent Result inspection did not match active Profile authority')
          }
          return inspected
        })
      },
      agentCardNeighbors(request) {
        return admit(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return flushed
          const neighbors = await options.client.request(
            'agent-card-neighbors',
            Object.freeze({ request }),
          )
          if (neighbors.ok && (
            neighbors.value.profileId !== authoritativeProfileId
            || neighbors.value.revision !== flushed.value.revision
            || neighbors.value.ideaId !== request.ideaId
          )) {
            protocolCorruption('Live Agent neighbor read did not match active Profile authority')
          }
          return neighbors
        })
      },
      agentCardSetBounds(request) {
        return admit(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return flushed
          const bounds = await options.client.request(
            'agent-card-set-bounds',
            Object.freeze({ request }),
          )
          if (bounds.ok && (
            bounds.value.profileId !== authoritativeProfileId
            || bounds.value.revision !== flushed.value.revision
            || bounds.value.ideaId !== request.ideaId
          )) {
            protocolCorruption('Live Agent bounds read did not match active Profile authority')
          }
          return bounds
        })
      },
      changes(request) {
        return admit(async () => {
          const flushed = await flushActiveScheduler()
          if (!flushed.ok) return flushed
          const changed = await options.client.request('changes', Object.freeze({ request }))
          if (changed.ok && (
            changed.value.profileId !== authoritativeProfileId
            || changed.value.revision !== flushed.value.revision
            || changed.value.since !== request.since
          )) {
            protocolCorruption('Live Agent change trail did not match active Profile authority')
          }
          return changed
        })
      },
      applyAgentCommandBatch(request) {
        return admitAgentMutation(request)
      },
      close() {
        if (closePromise) return closePromise
        sessionAdmitting = false
        closePromise = (async () => {
          while (accepted.size > 0) await Promise.allSettled([...accepted])
        })()
        return closePromise
      },
    })
    return { ok: true, value: service }
  }

  async function startFreshProfile(
    request: ProfileBridgeRequest<'start-fresh'>,
  ): Promise<ProfileBridgeResponse> {
    const expectedRevision = recoveryCurrentRevision
    if (expectedRevision === undefined) {
      return bridgeFailure(request, profileServiceFailure('internal'))
    }
    const fresh = await options.client.request('start-fresh', Object.freeze({}))
    if (!fresh.ok) return bridgeFailure(request, fresh)
    if (fresh.value.mode !== 'start-fresh'
      || fresh.value.previousRevision !== expectedRevision
      || (authoritativeProfileId !== undefined
        && fresh.value.profileId === authoritativeProfileId)) {
      protocolCorruption('Profile utility returned an invalid start-fresh receipt')
    }
    recoveryRequired = false
    recoveryCurrentRevision = undefined
    pendingOrdinaryCreates.clear()
    authoritativeProfileId = fresh.value.profileId
    requireRendererRehydration(Object.freeze({
      kind: 'recovery',
      revision: fresh.value.revision,
    }))
    return bridgeSuccess(request, Object.freeze({
      mode: 'start-fresh' as const,
      operationId: fresh.value.operationId,
      previousRevision: fresh.value.previousRevision,
      profileId: fresh.value.profileId,
      revision: fresh.value.revision,
      quarantinedCurrentState: fresh.value.quarantinedCurrentState,
    }))
  }

  const router: InstalledProfileRouter = Object.freeze({
    openAgentService,
    async pauseAgentAdmission() {
      if (agentAdmissionPaused) throw new Error('Installed Profile Agent admission is already paused')
      agentAdmissionPaused = true
      await agentMutationFifo
      let resumed = false
      return () => {
        if (resumed) return
        resumed = true
        if (!terminalLoss) agentAdmissionPaused = false
      }
    },
    async route(request) {
      let response: ProfileBridgeResponse
      if (!admitting) {
        response = bridgeFailure(
          request,
          profileServiceFailure(terminalLoss ? 'internal' : 'busy'),
        )
      } else {
        try {
          response = recoveryRequired ? await routeRecovery(request) : await routeHealthy(request)
        } catch (error) {
          if (error instanceof InstalledProfileGuardDeniedError) {
            response = bridgeFailure(request, profileServiceFailure('conflict', {
              currentRevision: error.revision,
            }))
          } else {
            try {
              await startTerminalTermination()
            } catch {
              // The canonical bridge result remains terminal internal failure.
            }
            response = bridgeFailure(request, profileServiceFailure('internal'))
          }
        }
      }
      if (terminalLoss && response.ok) {
        try {
          await startTerminalTermination()
        } catch {
          // The canonical bridge result remains terminal internal failure.
        }
        response = bridgeFailure(request, profileServiceFailure('internal'))
      }
      return response
    },
    async flushForUpdate(rendererCheckpoint) {
      await agentMutationFifo
      return enqueue(() => flushAtRendererCheckpoint(rendererCheckpoint))
    },
    shutdown(rendererCheckpoint, capability) {
      admitting = false
      if (shutdownPromise) {
        if (!sameShutdownCheckpoint(rendererCheckpoint, shutdownCheckpoint)) {
          return Promise.reject(new Error('Installed Profile shutdown checkpoint changed'))
        }
        return shutdownPromise
      }
      shutdownCheckpoint = rendererCheckpoint === undefined
        ? undefined
        : Object.freeze({ ...rendererCheckpoint })
      shutdownPromise ??= (async () => {
        await agentMutationFifo
        return enqueue(async () => {
        let receipt: InstalledProfileShutdownReceipt
        if (rendererRehydrationGuard !== undefined) {
          protocolCorruption('Renderer checkpoint cannot bind a pending native rehydration guard')
        } else if (scheduler) {
          if (!rendererCheckpoint) {
            protocolCorruption('Renderer shutdown checkpoint did not match native flush state')
          }
          receipt = await flushAtRendererCheckpoint(rendererCheckpoint)
        } else if (recoveryRequired && recoveryCurrentRevision !== undefined) {
          if (rendererCheckpoint !== undefined) {
            protocolCorruption('Recovery-only shutdown cannot accept a renderer checkpoint')
          }
          receipt = Object.freeze({
            state: 'recovery-only',
            revision: recoveryCurrentRevision,
          })
        } else {
          protocolCorruption('Installed Profile shutdown had no authoritative native checkpoint')
        }
        let closePromise
        try {
          closePromise = options.client.request('close', Object.freeze({}))
        } catch (error) {
          await startTerminalTermination()
          throw error
        }
        const closed = await waitForBounded(closePromise, utilityExitTimeoutMs)
        if (closed === BOUNDED_WAIT_TIMEOUT) {
          if (!acceptsJoinedShutdownTermination(receipt, capability)) {
            await startTerminalTermination()
            throw new Error('Profile utility close acknowledgement timed out')
          }
          // The exact terminal checkpoint is already durable and admission is
          // closed. A bounded joined termination resolves transport liveness
          // uncertainty without changing that authoritative receipt.
          requireCleanJoinedShutdownExit(await startJoinedShutdownTermination())
          return receipt
        }
        if (!closed.ok) {
          await startTerminalTermination()
          throw new Error(closed.message)
        }
        const cleanExit = await waitForUtilityExit(
          options.client.waitForExit(),
          utilityExitTimeoutMs,
        )
        if (!cleanExit) {
          if (!acceptsJoinedShutdownTermination(receipt, capability)) {
            await startTerminalTermination()
            throw new Error('Profile utility exit timed out after close acknowledgement')
          }
          // Close succeeded semantically; only child-process liveness remains.
          requireCleanJoinedShutdownExit(await startJoinedShutdownTermination())
          return receipt
        }
        if (cleanExit.code !== 0) {
          throw new Error('Profile utility did not exit cleanly')
        }
          return receipt
        })
      })()
      return shutdownPromise
    },
  })
  return router

  async function flushAtRendererCheckpoint(
    rendererCheckpoint: InstalledProfileRendererCheckpoint,
  ): Promise<InstalledProfileShutdownReceipt & { state: 'flushed' }> {
    if (rendererRehydrationGuard !== undefined) {
      protocolCorruption('Renderer checkpoint cannot bind a pending native rehydration guard')
    }
    if (!scheduler) {
      protocolCorruption('Installed Profile update preflight had no active scheduler')
    }
    const flushed = await flushActiveScheduler()
    if (!flushed.ok) throw new Error(flushed.message)
    const receipt = Object.freeze({
      state: 'flushed' as const,
      generation: flushed.value.generation,
      revision: flushed.value.revision,
    })
    if (rendererCheckpoint.nativeGeneration !== receipt.generation
      || rendererCheckpoint.revision !== receipt.revision) {
      protocolCorruption('Renderer update checkpoint did not match native flush state')
    }
    return receipt
  }
}

class InstalledProfileGuardDeniedError extends Error {
  constructor(readonly revision: number) {
    super('Installed Profile renderer rehydration guard denied this operation')
  }
}

function sameShutdownCheckpoint(
  left: InstalledProfileRendererCheckpoint | undefined,
  right: InstalledProfileRendererCheckpoint | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined
      && left.nativeGeneration === right.nativeGeneration
      && left.revision === right.revision
}

function acceptsJoinedShutdownTermination(
  receipt: InstalledProfileShutdownReceipt,
  capability: InstalledProfileShutdownCapability | undefined,
): receipt is InstalledProfileShutdownReceipt & { state: 'flushed' } {
  return receipt.state === 'flushed'
    && capability === MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY
}

function requireCleanJoinedShutdownExit(exit: ProfileUtilityExit): void {
  if (exit.code !== 0 || (exit.signal !== undefined && exit.signal !== null)) {
    throw new Error('Profile utility joined termination did not exit cleanly')
  }
}

function guardedAdmissionDeniedRevision(
  request: ProfileBridgeRequest,
  guard: RendererRehydrationGuard | undefined,
): number | undefined {
  if (!guard || request.operation === 'hydrate' || request.operation === 'ack-hydration') {
    return undefined
  }
  if (guard.kind === 'lifecycle'
    && (request.operation === 'duplicate-idea' || request.operation === 'import-idea-closure')
    && guard.operation === request.operation
    && guard.requestEvidence === lifecycleRequestEvidence(
      request.operation,
      request.payload.request,
    )) {
    return undefined
  }
  return guard.revision
}

function lifecycleRequestEvidence(
  operation: GuardedLifecycleOperation,
  request: ProfileDuplicateIdeaRequest | ProfileBridgeImportIdeaClosureRequest,
): string {
  return operation === 'duplicate-idea'
    ? JSON.stringify([
        operation,
        request.version,
        request.operationId,
        request.idempotencyKey,
        request.expectedRevision,
        (request as ProfileDuplicateIdeaRequest).sourceIdeaId,
        request.name ?? null,
      ])
    : JSON.stringify([
        operation,
        request.version,
        request.operationId,
        request.idempotencyKey,
        request.expectedRevision,
        request.name ?? null,
      ])
}

function sameLifecycleReceiptEvidence(
  left: ProfileIdeaLifecycleReceipt,
  right: ProfileIdeaLifecycleReceipt,
): boolean {
  return left.kind === right.kind
    && left.operationId === right.operationId
    && left.previousRevision === right.previousRevision
    && left.revision === right.revision
    && left.targetIdeaId === right.targetIdeaId
    && sameExactStringArray(left.insertedRecordIds, right.insertedRecordIds)
    && sameExactStringArray(left.importedAssetIds, right.importedAssetIds)
}

function sameExactStringArray(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((entry, index) => entry === right[index])
}

function validAgentIdentity(candidate: InstalledProfileAgentIdentity): boolean {
  return boundedAgentIdentityPart(candidate.client) && boundedAgentIdentityPart(candidate.sessionId)
}

function boundedAgentIdentityPart(candidate: unknown): candidate is string {
  return typeof candidate === 'string'
    && candidate.length > 0
    && !/[\u0000-\u001f\u007f]/.test(candidate)
    && new TextEncoder().encode(candidate).byteLength <= 128
}

function nextLiveAgentRevision(
  receipt: ProfileAgentCommandBatchReceipt,
  observedRevision: number,
): number | undefined {
  if (receipt.dryRun) {
    return receipt.previousRevision === observedRevision
      && receipt.revision === observedRevision
      ? observedRevision
      : undefined
  }
  if (receipt.replayed) {
    return receipt.revision <= observedRevision ? observedRevision : undefined
  }
  return observedRevision < Number.MAX_SAFE_INTEGER
    && receipt.previousRevision === observedRevision
    && receipt.revision === observedRevision + 1
    ? receipt.revision
    : undefined
}

function sameExactStringSet(actual: readonly string[], expected: readonly string[]): boolean {
  if (actual.length !== expected.length) return false
  if (new Set(actual).size !== actual.length) return false
  const expectedSet = new Set(expected)
  return expectedSet.size === expected.length && actual.every((entry) => expectedSet.has(entry))
}

function captureRendererProjection(projection: RendererProfileProjection): RendererProfileProjection {
  return Object.freeze({
    projectionVersion: projection.projectionVersion,
    activeIdeaId: projection.activeIdeaId,
    ideas: projection.ideas,
    boardReplacements: projection.boardReplacements,
    userModTemplates: projection.userModTemplates,
    newModOrigins: projection.newModOrigins,
  })
}

function applicableAuthorizations(
  projection: RendererProfileProjection,
  pending: ReadonlyMap<string, GuiOrdinaryNewIdeaAuthorization>,
): GuiOrdinaryNewIdeaAuthorization[] {
  const ideaIds = new Set(projection.ideas.map((idea) => idea.id))
  return [...pending.values()].filter((authorization) => ideaIds.has(authorization.ideaId))
}

function boundedHydrationEpoch(value: unknown): value is string {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= 512
}

const BOUNDED_WAIT_TIMEOUT = Symbol('bounded-wait-timeout')

async function waitForBounded<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
): Promise<Value | typeof BOUNDED_WAIT_TIMEOUT> {
  let timer: Parameters<typeof clearTimeout>[0] | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<typeof BOUNDED_WAIT_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(BOUNDED_WAIT_TIMEOUT), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

async function waitForUtilityExit(
  exitPromise: Promise<ProfileUtilityExit>,
  timeoutMs: number,
): Promise<ProfileUtilityExit | undefined> {
  let timer: Parameters<typeof clearTimeout>[0] | undefined
  try {
    return await Promise.race([
      exitPromise,
      new Promise<undefined>((resolve) => {
        timer = setTimeout(resolve, timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}


function schedulerFlushResult(
  flushed: ProfileGuiSaveFlushResult,
): ProfileServiceResult<SchedulerFlushReceipt> {
  if (flushed.ok) {
    return Object.freeze({
      ok: true,
      value: Object.freeze({ generation: flushed.generation, revision: flushed.revision }),
    })
  }
  if (flushed.kind === 'rejected') return flushed.failure
  return profileServiceFailure(
    flushed.kind === 'conflict' ? 'conflict' : 'internal',
    flushed.kind === 'conflict' ? { currentRevision: flushed.currentRevision } : {},
  )
}

function serviceResponse<Operation extends ProfileBridgeOperation>(
  request: ProfileBridgeRequest<Operation>,
  result: ProfileServiceResult<ProfileBridgeOperationResults[Operation]>,
): ProfileBridgeResponse {
  return result.ok ? bridgeSuccess(request, result.value) : bridgeFailure(request, result)
}

function recoveryInspectionResponse(
  request: ProfileBridgeRequest<'inspect-recovery'>,
  result: ProfileServiceResult<ProfileUtilityOperationResults['inspect-recovery']>,
): ProfileBridgeResponse {
  if (!result.ok) return bridgeFailure(request, result)
  return bridgeSuccess(request, Object.freeze({
    mode: 'inspect' as const,
    currentRevision: result.value.currentRevision,
    ...(result.value.selectedCandidateId === undefined
      ? {}
      : { selectedCandidateId: result.value.selectedCandidateId }),
    candidates: result.value.candidates,
    rejectedCandidateIds: result.value.rejectedCandidateIds,
    quarantinedCurrentState: false as const,
  }))
}

function bridgeGuiCommitSuccess(
  request: ProfileBridgeRequest<'commit-gui-projection'>,
  receipt: SchedulerFlushReceipt,
): ProfileBridgeResponse {
  return bridgeSuccess(request, Object.freeze({
    generation: receipt.generation,
    revision: receipt.revision,
    durable: true as const,
    dirty: false as const,
  }))
}

function bridgeFailure(
  request: ProfileBridgeRequest,
  failure: ProfileServiceFailure,
): ProfileBridgeFailure {
  const { ok: _ok, ...error } = failure
  return Object.freeze({
    version: PROFILE_BRIDGE_VERSION,
    requestId: request.requestId,
    operation: request.operation,
    ok: false,
    error: Object.freeze(error),
  })
}

function bridgeSuccess<Operation extends ProfileBridgeOperation>(
  request: ProfileBridgeRequest<Operation>,
  value: ProfileBridgeOperationResults[Operation],
): ProfileBridgeSuccess<Operation> {
  return Object.freeze({
    version: PROFILE_BRIDGE_VERSION,
    requestId: request.requestId,
    operation: request.operation,
    ok: true,
    value,
  }) as ProfileBridgeSuccess<Operation>
}
