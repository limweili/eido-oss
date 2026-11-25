import { beforeEach, describe, expect, it } from 'vitest'
import { useGraph } from '../graph/store'
import type { Card, Connection, Output, OutputVersion, SavedBoard } from '../graph/types'
import { createSeedMod } from '../mods'
import {
  createSourceContextSnapshot,
  sourceChangeStatus,
  type SourceContextRef,
} from './sourceContext'

function card(
  id: string,
  kind: Card['kind'],
  text = '',
  overrides: Partial<Card> = {},
): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text }],
    position: { x: 0, y: 0 },
    ...overrides,
  }
}

function conn(id: string, from: string, to: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    ...overrides,
  }
}

function board(cards: Card[], connections: Connection[] = [], outputs: Output[] = []): SavedBoard {
  return {
    version: 1,
    cards,
    connections,
    outputs,
    runs: [],
    updatedAt: '',
  }
}

function versionWith(snapshot = createSourceContextSnapshot(board([]), [])): OutputVersion {
  return {
    id: 'ver-1',
    number: 1,
    text: 'Answer',
    createdAt: '2026-06-16T00:00:00.000Z',
    fromRunId: 'run-1',
    sourceContext: snapshot,
  }
}

function resetStore(cards: Card[], connections: Connection[] = []) {
  useGraph.setState({
    cards,
    connections,
    outputs: [],
    runs: [],
    selection: null,
    selectedCardIds: [],
    saveState: 'saved',
    hydrated: false,
    keyPromptOpen: false,
    settings: {
      apiKey: '',
      model: 'openai/gpt-4o-mini',
      models: ['openai/gpt-4o-mini'],
      reasoningEffort: 'medium',
    },
  })
}

function beginStoredRun(askAiCardId: string, refs: SourceContextRef[]) {
  const snapshot = useGraph.getState().snapshot()
  const sourceContext = createSourceContextSnapshot(snapshot, refs)
  const begun = useGraph.getState().beginRun(askAiCardId, {
    text: 'Prompt',
    model: 'openai/gpt-4o-mini',
    usedCardIds: refs.map((ref) => ref.cardId).filter((id) => id !== askAiCardId),
    usedConnectionIds: [],
    modIds: [],
    appliedMods: [],
    sourceContext,
  })
  useGraph.getState().appendVersionText(begun.versionId, 'Answer')
  useGraph.getState().finishRun(begun.runId)
  return begun.versionId
}

function storedVersion(versionId: string) {
  for (const output of useGraph.getState().outputs) {
    const version = output.versions.find((candidate) => candidate.id === versionId)
    if (version) return version
  }
  throw new Error(`Missing version ${versionId}`)
}

// ADR 0022 accepts a one-time source-change blip when retired intent data leaves
// the hashed payload. Pin the resulting clean baselines so later changes remain deliberate.
describe('post-intent-removal fingerprint baseline', () => {
  function baselineResultBoard(versionExtras: Partial<OutputVersion> = {}): SavedBoard {
    return board(
      [card('result-1', 'result')],
      [],
      [
        {
          id: 'out-1',
          resultCardId: 'result-1',
          chosenVersionId: 'ver-1',
          versions: [
            {
              id: 'ver-1',
              number: 1,
              text: 'Ship the beta on Friday.\nHold the mobile build.',
              createdAt: '2026-06-16T00:00:00.000Z',
              fromRunId: 'run-1',
              ...versionExtras,
            },
          ],
        },
      ],
    )
  }

  it('pins a thread-less result fingerprint without retired intent data', () => {
    const snapshot = createSourceContextSnapshot(baselineResultBoard(), [{ cardId: 'result-1' }])
    expect(snapshot.sources[0].hash).toBe('3h3ta0')
  })

  it('pins a transcript-carrying result fingerprint without retired intent data', () => {
    const snapshot = createSourceContextSnapshot(
      baselineResultBoard({
        transcript: [
          {
            id: 'msg-1',
            speakerKind: 'participant',
            speakerName: 'Critic',
            participantCardId: 'ask-x',
            text: 'I disagree.',
            turnNumber: 1,
          },
          { id: 'msg-2', speakerKind: 'user', speakerName: 'You', text: 'Why?' },
        ],
      }),
      [{ cardId: 'result-1' }],
    )
    expect(snapshot.sources[0].hash).toBe('jswg89')
  })

  it('pins a plain note fingerprint without retired intent data', () => {
    const snapshot = createSourceContextSnapshot(
      board([card('note-1', 'note', 'Sound calm.', { title: 'Tone' })]),
      [{ cardId: 'note-1' }],
    )
    expect(snapshot.sources[0].hash).toBe('6geibf')
  })

})

