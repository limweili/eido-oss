// The Note body text scale (#1308). It is presentation state by ADR 0040's
// definition: neither the semantic context nor the execution projection reads
// it, so a scale this build cannot interpret must cost the reader a font size
// and never a Board.
//
// It rides in `card.meta`, the settings envelope, like the reach mode and the
// research depth. The top-level `fontSize` field it used to occupy is now
// LEGACY AND READ-ONLY. That field stays on the persistence validator's key
// allowlist on purpose: every Profile already saved carries it, and a build
// that stopped recognising the key would fail those Cards, fail the
// projection, and report the whole revision as corrupt, which is the exact
// failure the envelope exists to prevent. Nothing writes it any more, and the
// one writer deletes it in the same update that writes the envelope, so a
// Card is never left holding two answers.
//
// WHAT THE SCALE IS. A step on the numbered Note text ladder that
// `src/ui/tokens.ts` owns, not one of three names. Steps 1, 2 and 3 render at
// exactly the sizes the retired 'small' | 'medium' | 'large' choices did, so
// every Note that already exists keeps the look it was written with; steps 4
// and up are the range those three names could never express. The ladder, its
// ends, and its default all live with the tokens, because the tokens are what
// a step actually means. This file only says where a step is stored and how a
// stored value that is not a step this build knows is read.

import { defineSetting, hasSetting, readSetting } from '../persistence/settingsEnvelope'
import type { SettingsEnvelopeCarrier } from '../persistence/settingsEnvelope'
import {
  NOTE_FONT_STEP_DEFAULT,
  NOTE_FONT_STEP_MIN,
  NOTE_FONT_STEP_TOKENS,
  normalizeNoteFontStep,
} from '../ui/tokens'

// One member per rung of NOTE_FONT_STEP_TOKENS. A step added to that ladder
// belongs here too; `NOTE_FONT_SIZES` below is built from the ladder, so a
// mismatch surfaces there rather than silently painting nothing.
export type NoteFontSize = 1 | 2 | 3 | 4 | 5 | 6

// The three names Notes were saved with before the ladder existed. They are a
// stored shape only: nothing downstream of `noteFontSizeOf` ever sees one.
export type LegacyNoteFontSize = 'small' | 'medium' | 'large'

// What may legitimately sit under the envelope key: a step this build knows,
// or one of the retired names a build before the ladder wrote there.
export type StoredNoteFontSize = NoteFontSize | LegacyNoteFontSize

export const NOTE_FONT_SIZES: readonly NoteFontSize[] = Object.freeze(
  NOTE_FONT_STEP_TOKENS.map((_token, index) => (NOTE_FONT_STEP_MIN + index) as NoteFontSize),
)

export const DEFAULT_NOTE_FONT_SIZE: NoteFontSize = NOTE_FONT_STEP_DEFAULT

export const NOTE_FONT_SIZE_META_KEY = 'noteFontSize'

// A missing key, an older save, or a scale from a build whose ladder is longer
// than this one's all read as the default step, which is what the Note already
// rendered at before the setting existed. That substitution is the envelope's
// rule, not this file's.
//
// `accepts` is deliberately wider than `NoteFontSize`: it also admits the
// retired names, because a build between the envelope landing and the ladder
// landing wrote one of those under this very key, and reading it as the
// default would shrink a Note the person had already sized. Widening the
// `accepts` of a setting contract is the supported move; widening a strict
// value union is the one that costs a downgrade break (SOP hard stop 3).
export const NOTE_FONT_SIZE_SETTING = defineSetting<StoredNoteFontSize>({
  key: NOTE_FONT_SIZE_META_KEY,
  fallback: DEFAULT_NOTE_FONT_SIZE,
  accepts: (value) => normalizeNoteFontStep(value) !== undefined,
})

// A Card, plus the retired top-level field the Card type no longer declares.
// Typing it `unknown` is what keeps the legacy value readable while giving no
// caller a field it could write.
export type NoteFontSizeCarrier = SettingsEnvelopeCarrier & { fontSize?: unknown }

export function isNoteFontSize(value: unknown): value is NoteFontSize {
  return normalizeNoteFontStep(value) === value
}

// THE ONE PLACE the Note scale is read. Envelope first, then the legacy
// top-level field a Board saved by an older build still carries, then the
// default. Once the envelope carries the key it is the whole answer, foreign
// value included: a key written by a newer build is that build's choice, and
// falling back to a legacy field it deliberately deleted would resurrect a
// scale the person already moved off.
export function noteFontSizeOf(card: NoteFontSizeCarrier | undefined): NoteFontSize {
  const stored = hasSetting(card, NOTE_FONT_SIZE_SETTING)
    ? readSetting(card, NOTE_FONT_SIZE_SETTING)
    // The retired field only ever held one of the three names, so anything
    // else there came from a build this one has never met and reads as the
    // default, exactly as an unreadable envelope value would.
    : typeof card?.fontSize === 'string' ? card.fontSize : undefined
  return normalizeNoteFontStep(stored) as NoteFontSize | undefined ?? DEFAULT_NOTE_FONT_SIZE
}

// Whether the Card still holds the retired top-level field. The writer needs
// this to tell a Card that only looks unchanged apart from a legacy value it
// must still clear.
export function hasLegacyNoteFontSize(card: NoteFontSizeCarrier | undefined): boolean {
  return card !== undefined && card.fontSize !== undefined
}
