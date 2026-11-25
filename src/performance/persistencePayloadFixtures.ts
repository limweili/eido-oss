import type { IdeaStore } from '../graph/storageMerge'
import type { Card, IdeaSummary, SavedBoard } from '../graph/types'

const FIXTURE_TIME = '2026-07-07T00:00:00.000Z'
const IMAGE_DATA_URL_PREFIX = 'data:image/png;base64,'
const INTENT_LOG_KEY = 'intentLog' satisfies keyof SavedBoard

export function makeDataUrlWithStoredLength(length: number): string {
  if (length < IMAGE_DATA_URL_PREFIX.length) {
    throw new Error(`Synthetic image payload length must be at least ${IMAGE_DATA_URL_PREFIX.length}`)
  }
  return IMAGE_DATA_URL_PREFIX.padEnd(length, 'a')
}

export function makeImagePayloadBoard(boardId: string, payloadBytes: number[]): SavedBoard {
  const cards: Card[] = payloadBytes.map((bytes, index) => {
    const cardId = `${boardId}-card-${index}`
    return {
      id: cardId,
      kind: 'note',
      blocks: [{ id: `${cardId}-block`, text: `Synthetic image payload ${index}` }],
      position: { x: index * 240, y: 0 },
      assets: [
        {
          id: `${boardId}-asset-${index}`,
          kind: 'image',
          name: `synthetic-image-${index}.png`,
          mimeType: 'image/png',
          dataUrl: makeDataUrlWithStoredLength(bytes),
          size: bytes,
          createdAt: FIXTURE_TIME,
        },
      ],
    }
  })

  return {
    version: 1,
    cards,
    connections: [],
    outputs: [],
    runs: [],
    highlights: [],
    highlightTags: [],
    [INTENT_LOG_KEY]: [],
    compactionSummaries: [],
    updatedAt: FIXTURE_TIME,
  }
}

export function makeImagePayloadSave(
  boardFixtures: Array<{ id: string; payloadBytes: number[] }>,
): IdeaStore {
  const ideas: IdeaSummary[] = boardFixtures.map(({ id }) => ({
    id,
    name: `Synthetic ${id}`,
    createdAt: FIXTURE_TIME,
    updatedAt: FIXTURE_TIME,
    lastOpenedAt: FIXTURE_TIME,
  }))
  const boards = Object.fromEntries(
    boardFixtures.map(({ id, payloadBytes }) => [id, makeImagePayloadBoard(id, payloadBytes)]),
  )

  return {
    version: 1,
    ideas,
    boards,
    activeIdeaId: ideas[0]?.id ?? null,
  }
}
