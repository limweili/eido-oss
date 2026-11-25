import { describe, expect, it } from 'vitest'
import { planContextBudget, type BudgetEntryInput } from './contextBudget'

function entry(
  cardId: string,
  strength: 'strong' | 'weak',
  orderIndex: number,
  fullTokens: number,
  compactTokens = 100,
): BudgetEntryInput {
  return { cardId, strength, orderIndex, fullTokens, compactTokens }
}

describe('planContextBudget', () => {
  it('plans nothing when the selection fits', () => {
    const plan = planContextBudget([entry('a', 'strong', 0, 500)], 100, 1000, 'when-needed')
    expect(plan.compact).toEqual([])
    expect(plan.drop).toEqual([])
    expect(plan.estimatedTokens).toBe(600)
    expect(plan.finalTokens).toBe(600)
  })

  it('compacts weak before strong, bottom of the user order first', () => {
    const entries = [
      entry('strong-top', 'strong', 0, 400),
      entry('weak-top', 'weak', 1, 400),
      entry('weak-bottom', 'weak', 2, 400),
    ]
    // fixed 100 + 1200 = 1300; budget 1000 → shave 300 → one compaction
    // (400 → 100 saves 300). The weak entry nearest the bottom goes first.
    const plan = planContextBudget(entries, 100, 1000, 'when-needed')
    expect(plan.compact).toEqual(['weak-bottom'])
    expect(plan.drop).toEqual([])
    expect(plan.finalTokens).toBe(1000)
  })

  it('compacts strong entries only after every weak entry', () => {
    const entries = [
      entry('strong-a', 'strong', 0, 400),
      entry('weak-a', 'weak', 1, 400),
    ]
    // Need to shave 600: weak first, then the strong one.
    const plan = planContextBudget(entries, 100, 300, 'when-needed')
    expect(plan.compact).toEqual(['weak-a', 'strong-a'])
    expect(plan.finalTokens).toBe(300)
  })

  it('drops only after everything is compacted, in the same order', () => {
    const entries = [
      entry('strong-a', 'strong', 0, 400, 200),
      entry('weak-a', 'weak', 1, 400, 200),
    ]
    // Fully compacted: 100 + 200 + 200 = 500. Budget 250 → drop weak-a (−200
    // → 300), still over → drop strong-a (−200 → 100).
    const plan = planContextBudget(entries, 100, 250, 'when-needed')
    expect(plan.drop).toEqual(['weak-a', 'strong-a'])
    // Dropped entries are not also reported as compacted.
    expect(plan.compact).toEqual([])
    expect(plan.finalTokens).toBe(100)
  })

  it('never mode goes straight to dropping', () => {
    const entries = [entry('weak-a', 'weak', 0, 400), entry('strong-a', 'strong', 1, 400)]
    const plan = planContextBudget(entries, 100, 600, 'never')
    expect(plan.compact).toEqual([])
    expect(plan.drop).toEqual(['weak-a'])
    expect(plan.finalTokens).toBe(500)
  })

  it('eager mode compacts every weak entry even under budget', () => {
    const entries = [entry('weak-a', 'weak', 0, 400), entry('strong-a', 'strong', 1, 400)]
    const plan = planContextBudget(entries, 100, 10_000, 'eager')
    expect(plan.compact).toEqual(['weak-a'])
    expect(plan.drop).toEqual([])
    expect(plan.finalTokens).toBe(600)
  })

  it('is deterministic: same inputs, same plan', () => {
    const entries = [
      entry('a', 'weak', 0, 300),
      entry('b', 'weak', 1, 300),
      entry('c', 'strong', 2, 300),
    ]
    const first = planContextBudget(entries, 50, 400, 'when-needed')
    const second = planContextBudget(entries, 50, 400, 'when-needed')
    expect(first).toEqual(second)
  })
})
