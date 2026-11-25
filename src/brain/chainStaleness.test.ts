import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, Connection } from '../graph/types'
import { useGraph } from '../graph/store'
import { PROFILE_REVIEW_MODEL } from '../shared/profileReviewPolicy'
import { chainRunPreview, chainStepStatuses, extraRunCount } from './chainStaleness'
import { planChainRun } from './executionPlan'
import { cancelAiRun, runChain, type CompletionStream } from './runEngine'

function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    currentIdeaId: null,
    keyPromptOpen: false,
    settings: {
      apiKey: 'test-key',
      model: 'default/model',
      models: ['default/model'],
      reasoningEffort: 'medium',
    },
  })
}

function card(id: string, kind: Card['kind'], extra: Partial<Card> = {}): Card {
  return { id, kind, blocks: [{ id: `${id}-b`, text: '' }], position: { x: 0, y: 0 }, ...extra }
}

function feed(id: string, from: string, to: string): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}

// note-a → ask-a → result-a → ask-b, plus note-b → ask-b, so each step's
// staleness can be triggered independently by editing one note.
function chainBoard() {
  useGraph.setState({
    cards: [
      card('note-a', 'note', { blocks: [{ id: 'na-b', text: 'Fact for A.' }] }),
      card('ask-a', 'askAi', { blocks: [{ id: 'a-b', text: 'Summarise the fact.' }] }),
      card('result-a', 'result'),
      card('note-b', 'note', { blocks: [{ id: 'nb-b', text: 'Fact for B.' }] }),
      card('ask-b', 'askAi', { blocks: [{ id: 'b-b', text: 'Expand on the summary.' }] }),
    ],
    connections: [
      feed('c0', 'note-a', 'ask-a'),
      feed('c1', 'ask-a', 'result-a'),
      feed('c2', 'result-a', 'ask-b'),
      feed('c3', 'note-b', 'ask-b'),
    ],
  })
}

function editCardText(cardId: string, text: string) {
  useGraph.setState((state) => ({
    cards: state.cards.map((c) =>
      c.id === cardId ? { ...c, blocks: [{ ...c.blocks[0], text }] } : c,
    ),
  }))
}

const okStream: CompletionStream = async (_instruction, opts) => {
  opts.onChunk('answer')
  return 'answer'
}

function statusesNow() {
  const board = useGraph.getState().snapshot()
  const plan = planChainRun(board, 'ask-b')
  return chainStepStatuses(board, plan)
}

function reasonsByStepId() {
  return Object.fromEntries(statusesNow().map((s) => [s.step.id, s.reason]))
}

beforeEach(resetStore)
afterEach(() => vi.unstubAllGlobals())

describe('chainStepStatuses', () => {
  it('marks every step never-ran on a board with no results yet', () => {
    chainBoard()
    expect(reasonsByStepId()).toEqual({ 'ask:ask-a': 'never-ran', 'ask:ask-b': 'never-ran' })
  })

  it('marks every step fresh after a successful chain run', async () => {
    chainBoard()
    await runChain('ask-b', { stream: okStream })
    expect(reasonsByStepId()).toEqual({ 'ask:ask-a': 'fresh', 'ask:ask-b': 'fresh' })
  })

  it('creates a new target version when Run is pressed again with unchanged sources', async () => {
    chainBoard()
    await runChain('ask-b', { stream: okStream })

    const outcome = await runChain('ask-b', { stream: okStream, rerunTarget: true })
    const state = useGraph.getState()
    const targetRunIds = new Set(state.runs.filter((run) => run.askAiCardId === 'ask-b').map((run) => run.id))
    const targetVersions = state.outputs.flatMap((output) =>
      output.versions.filter((version) => targetRunIds.has(version.fromRunId)),
    )

    expect(outcome).toMatchObject({ ok: true, status: 'done', reusedStepIds: ['ask:ask-a'] })
    expect(outcome.steps.map((step) => step.cardId)).toEqual(['ask-b'])
    expect(targetVersions).toHaveLength(2)
  })

  it('marks a step source-changed when its input note is edited, and cascades downstream', async () => {
    chainBoard()
    await runChain('ask-b', { stream: okStream })

    editCardText('note-a', 'Fact for A, revised.')

    expect(reasonsByStepId()).toEqual({
      'ask:ask-a': 'source-changed',
      'ask:ask-b': 'upstream-ran',
    })
  })

  it('marks only the target stale when only its own input changed', async () => {
    chainBoard()
    await runChain('ask-b', { stream: okStream })

    editCardText('note-b', 'Fact for B, revised.')

    expect(reasonsByStepId()).toEqual({ 'ask:ask-a': 'fresh', 'ask:ask-b': 'source-changed' })
  })

  it('marks only the changed Ask stale when its selected model differs from the completed run', async () => {
    chainBoard()
    await runChain('ask-b', { stream: okStream })

    useGraph.getState().setCardModel('ask-b', 'alternate/model')

    expect(reasonsByStepId()).toEqual({ 'ask:ask-a': 'fresh', 'ask:ask-b': 'source-changed' })
  })

  it('compares chain freshness against the effective fixed review model', async () => {
    vi.stubGlobal('window', {
      eidoDesktop: true,
      eidoProfileReview: true,
    })
    chainBoard()
    useGraph.setState((state) => ({
      cards: state.cards.map((candidate) => candidate.kind === 'askAi'
        ? { ...candidate, model: 'historical/override' }
        : candidate),
    }))

    await runChain('ask-b', { stream: okStream })

    expect(useGraph.getState().runs.every((run) => run.model === PROFILE_REVIEW_MODEL)).toBe(true)
    expect(reasonsByStepId()).toEqual({ 'ask:ask-a': 'fresh', 'ask:ask-b': 'fresh' })
  })

  it('previews what will run without side effects and counts extra steps for the confirm gate', async () => {
    chainBoard()
    const beforeCards = useGraph.getState().cards
    const board = useGraph.getState().snapshot()

    const statuses = chainRunPreview(board, 'ask-b')

    // Zero side effects: no runs recorded, no outputs created, and the cards
    // array keeps its IDENTITY — nothing so much as touched the store.
    expect(useGraph.getState().runs).toEqual([])
    expect(useGraph.getState().outputs).toEqual([])
    expect(useGraph.getState().cards).toBe(beforeCards)

    // Both steps would run; only ask-a counts as "extra" beyond the pressed card.
    expect(statuses.map((s) => [s.step.cardId, s.willRun])).toEqual([
      ['ask-a', true],
      ['ask-b', true],
    ])
    expect(extraRunCount(statuses, 'ask-b')).toBe(1)

    // After a run everything is fresh: nothing extra, nothing to run.
    await runChain('ask-b', { stream: okStream })
    const fresh = chainRunPreview(useGraph.getState().snapshot(), 'ask-b')
    expect(fresh.every((s) => !s.willRun)).toBe(true)
    expect(extraRunCount(fresh, 'ask-b')).toBe(0)
  })

  it('treats a canceled provisional version as never having run', async () => {
    chainBoard()
    const cancelingStream: CompletionStream = async (_instruction, opts) => {
      opts.onChunk('partial')
      cancelAiRun('ask-a')
      return 'partial'
    }
    await runChain('ask-b', { stream: cancelingStream })

    const reasons = reasonsByStepId()
    expect(reasons['ask:ask-a']).toBe('never-ran')
    expect(reasons['ask:ask-b']).toBe('never-ran')
  })
})
