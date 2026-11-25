import { describe, expect, it, vi } from 'vitest'
import { profileServiceFailure, type ProfileServiceErrorCode } from './profileServiceContract'
import {
  createProfileGuiSaveScheduler,
  ProfileGuiJsonCaptureError,
  type ProfileGuiRevisionConfirmation,
  type ProfileGuiSaveRequest,
  type ProfileGuiSaveSubmitResult,
} from './profileGuiSaveScheduler'

type Projection = Readonly<{ label: string }>
type OwnerContext = Readonly<{ actorId: string }>
type Request = ProfileGuiSaveRequest<Projection, OwnerContext>

describe('Profile GUI save scheduler (#595)', () => {
  it('keeps one request in flight, coalesces only queued generations, and saves only the latest ack', async () => {
    const first = deferred<ProfileGuiSaveSubmitResult>()
    const second = deferred<ProfileGuiSaveSubmitResult>()
    const submitted: Request[] = []
    const confirmed: number[] = []
    const statuses: string[] = []
    let identities = 0
    const scheduler = createScheduler({
      submit: (request) => {
        submitted.push(request)
        return submitted.length === 1 ? first.promise : second.promise
      },
      createIdentity: () => ({
        clientTxnId: `txn-${++identities}`,
        idempotencyKey: `key-${identities}`,
        committedAt: `2026-07-19T00:00:0${identities}.000Z`,
      }),
      onStatus: (status) => statuses.push(status.kind),
      confirmRevision: async (revision) => {
        confirmed.push(revision)
        return confirmedRevision(revision)
      },
    })

    scheduler.schedule({ label: 'generation-1' }, ownerContext())
    scheduler.schedule({ label: 'generation-2' }, ownerContext())
    const latest = { label: 'generation-3' }
    const latestContext = { actorId: 'trusted-owner' }
    const latestGeneration = scheduler.schedule(latest, latestContext)
    latest.label = 'mutated-after-schedule'
    latestContext.actorId = 'mutated-after-schedule'
    const flushed = scheduler.flush()

    expect(submitted).toHaveLength(1)
    expect(identities).toBe(1)
    expect(submitted[0]).toMatchObject({
      generation: 1,
      expectedRevision: 7,
      clientTxnId: 'txn-1',
      idempotencyKey: 'key-1',
      committedAt: '2026-07-19T00:00:01.000Z',
      projection: { label: 'generation-1' },
    })

    first.resolve({ ok: true, revision: 8 })
    await vi.waitFor(() => expect(submitted).toHaveLength(2))
    expect(identities).toBe(2)
    expect(submitted[1]).toMatchObject({
      generation: latestGeneration,
      expectedRevision: 8,
      clientTxnId: 'txn-2',
      idempotencyKey: 'key-2',
      committedAt: '2026-07-19T00:00:02.000Z',
      context: { actorId: 'trusted-owner' },
      projection: { label: 'generation-3' },
    })
    expect(statuses).not.toContain('saved')

    second.resolve({ ok: true, revision: 9 })
    await expect(flushed).resolves.toEqual({ ok: true, generation: latestGeneration, revision: 9 })
    expect(statuses[statuses.length - 1]).toBe('saved')
    expect(confirmed).toEqual([9])
    expect(submitted.map((request) => request.projection.label)).toEqual([
      'generation-1',
      'generation-3',
    ])
  })

  it('retains the exact request and key across an uncertain retry', async () => {
    const retry = deferred<ProfileGuiSaveSubmitResult>()
    const submitted: Request[] = []
    const scheduler = createScheduler({
      submit: async (request) => {
        submitted.push(request)
        if (submitted.length === 1) throw new Error('transport result unknown')
        return retry.promise
      },
    })

    const generation = scheduler.schedule({ label: 'uncertain' }, ownerContext())
    const firstFlush = scheduler.flush()
    await expect(firstFlush).resolves.toMatchObject({ ok: false, kind: 'uncertain', generation })
    expect(scheduler.inspect()).toMatchObject({
      phase: 'uncertain',
      inFlight: { request: submitted[0] },
    })

    expect(scheduler.retryUncertain()).toBe(true)
    expect(submitted).toHaveLength(2)
    expect(submitted[1]).toBe(submitted[0])
    retry.resolve({ ok: true, revision: 8 })
    await expect(scheduler.flush()).resolves.toEqual({ ok: true, generation, revision: 8 })
  })

  it('rejects deterministic failures without blocking a newer queued generation', async () => {
    const first = deferred<ProfileGuiSaveSubmitResult>()
    const submitted: Request[] = []
    const statuses: string[] = []
    const scheduler = createScheduler({
      submit: async (request) => {
        submitted.push(request)
        return submitted.length === 1
          ? first.promise
          : { ok: true, revision: request.expectedRevision + 1 }
      },
      onStatus: (status) => statuses.push(status.kind),
    })

    scheduler.schedule({ label: 'invalid-old-generation' }, ownerContext())
    const latest = scheduler.schedule({ label: 'valid-new-generation' }, ownerContext())
    first.resolve(profileServiceFailure('invalid'))

    await expect(scheduler.flush()).resolves.toEqual({ ok: true, generation: latest, revision: 8 })
    expect(submitted.map((request) => request.projection.label)).toEqual([
      'invalid-old-generation',
      'valid-new-generation',
    ])
    expect(statuses).toContain('rejected')
    expect(scheduler.retryUncertain()).toBe(false)
  })

  it.each<ProfileServiceErrorCode>(['invalid', 'unsupported-future-version'])(
    'surfaces terminal %s failures instead of making them uncertain',
    async (code) => {
      const scheduler = createScheduler({
        submit: async () => profileServiceFailure(code),
      })

      const generation = scheduler.schedule({ label: code }, ownerContext())

      await expect(scheduler.flush()).resolves.toMatchObject({
        ok: false,
        kind: 'rejected',
        generation,
        failure: { code, retryable: false },
      })
      expect(scheduler.inspect()).toMatchObject({
        phase: 'idle',
        rejected: { generation, failure: { code } },
      })
      expect(scheduler.retryUncertain()).toBe(false)
    },
  )

  it('keeps newer captured work when stale conflict reconciliation completes', async () => {
    const reconciled = deferred<ProfileGuiSaveSubmitResult>()
    const submitted: Request[] = []
    const scheduler = createScheduler({
      submit: async (request) => {
        submitted.push(request)
        if (submitted.length === 1) {
          return profileServiceFailure('conflict', { currentRevision: 11 })
        }
        return reconciled.promise
      },
    })

    const conflicted = scheduler.schedule({ label: 'stale-whole-board' }, ownerContext())
    const conflictResult = await scheduler.flush()
    expect(conflictResult).toMatchObject({
      ok: false,
      kind: 'conflict',
      generation: conflicted,
      acknowledgedRevision: 7,
      currentRevision: 11,
    })
    if (conflictResult.ok || conflictResult.kind !== 'conflict') {
      throw new Error('Expected a conflict token')
    }
    expect(submitted).toHaveLength(1)
    expect(scheduler.retryUncertain()).toBe(false)

    const newer = scheduler.schedule({ label: 'edited-during-reconciliation' }, ownerContext())
    expect(() => scheduler.resumeAfterConflict(
      conflictResult.token,
      conflicted,
      11,
      { label: 'stale-reconciliation' },
      ownerContext(),
    )).toThrow(/latest generation/)
    expect(scheduler.inspect()).toMatchObject({
      phase: 'conflict',
      queuedGeneration: newer,
      conflict: { token: conflictResult.token },
    })
    expect(() => scheduler.resumeAfterConflict(
      { ...conflictResult.token } as unknown as typeof conflictResult.token,
      newer,
      11,
      { label: 'forged-token-reconciliation' },
      ownerContext(),
    )).toThrow(/active token/)
    expect(scheduler.inspect()).toMatchObject({
      phase: 'conflict',
      queuedGeneration: newer,
      conflict: { token: conflictResult.token },
    })

    const reconciledGeneration = scheduler.resumeAfterConflict(
      conflictResult.token,
      newer,
      11,
      { label: 'freshly-reconciled' },
      ownerContext(),
    )
    expect(submitted).toHaveLength(2)
    expect(submitted[1]).toMatchObject({
      generation: reconciledGeneration,
      expectedRevision: 11,
      projection: { label: 'freshly-reconciled' },
    })
    expect(submitted[1]?.idempotencyKey).not.toBe(submitted[0]?.idempotencyKey)

    reconciled.resolve({ ok: true, revision: 12 })
    await expect(scheduler.flush()).resolves.toEqual({
      ok: true,
      generation: reconciledGeneration,
      revision: 12,
    })
  })

  it('rejects a deeply nested capture with the bounded seam error, not stack exhaustion', () => {
    const scheduler = createScheduler()
    const root: Record<string, unknown> = {}
    let cursor = root
    for (let depth = 0; depth < 100; depth += 1) {
      const child: Record<string, unknown> = {}
      cursor.child = child
      cursor = child
    }

    expect(() => scheduler.schedule(
      root as unknown as Projection,
      ownerContext(),
    )).toThrow(ProfileGuiJsonCaptureError)
    expect(() => scheduler.schedule(
      root as unknown as Projection,
      ownerContext(),
    )).toThrow(/capture depth/)
    expect(scheduler.inspect()).toMatchObject({ latestGeneration: 0, phase: 'idle' })
  })

  it('continues draining when a newer generation arrives during exact-revision confirmation', async () => {
    const first = deferred<ProfileGuiSaveSubmitResult>()
    const second = deferred<ProfileGuiSaveSubmitResult>()
    const firstConfirmation = deferred<ProfileGuiRevisionConfirmation>()
    const submitted: Request[] = []
    const confirmed: number[] = []
    const statuses: string[] = []
    const scheduler = createScheduler({
      submit: (request) => {
        submitted.push(request)
        return submitted.length === 1 ? first.promise : second.promise
      },
      confirmRevision: (revision) => {
        confirmed.push(revision)
        return confirmed.length === 1
          ? firstConfirmation.promise
          : Promise.resolve(confirmedRevision(revision))
      },
      onStatus: (status) => statuses.push(status.kind),
    })

    scheduler.schedule({ label: 'first' }, ownerContext())
    first.resolve({ ok: true, revision: 8 })
    await vi.waitFor(() => expect(scheduler.inspect().phase).toBe('confirming'))

    const latest = scheduler.schedule(
      { label: 'arrived-during-confirmation' },
      ownerContext(),
    )
    const flushed = scheduler.flush()
    firstConfirmation.resolve(confirmedRevision(8))
    await vi.waitFor(() => expect(submitted).toHaveLength(2))
    expect(statuses).not.toContain('saved')

    second.resolve({ ok: true, revision: 9 })
    await expect(flushed).resolves.toEqual({ ok: true, generation: latest, revision: 9 })
    expect(confirmed).toEqual([8, 9])
    expect(statuses[statuses.length - 1]).toBe('saved')
  })

  it('requires an exact durable-clean confirmation and retries confirmation without resubmitting', async () => {
    const confirmations = [
      Promise.resolve({ revision: 8, durable: false, dirty: true }),
      Promise.resolve(confirmedRevision(8)),
    ]
    let submissions = 0
    const scheduler = createScheduler({
      submit: async (request) => {
        submissions += 1
        return { ok: true, revision: request.expectedRevision + 1 }
      },
      confirmRevision: async () => (await confirmations.shift())!,
    })

    const generation = scheduler.schedule({ label: 'must-be-durable' }, ownerContext())
    await expect(scheduler.flush()).resolves.toEqual({
      ok: false,
      kind: 'uncertain',
      generation,
      acknowledgedRevision: 8,
    })
    expect(submissions).toBe(1)

    expect(scheduler.retryUncertain()).toBe(true)
    await expect(scheduler.flush()).resolves.toEqual({ ok: true, generation, revision: 8 })
    expect(submissions).toBe(1)
  })
})

