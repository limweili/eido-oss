import { expect, test, type Page } from '@playwright/test'

// C3 (#320): two-proxy connect + isValidConnection. The E3 any-zoom gate
// below was recorded red on main behaviour (`test.fixme`) and is greened by
// this slice: connect-start freezes the source proxy, the candidate target
// lead-mounts on pointer-move so React Flow's native snap/preview/validate
// runs unchanged, and connect writes ONE store connection. Port-vs-body
// resolves against the painted disc (`paintedPortGeometry`) at EVERY
// below-Reading zoom (#320 amendment 9: Map pills paint discs too), and the
// proxy's oversized DOM handles are press-gated to the armed side — an
// unarmed press can never start a connect through the invisible handle box;
// it falls through to the body and drags. Proxy nodes are INVISIBLE: every
// wait is `state: 'attached'`, never `visible`.

const MAP_ZOOM = 0.06
const READING_ZOOM = 0.5
const CARD_WIDTH = 260
const CARD_HEIGHT = 180
const CONNECTABLE_CARD_KINDS = ['note', 'askAi', 'result', 'mod', 'group', 'conversation'] as const
type ConnectableCardKind = (typeof CONNECTABLE_CARD_KINDS)[number]

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    boardChangeSeq: number
    cards: Array<{ id: string; position: { x: number; y: number } }>
    connections: Array<{ from: { cardId: string }; to: { cardId: string } }>
  }
  setState: (state: unknown) => void
  subscribe: (listener: () => void) => () => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_FORCE_OVERVIEW_DRAW__?: () => void
  __EIDO_OVERVIEW_CARD_IDS__?: Set<string>
  __EIDO_PERF__?: {
    resetBoardScenePerfCounters: () => void
    boardScenePerfCounters: () => {
      sceneDerivations: number
      cardMetricDerivations: number
      cardMetricVisits: number
    }
  }
  __EIDO_STORE_NOTIFY_COUNT__?: number
  __EIDO_MOUNT_PLAN_DERIVATIONS__?: number
}

// Board-space seeds. On the 1280×800 pane at Map zoom the source sits near
// (68, 155) on screen and both targets far from the viewport centre.
const SOURCE = { x: 1_000, y: 2_500 }
const TARGET = { x: 19_000, y: 9_500 }
const TARGET_B = { x: 19_000, y: 6_500 }

async function seedMapBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(
      devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__ && devWindow.__EIDO_PERF__,
    )
  })

  await page.evaluate(
    ({ source, target, targetB, cardWidth, cardHeight }) => {
      const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
      const note = (id: string, x: number, y: number) => ({
        id,
        kind: 'note',
        blocks: [{ id: `${id}-block`, text: id }],
        position: { x, y },
        // This connection test reasons about a fixed 260×180 port midpoint.
        // Pin that footprint explicitly so a Reading measurement from the
        // initial fitView cannot replace it with the note's auto-height.
        size: { width: cardWidth, height: cardHeight },
        zIndex: 1,
      })

      devWindow.__eido.setState({
        cards: [
          note('map-source', source.x, source.y),
          note('map-target', target.x, target.y),
          note('map-target-b', targetB.x, targetB.y),
          ...Array.from({ length: 50 }, (_, index) =>
            note(
              `centre-filler-${index}`,
              7_000 + (index % 10) * 700,
              5_000 + Math.floor(index / 10) * 800,
            ),
          ),
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
    },
    { source: SOURCE, target: TARGET, targetB: TARGET_B, cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT },
  )

  // Pin the viewport twice around a settle window so the deferred fitView
  // cannot override it. Pin before waiting for paint: a previous test's saved
  // viewport can leave this far-away fixture completely outside the window.
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate((zoom) => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom })
    }, MAP_ZOOM)
    await page.waitForTimeout(350)
  }
  await page.waitForFunction(() => {
    window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    return Number(layer?.dataset.renderedCardCount ?? 0) > 0
  })
}

async function panePoint(page: Page, screen: { x: number; y: number }) {
  return page.evaluate((point) => {
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
    if (!pane) throw new Error('Missing board pane')
    return { x: pane.left + point.x, y: pane.top + point.y }
  }, screen)
}

async function replaceBoardCards(page: Page, cards: readonly Record<string, unknown>[]) {
  await page.evaluate((nextCards) => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: nextCards,
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
  }, cards)
}

