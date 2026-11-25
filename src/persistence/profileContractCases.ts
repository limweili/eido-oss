import {
  PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS,
  PROFILE_CONTRACT_VERSIONS,
  PROFILE_SERVICE_OPERATION_METHODS,
  PROFILE_SERVICE_OPERATIONS,
  admitGatewayOperation,
  inspectProfileCompatibility,
  profileServiceFailure,
  type ProfileAdapterDescriptor,
  type ProfileCommandBatch,
  type ProfileCommandBatchReceipt,
  type ProfileOwnershipReceipt,
  type ProfileOwnershipRequest,
  type ProfileServiceResult,
  type ProfileSnapshot,
  type ProfileStatus,
  validateProfileAdapterDescriptor,
  validateProfileCommandBatch,
} from './profileServiceContract'
import {
  ALPHA_PROFILE_V1,
  ALPHA_PROFILE_V1_REVISION_8,
  profileFixtureCorpus,
  type AlphaProfileV1,
  type ProfileFixtureCase,
  type ProfileFixtureId,
  validateProfileFixtureCorpus,
} from './fixtures/profileFixtureCorpus'

export type ProfileContractCaseResult = {
  id:
    | 'versions-and-capabilities'
    | 'available-operations-are-callable'
    | 'consistent-revision-7-snapshot'
    | 'atomic-attributed-revision-8'
    | 'stale-revision-preserves-7'
    | 'precommit-failure-preserves-7-and-retry'
    | 'retained-precommit-batch-reapplies-revision-8'
    | 'future-schema-is-refused'
    | 'forbidden-gateway-operations-are-denied'
    | 'single-mutable-owner-stable-busy'
    | 'ownership-status-exposes-stable-owner'
    | 'dry-run-preserves-revision'
    | 'idempotent-retry-replays-revision-8'
    | 'mismatched-vector-preserves-revision-7'
  ok: boolean
}

export type ProfileContractFixturePurpose =
  | 'profile-source'
  | 'snapshot'
  | 'transaction'
  | 'reload'
  | 'ownership'
  | 'recovery'
  | 'portable-transfer'
  | 'gateway'
  | 'future-refusal'
  | 'platforms'

export const PROFILE_CONTRACT_FIXTURE_MAP = {
  'profile-source': ['supported-multi-idea-source'],
  snapshot: ['alpha-profile-v1-expected'],
  transaction: ['interrupted-write-input', 'atomic-transaction-rollback-scenario'],
  reload: ['wal-reload-scenario'],
  ownership: ['busy-lock-scenario'],
  recovery: ['corruption-recovery-scenario'],
  'portable-transfer': ['portable-export-import-restore-duplicate-scenario'],
  gateway: ['agent-gateway-allow-deny-scenario'],
  'future-refusal': ['unsupported-future-profile'],
  platforms: ['macos-arm64-windows-x64-evidence-scenario'],
} as const satisfies Record<ProfileContractFixturePurpose, readonly ProfileFixtureId[]>

export function validateProfileContractFixtureMap(
  corpus: readonly ProfileFixtureCase[] = profileFixtureCorpus,
): string[] {
  const corpusIssues = validateProfileFixtureCorpus(corpus)
  const issues = corpusIssues.map((issue) => `fixture-corpus:${issue.code}`)
  const fixtureById = new Map(corpus.map((fixture) => [fixture.id, fixture] as const))
  for (const [purpose, fixtureIds] of Object.entries(PROFILE_CONTRACT_FIXTURE_MAP)) {
    for (const fixtureId of fixtureIds) {
      const fixture = fixtureById.get(fixtureId)
      if (!fixture) {
        issues.push(`${purpose}:missing:${fixtureId}`)
        continue
      }
      if (fixture.kind === 'scenario') {
        const data = fixture.data as { evidenceLevel?: unknown; platformEvidence?: unknown }
        if (data.evidenceLevel !== 'fixture-only') issues.push(`${purpose}:promoted:${fixtureId}`)
        if (fixtureId === 'macos-arm64-windows-x64-evidence-scenario') {
          const platformEvidence = Array.isArray(data.platformEvidence) ? data.platformEvidence : []
          if (corpusIssues.some((issue) => issue.code === 'missing-platform-evidence' && issue.caseId === fixtureId)) {
            issues.push(`${purpose}:missing-platform-evidence:${fixtureId}`)
          }
          if (platformEvidence.some((entry) => isRecord(entry) && entry.certified !== false)) {
            issues.push(`${purpose}:certified:${fixtureId}`)
          }
        }
      }
    }
  }
  return issues
}

