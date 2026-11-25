// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstalledKeychainBridge } from '../../electron/keychainBridgeContract'
import type { InstalledProfileBridge } from '../../electron/profileBridgeContract'
import { remapModPartIdentities } from '../mods'
import { PROFILE_BUILT_IN_MOD_TEMPLATES } from '../persistence/profileBuiltInMods'
import { PROFILE_MOD_RECORD_VERSION } from '../persistence/profileModRecords'
import type {
  ProfileRendererHydration,
  ProfileRendererPersistence,
  ProfileRendererStateSink,
} from '../graph/profileRendererPersistence'
import { captureStampedProfileModOrigin } from '../graph/profileModOrigins'
import * as store from '../graph/store'
import { createPackagedCredentialMigrationFixture, installPackagedProfileProof } from './packagedProfileProof'
import { loadApiCredential } from '../graph/apiCredential'

const PROOF_API_KEY = 'sk-eido-packaged-proof-only'
const IDEA = {
  id: 'idea-proof',
  name: 'Proof Idea',
  createdAt: '2026-07-23T00:00:00.000Z',
  updatedAt: '2026-07-23T00:00:00.000Z',
  lastOpenedAt: '2026-07-23T00:00:00.000Z',
}

function fakeKeychain(
  initial: Partial<Record<string, string>> = {},
): InstalledKeychainBridge {
  const slots = new Map<string, string>(Object.entries(initial) as [string, string][])
  return {
    get: vi.fn(async (credential = 'openrouter') => (
      { ok: true, value: { apiKey: slots.get(credential) ?? '' } } as const
    )),
    set: vi.fn(async (apiKey: string, credential = 'openrouter') => {
      slots.set(credential, apiKey)
      return { ok: true, value: { stored: true } } as const
    }),
    clear: vi.fn(async (credential = 'openrouter') => {
      slots.delete(credential)
      return { ok: true, value: { cleared: true } } as const
    }),
    migrateLegacy: vi.fn(async () => ({ ok: true, value: { migrated: false } } as const)),
  } as unknown as InstalledKeychainBridge
}

