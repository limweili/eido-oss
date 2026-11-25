import { describe, expect, it } from 'vitest'
import type { Card, Connection, Output, SavedBoard } from '../graph/types'
import { createSeedMod } from '../mods/seeds'
import {
  buildTurnPrompt,
  planConversationTurns,
  resolveConversation,
} from './conversationCompiler'
import { startParticipantMessage } from './transcript'

// --- a small board: a Conversation with two Ask AI participants, one shared Note,
// one shared Result, one top-level Mod, and a private Note for each participant ---

const conversation: Card = {
  id: 'conv',
  kind: 'conversation',
  blocks: [{ id: 'conv-b', text: 'Should we ship on Friday?' }],
  conversationStyle: 'debate',
  conversationTurns: 5,
  position: { x: 0, y: 0 },
}

const pro: Card = {
  id: 'pro',
  kind: 'askAi',
  title: 'Pro',
  blocks: [{ id: 'pro-b', text: 'Argue in favour of shipping.' }],
  model: 'anthropic/claude-3.5-sonnet',
  position: { x: 0, y: 0 },
}

const con: Card = {
  id: 'con',
  kind: 'askAi',
  title: 'Con',
  blocks: [{ id: 'con-b', text: 'Argue against shipping.' }],
  position: { x: 0, y: 0 },
}

const proNote: Card = {
  id: 'pro-note',
  kind: 'note',
  title: 'Pro evidence',
  blocks: [{ id: 'pro-note-b', text: 'The demo is polished.' }],
  position: { x: 0, y: 0 },
}

const conNote: Card = {
  id: 'con-note',
  kind: 'note',
  title: 'Con evidence',
  blocks: [{ id: 'con-note-b', text: 'Tests are still flaky.' }],
  position: { x: 0, y: 0 },
}

const sharedNote: Card = {
  id: 'shared-note',
  kind: 'note',
  title: 'Ground rules',
  blocks: [{ id: 'shared-note-b', text: 'The release is for paying customers.' }],
  position: { x: 0, y: 0 },
}

const sharedResultCard: Card = {
  id: 'shared-result',
  kind: 'result',
  blocks: [{ id: 'shared-result-b', text: '' }],
  position: { x: 0, y: 0 },
}

const avoidNote: Card = {
  id: 'avoid-note',
  kind: 'note',
  title: 'Rejected direction',
  blocks: [{ id: 'avoid-note-b', text: 'Make the launch about dashboards and management reporting.' }],
  position: { x: 0, y: 0 },
}

const avoidResultCard: Card = {
  id: 'avoid-result',
  kind: 'result',
  blocks: [{ id: 'avoid-result-b', text: '' }],
  position: { x: 0, y: 0 },
}

const modCard: Card = {
  id: 'mod',
  kind: 'mod',
  position: { x: 0, y: 0 },
  blocks: [{ id: 'mod-b', text: '' }],
  modV2: {
    ...createSeedMod('slider', { title: 'Rigor' }),
    state: {
      steps: 0,
      stops: [],
      items: [{ id: 'rigor', label: 'RIGOR', v: 80, frame: '' }],
    },
  },
}

const proModCard: Card = {
  id: 'pro-mod',
  kind: 'mod',
  position: { x: 0, y: 0 },
  blocks: [{ id: 'pro-mod-b', text: '' }],
  modV2: {
    ...createSeedMod('switch', { title: 'Devil’s advocate' }),
    state: {
      items: [{
        id: 'challenge',
        label: 'CHALLENGE ASSUMPTIONS',
        on: true,
        frame: 'Challenge the assumptions behind confident claims.',
      }],
    },
  },
}

const cards = [conversation, pro, con, proNote, conNote, sharedNote, sharedResultCard, modCard]

function conn(id: string, from: string, to: string, overrides: Partial<Connection> = {}): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: from === 'mod' ? 'modifies' : 'feeds',
    ...overrides,
  }
}

