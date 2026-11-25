import { describe, expect, it } from 'vitest'
import { CONNECTED_THOUGHT_POLICY, deepThoughtPolicy, gatherContext } from './contextQuery'
import type { Card, Connection, SavedBoard } from './types'

function card(id: string, kind: Card['kind'], text = ''): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text }],
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
    updatedAt: '',
  }
}

describe('gatherContext', () => {
  it('selects first-hop sources with relations from strength, polarity, and role', () => {
    const saved = board(
      [
        card('ask', 'askAi', 'task'),
        card('strong-note', 'note', 'strong'),
        card('weak-note', 'note', 'weak'),
        card('against', 'note', 'constraint'),
        card('mod-1', 'mod'),
      ],
      [
        conn('c1', 'strong-note', 'ask'),
        conn('c2', 'weak-note', 'ask', { strength: 'weak' }),
        conn('c3', 'against', 'ask', { polarity: 'pushesAgainst' }),
        conn('c4', 'mod-1', 'ask', { role: 'modifies' }),
      ],
    )

    const selection = gatherContext(saved, 'ask')

    expect(selection.rootCardId).toBe('ask')
    expect(selection.policy).toEqual({ name: 'connected-thought', version: 1 })
    expect(selection.entries).toEqual([
      { cardId: 'strong-note', connectionId: 'c1', relation: 'feeds-strong', hop: 1, groupMode: undefined },
      { cardId: 'weak-note', connectionId: 'c2', relation: 'feeds-weak', hop: 1, groupMode: undefined },
      { cardId: 'against', connectionId: 'c3', relation: 'constrains', hop: 1, groupMode: undefined },
      { cardId: 'mod-1', connectionId: 'c4', relation: 'modifies', hop: 1 },
    ])
    expect(selection.usedCardIds).toEqual(['strong-note', 'weak-note', 'against', 'mod-1'])
    expect(selection.usedConnectionIds).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('is deterministic: same graph, same policy, same selection', () => {
    const saved = board(
      [card('ask', 'askAi'), card('a', 'note', 'a'), card('b', 'note', 'b')],
      [conn('c1', 'a', 'ask'), conn('c2', 'b', 'ask')],
    )
    expect(gatherContext(saved, 'ask')).toEqual(gatherContext(saved, 'ask'))
  })

  it('respects user context order over connection array order', () => {
    const saved = board(
      [card('ask', 'askAi'), card('a', 'note', 'a'), card('b', 'note', 'b')],
      [
        conn('c1', 'a', 'ask', { meta: { contextOrder: 2 } }),
        conn('c2', 'b', 'ask', { meta: { contextOrder: 1 } }),
      ],
    )
    expect(gatherContext(saved, 'ask').entries.map((e) => e.cardId)).toEqual(['b', 'a'])
  })

  it('follows a strong-helps second hop and marks it feeds-weak', () => {
    const saved = board(
      [card('ask', 'askAi'), card('mid', 'note', 'mid'), card('up-strong', 'note', 'up'), card('up-weak', 'note', 'up-w')],
      [
        conn('c1', 'mid', 'ask'),
        conn('c2', 'up-strong', 'mid'),
        conn('c3', 'up-weak', 'mid', { strength: 'weak' }),
      ],
    )

    const selection = gatherContext(saved, 'ask')

    expect(selection.entries).toContainEqual({
      cardId: 'up-strong',
      connectionId: 'c2',
      relation: 'feeds-weak',
      hop: 2,
    })
    expect(selection.entries.map((e) => e.cardId)).not.toContain('up-weak')
  })

  it('follows weak second hops when the policy says so', () => {
    const saved = board(
      [card('ask', 'askAi'), card('mid', 'note', 'mid'), card('up-weak', 'note', 'up-w')],
      [conn('c1', 'mid', 'ask'), conn('c2', 'up-weak', 'mid', { strength: 'weak' })],
    )

    const selection = gatherContext(saved, 'ask', {
      ...CONNECTED_THOUGHT_POLICY,
      name: 'connected-thought-wide',
      secondHopWeakToo: true,
    })

    expect(selection.policy.name).toBe('connected-thought-wide')
    expect(selection.entries.map((e) => e.cardId)).toContain('up-weak')
  })

  it('does not hop beyond results, groups, constraints, or when the policy disables it', () => {
    const saved = board(
      [
        card('ask', 'askAi'),
        card('result-1', 'result'),
        card('behind-result', 'note', 'hidden'),
        card('against', 'note', 'constraint'),
        card('behind-against', 'note', 'hidden-2'),
      ],
      [
        conn('c1', 'result-1', 'ask'),
        conn('c2', 'behind-result', 'result-1'),
        conn('c3', 'against', 'ask', { polarity: 'pushesAgainst' }),
        conn('c4', 'behind-against', 'against'),
      ],
    )

    const ids = gatherContext(saved, 'ask').entries.map((e) => e.cardId)
    expect(ids).not.toContain('behind-result')
    expect(ids).not.toContain('behind-against')

    const noHop = gatherContext(saved, 'ask', { ...CONNECTED_THOUGHT_POLICY, secondHop: false })
    expect(noHop.entries.every((e) => e.hop === 1)).toBe(true)
  })

  it('skips title cards and missing sources everywhere', () => {
    const saved = board(
      [card('ask', 'askAi'), card('title-1', 'title', 'label'), card('mid', 'note', 'mid'), card('t2', 'title')],
      [
        conn('c1', 'title-1', 'ask'),
        conn('c2', 'ghost', 'ask'),
        conn('c3', 'mid', 'ask'),
        conn('c4', 't2', 'mid'),
      ],
    )
    const ids = gatherContext(saved, 'ask').entries.map((e) => e.cardId)
    expect(ids).toEqual(['mid'])
  })

  it('carries group modes and counts full-group members as used', () => {
    const groupCard = card('group-1', 'group')
    const member = { ...card('member-1', 'note', 'member'), groupId: 'group-1' }
    const saved = board(
      [card('ask', 'askAi'), groupCard, member, card('group-2', 'group')],
      [
        conn('c1', 'group-1', 'ask'),
        conn('c2', 'group-2', 'ask', { meta: { groupMode: 'compress' } }),
      ],
    )

    const selection = gatherContext(saved, 'ask')

    expect(selection.entries).toEqual([
      { cardId: 'group-1', connectionId: 'c1', relation: 'feeds-strong', hop: 1, groupMode: 'full' },
      { cardId: 'group-2', connectionId: 'c2', relation: 'feeds-strong', hop: 1, groupMode: 'compress' },
    ])
    expect(selection.usedCardIds).toContain('member-1')
  })

  it('does not re-select a card the second hop already saw, but keeps duplicate direct wires', () => {
    const saved = board(
      [card('ask', 'askAi'), card('a', 'note', 'a'), card('b', 'note', 'b')],
      [
        conn('c1', 'a', 'ask'),
        conn('c2', 'b', 'ask'),
        conn('c3', 'a', 'b'), // second hop would re-add 'a'
        conn('c4', 'a', 'ask', { strength: 'weak' }), // duplicate direct wire stays
      ],
    )

    const entries = gatherContext(saved, 'ask').entries
    const aEntries = entries.filter((e) => e.cardId === 'a')
    expect(aEntries).toHaveLength(2)
    expect(aEntries.every((e) => e.hop === 1)).toBe(true)
  })

  it('treats avoid-connected Mods as silence while keeping a helps-connected wire', () => {
    const saved = board(
      [card('ask', 'askAi'), card('mod', 'mod')],
      [
        conn('avoid-mod', 'mod', 'ask', { polarity: 'pushesAgainst' }),
        conn('helping-mod', 'mod', 'ask'),
      ],
    )

    expect(gatherContext(saved, 'ask')).toMatchObject({
      entries: [{ cardId: 'mod', connectionId: 'helping-mod', relation: 'modifies', hop: 1 }],
      usedCardIds: ['mod'],
      usedConnectionIds: ['helping-mod'],
    })
  })
})

describe('deepThoughtPolicy (k-hop)', () => {
  it('walks N hops along strong helps-connections and stops at the bound', () => {
    // d → c → b → a → ask, all strong helps.
    const saved = board(
      [card('ask', 'askAi'), card('a', 'note', 'a'), card('b', 'note', 'b'), card('c', 'note', 'c'), card('d', 'note', 'd')],
      [conn('c1', 'a', 'ask'), conn('c2', 'b', 'a'), conn('c3', 'c', 'b'), conn('c4', 'd', 'c')],
    )

    const twoHops = gatherContext(saved, 'ask')
    expect(twoHops.entries.map((e) => [e.cardId, e.hop])).toEqual([
      ['a', 1],
      ['b', 2],
    ])

    const threeHops = gatherContext(saved, 'ask', deepThoughtPolicy(3))
    expect(threeHops.entries.map((e) => [e.cardId, e.hop])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
    ])

    const fourHops = gatherContext(saved, 'ask', deepThoughtPolicy(4))
    expect(fourHops.entries.map((e) => [e.cardId, e.hop])).toEqual([
      ['a', 1],
      ['b', 2],
      ['c', 3],
      ['d', 4],
    ])
  })

  it('keeps every selected entry explainable: connection, hop, and relation present', () => {
    const saved = board(
      [card('ask', 'askAi'), card('a', 'note'), card('b', 'note'), card('c', 'note')],
      [conn('c1', 'a', 'ask'), conn('c2', 'b', 'a'), conn('c3', 'c', 'b')],
    )

    for (const entry of gatherContext(saved, 'ask', deepThoughtPolicy(5)).entries) {
      expect(entry.connectionId).toBeTruthy()
      expect(entry.hop).toBeGreaterThanOrEqual(1)
      expect(['feeds-strong', 'feeds-weak', 'constrains', 'modifies']).toContain(entry.relation)
    }
  })

  it('terminates on cyclic graphs and selects each card once', () => {
    // Ring: n1 → n2 → n3 → n1, with n1 feeding the ask.
    const saved = board(
      [card('ask', 'askAi'), card('n1', 'note'), card('n2', 'note'), card('n3', 'note')],
      [conn('c1', 'n1', 'ask'), conn('c2', 'n3', 'n1'), conn('c3', 'n2', 'n3'), conn('c4', 'n1', 'n2')],
    )

    const selection = gatherContext(saved, 'ask', deepThoughtPolicy(50))

    const ids = selection.entries.map((e) => e.cardId)
    expect(new Set(ids).size).toBe(ids.length)
    expect(ids.sort()).toEqual(['n1', 'n2', 'n3'])
  })

  it('same graph + same policy = same selection (deterministic)', () => {
    const saved = board(
      [card('ask', 'askAi'), card('a', 'note'), card('b', 'note'), card('c', 'note'), card('d', 'note')],
      [conn('c1', 'a', 'ask'), conn('c2', 'b', 'ask'), conn('c3', 'c', 'a'), conn('c4', 'd', 'c')],
    )
    const policy = deepThoughtPolicy(4)

    expect(gatherContext(saved, 'ask', policy)).toEqual(gatherContext(saved, 'ask', policy))
  })

  it('never walks through result or group cards, and default policy output is unchanged in shape', () => {
    const saved = board(
      [card('ask', 'askAi'), card('res', 'result'), card('behind-res', 'note')],
      [conn('c1', 'res', 'ask'), conn('c2', 'behind-res', 'res')],
    )

    const selection = gatherContext(saved, 'ask', deepThoughtPolicy(5))
    expect(selection.entries.map((e) => e.cardId)).toEqual(['res'])

    const defaultSelection = gatherContext(saved, 'ask', CONNECTED_THOUGHT_POLICY)
    expect(defaultSelection.entries.every((e) => e.hop === 1 || e.hop === 2)).toBe(true)
  })
})
