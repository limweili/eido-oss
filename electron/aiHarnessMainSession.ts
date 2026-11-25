import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type {
  AiHarnessAsset,
  AiHarnessEvent,
  AiHarnessRunRequest,
  AiHarnessRunResult,
} from './aiHarnessBridgeContract'
import {
  AI_HARNESS_EVENT_CHANNEL,
} from './aiHarnessBridgeContract'
import {
  assertTrustedAiHarnessRequest,
  type RendererBridgeEvent,
  type RendererBridgeWebContents,
} from './security'

type RendererTarget = RendererBridgeWebContents & {
  send(channel: typeof AI_HARNESS_EVENT_CHANNEL, payload: AiHarnessEvent): void
}

type ActiveRun = Readonly<{
  cancel(): void
  settled: Promise<void>
}>

type PreparedAssets = Readonly<{
  directory?: string
  imagePaths: readonly string[]
  allPaths: readonly string[]
}>

type SpawnHarnessProcess = (
  command: string,
  args: string[],
  options: Readonly<{
    cwd: string
    env: NodeJS.ProcessEnv
    stdio: ['pipe', 'pipe', 'pipe']
    shell: false
    detached: boolean
  }>,
) => ChildProcessWithoutNullStreams

type PrepareHarnessAssets = (assets: readonly AiHarnessAsset[]) => Promise<PreparedAssets>

export type InstalledAiHarnessMainSession = Readonly<{
  route(event: RendererBridgeEvent, args: readonly unknown[]): Promise<AiHarnessRunResult | { canceled: true }>
  close(): Promise<void>
}>

export function createInstalledAiHarnessMainSession({
  target,
  spawnProcess = spawn as SpawnHarnessProcess,
  prepareHarnessAssets = prepareAssets,
}: Readonly<{
  target: RendererTarget
  spawnProcess?: SpawnHarnessProcess
  prepareHarnessAssets?: PrepareHarnessAssets
}>): InstalledAiHarnessMainSession {
  const active = new Map<string, ActiveRun>()

  return Object.freeze({
    async route(event, args) {
      const request = assertTrustedAiHarnessRequest(event, target, args)
      if (request.operation === 'cancel') {
        active.get(request.requestId)?.cancel()
        return { canceled: true }
      }
      if (active.has(request.requestId)) return { ok: false, error: 'failed' }
      return runHarness(request, target, active, spawnProcess, prepareHarnessAssets)
    },
    async close() {
      const runs = [...active.values()]
      for (const run of runs) run.cancel()
      if (runs.length === 0) return
      await Promise.race([
        Promise.allSettled(runs.map((run) => run.settled)).then(() => undefined),
        new Promise<never>((_resolve, reject) => {
          setTimeout(() => reject(new Error('AI harness shutdown timed out')), 4_000).unref()
        }),
      ])
    },
  })
}

