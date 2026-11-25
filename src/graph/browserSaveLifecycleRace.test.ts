import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { IdeaSummary, SavedBoard } from './types'

const saveMocks = vi.hoisted(() => ({
  loadInitialIdea: vi.fn(),
  loadIdea: vi.fn(),
  listIdeas: vi.fn(),
  saveIdeaBoard: vi.fn(),
  createIdea: vi.fn(),
  deleteIdea: vi.fn(),
  renameIdea: vi.fn(),
}))

// Keep this test on a fully synthetic in-memory storage seam. The real
// debounced saver is retained so the lifecycle assertions exercise its lazy
// request identity and flush barrier through the store.
vi.mock('./save', async () => {
  const actual = await vi.importActual<typeof import('./save')>('./save')
  return {
    ...actual,
    loadInitialIdea: saveMocks.loadInitialIdea,
    loadIdea: saveMocks.loadIdea,
    listIdeas: saveMocks.listIdeas,
    saveIdeaBoard: saveMocks.saveIdeaBoard,
    createIdea: saveMocks.createIdea,
    deleteIdea: saveMocks.deleteIdea,
    renameIdea: saveMocks.renameIdea,
    currentStorageStatus: () => ({ backend: 'browser', warning: 'synthetic test storage' }),
  }
})

import { resetGraphPersistenceForTests, useGraph } from './store'

const ideaA: IdeaSummary = {
  id: 'idea-a',
  name: 'Idea A',
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
  lastOpenedAt: '2026-08-22T00:00:00.000Z',
}

const ideaB: IdeaSummary = {
  id: 'idea-b',
  name: 'Idea B',
  createdAt: '2026-08-22T00:00:00.000Z',
  updatedAt: '2026-08-22T00:00:00.000Z',
  lastOpenedAt: '2026-08-22T00:00:00.000Z',
}

const boardA: SavedBoard = {
  version: 1,
  cards: [{
    id: 'note-a',
    kind: 'note',
    blocks: [{ id: 'note-a-block', text: 'A-original' }],
    position: { x: 0, y: 0 },
  }],
  connections: [],
  outputs: [],
  runs: [],
  updatedAt: '2026-08-22T00:00:00.000Z',
}

const boardB: SavedBoard = {
  version: 1,
  cards: [{
    id: 'note-b',
    kind: 'note',
    blocks: [{ id: 'note-b-block', text: 'B-original' }],
    position: { x: 400, y: 0 },
  }],
  connections: [],
  outputs: [],
  runs: [],
  updatedAt: '2026-08-22T00:00:00.000Z',
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((nextResolve) => {
    resolve = nextResolve
  })
  return { promise, resolve }
}

function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    highlights: [],
    highlightTags: [],
    intentLog: [],
    compactionSummaries: [],
    currentIdeaId: null,
    ideas: [],
    hydrated: false,
    saveState: 'saved',
    undoStack: [],
    redoStack: [],
    selection: null,
    selectedCardIds: [],
    profileStartupState: 'idle',
    profileStartupError: null,
  })
}

