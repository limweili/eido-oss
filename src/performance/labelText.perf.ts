import { expect, test, type Page } from '@playwright/test'
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * Overview label-text cliff gate (E4, #317).
 *
 * Frozen producer contracts (labelLayer.ts, B2 #310 and B3 #311):
 * `paintedLabelCount`, `labelCacheMissesPerFrame`, `cacheEntries`,
 * `cacheBytes`, `drawn`, `dropped`, `ramped`, and
 * `eligibleLabelCandidateCount`. B2 bounds one admissible bitmap at 190,624
 * bytes, the shared cache at 64 MiB, and a frame at 352 labels. The frame's
 * whole working set therefore fits at once and a warmed sweep must settle to
 * zero misses: `MAX_SETTLED_CACHE_MISSES = 0` is budget-derived, not fitted
 * to either fixture. At the measured 9.0 us/render, 112 drawn labels also
 * cross the ~111-render one-millisecond cold-render boundary, making the
 * declutter arm a meaningful text-cliff probe.
 *
 * The first identity operand is deliberately independent: every sample
 * derives visible cards from graph state + the React Flow viewport transform,
 * then applies Overview's all-tier/non-empty-label eligibility rule. It never
 * reads another canvas counter or `__EIDO_OVERVIEW_CARD_IDS__`.
 */

type FixtureName = 'labelDense' | 'declutter'

type LoadAverages = {
  oneMinute: number
  fiveMinutes: number
  fifteenMinutes: number
}

type LabelFrame = {
  frameGapMs: number
  eligibleVisibleCards: number
  paintedLabelCount: number
  labelCacheMissesPerFrame: number
  cacheEntries: number
  cacheBytes: number
  drawn: number
  dropped: number
  ramped: number
  eligibleLabelCandidateCount: number
}

type LabelMeasurement = {
  fixture: FixtureName
  frames: number
  averageFps: number
  minEligibleVisibleCards: number
  maxEligibleVisibleCards: number
  averageEligibleVisibleCards: number
  minDrawn: number
  maxDrawn: number
  averageDrawn: number
  minDropped: number
  maxDropped: number
  averageDropped: number
  minRamped: number
  maxRamped: number
  averageRamped: number
  maxLabelCacheMissesPerFrame: number
  maxCacheEntries: number
  maxCacheBytes: number
  blankFrames: number
}

type LabelTextBaseline = {
  schemaVersion: 1
  capturedFromCommit: string
  capturedAt: string
  loadAverages: LoadAverages
  measurements: Record<FixtureName, LabelMeasurement>
}

const TEST_ENV = globalThis as typeof globalThis & { process?: { env?: Record<string, string | undefined> } }
const CAPTURE = TEST_ENV.process?.env?.EIDO_LABEL_TEXT_CAPTURE === '1'
const BASELINE_FILE = join('src', 'performance', 'baselines', 'labelText.baseline.json')
const OVERVIEW_ZOOM = 0.5
const SAMPLE_FRAMES = 180
const WARM_FRAMES = 120
const MAX_SETTLED_CACHE_MISSES = 0
const MIN_DECLUTTER_DRAWN = 112
const BASELINE_DRAWN_RATIO = 0.95
const MAX_FIFTEEN_MINUTE_LOAD = 3.9
const MAX_ONE_TO_FIFTEEN_MINUTE_RATIO = 1.25

const PAN_START = { x: 80, y: 90, zoom: OVERVIEW_ZOOM }
const PAN_END = { x: -380, y: -40, zoom: OVERVIEW_ZOOM }

test('overview label text accounting and cache cliff', async ({ page }) => {
  test.setTimeout(180_000)
  const beforeLoad = quiescentLoadAverages()
  const baselineSha = mainShaForCapture()
  assertProductionMatchesMain(baselineSha)

  await page.goto('/')
  await page.waitForFunction(() => {
    const runtime = window.__EIDO_PERF__
    const devWindow = window as unknown as {
      __eido?: { getState: () => { hydrated: boolean } }
      __EIDO_SET_VIEWPORT__?: unknown
    }
    return Boolean(runtime && devWindow.__eido?.getState().hydrated && devWindow.__EIDO_SET_VIEWPORT__)
  })

  const measurements = {} as Record<FixtureName, LabelMeasurement>
  for (const fixture of ['labelDense', 'declutter'] as const) {
    const loaded = await page.evaluate((name) => window.__EIDO_PERF__?.loadFixture(name), fixture)
    expect(loaded?.cards).toBe(fixture === 'labelDense' ? 1_500 : 300)
    await setViewportAndWait(page, PAN_START, 4)

    // Admission-first cache + 64 MiB ceiling means one complete sweep makes
    // this fixture's measured path resident. The reverse sweep is measured.
    await pan(page, PAN_START, PAN_END, WARM_FRAMES, false)
    await setViewportAndWait(page, PAN_END, 4)
    const frames = await pan(page, PAN_END, PAN_START, SAMPLE_FRAMES, true)
    assertFrameContracts(fixture, frames)
    measurements[fixture] = summarize(fixture, frames)
  }

  const afterLoad = quiescentLoadAverages()
  const resultRows = Object.values(measurements).map(resultRow)
  console.log('\nOverview label text gate')
  console.table(resultRows)
  console.log('Load averages (1m / 5m / 15m)')
  console.table([beforeLoad, afterLoad])

  if (CAPTURE) {
    const baseline: LabelTextBaseline = {
      schemaVersion: 1,
      capturedFromCommit: baselineSha,
      capturedAt: new Date().toISOString(),
      loadAverages: afterLoad,
      measurements,
    }
    writeFileSync(BASELINE_FILE, `${JSON.stringify(baseline, null, 2)}\n`)
    console.log(`CAPTURED ${BASELINE_FILE} from main@${baselineSha}`)
  } else {
    const baseline = readBaseline()
    expect(baseline.capturedFromCommit).toBe(baselineSha)
    expect(measurements.declutter.averageEligibleVisibleCards).toBe(
      baseline.measurements.declutter.averageEligibleVisibleCards,
    )
    expect(measurements.labelDense.averageEligibleVisibleCards).toBe(
      baseline.measurements.labelDense.averageEligibleVisibleCards,
    )
    expect(measurements.declutter.averageDrawn).toBeGreaterThanOrEqual(
      baseline.measurements.declutter.averageDrawn * BASELINE_DRAWN_RATIO,
    )
  }

  writeResultArtifact({ baselineSha, beforeLoad, afterLoad, measurements })
})

function quiescentLoadAverages(): LoadAverages {
  const output = execSync('uptime').toString()
  const match = output.match(/load averages?:\s*([0-9.]+)[,\s]+([0-9.]+)[,\s]+([0-9.]+)/i)
  if (!match) throw new Error(`Could not parse load averages from uptime: ${output.trim()}`)
  const [, one, five, fifteen] = match
  const oneMinute = Number(one)
  const fiveMinutes = Number(five)
  const fifteenMinutes = Number(fifteen)
  const averages = { oneMinute, fiveMinutes, fifteenMinutes }
  expect(fifteenMinutes, '15-minute load average must be within the capture-lock envelope').toBeLessThanOrEqual(
    MAX_FIFTEEN_MINUTE_LOAD,
  )
  expect(oneMinute, '1-minute load average must not be a transient spike').toBeLessThanOrEqual(
    fifteenMinutes * MAX_ONE_TO_FIFTEEN_MINUTE_RATIO,
  )
  return averages
}

function mainShaForCapture(): string {
  const mainSha = git('rev-parse', 'origin/main')
  const mergeBase = git('merge-base', 'HEAD', 'origin/main')
  expect(mergeBase, 'branch must contain current origin/main before capture').toBe(mainSha)
  return mainSha
}

function assertProductionMatchesMain(mainSha: string) {
  try {
    execSync(
      `git diff --quiet ${mainSha} -- . ':(exclude)src/performance/labelText.perf.ts' ` +
        `':(exclude)src/performance/baselines/labelText.baseline.json'`,
    )
  } catch {
    throw new Error(`Production tree differs from main@${mainSha}; label baseline would not be a main capture`)
  }
}

function git(...args: string[]): string {
  return execSync(`git ${args.join(' ')}`).toString().trim()
}

async function setViewportAndWait(
  page: Page,
  viewport: { x: number; y: number; zoom: number },
  frames: number,
) {
  await page.evaluate(
    async ({ viewport, frames }) => {
      const setViewport = (window as unknown as {
        __EIDO_SET_VIEWPORT__?: (next: { x: number; y: number; zoom: number }) => void
      }).__EIDO_SET_VIEWPORT__
      if (!setViewport) throw new Error('Missing viewport setter')
      setViewport(viewport)
      for (let index = 0; index < frames; index += 1) {
        await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined)))
      }
    },
    { viewport, frames },
  )
}

