import {
  useCallback,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type Ref,
  type RefCallback,
  type RefObject,
} from 'react'
import type { CanvasTool } from '../graph/store'
import type { ResultPlacementContext } from '../graph/resultCardPlacement'
import type { Card } from '../graph/types'
import { recoverOrphanedBoardFocus } from './cardAccessibility'

export type CardActivationTrigger = 'focus' | 'press' | 'click'

export type CardSelectionPaintBarrier = {
  /**
   * Run accepted Live work only after the visual-selection commit has had one
   * complete browser paint opportunity. A newer intent supersedes older work.
   */
  afterPaint: (cardId: string, startLiveWork: () => void) => void
  cancel: () => void
  pendingCardId: () => string | null
}

/**
 * Serialises the visual-selection plane ahead of expensive Live/editor work.
 * The first animation callback is the last pre-paint checkpoint for the
 * selection commit; the nested callback cannot run until the browser has had
 * an opportunity to present that outline. This is deliberately a tiny,
 * injected scheduler so its ordering and stale-intent cancellation remain
 * deterministic without measuring automation latency.
 */
export function createCardSelectionPaintBarrier({
  requestFrame,
  cancelFrame,
}: {
  requestFrame: (callback: FrameRequestCallback) => number
  cancelFrame: (frame: number) => void
}): CardSelectionPaintBarrier {
  let revision = 0
  let frame: number | null = null
  let pending: string | null = null

  const cancel = () => {
    revision += 1
    pending = null
    if (frame !== null) cancelFrame(frame)
    frame = null
  }

  const afterPaint = (cardId: string, startLiveWork: () => void) => {
    cancel()
    const expectedRevision = revision
    pending = cardId
    frame = requestFrame(() => {
      if (revision !== expectedRevision) return
      frame = requestFrame(() => {
        if (revision !== expectedRevision) return
        frame = null
        pending = null
        startLiveWork()
      })
    })
  }

  return {
    afterPaint,
    cancel,
    pendingCardId: () => pending,
  }
}

export function cardIdFromEventTarget(target: EventTarget | null): string | null {
  const element = target as { closest?: (selector: string) => Element | null } | null
  return element?.closest?.('.react-flow__node[data-id]')?.getAttribute('data-id') ?? null
}

export type BoardReleaseSurface =
  | { kind: 'card'; cardId: string }
  | { kind: 'canvas' }
  | { kind: 'blocked' }

const BOARD_RELEASE_CANVAS_PLANE = [
  '.react-flow__pane',
  '.react-flow__viewport',
  '.react-flow__renderer',
  '.board-overview-layer',
  '.react-flow',
].join(', ')

/**
 * Resolve only the first painted pointer owner under a connector release.
 * Controls, popovers, edges, and out-of-board UI stop the search instead of
 * exposing a buried Card to the release-only spatial fallback.
 */
export function boardReleaseSurface(
  elements: readonly Element[],
  boardRoot: HTMLElement,
): BoardReleaseSurface {
  for (const element of elements) {
    if (element === document.documentElement || element === document.body) continue
    const cardNode = element.closest<HTMLElement>('.react-flow__node[data-id]')
    if (cardNode && boardRoot.contains(cardNode)) {
      const cardId = cardNode.dataset.id
      return cardId ? { kind: 'card', cardId } : { kind: 'blocked' }
    }
    if (element.matches(BOARD_RELEASE_CANVAS_PLANE) && boardRoot.contains(element)) {
      return { kind: 'canvas' }
    }
    return { kind: 'blocked' }
  }
  return { kind: 'blocked' }
}

/** The Handle element's border box is the painted disc; its ::after halo is not. */
export function clientPointHitsPaintedHandle(
  element: Element,
  clientX: number,
  clientY: number,
): boolean {
  const rect = element.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return false
  const dx = (clientX - (rect.left + rect.width / 2)) / (rect.width / 2)
  const dy = (clientY - (rect.top + rect.height / 2)) / (rect.height / 2)
  return dx * dx + dy * dy <= 1
}

const CARD_PRESS_INTERACTION_OWNER_SELECTOR = [
  '.nodrag',
  '.nopan',
  '.react-flow__resize-control',
  '.card-resize-layer',
  '.card-resize-handle',
  '.react-flow__handle',
  '.card-connector',
  'a[href]',
  'button:not(.card-title-display)',
  'input',
  'textarea',
  'select',
  '[contenteditable]:not([contenteditable="false"])',
  'audio',
  'video',
  'img',
  'picture',
  'iframe',
  'object',
  'embed',
  'canvas',
  '[role="button"]',
  '[role="link"]',
  '[role="checkbox"]',
  '[role="radio"]',
  '[role="switch"]',
  '[role="slider"]',
  '[role="spinbutton"]',
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="menuitem"]',
  '[role="option"]',
].join(', ')

function isDragCapableCardPressTarget(target: Element, node: Element): boolean {
  if (!node.classList.contains('draggable')) return false
  const card = target.closest('.card')
  if (!card || !node.contains(card)) return false
  const owner = target.closest(CARD_PRESS_INTERACTION_OWNER_SELECTOR)
  // React Flow puts `nopan` on the draggable node wrapper itself. That marks
  // node-drag authority; only a closer descendant owner blocks this press.
  return !owner || owner === node || !node.contains(owner)
}

