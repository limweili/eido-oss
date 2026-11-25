import { makeSavedBoard } from './save'
import { createSeedMod } from '../mods/seeds'
import type {
  Card,
  CardAsset,
  Connection,
  FollowUpMessage,
  IntentLogEvent,
  Output,
  OutputVersion,
  RunRecord,
  SavedBoard,
  TranscriptMessage,
} from './types'

export type PerfBoardSize = {
  cards: number
  connections: number
  outputVersions: number
  timelineEvents: number
}

export const PERF_BOARD_SIZES = {
  smoke: { cards: 100, connections: 200, outputVersions: 20, timelineEvents: 500 },
  medium: { cards: 1000, connections: 2000, outputVersions: 200, timelineEvents: 5000 },
  large: { cards: 5000, connections: 10000, outputVersions: 1000, timelineEvents: 50000 },
  rich: { cards: 160, connections: 180, outputVersions: 40, timelineEvents: 500 },
} as const satisfies Record<string, PerfBoardSize>

export type PerfBoardName = keyof typeof PERF_BOARD_SIZES
export type PerfFixtureName =
  | PerfBoardName
  | 'declutter'
  | 'labelDense'
  | 'richCardBenchmark'
  | 'longResultMotionControl'
  | 'longResultMotionStress'
  | 'founderLongNotes'

export const FOUNDER_LONG_NOTE_FIXTURE = {
  id: 'founder-long-notes-v1',
  name: 'founderLongNotes',
  cardCount: 30,
  aggregateTextWeightFloor: 300_000,
  readingViewport: {
    width: 1_440,
    height: 1_000,
    zoom: 0.5,
    boardCenter: { x: 750, y: 750 },
  },
} as const

export const LONG_RESULT_MOTION_FIXTURE = {
  controlName: 'longResultMotionControl',
  stressName: 'longResultMotionStress',
  cardCount: 8,
  resultCardId: 'benchmark-long-result',
  chosenVersionId: 'benchmark-result-version-4',
  conversationCardId: 'benchmark-long-conversation',
  conversationVersionId: 'benchmark-conversation-version-1',
  noteCardId: 'benchmark-giant-note',
  controlTextChars: 4_000,
  stressTextChars: 1_000_000,
  noteStressTextChars: 1_000_000,
  followUpCount: 100,
  transcriptCount: 160,
  sentinels: {
    note: {
      start: 'EIDO-LONG-NOTE-START-V1',
      middle: 'EIDO-LONG-NOTE-MIDDLE-V1',
      end: 'EIDO-LONG-NOTE-END-V1',
    },
    result: {
      start: 'EIDO-LONG-RESULT-START-V1',
      middle: 'EIDO-LONG-RESULT-MIDDLE-V1',
      end: 'EIDO-LONG-RESULT-END-V1',
    },
    conversation: {
      start: 'EIDO-LONG-CONVERSATION-START-V1',
      middle: 'EIDO-LONG-CONVERSATION-MIDDLE-V1',
      end: 'EIDO-LONG-CONVERSATION-END-V1',
    },
    followUp: {
      start: 'EIDO-LONG-FOLLOWUP-START-V1',
      middle: 'EIDO-LONG-FOLLOWUP-MIDDLE-V1',
      end: 'EIDO-LONG-FOLLOWUP-END-V1',
    },
  },
} as const

export type RichCardBenchmarkOptions = {
  ordinaryCardCount?: number
}

const BASE_TIME_MS = Date.parse('2026-06-20T00:00:00.000Z')

export function createPerfBoard(fixtureName: PerfFixtureName = 'smoke'): SavedBoard {
  if (fixtureName === 'declutter') return createDeclutterBoard()
  if (fixtureName === 'labelDense') return createLabelDenseBoard()
  if (fixtureName === 'richCardBenchmark') return createRichCardBenchmarkBoard()
  if (fixtureName === LONG_RESULT_MOTION_FIXTURE.controlName) return createLongResultMotionBoard(false)
  if (fixtureName === LONG_RESULT_MOTION_FIXTURE.stressName) return createLongResultMotionBoard(true)
  if (fixtureName === FOUNDER_LONG_NOTE_FIXTURE.name) return createFounderLongNotesBoard()

  const size = PERF_BOARD_SIZES[fixtureName]
  const cards = createCards(size.cards)
  const connections = createConnections(cards, size.connections)
  const intentLog = createIntentLog(cards, connections, size.timelineEvents)
  const outputs = createOutputs(cards, size.outputVersions)
  if (fixtureName === 'rich') applyRichContent(cards, outputs)
  const runs = createRuns(outputs)

  return makeFixtureBoard({
    cards,
    connections,
    outputs,
    runs,
    events: intentLog,
    updatedAt: timestamp(size.timelineEvents + 1),
  })
}

