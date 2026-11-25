// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createSeedMod } from '../seeds'
import { mountModFaceHost } from './host'
import type { AnimationFrameScheduler } from './pointerGesture'
import { sliderFaceDefinition } from './sliderFace'
import type { Mod } from '../model'

function pointerEvent(
  type: string,
  { pointerId = 4, button = 0, clientX = 0, clientY = 0 } = {},
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

function rect(left: number, width: number): DOMRect {
  return {
    x: left,
    y: 0,
    left,
    top: 0,
    right: left + width,
    bottom: 24,
    width,
    height: 24,
    toJSON: () => ({}),
  }
}

function mountSlider({ selected = true } = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  const scheduler = frameHarness()
  const commits: Array<{ mod: Mod<'slider'>; label: string }> = []
  const gestures: boolean[] = []
  const mod = createSeedMod('slider', { createId: (_, ordinal) => `slider-${ordinal}` })
  const host = mountModFaceHost({
    root,
    definition: sliderFaceDefinition,
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

function prepareTrack(root: HTMLElement, left: number, width: number) {
  const track = root.querySelector<HTMLElement>('[role="slider"]')!
  const rail = track.querySelector<HTMLElement>('.i-rail')!
  track.getBoundingClientRect = vi.fn(() => { throw new Error('track rect is not the value seam') })
  rail.getBoundingClientRect = vi.fn(() => rect(left, width))
  Object.assign(track, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  })
  return { track, rail }
}

afterEach(() => {
  document.body.replaceChildren()
})

describe('the reference slider face', () => {
  it('derives the same value from the rendered inner rail at two non-1 zoom scales', () => {
    const run = (left: number, width: number) => {
      const mounted = mountSlider()
      const { track, rail } = prepareTrack(mounted.root, left, width)
      const clientX = left + width * 0.75
      track.dispatchEvent(pointerEvent('pointerdown', { clientX }))
      track.dispatchEvent(pointerEvent('pointerup', { clientX }))
      expect(rail.getBoundingClientRect).toHaveBeenCalled()
      expect(track.getBoundingClientRect).not.toHaveBeenCalled()
      expect(mounted.commits).toHaveLength(1)
      const value = mounted.commits[0].mod.state.items[0].v
      mounted.host.dispose()
      return value
    }

    expect(run(20, 100)).toBe(75)
    expect(run(120, 400)).toBe(75)
  })

  it('paints coalesced local frames and commits exactly once at the release coordinate', () => {
    const mounted = mountSlider()
    const { track } = prepareTrack(mounted.root, 100, 400)

    track.dispatchEvent(pointerEvent('pointerdown', { clientX: 200 }))
    track.dispatchEvent(pointerEvent('pointermove', { clientX: 340 }))
    track.dispatchEvent(pointerEvent('pointermove', { clientX: 380 }))

    expect(mounted.gestures).toEqual([true])
    expect(mounted.commits).toHaveLength(0)
    expect(mounted.scheduler.pending()).toBe(1)

    mounted.scheduler.flush()
    expect(track.style.getPropertyValue('--e-mod-face-ratio')).toBe('0.7000')
    expect(mounted.commits).toHaveLength(0)

    track.dispatchEvent(pointerEvent('pointerup', { clientX: 420 }))
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0]).toMatchObject({ label: 'Adjust slider' })
    expect(mounted.commits[0].mod.state.items[0].v).toBe(80)
    expect(mounted.gestures).toEqual([true, false])
    expect(mounted.scheduler.pending()).toBe(0)
  })

  it('leaves unselected instruments inert, then exposes keyboard and ARIA behavior when editable', () => {
    const mounted = mountSlider({ selected: false })
    const { track } = prepareTrack(mounted.root, 0, 100)
    const boardPointer = vi.fn()
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('pointerdown', boardPointer)
    mounted.root.parentElement!.addEventListener('keydown', boardKey)

    track.dispatchEvent(pointerEvent('pointerdown', { clientX: 50 }))
    track.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }))
    expect(boardPointer).toHaveBeenCalledOnce()
    expect(boardKey).toHaveBeenCalledOnce()
    expect(mounted.commits).toHaveLength(0)
    expect(track.tabIndex).toBe(-1)
    expect(track).toHaveAttribute('aria-disabled', 'true')

    mounted.host.update({ mod: mounted.mod, selected: true, canEdit: true })
    const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    track.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    expect(boardKey).toHaveBeenCalledOnce()
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].mod.state.items[0].v).toBe(63)
    expect(track).toHaveAttribute('aria-valuenow', '63')
    expect(track).toHaveAttribute('aria-valuetext', '63%')
    expect(track).toHaveAttribute('aria-disabled', 'false')
    expect(track.tabIndex).toBe(0)
  })

  it('renames inline and removes slider rows with one discrete commit each', () => {
    // Growth moved to the card head's + key (ModCard); the face owns rename
    // and removal only.
    const mounted = mountSlider()
    const label = mounted.root.querySelector<HTMLElement>('.mod-sub')!
    label.focus()
    label.textContent = 'FRIENDLINESS'
    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))

    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].label).toBe('Rename slider')
    expect(mounted.commits[0].mod.state.items[0].label).toBe('FRIENDLINESS')
    expect(mounted.root.querySelector('.mod-add')).toBeNull()

    mounted.root.querySelector<HTMLButtonElement>('.row-x')!.click()
    expect(mounted.commits).toHaveLength(2)
    expect(mounted.commits[1].label).toBe('Remove slider')
    expect(mounted.root.querySelectorAll('[role="slider"]')).toHaveLength(1)
  })

  it('cancels a live gesture and every queued frame when the face is disposed', () => {
    const mounted = mountSlider()
    const { track } = prepareTrack(mounted.root, 0, 100)

    track.dispatchEvent(pointerEvent('pointerdown', { clientX: 30 }))
    track.dispatchEvent(pointerEvent('pointermove', { clientX: 80 }))
    expect(mounted.scheduler.pending()).toBe(1)

    mounted.host.dispose()

    expect(mounted.gestures).toEqual([true, false])
    expect(mounted.scheduler.pending()).toBe(0)
    expect(mounted.commits).toHaveLength(0)
    expect(track.releasePointerCapture).toHaveBeenCalledWith(4)
    expect(mounted.root.childElementCount).toBe(0)

    track.dispatchEvent(pointerEvent('pointerup', { clientX: 90 }))
    mounted.scheduler.flush()
    expect(mounted.commits).toHaveLength(0)
  })
})