export function focusedMarkdownEditorForDifferentDragCapablePress({
  target,
  activeElement,
  boardRoot,
  button,
  modified,
}: {
  target: EventTarget | null
  activeElement: Element | null
  boardRoot: Element
  button: number
  modified: boolean
}): HTMLElement | null {
  if (
    button !== 0 ||
    modified ||
    !(target instanceof Element) ||
    !(activeElement instanceof HTMLElement) ||
    !activeElement.matches('.markdown-card-editor-content[contenteditable="true"]')
  ) return null
  const pressedNode = target.closest('.react-flow__node[data-id]')
  if (!pressedNode || !isDragCapableCardPressTarget(target, pressedNode)) return null
  const pressedCardId = cardIdFromEventTarget(target)
  const editorCardId = cardIdFromEventTarget(activeElement)
  if (!pressedCardId || !editorCardId || pressedCardId === editorCardId) return null
  if (!boardRoot.contains(target) || !boardRoot.contains(activeElement)) return null
  return activeElement
}

type FocusedCardClaim = {
  cardId: string
  boardRoot: Element
  node: Element
}

function cardNodeWithinBoard(
  target: EventTarget | null,
  boardRoot: Element | null | undefined,
): Element | null {
  if (
    !boardRoot ||
    typeof Element === 'undefined' ||
    !(target instanceof Element) ||
    !boardRoot.contains(target)
  ) return null
  const node = target.closest('.react-flow__node[data-id]')
  if (!node || !boardRoot.contains(node) || node.closest('.board-flow') !== boardRoot) return null
  return node
}

export function useCardFocusOwnership({
  onFocusOwnershipLost,
}: {
  onFocusOwnershipLost?: (cardId: string) => void
} = {}) {
  const [focusedCardId, setFocusedCardId] = useState<string | null>(null)
  const focusedCardClaimRef = useRef<FocusedCardClaim | null>(null)
  const onFocusOwnershipLostRef = useRef(onFocusOwnershipLost)
  useLayoutEffect(() => {
    onFocusOwnershipLostRef.current = onFocusOwnershipLost
  }, [onFocusOwnershipLost])

  const clearFocusedClaim = useCallback((claim: FocusedCardClaim, recoverOrphaned = false) => {
    if (focusedCardClaimRef.current !== claim) return false
    focusedCardClaimRef.current = null
    setFocusedCardId(null)
    onFocusOwnershipLostRef.current?.(claim.cardId)
    if (recoverOrphaned) recoverOrphanedBoardFocus(claim.boardRoot)
    return true
  }, [])

  const claimFocusedCard = useCallback((
    target: EventTarget | null,
    boardRoot: Element,
  ) => {
    const node = cardNodeWithinBoard(target, boardRoot)
    const cardId = node?.getAttribute('data-id') ?? null
    if (!node || !cardId) return null
    focusedCardClaimRef.current = { cardId, boardRoot, node }
    setFocusedCardId(cardId)
    return cardId
  }, [])

  const releaseFocusedCard = useCallback((
    target: EventTarget | null,
    relatedTarget: EventTarget | null,
    boardRoot: Element,
  ) => {
    const leavingNode = cardNodeWithinBoard(target, boardRoot)
    const leavingCardId = leavingNode?.getAttribute('data-id') ?? null
    if (!leavingNode || !leavingCardId) return null
    const enteringNode = cardNodeWithinBoard(relatedTarget, boardRoot)
    const claim = focusedCardClaimRef.current
    if (claim?.boardRoot === boardRoot && claim.node === leavingNode && enteringNode === claim.node) {
      return null
    }
    if (!claim || claim.boardRoot !== boardRoot || claim.node !== leavingNode || !clearFocusedClaim(claim)) {
      onFocusOwnershipLostRef.current?.(leavingCardId)
    }
    return leavingCardId
  }, [clearFocusedClaim])

  // React does not dispatch delegated blur when a focused descendant is
  // removed. Activation can replace a Passive Card with its Live Card at the
  // same bounds, so reconcile the one remembered owner against the browser's
  // authoritative focus after every commit. This is one activeElement/closest
  // lookup, never a Board scan or polling loop.
  useLayoutEffect(() => {
    const claim = focusedCardClaimRef.current
    if (!claim || typeof document === 'undefined') return
    const activeElement = document.activeElement
    if (
      claim.boardRoot.isConnected &&
      claim.node.isConnected &&
      activeElement instanceof Element &&
      claim.node.contains(activeElement) &&
      cardNodeWithinBoard(activeElement, claim.boardRoot) === claim.node
    ) return
    clearFocusedClaim(claim, true)
  })

  return {
    focusedCardId,
    claimFocusedCard,
    releaseFocusedCard,
  }
}

export type CardActivationDecision = {
  beginActivation: boolean
  intentDelivery: 'none' | 'continue'
  pin: boolean
  showLoading: boolean
}

/**
 * Passive Cards stay mounted at identical bounds, so a click that arrives
 * before the live-owner state commits can continue to its original target.
 * This is the production single-click handoff path; no synthetic replay is
 * needed and the event is never consumed merely to activate the Card.
 */