/**
 * Privacy-safe reproduction of the founder's dense Reading-zoom Board: thirty
 * natural-height Notes whose combined text weight crosses the retired global
 * 300k ceiling. No Card has a stored size, so this fixture exercises the
 * auto-sized Note path rather than the fixed-height long-body cases in the
 * historical rich Card benchmark.
 */
export function createFounderLongNotesBoard(): SavedBoard {
  const textTargets = [1_201, 1_600, 12_000, 16_000, 20_000, 24_000] as const
  const cards: Card[] = Array.from({ length: FOUNDER_LONG_NOTE_FIXTURE.cardCount }, (_, index) => {
    const id = `founder-long-note-${pad(index)}`
    return {
      id,
      kind: 'note',
      title: `Synthetic long Note ${index + 1}`,
      blocks: [
        {
          id: `${id}-block-1`,
          text: longMarkdown(`Synthetic founder Note ${index + 1}`, textTargets[index % textTargets.length]),
        },
      ],
      position: {
        x: (index % 6) * 300,
        y: Math.floor(index / 6) * 330,
      },
      headerColor: headerColorAt(index),
    }
  })

  return makeFixtureBoard({
    cards,
    connections: [],
    outputs: [],
    runs: [],
    events: [],
    updatedAt: new Date(BASE_TIME_MS).toISOString(),
  })
}

/**
 * Candidate-neutral fixture for #402 and every renderer experiment that follows it.
 * The chosen output texts plus eight image weights deliberately stay below the
 * current board-wide Reading occupancy ceiling. That makes the baseline exercise
 * today's whole-board Reading shortcut without changing any renderer policy.
 */
export function createRichCardBenchmarkBoard({
  ordinaryCardCount = 123,
}: RichCardBenchmarkOptions = {}): SavedBoard {
  const ordinaryCards = createCards(ordinaryCardCount).map((card, index) => ({
    ...card,
    id: `benchmark-ordinary-${pad(index)}`,
    blocks: [{ id: `benchmark-ordinary-${pad(index)}-block-1`, text: `Synthetic surrounding Card ${index}` }],
    position: {
      x: 2_000 + (index % 16) * 310,
      y: Math.floor(index / 16) * 230,
    },
    size: card.kind === 'group' ? { width: 520, height: 360 } : { width: 260, height: 180 },
  }))

  const specialCards = richBenchmarkSpecialCards()
  const cards = [...specialCards, ...ordinaryCards]
  const connections = createRichBenchmarkConnections(cards, ordinaryCardCount)
  const outputs = createRichBenchmarkOutputs()
  const runs = createRuns(outputs).map((run) =>
    run.producedVersionId === 'benchmark-conversation-version-1'
      ? {
          ...run,
          askAiCardId: 'benchmark-conversation-source',
          kind: 'conversation' as const,
        }
      : run,
  )

  return makeFixtureBoard({
    cards,
    connections,
    outputs,
    runs,
    events: [],
    updatedAt: new Date(BASE_TIME_MS).toISOString(),
  })
}

/**
 * Privacy-safe paired reproduction for one Result Card. The control and stress
 * arms have identical identity, geometry, versions, and follow-up message IDs;
 * only the chosen answer and follow-up text volume changes.
 */
