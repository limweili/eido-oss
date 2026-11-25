// The Board's AI settings, declared once (ADR 0040). `SavedBoard.aiSettings` is
// a pure settings bag: no canvas, semantic-context, or execution projection
// reads it to learn what a Board MEANS, only how the next run should behave. By
// ADR 0040 it is therefore settings, and a value inside it must never be able to
// fail a Board load.
//
// It used to be able to. `validateBoardSettings` held the bag to a closed key
// list plus closed value sets for `provider`, `reasoningEffort`, and
// `compactionMode`, and the bag has grown twice already (commits 8352bb65 and
// 190d3753). Each of those growths was silently a downgrade break: a Board that
// carried the new key opened in the build that added it and failed the WHOLE
// PROFILE in the build before it, because a failed Board record is reported as a
// corrupt revision, not as one bad setting.
//
// So the bag is now an envelope. The persistence validator checks that it is a
// plain object and nothing else, and every key inside is resolved here instead:
// a key this build does not own rides through untouched, and a key it does own
// holding a value it cannot act on reads as the default declared below.
//
// WHY THE DEFAULTS LIVE HERE AND NOWHERE ELSE
//
// The store already normalises this bag into its own Settings shape, and the
// brain reads a few keys straight off the Board. Two normalisers with two
// opinions is how a default drifts. These contracts are the single declaration;
// the store's normaliser and the brain's readers both resolve through them.

import { AI_PROVIDERS } from '../brain/aiProviderTypes'
import type { AiProvider, ProviderModelSettingsMap } from '../brain/aiProviderTypes'
import { DEFAULT_MODEL, DEFAULT_MODEL_SLUGS } from '../brain/models'
import {
  defineChoiceSetting,
  defineSetting,
  foreignEnvelopeKeys,
  isSettingsEnvelope,
  mergeForeignEnvelopeKeys,
  resolveEnvelope,
} from '../persistence/settingsEnvelope'
import type { SettingContract, SettingsEnvelope } from '../persistence/settingsEnvelope'
import {
  COMPACTION_MODES,
  DEFAULT_CHAIN_CONFIRM_THRESHOLD,
  DEFAULT_COMPACTION_MODE,
  REASONING_EFFORTS,
} from './types'
import type { BoardAiSettings, CompactionMode, ReasoningEffort } from './types'

// The provider names a Board on disk may legitimately hold. A RETIRED name is
// accepted, not corrected: the name is the person's own saved choice, the store
// maps it to its replacement on load, and rewriting it on disk would destroy
// what a build that still offers it would read. This mirrors the same list the
// persistence validator kept before the bag became an envelope.
const RETIRED_PERSISTED_PROVIDER_IDS = ['gemini'] as const
const PERSISTED_PROVIDER_IDS: readonly string[] = [
  ...AI_PROVIDERS,
  ...RETIRED_PERSISTED_PROVIDER_IDS,
]

export const DEFAULT_BOARD_AI_MODEL = DEFAULT_MODEL
export const DEFAULT_BOARD_AI_MODELS: readonly string[] = DEFAULT_MODEL_SLUGS
export const DEFAULT_BOARD_AI_PROVIDER: AiProvider = 'openrouter'
export const DEFAULT_BOARD_AI_REASONING_EFFORT: ReasoningEffort = 'medium'

// `model`, `models`, and `reasoningEffort` are the three keys the rest of the
// app dereferences without asking, and all three are non-optional on
// `BoardAiSettings`, so all three are `required`: a bag missing one, or holding
// something this build cannot act on, must still hand a caller a usable answer
// rather than a hole. Every other key stays absent when it is absent, which
// keeps a Board written before that setting existed byte-identical to one that
// never left the default.
export const BOARD_AI_MODEL_SETTING = defineSetting<string>({
  key: 'model',
  fallback: DEFAULT_BOARD_AI_MODEL,
  required: true,
  accepts: (value) => typeof value === 'string' && value.trim().length > 0,
})

export const BOARD_AI_MODELS_SETTING = defineSetting<string[]>({
  key: 'models',
  fallback: [...DEFAULT_BOARD_AI_MODELS],
  required: true,
  accepts: (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string'),
})

export const BOARD_AI_REASONING_EFFORT_SETTING = defineChoiceSetting<ReasoningEffort>({
  key: 'reasoningEffort',
  fallback: DEFAULT_BOARD_AI_REASONING_EFFORT,
  required: true,
  choices: REASONING_EFFORTS,
})

// Absent is the legacy OpenRouter encoding, so absent stays absent.
export const BOARD_AI_PROVIDER_SETTING = defineSetting<AiProvider>({
  key: 'provider',
  fallback: DEFAULT_BOARD_AI_PROVIDER,
  accepts: (value) => typeof value === 'string' && PERSISTED_PROVIDER_IDS.includes(value),
})

// Checked for container shape only, on purpose. A newer build that adds a
// provider writes a map with a name this build has never heard of, and holding
// the map to this build's provider list would throw that person's whole Board
// away over a catalog entry. The store rebuilds the map it needs on load, so
// the documented default here is "no map", not a map of this build's own.
export const BOARD_AI_PROVIDER_MODELS_SETTING = defineSetting<ProviderModelSettingsMap | undefined>({
  key: 'providerModels',
  fallback: undefined,
  accepts: (value) => isSettingsEnvelope(value),
})

export const BOARD_AI_SYSTEM_PROMPT_SETTING = defineSetting<string>({
  key: 'systemPrompt',
  fallback: '',
  accepts: (value) => typeof value === 'string',
})

export const BOARD_AI_CHAIN_CONFIRM_THRESHOLD_SETTING = defineSetting<number>({
  key: 'chainConfirmThreshold',
  fallback: DEFAULT_CHAIN_CONFIRM_THRESHOLD,
  accepts: (value) => Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0),
})

