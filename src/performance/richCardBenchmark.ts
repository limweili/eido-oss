export const RICH_CARD_BENCHMARK_CONTRACT = {
  id: 'eido-rich-card-reading-v1',
  fixtureId: 'rich-card-board-v1',
  repetitionPolicy: { repetitions: 3, order: 'scenario-major' as const },
  scenarios: [
    scenario('ordinary-reading-pan', 'navigation', 'Drag the Reading viewport 360px over 12 pointer steps.'),
    scenario('exceptionally-fast-pan', 'navigation', 'Drag the Reading viewport 960px over two pointer steps.'),
    scenario('rapid-zoom-out', 'navigation', 'Apply six control-wheel zoom-out pulses without an idle gap.'),
    scenario('direction-reversal', 'navigation', 'Pan 420px right, immediately reverse 840px, then return 420px.'),
    scenario('rare-far-programmatic-jump', 'navigation', 'Set the camera directly from the rich cluster to the far ordinary cluster.'),
    scenario('post-gesture-settle', 'readiness', 'End a pan and observe four animation frames plus the existing settle interval.'),
    scenario('card-body-scroll', 'interaction', 'Wheel the fixed-height giant Note, long Result/follow-ups, and long Conversation transcript.'),
    scenario('selection', 'interaction', 'Click the giant Note once and wait for store selection.'),
    scenario(
      'hover-before-click',
      'activation',
      'Hover the giant Note for one frame, click its body once, and require focus inside its live contenteditable editor.',
    ),
    scenario(
      'click-before-activation',
      'activation',
      'Move to and click a verified giant Note body point once in the same task, then require focus inside its live contenteditable editor.',
    ),
    scenario(
      'editing-activation',
      'activation',
      'Click a verified giant Note body point once and require focus inside its live contenteditable editor.',
    ),
    scenario('typing', 'interaction', 'Insert a fixed 24-character suffix in the active giant Note editor.'),
    scenario('dragging', 'interaction', 'Drag an ordinary Note body 80px over eight pointer steps.'),
    scenario('connecting', 'interaction', 'Drag between visible right and left Card handles.'),
    scenario('cold-image-traversal', 'images', 'Visit the image cluster after clearing image elements and decode all visible images.'),
    scenario('warm-image-revisit', 'images', 'Leave and revisit the same image cluster, decoding the same visible images.'),
  ],
} as const

// Standing founder diagnostic added by #751. It deliberately remains outside
// the frozen v1 fixture/16x3 run contract above, whose retained artifacts are
// historical authorities for earlier renderer decisions.
export const RICH_CARD_FOUNDER_SCENARIO = scenario(
  'many-long-notes-reading',
  'founder-diagnostic',
  'Show thirty auto-sized long Notes together in one Reading-zoom viewport and leave timing/feel to manual acceptance.',
)

// Fast choreography validation only. This policy is deliberately outside the
// frozen evidence contract: it executes every scenario once, writes no raw
// artifact, and can never satisfy assertRichCardRawArtifact.
export const RICH_CARD_CHOREOGRAPHY_PROBE = {
  evidence: false,
  repetitions: 1,
  stepTimeoutMs: 120_000,
} as const

export const RICH_CARD_IMAGE_INGESTION_UNAVAILABLE_METHOD =
  'Fixture data URLs are prebuilt deterministically; production paste compression is not invoked or timed.' as const

export type RichCardScenarioId = (typeof RICH_CARD_BENCHMARK_CONTRACT.scenarios)[number]['id']
export type RichCardFounderScenarioId = typeof RICH_CARD_FOUNDER_SCENARIO.id
export type RichCardProbeScenarioId = RichCardScenarioId | RichCardFounderScenarioId

export type RichCardLongTask = { startTime: number; duration: number }