export function createLongResultMotionBoard(stress = true): SavedBoard {
  const board = createRichCardBenchmarkBoard({ ordinaryCardCount: 0 })
  const note = board.cards.find((candidate) => candidate.id === LONG_RESULT_MOTION_FIXTURE.noteCardId)
  const output = board.outputs.find((candidate) => candidate.resultCardId === LONG_RESULT_MOTION_FIXTURE.resultCardId)
  const version = output?.versions.find((candidate) => candidate.id === LONG_RESULT_MOTION_FIXTURE.chosenVersionId)
  const conversationOutput = board.outputs.find(
    (candidate) => candidate.resultCardId === LONG_RESULT_MOTION_FIXTURE.conversationCardId,
  )
  const conversationVersion = conversationOutput?.versions.find(
    (candidate) => candidate.id === LONG_RESULT_MOTION_FIXTURE.conversationVersionId,
  )
  if (!note || !output || !version || !conversationOutput || !conversationVersion) {
    throw new Error('Long Result motion fixture is missing a chosen version')
  }
  note.blocks = [{
    id: `${note.id}-block-1`,
    text: longMotionMarkdown(
      stress ? 'Long Note motion stress' : 'Long Note motion control',
      stress ? LONG_RESULT_MOTION_FIXTURE.noteStressTextChars : LONG_RESULT_MOTION_FIXTURE.controlTextChars,
      LONG_RESULT_MOTION_FIXTURE.sentinels.note,
    ),
  }]
  output.chosenVersionId = version.id
  version.text = longMotionMarkdown(
    stress ? 'Long Result motion stress' : 'Long Result motion control',
    stress ? LONG_RESULT_MOTION_FIXTURE.stressTextChars : LONG_RESULT_MOTION_FIXTURE.controlTextChars,
    LONG_RESULT_MOTION_FIXTURE.sentinels.result,
  )
  version.followUpThread = {
    messages: Array.from({ length: LONG_RESULT_MOTION_FIXTURE.followUpCount }, (_, index) => ({
      id: `long-result-motion-follow-up-${index + 1}`,
      role: index % 2 === 0 ? 'user' : 'assistant',
      text: stress
        ? `${followUpSentinel(index)}${index % 2 === 0 ? 'Question' : 'Answer'} ${index + 1}. ${
            Array.from(
              { length: 12 },
              () => 'This deterministic fictional exchange retains substantial follow-up context without using private data.',
            ).join(' ')
          }`
        : `${followUpSentinel(index)}${index % 2 === 0 ? 'Question' : 'Answer'} ${index + 1}. Brief fictional control exchange.`,
      createdAt: timestamp(800 + index),
      status: 'complete',
    })),
  }
  conversationOutput.chosenVersionId = conversationVersion.id
  conversationVersion.transcript = Array.from(
    { length: LONG_RESULT_MOTION_FIXTURE.transcriptCount },
    (_, index) => ({
      id: `long-result-motion-transcript-${index + 1}`,
      speakerKind: index % 5 === 4 ? 'user' : 'participant',
      speakerName: index % 5 === 4 ? 'Synthetic facilitator' : `Synthetic participant ${(index % 4) + 1}`,
      ...(index % 5 === 4 ? {} : { participantCardId: 'benchmark-connection-anchor' }),
      text: `${conversationSentinel(index)}${stress
        ? `Transcript message ${index + 1}. ${
            Array.from(
              { length: 12 },
              () => 'This privacy-safe fictional exchange retains substantial conversation context during board motion.',
            ).join(' ')
          }`
        : `Transcript message ${index + 1}. Brief fictional control exchange.`}`,
      turnNumber: Math.floor(index / 4) + 1,
    }),
  )

  return board
}

function richBenchmarkSpecialCards(): Card[] {
  return [
    {
      id: 'benchmark-giant-note',
      kind: 'note',
      title: 'Giant synthetic research note',
      blocks: [{ id: 'benchmark-giant-note-block-1', text: longMarkdown('Giant benchmark note', 61_000) }],
      position: { x: 0, y: 0 },
      size: { width: 760, height: 900 },
      headerColor: '#f6d365',
    },
    {
      id: 'benchmark-long-result',
      kind: 'result',
      title: 'Long synthetic result',
      blocks: [{ id: 'benchmark-long-result-block-1', text: 'A generated result with four retained versions.' }],
      position: { x: 850, y: 0 },
      size: { width: 760, height: 900 },
      headerColor: '#96e6a1',
    },
    {
      id: 'benchmark-long-conversation',
      kind: 'result',
      title: 'Long synthetic conversation result',
      blocks: [{ id: 'benchmark-long-conversation-block-1', text: 'A deterministic transcript result for a fictional planning problem.' }],
      position: { x: 0, y: 1_020 },
      size: { width: 760, height: 900 },
      headerColor: '#8fd3f4',
    },
    imageBenchmarkCard('benchmark-images-alpha', 'Alpha image references', { x: 850, y: 1_020 }, [
      imageAsset('alpha-square', 1024, 1024, true, 0),
      imageAsset('alpha-wide', 1920, 1080, true, 1),
      imageAsset('alpha-small', 320, 240, true, 2),
      imageAsset('png-reference', 1, 1, true, 8),
    ]),
    imageBenchmarkCard('benchmark-images-opaque', 'Opaque image references', { x: 0, y: 2_040 }, [
      imageAsset('opaque-portrait', 1080, 1920, false, 3),
      imageAsset('opaque-wide', 2560, 1080, false, 4),
      imageAsset('opaque-medium', 800, 600, false, 5),
    ]),
    imageBenchmarkCard('benchmark-images-mixed', 'Mixed-size image references', { x: 850, y: 2_040 }, [
      imageAsset('mixed-large', 2048, 2048, false, 6),
      imageAsset('mixed-thumbnail', 240, 180, true, 7),
    ]),
    {
      id: 'benchmark-conversation-source',
      kind: 'conversation',
      title: 'Synthetic conversation source',
      blocks: [{ id: 'benchmark-conversation-source-block-1', text: 'A deterministic discussion about a fictional planning problem.' }],
      position: { x: 1_700, y: 1_020 },
      size: { width: 360, height: 300 },
      conversationStyle: 'collaborate',
      conversationTurns: 20,
      headerColor: '#8fd3f4',
    },
    {
      id: 'benchmark-connection-anchor',
      kind: 'askAi',
      title: 'Synthetic connection anchor',
      blocks: [{ id: 'benchmark-connection-anchor-block-1', text: 'Connect the surrounding evidence without using private data.' }],
      position: { x: 1_700, y: 1_420 },
      size: { width: 360, height: 240 },
      model: 'synthetic-model',
      headerColor: '#cfd9df',
    },
  ]
}

