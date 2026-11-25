import { EventEmitter } from 'node:events'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { PassThrough } from 'node:stream'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { describe, expect, it, vi, type Mock } from 'vitest'
import {
  AI_HARNESS_BRIDGE_VERSION,
  createAiHarnessRunRequest,
  type AiHarnessCancelRequest,
} from './aiHarnessBridgeContract'
import { createInstalledAiHarnessMainSession } from './aiHarnessMainSession'

type FakeChild = Omit<ChildProcessWithoutNullStreams, 'kill'> & {
  stdin: PassThrough
  stdout: PassThrough
  stderr: PassThrough
  kill: Mock<(signal?: NodeJS.Signals | number) => boolean>
  emit(event: string, ...args: unknown[]): boolean
  setExitCode(code: number | null): void
}

function fakeChild(): FakeChild {
  const emitter = new EventEmitter()
  let exitCode: number | null = null
  Object.assign(emitter, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    killed: false,
    kill: vi.fn(() => true),
    setExitCode(code: number | null) {
      exitCode = code
    },
  })
  Object.defineProperty(emitter, 'exitCode', { get: () => exitCode })
  return emitter as FakeChild
}

function trustedRenderer() {
  const mainFrame = { url: 'eido://app/' }
  const target = {
    mainFrame,
    send: vi.fn(),
  }
  const event = { sender: target, senderFrame: mainFrame }
  return { event, target }
}

function complete(child: FakeChild, line: unknown, code = 0): void {
  queueMicrotask(() => {
    child.stdout.write(`${JSON.stringify(line)}\n`)
    child.setExitCode(code)
    child.emit('close', code)
  })
}

function spawnWhenPathIncludes(expectedBin: string, output: unknown) {
  const child = fakeChild()
  return vi.fn((_command: string, _args: string[], options: Parameters<typeof spawn>[2]) => {
    if (options?.env?.PATH?.split(path.delimiter).includes(expectedBin)) {
      complete(child, output)
    } else {
      queueMicrotask(() => {
        child.emit('error', Object.assign(new Error('command not found'), { code: 'ENOENT' }))
      })
    }
    return child
  })
}

