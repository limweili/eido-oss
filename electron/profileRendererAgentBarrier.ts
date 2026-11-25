import {
  PROFILE_BRIDGE_CHANNEL,
  PROFILE_BRIDGE_VERSION,
  type ProfileAgentBarrierWireAck,
} from './profileBridgeContract'
import {
  assertTrustedProfileAgentBarrierAck,
  type ProfileBridgeEvent,
  type ProfileBridgeWebContents,
} from './security'

export const DEFAULT_RENDERER_AGENT_BARRIER_TIMEOUT_MS = 10_000

export class RendererProfileBarrierRollbackUncertainError extends Error {
  override readonly name = 'RendererProfileBarrierRollbackUncertainError'
}

export type ProfileRendererAgentBarrierIpc = Readonly<{
  on(
    channel: typeof PROFILE_BRIDGE_CHANNEL,
    listener: (event: ProfileBridgeEvent, ...args: unknown[]) => void,
  ): unknown
  removeListener(
    channel: typeof PROFILE_BRIDGE_CHANNEL,
    listener: (event: ProfileBridgeEvent, ...args: unknown[]) => void,
  ): unknown
}>

export type ProfileRendererAgentBarrierTarget = ProfileBridgeWebContents & Readonly<{
  send(channel: typeof PROFILE_BRIDGE_CHANNEL, message: unknown): void
}>

export type InstalledProfileAgentMutationBarrier = Readonly<{
  checkpoint: Readonly<{
    generation: number
    nativeGeneration: number
    revision: number
  }>
  complete(revision: number): Promise<void>
  cancel(): Promise<void>
  sealForTerminalDrain(): Promise<Readonly<{
    generation: number
    nativeGeneration: number
    revision: number
  }>>
}>

