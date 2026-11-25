import { execSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, platform, release, totalmem } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test, type CDPSession, type Page } from '@playwright/test'
import { REACT_FLOW_MEASURED_DIMENSION_TOLERANCE_PX } from '../canvas/boardResizeHotGeometry'
import {
  analyzePositiveControl,
  comparePairedMetrics,
  experimentArmOrderForPair,
} from './massiveDetailExperimentAnalysis'
import {
  bindViteReactLayoutEffect,
  instrumentBoardResizeTerminalTimeout,
  instrumentCommittedBoardSceneProbe,
  instrumentScheduledCoordinatorRead,
} from './resizePainterReplayInstrumentation'

// Capture-only differential for the resize painter replay path. The source
// instrumentation is injected by Playwright's dev-server routes: production
// ships no benchmark switch or counter. Both arms run in one loaded page.
// This is the #500 producer+consumer gate at the exact Reading↔Overview
// crossing. The Map/Overview-only renderer tests are consumer-only; their
// 2,200-connection maximum-board evidence remains owned by #410.
//
//   EIDO_RESIZE_PAINTER_CAPTURE=1 npm run perf:browser -- \
//     src/performance/resizePainterReplay.perf.ts

const ENV = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const CAPTURE = ENV.process?.env?.EIDO_RESIZE_PAINTER_CAPTURE === '1'
const SMOKE_ONLY = ENV.process?.env?.EIDO_RESIZE_PAINTER_SMOKE === '1'
const EXPECTED_DATA_FILE = ENV.process?.env?.EIDO_PERF_DATA_FILE
const ARTIFACT_FILE =
  ENV.process?.env?.EIDO_RESIZE_PAINTER_ARTIFACT ??
  join('test-results', 'resizePainterReplay.raw.json')

const ACTIVE_CARD_ID = 'note-000001'
const ACTIVE_POSITION = { x: 31_500, y: 4_750 }
const ACTIVE_SIZE = { width: 260, height: 180 }
const ACTIVE_Z_INDEX = 1_000_000
const READING_OVERVIEW_CROSSFADE_ZOOM = 0.325
const EXPECTED_CROSSFADE_PAINTER_CONNECTIONS = 0
const MAX_CROSSFADE_DETAIL_CARDS = 500
const MAX_FULL_DETAIL_TEXT_WEIGHT = 300_000
const CAPTURE_PAIRS = 5
const WARMUP_WAYPOINTS = 60
const MEASURED_WAYPOINTS = 480
const SMOKE_WAYPOINTS = 6
const TRUSTED_SAMPLES_PER_WAYPOINT = 1
const POSITIVE_CONTROL_MS_PER_FRAME = 8

type Arm = 'full-redraw' | 'replay'
type CounterName =
  | 'preview'
  | 'coldDraw'
  | 'query'
  | 'cardById'
  | 'planner'
  | 'label'
  | 'scene'
  | 'metric'
  | 'mountPlan'
  | 'rfRead'
  | 'indexWork'
  | 'rank'
  | 'producerBegin'
  | 'producerPreview'
  | 'producerCommit'
  | 'producerAbort'
  | 'sizeWrite'
  | 'historyCommit'
  | 'measurementReport'
  | 'persistenceCall'
  | 'persistenceEnqueue'
  | 'graphAccess'
  | 'unrelatedCardShellRender'
  | 'activeCardShellRender'
  | 'unrelatedCardShellCommit'
  | 'activeCardShellCommit'
  | 'graphCardLookup'
  | 'graphProjectionBuild'
  | 'graphIndexCacheMiss'
  | 'storeNotification'
  | 'trustedPointerMove'

const COUNTER_NAMES: CounterName[] = [
  'preview',
  'coldDraw',
  'query',
  'cardById',
  'planner',
  'label',
  'scene',
  'metric',
  'mountPlan',
  'rfRead',
  'indexWork',
  'rank',
  'producerBegin',
  'producerPreview',
  'producerCommit',
  'producerAbort',
  'sizeWrite',
  'historyCommit',
  'measurementReport',
  'persistenceCall',
  'persistenceEnqueue',
  'graphAccess',
  'unrelatedCardShellRender',
  'activeCardShellRender',
  'unrelatedCardShellCommit',
  'activeCardShellCommit',
  'graphCardLookup',
  'graphProjectionBuild',
  'graphIndexCacheMiss',
  'storeNotification',
  'trustedPointerMove',
]

type CounterSnapshot = Record<CounterName, number>

type BoardSceneEligibilitySnapshot = {
  visibleCardCount: number
  detailCardCount: number
  visibleConnectionCount: number
  fullyDetailed: boolean
  useCanvasConnections: boolean
  showConnections: boolean
  readingCardOpacity: number
  boardDetailTextWeight: number
}

type CrossfadeEligibilitySnapshot = {
  viewportZoom: number
  readingOpacity: number
  overviewOpacity: number
  canvasOccludingReactCardCount: number
  painterCandidateConnections: number
  painterRenderedConnections: number
  mountedVisualCardCount: number
  activeNonProxyCardCount: number
  gestureProxyCount: number
  activeGestureProxyCount: number
  scene: BoardSceneEligibilitySnapshot | null
}

type ResizeAcknowledgeRecord = {
  cardId: string
  sessionId: number
  hotFrame: {
    cardId: string
    sessionId: number
    phase: string
    geometry: {
      position: { x: number; y: number }
      size: { width: number; height: number }
    }
    endpointOffsets?: {
      source?: { x: number; y: number }
      target?: { x: number; y: number }
    }
  } | null
  graphCard: {
    position: { x: number; y: number }
    size: { width: number; height: number } | null
  } | null
  node: {
    positionAbsolute: { x: number; y: number }
    measured: { width: number | null; height: number | null }
    sourceHandles: Array<{
      x: number
      y: number
      width: number
      height: number
      position: string
    }>
    targetHandles: Array<{
      x: number
      y: number
      width: number
      height: number
      position: string
    }>
  } | null
  nodeMatchesTerminal: boolean
  postClearIsNull: boolean
  coordinatorSampleCount: number
}

type ResizeTerminalHandleRecord = {
  id: string | null
  type: string | null
  nodeId: string | null
  x: number
  y: number
  width: number
  height: number
  position: string | null
}

type ResizeTerminalTimeoutRecord = {
  frame: {
    cardId: string
    sessionId: number
    phase: string
    geometry: {
      position: { x: number; y: number }
      size: { width: number; height: number }
    }
    endpointOffsets?: {
      source?: { x: number; y: number }
      target?: { x: number; y: number }
    }
  }
  state: {
    graph: 'matching' | 'mismatching' | 'missing'
    node: 'matching' | 'mismatching' | 'absent'
  }
  node: {
    positionAbsolute: { x: number; y: number }
    measured: { width: number | null; height: number | null }
    sourceHandles: ResizeTerminalHandleRecord[]
    targetHandles: ResizeTerminalHandleRecord[]
  } | null
}

type ResizeCoordinatorSampleRecord = {
  frame: {
    cardId: string
    sessionId: number
    phase: string
    geometry: {
      position: { x: number; y: number }
      size: { width: number; height: number }
    }
  }
  hotFrame: {
    cardId: string
    sessionId: number
    phase: string
    geometry: {
      position: { x: number; y: number }
      size: { width: number; height: number }
    }
  } | null
  state: {
    graph: 'matching' | 'mismatching' | 'missing'
    node: 'matching' | 'mismatching' | 'absent'
  }
  stableFrames: number
  matchingFramesBefore: number
  absentNodeGraphFramesBefore: number
}

type StructuralSnapshot = {
  counters: CounterSnapshot
  dispatchedPointerSamples: number
  candidateConnections: number
  renderedConnections: number
  capturedConnections: number
  incidentConnections: number
  connectionVisits: number
  cardVisits: number
  representationPaintCount: number
  crossfade: {
    viewportZoom: number
    readingOpacity: number
    overviewOpacity: number
  }
  heldGraph: {
    cardsIdentityHeld: boolean
    undoIdentityHeld: boolean
    intentIdentityHeld: boolean
    saveStateHeld: boolean
    sceneEligibilityHeld: boolean
    sceneEligibility: BoardSceneEligibilitySnapshot | null
    unrelatedCardIdentityHeld: boolean
    boardChangeDelta: number
    baselineStoredSize: { width: number; height: number } | null
    storedSize: { width: number; height: number } | null
    hotSessionId: string | null
    hotSize: { width: number; height: number } | null
    reactFlow: {
      notifications: number
      dimensionChanges: number
      measuredMapClones: number
      renderIndexGets: number
      incrementalUpdates: number
      cardsPatched: number
      boundsUpdated: number
      rankEpochDelta: number
      fullRebuilds: number
    } | null
    graphCardLookupIds: string[]
  }
}

type ReleaseSnapshot = {
  retainedImmediately: boolean
  hotSessionIdImmediately: string | null
  capturedConnectionsImmediately: number
  storedSize: { width: number; height: number } | null
  terminalHotSize: { width: number; height: number } | null
  unrelatedCardIdentityHeld: boolean
  boardChangeDelta: number
  undoDelta: number
  resizeEventDelta: number
  counters: CounterSnapshot
  acknowledgement: {
    count: number
    record: ResizeAcknowledgeRecord | null
    coordinatorSamples: ResizeCoordinatorSampleRecord[]
  }
  converged: {
    hotSessionId: string | null
    hotWidth: string | null
    hotHeight: string | null
  }
}

type CaptureResult = {
  pair: number
  sequenceInPair: number
  arm: Arm | 'replay-positive-control'
  actualElapsedMs: number
  taskDurationMs: number
  mainThreadTaskMsPerSecond: number
  injectedFrames: number
  structural: StructuralSnapshot
  release: ReleaseSnapshot
  capturedAt: string
  hostLoad: string
}

type EidoDevStore = {
  getState: () => {
    hydrated: boolean
    cards: Array<{
      id: string
      position: { x: number; y: number }
      size?: { width: number; height: number }
    }>
    connections: Array<{ from: { cardId: string }; to: { cardId: string } }>
    undoStack: unknown[]
    intentLog: Array<{ type: string }>
    boardChangeSeq: number
    saveState: unknown
  }
  setState: (state: unknown) => void
  subscribe: (listener: () => void) => () => void
}

