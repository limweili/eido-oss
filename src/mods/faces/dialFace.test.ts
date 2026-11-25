// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mod } from '../model'
import { createSeedMod } from '../seeds'
import { dialFaceDefinition } from './dialFace'
import { mountModFaceHost } from './host'

function pointerEvent(
  type: string,
  { pointerId = 7, button = 0, clientY = 0, shiftKey = false } = {},
): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    button: { value: button },
    clientY: { value: clientY },
    shiftKey: { value: shiftKey },
  })
  return event
}

function dialRect(height: number): DOMRect {
  return {
    x: 0,
    y: 0,
    left: 0,
    top: 0,
    right: height,
    bottom: height,
    width: height,
    height,
    toJSON: () => ({}),
  }
}

function mountDial() {
  const root = document.createElement('div')
  document.body.append(root)
  const commits: Array<{ mod: Mod<'dial'>; label: string }> = []
  const mod = createSeedMod('dial', { createId: (_, ordinal) => `dial-${ordinal}` })
  const host = mountModFaceHost({
    root,
    definition: dialFaceDefinition,
    mod,
    selected: true,
    canEdit: true,
    commit: (next, label) => {
      commits.push({ mod: next, label })
      return true
    },
  })
  return { root, commits, host }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('the dial face', () => {
  it('derives the same turn from its rendered dial rect at two non-1 zoom scales', () => {
    const run = (height: number) => {
      const mounted = mountDial()
      const dial = mounted.root.querySelector<HTMLElement>('[role="slider"]')!
      dial.getBoundingClientRect = vi.fn(() => dialRect(height))
      Object.assign(dial, {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
      })

      dial.dispatchEvent(pointerEvent('pointerdown', { clientY: 200 }))
      dial.dispatchEvent(pointerEvent('pointerup', { clientY: 200 - height / 2 }))

      expect(dial.getBoundingClientRect).toHaveBeenCalledOnce()
      expect(mounted.commits).toHaveLength(1)
      expect(mounted.commits[0]).toMatchObject({ label: 'Adjust dial' })
      const value = mounted.commits[0].mod.state.items[0].v
      mounted.host.dispose()
      return value
    }

    expect(run(30)).toBe(60)
    expect(run(120)).toBe(60)
  })

  it('announces and commits keyboard turns without leaking keys to the Board', () => {
    const mounted = mountDial()
    const dial = mounted.root.querySelector<HTMLElement>('[role="slider"]')!
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)

    const key = new KeyboardEvent('keydown', {
      key: 'ArrowUp',
      bubbles: true,
      cancelable: true,
    })
    dial.dispatchEvent(key)

    expect(key.defaultPrevented).toBe(true)
    expect(boardKey).not.toHaveBeenCalled()
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].mod.state.items[0].v).toBe(41)
    expect(dial).toHaveAttribute('aria-valuenow', '41')
    expect(dial).toHaveAttribute('aria-valuetext', '41%')
  })

  it('renames and removes dials with one discrete commit per action', () => {
    const mounted = mountDial()
    const label = mounted.root.querySelector<HTMLElement>('.mod-sub')!
    label.focus()
    label.textContent = 'PRECISION'
    label.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))

    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0]).toMatchObject({ label: 'Rename dial' })
    expect(mounted.commits[0].mod.state.items[0].label).toBe('PRECISION')

    // Growth moved to the card head's + key (ModCard); the face owns rename
    // and removal only.
    expect(mounted.root.querySelector('.mod-add')).toBeNull()

    mounted.root.querySelector<HTMLButtonElement>('.row-x')!.click()
    expect(mounted.commits).toHaveLength(2)
    expect(mounted.commits[1]).toMatchObject({ label: 'Remove dial' })
    expect(mounted.root.querySelectorAll('[role="slider"]')).toHaveLength(2)
  })

  it('keeps dial chrome keys inside the Mod and refreshes its removal announcement', () => {
    const mounted = mountDial()
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)
    const label = mounted.root.querySelector<HTMLElement>('.mod-sub')!
    const remove = mounted.root.querySelector<HTMLButtonElement>('.row-x')!

    label.focus()
    label.textContent = 'PRECISION'
    label.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))

    expect(remove).toHaveAttribute('aria-label', 'Remove PRECISION')

    remove.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    expect(boardKey).not.toHaveBeenCalled()
  })
})
