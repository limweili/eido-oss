import { describe, expect, it } from 'vitest'
import {
  GRAPH_ACTION_SURFACE,
  graphActionContracts,
  type GraphActionName,
} from './actionContracts'
import { useGraph } from './store'

function sorted(values: readonly string[]) {
  return [...values].sort()
}

describe('graph action contracts (#154)', () => {
  it('are plain serializable contract data', () => {
    const contracts = graphActionContracts()
    expect(JSON.parse(JSON.stringify(contracts))).toEqual(contracts)
    expect(contracts.every((contract) => contract.version === 1)).toBe(true)
  })

  it('cover the declared board mutation surface exactly once', () => {
    const covered = graphActionContracts().flatMap((contract) => contract.storeActions)
    expect(sorted(covered)).toEqual(sorted(GRAPH_ACTION_SURFACE))
    expect(new Set(covered).size).toBe(covered.length)
  })

  it('does not describe speculative store actions', () => {
    const state = useGraph.getState() as Record<GraphActionName, unknown>
    for (const actionName of GRAPH_ACTION_SURFACE) {
      expect(typeof state[actionName], actionName).toBe('function')
    }
  })

  it('uses stable unique contract ids', () => {
    const ids = graphActionContracts().map((contract) => contract.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
