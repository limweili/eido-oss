import { Handle, NodeResizer, Position, type NodeProps } from '@xyflow/react'
import type { CSSProperties } from 'react'
import { useEffect, useRef } from 'react'
import type { Card } from '../../graph/types'
import { useGraph } from '../../graph/store'
import { cardResizeReporterFromNodeData } from '../cardInteraction'

// Below Reading, the canvas remains the card's visual representation. Gesture
// participants mount this proxy for real connection hit areas and, when the
// painted card is selected, the same corner resize controls used in Reading.
// The proxy never paints a second card body.
const LOW_ZOOM_HANDLE_SIZE = 96
const lowZoomHandleStyle = (side: 'left' | 'right'): CSSProperties => ({
  width: LOW_ZOOM_HANDLE_SIZE,
  height: LOW_ZOOM_HANDLE_SIZE,
  minWidth: LOW_ZOOM_HANDLE_SIZE,
  minHeight: LOW_ZOOM_HANDLE_SIZE,
  borderWidth: 16,
  [side]: -LOW_ZOOM_HANDLE_SIZE / 2,
  opacity: 0,
})

export function LowZoomCard({ id, selected, data }: NodeProps) {
  const setCardSize = useGraph((state) => state.setCardSize)
  const recordCardStructuralChange = useGraph((state) => state.recordCardStructuralChange)
  const resizeStartCardsRef = useRef<Card[] | null>(null)
  const activeHandleRef = useRef<HTMLElement | null>(null)
  const pendingSizeRef = useRef<{ width: number; height: number } | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const reportCardResize = cardResizeReporterFromNodeData(data)

  const flushPendingSize = () => {
    const size = pendingSizeRef.current
    pendingSizeRef.current = null
    if (!size) return
    reportCardResize?.(id, size)
    setCardSize(id, size, { recordHistory: false })
  }

  const flushResizeFrame = () => {
    if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current)
    resizeFrameRef.current = null
    flushPendingSize()
  }

  useEffect(
    () => () => {
      if (resizeFrameRef.current !== null) cancelAnimationFrame(resizeFrameRef.current)
    },
    [],
  )

  return (
    <>
      <NodeResizer
        isVisible={!!selected}
        minWidth={200}
        minHeight={120}
        onResizeStart={(event) => {
          const cards = useGraph.getState().cards
          resizeStartCardsRef.current = cards
          const card = cards.find((candidate) => candidate.id === id)
          const sourceTarget = event.sourceEvent.target
          const element =
            sourceTarget instanceof Element
              ? sourceTarget.closest<HTMLElement>('.react-flow__resize-control.handle')
              : null
          activeHandleRef.current = card ? element : null
        }}
        onResize={(_, params) => {
          const activeHandle = activeHandleRef.current
          if (activeHandle) {
            activeHandle.style.left = `${activeHandle.classList.contains('right') ? params.width : 0}px`
            activeHandle.style.top = `${activeHandle.classList.contains('bottom') ? params.height : 0}px`
            activeHandle.style.right = 'auto'
            activeHandle.style.bottom = 'auto'
          }
          const size = { width: params.width, height: params.height }
          pendingSizeRef.current = size
          if (resizeFrameRef.current === null) {
            resizeFrameRef.current = requestAnimationFrame(() => {
              resizeFrameRef.current = null
              flushPendingSize()
            })
          }
        }}
        onResizeEnd={() => {
          if (!resizeStartCardsRef.current) return
          flushResizeFrame()
          recordCardStructuralChange('resizeCard', resizeStartCardsRef.current, useGraph.getState().cards)
          resizeStartCardsRef.current = null
          const activeHandle = activeHandleRef.current
          activeHandleRef.current = null
          if (activeHandle) {
            requestAnimationFrame(() => {
              activeHandle.style.removeProperty('left')
              activeHandle.style.removeProperty('top')
              activeHandle.style.removeProperty('right')
              activeHandle.style.removeProperty('bottom')
            })
          }
        }}
        lineStyle={{ borderColor: 'transparent' }}
        // The canvas paints the visible grabbers in the same frame as the
        // low-detail card. These controls remain as generous interaction
        // targets only, so there is no second visual layer that can race
        // ahead of the painted card during resize.
        handleStyle={{ width: 9, height: 9, opacity: 0, border: 'none' }}
      />
      <Handle type="target" position={Position.Left} style={lowZoomHandleStyle('left')} />
      <div style={{ height: LOW_ZOOM_HANDLE_SIZE }} aria-hidden />
      <Handle type="source" position={Position.Right} style={lowZoomHandleStyle('right')} />
    </>
  )
}
