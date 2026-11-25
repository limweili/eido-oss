import { describe, expect, it } from 'vitest'
import type { Card, Connection, Output, SavedBoard } from '../graph/types'
import { gatherConnectedThought } from './compiler'

function card(
  id: string,
  kind: Card['kind'],
  text: string,
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

function board(cards: Card[], connections: Connection[], outputs: Output[] = []): SavedBoard {
  return {
    version: 1,
    cards,
    connections,
    outputs,
    runs: [],
    updatedAt: '',
  }
}

const BUILD_ON_FRAMING = "Use this as primary material. Preserve the user's framing and build directly from it."
const INFLUENCES_FRAMING =
  'Use these as ambient color and secondary signals. Let them subtly shape tone, associations, and options, but do not treat them as requirements or make them the focal point.'
const ALREADY_EXPLORED_FRAMING =
  'These are explored dead ends. Do not reuse their approach or merely avoid their exact words; steer toward structurally different directions.'

describe('compiler golden prompts (new section architecture)', () => {
  it('locks direct, light, avoid, groups, result versions, note bodies, and reasons', () => {
    const ask = card('ask', 'askAi', 'Draft the launch narrative for Eido.')
    const audience = card(
      'audience',
      'note',
      'Independent product builders who dislike prompt fiddling.',
      { title: 'Audience' },
    )
    const mood = card(
      'mood',
      'note',
      'Quiet tools that feel precise rather than theatrical.',
      { title: 'Reference mood' },
    )
    const rejected = card(
      'rejected',
      'note',
      'Position Eido as an AI project manager with dashboards.',
      { title: 'Rejected angle' },
    )
    const result = card('result', 'result', '')
    const groupFull = card('voice-group', 'group', '', { title: 'Voice stack' })
    const calm = card('calm', 'note', 'Keep sentences short and composed.', {
      title: 'Calm voice',
      groupId: 'voice-group',
    })
    const concrete = card('concrete', 'note', 'Use tangible workflow details.', {
      title: 'Concrete detail',
      groupId: 'voice-group',
    })
    const groupDigest = card('research-group', 'group', '', { title: 'Prior research' })
    const saved = board(
      [ask, audience, mood, rejected, result, groupFull, calm, concrete, groupDigest],
      [
        conn('c-audience', 'audience', 'ask', { meta: { contextOrder: 0 } }),
        conn('c-mood', 'mood', 'ask', { strength: 'weak', meta: { contextOrder: 1 } }),
        conn('c-rejected', 'rejected', 'ask', {
          polarity: 'pushesAgainst',
          reason: 'too operational and generic',
          meta: { contextOrder: 2 },
        }),
        conn('c-result', 'result', 'ask', { meta: { contextOrder: 3 } }),
        conn('c-group-full', 'voice-group', 'ask', { meta: { contextOrder: 4, groupMode: 'full' } }),
        conn('c-group-digest', 'research-group', 'ask', {
          meta: { contextOrder: 5, groupMode: 'compress' },
        }),
      ],
      [
        {
          id: 'out-result',
          resultCardId: 'result',
          chosenVersionId: 'v2',
          versions: [
            {
              id: 'v1',
              number: 1,
              text: 'Old route: make a generic productivity app.',
              createdAt: '2026-07-06T00:00:00.000Z',
              fromRunId: 'run-1',
            },
            {
              id: 'v2',
              number: 2,
              text: 'Chosen route: spatial thinking partner.\nMake the board feel like arranging thought.',
              createdAt: '2026-07-06T00:00:00.000Z',
              fromRunId: 'run-2',
            },
          ],
        },
        {
          id: 'out-digest',
          resultCardId: 'research-group',
          chosenVersionId: 'digest-v1',
          versions: [
            {
              id: 'digest-v1',
              number: 1,
              text: 'Digest: local-first users want visible provenance.',
              createdAt: '2026-07-06T00:00:00.000Z',
              fromRunId: 'run-digest',
            },
          ],
        },
      ],
    )

    const compiled = gatherConnectedThought(saved, 'ask')

    expect(compiled.text).toBe(
      '## TASK\n' +
        'Draft the launch narrative for Eido.\n' +
        '\n' +
        '## BUILD ON\n' +
        BUILD_ON_FRAMING +
        '\n' +
        '- Audience: Independent product builders who dislike prompt fiddling.\n' +
        '- Chosen route: spatial thinking partner.\n' +
        'Make the board feel like arranging thought.\n' +
        '- Voice stack: Calm voice\n' +
        'Type: Note\n' +
        'Title: Calm voice\n' +
        'Text:\n' +
        'Keep sentences short and composed.\n' +
        '\n' +
        'Concrete detail\n' +
        'Type: Note\n' +
        'Title: Concrete detail\n' +
        'Text:\n' +
        'Use tangible workflow details.\n' +
        '- Prior research: Digest: local-first users want visible provenance.\n' +
        '\n' +
        '## INFLUENCES\n' +
        INFLUENCES_FRAMING +
        '\n' +
        '- Reference mood: Quiet tools that feel precise rather than theatrical.\n' +
        '\n' +
        '## ALREADY EXPLORED — do not retread\n' +
        ALREADY_EXPLORED_FRAMING +
        '\n' +
        '- Rejected angle: Position Eido as an AI project manager with dashboards.\n' +
        '  Reason this path died: too operational and generic',
    )
  })

  it('locks budget compaction against the new context sections', () => {
    const ask = card('ask-budget', 'askAi', 'Synthesize the plan without dropping the request.')
    const direct = card(
      'direct-budget',
      'note',
      'Primary material stays full even when another card is compacted.',
      { title: 'Primary material' },
    )
    const light = card(
      'light-budget',
      'note',
      'Light background detail that can safely become a compact cached summary.',
      { title: 'Ambient detail' },
    )
    const saved = board(
      [ask, direct, light],
      [
        conn('c-direct-budget', 'direct-budget', 'ask-budget', { meta: { contextOrder: 0 } }),
        conn('c-light-budget', 'light-budget', 'ask-budget', {
          strength: 'weak',
          meta: { contextOrder: 1 },
        }),
      ],
    )

    const compiled = gatherConnectedThought(saved, 'ask-budget', {
      budgetTokens: 100_000,
      mode: 'eager',
      summaries: new Map([['light-budget', 'Compact light summary: keep this only as atmosphere.']]),
    })

    expect(compiled.text).toBe(
      '## TASK\n' +
        'Synthesize the plan without dropping the request.\n' +
        '\n' +
        '## BUILD ON\n' +
        BUILD_ON_FRAMING +
        '\n' +
        '- Primary material: Primary material stays full even when another card is compacted.\n' +
        '\n' +
        '## INFLUENCES\n' +
        INFLUENCES_FRAMING +
        '\n' +
        '- Ambient detail: Compact light summary: keep this only as atmosphere.',
    )
    expect(compiled.budget?.compactedCardIds).toEqual(['light-budget'])
    expect(compiled.compactionInputs).toEqual({
      'light-budget': 'Light background detail that can safely become a compact cached summary.',
    })
  })
})
