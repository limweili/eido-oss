// An Agentic Run at the graph seam (ADR 0033): the Card's request for one, and
// the record of what the model did. Whether the tools were any good is the
// provider's business; whether Eido stores the answer honestly is this file's.
import { beforeEach, describe, expect, it } from 'vitest'
import { useGraph } from './store'
import { validateSavedBoardTransport } from '../persistence/profileLogicalProjection'
import type { Card, RunToolStep } from './types'

function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    intentLog: [],
    compactionSummaries: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    hydrated: false,
    currentIdeaId: null,
  })
}

function cardById(id: string): Card {
  const card = useGraph.getState().cards.find((candidate) => candidate.id === id)
  if (!card) throw new Error(`no card ${id}`)
  return card
}

function beginAskRun(askId: string, agentic?: true): string {
  return startAskRun(askId, agentic).runId
}

function startAskRun(askId: string, agentic?: true) {
  return useGraph.getState().beginRun(askId, {
    text: 'What shipped in the latest Electron release?',
    model: 'openai/gpt-4o',
    usedCardIds: [askId],
    usedConnectionIds: [],
    modIds: [],
    appliedMods: [],
    ...(agentic ? { agentic } : {}),
  })
}

beforeEach(resetStore)

describe('asking a Card for an Agentic Run', () => {
  it('turns on and off, and leaves no trace when off', () => {
    const askId = useGraph.getState().addCard('askAi', { x: 0, y: 0 })
    expect(cardById(askId).agentic).toBeUndefined()

    useGraph.getState().setCardAgentic(askId, true)
    expect(cardById(askId).agentic).toBe(true)

    // Off deletes the key rather than storing false, so a Board written here
    // still opens in a build that has never heard of Agentic Runs.
    useGraph.getState().setCardAgentic(askId, false)
    expect('agentic' in cardById(askId)).toBe(false)
  })

  it('is an Ask AI setting only', () => {
    const noteId = useGraph.getState().addCard('note', { x: 0, y: 0 })

    useGraph.getState().setCardAgentic(noteId, true)

    expect(cardById(noteId).agentic).toBeUndefined()
  })
})

describe('what the model did', () => {
  const steps: RunToolStep[] = [
    { kind: 'search', detail: 'electron 40 release notes' },
    { kind: 'read', detail: 'https://example.test/electron-40', title: 'Electron 40' },
  ]

  it('is recorded on the run in the order it happened', () => {
    const askId = useGraph.getState().addCard('askAi', { x: 0, y: 0 })
    const runId = beginAskRun(askId)

    for (const step of steps) useGraph.getState().recordRunToolStep(runId, step)

    const run = useGraph.getState().runs.find((candidate) => candidate.id === runId)
    expect(run?.toolSteps).toEqual(steps)
  })

  it('survives the persistence boundary with the run it belongs to', () => {
    const askId = useGraph.getState().addCard('askAi', { x: 0, y: 0 })
    useGraph.getState().setCardAgentic(askId, true)
    const runId = beginAskRun(askId)
    for (const step of steps) useGraph.getState().recordRunToolStep(runId, step)
    useGraph.getState().finishRun(runId)

    const board = JSON.parse(JSON.stringify(useGraph.getState().snapshot())) as unknown
    const restored = validateSavedBoardTransport(board)

    expect(restored.cards.find((card) => card.id === askId)?.agentic).toBe(true)
    expect(restored.runs.find((run) => run.id === runId)?.toolSteps).toEqual(steps)
  })

  it('is never copied into the history events that clone the run', () => {
    // There is no cap on how many tools a run may use (ADR 0033), and every run
    // event clones the whole run. Without this, one long investigation would
    // multiply its own step list across the save.
    const askId = useGraph.getState().addCard('askAi', { x: 0, y: 0 })
    const runId = beginAskRun(askId)
    for (const step of steps) useGraph.getState().recordRunToolStep(runId, step)
    useGraph.getState().finishRun(runId)

    const saved = useGraph.getState().snapshot()
    const runEvents = (saved.intentLog ?? []).filter((event) => 'run' in (event.data as Record<string, unknown>))

    expect(runEvents.length).toBeGreaterThan(0)
    for (const event of runEvents) {
      expect((event.data as { run: Record<string, unknown> }).run).not.toHaveProperty('toolSteps')
    }
    // The run itself keeps them: this strips the copies, not the record.
    expect(saved.runs.find((run) => run.id === runId)?.toolSteps).toEqual(steps)
  })

  it('carries a step kind this build does not recognise through the save', () => {
    // A Profile written by a later Eido must open in this one (ADR 0035). The
    // key set stays closed, so nothing unknown rides in; the vocabulary is
    // open, so an unfamiliar kind is a fact about what happened rather than a
    // reason to reject the whole Run.
    const askId = useGraph.getState().addCard('askAi', { x: 0, y: 0 })
    const runId = beginAskRun(askId)
    const future: RunToolStep = { kind: 'run-code', detail: 'notebook.ipynb', title: 'Ran a notebook' }

    useGraph.getState().recordRunToolStep(runId, future)
    useGraph.getState().finishRun(runId)

    const board = JSON.parse(JSON.stringify(useGraph.getState().snapshot())) as unknown
    const restored = validateSavedBoardTransport(board)

    expect(restored.runs.find((run) => run.id === runId)?.toolSteps).toEqual([future])
  })
})

