import { expect, test } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

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

async function selectEditorText(
  editor: import('@playwright/test').Locator,
  text: string,
  collapseTo?: 'start' | 'end',
) {
  await editor.click({ position: { x: 12, y: 12 } })
  await editor.evaluate((element, { sought, collapseTo }) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const offset = node.data.indexOf(sought)
      if (offset < 0) continue
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + sought.length)
      if (collapseTo) range.collapse(collapseTo === 'start')
      const selection = window.getSelection()
      selection?.removeAllRanges()
      selection?.addRange(range)
      document.dispatchEvent(new Event('selectionchange'))
      return
    }
    throw new Error(`Missing editor text: ${sought}`)
  }, { sought: text, collapseTo })
}

async function dragSelectEditorTextBackward(
  editor: import('@playwright/test').Locator,
  text: string,
) {
  const bounds = await editor.evaluate((element, sought) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    while (walker.nextNode()) {
      const node = walker.currentNode as Text
      const offset = node.data.indexOf(sought)
      if (offset < 0) continue
      const range = document.createRange()
      range.setStart(node, offset)
      range.setEnd(node, offset + sought.length)
      const rect = range.getBoundingClientRect()
      return { left: rect.left, right: rect.right, y: rect.top + rect.height / 2 }
    }
    throw new Error(`Missing editor text: ${sought}`)
  }, text)
  await editor.click({ position: { x: 12, y: 12 } })
  await editor.page().mouse.move(bounds.right - 1, bounds.y)
  await editor.page().mouse.down()
  await editor.page().mouse.move(bounds.left + 1, bounds.y, { steps: 8 })
  await editor.page().mouse.up()
}

test('soft line breaks and blank-line spacing survive edit, save, and passive view', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id: 'line-break-note',
        kind: 'note',
        blocks: [{ id: 'line-break-note-block', text: 'First line' }],
        position: { x: 180, y: 120 },
        size: { width: 360, height: 280 },
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
  })

  const node = page.locator('.react-flow__node-note[data-id="line-break-note"]')
  const passive = node.locator('.note-render.markdown')
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="line-break-note"]',
    () => passive.click(),
  )

  // Pin the edit to the text: Home/End have different caret semantics on
  // macOS and Linux, while this case is about whitespace persistence.
  await selectEditorText(editor, 'First line', 'end')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('Second line')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.press('Shift+Enter')
  await page.keyboard.type('Third line')

  await expect(editor.locator('br')).toHaveCount(3)
  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().cards
      .find((card) => card.id === 'line-break-note')
      ?.blocks[0]?.text
  })).toBe('First line  \nSecond line\n\nThird line')

  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await expect(editor).not.toBeAttached()
  await expect(passive.locator('p')).toHaveCount(2)
  await expect(passive.locator('br')).toHaveCount(1)
  await expect(passive).toHaveText('First lineSecond line\nThird line')

  const { editor: reopenedEditor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="line-break-note"]',
    () => passive.click(),
  )
  await expect(reopenedEditor.locator('p')).toHaveCount(2)
  await expect(reopenedEditor.locator('br')).toHaveCount(1)
})

