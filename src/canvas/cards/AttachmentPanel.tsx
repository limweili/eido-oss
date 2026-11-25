import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useWheelGate } from '../cardInteraction'
// The panel kinds are named once, beside the rule that pays a Card for showing
// one, so a third panel cannot be added here and quietly go unpaid there.
import type { AttachmentPanelKind } from '../../graph/attachmentPanelGrowth'

export type { AttachmentPanelKind }
export type AttachmentItemKind = 'image' | 'preview'

/**
 * How much track is kept mounted on each side of what the panel actually
 * shows, as a share of the panel's own visible width. A share rather than a
 * pixel count because the panel is painted inside the canvas transform: one
 * panel width of look-ahead means the same amount of scrolling at every zoom,
 * where a fixed pixel margin would mean a different amount at each.
 */
const TILE_LOOK_AHEAD = '0px 100%'

/** Registers one tile with its track's shared observer; returns the release. */
type TileResidency = {
  observe: (tile: HTMLElement, onNear: (near: boolean) => void) => () => void
}

/** No residency means no way to observe, so every tile stays mounted. */
const AttachmentTrackContext = createContext<TileResidency | null>(null)

/**
 * The box test the observer applies, run once against real layout so the very
 * first paint of a track already carries the tiles it shows. An observer
 * cannot do this on its own: its first delivery is a task queued after the
 * frame that mounted the track, which would paint one frame of empty tiles.
 */
function tileIsNear(tile: HTMLElement): boolean {
  const track = tile.parentElement
  if (!track) return true
  const view = track.getBoundingClientRect()
  // A track with no width has not been laid out (or is not rendered at all,
  // as under a test DOM): nothing can be decided, so nothing is withheld.
  if (view.width <= 0) return true
  const box = tile.getBoundingClientRect()
  return box.right >= view.left - view.width && box.left <= view.right + view.width
}

/**
 * One IntersectionObserver per track, shared by every tile in it, rooted on
 * the track itself so the question it answers is "is this tile within reach of
 * the panel's visible width", never "is it within reach of the browser
 * window". A Card parked offscreen in the residency buffer therefore keeps
 * exactly the tiles it would show, and does not have to re-mount them when the
 * founder pans back to it.
 */
function useTileResidency(): TileResidency | null {
  const observer = useRef<IntersectionObserver | null>(null)
  // The observer is built on the first tile that registers, because only a
  // tile can name the track: a parent's own ref is not attached yet when its
  // children's effects run.
  const residency = useMemo<TileResidency | null>(() => {
    if (typeof IntersectionObserver === 'undefined') return null
    const listeners = new Map<Element, (near: boolean) => void>()
    return {
      observe(tile, onNear) {
        if (!observer.current) {
          const root = tile.parentElement
          if (!root) return () => {}
          observer.current = new IntersectionObserver(
            (entries) => {
              for (const entry of entries) listeners.get(entry.target)?.(entry.isIntersecting)
            },
            { root, rootMargin: TILE_LOOK_AHEAD },
          )
        }
        listeners.set(tile, onNear)
        observer.current.observe(tile)
        return () => {
          listeners.delete(tile)
          observer.current?.unobserve(tile)
        }
      },
    }
  }, [])
  useEffect(() => () => {
    observer.current?.disconnect()
    observer.current = null
  }, [])
  return residency
}

/**
 * A Note's attachments live in panels pinned to the bottom of its Card rather
 * than flowed through the body. Each panel is one horizontal carousel, so the
 * Card's width decides how much of a track is visible and never how much of it
 * exists: narrowing a Card scrolls, it does not crop or drop a tile.
 *
 * The panel's height is a clamp of a share of the Card's height between a
 * floor and a ceiling. That rule lives entirely in the stylesheet
 * (`--e-attachment-panel-height-*`), because it must hold for a Card the user
 * resizes with a pointer, with no measurement round trip through React.
 */
export function AttachmentPanel({
  kind,
  label,
  scrollable,
  overlay,
  children,
}: Readonly<{
  kind: AttachmentPanelKind
  label: string
  /** Wheel ownership follows the Card's own selection, like the Note body. */
  scrollable: boolean
  /** Rendered after the track, for panel-owned surfaces that are not tiles. */
  overlay?: ReactNode
  children: ReactNode
}>) {
  const trackGate = useWheelGate<HTMLUListElement>(scrollable)
  const residency = useTileResidency()
  return (
    <section className={`card-attachment-panel card-attachment-panel--${kind}`} aria-label={label}>
      <ul
        ref={trackGate}
        className="card-attachment-track"
        // The defect ec340c92 fixed for the link preview anchor reaches every
        // image in these panels: a press that begins on a tile must fall
        // through to the Card's own drag gesture, so nothing inside a track may
        // start a native HTML5 drag and paint its ghost instead. Tiles carry
        // draggable={false} as well; this refusal is the backstop for anything
        // a tile renders that the browser considers draggable on its own.
        onDragStart={(event) => event.preventDefault()}
      >
        <AttachmentTrackContext.Provider value={residency}>
          {children}
        </AttachmentTrackContext.Provider>
      </ul>
      {overlay}
    </section>
  )
}

/**
 * One carousel tile. The active tile is the one the last gesture landed on.
 *
 * The tile's own box is always here; what it carries is mounted only while the
 * tile is within reach of the panel's visible width. A Note with a hundred
 * images therefore costs a hundred empty list items instead of a hundred
 * mounted images, and the founder still meets every one of them by scrolling.
 * The box is what keeps that honest: its width comes from the panel's height
 * and the track's own tokens, never from what is inside it, so the scroll
 * geometry a full track would have is exactly the geometry an empty one has.
 */
export function AttachmentPanelItem({
  kind,
  active,
  onActivate,
  children,
}: Readonly<{
  kind: AttachmentItemKind
  active: boolean
  onActivate?: () => void
  children: ReactNode
}>) {
  const residency = useContext(AttachmentTrackContext)
  const tile = useRef<HTMLLIElement | null>(null)
  const [near, setNear] = useState(residency === null)

  useLayoutEffect(() => {
    if (!residency || !tile.current) return
    setNear(tileIsNear(tile.current))
  }, [residency])

  useEffect(() => {
    if (!residency || !tile.current) return
    return residency.observe(tile.current, setNear)
  }, [residency])

  return (
    <li
      ref={tile}
      className={`card-attachment-item card-attachment-item--${kind} ${active ? 'is-active' : ''}`}
      aria-current={active ? 'true' : undefined}
      // Capture, and never stop propagation: the tile learns it became active
      // without taking the press away from the Card's drag detection.
      onPointerDownCapture={onActivate}
      onFocusCapture={onActivate}
    >
      {near ? children : null}
    </li>
  )
}
