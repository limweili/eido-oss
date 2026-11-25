import { expect, test, type Page } from '@playwright/test'

// Regression tests for #313: below Reading the board is painted on canvas and
// mounts no card nodes at idle. Gesture participants temporarily mount as
// invisible hit-proxies whose real React Flow handles keep connection drags
// interactive without adding a second visual representation.

const LOW_ZOOM = 0.06 // below DETAIL_ZOOM_THRESHOLD (0.08), above minZoom (0.05)

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    connections: Array<{ id: string; from: { cardId: string }; to: { cardId: string } }>
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_SET_GESTURE_PARTICIPANTS__?: (cardIds: readonly string[]) => void
}

async function seedLowZoomBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(
      devWindow.__eido?.getState().hydrated &&
        devWindow.__EIDO_SET_VIEWPORT__ &&
        devWindow.__EIDO_SET_GESTURE_PARTICIPANTS__,
    )
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __eido: EidoDevStore
    }
    // Two far-apart anchor cards plus filler. At zoom 0.06 the anchors sit
    // ~360 screen px apart, so a handle-to-handle drag crosses real distance.
    const cards = [
      {
        id: 'connect-a',
        kind: 'note',
        blocks: [{ id: 'connect-a-block', text: 'from here' }],
        position: { x: 0, y: 0 },
      },
      {
        id: 'connect-b',
        kind: 'note',
        blocks: [{ id: 'connect-b-block', text: 'to here' }],
        position: { x: 6000, y: 0 },
      },
      ...Array.from({ length: 10 }, (_, index) => ({
        id: `filler-${index}`,
        kind: 'note',
        blocks: [{ id: `filler-${index}-block`, text: `filler ${index}` }],
        position: { x: (index % 5) * 1200, y: 2400 + Math.floor(index / 5) * 1600 },
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
  })

  // Board mounts with fitView pending until the first nodes appear, so wait
  // for the board to render before setting the viewport — otherwise the
  // deferred fitView overrides it.
  await page.waitForFunction(() => {
    const nodeCount = document.querySelectorAll('.react-flow__node').length
    const overviewCount = Number(
      document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedCardCount ?? 0,
    )
    return nodeCount + overviewCount > 0
  })
  await page.evaluate((zoom) => {
    const devWindow = window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    // Put connect-a around (300, 400) on screen and zoom out below the detail
    // threshold; connect-b lands ~360 px to the right.
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 300, y: 400, zoom })
  }, LOW_ZOOM)

  // Let the detail aperture settle (viewport settle delay + navigation idle
  // window) so the below-Reading zero-mount policy is stable.
  await page.waitForTimeout(500)
}

async function setGestureParticipants(page: Page, cardIds: readonly string[]) {
  await page.evaluate((ids) => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_GESTURE_PARTICIPANTS__?.(ids)
  }, cardIds)
}

async function representationCounts(page: Page) {
  return page.evaluate(() => ({
    mounted: document.querySelectorAll('.react-flow__node').length,
    overviewRendered: Number(
      document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedCardCount ?? 0,
    ),
    cards: (window as unknown as { __eido: { getState: () => { cards: unknown[] } } }).__eido.getState()
      .cards.length,
  }))
}

// The painted port disc centre for a seeded card: edge midpoint under the
// test viewport (x 300, y 400, zoom 0.06) — the paintedPortGeometry point.
async function paintedPortCentre(page: Page, cardX: number, side: 'left' | 'right') {
  return page.evaluate(
    ({ x, portSide }) => {
      const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
      if (!pane) throw new Error('Missing board pane')
      const zoom = 0.06
      return {
        x: pane.left + 300 + (x + (portSide === 'right' ? 260 : 0)) * zoom,
        y: pane.top + 400 + 90 * zoom,
      }
    },
    { x: cardX, portSide: side },
  )
}

test('dragging handle to handle at low zoom creates a connection through hit-proxies', async ({ page }) => {
  await seedLowZoomBoard(page)

  expect(await representationCounts(page)).toEqual({ mounted: 0, overviewRendered: 12, cards: 12 })

  // C3 (#320): the connect press aims at the painted port disc (the
  // paintedPortGeometry edge midpoint) and the proxies mount through the live
  // proximity lead (source before the press, candidate target mid-drag), not
  // the dev seam. At zoom 0.06 the Map pill paints its discs (#320
  // amendment 9), so moving onto the disc ARMS the source side — the press
  // reaches the proxy's native handle only through that arming; unarmed
  // handles take no pointer events at any zoom.
  const from = await paintedPortCentre(page, 0, 'right')
  const to = await paintedPortCentre(page, 6000, 'left')

  await page.mouse.move(from.x - 60, from.y - 20)
  await page.mouse.move(from.x, from.y)
  await page.locator('.react-flow__node-gestureProxy[data-id="connect-a"]').waitFor({ state: 'attached' })
  await expect
    .poll(() =>
      page.evaluate(() => document.querySelector<HTMLElement>('.board-flow')?.dataset.canvasPortTarget ?? null),
    )
    .toBe('source')
  await page.mouse.down()
  await page.mouse.move(to.x - 36, to.y, { steps: 12 })
  await page.locator('.react-flow__node-gestureProxy[data-id="connect-b"]').waitFor({ state: 'attached' })
  await page.mouse.move(to.x, to.y, { steps: 4 })
  await page.mouse.up()

  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido
          .getState()
          .connections.map((connection) => `${connection.from.cardId}->${connection.to.cardId}`)
      }),
    )
    .toContain('connect-a->connect-b')
})

test('low-zoom hit-proxies stay invisible while the canvas remains the sole visual', async ({ page }) => {
  await seedLowZoomBoard(page)

  const idle = await representationCounts(page)
  expect(idle.mounted).toBe(0)
  expect(idle.mounted + idle.overviewRendered).toBe(idle.cards)

  await setGestureParticipants(page, ['connect-a'])
  const proxy = page.locator('.react-flow__node-gestureProxy[data-id="connect-a"]')
  await proxy.waitFor({ state: 'attached' })

  expect(await representationCounts(page)).toEqual({ mounted: 1, overviewRendered: 12, cards: 12 })
  await expect(page.locator('.card-placeholder')).toHaveCount(0)
  await expect(proxy.locator('.card, .title-card, .card-placeholder')).toHaveCount(0)
  await expect(proxy.locator('.react-flow__handle-left')).toHaveCSS('opacity', '0')
  await expect(proxy.locator('.react-flow__handle-right')).toHaveCSS('opacity', '0')
  await expect(proxy).toHaveText('')
})
