import { createPerfBoard, type PerfBoardName, type PerfFixtureName } from '../graph/perfFixtures'
import { useGraph } from '../graph/store'
import type { AppliedMod, Card, Output, RunRecord, SavedBoard } from '../graph/types'
import { cloneDetached } from '../mods/snapshot'
import {
  boardScenePerfCountersSnapshot,
  resetBoardScenePerfCounters,
  type BoardScenePerfCounters,
} from '../canvas/boardScene'
import { createBoardRenderIndex, renderedCardSize } from '../canvas/renderPlanning'

const DEFAULT_NAVIGATION_TARGET_FPS = 60
const DEFAULT_NAVIGATION_TOLERANCE_FPS = 2
const DEFAULT_MIN_REPRESENTED_CARD_RATIO = 0.98
const DEFAULT_MAX_REPRESENTED_CARD_DEFICIT = 2
const DEFAULT_FRAME_GAP_TOLERANCE_MS = 2
const DEFAULT_VISIBLE_REPRESENTATION_PROBE_LIMIT = 160

export type BrowserNavigationClassification =
  | 'target-met'
  | 'display-limited'
  | 'blanking-regression'
  | 'representation-regression'
  | 'app-bottleneck'

export type BrowserNavigationValidationOptions = {
  fixture?: PerfBoardName
  label?: string
  durationMs?: number
  startDelayMs?: number
  targetFps?: number
  toleranceFps?: number
  visibleRepresentationProbeLimit?: number
}

export type BrowserNavigationValidationResult = {
  fixture: string
  targetFps: number
  toleranceFps: number
  displayHz: number
  displayCadenceMs: number
  frames: number
  durationMs: number
  averageFps: number
  sustainedFps: number
  maxFrameGapMs: number
  p95FrameGapMs: number
  p99FrameGapMs: number
  captureSampleWorkMsP95: number
  captureSampleWorkMsMax: number
  forcedOverviewDrawMsP95: number
  forcedOverviewDrawMsMax: number
  expectedGraphMsP95: number
  expectedGraphMsMax: number
  representationProbeMsP95: number
  representationProbeMsMax: number
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
  classification: BrowserNavigationClassification
}

export type BrowserPerformanceSummary = {
  cards: number
  connections: number
  outputs: number
  runs: number
  events: number
}

export type BrowserPerformanceRuntime = {
  loadFixture: (name: PerfFixtureName) => Promise<BrowserPerformanceSummary>
  moveFirstNote: () => void
  typeFirstNote: (text: string) => void
  streamFirstOutput: (chunks?: number) => void
  runNavigationValidation: (options?: BrowserNavigationValidationOptions) => Promise<BrowserNavigationValidationResult>
  runCurrentNavigationValidation: (options?: BrowserNavigationValidationOptions) => Promise<BrowserNavigationValidationResult>
  captureNavigation: (options?: BrowserNavigationValidationOptions) => Promise<BrowserNavigationValidationResult>
  resetBoardScenePerfCounters: () => void
  boardScenePerfCounters: () => BoardScenePerfCounters
  summary: () => BrowserPerformanceSummary
}

export type BrowserCaptureWorkSpan = {
  sample: { startTime: number; endTime: number }
  forcedOverviewDraw: { startTime: number; endTime: number }
  expectedGraph: { startTime: number; endTime: number }
  representationProbe: { startTime: number; endTime: number }
}

declare global {
  interface Window {
    __EIDO_PERF__?: BrowserPerformanceRuntime
    __EIDO_FORCE_OVERVIEW_DRAW__?: () => void
    __EIDO_OVERVIEW_CARD_IDS__?: Set<string>
    __EIDO_PERF_CAPTURE_WORK_SPANS__?: BrowserCaptureWorkSpan[]
  }
}

