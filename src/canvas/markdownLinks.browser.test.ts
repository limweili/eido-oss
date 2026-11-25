import { expect, test, type Locator, type Page } from '@playwright/test'
import { activateAndRequireExactReadyMarkdownEditor } from '../performance/richCardEditorReadiness'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{
      id: string
      blocks: Array<{ text: string }>
    }>
  }
  setState: (state: unknown) => void
}

type DevWindow = Window & typeof globalThis & {
  __eido: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

async function seedLinkNote(page: Page, text: string, zoom = 1) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as Partial<DevWindow>
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate((seed) => {
    const devWindow = window as unknown as DevWindow
    devWindow.__eido.setState({
      cards: [{
        id: 'link-edit-note',
        kind: 'note',
        title: 'Links',
        blocks: [{ id: 'link-edit-block', text: seed.markdown }],
        position: { x: 120, y: 100 },
        size: { width: 460, height: 300 },
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
      visualDecayEnabled: false,
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 40, y: 30, zoom: seed.zoom })
  }, { markdown: text, zoom })
  const note = page.locator('.react-flow__node-note[data-id="link-edit-note"]')
  await expect(note).toBeVisible()
  return note
}

test('pasting a URL over selected Note text turns that text into a link', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const note = await seedLinkNote(page, 'Eido guide')
  const readyEditor = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="link-edit-note"]',
    () => note.locator('.note-render').click(),
  )
  const editor = readyEditor.editor
  await page.evaluate(() => navigator.clipboard.writeText('https://example.com/guide'))
  await editor.click()
  const modifier = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 'Meta' : 'Control'))
  await page.keyboard.press(`${modifier}+A`)
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Eido guide')

  await page.keyboard.press(`${modifier}+V`)

  const link = editor.locator('a', { hasText: 'Eido guide' })
  await expect(link).toHaveAttribute('href', 'https://example.com/guide')
  await expect(editor).toHaveText('Eido guide')
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as DevWindow).__eido
      .getState()
      .cards.find((card) => card.id === 'link-edit-note')
      ?.blocks.map((block) => block.text)
      .join('\n') ?? ''
  ))).toContain('[Eido guide](https://example.com/guide)')
})

