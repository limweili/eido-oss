import { contractFor } from '../../graph/contextContracts'
import type { CardKind, Connection, ConnectionStrength } from '../../graph/types'

const CONNECTION_STRENGTH_ORDER: readonly ConnectionStrength[] = ['strong', 'weak']

type FocusTarget = { focus(): void }

export function moveConnectionStrengthByArrow({
  current,
  key,
  targets,
  onSelect,
}: {
  current: ConnectionStrength
  key: string
  targets: Readonly<Record<ConnectionStrength, FocusTarget | null>>
  onSelect: (strength: ConnectionStrength) => void
}): boolean {
  const direction =
    key === 'ArrowRight' || key === 'ArrowDown'
      ? 1
      : key === 'ArrowLeft' || key === 'ArrowUp'
        ? -1
        : 0
  if (direction === 0) return false

  const currentIndex = CONNECTION_STRENGTH_ORDER.indexOf(current)
  const nextIndex =
    (currentIndex + direction + CONNECTION_STRENGTH_ORDER.length) %
    CONNECTION_STRENGTH_ORDER.length
  const next = CONNECTION_STRENGTH_ORDER[nextIndex]!
  targets[next]?.focus()
  onSelect(next)
  return true
}

// Which controls the connection editor (the pill popover) offers. Derived from
// the connection itself plus the source card's context contract — the group
// choice comes from `presentation.groupModeToggle`, never a card-kind branch
// (ADR 0017).
export type ConnectionEditorModel = {
  isMod: boolean
  showPolarity: boolean
  showStrength: boolean
  showReason: boolean
  showGroupMode: boolean
}

export function connectionEditorModel(
  connection: Connection,
  sourceKind: CardKind | undefined,
): ConnectionEditorModel {
  const isMod = connection.role === 'modifies'
  return {
    isMod,
    showPolarity: !isMod,
    showStrength: true,
    showReason: !isMod && connection.polarity === 'pushesAgainst',
    showGroupMode:
      !isMod && Boolean(sourceKind && contractFor(sourceKind).presentation.groupModeToggle),
  }
}
