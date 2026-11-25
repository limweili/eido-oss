import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, Connection } from '../graph/types'
import { useGraph } from '../graph/store'
import { createAgentRunExecutionAdapter } from '../desktop/agentRunExecutionAdapter'
import { planAgentRunAdmission, type AgentRunExecutionRequest } from './agentRunSession'
import { createAgentRunExecutor, type AgentRunExecutor } from './agentRunExecutor'
import type { ConversationStream } from './conversationRunner'
import type { CompletionStream } from './runEngine'
const actor = Object.freeze({
  kind: 'agent' as const,
  client: 'codex',
  sessionId: 'executor-system-test',
})

function resetStore(): void {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    compactionSummaries: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    currentIdeaId: null,
    keyPromptOpen: false,
    settings: {
      apiKey: 'synthetic-key',
      model: 'test/model',
      models: ['test/model'],
      reasoningEffort: 'medium',
    },
  })
}

function card(id: string, kind: Card['kind'], text = '', extra: Partial<Card> = {}): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text }],
    position: { x: 0, y: 0 },
    ...extra,
  }
}

function feed(
  id: string,
  from: string,
  to: string,
  options: Partial<Connection> = {},
): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    ...options,
  }
}

function admittedRequest(
  targetCardId: string,
  mode: 'run' | 'variations' = 'run',
  variationCount = 1,
  ideaId = 'idea-live',
): AgentRunExecutionRequest {
  const admission = planAgentRunAdmission(useGraph.getState().snapshot(), mode === 'run'
    ? { ideaId, targetCardId }
    : { ideaId, targetCardId, mode, variationCount })
  if (!admission.ok) throw new Error(`Fixture did not admit ${targetCardId}`)
  return Object.freeze({
    runId: `agent-${targetCardId}-${mode}`,
    ideaId,
    targetCardId,
    actor,
    admission,
  })
}

function executor(options: Readonly<{
  askStream?: CompletionStream
  conversationStream?: ConversationStream
  compactionStream?: CompletionStream
  ideaId?: () => string | null
  isLive?: () => boolean
}>): AgentRunExecutor {
  return createAgentRunExecutor({
    readLiveBoard: () => ({
      ideaId: options.ideaId?.() ?? 'idea-live',
      board: useGraph.getState().snapshot(),
    }),
    isLive: options.isLive ?? (() => true),
    ...(options.askStream ? { askStream: options.askStream } : {}),
    ...(options.conversationStream ? { conversationStream: options.conversationStream } : {}),
    ...(options.compactionStream ? { compactionStream: options.compactionStream } : {}),
  })
}

