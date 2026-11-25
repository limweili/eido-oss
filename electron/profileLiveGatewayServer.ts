import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import {
  createProfileGatewaySession,
  type ProfileGatewaySession,
  type ProfileGatewaySessionService,
} from '../src/persistence/profileAgentGateway'
import type { ProfileServiceResult } from '../src/persistence/profileServiceContract'
import type { ProfileInstallation } from './profileInstallation'
import {
  createProfileLiveGatewayLocator,
  type ProfileLiveGatewayLocator,
  type ProfileLiveGatewayPlatform,
} from './profileLiveGatewayLocator'
import {
  prepareProfileLiveGatewayDirectory,
  publishProfileLiveGatewayLocator,
  removeProfileLiveGatewayLocator,
} from './profileLiveGatewayLocatorStore'
import {
  PROFILE_LIVE_GATEWAY_LIMITS,
  createProfileLiveGatewayDenied,
  createProfileLiveGatewayReady,
  decodeProfileLiveGatewayFrame,
  encodeProfileLiveGatewayFrame,
  parseProfileLiveGatewayHello,
} from './profileLiveGatewayProtocol'
import {
  ProfileLiveGatewayStreamReader,
  encodeProfileLiveGatewayConnectionClose,
  encodeProfileLiveGatewayTerminalFrame,
  writeProfileLiveGatewayBytes,
  type ProfileLiveGatewayStreamMessage,
} from './profileLiveGatewayStream'
import type { ProfileLiveGatewayServer } from './profileLiveGatewayTransport'

const DEFAULT_HELPER_READY_TIMEOUT_MS = 5_000
const DEFAULT_HELPER_EXIT_TIMEOUT_MS = 5_000
const HELPER_READY_MAX_BYTES = 4 * 1024

export type ProfileLiveGatewayHelperProcess = Pick<
  ChildProcessWithoutNullStreams,
  'stdin' | 'stdout' | 'stderr' | 'once' | 'off' | 'kill' | 'exitCode' | 'signalCode'
>

export type StartedProfileLiveGatewayServer = ProfileLiveGatewayServer & Readonly<{
  locator: ProfileLiveGatewayLocator
}>

export type ProfileLiveGatewayServerOptions = Readonly<{
  installation: ProfileInstallation
  platform: ProfileLiveGatewayPlatform
  helperPath: string
  openService(
    identity: Readonly<{ client: string; sessionId: string }>,
  ):
    | ProfileServiceResult<ProfileGatewaySessionService>
    | Promise<ProfileServiceResult<ProfileGatewaySessionService>>
  createGeneration?: () => string
  createToken?: () => string
  spawnHelper?: (
    helperPath: string,
    args: readonly string[],
  ) => ProfileLiveGatewayHelperProcess
  helperReadyTimeoutMs?: number
  helperExitTimeoutMs?: number
  onFailure?: (error: Error) => void
}>

