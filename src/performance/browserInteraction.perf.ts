import { expect, test, type Page } from '@playwright/test'
import { DETAIL_CULL_MARGIN_PX } from '../canvas/boardScene'
import type { PerfBoardName } from '../graph/perfFixtures'

type BrowserMeasurement = {
  workflow: string
  ms: number
}

type NavigationResponsiveness = {
  classification: string
  frames: number
  durationMs: number
  averageFps: number
  sustainedFps: number
  maxFrameGapMs: number
  p95FrameGapMs: number
  p99FrameGapMs: number
  blankFrames: number
  emptyViewportFrames: number
  minNodeCount: number
  maxNodeCount: number
  minRepresentedCardCount: number
  maxRepresentedCardCount: number
  minRepresentedCardRatio: number
  maxRepresentedCardDeficit: number
  minVisibleRepresentationProbeCount: number
  maxVisibleRepresentationProbeCount: number
  minRepresentedVisibleCardCount: number
  maxRepresentedVisibleCardCount: number
  maxMissingVisibleCardCount: number
  minVisibleReactCardCount: number
  maxVisibleReactCardCount: number
  minOverviewRepresentedVisibleCardCount: number
  maxOverviewRepresentedVisibleCardCount: number
  minFullDetailNodeCount: number
  maxFullDetailNodeCount: number
  minLowZoomNodeCount: number
  maxLowZoomNodeCount: number
  minExpectedVisibleCardCount: number
  maxExpectedVisibleCardCount: number
  minExpectedNodeCount: number
  maxExpectedNodeCount: number
  minViewportZoom: number
  maxViewportZoom: number
  cadenceMs: number
}

declare global {
  interface Window {
    __EIDO_PERF_LONG_TASKS__?: Array<{ name: string; startTime: number; duration: number }>
  }
}

// Interim budget, set from the measured control envelope on main@48730b3
// (3 control runs: 1 task, 179/195/185ms). The residual is NOT this slice's:
// the same single task appears with decay present and absent, and its likely
// carrier is `simulate streaming output chunks` (~233ms every run). A3 (#306)
// removes the order-of-board edit-path work; tighten BOTH to 0 when A3 lands.
// PerformanceObserver's longtask floor is 50ms — that is this instrument's
// sensitivity; anything cheaper is invisible here.
const MAX_EDIT_PATH_LONG_TASKS = 1
const MAX_EDIT_PATH_LONG_TASK_MS = 250
const NAVIGATION_TARGET_FPS = 60
const NAVIGATION_TOLERANCE_FPS = 2
const MIN_SUSTAINED_NAVIGATION_FPS = NAVIGATION_TARGET_FPS - NAVIGATION_TOLERANCE_FPS
const MIN_REPRESENTED_CARD_RATIO = 0.98
const MAX_REPRESENTED_CARD_DEFICIT = 2
const MAX_BLANK_FRAMES = 0
const MAX_NAVIGATION_NODES = 620
const MAX_SETTLED_NODES = 620
const MAX_FULL_DETAIL_NAVIGATION_NODES = 540
const MIN_LONG_TEXT_READABLE_FULL_DETAIL_NODES = 100
const ZOOM_STEP_INTERVAL = 18
const ZOOM_WHEEL_DELTA = 80
const MIN_EXERCISED_ZOOM_RANGE = 0.08
const TEST_ENV = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const CURRENT_BOARD_SOURCE = TEST_ENV.process?.env?.EIDO_CURRENT_BOARD_DATA_FILE
const CURRENT_BOARD_MIN_CARDS = envNumber('EIDO_CURRENT_BOARD_MIN_CARDS', 100)
const CURRENT_BOARD_MIN_CONNECTIONS = envNumber('EIDO_CURRENT_BOARD_MIN_CONNECTIONS', 50)
const CURRENT_BOARD_NAVIGATION_MS = envNumber('EIDO_CURRENT_BOARD_NAVIGATION_MS', 3500)

test('large Board browser interaction baseline', async ({ page }) => {
  await installLongTaskObserver(page)
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__))

  const measurements: BrowserMeasurement[] = []
  const summary = await measure(measurements, 'load large Board fixture', async () => {
    const loaded = await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('large'))
    await waitForFrames(page, 4)
    await waitForBoardRepresentation(page)
    return loaded
  })

  expect(summary).toMatchObject({ cards: 5000, connections: 10000, events: 50000 })

  await measure(measurements, 'pan and zoom large Board', async () => {
    await page.mouse.move(720, 500)
    await page.mouse.wheel(0, -600)
    await waitForFrames(page, 4)
  })

  const navigation = await measureNavigationResponsiveness(page)
  expectZoomWasExercised(navigation)
  await expectCanvasLodConnections(page)
  await expectCanvasLodDoesNotCoverReactCards(page)
  await expectSettledDetailRecovery(page, 1, { requireFullDetail: false })

  await measure(measurements, 'move first note and render', async () => {
    await page.evaluate(() => window.__EIDO_PERF__?.moveFirstNote())
    await waitForFrames(page, 4)
  })

  const editWindowStart = await page.evaluate(() => performance.now())

  await measure(measurements, 'type in first note and render', async () => {
    await page.evaluate(() => window.__EIDO_PERF__?.typeFirstNote('Browser performance note edit'))
    await waitForFrames(page, 4)
  })

  await measure(measurements, 'simulate streaming output chunks', async () => {
    await page.evaluate(() => window.__EIDO_PERF__?.streamFirstOutput(50))
    await waitForFrames(page, 4)
  })

  const editWindowEnd = await page.evaluate(() => performance.now())

  await measure(measurements, 'open Playback', async () => {
    await page.getByRole('button', { name: 'Playback' }).click()
    await page.locator('.timeline-panel').waitFor({ state: 'visible', timeout: 60_000 })
    await waitForFrames(page, 4)
  })

  await measure(measurements, 'scrub Playback', async () => {
    const slider = page.getByRole('slider', { name: 'Playback' })
    await slider.evaluate((element) => {
      const input = element as HTMLInputElement
      input.value = '850'
      input.dispatchEvent(new Event('input', { bubbles: true }))
      input.dispatchEvent(new Event('change', { bubbles: true }))
    })
    await waitForFrames(page, 4)
  })

  const longTasks = await page.evaluate(() => window.__EIDO_PERF_LONG_TASKS__ ?? [])
  const totalLongTaskMs = longTasks.reduce((sum, task) => sum + task.duration, 0)
  const editPathLongTasks = longTasks.filter(
    (task) => task.startTime >= editWindowStart && task.startTime <= editWindowEnd,
  )
  const editPathLongTaskTotalMs = editPathLongTasks.reduce((sum, task) => sum + task.duration, 0)

  console.log('\nBrowser interaction performance report')
  console.table(measurements.map((measurement) => ({ workflow: measurement.workflow, ms: measurement.ms.toFixed(2) })))
  console.log('\nBrowser responsiveness signals')
  console.table([
    {
      longTasks: longTasks.length,
      totalLongTaskMs: totalLongTaskMs.toFixed(2),
      maxLongTaskMs: Math.max(0, ...longTasks.map((task) => task.duration)).toFixed(2),
      editPathLongTasks: editPathLongTasks.length,
      editPathLongTaskMs: editPathLongTaskTotalMs.toFixed(2),
    },
  ])
  printNavigationReport('Navigation responsiveness', navigation)

  expect(measurements).toHaveLength(7)
  expectNavigationBudget(navigation)
  // The real edit-path gate (replaces the old always-true longTasks >= 0):
  // typing and streaming must stay inside the measured control envelope, and
  // the navigation capture must have painted every frame.
  expect(editPathLongTasks.length).toBeLessThanOrEqual(MAX_EDIT_PATH_LONG_TASKS)
  expect(editPathLongTaskTotalMs).toBeLessThanOrEqual(MAX_EDIT_PATH_LONG_TASK_MS)
  expect(navigation.blankFrames).toBe(0)
})