export function cardActivationDecision({
  trigger,
  live,
  deferUntilClick = false,
}: {
  trigger: CardActivationTrigger
  live: boolean
  /** S/O Cards keep geometry-only pointer ownership until the shared
   * click/drag threshold resolves an actual click. */
  deferUntilClick?: boolean
}): CardActivationDecision {
  const deferredPointerTrigger = deferUntilClick && trigger === 'press'
  return {
    beginActivation: !live && !deferredPointerTrigger,
    intentDelivery: trigger === 'click' || trigger === 'press' ? 'continue' : 'none',
    pin:
      trigger === 'focus' ||
      trigger === 'click' ||
      (trigger === 'press' && !deferUntilClick),
    showLoading: !live && deferUntilClick && trigger === 'click',
  }
}

const NO_LIVE_CARD_OWNERS = new Set<string>()

/**
 * Mod faces use their own pointer-capture owner so an in-progress gesture can
 * survive normal proximity-set replacement. A deferred S/O shell must not use
 * that seam to enter Live before React Flow resolves a stationary click.
 * Already-Live Cards are safe, and below Reading an existing capture may only
 * be a continuation because no Mod face is available to start a new gesture.
 */
export function modFaceGestureLiveOwnerIds({
  pointerGestureIds,
  deferredActivationCardIds,
  existingLiveOwnerIds,
  preserveCapturedContinuation,
}: {
  pointerGestureIds: ReadonlySet<string>
  deferredActivationCardIds: ReadonlySet<string>
  existingLiveOwnerIds: ReadonlySet<string>
  preserveCapturedContinuation: boolean
}): ReadonlySet<string> {
  if (!pointerGestureIds.size) return NO_LIVE_CARD_OWNERS
  if (preserveCapturedContinuation) return pointerGestureIds
  const accepted = new Set<string>()
  for (const cardId of pointerGestureIds) {
    if (!deferredActivationCardIds.has(cardId) || existingLiveOwnerIds.has(cardId)) {
      accepted.add(cardId)
    }
  }
  return accepted.size ? accepted : NO_LIVE_CARD_OWNERS
}

export type CardActivationOwnershipOptions = {
  enabled: boolean
  focusedCardId: string | null
  selectedCardIds: ReadonlySet<string>
  editingCardIds: ReadonlySet<string>
  scrollingCardId: string | null
  gestureParticipantIds: ReadonlySet<string>
  activeMediaCardIds: ReadonlySet<string>
  deferredActivationCardIds?: ReadonlySet<string>
}

export const CARD_ACTIVATION_OWNER_REASONS = [
  'selected',
  'editing',
  'activation',
  'focused',
  'scrolling',
  'gesture',
  'media',
] as const

export type CardActivationOwnerReason = (typeof CARD_ACTIVATION_OWNER_REASONS)[number]

export type CardActivationOwnerSnapshot = {
  mode: 'live' | 'passive'
  ownerTokens: readonly CardActivationOwnerReason[]
  owners: Readonly<Record<CardActivationOwnerReason, boolean>>
}

export type CardActivationOwnerSnapshotOptions = CardActivationOwnershipOptions & {
  activationCardId: string | null
}

function assertExactPlainDataRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string,
): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} must be a plain data object.`)
  }
  const keys = Reflect.ownKeys(value)
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key) => typeof key !== 'string' || !expectedKeys.includes(key))
  ) {
    throw new Error(`${label} must contain only ${expectedKeys.join(', ')}.`)
  }
  for (const key of expectedKeys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error(`${label}.${key} must be an enumerable data property.`)
    }
  }
}

/** Runtime privacy/shape boundary for browser-originated owner diagnostics. */
export function assertCardActivationOwnerSnapshot(
  value: unknown,
): asserts value is CardActivationOwnerSnapshot {
  assertExactPlainDataRecord(value, ['mode', 'ownerTokens', 'owners'], 'Card activation owner snapshot')
  assertExactPlainDataRecord(value.owners, CARD_ACTIVATION_OWNER_REASONS, 'Card activation owners')

  const tokens = value.ownerTokens
  if (!Array.isArray(tokens) || Object.getPrototypeOf(tokens) !== Array.prototype) {
    throw new Error('Card activation ownerTokens must be a plain array.')
  }
  if (tokens.length > CARD_ACTIVATION_OWNER_REASONS.length) {
    throw new Error('Card activation ownerTokens exceeds the closed owner vocabulary.')
  }
  const tokenKeys = Reflect.ownKeys(tokens)
  const expectedTokenKeys = [...tokens.keys()].map(String)
  expectedTokenKeys.push('length')
  if (
    tokenKeys.length !== expectedTokenKeys.length ||
    tokenKeys.some((key) => typeof key !== 'string' || !expectedTokenKeys.includes(key))
  ) {
    throw new Error('Card activation ownerTokens must be dense and contain no extra properties.')
  }
  for (let index = 0; index < tokens.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(tokens, String(index))
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) {
      throw new Error('Card activation ownerTokens entries must be enumerable data properties.')
    }
  }

  const expectedTokens: CardActivationOwnerReason[] = []
  for (const reason of CARD_ACTIVATION_OWNER_REASONS) {
    if (typeof value.owners[reason] !== 'boolean') {
      throw new Error(`Card activation owner ${reason} must be boolean.`)
    }
    if (value.owners[reason]) expectedTokens.push(reason)
  }
  if (
    tokens.length !== expectedTokens.length ||
    tokens.some((token, index) => token !== expectedTokens[index])
  ) {
    throw new Error('Card activation ownerTokens must exactly match canonical true-owner order.')
  }
  if (value.mode !== 'live' && value.mode !== 'passive') {
    throw new Error('Card activation owner snapshot mode is unknown.')
  }
  if ((value.mode === 'live') !== (expectedTokens.length > 0)) {
    throw new Error('Card activation owner snapshot mode does not match its owners.')
  }
}

/**
 * Closed, content-free view of the exact hot owners that keep one Card live.
 * The target id is an input only and is deliberately absent from the result,
 * so performance failure artifacts cannot carry Card/user identity through
 * this seam.
 */
export function cardActivationOwnerSnapshot(
  cardId: string,
  options: CardActivationOwnerSnapshotOptions,
): CardActivationOwnerSnapshot {
  const selectionActivationDeferred = options.deferredActivationCardIds?.has(cardId) ?? false
  const owners: Record<CardActivationOwnerReason, boolean> = {
    selected:
      options.enabled && !selectionActivationDeferred && options.selectedCardIds.has(cardId),
    editing:
      options.enabled && !selectionActivationDeferred && options.editingCardIds.has(cardId),
    activation: options.enabled && options.activationCardId === cardId,
    focused: options.enabled && options.focusedCardId === cardId,
    scrolling: options.enabled && options.scrollingCardId === cardId,
    gesture: options.enabled && options.gestureParticipantIds.has(cardId),
    media: options.enabled && options.activeMediaCardIds.has(cardId),
  }
  const ownerTokens = CARD_ACTIVATION_OWNER_REASONS.filter((reason) => owners[reason])
  return {
    mode: ownerTokens.length ? 'live' : 'passive',
    ownerTokens,
    owners,
  }
}

/**
 * Board's hot Card-ownership seam. Hover is presentation/geometry only and
 * never acquires Live authority. Focus and accepted click decisions may pin
 * activation; independent owners release only through their own lifecycles.
 */
export function useCardActivationOwnership({
  enabled,
  focusedCardId,
  selectedCardIds,
  editingCardIds,
  scrollingCardId,
  gestureParticipantIds,
  activeMediaCardIds,
  deferredActivationCardIds = NO_LIVE_CARD_OWNERS,
}: CardActivationOwnershipOptions) {
  const [hoveredCardId, setHoveredCardId] = useState<string | null>(null)
  const [focusActivationCardId, setFocusActivationCardId] = useState<string | null>(null)
  const [clickActivationCardId, setClickActivationCardId] = useState<string | null>(null)

  const beginActivation = useCallback((
    cardId: string,
    decision: CardActivationDecision,
    trigger: CardActivationTrigger,
  ) => {
    if (!enabled || !decision.beginActivation || !decision.pin) return
    if (trigger === 'focus') setFocusActivationCardId(cardId)
    if (trigger === 'click' || trigger === 'press') setClickActivationCardId(cardId)
  }, [enabled])
  const releaseActivation = useCallback((cardId: string, trigger: 'focus' | 'click') => {
    if (trigger === 'focus') {
      setFocusActivationCardId((current) => (current === cardId ? null : current))
    } else {
      setClickActivationCardId((current) => (current === cardId ? null : current))
    }
  }, [])
  const leaveCard = useCallback((cardId: string) => {
    setHoveredCardId((current) => (current === cardId ? null : current))
    releaseActivation(cardId, 'focus')
    releaseActivation(cardId, 'click')
  }, [releaseActivation])

  const ownerSnapshot = useCallback((cardId: string) => cardActivationOwnerSnapshot(cardId, {
    enabled,
    focusedCardId,
    selectedCardIds,
    editingCardIds,
    scrollingCardId,
    activeMediaCardIds,
    deferredActivationCardIds,
    activationCardId:
      focusActivationCardId === cardId || clickActivationCardId === cardId ? cardId : null,
    gestureParticipantIds: deferredActivationCardIds.has(cardId)
      ? NO_LIVE_CARD_OWNERS
      : gestureParticipantIds,
  }), [
    activeMediaCardIds,
    clickActivationCardId,
    deferredActivationCardIds,
    editingCardIds,
    enabled,
    focusActivationCardId,
    focusedCardId,
    gestureParticipantIds,
    scrollingCardId,
    selectedCardIds,
  ])

  const liveOwnerIds = useMemo<ReadonlySet<string>>(() => {
    if (!enabled) return NO_LIVE_CARD_OWNERS
    const next = new Set<string>()
    for (const cardId of selectedCardIds) {
      if (!deferredActivationCardIds.has(cardId)) next.add(cardId)
    }
    for (const cardId of editingCardIds) {
      if (!deferredActivationCardIds.has(cardId)) next.add(cardId)
    }
    if (focusActivationCardId) next.add(focusActivationCardId)
    if (clickActivationCardId) next.add(clickActivationCardId)
    if (focusedCardId) next.add(focusedCardId)
    if (scrollingCardId) next.add(scrollingCardId)
    for (const cardId of activeMediaCardIds) next.add(cardId)
    for (const cardId of gestureParticipantIds) {
      if (!deferredActivationCardIds.has(cardId)) next.add(cardId)
    }
    return next.size ? next : NO_LIVE_CARD_OWNERS
  }, [
    activeMediaCardIds,
    clickActivationCardId,
    deferredActivationCardIds,
    editingCardIds,
    enabled,
    focusActivationCardId,
    focusedCardId,
    gestureParticipantIds,
    scrollingCardId,
    selectedCardIds,
  ])

  return {
    beginActivation,
    leaveCard,
    releaseActivation,
    hoveredCardId,
    setHoveredCardId,
    liveOwnerIds,
    ownerSnapshot,
  }
}

export type LiveCardNodeData = {
  selectedCardCount: number
  /** Semantic Card selection, intentionally delayed behind wrapper paint. */
  semanticSelected?: boolean
  onModFaceGestureChange?: (cardId: string, active: boolean) => void
  onCardResize?: (cardId: string, size: { width: number; height: number }) => void
  onCardRenderedSize?: (cardId: string, size: { width: number; height: number }) => void
  onCardResizePreview?: CardResizePreviewReporter
  getResultPlacementContext?: () => ResultPlacementContext
}

export function modFaceGestureReporterFromNodeData(
  data: unknown,
): LiveCardNodeData['onModFaceGestureChange'] {
  if (!data || typeof data !== 'object') return undefined
  const reporter = (data as Partial<LiveCardNodeData>).onModFaceGestureChange
  return typeof reporter === 'function' ? reporter : undefined
}

export type CardResizeGeometry = {
  position: { x: number; y: number }
  size: { width: number; height: number }
}

export type CardResizePreviewEvent =
  | { type: 'begin'; sessionId: number; geometry: CardResizeGeometry }
  | { type: 'preview'; sessionId: number; geometry: CardResizeGeometry }
  | { type: 'commit'; sessionId: number; geometry: CardResizeGeometry }
  | { type: 'abort'; sessionId: number }

export type CardResizePreviewReporter = (
  cardId: string,
  event: CardResizePreviewEvent,
  nodeElement: HTMLElement | null,
) => void

export type PlaybackCardNodeData = {
  card: Card
  ghost?: boolean
}

export function liveCardNodeData(selectedCardIds: ReadonlySet<string>): LiveCardNodeData {
  return { selectedCardCount: selectedCardIds.size }
}

export function cardResizeReporterFromNodeData(data: unknown): LiveCardNodeData['onCardResize'] {
  if (!data || typeof data !== 'object') return undefined
  const reporter = (data as Partial<LiveCardNodeData>).onCardResize
  return typeof reporter === 'function' ? reporter : undefined
}

export function cardRenderedSizeReporterFromNodeData(data: unknown): LiveCardNodeData['onCardRenderedSize'] {
  if (!data || typeof data !== 'object') return undefined
  const reporter = (data as Partial<LiveCardNodeData>).onCardRenderedSize
  return typeof reporter === 'function' ? reporter : undefined
}

export function cardResizePreviewReporterFromNodeData(
  data: unknown,
): LiveCardNodeData['onCardResizePreview'] {
  if (!data || typeof data !== 'object') return undefined
  const reporter = (data as Partial<LiveCardNodeData>).onCardResizePreview
  return typeof reporter === 'function' ? reporter : undefined
}

export function resultPlacementContextFromNodeData(data: unknown): ResultPlacementContext | undefined {
  if (!data || typeof data !== 'object') return undefined
  const getter = (data as Partial<LiveCardNodeData>).getResultPlacementContext
  return typeof getter === 'function' ? getter() : undefined
}

export function selectedCardCountFromNodeData(data: unknown): number {
  if (!data || typeof data !== 'object') return 0

  const count = (data as Partial<LiveCardNodeData>).selectedCardCount
  return typeof count === 'number' && Number.isFinite(count) ? count : 0
}

export function canEditSelectedCard({
  activeTool,
  data,
  selected,
}: {
  activeTool: CanvasTool
  data: unknown
  selected: boolean
}): boolean {
  return selected && activeTool === 'select' && selectedCardCountFromNodeData(data) === 1
}

export function shouldPanOnScroll({
  activeTool,
  readOnly,
  selectedCardCount: _selectedCardCount,
}: {
  activeTool: CanvasTool
  readOnly: boolean
  selectedCardCount: number
}): boolean {
  // Every tool keeps two-finger scroll panning; the highlighter only claims the
  // pointer, never the wheel.
  return readOnly || activeTool === 'select' || activeTool === 'pan' || activeTool === 'highlight'
}

/*
 * React Flow treats any element carrying `nodrag` as a drag blocker. Card
 * surfaces only earn that block once the card is selected — mirroring the
 * canEditSelectedCard gate: an unselected card is draggable anywhere
 * (press-and-move vs click is disambiguated by Board's nodeDragThreshold),
 * a selected card keeps its interactive regions clickable and text-selectable.
 */
export function dragBlockingClass(selected: boolean): string {
  return selected ? 'nodrag' : ''
}

// Shift+click extends a native input/textarea range, but React Flow also uses
// Shift+click to toggle node selection. Keep that modified click inside the
// text control; ordinary clicks still reach the node and can select its Card.
export function preserveCardSelectionOnTextRangeClick(
  event: Pick<ReactMouseEvent<HTMLElement>, 'shiftKey' | 'stopPropagation'>,
): void {
  if (event.shiftKey) event.stopPropagation()
}

// Highlight mode clears Card selection, but readable text still owns a primary
// pointer drag. Block both node dragging and pane panning so the browser can
// extend its native text selection and the highlight hook can save the stroke.
export function highlightableTextDragBlockingClass(
  activeTool: CanvasTool,
  selected: boolean,
): string {
  return activeTool === 'highlight' ? 'nodrag nopan' : dragBlockingClass(selected)
}

type RetainedCardScrollPosition = {
  scrollTop: number
  scrollLeft: number
  scrollTopRatio: number
  scrollLeftRatio: number
  distanceFromBottom: number
}

// Reading-residency eviction deliberately removes rich Card DOM. Browser
// scroll state lives on that DOM node, so retain only the small, ephemeral
// viewport fact needed to restore the next instance. This is UI memory, never
// graph/Profile truth, and its fixed budget prevents traversal from growing it
// without bound.
const RETAINED_CARD_SCROLL_POSITION_LIMIT = 1_024
const retainedCardScrollPositions = new Map<string, RetainedCardScrollPosition>()

function retainedCardScrollKey(ideaId: string | null, cardId: string): string {
  // JSON's tuple encoding is unambiguous even if an imported identifier
  // contains punctuation. Scroll memory belongs to one Board, never merely to
  // a Card id that another idea or imported graph may legitimately reuse.
  return JSON.stringify([ideaId, cardId])
}

function captureCardScrollPosition(retentionKey: string, element: HTMLElement) {
  const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
  const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth)
  const next = {
    scrollTop: element.scrollTop,
    scrollLeft: element.scrollLeft,
    scrollTopRatio: maxScrollTop > 0 ? element.scrollTop / maxScrollTop : 0,
    scrollLeftRatio: maxScrollLeft > 0 ? element.scrollLeft / maxScrollLeft : 0,
    distanceFromBottom: Math.max(0, maxScrollTop - element.scrollTop),
  }
  const retained = retainedCardScrollPositions.get(retentionKey)
  if (retained) {
    Object.assign(retained, next)
    // Any authoritative use is recency evidence. Move the updated record to
    // the Map tail so an actively read Card cannot be evicted ahead of older,
    // untouched scroll memory.
    retainedCardScrollPositions.delete(retentionKey)
    retainedCardScrollPositions.set(retentionKey, retained)
    return
  }
  retainedCardScrollPositions.set(retentionKey, next)
  if (retainedCardScrollPositions.size <= RETAINED_CARD_SCROLL_POSITION_LIMIT) return
  const oldestCardId = retainedCardScrollPositions.keys().next().value
  if (typeof oldestCardId === 'string') retainedCardScrollPositions.delete(oldestCardId)
}

function retainedCardScrollPosition(retentionKey: string) {
  const retained = retainedCardScrollPositions.get(retentionKey)
  if (!retained) return undefined
  // Restoration is the useful recency signal. Move this one small record to
  // the end without doing any Board-wide work or touching graph state.
  retainedCardScrollPositions.delete(retentionKey)
  retainedCardScrollPositions.set(retentionKey, retained)
  return retained
}

// Same-representation Card remounts should return to the exact content offset,
// not merely the same percentage. Restore in a layout effect so the browser
// never paints a misleading top-of-card frame and do not touch focus.
export function useRetainedCardScrollPosition(
  ideaId: string | null,
  cardId: string,
  ref: RefObject<HTMLElement | null>,
) {
  const retentionKey = useMemo(() => retainedCardScrollKey(ideaId, cardId), [cardId, ideaId])
  const currentRetentionKeyRef = useRef(retentionKey)
  currentRetentionKeyRef.current = retentionKey
  const initialPosition = retainedCardScrollPositions.get(retentionKey)
  // One mutable authority is shared with Result consumers. The hook's layout
  // restoration updates it synchronously before their passive effects can
  // react to streaming content in the newly mounted DOM.
  const pinnedToEndRef = useRef(
    !initialPosition || initialPosition.distanceFromBottom < 48,
  )

  const rememberScrollPosition = useCallback(() => {
    const element = ref.current
    if (element) captureCardScrollPosition(retentionKey, element)
  }, [ref, retentionKey])

  const restoreScrollPosition = useCallback(() => {
    const element = ref.current
    const retained = retainedCardScrollPosition(retentionKey)
    if (!element) return
    if (!retained) {
      // A mounted React Flow node may be reused across a Board switch when an
      // imported Card id collides. Browser scroll belongs to the old scope;
      // the new Card begins at its own default rather than inheriting it.
      element.scrollTop = 0
      element.scrollLeft = 0
      pinnedToEndRef.current = true
      return
    }
    const maxScrollTop = Math.max(0, element.scrollHeight - element.clientHeight)
    const maxScrollLeft = Math.max(0, element.scrollWidth - element.clientWidth)
    const wasPinnedToEnd = retained.distanceFromBottom < 48
    element.scrollTop = Math.max(0, Math.min(retained.scrollTop, maxScrollTop))
    element.scrollLeft = Math.max(0, Math.min(retained.scrollLeft, maxScrollLeft))
    // The current DOM geometry is authoritative. A shorter remount may clamp
    // either remembered axis, including all the way to a no-overflow zero.
    // Persist that browser-effective position and its new bottom distance now;
    // otherwise a later larger remount can resurrect the stale offset and
    // stale pinned-to-end decision that existed before the shrink.
    captureCardScrollPosition(retentionKey, element)
    // A remount with grown content must also preserve an already-pinned reader
    // until the Result's streaming effect follows the new end. Conversely, a
    // genuinely unpinned reader becomes pinned only if current geometry
    // authoritatively clamps their restored offset to the end.
    pinnedToEndRef.current = wasPinnedToEnd || maxScrollTop - element.scrollTop < 48
  }, [ref, retentionKey])

  useLayoutEffect(() => {
    restoreScrollPosition()
    return () => {
      // A Board switch may reuse the same mounted node when ids collide. Its
      // previous scope was already updated by scroll events; do not let the
      // next Board's freshly rendered DOM overwrite that record during the
      // dependency cleanup. A true unmount still captures the final offset.
      if (currentRetentionKeyRef.current === retentionKey) rememberScrollPosition()
    }
  }, [rememberScrollPosition, restoreScrollPosition, retentionKey])

  return {
    rememberScrollPosition,
    restoreScrollPosition,
    pinnedToEndRef,
  }
}

// An editor and its passive Markdown read view have different DOM heights. Keep
// reading position in relative terms so either representation can restore it.
// The idea-plus-Card scope additionally carries that tiny viewport fact across
// ordinary rich DOM eviction without leaking it into another Board.
export function useRelativeScrollPosition(
  ideaId: string | null,
  cardId: string,
  ref: RefObject<HTMLElement | null>,
) {
  const retentionKey = useMemo(() => retainedCardScrollKey(ideaId, cardId), [cardId, ideaId])
  const currentRetentionKeyRef = useRef(retentionKey)
  currentRetentionKeyRef.current = retentionKey
  const scrollRatioRef = useRef(0)
  const scrollLeftRatioRef = useRef(0)

  const rememberScrollPosition = useCallback(() => {
    const element = ref.current
    if (!element) return
    // Editor initialization can temporarily move its native caret and scroll
    // before readiness restores the reader's position. Those moves must not
    // replace the entry position that the handoff still needs to restore.
    if (element.querySelector('.markdown-card-editor-transition[data-editor-ready="false"]')) return
    const maxScrollTop = element.scrollHeight - element.clientHeight
    const maxScrollLeft = element.scrollWidth - element.clientWidth
    scrollRatioRef.current = maxScrollTop > 0 ? element.scrollTop / maxScrollTop : 0
    scrollLeftRatioRef.current = maxScrollLeft > 0 ? element.scrollLeft / maxScrollLeft : 0
    captureCardScrollPosition(retentionKey, element)
  }, [ref, retentionKey])

  const restoreScrollPosition = useCallback(() => {
    const element = ref.current
    if (!element) return
    const maxScrollTop = element.scrollHeight - element.clientHeight
    const maxScrollLeft = element.scrollWidth - element.clientWidth
    let clearedNoOverflowRatio = false
    if (maxScrollTop > 0) {
      element.scrollTop = scrollRatioRef.current * maxScrollTop
    } else {
      // A representation with no overflow is an authoritative top position,
      // not a temporary inability to apply an older editor/passive ratio.
      // Clear it now so later content growth cannot resurrect stale progress.
      scrollRatioRef.current = 0
      element.scrollTop = 0
      clearedNoOverflowRatio = true
    }
    if (maxScrollLeft > 0) {
      element.scrollLeft = scrollLeftRatioRef.current * maxScrollLeft
    } else {
      scrollLeftRatioRef.current = 0
      element.scrollLeft = 0
      clearedNoOverflowRatio = true
    }
    // Persist the cleared axis before an Idea switch can reuse this DOM node.
    // The old key's dependency cleanup deliberately cannot inspect new-Board
    // DOM, so waiting until cleanup would leave its stale ratio behind.
    if (clearedNoOverflowRatio) captureCardScrollPosition(retentionKey, element)
  }, [ref, retentionKey])

  useLayoutEffect(() => {
    // A passive/editor re-entry is a real cache access just like an exact
    // Result restoration, so it must also refresh true-LRU recency.
    const retained = retainedCardScrollPosition(retentionKey)
    scrollRatioRef.current = retained?.scrollTopRatio ?? 0
    scrollLeftRatioRef.current = retained?.scrollLeftRatio ?? 0
    // React Flow can keep one mounted node alive across an idea swap when Card
    // ids collide. Apply the new scope before paint so the browser never carries
    // the previous idea's physical scroll offset into this Card.
    restoreScrollPosition()
    return () => {
      if (currentRetentionKeyRef.current === retentionKey) rememberScrollPosition()
    }
  }, [rememberScrollPosition, restoreScrollPosition, retentionKey])

  return { rememberScrollPosition, restoreScrollPosition }
}

export function liveCardNodeClassName(_selected: boolean, highlighted: boolean): string | undefined {
  const classes = [highlighted ? 'card-link-target' : ''].filter(Boolean)
  return classes.length ? classes.join(' ') : undefined
}

export type WheelGesture = {
  deltaX: number
  deltaY: number
  ctrlKey: boolean
  metaKey: boolean
}

export type WheelScrollMetrics = {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
  scrollLeft: number
  scrollWidth: number
  clientWidth: number
}

const WHEEL_GESTURE_GAP_MS = 120

// Which way a gesture is going, by its DOMINANT axis rather than by asking
// whether the vertical one moved at all.
//
// This is what made a horizontal end-of-track behave differently from a
// vertical end-of-body. A trackpad almost never produces a purely horizontal
// wheel event: a flick sideways carries a little vertical jitter, and the
// jitter comes and goes event by event. Reading "any deltaY at all means this
// is vertical" therefore relabelled a single sideways flick as y, x, y, x from
// one event to the next. `continuesCapturedGesture` compares this label against
// the one the gesture captured under, so the momentum tail after the track hit
// its edge never matched, the gate released the wheel on the very first event
// past the end, and the board panned instead of letting the gesture settle. A
// vertical flick never showed it because the same rule reads a vertical gesture
// with sideways jitter as y every single time.
//
// The dominant axis is stable across the whole flick, so a horizontal gesture
// now carries one label from start to momentum tail, exactly as a vertical one
// always did. A tie goes to y, which keeps the previous answer for the
// diagonal-in-both-axes case this rule already had to pick a side on.
function wheelDirection({ deltaX, deltaY }: Pick<WheelGesture, 'deltaX' | 'deltaY'>): string | null {
  if (Math.abs(deltaX) > Math.abs(deltaY)) return `x:${deltaX < 0 ? 'left' : 'right'}`
  if (deltaY) return `y:${deltaY < 0 ? 'up' : 'down'}`
  return null
}

// A card only claims a wheel gesture it can actually consume: the container must
// overflow AND have room left in the gesture's direction. Ctrl/meta wheel is a
// pinch-zoom (or zoom-key scroll) and always belongs to the canvas.
export function shouldCaptureWheel(gesture: WheelGesture, container: WheelScrollMetrics): boolean {
  if (gesture.ctrlKey || gesture.metaKey) return false
  const canScrollY =
    gesture.deltaY !== 0 &&
    (gesture.deltaY < 0
      ? container.scrollTop > 0
      : container.scrollTop + container.clientHeight < container.scrollHeight - 1)
  const canScrollX =
    gesture.deltaX !== 0 &&
    (gesture.deltaX < 0
      ? container.scrollLeft > 0
      : container.scrollLeft + container.clientWidth < container.scrollWidth - 1)
  return canScrollY || canScrollX
}

/*
 * Ref callback that decides wheel ownership per gesture. React Flow's wheel
 * handler sits on the pane in the bubble phase and checks
 * event.target.closest('.nowheel'), so a capture-phase listener on the scroll
 * container can set or clear that class just in time for every event.
 * Each returned callback manages one element at a time.
 */
export function wheelGate<T extends HTMLElement>(isActive: () => boolean = () => true): RefCallback<T> {
  let detach: (() => void) | null = null
  let lastCapturedDirection: string | null = null
  let lastCaptureAt = Number.NEGATIVE_INFINITY
  return (el: T | null) => {
    detach?.()
    detach = null
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      const active = isActive()
      const direction = wheelDirection(event)
      const canCapture = active && shouldCaptureWheel(event, el)
      const continuesCapturedGesture =
        active &&
        direction !== null &&
        direction === lastCapturedDirection &&
        event.timeStamp - lastCaptureAt <= WHEEL_GESTURE_GAP_MS
      const capture = canCapture || continuesCapturedGesture

      // A single trackpad flick can produce several wheel events. The event
      // that reaches an internal edge must keep its remaining momentum inside
      // the card; a new gesture that starts while already pinned is free to pan.
      if (capture && direction) {
        lastCapturedDirection = direction
        lastCaptureAt = event.timeStamp
      } else if (!continuesCapturedGesture) {
        lastCapturedDirection = null
        lastCaptureAt = Number.NEGATIVE_INFINITY
      }
      el.classList.toggle('nowheel', capture)
    }
    el.addEventListener('wheel', onWheel, { capture: true, passive: true })
    detach = () => el.removeEventListener('wheel', onWheel, { capture: true })
  }
}

// Hook form for card components: keeps the callback stable across renders,
// tracks the latest `active` flag, and forwards the element to an existing ref.
export function useWheelGate<T extends HTMLElement>(active: boolean, targetRef?: Ref<T>): RefCallback<T> {
  const activeRef = useRef(active)
  useLayoutEffect(() => {
    activeRef.current = active
  })
  return useMemo(() => {
    const gate = wheelGate<T>(() => activeRef.current)
    return (el: T | null) => {
      if (typeof targetRef === 'function') targetRef(el)
      else if (targetRef) (targetRef as { current: T | null }).current = el
      gate(el)
    }
  }, [targetRef])
}
