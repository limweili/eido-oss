import { createGraphIndexCache, type GraphIndexCacheStats } from '../graph/graphIndex'
import type { Output, OutputVersion, RunRecord, SavedBoard } from '../graph/types'
import {
  boardScenePerfCountersSnapshot,
  deriveBoardCardMetrics,
  resetBoardScenePerfCounters,
} from '../canvas/boardScene'
import { jsonPayloadBytes } from './persistencePayload'
import {
  COLD_DATA_FIXTURE_CASES,
  createColdDataRoiFixtureFamily,
  type ColdDataFixtureCase,
  type ColdDataRoiFixture,
} from './coldDataRoiFixtures'

export type StructuralWork = {
  logicalRecords: number
  objectValues: number
  arrayValues: number
  primitiveValues: number
  stringValues: number
  stringUtf8Bytes: number
  stringCodeUnits: number
  jsonValueVisits: number
}

export type ProfileLogicalRecordCounts = {
  board: number
  card: number
  block: number
  connection: number
  output: number
  outputVersion: number
  run: number
  transcriptMessage: number
  followUpMessage: number
  intentEvent: number
  logicalAsset: number
  boardSettings: number
  highlight: number
  highlightTag: number
  compactionSummary: number
  modInstance: number
}

export type ColdDataRoiCaseReport = {
  name: ColdDataFixtureCase
  initialLoadAndHydration: {
    serializedBytes: number
    logicalRecords: ProfileLogicalRecordCounts
    structuralWork: StructuralWork
    normalizationVisits: {
      savedBoardCardCopies: number
      savedBoardRunCopies: number
      savedBoardIntentEventVisits: number
      followUpSettlementOutputVisits: number
      followUpSettlementVersionVisits: number
      followUpSettlementMessageVisits: number
      cardModNormalizationVisits: number
      connectionRepairInputs: number
    }
  }
  idleResidency: {
    logicalJsonShapeBytes: number
    retainedLogicalRecords: number
    retainedStringValues: number
    retainedStringUtf8Bytes: number
    physicalHeapBytes: null
    decodedPixels: null
  }
  persistence: {
    fullSnapshotBytes: number
    bytesDeltaFromControl: number
    serializationJsonValueVisits: number
    serializationLogicalRecordVisits: number
    wholeSavedBoardSerialized: true
  }
  readingNavigation: {
    stableCameraColdRecordVisits: number
    coldChangeCardMetricVisits: number
    coldChangeCardMetricFullRebuilds: number
    cardMetricProjectionReused: boolean
    readingMetricOutputVisits: number
    readingMetricVersionVisits: number
    chosenTextCodeUnits: number
    readingInputSignature: string
    readingInputMatchesControl: boolean
    outputsIdentityChangedFromControl: boolean
    graphIndexTransition: 'cache-hit' | 'partial-rebuild' | 'full-rebuild'
    graphIndexStats: GraphIndexCacheStats
  }
  cardSelection: {
    selectedOutputBytes: number
    versionMetadataRecords: number
    versionMetadataBytes: number
    chosenPayloadBytes: number
    historicalPayloadBytes: number
    fullOutputAlreadyResident: true
  }
  versionContextModal: {
    selectedRunId: string
    firstOpenRunScanVisits: number
    subsequentOpenRunScanVisits: number
    currentLookupCacheHits: 0
    firstOpenLatencyMs: null
    subsequentOpenLatencyMs: null
  }
  categoryPayloads: {
    historicalVersionBodiesAndThreadsBytes: number
    runSummaryBytes: number
    runProvenanceBytes: number
    boardSettingsBytes: number
  }
}

export type ColdDataRoiReport = {
  fixtureCases: readonly ColdDataFixtureCase[]
  cases: Record<ColdDataFixtureCase, ColdDataRoiCaseReport>
  measurementPolicy: {
    wallClockLatency: 'not-measured-non-authoritative-on-this-host'
    cpuThroughput: 'not-measured-non-authoritative-on-this-host'
    physicalHeap: 'not-measured-structural-proxies-only'
    profileRows: 'logical-contract-vocabulary-not-physical-storage-rows'
  }
  decision: {
    choice: 'eager-loading'
    onDemandPayloads: readonly []
    combinedSerializedBytesDelta: number
    combinedDeferrableColdBytesDelta: number
    combinedSettingsBytesDelta: number
    stableReadingNavigationColdVisits: number
    existingRuntimeRecordResolver: false
    savedBoardRemainsSourceOfTruth: true
    rationale: readonly string[]
    lifecycleImplications: readonly string[]
    downstream: {
      issue409: string
      issue510: string
      rollback: string
    }
  }
}

