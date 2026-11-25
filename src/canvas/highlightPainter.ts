// Paints saved highlights over already-rendered card text by wrapping the matched
// text nodes in <mark> elements. The card's text and markdown stay untouched —
// highlights are a visual layer the canvas re-applies after every render.

import { countMatchesBefore, findNthMatch, type TextRange } from '../shared/textMatch'

export type PaintableHighlight = {
  id: string
  text: string
  occurrence: number
  background: string
}

const MARK_ATTR = 'data-highlight-id'

function textNodesOf(root: HTMLElement): Text[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const nodes: Text[] = []
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text)
  }
  return nodes
}

export function clearPaintedHighlights(root: HTMLElement) {
  for (const mark of Array.from(root.querySelectorAll(`mark[${MARK_ATTR}]`))) {
    const parent = mark.parentNode
    if (!parent) continue
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark)
    parent.removeChild(mark)
  }
  root.normalize()
}

function wrapRange(nodes: Text[], range: TextRange, highlight: PaintableHighlight) {
  let offset = 0
  for (const node of nodes) {
    const nodeStart = offset
    const nodeEnd = offset + node.data.length
    offset = nodeEnd
    if (nodeEnd <= range.start) continue
    if (nodeStart >= range.end) break

    const localStart = Math.max(0, range.start - nodeStart)
    const localEnd = Math.min(node.data.length, range.end - nodeStart)
    if (localEnd <= localStart) continue
    // Whitespace between paragraphs would paint as empty slivers on blank lines.
    if (!node.data.slice(localStart, localEnd).trim()) continue

    let target = node
    if (localStart > 0) target = target.splitText(localStart)
    if (localEnd - localStart < target.data.length) target.splitText(localEnd - localStart)

    const mark = document.createElement('mark')
    mark.setAttribute(MARK_ATTR, highlight.id)
    mark.className = 'painted-highlight'
    mark.style.backgroundColor = highlight.background
    target.parentNode?.insertBefore(mark, target)
    mark.appendChild(target)
  }
}

export function paintHighlights(root: HTMLElement, highlights: PaintableHighlight[]) {
  clearPaintedHighlights(root)
  for (const highlight of highlights) {
    // Re-walk per highlight: wrapping splits text nodes, changing the node list.
    const nodes = textNodesOf(root)
    const fullText = nodes.map((node) => node.data).join('')
    const range = findNthMatch(fullText, highlight.text, highlight.occurrence)
    if (!range) continue // the text changed since it was highlighted; keep it in the list only
    wrapRange(nodes, range, highlight)
  }
}

export function paintedHighlightIdAt(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null
  return target.closest(`mark[${MARK_ATTR}]`)?.getAttribute(MARK_ATTR) ?? null
}

// ---- The erase button --------------------------------------------------------
// Erasing is deliberate: hovering a highlight fades in one small × at the
// top-right of the highlight's LAST line fragment, and only that × erases. The
// button stays up for a grace period after the pointer leaves, long enough to
// travel from the text onto the ×.

const ERASE_GRACE_MS = 600
const ERASE_X_SVG =
  '<svg viewBox="0 0 24 24" width="8" height="8" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>'

export type EraseButtonController = {
  showFor: (highlightId: string) => void
  scheduleHide: () => void
  cancelHide: () => void
  contains: (target: EventTarget | null) => boolean
  destroy: () => void
}

