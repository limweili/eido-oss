// One pure admission/orientation plan for both canvas preview and store mutation.

import { contractFor, routesThroughResult } from './contextContracts'
import type { BoardGraphIndex } from './graphIndex'
import type { ConnectionRole } from './types'

export type ConnectionAdditionGraph = Pick<
  BoardGraphIndex,
  'cardById' | 'outgoingConnections' | 'resultCardFor'
>

export type ConnectionAdditionPlan =
  | { kind: 'direct'; sourceCardId: string; targetCardId: string; role: ConnectionRole }
  | { kind: 'throughResult'; sourceCardId: string; targetCardId: string; resultCardId: string | null }

export function planConnectionAddition(
  graph: ConnectionAdditionGraph,
  fromCardId: string,
  toCardId: string,
): ConnectionAdditionPlan | null {
  if (fromCardId === toCardId) return null
  const from = graph.cardById(fromCardId)
  const to = graph.cardById(toCardId)
  if (!from || !to) return null

  const fromContract = contractFor(from.kind)
  const toContract = contractFor(to.kind)
  if (!fromContract.connectionDefaults.connectable || !toContract.connectionDefaults.connectable)
    return null

  // ADR 0017: orient toward the sole consumer; otherwise preserve drag direction.
  const flip = fromContract.canConsume && !toContract.canConsume
  const source = flip ? to : from
  const target = flip ? from : to
  const sourceContract = flip ? toContract : fromContract

  if (routesThroughResult(source.kind) && routesThroughResult(target.kind)) {
    const resultCard = graph.resultCardFor(source.id)
    if (
      resultCard &&
      graph
        .outgoingConnections(resultCard.id)
        .some((connection) => connection.to.cardId === target.id && connection.role === 'feeds')
    )
      return null
    return {
      kind: 'throughResult',
      sourceCardId: source.id, targetCardId: target.id,
      resultCardId: resultCard?.id ?? null,
    }
  }

  if (graph.outgoingConnections(source.id).some((connection) => connection.to.cardId === target.id))
    return null
  return {
    kind: 'direct',
    sourceCardId: source.id, targetCardId: target.id,
    role: sourceContract.connectionDefaults.sourceRole,
  }
}
