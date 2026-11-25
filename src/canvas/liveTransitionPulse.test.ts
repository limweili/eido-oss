import { describe, expect, it } from 'vitest'
import {
  createLiveTransitionPulseController,
  LIVE_TRANSITION_PULSE_MIN_VISIBLE_MS,
} from './liveTransitionPulse'

function frameHarness() {
  let clock = 0
  let nextHandle = 0
  const frames = new Map<number, () => void>()
  const timers = new Map<number, { callback: () => void; dueAt: number }>()
  const scheduler = {
    now: () => clock,
    requestFrame(callback: () => void) {
      const handle = ++nextHandle
      frames.set(handle, callback)
      return handle
    },
    cancelFrame(handle: number) {
      frames.delete(handle)
    },
    setTimeout(callback: () => void, delayMs: number) {
      const handle = ++nextHandle
      timers.set(handle, { callback, dueAt: clock + delayMs })
      return handle
    },
    clearTimeout(handle: number) {
      timers.delete(handle)
    },
    advance(ms: number) {
      clock += ms
      for (const [handle, timer] of [...timers]) {
        if (timer.dueAt > clock) continue
        timers.delete(handle)
        timer.callback()
      }
    },
    flushFrame() {
      const entry = frames.entries().next().value as [number, () => void] | undefined
      if (!entry) return false
      frames.delete(entry[0])
      entry[1]()
      return true
    },
    get pendingTimers() {
      return timers.size
    },
    get pendingFrames() {
      return frames.size
    },
  }
  return scheduler
}

describe('createLiveTransitionPulseController', () => {
  it('keeps a fast transition through the first half-cycle from begin', () => {
    const scheduler = frameHarness()
    const pulse = createLiveTransitionPulseController(scheduler)
    let clears = 0

    pulse.begin('fast')
    scheduler.advance(120)
    pulse.release('fast', () => { clears += 1 })

    expect(clears).toBe(0)
    expect(scheduler.pendingTimers).toBe(1)
    scheduler.advance(LIVE_TRANSITION_PULSE_MIN_VISIBLE_MS - 120 - 1)
    expect(clears).toBe(0)
    scheduler.advance(1)
    expect(clears).toBe(0)
    expect(scheduler.pendingFrames).toBe(1)
    scheduler.flushFrame()
    expect(clears).toBe(1)
  })

  it('retires on the next frame when loading already passed the half-cycle', () => {
    const scheduler = frameHarness()
    const pulse = createLiveTransitionPulseController(scheduler)
    let clears = 0

    pulse.begin('slow')
    scheduler.advance(LIVE_TRANSITION_PULSE_MIN_VISIBLE_MS + 200)
    pulse.release('slow', () => { clears += 1 })

    expect(clears).toBe(0)
    expect(scheduler.pendingTimers).toBe(0)
    expect(scheduler.pendingFrames).toBe(1)
    scheduler.flushFrame()
    expect(clears).toBe(1)
  })

  it('deduplicates readiness notifications and cancels stale transitions', () => {
    const scheduler = frameHarness()
    const pulse = createLiveTransitionPulseController(scheduler)
    let clears = 0

    pulse.begin('duplicate')
    pulse.release('duplicate', () => { clears += 1 })
    pulse.release('duplicate', () => { clears += 10 })
    expect(scheduler.pendingTimers).toBe(1)
    pulse.cancel('duplicate')
    scheduler.advance(LIVE_TRANSITION_PULSE_MIN_VISIBLE_MS)
    expect(scheduler.pendingFrames).toBe(0)
    expect(clears).toBe(0)
  })

  it('does not restart the visibility floor on a repeated begin', () => {
    const scheduler = frameHarness()
    const pulse = createLiveTransitionPulseController(scheduler)
    let clears = 0

    pulse.begin('repeated')
    scheduler.advance(240)
    pulse.begin('repeated')
    pulse.release('repeated', () => { clears += 1 })
    scheduler.advance(LIVE_TRANSITION_PULSE_MIN_VISIBLE_MS - 240)
    scheduler.flushFrame()

    expect(clears).toBe(1)
  })

  it('supports zero visibility time for reduced-motion presentation', () => {
    const scheduler = frameHarness()
    const pulse = createLiveTransitionPulseController(scheduler, 0)
    let clears = 0

    pulse.begin('reduced')
    pulse.release('reduced', () => { clears += 1 })
    expect(clears).toBe(0)
    scheduler.flushFrame()
    expect(clears).toBe(1)
  })
})
