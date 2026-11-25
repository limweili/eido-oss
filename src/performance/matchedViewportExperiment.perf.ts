import { expect, test } from '@playwright/test'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'

// Matched-viewport discriminating experiment (PR #338, review finding 2).
//
// The contested claim: the large-baseline fps red on the mount-collapse
// branch is trajectory divergence (the capture wanders to low zooms where
// the sampler's forced overview draw dominates), not a real interactive
// regression. This harness settles it with data:
//
//   record mode — run the standard large-baseline navigation choreography
//   while recording the viewport (x, y, zoom) every animation frame, and
//   write the waypoint series to a JSON file.
//
//   replay mode — drive the viewport through a recorded waypoint series
//   (no mouse/wheel input at all) while the standard captureNavigation
//   sampler measures, so BOTH arms visit exactly the same viewports with
//   exactly the same sampler. If branch fps ≈ main fps at matched
//   viewports, the red is a gate artifact; if the branch is materially
//   slower on the same waypoints, the collapse carries a real cost.
//
// Capture-only: set EIDO_MATCHED_VIEWPORT=record|replay and
// EIDO_WAYPOINTS_FILE=<path>. Never runs in CI or default perf runs.

type Waypoint = { t: number; x: number; y: number; zoom: number }

const TEST_ENV = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const MODE = TEST_ENV.process?.env?.EIDO_MATCHED_VIEWPORT
const WAYPOINTS_FILE = TEST_ENV.process?.env?.EIDO_WAYPOINTS_FILE
const NAVIGATION_MS = 8_000
// These choreography constants DUPLICATE the standard large-baseline capture
// (browserInteraction.perf.ts `measureNavigationResponsiveness`) and E1's
// `captureStandardNavigation` in git history — deliberately, so this harness
// stays self-contained under route/checkout swaps. If the baseline
// choreography ever changes, change these in lockstep or the recorded
// trajectory stops representing the gate being diagnosed.
const NAVIGATION_STEP_MS = 29
const ZOOM_STEP_INTERVAL = 18
const ZOOM_WHEEL_DELTA = 80

// Every run leaves a small committed-evidence artifact next to the waypoint
// file (commit, mode, rows), so an interleave can be reconstructed from
// artifacts instead of PR prose.
function writeRunArtifact(mode: string, waypointCount: number, result: Record<string, unknown>) {
  const capturedFromCommit = execSync('git rev-parse --short HEAD').toString().trim()
  const artifactFile = `${WAYPOINTS_FILE}.${mode}-${capturedFromCommit}-${Date.now()}.result.json`
  writeFileSync(
    artifactFile,
    `${JSON.stringify(
      { capturedFromCommit, mode, capturedAt: new Date().toISOString(), waypointsFile: WAYPOINTS_FILE, waypointCount, result },
      null,
      2,
    )}\n`,
  )
  console.log(`Run artifact written to ${artifactFile}`)
}

