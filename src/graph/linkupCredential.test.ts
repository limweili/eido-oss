// @vitest-environment jsdom
//
// The second credential (#958). ADR 0034 chose one key deliberately and
// predicted this one in its own consequences: the keychain "was built to hold
// more than one credential and still can". What is pinned here is that it
// behaves like the first where that matters, and unlike it where the product
// differs: absent is a supported state, not setup left undone.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { hasLinkupKey, linkupKeyOf, useGraph } from './store'
import { loadLinkupCredential } from './apiCredential'
import { KEYCHAIN_CREDENTIALS } from '../../electron/keychainBridgeContract'

describe('asking whether reach can run through Linkup', () => {
  it('answers no for a Profile that has never held one', () => {
    expect(hasLinkupKey({})).toBe(false)
    expect(hasLinkupKey({ linkupKey: '' })).toBe(false)
    expect(linkupKeyOf({})).toBe('')
  })

  it('ignores a key that is only whitespace, because a user pasting badly is not a user with a key', () => {
    expect(hasLinkupKey({ linkupKey: '   ' })).toBe(false)
    expect(linkupKeyOf({ linkupKey: '  abc  ' })).toBe('abc')
  })

  it('answers yes once one is stored', () => {
    expect(hasLinkupKey({ linkupKey: 'lk-live' })).toBe(true)
  })
})

describe('where the key lives', () => {
  it('is addressable as its own slot, beside the provider key rather than instead of it', () => {
    expect(KEYCHAIN_CREDENTIALS).toContain('linkup')
    expect(KEYCHAIN_CREDENTIALS).toContain('openrouter')
  })

})

describe('loading it at startup', () => {
  it('is empty without a protected store, which is every non-packaged Profile', async () => {
    await expect(loadLinkupCredential({})).resolves.toEqual({ apiKey: '', locked: false })
  })

  it('reads its own slot and nothing else', async () => {
    const get = vi.fn().mockResolvedValue({ ok: true, value: { apiKey: 'lk-stored' } })
    const bridge = { get, set: vi.fn(), clear: vi.fn(), migrateLegacy: vi.fn() }

    await expect(loadLinkupCredential({ bridge: bridge as never })).resolves.toEqual({
      apiKey: 'lk-stored',
      locked: false,
    })
    expect(get).toHaveBeenCalledWith('linkup')
  })

  it('opens the Board anyway when the protected store will not answer', async () => {
    // A credential that cannot be read is a run that reaches the web less well.
    // It is never a reason to refuse to open somebody's thinking.
    const bridge = {
      get: vi.fn().mockRejectedValue(new Error('keychain locked')),
      set: vi.fn(),
      clear: vi.fn(),
      migrateLegacy: vi.fn(),
    }

    await expect(loadLinkupCredential({ bridge: bridge as never })).resolves.toEqual({
      apiKey: '',
      locked: true,
    })
  })

  // Journey 13 found what the missing half costs: with the Linkup key gone,
  // the mode button stops offering Research and a Card already set to Research
  // is rewritten to Web, silently, and the person acts on a shallower answer
  // believing it was researched (#1360). A key that is present but unopenable
  // used to arrive here indistinguishable from one that was never set, so the
  // app could not have said the true thing even if it wanted to. Now it can.
  it('separates a key it cannot open from a Profile that never held one', async () => {
    const absent = {
      get: vi.fn().mockResolvedValue({ ok: true, value: { apiKey: '' } }),
      set: vi.fn(),
      clear: vi.fn(),
      migrateLegacy: vi.fn(),
    }
    await expect(loadLinkupCredential({ bridge: absent as never })).resolves.toEqual({
      apiKey: '',
      locked: false,
    })

    const locked = {
      get: vi.fn().mockResolvedValue({ ok: false, code: 'locked' }),
      set: vi.fn(),
      clear: vi.fn(),
      migrateLegacy: vi.fn(),
    }
    await expect(loadLinkupCredential({ bridge: locked as never })).resolves.toEqual({
      apiKey: '',
      locked: true,
    })
  })
})

describe('saving it', () => {
  beforeEach(() => {
    useGraph.setState((state) => ({ settings: { ...state.settings, linkupKey: '' } }))
  })

  it('writes through to the store at once, so a Card on screen changes without a restart', async () => {
    await useGraph.getState().setLinkupKey('lk-live')

    expect(hasLinkupKey(useGraph.getState().settings)).toBe(true)
  })

  it('clears back to the supported empty state', async () => {
    await useGraph.getState().setLinkupKey('lk-live')
    await useGraph.getState().setLinkupKey('')

    expect(hasLinkupKey(useGraph.getState().settings)).toBe(false)
  })

  it('leaves the provider key alone', async () => {
    useGraph.setState((state) => ({ settings: { ...state.settings, apiKey: 'sk-or-kept' } }))

    await useGraph.getState().setLinkupKey('lk-live')

    expect(useGraph.getState().settings.apiKey).toBe('sk-or-kept')
  })
})

describe('the depth menu learns the key exists', () => {
  beforeEach(() => {
    useGraph.setState((state) => ({
      settings: { ...state.settings, linkupKey: '' },
      linkupKeyPresent: false,
    }))
  })

  // The menu is offered only where it binds something, so its whole visibility
  // rule is "does a key exist". A boolean mirrored by hand is the shape that
  // rots: #960 shipped one nothing ever set, so the control it gates was dead
  // on arrival and every test that exercised it passed anyway. Derived from
  // settings at all three write paths instead, and pinned here.
  it('is false with no key, and true the moment one is saved', async () => {
    expect(useGraph.getState().linkupKeyPresent).toBe(false)

    await useGraph.getState().setLinkupKey('lk_a_real_looking_key')

    expect(useGraph.getState().linkupKeyPresent).toBe(true)
  })

  it('goes false again when the key is cleared, so the menu leaves with it', async () => {
    await useGraph.getState().setLinkupKey('lk_a_real_looking_key')

    await useGraph.getState().setLinkupKey('')

    expect(useGraph.getState().linkupKeyPresent).toBe(false)
  })

  it('does not count whitespace as a key', async () => {
    await useGraph.getState().setLinkupKey('   ')

    expect(useGraph.getState().linkupKeyPresent).toBe(false)
  })
})
