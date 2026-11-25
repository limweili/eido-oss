import { type ReactNode, useState } from 'react'
import type { CardAsset } from '../../graph/types'
import type { LoadedLinkPreview } from '../../shared/linkPreview'
import type { LocalHtmlPreview } from '../../shared/localHtmlPreview'
import { words } from '../../shared/words'
import { AttachmentPanel, AttachmentPanelItem } from './AttachmentPanel'
import { NoteLinkPreview } from './NoteLinkPreview'
import { NoteLocalHtmlPreview } from './NoteLocalHtmlPreview'

/**
 * Attached previews, in the second panel below the images.
 *
 * A Note carries a preview for each web link its body holds, plus at most one
 * local HTML preview, and this panel lays them out as one track: the even tile
 * width and the active-tile ring already work on N previews. Tiles keep body
 * order, so the carousel reads the way the Note does.
 */
export function NotePreviewPanel({
  cardId,
  selected,
  linkPreviews = [],
  localHtmlPreview,
  assets,
}: Readonly<{
  cardId: string
  selected: boolean
  linkPreviews?: readonly LoadedLinkPreview[]
  localHtmlPreview?: LocalHtmlPreview
  assets: CardAsset[]
}>) {
  const [lastTouchedKey, setLastTouchedKey] = useState<string | null>(null)
  const previews: { key: string; node: ReactNode }[] = []
  for (const linkPreview of linkPreviews) {
    previews.push({
      key: `link:${linkPreview.url}`,
      node: <NoteLinkPreview cardId={cardId} preview={linkPreview} />,
    })
  }
  if (localHtmlPreview) {
    previews.push({
      key: `local:${localHtmlPreview.sourceId}`,
      node: (
        <NoteLocalHtmlPreview
          cardId={cardId}
          preview={localHtmlPreview}
          assets={assets}
        />
      ),
    })
  }
  if (!previews.length) return null
  // As in the images panel: the ring marks where the last gesture landed, so a
  // resting Card wears none.
  const activeKey = previews.some((preview) => preview.key === lastTouchedKey)
    ? lastTouchedKey
    : null

  return (
    <AttachmentPanel kind="previews" label={words.attachedPreviews} scrollable={selected}>
      {previews.map((preview) => (
        <AttachmentPanelItem
          key={preview.key}
          kind="preview"
          active={preview.key === activeKey}
          onActivate={() => setLastTouchedKey(preview.key)}
        >
          {preview.node}
        </AttachmentPanelItem>
      ))}
    </AttachmentPanel>
  )
}
