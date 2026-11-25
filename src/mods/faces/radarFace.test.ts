// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mod } from '../model'
import { createSeedMod } from '../seeds'
import { mountModFaceHost } from './host'
import type { AnimationFrameScheduler } from './pointerGesture'
import { radarFaceDefinition } from './radarFace'

function pointerEvent(
  type: string,
  { pointerId = 11, button = 0, clientX = 0, clientY = 0 } = {},
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

  readonly observe = vi.fn((target: Element) => { this.target = target })
  readonly unobserve = vi.fn()
  readonly disconnect = vi.fn()
  private target: Element | null = null

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverHarness.instances.push(this)
  }

  emit() {
    if (!this.target) return
    this.callback([{ target: this.target } as ResizeObserverEntry], this as unknown as ResizeObserver)
  }
}

type PreparedRadar = {
  well: HTMLElement
  chartPlane: HTMLElement
  labelPlane: HTMLElement
  svg: SVGSVGElement
  scale: number
  left: number
  top: number
}

function prepareRadar(
  root: HTMLElement,
  { scale, left, top }: { scale: number; left: number; top: number },
): PreparedRadar {
  const well = root.querySelector<HTMLElement>('.i-radar')!
  const chartPlane = root.querySelector<HTMLElement>('.i-radar-plane')!
  const labelPlane = root.querySelector<HTMLElement>('.i-radar-label-plane')!
  const svg = root.querySelector<SVGSVGElement>('.i-radar-svg')!

  well.getBoundingClientRect = vi.fn(() => rect(left, top, 300 * scale, 240 * scale))
  chartPlane.getBoundingClientRect = vi.fn(() => rect(
    left + 100 * scale,
    top + 32 * scale,
    100 * scale,
    176 * scale,
  ))
  labelPlane.getBoundingClientRect = vi.fn(() => rect(
    left + 84 * scale,
    top + 16 * scale,
    132 * scale,
    208 * scale,
  ))
  const matrix = {
    a: scale,
    b: 0,
    c: 0,
    d: scale,
    e: left,
    f: top,
    inverse: () => ({
      a: 1 / scale,
      b: 0,
      c: 0,
      d: 1 / scale,
      e: -left / scale,
      f: -top / scale,
    }),
  }
  svg.getScreenCTM = vi.fn(() => matrix as unknown as DOMMatrix)
  ResizeObserverHarness.instances[ResizeObserverHarness.instances.length - 1].emit()
  return { well, chartPlane, labelPlane, svg, scale, left, top }
}

function clientPoint(prepared: PreparedRadar, x: number, y: number) {
  return {
    clientX: prepared.left + x * prepared.scale,
    clientY: prepared.top + y * prepared.scale,
  }
}

