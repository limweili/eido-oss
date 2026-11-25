import { describe, expect, it } from 'vitest'
import { planChainRun } from '../brain/executionPlan'
import { findResultCardPosition } from './resultCardPlacement'
import { ensureResultCardFor, repairAskToAskConnections } from './resultRouting'
import type { Card, Connection, SavedBoard } from './types'

function card(id: string, kind: Card['kind']): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text: '' }],
    position: { x: 0, y: 0 },
  }
}

function conn(id: string, from: string, to: string, extra: Partial<Connection> = {}): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    ...extra,
  }
}

function board(cards: Card[], connections: Connection[]): SavedBoard {
  return {
    version: 1,
    cards,
    connections,
    outputs: [],
    runs: [],
    updatedAt: '2026-01-01T00:00:00.000Z',
  }
}

describe('repairAskToAskConnections', () => {
  it('reroutes a legacy question-to-question connection through an inserted Result card', () => {
    const saved = board(
      [card('ask-1', 'askAi'), card('ask-2', 'askAi')],
      [conn('c1', 'ask-1', 'ask-2', { strength: 'weak', polarity: 'pushesAgainst' })],
    )

    const repaired = repairAskToAskConnections(saved)

    const result = repaired.cards.find((c) => c.kind === 'result')
    expect(result).toBeTruthy()
    expect(
      repaired.connections.some((c) => c.from.cardId === 'ask-1' && c.to.cardId === result!.id),
    ).toBe(true)
    const routed = repaired.connections.find(
      (c) => c.from.cardId === result!.id && c.to.cardId === 'ask-2',
    )
    expect(routed).toBeTruthy()
    expect(routed!.strength).toBe('weak')
    expect(routed!.polarity).toBe('pushesAgainst')
    expect(
      repaired.connections.some((c) => c.from.cardId === 'ask-1' && c.to.cardId === 'ask-2'),
    ).toBe(false)
  })

  it('leaves a board without question-to-question connections untouched', () => {
    const saved = board(
      [card('ask-1', 'askAi'), card('result-1', 'result'), card('ask-2', 'askAi')],
      [conn('c1', 'ask-1', 'result-1'), conn('c2', 'result-1', 'ask-2')],
    )

    expect(repairAskToAskConnections(saved)).toBe(saved)
  })

  it('is idempotent', () => {
    const saved = board(
      [card('ask-1', 'askAi'), card('ask-2', 'askAi')],
      [conn('c1', 'ask-1', 'ask-2')],
    )

    const once = repairAskToAskConnections(saved)
    const twice = repairAskToAskConnections(once)

    expect(twice).toBe(once)
  })

  it('reuses an existing Result card and drops the legacy connection without duplicates', () => {
    const saved = board(
      [card('ask-1', 'askAi'), card('result-1', 'result'), card('ask-2', 'askAi')],
      [
        conn('c1', 'ask-1', 'result-1'),
        conn('c2', 'result-1', 'ask-2'),
        conn('c3', 'ask-1', 'ask-2'),
      ],
    )

    const repaired = repairAskToAskConnections(saved)

    expect(repaired.cards.filter((c) => c.kind === 'result')).toHaveLength(1)
    expect(
      repaired.connections.filter((c) => c.from.cardId === 'result-1' && c.to.cardId === 'ask-2'),
    ).toHaveLength(1)
    expect(
      repaired.connections.some((c) => c.from.cardId === 'ask-1' && c.to.cardId === 'ask-2'),
    ).toBe(false)
  })

  it('turns a legacy three-question board into a full chain plan', () => {
    const saved = board(
      [card('ask-1', 'askAi'), card('ask-2', 'askAi'), card('ask-3', 'askAi')],
      [conn('c1', 'ask-1', 'ask-2'), conn('c2', 'ask-2', 'ask-3')],
    )

    const plan = planChainRun(repairAskToAskConnections(saved), 'ask-3')

    expect(plan.steps.map((step) => step.cardId)).toEqual(['ask-1', 'ask-2', 'ask-3'])
  })
})

describe('ensureResultCardFor placement', () => {
  it('keeps the default Result to the right even when that position starts off-screen', () => {
    const ask = { ...card('ask-1', 'askAi'), position: { x: 500, y: 500 } }

    const position = findResultCardPosition([ask], ask, {
      viewport: { x: 0, y: 0, width: 900, height: 700 },
    })

    expect(position).toEqual({ x: 850, y: 500 })
  })

  it('prefers the right side of its producing Ask when that space is empty', () => {
    const ask = { ...card('ask-1', 'askAi'), position: { x: 100, y: 200 } }

    const ensured = ensureResultCardFor([ask], [], ask.id)

    expect(ensured.resultCard.position).toEqual({ x: 450, y: 200 })
  })

  it('tries below after the preferred right-side position is occupied', () => {
    const ask = { ...card('ask-1', 'askAi'), position: { x: 0, y: 0 } }
    const right = { ...card('occupied', 'note'), position: { x: 350, y: 0 } }

    const ensured = ensureResultCardFor([ask, right], [], ask.id)

    expect(ensured.resultCard.position).toEqual({ x: 0, y: 210 })
  })

  it('uses above only after right, below, and left are blocked', () => {
    const ask = { ...card('ask-1', 'askAi'), position: { x: 0, y: 0 } }
    const cards = [
      ask,
      { ...card('right', 'note'), position: { x: 350, y: 0 } },
      { ...card('below', 'note'), position: { x: 0, y: 210 } },
      { ...card('left', 'note'), position: { x: -290, y: 0 } },
    ]

    expect(ensureResultCardFor(cards, [], ask.id).resultCard.position).toEqual({ x: 0, y: -210 })
  })

  it('keeps result placement deterministic for the same local neighbours', () => {
    const ask = { ...card('ask-1', 'askAi'), position: { x: 0, y: 0 } }
    const right = { ...card('occupied', 'note'), position: { x: 350, y: 0 } }
    const cards = [ask, right]

    expect(ensureResultCardFor(cards, [], ask.id).resultCard.position).toEqual(
      ensureResultCardFor(cards, [], ask.id).resultCard.position,
    )
  })
})
