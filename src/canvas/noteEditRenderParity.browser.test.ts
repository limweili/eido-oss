import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

// Reading a Note and writing one are the same page of paper. Whatever the body
// holds, every line must stand in the same place, the Card must scroll exactly
// as far, and crossing between the two must not move the text under the reader
// by a pixel. These are geometric facts about the running app, so they are
// measured here rather than argued about in a unit test.

type DevWindow = {
  __eido?: {
    getState: () => { hydrated: boolean }
    setState: (state: unknown) => void
  }
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

type ProseGeometry = {
  proseHeight: number
  blocks: Array<{ top: number; height: number }>
  lines: Array<{ top: number; left: number; width: number; height: number }>
  scrollTop: number
  scrollHeight: number
}

const CASES: Array<{ name: string; text: string; height: number }> = [
  { name: 'a single line', text: 'Alpha line', height: 300 },
  { name: 'two paragraphs', text: 'Alpha line\n\nBravo line', height: 300 },
  { name: 'several blank lines between paragraphs', text: 'Alpha line\n\n\n\n\n\nBravo line', height: 420 },
  { name: 'trailing blank lines', text: 'Alpha line\n\nBravo line\n\n\n\n', height: 420 },
  { name: 'leading blank lines', text: '\n\n\n\nAlpha line\n\nBravo line', height: 420 },
  { name: 'a heading followed by a blank line', text: '# Heading\n\n\n\nAlpha line', height: 420 },
  { name: 'a list followed by a blank line', text: '- one\n- two\n\n\n\nAlpha line', height: 420 },
  { name: 'a nested list', text: 'Parent\n\n- one\n  - nested one\n  - nested two\n- two', height: 420 },
  { name: 'a code fence', text: 'Before\n\n```\nconst a = 1\n```\n\nAfter', height: 420 },
  { name: 'a trailing heading', text: 'Alpha line\n\n## Closing heading', height: 420 },
  { name: 'a trailing list', text: 'Alpha line\n\n- one\n- two', height: 420 },
  { name: 'a trailing code fence', text: 'Alpha line\n\n```\nconst a = 1\n```', height: 420 },
  {
    name: 'runs of spaces the writer typed',
    text: 'Alpha  double   spaced  words  that  keep  going  until  they  wrap  around\n\n# Heading  with  runs\n\n- item  with  runs\n\n> quote  with  runs',
    height: 420,
  },
  {
    name: 'a soft-wrapped paragraph',
    text: 'A single long paragraph that has to wrap across several visual lines inside a narrow Card body so its wrap points are comparable.\n\nSecond paragraph.',
    height: 420,
  },
  {
    name: 'a body that overflows and scrolls',
    text: Array.from({ length: 30 }, (_, index) => `Line ${index + 1}`).join('\n\n'),
    height: 260,
  },
]

// The Note text ladder's two ends and one step in between, because leading
// changes across the ladder and parity has to survive every step of it.
const FONT_STEPS = [1, 3, 6]

async function seedNote(page: Page, id: string, text: string, height: number, fontSize: number) {
  await page.evaluate(({ id, text, height, fontSize }) => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id,
        kind: 'note',
        blocks: [{ id: `${id}-block`, text }],
        position: { x: 180, y: 100 },
        size: { width: 360, height },
        fontSize,
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
  }, { id, text, height, fontSize })
}