const sharedResultOutput: Output = {
  id: 'out-shared',
  resultCardId: 'shared-result',
  chosenVersionId: 'v-shared',
  versions: [
    { id: 'v-shared', number: 1, text: 'Earlier analysis: churn is rising.', createdAt: '', fromRunId: 'r' },
  ],
}

const avoidResultOutput: Output = {
  id: 'out-avoid',
  resultCardId: 'avoid-result',
  chosenVersionId: 'v-avoid',
  versions: [
    { id: 'v-avoid', number: 1, text: 'Rejected prior output: make it sound like generic enterprise software.', createdAt: '', fromRunId: 'r-avoid' },
  ],
}

function board(): SavedBoard {
  return {
    version: 1,
    cards,
    connections: [
      // Conversation Order: pro first, then con.
      conn('c-pro', 'pro', 'conv', { meta: { contextOrder: 0 } }),
      conn('c-con', 'con', 'conv', { meta: { contextOrder: 1 } }),
      // Shared inputs straight into the Conversation.
      conn('c-shared-note', 'shared-note', 'conv', { meta: { contextOrder: 2 } }),
      conn('c-shared-result', 'shared-result', 'conv', { meta: { contextOrder: 3 } }),
      conn('c-mod', 'mod', 'conv', { meta: { contextOrder: 4 } }),
      // Private context: each participant's own note feeds only that participant.
      conn('c-pro-note', 'pro-note', 'pro'),
      conn('c-con-note', 'con-note', 'con'),
    ],
    outputs: [sharedResultOutput],
    runs: [],
    updatedAt: '',
  }
}

