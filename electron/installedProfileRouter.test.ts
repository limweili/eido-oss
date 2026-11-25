import { describe, expect, it } from 'vitest'
import {
  createProfileCapabilities,
  PROFILE_CONTRACT_VERSIONS,
  profileServiceFailure,
  type ProfileServiceResult,
  type ProfileSnapshot,
} from '../src/persistence/profileServiceContract'
import {
  PROFILE_BRIDGE_VERSION,
  type ProfileBridgeOperation,
  type ProfileBridgeOperationPayloads,
  type ProfileBridgeRequest,
  type RendererProfileProjection,
} from './profileBridgeContract'
import {
  createInstalledProfileRouter,
  MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY,
  type InstalledProfileRouter,
} from './installedProfileRouter'
import type {
  ProfileUtilityClient,
  ProfileUtilityExit,
  ProfileUtilityTerminalLoss,
} from './profileUtilityClient'
import type {
  ProfileUtilityOperation,
  ProfileUtilityReadyMessage,
} from './profileUtilityProtocol'

type RecordedCall = Readonly<{
  operation: ProfileUtilityOperation
  payload: Readonly<Record<string, unknown>>
}>

type UtilityHandler = (
  operation: ProfileUtilityOperation,
  payload: Readonly<Record<string, unknown>>,
) => Promise<ProfileServiceResult<unknown>>

