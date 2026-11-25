import { expect, test, type Page } from '@playwright/test'

// Phase 2 of the connections rework (#259): the midpoint pill is the
// connection's editor. Hovering the line highlights it and grows the pill,
// clicking the pill opens a popover anchored to the connection, and every
// popover edit writes through the store's connection actions. The bottom-dock
// connection tray is gone; keyboard delete stays.

type EidoConnection = {
  id: string
  polarity: string
  strength: string
  reason?: string
  meta?: { groupMode?: string }
}

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: unknown[]
    connections: EidoConnection[]
    selection: { kind: string; id: string } | null
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

// Same-height cards on one row: the bezier between facing handles degenerates
// to a horizontal line, so the pill sits exactly halfway between the card
// edges (the geometry trick from edgeSelection.browser.test.ts).
async function seedBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
    const card = (id: string, kind: string, x: number, y: number, text: string) => ({
      id,
      kind,
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
        card('note-a', 'note', 0, 0, 'from here'),
        card('note-b', 'note', 600, 0, 'to here'),
        card('group-a', 'group', 0, 400, 'a group'),
        card('note-c', 'note', 600, 400, 'group feeds me'),
      ],
      connections: [link('note-connection', 'note-a', 'note-b'), link('group-connection', 'group-a', 'note-c')],
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
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 160, y: 0, zoom: 1 })
  })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length > 0)
  await page.waitForTimeout(500)
}

// The screen point halfway between the facing edges of two cards, at the
// source card's handle height — on the connector line by construction.
async function midpointBetween(page: Page, fromCardId: string, toCardId: string) {
  const boxFrom = await page.locator(`.react-flow__node[data-id="${fromCardId}"]`).boundingBox()
  const boxTo = await page.locator(`.react-flow__node[data-id="${toCardId}"]`).boundingBox()
  if (!boxFrom || !boxTo) throw new Error(`Missing bounding boxes for ${fromCardId} -> ${toCardId}`)
  return {
    x: (boxFrom.x + boxFrom.width + boxTo.x) / 2,
    y: boxFrom.y + boxFrom.height / 2,
  }
}

function storeConnection(page: Page, id: string) {
  return page.evaluate((connectionId) => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().connections.find((c) => c.id === connectionId) ?? null
  }, id)
}

function storeSelection(page: Page) {
  return page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().selection
  })
}

const pill = (page: Page, id: string) => page.locator(`.connection-pill[data-connection-id="${id}"]`)
const popover = (page: Page, id: string) => page.locator(`.connection-popover[data-connection-id="${id}"]`)

type RenderedBox = { x: number; y: number; width: number; height: number }

function boxesOverlap(a: RenderedBox, b: RenderedBox) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y
}

async function expectPillClearOfBoardChrome(page: Page, connectionId: string) {
  const [pillBox, dockBox, toolboxBox] = await Promise.all([
    pill(page, connectionId).boundingBox(),
    page.locator('.bottom-dock').boundingBox(),
    page.locator('.canvas-toolbox').boundingBox(),
  ])
  expect(pillBox).not.toBeNull()
  expect(dockBox).not.toBeNull()
  expect(toolboxBox).not.toBeNull()
  expect(
    boxesOverlap(pillBox!, dockBox!),
    `${connectionId} pill ${JSON.stringify(pillBox)} must not overlap BottomDock ${JSON.stringify(dockBox)}`,
  ).toBe(false)
  expect(
    boxesOverlap(pillBox!, toolboxBox!),
    `${connectionId} pill ${JSON.stringify(pillBox)} must not overlap canvas toolbox ${JSON.stringify(toolboxBox)}`,
  ).toBe(false)
}

test('hovering the line highlights it and grows the pill', async ({ page }) => {
  await seedBoard(page)

  const midpoint = await midpointBetween(page, 'note-a', 'note-b')
  // Hover the line away from the pill so the wide interaction stroke, not the
  // pill itself, carries the hover.
  await page.mouse.move(midpoint.x - 80, midpoint.y)

  await expect(
    page.locator('.react-flow__edge[data-id="note-connection"] path.connection-line'),
  ).toHaveClass(/hovered/)
  await expect(pill(page, 'note-connection')).toHaveClass(/hovered/)

  // Moving off the line lets both go again.
  await page.mouse.move(midpoint.x, midpoint.y - 120)
  await expect(pill(page, 'note-connection')).not.toHaveClass(/hovered/)
})

test('the interaction stroke is generous: a click 10px off the line still selects it', async ({ page }) => {
  await seedBoard(page)

  const midpoint = await midpointBetween(page, 'note-a', 'note-b')
  // 80px left of the pill and 10px above the painted line.
  await page.mouse.click(midpoint.x - 80, midpoint.y - 10)

  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'connection', id: 'note-connection' })
})

