import { describe, expect, it } from 'vitest'
import {
  CARD_FRAME_ARRANGEMENT_LIMITS,
  cardFootprint,
  planCardFrameArrangement,
  planCardLayerOrder,
  planGroupMembership,
} from './cardOrganization'
import type { Card } from './types'

describe('Card organization kernel', () => {
  it('owns the saved and kind-default Card footprints used by graph readers and renderers', () => {
    expect(cardFootprint(card('note', 'note'))).toEqual({ width: 260, height: 180 })
    expect(cardFootprint(card('group', 'group'))).toEqual({ width: 360, height: 360 })
    expect(cardFootprint(card('title', 'title'))).toEqual({ width: 320, height: 82 })
    expect(cardFootprint({
      ...card('sized-group', 'group'),
      size: { width: 640, height: 240 },
    })).toEqual({ width: 640, height: 240 })
  })

  it('plans all frames simultaneously, preserves Board order, and reconciles membership once from final geometry', () => {
    const cards = [
      card('former-member', 'note', { x: 40, y: 40 }, 'group'),
      card('group', 'group', { x: 0, y: 0 }),
      card('new-member', 'note', { x: 450, y: 40 }),
      card('title', 'title', { x: 450, y: 80 }, 'group'),
    ]

    const result = planCardFrameArrangement(cards, [
      { cardId: 'former-member', position: { x: 900, y: 40 } },
      {
        cardId: 'group',
        position: { x: 400, y: 0 },
        size: { width: 360, height: 360 },
      },
    ])

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cards.map(({ id }) => id)).toEqual(cards.map(({ id }) => id))
    expect(result.cards.find(({ id }) => id === 'former-member')).toMatchObject({
      position: { x: 900, y: 40 },
    })
    expect(result.cards.find(({ id }) => id === 'former-member')?.groupId).toBeUndefined()
    expect(result.cards.find(({ id }) => id === 'group')).toMatchObject({
      position: { x: 400, y: 0 },
      size: { width: 360, height: 360 },
    })
    expect(result.cards.find(({ id }) => id === 'group')?.groupId).toBeUndefined()
    expect(result.cards.find(({ id }) => id === 'new-member')?.groupId).toBe('group')
    expect(result.cards.find(({ id }) => id === 'title')?.groupId).toBeUndefined()
  })

  it('chooses the smallest enclosing Group with Board order as the stable geometric tie-break', () => {
    const result = planCardFrameArrangement([
      card('first-group', 'group', { x: 0, y: 0 }),
      card('second-group', 'group', { x: 0, y: 0 }),
      card('larger-group', 'group', { x: -100, y: -100 }, undefined, {
        width: 800,
        height: 800,
      }),
      card('note', 'note', { x: 40, y: 40 }),
    ], [{ cardId: 'note', position: { x: 50, y: 50 } }])

    expect(result).toMatchObject({ ok: true })
    if (result.ok) {
      expect(result.cards.find(({ id }) => id === 'note')?.groupId).toBe('first-group')
    }
  })

  it('fails closed without partial output for unbounded, duplicate, missing, or excessive frame requests', () => {
    const cards = [card('note', 'note')]
    expect(planCardFrameArrangement(cards, [
      { cardId: 'note', position: { x: CARD_FRAME_ARRANGEMENT_LIMITS.maxAbsoluteCoordinate + 1, y: 0 } },
    ])).toEqual({ ok: false, reason: 'invalid' })
    expect(planCardFrameArrangement(cards, [
      { cardId: 'note', position: { x: 0, y: 0 }, size: { width: 0, height: 180 } },
    ])).toEqual({ ok: false, reason: 'invalid' })
    expect(planCardFrameArrangement(cards, [{
      cardId: 'note',
      position: { x: 0, y: 0 },
      size: null,
    } as unknown as Parameters<typeof planCardFrameArrangement>[1][number]])).toEqual({
      ok: false,
      reason: 'invalid',
    })
    expect(planCardFrameArrangement(cards, [
      { cardId: 'note', position: { x: 0, y: 0 } },
      { cardId: 'note', position: { x: 10, y: 10 } },
    ])).toEqual({ ok: false, reason: 'invalid' })
    expect(planCardFrameArrangement(cards, [
      { cardId: 'missing', position: { x: 0, y: 0 } },
    ])).toEqual({ ok: false, reason: 'card-not-found', cardId: 'missing' })
    expect(planCardFrameArrangement(cards, Array.from(
      { length: CARD_FRAME_ARRANGEMENT_LIMITS.maxCards + 1 },
      (_, index) => ({ cardId: `card-${index}`, position: { x: index, y: 0 } }),
    ))).toEqual({ ok: false, reason: 'invalid' })
  })

  it('moves Cards stably within their safe layer class without changing Board order', () => {
    const cards = [
      { ...card('group-a', 'group'), zIndex: 10 },
      { ...card('note-a', 'note'), zIndex: 10 },
      { ...card('group-b', 'group'), zIndex: 20 },
      { ...card('note-b', 'note'), zIndex: 20 },
      { ...card('title', 'title'), zIndex: 0 },
      { ...card('group-c', 'group'), zIndex: 30 },
      { ...card('note-c', 'note'), zIndex: 30 },
    ]

    const next = planCardLayerOrder(
      cards,
      ['note-b', 'group-b', 'note-a', 'group-a'],
      'front',
    )

    expect(next.map(({ id }) => id)).toEqual(cards.map(({ id }) => id))
    expect(layers(next)).toEqual({
      'group-a': 1,
      'note-a': 2,
      'group-b': 2,
      'note-b': 3,
      title: 0,
      'group-c': 0,
      'note-c': 1,
    })

    const ordinaryOnly = planCardLayerOrder(cards, ['note-a'], 'back')
    expect(layers(ordinaryOnly)).toMatchObject({
      'group-a': 10,
      'group-b': 20,
      'group-c': 30,
      'note-a': 0,
      title: 1,
      'note-b': 2,
      'note-c': 3,
    })
  })

  it('keeps stored Group ranks distinct beyond renderer-specific display caps', () => {
    const cards = Array.from({ length: 96 }, (_, index) => ({
      ...card(`group-${index}`, 'group'),
      zIndex: index,
    }))

    const next = planCardLayerOrder(cards, ['group-0'], 'front')

    expect(next.map(({ id }) => id)).toEqual(cards.map(({ id }) => id))
    expect(next.find(({ id }) => id === 'group-0')?.zIndex).toBe(95)
    expect(new Set(next.map(({ zIndex }) => zIndex)).size).toBe(96)
    expect(next.map(({ zIndex }) => zIndex).sort((a, b) => a! - b!)).toEqual(
      Array.from({ length: 96 }, (_, index) => index),
    )
  })

  it('adds explicit membership by reframing the target Group with GUI padding before one geometric reconciliation', () => {
    const cards = [
      card('group', 'group', { x: 500, y: 500 }, undefined, { width: 360, height: 360 }),
      card('member', 'note', { x: 100, y: 100 }, 'group'),
      card('candidate', 'note', { x: 500, y: 300 }, undefined, { width: 300, height: 200 }),
      card('geometric-neighbor', 'note', { x: 400, y: 120 }),
      card('title', 'title', { x: 300, y: 120 }, 'group'),
    ]

    const result = planGroupMembership(cards, 'candidate', 'group')

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.cards.map(({ id }) => id)).toEqual(cards.map(({ id }) => id))
    expect(result.cards.find(({ id }) => id === 'group')).toMatchObject({
      position: { x: 72, y: 54 },
      size: { width: 756, height: 476 },
    })
    expect(result.cards.find(({ id }) => id === 'member')?.groupId).toBe('group')
    expect(result.cards.find(({ id }) => id === 'candidate')?.groupId).toBe('group')
    expect(result.cards.find(({ id }) => id === 'geometric-neighbor')?.groupId).toBe('group')
    expect(result.cards.find(({ id }) => id === 'title')?.groupId).toBeUndefined()
  })

  it('removes explicit membership without moving geometry; a later arrangement may reconcile it back', () => {
    const cards = [
      card('group', 'group', { x: 0, y: 0 }, undefined, { width: 500, height: 400 }),
      card('member', 'note', { x: 80, y: 80 }, 'group', { width: 260, height: 180 }),
    ]

    const removed = planGroupMembership(cards, 'member', null)

    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.cards.find(({ id }) => id === 'member')).toMatchObject({
      position: { x: 80, y: 80 },
      size: { width: 260, height: 180 },
    })
    expect(removed.cards.find(({ id }) => id === 'member')?.groupId).toBeUndefined()
    expect(removed.cards.find(({ id }) => id === 'group')).toEqual(cards[0])

    const reconciled = planCardFrameArrangement(removed.cards, [
      { cardId: 'member', position: { x: 80, y: 80 } },
    ])
    expect(reconciled.ok).toBe(true)
    if (reconciled.ok) {
      expect(reconciled.cards.find(({ id }) => id === 'member')?.groupId).toBe('group')
    }
  })

  it('reports typed invalid member and missing Card or Group membership requests', () => {
    const cards = [
      card('group', 'group'),
      card('not-a-group', 'note'),
      card('member', 'note'),
    ]

    expect(planGroupMembership(cards, '', 'group')).toEqual({ ok: false, reason: 'invalid' })
    expect(planGroupMembership(cards, 'missing', 'group')).toEqual({
      ok: false,
      reason: 'card-not-found',
      cardId: 'missing',
    })
    expect(planGroupMembership(cards, 'group', null)).toEqual({ ok: false, reason: 'invalid' })
    expect(planGroupMembership(cards, 'member', 'missing')).toEqual({
      ok: false,
      reason: 'group-not-found',
      groupId: 'missing',
    })
    expect(planGroupMembership(cards, 'member', 'not-a-group')).toEqual({
      ok: false,
      reason: 'invalid',
    })
  })
})

function layers(cards: readonly Card[]): Readonly<Record<string, number | undefined>> {
  return Object.fromEntries(cards.map(({ id, zIndex }) => [id, zIndex]))
}

function card(
  id: string,
  kind: Card['kind'],
  position: Card['position'] = { x: 0, y: 0 },
  groupId?: string,
  size?: Card['size'],
): Card {
  return {
    id,
    kind,
    blocks: [{ id: `block-${id}`, text: id }],
    position,
    ...(groupId === undefined ? {} : { groupId }),
    ...(size === undefined ? {} : { size }),
  }
}
