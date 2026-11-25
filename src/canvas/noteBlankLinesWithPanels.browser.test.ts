import { expect, test, type Page } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

// Two changes met here: authored blank lines now survive into the editor, which
// makes a Note body taller and leans on the body's own scrolling; and the
// attachment panels now take the bottom of the Card, which makes that body a
// shorter sibling of two pinned sections. This file proves them together, which
// neither seam's own suite does.

const IMAGE_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='

type DevWindow = {
  __eido?: {
    getState: () => {
      hydrated: boolean
      cards: Array<{ id: string; blocks: Array<{ text: string }> }>
    }
    setState: (state: unknown) => void
  }
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

function imageAsset(index: number) {
  return {
    id: `image-${index}`,
    kind: 'image',
    name: `image-${index}.png`,
    mimeType: 'image/png',
    dataUrl: IMAGE_DATA_URL,
    size: 68,
    createdAt: '2026-08-26T00:00:00.000Z',
    width: 1280,
    height: 960,
  }
}

const READY_PREVIEW = {
  url: 'https://www.drybread.studio/studio',
  status: 'ready',
  title: 'Drybread Studio',
  description: 'A small design practice working on tools for thinking.',
  siteName: 'Drybread Studio',
  imageDataUrl: IMAGE_DATA_URL,
}

async function seedNote(page: Page, card: Record<string, unknown>) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate((nextCard) => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [nextCard],
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
  }, card)
  await page.waitForTimeout(250)
}

async function proseLineGeometry(page: Page, selector: string) {
  return page.evaluate((sought) => {
    const prose = document.querySelector(sought)
    const body = prose?.closest('.card-body')
    if (!prose || !(body instanceof HTMLElement)) throw new Error(`Missing prose: ${sought}`)
    const bodyBounds = body.getBoundingClientRect()
    const lines: Array<{ text: string; top: number }> = []
    const walker = document.createTreeWalker(prose, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      if (!node.data.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      const bounds = range.getBoundingClientRect()
      lines.push({
        text: node.data.trim(),
        top: Math.round(bounds.top - bodyBounds.top + body.scrollTop),
      })
    }
    return {
      lines,
      scrollTop: Math.round(body.scrollTop),
      height: Math.round(prose.getBoundingClientRect().height),
    }
  }, selector)
}

/** Where the body sits relative to the panels that now claim the Card bottom. */
function measureStack(page: Page, id: string) {
  return page.evaluate((cardId) => {
    const card = document.querySelector<HTMLElement>(
      `.react-flow__node[data-id="${cardId}"] .card`,
    )
    const body = card?.querySelector<HTMLElement>('.card-body')
    if (!card || !body) throw new Error('Missing Card body')
    const panels = [...card.querySelectorAll<HTMLElement>('.card-attachment-panel')]
    return {
      cardBottom: card.getBoundingClientRect().bottom,
      bodyTop: body.getBoundingClientRect().top,
      bodyBottom: body.getBoundingClientRect().bottom,
      bodyScrolls: body.scrollHeight > body.clientHeight + 1,
      bodyClientHeight: body.clientHeight,
      panels: panels.map((panel) => ({
        kind: panel.className.includes('--images') ? 'images' : 'previews',
        top: panel.getBoundingClientRect().top,
        bottom: panel.getBoundingClientRect().bottom,
        height: panel.getBoundingClientRect().height,
        trackScrolls: (() => {
          const track = panel.querySelector<HTMLElement>('.card-attachment-track')
          return track ? track.scrollWidth > track.clientWidth + 1 : false
        })(),
        tiles: panel.querySelectorAll('.card-attachment-item').length,
      })),
    }
  }, id)
}

const blankLineText = Array.from({ length: 10 }, (_, index) => `Line ${index + 1}`).join('\n\n\n\n')

test('a Note with blank lines renders its body above both panels and still scrolls', async ({ page }) => {
  await seedNote(page, {
    id: 'combined-note',
    kind: 'note',
    blocks: [{ id: 'combined-note-block', text: blankLineText }],
    position: { x: 120, y: 80 },
    size: { width: 320, height: 520 },
    assets: [imageAsset(0), imageAsset(1), imageAsset(2)],
    linkPreview: READY_PREVIEW,
  })

  const stack = await measureStack(page, 'combined-note')
  expect(stack.panels.map((panel) => panel.kind)).toEqual(['images', 'previews'])
  expect(stack.panels[0].tiles).toBe(3)
  expect(stack.panels[1].tiles).toBe(1)

  // The panels sit below the body and inside the Card: the taller blank-line
  // body cannot push either of them off the bottom edge.
  expect(stack.bodyBottom).toBeLessThanOrEqual(stack.panels[0].top + 1)
  expect(stack.panels[0].bottom).toBeLessThanOrEqual(stack.panels[1].top + 1)
  expect(stack.panels[1].bottom).toBeLessThanOrEqual(stack.cardBottom + 1)

  // The body keeps a usable reading area and takes the overflow itself.
  expect(stack.bodyClientHeight).toBeGreaterThan(60)
  expect(stack.bodyScrolls).toBe(true)

  // Three tiles on a 320px Card scroll horizontally rather than crop.
  expect(stack.panels[0].trackScrolls).toBe(true)

  // Every blank line the writer authored is still drawn above the panels. Ten
  // authored lines separated by three newlines each: one of the three is the
  // paragraph break itself and the remaining two make one blank paragraph, so
  // ten content paragraphs stand with nine blank ones between them.
  const passive = page.locator(
    '.react-flow__node-note[data-id="combined-note"] .note-body > .note-render.markdown',
  )
  await expect(passive.locator('p')).toHaveCount(19)
  await expect(passive.locator('p:has(br):not(:has(*:not(br)))')).toHaveCount(9)
})

test('edit and rendered spacing still agree line for line while the panels are present', async ({ page }) => {
  await seedNote(page, {
    id: 'parity-note',
    kind: 'note',
    blocks: [{ id: 'parity-note-block', text: 'Alpha line\n\n\n\nBravo line\n\n\n\nCharlie line' }],
    position: { x: 120, y: 80 },
    size: { width: 360, height: 640 },
    assets: [imageAsset(0)],
    linkPreview: READY_PREVIEW,
  })

  const node = page.locator('.react-flow__node-note[data-id="parity-note"]')
  await expect(node.locator('.card-attachment-panel')).toHaveCount(2)

  const passive = node.locator('.note-body > .note-render.markdown')
  const rendered = await proseLineGeometry(
    page,
    '.note-body > .note-render.markdown',
  )

  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="parity-note"]',
    () => passive.click(),
  )
  await expect(editor).toBeAttached()
  // The panels are still mounted in edit mode, so the body is the same height
  // in both modes and the two surfaces are comparable at all.
  await expect(node.locator('.card-attachment-panel')).toHaveCount(2)

  const editing = await proseLineGeometry(page, '.markdown-card-editor-content')
  expect(editing.lines.map((line) => line.text)).toEqual([
    'Alpha line',
    'Bravo line',
    'Charlie line',
  ])
  expect(editing.lines).toEqual(rendered.lines)
  expect(editing.height).toBe(rendered.height)
})

