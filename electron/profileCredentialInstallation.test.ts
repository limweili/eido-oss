import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { LocalCredentialStore } from './localCredentialStore'
import type { ProfileInstallation } from './profileInstallation'
import { resolveProfileAuxiliaryLaunch } from './profileAuxiliaryLaunch'
import {
  createReadOnlyCredentialStore,
  resolveProfileCredentialInstallation,
} from './profileCredentialInstallation'

const appData = path.resolve('synthetic-app-data')
const installedProfile: ProfileInstallation = Object.freeze({
  mode: 'product',
  userDataRoot: path.join(appData, 'Eido'),
  databasePath: path.join(appData, 'Eido', 'profiles', 'default', 'eido-profile.sqlite'),
  disposable: false,
})
const disposableProfile: ProfileInstallation = Object.freeze({
  mode: 'proof',
  userDataRoot: path.resolve('synthetic-proof-root'),
  databasePath: path.resolve('synthetic-proof-root', 'profiles', 'default', 'eido-profile.sqlite'),
  disposable: true,
})

describe('Profile credential installation', () => {
  it('borrows only reads from the canonical installed device root during review', async () => {
    expect(resolveProfileCredentialInstallation({
      appData,
      profileInstallation: disposableProfile,
      launch: { kind: 'review' },
    })).toEqual({
      access: 'read-only',
      userDataRoot: path.join(appData, 'Eido'),
    })

    const backingStore: LocalCredentialStore = {
      read: vi.fn(async () => Object.freeze({ state: 'absent' as const })),
      set: vi.fn(async () => undefined),
      clear: vi.fn(async () => undefined),
      migrateLegacy: vi.fn(async () => ({ migrated: true })),
    }
    const store = createReadOnlyCredentialStore(backingStore)

    await expect(store.read()).resolves.toEqual({ state: 'absent' })
    await expect(store.set('')).rejects.toThrow('Local credential storage is unavailable')
    await expect(store.clear()).rejects.toThrow('Local credential storage is unavailable')
    await expect(store.migrateLegacy('')).rejects.toThrow('Local credential storage is unavailable')
    expect(backingStore.read).toHaveBeenCalledOnce()
    expect(backingStore.set).not.toHaveBeenCalled()
    expect(backingStore.clear).not.toHaveBeenCalled()
    expect(backingStore.migrateLegacy).not.toHaveBeenCalled()
  })

  it('keeps the synthetic updater proof on its disposable credential root', () => {
    const launch = resolveProfileAuxiliaryLaunch({
      argv: ['electron', '--eido-profile-synthetic-proof'],
      installation: disposableProfile,
      isPackaged: false,
    })
    expect(resolveProfileCredentialInstallation({
      appData,
      profileInstallation: disposableProfile,
      launch,
    })).toEqual({ access: 'mutable', userDataRoot: disposableProfile.userDataRoot })
  })

  it('keeps ordinary and packaged-proof credentials on their existing mutable roots', () => {
    expect(resolveProfileCredentialInstallation({
      appData,
      profileInstallation: installedProfile,
      launch: { kind: 'ordinary' },
    })).toEqual({
      access: 'mutable',
      userDataRoot: installedProfile.userDataRoot,
    })
    expect(resolveProfileCredentialInstallation({
      appData,
      profileInstallation: disposableProfile,
      launch: { kind: 'proof', request: { phase: 'stamp' } },
    })).toEqual({
      access: 'mutable',
      userDataRoot: disposableProfile.userDataRoot,
    })
  })
})
