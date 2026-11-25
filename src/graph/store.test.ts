import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commitV2Mod } from '../mods/commit'
import { createSeedMod } from '../mods/seeds'
import type { ProfileRendererAuthoritativeUpdate } from './profileRendererPersistence'
import type { Card, Connection, FollowUpMessage, IntentLogEvent, SavedBoard } from './types'
import { noteFontSizeOf } from './noteFontSize'
import { registerFollowUpStreamStopper, useGraph } from './store'
import { membersOf } from './graphHelpers'

function card(id: string, kind: Card['kind'], position: Card['position'], groupId?: string): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text: kind === 'note' ? id : '' }],
    position,
    groupId,
    ...(kind === 'group'
      ? { title: 'Group', size: { width: 420, height: 320 }, compressionPrompt: 'Sum it up.' }
      : {}),
  }
}

function connection(id: string, from: string, to: string, meta?: Connection['meta']): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    ...(meta ? { meta } : {}),
  }
}

function savedBoard(cards: Card[], intentLog: IntentLogEvent[] = []): SavedBoard {
  return {
    version: 1,
    cards,
    connections: [],
    outputs: [],
    runs: [],
    highlights: [],
    highlightTags: [],
    intentLog,
    compactionSummaries: [],
    updatedAt: '2026-07-22T00:00:00.000Z',
  }
}

function authoritativeUpdate(
  previous: SavedBoard,
  next: SavedBoard,
  authoritativePrevious: SavedBoard = previous,
  authoritativeNext: SavedBoard = next,
): ProfileRendererAuthoritativeUpdate {
  const idea = {
    id: 'idea-live',
    name: 'Live Board',
    createdAt: '2026-07-22T00:00:00.000Z',
    updatedAt: '2026-07-22T00:01:00.000Z',
    lastOpenedAt: '2026-07-22T00:00:00.000Z',
  }
  const hydration = (board: SavedBoard) => ({
    intentActorId: 'eido-desktop-gui',
    idea,
    board,
    ideas: [idea],
    userModTemplates: [],
    modOrigins: {},
  })
  return {
    previousRevision: 7,
    revision: 8,
    previous: hydration(previous),
    next: hydration(next),
    authoritativeTransition: {
      previous: hydration(authoritativePrevious),
      next: hydration(authoritativeNext),
    },
  }
}

function expectEmptyCommit(result: { commitId: string | null; changed: boolean }) {
  expect(result).toEqual({ commitId: null, changed: false })
  expect(useGraph.getState().undoStack).toHaveLength(0)
  expect(useGraph.getState().intentLog).toHaveLength(0)
}

describe('group membership in the graph store', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      keyPromptOpen: false,
      cardClipboard: null,
    })
  })

  it('groups and ungroups any moved card by the group frame bounds', () => {
    useGraph.setState({
      cards: [
        card('group-1', 'group', { x: 0, y: 0 }),
        card('ask-1', 'askAi', { x: 520, y: 20 }),
      ],
    })

    useGraph.getState().moveCard('ask-1', { x: 40, y: 40 })
    expect(useGraph.getState().cards.find((c) => c.id === 'ask-1')?.groupId).toBe('group-1')

    useGraph.getState().moveCard('ask-1', { x: 620, y: 20 })
    expect(useGraph.getState().cards.find((c) => c.id === 'ask-1')?.groupId).toBeUndefined()
  })

  it('creates a group from mixed selected card kinds', () => {
    useGraph.setState({
      cards: [
        card('note-1', 'note', { x: 20, y: 20 }),
        card('mod-1', 'mod', { x: 300, y: 40 }),
      ],
    })

    const groupId = useGraph.getState().createGroupFromSelection(['note-1', 'mod-1'])

    expect(groupId).toBeTruthy()
    expect(useGraph.getState().cards.find((c) => c.id === 'note-1')?.groupId).toBe(groupId)
    expect(useGraph.getState().cards.find((c) => c.id === 'mod-1')?.groupId).toBe(groupId)
  })

  it('reorders group members in saved-board order', () => {
    useGraph.setState({
      cards: [
        card('group-1', 'group', { x: 0, y: 0 }),
        card('note-a', 'note', { x: 20, y: 20 }, 'group-1'),
        card('ask-1', 'askAi', { x: 180, y: 20 }, 'group-1'),
        card('note-b', 'note', { x: 340, y: 20 }, 'group-1'),
      ],
    })

    useGraph.getState().reorderGroupMembers('group-1', ['note-b', 'note-a', 'ask-1'])

    expect(membersOf(useGraph.getState().snapshot(), 'group-1').map((member) => member.id)).toEqual([
      'note-b',
      'note-a',
      'ask-1',
    ])
  })

  it('keeps title cards out of groups', () => {
    useGraph.setState({
      cards: [
        card('group-1', 'group', { x: 0, y: 0 }),
        card('title-1', 'title', { x: 40, y: 40 }),
        card('note-1', 'note', { x: 300, y: 40 }),
      ],
    })

    useGraph.getState().moveCard('title-1', { x: 60, y: 60 })
    expect(useGraph.getState().cards.find((c) => c.id === 'title-1')?.groupId).toBeUndefined()

    expect(useGraph.getState().createGroupFromSelection(['title-1', 'note-1'])).toBeUndefined()
  })
})