export async function startProfileLiveGatewayServer(
  options: ProfileLiveGatewayServerOptions,
): Promise<StartedProfileLiveGatewayServer> {
  const helperReadyTimeoutMs = requireTimeout(
    options.helperReadyTimeoutMs ?? DEFAULT_HELPER_READY_TIMEOUT_MS,
  )
  const helperExitTimeoutMs = requireTimeout(
    options.helperExitTimeoutMs ?? DEFAULT_HELPER_EXIT_TIMEOUT_MS,
  )
  const generation = (options.createGeneration ?? (() => randomBytes(16).toString('hex')))()
  const token = (options.createToken ?? (() => randomBytes(32).toString('hex')))()
  const locator = createProfileLiveGatewayLocator(
    options.installation,
    options.platform,
    generation,
    token,
  )
  await prepareProfileLiveGatewayDirectory(options.installation, options.platform)
  const spawnHelper = options.spawnHelper ?? defaultSpawnHelper
  const child = spawnHelper(options.helperPath, ['--server', locator.endpoint])
  const exited = waitForHelperExit(child)
  let published = false
  try {
    await waitForHelperReady(child, helperReadyTimeoutMs)
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error('Profile Live Gateway helper exited before locator publication')
    }
    await publishProfileLiveGatewayLocator(options.installation, options.platform, locator)
    published = true
  } catch (error) {
    child.kill('SIGTERM')
    await removeProfileLiveGatewayLocator(
      options.installation,
      options.platform,
      generation,
    ).catch(() => undefined)
    throw error
  }

  let stopping = false
  let stopPromise: Promise<void> | undefined
  let activeGateway: ProfileGatewaySession | undefined
  let connectionState: 'none' | 'handshake' | 'admitted' | 'closing' = 'none'

  const removeOwnedLocator = async (): Promise<void> => {
    if (!published) return
    published = false
    await removeProfileLiveGatewayLocator(
      options.installation,
      options.platform,
      generation,
    )
  }

  const closeActiveGateway = async (): Promise<void> => {
    const gateway = activeGateway
    activeGateway = undefined
    if (gateway) await gateway.close()
  }

  const rejectCurrentConnection = async (): Promise<void> => {
    await closeActiveGateway()
    connectionState = 'closing'
    await writeProfileLiveGatewayBytes(
      child.stdin,
      encodeProfileLiveGatewayConnectionClose(),
    )
  }

  const denyCurrentConnection = async (clientGeneration: string): Promise<void> => {
    await closeActiveGateway()
    connectionState = 'closing'
    const denied = encodeProfileLiveGatewayFrame(
      createProfileLiveGatewayDenied(clientGeneration),
      PROFILE_LIVE_GATEWAY_LIMITS.maxHandshakePayloadBytes,
    )
    if (!denied.ok) {
      throw new Error('Profile Live Gateway denial frame could not be encoded')
    }
    await writeProfileLiveGatewayBytes(
      child.stdin,
      encodeProfileLiveGatewayTerminalFrame(denied.value),
    )
  }

  const handleMessage = async (message: ProfileLiveGatewayStreamMessage): Promise<void> => {
    if (message.kind === 'connection-open') {
      await closeActiveGateway()
      connectionState = stopping ? 'closing' : 'handshake'
      if (stopping) await rejectCurrentConnection()
      return
    }
    if (message.kind === 'connection-close') {
      await closeActiveGateway()
      connectionState = 'none'
      return
    }
    if (connectionState === 'handshake') {
      const decoded = decodeProfileLiveGatewayFrame(
        message.frame,
        PROFILE_LIVE_GATEWAY_LIMITS.maxHandshakePayloadBytes,
      )
      const hello = decoded.ok ? parseProfileLiveGatewayHello(decoded.value) : undefined
      if (!hello) {
        await rejectCurrentConnection()
        return
      }
      if (hello.generation !== generation || !sameToken(hello.token, token)) {
        await denyCurrentConnection(hello.generation)
        return
      }
      activeGateway = createProfileGatewaySession({
        openService: async () => options.openService(Object.freeze({
          client: hello.client,
          sessionId: hello.sessionId,
        })),
      })
      connectionState = 'admitted'
      const ready = encodeProfileLiveGatewayFrame(
        createProfileLiveGatewayReady(generation),
        PROFILE_LIVE_GATEWAY_LIMITS.maxHandshakePayloadBytes,
      )
      if (!ready.ok) throw new Error('Profile Live Gateway ready frame could not be encoded')
      await writeProfileLiveGatewayBytes(child.stdin, ready.value)
      return
    }
    if (connectionState !== 'admitted' || !activeGateway) {
      await rejectCurrentConnection()
      return
    }
    const decoded = decodeProfileLiveGatewayFrame(
      message.frame,
      PROFILE_LIVE_GATEWAY_LIMITS.maxGatewayPayloadBytes,
    )
    if (!decoded.ok) {
      await rejectCurrentConnection()
      return
    }
    const response = await activeGateway.invoke(decoded.value)
    const encoded = encodeProfileLiveGatewayFrame(
      response,
      PROFILE_LIVE_GATEWAY_LIMITS.maxGatewayPayloadBytes,
    )
    if (!encoded.ok) {
      await rejectCurrentConnection()
      return
    }
    await writeProfileLiveGatewayBytes(child.stdin, encoded.value)
  }

  const serving = (async () => {
    const reader = new ProfileLiveGatewayStreamReader(child.stdout, {
      maxPayloadBytes: PROFILE_LIVE_GATEWAY_LIMITS.maxGatewayPayloadBytes,
      allowConnectionControls: true,
    })
    try {
      while (true) {
        const message = await reader.read()
        if (!message) break
        try {
          await handleMessage(message)
        } catch {
          if (message.kind === 'frame' && !stopping) {
            try {
              await rejectCurrentConnection()
              continue
            } catch {
              // A failed parent/helper stream is handled by the terminal path below.
            }
          }
          break
        }
      }
    } finally {
      await closeActiveGateway().catch(() => undefined)
      await removeOwnedLocator().catch(() => undefined)
      if (!stopping) {
        child.kill('SIGTERM')
        try {
          options.onFailure?.(new Error('Profile Live Gateway helper stopped unexpectedly'))
        } catch {
          // The optional transport cannot destabilize Profile authority.
        }
      }
    }
  })()
  void serving.catch(() => undefined)
  void exited.then(() => removeOwnedLocator().catch(() => undefined))

  async function stop(force: boolean): Promise<void> {
    if (stopPromise) return stopPromise
    stopping = true
    stopPromise = (async () => {
      await removeOwnedLocator()
      if (!force) {
        await closeActiveGateway()
        if (connectionState !== 'none') {
          await writeProfileLiveGatewayBytes(
            child.stdin,
            encodeProfileLiveGatewayConnectionClose(),
          ).catch(() => undefined)
        }
      }
      child.kill(force ? 'SIGKILL' : 'SIGTERM')
      const stopped = await waitBounded(exited, helperExitTimeoutMs)
      if (!stopped) {
        child.kill('SIGKILL')
        await exited
      }
      await serving
    })()
    return stopPromise
  }

  return Object.freeze({
    locator,
    close: () => stop(false),
    terminate: () => stop(true),
  })
}

