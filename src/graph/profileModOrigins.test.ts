import { describe, expect, it } from 'vitest'
import { createSeedMod, listModPartIdentities, remapModPartIdentities } from '../mods'
import {
  captureDirectProfileModOrigin,
  captureStampedProfileModOrigin,
} from './profileModOrigins'

describe('Profile Mod origin capture', () => {
  it('captures a direct v2 Mod with a distinct instance-record identity', () => {
    const mod = createSeedMod('select', {
      createId: (role, ordinal) => `direct-${role}-${ordinal}`,
    })

    const captured = captureDirectProfileModOrigin(mod, 'mod-instance-direct')

    expect(captured).toEqual({
      mod,
      origin: { kind: 'direct', instanceId: 'mod-instance-direct' },
    })
    expect(captured.mod).not.toBe(mod)
    expect(Object.isFrozen(captured)).toBe(true)
    expect(Object.isFrozen(captured.mod)).toBe(true)
    expect(Object.isFrozen(captured.mod.state)).toBe(true)
    expect(Object.isFrozen(captured.origin)).toBe(true)
  })

  it('maps the template record and every canonical nested member to fresh instance identities', () => {
    const source = createSeedMod('matrix', {
      createId: (role, ordinal) => `source-${role}-${ordinal}`,
    })
    const remapped = remapModPartIdentities(
      source,
      ({ role, ordinal }) => `instance-${role}-${ordinal}`,
    )

    const captured = captureStampedProfileModOrigin(
      source,
      remapped.value,
      { sourceTemplateId: 'template-record-matrix', sourceTemplateVersion: 7 },
      'mod-instance-matrix',
    )

    expect(captured.origin).toEqual({
      kind: 'stamped',
      instanceId: 'mod-instance-matrix',
      sourceTemplateId: 'template-record-matrix',
      sourceTemplateVersion: 7,
      sourceToInstanceIdMap: {
        mod: {
          sourceId: 'template-record-matrix',
          instanceId: 'mod-instance-matrix',
        },
        controls: listModPartIdentities(source).map((part, index) => ({
          sourceId: part.sourceId,
          instanceId: listModPartIdentities(remapped.value)[index]!.sourceId,
        })),
      },
    })
    expect(Object.isFrozen(captured.origin)).toBe(true)
    if (captured.origin.kind !== 'stamped') throw new Error('Expected stamped origin')
    expect(Object.isFrozen(captured.origin.sourceToInstanceIdMap.controls)).toBe(true)
  })
})
