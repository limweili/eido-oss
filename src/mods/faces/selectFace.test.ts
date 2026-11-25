// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mod } from '../model'
import { createSeedMod } from '../seeds'
import { mountModFaceHost } from './host'
import type { AnimationFrameScheduler } from './pointerGesture'
import { selectFaceDefinition } from './selectFace'

function pointerEvent(
  type: string,
  { pointerId = 8, button = 0, clientX = 0, clientY = 0 } = {},
): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    button: { value: button },
    clientX: { value: clientX },
    clientY: { value: clientY },
  })
  return event
}

function frameHarness(): AnimationFrameScheduler & { flush: () => void; pending: () => number } {
  let nextHandle = 1
  const callbacks = new Map<number, FrameRequestCallback>()
  return {
    request(callback) {
      const handle = nextHandle++
      callbacks.set(handle, callback)
      return handle
    },
    cancel(handle) {
      callbacks.delete(handle)
    },
    flush() {
      const queued = [...callbacks.values()]
      callbacks.clear()
      queued.forEach((callback) => callback(0))
    },
    pending: () => callbacks.size,
  }
}

function optionRect(left: number, top: number, width: number, height: number): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({}),
  }
}

function mountSelect() {
  const root = document.createElement('div')
  document.body.append(root)
  const scheduler = frameHarness()
  const commits: Array<{ mod: Mod<'select'>; label: string }> = []
  const gestures: boolean[] = []
  const mod = createSeedMod('select', { createId: (_, ordinal) => `option-${ordinal}` })
  const host = mountModFaceHost({
    root,
    definition: selectFaceDefinition,
    mod,
    selected: true,
    canEdit: true,
    animationFrames: scheduler,
    onGestureChange: (active) => gestures.push(active),
    commit: (next, label) => {
      commits.push({ mod: next, label })
      return true
    },
  })
  return { root, scheduler, commits, gestures, mod, host }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('the reference select face', () => {
  it('picks by drag-across at two non-1 rendered scales and commits once on release', () => {
    const run = (scale: number) => {
      const mounted = mountSelect()
      const group = mounted.root.querySelector<HTMLElement>('[role="radiogroup"]')!
      const cells = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
      Object.assign(group, {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
      })
      cells.forEach((cell, index) => {
        cell.getBoundingClientRect = vi.fn(() => optionRect(
          30 + index * 48 * scale,
          40,
          48 * scale,
          32 * scale,
        ))
      })

      const start = cells[1].getBoundingClientRect()
      const end = cells[3].getBoundingClientRect()
      cells[1].dispatchEvent(pointerEvent('pointerdown', {
        clientX: start.left + start.width / 2,
        clientY: start.top + start.height / 2,
      }))
      group.dispatchEvent(pointerEvent('pointermove', {
        clientX: end.left + end.width / 2,
        clientY: end.top + end.height / 2,
      }))
      mounted.scheduler.flush()

      expect(cells[3]).toHaveAttribute('aria-checked', 'true')
      expect(mounted.commits).toHaveLength(0)

      group.dispatchEvent(pointerEvent('pointerup', {
        clientX: end.left + end.width / 2,
        clientY: end.top + end.height / 2,
      }))

      expect(mounted.commits).toHaveLength(1)
      expect(mounted.commits[0]).toMatchObject({ label: 'Pick option' })
      expect(mounted.gestures).toEqual([true, false])
      const picked = mounted.commits[0].mod.state.picked
      mounted.host.dispose()
      return picked
    }

    expect(run(0.6)).toBe(3)
    expect(run(1.8)).toBe(3)
  })

  it('leaves unselected options inert, then cycles the radio choice without leaking board keys', () => {
    const mounted = mountSelect()
    mounted.host.update({ mod: mounted.mod, selected: false, canEdit: true })
    const first = mounted.root.querySelector<HTMLElement>('[role="radio"]')!
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)

    first.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    }))
    expect(boardKey).toHaveBeenCalledOnce()
    expect(mounted.commits).toHaveLength(0)
    expect(first).toHaveAttribute('aria-disabled', 'true')
    expect(first.tabIndex).toBe(-1)

    mounted.host.update({ mod: mounted.mod, selected: true, canEdit: true })
    const key = new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
      cancelable: true,
    })
    first.dispatchEvent(key)

    const radios = [...mounted.root.querySelectorAll<HTMLElement>('[role="radio"]')]
    expect(key.defaultPrevented).toBe(true)
    expect(boardKey).toHaveBeenCalledOnce()
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].mod.state.picked).toBe(1)
    expect(radios[0]).toHaveAttribute('aria-checked', 'false')
    expect(radios[1]).toHaveAttribute('aria-checked', 'true')
    expect(radios[1]).toHaveFocus()
    expect(radios[1].tabIndex).toBe(0)
  })

  it('switches to stacked pills at five options and keeps removal inside the face', () => {
    // Growth moved to the card head's + key (ModCard); the stacked form is
    // reached by updating in a fifth option.
    const mounted = mountSelect()
    expect(mounted.root.querySelector('.mod-add-select')).toBeNull()
    expect(mounted.root.querySelector('.i-seg')).toBeInTheDocument()

    const grown = structuredClone(mounted.mod)
    grown.state.options.push({ id: 'option-5', label: 'OPTION 5', frame: '' })
    mounted.host.update({ mod: grown, selected: true, canEdit: true })

    expect(mounted.root.querySelector('.i-seg')).not.toBeInTheDocument()
    expect(mounted.root.querySelector('.i-stack')).toBeInTheDocument()
    expect(mounted.root.querySelectorAll('[role="radio"]')).toHaveLength(5)

    for (let remaining = 5; remaining > 2; remaining -= 1) {
      const remove = mounted.root.querySelector<HTMLButtonElement>('.row-x')!
      expect(remove).toHaveAccessibleName(/^Remove /)
      expect(remove.closest('[role="radio"]')).toBeNull()
      remove.click()
      expect(mounted.root.querySelector('[role="radio"]:focus')).toBeInTheDocument()
    }

    expect(mounted.commits.map(({ label }) => label)).toEqual([
      'Remove option',
      'Remove option',
      'Remove option',
    ])
    expect(mounted.root.querySelectorAll('[role="radio"]')).toHaveLength(2)
    expect(mounted.root.querySelector('.row-x')).not.toBeInTheDocument()
    expect(mounted.root.querySelector('.i-seg')).toBeInTheDocument()
  })

  it('keeps removal keyboard activation separate from radio choice and refreshes accessible names', () => {
    const mounted = mountSelect()
    const updated = structuredClone(mounted.mod)
    updated.title = 'AUDIENCE'
    updated.state.options[0].label = 'TEAM'
    mounted.host.update({ mod: updated, selected: true, canEdit: true })

    const group = mounted.root.querySelector<HTMLElement>('[role="radiogroup"]')!
    const remove = mounted.root.querySelector<HTMLButtonElement>('[aria-label="Remove TEAM"]')!
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    remove.dispatchEvent(enter)

    expect(group).toHaveAccessibleName('AUDIENCE options')
    expect(remove.closest('[role="radio"]')).toBeNull()
    expect(enter.defaultPrevented).toBe(false)
    expect(boardKey).not.toHaveBeenCalled()
    expect(mounted.commits).toHaveLength(0)

    remove.click()
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].label).toBe('Remove option')
    expect(mounted.root.querySelector('[role="radio"]:focus')).toBeInTheDocument()
  })

  it('rolls back a queued drag and releases gesture ownership on teardown', () => {
    const mounted = mountSelect()
    const group = mounted.root.querySelector<HTMLElement>('[role="radiogroup"]')!
    const cells = [...group.querySelectorAll<HTMLElement>('[role="radio"]')]
    const releasePointerCapture = vi.fn()
    Object.assign(group, { setPointerCapture: vi.fn(), releasePointerCapture })
    cells.forEach((cell, index) => {
      cell.getBoundingClientRect = vi.fn(() => optionRect(index * 50, 0, 50, 32))
    })

    cells[1].dispatchEvent(pointerEvent('pointerdown', { clientX: 75, clientY: 16 }))
    group.dispatchEvent(pointerEvent('pointermove', { clientX: 175, clientY: 16 }))
    expect(mounted.scheduler.pending()).toBe(1)

    mounted.host.dispose()

    expect(mounted.gestures).toEqual([true, false])
    expect(mounted.scheduler.pending()).toBe(0)
    expect(mounted.commits).toHaveLength(0)
    expect(releasePointerCapture).toHaveBeenCalledWith(8)
    expect(mounted.root.childElementCount).toBe(0)
  })
})
