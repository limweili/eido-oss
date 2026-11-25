import { Readable, Transform, Writable } from 'node:stream'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { ErrorCode, JSONRPCMessageSchema } from '@modelcontextprotocol/sdk/types.js'
import type { ProfileGatewaySession } from '../src/persistence/profileAgentGateway'
import {
  createProfileMcpHandlerTracker,
  createProfileMcpServer,
  PROFILE_MCP_LIMITS,
} from './profileMcpServer'

export type ProfileMcpProtocolFailureCode =
  | ErrorCode.ParseError
  | ErrorCode.InvalidRequest

export type BoundedProfileMcpInputOptions = Readonly<{
  maxLineBytes?: number
  onProtocolFailure?(code: ProfileMcpProtocolFailureCode): void
}>

export type ProfileMcpStdioOptions = Readonly<{
  gateway: ProfileGatewaySession
  createRequestId(): string
  stdin: Readable
  stdout: Writable
  stderr: Writable
  shutdownSignal?: AbortSignal
}>

export async function runProfileMcpStdio(options: ProfileMcpStdioOptions): Promise<void> {
  const handlers = createProfileMcpHandlerTracker()
  const diagnosticWrites = new Set<Promise<void>>()
  let terminalFailure: unknown
  let signalTerminal: (() => void) | undefined
  const terminal = new Promise<void>((resolve) => { signalTerminal = resolve })
  let input: Transform
  let inputStopped = false
  const requestShutdown = (failure?: unknown, endInput = true): void => {
    if (failure !== undefined && terminalFailure === undefined) terminalFailure = failure
    if (!inputStopped) {
      inputStopped = true
      options.stdin.unpipe(input)
      options.stdin.pause()
      if (endInput && !input.destroyed && !input.writableEnded) input.end()
    }
    signalTerminal?.()
  }
  const protocolOutput = new TrackedProtocolOutput(options.stdout)
  const diagnosticOutput = new SharedOutputWriter(options.stderr)

  let transport: StdioServerTransport
  input = createBoundedProfileMcpInput({
    onProtocolFailure(code) {
      void transport.send({
        jsonrpc: '2.0',
        error: {
          code,
          message: code === ErrorCode.ParseError ? 'Parse error' : 'Invalid Request',
        },
      }).catch((error) => requestShutdown(error))
      track(diagnosticWrites, writeDiagnostic(diagnosticOutput, String(code)))
    },
  })
  transport = new StdioServerTransport(input, protocolOutput)
  const server = createProfileMcpServer({
    gateway: options.gateway,
    createRequestId: options.createRequestId,
    handlerTracker: handlers,
  })

  server.onerror = () => {
    track(diagnosticWrites, writeDiagnostic(diagnosticOutput, 'internal'))
    requestShutdown(new Error('Profile MCP protocol failed'))
  }
  const onInputEnd = (): void => requestShutdown(undefined, false)
  const onInputError = (): void => requestShutdown(
    new Error('Profile MCP input failed'),
    false,
  )
  const onStdinError = (): void => requestShutdown(new Error('Profile MCP stdin failed'))
  const onStdoutError = (): void => requestShutdown(new Error('Profile MCP stdout failed'))
  input.once('end', onInputEnd)
  input.once('error', onInputError)
  options.stdin.once('error', onStdinError)
  protocolOutput.once('error', onStdoutError)
  const onShutdownSignal = (): void => requestShutdown()
  options.shutdownSignal?.addEventListener('abort', onShutdownSignal, { once: true })

  try {
    await server.connect(transport)
    if (options.shutdownSignal?.aborted) requestShutdown()
    if (!inputStopped) options.stdin.pipe(input)
    await terminal
  } catch (error) {
    terminalFailure ??= error
  }

  requestShutdown(terminalFailure, false)
  await admissionBarrier()

  let shutdownFailure = terminalFailure
  const attempt = async (action: () => Promise<void>): Promise<void> => {
    try {
      await action()
    } catch (error) {
      shutdownFailure ??= error
    }
  }
  await attempt(() => options.gateway.close())
  await attempt(() => handlers.drain())
  await admissionBarrier()
  await attempt(() => protocolOutput.drain())
  await attempt(() => drainTracked(diagnosticWrites))
  await attempt(() => diagnosticOutput.drain())
  await attempt(() => server.close())
  options.shutdownSignal?.removeEventListener('abort', onShutdownSignal)
  input.off('end', onInputEnd)
  input.off('error', onInputError)
  options.stdin.off('error', onStdinError)
  protocolOutput.off('error', onStdoutError)
  protocolOutput.closeTargetListener()
  diagnosticOutput.closeTargetListener()
  input.destroy()

  if (shutdownFailure !== undefined) throw new Error('Profile MCP stdio session failed')
}

