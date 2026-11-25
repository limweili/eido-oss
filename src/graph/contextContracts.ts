// Context contracts (ADR 0017): every card kind declares, in one place, how it
// plugs into connections — whether it consumes context, what it contributes to
// a consumer, whether upstream walks pass through it, how it connects when it
// is the source, and what its connections look like. The context query, the
// store's connect path, the compiler, and connection rendering all read this
// registry; none of them may branch on card kind directly for connection
// behavior. A future card kind plugs in here, not in traversal internals.

import type { CardKind, ConnectionRole } from './types'

// What a card places into a consumer's context.
//   'body'         — its own text blocks
//   'chosenOutput' — the chosen version of its Output stack (results)
//   'groupContent' — members or digest, per the connection's group mode (groups)
//   'dials'        — control values that shape HOW the run thinks, not WHAT it
//                    reads (mods); selected with the 'modifies' relation
//   'nothing'      — never enters context (titles are labels, not thought)
export type ContextContribution = 'body' | 'chosenOutput' | 'groupContent' | 'dials' | 'nothing'

// How a card wired into a Conversation enters the exchange.
//   'participant' — it speaks: scheduled turns with its own private context
//   'shared'      — every participant reads it as Shared Conversation Context
//   'guidance'    — when wired here, it shapes the whole exchange (a Mod's
//                   dials); wired to a participant source, the same Mod
//                   contribution stays in that participant's private compile
//   'none'        — it never enters the conversation (titles)
export type ConversationInput = 'participant' | 'shared' | 'guidance' | 'none'

export type ContextContract = {
  // Can this kind be the target of a feeds connection — a card that runs on
  // gathered context? Connect gestures auto-orient toward the one consumer.
  canConsume: boolean
  contributes: ContextContribution
  // What this kind becomes when wired into a Conversation's inputs.
  conversationInput: ConversationInput
  traversal: {
    // May hops beyond the first pick this card up as a source?
    upstream: boolean
    // Does the walk continue past this card into its own sources? Results and
    // groups are barriers: chains own results, digests own groups.
    through: boolean
  }
  connectionDefaults: {
    // Can this kind be an endpoint of a connection at all?
    connectable: boolean
    // The role a new connection gets when this kind is the source.
    sourceRole: ConnectionRole
    // 'throughResult': when both endpoints are this kind, the wire routes
    // through the source's visible Result card so the chain shape stays legible.
    routing: 'direct' | 'throughResult'
  }
  presentation: {
    // Connection editing offers the Everything/Compress choice for this source.
    groupModeToggle: boolean
  }
}

const STANDARD_DEFAULTS: ContextContract['connectionDefaults'] = {
  connectable: true,
  sourceRole: 'feeds',
  routing: 'direct',
}

const NO_TOGGLES: ContextContract['presentation'] = { groupModeToggle: false }

export const CONTEXT_CONTRACTS: Record<CardKind, ContextContract> = {
  note: {
    canConsume: false,
    contributes: 'body',
    conversationInput: 'shared',
    traversal: { upstream: true, through: true },
    connectionDefaults: STANDARD_DEFAULTS,
    presentation: NO_TOGGLES,
  },
  askAi: {
    canConsume: true,
    contributes: 'body',
    conversationInput: 'participant',
    traversal: { upstream: true, through: true },
    connectionDefaults: { connectable: true, sourceRole: 'feeds', routing: 'throughResult' },
    presentation: NO_TOGGLES,
  },
  result: {
    canConsume: false,
    contributes: 'chosenOutput',
    conversationInput: 'shared',
    traversal: { upstream: true, through: false },
    connectionDefaults: STANDARD_DEFAULTS,
    presentation: NO_TOGGLES,
  },
  mod: {
    canConsume: false,
    contributes: 'dials',
    conversationInput: 'guidance',
    traversal: { upstream: false, through: false },
    connectionDefaults: { connectable: true, sourceRole: 'modifies', routing: 'direct' },
    presentation: NO_TOGGLES,
  },
  group: {
    canConsume: false,
    contributes: 'groupContent',
    conversationInput: 'shared',
    traversal: { upstream: true, through: false },
    connectionDefaults: STANDARD_DEFAULTS,
    presentation: { groupModeToggle: true },
  },
  conversation: {
    canConsume: true,
    contributes: 'body',
    conversationInput: 'shared',
    traversal: { upstream: true, through: true },
    connectionDefaults: STANDARD_DEFAULTS,
    presentation: NO_TOGGLES,
  },
  title: {
    canConsume: false,
    contributes: 'nothing',
    conversationInput: 'none',
    traversal: { upstream: false, through: false },
    connectionDefaults: { connectable: false, sourceRole: 'feeds', routing: 'direct' },
    presentation: NO_TOGGLES,
  },
}

export function contractFor(kind: CardKind): ContextContract {
  return CONTEXT_CONTRACTS[kind]
}

// True when a wire between two cards of this kind must route through the
// source's visible Result card instead of connecting directly.
export function routesThroughResult(kind: CardKind): boolean {
  return CONTEXT_CONTRACTS[kind].connectionDefaults.routing === 'throughResult'
}
