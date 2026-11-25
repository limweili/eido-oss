import {
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown } from 'lucide-react'
import {
  type CompiledInstruction,
  type ContextPreviewBudgetStatus,
  type ContextPreviewContextEntry,
  type ContextPreviewModEntry,
  type ContextPreviewRelation,
} from '../brain/compiler'
import { words } from '../shared/words'
import {
  Badge,
  Button,
  Chip,
  ContextRow,
  ContextRowBoundary,
  useFloatingPortalDestination,
} from '../ui/primitives'
import { ModalShell } from '../ui/overlays'
import { MarkdownPreview } from './MarkdownPreview'

// A read-only rendering of the exact projection a Run would send. The caller
// compiles once; this surface never reads the graph or calls the compiler.
export function ContextPeek({
  compiled,
  onReorder,
  onClose,
}: {
  compiled: CompiledInstruction
  onReorder: (connectionIds: string[]) => void
  onClose: () => void
}) {
  const [open, setOpen] = useState(true)
  const [showExactText, setShowExactText] = useState(false)

  const positive = compiled.preview.context.filter((entry) => entry.relation !== 'avoid')
  const avoid = compiled.preview.context.filter((entry) => entry.relation === 'avoid')

  return (
    <ModalShell
      open={open}
      title={words.peekTitle}
      titleMeta={<Badge>{compiled.preview.context.length}</Badge>}
      className="context-surface context-peek"
      dismissOnBackdrop
      onDismiss={() => setOpen(false)}
      onExitComplete={onClose}
      footer={
        <Button onClick={() => setOpen(false)}>{words.close}</Button>
      }
    >
      <div className="context-surface__sections">
        {compiled.isEmpty && <p className="result-empty">{words.peekNothing}</p>}

        <section className="context-surface__section" aria-labelledby="context-task-heading">
          <h3 id="context-task-heading" className="context-surface__section-title t-micro">
            {words.peekTask}
          </h3>
          <MarkdownPreview
            className="context-surface__task"
            text={compiled.sections.task}
            emptyText={words.peekEmptyValue}
          />
        </section>

        {compiled.preview.mods.length > 0 && <ModSection items={compiled.preview.mods} />}

        <RankedContextSections items={positive} onReorder={onReorder} />
        {avoid.length > 0 && (
          <Section
            title={words.peekAlreadyExplored}
            items={avoid}
            variant="already-explored"
          />
        )}

        <div className="context-surface__exact-text">
          <Button
            variant="quiet"
            aria-expanded={showExactText}
            onClick={() => setShowExactText((visible) => !visible)}
          >
            {words.seeExactText}
          </Button>
          {showExactText && <pre className="context-surface__raw-text">{compiled.text}</pre>}
        </div>
      </div>
    </ModalShell>
  )
}

