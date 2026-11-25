// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mod } from '../model'
import { createSeedMod } from '../seeds'
import { mountModFaceHost } from './host'
import { mixerFaceDefinition } from './mixerFace'
import type { AnimationFrameScheduler } from './pointerGesture'

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

function rect(top: number, height: number): DOMRect {
  return {
    x: 0,
    y: top,
    left: 0,
    top,
    right: 300,
    bottom: top + height,
    width: 300,
    height,
    toJSON: () => ({}),
  }
}

function mountMixer({ selected = true, commitResult = true } = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  const scheduler = frameHarness()
  const commits: Array<{ mod: Mod<'mixer'>; label: string }> = []
  const gestures: boolean[] = []
  const mod = createSeedMod('mixer', { createId: (_, ordinal) => `mixer-${ordinal}` })
  const host = mountModFaceHost({
    root,
    definition: mixerFaceDefinition,
    mod,
    selected,
    canEdit: true,
    animationFrames: scheduler,
    onGestureChange: (active) => gestures.push(active),
    commit: (next, label) => {
      commits.push({ mod: next, label })
      return commitResult
    },
  })
  return { root, scheduler, commits, gestures, mod, host }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('the reference mixer face', () => {
  it('trades share between two neighbours from the rendered well rect at two non-1 zoom scales', () => {
    const run = (top: number, height: number, pointerDelta: number) => {
      const mounted = mountMixer()
      const well = mounted.root.querySelector<HTMLElement>('.i-bd')!
      const grip = mounted.root.querySelector<HTMLElement>('.bd-grip')!
      well.getBoundingClientRect = vi.fn(() => rect(top, height))
      Object.defineProperty(well, 'clientHeight', {
        configurable: true,
        get: () => { throw new Error('layout pixels are not the gesture seam') },
      })
      Object.assign(grip, {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
      })

      grip.dispatchEvent(pointerEvent('pointerdown', { clientY: top + height / 2 }))
      grip.dispatchEvent(pointerEvent('pointerup', { clientY: top + height / 2 + pointerDelta }))

      expect(well.getBoundingClientRect).toHaveBeenCalled()
      expect(mounted.commits).toHaveLength(1)
      expect(mounted.commits[0].label).toBe('Adjust mixer')
      const values = mounted.commits[0].mod.state.items.map(({ v }) => v)
      expect(values).toEqual([60, 22, 18])
      expect(values.reduce((sum, value) => sum + value, 0)).toBeCloseTo(100, 10)
      expect(mounted.gestures).toEqual([true, false])
      mounted.host.dispose()
      return values
    }

    expect(run(40, 88, 8.8)).toEqual(run(140, 352, 35.2))
  })

  it('coalesces local seam paint, attempts one atomic commit, and rolls back a rejected gesture', () => {
    const mounted = mountMixer({ commitResult: false })
    const well = mounted.root.querySelector<HTMLElement>('.i-bd')!
    const grip = mounted.root.querySelector<HTMLElement>('.bd-grip')!
    well.getBoundingClientRect = vi.fn(() => rect(20, 200))
    Object.assign(grip, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })

    grip.dispatchEvent(pointerEvent('pointerdown', { clientY: 100 }))
    grip.dispatchEvent(pointerEvent('pointermove', { clientY: 120 }))
    grip.dispatchEvent(pointerEvent('pointermove', { clientY: 140 }))
    expect(mounted.commits).toHaveLength(0)
    expect(mounted.scheduler.pending()).toBe(1)

    mounted.scheduler.flush()
    expect(grip).toHaveAttribute('aria-valuenow', '70')
    expect(mounted.commits).toHaveLength(0)

    grip.dispatchEvent(pointerEvent('pointerup', { clientY: 130 }))
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].mod.state.items.map(({ v }) => v)).toEqual([65, 17, 18])
    expect(grip).toHaveAttribute('aria-valuenow', '50')
    expect(mounted.gestures).toEqual([true, false])
    expect(mounted.scheduler.pending()).toBe(0)
  })

  it('exposes a keyboard seam and keeps shares normalized through in-face removal', () => {
    const mounted = mountMixer()
    const seam = mounted.root.querySelector<HTMLElement>('[role="slider"]')!
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)

    expect(seam).toHaveAttribute('aria-label', 'Seam between CLARITY and DEPTH')
    expect(seam).toHaveAttribute('aria-valuetext', '50% clarity, 32% depth')
    const key = new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true })
    seam.dispatchEvent(key)

    expect(key.defaultPrevented).toBe(true)
    expect(boardKey).not.toHaveBeenCalled()
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].mod.state.items.map(({ v }) => v)).toEqual([51, 31, 18])

    // Growth moved to the card head's + key (ModCard); the face owns the seam
    // and removal only.
    expect(mounted.root.querySelector('.mod-add--mixer')).toBeNull()

    mounted.root.querySelector<HTMLButtonElement>('.bd-band .row-x')!.click()
    expect(mounted.commits).toHaveLength(2)
    expect(mounted.commits[1].label).toBe('Remove mixer channel')
    expect(mounted.commits[1].mod.state.items).toHaveLength(2)
    expect(mounted.commits[1].mod.state.items.reduce((sum, item) => sum + item.v, 0)).toBeCloseTo(100, 10)
  })

  it('derives thin-band visibility from rendered height and retires a live gesture on disposal', () => {
    const mounted = mountMixer()
    const well = mounted.root.querySelector<HTMLElement>('.i-bd')!
    const grip = mounted.root.querySelector<HTMLElement>('.bd-grip')!
    well.getBoundingClientRect = vi.fn(() => rect(0, 100))
    mounted.host.update({ mod: mounted.mod, selected: true, canEdit: true })

    const bands = mounted.root.querySelectorAll<HTMLElement>('.bd-band')
    expect(bands[0]).not.toHaveClass('is-thin')
    expect(bands[2]).toHaveClass('is-thin')

    Object.assign(grip, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    grip.dispatchEvent(pointerEvent('pointerdown', { clientY: 20 }))
    grip.dispatchEvent(pointerEvent('pointermove', { clientY: 40 }))
    expect(mounted.scheduler.pending()).toBe(1)

    mounted.host.dispose()
    expect(mounted.gestures).toEqual([true, false])
    expect(mounted.scheduler.pending()).toBe(0)
    expect(mounted.commits).toHaveLength(0)
    expect(grip.releasePointerCapture).toHaveBeenCalledWith(8)
    expect(mounted.root.childElementCount).toBe(0)
  })
})
