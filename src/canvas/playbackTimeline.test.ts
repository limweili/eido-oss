import { describe, expect, it } from 'vitest'
import {
  playbackEventIndexAtProgress,
  playbackProgressForEventIndex,
} from './playbackTimeline'

describe('equally spaced playback timeline', () => {
  it('advances through events by their equal playback positions instead of source-time gaps', () => {
    expect(playbackEventIndexAtProgress(3, 0)).toBe(1)
    expect(playbackEventIndexAtProgress(3, 0.49)).toBe(1)
    expect(playbackEventIndexAtProgress(3, 0.5)).toBe(2)
    expect(playbackEventIndexAtProgress(3, 0.99)).toBe(2)
    expect(playbackEventIndexAtProgress(3, 1)).toBe(3)
  })

  it('maps event indices back to clamped equal playback positions for keyboard stepping', () => {
    expect(playbackProgressForEventIndex(1, 4)).toBe(0)
    expect(playbackProgressForEventIndex(2, 4)).toBeCloseTo(1 / 3)
    expect(playbackProgressForEventIndex(3, 4)).toBeCloseTo(2 / 3)
    expect(playbackProgressForEventIndex(4, 4)).toBe(1)
    expect(playbackProgressForEventIndex(20, 4)).toBe(1)
  })
})
