import {
  PROFILE_BRIDGE_CHANNEL,
  PROFILE_BRIDGE_VERSION,
  type ProfileCheckpointWireAck,
} from './profileBridgeContract'
import {
  assertTrustedProfileCheckpointAck,
  type ProfileBridgeEvent,
  type ProfileBridgeWebContents,
} from './security'

export const DEFAULT_RENDERER_CHECKPOINT_TIMEOUT_MS = 10_000

export type ProfileCheckpointIpc = Readonly<{
  on(
    channel: typeof PROFILE_BRIDGE_CHANNEL,
    listener: (event: ProfileBridgeEvent, ...args: unknown[]) => void,
  ): unknown
  removeListener(
    channel: typeof PROFILE_BRIDGE_CHANNEL,
    listener: (event: ProfileBridgeEvent, ...args: unknown[]) => void,
  ): unknown
}>

export type ProfileCheckpointTarget = ProfileBridgeWebContents & Readonly<{
  send(channel: typeof PROFILE_BRIDGE_CHANNEL, message: unknown): void
}>

export function requestRendererProfileCheckpoint({
  ipc,
  target,
  createToken,
  timeoutMs = DEFAULT_RENDERER_CHECKPOINT_TIMEOUT_MS,
}: Readonly<{
  ipc: ProfileCheckpointIpc
  target: ProfileCheckpointTarget
  createToken: () => string
  timeoutMs?: number
}>): Promise<ProfileCheckpointWireAck & { ok: true }> {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 60_000) {
    throw new Error('Renderer checkpoint timeout is invalid')
  }
  const token = createToken()
  if (typeof token !== 'string' || token.length === 0 || token.length > 256) {
    throw new Error('Renderer checkpoint identity is invalid')
  }

  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (
      outcome: Readonly<{ ack: ProfileCheckpointWireAck & { ok: true } }>
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
      let acknowledgement: ProfileCheckpointWireAck
      try {
        acknowledgement = assertTrustedProfileCheckpointAck(event, target, args)
      } catch {
        return
      }
      if (acknowledgement.token !== token) return
      if (!acknowledgement.ok) {
        finish({ error: new Error('Renderer Profile checkpoint failed') })
        return
      }
      finish({ ack: acknowledgement })
    }
    const timer = setTimeout(() => {
      finish({ error: new Error('Renderer Profile checkpoint timed out') })
    }, timeoutMs)

    ipc.on(PROFILE_BRIDGE_CHANNEL, onAcknowledgement)
    try {
      target.send(PROFILE_BRIDGE_CHANNEL, Object.freeze({
        version: PROFILE_BRIDGE_VERSION,
        kind: 'checkpoint-request',
        token,
      }))
    } catch {
      finish({ error: new Error('Renderer Profile checkpoint could not be requested') })
    }
  })
}
