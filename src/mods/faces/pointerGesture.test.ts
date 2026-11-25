// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { mountPointerGesture, type AnimationFrameScheduler } from './pointerGesture'

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

describe('pointer gesture lifecycle', () => {
  it('leaves disabled surfaces unclaimed so the board can select or move the card', () => {
    const parent = document.createElement('div')
    const surface = document.createElement('div')
    parent.append(surface)
    const bubbled = vi.fn()
    parent.addEventListener('pointerdown', bubbled)
    const start = vi.fn(() => ({ startX: 0 }))
    mountPointerGesture(surface, {
      isEnabled: () => false,
      start,
      frame: vi.fn(),
      complete: vi.fn(),
    })

    const event = pointerEvent('pointerdown', { clientX: 20 })
    surface.dispatchEvent(event)

    expect(start).not.toHaveBeenCalled()
    expect(event.defaultPrevented).toBe(false)
    expect(bubbled).toHaveBeenCalledOnce()
  })

  it('fully claims one pointer, coalesces frames, and flushes the exact release before one completion', () => {
    const parent = document.createElement('div')
    const surface = document.createElement('div')
    parent.append(surface)
    const bubbled = vi.fn()
    parent.addEventListener('pointerdown', bubbled)
    parent.addEventListener('pointermove', bubbled)
    parent.addEventListener('pointerup', bubbled)
    const setPointerCapture = vi.fn()
    const releasePointerCapture = vi.fn()
    Object.assign(surface, { setPointerCapture, releasePointerCapture })
    const scheduler = frameHarness()
    const frames: number[] = []
    const complete = vi.fn()
    const controller = mountPointerGesture(surface, {
      scheduler,
      isEnabled: () => true,
      start: (event) => ({ startX: event.clientX }),
      frame: (_session, event) => frames.push(event.clientX),
      complete,
    })

    const down = pointerEvent('pointerdown', { clientX: 10 })
    surface.dispatchEvent(down)
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 40 }))
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 70 }))

    expect(down.defaultPrevented).toBe(true)
    expect(bubbled).not.toHaveBeenCalled()
    expect(setPointerCapture).toHaveBeenCalledWith(7)
    expect(controller.active).toBe(true)
    expect(scheduler.pending()).toBe(1)
    expect(frames).toEqual([])

    scheduler.flush()
    expect(frames).toEqual([70])

    surface.dispatchEvent(pointerEvent('pointerup', { clientX: 90 }))
    expect(frames).toEqual([70, 90])
    expect(complete).toHaveBeenCalledOnce()
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(controller.active).toBe(false)
    expect(scheduler.pending()).toBe(0)
  })

  it('cancels without completion on blur and disposal, removing every active hook', () => {
    const surface = document.createElement('div')
    const scheduler = frameHarness()
    Object.assign(surface, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    const cancel = vi.fn()
    const complete = vi.fn()
    const start = vi.fn(() => ({}))
    const controller = mountPointerGesture(surface, {
      scheduler,
      isEnabled: () => true,
      start,
      frame: vi.fn(),
      complete,
      cancel,
    })

    surface.dispatchEvent(pointerEvent('pointerdown'))
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 10 }))
    window.dispatchEvent(new Event('blur'))
    expect(cancel).toHaveBeenLastCalledWith(expect.anything(), 'window-blur')
    expect(complete).not.toHaveBeenCalled()
    expect(controller.active).toBe(false)
    expect(scheduler.pending()).toBe(0)

    surface.dispatchEvent(pointerEvent('pointerdown'))
    controller.dispose()
    expect(cancel).toHaveBeenLastCalledWith(expect.anything(), 'dispose')
    expect(controller.active).toBe(false)

    surface.dispatchEvent(pointerEvent('pointerdown'))
    expect(start).toHaveBeenCalledTimes(2)
  })

  it('retires capture and reports cancellation when a queued frame throws', () => {
    const surface = document.createElement('div')
    const scheduler = frameHarness()
    const releasePointerCapture = vi.fn()
    Object.assign(surface, {
      setPointerCapture: vi.fn(),
      releasePointerCapture,
    })
    const cancel = vi.fn()
    const complete = vi.fn()
    const controller = mountPointerGesture(surface, {
      scheduler,
      isEnabled: () => true,
      start: () => ({ gesture: true }),
      frame: () => { throw new Error('paint failed') },
      complete,
      cancel,
    })

    surface.dispatchEvent(pointerEvent('pointerdown'))
    surface.dispatchEvent(pointerEvent('pointermove', { clientX: 30 }))

    expect(() => scheduler.flush()).toThrow('paint failed')
    expect(cancel).toHaveBeenCalledWith({ gesture: true }, 'callback-error')
    expect(complete).not.toHaveBeenCalled()
    expect(releasePointerCapture).toHaveBeenCalledWith(7)
    expect(controller.active).toBe(false)
    expect(scheduler.pending()).toBe(0)
  })
})