describe('resolveConversation', () => {
  it('orders participants by the incoming connection order, not spatial position', () => {
    const resolved = resolveConversation(board(), 'conv')
    expect(resolved.participants.map((p) => p.cardId)).toEqual(['pro', 'con'])
  })

  it('reads the shared topic, style and turns from the Conversation card', () => {
    const resolved = resolveConversation(board(), 'conv')
    expect(resolved.settings).toMatchObject({
      topic: 'Should we ship on Friday?',
      style: 'debate',
      turnsPerParticipant: 5,
    })
  })

  it('treats Notes and Results connected to the Conversation as Shared Context', () => {
    const resolved = resolveConversation(board(), 'conv')
    const texts = resolved.sharedContext.map((c) => c.text)
    expect(texts).toContain('The release is for paying customers.')
    expect(texts).toContain('Earlier analysis: churn is rising.')
  })

  it('routes Avoid notes and results into already explored, never Shared Context', () => {
    const saved = board()
    saved.cards = [...saved.cards, avoidNote, avoidResultCard]
    saved.connections = [
      ...saved.connections,
      conn('c-avoid-note', 'avoid-note', 'conv', {
        polarity: 'pushesAgainst',
        reason: 'too enterprise and administrative',
        meta: { contextOrder: 5 },
      }),
      conn('c-avoid-result', 'avoid-result', 'conv', {
        polarity: 'pushesAgainst',
        reason: 'sounds like generic software positioning',
        meta: { contextOrder: 6 },
      }),
    ]
    saved.outputs = [...saved.outputs, avoidResultOutput]

    const resolved = resolveConversation(saved, 'conv')
    expect(resolved.sharedContext.map((entry) => entry.text).join('\n')).not.toContain(
      'Make the launch about dashboards and management reporting.',
    )
    expect(resolved.sharedContext.map((entry) => entry.text).join('\n')).not.toContain(
      'Rejected prior output: make it sound like generic enterprise software.',
    )
    expect(resolved.alreadyExplored.map((entry) => entry.text)).toEqual([
      'Make the launch about dashboards and management reporting.',
      'Rejected prior output: make it sound like generic enterprise software.',
    ])
    const participant = resolved.participants.find((p) => p.cardId === 'pro')!
    const text = buildTurnPrompt({
      settings: resolved.settings,
      participant,
      speakerName: 'Pro',
      sharedContext: resolved.sharedContext,
      alreadyExplored: resolved.alreadyExplored,
      topLevelMods: resolved.topLevelMods,
      transcript: [],
      turn: { currentTurn: 1, totalTurns: 5, isFinalTurn: false },
    })

    expect(text).toContain('## ALREADY EXPLORED — do not retread')
    expect(text).toContain(
      'These are explored dead ends. Do not reuse their approach or merely avoid their exact words; steer toward structurally different directions.',
    )
    expect(text).toContain('Make the launch about dashboards and management reporting.')
    expect(text).toContain('Reason this path died: too enterprise and administrative')
    expect(text).toContain('Rejected prior output: make it sound like generic enterprise software.')
    expect(text).toContain('Reason this path died: sounds like generic software positioning')

    const sharedStart = text.indexOf('## SHARED CONTEXT')
    const sharedEnd = text.indexOf('## ALREADY EXPLORED')
    const sharedSection = text.slice(sharedStart, sharedEnd)
    expect(sharedSection).not.toContain('Make the launch about dashboards and management reporting.')
    expect(sharedSection).not.toContain('Rejected prior output: make it sound like generic enterprise software.')
  })

  it('carries an upstream result follow-up thread into Shared Context via the context-text seam', () => {
    const saved = board()
    saved.outputs = [
      {
        ...sharedResultOutput,
        versions: [
          {
            ...sharedResultOutput.versions[0],
            followUpThread: {
              messages: [
                {
                  id: 'fu-1',
                  role: 'user',
                  text: 'Rising where exactly?',
                  createdAt: '2026-06-16T00:00:00.000Z',
                  status: 'complete',
                },
                {
                  id: 'fu-2',
                  role: 'assistant',
                  text: 'Mostly in the self-serve tier.',
                  createdAt: '2026-06-16T00:00:00.000Z',
                  status: 'complete',
                },
              ],
            },
          },
        ],
      },
    ]

    const resolved = resolveConversation(saved, 'conv')
    const shared = resolved.sharedContext.find((c) => c.cardId === 'shared-result')!
    expect(shared.text).toContain('Earlier analysis: churn is rising.')
    expect(shared.text).toContain('Follow-up discussion on this result:')
    expect(shared.text).toContain('User: Rising where exactly?')
    expect(shared.text).toContain('Assistant: Mostly in the self-serve tier.')
    expect(shared.text.indexOf('Earlier analysis')).toBeLessThan(
      shared.text.indexOf('Follow-up discussion on this result:'),
    )
  })

  it('treats a Mod connected to the Conversation as top-level guidance', () => {
    const resolved = resolveConversation(board(), 'conv')
    expect(resolved.topLevelMods).toHaveLength(1)
    expect(resolved.topLevelMods[0].label).toBe('Rigor')
    expect(resolved.topLevelMods[0].instructions.join(' ')).toContain('Rigor')

    const participant = resolved.participants.find((p) => p.cardId === 'pro')!
    const prompt = buildTurnPrompt({
      settings: resolved.settings,
      participant,
      speakerName: 'Pro',
      sharedContext: resolved.sharedContext,
      alreadyExplored: resolved.alreadyExplored,
      topLevelMods: resolved.topLevelMods,
      transcript: [],
      turn: { currentTurn: 1, totalTurns: 5, isFinalTurn: false },
    })
    expect(prompt).toContain(
      '## CONVERSATION GUIDANCE (applies to everyone)\n' +
        '- Each value runs 0 to 100 — 0 not at all, 100 as much as possible.\n' +
        '- Rigor: 80%.\n\n' +
        '## SHARED CONTEXT (everyone can see this)',
    )
  })

  it('flows treatment and visible-silence sentences through conversation guidance', () => {
    const saved = board()
    saved.cards = saved.cards.map((card) =>
      card.id === 'mod'
        ? {
            ...card,
            modV2: {
              ...createSeedMod('switch', { title: 'Rigor' }),
              treatOverride: 'Treat the switches as explicit instructions.',
              state: {
                items: [
                  {
                    id: 'rigor',
                    label: 'SUPPORT CLAIMS',
                    on: true,
                    frame: 'Support every claim rigorously.',
                  },
                  { id: 'off', label: 'PUSH BACK', on: false, frame: 'Push back.' },
                ],
              },
            },
          }
        : card,
    )
    const resolved = resolveConversation(saved, 'conv')
    expect(resolved.topLevelMods[0].instructions).toEqual([
      'Treat the switches as explicit instructions.',
      'Support every claim rigorously.',
      'push back is off, says nothing.',
    ])
  })

  it('compiles ordered v2 room and participant guidance from the shared Mod projection', () => {
    const saved = board()
    const roomSwitch = createSeedMod('switch')
    const roomSlider = createSeedMod('slider')
    const participantSelect = createSeedMod('select')
    saved.cards = [
      ...saved.cards.filter((card) => card.id !== 'mod'),
      cardWithV2Mod('room-switch', roomSwitch),
      cardWithV2Mod('room-slider', roomSlider),
      cardWithV2Mod('participant-select', participantSelect),
    ]
    saved.connections = [
      ...saved.connections.filter((connection) => connection.id !== 'c-mod'),
      conn('room-slider-second', 'room-slider', 'conv', {
        role: 'modifies',
        meta: { contextOrder: 6 },
      }),
      conn('room-switch-avoid', 'room-switch', 'conv', {
        role: 'modifies',
        polarity: 'pushesAgainst',
        meta: { contextOrder: -1 },
      }),
      conn('room-slider-first', 'room-slider', 'conv', {
        role: 'modifies',
        meta: { contextOrder: 5 },
      }),
      conn('room-switch-first', 'room-switch', 'conv', {
        role: 'modifies',
        meta: { contextOrder: 4 },
      }),
      conn('participant-select-first', 'participant-select', 'pro', { role: 'modifies' }),
    ]

    const resolved = resolveConversation(saved, 'conv')
    const participant = resolved.participants.find((candidate) => candidate.cardId === 'pro')!

    expect(resolved.topLevelMods).toEqual([
      {
        cardId: 'room-switch',
        label: 'SWITCHES',
        instructions: [
          'Only statements switched on apply. Off means left out on purpose, do not infer it.',
          'Cite sources for every claim.',
          'End with a three-line summary.',
          'jargon is off, says nothing.',
        ],
      },
      {
        cardId: 'room-slider',
        label: 'SLIDER',
        instructions: [
          'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
          'Warmth: 62%.',
          'Formality: 35%.',
        ],
      },
      {
        cardId: 'room-slider',
        label: 'SLIDER',
        instructions: [
          'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
          'Warmth: 62%.',
          'Formality: 35%.',
        ],
      },
    ])
    expect(participant.participantMods).toEqual([
      {
        cardId: 'participant-select',
        label: 'AUDIENCE',
        instructions: [
          'One option is picked at a time. Follow its prompt and ignore the rest.',
          'Write for a founder: outcomes first, no hand-holding.',
        ],
      },
    ])
    expect(resolved.appliedMods.map(({ modCardId, participantCardId }) => ({
      modCardId,
      participantCardId,
    }))).toEqual([
      { modCardId: 'room-switch', participantCardId: undefined },
      { modCardId: 'room-slider', participantCardId: undefined },
      { modCardId: 'room-slider', participantCardId: undefined },
      { modCardId: 'participant-select', participantCardId: 'pro' },
    ])

    const prompt = buildTurnPrompt({
      settings: resolved.settings,
      participant,
      speakerName: 'Pro',
      sharedContext: resolved.sharedContext,
      alreadyExplored: resolved.alreadyExplored,
      topLevelMods: resolved.topLevelMods,
      transcript: [],
      turn: { currentTurn: 1, totalTurns: 5, isFinalTurn: false },
    })
    expect(prompt).toContain(
      '## YOUR GUIDANCE (applies only to you)\n' +
        '- One option is picked at a time. Follow its prompt and ignore the rest.\n' +
        '- Write for a founder: outcomes first, no hand-holding.\n\n' +
        '## CONVERSATION GUIDANCE (applies to everyone)\n' +
        '- Only statements switched on apply. Off means left out on purpose, do not infer it.\n' +
        '- Cite sources for every claim.\n' +
        '- End with a three-line summary.\n' +
        '- jargon is off, says nothing.\n' +
        '- Each value runs 0 to 100 — 0 not at all, 100 as much as possible.\n' +
        '- Warmth: 62%.\n' +
        '- Formality: 35%.\n' +
        '- Each value runs 0 to 100 — 0 not at all, 100 as much as possible.\n' +
        '- Warmth: 62%.\n' +
        '- Formality: 35%.\n\n' +
        '## SHARED CONTEXT (everyone can see this)',
    )
  })

  it('keeps participant context private to each participant', () => {
    const resolved = resolveConversation(board(), 'conv')
    const proP = resolved.participants.find((p) => p.cardId === 'pro')!
    const conP = resolved.participants.find((p) => p.cardId === 'con')!
    expect(proP.privateContext.text).toContain('The demo is polished.')
    expect(proP.privateContext.text).not.toContain('Tests are still flaky.')
    expect(conP.privateContext.text).toContain('Tests are still flaky.')
    expect(conP.privateContext.text).not.toContain('The demo is polished.')
  })

  it('applies a Mod connected to a participant source only to that participant’s turns', () => {
    const saved = board()
    saved.cards = [...saved.cards, proModCard]
    saved.connections = [
      ...saved.connections,
      conn('c-pro-mod', 'pro-mod', 'pro', { role: 'modifies' }),
    ]

    const resolved = resolveConversation(saved, 'conv')
    const proP = resolved.participants.find((p) => p.cardId === 'pro')!
    const conP = resolved.participants.find((p) => p.cardId === 'con')!
    const turnPrompt = (participant: typeof proP, speakerName: string) =>
      buildTurnPrompt({
        settings: resolved.settings,
        participant,
        speakerName,
        sharedContext: resolved.sharedContext,
        alreadyExplored: resolved.alreadyExplored,
        topLevelMods: resolved.topLevelMods,
        transcript: [],
        turn: { currentTurn: 1, totalTurns: 5, isFinalTurn: false },
      })

    expect(proP.participantMods).toEqual([
      {
        cardId: 'pro-mod',
        label: 'Devil’s advocate',
        instructions: [
          'Only statements switched on apply. Off means left out on purpose, do not infer it.',
          'Challenge the assumptions behind confident claims.',
        ],
      },
    ])
    expect(conP.participantMods).toEqual([])

    const proPrompt = turnPrompt(proP, 'Pro')
    const conPrompt = turnPrompt(conP, 'Con')
    expect(proPrompt).toContain(
      '## YOUR GUIDANCE (applies only to you)\n' +
        '- Only statements switched on apply. Off means left out on purpose, do not infer it.\n' +
        '- Challenge the assumptions behind confident claims.',
    )
    expect(conPrompt).not.toContain('Challenge the assumptions behind confident claims.')

    const roomGuidance = proPrompt.slice(
      proPrompt.indexOf('## CONVERSATION GUIDANCE'),
      proPrompt.indexOf('## SHARED CONTEXT'),
    )
    expect(roomGuidance).toBe(
      '## CONVERSATION GUIDANCE (applies to everyone)\n' +
        '- Each value runs 0 to 100 — 0 not at all, 100 as much as possible.\n' +
        '- Rigor: 80%.\n\n',
    )
    expect(roomGuidance).not.toContain('Challenge the assumptions behind confident claims.')
  })

  it('makes an Avoid Mod connected to a participant contribute nothing', () => {
    const saved = board()
    const avoidMod = {
      ...proModCard,
      blocks: [{ id: 'pro-mod-b', text: 'Always concede the strongest opposing claim.' }],
    }
    saved.cards = [...saved.cards, avoidMod]
    saved.connections = [
      ...saved.connections,
      conn('c-pro-mod', 'pro-mod', 'pro', {
        role: 'modifies',
        polarity: 'pushesAgainst',
        reason: 'made the advocate abandon its position',
      }),
    ]

    const resolved = resolveConversation(saved, 'conv')
    const participant = resolved.participants.find((candidate) => candidate.cardId === 'pro')!
    const prompt = buildTurnPrompt({
      settings: resolved.settings,
      participant,
      speakerName: 'Pro',
      sharedContext: resolved.sharedContext,
      alreadyExplored: resolved.alreadyExplored,
      topLevelMods: resolved.topLevelMods,
      transcript: [],
      turn: { currentTurn: 1, totalTurns: 5, isFinalTurn: false },
    })

    expect(participant.participantMods).toEqual([])
    expect(prompt).not.toContain('Challenge the assumptions behind confident claims.')
    expect(prompt).not.toContain('Always concede the strongest opposing claim.')
    expect(prompt).not.toContain('made the advocate abandon its position')
  })

  it('does not apply a Mod connected to a participant with the feeds role', () => {
    const saved = board()
    saved.cards = [
      ...saved.cards,
      {
        ...proModCard,
        blocks: [{ id: 'pro-mod-b', text: 'Treat certainty as suspicious.' }],
      },
    ]
    saved.connections = [...saved.connections, conn('c-pro-mod', 'pro-mod', 'pro')]

    const resolved = resolveConversation(saved, 'conv')
    const participant = resolved.participants.find((candidate) => candidate.cardId === 'pro')!
    const prompt = buildTurnPrompt({
      settings: resolved.settings,
      participant,
      speakerName: 'Pro',
      sharedContext: resolved.sharedContext,
      alreadyExplored: resolved.alreadyExplored,
      topLevelMods: resolved.topLevelMods,
      transcript: [],
      turn: { currentTurn: 1, totalTurns: 5, isFinalTurn: false },
    })

    expect(participant.participantMods).toEqual([])
    expect(participant.privateContext.text).not.toContain('Treat certainty as suspicious.')
    expect(prompt).not.toContain('Challenge the assumptions behind confident claims.')
  })

  it('uses each participant Ask AI instruction as its role, and its own/the default model', () => {
    const resolved = resolveConversation(board(), 'conv')
    const proP = resolved.participants.find((p) => p.cardId === 'pro')!
    const conP = resolved.participants.find((p) => p.cardId === 'con')!
    expect(proP.role).toBe('Argue in favour of shipping.')
    expect(proP.model).toBe('anthropic/claude-3.5-sonnet')
    expect(conP.model).toBeUndefined() // falls back to the default model at run time
  })

  it('allows a single participant Conversation', () => {
    const single: SavedBoard = {
      ...board(),
      connections: [conn('c-pro', 'pro', 'conv')],
    }
    const resolved = resolveConversation(single, 'conv')
    expect(resolved.participants.map((p) => p.cardId)).toEqual(['pro'])
  })
})

