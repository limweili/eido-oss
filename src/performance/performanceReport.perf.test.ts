import { describe, expect, it } from 'vitest'
import {
  measureTimelinePerformance,
  TIMELINE_PERFORMANCE_BUDGETS,
  TIMELINE_PERFORMANCE_CASES,
  timelineBudgetRows,
  timelineResultRows,
} from './timelinePerformance'

describe('performance budget report', () => {
  it(
    'reports timeline budgets for deterministic Board fixtures',
    () => {
      const results = TIMELINE_PERFORMANCE_CASES.map(measureTimelinePerformance)
      const large = results.find((result) => result.caseName === 'large')

      expect(large).toBeDefined()
      expect(large?.maxProjectorProjectionMs).toBeLessThan(
        TIMELINE_PERFORMANCE_BUDGETS.largeProjectorProjectionMs,
      )
      expect(large?.scrub100FramesMs).toBeLessThan(TIMELINE_PERFORMANCE_BUDGETS.largeScrub100FramesMs)

      console.log('\nPerformance budget report: timeline projection')
      console.table(timelineResultRows(results))
      console.log('\nPerformance budget status')
      console.table(timelineBudgetRows(results))
    },
    120_000,
  )
})