describe('packaged Profile proof', () => {
  beforeEach(() => {
    store.resetGraphPersistenceForTests()
    vi.stubGlobal('localStorage', memoryStorage())
    window.history.replaceState(null, '', '/?profile-proof-phase=stamp')
  })

  afterEach(() => {
    store.resetGraphPersistenceForTests()
    for (const key of ['eidoProfile', 'eidoKeychain'] as const) {
      Reflect.deleteProperty(window, key)
    }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
  })

  it('migrates a synthetic legacy key without writing plaintext into browser storage', async () => {
    localStorage.setItem('eido-v3-settings', JSON.stringify({ model: 'synthetic/model' }))
    const storage = createPackagedCredentialMigrationFixture(localStorage)
    expect(localStorage.getItem('eido-v3-settings')).not.toContain(PROOF_API_KEY)

    const keychain = fakeKeychain()
    vi.mocked(keychain.migrateLegacy).mockImplementation(async (apiKey) => {
      await keychain.set(apiKey)
      return { ok: true, value: { migrated: true } }
    })
    const reading = await loadApiCredential({ bridge: keychain, storage })

    expect(keychain.migrateLegacy).toHaveBeenCalledWith(PROOF_API_KEY)
    expect(reading).toEqual({ apiKey: PROOF_API_KEY, locked: false })
    expect(localStorage.getItem('eido-v3-settings')).toBe(JSON.stringify({ model: 'synthetic/model' }))
  })

  it('stamps a current built-in Mod and reports its separate native instance identity', async () => {
    const template = PROFILE_BUILT_IN_MOD_TEMPLATES[0]!
    const remapped = remapModPartIdentities(
      template.mod,
      ({ role, ordinal }) => `proof-${role}-${ordinal}`,
    )
    const companion = captureStampedProfileModOrigin(
      template.mod,
      remapped.value,
      { sourceTemplateId: template.templateId, sourceTemplateVersion: 1 },
      'mod-instance-proof',
    )
    const hydration: ProfileRendererHydration = {
      intentActorId: 'actor-packaged-proof',
      idea: IDEA,
      ideas: [IDEA],
      board: {
        version: 1,
        cards: [],
        connections: [],
        outputs: [],
        runs: [],
        updatedAt: IDEA.updatedAt,
      },
      userModTemplates: [],
      modOrigins: {},
    }
    let stampedCardId: string | undefined
    const stampModTemplate = vi.fn((templateId: string) => {
      if (templateId !== template.templateId) throw new Error('Unknown synthetic template')
      return companion
    })
    const schedule = vi.fn((state: Parameters<ProfileRendererPersistence['schedule']>[0]) => {
      stampedCardId ??= Object.keys(state.newModOrigins)[0]
      return schedule.mock.calls.length
    })
    const flush = vi.fn(async () => ({
      generation: schedule.mock.calls.length,
      nativeGeneration: schedule.mock.calls.length,
      revision: 2,
    }))
    const persistence = {
      connectStateSink(sink: ProfileRendererStateSink) {
        sink.applyHydration(hydration)
        sink.admitHydration()
      },
      stampModTemplate,
      schedule,
      flush,
    } as unknown as ProfileRendererPersistence
    store.configureGraphPersistence({ kind: 'packaged-profile', persistence })
    // One slot per credential, as the real Keychain has. A fake that answers
    // every slot with the same key would hide the exact failure the Linkup
    // round trip exists to catch.
    const keychain = fakeKeychain({ openrouter: PROOF_API_KEY })
    await store.configureGraphApiCredential('packaged-profile', keychain, localStorage)

    const query = vi.fn<InstalledProfileBridge['query']>(async (request) => {
      const cardId = stampedCardId
      const card = cardId
        ? store.useGraph.getState().cards.find((candidate) => candidate.id === cardId)
        : undefined
      if (!cardId || !card?.modV2 || companion.origin.kind !== 'stamped') {
        throw new Error('Synthetic stamped Mod was not scheduled')
      }
      expect(request).toMatchObject({
        recordKinds: ['mod-instance'],
        parentIds: [cardId],
      })
      return {
        ok: true,
        value: {
          profileId: 'profile-proof',
          revision: 2,
          items: [{
            recordId: companion.origin.instanceId,
            kind: 'mod-instance',
            ownerId: `board:${IDEA.id}`,
            parentId: cardId,
            ordinal: 0,
            recordVersion: PROFILE_MOD_RECORD_VERSION,
            payload: {
              source: {
                kind: 'template',
                templateId: companion.origin.sourceTemplateId,
                templateVersion: companion.origin.sourceTemplateVersion,
              },
              idMap: {
                mod: { ...companion.origin.sourceToInstanceIdMap.mod },
                controls: companion.origin.sourceToInstanceIdMap.controls.map((pair) => ({ ...pair })),
              },
              stampedAt: '2026-07-23T00:00:01.000Z',
              // Native logical JSON is canonicalized independently from the
              // renderer object's insertion order.
              mod: canonicalOrder(card.modV2) as typeof card.modV2,
            },
          }],
          truncated: false,
        },
      }
    })
    Object.defineProperties(window, {
      eidoProfile: {
        configurable: true,
        value: { query } as unknown as InstalledProfileBridge,
      },
      eidoKeychain: {
        configurable: true,
        value: keychain,
      },
    })
    Object.defineProperty(navigator, 'permissions', {
      configurable: true,
      value: { query: vi.fn(async () => ({ state: 'denied' })) },
    })
    vi.spyOn(window, 'open').mockReturnValue(null)
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', {
      headers: { 'content-security-policy': "connect-src 'self' https://openrouter.ai https://api.linkup.so" },
    })))

    installPackagedProfileProof(store)

    await vi.waitFor(() => {
      expect(new URL(window.location.href).searchParams.get('profile-proof-result')).toBe('passed')
    })
    const result = new URL(window.location.href).searchParams
    expect(stampModTemplate).toHaveBeenCalledWith(template.templateId)
    expect(result.get('profile-proof-result-card-id')).toBe(stampedCardId)
    expect(result.get('profile-proof-result-mod-id')).toBe(companion.origin.instanceId)
    expect(result.get('profile-proof-result-mod-id')).not.toBe(stampedCardId)
    const stampedCard = store.useGraph.getState().cards.find((card) => card.id === stampedCardId)
    expect(stampedCard).not.toHaveProperty('mod')
    expect(stampedCard?.modV2).toEqual(companion.mod)
  })
})

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() {
      return values.size
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => {
      values.delete(key)
    },
    setItem: (key, value) => {
      values.set(key, value)
    },
  }
}

function canonicalOrder(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalOrder)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, canonicalOrder(child)]))
}
