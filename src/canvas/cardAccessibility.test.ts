import { describe, expect, it, beforeEach } from 'vitest'
import type { Card } from '../graph/types'
import {
  cardLabelBodyScanCountForTests,
  resetCardLabelBodyScanCountForTests,
} from '../graph/graphHelpers'
import { cardAccessibilityName } from './cardAccessibility'

function giantNote(): Card {
  return {
    id: 'giant-accessibility-note',
    kind: 'note',
    blocks: Array.from({ length: 2_000 }, (_, index) => ({
      id: `giant-accessibility-block-${index}`,
      text: index === 0 ? `${'A'.repeat(1_000_000)}\nsecond line` : 'unused block',
    })),
    position: { x: 0, y: 0 },
  }
}

describe('Card accessibility semantic cache', () => {
  beforeEach(() => resetCardLabelBodyScanCountForTests())

  it('keeps an untitled million-character, high-block-count name stable across geometry records', () => {
    const card = giantNote()
    expect(cardAccessibilityName(card)).toBe('Note: ' + `${'A'.repeat(57)}…`)
    expect(cardLabelBodyScanCountForTests()).toBe(1)

    resetCardLabelBodyScanCountForTests()
    for (let step = 1; step <= 30; step += 1) {
      const moved = {
        ...card,
        position: { x: step * 7, y: step * 3 },
      }
      expect(cardAccessibilityName(moved)).toBe('Note: ' + `${'A'.repeat(57)}…`)
    }

    expect(cardLabelBodyScanCountForTests()).toBe(0)
    expect(cardAccessibilityName({ ...card, position: { x: 900, y: 900 } }, true)).toBe(
      'Note: ' + `${'A'.repeat(57)}…, Selected`,
    )
  })

  it('preserves the Mod-title then Card-title fallback precedence without rescanning geometry', () => {
    const blocks = [{ id: 'mod-label-block', text: 'Mod body' }]
    const card: Card = {
      id: 'mod-label',
      kind: 'mod',
      title: 'Card title',
      blocks,
      position: { x: 0, y: 0 },
      modV2: { kind: 'slider', title: '  Mod title  ' } as Card['modV2'],
    }
    expect(cardAccessibilityName(card)).toBe('Mod: Mod title')
    expect(cardAccessibilityName({ ...card, position: { x: 1, y: 1 } })).toBe('Mod: Mod title')
    expect(cardAccessibilityName({ ...card, modV2: { ...card.modV2!, title: '   ' }, position: { x: 2, y: 2 } })).toBe(
      'Mod: Card title',
    )
  })
})
