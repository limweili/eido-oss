import { describe, expect, it } from 'vitest'
import { listModPartIdentities } from '../mods'
import { PROFILE_BUILT_IN_MOD_TEMPLATES } from './profileBuiltInMods'

describe('fresh Profile built-in Mods', () => {
  it('defines all eleven root-ID-free v2 templates with stable nested identities', () => {
    expect(PROFILE_BUILT_IN_MOD_TEMPLATES.map(({ templateId }) => templateId)).toEqual([
      'builtin-mod-mixer',
      'builtin-mod-filter',
      'builtin-mod-slider',
      'builtin-mod-dial',
      'builtin-mod-count',
      'builtin-mod-switch',
      'builtin-mod-pad',
      'builtin-mod-select',
      'builtin-mod-order',
      'builtin-mod-radar',
      'builtin-mod-matrix',
    ])
    expect(PROFILE_BUILT_IN_MOD_TEMPLATES.map(({ mod }) => mod.kind)).toEqual([
      'mixer',
      'filter',
      'slider',
      'dial',
      'count',
      'switch',
      'pad',
      'select',
      'order',
      'radar',
      'matrix',
    ])
    expect(PROFILE_BUILT_IN_MOD_TEMPLATES.every(({ mod }) => !('id' in mod))).toBe(true)

    const partIds = PROFILE_BUILT_IN_MOD_TEMPLATES.flatMap(({ mod }) => (
      listModPartIdentities(mod).map(({ sourceId }) => sourceId)
    ))
    expect(partIds).toEqual([
      'builtin-mod-mixer-item-0',
      'builtin-mod-mixer-item-1',
      'builtin-mod-mixer-item-2',
      'builtin-mod-filter-lane-0',
      'builtin-mod-slider-item-0',
      'builtin-mod-slider-item-1',
      'builtin-mod-dial-item-0',
      'builtin-mod-dial-item-1',
      'builtin-mod-dial-item-2',
      'builtin-mod-count-item-0',
      'builtin-mod-count-item-1',
      'builtin-mod-switch-item-0',
      'builtin-mod-switch-item-1',
      'builtin-mod-switch-item-2',
      'builtin-mod-pad-axis-0',
      'builtin-mod-pad-axis-1',
      'builtin-mod-select-option-0',
      'builtin-mod-select-option-1',
      'builtin-mod-select-option-2',
      'builtin-mod-select-option-3',
      'builtin-mod-order-item-0',
      'builtin-mod-order-item-1',
      'builtin-mod-order-item-2',
      'builtin-mod-radar-axis-0',
      'builtin-mod-radar-axis-1',
      'builtin-mod-radar-axis-2',
      'builtin-mod-radar-axis-3',
      'builtin-mod-radar-axis-4',
      'builtin-mod-matrix-row-0',
      'builtin-mod-matrix-row-1',
      'builtin-mod-matrix-column-2',
      'builtin-mod-matrix-column-3',
      'builtin-mod-matrix-column-4',
    ])
    expect(new Set(partIds)).toHaveLength(33)
  })
})