export function installBrowserPerformanceRuntime() {
  window.__EIDO_PERF__ = {
    async loadFixture(name) {
      await waitForStoreHydration()
      const board = createPerfBoard(name)
      resetStore(board)
      return summary()
    },
    moveFirstNote() {
      const state = useGraph.getState()
      const card = firstCard(state.cards, 'note')
      state.moveCard(card.id, { x: card.position.x + 24, y: card.position.y + 18 }, { recordHistory: false })
    },
    typeFirstNote(text) {
      const state = useGraph.getState()
      const card = firstCard(state.cards, 'note')
      state.setCardText(card.id, text)
    },
    streamFirstOutput(chunks = 50) {
      const state = useGraph.getState()
      const version = firstOutputVersion(state.outputs)
      for (let index = 0; index < chunks; index += 1) {
        state.appendVersionText(version.id, ` chunk-${index}`)
      }
    },
    async runNavigationValidation(options = {}) {
      const fixture = options.fixture ?? 'large'
      const startDelayMs = options.startDelayMs ?? 2000
      const durationMs = options.durationMs ?? 8000
      await waitForStoreHydration()
      resetStore(createPerfBoard(fixture))
      await waitForFrames(4)
      await waitForRenderedNodes()
      showNavigationValidationOverlay(
        `Large performance fixture loaded. Start panning and zooming in ${(startDelayMs / 1000).toFixed(1)}s, then keep moving for ${(durationMs / 1000).toFixed(1)}s.`,
      )
      await sleep(startDelayMs)
      showNavigationValidationOverlay('Recording navigation now. Keep panning and zooming.')
      const result = await captureNavigation({ ...options, fixture, durationMs })
      showNavigationValidationOverlay(formatNavigationValidationResult(result))
      console.table([navigationValidationConsoleRow(result)])
      return result
    },
    async runCurrentNavigationValidation(options = {}) {
      const startDelayMs = options.startDelayMs ?? 2000
      const durationMs = options.durationMs ?? 8000
      await waitForStoreHydration()
      await waitForFrames(4)
      await waitForRenderedNodes()
      showNavigationValidationOverlay(
        `Current board ready. Start panning and zooming in ${(startDelayMs / 1000).toFixed(1)}s, then keep moving for ${(durationMs / 1000).toFixed(1)}s.`,
      )
      await sleep(startDelayMs)
      showNavigationValidationOverlay('Recording current board navigation now. Keep panning and zooming.')
      const result = await captureNavigation({ ...options, label: options.label ?? 'current', durationMs })
      showNavigationValidationOverlay(formatNavigationValidationResult(result))
      console.table([navigationValidationConsoleRow(result)])
      return result
    },
    captureNavigation,
    resetBoardScenePerfCounters,
    boardScenePerfCounters: boardScenePerfCountersSnapshot,
    summary,
  }
}

