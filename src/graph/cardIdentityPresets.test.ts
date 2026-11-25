import { describe, expect, it } from 'vitest'
import {
  CARD_IDENTITY_PRESETS,
  cardIdentityPresetSolid,
  type CardIdentityPresetId,
} from './cardIdentityPresets'

describe('saved Card identity presets', () => {
  it('maps the twelve stable approved preset ids to their persisted solids in palette order', () => {
    const expected = [
      ['coral', '#f1666d'],
      ['red', '#c9282e'],
      ['amber', '#eca23b'],
      ['orange', '#b5540f'],
      ['mint', '#65b563'],
      ['green', '#1b7550'],
      ['sky', '#48a2ef'],
      ['blue', '#3568c6'],
      ['orchid', '#d66be8'],
      ['purple', '#9c3fba'],
      ['slate', '#8b939c'],
      ['charcoal', '#2e2b25'],
    ] as const satisfies readonly (readonly [CardIdentityPresetId, string])[]

    expect(CARD_IDENTITY_PRESETS.map(({ id, solid }) => [id, solid])).toEqual(expected)
    for (const [id, solid] of expected) expect(cardIdentityPresetSolid(id)).toBe(solid)
    expect(cardIdentityPresetSolid('Purple')).toBeUndefined()
    expect(cardIdentityPresetSolid('unknown')).toBeUndefined()
  })
})
