import type { GraphState } from '../graph/store'
import type { Mod } from './model'
import { normalizeMod } from './normalizer'
import { cloneDetached } from './snapshot'

export type V2ModCommitStore = Pick<GraphState, 'graph' | 'commit'>

/** Commits one completed Mod interaction through the graph's semantic funnel. */
export function commitV2Mod(
  store: V2ModCommitStore,
  cardId: string,
  nextMod: Mod,
  label: string,
): boolean {
  const graph = store.graph()
  const order = graph.cardOrder(cardId)
  const card = graph.cardById(cardId)
  if (
    order === undefined
    || card?.kind !== 'mod'
    || !card.modV2
    || card.modV2.kind !== nextMod.kind
    || normalizeMod(nextMod) !== nextMod
  ) return false

  const detached = cloneDetached(nextMod)
  if (JSON.stringify(card.modV2) === JSON.stringify(detached)) return false

  return store.commit(
    label.trim() || 'Edit Mod',
    (draft) => {
      const current = draft.cards[order]
      if (
        current?.id === cardId
        && current.kind === 'mod'
        && current.modV2?.kind === detached.kind
      ) current.modV2 = detached
    },
    [],
  ).changed
}