test('the whole wire opens its overlay, focuses it, and Escape returns focus to the midpoint owner', async ({ page }) => {
  await seedBoard(page)

  const midpoint = await midpointBetween(page, 'note-a', 'note-b')
  await page.mouse.move(midpoint.x - 80, midpoint.y)
  await expect(
    page.locator('.react-flow__edge[data-id="note-connection"] path.connection-line'),
  ).toHaveClass(/hovered/)
  await page.mouse.click(midpoint.x - 80, midpoint.y)

  const editor = popover(page, 'note-connection')
  await expect(editor).toBeVisible()
  await expect(editor.getByRole('radio', { name: '+ Helps' })).toBeFocused()

  await page.keyboard.press('Escape')
  await expect(editor).toHaveCount(0)
  await expect(pill(page, 'note-connection')).toBeFocused()
})

test('clicking the pill selects the connection and opens the editor popover', async ({ page }) => {
  await seedBoard(page)

  await pill(page, 'note-connection').click()

  await expect(popover(page, 'note-connection')).toBeVisible()
  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'connection', id: 'note-connection' })

  // Clicking the pill again closes the editor.
  await pill(page, 'note-connection').click()
  await expect(popover(page, 'note-connection')).toHaveCount(0)
})

test('connection editor follows the compact prototype anatomy at canvas zoom', async ({ page }) => {
  await seedBoard(page)
  await page.evaluate(() => {
    const devWindow = window as unknown as DevWindow
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 120, zoom: 2 })
  })

  await pill(page, 'note-connection').click()
  const editor = popover(page, 'note-connection')
  await expect(editor).toBeVisible()
  await expect(editor.getByText('Connection', { exact: true })).toHaveCount(1)
  await expect(editor.getByRole('menuitem', { name: 'Remove connection' })).toHaveClass(/e-menu__item/)
  const bounds = await editor.boundingBox()
  expect(bounds?.width).toBeLessThanOrEqual(260)
})

test('polarity toggle and reason write through to the store', async ({ page }) => {
  await seedBoard(page)

  // Avoid is a connection choice, not a separate card-level action.
  await expect(page.getByRole('button', { name: 'Mark as explored' })).toHaveCount(0)

  await pill(page, 'note-connection').click()
  const editor = popover(page, 'note-connection')
  await editor.getByRole('radio', { name: '− Avoid' }).click()

  await expect.poll(async () => (await storeConnection(page, 'note-connection'))?.polarity).toBe('pushesAgainst')

  // The reason field appears for Avoid and commits on Enter.
  const reason = editor.getByRole('textbox', { name: 'Reason' })
  await reason.fill('tried this shape already')
  await reason.press('Enter')
  await expect.poll(async () => (await storeConnection(page, 'note-connection'))?.reason).toBe(
    'tried this shape already',
  )

  // Back to Helps hides the reason field again.
  await editor.getByRole('radio', { name: '+ Helps' }).click()
  await expect(reason).toHaveCount(0)
})

test('the Light swatch keeps the connection solid and changes only its weight', async ({ page }) => {
  await seedBoard(page)

  await pill(page, 'note-connection').click()
  await popover(page, 'note-connection').getByRole('radio', { name: 'Light' }).click()

  await expect.poll(async () => (await storeConnection(page, 'note-connection'))?.strength).toBe('weak')
  await expect(
    page.locator('.react-flow__edge[data-id="note-connection"] path.connection-line'),
  ).toHaveCSS('stroke-dasharray', 'none')
  await expect(
    page.locator('.react-flow__edge[data-id="note-connection"] path.connection-line'),
  ).toHaveCSS('stroke-width', '1.5px')

  await popover(page, 'note-connection').getByRole('radio', { name: 'Direct' }).click()
  await expect.poll(async () => (await storeConnection(page, 'note-connection'))?.strength).toBe('strong')
})

test('delete in the popover removes the connection', async ({ page }) => {
  await seedBoard(page)

  await pill(page, 'note-connection').click()
  await popover(page, 'note-connection').getByRole('menuitem', { name: 'Remove connection' }).click()

  await expect.poll(async () => storeConnection(page, 'note-connection')).toBeNull()
  await expect(popover(page, 'note-connection')).toHaveCount(0)
})

test('keyboard delete still removes the connection selected through the pill', async ({ page }) => {
  await seedBoard(page)

  await pill(page, 'note-connection').click()
  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'connection', id: 'note-connection' })

  await page.keyboard.press('Delete')

  await expect.poll(async () => storeConnection(page, 'note-connection')).toBeNull()
})

