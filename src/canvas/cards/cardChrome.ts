import { contextLabel } from '../../brain/compiler'
import { words } from '../../shared/words'
import { boardSnapshotNow } from '../graphSelectors'

// Shared chrome helpers consumed by ResultCard, ConversationResultCard, and
// GroupCard. All three previously had local copies; extraction ensures that
// identical inputs always produce identical output across cards.

export function provisionalReasonLabel(reason?: 'canceled' | 'failed'): string {
  return reason === 'failed' ? words.provisionalFailed : words.provisionalCanceled
}

// Returns a lazy label callback for BudgetMarker — the board snapshot is
// deferred to call time (frozen provenance; no subscription needed).
// Named make* (not use*) because it does not call any React hooks.
export function makeBudgetLabel(): (cardId: string) => string {
  return (cardId: string) => {
    const board = boardSnapshotNow()
    const source = board.cards.find((c) => c.id === cardId)
    return source ? contextLabel(board, source) : cardId
  }
}
