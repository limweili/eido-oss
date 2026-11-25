import {
  cloneElement,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type HTMLAttributes,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react'
import { createPortal } from 'react-dom'
import { useFloatingLayer, type FloatingDismissReason } from './floating'
import { useFloatingPortalDestination } from './FloatingPortalScope'
import { useExitPresence } from './presence'
import { assignRef, elementRef } from './refs'

function enabledMenuItems(menu: HTMLElement): HTMLElement[] {
  return Array.from(menu.querySelectorAll<HTMLElement>('[role="menuitem"]')).filter(
    item => !item.matches(':disabled') && item.getAttribute('aria-disabled') !== 'true',
  )
}

function moveMenuFocus(menu: HTMLElement, item: HTMLElement): void {
  for (const candidate of menu.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
    candidate.tabIndex = candidate === item ? 0 : -1
  }
  item.focus()
}

const MENU_CONTROL_SELECTOR = [
  'input',
  'textarea',
  'select',
  'button:not([role="menuitem"])',
  '[contenteditable]:not([contenteditable="false"])',
  '[role="textbox"]',
  '[role="combobox"]',
  '[role="radiogroup"]',
  '[role="radio"]',
  '[role="slider"]',
  '[role="spinbutton"]',
].join(',')

function menuOwnsRovingKey(event: KeyboardEvent<HTMLDivElement>): boolean {
  const target = event.target
  if (!(target instanceof Element)) return true
  const control = target.closest<HTMLElement>(MENU_CONTROL_SELECTOR)
  if (!control || !event.currentTarget.contains(control)) return true
  return event.key === 'ArrowDown' && control.dataset.menuRovingHandoff === 'arrow-down'
}

type TriggerProps = {
  ref?: Ref<HTMLElement>
  onClick?: (event: MouseEvent<HTMLElement>) => void
  onPointerDown?: (event: PointerEvent<HTMLElement>) => void
  'aria-expanded'?: boolean
  'aria-controls'?: string
  'aria-haspopup'?: boolean | 'menu' | 'listbox' | 'dialog' | 'grid' | 'tree'
}

export function Popover({
  trigger,
  children,
  open: controlledOpen,
  defaultOpen = false,
  onOpenChange,
  dismissOnTab = true,
  ariaHasPopup = 'menu',
  returnFocusRef,
}: {
  trigger: ReactElement<TriggerProps>
  children: ReactNode
  open?: boolean
  defaultOpen?: boolean
  onOpenChange?: (open: boolean) => void
  dismissOnTab?: boolean
  ariaHasPopup?: TriggerProps['aria-haspopup']
  returnFocusRef?: RefObject<HTMLElement | null>
}) {
  const id = `e-popover-${useId().replace(/:/g, '')}`
  const triggerRef = useRef<HTMLElement | null>(null)
  const layerRef = useRef<HTMLDivElement | null>(null)
  const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen)
  const open = controlledOpen ?? uncontrolledOpen
  const presence = useExitPresence(open)
  const portalDestination = useFloatingPortalDestination()
  const setOpen = (next: boolean) => {
    if (controlledOpen === undefined) setUncontrolledOpen(next)
    onOpenChange?.(next)
  }
  const dismiss = (reason: FloatingDismissReason) => {
    setOpen(false)
    const returnFocusTarget = returnFocusRef?.current ?? triggerRef.current
    if (reason === 'escape' && returnFocusTarget?.isConnected) {
      returnFocusTarget.focus()
    }
  }
  const position = useFloatingLayer({
    open: open && presence.mounted,
    triggerRef,
    layerRef,
    onDismiss: dismiss,
    dismissOnTab,
  })

  useLayoutEffect(() => {
    if (!open || !presence.mounted || presence.state === 'exiting') return
    const menu = layerRef.current?.querySelector<HTMLElement>('[role="menu"]')
    if (!menu || menu.contains(document.activeElement)) return
    const firstItem = enabledMenuItems(menu)[0]
    if (firstItem) moveMenuFocus(menu, firstItem)
  }, [open, presence.mounted, presence.state])

  const originalRef = elementRef<HTMLElement>(trigger)
  const originalClick = trigger.props.onClick
  const originalPointerDown = trigger.props.onPointerDown
  const triggerElement = cloneElement(trigger, {
    ref: (element: HTMLElement | null) => {
      triggerRef.current = element
      assignRef(originalRef, element)
    },
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      originalPointerDown?.(event)
    },
    onClick: (event: MouseEvent<HTMLElement>) => {
      originalClick?.(event)
      if (!event.defaultPrevented) setOpen(!open)
    },
    'aria-expanded': open,
    'aria-controls': id,
    'aria-haspopup': ariaHasPopup,
  })

  return (
    <>
      {triggerElement}
      {presence.mounted && portalDestination &&
        createPortal(
          <div
            ref={layerRef}
            id={id}
            className="e-popover"
            aria-hidden={presence.state === 'exiting' || undefined}
            {...(presence.state === 'exiting' ? { inert: '' } : {})}
            data-state={presence.state}
            data-side={position?.side ?? 'bottom'}
            onTransitionEnd={presence.onTransitionEnd}
            style={
              position
                ? {
                    left: position.left,
                    top: position.top,
                    minWidth: position.minWidth,
                    maxWidth: position.maxWidth,
                    maxHeight: position.maxHeight,
                  }
                : undefined
            }
          >
            {children}
          </div>,
          portalDestination,
        )}
    </>
  )
}

export function Menu({
  ariaLabel,
  className,
  onKeyDown,
  ...props
}: HTMLAttributes<HTMLDivElement> & { ariaLabel: string }) {
  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    onKeyDown?.(event)
    if (event.defaultPrevented) return
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return
    if (!menuOwnsRovingKey(event)) return

    const items = enabledMenuItems(event.currentTarget)
    if (!items.length) return
    event.preventDefault()
    event.stopPropagation()
    const currentIndex = items.indexOf(document.activeElement as HTMLElement)
    let nextIndex = 0
    if (event.key === 'End') nextIndex = items.length - 1
    if (event.key === 'ArrowDown') {
      nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % items.length
    }
    if (event.key === 'ArrowUp') {
      nextIndex = currentIndex < 0
        ? items.length - 1
        : (currentIndex - 1 + items.length) % items.length
    }
    moveMenuFocus(event.currentTarget, items[nextIndex]!)
  }

  return (
    <div
      role="menu"
      aria-label={ariaLabel}
      className={['e-menu', className].filter(Boolean).join(' ')}
      onKeyDown={handleKeyDown}
      {...props}
    />
  )
}

export function MenuItem({
  danger = false,
  className,
  type = 'button',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { danger?: boolean }) {
  return (
    <button
      role="menuitem"
      type={type}
      tabIndex={props.tabIndex ?? -1}
      className={['e-menu__item', danger && 'e-menu__item--danger', className].filter(Boolean).join(' ')}
      {...props}
    />
  )
}
