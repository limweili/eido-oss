// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstalledKeychainBridge } from '../../electron/keychainBridgeContract'
import { loadApiCredential } from './apiCredential'

describe('renderer AI credential migration', () => {
  beforeEach(() => localStorage.clear())

  it('migrates a legacy plaintext key, preserves other settings, and reads back local state', async () => {
    localStorage.setItem('eido-v3-settings', JSON.stringify({
      apiKey: ' sk-legacy ',
      theme: 'dark',
      reasoningEffort: 'high',
    }))
    const bridge = keychainBridge({ protectedKey: 'sk-legacy', migrated: true })

    await expect(loadApiCredential({ bridge, storage: localStorage })).resolves.toEqual({
      apiKey: 'sk-legacy',
      locked: false,
    })

    expect(bridge.migrateLegacy).toHaveBeenCalledWith('sk-legacy')
    expect(bridge.get).toHaveBeenCalledOnce()
    expect(JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}')).toEqual({
      theme: 'dark',
      reasoningEffort: 'high',
    })
  })

  it('does not overwrite an existing local key with stale renderer state', async () => {
    localStorage.setItem('eido-v3-settings', JSON.stringify({ apiKey: 'sk-stale' }))
    const bridge = keychainBridge({ protectedKey: 'sk-current', migrated: false })

    await expect(loadApiCredential({ bridge, storage: localStorage })).resolves.toEqual({
      apiKey: 'sk-current',
      locked: false,
    })

    expect(bridge.migrateLegacy).toHaveBeenCalledWith('sk-stale')
    expect(localStorage.getItem('eido-v3-settings')).toBeNull()
  })

  it('retains plaintext for a safe retry and degrades AI when main rejects migration', async () => {
    localStorage.setItem('eido-v3-settings', JSON.stringify({
      apiKey: 'sk-retry',
      theme: 'system',
    }))
    const bridge = keychainBridge({ protectedKey: '', migrated: false })
    vi.mocked(bridge.migrateLegacy).mockResolvedValue({ ok: false, code: 'unavailable' })

    await expect(loadApiCredential({ bridge, storage: localStorage })).resolves.toEqual({
      apiKey: '',
      locked: false,
    })
    expect(JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}')).toEqual({
      apiKey: 'sk-retry',
      theme: 'system',
    })
    expect(bridge.get).toHaveBeenCalledOnce()
  })

  it('degrades AI without failing startup when a valid bridge cannot read local storage', async () => {
    const bridge = keychainBridge({ protectedKey: '', migrated: false })
    vi.mocked(bridge.get).mockResolvedValue({ ok: false, code: 'unavailable' })

    await expect(loadApiCredential({ bridge, storage: localStorage })).resolves.toEqual({
      apiKey: '',
      locked: false,
    })
  })

  // The distinction #1359 exists to make sayable, at the renderer boundary.
  // `unavailable` above and `locked` here both produce an empty key; only one
  // of them means the person still has a key on this computer. Collapsing them
  // is what let a locked Linkup key look exactly like no key at all (#1360).
  it('separates a credential it cannot open from one that was never set', async () => {
    const bridge = keychainBridge({ protectedKey: '', migrated: false })
    vi.mocked(bridge.get).mockResolvedValue({ ok: false, code: 'locked' })

    await expect(loadApiCredential({ bridge, storage: localStorage })).resolves.toEqual({
      apiKey: '',
      locked: true,
    })
  })

  it('keeps a browser-development legacy key for this session while scrubbing persistence', async () => {
    localStorage.setItem('eido-v3-settings', JSON.stringify({ apiKey: 'sk-browser', theme: 'light' }))

    await expect(loadApiCredential({ storage: localStorage })).resolves.toEqual({
      apiKey: 'sk-browser',
      locked: false,
    })

    expect(JSON.parse(localStorage.getItem('eido-v3-settings') ?? '{}')).toEqual({ theme: 'light' })
  })

  it.each(['getItem', 'removeItem', 'setItem'] as const)(
    'contains an optional renderer storage %s failure and still loads the main-owned key',
    async (failedOperation) => {
      let raw = failedOperation === 'removeItem'
        ? JSON.stringify({ apiKey: 'sk-retry' })
        : JSON.stringify({ apiKey: 'sk-retry', theme: 'dark' })
      let getAttempts = 0
      const storage = {
        getItem: vi.fn(() => {
          getAttempts += 1
          if (failedOperation === 'getItem' && getAttempts === 1) {
            throw new DOMException('denied', 'SecurityError')
          }
          return raw
        }),
        removeItem: vi.fn(() => {
          if (failedOperation === 'removeItem') throw new DOMException('denied', 'SecurityError')
          raw = ''
        }),
        setItem: vi.fn((_key: string, value: string) => {
          if (failedOperation === 'setItem') throw new DOMException('denied', 'SecurityError')
          raw = value
        }),
      }
      const bridge = keychainBridge({ protectedKey: 'sk-main-owned', migrated: true })

      await expect(loadApiCredential({ bridge, storage })).resolves.toEqual({
        apiKey: 'sk-main-owned',
        locked: false,
      })

      expect(bridge.get).toHaveBeenCalledOnce()
      if (failedOperation === 'getItem') {
        expect(bridge.migrateLegacy).not.toHaveBeenCalled()
        expect(storage.getItem).toHaveBeenCalledOnce()
        expect(raw).toContain('sk-retry')
      } else {
        expect(bridge.migrateLegacy).toHaveBeenCalledWith('sk-retry')
        expect(raw).toContain('sk-retry')
      }
    },
  )

  it('fails closed when the installed bridge throws a protocol or IPC exception', async () => {
    const getFailure = keychainBridge({ protectedKey: '', migrated: false })
    vi.mocked(getFailure.get).mockRejectedValue(new Error('Keychain bridge response was denied'))
    await expect(loadApiCredential({ bridge: getFailure, storage: localStorage })).rejects.toThrow(
      'Keychain bridge response was denied',
    )

    localStorage.setItem('eido-v3-settings', JSON.stringify({ apiKey: 'sk-legacy' }))
    const migrationFailure = keychainBridge({ protectedKey: '', migrated: false })
    vi.mocked(migrationFailure.migrateLegacy).mockRejectedValue(new Error('IPC handler is missing'))
    await expect(loadApiCredential({ bridge: migrationFailure, storage: localStorage })).rejects.toThrow(
      'IPC handler is missing',
    )
  })
})

function keychainBridge({
  protectedKey,
  migrated,
}: Readonly<{
  protectedKey: string
  migrated: boolean
}>): InstalledKeychainBridge {
  return {
    get: vi.fn(async () => ({ ok: true as const, value: { apiKey: protectedKey } })),
    set: vi.fn(async () => ({ ok: true as const, value: { stored: true as const } })),
    clear: vi.fn(async () => ({ ok: true as const, value: { cleared: true as const } })),
    migrateLegacy: vi.fn(async () => ({ ok: true as const, value: { migrated } })),
  }
}
