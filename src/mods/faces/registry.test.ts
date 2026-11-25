import { describe, expect, it } from 'vitest'
import { MOD_KIND_ORDER } from '../model'
import { createModFaceRegistry, modFaceDefinitionFor } from './registry'
import { sliderFaceDefinition } from './sliderFace'
import type { ModFaceDefinition } from './types'

describe('Mod face registry ownership', () => {
  it('builds an isolated lookup without pinning family lane contents', () => {
    const dialDefinition: ModFaceDefinition<'dial'> = {
      kind: 'dial',
      mount: () => ({ update() {}, dispose() {} }),
    }
    const registry = createModFaceRegistry([sliderFaceDefinition, dialDefinition])

    expect(registry.definitionFor('slider')).toBe(sliderFaceDefinition)
    expect(registry.definitionFor('dial')).toBe(dialDefinition)
    expect(registry.definitionFor('switch')).toBeUndefined()
    expect(modFaceDefinitionFor('slider')).toMatchObject({ kind: 'slider' })
  })

  it('publishes every production kind with definition-owned settings', () => {
    for (const kind of MOD_KIND_ORDER) {
      expect(modFaceDefinitionFor(kind)).toMatchObject({ kind, settings: expect.any(Function) })
    }
  })

  it('rejects duplicate ownership for one Mod kind', () => {
    expect(() => createModFaceRegistry([sliderFaceDefinition, sliderFaceDefinition])).toThrow(
      /duplicate mod face definition for slider/i,
    )
  })
})
