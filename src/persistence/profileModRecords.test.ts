import { describe, expect, it } from 'vitest'
import {
  MOD_KIND_ORDER,
  createSeedMod,
  listModPartIdentities,
  type Mod,
  type ModKind,
} from '../mods'
import {
  createDirectProfileModInstance,
  createUserProfileModTemplate,
  decodeProfileModRecord,
  deleteProfileModTemplate,
  encodeProfileModRecord,
  hydrateProfileModInstance,
  stampProfileModTemplate,
  updateProfileModTemplate,
} from './profileModRecords'

const CREATED_AT = '2026-07-19T01:00:00.000Z'

function seed<K extends ModKind>(kind: K, prefix = `template-${kind}`): Mod<K> {
  return createSeedMod(kind, {
    createId: (role, ordinal) => `${prefix}-${role}-${ordinal}`,
  })
}

describe('Profile Mod v2 records (#765)', () => {
  it.each(MOD_KIND_ORDER)('round-trips one root-ID-free %s document through a v2 template record', (kind) => {
    const mod = seed(kind)
    const created = createUserProfileModTemplate({
      profileId: 'profile-synthetic',
      templateId: `mod-template-${kind}`,
      createdAt: CREATED_AT,
      mod,
    })

    expect(created).toMatchObject({
      ok: true,
      value: {
        kind: 'mod-template',
        recordId: `mod-template-${kind}`,
        ownerId: 'profile-synthetic',
        parentId: 'profile-synthetic',
        recordVersion: 2,
        payload: {
          templateVersion: 1,
          provenance: { kind: 'user' },
          createdAt: CREATED_AT,
          updatedAt: CREATED_AT,
          mod,
        },
      },
    })
    expect('id' in mod).toBe(false)
    if (!created.ok) return
    const encoded = encodeProfileModRecord(created.value)
    expect(encoded.ok).toBe(true)
    if (encoded.ok) expect(decodeProfileModRecord(encoded.value)).toEqual(created)
  })

  it('rejects legacy/root-ID Mod documents, repaired documents, axis 1, and future axes explicitly', () => {
    expect(createUserProfileModTemplate({
      profileId: 'profile-synthetic',
      templateId: 'legacy-template',
      createdAt: CREATED_AT,
      mod: { id: 'legacy-template', label: 'Legacy', controls: [] },
    })).toMatchObject({ ok: false, code: 'invalid' })

    expect(createUserProfileModTemplate({
      profileId: 'profile-synthetic',
      templateId: 'repaired-template',
      createdAt: CREATED_AT,
      mod: { kind: 'slider' },
    })).toMatchObject({ ok: false, code: 'invalid' })

    const current = createUserProfileModTemplate({
      profileId: 'profile-synthetic',
      templateId: 'current-template',
      createdAt: CREATED_AT,
      mod: seed('slider'),
    })
    expect(current.ok).toBe(true)
    if (!current.ok) return
    expect(decodeProfileModRecord({ ...current.value, recordVersion: 1 })).toMatchObject({
      ok: false,
      code: 'invalid',
    })
    expect(decodeProfileModRecord({ ...current.value, recordVersion: 3 })).toMatchObject({
      ok: false,
      code: 'unsupported-future-version',
    })
  })

  it('increments user templates monotonically while keeping built-ins immutable', () => {
    const first = seed('switch', 'lifecycle')
    const created = createUserProfileModTemplate({
      profileId: 'profile-synthetic',
      templateId: 'mod-template-lifecycle',
      createdAt: CREATED_AT,
      mod: first,
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    const second = { ...first, title: 'SECOND' }
    const updated = updateProfileModTemplate(created.value, {
      updatedAt: '2026-07-19T01:00:01.000Z',
      mod: second,
    })
    expect(updated).toMatchObject({
      ok: true,
      value: { payload: { templateVersion: 2, mod: { title: 'SECOND' } } },
    })
    expect(created.value.payload).toMatchObject({ templateVersion: 1, mod: { title: first.title } })
    expect(updateProfileModTemplate(created.value, {
      updatedAt: created.value.payload.updatedAt,
      mod: first,
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect(deleteProfileModTemplate(created.value)).toEqual({
      ok: true,
      value: {
        recordId: 'mod-template-lifecycle',
        ownerId: 'profile-synthetic',
        expectedTemplateVersion: 1,
      },
    })

    const builtIn = decodeProfileModRecord({
      ...created.value,
      recordId: 'builtin-mod-switch',
      payload: { ...created.value.payload, provenance: { kind: 'built-in' } },
    })
    expect(builtIn.ok).toBe(true)
    if (!builtIn.ok || builtIn.value.kind !== 'mod-template') return
    expect(updateProfileModTemplate(builtIn.value, {
      updatedAt: '2026-07-19T01:00:01.000Z',
      mod: second,
    })).toMatchObject({ ok: false, code: 'immutable-built-in' })
    expect(deleteProfileModTemplate(builtIn.value)).toMatchObject({
      ok: false,
      code: 'immutable-built-in',
    })
  })

  it('stamps canonical nested members without inventing a Mod root ID', () => {
    const mod = seed('matrix', 'matrix-source')
    const template = createUserProfileModTemplate({
      profileId: 'profile-synthetic',
      templateId: 'mod-template-matrix',
      createdAt: CREATED_AT,
      mod: {
        ...mod,
        futureWires: [{ from: 'matrix-source-row-0', to: 'matrix-source-column-2' }],
      },
    })
    expect(template.ok).toBe(true)
    if (!template.ok) return
    const sourceParts = listModPartIdentities(template.value.payload.mod)
    const instanceIds = sourceParts.map(({ role, ordinal }) => `matrix-instance-${role}-${ordinal}`)
    const stamped = stampProfileModTemplate(template.value, {
      boardRecordId: 'board:idea-synthetic',
      cardId: 'card-matrix',
      instanceId: 'mod-instance-matrix',
      controlIds: instanceIds,
      stampedAt: '2026-07-19T01:00:01.000Z',
    })

    expect(stamped).toMatchObject({
      ok: true,
      value: {
        recordId: 'mod-instance-matrix',
        ownerId: 'board:idea-synthetic',
        parentId: 'card-matrix',
        recordVersion: 2,
        payload: {
          source: { kind: 'template', templateId: 'mod-template-matrix', templateVersion: 1 },
          idMap: {
            mod: { sourceId: 'mod-template-matrix', instanceId: 'mod-instance-matrix' },
            controls: sourceParts.map(({ sourceId }, index) => ({
              sourceId,
              instanceId: instanceIds[index],
            })),
          },
        },
      },
    })
    if (!stamped.ok) return
    expect('id' in stamped.value.payload.mod).toBe(false)
    expect(listModPartIdentities(stamped.value.payload.mod).map(({ sourceId }) => sourceId)).toEqual(instanceIds)
    expect((stamped.value.payload.mod as typeof stamped.value.payload.mod & {
      futureWires: unknown
    }).futureWires).toEqual([{ from: 'matrix-source-row-0', to: 'matrix-source-column-2' }])
    expect(hydrateProfileModInstance(stamped.value)).toEqual({
      ok: true,
      value: stamped.value.payload.mod,
    })
    expect(stampProfileModTemplate(template.value, {
      boardRecordId: 'board:idea-synthetic',
      cardId: 'card-incomplete-map',
      instanceId: 'mod-instance-incomplete',
      controlIds: instanceIds.slice(1),
      stampedAt: '2026-07-19T01:00:01.000Z',
    })).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('keeps the durable stamp-time idMap independent from current editable nested members', () => {
    const template = createUserProfileModTemplate({
      profileId: 'profile-synthetic',
      templateId: 'mod-template-switch',
      createdAt: CREATED_AT,
      mod: seed('switch', 'source-switch'),
    })
    expect(template.ok).toBe(true)
    if (!template.ok) return
    const stamped = stampProfileModTemplate(template.value, {
      boardRecordId: 'board:idea-synthetic',
      cardId: 'card-switch',
      instanceId: 'mod-instance-switch',
      controlIds: ['instance-switch-0', 'instance-switch-1', 'instance-switch-2'],
      stampedAt: '2026-07-19T01:00:01.000Z',
    })
    expect(stamped.ok).toBe(true)
    if (!stamped.ok) return
    if (stamped.value.payload.mod.kind !== 'switch') throw new Error('Expected switch Mod')
    const stampTimeMap = JSON.parse(JSON.stringify(stamped.value.payload.idMap)) as unknown
    const evolved = {
      ...stamped.value,
      payload: {
        ...stamped.value.payload,
        mod: {
          ...stamped.value.payload.mod,
          state: {
            ...stamped.value.payload.mod.state,
            items: [
              stamped.value.payload.mod.state.items[1],
              { id: 'instance-switch-added', label: 'ADDED', on: false, frame: '' },
            ],
          },
        },
      },
    }
    const decoded = decodeProfileModRecord(evolved)
    expect(decoded).toMatchObject({ ok: true })
    if (!decoded.ok || decoded.value.kind !== 'mod-instance'
      || decoded.value.payload.source.kind !== 'template'
      || !('idMap' in decoded.value.payload)) {
      return
    }
    expect(decoded.value.payload.idMap).toEqual(stampTimeMap)
    expect(listModPartIdentities(decoded.value.payload.mod).map(({ sourceId }) => sourceId)).toEqual([
      'instance-switch-1',
      'instance-switch-added',
    ])

    const duplicateSource = structuredClone(evolved) as unknown as {
      payload: { idMap: { controls: Array<{ sourceId: string }> } }
    }
    duplicateSource.payload.idMap.controls[1]!.sourceId = duplicateSource.payload.idMap.controls[0]!.sourceId
    expect(decodeProfileModRecord(duplicateSource)).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('hydrates an honest direct instance without template provenance or a root ID', () => {
    const mod = seed('pad', 'direct-pad')
    const direct = createDirectProfileModInstance({
      boardRecordId: 'board:idea-synthetic',
      cardId: 'card-direct-mod',
      instanceId: 'mod-instance-direct',
      createdAt: CREATED_AT,
      mod,
    })
    expect(direct).toMatchObject({
      ok: true,
      value: {
        recordId: 'mod-instance-direct',
        parentId: 'card-direct-mod',
        payload: { source: { kind: 'direct' }, createdAt: CREATED_AT, mod },
      },
    })
    if (!direct.ok) return
    expect('idMap' in direct.value.payload).toBe(false)
    expect('id' in direct.value.payload.mod).toBe(false)
    expect(hydrateProfileModInstance(direct.value)).toEqual({ ok: true, value: mod })
  })

  it('preserves unknown inert JSON extensions while rejecting executable or lossy data', () => {
    const mod = seed('slider', 'extension') as Mod & Record<string, unknown>
    mod.futurePermissions = { grants: ['inspect'], enabled: false }
    const template = createUserProfileModTemplate({
      profileId: 'profile-synthetic',
      templateId: 'mod-template-extensions',
      createdAt: CREATED_AT,
      mod,
    })
    expect(template.ok).toBe(true)
    if (!template.ok) return
    const withEnvelopeExtension = {
      ...template.value,
      payload: {
        ...template.value.payload,
        futureRecordMetadata: { preserved: ['exact', 7, false, null] },
      },
    }
    const decoded = decodeProfileModRecord(withEnvelopeExtension)
    expect(decoded.ok).toBe(true)
    if (decoded.ok) expect(encodeProfileModRecord(decoded.value)).toEqual({
      ok: true,
      value: withEnvelopeExtension,
    })

    let getterEvaluated = false
    const executable = seed('slider', 'executable') as Mod & Record<string, unknown>
    Object.defineProperty(executable, 'plugin', {
      enumerable: true,
      get() {
        getterEvaluated = true
        return 'must-not-run'
      },
    })
    expect(createUserProfileModTemplate({
      profileId: 'profile-synthetic',
      templateId: 'mod-template-executable',
      createdAt: CREATED_AT,
      mod: executable,
    })).toMatchObject({ ok: false, code: 'invalid' })
    expect(getterEvaluated).toBe(false)

    for (const extension of [() => 'not data', -0]) {
      expect(createUserProfileModTemplate({
        profileId: 'profile-synthetic',
        templateId: 'mod-template-non-json',
        createdAt: CREATED_AT,
        mod: { ...seed('slider', 'non-json'), extension },
      })).toMatchObject({ ok: false, code: 'invalid' })
    }
  })
})