function mountRadar({ selected = true, mod = createSeedMod('radar') } = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  const scheduler = frameHarness()
  const commits: Array<{ mod: Mod<'radar'>; label: string }> = []
  const gestures: boolean[] = []
  const host = mountModFaceHost({
    root,
    definition: radarFaceDefinition,
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

function firstVertex(root: HTMLElement): SVGCircleElement {
  return root.querySelector<SVGCircleElement>('.rd-vert')!
}

beforeEach(() => {
  ResizeObserverHarness.instances = []
  vi.stubGlobal('ResizeObserver', ResizeObserverHarness)
})

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('the reference radar face', () => {
  it('projects a vertex drag through the client-to-SVG transform at two non-1 zoom scales', () => {
    const run = (scale: number, left: number, top: number) => {
      const mounted = mountRadar()
      const prepared = prepareRadar(mounted.root, { scale, left, top })
      const vertex = firstVertex(mounted.root)
      Object.assign(vertex, {
        setPointerCapture: vi.fn(),
        releasePointerCapture: vi.fn(),
      })

      vertex.dispatchEvent(pointerEvent('pointerdown', clientPoint(prepared, 150, 110)))
      vertex.dispatchEvent(pointerEvent('pointerup', clientPoint(prepared, 150, 80)))

      expect(prepared.svg.getScreenCTM).toHaveBeenCalled()
      expect(mounted.commits).toHaveLength(1)
      expect(mounted.commits[0]).toMatchObject({ label: 'Adjust radar axis' })
      expect(mounted.gestures).toEqual([true, false])
      const value = mounted.commits[0].mod.state.axes[0].v
      mounted.host.dispose()
      return value
    }

    expect(run(0.5, 20, 30)).toBe(80)
    expect(run(2, 120, 220)).toBe(80)
  })

  it('keeps decoration and the captured vertex stable while lite paint coalesces', () => {
    const mounted = mountRadar()
    const prepared = prepareRadar(mounted.root, { scale: 1.5, left: 40, top: 60 })
    const vertex = firstVertex(mounted.root)
    const background = mounted.root.querySelector('.rd-back')!
    const label = mounted.root.querySelector('.rd-lbl')!
    Object.assign(vertex, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })
    vi.mocked(prepared.chartPlane.getBoundingClientRect).mockClear()
    vi.mocked(prepared.labelPlane.getBoundingClientRect).mockClear()

    vertex.dispatchEvent(pointerEvent('pointerdown', clientPoint(prepared, 150, 105)))
    vertex.dispatchEvent(pointerEvent('pointermove', clientPoint(prepared, 150, 95)))
    vertex.dispatchEvent(pointerEvent('pointermove', clientPoint(prepared, 150, 85)))

    expect(mounted.scheduler.pending()).toBe(1)
    expect(mounted.commits).toHaveLength(0)
    mounted.scheduler.flush()
    expect(prepared.chartPlane.getBoundingClientRect).not.toHaveBeenCalled()
    expect(prepared.labelPlane.getBoundingClientRect).not.toHaveBeenCalled()
    expect(mounted.root.querySelector('.rd-back')).toBe(background)
    expect(mounted.root.querySelector('.rd-lbl')).toBe(label)
    expect(firstVertex(mounted.root)).toBe(vertex)

    mounted.host.update({ mod: mounted.mod, selected: true, canEdit: true })
    expect(firstVertex(mounted.root)).toBe(vertex)
    vertex.dispatchEvent(pointerEvent('pointerup', clientPoint(prepared, 150, 75)))
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].mod.state.axes[0].v).toBeCloseTo(90)
  })

  it('renames, removes, and keyboard-adjusts stable axis controls', () => {
    const mounted = mountRadar()
    prepareRadar(mounted.root, { scale: 1, left: 0, top: 0 })
    const first = firstVertex(mounted.root)
    expect(mounted.root.querySelectorAll('[role="slider"]')).toHaveLength(5)
    expect(first).toHaveAttribute('aria-valuenow', '70')
    expect(first).toHaveAttribute('aria-valuetext', '70%')
    expect(first).toHaveAttribute('aria-label', 'WARMTH radar axis')
    expect(first.closest('[aria-hidden="true"]')).toBeNull()

    const key = new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true })
    first.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    expect(mounted.commits[0]).toMatchObject({ label: 'Adjust radar axis' })
    expect(mounted.commits[0].mod.state.axes[0].v).toBe(71)

    const label = mounted.root.querySelector<HTMLElement>('.rd-lbl')!
    label.focus()
    label.textContent = 'ENERGY'
    label.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))
    expect(mounted.commits[1]).toMatchObject({ label: 'Rename radar axis' })
    expect(mounted.commits[1].mod.state.axes[0].label).toBe('ENERGY')
    expect(first).toHaveAttribute('aria-label', 'ENERGY radar axis')

    // Growth moved to the card head's + key (ModCard); the face owns rename
    // and removal only.
    expect(mounted.root.querySelector('.mod-add--radar')).toBeNull()

    mounted.root.querySelector<HTMLButtonElement>('.rd-tipwrap .row-x')!.click()
    expect(mounted.commits[2]).toMatchObject({ label: 'Remove radar axis' })
    expect(mounted.root.querySelectorAll('[role="slider"]')).toHaveLength(4)
  })

  it('leaves unselected vertices to the board and deterministically tears down observer and gesture state', () => {
    const mounted = mountRadar({ selected: false })
    const prepared = prepareRadar(mounted.root, { scale: 1, left: 0, top: 0 })
    const vertex = firstVertex(mounted.root)
    const boardPointer = vi.fn()
    mounted.root.parentElement!.addEventListener('pointerdown', boardPointer)
    Object.assign(vertex, {
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn(),
    })

    vertex.dispatchEvent(pointerEvent('pointerdown', clientPoint(prepared, 150, 90)))
    expect(boardPointer).toHaveBeenCalledOnce()
    expect(vertex.tabIndex).toBe(-1)
    expect(vertex).toHaveAttribute('aria-disabled', 'true')

    mounted.host.update({ mod: mounted.mod, selected: true, canEdit: true })
    vertex.dispatchEvent(pointerEvent('pointerdown', clientPoint(prepared, 150, 105)))
    vertex.dispatchEvent(pointerEvent('pointermove', clientPoint(prepared, 150, 80)))
    expect(mounted.scheduler.pending()).toBe(1)
    mounted.host.dispose()

    expect(ResizeObserverHarness.instances[0].disconnect).toHaveBeenCalledOnce()
    expect(mounted.gestures).toEqual([true, false])
    expect(mounted.scheduler.pending()).toBe(0)
    expect(mounted.commits).toHaveLength(0)
    expect(vertex.releasePointerCapture).toHaveBeenCalledWith(11)
    expect(mounted.root.childElementCount).toBe(0)
  })
})
