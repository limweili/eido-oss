// Characterization safety net for the Phase 1 context-contract refactor (#260).
// One fixture board covers every card kind and both polarities; the expected
// selections below are the EXACT output of gatherContext before the refactor.
// The contract migration must keep every assertion green — a red here means the
// registry changed traversal meaning, not just its plumbing.

import { describe, expect, it } from 'vitest'
import { CONNECTED_THOUGHT_POLICY, deepThoughtPolicy, gatherContext } from './contextQuery'
import type { Card, Connection, SavedBoard } from './types'

function card(id: string, kind: Card['kind'], text = '', extra: Partial<Card> = {}): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text }],
    position: { x: 0, y: 0 },
    ...extra,
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

// Every card kind appears at least once; both polarities and both strengths
// appear at hop 1; the second hop exercises every walk rule (mod/title skip,
// result/group barrier, weak filter, conversation pass-through).
function fixtureBoard(): SavedBoard {
  const cards = [
    card('ask', 'askAi', 'the task'),

    // hop 1, plain feeds in every strength × polarity combination
    card('note-strong', 'note', 'strong helps'),
    card('note-weak', 'note', 'weak helps'),
    card('note-avoid-strong', 'note', 'strong against'),
    card('note-avoid-weak', 'note', 'weak against'),

    // hop 1, special kinds
    card('mod-1', 'mod'),
    card('title-1', 'title', 'a label'),
    card('result-1', 'result'),
    card('conversation-1', 'conversation', 'the topic'),
    card('group-full', 'group'),
    card('group-compress', 'group'),

    // group members
    card('member-1', 'note', 'member one', { groupId: 'group-full' }),
    card('member-2', 'note', 'member two', { groupId: 'group-full' }),
    card('member-3', 'note', 'member three', { groupId: 'group-compress' }),

    // upstream of note-strong: what the second hop may and may not pick up
    card('hop2-note', 'note', 'second hop'),
    card('hop2-weak-note', 'note', 'weak second hop'),
    card('hop2-avoid-note', 'note', 'against upstream'),
    card('hop2-mod', 'mod'),
    card('hop2-title', 'title'),

    // upstream of barrier kinds: walks must stop at results and groups
    card('behind-result', 'note', 'behind the result'),
    card('behind-group', 'note', 'behind the group'),

    // upstream of the conversation: walks pass through conversations
    card('behind-conversation', 'note', 'behind the conversation'),

    // third hop behind hop2-note (only deeper policies reach it)
    card('hop3-note', 'note', 'third hop'),
  ]

  const connections = [
    // hop 1 into the ask, in user order
    conn('c-strong', 'note-strong', 'ask'),
    conn('c-weak', 'note-weak', 'ask', { strength: 'weak' }),
    conn('c-avoid-strong', 'note-avoid-strong', 'ask', { polarity: 'pushesAgainst' }),
    conn('c-avoid-weak', 'note-avoid-weak', 'ask', { strength: 'weak', polarity: 'pushesAgainst' }),
    conn('c-mod', 'mod-1', 'ask', { role: 'modifies' }),
    conn('c-title', 'title-1', 'ask'),
    conn('c-result', 'result-1', 'ask'),
    conn('c-conversation', 'conversation-1', 'ask'),
    conn('c-group-full', 'group-full', 'ask', { meta: { groupMode: 'full' } }),
    conn('c-group-compress', 'group-compress', 'ask', { meta: { groupMode: 'compress' } }),

    // upstream of note-strong
    conn('c-hop2', 'hop2-note', 'note-strong'),
    conn('c-hop2-weak', 'hop2-weak-note', 'note-strong', { strength: 'weak' }),
    conn('c-hop2-avoid', 'hop2-avoid-note', 'note-strong', { polarity: 'pushesAgainst' }),
    conn('c-hop2-mod', 'hop2-mod', 'note-strong'),
    conn('c-hop2-title', 'hop2-title', 'note-strong'),

    // upstream of barrier kinds
    conn('c-behind-result', 'behind-result', 'result-1'),
    conn('c-behind-group', 'behind-group', 'group-full'),

    // upstream of the conversation (pass-through kind)
    conn('c-behind-conversation', 'behind-conversation', 'conversation-1'),

    // a third hop behind hop2-note
    conn('c-hop3', 'hop3-note', 'hop2-note'),
  ]

  return { version: 1, cards, connections, outputs: [], runs: [], updatedAt: '' }
}

