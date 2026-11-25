import { expect, test, type Locator, type Page } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{ id: string; position: { x: number; y: number } }>
    selection: { kind: string; id: string } | null
  }
  setState: (state: unknown) => void
}

type EditorCase = {
  addLabel: string
  nodeFor: (page: Page) => Locator
  clearExisting?: boolean
}

async function setTestViewport(
  page: Page,
  viewport: { x: number; y: number; zoom: number } = { x: 0, y: 0, zoom: 1 },
) {
  await page.waitForFunction(() => Boolean(
    (window as unknown as { __EIDO_SET_VIEWPORT__?: unknown }).__EIDO_SET_VIEWPORT__,
  ))
  await page.evaluate((nextViewport) => {
    ;(window as unknown as {
      __EIDO_SET_VIEWPORT__?: (next: { x: number; y: number; zoom: number }) => void
    }).__EIDO_SET_VIEWPORT__?.(nextViewport)
  }, viewport)
  await page.evaluate(async () => {
    for (let index = 0; index < 2; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })
}

async function overviewCardPaintBounds(
  page: Page,
  cardPosition: { x: number; y: number },
  zoom: number,
) {
  return page.evaluate(({ position, zoom }) => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    const context = canvas?.getContext('2d')
    if (!canvas || !context) throw new Error('Missing overview canvas')
    const bounds = canvas.getBoundingClientRect()
    const ratioX = canvas.width / bounds.width
    const ratioY = canvas.height / bounds.height
    const pixelX = Math.floor((position.x + 20) * zoom * ratioX)
    const pixelY = Math.floor((position.y + 20) * zoom * ratioY)
    const alphaAt = (x: number, y: number) => context.getImageData(x, y, 1, 1).data[3]
    const bodyAlpha = alphaAt(pixelX, pixelY)
    if (bodyAlpha === 0) throw new Error('Missing overview card body')
    const isBody = (x: number, y: number) => Math.abs(alphaAt(x, y) - bodyAlpha) <= 1
    let minX = pixelX
    let maxX = pixelX
    let minY = pixelY
    let maxY = pixelY
    while (minX > 0 && isBody(minX - 1, pixelY)) minX -= 1
    while (maxX < canvas.width - 1 && isBody(maxX + 1, pixelY)) maxX += 1
    while (minY > 0 && isBody(pixelX, minY - 1)) minY -= 1
    while (maxY < canvas.height - 1 && isBody(pixelX, maxY + 1)) maxY += 1
    return {
      x: bounds.x + minX / ratioX,
      y: bounds.y + minY / ratioY,
      width: (maxX - minX + 1) / ratioX,
      height: (maxY - minY + 1) / ratioY,
    }
  }, { position: cardPosition, zoom })
}

const textEditorCases: EditorCase[] = [
  {
    addLabel: 'Add note',
    nodeFor: (page) => page.locator('.react-flow__node-note').last(),
  },
  {
    addLabel: 'Ask AI',
    nodeFor: (page) => page.locator('.react-flow__node-askAi').last(),
  },
  {
    addLabel: 'Conversation',
    nodeFor: (page) => page.locator('.react-flow__node-conversation').last(),
  },
  {
    addLabel: 'Title',
    nodeFor: (page) => page.locator('.react-flow__node-title').last(),
    clearExisting: true,
  },
]

