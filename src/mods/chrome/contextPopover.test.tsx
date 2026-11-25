// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { cleanup, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSeedMod } from '../seeds'
import { ModContextPopover } from './contextPopover'

afterEach(cleanup)

describe('Mod context popover', () => {
  it('renders the shared live sentence projection, including visible silence and accent emphasis', () => {
    const mod = createSeedMod('switch', {
      createId: (_, ordinal) => `switch-part-${ordinal}`,
    })
    mod.accent = '#F1666D'

    render(
      <ModContextPopover
        mod={mod}
        open
        onOpenChange={vi.fn()}
        onTreatmentOverrideChange={vi.fn()}
        trigger={<button type="button">Context</button>}
      />,
    )

    const dialog = screen.getByRole('dialog', { name: 'Mod context' })
    const sentences = within(dialog).getAllByRole('listitem')
    expect(sentences.map((sentence) => sentence.textContent)).toEqual([
      'Cite sources for every claim.',
      'End with a three-line summary.',
      'jargon is off, says nothing.',
    ])
    expect(dialog.style.getPropertyValue('--e-mod-face-accent')).toBe('#F1666D')
  })

  it('re-syncs the visible DEFAULT treatment when live Mod state changes', async () => {
    const user = userEvent.setup()
    const mod = createSeedMod('count', {
      createId: (_, ordinal) => `count-part-${ordinal}`,
    })
    mod.state.mode = 'ratio'
    mod.state.steps = 4
    const onTreatmentOverrideChange = vi.fn()
    const view = render(
      <ModContextPopover
        mod={mod}
        open
        onOpenChange={vi.fn()}
        onTreatmentOverrideChange={onTreatmentOverrideChange}
        trigger={<button type="button">Context</button>}
      />,
    )

    await user.click(screen.getByRole('button', { name: /How to read it.*DEFAULT/i }))
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'How to read it' })
    expect(editor).toHaveValue(
      'Each value is a proportion out of 4. Read it as a share, not an exact count.',
    )
    editor.focus()
    expect(editor).toHaveFocus()

    const changed = structuredClone(mod)
    changed.state.steps = 7
    view.rerender(
      <ModContextPopover
        mod={changed}
        open
        onOpenChange={vi.fn()}
        onTreatmentOverrideChange={onTreatmentOverrideChange}
        trigger={<button type="button">Context</button>}
      />,
    )

    expect(editor).toHaveValue(
      'Each value is a proportion out of 7. Read it as a share, not an exact count.',
    )
    expect(onTreatmentOverrideChange).not.toHaveBeenCalled()
  })

  it('treats clearing or retyping the computed default as DEFAULT', async () => {
    const user = userEvent.setup()
    const mod = createSeedMod('count', {
      createId: (_, ordinal) => `count-part-${ordinal}`,
    })
    mod.state.mode = 'ratio'
    mod.state.steps = 4
    mod.treatOverride = 'Read every value as a flexible preference.'
    const onTreatmentOverrideChange = vi.fn()
    render(
      <ModContextPopover
        mod={mod}
        open
        onOpenChange={vi.fn()}
        onTreatmentOverrideChange={onTreatmentOverrideChange}
        trigger={<button type="button">Context</button>}
      />,
    )

    await user.click(screen.getByRole('button', { name: /How to read it.*EDITED/i }))
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'How to read it' })
    const computedDefault =
      'Each value is a proportion out of 4. Read it as a share, not an exact count.'

    await user.clear(editor)
    expect(screen.getByRole('button', { name: /How to read it.*DEFAULT/i })).toBeInTheDocument()
    expect(onTreatmentOverrideChange).toHaveBeenLastCalledWith(null)
    await user.tab()
    expect(editor).toHaveValue(computedDefault)

    await user.clear(editor)
    await user.type(editor, `  ${computedDefault}  `)
    expect(screen.getByRole('button', { name: /How to read it.*DEFAULT/i })).toBeInTheDocument()
    expect(onTreatmentOverrideChange).toHaveBeenLastCalledWith(null)
  })

  it('marks EDITED only for a real override and emits that override verbatim', async () => {
    const user = userEvent.setup()
    const mod = createSeedMod('count', {
      createId: (_, ordinal) => `count-part-${ordinal}`,
    })
    mod.state.mode = 'ratio'
    mod.state.steps = 4
    const onTreatmentOverrideChange = vi.fn()
    const view = render(
      <ModContextPopover
        mod={mod}
        open
        onOpenChange={vi.fn()}
        onTreatmentOverrideChange={onTreatmentOverrideChange}
        trigger={<button type="button">Context</button>}
      />,
    )

    await user.click(screen.getByRole('button', { name: /How to read it.*DEFAULT/i }))
    const editor = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'How to read it' })
    await user.clear(editor)
    await user.type(editor, '  Read the scale as a strength, not a quota.  ')

    expect(screen.getByRole('button', { name: /How to read it.*EDITED/i })).toBeInTheDocument()
    expect(onTreatmentOverrideChange).toHaveBeenLastCalledWith(
      '  Read the scale as a strength, not a quota.  ',
    )

    const emissionCount = onTreatmentOverrideChange.mock.calls.length
    const changed = structuredClone(mod)
    changed.state.steps = 7
    view.rerender(
      <ModContextPopover
        mod={changed}
        open
        onOpenChange={vi.fn()}
        onTreatmentOverrideChange={onTreatmentOverrideChange}
        trigger={<button type="button">Context</button>}
      />,
    )

    expect(editor).toHaveValue('  Read the scale as a strength, not a quota.  ')
    expect(screen.getByRole('button', { name: /How to read it.*EDITED/i })).toBeInTheDocument()
    expect(onTreatmentOverrideChange).toHaveBeenCalledTimes(emissionCount)
  })

  it('opens on an accessible disclosure, contains board keys, and disposes its portal', async () => {
    const user = userEvent.setup()
    const boardKey = vi.fn()
    const mod = createSeedMod('slider', {
      createId: (_, ordinal) => `slider-part-${ordinal}`,
    })
    const view = render(
      <div onKeyDown={boardKey}>
        <ModContextPopover
          mod={mod}
          open
          onOpenChange={vi.fn()}
          onTreatmentOverrideChange={vi.fn()}
          trigger={<button type="button">Context</button>}
        />
      </div>,
    )

    const disclosure = screen.getByRole('button', { name: /How to read it.*DEFAULT/i })
    expect(screen.getByRole('button', { name: 'Context' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    )
    expect(disclosure).toHaveFocus()
    expect(disclosure).toHaveAttribute('aria-expanded', 'false')
    await user.click(disclosure)
    expect(disclosure).toHaveAttribute('aria-expanded', 'true')
    const editor = screen.getByRole('textbox', { name: 'How to read it' })
    expect(editor).toHaveAccessibleDescription(/Sent ahead of the prompts/)

    editor.focus()
    await user.keyboard('x')
    expect(boardKey).not.toHaveBeenCalled()

    view.unmount()
    expect(screen.queryByRole('dialog', { name: 'Mod context' })).toBeNull()
  })
})
