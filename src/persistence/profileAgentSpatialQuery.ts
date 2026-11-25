import {
  findAgentCardPlacement,
  type AgentPlaceableCardKind,
} from '../graph/agentCardPlacement'
import {
  AGENT_SPATIAL_READ_LIMITS,
  agentCardSetBounds,
  readAgentCardNeighbors,
  type AgentCardBoundsItem,
  type AgentCardNeighborItem,
} from '../graph/agentSpatialRead'
import type { Card, Connection } from '../graph/types'
import { formatCardDeepLink, parseCardDeepLink } from '../shared/deepLinks'
import {
  validateProfileLogicalDocument,
  type ProfileLogicalDocument,
} from './profileLogicalProjection'

export const PROFILE_AGENT_SPATIAL_QUERY_LIMITS = Object.freeze({
  maxIdBytes: 512,
  maxAddressBytes: 4 * 1024,
  maxNearCards: 64,
  defaultNeighbors: AGENT_SPATIAL_READ_LIMITS.defaultNeighbors,
  maxNeighbors: AGENT_SPATIAL_READ_LIMITS.maxNeighbors,
  defaultBytes: AGENT_SPATIAL_READ_LIMITS.defaultBytes,
  minBytes: AGENT_SPATIAL_READ_LIMITS.minBytes,
  maxBytes: AGENT_SPATIAL_READ_LIMITS.maxBytes,
  maxBoundingCards: AGENT_SPATIAL_READ_LIMITS.maxBoundingCardIds,
})

export type ProfileAgentCardReference = Readonly<{
  cardId: string
  deepLink: string
}>

export type ProfileAgentCardPlacementRequest = Readonly<{
  ideaId: string
  near: readonly string[]
  kind: AgentPlaceableCardKind
}>

export type ProfileAgentCardPlacement = Readonly<{
  profileId: string
  revision: number
  ideaId: string
  anchors: readonly ProfileAgentCardReference[]
  position: Readonly<{ x: number; y: number }>
}>

export type ProfileAgentCardNeighborsRequest = Readonly<{
  ideaId: string
  card: string
  limit?: number
  byteLimit?: number
}>

export type ProfileAgentCardNeighbor = AgentCardNeighborItem & Readonly<{
  deepLink: string
}>

export type ProfileAgentCardNeighbors = Readonly<{
  profileId: string
  revision: number
  ideaId: string
  card: ProfileAgentCardReference
  items: readonly ProfileAgentCardNeighbor[]
  truncated: boolean
}>

export type ProfileAgentCardSetBoundsRequest = Readonly<{
  ideaId: string
  cards: readonly string[]
}>

export type ProfileAgentCardSetBounds = Readonly<{
  profileId: string
  revision: number
  ideaId: string
  cards: readonly ProfileAgentCardBounds[]
  bounds: Readonly<{ x: number; y: number; width: number; height: number }>
}>

export type ProfileAgentCardBounds = AgentCardBoundsItem & ProfileAgentCardReference

export type ProfileAgentSpatialFailure =
  | Readonly<{ ok: false; reason: 'invalid-request' | 'profile-invalid' }>
  | Readonly<{ ok: false; reason: 'idea-not-found'; ideaId: string }>
  | Readonly<{ ok: false; reason: 'card-not-found'; ideaId: string; cardId: string }>
  | Readonly<{
      ok: false
      reason: 'card-idea-mismatch'
      ideaId: string
      linkedIdeaId: string
      cardId: string
    }>
  | Readonly<{
      ok: false
      reason: 'no-bounded-space'
      profileId: string
      revision: number
      ideaId: string
    }>

export type ProfileAgentSpatialResult<Value> =
  | Readonly<{ ok: true; value: Value }>
  | ProfileAgentSpatialFailure

export function isProfileAgentCardNeighbors(
  candidate: unknown,
): candidate is ProfileAgentCardNeighbors {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, [
      'card',
      'ideaId',
      'items',
      'profileId',
      'revision',
      'truncated',
    ])
    || !boundedId(candidate.profileId)
    || !boundedId(candidate.ideaId)
    || !nonNegativeSafeInteger(candidate.revision)
    || typeof candidate.truncated !== 'boolean'
    || !Array.isArray(candidate.items)
    || candidate.items.length > PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxNeighbors) {
    return false
  }
  const ideaId = candidate.ideaId
  return validCardReference(candidate.card, ideaId)
    && candidate.items.every((item) => validNeighbor(item, ideaId))
}

