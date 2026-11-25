import { describe, expect, it } from 'vitest'
import { findAgentCardPlacement } from './agentCardPlacement'
import type { Card, Connection } from './types'

describe('Agent card placement kernel', () => {
  it('places to the right of one anchor before considering other directions', () => {
    expect(findAgentCardPlacement({
      cards: [card('anchor', 0, 0)],
      connections: [],
      anchorCardIds: ['anchor'],
      kind: 'note',
    })).toEqual({ ok: true, position: { x: 290, y: 0 } })
  })

  it('places beside the whole connected cluster and avoids occupied card bounds', () => {
    const cards = [
      card('anchor', 0, 0),
      card('cluster-peer', 290, 0),
      card('right-blocker', 580, 0),
    ]
    const result = findAgentCardPlacement({
      cards,
      connections: [connection('edge', 'anchor', 'cluster-peer')],
      anchorCardIds: ['anchor'],
      kind: 'note',
    })

    expect(result).toEqual({ ok: true, position: { x: 0, y: 210 } })
    if (result.ok) expect(overlapsAny(result.position, { width: 260, height: 180 }, cards)).toBe(false)
  })

  it('is stable across Card, Connection, and anchor input ordering', () => {
    const cards = [
      card('a', -290, 0),
      card('b', 0, 0),
      card('c', 290, 0),
      card('blocker', 580, 0),
    ]
    const connections = [
      connection('ab', 'a', 'b'),
      connection('bc', 'b', 'c'),
    ]
    const forward = findAgentCardPlacement({
      cards,
      connections,
      anchorCardIds: ['a', 'c'],
      kind: 'conversation',
    })
    const reversed = findAgentCardPlacement({
      cards: [...cards].reverse(),
      connections: [...connections].reverse(),
      anchorCardIds: ['c', 'a'],
      kind: 'conversation',
    })

    expect(reversed).toEqual(forward)
  })

  it('uses the created kind footprint and reports a missing anchor without guessing', () => {
    expect(findAgentCardPlacement({
      cards: [card('anchor', 0, 0)],
      connections: [],
      anchorCardIds: ['anchor'],
      kind: 'title',
    })).toEqual({ ok: true, position: { x: 290, y: 0 } })

    expect(findAgentCardPlacement({
      cards: [card('anchor', 0, 0)],
      connections: [],
      anchorCardIds: ['absent'],
      kind: 'note',
    })).toEqual({ ok: false, reason: 'anchor-not-found', anchorCardId: 'absent' })
  })

  it('fails closed when every bounded candidate would exceed the geometry authority', () => {
    const result = findAgentCardPlacement({
      cards: [card('edge', 0, 0)],
      connections: [],
      anchorCardIds: ['edge'],
      kind: 'group',
      maxAbsoluteCoordinate: 100,
    })

    expect(result).toEqual({ ok: false, reason: 'no-bounded-space' })
  })
})

function card(id: string, x: number, y: number): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `block-${id}`, text: id }],
    position: { x, y },
    size: { width: 260, height: 180 },
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

function overlapsAny(
  position: Readonly<{ x: number; y: number }>,
  size: Readonly<{ width: number; height: number }>,
  cards: readonly Card[],
): boolean {
  return cards.some((candidate) => (
    position.x < candidate.position.x + (candidate.size?.width ?? 260) + 30
    && position.x + size.width + 30 > candidate.position.x
    && position.y < candidate.position.y + (candidate.size?.height ?? 180) + 30
    && position.y + size.height + 30 > candidate.position.y
  ))
}