test('rich Board stays canvas-painted below Reading with zero mounts (ADR 0020)', async ({ page }) => {
  await installLongTaskObserver(page)
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__))

  const loaded = await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('rich'))
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)

  expect(loaded).toMatchObject({ cards: 160, connections: 180, events: 500 })

  await setViewportForBoardPoint(page, { boardX: 13000, boardY: 260, zoom: 0.05 })
  await page.waitForTimeout(220)
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)
  const farCounts = await nodeDetailCounts(page)
  expect(farCounts.representedCards).toBeGreaterThanOrEqual(150)
  // Inverted mount gate (ADR 0020): below Reading nothing mounts. A gesture
  // proxy allowance (<= 2) arrives with Lane C, whose participants are the
  // only below-Reading mounts.
  expect(farCounts.fullDetailNodes).toBe(0)
  expect(farCounts.overviewConnections).toBeGreaterThan(0)

  const navigation = await measureNavigationResponsiveness(page, 'rich', 5000, {
    label: 'rich-overview-fit-pan',
    pan: true,
    zoom: false,
  })
  const longTasks = await page.evaluate(() => window.__EIDO_PERF_LONG_TASKS__ ?? [])
  const totalLongTaskMs = longTasks.reduce((sum, task) => sum + task.duration, 0)

  console.log('\nRich Board responsiveness signals')
  console.table([
    {
      longTasks: longTasks.length,
      totalLongTaskMs: totalLongTaskMs.toFixed(2),
      maxLongTaskMs: Math.max(0, ...longTasks.map((task) => task.duration)).toFixed(2),
    },
  ])
  printNavigationReport('Rich text navigation responsiveness', navigation)

  expectNavigationBudget(navigation)
  expect(navigation.maxFullDetailNodeCount).toBe(0)

  // Text length is uncapped, so the 160-card rich fixture returns to Reading
  // detail at a Reading zoom.
  await setViewportForBoardPoint(page, { boardX: 1800, boardY: 120, zoom: 0.45 })
  await page.waitForTimeout(260)
  await waitForFrames(page, 4)
  const closeCounts = await nodeDetailCounts(page)
  expect(closeCounts.fullDetailNodes).toBeGreaterThan(0)
  expect(closeCounts.representedCards).toBeGreaterThan(0)
})

test('rich Board summary derivation updates for card content changes, not navigation frames', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean((window as unknown as { __eido?: unknown }).__eido))

  const loaded = await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('rich'))
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)
  expect(loaded).toMatchObject({ cards: 160, connections: 180, events: 500 })

  const firstNoteId = await page.evaluate(() => {
    const graph = (window as unknown as {
      __eido?: { getState: () => { cards: Array<{ id: string; kind: string }> } }
    }).__eido
    const card = graph?.getState().cards.find((candidate) => candidate.kind === 'note')
    if (!card) throw new Error('Missing first note')
    return card.id
  })

  await page.evaluate(() => window.__EIDO_PERF__?.resetBoardScenePerfCounters())
  await page.evaluate(() => window.__EIDO_PERF__?.typeFirstNote('Rich summary derivation changed once'))
  await waitForFrames(page, 4)
  const afterEditCounters = await page.evaluate(() => {
    const counters = window.__EIDO_PERF__?.boardScenePerfCounters()
    if (!counters) throw new Error('Missing board scene counters')
    return counters
  })

  expect(afterEditCounters.summaryCardIds).toEqual([firstNoteId])
  expect(afterEditCounters.weightCardIds).toEqual([firstNoteId])

  await setViewportForBoardPoint(page, { boardX: 13000, boardY: 260, zoom: 0.05 })
  await waitForFrames(page, 4)
  await page.evaluate(() => window.__EIDO_PERF__?.resetBoardScenePerfCounters())
  const navigation = await measureNavigationResponsiveness(page, 'rich', 1200, {
    label: 'rich-summary-cache-pan',
    pan: true,
    zoom: false,
  })
  const afterNavigationCounters = await page.evaluate(() => {
    const counters = window.__EIDO_PERF__?.boardScenePerfCounters()
    if (!counters) throw new Error('Missing board scene counters')
    return counters
  })

  expectNavigationBudget(navigation)
  expect(afterNavigationCounters.summaryComputations).toBe(0)
  expect(afterNavigationCounters.summaryCardIds).toEqual([])
})

test('long-text rich Board mounts Reading detail settled and mid-move', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__))

  const loaded = await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('rich'))
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)

  expect(loaded).toMatchObject({ cards: 160, connections: 180, events: 500 })

  await setViewportForBoardPoint(page, { boardX: 1800, boardY: 120, zoom: 0.45 })
  await page.waitForTimeout(260)
  await waitForFrames(page, 4)
  const settledDetailIds = await fullDetailNodeIds(page)

  expect(settledDetailIds).toHaveLength(160)

  await setViewportForBoardPoint(page, { boardX: 2400, boardY: 120, zoom: 0.45 })
  const movingDetailIds = await fullDetailNodeIds(page)

  expect(movingDetailIds).toHaveLength(160)
})

test('long-text Board remains in Reading detail when card occupancy fits', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean((window as unknown as { __eido?: unknown }).__eido))
  await waitForHydratedStore(page)

  await loadDenseTextHeavyBoard(page, 140)
  await setViewportForBoardPoint(page, { boardX: 1800, boardY: 900, zoom: 0.33 })
  await page.waitForTimeout(260)
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)

  const counts = await nodeDetailCounts(page)
  expect(counts.fullDetailNodes).toBe(140)
  expect(counts.representedCards).toBeGreaterThanOrEqual(140)

  await setViewportForBoardPoint(page, { boardX: 1800, boardY: 900, zoom: 1 })
  await page.waitForTimeout(260)
  await waitForFrames(page, 4)
  const readingZoomCounts = await nodeDetailCounts(page)
  expect(readingZoomCounts.fullDetailNodes).toBe(140)
})