// The painted port disc centre (paintedPortGeometry: edge midpoints) — the
// ONLY press point that arms a connect; everything else on the card is body.
async function paintedPortCentre(
  page: Page,
  position: { x: number; y: number },
  side: 'left' | 'right',
  zoom = MAP_ZOOM,
) {
  return panePoint(page, {
    x: (position.x + (side === 'right' ? CARD_WIDTH : 0)) * zoom,
    y: (position.y + CARD_HEIGHT / 2) * zoom,
  })
}

function proxyNode(page: Page, cardId: string) {
  return page.locator(`.react-flow__node-gestureProxy[data-id="${cardId}"]`)
}

async function armedPort(page: Page) {
  return page.evaluate(() => document.querySelector<HTMLElement>('.board-flow')?.dataset.canvasPortTarget ?? null)
}

async function connectionPairs(page: Page) {
  return page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido
      .getState()
      .connections.map((connection) => `${connection.from.cardId}->${connection.to.cardId}`)
  })
}

async function seedReadingPair(page: Page, targetKind: ConnectableCardKind) {
  const readingCard = (id: string, cardKind: ConnectableCardKind, x: number) => ({
    id,
    kind: cardKind,
    title: cardKind,
    blocks: [{ id: `${id}-block`, text: `${cardKind} surface` }],
    position: { x, y: 300 },
    size: { width: CARD_WIDTH, height: CARD_HEIGHT },
    zIndex: cardKind === 'group' ? 0 : 1,
    ...(cardKind === 'conversation'
      ? { conversationStyle: 'collaborate', conversationTurns: 1 }
      : {}),
    ...(cardKind === 'mod'
      ? {
          modV2: {
            kind: 'switch',
            title: 'Switches',
            accent: '#1b7550',
            treatOverride: null,
            state: {
              items: [
                {
                  id: 'reading-target-switch',
                  label: 'Cite sources',
                  on: true,
                  frame: 'Cite sources.',
                },
              ],
            },
          },
        }
      : {}),
  })
  await replaceBoardCards(page, [
    readingCard('reading-source', 'note', 100),
    readingCard('reading-target', targetKind, 700),
  ])

  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate((zoom) => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 80, zoom })
    }, READING_ZOOM)
    await page.waitForTimeout(200)
  }
  await page.locator('.react-flow__node[data-id="reading-source"]').waitFor({ state: 'visible' })
  await page.locator('.react-flow__node[data-id="reading-target"]').waitFor({ state: 'visible' })
}

async function connectReadingPairOntoCardSurface(page: Page) {
  const sourceHandle = page.locator(
    '.react-flow__node[data-id="reading-source"] .react-flow__handle-right',
  )
  const sourceBox = await sourceHandle.boundingBox()
  if (!sourceBox) throw new Error('Missing Reading source connector')
  const from = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y, { steps: 2 })

  const targetSurface = page.locator('.react-flow__node[data-id="reading-target"] .card')
  const targetBox = await targetSurface.boundingBox()
  if (!targetBox) throw new Error('Missing Reading target Card surface')
  const dropPoint = {
    x: targetBox.x + targetBox.width * 0.72,
    y: targetBox.y + targetBox.height * 0.68,
  }
  await page.mouse.move(dropPoint.x, dropPoint.y, { steps: 14 })
  await expect(
    page.locator('.react-flow__node[data-id="reading-target"]'),
  ).toHaveAttribute('data-connection-drop-target', 'target')
  await page.mouse.up()
  await expect(
    page.locator('.react-flow__node[data-id="reading-target"]'),
  ).not.toHaveAttribute('data-connection-drop-target')
}

async function connectorAppearance(page: Page, cardId: string, side: 'left' | 'right') {
  return page
    .locator(`.react-flow__node[data-id="${cardId}"] .react-flow__handle-${side}`)
    .evaluate((element) => {
      const style = getComputedStyle(element)
      return {
        backgroundColor: style.backgroundColor,
        borderColor: style.borderColor,
        boxShadow: style.boxShadow,
      }
    })
}

async function boardChangeSeq(page: Page) {
  return page.evaluate(() => (window as unknown as { __eido: EidoDevStore }).__eido.getState().boardChangeSeq)
}

async function sourcePosition(page: Page) {
  return page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().cards.find((card) => card.id === 'map-source')!.position
  })
}