export type RichCardRun = {
  scenarioId: RichCardScenarioId
  repetition: number
  durationMs: number
  frameIntervalsMs: number[]
  missedFrames: number
  slowFrames: number
  longTasks: RichCardLongTask[]
  interactionLatencyMs: number | null
  residentDom: { min: number; max: number }
  styleLayoutMs: number | null
  paintCompositeMs: number | null
  reactWork: {
    status: 'observed' | 'unavailable'
    valueMs?: number
    reason?: string
    followUp?: string
  }
  memory: { beforeBytes: number | null; afterBytes: number | null; supported: boolean; scope?: string }
  readiness: {
    blankBoardFrames: number
    missingRepresentationFrames: number
    detailedReadyMs: number | null
    lightweightReadyMs: number | null
    settledImageReadyMs: number | null
  }
  boardWork: { sceneDerivations: number; cardMetricVisits: number }
  images: { decodedCount: number; decodeMs: number | null; cacheGrowthBytes: number | null }
}

export type RichCardRawArtifact = {
  schemaVersion: 2
  contractId: typeof RICH_CARD_BENCHMARK_CONTRACT.id
  candidate: { id: string; description: string }
  environment: {
    provider: string
    os: string
    cpu: string
    logicalCores: number
    memoryBytes: number
    browser: string
    viewport: { width: number; height: number; deviceScaleFactor: number }
    node: string
    commit: string
    capturedAt: string
  }
  capture: {
    commands: string[]
    runner: string
    sourceRunUrl?: string
  }
  noise: {
    sharedRunner: boolean
    caveats: string[]
  }
  repetitionPolicy: typeof RICH_CARD_BENCHMARK_CONTRACT.repetitionPolicy
  fixture: {
    id: typeof RICH_CARD_BENCHMARK_CONTRACT.fixtureId
    generationMs: number
    cards: number
    connections: number
    outputs: number
    boardJsonBytes: number
    serializationMs: number
    storedImageBytes: number
    decodedPixelEstimateBytes: number
    imageIngestion: {
      status: 'unavailable'
      value: null
      method: typeof RICH_CARD_IMAGE_INGESTION_UNAVAILABLE_METHOD
    }
  }
  correctness: {
    search: { status: 'observed' | 'unavailable'; found: boolean | null; method: string }
    selection: { status: 'observed' | 'unavailable'; selectedCharacters: number | null; method: string }
    copy: { status: 'observed' | 'unavailable'; copiedCharacters: number | null; method: string }
    accessibility: { status: 'observed' | 'unavailable'; richTextNodes: number | null; method: string }
  }
  runs: RichCardRun[]
  trace: {
    source: string
    totalStyleLayoutMs: number | null
    totalPaintCompositeMs: number | null
  }
}

export type RichCardSelectionProbe = {
  intendedText: string | null
  selectedText: string | null
  failure?: string
}

export type RichCardSelectionTarget = {
  nodeIndex: number
  startOffset: number
  endOffset: number
  intendedText: string
}

export type RichCardSelectionAttempt = {
  selectedText: string | null
  failure?: string
}

export type RichCardMetricDistribution = {
  min: number
  median: number
  p95: number
  max: number
}

// rAF callback timestamps share one monotonic clock. The first timestamp is a
// baseline rather than an interval, so only consecutive callback timestamps
// contribute frame intervals.
export function deriveFrameIntervalsFromRafTimestamps(timestamps: readonly number[]): number[] {
  return timestamps.slice(1).map((timestamp, index) => timestamp - timestamps[index])
}

export type RichCardScenarioAnalysis = {
  scenarioId: RichCardScenarioId
  repetitions: number
  durationMs: RichCardMetricDistribution
  frameIntervalMs: RichCardMetricDistribution
  interactionLatencyMs: RichCardMetricDistribution | null
  slowFrames: number
  missedFrames: number
  longTasks: number
  longTaskMs: number
  residentDomMax: number
  styleLayoutMs: number | null
  paintCompositeMs: number | null
  memoryGrowthBytes: number | null
  blankBoardFrames: number
  missingRepresentationFrames: number
  lightweightReadyMs: number | null
  detailedReadyMs: number | null
  settledImageReadyMs: number | null
}

export type RichCardCostContributor = {
  rank: number
  id:
    | 'whole-board-residency'
    | 'rich-markdown-transcript-materialization'
    | 'style-layout-paint'
    | 'store-invalidation'
    | 'graph-wide-derivation'
  score: number
  evidence: string
  falsification: string
}

