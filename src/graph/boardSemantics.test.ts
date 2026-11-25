import { describe, expect, it, vi } from 'vitest'
import { createSeedMod, snapshotModValues } from '../mods'
import type { Card, Output, RunRecord } from './types'
import {
  copyBoardSelection,
  searchBoardContent,
  serializeBoardSelection,
  type SemanticBoard,
} from './boardSemantics'

const LONG_OFFSCREEN_MARKER = 'offscreen-complete-content-' + 'kept '.repeat(80).trim()

function card(id: string, title: string, text: string, x: number): Card {
  return {
    id,
    kind: 'note',
    title,
    blocks: [{ id: `${id}-body`, text }],
    position: { x, y: 0 },
  }
}

const resultCard: Card = {
  id: 'result',
  kind: 'result',
  title: 'Research result',
  blocks: [],
  position: { x: 120_000, y: 0 },
}

const output: Output = {
  id: 'output',
  resultCardId: resultCard.id,
  chosenVersionId: 'v2',
  versions: [
    {
      id: 'v1',
      number: 1,
      text: 'Earlier saved version marker',
      createdAt: '2026-07-19T00:00:00.000Z',
      fromRunId: 'run-1',
    },
    {
      id: 'v2',
      number: 2,
      text: 'Chosen saved version marker',
      createdAt: '2026-07-19T00:01:00.000Z',
      fromRunId: 'run-2',
      transcript: [{ id: 'transcript', speakerKind: 'participant', speakerName: 'Mira', text: 'Transcript-only marker' }],
      followUpThread: {
        messages: [{
          id: 'follow-up',
          role: 'user',
          text: 'Follow-up-only marker',
          createdAt: '2026-07-19T00:02:00.000Z',
          status: 'complete',
        }],
      },
    },
  ],
}

const board: SemanticBoard = {
  cards: [
    card('visible', 'Visible note', 'Visible short text', 0),
    card('offscreen', 'Offscreen note', LONG_OFFSCREEN_MARKER, 90_000),
    resultCard,
  ],
  connections: [
    {
      id: 'connection',
      from: { cardId: 'visible' },
      to: { cardId: 'offscreen' },
      strength: 'strong',
      polarity: 'pushesAgainst',
      role: 'feeds',
      reason: 'Connection-only marker',
    },
  ],
  outputs: [output],
  runs: [
    {
      id: 'run-1',
      startedAt: '2026-07-19T00:00:00.000Z',
      finishedAt: '2026-07-19T00:00:30.000Z',
      askAiCardId: 'visible',
      model: 'test-model',
      usedCardIds: ['offscreen'],
      usedConnectionIds: ['connection'],
      modIds: [],
      appliedMods: [],
      compiledInstruction: 'Run-provenance-only marker',
      status: 'done',
    },
  ],
}

