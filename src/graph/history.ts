import type { Card, Connection, ConnectionGroupMode, IntentLogEventDraft, Output } from './types'

// Reversible history is the first substrate for a future thoughts-timeline
// playback feature. Undo/redo keeps these entries in bounded transient stacks
// for now (the ring cap lives in commitFunnel.ts as UNDO_RING_LIMIT); a future
// timeline can persist/replay the same action payloads from board snapshots
// without coupling playback to React Flow.

export type Indexed<T> = {
  item: T
  index: number
}

export type CardStructuralState = {
  position: Card['position']
  size?: Card['size']
  groupId?: string
}

export type CardStructuralPatch = {
  id: string
  before: CardStructuralState
  after: CardStructuralState
}

export type CardHistoryKind =
  | 'moveCard'
  | 'resizeCard'
  | 'createGroup'
  | 'deleteGroup'
  | 'groupMembership'

export type ConnectionMeaning = {
  strength: Connection['strength']
  polarity: Connection['polarity']
  groupMode?: ConnectionGroupMode
}

export type HistoryAction =
  | {
      type: 'cardsAdded'
      label: string
      cards: Indexed<Card>[]
      connections?: Indexed<Connection>[]
      outputs?: Indexed<Output>[]
      cardPatches?: CardStructuralPatch[]
    }
  | {
      type: 'cardsRemoved'
      label: string
      cards: Indexed<Card>[]
      connections?: Indexed<Connection>[]
      outputs?: Indexed<Output>[]
      cardPatches?: CardStructuralPatch[]
    }
  | {
      type: 'cardsUpdated'
      label: CardHistoryKind
      patches: CardStructuralPatch[]
    }
  | {
      type: 'connectionsAdded'
      connections: Indexed<Connection>[]
    }
  | {
      type: 'connectionsRemoved'
      connections: Indexed<Connection>[]
    }
  | {
      type: 'connectionMeaningChanged'
      id: string
      before: ConnectionMeaning
      after: ConnectionMeaning
    }
  | {
      type: 'groupMembersReordered'
      groupId: string
      beforeOrder: string[]
      afterOrder: string[]
    }

export type HistoryEntry = {
  id: string
  commitId?: string
  createdAt: string
  scope: 'structural'
  action: HistoryAction
}

export type HistoryBoardState = {
  cards: Card[]
  connections: Connection[]
  outputs: Output[]
}

export type HistoryDirection = 'backward' | 'forward'

function clone<T>(value: T): T {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value)) as T
}

function indexed<T extends { id: string }>(items: T[], ids: Set<string>): Indexed<T>[] {
  return items
    .map((item, index) => ({ item, index }))
    .filter((entry) => ids.has(entry.item.id))
    .map((entry) => ({ item: clone(entry.item), index: entry.index }))
}

function insertIndexed<T extends { id: string }>(items: T[], entries: Indexed<T>[] = []): T[] {
  if (!entries.length) return items
  const addIds = new Set(entries.map((entry) => entry.item.id))
  const next = items.filter((item) => !addIds.has(item.id)).map((item) => clone(item))
  for (const entry of [...entries].sort((a, b) => a.index - b.index)) {
    next.splice(Math.min(entry.index, next.length), 0, clone(entry.item))
  }
  return next
}

function removeById<T extends { id: string }>(items: T[], ids: Set<string>): T[] {
  return items.filter((item) => !ids.has(item.id))
}

export function samePosition(a: Card['position'], b: Card['position']) {
  return a.x === b.x && a.y === b.y
}

export function sameSize(a: Card['size'], b: Card['size']) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.width === b.width && a.height === b.height
}

function structural(card: Card): CardStructuralState {
  return {
    position: { ...card.position },
    size: card.size ? { ...card.size } : undefined,
    groupId: card.groupId,
  }
}

function sameStructural(a: CardStructuralState, b: CardStructuralState) {
  return samePosition(a.position, b.position) && sameSize(a.size, b.size) && a.groupId === b.groupId
}

