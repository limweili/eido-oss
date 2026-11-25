import { describe, expect, it } from 'vitest'
import {
  RICH_CARD_BENCHMARK_CONTRACT,
  RICH_CARD_CHOREOGRAPHY_PROBE,
  RICH_CARD_IMAGE_INGESTION_UNAVAILABLE_METHOD,
  analyzeRichCardBaseline,
  assertRichCardRawArtifact,
  probeRichCardSelection,
  deriveFrameIntervalsFromRafTimestamps,
  renderRichCardBaselineReport,
  type RichCardRawArtifact,
  type RichCardRun,
} from './richCardBenchmark'

function rawArtifact(): RichCardRawArtifact {
  const runs = RICH_CARD_BENCHMARK_CONTRACT.scenarios.flatMap((scenario) =>
    [1, 2, 3].map((repetition) => ({
      scenarioId: scenario.id,
      repetition,
      durationMs: 100 + repetition,
      frameIntervalsMs: [16, 17, repetition === 3 ? 35 : 18],
      missedFrames: repetition === 3 ? 1 : 0,
      slowFrames: repetition === 3 ? 1 : 0,
      longTasks: repetition === 2 ? [{ startTime: 10, duration: 55 }] : [],
      interactionLatencyMs: scenario.id === 'typing' ? 42 : 8,
      residentDom: { min: 100, max: 131 },
      styleLayoutMs: scenario.id === 'typing' ? 24 : 4,
      paintCompositeMs: scenario.id === 'ordinary-reading-pan' ? 31 : 5,
      reactWork: {
        status: 'unavailable' as const,
        reason: 'No production React profiler hook exists.',
        followUp: 'Add a benchmark-only Profiler at the application root without changing renderer policy.',
      },
      memory: { beforeBytes: 10_000, afterBytes: 11_000, supported: true },
      readiness: {
        blankBoardFrames: 0,
        missingRepresentationFrames: 0,
        detailedReadyMs: 45,
        lightweightReadyMs: 0,
        settledImageReadyMs: 12,
      },
      boardWork: { sceneDerivations: 5, cardMetricVisits: scenario.id === 'typing' ? 131 : 0 },
      images: { decodedCount: 8, decodeMs: 6, cacheGrowthBytes: repetition * 100 },
    })),
  )

  return {
    schemaVersion: 2,
    contractId: RICH_CARD_BENCHMARK_CONTRACT.id,
    candidate: { id: 'current-reading-baseline', description: 'Unmodified production renderer policy.' },
    environment: {
      provider: 'github-actions',
      os: 'linux',
      cpu: 'synthetic-ci-cpu',
      logicalCores: 4,
      memoryBytes: 16_000_000_000,
      browser: 'chromium synthetic',
      viewport: { width: 1440, height: 1000, deviceScaleFactor: 1 },
      node: '20.x',
      commit: '0123456789abcdef0123456789abcdef01234567',
      capturedAt: '2026-07-14T00:00:00.000Z',
    },
    repetitionPolicy: RICH_CARD_BENCHMARK_CONTRACT.repetitionPolicy,
    capture: {
      commands: ['npx playwright test --config playwright.performance.config.ts src/performance/richCardBaseline.perf.ts'],
      runner: 'unit-test',
    },
    noise: {
      sharedRunner: true,
      caveats: ['Synthetic unit artifact tests analysis only; it is not retained timing evidence.'],
    },
    fixture: {
      id: 'rich-card-board-v1',
      generationMs: 5,
      cards: 131,
      connections: 150,
      outputs: 2,
      boardJsonBytes: 450_000,
      serializationMs: 3,
      storedImageBytes: 48_000,
      decodedPixelEstimateBytes: 82_000_000,
      imageIngestion: {
        status: 'unavailable',
        value: null,
        method: RICH_CARD_IMAGE_INGESTION_UNAVAILABLE_METHOD,
      },
    },
    correctness: {
      search: { status: 'observed', found: true, method: 'window.find over mounted synthetic text.' },
      selection: { status: 'observed', selectedCharacters: 64, method: 'DOM Selection over synthetic text.' },
      copy: { status: 'unavailable', copiedCharacters: null, method: 'System clipboard was not invoked or read.' },
      accessibility: { status: 'observed', richTextNodes: 12, method: 'Chromium Accessibility.getFullAXTree.' },
    },
    runs,
    trace: { source: 'chromium-cdp', totalStyleLayoutMs: 280, totalPaintCompositeMs: 360 },
  }
}

