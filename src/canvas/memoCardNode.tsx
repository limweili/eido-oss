import type { NodeProps } from '@xyflow/react'
import { memo, type ComponentType } from 'react'

function semanticScopeKey(data: unknown, cardId: string): string {
  if (!data || typeof data !== 'object') return cardId
  const key = (data as { semanticScopeKey?: unknown }).semanticScopeKey
  return typeof key === 'string' ? key : cardId
}

function semanticSelected(data: unknown): boolean {
  if (!data || typeof data !== 'object') return false
  const selected = (data as { semanticSelected?: unknown }).semanticSelected
  return selected === true
}

/**
 * Keep React Flow's hot geometry props at the node wrapper. Rich Card content
 * only needs a new render when its semantic data or selection authority moves.
 */
export function memoCardNode(
  Card: ComponentType<NodeProps>,
): ComponentType<NodeProps> {
  const MemoCard = memo(
    function ScopedCardNode(props: NodeProps) {
      // React Flow keeps the outer node keyed by Card id. The inner key adds
      // Idea scope so a same-id Card in another Idea cannot inherit editor,
      // draft, transcript, or context state from the previous semantic owner.
      return (
        <Card
          key={semanticScopeKey(props.data, props.id)}
          {...props}
          selected={semanticSelected(props.data)}
        />
      )
    },
    (previous, next) =>
      previous.id === next.id &&
      previous.data === next.data,
  )
  MemoCard.displayName = `memoCardNode(${Card.displayName ?? Card.name ?? 'Card'})`
  return MemoCard
}