export type RichCardBaselineAnalysis = {
  scenarios: RichCardScenarioAnalysis[]
  costProfile: RichCardCostContributor[]
}

function scenario<const Id extends string, const Family extends string>(id: Id, family: Family, choreography: string) {
  return { id, family, choreography }
}

const PRIVACY_PATTERN = /(?:\/Users\/|\/home\/|\\Users\\|\.eido|eido-v3-ideas|BEGIN (?:RSA|OPENSSH) PRIVATE KEY|gh[pousr]_[A-Za-z0-9_]+)/i

function classifyRichCardSelectionProbe(
  probe: RichCardSelectionProbe,
): RichCardRawArtifact['correctness']['selection'] {
  const intendedText = probe.intendedText
  const selectedText = probe.selectedText
  if (
    intendedText !== null &&
    intendedText.trim().length > 0 &&
    selectedText !== null &&
    selectedText.length > 0 &&
    selectedText === intendedText
  ) {
    return {
      status: 'observed',
      selectedCharacters: selectedText.length,
      method: 'DOM Selection matched a non-whitespace substring rendered by the live synthetic giant Note editor.',
    }
  }

  const reason = probe.failure ?? 'selected text did not match the intended non-whitespace rendered substring'
  return {
    status: 'unavailable',
    selectedCharacters: null,
    method: `DOM Selection probe unavailable: ${reason}.`,
  }
}

export async function probeRichCardSelection(
  textNodes: readonly string[] | null,
  select: (target: RichCardSelectionTarget) => Promise<RichCardSelectionAttempt>,
): Promise<RichCardRawArtifact['correctness']['selection']> {
  if (textNodes === null) {
    return classifyRichCardSelectionProbe({
      intendedText: null,
      selectedText: null,
      failure: 'giant Note render root was absent',
    })
  }
  if (textNodes.length === 0) {
    return classifyRichCardSelectionProbe({
      intendedText: null,
      selectedText: null,
      failure: 'no rendered text nodes existed',
    })
  }

  const nodeIndex = textNodes.findIndex((text) => /\S/.test(text))
  if (nodeIndex < 0) {
    return classifyRichCardSelectionProbe({
      intendedText: null,
      selectedText: null,
      failure: 'rendered text nodes contained only whitespace',
    })
  }

  const text = textNodes[nodeIndex]
  const startOffset = text.search(/\S/)
  const intendedText = text.slice(startOffset, startOffset + 64)
  const target = {
    nodeIndex,
    startOffset,
    endOffset: startOffset + intendedText.length,
    intendedText,
  }
  const attempt = await select(target)
  return classifyRichCardSelectionProbe({ intendedText, ...attempt })
}

