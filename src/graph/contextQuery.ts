// The context layer seam (ADR 0012): answer "which cards and connections feed
// this card, in what order, and why" as plain data. Deterministic and
// explainable — same graph, same policy, same selection. Consumers (compiler,
// previews, future lineage/multi-hop features) render or assemble; they do not
// re-walk connections with private rules. See docs/foundations/context-layer.md.

import { contractFor } from './contextContracts'
import { cardById, incomingConnections, membersOf } from './graphHelpers'
import type { Connection, ConnectionGroupMode, SavedBoard } from './types'

// A named, versioned rule set for a context query. Policies are recorded data,
// not hardcoded call-site behavior, so provenance can say which policy shaped a run.
export type ContextPolicy = {
  name: string
  version: 1
  // Follow helps-connections one hop further upstream from each first-hop source.
  secondHop: boolean
  // Whether hops beyond the first also follow weak helps-connections (default: strong only).
  secondHopWeakToo: boolean
  // Total hops to walk upstream. Omitted = 2 (today's behavior). Hops beyond
  // the second follow the same rules as the second hop: helps-connections
  // only, the strength filter above, never through mods/titles, and never
  // through result or group cards (chains and digests own those).
  maxHops?: number
  // Participant private context accepts only explicitly modifies-connected
  // dials. The default stays compatible with legacy boards whose Mod
  // connections were stored with the feeds role.
  requireExplicitModifiesRoleForDials?: boolean
}

// The product's current meaning of "connected thought": everything wired into a
// card, plus a strong-helps-only second hop so a chain of thought still reaches it.
export const CONNECTED_THOUGHT_POLICY: ContextPolicy = {
  name: 'connected-thought',
  version: 1,
  secondHop: true,
  secondHopWeakToo: false,
}

export const PARTICIPANT_PRIVATE_CONTEXT_POLICY: ContextPolicy = {
  ...CONNECTED_THOUGHT_POLICY,
  name: 'participant-private-context',
  requireExplicitModifiesRoleForDials: true,
}

// A deeper look along the same lines of thought (#140): bounded depth, cycle
// safe, deterministic. Additive — the default policy above is untouched.
export function deepThoughtPolicy(maxHops: number, weakToo = false): ContextPolicy {
  const hops = Math.max(1, Math.floor(maxHops))
  return {
    name: `connected-thought-${hops}-hops${weakToo ? '-weak' : ''}`,
    version: 1,
    secondHop: hops >= 2,
    secondHopWeakToo: weakToo,
    maxHops: hops,
  }
}

// Why a card is in the selection. feeds-strong/feeds-weak mirror connection
// strength on helps-connections; constrains is any pushesAgainst connection;
// modifies covers mod cards and modifies-role connections.
export type ContextRelation = 'feeds-strong' | 'feeds-weak' | 'constrains' | 'modifies'

export type ContextSelectionEntry = {
  cardId: string
  connectionId: string
  relation: ContextRelation
  // 1 = wired straight into the root; higher = found by walking further along
  // helps-connections. Always 1 or 2 under the default policy.
  hop: number
  // Present when the source is a group card: how the group enters context.
  groupMode?: ConnectionGroupMode
}

export type ContextSelection = {
  rootCardId: string
  policy: { name: string; version: number }
  // Traversal order — first-hop sources in user-controlled context order, each
  // immediately followed by its second-hop sources.
  entries: ContextSelectionEntry[]
  // Insertion-ordered, deduplicated. Full-mode group members count as used.
  usedCardIds: string[]
  usedConnectionIds: string[]
}

// Connections into a card in the order the user arranged them: an explicit
// meta.contextOrder wins, connection array order breaks ties.
export function orderedIncomingConnections(board: SavedBoard, cardId: string): Connection[] {
  return incomingConnections(board, cardId)
    .map((conn, index) => ({ conn, index }))
    .sort((a, b) => contextOrder(a.conn, a.index) - contextOrder(b.conn, b.index))
    .map(({ conn }) => conn)
}

