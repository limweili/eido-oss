import { expect, test } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

type BrowserCard = {
  id: string
  kind: 'note'
  blocks: Array<{ id: string; text: string }>
  position: { x: number; y: number }
  createdBy?: { kind: 'agent'; client: string; sessionId: string }
  lastModifiedBy?: { kind: 'agent'; client: string; sessionId: string }
}

type BrowserSavedBoard = {
  version: 1
  cards: BrowserCard[]
  connections: unknown[]
  outputs: unknown[]
  runs: unknown[]
  highlights?: unknown[]
  highlightTags?: unknown[]
  intentLog?: unknown[]
  compactionSummaries?: unknown[]
  aiSettings?: unknown
  updatedAt: string
}

type BrowserIdea = {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  lastOpenedAt: string
}

type EidoDevState = {
  hydrated: boolean
  cards: BrowserCard[]
  currentIdeaId: string | null
  ideas: BrowserIdea[]
  settings: { modLibrary?: unknown[] }
  undoStack: unknown[]
  selection: { kind: string; id: string } | null
  selectedCardIds: string[]
  intentLog: Array<Record<string, unknown>>
  snapshot(): BrowserSavedBoard
  moveCard(id: string, position: { x: number; y: number }): void
  applyAuthoritativeProfileUpdate(update: unknown): {
    status: 'applied' | 'blocked' | 'stale'
    revision: number
  }
}

type EidoDevStore = {
  getState(): EidoDevState
  setState(state: unknown): void
}

test('an agent commit appears live without disturbing the active editor or viewport', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: unknown
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate(() => {
    const store = (window as unknown as { __eido: EidoDevStore }).__eido
    store.setState({
      cards: [{
        id: 'editing-note',
        kind: 'note',
        blocks: [{ id: 'editing-note-block', text: 'User text' }],
        position: { x: 100, y: 100 },
      }],
      connections: [],
      outputs: [],
      runs: [],
      highlights: [],
      highlightTags: [],
      intentLog: [],
      compactionSummaries: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    store.getState().moveCard('editing-note', { x: 120, y: 100 })
    ;(window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }).__EIDO_SET_VIEWPORT__?.({ x: 35, y: 25, zoom: 1 })
  })
  await page.evaluate(async () => {
    for (let index = 0; index < 3; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })

  const nodeSelector = '.react-flow__node-note[data-id="editing-note"]'
  const node = page.locator(nodeSelector)
  const { editor, pressSequentially } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    nodeSelector,
    // The optimized Card body is the native pointer owner; its contained
    // Markdown projection may deliberately be skipped by browser hit testing.
    () => node.locator('.card-body').click({ position: { x: 36, y: 28 } }),
  )
  await pressSequentially(' draft')
  const editorTextBefore = await editor.textContent()
  expect(editorTextBefore).toContain('draft')
  await editor.evaluate((element) => {
    ;(window as unknown as { __agentLiveApplyEditor?: Element }).__agentLiveApplyEditor = element
  })
  const viewportBefore = await page.locator('.react-flow__viewport').evaluate((element) => (
    getComputedStyle(element).transform
  ))

  const outcome = await page.evaluate(() => {
    const store = (window as unknown as { __eido: EidoDevStore }).__eido
    const state = store.getState()
    const previous = state.snapshot()
    const idea = state.ideas.find((candidate) => candidate.id === state.currentIdeaId)
    if (!idea) throw new Error('Missing active synthetic Idea')
    const agentActor = { kind: 'agent' as const, client: 'codex', sessionId: 'agent-session' }
    const agentCard: BrowserCard = {
      id: 'agent-created-live',
      kind: 'note',
      blocks: [{ id: 'agent-created-live-block', text: 'Agent arrived live' }],
      position: { x: 520, y: 120 },
      createdBy: agentActor,
      lastModifiedBy: agentActor,
    }
    const agentEvent = {
      id: 'agent-live-event',
      type: 'card.created',
      at: '2026-07-22T00:02:00.000Z',
      ideaId: idea.id,
      commitId: 'agent:live-transaction',
      actorId: 'eido-profile-agent',
      clientTxnId: 'agent-live-transaction',
      seq: 1,
      cardId: agentCard.id,
      data: { card: agentCard },
    }
    const next: BrowserSavedBoard = {
      ...previous,
      cards: [...previous.cards, agentCard],
      intentLog: [...(previous.intentLog ?? []), agentEvent],
      updatedAt: '2026-07-22T00:02:00.000Z',
    }
    const hydration = (board: BrowserSavedBoard) => ({
      intentActorId: 'eido-desktop-gui',
      idea,
      board,
      ideas: state.ideas,
      userModTemplates: state.settings.modLibrary ?? [],
      modOrigins: {},
    })
    const undoDepth = state.undoStack.length
    const result = state.applyAuthoritativeProfileUpdate({
      previousRevision: 7,
      revision: 8,
      previous: hydration(previous),
      next: hydration(next),
      authoritativeTransition: {
        previous: hydration(previous),
        next: hydration(next),
      },
    })
    const applied = store.getState()
    const currentEditor = document.querySelector(
      `${'.react-flow__node-note[data-id="editing-note"]'} .markdown-card-editor-content[contenteditable="true"]`,
    )
    return {
      result,
      undoDepthBefore: undoDepth,
      undoDepthAfter: applied.undoStack.length,
      selection: applied.selection,
      selectedCardIds: applied.selectedCardIds,
      editorIdentityPreserved: currentEditor === (
        window as unknown as { __agentLiveApplyEditor?: Element }
      ).__agentLiveApplyEditor,
      editorStillFocused: document.activeElement === currentEditor,
      agentEvent: applied.intentLog.find((event) => event.id === 'agent-live-event'),
    }
  })

  expect(outcome).toMatchObject({
    result: { status: 'applied', revision: 8 },
    undoDepthBefore: 1,
    undoDepthAfter: 1,
    selection: { kind: 'card', id: 'editing-note' },
    selectedCardIds: ['editing-note'],
    editorIdentityPreserved: true,
    editorStillFocused: true,
    agentEvent: {
      commitId: 'agent:live-transaction',
      actorId: 'eido-profile-agent',
    },
  })
  await expect(editor).toHaveText(editorTextBefore ?? '')
  await expect(page.locator('.react-flow__node-note[data-id="agent-created-live"]')).toContainText(
    'Agent arrived live',
  )
  await expect.poll(() => page.locator('.react-flow__viewport').evaluate((element) => (
    getComputedStyle(element).transform
  ))).toBe(viewportBefore)
})
