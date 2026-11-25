import { expect, test, type Page } from '@playwright/test'

// Stay below main's Reading↔Overview crossfade so the canvas representation
// and its low-detail resize proxy own the interaction.
const OVERVIEW_ZOOM = 0.25
const MAP_ZOOM = 0.1
const CARD_ID = 'resize-card'
const CARD_POSITION = { x: 400, y: 400 }
const CARD_SIZE = { width: 260, height: 180 }
const viewportAt = (zoom: number) => ({ x: 200, y: 100, zoom })

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{
      id: string
      position?: { x: number; y: number }
      size?: { width: number; height: number }
    }>
  }
  setState: (state: unknown) => void
  subscribe: (listener: () => void) => () => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_FORCE_OVERVIEW_DRAW__?: () => void
}

async function seedCard(page: Page, zoom: number, extraCardCount = 0) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(
    ({ cardId, position, size, extraCardCount }) => {
      const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
      const extraCards = Array.from({ length: extraCardCount }, (_, index) => ({
        id: `background-card-${index}`,
        kind: 'note',
        blocks: [{ id: `background-block-${index}`, text: `Background thought ${index}` }],
        position: { x: 4_000 + (index % 40) * 320, y: 4_000 + Math.floor(index / 40) * 240 },
        size,
        zIndex: 0,
      }))
      devWindow.__eido.setState({
        cards: [
          {
            id: cardId,
            kind: 'note',
            blocks: [{ id: `${cardId}-block`, text: 'Resize me while zoomed out' }],
            position,
            size,
            zIndex: 1,
          },
          ...extraCards,
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
    },
    { cardId: CARD_ID, position: CARD_POSITION, size: CARD_SIZE, extraCardCount },
  )

  // Pin twice so React Flow's deferred initial fit cannot replace the test
  // viewport after the first render.
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate((viewport) => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_SET_VIEWPORT__?.(viewport)
    }, viewportAt(zoom))
    await page.waitForTimeout(350)
  }
  await page.evaluate(() => (window as unknown as DevWindow).__EIDO_FORCE_OVERVIEW_DRAW__?.())
}

async function cardCentre(page: Page, zoom: number) {
  return page.evaluate(
    ({ position, size, viewport }) => {
      const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
      if (!pane) throw new Error('Missing board pane')
      return {
        x: pane.left + viewport.x + (position.x + size.width / 2) * viewport.zoom,
        y: pane.top + viewport.y + (position.y + size.height / 2) * viewport.zoom,
      }
    },
    { position: CARD_POSITION, size: CARD_SIZE, viewport: viewportAt(zoom) },
  )
}

function storedSize(page: Page) {
  return page.evaluate((cardId) => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().cards.find((card) => card.id === cardId)?.size ?? null
  }, CARD_ID)
}

function paintedAlphaNearNewBottomRight(page: Page, size: { width: number; height: number }, zoom: number) {
  return page.evaluate(
    ({ position, viewport, nextSize }) => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
      const context = canvas?.getContext('2d')
      if (!canvas || !context) throw new Error('Missing overview canvas')
      const rect = canvas.getBoundingClientRect()
      const ratioX = canvas.width / rect.width
      const ratioY = canvas.height / rect.height
      const x = viewport.x + (position.x + nextSize.width) * viewport.zoom - 12
      const y = viewport.y + (position.y + nextSize.height) * viewport.zoom - 12
      const data = context.getImageData(
        Math.round(x * ratioX) - 1,
        Math.round(y * ratioY) - 1,
        3,
        3,
      ).data
      let alpha = 0
      for (let index = 3; index < data.length; index += 4) alpha = Math.max(alpha, data[index])
      return alpha
    },
    { position: CARD_POSITION, viewport: viewportAt(zoom), nextSize: size },
  )
}

function resizeHandleCentre(handle: ReturnType<Page['locator']>) {
  return handle.boundingBox().then((box) => {
    if (!box) throw new Error('Missing resize handle box')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  })
}

function expectedBottomRight(page: Page, size: { width: number; height: number }, zoom: number) {
  return page.evaluate(
    ({ position, viewport, nextSize }) => {
      const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
      if (!pane) throw new Error('Missing board pane')
      return {
        x: pane.left + viewport.x + (position.x + nextSize.width) * viewport.zoom,
        y: pane.top + viewport.y + (position.y + nextSize.height) * viewport.zoom,
      }
    },
    { position: CARD_POSITION, viewport: viewportAt(zoom), nextSize: size },
  )
}

