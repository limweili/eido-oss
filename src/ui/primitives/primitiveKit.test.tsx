// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  Badge,
  Button,
  Callout,
  Chip,
  ContextRow,
  DockKey,
  Field,
  FieldLabel,
  IconButton,
  Menu,
  MenuItem,
  Popover,
  TextArea,
  Toast,
  Toggle,
} from './index'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('primitive kit public outcomes', () => {
  it('renders the shared control vocabulary with accessible native semantics', () => {
    const onToggle = vi.fn()
    const onChip = vi.fn()
    render(
      <>
        <Button variant="primary">Run</Button>
        <Button typographyRole="ui">Idea</Button>
        <Button variant="danger">Delete</Button>
        <Button variant="danger-confirm">Delete group</Button>
        <IconButton label="Copy" icon={<span aria-hidden="true">C</span>} />
        <FieldLabel htmlFor="name">Name</FieldLabel>
        <Field id="name" defaultValue="Idea" />
        <TextArea aria-label="Notes" defaultValue="Paper" />
        <Toggle label="Enabled" checked onCheckedChange={onToggle} />
        <Chip tone="attention">Changed</Chip>
        <Chip interactive selected onClick={onChip}>Latest</Chip>
        <Badge>3</Badge>
        <Callout tone="avoid">Check your AI key or connection.</Callout>
        <Toast>Saved.</Toast>
        <DockKey label="Select" icon={<span aria-hidden="true">S</span>} pressed />
        <ContextRow rank={1} title="Morning commuters" status={<Chip>Reused</Chip>} />
        <Popover trigger={<Button>More</Button>}>
          <Menu ariaLabel="Actions"><MenuItem>Duplicate</MenuItem></Menu>
        </Popover>
      </>,
    )

    const typographyRoles = (element: HTMLElement) =>
      [...element.classList].filter((className) => className.startsWith('t-'))
    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toHaveClass('e-button--primary', 't-label')
    expect(typographyRoles(run)).toEqual(['t-label'])
    const idea = screen.getByRole('button', { name: 'Idea' })
    expect(idea).toHaveClass('t-ui')
    expect(typographyRoles(idea)).toEqual(['t-ui'])
    expect(screen.getByRole('button', { name: 'Delete' })).toHaveClass('e-button--danger')
    expect(screen.getByRole('button', { name: 'Delete group' })).toHaveClass(
      'e-button--danger-confirm',
    )
    const chip = screen.getByRole('button', { name: 'Latest' })
    expect(chip).toHaveAttribute('aria-pressed', 'true')
    expect(chip).toHaveAttribute('data-selected', 'true')
    fireEvent.click(chip)
    expect(onChip).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: 'Copy' })).not.toHaveAttribute('title')
    expect(screen.getByLabelText('Name')).toHaveValue('Idea')
    expect(screen.getByRole('switch', { name: 'Enabled' })).toHaveAttribute('aria-checked', 'true')
    expect(screen.getByRole('status')).toHaveTextContent('Saved.')
    expect(screen.getByRole('button', { name: 'Select' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Morning commuters')).toBeInTheDocument()
  })

  it('keeps disabled controls non-interactive', () => {
    const onButton = vi.fn()
    const onToggle = vi.fn()
    render(
      <>
        <Button disabled onClick={onButton}>Run</Button>
        <Field disabled aria-label="Disabled field" defaultValue="Idea" />
        <Toggle label="Enabled" checked={false} disabled onCheckedChange={onToggle} />
      </>,
    )

    const run = screen.getByRole('button', { name: 'Run' })
    expect(run).toBeDisabled()
    fireEvent.click(run)
    expect(onButton).not.toHaveBeenCalled()

    const field = screen.getByLabelText('Disabled field')
    expect(field).toBeDisabled()
    expect(field).not.toHaveAttribute('readonly')

    const toggle = screen.getByRole('switch', { name: 'Enabled' })
    expect(toggle).toBeDisabled()
    fireEvent.click(toggle)
    expect(onToggle).not.toHaveBeenCalled()
  })

  it('auto-dismisses Toast after 4.2s, then unmounts on its exit animation', () => {
    vi.useFakeTimers()
    render(<Toast tone="go">Saved.</Toast>)

    act(() => vi.advanceTimersByTime(4_199))
    expect(screen.getByRole('status')).toHaveTextContent('Saved.')
    act(() => vi.advanceTimersByTime(1))

    expect(screen.queryByRole('status')).toBeNull()
    const exiting = document.querySelector<HTMLElement>('.e-toast[data-state="exiting"]')
    expect(exiting).not.toBeNull()
    fireEvent.transitionEnd(exiting!, { propertyName: 'opacity' })
    expect(document.querySelector('.e-toast')).toBeNull()
  })

  it('cleans the Toast dismissal timer when its owner unmounts', () => {
    vi.useFakeTimers()
    const { unmount } = render(<Toast>Saved.</Toast>)
    expect(vi.getTimerCount()).toBeGreaterThan(0)

    unmount()

    expect(vi.getTimerCount()).toBe(0)
  })
})