async function runHarness(
  request: AiHarnessRunRequest,
  target: RendererTarget,
  active: Map<string, ActiveRun>,
  spawnProcess: SpawnHarnessProcess,
  prepareHarnessAssets: PrepareHarnessAssets,
): Promise<AiHarnessRunResult> {
  let temporaryDirectory: string | undefined
  let canceled = false
  let child: ChildProcessWithoutNullStreams | undefined
  let streamedText = ''
  let fallbackText = ''
  let markSettled: () => void = () => undefined
  const settled = new Promise<void>((resolve) => {
    markSettled = resolve
  })
  const terminate = () => {
    if (!child || child.exitCode !== null) return
    signalHarnessTree(child, 'SIGTERM')
    setTimeout(() => {
      if (child?.exitCode === null) signalHarnessTree(child, 'SIGKILL')
    }, 1500).unref()
  }
  const cancel = () => {
    canceled = true
    terminate()
  }
  // Register before the first await so an immediate renderer abort cannot be
  // lost while attachments are still being prepared.
  active.set(request.requestId, { cancel, settled })

  try {
    const prepared = await prepareHarnessAssets(request.assets)
    temporaryDirectory = prepared.directory
    if (canceled) return { ok: false, error: 'canceled' }
    child = spawnProcess(request.command, argsFor(request, prepared), {
      // Harnesses need the prompt and staged attachments, not Eido's own
      // installation or source tree as ambient workspace context.
      cwd: prepared.directory ?? os.tmpdir(),
      env: harnessEnvironment(),
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
      detached: process.platform !== 'win32',
    })
    // A process that fails before consuming stdin can close the pipe while the
    // ENOENT result is still travelling on the child itself.
    child.stdin.on('error', () => undefined)
    child.stdin.end(promptForHarness(request.harness, promptWithAssets(request.prompt, prepared)))

    let stdoutBuffer = ''
    const consumeLine = (line: string) => {
      const parsed = parseOutputLine(request.harness, line)
      if (!parsed) return
      if (parsed.fallback) fallbackText = parsed.fallback
      if (!parsed.delta) return
      const delta = parsed.delta.startsWith(streamedText)
        ? parsed.delta.slice(streamedText.length)
        : parsed.delta
      if (!delta) return
      streamedText += delta
      sendChunk(target, request.requestId, delta)
    }
    child.stdout.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''
      for (const line of lines) consumeLine(line)
    })
    child.stderr.resume()

    const exit = await new Promise<
      | { kind: 'exit'; code: number | null }
      | { kind: 'unavailable' }
    >((resolve, reject) => {
      child!.once('error', (error: NodeJS.ErrnoException) => {
        if (error.code === 'ENOENT') resolve({ kind: 'unavailable' })
        else reject(error)
      })
      child!.once('close', (code) => resolve({ kind: 'exit', code }))
    })
    if (stdoutBuffer.trim()) consumeLine(stdoutBuffer)
    if (canceled) return { ok: false, error: 'canceled' }
    if (exit.kind === 'unavailable') return { ok: false, error: 'unavailable' }
    if (exit.code !== 0) return { ok: false, error: 'failed' }
    if (fallbackText) {
      if (!fallbackText.startsWith(streamedText)) {
        return { ok: false, error: 'incompatible-output' }
      }
      const remainder = fallbackText.slice(streamedText.length)
      if (remainder) {
        streamedText = fallbackText
        sendChunk(target, request.requestId, remainder)
      }
    }
    if (!streamedText.trim()) return { ok: false, error: 'incompatible-output' }
    return { ok: true, text: streamedText }
  } catch {
    const wasCanceled = canceled
    terminate()
    return { ok: false, error: wasCanceled ? 'canceled' : 'failed' }
  } finally {
    active.delete(request.requestId)
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined)
    }
    markSettled()
  }
}

function argsFor(
  request: AiHarnessRunRequest,
  assets: PreparedAssets,
): string[] {
  const model = request.model.trim()
  switch (request.harness) {
    case 'claude-code':
      return [
        '-p',
        '--verbose',
        '--output-format', 'stream-json',
        '--include-partial-messages',
        '--no-session-persistence',
        '--permission-mode', 'dontAsk',
        ...(model && model !== 'default' ? ['--model', model] : []),
        ...claudeEffortArgs(request.reasoningEffort),
      ]
    case 'codex':
      return [
        'exec',
        '--json',
        '--ephemeral',
        '--skip-git-repo-check',
        '-s', 'read-only',
        ...(model && model !== 'default' ? ['-m', model] : []),
        ...codexEffortArgs(request.reasoningEffort),
        ...assets.imagePaths.flatMap((filePath) => ['-i', filePath]),
        '-',
      ]
    case 'antigravity':
      {
        const antigravityModel = antigravityModelFor(model)
        return [
          '--print=',
          '--input-format', 'stream-json',
          '--output-format', 'stream-json',
          '--sandbox',
          ...(antigravityModel && antigravityModel !== 'default' ? ['--model', antigravityModel] : []),
          ...antigravityEffortArgs(request.reasoningEffort, antigravityModel),
        ]
      }
  }
}

function claudeEffortArgs(effort: AiHarnessRunRequest['reasoningEffort']): string[] {
  const supported = effort === 'xhigh'
    ? 'max'
    : effort === 'minimal' || effort === 'none'
      ? 'low'
      : effort
  return ['--effort', supported]
}