// Every block and every visual line box the reader sees, measured against the
// prose element's own top so the two representations are directly comparable.
function readProseGeometry(selector: string): ProseGeometry {
  const prose = document.querySelector(selector)
  const body = prose?.closest('.card-body')
  if (!prose || !(body instanceof HTMLElement)) throw new Error(`Missing prose: ${selector}`)
  const proseBox = prose.getBoundingClientRect()
  const round = (value: number) => Math.round(value * 100) / 100
  // The passive render nests its blocks one wrapper <div> deep; the live
  // editor does not. Compare the blocks themselves either way.
  const host = prose.children.length === 1 &&
    prose.children[0].tagName === 'DIV' &&
    prose.children[0].getAttribute('class') === null
    ? prose.children[0]
    : prose
  // Only what is drawn. A box with no height puts nothing on the page, so it
  // cannot be the difference between reading a Card and writing one.
  const blocks = Array.from(host.children).map((child) => {
    const box = child.getBoundingClientRect()
    return { top: round(box.top - proseBox.top), height: round(box.height) }
  }).filter((block) => block.height > 0)
  const lines: Array<{ top: number; left: number; width: number; height: number }> = []
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT + NodeFilter.SHOW_ELEMENT)
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (node instanceof Text) {
      if (!node.data.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) {
        lines.push({
          top: round(rect.top - proseBox.top),
          left: round(rect.left - proseBox.left),
          width: round(rect.width),
          height: round(rect.height),
        })
      }
    } else if (node instanceof HTMLBRElement) {
      // A blank line the writer typed is a line box like any other. Read it
      // inside whatever its block actually shows, so a break in a block with
      // no height counts for nothing, which is what the reader sees.
      const rect = node.getBoundingClientRect()
      const blockBox = (node.parentElement ?? node).getBoundingClientRect()
      const top = Math.max(rect.top, blockBox.top)
      const bottom = Math.min(rect.bottom, blockBox.bottom)
      lines.push({
        top: round(top - proseBox.top),
        left: round(rect.left - proseBox.left),
        width: round(rect.width),
        height: round(Math.max(0, bottom - top)),
      })
    }
  }
  const drawn = lines.filter((line) => line.height > 0)
  drawn.sort((first, second) => (
    first.top - second.top || first.left - second.left || first.height - second.height
  ))
  return {
    proseHeight: round(proseBox.height),
    blocks,
    lines: drawn,
    scrollTop: round(body.scrollTop),
    scrollHeight: body.scrollHeight,
  }
}

// A Playwright locator click scrolls its target into view before pressing,
// which would destroy the very scroll position under test. Press a point that
// is already visible instead.
async function clickVisibleProse(page: Page, id: string) {
  const point = await page.locator(`.react-flow__node-note[data-id="${id}"] .card-body`)
    .evaluate((body) => {
      const box = body.getBoundingClientRect()
      const prose = body.querySelector('.note-render.markdown, .markdown-card-editor-content')
      const proseBox = (prose ?? body).getBoundingClientRect()
      const top = Math.max(box.top, proseBox.top)
      const bottom = Math.min(box.bottom, proseBox.bottom)
      return { x: proseBox.left + 6, y: (top + bottom) / 2 }
    })
  await page.mouse.click(point.x, point.y)
}

async function openBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
}

for (const fontSize of FONT_STEPS) {
  for (const noteCase of CASES) {
    test(`a Note holding ${noteCase.name} reads and edits identically at text size ${fontSize}`, async ({
      page,
    }) => {
      await openBoard(page)
      const id = `parity-note-${fontSize}`
      await seedNote(page, id, noteCase.text, noteCase.height, fontSize)
      const node = page.locator(`.react-flow__node-note[data-id="${id}"]`)
      const passiveSelector = `.react-flow__node-note[data-id="${id}"] .note-body > .note-render.markdown`
      const editorSelector = `.react-flow__node-note[data-id="${id}"] .markdown-card-editor-content`
      await node.locator('.note-body > .note-render.markdown').waitFor()

      const overflows = await node.locator('.card-body')
        .evaluate((body) => body.scrollHeight > body.clientHeight)
      // A Card that can scroll is checked from the top, the middle, and the
      // bottom, because a geometry difference between the two surfaces shows
      // up as a scroll jump in proportion to how far down the reader is.
      const ratios = overflows ? [0, 0.5, 1] : [0]

      for (const ratio of ratios) {
        await node.locator('.card-body').evaluate((body, atRatio) => {
          body.scrollTop = (body.scrollHeight - body.clientHeight) * atRatio
        }, ratio)
        const rendered = await page.evaluate(readProseGeometry, passiveSelector)

        await activateAndRequireExactReadyMarkdownEditor(
          page,
          `.react-flow__node-note[data-id="${id}"]`,
          () => clickVisibleProse(page, id),
        )
        const editing = await page.evaluate(readProseGeometry, editorSelector)

        expect(editing.blocks).toEqual(rendered.blocks)
        expect(editing.lines).toEqual(rendered.lines)
        expect(editing.proseHeight).toBe(rendered.proseHeight)
        // Editing adds no geometry of its own: no trailing placeholder, no
        // reserve below the last line. The Card scrolls exactly as far.
        expect(editing.scrollHeight).toBe(rendered.scrollHeight)
        expect(editing.scrollTop).toBe(rendered.scrollTop)

        await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
        await node.locator('.note-body > .note-render.markdown').waitFor()
        const left = await page.evaluate(readProseGeometry, passiveSelector)
        expect(left.scrollTop).toBe(rendered.scrollTop)
        expect(left.scrollHeight).toBe(rendered.scrollHeight)
        expect(left.lines).toEqual(rendered.lines)
      }
    })
  }
}

