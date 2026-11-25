import type { LocalHarnessId } from '../src/brain/aiProviderTypes'
import type { ReasoningEffort } from '../src/graph/types'

export const AI_HARNESS_BRIDGE_VERSION = 1 as const
export const AI_HARNESS_BRIDGE_CHANNEL = 'eido:ai-harness:v1' as const
export const AI_HARNESS_EVENT_CHANNEL = 'eido:ai-harness:event:v1' as const
export const AI_HARNESS_REQUEST_MAX_BYTES = 24 * 1024 * 1024
export const AI_HARNESS_ASSET_MAX_BYTES = 12 * 1024 * 1024

export type AiHarnessError = 'unavailable' | 'failed' | 'canceled' | 'incompatible-output'

export type AiHarnessAsset = Readonly<{
  kind: 'image' | 'file'
  name: string
  mimeType: string
  dataUrl: string
}>

export type AiHarnessRunRequest = Readonly<{
  version: typeof AI_HARNESS_BRIDGE_VERSION
  requestId: string
  operation: 'run'
  harness: LocalHarnessId
  command: string
  model: string
  reasoningEffort: ReasoningEffort
  prompt: string
  assets: readonly AiHarnessAsset[]
}>

export type AiHarnessCancelRequest = Readonly<{
  version: typeof AI_HARNESS_BRIDGE_VERSION
  requestId: string
  operation: 'cancel'
}>

export type AiHarnessRequest = AiHarnessRunRequest | AiHarnessCancelRequest

export type AiHarnessEvent = Readonly<{
  version: typeof AI_HARNESS_BRIDGE_VERSION
  requestId: string
  kind: 'chunk'
  text: string
}> | Readonly<{
  version: typeof AI_HARNESS_BRIDGE_VERSION
  requestId: string
  kind: 'error'
  error: AiHarnessError
}>

export type AiHarnessRunResult = Readonly<{
  ok: true
  text: string
}> | Readonly<{
  ok: false
  error: AiHarnessError
}>

export type InstalledAiHarnessBridge = Readonly<{
  run(request: AiHarnessRunRequest, onChunk: (text: string) => void): Promise<AiHarnessRunResult>
  cancel(requestId: string): Promise<void>
}>

const nextAiHarnessRequestId = createSequentialRequestId()

export function createInstalledAiHarnessBridge(
  invoke: (request: AiHarnessRequest) => Promise<unknown>,
  subscribe: (listener: (candidate: unknown) => void) => void,
): InstalledAiHarnessBridge {
  const listeners = new Map<string, (text: string) => void>()
  subscribe((candidate) => {
    const event = assertAiHarnessEvent(candidate)
    if (event.kind === 'chunk') listeners.get(event.requestId)?.(event.text)
  })

  return Object.freeze({
    run: async (request, onChunk) => {
      listeners.set(request.requestId, onChunk)
      try {
        const response = await invoke(request)
        return assertAiHarnessRunResult(response)
      } finally {
        listeners.delete(request.requestId)
      }
    },
    cancel: async (requestId) => {
      await invoke(Object.freeze({
        version: AI_HARNESS_BRIDGE_VERSION,
        requestId,
        operation: 'cancel',
      }))
    },
  })
}

export function createAiHarnessRunRequest(
  harness: LocalHarnessId,
  command: string,
  model: string,
  reasoningEffort: ReasoningEffort,
  prompt: string,
  assets: readonly AiHarnessAsset[],
  createRequestId: () => string = nextAiHarnessRequestId,
): AiHarnessRunRequest {
  return Object.freeze({
    version: AI_HARNESS_BRIDGE_VERSION,
    requestId: createRequestId(),
    operation: 'run',
    harness,
    command,
    model,
    reasoningEffort,
    prompt,
    assets: Object.freeze([...assets]),
  })
}

