import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'

// #213: dragging must stay smooth on machines whose mice deliver 4-10x more
// pointer events per frame than the display can show (high-polling-rate mice
// on Windows). The storm below replays that delivery pattern — a real
// mousedown followed by ~500 Hz of synthetic window mousemove events, the
// listener target d3-drag actually uses mid-gesture — against a 60-card board
// and measures what the drag path does per second.
//
// Two run modes share one measurement:
//   EIDO_DRAG_PERF_CAPTURE=1  writes the baseline JSON artifact (no gate).
//   default                   gates against the committed baseline:
//                             commits/sec ≤ display refresh (frame-batched)
//                             and long frames strictly below the baseline.

const STORM_MS = 2_000
const STORM_HZ = 500
// A long frame blows the 60 Hz budget by half a frame or more: per-pointer-
// event drag work shows up as a wall of 20-35 ms frames, not isolated
// 50 ms+ stalls, so the threshold sits just above one vsync period.
const LONG_FRAME_MS = 25
const BOARD_CARDS = 60
const VIEWPORT_ZOOM = 0.8
const TEST_ENV = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const CAPTURE_BASELINE = Boolean(TEST_ENV.process?.env?.EIDO_DRAG_PERF_CAPTURE)
const BASELINE_FILE = join('src', 'performance', 'baselines', 'dragEventStorm.baseline.json')

type StormMetrics = {
  eventsDispatched: number
  durationMs: number
  commits: number
  commitsPerSec: number
  frames: number
  framesPerSec: number
  longFrames: number
  maxFrameGapMs: number
  p95FrameGapMs: number
}

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    boardChangeSeq: number
    cards: Array<{ id: string; position: { x: number; y: number } }>
  }
  setState: (state: unknown) => void
}

