import { beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_MODEL_SLUGS } from '../brain/models'
import {
  loadRecommendedModelCatalog,
  loadRecommendedModelCatalogState,
  normalizeRecommendedModelCatalog,
  replaceRecommendedModel,
  saveMigratedRecommendedModelCatalog,
  saveRecommendedModelCatalog,
} from './recommendedModelCatalog'
import { DEVICE_SETTINGS_STORAGE_KEY } from './theme'

describe('device-local Recommended Model Catalog', () => {
  const storage = new MemoryStorage()

  beforeEach(() => storage.clear())

  it('starts with the same release recommendations for every account route', () => {
    expect(loadRecommendedModelCatalog(storage)).toEqual(DEFAULT_MODEL_SLUGS)
    expect(normalizeRecommendedModelCatalog(undefined)).toEqual(DEFAULT_MODEL_SLUGS)
  })

  it('keeps arbitrary structurally valid OpenRouter slugs while cleaning duplicates', () => {
    expect(normalizeRecommendedModelCatalog([
      ' openai/gpt-5.6-luna ',
      'vendor/new-model:free',
      'vendor/new-model:free',
      'not-a-slug',
      'vendor/another model',
    ])).toEqual(['openai/gpt-5.6-luna', 'vendor/new-model:free'])
  })

  it('never allows removing the last model from the picker', () => {
    expect(normalizeRecommendedModelCatalog(['vendor/custom'])).toEqual(['vendor/custom'])
    expect(normalizeRecommendedModelCatalog([])).toEqual(DEFAULT_MODEL_SLUGS)
  })

  it('round-trips edits in device settings without touching unrelated fields', () => {
    storage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'dark' }))

    expect(saveRecommendedModelCatalog(['vendor/custom', 'openai/gpt-5.6-luna'], storage)).toBe(true)
    expect(loadRecommendedModelCatalog(storage)).toEqual(['vendor/custom', 'openai/gpt-5.6-luna'])
    expect(JSON.parse(storage.getItem(DEVICE_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      theme: 'dark',
      recommendedModelCatalog: ['vendor/custom', 'openai/gpt-5.6-luna'],
      recommendedModelCatalogExplicit: true,
    })
  })

  it('distinguishes a migrated catalog from an explicit reset to release defaults', () => {
    expect(saveMigratedRecommendedModelCatalog(['vendor/legacy'], storage)).toBe(true)
    expect(loadRecommendedModelCatalogState(storage)).toEqual({
      models: ['vendor/legacy'],
      explicit: false,
    })

    expect(saveRecommendedModelCatalog(DEFAULT_MODEL_SLUGS, storage)).toBe(true)
    expect(loadRecommendedModelCatalogState(storage)).toEqual({
      models: DEFAULT_MODEL_SLUGS,
      explicit: true,
    })
  })

  it('migrates a legacy catalog only from the device settings seam', () => {
    storage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify({
      theme: 'dark',
      providerModels: {
        openrouter: {
          model: 'vendor/legacy-selected',
          models: ['vendor/legacy-selected', 'vendor/legacy-second'],
        },
      },
    }))

    expect(loadRecommendedModelCatalogState(storage)).toEqual({
      models: ['vendor/legacy-selected', 'vendor/legacy-second'],
      explicit: false,
    })
    expect(JSON.parse(storage.getItem(DEVICE_SETTINGS_STORAGE_KEY) ?? '{}')).toMatchObject({
      theme: 'dark',
      recommendedModelCatalog: ['vendor/legacy-selected', 'vendor/legacy-second'],
      recommendedModelCatalogExplicit: false,
    })
  })

  it.each([
    ['a selected-only singleton', ['vendor/legacy-selected']],
    ['a two-entry list with only one valid slug', ['vendor/legacy-selected', 'not-a-slug']],
  ])('does not migrate %s from legacy device settings', (_label, models) => {
    const legacySettings = {
      theme: 'dark',
      providerModels: {
        openrouter: {
          model: 'vendor/legacy-selected',
          models,
        },
      },
    }
    storage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify(legacySettings))

    expect(loadRecommendedModelCatalogState(storage)).toEqual({
      models: DEFAULT_MODEL_SLUGS,
      explicit: false,
    })
    expect(JSON.parse(storage.getItem(DEVICE_SETTINGS_STORAGE_KEY) ?? '{}'))
      .toEqual(legacySettings)
  })

  it('does not leak a corrupt device catalog into the runtime', () => {
    storage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify({
      recommendedModelCatalog: ['vendor/custom', 4, 'not-a-slug'],
    }))

    expect(loadRecommendedModelCatalog(storage)).toEqual(['vendor/custom'])
  })

  it('accepts only a structurally valid, non-duplicate replacement', () => {
    const catalog = ['vendor/old', 'openai/gpt-5.6-luna']

    expect(replaceRecommendedModel(catalog, 'vendor/old', 'vendor/new')).toEqual([
      'vendor/new',
      'openai/gpt-5.6-luna',
    ])
    expect(replaceRecommendedModel(catalog, 'vendor/old', 'openai/gpt-5.6-luna')).toBeNull()
    expect(replaceRecommendedModel(catalog, 'vendor/old', 'invalid')).toBeNull()
    expect(catalog).toEqual(['vendor/old', 'openai/gpt-5.6-luna'])
  })
})

class MemoryStorage {
  private values = new Map<string, string>()

  clear(): void {
    this.values.clear()
  }

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }
}
