import type { Card } from '../graph/types'
import {
  getImageRenditionResolver,
  imageRenditionMotionIsSettled,
  type ImageRenditionPreload,
  type ImageRenditionResolver,
} from '../shared/imageRenditions'
import { cardImageRenditionPlan } from './cards/cardImageRenditionPolicy'

const EMPTY_IDS = new Set<string>()

export type ImageRenditionIdleScheduler = (work: () => void) => () => void

export type LookAheadImageRenditionPrewarmWindow = {
  scopeId: string | null
  /** Undefined when this scene derivation did not perform the look-ahead query. */
  lookAheadCardIds?: ReadonlySet<string>
  visibleCardIds: ReadonlySet<string>
  cardById: (cardId: string) => Card | undefined
  settled: boolean
}

type RetainedWindow = Omit<LookAheadImageRenditionPrewarmWindow, 'lookAheadCardIds'> & {
  lookAheadCardIds: ReadonlySet<string>
}

function browserIdle(work: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.requestIdleCallback !== 'function') return () => undefined
  let active = true
  const requestId = window.requestIdleCallback(() => {
    if (active) work()
  })
  return () => {
    active = false
    window.cancelIdleCallback?.(requestId)
  }
}

function preloads(windowState: RetainedWindow): ImageRenditionPreload[] {
  const requests: ImageRenditionPreload[] = []
  for (const cardId of windowState.lookAheadCardIds) {
    if (windowState.visibleCardIds.has(cardId)) continue
    const plan = cardImageRenditionPlan(windowState.cardById(cardId)?.assets ?? [])
    for (const asset of plan.previewImages) {
      requests.push({
        asset,
        demand: { ...plan.passiveDemand, visibility: 'preload', settled: true },
      })
    }
  }
  return requests
}

/** Serialises exact scene look-ahead windows into idle resolver batches. */
export function createLookAheadImageRenditionPrewarmCoordinator(
  scheduleIdle = browserIdle,
  getResolver: () => ImageRenditionResolver | null = getImageRenditionResolver,
  isMotionSettled = imageRenditionMotionIsSettled,
) {
  let latest: RetainedWindow | null = null
  let revision = 0
  let cancelIdle: (() => void) | null = null
  let inFlight = false

  const ready = (candidate: RetainedWindow | null) => Boolean(
    candidate?.scopeId && candidate.lookAheadCardIds.size && candidate.settled,
  )

  const scheduleLatest = () => {
    if (inFlight || cancelIdle || !ready(latest)) return
    const scheduledRevision = revision
    cancelIdle = scheduleIdle(() => {
      cancelIdle = null
      const windowState = latest
      if (scheduledRevision !== revision || !ready(windowState) || !isMotionSettled()) return
      const requests = preloads(windowState!)
      const resolver = requests.length ? getResolver() : null
      if (!resolver) return
      inFlight = true
      const finish = () => {
        inFlight = false
        if (scheduledRevision !== revision) scheduleLatest()
      }
      void resolver.preload(requests).then(finish, finish)
    })
  }

  return {
    update: (next: LookAheadImageRenditionPrewarmWindow) => {
      const sameScope = next.scopeId !== null && next.scopeId === latest?.scopeId
      latest = {
        ...next,
        lookAheadCardIds: next.scopeId
          ? next.lookAheadCardIds ?? (sameScope ? latest!.lookAheadCardIds : EMPTY_IDS)
          : EMPTY_IDS,
      }
      revision += 1
      cancelIdle?.()
      cancelIdle = null
      scheduleLatest()
    },
    dispose: () => {
      latest = null
      cancelIdle?.()
      cancelIdle = null
    },
  }
}
