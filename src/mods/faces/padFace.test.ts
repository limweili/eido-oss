// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Mod } from '../model'
import { readModContext } from '../prompt'
import { createSeedMod } from '../seeds'
import { cloneDetached } from '../snapshot'
import { mountModFaceHost } from './host'
import { padFaceDefinition } from './padFace'
import type { AnimationFrameScheduler } from './pointerGesture'

function pointerEvent(
  type: string,
  { pointerId = 7, button = 0, clientX = 0, clientY = 0 } = {},
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

function rect(left: number, top: number, width: number, height: number): DOMRect {
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

function mountPad({ selected = true, mod = createSeedMod('pad') } = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  const scheduler = frameHarness()
  const commits: Array<{ mod: Mod<'pad'>; label: string }> = []
  const gestures: boolean[] = []
  const host = mountModFaceHost({
    root,
    definition: padFaceDefinition,
    mod,
    selected,
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

function preparePad(
  root: HTMLElement,
  { left, top, width, height }: { left: number; top: number; width: number; height: number },
) {
  const pad = root.querySelector<HTMLElement>('.i-pad')!
  const plane = root.querySelector<HTMLElement>('.i-pad-plane')!
  pad.getBoundingClientRect = vi.fn(() => { throw new Error('the outer well is not the value seam') })
  plane.getBoundingClientRect = vi.fn(() => rect(left, top, width, height))
  Object.assign(pad, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  })
  return { pad, plane }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('the reference pad face', () => {
  it('derives both values from the rendered inner plane at two non-1 zoom scales', () => {
    const run = (planeRect: { left: number; top: number; width: number; height: number }) => {
      const mounted = mountPad()
      const { pad, plane } = preparePad(mounted.root, planeRect)
      const moveX = planeRect.left + planeRect.width * 0.7
      const moveY = planeRect.top + planeRect.height * 0.4
      const releaseX = planeRect.left + planeRect.width * 0.75
      const releaseY = planeRect.top + planeRect.height * 0.25

      pad.dispatchEvent(pointerEvent('pointerdown', {
        clientX: planeRect.left + planeRect.width * 0.2,
        clientY: planeRect.top + planeRect.height * 0.8,
      }))
      pad.dispatchEvent(pointerEvent('pointermove', { clientX: moveX, clientY: moveY }))
      expect(mounted.scheduler.pending()).toBe(1)
      mounted.scheduler.flush()
      expect(pad.style.getPropertyValue('--e-mod-face-x')).toBe('0.7000')
      expect(pad.style.getPropertyValue('--e-mod-face-y')).toBe('0.6000')
      expect(mounted.commits).toHaveLength(0)

      pad.dispatchEvent(pointerEvent('pointerup', { clientX: releaseX, clientY: releaseY }))
      expect(plane.getBoundingClientRect).toHaveBeenCalledOnce()
      expect(pad.getBoundingClientRect).not.toHaveBeenCalled()
      expect(mounted.commits).toHaveLength(1)
      expect(mounted.commits[0]).toMatchObject({ label: 'Adjust pad' })
      expect(mounted.gestures).toEqual([true, false])
      const value = mounted.commits[0].mod.state.v
      mounted.host.dispose()
      return value
    }

    expect(run({ left: 20, top: 30, width: 100, height: 80 })).toEqual({ x: 75, y: 75 })
    expect(run({ left: 120, top: 220, width: 400, height: 320 })).toEqual({ x: 75, y: 75 })
  })

  it('exposes two keyboard sliders and immediately reflects renamed ends in speech', () => {
    const mounted = mountPad({ selected: false })
    const x = mounted.root.querySelector<HTMLElement>('[data-pad-axis="x"]')!
    const y = mounted.root.querySelector<HTMLElement>('[data-pad-axis="y"]')!
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)

    x.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(boardKey).toHaveBeenCalledOnce()
    expect(mounted.commits).toHaveLength(0)
    expect(x).toHaveAttribute('role', 'slider')
    expect(x).toHaveAttribute('aria-orientation', 'horizontal')
    expect(y).toHaveAttribute('aria-orientation', 'vertical')
    expect(x).toHaveAttribute('aria-disabled', 'true')
    expect(x.tabIndex).toBe(-1)

    mounted.host.update({ mod: mounted.mod, selected: true, canEdit: true })
    const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    x.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    expect(boardKey).toHaveBeenCalledOnce()
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].mod.state.v.x).toBe(63)
    expect(x).toHaveAttribute('aria-valuenow', '63')
    expect(x).toHaveAttribute('aria-valuetext', '63% of the way from cool to warm')

    const renamed = cloneDetached(mounted.commits[0].mod)
    renamed.state.axes.x.lo = 'STILL'
    renamed.state.axes.x.hi = 'ELECTRIC'
    mounted.host.update({ mod: renamed, selected: true, canEdit: true })

    expect(mounted.root.querySelector('.i-pad-end--xlo')).toHaveTextContent('STILL')
    expect(mounted.root.querySelector('.i-pad-end--xhi')).toHaveTextContent('ELECTRIC')
    expect(x).toHaveAttribute('aria-valuetext', '63% of the way from still to electric')
    expect(readModContext(renamed).sentences[0].text).toBe(
      'Warmth: 63% of the way from still to electric.',
    )
  })

  it('draws snap decoration from the two axis stop counts', () => {
    const mod = createSeedMod('pad')
    mod.state.axes.x.steps = 2
    mod.state.axes.y.steps = 3
    const mounted = mountPad({ mod })

    const dots = [...mounted.root.querySelectorAll<HTMLElement>('.i-pad-snap')]
    expect(dots).toHaveLength(12)
    expect(dots[0].style.getPropertyValue('--e-mod-face-snap-x')).toBe('0.0000')
    expect(dots[0].style.getPropertyValue('--e-mod-face-snap-y')).toBe('1.0000')
    expect(dots[dots.length - 1].style.getPropertyValue('--e-mod-face-snap-x')).toBe('1.0000')
    expect(dots[dots.length - 1].style.getPropertyValue('--e-mod-face-snap-y')).toBe('0.0000')
  })

  it('cancels a live gesture and queued paint when the face is disposed', () => {
    const mounted = mountPad()
    const { pad } = preparePad(mounted.root, { left: 0, top: 0, width: 100, height: 100 })

    pad.dispatchEvent(pointerEvent('pointerdown', { clientX: 30, clientY: 70 }))
    pad.dispatchEvent(pointerEvent('pointermove', { clientX: 80, clientY: 20 }))
    expect(mounted.scheduler.pending()).toBe(1)

    mounted.host.dispose()

    expect(mounted.gestures).toEqual([true, false])
    expect(mounted.scheduler.pending()).toBe(0)
    expect(mounted.commits).toHaveLength(0)
    expect(pad.releasePointerCapture).toHaveBeenCalledWith(7)
    expect(mounted.root.childElementCount).toBe(0)
  })
})