function RankedContextSections({
  items,
  onReorder,
}: {
  items: ContextPreviewContextEntry[]
  onReorder: (connectionIds: string[]) => void
}) {
  const floatingPortalDestination = useFloatingPortalDestination()
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [previewOrder, setPreviewOrder] = useState<string[] | null>(null)
  const previewOrderRef = useRef<string[] | null>(null)
  const initialOrderRef = useRef<string[]>([])
  const hasPreviewReorderRef = useRef(false)
  const reorderCommittedRef = useRef(false)
  const [dragOverlay, setDragOverlay] = useState<{
    item: ContextPreviewContextEntry
    rank: number | undefined
    offsetX: number
    offsetY: number
    x: number
    y: number
    width: number
  } | null>(null)
  const itemByConnectionId = new Map(items.map((entry) => [entry.connectionId, entry]))
  const orderedItems = previewOrder
    ? [
        ...previewOrder.flatMap((connectionId) => {
          const item = itemByConnectionId.get(connectionId)
          return item ? [item] : []
        }),
        ...items.filter((item) => !previewOrder.includes(item.connectionId)),
      ]
    : items
  const direct = orderedItems.filter((entry) => entry.relation === 'direct')
  const light = orderedItems.filter((entry) => entry.relation === 'light')
  const ranks = new Map(orderedItems.map((entry, index) => [entry.connectionId, index + 1]))
  const boundaryConnectionId = items.find((entry) => entry.budgetStatus !== 'full')?.connectionId
  const previewMove = (targetId: string, placement: 'before' | 'after') => {
    if (!draggingId || draggingId === targetId) return
    setPreviewOrder((current) => {
      const ids = current ?? items.map((item) => item.connectionId)
      const from = ids.indexOf(draggingId)
      if (from < 0) return ids
      const next = ids.filter((id) => id !== draggingId)
      const targetIndex = next.indexOf(targetId)
      if (targetIndex < 0) return ids
      next.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, draggingId)
      if (next.every((id, index) => id === ids[index])) return ids
      previewOrderRef.current = next
      hasPreviewReorderRef.current = next.some(
        (id, index) => id !== initialOrderRef.current[index],
      )
      return next
    })
  }
  const startDragging = (
    item: ContextPreviewContextEntry,
    rank: number | undefined,
    event: DragEvent<HTMLButtonElement>,
  ) => {
    const row = event.currentTarget.closest<HTMLElement>('.e-context-row')
    if (!row) return
    const rowRect = row.getBoundingClientRect()
    const gripRect = event.currentTarget.getBoundingClientRect()
    const pointerX = event.clientX || gripRect.left + gripRect.width / 2
    const pointerY = event.clientY || gripRect.top + gripRect.height / 2
    const offsetX = pointerX - rowRect.left
    const offsetY = pointerY - rowRect.top
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', item.connectionId)
    const transparentDragImage = document.createElement('span')
    transparentDragImage.className = 'context-drag-image'
    document.body.appendChild(transparentDragImage)
    if (typeof event.dataTransfer.setDragImage === 'function') {
      event.dataTransfer.setDragImage(transparentDragImage, 0, 0)
    }
    requestAnimationFrame(() => transparentDragImage.remove())
    reorderCommittedRef.current = false
    hasPreviewReorderRef.current = false
    setDraggingId(item.connectionId)
    const initialOrder = items.map((entry) => entry.connectionId)
    initialOrderRef.current = initialOrder
    previewOrderRef.current = initialOrder
    setPreviewOrder(initialOrder)
    setDragOverlay({
      item,
      rank,
      offsetX,
      offsetY,
      x: pointerX - offsetX,
      y: pointerY - offsetY,
      width: rowRect.width,
    })
  }
  const moveDragging = (event: DragEvent<HTMLButtonElement>) => {
    if (!event.clientX && !event.clientY) return
    setDragOverlay((current) => current
      ? {
          ...current,
          x: event.clientX - current.offsetX,
          y: event.clientY - current.offsetY,
        }
      : current)
  }
  const endDragging = () => {
    initialOrderRef.current = []
    hasPreviewReorderRef.current = false
    previewOrderRef.current = null
    setDraggingId(null)
    setPreviewOrder(null)
    setDragOverlay(null)
  }
  const commitDragging = () => {
    const order = previewOrderRef.current
    if (!reorderCommittedRef.current && hasPreviewReorderRef.current && order) {
      reorderCommittedRef.current = true
      onReorder(order)
    }
    endDragging()
  }
  const dragProps = {
    draggingId,
    onDragStart: startDragging,
    onDrag: moveDragging,
    onDragEnd: endDragging,
    onPreviewMove: previewMove,
    onDropReorder: commitDragging,
  }

  return (
    <>
      {direct.length > 0 && (
        <Section
          title={words.peekBuildOn}
          items={direct}
          ranks={ranks}
          boundaryConnectionId={boundaryConnectionId}
          {...dragProps}
        />
      )}
      {light.length > 0 && (
        <Section
          title={words.peekInfluences}
          items={light}
          ranks={ranks}
          boundaryConnectionId={boundaryConnectionId}
          {...dragProps}
        />
      )}
      {!boundaryConnectionId && <ContextRowBoundary label={words.trimsFirst} />}
      {dragOverlay && floatingPortalDestination && createPortal(
        <div
          className="context-drag-overlay"
          style={{
            '--e-context-drag-x': `${dragOverlay.x}px`,
            '--e-context-drag-y': `${dragOverlay.y}px`,
            width: dragOverlay.width,
          } as CSSProperties}
        >
          <ContextRow
            rank={dragOverlay.rank}
            relation={dragOverlay.item.relation}
            title={contextTitle(dragOverlay.item)}
            status={budgetStatus(dragOverlay.item.budgetStatus)}
            lifted
          />
        </div>,
        floatingPortalDestination,
      )}
    </>
  )
}

