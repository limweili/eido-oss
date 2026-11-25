// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Tooltip } from './Tooltip'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('Tooltip', () => {
  it('can show an immediate confirmation without hover intent', () => {
    render(
      <Tooltip content="Copied" open>
        <button type="button" aria-label="Copied">C</button>
      </Tooltip>,
    )

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveTextContent('Copied')
    expect(screen.getByRole('button', { name: 'Copied' })).toHaveAttribute(
      'aria-describedby',
      tooltip.id,
    )
  })

  it('dresses prose as a sentence and leaves labels in the caps pill', () => {
    // Prose declares itself by ending like a sentence; a label never has a
    // reason to carry terminal punctuation, however many words it grows. The
    // primitive owns the split so a sentence-length hint (#964) wraps as a
    // block instead of clipping at the nowrap pill's edge.
    render(
      <Tooltip content="This harness brings its own tools." open>
        <button type="button" aria-label="Sentence">S</button>
      </Tooltip>,
    )

    expect(screen.getByRole('tooltip')).toHaveClass('e-tooltip--sentence')
  })

  it('does not treat pointer focus as keyboard intent, waits 600ms, and exits through presence', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="Select · V">
        <button type="button" aria-label="Select">S</button>
      </Tooltip>,
    )
    const button = screen.getByRole('button', { name: 'Select' })

    expect(button).not.toHaveAttribute('title')
    fireEvent.pointerDown(button)
    fireEvent.focus(button)
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.pointerEnter(button)
    act(() => vi.advanceTimersByTime(599))
    expect(screen.queryByRole('tooltip')).toBeNull()
    act(() => vi.advanceTimersByTime(1))
    expect(screen.getByRole('tooltip')).toHaveTextContent('Select · V')
    fireEvent.pointerLeave(button)
    expect(screen.queryByRole('tooltip')).toBeNull()
    const exiting = document.querySelector<HTMLElement>('.e-tooltip[data-state="exiting"]')
    expect(exiting).not.toBeNull()
    expect(exiting).toHaveAttribute('aria-hidden', 'true')
    fireEvent.transitionEnd(exiting!, { propertyName: 'opacity' })
    expect(document.querySelector('.e-tooltip')).toBeNull()
  })

  it('uses the 600ms intent delay for keyboard focus-visible and cancels it on blur', () => {
    vi.useFakeTimers()
    render(
      <Tooltip content="Select · V">
        <button type="button" aria-label="Select">S</button>
      </Tooltip>,
    )
    const button = screen.getByRole('button', { name: 'Select' })

    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.focus(button)
    act(() => vi.advanceTimersByTime(599))
    expect(screen.queryByRole('tooltip')).toBeNull()
    fireEvent.blur(button)
    act(() => vi.advanceTimersByTime(1))
    expect(screen.queryByRole('tooltip')).toBeNull()

    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.focus(button)
    act(() => vi.advanceTimersByTime(600))

    const tooltip = screen.getByRole('tooltip')
    expect(button).toHaveAccessibleName('Select')
    expect(button).toHaveAttribute('aria-describedby', tooltip.id)
    expect(button).not.toHaveAttribute('title')
  })

  it('cleans a pending focus-visible intent timer on unmount', () => {
    vi.useFakeTimers()
    const { unmount } = render(
      <Tooltip content="Select · V">
        <button type="button" aria-label="Select">S</button>
      </Tooltip>,
    )

    fireEvent.keyDown(document, { key: 'Tab' })
    fireEvent.focus(screen.getByRole('button', { name: 'Select' }))
    expect(vi.getTimerCount()).toBe(1)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })

  it('keeps a tooltip inside the viewport and moves it below a top-edge trigger', () => {
    vi.useFakeTimers()
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.classList.contains('e-tooltip')) {
        return {
          x: 0,
          y: 0,
          left: 0,
          right: 100,
          top: 0,
          bottom: 30,
          width: 100,
          height: 30,
          toJSON: () => ({}),
        }
      }
      return {
        x: 0,
        y: 2,
        left: 0,
        right: 20,
        top: 2,
        bottom: 22,
        width: 20,
        height: 20,
        toJSON: () => ({}),
      }
    })

    render(
      <Tooltip content="A longer tooltip sentence">
        <button type="button" aria-label="Explain">?</button>
      </Tooltip>,
    )
    fireEvent.pointerEnter(screen.getByRole('button', { name: 'Explain' }))
    act(() => vi.advanceTimersByTime(600))

    const tooltip = screen.getByRole('tooltip')
    expect(tooltip).toHaveAttribute('data-side', 'below')
    expect(tooltip).toHaveStyle({ left: '58px', top: '22px' })
    expect(tooltip).not.toHaveClass('e-tooltip--sentence')
  })
})