export function assertRichCardRawArtifact(value: RichCardRawArtifact): asserts value is RichCardRawArtifact {
  if (value.schemaVersion !== 2 || value.contractId !== RICH_CARD_BENCHMARK_CONTRACT.id) {
    throw new Error(`Rich Card artifact does not match frozen schema/contract ${RICH_CARD_BENCHMARK_CONTRACT.id}.`)
  }
  if (JSON.stringify(value).match(PRIVACY_PATTERN)) {
    throw new Error('Rich Card artifact failed the privacy scan.')
  }
  if (value.fixture.id !== RICH_CARD_BENCHMARK_CONTRACT.fixtureId) {
    throw new Error(`Rich Card artifact fixture must be ${RICH_CARD_BENCHMARK_CONTRACT.fixtureId}.`)
  }
  if (
    value.repetitionPolicy.repetitions !== RICH_CARD_BENCHMARK_CONTRACT.repetitionPolicy.repetitions ||
    value.repetitionPolicy.order !== RICH_CARD_BENCHMARK_CONTRACT.repetitionPolicy.order
  ) {
    throw new Error('Rich Card artifact changed the frozen repetition policy.')
  }

  const expectedRepetitions = RICH_CARD_BENCHMARK_CONTRACT.repetitionPolicy.repetitions
  for (const benchmarkScenario of RICH_CARD_BENCHMARK_CONTRACT.scenarios) {
    const repetitions = value.runs
      .filter((run) => run.scenarioId === benchmarkScenario.id)
      .map((run) => run.repetition)
      .sort((left, right) => left - right)
    if (
      repetitions.length !== expectedRepetitions ||
      repetitions.some((repetition, index) => repetition !== index + 1)
    ) {
      throw new Error(`Scenario ${benchmarkScenario.id} must contain exactly three repetitions numbered 1..3.`)
    }
  }
  if (value.runs.length !== RICH_CARD_BENCHMARK_CONTRACT.scenarios.length * expectedRepetitions) {
    throw new Error('Rich Card artifact contains unknown or duplicate scenario runs; expected three repetitions per scenario.')
  }
  if (value.fixture.cards < 7 || value.fixture.storedImageBytes <= 0 || value.fixture.decodedPixelEstimateBytes <= 0) {
    throw new Error('Rich Card artifact fixture metrics are incomplete.')
  }
  const imageIngestion = value.fixture.imageIngestion as { status: unknown; value: unknown; method: unknown }
  if (
    imageIngestion.status !== 'unavailable' ||
    imageIngestion.value !== null ||
    imageIngestion.method !== RICH_CARD_IMAGE_INGESTION_UNAVAILABLE_METHOD
  ) {
    throw new Error('Rich Card image ingestion must be unavailable with a null value and fixed unavailable method.')
  }
  const selection = value.correctness.selection as {
    status: unknown
    selectedCharacters: number | null
  }
  if (selection.status !== 'observed' && selection.status !== 'unavailable') {
    throw new Error(`Unknown selection status: ${String(selection.status)}.`)
  }
  if (
    (selection.status === 'observed' &&
      (selection.selectedCharacters === null ||
        !Number.isInteger(selection.selectedCharacters) ||
        selection.selectedCharacters <= 0)) ||
    (selection.status === 'unavailable' && selection.selectedCharacters !== null)
  ) {
    throw new Error('Observed selection must have a positive selected-character count; unavailable selection must have null.')
  }
  const copy = value.correctness.copy as { status: unknown; copiedCharacters: number | null }
  if (copy.status !== 'observed' && copy.status !== 'unavailable') {
    throw new Error(`Unknown clipboard copy status: ${String(copy.status)}.`)
  }
  if (
    (copy.status === 'observed' &&
      (copy.copiedCharacters === null || !Number.isInteger(copy.copiedCharacters) || copy.copiedCharacters <= 0)) ||
    (copy.status === 'unavailable' && copy.copiedCharacters !== null)
  ) {
    throw new Error('Observed clipboard copy must have a positive copied-character count; unavailable copy must have null.')
  }
  if (value.capture.commands.length === 0 || value.noise.caveats.length === 0) {
    throw new Error('Rich Card artifact must retain capture commands and noise caveats.')
  }

  for (const run of value.runs) {
    if (!RICH_CARD_BENCHMARK_CONTRACT.scenarios.some((scenario) => scenario.id === run.scenarioId)) {
      throw new Error(`Unknown Rich Card scenario: ${run.scenarioId}.`)
    }
    const nonNegativeMetrics: Array<[path: string, value: number]> = [
      ['durationMs', run.durationMs],
      ['missedFrames', run.missedFrames],
      ['slowFrames', run.slowFrames],
      ['residentDom.min', run.residentDom.min],
      ['residentDom.max', run.residentDom.max],
      ['readiness.blankBoardFrames', run.readiness.blankBoardFrames],
      ['readiness.missingRepresentationFrames', run.readiness.missingRepresentationFrames],
      ...run.frameIntervalsMs.map((value, index): [string, number] => [`frameIntervalsMs[${index}]`, value]),
      ...run.longTasks.flatMap(
        (task, index): Array<[string, number]> => [
          [`longTasks[${index}].startTime`, task.startTime],
          [`longTasks[${index}].duration`, task.duration],
        ],
      ),
      ['boardWork.sceneDerivations', run.boardWork.sceneDerivations],
      ['boardWork.cardMetricVisits', run.boardWork.cardMetricVisits],
      ['images.decodedCount', run.images.decodedCount],
    ]
    const addMeasuredMetric = (path: string, metric: number | null | undefined) => {
      if (metric !== null && metric !== undefined) nonNegativeMetrics.push([path, metric])
    }
    addMeasuredMetric('interactionLatencyMs', run.interactionLatencyMs)
    addMeasuredMetric('styleLayoutMs', run.styleLayoutMs)
    addMeasuredMetric('paintCompositeMs', run.paintCompositeMs)
    addMeasuredMetric('reactWork.valueMs', run.reactWork.valueMs)
    addMeasuredMetric('memory.beforeBytes', run.memory.beforeBytes)
    addMeasuredMetric('memory.afterBytes', run.memory.afterBytes)
    addMeasuredMetric('readiness.detailedReadyMs', run.readiness.detailedReadyMs)
    addMeasuredMetric('readiness.lightweightReadyMs', run.readiness.lightweightReadyMs)
    addMeasuredMetric('readiness.settledImageReadyMs', run.readiness.settledImageReadyMs)
    addMeasuredMetric('images.decodeMs', run.images.decodeMs)
    for (const [path, metric] of nonNegativeMetrics) {
      if (!Number.isFinite(metric) || metric < 0) {
        throw new Error(
          `Scenario ${run.scenarioId} repetition ${run.repetition} has invalid non-negative metric at ${path}: ${String(metric)}.`,
        )
      }
    }
  }
}

