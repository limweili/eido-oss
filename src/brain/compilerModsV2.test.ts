import { describe, expect, it } from 'vitest'
import type { Card, Connection, SavedBoard } from '../graph/types'
import { createSeedMod } from '../mods/seeds'
import { snapshotModValues } from '../mods/snapshot'
import { gatherConnectedThought } from './compiler'

function card(id: string, kind: Card['kind'], text = '', overrides: Partial<Card> = {}): Card {
  return {
    id,
    kind,
    blocks: [{ id: `${id}-block`, text }],
    position: { x: 0, y: 0 },
    ...overrides,
  }
}

function connection(
  id: string,
  from: string,
  overrides: Partial<Connection> = {},
): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: 'ask' },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
    ...overrides,
  }
}

function board(cards: Card[], connections: Connection[]): SavedBoard {
  return { version: 1, cards, connections, outputs: [], runs: [], updatedAt: '' }
}

const PREAMBLE =
  'Mods are hand-set controls the user tuned for this request. Each one\n' +
  'states how to read its values, then speaks them. Follow them exactly.'

describe('v2 Mods in Ask compilation (#764)', () => {
  it('emits exact ordered entries per connection, including duplicate wires and visible silence', () => {
    const switches = createSeedMod('switch')
    const slider = createSeedMod('slider')
    const saved = board(
      [
        card('ask', 'askAi', 'Draft the launch note.'),
        card('switches', 'mod', '', { modV2: switches }),
        card('slider', 'mod', '', { modV2: slider }),
      ],
      [
        connection('slider-second', 'slider', { meta: { contextOrder: 2 } }),
        connection('switch-avoid', 'switches', {
          polarity: 'pushesAgainst',
          meta: { contextOrder: -1 },
        }),
        connection('slider-first', 'slider', { meta: { contextOrder: 1 } }),
        connection('switch-first', 'switches', { meta: { contextOrder: 0 } }),
      ],
    )

    const compiled = gatherConnectedThought(saved, 'ask')
    const switchEntry =
      '### SWITCHES\n' +
      'How to read it: Only statements switched on apply. Off means left out on purpose, do not infer it.\n' +
      '- Cite sources for every claim.\n' +
      '- End with a three-line summary.\n' +
      '- jargon is off, says nothing.'
    const sliderEntry =
      '### SLIDER\n' +
      'How to read it: Each value runs 0 to 100 — 0 not at all, 100 as much as possible.\n' +
      '- Warmth: 62%.\n' +
      '- Formality: 35%.'

    expect(compiled.text).toBe(
      `## TASK\nDraft the launch note.\n\n## MODS\n${PREAMBLE}\n\n` +
      `${switchEntry}\n\n${sliderEntry}\n\n${sliderEntry}`,
    )
    expect(compiled.modIds).toEqual(['switches', 'slider', 'slider'])
    expect(compiled.usedConnectionIds).toEqual(['switch-first', 'slider-first', 'slider-second'])
    expect(compiled.sections.mods.map(({ title }) => title)).toEqual(['SWITCHES', 'SLIDER', 'SLIDER'])
    expect(compiled.preview.mods.map(({ cardId, connectionId, modVersion }) => ({
      cardId,
      connectionId,
      modVersion,
    }))).toEqual([
      { cardId: 'switches', connectionId: 'switch-first', modVersion: 2 },
      { cardId: 'slider', connectionId: 'slider-first', modVersion: 2 },
      { cardId: 'slider', connectionId: 'slider-second', modVersion: 2 },
    ])
    expect(compiled.appliedMods).toEqual([
      {
        modVersion: 2,
        modCardId: 'switches',
        controlValues: snapshotModValues(switches),
        appliedInstructions: [
          'Only statements switched on apply. Off means left out on purpose, do not infer it.',
          'Cite sources for every claim.',
          'End with a three-line summary.',
          'jargon is off, says nothing.',
        ],
      },
      {
        modVersion: 2,
        modCardId: 'slider',
        controlValues: snapshotModValues(slider),
        appliedInstructions: [
          'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
          'Warmth: 62%.',
          'Formality: 35%.',
        ],
      },
      {
        modVersion: 2,
        modCardId: 'slider',
        controlValues: snapshotModValues(slider),
        appliedInstructions: [
          'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
          'Warmth: 62%.',
          'Formality: 35%.',
        ],
      },
    ])
  })

  it('keeps the MODS block fixed while ordinary connected context is dropped', () => {
    const select = createSeedMod('select')
    const noteText = 'Context that should be trimmed under pressure. '.repeat(100)
    const saved = board(
      [
        card('ask', 'askAi', 'Answer briefly.'),
        card('note', 'note', noteText),
        card('audience', 'mod', '', { modV2: select }),
      ],
      [
        connection('note-connection', 'note', { strength: 'weak' }),
        connection('audience-connection', 'audience'),
      ],
    )

    const compiled = gatherConnectedThought(saved, 'ask', {
      budgetTokens: 1,
      mode: 'never',
      summaries: new Map(),
    })

    expect(compiled.text).toBe(
      `## TASK\nAnswer briefly.\n\n## MODS\n${PREAMBLE}\n\n` +
      '### AUDIENCE\n' +
      'How to read it: One option is picked at a time. Follow its prompt and ignore the rest.\n' +
      '- Write for a founder: outcomes first, no hand-holding.',
    )
    expect(compiled.text).not.toContain(noteText.slice(0, 100))
    expect(compiled.budget?.droppedCardIds).toEqual(['note'])
  })

})