// Starts a connect gesture on the source card's port at Map zoom: move to
// the painted disc (lead-mounts the proxy and ARMS the source side — Map
// pills paint discs, amendment 9), press the armed disc, and take the first
// step that makes React Flow start the connection. The press reaches the
// native handle only because the resolver armed it: unarmed handles take no
// pointer events at any zoom.
async function pressSourcePort(page: Page) {
  const from = await paintedPortCentre(page, SOURCE, 'right')
  await page.mouse.move(from.x - 60, from.y - 20)
  await page.mouse.move(from.x, from.y)
  await proxyNode(page, 'map-source').waitFor({ state: 'attached', timeout: 10_000 })
  await page
    .locator('.react-flow__node-gestureProxy[data-id="map-source"] .react-flow__handle-right')
    .waitFor({ state: 'attached', timeout: 10_000 })
  await expect.poll(() => armedPort(page)).toBe('source')
  await page.mouse.down()
  await page.mouse.move(from.x + 6, from.y, { steps: 2 })
  return from
}

// Approaches a target card mid-drag so its proxy lead-mounts (handles exist
// BEFORE the pointer reaches the port), then lands on the given port disc.
async function dragOntoPort(page: Page, cardId: string, position: { x: number; y: number }, side: 'left' | 'right') {
  const port = await paintedPortCentre(page, position, side)
  const approach = { x: port.x + (side === 'left' ? -36 : 36), y: port.y }
  await page.mouse.move(approach.x, approach.y, { steps: 12 })
  await proxyNode(page, cardId).waitFor({ state: 'attached', timeout: 10_000 })
  await page.mouse.move(port.x, port.y, { steps: 4 })
  return port
}

test('connect onto the full card body at map zoom far from centre', async ({ page }) => {
  await seedMapBoard(page)

  await pressSourcePort(page)
  const targetBody = await panePoint(page, {
    x: (TARGET.x + CARD_WIDTH * 0.72) * MAP_ZOOM,
    y: (TARGET.y + CARD_HEIGHT * 0.28) * MAP_ZOOM,
  })
  await page.mouse.move(targetBody.x, targetBody.y, { steps: 16 })
  await proxyNode(page, 'map-target').waitFor({ state: 'attached', timeout: 10_000 })
  await page.mouse.up()

  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido
          .getState()
          .connections.filter(
            (connection) =>
              connection.from.cardId === 'map-source' && connection.to.cardId === 'map-target',
          ).length
      }),
    )
    .toBe(1)
  // Exactly one — the gesture translated to a single store action.
  expect(await connectionPairs(page)).toEqual(['map-source->map-target'])
})

test('connect onto the full card body in Overview', async ({ page }) => {
  await seedMapBoard(page)
  const overviewZoom = 0.25
  const source = { x: 1_000, y: 1_100 }
  const target = { x: 3_000, y: 1_100 }
  const note = (id: string, position: { x: number; y: number }) => ({
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: id }],
    position,
    size: { width: CARD_WIDTH, height: CARD_HEIGHT },
    zIndex: 1,
  })
  await replaceBoardCards(page, [
    note('overview-source', source),
    note('overview-target', target),
  ])
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate((zoom) => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom })
    }, overviewZoom)
    await page.waitForTimeout(250)
  }
  await page.evaluate(() => (window as unknown as DevWindow).__EIDO_FORCE_OVERVIEW_DRAW__?.())

  const from = await paintedPortCentre(page, source, 'right', overviewZoom)
  await page.mouse.move(from.x - 60, from.y - 20)
  await page.mouse.move(from.x, from.y)
  await proxyNode(page, 'overview-source').waitFor({ state: 'attached' })
  await expect.poll(() => armedPort(page)).toBe('source')
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y, { steps: 2 })

  const targetBody = await panePoint(page, {
    x: (target.x + CARD_WIDTH * 0.74) * overviewZoom,
    y: (target.y + CARD_HEIGHT * 0.3) * overviewZoom,
  })
  await page.mouse.move(targetBody.x, targetBody.y, { steps: 16 })
  await proxyNode(page, 'overview-target').waitFor({ state: 'attached' })
  await page.mouse.up()

  await expect.poll(() => connectionPairs(page)).toEqual(['overview-source->overview-target'])
})

test('full-surface drop connects every connectable rich Card kind in Reading', async ({ page }) => {
  await seedMapBoard(page)

  for (const targetKind of CONNECTABLE_CARD_KINDS) {
    await test.step(targetKind, async () => {
      await seedReadingPair(page, targetKind)
      await connectReadingPairOntoCardSurface(page)
      await expect.poll(() => connectionPairs(page)).toEqual([
        'reading-source->reading-target',
      ])
    })
  }
})