export function isProfileAgentCardSetBounds(
  candidate: unknown,
): candidate is ProfileAgentCardSetBounds {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, ['bounds', 'cards', 'ideaId', 'profileId', 'revision'])
    || !boundedId(candidate.profileId)
    || !boundedId(candidate.ideaId)
    || !nonNegativeSafeInteger(candidate.revision)
    || !Array.isArray(candidate.cards)
    || candidate.cards.length === 0
    || candidate.cards.length > PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxBoundingCards
    || !validRect(candidate.bounds)) {
    return false
  }
  const ideaId = candidate.ideaId
  if (!candidate.cards.every((card) => validCardBounds(card, ideaId))) return false
  const cards = candidate.cards as ProfileAgentCardBounds[]
  return cards.every((card, index) => index === 0 || cards[index - 1]!.cardId < card.cardId)
    && aggregateMatchesCardBounds(candidate.bounds, cards)
}

export function queryProfileAgentCardPlacement(
  candidateDocument: ProfileLogicalDocument,
  candidateRequest: unknown,
): ProfileAgentSpatialResult<ProfileAgentCardPlacement> {
  const request = validatePlacementRequest(candidateRequest)
  if (!request) return failure({ ok: false, reason: 'invalid-request' })
  const anchors = resolveProfileAgentCardAddresses(request.ideaId, request.near)
  if (!anchors.ok) return anchors
  const projected = projectIdeaGraph(candidateDocument, request.ideaId)
  if (!projected.ok) return projected
  const placed = findAgentCardPlacement({
    ...projected.value.graph,
    anchorCardIds: anchors.cardIds,
    kind: request.kind,
  })
  if (!placed.ok) {
    if (placed.reason === 'anchor-not-found') {
      return failure({
        ok: false,
        reason: 'card-not-found',
        ideaId: request.ideaId,
        cardId: placed.anchorCardId,
      })
    }
    if (placed.reason === 'no-bounded-space') {
      return failure({
        ok: false,
        reason: 'no-bounded-space',
        profileId: projected.value.document.head.profileId,
        revision: projected.value.document.head.revision,
        ideaId: request.ideaId,
      })
    }
    return failure({ ok: false, reason: 'invalid-request' })
  }
  return {
    ok: true,
    value: Object.freeze({
      profileId: projected.value.document.head.profileId,
      revision: projected.value.document.head.revision,
      ideaId: request.ideaId,
      anchors: Object.freeze(anchors.cardIds.map((cardId) => cardReference(request.ideaId, cardId))),
      position: Object.freeze({ ...placed.position }),
    }),
  }
}

export function queryProfileAgentCardNeighbors(
  candidateDocument: ProfileLogicalDocument,
  candidateRequest: unknown,
): ProfileAgentSpatialResult<ProfileAgentCardNeighbors> {
  const request = normalizeProfileAgentCardNeighborsRequest(candidateRequest)
  if (!request) return failure({ ok: false, reason: 'invalid-request' })
  const resolved = resolveProfileAgentCardAddresses(request.ideaId, [request.card])
  if (!resolved.ok) return resolved
  const projected = projectIdeaGraph(candidateDocument, request.ideaId)
  if (!projected.ok) return projected
  const cardId = resolved.cardIds[0]!
  const read = readAgentCardNeighbors(projected.value.graph, {
    cardId,
    limit: AGENT_SPATIAL_READ_LIMITS.maxNeighbors,
    byteLimit: AGENT_SPATIAL_READ_LIMITS.maxBytes,
  })
  if (!read.ok) {
    return read.reason === 'card-not-found'
      ? failure({ ok: false, reason: 'card-not-found', ideaId: request.ideaId, cardId })
      : failure({ ok: false, reason: 'invalid-request' })
  }
  const items: ProfileAgentCardNeighbor[] = []
  let itemBytes = 2
  for (const candidate of read.items) {
    if (items.length >= request.limit) break
    const item = Object.freeze({
      cardId: candidate.cardId,
      deepLink: formatCardDeepLink('eido://app/', {
        ideaId: request.ideaId,
        cardId: candidate.cardId,
      }),
      kind: candidate.kind,
      position: candidate.position,
      size: candidate.size,
      connection: candidate.connection,
    })
    const bytes = utf8Bytes(JSON.stringify(item)) + (items.length === 0 ? 0 : 1)
    if (itemBytes + bytes > request.byteLimit) break
    items.push(item)
    itemBytes += bytes
  }
  return {
    ok: true,
    value: Object.freeze({
      profileId: projected.value.document.head.profileId,
      revision: projected.value.document.head.revision,
      ideaId: request.ideaId,
      card: cardReference(request.ideaId, cardId),
      items: Object.freeze(items),
      truncated: read.truncated || items.length < read.items.length,
    }),
  }
}

