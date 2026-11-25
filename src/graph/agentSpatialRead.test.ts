import { describe, expect, it } from 'vitest'
import {
  agentCardSetBounds,
  readAgentCardNeighbors,
} from './agentSpatialRead'
import type { Card, Connection } from './types'

describe('bounded Agent spatial reads', () => {
  it('lists incident neighbors deterministically with direction and meaning', () => {
    const cards = [
      card('target', 'note', 0, 0),
      card('upstream', 'title', -350, 20),
      card('downstream', 'conversation', 350, 20),
    ]
    const connections = [
      connection('z-out', 'target', 'downstream'),
      { ...connection('a-in', 'upstream', 'target'), polarity: 'pushesAgainst' as const },
    ]

    expect(readAgentCardNeighbors({ cards, connections }, {
      cardId: 'target',
      limit: 10,
      byteLimit: 16_384,
    })).toEqual({
      ok: true,
      items: [{
        cardId: 'upstream',
        kind: 'title',
        position: { x: -350, y: 20 },
        size: { width: 320, height: 82 },
        connection: {
          id: 'a-in',
          direction: 'incoming',
          strength: 'strong',
          polarity: 'pushesAgainst',
          role: 'feeds',
        },
      }, {
        cardId: 'downstream',
        kind: 'conversation',
        position: { x: 350, y: 20 },
        size: { width: 260, height: 180 },
        connection: {
          id: 'z-out',
          direction: 'outgoing',
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      }],
      truncated: false,
    })
  })

  it('caps neighbor output by item and encoded-byte bounds', () => {
    const cards = [card('target', 'note', 0, 0)]
    const connections: Connection[] = []
    for (let index = 0; index < 20; index += 1) {
      const id = `neighbor-${index.toString().padStart(2, '0')}`
      cards.push(card(id, 'note', 300 * (index + 1), 0))
      connections.push(connection(`edge-${index.toString().padStart(2, '0')}`, 'target', id))
    }

    const itemCapped = readAgentCardNeighbors({ cards, connections }, {
      cardId: 'target',
      limit: 3,
      byteLimit: 16_384,
    })
    expect(itemCapped).toMatchObject({ ok: true, truncated: true })
    if (itemCapped.ok) expect(itemCapped.items).toHaveLength(3)

    const byteCapped = readAgentCardNeighbors({ cards, connections }, {
      cardId: 'target',
      limit: 20,
      byteLimit: 512,
    })
    expect(byteCapped).toMatchObject({ ok: true, truncated: true })
    if (byteCapped.ok) {
      expect(new TextEncoder().encode(JSON.stringify(byteCapped.items)).byteLength).toBeLessThanOrEqual(512)
    }
  })

  it('computes a set bounding box with canonical Card footprints', () => {
    expect(agentCardSetBounds([
      card('group', 'group', -100, -50),
      card('title', 'title', 400, 300),
      card('ignored', 'note', 2_000, 2_000),
    ], ['title', 'group'])).toEqual({
      ok: true,
      cardIds: ['group', 'title'],
      cards: [{
        cardId: 'group',
        kind: 'group',
        position: { x: -100, y: -50 },
        size: { width: 360, height: 360 },
      }, {
        cardId: 'title',
        kind: 'title',
        position: { x: 400, y: 300 },
        size: { width: 320, height: 82 },
      }],
      bounds: { x: -100, y: -50, width: 820, height: 432 },
    })
  })

  it('fails closed for absent Cards, empty sets, and excessive sets', () => {
    const cards = [card('one', 'note', 0, 0)]
    expect(readAgentCardNeighbors({ cards, connections: [] }, {
      cardId: 'missing',
    })).toEqual({ ok: false, reason: 'card-not-found', cardId: 'missing' })
    expect(agentCardSetBounds(cards, [])).toEqual({ ok: false, reason: 'invalid' })
    expect(agentCardSetBounds(
      cards,
      Array.from({ length: 101 }, (_, index) => `card-${index}`),
    )).toEqual({ ok: false, reason: 'invalid' })
  })
})

function card(
  id: string,
  kind: Card['kind'],
  x: number,
  y: number,
): Card {
  return {
    id,
    kind,
    blocks: [{ id: `block-${id}`, text: id }],
    position: { x, y },
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
