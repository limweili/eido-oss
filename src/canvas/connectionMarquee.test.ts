import { describe, expect, it } from 'vitest'
import { connectionCurveIntersectsRect, connectionsTouchingRect } from './connectionMarquee'
import type { Card, Connection } from '../graph/types'

describe('connectionCurveIntersectsRect', () => {
  it('hits a crossing curve with both endpoints outside the rect', () => {
    // A flat left-to-right curve along y=0; the rect straddles its middle.
    expect(
      connectionCurveIntersectsRect({
        sourceX: 0,
        sourceY: 0,
        targetX: 600,
        targetY: 0,
        rect: { x: 280, y: -40, width: 60, height: 80 },
      }),
    ).toBe(true)
  })

  it('misses a nearby rect the curve never enters', () => {
    expect(
      connectionCurveIntersectsRect({
        sourceX: 0,
        sourceY: 0,
        targetX: 600,
        targetY: 0,
        rect: { x: 280, y: 20, width: 60, height: 80 },
      }),
    ).toBe(false)
  })

  it('follows the bezier bulge, not the straight chord', () => {
    // Source and target at different heights: the cubic leaves the source
    // horizontally, so near the source it hugs y=0 while the straight chord
    // has already descended. A rect just below the source catches the chord
    // but not the curve.
    const curve = { sourceX: 0, sourceY: 0, targetX: 400, targetY: 400 }
    expect(connectionCurveIntersectsRect({ ...curve, rect: { x: 40, y: 30, width: 20, height: 20 } })).toBe(false)
    // On the curve's actual path instead: hit.
    expect(connectionCurveIntersectsRect({ ...curve, rect: { x: 190, y: 190, width: 20, height: 20 } })).toBe(true)
  })

  it('hits a backward connection along its S-curve detour', () => {
    // Target behind the source: the curve bulges out to the right of the
    // source before coming back (through ~(11, 12)), while the straight chord
    // to the target never has positive x below y=0. A rect entirely at
    // positive x touches the bulge only if the real curve is walked.
    expect(
      connectionCurveIntersectsRect({
        sourceX: 0,
        sourceY: 0,
        targetX: -300,
        targetY: 200,
        rect: { x: 5, y: 5, width: 20, height: 20 },
      }),
    ).toBe(true)
  })

  it('treats a rect fully containing the curve as touching', () => {
    expect(
      connectionCurveIntersectsRect({
        sourceX: 100,
        sourceY: 100,
        targetX: 200,
        targetY: 100,
        rect: { x: 0, y: 0, width: 400, height: 400 },
      }),
    ).toBe(true)
  })
})

function note(id: string, x: number, y: number): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: id }],
    position: { x, y },
    size: { width: 260, height: 120 },
  } as Card
}

function link(id: string, fromCardId: string, toCardId: string): Connection {
  return {
    id,
    from: { cardId: fromCardId },
    to: { cardId: toCardId },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  } as Connection
}

describe('connectionsTouchingRect', () => {
  // Row 1 at y=0: line from (260, 60) to (600, 60). Row 2 at y=300: line
  // from (260, 360) to (600, 360).
  const cards = [note('a1', 0, 0), note('b1', 600, 0), note('a2', 0, 300), note('b2', 600, 300)]
  const cardById = (cardId: string) => cards.find((card) => card.id === cardId)
  const connections = [link('conn-1', 'a1', 'b1'), link('conn-2', 'a2', 'b2')]

  it('returns every connection the rect crosses, endpoints outside', () => {
    const touched = connectionsTouchingRect({
      connections,
      cardById,
      rect: { x: 400, y: 20, width: 60, height: 400 },
    })
    expect(touched.map((connection) => connection.id)).toEqual(['conn-1', 'conn-2'])
  })

  it('ignores connections the rect never touches', () => {
    const touched = connectionsTouchingRect({
      connections,
      cardById,
      rect: { x: 400, y: 100, width: 60, height: 100 },
    })
    expect(touched).toEqual([])
  })

  it('anchors endpoints on the measured frame when one is provided', () => {
    // Measured height 400 moves row 1's line down to y=200; a rect at the
    // planned-height line (y=60) no longer touches it.
    const measured = (cardId: string) =>
      cardId === 'a1' || cardId === 'b1' ? { width: 260, height: 400 } : undefined
    expect(
      connectionsTouchingRect({
        connections: [connections[0]],
        cardById,
        measuredCardSizeById: measured,
        rect: { x: 400, y: 40, width: 60, height: 40 },
      }),
    ).toEqual([])
    expect(
      connectionsTouchingRect({
        connections: [connections[0]],
        cardById,
        measuredCardSizeById: measured,
        rect: { x: 400, y: 180, width: 60, height: 40 },
      }),
    ).toHaveLength(1)
  })

  it('skips connections whose endpoint card is missing', () => {
    expect(
      connectionsTouchingRect({
        connections: [link('dangling', 'a1', 'gone')],
        cardById,
        rect: { x: 0, y: 0, width: 1000, height: 1000 },
      }),
    ).toEqual([])
  })
})