test('current saved Board navigation validation', async ({ page }) => {
  test.skip(!CURRENT_BOARD_SOURCE, 'Set EIDO_CURRENT_BOARD_DATA_FILE to validate a copied private saved board')

  await installLongTaskObserver(page)
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean((window as unknown as { __eido?: unknown }).__eido))
  await waitForHydratedStore(page)

  const summary = await page.evaluate(() => window.__EIDO_PERF__?.summary())
  if (!summary) throw new Error('Missing browser performance runtime')
  expect(summary.cards).toBeGreaterThanOrEqual(CURRENT_BOARD_MIN_CARDS)
  expect(summary.connections).toBeGreaterThanOrEqual(CURRENT_BOARD_MIN_CONNECTIONS)

  await fitCurrentBoard(page)
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)

  const initialCounts = await nodeDetailCounts(page)
  expect(initialCounts.representedCards).toBeGreaterThan(0)

  const readableViewport = await setCurrentBoardReadableDetailViewport(page)
  await page.waitForTimeout(260)
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)
  const readableCounts = await nodeDetailCounts(page)
  expect(readableViewport.candidateCount).toBeGreaterThanOrEqual(MIN_LONG_TEXT_READABLE_FULL_DETAIL_NODES)
  // Inverted (ADR 0020): this viewport sits below Reading, so no card
  // mounts regardless of the saved board's class; the cards are
  // canvas-painted and counted through representation instead.
  expect(readableCounts.fullDetailNodes).toBe(0)
  expect(readableCounts.representedCards).toBeGreaterThan(0)

  await fitCurrentBoard(page)
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)

  const navigation = await measureNavigationResponsiveness(page, 'large', CURRENT_BOARD_NAVIGATION_MS, {
    label: 'current-saved-board',
    pan: true,
    zoom: true,
  })
  const longTasks = await page.evaluate(() => window.__EIDO_PERF_LONG_TASKS__ ?? [])
  const totalLongTaskMs = longTasks.reduce((sum, task) => sum + task.duration, 0)

  console.log('\nCurrent saved Board summary')
  console.table([
    {
      cards: summary.cards,
      connections: summary.connections,
      outputs: summary.outputs,
      runs: summary.runs,
      events: summary.events,
      longTasks: longTasks.length,
      totalLongTaskMs: totalLongTaskMs.toFixed(2),
      maxLongTaskMs: Math.max(0, ...longTasks.map((task) => task.duration)).toFixed(2),
    },
  ])
  printNavigationReport('Current saved Board navigation responsiveness', navigation)

  expectNavigationBudget(navigation)
  expectZoomWasExercised(navigation)
})

test('massive Board mounts every windowed card in Reading and nothing below it (ADR 0020)', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__))

  const loaded = await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('large'))
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)

  expect(loaded).toMatchObject({ cards: 5000, connections: 10000, events: 50000 })

  await zoomOutAtBoardCenter(page)
  await page.waitForTimeout(220)
  await waitForFrames(page, 4)
  const farCounts = await nodeDetailCounts(page)
  expect(farCounts.fullDetailNodes).toBe(0)
  expect(farCounts.representedCards).toBeGreaterThan(0)
  expect(farCounts.overviewConnections).toBeGreaterThan(0)
  expect(farCounts.overviewConnectionBadges).toBeGreaterThan(0)

  // Reading on a massive board (ADR 0020): with the board-class caps
  // deleted, mounting is decided by the band alone — at zoom 1 the cull
  // window holds a few hundred cards, under the occupancy budget, so every
  // windowed card mounts with no 32-card aperture.
  await setViewportForBoardPoint(page, { boardX: 2700, boardY: 2700, zoom: 1 })
  await page.waitForTimeout(300)
  await waitForFrames(page, 4)
  await page.waitForFunction(
    () => document.querySelectorAll('.react-flow__node').length >= 100,
    { timeout: 10_000 },
  )

  const closeCounts = await nodeDetailCounts(page)
  expect(closeCounts.fullDetailNodes).toBeGreaterThanOrEqual(100)
  expect(closeCounts.nodes).toBeLessThanOrEqual(MAX_SETTLED_NODES)
  expect(closeCounts.representedCards).toBeGreaterThanOrEqual(closeCounts.fullDetailNodes)
})

test('canvas mouse drag pan and trackpad pan keep moving after card selection', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean((window as unknown as { __eido?: unknown }).__eido))
  await waitForHydratedStore(page)

  await loadDenseFullDetailBoard(page, 24)
  // Reading zoom: below Reading no node mounts (ADR 0020), and this test
  // drags a real mounted node before panning. Set the viewport twice around
  // a settle wait so the deferred fitView (which fires on the first mount)
  // cannot override it, then wait for the settle-gated Reading promotion.
  await setViewportForBoardPoint(page, { boardX: 900, boardY: 230, zoom: 0.78 })
  await page.waitForTimeout(300)
  await setViewportForBoardPoint(page, { boardX: 900, boardY: 230, zoom: 0.78 })
  await page.waitForTimeout(300)
  await waitForFrames(page, 4)
  await page.locator('.react-flow__node').first().waitFor({ state: 'visible', timeout: 30_000 })
  await waitForRepresentedCards(page, 24)

  const firstNode = page.locator('.react-flow__node').first()
  await firstNode.click()
  await setActiveTool(page, 'pan')

  const nodeBox = await firstNode.boundingBox()
  expect(nodeBox).not.toBeNull()
  const nodeDragPoint = { x: nodeBox!.x + nodeBox!.width / 2, y: nodeBox!.y + nodeBox!.height / 2 }
  const beforeNodeDrag = await viewportTransform(page)
  await page.mouse.move(nodeDragPoint.x, nodeDragPoint.y)
  await page.mouse.down()
  await page.mouse.move(nodeDragPoint.x + 180, nodeDragPoint.y + 72, { steps: 10 })
  await page.mouse.up()
  await waitForFrames(page, 4)
  const afterNodeDrag = await viewportTransform(page)

  expect(Math.hypot(afterNodeDrag.x - beforeNodeDrag.x, afterNodeDrag.y - beforeNodeDrag.y)).toBeGreaterThan(80)

  const dragPoint = await emptyPanePoint(page)
  const beforeDrag = await viewportTransform(page)
  await page.mouse.move(dragPoint.x, dragPoint.y)
  await page.mouse.down()
  await page.mouse.move(dragPoint.x + 180, dragPoint.y + 72, { steps: 10 })
  await page.mouse.up()
  await waitForFrames(page, 4)
  const afterDrag = await viewportTransform(page)

  expect(Math.hypot(afterDrag.x - beforeDrag.x, afterDrag.y - beforeDrag.y)).toBeGreaterThan(80)

  await setActiveTool(page, 'select')
  const trackpadPoint = await emptyPanePoint(page)
  const beforeTrackpad = await viewportTransform(page)
  await page.mouse.move(trackpadPoint.x, trackpadPoint.y)
  await page.mouse.wheel(240, 120)
  await waitForFrames(page, 4)
  const afterTrackpad = await viewportTransform(page)

  expect(Math.hypot(afterTrackpad.x - beforeTrackpad.x, afterTrackpad.y - beforeTrackpad.y)).toBeGreaterThan(80)
})