describe('authoritative Profile updates in the graph store', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [
        card('agent-deletes-this', 'note', { x: 300, y: 0 }),
        card('selected-note', 'note', { x: 0, y: 0 }),
      ],
      connections: [],
      outputs: [],
      runs: [],
      highlights: [],
      highlightTags: [],
      compactionSummaries: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      currentIdeaId: 'idea-live',
      ideas: [{
        id: 'idea-live',
        name: 'Live Board',
        createdAt: '2026-07-22T00:00:00.000Z',
        updatedAt: '2026-07-22T00:01:00.000Z',
        lastOpenedAt: '2026-07-22T00:00:00.000Z',
      }],
      settings: { ...useGraph.getState().settings, profileModLibrary: [] },
    })
  })

  it('applies agent graph and Intent changes without entering or disturbing user undo', () => {
    useGraph.getState().moveCard('selected-note', { x: 40, y: 20 })
    useGraph.getState().select({ kind: 'card', id: 'selected-note' })
    useGraph.getState().setSelectedCardIds(['selected-note'])

    const beforeUpdate = useGraph.getState()
    const previous = beforeUpdate.snapshot()
    const agentActor = {
      kind: 'agent' as const,
      client: 'codex',
      sessionId: 'agent-session',
    }
    const selected = beforeUpdate.cards.find((candidate) => candidate.id === 'selected-note')!
    const agentCreated = {
      ...card('agent-created', 'note', { x: 620, y: 40 }),
      createdBy: agentActor,
      lastModifiedBy: agentActor,
    }
    const agentEvent = {
      id: 'event-agent-created',
      type: 'card.created' as const,
      at: '2026-07-22T00:02:00.000Z',
      ideaId: 'idea-live',
      commitId: 'agent:transaction-live',
      actorId: 'eido-profile-agent',
      clientTxnId: 'agent-transaction-live',
      seq: 1,
      cardId: agentCreated.id,
      data: { card: agentCreated },
    } satisfies IntentLogEvent
    const next = savedBoard([
      {
        ...selected,
        blocks: [{ id: 'selected-note-block', text: 'Agent revised this text' }],
        lastModifiedBy: agentActor,
      },
      agentCreated,
    ], [agentEvent])
    const undoStack = beforeUpdate.undoStack

    expect(useGraph.getState().applyAuthoritativeProfileUpdate(
      authoritativeUpdate(previous, next),
    )).toEqual({ status: 'applied', revision: 8 })

    const applied = useGraph.getState()
    expect(applied.cards.map((candidate) => candidate.id)).toEqual([
      'selected-note',
      'agent-created',
    ])
    expect(applied.cards[0].blocks[0].text).toBe('Agent revised this text')
    expect(applied.intentLog).toEqual([agentEvent])
    expect(applied.undoStack).toHaveLength(undoStack.length)
    expect(applied.selection).toEqual({ kind: 'card', id: 'selected-note' })
    expect(applied.selectedCardIds).toEqual(['selected-note'])
    expect(applied.lastBoardChange).toMatchObject({
      source: 'external-authority',
      change: {
        cards: {
          added: ['agent-created'],
          updated: ['selected-note'],
          removed: ['agent-deletes-this'],
        },
      },
    })

    useGraph.getState().undo()
    const undone = useGraph.getState()
    expect(undone.cards.find((candidate) => candidate.id === 'selected-note')).toMatchObject({
      position: { x: 0, y: 0 },
      blocks: [{ text: 'Agent revised this text' }],
      lastModifiedBy: agentActor,
    })
    expect(undone.cards.some((candidate) => candidate.id === 'agent-created')).toBe(true)
  })

  it('keeps follow-ups active when an authoritative update preserves their exact destinations', () => {
    const result = card('result-live', 'result', { x: 500, y: 0 })
    const output = {
      id: 'output-live',
      resultCardId: result.id,
      chosenVersionId: 'version-live',
      versions: [{
        id: 'version-live',
        number: 1,
        text: 'Durable result',
        createdAt: '2026-07-22T00:00:00.000Z',
        fromRunId: 'run-live',
      }],
    }
    useGraph.setState((state) => ({
      cards: [...state.cards, result],
      outputs: [output],
    }))
    const previous = useGraph.getState().snapshot()
    const next = {
      ...previous,
      cards: previous.cards.map((candidate) => candidate.id === 'selected-note'
        ? { ...candidate, blocks: [{ ...candidate.blocks[0], text: 'Agent edit elsewhere' }] }
        : candidate),
    }
    const stopFollowUps = vi.fn()
    registerFollowUpStreamStopper(stopFollowUps)

    try {
      expect(useGraph.getState().applyAuthoritativeProfileUpdate(
        authoritativeUpdate(previous, next),
      )).toEqual({ status: 'applied', revision: 8 })
      expect(stopFollowUps).not.toHaveBeenCalled()
    } finally {
      registerFollowUpStreamStopper(() => {})
    }
  })

  it('stops only follow-ups whose exact destination is removed by authoritative update', () => {
    const keptResult = card('result-kept', 'result', { x: 500, y: 0 })
    const lostResult = card('result-lost', 'result', { x: 800, y: 0 })
    const outputFor = (suffix: 'kept' | 'lost') => ({
      id: `output-${suffix}`,
      resultCardId: `result-${suffix}`,
      chosenVersionId: `version-${suffix}`,
      versions: [{
        id: `version-${suffix}`,
        number: 1,
        text: 'Durable result',
        createdAt: '2026-07-22T00:00:00.000Z',
        fromRunId: `run-${suffix}`,
      }],
    })
    const keptOutput = outputFor('kept')
    const lostOutput = outputFor('lost')
    useGraph.setState((state) => ({
      cards: [...state.cards, keptResult, lostResult],
      outputs: [keptOutput, lostOutput],
    }))
    const previous = useGraph.getState().snapshot()
    const next = {
      ...previous,
      cards: previous.cards.filter((candidate) => candidate.id !== lostResult.id),
      outputs: [keptOutput],
    }
    const stopFollowUps = vi.fn()
    registerFollowUpStreamStopper(stopFollowUps)

    try {
      expect(useGraph.getState().applyAuthoritativeProfileUpdate(
        authoritativeUpdate(previous, next),
      )).toEqual({ status: 'applied', revision: 8 })
      expect(stopFollowUps).toHaveBeenCalledOnce()
      expect(stopFollowUps).toHaveBeenCalledWith(['version-lost'])
    } finally {
      registerFollowUpStreamStopper(() => {})
    }
  })

  it('retires only a user drag that overlaps a newer authoritative move', () => {
    const unrelatedBefore = useGraph.getState().cards
    useGraph.getState().moveCard(
      'agent-deletes-this',
      { x: 310, y: 0 },
      { recordHistory: false },
    )
    useGraph.getState().recordCardStructuralChange(
      'moveCard',
      unrelatedBefore,
      useGraph.getState().cards,
    )

    const targetBefore = useGraph.getState().cards
    useGraph.getState().moveCard(
      'selected-note',
      { x: 10, y: 0 },
      { recordHistory: false },
    )
    useGraph.getState().recordCardStructuralChange(
      'moveCard',
      targetBefore,
      useGraph.getState().cards,
    )
    expect(useGraph.getState().undoStack).toHaveLength(2)

    const previous = useGraph.getState().snapshot()
    const next = savedBoard(previous.cards.map((candidate) => candidate.id === 'selected-note'
      ? { ...candidate, position: { x: 200, y: 0 } }
      : candidate), previous.intentLog)

    expect(useGraph.getState().applyAuthoritativeProfileUpdate(
      authoritativeUpdate(previous, next),
    )).toEqual({ status: 'applied', revision: 8 })
    expect(useGraph.getState().undoStack).toHaveLength(1)

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(
      (candidate) => candidate.id === 'selected-note',
    )?.position).toEqual({ x: 200, y: 0 })
    expect(useGraph.getState().cards.find(
      (candidate) => candidate.id === 'agent-deletes-this',
    )?.position).toEqual({ x: 300, y: 0 })
  })

  it('retires a held drag when the merged visible value hides the authoritative overlap', () => {
    const authoritativeBase = useGraph.getState().snapshot()

    const unrelatedBefore = useGraph.getState().cards
    useGraph.getState().moveCard(
      'agent-deletes-this',
      { x: 310, y: 0 },
      { recordHistory: false },
    )
    useGraph.getState().recordCardStructuralChange(
      'moveCard',
      unrelatedBefore,
      useGraph.getState().cards,
    )

    const targetBefore = useGraph.getState().cards
    useGraph.getState().moveCard(
      'selected-note',
      { x: 10, y: 0 },
      { recordHistory: false },
    )
    useGraph.getState().recordCardStructuralChange(
      'moveCard',
      targetBefore,
      useGraph.getState().cards,
    )
    const held = useGraph.getState().snapshot()
    const authoritative = savedBoard(authoritativeBase.cards.map((candidate) =>
      candidate.id === 'selected-note'
        ? { ...candidate, position: { x: 200, y: 0 } }
        : candidate), authoritativeBase.intentLog)

    expect(useGraph.getState().applyAuthoritativeProfileUpdate(
      authoritativeUpdate(held, held, authoritativeBase, authoritative),
    )).toEqual({ status: 'applied', revision: 8 })
    expect(useGraph.getState().undoStack).toHaveLength(1)

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(
      (candidate) => candidate.id === 'selected-note',
    )?.position).toEqual({ x: 10, y: 0 })
    expect(useGraph.getState().cards.find(
      (candidate) => candidate.id === 'agent-deletes-this',
    )?.position).toEqual({ x: 300, y: 0 })
  })

  it('retires a user Card addition before undo can replace an Agent-extended Card collection', () => {
    const userCardId = useGraph.getState().addCard('note', { x: 120, y: 40 })
    const previous = useGraph.getState().snapshot()
    const agentCard = card('agent-created-after-user-add', 'note', { x: 620, y: 40 })
    const next = savedBoard([...previous.cards, agentCard], previous.intentLog)

    expect(useGraph.getState().applyAuthoritativeProfileUpdate(
      authoritativeUpdate(previous, next),
    )).toEqual({ status: 'applied', revision: 8 })
    expect(useGraph.getState().undoStack).toHaveLength(0)

    useGraph.getState().undo()
    expect(useGraph.getState().cards.map((candidate) => candidate.id)).toEqual([
      'agent-deletes-this',
      'selected-note',
      userCardId,
      agentCard.id,
    ])
  })

  it('retires a root Card replacement when Agent authority extends its Connection closure', () => {
    const userCardId = useGraph.getState().addCard('note', { x: 120, y: 40 })
    const previous = useGraph.getState().snapshot()
    const agentConnection = connection(
      'agent-connects-user-card',
      userCardId,
      'selected-note',
    )
    const next = { ...previous, connections: [agentConnection] }

    expect(useGraph.getState().applyAuthoritativeProfileUpdate(
      authoritativeUpdate(previous, next),
    )).toEqual({ status: 'applied', revision: 8 })
    expect(useGraph.getState().undoStack).toHaveLength(0)

    useGraph.getState().undo()
    expect(useGraph.getState().cards.some((candidate) => candidate.id === userCardId)).toBe(true)
    expect(useGraph.getState().connections).toEqual([agentConnection])
  })

  it('retires a user Card deletion before undo can replace an Agent-extended Card collection', () => {
    useGraph.getState().deleteCard('selected-note')
    const previous = useGraph.getState().snapshot()
    const agentCard = card('agent-created-after-user-delete', 'note', { x: 620, y: 40 })
    const next = savedBoard([...previous.cards, agentCard], previous.intentLog)

    expect(useGraph.getState().applyAuthoritativeProfileUpdate(
      authoritativeUpdate(previous, next),
    )).toEqual({ status: 'applied', revision: 8 })
    expect(useGraph.getState().undoStack).toHaveLength(0)

    useGraph.getState().undo()
    expect(useGraph.getState().cards.map((candidate) => candidate.id)).toEqual([
      'agent-deletes-this',
      agentCard.id,
    ])
  })

  it('blocks an authoritative replacement when renderer-owned user work diverged', () => {
    const previous = useGraph.getState().snapshot()
    const next = savedBoard([
      ...previous.cards,
      card('agent-created', 'note', { x: 620, y: 40 }),
    ])

    useGraph.getState().setCardText('selected-note', 'Unsettled user text')
    const divergedCards = useGraph.getState().cards
    const undoStack = useGraph.getState().undoStack

    expect(useGraph.getState().applyAuthoritativeProfileUpdate(
      authoritativeUpdate(previous, next),
    )).toEqual({ status: 'blocked', revision: 7 })
    expect(useGraph.getState().cards).toBe(divergedCards)
    expect(useGraph.getState().cards.find(
      (candidate) => candidate.id === 'selected-note',
    )?.blocks[0].text).toBe('Unsettled user text')
    expect(useGraph.getState().cards.some((candidate) => candidate.id === 'agent-created')).toBe(false)
    expect(useGraph.getState().undoStack).toBe(undoStack)
  })
})

