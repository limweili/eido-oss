// @vitest-environment jsdom

import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../../graph/store'
import { cardTextFromBlocks } from '../../graph/graphHelpers'
import { renderMarkdown } from '../../shared/markdown'
import type { Card } from '../../graph/types'
import { OverlayProvider } from '../../ui/overlays'
import { NoteCard } from './NoteCard'

vi.mock('../../shared/markdown', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../shared/markdown')>()
  return {
    ...actual,
    renderMarkdown: vi.fn(() => '<p>passive body</p>'),
  }
})

vi.mock('./MarkdownCardEditor', () => ({
  MarkdownCardEditor: ({
    markdown,
    onChange,
  }: {
    markdown: string
    onChange: (markdown: string) => void
  }) => <button onClick={() => onChange(`${markdown}!`)}>type in editor</button>,
}))

const LARGE_MARKDOWN = `start ${'large body '.repeat(60_000)}`
const noteCard: Card = {
  id: 'large-editor-echo-note',
  kind: 'note',
  blocks: [{ id: 'large-editor-echo-note-block', text: LARGE_MARKDOWN }],
  position: { x: 120, y: 80 },
  size: { width: 406, height: 338 },
}

function renderNote() {
  const props = {
    id: noteCard.id,
    selected: true,
    data: { selectedCardCount: 1 },
  } as unknown as NodeProps
  return render(
    <OverlayProvider>
      <ReactFlowProvider>
        <NoteCard {...props} />
      </ReactFlowProvider>
    </OverlayProvider>,
  )
}

describe('NoteCard Live editor Graph echo', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [structuredClone(noteCard)],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      lastBoardChange: null,
      boardChangeSeq: 0,
      selection: { kind: 'card', id: noteCard.id },
      selectedCardIds: [noteCard.id],
      undoStack: [],
      redoStack: [],
      saveState: 'saved',
      hydrated: false,
      currentIdeaId: null,
      activeTool: 'select',
    })
  })

  afterEach(() => {
    cleanup()
    vi.mocked(renderMarkdown).mockClear()
  })

  it('updates the in-memory Graph without rebuilding the hidden passive body', () => {
    const { container } = renderNote()
    expect(renderMarkdown).toHaveBeenCalledTimes(1)
    const passiveBody = container.querySelector<HTMLElement>('.note-render.markdown')!
    fireEvent.pointerDown(passiveBody, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 24,
      clientY: 24,
    })
    fireEvent.pointerUp(window, {
      pointerId: 1,
      pointerType: 'mouse',
      button: 0,
      clientX: 24,
      clientY: 24,
    })
    fireEvent.click(passiveBody, { clientX: 24, clientY: 24 })

    fireEvent.click(screen.getByRole('button', { name: 'type in editor' }))

    const stored = useGraph.getState().graph().cardById(noteCard.id)
    expect(cardTextFromBlocks(stored?.blocks ?? []).length).toBe(LARGE_MARKDOWN.length + 1)
    expect(renderMarkdown).toHaveBeenCalledTimes(1)
  })
})
