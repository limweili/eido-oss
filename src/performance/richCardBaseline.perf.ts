import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRichCardBenchmarkBoard, FOUNDER_LONG_NOTE_FIXTURE } from '../graph/perfFixtures'
import {
  RICH_CARD_BENCHMARK_CONTRACT,
  RICH_CARD_CHOREOGRAPHY_PROBE,
  RICH_CARD_FOUNDER_SCENARIO,
  RICH_CARD_IMAGE_INGESTION_UNAVAILABLE_METHOD,
  assertRichCardRawArtifact,
  benchmarkPercentile,
  deriveFrameIntervalsFromRafTimestamps,
  probeRichCardSelection,
  roundBenchmarkMetric,
  type RichCardRawArtifact,
  type RichCardProbeScenarioId,
  type RichCardRun,
  type RichCardScenarioId,
} from './richCardBenchmark'
import { activateAndRequireExactReadyMarkdownEditor } from './richCardEditorReadiness'

const ARTIFACT_PATH =
  process.env.EIDO_RICH_CARD_ARTIFACT ?? 'src/performance/baselines/richCardBaseline.raw.json'
const EXPECTED_CARDS = 131
const READING_ZOOM = 0.5
const RAW_RUNNER_MODE = process.env.EIDO_RICH_CARD_MODE
if (
  RAW_RUNNER_MODE &&
  RAW_RUNNER_MODE !== 'capture' &&
  RAW_RUNNER_MODE !== 'probe' &&
  RAW_RUNNER_MODE !== 'correctness'
) {
  throw new Error(`Unknown EIDO_RICH_CARD_MODE: ${RAW_RUNNER_MODE}`)
}
const RUNNER_MODE = RAW_RUNNER_MODE ?? 'capture'
const FOUNDER_PROBE = process.env.EIDO_RICH_CARD_PROBE_SCENARIO === RICH_CARD_FOUNDER_SCENARIO.id
if (process.env.EIDO_RICH_CARD_PROBE_SCENARIO && !FOUNDER_PROBE) {
  throw new Error(`Unknown EIDO_RICH_CARD_PROBE_SCENARIO: ${process.env.EIDO_RICH_CARD_PROBE_SCENARIO}`)
}
if (FOUNDER_PROBE && RUNNER_MODE !== 'probe') {
  throw new Error('The founder long-Note scenario is available only in probe mode.')
}

type PageProbe = {
  frameTimestampsMs: number[]
  residentDom: { min: number; max: number }
  blankBoardFrames: number
  missingRepresentationFrames: number
  longTasks: Array<{ startTime: number; duration: number }>
}

type ScenarioResult = {
  interactionLatencyMs?: number
  decodedCount?: number
  decodeMs?: number
  settledImageReadyMs?: number
  detailedReadyMs?: number
  lightweightReadyMs?: number
}

const percentile = benchmarkPercentile
const round = roundBenchmarkMetric

