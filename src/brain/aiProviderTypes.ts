export type AiProvider = 'openrouter' | 'claude-code' | 'codex' | 'antigravity'

export type LocalHarnessId = Exclude<AiProvider, 'openrouter'>


export type LocalHarnessSettings = Readonly<{
  command: string
}>

export type LocalHarnessSettingsMap = Readonly<Record<LocalHarnessId, LocalHarnessSettings>>

export type ProviderModelSettings = Readonly<{
  model: string
  models: readonly string[]
}>

export type ProviderModelSettingsMap = Readonly<Record<AiProvider, ProviderModelSettings>>

export const AI_PROVIDERS: readonly AiProvider[] = [
  'openrouter',
  'claude-code',
  'codex',
  'antigravity',
]

// A provider Eido no longer offers, and the one a saved Idea lands on instead.
// The Gemini CLI is deprecated, so an Idea that chose it opens on Antigravity:
// the same vendor, still a local CLI, so the Idea keeps its shape rather than
// falling back to a network provider whose key the user may never have set.
const RETIRED_AI_PROVIDERS: Readonly<Record<string, AiProvider>> = {
  gemini: 'antigravity',
}

export const DEFAULT_LOCAL_HARNESS_SETTINGS: LocalHarnessSettingsMap = {
  'claude-code': { command: 'claude' },
  codex: { command: 'codex' },
  antigravity: { command: 'agy' },
}

// Antigravity model ids accepted by the installed `agy` CLI. Reasoning is a
// separate CLI flag, so the model names stay at the base-model level here.
export const DEFAULT_HARNESS_MODELS: Readonly<Record<LocalHarnessId, readonly string[]>> = {
  'claude-code': ['default', 'fable', 'opus', 'sonnet', 'haiku'],
  codex: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna'],
  antigravity: ['gemini-3.7-flash', 'gemini-3.1-pro'],
}

export function isAiProvider(value: unknown): value is AiProvider {
  return AI_PROVIDERS.includes(value as AiProvider)
}

// The provider a retired name now means, or null when the name was never one.
export function replacementForRetiredProvider(value: unknown): AiProvider | null {
  return typeof value === 'string' ? RETIRED_AI_PROVIDERS[value] ?? null : null
}

export function isLocalHarness(value: AiProvider): value is LocalHarnessId {
  return value !== 'openrouter'
}

export function defaultModelsForProvider(provider: AiProvider): string[] {
  return provider === 'openrouter'
    ? []
    : [...DEFAULT_HARNESS_MODELS[provider]]
}
