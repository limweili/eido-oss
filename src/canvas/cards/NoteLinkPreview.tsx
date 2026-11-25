import { ExternalLink, Globe2, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useGraph } from '../../graph/store'
import {
  durableLinkPreview,
  type LoadedLinkPreview,
} from '../../shared/linkPreview'
import { cachedLinkPreview, loadLinkPreview } from '../../shared/loadLinkPreview'
import { words } from '../../shared/words'
import { IconButton, StateWord } from '../../ui/primitives'

export function NoteLinkPreview({
  cardId,
  preview,
}: Readonly<{
  cardId: string
  preview: LoadedLinkPreview
}>) {
  const setLinkPreview = useGraph((state) => state.setLinkPreview)
  const removeNotePreview = useGraph((state) => state.removeNotePreview)
  const mounted = useRef(false)
  const announcedStatus = useRef<typeof preview.status | undefined>(
    preview.status === 'loading' ? undefined : preview.status,
  )
  const [loadedPreview, setLoadedPreview] = useState<LoadedLinkPreview>(
    () => usableCachedPreview(preview) ?? preview,
  )
  const [retrying, setRetrying] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const hostname = displayHostname(preview.url)
  const visiblePreview = loadedPreview.url === preview.url ? loadedPreview : preview
  const title = visiblePreview.title?.trim() || hostname
  const label = preview.status === 'fallback'
    ? `${words.openLinkPreview} ${title}, ${preview.url}`
    : `${words.openLinkPreview} ${title}`
  // A fetch that came back empty still deserves something in the description
  // slot: the address itself, so the tile reads as this specific page rather
  // than a preview that quietly failed. The scheme is dropped because the
  // title and site row already carry the domain; the path is the only part
  // of the address that adds anything here.
  const description = visiblePreview.description
    || (preview.status === 'fallback' ? displayUrl(preview.url) : undefined)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  useEffect(() => {
    if (announcedStatus.current === preview.status) return
    announcedStatus.current = preview.status
    setAnnouncement(
      preview.status === 'loading'
        ? words.linkPreviewLoading
        : preview.status === 'ready'
          ? `${words.linkPreviewReady} ${title}`
          : words.linkPreviewUnavailable,
    )
  }, [preview.status, title])

  useEffect(() => {
    if (preview.status !== 'loading') return
    if (preview.status === 'loading' && loadedPreview.status !== 'loading') {
      setLinkPreview(cardId, durableLinkPreview(loadedPreview))
      return
    }
    let current = true
    void loadLinkPreview(preview.url).then((resolved) => {
      if (!current) return
      setLoadedPreview(resolved)
      setLinkPreview(cardId, durableLinkPreview(resolved))
    })
    return () => {
      current = false
    }
  }, [cardId, loadedPreview.status, preview.status, preview.url, setLinkPreview])

  // A Profile stores a preview's words and never its pictures (see
  // durableLinkPreview), so a Board reopened tomorrow restores every tile
  // text-only and reads as broken. The picture is fetched back once, here.
  //
  // Once per address per SESSION, not per mount: the loader's own cache is
  // that memory, and it is written for every answer including a poor one, so
  // a site that has no image, or a machine that is offline, is asked exactly
  // once and never again until the app restarts. That is what keeps this from
  // becoming the repeating fetch a mount-time request would otherwise be, with
  // a Note carrying four of these tiles and a Board carrying many Notes.
  useEffect(() => {
    if (preview.status !== 'ready' || hasPreviewMedia(visiblePreview)) return
    if (cachedLinkPreview(preview.url)) return
    let current = true
    void loadLinkPreview(preview.url).then((resolved) => {
      // Offline, or the page stopped answering: the words already on screen
      // are worth more than the fallback's nothing, so they stay. Nothing is
      // written back to the Card either -- this restores what the Profile
      // deliberately does not keep, and must not dirty a Board to do it.
      if (current && resolved.status === 'ready') setLoadedPreview(resolved)
    })
    return () => {
      current = false
    }
  }, [preview.status, preview.url, visiblePreview])

  const retryPreview = () => {
    if (retrying || preview.status === 'loading') return
    const loading = { url: preview.url, status: 'loading' } as const
    setRetrying(true)
    if (preview.status !== 'ready') setLoadedPreview(loading)
    if (preview.status !== 'ready') setLinkPreview(cardId, loading)
    void loadLinkPreview(preview.url).then((resolved) => {
      if (!mounted.current) return
      const preserveDurableMetadata = preview.status === 'ready' && resolved.status === 'fallback'
      setLoadedPreview(preserveDurableMetadata ? preview : resolved)
      setRetrying(false)
      if (!preserveDurableMetadata) setLinkPreview(cardId, durableLinkPreview(resolved))
    })
  }

  return (
    <div className="link-preview-frame has-actions">
      <span className="link-preview-announcement" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      <a
        // No nodrag/nopan here: a press-and-move starting on the preview
        // must fall through to the Card's own React Flow drag, exactly like
        // an image tile's open button. draggable={false} plus the dragstart
        // refusal below (ec340c92) already stop the browser's native
        // link-drag ghost; a plain click (no movement past the drag
        // threshold) still fires this anchor's normal navigation. The
        // refresh/remove controls below keep their own nodrag/nopan so they
        // stay clickable without ever starting a Card drag.
        className="link-preview-card"
        href={preview.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={label}
        aria-describedby={description
          ? `${cardId}-link-preview-description`
          : undefined}
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
      >
        {visiblePreview.imageDataUrl ? (
          <img
            className="link-preview-image"
            src={visiblePreview.imageDataUrl}
            alt=""
            draggable={false}
          />
        ) : null}
        <span className="link-preview-copy">
          {preview.status === 'loading' ? (
            <StateWord className="link-preview-loading" tone="running">
              {words.linkPreviewLoading}
            </StateWord>
          ) : (
            <>
              {/* The title carries a favicon of its own, shown only in the
                  chip shape, where the tile is too short for a site row and
                  the mark would otherwise be the first thing lost. */}
              <span className="link-preview-headline">
                <span className="link-preview-site-mark link-preview-compact-mark" aria-hidden="true">
                  {visiblePreview.faviconDataUrl ? (
                    <img src={visiblePreview.faviconDataUrl} alt="" draggable={false} />
                  ) : (
                    <Globe2 />
                  )}
                </span>
                <strong className="link-preview-title t-title">{title}</strong>
              </span>
              {description ? (
                <span
                  id={`${cardId}-link-preview-description`}
                  className="link-preview-description e-prose t-prose-s"
                >
                  {description}
                </span>
              ) : null}
            </>
          )}
          <span className="link-preview-site t-ui">
            <span className="link-preview-site-mark" aria-hidden="true">
              {visiblePreview.faviconDataUrl ? (
                <img src={visiblePreview.faviconDataUrl} alt="" draggable={false} />
              ) : (
                <Globe2 />
              )}
            </span>
            <span className="link-preview-site-name">
              {visiblePreview.siteName?.trim() || hostname}
            </span>
            <span className="link-preview-open-icon" aria-hidden="true">
              <ExternalLink />
            </span>
          </span>
        </span>
      </a>
      {/* Refresh leads and Remove follows, the same order the local HTML
          preview's rail already used, so the two preview tiles in one carousel
          read as one control. The rail itself is hover-and-focus revealed by
          the stylesheet; both keys stay in the DOM and stay focusable, so a
          keyboard reaches them without a pointer ever touching the tile. */}
      <span className="link-preview-actions">
        <IconButton
          className="link-preview-retry nodrag nopan"
          variant="ghost"
          size="compact"
          label={retrying || preview.status === 'loading'
            ? words.refreshingLinkPreview
            : preview.status === 'ready'
              ? words.refreshLinkPreview
              : words.retryLinkPreview}
          icon={<RefreshCw />}
          onClick={retryPreview}
          aria-disabled={retrying || preview.status === 'loading'}
          aria-busy={retrying || preview.status === 'loading'}
        />
        <IconButton
          className="link-preview-remove nodrag nopan"
          variant="ghost"
          size="compact"
          label={words.removeLinkPreview}
          icon={<X />}
          // Named, so the X closes the tile it sits on. A Note can carry
          // several previews now; an unnamed remove would take them all.
          onClick={() => removeNotePreview(cardId, preview.url)}
        />
      </span>
    </div>
  )
}

function displayHostname(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '')
  } catch {
    return value
  }
}

// The domain half of an address is already on screen twice over (the title
// falls back to it, and the site row always shows it), so only the part that
// says something new -- the path, query and hash -- earns a second look here.
// A bare origin ("https://drybread.studio/") has nothing left after that, so
// it collapses back to the domain instead of a lone trailing slash.
function displayUrl(value: string): string {
  try {
    const url = new URL(value)
    const host = url.hostname.replace(/^www\./i, '')
    const rest = `${url.pathname}${url.search}${url.hash}`.replace(/\/$/, '')
    return rest ? `${host}${rest}` : host
  } catch {
    return value
  }
}

function hasPreviewMedia(preview: LoadedLinkPreview): boolean {
  return Boolean(preview.imageDataUrl || preview.faviconDataUrl)
}

function usableCachedPreview(preview: LoadedLinkPreview): LoadedLinkPreview | undefined {
  const cached = cachedLinkPreview(preview.url)
  return preview.status === 'ready' && cached?.status === 'fallback' ? undefined : cached
}
