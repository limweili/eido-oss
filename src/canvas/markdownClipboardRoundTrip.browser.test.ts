import { expect, test, type Page } from '@playwright/test'

const MARKDOWN = [
  '## Explore Context',
  '',
  'Keep the **important framing** intact.',
  '',
  '**\\|Explore Context\\|** keeps `\\|code\\|` literal.',
  '',
  '- First level',
  '  - Nested level',
].join('\n')

type DevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{
      id: string
      kind: string
      blocks: Array<{ text: string }>
    }>
    addCard: (kind: 'note', position: { x: number; y: number }) => string
  }
  setState: (state: unknown) => void
}

type DevWindow = Window & typeof globalThis & {
  __eido: DevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedMarkdownResult(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as Partial<DevWindow>
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate((markdown) => {
    const devWindow = window as unknown as DevWindow
    const now = '2026-07-29T00:00:00.000Z'
    devWindow.__eido.setState({
      cards: [
        {
          id: 'ask-card',
          kind: 'askAi',
          blocks: [{ id: 'ask-block', text: 'Format this answer.' }],
          position: { x: 40, y: 80 },
        },
        {
          id: 'result-card',
          kind: 'result',
          blocks: [{ id: 'result-block', text: '' }],
          position: { x: 400, y: 80 },
          size: { width: 460, height: 420 },
        },
      ],
      connections: [
        {
          id: 'ask-result',
          from: { cardId: 'ask-card' },
          to: { cardId: 'result-card' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
      outputs: [{
        id: 'output',
        resultCardId: 'result-card',
        chosenVersionId: 'version',
        versions: [{
          id: 'version',
          number: 1,
          text: markdown,
          createdAt: now,
          fromRunId: 'run',
        }],
      }],
      runs: [{
        id: 'run',
        startedAt: now,
        finishedAt: now,
        askAiCardId: 'ask-card',
        model: 'openai/gpt-4o-mini',
        usedCardIds: [],
        usedConnectionIds: [],
        modIds: [],
        appliedMods: [],
        compiledInstruction: 'Format this answer.',
        producedVersionId: 'version',
        status: 'done',
      }],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 40, y: 20, zoom: 1 })
  }, MARKDOWN)

  const result = page.locator('.react-flow__node-result[data-id="result-card"]')
  await result.locator('.card').click()
  await expect(result.locator('.result-text h2')).toHaveText('Explore Context')
  await expect(result.locator('.result-text strong').filter({ hasText: '|Explore Context|' })).toHaveText('|Explore Context|')
  await expect(result.locator('.result-text code')).toHaveText('\\|code\\|')
  return result
}

test('copied Result Markdown pastes into a Note like Turn into a note', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const result = await seedMarkdownResult(page)

  await result.locator('.card-foot').getByRole('button', { name: 'Copy' }).click()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(MARKDOWN)

  await result.locator('.card-foot').getByRole('button', { name: 'Turn into a note' }).click()
  const directId = await expect.poll(() => page.evaluate(() => (
    (window as unknown as DevWindow).__eido.getState().cards.find((card) => card.kind === 'note')?.id ?? null
  ))).not.toBeNull().then(() => page.evaluate(() => (
    (window as unknown as DevWindow).__eido.getState().cards.find((card) => card.kind === 'note')!.id
  )))

  const ids = await page.evaluate((directId) => {
    const store = (window as unknown as DevWindow).__eido
    const state = store.getState()
    const pastedId = state.addCard('note', { x: 900, y: 420 })
    store.setState({
      cards: store.getState().cards.map((card) => (
        card.id === directId
          ? { ...card, position: { x: 80, y: 80 } }
          : card.id === pastedId
            ? { ...card, position: { x: 520, y: 80 } }
            : card
      )),
    })
    ;(window as unknown as DevWindow).__EIDO_SET_VIEWPORT__?.({ x: 20, y: 20, zoom: 1 })
    return { directId, pastedId }
  }, directId)

  const pastedNode = page.locator(`.react-flow__node-note[data-id="${ids.pastedId}"]`)
  await pastedNode.locator('.note-render').click()
  const editor = pastedNode.locator('.markdown-card-editor-content[contenteditable="true"]')
  await expect(editor).toBeEditable()
  const pasteShortcut = await page.evaluate(() => (
    /Mac/.test(navigator.platform) ? 'Meta+V' : 'Control+V'
  ))
  await editor.press(pasteShortcut)

  const saved = await expect.poll(() => page.evaluate(
    ({ directId, pastedId }) => {
      const cards = (window as unknown as DevWindow).__eido.getState().cards
      const text = (id: string) => cards.find((card) => card.id === id)?.blocks.map((block) => block.text).join('\n')
      return { direct: text(directId), pasted: text(pastedId) }
    },
    ids,
  )).toMatchObject({
    direct: MARKDOWN,
    pasted: expect.stringContaining('## Explore Context'),
  }).then(() => page.evaluate(
    ({ directId, pastedId }) => {
      const cards = (window as unknown as DevWindow).__eido.getState().cards
      const text = (id: string) => cards.find((card) => card.id === id)?.blocks.map((block) => block.text).join('\n') ?? ''
      return { direct: text(directId), pasted: text(pastedId) }
    },
    ids,
  ))
  expect(saved.pasted).toContain('**important framing**')
  expect(saved.pasted).toMatch(/[*-] First level\n {2}[*-] Nested level/)
  expect(saved.pasted).not.toMatch(/\\(?:#|\*|-)|&#x20;/)

  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } })
  const directNode = page.locator(`.react-flow__node-note[data-id="${ids.directId}"] .note-render`)
  const pastedPassive = pastedNode.locator('.note-render')
  await expect(directNode.locator('h2')).toHaveText('Explore Context')
  await expect(pastedPassive.locator('h2')).toHaveText('Explore Context')
  await expect(directNode.locator('strong').filter({ hasText: 'important framing' })).toHaveText('important framing')
  await expect(pastedPassive.locator('strong').filter({ hasText: 'important framing' })).toHaveText('important framing')
  await expect(directNode.locator('strong').filter({ hasText: '|Explore Context|' })).toHaveText('|Explore Context|')
  await expect(pastedPassive.locator('strong').filter({ hasText: '|Explore Context|' })).toHaveText('|Explore Context|')
  await expect(directNode.locator('code')).toHaveText('\\|code\\|')
  await expect(pastedPassive.locator('code')).toHaveText('\\|code\\|')
  await expect(directNode.locator('ul ul li')).toHaveText('Nested level')
  await expect(pastedPassive.locator('ul ul li')).toHaveText('Nested level')
})
