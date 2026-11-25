import { useSyncExternalStore } from 'react'
import { DEVICE_SETTINGS_STORAGE_KEY } from './theme'

export const RENDERER_COUNTERS_SETTINGS_FIELD = 'rendererCounters'

type DeviceSettingsStorage = Pick<Storage, 'getItem' | 'setItem'>

const listeners = new Set<() => void>()

function browserStorage(): DeviceSettingsStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function loadRendererCountersPreference(
  storage: DeviceSettingsStorage | null = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(DEVICE_SETTINGS_STORAGE_KEY)
    if (!raw) return false
    const saved = JSON.parse(raw) as Record<string, unknown>
    return saved[RENDERER_COUNTERS_SETTINGS_FIELD] === true
  } catch {
    return false
  }
}

export function saveRendererCountersPreference(
  enabled: boolean,
  storage: DeviceSettingsStorage | null = browserStorage(),
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
      JSON.stringify({ ...saved, [RENDERER_COUNTERS_SETTINGS_FIELD]: enabled }),
    )
    return true
  } catch {
    return false
  }
}

function subscribeRendererCountersPreference(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setRendererCountersEnabled(enabled: boolean): boolean {
  if (!saveRendererCountersPreference(enabled)) return false
  for (const listener of listeners) listener()
  return true
}

const getDisabledPreference = () => false

export function useRendererCountersEnabled(): boolean {
  return useSyncExternalStore(
    subscribeRendererCountersPreference,
    loadRendererCountersPreference,
    getDisabledPreference,
  )
}