test('font readiness invalidates an offscreen paper footprint before one coherent Overview remount', async ({ page }) => {
  let openSansRequestCount = 0
  let releaseOpenSans = () => {}
  const openSansGate = new Promise<void>((resolve) => {
    releaseOpenSans = resolve
  })
  await page.route('**/open-sans-latin-variable-*.woff2', async (route) => {
    openSansRequestCount += 1
    await openSansGate
    await route.continue()
  })
  await page.exposeFunction('__eidoReleaseOpenSans', () => releaseOpenSans())

  const markdownSource = [
    '# One paper surface',
    '',
    'measured highlight phrase widely',
    '',
    '**bold**, *emphasis*, `code`, and [a link](https://eido.test) stay on the same paper.',
    '',
    '> A quoted thought',
    '',
    '- Alpha',
    '- Beta',
    '',
    '1. One',
    '2. Two',
    '',
    '---',
    '',
    '```ts',
    'const value = 1',
    '```',
    '',
    '| Name | Score |',
    '| --- | --- |',
    '| Ada | 10 |',
    '| Linus | 7 |',
    '',
    'Keep ==this intrinsic mark== visible.',
  ].join('\n')

  await page.goto('/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const devWindow = window as unknown as { __eido?: EidoDevStore }
    return Boolean(devWindow.__eido?.getState().hydrated)
  })

  await page.evaluate((text) => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'paper-note',
          kind: 'note',
          blocks: [{ id: 'paper-note-block', text }],
          position: { x: 120, y: 80 },
          // Keep the link's text geometry in this fixture without a later
          // automatic preview adding an attachment panel to the paper.
          meta: { noteFontSize: 2, linkPreviewDismissedUrls: ['https://eido.test'] },
        },
        {
          id: 'paper-target',
          kind: 'note',
          blocks: [{ id: 'paper-target-block', text }],
          position: { x: 700, y: 80 },
          meta: { noteFontSize: 2, linkPreviewDismissedUrls: ['https://eido.test'] },
        },
      ],
      connections: [{
        id: 'paper-connection',
        from: { cardId: 'paper-note' },
        to: { cardId: 'paper-target' },
        strength: 'strong',
        polarity: 'helps',
        role: 'feeds',
      }],
      outputs: [],
      runs: [],
      intentLog: [],
      highlights: [{
        id: 'paper-highlight',
        cardId: 'paper-note',
        tagId: 'paper-tag',
        text: 'measured highlight phrase',
        occurrence: 0,
        createdAt: '2026-07-18T00:00:00.000Z',
      }],
      highlightTags: [{
        id: 'paper-tag',
        name: 'Measured',
        color: 'yellow',
        createdAt: '2026-07-18T00:00:00.000Z',
      }],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
  }, markdownSource)
  await setTestViewport(page)

  const settlePaper = async () => {
    const ready = await page.evaluate(async () => {
      await document.fonts.ready
      for (let frame = 0; frame < 2; frame += 1) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      }
      return document.fonts.check('15px "Open Sans"')
    })
    expect(ready).toBe(true)
  }

  const textRuns = [
    'One paper surface',
    'measured highlight phrase',
    'widely',
    'bold',
    'emphasis',
    'code',
    'a link',
    'A quoted thought',
    'Alpha',
    'Beta',
    'One',
    'Two',
    'const value = 1',
    'Name',
    'Score',
    'Ada',
    '10',
    'Linus',
    '7',
    'this intrinsic mark',
  ]
  const blockRuns = ['One paper surface', 'measured highlight phrase', 'A quoted thought', 'Alpha', 'const value = 1']
  const layout = (markdown: Locator) =>
    markdown.evaluate((element, { runs, blockRuns }) => {
      const cardRect = element.closest('.card')!.getBoundingClientRect()
      const rootRect = element.getBoundingClientRect()
      const round = (value: number) => Math.round(value * 1000) / 1000
      const relative = (rect: DOMRect) => ({
        x: round(rect.x - cardRect.x),
        y: round(rect.y - cardRect.y),
        width: round(rect.width),
        height: round(rect.height),
      })
      const textNode = (needle: string) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
        let node = walker.nextNode()
        while (node) {
          const value = node.textContent ?? ''
          const index = value.indexOf(needle)
          if (index >= 0) return { node, index }
          node = walker.nextNode()
        }
        return null
      }
      const textRect = (needle: string) => {
        const found = textNode(needle)
        if (!found) return null
        const range = document.createRange()
        range.setStart(found.node, found.index)
        range.setEnd(found.node, found.index + needle.length)
        return relative(range.getBoundingClientRect())
      }
      const blockRect = (needle: string) => {
        const found = textNode(needle)
        const parent = found?.node.parentElement?.closest('h1, p, li, blockquote, pre, td, th')
        return parent ? relative(parent.getBoundingClientRect()) : null
      }
      const style = getComputedStyle(element)
      return {
        typography: {
          fontFamily: style.fontFamily,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
          lineHeight: style.lineHeight,
        },
        card: {
          x: round(cardRect.x),
          y: round(cardRect.y),
          width: round(cardRect.width),
          height: round(cardRect.height),
        },
        root: relative(rootRect),
        runs: Object.fromEntries(runs.map((run) => [run, textRect(run)])),
        blocks: Object.fromEntries(blockRuns.map((run) => [run, blockRect(run)])),
        formats: {
          heading: Boolean(element.querySelector('h1')),
          strong: Boolean(element.querySelector('strong')),
          emphasis: Boolean(element.querySelector('em')),
          link: Boolean(element.querySelector('a')),
          quote: Boolean(element.querySelector('blockquote')),
          unorderedList: Boolean(element.querySelector('ul')),
          orderedList: Boolean(element.querySelector('ol')),
          rule: Boolean(element.querySelector('hr')),
          codeBlock: Boolean(element.querySelector('pre, .cm-editor')),
          table: Boolean(element.querySelector('table')),
          mark: Boolean(element.querySelector('mark')),
        },
      }
    }, { runs: textRuns, blockRuns })

  type Rect = { x: number; y: number; width: number; height: number }
  const expectLayoutClose = async (
    actualPromise: ReturnType<typeof layout>,
    expected: Awaited<ReturnType<typeof layout>>,
  ) => {
    const actual = await actualPromise
    expect(actual.typography).toEqual(expected.typography)
    expect(actual.formats).toEqual(expected.formats)
    const compareRect = (label: string, received: Rect | null, wanted: Rect | null) => {
      expect(received === null, `${label} presence`).toBe(wanted === null)
      if (!received || !wanted) return
      for (const key of ['x', 'y', 'width', 'height'] as const) {
        expect(Math.abs(received[key] - wanted[key]), `${label}.${key}`).toBeLessThanOrEqual(0.02)
      }
    }
    compareRect('card', actual.card, expected.card)
    compareRect('root', actual.root, expected.root)
    for (const key of Object.keys(expected.runs)) {
      compareRect(`run:${key}`, actual.runs[key], expected.runs[key])
    }
    for (const key of Object.keys(expected.blocks)) {
      compareRect(`block:${key}`, actual.blocks[key], expected.blocks[key])
    }
  }

  const nodeSelector = '.react-flow__node-note[data-id="paper-note"]'
  const node = page.locator(nodeSelector)
  const markdown = node.locator('.note-render.markdown.e-prose.t-prose-m')
  await markdown.waitFor({ state: 'visible' })
  await expect.poll(() => openSansRequestCount).toBeGreaterThan(0)
  expect(await page.evaluate(() => document.fonts.check('15px "Open Sans"'))).toBe(false)
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))

  const fallback = await layout(markdown)

  await setTestViewport(page, { x: 0, y: 0, zoom: 0.25 })
  await expect(node).toHaveCount(0)
  expect(await page.evaluate((id) => window.__EIDO_OVERVIEW_CARD_IDS__?.has(id) ?? false, 'paper-note')).toBe(true)
  await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())
  const fallbackOverview = await overviewCardPaintBounds(page, { x: 120, y: 80 }, 0.25)
  expect(Math.abs(fallbackOverview.height / 0.25 - fallback.card.height)).toBeLessThanOrEqual(8)

  await page.evaluate(() => (
    window as unknown as { __eidoReleaseOpenSans: () => Promise<void> }
  ).__eidoReleaseOpenSans())
  await settlePaper()
  await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())
  await expect.poll(async () => (
    await overviewCardPaintBounds(page, { x: 120, y: 80 }, 0.25)
  ).height).not.toBeCloseTo(fallbackOverview.height, 1)

  await setTestViewport(page)
  await markdown.waitFor({ state: 'visible' })
  await settlePaper()

  const before = await layout(markdown)
  expect(Math.abs(before.card.height - fallback.card.height)).toBeGreaterThan(1)
  expect(before.typography.fontFamily).toContain('Open Sans')
  expect(before.typography).toMatchObject({ fontSize: '15px', fontWeight: '400', lineHeight: '24px' })
  expect(Object.values(before.formats).every(Boolean)).toBe(true)
  expect(Object.values(before.runs).every(Boolean)).toBe(true)
  expect(Object.values(before.blocks).every(Boolean)).toBe(true)

  const highlight = markdown.locator('mark.painted-highlight')
  await expect(highlight).toHaveText('measured highlight phrase')
  const highlightMetrics = await highlight.evaluate((element) => {
    const style = getComputedStyle(element)
    const rootStyle = getComputedStyle(element.closest('.e-prose')!)
    const px = (value: string) => Number.parseFloat(value) || 0
    return {
      color: style.color,
      rootColor: rootStyle.color,
      background: style.backgroundColor,
      fontFamily: style.fontFamily,
      rootFontFamily: rootStyle.fontFamily,
      fontSize: style.fontSize,
      rootFontSize: rootStyle.fontSize,
      lineHeight: style.lineHeight,
      rootLineHeight: rootStyle.lineHeight,
      horizontalCompensation: px(style.paddingLeft) + px(style.paddingRight) + px(style.marginLeft) + px(style.marginRight),
      verticalCompensation: px(style.paddingTop) + px(style.paddingBottom) + px(style.marginTop) + px(style.marginBottom),
    }
  })
  expect(highlightMetrics.background).not.toBe('rgba(0, 0, 0, 0)')
  expect(highlightMetrics.color).toBe(highlightMetrics.rootColor)
  expect(highlightMetrics.fontFamily).toBe(highlightMetrics.rootFontFamily)
  expect(highlightMetrics.fontSize).toBe(highlightMetrics.rootFontSize)
  expect(highlightMetrics.lineHeight).toBe(highlightMetrics.rootLineHeight)
  expect(highlightMetrics.horizontalCompensation).toBeCloseTo(0, 5)
  expect(highlightMetrics.verticalCompensation).toBeCloseTo(0, 5)

  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    nodeSelector,
    () => markdown.click({ position: { x: 24, y: 24 } }),
  )
  await settlePaper()
  await expectLayoutClose(layout(editor), before)

  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await markdown.waitFor({ state: 'visible' })
  await settlePaper()
  await expectLayoutClose(layout(markdown), before)

  const target = page.locator('.react-flow__node-note[data-id="paper-target"]')
  const targetBounds = await target.locator('.card').boundingBox()
  expect(targetBounds).not.toBeNull()
  expect(Math.abs(targetBounds!.height - before.card.height)).toBeLessThanOrEqual(0.02)

  await setTestViewport(page, { x: 0, y: 0, zoom: 0.25 })
  await expect(node).toHaveCount(0)
  await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())
  const finalOverview = await overviewCardPaintBounds(page, { x: 120, y: 80 }, 0.25)
  expect(Math.abs(finalOverview.height / 0.25 - before.card.height)).toBeLessThanOrEqual(8)

  const canvasBounds = await page.locator('[data-board-overview-layer]').boundingBox()
  if (!canvasBounds) throw new Error('Missing overview canvas bounds')
  const connectionMidpoint = {
    x: canvasBounds.x + ((120 + 260 + 700) / 2) * 0.25,
    y: canvasBounds.y + (80 + before.card.height / 2) * 0.25,
  }
  await page.mouse.move(connectionMidpoint.x, connectionMidpoint.y)
  await expect.poll(() => page.locator('.board-flow').getAttribute('data-hovered-connection-id')).toBe('paper-connection')

  await page.mouse.click(
    canvasBounds.x + (120 + 20) * 0.25,
    canvasBounds.y + (80 + before.card.height - 8) * 0.25,
  )
  await expect.poll(() => page.evaluate(() => (
    window as unknown as { __eido: EidoDevStore }
  ).__eido.getState().selection)).toEqual({ kind: 'card', id: 'paper-note' })
})

