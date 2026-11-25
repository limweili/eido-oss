import { describe, expect, it } from 'vitest'
import { createTimelineProjector, projectBoardAt } from './timeline'
import type { Card, Connection, IntentLogEvent, SavedBoard } from './types'

const t1 = '2026-06-19T10:00:00.000Z'
const t2 = '2026-06-19T10:01:00.000Z'
const t3 = '2026-06-19T10:02:00.000Z'
const t4 = '2026-06-19T10:03:00.000Z'

function note(id: string, x = 0, y = 0, groupId?: string): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: id }],
    position: { x, y },
    groupId,
  }
}

function group(id: string): Card {
  return {
    id,
    kind: 'group',
    title: 'Cluster',
    blocks: [{ id: `${id}-block`, text: '' }],
    position: { x: -20, y: -20 },
    size: { width: 320, height: 220 },
  }
}

function connection(id: string, from: string, to: string): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}

function board(cards: Card[], connections: Connection[], intentLog: IntentLogEvent[]): SavedBoard {
  return {
    version: 1,
    cards,
    connections,
    outputs: [],
    runs: [],
    intentLog,
    updatedAt: t4,
  }
}

describe('timeline board projection', () => {
  it('hides cards that were created after the selected time', () => {
    const card = note('note-1')
    const current = board([card], [], [
      { id: 'evt-1', at: t2, type: 'card.created', cardId: card.id, data: { card } },
    ])

    expect(projectBoardAt(current, t1).cards).toHaveLength(0)
    expect(projectBoardAt(current, t2).cards.map((c) => c.id)).toEqual(['note-1'])
  })

  it('projects the position active at the selected time', () => {
    const before = note('note-1', 0, 0)
    const after = note('note-1', 120, 40)
    const current = board([after], [], [
      { id: 'evt-1', at: t1, type: 'card.created', cardId: before.id, data: { card: before } },
      {
        id: 'evt-2',
        at: t3,
        type: 'card.moved',
        cardId: before.id,
        data: {
          moves: [
            {
              cardId: before.id,
              from: before.position,
              to: after.position,
            },
          ],
        },
      },
    ])

    expect(projectBoardAt(current, t2).cards[0].position).toEqual({ x: 0, y: 0 })
    expect(projectBoardAt(current, t3).cards[0].position).toEqual({ x: 120, y: 40 })
  })

  it('projects coalesced arrangements and Card layer changes at their semantic times', () => {
    const created = note('note-1', 0, 0)
    const arranged = { ...created, position: { x: 120, y: 40 }, size: { width: 300, height: 200 } }
    const layered = { ...arranged, zIndex: 2 }
    const current = board([layered], [], [
      { id: 'evt-1', at: t1, type: 'card.created', cardId: created.id, data: { card: created } },
      {
        id: 'evt-2', at: t2, type: 'cards.arranged', cardId: created.id,
        data: {
          changes: [{
            cardId: created.id,
            before: { position: created.position },
            after: { position: arranged.position, size: arranged.size },
          }],
        },
      },
      {
        id: 'evt-3', at: t3, type: 'card.layer.changed', cardId: created.id,
        data: { direction: 'front', changes: [{ cardId: created.id, to: 2 }] },
      },
    ])

    expect(projectBoardAt(current, t1).cards[0]).toMatchObject({
      position: { x: 0, y: 0 },
    })
    expect(projectBoardAt(current, t1).cards[0]).not.toHaveProperty('size')
    expect(projectBoardAt(current, t1).cards[0]).not.toHaveProperty('zIndex')
    expect(projectBoardAt(current, t2).cards[0]).toMatchObject({
      position: { x: 120, y: 40 },
      size: { width: 300, height: 200 },
    })
    expect(projectBoardAt(current, t2).cards[0]).not.toHaveProperty('zIndex')
    expect(projectBoardAt(current, t3).cards[0]).toMatchObject({ zIndex: 2 })
  })

  it('shows active and deleted connections in the right part of history', () => {
    const source = note('note-1')
    const target = note('note-2', 320, 0)
    const conn = connection('conn-1', source.id, target.id)
    const current = board([source, target], [], [
      { id: 'evt-1', at: t1, type: 'card.created', cardId: source.id, data: { card: source } },
      { id: 'evt-2', at: t1, type: 'card.created', cardId: target.id, data: { card: target } },
      { id: 'evt-3', at: t2, type: 'connection.created', connectionId: conn.id, data: { connection: conn } },
      { id: 'evt-4', at: t3, type: 'connection.deleted', connectionId: conn.id, data: { connection: conn } },
    ])

    const active = projectBoardAt(current, t2)
    expect(active.connections.map((c) => c.id)).toEqual(['conn-1'])
    expect(active.ghostConnectionIds.has('conn-1')).toBe(false)

    const deleted = projectBoardAt(current, t3)
    expect(deleted.connections.map((c) => c.id)).toEqual(['conn-1'])
    expect(deleted.ghostConnectionIds.has('conn-1')).toBe(true)
  })

  it('keeps deleted cards as ghostable history after removal', () => {
    const card = note('note-1')
    const current = board([], [], [
      { id: 'evt-1', at: t1, type: 'card.created', cardId: card.id, data: { card } },
      { id: 'evt-2', at: t2, type: 'card.deleted', cardId: card.id, data: { card, connections: [] } },
    ])

    const beforeDelete = projectBoardAt(current, t1)
    expect(beforeDelete.cards.map((c) => c.id)).toEqual(['note-1'])
    expect(beforeDelete.ghostCardIds.has('note-1')).toBe(false)

    const afterDelete = projectBoardAt(current, t2)
    expect(afterDelete.cards.map((c) => c.id)).toEqual(['note-1'])
    expect(afterDelete.ghostCardIds.has('note-1')).toBe(true)
  })

  it('projects group creation and member state', () => {
    const a = note('note-a')
    const b = note('note-b', 160, 0)
    const groupedA = { ...a, groupId: 'group-1' }
    const groupedB = { ...b, groupId: 'group-1' }
    const groupCard = group('group-1')
    const current = board([groupCard, groupedA, groupedB], [], [
      { id: 'evt-1', at: t1, type: 'card.created', cardId: a.id, data: { card: a } },
      { id: 'evt-2', at: t1, type: 'card.created', cardId: b.id, data: { card: b } },
      {
        id: 'evt-3',
        at: t2,
        type: 'group.created',
        cardId: groupCard.id,
        data: {
          card: groupCard,
          memberChanges: {
            [a.id]: { from: undefined, to: groupCard.id },
            [b.id]: { from: undefined, to: groupCard.id },
          },
        },
      },
    ])

    const before = projectBoardAt(current, t1)
    expect(before.cards.some((c) => c.id === 'group-1')).toBe(false)
    expect(before.cards.find((c) => c.id === 'note-a')?.groupId).toBeUndefined()

    const after = projectBoardAt(current, t2)
    expect(after.cards.some((c) => c.id === 'group-1')).toBe(true)
    expect(after.cards.find((c) => c.id === 'note-a')?.groupId).toBe('group-1')
  })

  it('reuses sorted events through a projector interface', () => {
    const before = note('note-1', 0, 0)
    const after = note('note-1', 120, 40)
    const current = board([after], [], [
      { id: 'evt-1', at: t1, type: 'card.created', cardId: before.id, data: { card: before } },
      {
        id: 'evt-2',
        at: t3,
        type: 'card.moved',
        cardId: before.id,
        data: {
          moves: [
            {
              cardId: before.id,
              from: before.position,
              to: after.position,
            },
          ],
        },
      },
    ])

    const projector = createTimelineProjector(current)

    expect(projector.range).toEqual({
      startAt: t1,
      endAt: t3,
      startMs: Date.parse(t1),
      endMs: Date.parse(t3),
    })
    expect(projector.projectAt(t2)).toEqual(projectBoardAt(current, t2))
  })

  it('can project through one equally spaced event even when later events share its timestamp', () => {
    const before = note('note-1', 0, 0)
    const after = note('note-1', 120, 40)
    const current = board([after], [], [
      { id: 'evt-1', at: t1, type: 'card.created', cardId: before.id, data: { card: before } },
      {
        id: 'evt-2',
        at: t1,
        type: 'card.moved',
        cardId: before.id,
        data: { moves: [{ cardId: before.id, from: before.position, to: after.position }] },
      },
    ])

    const projector = createTimelineProjector(current)

    expect(projector.projectThrough(1).cards[0].position).toEqual(before.position)
    expect(projector.projectThrough(2).cards[0].position).toEqual(after.position)
  })

  it('replays created cards with their current words, not the empty creation snapshot', () => {
    const snapshot = { ...note('note-1'), blocks: [{ id: 'note-1-block', text: '' }] }
    const live = { ...note('note-1'), blocks: [{ id: 'note-1-block', text: 'typed later' }], title: 'Named later' }
    const current = board([live], [], [
      { id: 'evt-1', at: t2, type: 'card.created', cardId: snapshot.id, data: { card: snapshot } },
    ])

    const projected = projectBoardAt(current, t2).cards[0]
    expect(projected.blocks[0].text).toBe('typed later')
    expect(projected.title).toBe('Named later')
    expect(createTimelineProjector(current).projectAt(t2).cards[0].blocks[0].text).toBe('typed later')
  })

  it('replays a created Card with its current model and identity once it exists', () => {
    const snapshot: Card = {
      ...note('ask-1'),
      kind: 'askAi',
      model: 'old/model',
      headerColor: '#111111',
      headerFill: 'half',
    }
    const live: Card = {
      ...snapshot,
      model: 'new/model',
      headerColor: '#222222',
      headerFill: 'full',
    }
    const current = board([live], [], [
      { id: 'evt-1', at: t2, type: 'card.created', cardId: snapshot.id, data: { card: snapshot } },
      {
        id: 'evt-2', at: t3, type: 'card.content.edited', cardId: snapshot.id,
        data: { field: 'model' },
      },
      {
        id: 'evt-3', at: t3, type: 'card.content.edited', cardId: snapshot.id,
        data: { field: 'identity' },
      },
    ])

    expect(projectBoardAt(current, t1).cards).toHaveLength(0)
    expect(projectBoardAt(current, t2).cards[0]).toMatchObject({
      model: 'new/model',
      headerColor: '#222222',
      headerFill: 'full',
    })
    expect(createTimelineProjector(current).projectAt(t4).cards[0]).toMatchObject({
      model: 'new/model',
      headerColor: '#222222',
      headerFill: 'full',
    })
  })

  it('keeps the deletion snapshot words for cards that are gone from the board', () => {
    const deleted = { ...note('note-1'), blocks: [{ id: 'note-1-block', text: 'final words' }] }
    const current = board([], [], [
      { id: 'evt-1', at: t1, type: 'card.created', cardId: deleted.id, data: { card: deleted } },
      { id: 'evt-2', at: t3, type: 'card.deleted', cardId: deleted.id, data: { card: deleted, connections: [] } },
    ])

    expect(projectBoardAt(current, t2).cards[0].blocks[0].text).toBe('final words')
    expect(projectBoardAt(current, t3).cards[0].blocks[0].text).toBe('final words')
  })

  it('shows the output version that existed at the selected time on result cards', () => {
    const result = { ...note('result-1'), kind: 'result' as const, blocks: [{ id: 'result-1-block', text: '' }] }
    const current = {
      ...board([result], [], [
        { id: 'evt-1', at: t1, type: 'card.created', cardId: result.id, data: { card: result } },
      ]),
      outputs: [
        {
          id: 'out-1',
          resultCardId: result.id,
          versions: [
            { id: 'ver-1', number: 1, text: 'first answer', createdAt: t2, fromRunId: 'run-1' },
            { id: 'ver-2', number: 2, text: 'second answer', createdAt: t4, fromRunId: 'run-2' },
          ],
          chosenVersionId: 'ver-1',
        },
      ],
    }
    const projector = createTimelineProjector(current)

    // before any version exists, the card stays empty
    expect(projector.projectAt(t1).cards[0].blocks[0].text).toBe('')
    // between versions, the newest existing one shows
    expect(projector.projectAt(t3).cards[0].blocks[0].text).toBe('first answer')
    // once every version exists, playback shows what the live board shows: the chosen one
    expect(projector.projectAt(t4).cards[0].blocks[0].text).toBe('first answer')
    expect(projectBoardAt(current, t3).cards[0].blocks[0].text).toBe('first answer')
  })

  it('does not apply a future explicit version choice to earlier playback', () => {
    const result = { ...note('result-1'), kind: 'result' as const, blocks: [{ id: 'result-1-block', text: '' }] }
    const current = {
      ...board([result], [], [
        { id: 'evt-1', at: t1, type: 'card.created', cardId: result.id, data: { card: result } },
        {
          id: 'evt-2',
          at: t4,
          type: 'version.chosen',
          versionId: 'ver-1',
          data: { outputId: 'out-1', previousVersionId: 'ver-2', nextVersionId: 'ver-1' },
        },
      ]),
      outputs: [
        {
          id: 'out-1',
          resultCardId: result.id,
          versions: [
            { id: 'ver-1', number: 1, text: 'first answer', createdAt: t2, fromRunId: 'run-1' },
            { id: 'ver-2', number: 2, text: 'second answer', createdAt: t3, fromRunId: 'run-2' },
          ],
          chosenVersionId: 'ver-1',
        },
      ],
    }
    const projector = createTimelineProjector(current)

    expect(projector.projectAt(t3).cards[0].blocks[0].text).toBe('second answer')
    expect(projector.projectAt(t4).cards[0].blocks[0].text).toBe('first answer')
  })

  it('keeps equal-timestamp version choices in event order during playback', () => {
    const result = { ...note('result-1'), kind: 'result' as const, blocks: [{ id: 'result-1-block', text: '' }] }
    const current = {
      ...board([result], [], [
        { id: 'evt-1', at: t1, type: 'card.created', cardId: result.id, data: { card: result } },
        {
          id: 'evt-2', at: t3, type: 'version.chosen', versionId: 'ver-2',
          data: { outputId: 'out-1', previousVersionId: 'ver-1', nextVersionId: 'ver-2' },
        },
        {
          id: 'evt-3', at: t3, type: 'version.chosen', versionId: 'ver-1',
          data: { outputId: 'out-1', previousVersionId: 'ver-2', nextVersionId: 'ver-1' },
        },
      ]),
      outputs: [{
        id: 'out-1',
        resultCardId: result.id,
        versions: [
          { id: 'ver-1', number: 1, text: 'first answer', createdAt: t2, fromRunId: 'run-1' },
          { id: 'ver-2', number: 2, text: 'second answer', createdAt: t2, fromRunId: 'run-2' },
        ],
        chosenVersionId: 'ver-1',
      }],
    }
    const projector = createTimelineProjector(current)

    expect(projector.projectThrough(2).cards[0].blocks[0].text).toBe('second answer')
    expect(projector.projectThrough(3).cards[0].blocks[0].text).toBe('first answer')
  })

  it('replays deleted result cards with their deletion output snapshot', () => {
    const result = { ...note('result-1'), kind: 'result' as const, blocks: [{ id: 'result-1-block', text: '' }] }
    const output = {
      id: 'out-1',
      resultCardId: result.id,
      versions: [
        { id: 'ver-1', number: 1, text: 'answer before delete', createdAt: t2, fromRunId: 'run-1' },
      ],
      chosenVersionId: 'ver-1',
    }
    const current = board([], [], [
      { id: 'evt-1', at: t1, type: 'card.created', cardId: result.id, data: { card: result } },
      {
        id: 'evt-2',
        at: t3,
        type: 'card.deleted',
        cardId: result.id,
        data: { card: result, connections: [], outputs: [output] },
      },
    ])
    const projector = createTimelineProjector(current)

    expect(projector.projectAt(t2).cards[0].blocks[0].text).toBe('answer before delete')
    expect(projector.projectAt(t3).cards[0].blocks[0].text).toBe('answer before delete')
  })

})