describe('installed AI harness main session', () => {
  it.each([
    ['claude-code', 'sonnet', ['--model', 'sonnet', '--effort', 'medium'], {
      type: 'result',
      result: 'complete',
    }],
    ['codex', 'default', ['--config', 'model_reasoning_effort="medium"', '-'], {
      type: 'item.completed',
      item: { type: 'agent_message', text: 'complete' },
    }],
    ['antigravity', 'gemini-3.7-flash', ['--print=', '--input-format', 'stream-json', '--output-format', 'stream-json', '--sandbox', '--model', 'gemini-3.7-flash', '--effort', 'medium'], {
      event: 'result',
      result: { status: 'SUCCESS', response: 'complete' },
    }],
  ] as const)(
    'keeps the %s prompt on stdin and uses its documented non-interactive arguments',
    async (harness, model, expectedArgs, output) => {
      const child = fakeChild()
      let args: string[] = []
      let stdin = ''
      child.stdin.setEncoding('utf8')
      child.stdin.on('data', (chunk: string) => {
        stdin += chunk
      })
      const spawnProcess = vi.fn((_command: string, candidateArgs: string[]) => {
        args = candidateArgs
        complete(child, output)
        return child
      })
      const { event, target } = trustedRenderer()
      const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
      const request = createAiHarnessRunRequest(harness, 'tool', model, 'medium', 'private prompt', [])

      await expect(session.route(event, [request])).resolves.toEqual({ ok: true, text: 'complete' })

      expect(args).toEqual(expect.arrayContaining([...expectedArgs]))
      if (harness === 'antigravity') {
        expect(args).toContain('--sandbox')
      } else {
        expect(args).not.toContain('--sandbox')
      }
      expect(args).not.toContain('private prompt')
      expect(stdin).toBe(harness === 'antigravity'
        ? `${JSON.stringify({ event: 'user', message: { role: 'user', content: 'private prompt' } })}\n`
        : 'private prompt')
    },
  )

  it.each([
    ['xhigh', 'max'],
    ['high', 'high'],
    ['medium', 'medium'],
    ['low', 'low'],
    ['minimal', 'low'],
    ['none', 'low'],
  ] as const)('maps Claude reasoning %s to supported CLI effort %s', async (effort, expected) => {
    const child = fakeChild()
    let args: string[] = []
    const spawnProcess = vi.fn((_command: string, candidateArgs: string[]) => {
      args = candidateArgs
      complete(child, { type: 'result', result: 'complete' })
      return child
    })
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
    const request = createAiHarnessRunRequest('claude-code', 'claude', 'sonnet', effort, 'Prompt', [])

    await expect(session.route(event, [request])).resolves.toEqual({ ok: true, text: 'complete' })
    expect(args).toEqual(expect.arrayContaining(['--effort', expected]))
  })

  it.each([
    ['gemini-3.7-flash', 'low', 'low'],
    ['gemini-3.7-flash', 'medium', 'medium'],
    ['gemini-3.7-flash', 'high', 'high'],
    ['gemini-3.7-flash', 'xhigh', 'high'],
    ['gemini-3.7-flash', 'minimal', 'low'],
    ['gemini-3.7-flash', 'none', 'low'],
    ['gemini-3.1-pro', 'medium', 'high'],
  ] as const)('maps Antigravity %s reasoning %s to supported CLI effort %s', async (model, effort, expected) => {
    const child = fakeChild()
    let args: string[] = []
    const spawnProcess = vi.fn((_command: string, candidateArgs: string[]) => {
      args = candidateArgs
      complete(child, { event: 'result', result: { status: 'SUCCESS', response: 'complete' } })
      return child
    })
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
    const request = createAiHarnessRunRequest('antigravity', 'agy', model, effort, 'Prompt', [])

    await expect(session.route(event, [request])).resolves.toEqual({ ok: true, text: 'complete' })
    expect(args).toEqual(['--print=', '--input-format', 'stream-json', '--output-format', 'stream-json', '--sandbox', '--model', model, '--effort', expected])
  })

  it('crosses a real child-process stdin and JSONL output boundary', async () => {
    let requestedCommand = ''
    let requestedArgs: string[] = []
    const spawnProcess = (command: string, args: string[], options: Parameters<typeof spawn>[2]) => {
      requestedCommand = command
      requestedArgs = args
      const fixture = [
        "let input = ''",
        "process.stdin.setEncoding('utf8')",
        "process.stdin.on('data', (chunk) => { input += chunk })",
        "process.stdin.on('end', () => { process.stdout.write(JSON.stringify({ type: 'result', result: input }) + '\\n') })",
      ].join(';')
      return spawn(process.execPath, ['-e', fixture], options) as ChildProcessWithoutNullStreams
    }
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
    const request = createAiHarnessRunRequest(
      'claude-code',
      'claude',
      'sonnet',
      'medium',
      'private process prompt',
      [],
    )

    await expect(session.route(event, [request])).resolves.toEqual({ ok: true, text: 'private process prompt' })
    expect(requestedCommand).toBe('claude')
    expect(requestedArgs).toEqual(expect.arrayContaining(['--model', 'sonnet', '--effort', 'medium']))
    expect(requestedArgs).not.toContain('private process prompt')
  })

  it('retains cancellation while assets are still being prepared', async () => {
    let finishPreparation: ((value: { imagePaths: never[]; allPaths: never[] }) => void) | undefined
    const prepareHarnessAssets = vi.fn(() => new Promise<{ imagePaths: never[]; allPaths: never[] }>((resolve) => {
      finishPreparation = resolve
    }))
    const spawnProcess = vi.fn()
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess, prepareHarnessAssets })
    const request = createAiHarnessRunRequest('claude-code', 'claude', 'sonnet', 'medium', 'Prompt', [])

    const running = session.route(event, [request])
    await vi.waitFor(() => expect(prepareHarnessAssets).toHaveBeenCalled())
    const cancel: AiHarnessCancelRequest = Object.freeze({
      version: AI_HARNESS_BRIDGE_VERSION,
      requestId: request.requestId,
      operation: 'cancel',
    })
    await expect(session.route(event, [cancel])).resolves.toEqual({ canceled: true })
    finishPreparation?.({ imagePaths: [], allPaths: [] })

    await expect(running).resolves.toEqual({ ok: false, error: 'canceled' })
    expect(spawnProcess).not.toHaveBeenCalled()
  })

  it('reports a genuinely missing executable as unavailable', async () => {
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target })
    const request = createAiHarnessRunRequest(
      'codex',
      `eido-missing-harness-${process.pid}`,
      'default',
      'medium',
      'Prompt',
      [],
    )

    await expect(session.route(event, [request])).resolves.toEqual({ ok: false, error: 'unavailable' })
  })

  it.skipIf(process.platform === 'win32')('finds a user-local harness outside a Finder-style PATH', async () => {
    const previousHome = process.env.HOME
    const previousPath = process.env.PATH
    const home = await mkdtemp(path.join(os.tmpdir(), 'eido-harness-home-'))
    const bin = path.join(home, '.local', 'bin')
    const command = `eido-user-local-harness-${process.pid}`
    const executable = path.join(bin, command)
    await mkdir(bin, { recursive: true })
    await writeFile(executable, [
      '#!/bin/sh',
      'cat >/dev/null',
      `printf '%s\\n' '${JSON.stringify({
        event: 'result',
        result: { status: 'SUCCESS', response: 'complete' },
      })}'`,
    ].join('\n'))
    await chmod(executable, 0o700)

    try {
      process.env.HOME = home
      process.env.PATH = '/usr/bin:/bin:/usr/sbin:/sbin'
      const { event, target } = trustedRenderer()
      const session = createInstalledAiHarnessMainSession({ target })
      const request = createAiHarnessRunRequest(
        'antigravity',
        command,
        'gemini-3.7-flash',
        'medium',
        'Prompt',
        [],
      )

      await expect(session.route(event, [request])).resolves.toEqual({ ok: true, text: 'complete' })
    } finally {
      if (previousHome === undefined) delete process.env.HOME
      else process.env.HOME = previousHome
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
      await rm(home, { recursive: true, force: true })
    }
  })

  it.each([
    [
      'Antigravity',
      'antigravity',
      'agy',
      'gemini-3.7-flash',
      ['agy', 'bin'],
      { event: 'result', result: { status: 'SUCCESS', response: 'complete' } },
    ],
    [
      'Codex',
      'codex',
      'codex',
      'default',
      ['Programs', 'OpenAI', 'Codex', 'bin'],
      { type: 'item.completed', item: { type: 'agent_message', text: 'complete' } },
    ],
  ] as const)(
    'finds %s in its Windows user-local installer directory',
    async (_name, harness, command, model, binSegments, output) => {
      const previousLocalAppData = process.env.LOCALAPPDATA
      const localAppData = path.join(os.tmpdir(), `eido-${harness}-local-app-data-${process.pid}`)
      const expectedBin = path.join(localAppData, ...binSegments)
      const spawnProcess = spawnWhenPathIncludes(expectedBin, output)

      try {
        process.env.LOCALAPPDATA = localAppData
        const { event, target } = trustedRenderer()
        const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
        const request = createAiHarnessRunRequest(
          harness,
          command,
          model,
          'medium',
          'Prompt',
          [],
        )

        await expect(session.route(event, [request])).resolves.toEqual({ ok: true, text: 'complete' })
      } finally {
        if (previousLocalAppData === undefined) delete process.env.LOCALAPPDATA
        else process.env.LOCALAPPDATA = previousLocalAppData
      }
    },
  )

  it('finds Claude Code in the Windows native installer directory', async () => {
    const previousPath = process.env.PATH
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform')!
    const expectedBin = path.join(os.homedir(), '.local', 'bin')
    const spawnProcess = spawnWhenPathIncludes(expectedBin, { type: 'result', result: 'complete' })

    try {
      Object.defineProperty(process, 'platform', { ...platformDescriptor, value: 'win32' })
      process.env.PATH = path.join(os.tmpdir(), 'windows-system32')
      const { event, target } = trustedRenderer()
      const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
      const request = createAiHarnessRunRequest(
        'claude-code',
        'claude',
        'sonnet',
        'medium',
        'Prompt',
        [],
      )

      await expect(session.route(event, [request])).resolves.toEqual({ ok: true, text: 'complete' })
    } finally {
      Object.defineProperty(process, 'platform', platformDescriptor)
      if (previousPath === undefined) delete process.env.PATH
      else process.env.PATH = previousPath
    }
  })

  it('reports unexpected spawn errors as failed rather than canceled', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        child.emit('error', Object.assign(new Error('permission denied'), { code: 'EACCES' }))
      })
      return child
    })
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
    const request = createAiHarnessRunRequest('codex', 'codex', 'default', 'medium', 'Prompt', [])

    await expect(session.route(event, [request])).resolves.toEqual({ ok: false, error: 'failed' })
  })

  it('treats exit-zero unrecognized output as incompatible output drift', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => {
      complete(child, { type: 'future-format', text: 'not recognized' })
      return child
    })
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
    const request = createAiHarnessRunRequest('antigravity', 'agy', 'gemini-3.7-flash', 'medium', 'Prompt', [])

    await expect(session.route(event, [request])).resolves.toEqual({ ok: false, error: 'incompatible-output' })
  })

  it('completes a partial stream from its terminal result', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } },
        })}\n`)
        child.stdout.write(`${JSON.stringify({ type: 'result', result: 'partial answer' })}\n`)
        child.setExitCode(0)
        child.emit('close', 0)
      })
      return child
    })
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
    const request = createAiHarnessRunRequest('claude-code', 'claude', 'sonnet', 'medium', 'Prompt', [])

    await expect(session.route(event, [request])).resolves.toEqual({ ok: true, text: 'partial answer' })
    expect(target.send.mock.calls.map((call) => call[1].text)).toEqual(['partial', ' answer'])
  })

  it('fails closed when a terminal result diverges from streamed text', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          type: 'stream_event',
          event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'wrong' } },
        })}\n`)
        child.stdout.write(`${JSON.stringify({ type: 'result', result: 'complete answer' })}\n`)
        child.setExitCode(0)
        child.emit('close', 0)
      })
      return child
    })
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
    const request = createAiHarnessRunRequest('claude-code', 'claude', 'sonnet', 'medium', 'Prompt', [])

    await expect(session.route(event, [request])).resolves.toEqual({
      ok: false,
      error: 'incompatible-output',
    })
  })

  it('streams only Antigravity agent_response steps', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({
          event: 'step_update',
          step_update: { step_type: 'user_input', text_delta: 'private prompt' },
        })}\n`)
        child.stdout.write(`${JSON.stringify({
          event: 'step_update',
          step_update: { step_type: 'tool', text_delta: 'tool output', tool_info: { name: 'run_command' } },
        })}\n`)
        child.stdout.write(`${JSON.stringify({
          event: 'step_update',
          step_update: { step_type: 'agent_response', text_delta: 'safe answer' },
        })}\n`)
        child.stdout.write(`${JSON.stringify({
          event: 'result',
          result: { status: 'SUCCESS', response: 'safe answer' },
        })}\n`)
        child.setExitCode(0)
        child.emit('close', 0)
      })
      return child
    })
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
    const request = createAiHarnessRunRequest('antigravity', 'agy', 'gemini-3.7-flash', 'medium', 'private prompt', [])

    await expect(session.route(event, [request])).resolves.toEqual({ ok: true, text: 'safe answer' })
    expect(target.send.mock.calls.map((call) => call[1].text)).toEqual(['safe answer'])
  })

  it('ignores user-role message events instead of echoing the prompt', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        child.stdout.write(`${JSON.stringify({ type: 'message', role: 'user', content: 'private prompt' })}\n`)
        child.stdout.write(`${JSON.stringify({ type: 'message', role: 'model', content: 'safe answer' })}\n`)
        child.setExitCode(0)
        child.emit('close', 0)
      })
      return child
    })
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
    const request = createAiHarnessRunRequest('antigravity', 'agy', 'gemini-3.7-flash', 'medium', 'private prompt', [])

    await expect(session.route(event, [request])).resolves.toEqual({ ok: true, text: 'safe answer' })
    expect(target.send).toHaveBeenCalledTimes(1)
    expect(target.send).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ text: 'safe answer' }),
    )
  })

  it('reports a nonzero harness exit as failed', async () => {
    const child = fakeChild()
    const spawnProcess = vi.fn(() => {
      complete(child, { type: 'result', result: 'ignored' }, 2)
      return child
    })
    const { event, target } = trustedRenderer()
    const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
    const request = createAiHarnessRunRequest('claude-code', 'claude', 'sonnet', 'medium', 'Prompt', [])

    await expect(session.route(event, [request])).resolves.toEqual({ ok: false, error: 'failed' })
  })

  it('joins a resistant harness through forced termination before close resolves', async () => {
    vi.useFakeTimers()
    try {
      const child = fakeChild()
      child.kill.mockImplementation((signal?: NodeJS.Signals | number) => {
        if (signal === 'SIGKILL') {
          child.setExitCode(137)
          child.emit('close', 137)
        }
        return true
      })
      const spawnProcess = vi.fn(() => child)
      const { event, target } = trustedRenderer()
      const session = createInstalledAiHarnessMainSession({ target, spawnProcess })
      const request = createAiHarnessRunRequest('codex', 'codex', 'default', 'medium', 'Prompt', [])

      const running = session.route(event, [request])
      await Promise.resolve()
      await Promise.resolve()
      const closing = session.close()
      expect(child.kill).toHaveBeenCalledWith('SIGTERM')

      await vi.advanceTimersByTimeAsync(1_500)
      await expect(closing).resolves.toBeUndefined()
      await expect(running).resolves.toEqual({ ok: false, error: 'canceled' })
      expect(child.kill).toHaveBeenCalledWith('SIGKILL')
    } finally {
      vi.useRealTimers()
    }
  })
})
