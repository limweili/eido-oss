import { DEFAULT_THEME, type ThemeId } from './tokens'

export type ThemePreference = ThemeId | 'system'

export const DEVICE_SETTINGS_STORAGE_KEY = 'eido-v3-settings'
export const THEME_SETTINGS_FIELD = 'theme'

type ThemeStorage = Pick<Storage, 'getItem' | 'setItem'>

function browserStorage(): ThemeStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'dark' || value === 'system' ? value : DEFAULT_THEME
}

export function resolveEffectiveTheme(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): ThemeId {
  if (preference !== 'system') return preference
  return systemPrefersDark ? 'dark' : 'light'
}

export function loadThemePreference(storage: ThemeStorage | null = browserStorage()): ThemePreference {
  if (!storage) return DEFAULT_THEME
  try {
    const raw = storage.getItem(DEVICE_SETTINGS_STORAGE_KEY)
    if (!raw) return DEFAULT_THEME
    const saved = JSON.parse(raw) as Record<string, unknown>
    return normalizeThemePreference(saved[THEME_SETTINGS_FIELD])
  } catch {
    return DEFAULT_THEME
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage: ThemeStorage | null = browserStorage(),
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
      JSON.stringify({ ...saved, [THEME_SETTINGS_FIELD]: preference }),
    )
    return true
  } catch {
    return false
  }
}
