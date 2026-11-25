// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../../graph/store'
import type { Card } from '../../graph/types'
import { OverlayProvider } from '../../ui/overlays'
import { NoteCard } from './NoteCard'

function nodeProps(id: string): NodeProps {
  return {
    id,
    selected: false,
    data: { selectedCardCount: 0 },
  } as unknown as NodeProps
}

function renderNote(card: Card) {
  useGraph.setState({
    cards: [card],
    connections: [],
    outputs: [],
    intentLog: [],
    undoStack: [],
    redoStack: [],
    selection: null,
    selectedCardIds: [],
    activeTool: 'select',
  })
  return render(
    <OverlayProvider>
      <ReactFlowProvider>
        <NoteCard {...nodeProps(card.id)} />
      </ReactFlowProvider>
    </OverlayProvider>,
  )
}

describe('Note preview composition', () => {
  beforeEach(() => {
    HTMLElement.prototype.scrollTo = vi.fn()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders Note prose and an attached website preview in the same body', () => {
    const rendered = renderNote({
      id: 'website-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'www.drybread.studio' }],
      position: { x: 0, y: 0 },
      linkPreview: {
        url: 'https://www.drybread.studio',
        status: 'fallback',
      },
    })

    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveTextContent('www.drybread.studio')
    expect(screen.getByRole('link', { name: /Open drybread\.studio/i })).toBeVisible()
    // The preview is pinned below the body, in the previews panel, so a Note
    // whose prose grows can never push it past the bottom of the Card.
    expect(rendered.container.querySelector('.note-body > .link-preview-frame')).toBeNull()
    expect(
      rendered.container.querySelector(
        '.card-attachment-panel--previews .card-attachment-item--preview .link-preview-frame',
      ),
    ).toBeInTheDocument()
  })

  it('stacks the images panel above the previews panel, both below the body', () => {
    const rendered = renderNote({
      id: 'both-panels-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'www.drybread.studio' }],
      position: { x: 0, y: 0 },
      linkPreview: { url: 'https://www.drybread.studio', status: 'fallback' },
      assets: [
        {
          id: 'diagram',
          kind: 'image',
          name: 'diagram.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA',
          size: 3,
          createdAt: '2026-08-14T10:00:00.000Z',
        },
      ],
    })

    const regions = [...rendered.container.querySelectorAll(
      '.note-body, .card-attachment-panel',
    )].map((element) => element.className.split(' ').find((name) =>
      name === 'card-body' || name.startsWith('card-attachment-panel--'),
    ))
    expect(regions).toEqual([
      'card-body',
      'card-attachment-panel--images',
      'card-attachment-panel--previews',
    ])
  })

  it('shows no panel when the Note carries no attachment of that kind', () => {
    const rendered = renderNote({
      id: 'bare-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'just prose' }],
      position: { x: 0, y: 0 },
    })

    expect(rendered.container.querySelector('.card-attachment-panel')).toBeNull()
  })

  it('renders a local preview JPEG once while keeping ordinary image attachments', () => {
    const previewDataUrl = 'data:image/jpeg;base64,/9j/2Q=='
    const rendered = renderNote({
      id: 'local-note',
      kind: 'note',
      blocks: [{ id: 'body', text: 'visual-review.html' }],
      position: { x: 0, y: 0 },
      localHtmlPreview: {
        sourceId: 'source-1',
        name: 'visual-review.html',
        title: 'Visual Review',
        status: 'ready',
        assetId: 'preview-asset',
      },
      assets: [
        {
          id: 'preview-asset',
          kind: 'image',
          name: 'visual-review.html preview.jpg',
          mimeType: 'image/jpeg',
          dataUrl: previewDataUrl,
          size: 4,
          createdAt: '2026-08-14T10:00:00.000Z',
          width: 1200,
          height: 675,
        },
        {
          id: 'ordinary-image',
          kind: 'image',
          name: 'diagram.png',
          mimeType: 'image/png',
          dataUrl: 'data:image/png;base64,AAAA',
          size: 3,
          createdAt: '2026-08-14T10:00:00.000Z',
        },
      ],
    })

    expect(screen.getByRole('textbox', { name: 'Note body' })).toHaveTextContent('visual-review.html')
    expect(screen.getByRole('img', { name: 'Visual Review' })).toBeVisible()
    expect(rendered.container.querySelectorAll(`img[src="${previewDataUrl}"]`)).toHaveLength(1)
    expect(
      rendered.container.querySelectorAll('.card-attachment-panel--images .card-attachment-item'),
    ).toHaveLength(1)
  })
})
