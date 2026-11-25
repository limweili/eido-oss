import type { RendererProfileProjection } from '../../electron/profileBridgeContract'
import { captureProfileGuiInertJson } from '../persistence/profileGuiSaveScheduler'
import type { SavedBoard } from './types'

export type ProfileRendererAuthorityState = Readonly<{
  projection: RendererProfileProjection
  boards: Readonly<Record<string, SavedBoard>>
}>

/**
 * Rebases renderer-first work captured behind the live-Agent hold onto the
 * newly authoritative Profile. Stable-id collections merge by identity;
 * overlapping scalar edits keep the renderer value because it is the later
 * state-first intent. Agent-only records and provenance remain present.
 */
export function mergeLiveProfileAuthority(
  base: ProfileRendererAuthorityState,
  held: ProfileRendererAuthorityState,
  authoritative: ProfileRendererAuthorityState,
): ProfileRendererAuthorityState {
  const mergedUserModTemplates = mergeUserModTemplateArray(
    base.projection.userModTemplates,
    held.projection.userModTemplates,
    authoritative.projection.userModTemplates,
  )
  const mergedBoards = mergeValue(
    base.boards,
    held.boards,
    authoritative.boards,
  ) as Readonly<Record<string, SavedBoard>>
  const mergedProjection = preserveAuthoritativeIdeaTimestamps(mergeValue(
    base.projection,
    held.projection,
    authoritative.projection,
  ) as RendererProfileProjection, authoritative.projection)
  const ideaIds = new Set(mergedProjection.ideas.map((idea) => idea.id))
  const completeBoards = preserveAuthoritativeBoardTimestamps(
    Object.fromEntries(Object.entries(mergedBoards)
      .filter(([ideaId]) => ideaIds.has(ideaId))),
    authoritative.boards,
  )
  for (const ideaId of ideaIds) {
    if (!completeBoards[ideaId]) {
      throw new Error(`Live Profile merge has no Board for Idea ${ideaId}`)
    }
  }
  const boardReplacements = Object.fromEntries(Object.entries(completeBoards)
    .filter(([ideaId, board]) => !sameValue(board, authoritative.boards[ideaId])))
  return Object.freeze({
    projection: captureProfileGuiInertJson({
      ...mergedProjection,
      userModTemplates: mergedUserModTemplates,
      boardReplacements,
    }, '$liveProfileMergedProjection'),
    boards: captureProfileGuiInertJson(completeBoards, '$liveProfileMergedBoards'),
  })
}

/**
 * A held renderer edit is later content intent, but native authority may have
 * advanced the Idea clocks while that edit was held. Existing Idea birth is
 * immutable and the two mutable clocks therefore use native authority as a
 * lower bound instead of inheriting ordinary scalar merge precedence.
 */
function preserveAuthoritativeIdeaTimestamps(
  merged: RendererProfileProjection,
  authoritative: RendererProfileProjection,
): RendererProfileProjection {
  const authoritativeById = new Map(authoritative.ideas.map((idea) => [idea.id, idea]))
  return {
    ...merged,
    ideas: merged.ideas.map((idea) => {
      const nativeIdea = authoritativeById.get(idea.id)
      if (!nativeIdea) return idea
      return {
        ...idea,
        createdAt: nativeIdea.createdAt,
        updatedAt: latestTimestamp(idea.updatedAt, nativeIdea.updatedAt),
        lastOpenedAt: latestTimestamp(idea.lastOpenedAt, nativeIdea.lastOpenedAt),
      }
    }),
  }
}

/** Native Board.updatedAt is monotonic even when held Board content wins. */
function preserveAuthoritativeBoardTimestamps(
  merged: Readonly<Record<string, SavedBoard>>,
  authoritative: Readonly<Record<string, SavedBoard>>,
): Readonly<Record<string, SavedBoard>> {
  return Object.fromEntries(Object.entries(merged).map(([ideaId, board]) => {
    const nativeBoard = authoritative[ideaId]
    return [ideaId, nativeBoard
      ? { ...board, updatedAt: latestTimestamp(board.updatedAt, nativeBoard.updatedAt) }
      : board]
  }))
}

