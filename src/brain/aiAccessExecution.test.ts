import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../graph/store'
import type { Card } from '../graph/types'
import { runConversation } from './conversationRunner'
import { runFollowUp } from './followUpRunner'
import { runCard, runChain, runGroupCompression } from './runEngine'

function card(id: string, kind: Card['kind'] = 'askAi'): Card {
  return {
    id,
    kind,
    title: id,
    blocks: [{ id: `${id}-block`, text: kind === 'group' ? '' : 'Discuss this evidence.' }],
    position: { x: 0, y: 0 },
  }
}

function feed(from: string, to: string) {
  return {
    id: `${from}-${to}`,
    from: { cardId: from }, to: { cardId: to },
    strength: 'strong' as const, polarity: 'helps' as const, role: 'feeds' as const,
  }
}

beforeEach(() => {
  useGraph.setState({
    cards: [card('ask')], connections: [], outputs: [], runs: [], compactionSummaries: [],
    selection: null, selectedCardIds: [], undoStack: [], redoStack: [], currentIdeaId: null,
    settings: {
      apiKey: 'sk-user-owned', model: 'any/user-model', models: ['any/user-model'],
      reasoningEffort: 'medium',
    },
  })
})

function answeringStream(answer = 'User-funded answer') {
  return vi.fn(async (_instruction: string, options: { onChunk: (chunk: string) => void }) => {
    expect(options).not.toHaveProperty('apiKey')
    options.onChunk(answer)
    return answer
  })
}

function expectPersonalRunProvenance() {
  expect(useGraph.getState().runs.length).toBeGreaterThan(0)
  for (const run of useGraph.getState().runs) {
    expect(run.aiAccessPhases).toEqual([{ routeClass: 'byok', policyRevision: null }])
    expect(JSON.stringify(run)).not.toContain('sk-user-owned')
  }
}

describe('BYOK execution through the ordinary graph runners', () => {
  it('runs an Ask and its Result follow-up without account admission', async () => {
    const outcome = await runCard('ask', { stream: answeringStream() })
    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    if (!outcome.ok || outcome.status !== 'done') throw new Error('Expected an answer')
    await expect(runFollowUp(outcome.versionId, 'Continue.', {
      stream: answeringStream('Follow-up answer'),
    })).resolves.toMatchObject({ ok: true, status: 'done' })
    const version = useGraph.getState().outputs.flatMap((output) => output.versions)
      .find((candidate) => candidate.id === outcome.versionId)
    expect(version?.text).toBe('User-funded answer')
    expect(version?.followUpThread?.messages[1]).toMatchObject({ text: 'Follow-up answer', status: 'complete' })
    expectPersonalRunProvenance()
  })

  it('runs a dependency chain with an arbitrary user-selected model', async () => {
    useGraph.setState({ cards: [card('upstream'), card('upstream-result', 'result'), card('downstream')],
      connections: [feed('upstream', 'upstream-result'), feed('upstream-result', 'downstream')] })
    const stream = answeringStream()
    await expect(runChain('downstream', { stream })).resolves.toMatchObject({ ok: true, status: 'done' })
    expect(stream).toHaveBeenCalledTimes(2)
    expect(useGraph.getState().runs.every((run) => run.status === 'done')).toBe(true)
    expectPersonalRunProvenance()
  })

  it('runs a Conversation on the selected participant model', async () => {
    useGraph.setState({
      cards: [{ ...card('conversation', 'conversation'), conversationTurns: 2 }, card('participant')],
      connections: [feed('participant', 'conversation')],
    })
    const stream = answeringStream()
    await expect(runConversation('conversation', { stream })).resolves.toMatchObject({ ok: true, status: 'done' })
    expect(stream).toHaveBeenCalledTimes(2)
    expectPersonalRunProvenance()
  })

  it('compresses a Group using the same user-key route', async () => {
    useGraph.setState({ cards: [card('group', 'group'), { ...card('evidence', 'note'), groupId: 'group' }] })
    await expect(runGroupCompression('group', { stream: answeringStream('Digest') }))
      .resolves.toMatchObject({ ok: true, status: 'done' })
    expect(useGraph.getState().outputs.flatMap((output) => output.versions).some((version) => version.text === 'Digest'))
      .toBe(true)
    expect(useGraph.getState().runs).toEqual([expect.objectContaining({ kind: 'groupDigest', status: 'done' })])
    expect(JSON.stringify(useGraph.getState().runs)).not.toContain('sk-user-owned')
  })

  it.each(['in-app', 'agent-cli'] as const)('blocks a keyless %s run before any provider work', async (source) => {
    useGraph.setState((state) => ({ settings: { ...state.settings, apiKey: '' } }))
    const stream = answeringStream()
    await expect(runChain('ask', {
      stream,
      ...(source === 'agent-cli' ? { triggeredBy: { kind: 'agent' as const, client: 'codex', sessionId: 'session-byok' } } : {}),
    })).resolves.toMatchObject({ ok: false, reason: 'no-key', access: { code: 'api-key-required' } })
    expect(stream).not.toHaveBeenCalled()
    expect(useGraph.getState().runs).toEqual([])
  })
})