export function createBoundedProfileMcpInput(
  options: BoundedProfileMcpInputOptions = {},
): Transform {
  const maxLineBytes = options.maxLineBytes ?? PROFILE_MCP_LIMITS.maxInputLineBytes
  if (!Number.isSafeInteger(maxLineBytes) || maxLineBytes < 2) {
    throw new Error('Profile MCP input line bound is invalid')
  }
  let pending: Buffer[] = []
  let pendingBytes = 0
  let discardingOversizedLine = false

  const report = (code: ProfileMcpProtocolFailureCode): void => {
    options.onProtocolFailure?.(code)
  }

  return new Transform({
    transform(chunk: Buffer | string, encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding)
      let offset = 0
      while (offset < bytes.length) {
        const newline = bytes.indexOf(0x0a, offset)
        if (discardingOversizedLine) {
          if (newline === -1) break
          discardingOversizedLine = false
          report(ErrorCode.InvalidRequest)
          offset = newline + 1
          continue
        }
        const end = newline === -1 ? bytes.length : newline + 1
        const segment = bytes.subarray(offset, end)
        if (pendingBytes + segment.byteLength > maxLineBytes) {
          pending = []
          pendingBytes = 0
          if (newline === -1) {
            discardingOversizedLine = true
            break
          }
          report(ErrorCode.InvalidRequest)
          offset = end
          continue
        }
        if (newline === -1) {
          if (segment.byteLength > 0) pending.push(Buffer.from(segment))
          pendingBytes += segment.byteLength
          break
        }
        const line = pendingBytes === 0
          ? segment
          : Buffer.concat([...pending, segment], pendingBytes + segment.byteLength)
        pending = []
        pendingBytes = 0
        const failure = protocolFailureForLine(line)
        if (failure === undefined) this.push(line)
        else report(failure)
        offset = end
      }
      callback()
    },
    flush(callback) {
      if (discardingOversizedLine) report(ErrorCode.InvalidRequest)
      else if (pendingBytes > 0) report(ErrorCode.ParseError)
      pending = []
      pendingBytes = 0
      callback()
    },
  })
}

function protocolFailureForLine(line: Buffer): ProfileMcpProtocolFailureCode | undefined {
  let payload = line.subarray(0, line.byteLength - 1)
  if (payload[payload.byteLength - 1] === 0x0d) payload = payload.subarray(0, -1)
  let text: string
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(payload)
  } catch {
    return ErrorCode.ParseError
  }
  let candidate: unknown
  try {
    candidate = JSON.parse(text) as unknown
  } catch {
    return ErrorCode.ParseError
  }
  return JSONRPCMessageSchema.safeParse(candidate).success
    ? undefined
    : ErrorCode.InvalidRequest
}

class TrackedProtocolOutput extends Writable {
  readonly #writer: SharedOutputWriter
  #failed = false

  constructor(target: Writable) {
    super()
    this.#writer = new SharedOutputWriter(target, (failure) => {
      if (this.#failed) return
      this.#failed = true
      this.emit('error', failure)
    })
  }

  override write(
    chunk: Uint8Array | string,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean {
    const encoding = typeof encodingOrCallback === 'string' ? encodingOrCallback : 'utf8'
    const completed = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback
    const writing = this.#writer.write(chunk, encoding)
    void writing.then(
      () => completed?.(),
      (error) => {
        const failure = error instanceof Error ? error : new Error('Protocol output failed')
        completed?.(failure)
      },
    )
    // SDK 1.29 waits only for `drain` when write returns false and cannot observe
    // callback failure. Completion/backpressure ownership stays in #active instead.
    return true
  }

  drain(): Promise<void> {
    return this.#writer.drain()
  }

  closeTargetListener(): void {
    this.#writer.closeTargetListener()
  }
}

type PendingOutputWrite = Readonly<{ fail(failure: Error): void }>

class SharedOutputWriter {
  readonly #target: Writable
  readonly #onFailure?: (failure: Error) => void
  readonly #active = new Set<Promise<void>>()
  readonly #pending = new Set<PendingOutputWrite>()
  #failure: Error | undefined
  readonly #onTargetError = (failure: Error): void => this.#recordFailure(failure)

  constructor(target: Writable, onFailure?: (failure: Error) => void) {
    this.#target = target
    this.#onFailure = onFailure
    target.on('error', this.#onTargetError)
  }

  write(chunk: Uint8Array | string, encoding: BufferEncoding): Promise<void> {
    if (this.#failure) return Promise.reject(this.#failure)
    let pending: PendingOutputWrite
    const writing = new Promise<void>((resolve, reject) => {
      let settled = false
      const settle = (failure?: Error): void => {
        if (settled) return
        settled = true
        this.#pending.delete(pending)
        if (failure) reject(failure)
        else resolve()
      }
      pending = Object.freeze({ fail: settle })
      this.#pending.add(pending)
      try {
        this.#target.write(chunk, encoding, (failure) => {
          if (failure) this.#recordFailure(failure)
          else settle()
        })
      } catch (failure) {
        this.#recordFailure(failure)
      }
    })
    this.#active.add(writing)
    void writing.then(
      () => this.#active.delete(writing),
      () => this.#active.delete(writing),
    )
    return writing
  }

  async drain(): Promise<void> {
    while (this.#active.size > 0) await Promise.allSettled([...this.#active])
  }

  closeTargetListener(): void {
    this.#target.off('error', this.#onTargetError)
  }

  #recordFailure(candidate: unknown): void {
    if (!this.#failure) {
      this.#failure = candidate instanceof Error
        ? candidate
        : new Error('Output failed')
      this.#onFailure?.(this.#failure)
    }
    for (const pending of [...this.#pending]) pending.fail(this.#failure)
  }
}

async function writeDiagnostic(target: SharedOutputWriter, code: string): Promise<void> {
  const message = `Eido Profile MCP failed (${code}).\n`
  const diagnostic = Buffer.byteLength(message, 'utf8') <= PROFILE_MCP_LIMITS.maxDiagnosticBytes
    ? message
    : 'Eido Profile MCP failed.\n'
  await target.write(diagnostic, 'utf8').catch(() => undefined)
}

function track(active: Set<Promise<void>>, work: Promise<void>): void {
  active.add(work)
  void work.then(
    () => active.delete(work),
    () => active.delete(work),
  )
}

async function drainTracked(active: Set<Promise<void>>): Promise<void> {
  while (active.size > 0) await Promise.allSettled([...active])
}

function admissionBarrier(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}
