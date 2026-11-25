// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './controls'
import { Menu, MenuItem, Popover } from './Popover'

afterEach(cleanup)

describe('Popover', () => {
  it('merges the actual trigger ref and preserves original pointer and click events', () => {
    const triggerRef = createRef<HTMLButtonElement>()
    const onPointerDown = vi.fn()
    const onClick = vi.fn()
    const onParentPointerDown = vi.fn()

    render(
      <div onPointerDown={onParentPointerDown}>
        <Popover
          trigger={
            <Button
              ref={triggerRef}
              onPointerDown={event => {
                onPointerDown(event)
                event.stopPropagation()
              }}
              onClick={onClick}
            >
              Palette
            </Button>
          }
        >
          <Menu ariaLabel="Palette"><MenuItem>Amber</MenuItem></Menu>
        </Popover>
      </div>,
    )

    const trigger = screen.getByRole('button', { name: 'Palette' })
    expect(triggerRef.current).toBe(trigger)

    fireEvent.pointerDown(trigger)
    expect(onPointerDown).toHaveBeenCalledWith(expect.objectContaining({ type: 'pointerdown' }))
    expect(onParentPointerDown).not.toHaveBeenCalled()

    fireEvent.click(trigger)
    expect(onClick).toHaveBeenCalledWith(expect.objectContaining({ type: 'click' }))
    expect(screen.getByRole('menu', { name: 'Palette' })).toBeInTheDocument()
  })

  it('restores trigger focus only for Escape, not outside pointer, supersession, or Tab', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Popover trigger={<Button>First</Button>}>
          <Menu ariaLabel="First menu"><MenuItem>First item</MenuItem></Menu>
        </Popover>
        <Popover trigger={<Button>Second</Button>}>
          <Menu ariaLabel="Second menu"><MenuItem>Second item</MenuItem></Menu>
        </Popover>
        <button type="button">Outside</button>
      </>,
    )
    const first = screen.getByRole('button', { name: 'First' })
    const second = screen.getByRole('button', { name: 'Second' })
    const outside = screen.getByRole('button', { name: 'Outside' })

    await user.click(first)
    screen.getByRole('menuitem', { name: 'First item' }).focus()
    await user.keyboard('{Escape}')
    expect(first).toHaveFocus()
    expect(screen.queryByRole('menu', { name: 'First menu' })).not.toBeInTheDocument()

    await user.click(first)
    await user.click(outside)
    expect(outside).toHaveFocus()

    await user.click(first)
    await user.click(second)
    expect(screen.getByRole('menuitem', { name: 'Second item' })).toHaveFocus()
    expect(screen.queryByRole('menu', { name: 'First menu' })).not.toBeInTheDocument()

    screen.getByRole('menuitem', { name: 'Second item' }).focus()
    await user.tab()
    expect(screen.queryByRole('menu', { name: 'Second menu' })).not.toBeInTheDocument()
    expect(first).not.toHaveFocus()
    expect(second).not.toHaveFocus()
  })

  it('opens into a roving enabled MenuItem path and retires through exit presence', async () => {
    const onDisabledClick = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <Popover trigger={<Button>Actions</Button>}>
          <Menu ariaLabel="Actions menu">
            <MenuItem disabled onClick={onDisabledClick}>Unavailable</MenuItem>
            <MenuItem>Duplicate</MenuItem>
            <MenuItem danger>Delete</MenuItem>
          </Menu>
        </Popover>
        <button type="button">After</button>
      </>,
    )
    const trigger = screen.getByRole('button', { name: 'Actions' })

    await user.click(trigger)
    const unavailable = screen.getByRole('menuitem', { name: 'Unavailable' })
    const duplicate = screen.getByRole('menuitem', { name: 'Duplicate' })
    const remove = screen.getByRole('menuitem', { name: 'Delete' })
    expect(duplicate).toHaveFocus()
    expect(unavailable).toHaveAttribute('tabindex', '-1')
    fireEvent.click(unavailable)
    expect(onDisabledClick).not.toHaveBeenCalled()

    await user.keyboard('{ArrowDown}')
    expect(remove).toHaveFocus()
    await user.keyboard('{Home}')
    expect(duplicate).toHaveFocus()
    await user.keyboard('{End}{ArrowDown}')
    expect(duplicate).toHaveFocus()

    await user.keyboard('{Escape}')
    expect(trigger).toHaveFocus()
    expect(screen.queryByRole('menu', { name: 'Actions menu' })).toBeNull()
    const exiting = document.querySelector<HTMLElement>('.e-popover[data-state="exiting"]')
    expect(exiting).not.toBeNull()
    expect(exiting).toHaveAttribute('inert')
    fireEvent.transitionEnd(exiting!, { propertyName: 'opacity' })
    expect(document.querySelector('.e-popover')).toBeNull()

    await user.click(trigger)
    expect(screen.getByRole('menuitem', { name: 'Duplicate' })).toHaveFocus()
    await user.tab()
    expect(screen.queryByRole('menu', { name: 'Actions menu' })).toBeNull()
    expect(trigger).not.toHaveFocus()
  })

  it('leaves roving keys to native editable and radiogroup descendants', () => {
    render(
      <Menu ariaLabel="Editable menu">
        <input aria-label="Filter" defaultValue="abcdef" />
        <div role="radiogroup" aria-label="Tone">
          <button type="button" role="radio" aria-checked="true">Warm</button>
        </div>
        <MenuItem>Apply</MenuItem>
      </Menu>,
    )

    const filter = screen.getByRole<HTMLInputElement>('textbox', { name: 'Filter' })
    const warm = screen.getByRole('radio', { name: 'Warm' })
    for (const key of ['ArrowDown', 'ArrowUp', 'Home', 'End']) {
      filter.focus()
      filter.setSelectionRange(3, 3)
      expect(fireEvent.keyDown(filter, { key })).toBe(true)
      expect(filter).toHaveFocus()
      expect([filter.selectionStart, filter.selectionEnd]).toEqual([3, 3])

      warm.focus()
      expect(fireEvent.keyDown(warm, { key })).toBe(true)
      expect(warm).toHaveFocus()
    }
  })
})
