// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { ReactFlowProvider } from '@xyflow/react'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGraph } from '../graph/store'
import { createSeedMod } from '../mods'
import { words } from '../shared/words'
import { OverlayProvider } from '../ui/overlays'
import { BottomDock } from './BottomDock'

function renderDock() {
  return render(
    <OverlayProvider>
      <ReactFlowProvider>
        <BottomDock />
      </ReactFlowProvider>
    </OverlayProvider>,
  )
}

describe('Bottom dock', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      hydrated: false,
      activeTool: 'select',
    })
  })

  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('orders persistent tools by reach without moving undo and redo ahead of creation', () => {
    renderDock()

    const toolbox = screen.getByRole('toolbar', { name: words.toolbox })
    expect(within(toolbox).getByRole('button', { name: 'Move' })).toBeInTheDocument()
    expect(within(toolbox).getAllByRole('button').map(button => button.getAttribute('aria-label'))).toEqual([
      words.toolSelect,
      words.toolPan,
      words.toolHighlighter,
      words.addNote,
      words.askAi,
      words.addConversation,
      words.addMod,
      words.addTitle,
      words.undo,
      words.redo,
    ])
  })

  it('unfolds contextual actions from the same stack without replacing the persistent bar', () => {
    renderDock()

    const toolbox = screen.getByRole('toolbar', { name: words.toolbox })
    const hiddenTray = document.querySelector(`[aria-label="${words.selectedCardActions}"]`)
    expect(hiddenTray).toHaveAttribute('role', 'toolbar')
    expect(hiddenTray).toHaveAttribute('aria-hidden', 'true')

    let cardId = ''
    act(() => {
      cardId = useGraph.getState().addCard('note', { x: 120, y: 120 })
      useGraph.setState({
        selection: { kind: 'card', id: cardId },
        selectedCardIds: [cardId],
      })
    })

    const tray = screen.getByRole('toolbar', { name: words.selectedCardActions })
    expect(screen.getByRole('toolbar', { name: words.toolbox })).toBe(toolbox)
    expect(tray).not.toHaveAttribute('aria-hidden')
    expect(tray.parentElement).toBe(toolbox.parentElement)
    expect(tray.nextElementSibling).toBe(toolbox)
    expect(within(tray).getByRole('button', { name: words.duplicateCard })).toBeInTheDocument()
    expect(within(toolbox).queryByRole('button', { name: words.duplicateCard })).toBeNull()

    act(() => {
      useGraph.setState({ selection: null, selectedCardIds: [] })
    })
    expect(tray).toHaveAttribute('aria-hidden', 'true')
    expect(within(tray).getByRole('button', { name: words.duplicateCard, hidden: true }))
      .toBeInTheDocument()
  })

  it('uses design-system dock keys with intent-delayed shortcut tooltips', () => {
    vi.useFakeTimers()
    renderDock()

    const select = screen.getByRole('button', { name: words.toolSelect })
    expect(select).toHaveClass('e-dock-key')
    expect(select).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: words.toolPan })).toHaveAttribute('aria-pressed', 'false')
    expect(select).not.toHaveAttribute('title')
    // Every key in the bar fires on click; only the three canvas tools hold a
    // state. Add note is a creator, so it wears the quiet key, never go.
    const addNote = screen.getByRole('button', { name: words.addNote })
    expect(addNote).toHaveClass('e-button--quiet')
    expect(addNote).not.toHaveClass('e-button--primary')
    expect(addNote).not.toHaveAttribute('aria-pressed')
    const undo = screen.getByRole('button', { name: words.undo })
    expect(undo).toBeDisabled()
    expect(undo).not.toHaveAttribute('aria-pressed')

    fireEvent.pointerEnter(select)
    act(() => vi.advanceTimersByTime(599))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('tooltip')).toHaveTextContent('SELECT · V')

    fireEvent.pointerLeave(select)
    const move = screen.getByRole('button', { name: words.toolPan })
    fireEvent.pointerEnter(move)
    act(() => vi.advanceTimersByTime(600))
    expect(screen.getByRole('tooltip').querySelector('.shortcut-spacebar-icon')).toHaveAccessibleName(words.spacebar)
  })

  it('retires open contextual menus when the tray closes without collapsing its keys', async () => {
    const user = userEvent.setup()
    useGraph.getState().addCard('group', { x: 400, y: 400 })
    const cardId = useGraph.getState().addCard('note', { x: 120, y: 120 })
    useGraph.setState({
      selection: { kind: 'card', id: cardId },
      selectedCardIds: [cardId],
    })
    renderDock()

    const tray = screen.getByRole('toolbar', { name: words.selectedCardActions })
    await user.click(within(tray).getByRole('button', { name: words.notInGroup }))
    expect(screen.getByRole('menu', { name: words.groupMode })).toBeInTheDocument()

    act(() => useGraph.setState({ selection: null, selectedCardIds: [] }))

    expect(tray).toHaveAttribute('aria-hidden', 'true')
    await waitFor(() => expect(document.querySelector('.dock-popover')).toBeNull())
    expect(within(tray).getByRole('button', { name: words.duplicateCard, hidden: true }))
      .toBeInTheDocument()
  })

  it('deletes a captured group target only after the shared confirmation resolves', async () => {
    const user = userEvent.setup()
    const memberId = useGraph.getState().addCard('note', { x: 80, y: 80 })
    const groupId = useGraph.getState().addCard('group', { x: 40, y: 40 })
    useGraph.getState().addCardToGroup(memberId, groupId)
    useGraph.setState({
      selection: { kind: 'card', id: groupId },
      selectedCardIds: [groupId],
    })
    renderDock()

    const deleteGroup = screen.getByRole('button', { name: words.deleteGroup })
    await user.click(deleteGroup)
    const cancelledDialog = await screen.findByRole('dialog', { name: words.deleteGroup })
    expect(cancelledDialog).toHaveTextContent(words.deleteGroupConfirm)
    expect(useGraph.getState().cards.some(card => card.id === groupId)).toBe(true)

    await user.click(within(cancelledDialog).getByRole('button', { name: words.cancel }))
    fireEvent.transitionEnd(cancelledDialog.parentElement!, { propertyName: 'opacity' })
    await waitFor(() => expect(screen.queryByRole('dialog', { name: words.deleteGroup })).toBeNull())
    expect(useGraph.getState().cards.some(card => card.id === groupId)).toBe(true)

    await user.click(deleteGroup)
    const confirmedDialog = await screen.findByRole('dialog', { name: words.deleteGroup })
    await user.click(within(confirmedDialog).getByRole('button', { name: words.deleteGroup }))
    fireEvent.transitionEnd(confirmedDialog.parentElement!, { propertyName: 'opacity' })

    await waitFor(() => expect(useGraph.getState().cards.some(card => card.id === groupId)).toBe(false))
    expect(useGraph.getState().cards.find(card => card.id === memberId)?.groupId).toBeUndefined()
  })

  it('keeps tool controls and keyboard shortcuts mapped to graph-store outcomes', async () => {
    const user = userEvent.setup()
    renderDock()

    await user.click(screen.getByRole('button', { name: words.toolPan }))
    expect(useGraph.getState().activeTool).toBe('pan')

    fireEvent.keyDown(window, { key: 'h' })
    expect(useGraph.getState().activeTool).toBe('highlight')

    fireEvent.keyDown(window, { code: 'Space', key: ' ' })
    expect(useGraph.getState().activeTool).toBe('pan')
    expect(screen.getByRole('button', { name: words.toolPan })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.keyUp(window, { key: 'h' })
    expect(useGraph.getState().activeTool).toBe('pan')
    fireEvent.keyUp(window, { code: 'Space', key: ' ' })
    expect(useGraph.getState().activeTool).toBe('highlight')

    const before = useGraph.getState().cards.length
    fireEvent.keyDown(window, { key: 'n' })
    expect(useGraph.getState().activeTool).toBe('select')
    expect(useGraph.getState().cards).toHaveLength(before + 1)
    const cards = useGraph.getState().cards
    expect(cards[cards.length - 1]?.kind).toBe('note')

    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    fireEvent.keyDown(field, { code: 'Space', key: ' ' })
    expect(useGraph.getState().activeTool).toBe('select')
    field.remove()
  })

  it('keeps selection grouping wired through the contextual tray', async () => {
    const user = userEvent.setup()
    const firstId = useGraph.getState().addCard('note', { x: 40, y: 40 })
    const secondId = useGraph.getState().addCard('askAi', { x: 240, y: 40 })
    useGraph.setState({ selection: null, selectedCardIds: [firstId, secondId] })
    renderDock()

    await user.click(screen.getByRole('button', { name: words.groupSelection }))

    const group = useGraph.getState().cards.find(card => card.kind === 'group')
    expect(group).toBeDefined()
    expect(useGraph.getState().cards.find(card => card.id === firstId)?.groupId).toBe(group?.id)
    expect(useGraph.getState().cards.find(card => card.id === secondId)?.groupId).toBe(group?.id)
  })
})