export function createEraseButton(
  root: HTMLElement,
  label: string,
  onErase: (highlightId: string) => void,
): EraseButtonController {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'highlight-erase'
  button.setAttribute('aria-label', label)
  button.title = label
  button.innerHTML = ERASE_X_SVG
  root.appendChild(button)

  let hideTimer: number | null = null
  let targetId: string | null = null

  const cancelHide = () => {
    if (hideTimer !== null) {
      window.clearTimeout(hideTimer)
      hideTimer = null
    }
  }

  const hide = () => {
    cancelHide()
    button.classList.remove('show')
    targetId = null
  }

  const scheduleHide = () => {
    cancelHide()
    hideTimer = window.setTimeout(() => {
      hideTimer = null
      hide()
    }, ERASE_GRACE_MS)
  }

  const showFor = (highlightId: string) => {
    cancelHide()
    // A React re-render (new markdown, streaming text) can wipe the button; put
    // it back before showing.
    if (!button.isConnected) root.appendChild(button)
    const marks = root.querySelectorAll<HTMLElement>(`mark[${MARK_ATTR}="${highlightId}"]`)
    const lastMark = marks[marks.length - 1]
    if (!lastMark) return

    const fragments = lastMark.getClientRects()
    const corner = fragments[fragments.length - 1] ?? lastMark.getBoundingClientRect()
    const rootRect = root.getBoundingClientRect()
    // The canvas zooms via a CSS transform; rects are screen px, styles want local px.
    const scale = root.offsetWidth > 0 ? rootRect.width / root.offsetWidth : 1
    // Sit just past the top-right corner where the sentence ends — nudged up and
    // to the right so the button clears the last word instead of covering it, and
    // its pointer hitbox never overlaps the highlighted text.
    const left = (corner.right - rootRect.left) / scale + root.scrollLeft - 4
    const top = (corner.top - rootRect.top) / scale + root.scrollTop - 4

    button.style.left = `${Math.max(0, left)}px`
    button.style.top = `${Math.max(0, top)}px`
    targetId = highlightId
    button.classList.add('show')
  }

  const onClick = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    if (targetId) onErase(targetId)
    hide()
  }
  const onEnter = () => cancelHide()
  const onLeave = () => scheduleHide()

  button.addEventListener('click', onClick)
  button.addEventListener('mouseenter', onEnter)
  button.addEventListener('mouseleave', onLeave)

  return {
    showFor,
    scheduleHide,
    cancelHide,
    contains: (target) => target instanceof Node && button.contains(target),
    destroy: () => {
      cancelHide()
      button.removeEventListener('click', onClick)
      button.removeEventListener('mouseenter', onEnter)
      button.removeEventListener('mouseleave', onLeave)
      button.remove()
    },
  }
}

// The part of range that falls inside root, or null when they don't overlap.
// Setting a boundary past the other collapses the clone, so a range entirely
// outside root comes back collapsed and is rejected.
function clampToRoot(root: HTMLElement, range: Range): Range | null {
  const bounds = document.createRange()
  bounds.selectNodeContents(root)
  const clamped = range.cloneRange()
  if (clamped.compareBoundaryPoints(Range.START_TO_START, bounds) < 0) {
    clamped.setStart(bounds.startContainer, bounds.startOffset)
  }
  if (clamped.compareBoundaryPoints(Range.END_TO_END, bounds) > 0) {
    clamped.setEnd(bounds.endContainer, bounds.endOffset)
  }
  return clamped.collapsed ? null : clamped
}

// Where the current selection starts inside root's readable text, or null when
// the selection never touches root. A selection that overshoots the card edge
// is clamped to its in-root portion — a sloppy drag still yields the in-card
// highlight. Also pins a new highlight to the right occurrence of a repeated
// phrase.
export function selectionWithin(root: HTMLElement): { text: string; occurrence: number } | null {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null

  const range = clampToRoot(root, selection.getRangeAt(0))
  if (!range) return null

  const text = range.toString()
  if (!text.trim()) return null

  const nodes = textNodesOf(root)
  const fullText = nodes.map((node) => node.data).join('')

  let startIndex = 0
  let found = false
  for (const node of nodes) {
    if (node === range.startContainer) {
      startIndex += range.startOffset
      found = true
      break
    }
    if (
      range.startContainer.nodeType === Node.ELEMENT_NODE &&
      range.startContainer.contains(node) &&
      range.comparePoint(node, 0) >= 0
    ) {
      found = true
      break
    }
    startIndex += node.data.length
  }
  if (!found) startIndex = 0

  return { text, occurrence: countMatchesBefore(fullText, text, startIndex) }
}