test('selected card text editors keep focus while typing', async ({ page }) => {
  await page.goto('/')

  for (const [index, card] of textEditorCases.entries()) {
    await page.locator('.bottom-dock').getByRole('button', { name: card.addLabel }).click()

    const node = card.nodeFor(page)
    await node.waitFor({ state: 'visible' })

    if (card.addLabel !== 'Title') {
      // Selection alone deliberately keeps every Markdown Card passive so a
      // first drag cannot instantiate the rich editor. Editing begins from a
      // stationary release on the text surface itself.
      const passiveBody = node.locator('.note-render')
      await passiveBody.waitFor({ state: 'visible' })
      await passiveBody.click()
    }

    const editor =
      card.addLabel === 'Title'
        ? node.locator('textarea').first()
        : node.locator('[contenteditable="true"][role="textbox"]').first()
    await editor.waitFor({ state: 'visible' })
    await editor.click()
    await expect(editor).toBeFocused()

    if (card.clearExisting) {
      await editor.selectText()
      await editor.press('Backspace')
    }

    const typed = `focus stays ${index}`
    await page.keyboard.type(typed, { delay: 40 })

    if (card.addLabel === 'Title') {
      await expect(editor).toHaveValue(typed)
    } else {
      await expect(editor).toHaveText(typed)
    }
    await expect(editor).toBeFocused()
    await expect
      .poll(() => editor.evaluate((element) => Boolean(element.closest('.react-flow__node')?.classList.contains('selected'))))
      .toBe(true)
  }
})

test('same-id Idea switches remount Note, Ask AI, and Conversation editor-local state', async ({ page }) => {
  const cases = [
    { kind: 'note', selector: '.react-flow__node-note' },
    { kind: 'askAi', selector: '.react-flow__node-askAi' },
    { kind: 'conversation', selector: '.react-flow__node-conversation' },
  ] as const

  for (const cardCase of cases) {
    await page.goto('/')
    await page.waitForFunction(() => Boolean(
      (window as unknown as { __eido?: EidoDevStore }).__eido?.getState().hydrated,
    ))

    const setIdeaCard = async (ideaId: string, text: string) => {
      await page.evaluate(({ currentIdeaId, kind, cardText }) => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        devWindow.__eido.setState({
          currentIdeaId,
          cards: [{
            id: 'same-id-editable-card',
            kind,
            blocks: [{ id: `same-id-${kind}-block`, text: cardText }],
            position: { x: 120, y: 80 },
            size: { width: 380, height: 280 },
          }],
          connections: [],
          outputs: [],
          runs: [],
          intentLog: [],
          selection: { kind: 'card', id: 'same-id-editable-card' },
          selectedCardIds: ['same-id-editable-card'],
          undoStack: [],
          redoStack: [],
          activeTool: 'select',
        })
      }, { currentIdeaId: ideaId, kind: cardCase.kind, cardText: text })
    }

    await setIdeaCard('same-id-idea-a', `Idea A ${cardCase.kind} text`)
    await setTestViewport(page)
    const node = page.locator(`${cardCase.selector}[data-id="same-id-editable-card"]`)
    const passive = node.locator('.note-render.markdown')
    await expect(passive).toContainText(`Idea A ${cardCase.kind} text`)
    await passive.click()
    await expect(node.locator('.markdown-card-editor-content')).toBeEditable()
    await node.locator('.card').evaluate((element) => {
      ;(window as unknown as { __SAME_ID_IDEA_A_CARD__?: Element }).__SAME_ID_IDEA_A_CARD__ = element
    })

    await setIdeaCard('same-id-idea-b', `Idea B ${cardCase.kind} text`)
    await expect(node.locator('.markdown-card-editor-content')).toHaveCount(0)
    await expect(passive).toContainText(`Idea B ${cardCase.kind} text`)
    expect(await node.locator('.card').evaluate((element) => (
      window as unknown as { __SAME_ID_IDEA_A_CARD__?: Element }
    ).__SAME_ID_IDEA_A_CARD__ !== element)).toBe(true)

    await setIdeaCard('same-id-idea-a', `Idea A ${cardCase.kind} text`)
    await expect(node.locator('.markdown-card-editor-content')).toHaveCount(0)
    await expect(passive).toContainText(`Idea A ${cardCase.kind} text`)
  }
})

