// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_CARD_IDENTITY, resolveCardIdentity } from '../../ui/cardIdentity'
import { createSeedMod } from '../seeds'
import { ModIdentityWell } from './identityWell'

afterEach(cleanup)

describe('Mod identity well', () => {
  it('offers exactly the twelve shared identities and safely presents a stored custom accent', async () => {
    const user = userEvent.setup()
    const mod = createSeedMod('slider', {
      createId: (_, ordinal) => `slider-part-${ordinal}`,
    })
    mod.accent = '#777777'
    const onAccentChange = vi.fn()
    render(<ModIdentityWell mod={mod} onAccentChange={onAccentChange} />)

    const well = screen.getByTestId('mod-identity-well')
    const identities = screen.getAllByRole('radio')
    expect(identities).toHaveLength(12)
    expect(screen.getByRole('radiogroup', { name: 'Mod colour' })).toBeInTheDocument()
    expect(document.querySelector('input[type="color"]')).toBeNull()
    expect(identities.every((identity) => identity.getAttribute('aria-checked') === 'false')).toBe(true)
    expect(onAccentChange).not.toHaveBeenCalled()

    const resolved = resolveCardIdentity('#777777')
    expect(well.style.getPropertyValue('--e-mod-face-accent')).toBe('#777777')
    expect(well.style.getPropertyValue('--card-header-ink')).toBe(resolved.onSolid)

    const coral = screen.getByRole('radio', { name: 'Set Mod colour Coral' })
    coral.focus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('radio', { name: /Amber/ })).toHaveFocus()
    expect(onAccentChange).toHaveBeenLastCalledWith('#eca23b')
  })

  it('shows the safe default for invalid legacy input without writing it back', () => {
    const mod = createSeedMod('slider', {
      createId: (_, ordinal) => `slider-part-${ordinal}`,
    })
    mod.accent = 'not-a-colour'
    const onAccentChange = vi.fn()
    render(<ModIdentityWell mod={mod} onAccentChange={onAccentChange} />)

    const well = screen.getByTestId('mod-identity-well')
    expect(well.style.getPropertyValue('--e-mod-face-accent')).toBe(DEFAULT_CARD_IDENTITY)
    expect(screen.getByRole('radio', { name: /Purple/ })).toHaveAttribute('aria-checked', 'true')
    expect(onAccentChange).not.toHaveBeenCalled()
  })
})
