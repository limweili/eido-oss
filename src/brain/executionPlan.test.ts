import { describe, expect, it } from 'vitest'
import {
  askSteps,
  boardExecutionEnvelope,
  groupDigestSteps,
  planAiExecution,
  planAskRun,
  planChainRun,
  planConversationRun,
} from './executionPlan'
import { groupDigestCacheKey } from './groupDigestFreshness'
import type { Card, Connection, SavedBoard } from '../graph/types'

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
    aiSettings: {
      model: 'default/model',
      models: ['default/model'],
      reasoningEffort: 'medium',
    },
    updatedAt: '',
  }
}

describe('planAskRun', () => {
  it('binds the provider into the delegated execution envelope', () => {
    const saved = board([card('ask', 'askAi', 'task')], [])
    const openRouter = {
      ...saved,
      aiSettings: {
        model: 'openai/gpt-5.6-luna',
        models: ['openai/gpt-5.6-luna'],
        reasoningEffort: 'medium' as const,
        provider: 'openrouter' as const,
      },
    }
    const localHarness = {
      ...openRouter,
      aiSettings: { ...openRouter.aiSettings, provider: 'codex' as const },
    }

    expect(boardExecutionEnvelope(openRouter)).not.toEqual(boardExecutionEnvelope(localHarness))
  })

  it('plans a plain ask as a single step with the context policy recorded', () => {
    const saved = board(
      [card('ask', 'askAi', 'task'), card('note-1', 'note', 'context')],
      [conn('c1', 'note-1', 'ask')],
    )

    const plan = planAskRun(saved, 'ask')

    expect(plan).toEqual({
      version: 1,
      rootCardId: 'ask',
      steps: [
        {
          id: 'ask:ask',
          kind: 'ask',
          cardId: 'ask',
          dependsOn: [],
          contextPolicy: { name: 'connected-thought', version: 1 },
        },
      ],
    })
  })

  it('plans digest-refresh steps before the ask for compressed groups it consumes', () => {
    const saved = board(
      [
        card('ask', 'askAi', 'task'),
        card('group-compress', 'group'),
        card('group-full', 'group'),
        card('note-1', 'note', 'context'),
      ],
      [
        conn('c1', 'group-compress', 'ask', { meta: { groupMode: 'compress' } }),
        conn('c2', 'group-full', 'ask'),
        conn('c3', 'note-1', 'ask'),
      ],
    )

    const plan = planAskRun(saved, 'ask')
    const digests = groupDigestSteps(plan)

    expect(digests).toEqual([
      {
        id: 'digest:c1',
        kind: 'groupDigest',
        cardId: 'group-compress',
        dependsOn: [],
        connectionId: 'c1',
      },
    ])
    const askStep = plan.steps[plan.steps.length - 1]
    expect(askStep.kind).toBe('ask')
    expect(askStep.dependsOn).toEqual(['digest:c1'])
  })

  it('is serializable and deterministic', () => {
    const saved = board(
      [card('ask', 'askAi', 'task'), card('group-1', 'group')],
      [conn('c1', 'group-1', 'ask', { meta: { groupMode: 'compress' } })],
    )

    const first = planAskRun(saved, 'ask')
    const second = planAskRun(saved, 'ask')

    expect(second).toEqual(first)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
  })
})

