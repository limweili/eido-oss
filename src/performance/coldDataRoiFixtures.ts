import { createRichCardBenchmarkBoard } from '../graph/perfFixtures'
import type { BoardAiSettings, Output, OutputVersion, RunRecord, SavedBoard } from '../graph/types'

export const COLD_DATA_FIXTURE_CASES = [
  'control',
  'history-heavy',
  'provenance-heavy',
  'settings-heavy',
  'combined',
] as const

export type ColdDataFixtureCase = (typeof COLD_DATA_FIXTURE_CASES)[number]

export type ColdDataRoiFixture = {
  name: ColdDataFixtureCase
  board: SavedBoard
  selectedCardId: string
  selectedOutputId: string
  selectedVersionId: string
  injectedHistoricalVersionIds: readonly string[]
  injectedProvenanceRunIds: readonly string[]
}

export type ColdDataRoiFixtureFamily = Readonly<Record<ColdDataFixtureCase, ColdDataRoiFixture>>

const SELECTED_CARD_ID = 'benchmark-long-result'
const SELECTED_OUTPUT_ID = 'benchmark-result-output'
const SELECTED_VERSION_ID = 'benchmark-result-version-4'

const BASE_SETTINGS: BoardAiSettings = {
  model: 'synthetic-model',
  models: ['synthetic-model'],
  reasoningEffort: 'medium',
  systemPrompt: 'Use only the fictional context supplied by this deterministic fixture.',
  chainConfirmThreshold: 2,
  compactionMode: 'when-needed',
}

/**
 * One orthogonal synthetic family for issue #408. Unchanged collections share
 * reference identity across cases so graph-cache evidence can distinguish an
 * output-only change from a run-only or settings-only change.
 */
export function createColdDataRoiFixtureFamily(): ColdDataRoiFixtureFamily {
  const base = createRichCardBenchmarkBoard({ ordinaryCardCount: 24 })
  const controlBoard: SavedBoard = {
    ...base,
    aiSettings: BASE_SETTINGS,
  }
  const history = historyHeavyOutputs(controlBoard.outputs)
  const provenance = provenanceHeavyRuns(controlBoard)
  const settings = settingsHeavy()

  const fixture = (
    name: ColdDataFixtureCase,
    board: SavedBoard,
    options: {
      historicalVersionIds?: readonly string[]
      provenanceRunIds?: readonly string[]
    } = {},
  ): ColdDataRoiFixture => ({
    name,
    board,
    selectedCardId: SELECTED_CARD_ID,
    selectedOutputId: SELECTED_OUTPUT_ID,
    selectedVersionId: SELECTED_VERSION_ID,
    injectedHistoricalVersionIds: options.historicalVersionIds ?? [],
    injectedProvenanceRunIds: options.provenanceRunIds ?? [],
  })

  return {
    control: fixture('control', controlBoard),
    'history-heavy': fixture(
      'history-heavy',
      { ...controlBoard, outputs: history.outputs },
      { historicalVersionIds: history.versionIds },
    ),
    'provenance-heavy': fixture(
      'provenance-heavy',
      { ...controlBoard, runs: provenance.runs },
      { provenanceRunIds: provenance.runIds },
    ),
    'settings-heavy': fixture('settings-heavy', { ...controlBoard, aiSettings: settings }),
    combined: fixture(
      'combined',
      {
        ...controlBoard,
        outputs: history.outputs,
        runs: provenance.runs,
        aiSettings: settings,
      },
      {
        historicalVersionIds: history.versionIds,
        provenanceRunIds: provenance.runIds,
      },
    ),
  }
}

/**
 * Everything that can affect the selected Card's current Reading body and
 * version chrome. Cold historical bodies and run provenance are deliberately
 * omitted; all their visible metadata remains represented.
 */