test('view and edit modes share link formatting and offer a compact link editor', async ({
  page,
}) => {
  const note = await seedLinkNote(
    page,
    'Open [Board.tsx (line 1562)](/Users/example/Projects/eido/src/canvas/Board.tsx:1562) here.',
  )
  const passiveLink = note.locator('.note-render a', { hasText: 'Board.tsx (line 1562)' })
  await expect(passiveLink).toHaveAttribute(
    'href',
    '/Users/example/Projects/eido/src/canvas/Board.tsx:1562',
  )
  const passiveAppearance = await linkAppearance(passiveLink)

  const popupPromise = page.waitForEvent('popup')
  await passiveLink.click()
  const opened = await popupPromise
  await expect(opened).toHaveURL(/\/Users\/weili\/Projects\/eido\/src\/canvas\/Board\.tsx:1562$/)
  await opened.close()

  const readyEditor = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="link-edit-note"]',
    () => note.locator('.note-render').click(),
  )
  const editorLink = readyEditor.editor.locator('a', { hasText: 'Board.tsx (line 1562)' })
  await expect(editorLink).toHaveAttribute(
    'href',
    '/Users/example/Projects/eido/src/canvas/Board.tsx:1562',
  )
  expect(await linkAppearance(editorLink)).toEqual(passiveAppearance)

  await editorLink.click()
  const editLink = page.getByRole('button', { name: 'Edit link' })
  await expect(editLink).toBeVisible()
  const editBounds = await editLink.boundingBox()
  expect(editBounds?.width).toBe(26)
  expect(editBounds?.height).toBe(26)
  await editLink.hover()
  await expect(page.locator('.e-tooltip').filter({ hasText: 'Edit link' })).toBeVisible()
  await editLink.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  expect(await editLink.evaluate((element) => element.matches(':focus-visible'))).toBe(true)
  await page.keyboard.press('Escape')
  await expect(editLink).not.toBeVisible()
  await expect(editorLink).toBeFocused()
  await editorLink.click()
  await expect(editLink).toBeVisible()
  await editLink.click()
  const urlInput = page.getByRole('textbox', { name: 'URL' })
  await expect(urlInput).toHaveValue('/Users/example/Projects/eido/src/canvas/Board.tsx:1562')
  // There is no Save: the form is the link, so what it holds is what the body
  // holds.
  await expect(page.getByRole('button', { name: 'Save' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Cancel' })).toHaveCount(0)
  await urlInput.fill('https://example.com/updated')
  await expect(editorLink).toHaveAttribute('href', 'https://example.com/updated')

  await urlInput.fill('javascript:alert(1)')
  await expect(urlInput).toHaveJSProperty(
    'validationMessage',
    "That link type isn't supported.",
  )
  await expect(page.locator('.e-markdown-link-dialog__message')).toHaveText(
    "That link type isn't supported.",
  )
  await expect(editorLink).toHaveAttribute('href', 'https://example.com/updated')
  await urlInput.fill('https://example.com/updated')
  await expect(page.locator('.e-markdown-link-dialog__message')).toHaveCount(0)

  await exitEditing(page)
  const updatedPassiveLink = note.locator('.note-render a', { hasText: 'Board.tsx (line 1562)' })
  await expect(updatedPassiveLink).toHaveAttribute('href', 'https://example.com/updated')
  expect(await linkAppearance(updatedPassiveLink)).toEqual(passiveAppearance)
})

test('unsafe stored Markdown links remain literal in view and edit modes', async ({ page }) => {
  const markdown = [
    '[Unsafe](javascript:alert(1))',
    '[Encoded](javascript&#x3A;alert(1))',
    '',
    '`[Inline](javascript:alert(2))`',
    '',
    '```md',
    '[Fenced](javascript:alert(3))',
    '```',
  ].join('\n')
  const note = await seedLinkNote(page, markdown)
  const passive = note.locator('.note-render')
  await expect(passive).toContainText('[Unsafe](javascript:alert(1))')
  await expect(passive).toContainText('[Encoded](javascript:alert(1))')
  await expect(passive.locator('code').first()).toHaveText('[Inline](javascript:alert(2))')
  await expect(passive.locator('pre code')).toHaveText('[Fenced](javascript:alert(3))')
  await expect(passive.locator('a')).toHaveCount(0)

  const readyEditor = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="link-edit-note"]',
    () => note.locator('.note-render').click(),
  )
  await expect(readyEditor.editor).toContainText('[Unsafe](javascript:alert(1))')
  await expect(readyEditor.editor).toContainText('[Inline](javascript:alert(2))')
  await expect(readyEditor.editor).toContainText('[Fenced](javascript:alert(3))')
  await expect(readyEditor.editor.locator('a')).toHaveCount(0)

  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } })
  const savedAfterFirstEdit = await page.evaluate(() => (
    (window as unknown as DevWindow).__eido
      .getState()
      .cards.find((card) => card.id === 'link-edit-note')
      ?.blocks.map((block) => block.text)
      .join('\n') ?? ''
  ))
  expect(savedAfterFirstEdit).toContain('`[Inline](javascript:alert(2))`')
  expect(savedAfterFirstEdit).toContain('[Fenced](javascript:alert(3))')
  expect(savedAfterFirstEdit).not.toContain('`\\[Inline]')
  expect(savedAfterFirstEdit).not.toContain('\\[Fenced]')
  const reopened = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="link-edit-note"]',
    () => note.locator('.note-render').click(),
  )
  await expect(reopened.editor).toContainText('[Unsafe](javascript:alert(1))')
  await expect(reopened.editor.locator('a')).toHaveCount(0)
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } })
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as DevWindow).__eido
      .getState()
      .cards.find((card) => card.id === 'link-edit-note')
      ?.blocks.map((block) => block.text)
      .join('\n') ?? ''
  ))).toBe(savedAfterFirstEdit)
})

