import type {
  ProfileUtilityClient,
  ProfileUtilityExit,
} from './profileUtilityClient'

const UTILITY_JOIN_TIMEOUT = Symbol('utility-join-timeout')

export function requireProfileUtilityExitTimeout(timeoutMs: number): number {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new Error('Profile utility exit timeout is invalid')
  }
  return timeoutMs
}

export async function closeAndJoinProfileUtility(
  client: ProfileUtilityClient,
  timeoutMs: number,
): Promise<ProfileUtilityExit> {
  requireProfileUtilityExitTimeout(timeoutMs)
  try {
    const closed = await waitForProfileUtility(
      client.request('close', Object.freeze({})),
      timeoutMs,
    )
    if (closed === UTILITY_JOIN_TIMEOUT) {
      throw new Error('Profile utility close acknowledgement timed out')
    }
    if (!closed.ok) throw new Error(closed.message)
    const exited = await waitForProfileUtility(client.waitForExit(), timeoutMs)
    if (exited === UTILITY_JOIN_TIMEOUT) {
      throw new Error('Profile utility exit timed out after close acknowledgement')
    }
    if (exited.code !== 0) throw new Error('Profile utility did not exit cleanly')
    return exited
  } catch (error) {
    await terminateAndJoinProfileUtility(client, timeoutMs)
    throw error
  }
}

export async function terminateAndJoinProfileUtility(
  client: ProfileUtilityClient,
  timeoutMs: number,
): Promise<ProfileUtilityExit> {
  requireProfileUtilityExitTimeout(timeoutMs)
  let lastFailure: unknown
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const exited = await waitForProfileUtility(
        client.terminate(attempt > 0),
        timeoutMs,
      )
      if (exited !== UTILITY_JOIN_TIMEOUT) return exited
      lastFailure = new Error('Profile utility forced termination join timed out')
    } catch (error) {
      lastFailure = error
    }
  }
  throw lastFailure instanceof Error
    ? lastFailure
    : new Error('Profile utility forced termination failed')
}

async function waitForProfileUtility<Value>(
  promise: Promise<Value>,
  timeoutMs: number,
): Promise<Value | typeof UTILITY_JOIN_TIMEOUT> {
  let timer: Parameters<typeof clearTimeout>[0] | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<typeof UTILITY_JOIN_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(UTILITY_JOIN_TIMEOUT), timeoutMs)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
