export const PROFILE_INTENT_ACTOR_ID_MAX_BYTES = 512

export function isProfileIntentActorId(candidate: unknown): candidate is string {
  return typeof candidate === 'string'
    && candidate.trim().length > 0
    && new TextEncoder().encode(candidate).byteLength <= PROFILE_INTENT_ACTOR_ID_MAX_BYTES
}