// The Intent Log derives its structural-change events from these patches, so
// undo history and the log share one diff rule (issue #184). These classifiers
// are the only way consumers should ask what a patch changed.
export function cardPatchMoved(patch: CardStructuralPatch): boolean {
  return !samePosition(patch.before.position, patch.after.position) || patch.before.groupId !== patch.after.groupId
}

export function cardPatchResized(patch: CardStructuralPatch): boolean {
  return !sameSize(patch.before.size, patch.after.size)
}

// One builder for the change-describing structural events, shared by the
// recordCardStructuralChange and funnel call sites (ADR 0016:
// event payloads come from this shared diff, never from the funnel's
// mechanical Immer patches). Order is pinned by test: card.moved first,
// then card.resized per patch.
export function structuralEventDrafts(patches: CardStructuralPatch[]): IntentLogEventDraft[] {
  const drafts: IntentLogEventDraft[] = []
  const moves = patches.filter(cardPatchMoved).map((patch) => ({
    cardId: patch.id,
    from: patch.before.position,
    to: patch.after.position,
    ...(patch.before.groupId === undefined ? {} : { previousGroupId: patch.before.groupId }),
    ...(patch.after.groupId === undefined ? {} : { nextGroupId: patch.after.groupId }),
  }))
  if (moves.length) {
    drafts.push({
      type: 'card.moved',
      cardId: moves[0].cardId,
      data: { moves },
    })
  }
  for (const patch of patches.filter(cardPatchResized)) {
    drafts.push({
      type: 'card.resized',
      cardId: patch.id,
      data: {
        ...(patch.before.size === undefined ? {} : { from: patch.before.size }),
        ...(patch.after.size === undefined ? {} : { to: patch.after.size }),
      },
    })
  }
  return drafts
}

function applyCardStructural(cards: Card[], patches: CardStructuralPatch[] = [], direction: HistoryDirection): Card[] {
  if (!patches.length) return cards
  const states = new Map(
    patches.map((patch) => [patch.id, direction === 'backward' ? patch.before : patch.after]),
  )
  return cards.map((card) => {
    const next = states.get(card.id)
    if (!next) return card
    const updated: Card = {
      ...card,
      position: { ...next.position },
      ...(next.size ? { size: { ...next.size } } : {}),
      ...(next.groupId === undefined ? {} : { groupId: next.groupId }),
    }
    if (!next.size) delete updated.size
    if (next.groupId === undefined) delete updated.groupId
    return updated
  })
}

function reorderMembers(cards: Card[], groupId: string, memberIds: string[]): Card[] {
  const requestedOrder = new Map(memberIds.map((memberId, index) => [memberId, index]))
  const currentMembers = cards.filter((card) => card.groupId === groupId && card.kind !== 'group')
  const orderedMembers = [
    ...currentMembers
      .filter((member) => requestedOrder.has(member.id))
      .sort((a, b) => requestedOrder.get(a.id)! - requestedOrder.get(b.id)!),
    ...currentMembers.filter((member) => !requestedOrder.has(member.id)),
  ]
  let memberIndex = 0
  return cards.map((card) => {
    if (card.groupId !== groupId || card.kind === 'group') return card
    return orderedMembers[memberIndex++] ?? card
  })
}

function meaning(connection: Connection): ConnectionMeaning {
  return {
    strength: connection.strength,
    polarity: connection.polarity,
    groupMode: connection.meta?.groupMode,
  }
}

function sameMeaning(a: ConnectionMeaning, b: ConnectionMeaning) {
  return a.strength === b.strength && a.polarity === b.polarity && a.groupMode === b.groupMode
}

function applyConnectionMeaning(
  connections: Connection[],
  id: string,
  next: ConnectionMeaning,
): Connection[] {
  return connections.map((connection) => {
    if (connection.id !== id) return connection
    const meta =
      next.groupMode === undefined
        ? connection.meta
          ? Object.fromEntries(Object.entries(connection.meta).filter(([key]) => key !== 'groupMode'))
          : undefined
        : { ...connection.meta, groupMode: next.groupMode }
    const updated: Connection = {
      ...connection,
      strength: next.strength,
      polarity: next.polarity,
      ...(meta === undefined ? {} : { meta }),
    }
    if (meta === undefined) delete updated.meta
    return updated
  })
}