test('the caret still follows an empty line when both panels hold the Card bottom', async ({ page }) => {
  await seedNote(page, {
    id: 'caret-note',
    kind: 'note',
    blocks: [{
      id: 'caret-note-block',
      text: Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`).join('\n\n'),
    }],
    position: { x: 120, y: 80 },
    // Deliberately short: with two panels claiming the bottom the body is a
    // narrow reading slot, which is exactly where a clipped caret would show.
    size: { width: 360, height: 460 },
    assets: [imageAsset(0), imageAsset(1)],
    linkPreview: READY_PREVIEW,
  })

  const node = page.locator('.react-flow__node-note[data-id="caret-note"]')
  await expect(node.locator('.card-attachment-panel')).toHaveCount(2)

  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="caret-note"]',
    () => node.locator('.note-body > .note-render.markdown').click(),
  )
  await editor.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let text: Text | null = null
    while (walker.nextNode()) text = walker.currentNode as Text
    if (!text) throw new Error('Expected editor text')
    const selection = window.getSelection()
    const range = document.createRange()
    range.setStart(text, text.length)
    range.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })

  // The caret line is measured against the body, whose bottom edge is now the
  // top of the image panel rather than the bottom of the Card. A caret that
  // scrolled only as far as the old Card edge would fail this.
  const readCaretLine = () => node.locator('.card-body').evaluate((body) => {
    const selection = window.getSelection()
    if (!selection?.rangeCount) throw new Error('Expected a caret selection')
    const content = body.querySelector('.markdown-card-editor-content')
    if (!content) throw new Error('Expected Markdown editor')
    let line: Element | null = selection.anchorNode instanceof Text
      ? selection.anchorNode.parentElement
      : selection.anchorNode as Element | null
    while (line && line.parentElement !== content) line = line.parentElement
    if (!line) throw new Error('Expected a caret line')
    const bounds = line.getBoundingClientRect()
    const bodyBounds = body.getBoundingClientRect()
    return {
      topGap: bounds.top - bodyBounds.top,
      bottomGap: bodyBounds.bottom - bounds.bottom,
      lineHeight: Number.parseFloat(getComputedStyle(line).lineHeight),
    }
  })

  const panelTopBefore = (await measureStack(page, 'caret-note')).panels[0].top

  for (let press = 0; press < 4; press += 1) {
    await page.keyboard.press('Enter')
    const caretLine = await readCaretLine()
    expect(caretLine.topGap).toBeGreaterThanOrEqual(0)
    // In view, and no further: a whole spare line below the caret is space the
    // writer never typed, and it disappears again the moment they stop.
    expect(caretLine.bottomGap).toBeGreaterThanOrEqual(0)
    expect(caretLine.bottomGap).toBeLessThan(caretLine.lineHeight)
  }

  await page.keyboard.type('Still following')
  const typedLine = await readCaretLine()
  expect(typedLine.topGap).toBeGreaterThanOrEqual(0)
  expect(typedLine.bottomGap).toBeGreaterThanOrEqual(0)
  expect(typedLine.bottomGap).toBeLessThan(typedLine.lineHeight)

  // Caret-following scroll must move the body, never the Card: the panels are
  // exactly where they were before the writer started pressing Enter.
  const panelTopAfter = (await measureStack(page, 'caret-note')).panels[0].top
  expect(panelTopAfter).toBeCloseTo(panelTopBefore, 0)
})