describe('browser-development save lifecycle races', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.clearAllMocks()
    resetGraphPersistenceForTests()
    resetStore()
    saveMocks.loadInitialIdea.mockResolvedValue({
      idea: ideaA,
      board: boardA,
      ideas: [ideaA, ideaB],
    })
    saveMocks.listIdeas.mockResolvedValue([ideaA, ideaB])
    saveMocks.saveIdeaBoard.mockResolvedValue(ideaA)
    saveMocks.loadIdea.mockResolvedValue(null)
    saveMocks.deleteIdea.mockResolvedValue(undefined)
    await useGraph.getState().hydrate()
  })

  afterEach(() => {
    resetGraphPersistenceForTests()
    vi.useRealTimers()
  })

  it('flushes the latest Idea A request before loading B without cross-Idea overwrite', async () => {
    const firstWrite = deferred<void>()
    const loadingB = deferred<{ idea: IdeaSummary; board: SavedBoard } | null>()
    const writes: Array<{ ideaId: string; board: SavedBoard }> = []
    let writeCount = 0

    saveMocks.saveIdeaBoard.mockImplementation(async (ideaId: string, board: SavedBoard) => {
      writes.push({ ideaId, board })
      writeCount += 1
      if (writeCount === 1) await firstWrite.promise
      return ideaId === ideaA.id ? ideaA : ideaB
    })
    saveMocks.loadIdea.mockImplementation(async (id: string) => {
      if (id === ideaB.id) return loadingB.promise
      return null
    })

    useGraph.getState().setCardText('note-a', 'A-first')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(writes).toHaveLength(1)
    expect(writes[0]).toMatchObject({ ideaId: ideaA.id })
    expect(writes[0]?.board.cards[0]?.blocks[0]?.text).toBe('A-first')

    const loadBPromise = useGraph.getState().loadIdea(ideaB.id)
    await Promise.resolve()

    // B loading has started, but the lifecycle flush is still waiting on the
    // older A write. This mutation must join that exact flush, not acquire a
    // timer or become a B write.
    useGraph.getState().setCardText('note-a', 'A-latest')
    expect(writes).toHaveLength(1)
    expect(useGraph.getState().currentIdeaId).toBe(ideaA.id)

    firstWrite.resolve()
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve()

    expect(writes).toHaveLength(2)
    expect(writes.every((write) => write.ideaId === ideaA.id)).toBe(true)
    expect(writes[1]?.board.cards[0]?.blocks[0]?.text).toBe('A-latest')

    loadingB.resolve({ idea: ideaB, board: boardB })
    await loadBPromise

    expect(useGraph.getState().currentIdeaId).toBe(ideaB.id)
    expect(useGraph.getState().cards[0]?.blocks[0]?.text).toBe('B-original')
    expect(useGraph.getState().saveState).toBe('saved')
    await vi.advanceTimersByTimeAsync(3_000)
    expect(writes).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('blocks mutations from scheduling a write after current-Idea deletion admission', async () => {
    const deletion = deferred<string | undefined>()
    saveMocks.deleteIdea.mockImplementation(async () => deletion.promise)
    saveMocks.loadIdea.mockImplementation(async (id: string) => (
      id === ideaB.id ? { idea: ideaB, board: boardB } : null
    ))
    saveMocks.listIdeas.mockResolvedValue([ideaB])

    const deletePromise = useGraph.getState().deleteIdea(ideaA.id)
    await Promise.resolve()
    useGraph.getState().setCardText('note-a', 'after-delete-admission')

    expect(saveMocks.saveIdeaBoard).not.toHaveBeenCalled()
    deletion.resolve(ideaB.id)
    await deletePromise

    expect(useGraph.getState().currentIdeaId).toBe(ideaB.id)
    expect(useGraph.getState().saveState).toBe('saved')
    expect(saveMocks.saveIdeaBoard).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('does not install Idea B when the lifecycle flush rejects an Idea A save', async () => {
    const failure = new Error('synthetic disk failure')
    const loadB = vi.fn(async () => ({ idea: ideaB, board: boardB }))
    saveMocks.loadIdea.mockImplementation(loadB)
    saveMocks.saveIdeaBoard.mockRejectedValue(failure)

    useGraph.getState().setCardText('note-a', 'A-not-durable')
    const loadPromise = useGraph.getState().loadIdea(ideaB.id)

    // A failed exact flush must stop the lifecycle before it asks storage for
    // B. Whether the action surfaces the failure to its caller or records it
    // and returns is an implementation choice; both retain A and the failed
    // status, which is the data-safety contract.
    await loadPromise.catch(() => undefined)

    expect(loadB).not.toHaveBeenCalled()
    expect(useGraph.getState().currentIdeaId).toBe(ideaA.id)
    expect(useGraph.getState().cards[0]?.blocks[0]?.text).toBe('A-not-durable')
    expect(useGraph.getState().saveState).toBe('failed')
  })

  it('flushes active Idea A before completing an asynchronous shelf-Idea B deletion', async () => {
    const deletion = deferred<string | undefined>()
    const writes: Array<{ ideaId: string; board: SavedBoard }> = []
    saveMocks.deleteIdea.mockImplementation(async () => deletion.promise)
    saveMocks.listIdeas.mockResolvedValue([ideaA])
    saveMocks.saveIdeaBoard.mockImplementation(async (ideaId: string, board: SavedBoard) => {
      writes.push({ ideaId, board })
      return ideaA
    })

    const deletePromise = useGraph.getState().deleteIdea(ideaB.id)
    for (let turn = 0; turn < 4; turn += 1) await Promise.resolve()

    // B is a shelf Idea, so A remains the active owner while its deletion is
    // awaiting storage. A mutation during that window is allowed to schedule
    // a normal quiet save, but must be flushed before deletion reports saved.
    useGraph.getState().setCardText('note-a', 'A-while-B-deletes')
    expect(writes).toHaveLength(0)
    expect(vi.getTimerCount()).toBe(1)

    deletion.resolve(undefined)
    await deletePromise

    expect(writes).toHaveLength(1)
    expect(writes[0]?.ideaId).toBe(ideaA.id)
    expect(writes[0]?.board.cards[0]?.blocks[0]?.text).toBe('A-while-B-deletes')
    expect(useGraph.getState().currentIdeaId).toBe(ideaA.id)
    expect(useGraph.getState().saveState).toBe('saved')
    expect(vi.getTimerCount()).toBe(0)
  })

  it('refreshes the bound browser source across high-frequency transcript chunks', async () => {
    useGraph.setState({
      outputs: [{
        id: 'conversation-output',
        resultCardId: 'conversation-result',
        chosenVersionId: 'conversation-version',
        versions: [{
          id: 'conversation-version',
          number: 1,
          text: '',
          createdAt: '2026-08-22T00:00:00.000Z',
          fromRunId: 'conversation-run',
          transcript: [{
            id: 'transcript-message',
            speakerKind: 'participant',
            speakerName: 'Analyst',
            text: '',
            turnNumber: 1,
            streaming: true,
          }],
        }],
      }],
    })
    saveMocks.saveIdeaBoard.mockClear()

    useGraph.getState().appendTranscriptChunk(
      'conversation-version',
      'transcript-message',
      'First',
    )
    // Queued work is not a write. The indicator only claims "Saving" once
    // the writer starts, so the quiet window keeps the last real status.
    expect(useGraph.getState().saveState).not.toBe('saving')
    await vi.advanceTimersByTimeAsync(2_999)
    expect(saveMocks.saveIdeaBoard).not.toHaveBeenCalled()

    useGraph.getState().appendTranscriptChunk(
      'conversation-version',
      'transcript-message',
      ' second',
    )
    await vi.advanceTimersByTimeAsync(2_999)
    expect(saveMocks.saveIdeaBoard).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)

    expect(saveMocks.saveIdeaBoard).toHaveBeenCalledOnce()
    expect(saveMocks.saveIdeaBoard.mock.calls[0]?.[0]).toBe(ideaA.id)
    expect(saveMocks.saveIdeaBoard.mock.calls[0]?.[1].outputs[0]?.versions[0]?.transcript?.[0]?.text)
      .toBe('First second')
    expect(useGraph.getState().saveState).toBe('saved')
  })
})
