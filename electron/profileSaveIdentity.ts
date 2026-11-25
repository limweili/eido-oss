import { randomUUID } from 'node:crypto'
import type { ProfileGuiSaveIdentity } from '../src/persistence/profileGuiSaveScheduler'

/** Native Mod template updates require committedAt to advance strictly, even
 * when multiple renderer generations arrive inside one wall-clock millisecond. */
export function createMonotonicProfileSaveIdentityFactory(
  now: () => number = Date.now,
  createId: () => string = randomUUID,
): () => ProfileGuiSaveIdentity {
  let lastCommittedAt = -1
  return () => {
    const wallClock = now()
    if (!Number.isSafeInteger(wallClock) || wallClock < 0) {
      throw new Error('Installed Profile clock was invalid')
    }
    const committedAt = Math.max(wallClock, lastCommittedAt + 1)
    if (!Number.isSafeInteger(committedAt)) {
      throw new Error('Installed Profile clock could not advance safely')
    }
    lastCommittedAt = committedAt
    const clientTxnId = createId()
    const idempotencyKey = createId()
    if (!clientTxnId || !idempotencyKey || clientTxnId === idempotencyKey) {
      throw new Error('Installed Profile save identity was invalid')
    }
    return Object.freeze({
      clientTxnId,
      idempotencyKey,
      committedAt: new Date(committedAt).toISOString(),
    })
  }
}

/** One identity source for the lifetime of the installed Electron main session. */
export const createInstalledProfileSaveIdentity = createMonotonicProfileSaveIdentityFactory()
