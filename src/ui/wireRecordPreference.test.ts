// @vitest-environment jsdom

// The wire record preference (#968) goes where the counters preference goes:
// device settings in renderer storage, never the Profile. The one behavior of
// its own is that flipping the preference flips the live buffer with it.

import { afterEach, describe, expect, it } from 'vitest'
import { isWireRecording, readWireRecord, setWireRecording } from '../shared/wireRecord'
import { DEVICE_SETTINGS_STORAGE_KEY } from './theme'
import {
  loadWireRecordPreference,
  setWireRecordEnabled,
  WIRE_RECORD_SETTINGS_FIELD,
} from './wireRecordPreference'

afterEach(() => {
  window.localStorage.clear()
  setWireRecording(false)
})

describe('wire record preference', () => {
  it('round-trips through device settings beside the other device fields', () => {
    window.localStorage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'dark' }))
    expect(loadWireRecordPreference()).toBe(false)

    expect(setWireRecordEnabled(true)).toBe(true)
    expect(loadWireRecordPreference()).toBe(true)
    const saved = JSON.parse(window.localStorage.getItem(DEVICE_SETTINGS_STORAGE_KEY) ?? '{}') as Record<string, unknown>
    expect(saved).toMatchObject({ theme: 'dark', [WIRE_RECORD_SETTINGS_FIELD]: true })
  })

  it('flips the live buffer with the preference, so off truly drops the record', () => {
    setWireRecordEnabled(true)
    expect(isWireRecording()).toBe(true)

    setWireRecordEnabled(false)
    expect(isWireRecording()).toBe(false)
    expect(readWireRecord()).toEqual([])
  })
})