function imageBenchmarkCard(
  id: string,
  title: string,
  position: Card['position'],
  assets: CardAsset[],
): Card {
  return {
    id,
    kind: 'note',
    title,
    blocks: [{ id: `${id}-block-1`, text: 'Synthetic image references with varied dimensions, alpha, and visible card size.' }],
    assets,
    position,
    size: id.endsWith('mixed') ? { width: 420, height: 520 } : { width: 760, height: 900 },
    headerColor: '#fbc2eb',
  }
}

const TRANSPARENT_PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M/wHwAF/gL+X8WvGQAAAABJRU5ErkJggg=='
function imageAsset(id: string, width: number, height: number, alpha: boolean, index: number): CardAsset {
  const png = index === 8
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${alpha ? '#4b8fdb' : '#d97732'}"${alpha ? ' fill-opacity="0.42"' : ''}/><circle cx="50%" cy="50%" r="24%" fill="${alpha ? '#f7d36b' : '#254b65'}"${alpha ? ' fill-opacity="0.68"' : ''}/></svg>`
  const dataUrl = png ? TRANSPARENT_PNG_DATA_URL : `data:image/svg+xml,${encodeURIComponent(svg)}`
  return {
    id: `benchmark-image-${id}`,
    kind: 'image',
    name: `synthetic-${id}.${png ? 'png' : 'svg'}`,
    mimeType: png ? 'image/png' : 'image/svg+xml',
    dataUrl,
    size: Math.floor((dataUrl.length * 3) / 4),
    createdAt: timestamp(400 + index),
    width,
    height,
    originalSize: Math.max(1, Math.round(width * height * (alpha ? 0.22 : 0.14))),
    originalMimeType: png ? 'image/png' : 'image/svg+xml',
    ...(png ? { compression: 'compressed' as const } : {}),
  }
}

function createRichBenchmarkConnections(cards: Card[], ordinaryCardCount: number): Connection[] {
  const anchor = cards.find((card) => card.id === 'benchmark-connection-anchor')!
  const conversationSource = cards.find((card) => card.id === 'benchmark-conversation-source')!
  const conversationResult = cards.find((card) => card.id === 'benchmark-long-conversation')!
  return Array.from({ length: Math.max(ordinaryCardCount + 9, 32) }, (_, index) => {
    if (index === 0) {
      return {
        id: `benchmark-connection-${pad(index)}`,
        from: { cardId: conversationSource.id },
        to: { cardId: conversationResult.id },
        strength: 'strong',
        polarity: 'helps',
        role: 'feeds',
        meta: { contextOrder: index },
      }
    }
    const from = cards[index % (cards.length - 1)]
    const to = index % 3 === 0 ? anchor : cards[(index * 5 + 7) % cards.length]
    const safeTo = to.id === from.id ? anchor : to
    return {
      id: `benchmark-connection-${pad(index)}`,
      from: { cardId: from.id },
      to: { cardId: safeTo.id },
      strength: index % 4 === 0 ? 'weak' : 'strong',
      polarity: index % 7 === 0 ? 'pushesAgainst' : 'helps',
      role: index % 9 === 0 ? 'modifies' : 'feeds',
      meta: { contextOrder: index },
    }
  })
}

