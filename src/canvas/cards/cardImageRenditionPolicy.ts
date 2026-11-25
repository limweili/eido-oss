import type { CardAsset } from '../../graph/types'

const PASSIVE_CARD_DEMAND = { purpose: 'passive-card', width: 240, height: 180 } as const
const CARD_THUMBNAIL_DEMAND = { purpose: 'card-thumbnail', width: 144, height: 108 } as const

/** The preview membership and passive rendition key consumed by every Card surface. */
export function cardImageRenditionPlan(assets: readonly CardAsset[]) {
  const images = assets.filter((asset) => asset.kind === 'image')
  const compact = images.length > 4
  return {
    images,
    previewImages: compact ? images.slice(0, 4) : images,
    passiveDemand: compact ? CARD_THUMBNAIL_DEMAND : PASSIVE_CARD_DEMAND,
  }
}
