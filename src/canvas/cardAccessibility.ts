import { cardLabel } from '../graph/graphHelpers'
import type { Card } from '../graph/types'
import { cardKindLabels, words } from '../shared/words'

type AccessibilityNameCacheEntry = {
  modTitle: string | undefined
  cardTitle: string | undefined
  plain: string
  selected: string
}

// A geometry replacement is a new Card object but keeps the immutable semantic
// `blocks` array. Keep both accessible-name variants behind that identity so a
// Board move does not even rebuild the short wrapper string around a giant
// body-derived label. Weak keys bound the cache to live semantic content.
const accessibilityNameCache = new WeakMap<Card['blocks'], Map<Card['kind'], AccessibilityNameCacheEntry>>()

export function cardAccessibilityName(card: Card, selected = false): string {
  const byKind = accessibilityNameCache.get(card.blocks) ?? new Map<Card['kind'], AccessibilityNameCacheEntry>()
  accessibilityNameCache.set(card.blocks, byKind)
  const modTitle = card.kind === 'mod' ? card.modV2?.title : undefined
  const cardTitle = card.title
  const cached = byKind.get(card.kind)
  if (cached && cached.modTitle === modTitle && cached.cardTitle === cardTitle) {
    return selected ? cached.selected : cached.plain
  }

  const name = `${cardKindLabels[card.kind]}: ${cardLabel(card)}`
  const entry = {
    modTitle,
    cardTitle,
    plain: name,
    selected: `${name}, ${words.selected}`,
  }
  byKind.set(card.kind, entry)
  return selected ? entry.selected : entry.plain
}

function mountedCardNode(boardRoot: Element, cardId: string): HTMLElement | null {
  const candidates = boardRoot.querySelectorAll<HTMLElement>('.react-flow__node[data-id]')
  for (const candidate of candidates) {
    if (
      candidate.getAttribute('data-id') === cardId &&
      candidate.closest('.board-flow') === boardRoot
    ) return candidate
  }
  return null
}

/**
 * Focuses one exact, keyboard-reachable rich Card without disturbing the
 * current focus when the Card is still outside residency. Gesture proxies are
 * aria-hidden and unfocusable, so they can never satisfy this seam.
 */
export function focusMountedCard(boardRoot: Element, cardId: string): boolean {
  const node = mountedCardNode(boardRoot, cardId)
  if (!node || !node.isConnected || node.tabIndex < 0 || node.getAttribute('aria-hidden') === 'true') {
    return false
  }

  node.focus({ preventScroll: true })
  const activeElement = node.ownerDocument.activeElement
  return activeElement === node || (activeElement instanceof Element && node.contains(activeElement))
}

/**
 * Waits for React Flow to publish the requested Card and make it keyboard
 * reachable. This is a one-request MutationObserver, not polling or a Board
 * scan per frame; cancellation preserves whichever replacement focus the user
 * has chosen in the meantime.
 */
export function focusCardWhenMounted(
  boardRoot: Element,
  cardId: string,
  onFocused: () => void = () => undefined,
): () => void {
  if (focusMountedCard(boardRoot, cardId)) {
    onFocused()
    return () => undefined
  }

  const MutationObserverType = boardRoot.ownerDocument.defaultView?.MutationObserver
  if (!MutationObserverType) return () => undefined
  const focusOrigin = boardRoot.ownerDocument.activeElement

  const observer = new MutationObserverType(() => {
    const activeElement = boardRoot.ownerDocument.activeElement
    const originStillOwnsTheRequest = activeElement === focusOrigin
    const originUnmountedWithoutReplacement =
      focusOrigin instanceof Element &&
      !focusOrigin.isConnected &&
      (activeElement === boardRoot.ownerDocument.body || activeElement === boardRoot.ownerDocument.documentElement)
    if (!originStillOwnsTheRequest && !originUnmountedWithoutReplacement) {
      observer.disconnect()
      return
    }
    if (!focusMountedCard(boardRoot, cardId)) return
    observer.disconnect()
    onFocused()
  })
  observer.observe(boardRoot, {
    attributes: true,
    attributeFilter: ['aria-hidden', 'tabindex'],
    childList: true,
    subtree: true,
  })
  return () => observer.disconnect()
}

/**
 * A removed focused Card can briefly leave the document body as activeElement.
 * Recover only from that orphaned state; never steal focus from another live
 * control the user or browser already chose.
 */
export function recoverOrphanedBoardFocus(boardRoot: Element | null): boolean {
  if (!(boardRoot instanceof HTMLElement) || !boardRoot.isConnected) return false
  const document = boardRoot.ownerDocument
  const activeElement = document.activeElement
  if (
    activeElement &&
    activeElement !== document.body &&
    activeElement !== document.documentElement &&
    activeElement.isConnected
  ) return false

  boardRoot.focus({ preventScroll: true })
  return document.activeElement === boardRoot
}
