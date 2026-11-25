import { describe, expect, it } from 'vitest'
import { evaluateColdDataRoi } from './coldDataRoi'
import {
  COLD_DATA_FIXTURE_CASES,
  createColdDataRoiFixtureFamily,
  readingHotSnapshot,
} from './coldDataRoiFixtures'

describe('cold-data ROI evidence', () => {
  it('varies history, provenance, and settings independently while Reading content stays fixed', () => {
    const fixtures = createColdDataRoiFixtureFamily()
    const controlHot = readingHotSnapshot(fixtures.control)

    for (const name of COLD_DATA_FIXTURE_CASES) {
      expect(readingHotSnapshot(fixtures[name])).toEqual(controlHot)
    }

    expect(fixtures['history-heavy'].board.outputs).not.toBe(fixtures.control.board.outputs)
    expect(fixtures['history-heavy'].board.runs).toBe(fixtures.control.board.runs)
    expect(fixtures['provenance-heavy'].board.outputs).toBe(fixtures.control.board.outputs)
    expect(fixtures['provenance-heavy'].board.runs).not.toBe(fixtures.control.board.runs)
    expect(fixtures['settings-heavy'].board.outputs).toBe(fixtures.control.board.outputs)
    expect(fixtures['settings-heavy'].board.runs).toBe(fixtures.control.board.runs)
    expect(fixtures['settings-heavy'].board.aiSettings).not.toBe(fixtures.control.board.aiSettings)
    expect(fixtures.combined.injectedHistoricalVersionIds).toHaveLength(3)
    expect(fixtures.combined.injectedProvenanceRunIds).toHaveLength(18)

    const serializedFamily = JSON.stringify(fixtures)
    expect(serializedFamily).not.toMatch(/(?:\/Users\/|\\Users\\|\.eido|EIDO_DATA_FILE|eido-v3-ideas)/i)
  })

  it('reports deterministic structural costs and selects eager loading without timing claims', () => {
    const report = evaluateColdDataRoi()
    const repeated = evaluateColdDataRoi()
    const control = report.cases.control
    const history = report.cases['history-heavy']
    const provenance = report.cases['provenance-heavy']
    const settings = report.cases['settings-heavy']
    const combined = report.cases.combined

    expect(repeated).toEqual(report)
    expect(report.fixtureCases).toEqual(COLD_DATA_FIXTURE_CASES)
    expect(Object.values(report.cases).every((entry) => entry.readingNavigation.readingInputMatchesControl)).toBe(true)
    expect(Object.values(report.cases).every((entry) => entry.readingNavigation.stableCameraColdRecordVisits === 0)).toBe(true)
    expect(history.readingNavigation).toMatchObject({
      coldChangeCardMetricVisits: 32,
      coldChangeCardMetricFullRebuilds: 1,
      cardMetricProjectionReused: true,
    })
    expect(provenance.readingNavigation.coldChangeCardMetricVisits).toBe(0)
    expect(settings.readingNavigation.coldChangeCardMetricVisits).toBe(0)

    expect(control.readingNavigation.graphIndexTransition).toBe('cache-hit')
    expect(history.readingNavigation.graphIndexTransition).toBe('partial-rebuild')
    expect(history.readingNavigation.graphIndexStats.rebuildsByCause.outputs).toBe(1)
    expect(history.readingNavigation.graphIndexStats.subIndexReuses).toMatchObject({
      cards: 1,
      connections: 1,
      runs: 1,
    })
    expect(provenance.readingNavigation.graphIndexTransition).toBe('partial-rebuild')
    expect(provenance.readingNavigation.graphIndexStats.rebuildsByCause.runs).toBe(1)
    expect(provenance.readingNavigation.graphIndexStats.subIndexReuses).toMatchObject({
      cards: 1,
      connections: 1,
      outputs: 1,
    })
    expect(settings.readingNavigation.graphIndexTransition).toBe('cache-hit')
    expect(combined.readingNavigation.graphIndexStats.rebuildsByCause).toMatchObject({
      outputs: 1,
      runs: 1,
    })

    expect(history.cardSelection.chosenPayloadBytes).toBe(control.cardSelection.chosenPayloadBytes)
    expect(history.cardSelection.versionMetadataBytes).toBe(control.cardSelection.versionMetadataBytes)
    expect(history.cardSelection.historicalPayloadBytes).toBeGreaterThan(control.cardSelection.historicalPayloadBytes)
    expect(provenance.cardSelection).toEqual(control.cardSelection)
    expect(settings.cardSelection).toEqual(control.cardSelection)

    expect(provenance.versionContextModal.firstOpenRunScanVisits).toBe(
      control.versionContextModal.firstOpenRunScanVisits + 18,
    )
    expect(provenance.versionContextModal.subsequentOpenRunScanVisits).toBe(
      provenance.versionContextModal.firstOpenRunScanVisits,
    )
    expect(provenance.versionContextModal.firstOpenLatencyMs).toBeNull()
    expect(provenance.versionContextModal.subsequentOpenLatencyMs).toBeNull()

    expect(history.persistence.bytesDeltaFromControl).toBeGreaterThan(0)
    expect(provenance.persistence.bytesDeltaFromControl).toBeGreaterThan(0)
    expect(settings.persistence.bytesDeltaFromControl).toBeGreaterThan(0)
    expect(combined.persistence.bytesDeltaFromControl).toBe(
      history.persistence.bytesDeltaFromControl
      + provenance.persistence.bytesDeltaFromControl
      + settings.persistence.bytesDeltaFromControl,
    )
    expect(combined.idleResidency.physicalHeapBytes).toBeNull()
    expect(report.measurementPolicy.wallClockLatency).toContain('not-measured')

    expect(report.decision).toMatchObject({
      choice: 'eager-loading',
      onDemandPayloads: [],
      stableReadingNavigationColdVisits: 0,
      existingRuntimeRecordResolver: false,
      savedBoardRemainsSourceOfTruth: true,
    })
    expect(report.decision.combinedSerializedBytesDelta).toBe(combined.persistence.bytesDeltaFromControl)
    expect(report.decision.combinedDeferrableColdBytesDelta).toBeGreaterThan(0)
  })
})
