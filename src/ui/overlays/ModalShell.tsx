import {
  createContext,
  useContext,
  useId,
  useLayoutEffect,
  useRef,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { FloatingPortalScope, IconButton, useExitPresence } from '../primitives'
import { words } from '../../shared/words'
import { type OverlayDismissReason } from './context'
import { useOverlayContract } from './useOverlayContract'

export type ModalBackdropTone = 'standard' | 'deep'

// Most modals want the shell's own header band. A modal that arranges its own
// title and close control (Settings puts them in its two columns) asks for
// 'none' and reads the pieces it must honour from this context: the id the
// dialog is named by, and the one call that closes it.
export type ModalChrome = Readonly<{
  titleId: string
  title: string
  closeLabel: string
  requestClose: () => void
}>

const ModalChromeContext = createContext<ModalChrome | null>(null)

export function useModalChrome(): ModalChrome {
  const chrome = useContext(ModalChromeContext)
  if (!chrome) throw new Error('useModalChrome must be used inside a ModalShell')
  return chrome
}

export type ModalShellProps = Readonly<{
  open: boolean
  title: string
  titleMeta?: ReactNode
  subtitle?: ReactNode
  children: ReactNode
  footer?: ReactNode
  dismissOnBackdrop: boolean
  backdropTone?: ModalBackdropTone
  initialFocusRef?: RefObject<HTMLElement | null>
  // A modal that opens on its own, with no click behind it, has no business
  // ringing one of its controls. 'surface' parks the opening focus on the
  // dialog itself: the trap and Escape still hold, but nothing looks chosen.
  initialFocus?: 'first-control' | 'surface'
  returnFocusRef?: RefObject<HTMLElement | null>
  closeLabel?: string
  // 'none' retires the shell header; the body must then render the element
  // carrying the chrome's titleId and its own close control.
  chrome?: 'header' | 'none'
  className?: string
  onDismiss: (reason: OverlayDismissReason) => void
  onExitComplete?: () => void
}>

export function ModalShell({
  open,
  title,
  titleMeta,
  subtitle,
  children,
  footer,
  dismissOnBackdrop,
  backdropTone = 'standard',
  initialFocusRef,
  initialFocus = 'first-control',
  returnFocusRef,
  closeLabel = words.close,
  chrome = 'header',
  className,
  onDismiss,
  onExitComplete,
}: ModalShellProps) {
  const titleId = `eido-modal-${useId().replace(/:/g, '')}`
  const subtitleId = `${titleId}-subtitle`
  const presence = useExitPresence(open)
  const exitCompleteRef = useRef(onExitComplete)
  const hadMountedPresenceRef = useRef(presence.mounted)
  exitCompleteRef.current = onExitComplete
  const interactive = open && presence.state !== 'exiting'
  const requestDismiss = (reason: OverlayDismissReason) => {
    if (interactive) onDismiss(reason)
  }
  const surfaceFocusRef = useRef<HTMLElement | null>(null)
  const contract = useOverlayContract({
    active: presence.mounted,
    interactive,
    dismissOnBackdrop,
    initialFocusRef: initialFocusRef ?? (initialFocus === 'surface' ? surfaceFocusRef : undefined),
    returnFocusRef,
    onDismiss: requestDismiss,
  })

  useLayoutEffect(() => {
    if (presence.mounted) {
      hadMountedPresenceRef.current = true
      return
    }
    if (!open && hadMountedPresenceRef.current) {
      hadMountedPresenceRef.current = false
      exitCompleteRef.current?.()
    }
  }, [open, presence.mounted])

  const containPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.stopPropagation()
    contract.onBackdropPointerDown(event)
  }
  const containPortalEvent = (
    event: MouseEvent<HTMLDivElement> | PointerEvent<HTMLDivElement>,
  ) => event.stopPropagation()

  const chromeValue: ModalChrome = {
    titleId,
    title,
    closeLabel,
    requestClose: () => requestDismiss('close-button'),
  }

  if (!contract.overlayRoot || !presence.mounted) return null
  const hidden = !contract.isTopmost || !interactive
  return createPortal(
    <div
      ref={(element) => { contract.scopeRef.current = element }}
      className="e-overlay-backdrop"
      data-backdrop-tone={backdropTone}
      data-topmost={contract.isTopmost || undefined}
      data-state={presence.state}
      aria-hidden={hidden || undefined}
      {...(hidden ? { inert: '' } : {})}
      onPointerDown={containPointerDown}
      onPointerUp={containPortalEvent}
      onClick={containPortalEvent}
      onTransitionEnd={presence.onTransitionEnd}
    >
      <FloatingPortalScope className="e-modal-floating-layer">
        <section
          ref={(element) => {
            contract.surfaceRef.current = element
            surfaceFocusRef.current = element
          }}
          className={['e-modal-shell', className].filter(Boolean).join(' ')}
          data-state={presence.state}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={subtitle ? subtitleId : undefined}
          tabIndex={-1}
        >
          {chrome === 'header' && (
            <header className="e-modal-shell__header">
              <div className="e-modal-shell__titles">
                <div className="e-modal-shell__title-line">
                  <h2 id={titleId} className="t-display">{title}</h2>
                  {titleMeta && <div className="e-modal-shell__title-meta">{titleMeta}</div>}
                </div>
                {subtitle && <div id={subtitleId} className="t-hint">{subtitle}</div>}
              </div>
              <IconButton
                variant="ghost"
                label={closeLabel}
                icon={<X aria-hidden="true" />}
                onClick={() => requestDismiss('close-button')}
              />
            </header>
          )}
          <div className="e-modal-shell__body">
            <ModalChromeContext.Provider value={chromeValue}>{children}</ModalChromeContext.Provider>
          </div>
          {footer && <footer className="e-modal-shell__footer">{footer}</footer>}
        </section>
      </FloatingPortalScope>
    </div>,
    contract.overlayRoot,
  )
}