test('one passive Note click delivers its first typing intent to the same ready editor', async ({ page }) => {
  const markdown = [
    '# First-click editor contract',
    '',
    'A **formatted** long Note keeps the passive surface present while its live editor activates.',
    '',
    '> The first click must carry the intended typing interaction across that handoff.',
    '',
    '- Preserve exact editor identity',
    '- Preserve focus',
    '- Preserve a contained selection',
    '',
    '| Gate | Expected |',
    '| --- | --- |',
    '| Focus | exact contenteditable |',
    '| Selection | contained |',
    '',
    ...Array.from({ length: 24 }, (_, index) => `Paragraph ${index + 1}: synthetic privacy-safe editor readiness text.`),
  ].join('\n\n')
  const suffix = ' FIRSTCLICKSUFFIX410'

  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as { __eido?: EidoDevStore }
    return Boolean(devWindow.__eido?.getState().hydrated)
  })
  await page.evaluate((text) => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [{
        id: 'first-click-note',
        kind: 'note',
        blocks: [{ id: 'first-click-note-block', text }],
        position: { x: 120, y: 80 },
        size: { width: 420, height: 620 },
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
  }, markdown)
  await setTestViewport(page)

  const node = page.locator('.react-flow__node-note[data-id="first-click-note"]')
  const passive = node.locator('.note-render.markdown')
  await passive.waitFor({ state: 'visible' })

  // This is the only click on the Note/editor path. The editor must replay the
  // click's typing intent without a second focus click.
  const { editor, pressSequentially } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="first-click-note"]',
    () => passive.click({ position: { x: 24, y: 24 } }),
  )
  const transition = node.locator('.markdown-card-editor-transition')
  await editor.evaluate((element) => {
    ;(window as unknown as { __firstClickEditorIdentity?: Element }).__firstClickEditorIdentity = element
  })
  await expect(transition).toHaveAttribute('data-editor-ready', 'true')
  await expect.poll(() => editor.evaluate((element) => {
    const selection = window.getSelection()
    const contains = (node: Node | null) => node !== null && (node === element || element.contains(node))
    return Boolean(
      element.isConnected &&
      document.activeElement === element &&
      selection &&
      selection.rangeCount === 1 &&
      selection.isCollapsed &&
      contains(selection.anchorNode) &&
      contains(selection.focusNode) &&
      selection.anchorNode === selection.focusNode &&
      selection.anchorOffset === selection.focusOffset,
    )
  })).toBe(true)
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))
  expect(await editor.evaluate((element) => {
    const selection = window.getSelection()
    const identity = (window as unknown as { __firstClickEditorIdentity?: Element }).__firstClickEditorIdentity
    const contains = (node: Node | null) => node !== null && (node === element || element.contains(node))
    return Boolean(
      identity === element &&
      element.isConnected &&
      document.activeElement === element &&
      selection &&
      selection.rangeCount === 1 &&
      selection.isCollapsed &&
      contains(selection.anchorNode) &&
      contains(selection.focusNode) &&
      selection.anchorNode === selection.focusNode &&
      selection.anchorOffset === selection.focusOffset,
    )
  })).toBe(true)

  const clickedSelection = await editor.evaluate((element) => {
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
  expect(clickedSelection).not.toBeNull()
  expect(`${clickedSelection!.before}${clickedSelection!.after}`).toBe('First-click editor contract')
  const clickedHeading = `${clickedSelection!.before}${suffix}${clickedSelection!.after}`

  await pressSequentially(suffix, { delay: 0 })

  await expect(editor).toContainText(suffix.trim())
  await expect(editor.locator('h1')).toHaveText(clickedHeading)
  expect(await editor.evaluate(
    (element) => (window as unknown as { __firstClickEditorIdentity?: Element }).__firstClickEditorIdentity === element,
  )).toBe(true)
  await expect.poll(() => page.evaluate((expectedSuffix) => {
    const state = (window as unknown as {
      __eido?: { getState: () => { cards: Array<{ id: string; blocks: Array<{ text: string }> }> } }
    }).__eido?.getState()
    const saved = state?.cards.find(({ id }) => id === 'first-click-note')?.blocks
      .map(({ text }) => text)
      .join('\n') ?? ''
    return saved.includes(expectedSuffix)
  }, suffix.trim())).toBe(true)
  // The stored Markdown may escape or normalize heading whitespace. Its
  // passive projection must retain the complete text inserted at the click.
  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await expect(editor).toHaveCount(0)
  await expect(passive.locator('h1')).toHaveText(clickedHeading)
})

test('shift-click extends a Markdown editor selection without clearing the card selection', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean((window as unknown as { __eido?: EidoDevStore }).__eido?.getState().hydrated))
  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'selection-note',
          kind: 'note',
          blocks: [{ id: 'selection-note-block', text: 'Select this range of note text.' }],
          position: { x: 120, y: 120 },
        },
      ],
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
  })

  const node = page.locator('.react-flow__node-note[data-id="selection-note"]')
  const passiveText = node.locator('.note-render')
  await passiveText.click()
  const editor = node.locator('.markdown-card-editor-content')
  await expect(editor).toBeEditable()

  await editor.click({ position: { x: 3, y: 8 } })
  await page.keyboard.down('Shift')
  await editor.click({ position: { x: 120, y: 8 } })
  await page.keyboard.up('Shift')

  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).not.toBe('')
  await expect
    .poll(() => node.evaluate((element) => element.classList.contains('selected')))
    .toBe(true)
})