test('the group choice appears only for group-source connections and writes through', async ({ page }) => {
  await seedBoard(page)

  // A note-source connection offers no group choice.
  await pill(page, 'note-connection').click()
  await expect(popover(page, 'note-connection')).toBeVisible()
  await expect(popover(page, 'note-connection').getByText('This group shares')).toHaveCount(0)
  await page.keyboard.press('Escape')

  // A group-source connection does, and the choice writes through.
  await expectPillClearOfBoardChrome(page, 'group-connection')
  await pill(page, 'group-connection').click()
  const editor = popover(page, 'group-connection')
  await expect(editor.getByText('This group shares')).toBeVisible()
  await editor.getByRole('radio', { name: 'A summary' }).click()
  await expect.poll(async () => (await storeConnection(page, 'group-connection'))?.meta?.groupMode).toBe('compress')

  await editor.getByRole('radio', { name: 'Everything' }).click()
  await expect.poll(async () => (await storeConnection(page, 'group-connection'))?.meta?.groupMode).toBe('full')
})

test('keyboard deletion of a group uses the shared confirmation dialog', async ({ page }) => {
  await seedBoard(page)

  const group = page.locator('.react-flow__node[data-id="group-a"]')
  // The group body deliberately lets pointer events pass through to cards it
  // contains. Its first title click bubbles to React Flow and is the stable
  // selection surface (unlike the adjacent colour control).
  await group.getByRole('button', { name: 'Group title' }).click()
  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'card', id: 'group-a' })
  await page.locator('.board-flow').focus()
  await page.keyboard.press('Delete')

  const dialog = page.getByRole('dialog', { name: 'Delete group' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('Cards inside will remain on the canvas but lose their grouping.')).toBeVisible()
  await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeFocused()
  await dialog.getByRole('button', { name: 'Delete group' }).click()
  await expect(group).toHaveCount(0)
})

test('connection selection leaves the card-action tray retired and opens the whole-wire editor', async ({ page }) => {
  await seedBoard(page)

  // Select by clicking the line (away from the pill): the attached card tray
  // stays hidden and the same connection editor appears.
  const midpoint = await midpointBetween(page, 'note-a', 'note-b')
  await page.mouse.click(midpoint.x - 80, midpoint.y)
  await expect.poll(() => storeSelection(page)).toEqual({ kind: 'connection', id: 'note-connection' })

  const cardTray = page.locator('[role="toolbar"][aria-label="Selected card actions"]')
  await expect(cardTray).toHaveAttribute('aria-hidden', 'true')
  await expect(cardTray.getByRole('button', { name: 'Remove connection' })).toHaveCount(0)
  await expect(popover(page, 'note-connection')).toBeVisible()
})

test('the editor stays in front of a Card raised over it', async ({ page }) => {
  await seedBoard(page)

  await pill(page, 'note-connection').click()
  const editor = popover(page, 'note-connection')
  await expect(editor).toBeVisible()
  const editorBox = await editor.boundingBox()
  expect(editorBox).not.toBeNull()

  // Drop a Card at the top of the Board's stack directly over the open editor.
  // The editor is a menu panel, so Board content may never paint across it,
  // however deep the Card stack has grown. The viewport is at zoom 1, so a
  // screen offset from the transformed viewport origin is a flow offset.
  await page.evaluate((rect) => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    const viewportOrigin = document
      .querySelector('.react-flow__viewport')!
      .getBoundingClientRect()
    devWindow.__eido.setState({
      cards: [
        ...devWindow.__eido.getState().cards,
        {
          id: 'cover-note',
          kind: 'note',
          blocks: [{ id: 'cover-note-block', text: 'raised over the editor' }],
          position: {
            x: rect.x - viewportOrigin.left - 40,
            y: rect.y - viewportOrigin.top - 40,
          },
          size: { width: rect.width + 160, height: rect.height + 160 },
          // The worst case the Board can produce: a Card asking for a layer
          // far past the ceiling, and selected as well. React Flow adds a
          // fixed lift to the selected node on top of the layer the Board
          // authored; today that lift does not reach this node's rendered
          // z-index, so this half of the state is a guard rather than a
          // reproduction. `boardScene.test.ts` holds the arithmetic itself.
          zIndex: 100_000,
          selected: true,
        },
      ],
    })
  }, editorBox!)

  await expect(page.locator('.react-flow__node[data-id="cover-note"]')).toBeVisible()
  await expect(editor).toBeVisible()

  const hitTopmost = await page.evaluate((rect) => {
    const target = document.elementFromPoint(
      rect.x + rect.width / 2,
      rect.y + rect.height / 2,
    )
    return {
      insideEditor: Boolean(target?.closest('.connection-popover')),
      actual: target?.className ?? null,
    }
  }, editorBox!)
  expect(
    hitTopmost.insideEditor,
    `the editor centre resolved to ${hitTopmost.actual} instead of the editor`,
  ).toBe(true)
})