test('dragging over a Card body lights the accepting input connector', async ({ page }) => {
  await seedMapBoard(page)
  await seedReadingPair(page, 'note')

  const targetInput = page.locator(
    '.react-flow__node[data-id="reading-target"] .react-flow__handle-left',
  )
  const restingAppearance = await connectorAppearance(page, 'reading-target', 'left')
  await targetInput.hover()
  await expect.poll(() => connectorAppearance(page, 'reading-target', 'left')).not.toEqual(
    restingAppearance,
  )
  await page.waitForTimeout(200)
  const acceptedAppearance = await connectorAppearance(page, 'reading-target', 'left')

  const sourceOutput = page.locator(
    '.react-flow__node[data-id="reading-source"] .react-flow__handle-right',
  )
  const sourceBox = await sourceOutput.boundingBox()
  if (!sourceBox) throw new Error('Missing Reading source connector')
  const from = { x: sourceBox.x + sourceBox.width / 2, y: sourceBox.y + sourceBox.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y, { steps: 2 })

  const targetSurface = page.locator('.react-flow__node[data-id="reading-target"] .card')
  const targetBox = await targetSurface.boundingBox()
  if (!targetBox) throw new Error('Missing Reading target Card surface')
  await page.mouse.move(
    targetBox.x + targetBox.width * 0.72,
    targetBox.y + targetBox.height * 0.68,
    { steps: 14 },
  )

  await expect.poll(() => connectorAppearance(page, 'reading-target', 'left')).toEqual(
    acceptedAppearance,
  )
  await page.mouse.up()
  await expect.poll(() => connectionPairs(page)).toEqual(['reading-source->reading-target'])
})

test('connector release does not pass through painted controls to a buried Card', async ({ page }) => {
  await seedMapBoard(page)
  await seedReadingPair(page, 'note')

  const target = page.locator('.react-flow__node[data-id="reading-target"] .card')
  const targetBox = await target.boundingBox()
  if (!targetBox) throw new Error('Missing Reading target Card')
  const release = {
    x: targetBox.x + targetBox.width * 0.7,
    y: targetBox.y + targetBox.height * 0.65,
  }
  await page.evaluate(({ x, y }) => {
    const blocker = document.createElement('button')
    blocker.type = 'button'
    blocker.dataset.testReleaseBlocker = 'true'
    blocker.textContent = 'Blocking control'
    Object.assign(blocker.style, {
      position: 'fixed', left: `${x - 30}px`, top: `${y - 20}px`,
      width: '60px', height: '40px', zIndex: '2147483647',
    })
    document.body.append(blocker)
  }, release)

  const sourceHandle = page.locator(
    '.react-flow__node[data-id="reading-source"] .react-flow__handle-right',
  )
  const sourceBox = await sourceHandle.boundingBox()
  if (!sourceBox) throw new Error('Missing Reading source connector')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(sourceBox.x + sourceBox.width / 2 + 8, sourceBox.y + sourceBox.height / 2)
  await page.mouse.move(release.x, release.y, { steps: 12 })
  await expect(
    page.locator('.react-flow__node[data-id="reading-target"]'),
  ).not.toHaveAttribute('data-connection-drop-target')
  await page.mouse.up()

  await page.waitForTimeout(200)
  expect(await connectionPairs(page)).toEqual([])
  await page.locator('[data-test-release-blocker]').evaluate((element) => element.remove())
})

test('an incompatible Handle halo does not suppress the adjacent Card body drop', async ({ page }) => {
  await seedMapBoard(page)
  await seedReadingPair(page, 'note')

  const sourceHandle = page.locator(
    '.react-flow__node[data-id="reading-source"] .react-flow__handle-right',
  )
  const targetSourceHandle = page.locator(
    '.react-flow__node[data-id="reading-target"] .react-flow__handle-right',
  )
  const [sourceBox, targetHandleBox] = await Promise.all([
    sourceHandle.boundingBox(),
    targetSourceHandle.boundingBox(),
  ])
  if (!sourceBox || !targetHandleBox) throw new Error('Missing Reading connectors')
  const from = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  }
  const haloOnlyBodyPoint = {
    x: targetHandleBox.x + targetHandleBox.width / 2 - 10,
    y: targetHandleBox.y + targetHandleBox.height / 2,
  }
  expect(haloOnlyBodyPoint.x).toBeLessThan(targetHandleBox.x)

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y, { steps: 2 })
  await page.mouse.move(haloOnlyBodyPoint.x, haloOnlyBodyPoint.y, { steps: 14 })
  await page.mouse.up()

  await expect.poll(() => connectionPairs(page)).toEqual([
    'reading-source->reading-target',
  ])
})