test('entering edit mode keeps the camera stable for a fixed-height note extending below the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 709, height: 1107 })
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'tall-note',
          kind: 'note',
          blocks: [{
            id: 'tall-note-block',
            text: [
              '### Design Brief — Real-Time AI Prompt Instrument',
              '**Goal**  ',
              'Create a visual control surface where users *shape intent* in real time before an AI executes it. The visualization should provide immediate tactile feedback without requiring users to read or inspect prompt text.',
              '**Core Principle**  ',
              'The live experience is **shaping**, not **generation**. Prompt text is an internal compilation artifact and should remain hidden.',
              '**Requirements**',
              '- Every knob, dial and toggle produces **instant visual feedback (60 FPS)**.',
              '- Visualizations are **deterministic**, driven entirely by the current control state—not by the AI response.',
              '- The AI executes asynchronously after the instruction is complete; reviewing results is a separate phase.',
              '**Visualization Concepts**',
              '1. **Semantic Oscilloscope**',
              '   - Represent semantic properties (clarity, specificity, novelty, constraint, autonomy, etc.) as animated waves or fields.',
              '   - Turning controls immediately changes the waveform, giving the feeling of "playing" the instruction.',
              '2. **Mission Capsule**',
              '   - Represent the instruction as a single evolving object.',
              '   - As the user adds constraints, context, or goals, the object becomes more structured, stable, dense, or refined.',
              '   - The object communicates **instruction quality and completeness**, not AI output.',
            ].join('\n'),
          }],
          position: { x: 100, y: 300 },
          size: { width: 320, height: 620 },
        },
      ],
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
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: -90, y: -185, zoom: 1.7 })
  })
  await page.evaluate(async () => {
    for (let index = 0; index < 4; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })
  await page.evaluate(() => {
    ;(window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }).__EIDO_SET_VIEWPORT__?.({ x: -90, y: -185, zoom: 1.7 })
  })
  await page.evaluate(async () => {
    for (let index = 0; index < 2; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })

  const node = page.locator('.react-flow__node-note[data-id="tall-note"]')
  await node.locator('.note-render').click({ position: { x: 300, y: 100 } })
  await expect(node.locator('.markdown-card-editor-content')).toBeEditable()
  await node.locator('.note-body').evaluate((element) => {
    element.scrollTop = 0
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
  })
  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await expect(node.locator('.markdown-card-editor-content')).not.toBeAttached()
  await page.evaluate(async () => {
    for (let index = 0; index < 2; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  })
  const transformBefore = await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewport) throw new Error('Missing React Flow viewport')
    return getComputedStyle(viewport).transform
  })
  await page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewport) throw new Error('Missing React Flow viewport')
    const probe: {
      initialStyle: string | null
      styles: Array<string | null>
      observer: MutationObserver
    } = {
      initialStyle: viewport.getAttribute('style'),
      styles: [],
      observer: new MutationObserver(() => undefined),
    }
    probe.observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) probe.styles.push(mutation.oldValue)
      probe.styles.push(viewport.getAttribute('style'))
    })
    probe.observer.observe(viewport, {
      attributes: true,
      attributeFilter: ['style'],
      attributeOldValue: true,
    })
    ;(window as unknown as { __eidoViewportMutationProbe?: typeof probe }).__eidoViewportMutationProbe = probe
  })
  await page.evaluate(() => {
    const scrolls: Array<{
      className: string
      scrollTop: number
      tagName: string
    }> = []
    const onScroll = (event: Event) => {
      const target = event.target
      if (!(target instanceof HTMLElement)) return
      scrolls.push({
        className: target.className,
        scrollTop: target.scrollTop,
        tagName: target.tagName,
      })
    }
    document.addEventListener('scroll', onScroll, true)
    ;(window as unknown as {
      __eidoAncestorScrollProbe?: {
        scrolls: typeof scrolls
        stop: () => void
      }
    }).__eidoAncestorScrollProbe = {
      scrolls,
      stop: () => document.removeEventListener('scroll', onScroll, true),
    }
  })
  const cardBoundsBefore = await node.locator('.card').boundingBox()
  if (!cardBoundsBefore) throw new Error('Missing tall note card')
  await page.evaluate(() => {
    const samples: Array<{
      board: { top: number; height: number }
      transform: string
      dockHeight: number
      pageY: number
    }> = []
    const sample = () => {
      const board = document.querySelector<HTMLElement>('.board-wrap')?.getBoundingClientRect()
      const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
      const dock = document.querySelector<HTMLElement>('.dock-group.context')?.getBoundingClientRect()
      if (!board || !viewport) throw new Error('Missing board geometry')
      samples.push({
        board: { top: board.top, height: board.height },
        transform: getComputedStyle(viewport).transform,
        dockHeight: dock?.height ?? 0,
        pageY: window.scrollY,
      })
      if (samples.length < 18) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    ;(window as unknown as { __eidoSelectionSamples?: typeof samples }).__eidoSelectionSamples = samples
  })
  await page.evaluate(() => {
    const probe: {
      frames: number
      samples: Array<{ placeholderOpacity: number; editorOpacity: number }>
    } = { frames: 0, samples: [] }
    const sample = () => {
      const placeholder = document.querySelector<HTMLElement>('.markdown-card-editor-placeholder')
      const editor = document.querySelector<HTMLElement>('.markdown-card-editor-boundary')
      if (placeholder && editor) {
        probe.samples.push({
          placeholderOpacity: Number.parseFloat(getComputedStyle(placeholder).opacity),
          editorOpacity: Number.parseFloat(getComputedStyle(editor).opacity),
        })
      }
      probe.frames += 1
      if (probe.frames < 30) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
    ;(window as unknown as { __eidoEditorTransitionProbe?: typeof probe }).__eidoEditorTransitionProbe = probe
  })
  await node.locator('.note-render').click({ position: { x: 300, y: 100 } })
  await expect(node.locator('.markdown-card-editor-content')).toBeEditable()
  const editorTransition = node.locator('.markdown-card-editor-transition')
  await expect(editorTransition).toHaveAttribute('data-editor-ready', 'true')
  await expect(editorTransition.locator('.markdown-card-editor-placeholder')).toBeAttached()
  await expect.poll(() => page.evaluate(
    () => (window as unknown as { __eidoEditorTransitionProbe?: { frames: number } })
      .__eidoEditorTransitionProbe?.frames ?? 0,
  )).toBe(30)
  const editorSurfaceSamples = await page.evaluate(
    () => (window as unknown as {
      __eidoEditorTransitionProbe?: {
        samples: Array<{ placeholderOpacity: number; editorOpacity: number }>
      }
    }).__eidoEditorTransitionProbe?.samples ?? [],
  )
  expect(editorSurfaceSamples.length).toBeGreaterThan(0)
  expect(editorSurfaceSamples.some(
    ({ placeholderOpacity, editorOpacity }) => placeholderOpacity > 0.05 && editorOpacity > 0.05,
  )).toBe(false)
  await expect.poll(() => page.evaluate(
    () => (window as unknown as { __eidoSelectionSamples?: unknown[] }).__eidoSelectionSamples?.length ?? 0,
  )).toBe(18)
  const selectionSamples = await page.evaluate(
    () => (window as unknown as { __eidoSelectionSamples?: Array<{
      board: { top: number; height: number }
      transform: string
      dockHeight: number
      pageY: number
    }> }).__eidoSelectionSamples ?? [],
  )
  expect(selectionSamples.some((sample) => sample.dockHeight > 0)).toBe(true)
  expect(selectionSamples.map((sample) => sample.transform)).toEqual(
    Array.from({ length: selectionSamples.length }, () => transformBefore),
  )
  expect(selectionSamples.map((sample) => sample.board)).toEqual(
    Array.from({ length: selectionSamples.length }, () => selectionSamples[0]?.board),
  )
  expect(selectionSamples.map((sample) => sample.pageY)).toEqual(
    Array.from({ length: selectionSamples.length }, () => selectionSamples[0]?.pageY),
  )

  const transforms = await page.evaluate(async (before) => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!viewport) throw new Error('Missing React Flow viewport')
    const frames: string[] = [before]
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      frames.push(getComputedStyle(viewport).transform)
    }
    return frames
  }, transformBefore)

  expect(transforms).toEqual(Array.from({ length: 7 }, () => transformBefore))
  const viewportStyleMutations = await page.evaluate(() => {
    const probe = (window as unknown as {
      __eidoViewportMutationProbe?: {
        initialStyle: string | null
        styles: Array<string | null>
        observer: MutationObserver
      }
    }).__eidoViewportMutationProbe
    probe?.observer.disconnect()
    return probe ? probe.styles.filter((style) => style !== probe.initialStyle) : []
  })
  expect(viewportStyleMutations).toEqual([])
  const ancestorScrolls = await page.evaluate(() => {
    const probe = (window as unknown as {
      __eidoAncestorScrollProbe?: {
        scrolls: Array<{ className: string; scrollTop: number; tagName: string }>
        stop: () => void
      }
    }).__eidoAncestorScrollProbe
    probe?.stop()
    return probe?.scrolls.filter(({ className }) => !className.includes('note-body')) ?? []
  })
  expect(ancestorScrolls).toEqual([])

  const cardBounds = await node.locator('.card').evaluate(async (element) => {
    const read = () => {
      const rect = element.getBoundingClientRect()
      return { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
    }
    const bounds = [read()]
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      bounds.push(read())
    }
    return bounds
  })
  for (const bounds of cardBounds) {
    expect(bounds.x).toBeCloseTo(cardBoundsBefore.x, 2)
    expect(bounds.y).toBeCloseTo(cardBoundsBefore.y, 2)
    expect(bounds.width).toBeCloseTo(cardBoundsBefore.width, 2)
    expect(bounds.height).toBeCloseTo(cardBoundsBefore.height, 2)
  }
  await page.evaluate(() => {
    ;(window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }).__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  })
})

