import { spawn } from 'node:child_process'
import { EventEmitter, once } from 'node:events'
import { chmod, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ProfileGatewaySessionService } from '../src/persistence/profileAgentGateway'
import { PROFILE_CONTRACT_VERSIONS } from '../src/persistence/profileServiceContract'
import type { ProfileInstallation } from './profileInstallation'
import { createProfileLiveGatewayClient } from './profileLiveGatewayClient'
import { createProfileLiveGatewayLocator } from './profileLiveGatewayLocator'
import {
  prepareProfileLiveGatewayDirectory,
  publishProfileLiveGatewayLocator,
  readProfileLiveGatewayLocator,
} from './profileLiveGatewayLocatorStore'
import { startProfileLiveGatewayServer } from './profileLiveGatewayServer'
import type { ProfileLiveGatewayHelperProcess } from './profileLiveGatewayServer'
import {
  PROFILE_LIVE_GATEWAY_LIMITS,
  createProfileLiveGatewayReady,
  encodeProfileLiveGatewayFrame,
} from './profileLiveGatewayProtocol'

const scratchRoots: string[] = []
const nativeHelperPath = process.env.EIDO_PROFILE_LIVE_GATEWAY_TEST_HELPER
const nativeDesktopIt = it.runIf(
  (process.platform === 'darwin' || process.platform === 'win32')
    && Boolean(nativeHelperPath),
)
const macNativeDesktopIt = it.runIf(
  process.platform === 'darwin' && Boolean(nativeHelperPath),
)

afterEach(async () => {
  await Promise.all(scratchRoots.splice(0).map((root) => rm(root, {
    recursive: true,
    force: true,
  })))
})

describe('Profile Live Gateway server', () => {
  nativeDesktopIt(
    'authenticates one client, serves Gateway frames, contains rejection, and cleans up',
    async () => {
    const platform = process.platform as 'darwin' | 'win32'
    const root = await mkdtemp(platform === 'darwin'
      ? '/tmp/eido-live-server-'
      : join(tmpdir(), 'eido-live-server-'))
    scratchRoots.push(root)
    const installation = syntheticInstallation(join(root, 'Eido'))
    const helperPath = requireNativeHelperPath()
    const openedIdentities: unknown[] = []
    const service = installedService()
    const server = await startProfileLiveGatewayServer({
      installation,
      platform,
      helperPath,
      createGeneration: () => '01'.repeat(16),
      createToken: () => 'ab'.repeat(32),
      openService(identity) {
        openedIdentities.push(identity)
        return { ok: true, value: service }
      },
    })
    const client = createProfileLiveGatewayClient({
      installation,
      platform,
      helperPath,
    })
    const request = {
      version: 1 as const,
      requestId: 'live-status-1',
      operation: 'profile.status' as const,
      params: Object.freeze({}),
    }

    await expect(client.invoke(request, {
      client: 'codex',
      sessionId: 'codex-process-1',
    })).resolves.toEqual({
      state: 'served',
      response: {
        version: 1,
        requestId: 'live-status-1',
        ok: true,
        result: readyStatus(),
      },
    })
    expect(openedIdentities).toEqual([{
      client: 'codex',
      sessionId: 'codex-process-1',
    }])

    await publishProfileLiveGatewayLocator(
      installation,
      platform,
      createProfileLiveGatewayLocator(
        installation,
        platform,
        server.locator.generation,
        'cd'.repeat(32),
      ),
    )
    await expect(client.invoke({ ...request, requestId: 'rejected-token' }, {
      client: 'claude-code',
      sessionId: 'claude-process-1',
    })).resolves.toEqual({
      state: 'unavailable',
      reason: 'token-rejected',
      admission: 'none',
      fallback: 'forbidden',
    })
    expect(openedIdentities).toHaveLength(1)

    await publishProfileLiveGatewayLocator(installation, platform, server.locator)
    await expect(client.invoke({ ...request, requestId: 'live-status-2' }, {
      client: 'claude-code',
      sessionId: 'claude-process-1',
    })).resolves.toMatchObject({
      state: 'served',
      response: { requestId: 'live-status-2', ok: true },
    })
    expect(openedIdentities).toEqual([
      { client: 'codex', sessionId: 'codex-process-1' },
      { client: 'claude-code', sessionId: 'claude-process-1' },
    ])

    await server.close()
    await expect(readProfileLiveGatewayLocator(installation, platform)).resolves.toEqual({
      state: 'absent',
      reason: 'locator-not-found',
    })
    if (platform === 'darwin') {
      await expect(stat(server.locator.endpoint)).rejects.toMatchObject({ code: 'ENOENT' })
    }
    expect(service.close).toHaveBeenCalledTimes(2)
  }, 30_000)

  macNativeDesktopIt(
    'withdraws a crashed helper without escalating the optional transport failure',
    async () => {
    const root = await mkdtemp('/tmp/eido-live-crash-')
    scratchRoots.push(root)
    const installation = syntheticInstallation(join(root, 'Eido'))
    const helperPath = requireNativeHelperPath()
    const onFailure = vi.fn()
    let helper: ProfileLiveGatewayHelperProcess | undefined
    const server = await startProfileLiveGatewayServer({
      installation,
      platform: 'darwin',
      helperPath,
      openService: () => ({ ok: true, value: installedService() }),
      spawnHelper(path, args) {
        helper = spawn(path, [...args], {
          stdio: ['pipe', 'pipe', 'pipe'],
        })
        return helper
      },
      onFailure,
    })

    expect((await readProfileLiveGatewayLocator(installation, 'darwin')).state).toBe('found')
    expect(helper?.kill('SIGKILL')).toBe(true)
    await vi.waitFor(() => expect(onFailure).toHaveBeenCalledOnce())
    await vi.waitFor(async () => {
      await expect(readProfileLiveGatewayLocator(installation, 'darwin')).resolves.toEqual({
        state: 'absent',
        reason: 'locator-not-found',
      })
    })

    expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Profile Live Gateway helper stopped unexpectedly',
    }))
    await expect(server.terminate()).resolves.toBeUndefined()
  }, 20_000)
})

