// A FROZEN copy of the strict Card validator as it shipped before the settings
// envelope existed. This file exists to be the previous build in a downgrade
// test, so it is deliberately self-contained: it imports no validator, no
// guard, and no key list from the live code. If it did, a future change to the
// live validator would silently move the goalposts and the downgrade proof
// would pass by definition.
//
// DO NOT UPDATE THIS FILE TO MATCH A NEW CARD SHAPE. Updating it is how the
// proof dies. A change that makes this validator reject a Board the current
// build writes is exactly the failure the proof is here to catch: a build
// already installed on someone's machine holds this code, and a Card it
// refuses fails the whole Profile revision, not just the Card. The only
// legitimate reason to touch this file is to freeze a NEWER floor after every
// build carrying the old floor is provably gone.
//
// WHAT IS FROZEN
//
// The parts a settings change can plausibly break: the closed top-level key
// allowlist (`hasOnlyKeys` in the shipped validator), the scalar and closed-set
// guards on each strict field, and `meta` accepted as an open plain record with
// no key checks at all. That last line is the whole reason the envelope is
// `meta`: shipped builds already tolerate any key inside it.
//
// WHAT IS NOT FROZEN, ON PURPOSE
//
// The interiors of `linkPreview`, `localHtmlPreview`, `source`, `createdBy`,
// `lastModifiedBy`, and `modV2`. Those are content structures, checked here for
// container shape only. A settings envelope cannot reach inside them, so
// copying hundreds of lines of their guards would add maintenance without
// adding proof.

const PRE_ENVELOPE_CARD_KINDS = [
  'note', 'askAi', 'result', 'mod', 'group', 'conversation', 'title',
] as const

// Verbatim copy of the shipped `hasOnlyKeys` allowlist in validateCard. A key
// outside this list failed the Card, failed the projection, and surfaced as a
// corrupt Profile revision for everything the person had.
export const PRE_ENVELOPE_CARD_KEYS = [
  'id',
  'kind',
  'createdBy',
  'lastModifiedBy',
  'title',
  'headerColor',
  'headerFill',
  'blocks',
  'assets',
  'linkPreview',
  'localHtmlPreview',
  'compressionPrompt',
  'mod',
  'modV2',
  'model',
  'conversationStyle',
  'conversationTurns',
  'fontSize',
  'source',
  'agentic',
  'zIndex',
  'position',
  'size',
  'groupId',
  'meta',
] as const

export class PreEnvelopeValidationError extends Error {}

// Throws exactly where the shipped validator threw. The message shape does not
// matter to the proof; the accept/reject decision is the whole contract.
export function validatePreEnvelopeCard(card: unknown, path: string): void {
  if (!isPlainRecord(card) || !hasOnlyKeys(card, PRE_ENVELOPE_CARD_KEYS)
    || !nonEmptyString(card.id)
    || !(PRE_ENVELOPE_CARD_KINDS as readonly unknown[]).includes(card.kind)
    || (card.createdBy !== undefined && !isPlainRecord(card.createdBy))
    || (card.lastModifiedBy !== undefined && !isPlainRecord(card.lastModifiedBy))
    || !Array.isArray(card.blocks) || !isPoint(card.position)
    || (card.assets !== undefined && !Array.isArray(card.assets))
    || (card.linkPreview !== undefined && (card.kind !== 'note' || !isPlainRecord(card.linkPreview)))
    || (card.localHtmlPreview !== undefined
      && (card.kind !== 'note' || !isPlainRecord(card.localHtmlPreview)))
    || (card.linkPreview !== undefined && card.localHtmlPreview !== undefined)
    || (card.title !== undefined && typeof card.title !== 'string')
    || (card.headerColor !== undefined && typeof card.headerColor !== 'string')
    || (card.headerFill !== undefined && !['half', 'full', 'pattern'].includes(card.headerFill as string))
    || (card.compressionPrompt !== undefined && typeof card.compressionPrompt !== 'string')
    || (card.model !== undefined && !nonEmptyString(card.model))
    || (card.conversationStyle !== undefined
      && !['debate', 'critique', 'interview', 'collaborate'].includes(card.conversationStyle as string))
    || (card.conversationTurns !== undefined && !positiveSafeInteger(card.conversationTurns))
    // The strict union that made a foreign font size a lost Board. Frozen as
    // it shipped: this is the incident the envelope answers.
    || (card.fontSize !== undefined && !['small', 'medium', 'large'].includes(card.fontSize as string))
    || (card.source !== undefined && !isPlainRecord(card.source))
    || (card.agentic !== undefined && typeof card.agentic !== 'boolean')
    || (card.zIndex !== undefined && !finiteNumber(card.zIndex))
    || (card.size !== undefined && !isSize(card.size))
    || (card.groupId !== undefined && !nonEmptyString(card.groupId))
    // The one open container a shipped build already tolerates: any key, any
    // value, checked for plain-object shape and nothing more.
    || (card.meta !== undefined && !isPlainRecord(card.meta))) {
    throw new PreEnvelopeValidationError(`${path} is not a current Card`)
  }
  card.blocks.forEach((block, index) => validatePreEnvelopeBlock(block, `${path}.blocks[${index}]`))
  if (hasOwn(card, 'mod') && card.mod !== undefined) {
    throw new PreEnvelopeValidationError(`${path}.mod is a retired legacy Mod payload`)
  }
}

function validatePreEnvelopeBlock(block: unknown, path: string): void {
  if (!isPlainRecord(block) || !hasOnlyKeys(block, ['id', 'text', 'kind'])
    || !nonEmptyString(block.id) || typeof block.text !== 'string'
    || (block.kind !== undefined
      && !['line', 'heading', 'bullet', 'generated'].includes(block.kind as string))) {
    throw new PreEnvelopeValidationError(`${path} is not a current Block`)
  }
}

// Every Card a SavedBoard carries, including the ones cloned into history
// events: the shipped validator walked both, so a downgrade fails on either.
export function validatePreEnvelopeBoardCards(board: unknown, path: string): void {
  if (!isPlainRecord(board) || !Array.isArray(board.cards)) {
    throw new PreEnvelopeValidationError(`${path} is not a current SavedBoard`)
  }
  board.cards.forEach((card, index) => validatePreEnvelopeCard(card, `${path}.cards[${index}]`))
  const intentLog = board.intentLog
  if (!Array.isArray(intentLog)) return
  intentLog.forEach((event, index) => {
    if (!isPlainRecord(event) || !isPlainRecord(event.data)) return
    const card = event.data.card
    if (card === undefined) return
    validatePreEnvelopeCard(card, `${path}.intentLog[${index}].data.card`)
  })
}

function hasOnlyKeys(value: unknown, allowed: readonly string[]): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false
  const allowedSet = new Set<string>(allowed)
  return Object.keys(value).every((key) => allowedSet.has(key))
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.prototype.hasOwnProperty.call(value, key)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && !Object.is(value, -0)
}

function positiveSafeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) > 0
}

function isPoint(value: unknown): boolean {
  return isPlainRecord(value) && Object.keys(value).sort().join(',') === 'x,y'
    && finiteNumber(value.x) && finiteNumber(value.y)
}

function isSize(value: unknown): boolean {
  return isPlainRecord(value) && Object.keys(value).sort().join(',') === 'height,width'
    && finiteNumber(value.width) && finiteNumber(value.height)
    && Number(value.width) > 0 && Number(value.height) > 0
}