test('transported Markdown and numeric spaces stay normalized in note preview and editing', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as { __eido?: EidoDevStore }
    return Boolean(devWindow.__eido?.getState().hydrated)
  })
  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'escaped-markdown-note',
          kind: 'note',
          blocks: [{
            id: 'escaped-markdown-block',
            text: '\\\\### Design Brief\\n\\\\**Goal\\\\** &#x20;\\nCreate a visual control surface.',
          }],
          position: { x: 120, y: 120 },
        },
        {
          id: 'numeric-space-note',
          kind: 'note',
          blocks: [{
            id: 'numeric-space-block',
            text: 'Hello, how are you&#x20;\n\nhello hello???',
          }],
          position: { x: 500, y: 120 },
        },
      ],
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
  })
  await setTestViewport(page)

  const node = page.locator('.react-flow__node-note[data-id="escaped-markdown-note"]')
  const passive = node.locator('.note-render.markdown')
  await expect(passive.locator('h3')).toHaveText('Design Brief')
  await expect(passive.locator('strong')).toHaveText('Goal')

  const numericSpacePreview = page
    .locator('.react-flow__node-note[data-id="numeric-space-note"]')
    .locator('.note-render.markdown')
  await expect(numericSpacePreview.locator('p')).toHaveCount(2)
  await expect(numericSpacePreview.locator('p').first()).toHaveText('Hello, how are you')
  await expect(numericSpacePreview).not.toContainText('&#x20;')

  await passive.click()
  const editor = node.locator('.markdown-card-editor-content')
  await expect(editor).toBeEditable()
  await expect(editor.locator('h3')).toHaveText('Design Brief')
  await expect(editor.locator('strong')).toHaveText('Goal')
  await expect(editor).not.toContainText('###')
  await expect(editor).not.toContainText('**')
})

test('a fixed-height note restores its mid-scroll position without a reactivation flash', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as { __eido?: EidoDevStore }
    return Boolean(devWindow.__eido?.getState().hydrated)
  })
  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'scroll-restore-note',
          kind: 'note',
          blocks: [{ id: 'scroll-restore-block', text: Array.from({ length: 120 }, (_, index) => `Line ${index}`).join('\n') }],
          position: { x: 120, y: 80 },
          size: { width: 340, height: 260 },
        },
      ],
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
  })
  await setTestViewport(page)

  const node = page.locator('.react-flow__node-note[data-id="scroll-restore-note"]')
  const passiveText = node.locator('.note-render')
  await passiveText.click()
  await expect(node.locator('.markdown-card-editor-content')).toBeEditable()
  const body = node.locator('.note-body')
  const beforePassive = await body.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
    return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }
  })
  const savedScrollTop = beforePassive.scrollTop
  const savedProgress = savedScrollTop / (beforePassive.scrollHeight - beforePassive.clientHeight)

  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await expect(node.locator('.markdown-card-editor-content')).not.toBeAttached()
  const passiveProgress = await body.evaluate(
    (element) => element.scrollTop / (element.scrollHeight - element.clientHeight),
  )
  expect(passiveProgress).toBeCloseTo(savedProgress, 2)

  await passiveText.click()
  await expect(node.locator('.markdown-card-editor-content')).toBeEditable()
  const scrollProgress = await body.evaluate(async (element) => {
    const progress = () => element.scrollTop / (element.scrollHeight - element.clientHeight)
    const positions = [progress()]
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      positions.push(progress())
    }
    return positions
  })

  for (const progress of scrollProgress) expect(progress).toBeCloseTo(savedProgress, 2)
})

test('a fixed-height Ask AI card restores its mid-scroll position when editing reopens', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as { __eido?: EidoDevStore }
    return Boolean(devWindow.__eido?.getState().hydrated)
  })
  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'scroll-restore-ask',
          kind: 'askAi',
          blocks: [{ id: 'scroll-restore-ask-block', text: Array.from({ length: 120 }, (_, index) => `Line ${index}`).join('\n') }],
          position: { x: 120, y: 80 },
          size: { width: 340, height: 260 },
        },
      ],
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
  })
  await setTestViewport(page)

  const node = page.locator('.react-flow__node-askAi[data-id="scroll-restore-ask"]')
  const passiveText = node.locator('.note-render')
  await passiveText.click()
  await expect(node.locator('.markdown-card-editor-content')).toBeEditable()
  const body = node.locator('.card-body')
  const beforePassive = await body.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
    return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }
  })
  const savedProgress = beforePassive.scrollTop / (beforePassive.scrollHeight - beforePassive.clientHeight)

  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await expect(node.locator('.markdown-card-editor-content')).not.toBeAttached()
  await expect.poll(() => body.evaluate(
    (element) => element.scrollTop / (element.scrollHeight - element.clientHeight),
  )).toBeCloseTo(savedProgress, 2)

  await passiveText.click()
  await expect(node.locator('.markdown-card-editor-content')).toBeEditable()
  const scrollProgress = await body.evaluate(async (element) => {
    const progress = () => element.scrollTop / (element.scrollHeight - element.clientHeight)
    const positions = [progress()]
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      positions.push(progress())
    }
    return positions
  })

  for (const progress of scrollProgress) expect(progress).toBeCloseTo(savedProgress, 2)
})

test('a fixed-height Conversation card restores its mid-scroll position when editing reopens', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as { __eido?: EidoDevStore }
    return Boolean(devWindow.__eido?.getState().hydrated)
  })
  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'scroll-restore-conversation',
          kind: 'conversation',
          blocks: [{ id: 'scroll-restore-conversation-block', text: Array.from({ length: 120 }, (_, index) => `Line ${index}`).join('\n') }],
          position: { x: 120, y: 80 },
          size: { width: 340, height: 260 },
        },
      ],
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
  })
  await setTestViewport(page)

  const node = page.locator('.react-flow__node-conversation[data-id="scroll-restore-conversation"]')
  const passiveText = node.locator('.note-render')
  await passiveText.click()
  await expect(node.locator('.markdown-card-editor-content')).toBeEditable()
  const body = node.locator('.card-body')
  const beforePassive = await body.evaluate((element) => {
    element.scrollTop = (element.scrollHeight - element.clientHeight) / 2
    element.dispatchEvent(new Event('scroll', { bubbles: true }))
    return { scrollTop: element.scrollTop, scrollHeight: element.scrollHeight, clientHeight: element.clientHeight }
  })
  const savedProgress = beforePassive.scrollTop / (beforePassive.scrollHeight - beforePassive.clientHeight)

  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await expect(node.locator('.markdown-card-editor-content')).not.toBeAttached()
  await expect.poll(() => body.evaluate(
    (element) => element.scrollTop / (element.scrollHeight - element.clientHeight),
  )).toBeCloseTo(savedProgress, 2)

  await passiveText.click()
  await expect(node.locator('.markdown-card-editor-content')).toBeEditable()
  const scrollProgress = await body.evaluate(async (element) => {
    const progress = () => element.scrollTop / (element.scrollHeight - element.clientHeight)
    const positions = [progress()]
    for (let index = 0; index < 6; index += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
      positions.push(progress())
    }
    return positions
  })

  for (const progress of scrollProgress) expect(progress).toBeCloseTo(savedProgress, 2)
})

