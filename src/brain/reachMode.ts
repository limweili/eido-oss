// How far an Agentic Run may reach into the web. Two modes: 'web' is the
// synchronous pair (search and page reading, seconds), 'research' adds the
// asynchronous investigation that runs for minutes and cannot be stopped once
// submitted. Whether reach is on at all stays `card.agentic`, so a Board saved
// here still opens with its reach intact in a build that predates modes.
//
// The mode rides in `card.meta`, never as a top-level Card field: the
// persistence validator holds Cards to a closed key set and fails the whole
// projection on a stranger, so a new top-level field is a lost Board rather
// than a lost setting. `meta` is the one part validated as an open record, and
// the settings envelope makes that container's rules explicit.

import type { Card } from '../graph/types'
import { defineChoiceSetting, readSetting } from '../persistence/settingsEnvelope'

export const REACH_MODES = ['web', 'research'] as const
export type ReachMode = (typeof REACH_MODES)[number]

export const DEFAULT_REACH_MODE: ReachMode = 'web'

export const REACH_MODE_META_KEY = 'reachMode'

// A missing key, an older save, or a value from a build this one has never met
// all read as 'web': a mode is a preference, and an unrecognised preference is
// not a corrupt Card. That is the envelope's rule, not a rule this file owns.
export const REACH_MODE_SETTING = defineChoiceSetting<ReachMode>({
  key: REACH_MODE_META_KEY,
  fallback: DEFAULT_REACH_MODE,
  choices: REACH_MODES,
})

export function reachModeOf(card: Pick<Card, 'meta'> | undefined): ReachMode {
  return readSetting(card, REACH_MODE_SETTING)
}
