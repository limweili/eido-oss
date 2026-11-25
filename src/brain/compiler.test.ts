import { describe, expect, it } from 'vitest'
import type { Card, Connection, FollowUpMessage, Output, SavedBoard } from '../graph/types'
import { gatherConnectedThought } from './compiler'
import { compactionFingerprint, gatherConnectedThoughtWithCachedSummaries, validCachedSummaries } from './contextCompaction'

const ask: Card = {
  id: 'ask-1',
  kind: 'askAi',
  blocks: [{ id: 'ask-block', text: 'Write the landing page copy.' }],
  position: { x: 0, y: 0 },
}

const group: Card = {
  id: 'group-1',
  kind: 'group',
  title: 'Brand voice',
  blocks: [{ id: 'group-block', text: '' }],
  compressionPrompt: 'Boil this down.',
  position: { x: 0, y: 0 },
}

const noteA: Card = {
  id: 'note-a',
  kind: 'note',
  title: 'Tone',
  blocks: [{ id: 'note-a-block', text: 'Sound calm and precise.' }],
  position: { x: 0, y: 0 },
  groupId: 'group-1',
}

const noteB: Card = {
  id: 'note-b',
  kind: 'note',
  title: 'Avoid',
  blocks: [{ id: 'note-b-block', text: 'Avoid breathless hype.' }],
  position: { x: 0, y: 0 },
  groupId: 'group-1',
}

const outsideNote: Card = {
  id: 'note-c',
  kind: 'note',
  title: 'Audience',
  blocks: [{ id: 'note-c-block', text: 'Experienced founders.' }],
  position: { x: 0, y: 0 },
}

const outsideLinkedNote: Card = {
  id: 'note-chicken',
  kind: 'note',
  title: 'Animals',
  blocks: [{ id: 'note-chicken-block', text: 'Chicken' }],
  position: { x: 0, y: 0 },
}

function conn(
  id: string,
  from: string,
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: 'ask-1' },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    ...overrides,
  }
}

function board(connections: Connection[], outputs: Output[] = []): SavedBoard {
  return {
    version: 1,
    cards: [ask, group, noteA, noteB, outsideNote, outsideLinkedNote],
    connections,
    outputs,
    runs: [],
    updatedAt: '',
  }
}

function digestOutput(text = 'Use quiet authority.'): Output {
  return {
    id: 'out-group',
    resultCardId: 'group-1',
    chosenVersionId: 'ver-digest',
    versions: [
      {
        id: 'ver-digest',
        number: 1,
        text,
        createdAt: '2026-06-16T00:00:00.000Z',
        fromRunId: 'run-digest',
        digestKey: 'digest-key',
      },
    ],
  }
}