export type ProfileContractAdapterUnderTest = {
  descriptor: ProfileAdapterDescriptor
  status(): Promise<ProfileServiceResult<ProfileStatus>>
  snapshot(): Promise<ProfileServiceResult<ProfileSnapshot>>
  applyCommandBatch(batch: ProfileCommandBatch): Promise<ProfileServiceResult<ProfileCommandBatchReceipt>>
  injectFault(point: 'before-commit'): void
  retryableWork(): ProfileCommandBatch[]
  inspectCandidate(candidate: unknown): ReturnType<typeof inspectProfileCompatibility>
  admitOperation(operation: string): ReturnType<typeof admitGatewayOperation>
  requestOwnership(request: ProfileOwnershipRequest): Promise<ProfileServiceResult<ProfileOwnershipReceipt>>
}

export type SyntheticProfileContractAdapter = ProfileContractAdapterUnderTest

export function createSyntheticProfileContractAdapter(): SyntheticProfileContractAdapter {
  const profile = cloneJson(ALPHA_PROFILE_V1)
  let injectedFault: 'before-commit' | null = null
  let pending: ProfileCommandBatch[] = []
  let mutableOwnerId: string | null = null
  const committedByIdempotencyKey = new Map<string, {
    batch: ProfileCommandBatch
    receipt: ProfileCommandBatchReceipt
  }>()
  return {
    descriptor: PROFILE_ADAPTER_CAPABILITY_REQUIREMENTS['fault-test'],
    async status() {
      return {
        ok: true,
        value: {
          profileId: 'profile-synthetic',
          revision: profile.revision,
          versions: PROFILE_CONTRACT_VERSIONS,
          state: mutableOwnerId === null ? 'ready' : 'busy',
          owner: mutableOwnerId === null
            ? { mode: 'none', route: 'none' }
            : { mode: 'mutable', route: 'exclusive-headless-owner' },
          dirty: pending.length === 0 ? 'clean' : 'pending',
          compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
        },
      }
    },
    async snapshot() {
      return {
        ok: true,
        value: snapshotFromFixture(profile),
      }
    },
    async applyCommandBatch(candidateBatch) {
      const validation = validateProfileCommandBatch(candidateBatch)
      if (!validation.ok) return validation
      const batch = validation.value
      const priorCommit = committedByIdempotencyKey.get(batch.idempotencyKey)
      if (priorCommit !== undefined) {
        if (JSON.stringify(priorCommit.batch) !== JSON.stringify(batch)) {
          return profileServiceFailure('invalid')
        }
        return { ok: true, value: { ...cloneJson(priorCommit.receipt), replayed: true } }
      }
      if (batch.expectedRevision !== profile.revision) {
        return profileServiceFailure('conflict', { currentRevision: profile.revision })
      }
      const candidate = cloneJson(profile)
      const command = batch.commands[0]
      if (batch.commands.length !== 1 || command?.name !== 'card.update-content') {
        return profileServiceFailure('invalid')
      }
      const ideaId = command.payload.ideaId
      const cardId = command.payload.cardId
      const blockId = command.payload.blockId
      const text = command.payload.text
      const expectedBatch = revisionEightCommandBatch()
      const expectedCommand = expectedBatch.commands[0]
      if (
        typeof ideaId !== 'string'
        || typeof cardId !== 'string'
        || typeof blockId !== 'string'
        || typeof text !== 'string'
        || command.id !== expectedCommand?.id
        || ideaId !== expectedCommand.payload.ideaId
        || cardId !== expectedCommand.payload.cardId
        || blockId !== expectedCommand.payload.blockId
        || text !== expectedCommand.payload.text
        || batch.actor.id !== expectedBatch.actor.id
        || batch.clientTxnId !== expectedBatch.clientTxnId
      ) {
        return profileServiceFailure('invalid')
      }
      const board = candidate.boards[ideaId]
      const card = board?.cards.find((entry) => entry.id === cardId)
      const block = card?.blocks.find((entry) => entry.id === blockId)
      if (!board || !card || !block) {
        return profileServiceFailure('not-found')
      }

      const committedAt = '2026-01-03T00:00:01.000Z'
      const commitId = command.id.replace(/^command-/, 'commit-')
      if (batch.dryRun) {
        return {
          ok: true,
          value: {
            previousRevision: profile.revision,
            revision: profile.revision,
            commitId: `dry-run-${commitId}`,
            commandIds: [command.id],
            affectedIds: [cardId],
            intentEvents: [],
            dryRun: true,
            replayed: false,
          },
        }
      }
      const committedProfile = cloneJson(ALPHA_PROFILE_V1_REVISION_8)
      const committedBoard = committedProfile.boards[ideaId]
      const event = committedBoard?.intentLog?.[(committedBoard.intentLog?.length ?? 0) - 1]
      if (event === undefined || event.at !== committedAt || event.commitId !== commitId) {
        return profileServiceFailure('internal', { currentRevision: profile.revision })
      }

      if (injectedFault === 'before-commit') {
        injectedFault = null
        pending = [cloneJson(batch)]
        return profileServiceFailure('internal', { currentRevision: profile.revision })
      }

      profile.revision = committedProfile.revision
      profile.activeIdeaId = committedProfile.activeIdeaId
      profile.ideas = committedProfile.ideas
      profile.boards = committedProfile.boards
      profile.source = committedProfile.source
      pending = pending.filter((entry) => entry.idempotencyKey !== batch.idempotencyKey)

      const receipt: ProfileCommandBatchReceipt = {
        previousRevision: batch.expectedRevision,
        revision: committedProfile.revision,
        commitId,
        commandIds: [command.id],
        affectedIds: [cardId],
        intentEvents: [event],
        dryRun: batch.dryRun,
        replayed: false,
      }
      committedByIdempotencyKey.set(batch.idempotencyKey, {
        batch: cloneJson(batch),
        receipt: cloneJson(receipt),
      })
      return {
        ok: true,
        value: receipt,
      }
    },
    injectFault(point) {
      injectedFault = point
    },
    retryableWork() {
      return cloneJson(pending)
    },
    inspectCandidate(candidate) {
      return inspectProfileCompatibility(candidate)
    },
    admitOperation(operation) {
      return admitGatewayOperation(operation)
    },
    async requestOwnership(request) {
      if (request.ownerId.length === 0) {
        return profileServiceFailure('invalid')
      }
      if (request.mode === 'mutable' && mutableOwnerId !== null && mutableOwnerId !== request.ownerId) {
        return profileServiceFailure('busy', { currentRevision: profile.revision })
      }
      const disposition = mutableOwnerId === request.ownerId ? 'already-owned' : 'acquired'
      if (request.mode === 'mutable') mutableOwnerId = request.ownerId
      return {
        ok: true,
        value: {
          ...request,
          revision: profile.revision,
          disposition,
        },
      }
    },
  }
}

