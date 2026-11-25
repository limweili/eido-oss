import { useLayoutEffect, useSyncExternalStore } from 'react'
import { flushSync } from 'react-dom'
import { createMediaQueryStore } from './mediaQueryStore'

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)'

const reducedMotion = createMediaQueryStore(REDUCED_MOTION_QUERY)

export function getReducedMotionSnapshot(): boolean {
  return reducedMotion.getSnapshot()
}

const getFullMotionSnapshot = () => false

export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    reducedMotion.subscribe,
    getReducedMotionSnapshot,
    getFullMotionSnapshot,
  )
}

export function useAppliedReducedMotion(): boolean {
  const reducedMotion = useReducedMotion()
  useLayoutEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.dataset.reducedMotion = String(reducedMotion)
    }
  }, [reducedMotion])
  return reducedMotion
}

export function cameraDuration(duration: number, reducedMotion: boolean): number {
  return reducedMotion ? 0 : duration
}

export function commitCameraTransition(
  command: () => void,
  reducedMotion: boolean,
  commitRenderedJump?: () => void,
): void {
  if (reducedMotion) {
    flushSync(command)
    commitRenderedJump?.()
    return
  }
  command()
}
