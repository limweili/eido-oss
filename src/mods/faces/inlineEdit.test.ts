// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { describe, expect, it, vi } from 'vitest'
import { mountInlineEdit } from './inlineEdit'

describe('the e-edit inline rename primitive', () => {
  it('commits trimmed text once on Enter and cancels Escape or blank edits', () => {
    const element = document.createElement('span')
    document.body.append(element)
    const commit = vi.fn(() => true)
    const edit = mountInlineEdit(element, { ariaLabel: 'Slider name', commit })
    edit.update('WARMTH', true)

    element.focus()
    element.textContent = '  FRIENDLINESS  '
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(commit).toHaveBeenCalledOnce()
    expect(commit).toHaveBeenCalledWith('FRIENDLINESS')
    expect(element.textContent).toBe('FRIENDLINESS')

    element.focus()
    element.textContent = 'SHOULD CANCEL'
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))
    expect(commit).toHaveBeenCalledOnce()
    expect(element.textContent).toBe('FRIENDLINESS')

    element.focus()
    element.textContent = '   '
    element.blur()
    expect(commit).toHaveBeenCalledOnce()
    expect(element.textContent).toBe('FRIENDLINESS')
  })

  it('is inert when editing is unavailable and stops editable keys from reaching the board', () => {
    const parent = document.createElement('div')
    const element = document.createElement('span')
    parent.append(element)
    document.body.append(parent)
    const parentPointer = vi.fn()
    const parentKey = vi.fn()
    parent.addEventListener('pointerdown', parentPointer)
    parent.addEventListener('keydown', parentKey)
    const edit = mountInlineEdit(element, { ariaLabel: 'Slider name', commit: vi.fn() })

    edit.update('WARMTH', false)
    element.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }))
    expect(parentPointer).toHaveBeenCalledOnce()
    expect(element.tabIndex).toBe(-1)
    expect(element).toHaveAttribute('aria-disabled', 'true')

    edit.update('WARMTH', true)
    element.focus()
    element.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    expect(parentKey).not.toHaveBeenCalled()
    expect(element.tabIndex).toBe(0)
    expect(element.getAttribute('contenteditable')).toBe('plaintext-only')
  })
})