test('massive Board pointer drag pans while rendered through the canvas overview', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean((window as unknown as { __eido?: unknown }).__eido))

  await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('large'))
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)
  await setViewportForBoardPoint(page, { boardX: 2700, boardY: 2700, zoom: 0.5 })
  await waitForRepresentedCards(page, 120)

  const overviewCounts = await nodeDetailCounts(page)
  expect(overviewCounts.fullDetailNodes).toBe(0)
  expect(overviewCounts.overviewRepresentationCards).toBeGreaterThanOrEqual(100)

  await setActiveTool(page, 'pan')
  const dragPoint = await emptyPanePoint(page)
  const beforeDrag = await viewportTransform(page)
  await page.mouse.move(dragPoint.x, dragPoint.y)
  await page.mouse.down()
  await page.mouse.move(dragPoint.x + 220, dragPoint.y + 96, { steps: 12 })
  await page.mouse.up()
  await waitForFrames(page, 4)
  const afterDrag = await viewportTransform(page)

  expect(Math.hypot(afterDrag.x - beforeDrag.x, afterDrag.y - beforeDrag.y)).toBeGreaterThan(120)
})

test('massive Board canvas overview cards remain selectable at mid zoom', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean((window as unknown as { __eido?: unknown }).__eido))

  await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('large'))
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)
  await setViewportForBoardPoint(page, { boardX: 2700, boardY: 2700, zoom: 0.5 })
  await waitForRepresentedCards(page, 120)

  const overviewCounts = await nodeDetailCounts(page)
  expect(overviewCounts.fullDetailNodes).toBe(0)
  expect(overviewCounts.overviewRepresentationCards).toBeGreaterThanOrEqual(100)

  await setActiveTool(page, 'select')
  const target = await overviewCardClickTarget(page)
  await page.mouse.click(target.x, target.y)
  await page.waitForFunction((cardId) => {
    const graph = (window as unknown as {
      __eido?: {
        getState: () => {
          selectedCardIds: string[]
          selection: { kind: string; id: string } | null
        }
      }
    }).__eido
    const state = graph?.getState()
    return state?.selection?.kind === 'card' &&
      state.selection.id === cardId &&
      state.selectedCardIds.includes(cardId)
  }, target.cardId, { timeout: 10_000 })
  await waitForFrames(page, 4)

  // Inverted selection-promotion gate (ADR 0020): selecting a painted card
  // below Reading paints its selection (Lane B's ring) instead of mounting a
  // full node — the card stays canvas-represented and nothing enters the DOM.
  const selectedCounts = await nodeDetailCounts(page)
  expect(selectedCounts.fullDetailNodes).toBe(0)
  expect(await page.locator(`.react-flow__node[data-id="${target.cardId}"]`).count()).toBe(0)
  expect(selectedCounts.representedCards).toBeGreaterThanOrEqual(120)
  expect(
    await page.evaluate(() =>
      Number(document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.suppressedReactCardCount ?? -1),
    ),
  ).toBe(0)

  // Painter-level ring evidence, so this gate goes red if the ring draw is
  // ever deleted: sample the overview canvas just OUTSIDE the selected
  // card's painted frame (the ring draws at a 2.5px offset, 2px wide) and
  // require the selection-strength accent stroke. Store selection + zero
  // mounts alone would stay green with no visible selection at all.
  const ringEvidence = await page.evaluate((cardId) => {
    window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
    const graph = (window as unknown as {
      __eido?: {
        getState: () => {
          cards: Array<{ id: string; kind: string; position: { x: number; y: number }; size?: { width: number; height: number } }>
        }
      }
    }).__eido
    const card = graph?.getState().cards.find((candidate) => candidate.id === cardId)
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    const context = canvas?.getContext('2d')
    const viewportElement = document.querySelector<HTMLElement>('.react-flow__viewport')
    const transform = viewportElement ? getComputedStyle(viewportElement).transform : 'none'
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
    if (!card || !canvas || !context || !matrix) throw new Error('Missing ring probe runtime')

    const zoom = matrix.a
    const frameX = card.position.x * zoom + matrix.e
    const frameY = card.position.y * zoom + matrix.f
    const width = (card.size?.width ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 320 : 260)) * zoom
    const scaleX = canvas.width / canvas.getBoundingClientRect().width
    const scaleY = canvas.height / canvas.getBoundingClientRect().height

    // Scan a vertical band across the card's top edge at several x stops:
    // the ring stroke (accent ~rgb(47,111,94) at 0.9 alpha) sits ~2.5-4.5px
    // above frameY. Selection strength alpha (>=150) excludes the 0.35-alpha
    // hover ring.
    let ringPixels = 0
    for (let stop = 0.3; stop <= 0.7; stop += 0.2) {
      for (let dy = -6; dy <= 0; dy += 1) {
        const x = Math.round((frameX + width * stop) * scaleX)
        const y = Math.round((frameY + dy) * scaleY)
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) continue
        const [r, g, b, a] = context.getImageData(x, y, 1, 1).data
        if (a >= 150 && Math.abs(r - 47) <= 30 && Math.abs(g - 111) <= 30 && Math.abs(b - 94) <= 30) {
          ringPixels += 1
        }
      }
    }
    return { ringPixels }
  }, target.cardId)
  expect(ringEvidence.ringPixels).toBeGreaterThan(0)
})

test('massive Board keeps mid-zoom representation coherent while panning', async ({ page }) => {
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__))

  const loaded = await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('large'))
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)

  expect(loaded).toMatchObject({ cards: 5000, connections: 10000, events: 50000 })

  await setViewportForBoardPoint(page, { boardX: 2700, boardY: 2700, zoom: 0.5 })
  await page.waitForTimeout(220)
  await waitForFrames(page, 4)
  await waitForBoardRepresentation(page)
  const settledCounts = await nodeDetailCounts(page)
  expect(settledCounts.representedCards).toBeGreaterThanOrEqual(120)
  // Inverted mid-zoom DOM cap (ADR 0020): below Reading the mount count is
  // exactly zero. Lane C's gesture proxies (<= 2 invisible nodes) are the
  // only below-Reading mounts once C1/C2 land.
  expect(settledCounts.fullDetailNodes).toBe(0)
  expect(settledCounts.overviewRepresentationCards).toBeGreaterThanOrEqual(100)

  const navigation = await measureNavigationResponsiveness(page, 'large', 3500, {
    label: 'massive-mid-zoom-coherent-pan',
    pan: true,
    zoom: false,
  })

  printNavigationReport('Massive mid-zoom coherent pan', navigation)

  expectNavigationBudget(navigation)
  expect(navigation.maxFullDetailNodeCount).toBe(0)
  expect(navigation.minOverviewRepresentedVisibleCardCount).toBeGreaterThanOrEqual(100)
  expect(navigation.maxMissingVisibleCardCount).toBe(0)
})

