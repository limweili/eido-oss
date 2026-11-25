import { useViewport, ViewportPortal } from '@xyflow/react'
import { Trash2 } from 'lucide-react'
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from 'react'
import { useGraph } from '../../graph/store'
import type {
  Connection,
  ConnectionGroupMode,
  ConnectionPolarity,
  ConnectionStrength,
} from '../../graph/types'
import { words } from '../../shared/words'
import { useOverlayContract } from '../../ui/overlays'
import { Field, FieldLabel, Menu, MenuItem, Segmented } from '../../ui/primitives'
import { pillScaleForZoom } from '../zoomChrome'
import { connectionEditorModel, moveConnectionStrengthByArrow } from './connectionEditor'

const POLARITY_OPTIONS = [
  { value: 'helps', label: `+ ${words.helps}` },
  { value: 'pushesAgainst', label: `− ${words.pushesAgainst}` },
] as const

const GROUP_MODE_OPTIONS = [
  { value: 'full', label: words.groupSharesEverything },
  { value: 'compress', label: words.groupSharesSummary },
] as const

// The connection's one editor, anchored to the midpoint marker in every band.
// Store actions remain the mutation authority; the shared overlay foundation
// owns focus entry, Escape, ordering, and exact focus return.
export function ConnectionPopover({
  connection,
  labelX,
  labelY,
  pillRef,
  returnFocusRef = pillRef,
  onClose,
}: {
  connection: Connection
  labelX: number
  labelY: number
  pillRef: RefObject<HTMLButtonElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  onClose: () => void
}) {
  // The popover lives in flow space (it follows the marker through pan/zoom)
  // but is counter-scaled so it reads at screen size at any zoom.
  const viewport = useViewport()
  const { zoom } = viewport
  const sourceKind = useGraph((s) => s.graph().cardById(connection.from.cardId)?.kind)
  const setStrength = useGraph((s) => s.setConnectionStrength)
  const setPolarity = useGraph((s) => s.setConnectionPolarity)
  const setGroupMode = useGraph((s) => s.setConnectionGroupMode)
  const setReason = useGraph((s) => s.setConnectionReason)
  const deleteConnection = useGraph((s) => s.deleteConnection)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const strengthRefs = useRef<Record<ConnectionStrength, HTMLButtonElement | null>>({
    strong: null,
    weak: null,
  })
  const [reasonDraft, setReasonDraft] = useState(connection.reason ?? '')
  const reasonId = `connection-reason-${useId().replace(/:/g, '')}`
  const overlay = useOverlayContract({
    modal: false,
    dismissOnBackdrop: false,
    returnFocusRef,
    onDismiss: onClose,
  })

  const model = connectionEditorModel(connection, sourceKind)
  const groupMode = connection.meta?.groupMode ?? 'full'

  // The reason commits on Enter and when the editor goes away (close, Escape,
  // click-away, or the remount that follows any other edit) — never on blur,
  // where the mid-click remount would swallow the button press that caused it.
  const pendingReasonRef = useRef<string | null>(null)
  pendingReasonRef.current = model.showReason ? reasonDraft : null
  useEffect(() => {
    return () => {
      if (pendingReasonRef.current !== null) setReason(connection.id, pendingReasonRef.current)
    }
  }, [connection.id, setReason])

  // Click-away is geometric rather than a backdrop because the surface stays
  // in the flow-space portal. Overlay ordering still decides who may dismiss.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!overlay.isTopmost) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (rootRef.current?.contains(target) || pillRef.current?.contains(target)) return
      onClose()
    }
    window.addEventListener('pointerdown', onPointerDown)
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [onClose, overlay.isTopmost, pillRef])

  const commitReason = () => setReason(connection.id, reasonDraft)
  const onStrengthKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (
      !moveConnectionStrengthByArrow({
        current: connection.strength,
        key: event.key,
        targets: strengthRefs.current,
        onSelect: (strength) => setStrength(connection.id, strength),
      })
    ) return
    event.preventDefault()
    event.stopPropagation()
  }
  const anchorOffsetPx = 12 * zoom * pillScaleForZoom(zoom) + 8
  const side = labelY * zoom + viewport.y > window.innerHeight * 0.58 ? 'top' : 'bottom'
  const anchorTranslate =
    side === 'top'
      ? `translate(-50%, calc(-100% - ${anchorOffsetPx}px))`
      : `translate(-50%, ${anchorOffsetPx}px)`

  return (
    <ViewportPortal>
      <div
        ref={(element) => {
          rootRef.current = element
          overlay.scopeRef.current = element
          overlay.surfaceRef.current = element
        }}
        data-connection-id={connection.id}
        data-side={side}
        className="e-popover-surface connection-popover nodrag nopan"
        role="dialog"
        aria-label={words.connectionTitle}
        tabIndex={-1}
        style={{
          position: 'absolute',
          transform: `translate(${labelX}px, ${labelY}px) scale(${1 / zoom}) ${anchorTranslate}`,
          transformOrigin: '0 0',
          pointerEvents: 'all',
        }}
      >
        <div className="popover-title t-micro">{words.connectionTitle}</div>

        {model.showPolarity && (
          <div className="popover-row">
            <Segmented<ConnectionPolarity>
              ariaLabel={words.useAs}
              value={connection.polarity}
              options={POLARITY_OPTIONS}
              onValueChange={(polarity) => setPolarity(connection.id, polarity)}
            />
          </div>
        )}

        {model.showStrength && (
          <div className="popover-row">
            <span className="popover-label t-label">{words.strength}</span>
            <div className="line-swatches" role="radiogroup" aria-label={words.strength}>
              <button
                ref={(element) => {
                  strengthRefs.current.strong = element
                }}
                type="button"
                role="radio"
                aria-checked={connection.strength === 'strong'}
                aria-label={words.strong}
                tabIndex={connection.strength === 'strong' ? 0 : -1}
                className={`line-swatch ${connection.strength === 'strong' ? 'active' : ''}`}
                onClick={() => setStrength(connection.id, 'strong')}
                onKeyDown={onStrengthKeyDown}
              >
                <svg viewBox="0 0 44 8" aria-hidden="true">
                  <path d="M2 4 H42" stroke="currentColor" strokeWidth={3} strokeLinecap="round" fill="none" />
                </svg>
                <span className="t-ui">{words.strong}</span>
              </button>
              <button
                ref={(element) => {
                  strengthRefs.current.weak = element
                }}
                type="button"
                role="radio"
                aria-checked={connection.strength === 'weak'}
                aria-label={words.weak}
                tabIndex={connection.strength === 'weak' ? 0 : -1}
                className={`line-swatch ${connection.strength === 'weak' ? 'active' : ''}`}
                onClick={() => setStrength(connection.id, 'weak')}
                onKeyDown={onStrengthKeyDown}
              >
                <svg viewBox="0 0 44 8" aria-hidden="true">
                  <path
                    d="M2 4 H42"
                    stroke="currentColor"
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    fill="none"
                  />
                </svg>
                <span className="t-ui">{words.weak}</span>
              </button>
            </div>
          </div>
        )}

        {model.showReason && (
          <div className="popover-row">
            <FieldLabel className="popover-label" htmlFor={reasonId}>{words.connectionReason}</FieldLabel>
            <Field
              id={reasonId}
              className="connection-reason"
              type="text"
              value={reasonDraft}
              placeholder={words.connectionReasonPlaceholder}
              aria-label={words.connectionReason}
              onChange={(event) => setReasonDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitReason()
                  event.currentTarget.blur()
                }
              }}
            />
          </div>
        )}

        {model.showGroupMode && (
          <div className="popover-row">
            <span className="popover-label t-label">{words.groupShares}</span>
            <Segmented<ConnectionGroupMode>
              ariaLabel={words.groupShares}
              value={groupMode}
              options={GROUP_MODE_OPTIONS}
              onValueChange={(mode) => setGroupMode(connection.id, mode)}
            />
          </div>
        )}

        {model.isMod && <span className="popover-hint t-hint">{words.modConnectionHint}</span>}

        <Menu ariaLabel={words.connectionTitle} className="connection-actions">
          <MenuItem
            danger
            onClick={() => {
              onClose()
              deleteConnection(connection.id)
            }}
          >
            <Trash2 size={14} strokeWidth={1.9} aria-hidden="true" />
            {words.deleteConnection}
          </MenuItem>
        </Menu>
      </div>
    </ViewportPortal>
  )
}
