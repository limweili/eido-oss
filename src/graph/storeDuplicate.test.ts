// Duplicating a board mid-stream (issues #267, #286). duplicateCurrentIdea
// snapshots live session state, so a follow-up reply still streaming at
// duplicate time would be frozen at 'streaming' inside the copy's saved
// board. These tests drive the real duplicate seam — the store's
// duplicateCurrentIdea action through the disk storage API, with the real
// follow-up runner where a live stream is involved — and assert a live stream
// is aborted before the snapshot (#286), the copy is never born streaming,
// and a snapshot settle without a live run never mutates its input.
// Importing the runner here also registers its stream stopper with the store,
// exactly as loading the module does in the app.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  isFollowUpRunning,
  runFollowUp,
  type FollowUpStream,
} from '../brain/followUpRunner'
import { createSourceContextSnapshot } from '../brain/sourceContext'
import { resetStorageBackendForTests } from './save'
import { settleBoardSnapshotForDuplicate, useGraph } from './store'
import type { FollowUpMessage, IdeaSummary, RunRecord, SavedBoard } from './types'

const idea: IdeaSummary = {
  id: 'idea-main',
  name: 'Eido Main Idea',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
  lastOpenedAt: '2026-06-16T00:00:00.000Z',
}

const copyIdea: IdeaSummary = {
  id: 'idea-copy',
  name: 'Eido Main Idea copy',
  createdAt: '2026-06-17T00:00:00.000Z',
  updatedAt: '2026-06-17T00:00:00.000Z',
  lastOpenedAt: '2026-06-17T00:00:00.000Z',
}

const otherIdea: IdeaSummary = {
  id: 'idea-other',
  name: 'A different Idea',
  createdAt: '2026-06-18T00:00:00.000Z',
  updatedAt: '2026-06-18T00:00:00.000Z',
  lastOpenedAt: '2026-06-18T00:00:00.000Z',
}

function followUp(
  id: string,
  role: FollowUpMessage['role'],
  text: string,
  status: FollowUpMessage['status'],
): FollowUpMessage {
  return { id, role, text, createdAt: '2026-06-16T00:00:00.000Z', status }
}

// The run version-1 came from, so the real follow-up runner can rebuild its
// frozen context when a test streams a live follow-up.
function sourceRun(): RunRecord {
  return {
    id: 'run-1',
    startedAt: '2026-06-16T00:00:00.000Z',
    askAiCardId: 'ask-1',
    model: 'stored/model',
    usedCardIds: [],
    usedConnectionIds: [],
    modIds: [],
    appliedMods: [],
    compiledInstruction: 'Plan the launch.',
    producedVersionId: 'version-1',
    status: 'done',
  }
}

