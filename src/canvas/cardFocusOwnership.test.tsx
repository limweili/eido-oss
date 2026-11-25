// @vitest-environment jsdom

import { useState } from 'react'
import { createPortal } from 'react-dom'
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { useCardFocusOwnership } from './cardInteraction'
import { focusCardWhenMounted } from './cardAccessibility'

afterEach(cleanup)

function Card({ cardId, autoFocusFirst = false }: { cardId: string; autoFocusFirst?: boolean }) {
  return (
    <div className="react-flow__node" data-id={cardId} tabIndex={0} role="group" aria-label={`${cardId} Card`}>
      <button type="button" autoFocus={autoFocusFirst}>{cardId} first</button>
      <button type="button">{cardId} second</button>
    </div>
  )
}

function FocusOwnershipHarness({
  activationRemount = false,
  cardAInstance = 'stable',
  showCardA = true,
  showCardB = true,
  replacementAutoFocus = false,
  nestedForeignBoard = false,
  portalHost = null,
}: {
  activationRemount?: boolean
  cardAInstance?: string
  showCardA?: boolean
  showCardB?: boolean
  replacementAutoFocus?: boolean
  nestedForeignBoard?: boolean
  portalHost?: Element | null
}) {
  const [activationCardId, setActivationCardId] = useState<string | null>(null)
  const { focusedCardId, claimFocusedCard, releaseFocusedCard } = useCardFocusOwnership({
    onFocusOwnershipLost: (cardId) => {
      setActivationCardId((current) => (current === cardId ? null : current))
    },
  })
  const cardAKey = activationRemount && activationCardId === 'card-a' ? 'live' : cardAInstance

  return (
    <>
      <div
        className="board-flow"
        data-testid="board"
        tabIndex={-1}
        role="region"
        aria-label="Board"
        data-focused-card-id={focusedCardId ?? ''}
        data-activation-card-id={activationCardId ?? ''}
        onFocusCapture={(event) => {
          const cardId = claimFocusedCard(event.target, event.currentTarget)
          if (cardId) setActivationCardId(cardId)
        }}
        onBlurCapture={(event) => releaseFocusedCard(event.target, event.relatedTarget, event.currentTarget)}
      >
        {showCardA ? <Card key={cardAKey} cardId="card-a" autoFocusFirst={replacementAutoFocus} /> : null}
        {showCardB ? <Card cardId="card-b" /> : null}
        {nestedForeignBoard ? (
          <div className="board-flow" data-testid="nested-foreign-board">
            <Card cardId="card-a" />
          </div>
        ) : null}
        <button type="button">board chrome</button>
        {portalHost ? createPortal(
          <div className="board-flow">
            <div className="react-flow__node" data-id="card-a">
              <button type="button">portal card-a</button>
            </div>
          </div>,
          portalHost,
        ) : null}
      </div>
      <button type="button">outside board</button>
    </>
  )
}

function focusedCardId() {
  return screen.getByTestId('board').getAttribute('data-focused-card-id')
}

function activationCardId() {
  return screen.getByTestId('board').getAttribute('data-activation-card-id')
}

