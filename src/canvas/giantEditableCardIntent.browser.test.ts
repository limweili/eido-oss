import { expect, test, type Locator, type Page } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

type EditableCardKind = 'askAi' | 'conversation'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{ id: string; position: { x: number; y: number } }>
    selectedCardIds: string[]
  }
  setState: (state: unknown) => void
}

const CARD_CASES: Array<{
  kind: EditableCardKind
  label: string
  selector: string
}> = [
  { kind: 'askAi', label: 'Ask AI', selector: '.react-flow__node-askAi' },
  { kind: 'conversation', label: 'Conversation', selector: '.react-flow__node-conversation' },
]

function giantMarkdown() {
  const unit = [
    '## Giant editable Card section',
    '',
    'Structured synthetic prose keeps the [passive body](https://example.com) representative.',
    '',
    '- One deterministic bullet exercises Markdown descendants.',
    '- Another keeps selection and cursor styling honest.',
    '',
  ].join('\n')
  return `${unit}\n`.repeat(Math.ceil(1_000_000 / (unit.length + 1))).slice(0, 1_000_000)
}

async function seedCard(
  page: Page,
  cardCase: (typeof CARD_CASES)[number],
  text: string,
) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  const cardId = `release-gated-${cardCase.kind}`
  await page.evaluate(({ id, kind, markdown }) => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__eido.setState({
      cards: [{
        id,
        kind,
        blocks: [{ id: `${id}-block`, text: markdown }],
        position: { x: 220, y: 180 },
        size: { width: 420, height: 300 },
        zIndex: 1,
      }],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  }, { id: cardId, kind: cardCase.kind, markdown: text })

  const node = page.locator(`${cardCase.selector}[data-id="${cardId}"]`)
  await node.waitFor({ state: 'visible' })
  await expect(node.locator('.note-render.markdown')).toBeVisible()
  await expect(node.locator('.markdown-card-editor-transition')).toHaveCount(0)
  return { cardId, node }
}

test('the first body drag of 1M Ask AI and Conversation Cards never mounts their editor', async ({ page }) => {
  test.setTimeout(60_000)
  const markdown = giantMarkdown()

  for (const cardCase of CARD_CASES) {
    const { cardId, node } = await seedCard(page, cardCase, markdown)
    const passive = node.locator('.note-render.markdown')
    const bodyBox = await passive.boundingBox()
    if (!bodyBox) throw new Error(`Missing ${cardCase.label} passive body`)
    const start = await page.evaluate((id) => {
      const state = (window as unknown as { __eido: EidoDevStore }).__eido.getState()
      return state.cards.find((card) => card.id === id)?.position
    }, cardId)
    if (!start) throw new Error(`Missing ${cardCase.label} position`)

    // The body arms the editor handoff. Crossing React Flow's shared five-pixel
    // threshold must cancel that handoff and leave the same pointer sequence
    // available to select and move the Card.
    const from = { x: bodyBox.x + bodyBox.width - 18, y: bodyBox.y + 18 }
    await page.mouse.move(from.x, from.y)
    await page.mouse.down()
    await page.mouse.move(from.x + 90, from.y + 30, { steps: 3 })

    await expect(node).not.toHaveClass(/selected/)
    await expect(node).not.toHaveAttribute('data-live-transition')
    await expect(node.locator('.note-render.markdown')).toBeVisible()
    await expect(node.locator('.markdown-card-editor-transition')).toHaveCount(0)

    await page.mouse.up()
    await expect.poll(() => page.evaluate((id) => {
      const state = (window as unknown as { __eido: EidoDevStore }).__eido.getState()
      return state.cards.find((card) => card.id === id)?.position.x ?? Number.NEGATIVE_INFINITY
    }, cardId)).toBeGreaterThan(start.x + 40)
    await expect.poll(() => page.evaluate(
      () => (window as unknown as { __eido: EidoDevStore }).__eido.getState().selectedCardIds,
    )).toEqual([])
    await expect(node.locator('.markdown-card-editor-transition')).toHaveCount(0)
  }
})

