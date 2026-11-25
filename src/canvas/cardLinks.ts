import { parseCardDeepLink } from '../shared/deepLinks'

// Card bodies render markdown with plain anchors in it. When a click lands on
// an anchor whose href is a card link into this same app, the Board should
// move the viewport instead of the browser opening a tab. The Board listens
// for this event; cards only announce the href.
export const CARD_LINK_EVENT = 'eido:card-link'

export type CardLinkEventDetail = { href: string }

type CardTextClick = {
  target: EventTarget | null
  button: number
  metaKey: boolean
  ctrlKey: boolean
  shiftKey: boolean
  preventDefault: () => void
  stopPropagation: () => void
}

function sameAppOrigin(href: string): boolean {
  try {
    return new URL(href).origin === window.location.origin
  } catch {
    return false
  }
}

function goesAway(href: string): boolean {
  try {
    const { protocol } = new URL(href)
    return protocol === 'http:' || protocol === 'https:'
  } catch {
    return false
  }
}

// Returns true when the click landed on a link, so callers skip their own
// click action (a note body would otherwise start editing). Card links into
// this app navigate in place. Every web address leaves: opened here rather
// than left to the anchor's own target, so a page always arrives in a new tab
// and never over the Board, which is the same journey the run trail's
// addresses make and now the same code path. Modifier clicks keep their
// default, because the person has already said where they want it.
export function followCardTextLink(event: CardTextClick): boolean {
  if (!(event.target instanceof Element)) return false
  const link = event.target.closest('a[href]')
  if (!(link instanceof HTMLAnchorElement)) return false
  if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return true

  const href = link.href
  if (sameAppOrigin(href) && parseCardDeepLink(href)) {
    event.preventDefault()
    event.stopPropagation()
    window.dispatchEvent(new CustomEvent<CardLinkEventDetail>(CARD_LINK_EVENT, { detail: { href } }))
    return true
  }

  if (goesAway(href)) {
    event.preventDefault()
    window.open(href, '_blank', 'noopener,noreferrer')
  }
  return true
}
