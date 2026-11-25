// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { ReactFlowProvider, type NodeProps } from '@xyflow/react'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../../graph/store'
import type { Card } from '../../graph/types'
import { createSeedMod } from '../../mods'
import { modChromeWords } from '../../shared/words'
import { OverlayProvider } from '../../ui/overlays'
import { ModCard } from './ModCard'

const modCard: Card = {
  id: 'mod-card',
  kind: 'mod',
  blocks: [{ id: 'mod-block', text: '' }],
  position: { x: 120, y: 80 },
  modV2: createSeedMod('slider', {
    title: 'Intensity',
    createId: (_, ordinal) => `slider-part-${ordinal}`,
  }),
}

function renderCard(onModFaceGestureChange = vi.fn(), selected = true) {
  const props = {
    id: modCard.id,
    selected,
    data: { selectedCardCount: selected ? 1 : 0, onModFaceGestureChange },
  } as unknown as NodeProps
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  return {
    ...render(
      <OverlayProvider>
        <ReactFlowProvider>
          <ModCard {...props} />
        </ReactFlowProvider>
      </OverlayProvider>,
      { container: appRoot },
    ),
    onModFaceGestureChange,
  }
}

describe('production v2 Mod card', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [structuredClone(modCard)],
      connections: [],
      outputs: [],
      runs: [],
      intentLog: [],
      lastBoardChange: null,
      boardChangeSeq: 0,
      selection: { kind: 'card', id: modCard.id },
      selectedCardIds: [modCard.id],
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
    document.body.replaceChildren()
  })

  it('mounts the registered imperative face', () => {
    const { container } = renderCard()

    expect(container.querySelector('.mod-face-host')).toHaveAttribute('data-mod-face-kind', 'slider')
  })

  it('keeps unselected chrome closed and lets the first click bubble to Board selection', async () => {
    const user = userEvent.setup()
    const { container } = renderCard(vi.fn(), false)
    const card = container.querySelector('.card')!
    const bubbled = vi.fn()
    card.addEventListener('click', bubbled)

    await user.click(screen.getByRole('button', { name: modChromeWords.settings }))
    await user.click(screen.getByRole('button', { name: modChromeWords.context }))
    await user.click(screen.getByRole('button', { name: modChromeWords.colour }))

    expect(screen.queryByRole('dialog', { name: modChromeWords.settings })).not.toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: modChromeWords.context })).not.toBeInTheDocument()
    expect(bubbled).toHaveBeenCalledTimes(3)
    expect(useGraph.getState().undoStack).toHaveLength(0)
  })

  it('commits an inline title rename as one undoable Mod change', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: modChromeWords.title }))
    const editor = screen.getByRole('textbox', { name: modChromeWords.title })
    await user.clear(editor)
    await user.type(editor, 'Precision')
    await user.keyboard('{Enter}')

    expect(useGraph.getState().cards[0]?.modV2?.title).toBe('Precision')
    expect(useGraph.getState().undoStack).toHaveLength(1)
  })

  it('cancels an inline title rename on Escape without creating undo history', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: modChromeWords.title }))
    const editor = screen.getByRole('textbox', { name: modChromeWords.title })
    await user.clear(editor)
    await user.type(editor, 'Discard me')
    await user.keyboard('{Escape}')

    expect(useGraph.getState().cards[0]?.modV2?.title).toBe('Intensity')
    expect(useGraph.getState().undoStack).toHaveLength(0)
    expect(screen.getByRole('button', { name: modChromeWords.title })).toHaveTextContent('Intensity')
  })

  it('shows the shared prompt projection and commits treatment editing on close', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: modChromeWords.context }))
    const dialog = screen.getByRole('dialog', { name: modChromeWords.context })
    expect(dialog).toHaveTextContent('How to read it')
    expect(dialog.querySelectorAll('li').length).toBeGreaterThan(0)
  })

  it('mounts definition-owned gear settings and commits one undo step', async () => {
    const user = userEvent.setup()
    renderCard()

    await user.click(screen.getByRole('button', { name: modChromeWords.settings }))
    const dialog = screen.getByRole('dialog', { name: modChromeWords.settings })
    // The reference gear: a Name field leads, and Stops is the − / + stepper.
    expect(within(dialog).getByRole('textbox', { name: modChromeWords.name })).toBeInTheDocument()
    const more = () => within(dialog).getByRole('button', { name: 'More stops' })
    await user.click(more())
    expect(more()).toHaveFocus()
    await user.click(more())

    const committed = useGraph.getState().cards[0]?.modV2
    expect(committed?.kind === 'slider' && committed.state.steps).toBe(3)
    expect(useGraph.getState().undoStack).toHaveLength(2)
  })
})
