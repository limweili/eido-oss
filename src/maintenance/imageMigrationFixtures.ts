// Synthetic, scrubbed fixture saves for the lane E image migration tests
// (#283). Never derived from real user data.

import type { IdeaStore } from '../graph/storageMerge'
import type { Card, CardAsset, SavedBoard } from '../graph/types'

export const FIXTURE_TIMESTAMP = '2026-01-01T00:00:00.000Z'

// A valid base64 data URL whose string length is at least `payloadLength`
// (rounded up so the base64 body stays decodable).
export function base64DataUrl(mimeType: string, payloadLength: number): string {
  const header = `data:${mimeType};base64,`
  const body = Math.max(4, Math.ceil(Math.max(0, payloadLength - header.length) / 4) * 4)
  return header + 'A'.repeat(body)
}

export function imageAsset(
  id: string,
  name: string,
  payloadLength: number,
  mimeType = 'image/png',
): CardAsset {
  const dataUrl = base64DataUrl(mimeType, payloadLength)
  return {
    id,
    kind: 'image',
    name,
    mimeType,
    dataUrl,
    size: Math.floor((dataUrl.length * 3) / 4),
    createdAt: FIXTURE_TIMESTAMP,
  }
}

export function fileAsset(id: string, name: string, payloadLength: number): CardAsset {
  return {
    id,
    kind: 'file',
    name,
    mimeType: 'application/pdf',
    dataUrl: base64DataUrl('application/pdf', payloadLength),
    size: payloadLength,
    createdAt: FIXTURE_TIMESTAMP,
  }
}

export function cardWithAssets(id: string, assets: CardAsset[]): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: 'fixture card' }],
    position: { x: 0, y: 0 },
    assets,
  }
}

export function boardWithCards(cards: Card[]): SavedBoard {
  return {
    version: 1,
    cards,
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: FIXTURE_TIMESTAMP,
  }
}

export function storeWithBoards(boards: Record<string, SavedBoard>): IdeaStore {
  const ideas = Object.keys(boards).map((id) => ({
    id,
    name: `Fixture idea ${id}`,
    createdAt: FIXTURE_TIMESTAMP,
    updatedAt: FIXTURE_TIMESTAMP,
    lastOpenedAt: FIXTURE_TIMESTAMP,
  }))
  return {
    version: 1,
    ideas,
    boards,
    activeIdeaId: ideas[0]?.id ?? null,
  }
}