export function queryProfileAgentCardSetBounds(
  candidateDocument: ProfileLogicalDocument,
  candidateRequest: unknown,
): ProfileAgentSpatialResult<ProfileAgentCardSetBounds> {
  const request = normalizeProfileAgentCardSetBoundsRequest(candidateRequest)
  if (!request) return failure({ ok: false, reason: 'invalid-request' })
  const resolved = resolveProfileAgentCardAddresses(request.ideaId, request.cards)
  if (!resolved.ok) return resolved
  const projected = projectIdeaGraph(candidateDocument, request.ideaId)
  if (!projected.ok) return projected
  const read = agentCardSetBounds(projected.value.graph.cards, resolved.cardIds)
  if (!read.ok) {
    return read.reason === 'card-not-found'
      ? failure({
          ok: false,
          reason: 'card-not-found',
          ideaId: request.ideaId,
          cardId: read.cardId,
        })
      : failure({ ok: false, reason: 'invalid-request' })
  }
  return {
    ok: true,
    value: Object.freeze({
      profileId: projected.value.document.head.profileId,
      revision: projected.value.document.head.revision,
      ideaId: request.ideaId,
      cards: Object.freeze(read.cards.map((card) => Object.freeze({
        ...card,
        deepLink: formatCardDeepLink('eido://app/', {
          ideaId: request.ideaId,
          cardId: card.cardId,
        }),
      }))),
      bounds: Object.freeze({ ...read.bounds }),
    }),
  }
}

type ProjectedIdeaGraph = Readonly<{
  document: ProfileLogicalDocument
  graph: Readonly<{ cards: readonly Card[]; connections: readonly Connection[] }>
}>

function projectIdeaGraph(
  candidateDocument: ProfileLogicalDocument,
  ideaId: string,
): ProfileAgentSpatialResult<ProjectedIdeaGraph> {
  let document: ProfileLogicalDocument
  try {
    document = validateProfileLogicalDocument(candidateDocument)
  } catch {
    return failure({ ok: false, reason: 'profile-invalid' })
  }
  if (!document.records.some((record) => record.kind === 'idea' && record.recordId === ideaId)) {
    return failure({ ok: false, reason: 'idea-not-found', ideaId })
  }
  const boardId = `board:${ideaId}`
  const cards = document.records
    .filter((record) => record.kind === 'card' && record.ownerId === boardId)
    .map((record): Card => {
      const payload = record.payload as unknown as Card
      const blocks: Card['blocks'] = []
      return Object.freeze({
        id: record.recordId,
        kind: payload.kind,
        position: payload.position,
        ...(payload.size === undefined ? {} : { size: payload.size }),
        blocks,
      })
    })
  const connections = document.records
    .filter((record) => record.kind === 'connection' && record.ownerId === boardId)
    .map((record) => record.payload as unknown as Connection)
  return {
    ok: true,
    value: Object.freeze({
      document,
      graph: Object.freeze({ cards: Object.freeze(cards), connections: Object.freeze(connections) }),
    }),
  }
}

function validatePlacementRequest(candidate: unknown): ProfileAgentCardPlacementRequest | undefined {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, ['ideaId', 'kind', 'near'])
    || !boundedId(candidate.ideaId)
    || !Array.isArray(candidate.near)
    || candidate.near.length === 0
    || candidate.near.length > PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxNearCards
    || candidate.near.some((address) => (
      !boundedNonEmptyString(address, PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxAddressBytes)
    ))
    || !['note', 'askAi', 'group', 'conversation', 'title'].includes(String(candidate.kind))) {
    return undefined
  }
  return candidate as unknown as ProfileAgentCardPlacementRequest
}

