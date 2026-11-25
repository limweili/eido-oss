// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Picker } from './Picker'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

const OPTIONS = [
  { value: 'alpha', label: 'Alpha', disabled: true },
  { value: 'beta', label: 'Beta' },
  { value: 'gamma', label: 'Gamma' },
] as const

const TYPEAHEAD_OPTIONS = [
  ...OPTIONS,
  { value: 'delta', label: 'Delta' },
] as const

describe('Picker', () => {
  it('keeps focus on the combobox while keyboard navigation skips disabled options and commits', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Picker
        ariaLabel="Model"
        emptyLabel="None"
        value="beta"
        options={OPTIONS}
        onValueChange={onValueChange}
      />,
    )

    const trigger = screen.getByRole('combobox', { name: 'Model' })
    await user.click(trigger)

    const listboxId = trigger.getAttribute('aria-controls')
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
    expect(trigger).toHaveFocus()
    expect(screen.getByRole('listbox')).toHaveAttribute('id', listboxId)

    await user.keyboard('{ArrowUp}')
    expect(trigger).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Gamma' }).id,
    )

    await user.keyboard('{Home}')
    expect(trigger).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Beta' }).id,
    )

    await user.keyboard('g')
    expect(trigger).toHaveAttribute(
      'aria-activedescendant',
      screen.getByRole('option', { name: 'Gamma' }).id,
    )
    await user.keyboard('{Enter}')

    expect(onValueChange).toHaveBeenCalledWith('gamma')
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('retains managed trigger focus if an activating surface mounts an autofocus editor', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Picker ariaLabel="Model" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={() => undefined} />
        <input aria-label="Surface editor" />
      </>,
    )
    const trigger = screen.getByRole('combobox', { name: 'Model' })

    await user.click(trigger)
    screen.getByRole('textbox', { name: 'Surface editor' }).focus()

    expect(trigger).toHaveFocus()
    expect(trigger).toHaveAttribute('aria-expanded', 'true')
  })

  it('uses stable listbox and option ids across close and reopen', async () => {
    const user = userEvent.setup()
    render(<Picker ariaLabel="Model" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={() => undefined} />)
    const trigger = screen.getByRole('combobox', { name: 'Model' })

    await user.click(trigger)
    const firstListboxId = trigger.getAttribute('aria-controls')
    const firstOptionIds = screen.getAllByRole('option').map(option => option.id)
    await user.keyboard('{Escape}')
    await user.click(trigger)

    expect(trigger).toHaveAttribute('aria-controls', firstListboxId)
    expect(screen.getAllByRole('option').map(option => option.id)).toEqual(firstOptionIds)
  })

  it('closes on Escape without committing and contains Escape inside an editor boundary', async () => {
    const onValueChange = vi.fn()
    const onEditorKeyDown = vi.fn()
    const user = userEvent.setup()
    render(
      <section onKeyDown={onEditorKeyDown}>
        <Picker ariaLabel="Target" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={onValueChange} />
      </section>,
    )
    const trigger = screen.getByRole('combobox', { name: 'Target' })

    await user.click(trigger)
    await user.keyboard('{ArrowDown}{Escape}')

    expect(onValueChange).not.toHaveBeenCalled()
    expect(onEditorKeyDown).not.toHaveBeenCalled()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('closes without committing on outside pointerdown without stealing the clicked target focus', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <Picker ariaLabel="Style" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={onValueChange} />
        <button type="button">Outside</button>
      </>,
    )
    const trigger = screen.getByRole('combobox', { name: 'Style' })
    const outside = screen.getByRole('button', { name: 'Outside' })

    await user.click(trigger)
    await user.click(outside)
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(outside).toHaveFocus()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('closes on Tab while normal focus traversal continues', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(
      <>
        <Picker ariaLabel="Style" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={onValueChange} />
        <button type="button">After</button>
      </>,
    )
    const trigger = screen.getByRole('combobox', { name: 'Style' })

    await user.click(trigger)
    await user.tab()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'After' })).toHaveFocus()
    expect(onValueChange).not.toHaveBeenCalled()
  })

  it('opens only one popover and closing the prior picker does not steal focus', async () => {
    const user = userEvent.setup()
    render(
      <>
        <Picker ariaLabel="First" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={() => undefined} />
        <Picker ariaLabel="Second" emptyLabel="None" value="gamma" options={OPTIONS} onValueChange={() => undefined} />
      </>,
    )
    const first = screen.getByRole('combobox', { name: 'First' })
    const second = screen.getByRole('combobox', { name: 'Second' })

    await user.click(first)
    await user.click(second)

    expect(first).toHaveAttribute('aria-expanded', 'false')
    expect(second).toHaveAttribute('aria-expanded', 'true')
    expect(second).toHaveFocus()
    expect(screen.getAllByRole('listbox')).toHaveLength(1)
  })

  it('keeps a blank choice blank and renders None as a non-selectable placeholder', async () => {
    const onValueChange = vi.fn()
    const user = userEvent.setup()
    render(
      <Picker
        ariaLabel="Choice"
        emptyLabel="None"
        value=""
        options={OPTIONS.slice(1)}
        onValueChange={onValueChange}
      />,
    )
    const trigger = screen.getByRole('combobox', { name: 'Choice' })

    expect(trigger).toHaveTextContent('None')
    await user.click(trigger)
    expect(within(screen.getByRole('listbox')).queryByRole('option', { name: 'None' })).toBeNull()
    fireEvent.pointerDown(document.body)

    expect(onValueChange).not.toHaveBeenCalled()
    expect(trigger).toHaveTextContent('None')
  })

  it('commits a pointer choice from the body portal and restores trigger focus', () => {
    const onValueChange = vi.fn()
    render(<Picker ariaLabel="Model" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={onValueChange} />)
    const trigger = screen.getByRole('combobox', { name: 'Model' })

    fireEvent.click(trigger)
    const listbox = screen.getByRole('listbox')
    expect(listbox.parentElement).toBe(document.body)
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Gamma' }))
    fireEvent.click(screen.getByRole('option', { name: 'Gamma' }))

    expect(onValueChange).toHaveBeenCalledWith('gamma')
    expect(trigger).toHaveFocus()
  })

  it('closes without reporting a change when the current option is committed again', () => {
    const onValueChange = vi.fn()
    render(<Picker ariaLabel="Style" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={onValueChange} />)
    const trigger = screen.getByRole('combobox', { name: 'Style' })

    fireEvent.click(trigger)
    fireEvent.pointerDown(screen.getByRole('option', { name: 'Beta' }))
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }))

    expect(onValueChange).not.toHaveBeenCalled()
    expect(trigger).toHaveAttribute('aria-expanded', 'false')
    expect(trigger).toHaveFocus()
  })

  it('starts typeahead with a fresh query after each close and dismiss', () => {
    render(
      <>
        <Picker
          ariaLabel="Style"
          emptyLabel="None"
          value="beta"
          options={TYPEAHEAD_OPTIONS}
          onValueChange={() => undefined}
        />
        <button type="button">Outside</button>
      </>,
    )
    const trigger = screen.getByRole('combobox', { name: 'Style' })
    const activeOption = () => trigger.getAttribute('aria-activedescendant')

    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'g' })
    expect(activeOption()).toBe(screen.getByRole('option', { name: 'Gamma' }).id)
    fireEvent.keyDown(trigger, { key: 'Escape' })

    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'd' })
    expect(activeOption()).toBe(screen.getByRole('option', { name: 'Delta' }).id)
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }))

    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'g' })
    expect(activeOption()).toBe(screen.getByRole('option', { name: 'Gamma' }).id)
  })

  it('lets Escape propagate from a closed trigger to its owning surface', () => {
    const onSurfaceKeyDown = vi.fn()
    render(
      <section onKeyDown={onSurfaceKeyDown}>
        <Picker ariaLabel="Target" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={() => undefined} />
      </section>,
    )

    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Target' }), { key: 'Escape' })

    expect(onSurfaceKeyDown).toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }))
  })

  it('keeps a dismissed listbox mounted but inert until its exit animation finishes', () => {
    render(<Picker ariaLabel="Model" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={() => undefined} />)
    const trigger = screen.getByRole('combobox', { name: 'Model' })

    fireEvent.click(trigger)
    fireEvent.keyDown(trigger, { key: 'Escape' })

    const exiting = document.querySelector<HTMLElement>(
      '.e-picker__listbox[data-state="exiting"]',
    )
    expect(exiting).not.toBeNull()
    expect(exiting).toHaveAttribute('aria-hidden', 'true')
    expect(exiting).toHaveAttribute('inert')
    fireEvent.transitionEnd(exiting!, { propertyName: 'opacity' })
    expect(document.querySelector('.e-picker__listbox')).toBeNull()
  })

  it('repositions on capture scroll, resize, and observed size changes', () => {
    vi.useFakeTimers()
    const observe = vi.fn()
    const disconnect = vi.fn()
    vi.stubGlobal(
      'ResizeObserver',
      class ResizeObserverMock {
        observe = observe
        disconnect = disconnect
      },
    )
    render(<Picker ariaLabel="Model" emptyLabel="None" value="beta" options={OPTIONS} onValueChange={() => undefined} />)
    const trigger = screen.getByRole('combobox', { name: 'Model' })
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue({
      x: 20,
      y: 680,
      left: 20,
      right: 220,
      top: 680,
      bottom: 710,
      width: 200,
      height: 30,
      toJSON: () => undefined,
    })

    fireEvent.click(trigger)
    const listbox = screen.getByRole('listbox')
    vi.spyOn(listbox, 'getBoundingClientRect').mockReturnValue({
      x: 0,
      y: 0,
      left: 0,
      right: 240,
      top: 0,
      bottom: 180,
      width: 240,
      height: 180,
      toJSON: () => undefined,
    })
    act(() => {
      fireEvent.scroll(window)
      fireEvent(window, new Event('resize'))
      vi.runOnlyPendingTimers()
    })

    expect(observe).toHaveBeenCalledWith(trigger)
    expect(observe).toHaveBeenCalledWith(listbox)
    expect(listbox).toHaveAttribute('data-side', 'top')
    expect(listbox.style.left).not.toBe('')
    expect(listbox.style.top).not.toBe('')
    expect(listbox.style.maxWidth).not.toBe('')
    expect(disconnect).not.toHaveBeenCalled()
  })
})