describe('group-aware compiler', () => {
  it('inlines a Full group as one important chunk under the group name', () => {
    const compiled = gatherConnectedThought(board([conn('conn-group', 'group-1')]), 'ask-1')

    expect(compiled.sections.buildOn).toHaveLength(1)
    expect(compiled.sections.buildOn[0]).toMatchObject({
      label: 'Brand voice',
      groupMode: 'full',
      connectionId: 'conn-group',
    })
    expect(compiled.sections.buildOn[0].text).toContain('Sound calm and precise.')
    expect(compiled.sections.buildOn[0].text).toContain('Avoid breathless hype.')
    expect(compiled.text).toContain('- Brand voice:')
    expect(compiled.usedCardIds).toEqual(expect.arrayContaining(['group-1', 'note-a', 'note-b']))
  })

  it('sends a plain Ask with no intent language', () => {
    const compiled = gatherConnectedThought(board([conn('conn-note', 'note-c')]), 'ask-1')

    expect(compiled.text).not.toMatch(/intent/i)
  })

  it('never mentions highlights — they are visual-only and stay out of AI context', () => {
    const compiled = gatherConnectedThought(board([conn('conn-note', 'note-c')]), 'ask-1')

    expect(compiled.text.toLowerCase()).not.toContain('highlight')
  })

  it('weights the Full group once according to the connection', () => {
    const compiled = gatherConnectedThought(
      board([conn('conn-group', 'group-1', { strength: 'weak' })]),
      'ask-1',
    )

    expect(compiled.sections.buildOn).toHaveLength(0)
    expect(compiled.sections.influences).toHaveLength(1)
    expect(compiled.sections.influences[0].label).toBe('Brand voice')
  })

  it('uses the chosen digest as one Compress entry', () => {
    const compiled = gatherConnectedThought(
      board([conn('conn-group', 'group-1', { meta: { groupMode: 'compress' } })], [digestOutput()]),
      'ask-1',
    )

    expect(compiled.sections.buildOn).toEqual([
      expect.objectContaining({
        label: 'Brand voice',
        text: 'Use quiet authority.',
        groupMode: 'compress',
      }),
    ])
    expect(compiled.text).not.toContain('Avoid breathless hype.')
  })

  it('puts a negative Compress group in already explored anti-context', () => {
    const compiled = gatherConnectedThought(
      board(
        [
          conn('conn-group', 'group-1', {
            polarity: 'pushesAgainst',
            meta: { groupMode: 'compress' },
          }),
        ],
        [digestOutput('Never sound like a generic SaaS page.')],
      ),
      'ask-1',
    )

    expect(compiled.sections.alreadyExplored).toHaveLength(1)
    expect(compiled.sections.alreadyExplored[0].text).toBe('Never sound like a generic SaaS page.')
    expect(compiled.text).toContain('## ALREADY EXPLORED — do not retread')
  })

  it('honours context ordering for a group connection', () => {
    const compiled = gatherConnectedThought(
      board([
        conn('conn-note', 'note-c', { meta: { contextOrder: 1 } }),
        conn('conn-group', 'group-1', { meta: { contextOrder: 0 } }),
      ]),
      'ask-1',
    )

    expect(compiled.sections.buildOn.map((entry) => entry.connectionId)).toEqual([
      'conn-group',
      'conn-note',
    ])
  })

  it('ignores cards connected into the group itself until multi-step flow exists', () => {
    const compiled = gatherConnectedThought(
      board([
        {
          id: 'conn-chicken-group',
          from: { cardId: 'note-chicken' },
          to: { cardId: 'group-1' },
          strength: 'strong',
          polarity: 'helps',
          role: 'feeds',
        },
        conn('conn-group', 'group-1'),
      ]),
      'ask-1',
    )

    expect(compiled.text).toContain('Sound calm and precise.')
    expect(compiled.text).not.toContain('Chicken')
    expect(compiled.usedCardIds).not.toContain('note-chicken')
    expect(compiled.usedConnectionIds).not.toContain('conn-chicken-group')
  })
})