test('dense full-detail card viewport degrades before jank', async ({ page }) => {
  await installLongTaskObserver(page)
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean((window as unknown as { __eido?: unknown }).__eido))
  await waitForHydratedStore(page)

  await loadDenseFullDetailBoard(page, 120)
  // Reading band (>= 0.70): fit-view zoom sits below Reading now that the
  // band alone decides mounting (ADR 0020), so the full-detail gate pins the
  // viewport at Reading zoom over the board centre; the 1800px cull margin
  // keeps all 120 cards in the mount window. Set the viewport twice around a
  // settle wait so the deferred fitView cannot override it, then wait for
  // the settle-gated Reading promotion to mount the full window.
  await setViewportForBoardPoint(page, { boardX: 1560, boardY: 1150, zoom: 0.78 })
  await page.waitForTimeout(300)
  await setViewportForBoardPoint(page, { boardX: 1560, boardY: 1150, zoom: 0.78 })
  await page.waitForTimeout(300)
  await waitForFrames(page, 4)
  await page.waitForFunction(
    (count) => document.querySelectorAll('.react-flow__node').length >= count,
    120,
    { timeout: 30_000 },
  )
  await waitForRepresentedCards(page, 120)
  const initialCounts = await nodeDetailCounts(page)

  expect(initialCounts.nodes).toBeLessThanOrEqual(MAX_SETTLED_NODES)
  expect(initialCounts.representedCards).toBeGreaterThanOrEqual(120)
  expect(initialCounts.overviewCoversReactNodes).toBe(false)
  expect(initialCounts.nodes - initialCounts.lowZoomNodes).toBeLessThanOrEqual(MAX_FULL_DETAIL_NAVIGATION_NODES)

  await page.waitForTimeout(220)
  await waitForFrames(page, 4)
  const settledCounts = await nodeDetailCounts(page)

  expect(settledCounts.representedCards).toBeGreaterThanOrEqual(120)
  expect(settledCounts.fullDetailNodes).toBeGreaterThan(0)
  expect(settledCounts.nodes).toBeLessThanOrEqual(MAX_SETTLED_NODES)

  const navigation = await measureNavigationResponsiveness(page, 'large', 5000, {
    label: 'dense-full-detail-120',
    zoom: true,
  })
  const longTasks = await page.evaluate(() => window.__EIDO_PERF_LONG_TASKS__ ?? [])
  const totalLongTaskMs = longTasks.reduce((sum, task) => sum + task.duration, 0)

  console.log('\nDense full-detail responsiveness signals')
  console.table([
    {
      longTasks: longTasks.length,
      totalLongTaskMs: totalLongTaskMs.toFixed(2),
      maxLongTaskMs: Math.max(0, ...longTasks.map((task) => task.duration)).toFixed(2),
    },
  ])
  printNavigationReport('Dense full-detail navigation responsiveness', navigation)

  expectNavigationBudget(navigation)
  expectZoomWasExercised(navigation)
  expect(navigation.minFullDetailNodeCount).toBeGreaterThanOrEqual(110)
  await expectSettledDetailRecovery(page, 120)
})

async function installLongTaskObserver(page: Page) {
  await page.addInitScript(() => {
    window.__EIDO_PERF_LONG_TASKS__ = []
    if (!('PerformanceObserver' in window)) return
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          window.__EIDO_PERF_LONG_TASKS__?.push({
            name: entry.name,
            startTime: entry.startTime,
            duration: entry.duration,
          })
        }
      })
      observer.observe({ entryTypes: ['longtask'] })
    } catch {
      window.__EIDO_PERF_LONG_TASKS__ = []
    }
  })
}

async function measure<T>(measurements: BrowserMeasurement[], workflow: string, fn: () => Promise<T>): Promise<T> {
  const start = performance.now()
  const value = await fn()
  measurements.push({ workflow, ms: performance.now() - start })
  return value
}

async function waitForFrames(page: Page, count: number) {
  await page.evaluate(
    async (frames) => {
      for (let index = 0; index < frames; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      }
    },
    count,
  )
}

async function waitForHydratedStore(page: Page) {
  await page.waitForFunction(() => {
    const graph = (window as unknown as { __eido?: { getState: () => { hydrated: boolean } } }).__eido
    return Boolean(graph?.getState().hydrated)
  }, { timeout: 60_000 })
}

async function waitForBoardRepresentation(page: Page) {
  await page.waitForFunction(() => {
    const nodeCount = document.querySelectorAll('.react-flow__node').length
    const overviewCount = Number(document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedCardCount ?? 0)
    return nodeCount + overviewCount > 0
  }, { timeout: 60_000 })
}

async function measureNavigationResponsiveness(
  page: Page,
  fixture: PerfBoardName = 'large',
  durationMs = 8000,
  options: { label?: string; pan?: boolean; zoom?: boolean; targetFps?: number; toleranceFps?: number } = {},
): Promise<NavigationResponsiveness> {
  const samplePromise = page.evaluate(async ({ fixture, label, durationMs, targetFps, toleranceFps }) => {
    const result = await window.__EIDO_PERF__?.captureNavigation({
      fixture,
      label,
      targetFps,
      toleranceFps,
      durationMs,
    })
    if (!result) throw new Error('Missing browser performance runtime')
    return {
      frames: result.frames,
      classification: result.classification,
      durationMs: result.durationMs,
      averageFps: result.averageFps,
      sustainedFps: result.sustainedFps,
      maxFrameGapMs: result.maxFrameGapMs,
      p95FrameGapMs: result.p95FrameGapMs,
      p99FrameGapMs: result.p99FrameGapMs,
      blankFrames: result.blankFrames,
      emptyViewportFrames: result.emptyViewportFrames,
      minNodeCount: result.minNodeCount,
      maxNodeCount: result.maxNodeCount,
      minRepresentedCardCount: result.minRepresentedCardCount,
      maxRepresentedCardCount: result.maxRepresentedCardCount,
      minRepresentedCardRatio: result.minRepresentedCardRatio,
      maxRepresentedCardDeficit: result.maxRepresentedCardDeficit,
      minVisibleRepresentationProbeCount: result.minVisibleRepresentationProbeCount,
      maxVisibleRepresentationProbeCount: result.maxVisibleRepresentationProbeCount,
      minRepresentedVisibleCardCount: result.minRepresentedVisibleCardCount,
      maxRepresentedVisibleCardCount: result.maxRepresentedVisibleCardCount,
      maxMissingVisibleCardCount: result.maxMissingVisibleCardCount,
      minVisibleReactCardCount: result.minVisibleReactCardCount,
      maxVisibleReactCardCount: result.maxVisibleReactCardCount,
      minOverviewRepresentedVisibleCardCount: result.minOverviewRepresentedVisibleCardCount,
      maxOverviewRepresentedVisibleCardCount: result.maxOverviewRepresentedVisibleCardCount,
      minFullDetailNodeCount: result.minFullDetailNodeCount,
      maxFullDetailNodeCount: result.maxFullDetailNodeCount,
      minLowZoomNodeCount: result.minLowZoomNodeCount,
      maxLowZoomNodeCount: result.maxLowZoomNodeCount,
      minExpectedVisibleCardCount: result.minExpectedVisibleCardCount,
      maxExpectedVisibleCardCount: result.maxExpectedVisibleCardCount,
      minExpectedNodeCount: result.minExpectedNodeCount,
      maxExpectedNodeCount: result.maxExpectedNodeCount,
      minViewportZoom: result.minViewportZoom,
      maxViewportZoom: result.maxViewportZoom,
      cadenceMs: result.displayCadenceMs,
    } satisfies NavigationResponsiveness
  }, {
    fixture,
    label: options.label,
    durationMs,
    targetFps: options.targetFps ?? NAVIGATION_TARGET_FPS,
    toleranceFps: options.toleranceFps ?? NAVIGATION_TOLERANCE_FPS,
  })

  if (options.pan !== false || options.zoom !== false) await page.mouse.move(720, 500)
  const steps = Math.ceil(durationMs / 29)
  try {
    for (let index = 0; index < steps; index += 1) {
      const shouldZoom = options.zoom !== false && index % ZOOM_STEP_INTERVAL === 0
      if (shouldZoom) {
        await page.keyboard.down('Control')
        await page.mouse.wheel(0, index % (ZOOM_STEP_INTERVAL * 2) === 0 ? -ZOOM_WHEEL_DELTA : ZOOM_WHEEL_DELTA)
        await page.keyboard.up('Control')
      } else {
        const deltaY = index % 2 === 0 ? -160 : 160
        const deltaX = options.pan === false ? 0 : index % 4 < 2 ? 32 : -32
        await page.mouse.wheel(deltaX, deltaY)
      }
      await page.waitForTimeout(24)
    }
  } finally {
    await page.keyboard.up('Control').catch(() => undefined)
  }

  return samplePromise
}

