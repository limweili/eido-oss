import { describe, expect, it, vi } from 'vitest'
import { CONTEXT_CONTRACTS } from '../../graph/contextContracts'
import type { CardKind, Connection } from '../../graph/types'
import { connectionEditorModel, moveConnectionStrengthByArrow } from './connectionEditor'

const connection = (overrides: Partial<Connection> = {}): Connection => ({
  id: 'c1',
  from: { cardId: 'a' },
  to: { cardId: 'b' },
  strength: 'strong',
  polarity: 'helps',
  role: 'feeds',
  ...overrides,
})

describe('connectionEditorModel', () => {
  it('offers polarity and strength, but no reason, for a Helps connection', () => {
    const model = connectionEditorModel(connection(), 'note')
    expect(model).toMatchObject({
      isMod: false,
      showPolarity: true,
      showStrength: true,
      showReason: false,
      showGroupMode: false,
    })
  })

  it('offers the reason field only for Avoid connections', () => {
    expect(connectionEditorModel(connection({ polarity: 'pushesAgainst' }), 'note').showReason).toBe(true)
    expect(connectionEditorModel(connection({ polarity: 'helps' }), 'note').showReason).toBe(false)
  })

  it('hides polarity and reason for a Mod connection and flags the hint', () => {
    const model = connectionEditorModel(
      connection({ role: 'modifies', polarity: 'pushesAgainst' }),
      'mod',
    )
    expect(model).toMatchObject({
      isMod: true,
      showPolarity: false,
      showStrength: true,
      showReason: false,
      showGroupMode: false,
    })
  })

  it('shows the group choice exactly when the source contract asks for it', () => {
    for (const kind of Object.keys(CONTEXT_CONTRACTS) as CardKind[]) {
      expect(connectionEditorModel(connection(), kind).showGroupMode).toBe(
        CONTEXT_CONTRACTS[kind].presentation.groupModeToggle,
      )
    }
  })

  it('shows no group choice when the source card is missing', () => {
    expect(connectionEditorModel(connection(), undefined).showGroupMode).toBe(false)
  })

  it('wraps arrow-key selection and focus through the two strength specimens', () => {
    const strong = { focus: vi.fn() }
    const weak = { focus: vi.fn() }
    const onSelect = vi.fn()

    for (const [current, key, next] of [
      ['strong', 'ArrowRight', 'weak'],
      ['weak', 'ArrowDown', 'strong'],
      ['strong', 'ArrowLeft', 'weak'],
      ['weak', 'ArrowUp', 'strong'],
    ] as const) {
      strong.focus.mockClear()
      weak.focus.mockClear()
      onSelect.mockClear()

      expect(
        moveConnectionStrengthByArrow({
          current,
          key,
          targets: { strong, weak },
          onSelect,
        }),
      ).toBe(true)
      expect(onSelect).toHaveBeenCalledWith(next)
      expect(next === 'strong' ? strong.focus : weak.focus).toHaveBeenCalledOnce()
    }
  })
})