test(`${RUNNER_MODE === 'capture' ? 'capture repeated' : RUNNER_MODE} candidate-neutral rich Card Reading baseline`, async ({ page, browser }) => {
  test.setTimeout((RUNNER_MODE === 'probe' ? 12 : 20) * 60_000)
  await installLongTaskObserver(page)
  await page.goto('/')
  await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean((window as { __eido?: unknown }).__eido))

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const fixture = measureFixture()
  expect(fixture.cards).toBe(EXPECTED_CARDS)

  if (RUNNER_MODE === 'correctness') {
    await prepareScenario(page, cdp, 'ordinary-reading-pan')
    const correctness = await measureCorrectness(page, cdp)
    expect(correctness).toMatchObject({
      search: { status: 'observed', found: true },
      selection: { status: 'observed' },
    })
    return
  }

  if (RUNNER_MODE === 'probe') {
    console.log('NON-EVIDENCE choreography probe: one bounded repetition of every frozen scenario; no baseline artifact will be written.')
    const scenarios: readonly { id: RichCardProbeScenarioId }[] = FOUNDER_PROBE
      ? [RICH_CARD_FOUNDER_SCENARIO]
      : RICH_CARD_BENCHMARK_CONTRACT.scenarios
    for (const scenario of scenarios) {
      console.log(`Probing ${scenario.id}`)
      await boundedProbeStep(`${scenario.id}: prepare`, () => prepareScenario(page, cdp, scenario.id))
      await boundedProbeStep(
        `${scenario.id}: choreography`,
        async () => {
          if (scenario.id === RICH_CARD_FOUNDER_SCENARIO.id) {
            await probeFounderScenarioStructure(page, cdp)
            return
          }
          await performScenario(page, cdp, scenario.id, 1)
        },
      )
    }
    console.log(`NON-EVIDENCE choreography probe passed ${scenarios.length} scenario(s).`)
    return
  }

  const runs: RichCardRun[] = []
  for (const scenario of RICH_CARD_BENCHMARK_CONTRACT.scenarios) {
    for (let repetition = 1; repetition <= RICH_CARD_BENCHMARK_CONTRACT.repetitionPolicy.repetitions; repetition += 1) {
      console.log(`Capturing ${scenario.id} repetition ${repetition}`)
      runs.push(await captureScenario(page, cdp, scenario.id, repetition))
    }
  }

  const correctness = await measureCorrectness(page, cdp)
  const browserVersion = browser.version()
  const sourceRunUrl = githubRunUrl()
  const artifact: RichCardRawArtifact = {
    schemaVersion: 2,
    contractId: RICH_CARD_BENCHMARK_CONTRACT.id,
    candidate: {
      id: 'current-reading-baseline',
      description: 'Unmodified production renderer, LOD, occupancy, settle, and interaction policy.',
    },
    environment: {
      provider: process.env.GITHUB_ACTIONS === 'true' ? 'github-actions' : 'local-unmanaged',
      os: `${os.platform()} ${os.release()}`,
      cpu: os.cpus()[0]?.model ?? 'unknown',
      logicalCores: os.cpus().length,
      memoryBytes: os.totalmem(),
      browser: `Chromium ${browserVersion}`,
      viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
      node: process.version,
      commit: execSync('git rev-parse HEAD').toString().trim(),
      capturedAt: new Date().toISOString(),
    },
    capture: {
      commands: ['npm run perf:rich-card:capture'],
      runner: process.env.RUNNER_NAME ?? 'unmanaged-local-runner',
      ...(sourceRunUrl ? { sourceRunUrl } : {}),
    },
    noise: {
      sharedRunner: process.env.GITHUB_ACTIONS === 'true',
      caveats: [
        'GitHub-hosted runners are shared and not a stable same-machine timing gate; three repetitions expose spread but do not remove host noise.',
        'Chromium headless paint/composite behavior and software/GPU availability can differ from the managed Mac product environment.',
        'The harness records observed JS heap and trace events; it cannot observe GPU texture residency or production React work without new instrumentation.',
      ],
    },
    repetitionPolicy: RICH_CARD_BENCHMARK_CONTRACT.repetitionPolicy,
    fixture,
    correctness,
    runs,
    trace: {
      source: 'chromium-cdp-devtools.timeline',
      totalStyleLayoutMs: round(runs.reduce((total, run) => total + (run.styleLayoutMs ?? 0), 0)),
      totalPaintCompositeMs: round(runs.reduce((total, run) => total + (run.paintCompositeMs ?? 0), 0)),
    },
  }

  assertRichCardRawArtifact(artifact)
  mkdirSync(path.dirname(ARTIFACT_PATH), { recursive: true })
  writeFileSync(ARTIFACT_PATH, `${JSON.stringify(artifact, null, 2)}\n`)

  console.log(`Rich Card raw artifact: ${ARTIFACT_PATH}`)
  console.table(
    runs.map((run) => ({
      scenario: run.scenarioId,
      repetition: run.repetition,
      durationMs: run.durationMs,
      p95FrameMs: percentile(run.frameIntervalsMs, 0.95),
      slowFrames: run.slowFrames,
      longTasks: run.longTasks.length,
      residentDom: `${run.residentDom.min}-${run.residentDom.max}`,
      styleLayoutMs: run.styleLayoutMs,
      paintCompositeMs: run.paintCompositeMs,
      blank: run.readiness.blankBoardFrames,
      missing: run.readiness.missingRepresentationFrames,
    })),
  )

  expect(runs).toHaveLength(RICH_CARD_BENCHMARK_CONTRACT.scenarios.length * 3)
  expect(runs.every((run) => run.residentDom.max > 0)).toBe(true)
})

async function probeFounderScenarioStructure(page: Page, cdp: CDPSession) {
  await beginProbe(page, FOUNDER_LONG_NOTE_FIXTURE.cardCount)
  await page.evaluate(() => window.__EIDO_PERF__?.resetBoardScenePerfCounters())
  await performScenario(page, cdp, RICH_CARD_FOUNDER_SCENARIO.id, 1)
  const boardWork = await page.evaluate(() => {
    const counters = window.__EIDO_PERF__?.boardScenePerfCounters()
    return {
      sceneDerivations: counters?.sceneDerivations ?? 0,
      cardMetricVisits: counters?.cardMetricVisits ?? 0,
    }
  })
  const transition = await endProbe(page)

  expect(boardWork.sceneDerivations).toBeGreaterThan(0)
  expect(boardWork.cardMetricVisits).toBe(0)
  expect(transition.blankBoardFrames).toBe(0)
  expect(transition.missingRepresentationFrames).toBe(0)
  expect(transition.residentDom.max).toBeLessThanOrEqual(
    FOUNDER_LONG_NOTE_FIXTURE.cardCount,
  )

  await beginProbe(page, FOUNDER_LONG_NOTE_FIXTURE.cardCount)
  await waitForFrames(page, 4)
  const settled = await endProbe(page)

  expect(settled.residentDom.max).toBeGreaterThan(0)
  expect(settled.residentDom.max).toBeLessThanOrEqual(
    FOUNDER_LONG_NOTE_FIXTURE.cardCount,
  )
  expect(settled.residentDom.min).toBe(settled.residentDom.max)

  const atRestOwners = await page.evaluate((expectedCards) => {
    const graph = (window as unknown as {
      __eido?: { getState: () => { cards: Array<{ id: string }> } }
    }).__eido
    const ownerSnapshot = window.__EIDO_CARD_ACTIVATION_OWNER_SNAPSHOT__
    const cards =
      graph?.getState().cards.filter((card) => card.id.startsWith('founder-long-note-')) ?? []

    if (!ownerSnapshot || cards.length !== expectedCards) return null

    const ownerCounts = cards.map((card) => ownerSnapshot(card.id).ownerTokens.length)
    return {
      cards: cards.length,
      maxOwnerTokens: Math.max(0, ...ownerCounts),
      totalOwnerTokens: ownerCounts.reduce((total, count) => total + count, 0),
    }
  }, FOUNDER_LONG_NOTE_FIXTURE.cardCount)

  expect(atRestOwners).toEqual({
    cards: FOUNDER_LONG_NOTE_FIXTURE.cardCount,
    maxOwnerTokens: 0,
    totalOwnerTokens: 0,
  })
}

async function boundedProbeStep<T>(label: string, action: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      action(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`NON-EVIDENCE choreography probe timed out at ${label}`)),
          RICH_CARD_CHOREOGRAPHY_PROBE.stepTimeoutMs,
        )
      }),
    ])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}