// Every line of the Card's text, measured in the body's own scrolled document
// so the editor and the passive render are directly comparable.
async function proseLineGeometry(
  page: import('@playwright/test').Page,
  selector: string,
) {
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

test('typed blank lines stand in the same place in the editor and the passive Card', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id: 'blank-line-note',
        kind: 'note',
        blocks: [{ id: 'blank-line-note-block', text: 'Alpha line' }],
        position: { x: 180, y: 120 },
        size: { width: 360, height: 460 },
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
  })

  const node = page.locator('.react-flow__node-note[data-id="blank-line-note"]')
  const passive = node.locator('.note-body > .note-render.markdown')
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="blank-line-note"]',
    () => passive.click(),
  )

  await selectEditorText(editor, 'Alpha line', 'end')
  for (const line of ['Bravo line', 'Charlie line']) {
    await page.keyboard.press('Enter')
    await page.keyboard.press('Enter')
    await page.keyboard.type(line)
  }
  // Room the writer left below the last line is content too, not trailing
  // whitespace for the Markdown round trip to trim away.
  await page.keyboard.press('Enter')
  await page.keyboard.press('Enter')

  const persisted = () => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().cards
      .find((card) => card.id === 'blank-line-note')
      ?.blocks[0]?.text
  })
  await expect.poll(persisted).toBe('Alpha line\n\n\n\nBravo line\n\n\n\nCharlie line\n\n\n\n')

  const editing = await proseLineGeometry(page, '.markdown-card-editor-content')
  expect(editing.lines.map((line) => line.text)).toEqual([
    'Alpha line',
    'Bravo line',
    'Charlie line',
  ])

  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await expect(editor).not.toBeAttached()
  await expect(passive.locator('p')).toHaveCount(7)
  const rendered = await proseLineGeometry(page, '.note-body > .note-render.markdown')
  expect(rendered.lines).toEqual(editing.lines)
  expect(rendered.height).toBe(editing.height)
  // The Card is tall enough to hold the whole Note, so neither surface scrolls:
  // leaving the editor cannot move the text under the reader.
  expect(editing.scrollTop).toBe(0)
  expect(rendered.scrollTop).toBe(0)

  const { editor: reopenedEditor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="blank-line-note"]',
    () => passive.click(),
  )
  await expect(reopenedEditor).toBeAttached()
  const reopened = await proseLineGeometry(page, '.markdown-card-editor-content')
  expect(reopened.lines).toEqual(editing.lines)
  expect(reopened.height).toBe(editing.height)
  await expect.poll(persisted).toBe('Alpha line\n\n\n\nBravo line\n\n\n\nCharlie line\n\n\n\n')
})

test('Enter on an empty line keeps the caret line in view', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id: 'blank-caret-note',
        kind: 'note',
        blocks: [{
          id: 'blank-caret-note-block',
          text: Array.from({ length: 8 }, (_, index) => `Line ${index + 1}`).join('\n\n'),
        }],
        position: { x: 180, y: 120 },
        size: { width: 360, height: 260 },
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
  })

  const node = page.locator('.react-flow__node-note[data-id="blank-caret-note"]')
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="blank-caret-note"]',
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

  // An empty line has no text to measure, so a caret follow that reads the
  // caret's own rectangle leaves the new line clipped against the Card's
  // bottom edge. The follow must read the line box, and it must happen while
  // the key is still down: waiting for keyup makes the view lag the writer by
  // however long they hold the key.
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
      scrollTop: body.scrollTop,
    }
  })

  for (let press = 0; press < 4; press += 1) {
    await page.keyboard.down('Enter')
    const held = await readCaretLine()
    await page.keyboard.up('Enter')
    const released = await readCaretLine()
    expect(held.topGap).toBeGreaterThanOrEqual(0)
    expect(held.bottomGap).toBeGreaterThanOrEqual(0)
    // Releasing the key is not what moves the Card. If it were, the writer
    // would watch the view catch up after every new line.
    expect(released.scrollTop).toBe(held.scrollTop)
  }

  await page.keyboard.type('Still following')
  const typedLine = await readCaretLine()
  expect(typedLine.topGap).toBeGreaterThanOrEqual(0)
  expect(typedLine.bottomGap).toBeGreaterThanOrEqual(0)
})