export function analyzeRichCardBaseline(artifact: RichCardRawArtifact): RichCardBaselineAnalysis {
  assertRichCardRawArtifact(artifact)
  const scenarios = RICH_CARD_BENCHMARK_CONTRACT.scenarios.map(({ id }) => analyzeScenario(id, artifact.runs))
  return { scenarios, costProfile: rankCostProfile(artifact, scenarios) }
}

function analyzeScenario(scenarioId: RichCardScenarioId, runs: RichCardRun[]): RichCardScenarioAnalysis {
  const matching = runs.filter((run) => run.scenarioId === scenarioId)
  const frameIntervals = matching.flatMap((run) => run.frameIntervalsMs)
  const interactionLatencies = matching
    .map((run) => run.interactionLatencyMs)
    .filter((value): value is number => value !== null)
  const memoryGrowth = matching
    .filter((run) => run.memory.supported && run.memory.beforeBytes !== null && run.memory.afterBytes !== null)
    .map((run) => run.memory.afterBytes! - run.memory.beforeBytes!)

  return {
    scenarioId,
    repetitions: matching.length,
    durationMs: distribution(matching.map((run) => run.durationMs)),
    frameIntervalMs: distribution(frameIntervals),
    interactionLatencyMs: interactionLatencies.length > 0 ? distribution(interactionLatencies) : null,
    slowFrames: sum(matching.map((run) => run.slowFrames)),
    missedFrames: sum(matching.map((run) => run.missedFrames)),
    longTasks: sum(matching.map((run) => run.longTasks.length)),
    longTaskMs: round(sum(matching.flatMap((run) => run.longTasks.map((task) => task.duration)))),
    residentDomMax: Math.max(...matching.map((run) => run.residentDom.max)),
    styleLayoutMs: nullableSum(matching.map((run) => run.styleLayoutMs)),
    paintCompositeMs: nullableSum(matching.map((run) => run.paintCompositeMs)),
    memoryGrowthBytes: memoryGrowth.length > 0 ? Math.max(...memoryGrowth) : null,
    blankBoardFrames: sum(matching.map((run) => run.readiness.blankBoardFrames)),
    missingRepresentationFrames: sum(matching.map((run) => run.readiness.missingRepresentationFrames)),
    lightweightReadyMs: nullableMax(matching.map((run) => run.readiness.lightweightReadyMs)),
    detailedReadyMs: nullableMax(matching.map((run) => run.readiness.detailedReadyMs)),
    settledImageReadyMs: nullableMax(matching.map((run) => run.readiness.settledImageReadyMs)),
  }
}