describe('Board semantic content', () => {
  it('searches saved-order graph content, including unmounted long Cards and every saved result version', () => {
    expect(searchBoardContent(board, 'offscreen-complete-content').map((result) => result.cardId)).toEqual([
      'offscreen',
    ])
    expect(searchBoardContent(board, 'Earlier saved version marker').map((result) => result.cardId)).toEqual([
      'result',
    ])
    expect(searchBoardContent(board, 'Transcript-only marker')[0]?.cardId).toBe('result')
    expect(searchBoardContent(board, 'Transcript-only marker')[0]?.excerpt).toBe('Transcript-only marker')
    expect(searchBoardContent(board, 'Run-provenance-only marker')[0]?.cardId).toBe('visible')
    expect(searchBoardContent(board, 'Connection-only marker').map((result) => result.cardId)).toEqual([
      'visible',
      'offscreen',
    ])
  })

  it('filters by durable creator while treating legacy Cards as user work', () => {
    const agent = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const user = { kind: 'user', client: 'eido-desktop', sessionId: 'user-session' } as const
    const agentCard = { ...card('agent', 'AI note', 'shared phrase', 0), createdBy: agent, lastModifiedBy: agent }
    const adoptedAgentCard = {
      ...card('adopted-agent', 'Adopted AI note', 'shared phrase', 300),
      createdBy: agent,
      lastModifiedBy: user,
    }
    const userCard = { ...card('user', 'User note', 'shared phrase', 600), createdBy: user, lastModifiedBy: user }
    const legacyCard = card('legacy', 'Legacy note', 'shared phrase', 900)
    const creatorBoard: SemanticBoard = {
      cards: [agentCard, adoptedAgentCard, userCard, legacyCard],
      connections: [],
      outputs: [],
      runs: [],
    }

    expect(searchBoardContent(creatorBoard, 'shared phrase', 'agent').map(result => result.cardId))
      .toEqual(['agent', 'adopted-agent'])
    expect(searchBoardContent(creatorBoard, 'shared phrase', 'user').map(result => result.cardId))
      .toEqual(['user', 'legacy'])
  })

  it('presents the chosen Result text and its visible follow-up thread as the body', () => {
    const plainResultOutput: Output = {
      id: 'plain-output',
      resultCardId: resultCard.id,
      chosenVersionId: 'plain-version',
      versions: [{
        id: 'plain-version',
        number: 1,
        text: 'Plain chosen answer',
        createdAt: '2026-07-19T00:00:00.000Z',
        fromRunId: 'plain-run',
        followUpThread: {
          messages: [{
            id: 'plain-follow-up',
            role: 'assistant',
            text: 'Plain follow-up answer',
            createdAt: '2026-07-19T00:01:00.000Z',
            status: 'complete',
          }],
        },
      }],
    }
    const result = searchBoardContent({
      cards: [resultCard],
      connections: [],
      outputs: [plainResultOutput],
      runs: [],
    }, 'Plain follow-up answer')[0]

    expect(result?.excerpt).toContain('Plain chosen answer')
    expect(result?.excerpt).toContain('Plain follow-up answer')
  })

  it('keeps visible website preview metadata searchable and copyable with its source URL', () => {
    const linkCard: Card = {
      ...card('link', '', 'https://drybread.studio/', 0),
      linkPreview: {
        url: 'https://drybread.studio/',
        status: 'ready',
        title: 'Drybread Studios',
        description: 'Products, tools, games and experiments.',
        siteName: 'drybread.studio',
      },
    }
    const linkBoard: SemanticBoard = {
      cards: [linkCard],
      connections: [],
      outputs: [],
      runs: [],
    }

    expect(searchBoardContent(linkBoard, 'games and experiments')[0]).toMatchObject({
      cardId: 'link',
      excerpt: 'https://drybread.studio/',
    })
    expect(serializeBoardSelection(linkBoard, ['link'])).toContain(
      '### Website preview\nDrybread Studios\nProducts, tools, games and experiments.\ndrybread.studio',
    )
    expect(serializeBoardSelection(linkBoard, ['link'])).toContain('https://drybread.studio/')
  })

  it('serializes the complete selected graph content and routes that exact text to the clipboard writer', async () => {
    const selectedIds = board.cards.map((entry) => entry.id)
    const serialized = serializeBoardSelection(board, selectedIds)

    expect(serialized).toContain(LONG_OFFSCREEN_MARKER)
    expect(serialized).toContain('Earlier saved version marker')
    expect(serialized).toContain('Chosen saved version marker')
    expect(serialized).toContain('Transcript-only marker')
    expect(serialized).toContain('Follow-up-only marker')
    expect(serialized).toContain('Connection-only marker')
    expect(serialized).toContain('Run-provenance-only marker')

    const writeText = vi.fn(async () => true)
    await expect(copyBoardSelection({ board, cardIds: selectedIds, writeText })).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledOnce()
    expect(writeText).toHaveBeenCalledWith(serialized)
  })

  it('searches and summarizes v2 Mod guidance from durable Run provenance', () => {
    const mod = createSeedMod('switch', { createId: (_, ordinal) => `switch-${ordinal}` })
    const run: RunRecord = {
      id: 'run-v2-mod',
      startedAt: '2026-07-19T00:00:00.000Z',
      finishedAt: '2026-07-19T00:00:30.000Z',
      askAiCardId: 'visible',
      model: 'test-model',
      usedCardIds: ['mod-v2'],
      usedConnectionIds: ['connection-v2'],
      modIds: ['mod-v2'],
      appliedMods: [{
        modVersion: 2,
        modCardId: 'mod-v2',
        controlValues: snapshotModValues(mod),
        appliedInstructions: [
          'Only statements switched on apply. Off means left out on purpose, do not infer it.',
          'jargon is off, says nothing.',
        ],
      }],
      compiledInstruction: '',
      status: 'done',
    }
    const provenanceBoard: SemanticBoard = { ...board, runs: [run] }

    expect(searchBoardContent(provenanceBoard, 'jargon is off')[0]?.cardId).toBe('visible')
    expect(serializeBoardSelection(provenanceBoard, ['visible'])).toContain(
      'Guidance applied:\nOnly statements switched on apply. Off means left out on purpose, do not infer it.\njargon is off, says nothing.',
    )
  })
})
