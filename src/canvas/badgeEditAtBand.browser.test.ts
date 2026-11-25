import { expect, test, type Page } from '@playwright/test'
import { paintedBadgeRadius, paintedConnectionBadgeGeometry } from './zoomChrome'

// C5 (#322): at Overview and Map a connection is canvas-painted with no mounted
// edge component, so its editor pill lives only as a painted badge disc.
// Clicking that badge routes through the canvas connection hit-test (hit ==
// paint, the shared disc geometry), sets the store's `connectionEditorId`, and
// a Board-level host renders THE SAME `ConnectionPopover` via `ViewportPortal`.
// Every popover edit writes through the store's connection actions, exactly as
// the Reading pill does. Painted things have no DOM node — the badge point is
// computed from card geometry, never located by selector.

type EidoConnection = { id: string; polarity: string; strength: string }

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    connections: EidoConnection[]
    connectionEditorId: string | null
    selection: { kind: string; id: string } | null
  }
  setState: (state: unknown) => void
}

type DevWindow = {
  __eido?: EidoDevStore
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
}

// Two same-height notes on one row, so the painted connection degenerates to a
// horizontal line and its badge disc sits at the plain midpoint of the facing
// edges. Sizes are explicit so the badge point is deterministic below Reading,
// where cards are painted stand-ins with no measured DOM box.
const CARD_WIDTH = 260
const CARD_HEIGHT = 180
const SOURCE_X = 0
// Wide separation so the midpoint badge sits far (>100px screen at both bands)
// from either card edge — clear of the proximity lead (48px) and the proxy's
// oversized 96px connect handles, so the badge click lands on the pane, not a
// mounted proxy handle box.
const TARGET_X = 3000
const ROW_Y = 0
// Badge centre in FLOW space, from the shared geometry owner — the same
// function the painter and the hit-test read — applied to the connection's
// flow-space endpoints (source right-edge midpoint → target left-edge
// midpoint). Zoom only affects the disc radius, never the centre, so zoom 1
// yields the flow-space centre directly.
const BADGE_FLOW = paintedConnectionBadgeGeometry(
  {
    sourceX: SOURCE_X + CARD_WIDTH,
    sourceY: ROW_Y + CARD_HEIGHT / 2,
    targetX: TARGET_X,
    targetY: ROW_Y + CARD_HEIGHT / 2,
  },
  1,
).center
const BADGE_FLOW_X = BADGE_FLOW.x
const BADGE_FLOW_Y = BADGE_FLOW.y

// The overlap fixture's cover card: its RIGHT edge sits exactly on the badge
// centre's x (covering the disc's left half) and it is offset upward so its
// right-edge port disc and oversized proxy handle box stay far from the badge
// clicks — the covered/exposed split is decided by card paint alone.
const COVER_X = BADGE_FLOW_X - CARD_WIDTH
const COVER_Y = BADGE_FLOW_Y - CARD_HEIGHT / 2 - 60

async function seedBoard(page: Page, { withCoverCard = false }: { withCoverCard?: boolean } = {}) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as DevWindow
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(
    ({ width, height, sourceX, targetX, rowY, cover }) => {
      const devWindow = window as unknown as DevWindow & { __eido: EidoDevStore }
      const note = (id: string, x: number, y: number = rowY) => ({
        id,
        kind: 'note',
        blocks: [{ id: `${id}-block`, text: id }],
        position: { x, y },
        size: { width, height },
        zIndex: 1,
      })
      devWindow.__eido.setState({
        cards: [
          note('badge-source', sourceX),
          note('badge-target', targetX),
          ...(cover ? [note('badge-cover', cover.x, cover.y)] : []),
        ],
        connections: [
          {
            id: 'badge-conn',
            from: { cardId: 'badge-source' },
            to: { cardId: 'badge-target' },
            strength: 'strong',
            polarity: 'helps',
            role: 'feeds',
          },
        ],
        outputs: [],
        runs: [],
        intentLog: [],
        visualDecayEnabled: false,
        selection: null,
        selectedCardIds: [],
        connectionEditorId: null,
        undoStack: [],
        redoStack: [],
        activeTool: 'select',
      })
    },
    {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      sourceX: SOURCE_X,
      targetX: TARGET_X,
      rowY: ROW_Y,
      cover: withCoverCard ? { x: COVER_X, y: COVER_Y } : null,
    },
  )

  // The wide spread means fitView lands below Reading (cards are painted, not
  // mounted nodes), so wait for the overview canvas rather than a DOM node.
  await page.locator('.react-flow').waitFor({ state: 'attached' })
}

