import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, Connection } from '../graph/types'
import { useGraph } from '../graph/store'
import { PROFILE_REVIEW_MODEL } from '../shared/profileReviewPolicy'
import { compactionFingerprint } from './contextCompaction'
import { runChain, runGroupCompression, type CompletionStream } from './runEngine'
import {
  AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE,
  AGENT_RUN_GRANT_REQUIRED_MESSAGE,
  AGENT_RUN_LIVE_REQUIRED_MESSAGE,
} from './agentRunContract'
import {
  AGENT_RUN_FIRST_RUN_APPROVAL_POLICY,
  AGENT_RUN_INVALID_RESERVATION_MESSAGE,
  createAgentRunAdmissionOwner,
  createAgentRunJobRegistry,
  createAgentRunSessionService,
  createAgentRunSessionAdmission,
  planAgentRunAdmission,
} from './agentRunSession'

function resetStore() {
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
      apiKey: 'synthetic-test-key',
      model: 'test/model',
      models: ['test/model'],
      reasoningEffort: 'medium',
    },
  })
}

function card(id: string, kind: Card['kind'], text = ''): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text }],
    position: { x: 0, y: 0 },
  }
}

function feed(id: string, from: string, to: string): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}

function chainBoard() {
  useGraph.setState({
    cards: [
      card('ask-upstream', 'askAi', 'Name one animal.'),
      card('result-upstream', 'result'),
      card('ask-target', 'askAi', 'Describe that animal.'),
    ],
    connections: [
      feed('upstream-result', 'ask-upstream', 'result-upstream'),
      feed('result-target', 'result-upstream', 'ask-target'),
    ],
  })
}

const complete: CompletionStream = async (_instruction, options) => {
  options.onChunk('synthetic answer')
  return 'synthetic answer'
}

beforeEach(resetStore)
afterEach(() => vi.unstubAllGlobals())

