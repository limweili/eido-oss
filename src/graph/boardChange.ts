import type { Patch } from 'immer'
import type { BoardCommitState } from './commitFunnel'
import { samePosition, sameSize } from './history'
import type { Card } from './types'

export type BoardChangeCollection = {
  added?: string[]
  updated?: string[]
  removed?: string[]
}

export type BoardChangeCardAspect = 'position' | 'size' | 'content' | 'grouping' | 'layer' | 'order'

export type BoardChange = {
  cards?: BoardChangeCollection
  connections?: BoardChangeCollection
  outputs?: BoardChangeCollection
  runs?: BoardChangeCollection
  cardAspects?: BoardChangeCardAspect[]
}

export type BoardChangeSource = 'commit' | 'progress' | 'undo' | 'redo' | 'external-authority'

export type BoardChangeEmission = {
  seq: number
  source: BoardChangeSource
  change: BoardChange
  commitId?: string
  targetCommitId?: string
  label?: string
}

function unique(values: string[]): string[] | undefined {
  const result = [...new Set(values)]
  return result.length ? result : undefined
}

function collectionChange<T extends { id: string }>(
  before: T[],
  after: T[],
  touchedIds: Set<string>,
): BoardChangeCollection | undefined {
  const beforeById = new Map(before.map((item) => [item.id, item]))
  const afterById = new Map(after.map((item) => [item.id, item]))
  const added: string[] = []
  const removed: string[] = []
  const updated: string[] = []

  for (const id of afterById.keys()) {
    if (!beforeById.has(id)) added.push(id)
  }
  for (const id of beforeById.keys()) {
    if (!afterById.has(id)) removed.push(id)
  }
  for (const id of touchedIds) {
    if (beforeById.has(id) && afterById.has(id)) updated.push(id)
  }

  const change = {
    added: unique(added),
    updated: unique(updated),
    removed: unique(removed),
  }
  return change.added || change.updated || change.removed ? change : undefined
}

function cardAspectForPath(pathPart: unknown): BoardChangeCardAspect {
  if (pathPart === 'position') return 'position'
  if (pathPart === 'size') return 'size'
  if (pathPart === 'groupId') return 'grouping'
  if (pathPart === 'zIndex') return 'layer'
  return 'content'
}

function inferCardAspects(before: Card | undefined, after: Card | undefined): BoardChangeCardAspect[] {
  if (!before || !after) return []
  const aspects = new Set<BoardChangeCardAspect>()
  if (!samePosition(before.position, after.position)) aspects.add('position')
  if (!sameSize(before.size, after.size)) aspects.add('size')
  if (before.groupId !== after.groupId) aspects.add('grouping')
  if (before.zIndex !== after.zIndex) aspects.add('layer')
  if (before !== after && aspects.size === 0) aspects.add('content')
  return [...aspects]
}

function itemAt<T>(items: T[], index: unknown): T | undefined {
  return typeof index === 'number' ? items[index] : undefined
}

function addIdentityUpdates<T extends { id: string }>(before: T[], after: T[], ids: Set<string>) {
  const afterById = new Map(after.map((item) => [item.id, item]))
  for (const item of before) {
    const next = afterById.get(item.id)
    if (next && next !== item) ids.add(item.id)
  }
}

function addCardOrderUpdates(before: Card[], after: Card[], ids: Set<string>): boolean {
  if (before.length !== after.length) return false
  const beforeIndexById = new Map(before.map((card, index) => [card.id, index]))
  if (after.some((card) => !beforeIndexById.has(card.id))) return false
  let reordered = false
  after.forEach((card, index) => {
    if (beforeIndexById.get(card.id) === index) return
    reordered = true
    ids.add(card.id)
  })
  return reordered
}

export function deriveBoardChange(
  before: BoardCommitState,
  after: BoardCommitState,
  patches: Patch[],
): BoardChange | null {
  const touched = {
    cards: new Set<string>(),
    connections: new Set<string>(),
    outputs: new Set<string>(),
    runs: new Set<string>(),
  }
  const cardAspects = new Set<BoardChangeCardAspect>()

  for (const patch of patches) {
    const [collection, index, field] = patch.path
    if (collection === 'cards') {
      const beforeCard = itemAt(before.cards, index)
      const afterCard = itemAt(after.cards, index)
      const id = afterCard?.id ?? beforeCard?.id
      if (id) touched.cards.add(id)
      if (field !== undefined) cardAspects.add(cardAspectForPath(field))
    } else if (collection === 'connections') {
      const id = itemAt(after.connections, index)?.id ?? itemAt(before.connections, index)?.id
      if (id) touched.connections.add(id)
    } else if (collection === 'outputs') {
      const id = itemAt(after.outputs, index)?.id ?? itemAt(before.outputs, index)?.id
      if (id) touched.outputs.add(id)
    } else if (collection === 'runs') {
      const id = itemAt(after.runs, index)?.id ?? itemAt(before.runs, index)?.id
      if (id) touched.runs.add(id)
    }
  }

  addIdentityUpdates(before.cards, after.cards, touched.cards)
  addIdentityUpdates(before.connections, after.connections, touched.connections)
  addIdentityUpdates(before.outputs, after.outputs, touched.outputs)
  addIdentityUpdates(before.runs, after.runs, touched.runs)
  if (addCardOrderUpdates(before.cards, after.cards, touched.cards)) {
    cardAspects.add('layer')
    // Saved Card order is both canvas stacking and Group member order. Keep a
    // distinct semantic signal so projections that ignore z-index-only layer
    // changes can still invalidate when a Group's authored order changes.
    cardAspects.add('order')
  }

  const beforeCardsById = new Map(before.cards.map((card) => [card.id, card]))
  const afterCardsById = new Map(after.cards.map((card) => [card.id, card]))
  for (const id of touched.cards) {
    for (const aspect of inferCardAspects(beforeCardsById.get(id), afterCardsById.get(id))) {
      cardAspects.add(aspect)
    }
  }

  const change: BoardChange = {
    cards: collectionChange(before.cards, after.cards, touched.cards),
    connections: collectionChange(before.connections, after.connections, touched.connections),
    outputs: collectionChange(before.outputs, after.outputs, touched.outputs),
    runs: collectionChange(before.runs, after.runs, touched.runs),
  }
  if (cardAspects.size) change.cardAspects = [...cardAspects]

  return change.cards || change.connections || change.outputs || change.runs ? change : null
}