function createRichBenchmarkOutputs(): Output[] {
  const resultVersions: OutputVersion[] = Array.from({ length: 4 }, (_, index) => ({
    id: `benchmark-result-version-${index + 1}`,
    number: index + 1,
    text: longMarkdown(`Result version ${index + 1}`, 34_000 + index * 250),
    createdAt: timestamp(500 + index),
    fromRunId: `benchmark-result-run-${index + 1}`,
    accepted: index === 3,
    followUpThread: { messages: richBenchmarkFollowUps(index) },
  }))
  const conversationVersion: OutputVersion = {
    id: 'benchmark-conversation-version-1',
    number: 1,
    text: longMarkdown('Conversation synthesis', 9_000),
    createdAt: timestamp(520),
    fromRunId: 'benchmark-conversation-run-1',
    accepted: true,
    transcript: richBenchmarkTranscript(),
  }

  return [
    {
      id: 'benchmark-result-output',
      resultCardId: 'benchmark-long-result',
      versions: resultVersions,
      chosenVersionId: resultVersions[3].id,
    },
    {
      id: 'benchmark-conversation-output',
      resultCardId: 'benchmark-long-conversation',
      versions: [conversationVersion],
      chosenVersionId: conversationVersion.id,
    },
  ]
}

function richBenchmarkFollowUps(versionIndex: number): FollowUpMessage[] {
  return Array.from({ length: 16 }, (_, index) => ({
    id: `benchmark-follow-up-${versionIndex + 1}-${index + 1}`,
    role: index % 2 === 0 ? 'user' : 'assistant',
    text: `${index % 2 === 0 ? 'Question' : 'Answer'} ${index + 1} for synthetic version ${versionIndex + 1}. ${
      'This deterministic follow-up carries substantial but fictional context. '.repeat(5)
    }`,
    createdAt: timestamp(600 + versionIndex * 20 + index),
    status: 'complete',
  }))
}

function richBenchmarkTranscript(): TranscriptMessage[] {
  return Array.from({ length: 104 }, (_, index) => ({
    id: `benchmark-transcript-${pad(index + 1)}`,
    speakerKind: index % 5 === 4 ? 'user' : 'participant',
    speakerName: index % 5 === 4 ? 'Synthetic facilitator' : `Synthetic participant ${(index % 4) + 1}`,
    ...(index % 5 === 4 ? {} : { participantCardId: 'benchmark-connection-anchor' }),
    text: `Transcript message ${index + 1}. ${
      'This privacy-safe fictional exchange exercises a long navigable conversation body. '.repeat(3)
    }`,
    turnNumber: Math.floor(index / 4) + 1,
  }))
}

function createDeclutterBoard(): SavedBoard {
  const cards = createCards(300)
  const sizes = [
    { width: 150, height: 96 },
    { width: 220, height: 132 },
    { width: 310, height: 184 },
    { width: 420, height: 248 },
  ]

  cards.forEach((card, index) => {
    card.position = {
      x: (index % 20) * 165,
      y: Math.floor(index / 20) * 125,
    }
    card.size = sizes[index % sizes.length]
    if (index % 4 === 0) {
      delete card.title
    } else if (index % 4 === 1) {
      card.title = `Card ${index}`
    } else if (index % 4 === 2) {
      card.title = `Evidence cluster ${index} with a medium-length user-authored name`
    } else {
      card.title = `Long-form landmark ${index}: ${'a deliberately wide title for collision and cache pressure '.repeat(2)}`
    }
  })

  return makeFixtureBoard({
    cards,
    connections: [],
    outputs: [],
    runs: [],
    events: [],
    updatedAt: timestamp(cards.length + 1),
  })
}

function createLabelDenseBoard(): SavedBoard {
  const cards = createCards(1_500)

  cards.forEach((card, index) => {
    card.position = {
      x: (index % 50) * 72,
      y: Math.floor(index / 50) * 44,
    }
    card.size = { width: 180, height: 104 }
    card.title = `User label ${index}: dense board landmark`
  })

  return makeFixtureBoard({
    cards,
    connections: [],
    outputs: [],
    runs: [],
    events: [],
    updatedAt: timestamp(cards.length + 1),
  })
}

type PerfBoardParts = {
  cards: Card[]
  connections: Connection[]
  outputs: Output[]
  runs: RunRecord[]
  events: IntentLogEvent[]
  updatedAt: string
}

function makeFixtureBoard({ cards, connections, outputs, runs, events, updatedAt }: PerfBoardParts): SavedBoard {
  const intentLog = events
  return makeSavedBoard({
    cards,
    connections,
    outputs,
    runs,
    intentLog,
    updatedAt,
  })
}