describe('Board Card focus ownership', () => {
  it('focuses an exact Card only after it mounts, then recovers the Board if that focused Card disappears', async () => {
    const onFocused: string[] = []
    const view = render(<FocusOwnershipHarness showCardA={false} />)
    const board = screen.getByTestId('board')
    const source = screen.getByRole('button', { name: 'outside board' })
    act(() => source.focus())

    const stop = focusCardWhenMounted(board, 'card-a', () => onFocused.push('card-a'))
    expect(document.activeElement).toBe(source)

    view.rerender(<FocusOwnershipHarness />)
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByRole('group', { name: 'card-a Card' }))
      expect(focusedCardId()).toBe('card-a')
      expect(onFocused).toEqual(['card-a'])
    })

    view.rerender(<FocusOwnershipHarness showCardA={false} />)
    await waitFor(() => {
      expect(document.activeElement).toBe(board)
      expect(focusedCardId()).toBe('')
    })
    stop()

    view.rerender(<FocusOwnershipHarness showCardA={false} showCardB={false} />)
    act(() => source.focus())
    const stopSuperseded = focusCardWhenMounted(board, 'card-b', () => onFocused.push('card-b'))
    const boardChrome = screen.getByRole('button', { name: 'board chrome' })
    act(() => boardChrome.focus())
    view.rerender(<FocusOwnershipHarness showCardA={false} />)
    await act(async () => undefined)

    expect(document.activeElement).toBe(boardChrome)
    expect(onFocused).toEqual(['card-a'])
    stopSuperseded()
  })

  it('clears focus ownership when activation remounts the focused Card', async () => {
    render(<FocusOwnershipHarness activationRemount />)

    const focusedButton = screen.getByRole('button', { name: 'card-a first' })
    act(() => focusedButton.focus())

    await waitFor(() => {
      expect(document.activeElement).not.toBe(focusedButton)
      expect(focusedCardId()).toBe('')
      expect(activationCardId()).toBe('')
    })
  })

  it('keeps ownership while focus moves inside one Card and transfers it between Cards', () => {
    render(<FocusOwnershipHarness />)

    act(() => screen.getByRole('button', { name: 'card-a first' }).focus())
    expect(focusedCardId()).toBe('card-a')
    act(() => screen.getByRole('button', { name: 'card-a second' }).focus())
    expect(focusedCardId()).toBe('card-a')
    act(() => screen.getByRole('button', { name: 'card-b first' }).focus())
    expect(focusedCardId()).toBe('card-b')
  })

  it('clears ownership when focus leaves for Board chrome or outside the Board', () => {
    render(<FocusOwnershipHarness />)

    act(() => screen.getByRole('button', { name: 'card-a first' }).focus())
    act(() => screen.getByRole('button', { name: 'board chrome' }).focus())
    expect(focusedCardId()).toBe('')

    act(() => screen.getByRole('button', { name: 'card-b first' }).focus())
    act(() => screen.getByRole('button', { name: 'outside board' }).focus())
    expect(focusedCardId()).toBe('')
  })

  it('clears ownership when a focused Card is removed or remounted', async () => {
    const view = render(<FocusOwnershipHarness />)

    act(() => screen.getByRole('button', { name: 'card-a first' }).focus())
    expect(focusedCardId()).toBe('card-a')
    view.rerender(<FocusOwnershipHarness cardAInstance="replacement" />)
    await waitFor(() => {
      expect(focusedCardId()).toBe('')
      expect(activationCardId()).toBe('')
    })

    view.rerender(<FocusOwnershipHarness />)
    act(() => screen.getByRole('button', { name: 'card-a first' }).focus())
    expect(focusedCardId()).toBe('card-a')
    view.rerender(<FocusOwnershipHarness showCardA={false} />)
    await waitFor(() => {
      expect(focusedCardId()).toBe('')
      expect(activationCardId()).toBe('')
    })
  })

  it('does not transfer ownership to an auto-focused replacement with the same Card id', async () => {
    const view = render(<FocusOwnershipHarness />)

    const original = screen.getByRole('button', { name: 'card-a first' })
    act(() => original.focus())
    expect(focusedCardId()).toBe('card-a')
    const suppressReplacementRecapture = (event: FocusEvent) => event.stopPropagation()
    document.addEventListener('focusin', suppressReplacementRecapture, { capture: true, once: true })
    view.rerender(
      <FocusOwnershipHarness cardAInstance="replacement" replacementAutoFocus />,
    )
    document.removeEventListener('focusin', suppressReplacementRecapture, { capture: true })

    await waitFor(() => {
      expect(document.activeElement).not.toBe(original)
      expect(focusedCardId()).toBe('')
      expect(activationCardId()).toBe('')
    })
  })

  it('rejects a nested foreign Board even when its Card id matches', () => {
    render(<FocusOwnershipHarness nestedForeignBoard />)

    const nestedBoard = screen.getByTestId('nested-foreign-board')
    act(() => within(nestedBoard).getByRole('button', { name: 'card-a first' }).focus())

    expect(focusedCardId()).toBe('')
    expect(activationCardId()).toBe('')
  })

  it('rejects a portal Card outside the exact Board root', () => {
    const portalHost = document.createElement('div')
    document.body.append(portalHost)
    const view = render(<FocusOwnershipHarness portalHost={portalHost} />)

    act(() => screen.getByRole('button', { name: 'portal card-a' }).focus())

    expect(focusedCardId()).toBe('')
    expect(activationCardId()).toBe('')
    view.unmount()
    portalHost.remove()
  })
})