async function readHeadingCaret(editor: Locator) {
  return editor.evaluate((element) => {
    const selection = window.getSelection()
    const heading = element.querySelector('h1')
    const anchor = selection?.anchorNode ?? null
    if (!selection || selection.rangeCount !== 1 || !anchor || !heading?.contains(anchor)) return null
    const beforeRange = document.createRange()
    beforeRange.selectNodeContents(heading)
    beforeRange.setEnd(anchor, selection.anchorOffset)
    const before = beforeRange.toString()
    const headingText = heading.textContent ?? ''
    return { before, after: headingText.slice(before.length) }
  })
}

test('one stationary content click opens Ask AI and Conversation editors at the clicked caret', async ({ page }) => {
  const heading = 'Stationary content click keeps this exact caret'
  const oversizedBody = giantMarkdown().slice(0, 281_000)

  for (const cardCase of CARD_CASES) {
    const { cardId, node } = await seedCard(
      page,
      cardCase,
      `# ${heading}\n\n${oversizedBody}`,
    )
    const passive = node.locator('.note-render.markdown')
    const { editor, pressSequentially } = await activateAndRequireExactReadyMarkdownEditor(
      page,
      `${cardCase.selector}[data-id="${cardId}"]`,
      async () => {
        await passive.click({ position: { x: 180, y: 18 } })
        // The visual selection and identity-colour pulse land before the lazy
        // editor declares exact focus/scroll readiness.
        await expect(node).toHaveClass(/selected/)
        await expect(node).toHaveAttribute('data-live-transition', 'loading')
      },
    )

    await expect(node.locator('.markdown-card-editor-transition')).toHaveAttribute(
      'data-editor-ready',
      'true',
    )
    await expect(node).not.toHaveAttribute('data-live-transition')
    await expect(editor).toBeFocused()
    const caret = await readHeadingCaret(editor)
    expect(caret, `${cardCase.label} caret must remain inside the clicked heading`).not.toBeNull()
    expect(caret!.before.length).toBeGreaterThan(0)
    expect(caret!.after.length).toBeGreaterThan(0)
    expect(`${caret!.before}${caret!.after}`).toBe(heading)

    const suffix = ` ${cardCase.kind.toUpperCase()}-CARET `
    await pressSequentially(suffix, { delay: 0 })
    await expect(editor.locator('h1')).toHaveText(`${caret!.before}${suffix}${caret!.after}`)
  }
})

test('ordinary resident activation never receives the S/O loading marker', async ({ page }) => {
  const cardCase = CARD_CASES[0]!
  const { cardId, node } = await seedCard(
    page,
    cardCase,
    '# Ordinary resident\n\nA short Card is already prepared.',
  )
  let sawLoadingMarker = false
  await node.evaluate((element) => {
    const target = element as HTMLElement & { __loadingObserver?: MutationObserver }
    const observer = new MutationObserver(() => {
      if (target.dataset.liveTransition === 'loading') {
        target.dataset.testObservedLiveTransition = 'true'
      }
    })
    observer.observe(target, { attributes: true, attributeFilter: ['data-live-transition'] })
    target.__loadingObserver = observer
  })

  await activateAndRequireExactReadyMarkdownEditor(
    page,
    `${cardCase.selector}[data-id="${cardId}"]`,
    () => node.locator('.note-render.markdown').click({ position: { x: 120, y: 18 } }),
  )
  sawLoadingMarker = await node.evaluate((element) =>
    (element as HTMLElement).dataset.testObservedLiveTransition === 'true',
  )

  expect(sawLoadingMarker).toBe(false)
  await expect(node).not.toHaveAttribute('data-live-transition')
})

