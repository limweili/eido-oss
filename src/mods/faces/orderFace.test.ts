// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mod } from '../model'
import { createSeedMod } from '../seeds'
import { mountModFaceHost } from './host'
import { orderFaceDefinition } from './orderFace'
import type { AnimationFrameScheduler } from './pointerGesture'

function pointerEvent(
  type: string,
  { pointerId = 12, button = 0, clientX = 0, clientY = 0 } = {},
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

function tokenRect(left: number, top: number, width: number, height: number): DOMRect {
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

function mountOrder() {
  const root = document.createElement('div')
  document.body.append(root)
  const scheduler = frameHarness()
  const commits: Array<{ mod: Mod<'order'>; label: string }> = []
  const gestures: boolean[] = []
  const mod = createSeedMod('order', { createId: (_, ordinal) => `item-${ordinal}` })
  const host = mountModFaceHost({
    root,
    definition: orderFaceDefinition,
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

describe('the reference order face', () => {
  it('derives pitch from adjacent rendered rects and commits one zoom-invariant permutation', () => {
    const run = (scale: number) => {
      const mounted = mountOrder()
      const list = mounted.root.querySelector<HTMLElement>('[role="list"]')!
      const tokens = [...list.querySelectorAll<HTMLElement>('[role="listitem"]')]
      const height = 24 * scale
      const pitch = 30 * scale
      tokens.forEach((token, rank) => {
        token.getBoundingClientRect = vi.fn(() => tokenRect(20, 50 + rank * pitch, 140 * scale, height))
        Object.defineProperty(token, 'offsetHeight', {
          configurable: true,
          get: () => { throw new Error('Order pitch must not read layout pixels') },
        })
        Object.assign(token, {
          setPointerCapture: vi.fn(),
          releasePointerCapture: vi.fn(),
        })
      })

      const startY = 50 + height / 2
      const endY = startY + pitch * 2
      tokens[0].dispatchEvent(pointerEvent('pointerdown', { clientY: startY }))
      tokens[0].dispatchEvent(pointerEvent('pointermove', { clientY: endY }))
      mounted.scheduler.flush()

      expect(mounted.commits).toHaveLength(0)
      expect([...mounted.root.querySelectorAll('.i-order-list .tk-name')].map((node) => node.textContent)).toEqual([
        'CLARITY',
        'DEPTH',
        'BREVITY',
      ])
      expect(tokens[0].style.getPropertyValue('--e-mod-face-order-shift')).toBe('2.5')
      expect(tokens[1].style.getPropertyValue('--e-mod-face-order-shift')).toBe('-1.25')
      expect(tokens[1]).toHaveClass('is-top')

      tokens[0].dispatchEvent(pointerEvent('pointerup', { clientY: endY }))

      expect(mounted.commits).toHaveLength(1)
      expect(mounted.commits[0]).toMatchObject({ label: 'Reorder priorities' })
      expect(mounted.gestures).toEqual([true, false])
      expect([...mounted.root.querySelectorAll('.i-order-list .tk-name')].map((node) => node.textContent)).toEqual([
        'DEPTH',
        'BREVITY',
        'CLARITY',
      ])
      const permutation = mounted.commits[0].mod.state.perm
      mounted.host.dispose()
      return permutation
    }

    expect(run(0.55)).toEqual([1, 2, 0])
    expect(run(1.75)).toEqual([1, 2, 0])
  })

  it('reorders by keyboard with rank announcements and no board-shortcut leak', () => {
    const mounted = mountOrder()
    mounted.host.update({ mod: mounted.mod, selected: false, canEdit: true })
    const first = mounted.root.querySelector<HTMLElement>('[data-mod-part-id="item-0"]')!
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)

    first.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    }))
    expect(boardKey).toHaveBeenCalledOnce()
    expect(mounted.commits).toHaveLength(0)
    expect(first).toHaveAttribute('aria-disabled', 'true')
    expect(first.tabIndex).toBe(-1)

    mounted.host.update({ mod: mounted.mod, selected: true, canEdit: true })
    const key = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    })
    first.dispatchEvent(key)

    const moved = mounted.root.querySelector<HTMLElement>('[data-mod-part-id="item-0"]')!
    const top = mounted.root.querySelector<HTMLElement>('[data-mod-part-id="item-1"]')!
    expect(key.defaultPrevented).toBe(true)
    expect(boardKey).toHaveBeenCalledOnce()
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].mod.state.perm).toEqual([1, 0, 2])
    expect(moved).toHaveAttribute('aria-label', 'CLARITY, rank 2 of 3')
    expect(moved).toHaveAttribute('aria-posinset', '2')
    expect(moved).toHaveFocus()
    expect(top).toHaveClass('is-top')
  })

  it('keeps the token label draggable until double-click opens keyboard-safe inline rename', () => {
    const mounted = mountOrder()
    const tokens = [...mounted.root.querySelectorAll<HTMLElement>('[role="listitem"]')]
    tokens.forEach((token, rank) => {
      token.getBoundingClientRect = vi.fn(() => tokenRect(0, rank * 30, 140, 24))
      Object.assign(token, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
    })
    const first = tokens[0]
    const name = first.querySelector<HTMLElement>('.tk-name')!

    name.dispatchEvent(pointerEvent('pointerdown', { clientY: 12 }))
    first.dispatchEvent(pointerEvent('pointerup', { clientY: 12 }))
    expect(mounted.gestures).toEqual([true, false])
    expect(mounted.commits).toHaveLength(0)

    name.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }))
    expect(name).toHaveFocus()
    expect(name.getAttribute('contenteditable')).toBe('plaintext-only')
    expect(name).toHaveAttribute('role', 'textbox')

    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)
    name.textContent = 'focus'
    mounted.host.update({ mod: mounted.mod, selected: true, canEdit: true })
    expect(name.textContent).toBe('focus')
    name.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    }))

    expect(boardKey).not.toHaveBeenCalled()
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].label).toBe('Rename priority')
    expect(mounted.commits[0].mod.state.items[0].label).toBe('FOCUS')
    expect(name.textContent).toBe('FOCUS')
    expect(mounted.root.querySelector('[aria-label="Remove FOCUS"]')).toBeInTheDocument()
  })

  it('removes priorities inside the face while repairing the permutation', () => {
    // Growth moved to the card head's + key (ModCard); the face owns ranking,
    // rename, and removal only.
    const mounted = mountOrder()
    const permuted = structuredClone(mounted.mod)
    permuted.state.perm = [2, 0, 1]
    mounted.host.update({ mod: permuted, selected: true, canEdit: true })

    expect(mounted.root.querySelector('.mod-add-order')).toBeNull()

    const removeClarity = mounted.root.querySelector<HTMLButtonElement>('[aria-label="Remove CLARITY"]')!
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)
    const enter = new KeyboardEvent('keydown', {
      key: 'Enter',
      bubbles: true,
      cancelable: true,
    })
    removeClarity.dispatchEvent(enter)
    expect(enter.defaultPrevented).toBe(false)
    expect(boardKey).not.toHaveBeenCalled()
    expect(removeClarity.parentElement!.querySelector('.tk-name')).toHaveAttribute('contenteditable', 'false')

    removeClarity.click()
    expect(mounted.commits[0]).toMatchObject({ label: 'Remove priority' })
    expect(mounted.commits[0].mod.state.items.map(({ label }) => label)).toEqual([
      'DEPTH',
      'BREVITY',
    ])
    expect(mounted.commits[0].mod.state.perm).toEqual([1, 0])
    expect(mounted.root.querySelector('[role="listitem"]:focus')).toBeInTheDocument()

    // At the two-item floor removal retires entirely.
    expect(mounted.root.querySelectorAll('[role="listitem"]')).toHaveLength(2)
    expect(mounted.root.querySelector('.row-x')).not.toBeInTheDocument()
  })

  it('refreshes list and removal names when non-structural source text changes', () => {
    const mounted = mountOrder()
    const updated = structuredClone(mounted.mod)
    updated.title = 'DECISION ORDER'
    updated.state.items[0].label = 'EVIDENCE'

    mounted.host.update({ mod: updated, selected: true, canEdit: true })

    expect(mounted.root.querySelector('[role="list"]')).toHaveAccessibleName('DECISION ORDER ranking')
    expect(mounted.root.querySelector('[aria-label="Remove EVIDENCE"]')).toBeInTheDocument()
    expect(mounted.root.querySelector('[data-mod-part-id="item-0"]')).toHaveAccessibleName(
      'EVIDENCE, rank 1 of 3',
    )
  })

  it('keeps same-slot drag frames restricted to compositor style mutations', () => {
    const mounted = mountOrder()
    const list = mounted.root.querySelector<HTMLElement>('[role="list"]')!
    const tokens = [...list.querySelectorAll<HTMLElement>('[role="listitem"]')]
    tokens.forEach((token, rank) => {
      token.getBoundingClientRect = vi.fn(() => tokenRect(0, rank * 30, 140, 24))
      Object.assign(token, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
    })
    const observer = new MutationObserver(() => undefined)
    observer.observe(list, { attributes: true, characterData: true, childList: true, subtree: true })

    tokens[0].dispatchEvent(pointerEvent('pointerdown', { clientY: 12 }))
    observer.takeRecords()
    tokens[0].dispatchEvent(pointerEvent('pointermove', { clientY: 17 }))
    mounted.scheduler.flush()
    const frameMutations = observer.takeRecords()
    observer.disconnect()

    expect(frameMutations.length).toBeGreaterThan(0)
    expect(frameMutations.every((record) => (
      record.type === 'attributes' && record.attributeName === 'style'
    ))).toBe(true)
  })

  it('rolls back a queued reorder and releases gesture ownership on teardown', () => {
    const mounted = mountOrder()
    const tokens = [...mounted.root.querySelectorAll<HTMLElement>('[role="listitem"]')]
    const releasePointerCapture = vi.fn()
    tokens.forEach((token, rank) => {
      token.getBoundingClientRect = vi.fn(() => tokenRect(0, rank * 30, 140, 24))
      Object.assign(token, { setPointerCapture: vi.fn(), releasePointerCapture })
    })

    tokens[0].dispatchEvent(pointerEvent('pointerdown', { clientY: 12 }))
    tokens[0].dispatchEvent(pointerEvent('pointermove', { clientY: 72 }))
    expect(mounted.scheduler.pending()).toBe(1)

    mounted.host.dispose()

    expect(mounted.gestures).toEqual([true, false])
    expect(mounted.scheduler.pending()).toBe(0)
    expect(mounted.commits).toHaveLength(0)
    expect(releasePointerCapture).toHaveBeenCalledWith(12)
    expect(mounted.root.childElementCount).toBe(0)
  })

  it('keeps a local transform preview alive across a same-source host update', () => {
    const mounted = mountOrder()
    const tokens = [...mounted.root.querySelectorAll<HTMLElement>('[role="listitem"]')]
    tokens.forEach((token, rank) => {
      token.getBoundingClientRect = vi.fn(() => tokenRect(0, rank * 30, 140, 24))
      Object.assign(token, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() })
    })

    tokens[0].dispatchEvent(pointerEvent('pointerdown', { clientY: 12 }))
    tokens[0].dispatchEvent(pointerEvent('pointermove', { clientY: 72 }))
    mounted.scheduler.flush()
    mounted.host.update({ mod: mounted.mod, selected: true, canEdit: true })

    expect(mounted.gestures).toEqual([true])
    expect(tokens[0]).toBeInTheDocument()
    expect(tokens[0].style.getPropertyValue('--e-mod-face-order-shift')).toBe('2.5')

    tokens[0].dispatchEvent(pointerEvent('pointerup', { clientY: 72 }))
    expect(mounted.gestures).toEqual([true, false])
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].mod.state.perm).toEqual([1, 2, 0])
  })
})
