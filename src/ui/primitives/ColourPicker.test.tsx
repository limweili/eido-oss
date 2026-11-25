// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ColourPicker } from './ColourPicker'

afterEach(cleanup)

const COLOURS = [
  { value: 'coral', label: 'Coral', swatch: '#f1666d' },
  { value: 'red', label: 'Red', swatch: '#c9282e' },
  { value: 'amber', label: 'Amber', swatch: '#eca23b' },
  { value: 'orange', label: 'Orange', swatch: '#b5540f' },
  { value: 'mint', label: 'Mint', swatch: '#65b563' },
  { value: 'green', label: 'Green', swatch: '#1b7550' },
] as const

const MODES = [
  { value: 'none', label: 'No fill', tooltip: 'NO FILL', className: 'no-fill' },
  { value: 'soft', label: 'Soft fill', tooltip: 'SOFT FILL', className: 'soft-fill' },
] as const

describe('ColourPicker', () => {
  it('gives every colour well the same two-row radio and keyboard contract', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ColourPicker
        ariaLabel="Colour"
        value="coral"
        options={COLOURS}
        onValueChange={onValueChange}
      />,
    )

    const group = screen.getByRole('radiogroup', { name: 'Colour' })
    const coral = screen.getByRole('radio', { name: 'Coral' })
    const amber = screen.getByRole('radio', { name: 'Amber' })
    const orange = screen.getByRole('radio', { name: 'Orange' })
    expect(group).toHaveClass('e-colour-picker__swatches')
    expect(screen.getAllByRole('radio').filter((radio) => radio.tabIndex === 0)).toEqual([coral])
    expect(screen.getAllByRole('radio').every((radio) => !radio.hasAttribute('title'))).toBe(true)

    coral.focus()
    await user.keyboard('{ArrowRight}')
    expect(amber).toHaveFocus()
    expect(onValueChange).toHaveBeenLastCalledWith('amber')

    await user.keyboard('{ArrowDown}')
    expect(orange).toHaveFocus()
    expect(onValueChange).toHaveBeenLastCalledWith('orange')
  })

  it('keeps optional fill modes inside the standard module while colour swatches stay quiet', async () => {
    const onModeValueChange = vi.fn()
    const user = userEvent.setup()
    render(
      <ColourPicker
        ariaLabel="Card colour"
        label="Card colour"
        value="coral"
        options={COLOURS}
        onValueChange={() => undefined}
        modeAriaLabel="Fill style"
        modeValue="soft"
        modeOptions={MODES}
        onModeValueChange={onModeValueChange}
      />,
    )

    expect(screen.getByText('Card colour')).toHaveClass('e-colour-picker__label')
    expect(screen.getByRole('radiogroup', { name: 'Fill style' })).toHaveClass(
      'e-colour-picker__modes',
    )
    expect(screen.getByRole('radio', { name: 'Soft fill' })).toHaveAttribute(
      'aria-checked',
      'true',
    )

    await user.click(screen.getByRole('radio', { name: 'No fill' }))
    expect(onModeValueChange).toHaveBeenCalledWith('none')
    expect(screen.getByRole('radio', { name: 'Coral' })).not.toHaveAttribute('title')
  })
})
