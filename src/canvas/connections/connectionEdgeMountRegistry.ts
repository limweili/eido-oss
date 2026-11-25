export type ConnectionEdgeMountRegistry = {
  subscribe(listener: () => void): () => void
  getSnapshot(): ReadonlySet<string>
  mount(id: string): void
  unmount(id: string): void
}

// Edge components report their real layout-effect lifetime here. Publishing
// in one microtask coalesces a whole React commit (potentially many edges)
// while still updating the canvas handoff before the browser's next paint.
export function createConnectionEdgeMountRegistry(): ConnectionEdgeMountRegistry {
  const mountedIds = new Set<string>()
  const listeners = new Set<() => void>()
  let snapshot: ReadonlySet<string> = new Set()
  let publishScheduled = false

  const schedulePublish = () => {
    if (publishScheduled) return
    publishScheduled = true
    queueMicrotask(() => {
      publishScheduled = false
      snapshot = new Set(mountedIds)
      for (const listener of listeners) listener()
    })
  }

  return {
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
    mount(id) {
      if (!mountedIds.has(id)) {
        mountedIds.add(id)
        schedulePublish()
      }
    },
    unmount(id) {
      if (mountedIds.delete(id)) schedulePublish()
    },
  }
}
