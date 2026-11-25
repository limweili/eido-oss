import {
  memo,
  useMemo,
  useRef,
  type FocusEventHandler,
  type KeyboardEventHandler,
  type PointerEventHandler,
} from 'react'
import { useGraph } from '../../graph/store'
import { textHasContent } from '../../graph/graphHelpers'
import type { NoteFontSize } from '../../graph/noteFontSize'
import { renderMarkdown } from '../../shared/markdown'
import { followCardTextLink } from '../cardLinks'
import { highlightableTextDragBlockingClass } from '../cardInteraction'
import { useCardHighlights } from './useCardHighlights'
import { proseRoleClass } from './proseRoles'

// Keep the potentially large Markdown subtree on its own identity. Selection,
// active-tool, and focus changes still update the native wrapper's interaction
// classes without asking React to reconcile every descendant of the prose.
const HighlightableTextContent = memo(function HighlightableTextContent({
  html,
}: {
  html: string
}) {
  return <div dangerouslySetInnerHTML={{ __html: html }} />
})

// The lightweight read view for editable Markdown card bodies. The rich editor
// is mounted only for the selected card; every other card keeps this cheap HTML
// renderer while sharing the same Markdown geometry and saved highlights.
export function HighlightableText({
  cardId,
  text,
  placeholder,
  ariaLabel,
  selected,
  proseSize,
  onEditPoint,
  onPointerDown,
  onFocus,
  onKeyDown,
}: {
  cardId: string
  text: string
  placeholder: string
  ariaLabel: string
  selected: boolean
  proseSize?: NoteFontSize
  onEditPoint?: (point: { x: number; y: number }) => void
  onPointerDown?: PointerEventHandler<HTMLDivElement>
  onFocus?: FocusEventHandler<HTMLDivElement>
  onKeyDown?: KeyboardEventHandler<HTMLDivElement>
}) {
  const ref = useRef<HTMLDivElement | null>(null)
  const activeTool = useGraph((state) => state.activeTool)
  const hasText = useMemo(() => textHasContent(text), [text])
  const renderedText = useMemo(
    () => (hasText ? renderMarkdown(text) : ''),
    [hasText, text],
  )
  useCardHighlights(cardId, ref, renderedText)

  return (
    <div
      ref={ref}
      className={`note-render markdown e-prose ${proseRoleClass(proseSize)} ${highlightableTextDragBlockingClass(activeTool, selected)}`}
      role="textbox"
      aria-label={ariaLabel}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onClick={(event) => {
        if (followCardTextLink(event)) return
        onEditPoint?.({ x: event.clientX, y: event.clientY })
      }}
      onFocus={onFocus}
      onKeyDown={onKeyDown}
    >
      {hasText ? (
        <HighlightableTextContent html={renderedText} />
      ) : (
        <span className="result-empty">{placeholder}</span>
      )}
    </div>
  )
}