test('matched viewport experiment', async ({ page }) => {
  test.setTimeout(240_000)
  test.skip(MODE !== 'record' && MODE !== 'replay', 'capture-only; set EIDO_MATCHED_VIEWPORT=record|replay')
  if (!WAYPOINTS_FILE) throw new Error('Set EIDO_WAYPOINTS_FILE')

  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean(window.__EIDO_SET_VIEWPORT__))
  const loaded = await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('large'))
  expect(loaded).toMatchObject({ cards: 5_000 })
  await page.waitForFunction(() => {
    const nodes = document.querySelectorAll('.react-flow__node').length
    const painted = Number(
      document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedCardCount ?? 0,
    )
    return nodes + painted > 0
  })
  // Match the baseline test's pre-capture step.
  await page.mouse.move(720, 500)
  await page.mouse.wheel(0, -600)
  await page.evaluate(async () => {
    for (let index = 0; index < 4; index += 1) {
      await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
    }
  })

  if (MODE === 'record') {
    await page.evaluate(() => {
      const waypoints: Waypoint[] = []
      const recorder = { waypoints, raf: 0, start: performance.now() }
      ;(window as unknown as { __WAYPOINT_RECORDER__: typeof recorder }).__WAYPOINT_RECORDER__ = recorder
      const step = () => {
        const viewportElement = document.querySelector<HTMLElement>('.react-flow__viewport')
        const transform = viewportElement ? getComputedStyle(viewportElement).transform : 'none'
        const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
        if (matrix) {
          waypoints.push({ t: performance.now() - recorder.start, x: matrix.e, y: matrix.f, zoom: matrix.a })
        }
        recorder.raf = requestAnimationFrame(step)
      }
      recorder.raf = requestAnimationFrame(step)
    })

    const samplePromise = page.evaluate(async (durationMs) => {
      const result = await window.__EIDO_PERF__?.captureNavigation({
        fixture: 'large',
        label: 'matched-viewport-record',
        durationMs,
      })
      if (!result) throw new Error('Missing browser performance runtime')
      return result
    }, NAVIGATION_MS)

    // The EXACT standard choreography from the large-baseline capture.
    const steps = Math.ceil(NAVIGATION_MS / NAVIGATION_STEP_MS)
    try {
      for (let index = 0; index < steps; index += 1) {
        if (index % ZOOM_STEP_INTERVAL === 0) {
          await page.keyboard.down('Control')
          await page.mouse.wheel(0, index % (ZOOM_STEP_INTERVAL * 2) === 0 ? -ZOOM_WHEEL_DELTA : ZOOM_WHEEL_DELTA)
          await page.keyboard.up('Control')
        } else {
          await page.mouse.wheel(index % 4 < 2 ? 32 : -32, index % 2 === 0 ? -160 : 160)
        }
        await page.waitForTimeout(24)
      }
    } finally {
      await page.keyboard.up('Control').catch(() => undefined)
    }

    const result = await samplePromise
    const waypoints = await page.evaluate(() => {
      const recorder = (window as unknown as { __WAYPOINT_RECORDER__?: { waypoints: Waypoint[]; raf: number } })
        .__WAYPOINT_RECORDER__
      if (!recorder) throw new Error('Missing waypoint recorder')
      cancelAnimationFrame(recorder.raf)
      return recorder.waypoints
    })
    writeFileSync(WAYPOINTS_FILE, JSON.stringify({ recordedClassification: result.classification, waypoints }))
    console.log(
      `RECORDED ${waypoints.length} waypoints -> ${WAYPOINTS_FILE}; classification=${result.classification} ` +
        `avgFps=${result.averageFps.toFixed(2)} sustained=${result.sustainedFps.toFixed(2)} ` +
        `zoom=${result.minViewportZoom.toFixed(3)}-${result.maxViewportZoom.toFixed(3)}`,
    )
    writeRunArtifact('record', waypoints.length, result as unknown as Record<string, unknown>)
    return
  }

  const { waypoints } = JSON.parse(readFileSync(WAYPOINTS_FILE, 'utf8')) as { waypoints: Waypoint[] }
  expect(waypoints.length).toBeGreaterThan(100)

  const samplePromise = page.evaluate(async (durationMs) => {
    const result = await window.__EIDO_PERF__?.captureNavigation({
      fixture: 'large',
      label: 'matched-viewport-replay',
      durationMs,
    })
    if (!result) throw new Error('Missing browser performance runtime')
    return result
  }, NAVIGATION_MS)

  await page.evaluate(
    async ({ waypoints, durationMs }) => {
      const setViewport = window.__EIDO_SET_VIEWPORT__
      if (!setViewport) throw new Error('Missing viewport setter')
      const start = performance.now()
      let index = 0
      await new Promise<void>((resolve) => {
        const step = () => {
          const elapsed = performance.now() - start
          while (index < waypoints.length - 1 && waypoints[index + 1].t <= elapsed) index += 1
          const waypoint = waypoints[index]
          setViewport({ x: waypoint.x, y: waypoint.y, zoom: waypoint.zoom })
          if (elapsed >= durationMs) {
            resolve()
            return
          }
          requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      })
    },
    { waypoints, durationMs: NAVIGATION_MS },
  )

  const result = await samplePromise
  console.log(
    `REPLAY classification=${result.classification} avgFps=${result.averageFps.toFixed(2)} ` +
      `sustained=${result.sustainedFps.toFixed(2)} p95gap=${result.p95FrameGapMs.toFixed(2)} ` +
      `maxGap=${result.maxFrameGapMs.toFixed(2)} blank=${result.blankFrames} ` +
      `ratio=${result.minRepresentedCardRatio.toFixed(3)} deficit=${result.maxRepresentedCardDeficit} ` +
      `zoom=${result.minViewportZoom.toFixed(3)}-${result.maxViewportZoom.toFixed(3)} ` +
      `nodes=${result.minNodeCount}-${result.maxNodeCount}`,
  )
  writeRunArtifact('replay', waypoints.length, result as unknown as Record<string, unknown>)
})