function measureFixture(): RichCardRawArtifact['fixture'] {
  const generationStart = performance.now()
  const board = createRichCardBenchmarkBoard()
  const generationMs = performance.now() - generationStart
  const serializationStart = performance.now()
  const serialized = JSON.stringify(board)
  const serializationMs = performance.now() - serializationStart
  const images = board.cards.flatMap((card) => card.assets ?? []).filter((asset) => asset.kind === 'image')
  return {
    id: RICH_CARD_BENCHMARK_CONTRACT.fixtureId,
    generationMs: round(generationMs),
    cards: board.cards.length,
    connections: board.connections.length,
    outputs: board.outputs.length,
    boardJsonBytes: new TextEncoder().encode(serialized).byteLength,
    serializationMs: round(serializationMs),
    storedImageBytes: images.reduce((total, image) => total + image.size, 0),
    decodedPixelEstimateBytes: images.reduce(
      (total, image) => total + (image.width ?? 0) * (image.height ?? 0) * 4,
      0,
    ),
    imageIngestion: {
      status: 'unavailable',
      value: null,
      method: RICH_CARD_IMAGE_INGESTION_UNAVAILABLE_METHOD,
    },
  }
}

async function captureScenario(
  page: Page,
  cdp: CDPSession,
  scenarioId: RichCardScenarioId,
  repetition: number,
): Promise<RichCardRun> {
  const readiness = await prepareScenario(page, cdp, scenarioId)
  await page.evaluate(() => window.__EIDO_PERF__?.resetBoardScenePerfCounters())
  const beforeMetrics = await performanceMetrics(cdp)
  await beginProbe(page, EXPECTED_CARDS)
  const trace = await beginTrace(cdp)
  const startedAt = performance.now()
  const result = await performScenario(page, cdp, scenarioId, repetition)
  await waitForFrames(page, 4)
  const durationMs = performance.now() - startedAt
  const traceEvents = await trace.stop()
  const probe = await endProbe(page)
  const afterMetrics = await performanceMetrics(cdp)
  const boardWork = await page.evaluate(() => {
    const counters = window.__EIDO_PERF__?.boardScenePerfCounters()
    return {
      sceneDerivations: counters?.sceneDerivations ?? 0,
      cardMetricVisits: counters?.cardMetricVisits ?? 0,
    }
  })
  const paintCompositeMs = traceDurationMs(traceEvents, ['Paint', 'CompositeLayers'])
  const styleLayoutMs = metricDelta(beforeMetrics, afterMetrics, ['LayoutDuration', 'RecalcStyleDuration'])
  const beforeHeap = beforeMetrics.JSHeapUsedSize ?? null
  const afterHeap = afterMetrics.JSHeapUsedSize ?? null
  const frameIntervalsMs = deriveFrameIntervalsFromRafTimestamps(probe.frameTimestampsMs)
  const slowFrames = frameIntervalsMs.filter((interval) => interval > 20).length
  const missedFrames = frameIntervalsMs.reduce(
    (total, interval) => total + Math.max(0, Math.floor(interval / (1000 / 60)) - 1),
    0,
  )

  return {
    scenarioId,
    repetition,
    durationMs: round(durationMs),
    frameIntervalsMs,
    missedFrames,
    slowFrames,
    longTasks: probe.longTasks.map((task) => ({ startTime: round(task.startTime), duration: round(task.duration) })),
    interactionLatencyMs: result.interactionLatencyMs === undefined ? null : round(result.interactionLatencyMs),
    residentDom: probe.residentDom,
    styleLayoutMs: round(styleLayoutMs),
    paintCompositeMs: round(paintCompositeMs),
    reactWork: {
      status: 'unavailable',
      reason: 'The production root exposes no React Profiler timing and forbidden Card/renderer instrumentation was not added.',
      followUp:
        'Add a benchmark-only Profiler at the application root or a React-supported performance track, then populate the existing reactWork field without changing this schema or renderer policy.',
    },
    memory: {
      beforeBytes: beforeHeap,
      afterBytes: afterHeap,
      supported: beforeHeap !== null && afterHeap !== null,
      scope: 'Chromium JSHeapUsedSize; excludes DOM native memory, decoded image pixels, compositor surfaces, and GPU textures.',
    },
    readiness: {
      blankBoardFrames: probe.blankBoardFrames,
      missingRepresentationFrames: probe.missingRepresentationFrames,
      detailedReadyMs: result.detailedReadyMs ?? readiness.detailedReadyMs,
      lightweightReadyMs: result.lightweightReadyMs ?? readiness.lightweightReadyMs,
      settledImageReadyMs: result.settledImageReadyMs ?? null,
    },
    boardWork,
    images: {
      decodedCount: result.decodedCount ?? 0,
      decodeMs: result.decodeMs ?? null,
      cacheGrowthBytes: null,
    },
  }
}

