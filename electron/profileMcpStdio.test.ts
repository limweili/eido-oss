import { PassThrough, Readable, Writable } from 'node:stream'
import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it, vi } from 'vitest'
import {
  createProfileGatewaySession,
  type ProfileGatewayService,
  type ProfileGatewaySessionService,
} from '../src/persistence/profileAgentGateway'
import { PROFILE_CONTRACT_VERSIONS } from '../src/persistence/profileServiceContract'
import { createBoundedProfileMcpInput, runProfileMcpStdio } from './profileMcpStdio'

describe('Profile MCP stdio boundary', () => {
  it('reports malformed frames, discards one oversized line, and recovers the next frame', async () => {
    const failures: number[] = []
    const bounded = createBoundedProfileMcpInput({
      maxLineBytes: 96,
      onProtocolFailure: (code) => failures.push(code),
    })
    const first = '{"jsonrpc":"2.0","id":1,"method":"ping"}\n'
    const recovered = '{"jsonrpc":"2.0","method":"notifications/initialized"}\n'
    Readable.from([
      Buffer.from(first.slice(0, 11)),
      Buffer.from(`${first.slice(11)}\n`),
      Buffer.alloc(70, 0x78),
      Buffer.alloc(30, 0x78),
      Buffer.from(`\n${recovered}`),
      Buffer.from('not-json\n{"hello":"world"}\n{"jsonrpc":'),
    ]).pipe(bounded)

    await expect(readAll(bounded)).resolves.toEqual(first + recovered)
    expect(failures).toEqual([
      ErrorCode.ParseError,
      ErrorCode.InvalidRequest,
      ErrorCode.ParseError,
      ErrorCode.InvalidRequest,
      ErrorCode.ParseError,
    ])
  })

  it('lets the final complete request cross admission before EOF drains and closes authority', async () => {
    const events: string[] = []
    let resolveStatus: ((result: Awaited<ReturnType<ProfileGatewayService['status']>>) => void)
      | undefined
    const statusResult = new Promise<Awaited<ReturnType<ProfileGatewayService['status']>>>(
      (resolve) => { resolveStatus = resolve },
    )
    const service = Object.freeze({
      status: vi.fn(() => {
        events.push('invoke')
        return statusResult
      }),
      capabilities: vi.fn(),
      query: vi.fn(),
      applyAgentCommandBatch: vi.fn(),
      close: vi.fn(async () => { events.push('service-close') }),
    })
    const openService = vi.fn(async () => ({ ok: true as const, value: service }))
    const gateway = createProfileGatewaySession({ openService })
    const stdin = new PassThrough()
    const stdout = collectWrites()
    const stderr = collectWrites()
    const running = runProfileMcpStdio({
      gateway,
      createRequestId: () => 'mcp-final-before-eof',
      stdin,
      stdout: stdout.stream,
      stderr: stderr.stream,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    stdin.end([
      jsonLine({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'eido-test', version: '1.0.0' },
        },
      }),
      jsonLine({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      jsonLine({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'profile.status', arguments: {} },
      }),
    ].join(''))

    await vi.waitFor(() => expect(openService).toHaveBeenCalledTimes(1))
    expect(service.close).not.toHaveBeenCalled()
    resolveStatus?.({ ok: true, value: readyStatus() })
    await running

    expect(events).toEqual(['invoke', 'service-close'])
    expect(stdout.text()[0]).toBe('{')
    const responses = stdout.text().trimEnd().split('\n').map((line) => JSON.parse(line))
    expect(responses).toEqual(expect.arrayContaining([
      expect.objectContaining({ jsonrpc: '2.0', id: 1 }),
      expect.objectContaining({
        jsonrpc: '2.0',
        id: 2,
        result: expect.objectContaining({
          structuredContent: expect.objectContaining({ requestId: 'mcp-final-before-eof' }),
        }),
      }),
    ]))
    expect(stderr.text()).toBe('')
  })

  it('drains an accepted request before signal shutdown closes authority', async () => {
    const events: string[] = []
    let resolveStatus: ((result: Awaited<ReturnType<ProfileGatewayService['status']>>) => void)
      | undefined
    const statusResult = new Promise<Awaited<ReturnType<ProfileGatewayService['status']>>>(
      (resolve) => { resolveStatus = resolve },
    )
    const service = Object.freeze({
      status: vi.fn(() => {
        events.push('invoke')
        return statusResult
      }),
      capabilities: vi.fn(),
      query: vi.fn(),
      applyAgentCommandBatch: vi.fn(),
      close: vi.fn(async () => { events.push('service-close') }),
    })
    const gateway = createProfileGatewaySession({
      openService: vi.fn(async () => ({ ok: true as const, value: service })),
    })
    const stdin = new PassThrough()
    const stdout = collectWrites()
    const stderr = collectWrites()
    const shutdown = new AbortController()
    const running = runProfileMcpStdio({
      gateway,
      createRequestId: () => 'mcp-signal-drain',
      stdin,
      stdout: stdout.stream,
      stderr: stderr.stream,
      shutdownSignal: shutdown.signal,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    stdin.write([
      jsonLine({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'eido-test', version: '1.0.0' },
        },
      }),
      jsonLine({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      jsonLine({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'profile.status', arguments: {} },
      }),
    ].join(''))
    await vi.waitFor(() => expect(service.status).toHaveBeenCalledTimes(1))

    shutdown.abort()
    await new Promise<void>((resolve) => setImmediate(resolve))
    expect(service.close).not.toHaveBeenCalled()
    resolveStatus?.({ ok: true, value: readyStatus() })
    await running

    expect(events).toEqual(['invoke', 'service-close'])
    expect(stdout.text()).toContain('mcp-signal-drain')
    expect(stderr.text()).toBe('')
  })

  it('settles a failed protocol output without hanging shutdown', async () => {
    const openService = vi.fn(async () => {
      throw new Error('Protocol-only initialization must not open Profile authority')
    })
    const gateway = createProfileGatewaySession({ openService })
    const stdin = new PassThrough()
    const stdout = new Writable({
      write(_chunk, _encoding, callback) {
        callback(new Error('synthetic output failure'))
      },
    })
    const stderr = collectWrites()
    const running = runProfileMcpStdio({
      gateway,
      createRequestId: () => 'mcp-output-failure',
      stdin,
      stdout,
      stderr: stderr.stream,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    stdin.write(jsonLine({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2025-11-25',
        capabilities: {},
        clientInfo: { name: 'eido-test', version: '1.0.0' },
      },
    }))

    await expect(running).rejects.toThrow('Profile MCP stdio session failed')
    expect(openService).not.toHaveBeenCalled()
    expect(stderr.text()).not.toContain('synthetic output failure')
  })

  it('keeps one target failure listener while concurrent protocol output is slow', async () => {
    const gateway = createProfileGatewaySession({
      openService: vi.fn(async () => ({ ok: true as const, value: createUnusedService() })),
    })
    const stdin = new PassThrough()
    const stdout = collectSlowWrites()
    const stderr = collectWrites()
    const running = runProfileMcpStdio({
      gateway,
      createRequestId: () => 'mcp-slow-output',
      stdin,
      stdout: stdout.stream,
      stderr: stderr.stream,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    stdin.end('not-json\n'.repeat(12))
    await vi.waitFor(() => {
      expect(stderr.text().trimEnd().split('\n')).toHaveLength(12)
    })
    expect(stdout.stream.listenerCount('error')).toBe(1)

    stdout.release()
    await running
    expect(stdout.stream.listenerCount('error')).toBe(0)
  })

  it('keeps stdout protocol-only while malformed input recovers and cancellation wins admission', async () => {
    const secret = 'do-not-leak-profile-path-or-secret'
    const openService = vi.fn(async () => {
      throw new Error('Cancelled and protocol-only traffic acquired Profile authority')
    })
    const gateway = createProfileGatewaySession({ openService })
    const stdin = new PassThrough()
    const stdout = collectWrites()
    const stderr = collectWrites()
    const running = runProfileMcpStdio({
      gateway,
      createRequestId: () => 'mcp-cancelled-in-protocol',
      stdin,
      stdout: stdout.stream,
      stderr: stderr.stream,
    })
    await new Promise<void>((resolve) => setImmediate(resolve))

    stdin.end(Buffer.concat([
      Buffer.from(jsonLine({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-11-25',
          capabilities: {},
          clientInfo: { name: 'eido-test', version: '1.0.0' },
        },
      })),
      Buffer.from(jsonLine({ jsonrpc: '2.0', method: 'notifications/initialized' })),
      Buffer.from(jsonLine({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'profile.status', arguments: {} },
      })),
      Buffer.from(jsonLine({
        jsonrpc: '2.0',
        method: 'notifications/cancelled',
        params: { requestId: 2, reason: 'cancel-before-admission' },
      })),
      Buffer.from(jsonLine({ jsonrpc: '2.0', id: 3, method: 'resources/list' })),
      Buffer.from(jsonLine({ jsonrpc: '2.0', id: 4, method: 'prompts/list' })),
      Buffer.from(`\n{"secret":"${secret}"}\n`),
      Buffer.alloc((512 * 1024) + 1, 0x78),
      Buffer.from('\n'),
      Buffer.from([0xff, 0x0a]),
      Buffer.from('{"jsonrpc":'),
    ]))
    await running

    expect(openService).not.toHaveBeenCalled()
    const protocol = stdout.text()
    expect(protocol[0]).toBe('{')
    const lines = protocol.trimEnd().split('\n')
    expect(lines.every((line) => line.length > 0)).toBe(true)
    const messages = lines.map((line) => JSON.parse(line) as {
      id?: number
      error?: { code: number }
    })
    expect(messages.some(({ id }) => id === 2)).toBe(false)
    expect(messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 1 }),
      expect.objectContaining({
        id: 3,
        error: expect.objectContaining({ code: ErrorCode.MethodNotFound }),
      }),
      expect.objectContaining({
        id: 4,
        error: expect.objectContaining({ code: ErrorCode.MethodNotFound }),
      }),
    ]))
    const uncorrelatedCodes = messages
      .filter(({ id }) => id === undefined)
      .map(({ error }) => error?.code)
    expect(uncorrelatedCodes).toEqual([
      ErrorCode.ParseError,
      ErrorCode.InvalidRequest,
      ErrorCode.InvalidRequest,
      ErrorCode.ParseError,
      ErrorCode.ParseError,
    ])
    expect(stderr.text()).not.toContain(secret)
    expect(stderr.text()).toMatch(/Eido Profile MCP failed \(-32(?:600|700)\)\./)
  })
})