describe('installed Profile router', () => {
  it('withdraws new Agent admission reversibly during update preflight', async () => {
    const router = await createInstalledProfileRouter({
      client: fakeClient(async (operation, payload) => {
        if (operation === 'hydrate') return ok(profileSnapshot(4))
        if (operation === 'confirm-revision') {
          return ok({ revision: payload.expectedRevision as number, durable: true, dirty: false })
        }
        throw new Error(`Unexpected operation ${operation}`)
      }, readyAt(4)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const resume = await router.pauseAgentAdmission()
    expect(router.openAgentService({ client: 'codex', sessionId: 'paused' })).toMatchObject({
      ok: false,
      code: 'busy',
    })

    resume()
    expect(router.openAgentService({ client: 'codex', sessionId: 'resumed' })).toMatchObject({
      ok: true,
    })
  })

  it('injects trusted context without turning renderer state into Profile authority', async () => {
    const calls: RecordedCall[] = []
    const invoke: UtilityHandler = async (operation, payload) => {
      calls.push({ operation, payload })
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(3, 'profile-native', 'en-AU'))
        case 'commit-gui-projection': {
          return ok({
            revision: 4,
            generation: payload.generation as number,
            authorizationIds: [],
          })
        }
        case 'confirm-revision':
          return ok({ revision: 4, durable: true, dirty: false })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(3)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'gui-client-1',
        idempotencyKey: 'gui-idempotency-1',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const projection = projectionAt('idea-main')
    const rendererRequest = bridgeRequest('commit-gui-projection', { projection })

    const response = await router.route(rendererRequest)

    expect(response).toEqual({
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'renderer-1',
      operation: 'commit-gui-projection',
      ok: true,
      value: { generation: 1, revision: 4, durable: true, dirty: false },
    })
    const internalCommit = calls.find((call) => call.operation === 'commit-gui-projection')
    expect(internalCommit?.payload).toEqual({
      generation: 1,
      expectedRevision: 3,
      clientTxnId: 'gui-client-1',
      idempotencyKey: 'gui-idempotency-1',
      committedAt: '2026-07-18T00:00:00.000Z',
      context: { trustedActorId: 'desktop-owner', ordinaryNewIdeas: [] },
      rendererProjection: projection,
    })
    expect(internalCommit?.payload.rendererProjection).not.toHaveProperty('profileId')
    expect(internalCommit?.payload.rendererProjection).not.toHaveProperty('profileSettings')
    expect(rendererRequest.payload.projection).not.toHaveProperty('profileId')
    expect(rendererRequest.payload.projection).not.toHaveProperty('profileSettings')
  })

  it('keeps ordinary-create authorization in main and consumes it on the matching GUI commit', async () => {
    const calls: RecordedCall[] = []
    let revision = 8
    let commitNumber = 0
    const invoke: UtilityHandler = async (operation, payload) => {
      calls.push({ operation, payload })
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(revision))
        case 'confirm-revision':
          return ok({ revision, durable: true, dirty: false })
        case 'authorize-ordinary-idea-create':
          return ok({
            authorizationId: 'native-authorization-secret',
            profileId: 'profile-default',
            baseRevision: revision,
            ideaId: 'idea-new',
            boardId: 'board:idea-new',
            createdAt: '2026-07-18T00:00:00.000Z',
            expiresAt: '2026-07-18T00:05:00.000Z',
          })
        case 'commit-gui-projection': {
          revision += 1
          commitNumber += 1
          return ok({
            revision,
            generation: payload.generation as number,
            authorizationIds: commitNumber === 1 ? ['native-authorization-secret'] : [],
          })
        }
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const identities = ['a', 'b'][Symbol.iterator]()
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(revision)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => {
        const suffix = identities.next().value as string
        return {
          clientTxnId: `gui-client-${suffix}`,
          idempotencyKey: `gui-idempotency-${suffix}`,
          committedAt: `2026-07-18T00:0${commitNumber}:30.000Z`,
        }
      },
    })

    const createResponse = await router.route(bridgeRequest(
      'create-ordinary-idea',
      { ideaId: 'idea-new' },
      'renderer-create',
    ))
    expect(createResponse).toEqual({
      version: PROFILE_BRIDGE_VERSION,
      requestId: 'renderer-create',
      operation: 'create-ordinary-idea',
      ok: true,
      value: {
        ideaId: 'idea-new',
        authorized: true,
        createdAt: '2026-07-18T00:00:00.000Z',
      },
    })
    expect(JSON.stringify(createResponse)).not.toContain('native-authorization-secret')

    const projection = projectionAt('idea-new', [ideaSummary('idea-new')])
    await router.route(bridgeRequest('commit-gui-projection', { projection }, 'renderer-commit-1'))
    await router.route(bridgeRequest('commit-gui-projection', { projection }, 'renderer-commit-2'))

    const commits = calls.filter((call) => call.operation === 'commit-gui-projection')
    expect((commits[0]?.payload as {
      context: { trustedActorId: string; ordinaryNewIdeas: unknown[] }
    }).context).toEqual({
      trustedActorId: 'desktop-owner',
      ordinaryNewIdeas: [{
        authorizationId: 'native-authorization-secret',
        profileId: 'profile-default',
        baseRevision: 8,
        ideaId: 'idea-new',
        boardId: 'board:idea-new',
        createdAt: '2026-07-18T00:00:00.000Z',
        expiresAt: '2026-07-18T00:05:00.000Z',
      }],
    })
    expect((commits[1]?.payload as {
      context: { ordinaryNewIdeas: unknown[] }
    }).context.ordinaryNewIdeas).toEqual([])
  })

  // Creating an Idea replaces the GUI save scheduler. The renderer treats the
  // native generation as a session-monotonic counter and fails closed when it
  // rewinds, so a Board that already saved this session must not be able to
  // push the renderer into that terminal state by creating a new Idea.
  it('keeps native GUI generations rising when an ordinary create replaces the scheduler', async () => {
    let revision = 8
    let identityNumber = 0
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(revision))
        case 'confirm-revision':
          return ok({ revision, durable: true, dirty: false })
        case 'authorize-ordinary-idea-create':
          return ok({
            authorizationId: `native-authorization-${revision}`,
            profileId: 'profile-default',
            baseRevision: revision,
            ideaId: payload.ideaId as string,
            boardId: `board:${payload.ideaId as string}`,
            createdAt: '2026-07-18T00:00:00.000Z',
            expiresAt: '2026-07-18T00:05:00.000Z',
          })
        case 'commit-gui-projection': {
          revision += 1
          return ok({
            revision,
            generation: payload.generation as number,
            authorizationIds: (payload.context as {
              ordinaryNewIdeas: readonly { authorizationId: string }[]
            }).ordinaryNewIdeas.map((authorization) => authorization.authorizationId),
          })
        }
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(revision)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => {
        identityNumber += 1
        return {
          clientTxnId: `gui-client-${identityNumber}`,
          idempotencyKey: `gui-idempotency-${identityNumber}`,
          committedAt: `2026-07-18T00:0${identityNumber}:30.000Z`,
        }
      },
    })

    const existingBoardSave = await router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-main', [ideaSummary('idea-main')]) },
      'renderer-commit-existing',
    ))
    await router.route(bridgeRequest(
      'create-ordinary-idea',
      { ideaId: 'idea-new' },
      'renderer-create',
    ))
    const newIdeaSave = await router.route(bridgeRequest(
      'commit-gui-projection',
      {
        projection: projectionAt('idea-new', [ideaSummary('idea-main'), ideaSummary('idea-new')]),
      },
      'renderer-commit-new',
    ))
    const afterCreateFlush = await router.route(bridgeRequest('flush', {}, 'renderer-flush'))

    const generationOf = (response: unknown): number => {
      expect(response).toMatchObject({ ok: true })
      return (response as { value: { generation: number } }).value.generation
    }
    expect(generationOf(newIdeaSave)).toBeGreaterThan(generationOf(existingBoardSave))
    expect(generationOf(afterCreateFlush)).toBeGreaterThanOrEqual(generationOf(newIdeaSave))
  })

  it('serializes concurrent renderer commits through exact per-generation confirmation', async () => {
    const calls: string[] = []
    const firstCommit = deferred<ProfileServiceResult<unknown>>()
    const firstEntered = deferred<void>()
    let commits = 0
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(0))
        case 'commit-gui-projection': {
          commits += 1
          const request = payload as {
            generation: number
            rendererProjection: { activeIdeaId: string }
          }
          calls.push(`commit:${request.generation}:${request.rendererProjection.activeIdeaId}`)
          if (commits === 1) {
            firstEntered.resolve()
            return firstCommit.promise
          }
          return ok({ revision: 2, generation: request.generation, authorizationIds: [] })
        }
        case 'confirm-revision': {
          const expectedRevision = payload.expectedRevision as number
          calls.push(`confirm:${expectedRevision}`)
          return ok({ revision: expectedRevision, durable: true, dirty: false })
        }
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    let identity = 0
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(0)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => {
        identity += 1
        return {
          clientTxnId: `client-${identity}`,
          idempotencyKey: `idempotency-${identity}`,
          committedAt: `2026-07-18T00:00:0${identity}.000Z`,
        }
      },
    })

    const firstResponse = router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-first') },
      'renderer-first',
    ))
    await firstEntered.promise
    const secondResponse = router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-latest') },
      'renderer-latest',
    ))
    await Promise.resolve()
    firstCommit.resolve(ok({ revision: 1, generation: 1, authorizationIds: [] }))

    await expect(firstResponse).resolves.toMatchObject({
      ok: true,
      requestId: 'renderer-first',
      value: { generation: 1, revision: 1 },
    })
    await expect(secondResponse).resolves.toMatchObject({
      ok: true,
      requestId: 'renderer-latest',
      value: { generation: 2, revision: 2 },
    })
    expect(calls).toEqual([
      'commit:1:idea-first',
      'confirm:1',
      'commit:2:idea-latest',
      'confirm:2',
    ])
  })

  it('retries one uncertain GUI submit with the exact retained identity', async () => {
    const commits: Readonly<Record<string, unknown>>[] = []
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(0))
        case 'commit-gui-projection':
          commits.push(payload)
          if (commits.length === 1) {
            throw new Error('Synthetic uncertain transport outcome')
          }
          return ok({
            revision: 1,
            generation: payload.generation as number,
            authorizationIds: [],
          })
        case 'confirm-revision':
          return ok({ revision: 1, durable: true, dirty: false })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(0)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'retained-client',
        idempotencyKey: 'retained-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-main') },
      'retry-uncertain',
    ))).resolves.toMatchObject({ ok: true, value: { revision: 1 } })
    expect(commits).toHaveLength(2)
    expect(commits[1]).toEqual(commits[0])
  })

  it('promotes a GUI conflict into the hydration guard and recovers after exact ack', async () => {
    let revision = 3
    let commits = 0
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(revision))
        case 'commit-gui-projection':
          commits += 1
          if (commits === 1) {
            revision = 4
            return profileServiceFailure('conflict', { currentRevision: revision })
          }
          expect(payload.expectedRevision).toBe(4)
          revision = 5
          return ok({
            revision,
            generation: payload.generation as number,
            authorizationIds: [],
          })
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(revision)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: `conflict-client-${commits}`,
        idempotencyKey: `conflict-idempotency-${commits}`,
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-main') },
      'conflicted-commit',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'conflict', currentRevision: 4 },
    })
    await hydrateAndAcknowledge(router, 'after-conflict')
    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-main') },
      'rebased-after-conflict',
    ))).resolves.toMatchObject({ ok: true, value: { revision: 5 } })
  })

  it('serializes lifecycle mutation and clears its projection guard only on the exact hydration ack', async () => {
    const order: string[] = []
    const firstCommit = deferred<ProfileServiceResult<unknown>>()
    const firstEntered = deferred<void>()
    let revision = 0
    let hydration = 0
    let commits = 0
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          hydration += 1
          order.push(`hydrate:${revision}`)
          return ok(profileSnapshot(
            revision,
            'profile-before',
            hydration === 1 ? 'en-AU' : 'fr-FR',
            revision >= 2 ? 'idea-copy' : 'idea-main',
          ))
        case 'commit-gui-projection': {
          commits += 1
          const request = payload as {
            generation: number
            expectedRevision: number
            rendererProjection: RendererProfileProjection
          }
          order.push(`commit:${request.expectedRevision}`)
          if (commits === 1) {
            firstEntered.resolve()
            return firstCommit.promise
          }
          expect(request).toMatchObject({
            expectedRevision: 2,
            rendererProjection: { activeIdeaId: 'idea-copy' },
          })
          expect(request.rendererProjection).not.toHaveProperty('profileId')
          expect(request.rendererProjection).not.toHaveProperty('profileSettings')
          revision = 3
          return ok({ revision, generation: request.generation, authorizationIds: [] })
        }
        case 'confirm-revision': {
          const expected = payload.expectedRevision as number
          order.push(`confirm:${expected}`)
          return ok({ revision: expected, durable: true, dirty: false })
        }
        case 'duplicate-idea':
          order.push('duplicate')
          revision = 2
          return ok({
            kind: 'duplicate-idea',
            operationId: 'duplicate-1',
            previousRevision: 1,
            revision,
            targetIdeaId: 'idea-copy',
            insertedRecordIds: ['idea-copy'],
            importedAssetIds: [],
            replayed: false,
          })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    let identity = 0
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(revision)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => {
        identity += 1
        return {
          clientTxnId: `client-${identity}`,
          idempotencyKey: `idempotency-${identity}`,
          committedAt: `2026-07-18T00:00:0${identity}.000Z`,
        }
      },
    })
    const guiCommit = router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-main') },
      'renderer-gui',
    ))
    await firstEntered.promise
    const duplicate = router.route(bridgeRequest('duplicate-idea', {
      request: {
        version: 1,
        operationId: 'duplicate-1',
        idempotencyKey: 'duplicate-idempotency-1',
        expectedRevision: 1,
        sourceIdeaId: 'idea-main',
      },
    }, 'renderer-duplicate'))
    await Promise.resolve()
    expect(order).toEqual(['hydrate:0', 'commit:0'])

    revision = 1
    firstCommit.resolve(ok({ revision, generation: 1, authorizationIds: [] }))
    await expect(guiCommit).resolves.toMatchObject({ ok: true, value: { revision: 1 } })
    await expect(duplicate).resolves.toMatchObject({
      ok: true,
      value: { kind: 'duplicate-idea', revision: 2 },
    })

    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-copy') },
      'renderer-stale-after-lifecycle',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'conflict', currentRevision: 2 },
    })
    expect(order).toEqual([
      'hydrate:0',
      'commit:0',
      'confirm:1',
      'duplicate',
    ])

    const hydrationResponse = await router.route(bridgeRequest(
      'hydrate',
      {},
      'renderer-rehydrate-after-lifecycle',
    ))
    expect(hydrationResponse).toMatchObject({
      ok: true,
      value: {
        intentActorId: 'desktop-owner',
        snapshot: { revision: 2 },
        acknowledgement: { epoch: 'hydration-epoch-1', revision: 2 },
      },
    })
    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-copy') },
      'renderer-between-hydrate-and-ack',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'conflict', currentRevision: 2 },
    })
    await expect(router.route(bridgeRequest(
      'ack-hydration',
      { epoch: 'hydration-epoch-1', revision: 2 },
      'renderer-ack-after-lifecycle',
    ))).resolves.toMatchObject({
      ok: true,
      value: { acknowledged: true, epoch: 'hydration-epoch-1', revision: 2 },
    })
    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-copy') },
      'renderer-after-rehydrate',
    ))).resolves.toMatchObject({ ok: true, value: { revision: 3 } })
    expect(order).toEqual([
      'hydrate:0',
      'commit:0',
      'confirm:1',
      'duplicate',
      'hydrate:2',
      'commit:2',
      'confirm:3',
    ])
  })

  it('forwards an exact native lifecycle replay after later revisions without rewriting it', async () => {
    const duplicateRequests: unknown[] = []
    let revision = 1
    let duplicateCalls = 0
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(
            revision,
            'profile-default',
            'en-AU',
            revision >= 2 ? 'idea-copy' : 'idea-main',
          ))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'duplicate-idea':
          duplicateCalls += 1
          duplicateRequests.push(payload.request)
          if (duplicateCalls === 1) revision = 2
          return ok({
            kind: 'duplicate-idea',
            operationId: 'duplicate-replay',
            previousRevision: 1,
            revision: 2,
            targetIdeaId: 'idea-copy',
            insertedRecordIds: ['idea-copy'],
            importedAssetIds: [],
            replayed: duplicateCalls > 1,
          })
        case 'commit-gui-projection':
          revision += 1
          return ok({
            revision,
            generation: payload.generation as number,
            authorizationIds: [],
          })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(revision)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: `client-${revision}`,
        idempotencyKey: `idempotency-${revision}`,
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const exactRequest = Object.freeze({
      version: 1 as const,
      operationId: 'duplicate-replay',
      idempotencyKey: 'duplicate-replay-key',
      expectedRevision: 1,
      sourceIdeaId: 'idea-main',
    })

    await expect(router.route(bridgeRequest(
      'duplicate-idea',
      { request: exactRequest },
      'duplicate-first',
    ))).resolves.toMatchObject({ ok: true, value: { replayed: false, revision: 2 } })
    await hydrateAndAcknowledge(router, 'after-first')
    await router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-copy') },
      'commit-after-first',
    ))
    expect(revision).toBe(3)

    await expect(router.route(bridgeRequest(
      'duplicate-idea',
      { request: exactRequest },
      'duplicate-replay',
    ))).resolves.toMatchObject({ ok: true, value: { replayed: true, revision: 2 } })
    expect(duplicateRequests).toEqual([exactRequest, exactRequest])

    await hydrateAndAcknowledge(router, 'after-replay')
    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-copy') },
      'commit-after-replay',
    ))).resolves.toMatchObject({ ok: true, value: { revision: 4 } })
  })

  it('preserves an issued hydration acknowledgement across an exact guarded replay', async () => {
    let revision = 1
    let firstOperationCalls = 0
    const expectedRevisions: number[] = []
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(
            revision,
            'profile-default',
            'en-AU',
            revision >= 2 ? 'idea-copy-1' : 'idea-main',
          ))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'duplicate-idea': {
          const request = payload.request as {
            operationId: string
            expectedRevision: number
          }
          expectedRevisions.push(request.expectedRevision)
          if (request.operationId === 'before-ack-first') {
            firstOperationCalls += 1
            if (firstOperationCalls === 1) revision = 2
            return ok({
              kind: 'duplicate-idea',
              operationId: request.operationId,
              previousRevision: 1,
              revision: 2,
              targetIdeaId: 'idea-copy-1',
              insertedRecordIds: ['idea-copy-1'],
              importedAssetIds: [],
              replayed: firstOperationCalls > 1,
            })
          }
          revision = 3
          return ok({
            kind: 'duplicate-idea',
            operationId: request.operationId,
            previousRevision: 2,
            revision,
            targetIdeaId: 'idea-copy-2',
            insertedRecordIds: ['idea-copy-2'],
            importedAssetIds: [],
            replayed: false,
          })
        }
        case 'commit-gui-projection':
          expect(payload.expectedRevision).toBe(2)
          revision = 3
          return ok({
            revision,
            generation: payload.generation as number,
            authorizationIds: [],
          })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(revision)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: `client-${revision}`,
        idempotencyKey: `idempotency-${revision}`,
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const firstRequest = Object.freeze({
      version: 1 as const,
      operationId: 'before-ack-first',
      idempotencyKey: 'before-ack-first-key',
      expectedRevision: 1,
      sourceIdeaId: 'idea-main',
    })
    const secondRequest = Object.freeze({
      version: 1 as const,
      operationId: 'before-ack-second',
      idempotencyKey: 'before-ack-second-key',
      expectedRevision: 2,
      sourceIdeaId: 'idea-main',
    })

    await expect(router.route(bridgeRequest(
      'duplicate-idea',
      { request: firstRequest },
      'before-ack-first',
    ))).resolves.toMatchObject({ ok: true, value: { replayed: false, revision: 2 } })
    const hydration = await router.route(bridgeRequest(
      'hydrate',
      {},
      'hydrate-before-delayed-replay',
    ))
    if (!hydration.ok || hydration.operation !== 'hydrate') {
      throw new Error('Expected hydration before delayed replay to succeed')
    }
    const acknowledgement = hydration.value.acknowledgement
    await expect(router.route(bridgeRequest(
      'duplicate-idea',
      { request: firstRequest },
      'delayed-exact-replay',
    ))).resolves.toMatchObject({ ok: true, value: { replayed: true, revision: 2 } })
    await expect(router.route(bridgeRequest(
      'duplicate-idea',
      { request: secondRequest },
      'before-ack-second',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'conflict', currentRevision: 2 },
    })
    expect(expectedRevisions).toEqual([1, 1])

    await expect(router.route(bridgeRequest(
      'ack-hydration',
      acknowledgement,
      'ack-after-delayed-replay',
    ))).resolves.toMatchObject({
      ok: true,
      value: { acknowledged: true, ...acknowledgement },
    })
    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-copy-1') },
      'commit-after-delayed-replay',
    ))).resolves.toMatchObject({ ok: true, value: { revision: 3 } })
  })

  it('terminalizes a scalar-mismatched authorization before later utility work', async () => {
    let revision = 2
    const calls: string[] = []
    const invoke: UtilityHandler = async (operation, payload) => {
      calls.push(operation)
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(revision))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'authorize-ordinary-idea-create':
          return ok({
            authorizationId: 'wrong-idea-authorization',
            profileId: 'profile-default',
            baseRevision: revision,
            ideaId: 'different-idea',
            boardId: 'board:different-idea',
            createdAt: '2026-07-18T00:00:00.000Z',
            expiresAt: '2026-07-18T00:05:00.000Z',
          })
        case 'duplicate-idea':
          revision = 3
          return ok({
            kind: 'duplicate-idea',
            operationId: 'different-operation',
            previousRevision: 2,
            revision,
            targetIdeaId: 'idea-copy',
            insertedRecordIds: ['idea-copy'],
            importedAssetIds: [],
            replayed: false,
          })
        case 'export-portable':
          return ok({
            operationId: 'different-export',
            profileId: 'profile-default',
            revision: 99,
            integrityRoot: 'integrity-root',
            entryCount: 1,
            verified: true,
          })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(revision)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      choosePortableExportPath: async () => 'C:\\proof\\export.eido',
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    await expect(router.route(bridgeRequest(
      'create-ordinary-idea',
      { ideaId: 'requested-idea' },
      'mismatched-authorization',
    ))).resolves.toMatchObject({ ok: false, error: { code: 'internal' } })
    await expect(router.route(bridgeRequest('duplicate-idea', {
      request: {
        version: 1,
        operationId: 'requested-operation',
        idempotencyKey: 'requested-operation-key',
        expectedRevision: 2,
        sourceIdeaId: 'idea-main',
      },
    }, 'mismatched-lifecycle'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    await expect(router.route(bridgeRequest('export-portable', {
      request: { version: 1, operationId: 'requested-export', expectedRevision: 2 },
    }, 'mismatched-export'))).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    expect(calls).toEqual(['hydrate', 'confirm-revision', 'authorize-ordinary-idea-create'])
  })

  it.each([
    {
      label: 'export',
      operation: 'export-portable' as const,
      request: bridgeRequest('export-portable', {
        request: { version: 1, operationId: 'export-profile-mismatch', expectedRevision: 4 },
      }, 'export-profile-mismatch'),
      value: {
        operationId: 'export-profile-mismatch',
        profileId: 'different-profile',
        revision: 4,
        integrityRoot: 'integrity-root',
        entryCount: 1,
        verified: true,
      },
    },
    {
      label: 'query',
      operation: 'query' as const,
      request: bridgeRequest('query', {
        request: { recordIds: ['card-1'], limit: 1, byteLimit: 4_096 },
      }, 'query-profile-mismatch'),
      value: {
        profileId: 'different-profile',
        revision: 4,
        items: [],
        truncated: false,
      },
    },
    {
      label: 'status',
      operation: 'status' as const,
      request: bridgeRequest('status', {}, 'status-profile-mismatch'),
      value: { ...readyStatus(4), profileId: 'different-profile' },
    },
    {
      label: 'capabilities',
      operation: 'capabilities' as const,
      request: bridgeRequest('capabilities', {}, 'capabilities-adapter-mismatch'),
      value: { ...createProfileCapabilities('sqlite'), adapter: 'fault-test' },
    },
  ])('terminalizes a successful $label result with impossible authority evidence', async ({
    operation,
    request,
    value,
  }) => {
    const calls: string[] = []
    const router = await createInstalledProfileRouter({
      client: fakeClient(async (calledOperation, payload) => {
        calls.push(calledOperation)
        if (calledOperation === 'hydrate') return ok(profileSnapshot(4))
        if (calledOperation === 'confirm-revision') {
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        }
        if (calledOperation === operation) return ok(value)
        throw new Error(`Unexpected operation ${calledOperation}`)
      }, readyAt(4)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      choosePortableExportPath: async () => 'C:\\proof\\export.eido',
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    await expect(router.route(request)).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    await expect(router.route(bridgeRequest('status', {}, `after-${operation}-mismatch`)))
      .resolves.toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(calls).toEqual(['hydrate', 'confirm-revision', operation])
  })

  it('fails closed when the host repeats a still-pending hydration epoch', async () => {
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(2))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(2)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: () => 'repeated-hydration-epoch',
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    await expect(router.route(bridgeRequest(
      'hydrate',
      {},
      'first-hydration',
    ))).resolves.toMatchObject({
      ok: true,
      value: {
        acknowledgement: { epoch: 'repeated-hydration-epoch', revision: 2 },
      },
    })
    await expect(router.route(bridgeRequest(
      'hydrate',
      {},
      'repeated-epoch-hydration',
    ))).resolves.toMatchObject({ ok: false, error: { code: 'internal' } })
    await expect(router.route(bridgeRequest(
      'ack-hydration',
      { epoch: 'repeated-hydration-epoch', revision: 2 },
      'stale-ack-after-repeat',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-main') },
      'commit-after-repeat',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
  })

  it('stops admission before flushing the latest GUI generation and closing the utility', async () => {
    const order: string[] = []
    const commitResult = deferred<ProfileServiceResult<unknown>>()
    const commitEntered = deferred<void>()
    const closeEntered = deferred<void>()
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(5))
        case 'commit-gui-projection':
          order.push('commit')
          commitEntered.resolve()
          return commitResult.promise
        case 'confirm-revision':
          order.push(`confirm:${String(payload.expectedRevision)}`)
          return ok({ revision: 6, durable: true, dirty: false })
        case 'close':
          order.push('close')
          closeEntered.resolve()
          return ok({ closed: true })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const controlled = controllableFakeClient(invoke, readyAt(5))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'client-shutdown',
        idempotencyKey: 'idempotency-shutdown',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const commit = router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-main') },
      'renderer-before-shutdown',
    ))
    await commitEntered.promise
    const shutdown = router.shutdown({ nativeGeneration: 1, revision: 6 })
    await expect(router.shutdown({ nativeGeneration: 0, revision: 6 })).rejects.toThrow(
      'checkpoint changed',
    )
    const denied = await router.route(bridgeRequest('status', {}, 'renderer-too-late'))
    expect(denied).toMatchObject({
      ok: false,
      operation: 'status',
      error: { code: 'busy' },
    })
    expect(order).toEqual(['commit'])

    commitResult.resolve(ok({ revision: 6, generation: 1, authorizationIds: [] }))
    await expect(commit).resolves.toMatchObject({ ok: true, value: { revision: 6 } })
    await closeEntered.promise
    let shutdownComplete = false
    void shutdown.then(() => { shutdownComplete = true })
    await Promise.resolve()
    expect(shutdownComplete).toBe(false)
    controlled.exit(0)
    await expect(shutdown).resolves.toEqual({ state: 'flushed', generation: 1, revision: 6 })
    expect(order).toEqual(['commit', 'confirm:6', 'close'])
  })

  it('routes Agent spatial reads through the active owner at one flushed revision', async () => {
    const calls: RecordedCall[] = []
    const router = await createInstalledProfileRouter({
      client: fakeClient(async (operation, payload) => {
        calls.push({ operation, payload })
        switch (operation) {
          case 'hydrate':
            return ok(profileSnapshot(4))
          case 'confirm-revision':
            return ok({ revision: payload.expectedRevision as number, durable: true, dirty: false })
          case 'agent-card-neighbors':
            return ok({
              profileId: 'profile-default',
              revision: 4,
              ideaId: 'idea-main',
              card: {
                cardId: 'card-anchor',
                deepLink: 'eido://app/?idea=idea-main&card=card-anchor',
              },
              items: [],
              truncated: false,
            })
          case 'agent-card-set-bounds':
            return ok({
              profileId: 'profile-default',
              revision: 4,
              ideaId: 'idea-main',
              cards: [{
                cardId: 'card-anchor',
                deepLink: 'eido://app/?idea=idea-main&card=card-anchor',
              }],
              bounds: { x: 10, y: 20, width: 260, height: 180 },
            })
          case 'inspect-result':
            return ok({
              profileId: 'profile-default',
              revision: 4,
              ideaId: 'idea-main',
              resultCardId: 'card-result',
              items: [],
              truncated: false,
            })
          default:
            throw new Error(`Unexpected operation ${operation}`)
        }
      }, readyAt(4)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const opened = router.openAgentService({ client: 'codex', sessionId: 'spatial-session' })
    if (!opened.ok
      || !opened.value.agentCardNeighbors
      || !opened.value.agentCardSetBounds
      || !opened.value.inspectResult) throw new Error('Expected Agent read service')

    await expect(opened.value.agentCardNeighbors({
      ideaId: 'idea-main',
      card: 'card-anchor',
      limit: 1,
      byteLimit: 4_096,
    })).resolves.toMatchObject({ ok: true, value: { revision: 4, items: [] } })
    await expect(opened.value.agentCardSetBounds({
      ideaId: 'idea-main',
      cards: ['card-anchor'],
    })).resolves.toMatchObject({ ok: true, value: { revision: 4 } })
    await expect(opened.value.inspectResult({
      ideaId: 'idea-main',
      resultCardId: 'card-result',
      limit: 2,
      byteLimit: 4_096,
    })).resolves.toMatchObject({
      ok: true,
      value: { revision: 4, ideaId: 'idea-main', resultCardId: 'card-result' },
    })
    expect(calls.map(({ operation }) => operation)).toEqual([
      'hydrate',
      'confirm-revision',
      'agent-card-neighbors',
      'agent-card-set-bounds',
      'inspect-result',
    ])
    await opened.value.close()
  })

  it('preserves a durable Agent receipt and withdraws all admission after barrier exhaustion', async () => {
    const order: string[] = []
    const notifiedRevisions: number[] = []
    const barrierFailures: Error[] = []
    const commandRequest = {
      version: 1 as const,
      schemaVersion: 1 as const,
      expectedRevision: 4,
      idempotencyKey: 'live-command-1',
      dryRun: false,
      commands: [{
        version: 1 as const,
        id: 'live-card-create',
        name: 'card.create' as const,
        payload: {
          ideaId: 'idea-main',
          kind: 'note' as const,
          position: { x: 20, y: 40 },
          text: 'Created live',
        },
      }],
    }
    const receipt = {
      kind: 'agent-command-batch' as const,
      version: 2 as const,
      previousRevision: 4,
      revision: 5,
      proposedRevision: 5,
      commitId: 'commit-live-1',
      commandResults: [{
        commandId: 'live-card-create',
        name: 'card.create' as const,
        cardId: 'card-live',
        blockId: 'block-live',
      }],
      effects: { inserted: 2, updated: 0, deleted: 0, intentEvents: 0, profileAgentEvents: 1 },
      intentEventIds: [],
      profileAgentEventIds: ['agent-event-live-1'],
      dryRun: false,
      replayed: false,
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(async (operation, payload) => {
        order.push(operation)
        switch (operation) {
          case 'hydrate':
            return ok(profileSnapshot(operation === 'hydrate' && order.length > 3 ? 5 : 4))
          case 'confirm-revision':
            return ok({ revision: payload.expectedRevision as number, durable: true, dirty: false })
          case 'apply-agent-command-batch':
            expect(payload).toEqual({
              request: commandRequest,
              transport: 'cli',
              actor: { client: 'codex', sessionId: 'live-session-1' },
            })
            return ok(receipt)
          default:
            throw new Error(`Unexpected operation ${operation}`)
        }
      }, readyAt(4)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      async acquireRendererAgentMutationBarrier() {
        return {
          checkpoint: { generation: 0, nativeGeneration: 0, revision: 4 },
          async sealForTerminalDrain() { return { generation: 0, nativeGeneration: 0, revision: 4 } },
          async complete(revision) {
            notifiedRevisions.push(revision)
            throw new Error('synthetic renderer loss after durable commit')
          },
          async cancel() {},
        }
      },
      onRendererAgentMutationBarrierFailure(error) {
        barrierFailures.push(error)
      },
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const opened = router.openAgentService({ client: 'codex', sessionId: 'live-session-1' })
    if (!opened.ok) throw new Error(opened.message)
    const applyAgentCommandBatch = opened.value.applyAgentCommandBatch
    if (!applyAgentCommandBatch) throw new Error('Expected installed command capability')

    await expect(applyAgentCommandBatch(commandRequest)).resolves.toEqual({
      ok: true,
      value: receipt,
    })
    expect(order).toEqual(['hydrate', 'confirm-revision', 'apply-agent-command-batch'])
    expect(notifiedRevisions).toEqual([5])
    expect(barrierFailures).toHaveLength(1)
    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-main') },
      'stale-renderer-after-agent',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'busy' },
    })
    await expect(applyAgentCommandBatch({
      ...commandRequest,
      idempotencyKey: 'blocked-after-barrier-exhaustion',
    })).resolves.toMatchObject({ ok: false, code: 'busy' })
    expect(order).toEqual(['hydrate', 'confirm-revision', 'apply-agent-command-batch'])
    await opened.value.close()
  })

  it('serializes two live clients before renderer hold acquisition and cancels dry-run holds', async () => {
    const firstCancelEntered = deferred<void>()
    const releaseFirstCancel = deferred<void>()
    const acquisitions: string[] = []
    let acquisitionCount = 0
    let applied = 0
    let barrierFailures = 0
    const request = {
      version: 1 as const,
      schemaVersion: 1 as const,
      expectedRevision: 4,
      idempotencyKey: 'live-dry-run',
      dryRun: true,
      commands: [{
        version: 1 as const,
        id: 'live-dry-card',
        name: 'card.create' as const,
        payload: {
          ideaId: 'idea-main',
          kind: 'note' as const,
          position: { x: 1, y: 2 },
          text: 'Dry run',
        },
      }],
    }
    const dryRunReceipt = {
      kind: 'agent-command-batch' as const,
      version: 2 as const,
      previousRevision: 4,
      revision: 4,
      proposedRevision: 5,
      commitId: null,
      commandResults: [{
        commandId: 'live-dry-card',
        name: 'card.create' as const,
        cardId: 'card-dry',
        blockId: 'block-dry',
      }],
      effects: { inserted: 2, updated: 0, deleted: 0, intentEvents: 0, profileAgentEvents: 1 },
      intentEventIds: [],
      profileAgentEventIds: ['event-dry'],
      dryRun: true,
      replayed: false,
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(async (operation, payload) => {
        switch (operation) {
          case 'hydrate': return ok(profileSnapshot(4))
          case 'confirm-revision':
            return ok({ revision: payload.expectedRevision as number, durable: true, dirty: false })
          case 'apply-agent-command-batch':
            applied += 1
            return ok(dryRunReceipt)
          default: throw new Error(`Unexpected operation ${operation}`)
        }
      }, readyAt(4)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      async acquireRendererAgentMutationBarrier() {
        acquisitionCount += 1
        const ordinal = acquisitionCount
        acquisitions.push(`acquire:${ordinal}`)
        return {
          checkpoint: { generation: 0, nativeGeneration: 0, revision: 4 },
          async sealForTerminalDrain() { return { generation: 0, nativeGeneration: 0, revision: 4 } },
          async complete() { throw new Error('dry run cannot complete authority') },
          async cancel() {
            acquisitions.push(`cancel:${ordinal}`)
            if (ordinal === 1) {
              firstCancelEntered.resolve()
              await releaseFirstCancel.promise
            }
          },
        }
      },
      onRendererAgentMutationBarrierFailure() { barrierFailures += 1 },
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const first = router.openAgentService({ client: 'codex', sessionId: 'one' })
    const second = router.openAgentService({ client: 'codex', sessionId: 'two' })
    if (!first.ok || !second.ok) throw new Error('Expected two live services')

    const firstResult = first.value.applyAgentCommandBatch!(request)
    await firstCancelEntered.promise
    let pauseResolved = false
    const pausing = router.pauseAgentAdmission().then((resume) => {
      pauseResolved = true
      return resume
    })
    const blockedWhileJoining = second.value.applyAgentCommandBatch!({
      ...request,
      idempotencyKey: 'live-dry-run-two',
    })
    await Promise.resolve()
    expect(pauseResolved).toBe(false)
    await expect(blockedWhileJoining).resolves.toMatchObject({ ok: false, code: 'busy' })
    expect(router.openAgentService({ client: 'codex', sessionId: 'paused' })).toMatchObject({
      ok: false,
      code: 'busy',
    })
    expect(acquisitions).toEqual(['acquire:1', 'cancel:1'])
    expect(applied).toBe(1)

    releaseFirstCancel.resolve()
    await expect(firstResult).resolves.toEqual({ ok: true, value: dryRunReceipt })
    const resume = await pausing
    await expect(second.value.applyAgentCommandBatch!({
      ...request,
      idempotencyKey: 'still-paused',
    })).resolves.toMatchObject({ ok: false, code: 'busy' })
    resume()
    await expect(second.value.applyAgentCommandBatch!({
      ...request,
      idempotencyKey: 'live-dry-run-two',
    })).resolves.toEqual({ ok: true, value: dryRunReceipt })
    expect(acquisitions).toEqual(['acquire:1', 'cancel:1', 'acquire:2', 'cancel:2'])
    expect(applied).toBe(2)
    expect(barrierFailures).toBe(0)
  })

  it('never cancels the old renderer base after utility mutation dispatch becomes ambiguous', async () => {
    const barriers: string[] = []
    const failures: Error[] = []
    const request = {
      version: 1 as const,
      schemaVersion: 1 as const,
      expectedRevision: 4,
      idempotencyKey: 'ambiguous-live-command',
      dryRun: false,
      commands: [{
        version: 1 as const,
        id: 'ambiguous-card',
        name: 'card.create' as const,
        payload: {
          ideaId: 'idea-main',
          kind: 'note' as const,
          position: { x: 1, y: 2 },
          text: 'Ambiguous',
        },
      }],
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(async (operation, payload) => {
        if (operation === 'hydrate') return ok(profileSnapshot(4))
        if (operation === 'confirm-revision') {
          return ok({ revision: payload.expectedRevision as number, durable: true, dirty: false })
        }
        if (operation === 'apply-agent-command-batch') {
          throw new Error('utility connection lost after request dispatch')
        }
        throw new Error(`Unexpected operation ${operation}`)
      }, readyAt(4)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      async acquireRendererAgentMutationBarrier() {
        barriers.push('begin')
        return {
          checkpoint: { generation: 0, nativeGeneration: 0, revision: 4 },
          async sealForTerminalDrain() { return { generation: 0, nativeGeneration: 0, revision: 4 } },
          async complete() { barriers.push('complete') },
          async cancel() { barriers.push('cancel') },
        }
      },
      onRendererAgentMutationBarrierFailure(error) {
        failures.push(error)
      },
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const opened = router.openAgentService({ client: 'codex', sessionId: 'ambiguous' })
    if (!opened.ok) throw new Error(opened.message)

    await expect(opened.value.applyAgentCommandBatch!(request)).rejects.toThrow(
      'utility connection lost after request dispatch',
    )
    expect(barriers).toEqual(['begin'])
    expect(failures).toHaveLength(1)
    await expect(opened.value.applyAgentCommandBatch!({
      ...request,
      idempotencyKey: 'must-not-run-after-ambiguity',
    })).resolves.toMatchObject({ ok: false, code: 'busy' })
  })

  it.each([
    'internal',
    'corrupt-or-recovery-required',
  ] as const)('keeps the renderer held when utility resolves an uncertain %s apply outcome', async (failureCode) => {
    const barriers: string[] = []
    const failures: Error[] = []
    const request = {
      version: 1 as const,
      schemaVersion: 1 as const,
      expectedRevision: 4,
      idempotencyKey: 'resolved-ambiguous-live-command',
      dryRun: false,
      commands: [{
        version: 1 as const,
        id: 'resolved-ambiguous-card',
        name: 'card.create' as const,
        payload: {
          ideaId: 'idea-main',
          kind: 'note' as const,
          position: { x: 1, y: 2 },
          text: 'Resolved ambiguous',
        },
      }],
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(async (operation, payload) => {
        if (operation === 'hydrate') return ok(profileSnapshot(4))
        if (operation === 'confirm-revision') {
          return ok({ revision: payload.expectedRevision as number, durable: true, dirty: false })
        }
        if (operation === 'apply-agent-command-batch') {
          return profileServiceFailure(failureCode)
        }
        throw new Error(`Unexpected operation ${operation}`)
      }, readyAt(4)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      async acquireRendererAgentMutationBarrier() {
        barriers.push('begin')
        return {
          checkpoint: { generation: 0, nativeGeneration: 0, revision: 4 },
          async sealForTerminalDrain() { return { generation: 0, nativeGeneration: 0, revision: 4 } },
          async complete() { barriers.push('complete') },
          async cancel() { barriers.push('cancel') },
        }
      },
      onRendererAgentMutationBarrierFailure(error) {
        failures.push(error)
      },
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const opened = router.openAgentService({ client: 'codex', sessionId: 'resolved-ambiguous' })
    if (!opened.ok) throw new Error(opened.message)

    await expect(opened.value.applyAgentCommandBatch!(request)).resolves.toMatchObject({
      ok: false,
      code: failureCode,
    })
    expect(barriers).toEqual(['begin'])
    expect(failures).toHaveLength(1)
    await expect(opened.value.applyAgentCommandBatch!({
      ...request,
      idempotencyKey: 'must-not-run-after-resolved-ambiguity',
    })).resolves.toMatchObject({ ok: false, code: 'busy' })
  })

  it('drains an accepted renderer barrier cycle before shutdown closes native authority', async () => {
    const cancelEntered = deferred<void>()
    const releaseCancel = deferred<void>()
    const closeEntered = deferred<void>()
    const dryRunReceipt = {
      kind: 'agent-command-batch' as const,
      version: 2 as const,
      previousRevision: 4,
      revision: 4,
      proposedRevision: 5,
      commitId: null,
      commandResults: [],
      effects: { inserted: 0, updated: 0, deleted: 0, intentEvents: 0, profileAgentEvents: 1 },
      intentEventIds: [],
      profileAgentEventIds: ['shutdown-dry-run'],
      dryRun: true,
      replayed: false,
    }
    const controlled = controllableFakeClient(async (operation, payload) => {
      if (operation === 'hydrate') return ok(profileSnapshot(4))
      if (operation === 'confirm-revision') {
        return ok({ revision: payload.expectedRevision as number, durable: true, dirty: false })
      }
      if (operation === 'apply-agent-command-batch') return ok(dryRunReceipt)
      if (operation === 'close') {
        closeEntered.resolve()
        return ok({ closed: true })
      }
      throw new Error(`Unexpected operation ${operation}`)
    }, readyAt(4))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      async acquireRendererAgentMutationBarrier() {
        return {
          checkpoint: { generation: 0, nativeGeneration: 0, revision: 4 },
          async sealForTerminalDrain() { return { generation: 0, nativeGeneration: 0, revision: 4 } },
          async complete() { throw new Error('dry run cannot complete') },
          async cancel() {
            cancelEntered.resolve()
            await releaseCancel.promise
          },
        }
      },
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const opened = router.openAgentService({ client: 'codex', sessionId: 'shutdown-barrier' })
    if (!opened.ok) throw new Error(opened.message)
    const request = {
      version: 1 as const,
      schemaVersion: 1 as const,
      expectedRevision: 4,
      idempotencyKey: 'shutdown-barrier-dry-run',
      dryRun: true,
      commands: [] as const,
    }
    const accepted = opened.value.applyAgentCommandBatch!(request)
    await cancelEntered.promise
    const shutdown = router.shutdown({ nativeGeneration: 0, revision: 4 })
    await expect(opened.value.applyAgentCommandBatch!({
      ...request,
      idempotencyKey: 'late-after-shutdown',
    })).resolves.toMatchObject({ ok: false, code: 'busy' })
    let closed = false
    void closeEntered.promise.then(() => { closed = true })
    await Promise.resolve()
    expect(closed).toBe(false)

    releaseCancel.resolve()
    await expect(accepted).resolves.toEqual({ ok: true, value: dryRunReceipt })
    await closeEntered.promise
    controlled.exit(0)
    await expect(shutdown).resolves.toEqual({ state: 'flushed', generation: 0, revision: 4 })
  })

  it('drains accepted live Agent work and denies late work when shutdown starts', async () => {
    const statusEntered = deferred<void>()
    const statusResult = deferred<ProfileServiceResult<unknown>>()
    const closeEntered = deferred<void>()
    const controlled = controllableFakeClient(async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(3))
        case 'confirm-revision':
          return ok({ revision: payload.expectedRevision as number, durable: true, dirty: false })
        case 'status':
          statusEntered.resolve()
          return statusResult.promise
        case 'close':
          closeEntered.resolve()
          return ok({ closed: true })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }, readyAt(3))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const opened = router.openAgentService({ client: 'codex', sessionId: 'live-session-2' })
    if (!opened.ok) throw new Error(opened.message)
    const accepted = opened.value.status()
    await statusEntered.promise
    const shutdown = router.shutdown({ nativeGeneration: 0, revision: 3 })

    await expect(opened.value.status()).resolves.toMatchObject({ ok: false, code: 'busy' })
    statusResult.resolve(ok(readyStatus(3)))
    await expect(accepted).resolves.toMatchObject({ ok: true, value: { revision: 3 } })
    await closeEntered.promise
    controlled.exit(0)
    await expect(shutdown).resolves.toEqual({ state: 'flushed', generation: 0, revision: 3 })
  })

  it('rejects shutdown when a correlated close is followed by a nonzero exit', async () => {
    const closeEntered = deferred<void>()
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(1))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'close':
          closeEntered.resolve()
          return ok({ closed: true })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const controlled = controllableFakeClient(invoke, readyAt(1))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const shutdown = router.shutdown({ nativeGeneration: 0, revision: 1 })
    await closeEntered.promise
    controlled.exit(17)

    await expect(shutdown).rejects.toThrow('cleanly')
  })

  it('keeps an explicit utility close failure terminal even when termination joins', async () => {
    const closeEntered = deferred<void>()
    const closeFailure = profileServiceFailure('internal')
    const controlled = controllableFakeClient(async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(1))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'close':
          closeEntered.resolve()
          return closeFailure
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }, readyAt(1))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const shutdown = router.shutdown({ nativeGeneration: 0, revision: 1 })
    await closeEntered.promise
    await controlled.terminateRequested
    controlled.exit(0)

    await expect(shutdown).rejects.toThrow(closeFailure.message)
  })

  it('returns the flushed receipt when close acknowledgement times out but termination joins', async () => {
    const closeEntered = deferred<void>()
    const closeResult = deferred<ProfileServiceResult<unknown>>()
    const controlled = controllableFakeClient(async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(1))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'close':
          closeEntered.resolve()
          return closeResult.promise
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }, readyAt(1))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      utilityExitTimeoutMs: 5,
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const shutdown = router.shutdown(
      { nativeGeneration: 0, revision: 1 },
      MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY,
    )
    await closeEntered.promise
    await controlled.terminateRequested
    controlled.exit(0)

    await expect(shutdown).resolves.toEqual({ state: 'flushed', generation: 0, revision: 1 })
  })

  it.each([
    'ordinary quit',
    'Windows update-equivalent drain',
  ])('keeps close acknowledgement timeout fail-closed for %s without the macOS update capability', async () => {
    const closeEntered = deferred<void>()
    const closeResult = deferred<ProfileServiceResult<unknown>>()
    const controlled = controllableFakeClient(async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(1))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'close':
          closeEntered.resolve()
          return closeResult.promise
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }, readyAt(1))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      utilityExitTimeoutMs: 5,
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const shutdown = router.shutdown({ nativeGeneration: 0, revision: 1 })
    await closeEntered.promise
    await controlled.terminateRequested
    controlled.exit(0)

    await expect(shutdown).rejects.toThrow('close acknowledgement timed out')
  })

  it('keeps a recovery-only close timeout fail-closed despite the macOS update capability', async () => {
    const closeEntered = deferred<void>()
    const closeResult = deferred<ProfileServiceResult<unknown>>()
    const controlled = controllableFakeClient(async (operation) => {
      if (operation === 'close') {
        closeEntered.resolve()
        return closeResult.promise
      }
      throw new Error(`Unexpected operation ${operation}`)
    }, {
      version: 1,
      kind: 'ready',
      route: 'active-owner',
      state: 'recovery-required',
      currentRevision: 4,
    })
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      utilityExitTimeoutMs: 5,
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const shutdown = router.shutdown(undefined, MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY)
    await closeEntered.promise
    await controlled.terminateRequested
    controlled.exit(0)

    await expect(shutdown).rejects.toThrow('close acknowledgement timed out')
  })

  it.each([
    { label: 'nonzero', exitCode: 17, signal: null },
    { label: 'signal', exitCode: 0, signal: 'SIGTERM' },
    { label: 'unknown', exitCode: null, signal: null },
  ])('keeps a $label forced exit terminal after close-ack timeout', async ({ exitCode, signal }) => {
    const closeEntered = deferred<void>()
    const closeResult = deferred<ProfileServiceResult<unknown>>()
    const controlled = controllableFakeClient(async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(1))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'close':
          closeEntered.resolve()
          return closeResult.promise
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }, readyAt(1))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      utilityExitTimeoutMs: 5,
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const shutdown = router.shutdown(
      { nativeGeneration: 0, revision: 1 },
      MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY,
    )
    await closeEntered.promise
    await controlled.terminateRequested
    controlled.exit(exitCode, signal)

    await expect(shutdown).rejects.toThrow('did not exit cleanly')
  })

  it.each([
    { label: 'nonzero', exitCode: 17, signal: null },
    { label: 'signal', exitCode: 0, signal: 'SIGTERM' },
    { label: 'unknown', exitCode: null, signal: null },
  ])('keeps a $label forced exit terminal after clean-exit timeout', async ({ exitCode, signal }) => {
    const closeEntered = deferred<void>()
    const controlled = controllableFakeClient(async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(1))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'close':
          closeEntered.resolve()
          return ok({ closed: true })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }, readyAt(1))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      utilityExitTimeoutMs: 5,
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const shutdown = router.shutdown(
      { nativeGeneration: 0, revision: 1 },
      MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY,
    )
    await closeEntered.promise
    await controlled.terminateRequested
    controlled.exit(exitCode, signal)

    await expect(shutdown).rejects.toThrow('did not exit cleanly')
  })

  it('returns the flushed receipt when close is acknowledged and bounded termination joins', async () => {
    const closeEntered = deferred<void>()
    const invoke: UtilityHandler = async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(1))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'close':
          closeEntered.resolve()
          return ok({ closed: true })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const controlled = controllableFakeClient(invoke, readyAt(1))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      utilityExitTimeoutMs: 5,
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const shutdown = router.shutdown(
      { nativeGeneration: 0, revision: 1 },
      MACOS_UPDATE_PROFILE_SHUTDOWN_CAPABILITY,
    )
    await closeEntered.promise
    await controlled.terminateRequested
    controlled.exit(0)

    await expect(shutdown).resolves.toEqual({ state: 'flushed', generation: 0, revision: 1 })
  })

  it('rejects shutdown when close and bounded forced termination cannot join', async () => {
    const closeEntered = deferred<void>()
    const controlled = controllableFakeClient(async (operation, payload) => {
      switch (operation) {
        case 'hydrate':
          return ok(profileSnapshot(1))
        case 'confirm-revision':
          return ok({
            revision: payload.expectedRevision as number,
            durable: true,
            dirty: false,
          })
        case 'close':
          closeEntered.resolve()
          return ok({ closed: true })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }, readyAt(1))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      utilityExitTimeoutMs: 5,
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const shutdown = router.shutdown({ nativeGeneration: 0, revision: 1 })
    await closeEntered.promise

    await expect(shutdown).rejects.toThrow('forced termination join timed out')
  })

  it('returns a recovery-only shutdown receipt when no renderer checkpoint exists', async () => {
    const closeEntered = deferred<void>()
    const controlled = controllableFakeClient(async (operation) => {
      if (operation === 'close') {
        closeEntered.resolve()
        return ok({ closed: true })
      }
      throw new Error(`Unexpected operation ${operation}`)
    }, {
      version: 1,
      kind: 'ready',
      route: 'active-owner',
      state: 'recovery-required',
      currentRevision: 4,
    })
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const shutdown = router.shutdown()
    await closeEntered.promise
    controlled.exit(0)

    await expect(shutdown).resolves.toEqual({ state: 'recovery-only', revision: 4 })
  })

  it('makes an unexpected route exception terminal before returning internal', async () => {
    const calls: string[] = []
    const controlled = controllableFakeClient(async (operation, payload) => {
      calls.push(operation)
      if (operation === 'hydrate') return ok(profileSnapshot(1))
      if (operation === 'confirm-revision') {
        return ok({
          revision: payload.expectedRevision as number,
          durable: true,
          dirty: false,
        })
      }
      throw new Error(`Unexpected operation ${operation}`)
    }, readyAt(1))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      choosePortableExportPath: async () => {
        throw new Error('native chooser failed')
      },
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })
    const failedRoute = router.route(bridgeRequest('export-portable', {
      request: { version: 1, operationId: 'export-throw', expectedRevision: 1 },
    }, 'export-throw'))
    await controlled.terminateRequested
    controlled.exit(0)

    await expect(failedRoute).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    await expect(router.route(bridgeRequest('status', {}, 'after-route-throw'))).resolves
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(calls).toEqual(['hydrate', 'confirm-revision'])
  })

  it('admits only recovery inspection and restore until recovery rehydrates healthy authority', async () => {
    const order: string[] = []
    const invoke: UtilityHandler = async (operation, payload) => {
      order.push(operation)
      switch (operation) {
        case 'inspect-recovery':
          return ok({
            mode: 'inspect',
            currentRevision: 4,
            selectedCandidateId: 'candidate-5',
            candidates: [{
              id: 'candidate-5',
              recordVersion: 1,
              revision: 4,
              verified: true,
              createdAt: '2026-07-18T00:00:00.000Z',
            }],
            rejectedCandidateIds: ['candidate-bad'],
            quarantinedCurrentState: false,
          })
        case 'restore-recovery':
          expect(payload).toEqual({ candidateId: 'candidate-5' })
          return ok({
            mode: 'restore',
            selectedCandidateId: 'candidate-5',
            rejectedCandidateIds: ['candidate-bad'],
            quarantinedCurrentState: true,
            previousRevision: 4,
            revision: 5,
          })
        case 'hydrate':
          return ok(profileSnapshot(5))
        case 'confirm-revision':
          return ok({ revision: 5, durable: true, dirty: false })
        case 'status':
          return ok(readyStatus(5))
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, {
        version: 1,
        kind: 'ready',
        route: 'active-owner',
        state: 'recovery-required',
        currentRevision: 4,
      } as ProfileUtilityReadyMessage),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    await expect(router.route(bridgeRequest('status', {}, 'status-before-recovery'))).resolves
      .toMatchObject({ ok: false, error: { code: 'corrupt-or-recovery-required' } })
    expect(order).toEqual([])

    await expect(router.route(bridgeRequest('inspect-recovery', {}, 'inspect'))).resolves
      .toMatchObject({
        ok: true,
        value: {
          mode: 'inspect',
          currentRevision: 4,
          selectedCandidateId: 'candidate-5',
          rejectedCandidateIds: ['candidate-bad'],
          quarantinedCurrentState: false,
        },
      })
    await expect(router.route(bridgeRequest('restore-recovery', {
      candidateId: 'candidate-5',
    }, 'restore'))).resolves.toMatchObject({
      ok: true,
      value: {
        mode: 'restore',
        previousRevision: 4,
        revision: 5,
        quarantinedCurrentState: true,
      },
    })
    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-main') },
      'stale-projection-after-restore',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'conflict', currentRevision: 5 },
    })
    await hydrateAndAcknowledge(router, 'after-restore')
    await expect(router.route(bridgeRequest('status', {}, 'status-after-recovery'))).resolves
      .toMatchObject({ ok: true, value: { revision: 5, state: 'ready' } })
    expect(order).toEqual([
      'inspect-recovery',
      'restore-recovery',
      'hydrate',
      'confirm-revision',
      'status',
    ])
  })

  it('admits start-fresh in recovery mode and rehydrates the fresh Profile', async () => {
    const order: string[] = []
    const invoke: UtilityHandler = async (operation, payload) => {
      order.push(operation)
      switch (operation) {
        case 'start-fresh':
          expect(payload).toEqual({})
          return ok({
            mode: 'start-fresh',
            operationId: 'start-fresh-1',
            previousRevision: 4,
            profileId: 'profile-fresh',
            revision: 0,
            quarantinedCurrentState: true,
          })
        case 'hydrate':
          return ok(profileSnapshot(0, 'profile-fresh'))
        case 'confirm-revision':
          return ok({ revision: 0, durable: true, dirty: false })
        case 'status':
          return ok({ ...readyStatus(0), profileId: 'profile-fresh' })
        default:
          throw new Error(`Unexpected operation ${operation}`)
      }
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, {
        version: 1,
        kind: 'ready',
        route: 'active-owner',
        state: 'recovery-required',
        currentRevision: 4,
      } as ProfileUtilityReadyMessage),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    await expect(router.route(bridgeRequest('start-fresh', {}, 'start-fresh'))).resolves
      .toMatchObject({
        ok: true,
        value: {
          mode: 'start-fresh',
          operationId: 'start-fresh-1',
          previousRevision: 4,
          profileId: 'profile-fresh',
          revision: 0,
          quarantinedCurrentState: true,
        },
      })
    await expect(router.route(bridgeRequest(
      'commit-gui-projection',
      { projection: projectionAt('idea-main') },
      'stale-projection-after-start-fresh',
    ))).resolves.toMatchObject({
      ok: false,
      error: { code: 'conflict', currentRevision: 0 },
    })
    await hydrateAndAcknowledge(router, 'after-start-fresh')
    await expect(router.route(bridgeRequest('status', {}, 'status-after-start-fresh'))).resolves
      .toMatchObject({ ok: true, value: { revision: 0, state: 'ready' } })
    expect(order).toEqual(['start-fresh', 'hydrate', 'confirm-revision', 'status'])
  })

  it('treats an uncorrelated start-fresh receipt as protocol corruption', async () => {
    const controlled = controllableFakeClient(async (operation) => {
      if (operation === 'start-fresh') {
        return ok({
          mode: 'start-fresh',
          operationId: 'start-fresh-wrong',
          previousRevision: 3,
          profileId: 'profile-fresh',
          revision: 0,
          quarantinedCurrentState: true,
        })
      }
      throw new Error(`Unexpected operation ${operation}`)
    }, {
      version: 1,
      kind: 'ready',
      route: 'active-owner',
      state: 'recovery-required',
      currentRevision: 4,
    } as ProfileUtilityReadyMessage)
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    const failedRoute = router.route(bridgeRequest('start-fresh', {}, 'start-fresh-mismatch'))
    await controlled.terminateRequested
    controlled.exit(0)

    await expect(failedRoute).resolves.toMatchObject({
      ok: false,
      error: { code: 'internal' },
    })
    await expect(router.route(bridgeRequest('status', {}, 'after-corrupt-receipt'))).resolves
      .toMatchObject({ ok: false, error: { code: 'internal' } })
  })

  it('rejects start-fresh while the Profile route is healthy', async () => {
    const calls: string[] = []
    const invoke: UtilityHandler = async (operation) => {
      calls.push(operation)
      if (operation === 'hydrate') return ok(profileSnapshot(1))
      if (operation === 'confirm-revision') return ok({ revision: 1, durable: true, dirty: false })
      throw new Error(`Unexpected operation ${operation}`)
    }
    const router = await createInstalledProfileRouter({
      client: fakeClient(invoke, readyAt(1)),
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    await expect(router.route(bridgeRequest('start-fresh', {}, 'healthy-start-fresh'))).resolves
      .toMatchObject({ ok: false, error: { code: 'invalid' } })
    expect(calls).toEqual(['hydrate'])
  })

  it('stops all renderer admission after terminal utility loss', async () => {
    const calls: string[] = []
    const controlled = controllableFakeClient(async (operation) => {
      calls.push(operation)
      if (operation === 'hydrate') return ok(profileSnapshot(1))
      throw new Error(`Unexpected operation ${operation}`)
    }, readyAt(1))
    const router = await createInstalledProfileRouter({
      client: controlled.client,
      trustedActorId: 'desktop-owner',
      createHydrationEpoch: createSequentialHydrationEpoch(),
      createIdentity: () => ({
        clientTxnId: 'unused-client',
        idempotencyKey: 'unused-idempotency',
        committedAt: '2026-07-18T00:00:00.000Z',
      }),
    })

    controlled.lose(new Error('utility exited'))

    await expect(router.route(bridgeRequest('status', {}, 'after-terminal-loss'))).resolves
      .toMatchObject({ ok: false, error: { code: 'internal' } })
    expect(calls).toEqual(['hydrate'])
  })
})