function cardIdsFrom(entries: Indexed<Card>[]) {
  return new Set(entries.map((entry) => entry.item.id))
}

function connectedToAnyCard(connection: Connection, cardIds: Set<string>) {
  return cardIds.has(connection.from.cardId) || cardIds.has(connection.to.cardId)
}

function refreshCardRemovalAction(state: HistoryBoardState, action: HistoryAction): HistoryAction {
  if (action.type !== 'cardsAdded' && action.type !== 'cardsRemoved') return action
  const ids = cardIdsFrom(action.cards)
  return {
    ...action,
    cards: indexed(state.cards, ids),
    connections: state.connections
      .map((connection, index) => ({ item: connection, index }))
      .filter((entry) => connectedToAnyCard(entry.item, ids))
      .map((entry) => ({ item: clone(entry.item), index: entry.index })),
    outputs: state.outputs
      .map((output, index) => ({ item: output, index }))
      .filter((entry) => ids.has(entry.item.resultCardId))
      .map((entry) => ({ item: clone(entry.item), index: entry.index })),
  }
}

export function cardUpdateAction(
  label: CardHistoryKind,
  beforeCards: Card[],
  afterCards: Card[],
): HistoryAction | undefined {
  const afterById = new Map(afterCards.map((card) => [card.id, card]))
  const patches: CardStructuralPatch[] = []
  for (const beforeCard of beforeCards) {
    const afterCard = afterById.get(beforeCard.id)
    if (!afterCard) continue
    const before = structural(beforeCard)
    const after = structural(afterCard)
    if (!sameStructural(before, after)) patches.push({ id: beforeCard.id, before, after })
  }
  return patches.length ? { type: 'cardsUpdated', label, patches } : undefined
}

export function cardsAddedAction(
  label: string,
  afterState: HistoryBoardState,
  cardIds: string[],
  options: {
    connectionIds?: string[]
    outputIds?: string[]
    cardPatches?: CardStructuralPatch[]
  } = {},
): HistoryAction | undefined {
  const cardIdSet = new Set(cardIds)
  const cards = indexed(afterState.cards, cardIdSet)
  if (!cards.length && !options.cardPatches?.length) return undefined
  return {
    type: 'cardsAdded',
    label,
    cards,
    connections: indexed(afterState.connections, new Set(options.connectionIds ?? [])),
    outputs: indexed(afterState.outputs, new Set(options.outputIds ?? [])),
    cardPatches: options.cardPatches,
  }
}

export function cardsRemovedAction(
  label: string,
  beforeState: HistoryBoardState,
  cardIds: string[],
  cardPatches?: CardStructuralPatch[],
): HistoryAction | undefined {
  const ids = new Set(cardIds)
  const cards = indexed(beforeState.cards, ids)
  if (!cards.length) return undefined
  return {
    type: 'cardsRemoved',
    label,
    cards,
    connections: beforeState.connections
      .map((connection, index) => ({ item: connection, index }))
      .filter((entry) => connectedToAnyCard(entry.item, ids))
      .map((entry) => ({ item: clone(entry.item), index: entry.index })),
    outputs: beforeState.outputs
      .map((output, index) => ({ item: output, index }))
      .filter((entry) => ids.has(entry.item.resultCardId))
      .map((entry) => ({ item: clone(entry.item), index: entry.index })),
    cardPatches,
  }
}

export function connectionsAddedAction(afterConnections: Connection[], connectionIds: string[]): HistoryAction | undefined {
  const connections = indexed(afterConnections, new Set(connectionIds))
  return connections.length ? { type: 'connectionsAdded', connections } : undefined
}