type CaptureRuntime = {
  arm: Arm
  active: boolean
  captureLifecycle: boolean
  pointerId: number | null
  measurementStartedAt: number
  counters: CounterSnapshot
  acknowledgements: ResizeAcknowledgeRecord[]
  coordinatorSamples: ResizeCoordinatorSampleRecord[]
  terminalTimeouts: ResizeTerminalTimeoutRecord[]
  graphCardLookupIds: string[]
  reset(): void
  count(name: CounterName): void
  recordLifecycle(type: 'begin' | 'preview' | 'commit' | 'abort'): void
  recordCardShellRender(cardId: string): void
  recordCardShellCommit(cardId: string): void
  recordAcknowledge(record: ResizeAcknowledgeRecord): void
  recordCoordinatorSample(record: ResizeCoordinatorSampleRecord): void
  recordTerminalTimeout(record: ResizeTerminalTimeoutRecord): void
  recordGraphCardLookup(cardId: string): void
}

type ResizeReplayProbe = {
  cards: unknown
  undoStack: unknown
  intentLog: unknown
  unrelatedCard: unknown
  activeCardIndex: number
  unrelatedCardIndex: number
  boardChangeSeq: number
  undoDepth: number
  resizeEventCount: number
  activeSize: { width: number; height: number } | null
  saveState: unknown
  sceneEligibility: BoardSceneEligibilitySnapshot
  unsubscribeStore: () => void
}

type DevWindow = Window & {
  __eido?: EidoDevStore
  __EIDO_PERF__?: {
    loadFixture: (fixture: 'large') => Promise<{ cards: number; connections: number; events: number }>
  }
  __EIDO_SET_VIEWPORT__?: (viewport: { x: number; y: number; zoom: number }) => void
  __EIDO_FORCE_OVERVIEW_DRAW__?: () => void
  __EIDO_RESIZE_REPLAY_CAPTURE__?: CaptureRuntime
  __EIDO_RESIZE_REPLAY_PROBE__?: ResizeReplayProbe
  __EIDO_RESIZE_REPLAY_SCENE__?: BoardSceneEligibilitySnapshot
  __EIDO_RESIZE_POSITIVE_CONTROL__?: {
    active: boolean
    msPerFrame: number
    frames: number
  }
  __EIDO_RESIZE_RF_DIAGNOSTIC__?: {
    notifications: number
    dimensionChanges: number
    measuredMapClones: number
    snapshot: () => {
      renderIndexDelta: {
        gets: number
        incrementalUpdates: number
        cardsPatched: number
        boundsUpdated: number
        fullRebuilds: { initial: number; cardStructure: number; connections: number }
      }
      rankEpochDelta: number
    }
  }
}

