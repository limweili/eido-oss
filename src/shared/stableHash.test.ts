import { describe, expect, it } from 'vitest'
import { stableContentHash } from './stableHash'

describe('stable content hash', () => {
  it('gives semantically identical objects the same hash regardless of key insertion order', () => {
    const first = {
      prompt: 'Compress this',
      model: 'openai/gpt-4o-mini',
      sources: [
        { cardId: 'card-a', hash: 'alpha' },
        { cardId: 'card-b', hash: 'beta' },
      ],
    }
    const second = {
      sources: [
        { hash: 'alpha', cardId: 'card-a' },
        { hash: 'beta', cardId: 'card-b' },
      ],
      model: 'openai/gpt-4o-mini',
      prompt: 'Compress this',
    }

    expect(JSON.stringify(first)).not.toBe(JSON.stringify(second))
    expect(stableContentHash(first)).toBe(stableContentHash(second))
  })
})
