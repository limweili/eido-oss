// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mod } from '../model'
import { createSeedMod } from '../seeds'
import { filterFaceDefinition } from './filterFace'
import { mountModFaceHost } from './host'
import type { AnimationFrameScheduler } from './pointerGesture'

function pointerEvent(
  type: string,
  { pointerId = 9, button = 0, clientX = 0, clientY = 0 } = {},
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

class ResizeObserverHarness {
  static instances: ResizeObserverHarness[] = []

  readonly callback: ResizeObserverCallback
  disconnected = false

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback
    ResizeObserverHarness.instances.push(this)
  }

  observe() {}
  unobserve() {}

  disconnect() {
    this.disconnected = true
  }

  fire() {
    this.callback([], this as unknown as ResizeObserver)
  }
}

function mountFilter({
  configure,
  commitResult = true,
  selected = true,
}: {
  configure?: (mod: Mod<'filter'>) => void
  commitResult?: boolean
  selected?: boolean
} = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  const scheduler = frameHarness()
  const commits: Array<{ mod: Mod<'filter'>; label: string }> = []
  const gestures: boolean[] = []
  const mod = createSeedMod('filter', { createId: (_, ordinal) => `filter-${ordinal}` })
  configure?.(mod)
  const host = mountModFaceHost({
    root,
    definition: filterFaceDefinition,
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

function prepareWell(root: HTMLElement, left: number, width: number, scale: number) {
  const well = root.querySelector<HTMLElement>('.i-filter')!
  const geometry = well.querySelector<HTMLElement>('.i-filter-geometry')!
  well.getBoundingClientRect = vi.fn(() => rect(left - 10 * scale, 20, width + 20 * scale, 84 * scale))
  geometry.getBoundingClientRect = vi.fn(() => rect(left, 20, width, 84 * scale))
  Object.defineProperties(well, {
    clientWidth: {
      configurable: true,
      get: () => { throw new Error('layout pixels are not the filter geometry seam') },
    },
    clientHeight: {
      configurable: true,
      get: () => { throw new Error('layout pixels are not the filter geometry seam') },
    },
  })
  Object.assign(well, {
    setPointerCapture: vi.fn(),
    releasePointerCapture: vi.fn(),
  })
  return { well, geometry }
}

beforeEach(() => {
  ResizeObserverHarness.instances = []
  vi.stubGlobal('ResizeObserver', ResizeObserverHarness)
})

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('the reference filter face', () => {
  it('lands the same boundary from the rendered inner geometry at two non-1 zoom scales', () => {
    const run = (left: number, width: number, scale: number) => {
      const mounted = mountFilter()
      const { well, geometry } = prepareWell(mounted.root, left, width, scale)
      const clientX = left + width * 0.75

      well.dispatchEvent(pointerEvent('pointerdown', { clientX }))
      well.dispatchEvent(pointerEvent('pointerup', { clientX }))

      expect(geometry.getBoundingClientRect).toHaveBeenCalled()
      expect(mounted.commits).toHaveLength(1)
      expect(mounted.commits[0].label).toBe('Adjust filter')
      expect(mounted.commits[0].mod.state.lanes[0]).toMatchObject({ lo: 0, hi: 75 })
      mounted.host.dispose()
      return mounted.commits[0].mod.state.lanes[0].hi
    }

    expect(run(30, 140, 0.5)).toBe(75)
    expect(run(130, 560, 2)).toBe(75)
  })

  it('moves a between band while preserving its width and closes the wash at the curve start', () => {
    const mounted = mountFilter({
      configure: (mod) => {
        mod.state.lanes[0].mode = 'between'
        mod.state.lanes[0].lo = 25
        mod.state.lanes[0].hi = 75
      },
    })
    const { well } = prepareWell(mounted.root, 40, 400, 1)

    well.dispatchEvent(pointerEvent('pointerdown', { clientX: 240 }))
    well.dispatchEvent(pointerEvent('pointermove', { clientX: 320 }))
    expect(mounted.commits).toHaveLength(0)
    expect(mounted.scheduler.pending()).toBe(1)
    mounted.scheduler.flush()
    well.dispatchEvent(pointerEvent('pointerup', { clientX: 340 }))

    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].mod.state.lanes[0]).toMatchObject({ lo: 50, hi: 100 })
    const curvePath = mounted.root.querySelector<SVGPathElement>('.curve')!.getAttribute('d')!
    const washPath = mounted.root.querySelector<SVGPathElement>('.wash')!.getAttribute('d')!
    const curveStart = /^M([^ ]+)/.exec(curvePath)![1]
    expect(washPath.endsWith(`H${curveStart} Z`)).toBe(true)
    expect(mounted.gestures).toEqual([true, false])
  })

  it('keeps detent decoration stable on drag frames and rebuilds it only after rendered geometry changes', () => {
    const mounted = mountFilter()
    let renderedWidth = 280
    const { well, geometry } = prepareWell(mounted.root, 20, renderedWidth, 1)
    geometry.getBoundingClientRect = vi.fn(() => rect(20, 20, renderedWidth, 84))
    well.getBoundingClientRect = vi.fn(() => rect(10, 20, renderedWidth + 20, 84))
    const observer = ResizeObserverHarness.instances[0]
    observer.fire()
    const before = [...mounted.root.querySelectorAll('.det')]
    expect(before).toHaveLength(5)

    well.dispatchEvent(pointerEvent('pointerdown', { clientX: 160 }))
    well.dispatchEvent(pointerEvent('pointermove', { clientX: 190 }))
    mounted.scheduler.flush()
    expect([...mounted.root.querySelectorAll('.det')]).toEqual(before)
    well.dispatchEvent(pointerEvent('pointerup', { clientX: 200 }))
    expect([...mounted.root.querySelectorAll('.det')]).toEqual(before)

    renderedWidth = 560
    observer.fire()
    const after = [...mounted.root.querySelectorAll('.det')]
    expect(after).toHaveLength(5)
    expect(after[0]).not.toBe(before[0])
  })

  it('cycles mode, supports keyboard adjustment, and removes lanes with atomic commits', () => {
    const mounted = mountFilter()
    const well = mounted.root.querySelector<HTMLElement>('[role="slider"]')!
    const chip = mounted.root.querySelector<HTMLButtonElement>('.e-chip-key')!
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)

    expect(well).toHaveAttribute('aria-valuetext', 'no more than a section')
    chip.click()
    expect(mounted.commits[0]).toMatchObject({ label: 'Change filter mode' })
    expect(mounted.commits[0].mod.state.lanes[0]).toMatchObject({ mode: 'at-least', lo: 0, hi: 100 })

    const key = new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true })
    well.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    expect(boardKey).not.toHaveBeenCalled()
    expect(mounted.commits[1].mod.state.lanes[0]).toMatchObject({ lo: 25, hi: 100 })
    expect(well).toHaveAttribute('aria-valuetext', 'at least a paragraph')

    // Growth moved to the card head's + key (ModCard); removal appears once a
    // second lane exists.
    expect(mounted.root.querySelector('.mod-add--filter')).toBeNull()
    const twoLanes = structuredClone(mounted.commits[1].mod)
    twoLanes.state.lanes.push({
      id: 'lane-2', label: 'LIMIT 2', mode: 'no-more-than', lo: 0, hi: 60, frame: '',
    })
    mounted.host.update({ mod: twoLanes, selected: true, canEdit: true })
    expect(mounted.root.querySelectorAll('.i-filter')).toHaveLength(2)
    mounted.root.querySelector<HTMLButtonElement>('.mod-row-head .row-x')!.click()
    expect(mounted.commits[2].label).toBe('Remove filter')
    expect(mounted.commits[2].mod.state.lanes).toHaveLength(1)
  })

  it('rolls back a rejected gesture and disconnects observers while cancelling queued work', () => {
    const mounted = mountFilter({ commitResult: false })
    const { well } = prepareWell(mounted.root, 0, 280, 1)
    const observer = ResizeObserverHarness.instances[0]

    well.dispatchEvent(pointerEvent('pointerdown', { clientX: 140 }))
    well.dispatchEvent(pointerEvent('pointermove', { clientX: 210 }))
    mounted.scheduler.flush()
    expect(well).toHaveAttribute('aria-valuenow', '75')
    well.dispatchEvent(pointerEvent('pointerup', { clientX: 210 }))

    expect(mounted.commits).toHaveLength(1)
    expect(well).toHaveAttribute('aria-valuenow', '50')
    expect(mounted.gestures).toEqual([true, false])

    well.dispatchEvent(pointerEvent('pointerdown', { clientX: 140 }))
    well.dispatchEvent(pointerEvent('pointermove', { clientX: 180 }))
    expect(mounted.scheduler.pending()).toBe(1)
    mounted.host.dispose()
    expect(observer.disconnected).toBe(true)
    expect(mounted.scheduler.pending()).toBe(0)
    expect(mounted.gestures).toEqual([true, false, true, false])
    expect(well.releasePointerCapture).toHaveBeenCalledWith(9)
  })
})