function latestTimestamp(left: string, right: string): string {
  return Date.parse(left) >= Date.parse(right) ? left : right
}

const ABSENT = Symbol('live-profile-absent')
type MergeValue = unknown | typeof ABSENT

function mergeValue(
  base: MergeValue,
  held: MergeValue,
  authoritative: MergeValue,
  field?: string,
): MergeValue {
  if (sameValue(held, base)) return authoritative
  if (sameValue(authoritative, base)) return held
  if (sameValue(held, authoritative)) return held
  if (held === ABSENT) return ABSENT
  if (authoritative === ABSENT) return held
  if (Array.isArray(held) && Array.isArray(authoritative)) {
    if (Array.isArray(base) && identityArray(base, held, authoritative)) {
      if (field === 'intentLog') {
        return mergeAppendOnlyIdentityArray(base, held, authoritative)
      }
      return mergeIdentityArray(base, held, authoritative)
    }
    return held
  }
  if (isPlainRecord(held) && isPlainRecord(authoritative)) {
    const baseRecord = isPlainRecord(base) ? base : {}
    const keys = [...new Set([
      ...Object.keys(authoritative),
      ...Object.keys(held),
      ...Object.keys(baseRecord),
    ])]
    const result: Record<string, unknown> = {}
    for (const key of keys) {
      const merged = mergeValue(
        Object.prototype.hasOwnProperty.call(baseRecord, key) ? baseRecord[key] : ABSENT,
        Object.prototype.hasOwnProperty.call(held, key) ? held[key] : ABSENT,
        Object.prototype.hasOwnProperty.call(authoritative, key) ? authoritative[key] : ABSENT,
        key,
      )
      if (merged !== ABSENT) result[key] = merged
    }
    return result
  }
  return held
}

/**
 * Renderer lifecycle reconciliation already treats each user Mod template as
 * an independently versioned catalog entry. The live-Agent hold uses the same
 * rule so a native template commit and an unrelated held GUI edit both
 * survive, while two different edits to one template fail closed.
 */
function mergeUserModTemplateArray<Template extends Readonly<{ templateId: string }>>(
  base: readonly Template[],
  held: readonly Template[],
  authoritative: readonly Template[],
): readonly Template[] {
  const toUniqueMap = (templates: readonly Template[]) => {
    const mapped = new Map<string, Template>()
    for (const template of templates) {
      if (!isPlainRecord(template)
        || typeof template.templateId !== 'string'
        || template.templateId.length === 0
        || mapped.has(template.templateId)) {
        throw new Error('Live Profile Mod template catalog is ambiguous')
      }
      mapped.set(template.templateId, template)
    }
    return mapped
  }
  const baseById = toUniqueMap(base)
  const heldById = toUniqueMap(held)
  const authoritativeById = toUniqueMap(authoritative)
  const ids = [...new Set([
    ...authoritativeById.keys(),
    ...heldById.keys(),
    ...baseById.keys(),
  ])]
  const result: Template[] = []
  for (const id of ids) {
    const baseTemplate = baseById.get(id) ?? ABSENT
    const heldTemplate = heldById.get(id) ?? ABSENT
    const authoritativeTemplate = authoritativeById.get(id) ?? ABSENT
    const heldChanged = !sameValue(heldTemplate, baseTemplate)
    const authoritativeChanged = !sameValue(authoritativeTemplate, baseTemplate)
    if (heldChanged
      && authoritativeChanged
      && !sameValue(heldTemplate, authoritativeTemplate)) {
      throw new Error(`Live Profile Mod template ${id} changed concurrently and cannot be reconciled`)
    }
    const selected = heldChanged
      ? heldTemplate
      : authoritativeChanged
        ? authoritativeTemplate
        : baseTemplate
    if (selected !== ABSENT) result.push(selected)
  }
  return result
}

/**
 * Intent history is append-only at the native GUI-admission seam. The freshly
 * authoritative log must therefore remain an exact prefix; renderer events
 * captured behind the live hold can only be appended after it.
 */