test('deleting selected text preserves adjacent spaces for continued typing', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id: 'selection-delete-note',
        kind: 'note',
        blocks: [{ id: 'selection-delete-note-block', text: 'Testing 123' }],
        position: { x: 180, y: 120 },
        size: { width: 360, height: 280 },
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
  })

  const node = page.locator('.react-flow__node-note[data-id="selection-delete-note"]')
  const passive = node.locator('.note-render.markdown')
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="selection-delete-note"]',
    () => passive.click(),
  )

  await selectEditorText(editor, '123')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('123')
  await page.waitForTimeout(50)

  await page.keyboard.press('Backspace')
  await expect.poll(() => editor.evaluate((element) => element.textContent)).toBe('Testing ')
  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    const text = devWindow.__eido.getState().cards
      .find((card) => card.id === 'selection-delete-note')
      ?.blocks[0]?.text
    return text === 'Testing ' || text === 'Testing&#x20;'
  })).toBe(true)
  await page.keyboard.type('abc')
  await expect.poll(() => editor.evaluate((element) => element.textContent)).toBe('Testing abc')

  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().cards
      .find((card) => card.id === 'selection-delete-note')
      ?.blocks[0]?.text
  })).toBe('Testing abc')

  // A later selection replacement keeps the authored trailing boundary just
  // like an ordinary editor; it must not inherit state from the preceding
  // deletion.
  await selectEditorText(editor, 'abc')
  await page.keyboard.press('Backspace')
  await selectEditorText(editor, 'Testing')
  await page.keyboard.type('Other')
  await expect.poll(() => editor.evaluate((element) => element.textContent)).toBe('Other ')

  await editor.press('ControlOrMeta+A')
  await page.keyboard.type('Testing 123')
  await expect.poll(() => editor.evaluate((element) => element.textContent)).toBe('Testing 123')

  await selectEditorText(editor, 'Testing')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Testing')
  await page.waitForTimeout(50)

  await page.keyboard.press('Delete')
  await expect.poll(() => editor.evaluate((element) => element.textContent)).toBe(' 123')
  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    const text = devWindow.__eido.getState().cards
      .find((card) => card.id === 'selection-delete-note')
      ?.blocks[0]?.text
    return text === ' 123' || text === '&#x20;123'
  })).toBe(true)
  await page.keyboard.type('abc')
  await expect.poll(() => editor.evaluate((element) => element.textContent)).toBe('abc 123')

  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().cards
      .find((card) => card.id === 'selection-delete-note')
      ?.blocks[0]?.text
  })).toBe('abc 123')
})

test('Backspace and Delete paint both spaces immediately after deleting a middle selection', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id: 'settled-selection-delete-note',
        kind: 'note',
        blocks: [{ id: 'settled-selection-delete-note-block', text: 'test spacing delete' }],
        position: { x: 180, y: 120 },
        size: { width: 360, height: 280 },
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
  })

  const node = page.locator('.react-flow__node-note[data-id="settled-selection-delete-note"]')
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="settled-selection-delete-note"]',
    () => node.locator('.note-render.markdown').click(),
  )

  await dragSelectEditorTextBackward(editor, 'spacing')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('spacing')
  await page.keyboard.press('Backspace')

  // Both spaces must paint immediately after the editor-to-Graph echo
  // settles, before another character is inserted.
  await page.waitForTimeout(750)
  await expect.poll(() => editor.evaluate((element) => (element as HTMLElement).innerText))
    .toBe('test  delete')
  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().cards
      .find((card) => card.id === 'settled-selection-delete-note')
      ?.blocks[0]?.text
  })).toMatch(/^(?:test  delete|test&#x20;&#x20;delete)$/)

  await page.keyboard.type('s')
  await expect(editor).toHaveText('test s delete')
  await editor.press('ControlOrMeta+A')
  await page.keyboard.type('test spacing delete')
  await selectEditorText(editor, 'spacing')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('spacing')
  await page.keyboard.press('Delete')
  await page.waitForTimeout(750)
  await expect.poll(() => editor.evaluate((element) => (element as HTMLElement).innerText))
    .toBe('test  delete')
  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().cards
      .find((card) => card.id === 'settled-selection-delete-note')
      ?.blocks[0]?.text
  })).toMatch(/^(?:test  delete|test&#x20;&#x20;delete)$/)
})