async function seedStormBoard(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => {
    const devWindow = window as unknown as {
      __eido?: EidoDevStore
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    return Boolean(devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  await page.evaluate(
    ({ cardCount, zoom }) => {
      const devWindow = window as unknown as {
        __eido: EidoDevStore
        __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
      }
      const cards = Array.from({ length: cardCount }, (_, index) => ({
        id: `storm-note-${index}`,
        kind: 'note',
        blocks: [{ id: `storm-note-${index}-block`, text: `storm note ${index}` }],
        position: { x: 80 + (index % 6) * 300, y: 80 + Math.floor(index / 6) * 240 },
        zIndex: index === 0 ? 200 : 1 + index,
      }))

      devWindow.__eido.setState({
        cards,
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
      devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom })
    },
    { cardCount: BOARD_CARDS, zoom: VIEWPORT_ZOOM },
  )

  // Below Reading nothing mounts (ADR 0020) and the deferred fitView fires on
  // the first mount, so pin the Reading viewport again after a settle window
  // — otherwise fitView drops the zoom below Reading and unmounts the board.
  await page.waitForTimeout(300)
  await page.evaluate((zoom) => {
    const devWindow = window as unknown as {
      __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
    }
    devWindow.__EIDO_SET_VIEWPORT__?.({ x: 0, y: 0, zoom })
  }, VIEWPORT_ZOOM)

  const node = page.locator('.react-flow__node[data-id="storm-note-0"]')
  await node.waitFor({ state: 'visible' })
  // Let the detail aperture and navigation idle window settle so the gesture
  // starts from a settled scene, as a user's would.
  await page.waitForTimeout(500)
}

// The card head's padding is a draggable surface (its buttons are nodrag).
async function headDragPoint(page: Page, id: string) {
  const head = page.locator(`.react-flow__node[data-id="${id}"] .card-head`)
  const box = await head.boundingBox()
  if (!box) throw new Error('Missing card head')
  return { x: box.x + box.width / 2, y: box.y + 3 }
}

async function measureIdleRefreshHz(page: Page) {
  return page.evaluate(async () => {
    const gaps: number[] = []
    let last = await new Promise<number>((resolve) => requestAnimationFrame(resolve))
    while (gaps.length < 60) {
      const t = await new Promise<number>((resolve) => requestAnimationFrame(resolve))
      gaps.push(t - last)
      last = t
    }
    const sorted = [...gaps].sort((a, b) => a - b)
    const median = sorted[Math.floor(sorted.length / 2)]
    return 1000 / median
  })
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

test('card drag under a 500 Hz pointer-event storm', async ({ page }) => {
  await seedStormBoard(page)
  const refreshHz = await measureIdleRefreshHz(page)

  const startX = await nodeTranslateX(page, 'storm-note-0')
  const from = await headDragPoint(page, 'storm-note-0')

  // Real gesture start so React Flow arms its window mousemove listener; the
  // storm itself is dispatched in-page because CDP cannot reach 500 Hz.
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()

  const metrics = await page.evaluate(
    async ({ stormMs, stormHz, longFrameMs, from }) => {
      const devWindow = window as unknown as { __eido: EidoDevStore }
      const seqStart = devWindow.__eido.getState().boardChangeSeq

      const frameTimes: number[] = []
      let rafId = 0
      const pump = (t: number) => {
        frameTimes.push(t)
        rafId = requestAnimationFrame(pump)
      }
      rafId = requestAnimationFrame(pump)

      // Cumulative-target pacing: each (clamped) timer tick dispatches however
      // many events restore the 500 Hz schedule, so events arrive in small
      // bursts between frames — exactly how a high-polling-rate mouse queues
      // input against a busy main thread.
      const start = performance.now()
      let dispatched = 0
      await new Promise<void>((resolve) => {
        const tick = () => {
          const elapsed = performance.now() - start
          const target = Math.floor((Math.min(elapsed, stormMs) * stormHz) / 1000)
          while (dispatched < target) {
            dispatched += 1
            window.dispatchEvent(
              new MouseEvent('mousemove', {
                bubbles: true,
                cancelable: true,
                view: window,
                buttons: 1,
                clientX: from.x + dispatched * 0.3,
                clientY: from.y + dispatched * 0.1,
              }),
            )
          }
          if (elapsed >= stormMs) {
            resolve()
            return
          }
          setTimeout(tick, 1)
        }
        tick()
      })
      const durationMs = performance.now() - start
      cancelAnimationFrame(rafId)

      const commits = devWindow.__eido.getState().boardChangeSeq - seqStart
      const gaps = frameTimes.slice(1).map((t, i) => t - frameTimes[i])
      const sortedGaps = [...gaps].sort((a, b) => a - b)
      return {
        eventsDispatched: dispatched,
        durationMs,
        commits,
        commitsPerSec: (commits / durationMs) * 1000,
        frames: frameTimes.length,
        framesPerSec: (frameTimes.length / durationMs) * 1000,
        longFrames: gaps.filter((gap) => gap > longFrameMs).length,
        maxFrameGapMs: Math.max(0, ...gaps),
        p95FrameGapMs: sortedGaps[Math.floor(sortedGaps.length * 0.95)] ?? 0,
      } satisfies StormMetrics
    },
    { stormMs: STORM_MS, stormHz: STORM_HZ, longFrameMs: LONG_FRAME_MS, from },
  )

  await page.mouse.up()

  // The storm must have actually dragged the card, or the numbers measure an
  // idle board rather than the drag path.
  const travelled = (await nodeTranslateX(page, 'storm-note-0')) - startX
  expect(travelled).toBeGreaterThan(150)
  expect(metrics.eventsDispatched).toBeGreaterThan(STORM_MS * STORM_HZ * 0.9 / 1000)
  expect(metrics.commits).toBeGreaterThan(10)

  console.log('\nDrag event-storm report')
  console.table([
    {
      events: metrics.eventsDispatched,
      commits: metrics.commits,
      commitsPerSec: metrics.commitsPerSec.toFixed(1),
      frames: metrics.frames,
      framesPerSec: metrics.framesPerSec.toFixed(1),
      longFrames: metrics.longFrames,
      maxFrameGapMs: metrics.maxFrameGapMs.toFixed(1),
      p95FrameGapMs: metrics.p95FrameGapMs.toFixed(1),
      refreshHz: refreshHz.toFixed(1),
      nodeTravelPx: travelled.toFixed(0),
    },
  ])

  if (CAPTURE_BASELINE) {
    const capturedFromCommit = execSync('git rev-parse --short HEAD').toString().trim()
    mkdirSync(dirname(BASELINE_FILE), { recursive: true })
    writeFileSync(
      BASELINE_FILE,
      `${JSON.stringify(
        {
          name: 'drag-event-storm',
          capturedFromCommit,
          capturedAt: new Date().toISOString(),
          config: {
            stormMs: STORM_MS,
            stormHz: STORM_HZ,
            longFrameMs: LONG_FRAME_MS,
            boardCards: BOARD_CARDS,
            viewportZoom: VIEWPORT_ZOOM,
          },
          refreshHz,
          metrics,
        },
        null,
        2,
      )}\n`,
    )
    console.log(`Baseline written to ${BASELINE_FILE} (captured from ${capturedFromCommit})`)
    return
  }

  if (!existsSync(BASELINE_FILE)) {
    throw new Error(`Missing committed baseline ${BASELINE_FILE} — run with EIDO_DRAG_PERF_CAPTURE=1 first`)
  }
  const baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as { metrics: StormMetrics }

  // The #213 gate: drag work is frame-batched (one store commit per rendered
  // frame at most) and the storm produces strictly fewer long frames than the
  // committed per-pointer-event baseline.
  expect(metrics.commitsPerSec).toBeLessThanOrEqual(refreshHz * 1.1)
  expect(metrics.longFrames).toBeLessThan(baseline.metrics.longFrames)
})
