import { describe, expect, it } from 'vitest'
import {
  buildCompactionInstruction,
  compactionStep,
  COMPACTION_MIN_MATERIAL_TOKENS,
  COMPACTION_STEP_KEEP_CHARS,
  COMPACTION_TAIL_KEEP_TOKENS,
  compactionMaterialFloor,
  compactionTailBudget,
  estimateConversationTokens,
  planCompaction,
  rebuildConversation,
  renderCompactionMaterial,
  splitConversation,
} from './conversationCompaction'
import type { ChatMessage } from './openRouter'

// A 128k model's threshold, where the fixed ceilings win over the scaled ones.
const ORDINARY_THRESHOLD = 102_400

const PREFIX: ChatMessage[] = [
  { role: 'system', content: 'Idea guidance.' },
  { role: 'system', content: 'You are Eido, a thinking partner.' },
  { role: 'system', content: 'The travelling brief.' },
  { role: 'user', content: 'The compiled instruction the person shaped.' },
]

// One assistant turn that called a tool, plus the result answering it. The
// unit compaction must never cut through.
function block(index: number, resultChars: number): ChatMessage[] {
  return [
    {
      role: 'assistant',
      content: `Thinking about step ${index}.`,
      tool_calls: [
        {
          id: `call_${index}`,
          type: 'function',
          function: { name: 'web_search', arguments: `{"query":"question ${index}"}` },
        },
      ],
    },
    { role: 'tool', tool_call_id: `call_${index}`, content: `result ${index} `.padEnd(resultChars, 'x') },
  ]
}

function conversationOf(blockCount: number, resultChars: number): ChatMessage[] {
  const messages = [...PREFIX]
  for (let index = 0; index < blockCount; index += 1) messages.push(...block(index, resultChars))
  return messages
}

// The rule that fails at the provider rather than in a unit test: every tool
// message answers a call that is still present, and every call still present
// is answered.
function pairingBreaks(messages: readonly ChatMessage[]): string[] {
  const problems: string[] = []
  const answered = new Set<string>()
  const offered = new Set<string>()
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.tool_calls ?? []) offered.add(call.id)
    }
    if (message.role === 'tool') {
      if (!offered.has(message.tool_call_id)) problems.push(`orphan result ${message.tool_call_id}`)
      answered.add(message.tool_call_id)
    }
  }
  for (const id of offered) if (!answered.has(id)) problems.push(`unanswered call ${id}`)
  return problems
}

describe('reading a loop conversation', () => {
  it('treats everything up to and including the instruction as untouchable', () => {
    const { prefix, blocks } = splitConversation(conversationOf(2, 100))
    expect(prefix).toEqual(PREFIX)
    expect(blocks).toHaveLength(2)
  })

  it('keeps an assistant turn and every result answering it in one block', () => {
    const messages = [...PREFIX]
    messages.push({
      role: 'assistant',
      content: '',
      tool_calls: [
        { id: 'a', type: 'function', function: { name: 'web_search', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'web_search', arguments: '{}' } },
      ],
    })
    messages.push({ role: 'tool', tool_call_id: 'a', content: 'one' })
    messages.push({ role: 'tool', tool_call_id: 'b', content: 'two' })

    const { blocks } = splitConversation(messages)
    expect(blocks).toHaveLength(1)
    expect(blocks[0].messages).toHaveLength(3)
  })

  it('gives a note the loop appended on its own a block of its own', () => {
    const messages = [...conversationOf(1, 100), { role: 'system', content: 'Stop calling tools.' } as ChatMessage]
    const { blocks } = splitConversation(messages)
    expect(blocks).toHaveLength(2)
    expect(blocks[1].messages).toHaveLength(1)
  })

  it('counts tool-call arguments, not only prose', () => {
    const bare: ChatMessage[] = [{ role: 'assistant', content: '', tool_calls: [] }]
    const withCall: ChatMessage[] = [
      {
        role: 'assistant',
        content: '',
        tool_calls: [
          { id: 'a', type: 'function', function: { name: 'web_search', arguments: '{"query":"a rather long query"}' } },
        ],
      },
    ]
    expect(estimateConversationTokens(withCall)).toBeGreaterThan(estimateConversationTokens(bare))
  })
})