export const BOARD_AI_COMPACTION_MODE_SETTING = defineChoiceSetting<CompactionMode>({
  key: 'compactionMode',
  fallback: DEFAULT_COMPACTION_MODE,
  choices: COMPACTION_MODES,
})

// Every key this build owns. Anything outside this list is a setting from
// another build and is copied verbatim wherever the bag is rewritten.
export const BOARD_AI_SETTING_CONTRACTS: readonly SettingContract<unknown>[] = [
  BOARD_AI_MODEL_SETTING,
  BOARD_AI_MODELS_SETTING,
  BOARD_AI_REASONING_EFFORT_SETTING,
  BOARD_AI_PROVIDER_SETTING,
  BOARD_AI_PROVIDER_MODELS_SETTING,
  BOARD_AI_SYSTEM_PROMPT_SETTING,
  BOARD_AI_CHAIN_CONFIRM_THRESHOLD_SETTING,
  BOARD_AI_COMPACTION_MODE_SETTING,
]

// THE ONE PLACE a Board's AI settings become values this build can act on. A
// Board with no bag at all keeps having none: absent settings are a valid state
// that means "use the app's own defaults", and minting a bag here would write
// one onto every Board that never had one.
export function boardAiSettingsOf(
  board: { aiSettings?: unknown } | undefined,
): BoardAiSettings | undefined {
  const stored = board?.aiSettings
  if (stored === undefined) return undefined
  return resolveEnvelope(stored, BOARD_AI_SETTING_CONTRACTS) as unknown as BoardAiSettings
}

// Everything in the stored bag this build does not own: a key it has never
// heard of, a key it owns holding a value it cannot act on, and the one case
// that hides a level deeper, a `providerModels` entry naming a provider this
// build does not have. The store decomposes the bag into its own typed Settings
// shape, which has no field for any of them, so the save path puts them back
// rather than silently deleting a newer build's preferences.
export function foreignBoardAiSettings(stored: unknown): SettingsEnvelope {
  const foreign = foreignEnvelopeKeys(stored, BOARD_AI_SETTING_CONTRACTS)
  const providerModels = foreignProviderModelEntries(stored)
  if (providerModels !== undefined) {
    foreign[BOARD_AI_PROVIDER_MODELS_SETTING.key] = providerModels
  }
  return foreign
}

// The bag this build should save: its own answers, with every foreign value put
// back. `providerModels` is the one setting whose foreign part is nested INSIDE
// the value rather than being a whole key, so it merges entry by entry: this
// build owns the entries for the providers it ships and owns none of the rest.
export function mergeForeignBoardAiSettings(
  own: BoardAiSettings,
  foreign: SettingsEnvelope,
): BoardAiSettings {
  const merged = mergeForeignEnvelopeKeys(
    own as unknown as SettingsEnvelope,
    foreign,
    BOARD_AI_SETTING_CONTRACTS,
  )
  const foreignProviderModels = foreign[BOARD_AI_PROVIDER_MODELS_SETTING.key]
  if (isSettingsEnvelope(foreignProviderModels) && own.providerModels !== undefined) {
    merged[BOARD_AI_PROVIDER_MODELS_SETTING.key] = {
      ...foreignProviderModels,
      ...own.providerModels,
    }
  }
  return merged as unknown as BoardAiSettings
}

// The `providerModels` entries that belong to no provider this build ships. A
// retired name counts: the entry is the model list the person left behind on
// that tool, and a build that still offers it should still find it. Absent when
// there is nothing foreign to carry, and absent when the whole value is one the
// contract already rejected, which `foreignEnvelopeKeys` carries as a key.
function foreignProviderModelEntries(stored: unknown): SettingsEnvelope | undefined {
  const map = isSettingsEnvelope(stored)
    ? stored[BOARD_AI_PROVIDER_MODELS_SETTING.key]
    : undefined
  if (!isSettingsEnvelope(map)) return undefined
  const owned: readonly string[] = AI_PROVIDERS
  const foreign: SettingsEnvelope = {}
  for (const key of Object.keys(map)) {
    if (!owned.includes(key)) foreign[key] = map[key]
  }
  return Object.keys(foreign).length > 0 ? foreign : undefined
}