test('selection deletion preserves both boundary spaces across formatted nodes', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id: 'formatted-selection-note',
        kind: 'note',
        blocks: [{
          id: 'formatted-selection-note-block',
          text: 'Before **bold** after\n\nBefore [link](https://example.com) after',
        }],
        position: { x: 180, y: 120 },
        size: { width: 420, height: 300 },
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
  })

  const node = page.locator('.react-flow__node-note[data-id="formatted-selection-note"]')
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="formatted-selection-note"]',
    () => node.locator('.note-render.markdown').click(),
  )
  const replaceFormattedText = async (selector: 'strong' | 'a', key: 'Backspace' | 'Delete') => {
    await selectEditorText(editor, selector === 'strong' ? 'bold' : 'link')
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe(
      selector === 'strong' ? 'bold' : 'link',
    )
    await page.waitForTimeout(50)
    await page.keyboard.press(key)
    await page.keyboard.type(selector === 'strong' ? 'strong' : 'fresh')
  }

  await replaceFormattedText('strong', 'Backspace')
  await expect(editor).toContainText('Before strong after')
  await replaceFormattedText('a', 'Delete')
  await expect(editor).toContainText('Before fresh after')

  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().cards
      .find((card) => card.id === 'formatted-selection-note')?.blocks[0]?.text
  })).toBe('Before **strong** after\n\nBefore fresh after')

  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  const passive = node.locator('.note-render.markdown')
  await expect(editor).not.toBeAttached()
  await expect(passive).toContainText('Before strong after')
  await expect(passive).toContainText('Before fresh after')

  const { editor: reopenedEditor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="formatted-selection-note"]',
    () => passive.click(),
  )
  await expect(reopenedEditor).toContainText('Before strong after')
  await expect(reopenedEditor).toContainText('Before fresh after')
})

test('selection Backspace keeps Lexical block semantics when clearing a heading', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id: 'heading-delete-note',
        kind: 'note',
        blocks: [{ id: 'heading-delete-block', text: '# Heading' }],
        position: { x: 180, y: 120 },
        size: { width: 360, height: 280 },
      }],
      connections: [], outputs: [], runs: [], intentLog: [], selection: null,
      selectedCardIds: [], undoStack: [], redoStack: [], activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  })

  const node = page.locator('.react-flow__node-note[data-id="heading-delete-note"]')
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="heading-delete-note"]',
    () => node.locator('.note-render.markdown').click(),
  )
  await selectEditorText(editor, 'Heading')
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Heading')
  await page.waitForTimeout(50)
  await page.keyboard.press('Backspace')
  await page.keyboard.type('Plain continuation')

  await expect(editor.locator('h1')).toHaveCount(0)
  await expect(editor.getByText('Plain continuation', { exact: true })).toBeVisible()
})

test('selection whitespace handling preserves exact authored literal and entity lookalikes', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  const source = 'Literal \u2060\u2062\u2060 sequence\n\n```txt\n' +
    '&#8288;&#8290;&#8288;\n&#x2060;&#x2062;&#x2060;\n```\n\nEdit here'
  await page.evaluate((text) => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id: 'authored-joiner-note',
        kind: 'note',
        blocks: [{ id: 'authored-joiner-block', text }],
        position: { x: 180, y: 120 },
        size: { width: 420, height: 320 },
      }],
      connections: [], outputs: [], runs: [], intentLog: [], selection: null,
      selectedCardIds: [], undoStack: [], redoStack: [], activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom: 1 })
  }, source)

  const node = page.locator('.react-flow__node-note[data-id="authored-joiner-note"]')
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="authored-joiner-note"]',
    () => node.locator('.note-render.markdown').click(),
  )
  await editor.focus()
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
  await page.keyboard.type(' updated')

  await expect.poll(() => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().cards
      .find((card) => card.id === 'authored-joiner-note')?.blocks[0]?.text
  })).toContain('Edit here updated')
  const persisted = await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().cards
      .find((card) => card.id === 'authored-joiner-note')?.blocks[0]?.text ?? ''
  })
  expect(persisted).toContain('\u2060\u2062\u2060')
  expect(persisted).toContain('&#8288;&#8290;&#8288;')
  expect(persisted).toContain('&#x2060;&#x2062;&#x2060;')
})