test('new auto-height notes do not expose duplicate overview cards underneath them', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as { __eido?: EidoDevStore }
    return Boolean(devWindow.__eido?.getState().hydrated)
  })
  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [],
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
  })
  await setTestViewport(page)
  await page.locator('.bottom-dock').getByRole('button', { name: 'Add note' }).click()

  const node = page.locator('.react-flow__node-note').last()
  await node.waitFor({ state: 'visible' })
  await node.locator('.card').click()
  await page.waitForFunction(() => Boolean(window.__EIDO_FORCE_OVERVIEW_DRAW__))
  // The guarded bug is a PERSISTENT underlay outline under a settled note.
  // While the viewport is still settling (mount fitView), the overview
  // intentionally underlays mounted cards, so wait for settled suppression
  // before sampling. If suppression never engages, this times out and fails.
  await page.waitForFunction(() => {
    window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    return Number(layer?.dataset.suppressedReactCardCount ?? 0) > 0
  })
  await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())

  const sample = await page.evaluate(() => {
    const node = document.querySelector<HTMLElement>('.react-flow__node-note')
    const card = node?.querySelector<HTMLElement>('.card')
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    const viewportElement = document.querySelector<HTMLElement>('.react-flow__viewport')
    if (!node || !card || !canvas) throw new Error('Missing note or overview layer')

    const transform = viewportElement ? getComputedStyle(viewportElement).transform : ''
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
    const zoom = matrix?.a ?? 1
    const cardId = node.dataset.id ?? ''
    const cardRect = card.getBoundingClientRect()
    const canvasRect = canvas.getBoundingClientRect()
    const scaleX = canvas.width / canvasRect.width
    const scaleY = canvas.height / canvasRect.height
    const sampleX = Math.floor((cardRect.left + cardRect.width / 2 - canvasRect.left) * scaleX)
    const sampleY = Math.floor((cardRect.bottom + 20 - canvasRect.top) * scaleY)
    const pixel = canvas.getContext('2d')?.getImageData(sampleX, sampleY, 1, 1).data

    return {
      cardId,
      cardHeight: cardRect.height / zoom,
      overviewHasCard: Boolean(window.__EIDO_OVERVIEW_CARD_IDS__?.has(cardId)),
      pixelAlphaBelowCard: pixel?.[3] ?? 0,
    }
  })

  expect(sample.cardId).not.toBe('')
  expect(sample.cardHeight).toBeCloseTo(250, 0)
  expect(sample.overviewHasCard).toBe(false)
  expect(sample.pixelAlphaBelowCard).toBe(0)
})

test('full-detail overview layer does not duplicate mounted cards or React edges', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'source-note',
          kind: 'note',
          blocks: [{ id: 'source-note-block', text: 'Short source' }],
          position: { x: 80, y: 80 },
          zIndex: 1,
        },
        {
          id: 'target-note',
          kind: 'note',
          blocks: [{ id: 'target-note-block', text: 'Short target' }],
          position: { x: 420, y: 120 },
          zIndex: 2,
        },
      ],
      connections: [
        {
          id: 'connection-source-target',
          from: { cardId: 'source-note' },
          to: { cardId: 'target-note' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
      outputs: [],
      runs: [],
      intentLog: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 120, zoom: 1 })
  })

  await page.waitForSelector('[data-board-overview-layer]', { state: 'attached' })
  await page.waitForSelector('.react-flow__edge[data-id="connection-source-target"]')
  await page.waitForTimeout(180)

  const readOverviewCounts = () =>
    page.evaluate(() => {
      window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
      const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
      return {
        reactNodes: document.querySelectorAll('.react-flow__node').length,
        reactEdges: document.querySelectorAll('.react-flow__edge').length,
        renderedCardCount: Number(layer?.dataset.renderedCardCount ?? -1),
        renderedConnectionCount: Number(layer?.dataset.renderedConnectionCount ?? -1),
        suppressedReactCardCount: Number(layer?.dataset.suppressedReactCardCount ?? -1),
      }
    })

  await expect.poll(readOverviewCounts).toMatchObject({
    reactNodes: 2,
    reactEdges: 1,
    renderedCardCount: 0,
    renderedConnectionCount: 0,
    suppressedReactCardCount: 2,
  })

  await page.evaluate(() => window.__EIDO_SET_VIEWPORT__?.({ x: 260, y: 180, zoom: 1 }))
  await page.waitForTimeout(16)

  await expect.poll(readOverviewCounts).toMatchObject({
    reactNodes: 2,
    reactEdges: 1,
    renderedCardCount: 0,
    renderedConnectionCount: 0,
    suppressedReactCardCount: 2,
  })
})