function createCards(count: number): Card[] {
  return Array.from({ length: count }, (_, index) => {
    const kind = cardKindAt(index)
    const id = `${kind}-${pad(index)}`
    const position = {
      x: (index % 100) * 260,
      y: Math.floor(index / 100) * 190,
    }
    const common = {
      id,
      kind,
      blocks: [{ id: `${id}-block-1`, text: `Synthetic ${kind} ${index}` }],
      position,
      headerColor: headerColorAt(index),
    } satisfies Card

    switch (kind) {
      case 'askAi':
        return { ...common, title: `Ask ${index}`, model: 'synthetic-model' }
      case 'conversation':
        return {
          ...common,
          title: `Conversation ${index}`,
          conversationStyle: 'collaborate',
          conversationTurns: 2,
        }
      case 'group':
        return {
          ...common,
          title: `Group ${index}`,
          size: { width: 520, height: 360 },
          compressionPrompt: 'Summarize the grouped evidence.',
        }
      case 'mod':
        return {
          ...common,
          modV2: createSeedMod('slider', {
            title: `Mod ${index}`,
            accent: headerColorAt(index),
            createId: (role, ordinal) => `${id}-${role}-${ordinal}`,
          }),
        }
      case 'result':
        return { ...common, title: `Result ${index}` }
      case 'title':
        return { ...common, title: `Section ${index}` }
      case 'note':
        return common
    }
  })
}

function createConnections(cards: Card[], count: number): Connection[] {
  const connectableCards = cards.filter((card) => card.kind !== 'title')
  if (connectableCards.length < 2) return []

  return Array.from({ length: count }, (_, index) => {
    const fromIndex = index % connectableCards.length
    let toIndex = (index * 7 + 13) % connectableCards.length
    if (toIndex === fromIndex) toIndex = (toIndex + 1) % connectableCards.length

    return {
      id: `conn-${pad(index)}`,
      from: { cardId: connectableCards[fromIndex].id },
      to: { cardId: connectableCards[toIndex].id },
      strength: index % 3 === 0 ? 'weak' : 'strong',
      polarity: index % 4 === 0 ? 'pushesAgainst' : 'helps',
      role: index % 11 === 0 ? 'modifies' : 'feeds',
      meta: { contextOrder: index },
    }
  })
}

function createIntentLog(cards: Card[], connections: Connection[], targetCount: number): IntentLogEvent[] {
  const events: IntentLogEvent[] = []
  const initialCards = cards.map(clone)
  const initialConnections = connections.map(clone)

  for (const card of initialCards) {
    if (events.length >= targetCount) return events
    events.push({
      id: `evt-${pad(events.length)}`,
      at: timestamp(events.length),
      type: 'card.created',
      cardId: card.id,
      data: { card },
    })
  }

  for (const connection of initialConnections) {
    if (events.length >= targetCount) return events
    events.push({
      id: `evt-${pad(events.length)}`,
      at: timestamp(events.length),
      type: 'connection.created',
      connectionId: connection.id,
      data: { connection },
    })
  }

  while (events.length < targetCount) {
    const eventIndex = events.length
    if (eventIndex % 10 === 0) {
      events.push(createMoveEvent(cards, eventIndex))
    } else if (eventIndex % 10 === 1 && connections.length > 0) {
      events.push(createConnectionChangeEvent(connections, eventIndex))
    } else if (eventIndex % 10 === 2) {
      events.push(createResizeEvent(cards, eventIndex))
    } else {
      events.push(createMoveEvent(cards, eventIndex))
    }
  }

  return events
}

function createMoveEvent(cards: Card[], eventIndex: number): IntentLogEvent {
  const card = cards[(eventIndex * 17 + 5) % cards.length]
  const from = { ...card.position }
  const to = {
    x: from.x + ((eventIndex % 9) - 4) * 16,
    y: from.y + ((eventIndex % 7) - 3) * 12,
  }
  card.position = to

  return {
    id: `evt-${pad(eventIndex)}`,
    at: timestamp(eventIndex),
    type: 'card.moved',
    cardId: card.id,
    data: {
      moves: [
        {
          cardId: card.id,
          from,
          to,
          previousGroupId: card.groupId,
          nextGroupId: card.groupId,
        },
      ],
    },
  }
}

