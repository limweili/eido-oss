// The settings envelope's three rules, proved once at the seam that owns them,
// plus the direction the repo could not prove before: DOWNGRADE. saveLoadCompat
// already proves that data an older build wrote opens in this one. This file
// proves the mirror: a Board this build writes, carrying settings the previous
// build has never seen, still opens under that previous build's strict
// validator, frozen verbatim in fixtures/preEnvelopeCardValidator.ts.
//
// It also proves the second half of the migration, at Board and Idea level,
// where the answer is different and the difference is the point. A Card could
// be made safe for builds ALREADY INSTALLED. A Board and an Idea cannot, so
// their envelopes cost one compatibility break, paid once by the release that
// first writes a Board-level setting. fixtures/preEnvelopeBoardValidator.ts
// freezes that previous build too, so the price is demonstrated rather than
// hand-waved, and the tolerance this build gained goes red if it is ever
// re-tightened.
import { describe, expect, it } from 'vitest'
import { DEFAULT_RESEARCH_DEPTH, researchDepthOf } from '../brain/researchDepth'
import { researchJobOf } from '../brain/researchJobMeta'
import { DEFAULT_REACH_MODE, reachModeOf } from '../brain/reachMode'
import { DEFAULT_NOTE_FONT_SIZE, NOTE_FONT_SIZES, noteFontSizeOf } from '../graph/noteFontSize'
import type { NoteFontSize } from '../graph/noteFontSize'
import type { Card, IdeaSummary, SavedBoard } from '../graph/types'
import {
  profileFixtureCorpus,
  SYNTHETIC_FOREIGN_BOARD_AI_SETTINGS,
  SYNTHETIC_FOREIGN_SETTINGS_CARD,
  SYNTHETIC_LEGACY_FONT_SIZE_CARD,
  SYNTHETIC_MALFORMED_SETTINGS_CARD,
  SYNTHETIC_MIGRATED_FONT_SIZE_CARD,
  SYNTHETIC_UNKNOWN_BOARD_SETTINGS,
  SYNTHETIC_UNKNOWN_SETTINGS_CARD,
} from './fixtures/profileFixtureCorpus'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import {
  PRE_ENVELOPE_BOARD_KEYS,
  PRE_ENVELOPE_BOARD_SETTINGS_KEYS,
  PRE_ENVELOPE_IDEA_KEYS,
  PreEnvelopeBoardValidationError,
  validatePreEnvelopeBoard,
  validatePreEnvelopeBoardSettings,
  validatePreEnvelopeIdea,
} from './fixtures/preEnvelopeBoardValidator'
import {
  PRE_ENVELOPE_CARD_KEYS,
  PreEnvelopeValidationError,
  validatePreEnvelopeBoardCards,
  validatePreEnvelopeCard,
} from './fixtures/preEnvelopeCardValidator'
import {
  boardAiSettingsOf,
  BOARD_AI_MODELS_SETTING,
  DEFAULT_BOARD_AI_MODEL,
  DEFAULT_BOARD_AI_MODELS,
  DEFAULT_BOARD_AI_REASONING_EFFORT,
  foreignBoardAiSettings,
  mergeForeignBoardAiSettings,
} from '../graph/boardAiSettings'
import {
  hydrateProfileLogicalDocument,
  projectProfileSnapshot,
  ProfileLogicalProjectionError,
} from './profileLogicalProjection'
import {
  clearSetting,
  defineChoiceSetting,
  defineSetting,
  foreignEnvelopeKeys,
  hasSetting,
  isSettingsEnvelope,
  mergeForeignEnvelopeKeys,
  readSetting,
  settingsEnvelopeOf,
  writeSetting,
} from './settingsEnvelope'

const PANEL_WIDTH = defineSetting<number>({
  key: 'panelWidth',
  fallback: 320,
  accepts: (value) => typeof value === 'number' && Number.isFinite(value) && value > 0,
})

const PANEL_SIDE = defineChoiceSetting<'left' | 'right'>({
  key: 'panelSide',
  fallback: 'left',
  choices: ['left', 'right'],
})

// A setting whose default is a structure rather than a scalar, which is where
// "the runtime is still on the default" cannot be answered by reference.
const PANEL_TABS = defineSetting<string[]>({
  key: 'panelTabs',
  fallback: ['home', 'notes'],
  accepts: (value) => Array.isArray(value) && value.every((entry) => typeof entry === 'string'),
})

const PANEL_CONTRACTS = [PANEL_WIDTH, PANEL_SIDE, PANEL_TABS]