export function readingHotSnapshot(fixture: ColdDataRoiFixture) {
  const { board } = fixture
  const selectedOutput = board.outputs.find((output) => output.id === fixture.selectedOutputId)
  const selectedVersion = selectedOutput?.versions.find((version) => version.id === fixture.selectedVersionId)
  const selectedRun = board.runs.find((run) => run.id === selectedVersion?.fromRunId)

  return {
    cards: board.cards,
    connections: board.connections,
    outputs: board.outputs.map((output) => ({
      id: output.id,
      resultCardId: output.resultCardId,
      chosenVersionId: output.chosenVersionId,
      versions: output.versions.map(versionMetadata),
      chosenPayload: chosenVersion(output),
    })),
    selection: {
      cardId: fixture.selectedCardId,
      outputId: fixture.selectedOutputId,
      versionId: fixture.selectedVersionId,
    },
    selectedRunSummary: selectedRun
      ? {
          id: selectedRun.id,
          model: selectedRun.model,
          status: selectedRun.status,
          producedVersionId: selectedRun.producedVersionId,
          contextBudget: selectedRun.contextBudget,
        }
      : null,
  }
}

function historyHeavyOutputs(outputs: Output[]): { outputs: Output[]; versionIds: string[] } {
  const versionIds: string[] = []
  const next = outputs.map((output) => {
    if (output.id !== SELECTED_OUTPUT_ID) return output
    return {
      ...output,
      versions: output.versions.map((version) => {
        if (version.id === output.chosenVersionId) return version
        versionIds.push(version.id)
        return {
          ...version,
          text: syntheticText(`Archived body for ${version.id}`, 96_000),
          followUpThread: version.followUpThread
            ? {
                ...version.followUpThread,
                messages: version.followUpThread.messages.map((message, index) => ({
                  ...message,
                  text: syntheticText(`Archived follow-up ${version.id}-${index + 1}`, 1_600),
                })),
              }
            : undefined,
        }
      }),
    }
  })
  return { outputs: next, versionIds }
}

function provenanceHeavyRuns(board: SavedBoard): { runs: RunRecord[]; runIds: string[] } {
  const cardIds = board.cards.slice(0, 12).map((card) => card.id)
  const connectionIds = board.connections.slice(0, 12).map((connection) => connection.id)
  const extraRuns = Array.from({ length: 18 }, (_, index): RunRecord => {
    const serial = String(index + 1).padStart(2, '0')
    return {
      id: `cold-provenance-run-${serial}`,
      startedAt: `2026-06-21T00:${serial}:00.000Z`,
      finishedAt: `2026-06-21T00:${serial}:02.000Z`,
      askAiCardId: 'benchmark-connection-anchor',
      model: 'synthetic-model',
      usedCardIds: cardIds,
      usedConnectionIds: connectionIds,
      modIds: [],
      appliedMods: [],
      compiledInstruction: syntheticText(`Historical compiled instruction ${serial}`, 7_200),
      status: 'done',
      kind: 'ask',
      contextBudget: {
        budgetTokens: 32_000,
        estimatedTokens: 9_000 + index,
        finalTokens: 9_000 + index,
        compactedCardIds: cardIds.slice(0, index % 4),
        droppedCardIds: [],
        mode: 'when-needed',
      },
    }
  })
  return {
    // Put completed history before the selected run so VersionContext's
    // current linear Array.find lookup exposes its exact structural burden.
    runs: [...extraRuns, ...board.runs],
    runIds: extraRuns.map((run) => run.id),
  }
}

function settingsHeavy(): BoardAiSettings {
  return {
    ...BASE_SETTINGS,
    models: [
      'synthetic-model',
      'synthetic-model-fast',
      'synthetic-model-careful',
      'synthetic-model-context',
    ],
    systemPrompt: syntheticText('Board-wide synthetic operating context', 32_000),
  }
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

function chosenVersion(output: Output) {
  const chosenId = output.chosenVersionId ?? output.versions[output.versions.length - 1]?.id
  const version = output.versions.find((candidate) => candidate.id === chosenId)
  if (!version) return null
  return {
    ...versionMetadata(version),
    text: version.text,
    transcript: version.transcript,
    followUpThread: version.followUpThread,
    sourceContext: version.sourceContext,
  }
}

function syntheticText(label: string, targetLength: number): string {
  const sentence = `${label}. This is deterministic, fictional, privacy-safe evidence for cold-data structure. `
  return sentence.repeat(Math.ceil(targetLength / sentence.length)).slice(0, targetLength)
}
