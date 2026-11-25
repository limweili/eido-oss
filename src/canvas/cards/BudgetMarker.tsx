import { dragBlockingClass } from '../cardInteraction'
import type { RunContextBudget } from '../../graph/types'
import { words } from '../../shared/words'

// The context budget is never silent (ADR 0015): when a run shortened or left
// out connected cards to fit the model window, say so — expandably, with the
// exact cards named. Shared by the Ask result and the Conversation result so
// both surfaces speak with one voice. `label` turns a card id into its
// human-facing name (callers pass a frozen-provenance lookup).
export function BudgetMarker({
  budget,
  label,
  selected,
}: {
  budget: RunContextBudget | undefined
  label: (cardId: string) => string
  selected: boolean
}) {
  const touched = Boolean(
    budget && (budget.compactedCardIds.length > 0 || budget.droppedCardIds.length > 0),
  )
  if (!touched || !budget) return null

  return (
    <details className={`budget-marker ${dragBlockingClass(selected)}`}>
      <summary>
        {budget.compactedCardIds.length && budget.droppedCardIds.length
          ? words.compactionMarkerBoth
          : budget.droppedCardIds.length
            ? words.compactionDroppedMarker
            : words.compactionCompactedMarker}
      </summary>
      <ul>
        {budget.compactedCardIds.map((cardId) => (
          <li key={`c-${cardId}`}>
            {label(cardId)} — {words.compactionCompactedTag}
          </li>
        ))}
        {budget.droppedCardIds.map((cardId) => (
          <li key={`d-${cardId}`}>
            {label(cardId)} — {words.compactionDroppedTag}
          </li>
        ))}
      </ul>
    </details>
  )
}
