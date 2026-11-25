// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { mountModPopoverAccordion, mountModPopoverField } from './popoverControls'

describe('shared Mod popover controls', () => {
  it('binds a field label and optional help to the supplied control', () => {
    const root = document.createElement('div')
    const input = document.createElement('input')
    const field = mountModPopoverField(root, {
      id: 'slider-stops',
      label: 'Stops',
      control: input,
      help: 'Choose named detents.',
    })

    expect(root).toContainElement(input)
    expect(root.querySelector('label')).toHaveAttribute('for', 'slider-stops')
    expect(input).toHaveAttribute('id', 'slider-stops')
    expect(input).toHaveClass('e-field')
    expect(input).toHaveAttribute('aria-describedby', 'slider-stops-help')
    expect(root.querySelector('#slider-stops-help')).toHaveTextContent('Choose named detents.')

    field.dispose()
    expect(root.childElementCount).toBe(0)
  })

  it('exposes one controlled accordion with native button and ARIA behavior', () => {
    const root = document.createElement('div')
    const boardKey = vi.fn()
    root.addEventListener('keydown', boardKey)
    const onExpandedChange = vi.fn()
    const accordion = mountModPopoverAccordion(root, {
      id: 'slider-prompt',
      label: 'Warmth prompt',
      summary: 'DEFAULT',
      expanded: false,
      enabled: true,
      onExpandedChange,
    })

    expect(accordion.trigger).toHaveAttribute('aria-expanded', 'false')
    expect(accordion.trigger).toHaveAttribute('aria-controls', 'slider-prompt-panel')
    expect(accordion.body.hidden).toBe(true)

    accordion.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(boardKey).not.toHaveBeenCalled()
    accordion.trigger.click()
    expect(onExpandedChange).toHaveBeenCalledWith(true)

    accordion.update({ label: 'Warmth prompt', summary: 'EDITED', expanded: true, enabled: false })
    expect(accordion.trigger).toHaveAttribute('aria-expanded', 'true')
    expect(accordion.trigger).toBeDisabled()
    expect(accordion.body.hidden).toBe(false)
    accordion.trigger.click()
    expect(onExpandedChange).toHaveBeenCalledOnce()
  })
})