async function loadDenseFullDetailBoard(page: Page, count: number) {
  await page.evaluate((cardCount) => {
    const now = new Date('2026-06-20T00:00:00.000Z').toISOString()
    const graph = (window as unknown as { __eido: { setState: (state: unknown) => void } }).__eido
    const cards = Array.from({ length: cardCount }, (_, index) => ({
      id: `dense-note-${index}`,
      kind: 'note',
      blocks: [
        {
          id: `dense-note-${index}-block`,
          text: `Dense full detail note ${index}\n\n- small body\n- visible chrome`,
        },
      ],
      position: { x: (index % 12) * 260, y: Math.floor(index / 12) * 230 },
      headerColor: ['#f6d365', '#96e6a1', '#8fd3f4', '#fbc2eb'][index % 4],
    }))
    graph.setState({
      cards,
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      ideas: [
        {
          id: 'dense-full-detail',
          name: 'Dense full-detail stress',
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
        },
      ],
      currentIdeaId: 'dense-full-detail',
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: true,
      storageStatus: null,
      keyPromptOpen: false,
      ideaManagerOpen: false,
      cardClipboard: null,
    })
  }, count)
  await waitForFrames(page, 4)
  // Below Reading nothing mounts (ADR 0020), so board readiness is canvas
  // representation, not a mounted node; callers set a Reading viewport and
  // wait for nodes themselves.
  await waitForBoardRepresentation(page)
}

async function loadDenseTextHeavyBoard(page: Page, count: number) {
  await page.evaluate((cardCount) => {
    const now = new Date('2026-06-20T00:00:00.000Z').toISOString()
    const graph = (window as unknown as { __eido: { setState: (state: unknown) => void } }).__eido
    const cards = Array.from({ length: cardCount }, (_, index) => ({
      id: `text-heavy-note-${index}`,
      kind: 'note',
      blocks: [
        {
          id: `text-heavy-note-${index}-block`,
          text: `Readable detail aperture note ${index}\n\n${'Dense text body. '.repeat(240)}`,
        },
      ],
      position: { x: (index % 14) * 260, y: Math.floor(index / 14) * 190 },
      headerColor: ['#f6d365', '#96e6a1', '#8fd3f4', '#fbc2eb'][index % 4],
    }))
    graph.setState({
      cards,
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      ideas: [
        {
          id: 'dense-text-heavy-detail',
          name: 'Dense text-heavy detail stress',
          createdAt: now,
          updatedAt: now,
          lastOpenedAt: now,
        },
      ],
      currentIdeaId: 'dense-text-heavy-detail',
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: true,
      storageStatus: null,
      keyPromptOpen: false,
      ideaManagerOpen: false,
      cardClipboard: null,
    })
  }, count)
  await waitForFrames(page, 4)
}

async function fitCurrentBoard(page: Page) {
  await page.evaluate(() => {
    const graph = (window as unknown as {
      __eido?: {
        getState: () => {
          cards: Array<{
            kind: string
            position: { x: number; y: number }
            size?: { width: number; height: number }
          }>
        }
      }
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }).__eido
    const setViewport = (window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }).__EIDO_SET_VIEWPORT__
    const flow = document.querySelector('.react-flow')
    const rect = flow?.getBoundingClientRect()
    const cards = graph?.getState().cards ?? []
    if (!setViewport || !rect || cards.length === 0) return

    const sizeForCard = (card: { kind: string; size?: { width: number; height: number } }) => ({
      width: card.size?.width ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 320 : 260),
      height: card.size?.height ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 82 : 180),
    })
    const bounds = cards.reduce(
      (result, card) => {
        const size = sizeForCard(card)
        return {
          minX: Math.min(result.minX, card.position.x),
          minY: Math.min(result.minY, card.position.y),
          maxX: Math.max(result.maxX, card.position.x + size.width),
          maxY: Math.max(result.maxY, card.position.y + size.height),
        }
      },
      { minX: Number.POSITIVE_INFINITY, minY: Number.POSITIVE_INFINITY, maxX: Number.NEGATIVE_INFINITY, maxY: Number.NEGATIVE_INFINITY },
    )
    const boardWidth = Math.max(1, bounds.maxX - bounds.minX)
    const boardHeight = Math.max(1, bounds.maxY - bounds.minY)
    const padding = 96
    const zoom = Math.max(
      0.04,
      Math.min(1, (rect.width - padding * 2) / boardWidth, (rect.height - padding * 2) / boardHeight),
    )
    const centerX = (bounds.minX + bounds.maxX) / 2
    const centerY = (bounds.minY + bounds.maxY) / 2
    setViewport({
      x: rect.left + rect.width / 2 - centerX * zoom,
      y: rect.top + rect.height / 2 - centerY * zoom,
      zoom,
    })
  })
}

