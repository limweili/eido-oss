// The settings envelope: the one place a preference is read from persisted
// state, and the one set of rules that keeps a preference from ever costing
// someone their Board. Content fails closed, settings fail soft (ADR 0040).
//
// WHY THE ENVELOPE IS `meta` AND NOT A NEW TOP-LEVEL FIELD
//
// The obvious shape for this would be an additive `settings?: Record<string,
// unknown>` next to the strict Card fields. That shape reproduces the exact
// failure it is meant to prevent. `validateCard` in profileLogicalProjection
// holds a Card to a closed key allowlist (`hasOnlyKeys`), and every build
// already installed carries its own copy of that allowlist. A build that has
// never heard of `settings` sees a stranger key, fails the Card, fails the
// projection, and the SQLite revision store turns that into a corrupt Profile
// for the whole revision. Shipping a new top-level key is therefore a lost
// Board on every downgrade, forever, for every build already in the wild.
//
// `meta` is the only container those shipped builds already tolerate: it is on
// the allowlist and validated as an open plain record with no key checks at
// all. So the envelope IS `meta`. Nothing new needs to reach the wire, and the
// downgrade proof in fixtures/preEnvelopeCardValidator.ts pins that promise
// against the strict validator as it shipped.
//
// THE THREE RULES, IMPLEMENTED ONCE
//
// 1. A value this build does not own is preserved verbatim. That covers an
//    unknown KEY and, just the same, a known key holding a VALUE this build
//    cannot act on: both are somebody's saved choice, and neither is this
//    build's to overwrite. Read helpers never mutate, `writeSetting` and
//    `clearSetting` copy every key they do not own straight through, and
//    `foreignEnvelopeKeys` plus `mergeForeignEnvelopeKeys` carry both cases
//    across a seam that cannot hold the whole bag. So a Board that a newer
//    build wrote and an older build re-saved still carries the newer build's
//    settings intact.
// 2. A known key holding an unrecognised or out-of-range value is dropped for
//    the read only, and the setting's documented default substitutes. The
//    stored value stays where it is: physically deleting it is how an old
//    build would destroy a new build's preference, which is rule 1 again.
//    Nothing here ever fails a Card, a Board, or a Profile.
// 3. An envelope that is not a plain object may still fail closed. That is
//    real corruption of a container, not an unrecognised setting, and the
//    strict record validators keep owning it.
//
// The envelope is record-agnostic on purpose. It takes a plain record, never a
// Card, which is what let the Board and the Idea adopt it in this same change
// without redesigning anything here. Every record now carries one: `meta` on
// the Card, `settings` on the Board and the Idea, and `aiSettings` on the Board
// for the AI bag, each validated for container shape only.
//
// TWO SHAPES OF CARRIER, ONE SET OF RULES
//
// A Card carries its envelope in a sidecar field (`meta`) that no runtime code
// reads directly, so the carrier helpers take the record and look inside it. A
// Board's `aiSettings` is different: the bag IS the runtime object, read key by
// key all over the app. The `*Envelope*` forms below take the envelope itself,
// so that second shape reuses these rules instead of inventing a second
// mechanism, and the carrier forms are thin wrappers over them.
//
// The carrier forms know only `meta`, so `Board.settings`, `Idea.settings`, and
// `aiSettings` go through the envelope forms. That is one API with one sugared
// entry point, not two APIs: giving the carrier forms a field selector would
// put a field name at every call site to serve records that declare no
// contracts yet. When one of them does, the honest move is to retire the
// carrier forms and let every reader dereference its own field, rather than
// widen them.
//
// WHAT ADOPTING THIS COST THE BOARD AND THE IDEA, ONCE
//
// `validateBoard` and `validateIdea` gate their records with closed key lists,
// and every build already installed carries its own copy of that list without
// `settings` in it. The tolerated field therefore protects nothing already
// shipped: the first release that actually WRITES a Board- or Idea-level
// setting is the release older builds start refusing. That break is deliberate,
// is paid once, and every release after it is safe forever. There was no way to
// design around it short of never adding the field, which is the trade ADR 0040
// already made for Cards by choosing `meta`.

