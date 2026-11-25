import { expect, test, type Page } from '@playwright/test'

// Characterization + regression tests for #211: clicking a connector line must
// select it on every interactive board. The small-board tests pin today's
// working DOM-edge behavior (click to select, Delete to remove) as the safety
// net for the upcoming selection refactor. The dense-board test reproduces the
// bug: past FULL_DETAIL_CONNECTION_LIMIT visible connections the scene flipped
// `useCanvasConnections` on, Board returned `edges = []`, and every connection
// was painted on the pointer-transparent overview canvas — clicks fell through
// to the pane and silently cleared selection.

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    connections: Array<{ id: string }>
    selection: { kind: string; id: string } | null
    undoStack: unknown[]
    undo: () => void
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

// Two same-height anchor cards on one row: their left/right handles share a Y,
// so the bezier between them degenerates to a horizontal line and the screen
// midpoint between the facing card edges is exactly on the painted path.
const ANCHOR_A = { x: 0, y: 0 }
const ANCHOR_B = { x: 600, y: 0 }

async function seedBoard(
  page: Page,
  { fillerConnections, fillerTextLength = 0 }: { fillerConnections: number; fillerTextLength?: number },
) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(
    ({ fillerConnections, fillerTextLength, anchorA, anchorB }) => {
      const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
      const note = (id: string, x: number, y: number, text: string) => ({
        id,
        kind: 'note',
        blocks: [{ id: `${id}-block`, text }],
        position: { x, y },
      })
      const link = (id: string, fromCardId: string, toCardId: string) => ({
        id,
        from: { cardId: fromCardId },
        to: { cardId: toCardId },
        strength: 'strong',
        polarity: 'helps',
        role: 'feeds',
      })

      // Filler cards live far below the anchors so their connections never
      // cross the click point between the anchors.
      const fillerCards = Array.from({ length: 24 }, (_, index) =>
        note(
          `filler-${index}`,
          (index % 8) * 400,
          4000 + Math.floor(index / 8) * 400,
          `filler ${index}${fillerTextLength ? ' ' + 'x'.repeat(fillerTextLength) : ''}`,
        ),
      )
      const cards = [
        note('anchor-a', anchorA.x, anchorA.y, 'from here'),
        note('anchor-b', anchorB.x, anchorB.y, 'to here'),
        ...fillerCards,
      ]
      const connections = [
        link('anchor-connection', 'anchor-a', 'anchor-b'),
        ...Array.from({ length: fillerConnections }, (_, index) =>
          link(`filler-connection-${index}`, `filler-${index % 24}`, `filler-${(index + 1) % 24}`),
        ),
      ]

      devWindow.__eido.setState({
        cards,
        connections,
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
    { fillerConnections, fillerTextLength, anchorA: ANCHOR_A, anchorB: ANCHOR_B },
  )

  // The optimized renderer may keep the initial all-board view entirely on
  // the painter, so a DOM-node wait cannot be the prerequisite for framing
  // the two Cards this test interacts with. The dev camera hook is exact and
  // retires any pending initial fit before the mounted-plane assertion.
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 160, y: 300, zoom: 1 })
  })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0)
  // Let the viewport and detail aperture settle before measuring geometry.
  await page.waitForTimeout(500)
}

// The screen point halfway between anchor-a's right edge and anchor-b's left
// edge, at handle height — on the connector line by construction.
async function anchorConnectionMidpoint(page: Page) {
  const boxA = await page.locator('.react-flow__node[data-id="anchor-a"]').boundingBox()
  const boxB = await page.locator('.react-flow__node[data-id="anchor-b"]').boundingBox()
  if (!boxA || !boxB) throw new Error('Missing anchor card bounding boxes')
  return {
    x: (boxA.x + boxA.width + boxB.x) / 2,
    y: boxA.y + boxA.height / 2,
  }
}

async function storeSelection(page: Page) {
  return page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().selection
  })
}

async function connectionIds(page: Page) {
  return page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().connections.map((connection) => connection.id)
  })
}

test('clicking a connector line on a small board selects the connection', async ({ page }) => {
  await seedBoard(page, { fillerConnections: 0 })

  await page.locator('.react-flow__edge[data-id="anchor-connection"]').waitFor({ state: 'attached' })
  const midpoint = await anchorConnectionMidpoint(page)
  await page.mouse.click(midpoint.x, midpoint.y)

  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'connection', id: 'anchor-connection' })
})

