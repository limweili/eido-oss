// The on/off preference for Board Info's wire record (#968). It goes exactly
// where the renderer counters preference goes: device settings in renderer
// storage, never the Profile document, because what a machine records about
// its own wire is a fact about the device, not the Idea.

import { useSyncExternalStore } from 'react'
import { setWireRecording } from '../shared/wireRecord'
import { DEVICE_SETTINGS_STORAGE_KEY } from './theme'

export const WIRE_RECORD_SETTINGS_FIELD = 'wireRecord'

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

export function loadWireRecordPreference(
  storage: DeviceSettingsStorage | null = browserStorage(),
): boolean {
  if (!storage) return false
  try {
    const raw = storage.getItem(DEVICE_SETTINGS_STORAGE_KEY)
    if (!raw) return false
    const saved = JSON.parse(raw) as Record<string, unknown>
    return saved[WIRE_RECORD_SETTINGS_FIELD] === true
  } catch {
    return false
  }
}

export function saveWireRecordPreference(
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
      JSON.stringify({ ...saved, [WIRE_RECORD_SETTINGS_FIELD]: enabled }),
    )
    return true
  } catch {
    return false
  }
}

function subscribeWireRecordPreference(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function setWireRecordEnabled(enabled: boolean): boolean {
  if (!saveWireRecordPreference(enabled)) return false
  // The preference and the live buffer flip together. The buffer exists only
  // while the record is on, which is the whole "off costs nothing" promise.
  setWireRecording(enabled)
  for (const listener of listeners) listener()
  return true
}

const getDisabledPreference = () => false

export function useWireRecordEnabled(): boolean {
  return useSyncExternalStore(
    subscribeWireRecordPreference,
    loadWireRecordPreference,
    getDisabledPreference,
  )
}