test('typing a new line moves the Card body and nothing else', async ({ page }) => {
  await openBoard(page)
  const id = 'caret-owner-note'
  await seedNote(
    page,
    id,
    Array.from({ length: 24 }, (_, index) => `Line ${index + 1}`).join('\n\n'),
    260,
    2,
  )
  const node = page.locator(`.react-flow__node-note[data-id="${id}"]`)
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    `.react-flow__node-note[data-id="${id}"]`,
    () => clickVisibleProse(page, id),
  )
  await editor.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    let last: Text | null = null
    while (walker.nextNode()) last = walker.currentNode as Text
    if (!last) throw new Error('Expected editor text')
    const range = document.createRange()
    range.setStart(last, last.length)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })

  const readCanvas = () => page.evaluate(() => ({
    windowScroll: `${window.scrollX},${window.scrollY}`,
    viewport: document.querySelector('.react-flow__viewport')?.getAttribute('style') ?? '',
  }))
  const readCaretLine = () => node.locator('.card-body').evaluate((body) => {
    const selection = window.getSelection()
    const content = body.querySelector('.markdown-card-editor-content')
    if (!selection?.rangeCount || !content) throw new Error('Expected a caret in the editor')
    let line: Element | null = selection.anchorNode instanceof Text
      ? selection.anchorNode.parentElement
      : (selection.anchorNode as Element | null)
    while (line && line.parentElement !== content) line = line.parentElement
    if (!line) throw new Error('Expected a caret line')
    const lineBox = line.getBoundingClientRect()
    const bodyBox = body.getBoundingClientRect()
    return {
      topGap: lineBox.top - bodyBox.top,
      bottomGap: bodyBox.bottom - lineBox.bottom,
      lineHeight: Number.parseFloat(getComputedStyle(line).lineHeight),
      scrollTop: body.scrollTop,
      maxScrollTop: body.scrollHeight - body.clientHeight,
    }
  })

  const canvasBefore = await readCanvas()
  for (const typed of ['', 'with text', '', 'more text']) {
    // Hold the key the way a writer does. A follow that waits for the key to
    // come back up is a follow the writer watches arrive late.
    await page.keyboard.down('Enter')
    const held = await readCaretLine()
    await page.keyboard.up('Enter')
    if (typed) await page.keyboard.type(typed)
    const settled = await readCaretLine()

    expect(held.topGap).toBeGreaterThanOrEqual(0)
    expect(held.bottomGap).toBeGreaterThanOrEqual(0)
    expect(held.bottomGap).toBeLessThan(held.lineHeight)
    expect(settled.topGap).toBeGreaterThanOrEqual(0)
    expect(settled.bottomGap).toBeGreaterThanOrEqual(0)
    // The line being written is the last one, so the Card comes to rest at the
    // true end of its scroll. Anything short of that leaves the writer looking
    // at their caret with room still below it to pull down.
    expect(held.scrollTop).toBe(held.maxScrollTop)
    expect(settled.scrollTop).toBe(settled.maxScrollTop)
    // Releasing Enter never moves the Card. A follow that ran on key release
    // would arrive as long after the new line as the writer held the key.
    if (!typed) expect(settled.scrollTop).toBe(held.scrollTop)
  }
  expect(await readCanvas()).toEqual(canvasBefore)
})

