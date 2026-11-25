// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { StrictMode, useRef, useState, type ReactNode } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from '../primitives'
import { ModalShell, OverlayProvider } from './index'

afterEach(() => {
  vi.useRealTimers()
  cleanup()
  document.body.replaceChildren()
})

function NestedOverlayJourney() {
  const [parentOpen, setParentOpen] = useState(false)
  const [childOpen, setChildOpen] = useState(false)
  const parentInitialRef = useRef<HTMLButtonElement>(null)
  const childInitialRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <Button onClick={() => setParentOpen(true)}>Open parent</Button>
      {parentOpen && (
        <ModalShell
          open
          title="Parent dialog"
          dismissOnBackdrop={false}
          initialFocusRef={parentInitialRef}
          onDismiss={() => setParentOpen(false)}
        >
          <Button ref={parentInitialRef} onClick={() => setChildOpen(true)}>
            Open child
          </Button>
          {childOpen && (
            <ModalShell
              open
              title="Child dialog"
              dismissOnBackdrop={false}
              initialFocusRef={childInitialRef}
              onDismiss={() => setChildOpen(false)}
            >
              <Button ref={childInitialRef}>Child action</Button>
            </ModalShell>
          )}
        </ModalShell>
      )}
    </>
  )
}

function KeyboardOverlayJourney({ dismissOnBackdrop }: { dismissOnBackdrop: boolean }) {
  const [open, setOpen] = useState(false)
  const firstRef = useRef<HTMLButtonElement>(null)

  return (
    <>
      <Button onClick={() => setOpen(true)}>Open keyboard dialog</Button>
      {open && (
        <ModalShell
          open
          title="Keyboard dialog"
          dismissOnBackdrop={dismissOnBackdrop}
          initialFocusRef={firstRef}
          onDismiss={() => setOpen(false)}
        >
          <Button ref={firstRef}>First action</Button>
          <Button>Last action</Button>
        </ModalShell>
      )}
    </>
  )
}

function ExitJourney({ onExitComplete }: { onExitComplete: () => void }) {
  const [present, setPresent] = useState(false)
  const [open, setOpen] = useState(false)
  const initialRef = useRef<HTMLButtonElement>(null)
  return (
    <>
      <Button onClick={() => {
        setPresent(true)
        setOpen(true)
      }}>
        Open exiting dialog
      </Button>
      {present && <ModalShell
        open={open}
        title="Exiting dialog"
        dismissOnBackdrop={false}
        initialFocusRef={initialRef}
        onDismiss={() => setOpen(false)}
        onExitComplete={() => {
          setPresent(false)
          onExitComplete()
        }}
      >
        <Button ref={initialRef}>Exiting action</Button>
      </ModalShell>}
    </>
  )
}

function PortalEventJourney({
  onAncestorPointerDown,
  onAncestorClick,
  onInternalClick,
  onDismiss,
}: {
  onAncestorPointerDown: () => void
  onAncestorClick: () => void
  onInternalClick: () => void
  onDismiss: (reason: string) => void
}) {
  return (
    <div onPointerDown={onAncestorPointerDown} onClick={onAncestorClick}>
      <ModalShell
        open
        title="Contained portal dialog"
        dismissOnBackdrop
        onDismiss={onDismiss}
      >
        <Button onClick={onInternalClick}>Internal control</Button>
      </ModalShell>
    </div>
  )
}

function renderInApp(children: ReactNode) {
  const appRoot = document.createElement('div')
  appRoot.id = 'root'
  document.body.append(appRoot)
  return {
    appRoot,
    ...render(<StrictMode><OverlayProvider>{children}</OverlayProvider></StrictMode>, {
      container: appRoot,
    }),
  }
}