describe('the research-job stash', () => {
  it('holds the job id in card.meta from submission until cleared, beside what meta already carries', () => {
    // A submitted research job cannot be cancelled (#963); the id is the only
    // handle to what was paid for, so it must land in the one open-record
    // Card surface and must not disturb the reach mode riding beside it.
    const askId = useGraph.getState().addCard('askAi', { x: 0, y: 0 })
    useGraph.getState().setCardReach(askId, 'research')

    useGraph.getState().recordCardResearchJob(askId, 'job-7')

    const stashed = cardById(askId)
    expect(stashed.meta?.reachMode).toBe('research')
    expect((stashed.meta?.researchJob as { id: string }).id).toBe('job-7')
    expect(typeof (stashed.meta?.researchJob as { submittedAt: string }).submittedAt).toBe('string')

    useGraph.getState().clearCardResearchJob(askId)

    expect(cardById(askId).meta).toEqual({ reachMode: 'research' })
  })

  it('leaves a Card that only briefly held a job byte-identical to one that never did', () => {
    const askId = useGraph.getState().addCard('askAi', { x: 0, y: 0 })

    useGraph.getState().recordCardResearchJob(askId, 'job-8')
    useGraph.getState().clearCardResearchJob(askId)

    expect('meta' in cardById(askId)).toBe(false)
  })

  it('is a system write: no undo entry, because forgetting spent money undoes nothing', () => {
    const askId = useGraph.getState().addCard('askAi', { x: 0, y: 0 })
    const undoDepth = useGraph.getState().undoStack.length

    useGraph.getState().recordCardResearchJob(askId, 'job-9')
    useGraph.getState().clearCardResearchJob(askId)

    expect(useGraph.getState().undoStack.length).toBe(undoDepth)
  })
})

describe('what a follow-up did', () => {
  const step: RunToolStep = { kind: 'search', detail: 'electron 41 release date' }

  it('is recorded on the reply that looked it up, not on the run below it', () => {
    // Research does not stop at the first answer. Each reply is its own piece of
    // it, so the reader can tell which answer rests on what.
    const askId = useGraph.getState().addCard('askAi', { x: 0, y: 0 })
    const { versionId } = startAskRun(askId, true)
    useGraph.getState().appendFollowUpMessage(versionId, {
      id: 'fu_1',
      role: 'assistant',
      text: '',
      createdAt: new Date().toISOString(),
      status: 'streaming',
    })

    useGraph.getState().recordFollowUpToolStep(versionId, 'fu_1', step)

    const board = JSON.parse(JSON.stringify(useGraph.getState().snapshot())) as unknown
    const restored = validateSavedBoardTransport(board)
    const version = restored.outputs
      .flatMap((output) => output.versions)
      .find((candidate) => candidate.id === versionId)

    expect(version?.followUpThread?.messages[0]?.toolSteps).toEqual([step])
    expect(restored.runs.find((run) => run.id === version?.fromRunId)?.toolSteps).toBeUndefined()
  })

  it('inherits the permission the run recorded, not the switch on the Card', () => {
    // A run carries what it was allowed to do. The Card's toggle may have moved
    // since, and a follow-up continues the run, not the toggle.
    const askId = useGraph.getState().addCard('askAi', { x: 0, y: 0 })
    const runId = beginAskRun(askId, true)
    useGraph.getState().setCardAgentic(askId, false)

    const board = JSON.parse(JSON.stringify(useGraph.getState().snapshot())) as unknown
    const restored = validateSavedBoardTransport(board)

    expect(restored.runs.find((run) => run.id === runId)?.agentic).toBe(true)
    expect('agentic' in cardById(askId)).toBe(false)
  })
})