async function setCurrentBoardReadableDetailViewport(page: Page) {
  return page.evaluate(({ detailCullMarginPx, zoom }) => {
    const graph = (window as unknown as {
      __eido?: {
        getState: () => {
          cards: Array<{
            kind: string
            position: { x: number; y: number }
            size?: { width: number; height: number }
          }>
        }
      }
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }).__eido
    const setViewport = (window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }).__EIDO_SET_VIEWPORT__
    const flow = document.querySelector('.react-flow')
    const rect = flow?.getBoundingClientRect()
    const cards = graph?.getState().cards ?? []
    if (!setViewport || !rect || cards.length === 0) return { candidateCount: 0, zoom }

    const sizeForCard = (card: { kind: string; size?: { width: number; height: number } }) => ({
      width: card.size?.width ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 320 : 260),
      height: card.size?.height ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 82 : 180),
    })
    const bounds = cards.map((card) => {
      const size = sizeForCard(card)
      return {
        minX: card.position.x,
        minY: card.position.y,
        maxX: card.position.x + size.width,
        maxY: card.position.y + size.height,
        centerX: card.position.x + size.width / 2,
        centerY: card.position.y + size.height / 2,
      }
    })
    const margin = detailCullMarginPx / zoom
    const halfWidth = rect.width / (2 * zoom) + margin
    const halfHeight = rect.height / (2 * zoom) + margin
    let best = bounds.reduce(
      (result, card) => ({
        centerX: result.centerX + card.centerX / bounds.length,
        centerY: result.centerY + card.centerY / bounds.length,
        candidateCount: result.candidateCount,
      }),
      { centerX: 0, centerY: 0, candidateCount: 0 },
    )

    for (const candidate of bounds) {
      const minX = candidate.centerX - halfWidth
      const maxX = candidate.centerX + halfWidth
      const minY = candidate.centerY - halfHeight
      const maxY = candidate.centerY + halfHeight
      const candidateCount = bounds.filter((card) =>
        card.maxX >= minX && card.minX <= maxX && card.maxY >= minY && card.minY <= maxY,
      ).length
      if (candidateCount > best.candidateCount) {
        best = {
          centerX: candidate.centerX,
          centerY: candidate.centerY,
          candidateCount,
        }
      }
    }

    setViewport({
      x: rect.left + rect.width / 2 - best.centerX * zoom,
      y: rect.top + rect.height / 2 - best.centerY * zoom,
      zoom,
    })
    return { candidateCount: best.candidateCount, zoom }
  }, {
    detailCullMarginPx: DETAIL_CULL_MARGIN_PX,
    // The old readable-detail viewport (threshold 0.18 + 0.08) — below
    // Reading, so the new policy mounts nothing here on any board.
    zoom: 0.26,
  })
}

async function zoomOutAtBoardCenter(page: Page, steps = 14) {
  const center = await boardCenter(page)
  await page.mouse.move(center.x, center.y)
  await page.keyboard.down('Control')
  try {
    for (let index = 0; index < steps; index += 1) {
      await page.mouse.wheel(0, 220)
      await page.waitForTimeout(16)
    }
  } finally {
    await page.keyboard.up('Control').catch(() => undefined)
  }
}

async function boardCenter(page: Page) {
  return page.evaluate(() => {
    const flow = document.querySelector('.react-flow')
    const rect = flow?.getBoundingClientRect()
    if (!rect) return { x: 720, y: 500 }
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  })
}

async function viewportTransform(page: Page) {
  return page.evaluate(() => {
    const viewportElement = document.querySelector('.react-flow__viewport')
    const transform = viewportElement ? getComputedStyle(viewportElement).transform : ''
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
    return {
      x: matrix?.e ?? 0,
      y: matrix?.f ?? 0,
      zoom: matrix?.a ?? 1,
    }
  })
}

async function emptyPanePoint(page: Page) {
  return page.evaluate(() => {
    const flow = document.querySelector('.react-flow')
    const rect = flow?.getBoundingClientRect()
    if (!rect) return { x: 720, y: 500 }
    const candidates = [
      { x: rect.left + rect.width - 96, y: rect.top + rect.height - 96 },
      { x: rect.left + 96, y: rect.top + rect.height - 96 },
      { x: rect.left + rect.width - 96, y: rect.top + 96 },
      { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 },
    ]
    for (const point of candidates) {
      const target = document.elementFromPoint(point.x, point.y)
      if (!target?.closest('.react-flow__node')) return point
    }
    return candidates[candidates.length - 1]
  })
}

async function setActiveTool(page: Page, tool: 'select' | 'pan' | 'highlight') {
  await page.evaluate((nextTool) => {
    const graph = (window as unknown as { __eido?: { getState: () => { setActiveTool: (tool: string) => void } } }).__eido
    graph?.getState().setActiveTool(nextTool)
  }, tool)
  await waitForFrames(page, 2)
}

async function overviewCardClickTarget(page: Page): Promise<{ cardId: string; x: number; y: number }> {
  return page.evaluate(() => {
    const graph = (window as unknown as {
      __eido?: {
        getState: () => {
          cards: Array<{
            id: string
            kind: string
            position: { x: number; y: number }
            size?: { width: number; height: number }
          }>
        }
      }
      __EIDO_OVERVIEW_CARD_IDS__?: Set<string>
    }).__eido
    const overviewCardIds = (window as unknown as { __EIDO_OVERVIEW_CARD_IDS__?: Set<string> }).__EIDO_OVERVIEW_CARD_IDS__
    const root = document.querySelector('.react-flow')
    const viewportElement = document.querySelector('.react-flow__viewport')
    if (!graph || !overviewCardIds || !root || !viewportElement) throw new Error('Missing overview selection runtime')

    const rootRect = root.getBoundingClientRect()
    const transform = getComputedStyle(viewportElement).transform
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
    const viewport = {
      x: matrix?.e ?? 0,
      y: matrix?.f ?? 0,
      zoom: matrix?.a ?? 1,
    }
    const renderedCardSize = (card: { kind: string; size?: { width: number; height: number } }) => ({
      width: card.size?.width ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 320 : 260),
      height: card.size?.height ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 82 : 180),
    })

    for (const card of graph.getState().cards) {
      if (!overviewCardIds.has(card.id)) continue
      const size = renderedCardSize(card)
      const x = rootRect.left + card.position.x * viewport.zoom + viewport.x + (size.width * viewport.zoom) / 2
      const y = rootRect.top + card.position.y * viewport.zoom + viewport.y + (size.height * viewport.zoom) / 2
      if (x < rootRect.left || x > rootRect.right || y < rootRect.top || y > rootRect.bottom) continue
      const target = document.elementFromPoint(x, y)
      if (target?.closest('.react-flow__node')) continue
      return { cardId: card.id, x, y }
    }

    throw new Error('No clickable overview-rendered card found')
  })
}

async function setViewportForBoardPoint(
  page: Page,
  { boardX, boardY, zoom }: { boardX: number; boardY: number; zoom: number },
) {
  await page.evaluate(({ boardX, boardY, zoom }) => {
    const flow = document.querySelector('.react-flow')
    const rect = flow?.getBoundingClientRect()
    const centerX = rect ? rect.left + rect.width / 2 : 720
    const centerY = rect ? rect.top + rect.height / 2 : 500
    const setViewport = (window as unknown as { __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void })
      .__EIDO_SET_VIEWPORT__
    if (!setViewport) throw new Error('Missing Eido viewport setter')
    setViewport({
      x: centerX - boardX * zoom,
      y: centerY - boardY * zoom,
      zoom,
    })
  }, { boardX, boardY, zoom })
  await waitForFrames(page, 4)
}

