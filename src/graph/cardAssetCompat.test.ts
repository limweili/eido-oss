// CardAsset compatibility (#247): old saves carry assets without the optional
// compression metadata, and every consumer (store, duplicate, source-context
// hashing, AI compile) must treat legacy and compressed assets the same.
import { beforeEach, describe, expect, it } from 'vitest'
import type { Card, CardAsset, Connection, SavedBoard } from './types'
import { useGraph } from './store'
import { gatherConnectedThought } from '../brain/compiler'
import { createSourceContextSnapshot } from '../brain/sourceContext'

// Exactly the fields an asset saved before the compression pipeline has.
const legacyAsset: CardAsset = {
  id: 'asset-legacy',
  kind: 'image',
  name: 'old-screenshot.png',
  mimeType: 'image/png',
  dataUrl: 'data:image/png;base64,abc123',
  size: 4_200_000,
  createdAt: '2025-01-01T00:00:00.000Z',
}

const compressedAsset: CardAsset = {
  id: 'asset-compressed',
  kind: 'image',
  name: 'new-reference.png',
  mimeType: 'image/jpeg',
  dataUrl: 'data:image/jpeg;base64,def456',
  size: 48_000,
  createdAt: '2026-07-01T00:00:00.000Z',
  width: 1280,
  height: 960,
  originalSize: 3_800_000,
  originalMimeType: 'image/png',
  compression: 'compressed',
}

function note(id: string, assets: CardAsset[]): Card {
  return {
    id,
    kind: 'note',
    blocks: [{ id: `${id}-block`, text: 'Reference note' }],
    assets,
    position: { x: 0, y: 0 },
  }
}

function board(cards: Card[], connections: Connection[] = []): SavedBoard {
  return { version: 1, cards, connections, outputs: [], runs: [], updatedAt: '' }
}

function feeds(id: string, from: string, to: string): Connection {
  return {
    id,
    from: { cardId: from },
    to: { cardId: to },
    strength: 'strong',
    polarity: 'helps',
    role: 'feeds',
  }
}

beforeEach(() => {
  useGraph.setState({
    cards: [],
    connections: [],
    outputs: [],
    runs: [],
    intentLog: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
    hydrated: false,
    keyPromptOpen: false,
    cardClipboard: null,
  })
})

describe('CardAsset backwards compatibility', () => {
  it('loads a card with legacy assets (no compression metadata) into the store unchanged', () => {
    useGraph.setState({ cards: [note('note-1', [legacyAsset])] })

    const stored = useGraph.getState().cards[0].assets?.[0]
    expect(stored).toEqual(legacyAsset)
    expect(stored?.width).toBeUndefined()
    expect(stored?.compression).toBeUndefined()
  })

  it('appends compressed assets next to legacy assets through addCardAssets', () => {
    useGraph.setState({ cards: [note('note-1', [legacyAsset])] })

    useGraph.getState().addCardAssets('note-1', [compressedAsset])

    const assets = useGraph.getState().cards[0].assets ?? []
    expect(assets.map((asset) => asset.id)).toEqual(['asset-legacy', 'asset-compressed'])
    expect(assets[1].compression).toBe('compressed')
    expect(assets[1].size).toBe(48_000)
  })

  it('duplicates cards carrying legacy and compressed assets, preserving metadata', () => {
    useGraph.setState({ cards: [note('note-1', [legacyAsset, compressedAsset])] })

    const [copyId] = useGraph.getState().duplicateCard('note-1')
    const copy = useGraph.getState().cards.find((card) => card.id === copyId)!

    expect(copy.assets).toHaveLength(2)
    const [legacyCopy, compressedCopy] = copy.assets!
    expect(legacyCopy).toMatchObject({ name: 'old-screenshot.png', size: 4_200_000 })
    expect(legacyCopy.compression).toBeUndefined()
    expect(compressedCopy).toMatchObject({
      name: 'new-reference.png',
      size: 48_000,
      width: 1280,
      height: 960,
      originalSize: 3_800_000,
      originalMimeType: 'image/png',
      compression: 'compressed',
    })
    expect(compressedCopy.id).not.toBe('asset-compressed')
  })

  it('source-context hashing ignores compression metadata, so old run snapshots stay fresh', () => {
    const core = {
      id: 'asset-1',
      kind: 'image' as const,
      name: 'ref.png',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,def456',
      size: 48_000,
      createdAt: '2026-07-01T00:00:00.000Z',
    }
    const withoutMetadata = board([note('note-1', [core])])
    const withMetadata = board([
      note('note-1', [
        { ...core, width: 1280, height: 960, originalSize: 3_800_000, originalMimeType: 'image/png', compression: 'compressed' },
      ]),
    ])

    const refs = [{ cardId: 'note-1' }]
    const before = createSourceContextSnapshot(withoutMetadata, refs)
    const after = createSourceContextSnapshot(withMetadata, refs)

    expect(before.sources).toHaveLength(1)
    expect(after.sources[0].hash).toBe(before.sources[0].hash)
  })

  it('AI compile carries compressed assets through to the instruction unchanged', () => {
    const ask: Card = {
      id: 'ask-1',
      kind: 'askAi',
      blocks: [{ id: 'ask-block', text: 'Describe the reference.' }],
      position: { x: 400, y: 0 },
    }
    const compiled = gatherConnectedThought(
      board([note('note-1', [legacyAsset, compressedAsset]), ask], [feeds('conn-1', 'note-1', 'ask-1')]),
      'ask-1',
    )

    expect(compiled.assets.map((asset) => asset.dataUrl)).toEqual([
      legacyAsset.dataUrl,
      compressedAsset.dataUrl,
    ])
    const compiledCompressed = compiled.assets.find((asset) => asset.name === 'new-reference.png')
    expect(compiledCompressed).toMatchObject({ size: 48_000, compression: 'compressed' })
  })

  it('save/export serialization keeps one authoritative reference and no derived rendition fields', () => {
    const saved = board([note('note-1', [legacyAsset, compressedAsset])])
    const exported = JSON.parse(JSON.stringify({ version: 1, board: saved })) as {
      board: SavedBoard
    }

    expect(exported.board.cards[0].assets?.map((asset) => asset.dataUrl)).toEqual([
      legacyAsset.dataUrl,
      compressedAsset.dataUrl,
    ])
    expect(JSON.stringify(exported)).not.toMatch(/blob:|rendition|thumbnail/i)
  })
})
