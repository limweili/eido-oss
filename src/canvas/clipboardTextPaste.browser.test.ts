import { expect, test, type Page } from '@playwright/test'

// A synthetic ClipboardEvent dispatched from script never triggers a
// plain input/textarea's native paste insertion in Chromium - only a
// trusted paste does. Granting clipboard permissions and pressing the real
// shortcut exercises the actual browser paste pipeline, which is what these
// ownership proofs need to see the pasted text actually land.
async function realPaste(page: Page, text: string) {
  await page.evaluate((t) => navigator.clipboard.writeText(t), text)
  await page.keyboard.press('ControlOrMeta+V')
}

async function resetBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: { getState: () => { hydrated: boolean } }
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: { setState: (state: unknown) => void }
      __EIDO_SET_VIEWPORT__: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__eido.setState({ cards: [], connections: [], selectedCardIds: [], selection: null })
    devWindow.__EIDO_SET_VIEWPORT__({ x: 0, y: 0, zoom: 1 })
  })
}

test('pasting clipboard text on the Board creates a selected Note at the pointer', async ({ page }) => {
  await resetBoard(page)

  const pastePoint = { x: 420, y: 280 }
  const pastedText = 'A thought copied from somewhere else.\n\nWith its paragraphs intact.'
  const boardBox = await page.locator('.react-flow').boundingBox()
  expect(boardBox).not.toBeNull()
  await page.mouse.move(pastePoint.x, pastePoint.y)
  await page.evaluate((text) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', text)
    window.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    }))
  }, pastedText)

  const note = page.locator('.react-flow__node-note')
  await expect(note).toHaveCount(1)
  await expect(note.locator('.note-render')).toContainText('A thought copied from somewhere else.')
  await expect(note).toHaveClass(/selected/)

  const stored = await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: {
        getState: () => {
          cards: Array<{
            kind: string
            blocks: Array<{ text: string }>
            position: { x: number; y: number }
          }>
        }
      }
    }
    return devWindow.__eido.getState().cards[0]
  })
  expect(stored).toMatchObject({
    kind: 'note',
    blocks: [{ text: pastedText }],
  })
  expect(stored.position.x).toBeCloseTo(pastePoint.x - boardBox!.x)
  expect(stored.position.y).toBeCloseTo(pastePoint.y - boardBox!.y)
})

test('pasting after a Card lost the pointer still creates a new Note, at any zoom', async ({ page }) => {
  // A Card keeps DOM focus after being clicked/edited even once the pointer
  // moves elsewhere and the viewport zooms - browsers never clear focus for
  // either reason. The Reading detail band holds that Card mounted across a
  // hysteresis-widened zoom range, so a stale focused Card used to swallow
  // every paste aimed at empty canvas until zoom finally dropped far enough
  // to unmount it. Mid-range zoom (0.5) sits well inside that failing band.
  await resetBoard(page)

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: { getState: () => { addCard: (kind: string, position: { x: number; y: number }) => string } } }
    devWindow.__eido.getState().addCard('note', { x: 0, y: 0 })
  })
  const existingNote = page.locator('.react-flow__node-note')
  await expect(existingNote).toHaveCount(1)
  await existingNote.locator('.note-render').click()

  await page.evaluate(() => {
    const w = window as unknown as { __EIDO_SET_VIEWPORT__: (v: { x: number; y: number; zoom: number }) => void }
    w.__EIDO_SET_VIEWPORT__({ x: 0, y: 0, zoom: 0.5 })
  })
  const pastePoint = { x: 600, y: 320 }
  await page.mouse.move(pastePoint.x, pastePoint.y)

  const pastedText = 'A second thought pasted elsewhere on the canvas.'
  await page.evaluate((text) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', text)
    document.activeElement!.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    }))
  }, pastedText)

  await expect(page.locator('.react-flow__node-note')).toHaveCount(2)
})