test('a buried Handle cannot override the painted surface of an overlapping Card', async ({ page }) => {
  await seedMapBoard(page)
  const note = (id: string, x: number, zIndex: number) => ({
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: id }],
    position: { x, y: 300 },
    size: { width: CARD_WIDTH, height: CARD_HEIGHT },
    zIndex,
  })
  await replaceBoardCards(page, [
    note('overlap-source', 100, 1),
    note('overlap-buried', 700, 1),
    // Its body covers the buried Card's painted right Handle, while its own
    // right Handle is 10 screen pixels farther right at Reading zoom.
    note('overlap-painted', 720, 2),
  ])
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate((zoom) => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_SET_VIEWPORT__?.({ x: 120, y: 80, zoom })
    }, READING_ZOOM)
    await page.waitForTimeout(200)
  }

  const sourceHandle = page.locator(
    '.react-flow__node[data-id="overlap-source"] .react-flow__handle-right',
  )
  const buriedHandle = page.locator(
    '.react-flow__node[data-id="overlap-buried"] .react-flow__handle-right',
  )
  const [sourceBox, buriedBox] = await Promise.all([
    sourceHandle.boundingBox(),
    buriedHandle.boundingBox(),
  ])
  if (!sourceBox || !buriedBox) throw new Error('Missing overlapping Reading connectors')
  const from = {
    x: sourceBox.x + sourceBox.width / 2,
    y: sourceBox.y + sourceBox.height / 2,
  }
  const release = {
    x: buriedBox.x + buriedBox.width / 2,
    y: buriedBox.y + buriedBox.height / 2,
  }
  await expect.poll(() => page.evaluate(({ x, y }) => {
    for (const element of document.elementsFromPoint(x, y)) {
      const node = element.closest<HTMLElement>('.react-flow__node[data-id]')
      if (node) return node.dataset.id
    }
    return null
  }, release)).toBe('overlap-painted')

  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 8, from.y, { steps: 2 })
  await page.mouse.move(release.x, release.y, { steps: 14 })
  await page.mouse.up()

  await expect.poll(() => connectionPairs(page)).toEqual([
    'overlap-source->overlap-painted',
  ])
})

test('source→source drag creates no connection', async ({ page }) => {
  await seedMapBoard(page)
  const seqBefore = await boardChangeSeq(page)

  await pressSourcePort(page)
  await dragOntoPort(page, 'map-target', TARGET, 'right')
  await page.mouse.up()

  await page.waitForTimeout(300)
  expect(await connectionPairs(page)).toEqual([])
  expect(await boardChangeSeq(page)).toBe(seqBefore)
})

