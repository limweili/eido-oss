import { describe, expect, it } from 'vitest'
import type { Card, Connection, Output, SavedBoard } from '../graph/types'
import { createSeedMod } from '../mods/seeds'
import {
  buildGroupDigestInstruction,
  groupDigestCacheKey,
  groupDigestInput,
  groupRelationshipText,
  isDigestCurrent,
} from './groupDigestFreshness'

const group = (prompt = 'Sum this up'): Card => ({
  id: 'group-1',
  kind: 'group',
  title: 'Brand voice',
  blocks: [{ id: 'blk-group', text: '' }],
  compressionPrompt: prompt,
  position: { x: 0, y: 0 },
})

const note = (id: string, text: string): Card => ({
  id,
  kind: 'note',
  blocks: [{ id: `blk-${id}`, text }],
  position: { x: 0, y: 0 },
  groupId: 'group-1',
})

const askAi = (text = 'What comes next?'): Card => ({
  id: 'ask-1',
  kind: 'askAi',
  blocks: [{ id: 'blk-ask', text }],
  model: 'openai/gpt-4o',
  position: { x: 0, y: 0 },
  groupId: 'group-1',
})

const mod = (value = 5): Card => {
  const seed = createSeedMod('slider', {
    title: 'Idea pressure',
    createId: (_, ordinal) => `seed-${ordinal}`,
  })
  return {
    id: 'mod-1',
    kind: 'mod',
    blocks: [{ id: 'blk-mod', text: '' }],
    position: { x: 0, y: 0 },
    groupId: 'group-1',
    modV2: {
      ...seed,
      state: {
        ...seed.state,
        items: [{ id: 'novelty', label: 'Novelty', v: value * 10, frame: '' }],
      },
    },
  }
}

const result = (): Card => ({
  id: 'result-1',
  kind: 'result',
  title: 'Answer',
  blocks: [{ id: 'blk-result', text: '' }],
  position: { x: 0, y: 0 },
  groupId: 'group-1',
})

function board(cards: Card[], outputs: Output[] = [], connections: Connection[] = []): SavedBoard {
  return {
    version: 1,
    cards: [group(), ...cards],
    connections,
    outputs,
    runs: [],
    updatedAt: '',
  }
}

function outputWith(key: string): Output {
  return {
    id: 'out-1',
    resultCardId: 'group-1',
    chosenVersionId: 'ver-1',
    versions: [
      {
        id: 'ver-1',
        number: 1,
        text: 'Clear, dry, exact.',
        createdAt: '2026-06-16T00:00:00.000Z',
        fromRunId: 'run-1',
        digestKey: key,
      },
    ],
  }
}