async function prepareScenario(page: Page, cdp: CDPSession, scenarioId: RichCardProbeScenarioId) {
  if (scenarioId === RICH_CARD_FOUNDER_SCENARIO.id) {
    const loaded = await page.evaluate(
      (fixtureName) => window.__EIDO_PERF__?.loadFixture(fixtureName),
      FOUNDER_LONG_NOTE_FIXTURE.name,
    )
    expect(loaded).toMatchObject({ cards: FOUNDER_LONG_NOTE_FIXTURE.cardCount, connections: 0, outputs: 0 })
    await page.waitForFunction(
      () =>
        document.querySelectorAll('.react-flow__node').length > 0 ||
        Number(document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedCardCount ?? 0) > 0,
      undefined,
      { timeout: 60_000 },
    )
    await setActiveTool(page, 'select')
    await resetScenarioSelection(page)
    await setViewportForBoardPoint(page, {
      boardX: FOUNDER_LONG_NOTE_FIXTURE.readingViewport.boardCenter.x,
      boardY: FOUNDER_LONG_NOTE_FIXTURE.readingViewport.boardCenter.y,
      zoom: 0.24,
    })
    await waitForVisibleRepresentation(page)
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 0)
    return { lightweightReadyMs: null, detailedReadyMs: null }
  }

  const imageScenario = scenarioId === 'cold-image-traversal' || scenarioId === 'warm-image-revisit'
  if (scenarioId === 'cold-image-traversal') {
    await cdp.send('Network.enable')
    await cdp.send('Network.clearBrowserCache')
    await page.reload()
    await page.waitForFunction(() => Boolean(window.__EIDO_PERF__) && Boolean((window as { __eido?: unknown }).__eido))
  }
  const loadStart = performance.now()
  const loaded = await page.evaluate(() => window.__EIDO_PERF__?.loadFixture('richCardBenchmark'))
  expect(loaded).toMatchObject({ cards: EXPECTED_CARDS, outputs: 2 })
  await page.waitForFunction(
    () =>
      document.querySelectorAll('.react-flow__node').length > 0 ||
      Number(document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedCardCount ?? 0) > 0,
    undefined,
    { timeout: 60_000 },
  )
  await setActiveTool(page, 'select')
  await resetScenarioSelection(page)

  const target = ['dragging', 'connecting'].includes(scenarioId)
    ? { boardX: 2_620, boardY: 180, zoom: 0.7 }
    : imageScenario
      ? { boardX: 800, boardY: 2_350, zoom: 0.24 }
      : { boardX: 380, boardY: 450, zoom: READING_ZOOM }
  const detailStart = performance.now()
  await setViewportForBoardPoint(page, target)
  await waitForVisibleRepresentation(page)
  const lightweightReadyMs = performance.now() - loadStart
  if (imageScenario) {
    await page.waitForFunction(
      () => document.querySelectorAll('.react-flow__node').length === 0,
      undefined,
      { timeout: 30_000 },
    )
    return { lightweightReadyMs: round(lightweightReadyMs), detailedReadyMs: null }
  }
  await page.waitForFunction(
    (expected) => document.querySelectorAll('.react-flow__node').length >= expected,
    EXPECTED_CARDS,
    { timeout: 90_000 },
  )
  await waitForFrames(page, 3)
  return { lightweightReadyMs: round(lightweightReadyMs), detailedReadyMs: round(performance.now() - detailStart) }
}