function Section({
  title,
  items,
  ranks,
  boundaryConnectionId,
  variant,
  draggingId,
  onDragStart,
  onDrag,
  onDragEnd,
  onPreviewMove,
  onDropReorder,
}: {
  title: string
  items: ContextPreviewContextEntry[]
  ranks?: ReadonlyMap<string, number>
  boundaryConnectionId?: string
  variant?: 'already-explored'
  draggingId?: string | null
  onDragStart?: (
    item: ContextPreviewContextEntry,
    rank: number | undefined,
    event: DragEvent<HTMLButtonElement>,
  ) => void
  onDrag?: (event: DragEvent<HTMLButtonElement>) => void
  onDragEnd?: () => void
  onPreviewMove?: (connectionId: string, placement: 'before' | 'after') => void
  onDropReorder?: () => void
}) {
  const rowsRef = useRef<HTMLDivElement | null>(null)
  const previousRowTopsRef = useRef(new Map<string, number>())
  const previousDraggingIdRef = useRef<string | null>(null)
  const hoverIntentRef = useRef<string | null>(null)
  const rowAnimationsRef = useRef(new Map<string, Animation>())
  const itemOrderKey = items.map((item) => item.connectionId).join('\u0000')
  const slots = () => Array.from(
    rowsRef.current?.querySelectorAll<HTMLElement>(':scope > .context-surface__row-slot') ?? [],
  )
  const captureLiveRowTops = () => {
    previousRowTopsRef.current = new Map(
      slots().flatMap((slot) => {
        const connectionId = slot.dataset.connectionId
        return connectionId ? [[connectionId, slot.getBoundingClientRect().top]] : []
      }),
    )
  }
  const previewPlacement = (
    event: DragEvent<HTMLElement>,
    connectionId: string,
  ) => {
    if (!draggingId || draggingId === connectionId) return
    const bounds = event.currentTarget.getBoundingClientRect()
    const placement = !event.clientY || event.clientY <= bounds.top + bounds.height / 2
      ? 'before'
      : 'after'
    const intent = `${connectionId}:${placement}`
    if (hoverIntentRef.current === intent) return
    hoverIntentRef.current = intent
    captureLiveRowTops()
    onPreviewMove?.(connectionId, placement)
  }
  useLayoutEffect(() => {
    const rowSlots = slots()
    const nextRowTops = new Map<string, number>()
    for (const slot of rowSlots) {
      const connectionId = slot.dataset.connectionId
      if (!connectionId) continue
      const transform = getComputedStyle(slot).transform
      const translatedY =
        transform !== 'none' && typeof DOMMatrixReadOnly === 'function'
          ? new DOMMatrixReadOnly(transform).m42
          : 0
      nextRowTops.set(connectionId, slot.getBoundingClientRect().top - translatedY)
    }

    if (draggingId && previousDraggingIdRef.current === draggingId) {
      for (const slot of rowSlots) {
        const connectionId = slot.dataset.connectionId
        if (!connectionId) continue
        const previousTop = previousRowTopsRef.current.get(connectionId)
        const nextTop = nextRowTops.get(connectionId)
        if (previousTop === undefined || nextTop === undefined) continue
        const delta = previousTop - nextTop
        if (Math.abs(delta) < 0.5) continue
        rowAnimationsRef.current.get(connectionId)?.cancel()
        if (typeof slot.animate !== 'function') continue
        const styles = getComputedStyle(slot)
        const animation = slot.animate(
          [
            { transform: `translateY(${delta}px)` },
            { transform: 'translateY(0)' },
          ],
          {
            duration: cssTimeMilliseconds(styles.getPropertyValue('--e-t-move')),
            easing: styles.getPropertyValue('--e-ease-settle').trim(),
          },
        )
        rowAnimationsRef.current.set(connectionId, animation)
        animation.onfinish = () => {
          if (rowAnimationsRef.current.get(connectionId) === animation) {
            rowAnimationsRef.current.delete(connectionId)
          }
        }
      }
    }
    previousRowTopsRef.current = nextRowTops
    previousDraggingIdRef.current = draggingId ?? null
    if (!draggingId) {
      hoverIntentRef.current = null
      for (const animation of rowAnimationsRef.current.values()) animation.cancel()
      rowAnimationsRef.current.clear()
    }
  }, [draggingId, itemOrderKey])

  return (
    <section
      className={`context-surface__section ${variant ?? ''}`}
      aria-label={title}
    >
      <h3 className="context-surface__section-title t-micro">{title}</h3>
      <div className="context-surface__rows" ref={rowsRef}>
        {items.map((item) => {
          const reorderable = item.relation !== 'avoid' && Boolean(item.connectionId)
          return (
            <div
              className="context-surface__row-slot"
              data-connection-id={item.connectionId || undefined}
              key={item.connectionId ?? item.cardId}
              onDragEnter={
                reorderable
                  ? (event) => previewPlacement(event, item.connectionId)
                  : undefined
              }
              onDragOver={
                reorderable
                  ? (event) => {
                      if (!draggingId) return
                      event.preventDefault()
                      previewPlacement(event, item.connectionId)
                    }
                  : undefined
              }
              onDrop={
                reorderable
                  ? (event) => {
                      event.preventDefault()
                      onDropReorder?.()
                    }
                  : undefined
              }
            >
              {item.connectionId === boundaryConnectionId && (
                <ContextRowBoundary label={words.trimsFirst} />
              )}
              <ContextRow
                cardId={item.cardId}
                rank={item.relation === 'avoid' ? undefined : ranks?.get(item.connectionId)}
                reorderable={reorderable}
                dragLabel={words.dragToRearrange}
                relation={item.relation}
                title={contextTitle(item)}
                status={budgetStatus(item.budgetStatus)}
                lifted={draggingId === item.connectionId}
                meta={
                  <>
                    <div>{relationMeta(item.relation, item.hop)}</div>
                    <div>{words.peekConnection} {item.connectionLabel}</div>
                  </>
                }
                snippet={<ContextEntryDetail item={item} />}
                onDragStart={
                  reorderable
                    ? (event) => {
                        onDragStart?.(item, ranks?.get(item.connectionId), event)
                      }
                    : undefined
                }
                onDrag={reorderable ? onDrag : undefined}
                onDragEnd={reorderable ? onDragEnd : undefined}
              />
            </div>
          )
        })}
      </div>
    </section>
  )
}

