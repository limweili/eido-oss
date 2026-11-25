import type { EditorFocusPoint } from './RichMarkdownEditor'

// React Flow uses the same five-screen-pixel boundary for nodeDragThreshold
// and nodeClickDistance. Editing is a release on the click side of that exact
// boundary, never a second gesture classifier owned by a Card.
const CARD_EDIT_CLICK_DISTANCE_PX = 5
const CARD_EDIT_INTENT_LIFETIME_MS = 1_000

type PendingCardEditIntent = {
  ideaId: string | null
  cardId: string
  focusPoint: EditorFocusPoint
  token: number
}

const listenersByTarget = new Map<string, Set<() => void>>()
let pendingIntent: PendingCardEditIntent | null = null
let nextIntentToken = 0
let clearActivePointerIntent: (() => void) | null = null

function cardEditTargetKey(ideaId: string | null, cardId: string) {
  return JSON.stringify([ideaId, cardId])
}

function publishCardEditIntent(
  ideaId: string | null,
  cardId: string,
  focusPoint: EditorFocusPoint,
) {
  const intent = { ideaId, cardId, focusPoint, token: nextIntentToken += 1 }
  pendingIntent = intent
  for (const listener of listenersByTarget.get(cardEditTargetKey(ideaId, cardId)) ?? []) listener()
  window.setTimeout(() => {
    if (pendingIntent?.token === intent.token) pendingIntent = null
  }, CARD_EDIT_INTENT_LIFETIME_MS)
}

// Canvas-painted safety Cards have no DOM body to receive the pointerdown/up
// pair. The Board calls this only after React Flow's shared five-pixel click
// boundary has resolved the gesture as a click, preserving the same editor
// handoff without inventing a second gesture classifier.
export function publishResolvedCardEditIntent({
  ideaId,
  cardId,
  clientX,
  clientY,
}: {
  ideaId: string | null
  cardId: string
  clientX: number
  clientY: number
}) {
  clearActivePointerIntent?.()
  publishCardEditIntent(ideaId, cardId, { x: clientX, y: clientY })
}

export function consumeCardEditIntent(
  ideaId: string | null,
  cardId: string,
): EditorFocusPoint | undefined {
  if (pendingIntent?.ideaId !== ideaId || pendingIntent.cardId !== cardId) return undefined
  const { focusPoint } = pendingIntent
  pendingIntent = null
  return focusPoint
}

export function subscribeToCardEditIntent(
  ideaId: string | null,
  cardId: string,
  listener: () => void,
) {
  const key = cardEditTargetKey(ideaId, cardId)
  const listeners = listenersByTarget.get(key) ?? new Set<() => void>()
  listeners.add(listener)
  listenersByTarget.set(key, listeners)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) listenersByTarget.delete(key)
  }
}

export function armCardPointerEditIntent({
  ideaId,
  cardId,
  pointerId,
  clientX,
  clientY,
  onClear,
}: {
  ideaId: string | null
  cardId: string
  pointerId: number
  clientX: number
  clientY: number
  onClear?: () => void
}) {
  clearActivePointerIntent?.()
  const clear = () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', clear)
    window.removeEventListener('blur', clear)
    if (clearActivePointerIntent === clear) clearActivePointerIntent = null
    onClear?.()
  }
  const onPointerMove = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    const dx = event.clientX - clientX
    const dy = event.clientY - clientY
    if (dx * dx + dy * dy > CARD_EDIT_CLICK_DISTANCE_PX ** 2) clear()
  }
  const onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== pointerId) return
    clear()
    publishCardEditIntent(ideaId, cardId, { x: event.clientX, y: event.clientY })
  }
  window.addEventListener('pointermove', onPointerMove, { passive: true })
  window.addEventListener('pointerup', onPointerUp)
  window.addEventListener('pointercancel', clear)
  window.addEventListener('blur', clear)
  clearActivePointerIntent = clear
}
