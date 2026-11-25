import { beforeEach, describe, expect, it } from 'vitest'
import { createSourceContextSnapshot } from '../brain/sourceContext'
import { createCompleteProfileFixture } from '../persistence/fixtures/profileLogicalProjectionFixture'
import { captureProfileGuiInertJson } from '../persistence/profileGuiSaveScheduler'
import { projectProfileSnapshot } from '../persistence/profileLogicalProjection'
import { commitV2Mod } from '../mods/commit'
import { resetGraphPersistenceForTests, useGraph } from './store'
import type { Card, Connection } from './types'

function card(id: string, kind: Card['kind'], extra: Partial<Card> = {}): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text: '' }],
    position: { x: 0, y: 0 },
    ...extra,
  }
}

function connection(extra: Partial<Connection> = {}): Connection {
  return {
    id: 'connection-1',
    from: { cardId: 'note-1' },
    to: { cardId: 'ask-1' },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    ...extra,
  }
}

function assertJsonSafe(): void {
  const board = captureProfileGuiInertJson(useGraph.getState().snapshot(), '$board')
  const fixture = createCompleteProfileFixture()
  const idea = fixture.snapshot.ideas.find((candidate) => candidate.id === 'idea-main')!
  expect(() => projectProfileSnapshot({
    ...fixture.snapshot,
    activeIdeaId: idea.id,
    ideas: [idea],
    boards: { [idea.id]: board },
    modInstances: [],
  }, fixture.projectAsset)).not.toThrow()
}

function assertCaptureSafe(): void {
  expect(() => captureProfileGuiInertJson(useGraph.getState().snapshot(), '$board'))
    .not.toThrow()
}