async function recordHeldCornerLag(page: Page) {
  await page.evaluate(() => {
    const samples: number[] = []
    const store = (window as unknown as { __eido: EidoDevStore }).__eido
    let storeMutations = 0
    const unsubscribe = store.subscribe(() => {
      storeMutations += 1
    })
    let latestPointer: { x: number; y: number; buttons: number } | null = null
    let frame = 0
    const onPointerMove = (event: MouseEvent) => {
      latestPointer = { x: event.clientX, y: event.clientY, buttons: event.buttons }
    }
    const sample = () => {
      if (latestPointer?.buttons === 1) {
        const handle = document.querySelector<HTMLElement>('.react-flow__resize-control.bottom.right')
        const box = handle?.getBoundingClientRect()
        if (box) {
          samples.push(
            Math.hypot(box.left + box.width / 2 - latestPointer.x, box.top + box.height / 2 - latestPointer.y),
          )
        }
      }
      frame = requestAnimationFrame(sample)
    }
    window.addEventListener('mousemove', onPointerMove, { capture: true })
    window.addEventListener('mouseup', onPointerMove, { capture: true })
    frame = requestAnimationFrame(sample)
    ;(window as unknown as {
      __EIDO_STOP_RESIZE_LAG_RECORDING__: () => {
        samples: number[]
        storeMutations: number
      }
    }).__EIDO_STOP_RESIZE_LAG_RECORDING__ = () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('mousemove', onPointerMove, { capture: true })
      window.removeEventListener('mouseup', onPointerMove, { capture: true })
      unsubscribe()
      return { samples, storeMutations }
    }
  })
}

async function stopHeldCornerLagRecording(page: Page) {
  return page.evaluate(() =>
    (window as unknown as {
      __EIDO_STOP_RESIZE_LAG_RECORDING__: () => {
        samples: number[]
        storeMutations: number
      }
    })
      .__EIDO_STOP_RESIZE_LAG_RECORDING__(),
  )
}

for (const band of [
  { name: 'Overview', zoom: OVERVIEW_ZOOM },
  { name: 'Map', zoom: MAP_ZOOM },
]) {
  test(`a selected ${band.name} card can be resized by dragging its corner`, async ({ page }) => {
    await seedCard(page, band.zoom)
    const centre = await cardCentre(page, band.zoom)

    // Approaching the painted card mounts its invisible interaction proxy.
    await page.mouse.move(centre.x - 80, centre.y - 30)
    await page.mouse.move(centre.x, centre.y)
    const proxy = page.locator(`.react-flow__node-gestureProxy[data-id="${CARD_ID}"]`)
    await proxy.waitFor({ state: 'attached', timeout: 10_000 })

    await page.mouse.click(centre.x, centre.y)
    for (const corner of ['top.left', 'top.right', 'bottom.left', 'bottom.right']) {
      await expect(proxy.locator(`.react-flow__resize-control.${corner}`)).toBeVisible()
    }
    const handle = proxy.locator('.react-flow__resize-control.bottom.right')
    await handle.waitFor({ state: 'visible', timeout: 5_000 })

    const handleBox = await handle.boundingBox()
    if (!handleBox) throw new Error('Missing resize handle box')
    const start = await storedSize(page)
    expect(start).toEqual(CARD_SIZE)

    const handleCentre = {
      x: handleBox.x + handleBox.width / 2,
      y: handleBox.y + handleBox.height / 2,
    }
    await page.mouse.move(handleCentre.x, handleCentre.y)
    await page.mouse.down()
    await page.mouse.move(handleCentre.x + 80, handleCentre.y + 48, { steps: 8 })
    const liveSize = await storedSize(page)
    expect(liveSize!.width).toBeGreaterThan(CARD_SIZE.width + 100)
    expect(liveSize!.height).toBeGreaterThan(CARD_SIZE.height + 60)
    await expect
      .poll(() => paintedAlphaNearNewBottomRight(page, liveSize!, band.zoom), { timeout: 1_000 })
      .toBeGreaterThan(0)

    await page.mouse.up()
    const resized = (await storedSize(page))!
    const expectedCorner = await expectedBottomRight(page, resized, band.zoom)
    const actualCorner = await resizeHandleCentre(handle)
    expect(actualCorner.x).toBeCloseTo(expectedCorner.x, 0)
    expect(actualCorner.y).toBeCloseTo(expectedCorner.y, 0)

    // The canvas card remains the visual representation; only its small
    // interaction proxy and corner controls are mounted.
    await expect(proxy.locator('.card, .title-card')).toHaveCount(0)
    expect(
      await page.evaluate((cardId) => window.__EIDO_OVERVIEW_CARD_IDS__?.has(cardId) ?? false, CARD_ID),
    ).toBe(true)
  })
}