// Canvas-painted connections no longer coexist with mounted cards below
// Reading (ADR 0020); C2's proxy representation gate supersedes this (#314).
test.fixme('overview connections align with mounted auto-height card handles', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    const cards = [
      {
        id: 'source-note',
        kind: 'note',
        blocks: [{ id: 'source-note-block', text: 'Multi Hops' }],
        position: { x: 80, y: 80 },
        zIndex: 1,
      },
      {
        id: 'target-note',
        kind: 'note',
        blocks: [{ id: 'target-note-block', text: 'What problem does this solve?' }],
        position: { x: 420, y: 120 },
        zIndex: 2,
      },
      ...Array.from({ length: 1001 }, (_, index) => ({
        id: `far-note-${index}`,
        kind: 'note',
        blocks: [{ id: `far-note-${index}-block`, text: `far ${index}` }],
        position: { x: 10_000 + (index % 50) * 300, y: Math.floor(index / 50) * 240 },
        zIndex: 3 + index,
      })),
    ]

    devWindow.__eido.setState({
      cards,
      connections: [
        {
          id: 'connection-source-target',
          from: { cardId: 'source-note' },
          to: { cardId: 'target-note' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
      outputs: [],
      runs: [],
      intentLog: [],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 120, zoom: 1 })
  })

  await page.waitForSelector('[data-board-overview-layer]', { state: 'attached' })
  await page.waitForSelector('.react-flow__node[data-id="source-note"] .react-flow__handle.source')
  await page.waitForFunction(() => {
    window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    return (
      Number(layer?.dataset.renderedConnectionCount ?? 0) > 0 &&
      Number(layer?.dataset.suppressedReactCardCount ?? 0) > 0
    )
  })

  const readConnectionSample = () =>
    page.evaluate(() => {
      window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
      const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
      const sourceHandle = document.querySelector<HTMLElement>(
        '.react-flow__node[data-id="source-note"] .react-flow__handle.source',
      )
      const viewportElement = document.querySelector<HTMLElement>('.react-flow__viewport')
      if (!canvas || !sourceHandle || !viewportElement) {
        throw new Error('Missing overview layer, source handle, or viewport')
      }

      const context = canvas.getContext('2d')
      if (!context) throw new Error('Missing overview context')

      const canvasRect = canvas.getBoundingClientRect()
      const handleRect = sourceHandle.getBoundingClientRect()
      const scaleX = canvas.width / canvasRect.width
      const scaleY = canvas.height / canvasRect.height
      const transform = getComputedStyle(viewportElement).transform
      const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
      const source = (window as unknown as { __eido: EidoDevStore }).__eido
        .getState()
        .cards.find((card) => card.id === 'source-note')
      if (!source) throw new Error('Missing source card')

      const actualProbe = {
        x: handleRect.left + handleRect.width / 2 - canvasRect.left + 12,
        y: handleRect.top + handleRect.height / 2 - canvasRect.top,
      }
      const oldFallbackProbe = {
        x: (source.position.x + 260) * (matrix?.a ?? 1) + (matrix?.e ?? 0) + 12,
        y: (source.position.y + 180 / 2) * (matrix?.a ?? 1) + (matrix?.f ?? 0),
      }

      const maxAlphaNear = (point: { x: number; y: number }, radius: number) => {
        let maxAlpha = 0
        for (let dx = -radius; dx <= radius; dx += 1) {
          for (let dy = -radius; dy <= radius; dy += 1) {
            const x = Math.round((point.x + dx) * scaleX)
            const y = Math.round((point.y + dy) * scaleY)
            if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue
            maxAlpha = Math.max(maxAlpha, context.getImageData(x, y, 1, 1).data[3])
          }
        }
        return maxAlpha
      }

      return {
        actualAlpha: maxAlphaNear(actualProbe, 7),
        oldFallbackAlpha: maxAlphaNear(oldFallbackProbe, 7),
      }
    })

  await expect
    .poll(async () => {
      const current = await readConnectionSample()
      return current.actualAlpha > 40 && current.oldFallbackAlpha < 40
    })
    .toBe(true)

  const sample = await readConnectionSample()

  expect(sample.actualAlpha).toBeGreaterThan(40)
  expect(sample.oldFallbackAlpha).toBeLessThan(40)
})

test('playback keeps existing connector strokes stable while playing', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    const t1 = '2026-06-19T10:00:00.000Z'
    const t2 = '2026-06-19T10:01:00.000Z'
    const t3 = '2026-06-19T10:02:00.000Z'
    const note = {
      id: 'source-note',
      kind: 'note',
      blocks: [{ id: 'source-note-block', text: 'ABC' }],
      position: { x: 80, y: 80 },
    }
    const ask = {
      id: 'ask-card',
      kind: 'askAi',
      blocks: [{ id: 'ask-card-block', text: 'continue' }],
      position: { x: 380, y: 240 },
    }
    const result = {
      id: 'result-card',
      kind: 'result',
      blocks: [{ id: 'result-card-block', text: '' }],
      position: { x: 720, y: 400 },
    }
    const noteToAsk = {
      id: 'connection-note-ask',
      from: { cardId: 'source-note' },
      to: { cardId: 'ask-card' },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
    }
    const askToResult = {
      id: 'connection-ask-result',
      from: { cardId: 'ask-card' },
      to: { cardId: 'result-card' },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
    }

    devWindow.__eido.setState({
      cards: [note, ask, result],
      connections: [noteToAsk, askToResult],
      outputs: [
        {
          id: 'out-result-card',
          resultCardId: 'result-card',
          chosenVersionId: 'ver-1',
          versions: [
            { id: 'ver-1', number: 1, text: 'generated answer', createdAt: t3, fromRunId: 'run-1' },
          ],
        },
      ],
      runs: [],
      intentLog: [
        { id: 'evt-1', at: t1, type: 'card.created', cardId: 'source-note', data: { card: note } },
        { id: 'evt-2', at: t1, type: 'card.created', cardId: 'ask-card', data: { card: ask } },
        { id: 'evt-3', at: t1, type: 'connection.created', connectionId: 'connection-note-ask', data: { connection: noteToAsk } },
        { id: 'evt-4', at: t2, type: 'card.created', cardId: 'result-card', data: { card: result } },
        { id: 'evt-5', at: t2, type: 'connection.created', connectionId: 'connection-ask-result', data: { connection: askToResult } },
        { id: 'evt-6', at: t3, type: 'run.completed', runId: 'run-1', data: { run: { id: 'run-1', startedAt: t3, status: 'done' } } },
      ],
      visualDecayEnabled: false,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: true,
      storageStatus: null,
      keyPromptOpen: false,
      ideaManagerOpen: false,
      cardClipboard: null,
    })
  })

  await page.getByRole('button', { name: 'Playback', exact: true }).click()
  await page.locator('.timeline-panel').waitFor({ state: 'visible' })
  await page.getByRole('button', { name: 'Play', exact: true }).click()
  await page.locator('.react-flow__edge[data-id="connection-note-ask"] .react-flow__edge-path').waitFor()
  await page.evaluate(() => {
    const samples: Array<{ count: number; animationNames: string[] }> = []
    const sample = () => {
      const paths = [...document.querySelectorAll<SVGPathElement>('.react-flow__edge-path')]
      samples.push({
        count: paths.length,
        animationNames: paths.map((path) => getComputedStyle(path).animationName),
      })
    }
    ;(
      window as unknown as { __playbackEdgePathSamples: Array<{ count: number; animationNames: string[] }> }
    ).__playbackEdgePathSamples = samples
    new MutationObserver(sample).observe(document.body, { childList: true, subtree: true })
    sample()
  })
  await page.waitForTimeout(320)

  const animationNames = await page.evaluate(() =>
    [...document.querySelectorAll<SVGPathElement>('.react-flow__edge-path')].map(
      (path) => getComputedStyle(path).animationName,
    ),
  )
  const edgePathSamples = await page.evaluate(
    () =>
      (
        window as unknown as { __playbackEdgePathSamples: Array<{ count: number; animationNames: string[] }> }
      ).__playbackEdgePathSamples,
  )

  expect(edgePathSamples.length).toBeGreaterThan(0)
  expect(edgePathSamples.every((sample) => sample.count > 0)).toBe(true)
  expect(edgePathSamples.flatMap((sample) => sample.animationNames).every((name) => name === 'none')).toBe(true)
  expect(animationNames.length).toBeGreaterThan(0)
  expect(animationNames.every((name) => name === 'none')).toBe(true)
})