async function readAll(input: AsyncIterable<Buffer | string>): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of input) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function collectWrites(): Readonly<{ stream: Writable; text(): string }> {
  const chunks: Buffer[] = []
  return {
    stream: new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        callback()
      },
    }),
    text: () => Buffer.concat(chunks).toString('utf8'),
  }
}

function collectSlowWrites(): Readonly<{
  stream: Writable
  text(): string
  release(): void
}> {
  const chunks: Buffer[] = []
  const pending: Array<(error?: Error | null) => void> = []
  let releasing = false
  return {
    stream: new Writable({
      highWaterMark: 1,
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk))
        if (releasing) callback()
        else pending.push(callback)
      },
    }),
    text: () => Buffer.concat(chunks).toString('utf8'),
    release() {
      releasing = true
      while (pending.length > 0) pending.shift()?.()
    },
  }
}

function createUnusedService(): ProfileGatewaySessionService {
  return Object.freeze({
    status: vi.fn(),
    capabilities: vi.fn(),
    query: vi.fn(),
    applyAgentCommandBatch: vi.fn(),
    close: vi.fn(async () => undefined),
  })
}

function jsonLine(candidate: unknown): string {
  return `${JSON.stringify(candidate)}\n`
}

function readyStatus() {
  return {
    profileId: 'profile-mcp-stdio',
    revision: 4,
    versions: PROFILE_CONTRACT_VERSIONS,
    state: 'ready' as const,
    owner: { mode: 'mutable' as const, route: 'exclusive-headless-owner' as const },
    dirty: 'clean' as const,
    compatibility: {
      read: 'supported' as const,
      write: 'supported' as const,
      source: 'friends-alpha' as const,
    },
  } as const
}