async function performScenario(
  page: Page,
  cdp: CDPSession,
  scenarioId: RichCardProbeScenarioId,
  repetition: number,
): Promise<ScenarioResult> {
  switch (scenarioId) {
    case 'many-long-notes-reading':
      await setViewportForBoardPoint(page, {
        boardX: FOUNDER_LONG_NOTE_FIXTURE.readingViewport.boardCenter.x,
        boardY: FOUNDER_LONG_NOTE_FIXTURE.readingViewport.boardCenter.y,
        zoom: FOUNDER_LONG_NOTE_FIXTURE.readingViewport.zoom,
      })
      await waitForVisibleRepresentation(page)
      await waitForFrames(page, 4)
      return {}
    case 'ordinary-reading-pan':
      return { interactionLatencyMs: await pan(page, 360, 120, 12) }
    case 'exceptionally-fast-pan':
      return { interactionLatencyMs: await pan(page, 960, 260, 2) }
    case 'rapid-zoom-out': {
      const before = await viewportTransform(page)
      await page.mouse.move(720, 500)
      const startedAt = performance.now()
      await page.keyboard.down('Control')
      for (let index = 0; index < 6; index += 1) await page.mouse.wheel(0, 120)
      await page.keyboard.up('Control')
      await page.waitForFunction((zoom) => {
        const transform = document.querySelector<HTMLElement>('.react-flow__viewport')
        const matrix = transform ? new DOMMatrixReadOnly(getComputedStyle(transform).transform) : null
        return (matrix?.a ?? zoom) < zoom - 0.02
      }, before.zoom)
      return { interactionLatencyMs: performance.now() - startedAt }
    }
    case 'direction-reversal': {
      const latencies = [await pan(page, 420, 0, 4), await pan(page, -840, 0, 4), await pan(page, 420, 0, 4)]
      return { interactionLatencyMs: Math.max(...latencies) }
    }
    case 'rare-far-programmatic-jump': {
      const before = await viewportTransform(page)
      const startedAt = performance.now()
      await setViewportForBoardPoint(page, { boardX: 5_900, boardY: 1_400, zoom: READING_ZOOM })
      const after = await viewportTransform(page)
      expect(Math.hypot(after.x - before.x, after.y - before.y)).toBeGreaterThan(500)
      return { interactionLatencyMs: performance.now() - startedAt }
    }
    case 'post-gesture-settle': {
      const startedAt = performance.now()
      await pan(page, 240, 80, 6)
      await page.waitForTimeout(280)
      return { interactionLatencyMs: performance.now() - startedAt }
    }
    case 'card-body-scroll': {
      const noteLatency = await scrollRichBody(
        page,
        { boardX: 380, boardY: 450, zoom: READING_ZOOM },
        'benchmark-giant-note',
        '.react-flow__node[data-id="benchmark-giant-note"] .note-body',
      )
      await setViewportForBoardPoint(page, { boardX: 1_230, boardY: 450, zoom: READING_ZOOM })
      const versionOne = page.locator(
        '.react-flow__node[data-id="benchmark-long-result"] .version-switcher button[title="Version 1"]',
      )
      await versionOne.click()
      await page.waitForFunction(() => {
        const graph = (window as unknown as {
          __eido?: { getState: () => { outputs: Array<{ resultCardId: string; chosenVersionId?: string }> } }
        }).__eido
        return graph?.getState().outputs.find((output) => output.resultCardId === 'benchmark-long-result')
          ?.chosenVersionId === 'benchmark-result-version-1'
      })
      const resultLatency = await scrollRichBody(
        page,
        { boardX: 1_230, boardY: 450, zoom: READING_ZOOM },
        'benchmark-long-result',
        '.react-flow__node[data-id="benchmark-long-result"] .card-body',
      )
      const conversationLatency = await scrollRichBody(
        page,
        { boardX: 380, boardY: 1_470, zoom: READING_ZOOM },
        'benchmark-long-conversation',
        '.react-flow__node[data-id="benchmark-long-conversation"] .transcript',
      )
      return { interactionLatencyMs: Math.max(noteLatency, resultLatency, conversationLatency) }
    }
    case 'selection': {
      const startedAt = performance.now()
      await page.locator('.react-flow__node[data-id="benchmark-giant-note"] .note-render').click()
      await waitForSelection(page, 'benchmark-giant-note')
      return { interactionLatencyMs: performance.now() - startedAt }
    }
    case 'hover-before-click': {
      const activation = await activateGiantNoteEditor(page, { hoverBeforeClick: true })
      return { interactionLatencyMs: activation.interactionLatencyMs }
    }
    case 'click-before-activation': {
      const activation = await activateGiantNoteEditor(page)
      return { interactionLatencyMs: activation.interactionLatencyMs }
    }
    case 'editing-activation': {
      const activation = await activateGiantNoteEditor(page)
      return { interactionLatencyMs: activation.interactionLatencyMs }
    }
    case 'typing': {
      const { editor, pressSequentially } = await activateGiantNoteEditor(page)
      const suffix = ` benchmark typing suffix ${repetition}`
      const startedAt = performance.now()
      await pressSequentially(suffix, { delay: 0 })
      await expect(editor).toContainText(suffix)
      return { interactionLatencyMs: performance.now() - startedAt }
    }
    case 'dragging': {
      const before = await cardPosition(page, 'benchmark-ordinary-000001')
      const title = page.locator('.react-flow__node[data-id="benchmark-ordinary-000001"] .card-title-display')
      const box = await title.boundingBox()
      if (!box) throw new Error('Missing ordinary Card drag target')
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      const startedAt = performance.now()
      await page.mouse.down()
      await page.mouse.move(box.x + box.width / 2 + 80, box.y + box.height / 2, { steps: 8 })
      await page.mouse.up()
      await page.waitForFunction(({ id, x }) => {
        const graph = (window as unknown as {
          __eido?: { getState: () => { cards: Array<{ id: string; position: { x: number } }> } }
        }).__eido
        return Math.abs((graph?.getState().cards.find((card) => card.id === id)?.position.x ?? x) - x) > 20
      }, { id: 'benchmark-ordinary-000001', x: before.x })
      return { interactionLatencyMs: performance.now() - startedAt }
    }
    case 'connecting':
      return { interactionLatencyMs: await connectOrdinaryCards(page) }
    case 'cold-image-traversal':
    case 'warm-image-revisit': {
      if (scenarioId === 'warm-image-revisit') {
        await setViewportForBoardPoint(page, { boardX: 5_900, boardY: 1_400, zoom: 0.24 })
        await waitForFrames(page, 2)
      }
      if (scenarioId === 'cold-image-traversal') await cdp.send('Network.clearBrowserCache')
      const startedAt = performance.now()
      await setViewportForBoardPoint(page, { boardX: 800, boardY: 2_350, zoom: READING_ZOOM })
      await page.waitForFunction(
        (expected) => document.querySelectorAll('.react-flow__node').length >= expected,
        EXPECTED_CARDS,
        { timeout: 90_000 },
      )
      const detailedReadyMs = performance.now() - startedAt
      await page.waitForFunction(() => document.querySelectorAll('[data-id^="benchmark-images-"] img').length >= 9)
      const decodeStart = performance.now()
      const decodedCount = await page.locator('[data-id^="benchmark-images-"] img').evaluateAll(async (images) => {
        await Promise.all(images.map((image) => (image as HTMLImageElement).decode()))
        return images.length
      })
      expect(decodedCount).toBeGreaterThanOrEqual(9)
      await waitForFrames(page, 2)
      const decodeMs = performance.now() - decodeStart
      return {
        interactionLatencyMs: performance.now() - startedAt,
        decodedCount,
        decodeMs: round(decodeMs),
        detailedReadyMs: round(detailedReadyMs),
        lightweightReadyMs: 0,
        settledImageReadyMs: round(performance.now() - startedAt),
      }
    }
  }
}

async function installLongTaskObserver(page: Page) {
  await page.addInitScript(() => {
    ;(window as unknown as { __EIDO_RICH_LONG_TASKS__?: Array<{ startTime: number; duration: number }> })
      .__EIDO_RICH_LONG_TASKS__ = []
    try {
      new PerformanceObserver((list) => {
        const target = (window as unknown as {
          __EIDO_RICH_LONG_TASKS__?: Array<{ startTime: number; duration: number }>
        }).__EIDO_RICH_LONG_TASKS__
        for (const entry of list.getEntries()) target?.push({ startTime: entry.startTime, duration: entry.duration })
      }).observe({ type: 'longtask', buffered: true })
    } catch {
      // Unsupported browsers retain an empty observed list; the environment identifies Chromium.
    }
  })
}

