import { useGraph } from '../graph/store'
import {
  DEFAULT_LOCAL_HARNESS_SETTINGS,
  isLocalHarness,
  type AiProvider,
  type LocalHarnessId,
} from './aiProviderTypes'
import {
  AiError,
  type CompletionStream,
  type StreamOptions,
} from './openRouter'
import { createAiHarnessRunRequest } from '../../electron/aiHarnessBridgeContract'
import { isProfileReviewExecution } from '../shared/profileReviewPolicy'

type ProviderSettings = Readonly<{
  apiKey?: string
  provider?: AiProvider
  harnesses?: Partial<Record<LocalHarnessId, { command: string }>>
}>

export type ProviderStreamOptions = Omit<StreamOptions, 'apiKey'> & { apiKey?: string }

export function activeAiProvider(settings: ProviderSettings): AiProvider {
  return isProfileReviewExecution() ? 'openrouter' : settings.provider ?? 'openrouter'
}

export function hasAiAccess(settings: ProviderSettings): boolean {
  const provider = activeAiProvider(settings)
  if (provider === 'openrouter') return Boolean(settings.apiKey)
  return typeof window !== 'undefined' && typeof window.eidoAiHarness?.run === 'function'
}

/** Returns the user-owned local provider capability selected for this Idea.
 * OpenRouter remains governed by the user-key access resolver. */
export function localProviderCompletion(
  settings: ProviderSettings,
): CompletionStream | undefined {
  return activeAiProvider(settings) === 'openrouter' ? undefined : streamCompletion
}

export async function streamCompletion(
  instruction: string,
  options: ProviderStreamOptions,
): Promise<string> {
  const settings = useGraph.getState().settings
  const provider = activeAiProvider(settings)
  if (provider === 'openrouter') {
    throw new AiError('OpenRouter execution requires an AI access grant')
  }
  if (!isLocalHarness(provider)) throw new AiError('harness-unavailable')

  // An Agentic Run reaches a local harness as nothing at all, on purpose
  // (`agenticReachFor` calls this 'provider-owned'). The harness already owns
  // its tools and its own loop; the bridge carries a prompt and nothing else.
  // Do not "fix" this by writing a tool instruction into the prompt below: that
  // would be Eido guessing at a harness's tools and asking for them in prose,
  // which is worse than either owning the loop or leaving it alone.
  const bridge = typeof window === 'undefined' ? undefined : window.eidoAiHarness
  if (!bridge) throw new AiError('harness-unavailable')

  const command = settings.harnesses?.[provider]?.command
    || DEFAULT_LOCAL_HARNESS_SETTINGS[provider].command
  const request = createAiHarnessRunRequest(
    provider,
    command,
    options.model,
    options.reasoningEffort,
    harnessPrompt(instruction, options.systemPrompt, options.variationNote),
    (options.assets ?? []).map((asset) => ({
      kind: asset.kind,
      name: asset.name,
      mimeType: asset.mimeType,
      dataUrl: asset.dataUrl,
    })),
  )
  const onAbort = () => {
    void bridge.cancel(request.requestId)
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })
  try {
    if (options.signal?.aborted) throw new AiError('canceled')
    const result = await bridge.run(request, options.onChunk)
    if (!result.ok) throw new AiError(result.error === 'unavailable' ? 'harness-unavailable' : result.error)
    return result.text
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
  }
}

function harnessPrompt(instruction: string, systemPrompt: string, variationNote?: string): string {
  const eidoSystem =
    'You are Eido, a thinking partner. The user has shaped their own thinking into the ' +
    'structured instruction below — task, connected material, and output requirements. ' +
    "Extend their thinking without overriding their framing."
  return [
    systemPrompt.trim() ? `Additional Eido guidance:\n${systemPrompt.trim()}` : '',
    eidoSystem,
    variationNote?.trim() ? variationNote.trim() : '',
    '## EIDO INSTRUCTION',
    instruction,
  ].filter(Boolean).join('\n\n')
}
