// A FROZEN copy of the strict Board, Idea, and Board-settings validators as
// they shipped before the Board-level settings envelope existed. Like
// preEnvelopeCardValidator.ts, this file exists to BE the previous build in a
// downgrade test, so it is deliberately self-contained: it imports no validator,
// no guard, and no key list from the live code. If it did, a future change to
// the live validators would silently move the goalposts and the proof would
// pass by definition.
//
// DO NOT UPDATE THIS FILE TO MATCH A NEW BOARD SHAPE. Updating it is how the
// proof dies.
//
// WHAT THIS FILE PROVES, AND WHAT IT DELIBERATELY DOES NOT
//
// The Card envelope could be made downgrade-safe for builds ALREADY INSTALLED,
// because `meta` was already on every shipped Card allowlist. The Board and the
// Idea had no such field. So a Board-level or Idea-level setting costs one
// compatibility break, exactly once: the release that first WRITES one is the
// release older builds start refusing, and only builds from the tolerant
// release onward are safe.
//
// That price is deliberate, is stated in ADR 0040, and is what this file makes
// visible rather than hypothetical. The tests using it assert BOTH halves: the
// previous build refuses these Boards (the cost, paid once), and this build
// accepts them (the gain, kept forever). If someone later re-tightens the live
// validators, the second half goes red here.
//
// WHAT IS FROZEN
//
// The parts a settings change can plausibly break: the closed top-level key
// allowlist on the Board (`hasOnlyKeys`), the exact key set on the Idea
// (`hasExactKeys`), and the closed key list plus closed value sets inside
// `aiSettings`. Board child collections are checked for container shape only,
// because a settings envelope cannot reach inside them.

const PRE_ENVELOPE_LIVE_PROVIDER_IDS = ['openrouter', 'claude-code', 'codex', 'antigravity'] as const
const PRE_ENVELOPE_PERSISTED_PROVIDER_IDS: readonly string[] = [
  ...PRE_ENVELOPE_LIVE_PROVIDER_IDS,
  'gemini',
]

// Verbatim copy of the shipped `hasOnlyKeys` allowlist in validateBoard. A key
// outside this list failed the Board, failed the projection, and surfaced as a
// corrupt Profile revision for everything the person had.
export const PRE_ENVELOPE_BOARD_KEYS = [
  'version',
  'cards',
  'connections',
  'outputs',
  'runs',
  'highlights',
  'highlightTags',
  'intentLog',
  'visualDecayEnabled',
  'aiSettings',
  'compactionSummaries',
  'updatedAt',
] as const

// Verbatim copy of the shipped `hasExactKeys` list in validateIdea. This was the
// strictest record surface in the file: not a subset check, an exact match.
export const PRE_ENVELOPE_IDEA_KEYS = [
  'id',
  'name',
  'createdAt',
  'updatedAt',
  'lastOpenedAt',
] as const

// Verbatim copy of the shipped `hasOnlyKeys` allowlist inside
// validateBoardSettings, alongside its closed value sets below.
export const PRE_ENVELOPE_BOARD_SETTINGS_KEYS = [
  'model',
  'models',
  'provider',
  'providerModels',
  'reasoningEffort',
  'systemPrompt',
  'chainConfirmThreshold',
  'compactionMode',
] as const

export class PreEnvelopeBoardValidationError extends Error {}

// Throws exactly where the shipped validator threw.
export function validatePreEnvelopeBoard(board: unknown, path: string): void {
  if (!isPlainRecord(board) || !hasOnlyKeys(board, PRE_ENVELOPE_BOARD_KEYS)
    || board.version !== 1 || !canonicalTimestamp(board.updatedAt)
    || !Array.isArray(board.cards) || !Array.isArray(board.connections)
    || !Array.isArray(board.outputs) || !Array.isArray(board.runs)
    || (board.intentLog !== undefined && !Array.isArray(board.intentLog))
    || (board.highlights !== undefined && !Array.isArray(board.highlights))
    || (board.highlightTags !== undefined && !Array.isArray(board.highlightTags))
    || (board.compactionSummaries !== undefined && !Array.isArray(board.compactionSummaries))) {
    fail(`${path} is not a current SavedBoard`)
  }
  if (board.visualDecayEnabled !== undefined) fail(`${path}.visualDecayEnabled is retired`)
  if (board.aiSettings !== undefined) validatePreEnvelopeBoardSettings(board.aiSettings, `${path}.aiSettings`)
}