// Pin the viewport so the badge disc lands at a fixed pane point, clear of the
// pane edges (no auto-pan) and in the empty gap between the two cards.
async function pinBandWithBadgeAt(
  page: Page,
  zoom: number,
  paneTarget: { x: number; y: number },
) {
  await page.evaluate(
    ({ zoom: z, paneTarget: target, badgeFlowX, badgeFlowY }) => {
      const devWindow = window as unknown as DevWindow
      // screen = flow * zoom + viewport  =>  viewport = paneTarget - flow * zoom
      devWindow.__EIDO_SET_VIEWPORT__?.({
        x: target.x - badgeFlowX * z,
        y: target.y - badgeFlowY * z,
        zoom: z,
      })
    },
    { zoom, paneTarget, badgeFlowX: BADGE_FLOW_X, badgeFlowY: BADGE_FLOW_Y },
  )
  await page.waitForTimeout(600)
}

function paneBadgePoint(page: Page, paneTarget: { x: number; y: number }) {
  return page.evaluate((target) => {
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect()
    if (!pane) throw new Error('Missing board pane')
    return { x: pane.left + target.x, y: pane.top + target.y }
  }, paneTarget)
}

function paneWirePoint(page: Page, paneTarget: { x: number; y: number }, zoom: number) {
  // 1000 flow px before the midpoint: visibly off the badge in Overview and
  // Map, yet still within the horizontal connector's painted span.
  return paneBadgePoint(page, { x: paneTarget.x - 1000 * zoom, y: paneTarget.y })
}

function storeConnection(page: Page, id: string) {
  return page.evaluate((connectionId) => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    return devWindow.__eido.getState().connections.find((c) => c.id === connectionId) ?? null
  }, id)
}

const popover = (page: Page, id: string) => page.locator(`.connection-popover[data-connection-id="${id}"]`)

// A fixed pane point in the centre, away from the edges.
const PANE_TARGET = { x: 640, y: 400 }

for (const [band, zoom] of [['Overview', 0.25], ['Map', 0.08]] as const) {
  test(`hovering and clicking the off-midpoint whole wire works at ${band}`, async ({ page }) => {
    await seedBoard(page)
    await pinBandWithBadgeAt(page, zoom, PANE_TARGET)
    const wire = await paneWirePoint(page, PANE_TARGET, zoom)

    await page.mouse.move(wire.x, wire.y)
    await expect(page.locator('.board-flow')).toHaveAttribute('data-hovered-connection-id', 'badge-conn')
    await expect(page.locator('[data-board-overview-layer]')).toHaveAttribute(
      'data-hovered-connection-id',
      'badge-conn',
    )

    await page.mouse.click(wire.x, wire.y)
    await expect(popover(page, 'badge-conn')).toBeVisible()
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { __eido: EidoDevStore }).__eido.getState().selection),
      )
      .toEqual({ kind: 'connection', id: 'badge-conn' })

    await page.keyboard.press('Escape')
    await expect(popover(page, 'badge-conn')).toHaveCount(0)
    await expect(page.locator('.board-flow')).toBeFocused()
  })
}

test('clicking a painted badge at Overview opens the editor and a polarity edit writes through', async ({
  page,
}) => {
  await seedBoard(page)
  // Overview-only range (0.15 < zoom < 0.27625): connections are
  // canvas-painted, with no Reading DOM edge or pill participating yet.
  await pinBandWithBadgeAt(page, 0.25, PANE_TARGET)
  await expect(page.locator('.connection-pill[data-connection-id="badge-conn"]')).toHaveCount(0)

  const badge = await paneBadgePoint(page, PANE_TARGET)
  await page.mouse.click(badge.x, badge.y)

  // The Board-level host renders the popover for the store's editor id.
  await expect(popover(page, 'badge-conn')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __eido: EidoDevStore }).__eido.getState().connectionEditorId),
    )
    .toBe('badge-conn')

  await popover(page, 'badge-conn').getByRole('radio', { name: '− Avoid' }).click()
  await expect.poll(async () => (await storeConnection(page, 'badge-conn'))?.polarity).toBe('pushesAgainst')
})

test('clicking a painted badge at Map opens the editor and a strength edit writes through', async ({
  page,
}) => {
  await seedBoard(page)
  // Map band (zoom <= 0.15) but above the badge paint floor (0.04): the badge
  // disc is painted and hittable.
  await pinBandWithBadgeAt(page, 0.08, PANE_TARGET)
  await expect(page.locator('.connection-pill[data-connection-id="badge-conn"]')).toHaveCount(0)

  const badge = await paneBadgePoint(page, PANE_TARGET)
  await page.mouse.click(badge.x, badge.y)

  await expect(popover(page, 'badge-conn')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __eido: EidoDevStore }).__eido.getState().connectionEditorId),
    )
    .toBe('badge-conn')

  await popover(page, 'badge-conn').getByRole('radio', { name: 'Light' }).click()
  await expect.poll(async () => (await storeConnection(page, 'badge-conn'))?.strength).toBe('weak')
})