describe('Settings envelope: the three tolerant-read rules (#1307)', () => {
  it('reads a declared value and substitutes the documented default for everything else', () => {
    expect(readSetting({ meta: { panelWidth: 480 } }, PANEL_WIDTH)).toBe(480)

    // Rule 2: a known key holding a value this build cannot act on reads as
    // the default, whatever kind of wrong it is.
    for (const foreign of [0, -1, Number.NaN, '480', null, {}, [], undefined]) {
      expect(readSetting({ meta: { panelWidth: foreign } }, PANEL_WIDTH)).toBe(320)
    }
    // A save from before the setting existed, and a record with no envelope
    // at all, are the same state as the default.
    expect(readSetting({ meta: {} }, PANEL_WIDTH)).toBe(320)
    expect(readSetting({}, PANEL_WIDTH)).toBe(320)
    expect(readSetting(undefined, PANEL_WIDTH)).toBe(320)

    // The read reports the default; `hasSetting` still reports that the key is
    // there, which is what tells "never set" apart from "set to something
    // foreign" for a build that must not overwrite the foreign value.
    expect(hasSetting({ meta: { panelWidth: 'wide' } }, PANEL_WIDTH)).toBe(true)
    expect(hasSetting({ meta: {} }, PANEL_WIDTH)).toBe(false)
  })

  it('never mutates or drops a stored value it cannot read', () => {
    const envelope = { panelWidth: 'from-a-newer-build', panelSide: 'floating' }
    const carrier = { meta: envelope }

    expect(readSetting(carrier, PANEL_WIDTH)).toBe(320)
    expect(readSetting(carrier, PANEL_SIDE)).toBe('left')
    // Rule 2 drops the value for the READ only. Physically deleting it is how
    // an older build would destroy a newer build's preference.
    expect(carrier.meta).toEqual({ panelWidth: 'from-a-newer-build', panelSide: 'floating' })
  })

  it('copies every key it does not own straight through a write', () => {
    const foreign = { futurePanel: { collapsed: true }, linkPreviewDismissedUrl: 'https://example.invalid/x' }

    const written = writeSetting({ meta: { ...foreign } }, PANEL_WIDTH, 480)
    expect(written).toEqual({ ...foreign, panelWidth: 480 })

    // Writing the default deletes the key rather than storing it, so a record
    // that never left the default is byte-identical to one written before the
    // setting existed. The foreign keys still survive.
    expect(writeSetting({ meta: written }, PANEL_WIDTH, 320)).toEqual(foreign)
    expect(clearSetting({ meta: written }, PANEL_WIDTH)).toEqual(foreign)

    // An emptied envelope collapses, for the same reason.
    expect(clearSetting({ meta: { panelWidth: 480 } }, PANEL_WIDTH)).toBeUndefined()
    expect(writeSetting(undefined, PANEL_WIDTH, 320)).toBeUndefined()
  })

  // Rule 1 at a seam that cannot hold the whole bag, which is where the
  // promise used to have a hole. A store that decomposes an envelope into its
  // own typed fields has no field for a key it never heard of AND no field for
  // a value it cannot act on. Rule 2 gives the runtime a default for the
  // second one; a save built from that default would then delete a newer
  // build's setting for good. Both cases are foreign, and both go back.
  it('carries a value it cannot read back to disk, exactly like a key it does not know', () => {
    const stored = {
      panelWidth: 'from-a-newer-build',
      panelSide: 'right',
      panelTabs: ['home', 'notes'],
      futurePanel: { collapsed: true },
    }

    const foreign = foreignEnvelopeKeys(stored, PANEL_CONTRACTS)
    expect(foreign).toEqual({
      panelWidth: 'from-a-newer-build',
      futurePanel: { collapsed: true },
    })

    // What the runtime acted on: this build's documented default for the width.
    const own = { panelWidth: 320, panelSide: 'right', panelTabs: ['home', 'notes'] }
    // Reading a default is not choosing one, so the save puts the stored value
    // back and the newer build finds its own setting intact.
    expect(mergeForeignEnvelopeKeys(own, foreign, PANEL_CONTRACTS)).toEqual(stored)

    // A real choice wins, and only for the key that was actually chosen.
    expect(mergeForeignEnvelopeKeys({ ...own, panelWidth: 480 }, foreign, PANEL_CONTRACTS))
      .toEqual({ ...stored, panelWidth: 480 })

    // A key this build does not own is never this build's to choose.
    expect(mergeForeignEnvelopeKeys({ futurePanel: 'mine' }, foreign, PANEL_CONTRACTS).futurePanel)
      .toEqual({ collapsed: true })
  })

  it('compares a structured default by value, because every caller builds its own', () => {
    // `panelTabs` holds a list. The runtime's copy of the default is a
    // different array instance from the contract's every time, so a reference
    // test would read it as a deliberate choice and overwrite the stored value.
    const foreign = foreignEnvelopeKeys({ panelTabs: 7 }, PANEL_CONTRACTS)
    expect(foreign).toEqual({ panelTabs: 7 })

    expect(mergeForeignEnvelopeKeys({ panelTabs: ['home', 'notes'] }, foreign, PANEL_CONTRACTS))
      .toEqual({ panelTabs: 7 })
    expect(mergeForeignEnvelopeKeys({ panelTabs: ['home'] }, foreign, PANEL_CONTRACTS))
      .toEqual({ panelTabs: ['home'] })

    // The write side reads the same way: storing a list equal to the default
    // is storing the default, which is an absent key.
    expect(writeSetting({ meta: { panelTabs: ['home'] } }, PANEL_TABS, ['home', 'notes']))
      .toBeUndefined()
  })

  it('freezes every default, so one shared instance cannot become one record editing another', () => {
    // A fallback is handed out by reference to every record that needs it. A
    // mutable default list would be ONE list shared by every Board that never
    // chose its own.
    expect(Object.isFrozen(PANEL_TABS.fallback)).toBe(true)
    expect(Object.isFrozen(BOARD_AI_MODELS_SETTING.fallback)).toBe(true)

    const first = boardAiSettingsOf({ aiSettings: { models: 'not-a-list' } })!
    const second = boardAiSettingsOf({ aiSettings: { models: 7 } })!
    expect(() => first.models.push('sneaked/in')).toThrow(TypeError)
    expect(second.models).toEqual([...DEFAULT_BOARD_AI_MODELS])
  })

  it('treats a container that is not a plain object as corruption, not a preference', () => {
    // Rule 3. Arrays and exotic prototypes are not envelopes.
    expect(isSettingsEnvelope({})).toBe(true)
    expect(isSettingsEnvelope(Object.create(null) as object)).toBe(true)
    for (const corrupt of [[], 'meta', 7, null, new Map()]) {
      expect(isSettingsEnvelope(corrupt)).toBe(false)
    }
    expect(settingsEnvelopeOf({ meta: [] as unknown as Record<string, unknown> })).toBeUndefined()
  })

  it('gives every shipped Card setting exactly one place to declare its default', () => {
    // The generalization the incident asked for: each setting names its key,
    // its accepted values, and its default once, and the envelope applies the
    // same rules to all of them.
    expect(reachModeOf({ meta: { reachMode: 'exhaustive' } })).toBe(DEFAULT_REACH_MODE)
    expect(researchDepthOf({ meta: { researchDepth: 'XXL' } })).toBe(DEFAULT_RESEARCH_DEPTH)
    expect(researchJobOf({ meta: { researchJob: { id: '', submittedAt: 42 } } })).toBeNull()
    expect(reachModeOf({ meta: { reachMode: 'research' } })).toBe('research')
    expect(researchDepthOf({ meta: { researchDepth: 'XL' } })).toBe('XL')

    // The Note scale is the setting that MIGRATED into the envelope (#1308),
    // so it has one extra step every other setting lacks: the retired
    // top-level field a Board saved by an older build still carries. Envelope
    // first, then that field, then the default, in one reader.
    expect(noteFontSizeOf({ meta: { noteFontSize: 1 } })).toBe(1)
    expect(noteFontSizeOf({ fontSize: 'large' })).toBe(3)
    expect(noteFontSizeOf({ meta: { noteFontSize: 1 }, fontSize: 'large' })).toBe(1)
    // A scale the envelope carried before the ladder replaced the three names
    // is still the person's choice, so the contract's `accepts` was widened to
    // keep reading it rather than resetting the Note to the default.
    expect(noteFontSizeOf({ meta: { noteFontSize: 'small' } })).toBe(1)
    // A scale from a build this one has never met reads as the default from
    // either place, and the envelope's answer is final once its key is there:
    // falling back to a field the newer build deleted would resurrect a scale
    // the person already moved off.
    expect(noteFontSizeOf({ meta: { noteFontSize: 'x-large' } })).toBe(DEFAULT_NOTE_FONT_SIZE)
    expect(noteFontSizeOf({ meta: { noteFontSize: 'x-large' }, fontSize: 'large' })).toBe(DEFAULT_NOTE_FONT_SIZE)
    expect(noteFontSizeOf({ meta: { noteFontSize: NOTE_FONT_SIZES.length + 1 } })).toBe(DEFAULT_NOTE_FONT_SIZE)
    expect(noteFontSizeOf({ fontSize: 4 })).toBe(DEFAULT_NOTE_FONT_SIZE)
    expect(noteFontSizeOf({})).toBe(DEFAULT_NOTE_FONT_SIZE)
    expect(noteFontSizeOf(undefined)).toBe(DEFAULT_NOTE_FONT_SIZE)
  })
})