export type SettingsEnvelope = Record<string, unknown>

// A record whose envelope is the Card's sidecar `meta` field. The Board and the
// Idea carry their own envelope under `settings` and the Board's AI bag under
// `aiSettings`; all three are read through the `*Envelope*` forms, which take
// the envelope itself rather than the record around it.
export type SettingsEnvelopeCarrier = { meta?: SettingsEnvelope }

// One setting, declared once: where it lives, what counts as a value this
// build can act on, and what it means when the answer is no.
export type SettingContract<Value> = Readonly<{
  key: string
  fallback: Value
  accepts: (value: unknown) => boolean
  // Only for `resolveEnvelope`, and only for a key whose absence would leave a
  // hole in a shape callers already dereference. Everywhere else absent and
  // default stay one state.
  required?: boolean
}>

export function defineSetting<Value>(contract: {
  key: string
  fallback: Value
  accepts: (value: unknown) => boolean
  required?: boolean
}): SettingContract<Value> {
  return Object.freeze({ ...contract, fallback: deeplyFrozen(contract.fallback) })
}

// A fallback is handed out BY REFERENCE, to every record that needs it, for the
// life of the process. One mutable default array is therefore one array shared
// by every Board that never chose its own, and a single caller pushing onto it
// would edit the default every other Board reads. Freezing it with the contract
// makes that mistake throw where it is made rather than surface as a Board
// holding models nobody picked.
function deeplyFrozen<Value>(value: Value): Value {
  // An already frozen value is done, which also stops a fallback that somehow
  // refers back to itself from walking forever.
  if (typeof value !== 'object' || value === null || Object.isFrozen(value)) return value
  for (const entry of Object.values(value)) deeplyFrozen(entry)
  return Object.freeze(value)
}

// The common case: a closed set of choices. A value outside the set is a
// choice from a build this one has never met, which reads as the default.
export function defineChoiceSetting<Value>(contract: {
  key: string
  fallback: Value
  choices: readonly Value[]
  required?: boolean
}): SettingContract<Value> {
  const choices: readonly unknown[] = contract.choices
  return defineSetting<Value>({
    key: contract.key,
    fallback: contract.fallback,
    required: contract.required,
    accepts: (value) => choices.includes(value),
  })
}