test('CardShell resize replay stays structurally bounded at the Reading↔Overview crossing', async ({
  page,
  browser,
}) => {
  test.setTimeout(900_000)
  test.skip(!CAPTURE && !SMOKE_ONLY, 'capture-only; set EIDO_RESIZE_PAINTER_CAPTURE=1')

  await installCaptureInstrumentation(page)
  await page.goto('/')
  await page.waitForFunction(() => {
    const dev = window as DevWindow
    return Boolean(dev.__eido?.getState().hydrated && dev.__EIDO_PERF__ && dev.__EIDO_SET_VIEWPORT__)
  })
  await page.evaluate(() => document.fonts.ready)
  await assertDisposableStorage(page)

  const loaded = await page.evaluate(async () => (window as DevWindow).__EIDO_PERF__?.loadFixture('large'))
  expect(loaded).toMatchObject({ cards: 5_000, connections: 10_000, events: 50_000 })
  await normalizeActiveCard(page)
  await pinCanonicalViewport(page)
  await waitForCanonicalCrossfadeEligibility(page)
  await selectActiveCard(page)
  await pinCanonicalViewport(page)
  await waitForCanonicalCrossfadeEligibility(page)

  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  const repetitions: CaptureResult[] = []
  const positiveControls: CaptureResult[] = []

  try {
    const smoke = await captureGesture({
      page,
      cdp,
      pair: 0,
      sequenceInPair: 0,
      arm: 'replay',
      positiveControl: true,
      waypointCount: SMOKE_WAYPOINTS,
    })
    assertSmokeStructure(smoke, SMOKE_WAYPOINTS)
    assertReleaseStructure(smoke)
    expect(smoke.injectedFrames).toBeGreaterThan(0)
    expect(smoke.taskDurationMs).toBeGreaterThanOrEqual(
      smoke.injectedFrames * POSITIVE_CONTROL_MS_PER_FRAME * 0.5,
    )
    if (SMOKE_ONLY) return
    await runWarmup(page, 'full-redraw')
    await runWarmup(page, 'replay')

    for (let pair = 1; pair <= CAPTURE_PAIRS; pair += 1) {
      const order = experimentArmOrderForPair(pair).map<Arm>((arm) =>
        arm === 'caps-on' ? 'full-redraw' : 'replay',
      )
      for (const [index, arm] of order.entries()) {
        repetitions.push(
          await captureGesture({
            page,
            cdp,
            pair,
            sequenceInPair: index + 1,
            arm,
            positiveControl: false,
            waypointCount: MEASURED_WAYPOINTS,
          }),
        )
      }
      positiveControls.push(
        await captureGesture({
          page,
          cdp,
          pair,
          sequenceInPair: 3,
          arm: 'replay',
          positiveControl: true,
          waypointCount: MEASURED_WAYPOINTS,
        }),
      )
    }
  } finally {
    await stopPositiveControl(page)
    await page.mouse.up().catch(() => undefined)
  }

  const full = repetitions.filter((capture) => capture.arm === 'full-redraw')
  const replay = repetitions.filter((capture) => capture.arm === 'replay')
  expect(full).toHaveLength(CAPTURE_PAIRS)
  expect(replay).toHaveLength(CAPTURE_PAIRS)
  expect(positiveControls).toHaveLength(CAPTURE_PAIRS)

  const primary = comparePairedMetrics(
    full.map((capture) => capture.mainThreadTaskMsPerSecond),
    replay.map((capture) => capture.mainThreadTaskMsPerSecond),
  )
  const positiveControl = analyzePositiveControl({
    capsOff: replay.map((capture) => capture.mainThreadTaskMsPerSecond),
    positiveControl: positiveControls.map((capture) => capture.mainThreadTaskMsPerSecond),
    injectedMsPerFrame: POSITIVE_CONTROL_MS_PER_FRAME,
    observedNoiseFloor: primary.observedNoiseFloor,
  })
  const replayStructureGreen = [...replay, ...positiveControls].every(replayStructureIsGreen)
  const fullControlGreen = full.every(fullControlIsValid)
  const releaseStructureGreen = [...repetitions, ...positiveControls].every(releaseStructureIsGreen)

  const browserEnvironment = await page.evaluate(() => ({
    userAgent: navigator.userAgent,
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemory: (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? null,
    devicePixelRatio: window.devicePixelRatio,
    screen: { width: screen.width, height: screen.height },
    viewport: { width: innerWidth, height: innerHeight },
  }))
  const artifact = {
    name: 'reading-crossfade-card-shell-resize-replay',
    capturedAt: new Date().toISOString(),
    capturedFromCommit: execSync('git rev-parse --short HEAD').toString().trim(),
    config: {
      fixture: 'large',
      fixtureShape: { cards: 5_000, connections: 10_000, timelineEvents: 50_000 },
      viewport: { width: 1_440, height: 1_000, zoom: READING_OVERVIEW_CROSSFADE_ZOOM },
      activeCard: { id: ACTIVE_CARD_ID, position: ACTIVE_POSITION, size: ACTIVE_SIZE },
      routing: {
        crossfadePainterConnections: EXPECTED_CROSSFADE_PAINTER_CONNECTIONS,
        connectionOwner: 'mounted DOM edges',
      },
      warmupWaypointsPerArm: WARMUP_WAYPOINTS,
      measuredWaypoints: MEASURED_WAYPOINTS,
      trustedSamplesPerWaypoint: TRUSTED_SAMPLES_PER_WAYPOINT,
      pairs: CAPTURE_PAIRS,
      positiveControlMsPerFrame: POSITIVE_CONTROL_MS_PER_FRAME,
      order: 'full→replay pairs 1/3/5; replay→full pairs 2/4; replay+8ms/rAF after every pair',
      evidenceScope:
        'Vite-dev StrictMode structural #500 release gate: each trusted browser waypoint publishes exactly one producer preview and one consumer preview; deterministic dense same-frame pointer coalescing is guarded by CardShell.resize.test.tsx. The Reading↔Overview crossfade routes wires through mounted DOM edges, so the canvas painter captures and visits zero connections and directly paints one active Card representation while compositing the retained begin-time planes. Render attempts are 2x committed previews and perform three target-only cached graph lookups each; production normalizes to three lookups per committed preview. Full-redraw TaskDuration is a within-head causal diagnostic, not base/head regression evidence; the 64-wire bounded Map/Overview consumer replay/sample is synthetic-only evidence, not cap proof, and maximum-board evidence belongs to #410',
    },
    environment: {
      platform: platform(),
      release: release(),
      node: process.version,
      cpus: cpus().length,
      totalMemoryBytes: totalmem(),
      uptime: execSync('uptime').toString().trim(),
      browserVersion: browser.version(),
      browser: browserEnvironment,
    },
    repetitions,
    positiveControls,
    analysis: {
      taskDurationDiagnostic: { primary, positiveControl },
      replayStructureGreen,
      fullControlGreen,
      releaseStructureGreen,
    },
  }
  mkdirSync(dirname(ARTIFACT_FILE), { recursive: true })
  writeFileSync(ARTIFACT_FILE, `${JSON.stringify(artifact, null, 2)}\n`)

  console.log('\nResize painter replay capture')
  console.table(
    [...repetitions, ...positiveControls].map((capture) => ({
      pair: capture.pair,
      sequence: capture.sequenceInPair,
      arm: capture.arm,
      taskMsPerSecond: capture.mainThreadTaskMsPerSecond.toFixed(1),
      elapsedMs: capture.actualElapsedMs.toFixed(1),
      previews: capture.structural.counters.preview,
      producerPreviews: capture.structural.counters.producerPreview,
      connectionVisits: capture.structural.connectionVisits,
      coldDraws: capture.structural.counters.coldDraw,
      injectedFrames: capture.injectedFrames,
    })),
  )
  console.log('Analysis:', JSON.stringify(artifact.analysis, null, 2))
  console.log(`Raw artifact written to ${ARTIFACT_FILE}`)

  for (const capture of replay) assertReplayStructure(capture, MEASURED_WAYPOINTS)
  for (const capture of positiveControls) assertReplayStructure(capture, MEASURED_WAYPOINTS)
  for (const capture of full) assertFullControl(capture, MEASURED_WAYPOINTS)
  for (const capture of [...repetitions, ...positiveControls]) assertReleaseStructure(capture)
  expect(positiveControls.every((capture) => capture.injectedFrames > 0)).toBe(true)
  expect(positiveControl.movedBeyondObservedNoise).toBe(true)
  expect(replayStructureGreen).toBe(true)
  expect(fullControlGreen).toBe(true)
  expect(releaseStructureGreen).toBe(true)
})

async function assertDisposableStorage(page: Page) {
  expect(EXPECTED_DATA_FILE, 'set EIDO_PERF_DATA_FILE to a disposable scratch path').toBeTruthy()
  const expected = EXPECTED_DATA_FILE!
  const scratchRoots = ['/tmp', '/private/tmp', '/var/folders']
  expect(
    scratchRoots.some((root) => expected === root || expected.startsWith(`${root}/`)),
    `performance storage must be disposable scratch, received ${expected}`,
  ).toBe(true)
  const response = await page.request.get('/api/eido/status')
  expect(response.ok(), 'disk status endpoint must be reachable before fixture load').toBe(true)
  const status = (await response.json()) as { ok?: boolean; dataFile?: string }
  expect(status.ok).toBe(true)
  expect(status.dataFile ?? null).toBe(expected)
}

async function normalizeActiveCard(page: Page) {
  const normalized = await page.evaluate(
    ({ cardId, position, size, zIndex }) => {
      const store = (window as DevWindow).__eido
      if (!store) throw new Error('Missing Eido store')
      const state = store.getState()
      const cards = state.cards.map((card) =>
        card.id === cardId
          ? { ...card, position: { ...position }, size: { ...size }, zIndex }
          : card,
      )
      store.setState({ cards, selection: null, selectedCardIds: [], activeTool: 'select' })
      const active = cards.find((card) => card.id === cardId)
      const incident = state.connections.filter(
        (connection) => connection.from.cardId === cardId || connection.to.cardId === cardId,
      ).length
      const positionCollisions = cards.filter(
        (card) =>
          card.id !== cardId &&
          card.position.x === position.x &&
          card.position.y === position.y,
      ).length
      return { active, incident, positionCollisions }
    },
    { cardId: ACTIVE_CARD_ID, position: ACTIVE_POSITION, size: ACTIVE_SIZE, zIndex: ACTIVE_Z_INDEX },
  )
  expect(normalized.active).toMatchObject({
    id: ACTIVE_CARD_ID,
    position: ACTIVE_POSITION,
    size: ACTIVE_SIZE,
  })
  expect(normalized.incident).toBeGreaterThan(0)
  expect(normalized.positionCollisions).toBe(0)
}

async function pinCanonicalViewport(page: Page) {
  for (let pin = 0; pin < 2; pin += 1) {
    await page.evaluate(
      ({ position, size, zoom }) => {
        const flow = document.querySelector('.react-flow')
        const rect = flow?.getBoundingClientRect()
        const setViewport = (window as DevWindow).__EIDO_SET_VIEWPORT__
        if (!rect || !setViewport) throw new Error('Missing viewport runtime')
        const centerX = position.x + size.width / 2
        const centerY = position.y + size.height / 2
        setViewport({
          x: rect.width / 2 - centerX * zoom,
          y: rect.height / 2 - centerY * zoom,
          zoom,
        })
      },
      {
        position: ACTIVE_POSITION,
        size: ACTIVE_SIZE,
        zoom: READING_OVERVIEW_CROSSFADE_ZOOM,
      },
    )
    await page.waitForTimeout(260)
  }
  await waitForFrames(page, 4)
  await page.evaluate(() => (window as DevWindow).__EIDO_FORCE_OVERVIEW_DRAW__?.())
}

async function selectActiveCard(page: Page) {
  const node = page.locator(
    `.react-flow__node.eido-visual-card-node[data-id="${ACTIVE_CARD_ID}"]:not(.react-flow__node-gestureProxy)`,
  )
  try {
    await node.waitFor({ state: 'visible', timeout: 45_000 })
  } catch (error) {
    const diagnostic = await crossfadeEligibilitySnapshot(page).catch(() => null)
    throw new Error(
      `Missing canonical active non-proxy CardShell; eligibility=${JSON.stringify(diagnostic)}; cause=${String(error)}`,
    )
  }
  await expect(page.locator(`.react-flow__node-gestureProxy[data-id="${ACTIVE_CARD_ID}"]`)).toHaveCount(0)
  const shell = node.locator('.card')
  const box = await shell.boundingBox()
  if (!box) throw new Error('Missing active CardShell')
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
  await expect(node).toHaveClass(/selected/)
  await node.locator('.card-resize-handle.bottom.right').waitFor({ state: 'visible', timeout: 10_000 })
}

async function runWarmup(page: Page, arm: Arm) {
  await prepareGesture(page, arm, false)
  await driveWaypoints(page, WARMUP_WAYPOINTS, false)
  await page.mouse.up()
  await waitForResizeConvergence(page)
}

async function captureGesture({
  page,
  cdp,
  pair,
  sequenceInPair,
  arm,
  positiveControl,
  waypointCount,
}: {
  page: Page
  cdp: CDPSession
  pair: number
  sequenceInPair: number
  arm: Arm
  positiveControl: boolean
  waypointCount: number
}): Promise<CaptureResult> {
  await prepareGesture(page, arm, true)
  const before = await taskDurationSeconds(cdp)
  await page.evaluate(
    ({ injectMs }) => {
      const runtime = (window as DevWindow).__EIDO_RESIZE_REPLAY_CAPTURE__
      if (!runtime) throw new Error('Missing resize replay capture runtime')
      runtime.active = true
      runtime.measurementStartedAt = performance.now()
      if (injectMs > 0) {
        const dev = window as DevWindow
        const control = { active: true, msPerFrame: injectMs, frames: 0 }
        dev.__EIDO_RESIZE_POSITIVE_CONTROL__ = control
        const run = () => {
          if (!control.active || dev.__EIDO_RESIZE_POSITIVE_CONTROL__ !== control) return
          const startedAt = performance.now()
          while (performance.now() - startedAt < control.msPerFrame) {
            // Deliberately occupy the renderer once per animation frame.
          }
          control.frames += 1
          requestAnimationFrame(run)
        }
        requestAnimationFrame(run)
      }
    },
    { injectMs: positiveControl ? POSITIVE_CONTROL_MS_PER_FRAME : 0 },
  )
  const driven = await driveWaypoints(page, waypointCount, true)
  const after = await taskDurationSeconds(cdp)
  const releaseSnapshot = await releaseGesture(page)

  const taskDurationMs = Math.max(0, after - before) * 1_000
  return {
    pair,
    sequenceInPair,
    arm: positiveControl ? 'replay-positive-control' : arm,
    actualElapsedMs: driven.elapsedMs,
    taskDurationMs,
    mainThreadTaskMsPerSecond: taskDurationMs / Math.max(driven.elapsedMs / 1_000, 0.001),
    injectedFrames: driven.injectedFrames,
    structural: driven.structural,
    release: releaseSnapshot,
    capturedAt: new Date().toISOString(),
    hostLoad: execSync('uptime').toString().trim(),
  }
}

async function prepareGesture(page: Page, arm: Arm, captureLifecycle: boolean) {
  await waitForPersistenceQuiescence(page)
  await assertCanonicalCrossfadeEligibility(page)
  await page.evaluate(({ nextArm, shouldCaptureLifecycle, activeCardId }) => {
    const runtime = (window as DevWindow).__EIDO_RESIZE_REPLAY_CAPTURE__
    const store = (window as DevWindow).__eido
    const sceneEligibility = (window as DevWindow).__EIDO_RESIZE_REPLAY_SCENE__
    if (!runtime) throw new Error('Missing resize replay capture runtime')
    if (!store) throw new Error('Missing Eido store')
    if (!sceneEligibility) throw new Error('Missing committed Board scene eligibility probe')
    runtime.arm = nextArm
    runtime.active = false
    runtime.captureLifecycle = shouldCaptureLifecycle
    runtime.reset()
    ;(window as DevWindow).__EIDO_RESIZE_REPLAY_PROBE__?.unsubscribeStore()
    if (shouldCaptureLifecycle) {
      const state = store.getState()
      const activeCardIndex = state.cards.findIndex((card) => card.id === activeCardId)
      const unrelatedCardIndex = state.cards.findIndex((card) => card.id !== activeCardId)
      const unrelatedCard = state.cards[unrelatedCardIndex]
      if (activeCardIndex < 0) throw new Error('Missing active probe Card')
      if (!unrelatedCard) throw new Error('Missing unrelated probe Card')
      const unsubscribeStore = store.subscribe(() => runtime.count('storeNotification'))
      ;(window as DevWindow).__EIDO_RESIZE_REPLAY_PROBE__ = {
        cards: state.cards,
        undoStack: state.undoStack,
        intentLog: state.intentLog,
        unrelatedCard,
        activeCardIndex,
        unrelatedCardIndex,
        boardChangeSeq: state.boardChangeSeq,
        undoDepth: state.undoStack.length,
        resizeEventCount: state.intentLog.filter((event) => event.type === 'card.resized').length,
        activeSize: state.cards[activeCardIndex]?.size ?? null,
        saveState: state.saveState,
        sceneEligibility,
        unsubscribeStore,
      }
    } else {
      delete (window as DevWindow).__EIDO_RESIZE_REPLAY_PROBE__
    }
  }, { nextArm: arm, shouldCaptureLifecycle: captureLifecycle, activeCardId: ACTIVE_CARD_ID })
  const handle = page.locator(
    `.react-flow__node.eido-visual-card-node[data-id="${ACTIVE_CARD_ID}"]:not(.react-flow__node-gestureProxy) .card-resize-handle.bottom.right`,
  )
  const box = await handle.boundingBox()
  if (!box) throw new Error('Missing active resize handle')
  const center = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  await page.mouse.move(center.x, center.y)
  await page.mouse.down()
  const prepared = await page.waitForFunction(
    (expected) =>
      (() => {
        const canvas = document.querySelector<HTMLElement>('[data-board-overview-layer]')
        return (
          Number(canvas?.dataset.connectionCandidateCount ?? -1) === expected &&
          Number(canvas?.dataset.renderedConnectionCount ?? -1) === expected &&
          Number(canvas?.dataset.resizeHotCapturedConnectionCount ?? -1) === expected &&
          Number(canvas?.dataset.resizeHotIncidentConnectionCount ?? -1) === expected &&
          Boolean(canvas?.dataset.resizeHotSessionId)
        )
      })(),
    EXPECTED_CROSSFADE_PAINTER_CONNECTIONS,
    { polling: 'raf', timeout: 2_000 },
  )
  await prepared.dispose()
  if (captureLifecycle) {
    const beginCount = await page.evaluate(
      () => (window as DevWindow).__EIDO_RESIZE_REPLAY_CAPTURE__?.counters.producerBegin ?? 0,
    )
    expect(beginCount).toBe(1)
  }
}

async function waitForPersistenceQuiescence(page: Page) {
  // A prior release arms makeDebouncedSaver's 600 ms timer. Drain it while
  // capture is inactive so its saveState notifications cannot contaminate the
  // next held-gesture window or TaskDuration sample.
  await page.evaluate(() => {
    if ((window as DevWindow).__EIDO_RESIZE_REPLAY_CAPTURE__?.active) {
      throw new Error('Persistence quiescence must run outside active capture')
    }
  })
  await page.waitForTimeout(700)
  await page.waitForFunction(
    () => (window as DevWindow).__eido?.getState().saveState === 'saved',
    undefined,
    { timeout: 5_000 },
  )
  await page.evaluate(() => {
    if ((window as DevWindow).__EIDO_RESIZE_REPLAY_CAPTURE__?.active) {
      throw new Error('Persistence quiescence reactivated capture')
    }
  })
}

async function driveWaypoints(page: Page, waypointCount: number, captureSnapshot: boolean) {
  const handle = page.locator(
    `.react-flow__node.eido-visual-card-node[data-id="${ACTIVE_CARD_ID}"]:not(.react-flow__node-gestureProxy) .card-resize-handle.bottom.right`,
  )
  const box = await handle.boundingBox()
  if (!box) throw new Error('Missing active browser resize handle')
  const pointerId = await page.evaluate(
    () => (window as DevWindow).__EIDO_RESIZE_REPLAY_CAPTURE__?.pointerId ?? null,
  )
  if (pointerId === null) throw new Error('Missing trusted browser resize session')
  const origin = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  let terminalPoint = origin
  for (let index = 1; index <= waypointCount; index += 1) {
    const phase = index % 80
    const triangle = phase <= 40 ? phase : 80 - phase
    terminalPoint = {
      x: origin.x + 12.25 + triangle * 0.8,
      y: origin.y + 8.25 + triangle * 0.5,
    }
    // One trusted Playwright sample defines this waypoint. The following page
    // rAF is a completion barrier before the next waypoint; deterministic
    // fake-rAF CardShell tests own dense same-frame input coalescing.
    await page.mouse.move(terminalPoint.x, terminalPoint.y, {
      steps: TRUSTED_SAMPLES_PER_WAYPOINT,
    })
    if (captureSnapshot) {
      const observed = await page.evaluate(async () => {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
        const counters = (window as DevWindow).__EIDO_RESIZE_REPLAY_CAPTURE__?.counters
        return counters
          ? {
              trustedPointerMove: counters.trustedPointerMove,
              producerPreview: counters.producerPreview,
              consumerPreview: counters.preview,
            }
          : null
      })
      expect(observed, `missing trusted resize counters at waypoint ${index}`).not.toBeNull()
      expect(observed?.trustedPointerMove, `trusted samples at waypoint ${index}`).toBe(index)
      expect(observed?.producerPreview, `producer previews at waypoint ${index}`).toBe(index)
      expect(observed?.consumerPreview, `consumer previews at waypoint ${index}`).toBe(index)
    } else {
      await waitForFrames(page, 1)
    }
  }

  const captured = await page.evaluate(
    ({ captureSnapshot, counterNames }) => {
      const runtime = (window as DevWindow).__EIDO_RESIZE_REPLAY_CAPTURE__
      if (!runtime) throw new Error('Missing resize replay capture runtime')
      const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
      if (!canvas) throw new Error('Missing overview canvas')
      const counters = Object.fromEntries(
        counterNames.map((name) => [name, runtime.counters[name] ?? 0]),
      ) as CounterSnapshot
      const control = (window as DevWindow).__EIDO_RESIZE_POSITIVE_CONTROL__
      const injectedFrames = control?.frames ?? 0
      if (control) control.active = false
      delete (window as DevWindow).__EIDO_RESIZE_POSITIVE_CONTROL__
      const elapsedMs = captureSnapshot ? performance.now() - runtime.measurementStartedAt : 0
      const store = (window as DevWindow).__eido
      const probe = (window as DevWindow).__EIDO_RESIZE_REPLAY_PROBE__
      const sceneEligibility = (window as DevWindow).__EIDO_RESIZE_REPLAY_SCENE__
      const state = store?.getState()
      const activeCard = state && probe ? state.cards[probe.activeCardIndex] : undefined
      const unrelatedCard = state && probe ? state.cards[probe.unrelatedCardIndex] : undefined
      const diagnostic = (window as DevWindow).__EIDO_RESIZE_RF_DIAGNOSTIC__
      const cold = diagnostic?.snapshot()
      const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
      const viewportZoom = viewport
        ? new DOMMatrix(getComputedStyle(viewport).transform).a
        : Number.NaN
      return {
        elapsedMs,
        injectedFrames,
        structural: {
          counters,
          dispatchedPointerSamples: counters.trustedPointerMove,
          candidateConnections: Number(canvas.dataset.connectionCandidateCount ?? 0),
          renderedConnections: Number(canvas.dataset.renderedConnectionCount ?? 0),
          capturedConnections: Number(canvas.dataset.resizeHotCapturedConnectionCount ?? 0),
          incidentConnections: Number(canvas.dataset.resizeHotIncidentConnectionCount ?? 0),
          connectionVisits: Number(canvas.dataset.resizeHotConnectionVisits ?? 0),
          cardVisits: Number(canvas.dataset.resizeHotCardVisits ?? 0),
          representationPaintCount: Number(canvas.dataset.resizeHotRepresentationPaintCount ?? 0),
          crossfade: {
            viewportZoom,
            readingOpacity: Number(canvas.dataset.readingCardOpacity ?? -1),
            overviewOpacity: Number(canvas.dataset.overviewCardOpacity ?? -1),
          },
          heldGraph: {
            cardsIdentityHeld: Boolean(state && probe && state.cards === probe.cards),
            undoIdentityHeld: Boolean(state && probe && state.undoStack === probe.undoStack),
            intentIdentityHeld: Boolean(state && probe && state.intentLog === probe.intentLog),
            saveStateHeld: Boolean(state && probe && state.saveState === probe.saveState),
            sceneEligibilityHeld: Boolean(
              probe && sceneEligibility === probe.sceneEligibility,
            ),
            sceneEligibility: sceneEligibility ?? null,
            unrelatedCardIdentityHeld: Boolean(probe && unrelatedCard === probe.unrelatedCard),
            boardChangeDelta: state && probe ? state.boardChangeSeq - probe.boardChangeSeq : -1,
            baselineStoredSize: probe?.activeSize ?? null,
            storedSize: activeCard?.size ?? null,
            hotSessionId: canvas.dataset.resizeHotSessionId ?? null,
            hotSize:
              canvas.dataset.resizeHotWidth && canvas.dataset.resizeHotHeight
                ? {
                    width: Number(canvas.dataset.resizeHotWidth),
                    height: Number(canvas.dataset.resizeHotHeight),
                  }
                : null,
            reactFlow: diagnostic && cold ? {
              notifications: diagnostic.notifications,
              dimensionChanges: diagnostic.dimensionChanges,
              measuredMapClones: diagnostic.measuredMapClones,
              renderIndexGets: cold.renderIndexDelta.gets,
              incrementalUpdates: cold.renderIndexDelta.incrementalUpdates,
              cardsPatched: cold.renderIndexDelta.cardsPatched,
              boundsUpdated: cold.renderIndexDelta.boundsUpdated,
              rankEpochDelta: cold.rankEpochDelta,
              fullRebuilds:
                cold.renderIndexDelta.fullRebuilds.initial +
                cold.renderIndexDelta.fullRebuilds.cardStructure +
                cold.renderIndexDelta.fullRebuilds.connections,
            } : null,
            graphCardLookupIds: [...runtime.graphCardLookupIds],
          },
        } satisfies StructuralSnapshot,
      }
    },
    {
      captureSnapshot,
      counterNames: COUNTER_NAMES,
    },
  )
  return captured
}

async function releaseGesture(page: Page): Promise<ReleaseSnapshot> {
  // The trusted driver already left the physical cursor at the terminal
  // sample. Release is the only operation here, so no extra preview can race
  // the terminal flush.
  await page.mouse.up()
  const immediate = await page.evaluate(({ counterNames }) => {
    const dev = window as DevWindow
    const runtime = dev.__EIDO_RESIZE_REPLAY_CAPTURE__
    const probe = dev.__EIDO_RESIZE_REPLAY_PROBE__
    const state = dev.__eido?.getState()
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    if (!runtime || !probe || !state || !canvas) throw new Error('Missing release probe state')
    const activeCard = state.cards[probe.activeCardIndex]
    const unrelatedCard = state.cards[probe.unrelatedCardIndex]
    const terminalHotSize =
      canvas.dataset.resizeHotWidth && canvas.dataset.resizeHotHeight
        ? {
            width: Number(canvas.dataset.resizeHotWidth),
            height: Number(canvas.dataset.resizeHotHeight),
          }
        : null
    return {
      retainedImmediately: Boolean(canvas.dataset.resizeHotSessionId),
      hotSessionIdImmediately: canvas.dataset.resizeHotSessionId ?? null,
      capturedConnectionsImmediately: Number(canvas.dataset.resizeHotCapturedConnectionCount ?? 0),
      storedSize: activeCard?.size ?? null,
      terminalHotSize,
      unrelatedCardIdentityHeld: unrelatedCard === probe.unrelatedCard,
      boardChangeDelta: state.boardChangeSeq - probe.boardChangeSeq,
      undoDelta: state.undoStack.length - probe.undoDepth,
      resizeEventDelta:
        state.intentLog.filter((event) => event.type === 'card.resized').length - probe.resizeEventCount,
      counters: Object.fromEntries(
        counterNames.map((name) => [name, runtime.counters[name] ?? 0]),
      ) as CounterSnapshot,
    }
  }, { counterNames: COUNTER_NAMES })
  await waitForResizeConvergence(page)
  const afterClear = await page.evaluate(() => {
    const dev = window as DevWindow
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    if (!canvas) throw new Error('Missing overview canvas after resize convergence')
    const acknowledgement = {
      count: dev.__EIDO_RESIZE_REPLAY_CAPTURE__?.acknowledgements.length ?? 0,
      record: dev.__EIDO_RESIZE_REPLAY_CAPTURE__?.acknowledgements[0] ?? null,
      coordinatorSamples: [
        ...(dev.__EIDO_RESIZE_REPLAY_CAPTURE__?.coordinatorSamples ?? []),
      ],
    }
    const converged = {
      hotSessionId: canvas.dataset.resizeHotSessionId ?? null,
      hotWidth: canvas.dataset.resizeHotWidth ?? null,
      hotHeight: canvas.dataset.resizeHotHeight ?? null,
    }
    if (dev.__EIDO_RESIZE_REPLAY_CAPTURE__) {
      dev.__EIDO_RESIZE_REPLAY_CAPTURE__.active = false
      dev.__EIDO_RESIZE_REPLAY_CAPTURE__.captureLifecycle = false
    }
    dev.__EIDO_RESIZE_REPLAY_PROBE__?.unsubscribeStore()
    delete dev.__EIDO_RESIZE_REPLAY_PROBE__
    return { acknowledgement, converged }
  })
  return { ...immediate, ...afterClear }
}

async function waitForResizeConvergence(page: Page) {
  try {
    await page.waitForFunction(
      () => !document.querySelector<HTMLElement>('[data-board-overview-layer]')?.dataset.resizeHotSessionId,
      undefined,
      { polling: 'raf', timeout: 5_000 },
    )
  } catch (error) {
    const terminalTimeouts = await page.evaluate(() => [
      ...((window as DevWindow).__EIDO_RESIZE_REPLAY_CAPTURE__?.terminalTimeouts ?? []),
    ]).catch(() => [])
    throw new Error(
      `Resize terminal geometry did not converge; terminalTimeouts=${JSON.stringify(terminalTimeouts)}; cause=${String(error)}`,
    )
  }
}

async function stopPositiveControl(page: Page) {
  await page.evaluate(() => {
    const dev = window as DevWindow
    if (dev.__EIDO_RESIZE_POSITIVE_CONTROL__) dev.__EIDO_RESIZE_POSITIVE_CONTROL__.active = false
    delete dev.__EIDO_RESIZE_POSITIVE_CONTROL__
  }).catch(() => undefined)
}

async function crossfadeEligibilitySnapshot(page: Page): Promise<CrossfadeEligibilitySnapshot> {
  return page.evaluate((activeCardId) => {
    const dev = window as DevWindow
    const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
    const canvas = document.querySelector<HTMLCanvasElement>('[data-board-overview-layer]')
    if (!viewport || !canvas) throw new Error('Missing crossfade DOM')
    const matrix = new DOMMatrix(getComputedStyle(viewport).transform)
    const visualCardSelector =
      '.react-flow__node.eido-visual-card-node:not(.react-flow__node-gestureProxy)'
    const proxySelector = '.react-flow__node-gestureProxy'
    return {
      viewportZoom: matrix.a,
      readingOpacity: Number(canvas.dataset.readingCardOpacity ?? -1),
      overviewOpacity: Number(canvas.dataset.overviewCardOpacity ?? -1),
      canvasOccludingReactCardCount: Number(canvas.dataset.reactCardCount ?? -1),
      painterCandidateConnections: Number(canvas.dataset.connectionCandidateCount ?? -1),
      painterRenderedConnections: Number(canvas.dataset.renderedConnectionCount ?? -1),
      mountedVisualCardCount: document.querySelectorAll(visualCardSelector).length,
      activeNonProxyCardCount: document.querySelectorAll(
        `${visualCardSelector}[data-id="${activeCardId}"]`,
      ).length,
      gestureProxyCount: document.querySelectorAll(proxySelector).length,
      activeGestureProxyCount: document.querySelectorAll(
        `${proxySelector}[data-id="${activeCardId}"]`,
      ).length,
      scene: dev.__EIDO_RESIZE_REPLAY_SCENE__ ?? null,
    }
  }, ACTIVE_CARD_ID)
}

async function waitForCanonicalCrossfadeEligibility(page: Page) {
  try {
    await page.waitForFunction(
      ({ zoom, maxDetailCards, maxTextWeight, painterConnections }) => {
        const scene = (window as DevWindow).__EIDO_RESIZE_REPLAY_SCENE__
        const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
        const canvas = document.querySelector<HTMLElement>('[data-board-overview-layer]')
        if (!scene || !viewport || !canvas) return false
        const viewportZoom = new DOMMatrix(getComputedStyle(viewport).transform).a
        return (
          Math.abs(viewportZoom - zoom) < 1e-6 &&
          Math.abs(Number(canvas.dataset.readingCardOpacity ?? -1) - 0.5) < 1e-6 &&
          Math.abs(Number(canvas.dataset.overviewCardOpacity ?? -1) - 0.5) < 1e-6 &&
          Number(canvas.dataset.reactCardCount ?? -1) === 0 &&
          Number(canvas.dataset.connectionCandidateCount ?? -1) === painterConnections &&
          Number(canvas.dataset.renderedConnectionCount ?? -1) === painterConnections &&
          scene.visibleCardCount > 0 &&
          scene.detailCardCount > 0 &&
          scene.detailCardCount <= maxDetailCards &&
          scene.visibleCardCount === scene.detailCardCount &&
          scene.visibleConnectionCount > 0 &&
          scene.fullyDetailed &&
          !scene.useCanvasConnections &&
          scene.showConnections &&
          Math.abs(scene.readingCardOpacity - 0.5) < 1e-6 &&
          scene.boardDetailTextWeight <= maxTextWeight
        )
      },
      {
        zoom: READING_OVERVIEW_CROSSFADE_ZOOM,
        maxDetailCards: MAX_CROSSFADE_DETAIL_CARDS,
        maxTextWeight: MAX_FULL_DETAIL_TEXT_WEIGHT,
        painterConnections: EXPECTED_CROSSFADE_PAINTER_CONNECTIONS,
      },
      { polling: 'raf', timeout: 10_000 },
    )
  } catch (error) {
    const diagnostic = await crossfadeEligibilitySnapshot(page).catch(() => null)
    throw new Error(
      `Canonical crossfade routing did not settle; eligibility=${JSON.stringify(diagnostic)}; cause=${String(error)}`,
    )
  }
  const routed = await crossfadeEligibilitySnapshot(page)
  assertCanonicalCrossfadeRouting(routed)

  try {
    await page.waitForFunction(
      (activeCardId) => {
        const scene = (window as DevWindow).__EIDO_RESIZE_REPLAY_SCENE__
        if (!scene) return false
        const visualCardSelector =
          '.react-flow__node.eido-visual-card-node:not(.react-flow__node-gestureProxy)'
        return (
          document.querySelectorAll(visualCardSelector).length === scene.detailCardCount &&
          document.querySelectorAll(`${visualCardSelector}[data-id="${activeCardId}"]`).length === 1 &&
          document.querySelectorAll('.react-flow__node-gestureProxy').length === 0
        )
      },
      ACTIVE_CARD_ID,
      { polling: 'raf', timeout: 45_000 },
    )
  } catch (error) {
    const diagnostic = await crossfadeEligibilitySnapshot(page).catch(() => null)
    throw new Error(
      `Canonical crossfade DOM residency did not settle; eligibility=${JSON.stringify(diagnostic)}; cause=${String(error)}`,
    )
  }

  return assertCanonicalCrossfadeEligibility(page)
}

async function assertCanonicalCrossfadeEligibility(page: Page) {
  const eligibility = await crossfadeEligibilitySnapshot(page)
  assertCanonicalCrossfadeRouting(eligibility)
  const failures: string[] = []
  if (eligibility.mountedVisualCardCount !== eligibility.scene!.detailCardCount) {
    failures.push('mounted visual Card count must equal the committed detail count')
  }
  if (eligibility.activeNonProxyCardCount !== 1) {
    failures.push('the active Card must be one real non-proxy CardShell')
  }
  if (eligibility.gestureProxyCount !== 0 || eligibility.activeGestureProxyCount !== 0) {
    failures.push('crossfade eligibility must contain no gesture proxies')
  }
  if (failures.length > 0) {
    throw new Error(
      `Canonical crossfade DOM eligibility failed: ${failures.join('; ')}; snapshot=${JSON.stringify(eligibility)}`,
    )
  }
  return eligibility
}

function assertCanonicalCrossfadeRouting(eligibility: CrossfadeEligibilitySnapshot) {
  const scene = eligibility.scene
  const failures: string[] = []
  if (Math.abs(eligibility.viewportZoom - READING_OVERVIEW_CROSSFADE_ZOOM) >= 1e-6) {
    failures.push(`viewport zoom must be ${READING_OVERVIEW_CROSSFADE_ZOOM}`)
  }
  if (Math.abs(eligibility.readingOpacity - 0.5) >= 1e-6) {
    failures.push('Reading opacity must be 0.5')
  }
  if (Math.abs(eligibility.overviewOpacity - 0.5) >= 1e-6) {
    failures.push('Overview opacity must be 0.5')
  }
  if (!scene) {
    failures.push('the committed Board scene probe must exist')
  } else {
    if (scene.visibleCardCount <= 0) failures.push('the scene must contain visible Cards')
    if (scene.detailCardCount <= 0 || scene.detailCardCount > MAX_CROSSFADE_DETAIL_CARDS) {
      failures.push(`detail Cards must be within 1..${MAX_CROSSFADE_DETAIL_CARDS}`)
    }
    if (scene.visibleCardCount !== scene.detailCardCount) {
      failures.push('visible and detail Card counts must match')
    }
    if (!scene.fullyDetailed) failures.push('the scene must be fully detailed')
    if (scene.useCanvasConnections) {
      failures.push('Reading crossfade connections must route through mounted DOM edges')
    }
    if (!scene.showConnections) failures.push('the connected graph must show connections')
    if (scene.visibleConnectionCount <= 0) {
      failures.push('the committed scene must retain visible DOM-edge connections')
    }
    if (Math.abs(scene.readingCardOpacity - 0.5) >= 1e-6) {
      failures.push('the committed scene Reading opacity must be 0.5')
    }
    if (scene.boardDetailTextWeight > MAX_FULL_DETAIL_TEXT_WEIGHT) {
      failures.push(`detail text weight must not exceed ${MAX_FULL_DETAIL_TEXT_WEIGHT}`)
    }
  }
  if (eligibility.canvasOccludingReactCardCount !== 0) {
    failures.push('partially opaque DOM Cards must not occlude the canvas body')
  }
  if (
    eligibility.painterCandidateConnections !== EXPECTED_CROSSFADE_PAINTER_CONNECTIONS ||
    eligibility.painterRenderedConnections !== EXPECTED_CROSSFADE_PAINTER_CONNECTIONS
  ) {
    failures.push('the crossfade canvas painter must own zero wires')
  }
  if (failures.length > 0) {
    throw new Error(
      `Canonical crossfade routing eligibility failed: ${failures.join('; ')}; snapshot=${JSON.stringify(eligibility)}`,
    )
  }
}

async function taskDurationSeconds(cdp: CDPSession) {
  const response = (await cdp.send('Performance.getMetrics')) as {
    metrics: Array<{ name: string; value: number }>
  }
  return response.metrics.find((metric) => metric.name === 'TaskDuration')?.value ?? 0
}

function replayStructureIsGreen(capture: CaptureResult) {
  const { counters } = capture.structural
  return (
    counters.preview === MEASURED_WAYPOINTS &&
    counters.producerBegin === 1 &&
    counters.producerPreview === MEASURED_WAYPOINTS &&
    counters.producerCommit === 0 &&
    counters.producerAbort === 0 &&
    capture.structural.dispatchedPointerSamples === MEASURED_WAYPOINTS &&
    capture.structural.candidateConnections === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    capture.structural.renderedConnections === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    capture.structural.capturedConnections === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    capture.structural.incidentConnections === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    capture.structural.connectionVisits === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    capture.structural.cardVisits === counters.producerPreview &&
    capture.structural.representationPaintCount === 1 &&
    canonicalCrossfadeIsGreen(capture.structural.crossfade) &&
    zeroColdCounters(counters) &&
    zeroHeldMutationCounters(counters) &&
    activeProducerAccessesAreBounded(capture) &&
    heldGraphIsGreen(capture)
  )
}

function fullControlIsValid(capture: CaptureResult) {
  const { counters } = capture.structural
  return (
    counters.preview === MEASURED_WAYPOINTS &&
    counters.producerBegin === 1 &&
    counters.producerPreview === MEASURED_WAYPOINTS &&
    counters.producerCommit === 0 &&
    counters.producerAbort === 0 &&
    capture.structural.dispatchedPointerSamples === MEASURED_WAYPOINTS &&
    capture.structural.candidateConnections === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    capture.structural.renderedConnections === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    capture.structural.capturedConnections === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    capture.structural.incidentConnections === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    capture.structural.connectionVisits === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    canonicalCrossfadeIsGreen(capture.structural.crossfade) &&
    counters.coldDraw > 0 &&
    counters.query > 0 &&
    counters.planner > 0 &&
    counters.rfRead > 0 &&
    zeroHeldMutationCounters(counters) &&
    activeProducerAccessesAreBounded(capture) &&
    heldGraphIsGreen(capture)
  )
}

function releaseStructureIsGreen(capture: CaptureResult) {
  const { release, structural } = capture
  return (
    release.retainedImmediately &&
    release.hotSessionIdImmediately === structural.heldGraph.hotSessionId &&
    release.capturedConnectionsImmediately === EXPECTED_CROSSFADE_PAINTER_CONNECTIONS &&
    release.storedSize !== null &&
    release.terminalHotSize !== null &&
    release.storedSize.width === release.terminalHotSize.width &&
    release.storedSize.height === release.terminalHotSize.height &&
    release.unrelatedCardIdentityHeld &&
    release.boardChangeDelta === 1 &&
    release.undoDelta === 1 &&
    release.resizeEventDelta === 1 &&
    release.counters.producerBegin === 1 &&
    release.counters.producerPreview === structural.counters.producerPreview &&
    release.counters.trustedPointerMove === structural.counters.trustedPointerMove &&
    release.counters.producerCommit === 1 &&
    release.counters.producerAbort === 0 &&
    release.counters.sizeWrite === 1 &&
    release.counters.historyCommit === 1 &&
    release.counters.measurementReport === 1 &&
    release.counters.persistenceCall === 1 &&
    release.counters.persistenceEnqueue === 1 &&
    acknowledgementIsGreen(capture) &&
    coordinatorClearIsFirstEligible(capture) &&
    release.converged.hotSessionId === null &&
    release.converged.hotWidth === null &&
    release.converged.hotHeight === null
  )
}

function acknowledgementIsGreen(capture: CaptureResult) {
  const { acknowledgement, storedSize } = capture.release
  const record = acknowledgement.record
  const hot = record?.hotFrame
  const graph = record?.graphCard
  const node = record?.node
  if (acknowledgement.count !== 1 || !record || !hot || !graph || !graph.size || !node || !storedSize) {
    return false
  }
  const size = hot.geometry.size
  const position = hot.geometry.position
  return (
    record.cardId === ACTIVE_CARD_ID &&
    hot.cardId === ACTIVE_CARD_ID &&
    String(record.sessionId) === capture.structural.heldGraph.hotSessionId &&
    record.sessionId === hot.sessionId &&
    hot.phase === 'settling' &&
    record.nodeMatchesTerminal &&
    record.postClearIsNull &&
    graph.position.x === position.x &&
    graph.position.y === position.y &&
    graph.size.width === size.width &&
    graph.size.height === size.height &&
    storedSize.width === size.width &&
    storedSize.height === size.height &&
    Math.abs(node.positionAbsolute.x - position.x) <= 0.01 &&
    Math.abs(node.positionAbsolute.y - position.y) <= 0.01 &&
    Math.abs((node.measured.width ?? 0) - size.width) <=
      REACT_FLOW_MEASURED_DIMENSION_TOLERANCE_PX &&
    Math.abs((node.measured.height ?? 0) - size.height) <=
      REACT_FLOW_MEASURED_DIMENSION_TOLERANCE_PX &&
    handleBoundsMatch(
      node.sourceHandles,
      node.positionAbsolute,
      hot.geometry,
      hot.endpointOffsets?.source,
    ) &&
    handleBoundsMatch(
      node.targetHandles,
      node.positionAbsolute,
      hot.geometry,
      hot.endpointOffsets?.target,
    )
  )
}

function coordinatorClearIsFirstEligible(capture: CaptureResult) {
  const { acknowledgement } = capture.release
  const record = acknowledgement.record
  const terminal = record?.hotFrame
  const samples = acknowledgement.coordinatorSamples
  const heldSessionId = capture.structural.heldGraph.hotSessionId
  if (!record || !terminal || heldSessionId === null || samples.length < 2) return false

  const samplesRetainTerminal = samples.every((sample) =>
    sample.stableFrames === 2 &&
    sample.frame.cardId === ACTIVE_CARD_ID &&
    String(sample.frame.sessionId) === heldSessionId &&
    sample.frame.phase === 'settling' &&
    sample.hotFrame?.cardId === sample.frame.cardId &&
    sample.hotFrame.sessionId === sample.frame.sessionId &&
    sample.hotFrame.phase === 'settling' &&
    JSON.stringify(sample.frame.geometry) === JSON.stringify(terminal.geometry) &&
    JSON.stringify(sample.hotFrame.geometry) === JSON.stringify(terminal.geometry)
  )
  if (!samplesRetainTerminal) return false

  const isFullMatch = (sample: ResizeCoordinatorSampleRecord) =>
    sample.state.graph === 'matching' && sample.state.node === 'matching'
  let expectedMatchingFramesBefore = 0
  let expectedAbsentNodeFramesBefore = 0
  const coordinatorCountersAlign = samples.every((sample) => {
    const aligned =
      sample.matchingFramesBefore === expectedMatchingFramesBefore &&
      sample.absentNodeGraphFramesBefore === expectedAbsentNodeFramesBefore
    expectedMatchingFramesBefore = isFullMatch(sample) ? expectedMatchingFramesBefore + 1 : 0
    expectedAbsentNodeFramesBefore =
      sample.state.graph === 'matching' && sample.state.node === 'absent'
        ? expectedAbsentNodeFramesBefore + 1
        : 0
    return aligned
  })
  if (!coordinatorCountersAlign) return false
  const firstConsecutiveMatchEnd = samples.findIndex(
    (sample, index) => index > 0 && isFullMatch(samples[index - 1]!) && isFullMatch(sample),
  )
  const acknowledgementSampleIndex = record.coordinatorSampleCount - 1
  return (
    firstConsecutiveMatchEnd >= 1 &&
    acknowledgementSampleIndex === firstConsecutiveMatchEnd &&
    acknowledgementSampleIndex === samples.length - 1 &&
    samples[acknowledgementSampleIndex]?.matchingFramesBefore === 1
  )
}

function handleBoundsMatch(
  handles: NonNullable<ResizeAcknowledgeRecord['node']>['sourceHandles'],
  nodePosition: { x: number; y: number },
  geometry: { position: { x: number; y: number }; size: { width: number; height: number } },
  expectedOffset: { x: number; y: number } | undefined,
) {
  return handles.length > 0 && handles.every((handle) => {
    const center = {
      x: nodePosition.x + handle.x + handle.width / 2,
      y: nodePosition.y + handle.y + handle.height / 2,
    }
    const canonical =
      handle.position === 'left'
        ? { x: geometry.position.x, y: geometry.position.y + geometry.size.height / 2 }
        : handle.position === 'top'
          ? { x: geometry.position.x + geometry.size.width / 2, y: geometry.position.y }
          : handle.position === 'bottom'
            ? {
                x: geometry.position.x + geometry.size.width / 2,
                y: geometry.position.y + geometry.size.height,
              }
            : {
                x: geometry.position.x + geometry.size.width,
                y: geometry.position.y + geometry.size.height / 2,
              }
    const actualOffset = { x: center.x - canonical.x, y: center.y - canonical.y }
    return (
      Math.abs(actualOffset.x - (expectedOffset?.x ?? 0)) <= 1 &&
      Math.abs(actualOffset.y - (expectedOffset?.y ?? 0)) <= 1
    )
  })
}

function zeroColdCounters(counters: CounterSnapshot) {
  return [
    counters.coldDraw,
    counters.query,
    counters.cardById,
    counters.planner,
    counters.label,
    counters.scene,
    counters.metric,
    counters.mountPlan,
    counters.rfRead,
    counters.indexWork,
    counters.rank,
    counters.unrelatedCardShellRender,
    counters.unrelatedCardShellCommit,
    counters.graphProjectionBuild,
    counters.graphIndexCacheMiss,
    counters.storeNotification,
  ].every((value) => value === 0)
}

function activeProducerAccessesAreBounded(capture: CaptureResult) {
  const { counters, heldGraph } = capture.structural
  const commits = counters.activeCardShellCommit
  const renderAttempts = counters.activeCardShellRender
  const expectedAccesses = renderAttempts * 3
  return (
    commits > 0 &&
    commits <= counters.producerPreview &&
    renderAttempts === commits * 2 &&
    counters.graphAccess === expectedAccesses &&
    counters.graphCardLookup === expectedAccesses &&
    heldGraph.graphCardLookupIds.length === expectedAccesses &&
    heldGraph.graphCardLookupIds.every((cardId) => cardId === ACTIVE_CARD_ID)
  )
}

function zeroHeldMutationCounters(counters: CounterSnapshot) {
  return [
    counters.sizeWrite,
    counters.historyCommit,
    counters.measurementReport,
    counters.persistenceCall,
    counters.persistenceEnqueue,
  ].every(
    (value) => value === 0,
  )
}

function canonicalCrossfadeIsGreen(crossfade: StructuralSnapshot['crossfade']) {
  return (
    Math.abs(crossfade.viewportZoom - READING_OVERVIEW_CROSSFADE_ZOOM) < 1e-6 &&
    Math.abs(crossfade.readingOpacity - 0.5) < 1e-6 &&
    Math.abs(crossfade.overviewOpacity - 0.5) < 1e-6
  )
}

function committedSceneEligibilityIsGreen(scene: BoardSceneEligibilitySnapshot | null) {
  return Boolean(
    scene &&
    scene.visibleCardCount > 0 &&
    scene.detailCardCount > 0 &&
    scene.detailCardCount <= MAX_CROSSFADE_DETAIL_CARDS &&
    scene.visibleCardCount === scene.detailCardCount &&
    scene.visibleConnectionCount > 0 &&
    scene.fullyDetailed &&
    !scene.useCanvasConnections &&
    scene.showConnections &&
    Math.abs(scene.readingCardOpacity - 0.5) < 1e-6 &&
    scene.boardDetailTextWeight <= MAX_FULL_DETAIL_TEXT_WEIGHT
  )
}

function heldGraphIsGreen(capture: CaptureResult) {
  const { heldGraph } = capture.structural
  return (
    heldGraph.cardsIdentityHeld &&
    heldGraph.undoIdentityHeld &&
    heldGraph.intentIdentityHeld &&
    heldGraph.saveStateHeld &&
    heldGraph.sceneEligibilityHeld &&
    committedSceneEligibilityIsGreen(heldGraph.sceneEligibility) &&
    heldGraph.unrelatedCardIdentityHeld &&
    heldGraph.boardChangeDelta === 0 &&
    JSON.stringify(heldGraph.storedSize) === JSON.stringify(heldGraph.baselineStoredSize) &&
    heldGraph.hotSessionId !== null &&
    heldGraph.hotSize !== null &&
    heldGraph.reactFlow !== null &&
    Object.values(heldGraph.reactFlow).every((value) => value === 0)
  )
}

function assertSmokeStructure(capture: CaptureResult, waypointCount: number) {
  const { counters } = capture.structural
  expect(counters.preview).toBe(waypointCount)
  expect(counters.producerBegin).toBe(1)
  expect(counters.producerPreview).toBe(waypointCount)
  expect(counters.producerCommit).toBe(0)
  expect(counters.producerAbort).toBe(0)
  expect(capture.structural.dispatchedPointerSamples).toBe(waypointCount)
  expect(capture.structural.candidateConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.renderedConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.capturedConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.incidentConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.connectionVisits).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(zeroColdCounters(counters)).toBe(true)
  expect(zeroHeldMutationCounters(counters)).toBe(true)
  expect(heldGraphIsGreen(capture)).toBe(true)
}

function assertReplayStructure(capture: CaptureResult, waypointCount: number) {
  expect(capture.structural.counters.preview).toBe(waypointCount)
  expect(capture.structural.counters.producerBegin).toBe(1)
  expect(capture.structural.counters.producerPreview).toBe(waypointCount)
  expect(capture.structural.counters.producerCommit).toBe(0)
  expect(capture.structural.counters.producerAbort).toBe(0)
  expect(capture.structural.dispatchedPointerSamples).toBe(waypointCount)
  expect(capture.structural.candidateConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.renderedConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.capturedConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.incidentConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.connectionVisits).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.cardVisits).toBe(capture.structural.counters.producerPreview)
  expect(capture.structural.representationPaintCount).toBe(1)
  expect(capture.structural.crossfade.viewportZoom).toBeCloseTo(
    READING_OVERVIEW_CROSSFADE_ZOOM,
    6,
  )
  expect(capture.structural.crossfade.readingOpacity).toBeCloseTo(0.5, 6)
  expect(capture.structural.crossfade.overviewOpacity).toBeCloseTo(0.5, 6)
  expect(zeroColdCounters(capture.structural.counters)).toBe(true)
  expect(zeroHeldMutationCounters(capture.structural.counters)).toBe(true)
  expect(activeProducerAccessesAreBounded(capture)).toBe(true)
  expect(heldGraphIsGreen(capture)).toBe(true)
}

