import { describe, expect, it, vi } from 'vitest'
import {
  assertKeychainBridgeRequest,
  createInstalledKeychainBridge,
  KEYCHAIN_BRIDGE_CHANNEL,
  KEYCHAIN_BRIDGE_VERSION,
  type KeychainBridgeRequest,
} from './keychainBridgeContract'

describe('keychain bridge contract', () => {
  it('uses one versioned channel and correlated tagged envelopes', async () => {
    const invoke = vi.fn(async (_channel: string, request: KeychainBridgeRequest) => ({
      version: KEYCHAIN_BRIDGE_VERSION,
      requestId: request.requestId,
      operation: request.operation,
      ok: true,
      value: request.operation === 'get'
        ? { apiKey: 'sk-protected' }
        : request.operation === 'migrate-legacy'
          ? { migrated: true }
          : request.operation === 'set'
            ? { stored: true }
            : { cleared: true },
    }))
    const bridge = createInstalledKeychainBridge(invoke, () => 'keychain-request-1')

    await expect(bridge.get()).resolves.toEqual({ ok: true, value: { apiKey: 'sk-protected' } })
    await expect(bridge.set('sk-next')).resolves.toEqual({ ok: true, value: { stored: true } })
    await expect(bridge.clear()).resolves.toEqual({ ok: true, value: { cleared: true } })
    await expect(bridge.migrateLegacy('sk-old')).resolves.toEqual({ ok: true, value: { migrated: true } })
    await expect(bridge.get('linkup')).resolves.toEqual({ ok: true, value: { apiKey: 'sk-protected' } })

    expect(invoke.mock.calls.map(([channel]) => channel)).toEqual([
      KEYCHAIN_BRIDGE_CHANNEL,
      KEYCHAIN_BRIDGE_CHANNEL,
      KEYCHAIN_BRIDGE_CHANNEL,
      KEYCHAIN_BRIDGE_CHANNEL,
      KEYCHAIN_BRIDGE_CHANNEL,
    ])
    expect(invoke.mock.calls.map(([, request]) => request)).toEqual([
      {
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-1',
        operation: 'get',
        payload: { credential: 'openrouter' },
      },
      {
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-1',
        operation: 'set',
        payload: { credential: 'openrouter', apiKey: 'sk-next' },
      },
      {
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-1',
        operation: 'clear',
        payload: { credential: 'openrouter' },
      },
      {
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-1',
        operation: 'migrate-legacy',
        payload: { apiKey: 'sk-old' },
      },
      // Every credential rides the same channel; only the named credential
      // changes. There is no second bridge and no second trust boundary.
      {
        version: KEYCHAIN_BRIDGE_VERSION,
        requestId: 'keychain-request-1',
        operation: 'get',
        payload: { credential: 'linkup' },
      },
    ])
  })

  it('accepts only exact bounded operation payloads', () => {
    const valid = {
      version: KEYCHAIN_BRIDGE_VERSION,
      requestId: 'keychain-request-1',
      operation: 'set',
      payload: { credential: 'openrouter', apiKey: 'sk-valid' },
    } as const
    expect(assertKeychainBridgeRequest(valid)).toEqual(valid)
    expect(assertKeychainBridgeRequest({
      ...valid,
      payload: { credential: 'linkup', apiKey: 'lk-valid' },
    })).toBeTruthy()

    for (const candidate of [
      { ...valid, version: 2 },
      { ...valid, operation: 'credentials.read' },
      { ...valid, payload: { credential: 'openrouter', apiKey: '' } },
      { ...valid, payload: { credential: 'openrouter', apiKey: 'x'.repeat(16 * 1024 + 1) } },
      { ...valid, payload: { credential: 'openrouter', apiKey: 'sk-valid', path: '/tmp/credential' } },
      // The credential is named, not free text: an unknown name cannot open a
      // new file, and a missing one cannot fall through to a default.
      { ...valid, payload: { credential: 'anthropic', apiKey: 'sk-valid' } },
      { ...valid, payload: { apiKey: 'sk-valid' } },
      { ...valid, trusted: true },
    ]) {
      expect(() => assertKeychainBridgeRequest(candidate), JSON.stringify(candidate).slice(0, 200)).toThrow(
        'Keychain bridge request was denied',
      )
    }
  })
})