// Rule 3's predicate. Arrays and exotic prototypes are not envelopes; the
// strict record validators use this to keep failing closed on a corrupt
// container, which is the one settings-shaped failure that is allowed to
// refuse a record.
export function isSettingsEnvelope(value: unknown): value is SettingsEnvelope {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

// The envelope a carrier actually has, or none. A carrier holding a corrupt
// envelope reads as no settings at all rather than throwing: by the time a
// record reaches the runtime it has already passed the strict validators, so
// this is a belt-and-braces read, not the place rule 3 is enforced.
export function settingsEnvelopeOf(
  carrier: Pick<SettingsEnvelopeCarrier, 'meta'> | undefined,
): SettingsEnvelope | undefined {
  const envelope = carrier?.meta
  return isSettingsEnvelope(envelope) ? envelope : undefined
}

// Rule 2, against an envelope directly. A container that is not a plain object
// reads as no settings at all rather than throwing, for the same reason
// `settingsEnvelopeOf` does: rule 3 belongs to the strict record validators.
export function readEnvelopeSetting<Value>(
  envelope: unknown,
  setting: SettingContract<Value>,
): Value {
  if (!isSettingsEnvelope(envelope)) return setting.fallback
  const value = envelope[setting.key]
  return setting.accepts(value) ? (value as Value) : setting.fallback
}

// Whether the envelope carries the key at all, regardless of whether this build
// can read the value.
export function envelopeHasSetting(envelope: unknown, setting: SettingContract<unknown>): boolean {
  return isSettingsEnvelope(envelope)
    && Object.prototype.hasOwnProperty.call(envelope, setting.key)
}

// Rule 2. A missing key, a save from before the setting existed, and a value
// this build cannot interpret all read as the documented default.
export function readSetting<Value>(
  carrier: Pick<SettingsEnvelopeCarrier, 'meta'> | undefined,
  setting: SettingContract<Value>,
): Value {
  return readEnvelopeSetting(settingsEnvelopeOf(carrier), setting)
}

// Whether the envelope carries the key at all, regardless of whether this
// build can read the value. Callers that must tell "never set" apart from
// "set to something foreign" need this; a plain read cannot, by design.
export function hasSetting(
  carrier: Pick<SettingsEnvelopeCarrier, 'meta'> | undefined,
  setting: SettingContract<unknown>,
): boolean {
  return envelopeHasSetting(settingsEnvelopeOf(carrier), setting)
}

// Rules 1 and 2 applied to a whole bag at once, for the second carrier shape:
// an envelope that IS the runtime object. Every declared key comes back holding
// a value this build can act on, and every key this build does not own is
// copied through verbatim so a save by this build hands a newer build all of
// its settings back.
//
// A declared key the envelope does not carry stays absent unless the contract
// is marked `required`. Absent and default are deliberately one state: a bag
// written before a setting existed stays byte-identical to one that never left
// the default, so adding a setting never rewrites anybody's Board. `required`
// exists only for the keys whose ABSENCE would leave a hole in a type callers
// already dereference, which for a Board's `aiSettings` means `model`,
// `models`, and `reasoningEffort` (all three are non-optional on
// `BoardAiSettings`). Marking a key `required` is therefore the one case where
// resolving a bag is not byte-identical to the bag that came in.
//
// A contract whose documented default is `undefined` has no default value to
// substitute, so an unreadable value there drops the key. Absent already reads
// as "this build decides", which is the same answer.
//
// THIS IS A READ, NOT A REWRITE. The result is what the runtime should act on,
// so a present-but-unreadable key comes back holding the default. Handing this
// result back to a save path would push those defaults onto disk and overwrite
// what a newer build wrote, so a writer must build its output from the keys it
// owns and then run `mergeForeignEnvelopeKeys` over what `foreignEnvelopeKeys`
// found, never from this.
export function resolveEnvelope(
  envelope: unknown,
  contracts: readonly SettingContract<unknown>[],
): SettingsEnvelope {
  const source = isSettingsEnvelope(envelope) ? envelope : {}
  const resolved: SettingsEnvelope = { ...source }
  for (const contract of contracts) {
    const present = Object.prototype.hasOwnProperty.call(source, contract.key)
    if (!present && !contract.required) continue
    if (present && contract.accepts(source[contract.key])) continue
    if (contract.fallback === undefined) delete resolved[contract.key]
    else resolved[contract.key] = contract.fallback
  }
  return resolved
}

// Rule 1's other half at a runtime seam that cannot hold the whole bag. A store
// that decomposes an envelope into typed fields loses every key it has no field
// for; this hands back exactly those keys so the save path can put them back.
//
// A key this build DOES own is foreign too whenever the stored value is one it
// cannot act on. Rule 2 substitutes the documented default for the READ, and a
// writer that then persisted that default would delete a newer build's setting
// for good: the founder sets it on a new build, downgrades, the old build saves
// once, and the value is gone even after upgrading again. So the raw value
// comes back here as well, and `mergeForeignEnvelopeKeys` decides on the write
// side whether it still stands.
export function foreignEnvelopeKeys(
  envelope: unknown,
  contracts: readonly SettingContract<unknown>[],
): SettingsEnvelope {
  if (!isSettingsEnvelope(envelope)) return {}
  const owned = contractsByKey(contracts)
  const foreign: SettingsEnvelope = {}
  for (const key of Object.keys(envelope)) {
    const contract = owned.get(key)
    if (contract === undefined || !contract.accepts(envelope[key])) foreign[key] = envelope[key]
  }
  return foreign
}

// Rule 1 on the write side of that same seam: what this build owns, plus every
// foreign value put back exactly as it was found.
//
// A key this build has never heard of always rides through. A key it owns
// yields the moment this build writes an answer of its own, which is what keeps
// the person in charge of their own settings: while the runtime still holds the
// default rule 2 substituted, nothing was chosen and the stored value stands.
// The one case this cannot tell apart is a person deliberately picking the very
// default they were already being shown, which leaves the stored value alone.
// The app reads the same setting either way, so the only visible difference is
// on a build that can read the stored value, where the person's earlier choice
// survives. That is the safe direction to be wrong in.
export function mergeForeignEnvelopeKeys(
  own: SettingsEnvelope,
  foreign: SettingsEnvelope,
  contracts: readonly SettingContract<unknown>[],
): SettingsEnvelope {
  const owned = contractsByKey(contracts)
  const merged: SettingsEnvelope = { ...own }
  for (const key of Object.keys(foreign)) {
    const contract = owned.get(key)
    const chose = contract !== undefined
      && Object.prototype.hasOwnProperty.call(own, key)
      && !isSameSettingValue(own[key], contract.fallback)
    if (!chose) merged[key] = foreign[key]
  }
  return merged
}

function contractsByKey(
  contracts: readonly SettingContract<unknown>[],
): Map<string, SettingContract<unknown>> {
  return new Map(contracts.map((contract) => [contract.key, contract]))
}

// Whether two setting values are the same answer. Structural, not by reference:
// a default that is an array or a record is a fresh instance every time a
// caller builds one, and a reference test would call every one of them a
// deliberate choice.
export function isSameSettingValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false
    return left.every((entry, index) => isSameSettingValue(entry, right[index]))
  }
  if (!isSettingsEnvelope(left) || !isSettingsEnvelope(right)) return false
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
    && isSameSettingValue(left[key], right[key]))
}

