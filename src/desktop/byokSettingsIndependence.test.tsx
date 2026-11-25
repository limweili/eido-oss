// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { InstalledKeychainBridge, KeychainCredentialName } from '../../electron/keychainBridgeContract'
import { runCard } from '../brain/runEngine'
import { SettingsModal } from '../canvas/SettingsModal'
import { resetGraphPersistenceForTests, useGraph, configureGraphApiCredential } from '../graph/store'
import type { Card } from '../graph/types'
import { words } from '../shared/words'
import { OverlayProvider } from '../ui/overlays'

const MODEL = 'openai/gpt-4.1-mini'
const CHAT_COMPLETIONS = 'https://openrouter.ai/api/v1/chat/completions'
const MODELS = 'https://openrouter.ai/api/v1/models'
const LINKUP_SEARCH = 'https://api.linkup.so/v1/search'

type CredentialSlots = Readonly<{
  bridge: InstalledKeychainBridge
  values: Map<string, string>
}>

function keychain(
  initial: Partial<Record<KeychainCredentialName, string>> = {},
  readFailures: Partial<Record<KeychainCredentialName, string>> = {},
): CredentialSlots {
  const values = new Map<string, string>(Object.entries(initial))
  return {
    values,
    bridge: {
      get: vi.fn(async (credential: KeychainCredentialName = 'openrouter') => {
        const failure = readFailures[credential]
        if (failure) throw new Error(failure)
        return { ok: true, value: { apiKey: values.get(credential) ?? '' } } as const
      }),
      set: vi.fn(async (apiKey: string, credential: KeychainCredentialName = 'openrouter') => {
        values.set(credential, apiKey)
        return { ok: true, value: { stored: true } } as const
      }),
      clear: vi.fn(async (credential: KeychainCredentialName = 'openrouter') => {
        values.delete(credential)
        return { ok: true, value: { cleared: true } } as const
      }),
      migrateLegacy: vi.fn(async () => ({ ok: true, value: { migrated: false } } as const)),
    },
  }
}

// The same keychain, with named slots the operating system refuses to open on
// this launch. A refusal is a structured `locked` answer rather than a throw,
// which is what the real bridge returns and what tells the renderer the key is
// still on disk (#1359). Slots left out of `locked` answer normally, so one
// bridge can hold a working key and a locked one at once, which is the state
// #1360 was reopened for.
function lockedKeychain(
  initial: Partial<Record<KeychainCredentialName, string>>,
  locked: readonly KeychainCredentialName[],
): CredentialSlots {
  const slots = keychain(initial)
  const bridge: InstalledKeychainBridge = {
    ...slots.bridge,
    get: vi.fn(async (credential: KeychainCredentialName = 'openrouter') => (
      locked.includes(credential)
        ? { ok: false, code: 'locked' } as const
        : { ok: true, value: { apiKey: slots.values.get(credential) ?? '' } } as const
    )),
  }
  return { values: slots.values, bridge }
}

function askCard(): Card {
  return {
    id: 'settings-byok-independence-ask',
    kind: 'askAi',
    blocks: [{ id: 'settings-byok-independence-block', text: 'Answer the private question.' }],
    position: { x: 0, y: 0 },
    model: MODEL,
    agentic: true,
  }
}