function createScheduler(overrides: Partial<{
  submit: (request: Request) => Promise<ProfileGuiSaveSubmitResult>
  confirmRevision: (expectedRevision: number) => Promise<ProfileGuiRevisionConfirmation>
  createIdentity: () => Readonly<{
    clientTxnId: string
    idempotencyKey: string
    committedAt: string
  }>
  onStatus: (status: Readonly<{ kind: string }>) => void
}> = {}) {
  let identity = 0
  return createProfileGuiSaveScheduler<Projection, OwnerContext>({
    initialRevision: 7,
    createIdentity: overrides.createIdentity ?? (() => ({
      clientTxnId: `txn-default-${++identity}`,
      idempotencyKey: `key-default-${identity}`,
      committedAt: `2026-07-19T00:00:0${identity}.000Z`,
    })),
    submit: overrides.submit ?? (async (request) => ({ ok: true, revision: request.expectedRevision + 1 })),
    confirmRevision: overrides.confirmRevision
      ?? (async (expectedRevision) => confirmedRevision(expectedRevision)),
    onStatus: overrides.onStatus,
  })
}

function ownerContext(): OwnerContext {
  return { actorId: 'trusted-owner' }
}

function confirmedRevision(revision: number): ProfileGuiRevisionConfirmation {
  return { revision, durable: true, dirty: false }
}

function deferred<Value>(): {
  promise: Promise<Value>
  resolve(value: Value): void
} {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((settle) => { resolve = settle })
  return { promise, resolve }
}