export function assertAiHarnessRequest(candidate: unknown): AiHarnessRequest {
  if (!isPlainRecord(candidate)
    || candidate.version !== AI_HARNESS_BRIDGE_VERSION
    || !boundedString(candidate.requestId, 256)
    || (candidate.operation !== 'run' && candidate.operation !== 'cancel')) {
    return deniedRequest()
  }
  if (candidate.operation === 'cancel') {
    if (!hasExactKeys(candidate, ['operation', 'requestId', 'version'])) return deniedRequest()
    return Object.freeze(candidate) as AiHarnessCancelRequest
  }
  if (!hasExactKeys(candidate, [
    'assets', 'command', 'harness', 'model', 'operation', 'prompt', 'reasoningEffort', 'requestId', 'version',
  ])
    || !['claude-code', 'codex', 'antigravity'].includes(candidate.harness as string)
    || !boundedString(candidate.command, 1024)
    || candidate.command.includes('\0')
    || !boundedString(candidate.model, 256)
    || !['xhigh', 'high', 'medium', 'low', 'minimal', 'none'].includes(candidate.reasoningEffort as string)
    || !boundedString(candidate.prompt, AI_HARNESS_REQUEST_MAX_BYTES)
    || !Array.isArray(candidate.assets)
    || candidate.assets.length > 32
    || !validAssets(candidate.assets)) {
    return deniedRequest()
  }
  return Object.freeze(candidate) as AiHarnessRunRequest
}

export function assertAiHarnessEvent(candidate: unknown): AiHarnessEvent {
  if (!isPlainRecord(candidate)
    || candidate.version !== AI_HARNESS_BRIDGE_VERSION
    || !boundedString(candidate.requestId, 256)
    || (candidate.kind !== 'chunk' && candidate.kind !== 'error')) {
    return deniedEvent()
  }
  if (candidate.kind === 'chunk') {
    if (!hasExactKeys(candidate, ['kind', 'requestId', 'text', 'version'])
      || typeof candidate.text !== 'string') return deniedEvent()
    return Object.freeze(candidate) as AiHarnessEvent
  }
  if (!hasExactKeys(candidate, ['error', 'kind', 'requestId', 'version'])
    || !['unavailable', 'failed', 'canceled', 'incompatible-output'].includes(candidate.error as string)) {
    return deniedEvent()
  }
  return Object.freeze(candidate) as AiHarnessEvent
}

export function assertAiHarnessRunResult(candidate: unknown): AiHarnessRunResult {
  if (!isPlainRecord(candidate) || typeof candidate.ok !== 'boolean') return deniedResult()
  if (candidate.ok) {
    if (!hasExactKeys(candidate, ['ok', 'text']) || typeof candidate.text !== 'string') return deniedResult()
    return Object.freeze(candidate) as AiHarnessRunResult
  }
  if (!hasExactKeys(candidate, ['error', 'ok'])
    || !['unavailable', 'failed', 'canceled', 'incompatible-output'].includes(candidate.error as string)) return deniedResult()
  return Object.freeze(candidate) as AiHarnessRunResult
}

function validAsset(candidate: unknown): candidate is AiHarnessAsset {
  if (!isPlainRecord(candidate) || !hasExactKeys(candidate, ['dataUrl', 'kind', 'mimeType', 'name'])) return false
  return (candidate.kind === 'image' || candidate.kind === 'file')
    && boundedString(candidate.name, 512)
    && boundedString(candidate.mimeType, 256)
    && boundedString(candidate.dataUrl, AI_HARNESS_ASSET_MAX_BYTES)
}

function validAssets(candidates: readonly unknown[]): candidates is readonly AiHarnessAsset[] {
  let totalBytes = 0
  for (const candidate of candidates) {
    if (!validAsset(candidate)) return false
    totalBytes += new TextEncoder().encode(candidate.dataUrl).byteLength
    if (totalBytes > AI_HARNESS_REQUEST_MAX_BYTES) return false
  }
  return true
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasExactKeys(candidate: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(candidate).sort()
  const wanted = [...expected].sort()
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index])
}

function boundedString(value: unknown, maxBytes: number): value is string {
  return typeof value === 'string' && value.length > 0 && new TextEncoder().encode(value).byteLength <= maxBytes
}

function createSequentialRequestId(): () => string {
  let sequence = 0
  return () => {
    sequence += 1
    return `ai-harness-renderer-${sequence}`
  }
}

function deniedRequest(): never {
  throw new Error('AI harness bridge request was denied')
}

function deniedEvent(): never {
  throw new Error('AI harness bridge event was denied')
}

function deniedResult(): never {
  throw new Error('AI harness bridge result was denied')
}