describe('batched drag commits (#143)', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      keyPromptOpen: false,
      cardClipboard: null,
    })
  })

  it('moves many cards in ONE store commit per frame', () => {
    useGraph.setState({
      cards: [
        card('a', 'note', { x: 0, y: 0 }),
        card('b', 'note', { x: 300, y: 0 }),
        card('c', 'note', { x: 600, y: 0 }),
      ],
    })

    let notifications = 0
    const unsubscribe = useGraph.subscribe(() => {
      notifications += 1
    })
    useGraph.getState().moveCards(
      [
        { id: 'a', position: { x: 10, y: 10 } },
        { id: 'b', position: { x: 310, y: 10 } },
        { id: 'c', position: { x: 610, y: 10 } },
      ],
      { recordHistory: false },
    )
    unsubscribe()

    expect(notifications).toBe(1)
    const cards = useGraph.getState().cards
    expect(cards.find((c) => c.id === 'a')?.position).toEqual({ x: 10, y: 10 })
    expect(cards.find((c) => c.id === 'b')?.position).toEqual({ x: 310, y: 10 })
    expect(cards.find((c) => c.id === 'c')?.position).toEqual({ x: 610, y: 10 })
  })

  it('drags group members along with the group, keeping explicit member moves', () => {
    useGraph.setState({
      cards: [
        card('group-1', 'group', { x: 0, y: 0 }),
        card('member-a', 'note', { x: 20, y: 20 }, 'group-1'),
        card('member-b', 'note', { x: 120, y: 20 }, 'group-1'),
        card('outside', 'note', { x: 900, y: 900 }),
      ],
    })

    useGraph.getState().moveCards(
      [
        { id: 'group-1', position: { x: 50, y: 40 } },
        // React Flow reports selected members explicitly; that wins.
        { id: 'member-a', position: { x: 75, y: 65 } },
      ],
      { recordHistory: false },
    )

    const cards = useGraph.getState().cards
    expect(cards.find((c) => c.id === 'group-1')?.position).toEqual({ x: 50, y: 40 })
    expect(cards.find((c) => c.id === 'member-a')?.position).toEqual({ x: 75, y: 65 })
    // member-b had no explicit move: it follows the group delta (+50, +40).
    expect(cards.find((c) => c.id === 'member-b')?.position).toEqual({ x: 170, y: 60 })
    expect(cards.find((c) => c.id === 'outside')?.position).toEqual({ x: 900, y: 900 })
  })

  it('records one undoable step for a multi-card move by default', () => {
    useGraph.setState({
      cards: [card('a', 'note', { x: 0, y: 0 }), card('b', 'note', { x: 300, y: 0 })],
    })

    useGraph.getState().moveCards([
      { id: 'a', position: { x: 11, y: 11 } },
      { id: 'b', position: { x: 311, y: 11 } },
    ])

    expect(useGraph.getState().undoStack.length).toBe(1)
    useGraph.getState().undo()
    const cards = useGraph.getState().cards
    expect(cards.find((c) => c.id === 'a')?.position).toEqual({ x: 0, y: 0 })
    expect(cards.find((c) => c.id === 'b')?.position).toEqual({ x: 300, y: 0 })
  })
})

