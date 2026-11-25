import { NodeResizer, type NodeProps } from '@xyflow/react'
import { useRef } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { dragBlockingClass } from '../cardInteraction'
import { useGraph } from '../../graph/store'
import { cardTextFromBlocks } from '../../graph/graphHelpers'
import { isAgentUnadoptedCard } from '../../graph/cardAuthorship'
import { useAutoGrow } from '../../shared/useAutoGrow'
import { useFittedTitleFontSize } from './titleCardFontFit'
import { words } from '../../shared/words'
import { useEffectiveMarqueeCardSelection } from '../marqueeSelectionState'

export function TitleCard({ id, selected }: NodeProps) {
  const card = useGraph(useShallow((s) => {
    const found = s.graph().cardById(id)
    return {
      exists: Boolean(found),
      blocks: found?.blocks,
      fixedHeight: Boolean(found?.size?.height),
      createdBy: found?.createdBy,
      lastModifiedBy: found?.lastModifiedBy,
    }
  }))
  const setCardText = useGraph((s) => s.setCardText)
  const recordCardContentEdited = useGraph((s) => s.recordCardContentEdited)
  const setCardSize = useGraph((s) => s.setCardSize)
  const text = card.blocks ? cardTextFromBlocks(card.blocks) : ''
  const editStartTextRef = useRef('')
  const fixedHeight = card.fixedHeight
  const textareaRef = useAutoGrow(text, fixedHeight)
  // A Title card with an explicit box is a drawn landmark: its type fills that
  // box. One without a box (legacy or auto-height) keeps the resting step.
  useFittedTitleFontSize(textareaRef, text, words.titlePlaceholder, fixedHeight)
  const effectiveSelected = useEffectiveMarqueeCardSelection(id, !!selected)
  const agentUnadopted = isAgentUnadoptedCard(card)

  if (!card.exists) return null

  return (
    <div className={`title-card ${effectiveSelected ? 'selected' : ''} ${
      fixedHeight ? 'fixed-h' : ''
    } ${agentUnadopted ? 'agent-unadopted' : ''}`}>
      <NodeResizer
        isVisible={effectiveSelected}
        minWidth={140}
        minHeight={48}
        onResize={(_, p) => setCardSize(id, { width: p.width, height: p.height })}
        lineClassName="title-card-resize-line"
        handleClassName="title-card-resize-handle"
      />
      <textarea
        ref={textareaRef}
        className={`title-card-input t-title-canvas ${dragBlockingClass(effectiveSelected)}`}
        value={text}
        placeholder={words.titlePlaceholder}
        onFocus={() => {
          editStartTextRef.current = text
        }}
        onBlur={(event) => {
          if (event.target.value !== editStartTextRef.current) recordCardContentEdited(id)
        }}
        onChange={(event) => setCardText(id, event.target.value)}
      />
    </div>
  )
}
