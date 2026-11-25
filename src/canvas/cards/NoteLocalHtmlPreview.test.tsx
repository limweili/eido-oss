// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../../graph/store'
import type { Card } from '../../graph/types'
import { NoteLocalHtmlPreview } from './NoteLocalHtmlPreview'

describe('NoteLocalHtmlPreview inside a Note', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [loadingCard()],
      undoStack: [],
      redoStack: [],
      intentLog: [],
    })
  })

  afterEach(() => {
    cleanup()
    Reflect.deleteProperty(window, 'eidoLinkPreviews')
  })

  it('replaces the short-lived renderer with one static persisted image', async () => {
    const loadLocal = vi.fn(async () => ({
      sourceId: 'source-1',
      title: 'Visual Review',
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      mimeType: 'image/jpeg' as const,
      size: 4,
      width: 1200,
      height: 675,
      capturedAt: '2026-08-14T10:00:00.000Z',
    }))
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { loadLocal, openLocal: vi.fn(async () => true) },
    })

    const rendered = renderCard()
    await waitFor(() => expect(useGraph.getState().cards[0]?.localHtmlPreview?.status).toBe('ready'))
    rendered.rerender(<StoredLocalHtmlCard />)

    expect(screen.getByRole('img', { name: 'Visual Review' })).toHaveAttribute(
      'src',
      'data:image/jpeg;base64,/9j/2Q==',
    )
    expect(document.querySelector('iframe, webview')).toBeNull()
    expect(loadLocal).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }))
    await waitFor(() => expect(loadLocal).toHaveBeenLastCalledWith('source-1', true))
  })

  it('does not render or reload HTML after a persisted ready Card reopens', () => {
    const card = readyCard()
    useGraph.setState({ cards: [card] })
    const loadLocal = vi.fn()
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { loadLocal, openLocal: vi.fn(async () => true) },
    })

    renderCard()

    expect(screen.getByRole('img', { name: 'Visual Review' })).toBeInTheDocument()
    expect(loadLocal).not.toHaveBeenCalled()
  })

  it('keeps the saved image while visibly reporting a missing original', async () => {
    useGraph.setState({ cards: [readyCard()] })
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { loadLocal: vi.fn(), openLocal: vi.fn(async () => false) },
    })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Open local HTML file Visual Review' }))

    await waitFor(() => expect(screen.getByText('File unavailable')).toBeInTheDocument())
    expect(screen.getByRole('img', { name: 'Visual Review' })).toBeInTheDocument()
    expect(useGraph.getState().cards[0]?.localHtmlPreview).toMatchObject({
      status: 'unavailable',
      assetId: 'asset-static',
    })
  })

  it('makes a forced refresh visibly busy and non-operable until capture settles', async () => {
    useGraph.setState({ cards: [readyCard()] })
    let resolveRefresh!: (capture: Awaited<ReturnType<NonNullable<Window['eidoLinkPreviews']>['loadLocal']>>) => void
    const loadLocal = vi.fn(() => new Promise((resolve) => { resolveRefresh = resolve }))
    Object.defineProperty(window, 'eidoLinkPreviews', {
      configurable: true,
      value: { loadLocal, openLocal: vi.fn(async () => true) },
    })
    renderCard()

    const refresh = screen.getByRole('button', { name: 'Refresh preview' })
    refresh.focus()
    fireEvent.click(refresh)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Refreshing preview' })).toHaveAttribute(
        'aria-disabled',
        'true',
      )
      expect(refresh).toHaveFocus()
      expect(screen.getAllByText('Rendering static preview')).toHaveLength(2)
      expect(screen.getByRole('status')).toHaveTextContent('Rendering static preview')
    })
    resolveRefresh({
      sourceId: 'source-1',
      title: 'Updated Review',
      imageDataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      mimeType: 'image/jpeg',
      size: 4,
      width: 1200,
      height: 675,
      capturedAt: '2026-08-14T10:01:00.000Z',
    })
    await waitFor(() => {
      expect(useGraph.getState().cards[0]?.localHtmlPreview?.title).toBe('Updated Review')
      expect(screen.getByRole('status')).toHaveTextContent('Preview ready: Updated Review')
      expect(refresh).toHaveFocus()
    })
  })

  it('removes only the local preview and its private screenshot asset', async () => {
    const card = readyCard()
    card.assets?.push({
      id: 'ordinary-image',
      kind: 'image',
      name: 'ordinary.png',
      mimeType: 'image/png',
      dataUrl: 'data:image/png;base64,AAAA',
      size: 3,
      createdAt: '2026-08-14T10:00:00.000Z',
    })
    useGraph.setState({ cards: [card], undoStack: [], redoStack: [] })
    renderCard()

    fireEvent.click(screen.getByRole('button', { name: 'Remove preview' }))

    await waitFor(() => expect(useGraph.getState().cards[0]?.localHtmlPreview).toBeUndefined())
    expect(useGraph.getState().cards[0]?.blocks[0]?.text).toBe('review.html')
    expect(useGraph.getState().cards[0]?.assets?.map((asset) => asset.id)).toEqual(['ordinary-image'])
  })
})

function loadingCard(): Card {
  return {
    id: 'local-card',
    kind: 'note',
    blocks: [{ id: 'block-1', text: 'review.html' }],
    localHtmlPreview: { sourceId: 'source-1', name: 'review.html', status: 'loading' },
    position: { x: 0, y: 0 },
  }
}

function readyCard(): Card {
  const card = loadingCard()
  card.assets = [{
    id: 'asset-static',
    kind: 'image',
    name: 'review.html preview.jpg',
    mimeType: 'image/jpeg',
    dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
    size: 4,
    createdAt: '2026-08-14T10:00:00.000Z',
    width: 1200,
    height: 675,
  }]
  card.localHtmlPreview = {
    sourceId: 'source-1',
    name: 'review.html',
    status: 'ready',
    title: 'Visual Review',
    assetId: 'asset-static',
  }
  return card
}

function StoredLocalHtmlCard() {
  const card = useGraph((state) => state.cards[0])
  if (!card?.localHtmlPreview) return null
  return (
    <NoteLocalHtmlPreview
      cardId={card.id}
      preview={card.localHtmlPreview}
      assets={card.assets ?? []}
    />
  )
}

function renderCard() {
  return render(<StoredLocalHtmlCard />)
}
