import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { ProfileGatewayResponse } from '../src/persistence/profileAgentGateway'
import {
  createStandaloneHeadlessEnvironment,
  runStandaloneEidoCli,
  routeStandaloneRequest,
} from './eidoCliStandalone'
import type { ProfileLiveGatewayClient } from './profileLiveGatewayTransport'
import {
  PROFILE_JSON_CLI_LIMITS,
  runProfileJsonCli,
} from './profileJsonCli'

const request = {
  version: 1 as const,
  requestId: 'standalone-request',
  operation: 'profile.status' as const,
  params: Object.freeze({}),
}
const response = {
  version: 1 as const,
  requestId: request.requestId,
  ok: true as const,
  result: { revision: 4 },
} as unknown as ProfileGatewayResponse
const identity = { client: 'codex', sessionId: 'codex-process-1' }
const runSubmitRequest = {
  version: 1 as const,
  requestId: 'standalone-run-submit',
  operation: 'run.submit' as const,
  params: Object.freeze({ ideaId: 'idea-live', targetCardId: 'ask-live' }),
}

describe('standalone eido live-first routing', () => {
  it('returns a live response without starting Electron', async () => {
    const invokeHeadless = vi.fn()
    const liveClient: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => ({ state: 'served' as const, response })),
    }

    await expect(routeStandaloneRequest(
      liveClient,
      request,
      identity,
      invokeHeadless,
    )).resolves.toEqual({ response, servedBy: 'live', live: { state: 'served' } })
    expect(invokeHeadless).not.toHaveBeenCalled()
  })

  it('starts headless Electron only after confirmed pre-admission absence', async () => {
    const headlessResponse = { ...response, requestId: request.requestId }
    const invokeHeadless = vi.fn(async () => headlessResponse)
    const absent: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => ({
        state: 'absent' as const,
        reason: 'locator-not-found' as const,
        admission: 'none' as const,
        fallback: 'headless' as const,
      })),
    }

    await expect(routeStandaloneRequest(
      absent,
      request,
      identity,
      invokeHeadless,
    )).resolves.toEqual({
      response: headlessResponse,
      servedBy: 'headless',
      live: {
        state: 'absent',
        reason: 'locator-not-found',
        admission: 'none',
        fallback: 'headless',
      },
    })
    expect(invokeHeadless).toHaveBeenCalledWith(request, identity)

    invokeHeadless.mockClear()
    const ambiguous: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => ({
        state: 'unavailable' as const,
        reason: 'disconnected' as const,
        admission: 'unknown' as const,
        fallback: 'forbidden' as const,
      })),
    }
    await expect(routeStandaloneRequest(
      ambiguous,
      request,
      identity,
      invokeHeadless,
    )).resolves.toMatchObject({
      servedBy: 'live',
      live: {
        state: 'unavailable',
        reason: 'disconnected',
        admission: 'unknown',
        fallback: 'forbidden',
      },
      response: { requestId: request.requestId, ok: false, error: { code: 'internal' } },
    })
    expect(invokeHeadless).not.toHaveBeenCalled()
  })

  it('returns live-app-required for an absent app run without starting headless Electron', async () => {
    const invokeHeadless = vi.fn()
    const liveClient: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => ({
        state: 'absent' as const,
        reason: 'locator-not-found' as const,
        admission: 'none' as const,
        fallback: 'headless' as const,
      })),
    }

    await expect(routeStandaloneRequest(
      liveClient,
      runSubmitRequest,
      identity,
      invokeHeadless,
    )).resolves.toMatchObject({
      servedBy: 'live',
      live: {
        state: 'absent',
        fallback: 'forbidden',
      },
      response: {
        ok: false,
        error: {
          code: 'busy',
          reason: 'live-app-required',
          retryable: true,
        },
      },
    })
    expect(invokeHeadless).not.toHaveBeenCalled()
  })

  it('marks post-admission run submit loss as non-retryable outcome-unknown', async () => {
    const invokeHeadless = vi.fn()
    const liveClient: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => ({
        state: 'unavailable' as const,
        reason: 'disconnected' as const,
        admission: 'unknown' as const,
        fallback: 'forbidden' as const,
      })),
    }

    await expect(routeStandaloneRequest(
      liveClient,
      runSubmitRequest,
      identity,
      invokeHeadless,
    )).resolves.toMatchObject({
      servedBy: 'live',
      response: {
        ok: false,
        error: {
          code: 'internal',
          reason: 'submit-outcome-unknown',
          retryable: false,
        },
      },
    })
    expect(invokeHeadless).not.toHaveBeenCalled()
  })

  it('preserves a served renderer submit-timeout refusal without retry or fallback', async () => {
    const invokeHeadless = vi.fn()
    const rendererTimeout = {
      version: 1 as const,
      requestId: runSubmitRequest.requestId,
      ok: false as const,
      error: {
        code: 'internal' as const,
        reason: 'submit-outcome-unknown' as const,
        retryable: false,
        message: 'The agent run submission outcome is unknown. Do not retry this submission.',
      },
    }
    const liveClient: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => ({ state: 'served' as const, response: rendererTimeout })),
    }

    await expect(routeStandaloneRequest(
      liveClient,
      runSubmitRequest,
      identity,
      invokeHeadless,
    )).resolves.toEqual({
      response: rendererTimeout,
      servedBy: 'live',
      live: { state: 'served' },
    })
    expect(invokeHeadless).not.toHaveBeenCalled()
  })

  it.each([
    [
      'absent',
      {
        state: 'absent' as const,
        reason: 'endpoint-not-found' as const,
        admission: 'none' as const,
        fallback: 'headless' as const,
      },
      'live-app-required',
      4,
    ],
    [
      'ambiguous',
      {
        state: 'unavailable' as const,
        reason: 'disconnected' as const,
        admission: 'unknown' as const,
        fallback: 'forbidden' as const,
      },
      'submit-outcome-unknown',
      1,
    ],
  ])('keeps raw run.submit %s routing live-only', async (
    _name,
    liveOutcome,
    expectedReason,
    expectedExit,
  ) => {
    const stdout: string[] = []
    const stderr: string[] = []
    const runHeadlessRaw = vi.fn()
    const exitCode = await runStandaloneEidoCli({
      argv: ['batch'],
      environment: {},
      platform: 'darwin',
      executablePath: path.join('/Applications', 'Eido.app', 'Contents', 'Resources', 'bin', 'eido'),
      homeDirectory: '/Users/friend',
      stdin: chunks(new TextEncoder().encode(JSON.stringify(runSubmitRequest))),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: value => { stderr.push(value) } },
      createSessionId: () => 'raw-run-session',
      liveClient: { invoke: vi.fn(async () => liveOutcome) },
      runHeadlessRaw,
    })

    expect(exitCode).toBe(expectedExit)
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      requestId: runSubmitRequest.requestId,
      ok: false,
      error: { reason: expectedReason },
    })
    expect(runHeadlessRaw).not.toHaveBeenCalled()
    expect(stderr).toHaveLength(1)
  })

  it('plans in the SEA process and reports live service metadata', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const liveClient: ProfileLiveGatewayClient = {
      invoke: vi.fn(async (candidate, trustedIdentity) => {
        expect(candidate).toEqual(request)
        expect(trustedIdentity).toEqual(identity)
        return { state: 'served' as const, response }
      }),
    }
    const exitCode = await runStandaloneEidoCli({
      argv: ['--agent-client', 'codex', '--agent-session', 'codex-process-1', 'status'],
      environment: {},
      platform: 'darwin',
      executablePath: path.join('/Applications', 'Eido.app', 'Contents', 'Resources', 'bin', 'eido'),
      homeDirectory: '/Users/friend',
      stdin: emptyInput(),
      stdout: { write: (value) => { stdout.push(value) } },
      stderr: { write: (value) => { stderr.push(value) } },
      createRequestId: () => request.requestId,
      createSessionId: () => 'unused-generated-session',
      liveClient,
      invokeHeadless: vi.fn(async () => { throw new Error('Electron started on live hot path') }),
    })

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(JSON.parse(stdout.join(''))).toEqual({
      ...response,
      cli: { version: 1, servedBy: 'live', live: { state: 'served' } },
    })
  })

  it('carries ergonomic Result inspection through closed-app headless routing', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const invokeHeadless = vi.fn(async (candidate) => ({
      version: 1 as const,
      requestId: candidate.requestId,
      ok: true as const,
      result: {
        profileId: 'profile-installed',
        revision: 7,
        ideaId: 'idea-main',
        resultCardId: 'card-result',
        items: [],
        truncated: false,
      },
    }) as ProfileGatewayResponse)
    const liveClient: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => ({
        state: 'absent' as const,
        reason: 'endpoint-not-found' as const,
        admission: 'none' as const,
        fallback: 'headless' as const,
      })),
    }

    const exitCode = await runStandaloneEidoCli({
      argv: [
        'result', 'inspect', 'card-result', '--idea', 'idea-main',
        '--limit', '2', '--byte-limit', '4096',
      ],
      environment: {},
      platform: 'darwin',
      executablePath: path.join('/Applications', 'Eido.app', 'Contents', 'Resources', 'bin', 'eido'),
      homeDirectory: '/Users/friend',
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: value => { stderr.push(value) } },
      createRequestId: () => 'result-installed-request',
      createSessionId: () => 'result-installed-session',
      liveClient,
      invokeHeadless,
    })

    expect(exitCode).toBe(0)
    expect(invokeHeadless).toHaveBeenCalledWith({
      version: 1,
      requestId: 'result-installed-request',
      operation: 'result.inspect',
      params: {
        ideaId: 'idea-main',
        resultCardId: 'card-result',
        limit: 2,
        byteLimit: 4_096,
      },
    }, { client: 'eido-cli', sessionId: 'result-installed-session' })
    expect(JSON.parse(stdout.join(''))).toMatchObject({
      ok: true,
      result: {
        revision: 7,
        ideaId: 'idea-main',
        resultCardId: 'card-result',
      },
      cli: { version: 1, servedBy: 'headless', live: { state: 'absent' } },
    })
    expect(stderr).toEqual([])
  })

  it('resolves Windows environment keys case-insensitively and canonicalizes the child allowlist', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const liveClient: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => ({ state: 'served' as const, response })),
    }
    const exitCode = await runStandaloneEidoCli({
      argv: ['status'],
      environment: {
        AppData: '/synthetic/AppData/Roaming',
        systemroot: 'C:\\Windows',
        userprofile: 'C:\\Users\\friend',
      },
      platform: 'win32',
      executablePath: 'C:\\Program Files\\Eido\\resources\\bin\\eido.exe',
      homeDirectory: 'C:\\Users\\friend',
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: value => { stderr.push(value) } },
      createRequestId: () => request.requestId,
      createSessionId: () => identity.sessionId,
      liveClient,
    })

    expect(exitCode).toBe(0)
    expect(stderr).toEqual([])
    expect(JSON.parse(stdout.join(''))).toMatchObject({ ok: true })
    expect(createStandaloneHeadlessEnvironment({
      AppData: '/synthetic/AppData/Roaming',
      systemroot: 'C:\\Windows',
      Temp: 'C:\\Temp',
      EIDO_PRIVATE_VALUE: 'not-forwarded',
    }, identity)).toEqual({
      APPDATA: '/synthetic/AppData/Roaming',
      SystemRoot: 'C:\\Windows',
      TEMP: 'C:\\Temp',
      EIDO_AGENT_CLIENT: identity.client,
      EIDO_AGENT_SESSION_ID: identity.sessionId,
    })
  })

  it('returns a correlated ergonomic envelope when headless Electron throws', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const liveClient: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => ({
        state: 'absent' as const,
        reason: 'locator-not-found' as const,
        admission: 'none' as const,
        fallback: 'headless' as const,
      })),
    }
    const exitCode = await runStandaloneEidoCli({
      argv: ['status'],
      environment: {},
      platform: 'darwin',
      executablePath: path.join('/Applications', 'Eido.app', 'Contents', 'Resources', 'bin', 'eido'),
      homeDirectory: '/Users/friend',
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: value => { stderr.push(value) } },
      createRequestId: () => 'headless-exception-request',
      createSessionId: () => 'headless-exception-session',
      liveClient,
      invokeHeadless: vi.fn(async () => { throw new Error('headless spawn failed') }),
    })

    expect(exitCode).toBe(1)
    expect(JSON.parse(stdout.join(''))).toEqual({
      version: 1,
      requestId: 'headless-exception-request',
      ok: false,
      error: {
        code: 'internal',
        message: 'The operation did not complete. Retry or inspect Profile status.',
        retryable: true,
      },
      cli: {
        version: 1,
        servedBy: 'headless',
        live: {
          state: 'absent',
          reason: 'locator-not-found',
          admission: 'none',
          fallback: 'headless',
        },
      },
    })
    expect(stderr).toEqual(['Eido Profile inspection failed (internal).\n'])
  })

  it('keeps closed-app headless fallback available when the fixed macOS socket path is too long', async () => {
    const stdout: string[] = []
    const stderr: string[] = []
    const invokeHeadless = vi.fn(async () => response)
    const exitCode = await runStandaloneEidoCli({
      argv: ['status'],
      environment: {},
      platform: 'darwin',
      executablePath: path.join('/Applications', 'Eido.app', 'Contents', 'Resources', 'bin', 'eido'),
      homeDirectory: `/Users/${'long-profile-segment-'.repeat(8)}`,
      stdin: emptyInput(),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: value => { stderr.push(value) } },
      createRequestId: () => request.requestId,
      createSessionId: () => 'long-profile-session',
      invokeHeadless,
    })

    expect(exitCode).toBe(0)
    expect(invokeHeadless).toHaveBeenCalledWith(request, {
      client: 'eido-cli',
      sessionId: 'long-profile-session',
    })
    expect(JSON.parse(stdout.join(''))).toEqual({
      ...response,
      cli: {
        version: 1,
        servedBy: 'headless',
        live: {
          state: 'absent',
          reason: 'endpoint-not-found',
          admission: 'none',
          fallback: 'headless',
        },
      },
    })
    expect(stderr).toEqual([])
  })

  it('passes raw batch bytes and process outputs through the headless path unchanged', async () => {
    const rawInput = new TextEncoder().encode(
      ' \r\n{ "version": 1, "requestId": "raw-exact", "operation": "profile.status", "params": {} }\r\n',
    )
    const stdout: string[] = []
    const stderr: string[] = []
    const forwarded: Uint8Array[] = []
    const rawStdout = '{"version":1,"requestId":"raw-exact","ok":false,"error":{"code":"not-found"}}\r\n'
    const rawStderr = 'Eido Profile inspection failed (not-found).\r\n'
    const liveClient: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => ({
        state: 'absent' as const,
        reason: 'endpoint-not-found' as const,
        admission: 'none' as const,
        fallback: 'headless' as const,
      })),
    }
    const exitCode = await runStandaloneEidoCli({
      argv: ['batch'],
      environment: {},
      platform: 'darwin',
      executablePath: path.join('/Applications', 'Eido.app', 'Contents', 'Resources', 'bin', 'eido'),
      homeDirectory: '/Users/friend',
      stdin: chunks(rawInput.subarray(0, 7), rawInput.subarray(7)),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: value => { stderr.push(value) } },
      createRequestId: () => 'unused',
      createSessionId: () => 'raw-session',
      liveClient,
      invokeHeadless: vi.fn(async () => { throw new Error('raw mode parsed/reserialized') }),
      runHeadlessRaw: vi.fn(async (io, trustedIdentity) => {
        expect(trustedIdentity).toEqual({ client: 'eido-cli', sessionId: 'raw-session' })
        for await (const chunk of io.stdin) {
          forwarded.push(typeof chunk === 'string' ? new TextEncoder().encode(chunk) : chunk)
        }
        await io.stdout.write(rawStdout)
        await io.stderr.write(rawStderr)
        return 6
      }),
    })

    expect(exitCode).toBe(6)
    expect(Buffer.concat(forwarded.map(value => Buffer.from(value)))).toEqual(Buffer.from(rawInput))
    expect(stdout).toEqual([rawStdout])
    expect(stderr).toEqual([rawStderr])
  })

  it.each([
    ['malformed', new TextEncoder().encode('{not-json')],
    [
      'oversized',
      new TextEncoder().encode('x'.repeat(PROFILE_JSON_CLI_LIMITS.maxInputBytes + 1)),
    ],
  ])('keeps locally rejected %s raw input byte-contract equivalent to the certified child', async (_name, input) => {
    const expected = await runRawReference(input)
    const stdout: string[] = []
    const stderr: string[] = []
    const liveClient: ProfileLiveGatewayClient = {
      invoke: vi.fn(async () => { throw new Error('invalid raw input reached live routing') }),
    }
    const runHeadlessRaw = vi.fn(async () => {
      throw new Error('invalid raw input reached the headless child')
    })
    const exitCode = await runStandaloneEidoCli({
      argv: ['batch'],
      environment: {},
      platform: 'darwin',
      executablePath: path.join('/Applications', 'Eido.app', 'Contents', 'Resources', 'bin', 'eido'),
      homeDirectory: '/Users/friend',
      stdin: chunks(input),
      stdout: { write: value => { stdout.push(value) } },
      stderr: { write: value => { stderr.push(value) } },
      createSessionId: () => 'raw-invalid-session',
      liveClient,
      runHeadlessRaw,
    })

    expect({ exitCode, stdout: stdout.join(''), stderr: stderr.join('') }).toEqual(expected)
    expect(liveClient.invoke).not.toHaveBeenCalled()
    expect(runHeadlessRaw).not.toHaveBeenCalled()
  })

  it('bounds a hung headless Electron child, terminates it, and returns correlated ergonomic failure', async () => {
    const root = await mkdtemp('/tmp/eido-headless-timeout-')
    try {
      const resourcesBin = path.join(root, 'Eido.app', 'Contents', 'Resources', 'bin')
      const macosDirectory = path.join(root, 'Eido.app', 'Contents', 'MacOS')
      await mkdir(resourcesBin, { recursive: true })
      await mkdir(macosDirectory, { recursive: true })
      const executable = path.join(macosDirectory, 'Eido')
      await writeFile(executable, [
        `#!${process.execPath}`,
        "process.on('SIGTERM', () => undefined)",
        'setInterval(() => undefined, 1_000)',
        '',
      ].join('\n'))
      await chmod(executable, 0o755)
      const stdout: string[] = []
      const stderr: string[] = []
      const liveClient: ProfileLiveGatewayClient = {
        invoke: vi.fn(async () => ({
          state: 'absent' as const,
          reason: 'endpoint-not-found' as const,
          admission: 'none' as const,
          fallback: 'headless' as const,
        })),
      }
      const started = Date.now()
      const exitCode = await runStandaloneEidoCli({
        argv: ['status'],
        environment: {},
        platform: 'darwin',
        executablePath: path.join(resourcesBin, 'eido'),
        homeDirectory: '/Users/friend',
        stdin: emptyInput(),
        stdout: { write: value => { stdout.push(value) } },
        stderr: { write: value => { stderr.push(value) } },
        createRequestId: () => 'headless-timeout-request',
        createSessionId: () => 'headless-timeout-session',
        liveClient,
        headlessProcessTimeoutMs: 20,
        headlessTerminationGraceMs: 20,
      })

      expect(Date.now() - started).toBeLessThan(1_000)
      expect(exitCode).toBe(1)
      expect(JSON.parse(stdout.join(''))).toMatchObject({
        requestId: 'headless-timeout-request',
        ok: false,
        error: { code: 'internal' },
        cli: {
          servedBy: 'headless',
          live: { state: 'absent', reason: 'endpoint-not-found' },
        },
      })
      expect(stderr).toEqual(['Eido Profile inspection failed (internal).\n'])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})

async function* emptyInput(): AsyncGenerator<Uint8Array> {}

async function* chunks(...values: Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* values
}

async function runRawReference(input: Uint8Array): Promise<Readonly<{
  exitCode: number
  stdout: string
  stderr: string
}>> {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCode = await runProfileJsonCli({
    openService: async () => { throw new Error('invalid raw input opened Profile authority') },
    stdin: chunks(input),
    stdout: { write: value => { stdout.push(value) } },
    stderr: { write: value => { stderr.push(value) } },
  })
  return Object.freeze({ exitCode, stdout: stdout.join(''), stderr: stderr.join('') })
}