test('the held low-detail resize corner remains anchored to the pointer', async ({ page }) => {
  await seedCard(page, OVERVIEW_ZOOM, 800)
  const centre = await cardCentre(page, OVERVIEW_ZOOM)
  await page.mouse.move(centre.x - 80, centre.y - 30)
  await page.mouse.move(centre.x, centre.y)
  const proxy = page.locator(`.react-flow__node-gestureProxy[data-id="${CARD_ID}"]`)
  await proxy.waitFor({ state: 'attached', timeout: 10_000 })
  await page.mouse.click(centre.x, centre.y)

  const handle = proxy.locator('.react-flow__resize-control.bottom.right')
  await handle.waitFor({ state: 'visible', timeout: 5_000 })
  const start = await resizeHandleCentre(handle)
  await page.mouse.move(start.x, start.y)
  await recordHeldCornerLag(page)
  await page.mouse.down()
  await page.evaluate((origin) => {
    for (let step = 1; step <= 30; step += 1) {
      window.dispatchEvent(
        new MouseEvent('mousemove', {
          bubbles: true,
          cancelable: true,
          buttons: 1,
          clientX: origin.x + step * 3,
          clientY: origin.y + step * 2,
          view: window,
        }),
      )
    }
  }, start)
  await page.waitForTimeout(50)
  await page.mouse.move(start.x + 90, start.y + 60)
  await page.mouse.up()

  const { samples, storeMutations } = await stopHeldCornerLagRecording(page)
  expect(samples.length).toBeGreaterThan(2)
  expect(Math.max(...samples)).toBeLessThanOrEqual(3)
  // These app-derived bounds catch lag and repeated writes. A maximum RAF
  // interval also counts unrelated pauses on shared hosted runners.
  expect(storeMutations).toBeLessThanOrEqual(samples.length + 1)
})

test('the top-left low-detail resize corner stays under the pointer', async ({ page }) => {
  await seedCard(page, OVERVIEW_ZOOM)
  const centre = await cardCentre(page, OVERVIEW_ZOOM)
  await page.mouse.move(centre.x - 80, centre.y - 30)
  await page.mouse.move(centre.x, centre.y)
  const proxy = page.locator(`.react-flow__node-gestureProxy[data-id="${CARD_ID}"]`)
  await proxy.waitFor({ state: 'attached', timeout: 10_000 })
  await page.mouse.click(centre.x, centre.y)

  const handle = proxy.locator('.react-flow__resize-control.top.left')
  await handle.waitFor({ state: 'visible', timeout: 5_000 })
  const start = await resizeHandleCentre(handle)
  const target = { x: start.x - 60, y: start.y - 40 }
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(target.x, target.y, { steps: 8 })
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())))

  const heldCorner = await resizeHandleCentre(handle)
  expect(heldCorner.x).toBeCloseTo(target.x, 0)
  expect(heldCorner.y).toBeCloseTo(target.y, 0)
  await page.mouse.up()

  const card = await page.evaluate((cardId) => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().cards.find((candidate) => candidate.id === cardId) ?? null
  }, CARD_ID)
  expect(card?.position?.x).toBeLessThan(CARD_POSITION.x)
  expect(card?.position?.y).toBeLessThan(CARD_POSITION.y)
  expect(card?.size?.width).toBeGreaterThan(CARD_SIZE.width)
  expect(card?.size?.height).toBeGreaterThan(CARD_SIZE.height)
})

test('low-detail resize has one canvas-painted set of solid corner grabbers', async ({ page }) => {
  await seedCard(page, OVERVIEW_ZOOM)
  const centre = await cardCentre(page, OVERVIEW_ZOOM)
  await page.mouse.move(centre.x - 80, centre.y - 30)
  await page.mouse.move(centre.x, centre.y)
  const proxy = page.locator(`.react-flow__node-gestureProxy[data-id="${CARD_ID}"]`)
  await proxy.waitFor({ state: 'attached', timeout: 10_000 })
  await page.mouse.click(centre.x, centre.y)

  const handles = proxy.locator('.react-flow__resize-control.handle')
  await expect(handles).toHaveCount(4)
  const opacities = await handles.evaluateAll((elements) =>
    elements.map((element) => getComputedStyle(element).opacity),
  )
  expect(opacities).toEqual(['0', '0', '0', '0'])
  await expect(page.locator('canvas.board-overview-layer')).toHaveAttribute('data-resize-anchor-count', '4')
})

test('a low-detail card stays selected after resize until the user clicks outside', async ({ page }) => {
  await seedCard(page, OVERVIEW_ZOOM)
  const centre = await cardCentre(page, OVERVIEW_ZOOM)
  await page.mouse.move(centre.x - 80, centre.y - 30)
  await page.mouse.move(centre.x, centre.y)
  const proxy = page.locator(`.react-flow__node-gestureProxy[data-id="${CARD_ID}"]`)
  await proxy.waitFor({ state: 'attached', timeout: 10_000 })
  await page.mouse.click(centre.x, centre.y)

  const canvas = page.locator('canvas.board-overview-layer')
  await expect(canvas).toHaveAttribute('data-resize-anchor-count', '4')
  const handle = proxy.locator('.react-flow__resize-control.bottom.right')
  const start = await resizeHandleCentre(handle)
  await page.mouse.move(start.x, start.y)
  await page.mouse.down()
  await page.mouse.move(start.x + 40, start.y + 30, { steps: 4 })
  await page.mouse.up()

  // Leaving the resized corner is not a deselection gesture. The selected
  // card and its resize affordance remain until an actual outside click.
  await page.mouse.move(40, 280)
  await page.waitForTimeout(400)
  await expect(canvas).toHaveAttribute('data-resize-anchor-count', '4')
  await page.mouse.click(40, 280)
  await expect(canvas).toHaveAttribute('data-resize-anchor-count', '0')
})