function rankCostProfile(
  artifact: RichCardRawArtifact,
  scenarios: RichCardScenarioAnalysis[],
): RichCardCostContributor[] {
  const totalStyleLayout = sum(artifact.runs.map((run) => run.styleLayoutMs ?? 0))
  const totalPaintComposite = sum(artifact.runs.map((run) => run.paintCompositeMs ?? 0))
  const totalDuration = sum(artifact.runs.map((run) => run.durationMs))
  const maxResidentDom = Math.max(...artifact.runs.map((run) => run.residentDom.max))
  const residentRatio = maxResidentDom / Math.max(1, artifact.fixture.cards)
  const totalCardMetricVisits = sum(artifact.runs.map((run) => run.boardWork.cardMetricVisits))
  const totalSceneDerivations = sum(artifact.runs.map((run) => run.boardWork.sceneDerivations))
  const richReadiness = scenarios
    .filter((scenario) => ['editing-activation', 'card-body-scroll', 'cold-image-traversal'].includes(scenario.scenarioId))
    .map((scenario) => scenario.detailedReadyMs ?? 0)
  const richLongTasks = artifact.runs
    .filter((run) => ['editing-activation', 'card-body-scroll', 'cold-image-traversal'].includes(run.scenarioId))
    .reduce((total, run) => total + run.longTasks.length, 0)
  const renderingShare = (totalStyleLayout + totalPaintComposite) / Math.max(1, totalDuration)
  const entries: Array<Omit<RichCardCostContributor, 'rank'>> = [
    {
      id: 'whole-board-residency',
      score: residentRatio >= 0.9 ? 3 : residentRatio >= 0.5 ? 2 : 1,
      evidence: `Peak resident Card DOM was ${maxResidentDom}/${artifact.fixture.cards} Cards (${(residentRatio * 100).toFixed(1)}%).`,
      falsification: 'Repeat unchanged choreography with bounded residency; this contributor falls if offscreen Card DOM and memory scale with the viewport instead of Board size.',
    },
    {
      id: 'rich-markdown-transcript-materialization',
      score: richLongTasks > 0 || (nullableMax(richReadiness) ?? 0) > 20 ? 2 : 1,
      evidence: `Worst observed detailed readiness across rich-body activation/scroll/image entry was ${(nullableMax(richReadiness) ?? 0).toFixed(1)}ms, with ${richLongTasks} long tasks. Baseline-only attribution is suggestive, not causal.`,
      falsification: 'Hold residency constant and replace only passive rich bodies with inert equivalents; the contributor falls if readiness, long tasks, and style/layout remain unchanged.',
    },
    {
      id: 'style-layout-paint',
      score: renderingShare >= 0.2 ? 3 : renderingShare >= 0.05 ? 2 : 1,
      evidence: `Observed CDP/trace deltas totalled ${totalStyleLayout.toFixed(1)}ms style/layout and ${totalPaintComposite.toFixed(1)}ms paint/composite (${(renderingShare * 100).toFixed(1)}% of measured scenario duration).`,
      falsification: 'Hold scripting and DOM population constant while isolating visual containment; the contributor falls if frame gaps do not track reduced rendering time.',
    },
    {
      id: 'store-invalidation',
      score: totalCardMetricVisits >= artifact.fixture.cards ? 2 : 1,
      evidence: `Board observability reported ${totalCardMetricVisits} Card-metric visits (${(totalCardMetricVisits / Math.max(1, artifact.fixture.cards)).toFixed(1)} Board equivalents); React work is unavailable, so this remains a proxy.`,
      falsification: 'Repeat typing and selection with scoped store subscriptions; the contributor falls if Card-metric visits disappear without improving interaction latency or React work.',
    },
    {
      id: 'graph-wide-derivation',
      score: 1,
      evidence: `Board Scene observability reported ${totalSceneDerivations} derivations across the frozen workload, but no isolated timing attribution exists in this baseline.`,
      falsification: 'Memoize graph-invariant derivations while preserving camera updates; the contributor falls if derivation counts drop but frame/interaction distributions do not.',
    },
  ]

  const hypothesisOrder = [
    'whole-board-residency',
    'rich-markdown-transcript-materialization',
    'style-layout-paint',
    'store-invalidation',
    'graph-wide-derivation',
  ] satisfies RichCardCostContributor['id'][]
  return entries
    .sort(
      (left, right) =>
        right.score - left.score || hypothesisOrder.indexOf(left.id) - hypothesisOrder.indexOf(right.id),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }))
}