function assertFullControl(capture: CaptureResult, waypointCount: number) {
  expect(capture.structural.counters.preview).toBe(waypointCount)
  expect(capture.structural.counters.producerBegin).toBe(1)
  expect(capture.structural.counters.producerPreview).toBe(waypointCount)
  expect(capture.structural.counters.producerCommit).toBe(0)
  expect(capture.structural.counters.producerAbort).toBe(0)
  expect(capture.structural.dispatchedPointerSamples).toBe(waypointCount)
  expect(capture.structural.candidateConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.renderedConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.capturedConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.incidentConnections).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.connectionVisits).toBe(EXPECTED_CROSSFADE_PAINTER_CONNECTIONS)
  expect(capture.structural.crossfade.viewportZoom).toBeCloseTo(
    READING_OVERVIEW_CROSSFADE_ZOOM,
    6,
  )
  expect(capture.structural.crossfade.readingOpacity).toBeCloseTo(0.5, 6)
  expect(capture.structural.crossfade.overviewOpacity).toBeCloseTo(0.5, 6)
  expect(capture.structural.counters.coldDraw).toBeGreaterThan(0)
  expect(capture.structural.counters.query).toBeGreaterThan(0)
  expect(capture.structural.counters.planner).toBeGreaterThan(0)
  expect(capture.structural.counters.rfRead).toBeGreaterThan(0)
  expect(zeroHeldMutationCounters(capture.structural.counters)).toBe(true)
  expect(activeProducerAccessesAreBounded(capture)).toBe(true)
  expect(heldGraphIsGreen(capture)).toBe(true)
}

