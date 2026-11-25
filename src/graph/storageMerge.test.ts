import { describe, expect, it } from 'vitest'
import { mergeBrowserStore, type IdeaStore } from './storageMerge'
import type { IdeaSummary, SavedBoard, TranscriptMessage } from './types'

describe('browser-to-disk storage merge', () => {
  it('replaces an existing disk idea when the browser copy has newer content', () => {
    const disk = store(
      idea('idea-jade', "Jade's health stuff", '2026-06-16T09:38:28.029Z'),
      conversationBoard('2026-06-16T09:38:28.029Z', 10, 11),
    )
    const browser = store(
      idea('idea-jade', "Jade's Health Stuff", '2026-06-16T10:17:43.495Z'),
      conversationBoard('2026-06-16T10:17:43.495Z', 35, 36),
    )

    const result = mergeBrowserStore(disk, browser, { makeRecoveredId: () => 'idea-recovered' })
    const board = result.store.boards['idea-jade']

    expect(result.summary).toEqual({ imported: 0, replaced: 1, skipped: 0, recoveredConflicts: 0 })
    expect(result.replacedIds).toEqual(['idea-jade'])
    expect(result.store.ideas.find((item) => item.id === 'idea-jade')?.name).toBe("Jade's Health Stuff")
    expect(board.runs[0].conversation?.turns).toHaveLength(35)
    expect(board.outputs[0].versions[0].transcript).toHaveLength(36)
  })

  it('preserves existing image payloads when a newer browser copy only has asset metadata', () => {
    const disk = store(
      idea('idea-jade', 'Jade', '2026-06-16T09:00:00.000Z'),
      boardWithImage('data:image/png;base64,live-payload', '2026-06-16T09:00:00.000Z'),
    )
    const browser = store(
      idea('idea-jade', 'Jade', '2026-06-16T10:00:00.000Z'),
      boardWithImage('', '2026-06-16T10:00:00.000Z'),
    )

    const result = mergeBrowserStore(disk, browser)
    const asset = result.store.boards['idea-jade'].cards[0].assets?.[0]

    expect(result.summary).toEqual({ imported: 0, replaced: 1, skipped: 0, recoveredConflicts: 0 })
    expect(asset?.dataUrl).toBe('data:image/png;base64,live-payload')
    expect(result.store.boards['idea-jade'].cards[0].blocks[0].text).toBe('Browser note')
  })

  it('keeps disk when disk content is newer even if browser was opened later', () => {
    const disk = store(
      idea('idea-jade', "Jade's health stuff", '2026-06-16T10:17:43.495Z', '2026-06-16T10:00:00.000Z'),
      conversationBoard('2026-06-16T10:17:43.495Z', 35, 36),
    )
    const browser = store(
      idea('idea-jade', "Jade's health stuff", '2026-06-16T09:38:28.029Z', '2026-06-16T11:00:00.000Z'),
      conversationBoard('2026-06-16T09:38:28.029Z', 10, 11),
    )

    const result = mergeBrowserStore(disk, browser)

    expect(result.summary).toEqual({ imported: 0, replaced: 0, skipped: 1, recoveredConflicts: 0 })
    expect(result.store.boards['idea-jade'].runs[0].conversation?.turns).toHaveLength(35)
    expect(result.store.boards['idea-jade'].outputs[0].versions[0].transcript).toHaveLength(36)
  })

  it('imports a same-timestamp payload conflict as a recovered duplicate', () => {
    const disk = store(idea('idea-jade', 'Jade', '2026-06-16T10:00:00.000Z'), boardWithNote('Disk note'))
    const browser = store(idea('idea-jade', 'Jade', '2026-06-16T10:00:00.000Z'), boardWithNote('Browser note'))

    const result = mergeBrowserStore(disk, browser, { makeRecoveredId: () => 'idea-recovered' })

    expect(result.summary).toEqual({ imported: 0, replaced: 0, skipped: 0, recoveredConflicts: 1 })
    expect(result.store.ideas.map((item) => item.id)).toEqual(['idea-jade', 'idea-recovered'])
    expect(result.store.ideas.find((item) => item.id === 'idea-recovered')?.name).toBe('Recovered - Jade')
    expect(result.store.boards['idea-jade'].cards[0].blocks[0].text).toBe('Disk note')
    expect(result.store.boards['idea-recovered'].cards[0].blocks[0].text).toBe('Browser note')
  })

  it('does not treat lastOpenedAt alone as content freshness', () => {
    const disk = store(
      idea('idea-jade', 'Jade', '2026-06-16T10:00:00.000Z', '2026-06-16T10:00:00.000Z'),
      boardWithNote('Same note'),
    )
    const browser = store(
      idea('idea-jade', 'Jade', '2026-06-16T10:00:00.000Z', '2026-06-16T11:00:00.000Z'),
      boardWithNote('Same note'),
    )

    const result = mergeBrowserStore(disk, browser)

    expect(result.summary).toEqual({ imported: 0, replaced: 0, skipped: 1, recoveredConflicts: 0 })
    expect(result.store.ideas).toHaveLength(1)
  })
})

