// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Card, LinkPreview } from '../../graph/types'
import {
  durableLinkPreview,
  noteLinkPreviews,
  type LoadedLinkPreview,
} from '../../shared/linkPreview'
import { useGraph } from '../../graph/store'
import { NoteLinkPreview } from './NoteLinkPreview'

const richPreview: LoadedLinkPreview = {
  url: 'https://drybread.studio/',
  status: 'ready',
  title: 'Drybread Studios',
  description: 'Products, tools, games and experiments.',
  siteName: 'drybread.studio',
  imageDataUrl: 'data:image/png;base64,AAAA',
  faviconDataUrl: 'data:image/png;base64,AQ==',
}

afterEach(() => {
  cleanup()
  Reflect.deleteProperty(window, 'eidoLinkPreviews')
})

function StoredNoteLinkPreview({ cardId }: Readonly<{ cardId: string }>) {
  const preview = useGraph((state) => state.cards.find((card) => card.id === cardId)?.linkPreview)
  return preview ? <NoteLinkPreview cardId={cardId} preview={preview} /> : <span>Preview removed</span>
}

describe('NoteLinkPreview inside a Note', () => {
  it('renders a rich, keyboard-accessible website preview without remote renderer requests', () => {
    const { container } = render(<NoteLinkPreview cardId="link-card" preview={richPreview} />)

    expect(screen.getByRole('link', { name: /Open Drybread Studios/i })).toHaveAttribute(
      'href',
      richPreview.url,
    )
    expect(screen.getByRole('link')).toHaveAttribute('target', '_blank')
    expect(screen.getByText(richPreview.description!)).toBeInTheDocument()
    expect(screen.getByText('drybread.studio')).toBeInTheDocument()
    expect(container.querySelector('.link-preview-image')).toHaveAttribute(
      'src',
      richPreview.imageDataUrl,
    )
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
    // The title line carries a favicon of its own for the shapes too short
    // for a site row (see the tile layout ladder in 040-cards-prose.css). It
    // is decoration, not a second announcement of the same site.
    const compactMark = container.querySelector('.link-preview-compact-mark')
    expect(compactMark).toHaveAttribute('aria-hidden', 'true')
    expect(compactMark?.parentElement).toHaveClass('link-preview-headline')
    expect(screen.getAllByText('Drybread Studios')).toHaveLength(1)
  })

  it('leaves the preview open to Card dragging while its own controls stay drag-blocked', () => {
    const { container } = render(<NoteLinkPreview cardId="link-card" preview={richPreview} />)

    // React Flow ignores a press that starts inside a `nodrag`/`nopan`
    // ancestor, so the anchor must carry neither: a press-and-move on the
    // preview has to fall through and drag the Card, the same as an image
    // tile's open button. Native browser link-dragging is refused separately
    // (draggable=false plus the dragstart preventDefault below).
    const link = screen.getByRole('link')
    expect(link).not.toHaveClass('nodrag')
    expect(link).not.toHaveClass('nopan')
    expect(link).toHaveAttribute('draggable', 'false')
    const dragStart = new Event('dragstart', { bubbles: true, cancelable: true })
    link.dispatchEvent(dragStart)
    expect(dragStart.defaultPrevented).toBe(true)

    // The refresh/remove controls remain their own drag-blocked islands so a
    // click on them can never be swallowed by a Card drag.
    expect(container.querySelector('.link-preview-remove')).toHaveClass('nodrag', 'nopan')
    expect(container.querySelector('.link-preview-retry')).toHaveClass('nodrag', 'nopan')
  })

  it('shows the address itself where the description belongs, instead of an unavailable notice', () => {
    render(<NoteLinkPreview cardId="link-card" preview={{
      url: 'https://drybread.studio/work',
      status: 'fallback',
    }} />)

    // The domain is already the tile's title and its site row, so the
    // description slot shows what is new about this address: its path. The
    // scheme is dropped, since neither the title nor the site row carry it
    // either.
    expect(screen.getAllByText('drybread.studio')).toHaveLength(2)
    expect(screen.getByText('drybread.studio/work')).toBeInTheDocument()
    expect(screen.queryByText('https://drybread.studio/work')).toBeNull()
    expect(screen.queryByText(/preview unavailable/i)).toBeNull()
    expect(screen.queryByRole('img')).toBeNull()
    expect(screen.getByRole('button', { name: 'Retry preview' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Remove preview' })).toBeVisible()
    expect(screen.getByRole('link')).toHaveAccessibleName(
      'Open drybread.studio, https://drybread.studio/work',
    )
  })

  it('lets a fallback Card retry preview enrichment without being recreated', async () => {
    const fallback: LinkPreview = { url: richPreview.url, status: 'fallback' }
    const card: Card = {
      id: 'link-card',
      kind: 'note',
      blocks: [{ id: 'link-block', text: richPreview.url }],
      position: { x: 0, y: 0 },
      linkPreview: fallback,
    }
    useGraph.setState({ cards: [card], undoStack: [], redoStack: [] })
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load: async () => richPreview },
    })

    render(<NoteLinkPreview cardId={card.id} preview={fallback} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }))

    await waitFor(() => expect(useGraph.getState().cards[0]?.linkPreview).toEqual(
      durableLinkPreview(richPreview),
    ))
    expect(useGraph.getState().undoStack).toHaveLength(0)
  })

  it('does not settle a retry after the preview unmounts', async () => {
    const retryUrl = 'https://retry-unmount.example/'
    const fallback: LinkPreview = { url: retryUrl, status: 'fallback' }
    const card: Card = {
      id: 'link-card',
      kind: 'note',
      blocks: [{ id: 'link-block', text: retryUrl }],
      position: { x: 0, y: 0 },
      linkPreview: fallback,
    }
    useGraph.setState({ cards: [card], undoStack: [], redoStack: [] })
    let resolveLoad!: (preview: LoadedLinkPreview) => void
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: {
        load: () => new Promise<LoadedLinkPreview>((resolve) => {
          resolveLoad = resolve
        }),
      },
    })

    const rendered = render(<NoteLinkPreview cardId={card.id} preview={fallback} />)
    fireEvent.click(screen.getByRole('button', { name: 'Retry preview' }))
    await waitFor(() => expect(useGraph.getState().cards[0]?.linkPreview).toEqual({
      url: retryUrl,
      status: 'loading',
    }))
    rendered.unmount()
    resolveLoad({ ...richPreview, url: retryUrl })
    await Promise.resolve()

    expect(useGraph.getState().cards[0]?.linkPreview).toEqual({
      url: retryUrl,
      status: 'loading',
    })
  })

  it('resumes a persisted loading preview and settles it through the store', async () => {
    const resumeUrl = 'https://resume-loading.example/'
    const resumedPreview = { ...richPreview, url: resumeUrl }
    const card: Card = {
      id: 'link-card',
      kind: 'note',
      blocks: [{ id: 'link-block', text: resumeUrl }],
      position: { x: 0, y: 0 },
      linkPreview: { url: resumeUrl, status: 'loading' },
    }
    useGraph.setState({ cards: [card], undoStack: [], redoStack: [] })
    let resolveLoad!: (preview: LoadedLinkPreview) => void
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load: () => new Promise((resolve) => { resolveLoad = resolve }) },
    })

    render(<StoredNoteLinkPreview cardId={card.id} />)
    const status = screen.getByRole('status')
    await waitFor(() => expect(status).toHaveTextContent('Loading preview'))
    resolveLoad(resumedPreview)
    await waitFor(() => expect(useGraph.getState().cards[0]?.linkPreview).toEqual(
      durableLinkPreview(resumedPreview),
    ))
    expect(status).toBeInTheDocument()
    expect(status).toHaveTextContent('Preview ready: Drybread Studios')
    expect(useGraph.getState().undoStack).toHaveLength(0)
  })

  it('keeps durable rich metadata when media refresh is unavailable', async () => {
    const url = 'https://offline-refresh.example/'
    const persisted: LinkPreview = {
      url,
      status: 'ready',
      title: 'Saved title',
      description: 'Saved description',
      siteName: 'Saved site',
    }
    const card: Card = {
      id: 'offline-card',
      kind: 'note',
      blocks: [{ id: 'link-block', text: url }],
      position: { x: 0, y: 0 },
      linkPreview: persisted,
    }
    useGraph.setState({ cards: [card], undoStack: [], redoStack: [] })
    const load = vi.fn(async () => { throw new Error('offline') })
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load },
    })

    const firstRender = render(<StoredNoteLinkPreview cardId={card.id} />)

    await waitFor(() => expect(screen.getByText('Saved title')).toBeInTheDocument())
    expect(useGraph.getState().cards[0]?.linkPreview).toEqual(persisted)
    // A Profile keeps a preview's words and never its pictures, so a restored
    // tile asks for its media back -- once. The refusal is remembered, so
    // remounting the tile does not ask a second time, and the saved words are
    // still what the tile shows.
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1))
    firstRender.unmount()
    render(<StoredNoteLinkPreview cardId={card.id} />)
    expect(screen.getByText('Saved title')).toBeInTheDocument()
    expect(load).toHaveBeenCalledTimes(1)
    expect(useGraph.getState().cards[0]?.linkPreview).toEqual(persisted)
  })

  it('restores a saved preview\'s picture once a session, and shows it', async () => {
    const url = 'https://restored-media.example/'
    const persisted: LinkPreview = {
      url,
      status: 'ready',
      title: 'Saved title',
      siteName: 'restored-media.example',
    }
    const card: Card = {
      id: 'restored-card',
      kind: 'note',
      blocks: [{ id: 'link-block', text: url }],
      position: { x: 0, y: 0 },
      linkPreview: persisted,
    }
    useGraph.setState({ cards: [card], undoStack: [], redoStack: [] })
    const load = vi.fn(async () => ({
      ...persisted,
      imageDataUrl: 'data:image/png;base64,AAAA',
      faviconDataUrl: 'data:image/png;base64,AQ==',
    } as LoadedLinkPreview))
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load },
    })

    const { container, unmount } = render(<StoredNoteLinkPreview cardId={card.id} />)

    await waitFor(() => expect(container.querySelector('.link-preview-image')).toHaveAttribute(
      'src',
      'data:image/png;base64,AAAA',
    ))
    // Restoring what the Profile deliberately does not store is not a change
    // to the Card, so the Board is not dirtied and nothing lands on undo.
    expect(useGraph.getState().cards[0]?.linkPreview).toEqual(persisted)
    expect(useGraph.getState().undoStack).toHaveLength(0)

    unmount()
    render(<StoredNoteLinkPreview cardId={card.id} />)
    await waitFor(() => expect(screen.getByText('Saved title')).toBeInTheDocument())
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('closes only the tile its X sits on when a Note carries several previews', async () => {
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load: async (url: string) => ({ url, status: 'fallback' }) },
    })
    const first = 'https://one.example/a'
    const second = 'https://two.example/b'
    const id = useGraph.getState().addCard('note', { x: 0, y: 0 })
    useGraph.getState().setCardText(id, `Read [one](${first}) and ${second}`)
    useGraph.getState().ensureNoteLinkPreview(id, first)
    useGraph.getState().ensureNoteLinkPreview(id, second)

    function StoredPreviews() {
      const card = useGraph((state) => state.cards.find((candidate) => candidate.id === id))
      return (
        <>
          {noteLinkPreviews(card).map((preview) => (
            <NoteLinkPreview key={preview.url} cardId={id} preview={preview} />
          ))}
        </>
      )
    }

    render(<StoredPreviews />)
    const removes = screen.getAllByRole('button', { name: 'Remove preview' })
    expect(removes).toHaveLength(2)
    fireEvent.click(removes[0]!)

    await waitFor(() => expect(
      noteLinkPreviews(useGraph.getState().cards.find((candidate) => candidate.id === id))
        .map((preview) => preview.url),
    ).toEqual([second]))
    expect(screen.getAllByRole('button', { name: 'Remove preview' })).toHaveLength(1)
  })

  it('keeps Retry focused while its store-driven loading cycle settles', async () => {
    const url = 'https://focus-retry.example/'
    const fallback: LinkPreview = { url, status: 'fallback' }
    const card: Card = {
      id: 'focus-card',
      kind: 'note',
      blocks: [{ id: 'link-block', text: url }],
      position: { x: 0, y: 0 },
      linkPreview: fallback,
    }
    useGraph.setState({ cards: [card], undoStack: [], redoStack: [] })
    let resolveLoad!: (preview: LoadedLinkPreview) => void
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { load: () => new Promise((resolve) => { resolveLoad = resolve }) },
    })

    render(<StoredNoteLinkPreview cardId={card.id} />)
    const retry = screen.getByRole('button', { name: 'Retry preview' })
    retry.focus()
    fireEvent.click(retry)
    await waitFor(() => expect(useGraph.getState().cards[0]?.linkPreview?.status).toBe('loading'))
    expect(retry).toBeInTheDocument()
    expect(retry).toHaveFocus()

    resolveLoad({ url, status: 'fallback' })
    await waitFor(() => expect(useGraph.getState().cards[0]?.linkPreview?.status).toBe('fallback'))
    expect(retry).toBeInTheDocument()
    expect(retry).toHaveFocus()
  })

  it('removes the automatic website preview without changing the Note text', async () => {
    const fallback: LinkPreview = { url: richPreview.url, status: 'fallback' }
    const card: Card = {
      id: 'convert-card',
      kind: 'note',
      blocks: [{ id: 'link-block', text: richPreview.url }],
      position: { x: 0, y: 0 },
      linkPreview: fallback,
    }
    useGraph.setState({ cards: [card], undoStack: [], redoStack: [] })

    render(<StoredNoteLinkPreview cardId={card.id} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove preview' }))

    expect(await screen.findByText('Preview removed')).toBeInTheDocument()
    expect(useGraph.getState().cards[0]?.linkPreview).toBeUndefined()
    expect(useGraph.getState().cards[0]?.blocks).toEqual([{ id: 'link-block', text: richPreview.url }])
  })
})
