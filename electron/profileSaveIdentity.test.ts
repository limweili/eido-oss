import { describe, expect, it } from 'vitest'
import {
  createInstalledProfileSaveIdentity,
  createMonotonicProfileSaveIdentityFactory,
} from './profileSaveIdentity'

describe('installed Profile save identity', () => {
  it('keeps production session identities unique and strictly monotonic', () => {
    const first = createInstalledProfileSaveIdentity()
    const second = createInstalledProfileSaveIdentity()

    expect(Date.parse(second.committedAt)).toBeGreaterThan(Date.parse(first.committedAt))
    expect(new Set([
      first.clientTxnId,
      first.idempotencyKey,
      second.clientTxnId,
      second.idempotencyKey,
    ]).size).toBe(4)
  })

  it('advances committedAt strictly when saves share or outpace the wall clock', () => {
    const times = [1_750_000_000_000, 1_750_000_000_000, 1_749_999_999_999]
    let id = 0
    const create = createMonotonicProfileSaveIdentityFactory(
      () => times.shift() ?? 1_750_000_000_000,
      () => `identity-${++id}`,
    )

    const saves = [create(), create(), create()]
    expect(saves.map((save) => Date.parse(save.committedAt))).toEqual([
      1_750_000_000_000,
      1_750_000_000_001,
      1_750_000_000_002,
    ])
    expect(new Set(saves.flatMap((save) => [save.clientTxnId, save.idempotencyKey])).size).toBe(6)
    expect(saves.every(Object.isFrozen)).toBe(true)
  })
})
