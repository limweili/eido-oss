import { expect, test } from '@playwright/test'
import type { Card } from '../graph/types'
import { contentAwareMinZoom } from './renderPlanning'

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    currentIdeaId: string | null
    ideas: Array<{ id: string; [key: string]: unknown }>
  }
  setState: (state: unknown) => void
}

// Zoom regimes must be uniform per zoom level:
// - below the readable-detail zoom (0.18) the board is ONE representation —
//   canvas stand-ins for every card, no DOM detail aperture near screen
//   center — and every stand-in gets the SAME representation regardless of
//   card size (B1's frozen representation counters)
// - clicking a stand-in selects it in the store; below the Reading crossfade nothing
//   mounts (ADR 0020), so the selection paints instead of promoting
// - gesture zoom-out clamps at a content-aware floor (board fits with room
//   to spare), not at an arbitrary fixed constant

const GRID_COLS = 12
const GRID_ROWS = 10
const GRID_X_STEP = 420
const GRID_Y_STEP = 320

function fixtureCards(): Card[] {
  const longText = 'lorem ipsum dolor sit amet '.repeat(160)
  return Array.from({ length: GRID_COLS * GRID_ROWS }, (_, index) => {
    const col = index % GRID_COLS
    const row = Math.floor(index / GRID_COLS)
    return {
      id: `note-${index}`,
      kind: 'note' as const,
      blocks: [{ id: `note-${index}-block`, text: longText }],
      position: { x: col * GRID_X_STEP, y: row * GRID_Y_STEP },
      // A few oversized cards so per-card-size LOD tiers would visibly split.
      ...(index % 17 === 0 ? { size: { width: 800, height: 560 } } : {}),
      zIndex: 1,
    }
  })
}

async function seedTextHeavyBoard(page: import('@playwright/test').Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  const cards = fixtureCards()
  await page.evaluate((seededCards) => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: seededCards,
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
  return cards
}

function readScene(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
    const viewportElement = document.querySelector<HTMLElement>('.react-flow__viewport')
    const firstReadingNode = document.querySelector<HTMLElement>(
      '.react-flow__node:not(.react-flow__node-gestureProxy)',
    )
    const transform = viewportElement ? getComputedStyle(viewportElement).transform : 'none'
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
    return {
      zoom: matrix?.a ?? null,
      // gestureProxy nodes are invisible interaction stand-ins, not card mounts (ADR 0020)
      mountedReactCards: document.querySelectorAll('.react-flow__node:not(.react-flow__node-gestureProxy)').length,
      canvasRenderedCards: Number(layer?.dataset.renderedCardCount ?? -1),
      canvasRepresentation: layer?.dataset.representation ?? null,
      canvasRepresentationCards: Number(layer?.dataset.representationCount ?? -1),
      readingCardOpacity: Number(layer?.dataset.readingCardOpacity ?? -1),
      overviewCardOpacity: Number(layer?.dataset.overviewCardOpacity ?? -1),
      firstReadingNodeOpacity: firstReadingNode ? Number(getComputedStyle(firstReadingNode).opacity) : null,
    }
  })
}