test('numeric character references stay normalized across every Markdown Card surface', async ({
  page,
}) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  const source = ['* Before', '* &#x9;', '* After &#8217; &#x1F642;'].join('\n')
  await page.evaluate((text) => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'entity-note',
          kind: 'note',
          blocks: [{ id: 'entity-note-block', text }],
          position: { x: 40, y: 40 },
          size: { width: 280, height: 210 },
        },
        {
          id: 'entity-ask',
          kind: 'askAi',
          blocks: [{ id: 'entity-ask-block', text }],
          position: { x: 350, y: 40 },
          size: { width: 280, height: 240 },
        },
        {
          id: 'entity-conversation',
          kind: 'conversation',
          blocks: [{ id: 'entity-conversation-block', text }],
          conversationStyle: 'collaborate',
          conversationTurns: 2,
          position: { x: 660, y: 40 },
          size: { width: 280, height: 250 },
        },
        {
          id: 'entity-result',
          kind: 'result',
          blocks: [{ id: 'entity-result-block', text: '' }],
          position: { x: 40, y: 330 },
          size: { width: 360, height: 270 },
        },
        {
          id: 'entity-group',
          kind: 'group',
          title: 'Entity Group',
          blocks: [],
          position: { x: 440, y: 330 },
          size: { width: 500, height: 270 },
        },
      ],
      connections: [],
      outputs: [
        {
          id: 'entity-result-output',
          resultCardId: 'entity-result',
          chosenVersionId: 'entity-result-version',
          versions: [{
            id: 'entity-result-version',
            number: 1,
            text,
            createdAt: '2026-08-25T00:00:00.000Z',
            fromRunId: 'entity-result-run',
          }],
        },
        {
          id: 'entity-group-output',
          resultCardId: 'entity-group',
          chosenVersionId: 'entity-group-version',
          versions: [{
            id: 'entity-group-version',
            number: 1,
            text,
            createdAt: '2026-08-25T00:00:00.000Z',
            fromRunId: 'entity-group-run',
          }],
        },
      ],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      activeTool: 'select',
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 20, y: 20, zoom: 1 })
  }, source)

  const assertNormalizedList = async (root: import('@playwright/test').Locator) => {
    await expect(root).not.toContainText('#x9')
    await expect(root.locator('li')).toHaveCount(2)
    await expect(root).toContainText('Before')
    await expect(root).toContainText('After ’ 🙂')
  }

  for (const id of ['entity-note', 'entity-ask', 'entity-conversation']) {
    const node = page.locator(`.react-flow__node[data-id="${id}"]`)
    await assertNormalizedList(node.locator('.note-render.markdown'))
    const { editor } = await activateAndRequireExactReadyMarkdownEditor(
      page,
      `.react-flow__node[data-id="${id}"]`,
      () => node.locator('.note-render.markdown').click(),
    )
    await assertNormalizedList(editor)
    await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } })
    await expect.poll(() => page.evaluate((cardId) => {
      const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
      return devWindow.__eido.getState().cards.find((card) => card.id === cardId)?.blocks[0]?.text ?? ''
    }, id)).not.toContain('&#')
  }

  await assertNormalizedList(
    page.locator('.react-flow__node[data-id="entity-result"] .result-text.markdown'),
  )

  const group = page.locator('.react-flow__node[data-id="entity-group"]')
  await group.getByRole('button', { name: 'Details', exact: true }).click()
  await assertNormalizedList(page.locator('.group-version-text.markdown'))
})

