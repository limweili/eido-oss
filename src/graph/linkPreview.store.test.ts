import { beforeEach, describe, expect, it } from 'vitest'
import {
  linkPreviewDismissed,
  noteLinkPreviews,
  type LinkPreview,
} from '../shared/linkPreview'
import { useGraph } from './store'

describe('Note previews in the graph store', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      highlights: [],
      highlightTags: [],
      intentLog: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      cardClipboard: null,
    })
  })

  it('creates one undoable Note with durable URL meaning and a loading preview', () => {
    const id = useGraph.getState().addNoteWithLinkPreview(
      { url: 'https://drybread.studio/', text: 'www.drybread.studio' },
      { x: 120, y: 80 },
    )

    const card = useGraph.getState().cards.find((candidate) => candidate.id === id)
    expect(card).toMatchObject({
      kind: 'note',
      // The pasted address lands as a Markdown link, so the Note reads as the
      // page rather than as a naked url, and one unambiguous address is what
      // the preview follows.
      blocks: [{ text: '[www.drybread.studio](https://drybread.studio/)' }],
      linkPreview: {
        url: 'https://drybread.studio/',
        status: 'loading',
      },
    })
    expect(useGraph.getState().undoStack).toHaveLength(1)
    expect(useGraph.getState().snapshot().cards[0]?.linkPreview).toEqual(card?.linkPreview)
    const intentLog = useGraph.getState().intentLog
    expect(intentLog[intentLog.length - 1]).toMatchObject({
      type: 'card.created',
      data: {
        card: {
          blocks: [{ text: '[www.drybread.studio](https://drybread.studio/)' }],
          linkPreview: {
            url: 'https://drybread.studio/',
            status: 'loading',
          },
        },
      },
    })
  })

  it('settles matching preview metadata without adding a second undo step or accepting stale work', () => {
    const id = useGraph.getState().addNoteWithLinkPreview(
      { url: 'https://drybread.studio/', text: 'www.drybread.studio' },
      { x: 120, y: 80 },
    )
    const resolved: LinkPreview = {
      url: 'https://drybread.studio/',
      status: 'ready',
      title: 'Drybread Studios',
      description: 'Products, tools, games and experiments.',
      siteName: 'drybread.studio',
    }

    useGraph.getState().setLinkPreview(id, resolved)
    expect(useGraph.getState().cards[0]?.linkPreview).toEqual(resolved)
    expect(useGraph.getState().undoStack).toHaveLength(1)

    useGraph.getState().setLinkPreview(id, {
      url: 'https://stale.example/',
      status: 'ready',
      title: 'Stale',
    })
    expect(useGraph.getState().cards[0]?.linkPreview).toEqual(resolved)
  })

  it('does not replace or persist byte-identical resolved metadata', () => {
    const id = useGraph.getState().addNoteWithLinkPreview(
      { url: 'https://drybread.studio/', text: 'www.drybread.studio' },
      { x: 120, y: 80 },
    )
    const resolved: LinkPreview = {
      url: 'https://drybread.studio/',
      status: 'ready',
      title: 'Drybread Studios',
      description: 'Products, tools, games and experiments.',
      siteName: 'drybread.studio',
    }
    useGraph.getState().setLinkPreview(id, resolved)
    const firstResolution = useGraph.getState().cards[0]?.linkPreview

    useGraph.getState().setLinkPreview(id, { ...resolved })

    expect(useGraph.getState().cards[0]?.linkPreview).toBe(firstResolution)
  })

  it('preserves rich durable metadata when a background refresh falls back', () => {
    const id = useGraph.getState().addNoteWithLinkPreview(
      { url: 'https://drybread.studio/', text: 'www.drybread.studio' },
      { x: 120, y: 80 },
    )
    const resolved: LinkPreview = {
      url: 'https://drybread.studio/',
      status: 'ready',
      title: 'Drybread Studios',
      description: 'Products, tools, games and experiments.',
      siteName: 'drybread.studio',
    }
    useGraph.getState().setLinkPreview(id, resolved)

    useGraph.getState().setLinkPreview(id, {
      url: 'https://drybread.studio/',
      status: 'fallback',
    })

    expect(useGraph.getState().cards[0]?.linkPreview).toEqual(resolved)
  })

  it('removes a website preview while preserving the Note text as one undoable action', () => {
    const id = useGraph.getState().addNoteWithLinkPreview(
      { url: 'https://drybread.studio/', text: 'www.drybread.studio' },
      { x: 120, y: 80 },
    )
    const undoBeforeConversion = useGraph.getState().undoStack.length

    useGraph.getState().removeNotePreview(id)

    expect(useGraph.getState().cards[0]).toMatchObject({
      id,
      kind: 'note',
      blocks: [{ text: '[www.drybread.studio](https://drybread.studio/)' }],
    })
    expect(useGraph.getState().cards[0]?.linkPreview).toBeUndefined()
    expect(useGraph.getState().undoStack).toHaveLength(undoBeforeConversion + 1)

    useGraph.getState().undo()
    expect(useGraph.getState().cards[0]?.linkPreview).toEqual({
      url: 'https://drybread.studio/',
      status: 'loading',
    })
  })

  it('keeps the website preview attached when the Note text changes', () => {
    const id = useGraph.getState().addNoteWithLinkPreview(
      { url: 'https://drybread.studio/', text: 'www.drybread.studio' },
      { x: 120, y: 80 },
    )

    useGraph.getState().setCardText(id, 'A useful website')

    expect(useGraph.getState().cards[0]?.blocks).toEqual([
      expect.objectContaining({ text: 'A useful website' }),
    ])
    expect(useGraph.getState().cards[0]?.linkPreview).toEqual({
      url: 'https://drybread.studio/',
      status: 'loading',
    })
  })

  it('keeps Note previews independent from ordinary attachments', () => {
    const id = useGraph.getState().addNoteWithLinkPreview(
      { url: 'https://drybread.studio/', text: 'www.drybread.studio' },
      { x: 120, y: 80 },
    )

    useGraph.getState().addCardAssets(id, [{
      id: 'ordinary-file',
      kind: 'file',
      name: 'notes.txt',
      mimeType: 'text/plain',
      dataUrl: 'data:text/plain;base64,bm90ZXM=',
      size: 5,
      createdAt: '2026-08-14T10:00:00.000Z',
    }])

    expect(useGraph.getState().cards[0]?.linkPreview).toEqual({
      url: 'https://drybread.studio/',
      status: 'loading',
    })
    expect(useGraph.getState().cards[0]?.assets).toEqual([
      expect.objectContaining({ id: 'ordinary-file' }),
    ])
  })

  it('settles a local HTML Card into one persisted static image asset', () => {
    const id = useGraph.getState().addNoteWithLocalHtmlPreview(
      { id: 'source-1', name: 'visual-review.html' },
      { x: 120, y: 80 },
    )
    expect(useGraph.getState().cards[0]).toMatchObject({
      kind: 'note',
      blocks: [{ text: 'visual-review.html' }],
      localHtmlPreview: {
        sourceId: 'source-1',
        name: 'visual-review.html',
        status: 'loading',
      },
    })

    useGraph.getState().settleLocalHtmlPreview(id, {
      sourceId: 'source-1',
      title: 'Visual Review',
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      mimeType: 'image/jpeg',
      size: 4,
      width: 1200,
      height: 675,
      capturedAt: '2026-08-14T10:00:00.000Z',
    })

    const settled = useGraph.getState().cards[0]
    expect(settled?.localHtmlPreview).toMatchObject({
      sourceId: 'source-1',
      status: 'ready',
      title: 'Visual Review',
      assetId: expect.any(String),
    })
    expect(settled?.assets).toEqual([
      expect.objectContaining({
        id: settled?.localHtmlPreview?.assetId,
        kind: 'image',
        mimeType: 'image/jpeg',
        dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
        size: 4,
        width: 1200,
        height: 675,
      }),
    ])
    expect(useGraph.getState().undoStack).toHaveLength(1)

    const duplicateId = useGraph.getState().duplicateCard(id)[0]!
    const duplicate = useGraph.getState().cards.find((card) => card.id === duplicateId)!
    expect(duplicate.localHtmlPreview?.assetId).not.toBe(settled?.localHtmlPreview?.assetId)
    expect(duplicate.assets?.some((asset) => asset.id === duplicate.localHtmlPreview?.assetId)).toBe(true)

    useGraph.getState().failLocalHtmlPreview(id, 'source-1')
    const unavailable = useGraph.getState().cards.find((card) => card.id === id)!
    expect(unavailable.localHtmlPreview).toMatchObject({
      status: 'unavailable',
      assetId: settled?.localHtmlPreview?.assetId,
    })
    expect(unavailable.assets?.some((asset) => asset.id === unavailable.localHtmlPreview?.assetId)).toBe(true)

    useGraph.getState().addCardAssets(id, [{
      id: 'ordinary-file',
      kind: 'file',
      name: 'notes.txt',
      mimeType: 'text/plain',
      dataUrl: 'data:text/plain;base64,bm90ZXM=',
      size: 5,
      createdAt: '2026-08-14T10:00:00.000Z',
    }])
    useGraph.getState().removeNotePreview(id)
    const withoutPreview = useGraph.getState().cards.find((card) => card.id === id)!
    expect(withoutPreview.localHtmlPreview).toBeUndefined()
    expect(withoutPreview.assets).toEqual([
      expect.objectContaining({ id: 'ordinary-file' }),
    ])
  })

  it('ensureNoteLinkPreview lets a Note body drive generation, silently', () => {
    const id = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().setCardText(id, 'This is a note with a link http://example.com/x and more text')
    const undoBefore = useGraph.getState().undoStack.length

    useGraph.getState().ensureNoteLinkPreview(id, 'http://example.com/x')

    expect(useGraph.getState().cards.find((card) => card.id === id)?.linkPreview).toEqual({
      url: 'http://example.com/x',
      status: 'loading',
    })
    // A derived fetch kickoff, not a user edit: it stays out of undo.
    expect(useGraph.getState().undoStack).toHaveLength(undoBefore)
  })

  it('grows one preview per link the body carries, in body order, up to the cap', () => {
    const id = useGraph.getState().addCard('note', { x: 0, y: 0 })
    const urls = [
      'https://one.example/a',
      'https://two.example/b',
      'https://three.example/c',
      'https://four.example/d',
      'https://five.example/e',
    ]
    useGraph.getState().setCardText(id, [
      `First: [one](${urls[0]})`,
      `then <${urls[1]}>`,
      `then ${urls[2]} in prose`,
      `and [four](${urls[3]}) and [five](${urls[4]})`,
    ].join('\n'))

    for (const url of urls) useGraph.getState().ensureNoteLinkPreview(id, url)

    const card = useGraph.getState().cards[0]!
    expect(noteLinkPreviews(card).map((preview) => preview.url)).toEqual(urls.slice(0, 4))
    // The first preview stays in the top level key every shipped build reads,
    // and the rest ride in the settings envelope beside it.
    expect(card.linkPreview?.url).toBe(urls[0])
    expect(card.meta?.linkPreviewExtras).toHaveLength(3)
  })

  it('settles and removes one tile at a time without disturbing its neighbours', () => {
    const id = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().setCardText(
      id,
      'Read [one](https://one.example/a) and https://two.example/b',
    )
    useGraph.getState().ensureNoteLinkPreview(id, 'https://one.example/a')
    useGraph.getState().ensureNoteLinkPreview(id, 'https://two.example/b')

    useGraph.getState().setLinkPreview(id, {
      url: 'https://two.example/b',
      status: 'ready',
      title: 'Two',
    })
    expect(noteLinkPreviews(useGraph.getState().cards[0]!)).toEqual([
      { url: 'https://one.example/a', status: 'loading' },
      { url: 'https://two.example/b', status: 'ready', title: 'Two' },
    ])

    useGraph.getState().removeNotePreview(id, 'https://one.example/a')

    expect(noteLinkPreviews(useGraph.getState().cards[0]!)).toEqual([
      { url: 'https://two.example/b', status: 'ready', title: 'Two' },
    ])
    // Only the closed address is held back; the tile still on screen is not.
    expect(linkPreviewDismissed(useGraph.getState().cards[0], 'https://one.example/a'))
      .toBe(true)
    expect(linkPreviewDismissed(useGraph.getState().cards[0], 'https://two.example/b'))
      .toBe(false)
    useGraph.getState().ensureNoteLinkPreview(id, 'https://one.example/a')
    expect(noteLinkPreviews(useGraph.getState().cards[0]!)).toHaveLength(1)
  })

  it('does not regrow a preview the founder explicitly removed with the X', () => {
    const id = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().setCardText(id, 'Read this: http://example.com/x')
    useGraph.getState().ensureNoteLinkPreview(id, 'http://example.com/x')
    useGraph.getState().removeNotePreview(id)

    expect(linkPreviewDismissed(useGraph.getState().cards[0], 'http://example.com/x'))
      .toBe(true)

    useGraph.getState().ensureNoteLinkPreview(id, 'http://example.com/x')
    expect(useGraph.getState().cards[0]?.linkPreview).toBeUndefined()

    // A different url the Note later carries is not held back by that dismissal.
    useGraph.getState().setCardText(id, 'Read this instead: https://example.org/new-page')
    useGraph.getState().ensureNoteLinkPreview(id, 'https://example.org/new-page')
    expect(useGraph.getState().cards[0]?.linkPreview).toEqual({
      url: 'https://example.org/new-page',
      status: 'loading',
    })
  })

  it('makes the X stick when the removed preview was the local HTML one', () => {
    const id = useGraph.getState().addNoteWithLocalHtmlPreview(
      { id: 'source-1', name: 'visual-review.html' },
      { x: 120, y: 80 },
    )
    useGraph.getState().setCardText(id, 'The published copy lives at http://example.com/x')

    useGraph.getState().removeNotePreview(id)

    // Without this the body-driven generator would grow a Link Preview in the
    // removed one's place, so the founder watches the thing they just closed
    // come straight back wearing a different hat.
    expect(linkPreviewDismissed(useGraph.getState().cards[0], 'http://example.com/x'))
      .toBe(true)
    useGraph.getState().ensureNoteLinkPreview(id, 'http://example.com/x')
    expect(useGraph.getState().cards[0]?.linkPreview).toBeUndefined()
  })

  it('spends one preview attempt per url per Note, however often the Board reopens', () => {
    const id = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().setCardText(id, 'Read this: http://example.com/x')

    useGraph.getState().ensureNoteLinkPreview(id, 'http://example.com/x')

    // The attempt is remembered in the Card's forward compatible bag, never as
    // a new top level Card key an older build's validator would refuse.
    expect(useGraph.getState().cards[0]?.meta)
      .toEqual({ linkPreviewAttemptedUrls: ['http://example.com/x'] })

    // The Board comes back carrying that memory and no preview: the fetch
    // failed, or Eido closed before it settled. A reopen must not spend a
    // second fetch on the same url.
    useGraph.setState({
      cards: useGraph.getState().cards.map((card) => {
        const { linkPreview: _settled, ...reopened } = card
        return reopened
      }),
    })
    useGraph.getState().ensureNoteLinkPreview(id, 'http://example.com/x')
    expect(useGraph.getState().cards[0]?.linkPreview).toBeUndefined()
  })

  it('ignores a debounced kickoff for a url the Note body no longer carries', () => {
    const id = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().setCardText(id, 'Read this: http://example.com/x')
    useGraph.getState().setCardText(id, 'Actually, never mind')

    useGraph.getState().ensureNoteLinkPreview(id, 'http://example.com/x')

    expect(useGraph.getState().cards[0]?.linkPreview).toBeUndefined()
    expect(useGraph.getState().cards[0]?.meta).toBeUndefined()
  })

  it('never accepts a stale local capture for a different opaque source', () => {
    const id = useGraph.getState().addNoteWithLocalHtmlPreview(
      { id: 'source-1', name: 'visual-review.html' },
      { x: 120, y: 80 },
    )
    useGraph.getState().settleLocalHtmlPreview(id, {
      sourceId: 'source-stale',
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      mimeType: 'image/jpeg',
      size: 4,
      width: 1200,
      height: 675,
      capturedAt: '2026-08-14T10:00:00.000Z',
    })
    expect(useGraph.getState().cards[0]?.localHtmlPreview?.status).toBe('loading')
    expect(useGraph.getState().cards[0]?.assets).toBeUndefined()
  })
})
