export type CardDeepLinkViewport = {
  x: number
  y: number
  zoom: number
}

export type CardDeepLink = {
  ideaId: string
  cardId: string
  viewport?: CardDeepLinkViewport
}

const IDEA_PARAM = 'idea'
const CARD_PARAM = 'card'
const X_PARAM = 'x'
const Y_PARAM = 'y'
const ZOOM_PARAM = 'zoom'
const LINK_PARAMS = [IDEA_PARAM, CARD_PARAM, X_PARAM, Y_PARAM, ZOOM_PARAM]

function finiteNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function cleanNumber(value: number, decimals: number): string {
  return Number(value.toFixed(decimals)).toString()
}

export function parseCardDeepLink(href: string): CardDeepLink | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }

  const ideaId = url.searchParams.get(IDEA_PARAM)?.trim()
  const cardId = url.searchParams.get(CARD_PARAM)?.trim()
  if (!ideaId || !cardId) return null

  const x = finiteNumber(url.searchParams.get(X_PARAM))
  const y = finiteNumber(url.searchParams.get(Y_PARAM))
  const zoom = finiteNumber(url.searchParams.get(ZOOM_PARAM))
  const viewport = x !== undefined && y !== undefined && zoom !== undefined ? { x, y, zoom } : undefined

  return { ideaId, cardId, viewport }
}

export function cardDeepLinkKey(link: CardDeepLink): string {
  const viewport = link.viewport
    ? `${cleanNumber(link.viewport.x, 2)}:${cleanNumber(link.viewport.y, 2)}:${cleanNumber(link.viewport.zoom, 4)}`
    : 'center'
  return `${link.ideaId}:${link.cardId}:${viewport}`
}

export function formatCardDeepLink(baseHref: string, link: CardDeepLink): string {
  const url = new URL(baseHref)
  url.searchParams.set(IDEA_PARAM, link.ideaId)
  url.searchParams.set(CARD_PARAM, link.cardId)
  if (link.viewport) {
    url.searchParams.set(X_PARAM, cleanNumber(link.viewport.x, 2))
    url.searchParams.set(Y_PARAM, cleanNumber(link.viewport.y, 2))
    url.searchParams.set(ZOOM_PARAM, cleanNumber(link.viewport.zoom, 4))
  } else {
    url.searchParams.delete(X_PARAM)
    url.searchParams.delete(Y_PARAM)
    url.searchParams.delete(ZOOM_PARAM)
  }
  return url.toString()
}

export function stripCardDeepLink(baseHref: string): string {
  const url = new URL(baseHref)
  for (const param of LINK_PARAMS) {
    url.searchParams.delete(param)
  }
  return url.toString()
}
