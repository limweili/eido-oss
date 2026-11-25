export type AnimationFrameScheduler = Readonly<{
  request: (callback: FrameRequestCallback) => number
  cancel: (handle: number) => void
}>

export const browserAnimationFrames: AnimationFrameScheduler = {
  request: (callback) => window.requestAnimationFrame(callback),
  cancel: (handle) => window.cancelAnimationFrame(handle),
}

export type PointerGestureCancelReason =
  | 'pointer-cancel'
  | 'lost-pointer-capture'
  | 'window-blur'
  | 'visibility-hidden'
  | 'callback-error'
  | 'disabled'
  | 'dispose'

export type PointerGestureOptions<Session> = Readonly<{
  scheduler?: AnimationFrameScheduler
  isEnabled: () => boolean
  start: (event: PointerEvent) => Session | null | undefined
  frame: (session: Session, event: PointerEvent) => void
  complete: (session: Session, event: PointerEvent) => void
  cancel?: (session: Session, reason: PointerGestureCancelReason) => void
}>

export type PointerGestureController = Readonly<{
  readonly active: boolean
  cancel: (reason?: PointerGestureCancelReason) => void
  dispose: () => void
}>

type ActivePointer<Session> = {
  pointerId: number
  session: Session
  queued: PointerEvent | null
  frameHandle: number | null
  hasCapture: boolean
}

function claimPointer(event: PointerEvent): void {
  event.preventDefault()
  event.stopPropagation()
}

export function mountPointerGesture<Session>(
  element: HTMLElement,
  options: PointerGestureOptions<Session>,
): PointerGestureController {
  const scheduler = options.scheduler ?? browserAnimationFrames
  let active: ActivePointer<Session> | null = null
  let disposed = false

  const removeTerminalListeners = () => {
    window.removeEventListener('blur', onWindowBlur)
    document.removeEventListener('visibilitychange', onVisibilityChange)
  }

  const releaseCapture = (pointer: ActivePointer<Session>) => {
    if (!pointer.hasCapture) return
    pointer.hasCapture = false
    try {
      element.releasePointerCapture(pointer.pointerId)
    } catch {
      // Capture can already be gone after a platform-level cancellation.
    }
  }

  const retire = (pointer: ActivePointer<Session>) => {
    if (pointer.frameHandle !== null) scheduler.cancel(pointer.frameHandle)
    pointer.frameHandle = null
    pointer.queued = null
    if (active === pointer) active = null
    removeTerminalListeners()
    releaseCapture(pointer)
  }

  const cancelActive = (reason: PointerGestureCancelReason, event?: PointerEvent) => {
    const pointer = active
    if (!pointer) return
    if (event && event.pointerId !== pointer.pointerId) return
    if (event) claimPointer(event)
    retire(pointer)
    options.cancel?.(pointer.session, reason)
  }

  function onWindowBlur() {
    cancelActive('window-blur')
  }

  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') cancelActive('visibility-hidden')
  }

  const flushFrame = () => {
    const pointer = active
    if (!pointer) return
    pointer.frameHandle = null
    const event = pointer.queued
    pointer.queued = null
    if (!event) return
    try {
      options.frame(pointer.session, event)
    } catch (error) {
      retire(pointer)
      options.cancel?.(pointer.session, 'callback-error')
      throw error
    }
  }

  const onPointerDown = (event: PointerEvent) => {
    if (disposed || active || event.button !== 0 || !options.isEnabled()) return
    claimPointer(event)
    const session = options.start(event)
    if (session == null) return
    const pointer: ActivePointer<Session> = {
      pointerId: event.pointerId,
      session,
      queued: null,
      frameHandle: null,
      hasCapture: false,
    }
    active = pointer
    try {
      element.setPointerCapture(event.pointerId)
      pointer.hasCapture = true
    } catch {
      // The remaining terminal hooks still guarantee cleanup in constrained hosts.
    }
    window.addEventListener('blur', onWindowBlur)
    document.addEventListener('visibilitychange', onVisibilityChange)
  }

  const onPointerMove = (event: PointerEvent) => {
    const pointer = active
    if (!pointer || event.pointerId !== pointer.pointerId) return
    claimPointer(event)
    pointer.queued = event
    if (pointer.frameHandle === null) pointer.frameHandle = scheduler.request(flushFrame)
  }

  const onPointerUp = (event: PointerEvent) => {
    const pointer = active
    if (!pointer || event.pointerId !== pointer.pointerId) return
    claimPointer(event)
    if (pointer.frameHandle !== null) scheduler.cancel(pointer.frameHandle)
    pointer.frameHandle = null
    pointer.queued = null
    // The release coordinate is authoritative even when no final move event fired.
    try {
      options.frame(pointer.session, event)
    } catch (error) {
      retire(pointer)
      options.cancel?.(pointer.session, 'callback-error')
      throw error
    }
    retire(pointer)
    options.complete(pointer.session, event)
  }

  const onPointerCancel = (event: PointerEvent) => {
    cancelActive('pointer-cancel', event)
  }

  const onLostPointerCapture = (event: PointerEvent) => {
    const pointer = active
    if (!pointer || event.pointerId !== pointer.pointerId) return
    pointer.hasCapture = false
    cancelActive('lost-pointer-capture', event)
  }

  element.addEventListener('pointerdown', onPointerDown)
  element.addEventListener('pointermove', onPointerMove)
  element.addEventListener('pointerup', onPointerUp)
  element.addEventListener('pointercancel', onPointerCancel)
  element.addEventListener('lostpointercapture', onLostPointerCapture)

  return {
    get active() {
      return active !== null
    },
    cancel(reason = 'disabled') {
      cancelActive(reason)
    },
    dispose() {
      if (disposed) return
      cancelActive('dispose')
      disposed = true
      element.removeEventListener('pointerdown', onPointerDown)
      element.removeEventListener('pointermove', onPointerMove)
      element.removeEventListener('pointerup', onPointerUp)
      element.removeEventListener('pointercancel', onPointerCancel)
      element.removeEventListener('lostpointercapture', onLostPointerCapture)
      removeTerminalListeners()
    },
  }
}