describe('store snapshots stay strict-JSON-compatible for packaged Profiles', () => {
  beforeEach(() => {
    resetGraphPersistenceForTests()
    useGraph.setState({
      cards: [],
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
      hydrated: false,
      currentIdeaId: null,
      saveState: 'saved',
    })
  })

  it('duplicates and pastes ungrouped connected cards', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection()],
    })
    useGraph.getState().duplicateCards(['note-1', 'ask-1'], { cloneConnections: true })
    useGraph.getState().copyCards(['note-1', 'ask-1'])
    useGraph.getState().pasteCards({ x: 300, y: 200 })
    assertJsonSafe()
  })

  it('removes group membership and deletes a group', () => {
    useGraph.setState({
      cards: [
        card('group-1', 'group', { size: { width: 400, height: 300 } }),
        card('note-1', 'note', { groupId: 'group-1' }),
        card('note-2', 'note', { groupId: 'group-1' }),
      ],
    })
    useGraph.getState().removeCardFromGroup('note-1')
    useGraph.getState().deleteCard('group-1')
    assertJsonSafe()
  })

  it('clears optional card chrome and connection reasons', () => {
    useGraph.setState({
      cards: [card('note-1', 'note'), card('ask-1', 'askAi')],
      connections: [connection({ reason: 'Earlier direction' })],
    })
    useGraph.getState().setCardHeaderColor('note-1', 'ochre', 'half')
    useGraph.getState().setCardHeaderColor('note-1')
    useGraph.getState().setConnectionReason('connection-1', undefined)
    assertJsonSafe()
  })

  it('records ungrouped movement and auto-to-fixed resize events', () => {
    const before = card('note-1', 'note')
    const after = { ...before, position: { x: 20, y: 30 }, size: { width: 320, height: 240 } }
    useGraph.setState({ cards: [after] })
    useGraph.getState().recordCardStructuralChange('moveCard', [before], [after])
    assertJsonSafe()
  })

  it('persists failed, canceled, and planned Ask runs', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })
    const failed = useGraph.getState().beginRun('ask-1', {
      text: 'Prompt',
      model: 'synthetic/model',
      usedCardIds: ['ask-1'],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
    })
    useGraph.getState().failRun(failed.runId, 'synthetic failure')
    const canceled = useGraph.getState().beginRun('ask-1', {
      text: 'Prompt',
      model: 'synthetic/model',
      usedCardIds: ['ask-1'],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
    })
    useGraph.getState().cancelRun(canceled.runId)
    const planned = useGraph.getState().beginRun('ask-1', {
      text: 'Prompt',
      model: 'synthetic/model',
      usedCardIds: ['ask-1'],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      plan: {
        version: 1,
        rootCardId: 'ask-1',
        steps: [{ id: 'step-1', kind: 'ask', cardId: 'ask-1', dependsOn: [] }],
      },
    })
    useGraph.getState().finishRun(planned.runId)
    assertJsonSafe()
  })

  it('continues a canceled conversation and creates a note from its version', () => {
    useGraph.setState({ cards: [card('conversation-1', 'conversation')] })
    const provenance = {
      settings: { topic: 'Topic', style: 'debate' as const, turnsPerParticipant: 1 },
      participants: [],
      sharedContext: [],
      topLevelMods: [],
      turns: [],
    }
    const conversationModel = useGraph.getState().settings.model
    const begun = useGraph.getState().beginConversationRun('conversation-1', {
      model: conversationModel,
      usedCardIds: ['conversation-1'],
      usedConnectionIds: [],
      conversation: provenance,
    })
    useGraph.getState().cancelConversationRun(begun.runId)
    useGraph.getState().continueConversationRun('conversation-1', begun.versionId, provenance)
    useGraph.getState().createVersionNote(
      begun.versionId,
      'Saved answer',
      { x: 300, y: 200 },
      'version',
    )
    assertJsonSafe()
  })

  it('captures every card kind, v2 Mod, connection option, asset, and highlight', () => {
    const kinds = ['note', 'askAi', 'result', 'mod', 'group', 'conversation', 'title'] as const
    const ids = Object.fromEntries(kinds.map((kind, index) => [
      kind,
      useGraph.getState().addCard(kind, { x: index * 500, y: index * 300 }),
    ])) as Record<(typeof kinds)[number], string>

    useGraph.getState().setCardTitle(ids.note, 'Named note')
    useGraph.getState().setCardText(ids.note, 'Serializable note text')
    useGraph.getState().setCardFontSize(ids.note, 3)
    useGraph.getState().setCardHeaderColor(ids.note, 'ochre', 'pattern')
    useGraph.getState().setCardModel(ids.askAi, 'synthetic/model')
    useGraph.getState().setGroupCompressionPrompt(ids.group, 'Keep the decision')
    useGraph.getState().setConversationStyle(ids.conversation, 'collaborate')
    useGraph.getState().setConversationTurns(ids.conversation, 4)
    useGraph.getState().addCardAssets(ids.note, [{
      id: 'asset-1',
      kind: 'file',
      name: 'synthetic.txt',
      mimeType: 'text/plain',
      dataUrl: 'data:text/plain;base64,c3ludGhldGlj',
      size: 9,
      createdAt: '2026-07-22T00:00:00.000Z',
    }])

    const mod = structuredClone(useGraph.getState().graph().cardById(ids.mod)!.modV2!)
    mod.title = 'Serializable Mod'
    commitV2Mod(useGraph.getState(), ids.mod, mod, 'Rename Mod')

    useGraph.getState().addConnection(ids.note, ids.askAi)
    useGraph.getState().addConnection(ids.group, ids.askAi)
    const groupConnection = useGraph.getState().connections.find((candidate) => candidate.from.cardId === ids.group)!
    useGraph.getState().setConnectionGroupMode(groupConnection.id, 'compress')
    useGraph.getState().setConnectionStrength(groupConnection.id, 'weak')
    useGraph.getState().setConnectionReason(groupConnection.id, 'Earlier direction')
    useGraph.getState().setConnectionPolarity(groupConnection.id, 'pushesAgainst')
    useGraph.getState().reorderContextItems(useGraph.getState().connections.map((candidate) => candidate.id))

    const tagId = useGraph.getState().createHighlightTag('Important')
    useGraph.getState().setHighlightTagColor(tagId, 'yellow')
    useGraph.getState().addHighlight({ cardId: ids.note, text: 'Serializable', occurrence: 0 })
    assertCaptureSafe()
  })

  it('captures follow-ups, transcripts, and every run terminal shape', () => {
    const ask = card('ask-1', 'askAi')
    const conversation = card('conversation-1', 'conversation')
    const group = card('group-1', 'group')
    useGraph.setState({ cards: [ask, conversation, group] })
    const sourceContext = createSourceContextSnapshot(useGraph.getState().snapshot(), [{ cardId: ask.id }])
    const askRun = useGraph.getState().beginRun(ask.id, {
      text: 'Prompt',
      model: 'synthetic/model',
      usedCardIds: [ask.id],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      sourceContext,
    })
    useGraph.getState().appendVersionText(askRun.versionId, 'Answer')
    useGraph.getState().finishRun(askRun.runId)
    useGraph.getState().appendFollowUpMessage(askRun.versionId, {
      id: 'follow-up-1',
      role: 'user',
      text: 'Why?',
      createdAt: '2026-07-22T00:00:00.000Z',
      status: 'complete',
    })
    useGraph.getState().appendFollowUpMessage(askRun.versionId, {
      id: 'follow-up-2',
      role: 'assistant',
      text: '',
      createdAt: '2026-07-22T00:00:01.000Z',
      status: 'streaming',
    })
    useGraph.getState().appendFollowUpChunk(askRun.versionId, 'follow-up-2', 'Because.')
    useGraph.getState().finishFollowUpMessage(askRun.versionId, 'follow-up-2', 'complete')
    useGraph.getState().setFollowUpCollapsed(askRun.versionId, true)

    const provenance = {
      settings: { topic: 'Topic', style: 'critique' as const, turnsPerParticipant: 1 },
      participants: [{ cardId: ask.id, name: 'Analyst', model: 'synthetic/model', role: 'Critique' }],
      sharedContext: [],
      topLevelMods: [],
      turns: [],
    }
    const conversationRun = useGraph.getState().beginConversationRun(conversation.id, {
      model: 'synthetic/model',
      usedCardIds: [conversation.id, ask.id],
      usedConnectionIds: [],
      conversation: provenance,
      sourceContext: createSourceContextSnapshot(useGraph.getState().snapshot(), [{ cardId: conversation.id }]),
    })
    useGraph.getState().appendTranscriptMessage(conversationRun.versionId, {
      id: 'transcript-1',
      speakerKind: 'participant',
      speakerName: 'Analyst',
      participantCardId: ask.id,
      text: '',
      turnNumber: 1,
      streaming: true,
    })
    useGraph.getState().appendTranscriptChunk(conversationRun.versionId, 'transcript-1', 'Critique')
    useGraph.getState().finishTranscriptMessage(conversationRun.versionId, 'transcript-1')
    useGraph.getState().recordConversationTurn(conversationRun.runId, {
      speakerName: 'Analyst',
      participantCardId: ask.id,
      currentTurn: 1,
      totalTurns: 1,
      instruction: 'Critique',
    })
    useGraph.getState().finishConversationRun(conversationRun.runId)

    const digestRun = useGraph.getState().beginGroupDigestRun(group.id, {
      text: 'Compress',
      model: 'synthetic/model',
      usedCardIds: [group.id],
      usedConnectionIds: [],
      digestKey: 'digest-key',
      sourceContext: createSourceContextSnapshot(useGraph.getState().snapshot(), [{ cardId: group.id }]),
    })
    useGraph.getState().cancelRun(digestRun.runId)
    assertJsonSafe()
  })

  it('keeps cleanup, history, and optional-field mutations strict-JSON-compatible', () => {
    const noteId = useGraph.getState().addCard('note', { x: 0, y: 0 })
    const askId = useGraph.getState().addCard('askAi', { x: 500, y: 0 })
    const assertAfter = (mutate: () => unknown) => {
      mutate()
      assertJsonSafe()
    }

    useGraph.getState().addCardAssets(noteId, [{
      id: 'asset-cleanup',
      kind: 'file',
      name: 'cleanup.txt',
      mimeType: 'text/plain',
      dataUrl: 'data:text/plain;base64,Y2xlYW51cA==',
      size: 7,
      createdAt: '2026-07-22T00:00:00.000Z',
    }])
    assertCaptureSafe()
    assertAfter(() => useGraph.getState().removeCardAsset(noteId, 'asset-cleanup'))
    assertAfter(() => useGraph.getState().moveCards([
      { id: noteId, position: { x: 40, y: 60 } },
      { id: askId, position: { x: 540, y: 60 } },
    ]))
    assertAfter(() => useGraph.getState().setCardSize(noteId, { width: 360, height: 220 }))
    assertAfter(() => useGraph.getState().bringCardsToFront([noteId, askId]))
    assertAfter(() => useGraph.getState().sendCardsToBack([noteId]))
    assertAfter(() => useGraph.getState().undo())
    assertAfter(() => useGraph.getState().redo())

    const groupId = useGraph.getState().createGroupFromSelection([noteId, askId])!
    assertJsonSafe()
    assertAfter(() => useGraph.getState().reorderGroupMembers(groupId, [askId, noteId]))
    assertAfter(() => useGraph.getState().removeCardFromGroup(noteId))
    assertAfter(() => useGraph.getState().addCardToGroup(noteId, groupId))

    assertAfter(() => useGraph.getState().addConnection(noteId, askId))
    const connectionId = useGraph.getState().connections.find((candidate) => (
      candidate.from.cardId === noteId && candidate.to.cardId === askId
    ))!.id
    assertAfter(() => useGraph.getState().setConnectionReason(connectionId, 'Temporary reason'))
    assertAfter(() => useGraph.getState().setConnectionPolarity(connectionId, 'pushesAgainst'))
    assertAfter(() => useGraph.getState().setConnectionReason(connectionId, undefined))
    assertAfter(() => useGraph.getState().deleteConnections([connectionId]))

    const modId = useGraph.getState().addCard('mod', { x: 0, y: 400 })
    assertCaptureSafe()
    const assertCaptureAfter = (mutate: () => unknown) => {
      mutate()
      assertCaptureSafe()
    }
    const nextMod = structuredClone(useGraph.getState().graph().cardById(modId)!.modV2!)
    nextMod.title = 'Captured v2 Mod'
    assertCaptureAfter(() => commitV2Mod(useGraph.getState(), modId, nextMod, 'Rename Mod'))
    assertAfter(() => useGraph.getState().deleteCard(modId))

    const tagId = useGraph.getState().createHighlightTag('Temporary')
    assertJsonSafe()
    assertAfter(() => useGraph.getState().renameHighlightTag(tagId, 'Renamed'))
    const highlightId = useGraph.getState().addHighlight({
      cardId: noteId,
      text: '',
      occurrence: 0,
    })
    expect(highlightId).toBeNull()
    assertJsonSafe()
    useGraph.getState().setCardText(noteId, 'Highlight target')
    const savedHighlightId = useGraph.getState().addHighlight({
      cardId: noteId,
      text: 'Highlight',
      occurrence: 0,
    })!
    assertJsonSafe()
    assertAfter(() => useGraph.getState().createNoteFromHighlight(savedHighlightId))
    assertAfter(() => useGraph.getState().removeHighlight(savedHighlightId))
    assertAfter(() => useGraph.getState().deleteHighlightTag(tagId))

    assertAfter(() => useGraph.getState().recordCompactionSummary({
      cardId: noteId,
      fingerprint: 'synthetic-fingerprint',
      summary: 'Synthetic summary',
      model: 'synthetic/model',
      createdAt: '2026-07-22T00:00:00.000Z',
    }))

    const run = useGraph.getState().beginRun(askId, {
      text: 'Prompt',
      model: 'synthetic/model',
      usedCardIds: [askId],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
    })
    assertJsonSafe()
    assertAfter(() => useGraph.getState().appendVersionText(run.versionId, 'Answer'))
    assertAfter(() => useGraph.getState().finishRun(run.runId))
    assertAfter(() => useGraph.getState().setVersionAccepted(run.outputId, run.versionId, true))
    assertAfter(() => useGraph.getState().setVersionAccepted(run.outputId, run.versionId, false))
    assertAfter(() => useGraph.getState().appendFollowUpMessage(run.versionId, {
      id: 'follow-up-cleanup',
      role: 'user',
      text: 'Question',
      createdAt: '2026-07-22T00:00:00.000Z',
      status: 'complete',
    }))
    assertAfter(() => useGraph.getState().clearFollowUpThread(run.versionId))
    assertAfter(() => useGraph.getState().dismissSourceChanges(run.versionId, 'dismissed-signature'))
  })
})