function store(idea: IdeaSummary, board: SavedBoard): IdeaStore {
  return {
    version: 1,
    ideas: [idea],
    boards: { [idea.id]: board },
    activeIdeaId: idea.id,
  }
}

function idea(id: string, name: string, updatedAt: string, lastOpenedAt = updatedAt): IdeaSummary {
  return {
    id,
    name,
    createdAt: '2026-06-16T00:00:00.000Z',
    updatedAt,
    lastOpenedAt,
  }
}

function boardWithNote(text: string): SavedBoard {
  return {
    version: 1,
    cards: [{ id: 'note-1', kind: 'note', blocks: [{ id: 'block-1', text }], position: { x: 0, y: 0 } }],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: '2026-06-16T10:00:00.000Z',
  }
}

function boardWithImage(dataUrl: string, updatedAt: string): SavedBoard {
  return {
    version: 1,
    cards: [
      {
        id: 'note-1',
        kind: 'note',
        blocks: [{ id: 'block-1', text: dataUrl ? 'Disk note' : 'Browser note' }],
        assets: [
          {
            id: 'asset-1',
            kind: 'image',
            name: 'image.png',
            mimeType: 'image/png',
            dataUrl,
            size: 123,
            createdAt: '2026-06-16T00:00:00.000Z',
          },
        ],
        position: { x: 0, y: 0 },
      },
    ],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt,
  }
}

function conversationBoard(updatedAt: string, turns: number, messages: number): SavedBoard {
  return {
    version: 1,
    cards: [
      { id: 'conversation-1', kind: 'conversation', blocks: [{ id: 'topic', text: 'Topic' }], position: { x: 0, y: 0 } },
      { id: 'result-1', kind: 'result', blocks: [], position: { x: 0, y: 220 } },
    ],
    connections: [],
    outputs: [
      {
        id: 'out-1',
        resultCardId: 'result-1',
        versions: [
          {
            id: 'ver-1',
            number: 1,
            text: 'Transcript',
            createdAt: '2026-06-16T09:24:01.166Z',
            fromRunId: 'run-1',
            transcript: transcript(messages),
          },
        ],
        chosenVersionId: 'ver-1',
      },
    ],
    runs: [
      {
        id: 'run-1',
        startedAt: '2026-06-16T09:24:01.166Z',
        askAiCardId: 'conversation-1',
        model: 'model',
        usedCardIds: [],
        usedConnectionIds: [],
        modIds: [],
        appliedMods: [],
        compiledInstruction: '',
        status: turns === 35 ? 'done' : 'running',
        producedVersionId: 'ver-1',
        kind: 'conversation',
        conversation: {
          settings: { topic: 'Topic', style: 'collaborate', turnsPerParticipant: 5 },
          participants: [],
          sharedContext: [],
          topLevelMods: [],
          turns: Array.from({ length: turns }, (_, index) => ({
            speakerName: `Speaker ${index + 1}`,
            participantCardId: `ask-${index + 1}`,
            currentTurn: index + 1,
            totalTurns: turns,
            instruction: `Instruction ${index + 1}`,
          })),
        },
      },
    ],
    updatedAt,
  }
}

function transcript(length: number): TranscriptMessage[] {
  return Array.from({ length }, (_, index) => ({
    id: `msg-${index + 1}`,
    speakerKind: 'participant',
    speakerName: `Speaker ${index + 1}`,
    participantCardId: `ask-${index + 1}`,
    text: `Message ${index + 1}`,
    turnNumber: index + 1,
    streaming: false,
  }))
}