async function hydrateAndAcknowledge(
  router: InstalledProfileRouter,
  requestSuffix: string,
): Promise<void> {
  const hydration = await router.route(bridgeRequest(
    'hydrate',
    {},
    `hydrate-${requestSuffix}`,
  ))
  if (!hydration.ok || hydration.operation !== 'hydrate') {
    throw new Error('Expected renderer hydration to succeed')
  }
  const acknowledgement = hydration.value.acknowledgement
  await expect(router.route(bridgeRequest(
    'ack-hydration',
    acknowledgement,
    `ack-${requestSuffix}`,
  ))).resolves.toMatchObject({
    ok: true,
    value: { acknowledged: true, ...acknowledgement },
  })
}

function createSequentialHydrationEpoch(): () => string {
  let sequence = 0
  return () => {
    sequence += 1
    return `hydration-epoch-${sequence}`
  }
}

function fakeClient(
  handler: UtilityHandler,
  ready: ProfileUtilityReadyMessage,
): ProfileUtilityClient {
  const controlled = controllableFakeClient(handler, ready)
  controlled.exit(0)
  return controlled.client
}

function controllableFakeClient(
  handler: UtilityHandler,
  ready: ProfileUtilityReadyMessage,
): Readonly<{
  client: ProfileUtilityClient
  lose(error: Error): void
  exit(code: number | null, signal?: string | null): void
  terminateRequested: Promise<void>
}> {
  const terminalListeners = new Set<(loss: ProfileUtilityTerminalLoss) => void>()
  const exited = deferred<ProfileUtilityExit>()
  const terminateRequested = deferred<void>()
  const client: ProfileUtilityClient = Object.freeze({
    ready: async () => ready,
    request: (async (operation, payload) => {
      const result = await handler(operation, payload)
      if (operation !== 'commit-gui-projection' || !result.ok) return result
      return ok(completeGuiCommitReceipt(
        payload,
        result.value as Readonly<Record<string, unknown>>,
      ))
    }) as ProfileUtilityClient['request'],
    onTerminalLoss(listener: (loss: ProfileUtilityTerminalLoss) => void) {
      terminalListeners.add(listener)
      return () => terminalListeners.delete(listener)
    },
    waitForExit: () => exited.promise,
    terminate() {
      terminateRequested.resolve()
      for (const listener of terminalListeners) {
        listener(Object.freeze({
          error: new Error('Profile utility termination was requested'),
          phase: 'ready',
        }))
      }
      return exited.promise
    },
  })
  return Object.freeze({
    client,
    terminateRequested: terminateRequested.promise,
    lose(error: Error) {
      for (const listener of terminalListeners) {
        listener(Object.freeze({ error, phase: 'ready' }))
      }
    },
    exit(code: number | null, signal?: string | null) {
      exited.resolve({ code, ...(signal === undefined ? {} : { signal }) })
    },
  })
}

