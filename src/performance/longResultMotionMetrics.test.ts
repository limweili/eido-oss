import { describe, expect, it } from 'vitest'
import { isStressMaxWithinControlEnvelope } from './longResultMotionMetrics'

describe('long Result motion frame budget', () => {
  it('gates stress against the raw paired control envelope', () => {
    expect(isStressMaxWithinControlEnvelope(18, 50.1, 16.7)).toBe(true)
    expect(isStressMaxWithinControlEnvelope(18, 54, 16.7)).toBe(false)
    expect(isStressMaxWithinControlEnvelope(83.3, 83.3, 16.7)).toBe(true)
  })
})
