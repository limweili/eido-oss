// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SemanticBoard } from '../graph/boardSemantics'
import { BOARD_SEARCH_PAGE_SIZE, BoardSearchPanel } from './BoardSearchPanel'

const board: SemanticBoard = {
  cards: [
    ...Array.from({ length: BOARD_SEARCH_PAGE_SIZE }, (_, index) => ({
      id: `visible-${index}`,
      kind: 'note' as const,
      title: `Visible note ${index + 1}`,
      blocks: [{ id: `visible-${index}-body`, text: 'ordinary content' }],
      position: { x: index * 300, y: 0 },
    })),
    {
      id: 'offscreen',
      kind: 'note',
      title: 'Offscreen note',
      blocks: [{ id: 'offscreen-body', text: 'needle beyond the mounted residency window' }],
      position: { x: 100_000, y: 100_000 },
    },
  ],
  connections: [],
  outputs: [],
  runs: [],
}

afterEach(cleanup)

describe('BoardSearchPanel', () => {
  it('filters by durable creator and activates a filtered Card', () => {
    const agent = { kind: 'agent', client: 'codex', sessionId: 'agent-session' } as const
    const user = { kind: 'user', client: 'eido-desktop', sessionId: 'user-session' } as const
    const creatorBoard: SemanticBoard = {
      cards: [
        {
          id: 'agent-card',
          kind: 'note',
          title: 'AI-created note',
          blocks: [{ id: 'agent-body', text: 'shared text' }],
          position: { x: 50_000, y: 50_000 },
          createdBy: agent,
          lastModifiedBy: user,
        },
        {
          id: 'user-card',
          kind: 'note',
          title: 'User-created note',
          blocks: [{ id: 'user-body', text: 'shared text' }],
          position: { x: 0, y: 0 },
          createdBy: user,
          lastModifiedBy: user,
        },
        {
          id: 'legacy-card',
          kind: 'note',
          title: 'Legacy note',
          blocks: [{ id: 'legacy-body', text: 'shared text' }],
          position: { x: 300, y: 0 },
        },
      ],
      connections: [],
      outputs: [],
      runs: [],
    }
    const onActivate = vi.fn()
    const onClose = vi.fn()

    render(<BoardSearchPanel open board={creatorBoard} onActivate={onActivate} onClose={onClose} />)
    fireEvent.pointerDown(screen.getByRole('radio', { name: 'AI-created' }), {
      button: 0,
      pointerId: 1,
    })

    expect(screen.getByRole('button', { name: 'AI-created note' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'User-created note' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Legacy note' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'AI-created note' }))
    expect(onActivate).toHaveBeenCalledWith('agent-card')
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('shows only a clean title and visible body in each result card', () => {
    const body = 'ss Hello, how are you? Import data from Chrome'
    const conciseBoard: SemanticBoard = {
      cards: [{
        id: 'plain-note',
        kind: 'note',
        blocks: [{ id: 'plain-note-body', text: body }],
        position: { x: 0, y: 0 },
      }],
      connections: [],
      outputs: [],
      runs: [{
        id: 'note-run',
        startedAt: '2026-07-22T00:00:00.000Z',
        finishedAt: '2026-07-22T00:00:01.000Z',
        askAiCardId: 'plain-note',
        model: 'test/model',
        usedCardIds: [],
        usedConnectionIds: [],
        modIds: [],
        appliedMods: [],
        compiledInstruction: `${body} repeated provenance`,
        status: 'done',
      }],
    }

    render(
      <BoardSearchPanel open board={conciseBoard} onActivate={vi.fn()} onClose={vi.fn()} />,
    )

    const result = screen.getByRole('button', { name: 'Untitled note' })
    expect(within(result).getByText('Untitled note')).toBeInTheDocument()
    expect(within(result).getByText(body)).toBeInTheDocument()
    expect(within(result).queryByText('Note')).not.toBeInTheDocument()
    expect(within(result).queryByText(/repeated provenance/i)).not.toBeInTheDocument()
  })

  it('finds graph content outside mounted residency and activates its stable Card identity', () => {
    const onActivate = vi.fn()
    const onClose = vi.fn()
    const rendered = render(
      <BoardSearchPanel
        open
        board={board}
        onActivate={onActivate}
        onClose={onClose}
      />,
    )

    expect(rendered.container.querySelector('.mini-btn')).toBeNull()

    const firstWindow = screen.getByRole('list', { name: 'Board search results' })
    expect(within(firstWindow).getAllByRole('button')).toHaveLength(BOARD_SEARCH_PAGE_SIZE)
    expect(screen.queryByRole('button', { name: 'Offscreen note' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(screen.getByRole('button', { name: 'Offscreen note' })).toBeInTheDocument()

    fireEvent.change(screen.getByRole('searchbox', { name: 'Search this Board' }), {
      target: { value: 'mounted residency window' },
    })

    const result = screen.getByRole('button', { name: 'Offscreen note' })
    expect(screen.getByRole('list', { name: 'Board search results' })).toContainElement(result.closest('li'))
    fireEvent.click(result)
    expect(onActivate).toHaveBeenCalledWith('offscreen')
    expect(onClose).toHaveBeenCalledOnce()
  })
})