async function pan(
  page: Page,
  from: { x: number; y: number; zoom: number },
  to: { x: number; y: number; zoom: number },
  frameCount: number,
  collect: boolean,
): Promise<LabelFrame[]> {
  return page.evaluate(
    async ({ from, to, frameCount, collect }) => {
      type FixtureCard = {
        kind: string
        title?: string
        blocks: Array<{ text: string }>
        position: { x: number; y: number }
        size?: { width: number; height: number }
        modV2?: { title?: string }
      }
      const devWindow = window as unknown as {
        __eido?: { getState: () => { cards: FixtureCard[] } }
        __EIDO_SET_VIEWPORT__?: (next: { x: number; y: number; zoom: number }) => void
        __EIDO_FORCE_OVERVIEW_DRAW__?: () => void
      }
      const setViewport = devWindow.__EIDO_SET_VIEWPORT__
      const cards = devWindow.__eido?.getState().cards
      if (!setViewport || !cards) throw new Error('Missing performance runtime state')

      const displayedLabel = (card: FixtureCard): string => {
        if (card.title?.trim()) return card.title.trim()
        const text = card.blocks.map((block) => block.text).join('\n').trim()
        if (text) return text.split('\n')[0]
        if (card.kind === 'mod') return card.modV2?.title ?? 'Mod'
        const fallbacks: Record<string, string> = {
          note: 'Untitled note',
          askAi: 'Ask AI',
          result: 'Result',
          group: 'Group',
          conversation: 'Conversation',
          title: 'Title',
        }
        return fallbacks[card.kind] ?? ''
      }

      const visibleEligibleCount = () => {
        const flow = document.querySelector<HTMLElement>('.react-flow')
        const viewport = document.querySelector<HTMLElement>('.react-flow__viewport')
        if (!flow || !viewport) throw new Error('Missing React Flow viewport')
        const rect = flow.getBoundingClientRect()
        const transform = getComputedStyle(viewport).transform
        const matrix = transform && transform !== 'none' ? new DOMMatrixReadOnly(transform) : null
        const zoom = matrix?.a ?? 1
        const x = matrix?.e ?? 0
        const y = matrix?.f ?? 0
        // Overview admits every priority tier; only an empty displayed label
        // is ineligible. Geometry is independently intersected with the live
        // scene viewport, using the same graph-space size defaults.
        return cards.filter((card) => {
          if (!displayedLabel(card)) return false
          const width = card.size?.width ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 320 : 260)
          const height = card.size?.height ?? (card.kind === 'group' ? 360 : card.kind === 'title' ? 82 : 180)
          const left = card.position.x * zoom + x
          const top = card.position.y * zoom + y
          return left <= rect.width && top <= rect.height && left + width * zoom >= 0 && top + height * zoom >= 0
        }).length
      }

      const numberCounter = (layer: HTMLElement, name: string): number => {
        const value = Number(layer.dataset[name])
        if (!Number.isFinite(value)) throw new Error(`Missing numeric label counter data-${name}`)
        return value
      }

      const frames: LabelFrame[] = []
      let previous = performance.now()
      for (let index = 0; index < frameCount; index += 1) {
        const progress = frameCount <= 1 ? 1 : index / (frameCount - 1)
        setViewport({
          x: from.x + (to.x - from.x) * progress,
          y: from.y + (to.y - from.y) * progress,
          zoom: from.zoom,
        })
        const now = await new Promise<number>((resolve) => requestAnimationFrame(resolve))
        devWindow.__EIDO_FORCE_OVERVIEW_DRAW__?.()
        if (collect) {
          const layer = document.querySelector<HTMLElement>('[data-board-overview-layer]')
          if (!layer) throw new Error('Missing Board overview layer')
          frames.push({
            frameGapMs: now - previous,
            eligibleVisibleCards: visibleEligibleCount(),
            paintedLabelCount: numberCounter(layer, 'paintedLabelCount'),
            labelCacheMissesPerFrame: numberCounter(layer, 'labelCacheMissesPerFrame'),
            cacheEntries: numberCounter(layer, 'cacheEntries'),
            cacheBytes: numberCounter(layer, 'cacheBytes'),
            drawn: numberCounter(layer, 'drawn'),
            dropped: numberCounter(layer, 'dropped'),
            ramped: numberCounter(layer, 'ramped'),
            eligibleLabelCandidateCount: numberCounter(layer, 'eligibleLabelCandidateCount'),
          })
        }
        previous = now
      }
      return frames
    },
    { from, to, frameCount, collect },
  )
}