test('port-vs-body in the painted zone: only the disc press connects; the edge outside it drags', async ({
  page,
}) => {
  await seedMapBoard(page)

  // Reframe onto the source at Overview zoom: discs are painted, the zone is
  // active, and the disc (paintedPortGeometry, radius 4px here) — not the
  // proxy's oversized DOM handle — is the press affordance. No second
  // constant: the resolver and the painter share the one geometry function.
  // Stay below the Reading↔Overview crossfade introduced on main: while
  // Reading has positive opacity, mounted DOM cards intentionally own ports.
  const OVERVIEW_ZOOM = 0.25
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate(
      ({ zoom, source }) => {
        const devWindow = window as unknown as DevWindow
        devWindow.__EIDO_SET_VIEWPORT__?.({ x: 200 - source.x * zoom, y: 300 - source.y * zoom, zoom })
      },
      { zoom: OVERVIEW_ZOOM, source: SOURCE },
    )
    await page.waitForTimeout(350)
  }
  await page.waitForFunction(
    () => document.querySelector<HTMLElement>('.board-flow')?.dataset.canvasPortZone === 'painted',
  )

  // The fixed 260×180 card keeps an exact, deterministic port midpoint.
  const disc = await panePoint(page, { x: 200 + CARD_WIDTH * OVERVIEW_ZOOM, y: 300 + (CARD_HEIGHT / 2) * OVERVIEW_ZOOM })

  // (i) On the right edge 12px above the disc centre: inside the proxy's
  // oversized DOM handle box, OUTSIDE the painted disc — body: drag.
  const onEdgeOffDisc = { x: disc.x - 2, y: disc.y - 12 }
  await page.mouse.move(onEdgeOffDisc.x - 60, onEdgeOffDisc.y - 30)
  await page.mouse.move(onEdgeOffDisc.x, onEdgeOffDisc.y)
  await proxyNode(page, 'map-source').waitFor({ state: 'attached', timeout: 10_000 })
  expect(await armedPort(page)).toBe(null)

  const positionBefore = await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().cards.find((card) => card.id === 'map-source')!.position
  })

  await page.mouse.down()
  await page.mouse.move(onEdgeOffDisc.x + 40, onEdgeOffDisc.y + 20, { steps: 8 })
  await page.mouse.up()

  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido.getState().cards.find((card) => card.id === 'map-source')!.position
      }),
    )
    .not.toEqual(positionBefore)
  expect(await connectionPairs(page)).toEqual([])

  // (ii) On the disc centre: the resolver arms the source side and the press
  // starts a CONNECT (React Flow's native preview line), not a drag. The
  // card the drag started from does not move.
  const positionAfterDrag = await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().cards.find((card) => card.id === 'map-source')!.position
  })
  // Re-centre the viewport on the card's NEW position so the disc is where
  // we compute it.
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate(
      ({ zoom, position }) => {
        const devWindow = window as unknown as DevWindow
        devWindow.__EIDO_SET_VIEWPORT__?.({ x: 200 - position.x * zoom, y: 300 - position.y * zoom, zoom })
      },
      { zoom: OVERVIEW_ZOOM, position: positionAfterDrag },
    )
    await page.waitForTimeout(350)
  }
  await page.mouse.move(disc.x - 60, disc.y - 30)
  await page.mouse.move(disc.x, disc.y)
  await proxyNode(page, 'map-source').waitFor({ state: 'attached', timeout: 10_000 })
  await expect.poll(() => armedPort(page)).toBe('source')
  await page.mouse.down()
  await page.mouse.move(disc.x + 30, disc.y, { steps: 4 })
  expect(await page.locator('.react-flow__connection').count()).toBe(1)
  const positionDuringConnect = await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().cards.find((card) => card.id === 'map-source')!.position
  })
  expect(positionDuringConnect).toEqual(positionAfterDrag)
  // Release over empty pane: a cancelled connect, still no card movement.
  await page.mouse.move(disc.x + 80, disc.y - 60, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(200)
  expect(await connectionPairs(page)).toEqual([])
})

test('port-vs-body below the old crossfade window: the body away from the disc drags; the disc press wires', async ({
  page,
}) => {
  await seedMapBoard(page)

  // At Map zoom (0.06) the fixed 13px connector discs ARE painted. The
  // proxy's oversized handle box is
  // press-gated to the armed side, so hit == paint holds down to the floor.

  // (i) At the card centre: outside both edge-centred painted discs — body.
  // At this zoom the whole Card is only 15.6×10.8 screen px, so the previous
  // “9px above the right edge” point was actually outside the Card frame and
  // could land on a selected resize control instead of testing body drag.
  const disc = await paintedPortCentre(page, SOURCE, 'right')
  const onBodyAwayFromDisc = { x: disc.x - (CARD_WIDTH * MAP_ZOOM) / 2, y: disc.y }
  await page.mouse.move(onBodyAwayFromDisc.x - 60, onBodyAwayFromDisc.y - 30)
  await page.mouse.move(onBodyAwayFromDisc.x, onBodyAwayFromDisc.y)
  await proxyNode(page, 'map-source').waitFor({ state: 'attached', timeout: 10_000 })
  expect(await armedPort(page)).toBe(null)

  const positionBefore = await sourcePosition(page)
  await page.mouse.down()
  await page.mouse.move(onBodyAwayFromDisc.x + 40, onBodyAwayFromDisc.y + 20, { steps: 8 })
  await page.mouse.up()

  await expect.poll(() => sourcePosition(page)).not.toEqual(positionBefore)
  expect(await connectionPairs(page)).toEqual([])

  // (ii) On the disc centre (recomputed for the moved card): the resolver
  // arms the source side and the press starts a connect that completes onto
  // the target's disc — exactly one store connection.
  const movedDisc = await paintedPortCentre(page, await sourcePosition(page), 'right')
  await page.mouse.move(movedDisc.x - 60, movedDisc.y - 30)
  await page.mouse.move(movedDisc.x, movedDisc.y)
  await proxyNode(page, 'map-source').waitFor({ state: 'attached', timeout: 10_000 })
  await expect.poll(() => armedPort(page)).toBe('source')
  await page.mouse.down()
  await page.mouse.move(movedDisc.x + 6, movedDisc.y, { steps: 2 })
  await dragOntoPort(page, 'map-target', TARGET, 'left')
  await page.mouse.up()

  await expect.poll(() => connectionPairs(page)).toEqual(['map-source->map-target'])
})