async function beginProbe(page: Page, _expectedCards: number) {
  await page.evaluate(() => {
    const state = {
      frameTimestampsMs: [] as number[],
      minDom: Number.POSITIVE_INFINITY,
      maxDom: 0,
      blank: 0,
      missing: 0,
      raf: 0,
    }
    ;(window as unknown as { __EIDO_RICH_LONG_TASKS__?: unknown[] }).__EIDO_RICH_LONG_TASKS__ = []
    const sample = (now: number) => {
      state.frameTimestampsMs.push(now)
      const dom = document.querySelectorAll('.react-flow__node').length
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
      const root = document.querySelector('.react-flow')
      const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
      const rootRect = root?.getBoundingClientRect()
      const transform = viewport ? getComputedStyle(viewport).transform : 'none'
      const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
      const domIds = new Set(
        [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
          .map((node) => node.dataset.id)
          .filter((id): id is string => Boolean(id)),
      )
      const overviewIds = (window as unknown as { __EIDO_OVERVIEW_CARD_IDS__?: Set<string> })
        .__EIDO_OVERVIEW_CARD_IDS__ ?? new Set<string>()
      let visibleCards = 0
      let representedVisibleCards = 0
      if (graph && rootRect && matrix) {
        for (const card of graph.getState().cards) {
          const width = card.size?.width ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 320 : 260)
          const height = card.size?.height ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 82 : 180)
          const left = rootRect.left + card.position.x * matrix.a + matrix.e
          const top = rootRect.top + card.position.y * matrix.a + matrix.f
          const visible =
            left + width * matrix.a >= rootRect.left &&
            left <= rootRect.right &&
            top + height * matrix.a >= rootRect.top &&
            top <= rootRect.bottom
          if (!visible) continue
          visibleCards += 1
          if (domIds.has(card.id) || overviewIds.has(card.id)) representedVisibleCards += 1
        }
      }
      state.minDom = Math.min(state.minDom, dom)
      state.maxDom = Math.max(state.maxDom, dom)
      if (visibleCards > 0 && representedVisibleCards === 0) state.blank += 1
      if (visibleCards > representedVisibleCards) state.missing += 1
      state.raf = requestAnimationFrame(sample)
    }
    state.raf = requestAnimationFrame(sample)
    ;(window as unknown as { __EIDO_RICH_PROBE__?: typeof state }).__EIDO_RICH_PROBE__ = state
  })
}

async function endProbe(page: Page): Promise<PageProbe> {
  return page.evaluate(() => {
    const state = (window as unknown as {
      __EIDO_RICH_PROBE__?: {
        frameTimestampsMs: number[]
        minDom: number
        maxDom: number
        blank: number
        missing: number
        raf: number
      }
      __EIDO_RICH_LONG_TASKS__?: Array<{ startTime: number; duration: number }>
    }).__EIDO_RICH_PROBE__
    if (!state) throw new Error('Missing Rich Card frame probe')
    cancelAnimationFrame(state.raf)
    return {
      frameTimestampsMs: state.frameTimestampsMs,
      residentDom: {
        min: Number.isFinite(state.minDom) ? state.minDom : 0,
        max: state.maxDom,
      },
      blankBoardFrames: state.blank,
      missingRepresentationFrames: state.missing,
      longTasks: (window as unknown as { __EIDO_RICH_LONG_TASKS__?: Array<{ startTime: number; duration: number }> })
        .__EIDO_RICH_LONG_TASKS__ ?? [],
    }
  })
}

async function performanceMetrics(cdp: CDPSession): Promise<Record<string, number>> {
  const response = (await cdp.send('Performance.getMetrics')) as { metrics: Array<{ name: string; value: number }> }
  return Object.fromEntries(response.metrics.map((metric) => [metric.name, metric.value * (metric.name.endsWith('Duration') ? 1_000 : 1)]))
}

async function beginTrace(cdp: CDPSession) {
  const events: Array<{ name?: string; dur?: number }> = []
  const onData = (event: { value?: Array<{ name?: string; dur?: number }> }) => events.push(...(event.value ?? []))
  cdp.on('Tracing.dataCollected', onData)
  await cdp.send('Tracing.start', {
    categories: 'devtools.timeline,disabled-by-default-devtools.timeline.frame',
    options: 'sampling-frequency=10000',
  })
  return {
    async stop() {
      const completed = new Promise<void>((resolve) => cdp.once('Tracing.tracingComplete', () => resolve()))
      await cdp.send('Tracing.end')
      await completed
      cdp.off('Tracing.dataCollected', onData)
      return events
    },
  }
}

function traceDurationMs(events: Array<{ name?: string; dur?: number }>, names: string[]) {
  return events.reduce((total, event) => total + (event.name && names.includes(event.name) ? (event.dur ?? 0) / 1_000 : 0), 0)
}

function metricDelta(before: Record<string, number>, after: Record<string, number>, names: string[]) {
  return names.reduce((total, name) => total + Math.max(0, (after[name] ?? 0) - (before[name] ?? 0)), 0)
}

async function pan(page: Page, x: number, y: number, steps: number) {
  await setActiveTool(page, 'pan')
  const before = await viewportTransform(page)
  await page.mouse.move(720, 500)
  const startedAt = performance.now()
  await page.mouse.down()
  await page.mouse.move(720 + x, 500 + y, { steps })
  await page.mouse.up()
  await page.waitForFunction(({ x: beforeX, y: beforeY }) => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    const matrix = viewport ? new DOMMatrixReadOnly(getComputedStyle(viewport).transform) : null
    return Math.hypot((matrix?.e ?? beforeX) - beforeX, (matrix?.f ?? beforeY) - beforeY) > 20
  }, { x: before.x, y: before.y })
  return performance.now() - startedAt
}

