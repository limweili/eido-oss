import {
  createContext,
  useContext,
  useState,
  type ReactNode,
} from 'react'

const FloatingPortalDestinationContext = createContext<HTMLElement | null | undefined>(
  undefined,
)

/**
 * Gives floating primitives a DOM destination owned by the surrounding surface.
 * Outside a scope they retain their document-body behavior.
 */
export function FloatingPortalScope({
  className,
  children,
}: {
  className: string
  children: ReactNode
}) {
  const [destination, setDestination] = useState<HTMLDivElement | null>(null)
  return (
    <FloatingPortalDestinationContext.Provider value={destination}>
      {children}
      <div
        ref={setDestination}
        className={className}
        data-eido-floating-destination=""
      />
    </FloatingPortalDestinationContext.Provider>
  )
}

export function useFloatingPortalDestination(): HTMLElement | null {
  const scopedDestination = useContext(FloatingPortalDestinationContext)
  if (scopedDestination !== undefined) return scopedDestination
  return typeof document === 'undefined' ? null : document.body
}
