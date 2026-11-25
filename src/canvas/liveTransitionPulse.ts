/**
 * Owns the lifetime of the Live-transition presentation marker.
 *
 * The CSS pulse has a one-second cycle. Clearing its marker from the same
 * post-commit task that discovers editor readiness can make it invisible, so
 * the marker stays present through the first half-cycle when a transition is
 * fast. This gates only marker retirement: mounting, focus, selection, and
 * editor readiness remain immediate.
 */

export type LiveTransitionPulseScheduler = Readonly<{
  now: () => number
  requestFrame: (callback: () => void) => number
  cancelFrame: (handle: number) => void
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (handle: number) => void
}>

/** Half of the sanctioned one-second `pulse` animation cycle. */
export const LIVE_TRANSITION_PULSE_MIN_VISIBLE_MS = 500

export type LiveTransitionPulseController = Readonly<{
  /** Call immediately before publishing the loading marker. */
  begin: (cardId: string) => void
  /** Call whenever the target surface is ready; retirement is idempotent. */
  release: (cardId: string, onClear: () => void) => void
  /** Cancel a stale or abandoned transition. */
  cancel: (cardId: string) => void
  /** Cancel every pending transition, normally from effect teardown. */
  dispose: () => void
}>

type PendingRelease = {
  startedAt: number
  timer: number | null
  frame: number | null
  onClear: () => void
}

export function createLiveTransitionPulseController(
  scheduler: LiveTransitionPulseScheduler,
  minVisibleMs = LIVE_TRANSITION_PULSE_MIN_VISIBLE_MS,
): LiveTransitionPulseController {
  const minimumVisibleMs = Math.max(0, minVisibleMs)
  const pending = new Map<string, PendingRelease>()

  const cancelScheduledWork = (release: PendingRelease) => {
    if (release.timer !== null) scheduler.clearTimeout(release.timer)
    if (release.frame !== null) scheduler.cancelFrame(release.frame)
    release.timer = null
    release.frame = null
  }

  const cancel = (cardId: string) => {
    const release = pending.get(cardId)
    if (!release) return
    cancelScheduledWork(release)
    pending.delete(cardId)
  }

  const begin = (cardId: string) => {
    const current = pending.get(cardId)
    // A second begin while the same transition is still loading is a true
    // no-op. A genuinely new activation must cancel first, then begin again;
    // that explicit boundary prevents duplicate events from extending the
    // minimum visible interval indefinitely.
    if (current) return
    pending.set(cardId, {
      startedAt: scheduler.now(),
      timer: null,
      frame: null,
      onClear: () => undefined,
    })
  }

  const release = (cardId: string, onClear: () => void) => {
    const current = pending.get(cardId)
    const transition = current ?? {
      startedAt: scheduler.now(),
      timer: null,
      frame: null,
      onClear,
    }
    transition.onClear = onClear
    if (!current) pending.set(cardId, transition)
    // MutationObserver/readiness callbacks can report the same ready state
    // repeatedly. Keep one timer/frame chain per card.
    if (transition.timer !== null || transition.frame !== null) return

    const retireOnNextFrame = () => {
      transition.frame = scheduler.requestFrame(() => {
        transition.frame = null
        if (pending.get(cardId) !== transition) return
        pending.delete(cardId)
        transition.onClear()
      })
    }
    const remainingMs = minimumVisibleMs - (scheduler.now() - transition.startedAt)
    if (remainingMs <= 0) {
      retireOnNextFrame()
      return
    }
    transition.timer = scheduler.setTimeout(() => {
      transition.timer = null
      if (pending.get(cardId) !== transition) return
      retireOnNextFrame()
    }, remainingMs)
  }

  const dispose = () => {
    for (const cardId of pending.keys()) cancel(cardId)
  }

  return { begin, release, cancel, dispose }
}