describe.runIf(process.platform === 'darwin')('Profile Live Gateway client admission', () => {
  nativeDesktopIt('falls back only for a missing locator or confirmed missing endpoint', async () => {
    const root = await mkdtemp('/tmp/eido-live-client-')
    scratchRoots.push(root)
    const installation = syntheticInstallation(join(root, 'Eido'))
    const helperPath = requireNativeHelperPath()
    const client = createProfileLiveGatewayClient({
      installation,
      platform: 'darwin',
      helperPath,
    })
    const request = {
      version: 1 as const,
      requestId: 'absence',
      operation: 'profile.status' as const,
      params: Object.freeze({}),
    }
    const identity = { client: 'codex', sessionId: 'absence-check' }

    await expect(client.invoke(request, identity)).resolves.toMatchObject({
      state: 'absent',
      reason: 'locator-not-found',
      fallback: 'headless',
    })

    const locator = createProfileLiveGatewayLocator(
      installation,
      'darwin',
      '23'.repeat(16),
      '45'.repeat(32),
    )
    await prepareProfileLiveGatewayDirectory(installation, 'darwin')
    await publishProfileLiveGatewayLocator(installation, 'darwin', locator)
    await expect(client.invoke(request, identity)).resolves.toMatchObject({
      state: 'absent',
      reason: 'endpoint-not-found',
      fallback: 'headless',
    })

    await chmod(join(installation.userDataRoot, 'profiles', 'default', 'agent-gateway.json'), 0o644)
    await expect(client.invoke(request, identity)).resolves.toEqual({
      state: 'unavailable',
      reason: 'locator-rejected',
      admission: 'none',
      fallback: 'forbidden',
    })
  }, 20_000)

  it('bounds a helper that connects but never answers without permitting replay', async () => {
    const root = await mkdtemp('/tmp/eido-live-timeout-')
    scratchRoots.push(root)
    const installation = syntheticInstallation(join(root, 'Eido'))
    const locator = createProfileLiveGatewayLocator(
      installation,
      'darwin',
      '67'.repeat(16),
      '89'.repeat(32),
    )
    await prepareProfileLiveGatewayDirectory(installation, 'darwin')
    await publishProfileLiveGatewayLocator(installation, 'darwin', locator)
    const processEvents = new EventEmitter()
    const child = Object.assign(processEvents, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      exitCode: null,
      signalCode: null,
      kill: vi.fn(() => true),
    }) as unknown as ProfileLiveGatewayHelperProcess
    const client = createProfileLiveGatewayClient({
      installation,
      platform: 'darwin',
      helperPath: '/synthetic/helper',
      spawnHelper: () => child,
      handshakeTimeoutMs: 10,
      invocationTimeoutMs: 10,
      helperExitTimeoutMs: 10,
    })

    await expect(client.invoke({
      version: 1,
      requestId: 'wedged-helper',
      operation: 'profile.status',
      params: Object.freeze({}),
    }, {
      client: 'codex',
      sessionId: 'wedged-session',
    })).resolves.toEqual({
      state: 'unavailable',
      reason: 'transport-failure',
      admission: 'none',
      fallback: 'forbidden',
    })
    expect(child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  nativeDesktopIt('reports native peer rejection as pre-admission and forbids fallback', async () => {
    const root = await mkdtemp('/tmp/eido-live-peer-rejected-')
    scratchRoots.push(root)
    const installation = syntheticInstallation(join(root, 'Eido'))
    const helperPath = requireNativeHelperPath()
    const locator = createProfileLiveGatewayLocator(
      installation,
      'darwin',
      '11'.repeat(16),
      '22'.repeat(32),
    )
    await prepareProfileLiveGatewayDirectory(installation, 'darwin')
    await writeFile(locator.endpoint, 'not-a-socket', { mode: 0o600 })
    await publishProfileLiveGatewayLocator(installation, 'darwin', locator)

    await expect(createProfileLiveGatewayClient({
      installation,
      platform: 'darwin',
      helperPath,
    }).invoke(statusRequest('peer-rejected'), {
      client: 'codex',
      sessionId: 'peer-rejected-session',
    })).resolves.toEqual({
      state: 'unavailable',
      reason: 'peer-rejected',
      admission: 'none',
      fallback: 'forbidden',
    })
  }, 20_000)

  nativeDesktopIt('keeps repeated native exit 22 failures admission-unknown and forbids fallback', async () => {
    const root = await mkdtemp('/tmp/eido-live-transport-failure-')
    scratchRoots.push(root)
    const installation = syntheticInstallation(join(root, 'Eido'))
    const helperPath = requireNativeHelperPath()
    const locator = createProfileLiveGatewayLocator(
      installation,
      'darwin',
      '33'.repeat(16),
      '44'.repeat(32),
    )
    await prepareProfileLiveGatewayDirectory(installation, 'darwin')
    const rejectingServer = createServer(socket => socket.destroy())
    rejectingServer.listen(locator.endpoint)
    await once(rejectingServer, 'listening')
    await chmod(locator.endpoint, 0o600)
    await publishProfileLiveGatewayLocator(installation, 'darwin', locator)

    await expect(createProfileLiveGatewayClient({
      installation,
      platform: 'darwin',
      helperPath,
    }).invoke(statusRequest('transport-failure'), {
      client: 'codex',
      sessionId: 'transport-failure-session',
    })).resolves.toEqual({
      state: 'unavailable',
      reason: 'transport-failure',
      admission: 'unknown',
      fallback: 'forbidden',
    })

    rejectingServer.close()
    await once(rejectingServer, 'close')
  }, 20_000)

  nativeDesktopIt('forbids replay mid-session, then falls back after app exit withdraws the socket', async () => {
    await exerciseAppExitMidSessionFallback('darwin', requireNativeHelperPath())
  }, 30_000)

  it('never retries or falls back after ready and request transmission begins', async () => {
    const root = await mkdtemp('/tmp/eido-live-post-admission-')
    scratchRoots.push(root)
    const installation = syntheticInstallation(join(root, 'Eido'))
    const locator = createProfileLiveGatewayLocator(
      installation,
      'darwin',
      '77'.repeat(16),
      '88'.repeat(32),
    )
    await prepareProfileLiveGatewayDirectory(installation, 'darwin')
    await publishProfileLiveGatewayLocator(installation, 'darwin', locator)
    const spawnHelper = vi.fn(() => {
      const processEvents = new EventEmitter()
      const stdin = new PassThrough()
      const stdout = new PassThrough()
      const child = Object.assign(processEvents, {
        stdin,
        stdout,
        stderr: new PassThrough(),
        exitCode: null as number | null,
        signalCode: null,
        kill: vi.fn(() => true),
      }) as unknown as ProfileLiveGatewayHelperProcess
      let inputFrames = 0
      stdin.on('data', () => {
        inputFrames += 1
        if (inputFrames === 1) {
          const ready = encodeProfileLiveGatewayFrame(
            createProfileLiveGatewayReady(locator.generation),
            PROFILE_LIVE_GATEWAY_LIMITS.maxHandshakePayloadBytes,
          )
          if (!ready.ok) throw new Error('Expected a ready frame')
          stdout.write(ready.value)
          return
        }
        ;(child as { exitCode: number | null }).exitCode = 22
        stdout.end()
        processEvents.emit('exit', 22, null)
      })
      return child
    })

    await expect(createProfileLiveGatewayClient({
      installation,
      platform: 'darwin',
      helperPath: '/synthetic/helper',
      spawnHelper,
    }).invoke(statusRequest('post-admission-disconnect'), {
      client: 'codex',
      sessionId: 'post-admission-session',
    })).resolves.toEqual({
      state: 'unavailable',
      reason: 'disconnected',
      admission: 'unknown',
      fallback: 'forbidden',
    })
    expect(spawnHelper).toHaveBeenCalledTimes(1)
  })
})

describe.runIf(process.platform === 'win32')('Profile Live Gateway Windows client admission', () => {
  nativeDesktopIt('forbids replay mid-session, then falls back after app exit withdraws the pipe', async () => {
    await exerciseAppExitMidSessionFallback('win32', requireNativeHelperPath())
  }, 30_000)
})

function statusRequest(requestId: string) {
  return {
    version: 1 as const,
    requestId,
    operation: 'profile.status' as const,
    params: Object.freeze({}),
  }
}

async function waitForText(
  stream: AsyncIterable<Uint8Array>,
  expected: string,
): Promise<void> {
  let captured = ''
  for await (const chunk of stream) {
    captured += Buffer.from(chunk).toString('utf8')
    if (captured.replaceAll('\r\n', '\n').includes(expected)) return
  }
  throw new Error(`Stream ended before ${JSON.stringify(expected)}`)
}

function installedService(): ProfileGatewaySessionService & { close: ReturnType<typeof vi.fn> } {
  return Object.freeze({
    status: vi.fn(async () => ({ ok: true as const, value: readyStatus() })),
    capabilities: vi.fn(),
    query: vi.fn(),
    changes: vi.fn(),
    applyAgentCommandBatch: vi.fn(),
    close: vi.fn(async () => undefined),
  })
}

function readyStatus() {
  return {
    profileId: 'profile-live',
    revision: 7,
    versions: {
      profile: 1 as const,
      schema: 1 as const,
      record: PROFILE_CONTRACT_VERSIONS.record,
      asset: 1 as const,
      app: 1 as const,
      command: 1 as const,
      export: 1 as const,
    },
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

function syntheticInstallation(userDataRoot: string): ProfileInstallation {
  return Object.freeze({
    mode: 'proof',
    userDataRoot,
    databasePath: join(userDataRoot, 'profiles', 'default', 'eido-profile.sqlite'),
    disposable: true,
  })
}

async function exerciseAppExitMidSessionFallback(
  platform: 'darwin' | 'win32',
  helperPath: string,
): Promise<void> {
  const root = await mkdtemp(platform === 'darwin'
    ? '/tmp/eido-live-orphan-'
    : join(tmpdir(), 'eido-live-orphan-'))
  scratchRoots.push(root)
  const installation = syntheticInstallation(join(root, 'Eido'))
  const locator = createProfileLiveGatewayLocator(
    installation,
    platform,
    '55'.repeat(16),
    '66'.repeat(32),
  )
  await prepareProfileLiveGatewayDirectory(installation, platform)
  const orphan = spawn(helperPath, ['--server', locator.endpoint], {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
  const orphanClosed = once(orphan, 'close')
  try {
    await withTestTimeout(waitForText(orphan.stderr, 'ready\n'), 10_000, 'native server readiness')
    await publishProfileLiveGatewayLocator(installation, platform, locator)
    const client = createProfileLiveGatewayClient({ installation, platform, helperPath })
    const inFlight = client.invoke(statusRequest('orphan-in-flight'), {
      client: 'codex',
      sessionId: 'orphan-in-flight-session',
    })

    await expect(readNativeBytes(orphan.stdout, 4)).resolves.toEqual(Buffer.alloc(4))
    await readNativeFrame(orphan.stdout)
    const ready = encodeProfileLiveGatewayFrame(
      createProfileLiveGatewayReady(locator.generation),
      PROFILE_LIVE_GATEWAY_LIMITS.maxHandshakePayloadBytes,
    )
    if (!ready.ok) throw new Error('Expected the synthetic ready frame to fit')
    orphan.stdin.write(ready.value)
    await readNativeFrame(orphan.stdout)
    orphan.stdin.end()

    await expect(inFlight).resolves.toEqual({
      state: 'unavailable',
      reason: 'disconnected',
      admission: 'unknown',
      fallback: 'forbidden',
    })
    await withTestTimeout(orphanClosed, 10_000, 'native server exit')
    await expect(client.invoke(statusRequest('orphan-fallback'), {
      client: 'codex',
      sessionId: 'orphan-fallback-session',
    })).resolves.toEqual({
      state: 'absent',
      reason: 'endpoint-not-found',
      admission: 'none',
      fallback: 'headless',
    })
    if (platform === 'darwin') {
      await expect(stat(locator.endpoint)).rejects.toMatchObject({ code: 'ENOENT' })
    }
  } finally {
    if (orphan.exitCode === null && orphan.signalCode === null) orphan.kill('SIGKILL')
    await withTestTimeout(orphanClosed, 10_000, 'native server cleanup')
  }
}

function requireNativeHelperPath(): string {
  if (!nativeHelperPath) throw new Error('Native Profile Live Gateway helper was not built')
  return nativeHelperPath
}

async function readNativeFrame(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const header = await readNativeBytes(stream, 4)
  const payloadLength = header.readUInt32BE(0)
  if (payloadLength === 0 || payloadLength > PROFILE_LIVE_GATEWAY_LIMITS.maxGatewayPayloadBytes) {
    throw new Error('Native helper emitted an invalid frame')
  }
  return Buffer.concat([header, await readNativeBytes(stream, payloadLength)])
}

async function readNativeBytes(
  stream: NodeJS.ReadableStream,
  length: number,
): Promise<Buffer> {
  const readable = stream as NodeJS.ReadableStream & {
    read(size: number): Buffer | null
  }
  const deadline = Date.now() + 10_000
  while (Date.now() < deadline) {
    const chunk = readable.read(length)
    if (chunk !== null) return Buffer.from(chunk)
    if ((readable as NodeJS.ReadableStream & { readableEnded?: boolean }).readableEnded) {
      throw new Error(`Native helper stream ended before ${length} bytes`)
    }
    await withTestTimeout(
      once(readable, 'readable'),
      Math.max(1, deadline - Date.now()),
      `native ${length}-byte read`,
    )
  }
  throw new Error(`Native helper did not emit ${length} bytes before the deadline`)
}

async function withTestTimeout<T>(
  promise: Promise<T>,
  duration: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${duration}ms`)), duration)
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