describe('canvas polish card behavior in the graph store', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      highlights: [],
      highlightTags: [],
      activeHighlightTagId: null,
      selection: null,
      selectedCardIds: [],
      activeTool: 'select',
      saveState: 'saved',
      hydrated: false,
      keyPromptOpen: false,
      cardClipboard: null,
    })
  })

  it('adds title cards as labels that cannot be connected', () => {
    const titleId = useGraph.getState().addCard('title', { x: 10, y: 20 })
    const noteId = useGraph.getState().addCard('note', { x: 220, y: 20 })
    useGraph.getState().addConnection(titleId, noteId)
    useGraph.getState().addConnection(noteId, titleId)

    const title = useGraph.getState().cards.find((c) => c.id === titleId)!
    expect(title.kind).toBe('title')
    expect(title.blocks[0].text).toBe('Untitled label')
    expect(title.size).toEqual({ width: 320, height: 82 })
    expect(useGraph.getState().connections).toHaveLength(0)
  })

  it('persists note font size and card layer order in snapshots', () => {
    const noteA = useGraph.getState().addCard('note', { x: 0, y: 0 })
    const noteB = useGraph.getState().addCard('note', { x: 260, y: 0 })

    useGraph.getState().setCardFontSize(noteA, 3)
    useGraph.getState().bringCardsToFront([noteA])
    useGraph.getState().sendCardsToBack([noteB])

    const snapshot = useGraph.getState().snapshot()
    const savedA = snapshot.cards.find((c) => c.id === noteA)!
    const savedB = snapshot.cards.find((c) => c.id === noteB)!
    // The scale persists in the settings envelope, never as a top-level field
    // an older build would hold to a strict union (#1308).
    expect(noteFontSizeOf(savedA)).toBe(3)
    expect(savedA.meta).toEqual({ noteFontSize: 3 })
    expect(savedA).not.toHaveProperty('fontSize')
    expect(typeof savedA.zIndex).toBe('number')
    expect(typeof savedB.zIndex).toBe('number')
    expect(savedA.zIndex!).toBeGreaterThan(savedB.zIndex!)
  })

  it('adds a highlight without touching the note text, making a starter tag on first use', () => {
    const noteId = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().setCardText(noteId, 'A bright note')

    const highlightId = useGraph.getState().addHighlight({ cardId: noteId, text: 'bright', occurrence: 0 })

    expect(highlightId).toBeTruthy()
    expect(useGraph.getState().cards.find((c) => c.id === noteId)?.blocks[0].text).toBe('A bright note')
    expect(useGraph.getState().highlightTags).toHaveLength(1)
    const highlight = useGraph.getState().highlights.find((h) => h.id === highlightId)!
    expect(highlight.tagId).toBe(useGraph.getState().highlightTags[0].id)
    expect(useGraph.getState().activeHighlightTagId).toBe(highlight.tagId)
  })

  it('hands each new tag its own color and reuses tags by name', () => {
    const first = useGraph.getState().createHighlightTag('Key ideas')
    const second = useGraph.getState().createHighlightTag('Questions')
    const reused = useGraph.getState().createHighlightTag('  key IDEAS ')

    expect(reused).toBe(first)
    expect(second).not.toBe(first)
    expect(useGraph.getState().highlightTags).toHaveLength(2)
    const [a, b] = useGraph.getState().highlightTags
    expect(a.color).not.toBe(b.color)
    // Picking an existing tag by name also makes it the active pen color.
    expect(useGraph.getState().activeHighlightTagId).toBe(first)
  })

  it('renames and recolors tags, refusing name clashes and unknown colors', () => {
    const keyIdeas = useGraph.getState().createHighlightTag('Key ideas')
    const questions = useGraph.getState().createHighlightTag('Questions')

    useGraph.getState().renameHighlightTag(questions, '  Open questions ')
    useGraph.getState().renameHighlightTag(keyIdeas, 'open QUESTIONS') // clash: no-op
    useGraph.getState().renameHighlightTag(keyIdeas, '   ') // blank: no-op
    useGraph.getState().setHighlightTagColor(keyIdeas, 'teal')
    useGraph.getState().setHighlightTagColor(questions, 'not-a-color') // unknown: no-op

    const tags = useGraph.getState().highlightTags
    expect(tags.find((t) => t.id === questions)?.name).toBe('Open questions')
    expect(tags.find((t) => t.id === keyIdeas)?.name).toBe('Key ideas')
    expect(tags.find((t) => t.id === keyIdeas)?.color).toBe('teal')
    expect(tags.find((t) => t.id === questions)?.color).not.toBe('not-a-color')
  })

  it('re-tags an identical span instead of stacking a duplicate highlight', () => {
    const noteId = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().setCardText(noteId, 'A bright note')
    const firstTag = useGraph.getState().createHighlightTag('First')
    const originalId = useGraph.getState().addHighlight({ cardId: noteId, text: 'bright', occurrence: 0 })

    useGraph.getState().createHighlightTag('Second')
    const retaggedId = useGraph.getState().addHighlight({ cardId: noteId, text: 'bright', occurrence: 0 })

    expect(retaggedId).toBe(originalId)
    expect(useGraph.getState().highlights).toHaveLength(1)
    expect(useGraph.getState().highlights[0].tagId).not.toBe(firstTag)
  })

  it('keeps highlights in snapshots and drops them with their card or tag', () => {
    const noteId = useGraph.getState().addCard('note', { x: 0, y: 0 })
    const otherId = useGraph.getState().addCard('note', { x: 300, y: 0 })
    useGraph.getState().setCardText(noteId, 'A bright note')
    useGraph.getState().setCardText(otherId, 'Another bright thought')
    useGraph.getState().addHighlight({ cardId: noteId, text: 'bright', occurrence: 0 })
    useGraph.getState().addHighlight({ cardId: otherId, text: 'bright', occurrence: 0 })

    const snapshot = useGraph.getState().snapshot()
    expect(snapshot.highlights).toHaveLength(2)
    expect(snapshot.highlightTags).toHaveLength(1)

    useGraph.getState().deleteCard(otherId)
    expect(useGraph.getState().highlights).toHaveLength(1)

    useGraph.getState().deleteHighlightTag(useGraph.getState().highlightTags[0].id)
    expect(useGraph.getState().highlights).toHaveLength(0)
    expect(useGraph.getState().highlightTags).toHaveLength(0)
  })

  it('turns a highlight into a note card linked back to its source', () => {
    const noteId = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().setCardText(noteId, 'A bright note about focus')
    const highlightId = useGraph.getState().addHighlight({
      cardId: noteId,
      text: 'bright note',
      occurrence: 0,
    })!

    const createdId = useGraph.getState().createNoteFromHighlight(highlightId)!

    const created = useGraph.getState().cards.find((c) => c.id === createdId)!
    expect(created.kind).toBe('note')
    expect(created.blocks[0].text).toBe('bright note')
    expect(
      useGraph.getState().connections.some(
        (c) => c.from.cardId === noteId && c.to.cardId === createdId,
      ),
    ).toBe(true)
  })

  it('duplicates cards with remapped ids and optional external connections', () => {
    const agentAuthor = { kind: 'agent' as const, client: 'codex', sessionId: 'source-session' }
    useGraph.setState({
      cards: [
        {
          id: 'note-1',
          kind: 'note',
          title: 'Source',
          blocks: [{ id: 'block-1', text: 'Keep this' }],
          assets: [
            {
              id: 'asset-1',
              kind: 'image',
              name: 'sketch.png',
              mimeType: 'image/png',
              dataUrl: 'data:image/png;base64,abc',
              size: 12,
              createdAt: '2026-06-19T00:00:00.000Z',
            },
          ],
          meta: { noteFontSize: 1 },
          zIndex: 4,
          position: { x: 0, y: 0 },
          createdBy: agentAuthor,
          lastModifiedBy: agentAuthor,
        },
        card('ask-1', 'askAi', { x: 320, y: 0 }),
      ],
      connections: [
        {
          id: 'conn-1',
          from: { cardId: 'note-1', blockId: 'block-1' },
          to: { cardId: 'ask-1' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
    })

    const [copyId] = useGraph.getState().duplicateCard('note-1', { cloneConnections: true })
    const copy = useGraph.getState().cards.find((c) => c.id === copyId)!
    const clonedConnection = useGraph.getState().connections.find((c) => c.id !== 'conn-1')!

    expect(copyId).not.toBe('note-1')
    expect(copy.blocks[0]).toMatchObject({ text: 'Keep this' })
    expect(copy.blocks[0].id).not.toBe('block-1')
    expect(copy.assets?.[0]).toMatchObject({ name: 'sketch.png' })
    expect(copy.assets?.[0].id).not.toBe('asset-1')
    expect(noteFontSizeOf(copy)).toBe(1)
    expect(copy).toMatchObject({ title: 'Source' })
    expect(copy).not.toHaveProperty('createdBy')
    expect(copy).not.toHaveProperty('lastModifiedBy')
    expect(useGraph.getState().cards.find((card) => card.id === 'note-1')).toMatchObject({
      createdBy: agentAuthor,
      lastModifiedBy: agentAuthor,
    })
    expect(clonedConnection.from.cardId).toBe(copyId)
    expect(clonedConnection.from.blockId).toBe(copy.blocks[0].id)
    expect(clonedConnection.to.cardId).toBe('ask-1')
  })

  it('copies and pastes cards without cloning connections by default', () => {
    const agentAuthor = { kind: 'agent' as const, client: 'codex', sessionId: 'source-session' }
    useGraph.setState({
      cards: [
        {
          ...card('note-1', 'note', { x: 10, y: 20 }),
          title: 'Clipboard source',
          meta: { noteFontSize: 3 },
          createdBy: agentAuthor,
          lastModifiedBy: agentAuthor,
        },
        card('ask-1', 'askAi', { x: 320, y: 20 }),
      ],
      connections: [
        {
          id: 'conn-1',
          from: { cardId: 'note-1' },
          to: { cardId: 'ask-1' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
    })

    useGraph.getState().copyCards(['note-1'])
    const [pastedId] = useGraph.getState().pasteCards({ x: 500, y: 500 })
    const pasted = useGraph.getState().cards.find((c) => c.id === pastedId)!

    expect(pasted.id).not.toBe('note-1')
    expect(pasted.position).toEqual({ x: 500, y: 500 })
    expect(pasted).toMatchObject({ title: 'Clipboard source' })
    expect(noteFontSizeOf(pasted)).toBe(3)
    expect(pasted).not.toHaveProperty('createdBy')
    expect(pasted).not.toHaveProperty('lastModifiedBy')
    expect(useGraph.getState().cards.find((card) => card.id === 'note-1')).toMatchObject({
      createdBy: agentAuthor,
      lastModifiedBy: agentAuthor,
    })
    expect(useGraph.getState().connections).toHaveLength(1)
  })

  it('cascades repeated duplicates of the same card instead of stacking them', () => {
    const sourceId = useGraph.getState().addCard('note', { x: 0, y: 0 })

    const [firstId] = useGraph.getState().duplicateCard(sourceId)
    const [secondId] = useGraph.getState().duplicateCard(sourceId)
    const [thirdId] = useGraph.getState().duplicateCard(sourceId)

    const positions = [firstId, secondId, thirdId].map(
      (id) => useGraph.getState().cards.find((c) => c.id === id)!.position,
    )

    expect(positions[0]).toEqual({ x: 40, y: 40 })
    expect(positions[1]).toEqual({ x: 80, y: 80 })
    expect(positions[2]).toEqual({ x: 120, y: 120 })

    const seen = new Set(positions.map((p) => `${p.x}:${p.y}`))
    expect(seen.size).toBe(3)
  })
})

describe('conversation cards and versions in the graph store', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      keyPromptOpen: false,
      cardClipboard: null,
    })
  })

  it('adds a Conversation card with default Style and turns', () => {
    const id = useGraph.getState().addCard('conversation', { x: 0, y: 0 })
    const conv = useGraph.getState().cards.find((c) => c.id === id)!
    expect(conv.kind).toBe('conversation')
    expect(conv.conversationStyle).toBeTruthy()
    expect(conv.conversationTurns).toBeGreaterThanOrEqual(1)
  })

  it('clamps turns-per-participant to at least 1', () => {
    const id = useGraph.getState().addCard('conversation', { x: 0, y: 0 })
    useGraph.getState().setConversationTurns(id, 0)
    expect(useGraph.getState().cards.find((c) => c.id === id)!.conversationTurns).toBe(1)
    useGraph.getState().setConversationTurns(id, 4)
    expect(useGraph.getState().cards.find((c) => c.id === id)!.conversationTurns).toBe(4)
  })

  it('creates a Result card and a transcript version when a Conversation run begins', () => {
    useGraph.setState({
      cards: [{ id: 'conv', kind: 'conversation', blocks: [{ id: 'b', text: 'Topic' }], position: { x: 0, y: 0 } }],
    })
    const { versionId, resultCardId } = useGraph.getState().beginConversationRun('conv', {
      model: 'm',
      usedCardIds: ['conv'],
      usedConnectionIds: [],
      conversation: {
        settings: { topic: 'Topic', style: 'debate', turnsPerParticipant: 2 },
        participants: [],
        sharedContext: [],
        topLevelMods: [],
        turns: [],
      },
    })

    const result = useGraph.getState().cards.find((c) => c.id === resultCardId)
    expect(result?.kind).toBe('result')
    const output = useGraph.getState().outputs.find((o) => o.resultCardId === resultCardId)!
    expect(output.versions.find((v) => v.id === versionId)?.transcript).toEqual([])
    expect(useGraph.getState().runs.find((r) => r.producedVersionId === versionId)?.kind).toBe('conversation')
  })
})