test('caret-follow scrolling adds no space below Enter or soft-wrapped text', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id: 'caret-margin-note',
        kind: 'note',
        blocks: [{
          id: 'caret-margin-note-block',
          text: [
            ...Array.from({ length: 6 }, (_, index) => `Existing line ${index + 1}`),
            '# Existing heading',
          ].join('\n\n'),
        }],
        position: { x: 180, y: 120 },
        size: { width: 360, height: 280 },
        meta: { noteFontSize: 3 },
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
  })

  const node = page.locator('.react-flow__node-note[data-id="caret-margin-note"]')
  const passive = node.locator('.note-render.markdown')
  const { editor } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="caret-margin-note"]',
    () => passive.click(),
  )
  const body = node.locator('.card-body')

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

  const readCaretState = () => body.evaluate((bodyElement) => {
    const selection = window.getSelection()
    if (!selection?.rangeCount) throw new Error('Expected a caret selection')
    const caret = selection.getRangeAt(0).getBoundingClientRect()
    const bodyBounds = bodyElement.getBoundingClientRect()
    const editor = bodyElement.querySelector<HTMLElement>('.markdown-card-editor-content')
    if (!editor) throw new Error('Expected Markdown editor')
    const activeLine = selection.anchorNode instanceof Text
      ? selection.anchorNode.parentElement
      : selection.anchorNode instanceof HTMLElement
        ? selection.anchorNode
        : editor
    const lineHeight = Number.parseFloat(getComputedStyle(activeLine ?? editor).lineHeight)
    return {
      bodyTop: bodyBounds.top,
      bodyBottom: bodyBounds.bottom,
      caretTop: caret.top,
      caretBottom: caret.bottom,
      bottomGap: bodyBounds.bottom - caret.bottom,
      lineHeight,
      scrollTop: bodyElement.scrollTop,
    }
  })

  const heightBeforeWrap = await editor.evaluate((element) => element.scrollHeight)
  await page.keyboard.type(
    ' with enough continuing sentence text to wrap this heading onto another visual line',
  )
  await expect.poll(() => editor.evaluate((element) => element.scrollHeight)).toBeGreaterThan(
    heightBeforeWrap,
  )
  const wrappedLineCaret = await readCaretState()
  expect(wrappedLineCaret.scrollTop).toBeGreaterThan(0)
  expect(wrappedLineCaret.caretTop).toBeGreaterThanOrEqual(wrappedLineCaret.bodyTop)
  expect(wrappedLineCaret.caretBottom).toBeLessThanOrEqual(wrappedLineCaret.bodyBottom)
  // The Card follows the caret by the smallest amount that shows its line, and
  // never further: a reserve below the last line is room the writer did not
  // type, and it would have to disappear again when they stop editing.
  expect(wrappedLineCaret.bottomGap).toBeLessThan(wrappedLineCaret.lineHeight)

  await page.keyboard.press('Enter')
  await page.keyboard.type('New bottom line')
  const enteredLineCaret = await readCaretState()
  expect(enteredLineCaret.caretTop).toBeGreaterThanOrEqual(enteredLineCaret.bodyTop)
  expect(enteredLineCaret.caretBottom).toBeLessThanOrEqual(enteredLineCaret.bodyBottom)
  expect(enteredLineCaret.bottomGap).toBeLessThan(enteredLineCaret.lineHeight)
})

// A blank line the founder actually typed after a heading, a list, a code
// fence, or a paragraph must survive an edit, a save (blur), and a reopen -
// the export visitor's furniture guard must not mistake it for the empty
// paragraph MDXEditor parks after a non-paragraph block so there is
// somewhere to type. `authoredBlankParagraphs` in shared/markdown.ts governs
// how many blank source lines one authored empty paragraph reads as; a
// single trailing blank paragraph round-trips as two trailing newlines.
const trailingBlankCases: Array<{
  name: string
  seedText: string
  editAnchor: string
  editAt: 'start' | 'end'
  editedText: string
  reopenedParagraphCount: number
}> = [
  {
    name: 'a heading',
    seedText: '# Heading\n\n\n',
    editAnchor: 'H',
    editAt: 'end',
    editedText: '# HXeading\n\n',
    reopenedParagraphCount: 1,
  },
  {
    name: 'a list',
    seedText: '- item\n\n\n',
    editAnchor: 'item',
    editAt: 'start',
    editedText: '* Xitem\n\n',
    reopenedParagraphCount: 1,
  },
  {
    name: 'a paragraph',
    seedText: 'Paragraph\n\n\n',
    editAnchor: 'P',
    editAt: 'end',
    editedText: 'PXaragraph\n\n',
    reopenedParagraphCount: 2,
  },
]

