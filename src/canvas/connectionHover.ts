export type ConnectionHoverPoint = Readonly<{
  clientX: number
  clientY: number
}>

export type ConnectionHoverTracker = Readonly<{
  move(point: ConnectionHoverPoint): void
  leave(): void
  dispose(): void
}>

/**
 * Pointer-hot connection hover adapter. Raw motion only replaces one pending
 * point; the bounded paint/hit query runs at most once per animation frame,
 * and React hears only target identity transitions.
 */
export function createConnectionHoverTracker({
  hitTest,
  onIdentityChange,
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (handle) => cancelAnimationFrame(handle),
}: {
  hitTest: (point: ConnectionHoverPoint) => string | null
  onIdentityChange: (connectionId: string | null) => void
  requestFrame?: (callback: FrameRequestCallback) => number
  cancelFrame?: (handle: number) => void
}): ConnectionHoverTracker {
  let pendingPoint: ConnectionHoverPoint | null = null
  let frameHandle: number | null = null
  let currentIdentity: string | null = null
  let disposed = false

  const publish = (identity: string | null) => {
    if (identity === currentIdentity) return
    currentIdentity = identity
    onIdentityChange(identity)
  }

  const flush = () => {
    frameHandle = null
    if (disposed) return
    const point = pendingPoint
    pendingPoint = null
    if (!point) return
    publish(hitTest(point))
  }

  return {
    move(point) {
      if (disposed) return
      pendingPoint = point
      if (frameHandle === null) frameHandle = requestFrame(flush)
    },
    leave() {
      if (disposed) return
      pendingPoint = null
      if (frameHandle !== null) {
        cancelFrame(frameHandle)
        frameHandle = null
      }
      publish(null)
    },
    dispose() {
      disposed = true
      pendingPoint = null
      if (frameHandle !== null) cancelFrame(frameHandle)
      frameHandle = null
    },
  }
}
