import { describe, expect, it } from 'vitest'
import {
  formatMs,
  measureTimelinePerformance,
  TIMELINE_PERFORMANCE_CASES,
} from '../performance/timelinePerformance'

describe('timeline projection benchmark', () => {
  for (const caseName of TIMELINE_PERFORMANCE_CASES) {
    it(
      `${caseName} timeline projection`,
      () => {
        const result = measureTimelinePerformance(caseName)

        expect(result.eventCount).toBe(result.size.timelineEvents)
        expect(result.endCardCount).toBeGreaterThan(0)
        console.log(`\nTimeline benchmark: ${caseName}`)
        console.table(result.measurements.map((measurement) => ({ label: measurement.label, ms: formatMs(measurement.ms) })))
      },
      120_000,
    )
  }
})
