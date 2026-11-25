import { describe, expect, it, vi } from 'vitest'
import { KEYCHAIN_BRIDGE_VERSION } from './keychainBridgeContract'
import { createInstalledKeychainMainSession } from './installedKeychainMainSession'

type Reading =
  | { state: 'absent' }
  | { state: 'present'; apiKey: string }
  | { state: 'locked' }

function readingFor(apiKey: string): Reading {
  return apiKey ? { state: 'present', apiKey } : { state: 'absent' }
}

function fakeStore(apiKey = '') {
  return {
    read: vi.fn(async (): Promise<Reading> => readingFor(apiKey)),
    set: vi.fn(async () => undefined),
    clear: vi.fn(async () => undefined),
    migrateLegacy: vi.fn(async () => ({ migrated: false })),
  }
}

describe('installed keychain main session', () => {
  it('routes only trusted operations to the main-owned store', async () => {
    const mainFrame = { url: 'eido://app/' }
    const target = { mainFrame }
    const store = {
      read: vi.fn(async (): Promise<Reading> => ({ state: 'present', apiKey: 'sk-protected' })),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      migrateLegacy: vi.fn(async () => ({ migrated: true })),
    }
    const session = createInstalledKeychainMainSession({
      store,
      target,
      stores: { linkup: fakeStore() },
    })

    await expect(session.route(
      { sender: target, senderFrame: mainFrame },
      [{
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-1',
        operation: 'get',
        payload: { credential: 'openrouter' },
      }],
    )).resolves.toEqual({
      version: KEYCHAIN_BRIDGE_VERSION,
      requestId: 'keychain-request-1',
      operation: 'get',
      ok: true,
      value: { apiKey: 'sk-protected' },
    })
    expect(store.read).toHaveBeenCalledOnce()

    await expect(session.route(
      { sender: target, senderFrame: mainFrame },
      [{
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-2',
        operation: 'migrate-legacy',
        payload: { apiKey: 'sk-legacy' },
      }],
    )).resolves.toMatchObject({
      ok: true,
      value: { migrated: true },
    })
    expect(store.migrateLegacy).toHaveBeenCalledWith('sk-legacy')
  })

  it('routes each named credential to its own store, never to the default', async () => {
    const mainFrame = { url: 'eido://app/' }
    const target = { mainFrame }
    const store = {
      read: vi.fn(async (): Promise<Reading> => ({ state: 'present', apiKey: 'sk-openrouter' })),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      migrateLegacy: vi.fn(async () => ({ migrated: true })),
    }
    const linkupStore = {
      read: vi.fn(async (): Promise<Reading> => ({ state: 'present', apiKey: 'lk-linkup' })),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      migrateLegacy: vi.fn(async () => ({ migrated: false })),
    }
    const session = createInstalledKeychainMainSession({
      store,
      target,
      stores: { linkup: linkupStore },
    })

    await expect(session.route(
      { sender: target, senderFrame: mainFrame },
      [{
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-linkup',
        operation: 'get',
        payload: { credential: 'linkup' },
      }],
    )).resolves.toMatchObject({ ok: true, value: { apiKey: 'lk-linkup' } })
    expect(linkupStore.read).toHaveBeenCalledOnce()
    expect(store.read).not.toHaveBeenCalled()

    await session.route(
      { sender: target, senderFrame: mainFrame },
      [{
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-openrouter',
        operation: 'clear',
        payload: { credential: 'openrouter' },
      }],
    )
    expect(store.clear).toHaveBeenCalledOnce()
    expect(linkupStore.clear).not.toHaveBeenCalled()

    // The Linkup slot is the one that shipped addressable on the wire but
    // unwired here, so saving a Linkup key failed on a keychain that was fine.
    await expect(session.route(
      { sender: target, senderFrame: mainFrame },
      [{
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-linkup-set',
        operation: 'set',
        payload: { credential: 'linkup', apiKey: 'lk-next' },
      }],
    )).resolves.toMatchObject({ ok: true, value: { stored: true } })
    expect(linkupStore.set).toHaveBeenCalledWith('lk-next')

    // And an emptied field clears it rather than reporting a save failure.
    await expect(session.route(
      { sender: target, senderFrame: mainFrame },
      [{
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-linkup-clear',
        operation: 'clear',
        payload: { credential: 'linkup' },
      }],
    )).resolves.toMatchObject({ ok: true, value: { cleared: true } })
    expect(linkupStore.clear).toHaveBeenCalledOnce()
  })

  // The seam where #1359 could quietly undo itself. A store that cannot open a
  // credential must not arrive in the renderer as an empty key: that is exactly
  // the shape that turned a locked Linkup key into a silently shallower
  // Research answer (#1360). An absent credential still arrives as an empty
  // key, because that one is true.
  it('answers locked and absent differently, and never as the same empty key', async () => {
    const mainFrame = { url: 'eido://app/' }
    const target = { mainFrame }
    const locked = {
      read: vi.fn(async (): Promise<Reading> => ({ state: 'locked' })),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      migrateLegacy: vi.fn(async () => ({ migrated: false })),
    }
    const session = createInstalledKeychainMainSession({
      store: locked,
      target,
      stores: { linkup: fakeStore() },
    })

    await expect(session.route(
      { sender: target, senderFrame: mainFrame },
      [{
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-locked',
        operation: 'get',
        payload: { credential: 'openrouter' },
      }],
    )).resolves.toEqual({
      version: KEYCHAIN_BRIDGE_VERSION,
      requestId: 'keychain-request-locked',
      operation: 'get',
      ok: false,
      error: { code: 'locked' },
    })

    // The empty-slot answer, for contrast. Same wire, different fact.
    await expect(session.route(
      { sender: target, senderFrame: mainFrame },
      [{
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-absent',
        operation: 'get',
        payload: { credential: 'linkup' },
      }],
    )).resolves.toEqual({
      version: KEYCHAIN_BRIDGE_VERSION,
      requestId: 'keychain-request-absent',
      operation: 'get',
      ok: true,
      value: { apiKey: '' },
    })
  })

  it('returns a generic failure without reflecting secret or storage details', async () => {
    const mainFrame = { url: 'eido://app/' }
    const target = { mainFrame }
    const session = createInstalledKeychainMainSession({
      target,
      stores: { linkup: fakeStore() },
      store: {
        read: vi.fn(async (): Promise<Reading> => {
          throw new Error('decrypt failed for sk-do-not-reflect at /private/path')
        }),
        set: vi.fn(async () => undefined),
        clear: vi.fn(async () => undefined),
        migrateLegacy: vi.fn(async () => ({ migrated: false })),
      },
    })

    const response = await session.route(
      { sender: target, senderFrame: mainFrame },
      [{
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-failure',
        operation: 'get',
        payload: { credential: 'openrouter' },
      }],
    )
    expect(response).toEqual({
      version: KEYCHAIN_BRIDGE_VERSION,
      requestId: 'keychain-request-failure',
      operation: 'get',
      ok: false,
      error: { code: 'unavailable' },
    })
    expect(JSON.stringify(response)).not.toMatch(/sk-do-not-reflect|private|decrypt/i)
  })
})