describe('intent log instrumentation in the graph store', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      keyPromptOpen: false,
      cardClipboard: null,
    })
  })

  it('logs card creation and deletion with deleted connection snapshots', () => {
    const sourceId = useGraph.getState().addCard('note', { x: 0, y: 0 })
    const targetId = useGraph.getState().addCard('askAi', { x: 260, y: 0 })
    useGraph.getState().addConnection(sourceId, targetId)
    const connectionId = useGraph.getState().connections[0].id

    useGraph.getState().deleteCard(sourceId)

    const types = useGraph.getState().intentLog.map((event) => event.type)
    expect(types).toEqual(['card.created', 'card.created', 'connection.created', 'card.deleted'])
    const deleted = useGraph.getState().intentLog[useGraph.getState().intentLog.length - 1]
    expect(deleted?.type).toBe('card.deleted')
    if (deleted?.type === 'card.deleted') {
      expect(deleted.data.card.id).toBe(sourceId)
      expect(deleted.data.connections.map((connection) => connection.id)).toEqual([connectionId])
    }
  })

  it('treats same-order context reorders as an empty commit', () => {
    useGraph.setState({
      cards: [card('note-1', 'note', { x: 0, y: 0 }), card('ask-1', 'askAi', { x: 260, y: 0 })],
      connections: [
        connection('conn-1', 'note-1', 'ask-1', { contextOrder: 0 }),
        connection('conn-2', 'ask-1', 'note-1', { contextOrder: 1 }),
      ],
    })

    const result = useGraph.getState().reorderContextItems(['conn-1', 'conn-2'])

    expectEmptyCommit(result)
  })

  it('logs coarse content edits without coupling them to every text write', () => {
    const id = useGraph.getState().addCard('note', { x: 0, y: 0 })

    useGraph.getState().setCardText(id, 'draft text')
    expect(useGraph.getState().intentLog.map((event) => event.type)).toEqual(['card.created'])

    useGraph.getState().recordCardContentEdited(id)

    const event = useGraph.getState().intentLog[useGraph.getState().intentLog.length - 1]
    expect(event?.type).toBe('card.content.edited')
    if (event?.type === 'card.content.edited') {
      expect(event.cardId).toBe(id)
      expect(event.data).toMatchObject({ field: 'body', textLength: 'draft text'.length })
    }
  })

  it('adopts an agent-created Card on the first actual text change before the coarse edit event', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const id = 'agent-note'
    useGraph.setState({
      cards: [{ ...card(id, 'note', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy }],
    })

    useGraph.getState().setCardText(id, id)
    expect(useGraph.getState().cards.find(candidate => candidate.id === id)?.lastModifiedBy).toEqual(createdBy)

    useGraph.getState().setCardText(id, 'My revision')
    expect(useGraph.getState().cards.find(candidate => candidate.id === id)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().intentLog).toHaveLength(0)

    useGraph.getState().recordCardContentEdited(id)

    const adopted = useGraph.getState().cards.find(candidate => candidate.id === id)
    expect(adopted?.createdBy).toEqual(createdBy)
    expect(adopted?.lastModifiedBy).toMatchObject({ kind: 'user' })
  })

  it('adopts on the first changed title but not a no-op title write', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const id = 'agent-note'
    useGraph.setState({
      cards: [{
        ...card(id, 'note', { x: 0, y: 0 }),
        title: 'Agent title',
        createdBy,
        lastModifiedBy: createdBy,
      }],
    })

    useGraph.getState().setCardTitle(id, 'Agent title')
    expect(useGraph.getState().cards.find(candidate => candidate.id === id)?.lastModifiedBy).toEqual(createdBy)

    useGraph.getState().setCardTitle(id, 'My title')
    expect(useGraph.getState().cards.find(candidate => candidate.id === id)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
  })

  it('does not adopt from the coarse content event when no Card state changed', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const id = 'agent-note'
    useGraph.setState({
      cards: [{ ...card(id, 'note', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy }],
    })

    useGraph.getState().recordCardContentEdited(id)

    expect(useGraph.getState().cards.find(candidate => candidate.id === id)?.lastModifiedBy).toEqual(createdBy)
    const intentLog = useGraph.getState().intentLog
    expect(intentLog[intentLog.length - 1]?.type).toBe('card.content.edited')
  })

  it('does not adopt an Agent Mod Card for a no-op single-class Mod commit', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const id = 'agent-mod'
    const modV2 = createSeedMod('slider', {
      createId: (role, ordinal) => `${id}-${role}-${ordinal}`,
    })
    useGraph.setState({
      cards: [{
        ...card(id, 'mod', { x: 0, y: 0 }),
        modV2,
        createdBy,
        lastModifiedBy: createdBy,
      }],
    })

    expect(commitV2Mod(
      useGraph.getState(),
      id,
      structuredClone(modV2),
      'No Mod change',
    )).toBe(false)

    expect(useGraph.getState().cards.find(candidate => candidate.id === id)?.lastModifiedBy).toEqual(createdBy)
    expect(useGraph.getState().undoStack).toHaveLength(0)
  })

  it('adopts an Agent Mod Card for an actual single-class Mod change without making adoption undoable', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const id = 'agent-mod'
    const modV2 = createSeedMod('slider', {
      createId: (role, ordinal) => `${id}-${role}-${ordinal}`,
    })
    useGraph.setState({
      cards: [{
        ...card(id, 'mod', { x: 0, y: 0 }),
        modV2,
        createdBy,
        lastModifiedBy: createdBy,
      }],
    })

    const next = structuredClone(modV2)
    next.title = 'My Mod'
    expect(commitV2Mod(useGraph.getState(), id, next, 'Rename Mod')).toBe(true)

    expect(useGraph.getState().cards.find(candidate => candidate.id === id)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
      modV2: { title: 'My Mod' },
    })
    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(candidate => candidate.id === id)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
      modV2: { title: modV2.title },
    })
  })

  it.each([
    ['font size', 'note', (id: string) => useGraph.getState().setCardFontSize(id, 3)],
    ['model', 'askAi', (id: string) => useGraph.getState().setCardModel(id, 'model-b')],
    ['asset', 'note', (id: string) => useGraph.getState().addCardAssets(id, [{
      id: 'asset-1',
      kind: 'file',
      name: 'notes.txt',
      mimeType: 'text/plain',
      dataUrl: 'data:text/plain;base64,bm90ZXM=',
      size: 5,
      createdAt: '2026-07-22T00:00:00.000Z',
    }])],
    ['header style', 'note', (id: string) => useGraph.getState().setCardHeaderColor(id, '#3568c6', 'pattern')],
    ['group prompt', 'group', (id: string) => useGraph.getState().setGroupCompressionPrompt(id, 'Keep decisions.')],
    ['conversation style', 'conversation', (id: string) => useGraph.getState().setConversationStyle(id, 'critique')],
  ] as const)(
    'adopts an agent-created Card on its first user %s change',
    (_operation, kind, edit) => {
      const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
      const id = 'agent-card'
      useGraph.setState({
        cards: [{ ...card(id, kind, { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy }],
      })

      edit(id)

      expect(useGraph.getState().cards.find(candidate => candidate.id === id)).toMatchObject({
        createdBy,
        lastModifiedBy: { kind: 'user' },
      })
    },
  )

  it.each([
    ['font size', 'note', { meta: { noteFontSize: 3 } }, (id: string) => useGraph.getState().setCardFontSize(id, 3)],
    ['model', 'askAi', { model: 'model-b' }, (id: string) => useGraph.getState().setCardModel(id, 'model-b')],
    ['missing asset', 'note', {}, (id: string) => useGraph.getState().removeCardAsset(id, 'missing')],
    ['header style', 'note', { headerColor: '#3568c6', headerFill: 'pattern' }, (id: string) =>
      useGraph.getState().setCardHeaderColor(id, '#3568c6', 'pattern')],
    ['group prompt', 'group', { compressionPrompt: 'Sum it up.' }, (id: string) =>
      useGraph.getState().setGroupCompressionPrompt(id, 'Sum it up.')],
    ['conversation style', 'conversation', { conversationStyle: 'critique' }, (id: string) =>
      useGraph.getState().setConversationStyle(id, 'critique')],
  ] as const)(
    'does not adopt an Agent Card for a no-op %s request',
    (_operation, kind, overrides, edit) => {
      const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
      const id = 'agent-card'
      useGraph.setState({
        cards: [{
          ...card(id, kind, { x: 0, y: 0 }),
          ...overrides,
          createdBy,
          lastModifiedBy: createdBy,
        }],
      })

      edit(id)

      expect(useGraph.getState().cards.find(candidate => candidate.id === id)?.lastModifiedBy).toEqual(createdBy)
    },
  )

  it('adopts every Agent Card whose saved layer rank actually changes', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const id = 'agent-note'
    useGraph.setState({
      cards: [
        { ...card(id, 'note', { x: 0, y: 0 }), zIndex: 0, createdBy, lastModifiedBy: createdBy },
        { ...card('other-agent-note', 'note', { x: 300, y: 0 }), zIndex: 1, createdBy, lastModifiedBy: createdBy },
      ],
    })

    useGraph.getState().bringCardsToFront([id])

    expect(useGraph.getState().cards.find(candidate => candidate.id === id)).toMatchObject({
      zIndex: 1,
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === 'other-agent-note')).toMatchObject({
      zIndex: 0,
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
  })

  it('does not adopt an Agent Card for a no-op layer request', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const id = 'agent-note'
    useGraph.setState({
      cards: [
        { ...card(id, 'note', { x: 0, y: 0 }), zIndex: 1, createdBy, lastModifiedBy: createdBy },
        { ...card('user-note', 'note', { x: 300, y: 0 }), zIndex: 0 },
      ],
    })

    useGraph.getState().bringCardsToFront([id])

    expect(useGraph.getState().cards.find(candidate => candidate.id === id)?.lastModifiedBy).toEqual(createdBy)
  })

  it('adopts Agent Cards when a layer request normalizes sparse stored z-indexes without changing rank', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    useGraph.setState({
      cards: [
        { ...card('agent-note-back', 'note', { x: 0, y: 0 }), zIndex: 10, createdBy, lastModifiedBy: createdBy },
        { ...card('agent-note-front', 'note', { x: 300, y: 0 }), zIndex: 20, createdBy, lastModifiedBy: createdBy },
      ],
    })

    useGraph.getState().bringCardsToFront(['agent-note-front'])

    expect(useGraph.getState().cards.find(candidate => candidate.id === 'agent-note-back')).toMatchObject({
      zIndex: 0,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === 'agent-note-front')).toMatchObject({
      zIndex: 1,
      lastModifiedBy: { kind: 'user' },
    })
  })

  it('adopts both Agent Groups when a member transfers between them', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const oldGroupId = 'agent-group-old'
    const newGroupId = 'agent-group-new'
    const cardId = 'agent-note'
    useGraph.setState({
      cards: [
        { ...card(oldGroupId, 'group', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy },
        { ...card(newGroupId, 'group', { x: 600, y: 0 }), createdBy, lastModifiedBy: createdBy },
        { ...card(cardId, 'note', { x: 40, y: 40 }, oldGroupId), createdBy, lastModifiedBy: createdBy },
      ],
    })

    useGraph.getState().addCardToGroup(cardId, newGroupId)

    expect(useGraph.getState().cards.find(candidate => candidate.id === cardId)).toMatchObject({
      groupId: newGroupId,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === oldGroupId)?.lastModifiedBy)
      .toMatchObject({ kind: 'user' })
    expect(useGraph.getState().cards.find(candidate => candidate.id === newGroupId)?.lastModifiedBy)
      .toMatchObject({ kind: 'user' })

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(candidate => candidate.id === cardId)?.groupId).toBe(oldGroupId)
    expect(useGraph.getState().cards.find(candidate => candidate.id === oldGroupId)?.lastModifiedBy)
      .toMatchObject({ kind: 'user' })
    expect(useGraph.getState().cards.find(candidate => candidate.id === newGroupId)?.lastModifiedBy)
      .toMatchObject({ kind: 'user' })
  })

  it.each([
    ['move', (id: string) => useGraph.getState().moveCard(id, { x: 80, y: 60 })],
    ['resize', (id: string) => useGraph.getState().setCardSize(id, { width: 300, height: 200 })],
  ] as const)(
    'does not adopt an unchanged Agent Group when a member %s stays inside it',
    (_case, edit) => {
      const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
      const groupId = 'agent-group'
      const cardId = 'agent-note'
      useGraph.setState({
        cards: [
          {
            ...card(groupId, 'group', { x: 0, y: 0 }),
            size: { width: 720, height: 520 },
            createdBy,
            lastModifiedBy: createdBy,
          },
          { ...card(cardId, 'note', { x: 40, y: 40 }, groupId), createdBy, lastModifiedBy: createdBy },
        ],
      })

      edit(cardId)

      expect(useGraph.getState().cards.find(candidate => candidate.id === cardId)?.lastModifiedBy)
        .toMatchObject({ kind: 'user' })
      expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)?.lastModifiedBy)
        .toEqual(createdBy)
    },
  )

  it('adopts an Agent Group when a newly created Card lands inside it', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const groupId = 'agent-group'
    useGraph.setState({
      cards: [{ ...card(groupId, 'group', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy }],
    })

    const cardId = useGraph.getState().addCard('note', { x: 40, y: 40 })

    expect(useGraph.getState().cards.find(candidate => candidate.id === cardId)?.groupId).toBe(groupId)
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)?.lastModifiedBy)
      .toMatchObject({ kind: 'user' })
  })

  it('adopts an external Agent Group when a member is duplicated into it', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const groupId = 'agent-group'
    const sourceId = 'source-note'
    useGraph.setState({
      cards: [
        {
          ...card(groupId, 'group', { x: 0, y: 0 }),
          size: { width: 720, height: 520 },
          createdBy,
          lastModifiedBy: createdBy,
        },
        card(sourceId, 'note', { x: 40, y: 40 }, groupId),
      ],
    })

    const [copyId] = useGraph.getState().duplicateCard(sourceId)

    expect(useGraph.getState().cards.find(candidate => candidate.id === copyId)?.groupId).toBe(groupId)
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)?.lastModifiedBy)
      .toMatchObject({ kind: 'user' })
    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(candidate => candidate.id === copyId)).toBeUndefined()
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)?.lastModifiedBy)
      .toMatchObject({ kind: 'user' })
  })

  it.each([
    ['library Mod', () => useGraph.getState().addModFromLibrary('builtin-mod-slider', { x: 40, y: 40 })],
    ['version note', () => useGraph.getState().createVersionNote(
      'missing-version',
      'Saved excerpt',
      { x: 40, y: 40 },
      'version',
    )],
  ] as const)('adopts an Agent Group when a new %s lands inside it', (_case, create) => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const groupId = 'agent-group'
    useGraph.setState({
      cards: [{ ...card(groupId, 'group', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy }],
    })

    const createdId = create()

    expect(createdId).toBeTruthy()
    expect(useGraph.getState().cards.find(candidate => candidate.id === createdId)?.groupId).toBe(groupId)
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)?.lastModifiedBy)
      .toMatchObject({ kind: 'user' })
  })

  it('keeps Card and Group adoption outside undo when membership changes', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const groupId = 'agent-group'
    const cardId = 'agent-note'
    useGraph.setState({
      cards: [
        { ...card(groupId, 'group', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy },
        { ...card(cardId, 'note', { x: 520, y: 20 }), createdBy, lastModifiedBy: createdBy },
      ],
    })

    useGraph.getState().addCardToGroup(cardId, groupId)

    expect(useGraph.getState().cards.find(candidate => candidate.id === cardId)).toMatchObject({
      groupId,
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(candidate => candidate.id === cardId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === cardId)?.groupId).toBeUndefined()
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
  })

  it('adopts both the addressed Card and Group when the user removes membership', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const groupId = 'agent-group'
    const cardId = 'agent-note'
    useGraph.setState({
      cards: [
        { ...card(groupId, 'group', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy },
        { ...card(cardId, 'note', { x: 20, y: 20 }, groupId), createdBy, lastModifiedBy: createdBy },
      ],
    })

    useGraph.getState().removeCardFromGroup(cardId)

    expect(useGraph.getState().cards.find(candidate => candidate.id === cardId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(candidate => candidate.id === cardId)).toMatchObject({
      groupId,
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
  })

  it('adopts surviving members before deleting an Agent Group and keeps that adoption through undo', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const groupId = 'agent-group'
    const memberId = 'agent-note'
    useGraph.setState({
      cards: [
        { ...card(groupId, 'group', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy },
        { ...card(memberId, 'note', { x: 20, y: 20 }, groupId), createdBy, lastModifiedBy: createdBy },
      ],
    })

    useGraph.getState().deleteCard(groupId)

    expect(useGraph.getState().cards.find(candidate => candidate.id === memberId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === memberId)?.groupId).toBeUndefined()

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(candidate => candidate.id === memberId)).toMatchObject({
      groupId,
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
  })

  it('adopts the surviving Agent Group before deleting a member and keeps that adoption through undo', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const groupId = 'agent-group'
    const memberId = 'agent-note'
    useGraph.setState({
      cards: [
        { ...card(groupId, 'group', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy },
        { ...card(memberId, 'note', { x: 20, y: 20 }, groupId), createdBy, lastModifiedBy: createdBy },
      ],
    })

    useGraph.getState().deleteCard(memberId)

    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === memberId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
  })

  it('adopts only the Group for a real member reorder and keeps adoption through undo', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const groupId = 'agent-group'
    const firstId = 'agent-note-a'
    const secondId = 'agent-note-b'
    useGraph.setState({
      cards: [
        { ...card(groupId, 'group', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy },
        { ...card(firstId, 'note', { x: 20, y: 20 }, groupId), createdBy, lastModifiedBy: createdBy },
        { ...card(secondId, 'note', { x: 180, y: 20 }, groupId), createdBy, lastModifiedBy: createdBy },
      ],
    })

    useGraph.getState().reorderGroupMembers(groupId, [secondId, firstId])

    expect(membersOf(useGraph.getState().snapshot(), groupId).map((member) => member.id))
      .toEqual([secondId, firstId])
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
    expect(useGraph.getState().cards.find(candidate => candidate.id === firstId)?.lastModifiedBy).toEqual(createdBy)
    expect(useGraph.getState().cards.find(candidate => candidate.id === secondId)?.lastModifiedBy).toEqual(createdBy)

    useGraph.getState().undo()
    expect(membersOf(useGraph.getState().snapshot(), groupId).map((member) => member.id))
      .toEqual([firstId, secondId])
    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)?.lastModifiedBy)
      .toMatchObject({ kind: 'user' })
  })

  it('does not adopt a Group for a no-op member reorder', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const groupId = 'agent-group'
    const firstId = 'agent-note-a'
    const secondId = 'agent-note-b'
    useGraph.setState({
      cards: [
        { ...card(groupId, 'group', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy },
        { ...card(firstId, 'note', { x: 20, y: 20 }, groupId), createdBy, lastModifiedBy: createdBy },
        { ...card(secondId, 'note', { x: 180, y: 20 }, groupId), createdBy, lastModifiedBy: createdBy },
      ],
    })

    useGraph.getState().reorderGroupMembers(groupId, [firstId, secondId])

    expect(useGraph.getState().cards.find(candidate => candidate.id === groupId)?.lastModifiedBy).toEqual(createdBy)
    expect(useGraph.getState().undoStack).toHaveLength(0)
  })

  it.each([
    ['move', (id: string) => useGraph.getState().moveCard(id, { x: 80, y: 40 })],
    ['resize', (id: string) => useGraph.getState().setCardSize(id, { width: 360, height: 220 })],
  ] as const)('adopts an agent-created Card on its first completed user %s', (_operation, edit) => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const id = 'agent-note'
    useGraph.setState({
      cards: [{ ...card(id, 'note', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy }],
    })

    edit(id)

    expect(useGraph.getState().cards.find(candidate => candidate.id === id)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(candidate => candidate.id === id)).toMatchObject({
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
  })

  it('adopts an agent-created Card when a transient structural gesture completes', () => {
    const createdBy = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const id = 'agent-note'
    useGraph.setState({
      cards: [{ ...card(id, 'note', { x: 0, y: 0 }), createdBy, lastModifiedBy: createdBy }],
    })
    const beforeCards = useGraph.getState().cards

    useGraph.getState().moveCard(id, { x: 80, y: 40 }, { recordHistory: false })
    const afterCards = useGraph.getState().cards
    expect(afterCards.find(candidate => candidate.id === id)?.lastModifiedBy).toEqual(createdBy)
    useGraph.getState().recordCardStructuralChange('moveCard', beforeCards, afterCards)

    expect(useGraph.getState().cards.find(candidate => candidate.id === id)).toMatchObject({
      position: { x: 80, y: 40 },
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })

    useGraph.getState().undo()
    expect(useGraph.getState().cards.find(candidate => candidate.id === id)).toMatchObject({
      position: { x: 0, y: 0 },
      createdBy,
      lastModifiedBy: { kind: 'user' },
    })
  })

  it('logs group compression as a semantic companion to run events', () => {
    const groupId = useGraph.getState().addCard('group', { x: 0, y: 0 })
    const { runId } = useGraph.getState().beginGroupDigestRun(groupId, {
      text: 'Compress',
      model: 'model',
      usedCardIds: [groupId],
      usedConnectionIds: [],
      digestKey: 'digest-key',
    })

    expect(useGraph.getState().intentLog.map((event) => event.type)).toContain('group.compression.started')

    useGraph.getState().finishRun(runId)

    expect(useGraph.getState().intentLog.map((event) => event.type)).toContain('group.compression.completed')
  })
})

describe('result follow-up threads in the graph store', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      keyPromptOpen: false,
      cardClipboard: null,
    })
  })

  function message(id: string, text: string): FollowUpMessage {
    return {
      id,
      role: 'user',
      text,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: 'complete',
    }
  }

  it('treats re-choosing the chosen output version as an empty commit', () => {
    useGraph.setState({
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'v1',
          versions: [
            { id: 'v1', number: 1, text: 'first', createdAt: '2026-01-01T00:00:00.000Z', fromRunId: 'r1', accepted: true },
            { id: 'v2', number: 2, text: 'second', createdAt: '2026-01-02T00:00:00.000Z', fromRunId: 'r2' },
          ],
        },
      ],
    })

    const result = useGraph.getState().chooseVersion('out', 'v1')

    expectEmptyCommit(result)
  })

  it('keeps viewing and acceptance independent, including the currently viewed version', () => {
    useGraph.setState({
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'v1',
          versions: [
            { id: 'v1', number: 1, text: 'first', createdAt: '2026-01-01T00:00:00.000Z', fromRunId: 'r1', accepted: true },
            { id: 'v2', number: 2, text: 'second', createdAt: '2026-01-02T00:00:00.000Z', fromRunId: 'r2' },
          ],
        },
      ],
    })

    useGraph.getState().chooseVersion('out', 'v2')

    let output = useGraph.getState().snapshot().outputs[0]
    expect(output.chosenVersionId).toBe('v2')
    expect(output.versions.map((version) => version.accepted)).toEqual([true, undefined])

    const undoCount = useGraph.getState().undoStack.length
    const intentCount = useGraph.getState().intentLog.length
    expect(useGraph.getState().chooseVersion('out', 'v2')).toEqual({ commitId: null, changed: false })
    expect(useGraph.getState().undoStack).toHaveLength(undoCount)
    expect(useGraph.getState().intentLog).toHaveLength(intentCount)

    const accepted = useGraph.getState().setVersionAccepted('out', 'v2', true)

    output = useGraph.getState().snapshot().outputs[0]
    expect(accepted.changed).toBe(true)
    expect(output.chosenVersionId).toBe('v2')
    expect(output.versions.find((version) => version.id === 'v2')?.accepted).toBe(true)
    expect(useGraph.getState().intentLog).toHaveLength(intentCount)
    expect(useGraph.getState().undoStack).toHaveLength(undoCount + 1)
    expect(useGraph.getState().lastBoardChange).toMatchObject({
      source: 'commit',
      change: { outputs: { updated: ['out'] } },
    })

    useGraph.getState().setVersionAccepted('out', 'v2')

    output = useGraph.getState().snapshot().outputs[0]
    expect(output.chosenVersionId).toBe('v2')
    expect(output.versions.find((version) => version.id === 'v2')?.accepted).toBe(false)
  })

  it('stores follow-up threads on each output version independently', () => {
    useGraph.setState({
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'v2',
          versions: [
            { id: 'v1', number: 1, text: 'first', createdAt: '2026-01-01T00:00:00.000Z', fromRunId: 'r1' },
            { id: 'v2', number: 2, text: 'second', createdAt: '2026-01-02T00:00:00.000Z', fromRunId: 'r2' },
          ],
        },
      ],
    })

    useGraph.getState().appendFollowUpMessage('v1', message('m1', 'follow first'))
    useGraph.getState().appendFollowUpMessage('v2', message('m2', 'follow second'))
    useGraph.getState().setFollowUpCollapsed('v1', true)

    const versions = useGraph.getState().snapshot().outputs[0].versions
    expect(versions.find((v) => v.id === 'v1')?.followUpThread).toMatchObject({
      collapsed: true,
      messages: [{ id: 'm1', text: 'follow first' }],
    })
    expect(versions.find((v) => v.id === 'v2')?.followUpThread).toMatchObject({
      collapsed: false,
      messages: [{ id: 'm2', text: 'follow second' }],
    })
  })

  it('clears a version thread without deleting the original version', () => {
    useGraph.setState({
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'v1',
          versions: [
            {
              id: 'v1',
              number: 1,
              text: 'keep me',
              createdAt: '2026-01-01T00:00:00.000Z',
              fromRunId: 'r1',
              followUpThread: { collapsed: false, messages: [message('m1', 'clear me')] },
            },
          ],
        },
      ],
    })

    useGraph.getState().clearFollowUpThread('v1')

    const version = useGraph.getState().snapshot().outputs[0].versions[0]
    expect(version.text).toBe('keep me')
    expect(version.followUpThread).toEqual({ collapsed: false, messages: [] })
  })

  it('logs follow-up messages at message boundaries', () => {
    useGraph.setState({
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'v1',
          versions: [{ id: 'v1', number: 1, text: 'answer', createdAt: '2026-01-01T00:00:00.000Z', fromRunId: 'r1' }],
        },
      ],
    })
    const assistant: FollowUpMessage = {
      id: 'm2',
      role: 'assistant',
      text: '',
      createdAt: '2026-01-01T00:00:01.000Z',
      status: 'streaming',
    }

    useGraph.getState().appendFollowUpMessage('v1', message('m1', 'question'))
    useGraph.getState().appendFollowUpMessage('v1', assistant)
    useGraph.getState().appendFollowUpChunk('v1', 'm2', 'reply')
    useGraph.getState().finishFollowUpMessage('v1', 'm2', 'complete')

    const events = useGraph.getState().intentLog
    expect(events.map((event) => event.type)).toEqual([
      'followup.message.added',
      'followup.message.added',
      'followup.message.finished',
    ])
    const finished = events[events.length - 1]
    expect(finished?.type).toBe('followup.message.finished')
    if (finished?.type === 'followup.message.finished') {
      expect(finished.data).toMatchObject({
        outputId: 'out',
        resultCardId: 'result',
        message: { id: 'm2', text: 'reply', status: 'complete' },
      })
    }
  })

  it('treats finishing an unknown follow-up message as an empty commit', () => {
    useGraph.setState({
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'v1',
          versions: [
            {
              id: 'v1',
              number: 1,
              text: 'answer',
              createdAt: '2026-01-01T00:00:00.000Z',
              fromRunId: 'r1',
              followUpThread: { collapsed: false, messages: [message('m1', 'known')] },
            },
          ],
        },
      ],
    })

    const result = useGraph.getState().finishFollowUpMessage('v1', 'missing', 'complete')

    expectEmptyCommit(result)
  })

  it('treats clearing an already-empty follow-up thread as an empty commit', () => {
    useGraph.setState({
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'v1',
          versions: [
            {
              id: 'v1',
              number: 1,
              text: 'answer',
              createdAt: '2026-01-01T00:00:00.000Z',
              fromRunId: 'r1',
              followUpThread: { collapsed: false, messages: [] },
            },
          ],
        },
      ],
    })

    const result = useGraph.getState().clearFollowUpThread('v1')

    expectEmptyCommit(result)
  })

  it('logs follow-up clearing and version-to-note conversion', () => {
    useGraph.setState({
      cards: [card('result', 'result', { x: 0, y: 0 })],
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'v1',
          versions: [
            {
              id: 'v1',
              number: 1,
              text: 'answer',
              createdAt: '2026-01-01T00:00:00.000Z',
              fromRunId: 'r1',
              followUpThread: { collapsed: false, messages: [message('m1', 'clear me')] },
            },
          ],
        },
      ],
    })

    useGraph.getState().clearFollowUpThread('v1')
    const noteId = useGraph.getState().createVersionNote('v1', 'answer', { x: 300, y: 0 }, 'version')

    expect(useGraph.getState().intentLog.map((event) => event.type)).toEqual([
      'followup.thread.cleared',
      'card.created',
      'version.note.created',
    ])
    const conversion = useGraph.getState().intentLog[useGraph.getState().intentLog.length - 1]
    expect(conversion?.type).toBe('version.note.created')
    if (conversion?.type === 'version.note.created') {
      expect(conversion.data).toMatchObject({
        outputId: 'out',
        resultCardId: 'result',
        noteCardId: noteId,
        source: 'version',
        textLength: 'answer'.length,
      })
    }
  })

  it('refuses to create an empty Note from a Result or follow-up', () => {
    useGraph.setState({
      cards: [card('result', 'result', { x: 0, y: 0 })],
      outputs: [],
      intentLog: [],
    })

    const noteId = useGraph.getState().createVersionNote(
      'missing-version',
      ' \n ',
      { x: 300, y: 0 },
      'version',
    )

    expect(noteId).toBeNull()
    expect(useGraph.getState().cards).toHaveLength(1)
    expect(useGraph.getState().intentLog).toHaveLength(0)
  })
})