describe('planChainRun', () => {
  it('plans upstream asks before the target when their results feed it', () => {
    // askA -> resultA -> askB: running B should run A first.
    const saved = board(
      [
        card('ask-a', 'askAi', 'step A'),
        card('result-a', 'result'),
        card('ask-b', 'askAi', 'step B'),
        card('note-1', 'note', 'context'),
      ],
      [
        conn('c1', 'ask-a', 'result-a'),
        conn('c2', 'result-a', 'ask-b'),
        conn('c3', 'note-1', 'ask-b'),
      ],
    )

    const plan = planChainRun(saved, 'ask-b')

    expect(plan.rootCardId).toBe('ask-b')
    expect(plan.steps.map((step) => step.cardId)).toEqual(['ask-a', 'ask-b'])
    const target = plan.steps[1]
    expect(target.dependsOn).toEqual(['ask:ask-a'])
    expect(target.contextPolicy).toEqual({ name: 'connected-thought', version: 1 })
  })

  it('deduplicates a shared upstream ask (diamond) and keeps dependencies first', () => {
    // askA feeds two results consumed by askB and askC; askD consumes both B and C.
    const saved = board(
      [
        card('ask-a', 'askAi', 'A'),
        card('result-a', 'result'),
        card('ask-b', 'askAi', 'B'),
        card('result-b', 'result'),
        card('ask-c', 'askAi', 'C'),
        card('result-c', 'result'),
        card('ask-d', 'askAi', 'D'),
      ],
      [
        conn('c1', 'ask-a', 'result-a'),
        conn('c2', 'result-a', 'ask-b'),
        conn('c3', 'result-a', 'ask-c'),
        conn('c4', 'ask-b', 'result-b'),
        conn('c5', 'result-b', 'ask-d'),
        conn('c6', 'ask-c', 'result-c'),
        conn('c7', 'result-c', 'ask-d'),
      ],
    )

    const plan = planChainRun(saved, 'ask-d')
    const order = plan.steps.map((step) => step.cardId)

    expect(order.filter((id) => id === 'ask-a')).toHaveLength(1)
    for (const step of plan.steps) {
      for (const dep of step.dependsOn) {
        const depIndex = plan.steps.findIndex((s) => s.id === dep)
        expect(depIndex).toBeGreaterThanOrEqual(0)
        expect(depIndex).toBeLessThan(plan.steps.indexOf(step))
      }
    }
    expect(order[order.length - 1]).toBe('ask-d')
  })

  it('breaks hand-wired cycles instead of hanging', () => {
    // askA's result feeds askB, and askB's result feeds askA — a loop.
    const saved = board(
      [
        card('ask-a', 'askAi', 'A'),
        card('result-a', 'result'),
        card('ask-b', 'askAi', 'B'),
        card('result-b', 'result'),
      ],
      [
        conn('c1', 'ask-a', 'result-a'),
        conn('c2', 'result-a', 'ask-b'),
        conn('c3', 'ask-b', 'result-b'),
        conn('c4', 'result-b', 'ask-a'),
      ],
    )

    const plan = planChainRun(saved, 'ask-a')
    const order = plan.steps.map((step) => step.cardId)

    expect(order).toEqual(['ask-b', 'ask-a'])
    expect(plan.steps[0].dependsOn).toEqual([])
    expect(plan.steps[1].dependsOn).toEqual(['ask:ask-b'])
  })

  it('returns an empty plan for a non-ask target', () => {
    const saved = board([card('note-1', 'note', 'hello')], [])
    expect(askSteps(planChainRun(saved, 'note-1'))).toEqual([])
  })
})

describe('planConversationRun', () => {
  it('resolves ordered participants, trusted deterministic labels, and exact turn cost', () => {
    const participantA = {
      ...card('participant-a', 'askAi', 'Argue for the proposal.'),
      title: 'Analyst',
    }
    const participantB = card('participant-b', 'askAi', 'Challenge the proposal.')
    const conversation = {
      ...card('conversation', 'conversation', 'Should we proceed?'),
      conversationStyle: 'debate' as const,
      conversationTurns: 2,
    }
    const saved = board(
      [participantA, participantB, conversation],
      [
        conn('participant-a-conversation', 'participant-a', 'conversation'),
        conn('participant-b-conversation', 'participant-b', 'conversation'),
      ],
    )

    const plan = planConversationRun(saved, 'conversation')

    expect(plan).toMatchObject({
      version: 1,
      rootCardId: 'conversation',
      targetKind: 'conversation',
      participants: [
        { cardId: 'participant-a', speakerLabel: 'Analyst' },
        { cardId: 'participant-b', speakerLabel: 'Speaker 2' },
      ],
      turnsPerParticipant: 2,
      totalTurns: 4,
    })
    expect(plan?.fingerprint).toMatch(/^conversation:/)
    expect(planConversationRun(saved, 'conversation')).toEqual(plan)
  })

  it('changes its lean fingerprint when conversation execution inputs drift', () => {
    const saved = board(
      [
        card('participant', 'askAi', 'Original participant role.'),
        { ...card('conversation', 'conversation', 'Topic'), conversationTurns: 1 },
      ],
      [conn('participant-conversation', 'participant', 'conversation')],
    )
    const changed = board(
      [
        card('participant', 'askAi', 'Changed participant role.'),
        { ...card('conversation', 'conversation', 'Topic'), conversationTurns: 1 },
      ],
      [conn('participant-conversation', 'participant', 'conversation')],
    )

    expect(planConversationRun(changed, 'conversation')?.fingerprint)
      .not.toBe(planConversationRun(saved, 'conversation')?.fingerprint)
    expect(planConversationRun(saved, 'missing')).toBeUndefined()
    expect(planConversationRun(board([card('note', 'note')], []), 'note')).toBeUndefined()
  })
})