function completeGuiCommitReceipt(
  payload: Readonly<Record<string, unknown>>,
  receipt: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  return {
    previousRevision: payload.expectedRevision,
    revision: receipt.revision,
    commitId: `commit-${String(payload.generation)}`,
    generation: payload.generation,
    clientTxnId: payload.clientTxnId,
    idempotencyKey: payload.idempotencyKey,
    deletedRecordIds: [],
    changedRecordIds: [],
    appendedIntentEventIds: [],
    authorizationIds: [],
    replayed: false,
    ...receipt,
  }
}

function bridgeRequest<Operation extends ProfileBridgeOperation>(
  operation: Operation,
  payload: ProfileBridgeOperationPayloads[Operation],
  requestId = 'renderer-1',
): ProfileBridgeRequest<Operation> {
  return Object.freeze({
    version: PROFILE_BRIDGE_VERSION,
    requestId,
    operation,
    payload,
  }) as ProfileBridgeRequest<Operation>
}

function projectionAt(
  activeIdeaId: string,
  ideas: RendererProfileProjection['ideas'] = [],
): RendererProfileProjection {
  return Object.freeze({
    projectionVersion: 2,
    activeIdeaId,
    ideas,
    boardReplacements: {},
    userModTemplates: [],
    newModOrigins: {},
  })
}

