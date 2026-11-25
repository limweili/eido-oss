// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mod } from '../model'
import { createSeedMod } from '../seeds'
import { mountModFaceHost } from './host'
import { matrixFaceDefinition } from './matrixFace'
import type { AnimationFrameScheduler } from './pointerGesture'

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

  disconnected = false

  constructor(_callback: ResizeObserverCallback) {
    ResizeObserverHarness.instances.push(this)
  }

  observe() {}
  unobserve() {}
  disconnect() {
    this.disconnected = true
  }
}

function mountMatrix({
  configure,
  commitResult = true,
  selected = true,
}: {
  configure?: (mod: Mod<'matrix'>) => void
  commitResult?: boolean
  selected?: boolean
} = {}) {
  const root = document.createElement('div')
  document.body.append(root)
  const scheduler = frameHarness()
  const commits: Array<{ mod: Mod<'matrix'>; label: string }> = []
  const mod = createSeedMod('matrix', { createId: (_, ordinal) => `matrix-${ordinal}` })
  configure?.(mod)
  const host = mountModFaceHost({
    root,
    definition: matrixFaceDefinition,
    mod,
    selected,
    canEdit: true,
    animationFrames: scheduler,
    commit: (next, label) => {
      commits.push({ mod: next, label })
      return commitResult
    },
  })
  return { root, scheduler, commits, mod, host }
}

beforeEach(() => {
  ResizeObserverHarness.instances = []
  vi.stubGlobal('ResizeObserver', ResizeObserverHarness)
})

afterEach(() => {
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('the reference matrix face', () => {
  it('places its cell block and growth ghosts from rendered rect ratios at two non-1 zoom scales', () => {
    const run = (left: number, top: number, scale: number) => {
      const mounted = mountMatrix()
      const wrap = mounted.root.querySelector<HTMLElement>('.i-mx-wrap')!
      const grid = mounted.root.querySelector<HTMLElement>('.i-mx-grid')!
      const cells = mounted.root.querySelectorAll<HTMLElement>('.mx-cell')
      wrap.getBoundingClientRect = () => rect(left, top, 300 * scale, 200 * scale)
      grid.getBoundingClientRect = () => rect(left + 40 * scale, top + 20 * scale, 220 * scale, 120 * scale)
      cells[0].getBoundingClientRect = () => rect(left + 100 * scale, top + 40 * scale, 44 * scale, 44 * scale)
      cells[cells.length - 1].getBoundingClientRect = () => rect(
        left + 188 * scale,
        top + 84 * scale,
        44 * scale,
        44 * scale,
      )

      mounted.scheduler.flush()
      const geometry = [
        '--e-mod-matrix-left',
        '--e-mod-matrix-top',
        '--e-mod-matrix-width',
        '--e-mod-matrix-height',
      ].map((property) => wrap.style.getPropertyValue(property))
      mounted.host.dispose()
      return geometry
    }

    expect(run(20, 30, 0.5)).toEqual(run(120, 230, 2))
    expect(run(20, 30, 0.5)).toEqual(['33.3333%', '20.0000%', '44.0000%', '44.0000%'])
  })

  it('steps cells by click and keyboard while speaking row, column, and grade names', () => {
    const mounted = mountMatrix()
    const cell = mounted.root.querySelector<HTMLButtonElement>('.mx-cell')!
    const boardKey = vi.fn()
    mounted.root.parentElement!.addEventListener('keydown', boardKey)

    expect(cell).toHaveAccessibleName('WARMTH on INTRO: strongly')
    expect(cell).toHaveAttribute('aria-valuetext', 'strongly')
    cell.click()
    expect(mounted.commits).toHaveLength(1)
    expect(mounted.commits[0].label).toBe('Step matrix cell')
    expect(mounted.commits[0].mod.state.cells[0][0]).toBe(0)
    expect(cell).toHaveAccessibleName('WARMTH on INTRO: none')

    const key = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true })
    cell.dispatchEvent(key)
    expect(key.defaultPrevented).toBe(true)
    expect(boardKey).not.toHaveBeenCalled()
    expect(mounted.commits).toHaveLength(2)
    expect(mounted.commits[1].mod.state.cells[0][0]).toBe(2)
    expect(cell).toHaveAccessibleName('WARMTH on INTRO: strongly')
  })

  it('announces only named matrix pairs and preserves the visible-silence sentence when empty', () => {
    const populated = mountMatrix()
    expect(populated.root.querySelector('.mx-summary')).toHaveTextContent(
      'Warmth: intro strongly, close lightly. Detail: body lightly.',
    )
    populated.host.dispose()

    const empty = mountMatrix({
      configure: (mod) => {
        mod.state.cells = mod.state.cells.map((row) => row.map(() => 0))
      },
    })
    expect(empty.root.querySelector('.mx-summary')).toHaveTextContent(
      'every cell is empty, says nothing.',
    )
    for (const cell of empty.root.querySelectorAll('.mx-cell')) {
      expect(cell).toHaveAttribute('aria-valuetext', 'none')
    }
  })

  it('grows and removes both axes in-face while keeping the rectangular cell model', () => {
    const mounted = mountMatrix()
    mounted.root.querySelector<HTMLButtonElement>('.mx-ghost--row')!.click()
    expect(mounted.commits[0].label).toBe('Add matrix row')
    expect(mounted.commits[0].mod.state.cells).toHaveLength(3)
    expect(mounted.root.querySelectorAll('.mx-cell')).toHaveLength(9)

    mounted.root.querySelector<HTMLButtonElement>('.mx-ghost--column')!.click()
    expect(mounted.commits[1].label).toBe('Add matrix column')
    expect(mounted.commits[1].mod.state.cells.every((row) => row.length === 4)).toBe(true)
    expect(mounted.root.querySelectorAll('.mx-cell')).toHaveLength(12)

    mounted.root.querySelector<HTMLButtonElement>('.mx-lbl--row .row-x')!.click()
    expect(mounted.commits[2].label).toBe('Remove matrix row')
    expect(mounted.root.querySelectorAll('.mx-cell')).toHaveLength(8)
    mounted.root.querySelector<HTMLButtonElement>('.mx-lbl--col .row-x')!.click()
    expect(mounted.commits[3].label).toBe('Remove matrix column')
    expect(mounted.root.querySelectorAll('.mx-cell')).toHaveLength(6)
  })

  it('keeps a rejected step failure-atomic and cancels placement plus observers on disposal', () => {
    const mounted = mountMatrix({ commitResult: false })
    const cell = mounted.root.querySelector<HTMLButtonElement>('.mx-cell')!
    const observer = ResizeObserverHarness.instances[0]

    cell.click()
    expect(mounted.commits).toHaveLength(1)
    expect(cell).toHaveAccessibleName('WARMTH on INTRO: strongly')
    expect(mounted.scheduler.pending()).toBe(1)

    mounted.host.dispose()
    expect(observer.disconnected).toBe(true)
    expect(mounted.scheduler.pending()).toBe(0)
    cell.click()
    expect(mounted.commits).toHaveLength(1)
  })
})
