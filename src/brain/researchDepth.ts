// The research depth the person paying chose (#971). Research is the one
// reach that spends real dollars per press, so `reasoningDepth` is the user's
// choice, pinned on the submit; the model keeps `mode`, because mode is the
// shape of the job rather than its spend. This is a deliberate, scoped
// exception to the epic's model-chooses rule and does not reopen search depth
// for Web mode (founder decision, 2026-08-18).
//
// The choice rides in `card.meta`, never a top-level Card field: the
// persistence validator holds Cards to a closed key set and fails the whole
// projection on a stranger, while `meta` is the one part validated as an open
// record, the same escape hatch the reach mode and the job id already proved.
// An older build carries the key without reading it.

import type { Card } from '../graph/types'
import { defineChoiceSetting, readSetting } from '../persistence/settingsEnvelope'
import type { ResearchReasoningDepth } from './linkup'

export const RESEARCH_DEPTH_META_KEY = 'researchDepth'

export const RESEARCH_DEPTHS = ['S', 'M', 'L', 'XL'] as const satisfies
  readonly ResearchReasoningDepth[]

// S is the default so a Card that has never been asked is never sitting on an
// expensive answer: the cheapest depth is the only one safe to assume.
export const DEFAULT_RESEARCH_DEPTH: ResearchReasoningDepth = 'S'

// A missing key, an older save, or a value from a build this one has never met
// all read as S: an unrecognised choice must never submit a dearer job than
// the person would have picked, and S is the only depth that promise allows.
// The substitution itself is the settings envelope's rule, applied here.
export const RESEARCH_DEPTH_SETTING = defineChoiceSetting<ResearchReasoningDepth>({
  key: RESEARCH_DEPTH_META_KEY,
  fallback: DEFAULT_RESEARCH_DEPTH,
  choices: RESEARCH_DEPTHS,
})

export function researchDepthOf(card: Pick<Card, 'meta'> | undefined): ResearchReasoningDepth {
  return readSetting(card, RESEARCH_DEPTH_SETTING)
}