function assertReleaseStructure(capture: CaptureResult) {
  expect(capture.release.retainedImmediately).toBe(true)
  expect(capture.release.hotSessionIdImmediately).toBe(capture.structural.heldGraph.hotSessionId)
  expect(capture.release.capturedConnectionsImmediately).toBe(
    EXPECTED_CROSSFADE_PAINTER_CONNECTIONS,
  )
  expect(capture.release.storedSize).toEqual(capture.release.terminalHotSize)
  expect(capture.release.unrelatedCardIdentityHeld).toBe(true)
  expect(capture.release.boardChangeDelta).toBe(1)
  expect(capture.release.undoDelta).toBe(1)
  expect(capture.release.resizeEventDelta).toBe(1)
  expect(capture.release.counters.producerBegin).toBe(1)
  expect(capture.release.counters.producerPreview).toBe(
    capture.structural.counters.producerPreview,
  )
  expect(capture.release.counters.trustedPointerMove).toBe(
    capture.structural.counters.trustedPointerMove,
  )
  expect(capture.release.counters.producerCommit).toBe(1)
  expect(capture.release.counters.producerAbort).toBe(0)
  expect(capture.release.counters.sizeWrite).toBe(1)
  expect(capture.release.counters.historyCommit).toBe(1)
  expect(capture.release.counters.measurementReport).toBe(1)
  expect(capture.release.counters.persistenceCall).toBe(1)
  expect(capture.release.counters.persistenceEnqueue).toBe(1)
  expect(capture.release.acknowledgement.count).toBe(1)
  expect(capture.release.acknowledgement.record).toMatchObject({
    cardId: ACTIVE_CARD_ID,
    hotFrame: { cardId: ACTIVE_CARD_ID, phase: 'settling' },
    nodeMatchesTerminal: true,
    postClearIsNull: true,
  })
  expect(acknowledgementIsGreen(capture)).toBe(true)
  expect(coordinatorClearIsFirstEligible(capture)).toBe(true)
  expect(capture.release.converged).toEqual({ hotSessionId: null, hotWidth: null, hotHeight: null })
}