/**
 * Dispatch a stationary press straight at the React Flow pane.
 *
 * A real `mouse.click` cannot gate the pane resolver's z-order: the pointermove
 * it emits first arms the hover proxy for the nearest card, and whether React
 * commits that proxy mount before `pointerdown` decides whether the press is
 * taken by the proxy's node body (React Flow selects the card itself) or falls
 * through to `onPaneClick`. Both paths leave the SAME store state — card
 * selected, no editor — so a real-mouse assertion passes either way and could
 * not go red if the pane resolver started preferring badges over cards.
 *
 * Select mode resolves a stationary pane press on pointer-up, because a drag
 * owns marquee selection. A standalone synthetic click never reaches that
 * handler. Target the pane with the full press sequence to keep the proxy out
 * of this specific card-versus-badge ordering check.
 */
async function clickPaneAt(page: Page, clientX: number, clientY: number) {
  await page.evaluate(
    ({ x, y }) => {
      const pane = document.querySelector('.react-flow__pane')
      if (!pane) throw new Error('react-flow pane not found')
      for (const type of ['pointerdown', 'pointerup']) {
        pane.dispatchEvent(new PointerEvent(type, {
          bubbles: true,
          clientX: x,
          clientY: y,
          button: 0,
          buttons: type === 'pointerdown' ? 1 : 0,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
        }))
      }
    },
    { x: clientX, y: clientY },
  )
}

test('a painted card over a badge wins the press; the exposed half still opens the editor', async ({
  page,
}) => {
  // Painted z-order (#322): the painter draws badges BEFORE cards, so where a
  // card overlaps a badge the card is the visible paint and must take the
  // press; the uncovered half of the disc stays the editor affordance.
  await seedBoard(page, { withCoverCard: true })
  const zoom = 0.25
  await pinBandWithBadgeAt(page, zoom, PANE_TARGET)
  await expect(page.locator('.connection-pill[data-connection-id="badge-conn"]')).toHaveCount(0)

  // Click offsets stay inside the painted disc (radius from the shared owner)
  // on either side of the cover card's right edge, which sits exactly on the
  // disc centre.
  const inDiscOffset = Math.max(1, paintedBadgeRadius(zoom) - 1.5)
  const badge = await paneBadgePoint(page, PANE_TARGET)

  const readSelection = () =>
    page.evaluate(() => {
      const devWindow = window as unknown as { __eido: EidoDevStore }
      const state = devWindow.__eido.getState()
      return { selection: state.selection, connectionEditorId: state.connectionEditorId }
    })
  const clearSelection = () =>
    page.evaluate(() => {
      const devWindow = window as unknown as { __eido: EidoDevStore }
      devWindow.__eido.setState({ selection: null, selectedCardIds: [], connectionEditorId: null })
    })

  // The z-order gate: the pane resolver, asked directly, must answer "card".
  // This is the assertion that goes red if the ordering regresses.
  await clickPaneAt(page, badge.x - inDiscOffset, badge.y)
  await expect
    .poll(readSelection, { timeout: 3_000 })
    .toEqual({ selection: { kind: 'card', id: 'badge-cover' }, connectionEditorId: null })
  await expect(popover(page, 'badge-conn')).toHaveCount(0)
  await clearSelection()

  // And the user-visible outcome through a REAL press on the covered half is
  // the same, whichever of the two paths above takes it: the card wins, the
  // buried badge never opens its editor.
  await page.mouse.click(badge.x - inDiscOffset, badge.y)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as { __eido: EidoDevStore }
        return devWindow.__eido.getState().selection
      }),
    )
    .toEqual({ kind: 'card', id: 'badge-cover' })
  expect(
    await page.evaluate(
      () => (window as unknown as { __eido: EidoDevStore }).__eido.getState().connectionEditorId,
    ),
    'a badge under a painted card must not steal the card press',
  ).toBeNull()
  await expect(popover(page, 'badge-conn')).toHaveCount(0)

  // Exposed half: the badge wins — the editor opens.
  await page.mouse.click(badge.x + inDiscOffset, badge.y)
  await expect(popover(page, 'badge-conn')).toBeVisible()
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { __eido: EidoDevStore }).__eido.getState().connectionEditorId),
    )
    .toBe('badge-conn')
})