export function validatePreEnvelopeIdea(idea: unknown, path: string): void {
  if (!isPlainRecord(idea) || !hasExactKeys(idea, PRE_ENVELOPE_IDEA_KEYS)
    || !nonEmptyString(idea.id) || typeof idea.name !== 'string'
    || !canonicalTimestamp(idea.createdAt) || !canonicalTimestamp(idea.updatedAt)
    || !canonicalTimestamp(idea.lastOpenedAt)) fail(`${path} is not a current Idea`)
}

export function validatePreEnvelopeBoardSettings(value: unknown, path: string): void {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, PRE_ENVELOPE_BOARD_SETTINGS_KEYS)
    || !nonEmptyString(value.model) || !isStringArray(value.models)
    || (value.provider !== undefined
      && (typeof value.provider !== 'string'
        || !PRE_ENVELOPE_PERSISTED_PROVIDER_IDS.includes(value.provider)))
    || (value.providerModels !== undefined && !validPreEnvelopeProviderModelSettingsMap(value.providerModels))
    || typeof value.reasoningEffort !== 'string'
    || !['xhigh', 'high', 'medium', 'low', 'minimal', 'none'].includes(value.reasoningEffort)
    || (value.systemPrompt !== undefined && typeof value.systemPrompt !== 'string')
    || (value.chainConfirmThreshold !== undefined && !nonNegativeSafeInteger(value.chainConfirmThreshold))
    || (value.compactionMode !== undefined
      && (typeof value.compactionMode !== 'string'
        || !['never', 'when-needed', 'eager'].includes(value.compactionMode)))) {
    fail(`${path} is not current Board settings`)
  }
}

function validPreEnvelopeProviderModelSettingsMap(value: unknown): boolean {
  if (!hasOnlyKeys(value, PRE_ENVELOPE_PERSISTED_PROVIDER_IDS)) return false
  if (!PRE_ENVELOPE_LIVE_PROVIDER_IDS.every((provider) => provider in (value as object))) return false
  return Object.values(value as Record<string, unknown>).every((selection) => {
    return hasExactKeys(selection, ['model', 'models'])
      && nonEmptyString((selection as Record<string, unknown>).model)
      && isStringArray((selection as Record<string, unknown>).models)
      && ((selection as Record<string, unknown>).models as string[])
        .includes((selection as Record<string, unknown>).model as string)
  })
}

function fail(message: string): never {
  throw new PreEnvelopeBoardValidationError(message)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): boolean {
  if (!isPlainRecord(value)) return false
  const allowedSet = new Set(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function hasExactKeys(value: unknown, expected: readonly string[]): boolean {
  return isPlainRecord(value)
    && Object.keys(value).sort().join(',') === [...expected].sort().join(',')
}

// Copied from the shipped validator EXACTLY, trim included: the shipped
// `nonEmptyString` did not trim, and a frozen proof that is stricter than what
// shipped over-states what the previous build refuses.
function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

// The shipped validator required every entry to be a NON-EMPTY string. A
// frozen copy that accepts '' would claim the previous build opens a Board it
// actually refuses, which is the one direction this proof must never drift.
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => nonEmptyString(entry))
}

function nonNegativeSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && Number(value) >= 0 && !Object.is(value, -0)
}

function canonicalTimestamp(value: unknown): boolean {
  if (typeof value !== 'string') return false
  const milliseconds = Date.parse(value)
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value
}
