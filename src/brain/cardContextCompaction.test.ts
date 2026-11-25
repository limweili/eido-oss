import { beforeEach, describe, expect, it } from 'vitest'
import type { FollowUpMessage } from '../graph/types'
import {
  buildThreadNoteInstruction,
  CARD_HANDOFF_PREAMBLE,
  cardCompactionThreshold,
  cardContextTokens,
  compactedThread,
  coveredMessageIds,
  estimateFollowUpMaterialTokens,
  estimateFollowUpTokens,
  planThreadCompaction,
  renderThreadMaterial,
  splitThread,
} from './cardContextCompaction'
import {
  COMPACTION_MIN_MATERIAL_TOKENS,
  COMPACTION_TAIL_KEEP_TOKENS,
  compactionMaterialFloor,
  compactionTailBudget,
} from './conversationCompaction'
import { recordModelWindow, resetModelWindowsForTests } from './modelWindows'
import {
  calibratedTokens,
  recordTokenCalibration,
  resetTokenCalibrationForTests,
} from './tokenCalibration'

function message(
  id: string,
  role: FollowUpMessage['role'],
  text: string,
  extra: Partial<FollowUpMessage> = {},
): FollowUpMessage {
  return {
    id,
    role,
    text,
    createdAt: '2026-01-01T00:00:00.000Z',
    status: 'complete',
    ...extra,
  }
}

// One turn of roughly the given estimated size, so a plan can be aimed at the
// thresholds rather than at whatever a hand-written string happens to weigh.
function turnOf(index: number, tokens: number): FollowUpMessage[] {
  return [
    message(`u${index}`, 'user', `Question ${index}?`),
    message(`a${index}`, 'assistant', `A${index} `.repeat(Math.ceil((tokens * 4) / 3))),
  ]
}

// The threshold on an ordinary window (128k model), where the fixed tail and
// floor are the binding numbers rather than the shares of the threshold.
const ORDINARY_THRESHOLD = 102_400

beforeEach(() => {
  resetModelWindowsForTests()
  resetTokenCalibrationForTests()
})

describe('splitThread', () => {
  it('keeps a question and everything answering it in one turn', () => {
    const turns = splitThread([
      message('u1', 'user', 'First?'),
      message('a1', 'assistant', 'First answer.'),
      message('u2', 'user', 'Second?'),
      message('a2', 'assistant', 'Second answer.'),
    ])

    expect(turns).toHaveLength(2)
    expect(turns[0].messages.map((m) => m.id)).toEqual(['u1', 'a1'])
    expect(turns[1].messages.map((m) => m.id)).toEqual(['u2', 'a2'])
  })

  it('leaves out what the card would not send anyway', () => {
    const turns = splitThread([
      message('u1', 'user', 'First?'),
      message('a1', 'assistant', 'half written', { status: 'streaming' }),
      message('a2', 'assistant', 'never landed', { status: 'failed' }),
      message('a3', 'assistant', '   '),
      message('a4', 'assistant', 'The real answer.'),
    ])

    expect(turns).toHaveLength(1)
    expect(turns[0].messages.map((m) => m.id)).toEqual(['u1', 'a4'])
  })
})

describe('what a turn costs, measured twice', () => {
  const bare = message('a1', 'assistant', 'Short answer.')
  const withTrail = message('a1', 'assistant', 'Short answer.', {
    toolSteps: [{ kind: 'read', detail: 'https://example.com/a-long-address-that-costs-tokens' }],
  })

  it('charges the request for the text only, because a trail is never sent', () => {
    expect(estimateFollowUpTokens(withTrail)).toBe(estimateFollowUpTokens(bare))
  })

  it('charges the summariser for what the reply looked up, because it is shown that', () => {
    expect(estimateFollowUpMaterialTokens(withTrail)).toBeGreaterThan(
      estimateFollowUpMaterialTokens(bare),
    )
  })

  it('charges the summariser nothing for a note it is already handed once', () => {
    const note = message('n1', 'user', `${CARD_HANDOFF_PREAMBLE}\n\n${'a summary. '.repeat(400)}`)

    expect(estimateFollowUpTokens(note)).toBeGreaterThan(500)
    expect(estimateFollowUpMaterialTokens(note)).toBe(0)
  })

  it('charges the summariser nothing for the row saying a note was written', () => {
    const compacted = message('a1', 'assistant', 'Short answer.', {
      toolSteps: [{ kind: 'compaction', detail: 'a summary. '.repeat(400) }],
    })

    expect(estimateFollowUpMaterialTokens(compacted)).toBe(estimateFollowUpMaterialTokens(bare))
  })
})

describe('a card with nothing left to summarise', () => {
  it('refuses to pay for a completion to rewrite its own note', () => {
    // The degenerate case: the only summarisable turn is the handoff note this
    // card wrote last time. Its text is large, so a plan measured on request
    // cost would clear the floor and buy a completion that summarises nothing,
    // on this follow-up and on every one after it.
    const note = message('n1', 'user', `${CARD_HANDOFF_PREAMBLE}\n\n${'a summary. '.repeat(4_000)}`)
    const messages = [note, ...turnOf(2, 200)]

    expect(estimateFollowUpTokens(note)).toBeGreaterThan(COMPACTION_MIN_MATERIAL_TOKENS)
    expect(planThreadCompaction(messages, ORDINARY_THRESHOLD)).toBeNull()
  })
})