export async function runProfileContractCases(
  createAdapter: () => ProfileContractAdapterUnderTest,
): Promise<ProfileContractCaseResult[]> {
  const adapter = createAdapter()
  const descriptorIsComplete = validateProfileAdapterDescriptor(adapter.descriptor).length === 0
  const adapterMethods = adapter as unknown as Record<string, unknown>
  const availableOperationsAreCallable = PROFILE_SERVICE_OPERATIONS.every((operation) => (
    adapter.descriptor.operations[operation] === 'unavailable'
    || typeof adapterMethods[PROFILE_SERVICE_OPERATION_METHODS[operation]] === 'function'
  ))
  const firstSnapshot = await adapter.snapshot()
  const secondSnapshot = await adapter.snapshot()
  const firstBoard = firstSnapshot.ok ? firstSnapshot.value.boards['idea-main'] : undefined
  const snapshotIsConsistent = firstSnapshot.ok
    && secondSnapshot.ok
    && firstSnapshot.value.revision === 7
    && firstSnapshot.value.activeIdeaId === 'idea-main'
    && firstSnapshot.value.ideas.some((idea) => idea.id === 'idea-main')
    && firstBoard?.cards.find((card) => card.id === 'card-note')?.blocks[0]?.text === 'Synthetic source note'
    && firstBoard.intentLog?.length === 2
    && JSON.stringify(secondSnapshot.value) === JSON.stringify(firstSnapshot.value)
  const atomicAdapter = createAdapter()
  const batch = revisionEightCommandBatch()
  const receipt = await atomicAdapter.applyCommandBatch(batch)
  const committedSnapshot = await atomicAdapter.snapshot()
  const actualBoard = committedSnapshot.ok ? committedSnapshot.value.boards[ALPHA_PROFILE_V1.activeIdeaId] : undefined
  const lastEvent = actualBoard?.intentLog?.[(actualBoard.intentLog?.length ?? 0) - 1]
  const atomicRevisionIsCoherent = receipt.ok
    && committedSnapshot.ok
    && receipt.value.previousRevision === 7
    && receipt.value.revision === 8
    && committedSnapshot.value.revision === 8
    && actualBoard?.cards.find((card) => card.id === 'card-note')?.blocks[0]?.text
      === 'Synthetic source note after pending edit'
    && lastEvent?.id === 'event-note-edited'
    && lastEvent?.at === '2026-01-03T00:00:01.000Z'
    && lastEvent?.type === 'card.content.edited'
    && lastEvent.data.field === 'body'
    && lastEvent.data.textLength === 40
    && lastEvent?.commitId === receipt.value.commitId
    && lastEvent?.actorId === batch.actor.id
    && lastEvent?.clientTxnId === batch.clientTxnId
    && lastEvent?.seq === 3
  const staleAdapter = createAdapter()
  const beforeStaleAttempt = await staleAdapter.snapshot()
  const staleReceipt = await staleAdapter.applyCommandBatch({ ...revisionEightCommandBatch(), expectedRevision: 6 })
  const afterStaleAttempt = await staleAdapter.snapshot()
  const staleRevisionPreservesState = beforeStaleAttempt.ok
    && !staleReceipt.ok
    && staleReceipt.code === 'conflict'
    && staleReceipt.currentRevision === 7
    && afterStaleAttempt.ok
    && JSON.stringify(afterStaleAttempt.value) === JSON.stringify(beforeStaleAttempt.value)
  const faultAdapter = createAdapter()
  const beforeFault = await faultAdapter.snapshot()
  faultAdapter.injectFault('before-commit')
  const failedReceipt = await faultAdapter.applyCommandBatch(revisionEightCommandBatch())
  const afterFault = await faultAdapter.snapshot()
  const retryableWork = faultAdapter.retryableWork()
  const precommitFailurePreservesRetry = beforeFault.ok
    && !failedReceipt.ok
    && failedReceipt.code === 'internal'
    && failedReceipt.retryable
    && failedReceipt.currentRevision === 7
    && afterFault.ok
    && JSON.stringify(afterFault.value) === JSON.stringify(beforeFault.value)
    && retryableWork.length === 1
    && retryableWork[0]?.idempotencyKey === revisionEightCommandBatch().idempotencyKey
  const retainedBatch = retryableWork[0]
  const retriedReceipt = retainedBatch === undefined
    ? undefined
    : await faultAdapter.applyCommandBatch(retainedBatch)
  const afterRetriedCommit = await faultAdapter.snapshot()
  const retryQueueAfterCommit = faultAdapter.retryableWork()
  const replayedRetainedReceipt = retainedBatch === undefined
    ? undefined
    : await faultAdapter.applyCommandBatch(retainedBatch)
  const retriedBoard = afterRetriedCommit.ok
    ? afterRetriedCommit.value.boards[ALPHA_PROFILE_V1.activeIdeaId]
    : undefined
  const retriedEvent = retriedBoard?.intentLog?.[(retriedBoard.intentLog?.length ?? 0) - 1]
  const retainedPrecommitBatchReappliesRevisionEight = retriedReceipt !== undefined
    && retriedReceipt.ok
    && retriedReceipt.value.previousRevision === 7
    && retriedReceipt.value.revision === 8
    && !retriedReceipt.value.replayed
    && afterRetriedCommit.ok
    && afterRetriedCommit.value.revision === 8
    && retriedBoard?.cards.find((card) => card.id === 'card-note')?.blocks[0]?.text
      === 'Synthetic source note after pending edit'
    && retriedEvent?.id === 'event-note-edited'
    && retriedEvent?.at === '2026-01-03T00:00:01.000Z'
    && retriedEvent?.type === 'card.content.edited'
    && retriedEvent.commitId === retriedReceipt.value.commitId
    && retriedEvent.actorId === retainedBatch?.actor.id
    && retriedEvent.clientTxnId === retainedBatch?.clientTxnId
    && retriedEvent.seq === 3
    && retryQueueAfterCommit.length === 0
    && replayedRetainedReceipt !== undefined
    && replayedRetainedReceipt.ok
    && replayedRetainedReceipt.value.replayed
    && replayedRetainedReceipt.value.revision === 8
    && replayedRetainedReceipt.value.commitId === retriedReceipt.value.commitId
  const futureAdapter = createAdapter()
  const beforeFutureInspection = await futureAdapter.snapshot()
  const futureProfile = futureProfileFixture()
  const futureResult = futureAdapter.inspectCandidate(futureProfile)
  const afterFutureInspection = await futureAdapter.snapshot()
  const futureSchemaIsRefused = beforeFutureInspection.ok
    && !futureResult.ok
    && futureResult.code === 'unsupported-future-version'
    && !futureResult.retryable
    && futureResult.supportedVersions === PROFILE_CONTRACT_VERSIONS
    && afterFutureInspection.ok
    && JSON.stringify(afterFutureInspection.value) === JSON.stringify(beforeFutureInspection.value)
  const gatewayAdapter = createAdapter()
  const gatewayFixtureOperations = gatewayOperationsFromFixture()
  const gatewayAdmissions = gatewayFixtureOperations.map((operation) => [operation, gatewayAdapter.admitOperation(operation)] as const)
  const forbiddenGatewayOperationsAreDenied = gatewayAdmissions.length === 4
    && gatewayAdmissions.every(([operation, result]) => {
      if (operation === 'card.create' || operation === 'connection.create') return result.ok
      return !result.ok && result.code === 'capability-denied' && !result.retryable
    })
  const ownershipAdapter = createAdapter()
  const beforeOwnershipStatus = await ownershipAdapter.status()
  const ownershipRequests = ownershipRequestsFromFixture()
  const acquired = ownershipRequests[0] === undefined
    ? undefined
    : await ownershipAdapter.requestOwnership(ownershipRequests[0])
  const afterAcquiredStatus = await ownershipAdapter.status()
  const firstBusy = ownershipRequests[1] === undefined
    ? undefined
    : await ownershipAdapter.requestOwnership(ownershipRequests[1])
  const secondBusy = ownershipRequests[1] === undefined
    ? undefined
    : await ownershipAdapter.requestOwnership(ownershipRequests[1])
  const afterBusyStatus = await ownershipAdapter.status()
  const afterOwnershipRequests = await ownershipAdapter.snapshot()
  const singleMutableOwnerHasStableBusy = acquired?.ok === true
    && acquired.value.disposition === 'acquired'
    && acquired.value.revision === 7
    && firstBusy?.ok === false
    && firstBusy.code === 'busy'
    && firstBusy.retryable
    && firstBusy.currentRevision === 7
    && JSON.stringify(secondBusy) === JSON.stringify(firstBusy)
    && afterOwnershipRequests.ok
    && afterOwnershipRequests.value.revision === 7
  const ownershipStatusExposesStableOwner = beforeOwnershipStatus.ok
    && beforeOwnershipStatus.value.state === 'ready'
    && beforeOwnershipStatus.value.owner.mode === 'none'
    && beforeOwnershipStatus.value.owner.route === 'none'
    && afterAcquiredStatus.ok
    && afterAcquiredStatus.value.state === 'busy'
    && afterAcquiredStatus.value.owner.mode === 'mutable'
    && afterAcquiredStatus.value.owner.route === 'exclusive-headless-owner'
    && afterAcquiredStatus.value.dirty === 'clean'
    && afterBusyStatus.ok
    && JSON.stringify(afterBusyStatus.value) === JSON.stringify(afterAcquiredStatus.value)
  const dryRunAdapter = createAdapter()
  const beforeDryRun = await dryRunAdapter.snapshot()
  const dryRunReceipt = await dryRunAdapter.applyCommandBatch({ ...revisionEightCommandBatch(), dryRun: true })
  const afterDryRun = await dryRunAdapter.snapshot()
  const dryRunPreservesRevision = beforeDryRun.ok
    && dryRunReceipt.ok
    && dryRunReceipt.value.previousRevision === 7
    && dryRunReceipt.value.revision === 7
    && dryRunReceipt.value.dryRun
    && dryRunReceipt.value.intentEvents.length === 0
    && afterDryRun.ok
    && JSON.stringify(afterDryRun.value) === JSON.stringify(beforeDryRun.value)
  const idempotencyAdapter = createAdapter()
  const idempotencyBatch = revisionEightCommandBatch()
  const firstIdempotentReceipt = await idempotencyAdapter.applyCommandBatch(idempotencyBatch)
  const replayedReceipt = await idempotencyAdapter.applyCommandBatch(idempotencyBatch)
  const afterIdempotentRetry = await idempotencyAdapter.snapshot()
  const idempotentRetryReplaysRevisionEight = firstIdempotentReceipt.ok
    && !firstIdempotentReceipt.value.replayed
    && replayedReceipt.ok
    && replayedReceipt.value.replayed
    && replayedReceipt.value.revision === 8
    && replayedReceipt.value.commitId === firstIdempotentReceipt.value.commitId
    && afterIdempotentRetry.ok
    && afterIdempotentRetry.value.revision === 8
    && afterIdempotentRetry.value.boards[ALPHA_PROFILE_V1.activeIdeaId]?.intentLog?.length
      === 3
  const mismatchAdapter = createAdapter()
  const beforeMismatch = await mismatchAdapter.snapshot()
  const mismatchBatch = revisionEightCommandBatch()
  const mismatchedReceipt = await mismatchAdapter.applyCommandBatch({
    ...mismatchBatch,
    commands: [{
      ...mismatchBatch.commands[0],
      payload: { ...mismatchBatch.commands[0].payload, text: 'A mismatched command must not echo the fixture' },
    }],
  })
  const afterMismatch = await mismatchAdapter.snapshot()
  const mismatchedVectorPreservesRevisionSeven = beforeMismatch.ok
    && !mismatchedReceipt.ok
    && mismatchedReceipt.code === 'invalid'
    && afterMismatch.ok
    && afterMismatch.value.revision === 7
    && JSON.stringify(afterMismatch.value) === JSON.stringify(beforeMismatch.value)

  return [
    { id: 'versions-and-capabilities', ok: descriptorIsComplete },
    { id: 'available-operations-are-callable', ok: availableOperationsAreCallable },
    { id: 'consistent-revision-7-snapshot', ok: snapshotIsConsistent },
    { id: 'atomic-attributed-revision-8', ok: atomicRevisionIsCoherent },
    { id: 'stale-revision-preserves-7', ok: staleRevisionPreservesState },
    { id: 'precommit-failure-preserves-7-and-retry', ok: precommitFailurePreservesRetry },
    { id: 'retained-precommit-batch-reapplies-revision-8', ok: retainedPrecommitBatchReappliesRevisionEight },
    { id: 'future-schema-is-refused', ok: futureSchemaIsRefused },
    { id: 'forbidden-gateway-operations-are-denied', ok: forbiddenGatewayOperationsAreDenied },
    { id: 'single-mutable-owner-stable-busy', ok: singleMutableOwnerHasStableBusy },
    { id: 'ownership-status-exposes-stable-owner', ok: ownershipStatusExposesStableOwner },
    { id: 'dry-run-preserves-revision', ok: dryRunPreservesRevision },
    { id: 'idempotent-retry-replays-revision-8', ok: idempotentRetryReplaysRevisionEight },
    { id: 'mismatched-vector-preserves-revision-7', ok: mismatchedVectorPreservesRevisionSeven },
  ]
}