describe('planning a cut', () => {
  it('declines when there is nothing but the instruction', () => {
    expect(planCompaction(PREFIX, ORDINARY_THRESHOLD)).toBeNull()
  })

  it('declines when the material is too small to be worth a call', () => {
    expect(planCompaction(conversationOf(2, 200), ORDINARY_THRESHOLD)).toBeNull()
  })

  it('always leaves something to summarise, even with one block', () => {
    const plan = planCompaction(conversationOf(1, COMPACTION_MIN_MATERIAL_TOKENS * 4 + 1000), ORDINARY_THRESHOLD)
    expect(plan).not.toBeNull()
    expect(plan!.summarize).toHaveLength(1)
    expect(plan!.tail).toHaveLength(0)
  })

  it('keeps the freshest blocks whole while the tail budget holds', () => {
    // Six blocks of roughly 6k tokens each: the tail budget takes two.
    const plan = planCompaction(conversationOf(6, 20_000), ORDINARY_THRESHOLD)
    expect(plan).not.toBeNull()
    expect(plan!.tail).toHaveLength(2)
    expect(plan!.summarize).toHaveLength(4)
    const tailTokens = plan!.tail.reduce((total, entry) => total + entry.tokens, 0)
    expect(tailTokens).toBeLessThanOrEqual(COMPACTION_TAIL_KEEP_TOKENS)
  })

  it('summarises a block too large for the tail budget rather than keeping it', () => {
    const plan = planCompaction(conversationOf(3, COMPACTION_TAIL_KEEP_TOKENS * 4 + 4000), ORDINARY_THRESHOLD)
    expect(plan).not.toBeNull()
    expect(plan!.tail).toHaveLength(0)
    expect(plan!.summarize).toHaveLength(3)
  })

  it('can still cut a run on a small window, where a fixed tail would be the whole run', () => {
    // A 16k model: threshold 13,107, so a fixed 12,000-token tail would keep
    // everything but the first block whole and leave too little to reach a
    // fixed 8,000-token floor. Nothing would ever be cut and the run would walk
    // into the refusal this exists to prevent.
    const threshold = Math.floor(16_384 * 0.8)
    const plan = planCompaction(conversationOf(4, 14_000), threshold)

    expect(plan).not.toBeNull()
    expect(plan!.summarize.length).toBeGreaterThan(0)
    const tailTokens = plan!.tail.reduce((total, entry) => total + entry.tokens, 0)
    expect(tailTokens).toBeLessThanOrEqual(compactionTailBudget(threshold))
    expect(plan!.materialTokens).toBeGreaterThanOrEqual(compactionMaterialFloor(threshold))
  })
})

describe('rebuilding the conversation', () => {
  it('never separates a call from its result, whatever the shape', () => {
    for (const blockCount of [1, 2, 3, 5, 6, 9]) {
      for (const chars of [24_000, 60_000, 200_000]) {
        const messages = conversationOf(blockCount, chars)
        const plan = planCompaction(messages, ORDINARY_THRESHOLD)
        if (!plan) continue
        const rebuilt = rebuildConversation(plan, 'The note.')
        expect(pairingBreaks(rebuilt)).toEqual([])
      }
    }
  })

  it('keeps the framing and the instruction verbatim and carries the note', () => {
    const plan = planCompaction(conversationOf(6, 20_000), ORDINARY_THRESHOLD)!
    const rebuilt = rebuildConversation(plan, 'What we found.')

    expect(rebuilt.slice(0, PREFIX.length)).toEqual(PREFIX)
    const note = rebuilt[PREFIX.length]
    expect(note.role).toBe('user')
    expect(String(note.content)).toContain('What we found.')
    expect(String(note.content)).toContain('only record')
  })

  it('is smaller than what it replaced', () => {
    const messages = conversationOf(6, 20_000)
    const plan = planCompaction(messages, ORDINARY_THRESHOLD)!
    const rebuilt = rebuildConversation(plan, 'A short note.')
    expect(estimateConversationTokens(rebuilt)).toBeLessThan(estimateConversationTokens(messages))
  })

  it('folds an earlier note into the next one rather than stacking them', () => {
    const plan = planCompaction(conversationOf(3, 60_000), ORDINARY_THRESHOLD)!
    const material = renderCompactionMaterial(plan.summarize, 'The earlier note.')
    expect(material).toContain('The earlier note.')
    expect(material.indexOf('The earlier note.')).toBeLessThan(material.indexOf('result 0'))
  })
})

describe('what the summariser is asked for', () => {
  it('asks for the five things a stopped run needs to be picked up', () => {
    const instruction = buildCompactionInstruction('some record')
    for (const heading of [
      'What this run was asked for',
      'What has been established',
      'What did not work',
      'What is still open',
      'What to do next',
    ]) {
      expect(instruction).toContain(heading)
    }
    expect(instruction).toContain('some record')
  })

  it('renders what a lookup actually returned, as the evidence behind the note', () => {
    const plan = planCompaction(conversationOf(3, 60_000), ORDINARY_THRESHOLD)!
    const material = renderCompactionMaterial(plan.summarize)
    expect(material).toContain('The run used web_search with: {"query":"question 0"}')
    expect(material).toContain('That returned:')
  })
})

describe('the trail row', () => {
  it('carries the note itself', () => {
    expect(compactionStep('  A short note.  ')).toEqual({ kind: 'compaction', detail: 'A short note.' })
  })

  it('caps a long note and marks the cut', () => {
    const step = compactionStep('word '.repeat(2000))
    expect(step.detail.length).toBeLessThanOrEqual(COMPACTION_STEP_KEEP_CHARS + 2)
    expect(step.detail.endsWith('…')).toBe(true)
  })
})
