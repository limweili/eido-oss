import { describe, expect, it } from 'vitest'
import { makeSavedBoard } from '../graph/save'
import type { Card } from '../graph/types'
import { noteLinkPreviews } from '../shared/linkPreview'
import { validateSavedBoardTransport } from './profileLogicalProjection'

const linkCard: Card = {
  id: 'link-card',
  kind: 'note',
  blocks: [{ id: 'link-block', text: 'https://drybread.studio/' }],
  position: { x: 40, y: 60 },
  linkPreview: {
    url: 'https://drybread.studio/',
    status: 'ready',
    title: 'Drybread Studios',
    description: 'Products, tools, games and experiments.',
    siteName: 'drybread.studio',
  },
}

describe('link preview Profile compatibility', () => {
  it('validates and preserves durable preview metadata through the SavedBoard transport seam', () => {
    const board = makeSavedBoard({
      cards: [linkCard],
      updatedAt: '2026-08-14T00:00:00.000Z',
    })

    expect(validateSavedBoardTransport(board).cards[0]?.linkPreview).toEqual(
      linkCard.linkPreview,
    )
  })

  it('rejects unbounded or executable preview payloads', () => {
    const board = makeSavedBoard({
      cards: [linkCard],
      updatedAt: '2026-08-14T00:00:00.000Z',
    })
    const candidate = {
      ...board,
      cards: [{
        ...linkCard,
        linkPreview: {
          ...linkCard.linkPreview!,
          imageDataUrl: `data:image/svg+xml;base64,${'A'.repeat(800_000)}`,
        },
      }],
    }

    expect(() => validateSavedBoardTransport(candidate)).toThrow(/current Card/)
  })

  it('carries every preview a multi-link Note grew, with the first one where it has always been', () => {
    const extras = [
      { url: 'https://two.example/b', status: 'ready', title: 'Two' },
      { url: 'https://three.example/c', status: 'loading' },
    ] as const
    const board = makeSavedBoard({
      cards: [{ ...linkCard, meta: { linkPreviewExtras: [...extras] } }],
      updatedAt: '2026-08-27T00:00:00.000Z',
    })

    const restored = validateSavedBoardTransport(board)
    expect(restored.cards[0]?.linkPreview).toEqual(linkCard.linkPreview)
    expect(noteLinkPreviews(restored.cards[0])).toEqual([linkCard.linkPreview, ...extras])
  })

  // Extras ride in the settings envelope, so an extras list this build cannot
  // read is somebody else's saved previews, not a corrupt Board. It loads, it
  // is carried through untouched, and the Note shows only what it can read.
  it('shows only the previews it can read rather than refusing the Board', () => {
    const { linkPreview: _first, ...unanchored } = linkCard
    const tolerated = [
      { ...linkCard, meta: { linkPreviewExtras: [{ url: 'not-a-url', status: 'ready' }] } },
      { ...unanchored, meta: { linkPreviewExtras: [{ url: 'https://two.example/b', status: 'ready' }] } },
    ]
    const expected = [[linkCard.linkPreview], []]
    tolerated.forEach((candidate, index) => {
      const board = makeSavedBoard({
        cards: [candidate as Card],
        updatedAt: '2026-08-27T00:00:00.000Z',
      })
      const restored = validateSavedBoardTransport(board)
      expect(restored.cards[0]?.meta).toEqual(candidate.meta)
      expect(noteLinkPreviews(restored.cards[0])).toEqual(expected[index])
    })
  })

  it('rejects preview state on Card kinds that cannot render website previews', () => {
    const board = makeSavedBoard({
      cards: [{ ...linkCard, kind: 'askAi' }],
      updatedAt: '2026-08-14T00:00:00.000Z',
    })

    expect(() => validateSavedBoardTransport(board)).toThrow(/current Card/)
  })
})