function revisionEightCommandBatch(): ProfileCommandBatch {
  return {
    version: PROFILE_CONTRACT_VERSIONS.command,
    schemaVersion: PROFILE_CONTRACT_VERSIONS.schema,
    expectedRevision: 7,
    actor: { id: 'actor-synthetic', kind: 'agent', transport: 'test' },
    clientTxnId: 'txn-synthetic-3',
    idempotencyKey: 'idempotency-synthetic-3',
    dryRun: false,
    commands: [
      {
        version: PROFILE_CONTRACT_VERSIONS.command,
        id: 'command-synthetic-3',
        name: 'card.update-content',
        payload: {
          ideaId: 'idea-main',
          cardId: 'card-note',
          blockId: 'block-note',
          text: 'Synthetic source note after pending edit',
        },
      },
    ],
  }
}

function futureProfileFixture(): unknown {
  const fixture = profileFixtureCorpus.find((entry) => entry.id === 'unsupported-future-profile')
  const data = fixture?.data as { profile?: unknown } | undefined
  return data?.profile
}

function gatewayOperationsFromFixture(): string[] {
  const fixture = profileFixtureCorpus.find((entry) => entry.id === 'agent-gateway-allow-deny-scenario')
  const data = fixture?.data as { requests?: Array<{ command?: { type?: unknown } }> } | undefined
  return (data?.requests ?? []).flatMap((request) => typeof request.command?.type === 'string' ? [request.command.type] : [])
}

function ownershipRequestsFromFixture(): ProfileOwnershipRequest[] {
  const fixture = profileFixtureCorpus.find((entry) => entry.id === 'busy-lock-scenario')
  const data = fixture?.data as { requests?: Array<{ ownerId?: unknown; mode?: unknown }> } | undefined
  return (data?.requests ?? []).flatMap((request) => (
    typeof request.ownerId === 'string' && (request.mode === 'mutable' || request.mode === 'read-only')
      ? [{ ownerId: request.ownerId, mode: request.mode, route: 'exclusive-headless-owner' as const }]
      : []
  ))
}

function snapshotFromFixture(profile: AlphaProfileV1): ProfileSnapshot {
  return {
    profileId: 'profile-synthetic',
    revision: profile.revision,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: profile.activeIdeaId,
    ideas: cloneJson(profile.ideas),
    boards: cloneJson(profile.boards),
    modTemplates: [],
    modInstances: [],
    profileSettings: [],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
}

function cloneJson<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