function changeSystemPrompt(value = 'drifted while delegated'): void {
  useGraph.setState({
    settings: { ...useGraph.getState().settings, systemPrompt: value },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  resetStore()
})
afterEach(() => vi.restoreAllMocks())

describe('brain-owned Agent Run execution', () => {
  it.each(['ask', 'conversation'] as const)(
    'reports a missing credential distinctly before a %s provider call',
    async (kind) => {
      useGraph.setState({
        cards: kind === 'ask'
          ? [card('target', 'askAi', 'Answer simply.')]
          : [
              card('target', 'conversation', 'Discuss simply.', { conversationTurns: 1 }),
              card('speaker', 'askAi', 'Explain the evidence.'),
            ],
        connections: kind === 'ask'
          ? []
          : [feed('speaker-target', 'speaker', 'target')],
        settings: { ...useGraph.getState().settings, apiKey: '' },
      })

      await expect(executor({}).execute(admittedRequest('target'))).resolves.toMatchObject({
        status: 'failed',
        failure: 'credential-unavailable',
        executedStepIds: [kind === 'ask' ? 'ask:target' : 'conversation:target'],
        artifacts: [],
      })
    },
  )

  it('executes one stale prefix then N targets, refreshing a target-owned compressed Group serially', async () => {
    useGraph.setState({
      cards: [
        card('ask-upstream', 'askAi', 'Name an animal.'),
        card('result-upstream', 'result'),
        card('ask-target', 'askAi', 'Describe it using the Group.'),
        card('result-target', 'result', '', { groupId: 'group-self' }),
        card('group-note', 'note', 'Keep the answer concrete.', { groupId: 'group-self' }),
        card('group-self', 'group', '', { compressionPrompt: 'Compress the evidence.' }),
      ],
      connections: [
        feed('upstream-result', 'ask-upstream', 'result-upstream'),
        feed('result-target-context', 'result-upstream', 'ask-target'),
        feed('target-result', 'ask-target', 'result-target'),
        feed('group-target', 'group-self', 'ask-target', { meta: { groupMode: 'compress' } }),
      ],
    })
    const instructions: string[] = []
    const askStream: CompletionStream = async (instruction, options) => {
      instructions.push(instruction)
      const answer = `provider-${instructions.length}`
      options.onChunk(answer)
      return answer
    }
    const request = admittedRequest('ask-target', 'variations', 3)
    expect(request.admission.schedule).toMatchObject({
      targetKind: 'ask',
      prefix: [{ stepId: 'ask:ask-upstream', cardId: 'ask-upstream' }],
      targets: [
        { stepId: 'variation:ask-target:1', variationIndex: 1 },
        { stepId: 'variation:ask-target:2', variationIndex: 2 },
        { stepId: 'variation:ask-target:3', variationIndex: 3 },
      ],
    })

    const outcome = await executor({ askStream }).execute(request)

    expect(outcome).toMatchObject({
      status: 'done',
      executedStepIds: [
        'ask:ask-upstream',
        'variation:ask-target:1',
        'variation:ask-target:2',
        'variation:ask-target:3',
      ],
    })
    expect(instructions).toHaveLength(7)
    const runs = useGraph.getState().runs
    expect(runs.filter((run) => (run.kind ?? 'ask') === 'ask' && run.askAiCardId === 'ask-upstream'))
      .toHaveLength(1)
    expect(runs.filter((run) => (run.kind ?? 'ask') === 'ask' && run.askAiCardId === 'ask-target'))
      .toHaveLength(3)
    expect(runs.filter((run) => run.kind === 'groupDigest' && run.askAiCardId === 'group-self'))
      .toHaveLength(3)
    expect(runs.filter((run) => run.askAiCardId === 'ask-target').every((run) => (
      JSON.stringify(run.plan) === JSON.stringify(
        request.admission.schedule.targetKind === 'ask'
          ? request.admission.schedule.chainPlan
          : undefined,
      )
    ))).toBe(true)
    expect(outcome.artifacts).toHaveLength(14)
    expect(new Set(outcome.artifacts.map((artifact) => artifact.recordId)).size).toBe(14)
  })

  it('guards both durable Ask prerequisites and Conversation compaction before the next provider call', async () => {
    useGraph.setState({
      cards: [
        card('ask', 'askAi', 'Use this Group.'),
        card('member', 'note', 'Evidence.', { groupId: 'group' }),
        card('group', 'group', '', { compressionPrompt: 'Digest it.' }),
      ],
      connections: [feed('group-ask', 'group', 'ask', { meta: { groupMode: 'compress' } })],
    })
    let askCalls = 0
    const groupDrift = executor({
      askStream: async (_instruction, options) => {
        askCalls += 1
        options.onChunk('durable digest')
        changeSystemPrompt()
        return 'durable digest'
      },
    })

    const afterGroup = await groupDrift.execute(admittedRequest('ask'))
    expect(afterGroup).toMatchObject({
      status: 'failed',
      failure: 'plan-changed',
      executedStepIds: ['ask:ask'],
      artifacts: [
        { kind: 'run-record', cardId: 'group' },
        { kind: 'output-version', cardId: 'group' },
      ],
    })
    expect(askCalls).toBe(1)

    resetStore()
    const huge = 'Private evidence worth preserving. '.repeat(22_000)
    useGraph.setState({
      cards: [
        card('conversation', 'conversation', 'Discuss.', { conversationTurns: 1 }),
        card('speaker', 'askAi', 'Make the case.', { title: 'Solo' }),
        card('huge', 'note', huge),
      ],
      connections: [
        feed('speaker-conversation', 'speaker', 'conversation'),
        feed('huge-speaker', 'huge', 'speaker', { strength: 'weak' }),
      ],
    })
    let compactionCalls = 0
    let turnCalls = 0
    const conversationDrift = executor({
      conversationStream: async (_instruction, options) => {
        turnCalls += 1
        options.onChunk('should not run')
        return 'should not run'
      },
      compactionStream: async (_instruction, options) => {
        compactionCalls += 1
        options.onChunk('summary')
        changeSystemPrompt()
        return 'summary'
      },
    })

    const afterCompaction = await conversationDrift.execute(admittedRequest('conversation'))
    expect(afterCompaction).toMatchObject({
      status: 'failed',
      failure: 'plan-changed',
      executedStepIds: ['conversation:conversation'],
      artifacts: [],
    })
    expect(compactionCalls).toBe(1)
    expect(turnCalls).toBe(0)
  })

  it('rechecks the live Conversation admission before every turn', async () => {
    useGraph.setState({
      cards: [
        card('conversation', 'conversation', 'Discuss.', { conversationTurns: 2 }),
        card('speaker', 'askAi', 'Make the case.', { title: 'Solo' }),
      ],
      connections: [feed('speaker-conversation', 'speaker', 'conversation')],
    })
    let turns = 0
    const conversationStream: ConversationStream = async (_instruction, options) => {
      turns += 1
      options.onChunk(`turn-${turns}`)
      if (turns === 1) changeSystemPrompt()
      return `turn-${turns}`
    }

    const outcome = await executor({ conversationStream }).execute(admittedRequest('conversation'))

    expect(turns).toBe(1)
    expect(outcome).toMatchObject({
      status: 'failed',
      failure: 'plan-changed',
      artifacts: [
        { kind: 'run-record', cardId: 'conversation' },
        { kind: 'output-version' },
      ],
    })
    const run = useGraph.getState().runs[0]
    expect(run).toMatchObject({ kind: 'conversation', status: 'failed' })
    const transcript = useGraph.getState().outputs[0]?.versions[0]?.transcript
    expect(transcript).toHaveLength(1)
  })

  it('runs every Conversation variation while each active transcript is still mutable', async () => {
    useGraph.setState({
      cards: [
        card('conversation', 'conversation', 'Discuss.', { conversationTurns: 1 }),
        card('speaker', 'askAi', 'Make the case.', { title: 'Solo' }),
      ],
      connections: [feed('speaker-conversation', 'speaker', 'conversation')],
    })
    let turns = 0
    const conversationStream: ConversationStream = async (_instruction, options) => {
      turns += 1
      options.onChunk(`variation-${turns}`)
      return `variation-${turns}`
    }

    const outcome = await executor({ conversationStream }).execute(
      admittedRequest('conversation', 'variations', 2),
    )

    expect(outcome).toMatchObject({
      status: 'done',
      executedStepIds: [
        'conversation:conversation:variation:1',
        'conversation:conversation:variation:2',
      ],
    })
    expect(turns).toBe(2)
    expect(outcome.artifacts).toHaveLength(4)
    const output = useGraph.getState().outputs[0]
    expect(output?.versions).toHaveLength(2)
    expect(output?.chosenVersionId).toBe(output?.versions[1]?.id)
  })

  it('stops a mutable Conversation before its next turn when the user reselects a prior Result', async () => {
    useGraph.setState({
      cards: [
        card('conversation', 'conversation', 'Discuss.', { conversationTurns: 2 }),
        card('speaker', 'askAi', 'Make the case.', { title: 'Solo' }),
        card('result', 'result'),
      ],
      connections: [
        feed('speaker-conversation', 'speaker', 'conversation'),
        feed('conversation-result', 'conversation', 'result'),
      ],
      outputs: [{
        id: 'output-result',
        resultCardId: 'result',
        chosenVersionId: 'version-old',
        versions: [{
          id: 'version-old',
          number: 1,
          text: 'The prior discussion.',
          createdAt: '2026-08-05T00:00:00.000Z',
          fromRunId: 'run-old',
        }],
      }],
    })
    let turns = 0
    const conversationStream: ConversationStream = async (_instruction, options) => {
      turns += 1
      options.onChunk(`turn-${turns}`)
      if (turns === 1) {
        useGraph.setState({
          outputs: useGraph.getState().outputs.map((output) => ({
            ...output,
            chosenVersionId: 'version-old',
          })),
        })
      }
      return `turn-${turns}`
    }

    const outcome = await executor({ conversationStream }).execute(
      admittedRequest('conversation'),
    )

    expect(turns).toBe(1)
    expect(outcome).toMatchObject({
      status: 'failed',
      failure: 'plan-changed',
      executedStepIds: ['conversation:conversation'],
      artifacts: [
        { kind: 'run-record', cardId: 'conversation' },
        { kind: 'output-version', cardId: 'result' },
      ],
    })
    expect(useGraph.getState().outputs[0]?.chosenVersionId).toBe('version-old')
    expect(useGraph.getState().outputs[0]?.versions[1]?.transcript).toHaveLength(1)
  })

  it('fails closed on live Idea replacement and user Result reselection', async () => {
    useGraph.setState({ cards: [card('ask', 'askAi', 'Answer.')] })
    let liveIdeaId = 'idea-live'
    const ideaExecutor = executor({
      ideaId: () => liveIdeaId,
      askStream: async (_instruction, options) => {
        options.onChunk('answer from old Idea')
        liveIdeaId = 'idea-replacement'
        return 'answer from old Idea'
      },
    })
    const afterIdeaReplacement = await ideaExecutor.execute(admittedRequest('ask'))
    expect(afterIdeaReplacement).toMatchObject({
      status: 'failed',
      failure: 'idea-not-live',
      executedStepIds: ['ask:ask'],
      artifacts: [],
    })

    resetStore()
    useGraph.setState({
      cards: [card('ask', 'askAi', 'Answer.'), card('result', 'result')],
      connections: [feed('ask-result', 'ask', 'result')],
      outputs: [{
        id: 'output-result',
        resultCardId: 'result',
        chosenVersionId: 'version-old',
        versions: [{
          id: 'version-old',
          number: 1,
          text: 'User-selected prior answer.',
          createdAt: '2026-08-05T00:00:00.000Z',
          fromRunId: 'run-old',
        }],
      }],
    })
    const reselectionExecutor = executor({
      askStream: async (_instruction, options) => {
        options.onChunk('new answer')
        useGraph.setState({
          outputs: useGraph.getState().outputs.map((output) => ({
            ...output,
            chosenVersionId: 'version-old',
          })),
        })
        return 'new answer'
      },
    })
    const afterReselection = await reselectionExecutor.execute(
      admittedRequest('ask', 'variations', 2),
    )
    expect(afterReselection).toMatchObject({
      status: 'failed',
      failure: 'plan-changed',
      executedStepIds: ['variation:ask:1'],
      artifacts: [
        { kind: 'run-record', cardId: 'ask' },
        { kind: 'output-version', cardId: 'result' },
      ],
    })
    expect(useGraph.getState().outputs[0]?.chosenVersionId).toBe('version-old')
  })

  it.each([
    { terminal: 'canceled' as const, artifactCount: 2 },
    { terminal: 'failed' as const, artifactCount: 1 },
    { terminal: 'plan-changed' as const, artifactCount: 2 },
  ])('flushes exact partial artifacts when execution is $terminal', async ({
    terminal,
    artifactCount,
  }) => {
    let runner!: AgentRunExecutor
    let request: AgentRunExecutionRequest
    let askStream: CompletionStream
    if (terminal === 'plan-changed') {
      useGraph.setState({
        cards: [
          card('ask-upstream', 'askAi', 'Name an animal.'),
          card('result-upstream', 'result'),
          card('ask-target', 'askAi', 'Describe it.'),
        ],
        connections: [
          feed('upstream-result', 'ask-upstream', 'result-upstream'),
          feed('result-target', 'result-upstream', 'ask-target'),
        ],
      })
      request = admittedRequest('ask-target')
      askStream = async (_instruction, options) => {
        options.onChunk('durable upstream answer')
        changeSystemPrompt()
        return 'durable upstream answer'
      }
    } else {
      useGraph.setState({ cards: [card('ask', 'askAi', 'Answer.')] })
      request = admittedRequest('ask')
      askStream = terminal === 'canceled'
        ? async () => {
            runner.cancelActive()
            return ''
          }
        : async (_instruction, options) => {
            options.onChunk('partial provider text')
            throw new Error('synthetic provider failure')
          }
    }
    runner = executor({ askStream })
    const flush = vi.fn(async () => undefined)
    const adapter = createAgentRunExecutionAdapter({ runner, flush })

    const outcome = await adapter(request)

    expect(outcome.status).toBe(terminal === 'canceled' ? 'canceled' : 'failed')
    expect(outcome.artifacts).toHaveLength(artifactCount)
    expect(flush).toHaveBeenCalledOnce()
    if (terminal === 'plan-changed') {
      expect(outcome.executedStepIds).toEqual(['ask:ask-upstream'])
      expect(outcome.error).toContain('changed')
      }
  })
})