describe('Settings envelope: the persistence boundary (#1307)', () => {
  it('carries the corpus envelope vectors through project and hydrate unchanged', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    snapshot.boards['idea-main']!.cards!.push(
      clone(SYNTHETIC_UNKNOWN_SETTINGS_CARD),
      clone(SYNTHETIC_FOREIGN_SETTINGS_CARD),
    )

    // The real projection and hydration seam. It is the ONLY place `card.meta`
    // is ever inspected, which is what lets this one proof stand for the whole
    // path: hydrateRevisionDocument in the SQLite revision store adds no check
    // of its own, it only re-labels a ProfileLogicalProjectionError raised here
    // as corruption of the entire Profile revision. A throw here fails the test
    // by construction.
    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)
    const cards = hydrated.boards['idea-main']!.cards!

    const unknown = cards.find((card) => card.id === SYNTHETIC_UNKNOWN_SETTINGS_CARD.id)
    const foreign = cards.find((card) => card.id === SYNTHETIC_FOREIGN_SETTINGS_CARD.id)
    expect(unknown?.meta).toEqual(SYNTHETIC_UNKNOWN_SETTINGS_CARD.meta)
    expect(foreign?.meta).toEqual(SYNTHETIC_FOREIGN_SETTINGS_CARD.meta)

    // Rule 2 at the runtime side of the same boundary: the foreign values are
    // still on the record, and every reader substitutes its default.
    const defaults = corpusCase().expectedRuntimeDefaults
    expect(reachModeOf(foreign)).toBe(defaults.reachMode)
    expect(researchDepthOf(foreign)).toBe(defaults.researchDepth)
    expect(researchJobOf(foreign)).toBe(defaults.researchJob)
    expect(noteFontSizeOf(foreign)).toBe(defaults.noteFontSize)
  })

  it('refuses only a settings envelope that is not a plain object', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    snapshot.boards['idea-main']!.cards!.push(
      clone(SYNTHETIC_MALFORMED_SETTINGS_CARD) as unknown as Card,
    )

    // Rule 3 is the one settings-shaped failure still allowed to fail closed,
    // and it fails as a projection error, which is what the revision store
    // reports as corruption. Nothing above reaches this branch.
    expect(() => projectProfileSnapshot(snapshot, fixture.projectAsset))
      .toThrow(ProfileLogicalProjectionError)
    expect(corpusCase().expectedMalformedOutcome).toBe('refused')
  })
})