function contextOrder(conn: { meta?: Record<string, unknown> }, fallback: number): number {
  return typeof conn.meta?.contextOrder === 'number' ? conn.meta.contextOrder : fallback
}

export function gatherContext(
  board: SavedBoard,
  rootCardId: string,
  policy: ContextPolicy = CONNECTED_THOUGHT_POLICY,
): ContextSelection {
  const entries: ContextSelectionEntry[] = []
  const usedCardIds = new Set<string>()
  const usedConnectionIds = new Set<string>()
  // Guards hops beyond the first only: the same card may appear once per
  // first-hop connection (duplicate wires are the user saying it twice).
  // Also the cycle guard — a hand-wired loop terminates because every card
  // enters the walk at most once.
  const seen = new Set<string>([rootCardId])
  const maxHops = policy.maxHops ?? 2

  // Hops ≥ 2, depth-first so a deeper line of thought stays grouped behind
  // the first-hop source that led to it. Ordering comes only from
  // orderedIncomingConnections, so same graph + same policy = same selection.
  const walkUpstream = (fromCardId: string, hop: number) => {
    if (hop > maxHops) return
    for (const up of orderedIncomingConnections(board, fromCardId)) {
      if (up.polarity !== 'helps') continue
      if (!policy.secondHopWeakToo && up.strength !== 'strong') continue
      const upSource = cardById(board, up.from.cardId)
      if (!upSource || !contractFor(upSource.kind).traversal.upstream || seen.has(upSource.id)) continue
      seen.add(upSource.id)
      usedCardIds.add(upSource.id)
      usedConnectionIds.add(up.id)
      entries.push({ cardId: upSource.id, connectionId: up.id, relation: 'feeds-weak', hop })
      if (contractFor(upSource.kind).traversal.through) walkUpstream(upSource.id, hop + 1)
    }
  }

  for (const conn of orderedIncomingConnections(board, rootCardId)) {
    const source = cardById(board, conn.from.cardId)
    if (!source) continue
    const contract = contractFor(source.kind)
    if (contract.contributes === 'nothing') continue

    // Positive dials shape HOW the run thinks, never WHAT it reads. General
    // Ask context keeps legacy feeds-connected Mods working; participant
    // private context opts into explicit modifies-role scoping.
    const isDial = contract.contributes === 'dials'
    const isModifier =
      conn.polarity === 'helps' &&
      (conn.role === 'modifies' || (isDial && !policy.requireExplicitModifiesRoleForDials))
    if (isModifier) {
      usedCardIds.add(source.id)
      usedConnectionIds.add(conn.id)
      entries.push({ cardId: source.id, connectionId: conn.id, relation: 'modifies', hop: 1 })
      continue
    }
    // A Mod only speaks through a positive modifier connection. Avoiding a
    // Mod is silence, not anti-context, and participant policy may reject a
    // legacy feeds-role wire without turning the Mod into ordinary context.
    if (isDial) continue

    seen.add(source.id)
    usedCardIds.add(source.id)
    usedConnectionIds.add(conn.id)
    const groupMode = contract.contributes === 'groupContent' ? conn.meta?.groupMode ?? 'full' : undefined
    if (groupMode === 'full') {
      for (const member of membersOf(board, source.id)) usedCardIds.add(member.id)
    }

    const relation: ContextRelation =
      conn.polarity === 'pushesAgainst'
        ? 'constrains'
        : conn.strength === 'strong'
          ? 'feeds-strong'
          : 'feeds-weak'
    entries.push({ cardId: source.id, connectionId: conn.id, relation, hop: 1, groupMode })

    // Further hops: follow helps-connections into this source so a chain of
    // thought still reaches the root. Deeper material is always lighter.
    if (contract.traversal.through && policy.secondHop && conn.polarity === 'helps') {
      walkUpstream(source.id, 2)
    }
  }

  return {
    rootCardId,
    policy: { name: policy.name, version: policy.version },
    entries,
    usedCardIds: [...usedCardIds],
    usedConnectionIds: [...usedConnectionIds],
  }
}
