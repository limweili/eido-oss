export type BoardKeyboardIntent =
  | { type: 'clearSelection' }
  | { type: 'selectAll' }
  | { type: 'copyWholeBoard' }
  | { type: 'copyCards'; cardIds: string[] }
  | { type: 'pasteCards' }
  // Cards and connections are selectable together (#212), so one delete
  // intent carries both: everything selected goes.
  | { type: 'deleteSelection'; cardIds: string[]; connectionIds: string[] }

export type BoardKeyboardInput = {
  readOnly: boolean
  key: string
  metaKey?: boolean
  ctrlKey?: boolean
  targetIsEditable: boolean
  hasTextSelection?: boolean
  wholeBoardSelected?: boolean
  selectedNodeIds: ReadonlySet<string>
  selectedConnectionIds: ReadonlySet<string>
}

function isDeleteKey(key: string): boolean {
  return key === 'Backspace' || key === 'Delete'
}

export function boardKeyboardIntent(input: BoardKeyboardInput): BoardKeyboardIntent | null {
  if (input.readOnly) return null

  if (input.key === 'Escape') return { type: 'clearSelection' }
  if (input.targetIsEditable) return null

  const cardIds = [...input.selectedNodeIds]
  if (isDeleteKey(input.key)) {
    const connectionIds = [...input.selectedConnectionIds]
    if (cardIds.length > 0 || connectionIds.length > 0) {
      return { type: 'deleteSelection', cardIds, connectionIds }
    }
    return null
  }

  if (!input.metaKey && !input.ctrlKey) return null

  const key = input.key.toLowerCase()
  // Whole-Board selection is deliberately logical. It carries no Card ids, so
  // #556's selected-card Live owner cannot turn Cmd/Ctrl+A into whole-Board DOM.
  if (key === 'a') return { type: 'selectAll' }
  if (key === 'c' && input.hasTextSelection) return null
  if (key === 'c' && input.wholeBoardSelected) return { type: 'copyWholeBoard' }
  if (key === 'c' && cardIds.length > 0) return { type: 'copyCards', cardIds }
  if (key === 'v') return { type: 'pasteCards' }

  return null
}