test('the 11th oversized Card activates from painted S without a blank frame', async ({ page }) => {
  test.setTimeout(60_000)
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  const text = giantMarkdown().slice(0, 110_000)
  await page.evaluate((markdown) => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__eido.setState({
      cards: Array.from({ length: 11 }, (_, index) => ({
        id: index === 10 ? 'painted-s-overflow' : `oversize-resident-${index}`,
        kind: 'note',
        blocks: [{ id: `oversize-${index}-block`, text: markdown }],
        position: {
          x: 30 + (index % 4) * 290,
          y: 40 + Math.floor(index / 4) * 220,
        },
        size: { width: 250, height: 180 },
        zIndex: index + 1,
      })),
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  }, text)

  const board = page.locator('.board-flow')
  await expect(board).toHaveAttribute('data-oversize-passive-card-count', '10')
  await expect(board).toHaveAttribute('data-safety-card-count', '1')
  await expect(page.locator('.react-flow__node[data-id="painted-s-overflow"]')).toHaveCount(0)
  await expect.poll(() => page.locator('[data-board-overview-layer]').evaluate((canvas) =>
    Number((canvas as HTMLCanvasElement).dataset.safetyPreviewLineCount ?? 0),
  )).toBeGreaterThan(0)
  await page.evaluate(() => window.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 }))
  await expect.poll(() => page.locator('.react-flow__viewport').evaluate((viewport) =>
    getComputedStyle(viewport).transform,
  )).toBe('matrix(1, 0, 0, 1, 0, 0)')

  await page.evaluate(() => {
    const probe = window as typeof window & {
      __EIDO_S_TO_L_BLANK_FRAME__?: boolean
      __EIDO_S_TO_L_PROBE_ACTIVE__?: boolean
    }
    probe.__EIDO_S_TO_L_BLANK_FRAME__ = false
    probe.__EIDO_S_TO_L_PROBE_ACTIVE__ = true
    const sample = () => {
      if (!probe.__EIDO_S_TO_L_PROBE_ACTIVE__) return
      const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
      const safetyLines = Number(canvas?.dataset.safetyPreviewLineCount ?? 0)
      const node = document.querySelector<HTMLElement>(
        '.react-flow__node[data-id="painted-s-overflow"]',
      )
      const nativeVisible = Boolean(
        node &&
        node.querySelector('.note-render.markdown, .markdown-card-editor-transition') &&
        node.getBoundingClientRect().width > 0 &&
        Number(getComputedStyle(node).opacity) > 0,
      )
      if (safetyLines === 0 && !nativeVisible) probe.__EIDO_S_TO_L_BLANK_FRAME__ = true
      requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })

  const targetPosition = { x: 30 + (10 % 4) * 290, y: 40 + Math.floor(10 / 4) * 220 }
  const boardBox = await board.boundingBox()
  if (!boardBox) throw new Error('Missing Board bounds')
  const nodeSelector = '.react-flow__node-note[data-id="painted-s-overflow"]'
  await page.mouse.click(
    boardBox.x + targetPosition.x + 125,
    boardBox.y + targetPosition.y + 90,
  )
  const node = page.locator(nodeSelector)
  await expect(node).toHaveClass(/selected/)
  await expect(node).toHaveAttribute('data-live-transition', 'loading')
  await expect(node.locator('.note-render.markdown')).toBeVisible()
  const transition = node.locator('.markdown-card-editor-transition')
  await expect(transition).toHaveAttribute('data-editor-ready', 'true')
  await expect(node.locator('.markdown-card-editor-content[contenteditable="true"]')).toBeFocused()
  await expect(node).not.toHaveAttribute('data-live-transition')
  await page.evaluate(() => {
    const probe = window as typeof window & { __EIDO_S_TO_L_PROBE_ACTIVE__?: boolean }
    probe.__EIDO_S_TO_L_PROBE_ACTIVE__ = false
  })
  expect(await page.evaluate(() =>
    (window as typeof window & { __EIDO_S_TO_L_BLANK_FRAME__?: boolean })
      .__EIDO_S_TO_L_BLANK_FRAME__,
  )).toBe(false)
})
