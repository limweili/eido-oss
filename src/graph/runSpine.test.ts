// Run spine unit tests (issue #189): the internal startRun/settleRun pair
// behind the public run actions. External behavior only — public store
// actions in, board state and Intent Log out. The PRD names three pins:
// settle exactly once, each run kind × each terminal status, and
// find-or-create routed through the Graph Index.

import { beforeEach, describe, expect, it } from 'vitest'
import type { Card, ConversationProvenance } from './types'
import { useGraph } from './store'

function card(id: string, kind: Card['kind'], position = { x: 0, y: 0 }): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-blk`, text: '' }],
    position,
  }
}

function resetStore() {
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
    currentIdeaId: null,
    keyPromptOpen: false,
    ideaManagerOpen: false,
  })
}

const PROVENANCE: ConversationProvenance = {
  settings: { topic: 'Topic', style: 'debate', turnsPerParticipant: 1 },
  participants: [],
  sharedContext: [],
  topLevelMods: [],
  turns: [],
}

function beginAsk(cardId = 'ask-1') {
  return useGraph.getState().beginRun(cardId, {
    text: 'Prompt',
    model: 'model',
    usedCardIds: [cardId],
    usedConnectionIds: [],
    modIds: [],
    appliedMods: [],
  })
}

function beginDigest(groupId = 'group-1') {
  return useGraph.getState().beginGroupDigestRun(groupId, {
    text: 'Compress',
    model: 'model',
    usedCardIds: [groupId],
    usedConnectionIds: [],
    digestKey: 'digest-key',
  })
}

function beginConversation(cardId = 'conv-1') {
  return useGraph.getState().beginConversationRun(cardId, {
    model: useGraph.getState().settings.model,
    usedCardIds: [cardId],
    usedConnectionIds: [],
    conversation: PROVENANCE,
  })
}

function runById(runId: string) {
  return useGraph.getState().runs.find((r) => r.id === runId)!
}

function versionById(versionId: string) {
  for (const output of useGraph.getState().outputs) {
    const version = output.versions.find((v) => v.id === versionId)
    if (version) return version
  }
  return undefined
}

function eventTypes() {
  return useGraph.getState().intentLog.map((event) => event.type)
}

describe('run spine — start', () => {
  beforeEach(resetStore)

  it('creates the result card, connection, output, and run in one funnel commit', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })

    const { runId, versionId, outputId } = beginAsk()

    const resultCard = useGraph.getState().cards.find((c) => c.kind === 'result')!
    expect(resultCard).toBeTruthy()
    const connection = useGraph.getState().connections[0]
    expect(connection.from.cardId).toBe('ask-1')
    expect(connection.to.cardId).toBe(resultCard.id)
    const output = useGraph.getState().outputs.find((o) => o.id === outputId)!
    expect(output.resultCardId).toBe(resultCard.id)
    expect(output.versions.map((v) => v.id)).toEqual([versionId])
    expect(output.versions[0]).not.toHaveProperty('sourceContext')
    expect(runById(runId).status).toBe('running')

    expect(eventTypes()).toEqual(['card.created', 'connection.created', 'run.started'])
    // All the events born from the start mutation share the commit's identity
    // (funnel invariant), and the mutation captured exactly one undo entry.
    const commitIds = new Set(useGraph.getState().intentLog.map((event) => event.commitId))
    expect(commitIds.size).toBe(1)
    const [entry] = useGraph.getState().undoStack
    expect(useGraph.getState().undoStack).toHaveLength(1)
    expect(entry).toMatchObject({ kind: 'patches', commitId: [...commitIds][0] })
  })

  it('places a new result in the nearest buffered empty space', () => {
    useGraph.setState({
      cards: [
        card('ask-1', 'askAi'),
        card('occupied-right', 'note', { x: 350, y: 0 }),
      ],
    })

    beginAsk()

    const resultCard = useGraph.getState().cards.find((candidate) => candidate.kind === 'result')!
    expect(resultCard.position).toEqual({ x: 0, y: 210 })
  })

  it('stamps every run event through the funnel', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })

    const { runId } = beginAsk()
    useGraph.getState().finishRun(runId)

    for (const event of useGraph.getState().intentLog) {
      expect(event.commitId).toBeTruthy()
      expect(event.actorId).toBeTruthy()
      expect(event.clientTxnId).toBeTruthy()
      expect(typeof event.seq).toBe('number')
    }
  })

  it('copies and bounds append-only AI access provenance at run ingress', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })
    const phases: Array<{
      routeClass: 'hosted-free'
      policyRevision: string
    }> = [{ routeClass: 'hosted-free', policyRevision: 'hosted-free-v1' }]
    const started = useGraph.getState().beginRun('ask-1', {
      text: 'Prompt',
      model: 'model',
      usedCardIds: ['ask-1'],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      aiAccessPhases: phases,
    })
    phases[0]!.policyRevision = 'mutated-after-ingress'
    phases.push({ routeClass: 'hosted-free', policyRevision: 'another-phase' })

    const stored = runById(started.runId).aiAccessPhases
    expect(stored).toEqual([{
      routeClass: 'hosted-free',
      policyRevision: 'hosted-free-v1',
    }])
    expect(Object.isFrozen(stored)).toBe(true)
    expect(Object.isFrozen(stored?.[0])).toBe(true)

    expect(() => useGraph.getState().beginRun('ask-1', {
      text: 'Prompt',
      model: 'model',
      usedCardIds: ['ask-1'],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      aiAccessPhases: [{ routeClass: 'hosted-free', policyRevision: 'invalid policy' }],
    })).toThrow('AI access provenance is invalid')
  })

  it('stores explicit managed provenance without account, payment, secret, or content data', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })

    const started = useGraph.getState().beginRun('ask-1', {
      text: 'Prompt',
      model: 'model',
      usedCardIds: ['ask-1'],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      aiAccessPhases: [{
        routeClass: 'managed',
        policyRevision: 'managed-openrouter-v1',
      }],
    })

    expect(runById(started.runId).aiAccessPhases).toEqual([{
      routeClass: 'managed',
      policyRevision: 'managed-openrouter-v1',
    }])

    expect(() => useGraph.getState().beginRun('ask-1', {
      text: 'Prompt',
      model: 'model',
      usedCardIds: ['ask-1'],
      usedConnectionIds: [],
      modIds: [],
      appliedMods: [],
      aiAccessPhases: [{
        routeClass: 'managed',
        policyRevision: 'managed-openrouter-v1',
        accountId: 'acct_private',
      } as never],
    })).toThrow('AI access provenance is invalid')
  })

  it('reuses a connected result card found through the Graph Index', () => {
    useGraph.setState({
      cards: [card('ask-1', 'askAi'), card('result-1', 'result', { x: 0, y: 300 })],
      connections: [
        {
          id: 'conn-1',
          from: { cardId: 'ask-1' },
          to: { cardId: 'result-1' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
      ],
    })

    const first = beginAsk()
    const second = beginAsk()

    // No result card was created, so no card.created/connection.created events.
    expect(useGraph.getState().cards).toHaveLength(2)
    expect(eventTypes()).toEqual(['run.started', 'run.started'])
    // Both versions accumulate on the one Output for that result card.
    const output = useGraph.getState().outputs.find((o) => o.resultCardId === 'result-1')!
    expect(output.id).toBe(first.outputId)
    expect(second.outputId).toBe(first.outputId)
    expect(output.versions.map((v) => v.number)).toEqual([1, 2])
    expect(output.chosenVersionId).toBe(second.versionId)
  })

  it('writes a group digest back onto the group card without find-or-create', () => {
    useGraph.setState({ cards: [card('group-1', 'group')] })

    const { runId, versionId, outputId } = beginDigest()

    expect(useGraph.getState().cards).toHaveLength(1)
    const output = useGraph.getState().outputs.find((o) => o.id === outputId)!
    expect(output.resultCardId).toBe('group-1')
    expect(versionById(versionId)?.digestKey).toBe('digest-key')
    expect(runById(runId).kind).toBe('groupDigest')
    expect(eventTypes()).toEqual(['run.started', 'group.compression.started'])
  })

  it('starts a conversation run with a seeded transcript on its version', () => {
    useGraph.setState({ cards: [card('conv-1', 'conversation')] })

    const { runId, versionId, resultCardId } = beginConversation()

    expect(useGraph.getState().cards.find((c) => c.id === resultCardId)?.kind).toBe('result')
    expect(versionById(versionId)?.transcript).toEqual([])
    expect(runById(runId).kind).toBe('conversation')
    expect(runById(runId).conversation).toEqual(PROVENANCE)
    expect(eventTypes()).toEqual(['card.created', 'connection.created', 'run.started'])
  })

  it('keeps no inline result-card scan in the store (Graph Index owns the lookup)', () => {
    const sources = import.meta.glob('./store.ts', {
      query: '?raw',
      import: 'default',
      eager: true,
    }) as Record<string, string>
    const store = sources['./store.ts']
    expect(store).toBeTruthy()
    // The duplicated `kind === 'result'` scans beginRun/beginConversationRun
    // carried are gone; the one lookup is the Graph Index's resultCardFor.
    expect(store).not.toMatch(/kind === 'result'/)
    expect(store).toMatch(/\.resultCardFor\(/)
  })
})

describe('run spine — settle', () => {
  beforeEach(resetStore)

  it('finishes an ask run and keeps its version', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })
    const { runId, versionId } = beginAsk()
    useGraph.getState().appendVersionText(versionId, 'Answer')

    useGraph.getState().finishRun(runId)

    expect(runById(runId).status).toBe('done')
    expect(runById(runId).finishedAt).toBeTruthy()
    expect(versionById(versionId)?.text).toBe('Answer')
    expect(versionById(versionId)?.provisional).toBeUndefined()
    expect(eventTypes()).toContain('run.completed')
  })

  it('fails an ask run and drops its placeholder version', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })
    const first = beginAsk()
    useGraph.getState().appendVersionText(first.versionId, 'Kept')
    useGraph.getState().finishRun(first.runId)
    const second = beginAsk()

    useGraph.getState().failRun(second.runId, 'boom')

    expect(runById(second.runId).status).toBe('failed')
    expect(runById(second.runId).errorMessage).toBe('boom')
    expect(versionById(second.versionId)).toBeUndefined()
    // The chosen version falls back to the last surviving one.
    const output = useGraph.getState().outputs.find((o) => o.id === second.outputId)!
    expect(output.chosenVersionId).toBe(first.versionId)
    const failed = useGraph.getState().intentLog.find((event) => event.type === 'run.failed')
    expect(failed?.type === 'run.failed' && failed.data.message).toBe('boom')
  })

  it('cancels an ask run and keeps the streamed text as a Provisional Version', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })
    const { runId, versionId } = beginAsk()
    useGraph.getState().appendVersionText(versionId, 'Partial...')

    useGraph.getState().cancelRun(runId)

    expect(runById(runId).status).toBe('canceled')
    const version = versionById(versionId)!
    expect(version.text).toBe('Partial...')
    expect(version.provisional).toBe(true)
    expect(version.provisionalReason).toBe('canceled')
    expect(eventTypes()).toContain('run.canceled')
  })

  it('narrates group compression on every group digest terminal status', () => {
    useGraph.setState({ cards: [card('group-1', 'group'), card('group-2', 'group'), card('group-3', 'group')] })

    const finished = beginDigest('group-1')
    useGraph.getState().finishRun(finished.runId)
    const failed = beginDigest('group-2')
    useGraph.getState().failRun(failed.runId, 'boom')
    const canceled = beginDigest('group-3')
    useGraph.getState().cancelRun(canceled.runId)

    expect(runById(finished.runId).status).toBe('done')
    expect(runById(failed.runId).status).toBe('failed')
    expect(runById(canceled.runId).status).toBe('canceled')
    // A failed digest drops its placeholder version; a canceled one keeps it, Provisional.
    expect(versionById(failed.versionId)).toBeUndefined()
    expect(versionById(canceled.versionId)?.provisional).toBe(true)
    expect(eventTypes()).toEqual(
      expect.arrayContaining([
        'group.compression.completed',
        'group.compression.failed',
        'group.compression.canceled',
      ]),
    )
  })

  it('finishes, fails, and cancels conversation runs keeping transcripts Provisional', () => {
    useGraph.setState({
      cards: [card('conv-1', 'conversation'), card('conv-2', 'conversation'), card('conv-3', 'conversation')],
    })

    const finished = beginConversation('conv-1')
    useGraph.getState().finishConversationRun(finished.runId)

    const failed = beginConversation('conv-2')
    useGraph.getState().appendTranscriptMessage(failed.versionId, {
      id: 'm-1',
      speakerKind: 'participant',
      speakerName: 'A',
      text: 'Mid-stream',
      streaming: true,
    })
    useGraph.getState().failConversationRun(failed.runId, 'boom')

    const canceled = beginConversation('conv-3')
    useGraph.getState().appendTranscriptMessage(canceled.versionId, {
      id: 'm-2',
      speakerKind: 'participant',
      speakerName: 'B',
      text: 'Cut short',
      streaming: true,
    })
    useGraph.getState().cancelConversationRun(canceled.runId)

    expect(runById(finished.runId).status).toBe('done')

    const failedVersion = versionById(failed.versionId)!
    expect(runById(failed.runId).status).toBe('failed')
    expect(failedVersion.provisional).toBe(true)
    expect(failedVersion.provisionalReason).toBe('failed')
    expect(failedVersion.provisionalMessage).toBe('boom')
    expect(failedVersion.transcript?.map((m) => m.streaming)).toEqual([false])
    expect(failedVersion.transcript?.[0]?.text).toBe('Mid-stream')

    const canceledVersion = versionById(canceled.versionId)!
    expect(runById(canceled.runId).status).toBe('canceled')
    expect(canceledVersion.provisional).toBe(true)
    expect(canceledVersion.provisionalReason).toBe('canceled')
    expect(canceledVersion.transcript?.map((m) => m.streaming)).toEqual([false])
  })

  it('settles a run exactly once — later terminal calls are no-ops', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })
    const { runId, versionId } = beginAsk()

    useGraph.getState().finishRun(runId)
    const settled = runById(runId)
    const logLength = useGraph.getState().intentLog.length

    useGraph.getState().cancelRun(runId)
    useGraph.getState().failRun(runId, 'too late')
    useGraph.getState().finishRun(runId)

    expect(runById(runId)).toBe(settled)
    expect(runById(runId).status).toBe('done')
    expect(runById(runId).errorMessage).toBeUndefined()
    expect(useGraph.getState().intentLog).toHaveLength(logLength)
    // The late failRun must not have dropped the finished version either.
    expect(versionById(versionId)).toBeTruthy()
  })

  it('emits exactly one terminal event when cancel races cancel', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })
    const { runId } = beginAsk()

    useGraph.getState().cancelRun(runId)
    useGraph.getState().cancelRun(runId)

    expect(eventTypes().filter((type) => type === 'run.canceled')).toHaveLength(1)
  })

  it('reopens a settled conversation with run.continued and arms exactly one more settle', () => {
    useGraph.setState({ cards: [card('conv-1', 'conversation')] })
    const { runId, versionId } = beginConversation()
    useGraph.getState().cancelConversationRun(runId)
    expect(versionById(versionId)?.provisional).toBe(true)

    const cont = useGraph.getState().continueConversationRun('conv-1', versionId, PROVENANCE)

    // Same run reopened — one conversation stays one version, one RunRecord.
    expect(cont.runId).toBe(runId)
    expect(runById(runId).status).toBe('running')
    expect(runById(runId).finishedAt).toBeUndefined()
    expect(versionById(versionId)?.provisional).toBe(false)
    expect(eventTypes()[eventTypes().length - 1]).toBe('run.continued')
    const continued = useGraph.getState().intentLog[useGraph.getState().intentLog.length - 1]
    expect(continued.commitId).toBeTruthy()

    // The reopened run settles exactly once more.
    useGraph.getState().finishConversationRun(runId)
    expect(runById(runId).status).toBe('done')
    const logLength = useGraph.getState().intentLog.length
    useGraph.getState().cancelConversationRun(runId)
    expect(runById(runId).status).toBe('done')
    expect(useGraph.getState().intentLog).toHaveLength(logLength)
  })

  it('refuses to relabel a conversation continuation after its provider changes', () => {
    useGraph.setState({ cards: [card('conv-1', 'conversation')] })
    const { runId, versionId } = beginConversation()
    useGraph.getState().finishConversationRun(runId)
    useGraph.setState((state) => ({
      settings: {
        ...state.settings,
        provider: 'codex',
        model: 'default',
        models: ['default'],
      },
    }))

    expect(() => useGraph.getState().continueConversationRun('conv-1', versionId, PROVENANCE))
      .toThrow('Conversation provider or model changed')
    expect(runById(runId)).toMatchObject({ provider: 'openrouter', status: 'done' })
  })

  it('attaches a fresh run (run.started) when continuing a version whose run is gone', () => {
    useGraph.setState({
      cards: [card('conv-1', 'conversation'), card('result-1', 'result')],
      outputs: [
        {
          id: 'out-1',
          resultCardId: 'result-1',
          chosenVersionId: 'ver-orphan',
          versions: [
            {
              id: 'ver-orphan',
              number: 1,
              text: '',
              createdAt: '2026-01-01T00:00:00.000Z',
              fromRunId: 'run-gone',
              provisional: true,
              provisionalReason: 'canceled',
            },
          ],
        },
      ],
    })

    const cont = useGraph.getState().continueConversationRun('conv-1', 'ver-orphan', PROVENANCE)

    expect(runById(cont.runId).status).toBe('running')
    expect(runById(cont.runId).provider).toBe(useGraph.getState().settings.provider)
    expect(runById(cont.runId).model).toBe(useGraph.getState().settings.model)
    expect(runById(cont.runId).producedVersionId).toBe('ver-orphan')
    expect(versionById('ver-orphan')?.provisional).toBe(false)
    expect(eventTypes()).toEqual(['run.started'])
  })

  it('ignores settling a run that does not exist', () => {
    useGraph.setState({ cards: [card('ask-1', 'askAi')] })
    beginAsk()
    const logLength = useGraph.getState().intentLog.length

    useGraph.getState().finishRun('run-missing')
    useGraph.getState().failRun('run-missing', 'boom')
    useGraph.getState().cancelRun('run-missing')

    expect(useGraph.getState().intentLog).toHaveLength(logLength)
  })
})