describe('gatherContext characterization (every kind, both polarities)', () => {
  it('default policy: exact selection for the fixture board', () => {
    const selection = gatherContext(fixtureBoard(), 'ask')

    expect(selection.rootCardId).toBe('ask')
    expect(selection.policy).toEqual({ name: 'connected-thought', version: 1 })
    expect(selection.entries).toEqual([
      { cardId: 'note-strong', connectionId: 'c-strong', relation: 'feeds-strong', hop: 1, groupMode: undefined },
      // second hop follows strong helps only, skips mods and titles, never
      // pushesAgainst; deeper material is always feeds-weak
      { cardId: 'hop2-note', connectionId: 'c-hop2', relation: 'feeds-weak', hop: 2 },
      { cardId: 'note-weak', connectionId: 'c-weak', relation: 'feeds-weak', hop: 1, groupMode: undefined },
      { cardId: 'note-avoid-strong', connectionId: 'c-avoid-strong', relation: 'constrains', hop: 1, groupMode: undefined },
      { cardId: 'note-avoid-weak', connectionId: 'c-avoid-weak', relation: 'constrains', hop: 1, groupMode: undefined },
      { cardId: 'mod-1', connectionId: 'c-mod', relation: 'modifies', hop: 1 },
      // title-1 is skipped: labels, not thought context
      // result and conversation contribute, but only the conversation lets the
      // walk continue upstream — chains own what sits behind a result
      { cardId: 'result-1', connectionId: 'c-result', relation: 'feeds-strong', hop: 1, groupMode: undefined },
      { cardId: 'conversation-1', connectionId: 'c-conversation', relation: 'feeds-strong', hop: 1, groupMode: undefined },
      { cardId: 'behind-conversation', connectionId: 'c-behind-conversation', relation: 'feeds-weak', hop: 2 },
      { cardId: 'group-full', connectionId: 'c-group-full', relation: 'feeds-strong', hop: 1, groupMode: 'full' },
      { cardId: 'group-compress', connectionId: 'c-group-compress', relation: 'feeds-strong', hop: 1, groupMode: 'compress' },
    ])

    // Full-mode group members count as used; compress members do not.
    expect(selection.usedCardIds).toEqual([
      'note-strong',
      'hop2-note',
      'note-weak',
      'note-avoid-strong',
      'note-avoid-weak',
      'mod-1',
      'result-1',
      'conversation-1',
      'behind-conversation',
      'group-full',
      'member-1',
      'member-2',
      'group-compress',
    ])
    expect(selection.usedConnectionIds).toEqual([
      'c-strong',
      'c-hop2',
      'c-weak',
      'c-avoid-strong',
      'c-avoid-weak',
      'c-mod',
      'c-result',
      'c-conversation',
      'c-behind-conversation',
      'c-group-full',
      'c-group-compress',
    ])
  })

  it('mod cards keep the modifies relation even without the modifies role', () => {
    // Old boards can hold a mod wired with role "feeds"; the kind decides.
    const board = fixtureBoard()
    board.connections = board.connections.map((c) => (c.id === 'c-mod' ? { ...c, role: 'feeds' as const } : c))
    const selection = gatherContext(board, 'ask')
    expect(selection.entries.find((e) => e.cardId === 'mod-1')).toEqual({
      cardId: 'mod-1',
      connectionId: 'c-mod',
      relation: 'modifies',
      hop: 1,
    })
  })

  it('a group connection without a stored mode defaults to full', () => {
    const board = fixtureBoard()
    board.connections = board.connections.map((c) => (c.id === 'c-group-full' ? { ...c, meta: undefined } : c))
    const selection = gatherContext(board, 'ask')
    const entry = selection.entries.find((e) => e.cardId === 'group-full')
    expect(entry?.groupMode).toBe('full')
    expect(selection.usedCardIds).toContain('member-1')
    expect(selection.usedCardIds).toContain('member-2')
  })

  it('deep policy with weak hops reaches the third hop but still respects kind rules', () => {
    const selection = gatherContext(fixtureBoard(), 'ask', deepThoughtPolicy(3, true))

    // Weak upstream link now walks; mods, titles, and pushesAgainst still never do.
    expect(selection.entries).toContainEqual({
      cardId: 'hop2-weak-note',
      connectionId: 'c-hop2-weak',
      relation: 'feeds-weak',
      hop: 2,
    })
    expect(selection.entries).toContainEqual({
      cardId: 'hop3-note',
      connectionId: 'c-hop3',
      relation: 'feeds-weak',
      hop: 3,
    })
    const picked = selection.entries.map((e) => e.cardId)
    expect(picked).not.toContain('hop2-mod')
    expect(picked).not.toContain('hop2-title')
    expect(picked).not.toContain('hop2-avoid-note')
    // Barriers hold at any depth: nothing behind results or groups.
    expect(picked).not.toContain('behind-result')
    expect(picked).not.toContain('behind-group')
  })

  it('single-hop policy stops at hop 1 for the same fixture', () => {
    const selection = gatherContext(fixtureBoard(), 'ask', deepThoughtPolicy(1))
    expect(selection.entries.every((e) => e.hop === 1)).toBe(true)
    expect(selection.entries.map((e) => e.cardId)).toEqual([
      'note-strong',
      'note-weak',
      'note-avoid-strong',
      'note-avoid-weak',
      'mod-1',
      'result-1',
      'conversation-1',
      'group-full',
      'group-compress',
    ])
  })

  it('default policy output is identical when the policy object is passed explicitly', () => {
    expect(gatherContext(fixtureBoard(), 'ask', CONNECTED_THOUGHT_POLICY)).toEqual(
      gatherContext(fixtureBoard(), 'ask'),
    )
  })
})
