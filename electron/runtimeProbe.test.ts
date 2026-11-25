import { describe, expect, it, vi } from 'vitest'
import { createRuntimeProbe } from './runtimeProbe'
import {
  assertRuntimeProbeResult,
  createRuntimeProbeBridge,
  RUNTIME_PROBE_CHANNEL,
} from './runtimeProbeContract'

describe('embedded Electron runtime probe', () => {
  it('queries sqlite_version from an in-memory database and returns only plain version data', () => {
    const close = vi.fn()
    const get = vi.fn(() => ({ sqliteVersion: '3.50.4' }))
    const prepare = vi.fn(() => ({ get }))
    const openDatabase = vi.fn(() => ({ close, prepare }))
    const runtimeProbe = createRuntimeProbe({
      openDatabase,
      versions: {
        chrome: '150.0.7871.114',
        electron: '43.1.1',
        node: '24.18.0',
      },
    })

    expect(runtimeProbe.length).toBe(0)
    expect(runtimeProbe()).toEqual({
      chromium: '150.0.7871.114',
      electron: '43.1.1',
      node: '24.18.0',
      profileAuthority: 'installed',
      sqlite: '3.50.4',
    })
    expect(openDatabase).toHaveBeenCalledWith(':memory:')
    expect(prepare).toHaveBeenCalledWith('SELECT sqlite_version() AS sqliteVersion')
    expect(close).toHaveBeenCalledOnce()
  })

  it('closes the in-memory database and returns no partial result when runtime evidence is missing', () => {
    const close = vi.fn()
    const runtimeProbe = createRuntimeProbe({
      openDatabase: () => ({
        close,
        prepare: () => ({ get: () => ({ wrongKey: '3.50.4' }) }),
      }),
      versions: {
        chrome: '150.0.7871.114',
        electron: '43.1.1',
        node: '24.18.0',
      },
    })

    expect(runtimeProbe).toThrow('Embedded SQLite did not return sqliteVersion')
    expect(close).toHaveBeenCalledOnce()
  })

  it('rejects malformed, missing, or expanded renderer-facing probe results', () => {
    const valid = {
      chromium: '150.0.7871.114',
      electron: '43.1.1',
      node: '24.18.0',
      profileAuthority: 'installed',
      sqlite: '3.50.4',
    }

    expect(assertRuntimeProbeResult(valid)).toEqual(valid)
    expect(() => assertRuntimeProbeResult(undefined)).toThrow('Runtime probe returned invalid evidence')
    expect(() => assertRuntimeProbeResult({ ...valid, sqlite: '' })).toThrow('Runtime probe returned invalid evidence')
    expect(() => assertRuntimeProbeResult({ ...valid, profileAuthority: 'not installed' })).toThrow(
      'Runtime probe returned invalid evidence',
    )
    expect(() => assertRuntimeProbeResult({ ...valid, databasePath: 'C:\\private\\profile.sqlite' })).toThrow(
      'Runtime probe returned invalid evidence',
    )
  })

  it('exposes exactly one zero-argument runtimeProbe and validates the IPC response', async () => {
    const valid = {
      chromium: '150.0.7871.114',
      electron: '43.1.1',
      node: '24.18.0',
      profileAuthority: 'installed',
      sqlite: '3.50.4',
    } as const
    const invoke = vi.fn(async () => valid)
    const bridge = createRuntimeProbeBridge(invoke)

    expect(Object.keys(bridge)).toEqual(['runtimeProbe'])
    expect(bridge.runtimeProbe.length).toBe(0)
    expect(await bridge.runtimeProbe()).toEqual(valid)
    expect(invoke).toHaveBeenCalledWith(RUNTIME_PROBE_CHANNEL)

    const malformedBridge = createRuntimeProbeBridge(async () => ({ ...valid, rawIpc: true }))
    await expect(malformedBridge.runtimeProbe()).rejects.toThrow('Runtime probe returned invalid evidence')
  })
})