// Rule 1 on the write side. Every key this build does not own is copied
// through untouched, and writing the default deletes the key instead of
// storing it, so absent and default stay one state: a record that never left
// the default is byte-identical to one written before the setting existed.
// An emptied envelope collapses to undefined for the same reason.
export function writeSetting<Value>(
  carrier: Pick<SettingsEnvelopeCarrier, 'meta'> | undefined,
  setting: SettingContract<Value>,
  value: Value,
): SettingsEnvelope | undefined {
  if (isSameSettingValue(value, setting.fallback)) return clearSetting(carrier, setting)
  return { ...settingsEnvelopeOf(carrier), [setting.key]: value }
}

// Rule 1's write side, applied to the carrier. `writeSetting` and
// `clearSetting` hand back the envelope a Card should now hold, including
// `undefined` for one that emptied; these two put that answer on the Card.
// Deleting the field rather than storing an empty object is what keeps absent
// and default one state all the way to disk.
export function withCardEnvelope<CardShape extends SettingsEnvelopeCarrier>(
  card: CardShape,
  meta: SettingsEnvelope | undefined,
): CardShape {
  const next: CardShape = { ...card }
  setCardEnvelope(next, meta)
  return next
}

// The same, for the writers that edit a draft in place.
export function setCardEnvelope(
  card: SettingsEnvelopeCarrier,
  meta: SettingsEnvelope | undefined,
): void {
  if (meta !== undefined) card.meta = meta
  else delete card.meta
}

export function clearSetting(
  carrier: Pick<SettingsEnvelopeCarrier, 'meta'> | undefined,
  setting: SettingContract<unknown>,
): SettingsEnvelope | undefined {
  const envelope = settingsEnvelopeOf(carrier)
  if (envelope === undefined) return undefined
  const { [setting.key]: _cleared, ...rest } = envelope
  return Object.keys(rest).length > 0 ? rest : undefined
}
