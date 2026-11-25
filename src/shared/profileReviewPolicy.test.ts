import { describe, expect, it } from 'vitest'
import {
  PROFILE_REVIEW_MODEL,
  hasProfileReviewPolicyMarker,
  resolveProfileReviewPolicy,
} from './profileReviewPolicy'

describe('development Profile review policy', () => {
  it('fixes the model only for the immutable desktop review sentinel', () => {
    expect(resolveProfileReviewPolicy({
      desktop: true,
      review: true,
    })).toEqual({ kind: 'review', model: PROFILE_REVIEW_MODEL })

    for (const environment of [
      { desktop: false, review: true },
      { desktop: true, review: false },
      { desktop: true, review: undefined },
    ]) {
      expect(resolveProfileReviewPolicy(environment)).toEqual({ kind: 'ordinary' })
    }
  })

  it('admits the sentinel only from the exact main-process review marker', () => {
    expect(hasProfileReviewPolicyMarker('eido://app/?profile-review-policy=v1')).toBe(true)
    expect(hasProfileReviewPolicyMarker('https://example.test/?profile-review-policy=v1')).toBe(false)
    expect(hasProfileReviewPolicyMarker('eido://app/?profile-review-policy=unknown')).toBe(false)
    expect(hasProfileReviewPolicyMarker('eido://app/')).toBe(false)
  })
})