describe('Settings envelope: downgrade safety (#1307)', () => {
  it('opens a Board this build writes under the strict validator frozen from the previous build', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const board = snapshot.boards['idea-main']!
    board.cards!.push(
      clone(SYNTHETIC_UNKNOWN_SETTINGS_CARD),
      clone(SYNTHETIC_FOREIGN_SETTINGS_CARD),
      clone(SYNTHETIC_MIGRATED_FONT_SIZE_CARD),
    )

    // What this build actually persists: the projected document, hydrated back
    // into the SavedBoard an older Eido would read off disk.
    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const written = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)
      .boards['idea-main'] as SavedBoard

    // The previous build's strict Card validator, frozen verbatim. It has
    // never seen `linkPreviewDismissedUrl`, `futurePanel`, `reachMode`,
    // `researchDepth`, or `researchJob`, and it accepts every one of them,
    // because they ride inside the one open container it already tolerates.
    expect(() => validatePreEnvelopeBoardCards(written, '$board')).not.toThrow()
  })

  // The migrated field, proved specifically (#1308). The Note scale used to be
  // a strict top-level union, which is the shape that made a scale from a
  // newer build a lost Board. Now it rides in the envelope, so the previous
  // build accepts the Card and simply renders its own default.
  it('lets the previous build open a Note whose scale this build wrote, falling back to its default', () => {
    const migrated = clone(SYNTHETIC_MIGRATED_FONT_SIZE_CARD)

    expect(noteFontSizeOf(migrated)).toBe(1)
    expect(migrated).not.toHaveProperty('fontSize')
    expect(() => validatePreEnvelopeCard(migrated, '$card')).not.toThrow()

    // The previous build has no reader for the envelope key, so what it shows
    // is its own default. A font size is the whole cost of the downgrade; the
    // Board, and every other Board in the Profile, still opens.
    expect(PRE_ENVELOPE_CARD_KEYS).toContain('meta')
    expect(readAsPreviousBuild(migrated)).toBe(DEFAULT_NOTE_FONT_SIZE)

    // And the field this replaced still opens too, because it stayed on the
    // allowlist. A Board written before the move keeps the scale the person
    // picked in BOTH builds.
    const legacy = clone(SYNTHETIC_LEGACY_FONT_SIZE_CARD) as unknown as Card
    expect(noteFontSizeOf(legacy)).toBe(3)
    expect(() => validatePreEnvelopeCard(legacy, '$card')).not.toThrow()
    expect(readAsPreviousBuild(legacy)).toBe('large')
  })

  it('rejects the same settings as a top-level Card field, which is why the envelope is meta', () => {
    // The counter-proof that keeps the test above honest. Had the envelope
    // shipped as an additive top-level `settings` key, every build already
    // installed would refuse the Card, and the SQLite revision store would
    // report the whole Profile revision as corrupt. This is the failure the
    // envelope decision avoids, demonstrated rather than asserted.
    const card = {
      ...clone(SYNTHETIC_UNKNOWN_SETTINGS_CARD),
      settings: { linkPreviewDismissedUrl: 'https://example.invalid/dismissed' },
    }
    delete (card as { meta?: unknown }).meta

    expect(() => validatePreEnvelopeCard(card, '$card')).toThrow(PreEnvelopeValidationError)
    expect(PRE_ENVELOPE_CARD_KEYS).not.toContain('settings')
    expect(PRE_ENVELOPE_CARD_KEYS).toContain('meta')

    // And the frozen validator is a live gate, not decoration: the strict
    // fields it froze still fail on a value outside their union. A setting
    // moved OUT of the envelope and into one of those fields would be caught
    // here rather than on a stranger's machine.
    expect(() => validatePreEnvelopeCard(
      { ...clone(SYNTHETIC_UNKNOWN_SETTINGS_CARD), fontSize: 'x-large' },
      '$card',
    )).toThrow(PreEnvelopeValidationError)
  })
})