test('Reading cards remain interactive while their bodies crossfade into Overview', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(() => {
    const devWindow = window as unknown as { __eido: EidoDevStore }
    devWindow.__eido.setState({
      cards: [
        {
          id: 'fade-note',
          kind: 'note',
          blocks: [{ id: 'fade-note-block', text: 'Readable through the fade' }],
          position: { x: 100, y: 100 },
        },
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
  })

  await page.locator('.react-flow__node-note').waitFor()
  await page.evaluate(() => window.__EIDO_SET_VIEWPORT__?.({ x: 260, y: 180, zoom: 0.325 }))
  await page.waitForTimeout(900)
  await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())

  const scene = await readScene(page)
  expect(scene.zoom).toBeCloseTo(0.325, 5)
  expect(scene.mountedReactCards).toBe(1)
  expect(scene.firstReadingNodeOpacity).toBeCloseTo(0.5, 2)
  expect(scene.readingCardOpacity).toBeCloseTo(0.5, 2)
  expect(scene.overviewCardOpacity).toBeCloseTo(0.5, 2)

  const card = page.locator('.react-flow__node-note').first()
  const box = await card.boundingBox()
  expect(box).not.toBeNull()
  await page.mouse.click(box!.x + box!.width / 2, box!.y + 24)
  await expect
    .poll(() =>
      page.evaluate(() => {
        const devWindow = window as unknown as {
          __eido?: { getState: () => { selection: { kind: string; id: string } | null } }
        }
        return devWindow.__eido?.getState().selection
      }),
    )
    .toEqual({ kind: 'card', id: 'fade-note' })
})

test('pinch zoom crosses from Overview back into Reading without snapping to the fit view', async ({
  page,
}) => {
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
    }
    const state = devWindow.__eido.getState()
    const sourceIdea = state.ideas.find((idea) => idea.id === state.currentIdeaId)
    if (!sourceIdea) throw new Error('Current Idea summary is unavailable')
    const ideaId = `${sourceIdea.id}-zoom-handoff`
    const note = (id: string, x: number) => ({
      id,
      kind: 'note',
      blocks: [{ id: `${id}-block`, text: id }],
      position: { x, y: 100 },
      zIndex: 1,
    })
    window.history.replaceState(
      window.history.state,
      '',
      `/?idea=${encodeURIComponent(ideaId)}&card=zoom-left&x=320&y=240&zoom=0.26`,
    )
    devWindow.__eido.setState({
      currentIdeaId: ideaId,
      ideas: [...state.ideas, { ...sourceIdea, id: ideaId }],
      cards: [note('zoom-left', 0), note('zoom-right', 4_000)],
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
    window.dispatchEvent(new PopStateEvent('popstate'))
  })

  // The production deep-link camera pins just below the Reading↔Overview
  // crossfade. The regression re-armed fitView as Reading opacity returned,
  // replacing the gradual zoom gesture with an automatic fit around whichever
  // DOM Cards had just mounted.
  await expect.poll(async () => (await readScene(page)).zoom).toBeCloseTo(0.26, 3)

  await page.mouse.move(360, 290)
  await page.keyboard.down('Control')
  let previousZoom = 0.26
  // Native wheel gain differs by platform. Keep pinching until the actual
  // camera crosses the band, while checking every step for a fit-view snap.
  while (previousZoom <= 0.33) {
    await page.mouse.wheel(0, -3)
    await page.waitForTimeout(120)
    const nextZoom = (await readScene(page)).zoom
    expect(nextZoom).not.toBeNull()
    expect(nextZoom!).toBeGreaterThan(previousZoom)
    expect(nextZoom!).toBeLessThan(previousZoom * 1.1)
    previousZoom = nextZoom!
  }
  await page.keyboard.up('Control')

  expect(previousZoom).toBeGreaterThan(0.33)
})

async function settleAtFarZoom(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 340, y: 180, zoom: 0.12 })
  })
  // Outlast the detail-aperture settle window, then force a canvas draw.
  await page.waitForTimeout(900)
  await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())
}

test('far zoom renders every card as a canvas stand-in at one uniform tier', async ({ page }) => {
  const cards = await seedTextHeavyBoard(page)
  await settleAtFarZoom(page)

  const scene = await readScene(page)
  expect(scene.zoom).toBeCloseTo(0.12, 5)
  // No DOM detail aperture: uniform representation.
  expect(scene.mountedReactCards).toBe(0)
  // Every seeded card paints on the canvas...
  expect(scene.canvasRenderedCards).toBe(cards.length)
  // ...in the band's ONE representation, despite mixed card sizes (the band,
  // derived from zoom, decides the representation — B1's frozen counters).
  expect(scene.canvasRepresentation).toBe('map')
  expect(scene.canvasRepresentationCards).toBe(cards.length)
})

