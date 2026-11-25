import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type RefObject,
} from 'react'

export type FloatingDismissReason = 'escape' | 'outside' | 'tab' | 'superseded'

type ActiveFloatingLayer = {
  token: symbol
  dismiss: (reason: FloatingDismissReason) => void
}

const activeFloatingLayers = new Map<HTMLElement, ActiveFloatingLayer>()

function claimFloatingLayer(
  owner: HTMLElement,
  token: symbol,
  dismiss: (reason: FloatingDismissReason) => void,
): void {
  const activeFloatingLayer = activeFloatingLayers.get(owner)
  if (activeFloatingLayer && activeFloatingLayer.token !== token) {
    activeFloatingLayer.dismiss('superseded')
  }
  activeFloatingLayers.set(owner, { token, dismiss })
}

function releaseFloatingLayer(owner: HTMLElement, token: symbol): void {
  if (activeFloatingLayers.get(owner)?.token === token) {
    activeFloatingLayers.delete(owner)
  }
}

function isLayerSuppressed(layer: HTMLElement | null): boolean {
  if (!layer) return false
  if (layer.closest('[inert], [aria-hidden="true"]')) return true

  const topmostModalScope = document.querySelector<HTMLElement>(
    '#eido-overlay-root > .e-overlay-backdrop[data-topmost]',
  )
  return Boolean(topmostModalScope && !topmostModalScope.contains(layer))
}

function tokenPixels(name: string): number {
  if (typeof window === 'undefined') return 0
  return Number.parseFloat(
    window.getComputedStyle(document.documentElement).getPropertyValue(name),
  ) || 0
}

export type FloatingPosition = Readonly<{
  left: number
  top: number
  minWidth: number
  maxWidth: number
  maxHeight: number
  side: 'top' | 'bottom'
}>

type FloatingLayerOptions = {
  open: boolean
  triggerRef: RefObject<HTMLElement | null>
  layerRef: RefObject<HTMLElement | null>
  onDismiss: (reason: FloatingDismissReason) => void
  dismissOnTab?: boolean
}

export function useFloatingLayer({
  open,
  triggerRef,
  layerRef,
  onDismiss,
  dismissOnTab = true,
}: FloatingLayerOptions): FloatingPosition | null {
  const tokenRef = useRef(Symbol('eido-floating-layer'))
  const dismissRef = useRef(onDismiss)
  dismissRef.current = onDismiss
  const [position, setPosition] = useState<FloatingPosition | null>(null)

  const reposition = useCallback(() => {
    const trigger = triggerRef.current
    const layer = layerRef.current
    if (!trigger || !layer) return

    const triggerBounds = trigger.getBoundingClientRect()
    const layerBounds = layer.getBoundingClientRect()
    const gap = tokenPixels('--e-sp-1')
    const viewportInset = tokenPixels('--e-sp-2')
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth
    const viewportHeight = document.documentElement.clientHeight || window.innerHeight
    // The top bar is a hard barrier rather than a surface a menu may cover, so
    // the floating world starts at the bar's bottom edge and not at the top of
    // the document. The bar's own height is the single named source for that
    // boundary, which is why this reads a token instead of a local number.
    const boundaryTop = tokenPixels('--e-topbar-height') + viewportInset
    const below = viewportHeight - triggerBounds.bottom - gap - viewportInset
    const above = triggerBounds.top - gap - boundaryTop
    const side = layerBounds.height > below && above > below ? 'top' : 'bottom'
    const maxHeight = Math.max(0, side === 'top' ? above : below)
    const naturalTop =
      side === 'top'
        ? triggerBounds.top - gap - Math.min(layerBounds.height, maxHeight)
        : triggerBounds.bottom + gap
    const top = Math.max(
      boundaryTop,
      Math.min(naturalTop, viewportHeight - viewportInset - Math.min(layerBounds.height, maxHeight)),
    )
    const maxWidth = Math.max(0, viewportWidth - viewportInset * 2)
    const minWidth = Math.min(triggerBounds.width, maxWidth)
    const layerWidth = Math.min(Math.max(layerBounds.width, minWidth), maxWidth)
    const left = Math.max(
      viewportInset,
      Math.min(triggerBounds.left, viewportWidth - viewportInset - layerWidth),
    )

    setPosition({ left, top, minWidth, maxWidth, maxHeight, side })
  }, [layerRef, triggerRef])

  useLayoutEffect(() => {
    if (!open) return

    const token = tokenRef.current
    const dismiss = (reason: FloatingDismissReason) => dismissRef.current(reason)
    const owner = layerRef.current?.parentElement ?? document.body
    claimFloatingLayer(owner, token, dismiss)
    reposition()

    const onPointerDown = (event: PointerEvent) => {
      if (isLayerSuppressed(layerRef.current)) return
      const target = event.target
      if (!(target instanceof Node)) return
      if (triggerRef.current?.contains(target) || layerRef.current?.contains(target)) return
      dismiss('outside')
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (isLayerSuppressed(layerRef.current)) return
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        dismiss('escape')
      } else if (event.key === 'Tab' && dismissOnTab) {
        dismiss('tab')
      }
    }

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('scroll', reposition, true)
    window.addEventListener('resize', reposition)

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(reposition)
    if (triggerRef.current) observer?.observe(triggerRef.current)
    if (layerRef.current) observer?.observe(layerRef.current)

    // A portalled layer does not inherit CSS transforms from its trigger's
    // ancestors. Canvas pan/zoom changes those transforms without scrolling or
    // resizing the trigger, so follow the attributes that move its screen-space
    // geometry and remeasure only when they change.
    const anchorObserver =
      typeof MutationObserver === 'undefined' ? null : new MutationObserver(reposition)
    let currentAncestor: HTMLElement | null = triggerRef.current
    while (currentAncestor) {
      anchorObserver?.observe(currentAncestor, {
        attributes: true,
        attributeFilter: ['class', 'style'],
      })
      currentAncestor = currentAncestor.parentElement
    }

    return () => {
      releaseFloatingLayer(owner, token)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('scroll', reposition, true)
      window.removeEventListener('resize', reposition)
      observer?.disconnect()
      anchorObserver?.disconnect()
    }
  }, [dismissOnTab, layerRef, open, reposition, triggerRef])

  return position
}
