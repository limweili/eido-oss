export const PROFILE_REVIEW_POLICY_PARAMETER = 'profile-review-policy' as const
export const PROFILE_REVIEW_POLICY_VERSION = 'v1' as const
export const PROFILE_REVIEW_MODEL = 'openai/gpt-5.6-luna' as const

export type ProfileReviewPolicy =
  | Readonly<{ kind: 'ordinary' }>
  | Readonly<{ kind: 'review'; model: typeof PROFILE_REVIEW_MODEL }>

type ProfileReviewEnvironment = Readonly<{
  desktop: unknown
  review: unknown
}>

export function resolveProfileReviewPolicy(
  environment: ProfileReviewEnvironment,
): ProfileReviewPolicy {
  if (environment.desktop !== true || environment.review !== true) {
    return Object.freeze({ kind: 'ordinary' })
  }
  return Object.freeze({ kind: 'review', model: PROFILE_REVIEW_MODEL })
}

export function hasProfileReviewPolicyMarker(urlValue: string): boolean {
  let url: URL
  try {
    url = new URL(urlValue)
  } catch {
    return false
  }
  return url.protocol === 'eido:'
    && url.hostname === 'app'
    && url.port === ''
    && url.username === ''
    && url.password === ''
    && url.searchParams.get(PROFILE_REVIEW_POLICY_PARAMETER) === PROFILE_REVIEW_POLICY_VERSION
}

export function currentProfileReviewPolicy(): ProfileReviewPolicy {
  return resolveProfileReviewPolicy({
    desktop: typeof window === 'undefined' ? undefined : window.eidoDesktop,
    review: typeof window === 'undefined' ? undefined : window.eidoProfileReview,
  })
}

export function isProfileReviewExecution(): boolean {
  return currentProfileReviewPolicy().kind === 'review'
}

export function resolveProfileReviewModel(requestedModel: string): string {
  const policy = currentProfileReviewPolicy()
  return policy.kind === 'review' ? policy.model : requestedModel
}

export function assertProfileReviewModel(model: string): void {
  const policy = currentProfileReviewPolicy()
  if (policy.kind === 'review' && model !== policy.model) {
    throw new Error('Development Profile review model is unavailable')
  }
}