function defaultSpawnHelper(
  helperPath: string,
  args: readonly string[],
): ProfileLiveGatewayHelperProcess {
  return spawn(helperPath, [...args], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

function waitForHelperReady(
  child: ProfileLiveGatewayHelperProcess,
  timeoutMs: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let captured = Buffer.alloc(0)
    const timer = setTimeout(() => finish(new Error(
      'Profile Live Gateway helper readiness timed out',
    )), timeoutMs)
    const onData = (chunk: Uint8Array): void => {
      captured = Buffer.concat([captured, Buffer.from(chunk)])
      if (captured.byteLength > HELPER_READY_MAX_BYTES) {
        finish(new Error('Profile Live Gateway helper readiness output exceeded its limit'))
        return
      }
      if (/(?:^|\r?\n)ready\r?\n/.test(captured.toString('utf8'))) finish()
    }
    const onError = (error: Error): void => finish(error)
    const onExit = (): void => finish(new Error(
      'Profile Live Gateway helper exited before readiness',
    ))
    const finish = (error?: Error): void => {
      clearTimeout(timer)
      child.stderr.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
      if (error) reject(error)
      else resolve()
    }
    child.stderr.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

function waitForHelperExit(
  child: ProfileLiveGatewayHelperProcess,
): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    const finish = (): void => {
      child.off('error', finish)
      child.off('exit', finish)
      resolve()
    }
    child.once('error', finish)
    child.once('exit', finish)
  })
}

function sameToken(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left, 'hex')
  const rightBytes = Buffer.from(right, 'hex')
  return leftBytes.byteLength === rightBytes.byteLength
    && timingSafeEqual(leftBytes, rightBytes)
}

function requireTimeout(candidate: number): number {
  if (!Number.isSafeInteger(candidate) || candidate <= 0 || candidate > 60_000) {
    throw new Error('Profile Live Gateway helper timeout is invalid')
  }
  return candidate
}

async function waitBounded(promise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise.then(() => true),
      new Promise<false>((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}
