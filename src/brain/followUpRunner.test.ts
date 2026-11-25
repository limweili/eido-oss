import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../graph/store'
import type { Card, FollowUpMessage, RunRecord } from '../graph/types'
import { PROFILE_REVIEW_MODEL } from '../shared/profileReviewPolicy'
import {
  buildFollowUpInstruction,
  cancelFollowUp,
  forgetCardNotesForTests,
  runFollowUp,
  type FollowUpStream,
} from './followUpRunner'
import { CARD_COMPACTION_SYSTEM_PROMPT, CARD_HANDOFF_PREAMBLE } from './cardContextCompaction'
import { recordModelWindow, resetModelWindowsForTests } from './modelWindows'
import { resetTokenCalibrationForTests } from './tokenCalibration'

function resetStore() {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    selection: null,
    selectedCardIds: [],
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

function card(id: string, text: string): Card {
  return {
    id,
    kind: 'askAi',
    blocks: [{ id: `${id}-b`, text }],
    position: { x: 0, y: 0 },
  }
}

function run(
  id: string,
  compiledInstruction: string,
  provider: RunRecord['provider'] = 'openrouter',
): RunRecord {
  return {
    id,
    startedAt: '2026-01-01T00:00:00.000Z',
    askAiCardId: 'ask',
    model: 'stored/model',
    provider,
    usedCardIds: ['note-old'],
    usedConnectionIds: ['conn-old'],
    modIds: [],
    appliedMods: [],
    compiledInstruction,
    producedVersionId: 'v1',
    status: 'done',
  }
}

function prior(id: string, role: FollowUpMessage['role'], text: string): FollowUpMessage {
  return {
    id,
    role,
    text,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'complete',
  }
}

beforeEach(() => {
  resetStore()
  forgetCardNotesForTests()
  resetModelWindowsForTests()
  resetTokenCalibrationForTests()
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('buildFollowUpInstruction', () => {
  it('combines frozen run context, selected result text, prior thread, and the new question', () => {
    const instruction = buildFollowUpInstruction({
      originalInstruction: 'FROZEN CONTEXT',
      resultText: 'Original answer.',
      priorMessages: [prior('p1', 'user', 'Earlier?'), prior('p2', 'assistant', 'Earlier answer.')],
      question: 'What changed?',
    })

    expect(instruction).toContain('FROZEN CONTEXT')
    expect(instruction).toContain('Original answer.')
    expect(instruction).toContain('User: Earlier?')
    expect(instruction).toContain('Assistant: Earlier answer.')
    expect(instruction).toContain('What changed?')
  })
})

describe('runFollowUp', () => {
  it('streams a reply from stored run provenance, not the current board', async () => {
    useGraph.setState({
      cards: [card('ask', 'CURRENT BOARD TEXT SHOULD NOT APPEAR')],
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'v1',
          versions: [
            {
              id: 'v1',
              number: 1,
              text: 'Selected result text.',
              createdAt: '2026-01-01T00:00:00.000Z',
              fromRunId: 'run',
            },
          ],
        },
      ],
      runs: [run('run', 'OLD FROZEN CONTEXT')],
    })

    const seen: { instruction?: string; model?: string } = {}
    const stream: FollowUpStream = async (instruction, opts) => {
      seen.instruction = instruction
      seen.model = opts.model
      opts.onChunk('follow-up answer')
      return 'follow-up answer'
    }

    const outcome = await runFollowUp('v1', 'Please extend it.', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(seen.model).toBe('stored/model')
    expect(seen.instruction).toContain('OLD FROZEN CONTEXT')
    expect(seen.instruction).toContain('Selected result text.')
    expect(seen.instruction).toContain('Please extend it.')
    expect(seen.instruction).not.toContain('CURRENT BOARD TEXT SHOULD NOT APPEAR')

    const messages = useGraph.getState().outputs[0].versions[0].followUpThread?.messages
    expect(messages?.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(messages?.[1]).toMatchObject({ text: 'follow-up answer', status: 'complete' })
  })

  it('uses the current provider model after the Idea changes provider', async () => {
    useGraph.setState((state) => ({
      settings: {
        ...state.settings,
        provider: 'openrouter',
        model: 'current/openrouter-model',
        models: ['current/openrouter-model'],
      },
      outputs: [{
        id: 'out',
        resultCardId: 'result',
        chosenVersionId: 'v1',
        versions: [{
          id: 'v1',
          number: 1,
          text: 'A result created by Claude.',
          createdAt: '2026-01-01T00:00:00.000Z',
          fromRunId: 'run',
        }],
      }],
      runs: [run('run', 'OLD FROZEN CONTEXT', 'claude-code')],
    }))
    let model = ''
    const stream: FollowUpStream = async (_instruction, opts) => {
      model = opts.model
      opts.onChunk('continued')
      return 'continued'
    }

    await expect(runFollowUp('v1', 'Continue.', { stream })).resolves.toMatchObject({ ok: true })

    expect(model).toBe('current/openrouter-model')
  })

  it('stops streaming and preserves the partial assistant reply', async () => {
    useGraph.setState({
      outputs: [
        {
          id: 'out',
          resultCardId: 'result',
          chosenVersionId: 'v1',
          versions: [
            {
              id: 'v1',
              number: 1,
              text: 'Selected result text.',
              createdAt: '2026-01-01T00:00:00.000Z',
              fromRunId: 'run',
            },
          ],
        },
      ],
      runs: [run('run', 'OLD FROZEN CONTEXT')],
    })

    const stream: FollowUpStream = async (_instruction, opts) => {
      opts.onChunk('partial')
      cancelFollowUp('v1')
      return 'partial'
    }

    const outcome = await runFollowUp('v1', 'Stop after this.', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'stopped' })
    const messages = useGraph.getState().outputs[0].versions[0].followUpThread?.messages
    expect(messages?.[1]).toMatchObject({ role: 'assistant', text: 'partial', status: 'stopped' })
  })

  it('uses the fixed review model instead of historical run provenance', async () => {
    vi.stubGlobal('window', {
      eidoDesktop: true,
      eidoProfileReview: true,
    })
    useGraph.setState({
      outputs: [{
        id: 'out',
        resultCardId: 'result',
        chosenVersionId: 'v1',
        versions: [{
          id: 'v1',
          number: 1,
          text: 'Selected result text.',
          createdAt: '2026-01-01T00:00:00.000Z',
          fromRunId: 'run',
        }],
      }],
      runs: [run('run', 'OLD FROZEN CONTEXT')],
    })
    const models: string[] = []
    const stream: FollowUpStream = async (_instruction, opts) => {
      models.push(opts.model)
      opts.onChunk('continued')
      return 'continued'
    }

    expect(await runFollowUp('v1', 'Continue.', { stream })).toMatchObject({
      ok: true,
      status: 'done',
    })
    expect(models).toEqual([PROFILE_REVIEW_MODEL])
  })

  it('clamps an agentic follow-up to the Web tools, even on a research-armed Card (#961)', async () => {
    useGraph.setState((state) => ({
      settings: { ...state.settings, linkupKey: 'lk-test' },
      cards: [{ ...card('ask', 'unused'), meta: { reachMode: 'research' } }],
      outputs: [{
        id: 'out',
        resultCardId: 'result',
        chosenVersionId: 'v1',
        versions: [{
          id: 'v1',
          number: 1,
          text: 'Selected result text.',
          createdAt: '2026-01-01T00:00:00.000Z',
          fromRunId: 'run',
        }],
      }],
      runs: [{ ...run('run', 'OLD FROZEN CONTEXT'), agentic: true as const }],
    }))
    let toolNames: string[] | undefined
    const stream: FollowUpStream = async (_instruction, opts) => {
      toolNames = opts.eidoTools?.tools.map((tool) => tool.declaration.function.name)
      opts.onChunk('Let me look. ')
      opts.onAnswerRestart?.()
      opts.onChunk('The answer.')
      return 'The answer.'
    }

    const outcome = await runFollowUp('v1', 'Check the web again.', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    // The Card is armed for Research, and the follow-up still gets the Web
    // set: a conversational reply must never submit a minutes-long job the
    // user was warned about at a different press. Someone who wants another
    // investigation presses Run.
    expect(toolNames).toEqual(['search_web', 'fetch_page'])
    const messages = useGraph.getState().outputs[0].versions[0].followUpThread?.messages
    expect(messages?.[1]).toMatchObject({ role: 'assistant', text: 'The answer.', status: 'complete' })
  })

  it('keeps a Linkup follow-up armed with the user key', async () => {
    useGraph.setState((state) => ({
      settings: { ...state.settings, linkupKey: 'lk-test' },
      cards: [{ ...card('ask', 'unused'), meta: { reachMode: 'web' } }],
      outputs: [{
        id: 'out',
        resultCardId: 'result',
        chosenVersionId: 'v1',
        versions: [{
          id: 'v1',
          number: 1,
          text: 'Selected result text.',
          createdAt: '2026-01-01T00:00:00.000Z',
          fromRunId: 'run',
        }],
      }],
      runs: [{ ...run('run', 'OLD FROZEN CONTEXT'), agentic: true as const }],
    }))
    let seen: { agentic?: boolean; tools?: string[] } | undefined
    const stream: FollowUpStream = async (_instruction, opts) => {
      seen = {
        agentic: opts.agentic,
        tools: opts.eidoTools?.tools.map((tool) => tool.declaration.function.name),
      }
      opts.onChunk('The answer, from what was already read.')
      return 'The answer, from what was already read.'
    }

    const outcome = await runFollowUp('v1', 'Check the web again.', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(seen).toEqual({ agentic: true, tools: ['search_web', 'fetch_page'] })
    const messages = useGraph.getState().outputs[0].versions[0].followUpThread?.messages
    expect(messages?.[1]).toMatchObject({ role: 'assistant', status: 'complete' })
  })

  it('keeps a keyless local-harness follow-up armed from its admitted BYOK route', async () => {
    useGraph.setState((state) => ({
      settings: {
        ...state.settings,
        apiKey: '',
        provider: 'claude-code',
        model: 'stored/model',
        models: ['stored/model'],
      },
      outputs: [{
        id: 'out',
        resultCardId: 'result',
        chosenVersionId: 'v1',
        versions: [{
          id: 'v1',
          number: 1,
          text: 'Selected result text.',
          createdAt: '2026-01-01T00:00:00.000Z',
          fromRunId: 'run',
        }],
      }],
      runs: [{ ...run('run', 'OLD FROZEN CONTEXT', 'claude-code'), agentic: true as const }],
    }))
    let seen: { agentic?: boolean; tools?: string[] } | undefined
    const stream: FollowUpStream = async (_instruction, opts) => {
      seen = {
        agentic: opts.agentic,
        tools: opts.eidoTools?.tools.map((tool) => tool.declaration.function.name),
      }
      opts.onChunk('The local answer.')
      return 'The local answer.'
    }

    await expect(runFollowUp('v1', 'Continue locally.', { stream })).resolves.toMatchObject({
      ok: true,
      status: 'done',
    })
    expect(seen).toEqual({ agentic: true, tools: undefined })
  })

  it('builds no executors for a follow-up when no Linkup key exists', async () => {
    useGraph.setState({
      outputs: [{
        id: 'out',
        resultCardId: 'result',
        chosenVersionId: 'v1',
        versions: [{
          id: 'v1',
          number: 1,
          text: 'Selected result text.',
          createdAt: '2026-01-01T00:00:00.000Z',
          fromRunId: 'run',
        }],
      }],
      runs: [{ ...run('run', 'OLD FROZEN CONTEXT'), agentic: true as const }],
    })
    const seen: unknown[] = []
    const stream: FollowUpStream = async (_instruction, opts) => {
      seen.push(opts.eidoTools)
      opts.onChunk('ok')
      return 'ok'
    }

    await expect(runFollowUp('v1', 'Continue.', { stream })).resolves.toMatchObject({ ok: true })
    expect(seen).toEqual([undefined])
  })
})

// ---- staying inside the window ---------------------------------------------

// A window small enough to be crossed by a test-sized discussion, recorded the
// way a provider's own refusal would record it.
const SMALL_WINDOW_TOKENS = 10_000

function seedLongDiscussion(oldAnswer: string) {
  useGraph.setState({
    outputs: [
      {
        id: 'out',
        resultCardId: 'result',
        chosenVersionId: 'v1',
        versions: [
          {
            id: 'v1',
            number: 1,
            text: 'Selected result text.',
            createdAt: '2026-01-01T00:00:00.000Z',
            fromRunId: 'run',
            followUpThread: {
              messages: [
                prior('u1', 'user', 'The oldest question?'),
                prior('a1', 'assistant', oldAnswer),
                prior('u2', 'user', 'The freshest question?'),
                prior('a2', 'assistant', 'The freshest answer.'),
              ],
            },
          },
        ],
      },
    ],
    runs: [run('run', 'FROZEN CONTEXT')],
  })
  recordModelWindow('stored/model', SMALL_WINDOW_TOKENS)
}

// Answers the summarising call with `note`, then the reply. Records what each
// call was asked, in order.
function twoCallStream(note: string, reply = 'the continued answer') {
  const asked: string[] = []
  const stream: FollowUpStream = async (instruction, opts) => {
    asked.push(instruction)
    const text = instruction.startsWith(CARD_COMPACTION_SYSTEM_PROMPT) ? note : reply
    opts.onChunk(text)
    return text
  }
  return { asked, stream }
}

describe('runFollowUp staying inside the model window', () => {
  it('sends the whole discussion while it still fits', async () => {
    seedLongDiscussion('A short earlier answer.')
    const { asked, stream } = twoCallStream('a note nobody should need')

    await runFollowUp('v1', 'Carry on.', { stream })

    // One call, and it is the reply: nothing was summarised and nothing paid for.
    expect(asked).toHaveLength(1)
    expect(asked[0]).toContain('A short earlier answer.')
    expect(asked[0]).not.toContain(CARD_HANDOFF_PREAMBLE)
  })

  it('replaces the older turns with a note once the card outgrows the window', async () => {
    const oldAnswer = `The oldest answer, at length. ${'detail '.repeat(6_000)}`
    seedLongDiscussion(oldAnswer)
    const { asked, stream } = twoCallStream('What has been answered: the oldest answer said so.')

    const outcome = await runFollowUp('v1', 'Carry on.', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(asked).toHaveLength(2)
    // The summariser is asked first, and it is given the turns being dropped.
    expect(asked[0].startsWith(CARD_COMPACTION_SYSTEM_PROMPT)).toBe(true)
    expect(asked[0]).toContain('The oldest question?')
    // The reply carries the note in their place, and the freshest turn whole.
    expect(asked[1]).toContain(CARD_HANDOFF_PREAMBLE)
    expect(asked[1]).toContain('What has been answered: the oldest answer said so.')
    expect(asked[1]).not.toContain('The oldest question?')
    expect(asked[1]).toContain('The freshest answer.')
    expect(asked[1]).toContain('Carry on.')
  })

  it('tells the reader it happened, in the trail the reply already uses', async () => {
    seedLongDiscussion(`The oldest answer. ${'detail '.repeat(6_000)}`)
    const { stream } = twoCallStream('What has been answered: plenty.')

    await runFollowUp('v1', 'Carry on.', { stream })

    const messages = useGraph.getState().outputs[0].versions[0].followUpThread?.messages ?? []
    const reply = messages[messages.length - 1]
    expect(reply.toolSteps).toEqual([
      { kind: 'compaction', detail: 'What has been answered: plenty.' },
    ])
  })

  it('leaves the reader their whole discussion on the card', async () => {
    seedLongDiscussion(`The oldest answer. ${'detail '.repeat(6_000)}`)
    const { stream } = twoCallStream('What has been answered: plenty.')

    await runFollowUp('v1', 'Carry on.', { stream })

    const messages = useGraph.getState().outputs[0].versions[0].followUpThread?.messages ?? []
    expect(messages.map((message) => message.id).slice(0, 4)).toEqual(['u1', 'a1', 'u2', 'a2'])
    expect(messages[1].text).toContain('The oldest answer.')
  })

  it('answers on the full discussion when the summariser fails', async () => {
    seedLongDiscussion(`The oldest answer. ${'detail '.repeat(6_000)}`)
    const asked: string[] = []
    const stream: FollowUpStream = async (instruction, opts) => {
      asked.push(instruction)
      if (instruction.startsWith(CARD_COMPACTION_SYSTEM_PROMPT)) throw new Error('summariser down')
      opts.onChunk('answered anyway')
      return 'answered anyway'
    }

    const outcome = await runFollowUp('v1', 'Carry on.', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'done' })
    expect(asked[1]).toContain('The oldest question?')
    expect(asked[1]).not.toContain(CARD_HANDOFF_PREAMBLE)
    const messages = useGraph.getState().outputs[0].versions[0].followUpThread?.messages ?? []
    expect(messages[messages.length - 1].toolSteps).toBeUndefined()
  })

  it('answers on the full discussion when the summariser says nothing', async () => {
    seedLongDiscussion(`The oldest answer. ${'detail '.repeat(6_000)}`)
    const { asked, stream } = twoCallStream('   ')

    await runFollowUp('v1', 'Carry on.', { stream })

    expect(asked[1]).toContain('The oldest question?')
    expect(asked[1]).not.toContain(CARD_HANDOFF_PREAMBLE)
  })

  it('reuses the note it already paid for on the next follow-up', async () => {
    seedLongDiscussion(`The oldest answer. ${'detail '.repeat(6_000)}`)
    const { asked, stream } = twoCallStream('What has been answered: plenty.')

    await runFollowUp('v1', 'Carry on.', { stream })
    await runFollowUp('v1', 'And again.', { stream })

    // One summarising call across two follow-ups, and the second still sends
    // the note rather than the turns it stands in for.
    expect(asked.filter((text) => text.startsWith(CARD_COMPACTION_SYSTEM_PROMPT))).toHaveLength(1)
    expect(asked[2]).toContain('What has been answered: plenty.')
    expect(asked[2]).not.toContain('The oldest question?')
    expect(asked[2]).toContain('And again.')
  })

  it('supersedes its own note rather than stacking a second one beside it', async () => {
    const bulk = 'detail '.repeat(6_000)
    seedLongDiscussion(`The oldest answer. ${bulk}`)
    const asked: string[] = []
    let round = 0
    const stream: FollowUpStream = async (instruction, opts) => {
      asked.push(instruction)
      const summarising = instruction.startsWith(CARD_COMPACTION_SYSTEM_PROMPT)
      if (summarising) round += 1
      const text = summarising ? `NOTE ${round}: what has been answered.` : 'the continued answer'
      opts.onChunk(text)
      return text
    }

    await runFollowUp('v1', 'Carry on.', { stream })
    // The discussion grows past the threshold again, on top of the note.
    useGraph.getState().appendFollowUpMessage('v1', prior('u9', 'user', 'And more?'))
    useGraph.getState().appendFollowUpMessage('v1', prior('a9', 'assistant', `A later answer. ${bulk}`))
    await runFollowUp('v1', 'Once more.', { stream })

    expect(round).toBe(2)
    const secondAsk = asked.filter((text) => text.startsWith(CARD_COMPACTION_SYSTEM_PROMPT))[1]
    // The first note reaches the summariser once, as material rather than as
    // instructions, so the second note replaces it instead of sitting beside it.
    expect(secondAsk.split('NOTE 1: what has been answered.')).toHaveLength(2)
    expect(secondAsk).not.toContain(CARD_HANDOFF_PREAMBLE)
    // The reply that follows carries only the fresher note.
    const secondReply = asked[asked.length - 1]
    expect(secondReply).toContain('NOTE 2: what has been answered.')
    expect(secondReply).not.toContain('NOTE 1: what has been answered.')
    expect(secondReply).not.toContain('The oldest question?')
  })

  it('stops asking for a note once nothing is left but the note itself', async () => {
    const bulk = 'detail '.repeat(6_000)
    seedLongDiscussion(`The oldest answer. ${bulk}`)
    const { asked, stream } = twoCallStream('NOTE: what has been answered, at some length.')

    await runFollowUp('v1', 'One.', { stream })
    await runFollowUp('v1', 'Two.', { stream })
    await runFollowUp('v1', 'Three.', { stream })

    // One note, paid for once. Without this the only summarisable turn from the
    // second follow-up on is the note the card wrote itself, and it would buy a
    // completion to rewrite its own summary on every question forever, each one
    // a lossy generation further from what the reader actually said.
    expect(asked.filter((text) => text.startsWith(CARD_COMPACTION_SYSTEM_PROMPT))).toHaveLength(1)
    expect(asked[asked.length - 1]).toContain('NOTE: what has been answered, at some length.')
    expect(asked[asked.length - 1]).toContain('Three.')
  })

  it('keeps reusing its second note, having recorded only real messages as covered', async () => {
    const bulk = 'detail '.repeat(6_000)
    seedLongDiscussion(`The oldest answer. ${bulk}`)
    const asked: string[] = []
    let round = 0
    const stream: FollowUpStream = async (instruction, opts) => {
      asked.push(instruction)
      const summarising = instruction.startsWith(CARD_COMPACTION_SYSTEM_PROMPT)
      if (summarising) round += 1
      const text = summarising ? `NOTE ${round}: what has been answered.` : 'the continued answer'
      opts.onChunk(text)
      return text
    }

    await runFollowUp('v1', 'One.', { stream })
    useGraph.getState().appendFollowUpMessage('v1', prior('u9', 'user', 'And more?'))
    useGraph.getState().appendFollowUpMessage('v1', prior('a9', 'assistant', `A later answer. ${bulk}`))
    await runFollowUp('v1', 'Two.', { stream })
    await runFollowUp('v1', 'Three.', { stream })

    // Two notes, for two real stretches of discussion, and no third. The
    // synthetic message carrying note one is not a message of this thread, so
    // recording it as covered would make note two look inapplicable from here
    // on and buy a fresh summary on every remaining question.
    expect(round).toBe(2)
    const last = asked[asked.length - 1]
    expect(last).toContain('NOTE 2: what has been answered.')
    expect(last).not.toContain('The oldest question?')
    expect(last).toContain('Three.')
  })

  it('drops a note whose discussion has changed underneath it', async () => {
    seedLongDiscussion(`The oldest answer. ${'detail '.repeat(6_000)}`)
    const asked: string[] = []
    let round = 0
    const stream: FollowUpStream = async (instruction, opts) => {
      asked.push(instruction)
      const summarising = instruction.startsWith(CARD_COMPACTION_SYSTEM_PROMPT)
      if (summarising) round += 1
      const text = summarising ? `NOTE ${round}: what has been answered.` : 'the continued answer'
      opts.onChunk(text)
      return text
    }

    await runFollowUp('v1', 'Carry on.', { stream })
    // The thread is replaced wholesale, as a board reload or an idea duplicate
    // can leave it. The note now stands in for turns that are not there.
    useGraph.setState((state) => ({
      outputs: state.outputs.map((output) => ({
        ...output,
        versions: output.versions.map((version) => ({
          ...version,
          followUpThread: {
            messages: [
              prior('z1', 'user', 'A different discussion entirely.'),
              prior('z2', 'assistant', `Another long answer. ${'other '.repeat(6_000)}`),
            ],
          },
        })),
      })),
    }))
    await runFollowUp('v1', 'And now?', { stream })

    // The second request carries the real thread, not a summary of turns that
    // no longer exist.
    // Still over the threshold, so the stale note WOULD have been applied had
    // the guard not dropped it. Instead the real thread is summarised afresh:
    // the second summariser is shown the new discussion and is never handed the
    // note that described turns which no longer exist.
    const summariserAsks = asked.filter((text) => text.startsWith(CARD_COMPACTION_SYSTEM_PROMPT))
    expect(summariserAsks).toHaveLength(2)
    expect(summariserAsks[1]).toContain('A different discussion entirely.')
    expect(summariserAsks[1]).not.toContain('NOTE 1: what has been answered.')
    const last = asked[asked.length - 1]
    expect(last).toContain('NOTE 2: what has been answered.')
    expect(last).not.toContain('NOTE 1: what has been answered.')
  })

  it('sends the real discussion again once the reader moves to a roomier model', async () => {
    seedLongDiscussion(`The oldest answer. ${'detail '.repeat(6_000)}`)
    const { asked, stream } = twoCallStream('NOTE: what has been answered.')

    await runFollowUp('v1', 'Carry on.', { stream })
    // A window with room to spare. The note was a saving, not a state the card
    // is now stuck in.
    resetModelWindowsForTests()
    await runFollowUp('v1', 'And now?', { stream })

    const last = asked[asked.length - 1]
    expect(last).toContain('The oldest question?')
    expect(last).not.toContain(CARD_HANDOFF_PREAMBLE)
  })

  it('sends the discussion whole when the note comes back no smaller', async () => {
    const bulk = 'detail '.repeat(6_000)
    seedLongDiscussion(`The oldest answer. ${bulk}`)
    // A summariser told to be complete can hand back more than it was given.
    const { asked, stream } = twoCallStream(`A near transcription. ${bulk} ${bulk}`)

    await runFollowUp('v1', 'Carry on.', { stream })

    expect(asked[1]).toContain('The oldest question?')
    expect(asked[1]).not.toContain(CARD_HANDOFF_PREAMBLE)
    const messages = useGraph.getState().outputs[0].versions[0].followUpThread?.messages ?? []
    expect(messages[messages.length - 1].toolSteps).toBeUndefined()
  })

  it('does not buy the same unshortenable note twice', async () => {
    const bulk = 'detail '.repeat(6_000)
    seedLongDiscussion(`The oldest answer. ${bulk}`)
    const { asked, stream } = twoCallStream(`A near transcription. ${bulk} ${bulk}`)

    await runFollowUp('v1', 'Carry on.', { stream })
    await runFollowUp('v1', 'And again?', { stream })

    // Three calls, not four: one refused note, and a reply each time. The
    // second follow-up faces the same material and does not pay to be told
    // again that it cannot be said shorter.
    expect(asked).toHaveLength(3)
    expect(asked.filter((instruction) => instruction.startsWith(CARD_COMPACTION_SYSTEM_PROMPT))).toHaveLength(1)
    expect(asked[2]).toContain('The oldest question?')
  })

  it('does not re-buy an unshortenable note every time the discussion inches forward', async () => {
    const bulk = 'detail '.repeat(6_000)
    seedLongDiscussion(`The oldest answer. ${bulk}`)
    // A summariser that can never shorten this material, and follow-ups whose
    // own answers are substantial enough to push older turns out of the tail.
    // Each one makes the plan cover ids the last refusal did not, which is the
    // shape that turns a subset test into no guard at all.
    const { asked, stream } = twoCallStream(`A near transcription. ${bulk} ${bulk}`, 'answer '.repeat(900))

    for (let index = 0; index < 5; index += 1) {
      await runFollowUp('v1', `Question ${index}.`, { stream })
    }

    const summariserCalls = asked.filter((instruction) =>
      instruction.startsWith(CARD_COMPACTION_SYSTEM_PROMPT),
    ).length
    // At most one paid attempt per floor's worth of genuinely new discussion.
    // Five follow-ups against material that can never be shortened cost two
    // summariser calls, not five: the guard is what keeps the wasted spend
    // proportional to what the reader added rather than to how often they ask.
    expect(summariserCalls).toBeLessThanOrEqual(2)
  })

  it('honours a cancel pressed while the note is being written', async () => {
    seedLongDiscussion(`The oldest answer. ${'detail '.repeat(6_000)}`)
    const stream: FollowUpStream = async (instruction) => {
      if (instruction.startsWith(CARD_COMPACTION_SYSTEM_PROMPT)) {
        cancelFollowUp('v1')
        throw new Error('canceled')
      }
      throw new Error('the reply must never be asked for')
    }

    const outcome = await runFollowUp('v1', 'Carry on.', { stream })

    expect(outcome).toMatchObject({ ok: true, status: 'stopped' })
  })
})
