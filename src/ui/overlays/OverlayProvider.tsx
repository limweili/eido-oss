import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { OverlayContext, type OverlayRegistration } from './context'
import {
  DialogContextProvider,
  DialogPresenter,
  useDialogQueue,
} from './dialogs'
import { FOCUSABLE_SELECTOR } from './focusability'

function focusableElements(surface: HTMLElement): HTMLElement[] {
  return Array.from(surface.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    element => !element.hidden && element.getAttribute('aria-hidden') !== 'true',
  )
}

function returnFocus(
  target: HTMLElement | null,
  nextTop: OverlayRegistration | undefined,
): void {
  if (!target?.isConnected) return
  const nextScope = nextTop?.scopeRef.current ?? nextTop?.surfaceRef.current
  if (nextScope && !nextScope.contains(target)) return
  target.focus()
}

export function OverlayProvider({ children }: { children: ReactNode }) {
  const dialogQueue = useDialogQueue()
  const [overlayRoot, setOverlayRoot] = useState<HTMLElement | null>(null)
  const [stack, setStack] = useState<symbol[]>([])
  const stackRef = useRef<symbol[]>([])
  const registrationsRef = useRef(new Map<symbol, OverlayRegistration>())
  const removalTicketsRef = useRef(new Map<symbol, symbol>())
  const pendingReturnFocusRef = useRef<HTMLElement | null>(null)
  const providerMountedRef = useRef(false)
  const ownedRootRef = useRef<HTMLElement | null>(null)
  const appRootSnapshotRef = useRef<{
    element: HTMLElement
    inert: boolean
    ariaHidden: string | null
  } | null>(null)

  const replaceStack = useCallback((next: symbol[]) => {
    stackRef.current = next
    setStack(next)
  }, [])

  const register = useCallback((registration: OverlayRegistration) => {
    removalTicketsRef.current.delete(registration.id)
    registrationsRef.current.set(registration.id, registration)
    if (!stackRef.current.includes(registration.id)) {
      replaceStack([...stackRef.current, registration.id])
    }

    return () => {
      const ticket = Symbol('overlay-removal')
      removalTicketsRef.current.set(registration.id, ticket)
      queueMicrotask(() => {
        if (
          !providerMountedRef.current
          || removalTicketsRef.current.get(registration.id) !== ticket
        ) return

        removalTicketsRef.current.delete(registration.id)
        const current = stackRef.current
        const wasTopmost = current[current.length - 1] === registration.id
        const next = current.filter(id => id !== registration.id)
        registrationsRef.current.delete(registration.id)
        if (wasTopmost) pendingReturnFocusRef.current = registration.returnFocus
        replaceStack(next)
      })
    }
  }, [replaceStack])

  useLayoutEffect(() => {
    providerMountedRef.current = true
    let root = document.getElementById('eido-overlay-root')
    if (!root) {
      root = document.createElement('div')
      root.id = 'eido-overlay-root'
      const appRoot = document.getElementById('root')
      if (appRoot?.parentElement) appRoot.after(root)
      else document.body.append(root)
      ownedRootRef.current = root
    }
    setOverlayRoot(root)

    return () => {
      providerMountedRef.current = false
      queueMicrotask(() => {
        if (providerMountedRef.current) return
        dialogQueue.cancelAll(false)
        const ownedRoot = ownedRootRef.current
        if (ownedRoot?.isConnected) ownedRoot.remove()
        ownedRootRef.current = null
      })
    }
  }, [dialogQueue.cancelAll])

  useLayoutEffect(() => {
    const hasModal = stack.some(id => registrationsRef.current.get(id)?.modal)
    if (hasModal && !appRootSnapshotRef.current) {
      const appRoot = document.getElementById('root')
      if (appRoot) {
        appRootSnapshotRef.current = {
          element: appRoot,
          inert: appRoot.hasAttribute('inert'),
          ariaHidden: appRoot.getAttribute('aria-hidden'),
        }
        appRoot.setAttribute('inert', '')
        appRoot.setAttribute('aria-hidden', 'true')
      }
    } else if (!hasModal && appRootSnapshotRef.current) {
      const snapshot = appRootSnapshotRef.current
      if (!snapshot.inert) snapshot.element.removeAttribute('inert')
      if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden')
      else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden)
      appRootSnapshotRef.current = null
    }

    return () => {
      if (providerMountedRef.current || !appRootSnapshotRef.current) return
      const snapshot = appRootSnapshotRef.current
      if (!snapshot.inert) snapshot.element.removeAttribute('inert')
      if (snapshot.ariaHidden === null) snapshot.element.removeAttribute('aria-hidden')
      else snapshot.element.setAttribute('aria-hidden', snapshot.ariaHidden)
      appRootSnapshotRef.current = null
    }
  }, [stack])

  useLayoutEffect(() => {
    const target = pendingReturnFocusRef.current
    if (!target) return
    pendingReturnFocusRef.current = null
    const nextTopId = stack[stack.length - 1]
    const nextTop = nextTopId
      ? registrationsRef.current.get(nextTopId)
      : undefined
    returnFocus(target, nextTop)
  }, [stack])

  useLayoutEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return
      const topId = stackRef.current[stackRef.current.length - 1]
      const top = topId ? registrationsRef.current.get(topId) : undefined
      if (!top) return

      if (!top.interactive) {
        if (event.key === 'Escape' || event.key === 'Tab') {
          event.preventDefault()
          event.stopPropagation()
        }
        return
      }

      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (top.dismissOnEscape) top.dismiss('escape')
        return
      }
      if (event.key !== 'Tab' || !top.modal) return

      const scope = top.scopeRef.current ?? top.surfaceRef.current
      if (!scope) return
      const focusable = focusableElements(scope)
      if (!focusable.length) {
        event.preventDefault()
        top.surfaceRef.current?.focus()
        return
      }
      const first = focusable[0]!
      const last = focusable[focusable.length - 1]!
      const active = document.activeElement
      if (event.shiftKey && (active === first || !scope.contains(active))) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && (active === last || !scope.contains(active))) {
        event.preventDefault()
        first.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const value = useMemo(
    () => ({ overlayRoot, stack, register }),
    [overlayRoot, register, stack],
  )

  return (
    <OverlayContext.Provider value={value}>
      <DialogContextProvider service={dialogQueue.service}>
        {children}
        {dialogQueue.active && (
          <DialogPresenter
            key={dialogQueue.active.id}
            request={dialogQueue.active}
            settle={dialogQueue.settle}
          />
        )}
      </DialogContextProvider>
    </OverlayContext.Provider>
  )
}
