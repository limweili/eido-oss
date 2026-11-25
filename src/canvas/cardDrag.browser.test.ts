import { expect, test, type Page } from '@playwright/test'

// Regression tests for #204: on card-dense boards the
// sticky-detail LOD reused previous-scene card objects while any pointer
// gesture was active, so a dragged or resized card froze at its gesture-start
// geometry until release. Cards must follow the cursor in real time mid-drag
// and resize live mid-gesture.

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{ id: string; position: { x: number; y: number } }>
  }
  setState: (state: unknown) => void
}

async function seedCardDenseBoard(page: Page) {
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
    // More than 540 lightweight notes trigger the card-density ceiling. The
    // gesture target is small and fixed-size so its resize handles stay inside
    // the viewport once the harness moves to store-position geometry.
    const cards = [
      {
        id: 'drag-note',
        kind: 'note',
        blocks: [{ id: 'drag-note-block', text: 'drag me' }],
        position: { x: 80, y: 80 },
        size: { width: 260, height: 160 },
        zIndex: 200,
      },
      ...Array.from({ length: 541 }, (_, index) => ({
        id: `dense-note-${index}`,
        kind: 'note',
        blocks: [{ id: `dense-note-${index}-block`, text: `dense ${index}` }],
        position: { x: 80 + ((index + 1) % 24) * 50, y: 80 + Math.floor((index + 1) / 24) * 40 },
        zIndex: 1 + index,
      })),
    ]

    devWindow.__eido.setState({
      cards,
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
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 40, y: 40, zoom: 1 })
  })

  const node = page.locator('.react-flow__node[data-id="drag-note"]')
  await node.waitFor({ state: 'visible' })
  // Let the detail aperture settle (viewport settle delay + navigation idle
  // window) so the gesture starts from a settled scene, as a user's would.
  await page.waitForTimeout(500)
  return node
}

async function nodeTranslateX(page: Page, id: string) {
  return page.evaluate((nodeId) => {
    const element = document.querySelector<HTMLElement>(`.react-flow__node[data-id="${nodeId}"]`)
    if (!element) throw new Error(`Missing node ${nodeId}`)
    const transform = getComputedStyle(element).transform
    if (!transform || transform === 'none') return 0
    return new DOMMatrixReadOnly(transform).e
  }, id)
}

// The card head's padding is a draggable surface (its buttons are nodrag).
async function headDragPoint(page: Page, id: string) {
  const head = page.locator(`.react-flow__node[data-id="${id}"] .card-head`)
  const box = await head.boundingBox()
  if (!box) throw new Error('Missing card head')
  return { x: box.x + box.width / 2, y: box.y + 3 }
}

// Card-density demotion is canvas-only; E2 reworks this harness to use
// store-position geometry (#315).
test.fixme('a dragged card follows the cursor before the mouse is released', async ({ page }) => {
  await seedCardDenseBoard(page)

  const startX = await nodeTranslateX(page, 'drag-note')
  const from = await headDragPoint(page, 'drag-note')

  // Sample the DOM transform WHILE the cursor is still moving (well inside the
  // navigation idle window): the frozen pre-#204 scene only caught up ~280 ms
  // after movement stopped, so sampling mid-motion is what exposes the freeze.
  const midDragSamples: number[] = []
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(from.x + step * 20, from.y + step * 8)
    await page.waitForTimeout(50)
    midDragSamples.push(await nodeTranslateX(page, 'drag-note'))
  }

  // Mouse is still held down here: the node must already have tracked the
  // cursor most of the way (~200px drag, allow one lagging frame).
  expect(Math.max(...midDragSamples)).toBeGreaterThan(startX + 100)

  await page.mouse.up()
  await expect.poll(() => nodeTranslateX(page, 'drag-note')).toBeGreaterThan(startX + 150)
})

// Same card-dense fixture as above; E2 supplies store-position geometry.
test.fixme('a resized card grows live before the mouse is released', async ({ page }) => {
  const node = await seedCardDenseBoard(page)

  // Select the card so its resize handles mount.
  const point = await headDragPoint(page, 'drag-note')
  await page.mouse.click(point.x, point.y)
  const handle = node.locator('.react-flow__resize-control.bottom.right')
  await handle.waitFor({ state: 'visible' })

  const startBox = await node.boundingBox()
  const handleBox = await handle.boundingBox()
  if (!startBox || !handleBox) throw new Error('Missing node or resize handle box')

  // Same mid-motion sampling as the drag test: the resize must be visible
  // while the handle is still moving, not only after the gesture pauses.
  const midResizeSamples: number[] = []
  await page.mouse.move(handleBox.x + handleBox.width / 2, handleBox.y + handleBox.height / 2)
  await page.mouse.down()
  for (let step = 1; step <= 10; step += 1) {
    await page.mouse.move(handleBox.x + handleBox.width / 2 + step * 15, handleBox.y + handleBox.height / 2)
    await page.waitForTimeout(50)
    midResizeSamples.push((await node.boundingBox())?.width ?? 0)
  }

  // Mouse is still held down here: the node must already be wider.
  expect(Math.max(...midResizeSamples)).toBeGreaterThan(startBox.width + 100)

  await page.mouse.up()
})