describe('planAiExecution', () => {
  it('exposes the maximum visible batch for every action shape', () => {
    const saved = board(
      [
        card('ask-a', 'askAi', 'Step A'),
        card('result-a', 'result'),
        card('ask-b', 'askAi', 'Step B'),
        { ...card('group', 'group'), compressionPrompt: 'Compress.' },
        { ...card('member', 'note', 'Grouped context.'), groupId: 'group' },
        { ...card('conversation', 'conversation', 'Discuss.'), conversationTurns: 2 },
        { ...card('participant-a', 'askAi', 'Support.'), title: 'Supporter' },
        { ...card('participant-b', 'askAi', 'Challenge.'), title: 'Challenger' },
      ],
      [
        conn('ask-a-result', 'ask-a', 'result-a'),
        conn('result-a-ask-b', 'result-a', 'ask-b'),
        conn('group-ask-b', 'group', 'ask-b', { meta: { groupMode: 'compress' } }),
        conn('participant-a-conversation', 'participant-a', 'conversation'),
        conn('participant-b-conversation', 'participant-b', 'conversation'),
      ],
    )

    expect(planAiExecution(saved, { kind: 'ask', askAiCardId: 'ask-b' })).toMatchObject({
      version: 1,
      visibleTurns: 1,
      providerCalls: 3,
    })
    expect(planAiExecution(saved, {
      kind: 'chain',
      targetAskAiCardId: 'ask-b',
      askAiCardIds: ['ask-a', 'ask-b'],
    })).toMatchObject({
      version: 1,
      visibleTurns: 2,
      providerCalls: 5,
      providerCallManifest: [
        { callClass: 'visible-reply', providerModelId: 'default/model' },
        { callClass: 'group-digest', providerModelId: 'default/model' },
        {
          callClass: 'context-compaction',
          providerModelId: 'default/model',
          optional: true,
        },
        {
          callClass: 'context-compaction',
          providerModelId: 'default/model',
          optional: true,
        },
        { callClass: 'visible-reply', providerModelId: 'default/model' },
      ],
    })
    expect(planAiExecution(saved, {
      kind: 'conversation',
      conversationCardId: 'conversation',
    })).toMatchObject({
      version: 1,
      visibleTurns: 4,
      providerCalls: 4,
    })
    expect(planAiExecution(saved, {
      kind: 'variations',
      askAiCardId: 'ask-b',
      count: 3,
      askAiCardIds: ['ask-b', 'ask-b', 'ask-b'],
    })).toMatchObject({
      version: 1,
      visibleTurns: 3,
      providerCalls: 7,
    })
    expect(planAiExecution(saved, {
      kind: 'followUp',
      providerModelId: 'provider/frozen-run-model',
    })).toMatchObject({
      version: 1,
      visibleTurns: 1,
      providerCalls: 1,
      providerCallManifest: [{
        callClass: 'follow-up',
        providerModelId: 'provider/frozen-run-model',
      }],
    })
    expect(planAiExecution(saved, { kind: 'modComposed' })).toMatchObject({
      version: 1,
      visibleTurns: 0,
      providerCalls: 0,
    })
  })

  it('counts ordinary Conversation speaker naming once and not as a visible turn', () => {
    const saved = board(
      [
        { ...card('conversation', 'conversation', 'Discuss.'), conversationTurns: 2 },
        { ...card('named', 'askAi', 'Support.'), title: 'Analyst' },
        card('untitled', 'askAi', 'Challenge.'),
      ],
      [
        conn('named-conversation', 'named', 'conversation'),
        conn('untitled-conversation', 'untitled', 'conversation'),
      ],
    )
    expect(planAiExecution(saved, {
      kind: 'conversation',
      conversationCardId: 'conversation',
      count: 2,
    })).toMatchObject({
      version: 1,
      visibleTurns: 8,
      providerCalls: 9,
      providerCallManifest: [
        { callClass: 'speaker-name', providerModelId: 'default/model' },
        { callClass: 'visible-reply', providerModelId: 'default/model' },
        { callClass: 'visible-reply', providerModelId: 'default/model' },
        { callClass: 'visible-reply', providerModelId: 'default/model' },
        { callClass: 'visible-reply', providerModelId: 'default/model' },
        { callClass: 'visible-reply', providerModelId: 'default/model' },
        { callClass: 'visible-reply', providerModelId: 'default/model' },
        { callClass: 'visible-reply', providerModelId: 'default/model' },
        { callClass: 'visible-reply', providerModelId: 'default/model' },
      ],
    })
  })

  it('uses an invocation round override for exact Conversation admission', () => {
    const saved = board(
      [
        { ...card('conversation', 'conversation', 'Discuss.'), conversationTurns: 6 },
        { ...card('participant', 'askAi', 'Support.'), title: 'Analyst' },
      ],
      [conn('participant-conversation', 'participant', 'conversation')],
    )

    expect(planAiExecution(saved, {
      kind: 'conversation',
      conversationCardId: 'conversation',
      turnsPerParticipant: 1,
    })).toMatchObject({
      version: 1,
      visibleTurns: 1,
      providerCalls: 1,
    })
  })

  it('counts uncached compaction as hidden provider work', () => {
    const oversizedContext = 'Constraint worth preserving. '.repeat(22_000)
    const saved = board(
      [card('ask', 'askAi', 'Synthesize.'), card('weak-context', 'note', oversizedContext)],
      [{ ...conn('weak-ask', 'weak-context', 'ask'), strength: 'weak' }],
    )

    expect(planAiExecution(saved, { kind: 'ask', askAiCardId: 'ask' })).toMatchObject({
      version: 1,
      visibleTurns: 1,
      providerCalls: 2,
      providerCallManifest: [
        // Compaction names the Idea's own model, because summarising inherits
        // the Idea's provider, model, and effort (ADR 0015 as amended by
        // #1123). There is no separate cheap summariser to name here.
        { callClass: 'context-compaction', providerModelId: 'default/model' },
        { callClass: 'visible-reply', providerModelId: 'default/model' },
      ],
    })
    // One model for both calls, so the planned set is that one model. The
    // hidden call is still counted above, which is what this test is about.
    expect(planAiExecution(saved, { kind: 'ask', askAiCardId: 'ask' })?.providerCallManifest
      .map((call) => call.providerModelId))
      .toEqual(['default/model', 'default/model'])
  })

  it('interleaves each chain step compaction immediately before that visible reply', () => {
    const oversizedA = 'First constraint. '.repeat(45_000)
    const oversizedB = 'Second constraint. '.repeat(45_000)
    const saved = board(
      [
        card('ask-a', 'askAi', 'Step A'),
        card('ask-b', 'askAi', 'Step B'),
        card('context-a', 'note', oversizedA),
        card('context-b', 'note', oversizedB),
      ],
      [
        { ...conn('context-a-ask-a', 'context-a', 'ask-a'), strength: 'weak' },
        { ...conn('context-b-ask-b', 'context-b', 'ask-b'), strength: 'weak' },
      ],
    )

    expect(planAiExecution(saved, {
      kind: 'chain',
      targetAskAiCardId: 'ask-b',
      askAiCardIds: ['ask-a', 'ask-b'],
    })?.providerCallManifest).toEqual([
      // Each compaction names the Idea's own model (ADR 0015 as amended by
      // #1123). The order is what this test guards: a step's compaction sits
      // immediately before that step's visible reply.
      {
        callClass: 'context-compaction',
        providerModelId: 'default/model',
        optional: true,
      },
      { callClass: 'visible-reply', providerModelId: 'default/model' },
      {
        callClass: 'context-compaction',
        providerModelId: 'default/model',
        optional: true,
      },
      { callClass: 'visible-reply', providerModelId: 'default/model' },
    ])
  })

  it('refreshes an initially current Group only after its upstream Ask invalidates it', () => {
    const askA = card('ask-a', 'askAi', 'Update the evidence.')
    const resultA = { ...card('result-a', 'result', 'Prior evidence.'), groupId: 'group' }
    const group = card('group', 'group')
    const askB = card('ask-b', 'askAi', 'Use the refreshed evidence.')
    const initial = board(
      [askA, resultA, group, askB],
      [
        conn('ask-a-result-a', 'ask-a', 'result-a'),
        conn('group-ask-b', 'group', 'ask-b', { meta: { groupMode: 'compress' } }),
      ],
    )
    const digestKey = groupDigestCacheKey(initial, group, [resultA], 'default/model')
    const saved: SavedBoard = {
      ...initial,
      outputs: [{
        id: 'group-output',
        resultCardId: 'group',
        chosenVersionId: 'group-version',
        versions: [{
          id: 'group-version',
          number: 1,
          text: 'Current digest.',
          createdAt: '2026-08-14T00:00:00.000Z',
          fromRunId: 'group-run',
          digestKey,
        }],
      }],
    }

    expect(planAiExecution(saved, {
      kind: 'chain',
      targetAskAiCardId: 'ask-b',
      askAiCardIds: ['ask-a', 'ask-b'],
    })?.providerCallManifest).toEqual([
      { callClass: 'visible-reply', providerModelId: 'default/model' },
      { callClass: 'group-digest', providerModelId: 'default/model' },
      {
        callClass: 'context-compaction',
        providerModelId: 'default/model',
        optional: true,
      },
      { callClass: 'visible-reply', providerModelId: 'default/model' },
    ])
  })
})