/**
 * Deterministic, timing-free #408 evidence. All byte counts are UTF-8
 * JSON/string proxies; all visits come from current public data shapes and
 * cache counters. None are claims about wall-clock latency or physical heap.
 */
export function evaluateColdDataRoi(): ColdDataRoiReport {
  const fixtures = createColdDataRoiFixtureFamily()
  const controlSignature = readingInputSignature(fixtures.control.board)
  const controlBytes = jsonPayloadBytes(fixtures.control.board)
  const cases = Object.fromEntries(
    COLD_DATA_FIXTURE_CASES.map((name) => [
      name,
      evaluateCase(fixtures[name], fixtures.control, controlSignature, controlBytes),
    ]),
  ) as Record<ColdDataFixtureCase, ColdDataRoiCaseReport>
  const control = cases.control
  const combined = cases.combined

  const combinedDeferrableColdBytesDelta =
    combined.categoryPayloads.historicalVersionBodiesAndThreadsBytes
    + combined.categoryPayloads.runProvenanceBytes
    - control.categoryPayloads.historicalVersionBodiesAndThreadsBytes
    - control.categoryPayloads.runProvenanceBytes

  return {
    fixtureCases: COLD_DATA_FIXTURE_CASES,
    cases,
    measurementPolicy: {
      wallClockLatency: 'not-measured-non-authoritative-on-this-host',
      cpuThroughput: 'not-measured-non-authoritative-on-this-host',
      physicalHeap: 'not-measured-structural-proxies-only',
      profileRows: 'logical-contract-vocabulary-not-physical-storage-rows',
    },
    decision: {
      choice: 'eager-loading',
      onDemandPayloads: [],
      combinedSerializedBytesDelta: combined.persistence.bytesDeltaFromControl,
      combinedDeferrableColdBytesDelta,
      combinedSettingsBytesDelta:
        combined.categoryPayloads.boardSettingsBytes - control.categoryPayloads.boardSettingsBytes,
      stableReadingNavigationColdVisits: combined.readingNavigation.stableCameraColdRecordVisits,
      existingRuntimeRecordResolver: false,
      savedBoardRemainsSourceOfTruth: true,
      rationale: [
        'Stable camera navigation consumes cards, connections, and chosen output text; historical bodies, runs, provenance, and settings add zero steady-navigation record visits.',
        'Changing historical output bodies rebuilds only the output graph sub-index, while run-only changes rebuild only the run sub-index and settings-only changes remain a graph-cache hit.',
        'The current runtime hydrates and synchronously snapshots one SavedBoard; the logical Profile record contract has no installed runtime record resolver.',
        'Board settings and chosen output, transcript, follow-up, and run-summary data are operationally hot and cannot be treated as generic cold payloads.',
        'A split would add loading, cache, error, migration, search, serialization, export, playback, execution, and offline lifecycles without reducing the selected Reading path.',
      ],
      lifecycleImplications: [
        'Loading and cache ownership would need one authority for every version switch, context modal, playback projection, AI compile, duplicate, save, and export.',
        'Serialization would need an explicit materialize-before-snapshot rule or a new async snapshot/export contract.',
        'Search and offline export would need completeness guarantees across unloaded bodies and provenance.',
        'Migration and error recovery would need to preserve stable logical IDs and keep the SavedBoard closure authoritative.',
      ],
      downstream: {
        issue409: 'Omit a cold-data split from the production renderer train; retain eager SavedBoard hydration and add no cold-data migration gate.',
        issue510: 'Treat eager SavedBoard loading as the frozen cold-data decision when certifying the combined design head.',
        rollback: 'No runtime or storage change lands in this study, so rollback is removal of the evidence module, fixture, tests, and report only.',
      },
    },
  }
}

