// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EmptyState } from './App'
import { useGraph } from './graph/store'
import type { Card } from './graph/types'
import { words } from './shared/words'

const EXISTING_NOTE: Card = {
  id: 'existing-note',
  kind: 'note',
  blocks: [{ id: 'existing-block', text: '' }],
  position: { x: 12, y: 18 },
}

function resetCards(cards: Card[] = []) {
  useGraph.setState({
    cards,
    connections: [],
    outputs: [],
    runs: [],
    intentLog: [],
    selection: null,
    selectedCardIds: [],
    undoStack: [],
    redoStack: [],
    saveState: 'saved',
  })
}

describe('EmptyState ghost-graph contract', () => {
  beforeEach(() => resetCards())
  afterEach(cleanup)

  it('shows one paper-voice action with a decorative two-card dotted-wire graph', () => {
    const { container } = render(<EmptyState />)

    const empty = screen.getByRole('region', { name: words.emptyTitle })
    expect(within(empty).getByRole('heading', { name: words.emptyTitle })).toHaveClass('t-display')
    expect(within(empty).getByText(words.emptyHint)).toHaveClass('t-hint')

    const actions = within(empty).getAllByRole('button')
    expect(actions).toHaveLength(1)
    expect(actions[0]).toHaveAccessibleName(words.addNote)
    expect(actions[0]).toHaveClass('e-button--primary')

    const ghost = container.querySelector('.empty-ghost')
    expect(ghost).toHaveAttribute('aria-hidden', 'true')
    expect(ghost).toHaveAttribute('focusable', 'false')
    expect(ghost).not.toHaveAttribute('tabindex')
    expect(ghost?.querySelectorAll('.empty-ghost__card')).toHaveLength(2)
    expect(ghost?.querySelectorAll('.empty-ghost__wire')).toHaveLength(1)
    expect(ghost?.querySelectorAll('.empty-ghost__asterisk')).toHaveLength(1)

    const asterisk = ghost?.querySelector('.empty-ghost__asterisk')
    expect(asterisk?.tagName.toLowerCase()).toBe('svg')
    expect(asterisk).toHaveAttribute('x', '44')
    expect(asterisk).toHaveAttribute('y', '30')
    expect(asterisk).toHaveAttribute('width', '16')
    expect(asterisk).toHaveAttribute('height', '16')
    expect(asterisk).toHaveAttribute('viewBox', '0 0 24 24')
  })

  it('creates exactly one note at the established origin from the keyboard', async () => {
    const user = userEvent.setup()
    render(<EmptyState />)

    await user.tab()
    expect(screen.getByRole('button', { name: words.addNote })).toHaveFocus()
    await user.keyboard('{Enter}')

    const cards = useGraph.getState().cards
    expect(cards).toHaveLength(1)
    expect(cards[0]).toMatchObject({ kind: 'note', position: { x: 0, y: 0 } })
    expect(screen.queryByRole('region', { name: words.emptyTitle })).not.toBeInTheDocument()
  })

  it('stays absent as soon as the board contains a card', () => {
    resetCards([EXISTING_NOTE])
    render(<EmptyState />)

    expect(screen.queryByRole('region', { name: words.emptyTitle })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: words.addNote })).not.toBeInTheDocument()
  })
})
