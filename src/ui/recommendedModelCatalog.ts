import {
  DEFAULT_MODEL_SLUGS,
  cleanModelSlug,
  isOpenRouterSlug,
} from '../brain/models'
import { isProfileReviewExecution } from '../shared/profileReviewPolicy'
import { DEVICE_SETTINGS_STORAGE_KEY } from './theme'

export const RECOMMENDED_MODEL_CATALOG_SETTINGS_FIELD = 'recommendedModelCatalog'
export const RECOMMENDED_MODEL_CATALOG_EXPLICIT_FIELD = 'recommendedModelCatalogExplicit'

type DeviceSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

export type RecommendedModelCatalogState = Readonly<{
  models: string[]
  explicit: boolean
}>

/**
 * Migrates the last released browser/Board shape into the device-owned
 * catalog. The old Settings surface stored an editable OpenRouter list on
 * each Idea, so an untouched device may encounter more than one such list as
 * Ideas are opened. Only a list with at least two unique structurally valid
 * entries is eligible;
 * an absent aiSettings value or a selected-identity singleton is never a
 * catalog signal.
 */
export function migrateLegacyRecommendedModelCatalog(
  value: unknown,
  state: RecommendedModelCatalogState,
  storage: DeviceSettingsStorage | null = browserStorage(),
): RecommendedModelCatalogState {
  if (isProfileReviewExecution()
    || state.explicit
    || !value
    || typeof value !== 'object'
    || Array.isArray(value)) return state
  const saved = value as Record<string, unknown>
  const candidates: string[] = []
  const collect = (raw: unknown): void => {
    const list = structurallyValidLegacyModelList(raw)
    if (list) candidates.push(...list)
  }

  const providerModels = saved.providerModels
  if (providerModels && typeof providerModels === 'object' && !Array.isArray(providerModels)) {
    const openrouter = (providerModels as Record<string, unknown>).openrouter
    if (openrouter && typeof openrouter === 'object' && !Array.isArray(openrouter)) {
      collect((openrouter as Record<string, unknown>).models)
    }
  }
  // In the released shape, an active OpenRouter Idea also mirrored its list
  // at the top level. An absent provider is the legacy OpenRouter encoding;
  // a local-provider top-level list belongs to that provider and is ignored.
  if (saved.provider === undefined || saved.provider === 'openrouter') {
    collect(saved.models)
  }
  if (candidates.length === 0) return state

  const models = normalizeRecommendedModelCatalog([...state.models, ...candidates])
  if (sameModelList(models, state.models)) return state
  saveMigratedRecommendedModelCatalog(models, storage)
  return { models, explicit: false }
}

function browserStorage(): DeviceSettingsStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

/**
 * Normalizes the editable, device-local OpenRouter picker list. This is a
 * convenience list, not a provider allowlist: every structurally valid slug
 * is retained so existing cards keep their selected model.
 */
export function normalizeRecommendedModelCatalog(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
        .filter((candidate): candidate is string => typeof candidate === 'string')
        .map(cleanModelSlug)
        .filter(isOpenRouterSlug)
    : []
  const models = Array.from(new Set(values))
  return models.length > 0 ? models : [...DEFAULT_MODEL_SLUGS]
}

/**
 * Replaces one device-local recommendation without widening the persistence
 * boundary. Invalid or duplicate replacements are refused as a whole.
 */
export function replaceRecommendedModel(
  catalog: readonly string[],
  previous: string,
  replacement: string,
): string[] | null {
  const current = normalizeRecommendedModelCatalog(catalog)
  const from = cleanModelSlug(previous)
  const to = cleanModelSlug(replacement)
  if (!isOpenRouterSlug(to) || !current.includes(from)) return null
  if (to !== from && current.includes(to)) return null
  return current.map((model) => (model === from ? to : model))
}

export function loadRecommendedModelCatalog(
  storage: DeviceSettingsStorage | null = browserStorage(),
): string[] {
  return loadRecommendedModelCatalogState(storage).models
}