function evaluateCase(
  fixture: ColdDataRoiFixture,
  control: ColdDataRoiFixture,
  controlSignature: string,
  controlBytes: number,
): ColdDataRoiCaseReport {
  const { board } = fixture
  const logicalRecords = profileLogicalRecordCounts(board)
  const structuralWork = measureStructuralWork(board, logicalRecordTotal(logicalRecords))
  const serializedBytes = jsonPayloadBytes(board)
  const selectedOutput = requireOutput(board, fixture.selectedOutputId)
  const selectedVersion = requireVersion(selectedOutput, fixture.selectedVersionId)
  const selectedRunId = selectedVersion.fromRunId
  const selectedRunIndex = board.runs.findIndex((run) => run.id === selectedRunId)
  if (selectedRunIndex < 0) throw new Error(`Synthetic fixture is missing selected run ${selectedRunId}`)
  const selectedOutputPayload = outputPayloadAccounting(selectedOutput)
  const signature = readingInputSignature(board)
  const graphIndexStats = graphTransitionStats(control.board, board)
  const readingMetricEvidence = measureReadingMetricEvidence(control.board, board)

  return {
    name: fixture.name,
    initialLoadAndHydration: {
      serializedBytes,
      logicalRecords,
      structuralWork,
      normalizationVisits: {
        savedBoardCardCopies: board.cards.length,
        savedBoardRunCopies: board.runs.length,
        savedBoardIntentEventVisits: board.intentLog?.length ?? 0,
        followUpSettlementOutputVisits: board.outputs.length,
        followUpSettlementVersionVisits: allVersions(board).length,
        followUpSettlementMessageVisits: followUpMessages(board).length,
        cardModNormalizationVisits: board.cards.length,
        connectionRepairInputs: board.connections.length,
      },
    },
    idleResidency: {
      logicalJsonShapeBytes: serializedBytes,
      retainedLogicalRecords: logicalRecordTotal(logicalRecords),
      retainedStringValues: structuralWork.stringValues,
      retainedStringUtf8Bytes: structuralWork.stringUtf8Bytes,
      physicalHeapBytes: null,
      decodedPixels: null,
    },
    persistence: {
      fullSnapshotBytes: serializedBytes,
      bytesDeltaFromControl: serializedBytes - controlBytes,
      serializationJsonValueVisits: structuralWork.jsonValueVisits,
      serializationLogicalRecordVisits: structuralWork.logicalRecords,
      wholeSavedBoardSerialized: true,
    },
    readingNavigation: {
      stableCameraColdRecordVisits: readingMetricEvidence.stableCameraCardVisits,
      coldChangeCardMetricVisits: readingMetricEvidence.coldChangeCardVisits,
      coldChangeCardMetricFullRebuilds: readingMetricEvidence.coldChangeFullRebuilds,
      cardMetricProjectionReused: readingMetricEvidence.projectionReused,
      readingMetricOutputVisits: board.outputs.length,
      readingMetricVersionVisits: chosenVersionScanVisits(board.outputs),
      chosenTextCodeUnits: chosenTextCodeUnits(board.outputs),
      readingInputSignature: signature,
      readingInputMatchesControl: signature === controlSignature,
      outputsIdentityChangedFromControl: board.outputs !== control.board.outputs,
      graphIndexTransition: graphTransitionKind(graphIndexStats),
      graphIndexStats,
    },
    cardSelection: {
      selectedOutputBytes: jsonPayloadBytes(selectedOutput),
      versionMetadataRecords: selectedOutput.versions.length,
      versionMetadataBytes: selectedOutputPayload.versionMetadataBytes,
      chosenPayloadBytes: selectedOutputPayload.chosenPayloadBytes,
      historicalPayloadBytes: selectedOutputPayload.historicalPayloadBytes,
      fullOutputAlreadyResident: true,
    },
    versionContextModal: {
      selectedRunId,
      firstOpenRunScanVisits: selectedRunIndex + 1,
      subsequentOpenRunScanVisits: selectedRunIndex + 1,
      currentLookupCacheHits: 0,
      firstOpenLatencyMs: null,
      subsequentOpenLatencyMs: null,
    },
    categoryPayloads: {
      historicalVersionBodiesAndThreadsBytes: historicalVersionPayloadBytes(board.outputs),
      runSummaryBytes: sumJsonBytes(board.runs.map(runSummary)),
      runProvenanceBytes: sumJsonBytes(board.runs.map(runProvenance)),
      boardSettingsBytes: jsonPayloadBytes(board.aiSettings ?? {}),
    },
  }
}