describe('group digest freshness', () => {
  it('produces a stable key for the same prompt and member text', () => {
    const members = [note('a', 'Be plain.'), note('b', 'Avoid hype.')]
    const saved = board(members)

    expect(groupDigestCacheKey(saved, group(), members)).toBe(groupDigestCacheKey(saved, group(), members))
  })

  it('reports the chosen digest current for the same inputs', () => {
    const members = [note('a', 'Be plain.'), note('b', 'Avoid hype.')]
    const saved = board(members)
    const key = groupDigestCacheKey(saved, group(), members)

    expect(isDigestCurrent(outputWith(key), key)).toBe(true)
  })

  it('reports stale when the prompt changes', () => {
    const members = [note('a', 'Be plain.'), note('b', 'Avoid hype.')]
    const saved = board(members)
    const oldKey = groupDigestCacheKey(saved, group('Sum this up'), members)
    const newKey = groupDigestCacheKey(saved, group('Keep only constraints'), members)

    expect(isDigestCurrent(outputWith(oldKey), newKey)).toBe(false)
  })

  it('reports stale when a member note changes', () => {
    const oldMembers = [note('a', 'Be plain.'), note('b', 'Avoid hype.')]
    const newMembers = [note('a', 'Be plain.'), note('b', 'Avoid jokes.')]
    const oldKey = groupDigestCacheKey(board(oldMembers), group(), oldMembers)
    const newKey = groupDigestCacheKey(board(newMembers), group(), newMembers)

    expect(isDigestCurrent(outputWith(oldKey), newKey)).toBe(false)
  })

  it('binds member assets and provider-facing Board settings into digest freshness', () => {
    const member = {
      ...note('a', 'Use the attached evidence.'),
      assets: [{
        id: 'asset-1',
        kind: 'image' as const,
        name: 'evidence.png',
        mimeType: 'image/png',
        dataUrl: 'data:image/png;base64,aaa',
        size: 3,
        createdAt: '2026-06-16T00:00:00.000Z',
      }],
    }
    const saved = {
      ...board([member]),
      aiSettings: {
        model: 'openai/gpt-4o',
        models: ['openai/gpt-4o'],
        reasoningEffort: 'medium' as const,
        systemPrompt: '',
      },
    }
    const changedAsset = {
      ...saved,
      cards: saved.cards.map((candidate) => candidate.id === member.id
        ? {
            ...candidate,
            assets: candidate.assets?.map((asset) => ({
              ...asset,
              dataUrl: 'data:image/png;base64,bbb',
            })),
          }
        : candidate),
    }
    const changedPrompt = {
      ...saved,
      aiSettings: { ...saved.aiSettings, systemPrompt: 'Preserve visual details.' },
    }
    const changedReasoning = {
      ...saved,
      aiSettings: { ...saved.aiSettings, reasoningEffort: 'high' as const },
    }
    const changedProvider = {
      ...saved,
      aiSettings: { ...saved.aiSettings, provider: 'codex' as const },
    }
    const renamedGroup = { ...group(), title: 'Renamed voice' }

    expect(new Set([
      groupDigestCacheKey(saved, group(), [member], 'openai/gpt-4o'),
      groupDigestCacheKey(changedAsset, group(), [changedAsset.cards[1]!], 'openai/gpt-4o'),
      groupDigestCacheKey(changedPrompt, group(), [member], 'openai/gpt-4o'),
      groupDigestCacheKey(changedReasoning, group(), [member], 'openai/gpt-4o'),
      groupDigestCacheKey(changedProvider, group(), [member], 'openai/gpt-4o'),
      groupDigestCacheKey(saved, renamedGroup, [member], 'openai/gpt-4o'),
    ])).toHaveProperty('size', 6)
    expect(buildGroupDigestInstruction(saved, renamedGroup, [member]))
      .not.toBe(buildGroupDigestInstruction(saved, group(), [member]))
  })

  it('includes ask ai tasks, mod variables, and result versions in the digest input', () => {
    const members = [askAi(), mod(7), result()]
    const saved = board(members, [
      {
        id: 'out-result',
        resultCardId: 'result-1',
        chosenVersionId: 'ver-2',
        versions: [
          {
            id: 'ver-1',
            number: 1,
            text: 'First answer.',
            createdAt: '2026-06-16T00:00:00.000Z',
            fromRunId: 'run-1',
          },
          {
            id: 'ver-2',
            number: 2,
            text: 'Second answer.',
            createdAt: '2026-06-16T00:00:00.000Z',
            fromRunId: 'run-2',
            accepted: true,
          },
        ],
      },
    ])

    const input = groupDigestInput(saved, group(), members)

    expect(input).toContain('Question or action:\nWhat comes next?')
    expect(input).not.toContain('Intent signal:')
    expect(input).not.toContain('Model:')
    expect(input).toContain('Mod title: Idea pressure')
    expect(input).toContain('How to read it: Each value runs 0 to 100')
    expect(input).toContain('Novelty: 70%.')
    expect(input).toContain('v1:\nFirst answer.')
    expect(input).toContain('v2 (chosen, kept):\nSecond answer.')
  })

  it('carries the chosen version follow-up thread into the digest input and cache key', () => {
    const members = [result()]
    const followUp = (id: string, role: 'user' | 'assistant', text: string) => ({
      id,
      role,
      text,
      createdAt: '2026-06-16T00:00:00.000Z',
      status: 'complete' as const,
    })
    const resultOutput = (withThread: boolean): Output => ({
      id: 'out-result',
      resultCardId: 'result-1',
      chosenVersionId: 'ver-2',
      versions: [
        {
          id: 'ver-1',
          number: 1,
          text: 'First answer.',
          createdAt: '2026-06-16T00:00:00.000Z',
          fromRunId: 'run-1',
          // A non-chosen version's thread must not travel.
          followUpThread: { messages: [followUp('fu-x', 'user', 'Old-version question')] },
        },
        {
          id: 'ver-2',
          number: 2,
          text: 'Second answer.',
          createdAt: '2026-06-16T00:00:00.000Z',
          fromRunId: 'run-2',
          followUpThread: withThread
            ? {
                messages: [
                  followUp('fu-1', 'user', 'Why is it second?'),
                  followUp('fu-2', 'assistant', 'It replaced the first.'),
                ],
              }
            : undefined,
        },
      ],
    })

    const withThread = board(members, [resultOutput(true)])
    const input = groupDigestInput(withThread, group(), members)
    expect(input).toContain('Follow-up discussion on this result:')
    expect(input).toContain('User: Why is it second?')
    expect(input).toContain('Assistant: It replaced the first.')
    expect(input).not.toContain('Old-version question')
    expect(input.indexOf('Second answer.')).toBeLessThan(
      input.indexOf('Follow-up discussion on this result:'),
    )

    const without = board(members, [resultOutput(false)])
    expect(groupDigestCacheKey(withThread, group(), members)).not.toBe(
      groupDigestCacheKey(without, group(), members),
    )
  })

  it('adds a simple card-type guide and plain-English relationships to the instruction', () => {
    const members = [note('note-a', 'A useful distinction.'), askAi('Turn it into a song.'), mod(6)]
    const saved = board(members, [], [
      {
        id: 'conn-note-ask',
        from: { cardId: 'note-a' },
        to: { cardId: 'ask-1' },
        strength: 'strong',
        polarity: 'helps',
        role: 'feeds',
      },
      {
        id: 'conn-mod-ask',
        from: { cardId: 'mod-1' },
        to: { cardId: 'ask-1' },
        strength: 'weak',
        polarity: 'helps',
        role: 'modifies',
      },
    ])

    const instruction = buildGroupDigestInstruction(saved, group(), members)

    expect(instruction).not.toContain('Group intent:')
    expect(instruction).toContain('How to read these cards:')
    expect(instruction).toContain('Ask AI: a question or action')
    expect(instruction).toContain('Read its treatment first, then its statements in order.')
    expect(instruction).toContain('Relationships in this group:')
    expect(instruction).toContain('A useful distinction supports Turn it into a song as primary context.')
    expect(instruction).toContain('Idea pressure modifies how Turn it into a song should be interpreted.')
  })

  it('summarises negative relationships as constraints or tensions', () => {
    const members = [note('note-a', 'Keep it short.'), askAi('Write copy.')]
    const saved = board(members, [], [
      {
        id: 'conn-note-ask',
        from: { cardId: 'note-a' },
        to: { cardId: 'ask-1' },
        strength: 'weak',
        polarity: 'pushesAgainst',
        role: 'feeds',
      },
    ])

    expect(groupRelationshipText(saved, group(), members)).toBe(
      '- Keep it short creates a light constraint or tension for Write copy.',
    )
  })

  it('reports stale when a mod variable changes', () => {
    const oldMembers = [mod(3)]
    const newMembers = [mod(8)]
    const oldKey = groupDigestCacheKey(board(oldMembers), group(), oldMembers)
    const newKey = groupDigestCacheKey(board(newMembers), group(), newMembers)

    expect(isDigestCurrent(outputWith(oldKey), newKey)).toBe(false)
  })

  it('reports stale when an internal relationship changes', () => {
    const members = [note('note-a', 'Keep it short.'), askAi('Write copy.')]
    const oldBoard = board(members, [], [
      {
        id: 'conn-note-ask',
        from: { cardId: 'note-a' },
        to: { cardId: 'ask-1' },
        strength: 'strong',
        polarity: 'helps',
        role: 'feeds',
      },
    ])
    const newBoard = board(members, [], [
      {
        id: 'conn-note-ask',
        from: { cardId: 'note-a' },
        to: { cardId: 'ask-1' },
        strength: 'strong',
        polarity: 'pushesAgainst',
        role: 'feeds',
      },
    ])

    const oldKey = groupDigestCacheKey(oldBoard, group(), members)
    const newKey = groupDigestCacheKey(newBoard, group(), members)

    expect(isDigestCurrent(outputWith(oldKey), newKey)).toBe(false)
  })
})