async function nodeDetailCounts(page: Page) {
  return page.evaluate(() => ({
    nodes: document.querySelectorAll('.react-flow__node').length,
    lowZoomNodes: document.querySelectorAll('.react-flow__node-lowZoom').length,
    fullDetailNodes:
      document.querySelectorAll('.react-flow__node').length -
      document.querySelectorAll('.react-flow__node-lowZoom').length,
    overviewCoversReactNodes:
      document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.coversReactNodes === 'true',
    overviewConnections:
      Number(document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedConnectionCount ?? 0),
    overviewConnectionBadges:
      Number(document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedConnectionBadgeCount ?? 0),
    overviewRepresentationCards:
      Number(document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.representationCount ?? 0),
    representedCards:
      document.querySelectorAll('.react-flow__node').length +
      Number(document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedCardCount ?? 0),
  }))
}

async function fullDetailNodeIds(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .filter((node) => !node.classList.contains('react-flow__node-lowZoom'))
      .map((node) => node.dataset.id)
      .filter((cardId): cardId is string => Boolean(cardId)),
  )
}

async function expectCanvasLodConnections(page: Page) {
  await page.waitForFunction(
    () =>
      Number(document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedConnectionCount ?? 0) +
        document.querySelectorAll('.react-flow__edge').length >
      0,
    { timeout: 10_000 },
  )
  const counts = await nodeDetailCounts(page)

  expect(counts.overviewConnections + (await page.locator('.react-flow__edge').count())).toBeGreaterThan(0)
}

async function expectCanvasLodDoesNotCoverReactCards(page: Page) {
  if ((await page.locator('[data-board-overview-layer]').count()) === 0) return
  const counts = await nodeDetailCounts(page)

  expect(counts.overviewCoversReactNodes).toBe(false)
}

async function waitForRepresentedCards(page: Page, minRepresentedCards: number) {
  await page.waitForFunction((minimum) => {
    const nodeCount = document.querySelectorAll('.react-flow__node').length
    const overviewCount = Number(document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedCardCount ?? 0)
    return nodeCount + overviewCount >= minimum
  }, minRepresentedCards, { timeout: 10_000 })
}

async function expectSettledDetailRecovery(
  page: Page,
  minRepresentedCards = 1,
  options: { requireFullDetail?: boolean } = {},
) {
  await page.waitForTimeout(260)
  await waitForFrames(page, 4)
  const counts = await nodeDetailCounts(page)

  expect(counts.representedCards).toBeGreaterThanOrEqual(minRepresentedCards)
  if (options.requireFullDetail !== false) expect(counts.fullDetailNodes).toBeGreaterThan(0)
  expect(counts.nodes).toBeLessThanOrEqual(MAX_SETTLED_NODES)
}

function expectNavigationBudget(navigation: NavigationResponsiveness) {
  expect(navigation.classification).toBe('target-met')
  expect(navigation.blankFrames).toBeLessThanOrEqual(MAX_BLANK_FRAMES)
  expect(navigation.minRepresentedCardRatio).toBeGreaterThanOrEqual(MIN_REPRESENTED_CARD_RATIO)
  expect(navigation.maxRepresentedCardDeficit).toBeLessThanOrEqual(MAX_REPRESENTED_CARD_DEFICIT)
  expect(navigation.maxMissingVisibleCardCount).toBeLessThanOrEqual(MAX_REPRESENTED_CARD_DEFICIT)
  expect(Math.max(navigation.maxExpectedNodeCount, navigation.maxNodeCount)).toBeGreaterThan(0)
  expect(navigation.averageFps).toBeGreaterThanOrEqual(MIN_SUSTAINED_NAVIGATION_FPS)
  expect(navigation.maxNodeCount).toBeLessThanOrEqual(MAX_NAVIGATION_NODES)
  expect(navigation.maxFullDetailNodeCount).toBeLessThanOrEqual(MAX_FULL_DETAIL_NAVIGATION_NODES)
}

function expectZoomWasExercised(navigation: NavigationResponsiveness) {
  expect(navigation.maxViewportZoom - navigation.minViewportZoom).toBeGreaterThanOrEqual(MIN_EXERCISED_ZOOM_RANGE)
}

function printNavigationReport(label: string, navigation: NavigationResponsiveness) {
  console.log(`\n${label}`)
  console.table([
    {
      classification: navigation.classification,
      frames: navigation.frames,
      durationMs: navigation.durationMs.toFixed(2),
      averageFps: navigation.averageFps.toFixed(2),
      sustainedFps: navigation.sustainedFps.toFixed(2),
      maxFrameGapMs: navigation.maxFrameGapMs.toFixed(2),
      p95FrameGapMs: navigation.p95FrameGapMs.toFixed(2),
      p99FrameGapMs: navigation.p99FrameGapMs.toFixed(2),
      blankFrames: navigation.blankFrames,
      emptyViewportFrames: navigation.emptyViewportFrames,
      minNodeCount: navigation.minNodeCount,
      maxNodeCount: navigation.maxNodeCount,
      minRepresentedCardCount: navigation.minRepresentedCardCount,
      maxRepresentedCardCount: navigation.maxRepresentedCardCount,
      minRepresentedCardRatio: navigation.minRepresentedCardRatio.toFixed(3),
      maxRepresentedCardDeficit: navigation.maxRepresentedCardDeficit,
      visibleRepresentationProbeCount: `${navigation.minVisibleRepresentationProbeCount}-${navigation.maxVisibleRepresentationProbeCount}`,
      representedVisibleCardCount: `${navigation.minRepresentedVisibleCardCount}-${navigation.maxRepresentedVisibleCardCount}`,
      maxMissingVisibleCardCount: navigation.maxMissingVisibleCardCount,
      visibleReactCardCount: `${navigation.minVisibleReactCardCount}-${navigation.maxVisibleReactCardCount}`,
      overviewRepresentedVisibleCardCount: `${navigation.minOverviewRepresentedVisibleCardCount}-${navigation.maxOverviewRepresentedVisibleCardCount}`,
      minFullDetailNodeCount: navigation.minFullDetailNodeCount,
      maxFullDetailNodeCount: navigation.maxFullDetailNodeCount,
      minLowZoomNodeCount: navigation.minLowZoomNodeCount,
      maxLowZoomNodeCount: navigation.maxLowZoomNodeCount,
      minExpectedVisibleCardCount: navigation.minExpectedVisibleCardCount,
      maxExpectedVisibleCardCount: navigation.maxExpectedVisibleCardCount,
      minExpectedNodeCount: navigation.minExpectedNodeCount,
      maxExpectedNodeCount: navigation.maxExpectedNodeCount,
      minViewportZoom: navigation.minViewportZoom.toFixed(3),
      maxViewportZoom: navigation.maxViewportZoom.toFixed(3),
      cadenceMs: navigation.cadenceMs.toFixed(2),
    },
  ])
}

function envNumber(name: string, fallback: number) {
  const value = Number(TEST_ENV.process?.env?.[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}