describe('context preview projection', () => {
  function previewCard(
    id: string,
    kind: Card['kind'],
    text: string,
    extra: Partial<Card> = {},
  ): Card {
    return {
      id,
      kind,
      blocks: [{ id: `${id}-block`, text }],
      position: { x: 0, y: 0 },
      ...extra,
    }
  }

  function previewConn(
    id: string,
    from: string,
    to = 'preview-ask',
    extra: Partial<Connection> = {},
  ): Connection {
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

  function previewBoard(cards: Card[], connections: Connection[]): SavedBoard {
    return {
      version: 1,
      cards,
      connections,
      outputs: [],
      runs: [],
      updatedAt: '',
    }
  }

  it('projects relation, hop, connection, and Avoid reason from the compile seam', () => {
    const ask = previewCard('preview-ask', 'askAi', 'Find a better launch angle.')
    const direct = previewCard('direct-note', 'note', 'Lead with the workflow pain.', { title: 'Primary' })
    const light = previewCard('light-note', 'note', 'Keep the tone exploratory.', { title: 'Ambient' })
    const upstream = previewCard('upstream-note', 'note', 'Earlier interviews mentioned setup cost.', {
      title: 'Interview thread',
    })
    const avoid = previewCard('avoid-note', 'note', 'Do not pitch it as generic productivity.', {
      title: 'Rejected path',
    })
    const saved = previewBoard(
      [ask, direct, light, upstream, avoid],
      [
        previewConn('conn-direct', 'direct-note', 'preview-ask', { meta: { contextOrder: 0 } }),
        previewConn('conn-light', 'light-note', 'preview-ask', {
          strength: 'weak',
          meta: { contextOrder: 1 },
        }),
        previewConn('conn-upstream', 'upstream-note', 'light-note'),
        previewConn('conn-avoid', 'avoid-note', 'preview-ask', {
          polarity: 'pushesAgainst',
          reason: 'too broad',
          meta: { contextOrder: 2 },
        }),
      ],
    )

    const compiled = gatherConnectedThought(saved, 'preview-ask')

    expect(
      compiled.preview.context.map(({ cardId, relation, hop, connectionId, connectionLabel, budgetStatus, reason }) => ({
        cardId,
        relation,
        hop,
        connectionId,
        connectionLabel,
        budgetStatus,
        reason,
      })),
    ).toEqual([
      {
        cardId: 'direct-note',
        relation: 'direct',
        hop: 1,
        connectionId: 'conn-direct',
        connectionLabel: 'From Primary',
        budgetStatus: 'full',
        reason: undefined,
      },
      {
        cardId: 'light-note',
        relation: 'light',
        hop: 1,
        connectionId: 'conn-light',
        connectionLabel: 'From Ambient',
        budgetStatus: 'full',
        reason: undefined,
      },
      {
        cardId: 'upstream-note',
        relation: 'light',
        hop: 2,
        connectionId: 'conn-upstream',
        connectionLabel: 'From Interview thread via Ambient',
        budgetStatus: 'full',
        reason: undefined,
      },
      {
        cardId: 'avoid-note',
        relation: 'avoid',
        hop: 1,
        connectionId: 'conn-avoid',
        connectionLabel: 'From Rejected path',
        budgetStatus: 'full',
        reason: 'too broad',
      },
    ])
    expect(compiled.sections.buildOn.map((entry) => entry.cardId)).toEqual(['direct-note'])
    expect(compiled.sections.influences.map((entry) => entry.cardId)).toEqual(['light-note', 'upstream-note'])
    expect(compiled.sections.alreadyExplored.map((entry) => entry.cardId)).toEqual(['avoid-note'])
  })

  it('projects compacted and dropped status without changing prompt section output rules', () => {
    const ask = previewCard('preview-ask', 'askAi', 'Summarise this.')
    const direct = previewCard('direct-note', 'note', 'Direct material '.repeat(80), { title: 'Direct' })
    const light = previewCard('light-note', 'note', 'Light material '.repeat(80), { title: 'Light' })
    const saved = previewBoard(
      [ask, direct, light],
      [
        previewConn('conn-direct', 'direct-note'),
        previewConn('conn-light', 'light-note', 'preview-ask', { strength: 'weak' }),
      ],
    )

    const compacted = gatherConnectedThought(saved, 'preview-ask', {
      budgetTokens: 100_000,
      mode: 'eager',
      summaries: new Map([['light-note', 'Short light summary.']]),
    })

    expect(compacted.preview.context.map((entry) => [entry.cardId, entry.budgetStatus, entry.text])).toEqual([
      ['direct-note', 'full', direct.blocks[0].text.trim()],
      ['light-note', 'compacted', 'Short light summary.'],
    ])
    expect(compacted.sections.influences[0]).toMatchObject({
      cardId: 'light-note',
      text: 'Short light summary.',
      compacted: true,
    })

    const dropped = gatherConnectedThought(saved, 'preview-ask', {
      budgetTokens: 1,
      mode: 'never',
      summaries: new Map(),
    })

    expect(dropped.preview.context.map((entry) => [entry.cardId, entry.budgetStatus])).toEqual([
      ['direct-note', 'dropped'],
      ['light-note', 'dropped'],
    ])
    expect(dropped.sections.buildOn).toEqual([])
    expect(dropped.sections.influences).toEqual([])
    expect(dropped.text).not.toContain('Direct material')
    expect(dropped.text).not.toContain('Light material')
  })

  it('uses the same cached summary state as the run compile without generating summaries', () => {
    const ask = previewCard('preview-ask', 'askAi', 'Summarise this.')
    const light = previewCard('light-note', 'note', 'Light material '.repeat(160), { title: 'Light' })
    const fullText = light.blocks[0].text.trim()
    const saved = {
      ...previewBoard(
        [ask, light],
        [previewConn('conn-light', 'light-note', 'preview-ask', { strength: 'weak' })],
      ),
      // Summaries are made with the Idea's own model, so a cached one only
      // counts while that selection stands.
      aiSettings: {
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini'],
        reasoningEffort: 'medium' as const,
      },
      compactionSummaries: [
        {
          cardId: 'light-note',
          fingerprint: compactionFingerprint(fullText, 'openai/gpt-4o-mini'),
          summary: 'Cached short light summary.',
          model: 'openai/gpt-4o-mini',
          createdAt: '2026-07-07T00:00:00.000Z',
        },
      ],
    }
    const budget = {
      budgetTokens: 220,
      mode: 'when-needed' as const,
    }

    const firstPass = gatherConnectedThought(saved, 'preview-ask', { ...budget, summaries: new Map() })
    expect(firstPass.preview.context[0]).toMatchObject({
      cardId: 'light-note',
      budgetStatus: 'will-compact',
      text: fullText,
    })

    const cached = validCachedSummaries(saved, firstPass.compactionInputs ?? {})
    const runFinalCompile = gatherConnectedThought(saved, 'preview-ask', { ...budget, summaries: cached })
    const previewCompile = gatherConnectedThoughtWithCachedSummaries(saved, 'preview-ask', budget)

    expect(previewCompile.preview.context.map(({ cardId, budgetStatus, text }) => ({ cardId, budgetStatus, text })))
      .toEqual(runFinalCompile.preview.context.map(({ cardId, budgetStatus, text }) => ({ cardId, budgetStatus, text })))
    expect(previewCompile.preview.context[0]).toMatchObject({
      cardId: 'light-note',
      budgetStatus: 'compacted',
      text: 'Cached short light summary.',
    })
  })

  it('does not reuse a compaction summary generated under a different system prompt', () => {
    const ask = previewCard('preview-ask', 'askAi', 'Summarise this.')
    const light = previewCard('light-note', 'note', 'Light material '.repeat(160), { title: 'Light' })
    const fullText = light.blocks[0].text.trim()
    const oldSystemPrompt = 'Write for technical readers.'
    const saved = {
      ...previewBoard(
        [ask, light],
        [previewConn('conn-light', 'light-note', 'preview-ask', { strength: 'weak' })],
      ),
      aiSettings: {
        model: 'openai/gpt-4o-mini',
        models: ['openai/gpt-4o-mini'],
        reasoningEffort: 'medium' as const,
        systemPrompt: 'Write for first-time founders.',
      },
      compactionSummaries: [
        {
          cardId: 'light-note',
          fingerprint: compactionFingerprint(fullText, 'openai/gpt-4o-mini', oldSystemPrompt),
          summary: 'Technical-reader summary.',
          model: 'openai/gpt-4o-mini',
          createdAt: '2026-07-07T00:00:00.000Z',
        },
      ],
    }

    expect(validCachedSummaries(saved, { 'light-note': fullText }).size).toBe(0)
  })
})

// --- a result card feeding a downstream Ask, with and without a follow-up thread ---

const askDown: Card = {
  id: 'ask-down',
  kind: 'askAi',
  blocks: [{ id: 'ask-down-block', text: 'Summarize the discussion.' }],
  position: { x: 0, y: 0 },
}

const resultCard: Card = {
  id: 'result-1',
  kind: 'result',
  blocks: [{ id: 'result-1-block', text: '' }],
  position: { x: 0, y: 0 },
}

function followUp(
  id: string,
  role: FollowUpMessage['role'],
  text: string,
  status: FollowUpMessage['status'] = 'complete',
): FollowUpMessage {
  return { id, role, text, createdAt: '2026-06-16T00:00:00.000Z', status }
}

function resultBoard(thread?: FollowUpMessage[]): SavedBoard {
  return {
    version: 1,
    cards: [askDown, resultCard],
    connections: [
      {
        id: 'conn-result',
        from: { cardId: 'result-1' },
        to: { cardId: 'ask-down' },
        strength: 'strong',
        polarity: 'helps',
        role: 'feeds',
      },
    ],
    outputs: [
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
            followUpThread: thread ? { messages: thread } : undefined,
          },
        ],
      },
    ],
    runs: [],
    updatedAt: '',
  }
}