function createResizeEvent(cards: Card[], eventIndex: number): IntentLogEvent {
  const card = cards[(eventIndex * 13 + 3) % cards.length]
  const from = card.size ? { ...card.size } : undefined
  const to = {
    width: (from?.width ?? 220) + (eventIndex % 5) * 8,
    height: (from?.height ?? 150) + (eventIndex % 3) * 8,
  }
  card.size = to

  return {
    id: `evt-${pad(eventIndex)}`,
    at: timestamp(eventIndex),
    type: 'card.resized',
    cardId: card.id,
    data: { from, to },
  }
}

function createConnectionChangeEvent(connections: Connection[], eventIndex: number): IntentLogEvent {
  const connection = connections[(eventIndex * 23 + 7) % connections.length]
  const before = clone(connection)
  connection.strength = connection.strength === 'strong' ? 'weak' : 'strong'
  connection.polarity = connection.polarity === 'helps' ? 'pushesAgainst' : 'helps'
  const after = clone(connection)

  return {
    id: `evt-${pad(eventIndex)}`,
    at: timestamp(eventIndex),
    type: 'connection.changed',
    connectionId: connection.id,
    data: { before, after },
  }
}

function createOutputs(cards: Card[], versionCount: number): Output[] {
  const resultCards = cards.filter((card) => card.kind === 'result' || card.kind === 'conversation' || card.kind === 'group')
  const outputsByCard = new Map<string, Output>()

  for (let index = 0; index < versionCount && resultCards.length > 0; index += 1) {
    const card = resultCards[index % resultCards.length]
    const output =
      outputsByCard.get(card.id) ??
      ({
        id: `output-${pad(outputsByCard.size)}`,
        resultCardId: card.id,
        versions: [],
      } satisfies Output)

    output.versions.push({
      id: `version-${pad(index)}`,
      number: output.versions.length + 1,
      text: `Synthetic generated output ${index}. This body gives renderer and persistence paths realistic text volume.`,
      createdAt: timestamp(index + 10),
      fromRunId: `run-${pad(index)}`,
      accepted: index % 3 === 0,
    })
    outputsByCard.set(card.id, output)
  }

  return [...outputsByCard.values()]
}

function applyRichContent(cards: Card[], outputs: Output[]) {
  const longNoteText = longMarkdown('Long note', 53_000)
  const mediumNoteText = longMarkdown('Medium note', 12_000)
  const longResultText = longMarkdown('Long result', 50_000)

  let richNotes = 0
  for (const card of cards) {
    if (card.kind !== 'note') continue
    if (richNotes === 0) {
      card.blocks = [{ id: `${card.id}-block-1`, text: longNoteText }]
      card.size = { width: 795, height: 1228 }
    } else if (richNotes < 8) {
      card.blocks = [{ id: `${card.id}-block-1`, text: mediumNoteText }]
      card.size = { width: 520, height: 420 }
    }
    richNotes += 1
  }

  outputs.slice(0, 12).forEach((output, index) => {
    output.versions.forEach((version) => {
      version.text = index < 4 ? longResultText : mediumNoteText
    })
  })
}

function longMarkdown(label: string, targetChars: number): string {
  const paragraph = [
    `## ${label}`,
    '',
    'This synthetic content mirrors a real Eido card with a large amount of generated prose.',
    '',
    '- It has headings, bullets, emphasis, and enough plain text to exercise markdown rendering.',
    '- The content is deterministic so performance reports remain comparable.',
    '',
    'The point is not the prose itself; the point is making passive canvas navigation carry the same text volume as a real saved board.',
    '',
  ].join('\n')
  const separatedParagraph = `${paragraph}\n`
  // Build the exact target without slicing a completed semantic fixture. The
  // remainder is generated from the deterministic paragraph source, so the
  // saved block remains the full authority that the browser must render.
  const completeParagraphs = Math.floor(targetChars / separatedParagraph.length)
  const remainder = targetChars % separatedParagraph.length
  const remainderText = Array.from(
    { length: remainder },
    (_, index) => separatedParagraph[index % separatedParagraph.length],
  ).join('')
  return `${separatedParagraph.repeat(completeParagraphs)}${remainderText}`
}