/**
 * Loads the catalog together with the persisted migration marker. A catalog
 * recovered from the legacy device settings shape is not explicit; an explicit
 * device edit (even a reset to release defaults) is.
 */
export function loadRecommendedModelCatalogState(
  storage: DeviceSettingsStorage | null = browserStorage(),
): RecommendedModelCatalogState {
  const defaults = (): RecommendedModelCatalogState => ({
    models: [...DEFAULT_MODEL_SLUGS],
    explicit: false,
  })
  if (!storage) return defaults()
  try {
    const raw = storage.getItem(DEVICE_SETTINGS_STORAGE_KEY)
    if (!raw) return defaults()
    const saved = JSON.parse(raw) as Record<string, unknown>
    const hasCatalog = Object.prototype.hasOwnProperty.call(saved, RECOMMENDED_MODEL_CATALOG_SETTINGS_FIELD)
    if (!hasCatalog) {
      const providerModels = saved.providerModels
      const openrouter = providerModels && typeof providerModels === 'object' && !Array.isArray(providerModels)
        ? (providerModels as Record<string, unknown>).openrouter
        : undefined
      const legacyModels = openrouter && typeof openrouter === 'object' && !Array.isArray(openrouter)
        ? (openrouter as Record<string, unknown>).models
        : undefined
      const migrated = isProfileReviewExecution()
        ? null
        : structurallyValidLegacyModelList(legacyModels)
      if (migrated && !sameModelList(migrated, DEFAULT_MODEL_SLUGS)) {
        writeRecommendedModelCatalog(migrated, storage, false)
        return { models: migrated, explicit: false }
      }
    }
    return {
      models: normalizeRecommendedModelCatalog(saved[RECOMMENDED_MODEL_CATALOG_SETTINGS_FIELD]),
      explicit: hasCatalog && saved[RECOMMENDED_MODEL_CATALOG_EXPLICIT_FIELD] === true,
    }
  } catch {
    return defaults()
  }
}

function sameModelList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((model, index) => model === right[index])
}

function structurallyValidLegacyModelList(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length < 2) return null
  const models = value.map((candidate) => (
    typeof candidate === 'string' ? cleanModelSlug(candidate) : ''
  )).filter(isOpenRouterSlug)
  const unique = Array.from(new Set(models))
  return unique.length >= 2 ? unique : null
}

export function saveRecommendedModelCatalog(
  models: unknown,
  storage: DeviceSettingsStorage | null = browserStorage(),
): boolean {
  return writeRecommendedModelCatalog(models, storage, true)
}

/** Persists a legacy device-settings migration without claiming a user edit. */
export function saveMigratedRecommendedModelCatalog(
  models: unknown,
  storage: DeviceSettingsStorage | null = browserStorage(),
): boolean {
  if (!storage) return false
  let explicit = false
  try {
    const raw = storage.getItem(DEVICE_SETTINGS_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        explicit = (parsed as Record<string, unknown>)[RECOMMENDED_MODEL_CATALOG_EXPLICIT_FIELD] === true
      }
    }
  } catch {
    // The writer below replaces corrupt device settings safely.
  }
  return writeRecommendedModelCatalog(models, storage, explicit)
}

function writeRecommendedModelCatalog(
  models: unknown,
  storage: DeviceSettingsStorage | null,
  explicit: boolean,
): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(DEVICE_SETTINGS_STORAGE_KEY)
    let saved: Record<string, unknown> = {}
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          saved = parsed as Record<string, unknown>
        }
      } catch {
        // A corrupt device-settings value is replaced at this local-only seam.
      }
    }
    storage.setItem(
      DEVICE_SETTINGS_STORAGE_KEY,
      JSON.stringify({
        ...saved,
        [RECOMMENDED_MODEL_CATALOG_SETTINGS_FIELD]: normalizeRecommendedModelCatalog(models),
        [RECOMMENDED_MODEL_CATALOG_EXPLICIT_FIELD]: explicit,
      }),
    )
    return true
  } catch {
    return false
  }
}
