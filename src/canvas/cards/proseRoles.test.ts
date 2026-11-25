import { describe, expect, it } from 'vitest'
import {
  LEGACY_NOTE_FONT_STEPS,
  NOTE_FONT_STEP_DEFAULT,
  NOTE_FONT_STEP_MAX,
  NOTE_FONT_STEP_TOKENS,
  designTokensForTheme,
  normalizeNoteFontStep,
} from '../../ui/tokens'
import { noteFontStep, proseRoleClass } from './proseRoles'

describe('the Note text ladder', () => {
  it('renders the retired Small, Medium and Large at exactly the sizes they always were', () => {
    const tokens = designTokensForTheme('light')
    // The promise a reader cares about: nothing they already wrote changes
    // size. Steps 1, 2 and 3 read 14px, 15px and 18px, the three prose sizes
    // the named control set.
    expect(NOTE_FONT_STEP_TOKENS.slice(0, 3).map((token) => tokens[token]))
      .toEqual(['14px', '15px', '18px'])
    expect(proseRoleClass(LEGACY_NOTE_FONT_STEPS.small)).toBe('t-prose-s')
    expect(proseRoleClass(LEGACY_NOTE_FONT_STEPS.medium)).toBe('t-prose-m')
    expect(proseRoleClass(LEGACY_NOTE_FONT_STEPS.large)).toBe('t-prose-l')
  })

  it('reads a Note with no stored size at the step the old default rendered', () => {
    expect(NOTE_FONT_STEP_DEFAULT).toBe(LEGACY_NOTE_FONT_STEPS.medium)
    expect(noteFontStep(undefined)).toBe(NOTE_FONT_STEP_DEFAULT)
    expect(proseRoleClass(undefined)).toBe('t-prose-m')
  })

  it('gives every step a role and grows the ladder above the old Large', () => {
    expect(NOTE_FONT_STEP_MAX).toBeGreaterThan(LEGACY_NOTE_FONT_STEPS.large)
    const roles = Array.from({ length: NOTE_FONT_STEP_MAX }, (_unused, index) => proseRoleClass(index + 1))
    expect(new Set(roles).size).toBe(NOTE_FONT_STEP_MAX)
    expect(roles.every((role) => typeof role === 'string' && role.length > 0)).toBe(true)
  })

  it('maps the retired names and falls back to the default for a size it cannot place', () => {
    expect(normalizeNoteFontStep('small')).toBe(1)
    expect(normalizeNoteFontStep('medium')).toBe(2)
    expect(normalizeNoteFontStep('large')).toBe(3)
    for (const unplaceable of ['gigantic', 0, -1, 1.5, NOTE_FONT_STEP_MAX + 1, null, {}]) {
      expect(normalizeNoteFontStep(unplaceable)).toBeUndefined()
      expect(noteFontStep(unplaceable)).toBe(NOTE_FONT_STEP_DEFAULT)
    }
  })
})