test('an external copy after a Card copy wins the next paste, and Card paste still works after that', async ({ page, context }) => {
  // Regression test for: copy a Card, then copy something else on the
  // system clipboard (e.g. switch to another app and copy text there).
  // Before the fix, the internal Card clipboard stayed populated forever
  // and every later Cmd/Ctrl+V replayed the copied Card instead of ordinary
  // external text, until the app restarted. The system clipboard must
  // decide which copy is newest. A live cursor inside a Card editor owning
  // its own paste regardless is covered separately, right below.
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await resetBoard(page)

  const originalId = await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: { getState: () => { addCard: (kind: string, position: { x: number; y: number }) => string } }
    }
    return devWindow.__eido.getState().addCard('note', { x: 0, y: 0 })
  })
  const notes = page.locator('.react-flow__node-note')
  const originalNote = page.locator(`.react-flow__node-note[data-id="${originalId}"]`)
  await expect(notes).toHaveCount(1)
  await originalNote.locator('.card-head').click({ position: { x: 250, y: 3 } })
  await expect(originalNote).toHaveClass(/selected/)

  // Copy the Card through Eido's own copy command, wait for the write to
  // land on the system clipboard, then paste: the ordinary Card paste path
  // must keep working.
  await page.keyboard.press('ControlOrMeta+C')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('# Board')
  await page.mouse.move(700, 300)
  await page.keyboard.press('ControlOrMeta+V')
  await expect(notes).toHaveCount(2)

  // Copying something else on the SYSTEM clipboard - not through Eido's
  // copy command - must win the very next paste.
  const externalText = 'A thought copied from outside Eido entirely.'
  await page.evaluate((text) => navigator.clipboard.writeText(text), externalText)
  await page.mouse.move(900, 500)
  await page.keyboard.press('ControlOrMeta+V')
  await expect(notes).toHaveCount(3)
  const pastedTexts = await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: { getState: () => { cards: Array<{ blocks: Array<{ text: string }> }> } }
    }
    return devWindow.__eido.getState().cards.map((card) => card.blocks[0]?.text)
  })
  expect(pastedTexts).toContain(externalText)

  // Copying Cards again must still work: switching back to Card copy is not
  // permanently blocked by the earlier external copy. Escape first: the
  // preceding board paste leaves its own Card selected, and re-selecting a
  // single Card from a multi-Card scene needs a clean slate rather than
  // whatever additive selection state an in-flight hold left behind.
  await page.keyboard.press('Escape')
  await originalNote.locator('.card-head').click({ position: { x: 250, y: 3 } })
  await expect(originalNote).toHaveClass(/selected/)
  await page.keyboard.press('ControlOrMeta+C')
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('# Board')
  await page.mouse.move(1100, 700)
  await page.keyboard.press('ControlOrMeta+V')
  await expect(notes).toHaveCount(4)
})

test('a live cursor in a Card title owns the paste, no matter the pointer', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await resetBoard(page)

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: { getState: () => { addCard: (kind: string, position: { x: number; y: number }) => string } } }
    devWindow.__eido.getState().addCard('note', { x: 0, y: 0 })
  })
  const node = page.locator('.react-flow__node-note')
  await expect(node).toHaveCount(1)
  await node.locator('.card-head').click({ position: { x: 250, y: 3 } })
  // The title opens only once the Card itself renders as selected. React
  // Flow's wrapper class arrives first; the Card's own selected render is the
  // gate the title editor reads, so wait for that before pressing the title.
  await expect(node.locator('.card')).toHaveClass(/selected/)
  await node.locator('.card-title-display').click()
  const titleInput = node.locator('.card-title-input')
  await expect(titleInput).toBeFocused()

  // Park the pointer far from the Card. Ownership must follow the live
  // cursor, not the pointer that would otherwise place a new Card.
  await page.mouse.move(1100, 40)
  await realPaste(page, 'Pasted title text')

  await expect(titleInput).toHaveValue('Pasted title text')
  await expect(page.locator('.react-flow__node-note')).toHaveCount(1)
})

test('a live cursor in a Title card owns the paste, no matter the pointer', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await resetBoard(page)

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: { getState: () => { addCard: (kind: string, position: { x: number; y: number }) => string } } }
    devWindow.__eido.getState().addCard('title', { x: 0, y: 0 })
  })
  const node = page.locator('.react-flow__node-title')
  await expect(node).toHaveCount(1)
  const titleTextarea = node.locator('textarea.title-card-input')
  await titleTextarea.click()
  await titleTextarea.selectText()
  await page.keyboard.press('Backspace')
  await expect(titleTextarea).toBeFocused()

  await page.mouse.move(1100, 40)
  await realPaste(page, 'Pasted headline')

  await expect(titleTextarea).toHaveValue('Pasted headline')
  await expect(page.locator('.react-flow__node-note')).toHaveCount(0)
  await expect(page.locator('.react-flow__node-title')).toHaveCount(1)
})