export type NormalizedProfileAgentCardNeighborsRequest = Readonly<{
  ideaId: string
  card: string
  limit: number
  byteLimit: number
}>

export function normalizeProfileAgentCardNeighborsRequest(
  candidate: unknown,
): NormalizedProfileAgentCardNeighborsRequest | undefined {
  if (!isRecord(candidate)
    || !hasOnlyKeys(candidate, ['byteLimit', 'card', 'ideaId', 'limit'])
    || !boundedId(candidate.ideaId)
    || !boundedNonEmptyString(candidate.card, PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxAddressBytes)) {
    return undefined
  }
  const limit = candidate.limit ?? PROFILE_AGENT_SPATIAL_QUERY_LIMITS.defaultNeighbors
  const byteLimit = candidate.byteLimit ?? PROFILE_AGENT_SPATIAL_QUERY_LIMITS.defaultBytes
  if (!positiveSafeInteger(limit)
    || limit > PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxNeighbors
    || !positiveSafeInteger(byteLimit)
    || byteLimit < PROFILE_AGENT_SPATIAL_QUERY_LIMITS.minBytes
    || byteLimit > PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxBytes) return undefined
  return Object.freeze({ ideaId: candidate.ideaId, card: candidate.card, limit, byteLimit })
}

export function normalizeProfileAgentCardSetBoundsRequest(
  candidate: unknown,
): ProfileAgentCardSetBoundsRequest | undefined {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, ['cards', 'ideaId'])
    || !boundedId(candidate.ideaId)
    || !Array.isArray(candidate.cards)
    || candidate.cards.length === 0
    || candidate.cards.length > PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxBoundingCards
    || candidate.cards.some((address) => (
      !boundedNonEmptyString(address, PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxAddressBytes)
    ))) return undefined
  return candidate as unknown as ProfileAgentCardSetBoundsRequest
}

type ResolvedCardAddresses =
  | Readonly<{ ok: true; cardIds: readonly string[] }>
  | ProfileAgentSpatialFailure

export function resolveProfileAgentCardAddresses(
  ideaId: string,
  addresses: readonly string[],
): ResolvedCardAddresses {
  const cardIds = new Set<string>()
  for (const address of addresses) {
    const link = parseCardDeepLink(address)
    if (link) {
      if (!boundedId(link.ideaId) || !boundedId(link.cardId)) {
        return failure({ ok: false, reason: 'invalid-request' })
      }
      if (link.ideaId !== ideaId) {
        return failure({
          ok: false,
          reason: 'card-idea-mismatch',
          ideaId,
          linkedIdeaId: link.ideaId,
          cardId: link.cardId,
        })
      }
      cardIds.add(link.cardId)
      continue
    }
    if (address.includes('://') || !boundedId(address)) {
      return failure({ ok: false, reason: 'invalid-request' })
    }
    cardIds.add(address)
  }
  return { ok: true, cardIds: Object.freeze([...cardIds].sort(compareStrings)) }
}

function cardReference(ideaId: string, cardId: string): ProfileAgentCardReference {
  return Object.freeze({
    cardId,
    deepLink: formatCardDeepLink('eido://app/', { ideaId, cardId }),
  })
}

function validCardReference(candidate: unknown, ideaId: string): candidate is ProfileAgentCardReference {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, ['cardId', 'deepLink'])
    || !boundedId(candidate.cardId)
    || !boundedNonEmptyString(
      candidate.deepLink,
      PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxAddressBytes,
    )) return false
  const link = parseCardDeepLink(candidate.deepLink)
  return link?.ideaId === ideaId && link.cardId === candidate.cardId
}

function validCardBounds(candidate: unknown, ideaId: string): candidate is ProfileAgentCardBounds {
  return isRecord(candidate)
    && hasExactKeys(candidate, ['cardId', 'deepLink', 'kind', 'position', 'size'])
    && validCardReference({ cardId: candidate.cardId, deepLink: candidate.deepLink }, ideaId)
    && ['note', 'askAi', 'result', 'mod', 'group', 'conversation', 'title']
      .includes(String(candidate.kind))
    && validPoint(candidate.position)
    && validSize(candidate.size)
}