describe('board-level AI settings in the graph store', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      keyPromptOpen: false,
      cardClipboard: null,
      settings: {
        apiKey: 'local-secret-key',
        model: 'anthropic/claude-3.5-sonnet',
        models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o-mini'],
        reasoningEffort: 'high',
      },
    })
  })

  it('saves AI preferences in the board snapshot without the local API key', () => {
    const snapshot = useGraph.getState().snapshot()

    expect(snapshot.aiSettings).toMatchObject({
      provider: 'openrouter',
      model: 'anthropic/claude-3.5-sonnet',
      models: ['anthropic/claude-3.5-sonnet'],
      reasoningEffort: 'high',
      chainConfirmThreshold: 2,
      compactionMode: 'when-needed',
    })
    expect(snapshot.aiSettings?.providerModels?.openrouter).toEqual({
      model: 'anthropic/claude-3.5-sonnet',
      models: ['anthropic/claude-3.5-sonnet'],
    })
    expect('apiKey' in snapshot.aiSettings!).toBe(false)
    expect(JSON.stringify(snapshot)).not.toContain('local-secret-key')
  })
})

describe('graph() derived lookups in the graph store', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      keyPromptOpen: false,
      cardClipboard: null,
    })
  })

  it('returns the same index object between commits and fresh answers after a mutation', () => {
    const state = useGraph.getState()
    const noteId = state.addCard('note', { x: 0, y: 0 })
    const askId = state.addCard('askAi', { x: 400, y: 0 })
    useGraph.getState().addConnection(noteId, askId)

    const before = useGraph.getState().graph()
    expect(before.cardById(noteId)?.id).toBe(noteId)
    expect(before.incomingConnections(askId)).toHaveLength(1)
    expect(useGraph.getState().graph()).toBe(before)

    useGraph.getState().moveCard(noteId, { x: 50, y: 50 }, { recordHistory: false })
    const after = useGraph.getState().graph()
    expect(after).not.toBe(before)
    expect(after.cardById(noteId)?.position).toEqual({ x: 50, y: 50 })
    expect(after.incomingConnections(askId)).toHaveLength(1)
  })
})
