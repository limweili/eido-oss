import { ExternalLink, Globe2, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { CardAsset } from '../../graph/types'
import { useGraph } from '../../graph/store'
import type { LocalHtmlPreview } from '../../shared/localHtmlPreview'
import { loadLocalHtmlPreview } from '../../shared/loadLinkPreview'
import { getImageRenditionResolver } from '../../shared/imageRenditions'
import { words } from '../../shared/words'
import { IconButton, StateWord } from '../../ui/primitives'
import { RenditionImage } from './ImageGallery'

export function NoteLocalHtmlPreview({
  cardId,
  preview,
  assets,
}: Readonly<{
  cardId: string
  preview: LocalHtmlPreview
  assets: CardAsset[]
}>) {
  const settle = useGraph((state) => state.settleLocalHtmlPreview)
  const fail = useGraph((state) => state.failLocalHtmlPreview)
  const removeNotePreview = useGraph((state) => state.removeNotePreview)
  const announcedStatus = useRef<typeof preview.status | undefined>(
    preview.status === 'loading' ? undefined : preview.status,
  )
  const [refreshing, setRefreshing] = useState(false)
  const [announcement, setAnnouncement] = useState('')
  const asset = assets.find((candidate) => candidate.id === preview.assetId)
  const title = preview.title?.trim() || preview.name
  const resolver = getImageRenditionResolver()

  useEffect(() => {
    if (announcedStatus.current === preview.status) return
    announcedStatus.current = preview.status
    setAnnouncement(
      preview.status === 'loading'
        ? words.renderingLocalHtmlPreview
        : preview.status === 'ready'
          ? `${words.linkPreviewReady} ${title}`
          : words.localHtmlPreviewUnavailable,
    )
  }, [preview.status, title])

  useEffect(() => {
    if (preview.status !== 'loading') return
    let current = true
    void loadLocalHtmlPreview(preview.sourceId).then(
      (capture) => {
        if (current) settle(cardId, capture)
      },
      () => {
        if (current) fail(cardId, preview.sourceId)
      },
    )
    return () => {
      current = false
    }
  }, [cardId, fail, preview.sourceId, preview.status, settle])

  const retry = () => {
    if (preview.status === 'loading' || refreshing) return
    setRefreshing(true)
    setAnnouncement(words.renderingLocalHtmlPreview)
    void loadLocalHtmlPreview(preview.sourceId, true).then(
      (capture) => {
        settle(cardId, capture)
        setAnnouncement(`${words.linkPreviewReady} ${capture.title?.trim() || title}`)
      },
      () => fail(cardId, preview.sourceId),
    ).finally(() => setRefreshing(false))
  }

  const openOriginal = () => {
    const request = window.eidoLinkPreviews?.openLocal(preview.sourceId)
    if (!request) return
    void request.then(
      (opened) => { if (!opened) fail(cardId, preview.sourceId) },
      () => fail(cardId, preview.sourceId),
    )
  }

  return (
    <div className="link-preview-frame local-html-preview-frame has-actions">
      <span className="link-preview-announcement" role="status" aria-live="polite" aria-atomic="true">
        {announcement}
      </span>
      <button
        type="button"
        className="link-preview-card local-html-preview-card nodrag nopan"
        aria-label={`${words.openLocalHtmlPreview} ${title}`}
        onClick={openOriginal}
        // Same treatment ec340c92 gave the website preview anchor: a press that
        // begins here must reach the Card's drag gesture, not a native drag.
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
      >
        {asset ? (
          <RenditionImage
            className="link-preview-image"
            asset={asset}
            resolver={resolver}
            purpose="active-card"
            width={600}
            height={338}
            alt={title}
            draggable={false}
          />
        ) : (
          <span className="local-html-preview-placeholder" aria-hidden="true">
            <Globe2 />
          </span>
        )}
        <span className="link-preview-copy">
          {preview.status === 'loading' || refreshing ? (
            <StateWord className="link-preview-loading" tone="running">
              {words.renderingLocalHtmlPreview}
            </StateWord>
          ) : (
            // Same title line as the website preview, so one stylesheet rule
            // reserves the action rail's gutter for both tiles.
            <span className="link-preview-headline">
              <span className="link-preview-site-mark link-preview-compact-mark" aria-hidden="true">
                <Globe2 />
              </span>
              <strong className="link-preview-title t-title">{title}</strong>
            </span>
          )}
          <span className="link-preview-site t-ui">
            <span className="link-preview-site-mark" aria-hidden="true"><Globe2 /></span>
            <span className="link-preview-site-name">{preview.name}</span>
            {preview.status === 'unavailable' ? (
              <span>{words.localHtmlPreviewUnavailable}</span>
            ) : (
              <ExternalLink className="link-preview-open-icon" aria-hidden="true" />
            )}
          </span>
        </span>
      </button>
      <span className="link-preview-actions">
        <IconButton
          className="link-preview-retry nodrag nopan"
          variant="ghost"
          size="compact"
          label={refreshing ? words.refreshingLinkPreview : words.refreshLinkPreview}
          icon={<RefreshCw />}
          onClick={retry}
          aria-disabled={preview.status === 'loading' || refreshing}
          aria-busy={refreshing}
        />
        <IconButton
          className="link-preview-remove nodrag nopan"
          variant="ghost"
          size="compact"
          label={words.removeLinkPreview}
          icon={<X />}
          onClick={() => removeNotePreview(cardId)}
        />
      </span>
    </div>
  )
}