describe('planThreadCompaction', () => {
  it('always leaves the oldest turn to be summarised, so a cut always reduces', () => {
    const messages = [...turnOf(1, COMPACTION_MIN_MATERIAL_TOKENS + 2_000), ...turnOf(2, 200)]

    const plan = planThreadCompaction(messages, ORDINARY_THRESHOLD)

    expect(plan).not.toBeNull()
    expect(plan?.summarize.map((turn) => turn.messages[0].id)).toEqual(['u1'])
    expect(plan?.tail.map((turn) => turn.messages[0].id)).toEqual(['u2'])
  })

  it('refuses a discussion too small to be worth a whole extra model call', () => {
    expect(planThreadCompaction([...turnOf(1, 500), ...turnOf(2, 500)], ORDINARY_THRESHOLD)).toBeNull()
  })

  it('refuses an empty discussion', () => {
    expect(planThreadCompaction([], ORDINARY_THRESHOLD)).toBeNull()
  })

  it('summarises a freshest turn that is larger than the whole tail budget', () => {
    const messages = [
      ...turnOf(1, COMPACTION_MIN_MATERIAL_TOKENS),
      ...turnOf(2, COMPACTION_TAIL_KEEP_TOKENS + 5_000),
    ]

    const plan = planThreadCompaction(messages, ORDINARY_THRESHOLD)

    expect(plan?.tail).toHaveLength(0)
    expect(plan?.summarize.map((turn) => turn.messages[0].id)).toEqual(['u1', 'u2'])
  })

  it('keeps as many of the freshest turns whole as the tail budget allows', () => {
    const messages = [
      ...turnOf(1, COMPACTION_MIN_MATERIAL_TOKENS + 5_000),
      ...turnOf(2, 5_000),
      ...turnOf(3, 5_000),
      ...turnOf(4, 5_000),
    ]

    const plan = planThreadCompaction(messages, ORDINARY_THRESHOLD)

    expect(plan?.tail.map((turn) => turn.messages[0].id)).toEqual(['u3', 'u4'])
    expect(plan?.summarize.map((turn) => turn.messages[0].id)).toEqual(['u1', 'u2'])
  })
})

describe('planThreadCompaction on a small window', () => {
  it('never keeps a tail bigger than half the room it has to fit in', () => {
    // A 16k model: threshold 12,800, which the fixed 12,000 tail budget would
    // very nearly fill on its own, leaving compaction nothing it may cut.
    const threshold = 12_800
    const messages = [...turnOf(1, 1_200), ...turnOf(2, 9_000)]

    const plan = planThreadCompaction(messages, threshold)

    expect(compactionTailBudget(threshold)).toBe(6_400)
    expect(plan).not.toBeNull()
    expect(plan?.tail).toHaveLength(0)
    expect(plan?.summarize.map((turn) => turn.messages[0].id)).toEqual(['u1', 'u2'])
  })

  it('lowers the floor with the room, so a small window can still compact', () => {
    const threshold = 12_800
    const messages = [...turnOf(1, 3_400), ...turnOf(2, 200)]

    expect(compactionMaterialFloor(threshold)).toBe(3_200)
    // Under the fixed 8k floor, over the floor this window actually allows.
    expect(planThreadCompaction(messages, threshold)).not.toBeNull()
  })

  it('leaves an ordinary window on the fixed numbers', () => {
    expect(compactionTailBudget(ORDINARY_THRESHOLD)).toBe(COMPACTION_TAIL_KEEP_TOKENS)
    expect(compactionMaterialFloor(ORDINARY_THRESHOLD)).toBe(COMPACTION_MIN_MATERIAL_TOKENS)
  })
})

describe('renderThreadMaterial', () => {
  it('gives the summariser what was asked, what was answered, and what was looked up', () => {
    const material = renderThreadMaterial(
      splitThread([
        message('u1', 'user', 'Who published it?'),
        message('a1', 'assistant', 'The Cabinet Office did.', {
          toolSteps: [{ kind: 'read', detail: 'https://example.gov/notice' }],
        }),
      ]),
    )

    expect(material).toContain('The reader asked:\nWho published it?')
    expect(material).toContain('The reply used read: https://example.gov/notice')
    expect(material).toContain('The Cabinet Office did.')
  })

  it('marks a reply the reader stopped early, so the note does not read it as finished', () => {
    const material = renderThreadMaterial(
      splitThread([message('a1', 'assistant', 'Half of it.', { status: 'stopped' })]),
    )

    expect(material).toContain('(stopped early)')
  })

  it('does not transcribe the row that says a note was written', () => {
    const earlier = 'What has been answered: the notice is dated March.'
    const material = renderThreadMaterial(
      splitThread([
        message('a1', 'assistant', 'A reply.', {
          toolSteps: [
            { kind: 'compaction', detail: earlier },
            { kind: 'read', detail: 'https://example.gov/notice' },
          ],
        }),
      ]),
      earlier,
    )

    // The note arrives once, as material. The trail row that records it is the
    // reader's, and carrying it here would pay for the whole note twice.
    expect(material.split(earlier)).toHaveLength(2)
    expect(material).not.toContain('The reply used compaction')
    expect(material).toContain('The reply used read: https://example.gov/notice')
  })

  it('carries an earlier note once, not twice, and never as an instruction', () => {
    const earlier = 'What has been answered: the notice is dated March.'
    const material = renderThreadMaterial(
      splitThread([
        message('n1', 'user', `${CARD_HANDOFF_PREAMBLE}\n\n${earlier}`),
        message('u2', 'user', 'And who signed it?'),
      ]),
      earlier,
    )

    expect(material.split(earlier)).toHaveLength(2)
    expect(material).not.toContain(CARD_HANDOFF_PREAMBLE)
  })
})