test('a pasted URL with query parameters reads as one link in the passive Card', async ({
  page,
  context,
}) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  // The Markdown editor writes this address back with its punctuation escaped
  // (`?v\\=1\\&pp\\=2`). A reader that took those escapes literally showed the
  // writer raw `[...](...)` source instead of the link they pasted.
  const url = 'https://example.com/watch?v=Qtl8lJwbd4g&pp=ugUEEgJlbg%3D%3D'
  const note = await seedLinkNote(page, '')
  const readyEditor = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="link-edit-note"]',
    () => note.locator('.note-render').click(),
  )
  await page.evaluate((address) => navigator.clipboard.writeText(address), url)
  await readyEditor.editor.click()
  const modifier = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 'Meta' : 'Control'))
  await page.keyboard.press(`${modifier}+V`)
  await expect.poll(() => page.evaluate(() => (
    (window as unknown as DevWindow).__eido.getState().cards[0].blocks[0].text
  ))).not.toBe('')

  await page.keyboard.press('Escape')
  await page.mouse.click(900, 600)

  const passive = note.locator('.note-render')
  await expect(passive.locator('a')).toHaveCount(1)
  await expect(passive.locator('a')).toHaveAttribute('href', url)
  await expect(passive).not.toContainText('](')
})

// The dialog is an inline affordance: it must arrive beside the link the
// writer clicked, at whatever zoom the Board happens to be at. The trigger the
// popover measures used to render inside React Flow's transformed viewport,
// where `position: fixed` is measured against that transform rather than the
// window, so the surface landed offset and scaled away from its own link -
// far enough at a zoomed-out Board to leave the Card, or the screen.
for (const zoom of [1, 0.6, 0.33]) {
  test(`the link dialog opens beside its link at zoom ${zoom}`, async ({ page }) => {
    const note = await seedLinkNote(
      page,
      'Open [Board.tsx](https://example.com/board) here.',
      zoom,
    )
    const readyEditor = await activateAndRequireExactReadyMarkdownEditor(
      page,
      '.react-flow__node-note[data-id="link-edit-note"]',
      () => note.locator('.note-render').click(),
    )
    const editorLink = readyEditor.editor.locator('a', { hasText: 'Board.tsx' })
    await editorLink.click()
    const dialog = page.locator('.e-markdown-link-dialog')
    await expect(dialog).toBeVisible()

    const linkBounds = await editorLink.boundingBox()
    const dialogBounds = await dialog.boundingBox()
    if (!linkBounds || !dialogBounds) throw new Error('Missing link or dialog geometry')
    const viewport = page.viewportSize()
    if (!viewport) throw new Error('Missing viewport')

    // Beside the link horizontally, and within a short vertical reach of it.
    // The exact side is the floating layer's decision, so this asserts the
    // relationship a reader sees rather than one placement.
    expect(dialogBounds.x).toBeLessThan(linkBounds.x + linkBounds.width + 24)
    expect(dialogBounds.x + dialogBounds.width).toBeGreaterThan(linkBounds.x - 24)
    const gap = dialogBounds.y > linkBounds.y
      ? dialogBounds.y - (linkBounds.y + linkBounds.height)
      : linkBounds.y - (dialogBounds.y + dialogBounds.height)
    expect(gap).toBeLessThan(24)
    // And fully on screen, which is the founder's actual complaint.
    expect(dialogBounds.x).toBeGreaterThanOrEqual(0)
    expect(dialogBounds.y).toBeGreaterThanOrEqual(0)
    expect(dialogBounds.x + dialogBounds.width).toBeLessThanOrEqual(viewport.width)
    expect(dialogBounds.y + dialogBounds.height).toBeLessThanOrEqual(viewport.height)
  })
}

