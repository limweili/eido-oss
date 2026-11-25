// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Segmented } from './Segmented'

afterEach(cleanup)

const OPTIONS = [
  { value: 's', label: 'S' },
  { value: 'm', label: 'M' },
  { value: 'l', label: 'L' },
] as const

describe('Segmented', () => {
  it('exposes a radiogroup and selects on pointerdown plus drag-across', () => {
    const onValueChange = vi.fn()
    render(
      <Segmented
        ariaLabel="Text size"
        value="m"
        options={OPTIONS}
        onValueChange={onValueChange}
      />,
    )
    const small = screen.getByRole('radio', { name: 'S' })
    const large = screen.getByRole('radio', { name: 'L' })

    expect(screen.getByRole('radiogroup', { name: 'Text size' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: 'M' })).toHaveAttribute('aria-checked', 'true')
    fireEvent.pointerDown(small, { pointerId: 1, buttons: 1 })
    fireEvent.pointerEnter(large, { pointerId: 1, buttons: 1 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(onValueChange.mock.calls.map(call => call[0])).toEqual(['s', 'l'])
  })

  it('stops drag-across when the browser loses the pointer release', () => {
    const onValueChange = vi.fn()
    render(
      <Segmented
        ariaLabel="Text size"
        value="m"
        options={OPTIONS}
        onValueChange={onValueChange}
      />,
    )
    const small = screen.getByRole('radio', { name: 'S' })
    const medium = screen.getByRole('radio', { name: 'M' })
    const large = screen.getByRole('radio', { name: 'L' })

    fireEvent.pointerDown(small, { pointerId: 1, buttons: 1 })
    fireEvent.pointerEnter(medium, { pointerId: 1, buttons: 1 })
    fireEvent.blur(window)
    fireEvent.pointerEnter(large, { pointerId: 1, buttons: 0 })

    expect(onValueChange.mock.calls.map(call => call[0])).toEqual(['s', 'm'])
  })

  it('cycles enabled choices with arrow keys and preserves roving focus', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Segmented
        ariaLabel="Text size"
        value="m"
        options={[OPTIONS[0], { ...OPTIONS[1], disabled: true }, OPTIONS[2]]}
        onValueChange={onValueChange}
      />,
    )
    const small = screen.getByRole('radio', { name: 'S' })
    small.focus()

    await user.keyboard('{ArrowRight}')

    expect(onValueChange).toHaveBeenLastCalledWith('l')
    expect(screen.getByRole('radio', { name: 'L' })).toHaveFocus()
  })
})
