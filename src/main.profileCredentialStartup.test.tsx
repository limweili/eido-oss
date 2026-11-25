// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { InstalledKeychainBridge } from '../electron/keychainBridgeContract'
import type { InstalledProfileBridge } from '../electron/profileBridgeContract'
import { createCompleteProfileFixture } from './persistence/fixtures/profileLogicalProjectionFixture'
import { words } from './shared/words'

vi.mock('./App', async () => {
  const React = await import('react')
  return {
    default: () => {
      React.useEffect(() => {
        void import('./graph/store').then((store) => store.useGraph.getState().hydrate())
      }, [])
      return null
    },
  }
})

describe('packaged startup with a delayed or unavailable credential', () => {
  afterEach(async () => {
    const store = await import('./graph/store')
    store.resetGraphPersistenceForTests()
    document.body.replaceChildren()
    for (const key of ['eidoDesktop', 'eidoProfile', 'eidoKeychain'] as const) {
      Reflect.deleteProperty(window, key)
    }
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it.each(['unavailable', 'pending'] as const)('opens the native Profile while credentials are %s', async (credentialState) => {
    document.body.innerHTML = '<div id="root"></div>'
    const fixture = createCompleteProfileFixture()
    const hydrate = vi.fn(async () => ({
      ok: true as const,
      value: {
        intentActorId: 'actor-synthetic-startup',
        snapshot: fixture.snapshot,
        acknowledgement: {
          epoch: 'epoch-synthetic-startup',
          revision: fixture.snapshot.revision,
        },
      },
    }))
    const notUsed = vi.fn(async () => {
      throw new Error('unexpected synthetic Profile operation')
    })
    const profileBridge = {
      runtimeProbe: notUsed,
      hydrate,
      ackHydration: vi.fn(async (epoch: string, revision: number) => ({
        ok: true as const,
        value: { acknowledged: true as const, epoch, revision },
      })),
      createOrdinaryIdea: notUsed,
      commitGuiProjection: notUsed,
      flush: notUsed,
      status: notUsed,
      capabilities: notUsed,
      query: notUsed,
      exportPortable: notUsed,
      duplicateIdea: notUsed,
      importIdeaClosure: notUsed,
      inspectRecovery: notUsed,
      restoreRecovery: notUsed,
      startFresh: notUsed,
    } as unknown as InstalledProfileBridge
    let releaseCredential = () => {}
    const pendingCredential = new Promise<void>((resolve) => { releaseCredential = resolve })
    const credentialBridge: InstalledKeychainBridge = {
      get: vi.fn<InstalledKeychainBridge['get']>(async (slot) => {
        if (credentialState === 'unavailable') return { ok: false, code: 'unavailable' }
        await pendingCredential
        return { ok: true, value: { apiKey: slot === 'linkup' ? 'lk-synthetic' : 'sk-synthetic' } }
      }),
      set: vi.fn(async () => ({ ok: false as const, code: 'unavailable' as const })),
      clear: vi.fn(async () => ({ ok: false as const, code: 'unavailable' as const })),
      migrateLegacy: vi.fn(async () => ({ ok: false as const, code: 'unavailable' as const })),
    }

    Object.defineProperties(window, {
      eidoDesktop: { configurable: true, value: true },
      eidoProfile: { configurable: true, value: profileBridge },
      eidoKeychain: { configurable: true, value: credentialBridge },
    })

    const store = await import('./graph/store')
    try {
      await import('./main')
      await waitFor(() => {
        expect(store.useGraph.getState()).toMatchObject({
          hydrated: true,
          profileStartupState: 'ready',
        })
      })

      expect(screen.queryByRole('heading', { level: 2, name: words.profileUnavailableTitle }))
        .not.toBeInTheDocument()
      expect(hydrate).toHaveBeenCalledOnce()
      expect(profileBridge.ackHydration).toHaveBeenCalledWith(
        'epoch-synthetic-startup',
        fixture.snapshot.revision,
      )
      if (credentialState === 'pending') {
        expect(credentialBridge.get).toHaveBeenCalledOnce()
        expect(store.useGraph.getState()).toMatchObject({
          settings: { apiKey: '' },
          apiKeyLocked: true,
          linkupKeyLocked: true,
        })
      }
    } finally {
      releaseCredential()
    }
    if (credentialState === 'pending') {
      await waitFor(() => expect(store.useGraph.getState()).toMatchObject({
        settings: { apiKey: 'sk-synthetic', linkupKey: 'lk-synthetic' },
        apiKeyLocked: false,
        linkupKeyLocked: false,
      }))
    }
  }, 15_000)
})
