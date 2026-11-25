// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { useGraph } from '../graph/store'
import { words } from '../shared/words'
import { OverlayProvider } from '../ui/overlays'
import { HighlightsPanel } from './HighlightsPanel'

describe('Highlights panel design-system outcomes', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [
        {
          id: 'note-1',
          kind: 'note',
          title: 'Source note',
          blocks: [{ id: 'block-1', text: 'Marked passage in its original note.' }],
          position: { x: 0, y: 0 },
        },
      ],
      highlights: [
        {
          id: 'highlight-1',
          cardId: 'note-1',
          tagId: 'tag-1',
          text: 'Marked passage',
          occurrence: 0,
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      highlightTags: [
        {
          id: 'tag-1',
          name: 'Important',
          color: 'yellow',
          createdAt: '2026-07-01T00:00:00.000Z',
        },
      ],
      highlightsPanelOpen: true,
    })
  })

  afterEach(cleanup)

  it('renders paper quotes, mono source values, badges, and ghost icon actions', () => {
    render(
      <OverlayProvider>
        <HighlightsPanel />
      </OverlayProvider>,
    )

    expect(screen.getByRole('heading', { name: words.highlights })).toHaveClass('t-title')
    expect(screen.getByText('1', { selector: '.highlights-count' })).toHaveClass('e-badge')
    expect(screen.getByText('Important')).toHaveClass('t-micro')
    expect(screen.getByText('Marked passage')).toHaveClass('t-prose-s')
    expect(screen.getByText('Source note')).toHaveClass('t-value')

    for (const name of [
      words.close,
      `${words.deleteHighlightTag}: Important`,
      words.highlightGoToCard,
      words.highlightMakeNote,
      words.highlightRemove,
    ]) {
      expect(screen.getByRole('button', { name })).toHaveClass(
        'e-icon-button',
        'e-button--ghost',
      )
    }
  })

  it('cancels without mutation, then confirms deletion through the shared dialog', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <HighlightsPanel />
      </OverlayProvider>,
    )

    const deleteTag = screen.getByRole('button', { name: `${words.deleteHighlightTag}: Important` })
    await user.click(deleteTag)
    let dialog = await screen.findByRole('dialog', { name: 'Delete this tag?' })
    expect(dialog).toHaveTextContent('Its highlights will be removed too. The text on your cards stays.')
    let backdrop = dialog.parentElement!
    await user.click(screen.getByRole('button', { name: words.cancel }))
    fireEvent.transitionEnd(backdrop, { propertyName: 'opacity' })

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(useGraph.getState().highlightTags.map((tag) => tag.id)).toEqual(['tag-1'])
    expect(useGraph.getState().highlights.map((highlight) => highlight.id)).toEqual(['highlight-1'])

    await user.click(deleteTag)
    dialog = await screen.findByRole('dialog', { name: 'Delete this tag?' })
    backdrop = dialog.parentElement!
    await user.click(screen.getByRole('button', { name: words.deleteHighlightTag }))
    fireEvent.transitionEnd(backdrop, { propertyName: 'opacity' })

    await waitFor(() => expect(useGraph.getState().highlightTags).toEqual([]))
    expect(useGraph.getState().highlights).toEqual([])
  })

  it('removes one highlight without removing its tag', async () => {
    const user = userEvent.setup()
    render(
      <OverlayProvider>
        <HighlightsPanel />
      </OverlayProvider>,
    )

    await user.click(screen.getByRole('button', { name: words.highlightRemove }))

    expect(useGraph.getState().highlights).toEqual([])
    expect(useGraph.getState().highlightTags.map((tag) => tag.id)).toEqual(['tag-1'])
  })
})