test('Delete removes the selected connection on a small board', async ({ page }) => {
  await seedBoard(page, { fillerConnections: 0 })

  await page.locator('.react-flow__edge[data-id="anchor-connection"]').waitFor({ state: 'attached' })
  const midpoint = await anchorConnectionMidpoint(page)
  await page.mouse.click(midpoint.x, midpoint.y)
  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'connection', id: 'anchor-connection' })

  await page.keyboard.press('Delete')

  await expect.poll(() => connectionIds(page)).not.toContain('anchor-connection')
})

test('clicking a connector line still selects it on a connection-dense board', async ({ page }) => {
  // 340 filler connections + the anchor connection put the board past
  // FULL_DETAIL_CONNECTION_LIMIT (320) at normal zoom while every card stays a
  // mounted full-detail DOM node.
  await seedBoard(page, { fillerConnections: 340 })

  const midpoint = await anchorConnectionMidpoint(page)
  await page.mouse.click(midpoint.x, midpoint.y)

  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'connection', id: 'anchor-connection' })
})

test('Delete removes the clicked connection on a connection-dense board', async ({ page }) => {
  await seedBoard(page, { fillerConnections: 340 })

  const midpoint = await anchorConnectionMidpoint(page)
  await page.mouse.click(midpoint.x, midpoint.y)
  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'connection', id: 'anchor-connection' })

  await page.keyboard.press('Delete')

  await expect.poll(() => connectionIds(page)).not.toContain('anchor-connection')
})

// The screen point halfway between the facing edges of two mounted cards, at
// handle height — on the connector line between them by construction.
async function midpointBetween(page: Page, fromCardId: string, toCardId: string) {
  const boxFrom = await page.locator(`.react-flow__node[data-id="${fromCardId}"]`).boundingBox()
  const boxTo = await page.locator(`.react-flow__node[data-id="${toCardId}"]`).boundingBox()
  if (!boxFrom || !boxTo) throw new Error(`Missing bounding boxes for ${fromCardId} -> ${toCardId}`)
  return {
    x: (boxFrom.x + boxFrom.width + boxTo.x) / 2,
    y: boxFrom.y + boxFrom.height / 2,
  }
}

// Mounted-node click geometry is unavailable on a card-dense canvas-only
// board; E2 moves this harness to store-position geometry (#315).
test.fixme('clicking near an unpainted connection past the paint cap deselects instead of phantom-selecting it', async ({ page }) => {
  // Painted-set parity above the 64-line paint cap (#211): the painter's
  // query truncates at connectionLimitForZoom (64 at zoom 1) in traversal
  // order, so with 71 connections traversed ahead of it, `phantom-connection`
  // is never painted even though its line crosses visible empty pane. The
  // pane-click hit test must agree: clicking that empty pane deselects — it
  // must not select (or let Delete remove) a line the user cannot see.
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const note = (id: string, x: number, y: number, text: string) => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text }],
      position: { x, y },
    })
    const link = (id: string, fromCardId: string, toCardId: string) => ({
      id,
      from: { cardId: fromCardId },
      to: { cardId: toCardId },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
    })

    // More than 540 small fillers trigger the card-density ceiling without
    // relying on text length. They sit below the visible pane but inside the
    // scene query margin; their 70 connections consume the paint cap while
    // the lines themselves are culled outside the viewport.
    const fillerCards = Array.from({ length: 541 }, (_, index) =>
      note(`filler-${index}`, (index % 24) * 50, 460 + Math.floor(index / 24) * 12, `filler ${index}`),
    )
    // Card order fixes connection traversal order: the pair is visited
    // first (painted), the fillers fill the rest of the 64-connection cap,
    // and the phantom pair is never reached.
    const cards = [
      note('pair-a', 0, 100, 'painted from'),
      note('pair-b', 600, 100, 'painted to'),
      ...fillerCards,
      note('phantom-a', 0, -250, 'unpainted from'),
      note('phantom-b', 600, -250, 'unpainted to'),
    ]
    const connections = [
      link('pair-connection', 'pair-a', 'pair-b'),
      ...Array.from({ length: 70 }, (_, index) =>
        link(`filler-connection-${index}`, `filler-${index % 541}`, `filler-${(index + 1) % 541}`),
      ),
      link('phantom-connection', 'phantom-a', 'phantom-b'),
    ]

    devWindow.__eido.setState({
      cards,
      connections,
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

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 160, y: 300, zoom: 1 })
  })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0)
  await page.waitForTimeout(500)

  // Guards: connections live on the canvas (no DOM edges), and the painter
  // painted ONLY the pair line — the phantom line fell past the cap. If the
  // count were 2 the cap did not bind and this test would prove nothing.
  expect(await page.locator('.react-flow__edge').count()).toBe(0)
  await expect
    .poll(() =>
      page.evaluate(
        () => document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')?.dataset.renderedConnectionCount,
      ),
    )
    .toBe('1')

  // Positive control: the painted line is clickable in this dense setup.
  const paintedMidpoint = await midpointBetween(page, 'pair-a', 'pair-b')
  await page.mouse.click(paintedMidpoint.x, paintedMidpoint.y)
  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'connection', id: 'pair-connection' })

  // Clicking the empty pane where the unpainted phantom line runs must
  // deselect, not select the invisible line.
  const phantomMidpoint = await midpointBetween(page, 'phantom-a', 'phantom-b')
  await page.mouse.click(phantomMidpoint.x, phantomMidpoint.y)
  await expect.poll(() => storeSelection(page)).toBeNull()

  // And Delete after that click must not remove the unseen connection.
  await page.keyboard.press('Delete')
  await page.waitForTimeout(200)
  expect(await connectionIds(page)).toContain('phantom-connection')
})