// The Board and the Idea are the second half of the migration (#1307). A Card's
// envelope could be made safe for builds ALREADY INSTALLED, because `meta` was
// already tolerated. A Board and an Idea have no such field, so this half costs
// one compatibility break, paid once, by the release that first writes a
// Board-level setting. These tests assert BOTH halves of that trade.
describe('Settings envelope: Board and Idea level (#1307)', () => {
  it('opens, hydrates, and re-writes a Board carrying settings this build has never met', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    const board = snapshot.boards['idea-main']!
    board.aiSettings = clone(SYNTHETIC_FOREIGN_BOARD_AI_SETTINGS) as SavedBoard['aiSettings']
    board.settings = clone(SYNTHETIC_UNKNOWN_BOARD_SETTINGS)
    snapshot.ideas[0]!.settings = { futureIdeaPin: true }

    // The real projection and hydration seam, which is also the save path: what
    // comes back out is what a later build would read off disk. A throw here
    // fails the test by construction, and a throw here is what the SQLite
    // revision store reports as a corrupt Profile for EVERY Board the person
    // owns, not just this one.
    const document = projectProfileSnapshot(snapshot, fixture.projectAsset)
    const written = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)

    // Rule 1: every key survives the round trip byte for byte, including the
    // reasoning rung and compaction mode this build cannot act on.
    const reopened = written.boards['idea-main'] as SavedBoard
    expect(reopened.aiSettings).toEqual(SYNTHETIC_FOREIGN_BOARD_AI_SETTINGS)
    expect(reopened.settings).toEqual(SYNTHETIC_UNKNOWN_BOARD_SETTINGS)
    expect(written.ideas[0]?.settings).toEqual({ futureIdeaPin: true })

    // Rule 2 at the runtime side of the same boundary: the foreign values are
    // still on the record, and every reader substitutes its documented default.
    const defaults = corpusCase().expectedBoardAiRuntimeDefaults
    const runtime = boardAiSettingsOf(reopened)!
    expect(runtime.reasoningEffort).toBe(defaults.reasoningEffort)
    expect(runtime.compactionMode).toBe(defaults.compactionMode)
    // The setting this build does not own is untouched, and the two keys the
    // rest of the app dereferences without asking are still real values.
    // Read through a cast on purpose: `BoardAiSettings` deliberately declares
    // no index signature, so this build's own code cannot reach a key it does
    // not own. The key is still there, which is the whole point.
    expect(foreignKeys(runtime).futureRunKnob).toEqual(SYNTHETIC_FOREIGN_BOARD_AI_SETTINGS.futureRunKnob)
    expect(runtime.model).toBe('synthetic/model')
    expect(runtime.models).toEqual(['synthetic/model'])
  })

  it('gives a required Board AI setting a documented default rather than a hole', () => {
    // `model` and `models` are the two keys the app dereferences without
    // asking. A bag missing them, or holding something that is not a model
    // name, used to fail the Board; now it hands back this build's own
    // defaults, and unknown keys still ride through.
    const resolved = boardAiSettingsOf({
      aiSettings: { model: 42, models: 'not-a-list', futureRunKnob: { retries: 3 } },
    })!

    expect(resolved.model).toBe(DEFAULT_BOARD_AI_MODEL)
    expect(resolved.models).toEqual([...DEFAULT_BOARD_AI_MODELS])
    expect(resolved.reasoningEffort).toBe(DEFAULT_BOARD_AI_REASONING_EFFORT)
    expect(foreignKeys(resolved).futureRunKnob).toEqual({ retries: 3 })

    // ABSENT is the case `required` exists for, and it is the one a foreign
    // bag actually produces: a build that renamed these keys writes a bag that
    // simply does not carry them. Every optional key stays absent, so a Board
    // that never left a default is not rewritten.
    const withoutRequiredKeys = boardAiSettingsOf({ aiSettings: { futureRunKnob: { retries: 3 } } })!
    expect(withoutRequiredKeys.model).toBe(DEFAULT_BOARD_AI_MODEL)
    expect(withoutRequiredKeys.models).toEqual([...DEFAULT_BOARD_AI_MODELS])
    expect(withoutRequiredKeys.reasoningEffort).toBe(DEFAULT_BOARD_AI_REASONING_EFFORT)
    expect(withoutRequiredKeys).not.toHaveProperty('provider')
    expect(withoutRequiredKeys).not.toHaveProperty('compactionMode')
    // A Board with no bag at all keeps having none. Minting one here would
    // write AI settings onto every Board that never had any.
    expect(boardAiSettingsOf({})).toBeUndefined()
  })

  // The Board bag is where rule 1 has to work hardest. The store never holds
  // it as a bag: it decomposes it into typed fields and rebuilds it on every
  // save, so anything without a field of its own is deleted unless it is
  // carried across deliberately. That is true of a key this build never heard
  // of, of a key it owns holding a value it cannot act on, and of a catalog
  // entry naming a provider it does not ship, which hides one level down
  // inside a value the contract accepts.
  it('carries every foreign part of a Board AI bag across the store seam, nested ones included', () => {
    const stored = {
      model: 'synthetic/model',
      models: ['synthetic/model'],
      reasoningEffort: 'ultra',
      futureRunKnob: { retries: 3 },
      providerModels: {
        openrouter: { model: 'a/b', models: ['a/b'] },
        futureprovider: { model: 'future/one', models: ['future/one'] },
      },
    }

    const foreign = foreignBoardAiSettings(stored)
    expect(foreign).toEqual({
      reasoningEffort: 'ultra',
      futureRunKnob: { retries: 3 },
      providerModels: { futureprovider: { model: 'future/one', models: ['future/one'] } },
    })

    // What the store would save: its own typed answers, still on the default
    // it substituted for the rung it could not read.
    const own = {
      model: 'synthetic/model',
      models: ['synthetic/model'],
      reasoningEffort: DEFAULT_BOARD_AI_REASONING_EFFORT,
      providerModels: { openrouter: { model: 'c/d', models: ['c/d'] } },
    } as unknown as SavedBoard['aiSettings'] & object

    const merged = mergeForeignBoardAiSettings(own, foreign)
    expect(merged.reasoningEffort).toBe('ultra')
    expect(foreignKeys(merged).futureRunKnob).toEqual({ retries: 3 })
    // The entry for a provider this build ships is this build's own answer.
    // The entry for one it does not ship is still the newer build's.
    expect(merged.providerModels).toEqual({
      openrouter: { model: 'c/d', models: ['c/d'] },
      futureprovider: { model: 'future/one', models: ['future/one'] },
    })
  })

  it('still fails closed on a Board or Idea settings container that is not a plain object', () => {
    const fixture = createCompleteProfileFixture()
    for (const corrupt of [[] as unknown, 'settings' as unknown]) {
      const withBoardSettings = clone(fixture.snapshot)
      withBoardSettings.boards['idea-main']!.settings = corrupt as SavedBoard['settings']
      expect(() => projectProfileSnapshot(withBoardSettings, fixture.projectAsset))
        .toThrow(ProfileLogicalProjectionError)

      const withAiSettings = clone(fixture.snapshot)
      withAiSettings.boards['idea-main']!.aiSettings = corrupt as SavedBoard['aiSettings']
      expect(() => projectProfileSnapshot(withAiSettings, fixture.projectAsset))
        .toThrow(ProfileLogicalProjectionError)

      const withIdeaSettings = clone(fixture.snapshot)
      withIdeaSettings.ideas[0]!.settings = corrupt as IdeaSummary['settings']
      expect(() => projectProfileSnapshot(withIdeaSettings, fixture.projectAsset))
        .toThrow(ProfileLogicalProjectionError)
    }
  })

  // THE COST, PAID ONCE AND DELIBERATELY. Every build already installed holds
  // its own copy of the Board and Idea key lists, so it refuses the Boards
  // above the first time one actually carries a Board-level setting. That is
  // not a bug to design around: it is the price of the field existing at all,
  // and ADR 0040 took it knowingly. What the price buys is that every release
  // from the tolerant one onward is safe forever.
  it('shows exactly what the previous build refuses, which is the one-time price of the field', () => {
    const previousBuildBoard = {
      version: 1,
      updatedAt: '2026-01-01T00:00:00.000Z',
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
    }
    // The floor is real: an ordinary Board still opens in the previous build.
    expect(() => validatePreEnvelopeBoard(previousBuildBoard, '$board')).not.toThrow()

    // A Board-level settings envelope is a stranger key on a closed allowlist.
    expect(() => validatePreEnvelopeBoard(
      { ...previousBuildBoard, settings: clone(SYNTHETIC_UNKNOWN_BOARD_SETTINGS) },
      '$board',
    )).toThrow(PreEnvelopeBoardValidationError)
    expect(PRE_ENVELOPE_BOARD_KEYS).not.toContain('settings')

    // So is an Idea-level one, on the stricter exact-key surface.
    const previousBuildIdea = {
      id: 'idea-main',
      name: 'Main',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      lastOpenedAt: '2026-01-01T00:00:00.000Z',
    }
    expect(() => validatePreEnvelopeIdea(previousBuildIdea, '$idea')).not.toThrow()
    expect(() => validatePreEnvelopeIdea({ ...previousBuildIdea, settings: { futureIdeaPin: true } }, '$idea'))
      .toThrow(PreEnvelopeBoardValidationError)
    expect(PRE_ENVELOPE_IDEA_KEYS).not.toContain('settings')

    // And so is every shape the AI settings bag can now legally hold: the
    // previous build gated it with a closed key list AND closed value sets, so
    // an unknown key and an unfamiliar reasoning rung each cost the whole
    // Profile. This is the failure the two historical growths of that bag
    // caused silently, demonstrated rather than asserted.
    expect(() => validatePreEnvelopeBoard(
      { ...previousBuildBoard, aiSettings: clone(SYNTHETIC_FOREIGN_BOARD_AI_SETTINGS) },
      '$board',
    )).toThrow(PreEnvelopeBoardValidationError)
    expect(PRE_ENVELOPE_BOARD_SETTINGS_KEYS).not.toContain('futureRunKnob')

    // THE GAIN, kept forever. This build opens every one of them. If a later
    // change re-tightens the live validators, this half goes red.
    const fixture = createCompleteProfileFixture()
    const snapshot = clone(fixture.snapshot)
    snapshot.boards['idea-main']!.aiSettings = clone(SYNTHETIC_FOREIGN_BOARD_AI_SETTINGS) as SavedBoard['aiSettings']
    snapshot.boards['idea-main']!.settings = clone(SYNTHETIC_UNKNOWN_BOARD_SETTINGS)
    snapshot.ideas[0]!.settings = { futureIdeaPin: true }
    expect(() => projectProfileSnapshot(snapshot, fixture.projectAsset)).not.toThrow()
  })
})