async function waitForFrames(page: Page, count: number) {
  await page.evaluate(async (frameCount) => {
    for (let frame = 0; frame < frameCount; frame += 1) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    }
  }, count)
}

async function installCaptureInstrumentation(page: Page) {
  await page.addInitScript((activeCardId) => {
    const names: CounterName[] = [
      'preview', 'coldDraw', 'query', 'cardById', 'planner', 'label',
      'scene', 'metric', 'mountPlan', 'rfRead', 'indexWork', 'rank',
      'producerBegin', 'producerPreview', 'producerCommit', 'producerAbort',
      'sizeWrite', 'historyCommit', 'measurementReport',
      'persistenceCall', 'persistenceEnqueue', 'graphAccess', 'unrelatedCardShellRender',
      'activeCardShellRender', 'unrelatedCardShellCommit', 'activeCardShellCommit',
      'graphCardLookup', 'graphProjectionBuild',
      'graphIndexCacheMiss', 'storeNotification',
      'trustedPointerMove',
    ]
    const emptyCounters = () => Object.fromEntries(names.map((name) => [name, 0])) as CounterSnapshot
    const runtime: CaptureRuntime = {
      arm: 'replay',
      active: false,
      captureLifecycle: false,
      pointerId: null,
      measurementStartedAt: 0,
      counters: emptyCounters(),
      acknowledgements: [],
      coordinatorSamples: [],
      terminalTimeouts: [],
      graphCardLookupIds: [],
      reset() {
        this.counters = emptyCounters()
        this.acknowledgements = []
        this.coordinatorSamples = []
        this.terminalTimeouts = []
        this.graphCardLookupIds = []
      },
      count(name) {
        if (this.active) this.counters[name] += 1
      },
      recordLifecycle(type) {
        if (!this.captureLifecycle) return
        const name = {
          begin: 'producerBegin',
          preview: 'producerPreview',
          commit: 'producerCommit',
          abort: 'producerAbort',
        }[type] as CounterName
        this.counters[name] += 1
      },
      recordCardShellCommit(cardId) {
        if (!this.active) return
        this.counters[cardId === activeCardId ? 'activeCardShellCommit' : 'unrelatedCardShellCommit'] += 1
      },
      recordCardShellRender(cardId) {
        if (!this.active) return
        this.counters[cardId === activeCardId ? 'activeCardShellRender' : 'unrelatedCardShellRender'] += 1
      },
      recordAcknowledge(record) {
        if (this.active) this.acknowledgements.push(record)
      },
      recordCoordinatorSample(record) {
        if (this.active) this.coordinatorSamples.push(record)
      },
      recordTerminalTimeout(record) {
        this.terminalTimeouts.push(record)
      },
      recordGraphCardLookup(cardId) {
        if (!this.active) return
        this.counters.graphCardLookup += 1
        this.graphCardLookupIds.push(cardId)
      },
    }
    ;(window as DevWindow).__EIDO_RESIZE_REPLAY_CAPTURE__ = runtime
    window.addEventListener('pointerdown', (event) => {
      runtime.pointerId = event.pointerId
    }, { capture: true })
    window.addEventListener('pointermove', (event) => {
      if (event.isTrusted && event.pointerId === runtime.pointerId && event.buttons === 1) {
        runtime.count('trustedPointerMove')
      }
    }, { capture: true })
  }, ACTIVE_CARD_ID)

  await instrumentRoute(page, '**/src/graph/store.ts*', (source) => {
    let body = instrumentArrowCallback(
      source,
      'const persist = ',
      'globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("persistenceCall");',
      'persistence invocation',
    )
    return replaceOne(
      body,
      'graph: () => graphIndexForBoard(get())',
      'graph: () => { globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("graphAccess"); return graphIndexForBoard(get()); }',
      'graph access',
    )
  })

  await instrumentRoute(page, '**/src/graph/save.ts*', (source) =>
    instrumentArrowCallback(
      source,
      'const schedule = ',
      'globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("persistenceEnqueue");',
      'debounced persistence enqueue',
    ),
  )

  await instrumentRoute(page, '**/src/canvas/cards/CardShell.tsx*', (source) => {
    const withLayoutEffect = bindViteReactLayoutEffect(source)
    return instrumentFunctionStatement(
      withLayoutEffect,
      'function CardShell(',
      'globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.recordCardShellRender(id); useLayoutEffect(() => { globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.recordCardShellCommit(id); });',
      'CardShell commit',
    )
  })

  await instrumentRoute(page, '**/src/graph/graphIndex.ts*', (source) => {
    let body = instrumentFunctionStatement(
      source,
      'function createGraphIndexFromParts(',
      'globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("graphProjectionBuild");',
      'graph projection build',
    )
    body = replaceOne(
      body,
      'misses += 1',
      'globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("graphIndexCacheMiss");\n      misses += 1',
      'graph index cache miss',
    )
    return replaceOne(
      body,
      'cardById(cardId) {',
      'cardById(cardId) {\n      globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.recordGraphCardLookup(cardId);',
      'graph card lookup',
    )
  })

  await instrumentRoute(page, '**/src/canvas/Board.tsx*', (source) => {
    let body = instrumentCommittedBoardSceneProbe(source)
    body = instrumentArrowCallback(
      body,
      'const reportCardResizePreview = useCallback(',
      'globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.recordLifecycle(event.type);',
      'CardShell producer lifecycle',
    )
    body = instrumentArrowCallback(
      body,
      'const reportCardResize = useCallback(',
      'globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("measurementReport");',
      'CardShell measurement report',
    )
    body = instrumentBoardResizeTerminalTimeout(body)
    return replaceOne(
      body,
      'resizeHotGeometryStore.acknowledge(cardId, sessionId)',
      '(() => { const frame = resizeHotGeometryStore.getSnapshot(); const graphCard = useGraph.getState().graph().cardById(cardId); const node = reactFlowStore.getState().nodeLookup.get(cardId); const copyHandles = (handles) => (handles ?? []).map(({ x, y, width, height, position }) => ({ x, y, width, height, position })); const copyOffset = (offset) => offset ? { x: offset.x, y: offset.y } : undefined; const record = { cardId, sessionId, hotFrame: frame ? { cardId: frame.cardId, sessionId: frame.sessionId, phase: frame.phase, geometry: { position: { ...frame.geometry.position }, size: { ...frame.geometry.size } }, endpointOffsets: frame.endpointOffsets ? { source: copyOffset(frame.endpointOffsets.source), target: copyOffset(frame.endpointOffsets.target) } : undefined } : null, graphCard: graphCard ? { position: { ...graphCard.position }, size: graphCard.size ? { ...graphCard.size } : null } : null, node: node ? { positionAbsolute: { ...node.internals.positionAbsolute }, measured: { width: node.measured.width ?? null, height: node.measured.height ?? null }, sourceHandles: copyHandles(node.internals.handleBounds?.source), targetHandles: copyHandles(node.internals.handleBounds?.target) } : null, nodeMatchesTerminal: Boolean(frame && reactFlowNodeMatchesResize(node, frame.geometry, frame.endpointOffsets)), postClearIsNull: false, coordinatorSampleCount: globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.coordinatorSamples.length ?? -1 }; resizeHotGeometryStore.acknowledge(cardId, sessionId); record.postClearIsNull = resizeHotGeometryStore.getSnapshot() === null; globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.recordAcknowledge(record); })()',
      'terminal acknowledgement',
    )
  })

  await instrumentRoute(page, '**/src/canvas/boardResizeHotGeometry.ts*', (source) =>
    instrumentScheduledCoordinatorRead(source),
  )

  await instrumentRoute(page, '**/src/canvas/cards/CardResizeHandles.tsx*', (source) => {
    let body = instrumentBeforeMemberCall(
      source,
      '.setCardSize(id, next.size',
      'globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("sizeWrite");',
      'CardShell size write',
    )
    return instrumentBeforeMemberCall(
      body,
      '.recordCardStructuralChange(',
      'globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("historyCommit");',
      'CardShell history commit',
    )
  })

  await instrumentRoute(page, '**/src/canvas/BoardOverviewLayer.tsx*', (source) => {
    let body = replaceOne(
      source,
      'const drawCurrentViewport = (force = false, hotOverride) => {',
      'const drawCurrentViewport = (force = false, hotOverride) => {\n\t\t\tglobalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("coldDraw");',
      'overview cold draw',
    )
    body = replaceOne(
      body,
      'const paintPublishedResizeFrame = () => {\n\t\t\tconst frame = resizeHotGeometryStore.getSnapshot();',
      'const paintPublishedResizeFrame = () => {\n\t\t\tconst frame = resizeHotGeometryStore.getSnapshot();\n\t\t\tglobalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("preview");\n\t\t\tif (frame && globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.arm === "full-redraw") {\n\t\t\t\tscheduler.markDirty();\n\t\t\t\tdrawCurrentViewport(true, frame);\n\t\t\t\treturn;\n\t\t\t}',
      'overview full-redraw arm',
    )
    return replaceOne(
      body,
      'function reactFlowViewportSnapshot(canvas, fallbackViewport, fallbackViewportSize) {',
      'function reactFlowViewportSnapshot(canvas, fallbackViewport, fallbackViewportSize) {\n\tglobalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("rfRead");',
      'React Flow viewport read',
    )
  })

  await instrumentRoute(page, '**/src/canvas/boardScene.ts*', (source) => {
    let body = instrumentFunction(source, 'export function deriveBoardCardMetrics(', 'metric')
    body = instrumentFunction(body, 'export function createBoardScene(', 'scene')
    body = instrumentFunction(body, 'export function mountPlanForScene(', 'mountPlan')
    return instrumentFunction(body, 'export function planPaintedConnections(', 'planner')
  })

  await instrumentRoute(page, '**/src/canvas/labelLayer.ts*', (source) =>
    instrumentFunction(source, 'export function drawLabels(', 'label'),
  )

  await instrumentRoute(page, '**/src/canvas/renderPlanning.ts*', (source) => {
    let body = replaceOne(
      source,
      'query(viewport, viewportSize, marginPx = DEFAULT_MARGIN_PX, options = {}) {',
      'query(viewport, viewportSize, marginPx = DEFAULT_MARGIN_PX, options = {}) {\n\t\t\tglobalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("query");',
      'render-index query',
    )
    body = replaceOne(
      body,
      'cardById(cardId) {',
      'cardById(cardId) {\n\t\t\tglobalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("cardById");',
      'render-index cardById',
    )
    body = replaceOne(
      body,
      'rankEpoch: () => holder.state.rankEpoch,',
      'rankEpoch: () => { globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("rank"); return holder.state.rankEpoch; },',
      'render-index rank epoch',
    )
    body = instrumentFunction(body, 'export function createBoardRenderIndex(', 'indexWork')
    return replaceOne(
      body,
      'get(cards, connections) {',
      'get(cards, connections) {\n\t\t\tglobalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("indexWork");',
      'render-index cache get',
    )
  })
}

