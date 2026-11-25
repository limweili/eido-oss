import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Card, Connection } from '../graph/types'
import { useGraph } from '../graph/store'
import { createSeedMod } from '../mods/seeds'
import { snapshotModValues } from '../mods/snapshot'
import { PROFILE_REVIEW_MODEL } from '../shared/profileReviewPolicy'
import {
  cancelConversation,
  makeConversationVariations,
  runAgentConversation,
  runConversation,
  type ConversationStream,
} from './conversationRunner'
import type { CompletionStream } from './runEngine'
import { planConversationRun } from './executionPlan'
import { userMessage } from './transcript'

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
      apiKey: 'test-key',
      model: 'default/model',
      models: ['default/model'],
      reasoningEffort: 'medium',
    },
  })
}

function card(id: string, kind: Card['kind'], extra: Partial<Card> = {}): Card {
  return { id, kind, blocks: [{ id: `${id}-b`, text: '' }], position: { x: 0, y: 0 }, ...extra }
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

// A fake AI boundary that records each instruction it receives and emits a fixed
// reply, so we can assert ordering and what each turn was shown.
function fakeStream(): { stream: ConversationStream; instructions: string[]; replies: string[] } {
  const instructions: string[] = []
  const replies: string[] = []
  const stream: ConversationStream = async (instruction, opts) => {
    const reply = `reply ${instructions.length + 1}`
    instructions.push(instruction)
    replies.push(reply)
    opts.onChunk(reply)
    return reply
  }
  return { stream, instructions, replies }
}

function streamingResponse(text: string) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`),
      )
      controller.enqueue(encoder.encode('data: [DONE]\n\n'))
      controller.close()
    },
  }), { status: 200 })
}

function activeVersionId(): string | undefined {
  for (const o of useGraph.getState().outputs) {
    const v = o.versions[o.versions.length - 1]
    if (v?.transcript?.some((m) => m.streaming)) return v.id
  }
  return undefined
}

function transcriptOf(versionId: string) {
  for (const o of useGraph.getState().outputs) {
    const v = o.versions.find((x) => x.id === versionId)
    if (v) return v
  }
  return undefined
}

beforeEach(resetStore)
afterEach(() => vi.unstubAllGlobals())

describe('runConversation — normal cycle', () => {
  it('cycles ordered participants for the configured turns into one Result version', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationStyle: 'debate', conversationTurns: 2 }),
        card('pro', 'askAi', { title: 'Pro', blocks: [{ id: 'p', text: 'For.' }] }),
        card('con', 'askAi', { title: 'Con', blocks: [{ id: 'c', text: 'Against.' }] }),
      ],
      connections: [feed('c-pro', 'pro', 'conv'), feed('c-con', 'con', 'conv')],
    })

    const fake = fakeStream()
    const outcome = await runConversation('conv', { stream: fake.stream })
    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    if (!outcome.ok || outcome.status !== 'done') throw new Error('expected done outcome')

    const version = transcriptOf(outcome.versionId)!
    const transcript = version.transcript!
    expect(transcript.map((m) => m.speakerName)).toEqual(['Pro', 'Con', 'Pro', 'Con'])
    expect(transcript.every((m) => !m.streaming)).toBe(true)
    // Each later turn was shown the public transcript so far.
    expect(fake.instructions[1]).toContain('Pro: reply 1')

    // One Result card was created and connected from the Conversation.
    const result = useGraph.getState().cards.find((c) => c.kind === 'result')
    expect(result).toBeTruthy()
    expect(version.text).toContain('Pro: reply 1')
  })

  it('runs a single participant and uses the default model when the card has none', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('solo', 'askAi', { title: 'Solo' }),
      ],
      connections: [feed('c-solo', 'solo', 'conv')],
    })
    const models: string[] = []
    const stream: ConversationStream = async (_i, opts) => {
      models.push(opts.model)
      opts.onChunk('hi')
      return 'hi'
    }
    const outcome = await runConversation('conv', { stream })
    expect(outcome.ok).toBe(true)
    expect(models).toEqual(['default/model'])
  })

  it('records participant-scoped Mods on that participant and sends them only on their turns', async () => {
    const roomSeed = createSeedMod('slider', { title: 'Room rigor' })
    const roomMod = {
      ...roomSeed,
      state: {
        ...roomSeed.state,
        items: [{ id: 'rigor', label: 'Room rigor', v: 80, frame: '' }],
      },
    }
    const proSeed = createSeedMod('slider', { title: 'Pro challenger' })
    const proMod = {
      ...proSeed,
      state: {
        ...proSeed.state,
        items: [
          {
            id: 'challenge-depth',
            label: 'Challenge',
            v: 70,
            frame: 'Challenge confident assumptions: {value}.',
          },
        ],
      },
    }
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('pro', 'askAi', { title: 'Pro' }),
        card('con', 'askAi', { title: 'Con' }),
        card('room-mod', 'mod', { modV2: roomMod }),
        card('pro-mod', 'mod', { modV2: proMod }),
      ],
      connections: [
        feed('c-pro', 'pro', 'conv'),
        feed('c-con', 'con', 'conv'),
        { ...feed('c-room-mod', 'room-mod', 'conv'), role: 'modifies' },
        { ...feed('c-room-mod-duplicate', 'room-mod', 'conv'), role: 'modifies' },
        { ...feed('c-pro-mod', 'pro-mod', 'pro'), role: 'modifies' },
      ],
    })

    const fake = fakeStream()
    const outcome = await runConversation('conv', { stream: fake.stream })
    expect(outcome.ok).toBe(true)

    expect(fake.instructions[0]).toContain('Room rigor: 80%.')
    expect(fake.instructions[0]).toContain('Challenge confident assumptions: 70%.')
    expect(fake.instructions[1]).toContain('Room rigor: 80%.')
    expect(fake.instructions[1]).not.toContain('Challenge confident assumptions: 70%.')

    const run = useGraph.getState().runs.find((candidate) => candidate.kind === 'conversation')!
    const provenance = run.conversation!
    const proRecord = provenance.participants.find((participant) => participant.cardId === 'pro')!
    const conRecord = provenance.participants.find((participant) => participant.cardId === 'con')!
    expect(proRecord.participantMods).toEqual([
      {
        cardId: 'pro-mod',
        label: 'Pro challenger',
        instructions: [
          'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
          'Challenge confident assumptions: 70%.',
        ],
      },
    ])
    expect(conRecord.participantMods).toEqual([])
    expect(provenance.topLevelMods).toEqual([
      {
        cardId: 'room-mod',
        label: 'Room rigor',
        instructions: [
          'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
          'Room rigor: 80%.',
        ],
      },
      {
        cardId: 'room-mod',
        label: 'Room rigor',
        instructions: [
          'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
          'Room rigor: 80%.',
        ],
      },
    ])
    expect(run.modIds).toEqual(['room-mod', 'room-mod', 'pro-mod'])
    expect(run.appliedMods).toEqual([
      {
        modVersion: 2,
        modCardId: 'room-mod',
        controlValues: snapshotModValues(roomMod),
        appliedInstructions: [
          'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
          'Room rigor: 80%.',
        ],
      },
      {
        modVersion: 2,
        modCardId: 'room-mod',
        controlValues: snapshotModValues(roomMod),
        appliedInstructions: [
          'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
          'Room rigor: 80%.',
        ],
      },
      {
        modVersion: 2,
        modCardId: 'pro-mod',
        participantCardId: 'pro',
        controlValues: snapshotModValues(proMod),
        appliedInstructions: [
          'Each value runs 0 to 100 — 0 not at all, 100 as much as possible.',
          'Challenge confident assumptions: 70%.',
        ],
      },
    ])
  })

  it('reports no participants when only non-Ask-AI cards are connected', async () => {
    useGraph.setState({
      cards: [card('conv', 'conversation'), card('note', 'note', { blocks: [{ id: 'n', text: 'x' }] })],
      connections: [feed('c-note', 'note', 'conv')],
    })
    const outcome = await runConversation('conv', { stream: fakeStream().stream })
    expect(outcome).toMatchObject({ ok: false, reason: 'no-participants' })
  })
})

describe('runConversation — Speaker Names', () => {
  it('keeps the eighth admitted Conversation variation within the provider temperature bound', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('speaker', 'askAi', { title: 'Speaker' }),
      ],
      connections: [feed('c-speaker', 'speaker', 'conv')],
    })
    const admittedPlan = planConversationRun(useGraph.getState().snapshot(), 'conv')
    if (!admittedPlan) throw new Error('expected Conversation plan')
    const bodies: Array<{ temperature?: number }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      bodies.push(JSON.parse(String(request?.body)) as { temperature?: number })
      return streamingResponse('Spoken')
    }))

    await expect(runAgentConversation('conv', {
      admittedPlan,
      triggeredBy: { kind: 'agent', client: 'codex', sessionId: 'session-conversation-8' },
      mode: 'variations',
      variationIndex: 8,
      variationCount: 8,
    })).resolves.toMatchObject({ ok: true, status: 'done' })
    expect(bodies).toHaveLength(1)
    expect(bodies[0]?.temperature).toBe(2)
  })

  it('uses admitted deterministic labels without a naming call or Card-title mutation', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('blank', 'askAi', { blocks: [{ id: 'b', text: 'Be skeptical.' }] }),
      ],
      connections: [feed('c-blank', 'blank', 'conv')],
    })
    const admittedPlan = planConversationRun(useGraph.getState().snapshot(), 'conv')
    if (!admittedPlan) throw new Error('expected Conversation plan')
    const generateSpeakerName = vi.fn(async () => 'Hidden Name')
    const triggeredBy = Object.freeze({
      kind: 'agent' as const,
      client: 'codex',
      sessionId: 'session-agent-conversation',
    })

    const outcome = await runConversation('conv', {
      stream: fakeStream().stream,
      generateSpeakerName,
      admittedPlan,
      triggeredBy,
    })
    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    if (!outcome.ok || outcome.status !== 'done') {
      throw new Error('expected admitted Conversation to complete')
    }
    expect(generateSpeakerName).not.toHaveBeenCalled()
    expect(useGraph.getState().cards.find((candidate) => candidate.id === 'blank')?.title)
      .toBeUndefined()
    expect(transcriptOf(outcome.versionId)?.transcript?.[0]?.speakerName).toBe('Speaker 1')
    expect(useGraph.getState().runs[0]?.triggeredBy).toEqual(triggeredBy)
  })

  it('rejects admitted Conversation drift before any provider call', async () => {
    useGraph.setState({
      cards: [card('conv', 'conversation'), card('speaker', 'askAi')],
      connections: [feed('c-speaker', 'speaker', 'conv')],
    })
    const admittedPlan = planConversationRun(useGraph.getState().snapshot(), 'conv')
    if (!admittedPlan) throw new Error('expected Conversation plan')
    useGraph.setState({
      cards: useGraph.getState().cards.map((candidate) => candidate.id === 'speaker'
        ? { ...candidate, blocks: [{ id: 'speaker-b', text: 'Changed role.' }] }
        : candidate),
    })
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)

    await expect(runAgentConversation('conv', {
      admittedPlan,
      triggeredBy: { kind: 'agent', client: 'codex', sessionId: 'session-drift' },
      mode: 'run',
      variationIndex: 1,
      variationCount: 1,
    })).resolves.toMatchObject({ ok: false, reason: 'plan-changed' })
    expect(fetch).not.toHaveBeenCalled()
    expect(useGraph.getState().runs).toEqual([])
  })

  it('generates and saves a name for an untitled participant, leaving titled ones alone', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('pro', 'askAi', { title: 'Pro', blocks: [{ id: 'p', text: 'For.' }] }),
        card('blank', 'askAi', { blocks: [{ id: 'b', text: 'Be skeptical.' }] }),
      ],
      connections: [feed('c-pro', 'pro', 'conv'), feed('c-blank', 'blank', 'conv')],
    })

    const outcome = await runConversation('conv', {
      stream: fakeStream().stream,
      generateSpeakerName: async () => 'Skeptic',
    })
    expect(outcome.ok).toBe(true)

    expect(useGraph.getState().cards.find((c) => c.id === 'pro')!.title).toBe('Pro')
    expect(useGraph.getState().cards.find((c) => c.id === 'blank')!.title).toBe('Skeptic')
  })

  it('uses the fixed review model for budgeting, naming, turns, and provenance', async () => {
    const huge = 'A fact worth keeping. '.repeat(22_000)
    vi.stubGlobal('window', {
      eidoDesktop: true,
      eidoProfileReview: true,
    })
    const speakerNameModels: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (_input: RequestInfo | URL, request?: RequestInit) => {
      const body = JSON.parse(String(request?.body)) as { model: string }
      speakerNameModels.push(body.model)
      return streamingResponse('Researcher')
    }))
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('speaker', 'askAi', {
          model: 'participant/override',
          blocks: [{ id: 's', text: 'Make the case.' }],
        }),
        card('huge', 'note', { blocks: [{ id: 'hg', text: huge }] }),
      ],
      connections: [
        feed('cp', 'speaker', 'conv'),
        { ...feed('ch', 'huge', 'speaker'), strength: 'weak' as const },
      ],
    })
    const turnModels: string[] = []
    const compactionModels: string[] = []
    const stream: ConversationStream = async (_instruction, opts) => {
      turnModels.push(opts.model)
      opts.onChunk('spoken')
      return 'spoken'
    }
    const compactionStream: CompletionStream = async (_instruction, opts) => {
      compactionModels.push(opts.model)
      opts.onChunk('short summary')
      return 'short summary'
    }

    expect(await runConversation('conv', { stream, compactionStream })).toMatchObject({
      ok: true,
      status: 'done',
    })

    expect(compactionModels).toEqual([PROFILE_REVIEW_MODEL])
    expect(speakerNameModels).toEqual([PROFILE_REVIEW_MODEL])
    expect(turnModels).toEqual([PROFILE_REVIEW_MODEL])
    const run = useGraph.getState().runs.find((candidate) => candidate.kind === 'conversation')!
    expect(run.model).toBe(PROFILE_REVIEW_MODEL)
    expect(run.conversation?.participants[0]?.model).toBe(PROFILE_REVIEW_MODEL)
    expect(useGraph.getState().compactionSummaries[0]?.model).toBe(PROFILE_REVIEW_MODEL)
  })
})

describe('runConversation — variations', () => {
  it('creates a small stack of fresh transcript versions with variation framing', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('solo', 'askAi', { title: 'Solo' }),
      ],
      connections: [feed('c-solo', 'solo', 'conv')],
    })

    const variationNotes: string[] = []
    const temperatures: number[] = []
    const stream: ConversationStream = async (_instruction, opts) => {
      const reply = `reply ${variationNotes.length + 1}`
      variationNotes.push(opts.variationNote ?? '')
      temperatures.push(opts.temperature ?? 0)
      opts.onChunk(reply)
      return reply
    }

    const outcome = await makeConversationVariations('conv', 3, { stream })
    expect(outcome).toMatchObject({ ok: true, status: 'done' })

    const versions = useGraph.getState().outputs[0].versions
    expect(versions).toHaveLength(3)
    expect(versions.map((v) => v.number)).toEqual([1, 2, 3])
    expect(versions.map((v) => v.text)).toEqual(['Solo: reply 1', 'Solo: reply 2', 'Solo: reply 3'])
    expect(variationNotes[1]).toContain('different angle')
    expect(temperatures).toEqual([0.5, 0.75, 1])
  })
})

describe('runConversation — Interjection while streaming', () => {
  it('does not restart the current turn and shows the Interjection to the next turn', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 2 }),
        card('solo', 'askAi', { title: 'Solo' }),
      ],
      connections: [feed('c-solo', 'solo', 'conv')],
    })

    const instructions: string[] = []
    let interjected = false
    const stream: ConversationStream = async (instruction, opts) => {
      instructions.push(instruction)
      opts.onChunk('answer')
      // During the FIRST turn's stream, the user interjects.
      if (!interjected) {
        interjected = true
        const versionId = activeVersionId()!
        useGraph.getState().appendTranscriptMessage(versionId, userMessage('focus on cost'))
      }
      return 'answer'
    }

    const outcome = await runConversation('conv', { stream })
    expect(outcome.ok).toBe(true)
    if (!outcome.ok || outcome.status !== 'done') return

    const transcript = transcriptOf(outcome.versionId)!.transcript!
    // First turn completed (not restarted): one finished participant message before the user.
    expect(transcript[0]).toMatchObject({ speakerKind: 'participant', text: 'answer', streaming: false })
    expect(transcript[1]).toMatchObject({ speakerKind: 'user', text: 'focus on cost' })
    // The second turn saw the interjection.
    expect(instructions[1]).toContain('You: focus on cost')
  })
})

describe('runConversation — failure and cancel keep a Provisional Version', () => {
  it('keeps the Partial Transcript and marks the version failed when a turn fails', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('a', 'askAi', { title: 'A' }),
        card('b', 'askAi', { title: 'B' }),
      ],
      connections: [feed('c-a', 'a', 'conv'), feed('c-b', 'b', 'conv')],
    })

    let calls = 0
    const stream: ConversationStream = async (_i, opts) => {
      calls++
      if (calls === 2) throw new Error('boom')
      opts.onChunk('first')
      return 'first'
    }

    const outcome = await runConversation('conv', { stream })
    expect(outcome).toMatchObject({ ok: false, reason: 'failed' })

    const version = useGraph.getState().outputs[0].versions[useGraph.getState().outputs[0].versions.length - 1]
    expect(version.provisional).toBe(true)
    expect(version.provisionalReason).toBe('failed')
    expect(version.transcript!.some((m) => m.text === 'first')).toBe(true)
    expect(version.transcript!.every((m) => !m.streaming)).toBe(true)
  })

  it('keeps the transcript as a canceled Provisional Version when canceled mid-run', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 3 }),
        card('solo', 'askAi', { title: 'Solo' }),
      ],
      connections: [feed('c-solo', 'solo', 'conv')],
    })

    let calls = 0
    const stream: ConversationStream = async (_i, opts) => {
      calls++
      opts.onChunk(`turn ${calls}`)
      if (calls === 2) cancelConversation('conv') // user cancels after the 2nd turn
      return `turn ${calls}`
    }

    const outcome = await runConversation('conv', { stream })
    expect(outcome).toMatchObject({ ok: true, status: 'canceled' })

    const version = useGraph.getState().outputs[0].versions[useGraph.getState().outputs[0].versions.length - 1]
    expect(version.provisional).toBe(true)
    expect(version.provisionalReason).toBe('canceled')
    expect(version.transcript!.filter((m) => m.speakerKind === 'participant')).toHaveLength(2)
  })

  it('cancels a persisted running run even when the in-memory controller is gone', () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('result', 'result'),
      ],
      connections: [feed('c-result', 'conv', 'result')],
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'ver',
          versions: [
            {
              id: 'ver',
              number: 1,
              text: 'Solo: half written',
              createdAt: '2026-01-01T00:00:00.000Z',
              fromRunId: 'run',
              transcript: [
                {
                  id: 'msg',
                  speakerKind: 'participant',
                  speakerName: 'Solo',
                  participantCardId: 'solo',
                  text: 'half written',
                  turnNumber: 1,
                  streaming: true,
                },
              ],
            },
          ],
        },
      ],
      runs: [
        {
          id: 'run',
          startedAt: '2026-01-01T00:00:00.000Z',
          askAiCardId: 'conv',
          model: 'default/model',
          usedCardIds: ['conv', 'solo'],
          usedConnectionIds: [],
          modIds: [],
          appliedMods: [],
          compiledInstruction: '',
          status: 'running',
          producedVersionId: 'ver',
          kind: 'conversation',
          conversation: {
            settings: { topic: '', style: 'debate', turnsPerParticipant: 1 },
            participants: [],
            sharedContext: [],
            topLevelMods: [],
            turns: [],
          },
        },
      ],
    })

    cancelConversation('conv')

    const run = useGraph.getState().runs.find((r) => r.id === 'run')!
    const version = useGraph.getState().outputs[0].versions[0]
    expect(run.status).toBe('canceled')
    expect(version.provisional).toBe(true)
    expect(version.provisionalReason).toBe('canceled')
    expect(version.transcript![0].streaming).toBe(false)
  })

  it('continues from an existing transcript in the SAME version after a user message', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('solo', 'askAi', { title: 'Solo' }),
      ],
      connections: [feed('c-solo', 'solo', 'conv')],
    })

    const first = await runConversation('conv', { stream: fakeStream().stream })
    expect(first.ok).toBe(true)
    if (!first.ok || first.status !== 'done') return

    const second = await runConversation('conv', {
      stream: fakeStream().stream,
      continueInVersionId: first.versionId,
      leadingUserMessage: 'what about cost?',
      rounds: 1,
    })
    expect(second.ok).toBe(true)
    if (!second.ok || second.status !== 'done') return

    // One whole conversation = one version: a continuation extends it, not forks it.
    expect(second.versionId).toBe(first.versionId)

    const version = transcriptOf(second.versionId)!.transcript!
    // Prior turn + user message + one new AI turn, all in the same transcript.
    expect(version.map((m) => m.speakerKind)).toEqual(['participant', 'user', 'participant'])
    expect(version.find((m) => m.speakerKind === 'user')!.text).toBe('what about cost?')
    // The continued participant turn keeps counting up (turn 2).
    expect(version[version.length - 1].turnNumber).toBe(2)
    // Still ONE version in the Result stack.
    expect(useGraph.getState().outputs[0].versions).toHaveLength(1)
  })

  it('asks for a new version instead of relabeling a cross-provider continuation', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('solo', 'askAi', { title: 'Solo' }),
      ],
      connections: [feed('c-solo', 'solo', 'conv')],
    })
    const first = await runConversation('conv', { stream: fakeStream().stream })
    if (!first.ok) throw new Error('expected initial conversation')
    const originalRun = useGraph.getState().runs[0]!
    useGraph.setState((state) => ({
      settings: {
        ...state.settings,
        provider: 'codex',
        model: 'default',
        models: ['default'],
      },
    }))
    const stream = vi.fn(async () => '')

    await expect(runConversation('conv', {
      stream,
      continueInVersionId: first.versionId,
      rounds: 1,
    })).resolves.toEqual({
      ok: false,
      reason: 'failed',
      message: 'conversationProviderChanged',
      artifacts: [],
    })
    expect(stream).not.toHaveBeenCalled()
    expect(useGraph.getState().runs[0]).toMatchObject({
      id: originalRun.id,
      provider: undefined,
      model: 'default/model',
      status: 'done',
    })
  })

  it('updates historical top-level Conversation provenance to the fixed review model', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('solo', 'askAi', { title: 'Solo', model: 'historical/participant' }),
      ],
      connections: [feed('c-solo', 'solo', 'conv')],
    })
    const first = await runConversation('conv', { stream: fakeStream().stream })
    if (!first.ok) throw new Error('expected initial conversation')
    expect(useGraph.getState().runs[0]?.model).toBe('default/model')

    vi.stubGlobal('window', { eidoDesktop: true, eidoProfileReview: true })
    const models: string[] = []
    const stream: ConversationStream = async (_instruction, opts) => {
      models.push(opts.model)
      opts.onChunk('continued')
      return 'continued'
    }
    const continued = await runConversation('conv', {
      stream,
      continueInVersionId: first.versionId,
      rounds: 1,
    })

    expect(continued).toMatchObject({ ok: true, status: 'done' })
    expect(models).toEqual([PROFILE_REVIEW_MODEL])
    expect(useGraph.getState().runs[0]?.model).toBe(PROFILE_REVIEW_MODEL)
    expect(useGraph.getState().runs[0]?.conversation?.participants[0]?.model)
      .toBe(PROFILE_REVIEW_MODEL)
  })

  it('starts each fresh Run as a new version (Run again ⇒ v2)', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('solo', 'askAi', { title: 'Solo' }),
      ],
      connections: [feed('c-solo', 'solo', 'conv')],
    })

    const first = await runConversation('conv', { stream: fakeStream().stream })
    const second = await runConversation('conv', { stream: fakeStream().stream })
    expect(first.ok && second.ok).toBe(true)
    if (!first.ok || !second.ok) return

    // A fresh Run is a brand-new conversation, so it is a new version.
    expect(second.versionId).not.toBe(first.versionId)
    expect(useGraph.getState().outputs[0].versions).toHaveLength(2)
  })
})

describe('runConversation — context budget (ADR 0015)', () => {
  // Big enough to blow the 102.4k-token budget of the fallback 128k window.
  const HUGE = 'A fact worth keeping. '.repeat(22_000) // ~484k printable chars ≈ 121k tokens

  it("compacts a participant's oversized private context instead of sending it whole", async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationStyle: 'debate', conversationTurns: 1 }),
        card('speaker', 'askAi', { title: 'Solo', blocks: [{ id: 's', text: 'Make the case.' }] }),
        card('small', 'note', { blocks: [{ id: 'sm', text: 'A small strong thought.' }] }),
        card('huge', 'note', { blocks: [{ id: 'hg', text: HUGE }] }),
      ],
      connections: [
        feed('cp', 'speaker', 'conv'),
        feed('cs', 'small', 'speaker'),
        { ...feed('ch', 'huge', 'speaker'), strength: 'weak' as const },
      ],
    })

    const turns: string[] = []
    const compactions: string[] = []
    const stream: ConversationStream = async (instruction, opts) => {
      turns.push(instruction)
      opts.onChunk('spoken')
      return 'spoken'
    }
    const compactionStream: CompletionStream = async (instruction, opts) => {
      compactions.push(instruction)
      opts.onChunk('THE-SHORT-SUMMARY')
      return 'THE-SHORT-SUMMARY'
    }

    const outcome = await runConversation('conv', {
      stream,
      compactionStream,
      generateSpeakerName: async () => 'Solo',
    })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    // A cheap-model summary was generated for the oversized card once...
    expect(compactions).toHaveLength(1)
    // ...cached on the board, fingerprint-keyed...
    expect(useGraph.getState().compactionSummaries.map((s) => s.cardId)).toContain('huge')
    // ...the turn shown to the participant carries the summary, never the raw text...
    expect(turns[0]).toContain('THE-SHORT-SUMMARY')
    expect(turns[0]).not.toContain(HUGE)
    // ...and the run records what the budget did so the result marker can show it.
    const run = useGraph.getState().runs.find((r) => r.kind === 'conversation')!
    expect(run.contextBudget?.compactedCardIds).toContain('huge')
  })

  it('leaves an under-budget conversation untouched with no budget provenance', async () => {
    useGraph.setState({
      cards: [
        card('conv', 'conversation', { conversationTurns: 1 }),
        card('speaker', 'askAi', { title: 'Solo', blocks: [{ id: 's', text: 'Speak.' }] }),
        card('small', 'note', { blocks: [{ id: 'sm', text: 'A small thought.' }] }),
      ],
      connections: [feed('cp', 'speaker', 'conv'), feed('cs', 'small', 'speaker')],
    })

    const compactions: string[] = []
    const stream: ConversationStream = async (_instruction, opts) => {
      opts.onChunk('spoken')
      return 'spoken'
    }
    const compactionStream: CompletionStream = async (instruction, opts) => {
      compactions.push(instruction)
      opts.onChunk('unused')
      return 'unused'
    }

    await runConversation('conv', { stream, compactionStream, generateSpeakerName: async () => 'Solo' })

    expect(compactions).toHaveLength(0)
    const run = useGraph.getState().runs.find((r) => r.kind === 'conversation')!
    expect(run.contextBudget).toBeUndefined()
  })
})