describe('Mod library menu', () => {
  beforeEach(() => {
    useGraph.setState({
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
      selection: null,
      selectedCardIds: [],
      undoStack: [],
      redoStack: [],
      hydrated: false,
      activeTool: 'select',
      settings: {
        ...useGraph.getState().settings,
        profileModLibrary: [
          {
            templateId: 'saved-library-mod',
            mod: createSeedMod('switch', {
              title: 'MY FOCUS MOD',
              createId: (_, ordinal) => `saved-switch-${ordinal}`,
            }),
          },
        ],
      },
    })
  })

  afterEach(cleanup)

  it('lists one plain row per kind plus saved Mods and stamps a detached v2 Mod', async () => {
    // The menu is the reference's minimal add-mod list: kind rows only — no
    // Blank Mod entry, no built-in callouts, no per-row add buttons.
    const user = userEvent.setup()
    renderDock()

    await user.click(screen.getByRole('button', { name: words.addMod }))
    const library = screen.getByRole('menu', { name: words.modLibrary })
    expect(library).not.toHaveTextContent(/template|instance|built-in|blank|add from/i)

    const rows = within(library).getAllByRole('menuitem')
    // Built-ins wear their kind name; the user's own saved Mods keep theirs.
    expect(rows.map((row) => row.textContent)).toEqual([
      'MIXER', 'FILTER', 'SLIDER', 'DIAL', 'COUNT', 'SWITCH',
      'PAD', 'SELECT', 'ORDER', 'RADAR', 'MATRIX',
      'MY FOCUS MOD',
    ])

    await user.click(within(library).getByRole('menuitem', { name: 'SELECT' }))
    const stamped = useGraph.getState().cards[0]?.modV2
    expect(stamped).toMatchObject({ kind: 'select', title: 'AUDIENCE' })
    expect(useGraph.getState().cards[0]).not.toHaveProperty('mod')

    await user.click(screen.getByRole('button', { name: words.addMod }))
    const reopened = screen.getByRole('menu', { name: words.modLibrary })
    await user.click(within(reopened).getByRole('menuitem', { name: 'MY FOCUS MOD' }))
    expect(useGraph.getState().cards[1]?.modV2).toMatchObject({
      kind: 'switch',
      title: 'MY FOCUS MOD',
    })
  })

  it('sizes planar wells generously when added from the menu', async () => {
    const user = userEvent.setup()
    renderDock()

    await user.click(screen.getByRole('button', { name: words.addMod }))
    await user.click(screen.getByRole('menuitem', { name: 'RADAR' }))
    expect(useGraph.getState().cards[0]?.size).toEqual({ width: 400, height: 350 })

    await user.click(screen.getByRole('button', { name: words.addMod }))
    await user.click(screen.getByRole('menuitem', { name: 'PAD' }))
    expect(useGraph.getState().cards[1]?.size).toEqual({ width: 400, height: 350 })

    await user.click(screen.getByRole('button', { name: words.addMod }))
    await user.click(screen.getByRole('menuitem', { name: 'SLIDER' }))
    expect(useGraph.getState().cards[2]?.size).toBeUndefined()
  })
})