// THE FROZEN VALIDATORS ARE THE WHOLE DOWNGRADE PROOF, so they need a proof of
// their own. Everything the tests above claim about what a shipped build
// refuses is only as true as those two files, and a frozen check nothing
// exercises is a check that can be quietly weakened, or mistyped in the first
// place, without anything going red. The tests above hold about five of the
// roughly thirty checks, and the ones they do hold are over-determined: the
// `aiSettings` fixture violates three rules at once, so no single rule is
// pinned by it.
//
// So: one row per frozen check, each a valid record with exactly ONE thing
// wrong. Weakening any single check turns its own row red and nothing else,
// which is what makes this table a gate rather than a demonstration.
describe('Settings envelope: every frozen check is a live gate (#1307)', () => {
  it('accepts the baselines the rejection tables mutate, so one wrong value is the only difference', () => {
    expect(() => validatePreEnvelopeCard(preEnvelopeCard(), '$card')).not.toThrow()
    expect(() => validatePreEnvelopeBoard(preEnvelopeBoard(), '$board')).not.toThrow()
    expect(() => validatePreEnvelopeIdea(preEnvelopeIdea(), '$idea')).not.toThrow()
    expect(() => validatePreEnvelopeBoardSettings(preEnvelopeBoardSettings(), '$settings')).not.toThrow()
    expect(() => validatePreEnvelopeBoardCards(preEnvelopeBoard(), '$board')).not.toThrow()
  })

  const CARD_REJECTIONS: Record<string, () => unknown> = {
    'a Card that is not a plain record': () => ['not', 'a', 'card'],
    'a top-level key outside the frozen allowlist': () => mutated(preEnvelopeCard(), { settings: {} }),
    'an empty Card id': () => mutated(preEnvelopeCard(), { id: '' }),
    'a Card kind from a later build': () => mutated(preEnvelopeCard(), { kind: 'sketch' }),
    'a createdBy that is not a record': () => mutated(preEnvelopeCard(), { createdBy: 'actor-1' }),
    'a lastModifiedBy that is not a record': () => mutated(preEnvelopeCard(), { lastModifiedBy: 7 }),
    'blocks that are not an array': () => mutated(preEnvelopeCard(), { blocks: {} }),
    'a position that is not a point': () => mutated(preEnvelopeCard(), { position: { x: 1 } }),
    'assets that are not an array': () => mutated(preEnvelopeCard(), { assets: {} }),
    'a link preview on a Card that is not a Note': () => mutated(preEnvelopeCard(), { kind: 'askAi' }),
    'a link preview that is not a record': () =>
      mutated(preEnvelopeCard(), { linkPreview: 'https://example.invalid/x' }),
    'a local HTML preview that is not a record': () =>
      mutated(preEnvelopeCard(), { localHtmlPreview: 'preview' }, ['linkPreview']),
    'a local HTML preview on a Card that is not a Note': () =>
      mutated(preEnvelopeCard(), { kind: 'askAi', localHtmlPreview: { assetId: 'asset-1' } }, ['linkPreview']),
    'both previews on one Card': () =>
      mutated(preEnvelopeCard(), { localHtmlPreview: { assetId: 'asset-1' } }),
    'a title that is not a string': () => mutated(preEnvelopeCard(), { title: 7 }),
    'a header color that is not a string': () => mutated(preEnvelopeCard(), { headerColor: 7 }),
    'a header fill outside the closed set': () => mutated(preEnvelopeCard(), { headerFill: 'gradient' }),
    'a compression prompt that is not a string': () =>
      mutated(preEnvelopeCard(), { compressionPrompt: 7 }),
    'an empty model name': () => mutated(preEnvelopeCard(), { model: '' }),
    'a conversation style outside the closed set': () =>
      mutated(preEnvelopeCard(), { conversationStyle: 'panel' }),
    'a conversation turn count that is not a positive integer': () =>
      mutated(preEnvelopeCard(), { conversationTurns: 0 }),
    'a Note scale outside the closed set': () => mutated(preEnvelopeCard(), { fontSize: 'x-large' }),
    'a source that is not a record': () => mutated(preEnvelopeCard(), { source: 'paste' }),
    'an agentic flag that is not a boolean': () => mutated(preEnvelopeCard(), { agentic: 'yes' }),
    'a zIndex that is not a finite number': () =>
      mutated(preEnvelopeCard(), { zIndex: Number.POSITIVE_INFINITY }),
    'a size with no extent': () => mutated(preEnvelopeCard(), { size: { width: 0, height: 20 } }),
    'an empty group id': () => mutated(preEnvelopeCard(), { groupId: '' }),
    // Rule 3, frozen. This is the ONE settings-shaped failure a shipped build
    // is still allowed to have, and the whole envelope rests on the line above
    // it accepting any key inside a `meta` that IS a plain record.
    'an envelope that is not a plain record': () =>
      mutated(preEnvelopeCard(), { meta: ['not', 'a', 'record'] }),
    'a retired legacy Mod payload': () => mutated(preEnvelopeCard(), { mod: { id: 'legacy-mod' } }),
    'a Block that is not a record': () => mutated(preEnvelopeCard(), { blocks: ['line'] }),
    'a Block key outside the frozen allowlist': () =>
      mutated(preEnvelopeCard(), { blocks: [{ id: 'block-1', text: 'body', indent: 2 }] }),
    'an empty Block id': () => mutated(preEnvelopeCard(), { blocks: [{ id: '', text: 'body' }] }),
    'Block text that is not a string': () =>
      mutated(preEnvelopeCard(), { blocks: [{ id: 'block-1', text: 7 }] }),
    'a Block kind outside the closed set': () =>
      mutated(preEnvelopeCard(), { blocks: [{ id: 'block-1', text: 'body', kind: 'quote' }] }),
  }

  for (const [check, build] of Object.entries(CARD_REJECTIONS)) {
    it(`the frozen Card validator refuses ${check}`, () => {
      expect(() => validatePreEnvelopeCard(build(), '$card')).toThrow(PreEnvelopeValidationError)
    })
  }

  const BOARD_CARDS_REJECTIONS: Record<string, () => unknown> = {
    'a Board that is not a record': () => 'board',
    'a Board whose cards are not an array': () => mutated(preEnvelopeBoard(), { cards: {} }),
    'a Card that only appears in the intent history': () => mutated(preEnvelopeBoard(), {
      intentLog: [{ id: 'event-1', data: { card: mutated(preEnvelopeCard(), { settings: {} }) } }],
    }),
  }

  for (const [check, build] of Object.entries(BOARD_CARDS_REJECTIONS)) {
    it(`the frozen Card walk refuses ${check}`, () => {
      expect(() => validatePreEnvelopeBoardCards(build(), '$board')).toThrow(PreEnvelopeValidationError)
    })
  }

  const BOARD_REJECTIONS: Record<string, () => unknown> = {
    'a Board that is not a plain record': () => [],
    'a top-level key outside the frozen allowlist': () => mutated(preEnvelopeBoard(), { settings: {} }),
    'a Board version this build did not write': () => mutated(preEnvelopeBoard(), { version: 2 }),
    'an updatedAt that is not a canonical timestamp': () =>
      mutated(preEnvelopeBoard(), { updatedAt: '2026-01-01' }),
    'cards that are not an array': () => mutated(preEnvelopeBoard(), { cards: {} }),
    'connections that are not an array': () => mutated(preEnvelopeBoard(), { connections: {} }),
    'outputs that are not an array': () => mutated(preEnvelopeBoard(), { outputs: {} }),
    'runs that are not an array': () => mutated(preEnvelopeBoard(), { runs: {} }),
    'an intent log that is not an array': () => mutated(preEnvelopeBoard(), { intentLog: {} }),
    'highlights that are not an array': () => mutated(preEnvelopeBoard(), { highlights: {} }),
    'highlight tags that are not an array': () => mutated(preEnvelopeBoard(), { highlightTags: {} }),
    'compaction summaries that are not an array': () =>
      mutated(preEnvelopeBoard(), { compactionSummaries: {} }),
    'the retired visual decay flag': () => mutated(preEnvelopeBoard(), { visualDecayEnabled: true }),
    'an AI settings bag the delegated check refuses': () =>
      mutated(preEnvelopeBoard(), { aiSettings: mutated(preEnvelopeBoardSettings(), { model: '' }) }),
  }

  for (const [check, build] of Object.entries(BOARD_REJECTIONS)) {
    it(`the frozen Board validator refuses ${check}`, () => {
      expect(() => validatePreEnvelopeBoard(build(), '$board')).toThrow(PreEnvelopeBoardValidationError)
    })
  }

  const IDEA_REJECTIONS: Record<string, () => unknown> = {
    'an Idea that is not a plain record': () => 'idea',
    'a key outside the frozen exact set': () => mutated(preEnvelopeIdea(), { settings: {} }),
    // `hasExactKeys` is the strictest surface in the frozen file: a MISSING key
    // fails it too, which `hasOnlyKeys` would not.
    'an Idea missing one of the exact keys': () => mutated(preEnvelopeIdea(), {}, ['lastOpenedAt']),
    'an empty Idea id': () => mutated(preEnvelopeIdea(), { id: '' }),
    'a name that is not a string': () => mutated(preEnvelopeIdea(), { name: 7 }),
    'a createdAt that is not a canonical timestamp': () =>
      mutated(preEnvelopeIdea(), { createdAt: '2026-01-01' }),
    'an updatedAt that is not a canonical timestamp': () =>
      mutated(preEnvelopeIdea(), { updatedAt: 'yesterday' }),
    'a lastOpenedAt that is not a canonical timestamp': () =>
      mutated(preEnvelopeIdea(), { lastOpenedAt: 1 }),
  }

  for (const [check, build] of Object.entries(IDEA_REJECTIONS)) {
    it(`the frozen Idea validator refuses ${check}`, () => {
      expect(() => validatePreEnvelopeIdea(build(), '$idea')).toThrow(PreEnvelopeBoardValidationError)
    })
  }

  // The bag that carried the two historical downgrade breaks. Every one of
  // these is a shape this build now opens without complaint, so each row is
  // also a measure of what the one-time Board break actually buys.
  const BOARD_SETTINGS_REJECTIONS: Record<string, () => unknown> = {
    'a bag that is not a plain record': () => [],
    'a key outside the frozen allowlist': () =>
      mutated(preEnvelopeBoardSettings(), { futureRunKnob: { retries: 3 } }),
    'an empty model name': () => mutated(preEnvelopeBoardSettings(), { model: '' }),
    'a models list that is not an array': () => mutated(preEnvelopeBoardSettings(), { models: 'a/b' }),
    'a models list holding an empty name': () =>
      mutated(preEnvelopeBoardSettings(), { models: [''] }),
    'a provider outside the closed set': () =>
      mutated(preEnvelopeBoardSettings(), { provider: 'futureprovider' }),
    'a provider catalog naming a provider it has never met': () => mutated(preEnvelopeBoardSettings(), {
      providerModels: {
        ...preEnvelopeProviderModels(),
        futureprovider: { model: 'future/one', models: ['future/one'] },
      },
    }),
    'a provider catalog missing a live provider': () => mutated(preEnvelopeBoardSettings(), {
      providerModels: mutated(preEnvelopeProviderModels(), {}, ['codex']),
    }),
    'a catalog entry with a key outside its exact set': () => mutated(preEnvelopeBoardSettings(), {
      providerModels: mutated(preEnvelopeProviderModels(), {
        openrouter: { model: 'a/b', models: ['a/b'], pinned: true },
      }),
    }),
    'a catalog entry with an empty model name': () => mutated(preEnvelopeBoardSettings(), {
      providerModels: mutated(preEnvelopeProviderModels(), { openrouter: { model: '', models: ['a/b'] } }),
    }),
    'a catalog entry whose models are not names': () => mutated(preEnvelopeBoardSettings(), {
      providerModels: mutated(preEnvelopeProviderModels(), { openrouter: { model: 'a/b', models: [7] } }),
    }),
    'a catalog entry whose model is not in its own list': () => mutated(preEnvelopeBoardSettings(), {
      providerModels: mutated(preEnvelopeProviderModels(), { openrouter: { model: 'a/b', models: ['c/d'] } }),
    }),
    // The exact rung that shipped as a silent downgrade break, on its own.
    'a reasoning rung outside the closed set': () =>
      mutated(preEnvelopeBoardSettings(), { reasoningEffort: 'ultra' }),
    'a bag carrying no reasoning rung at all': () =>
      mutated(preEnvelopeBoardSettings(), {}, ['reasoningEffort']),
    'a system prompt that is not a string': () =>
      mutated(preEnvelopeBoardSettings(), { systemPrompt: 7 }),
    'a negative chain confirm threshold': () =>
      mutated(preEnvelopeBoardSettings(), { chainConfirmThreshold: -1 }),
    'a fractional chain confirm threshold': () =>
      mutated(preEnvelopeBoardSettings(), { chainConfirmThreshold: 1.5 }),
    'a compaction mode outside the closed set': () =>
      mutated(preEnvelopeBoardSettings(), { compactionMode: 'obsessive' }),
  }

  for (const [check, build] of Object.entries(BOARD_SETTINGS_REJECTIONS)) {
    it(`the frozen Board settings validator refuses ${check}`, () => {
      expect(() => validatePreEnvelopeBoardSettings(build(), '$settings'))
        .toThrow(PreEnvelopeBoardValidationError)
    })
  }
})