async function setActiveTool(page: Page, tool: 'select' | 'pan') {
  await page.evaluate((nextTool) => {
    const graph = (window as unknown as {
      __eido?: { getState: () => { setActiveTool: (value: string) => void } }
    }).__eido
    graph?.getState().setActiveTool(nextTool)
  }, tool)
}

async function resetScenarioSelection(page: Page) {
  // loadFixture resets the graph store, but Board's React Flow-local selection
  // can survive because every repetition intentionally reuses the same Card IDs.
  // Exercise the product's existing Escape path so both authorities agree.
  await page.keyboard.press('Escape')
  await page.waitForFunction(
    () => {
      const graph = (window as unknown as {
        __eido?: {
          getState: () => {
            selection: { kind: string; id: string } | null
            selectedCardIds: string[]
          }
        }
      }).__eido
      const state = graph?.getState()
      return (
        document.querySelectorAll('.react-flow__node.selected').length === 0 &&
        state?.selection === null &&
        state.selectedCardIds.length === 0
      )
    },
    undefined,
    { timeout: 10_000 },
  )
}

async function setViewportForBoardPoint(
  page: Page,
  target: { boardX: number; boardY: number; zoom: number },
) {
  await page.evaluate(({ boardX, boardY, zoom }) => {
    const flow = document.querySelector('.react-flow')
    const rect = flow?.getBoundingClientRect()
    const setViewport = (window as unknown as {
      __EIDO_SET_VIEWPORT__?: (value: { x: number; y: number; zoom: number }) => void
    }).__EIDO_SET_VIEWPORT__
    if (!rect || !setViewport) throw new Error('Missing Eido viewport runtime')
    setViewport({
      x: rect.left + rect.width / 2 - boardX * zoom,
      y: rect.top + rect.height / 2 - boardY * zoom,
      zoom,
    })
  }, target)
  await waitForFrames(page, 2)
}

async function waitForVisibleRepresentation(page: Page) {
  await page.waitForFunction(() => {
    const nodes = document.querySelectorAll('.react-flow__node').length
    const overview = Number(
      document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.renderedCardCount ?? 0,
    )
    return nodes > 0 || overview > 0
  }, undefined, { timeout: 60_000 })
}

async function viewportTransform(page: Page) {
  return page.evaluate(() => {
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    const transform = viewport ? getComputedStyle(viewport).transform : 'none'
    const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
    return { x: matrix?.e ?? 0, y: matrix?.f ?? 0, zoom: matrix?.a ?? 1 }
  })
}

async function cardPosition(page: Page, cardId: string) {
  return page.evaluate((id) => {
    const graph = (window as unknown as {
      __eido?: { getState: () => { cards: Array<{ id: string; position: { x: number; y: number } }> } }
    }).__eido
    const card = graph?.getState().cards.find((candidate) => candidate.id === id)
    if (!card) throw new Error(`Missing Card ${id}`)
    return card.position
  }, cardId)
}

async function scrollRichBody(
  page: Page,
  target: { boardX: number; boardY: number; zoom: number },
  cardId: string,
  selector: string,
) {
  await setViewportForBoardPoint(page, target)
  await page.locator(`.react-flow__node[data-id="${cardId}"] .card-head`).click()
  await waitForSelection(page, cardId)
  const body = page.locator(selector)
  await body.waitFor({ state: 'visible', timeout: 30_000 })
  const before = await body.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollable: element.scrollHeight > element.clientHeight,
  }))
  expect(before.scrollable, `${selector} must be internally navigable`).toBe(true)
  await body.evaluate((element) => {
    element.scrollTop = 0
  })
  await expect.poll(() => body.evaluate((element) => element.scrollTop)).toBe(0)
  await body.hover()
  const startedAt = performance.now()
  await page.mouse.wheel(0, 480)
  await page.waitForFunction(
    ({ selector: bodySelector, scrollTop }) =>
      (document.querySelector(bodySelector)?.scrollTop ?? scrollTop) > scrollTop,
    { selector, scrollTop: 0 },
    { timeout: 10_000 },
  )
  return performance.now() - startedAt
}

async function waitForSelection(page: Page, cardId: string) {
  await page.waitForFunction((id) => {
    const graph = (window as unknown as {
      __eido?: { getState: () => { selection: { kind: string; id: string } | null } }
    }).__eido
    return graph?.getState().selection?.kind === 'card' && graph.getState().selection?.id === id
  }, cardId, { timeout: 10_000 })
}

async function activateGiantNoteEditor(page: Page, options: { hoverBeforeClick?: boolean } = {}) {
  const nodeSelector = '.react-flow__node[data-id="benchmark-giant-note"]'
  const body = page.locator(`${nodeSelector} .note-body`)
  await body.waitFor({ state: 'visible', timeout: 30_000 })
  const box = await body.boundingBox()
  if (!box || box.width <= 0 || box.height <= 0) throw new Error('Missing visible giant Note body click target')
  const point = { x: box.x + box.width / 2, y: box.y + Math.min(40, box.height / 2) }
  const hit = await page.evaluate(({ x, y }) => {
    const target = document.elementFromPoint(x, y)
    return {
      body: Boolean(target?.closest('.note-body')),
      cardId: target?.closest<HTMLElement>('.react-flow__node')?.dataset.id ?? null,
    }
  }, point)
  expect(hit).toEqual({ body: true, cardId: 'benchmark-giant-note' })

  if (options.hoverBeforeClick) {
    await page.mouse.move(point.x, point.y)
    await waitForFrames(page, 1)
  } else {
    await page.mouse.move(720, 40)
    await waitForFrames(page, 1)
  }

  const startedAt = performance.now()
  const { editor, pressSequentially } = await activateAndRequireExactReadyMarkdownEditor(
    page,
    nodeSelector,
    () => page.mouse.click(point.x, point.y),
  )
  const interactionLatencyMs = performance.now() - startedAt
  return { editor, interactionLatencyMs, pressSequentially }
}

