import { expect, test, type Page } from '@playwright/test'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{ id: string; position: { x: number; y: number } }>
  }
  setState: (state: unknown) => void
}

const LONG_TEXT = Array.from({ length: 80 }, (_, i) => `line ${i} of a long note body`).join('\n')

async function seedNotes(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate((longText) => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'short-note',
          kind: 'note',
          blocks: [{ id: 'short-note-block', text: 'Short note' }],
          position: { x: 80, y: 80 },
          zIndex: 1,
        },
        {
          id: 'long-note',
          kind: 'note',
          blocks: [{ id: 'long-note-block', text: longText }],
          position: { x: 480, y: 80 },
          size: { width: 280, height: 240 },
          zIndex: 2,
        },
      ],
      connections: [],
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
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 40, y: 120, zoom: 1 })
  }, LONG_TEXT)
}

function readViewportTransform(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    return viewport ? getComputedStyle(viewport).transform : ''
  })
}

async function selectNoteForEditing(page: Page, cardId: string) {
  const node = page.locator(`.react-flow__node-note[data-id="${cardId}"]`)
  await node.locator('.note-render').click()
  await node.locator('.note-render[contenteditable="true"]').waitFor({ state: 'visible' })
  return node
}

async function hoverCenter(page: Page, selector: string) {
  const box = await page.locator(selector).boundingBox()
  if (!box) throw new Error(`No bounding box for ${selector}`)
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
}

test('wheel over a selected note with nothing to scroll pans the canvas', async ({ page }) => {
  await seedNotes(page)
  await selectNoteForEditing(page, 'short-note')

  const before = await readViewportTransform(page)
  await hoverCenter(page, '.react-flow__node-note[data-id="short-note"] .note-body')
  await page.mouse.wheel(0, 120)

  await expect.poll(() => readViewportTransform(page)).not.toBe(before)
})

test('wheel over a selected note with overflow scrolls the note, not the canvas', async ({ page }) => {
  await seedNotes(page)
  await selectNoteForEditing(page, 'long-note')

  const bodySelector = '.react-flow__node-note[data-id="long-note"] .note-body'
  const body = page.locator(bodySelector)
  await expect
    .poll(() => body.evaluate((el) => el.scrollHeight - el.clientHeight))
    .toBeGreaterThan(0)
  await body.evaluate((el) => {
    el.scrollTop = 0
  })
  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBe(0)

  const before = await readViewportTransform(page)
  await hoverCenter(page, bodySelector)
  await page.mouse.wheel(0, 120)

  await expect.poll(() => body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0)
  expect(await readViewportTransform(page)).toBe(before)
})

test('wheel-down at the bottom of a scrolled note hands the gesture back to the canvas', async ({ page }) => {
  await seedNotes(page)
  await selectNoteForEditing(page, 'long-note')

  const bodySelector = '.react-flow__node-note[data-id="long-note"] .note-body'
  const body = page.locator(bodySelector)
  await body.evaluate((el) => {
    el.scrollTop = el.scrollHeight
  })
  await expect
    .poll(() => body.evaluate((el) => el.scrollTop + el.clientHeight >= el.scrollHeight - 1))
    .toBe(true)

  const before = await readViewportTransform(page)
  await hoverCenter(page, bodySelector)
  await page.mouse.wheel(0, 120)

  await expect.poll(() => readViewportTransform(page)).not.toBe(before)
})

test('a rapid wheel gesture that reaches a note edge does not pan the canvas', async ({ page }) => {
  await seedNotes(page)
  await selectNoteForEditing(page, 'long-note')

  const bodySelector = '.react-flow__node-note[data-id="long-note"] .note-body'
  const body = page.locator(bodySelector)
  await body.evaluate((el) => {
    el.scrollTop = 12
  })
  const before = await readViewportTransform(page)
  // Dispatch this one gesture in the browser task: driver round trips can
  // outlast its continuity window on a busy runner and turn it into two
  // separate gestures. The other cases exercise native wheel scrolling.
  await body.evaluate((el) => {
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
    // Native scrolling follows the first listener. Model that movement before
    // its immediately consecutive momentum event reaches the same listener.
    el.scrollTop = 0
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }))
  })

  expect(await readViewportTransform(page)).toBe(before)
})

test('ctrl-wheel (pinch) over a scrollable note zooms the canvas', async ({ page }) => {
  await seedNotes(page)
  await selectNoteForEditing(page, 'long-note')

  const zoomOf = (transform: string) => {
    const match = transform.match(/matrix\(([^,]+),/)
    return match ? Number(match[1]) : 1
  }
  const before = zoomOf(await readViewportTransform(page))

  // Synthetic ctrl-wheel: Playwright's mouse.wheel cannot set ctrlKey, and a
  // trackpad pinch arrives exactly as a ctrl-modified wheel event.
  await page.locator('.react-flow__node-note[data-id="long-note"] .note-body').evaluate((el) => {
    el.dispatchEvent(
      new WheelEvent('wheel', { deltaY: -120, ctrlKey: true, bubbles: true, cancelable: true }),
    )
  })

  await expect.poll(async () => zoomOf(await readViewportTransform(page))).not.toBe(before)
})
