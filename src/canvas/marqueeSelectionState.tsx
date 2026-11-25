import {
  createContext,
  useCallback,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from 'react'

type Listener = () => void
type ListenerMap = Map<string, Set<Listener>>

const notifyChanged = (
  listeners: ListenerMap,
  previous: ReadonlySet<string>,
  next: ReadonlySet<string>,
) => {
  for (const id of previous) {
    if (!next.has(id)) listeners.get(id)?.forEach((listener) => listener())
  }
  for (const id of next) {
    if (!previous.has(id)) listeners.get(id)?.forEach((listener) => listener())
  }
}

const subscribeToId = (listeners: ListenerMap, id: string, listener: Listener) => {
  const idListeners = listeners.get(id) ?? new Set<Listener>()
  idListeners.add(listener)
  listeners.set(id, idListeners)
  return () => {
    idListeners.delete(listener)
    if (!idListeners.size) listeners.delete(id)
  }
}

const notifyIds = (listeners: ListenerMap, ids: ReadonlySet<string>) => {
  for (const id of ids) listeners.get(id)?.forEach((listener) => listener())
}

export type MarqueeSelectionState = ReturnType<typeof createMarqueeSelectionState>

// A gesture-local selection channel. It never rebuilds React Flow's controlled
// nodes: only the card/connection components whose membership changes are
// notified, and each component renders its ordinary selected state directly.
export function createMarqueeSelectionState() {
  let active = false
  let cardIds: ReadonlySet<string> = new Set()
  let connectionIds: ReadonlySet<string> = new Set()
  let affectedCardIds = new Set<string>()
  let affectedConnectionIds = new Set<string>()
  const cardListeners: ListenerMap = new Map()
  const connectionListeners: ListenerMap = new Map()
  const cardSetListeners = new Set<Listener>()

  const notifyCardSet = () => {
    cardSetListeners.forEach((listener) => listener())
  }

  return {
    isActive() {
      return active
    },
    activate(previousCardIds: ReadonlySet<string>, previousConnectionIds: ReadonlySet<string>) {
      const empty = new Set<string>()
      active = true
      cardIds = empty
      connectionIds = empty
      affectedCardIds = new Set(previousCardIds)
      affectedConnectionIds = new Set(previousConnectionIds)
      notifyChanged(cardListeners, previousCardIds, empty)
      notifyChanged(connectionListeners, previousConnectionIds, empty)
      notifyCardSet()
    },
    setCards(next: ReadonlySet<string>) {
      if (!active) return
      const previous = cardIds
      cardIds = next
      for (const id of previous) affectedCardIds.add(id)
      for (const id of next) affectedCardIds.add(id)
      notifyChanged(cardListeners, previous, next)
      notifyCardSet()
    },
    setConnections(next: ReadonlySet<string>) {
      if (!active) return
      const previous = connectionIds
      connectionIds = next
      for (const id of previous) affectedConnectionIds.add(id)
      for (const id of next) affectedConnectionIds.add(id)
      notifyChanged(connectionListeners, previous, next)
    },
    deactivate() {
      if (!active) return
      active = false
      cardIds = new Set()
      connectionIds = new Set()
      // The controlled selection is committed before deactivation. Notify only
      // ids whose effective value could have changed, including the selection
      // hidden at gesture start so a cancelled drag restores it immediately.
      notifyIds(cardListeners, affectedCardIds)
      notifyIds(connectionListeners, affectedConnectionIds)
      affectedCardIds = new Set()
      affectedConnectionIds = new Set()
      notifyCardSet()
    },
    effectiveCardIds(committed: ReadonlySet<string>) {
      return active ? cardIds : committed
    },
    subscribeCards(listener: Listener) {
      cardSetListeners.add(listener)
      return () => {
        cardSetListeners.delete(listener)
      }
    },
    cardSelected(id: string, committed: boolean) {
      return active ? cardIds.has(id) : committed
    },
    connectionSelected(id: string, committed: boolean) {
      return active ? connectionIds.has(id) : committed
    },
    subscribeCard(id: string, listener: Listener) {
      return subscribeToId(cardListeners, id, listener)
    },
    subscribeConnection(id: string, listener: Listener) {
      return subscribeToId(connectionListeners, id, listener)
    },
  }
}

const MarqueeSelectionContext = createContext<MarqueeSelectionState | null>(null)

export function MarqueeSelectionProvider({
  state,
  children,
}: {
  state: MarqueeSelectionState
  children: ReactNode
}) {
  return <MarqueeSelectionContext.Provider value={state}>{children}</MarqueeSelectionContext.Provider>
}

export function useEffectiveMarqueeCardSelection(id: string, committed: boolean) {
  const state = useContext(MarqueeSelectionContext)
  const subscribe = useCallback(
    (listener: Listener) => state?.subscribeCard(id, listener) ?? (() => undefined),
    [id, state],
  )
  const snapshot = useCallback(() => state?.cardSelected(id, committed) ?? committed, [committed, id, state])
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}

export function useEffectiveMarqueeConnectionSelection(id: string, committed: boolean) {
  const state = useContext(MarqueeSelectionContext)
  const subscribe = useCallback(
    (listener: Listener) => state?.subscribeConnection(id, listener) ?? (() => undefined),
    [id, state],
  )
  const snapshot = useCallback(
    () => state?.connectionSelected(id, committed) ?? committed,
    [committed, id, state],
  )
  return useSyncExternalStore(subscribe, snapshot, snapshot)
}