// ---- #212: marquee selects connector lines it touches; multi-connection
// selection + delete. Connections become first-class selectable, symmetric
// with cards: the drag-selection box selects every connection it touches
// (React Flow only auto-selects edges whose BOTH endpoint cards are in the
// box, so intersection selection is app-side), several connections can be
// selected at once alongside cards, and Delete removes all of them as one
// undo entry.

// Same stabilization pattern as marqueeSelection.browser.test.ts: React Flow
// recomputes the marquee's node set on every pointermove, and getNodesInside
// force-includes any node whose handleBounds are momentarily unmeasured — so
// let the rebuild settle, then nudge the pointer so the final recompute (the
// one the release commits) runs against measured nodes.
const dragBox = async (page: Page, from: { x: number; y: number }, to: { x: number; y: number }) => {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.waitForTimeout(50)
  await page.mouse.move(to.x, to.y, { steps: 8 })
  await page.waitForTimeout(150)
  await page.mouse.move(to.x + 2, to.y + 2)
  await page.waitForTimeout(100)
  await page.mouse.up()
}

async function undoStackSize(page: Page) {
  return page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().undoStack.length
  })
}

// Two connected card pairs stacked as rows: a1 -> b1 and a2 -> b2. Each pair
// shares a row, so each connector degenerates to a horizontal line whose
// screen midpoint sits between the facing card edges — with 600 board units
// between the columns, a marquee between the columns touches only the lines,
// never the cards.
async function seedTwoRowBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const note = (id: string, x: number, y: number, text: string) => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text }],
      position: { x, y },
    })
    const link = (id: string, fromCardId: string, toCardId: string) => ({
      id,
      from: { cardId: fromCardId },
      to: { cardId: toCardId },
      strength: 'strong',
      polarity: 'helps',
      role: 'feeds',
    })
    devWindow.__eido.setState({
      cards: [
        note('row1-a', 0, 0, 'row one from'),
        note('row1-b', 600, 0, 'row one to'),
        note('row2-a', 0, 300, 'row two from'),
        note('row2-b', 600, 300, 'row two to'),
      ],
      connections: [link('row1-connection', 'row1-a', 'row1-b'), link('row2-connection', 'row2-a', 'row2-b')],
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

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 160, y: 300, zoom: 1 })
  })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0)
  await page.waitForTimeout(500)
}

test('marquee crossing the middle of a connection selects it with both endpoint cards outside the box', async ({ page }) => {
  await seedBoard(page, { fillerConnections: 0 })

  const edge = page.locator('.react-flow__edge[data-id="anchor-connection"]')
  await edge.waitFor({ state: 'attached' })
  const midpoint = await anchorConnectionMidpoint(page)

  // A tight box around the line's midpoint: it crosses the connector but stays
  // far from both endpoint cards (the facing card edges are ~170px away).
  await dragBox(page, { x: midpoint.x - 30, y: midpoint.y - 50 }, { x: midpoint.x + 30, y: midpoint.y + 50 })

  await expect(edge).toHaveClass(/selected/)
  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'connection', id: 'anchor-connection' })
  // Neither endpoint card was in the box.
  await expect(page.locator('.react-flow__node[data-id="anchor-a"]')).not.toHaveClass(/selected/)
  await expect(page.locator('.react-flow__node[data-id="anchor-b"]')).not.toHaveClass(/selected/)
})

