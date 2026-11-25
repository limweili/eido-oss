import type { InstalledKeychainBridge } from '../../electron/keychainBridgeContract'
import { DEVICE_SETTINGS_STORAGE_KEY } from '../ui/theme'

type CredentialMigrationStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

/**
 * What the credential store answered.
 *
 * `locked` exists because the two failures behind an empty key are not the
 * same failure. "You have not set a key" is a thing a person fixes by pasting
 * one. "Your key is on this computer and the operating system will not open it
 * right now" is a thing they fix by unlocking their login keychain, and telling
 * them the first when the second is true sends them to the wrong place. Journey
 * 13 found what that costs: a Linkup key that could not be read silently moved
 * Research to a shallower Web mode and nobody was told (#1360). This type is
 * how the renderer stops being able to make that mistake.
 */
export type CredentialReading = Readonly<{ apiKey: string; locked: boolean }>

export async function loadApiCredential({
  bridge,
  storage,
}: Readonly<{
  bridge?: InstalledKeychainBridge
  storage: CredentialMigrationStorage
}>): Promise<CredentialReading> {
  const legacy = readLegacyApiKeyBestEffort(storage)
  if (legacy.available) {
    if (bridge && legacy.apiKey) {
      const migration = await bridge.migrateLegacy(legacy.apiKey)
      if (migration.ok) scrubLegacyApiKeyBestEffort(storage)
    } else {
      scrubLegacyApiKeyBestEffort(storage)
    }
  }

  if (!bridge) return Object.freeze({ apiKey: legacy.apiKey, locked: false })
  // A thrown bridge is not caught here, and that is deliberate. A refused or
  // unreadable credential is a structured `ok: false` and degrades AI only; a
  // throw means the trusted main boundary itself misbehaved. Startup leaves
  // provider access locked while the independent Board authority proceeds.
  const localCredential = await bridge.get()
  if (localCredential.ok) {
    return Object.freeze({ apiKey: localCredential.value.apiKey, locked: false })
  }
  return Object.freeze({ apiKey: '', locked: localCredential.code === 'locked' })
}

// The second credential. Simpler than the first because it has no history: no
// legacy renderer storage to migrate off, and nothing to scrub. A Profile that
// has never held one answers with an empty string, which is a valid state and
// not an error: reach still works through the provider, less well, and the
// Card says so.
export async function loadLinkupCredential({
  bridge,
}: Readonly<{
  bridge?: InstalledKeychainBridge
}>): Promise<CredentialReading> {
  if (!bridge) return Object.freeze({ apiKey: '', locked: false })
  try {
    const stored = await bridge.get('linkup')
    if (stored.ok) return Object.freeze({ apiKey: stored.value.apiKey, locked: false })
    return Object.freeze({ apiKey: '', locked: stored.code === 'locked' })
  } catch {
    // A protected store that will not answer is not a reason to refuse to open
    // a Board. The next launch tries again. What it must not do is answer the
    // same as "no key was ever set", which is how a locked store used to turn
    // into a silently shallower Research answer (#1360).
    return Object.freeze({ apiKey: '', locked: true })
  }
}

export function isInstalledKeychainBridge(candidate: unknown): candidate is InstalledKeychainBridge {
  if (!candidate || typeof candidate !== 'object') return false
  return ['get', 'set', 'clear', 'migrateLegacy'].every(
    (operation) => typeof Reflect.get(candidate, operation) === 'function',
  )
}

function readLegacyApiKey(storage: CredentialMigrationStorage): string {
  const saved = readSettings(storage)
  const apiKey = saved?.apiKey
  return typeof apiKey === 'string' ? apiKey.trim() : ''
}

function readLegacyApiKeyBestEffort(storage: CredentialMigrationStorage): Readonly<{
  available: boolean
  apiKey: string
}> {
  try {
    return Object.freeze({ available: true, apiKey: readLegacyApiKey(storage) })
  } catch {
    return Object.freeze({ available: false, apiKey: '' })
  }
}

function scrubLegacyApiKey(storage: CredentialMigrationStorage): void {
  const saved = readSettings(storage)
  if (!saved || !Object.prototype.hasOwnProperty.call(saved, 'apiKey')) return
  const { apiKey: _discarded, ...remaining } = saved
  if (Object.keys(remaining).length === 0) {
    storage.removeItem(DEVICE_SETTINGS_STORAGE_KEY)
    return
  }
  storage.setItem(DEVICE_SETTINGS_STORAGE_KEY, JSON.stringify(remaining))
}

function scrubLegacyApiKeyBestEffort(storage: CredentialMigrationStorage): void {
  try {
    scrubLegacyApiKey(storage)
  } catch {
    // Legacy renderer state is optional migration input. Keep it available for
    // a later retry when browser storage is temporarily inaccessible.
  }
}

function readSettings(storage: CredentialMigrationStorage): Record<string, unknown> | undefined {
  const raw = storage.getItem(DEVICE_SETTINGS_STORAGE_KEY)
  if (!raw) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    return isPlainRecord(parsed) ? parsed : undefined
  } catch {
    return undefined
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}
