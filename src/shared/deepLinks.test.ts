import { describe, expect, it } from 'vitest'
import { cardDeepLinkKey, formatCardDeepLink, parseCardDeepLink, stripCardDeepLink } from './deepLinks'

describe('card deep links', () => {
  it('formats and parses idea, card, and viewport coordinates', () => {
    const href = formatCardDeepLink('https://example.test/app?theme=quiet', {
      ideaId: 'idea-one',
      cardId: 'note-two',
      viewport: { x: -123.456, y: 78.9, zoom: 1.23456 },
    })

    expect(href).toBe('https://example.test/app?theme=quiet&idea=idea-one&card=note-two&x=-123.46&y=78.9&zoom=1.2346')
    expect(parseCardDeepLink(href)).toEqual({
      ideaId: 'idea-one',
      cardId: 'note-two',
      viewport: { x: -123.46, y: 78.9, zoom: 1.2346 },
    })
  })

  it('keeps a card target usable when coordinates are absent or incomplete', () => {
    expect(parseCardDeepLink('https://example.test/?idea=idea-one&card=note-two')).toEqual({
      ideaId: 'idea-one',
      cardId: 'note-two',
    })
    expect(parseCardDeepLink('https://example.test/?idea=idea-one&card=note-two&x=10&zoom=1')).toEqual({
      ideaId: 'idea-one',
      cardId: 'note-two',
    })
  })

  it('rejects links without both idea and card ids', () => {
    expect(parseCardDeepLink('https://example.test/?idea=idea-one')).toBeNull()
    expect(parseCardDeepLink('https://example.test/?card=note-two')).toBeNull()
    expect(parseCardDeepLink('not a url')).toBeNull()
  })

  it('removes only card-link params when returning to a plain board URL', () => {
    expect(stripCardDeepLink('https://example.test/?idea=i&card=c&x=1&y=2&zoom=3&theme=quiet')).toBe(
      'https://example.test/?theme=quiet',
    )
  })

  it('creates stable keys for equivalent rounded viewport links', () => {
    expect(
      cardDeepLinkKey({
        ideaId: 'idea-one',
        cardId: 'note-two',
        viewport: { x: 10.001, y: 5.004, zoom: 0.99999 },
      }),
    ).toBe('idea-one:note-two:10:5:1')
  })
})