// Pressing a control in the dialog moves focus out of the contenteditable. The
// Note used to read that blur as "the writer is done" and leave edit mode,
// which unmounted the dialog under the pointer before its click could land.
test('editing a link through the dialog keeps the Note in edit mode', async ({ page }) => {
  const note = await seedLinkNote(
    page,
    'Open [Board.tsx](https://example.com/board) here.',
    0.6,
  )
  const readyEditor = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="link-edit-note"]',
    () => note.locator('.note-render').click(),
  )
  const editorLink = readyEditor.editor.locator('a', { hasText: 'Board.tsx' })
  await editorLink.click()
  await page.getByRole('button', { name: 'Edit link' }).click()
  const urlInput = page.getByRole('textbox', { name: 'URL' })
  await expect(urlInput).toBeVisible()
  await urlInput.fill('https://example.com/moved')

  await expect(editorLink).toHaveAttribute('href', 'https://example.com/moved')
  await expect(readyEditor.editor).toBeVisible()
})

async function storedMarkdown(page: Page) {
  return page.evaluate(() => (
    (window as unknown as DevWindow).__eido
      .getState()
      .cards.find((card) => card.id === 'link-edit-note')
      ?.blocks.map((block) => block.text)
      .join('\n') ?? ''
  ))
}

// A Markdown link is `[title](url)`, so the form that edits a link edits both
// halves of it. The title is the link node's own text, which means editing it
// here must land in the stored body exactly as typing the words would.
test('the link form edits the title as well as the address', async ({ page }) => {
  const note = await seedLinkNote(page, 'Open [Board.tsx](https://example.com/board) here.')
  const readyEditor = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="link-edit-note"]',
    () => note.locator('.note-render').click(),
  )
  await readyEditor.editor.locator('a', { hasText: 'Board.tsx' }).click()
  await page.getByRole('button', { name: 'Edit link' }).click()
  const titleInput = page.getByRole('textbox', { name: 'Title' })
  await expect(titleInput).toHaveValue('Board.tsx')

  await titleInput.fill('The Board file')

  await expect(readyEditor.editor.locator('a', { hasText: 'The Board file' })).toBeVisible()
  await expect.poll(() => storedMarkdown(page))
    .toContain('[The Board file](https://example.com/board)')

  // The passive render reads the same body, so the words the founder typed are
  // the words the Card shows once editing ends.
  await exitEditing(page)
  const passive = note.locator('.note-render a')
  await expect(passive).toHaveText('The Board file')
})

// Removing a link used to leave the address behind as plain text, which the
// passive render relinked and the preview scanner refetched: the founder
// pressed "Remove link" and watched the link and its preview come straight
// back.
test('removing a link takes the address and its preview out of the Note', async ({ page }) => {
  const url = 'https://example.com/board'
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as Partial<DevWindow>
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate((address) => {
    const devWindow = window as unknown as DevWindow
    devWindow.__eido.setState({
      cards: [{
        id: 'link-edit-note',
        kind: 'note',
        title: 'Links',
        // The link fills a line of its own so the click that opens the editor
        // lands on prose rather than on the link.
        blocks: [{
          id: 'link-edit-block',
          text: `A thought worth keeping.\n\n[${address}](${address})`,
        }],
        position: { x: 120, y: 100 },
        size: { width: 460, height: 360 },
        linkPreview: { url: address, status: 'ready', title: 'The Board' },
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
      visualDecayEnabled: false,
    })
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 40, y: 30, zoom: 1 })
  }, url)
  const note = page.locator('.react-flow__node-note[data-id="link-edit-note"]')
  await expect(note).toBeVisible()
  await expect(note.locator('.card-attachment-item--preview')).toHaveCount(1)

  const readyEditor = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="link-edit-note"]',
    () => note.locator('.note-render').click({ position: { x: 8, y: 8 } }),
  )
  await readyEditor.editor.locator('a', { hasText: url }).click()
  await page.getByRole('button', { name: 'Remove link' }).click()

  await expect(readyEditor.editor.locator('a')).toHaveCount(0)
  await expect(note.locator('.card-attachment-item--preview')).toHaveCount(0)
  await expect.poll(() => storedMarkdown(page)).not.toContain('example.com')

  // Long enough for the body-driven preview debounce to have fired twice over.
  await page.waitForTimeout(1_600)
  await expect(note.locator('.card-attachment-item--preview')).toHaveCount(0)
  expect(await storedMarkdown(page)).not.toContain('example.com')
})

