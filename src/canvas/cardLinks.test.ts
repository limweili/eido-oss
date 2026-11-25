// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CARD_LINK_EVENT, followCardTextLink, type CardLinkEventDetail } from './cardLinks'

function renderAnchor(href: string, label = 'jump') {
  const container = document.createElement('div')
  container.innerHTML = `<p>before <a href="${href}" target="_blank" rel="noreferrer"><span>${label}</span></a> after</p>`
  document.body.appendChild(container)
  return container
}

function click(target: EventTarget | null, overrides: Partial<{ button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean }> = {}) {
  return {
    target,
    button: 0,
    metaKey: false,
    ctrlKey: false,
    shiftKey: false,
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...overrides,
  }
}

function listenForCardLink() {
  const seen: string[] = []
  const listener = (event: Event) => {
    seen.push((event as CustomEvent<CardLinkEventDetail>).detail.href)
  }
  window.addEventListener(CARD_LINK_EVENT, listener)
  return { seen, stop: () => window.removeEventListener(CARD_LINK_EVENT, listener) }
}

let opened: Array<unknown[]> = []
const realOpen = window.open

beforeEach(() => {
  opened = []
  window.open = ((...args: unknown[]) => {
    opened.push(args)
    return null
  }) as typeof window.open
})

afterEach(() => {
  window.open = realOpen
  document.body.innerHTML = ''
})

describe('followCardTextLink', () => {
  const cardHref = `${window.location.origin}/?idea=idea_1&card=note_2&x=-390&y=-290&zoom=1`

  it('keeps a same-app card link in the app: announces it and blocks the new tab', () => {
    const container = renderAnchor(cardHref)
    const { seen, stop } = listenForCardLink()
    const event = click(container.querySelector('span'))

    expect(followCardTextLink(event)).toBe(true)
    expect(seen).toEqual([cardHref])
    expect(event.preventDefault).toHaveBeenCalled()
    stop()
  })

  it('sends a card link on another site away to its own tab', () => {
    const container = renderAnchor('https://elsewhere.test/?idea=idea_1&card=note_2')
    const { seen, stop } = listenForCardLink()
    const event = click(container.querySelector('a'))

    expect(followCardTextLink(event)).toBe(true)
    expect(seen).toEqual([])
    expect(event.preventDefault).toHaveBeenCalled()
    expect(opened).toEqual([
      ['https://elsewhere.test/?idea=idea_1&card=note_2', '_blank', 'noopener,noreferrer'],
    ])
    stop()
  })

  it('opens an ordinary web address in a new tab rather than over the Board', () => {
    const container = renderAnchor('https://example.test/docs')
    const { seen, stop } = listenForCardLink()
    const event = click(container.querySelector('a'))

    expect(followCardTextLink(event)).toBe(true)
    expect(seen).toEqual([])
    expect(event.preventDefault).toHaveBeenCalled()
    expect(opened).toEqual([['https://example.test/docs', '_blank', 'noopener,noreferrer']])
    // The Card still gets the click, so pressing an address inside it also
    // selects it, exactly as pressing any other part of its prose does.
    expect(event.stopPropagation).not.toHaveBeenCalled()
    stop()
  })

  it('leaves an address it cannot open to the browser', () => {
    const container = renderAnchor('mailto:someone@example.test')
    const event = click(container.querySelector('a'))

    expect(followCardTextLink(event)).toBe(true)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(opened).toEqual([])
  })

  it('respects open-in-new-tab modifiers on card links', () => {
    const container = renderAnchor(cardHref)
    const { seen, stop } = listenForCardLink()
    const event = click(container.querySelector('a'), { metaKey: true })

    expect(followCardTextLink(event)).toBe(true)
    expect(seen).toEqual([])
    expect(event.preventDefault).not.toHaveBeenCalled()
    stop()
  })

  it('ignores clicks that are not on a link', () => {
    const container = renderAnchor(cardHref)
    const event = click(container.querySelector('p'))

    expect(followCardTextLink(event)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
})