test('clicking a canvas stand-in at far zoom selects it without mounting a node (ADR 0020)', async ({ page }) => {
  await seedTextHeavyBoard(page)
  await settleAtFarZoom(page)

  // note-26 (col 2, row 2) sits at world (840, 640); its screen position is
  // pane-relative, so offset by the pane's own client rect.
  const clickPoint = await page.evaluate(() => {
    const rect = document.querySelector('.react-flow')?.getBoundingClientRect()
    if (!rect) return null
    const zoom = 0.12
    return {
      x: rect.left + 840 * zoom + 340 + 15,
      y: rect.top + 640 * zoom + 180 + 10,
    }
  })
  expect(clickPoint).not.toBeNull()
  await page.mouse.click(clickPoint!.x, clickPoint!.y)
  // Selection lands in the store; below the Reading crossfade it stays a painted card
  // (Lane B's ring), never a mounted DOM node.
  await expect
    .poll(async () =>
      page.evaluate(() => {
        const devWindow = window as unknown as {
          __eido?: { getState: () => { selection: { kind: string; id: string } | null } }
        }
        const selection = devWindow.__eido?.getState().selection
        return selection?.kind === 'card' ? selection.id : null
      }),
    )
    .toBe('note-26')
  expect((await readScene(page)).mountedReactCards).toBe(0)
})

test('gesture zoom-out clamps at the content-aware floor', async ({ page }) => {
  const cards = await seedTextHeavyBoard(page)
  await page.evaluate(() => {
    const devWindow = window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 340, y: 180, zoom: 0.4 })
  })
  await page.waitForTimeout(300)

  const paneSize = await page.evaluate(() => {
    const rect = document.querySelector('.react-flow')?.getBoundingClientRect()
    return rect ? { width: rect.width, height: rect.height } : null
  })
  expect(paneSize).not.toBeNull()
  const expectedFloor = contentAwareMinZoom(cards, paneSize!)
  // The fixture must exercise a raised floor, or this test proves nothing.
  expect(expectedFloor).toBeGreaterThan(0.06)

  await page.mouse.move(640, 400)
  await page.keyboard.down('Control')
  for (let i = 0; i < 40; i += 1) await page.mouse.wheel(0, 240)
  await page.keyboard.up('Control')
  await page.waitForTimeout(300)

  const finalZoom = (await readScene(page)).zoom
  expect(finalZoom).not.toBeNull()
  expect(finalZoom!).toBeGreaterThanOrEqual(expectedFloor - 1e-3)
  expect(finalZoom!).toBeLessThanOrEqual(expectedFloor + 0.02)
})

async function loadDeclutterFixtureAtBand(
  page: import('@playwright/test').Page,
  band: { representation: 'overview' | 'map'; zoom: number },
) {
  await page.goto('/')
  await page.waitForFunction(
    () => Boolean(window.__EIDO_PERF__) && Boolean(window.__EIDO_SET_VIEWPORT__),
  )

  const fixture = await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('declutter'))
  expect(fixture).toBeDefined()
  await page.evaluate((zoom) => {
    window.__EIDO_SET_VIEWPORT__?.({ x: 300, y: 180, zoom })
  }, band.zoom)

  // Outlast the below-Reading settle window, then sample the painter's frozen
  // shape counters from a forced idle frame.
  await page.waitForTimeout(900)
  await page.evaluate(() => window.__EIDO_FORCE_OVERVIEW_DRAW__?.())

  const scene = await readScene(page)
  return { scene, visibleCards: fixture!.cards }
}

for (const band of [
  { name: 'Overview', representation: 'overview' as const, zoom: 0.17 },
  { name: 'Map', representation: 'map' as const, zoom: 0.12 },
]) {
  test(`band uniformity: ${band.name} paints every mixed-size declutter shape in one representation`, async ({
    page,
  }) => {
    const { scene, visibleCards } = await loadDeclutterFixtureAtBand(page, band)

    expect(scene.zoom).toBeCloseTo(band.zoom, 5)
    expect(scene.mountedReactCards).toBe(0)
    expect(scene.canvasRenderedCards).toBe(visibleCards)
    expect(scene.canvasRepresentation).toBe(band.representation)
    expect(scene.canvasRepresentationCards).toBe(scene.canvasRenderedCards)
  })
}