// Applying as the founder types must not let a half-typed address reach the
// body as an unsafe one, and must not leave a burst of keystrokes as a burst
// of undo steps.
test('an unsafe address never reaches the body and a typing burst is one undo', async ({
  page,
}) => {
  const note = await seedLinkNote(page, 'Open [Board.tsx](https://example.com/board) here.')
  const readyEditor = await activateAndRequireExactReadyMarkdownEditor(
    page,
    '.react-flow__node-note[data-id="link-edit-note"]',
    () => note.locator('.note-render').click(),
  )
  const editorLink = readyEditor.editor.locator('a').first()
  await editorLink.click()
  await page.getByRole('button', { name: 'Edit link' }).click()
  const urlInput = page.getByRole('textbox', { name: 'URL' })
  await urlInput.click()
  const modifier = await page.evaluate(() => (/Mac/.test(navigator.platform) ? 'Meta' : 'Control'))
  await page.keyboard.press(`${modifier}+A`)
  await page.keyboard.type('javascript:alert(1)', { delay: 20 })

  // Every safe prefix of what is being typed is applied, which is the point of
  // a form with no Save. The scheme Eido refuses to render never is: it stops
  // at the colon and the body keeps the last address that was safe.
  await expect(page.locator('.e-markdown-link-dialog__message')).toBeVisible()
  await expect(editorLink).not.toHaveAttribute('href', /^javascript:/)
  expect(await storedMarkdown(page)).not.toContain('javascript:')

  await page.keyboard.press(`${modifier}+A`)
  await page.keyboard.type('https://example.com/moved', { delay: 20 })
  await expect(editorLink).toHaveAttribute('href', 'https://example.com/moved')
  await page.keyboard.press('Escape')
  await expect.poll(() => storedMarkdown(page)).toContain('https://example.com/moved')

  // One undo returns the whole burst, not one character of it.
  await readyEditor.editor.click()
  await page.keyboard.press(`${modifier}+Z`)
  await expect.poll(() => storedMarkdown(page)).toContain('https://example.com/board')
})

// Leaving the editor for the passive Card, dialog and all. The Note is only
// passive once the editor has actually gone.
async function exitEditing(page: Page) {
  // The first click dismisses the dialog and hands focus back to the editor,
  // the second takes the writer out of it.
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } })
  await page.locator('.react-flow__pane').click({ position: { x: 10, y: 10 } })
  await expect(page.locator('.markdown-card-editor-transition')).toHaveCount(0)
}

async function linkAppearance(link: Locator) {
  return link.evaluate((element) => {
    const card = element.closest('.card')
    if (!card) throw new Error('Missing Card for link')
    const cardRect = card.getBoundingClientRect()
    const rect = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const round = (value: number) => Math.round(value * 100) / 100
    return {
      x: round(rect.x - cardRect.x),
      y: round(rect.y - cardRect.y),
      width: round(rect.width),
      height: round(rect.height),
      color: style.color,
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      fontWeight: style.fontWeight,
      lineHeight: style.lineHeight,
      textDecorationLine: style.textDecorationLine,
      textUnderlineOffset: style.textUnderlineOffset,
    }
  })
}