function graphTransitionStats(control: SavedBoard, candidate: SavedBoard): GraphIndexCacheStats {
  const cache = createGraphIndexCache()
  cache.get(control)
  cache.get(candidate)
  return cache.stats()
}

function measureReadingMetricEvidence(control: SavedBoard, candidate: SavedBoard) {
  const controlCardById = new Map(control.cards.map((card) => [card.id, card]))
  const candidateCardById = new Map(candidate.cards.map((card) => [card.id, card]))

  resetBoardScenePerfCounters()
  const controlProjection = deriveBoardCardMetrics({
    cards: control.cards,
    outputs: control.outputs,
    cardById: (cardId) => controlCardById.get(cardId),
    change: null,
    previous: null,
  })

  resetBoardScenePerfCounters()
  const candidateProjection = deriveBoardCardMetrics({
    cards: candidate.cards,
    outputs: candidate.outputs,
    cardById: (cardId) => candidateCardById.get(cardId),
    change: null,
    previous: controlProjection,
  })
  const coldChangeCounters = boardScenePerfCountersSnapshot()

  resetBoardScenePerfCounters()
  deriveBoardCardMetrics({
    cards: candidate.cards,
    outputs: candidate.outputs,
    cardById: (cardId) => candidateCardById.get(cardId),
    change: null,
    previous: candidateProjection,
  })
  const stableCounters = boardScenePerfCountersSnapshot()

  return {
    coldChangeCardVisits: coldChangeCounters.cardMetricVisits,
    coldChangeFullRebuilds: coldChangeCounters.cardMetricFullRebuilds,
    projectionReused: candidateProjection === controlProjection,
    stableCameraCardVisits: stableCounters.cardMetricVisits,
  }
}

function graphTransitionKind(stats: GraphIndexCacheStats): ColdDataRoiCaseReport['readingNavigation']['graphIndexTransition'] {
  if (stats.hits > 0) return 'cache-hit'
  if (stats.partialBuilds > 0) return 'partial-rebuild'
  return 'full-rebuild'
}

function profileLogicalRecordCounts(board: SavedBoard): ProfileLogicalRecordCounts {
  const versions = allVersions(board)
  return {
    board: 1,
    card: board.cards.length,
    block: board.cards.reduce((sum, card) => sum + card.blocks.length, 0),
    connection: board.connections.length,
    output: board.outputs.length,
    outputVersion: versions.length,
    run: board.runs.length,
    transcriptMessage: versions.reduce((sum, version) => sum + (version.transcript?.length ?? 0), 0),
    followUpMessage: versions.reduce(
      (sum, version) => sum + (version.followUpThread?.messages.length ?? 0),
      0,
    ),
    intentEvent: board.intentLog?.length ?? 0,
    logicalAsset: board.cards.reduce((sum, card) => sum + (card.assets?.length ?? 0), 0),
    boardSettings: board.aiSettings ? 1 : 0,
    highlight: board.highlights?.length ?? 0,
    highlightTag: board.highlightTags?.length ?? 0,
    compactionSummary: board.compactionSummaries?.length ?? 0,
    modInstance: board.cards.reduce((sum, card) => sum + (card.modV2 ? 1 : 0), 0),
  }
}

function logicalRecordTotal(counts: ProfileLogicalRecordCounts): number {
  return Object.values(counts).reduce((sum, count) => sum + count, 0)
}

function measureStructuralWork(value: unknown, logicalRecords: number): StructuralWork {
  const encoder = new TextEncoder()
  let objectValues = 0
  let arrayValues = 0
  let primitiveValues = 0
  let stringValues = 0
  let stringUtf8Bytes = 0
  let stringCodeUnits = 0

  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      arrayValues += 1
      candidate.forEach(visit)
      return
    }
    if (candidate !== null && typeof candidate === 'object') {
      objectValues += 1
      Object.values(candidate).forEach(visit)
      return
    }
    primitiveValues += 1
    if (typeof candidate === 'string') {
      stringValues += 1
      stringUtf8Bytes += encoder.encode(candidate).length
      stringCodeUnits += candidate.length
    }
  }
  visit(value)

  return {
    logicalRecords,
    objectValues,
    arrayValues,
    primitiveValues,
    stringValues,
    stringUtf8Bytes,
    stringCodeUnits,
    jsonValueVisits: objectValues + arrayValues + primitiveValues,
  }
}