function codexEffortArgs(effort: AiHarnessRunRequest['reasoningEffort']): string[] {
  return ['--config', `model_reasoning_effort=${JSON.stringify(effort)}`]
}

function antigravityModelFor(model: string): string {
  // These aliases were shipped by the previous Eido mapping. Keep old saved
  // Ideas runnable while new Settings entries use the current AGY ids.
  if (model === 'auto' || model === 'flash') return 'gemini-3.7-flash'
  if (model === 'pro') return 'gemini-3.1-pro'
  return model
}

function antigravityEffortArgs(
  effort: AiHarnessRunRequest['reasoningEffort'],
  model: string,
): string[] {
  // AGY accepts low/medium/high. Pro has no medium rung, so a legacy or
  // programmatic medium choice steps up to high before it reaches the CLI.
  const normalized = effort === 'xhigh'
    ? 'high'
    : effort === 'minimal' || effort === 'none'
      ? 'low'
      : effort
  const supported = model === 'gemini-3.1-pro' && normalized === 'medium' ? 'high' : normalized
  return ['--effort', supported]
}

async function prepareAssets(assets: readonly AiHarnessAsset[]): Promise<PreparedAssets> {
  if (assets.length === 0) return { imagePaths: [], allPaths: [] }
  const directory = await mkdtemp(path.join(os.tmpdir(), 'eido-ai-'))
  const allPaths: string[] = []
  const imagePaths: string[] = []
  try {
    for (const [index, asset] of assets.entries()) {
      const filePath = path.join(directory, `${index}-${safeAssetName(asset)}`)
      await writeFile(filePath, decodeDataUrl(asset.dataUrl))
      allPaths.push(filePath)
      if (asset.kind === 'image') imagePaths.push(filePath)
    }
    return { directory, imagePaths, allPaths }
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

function promptWithAssets(prompt: string, assets: PreparedAssets): string {
  if (assets.allPaths.length === 0) return prompt
  return [
    prompt,
    '## ATTACHMENTS',
    'The following local files are part of the user context. Use the harness file tools to inspect them when relevant:',
    ...assets.allPaths.map((filePath, index) => `${index + 1}. ${filePath}`),
  ].join('\n\n')
}

function promptForHarness(harness: AiHarnessRunRequest['harness'], prompt: string): string {
  if (harness !== 'antigravity') return prompt
  return `${JSON.stringify({
    event: 'user',
    message: { role: 'user', content: prompt },
  })}\n`
}

function parseOutputLine(
  harness: AiHarnessRunRequest['harness'],
  line: string,
): { delta?: string; fallback?: string } | undefined {
  const trimmed = line.trim()
  if (!trimmed) return undefined
  try {
    const event = JSON.parse(trimmed) as Record<string, unknown>
    if (harness === 'claude-code') {
      const streamEvent = event.event as Record<string, unknown> | undefined
      const delta = streamEvent?.delta as Record<string, unknown> | undefined
      if (streamEvent?.type === 'content_block_delta' && delta?.type === 'text_delta') {
        return { delta: typeof delta.text === 'string' ? delta.text : '' }
      }
      return { fallback: typeof event.result === 'string' ? event.result : undefined }
    }
    if (harness === 'codex') {
      const item = event.item as Record<string, unknown> | undefined
      return item?.type === 'agent_message'
        ? { delta: typeof item.text === 'string' ? item.text : '' }
        : undefined
    }
    const eventType = typeof event.event === 'string' ? event.event : event.type
    if (harness === 'antigravity' && eventType === 'step_update') {
      const update = event.step_update as Record<string, unknown> | undefined
      if (update?.step_type !== 'agent_response') return undefined
      const content = firstText(update.text_delta)
      return content ? { delta: content } : undefined
    }
    if (event.type === 'message') {
      const message = event.message as Record<string, unknown> | undefined
      const role = typeof event.role === 'string'
        ? event.role
        : typeof message?.role === 'string'
          ? message.role
          : undefined
      if (role !== 'assistant' && role !== 'model') return undefined
      const content = firstText(
        event.content,
        event.text,
        message?.content,
        message?.text,
      )
      return content ? { delta: content } : undefined
    }
    if (harness === 'antigravity' && eventType === 'result') {
      const result = event.result as Record<string, unknown> | undefined
      if (result?.status !== 'SUCCESS') return undefined
      const response = firstText(result.response)
      return response ? { fallback: response } : undefined
    }
    if (eventType === 'result') {
      const result = event.result as Record<string, unknown> | undefined
      const response = firstText(
        event.response,
        event.output,
        event.text,
        result?.response,
        result?.output,
        result?.text,
      )
      return response ? { fallback: response } : undefined
    }
    return undefined
  } catch {
    return undefined
  }
}

function signalHarnessTree(child: ChildProcessWithoutNullStreams, signal: NodeJS.Signals): void {
  if (process.platform === 'win32') {
    if (child.pid) {
      const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      })
      killer.once('error', () => child.kill(signal))
      killer.unref()
      return
    }
    child.kill(signal)
    return
  }
  if (child.pid) {
    try {
      process.kill(-child.pid, signal)
      return
    } catch {
      // A test double or a process that exited between checks falls back to the
      // direct child handle. Real harnesses run in their own process group.
    }
  }
  child.kill(signal)
}