function longMotionMarkdown(
  label: string,
  targetChars: number,
  sentinels: { start: string; middle: string; end: string },
): string {
  // Plain prose separated by blank lines is intentionally boring Markdown:
  // each source paragraph becomes one rendered semantic child without making
  // this fixture depend on the production renderer's implementation. The
  // paragraph array is the controlled structure used by the performance
  // oracle, while this function remains the one source of truth for its exact
  // character budget and sentinels.
  const separator = '\n\n'
  const paragraphTarget = 240
  const paragraphSeed = `${label}. Synthetic deterministic prose keeps the retained Card content stable while canvas gestures move around it.`
  const paragraphCount = Math.max(
    3,
    Math.floor((targetChars + separator.length) / (paragraphTarget + separator.length)),
  )
  const contentChars = targetChars - separator.length * (paragraphCount - 1)
  const baseParagraphChars = Math.floor(contentChars / paragraphCount)
  const remainderParagraphs = contentChars % paragraphCount
  const middleIndex = Math.floor(paragraphCount / 2)

  const makeParagraph = (
    index: number,
    marker: string | undefined,
    length: number,
  ) => {
    const prefix = marker ? `${marker} ${label} paragraph ${index + 1}. ` : `${label} paragraph ${index + 1}. `
    if (prefix.length + 1 > length) throw new Error(`Motion fixture paragraph is too short for ${label}`)
    // Markdown trims terminal whitespace. Reserve a visible final character
    // so the browser's paragraph text is exactly the fixture-owned source.
    return `${prefix}${repeatExact(paragraphSeed, length - prefix.length - 1)}.`
  }

  const paragraphs = Array.from({ length: paragraphCount }, (_, index) => {
    const length = baseParagraphChars + (index < remainderParagraphs ? 1 : 0)
    const marker = index === 0
      ? sentinels.start
      : index === middleIndex
        ? sentinels.middle
        : index === paragraphCount - 1
          ? sentinels.end
          : undefined
    return makeParagraph(index, marker, length)
  })
  return paragraphs.join(separator)
}

function repeatExact(source: string, targetChars: number): string {
  const complete = Math.floor(targetChars / source.length)
  const remainder = targetChars % source.length
  const tail = Array.from(
    { length: remainder },
    (_, index) => source[index % source.length],
  ).join('')
  return `${source.repeat(complete)}${tail}`
}

function followUpSentinel(index: number): string {
  if (index === 0) return `${LONG_RESULT_MOTION_FIXTURE.sentinels.followUp.start} `
  if (index === Math.floor(LONG_RESULT_MOTION_FIXTURE.followUpCount / 2)) {
    return `${LONG_RESULT_MOTION_FIXTURE.sentinels.followUp.middle} `
  }
  if (index === LONG_RESULT_MOTION_FIXTURE.followUpCount - 1) {
    return `${LONG_RESULT_MOTION_FIXTURE.sentinels.followUp.end} `
  }
  return ''
}

function conversationSentinel(index: number): string {
  if (index === 0) return `${LONG_RESULT_MOTION_FIXTURE.sentinels.conversation.start} `
  if (index === Math.floor(LONG_RESULT_MOTION_FIXTURE.transcriptCount / 2)) {
    return `${LONG_RESULT_MOTION_FIXTURE.sentinels.conversation.middle} `
  }
  if (index === LONG_RESULT_MOTION_FIXTURE.transcriptCount - 1) {
    return `${LONG_RESULT_MOTION_FIXTURE.sentinels.conversation.end} `
  }
  return ''
}

function createRuns(outputs: Output[]): RunRecord[] {
  return outputs.flatMap((output) =>
    output.versions.map(
      (version) =>
        ({
          id: version.fromRunId,
          startedAt: version.createdAt,
          finishedAt: timestamp(Math.round((Date.parse(version.createdAt) - BASE_TIME_MS) / 1000) + 2),
          askAiCardId: output.resultCardId,
          model: 'synthetic-model',
          usedCardIds: [output.resultCardId],
          usedConnectionIds: [],
          modIds: [],
          appliedMods: [],
          compiledInstruction: 'Synthetic benchmark run.',
          producedVersionId: version.id,
          status: 'done',
          kind: 'ask',
        }) satisfies RunRecord,
    ),
  )
}

function cardKindAt(index: number): Card['kind'] {
  if (index % 41 === 0) return 'group'
  if (index % 37 === 0) return 'conversation'
  if (index % 23 === 0) return 'title'
  if (index % 19 === 0) return 'mod'
  if (index % 17 === 0) return 'askAi'
  if (index % 13 === 0) return 'result'
  return 'note'
}

function headerColorAt(index: number): string {
  const colors = ['#f6d365', '#96e6a1', '#84fab0', '#8fd3f4', '#cfd9df', '#fbc2eb']
  return colors[index % colors.length]
}

function timestamp(offset: number): string {
  return new Date(BASE_TIME_MS + offset * 1000).toISOString()
}

function pad(value: number): string {
  return value.toString().padStart(6, '0')
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}
