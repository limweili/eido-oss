export type BoardDeletionOptions = Readonly<{
  cardIds: readonly string[]
  connectionIds: readonly string[]
  includesGroup: boolean
  confirmGroupDelete: () => Promise<boolean>
  onConfirmed?: () => void
  deleteCard: (cardId: string) => void
  deleteConnections: (connectionIds: string[]) => void
}>

/**
 * Executes one captured keyboard-deletion target. Copies happen before the
 * first possible await so an asynchronous shared confirm can never redirect
 * deletion to a later selection.
 */
export async function executeBoardDeletion({
  cardIds,
  connectionIds,
  includesGroup,
  confirmGroupDelete,
  onConfirmed,
  deleteCard,
  deleteConnections,
}: BoardDeletionOptions): Promise<boolean> {
  const capturedCardIds = [...cardIds]
  const capturedConnectionIds = [...connectionIds]
  if (includesGroup && !(await confirmGroupDelete())) return false

  onConfirmed?.()
  for (const cardId of capturedCardIds) deleteCard(cardId)
  // Card deletion cascades attached connections. The store action safely
  // removes only survivors, in one commit, so one undo restores the batch.
  if (capturedConnectionIds.length) deleteConnections(capturedConnectionIds)
  return true
}
