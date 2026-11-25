// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { StrictMode, useLayoutEffect, useState } from 'react'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { Button } from '../primitives'
import { OverlayProvider, useDialogs, type DialogService } from './index'

afterEach(() => {
  cleanup()
  document.body.replaceChildren()
})

function DialogJourney() {
  const dialogs = useDialogs()
  const [outcome, setOutcome] = useState('')

  const run = async () => {
    const capturedTarget = 'card-a'
    const confirmation = dialogs.confirm({
      title: 'Delete this card?',
      message: 'This removes the card and its connections.',
      confirmLabel: 'Delete card',
      tone: 'danger',
    })
    const reason = dialogs.prompt({
      title: 'Why stop here?',
      message: 'Add the one-line reason future runs should avoid.',
      label: 'Reason',
      submitLabel: 'Keep reason',
      defaultValue: '  first draft  ',
    })

    const confirmed = await confirmation
    const exactReason = await reason
    setOutcome(`${capturedTarget}|${confirmed}|${exactReason ?? 'cancelled'}`)
  }

  return (
    <>
      <Button onClick={() => void run()}>Run dialogs</Button>
      <output aria-label="Dialog outcome">{outcome}</output>
    </>
  )
}

function CancellationJourney() {
  const dialogs = useDialogs()
  const [outcome, setOutcome] = useState('')

  const run = async () => {
    const confirmation = dialogs.confirm({
      title: 'Leave this run?',
      message: 'The current draft stays on the card.',
      confirmLabel: 'Leave run',
    })
    const note = dialogs.prompt({
      title: 'Name the draft',
      message: 'Give this draft a name.',
      label: 'Name',
      submitLabel: 'Keep name',
    })
    setOutcome(`${await confirmation}|${(await note) ?? 'cancelled'}`)
  }

  return (
    <>
      <Button onClick={() => void run()}>Run cancellation</Button>
      <output aria-label="Cancellation outcome">{outcome}</output>
    </>
  )
}

function DialogServiceProbe({ capture }: { capture: (service: DialogService) => void }) {
  const service = useDialogs()
  useLayoutEffect(() => capture(service), [capture, service])
  return null
}

describe('async dialog service rendered outcomes', () => {
  it('serializes requests FIFO and preserves prompt defaults and exact submitted strings', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    render(
      <StrictMode>
        <OverlayProvider>
          <DialogJourney />
        </OverlayProvider>
      </StrictMode>,
      { container: appRoot },
    )

    const invoker = screen.getByRole('button', { name: 'Run dialogs' })
    invoker.focus()
    fireEvent.click(invoker)

    expect(await screen.findByRole('dialog', { name: 'Delete this card?' }))
      .toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Why stop here?' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    fireEvent.click(screen.getByRole('button', { name: 'Delete card' }))

    expect(await screen.findByRole('dialog', { name: 'Why stop here?' }))
      .toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Delete this card?' })).toBeNull()
    const field = screen.getByRole('textbox', { name: 'Reason' })
    expect(field).toHaveFocus()
    expect(field).toHaveValue('  first draft  ')
    fireEvent.change(field, { target: { value: '  keep both spaces  ' } })
    fireEvent.click(screen.getByRole('button', { name: 'Keep reason' }))

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Dialog outcome' }).textContent)
        .toBe('card-a|true|  keep both spaces  ')
    })
    await waitFor(() => expect(invoker).toHaveFocus())
  })

  it('settles Escape and Cancel without accepting either queued request', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    render(
      <StrictMode>
        <OverlayProvider>
          <CancellationJourney />
        </OverlayProvider>
      </StrictMode>,
      { container: appRoot },
    )

    fireEvent.click(screen.getByRole('button', { name: 'Run cancellation' }))
    expect(await screen.findByRole('dialog', { name: 'Leave this run?' }))
      .toBeInTheDocument()
    fireEvent.keyDown(document, { key: 'Escape' })

    expect(await screen.findByRole('dialog', { name: 'Name the draft' }))
      .toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))

    await waitFor(() => {
      expect(screen.getByRole('status', { name: 'Cancellation outcome' }).textContent)
        .toBe('false|cancelled')
    })
  })

  it('settles and advances the FIFO only after the active modal finishes exiting', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    let service: DialogService | null = null
    const capture = (next: DialogService) => { service = next }
    render(
      <StrictMode>
        <OverlayProvider>
          <DialogServiceProbe capture={capture} />
        </OverlayProvider>
      </StrictMode>,
      { container: appRoot },
    )

    let confirmation!: Promise<boolean>
    let prompt!: Promise<string | null>
    let confirmationSettled = false
    act(() => {
      confirmation = service!.confirm({
        title: 'Exit before settle',
        message: 'The next request waits for this exit beat.',
        confirmLabel: 'Continue',
      })
      prompt = service!.prompt({
        title: 'Queued until retirement',
        message: 'This must not stack over an exiting confirm.',
        label: 'Value',
        submitLabel: 'Keep value',
      })
      void confirmation.then(() => { confirmationSettled = true })
    })

    const confirmDialog = await screen.findByRole('dialog', { name: 'Exit before settle' })
    const confirmBackdrop = confirmDialog.parentElement!
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }))
    await act(async () => Promise.resolve())

    expect(confirmBackdrop).toHaveAttribute('data-state', 'exiting')
    expect(confirmBackdrop).toHaveAttribute('inert')
    expect(confirmationSettled).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'Queued until retirement' })).toBeNull()

    fireEvent.transitionEnd(confirmBackdrop, { propertyName: 'opacity' })
    await expect(confirmation).resolves.toBe(true)
    const promptDialog = await screen.findByRole('dialog', {
      name: 'Queued until retirement',
    })
    const promptBackdrop = promptDialog.parentElement!
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    fireEvent.transitionEnd(promptBackdrop, { propertyName: 'opacity' })
    await expect(prompt).resolves.toBeNull()
  })

  it('settles the active and queued requests when the provider unmounts', async () => {
    const appRoot = document.createElement('div')
    appRoot.id = 'root'
    document.body.append(appRoot)
    let service: DialogService | null = null
    const capture = (next: DialogService) => { service = next }
    const view = render(
      <StrictMode>
        <OverlayProvider>
          <DialogServiceProbe capture={capture} />
        </OverlayProvider>
      </StrictMode>,
      { container: appRoot },
    )

    let confirmation!: Promise<boolean>
    let prompt!: Promise<string | null>
    act(() => {
      confirmation = service!.confirm({
        title: 'Active confirm',
        message: 'This request is active.',
        confirmLabel: 'Continue',
      })
      prompt = service!.prompt({
        title: 'Queued prompt',
        message: 'This request is queued.',
        label: 'Value',
        submitLabel: 'Keep value',
      })
    })
    expect(await screen.findByRole('dialog', { name: 'Active confirm' }))
      .toBeInTheDocument()

    view.unmount()

    await expect(confirmation).resolves.toBe(false)
    await expect(prompt).resolves.toBeNull()
    await waitFor(() => expect(document.getElementById('eido-overlay-root')).toBeNull())
    expect(appRoot).not.toHaveAttribute('inert')
  })
})