async function connectOrdinaryCards(page: Page) {
  const before = await page.evaluate(() =>
    (window as unknown as { __eido?: { getState: () => { connections: unknown[] } } }).__eido?.getState()
      .connections.length ?? 0,
  )
  const sourceNode = page.locator('.react-flow__node[data-id="benchmark-ordinary-000001"]')
  await sourceNode.hover()
  const source = sourceNode.locator('.react-flow__handle-right')
  const target = page.locator(
    '.react-flow__node[data-id="benchmark-ordinary-000002"] .react-flow__handle-left',
  )
  const sourceBox = await source.boundingBox()
  const targetBox = await target.boundingBox()
  if (!sourceBox || !targetBox) throw new Error('Missing ordinary Card connection handles')
  await page.mouse.move(sourceBox.x + sourceBox.width / 2, sourceBox.y + sourceBox.height / 2)
  const startedAt = performance.now()
  await page.mouse.down()
  await page.mouse.move(targetBox.x + targetBox.width / 2, targetBox.y + targetBox.height / 2, { steps: 8 })
  await page.mouse.up()
  await page.waitForFunction((count) => {
    const graph = (window as unknown as { __eido?: { getState: () => { connections: unknown[] } } }).__eido
    return (graph?.getState().connections.length ?? count) > count
  }, before)
  return performance.now() - startedAt
}

async function waitForFrames(page: Page, count: number) {
  await page.evaluate(
    (frames) =>
      new Promise<void>((resolve) => {
        let remaining = frames
        const step = () => {
          remaining -= 1
          if (remaining <= 0) resolve()
          else requestAnimationFrame(step)
        }
        requestAnimationFrame(step)
      }),
    count,
  )
}

async function measureCorrectness(page: Page, cdp: CDPSession): Promise<RichCardRawArtifact['correctness']> {
  await setActiveTool(page, 'select')
  await setViewportForBoardPoint(page, { boardX: 380, boardY: 450, zoom: READING_ZOOM })
  const giantNote = page.locator('.react-flow__node[data-id="benchmark-giant-note"]')
  await expect(giantNote.locator('.note-render:not([contenteditable="true"])')).toBeVisible()
  await expect(giantNote.locator('.note-render[contenteditable="true"]')).toHaveCount(0)
  const found = await page.evaluate(() =>
    (window as unknown as { find: (text: string) => boolean }).find('Giant benchmark note'),
  )
  await activateGiantNoteEditor(page, { hoverBeforeClick: true })
  const renderedTextNodes = await page.evaluate(() => {
    const root = document.querySelector(
      '.react-flow__node[data-id="benchmark-giant-note"] .note-render[contenteditable="true"]',
    )
    if (!root) return null
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
    const textNodes: string[] = []
    let text = walker.nextNode()
    while (text) {
      textNodes.push(text.textContent ?? '')
      text = walker.nextNode()
    }
    return textNodes
  })
  const selection = await probeRichCardSelection(renderedTextNodes, async (target) =>
    page.evaluate((selectionTarget) => {
      const root = document.querySelector(
        '.react-flow__node[data-id="benchmark-giant-note"] .note-render[contenteditable="true"]',
      )
      if (!root) return { selectedText: null, failure: 'giant Note live editor disappeared before selection' }
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
      let text = walker.nextNode()
      for (let index = 0; index < selectionTarget.nodeIndex && text; index += 1) text = walker.nextNode()
      if (!text?.textContent || selectionTarget.endOffset > text.textContent.length) {
        return { selectedText: null, failure: 'target rendered text node disappeared before selection' }
      }
      const range = document.createRange()
      range.setStart(text, selectionTarget.startOffset)
      range.setEnd(text, selectionTarget.endOffset)
      const selection = window.getSelection()
      if (!selection) return { selectedText: null, failure: 'window.getSelection returned null' }
      selection.removeAllRanges()
      selection.addRange(range)
      const selectedText = selection.toString()
      selection.removeAllRanges()
      return { selectedText }
    }, target)
  )
  let richTextNodes: number | null = null
  let accessibilityStatus: 'observed' | 'unavailable' = 'observed'
  try {
    await cdp.send('Accessibility.enable')
    const tree = (await cdp.send('Accessibility.getFullAXTree')) as {
      nodes?: Array<{ name?: { value?: string }; role?: { value?: string } }>
    }
    richTextNodes = (tree.nodes ?? []).filter(
      (node) => node.role?.value === 'StaticText' && /benchmark|synthetic/i.test(node.name?.value ?? ''),
    ).length
  } catch {
    accessibilityStatus = 'unavailable'
  }
  return {
    search: { status: 'observed', found, method: 'window.find over the mounted synthetic giant Note.' },
    selection,
    copy: {
      status: 'unavailable',
      copiedCharacters: null,
      method: 'System clipboard copy was not invoked or read by this browser harness.',
    },
    accessibility: {
      status: accessibilityStatus,
      richTextNodes,
      method: 'Chromium Accessibility.getFullAXTree static-text count; not a complete assistive-technology audit.',
    },
  }
}

function githubRunUrl() {
  const server = process.env.GITHUB_SERVER_URL
  const repository = process.env.GITHUB_REPOSITORY
  const runId = process.env.GITHUB_RUN_ID
  return server && repository && runId ? `${server}/${repository}/actions/runs/${runId}` : undefined
}