test('a live cursor in a Note markdown body still owns the paste, no matter the pointer', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  await resetBoard(page)

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: { getState: () => { addCard: (kind: string, position: { x: number; y: number }) => string } } }
    devWindow.__eido.getState().addCard('note', { x: 0, y: 0 })
  })
  const node = page.locator('.react-flow__node-note')
  await expect(node).toHaveCount(1)
  await node.locator('.note-render').click({ position: { x: 12, y: 12 } })
  const editor = node.locator('.markdown-card-editor-content[contenteditable="true"]')
  await expect(editor).toBeEditable()
  await expect
    .poll(() => node.locator('.markdown-card-editor-transition').getAttribute('data-editor-ready'))
    .toBe('true')

  await page.mouse.move(1100, 40)
  await realPaste(page, 'Pasted body text')

  await expect(editor).toContainText('Pasted body text')
  await expect(page.locator('.react-flow__node-note')).toHaveCount(1)
})

test('a failed local HTML recognition keeps the device path out of Board state', async ({ page }) => {
  await resetBoard(page)
  const localPath = '/Users/example/private/reviews/board.html'

  await page.evaluate((text) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', text)
    window.dispatchEvent(new ClipboardEvent('paste', {
      clipboardData: transfer,
      bubbles: true,
      cancelable: true,
    }))
  }, localPath)

  await expect(page.locator('.react-flow__node-note')).toHaveCount(1)
  const storedText = await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: { getState: () => { cards: Array<{ blocks: Array<{ text: string }> }> } }
    }
    return devWindow.__eido.getState().cards[0]?.blocks[0]?.text
  })
  expect(storedText).toBe('board.html')
  expect(JSON.stringify(await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: { getState: () => unknown } }
    return devWindow.__eido.getState()
  }))).not.toContain(localPath)
})

for (const scenario of [
  {
    name: 'explicit HTTPS URL',
    pastedText: 'https://drybread.studio/',
    pastedUrl: 'https://drybread.studio/',
  },
  {
    name: 'scheme-less domain',
    pastedText: 'www.example.co',
    pastedUrl: 'https://www.example.co',
  },
]) {
  test(`pasting one ${scenario.name} creates a selected Note with an embedded website preview`, async ({ page }) => {
    const { pastedText, pastedUrl } = scenario
    await page.route('**/api/eido/link-preview?*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          preview: {
            url: pastedUrl,
            status: 'ready',
            title: 'Example website',
            description: 'Products, tools, games and experiments.',
            siteName: 'example.co',
            imageDataUrl: 'data:image/png;base64,AAAA',
          },
        }),
      })
    })
    await resetBoard(page)

    await page.mouse.move(460, 300)
    await page.evaluate((url) => {
      const transfer = new DataTransfer()
      transfer.setData('text/plain', url)
      window.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: transfer,
        bubbles: true,
        cancelable: true,
      }))
    }, pastedText)

    const card = page.locator('.react-flow__node-note')
    await expect(card).toHaveCount(1)
    await expect(card).toHaveClass(/selected/)
    await expect(card.getByRole('textbox', { name: 'Note body' })).toContainText(pastedText)
    await expect(card.getByRole('link', { name: /Open Example website/i })).toBeVisible()
    await expect(card.locator('.link-preview-image')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    )

    const stored = await page.evaluate(() => {
      const devWindow = window as unknown as {
        __eido: { getState: () => { cards: Array<{ linkPreview?: unknown; blocks: Array<{ text: string }> }> } }
      }
      return devWindow.__eido.getState().cards[0]
    })
    expect(stored).toMatchObject({
      blocks: [{ text: `[${pastedText}](${pastedUrl})` }],
      linkPreview: {
        url: pastedUrl,
        status: 'ready',
        title: 'Example website',
      },
    })

    // The preview's control rail is revealed by the pointer that is about to
    // use it, like the image tiles' remove key, so the hover comes first.
    await card.locator('.link-preview-card').hover()
    await card.getByRole('button', { name: 'Remove preview' }).click()
    await expect.poll(async () => page.evaluate(() => {
      const devWindow = window as unknown as {
        __eido: { getState: () => { cards: Array<{ linkPreview?: unknown }> } }
      }
      return devWindow.__eido.getState().cards[0]?.linkPreview
    })).toBeUndefined()
    await expect(card.locator('.link-preview-card')).toHaveCount(0)
    const noteWithoutPreview = await page.evaluate(() => {
      const devWindow = window as unknown as {
        __eido: { getState: () => { cards: Array<{ linkPreview?: unknown; blocks: Array<{ text: string }> }> } }
      }
      return devWindow.__eido.getState().cards[0]
    })
    expect(noteWithoutPreview).toMatchObject({ blocks: [{ text: stored.blocks[0]?.text }] })
    expect(noteWithoutPreview).not.toHaveProperty('linkPreview')

    await page.locator('.react-flow__pane').click({ position: { x: 40, y: 40 } })
    await page.keyboard.press('ControlOrMeta+z')
    await expect(card.getByRole('link', { name: /Open Example website/i })).toBeVisible()
  })
}