async function instrumentRoute(page: Page, url: string, transform: (source: string) => string) {
  await page.route(url, async (route) => {
    const response = await route.fetch()
    const source = await response.text()
    await route.fulfill({ response, body: transform(source) })
  })
}

function instrumentFunction(source: string, functionPrefix: string, counter: CounterName) {
  return instrumentFunctionStatement(
    source,
    functionPrefix,
    `globalThis.__EIDO_RESIZE_REPLAY_CAPTURE__?.count("${counter}");`,
    functionPrefix,
  )
}

function instrumentFunctionStatement(
  source: string,
  functionPrefix: string,
  statement: string,
  label: string,
) {
  const occurrences = source.split(functionPrefix).length - 1
  if (occurrences !== 1) throw new Error(`Expected one instrumentation function: ${label}; found ${occurrences}`)
  const start = source.indexOf(functionPrefix)
  const bodyMarker = source.indexOf(') {', start + functionPrefix.length)
  const openingBrace = bodyMarker < 0 ? -1 : bodyMarker + 2
  if (openingBrace < 0) throw new Error(`Missing instrumentation body: ${label}`)
  return `${source.slice(0, openingBrace + 1)}\n\t${statement}${source.slice(openingBrace + 1)}`
}

function instrumentArrowCallback(
  source: string,
  callbackPrefix: string,
  statement: string,
  label: string,
) {
  const occurrences = source.split(callbackPrefix).length - 1
  if (occurrences !== 1) throw new Error(`Expected one ${label} callback; found ${occurrences}`)
  const start = source.indexOf(callbackPrefix)
  const arrow = source.indexOf('=> {', start + callbackPrefix.length)
  if (arrow < 0) throw new Error(`Missing ${label} callback body`)
  const openingBrace = arrow + '=> '.length
  return `${source.slice(0, openingBrace + 1)}\n${statement}${source.slice(openingBrace + 1)}`
}

function instrumentBeforeMemberCall(
  source: string,
  memberPrefix: string,
  statement: string,
  label: string,
) {
  const occurrences = source.split(memberPrefix).length - 1
  if (occurrences !== 1) throw new Error(`Expected one ${label} call; found ${occurrences}`)
  const call = source.indexOf(memberPrefix)
  const expressionStart = source.lastIndexOf('useGraph', call)
  if (expressionStart < 0 || call - expressionStart > 120) {
    throw new Error(`Missing ${label} call expression root`)
  }
  return `${source.slice(0, expressionStart)}${statement}\n${source.slice(expressionStart)}`
}

function replaceOne(source: string, marker: string, replacement: string, label: string) {
  const occurrences = source.split(marker).length - 1
  if (occurrences !== 1) throw new Error(`Expected one ${label} marker; found ${occurrences}`)
  return source.replace(marker, replacement)
}