test('two-proxy stability gate: same-pair moves rebuild nothing; candidate swap replaces only the second participant', async ({
  page,
}) => {
  await seedMapBoard(page)

  const paintedAccounting = () =>
    page.evaluate(() => {
      const devWindow = window as unknown as DevWindow
      devWindow.__EIDO_FORCE_OVERVIEW_DRAW__?.()
      const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')!
      return {
        representationCount: Number(layer.dataset.representationCount ?? 0),
        silhouetteCardCount: Number(layer.dataset.silhouetteCardCount ?? 0),
        suppressedReactCardCount: Number(layer.dataset.suppressedReactCardCount ?? 0),
        sourcePainted: Boolean(devWindow.__EIDO_OVERVIEW_CARD_IDS__?.has('map-source')),
        targetPainted: Boolean(devWindow.__EIDO_OVERVIEW_CARD_IDS__?.has('map-target')),
      }
    })
  const baseline = await paintedAccounting()
  const seqStart = await boardChangeSeq(page)

  // Connect-start freezes the source; approaching the target lead-mounts the
  // candidate: exactly two proxies.
  await pressSourcePort(page)
  await dragOntoPort(page, 'map-target', TARGET, 'left')
  expect(await page.locator('.react-flow__node').count()).toBe(2)

  // Park inside the candidate's body for the storm.
  const targetBody = await panePoint(page, {
    x: (TARGET.x + CARD_WIDTH / 2) * MAP_ZOOM,
    y: (TARGET.y + CARD_HEIGHT / 2) * MAP_ZOOM,
  })
  await page.mouse.move(targetBody.x, targetBody.y, { steps: 2 })
  await page.waitForTimeout(200)

  // Arm the counters AFTER the pair locked.
  const before = await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    devWindow.__EIDO_PERF__!.resetBoardScenePerfCounters()
    devWindow.__EIDO_STORE_NOTIFY_COUNT__ = 0
    devWindow.__eido.subscribe(() => {
      devWindow.__EIDO_STORE_NOTIFY_COUNT__! += 1
    })
    return {
      nodes: document.querySelectorAll('.react-flow__node').length,
      boardChangeSeq: devWindow.__eido.getState().boardChangeSeq,
      mountPlanDerivations: devWindow.__EIDO_MOUNT_PLAN_DERIVATIONS__ ?? 0,
    }
  })

  // The storm: 60 frames × 4 bursts of pointermove+mousemove jittering inside
  // the SAME candidate body — the same source/target pair throughout. The
  // mousemove twin feeds React Flow's own document-level connection tracking,
  // so its native preview work runs during the storm too.
  const storm = await page.evaluate(
    ({ x, y }) =>
      new Promise<{ frames: number; events: number }>((resolve) => {
        const wrap = document.querySelector<HTMLElement>('.board-flow')!
        let frames = 0
        let events = 0
        const step = () => {
          frames += 1
          for (let burst = 0; burst < 4; burst += 1) {
            events += 1
            const jitterX = x + ((events % 5) - 2)
            const jitterY = y + ((events % 3) - 1)
            wrap.dispatchEvent(
              new PointerEvent('pointermove', { clientX: jitterX, clientY: jitterY, bubbles: true }),
            )
            wrap.dispatchEvent(
              new MouseEvent('mousemove', { clientX: jitterX, clientY: jitterY, bubbles: true }),
            )
          }
          if (frames < 60) requestAnimationFrame(step)
          else resolve({ frames, events })
        }
        requestAnimationFrame(step)
      }),
    targetBody,
  )

  const after = await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    return {
      scene: devWindow.__EIDO_PERF__!.boardScenePerfCounters(),
      nodes: document.querySelectorAll('.react-flow__node').length,
      boardChangeSeq: devWindow.__eido.getState().boardChangeSeq,
      storeNotifications: devWindow.__EIDO_STORE_NOTIFY_COUNT__ ?? 0,
      mountPlanDerivations: devWindow.__EIDO_MOUNT_PLAN_DERIVATIONS__ ?? 0,
      excluded: document.querySelector<HTMLElement>('.board-flow')?.dataset.excludedParticipantCount,
    }
  })
  const during = await paintedAccounting()
  const mountPlanDelta = after.mountPlanDerivations - before.mountPlanDerivations

  console.log(
    `[C3 gate] two-proxy storm: events=${storm.events} frames=${storm.frames} ` +
      `sceneDerivations=${after.scene.sceneDerivations} cardMetricDerivations=${after.scene.cardMetricDerivations} ` +
      `cardMetricVisits=${after.scene.cardMetricVisits} mountPlanDerivations=${mountPlanDelta} ` +
      `nodes=${before.nodes}->${after.nodes} storeMutations=${after.storeNotifications} ` +
      `boardChangeSeqDelta=${after.boardChangeSeq - before.boardChangeSeq} excluded=${after.excluded}`,
  )

  expect(storm.events).toBeGreaterThanOrEqual(200)
  // Same pair, no rebuilds anywhere: scene, mount plan, nodes, store.
  expect(after.scene.sceneDerivations).toBe(0)
  expect(after.scene.cardMetricDerivations).toBe(0)
  expect(after.scene.cardMetricVisits).toBe(0)
  expect(mountPlanDelta).toBe(0)
  expect(after.nodes).toBe(2)
  expect(after.storeNotifications).toBe(0)
  expect(after.boardChangeSeq).toBe(before.boardChangeSeq)
  expect(after.excluded).toBe('0')
  // Both proxy cards stay fully canvas-painted: normal band representation,
  // zero silhouettes, zero suppression — invisible adapters, not visuals.
  expect(during.sourcePainted).toBe(true)
  expect(during.targetPainted).toBe(true)
  expect(during.representationCount).toBe(baseline.representationCount)
  expect(during.silhouetteCardCount).toBe(0)
  expect(during.suppressedReactCardCount).toBe(0)

  // Candidate swap: mark the mounted source proxy element, then move to the
  // other target. Only the SECOND participant is replaced — the source proxy
  // keeps its DOM identity.
  await page.evaluate(() => {
    const element = document.querySelector('.react-flow__node-gestureProxy[data-id="map-source"]')
    ;(window as unknown as { __c3SourceElement?: Element | null }).__c3SourceElement = element
  })
  await dragOntoPort(page, 'map-target-b', TARGET_B, 'left')
  await expect.poll(() => proxyNode(page, 'map-target').count()).toBe(0)
  expect(await page.locator('.react-flow__node').count()).toBe(2)
  expect(
    await page.evaluate(() => {
      const devWindow = window as unknown as { __c3SourceElement?: Element | null }
      return (
        document.querySelector('.react-flow__node-gestureProxy[data-id="map-source"]') ===
        devWindow.__c3SourceElement
      )
    }),
  ).toBe(true)

  // Completing writes exactly ONE store connection (one commit).
  await page.mouse.up()
  await expect.poll(() => connectionPairs(page)).toEqual(['map-source->map-target-b'])
  expect(await boardChangeSeq(page)).toBe(seqStart + 1)
})