describe('source context fingerprints', () => {
  it('ignores visual and label-only card changes', () => {
    const source = card('note-1', 'note', 'Stable text', {
      title: 'Original title',
      headerColor: '#ff0000',
      headerFill: 'half',
      size: { width: 260, height: 180 },
    })
    const snapshot = createSourceContextSnapshot(board([source]), [{ cardId: source.id }])
    const current = board([
      {
        ...source,
        title: 'Renamed',
        headerColor: '#00ff00',
        headerFill: 'full',
        position: { x: 400, y: 200 },
        size: { width: 420, height: 300 },
      },
    ])

    expect(sourceChangeStatus(current, versionWith(snapshot))).toBeNull()
  })

  it('detects body, asset, and mod variable changes', () => {
    const source = card('note-1', 'note', 'Old text', {
      assets: [
        {
          id: 'asset-1',
          kind: 'image',
          name: 'sketch.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,aaa',
          size: 3,
          createdAt: '2026-06-16T00:00:00.000Z',
        },
      ],
    })
    const snapshot = createSourceContextSnapshot(board([source]), [{ cardId: source.id }])
    const changedBody = board([{ ...source, blocks: [{ id: 'note-1-block', text: 'New text' }] }])
    const changedAsset = board([
      {
        ...source,
        assets: source.assets?.map((asset) => ({ ...asset, dataUrl: 'data:image/png;base64,bbb' })),
      },
    ])

    expect(sourceChangeStatus(changedBody, versionWith(snapshot))?.changes[0].reason).toBe('changed')
    expect(sourceChangeStatus(changedAsset, versionWith(snapshot))?.changes[0].reason).toBe('changed')

    const modV2 = createSeedMod('slider', {
      title: 'Pressure',
      createId: (_, ordinal) => `slider-${ordinal}`,
    })
    const mod = card('mod-1', 'mod', '', { modV2 })
    const modSnapshot = createSourceContextSnapshot(board([mod]), [{ cardId: mod.id }])
    const changedMod = board([
      {
        ...mod,
        modV2: {
          ...modV2,
          state: {
            ...modV2.state,
            items: modV2.state.items.map((item, index) => (
              index === 0 ? { ...item, v: item.v + 10 } : item
            )),
          },
        },
      },
    ])

    expect(sourceChangeStatus(changedMod, versionWith(modSnapshot))?.changes[0].reason).toBe('changed')
  })

  it('fingerprints only the v2 Mod prompt-source projection', () => {
    const modV2 = createSeedMod('select', { createId: (_, ordinal) => `option-${ordinal}` })
    const source = card('mod-v2', 'mod', '', { modV2 })
    const snapshot = createSourceContextSnapshot(board([source]), [{ cardId: source.id }])

    const presentationOnly = board([{
      ...source,
      modV2: { ...modV2, accent: '#ffffff' },
    }])
    expect(sourceChangeStatus(presentationOnly, versionWith(snapshot))).toBeNull()

    const promptRelevant = board([{
      ...source,
      modV2: {
        ...modV2,
        state: {
          ...modV2.state,
          options: modV2.state.options.map((option, index) => (
            index === 3 ? { ...option, frame: 'Write for everyone.' } : option
          )),
        },
      },
    }])
    expect(sourceChangeStatus(promptRelevant, versionWith(snapshot))?.changes[0]).toMatchObject({
      cardId: source.id,
      reason: 'changed',
    })
  })

  it('does not treat connection meaning changes as source changes', () => {
    const source = card('note-1', 'note', 'Use this.')
    const ask = card('ask-1', 'askAi', 'Write.')
    const first = board([source, ask], [conn('conn-1', source.id, ask.id)])
    const snapshot = createSourceContextSnapshot(first, [{ cardId: source.id }, { cardId: ask.id }])
    const current = board(
      [source, ask],
      [conn('conn-1', source.id, ask.id, { polarity: 'pushesAgainst', strength: 'weak' })],
    )

    expect(sourceChangeStatus(current, versionWith(snapshot))).toBeNull()
  })

  it('does not treat a Full group compression prompt as used context', () => {
    const group = card('group-1', 'group', '', {
      compressionPrompt: 'Old prompt',
    })
    const member = card('note-1', 'note', 'Member text', { groupId: group.id })
    const snapshot = createSourceContextSnapshot(board([group, member]), [
      { cardId: group.id, groupMode: 'full' },
    ])
    const current = board([{ ...group, compressionPrompt: 'New prompt' }, member])

    expect(sourceChangeStatus(current, versionWith(snapshot))).toBeNull()
  })
})