// Pinned before follow-up threads joined downstream context: this exact text is
// what a thread-less result compiled to, byte for byte. It must never drift.
const PINNED_THREADLESS_INSTRUCTION =
  '## TASK\n' +
  'Summarize the discussion.\n' +
  '\n' +
  '## BUILD ON\n' +
  "Use this as primary material. Preserve the user's framing and build directly from it.\n" +
  '- Ship the beta on Friday.\nHold the mobile build.'

describe('result card follow-up context', () => {
  it('compiles a thread-less result byte-identically to the pinned baseline (characterization)', () => {
    const compiled = gatherConnectedThought(resultBoard(), 'ask-down')
    expect(compiled.text).toBe(PINNED_THREADLESS_INSTRUCTION)
  })

  it('compiles a thread of only empty and failed messages byte-identically to the baseline', () => {
    const compiled = gatherConnectedThought(
      resultBoard([
        followUp('fu-1', 'user', '   '),
        followUp('fu-2', 'assistant', 'half an answ', 'failed'),
      ]),
      'ask-down',
    )
    expect(compiled.text).toBe(PINNED_THREADLESS_INSTRUCTION)
  })

  it('appends the labelled follow-up discussion after the answer', () => {
    const compiled = gatherConnectedThought(
      resultBoard([
        followUp('fu-1', 'user', 'Why Friday?'),
        followUp('fu-2', 'assistant', 'The demo is ready.'),
        followUp('fu-3', 'assistant', 'And the team is', 'stopped'),
      ]),
      'ask-down',
    )

    const answerAt = compiled.text.indexOf('Ship the beta on Friday.')
    const discussionAt = compiled.text.indexOf('Follow-up discussion on this result:')
    expect(answerAt).toBeGreaterThan(-1)
    expect(discussionAt).toBeGreaterThan(answerAt)
    expect(compiled.text).toContain('User: Why Friday?')
    expect(compiled.text).toContain('Assistant: The demo is ready.')
    expect(compiled.text).toContain('Assistant (stopped early): And the team is')
  })

  it('keeps the context label (first line) unchanged when a thread is present', () => {
    const withThread = gatherConnectedThought(
      resultBoard([followUp('fu-1', 'user', 'Why Friday?')]),
      'ask-down',
    )
    const without = gatherConnectedThought(resultBoard(), 'ask-down')

    expect(withThread.sections.buildOn[0].label).toBe('Ship the beta on Friday.')
    expect(withThread.sections.buildOn[0].label).toBe(without.sections.buildOn[0].label)
  })

  it('follows the chosen version: only its thread travels downstream', () => {
    const saved = resultBoard([followUp('fu-1', 'user', 'Chosen-version question')])
    saved.outputs[0].versions.push({
      id: 'ver-2',
      number: 2,
      text: 'A different answer.',
      createdAt: '2026-06-16T00:00:00.000Z',
      fromRunId: 'run-2',
      followUpThread: { messages: [followUp('fu-x', 'user', 'Other-version question')] },
    })

    const compiled = gatherConnectedThought(saved, 'ask-down')
    expect(compiled.text).toContain('Chosen-version question')
    expect(compiled.text).not.toContain('Other-version question')
  })
})