test('cancelling a connect clears the participants with zero board mutations', async ({ page }) => {
  await seedMapBoard(page)
  const seqBefore = await boardChangeSeq(page)

  await pressSourcePort(page)
  await dragOntoPort(page, 'map-target', TARGET, 'left')
  expect(await page.locator('.react-flow__node').count()).toBe(2)

  // Release over empty pane, far from every card: no connection, no commit,
  // and the participants drain to zero after the linger.
  const emptyPane = await panePoint(page, { x: 400, y: 700 })
  await page.mouse.move(emptyPane.x, emptyPane.y, { steps: 8 })
  await page.mouse.up()
  await page.mouse.move(emptyPane.x + 8, emptyPane.y, { steps: 2 })

  await expect.poll(() => page.locator('.react-flow__node').count(), { timeout: 5_000 }).toBe(0)
  expect(await connectionPairs(page)).toEqual([])
  expect(await boardChangeSeq(page)).toBe(seqBefore)
})

test('duplicate rejection: a second identical drag leaves exactly one connection', async ({ page }) => {
  await seedMapBoard(page)

  for (let attempt = 0; attempt < 2; attempt += 1) {
    await pressSourcePort(page)
    await dragOntoPort(page, 'map-target', TARGET, 'left')
    await page.mouse.up()
    await page.waitForTimeout(300)
    // Park away so the next attempt starts from a cold participant set.
    const park = await panePoint(page, { x: 400, y: 700 })
    await page.mouse.move(park.x, park.y)
    await page.waitForTimeout(400)
  }

  expect(await connectionPairs(page)).toEqual(['map-source->map-target'])
})
