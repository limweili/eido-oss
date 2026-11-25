import { createContext, type RefObject } from 'react'

export type OverlayDismissReason = 'escape' | 'backdrop' | 'close-button'

export type OverlayRegistration = Readonly<{
  id: symbol
  modal: boolean
  dismissOnEscape: boolean
  interactive: boolean
  scopeRef: RefObject<HTMLElement | null>
  surfaceRef: RefObject<HTMLElement | null>
  returnFocus: HTMLElement | null
  dismiss: (reason: OverlayDismissReason) => void
}>

export type OverlayContextValue = Readonly<{
  overlayRoot: HTMLElement | null
  stack: readonly symbol[]
  register: (registration: OverlayRegistration) => () => void
}>

export const OverlayContext = createContext<OverlayContextValue | null>(null)