function cssTimeMilliseconds(value: string): number {
  const time = value.trim()
  const scalar = Number.parseFloat(time)
  if (!Number.isFinite(scalar)) return 0
  return time.endsWith('ms') ? scalar : time.endsWith('s') ? scalar * 1000 : 0
}

function contextTitle(item: ContextPreviewContextEntry): string {
  if (item.groupMode) {
    const mode = item.groupMode === 'compress' ? words.groupCompress : words.groupFull
    const source = item.label || words.peekGroupFallback
    return `${mode} ${words.peekGroupFrom} ${source}`
  }
  return item.label || item.text.split('\n')[0] || words.peekUntitledContext
}

function relationMeta(relation: ContextPreviewRelation, hop: number): string {
  const label = relation === 'direct'
    ? words.peekRelationDirect
    : relation === 'light'
      ? words.peekRelationLight
      : words.peekRelationAvoid
  return `${label} · ${words.peekHop.toUpperCase()} ${hop}`
}

function budgetStatus(status: ContextPreviewBudgetStatus): ReactNode {
  if (status === 'full') return null
  const label = status === 'dropped' ? words.peekStatusOmitted : words.peekStatusCompacted
  return (
    <Chip tone="attention">
      {label}
    </Chip>
  )
}

function ContextEntryDetail({ item }: { item: ContextPreviewContextEntry }) {
  return (
    <>
      {item.budgetStatus !== 'full' && (
        <div className="context-surface__budget-detail">{budgetStatusDetail(item.budgetStatus)}</div>
      )}
      {item.label && item.label !== item.text.split('\n')[0] && (
        <strong className="context-surface__detail-label">{item.label}</strong>
      )}
      {item.groupMode === 'full' && item.memberLabels && (
        <div className="context-surface__members">
          {item.memberLabels.map((label) => <span key={label}>{label}</span>)}
        </div>
      )}
      <MarkdownPreview
        className="context-surface__card-markdown"
        text={item.text}
        emptyText={words.peekNoText}
      />
      {item.reason && (
        <div className="context-surface__reason">{words.peekAvoidReason} {item.reason}</div>
      )}
      {item.assets.length > 0 && (
        <div className="context-surface__assets">
          {item.assets.map((asset) => (
            <span className="context-surface__asset" key={asset.id}>
              {asset.kind}: {asset.name}
            </span>
          ))}
        </div>
      )}
    </>
  )
}

function budgetStatusDetail(status: ContextPreviewBudgetStatus): string {
  switch (status) {
    case 'compacted':
      return words.peekStatusCompactedDetail
    case 'will-compact':
      return words.peekStatusWillCompactDetail
    case 'dropped':
      return words.peekStatusDroppedDetail
    case 'full':
      return ''
  }
}

function ModSection({ items }: { items: ContextPreviewModEntry[] }) {
  return (
    <section className="context-surface__section context-surface__section--mods">
      <h3 className="context-surface__section-title t-micro">{words.peekModifiers}</h3>
      <div className="context-surface__mod-disclosures">
        {items.map((item) => <ModDisclosure item={item} key={item.connectionId} />)}
      </div>
    </section>
  )
}

function ModDisclosure({ item }: { item: ContextPreviewModEntry }) {
  const [expanded, setExpanded] = useState(false)
  const bodyId = useId()

  return (
    <div className="context-surface__mod-disclosure" data-expanded={expanded || undefined}>
      <Chip
        tone="mod"
        interactive
        expanded={expanded}
        controls={bodyId}
        onClick={() => setExpanded((visible) => !visible)}
      >
        {item.label || words.addMod}
        <ChevronDown className="context-surface__mod-chevron" aria-hidden="true" />
      </Chip>
      {expanded && (
        <div className="context-surface__mod-body" id={bodyId}>
          <div className="context-surface__mod-meta t-micro">
            <span>{words.peekHop} {item.hop}</span>
            <span>{words.peekConnection} {item.connectionLabel}</span>
          </div>
          <MarkdownPreview
            className="context-surface__mod-projection"
            text={item.markdown}
            emptyText={words.peekNoText}
          />
        </div>
      )}
    </div>
  )
}