// A settled board as it would load from storage; a live stream is appended
// on top of it in-session, exactly as the follow-up runner does.
function settledBoard(): SavedBoard {
  return {
    version: 1,
    cards: [
      {
        id: 'result-1',
        kind: 'result',
        blocks: [{ id: 'result-1-block', text: '' }],
        position: { x: 0, y: 0 },
      },
    ],
    connections: [],
    outputs: [
      {
        id: 'output-1',
        resultCardId: 'result-1',
        chosenVersionId: 'version-1',
        versions: [
          {
            id: 'version-1',
            number: 1,
            text: 'Ship on Friday.',
            createdAt: '2026-06-16T00:00:00.000Z',
            fromRunId: 'run-1',
            followUpThread: {
              messages: [followUp('fu-1', 'user', 'Why Friday?', 'complete')],
            },
          },
        ],
      },
    ],
    runs: [sourceRun()],
    updatedAt: '2026-06-16T00:00:00.000Z',
  }
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

type CreatedIdea = { name: string; board: SavedBoard }

function stubDiskBackend(board: SavedBoard) {
  const created: CreatedIdea[] = []
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/eido/status') {
      return json({ ok: true, dataFile: '/tmp/eido-v3-ideas.json', ideaCount: 1, hasUserContent: true })
    }
    if (url === '/api/eido/ideas/idea-main' && method === 'GET') {
      return json({ idea, board })
    }
    if (url === '/api/eido/ideas/idea-other' && method === 'GET') {
      return json({ idea: otherIdea, board: { ...settledBoard(), outputs: [], runs: [] } })
    }
    if (url === '/api/eido/ideas' && method === 'GET') {
      return json({ ideas: [idea, otherIdea, ...created.map(() => copyIdea)] })
    }
    if (url === '/api/eido/ideas' && method === 'POST') {
      const body = JSON.parse(String(init?.body)) as CreatedIdea
      created.push(body)
      // The real server persists the submitted board and echoes it back.
      return json({ idea: copyIdea, board: body.board })
    }

    throw new Error(`Unhandled request: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
  return created
}

function currentFollowUps(): FollowUpMessage[] {
  const version = useGraph.getState().outputs[0]?.versions[0]
  return version?.followUpThread?.messages ?? []
}

function lastOf(messages: FollowUpMessage[]): FollowUpMessage | undefined {
  return messages[messages.length - 1]
}

describe('duplicating a board while a follow-up streams', () => {
  beforeEach(() => {
    resetStorageBackendForTests()
    vi.stubGlobal('indexedDB', {
      open: vi.fn(() => {
        throw new Error('IndexedDB should not be needed when disk storage is available')
      }),
    })
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      currentIdeaId: null,
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
    })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    resetStorageBackendForTests()
  })

  it('settles the copy while leaving the live board streaming untouched', async () => {
    const created = stubDiskBackend(settledBoard())

    await useGraph.getState().loadIdea('idea-main')
    useGraph
      .getState()
      .appendFollowUpMessage('version-1', followUp('fu-live', 'assistant', 'The demo is', 'streaming'))

    // Hold the live objects the snapshot shares with store state: the settle
    // must never mutate them.
    const liveOutputs = useGraph.getState().outputs
    const liveMessage = currentFollowUps().find((m) => m.id === 'fu-live')

    await useGraph.getState().duplicateCurrentIdea('Eido Main Idea copy')

    // The persisted copy carries the reply as stopped-early, never streaming.
    expect(created).toHaveLength(1)
    const persisted = created[0].board.outputs[0].versions[0].followUpThread?.messages ?? []
    expect(persisted.some((m) => m.status === 'streaming')).toBe(false)
    expect(persisted.find((m) => m.id === 'fu-live')).toMatchObject({
      status: 'stopped',
      text: 'The demo is',
    })

    // The copy is now the current board, also settled.
    expect(useGraph.getState().currentIdeaId).toBe('idea-copy')
    expect(currentFollowUps().some((m) => m.status === 'streaming')).toBe(false)

    // The board the snapshot was taken from was never touched.
    expect(liveMessage?.status).toBe('streaming')
    expect(
      liveOutputs[0].versions[0].followUpThread?.messages.find((m) => m.id === 'fu-live')?.status,
    ).toBe('streaming')
  })

  it('aborts a live follow-up stream before snapshotting, so stopped is truthful and final', async () => {
    const created = stubDiskBackend(settledBoard())

    await useGraph.getState().loadIdea('idea-main')
    useGraph.setState({ settings: { ...useGraph.getState().settings, apiKey: 'test-key' } })

    // A real runner stream that behaves like the network: it emits a chunk
    // and then hangs until its abort signal fires.
    let streamAborted = false
    let announceStreamStarted: (() => void) | undefined
    const streamStarted = new Promise<void>((resolve) => {
      announceStreamStarted = resolve
    })
    const stream: FollowUpStream = (_instruction, opts) =>
      new Promise((_resolve, reject) => {
        opts.onChunk('The demo is')
        announceStreamStarted?.()
        opts.signal?.addEventListener('abort', () => {
          streamAborted = true
          reject(new DOMException('The stream was aborted', 'AbortError'))
        })
      })
    const running = runFollowUp('version-1', 'When is the demo?', { stream })
    await streamStarted
    expect(isFollowUpRunning('version-1')).toBe(true)

    await useGraph.getState().duplicateCurrentIdea('Eido Main Idea copy')

    // The duplicate aborted the stream first; the runner settles it exactly
    // like the card's Stop button.
    expect(streamAborted).toBe(true)
    await expect(running).resolves.toMatchObject({ ok: true, status: 'stopped' })
    expect(isFollowUpRunning('version-1')).toBe(false)

    // Both the persisted copy and the runtime copy carry the reply stopped
    // early with the text it had at abort time — never streaming.
    expect(useGraph.getState().currentIdeaId).toBe('idea-copy')
    const persisted = created[0].board.outputs[0].versions[0].followUpThread?.messages ?? []
    expect(persisted.some((m) => m.status === 'streaming')).toBe(false)
    expect(lastOf(persisted)).toMatchObject({ status: 'stopped', text: 'The demo is' })
    expect(lastOf(currentFollowUps())).toMatchObject({ status: 'stopped', text: 'The demo is' })

    // Nothing trails in after the duplicate: with the stream fully wound
    // down, the reply's text and the result's source fingerprint stay put —
    // no late chunks, no 'stopped' -> 'complete' overwrite, no badge churn.
    const settledText = lastOf(currentFollowUps())?.text
    const fingerprint = createSourceContextSnapshot(useGraph.getState().snapshot(), [
      { cardId: 'result-1' },
    ])
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(lastOf(currentFollowUps())).toMatchObject({ status: 'stopped', text: settledText })
    expect(
      createSourceContextSnapshot(useGraph.getState().snapshot(), [{ cardId: 'result-1' }]),
    ).toEqual(fingerprint)
  })

  it('cancels an admission-pending follow-up before the copy can inherit it', async () => {
    const created = stubDiskBackend(settledBoard())

    await useGraph.getState().loadIdea('idea-main')
    useGraph.setState({ settings: { ...useGraph.getState().settings, apiKey: 'test-key' } })
    const stream: FollowUpStream = vi.fn(async () => 'must not start')

    const running = runFollowUp('version-1', 'When is the demo?', { stream })
    expect(isFollowUpRunning('version-1')).toBe(true)
    const competing = runFollowUp('version-1', 'Can a second reply steal the lifecycle?', { stream })
    expect(isFollowUpRunning('version-1')).toBe(true)

    await useGraph.getState().duplicateCurrentIdea('Eido Main Idea copy')

    await expect(competing).resolves.toMatchObject({ ok: false, reason: 'failed' })
    await expect(running).resolves.toEqual({ ok: true, status: 'cancelled-before-start' })
    expect(stream).not.toHaveBeenCalled()
    expect(isFollowUpRunning('version-1')).toBe(false)
    expect(created).toHaveLength(1)
    const persisted = created[0].board.outputs[0].versions[0].followUpThread?.messages ?? []
    expect(persisted).toEqual([followUp('fu-1', 'user', 'Why Friday?', 'complete')])
  })

  it('cancels pending BYOK work when another Board starts loading', async () => {
    stubDiskBackend(settledBoard())

    await useGraph.getState().loadIdea('idea-main')
    useGraph.setState({ settings: { ...useGraph.getState().settings, apiKey: 'test-key' } })
    const stream: FollowUpStream = vi.fn(async () => 'must not start')

    const running = runFollowUp('version-1', 'When is the demo?', { stream })
    await useGraph.getState().loadIdea('idea-other')

    await expect(running).resolves.toEqual({ ok: true, status: 'cancelled-before-start' })
    expect(stream).not.toHaveBeenCalled()
    expect(useGraph.getState().currentIdeaId).toBe('idea-other')
  })

  it('aborts a live BYOK stream when another Board starts loading', async () => {
    stubDiskBackend(settledBoard())

    await useGraph.getState().loadIdea('idea-main')
    useGraph.setState({ settings: { ...useGraph.getState().settings, apiKey: 'test-key' } })
    let streamSignal: AbortSignal | undefined
    let announceStarted: (() => void) | undefined
    let finishWithoutAbort: (() => void) | undefined
    const started = new Promise<void>((resolve) => { announceStarted = resolve })
    const stream: FollowUpStream = (_instruction, options) => new Promise((resolve, reject) => {
      streamSignal = options.signal
      announceStarted?.()
      finishWithoutAbort = () => resolve('late reply')
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })

    const running = runFollowUp('version-1', 'When is the demo?', { stream })
    await started
    await useGraph.getState().loadIdea('idea-other')
    const wasAborted = streamSignal?.aborted === true
    if (!wasAborted) finishWithoutAbort?.()
    await running

    expect(wasAborted).toBe(true)
    expect(useGraph.getState().currentIdeaId).toBe('idea-other')
  })

  it('aborts a live BYOK stream when its Result is deleted', async () => {
    stubDiskBackend(settledBoard())
    await useGraph.getState().loadIdea('idea-main')
    useGraph.setState({ settings: { ...useGraph.getState().settings, apiKey: 'test-key' } })
    let streamSignal: AbortSignal | undefined
    let announceStarted: (() => void) | undefined
    let finishWithoutAbort: (() => void) | undefined
    const started = new Promise<void>((resolve) => { announceStarted = resolve })
    const stream: FollowUpStream = (_instruction, options) => new Promise((resolve, reject) => {
      streamSignal = options.signal
      announceStarted?.()
      finishWithoutAbort = () => resolve('late reply')
      options.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
    })

    const running = runFollowUp('version-1', 'When is the demo?', { stream })
    await started
    useGraph.getState().deleteCard('result-1')
    const wasAborted = streamSignal?.aborted === true
    if (!wasAborted) finishWithoutAbort?.()
    await running

    expect(wasAborted).toBe(true)
  })

  it('makes no stop or settle calls when nothing is streaming', async () => {
    stubDiskBackend(settledBoard())

    await useGraph.getState().loadIdea('idea-main')
    // cancelFollowUp settles through finishFollowUpMessage, so an untouched
    // spy proves the stream stopper let the idle board pass straight through.
    const finishSpy = vi.spyOn(useGraph.getState(), 'finishFollowUpMessage')

    await useGraph.getState().duplicateCurrentIdea('Eido Main Idea copy')

    expect(finishSpy).not.toHaveBeenCalled()
    expect(useGraph.getState().currentIdeaId).toBe('idea-copy')
  })

  it('lets a writer the abort seam cannot see land in the copy and self-heal to complete', async () => {
    stubDiskBackend(settledBoard())

    await useGraph.getState().loadIdea('idea-main')
    useGraph
      .getState()
      .appendFollowUpMessage('version-1', followUp('fu-live', 'assistant', 'The demo is', 'streaming'))

    await useGraph.getState().duplicateCurrentIdea('Eido Main Idea copy')

    // The store's writers address by version/message id against current
    // state, and the copy keeps the same ids. A registered run is aborted at
    // the duplicate seam before it can write again (#286); these direct calls
    // simulate a writer with no registry entry, pinning the addressing
    // semantics that make abort-first necessary — the snapshot settle alone
    // could not keep such a writer out of the copy.
    useGraph.getState().appendFollowUpChunk('version-1', 'fu-live', ' ready and shipping.')
    useGraph.getState().finishFollowUpMessage('version-1', 'fu-live', 'complete')

    expect(currentFollowUps().find((m) => m.id === 'fu-live')).toMatchObject({
      status: 'complete',
      text: 'The demo is ready and shipping.',
    })
  })

  it('duplicates without settle churn when nothing is streaming', async () => {
    const created = stubDiskBackend(settledBoard())

    await useGraph.getState().loadIdea('idea-main')
    await useGraph.getState().duplicateCurrentIdea('Eido Main Idea copy')

    expect(created).toHaveLength(1)
    const persisted = created[0].board.outputs[0].versions[0].followUpThread?.messages ?? []
    expect(persisted).toHaveLength(1)
    expect(persisted[0]).toMatchObject({ id: 'fu-1', status: 'complete' })
  })
})

describe('settleBoardSnapshotForDuplicate', () => {
  it('returns the same board reference when nothing is streaming', () => {
    const board = settledBoard()
    expect(settleBoardSnapshotForDuplicate(board)).toBe(board)
  })

  it('settles streaming replies to stopped without mutating the input board', () => {
    const board = settledBoard()
    const thread = board.outputs[0].versions[0].followUpThread
    thread?.messages.push(followUp('fu-live', 'assistant', 'Half a thought', 'streaming'))

    const settled = settleBoardSnapshotForDuplicate(board)

    expect(settled).not.toBe(board)
    const settledMessages = settled.outputs[0].versions[0].followUpThread?.messages ?? []
    expect(settledMessages.find((m) => m.id === 'fu-live')).toMatchObject({
      status: 'stopped',
      text: 'Half a thought',
    })
    // Input board untouched — the live board shares these references.
    expect(thread?.messages.find((m) => m.id === 'fu-live')?.status).toBe('streaming')
  })
})