function readingInputSignature(board: SavedBoard): string {
  return hashString(
    JSON.stringify({
      // The scene/Reading path consumes Card content and geometry plus
      // connections; retain the public objects here instead of approximating
      // their field list a second time.
      cards: board.cards,
      connections: board.connections,
      // Board metrics inspect only the chosen version's text for each Output.
      chosenOutputText: board.outputs.map((output) => {
        const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
        return {
          resultCardId: output.resultCardId,
          text: output.versions.find((version) => version.id === chosenId)?.text ?? '',
        }
      }),
    }),
  )
}

function hashString(value: string): string {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 0x01000193)
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, '0')}`
}

function chosenVersionScanVisits(outputs: readonly Output[]): number {
  return outputs.reduce((sum, output) => {
    const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
    const index = output.versions.findIndex((version) => version.id === chosenId)
    return sum + (index < 0 ? output.versions.length : index + 1)
  }, 0)
}

function chosenTextCodeUnits(outputs: readonly Output[]): number {
  return outputs.reduce((sum, output) => {
    const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
    return sum + (output.versions.find((version) => version.id === chosenId)?.text.length ?? 0)
  }, 0)
}

function outputPayloadAccounting(output: Output) {
  const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
  return {
    versionMetadataBytes: sumJsonBytes(output.versions.map(versionMetadata)),
    chosenPayloadBytes: sumJsonBytes(
      output.versions.filter((version) => version.id === chosenId).map(versionPayload),
    ),
    historicalPayloadBytes: sumJsonBytes(
      output.versions.filter((version) => version.id !== chosenId).map(versionPayload),
    ),
  }
}

function historicalVersionPayloadBytes(outputs: readonly Output[]): number {
  return outputs.reduce((sum, output) => {
    const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
    return sum + sumJsonBytes(output.versions.filter((version) => version.id !== chosenId).map(versionPayload))
  }, 0)
}

function versionMetadata(version: OutputVersion) {
  return {
    id: version.id,
    number: version.number,
    createdAt: version.createdAt,
    fromRunId: version.fromRunId,
    digestKey: version.digestKey,
    accepted: version.accepted,
    provisional: version.provisional,
    provisionalReason: version.provisionalReason,
    provisionalMessage: version.provisionalMessage,
    sourceChangeDismissedSignature: version.sourceChangeDismissedSignature,
  }
}

function versionPayload(version: OutputVersion) {
  return {
    text: version.text,
    transcript: version.transcript,
    followUpThread: version.followUpThread,
    sourceContext: version.sourceContext,
  }
}

function runSummary(run: RunRecord) {
  return {
    id: run.id,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    askAiCardId: run.askAiCardId,
    model: run.model,
    producedVersionId: run.producedVersionId,
    status: run.status,
    errorMessage: run.errorMessage,
    kind: run.kind,
    contextBudget: run.contextBudget,
  }
}

function runProvenance(run: RunRecord) {
  return {
    usedCardIds: run.usedCardIds,
    usedConnectionIds: run.usedConnectionIds,
    usedGroupDigests: run.usedGroupDigests,
    modIds: run.modIds,
    appliedMods: run.appliedMods,
    compiledInstruction: run.compiledInstruction,
    conversation: run.conversation,
    plan: run.plan,
  }
}

function allVersions(board: SavedBoard): OutputVersion[] {
  return board.outputs.flatMap((output) => output.versions)
}

function followUpMessages(board: SavedBoard) {
  return allVersions(board).flatMap((version) => version.followUpThread?.messages ?? [])
}

function requireOutput(board: SavedBoard, outputId: string): Output {
  const output = board.outputs.find((candidate) => candidate.id === outputId)
  if (!output) throw new Error(`Synthetic fixture is missing selected output ${outputId}`)
  return output
}

function requireVersion(output: Output, versionId: string): OutputVersion {
  const version = output.versions.find((candidate) => candidate.id === versionId)
  if (!version) throw new Error(`Synthetic fixture is missing selected version ${versionId}`)
  return version
}

function sumJsonBytes(values: readonly unknown[]): number {
  return values.reduce<number>((sum, value) => sum + jsonPayloadBytes(value), 0)
}