describe('Agent run session policy (#721)', () => {
  it('reserves the conservative compaction budget matrix before admission', async () => {
    const huge = 'Constraint worth preserving. '.repeat(22_000).trim()
    vi.stubGlobal('window', { eidoDesktop: true, eidoProfileReview: true })
    const contextFixture = (cached: boolean): void => useGraph.setState({
      cards: [card('ask', 'askAi', 'Synthesize.'), card('context', 'note', huge)],
      connections: [{ ...feed('context-ask', 'context', 'ask'), strength: 'weak' }],
      compactionSummaries: cached ? [{
        cardId: 'context',
        fingerprint: compactionFingerprint(huge, PROFILE_REVIEW_MODEL),
        summary: 'Cached review summary.',
        model: PROFILE_REVIEW_MODEL,
        createdAt: '2026-08-05T00:00:00.000Z',
      }] : [],
    })
    const upstreamFixture = (text: string, mode: 'when-needed' | 'never' = 'when-needed'): void => {
      useGraph.setState({
        settings: { ...useGraph.getState().settings, compactionMode: mode },
        cards: [
          card('ask-upstream', 'askAi', 'Replace it.'),
          card('result-upstream', 'result'),
          card('ask-target', 'askAi', 'Use the replacement.'),
        ],
        connections: [
          feed('ask-result', 'ask-upstream', 'result-upstream'),
          { ...feed('result-target', 'result-upstream', 'ask-target'), strength: 'weak' },
        ],
        outputs: [{
          id: 'output-upstream',
          resultCardId: 'result-upstream',
          chosenVersionId: 'version-old',
          versions: [{
            id: 'version-old',
            number: 1,
            text,
            createdAt: '2026-08-05T00:00:00.000Z',
            fromRunId: 'run-old',
            provisional: true,
            provisionalReason: 'canceled',
          }],
        }],
        compactionSummaries: text === huge ? [{
          cardId: 'result-upstream',
          fingerprint: compactionFingerprint(huge, PROFILE_REVIEW_MODEL),
          summary: 'Cached old result.',
          model: PROFILE_REVIEW_MODEL,
          createdAt: '2026-08-05T00:00:00.000Z',
        }] : [],
      })
    }
    const cases = [
      { name: 'current huge uncached', setup: () => contextFixture(false), target: 'ask', expected: 4 },
      { name: 'current huge cached', setup: () => contextFixture(true), target: 'ask', expected: 2 },
      { name: 'short upstream may become huge', setup: () => upstreamFixture('short'), target: 'ask-target', expected: 5 },
      { name: 'refreshed upstream invalidates cached huge', setup: () => upstreamFixture(huge), target: 'ask-target', expected: 5 },
      { name: 'never mode makes no compaction call', setup: () => upstreamFixture('short', 'never'), target: 'ask-target', expected: 3 },
      {
        name: 'refreshed compressed Group may become huge',
        setup: () => useGraph.setState({
          cards: [
            card('ask', 'askAi', 'Use the Group.'),
            { ...card('group', 'group'), compressionPrompt: 'Compress.' },
            { ...card('member', 'note', 'Source.'), groupId: 'group' },
          ],
          connections: [{ ...feed('group-ask', 'group', 'ask'), meta: { groupMode: 'compress' } }],
        }),
        target: 'ask',
        expected: 5,
      },
    ]

    for (const scenario of cases) {
      resetStore()
      scenario.setup()
      const admission = planAgentRunAdmission(useGraph.getState().snapshot(), {
        ideaId: 'idea-synthetic',
        targetCardId: scenario.target,
        mode: 'variations',
        variationCount: 2,
      })
      expect(admission, scenario.name).toMatchObject({
        ok: true,
        budgetedModelCalls: scenario.expected,
      })
    }

    resetStore()
    contextFixture(false)
    const board = useGraph.getState().snapshot()
    let executed = false
    const service = createAgentRunSessionService({
      actor: { kind: 'agent', client: 'codex', sessionId: 'session-compaction-cap' },
      admissionOwner: createAgentRunAdmissionOwner({
        sessionCap: { maxRuns: 1, maxPlannedSteps: 2 },
      }),
      jobs: createAgentRunJobRegistry(),
      isLive: () => true,
      readBoard: () => board,
      createRunId: () => 'agent-run-compaction-cap',
      execute: async () => {
        executed = true
        return { status: 'done', executedStepIds: [], reusedStepIds: [], artifacts: [] }
      },
    })
    await expect(service.submit({
      ideaId: 'idea-synthetic',
      targetCardId: 'ask',
      mode: 'variations',
      variationCount: 2,
    })).resolves.toMatchObject({ ok: false, code: 'budget-exhausted' })
    expect(executed).toBe(false)
  })

  it('reserves uncached participant-context compaction before Conversation turns', () => {
    const oversizedContext = 'Private evidence worth preserving. '.repeat(22_000)
    useGraph.setState({
      cards: [
        { ...card('conversation', 'conversation', 'Discuss.'), conversationTurns: 1 },
        card('participant', 'askAi', 'Analyze.'),
        card('weak-context', 'note', oversizedContext),
      ],
      connections: [
        feed('participant-conversation', 'participant', 'conversation'),
        { ...feed('weak-participant', 'weak-context', 'participant'), strength: 'weak' },
      ],
    })

    expect(planAgentRunAdmission(useGraph.getState().snapshot(), {
      ideaId: 'idea-synthetic',
      targetCardId: 'conversation',
      mode: 'variations',
      variationCount: 2,
    })).toMatchObject({
      ok: true,
      budgetedModelCalls: 4,
    })
  })

  it('resolves Ask versus Conversation modes and reserves exact worst-case model calls', () => {
    useGraph.setState({
      cards: [
        card('ask-variation', 'askAi', 'Use the compressed group.'),
        { ...card('group', 'group'), title: 'Group', compressionPrompt: 'Compress.' },
        { ...card('member', 'note', 'Grouped context.'), groupId: 'group' },
        { ...card('conversation', 'conversation', 'Discuss the proposal.'), conversationTurns: 3 },
        { ...card('participant-a', 'askAi', 'Support it.'), title: 'Supporter' },
        card('participant-b', 'askAi', 'Challenge it.'),
      ],
      connections: [
        { ...feed('group-ask', 'group', 'ask-variation'), meta: { groupMode: 'compress' } },
        feed('participant-a-conversation', 'participant-a', 'conversation'),
        feed('participant-b-conversation', 'participant-b', 'conversation'),
      ],
    })
    const board = useGraph.getState().snapshot()

    expect(planAgentRunAdmission(board, {
      ideaId: 'idea-synthetic',
      targetCardId: 'ask-variation',
      mode: 'variations',
      variationCount: 3,
    })).toMatchObject({
      ok: true,
      targetKind: 'ask',
      mode: 'variations',
      variationCount: 3,
      aiExecutionPlan: {
        visibleTurns: 3,
        providerCalls: 7,
      },
      plannedStepIds: [
        'variation:ask-variation:1',
        'variation:ask-variation:2',
        'variation:ask-variation:3',
      ],
      budgetedModelCalls: 7,
    })

    expect(planAgentRunAdmission(board, {
      ideaId: 'idea-synthetic',
      targetCardId: 'conversation',
    })).toMatchObject({
      ok: true,
      targetKind: 'conversation',
      mode: 'run',
      variationCount: 1,
      aiExecutionPlan: {
        visibleTurns: 6,
        providerCalls: 6,
      },
      plannedStepIds: ['conversation:conversation'],
      budgetedModelCalls: 6,
      conversationPlan: {
        participants: [
          { cardId: 'participant-a', speakerLabel: 'Supporter' },
          { cardId: 'participant-b', speakerLabel: 'Speaker 2' },
        ],
        totalTurns: 6,
      },
    })

    expect(planAgentRunAdmission(board, {
      ideaId: 'idea-synthetic',
      targetCardId: 'conversation',
      mode: 'variations',
      variationCount: 2,
    })).toMatchObject({
      ok: true,
      targetKind: 'conversation',
      mode: 'variations',
      aiExecutionPlan: {
        visibleTurns: 12,
        providerCalls: 12,
      },
      plannedStepIds: [
        'conversation:conversation:variation:1',
        'conversation:conversation:variation:2',
      ],
      budgetedModelCalls: 12,
    })
  })

  it('refuses delegated execution that cannot fit the bounded OpenRouter call ledger', () => {
    useGraph.setState({
      cards: [card('ask', 'askAi', 'Answer.')],
      settings: { ...useGraph.getState().settings, provider: 'codex' },
    })
    expect(planAgentRunAdmission(useGraph.getState().snapshot(), 'ask')).toEqual({
      ok: false,
      code: 'invalid-target',
    })

    resetStore()
    useGraph.setState({
      cards: [
        { ...card('ask-upstream', 'askAi', 'Research.'), agentic: true },
        card('result-upstream', 'result'),
        card('ask-target', 'askAi', 'Use the research.'),
      ],
      connections: [
        feed('upstream-result', 'ask-upstream', 'result-upstream'),
        feed('result-target', 'result-upstream', 'ask-target'),
      ],
    })
    expect(planAgentRunAdmission(useGraph.getState().snapshot(), 'ask-target')).toEqual({
      ok: false,
      code: 'invalid-target',
    })
  })

  it('budgets the target plus stale upstream work while fresh upstream steps are reused', async () => {
    chainBoard()
    await runChain('ask-target', { stream: complete })

    const admission = planAgentRunAdmission(
      useGraph.getState().snapshot(),
      'ask-target',
    )

    expect(admission).toMatchObject({
      ok: true,
      plannedStepIds: ['ask:ask-target'],
      reusedStepIds: ['ask:ask-upstream'],
      aiExecutionPlan: {
        visibleTurns: 1,
        providerCalls: 1,
      },
      budgetedModelCalls: 1,
    })
    if (!admission.ok || admission.targetKind !== 'ask' || !('steps' in admission.plan)) {
      throw new Error('expected a valid Ask target')
    }
    expect(admission.plan.steps.map((step) => step.id)).toEqual([
      'ask:ask-upstream',
      'ask:ask-target',
    ])
    expect(admission.askPlans.map((candidate) => candidate.stepId)).toEqual([
      'ask:ask-target',
    ])
  })

  it('reserves compressed-Group model calls before any delegated execution starts', async () => {
    useGraph.setState({
      cards: [
        card('ask-target', 'askAi', 'Use the compressed group.'),
        { ...card('group-target', 'group'), title: 'Group', compressionPrompt: 'Compress.' },
        { ...card('note-member', 'note', 'Grouped context.'), groupId: 'group-target' },
      ],
      connections: [{
        ...feed('group-ask', 'group-target', 'ask-target'),
        meta: { groupMode: 'compress' },
      }],
    })
    const board = useGraph.getState().snapshot()
    const planned = planAgentRunAdmission(board, 'ask-target')
    if (!planned.ok || planned.targetKind !== 'ask' || !('steps' in planned.plan)) {
      throw new Error('expected a valid Ask plan')
    }
    expect(planned).toMatchObject({
      ok: true,
      plannedStepIds: ['ask:ask-target'],
      budgetedModelCalls: 3,
      askPlans: [{
        stepId: 'ask:ask-target',
        plan: { steps: [{ kind: 'groupDigest' }, { kind: 'ask' }] },
      }],
    })

    let executed = false
    const service = createAgentRunSessionService({
      actor: { kind: 'agent', client: 'codex', sessionId: 'session-compressed-cap' },
      admissionOwner: createAgentRunAdmissionOwner({
        sessionCap: { maxRuns: 1, maxPlannedSteps: 1 },
      }),
      jobs: createAgentRunJobRegistry(),
      isLive: () => true,
      readBoard: () => board,
      createRunId: () => 'agent-run-compressed-cap',
      execute: async () => {
        executed = true
        return { status: 'done', executedStepIds: [], reusedStepIds: [], artifacts: [] }
      },
    })

    expect(await service.submit({ ideaId: 'idea-synthetic', targetCardId: 'ask-target' }))
      .toEqual({
        ok: false,
        code: 'budget-exhausted',
        retryable: false,
        message: AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE,
      })
    await Promise.resolve()
    expect(executed).toBe(false)
  })

  it('binds the exact chosen compressed-Group digest while reserving its refresh', async () => {
    useGraph.setState({
      cards: [
        card('ask', 'askAi', 'Use the compressed group.'),
        { ...card('group', 'group'), compressionPrompt: 'Compress.' },
        { ...card('member', 'note', 'Source.'), groupId: 'group' },
      ],
      connections: [{ ...feed('group-ask', 'group', 'ask'), meta: { groupMode: 'compress' } }],
    })
    const before = planAgentRunAdmission(useGraph.getState().snapshot(), {
      ideaId: 'idea-synthetic',
      targetCardId: 'ask',
      mode: 'variations',
      variationCount: 2,
    })
    if (!before.ok || before.targetKind !== 'ask' || !('steps' in before.plan)) {
      throw new Error('expected Ask variation admission')
    }
    expect(before.budgetedModelCalls).toBe(5)

    await expect(runGroupCompression('group', { stream: complete }))
      .resolves.toMatchObject({ ok: true, status: 'done' })

    const after = planAgentRunAdmission(useGraph.getState().snapshot(), {
      ideaId: 'idea-synthetic',
      targetCardId: 'ask',
      mode: 'variations',
      variationCount: 2,
    })
    expect(after).toMatchObject({ ok: true, budgetedModelCalls: 2 })
    if (!after.ok) throw new Error('expected refreshed admission')
    expect(after.fingerprint).not.toBe(before.fingerprint)
  })

  it('reserves the whole planned run before start and fails closed at the session cap', () => {
    const admission = createAgentRunSessionAdmission({
      sessionId: 'session-synthetic-budget',
      cap: { maxRuns: 3, maxPlannedSteps: 3 },
    })

    expect(admission.reserve({ runId: 'agent-run-1', plannedSteps: 2 }))
      .toMatchObject({ ok: true, value: { usedRuns: 1, usedPlannedSteps: 2 } })
    expect(admission.reserve({ runId: 'agent-run-2', plannedSteps: 1 }))
      .toMatchObject({ ok: true, value: { usedRuns: 2, usedPlannedSteps: 3 } })

    expect(admission.reserve({ runId: 'agent-run-3', plannedSteps: 1 })).toEqual({
      ok: false,
      code: 'budget-exhausted',
      retryable: false,
      message: AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE,
      usage: {
        maxRuns: 3,
        maxPlannedSteps: 3,
        usedRuns: 2,
        usedPlannedSteps: 3,
      },
    })
    expect(admission.status().usage).toMatchObject({
      usedRuns: 2,
      usedPlannedSteps: 3,
    })
  })

  it('keeps owner sessions interruption-free while a policy flip gates only the first run', () => {
    const owner = createAgentRunSessionAdmission({ sessionId: 'session-owner' })
    expect(owner.status().grant).toBe('not-required')
    expect(owner.reserve({ runId: 'owner-run', plannedSteps: 1 })).toMatchObject({ ok: true })

    const approvalRequired = createAgentRunSessionAdmission({
      sessionId: 'session-future-friend',
      grantPolicy: AGENT_RUN_FIRST_RUN_APPROVAL_POLICY,
    })
    expect(approvalRequired.reserve({ runId: 'friend-run-1', plannedSteps: 1 })).toEqual({
      ok: false,
      code: 'grant-required',
      retryable: true,
      message: AGENT_RUN_GRANT_REQUIRED_MESSAGE,
    })
    expect(approvalRequired.status()).toMatchObject({
      grant: 'approval-required',
      usage: { usedRuns: 0, usedPlannedSteps: 0 },
    })

    expect(approvalRequired.resolveGrant('approved')).toBe('approved')
    expect(approvalRequired.reserve({ runId: 'friend-run-1', plannedSteps: 1 }))
      .toMatchObject({ ok: true, value: { usedRuns: 1 } })
    expect(approvalRequired.reserve({ runId: 'friend-run-2', plannedSteps: 1 }))
      .toMatchObject({ ok: true, value: { usedRuns: 2 } })
  })

  it('replays one reservation idempotently and rejects malformed or conflicting costs', () => {
    const admission = createAgentRunSessionAdmission({ sessionId: 'session-replay' })
    const first = admission.reserve({ runId: 'stable-agent-run', plannedSteps: 2 })

    expect(admission.reserve({ runId: 'stable-agent-run', plannedSteps: 2 })).toEqual(first)
    expect(admission.status().usage).toMatchObject({ usedRuns: 1, usedPlannedSteps: 2 })
    expect(admission.reserve({ runId: 'stable-agent-run', plannedSteps: 3 })).toEqual({
      ok: false,
      code: 'invalid-reservation',
      retryable: false,
      message: AGENT_RUN_INVALID_RESERVATION_MESSAGE,
    })
    expect(admission.reserve({ runId: '', plannedSteps: 0 })).toMatchObject({
      ok: false,
      code: 'invalid-reservation',
    })
    expect(admission.status().usage).toMatchObject({ usedRuns: 1, usedPlannedSteps: 2 })
  })

  it('submits asynchronously, exposes pollable status, then returns bounded artifact references', async () => {
    chainBoard()
    let finish!: (value: {
      status: 'done'
      executedStepIds: string[]
      reusedStepIds: string[]
      artifacts: Array<{
        kind: 'run-record'
        recordId: string
        cardId: string
      }>
    }) => void
    const completed = new Promise<Parameters<typeof finish>[0]>((resolve) => {
      finish = resolve
    })
    const executed: unknown[] = []
    const admissionOwner = createAgentRunAdmissionOwner()
    const jobs = createAgentRunJobRegistry()
    const service = createAgentRunSessionService({
      actor: {
        kind: 'agent',
        client: 'codex',
        sessionId: 'session-live-run',
      },
      admissionOwner,
      jobs,
      isLive: () => true,
      readBoard: () => useGraph.getState().snapshot(),
      createRunId: () => 'agent-run-live-1',
      now: (() => {
        let tick = 0
        return () => `2026-07-22T00:00:0${tick++}.000Z`
      })(),
      execute: async (request) => {
        executed.push(request)
        return completed
      },
    })

    const submitted = await service.submit({
      ideaId: 'idea-synthetic',
      targetCardId: 'ask-target',
    })
    expect(submitted).toMatchObject({
      ok: true,
      value: {
        runId: 'agent-run-live-1',
        status: 'queued',
        plannedStepIds: ['ask:ask-upstream', 'ask:ask-target'],
      },
    })
    await Promise.resolve()
    const poller = createAgentRunSessionService({
      actor: {
        kind: 'agent',
        client: 'codex',
        sessionId: 'session-fresh-poller',
      },
      admissionOwner,
      jobs,
      isLive: () => true,
      readBoard: () => useGraph.getState().snapshot(),
      execute: async () => {
        throw new Error('status/read must not execute')
      },
    })
    expect(await poller.status({ runId: 'agent-run-live-1' })).toMatchObject({
      ok: true,
      value: { status: 'running' },
    })
    expect(await poller.read({ runId: 'agent-run-live-1' })).toMatchObject({
      ok: false,
      code: 'run-not-finished',
      retryable: true,
    })
    expect(executed).toEqual([expect.objectContaining({
      runId: 'agent-run-live-1',
      targetCardId: 'ask-target',
      admission: expect.objectContaining({
        plannedStepIds: ['ask:ask-upstream', 'ask:ask-target'],
      }),
      actor: {
        kind: 'agent',
        client: 'codex',
        sessionId: 'session-live-run',
      },
    })])

    finish({
      status: 'done',
      executedStepIds: ['ask:ask-upstream', 'ask:ask-target'],
      reusedStepIds: [],
      artifacts: [{
        kind: 'run-record',
        recordId: 'engine-run-target',
        cardId: 'ask-target',
      }],
    })
    await completed
    await Promise.resolve()

    expect(await poller.status({ runId: 'agent-run-live-1' })).toMatchObject({
      ok: true,
      value: {
        status: 'done',
        artifactCount: 1,
        executedStepIds: ['ask:ask-upstream', 'ask:ask-target'],
      },
    })
    expect(await poller.read({ runId: 'agent-run-live-1' })).toMatchObject({
      ok: true,
      value: {
        items: [{ recordId: 'engine-run-target' }],
        truncated: false,
      },
    })
  })

  it('never delegates execution or spends session budget when the live app is unavailable', async () => {
    const admissionOwner = createAgentRunAdmissionOwner()
    let touchedRenderer = false
    const service = createAgentRunSessionService({
      actor: { kind: 'agent', client: 'codex', sessionId: 'session-offline' },
      admissionOwner,
      jobs: createAgentRunJobRegistry(),
      isLive: () => false,
      readBoard: () => {
        touchedRenderer = true
        return useGraph.getState().snapshot()
      },
      execute: async () => {
        touchedRenderer = true
        return {
          status: 'done',
          executedStepIds: [],
          reusedStepIds: [],
          artifacts: [],
        }
      },
    })

    expect(await service.submit({ ideaId: 'idea-offline', targetCardId: 'ask-offline' }))
      .toEqual({
        ok: false,
        code: 'live-app-required',
        retryable: true,
        message: AGENT_RUN_LIVE_REQUIRED_MESSAGE,
      })
    expect(touchedRenderer).toBe(false)
    expect(admissionOwner.sessionStatus('session-offline')).toBeUndefined()
    expect(admissionOwner.appStatus().globalUsage)
      .toMatchObject({ usedRuns: 0, usedPlannedSteps: 0 })
  })

  it('bounds app-lifetime runs and retained jobs across rotating session IDs', async () => {
    chainBoard()
    const admissionOwner = createAgentRunAdmissionOwner({
      appCap: { maxRuns: 3, maxPlannedSteps: 9, maxSessions: 3 },
      sessionCap: { maxRuns: 3, maxPlannedSteps: 9 },
    })
    const jobs = createAgentRunJobRegistry({ maxRetainedJobs: 2 })
    const services = Array.from({ length: 4 }, (_, index) => {
      const runId = `agent-run-rotating-${index + 1}`
      return createAgentRunSessionService({
        actor: {
          kind: 'agent',
          client: 'codex',
          sessionId: `session-rotating-${index + 1}`,
        },
        admissionOwner,
        jobs,
        isLive: () => true,
        readBoard: () => useGraph.getState().snapshot(),
        createRunId: () => runId,
        execute: async (request) => ({
          status: 'done',
          executedStepIds: request.admission.plannedStepIds,
          reusedStepIds: [],
          artifacts: [{
            kind: 'run-record',
            recordId: `record-${runId}`,
            cardId: request.targetCardId,
          }],
        }),
      })
    })

    for (const service of services.slice(0, 3)) {
      expect(await service.submit({
        ideaId: 'idea-synthetic',
        targetCardId: 'ask-target',
      })).toMatchObject({ ok: true })
      await Promise.resolve()
      await Promise.resolve()
    }

    expect(await services[3]!.submit({
      ideaId: 'idea-synthetic',
      targetCardId: 'ask-target',
    })).toEqual({
      ok: false,
      code: 'budget-exhausted',
      retryable: false,
      message: AGENT_RUN_BUDGET_EXHAUSTED_MESSAGE,
    })
    expect(admissionOwner.appStatus()).toMatchObject({
      retainedSessions: 3,
      maxRetainedSessions: 3,
      globalUsage: { usedRuns: 3, usedPlannedSteps: 9 },
    })
    expect(jobs.status()).toEqual({
      maxRetainedJobs: 2,
      retainedJobs: 2,
      activeJobs: 0,
      terminalJobs: 2,
    })
    expect(await services[0]!.status({ runId: 'agent-run-rotating-1' }))
      .toMatchObject({ ok: false, code: 'not-found' })
  })
})