// The baselines the tables mutate. Each carries a valid value for EVERY field
// the frozen validators check, optional ones included, so a row that sets one
// bad value is a record with exactly one thing wrong with it.
function preEnvelopeCard(): Record<string, unknown> {
  return {
    id: 'card-frozen',
    kind: 'note',
    createdBy: { actorId: 'actor-1' },
    lastModifiedBy: { actorId: 'actor-1' },
    title: 'A Note',
    headerColor: 'ink',
    headerFill: 'half',
    blocks: [{ id: 'block-1', text: 'body', kind: 'line' }],
    assets: [],
    linkPreview: { url: 'https://example.invalid/x' },
    compressionPrompt: 'shorter',
    model: 'a/b',
    conversationStyle: 'debate',
    conversationTurns: 2,
    fontSize: 'medium',
    source: { kind: 'paste' },
    agentic: true,
    zIndex: 3,
    position: { x: 1, y: 2 },
    size: { width: 10, height: 20 },
    groupId: 'group-1',
    meta: { reachMode: 'research', futurePanel: { collapsed: true } },
  }
}

function preEnvelopeBoard(): Record<string, unknown> {
  return {
    version: 1,
    updatedAt: '2026-01-01T00:00:00.000Z',
    cards: [preEnvelopeCard()],
    connections: [],
    outputs: [],
    runs: [],
    highlights: [],
    highlightTags: [],
    intentLog: [],
    compactionSummaries: [],
    aiSettings: preEnvelopeBoardSettings(),
  }
}