describe('source change status in generated versions', () => {
  beforeEach(() => {
    resetStore([
      card('note-a', 'note', 'A'),
      card('note-b', 'note', 'B'),
      card('ask-a', 'askAi', 'Use A'),
      card('ask-b', 'askAi', 'Use B'),
    ])
  })

  it('marks only directly affected result versions when a source body changes', () => {
    const versionA = beginStoredRun('ask-a', [{ cardId: 'ask-a' }, { cardId: 'note-a' }])
    const versionB = beginStoredRun('ask-b', [{ cardId: 'ask-b' }, { cardId: 'note-b' }])

    useGraph.getState().setCardText('note-a', 'A changed')
    const current = useGraph.getState().snapshot()

    expect(sourceChangeStatus(current, storedVersion(versionA))?.changes[0].cardId).toBe('note-a')
    expect(sourceChangeStatus(current, storedVersion(versionB))).toBeNull()
  })

  it('marks deleted source cards', () => {
    const versionId = beginStoredRun('ask-a', [{ cardId: 'ask-a' }, { cardId: 'note-a' }])

    useGraph.getState().deleteCard('note-a')
    const status = sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(versionId))

    expect(status?.changes).toEqual([
      expect.objectContaining({ cardId: 'note-a', reason: 'deleted' }),
    ])
  })

  it('dismisses the current source-change signature for that version', () => {
    const versionId = beginStoredRun('ask-a', [{ cardId: 'ask-a' }, { cardId: 'note-a' }])

    useGraph.getState().setCardText('note-a', 'A changed')
    const firstStatus = sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(versionId))!
    useGraph.getState().dismissSourceChanges(versionId, firstStatus.signature)

    expect(sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(versionId))).toBeNull()

    useGraph.getState().setCardText('note-a', 'A changed again')
    expect(sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(versionId))).not.toBeNull()
  })

  it('keeps older versions marked while a rerun records fresh source context', () => {
    const oldVersionId = beginStoredRun('ask-a', [{ cardId: 'ask-a' }, { cardId: 'note-a' }])
    useGraph.getState().setCardText('note-a', 'A changed')

    const newVersionId = beginStoredRun('ask-a', [{ cardId: 'ask-a' }, { cardId: 'note-a' }])
    const current = useGraph.getState().snapshot()

    expect(sourceChangeStatus(current, storedVersion(oldVersionId))).not.toBeNull()
    expect(sourceChangeStatus(current, storedVersion(newVersionId))).toBeNull()
  })

  it('keeps propagation one-hop through result cards', () => {
    const firstVersionId = beginStoredRun('ask-a', [{ cardId: 'ask-a' }, { cardId: 'note-a' }])
    const firstOutput = useGraph
      .getState()
      .outputs.find((output) => output.versions.some((version) => version.id === firstVersionId))!
    const resultCardId = firstOutput.resultCardId
    const secondVersionId = beginStoredRun('ask-b', [{ cardId: 'ask-b' }, { cardId: resultCardId }])

    useGraph.getState().setCardText('note-a', 'A changed')
    const current = useGraph.getState().snapshot()

    expect(sourceChangeStatus(current, storedVersion(firstVersionId))).not.toBeNull()
    expect(sourceChangeStatus(current, storedVersion(secondVersionId))).toBeNull()
  })

  it('flags downstream results when an upstream follow-up is added, and again when cleared', () => {
    const upstreamVersionId = beginStoredRun('ask-a', [{ cardId: 'ask-a' }, { cardId: 'note-a' }])
    const upstreamOutput = useGraph
      .getState()
      .outputs.find((output) => output.versions.some((version) => version.id === upstreamVersionId))!
    const resultCardId = upstreamOutput.resultCardId
    const downstreamVersionId = beginStoredRun('ask-b', [{ cardId: 'ask-b' }, { cardId: resultCardId }])

    expect(
      sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(downstreamVersionId)),
    ).toBeNull()

    useGraph.getState().appendFollowUpMessage(upstreamVersionId, {
      id: 'fu-1',
      role: 'user',
      text: 'Why though?',
      createdAt: '2026-06-16T00:00:00.000Z',
      status: 'complete',
    })
    const afterAppend = sourceChangeStatus(
      useGraph.getState().snapshot(),
      storedVersion(downstreamVersionId),
    )
    expect(afterAppend?.changes).toEqual([
      expect.objectContaining({ cardId: resultCardId, reason: 'changed' }),
    ])
  })

  it('flags downstream results when an upstream thread they saw is cleared', () => {
    const upstreamVersionId = beginStoredRun('ask-a', [{ cardId: 'ask-a' }, { cardId: 'note-a' }])
    const upstreamOutput = useGraph
      .getState()
      .outputs.find((output) => output.versions.some((version) => version.id === upstreamVersionId))!
    const resultCardId = upstreamOutput.resultCardId
    useGraph.getState().appendFollowUpMessage(upstreamVersionId, {
      id: 'fu-1',
      role: 'user',
      text: 'Why though?',
      createdAt: '2026-06-16T00:00:00.000Z',
      status: 'complete',
    })

    // Downstream runs while the thread has content, so pruning it is a real edit.
    const downstreamVersionId = beginStoredRun('ask-b', [{ cardId: 'ask-b' }, { cardId: resultCardId }])
    expect(
      sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(downstreamVersionId)),
    ).toBeNull()

    useGraph.getState().clearFollowUpThread(upstreamVersionId)
    const afterClear = sourceChangeStatus(
      useGraph.getState().snapshot(),
      storedVersion(downstreamVersionId),
    )
    expect(afterClear?.changes).toEqual([
      expect.objectContaining({ cardId: resultCardId, reason: 'changed' }),
    ])
  })

  it('ignores whitespace-only and failed follow-up messages in the fingerprint', () => {
    const upstreamVersionId = beginStoredRun('ask-a', [{ cardId: 'ask-a' }, { cardId: 'note-a' }])
    const upstreamOutput = useGraph
      .getState()
      .outputs.find((output) => output.versions.some((version) => version.id === upstreamVersionId))!
    const downstreamVersionId = beginStoredRun('ask-b', [
      { cardId: 'ask-b' },
      { cardId: upstreamOutput.resultCardId },
    ])

    useGraph.getState().appendFollowUpMessage(upstreamVersionId, {
      id: 'fu-blank',
      role: 'user',
      text: '   \n ',
      createdAt: '2026-06-16T00:00:00.000Z',
      status: 'complete',
    })
    useGraph.getState().appendFollowUpMessage(upstreamVersionId, {
      id: 'fu-failed',
      role: 'assistant',
      text: 'half an answ',
      createdAt: '2026-06-16T00:00:00.000Z',
      status: 'failed',
    })

    expect(
      sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(downstreamVersionId)),
    ).toBeNull()
  })

  it('ignores a streaming reply, then flips the downstream badge exactly once on settle', () => {
    const upstreamVersionId = beginStoredRun('ask-a', [{ cardId: 'ask-a' }, { cardId: 'note-a' }])
    const upstreamOutput = useGraph
      .getState()
      .outputs.find((output) => output.versions.some((version) => version.id === upstreamVersionId))!
    // The user's question is settled before the downstream run, so the reply
    // is the only thread change the downstream version has not yet seen.
    useGraph.getState().appendFollowUpMessage(upstreamVersionId, {
      id: 'fu-question',
      role: 'user',
      text: 'Why though?',
      createdAt: '2026-06-16T00:00:00.000Z',
      status: 'complete',
    })
    const downstreamVersionId = beginStoredRun('ask-b', [
      { cardId: 'ask-b' },
      { cardId: upstreamOutput.resultCardId },
    ])
    expect(
      sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(downstreamVersionId)),
    ).toBeNull()

    useGraph.getState().appendFollowUpMessage(upstreamVersionId, {
      id: 'fu-reply',
      role: 'assistant',
      text: 'Partly',
      createdAt: '2026-06-16T00:00:01.000Z',
      status: 'streaming',
    })
    expect(
      sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(downstreamVersionId)),
    ).toBeNull()

    useGraph.getState().appendFollowUpChunk(upstreamVersionId, 'fu-reply', ' because the demo is ready.')
    expect(
      sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(downstreamVersionId)),
    ).toBeNull()

    useGraph.getState().finishFollowUpMessage(upstreamVersionId, 'fu-reply', 'complete')
    const afterSettle = sourceChangeStatus(
      useGraph.getState().snapshot(),
      storedVersion(downstreamVersionId),
    )
    expect(afterSettle?.changes).toEqual([
      expect.objectContaining({ cardId: upstreamOutput.resultCardId, reason: 'changed' }),
    ])

    // Exactly once: dismissing the settle's signature leaves nothing pending —
    // the settle produced a single hash flip, not a second one afterwards.
    useGraph.getState().dismissSourceChanges(downstreamVersionId, afterSettle!.signature)
    expect(
      sourceChangeStatus(useGraph.getState().snapshot(), storedVersion(downstreamVersionId)),
    ).toBeNull()
  })

  it('detects group membership and chosen digest changes', () => {
    const group = card('group-1', 'group', '', {
      compressionPrompt: 'Compress.',
      title: 'Group',
    })
    const member = card('note-a', 'note', 'A', { groupId: group.id })
    const digestVersion: OutputVersion = {
      id: 'digest-1',
      number: 1,
      text: 'Digest one',
      createdAt: '2026-06-16T00:00:00.000Z',
      fromRunId: 'run-digest-1',
      digestKey: 'digest:one',
    }
    const groupedBoard: SavedBoard = {
      version: 1,
      cards: [group, member],
      connections: [],
      outputs: [{ id: 'out-group', resultCardId: group.id, chosenVersionId: 'digest-1', versions: [digestVersion] }],
      runs: [],
      updatedAt: '',
    }
    const snapshot = createSourceContextSnapshot(groupedBoard, [
      { cardId: group.id, groupMode: 'compress' },
    ])
    const digestTwo = { ...digestVersion, id: 'digest-2', number: 2, text: 'Digest two' }
    const changedDigest: SavedBoard = {
      ...groupedBoard,
      outputs: [{ id: 'out-group', resultCardId: group.id, chosenVersionId: 'digest-2', versions: [digestVersion, digestTwo] }],
    }
    const changedMembership: SavedBoard = {
      ...groupedBoard,
      cards: [group, { ...member, groupId: undefined }],
    }

    expect(sourceChangeStatus(changedDigest, versionWith(snapshot))?.changes[0].cardId).toBe(group.id)
    expect(sourceChangeStatus(changedMembership, versionWith(snapshot))?.changes[0].cardId).toBe(group.id)
  })
})