export async function requestRendererProfileAgentBarrier({
  ipc,
  target,
  createToken,
  timeoutMs = DEFAULT_RENDERER_AGENT_BARRIER_TIMEOUT_MS,
}: Readonly<{
  ipc: ProfileRendererAgentBarrierIpc
  target: ProfileRendererAgentBarrierTarget
  createToken: () => string
  timeoutMs?: number
}>): Promise<InstalledProfileAgentMutationBarrier> {
  requireTimeout(timeoutMs)
  const token = createToken()
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    throw new Error('Renderer Agent barrier identity is invalid')
  }

  let begun: ProfileAgentBarrierWireAck & { phase: 'begin'; ok: true }
  try {
    begun = await exchange('begin') as typeof begun
  } catch (beginError) {
    try {
      let cancelled = false
      let cancelError: unknown
      for (let attempt = 0; attempt < 3 && !cancelled; attempt += 1) {
        try {
          await exchange('cancel')
          cancelled = true
        } catch (error) {
          cancelError = error
        }
      }
      if (!cancelled) throw cancelError
    } catch (cancelError) {
      throw new RendererProfileBarrierRollbackUncertainError(
        'Renderer Profile barrier acquisition could not prove rollback',
        { cause: cancelError },
      )
    }
    throw beginError
  }
  let finishIntent: Readonly<{ phase: 'complete' | 'cancel'; revision?: number }> | undefined
  let finished = false
  let finishingPromise: Promise<void> | undefined

  async function exchange(
    phase: 'begin' | 'seal' | 'complete' | 'cancel',
    revision?: number,
  ): Promise<ProfileAgentBarrierWireAck & { ok: true }> {
    return new Promise((resolve, reject) => {
      let settled = false
      const finish = (
        outcome: Readonly<{ ack: ProfileAgentBarrierWireAck & { ok: true } }>
          | Readonly<{ error: Error }>,
      ) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        ipc.removeListener(PROFILE_BRIDGE_CHANNEL, onAcknowledgement)
        if ('error' in outcome) reject(outcome.error)
        else resolve(outcome.ack)
      }
      const onAcknowledgement = (event: ProfileBridgeEvent, ...args: unknown[]) => {
        let acknowledgement: ProfileAgentBarrierWireAck
        try {
          acknowledgement = assertTrustedProfileAgentBarrierAck(event, target, args)
        } catch {
          return
        }
        if (acknowledgement.token !== token || acknowledgement.phase !== phase) return
        if (!acknowledgement.ok) {
          finish({ error: new Error(`Renderer Profile Agent barrier ${phase} failed`) })
          return
        }
        finish({ ack: acknowledgement })
      }
      const timer = setTimeout(() => {
        finish({ error: new Error(`Renderer Profile Agent barrier ${phase} timed out`) })
      }, timeoutMs)

      ipc.on(PROFILE_BRIDGE_CHANNEL, onAcknowledgement)
      try {
        target.send(PROFILE_BRIDGE_CHANNEL, Object.freeze({
          version: PROFILE_BRIDGE_VERSION,
          kind: 'agent-barrier-request',
          token,
          phase,
          ...(phase === 'complete' ? { revision } : {}),
        }))
      } catch {
        finish({ error: new Error(`Renderer Profile Agent barrier ${phase} could not be requested`) })
      }
    })
  }

  const finishBarrier = async (phase: 'complete' | 'cancel', revision?: number): Promise<void> => {
    const intent = Object.freeze({ phase, ...(revision === undefined ? {} : { revision }) })
    if (finishIntent
      && (finishIntent.phase !== intent.phase || finishIntent.revision !== intent.revision)) {
      throw new Error('Renderer Profile Agent barrier finish intent changed')
    }
    finishIntent ??= intent
    if (finished) return
    if (finishingPromise) return finishingPromise
    const attempt = (async () => {
      let lastError: unknown
      for (let retry = 0; retry < 3; retry += 1) {
        try {
          await exchange(phase, revision)
          finished = true
          return
        } catch (error) {
          lastError = error
        }
      }
      throw lastError
    })()
    finishingPromise = attempt
    try {
      await attempt
    } finally {
      if (finishingPromise === attempt) finishingPromise = undefined
    }
  }

  let sealedCheckpoint: InstalledProfileAgentMutationBarrier['checkpoint'] | undefined
  let sealingPromise: Promise<InstalledProfileAgentMutationBarrier['checkpoint']> | undefined

  const sealForTerminalDrain = (): Promise<InstalledProfileAgentMutationBarrier['checkpoint']> => {
    if (sealedCheckpoint) return Promise.resolve(sealedCheckpoint)
    if (finishIntent) return Promise.reject(new Error('Renderer Profile barrier is already finishing'))
    if (sealingPromise) return sealingPromise
    const attempt = (async () => {
      let acknowledgement: (ProfileAgentBarrierWireAck & { phase: 'seal'; ok: true }) | undefined
      let lastError: unknown
      for (let retry = 0; retry < 3 && !acknowledgement; retry += 1) {
        try {
          acknowledgement = await exchange('seal') as ProfileAgentBarrierWireAck & {
            phase: 'seal'
            ok: true
          }
        } catch (error) {
          lastError = error
        }
      }
      if (!acknowledgement) throw lastError
      sealedCheckpoint = Object.freeze({
        generation: acknowledgement.generation,
        nativeGeneration: acknowledgement.nativeGeneration,
        revision: acknowledgement.revision,
      })
      return sealedCheckpoint
    })()
    sealingPromise = attempt
    void attempt.finally(() => {
      if (sealingPromise === attempt) sealingPromise = undefined
    }).catch(() => undefined)
    return attempt
  }

  return Object.freeze({
    checkpoint: Object.freeze({
      generation: begun.generation,
      nativeGeneration: begun.nativeGeneration,
      revision: begun.revision,
    }),
    complete(revision) {
      if (!Number.isSafeInteger(revision) || revision < 0) {
        return Promise.reject(new Error('Renderer Profile Agent revision is invalid'))
      }
      return finishBarrier('complete', revision)
    },
    cancel: () => finishBarrier('cancel'),
    sealForTerminalDrain,
  })
}

function requireTimeout(timeoutMs: number): void {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new Error('Renderer Agent barrier timeout is invalid')
  }
}