export function renderRichCardBaselineReport(artifact: RichCardRawArtifact): string {
  const analysis = analyzeRichCardBaseline(artifact)
  const unavailableReact = artifact.runs.find((run) => run.reactWork.status === 'unavailable')?.reactWork
  const command = artifact.capture.commands.join('`, `')
  const caveats = artifact.noise.caveats
  const scenarioRows = analysis.scenarios
    .map(
      (scenario) =>
        `| ${scenario.scenarioId} | ${scenario.durationMs.median.toFixed(1)} | ${scenario.frameIntervalMs.p95.toFixed(1)} | ${scenario.slowFrames} | ${scenario.longTasks} | ${scenario.residentDomMax} | ${formatNullable(scenario.styleLayoutMs)} | ${formatNullable(scenario.paintCompositeMs)} | ${scenario.blankBoardFrames}/${scenario.missingRepresentationFrames} | ${formatNullable(scenario.detailedReadyMs)} |`,
    )
    .join('\n')
  const costRows = analysis.costProfile
    .map((entry) => `| ${entry.rank} | ${entry.id} | ${entry.score.toFixed(1)} | ${entry.evidence} | ${entry.falsification} |`)
    .join('\n')

  return `# Rich Card Reading baseline (#402)

Status: **baseline evidence only — No renderer winner and no renderer/LOD policy change.**

## Reproduce

Regenerate this report from the retained raw browser artifact with \`npm run perf:report\`.
Capture command(s): \`${command}\`. Raw schema/contract: \`${artifact.schemaVersion}\` / \`${artifact.contractId}\`.

## Environment and noise

- Provider: ${artifact.environment.provider}; OS: ${artifact.environment.os}; CPU: ${artifact.environment.cpu}; logical cores: ${artifact.environment.logicalCores}; memory: ${artifact.environment.memoryBytes} bytes.
- Browser: ${artifact.environment.browser}; viewport: ${artifact.environment.viewport.width}×${artifact.environment.viewport.height} @ ${artifact.environment.viewport.deviceScaleFactor}; Node: ${artifact.environment.node}.
- Commit: \`${artifact.environment.commit}\`; captured: ${artifact.environment.capturedAt}.
- Shared hosted runner: ${artifact.noise.sharedRunner}. Repeated timing distributions are comparative evidence, not a stable absolute machine budget.
${caveats.map((caveat) => `- Noise caveat: ${caveat}`).join('\n')}

## Frozen workload

The candidate-neutral \`${RICH_CARD_BENCHMARK_CONTRACT.fixtureId}\` contains ${artifact.fixture.cards} Cards, ${artifact.fixture.connections} Connections, and ${artifact.fixture.outputs} Outputs. Each of ${RICH_CARD_BENCHMARK_CONTRACT.scenarios.length} scenario IDs runs ${RICH_CARD_BENCHMARK_CONTRACT.repetitionPolicy.repetitions} times in scenario-major order. Choreography is frozen in \`RICH_CARD_BENCHMARK_CONTRACT\` for #403/#404/#405/#413.

## Observed browser metrics

| Scenario | median duration ms | p95 frame interval ms | slow frames | long tasks | peak Card DOM | style/layout ms | paint/composite ms | blank/missing frames | detailed ready ms |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
${scenarioRows}

Lightweight representation readiness and blank/missing frames are reported separately from detailed readiness. Interaction latency, memory deltas, image decode/readiness, and Board work remain in the raw per-run records rather than being collapsed into one score.

## Images: observed versus estimated

### Deterministic estimates

Observed browser measures: first/warm image decode duration/count, settled image readiness, JS heap, trace paint/composite, and cold-versus-warm traversal after a Chromium cache clear. Stored image payload (${artifact.fixture.storedImageBytes} bytes), Board JSON (${artifact.fixture.boardJsonBytes} bytes), and serialization (${artifact.fixture.serializationMs.toFixed(2)}ms) are deterministic fixture measures. Decoded-pixel residency (${artifact.fixture.decodedPixelEstimateBytes} bytes) is a deterministic width × height × 4 estimate based on the fixture's actual SVG/PNG dimensions, not an observed GPU allocation. Decoded-image/cache-growth bytes are explicitly unavailable because JS heap excludes native decoder and GPU caches. Ingestion/compression is **unavailable**: fixture data URLs are prebuilt deterministically; production paste compression is not invoked or timed. Blob storage or migration is not required or measured here.

## Search, selection, copy, and accessibility observations

- Search: **${artifact.correctness.search.status}**, found=${artifact.correctness.search.found}. ${artifact.correctness.search.method}
- Selection: **${artifact.correctness.selection.status}**, selected characters=${artifact.correctness.selection.selectedCharacters ?? 'unavailable'}. ${artifact.correctness.selection.method}
- Clipboard copy: **${artifact.correctness.copy.status}**, copied characters=${artifact.correctness.copy.copiedCharacters ?? 'unavailable'}. ${artifact.correctness.copy.method}
- Accessibility: **${artifact.correctness.accessibility.status}**, rich-text AX nodes=${artifact.correctness.accessibility.richTextNodes}. ${artifact.correctness.accessibility.method}

## Ranked, falsifiable cost profile

Scores are a predeclared ordinal evidence grade: 3 = direct/strong signal, 2 = suggestive proxy, 1 = observed but inconclusive. The rank never compares milliseconds with counts and does not select a candidate.

| Rank | contributor | evidence score | evidence | falsification |
| ---: | --- | ---: | --- | --- |
${costRows}

## Unavailable instrumentation ledger

- React work: **${unavailableReact?.status ?? 'unavailable'}**. ${unavailableReact?.reason ?? 'No production React work signal was observed.'} Follow-up: ${unavailableReact?.followUp ?? 'Add benchmark-only Profiler observation without changing production renderer policy.'}
- GPU texture residency and compositor-only time are not directly exposed by this harness. Decoded pixels are explicitly estimated; trace paint/composite is observed main-thread/browser work, not a GPU-memory reading.
- Search, DOM selection, clipboard copy, and accessibility tree completeness are not performance-waived. This baseline measures current DOM selection separately from clipboard copy, which remains explicitly unavailable until a harness invokes and reads it.

## Interpretation boundary

No renderer winner. This artifact characterizes the current Reading implementation only. It does not implement buffered residency, activation/pinning, event replay, image renditions, a far-jump fallback, or any migration. Existing Reading/Overview/Map thresholds, occupancy, deadband, settle behavior, representations, and crossfades are unchanged.
`
}

function distribution(values: number[]): RichCardMetricDistribution {
  if (values.length === 0) return { min: 0, median: 0, p95: 0, max: 0 }
  const sorted = [...values].sort((left, right) => left - right)
  return {
    min: round(sorted[0]),
    median: round(percentile(sorted, 0.5)),
    p95: round(percentile(sorted, 0.95)),
    max: round(sorted[sorted.length - 1]),
  }
}

export function benchmarkPercentile(values: number[], ratio: number): number {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
}

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0)
}

function nullableSum(values: Array<number | null>): number | null {
  const observed = values.filter((value): value is number => value !== null)
  return observed.length > 0 ? round(sum(observed)) : null
}

function nullableMax(values: Array<number | null>): number | null {
  const observed = values.filter((value): value is number => value !== null)
  return observed.length > 0 ? Math.max(...observed) : null
}

function formatNullable(value: number | null): string {
  return value === null ? 'unavailable' : value.toFixed(1)
}

export function roundBenchmarkMetric(value: number): number {
  return Math.round(value * 100) / 100
}

const percentile = benchmarkPercentile
const round = roundBenchmarkMetric