function aggregateMatchesCardBounds(
  candidate: unknown,
  cards: readonly ProfileAgentCardBounds[],
): boolean {
  if (!validRect(candidate) || cards.length === 0) return false
  const bounds = candidate as Readonly<{ x: number; y: number; width: number; height: number }>
  const x = Math.min(...cards.map((card) => card.position.x))
  const y = Math.min(...cards.map((card) => card.position.y))
  const right = Math.max(...cards.map((card) => card.position.x + card.size.width))
  const bottom = Math.max(...cards.map((card) => card.position.y + card.size.height))
  return bounds.x === x
    && bounds.y === y
    && bounds.width === right - x
    && bounds.height === bottom - y
}

function validNeighbor(candidate: unknown, ideaId: string): candidate is ProfileAgentCardNeighbor {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, [
      'cardId',
      'connection',
      'deepLink',
      'kind',
      'position',
      'size',
    ])
    || !validCardReference(
      { cardId: candidate.cardId, deepLink: candidate.deepLink },
      ideaId,
    )
    || !['note', 'askAi', 'result', 'mod', 'group', 'conversation', 'title']
      .includes(String(candidate.kind))
    || !validPoint(candidate.position)
    || !validSize(candidate.size)
    || !validNeighborConnection(candidate.connection)) return false
  return true
}

function validNeighborConnection(candidate: unknown): boolean {
  if (!isRecord(candidate)
    || !hasExactKeys(candidate, [
      'direction',
      ...(candidate.groupMode === undefined ? [] : ['groupMode']),
      'id',
      'polarity',
      ...(candidate.reason === undefined ? [] : ['reason']),
      'role',
      'strength',
    ])
    || !boundedId(candidate.id)
    || !['incoming', 'outgoing'].includes(String(candidate.direction))
    || !['strong', 'weak'].includes(String(candidate.strength))
    || !['helps', 'pushesAgainst'].includes(String(candidate.polarity))
    || !['feeds', 'modifies'].includes(String(candidate.role))
    || (candidate.reason !== undefined
      && !boundedNonEmptyString(candidate.reason, PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxBytes))
    || (candidate.groupMode !== undefined
      && !['full', 'compress'].includes(String(candidate.groupMode)))) return false
  return true
}

function validPoint(candidate: unknown): boolean {
  return isRecord(candidate)
    && hasExactKeys(candidate, ['x', 'y'])
    && Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
}

function validSize(candidate: unknown): boolean {
  return isRecord(candidate)
    && hasExactKeys(candidate, ['height', 'width'])
    && Number.isFinite(candidate.width)
    && (candidate.width as number) > 0
    && Number.isFinite(candidate.height)
    && (candidate.height as number) > 0
}

function validRect(candidate: unknown): boolean {
  return isRecord(candidate)
    && hasExactKeys(candidate, ['height', 'width', 'x', 'y'])
    && Number.isFinite(candidate.x)
    && Number.isFinite(candidate.y)
    && Number.isFinite(candidate.width)
    && (candidate.width as number) > 0
    && Number.isFinite(candidate.height)
    && (candidate.height as number) > 0
}

function failure<Failure extends ProfileAgentSpatialFailure>(value: Failure): Failure {
  return Object.freeze(value)
}

function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort(compareStrings)
  return keys.length === expected.length && keys.every((key, index) => key === expected[index])
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  const allowedKeys = new Set(allowed)
  return Object.keys(value).every((key) => allowedKeys.has(key))
}

function boundedNonEmptyString(candidate: unknown, maxBytes: number): candidate is string {
  return typeof candidate === 'string'
    && candidate.length > 0
    && new TextEncoder().encode(candidate).byteLength <= maxBytes
}

function boundedId(candidate: unknown): candidate is string {
  return boundedNonEmptyString(candidate, PROFILE_AGENT_SPATIAL_QUERY_LIMITS.maxIdBytes)
    && !(candidate as string).includes('://')
}

function positiveSafeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && (candidate as number) > 0
}

function nonNegativeSafeInteger(candidate: unknown): candidate is number {
  return Number.isSafeInteger(candidate) && (candidate as number) >= 0
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength
}

function compareStrings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