function assertFrameContracts(fixture: FixtureName, frames: LabelFrame[]) {
  expect(frames).toHaveLength(SAMPLE_FRAMES)
  for (const [index, frame] of frames.entries()) {
    expect(
      frame.eligibleLabelCandidateCount,
      `${fixture} frame ${index}: candidate coverage must come from the independently computed visible set`,
    ).toBe(frame.eligibleVisibleCards)
    expect(frame.drawn + frame.dropped + frame.ramped, `${fixture} frame ${index}: outcome accounting`).toBe(
      frame.eligibleLabelCandidateCount,
    )
    expect(frame.paintedLabelCount, `${fixture} frame ${index}: painted counter contract`).toBe(
      frame.drawn + frame.ramped,
    )
  }

  const blankFrames = frames.filter(
    (frame) => frame.eligibleVisibleCards > 0 && frame.paintedLabelCount === 0,
  ).length
  expect(blankFrames, `${fixture}: eligible label set must never produce a blank label frame`).toBe(0)

  if (fixture === 'declutter') {
    expect(Math.max(...frames.map((frame) => frame.labelCacheMissesPerFrame))).toBeLessThanOrEqual(
      MAX_SETTLED_CACHE_MISSES,
    )
    expect(average(frames.map((frame) => frame.drawn))).toBeGreaterThanOrEqual(MIN_DECLUTTER_DRAWN)
  }
  // labelDense deliberately has no dropped-label ceiling: high dropped is
  // declutter holding the line, not a regression.
}

