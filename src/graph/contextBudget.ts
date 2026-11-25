// Context budget planning (ADR 0015): when an Ask's gathered context exceeds
// its budget, decide — deterministically, as pure data — what gets compacted
// (replaced by a cached summary) and, only as a last resort, what gets
// dropped. Priority: connection strength first (weak trims before strong),
// then the user's explicit input order (bottom first). The Ask's own task
// text and Mods are never touched: they arrive in the fixed token count.

import type { CompactionMode } from './types'

// Target size for a compaction summary, used to estimate the gain from
// compacting a card before its summary exists. Documented tunable (ADR 0015).
export const COMPACTION_TARGET_CHARS = 600

export type BudgetEntryInput = {
  cardId: string
  strength: 'strong' | 'weak'
  // Position in the user's arranged context order; higher = closer to the
  // bottom, which trims first within the same strength.
  orderIndex: number
  // QuadChars estimates for this entry rendered in full and compacted form.
  fullTokens: number
  compactTokens: number
}

export type ContextBudgetPlan = {
  budgetTokens: number
  // Estimated size before any trimming (fixed + all entries in full).
  estimatedTokens: number
  // Estimated size after the planned compactions and drops.
  finalTokens: number
  compact: string[]
  drop: string[]
}

// Weak before strong; within a strength band, bottom of the user's order
// first. Sort is total (cardId last) so the plan is deterministic even for
// synthetic equal inputs.
function trimOrder(entries: BudgetEntryInput[]): BudgetEntryInput[] {
  return [...entries].sort((a, b) => {
    if (a.strength !== b.strength) return a.strength === 'weak' ? -1 : 1
    if (a.orderIndex !== b.orderIndex) return b.orderIndex - a.orderIndex
    return a.cardId < b.cardId ? -1 : 1
  })
}

export function planContextBudget(
  entries: BudgetEntryInput[],
  fixedTokens: number,
  budgetTokens: number,
  mode: CompactionMode,
): ContextBudgetPlan {
  const compact: string[] = []
  const drop: string[] = []
  let total = fixedTokens + entries.reduce((sum, entry) => sum + entry.fullTokens, 0)
  const estimatedTokens = total
  const order = trimOrder(entries)

  // Eager: weak links always arrive compacted, budget pressure or not.
  if (mode === 'eager') {
    for (const entry of order) {
      if (entry.strength !== 'weak') continue
      compact.push(entry.cardId)
      total -= entry.fullTokens - entry.compactTokens
    }
  }

  // When needed: compact in priority order until the budget fits.
  if (mode !== 'never') {
    for (const entry of order) {
      if (total <= budgetTokens) break
      if (compact.includes(entry.cardId)) continue
      compact.push(entry.cardId)
      total -= entry.fullTokens - entry.compactTokens
    }
  }

  // Last resort (and the whole strategy under 'never'): drop, same order.
  for (const entry of order) {
    if (total <= budgetTokens) break
    drop.push(entry.cardId)
    total -= compact.includes(entry.cardId) ? entry.compactTokens : entry.fullTokens
  }

  // A dropped entry is gone — it is not also "compacted".
  const compactKept = compact.filter((cardId) => !drop.includes(cardId))

  return {
    budgetTokens,
    estimatedTokens,
    finalTokens: total,
    compact: compactKept,
    drop,
  }
}
