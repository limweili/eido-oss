import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { dragBlockingClass } from '../cardInteraction'
import type { CardAsset } from '../../graph/types'
import {
  getImageRenditionResolver,
  type ImageRenditionResolver,
} from '../../shared/imageRenditions'
import { words } from '../../shared/words'
import { IconButton, Tooltip } from '../../ui/primitives'
import { AttachmentPanel, AttachmentPanelItem } from './AttachmentPanel'
import { cardImageRenditionPlan } from './cardImageRenditionPolicy'
import { ImageGallery, RenditionImage } from './ImageGallery'

function prettySize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Every attached image, in one horizontal carousel pinned below the Note body.
 *
 * The old grid stacked thumbnails down the body and hid everything past the
 * fourth behind a "+N more" veil, so a narrow Card cropped the images it did
 * show and simply lost the ones it did not. A track has no such ceiling: all
 * images are always present and always reachable by scrolling.
 */
export function CardImagePanel({
  assets,
  selected,
  onRemove,
  renditionResolver,
}: {
  assets: CardAsset[]
  selected: boolean
  onRemove?: (id: string) => void
  renditionResolver?: ImageRenditionResolver | null
}) {
  const [galleryStartId, setGalleryStartId] = useState<string | null>(null)
  const [lastTouchedId, setLastTouchedId] = useState<string | null>(null)
  const imageResolver = renditionResolver === undefined
    ? getImageRenditionResolver()
    : renditionResolver
  // The plan still decides how big a rendition each image asks the resolver
  // for; it no longer decides which images exist on the Card.
  const { images, passiveDemand } = cardImageRenditionPlan(assets)
  if (!images.length) return null
  // Nothing is "the active one" until a gesture makes it so. A ring painted on
  // the first tile of every resting Card would be decoration, and two of them
  // on a Card carrying both panels would be noise.
  const activeId = images.some((image) => image.id === lastTouchedId) ? lastTouchedId : null

  return (
    <AttachmentPanel
      kind="images"
      label={words.attachedImages}
      scrollable={selected}
      overlay={galleryStartId ? (
        <ImageGallery
          images={images}
          startId={galleryStartId}
          onClose={() => setGalleryStartId(null)}
          onRemove={onRemove}
          renditionResolver={imageResolver}
        />
      ) : undefined}
    >
      {images.map((asset) => (
        <AttachmentPanelItem
          key={asset.id}
          kind="image"
          active={asset.id === activeId}
          onActivate={() => setLastTouchedId(asset.id)}
        >
          <Tooltip content={asset.name}>
            <button
              type="button"
              className="card-attachment-open"
              aria-label={asset.name}
              onClick={() => setGalleryStartId(asset.id)}
              onMouseEnter={() => prepareLiveImage(imageResolver, asset)}
              onFocus={() => prepareLiveImage(imageResolver, asset)}
              draggable={false}
              onDragStart={(event) => event.preventDefault()}
            >
              <RenditionImage
                asset={asset}
                alt={asset.name}
                draggable={false}
                onDragStart={(event) => event.preventDefault()}
                resolver={imageResolver}
                purpose={selected ? 'active-card' : passiveDemand.purpose}
                width={selected ? 480 : passiveDemand.width}
                height={selected ? 360 : passiveDemand.height}
              />
            </button>
          </Tooltip>
          {onRemove && (
            // The filename row this replaces cost a whole line under every
            // thumbnail. The name now rides the tooltip and the image's own
            // alt text, and the trash key surfaces on hover or keyboard focus.
            <RemoveAssetButton asset={asset} onRemove={onRemove} />
          )}
        </AttachmentPanelItem>
      ))}
    </AttachmentPanel>
  )
}

/**
 * Non-image attachments stay in the Note's flowing body. They are single
 * compact rows that a narrow Card ellipsizes rather than crops, so they never
 * had the problem the panels exist to solve.
 */
export function CardFileAttachments({
  assets,
  selected,
  onRemove,
}: {
  assets: CardAsset[]
  selected: boolean
  onRemove?: (id: string) => void
}) {
  const files = assets.filter((asset) => asset.kind !== 'image')
  if (!files.length) return null

  return (
    <div className={`asset-list ${dragBlockingClass(selected)}`}>
      {files.map((asset) => (
        <div className="asset-file t-ui" key={asset.id}>
          <span className="asset-file-icon t-micro">PDF</span>
          <span className="asset-file-name">{asset.name}</span>
          <span className="asset-file-size t-value">{prettySize(asset.size)}</span>
          {onRemove && (
            <RemoveAssetButton asset={asset} onRemove={onRemove} />
          )}
        </div>
      ))}
    </div>
  )
}

function RemoveAssetButton({
  asset,
  onRemove,
}: {
  asset: CardAsset
  onRemove: (id: string) => void
}) {
  return (
    <IconButton
      className="asset-remove nodrag nopan"
      variant="danger"
      size="compact"
      label={words.removeAsset}
      icon={<Trash2 aria-hidden="true" size={14} />}
      onClick={() => onRemove(asset.id)}
    />
  )
}

function prepareLiveImage(resolver: ImageRenditionResolver | null, asset: CardAsset) {
  if (!resolver) return
  void resolver.preload([
    {
      asset,
      demand: {
        purpose: 'active-card',
        width: 640,
        height: 480,
        visibility: 'preload',
        settled: true,
      },
    },
  ])
}
