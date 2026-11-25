import {
  Children,
  cloneElement,
  isValidElement,
  useId,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
} from 'react'
import { createPortal } from 'react-dom'
import { DESIGN_TIMING_MS } from '../tokens'
import { useExitPresence } from './presence'
import { assignRef, elementRef } from './refs'
import { useFloatingPortalDestination } from './FloatingPortalScope'

type TooltipChildProps = {
  title?: string
  'aria-describedby'?: string
  onPointerEnter?: (event: PointerEvent<HTMLElement>) => void
  onPointerLeave?: (event: PointerEvent<HTMLElement>) => void
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void
  onKeyDown?: (event: ReactKeyboardEvent<HTMLElement>) => void
  onFocus?: (event: FocusEvent<HTMLElement>) => void
  onBlur?: (event: FocusEvent<HTMLElement>) => void
  ref?: Ref<HTMLElement>
}

type TooltipPosition = {
  left: number
  top: number
  side: 'above' | 'below'
}

export function Tooltip({
  content,
  children,
  className,
  open,
}: {
  content: ReactNode
  children: ReactElement
  className?: string
  open?: boolean
}) {
  const onlyChild = Children.only(children)
  if (!isValidElement<TooltipChildProps>(onlyChild)) {
    throw new Error('Tooltip requires one interactive element')
  }

  const tooltipId = `e-tooltip-${useId().replace(/:/g, '')}`
  const triggerRef = useRef<HTMLElement | null>(null)
  const tooltipRef = useRef<HTMLSpanElement | null>(null)
  const timerRef = useRef<number | null>(null)
  const keyboardIntentRef = useRef(false)
  const pointerFocusRef = useRef(false)
  const [visible, setVisible] = useState(false)
  const [position, setPosition] = useState<TooltipPosition | null>(null)
  const displayed = open || visible
  const presence = useExitPresence(displayed)
  const portalDestination = useFloatingPortalDestination()

  const cancelIntent = () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = null
  }
  const showAfterIntent = () => {
    cancelIntent()
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      setVisible(true)
    }, DESIGN_TIMING_MS.intent)
  }
  const hide = () => {
    cancelIntent()
    setVisible(false)
  }

  useEffect(() => () => {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
  }, [])

  useEffect(() => {
    const onDocumentKeyDown = () => {
      keyboardIntentRef.current = true
      pointerFocusRef.current = false
    }
    const onDocumentPointerDown = () => {
      keyboardIntentRef.current = false
    }
    document.addEventListener('keydown', onDocumentKeyDown, true)
    document.addEventListener('pointerdown', onDocumentPointerDown, true)
    return () => {
      document.removeEventListener('keydown', onDocumentKeyDown, true)
      document.removeEventListener('pointerdown', onDocumentPointerDown, true)
    }
  }, [])

  useLayoutEffect(() => {
    if (!displayed || !triggerRef.current || !tooltipRef.current) return
    const bounds = triggerRef.current.getBoundingClientRect()
    const tooltipBounds = tooltipRef.current.getBoundingClientRect()
    const viewportInset = 8
    const preferredLeft = bounds.left + bounds.width / 2
    const halfWidth = tooltipBounds.width / 2
    const left = Math.max(
      viewportInset + halfWidth,
      Math.min(window.innerWidth - viewportInset - halfWidth, preferredLeft),
    )
    const side = bounds.top - tooltipBounds.height - viewportInset >= viewportInset
      ? 'above'
      : 'below'
    setPosition({
      left,
      top: side === 'above' ? bounds.top : bounds.bottom,
      side,
    })
  }, [content, displayed, portalDestination, presence.mounted])

  // A tooltip is a caps label unless its content is prose, and prose declares
  // itself the way prose does: it ends like a sentence, which a label never
  // has a reason to. The primitive owns the treatment so every caller
  // inherits it, the same way it owns the caps casing; without this, a
  // sentence-length hint (the harness hint, the reach hints of #964) clipped
  // at the nowrap pill's edge and bled past it.
  const isSentence = typeof content === 'string' && /[.!?…]$/.test(content.trim())

  const previousDescription = onlyChild.props['aria-describedby']
  const describedBy = displayed
    ? [previousDescription, tooltipId].filter(Boolean).join(' ')
    : previousDescription

  const child = cloneElement(onlyChild, {
    title: undefined,
    'aria-describedby': describedBy,
    ref: (element: HTMLElement | null) => {
      triggerRef.current = element
      assignRef(elementRef<HTMLElement>(onlyChild), element)
    },
    onPointerEnter: (event: PointerEvent<HTMLElement>) => {
      onlyChild.props.onPointerEnter?.(event)
      showAfterIntent()
    },
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      onlyChild.props.onPointerLeave?.(event)
      hide()
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      onlyChild.props.onPointerDown?.(event)
      pointerFocusRef.current = true
      keyboardIntentRef.current = false
    },
    onKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => {
      onlyChild.props.onKeyDown?.(event)
      keyboardIntentRef.current = true
      pointerFocusRef.current = false
    },
    onFocus: (event: FocusEvent<HTMLElement>) => {
      onlyChild.props.onFocus?.(event)
      if (
        !pointerFocusRef.current &&
        (keyboardIntentRef.current || event.currentTarget.matches(':focus-visible'))
      ) {
        showAfterIntent()
      }
    },
    onBlur: (event: FocusEvent<HTMLElement>) => {
      onlyChild.props.onBlur?.(event)
      pointerFocusRef.current = false
      hide()
    },
  })

  return (
    <>
      {child}
      {presence.mounted && portalDestination &&
        createPortal(
          <span
            ref={tooltipRef}
            id={tooltipId}
            className={['e-tooltip', isSentence && 'e-tooltip--sentence', className ?? '']
              .filter(Boolean)
              .join(' ')}
            role="tooltip"
            aria-hidden={presence.state === 'exiting' || undefined}
            {...(presence.state === 'exiting' ? { inert: '' } : {})}
            data-state={presence.state}
            data-side={position?.side ?? 'above'}
            onTransitionEnd={presence.onTransitionEnd}
            style={position ? { left: position.left, top: position.top } : undefined}
          >
            {content}
          </span>,
          portalDestination,
        )}
    </>
  )
}