function firstText(...candidates: unknown[]): string | undefined {
  for (const candidate of candidates) {
    if (typeof candidate === 'string') return candidate
    if (Array.isArray(candidate)) {
      const parts = candidate.flatMap((part) => {
        if (typeof part === 'string') return [part]
        if (part && typeof part === 'object') {
          const value = part as Record<string, unknown>
          return typeof value.text === 'string' ? [value.text] : []
        }
        return []
      })
      if (parts.length > 0) return parts.join('')
    }
    if (candidate && typeof candidate === 'object') {
      const value = candidate as Record<string, unknown>
      if (typeof value.text === 'string') return value.text
    }
  }
  return undefined
}

function sendChunk(target: RendererTarget, requestId: string, text: string): void {
  try {
    target.send(AI_HARNESS_EVENT_CHANNEL, Object.freeze({
      version: 1,
      requestId,
      kind: 'chunk',
      text,
    }))
  } catch {
    // The renderer may close while a child is flushing its final output.
  }
}

function safeAssetName(asset: AiHarnessAsset): string {
  const cleaned = asset.name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '')
  return cleaned || `attachment.${extensionForMime(asset.mimeType)}`
}

function extensionForMime(mimeType: string): string {
  const extension = mimeType.split('/')[1]?.split(';')[0]?.trim()
  return extension && /^[a-z0-9]+$/i.test(extension) ? extension : 'bin'
}

function decodeDataUrl(dataUrl: string): Buffer {
  const match = /^data:[^;,]+;base64,([a-z0-9+/=\s]+)$/i.exec(dataUrl)
  if (!match) throw new Error('Attachment is not a base64 data URL')
  return Buffer.from(match[1]!.replace(/\s/g, ''), 'base64')
}

function harnessEnvironment(): NodeJS.ProcessEnv {
  const currentPath = process.env.PATH ?? ''
  const localAppData = process.env.LOCALAPPDATA?.trim()
  const extra = [
    path.join(os.homedir(), '.local', 'bin'),
    ...(process.platform === 'win32'
      ? []
      : ['/opt/homebrew/bin', '/usr/local/bin']),
    ...(localAppData
      ? [
          path.join(localAppData, 'agy', 'bin'),
          path.join(localAppData, 'Programs', 'OpenAI', 'Codex', 'bin'),
        ]
      : process.platform === 'win32'
        ? [
            path.join(os.homedir(), 'AppData', 'Local', 'agy', 'bin'),
            path.join(os.homedir(), 'AppData', 'Local', 'Programs', 'OpenAI', 'Codex', 'bin'),
          ]
        : []),
  ]
  const pathParts = Array.from(new Set([...currentPath.split(path.delimiter), ...extra].filter(Boolean)))
  return { ...process.env, PATH: pathParts.join(path.delimiter) }
}
