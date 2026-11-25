import { describe, expect, it } from 'vitest'
import { words } from './words'

const FORBIDDEN_SAAS_WORDS = [
  'configure',
  'manage',
  'enable',
  'workspace',
  'preferences',
  'optimize',
  'leverage',
  'seamless',
] as const

describe('user-visible copy', () => {
  it('keeps running words ready for the shared pulse instead of spelling an ellipsis', () => {
    expect(words.runningState).toBe('Running')
    expect(words.transcriptStreaming).toBe('Writing')
  })

  it('keeps system-owned chips to one word', () => {
    expect([words.chainThisCard, words.builtIn]).toEqual(['Target', 'Built-in'])
  })

  it('keeps SaaS vocabulary out of the user-visible words boundary', () => {
    const visibleCopy = Object.values(words).join('\n').toLowerCase()

    for (const word of FORBIDDEN_SAAS_WORDS) {
      expect(visibleCopy, `forbidden user-visible word: ${word}`)
        .not.toMatch(new RegExp(`\\b${word}(?:s|d|ing)?\\b`, 'i'))
    }
  })

  // House style bans the em dash outright, in product copy as well as in
  // writing about the product. It is banned as a glyph too, so a dash standing
  // in for "no value here" is an en dash. Pinned here because copy arrives from
  // many hands and an em dash is invisible in review: it looks like a hyphen.
  it('keeps the em dash out of every user-visible string', () => {
    for (const [key, value] of Object.entries(words)) {
      if (typeof value !== 'string') continue
      expect(value, `em dash in words.${key}`).not.toContain('\u2014')
    }
  })

  it('does not retain prose removed from the Context surfaces', () => {
    for (const obsoleteKey of [
      'versionContextNote',
      'ctxConversationNote',
      'peekIntro',
      'chainPreviewGateIntro',
      'chainPreviewPeekIntro',
      'chainFreshOne',
      'chainFreshMany',
      'chainAllFresh',
      'chainAllFreshHint',
    ]) {
      expect(words).not.toHaveProperty(obsoleteKey)
    }
  })
})