function mergeAppendOnlyIdentityArray(
  base: readonly unknown[],
  held: readonly unknown[],
  authoritative: readonly unknown[],
): readonly unknown[] {
  const authoritativeIds = new Set(authoritative.map(identity))
  const heldIds = new Set(held.map(identity))
  const suffix = [
    ...held.filter((item) => !authoritativeIds.has(identity(item))),
    ...base.filter((item) => !authoritativeIds.has(identity(item)) && !heldIds.has(identity(item))),
  ]
  return [
    ...authoritative,
    ...rebaseAppendOnlyOrdering(authoritative, suffix),
  ]
}

function rebaseAppendOnlyOrdering(
  authoritative: readonly unknown[],
  suffix: readonly unknown[],
): readonly unknown[] {
  let previousSeq = 0
  for (const item of authoritative) {
    const seq = isPlainRecord(item) ? item.seq : undefined
    if (typeof seq === 'number' && Number.isFinite(seq)) {
      previousSeq = Math.max(previousSeq, seq)
    }
  }
  const authoritativeTail = authoritative[authoritative.length - 1]
  let previousAt = isPlainRecord(authoritativeTail) && typeof authoritativeTail.at === 'string'
    ? authoritativeTail.at
    : undefined
  let previousAtMillis = previousAt === undefined ? Number.NEGATIVE_INFINITY : Date.parse(previousAt)

  return suffix.map((item) => {
    if (!isPlainRecord(item)) return item
    previousSeq += 1
    const candidateAt = typeof item.at === 'string' ? item.at : undefined
    const candidateAtMillis = candidateAt === undefined ? Number.NaN : Date.parse(candidateAt)
    const at = Number.isFinite(candidateAtMillis) && candidateAtMillis >= previousAtMillis
      ? candidateAt
      : previousAt
    if (at !== undefined) {
      previousAt = at
      previousAtMillis = Date.parse(at)
    }
    return {
      ...item,
      ...(at === undefined ? {} : { at }),
      seq: previousSeq,
    }
  })
}

function mergeIdentityArray(
  base: readonly unknown[],
  held: readonly unknown[],
  authoritative: readonly unknown[],
): readonly unknown[] {
  const baseById = new Map(base.map((item) => [identity(item), item]))
  const heldById = new Map(held.map((item) => [identity(item), item]))
  const authoritativeById = new Map(authoritative.map((item) => [identity(item), item]))
  const baseOrder = [...baseById.keys()]
  const heldOrder = [...heldById.keys()]
  const authoritativeOrder = [...authoritativeById.keys()]
  const heldChangedOrder = JSON.stringify(heldOrder) !== JSON.stringify(baseOrder)
  const ids = [...new Set([
    ...(heldChangedOrder ? heldOrder : authoritativeOrder),
    ...(heldChangedOrder ? authoritativeOrder : heldOrder),
    ...baseOrder,
  ])]
  const result: unknown[] = []
  for (const id of ids) {
    const merged = mergeValue(
      baseById.has(id) ? baseById.get(id) : ABSENT,
      heldById.has(id) ? heldById.get(id) : ABSENT,
      authoritativeById.has(id) ? authoritativeById.get(id) : ABSENT,
    )
    if (merged !== ABSENT) result.push(merged)
  }
  return result
}

function identityArray(...arrays: readonly unknown[][]): boolean {
  const values = arrays.flat()
  if (values.length === 0) return false
  for (const array of arrays) {
    const ids = array.map(identity)
    if (ids.some((id) => id === undefined) || new Set(ids).size !== ids.length) return false
  }
  return true
}

function identity(candidate: unknown): string | undefined {
  return isPlainRecord(candidate) && typeof candidate.id === 'string'
    ? candidate.id
    : undefined
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === ABSENT || right === ABSENT) return left === right
  return JSON.stringify(left) === JSON.stringify(right)
}

function isPlainRecord(candidate: unknown): candidate is Record<string, unknown> {
  return Boolean(candidate)
    && typeof candidate === 'object'
    && !Array.isArray(candidate)
    && (Object.getPrototypeOf(candidate) === Object.prototype
      || Object.getPrototypeOf(candidate) === null)
}
