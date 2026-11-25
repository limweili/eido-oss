import { Position } from '@xyflow/react'
import type { ComponentPropsWithoutRef, CSSProperties, ReactNode } from 'react'
import { forwardRef, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import {
  canEditSelectedCard,
  cardRenderedSizeReporterFromNodeData,
  dragBlockingClass,
} from '../cardInteraction'
import { useEffectiveMarqueeCardSelection } from '../marqueeSelectionState'
import { useGraph } from '../../graph/store'
import { isAgentUnadoptedCard } from '../../graph/cardAuthorship'
import type { CardHeaderFill, CardKind } from '../../graph/types'
import {
  cardKindLabels,
  setCardColourLabel,
  words,
} from '../../shared/words'
import {
  CARD_IDENTITIES,
  DEFAULT_CARD_IDENTITY,
  resolveCardIdentity,
} from '../../ui/cardIdentity'
import {
  ColourPicker,
  Popover,
  Tooltip,
  type ColourPickerModeOption,
  type ColourPickerOption,
} from '../../ui/primitives'
import { CardResizeHandles, type CardResizePreview } from './CardResizeHandles'
import { CardConnector } from './CardConnector'
import {
  cardBodyForegroundVariables,
  type CardBodyForegroundVariables,
} from './cardIdentityStyle'

type CardIdentityStyle = CSSProperties & Partial<CardBodyForegroundVariables> & {
  '--card-header-color'?: string
  '--card-header-soft'?: string
  '--card-header-body'?: string
  '--card-header-ink'?: string
  '--card-header-pattern-head'?: string
  '--card-header-pattern'?: string
}

export type CardColourMode = 'none' | CardHeaderFill

const CARD_COLOUR_OPTIONS: readonly ColourPickerOption<string>[] = CARD_IDENTITIES.map(
  (identity) => ({
    value: identity.solid,
    label: setCardColourLabel(identity.name),
    swatch: identity.solid,
  }),
)

export const CARD_COLOUR_MODE_OPTIONS: readonly ColourPickerModeOption<CardColourMode>[] = [
  {
    value: 'none',
    label: words.cardColourNoFill,
    tooltip: words.cardColourNoFillTooltip,
    className: 'no-color',
  },
  {
    value: 'half',
    label: words.cardColourSoftFill,
    tooltip: words.cardColourSoftFillTooltip,
    className: 'half-fill',
  },
  {
    value: 'full',
    label: words.cardColourBodyFill,
    tooltip: words.cardColourBodyFillTooltip,
    className: 'full-fill',
  },
  {
    value: 'pattern',
    label: words.cardColourPatternFill,
    tooltip: words.cardColourPatternFillTooltip,
    className: 'pattern-fill',
  },
]

let cardShellTitleProjectionCount = 0

export function cardShellTitleProjectionCountForTests(): number {
  return cardShellTitleProjectionCount
}

export function resetCardShellTitleProjectionCountForTests(): void {
  cardShellTitleProjectionCount = 0
}

function trimmedCardShellTitle(title: string): string {
  cardShellTitleProjectionCount += 1
  return title.trim()
}

const CardColourTrigger = forwardRef<
  HTMLButtonElement,
  ComponentPropsWithoutRef<'button'>
>(function CardColourTrigger(props, ref) {
  return (
    <Tooltip content={words.cardColourTooltip}>
      <button ref={ref} {...props} />
    </Tooltip>
  )
})

// The common frame for every card: connection handles, the kind label, selection
// ring, and four gesture-owned resize corners shown when selected. Cards are
// plain HTML so editing text is free.
export function CardShell({
  id,
  kind,
  selected,
  data,
  children,
  headActions,
  titleControl,
  identity,
}: {
  id: string
  kind: CardKind
  selected: boolean
  data: unknown
  children: ReactNode
  headActions?: ReactNode
  titleControl?: ReactNode
  identity?: Readonly<{
    color: string
    label: string
    picker: ReactNode
    interactive?: boolean
  }>
}) {
  const card = useGraph(useShallow((s) => {
    const found = s.graph().cardById(id)
    return {
      title: found?.title,
      headerColor: found?.headerColor,
      headerFill: found?.headerFill,
      createdBy: found?.createdBy,
      lastModifiedBy: found?.lastModifiedBy,
      hasHeight: Boolean(found?.size?.height),
    }
  }))
  const setCardTitle = useGraph((s) => s.setCardTitle)
  const setCardHeaderColor = useGraph((s) => s.setCardHeaderColor)
  const recordCardContentEdited = useGraph((s) => s.recordCardContentEdited)
  const activeTool = useGraph((s) => s.activeTool)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [editingTitle, setEditingTitle] = useState(false)
  const [resizePreview, setResizePreview] = useState<CardResizePreview | null>(null)
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const cardElementRef = useRef<HTMLDivElement | null>(null)
  const titleEditStartRef = useRef('')
  const effectiveSelected = useEffectiveMarqueeCardSelection(id, selected)
  const agentUnadopted = isAgentUnadoptedCard(card)

  const dragBlock = dragBlockingClass(effectiveSelected)
  // The title opens for editing on the same terms as the body: the first press
  // on an unselected card selects or drags it instead of dropping straight into
  // the title editor. Gate on the node data React Flow delivers (not the graph
  // store's selection copy, which syncs an effect later) so the gate opens in
  // the same commit that renders the card as selected.
  const canEditTitle = canEditSelectedCard({ activeTool, data, selected: effectiveSelected })
  const canOpenIdentity = identity ? (identity.interactive ?? canEditTitle) : true
  const headerColor = identity?.color ?? card.headerColor
  // Identity-owned cards (Mods) paint a fill only when one was chosen; other
  // cards keep the soft default the moment they carry a colour.
  const headerFill = identity
    ? card.headerColor ? card.headerFill ?? 'half' : undefined
    : headerColor ? card.headerFill ?? 'half' : undefined
  const title = card.title ?? ''
  const displayTitle = useMemo(() => trimmedCardShellTitle(title), [title])
  const hasCustomTitle = displayTitle.length > 0
  const paletteIdentity = resolveCardIdentity(headerColor ?? DEFAULT_CARD_IDENTITY)
  const paletteIdentityStyle: CardIdentityStyle = {
    '--card-header-color': paletteIdentity.solid,
    '--card-header-soft': paletteIdentity.soft,
    '--card-header-body': paletteIdentity.body,
    '--card-header-ink': paletteIdentity.onSolid,
    ...cardBodyForegroundVariables(paletteIdentity, 'all'),
    '--card-header-pattern-head': paletteIdentity.patternHead,
    '--card-header-pattern': paletteIdentity.pattern,
  }
  const cardIdentityStyle = headerColor ? paletteIdentityStyle : undefined
  const hasRenderedHeight = card.hasHeight || resizePreview !== null
  const cardStyle: CardIdentityStyle = {
    width: resizePreview?.size.width,
    height: resizePreview?.size.height ?? (hasRenderedHeight ? '100%' : undefined),
    transform: resizePreview
      ? `translate(${resizePreview.offset.x}px, ${resizePreview.offset.y}px)`
      : undefined,
    ...cardIdentityStyle,
  }

  useEffect(() => {
    if (!editingTitle) return
    titleInputRef.current?.focus()
    titleInputRef.current?.select()
  }, [editingTitle])

  useEffect(() => {
    const element = cardElementRef.current
    const reportRenderedSize = cardRenderedSizeReporterFromNodeData(data)
    if (!element || !reportRenderedSize || card.hasHeight || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver((entries) => {
      const entry = entries[entries.length - 1]
      if (!entry) return
      const borderBox = Array.isArray(entry.borderBoxSize) ? entry.borderBoxSize[0] : entry.borderBoxSize
      const width = borderBox?.inlineSize ?? element.offsetWidth
      const height = borderBox?.blockSize ?? element.offsetHeight
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return
      reportRenderedSize(id, { width, height })
    })
    observer.observe(element, { box: 'border-box' })
    return () => observer.disconnect()
  }, [card.hasHeight, data, id])

  const setFill = (fill: CardHeaderFill) => {
    setCardHeaderColor(id, headerColor ?? DEFAULT_CARD_IDENTITY, fill)
  }

  return (
    <div
      ref={cardElementRef}
      className={`card ${kind} ${effectiveSelected ? 'selected' : ''} ${hasRenderedHeight ? 'fixed-h' : ''} ${
        headerFill ? `fill-${headerFill}` : ''
      } ${paletteOpen ? 'palette-open' : ''} ${agentUnadopted ? 'agent-unadopted' : ''}`}
      style={cardStyle}
    >
      <div className="card-resize-layer">
        {effectiveSelected && (
          <CardResizeHandles id={id} data={data} onVisualPreview={setResizePreview} />
        )}
      </div>
      <CardConnector
        type="target"
        position={Position.Left}
      />
      <div className="card-head">
        <div className={`color-wrap ${dragBlock}`}>
          <Popover
            open={paletteOpen}
            onOpenChange={setPaletteOpen}
            trigger={
              <CardColourTrigger
                className={`kind-dot ${headerColor ? 'has-color' : ''}`}
                type="button"
                aria-label={identity?.label ?? words.cardColour}
                onPointerDown={(event) => {
                  if (canOpenIdentity) event.stopPropagation()
                }}
                onClick={(event) => {
                  if (!canOpenIdentity) {
                    event.preventDefault()
                    return
                  }
                  event.stopPropagation()
                }}
              />
            }
          >
            <div
              className="card-color-popover"
              style={paletteIdentityStyle}
              onPointerDown={(event) => event.stopPropagation()}
              onClick={(event) => event.stopPropagation()}
            >
              {identity?.picker ?? (
                <ColourPicker
                  label={words.cardColour}
                  ariaLabel={words.cardColour}
                  value={headerColor?.toLowerCase()}
                  options={CARD_COLOUR_OPTIONS}
                  onValueChange={(colour) =>
                    setCardHeaderColor(id, colour, headerFill ?? 'half')
                  }
                  modeAriaLabel={words.cardColourFillStyle}
                  modeValue={headerColor ? headerFill : 'none'}
                  modeOptions={CARD_COLOUR_MODE_OPTIONS}
                  onModeValueChange={(mode) => {
                    if (mode === 'none') setCardHeaderColor(id, undefined)
                    else setFill(mode)
                  }}
                />
              )}
            </div>
          </Popover>
        </div>
        {titleControl ?? (editingTitle ? (
          <input
            ref={titleInputRef}
            className="card-title-input nodrag t-title"
            placeholder={cardKindLabels[kind]}
            aria-label={`${cardKindLabels[kind]} title`}
            value={title}
            onChange={(e) => setCardTitle(id, e.target.value)}
            onBlur={(e) => {
              if (e.target.value !== titleEditStartRef.current) recordCardContentEdited(id, 'title')
              setEditingTitle(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur()
              if (e.key === 'Escape') e.currentTarget.blur()
            }}
          />
        ) : (
          <button
            className={`card-title-display t-title ${dragBlock} ${hasCustomTitle ? 'has-title' : ''}`}
            type="button"
            aria-label={`${cardKindLabels[kind]} title`}
            onClick={(e) => {
              // Not editable yet: let the click bubble so React Flow selects
              // the card; the next stationary click opens the editor.
              if (!canEditTitle) return
              e.stopPropagation()
              titleEditStartRef.current = title
              setEditingTitle(true)
            }}
          >
            <span>{hasCustomTitle ? displayTitle : cardKindLabels[kind]}</span>
          </button>
        ))}
        {headActions && <div className="card-head-actions">{headActions}</div>}
      </div>
      {children}
      <CardConnector
        type="source"
        position={Position.Right}
      />
    </div>
  )
}