function preEnvelopeIdea(): Record<string, unknown> {
  return {
    id: 'idea-frozen',
    name: 'Frozen',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    lastOpenedAt: '2026-01-01T00:00:00.000Z',
  }
}

function preEnvelopeBoardSettings(): Record<string, unknown> {
  return {
    model: 'a/b',
    models: ['a/b'],
    provider: 'openrouter',
    providerModels: preEnvelopeProviderModels(),
    reasoningEffort: 'medium',
    systemPrompt: 'be brief',
    chainConfirmThreshold: 3,
    compactionMode: 'when-needed',
  }
}

function preEnvelopeProviderModels(): Record<string, unknown> {
  return {
    openrouter: { model: 'a/b', models: ['a/b'] },
    'claude-code': { model: 'sonnet', models: ['sonnet'] },
    codex: { model: 'default', models: ['default'] },
    antigravity: { model: 'auto', models: ['auto'] },
  }
}

function mutated(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
  drop: readonly string[] = [],
): Record<string, unknown> {
  const built = { ...base, ...patch }
  for (const key of drop) delete built[key]
  return built
}

// A Board's AI settings as the raw bag they are on disk, so a test can look at
// a key this build has no field for.
function foreignKeys(settings: object): Record<string, unknown> {
  return settings as Record<string, unknown>
}

// What a build that predates the envelope would render: it knows only the
// retired top-level field and its own default, and never looks in `meta`.
function readAsPreviousBuild(card: unknown): string | NoteFontSize {
  const legacy = (card as { fontSize?: unknown }).fontSize
  return typeof legacy === 'string' ? legacy : DEFAULT_NOTE_FONT_SIZE
}

function corpusCase() {
  const found = profileFixtureCorpus.find((entry) => entry.id === 'settings-envelope-tolerant-read-input')
  if (!found) throw new Error('The settings-envelope corpus case is missing')
  return found.data as {
    expectedRuntimeDefaults: {
      reachMode: 'web'
      researchDepth: 'S'
      researchJob: null
      noteFontSize: 2
    }
    expectedBoardAiRuntimeDefaults: {
      reasoningEffort: 'medium'
      compactionMode: 'when-needed'
    }
    expectedMalformedOutcome: string
  }
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}
