import {
  useContext,
  useLayoutEffect,
  useRef,
  type PointerEvent,
  type RefObject,
} from 'react'
import { OverlayContext, type OverlayDismissReason } from './context'
import { FOCUSABLE_SELECTOR } from './focusability'

export type UseOverlayContractOptions = Readonly<{
  active?: boolean
  interactive?: boolean
  modal?: boolean
  dismissOnEscape?: boolean
  dismissOnBackdrop: boolean
  initialFocusRef?: RefObject<HTMLElement | null>
  returnFocusRef?: RefObject<HTMLElement | null>
  onDismiss: (reason: OverlayDismissReason) => void
}>

export function useOverlayContract({
  active = true,
  interactive = true,
  modal = true,
  dismissOnEscape = true,
  dismissOnBackdrop,
  initialFocusRef,
  returnFocusRef,
  onDismiss,
}: UseOverlayContractOptions) {
  const context = useContext(OverlayContext)
  if (!context) throw new Error('useOverlayContract must be used inside OverlayProvider')

  const idRef = useRef(Symbol('eido-overlay'))
  const scopeRef = useRef<HTMLElement | null>(null)
  const surfaceRef = useRef<HTMLElement | null>(null)
  const onDismissRef = useRef(onDismiss)
  const returnFocusElementRef = useRef<HTMLElement | null>(null)
  const returnFocusCapturedRef = useRef(false)
  const initialFocusAppliedRef = useRef(false)
  onDismissRef.current = onDismiss

  useLayoutEffect(() => {
    if (!context.overlayRoot || !active) return
    if (!returnFocusCapturedRef.current) {
      returnFocusCapturedRef.current = true
      returnFocusElementRef.current =
        returnFocusRef?.current
        ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null)
    }
    return context.register({
      id: idRef.current,
      modal,
      dismissOnEscape,
      interactive,
      scopeRef,
      surfaceRef,
      returnFocus: returnFocusElementRef.current,
      dismiss: reason => onDismissRef.current(reason),
    })
  }, [
    active,
    context.overlayRoot,
    context.register,
    dismissOnEscape,
    interactive,
    modal,
    returnFocusRef,
  ])

  useLayoutEffect(() => {
    if (
      !active
      || !interactive
      || !context.overlayRoot
      || initialFocusAppliedRef.current
    ) return
    const surface = surfaceRef.current
    if (!surface) return
    initialFocusAppliedRef.current = true
    const target =
      initialFocusRef?.current
      ?? surface.querySelector<HTMLElement>(FOCUSABLE_SELECTOR)
      ?? surface
    target.focus()
  }, [active, context.overlayRoot, initialFocusRef, interactive])

  useLayoutEffect(() => {
    if (active) return
    initialFocusAppliedRef.current = false
    returnFocusCapturedRef.current = false
    returnFocusElementRef.current = null
  }, [active])

  const registered = context.stack.includes(idRef.current)
  const isTopmost =
    !registered || context.stack[context.stack.length - 1] === idRef.current

  const onBackdropPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.target !== event.currentTarget || !isTopmost) return
    event.preventDefault()
    if (dismissOnBackdrop) onDismissRef.current('backdrop')
  }

  return {
    overlayRoot: context.overlayRoot,
    scopeRef,
    surfaceRef,
    isTopmost,
    onBackdropPointerDown,
  } as const
}