describe('rich Card benchmark contract and analysis', () => {
  it('derives frame intervals only from consecutive rAF callback timestamps', () => {
    const requestTimeMs = 2_000
    const callbackTimestampsMs = [1_000, 1_016, 1_034]

    expect(deriveFrameIntervalsFromRafTimestamps(callbackTimestampsMs)).toEqual([16, 18])
    // The former mixed-clock initialization would have emitted -1000 here.
    expect(callbackTimestampsMs[0] - requestTimeMs).toBe(-1_000)
    expect(deriveFrameIntervalsFromRafTimestamps([1_000, 999.999])[0]).toBeLessThan(0)
  })

  it('freezes separate candidate-neutral scenario IDs and three-run repetition policy', () => {
    expect(RICH_CARD_BENCHMARK_CONTRACT.repetitionPolicy).toEqual({ repetitions: 3, order: 'scenario-major' })
    expect(RICH_CARD_BENCHMARK_CONTRACT.scenarios.map((scenario) => scenario.id)).toEqual([
      'ordinary-reading-pan',
      'exceptionally-fast-pan',
      'rapid-zoom-out',
      'direction-reversal',
      'rare-far-programmatic-jump',
      'post-gesture-settle',
      'card-body-scroll',
      'selection',
      'hover-before-click',
      'click-before-activation',
      'editing-activation',
      'typing',
      'dragging',
      'connecting',
      'cold-image-traversal',
      'warm-image-revisit',
    ])
  })

  it('keeps the one-run choreography probe separate from evidence acceptance', () => {
    expect(RICH_CARD_CHOREOGRAPHY_PROBE).toEqual({
      evidence: false,
      repetitions: 1,
      stepTimeoutMs: 120_000,
    })

    const probeOnly = rawArtifact()
    probeOnly.runs = probeOnly.runs.filter((run) => run.repetition === 1)
    expect(() => assertRichCardRawArtifact(probeOnly)).toThrow(/three repetitions/i)
  })

  it('rejects missing runs and privacy-bearing environment fields', () => {
    const missing = rawArtifact()
    missing.runs.pop()
    expect(() => assertRichCardRawArtifact(missing)).toThrow(/three repetitions/i)

    const privateArtifact = rawArtifact()
    privateArtifact.environment.cpu = '/Users/example/.eido/eido-v3-ideas.json'
    expect(() => assertRichCardRawArtifact(privateArtifact)).toThrow(/privacy/i)

    const linuxPrivateArtifact = rawArtifact()
    linuxPrivateArtifact.environment.cpu = '/home/example/private-eido-capture.json'
    expect(() => assertRichCardRawArtifact(linuxPrivateArtifact)).toThrow(/privacy/i)
  })

  it('reports selection as observed only when extracted non-whitespace rendered text is selected exactly', async () => {
    let observedTarget: unknown
    expect(
      await probeRichCardSelection(['   ', 'Giant benchmark note'], async (target) => {
        observedTarget = target
        return { selectedText: 'Giant benchmark note' }
      }),
    ).toEqual({
      status: 'observed',
      selectedCharacters: 20,
      method: 'DOM Selection matched a non-whitespace substring rendered by the live synthetic giant Note editor.',
    })
    expect(observedTarget).toEqual({
      nodeIndex: 1,
      startOffset: 0,
      endOffset: 20,
      intendedText: 'Giant benchmark note',
    })

    const unexpectedSelection = async () => {
      throw new Error('selection callback must not run without a non-whitespace text target')
    }
    expect(await probeRichCardSelection(null, unexpectedSelection)).toEqual({
      status: 'unavailable',
      selectedCharacters: null,
      method: expect.stringContaining('render root was absent'),
    })
    expect(await probeRichCardSelection([], unexpectedSelection)).toEqual({
      status: 'unavailable',
      selectedCharacters: null,
      method: expect.stringContaining('no rendered text nodes'),
    })
    expect(
      await probeRichCardSelection([' ', '\n\t'], unexpectedSelection),
    ).toEqual({
      status: 'unavailable',
      selectedCharacters: null,
      method: expect.stringContaining('only whitespace'),
    })
    expect(
      await probeRichCardSelection(['Giant benchmark note'], async () => ({
        selectedText: null,
        failure: 'window.getSelection returned null',
      })),
    ).toEqual({
      status: 'unavailable',
      selectedCharacters: null,
      method: expect.stringContaining('getSelection returned null'),
    })
    expect(
      await probeRichCardSelection(['Giant benchmark note'], async () => ({ selectedText: '' })),
    ).toEqual({
      status: 'unavailable',
      selectedCharacters: null,
      method: expect.stringContaining('did not match'),
    })
    expect(
      await probeRichCardSelection(['Giant benchmark note'], async () => ({
        selectedText: 'Different rendered text',
      })),
    ).toEqual({
      status: 'unavailable',
      selectedCharacters: null,
      method: expect.stringContaining('did not match'),
    })
  })

  it('rejects vacuous observed selection/copy and unavailable image-ingestion values', () => {
    const vacuousSelection = rawArtifact()
    vacuousSelection.correctness.selection = {
      status: 'observed',
      selectedCharacters: 0,
      method: 'DOM Selection returned no selected text.',
    }
    expect(() => assertRichCardRawArtifact(vacuousSelection)).toThrow(/observed selection.*positive/i)

    const vacuousCopy = rawArtifact()
    vacuousCopy.correctness.copy = {
      status: 'observed',
      copiedCharacters: 0,
      method: 'Clipboard copy was not actually invoked.',
    }
    expect(() => assertRichCardRawArtifact(vacuousCopy)).toThrow(/observed clipboard copy.*positive/i)

    for (const imageIngestion of [
      { status: 'estimated', value: 1, method: 'Production paste compression was not invoked.' },
      { status: 'observed', value: 1, method: 'Production paste compression was not invoked.' },
      { status: 'invented', value: null, method: 'Unknown evidence status.' },
      { status: 'unavailable', value: 0, method: 'Production paste compression was not invoked.' },
      { status: 'unavailable', value: null, method: 'Synthetic 1ms ingestion timing.' },
    ]) {
      const invalidIngestion = rawArtifact()
      invalidIngestion.fixture.imageIngestion = imageIngestion as typeof invalidIngestion.fixture.imageIngestion
      expect(() => assertRichCardRawArtifact(invalidIngestion)).toThrow(/image ingestion.*unavailable.*null/i)
    }

    const unknownSelection = rawArtifact()
    ;(unknownSelection.correctness.selection as { status: string }).status = 'invented'
    expect(() => assertRichCardRawArtifact(unknownSelection)).toThrow(/unknown selection status/i)

    const unknownCopy = rawArtifact()
    ;(unknownCopy.correctness.copy as { status: string }).status = 'invented'
    expect(() => assertRichCardRawArtifact(unknownCopy)).toThrow(/unknown clipboard copy status/i)
  })

  const invalidMetricCases: Array<{
    path: string
    value: number
    set: (run: RichCardRun, value: number) => void
  }> = [
    { path: 'durationMs', value: -1, set: (run, value) => { run.durationMs = value } },
    { path: 'frameIntervalsMs[0]', value: -0.001, set: (run, value) => { run.frameIntervalsMs[0] = value } },
    { path: 'missedFrames', value: -2, set: (run, value) => { run.missedFrames = value } },
    { path: 'slowFrames', value: -3, set: (run, value) => { run.slowFrames = value } },
    { path: 'longTasks[0].startTime', value: -4, set: (run, value) => { run.longTasks[0]!.startTime = value } },
    { path: 'longTasks[0].duration', value: -5, set: (run, value) => { run.longTasks[0]!.duration = value } },
    { path: 'interactionLatencyMs', value: -6, set: (run, value) => { run.interactionLatencyMs = value } },
    { path: 'residentDom.min', value: -7, set: (run, value) => { run.residentDom.min = value } },
    { path: 'residentDom.max', value: -8, set: (run, value) => { run.residentDom.max = value } },
    { path: 'styleLayoutMs', value: -9, set: (run, value) => { run.styleLayoutMs = value } },
    { path: 'paintCompositeMs', value: -10, set: (run, value) => { run.paintCompositeMs = value } },
    { path: 'reactWork.valueMs', value: -11, set: (run, value) => { run.reactWork.valueMs = value } },
    { path: 'memory.beforeBytes', value: -12, set: (run, value) => { run.memory.beforeBytes = value } },
    { path: 'memory.afterBytes', value: -13, set: (run, value) => { run.memory.afterBytes = value } },
    {
      path: 'readiness.blankBoardFrames',
      value: -14,
      set: (run, value) => { run.readiness.blankBoardFrames = value },
    },
    {
      path: 'readiness.missingRepresentationFrames',
      value: -15,
      set: (run, value) => { run.readiness.missingRepresentationFrames = value },
    },
    { path: 'readiness.detailedReadyMs', value: -16, set: (run, value) => { run.readiness.detailedReadyMs = value } },
    {
      path: 'readiness.lightweightReadyMs',
      value: -17,
      set: (run, value) => { run.readiness.lightweightReadyMs = value },
    },
    {
      path: 'readiness.settledImageReadyMs',
      value: -18,
      set: (run, value) => { run.readiness.settledImageReadyMs = value },
    },
    { path: 'boardWork.sceneDerivations', value: -19, set: (run, value) => { run.boardWork.sceneDerivations = value } },
    { path: 'boardWork.cardMetricVisits', value: -20, set: (run, value) => { run.boardWork.cardMetricVisits = value } },
    { path: 'images.decodedCount', value: -21, set: (run, value) => { run.images.decodedCount = value } },
    { path: 'images.decodeMs', value: -22, set: (run, value) => { run.images.decodeMs = value } },
  ]

  it.each(invalidMetricCases)(
    'identifies invalid $path by scenario, repetition, exact field path, and value',
    ({ path, value, set }) => {
      const artifact = rawArtifact()
      const run = artifact.runs.find(
        (candidate) => candidate.scenarioId === 'ordinary-reading-pan' && candidate.repetition === 2,
      )
      if (!run) throw new Error('Missing ordinary-reading-pan repetition 2 fixture run')
      set(run, value)

      expect(() => assertRichCardRawArtifact(artifact)).toThrow(
        `Scenario ordinary-reading-pan repetition 2 has invalid non-negative metric at ${path}: ${String(value)}.`,
      )
    },
  )

  it('accepts finite negative cache growth because cache shrinkage is a valid signed delta', () => {
    const artifact = rawArtifact()
    artifact.runs[0]!.images.cacheGrowthBytes = -1

    expect(() => assertRichCardRawArtifact(artifact)).not.toThrow()
  })

  it('aggregates distributions and ranks every required falsifiable contributor', () => {
    const analysis = analyzeRichCardBaseline(rawArtifact())
    const typing = analysis.scenarios.find((scenario) => scenario.scenarioId === 'typing')

    expect(typing).toMatchObject({ repetitions: 3, blankBoardFrames: 0, missingRepresentationFrames: 0 })
    expect(typing?.frameIntervalMs.p95).toBeGreaterThanOrEqual(18)
    expect(analysis.costProfile.map((entry) => entry.id).sort()).toEqual([
      'graph-wide-derivation',
      'rich-markdown-transcript-materialization',
      'store-invalidation',
      'style-layout-paint',
      'whole-board-residency',
    ])
    expect(analysis.costProfile.every((entry) => entry.evidence.length > 0 && entry.falsification.length > 0)).toBe(true)
    expect(analysis.costProfile[0]).toMatchObject({ id: 'whole-board-residency', score: 3 })
    expect(analysis.costProfile.every((entry) => Number.isInteger(entry.score) && entry.score >= 1 && entry.score <= 3)).toBe(true)
  })

  it('renders a reproducible evidence report without selecting a renderer', () => {
    const report = renderRichCardBaselineReport(rawArtifact())

    expect(report).toContain('npm run perf:report')
    expect(report).toContain('Observed browser metrics')
    expect(report).toContain('Deterministic estimates')
    expect(report).toContain('Unavailable instrumentation ledger')
    expect(report).toContain('Ingestion/compression is **unavailable**:')
    expect(report).not.toMatch(/Ingestion\/compression.*(?:0ms|unavailablems)/)
    expect(report).toContain('Selection: **observed**, selected characters=64')
    expect(report).toContain('Clipboard copy: **unavailable**, copied characters=unavailable')
    expect(report).toContain('No renderer winner')
    expect(report).not.toMatch(/recommended renderer|winner:/i)
  })
})