test('writing in the middle of a Note follows the caret and not the bottom', async ({ page }) => {
  await openBoard(page)
  const id = 'caret-middle-note'
  await seedNote(
    page,
    id,
    Array.from({ length: 24 }, (_, index) => `Line ${index + 1}`).join('\n\n'),
    260,
    2,
  )
  const node = page.locator(`.react-flow__node-note[data-id="${id}"]`)
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    `.react-flow__node-note[data-id="${id}"]`,
    () => clickVisibleProse(page, id),
  )

  // The bottom-most line the reader can see from the top of a long Note: far
  // from the end, and close enough to the fold that writing there has to move
  // the Card a little.
  await editor.evaluate((element) => {
    const body = element.closest('.card-body')
    if (!(body instanceof HTMLElement)) throw new Error('Expected a Card body')
    body.scrollTop = 0
    const bottom = body.getBoundingClientRect().bottom
    const visible = Array.from(element.children)
      .filter((child) => child.getBoundingClientRect().bottom <= bottom)
    const line = visible[visible.length - 1]
    if (!line) throw new Error('Expected a visible line')
    const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT)
    const text = walker.nextNode()
    if (!(text instanceof Text)) throw new Error('Expected line text')
    const range = document.createRange()
    range.setStart(text, text.length)
    range.collapse(true)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event('selectionchange'))
  })

  const readCaret = () => node.locator('.card-body').evaluate((body) => {
    const selection = window.getSelection()
    const content = body.querySelector('.markdown-card-editor-content')
    if (!selection?.rangeCount || !content) throw new Error('Expected a caret in the editor')
    let line: Element | null = selection.anchorNode instanceof Text
      ? selection.anchorNode.parentElement
      : (selection.anchorNode as Element | null)
    while (line && line.parentElement !== content) line = line.parentElement
    if (!line) throw new Error('Expected a caret line')
    const lineBox = line.getBoundingClientRect()
    const bodyBox = body.getBoundingClientRect()
    return {
      topGap: lineBox.top - bodyBox.top,
      bottomGap: bodyBox.bottom - lineBox.bottom,
      lineHeight: Number.parseFloat(getComputedStyle(line).lineHeight),
      scrollTop: body.scrollTop,
      maxScrollTop: body.scrollHeight - body.clientHeight,
    }
  })

  await page.keyboard.press('Enter')
  const opened = await readCaret()
  expect(opened.topGap).toBeGreaterThanOrEqual(0)
  expect(opened.bottomGap).toBeGreaterThanOrEqual(0)
  // The Card went to the new line, not to the end of the Note.
  expect(opened.scrollTop).toBeLessThanOrEqual(opened.lineHeight * 2)
  expect(opened.maxScrollTop - opened.scrollTop).toBeGreaterThan(opened.lineHeight * 4)

  // A keystroke that moves no line moves no Card either, so a writer who has
  // scrolled to read something keeps their place.
  await page.keyboard.type('x')
  expect((await readCaret()).scrollTop).toBe(opened.scrollTop)
})

test('the spare line after a trailing heading is still somewhere to write', async ({ page }) => {
  await openBoard(page)
  const id = 'spare-line-note'
  await seedNote(page, id, 'Alpha line\n\n## Closing heading', 420, 2)
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    `.react-flow__node-note[data-id="${id}"]`,
    () => clickVisibleProse(page, id),
  )

  const spareLineHeight = () => editor.evaluate((element) => {
    const spare = element.lastElementChild
    return spare ? Math.round(spare.getBoundingClientRect().height) : -1
  })
  // Closed while the Note is only being read into, so it costs the Card no
  // height it does not owe the writer.
  expect(await spareLineHeight()).toBe(0)

  await editor.press('ArrowDown')
  // Open once the caret arrives, because now the writer wants a line. The
  // arrival is the browser's own selection event, so poll for it.
  await expect.poll(spareLineHeight).toBeGreaterThan(0)
  await page.keyboard.type('After the heading')

  await expect.poll(() => page.evaluate((cardId) => {
    const devWindow = window as unknown as {
      __eido: { getState: () => { cards: Array<{ id: string; blocks: Array<{ text: string }> }> } }
    }
    return devWindow.__eido.getState().cards.find((card) => card.id === cardId)?.blocks[0]?.text
  }, id)).toBe('Alpha line\n\n## Closing heading\n\nAfter the heading')
})
