// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest'
import { makeSavedBoard } from '../graph/save'
import {
  DEVICE_SETTINGS_STORAGE_KEY,
  loadThemePreference,
  normalizeThemePreference,
  resolveEffectiveTheme,
  saveThemePreference,
} from './theme'

describe('device theme preference', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('defaults missing and invalid preferences to Light', () => {
    expect(normalizeThemePreference(undefined)).toBe('light')
    expect(normalizeThemePreference(null)).toBe('light')
    expect(normalizeThemePreference('sepia')).toBe('light')
    expect(loadThemePreference()).toBe('light')

    localStorage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify({ theme: 'sepia' }))
    expect(loadThemePreference()).toBe('light')
  })

  it('resolves Match system without changing explicit Light or Dark', () => {
    expect(resolveEffectiveTheme('light', true)).toBe('light')
    expect(resolveEffectiveTheme('dark', false)).toBe('dark')
    expect(resolveEffectiveTheme('system', false)).toBe('light')
    expect(resolveEffectiveTheme('system', true)).toBe('dark')
  })

  it('persists only to the existing device settings object', () => {
    localStorage.setItem(
      DEVICE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ apiKey: 'device-secret', reasoningEffort: 'high' }),
    )

    expect(saveThemePreference('system')).toBe(true)
    expect(loadThemePreference()).toBe('system')
    expect(JSON.parse(localStorage.getItem(DEVICE_SETTINGS_STORAGE_KEY) ?? '{}')).toEqual({
      apiKey: 'device-secret',
      reasoningEffort: 'high',
      theme: 'system',
    })
  })

  it('never adds theme to a SavedBoard shape', () => {
    expect(makeSavedBoard()).not.toHaveProperty('theme')
  })
})