function ideaSummary(id: string): RendererProfileProjection['ideas'][number] {
  return {
    id,
    name: id,
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    lastOpenedAt: '2026-07-18T00:00:00.000Z',
  }
}

function readyAt(revision: number): ProfileUtilityReadyMessage {
  return {
    version: 1,
    kind: 'ready',
    route: 'active-owner',
    state: 'ready',
    revision,
  }
}

function profileSnapshot(
  revision: number,
  profileId = 'profile-default',
  locale = 'en-AU',
  activeIdeaId = 'idea-main',
): ProfileSnapshot {
  const ideaIds = activeIdeaId === 'idea-main'
    ? ['idea-main']
    : ['idea-main', activeIdeaId]
  const board = {
    version: 1 as const,
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: '2026-07-18T00:00:00.000Z',
  }
  return {
    profileId,
    revision,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId,
    ideas: ideaIds.map(ideaSummary),
    boards: Object.fromEntries(ideaIds.map((ideaId) => [ideaId, { ...board }])),
    modTemplates: [],
    modInstances: [],
    profileSettings: [{
      id: 'profile-setting-locale',
      recordVersion: 1,
      classification: 'portable-profile',
      value: { locale },
    }],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
}

function readyStatus(revision: number) {
  return {
    profileId: 'profile-default',
    revision,
    versions: PROFILE_CONTRACT_VERSIONS,
    state: 'ready' as const,
    owner: { mode: 'mutable' as const, route: 'active-owner' as const },
    dirty: 'clean' as const,
    compatibility: {
      read: 'supported' as const,
      write: 'supported' as const,
      source: 'friends-alpha' as const,
    },
  }
}

function ok<Value>(value: Value): ProfileServiceResult<Value> {
  return { ok: true, value }
}

function deferred<Value>(): Readonly<{
  promise: Promise<Value>
  resolve(value: Value): void
}> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((accept) => {
    resolve = accept
  })
  return { promise, resolve }
}