export function connectionsRemovedAction(beforeConnections: Connection[], connectionIds: string[]): HistoryAction | undefined {
  const connections = indexed(beforeConnections, new Set(connectionIds))
  return connections.length ? { type: 'connectionsRemoved', connections } : undefined
}

export function connectionMeaningAction(before: Connection, after: Connection): HistoryAction | undefined {
  const beforeMeaning = meaning(before)
  const afterMeaning = meaning(after)
  if (sameMeaning(beforeMeaning, afterMeaning)) return undefined
  return {
    type: 'connectionMeaningChanged',
    id: before.id,
    before: beforeMeaning,
    after: afterMeaning,
  }
}

export function groupMembersReorderedAction(
  groupId: string,
  beforeOrder: string[],
  afterOrder: string[],
): HistoryAction | undefined {
  if (beforeOrder.length === afterOrder.length && beforeOrder.every((id, index) => id === afterOrder[index])) {
    return undefined
  }
  return { type: 'groupMembersReordered', groupId, beforeOrder, afterOrder }
}

export function prepareActionForApply(
  state: HistoryBoardState,
  action: HistoryAction,
  direction: HistoryDirection,
): HistoryAction {
  if (
    (action.type === 'cardsAdded' && direction === 'backward') ||
    (action.type === 'cardsRemoved' && direction === 'forward')
  ) {
    return refreshCardRemovalAction(state, action)
  }
  return action
}

export function applyHistoryAction(
  state: HistoryBoardState,
  action: HistoryAction,
  direction: HistoryDirection,
): HistoryBoardState {
  if (action.type === 'cardsAdded') {
    if (direction === 'forward') {
      return {
        cards: applyCardStructural(insertIndexed(state.cards, action.cards), action.cardPatches, direction),
        connections: insertIndexed(state.connections, action.connections),
        outputs: insertIndexed(state.outputs, action.outputs),
      }
    }
    const ids = cardIdsFrom(action.cards)
    return {
      cards: removeById(applyCardStructural(state.cards, action.cardPatches, direction), ids),
      connections: state.connections.filter((connection) => !connectedToAnyCard(connection, ids)),
      outputs: state.outputs.filter((output) => !ids.has(output.resultCardId)),
    }
  }

  if (action.type === 'cardsRemoved') {
    if (direction === 'backward') {
      return {
        cards: applyCardStructural(insertIndexed(state.cards, action.cards), action.cardPatches, direction),
        connections: insertIndexed(state.connections, action.connections),
        outputs: insertIndexed(state.outputs, action.outputs),
      }
    }
    const ids = cardIdsFrom(action.cards)
    return {
      cards: removeById(applyCardStructural(state.cards, action.cardPatches, direction), ids),
      connections: state.connections.filter((connection) => !connectedToAnyCard(connection, ids)),
      outputs: state.outputs.filter((output) => !ids.has(output.resultCardId)),
    }
  }

  if (action.type === 'cardsUpdated') {
    return {
      ...state,
      cards: applyCardStructural(state.cards, action.patches, direction),
    }
  }

  if (action.type === 'connectionsAdded') {
    return direction === 'forward'
      ? { ...state, connections: insertIndexed(state.connections, action.connections) }
      : {
          ...state,
          connections: removeById(state.connections, new Set(action.connections.map((entry) => entry.item.id))),
        }
  }

  if (action.type === 'connectionsRemoved') {
    return direction === 'backward'
      ? { ...state, connections: insertIndexed(state.connections, action.connections) }
      : {
          ...state,
          connections: removeById(state.connections, new Set(action.connections.map((entry) => entry.item.id))),
        }
  }

  if (action.type === 'connectionMeaningChanged') {
    return {
      ...state,
      connections: applyConnectionMeaning(
        state.connections,
        action.id,
        direction === 'backward' ? action.before : action.after,
      ),
    }
  }

  return {
    ...state,
    cards: reorderMembers(
      state.cards,
      action.groupId,
      direction === 'backward' ? action.beforeOrder : action.afterOrder,
    ),
  }
}