for (const trailingBlankCase of trailingBlankCases) {
  test(`an authored trailing blank line survives editing, save, and reopen after ${trailingBlankCase.name}`, async ({ page }) => {
    await page.goto('/')
    await page.waitForFunction(() => {
      const devWindow = window as unknown as DevWindow
      return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
    })

    await page.evaluate((text) => {
      const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
      devWindow.__eido.setState({
        cards: [{
          id: 'trailing-blank-note',
          kind: 'note',
          blocks: [{ id: 'trailing-blank-note-block', text }],
          position: { x: 180, y: 120 },
          size: { width: 360, height: 280 },
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
    }, trailingBlankCase.seedText)

    const node = page.locator('.react-flow__node-note[data-id="trailing-blank-note"]')
    const passive = node.locator('.note-render.markdown')
    const persistedText = () => page.evaluate(() => {
      const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
      return devWindow.__eido.getState().cards
        .find((card) => card.id === 'trailing-blank-note')
        ?.blocks[0]?.text
    })

    const { editor } = await activateAndRequireExactReadyMarkdownEditor(
      page,
      '.react-flow__node-note[data-id="trailing-blank-note"]',
      // A default centered click can land on the trailing blank line rather
      // than the opening block for a short two-line Note. Aim at the first
      // line explicitly.
      () => passive.click({ position: { x: 12, y: 12 } }),
    )
    // Edit the first line, matching the founder's own reproduction: a
    // character typed near the start of the opening block, nowhere near the
    // trailing blank, must not disturb it. Pin the caret to text rather than
    // relying on platform-specific Home semantics or the click's glyph offset.
    await selectEditorText(editor, trailingBlankCase.editAnchor, trailingBlankCase.editAt)
    await page.keyboard.type('X')
    await expect.poll(persistedText).toBe(trailingBlankCase.editedText)

    // Close the Card (the save) and reopen it: the blank line must still be
    // there, and a second round trip through the export visitor must not
    // erode it further.
    await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
    await expect(editor).not.toBeAttached()
    await expect.poll(persistedText).toBe(trailingBlankCase.editedText)

    const { editor: reopenedEditor } = await activateAndRequireExactReadyMarkdownEditor(
      page,
      '.react-flow__node-note[data-id="trailing-blank-note"]',
      () => passive.click(),
    )
    await expect(reopenedEditor.locator('> p')).toHaveCount(trailingBlankCase.reopenedParagraphCount)
    await expect(reopenedEditor.locator('> p').last()).toHaveText('')
    await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
    await expect(reopenedEditor).not.toBeAttached()
    await expect.poll(persistedText).toBe(trailingBlankCase.editedText)
  })
}

test('an authored trailing blank line survives editing, save, and reopen after a code fence', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate((text) => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    devWindow.__eido.setState({
      cards: [{
        id: 'trailing-blank-code-note',
        kind: 'note',
        blocks: [{ id: 'trailing-blank-code-note-block', text }],
        position: { x: 180, y: 120 },
        size: { width: 360, height: 280 },
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
  }, '```\ncode\n```\n\n\n')

  const node = page.locator('.react-flow__node-note[data-id="trailing-blank-code-note"]')
  const passive = node.locator('.note-render.markdown')
  const editorContent = node.locator('.markdown-card-editor-content[contenteditable="true"]')
  const persistedText = () => page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: NonNullable<DevWindow['__eido']> }
    return devWindow.__eido.getState().cards
      .find((card) => card.id === 'trailing-blank-code-note')
      ?.blocks[0]?.text
  })
  // The code fence is the opening block, so clicking anywhere near the top
  // of the Note focuses its own nested contenteditable rather than the
  // outer Markdown editor. Wait on the transition flag directly instead of
  // requiring the outer editor to hold DOM focus.
  const waitForEditorReady = () => expect.poll(
    () => node.locator('.markdown-card-editor-transition').getAttribute('data-editor-ready'),
  ).toBe('true')

  await passive.click({ position: { x: 12, y: 12 } })
  await waitForEditorReady()
  const codeBlock = editorContent.locator('.markdown-card-code-block code')
  await selectEditorText(codeBlock, 'code', 'end')
  await page.keyboard.type('X')
  await expect.poll(persistedText).toBe('```\ncodeX\n```\n\n')

  // The code fence's own nested contenteditable, not Lexical's outer root,
  // still holds focus. Return focus to the outer editor - by way of the
  // trailing blank paragraph it is defending - before closing the Card, the
  // same way a person tabbing or clicking out of a fenced block would.
  await editorContent.locator('> p').last().click()
  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } })
  await expect(editorContent).not.toBeAttached()
  await expect.poll(persistedText).toBe('```\ncodeX\n```\n\n')

  await passive.click({ position: { x: 12, y: 12 } })
  await waitForEditorReady()
  await expect(editorContent.locator('> p')).toHaveCount(1)
  await expect(editorContent.locator('> p').last()).toHaveText('')
})
