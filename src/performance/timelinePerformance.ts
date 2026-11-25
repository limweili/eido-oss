import { createPerfBoard, PERF_BOARD_SIZES, type PerfBoardName, type PerfBoardSize } from '../graph/perfFixtures'
import { createTimelineProjector, projectBoardAt, timelineRange, type TimelineProjection } from '../graph/timeline'

export type Measurement = {
  label: string
  ms: number
}

export type TimelinePerformanceResult = {
  caseName: PerfBoardName
  size: PerfBoardSize
  measurements: Measurement[]
  eventCount: number
  endCardCount: number
  maxProjectorProjectionMs: number
  scrub100FramesMs: number
}

export const TIMELINE_PERFORMANCE_BUDGETS = {
  largeProjectorProjectionMs: 5,
  largeScrub100FramesMs: 100,
} as const

export const TIMELINE_PERFORMANCE_CASES: PerfBoardName[] = ['smoke', 'medium', 'large']

export function measureTimelinePerformance(caseName: PerfBoardName): TimelinePerformanceResult {
  const board = createPerfBoard(caseName)
  const measurements: Measurement[] = []
  const range = measure(measurements, 'timelineRange', () => timelineRange(board.intentLog))
  const projector = measure(measurements, 'createTimelineProjector', () => createTimelineProjector(board))

  if (!range || !projector.range) {
    throw new Error(`Cannot measure timeline performance for ${caseName}: no timeline range`)
  }

  const startAt = projector.range.startAt
  const endAt = projector.range.endAt
  const middleAt = new Date(projector.range.startMs + (projector.range.endMs - projector.range.startMs) / 2).toISOString()

  // Projection and scrub are repeated and reported as a median. A single cold
  // call measures the engine warming up as much as the projector, which put
  // these numbers within noise of their budgets and made the check flaky.
  // Building the projector stays a single sample: it happens once per session,
  // so its cold cost is the honest one.
  const startProjection = measureRepeated(measurements, 'projector.projectAt(start)', () => projector.projectAt(startAt))
  measureRepeated(measurements, 'projector.projectAt(middle)', () => projector.projectAt(middleAt))
  const endProjection = measureRepeated(measurements, 'projector.projectAt(end)', () => projector.projectAt(endAt))
  measureRepeated(measurements, 'legacy projectBoardAt(middle)', () => projectBoardAt(board, middleAt))
  measureRepeated(measurements, 'projector scrub 100 frames', () => scrub(projector.projectAt, startAt, endAt))

  return {
    caseName,
    size: PERF_BOARD_SIZES[caseName],
    measurements,
    eventCount: startProjection.eventCount,
    endCardCount: endProjection.cards.length,
    maxProjectorProjectionMs: Math.max(
      measurementMs(measurements, 'projector.projectAt(start)'),
      measurementMs(measurements, 'projector.projectAt(middle)'),
      measurementMs(measurements, 'projector.projectAt(end)'),
    ),
    scrub100FramesMs: measurementMs(measurements, 'projector scrub 100 frames'),
  }
}

export function formatMs(value: number): string {
  return value.toFixed(2)
}

export function timelineResultRows(results: TimelinePerformanceResult[]) {
  return results.map((result) => ({
    fixture: result.caseName,
    cards: result.size.cards,
    connections: result.size.connections,
    events: result.size.timelineEvents,
    rangeMs: formatMs(measurementMs(result.measurements, 'timelineRange')),
    buildProjectorMs: formatMs(measurementMs(result.measurements, 'createTimelineProjector')),
    maxProjectionMs: formatMs(result.maxProjectorProjectionMs),
    legacyMiddleMs: formatMs(measurementMs(result.measurements, 'legacy projectBoardAt(middle)')),
    scrub100FramesMs: formatMs(result.scrub100FramesMs),
  }))
}

export function timelineBudgetRows(results: TimelinePerformanceResult[]) {
  const large = results.find((result) => result.caseName === 'large')
  if (!large) return []

  return [
    {
      budget: 'large max projector projection',
      target: `< ${TIMELINE_PERFORMANCE_BUDGETS.largeProjectorProjectionMs}ms`,
      actual: `${formatMs(large.maxProjectorProjectionMs)}ms`,
      status: large.maxProjectorProjectionMs < TIMELINE_PERFORMANCE_BUDGETS.largeProjectorProjectionMs ? 'pass' : 'fail',
    },
    {
      budget: 'large scrub 100 frames',
      target: `< ${TIMELINE_PERFORMANCE_BUDGETS.largeScrub100FramesMs}ms`,
      actual: `${formatMs(large.scrub100FramesMs)}ms`,
      status: large.scrub100FramesMs < TIMELINE_PERFORMANCE_BUDGETS.largeScrub100FramesMs ? 'pass' : 'fail',
    },
  ]
}

function scrub(projectAt: (at: string) => TimelineProjection, startAt: string, endAt: string): number {
  const startMs = Date.parse(startAt)
  const endMs = Date.parse(endAt)
  let projectedCards = 0
  for (let index = 0; index < 100; index += 1) {
    const progress = index / 99
    const at = new Date(startMs + (endMs - startMs) * progress).toISOString()
    projectedCards += projectAt(at).cards.length
  }
  return projectedCards
}

const TIMELINE_MEASUREMENT_WARMUPS = 2
const TIMELINE_MEASUREMENT_SAMPLES = 5

function measureRepeated<T>(measurements: Measurement[], label: string, fn: () => T): T {
  const samples: number[] = []
  let value!: T
  for (let iteration = 0; iteration < TIMELINE_MEASUREMENT_WARMUPS + TIMELINE_MEASUREMENT_SAMPLES; iteration += 1) {
    const start = performance.now()
    value = fn()
    const ms = performance.now() - start
    if (iteration >= TIMELINE_MEASUREMENT_WARMUPS) samples.push(ms)
  }
  samples.sort((a, b) => a - b)
  measurements.push({ label, ms: samples[Math.floor(samples.length / 2)]! })
  return value
}

function measure<T>(measurements: Measurement[], label: string, fn: () => T): T {
  const start = performance.now()
  const value = fn()
  measurements.push({ label, ms: performance.now() - start })
  return value
}

function measurementMs(measurements: Measurement[], label: string): number {
  return measurements.find((measurement) => measurement.label === label)?.ms ?? Number.NaN
}