function cardWithV2Mod(id: string, modV2: NonNullable<Card['modV2']>): Card {
  return {
    id,
    kind: 'mod',
    blocks: [{ id: `${id}-block`, text: '' }],
    position: { x: 0, y: 0 },
    modV2,
  }
}

describe('buildTurnPrompt — Turn Aware assembly', () => {
  const resolved = resolveConversation(board(), 'conv')
  const proP = resolved.participants.find((p) => p.cardId === 'pro')!

  function prompt(currentTurn: number, totalTurns: number) {
    return buildTurnPrompt({
      settings: resolved.settings,
      participant: proP,
      speakerName: 'Pro',
      sharedContext: resolved.sharedContext,
      alreadyExplored: resolved.alreadyExplored,
      topLevelMods: resolved.topLevelMods,
      transcript: [],
      turn: { currentTurn, totalTurns, isFinalTurn: currentTurn === totalTurns },
    })
  }

  it('states total turns, current turn and remaining turns', () => {
    const text = prompt(2, 5)
    expect(text).toContain('5 turn(s) in total')
    expect(text).toContain('turn 2 of 5')
    expect(text).toContain('3 turn(s) remaining')
  })

  it('marks the final turn so the participant can close out', () => {
    expect(prompt(5, 5)).toContain('FINAL turn')
    expect(prompt(2, 5)).toContain('not your final turn')
  })

  it('includes the topic, style, role, shared context and top-level guidance', () => {
    const text = prompt(1, 5)
    expect(text).toContain('Should we ship on Friday?')
    expect(text).toContain('debate')
    expect(text).toContain('Argue in favour of shipping.')
    expect(text).toContain('The release is for paying customers.')
    expect(text).toContain('CONVERSATION GUIDANCE')
  })

  it('never mentions highlights — they are visual-only and stay out of AI context', () => {
    expect(prompt(1, 5).toLowerCase()).not.toContain('highlight')
  })

  it('emits no intent sections or suffixes and keeps other participants private context private', () => {
    const resolved = resolveConversation(board(), 'conv')
    const participant = resolved.participants.find((p) => p.cardId === 'pro')!

    const text = buildTurnPrompt({
      settings: resolved.settings,
      participant,
      speakerName: 'Pro',
      sharedContext: resolved.sharedContext,
      alreadyExplored: resolved.alreadyExplored,
      topLevelMods: resolved.topLevelMods,
      transcript: [],
      turn: { currentTurn: 1, totalTurns: 5, isFinalTurn: false },
    })

    expect(text).not.toContain('INTENT SIGNAL')
    expect(text).not.toContain('(Intent:')
    expect(text).not.toContain('Tests are still flaky.')
  })

  it('shows the participant own private context but not another participant private context', () => {
    const text = prompt(1, 5)
    expect(text).toContain('The demo is polished.')
    expect(text).not.toContain('Tests are still flaky.')
  })

  it('includes the public transcript so far', () => {
    const said = {
      ...startParticipantMessage({ participantCardId: 'con', speakerName: 'Con', turnNumber: 1 }),
      text: 'We are not ready.',
      streaming: false,
    }
    const text = buildTurnPrompt({
      settings: resolved.settings,
      participant: proP,
      speakerName: 'Pro',
      sharedContext: resolved.sharedContext,
      alreadyExplored: resolved.alreadyExplored,
      topLevelMods: resolved.topLevelMods,
      transcript: [said],
      turn: { currentTurn: 2, totalTurns: 5, isFinalTurn: false },
    })
    expect(text).toContain('Con: We are not ready.')
  })
})

describe('planConversationTurns', () => {
  it('cycles ordered participants and counts turns per participant', () => {
    const plan = planConversationTurns(['pro', 'con'], { rounds: 5 })
    expect(plan).toHaveLength(10) // 2 participants × 5 turns = up to 10 AI messages
    expect(plan.slice(0, 4).map((t) => t.participantCardId)).toEqual(['pro', 'con', 'pro', 'con'])
    const proTurns = plan.filter((t) => t.participantCardId === 'pro')
    expect(proTurns.map((t) => t.currentTurn)).toEqual([1, 2, 3, 4, 5])
    expect(proTurns.map((t) => t.isFinalTurn)).toEqual([false, false, false, false, true])
    expect(proTurns.every((t) => t.totalTurns === 5)).toBe(true)
  })

  it('keeps counting up when continuing from prior turns', () => {
    const plan = planConversationTurns(['pro'], { rounds: 1, priorTurns: { pro: 3 } })
    expect(plan).toEqual([{ participantCardId: 'pro', currentTurn: 4, totalTurns: 4, isFinalTurn: true }])
  })
})
