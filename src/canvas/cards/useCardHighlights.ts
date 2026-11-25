import { useLayoutEffect, useMemo, type RefObject } from 'react'
import { paletteColor } from '../../graph/highlights'
import { useGraph } from '../../graph/store'
import { words } from '../../shared/words'
import {
  createEraseButton,
  paintHighlights,
  paintedHighlightIdAt,
  selectionWithin,
  type PaintableHighlight,
} from '../highlightPainter'

// Gives a card's rendered text its saved highlights, and — while the highlighter
// tool is active — turns text selection into a new highlight. Erasing goes
// through the small × that fades in on hover; the highlight itself is never a
// click target, so an intentional mark can't be cleared by a stray click.
export function useCardHighlights(
  cardId: string,
  ref: RefObject<HTMLElement | null>,
  renderedKey: unknown,
) {
  const allHighlights = useGraph((s) => s.highlights)
  const tags = useGraph((s) => s.highlightTags)
  const highlighting = useGraph((s) => s.activeTool === 'highlight')
  const addHighlight = useGraph((s) => s.addHighlight)
  const removeHighlight = useGraph((s) => s.removeHighlight)

  const paintable = useMemo<PaintableHighlight[]>(() => {
    const tagById = new Map(tags.map((tag) => [tag.id, tag]))
    return allHighlights
      .filter((highlight) => highlight.cardId === cardId)
      .map((highlight) => ({
        id: highlight.id,
        text: highlight.text,
        occurrence: highlight.occurrence,
        background: paletteColor(tagById.get(highlight.tagId)?.color ?? '').bg,
      }))
  }, [allHighlights, cardId, tags])

  useLayoutEffect(() => {
    const root = ref.current
    if (!root) return
    paintHighlights(root, paintable)
  }, [paintable, ref, renderedKey])

  useLayoutEffect(() => {
    if (!highlighting) return
    const root = ref.current
    if (!root) return

    const erase = createEraseButton(root, words.highlightRemove, removeHighlight)

    // A highlight drag belongs to the card it started in. On pointerdown these
    // classes make everything but this card unselectable (see styles.css), so
    // the browser clamps the live selection at the card edge; on release only
    // the origin card saves. The release listeners live only for the drag, and
    // every path out of a drag — release, cancel, focus loss, a release that
    // happened off-window and only shows up as a button-less move, or this
    // effect tearing down — runs the same cleanup.
    let endDrag: (() => void) | null = null
    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return
      endDrag?.()
      root.classList.add('highlight-drag-origin')
      document.body.classList.add('highlight-drag')

      const end = () => {
        endDrag = null
        root.classList.remove('highlight-drag-origin')
        document.body.classList.remove('highlight-drag')
        window.removeEventListener('pointerup', onRelease)
        window.removeEventListener('pointermove', onMove)
        window.removeEventListener('pointercancel', end)
        window.removeEventListener('blur', end)
      }
      const onRelease = () => {
        end()
        // Selection settles after release; read it a beat later.
        window.setTimeout(() => {
          const found = ref.current ? selectionWithin(ref.current) : null
          if (!found) return
          addHighlight({ cardId, ...found })
          window.getSelection()?.removeAllRanges()
        }, 0)
      }
      const onMove = (event: PointerEvent) => {
        // No button held mid-"drag": the release happened outside the window,
        // where no pointerup reaches us. Treat re-entry as the release.
        if ((event.buttons & 1) === 0) onRelease()
      }

      window.addEventListener('pointerup', onRelease)
      window.addEventListener('pointermove', onMove)
      window.addEventListener('pointercancel', end)
      window.addEventListener('blur', end)
      endDrag = end
    }

    // Hovering a highlight fades the × in; leaving starts the grace countdown so
    // the pointer has time to reach the button before it fades away.
    const onMouseOver = (event: MouseEvent) => {
      if (erase.contains(event.target)) {
        erase.cancelHide()
        return
      }
      const highlightId = paintedHighlightIdAt(event.target)
      if (highlightId) erase.showFor(highlightId)
      else erase.scheduleHide()
    }
    const onMouseLeave = () => erase.scheduleHide()

    root.addEventListener('pointerdown', onPointerDown)
    root.addEventListener('mouseover', onMouseOver)
    root.addEventListener('mouseleave', onMouseLeave)
    return () => {
      endDrag?.()
      root.removeEventListener('pointerdown', onPointerDown)
      root.removeEventListener('mouseover', onMouseOver)
      root.removeEventListener('mouseleave', onMouseLeave)
      erase.destroy()
    }
  }, [addHighlight, cardId, highlighting, ref, removeHighlight])
}
