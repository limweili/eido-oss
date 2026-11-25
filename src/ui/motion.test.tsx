// @vitest-environment jsdom

import '@testing-library/jest-dom/vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  REDUCED_MOTION_QUERY,
  cameraDuration,
  commitCameraTransition,
  useAppliedReducedMotion,
} from './motion'

const { flushSyncSpy } = vi.hoisted(() => ({
  flushSyncSpy: vi.fn((command: () => void) => command()),
}))

vi.mock('react-dom', async importOriginal => ({
  ...await importOriginal<typeof import('react-dom')>(),
  flushSync: flushSyncSpy,
}))

class MutableMediaQueryList {
  matches = false
  readonly media = REDUCED_MOTION_QUERY
  readonly onchange = null
  readonly addEventListener = vi.fn((_type: string, listener: EventListener) => {
    this.listeners.add(listener)
  })
  readonly removeEventListener = vi.fn((_type: string, listener: EventListener) => {
    this.listeners.delete(listener)
  })
  readonly addListener = vi.fn()
  readonly removeListener = vi.fn()
  readonly dispatchEvent = vi.fn(() => true)
  private readonly listeners = new Set<EventListener>()

  setMatches(matches: boolean) {
    this.matches = matches
    const event = new Event('change')
    Object.defineProperty(event, 'matches', { value: matches })
    for (const listener of this.listeners) listener(event)
  }
}

function AppliedMotion() {
  return <output>{useAppliedReducedMotion() ? 'reduced' : 'full'}</output>
}

describe('reduced-motion authority', () => {
  let media: MutableMediaQueryList

  beforeEach(() => {
    delete document.documentElement.dataset.reducedMotion
    media = new MutableMediaQueryList()
    window.matchMedia = vi.fn(() => media as unknown as MediaQueryList)
  })

  afterEach(cleanup)

  it('publishes the OS setting to React and CSS, then cleans up its listener', () => {
    const view = render(<AppliedMotion />)
    expect(screen.getByText('full')).toBeInTheDocument()
    expect(document.documentElement.dataset.reducedMotion).toBe('false')
    expect(media.addEventListener).toHaveBeenCalledWith('change', expect.any(Function))

    act(() => media.setMatches(true))
    expect(screen.getByText('reduced')).toBeInTheDocument()
    expect(document.documentElement.dataset.reducedMotion).toBe('true')

    view.unmount()
    expect(media.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function))
  })

  it('turns camera flights into jumps without changing normal durations', () => {
    expect(cameraDuration(360, false)).toBe(360)
    expect(cameraDuration(260, false)).toBe(260)
    expect(cameraDuration(360, true)).toBe(0)
    expect(cameraDuration(0, true)).toBe(0)
  })

  it('commits reduced-motion camera transitions synchronously', () => {
    const reducedCommand = vi.fn()
    const fullMotionCommand = vi.fn()
    flushSyncSpy.mockClear()

    commitCameraTransition(reducedCommand, true)
    expect(flushSyncSpy).toHaveBeenCalledOnce()
    expect(flushSyncSpy).toHaveBeenCalledWith(reducedCommand)
    expect(reducedCommand).toHaveBeenCalledOnce()

    flushSyncSpy.mockClear()
    const renderedBridge = vi.fn()
    commitCameraTransition(fullMotionCommand, false, renderedBridge)
    expect(flushSyncSpy).not.toHaveBeenCalled()
    expect(fullMotionCommand).toHaveBeenCalledOnce()
    expect(renderedBridge).not.toHaveBeenCalled()
  })

  it('commits the exact reduced-motion viewport to the store before the rendered bridge', () => {
    const targetViewport = Object.freeze({ x: -2327.25, y: -953.75, zoom: 0.325 })
    const commits: Array<{ channel: 'store' | 'rendered'; viewport: typeof targetViewport }> = []

    commitCameraTransition(
      () => commits.push({ channel: 'store', viewport: targetViewport }),
      true,
      () => commits.push({ channel: 'rendered', viewport: targetViewport }),
    )

    expect(commits).toEqual([
      { channel: 'store', viewport: targetViewport },
      { channel: 'rendered', viewport: targetViewport },
    ])
    expect(commits[0]?.viewport).toBe(commits[1]?.viewport)
  })
})
