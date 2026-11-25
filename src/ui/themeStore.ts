import { useCallback, useLayoutEffect, useSyncExternalStore } from 'react'
import {
  loadThemePreference,
  resolveEffectiveTheme,
  saveThemePreference,
  type ThemePreference,
} from './theme'
import { createMediaQueryStore } from './mediaQueryStore'
import type { ThemeId } from './tokens'

export const COLOR_SCHEME_QUERY = '(prefers-color-scheme: dark)'

const preferenceListeners = new Set<() => void>()
const systemColorScheme = createMediaQueryStore(COLOR_SCHEME_QUERY)

function subscribeThemePreference(listener: () => void): () => void {
  preferenceListeners.add(listener)
  return () => preferenceListeners.delete(listener)
}

const subscribeNever = () => () => {}
const getFalse = () => false
const getDefaultPreference = (): ThemePreference => 'light'

export function setThemePreference(preference: ThemePreference): boolean {
  if (!saveThemePreference(preference)) return false
  for (const listener of preferenceListeners) listener()
  return true
}

export function useThemePreference(): ThemePreference {
  return useSyncExternalStore(
    subscribeThemePreference,
    loadThemePreference,
    getDefaultPreference,
  )
}

export function useEffectiveTheme(preference: ThemePreference): ThemeId {
  const subscribe = useCallback(
    preference === 'system' ? systemColorScheme.subscribe : subscribeNever,
    [preference],
  )
  const getSnapshot = useCallback(
    preference === 'system' ? systemColorScheme.getSnapshot : getFalse,
    [preference],
  )
  const prefersDark = useSyncExternalStore(subscribe, getSnapshot, getFalse)
  return resolveEffectiveTheme(preference, prefersDark)
}

export function useAppliedTheme(): ThemeId {
  const preference = useThemePreference()
  const theme = useEffectiveTheme(preference)
  useLayoutEffect(() => {
    if (typeof document !== 'undefined') document.documentElement.dataset.theme = theme
  }, [theme])
  return theme
}