describe('compactedThread', () => {
  it('puts the note in place of what it covers and keeps the rest word for word', () => {
    const messages = [
      ...turnOf(1, COMPACTION_MIN_MATERIAL_TOKENS + 2_000),
      message('u2', 'user', 'The freshest question?'),
      message('a2', 'assistant', 'The freshest answer.'),
    ]
    const plan = planThreadCompaction(messages, ORDINARY_THRESHOLD)
    expect(plan).not.toBeNull()

    const rebuilt = compactedThread(plan!, 'What has been answered: everything so far.')

    expect(rebuilt[0].text).toContain(CARD_HANDOFF_PREAMBLE)
    expect(rebuilt[0].text).toContain('What has been answered: everything so far.')
    expect(rebuilt.slice(1).map((m) => m.id)).toEqual(['u2', 'a2'])
    expect(rebuilt.every((m) => m.status === 'complete')).toBe(true)
  })

  it('reports exactly the messages the note stands in for', () => {
    const messages = [...turnOf(1, COMPACTION_MIN_MATERIAL_TOKENS + 2_000), ...turnOf(2, 200)]
    const plan = planThreadCompaction(messages, ORDINARY_THRESHOLD)!

    expect(coveredMessageIds(plan)).toEqual(['u1', 'a1'])
  })
})

describe('the ask for the note', () => {
  it('asks for a fixed shape with the discussion fenced off from the instructions', () => {
    const instruction = buildThreadNoteInstruction('DISCUSSION BODY')

    expect(instruction).toContain('What is being worked out')
    expect(instruction).toContain('What has been answered')
    expect(instruction).toContain('What has been ruled out')
    expect(instruction).toContain('What is still open')
    expect(instruction).toContain('--- discussion begins ---')
    expect(instruction).toContain('DISCUSSION BODY')
    expect(instruction).toContain('--- discussion ends ---')
  })
})

describe('measuring the card', () => {
  it('compacts at 80% of the window the model actually has', () => {
    recordModelWindow('a/model', 100_000)

    expect(cardCompactionThreshold('a/model')).toBe(80_000)
  })

  it('counts the board guidance and the framing, not only the instruction', () => {
    const instruction = 'x'.repeat(4_000)

    const alone = cardContextTokens(instruction, '', 'a/model')
    const withGuidance = cardContextTokens(instruction, 'y'.repeat(4_000), 'a/model')

    expect(alone).toBeGreaterThan(1_000)
    expect(withGuidance).toBeGreaterThan(alone + 900)
  })

  it('believes what the provider charged over what Eido guessed', () => {
    const instruction = 'x'.repeat(40_000)
    const guessed = cardContextTokens(instruction, '', 'a/model')

    recordTokenCalibration('a/model', 10_000, 15_000)

    expect(cardContextTokens(instruction, '', 'a/model')).toBeGreaterThan(guessed * 1.4)
  })
})

describe('tokenCalibration', () => {
  it('leaves an estimate alone until the provider has said something', () => {
    expect(calibratedTokens('a/model', 5_000)).toBe(5_000)
  })

  it('ignores a sample too small to say anything about a long request', () => {
    recordTokenCalibration('a/model', 400, 800)

    expect(calibratedTokens('a/model', 5_000)).toBe(5_000)
  })

  it('ignores a ratio no tokenizer difference could explain', () => {
    recordTokenCalibration('a/model', 10_000, 100)
    expect(calibratedTokens('a/model', 5_000)).toBe(5_000)

    recordTokenCalibration('a/model', 10_000, 900_000)
    expect(calibratedTokens('a/model', 5_000)).toBe(5_000)
  })

  it('follows the freshest sample rather than averaging away a change', () => {
    recordTokenCalibration('a/model', 10_000, 12_000)
    expect(calibratedTokens('a/model', 10_000)).toBe(12_000)

    recordTokenCalibration('a/model', 10_000, 8_000)
    expect(calibratedTokens('a/model', 10_000)).toBe(8_000)
  })

  it("keeps one model's error away from another's", () => {
    recordTokenCalibration('a/model', 10_000, 13_000)

    expect(calibratedTokens('b/model', 10_000)).toBe(10_000)
  })
})
