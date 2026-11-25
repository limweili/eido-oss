import { describe, expect, it } from 'vitest'
import {
  connectionAppearance,
  connectionColor,
  connectionPreviewAppearance,
} from './connectionAppearance'

describe('connectionAppearance', () => {
  it('keeps Direct and Light solid while strength owns only the line weight', () => {
    expect(
      connectionAppearance({ strength: 'strong', polarity: 'helps', role: 'feeds' }),
    ).toEqual({ colorRole: 'helps', strokeWidth: 3, dash: [], opacity: 1 })
    expect(
      connectionAppearance({ strength: 'weak', polarity: 'helps', role: 'feeds' }),
    ).toEqual({ colorRole: 'helps', strokeWidth: 1.5, dash: [], opacity: 1 })
  })

  it('gives Avoid and Mod the one shared 0.1 / 7 dotted character', () => {
    expect(
      connectionAppearance({ strength: 'strong', polarity: 'pushesAgainst', role: 'feeds' }),
    ).toEqual({ colorRole: 'avoid', strokeWidth: 3, dash: [0.1, 7], opacity: 1 })
    expect(
      connectionAppearance({ strength: 'weak', polarity: 'helps', role: 'modifies' }),
    ).toEqual({ colorRole: 'modifies', strokeWidth: 1.5, dash: [0.1, 7], opacity: 1 })
  })

  it('maps every semantic line role to the token its arrowhead must share', () => {
    expect(connectionColor('helps')).toBe('var(--e-go)')
    expect(connectionColor('avoid')).toBe('var(--e-avoid)')
    expect(connectionColor('modifies')).toBe('var(--e-mod)')
  })

  it('treats ghosting as opacity-only and hover as width-only', () => {
    expect(
      connectionAppearance({
        strength: 'weak',
        polarity: 'pushesAgainst',
        role: 'feeds',
        ghost: true,
        hovered: true,
      }),
    ).toEqual({ colorRole: 'avoid', strokeWidth: 2.7, dash: [0.1, 7], opacity: 0.42 })
  })

  it('uses the same dotted character for a connection-creation preview', () => {
    expect(connectionPreviewAppearance()).toEqual({ strokeWidth: 2.5, dash: [0.1, 7], opacity: 0.9 })
  })
})