function summarize(fixture: FixtureName, frames: LabelFrame[]): LabelMeasurement {
  const usefulGaps = frames.slice(1).map((frame) => frame.frameGapMs)
  const durationMs = usefulGaps.reduce((sum, gap) => sum + gap, 0)
  const values = <K extends keyof LabelFrame>(key: K) => frames.map((frame) => frame[key] as number)
  return {
    fixture,
    frames: frames.length,
    averageFps: usefulGaps.length / Math.max(durationMs / 1000, 0.001),
    minEligibleVisibleCards: Math.min(...values('eligibleVisibleCards')),
    maxEligibleVisibleCards: Math.max(...values('eligibleVisibleCards')),
    averageEligibleVisibleCards: average(values('eligibleVisibleCards')),
    minDrawn: Math.min(...values('drawn')),
    maxDrawn: Math.max(...values('drawn')),
    averageDrawn: average(values('drawn')),
    minDropped: Math.min(...values('dropped')),
    maxDropped: Math.max(...values('dropped')),
    averageDropped: average(values('dropped')),
    minRamped: Math.min(...values('ramped')),
    maxRamped: Math.max(...values('ramped')),
    averageRamped: average(values('ramped')),
    maxLabelCacheMissesPerFrame: Math.max(...values('labelCacheMissesPerFrame')),
    maxCacheEntries: Math.max(...values('cacheEntries')),
    maxCacheBytes: Math.max(...values('cacheBytes')),
    blankFrames: frames.filter((frame) => frame.eligibleVisibleCards > 0 && frame.paintedLabelCount === 0).length,
  }
}

function average(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
}

function resultRow(measurement: LabelMeasurement) {
  return {
    fixture: measurement.fixture,
    frames: measurement.frames,
    eligible: `${measurement.minEligibleVisibleCards}-${measurement.maxEligibleVisibleCards}`,
    drawn: `${measurement.minDrawn}-${measurement.maxDrawn}`,
    dropped: `${measurement.minDropped}-${measurement.maxDropped}`,
    ramped: `${measurement.minRamped}-${measurement.maxRamped}`,
    maxMisses: measurement.maxLabelCacheMissesPerFrame,
    cacheEntries: measurement.maxCacheEntries,
    cacheBytes: measurement.maxCacheBytes,
    blankFrames: measurement.blankFrames,
    averageFps: measurement.averageFps.toFixed(2),
  }
}

function readBaseline(): LabelTextBaseline {
  let baseline: LabelTextBaseline
  try {
    baseline = JSON.parse(readFileSync(BASELINE_FILE, 'utf8')) as LabelTextBaseline
  } catch {
    throw new Error(`Missing committed ${BASELINE_FILE}; capture it from main with EIDO_LABEL_TEXT_CAPTURE=1`)
  }
  expect(baseline.schemaVersion).toBe(1)
  expect(baseline.capturedFromCommit).toMatch(/^[0-9a-f]{40}$/)
  return baseline
}

function writeResultArtifact(result: {
  baselineSha: string
  beforeLoad: LoadAverages
  afterLoad: LoadAverages
  measurements: Record<FixtureName, LabelMeasurement>
}) {
  const mode = CAPTURE ? 'control' : 'gate'
  const head = git('rev-parse', '--short', 'HEAD')
  const artifact = join(tmpdir(), `eido-labelText-${mode}-${head}-${Date.now()}.result.json`)
  writeFileSync(
    artifact,
    `${JSON.stringify({ mode, head, capturedAt: new Date().toISOString(), ...result }, null, 2)}\n`,
  )
  console.log(`Result artifact written to ${artifact}`)
}