function sseResponse(payloads: readonly unknown[]): Response {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const payload of payloads) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`))
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }), { status: 200 })
}

function completionResponse(text: string): Response {
  return sseResponse([{ choices: [{ delta: { content: text } }] }])
}

function setInstalledGraphState(): void {
  useGraph.setState({
    cards: [askCard()],
    connections: [],
    outputs: [],
    runs: [],
    compactionSummaries: [],
    settings: {
      apiKey: '',
      linkupKey: '',
      model: MODEL,
      models: [MODEL],
      reasoningEffort: 'medium',
    },
    hydrated: false,
    currentIdeaId: null,
    linkupKeyPresent: false,
  })
}

function TestSettings() {
  const [open, setOpen] = useState(true)
  return open ? <SettingsModal initialCategory="ai" onClose={() => setOpen(false)} /> : null
}

describe('installed BYOK Settings', () => {
  beforeEach(() => {
    localStorage.clear()
    resetGraphPersistenceForTests()
    Object.defineProperty(window, 'eidoDesktop', { configurable: true, value: true })
    setInstalledGraphState()
  })

  afterEach(() => {
    cleanup()
    resetGraphPersistenceForTests()
    Reflect.deleteProperty(window, 'eidoDesktop')
    vi.unstubAllGlobals()
  })

  it('adds personal Linkup through installed Settings and runs with the supplied keys', async () => {
    const credentials = keychain()
    await configureGraphApiCredential('packaged-profile', credentials.bridge, localStorage)
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <TestSettings />
      </OverlayProvider>,
    )

    const apiKey = screen.getByLabelText(words.apiKeyLabel)
    const linkupKey = screen.getByLabelText(words.linkupKeyLabel)
    expect(linkupKey).not.toHaveAttribute('data-locked')
    await user.type(apiKey, 'sk-personal-openrouter')
    await user.type(linkupKey, 'lk-personal-linkup')
    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))

    await waitFor(() => {
      expect(useGraph.getState().settings).toMatchObject({
        apiKey: 'sk-personal-openrouter',
        linkupKey: 'lk-personal-linkup',
      })
    })
    expect(credentials.bridge.set).toHaveBeenNthCalledWith(
      1,
      'sk-personal-openrouter',
    )
    expect(credentials.bridge.set).toHaveBeenNthCalledWith(
      2,
      'lk-personal-linkup',
      'linkup',
    )

    const requests: string[] = []
    let completionCount = 0
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      requests.push(url)
      if (url === CHAT_COMPLETIONS) {
        completionCount += 1
        return completionCount === 1
          ? sseResponse([{
              choices: [{ delta: {
                tool_calls: [{
                  index: 0,
                  id: 'settings-linkup-search-1',
                  function: {
                    name: 'search_web',
                    arguments: JSON.stringify({ query: 'private web question', depth: 'fast' }),
                  },
                }],
              } }],
            }])
          : completionResponse('Personal Linkup answer')
      }
      if (url === LINKUP_SEARCH) {
        return new Response(JSON.stringify({
          results: [{
            type: 'text',
            name: 'Personal source',
            url: 'https://example.test/personal-source',
            content: 'Personal source text',
          }],
        }), { status: 200 })
      }
      if (url === MODELS) return new Response(JSON.stringify({ data: [] }), { status: 200 })
      throw new Error(`unexpected egress: ${url}`)
    }))

    await expect(runCard('settings-byok-independence-ask')).resolves.toMatchObject({
      ok: true,
      status: 'done',
    })
    expect(requests.filter((url) => url === CHAT_COMPLETIONS || url === LINKUP_SEARCH)).toEqual([
      CHAT_COMPLETIONS,
      LINKUP_SEARCH,
      CHAT_COMPLETIONS,
    ])
    expect(JSON.stringify(useGraph.getState().snapshot())).not.toMatch(
      /sk-personal-openrouter|lk-personal-linkup/,
    )
  })

  it('does not clear an existing Linkup key when its read fails and Done is unchanged', async () => {
    const credentials = keychain(
      { linkup: 'stored-linkup-secret' },
      { linkup: 'keychain-read-failed' },
    )
    await configureGraphApiCredential('packaged-profile', credentials.bridge, localStorage)
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <TestSettings />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))
    await waitFor(() => expect(screen.queryByRole('dialog', { name: words.settings })).toBeNull())
    expect(credentials.bridge.clear).not.toHaveBeenCalledWith('linkup')
    expect(credentials.bridge.set).not.toHaveBeenCalledWith('', 'linkup')
    expect(credentials.values.get('linkup')).toBe('stored-linkup-secret')
  })

  // #1359, at the seam a person actually meets. With the key now protected by
  // the operating system, a locked or refused store is a real state, and it
  // looks exactly like having no key: an empty field and no AI. The screen has
  // to say which one it is, because the two are fixed in different places and
  // one of them is not broken. Journey 13 is what happens when it does not
  // (#1360).
  it('says a key it cannot open is still there, rather than showing an empty field and nothing else', async () => {
    const credentials = lockedKeychain({ openrouter: 'sk-still-on-this-computer' }, ['openrouter'])
    await configureGraphApiCredential('packaged-profile', credentials.bridge, localStorage)
    render(
      <OverlayProvider>
        <TestSettings />
      </OverlayProvider>,
    )

    expect(useGraph.getState().apiKeyLocked).toBe(true)
    expect(screen.getByLabelText(words.apiKeyLabel)).toHaveValue('')
    expect(screen.getByText(words.apiKeyLockedNotice)).toBeInTheDocument()
    // And it never says the true thing about where the key lives while the
    // stored value is on screen: the field stays empty, so nothing readable is
    // rendered.
    expect(document.body.textContent ?? '').not.toContain('sk-still-on-this-computer')
  })

  it('does not claim a key is locked when there simply is not one', async () => {
    const credentials = keychain()
    await configureGraphApiCredential('packaged-profile', credentials.bridge, localStorage)
    render(
      <OverlayProvider>
        <TestSettings />
      </OverlayProvider>,
    )

    expect(useGraph.getState().apiKeyLocked).toBe(false)
    expect(useGraph.getState().linkupKeyLocked).toBe(false)
    expect(screen.queryByText(words.apiKeyLockedNotice)).toBeNull()
    expect(screen.queryByText(words.linkupKeyLockedNotice)).toBeNull()
  })

  // #1360 reopened. The first fix carried one ORed boolean and rendered it in
  // one place, so the screen could only say "something is locked" and could
  // only say it under OpenRouter. With a working OpenRouter key and a locked
  // Linkup key that reads as four false clauses under the field that is fine,
  // and silence under the field that is not. Each slot answers for itself.
  it('puts the locked notice under the locked Linkup field and not under the working OpenRouter one', async () => {
    const credentials = lockedKeychain(
      { openrouter: 'sk-opens-fine', linkup: 'lk-still-on-this-computer' },
      ['linkup'],
    )
    await configureGraphApiCredential('packaged-profile', credentials.bridge, localStorage)
    render(
      <OverlayProvider>
        <TestSettings />
      </OverlayProvider>,
    )

    // The locked slot says why Research stopped, instead of the ordinary
    // placeholder that reads as "you never set one".
    expect(screen.getByText(words.linkupKeyLockedNotice)).toBeInTheDocument()
    // The unlocked slot says nothing. Its key opened, its field is filled and
    // AI works, so every clause of the OpenRouter notice would be false here.
    expect(screen.queryByText(words.apiKeyLockedNotice)).toBeNull()
    expect(useGraph.getState().linkupKeyLocked).toBe(true)
    expect(useGraph.getState().apiKeyLocked).toBe(false)
    expect(screen.getByLabelText(words.apiKeyLabel)).toHaveValue('sk-opens-fine')
    expect(screen.getByLabelText(words.linkupKeyLabel)).toHaveValue('')
    expect(document.body.textContent ?? '').not.toContain('lk-still-on-this-computer')
  })

  it('leaves the Linkup field silent when only the OpenRouter key is locked', async () => {
    const credentials = lockedKeychain(
      { openrouter: 'sk-still-on-this-computer', linkup: 'lk-opens-fine' },
      ['openrouter'],
    )
    await configureGraphApiCredential('packaged-profile', credentials.bridge, localStorage)
    render(
      <OverlayProvider>
        <TestSettings />
      </OverlayProvider>,
    )

    expect(screen.getByText(words.apiKeyLockedNotice)).toBeInTheDocument()
    expect(screen.queryByText(words.linkupKeyLockedNotice)).toBeNull()
    expect(useGraph.getState().apiKeyLocked).toBe(true)
    expect(useGraph.getState().linkupKeyLocked).toBe(false)
    expect(screen.getByLabelText(words.linkupKeyLabel)).toHaveValue('lk-opens-fine')
  })

  it('says both sentences when the protected store opened neither key', async () => {
    const credentials = lockedKeychain(
      { openrouter: 'sk-still-on-this-computer', linkup: 'lk-still-on-this-computer' },
      ['openrouter', 'linkup'],
    )
    await configureGraphApiCredential('packaged-profile', credentials.bridge, localStorage)
    render(
      <OverlayProvider>
        <TestSettings />
      </OverlayProvider>,
    )

    expect(useGraph.getState().apiKeyLocked).toBe(true)
    expect(useGraph.getState().linkupKeyLocked).toBe(true)
    expect(screen.getByText(words.apiKeyLockedNotice)).toBeInTheDocument()
    expect(screen.getByText(words.linkupKeyLockedNotice)).toBeInTheDocument()
    // Two fields, two sentences, and each names what its own key buys.
    expect(screen.getByLabelText(words.apiKeyLabel)).toHaveValue('')
    expect(screen.getByLabelText(words.linkupKeyLabel)).toHaveValue('')
  })

  it('writes an edited replacement and clears a known Linkup key deliberately', async () => {
    const credentials = keychain({ linkup: 'stored-linkup-secret' })
    await configureGraphApiCredential('packaged-profile', credentials.bridge, localStorage)
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <TestSettings />
      </OverlayProvider>,
    )

    const field = screen.getByLabelText(words.linkupKeyLabel)
    await user.clear(field)
    await user.type(field, 'replacement-linkup-secret')
    await user.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))
    await waitFor(() => expect(credentials.bridge.set).toHaveBeenCalledWith(
      'replacement-linkup-secret',
      'linkup',
    ))

    cleanup()
    document.body.replaceChildren()
    const secondUser = userEvent.setup()
    render(
      <OverlayProvider>
        <TestSettings />
      </OverlayProvider>,
    )
    const secondField = screen.getByLabelText(words.linkupKeyLabel)
    await secondUser.clear(secondField)
    await secondUser.click(screen.getByRole('button', { name: words.settingsSaveAndClose }))
    await waitFor(() => expect(credentials.bridge.clear).toHaveBeenCalledWith('linkup'))
  })

})