async function captureNavigation(options: BrowserNavigationValidationOptions = {}): Promise<BrowserNavigationValidationResult> {
  await waitForStoreHydration()
  const fixture = options.label ?? options.fixture ?? 'current'
  const targetFps = options.targetFps ?? DEFAULT_NAVIGATION_TARGET_FPS
  const toleranceFps = options.toleranceFps ?? DEFAULT_NAVIGATION_TOLERANCE_FPS
  const durationMs = options.durationMs ?? 8000
  const visibleRepresentationProbeLimit =
    options.visibleRepresentationProbeLimit ?? DEFAULT_VISIBLE_REPRESENTATION_PROBE_LIMIT
  const displayCadenceMs = await measureFrameCadence(48)
  const displayHz = 1000 / Math.max(displayCadenceMs, 1)
  const state = useGraph.getState()
  const renderIndex = createBoardRenderIndex(state.cards, state.connections)
  const samples: Array<{
    at: number
    nodeCount: number
    edgeCount: number
    fullDetailNodeCount: number
    lowZoomNodeCount: number
    representedCardCount: number
    visibleRepresentationProbeCount: number
    representedVisibleCardCount: number
    missingVisibleCardCount: number
    visibleReactCardCount: number
    overviewRepresentedVisibleCardCount: number
    expectedVisibleCardCount: number
    expectedNodeCount: number
    expectedEdgeCount: number
    viewportZoom: number
  }> = []
  const frameGaps: number[] = []
  const captureSampleWorkMs: number[] = []
  const forcedOverviewDrawMs: number[] = []
  const expectedGraphMs: number[] = []
  const representationProbeMs: number[] = []
  window.__EIDO_PERF_CAPTURE_WORK_SPANS__ = []
  const start = performance.now()
  let previous = start

  await new Promise<void>((resolve) => {
    const step = (now: number) => {
      const sampleStartedAt = performance.now()
      frameGaps.push(now - previous)
      previous = now

      const forcedDrawStartedAt = performance.now()
      window.__EIDO_FORCE_OVERVIEW_DRAW__?.()
      const forcedDrawEndedAt = performance.now()
      forcedOverviewDrawMs.push(forcedDrawEndedAt - forcedDrawStartedAt)

      const expectedGraphStartedAt = performance.now()
      const viewportSnapshot = reactFlowViewportSnapshot()
      const expected = expectedRenderedGraph(renderIndex, viewportSnapshot)
      const expectedGraphEndedAt = performance.now()
      expectedGraphMs.push(expectedGraphEndedAt - expectedGraphStartedAt)

      const representationProbeStartedAt = performance.now()
      const nodeCount = document.querySelectorAll('.react-flow__node').length
      const lowZoomNodeCount = document.querySelectorAll('.react-flow__node-lowZoom').length
      const overview = overviewLayerRepresentation()
      const representedCardCount = overview.coversReactNodes
        ? Math.max(nodeCount, overview.cardCount)
        : nodeCount + overview.cardCount
      const visibleRepresentation = expected.visibleCards.length
        ? visibleCardRepresentation({
            cards: expected.visibleCards,
            probeLimit: visibleRepresentationProbeLimit,
            snapshot: viewportSnapshot,
          })
        : emptyVisibleCardRepresentation()
      samples.push({
        at: now - start,
        nodeCount,
        edgeCount: document.querySelectorAll('.react-flow__edge').length,
        fullDetailNodeCount: nodeCount - lowZoomNodeCount,
        lowZoomNodeCount,
        representedCardCount,
        visibleRepresentationProbeCount: visibleRepresentation.probeCount,
        representedVisibleCardCount: visibleRepresentation.representedCardCount,
        missingVisibleCardCount: visibleRepresentation.missingCardCount,
        visibleReactCardCount: visibleRepresentation.reactCardCount,
        overviewRepresentedVisibleCardCount: visibleRepresentation.overviewCardCount,
        expectedVisibleCardCount: expected.visibleCards.length,
        expectedNodeCount: expected.cards,
        expectedEdgeCount: expected.connections,
        viewportZoom: viewportSnapshot?.viewport.zoom ?? 0,
      })
      const representationProbeEndedAt = performance.now()
      const sampleEndedAt = representationProbeEndedAt
      representationProbeMs.push(representationProbeEndedAt - representationProbeStartedAt)
      captureSampleWorkMs.push(sampleEndedAt - sampleStartedAt)
      window.__EIDO_PERF_CAPTURE_WORK_SPANS__?.push({
        sample: { startTime: sampleStartedAt, endTime: sampleEndedAt },
        forcedOverviewDraw: { startTime: forcedDrawStartedAt, endTime: forcedDrawEndedAt },
        expectedGraph: { startTime: expectedGraphStartedAt, endTime: expectedGraphEndedAt },
        representationProbe: { startTime: representationProbeStartedAt, endTime: representationProbeEndedAt },
      })
      if (now - start >= durationMs) {
        resolve()
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })

  const usefulGaps = frameGaps.slice(1)
  const sortedGaps = [...usefulGaps].sort((a, b) => a - b)
  const p95FrameGapMs = percentile(sortedGaps, 0.95) ?? displayCadenceMs
  const p99FrameGapMs = percentile(sortedGaps, 0.99) ?? p95FrameGapMs
  const duration = Math.max(performance.now() - start, 1)
  const averageFps = (samples.length / duration) * 1000
  const sustainedFps = 1000 / Math.max(p95FrameGapMs, displayCadenceMs, 1)
  const blankFrames = samples.filter(
    (sample) => sample.expectedVisibleCardCount > 0 && sample.representedVisibleCardCount === 0,
  ).length
  const emptyViewportFrames = samples.filter((sample) => sample.expectedVisibleCardCount === 0 && sample.representedCardCount === 0).length
  const minNodeCount = Math.min(...samples.map((sample) => sample.nodeCount))
  const maxNodeCount = Math.max(...samples.map((sample) => sample.nodeCount))
  const minRepresentedCardCount = Math.min(...samples.map((sample) => sample.representedCardCount))
  const maxRepresentedCardCount = Math.max(...samples.map((sample) => sample.representedCardCount))
  const representedRatios = samples
    .filter((sample) => sample.visibleRepresentationProbeCount > 0)
    .map((sample) => Math.min(1, sample.representedVisibleCardCount / sample.visibleRepresentationProbeCount))
  const minRepresentedCardRatio = Math.min(1, ...representedRatios)
  const maxRepresentedCardDeficit = Math.max(0, ...samples.map((sample) => sample.missingVisibleCardCount))
  const minVisibleRepresentationProbeCount = Math.min(...samples.map((sample) => sample.visibleRepresentationProbeCount))
  const maxVisibleRepresentationProbeCount = Math.max(...samples.map((sample) => sample.visibleRepresentationProbeCount))
  const minRepresentedVisibleCardCount = Math.min(...samples.map((sample) => sample.representedVisibleCardCount))
  const maxRepresentedVisibleCardCount = Math.max(...samples.map((sample) => sample.representedVisibleCardCount))
  const maxMissingVisibleCardCount = Math.max(0, ...samples.map((sample) => sample.missingVisibleCardCount))
  const minVisibleReactCardCount = Math.min(...samples.map((sample) => sample.visibleReactCardCount))
  const maxVisibleReactCardCount = Math.max(...samples.map((sample) => sample.visibleReactCardCount))
  const minOverviewRepresentedVisibleCardCount = Math.min(...samples.map((sample) => sample.overviewRepresentedVisibleCardCount))
  const maxOverviewRepresentedVisibleCardCount = Math.max(...samples.map((sample) => sample.overviewRepresentedVisibleCardCount))
  const minFullDetailNodeCount = Math.min(...samples.map((sample) => sample.fullDetailNodeCount))
  const maxFullDetailNodeCount = Math.max(...samples.map((sample) => sample.fullDetailNodeCount))
  const minLowZoomNodeCount = Math.min(...samples.map((sample) => sample.lowZoomNodeCount))
  const maxLowZoomNodeCount = Math.max(...samples.map((sample) => sample.lowZoomNodeCount))
  const minExpectedVisibleCardCount = Math.min(...samples.map((sample) => sample.expectedVisibleCardCount))
  const maxExpectedVisibleCardCount = Math.max(...samples.map((sample) => sample.expectedVisibleCardCount))
  const minExpectedNodeCount = Math.min(...samples.map((sample) => sample.expectedNodeCount))
  const maxExpectedNodeCount = Math.max(...samples.map((sample) => sample.expectedNodeCount))
  const minViewportZoom = Math.min(...samples.map((sample) => sample.viewportZoom))
  const maxViewportZoom = Math.max(...samples.map((sample) => sample.viewportZoom))
  const minimumFps = targetFps - toleranceFps
  const classification = classifyNavigationResult({
    averageFps,
    blankFrames,
    displayCadenceMs,
    displayHz,
    maxRepresentedCardDeficit,
    minRepresentedCardRatio,
    minimumFps,
    p95FrameGapMs,
    sustainedFps,
  })

  return {
    fixture,
    targetFps,
    toleranceFps,
    displayHz,
    displayCadenceMs,
    frames: samples.length,
    durationMs: duration,
    averageFps,
    sustainedFps,
    maxFrameGapMs: Math.max(0, ...usefulGaps),
    p95FrameGapMs,
    p99FrameGapMs,
    captureSampleWorkMsP95: percentile([...captureSampleWorkMs].sort((a, b) => a - b), 0.95) ?? 0,
    captureSampleWorkMsMax: Math.max(0, ...captureSampleWorkMs),
    forcedOverviewDrawMsP95: percentile([...forcedOverviewDrawMs].sort((a, b) => a - b), 0.95) ?? 0,
    forcedOverviewDrawMsMax: Math.max(0, ...forcedOverviewDrawMs),
    expectedGraphMsP95: percentile([...expectedGraphMs].sort((a, b) => a - b), 0.95) ?? 0,
    expectedGraphMsMax: Math.max(0, ...expectedGraphMs),
    representationProbeMsP95: percentile([...representationProbeMs].sort((a, b) => a - b), 0.95) ?? 0,
    representationProbeMsMax: Math.max(0, ...representationProbeMs),
    blankFrames,
    emptyViewportFrames,
    minNodeCount,
    maxNodeCount,
    minRepresentedCardCount,
    maxRepresentedCardCount,
    minRepresentedCardRatio,
    maxRepresentedCardDeficit,
    minVisibleRepresentationProbeCount,
    maxVisibleRepresentationProbeCount,
    minRepresentedVisibleCardCount,
    maxRepresentedVisibleCardCount,
    maxMissingVisibleCardCount,
    minVisibleReactCardCount,
    maxVisibleReactCardCount,
    minOverviewRepresentedVisibleCardCount,
    maxOverviewRepresentedVisibleCardCount,
    minFullDetailNodeCount,
    maxFullDetailNodeCount,
    minLowZoomNodeCount,
    maxLowZoomNodeCount,
    minExpectedVisibleCardCount,
    maxExpectedVisibleCardCount,
    minExpectedNodeCount,
    maxExpectedNodeCount,
    minViewportZoom,
    maxViewportZoom,
    classification,
  }
}

export function classifyNavigationResult({
  averageFps,
  blankFrames,
  displayCadenceMs,
  displayHz,
  maxRepresentedCardDeficit,
  minRepresentedCardRatio,
  minimumFps,
  p95FrameGapMs,
  sustainedFps,
}: {
  averageFps: number
  blankFrames: number
  displayCadenceMs: number
  displayHz: number
  maxRepresentedCardDeficit: number
  minRepresentedCardRatio: number
  minimumFps: number
  p95FrameGapMs: number
  sustainedFps: number
}): BrowserNavigationClassification {
  if (blankFrames > 0) return 'blanking-regression'
  if (
    minRepresentedCardRatio < DEFAULT_MIN_REPRESENTED_CARD_RATIO ||
    maxRepresentedCardDeficit > DEFAULT_MAX_REPRESENTED_CARD_DEFICIT
  ) {
    return 'representation-regression'
  }
  if (displayHz < minimumFps) return 'display-limited'
  const maxTargetFrameGapMs = 1000 / Math.max(minimumFps, 1)
  const maxCadenceFrameGapMs = displayCadenceMs + DEFAULT_FRAME_GAP_TOLERANCE_MS
  const p95MeetsCadence = p95FrameGapMs <= Math.max(maxTargetFrameGapMs, maxCadenceFrameGapMs)
  return averageFps >= minimumFps && (sustainedFps >= minimumFps || p95MeetsCadence)
    ? 'target-met'
    : 'app-bottleneck'
}

async function waitForStoreHydration(timeoutMs = 60000): Promise<void> {
  const deadline = performance.now() + timeoutMs
  while (!useGraph.getState().hydrated) {
    if (performance.now() > deadline) throw new Error('Timed out waiting for Eido store hydration')
    await waitForFrames(1)
  }
}

function resetStore(board: SavedBoard) {
  useGraph.setState({
    cards: board.cards.map(cloneCard),
    connections: board.connections.map((connection) => ({ ...connection })),
    outputs: board.outputs.map(cloneOutput),
    runs: board.runs.map(cloneRun),
    intentLog: [...(board.intentLog ?? [])],
    ideas: [{ id: 'perf-fixture', name: 'Performance fixture', createdAt: board.updatedAt, updatedAt: board.updatedAt, lastOpenedAt: board.updatedAt }],
    currentIdeaId: 'perf-fixture',
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
}

function summary(): BrowserPerformanceSummary {
  const state = useGraph.getState()
  return {
    cards: state.cards.length,
    connections: state.connections.length,
    outputs: state.outputs.length,
    runs: state.runs.length,
    events: state.intentLog.length,
  }
}

async function measureFrameCadence(frameCount: number): Promise<number> {
  const gaps: number[] = []
  let previous = performance.now()
  await new Promise<void>((resolve) => {
    const step = (now: number) => {
      gaps.push(now - previous)
      previous = now
      if (gaps.length >= frameCount) {
        resolve()
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
  const sorted = gaps.slice(2).sort((a, b) => a - b)
  return percentile(sorted, 0.5) ?? 16.7
}

function percentile(sorted: number[], ratio: number): number | undefined {
  if (!sorted.length) return undefined
  const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1))
  return sorted[index]
}

function navigationValidationConsoleRow(result: BrowserNavigationValidationResult) {
  return {
    fixture: result.fixture,
    classification: result.classification,
    displayHz: result.displayHz.toFixed(2),
    sustainedFps: result.sustainedFps.toFixed(2),
    averageFps: result.averageFps.toFixed(2),
    p95FrameGapMs: result.p95FrameGapMs.toFixed(2),
    p99FrameGapMs: result.p99FrameGapMs.toFixed(2),
    maxFrameGapMs: result.maxFrameGapMs.toFixed(2),
    captureSampleWorkMsP95: result.captureSampleWorkMsP95.toFixed(2),
    captureSampleWorkMsMax: result.captureSampleWorkMsMax.toFixed(2),
    forcedOverviewDrawMsP95: result.forcedOverviewDrawMsP95.toFixed(2),
    forcedOverviewDrawMsMax: result.forcedOverviewDrawMsMax.toFixed(2),
    expectedGraphMsP95: result.expectedGraphMsP95.toFixed(2),
    expectedGraphMsMax: result.expectedGraphMsMax.toFixed(2),
    representationProbeMsP95: result.representationProbeMsP95.toFixed(2),
    representationProbeMsMax: result.representationProbeMsMax.toFixed(2),
    blankFrames: result.blankFrames,
    emptyViewportFrames: result.emptyViewportFrames,
    minNodeCount: result.minNodeCount,
    maxNodeCount: result.maxNodeCount,
    minRepresentedCardCount: result.minRepresentedCardCount,
    maxRepresentedCardCount: result.maxRepresentedCardCount,
    minRepresentedCardRatio: result.minRepresentedCardRatio.toFixed(3),
    maxRepresentedCardDeficit: result.maxRepresentedCardDeficit,
    visibleRepresentationProbeCount: `${result.minVisibleRepresentationProbeCount}-${result.maxVisibleRepresentationProbeCount}`,
    representedVisibleCardCount: `${result.minRepresentedVisibleCardCount}-${result.maxRepresentedVisibleCardCount}`,
    maxMissingVisibleCardCount: result.maxMissingVisibleCardCount,
    visibleReactCardCount: `${result.minVisibleReactCardCount}-${result.maxVisibleReactCardCount}`,
    overviewRepresentedVisibleCardCount: `${result.minOverviewRepresentedVisibleCardCount}-${result.maxOverviewRepresentedVisibleCardCount}`,
    minFullDetailNodeCount: result.minFullDetailNodeCount,
    maxFullDetailNodeCount: result.maxFullDetailNodeCount,
    minLowZoomNodeCount: result.minLowZoomNodeCount,
    maxLowZoomNodeCount: result.maxLowZoomNodeCount,
    minExpectedVisibleCardCount: result.minExpectedVisibleCardCount,
    maxExpectedVisibleCardCount: result.maxExpectedVisibleCardCount,
    minExpectedNodeCount: result.minExpectedNodeCount,
    maxExpectedNodeCount: result.maxExpectedNodeCount,
    minViewportZoom: result.minViewportZoom.toFixed(3),
    maxViewportZoom: result.maxViewportZoom.toFixed(3),
  }
}

function formatNavigationValidationResult(result: BrowserNavigationValidationResult): string {
  return [
    `Navigation validation: ${result.classification}`,
    `Display: ${result.displayHz.toFixed(2)}Hz (${result.displayCadenceMs.toFixed(2)}ms cadence)`,
    `Sustained FPS: ${result.sustainedFps.toFixed(2)} against target ${result.targetFps} ± ${result.toleranceFps}`,
    `Frame gaps: p95 ${result.p95FrameGapMs.toFixed(2)}ms, p99 ${result.p99FrameGapMs.toFixed(2)}ms, worst ${result.maxFrameGapMs.toFixed(2)}ms`,
    `Capture callback: p95 ${result.captureSampleWorkMsP95.toFixed(2)}ms, worst ${result.captureSampleWorkMsMax.toFixed(2)}ms; forced draw worst ${result.forcedOverviewDrawMsMax.toFixed(2)}ms; expected graph worst ${result.expectedGraphMsMax.toFixed(2)}ms; representation probe worst ${result.representationProbeMsMax.toFixed(2)}ms`,
    `Blank frames: ${result.blankFrames}; empty viewport frames: ${result.emptyViewportFrames}`,
    `Visible nodes: ${result.minNodeCount}-${result.maxNodeCount}; represented cards: ${result.minRepresentedCardCount}-${result.maxRepresentedCardCount}; expected visible cards: ${result.minExpectedVisibleCardCount}-${result.maxExpectedVisibleCardCount}; mounted-window expected nodes: ${result.minExpectedNodeCount}-${result.maxExpectedNodeCount}`,
    `Representation probes: ${result.minVisibleRepresentationProbeCount}-${result.maxVisibleRepresentationProbeCount}; represented visible cards: ${result.minRepresentedVisibleCardCount}-${result.maxRepresentedVisibleCardCount}; worst missing visible cards ${result.maxMissingVisibleCardCount}`,
    `Representation completeness: min ratio ${result.minRepresentedCardRatio.toFixed(3)}, worst deficit ${result.maxRepresentedCardDeficit}; React visible ${result.minVisibleReactCardCount}-${result.maxVisibleReactCardCount}; overview visible ${result.minOverviewRepresentedVisibleCardCount}-${result.maxOverviewRepresentedVisibleCardCount}`,
    `Full-detail nodes: ${result.minFullDetailNodeCount}-${result.maxFullDetailNodeCount}; overview nodes: ${result.minLowZoomNodeCount}-${result.maxLowZoomNodeCount}`,
    `Viewport zoom range: ${result.minViewportZoom.toFixed(3)}-${result.maxViewportZoom.toFixed(3)}`,
  ].join('\n')
}

function overviewLayerRepresentation(): { cardCount: number; coversReactNodes: boolean } {
  const layer = document.querySelector('[data-board-overview-layer]')
  if (!(layer instanceof HTMLElement)) return { cardCount: 0, coversReactNodes: false }
  const count = Number(layer.dataset.renderedCardCount)
  return {
    cardCount: Number.isFinite(count) ? Math.max(0, count) : 0,
    coversReactNodes: layer.dataset.coversReactNodes === 'true',
  }
}

function expectedRenderedGraph(
  renderIndex: ReturnType<typeof createBoardRenderIndex>,
  snapshot = reactFlowViewportSnapshot(),
) {
  if (!snapshot) return { cards: 0, visibleCards: [], connections: 0 }
  const expected = renderIndex.query(snapshot.viewport, snapshot.viewportSize, undefined, { includeConnections: false })
  const visible = renderIndex.query(snapshot.viewport, snapshot.viewportSize, 0, { includeConnections: false })
  return { cards: expected.cards.length, visibleCards: visible.cards, connections: expected.connections.length }
}

function visibleCardRepresentation({
  cards,
  probeLimit,
  snapshot,
}: {
  cards: Card[]
  probeLimit: number
  snapshot: ReturnType<typeof reactFlowViewportSnapshot>
}) {
  if (!snapshot) return emptyVisibleCardRepresentation()

  const probes = selectVisibleRepresentationProbes(cards, snapshot.viewport, snapshot.viewportSize, probeLimit)
  if (!probes.length) return emptyVisibleCardRepresentation()

  const visibleReactCardIds = visibleReactCardIdsInViewport()
  const overviewCardIds = window.__EIDO_OVERVIEW_CARD_IDS__ ?? new Set<string>()
  let representedCardCount = 0
  let reactCardCount = 0
  let overviewCardCount = 0

  for (const card of probes) {
    if (visibleReactCardIds.has(card.id)) {
      representedCardCount += 1
      reactCardCount += 1
      continue
    }

    if (overviewCardIds.has(card.id)) {
      representedCardCount += 1
      overviewCardCount += 1
    }
  }

  return {
    probeCount: probes.length,
    representedCardCount,
    missingCardCount: Math.max(0, probes.length - representedCardCount),
    reactCardCount,
    overviewCardCount,
  }
}

function emptyVisibleCardRepresentation() {
  return {
    probeCount: 0,
    representedCardCount: 0,
    missingCardCount: 0,
    reactCardCount: 0,
    overviewCardCount: 0,
  }
}

function selectVisibleRepresentationProbes(
  cards: Card[],
  viewport: { x: number; y: number; zoom: number },
  viewportSize: { width: number; height: number },
  probeLimit: number,
): Card[] {
  const maxProbes = Math.max(1, Math.floor(probeLimit))
  if (cards.length <= maxProbes) return cards

  const columns = 12
  const rows = 8
  const byCell = new Map<string, { card: Card; order: number; distanceSq: number }>()

  cards.forEach((card, order) => {
    const bounds = cardScreenBounds(card, viewport)
    const centerX = (bounds.left + bounds.right) / 2
    const centerY = (bounds.top + bounds.bottom) / 2
    const column = Math.max(0, Math.min(columns - 1, Math.floor((centerX / Math.max(viewportSize.width, 1)) * columns)))
    const row = Math.max(0, Math.min(rows - 1, Math.floor((centerY / Math.max(viewportSize.height, 1)) * rows)))
    const key = `${column}:${row}`
    const candidate = {
      card,
      order,
      distanceSq: (centerX - viewportSize.width / 2) ** 2 + (centerY - viewportSize.height / 2) ** 2,
    }
    const current = byCell.get(key)
    if (!current || candidate.distanceSq < current.distanceSq || (candidate.distanceSq === current.distanceSq && order < current.order)) {
      byCell.set(key, candidate)
    }
  })

  const selected = new Map<string, { card: Card; order: number }>()
  for (const candidate of [...byCell.values()].sort((a, b) => a.order - b.order)) {
    if (selected.size >= maxProbes) break
    selected.set(candidate.card.id, candidate)
  }

  const stride = Math.max(1, Math.floor(cards.length / maxProbes))
  for (let index = 0; selected.size < maxProbes && index < cards.length; index += stride) {
    const card = cards[index]
    selected.set(card.id, { card, order: index })
  }

  for (let index = 0; selected.size < maxProbes && index < cards.length; index += 1) {
    const card = cards[index]
    selected.set(card.id, { card, order: index })
  }

  return [...selected.values()].sort((a, b) => a.order - b.order).map((candidate) => candidate.card)
}

function visibleReactCardIdsInViewport(): Set<string> {
  const root = document.querySelector('.react-flow')
  if (!(root instanceof HTMLElement)) return new Set()

  const rootRect = root.getBoundingClientRect()
  const ids = new Set<string>()
  for (const node of root.querySelectorAll<HTMLElement>('.react-flow__node')) {
    const id = node.dataset.id ?? node.getAttribute('data-id')
    if (!id) continue
    const rect = node.getBoundingClientRect()
    if (rect.right >= rootRect.left && rect.left <= rootRect.right && rect.bottom >= rootRect.top && rect.top <= rootRect.bottom) {
      ids.add(id)
    }
  }
  return ids
}

function cardScreenBounds(card: Card, viewport: { x: number; y: number; zoom: number }) {
  const zoom = Number.isFinite(viewport.zoom) ? Math.max(0.01, viewport.zoom) : 1
  const size = renderedCardSize(card)
  const left = card.position.x * zoom + viewport.x
  const top = card.position.y * zoom + viewport.y
  return {
    left,
    top,
    right: left + size.width * zoom,
    bottom: top + size.height * zoom,
  }
}

function reactFlowViewportSnapshot() {
  const viewportElement = document.querySelector('.react-flow__viewport')
  const flowElement = document.querySelector('.react-flow')
  if (!viewportElement || !flowElement) return null

  const flowRect = flowElement.getBoundingClientRect()
  if (flowRect.width <= 0 || flowRect.height <= 0) return null

  const transform = getComputedStyle(viewportElement).transform
  const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
  const zoom = matrix?.a ?? 1
  return {
    viewport: {
      x: matrix?.e ?? 0,
      y: matrix?.f ?? 0,
      zoom,
    },
    viewportSize: {
      width: flowRect.width,
      height: flowRect.height,
    },
  }
}

function showNavigationValidationOverlay(text: string) {
  const id = 'eido-navigation-validation-overlay'
  let overlay = document.getElementById(id)
  if (!overlay) {
    overlay = document.createElement('pre')
    overlay.id = id
    overlay.style.position = 'fixed'
    overlay.style.right = '16px'
    overlay.style.bottom = '16px'
    overlay.style.zIndex = '99999'
    overlay.style.maxWidth = '420px'
    overlay.style.padding = '12px 14px'
    overlay.style.border = '1px solid var(--e-line-strong)'
    overlay.style.borderRadius = '8px'
    overlay.style.background = 'var(--e-surface-floating)'
    overlay.style.color = 'var(--e-ink)'
    overlay.style.font = '12px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace'
    overlay.style.whiteSpace = 'pre-wrap'
    overlay.style.boxShadow = 'var(--e-shadow-lift)'
    document.body.appendChild(overlay)
  }
  overlay.textContent = text
}

function waitForFrames(count: number): Promise<void> {
  return new Promise((resolve) => {
    let remaining = count
    const step = () => {
      remaining -= 1
      if (remaining <= 0) {
        resolve()
        return
      }
      requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  })
}

function waitForRenderedNodes(): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = performance.now() + 60000
    const step = () => {
      if (document.querySelector('.react-flow__node') || overviewLayerRepresentation().cardCount > 0) {
        resolve()
        return
      }
      if (performance.now() > deadline) {
        reject(new Error('Timed out waiting for performance fixture nodes to render'))
        return
      }
      requestAnimationFrame(step)
    }
    step()
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
}

function firstCard(cards: Card[], kind: Card['kind']): Card {
  const card = cards.find((candidate) => candidate.kind === kind)
  if (!card) throw new Error(`Missing ${kind} card for browser performance harness`)
  return card
}

function firstOutputVersion(outputs: Output[]) {
  const version = outputs[0]?.versions[0]
  if (!version) throw new Error('Missing Output Version for browser performance harness')
  return version
}

function cloneCard(card: Card): Card {
  return {
    ...card,
    blocks: card.blocks.map((block) => ({ ...block })),
    assets: card.assets?.map((asset) => ({ ...asset })),
    size: card.size ? { ...card.size } : undefined,
    position: { ...card.position },
  }
}

function cloneOutput(output: Output): Output {
  return {
    ...output,
    versions: output.versions.map((version) => ({
      ...version,
      transcript: version.transcript?.map((message) => ({ ...message })),
    })),
  }
}

function cloneAppliedMod(mod: AppliedMod): AppliedMod {
  return cloneDetached(mod)
}

function cloneRun(run: RunRecord): RunRecord {
  return {
    ...run,
    usedCardIds: [...run.usedCardIds],
    usedConnectionIds: [...run.usedConnectionIds],
    modIds: [...run.modIds],
    appliedMods: run.appliedMods.map(cloneAppliedMod),
  }
}
