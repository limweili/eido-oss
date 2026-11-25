import {
  useCallback,
  useLayoutEffect,
  useRef,
  useState,
  type TransitionEvent,
} from 'react'
import { DESIGN_TIMING_MS } from '../tokens'
import { getReducedMotionSnapshot } from '../motion'

export type ExitPresenceState = 'entering' | 'entered' | 'exiting'

const FALLBACK_GRACE_MS = 50

/**
 * Keeps a logically closed primitive in the DOM for its tokenized exit beat.
 * The opacity transition is authoritative. The timer only prevents a stranded
 * hidden layer when CSS completion events are unavailable or interrupted.
 */
export function useExitPresence(visible: boolean) {
  const [mounted, setMounted] = useState(visible)
  const [state, setState] = useState<ExitPresenceState>(
    visible ? 'entering' : 'exiting',
  )
  const fallbackRef = useRef<number | null>(null)
  const enterFrameRef = useRef<number | null>(null)

  const clearFallback = useCallback(() => {
    if (fallbackRef.current !== null) window.clearTimeout(fallbackRef.current)
    fallbackRef.current = null
  }, [])

  const clearEnterFrame = useCallback(() => {
    if (enterFrameRef.current !== null) {
      window.cancelAnimationFrame?.(enterFrameRef.current)
    }
    enterFrameRef.current = null
  }, [])

  useLayoutEffect(() => {
    clearFallback()
    if (visible) {
      if (!mounted) {
        setState('entering')
        setMounted(true)
        return
      }
      if (state === 'exiting') {
        setState('entered')
        return
      }
      if (state === 'entering') {
        if (typeof window.requestAnimationFrame !== 'function') {
          setState('entered')
          return
        }
        enterFrameRef.current = window.requestAnimationFrame(() => {
          enterFrameRef.current = null
          setState(current => current === 'entering' ? 'entered' : current)
        })
        return clearEnterFrame
      }
      return
    }
    clearEnterFrame()
    if (!mounted) return

    if (state !== 'exiting') setState('exiting')
    const reducedMotion = getReducedMotionSnapshot()
    fallbackRef.current = window.setTimeout(
      () => {
        fallbackRef.current = null
        setMounted(false)
      },
      (reducedMotion ? DESIGN_TIMING_MS.reducedFade : DESIGN_TIMING_MS.exit)
        + FALLBACK_GRACE_MS,
    )
    return () => {
      clearFallback()
      clearEnterFrame()
    }
  }, [clearEnterFrame, clearFallback, mounted, state, visible])

  const completeExit = useCallback(() => {
    clearFallback()
    setMounted(false)
  }, [clearFallback])

  const onTransitionEnd = useCallback(
    (event: TransitionEvent<HTMLElement>) => {
      if (
        event.currentTarget !== event.target
        || event.propertyName !== 'opacity'
        || state !== 'exiting'
      ) return
      completeExit()
    },
    [completeExit, state],
  )

  return {
    mounted,
    state,
    onTransitionEnd,
  } as const
}