describe('overlay contract rendered outcomes', () => {
  it('keeps nested surfaces mounted while topmost Escape and focus return unwind the stack', async () => {
    const { appRoot } = renderInApp(<NestedOverlayJourney />)

    const parentInvoker = screen.getByRole('button', { name: 'Open parent' })
    parentInvoker.focus()
    fireEvent.click(parentInvoker)

    const parentAction = await screen.findByRole('button', { name: 'Open child' })
    expect(parentAction).toHaveFocus()
    expect(appRoot).toHaveAttribute('inert')
    expect(document.querySelector('#eido-overlay-root')).toBe(appRoot.nextElementSibling)

    fireEvent.click(parentAction)

    const childAction = await screen.findByRole('button', { name: 'Child action' })
    expect(childAction).toHaveFocus()
    expect(screen.getAllByRole('dialog', { hidden: true })).toHaveLength(2)
    expect(screen.getByRole('dialog', { name: 'Parent dialog', hidden: true }).parentElement)
      .toHaveAttribute('inert')

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Child dialog' })).toBeNull())
    expect(screen.getByRole('dialog', { name: 'Parent dialog' })).toBeInTheDocument()
    await waitFor(() => expect(parentAction).toHaveFocus())

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(parentInvoker).toHaveFocus())
    expect(appRoot).not.toHaveAttribute('inert')
  })

  it('wraps modal Tab focus and keeps a non-dismissing backdrop explicit', async () => {
    renderInApp(<KeyboardOverlayJourney dismissOnBackdrop={false} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open keyboard dialog' }))

    const dialog = await screen.findByRole('dialog', { name: 'Keyboard dialog' })
    const close = screen.getByRole('button', { name: 'Close' })
    const first = screen.getByRole('button', { name: 'First action' })
    const last = screen.getByRole('button', { name: 'Last action' })
    expect(first).toHaveFocus()

    last.focus()
    fireEvent.keyDown(last, { key: 'Tab' })
    expect(close).toHaveFocus()

    close.focus()
    fireEvent.keyDown(close, { key: 'Tab', shiftKey: true })
    expect(last).toHaveFocus()

    fireEvent.pointerDown(dialog.parentElement!)
    expect(dialog).toBeInTheDocument()
  })

  it('dismisses only when the top backdrop opts in', async () => {
    renderInApp(<KeyboardOverlayJourney dismissOnBackdrop />)
    const invoker = screen.getByRole('button', { name: 'Open keyboard dialog' })
    invoker.focus()
    fireEvent.click(invoker)

    const dialog = await screen.findByRole('dialog', { name: 'Keyboard dialog' })
    fireEvent.pointerDown(dialog.parentElement!)

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    await waitFor(() => expect(invoker).toHaveFocus())
  })

  it('contains backdrop and surface pointer/click events inside the portal owner', async () => {
    const onAncestorPointerDown = vi.fn()
    const onAncestorClick = vi.fn()
    const onInternalClick = vi.fn()
    const onDismiss = vi.fn()
    renderInApp(
      <PortalEventJourney
        onAncestorPointerDown={onAncestorPointerDown}
        onAncestorClick={onAncestorClick}
        onInternalClick={onInternalClick}
        onDismiss={onDismiss}
      />,
    )

    const dialog = await screen.findByRole('dialog', { name: 'Contained portal dialog' })
    const backdrop = dialog.parentElement!
    fireEvent.pointerDown(backdrop)
    fireEvent.click(backdrop)
    expect(onDismiss).toHaveBeenCalledWith('backdrop')
    expect(onAncestorPointerDown).not.toHaveBeenCalled()
    expect(onAncestorClick).not.toHaveBeenCalled()

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Internal control' }))
    fireEvent.click(screen.getByRole('button', { name: 'Internal control' }))
    expect(onInternalClick).toHaveBeenCalledOnce()
    expect(onAncestorPointerDown).not.toHaveBeenCalled()
    expect(onAncestorClick).not.toHaveBeenCalled()
  })

  it('keeps an inert logical exit registered until its own opacity beat retires it', async () => {
    const onExitComplete = vi.fn()
    const { appRoot } = renderInApp(<ExitJourney onExitComplete={onExitComplete} />)
    const invoker = screen.getByRole('button', { name: 'Open exiting dialog' })
    invoker.focus()
    fireEvent.click(invoker)

    const dialog = await screen.findByRole('dialog', { name: 'Exiting dialog' })
    const backdrop = dialog.parentElement!
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(backdrop).toHaveAttribute('data-state', 'exiting')
    expect(backdrop).toHaveAttribute('inert')
    expect(appRoot).toHaveAttribute('inert')
    expect(invoker).not.toHaveFocus()
    expect(onExitComplete).not.toHaveBeenCalled()

    fireEvent.transitionEnd(dialog, { propertyName: 'opacity' })
    expect(backdrop).toBeInTheDocument()
    fireEvent.transitionEnd(backdrop, { propertyName: 'transform' })
    expect(backdrop).toBeInTheDocument()
    fireEvent.transitionEnd(backdrop, { propertyName: 'opacity' })

    await waitFor(() => expect(backdrop).not.toBeInTheDocument())
    await waitFor(() => expect(appRoot).not.toHaveAttribute('inert'))
    await waitFor(() => expect(invoker).toHaveFocus())
    expect(onExitComplete).toHaveBeenCalledOnce()
  })

  it('retires an exiting StrictMode modal through the deterministic fallback', async () => {
    vi.useFakeTimers()
    const onExitComplete = vi.fn()
    renderInApp(<ExitJourney onExitComplete={onExitComplete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Open exiting dialog' }))
    expect(screen.getByRole('dialog', { name: 'Exiting dialog' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(document.querySelector('.e-overlay-backdrop')).toHaveAttribute(
      'data-state',
      'exiting',
    )
    act(() => vi.advanceTimersByTime(500))
    expect(document.querySelector('.e-overlay-backdrop')).toBeNull()
    expect(onExitComplete).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })
})
