// Board-load settling of orphaned streaming follow-ups (issue #251). A page
// reload mid-stream leaves a follow-up reply stuck at 'streaming' with no
// stream left to finish it. These tests drive the real load seam — the store's
// loadIdea action through the disk storage API — and assert the orphan comes
// out 'stopped': visible as stopped-early, back in downstream context, and no
// longer spinning. Live streams appended in the current session stay streaming.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { followUpDiscussionSection, settledFollowUpMessages } from '../brain/followUpThread'
import { resetStorageBackendForTests } from './save'
import { useGraph } from './store'
import type { FollowUpMessage, IdeaSummary, SavedBoard } from './types'

const idea: IdeaSummary = {
  id: 'idea-main',
  name: 'Eido Main Idea',
  createdAt: '2026-06-16T00:00:00.000Z',
  updatedAt: '2026-06-16T00:00:00.000Z',
  lastOpenedAt: '2026-06-16T00:00:00.000Z',
}

function followUp(
  id: string,
  role: FollowUpMessage['role'],
  text: string,
  status: FollowUpMessage['status'],
): FollowUpMessage {
  return { id, role, text, createdAt: '2026-06-16T00:00:00.000Z', status }
}

// A board saved mid-stream: the assistant's reply never got finishFollowUpMessage.
function boardWithOrphanedStream(): SavedBoard {
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
              messages: [
                followUp('fu-1', 'user', 'Why Friday?', 'complete'),
                followUp('fu-2', 'assistant', 'The demo is ready and', 'streaming'),
              ],
            },
          },
        ],
      },
    ],
    runs: [],
    updatedAt: '2026-06-16T00:00:00.000Z',
  }
}

function json(body: unknown) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  })
}

function stubDiskBackend(board: SavedBoard) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'

    if (url === '/api/eido/status') {
      return json({ ok: true, dataFile: '/tmp/eido-v3-ideas.json', ideaCount: 1, hasUserContent: true })
    }
    if (url === '/api/eido/ideas/idea-main' && method === 'GET') {
      return json({ idea, board })
    }
    if (url === '/api/eido/ideas' && method === 'GET') {
      return json({ ideas: [idea] })
    }

    throw new Error(`Unhandled request: ${method} ${url}`)
  })
  vi.stubGlobal('fetch', fetchMock)
}

function loadedFollowUps(): FollowUpMessage[] {
  const version = useGraph.getState().outputs[0]?.versions[0]
  return version?.followUpThread?.messages ?? []
}

describe('settling orphaned streaming follow-ups on board load', () => {
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

  it('loads a mid-stream board with the orphan settled to stopped, partial text kept', async () => {
    stubDiskBackend(boardWithOrphanedStream())

    await useGraph.getState().loadIdea('idea-main')

    const messages = loadedFollowUps()
    expect(messages).toHaveLength(2)
    expect(messages.some((m) => m.status === 'streaming')).toBe(false)
    expect(messages[0]).toMatchObject({ id: 'fu-1', status: 'complete', text: 'Why Friday?' })
    expect(messages[1]).toMatchObject({
      id: 'fu-2',
      status: 'stopped',
      text: 'The demo is ready and',
    })
  })

  it('lets the settled orphan flow downstream like any other stopped reply', async () => {
    stubDiskBackend(boardWithOrphanedStream())

    await useGraph.getState().loadIdea('idea-main')

    const messages = loadedFollowUps()
    // settledFollowUpMessages is the shared filter behind both compiled
    // context and the source-change fingerprint (sourceContext.ts), so
    // inclusion here is what makes the staleness badge flip once.
    expect(settledFollowUpMessages(messages).map((m) => m.id)).toEqual(['fu-1', 'fu-2'])
    expect(followUpDiscussionSection(messages)).toContain(
      'Assistant (stopped early): The demo is ready and',
    )
  })

  it('leaves a stream started in the current session streaming', async () => {
    stubDiskBackend(boardWithOrphanedStream())

    await useGraph.getState().loadIdea('idea-main')
    useGraph
      .getState()
      .appendFollowUpMessage('version-1', followUp('fu-live', 'assistant', 'Writing now', 'streaming'))

    const live = loadedFollowUps().find((m) => m.id === 'fu-live')
    expect(live?.status).toBe('streaming')
  })
})
