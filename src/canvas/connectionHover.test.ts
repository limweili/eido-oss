import { describe, expect, it, vi } from 'vitest'
import { createConnectionHoverTracker } from './connectionHover'

describe('createConnectionHoverTracker', () => {
  it('coalesces pointer motion to one hit test per frame and publishes identity changes only', () => {
    const pendingFrames: FrameRequestCallback[] = []
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      pendingFrames.push(callback)
      return 41
    })
    const cancelFrame = vi.fn()
    const hitTest = vi.fn(({ clientX }: { clientX: number; clientY: number }) =>
      clientX < 20 ? 'wire-a' : clientX < 80 ? 'wire-b' : null,
    )
    const onIdentityChange = vi.fn()
    const tracker = createConnectionHoverTracker({
      requestFrame,
      cancelFrame,
      hitTest,
      onIdentityChange,
    })

    tracker.move({ clientX: 4, clientY: 10 })
    tracker.move({ clientX: 44, clientY: 12 })

    expect(requestFrame).toHaveBeenCalledTimes(1)
    expect(hitTest).not.toHaveBeenCalled()
    pendingFrames.shift()!(16)
    expect(hitTest).toHaveBeenCalledTimes(1)
    expect(hitTest).toHaveBeenLastCalledWith({ clientX: 44, clientY: 12 })
    expect(onIdentityChange).toHaveBeenLastCalledWith('wire-b')

    tracker.move({ clientX: 48, clientY: 14 })
    pendingFrames.shift()!(32)
    expect(hitTest).toHaveBeenCalledTimes(2)
    expect(onIdentityChange).toHaveBeenCalledTimes(1)

    tracker.move({ clientX: 90, clientY: 15 })
    pendingFrames.shift()!(48)
    expect(onIdentityChange).toHaveBeenNthCalledWith(2, null)

    tracker.dispose()
    expect(cancelFrame).not.toHaveBeenCalled()
  })

  it('cancels a queued frame on disposal without hit-testing stale motion', () => {
    const requestFrame = vi.fn((_callback: FrameRequestCallback) => 73)
    const cancelFrame = vi.fn()
    const hitTest = vi.fn(() => 'wire-a')
    const tracker = createConnectionHoverTracker({
      requestFrame,
      cancelFrame,
      hitTest,
      onIdentityChange: vi.fn(),
    })

    tracker.move({ clientX: 1, clientY: 2 })
    tracker.dispose()

    expect(cancelFrame).toHaveBeenCalledWith(73)
    expect(hitTest).not.toHaveBeenCalled()
  })
})