test('marquee selects the cards and connections it touches together', async ({ page }) => {
  await seedBoard(page, { fillerConnections: 0 })

  const edge = page.locator('.react-flow__edge[data-id="anchor-connection"]')
  await edge.waitFor({ state: 'attached' })
  const nodeA = page.locator('.react-flow__node[data-id="anchor-a"]')
  const boxA = await nodeA.boundingBox()
  if (!boxA) throw new Error('Missing anchor-a bounding box')
  const midpoint = await anchorConnectionMidpoint(page)

  // From above-left of anchor-a to past the line's midpoint: touches the card
  // and crosses the connector, but never reaches anchor-b.
  await dragBox(page, { x: boxA.x - 40, y: boxA.y - 40 }, { x: midpoint.x + 20, y: midpoint.y + 40 })

  await expect(nodeA).toHaveClass(/selected/)
  await expect(edge).toHaveClass(/selected/)
  await expect(page.locator('.react-flow__node[data-id="anchor-b"]')).not.toHaveClass(/selected/)
})

test('marquee touching a card but not its connector leaves the connector unselected and keeps the single-card dock', async ({ page }) => {
  // React Flow's box selection auto-adds every edge attached to any
  // box-selected node — ONE endpoint in the box suffices (connectionLookup
  // keys a node to all edges where it is source OR target). Those select
  // deltas must not leak into the app's connection selection: the box
  // selects only connections it geometrically TOUCHES, symmetric with cards.
  await seedBoard(page, { fillerConnections: 0 })

  const edge = page.locator('.react-flow__edge[data-id="anchor-connection"]')
  await edge.waitFor({ state: 'attached' })
  const nodeA = page.locator('.react-flow__node[data-id="anchor-a"]')
  const boxA = await nodeA.boundingBox()
  if (!boxA) throw new Error('Missing anchor-a bounding box')

  // A small box over anchor-a's top-left corner: it touches the card, but the
  // connector's curve lives entirely to the right of the card's right edge —
  // the box (ending 230px left of it) cannot touch the curve.
  await dragBox(page, { x: boxA.x - 40, y: boxA.y - 40 }, { x: boxA.x + 30, y: boxA.y + 30 })

  await expect(nodeA).toHaveClass(/selected/)
  await expect(edge).not.toHaveClass(/selected/)

  // With one card and no connections selected, the selection mirrors to the
  // store as that card, and the dock shows its single-card controls.
  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'card', id: 'anchor-a' })
  const cardTray = page.getByRole('toolbar', { name: 'Selected card actions' })
  await expect(cardTray.getByRole('button', { name: 'Duplicate', exact: true })).toBeVisible()
  await expect(cardTray.getByRole('button', { name: 'Remove connection' })).toHaveCount(0)
})

test('Delete removes every marquee-selected connection and one undo restores them all', async ({ page }) => {
  await seedTwoRowBoard(page)

  const edge1 = page.locator('.react-flow__edge[data-id="row1-connection"]')
  const edge2 = page.locator('.react-flow__edge[data-id="row2-connection"]')
  await edge1.waitFor({ state: 'attached' })
  await edge2.waitFor({ state: 'attached' })

  const row1Midpoint = await midpointBetween(page, 'row1-a', 'row1-b')
  const row2Midpoint = await midpointBetween(page, 'row2-a', 'row2-b')

  // One box spanning both rows' midpoints, between the card columns: it
  // crosses both connectors and touches no card.
  await dragBox(
    page,
    { x: row1Midpoint.x - 30, y: row1Midpoint.y - 50 },
    { x: row2Midpoint.x + 30, y: row2Midpoint.y + 50 },
  )

  await expect(edge1).toHaveClass(/selected/)
  await expect(edge2).toHaveClass(/selected/)
  expect(await page.locator('.react-flow__node.selected').count()).toBe(0)

  const undoEntriesBefore = await undoStackSize(page)
  await page.keyboard.press('Delete')

  await expect.poll(() => connectionIds(page)).not.toContain('row1-connection')
  await expect.poll(() => connectionIds(page)).not.toContain('row2-connection')
  // The batch delete is ONE undo entry...
  expect(await undoStackSize(page)).toBe(undoEntriesBefore + 1)

  // ...so one undo restores both connections.
  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.getState().undo()
  })
  await expect.poll(() => connectionIds(page)).toContain('row1-connection')
  await expect.poll(() => connectionIds(page)).toContain('row2-connection')
})
