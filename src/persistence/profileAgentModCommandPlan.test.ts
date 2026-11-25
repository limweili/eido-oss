import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { createSeedMod, type Mod } from '../mods'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'
import {
  hydrateProfileLogicalDocument,
  projectProfileSnapshot,
  type ProfileLogicalDocument,
} from './profileLogicalProjection'
import {
  PROFILE_AGENT_MOD_COMMAND_DESCRIPTORS,
  planProfileAgentCommandBatch,
  type ProfileAgentCommandRequest,
  type ProfileAgentCommandTrustedContext,
} from './profileAgentCommandPlan'
import { PROFILE_BUILT_IN_MOD_TEMPLATES } from './profileBuiltInMods'
import {
  createProfileCapabilities,
  PUBLIC_GATEWAY_COMMAND_REGISTRY,
} from './profileServiceContract'
import {
  createUserProfileModTemplate,
  PROFILE_MOD_RECORD_VERSION,
  updateProfileModTemplate,
} from './profileModRecords'

const COMMITTED_AT = '2026-07-19T01:00:00.000Z'

describe('Profile Agent Mod command planning (#525)', () => {
  it('plans one user template create as a Profile revision with no fabricated Board Intent', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const mod = switchMod('AGENT-CREATED LENS', ['control-agent-tone']) as Mod<'switch'> & {
      futurePermissions: { grants: string[]; enabled: boolean }
    }
    mod.futurePermissions = { grants: ['inspect'], enabled: false }
    ;(mod.state.items[0] as typeof mod.state.items[0] & {
      futureFace: { renderer: string }
    }).futureFace = { renderer: 'not-active' }
    const candidate = request(document.head.revision, [{
      version: 1,
      id: 'create-template',
      name: 'mod-template.create',
      payload: {
        templateId: 'mod-template-agent-created',
        mod,
      },
    }] as never)

    const result = planProfileAgentCommandBatch(document, candidate, trusted())

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value).toMatchObject({
      version: 1,
      profileId: 'profile-synthetic',
      scope: { kind: 'profile' },
      baseRevision: document.head.revision,
      proposedRevision: document.head.revision + 1,
      revisionAudit: {
        kind: 'profile-revision',
        commitId: 'commit-agent-mods',
        committedAt: COMMITTED_AT,
      },
      commandResults: [{
        commandId: 'create-template',
        name: 'mod-template.create',
        templateId: 'mod-template-agent-created',
        templateVersion: 1,
      }],
      recordChanges: [{
        operation: 'insert',
        after: {
          recordId: 'mod-template-agent-created',
          kind: 'mod-template',
          ownerId: 'profile-synthetic',
          parentId: 'profile-synthetic',
          ordinal: 1,
          payload: {
            templateVersion: 1,
            provenance: { kind: 'user' },
            createdAt: COMMITTED_AT,
            updatedAt: COMMITTED_AT,
            mod: {
              kind: 'switch',
              title: 'AGENT-CREATED LENS',
              futurePermissions: { grants: ['inspect'], enabled: false },
              state: {
                items: [{
                  id: 'control-agent-tone',
                  futureFace: { renderer: 'not-active' },
                }],
              },
            },
          },
        },
      }],
      intentEventDrafts: [],
      affectedRecords: [{
        recordId: 'mod-template-agent-created',
        kind: 'mod-template',
        operation: 'insert',
      }],
    })
    expect(Object.isFrozen(result.value)).toBe(true)
    expect(Object.isFrozen(result.value.recordChanges)).toBe(true)
    expect(result.value.profileAgentEventDrafts).toEqual([{
      version: 1,
      type: 'mod-template.created',
      templateId: 'mod-template-agent-created',
      templateVersion: 1,
    }])
  })

  it('plans create, complete update, deterministic stamp, and delete without changing the frozen instance', () => {
    const fixture = createCompleteProfileFixture()
    let document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const templateId = 'mod-template-lifecycle'

    const created = mustPlan(document, request(document.head.revision, [{
      version: 1,
      id: 'create-lifecycle',
      name: 'mod-template.create',
      payload: {
        templateId,
        mod: {
          ...switchMod('FIRST MEANING', ['source-control-first']),
        },
      },
    }]), trusted('2026-07-19T01:00:00.000Z'))
    document = applyPlan(document, created)

    const updated = mustPlan(document, request(document.head.revision, [{
      version: 1,
      id: 'update-lifecycle',
      name: 'mod-template.update',
      payload: {
        templateId,
        expectedTemplateVersion: 1,
        mod: {
          ...switchMod('SECOND COMPLETE MEANING', ['source-control-second', 'source-control-third']),
        },
      },
    }]), trusted('2026-07-19T02:00:00.000Z'))
    expect(updated.commandResults).toEqual([{
      commandId: 'update-lifecycle',
      name: 'mod-template.update',
      templateId,
      previousTemplateVersion: 1,
      newTemplateVersion: 2,
    }])
    expect(updated.intentEventDrafts).toEqual([])
    expect(updated.profileAgentEventDrafts).toEqual([{
      version: 1,
      type: 'mod-template.updated',
      templateId,
      previousTemplateVersion: 1,
      newTemplateVersion: 2,
    }])
    document = applyPlan(document, updated)

    const stampRequest = request(document.head.revision, [{
      version: 1,
      id: 'stamp-lifecycle',
      name: 'mod-instance.stamp',
      payload: {
        ideaId: 'idea-main',
        templateId,
        expectedTemplateVersion: 2,
        position: { x: 900_000, y: 900_000 },
      },
    }])
    const dryStamp = mustPlan(document, { ...stampRequest, dryRun: true }, trusted(
      '2026-07-19T03:00:00.000Z',
    ))
    const stamp = mustPlan(document, stampRequest, trusted('2026-07-19T03:00:00.000Z'))
    expect(stamp.commandResults).toEqual(dryStamp.commandResults)
    expect(stamp.recordChanges).toEqual(dryStamp.recordChanges)
    expect(stamp.commandResults).toEqual([{
      commandId: 'stamp-lifecycle',
      name: 'mod-instance.stamp',
      cardId: 'card:stamp-lifecycle',
      blockId: 'block:stamp-lifecycle',
      instanceId: `mod-instance:stamp-lifecycle:${templateId}:0`,
      source: { kind: 'template', templateId, templateVersion: 2 },
      idMap: {
        mod: {
          sourceId: templateId,
          instanceId: `mod-instance:stamp-lifecycle:${templateId}:0`,
        },
        controls: [
          {
            sourceId: 'source-control-second',
            instanceId: 'mod-control:stamp-lifecycle:source-control-second:0',
          },
          {
            sourceId: 'source-control-third',
            instanceId: 'mod-control:stamp-lifecycle:source-control-third:1',
          },
        ],
      },
    }])
    expect(stamp.affectedRecords.map(({ kind }) => kind).sort()).toEqual([
      'block',
      'card',
      'mod-instance',
    ])
    expect(stamp.intentEventDrafts).toHaveLength(1)
    expect(stamp.intentEventDrafts[0]).toMatchObject({
      ideaId: 'idea-main',
      event: { type: 'card.created', cardId: 'card:stamp-lifecycle' },
    })
    expect(stamp.profileAgentEventDrafts).toEqual([])
    document = applyPlan(document, stamp)
    const instanceBeforeDelete = document.records.find((record) => (
      record.recordId === `mod-instance:stamp-lifecycle:${templateId}:0`
    ))

    const deleted = mustPlan(document, request(document.head.revision, [{
      version: 1,
      id: 'delete-lifecycle',
      name: 'mod-template.delete',
      payload: { templateId, expectedTemplateVersion: 2 },
    }]), trusted('2026-07-19T04:00:00.000Z'))
    expect(deleted.commandResults).toEqual([{
      commandId: 'delete-lifecycle',
      name: 'mod-template.delete',
      templateId,
      deletedTemplateVersion: 2,
    }])
    expect(deleted.intentEventDrafts).toEqual([])
    expect(deleted.profileAgentEventDrafts).toEqual([{
      version: 1,
      type: 'mod-template.deleted',
      templateId,
      deletedTemplateVersion: 2,
    }])
    document = applyPlan(document, deleted)
    expect(document.records.some((record) => record.recordId === templateId)).toBe(false)
    expect(document.records.find((record) => record.recordId === instanceBeforeDelete?.recordId))
      .toEqual(instanceBeforeDelete)
  })

  it('stamps a root-ID-free matrix into one matching rendering Card and persisted instance', () => {
    const fixture = createCompleteProfileFixture()
    const templateId = 'mod-template-agent-matrix'
    const matrix = createSeedMod('matrix', {
      title: 'AGENT MATRIX',
      createId: (_role, ordinal) => [
        'matrix-row-warmth',
        'matrix-row-detail',
        'matrix-column-intro',
        'matrix-column-body',
        'matrix-column-close',
      ][ordinal] ?? `unexpected-matrix-part-${ordinal}`,
    })
    const template = createUserProfileModTemplate({
      profileId: fixture.snapshot.profileId,
      templateId,
      createdAt: '2026-07-19T00:00:00.000Z',
      mod: matrix,
    })
    expect(template.ok).toBe(true)
    if (!template.ok) throw new Error(template.message)
    fixture.snapshot.modTemplates.push(template.value)
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const stampCommand = {
      version: 1 as const,
      id: 'stamp-matrix',
      name: 'mod-instance.stamp' as const,
      payload: {
        ideaId: 'idea-main',
        templateId,
        expectedTemplateVersion: 1,
        position: { x: 640_000, y: 480_000 },
      },
    }

    const dryRun = mustPlan(
      document,
      { ...request(document.head.revision, [stampCommand]), dryRun: true },
      trusted(),
    )
    const applied = mustPlan(
      document,
      request(document.head.revision, [stampCommand]),
      trusted(),
    )

    expect(dryRun.commandResults).toEqual(applied.commandResults)
    expect(dryRun.recordChanges).toEqual(applied.recordChanges)
    expect(dryRun.intentEventDrafts).toEqual(applied.intentEventDrafts)
    expect(dryRun.affectedRecords).toEqual(applied.affectedRecords)

    const instanceId = `mod-instance:stamp-matrix:${templateId}:0`
    const expectedIdMap = {
      mod: { sourceId: templateId, instanceId },
      controls: [
        {
          sourceId: 'matrix-row-warmth',
          instanceId: 'mod-control:stamp-matrix:matrix-row-warmth:0',
        },
        {
          sourceId: 'matrix-row-detail',
          instanceId: 'mod-control:stamp-matrix:matrix-row-detail:1',
        },
        {
          sourceId: 'matrix-column-intro',
          instanceId: 'mod-control:stamp-matrix:matrix-column-intro:2',
        },
        {
          sourceId: 'matrix-column-body',
          instanceId: 'mod-control:stamp-matrix:matrix-column-body:3',
        },
        {
          sourceId: 'matrix-column-close',
          instanceId: 'mod-control:stamp-matrix:matrix-column-close:4',
        },
      ],
    }
    const commandResult = applied.commandResults[0]
    expect(commandResult).toMatchObject({
      name: 'mod-instance.stamp',
      cardId: 'card:stamp-matrix',
      instanceId,
      idMap: expectedIdMap,
    })
    if (!commandResult || commandResult.name !== 'mod-instance.stamp') {
      throw new Error('Expected the matrix stamp command result')
    }
    expect(commandResult.idMap).toEqual(expectedIdMap)

    const hydrated = hydrateProfileLogicalDocument(
      applyPlan(document, applied),
      fixture.hydrateAsset,
    )
    const renderingCard = hydrated.boards['idea-main']?.cards.find((card) => (
      card.id === commandResult.cardId
    ))
    const storedInstance = hydrated.modInstances.find((instance) => (
      instance.recordId === instanceId
    ))
    if (!renderingCard?.modV2) throw new Error('Expected a rendering Mod Card')
    if (!storedInstance || !('idMap' in storedInstance.payload)) {
      throw new Error('Expected an independently persisted template instance')
    }
    expect(renderingCard.modV2).toEqual(storedInstance.payload.mod)
    expect(renderingCard.modV2).not.toHaveProperty('id')
    expect(renderingCard).not.toHaveProperty('mod')
    expect(storedInstance.payload.idMap).toEqual(expectedIdMap)

    const staleTemplateVersion = planProfileAgentCommandBatch(
      document,
      request(document.head.revision, [{
        ...stampCommand,
        payload: { ...stampCommand.payload, expectedTemplateVersion: 2 },
      }]),
      trusted(),
    )
    expect(staleTemplateVersion).toMatchObject({
      ok: false,
      code: 'conflict',
      currentRevision: document.head.revision,
    })

    const staleProfileRevision = planProfileAgentCommandBatch(
      document,
      request(document.head.revision + 1, [stampCommand]),
      trusted(),
    )
    expect(staleProfileRevision).toMatchObject({
      ok: false,
      code: 'conflict',
      currentRevision: document.head.revision,
    })
  })

  it('denies creation with every authoritative built-in template ID before a record exists', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    for (const { templateId, mod } of PROFILE_BUILT_IN_MOD_TEMPLATES) {
      expect(document.records.some((record) => record.recordId === templateId)).toBe(false)

      const result = planProfileAgentCommandBatch(document, request(document.head.revision, [{
        version: 1,
        id: `create-${templateId}`,
        name: 'mod-template.create',
        payload: { templateId, mod },
      }]), trusted())

      expect(result).toMatchObject({ ok: false, code: 'capability-denied' })
    }
  })

  it('denies update and delete of a seeded built-in template through immutable provenance', () => {
    const fixture = createCompleteProfileFixture()
    const builtIn = PROFILE_BUILT_IN_MOD_TEMPLATES[0]
    if (!builtIn) throw new Error('Authoritative built-in Mod templates are missing')
    fixture.snapshot.modTemplates.push({
      kind: 'mod-template',
      recordId: builtIn.templateId,
      ownerId: fixture.snapshot.profileId,
      parentId: fixture.snapshot.profileId,
      recordVersion: PROFILE_MOD_RECORD_VERSION,
      payload: {
        templateVersion: 1,
        provenance: { kind: 'built-in' },
        createdAt: '2026-07-19T00:00:00.000Z',
        updatedAt: '2026-07-19T00:00:00.000Z',
        mod: builtIn.mod,
      },
    })
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    const update = planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'update-seeded-built-in',
      name: 'mod-template.update',
      payload: {
        templateId: builtIn.templateId,
        expectedTemplateVersion: 1,
        mod: switchMod('FORGED UPDATE', ['forged-update-item']),
      },
    }]), trusted())
    const remove = planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'delete-seeded-built-in',
      name: 'mod-template.delete',
      payload: { templateId: builtIn.templateId, expectedTemplateVersion: 1 },
    }]), trusted())

    expect(update).toMatchObject({ ok: false, code: 'capability-denied' })
    expect(remove).toMatchObject({ ok: false, code: 'capability-denied' })
  })

  it('configures and deletes an existing Mod instance on surface v5', () => {
    const fixture = createCompleteProfileFixture()
    let document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const existing = fixture.snapshot.boards['idea-main']!.cards.find((card) => (
      card.id === 'card-mod-direct'
    ))
    if (!existing?.modV2 || existing.modV2.kind !== 'switch') {
      throw new Error('Synthetic direct Mod is missing')
    }
    const configured = structuredClone(existing.modV2)
    configured.title = 'DIRECT MOD — EVIDENCE SKEPTICISM'
    configured.state.items[0]!.on = !configured.state.items[0]!.on

    const configure = planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'configure-direct-instance',
      name: 'mod-instance.configure',
      payload: { ideaId: 'idea-main', cardId: existing.id, mod: configured },
    }] as never), trusted(), 5)
    expect(configure.ok).toBe(true)
    if (!configure.ok) return
    expect(configure.value.commandResults).toEqual([{
      commandId: 'configure-direct-instance',
      name: 'mod-instance.configure',
      cardId: existing.id,
      instanceId: 'mod-direct-1',
    }])
    expect(configure.value.recordChanges).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation: 'replace',
        after: expect.objectContaining({ recordId: existing.id, kind: 'card' }),
      }),
      expect.objectContaining({
        operation: 'replace',
        after: expect.objectContaining({ recordId: 'mod-direct-1', kind: 'mod-instance' }),
      }),
    ]))
    document = applyPlan(document, configure.value)
    const hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)
    expect(hydrated.boards['idea-main']!.cards.find((card) => card.id === existing.id)?.modV2)
      .toEqual(configured)
    expect(hydrated.modInstances.find((instance) => instance.recordId === 'mod-direct-1')?.payload.mod)
      .toEqual(configured)

    const stampedCard = fixture.snapshot.boards['idea-main']!.cards.find((card) => (
      card.id === 'card-mod'
    ))
    if (!stampedCard?.modV2 || stampedCard.modV2.kind !== 'slider') {
      throw new Error('Synthetic stamped Mod is missing')
    }
    const stampedPartId = stampedCard.modV2.state.items[0]?.id
    if (!stampedPartId) throw new Error('Synthetic stamped Mod member is missing')
    for (const [commandId, stolenId] of [
      ['configure-direct-foreign-mod-part', stampedPartId],
      ['configure-direct-record-collision', 'card-note'],
    ] as const) {
      const colliding = structuredClone(configured)
      colliding.state.items[0] = { ...colliding.state.items[0]!, id: stolenId }
      expect(planProfileAgentCommandBatch(document, request(document.head.revision, [{
        version: 1,
        id: commandId,
        name: 'mod-instance.configure',
        payload: { ideaId: 'idea-main', cardId: existing.id, mod: colliding },
      }] as never), trusted('2026-07-19T01:30:00.000Z'), 5)).toMatchObject({
        ok: false,
        code: 'invalid',
      })
    }

    const remove = planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'delete-direct-instance',
      name: 'mod-instance.delete',
      payload: { ideaId: 'idea-main', cardId: existing.id },
    }] as never), trusted('2026-07-19T02:00:00.000Z'), 5)
    expect(remove.ok).toBe(true)
    if (!remove.ok) return
    expect(remove.value.commandResults).toEqual([{
      commandId: 'delete-direct-instance',
      name: 'mod-instance.delete',
      cardId: existing.id,
      instanceId: 'mod-direct-1',
    }])
    const deletedKinds = remove.value.recordChanges.flatMap((change) => (
      change.operation === 'delete' ? [change.before.kind] : []
    ))
    expect(deletedKinds).toEqual(expect.arrayContaining(['card', 'block', 'mod-instance']))
  })

  it('keeps stamped provenance immutable across value, reorder, remove, and fresh-add configuration', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const existing = fixture.snapshot.boards['idea-main']!.cards.find((card) => (
      card.id === 'card-mod'
    ))
    const stamped = fixture.snapshot.modInstances.find((instance) => (
      instance.recordId === 'mod-stamp-1'
    ))
    if (!existing?.modV2 || existing.modV2.kind !== 'slider'
      || !stamped || !('idMap' in stamped.payload)) {
      throw new Error('Synthetic stamped slider is missing')
    }
    const originalMap = structuredClone(stamped.payload.idMap)
    const [first, second] = existing.modV2.state.items
    if (!first || !second) throw new Error('Synthetic stamped slider members are missing')

    const reordered = structuredClone(existing.modV2)
    reordered.title = 'STAMPED — REORDERED'
    reordered.state.items = [{ ...second, v: 73 }, first]
    const removed = structuredClone(reordered)
    removed.title = 'STAMPED — REMOVED'
    removed.state.items = [reordered.state.items[0]!]
    const added = structuredClone(removed)
    added.title = 'STAMPED — ADDED'
    added.state.items = [
      removed.state.items[0]!,
      { id: 'fresh-stamped-item', label: 'EVIDENCE', v: 41, frame: '' },
    ]

    const configured = planProfileAgentCommandBatch(document, request(document.head.revision, [
      {
        version: 1,
        id: 'configure-stamped-reorder',
        name: 'mod-instance.configure',
        payload: { ideaId: 'idea-main', cardId: existing.id, mod: reordered },
      },
      {
        version: 1,
        id: 'configure-stamped-remove',
        name: 'mod-instance.configure',
        payload: { ideaId: 'idea-main', cardId: existing.id, mod: removed },
      },
      {
        version: 1,
        id: 'configure-stamped-add',
        name: 'mod-instance.configure',
        payload: { ideaId: 'idea-main', cardId: existing.id, mod: added },
      },
    ] as never), trusted(), 5)

    expect(configured.ok).toBe(true)
    if (!configured.ok) return
    expect(configured.value.commandResults.map(({ name }) => name)).toEqual([
      'mod-instance.configure',
      'mod-instance.configure',
      'mod-instance.configure',
    ])
    const stored = configured.value.recordChanges.find((change) => (
      change.operation !== 'delete' && change.after.recordId === stamped.recordId
    ))
    if (!stored || stored.operation === 'delete') throw new Error('Configured stamp is missing')
    expect(stored.after.payload).toMatchObject({ mod: added, idMap: originalMap })
    expect((stored.after.payload as { idMap: unknown }).idMap).toEqual(originalMap)
  })

  it('rejects stamped configuration with foreign or recycled current member identities', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const existing = fixture.snapshot.boards['idea-main']!.cards.find((card) => (
      card.id === 'card-mod'
    ))
    const foreign = fixture.snapshot.boards['idea-main']!.cards.find((card) => (
      card.id === 'card-mod-direct'
    ))
    if (!existing?.modV2 || existing.modV2.kind !== 'slider'
      || !foreign?.modV2 || foreign.modV2.kind !== 'switch') {
      throw new Error('Synthetic Mod identity fixtures are missing')
    }
    const [first, second] = existing.modV2.state.items
    const foreignItemId = foreign.modV2.state.items[0]?.id
    if (!first || !second || !foreignItemId) throw new Error('Synthetic Mod members are missing')

    const withForeignId = structuredClone(existing.modV2)
    withForeignId.state.items = [{ ...first, id: foreignItemId }, second]
    expect(planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'configure-stamped-foreign',
      name: 'mod-instance.configure',
      payload: { ideaId: 'idea-main', cardId: existing.id, mod: withForeignId },
    }] as never), trusted(), 5)).toMatchObject({ ok: false, code: 'invalid' })

    const removed = structuredClone(existing.modV2)
    removed.state.items = [second]
    const recycled = structuredClone(removed)
    recycled.state.items = [second, { ...first, label: 'RECYCLED' }]
    expect(planProfileAgentCommandBatch(document, request(document.head.revision, [
      {
        version: 1,
        id: 'configure-stamped-remove-before-recycle',
        name: 'mod-instance.configure',
        payload: { ideaId: 'idea-main', cardId: existing.id, mod: removed },
      },
      {
        version: 1,
        id: 'configure-stamped-recycle',
        name: 'mod-instance.configure',
        payload: { ideaId: 'idea-main', cardId: existing.id, mod: recycled },
      },
    ] as never), trusted(), 5)).toMatchObject({ ok: false, code: 'invalid' })
  })

  it('rejects stamped configuration when the immutable identity map mismatches its source revision', () => {
    const fixture = createCompleteProfileFixture()
    const index = fixture.snapshot.modInstances.findIndex((instance) => (
      instance.recordId === 'mod-stamp-1'
    ))
    const stamped = fixture.snapshot.modInstances[index]
    if (!stamped || !('idMap' in stamped.payload)) {
      throw new Error('Synthetic stamped Mod is missing')
    }
    const mismatched = structuredClone({
      ...stamped,
      payload: {
        ...stamped.payload,
        idMap: {
          ...stamped.payload.idMap,
          controls: stamped.payload.idMap.controls.map((pair, pairIndex) => ({
            ...pair,
            ...(pairIndex === 0 ? { sourceId: 'mismatched-template-source' } : {}),
          })),
        },
      },
    })
    fixture.snapshot.modInstances[index] = mismatched
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const configured = structuredClone(mismatched.payload.mod)
    configured.title = 'MUST NOT CONFIGURE'

    expect(planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'configure-stamped-mismatched-origin',
      name: 'mod-instance.configure',
      payload: { ideaId: 'idea-main', cardId: stamped.parentId, mod: configured },
    }] as never), trusted(), 5)).toMatchObject({
      ok: false,
      code: 'corrupt-or-recovery-required',
    })
  })

  it.each([
    ['set', { preset: 'blue', fill: 'body' }],
    ['clear', null],
  ] as const)(
    'rejects stamped identity %s when the immutable identity map mismatches its source revision',
    (_mode, identity) => {
      const fixture = createCompleteProfileFixture()
      const index = fixture.snapshot.modInstances.findIndex((instance) => (
        instance.recordId === 'mod-stamp-1'
      ))
      const stamped = fixture.snapshot.modInstances[index]
      if (!stamped || !('idMap' in stamped.payload)) {
        throw new Error('Synthetic stamped Mod is missing')
      }
      fixture.snapshot.modInstances[index] = structuredClone({
        ...stamped,
        payload: {
          ...stamped.payload,
          idMap: {
            ...stamped.payload.idMap,
            controls: stamped.payload.idMap.controls.map((pair, pairIndex) => ({
              ...pair,
              ...(pairIndex === 0 ? { sourceId: 'mismatched-template-source' } : {}),
            })),
          },
        },
      })
      const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
      const before = structuredClone(document)

      expect(planProfileAgentCommandBatch(document, request(document.head.revision, [{
        version: 1,
        id: `set-stamped-identity-${_mode}-mismatched-origin`,
        name: 'card.set-identity',
        payload: {
          ideaId: 'idea-main',
          card: { cardId: stamped.parentId },
          identity,
        },
      }] as never), trusted(), 5)).toMatchObject({
        ok: false,
        code: 'corrupt-or-recovery-required',
      })
      expect(document).toEqual(before)
    },
  )

  it('creates a direct Mod instance and connects it atomically on surface v5', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const mod = switchMod('DIRECT RESEARCH LENS', ['direct-research-toggle'])
    const commands = [
      {
        version: 1,
        id: 'create-direct-mod',
        name: 'mod-instance.create',
        payload: {
          ideaId: 'idea-main',
          mod,
          position: { x: 720, y: 360 },
        },
      },
      {
        version: 1,
        id: 'connect-direct-mod',
        name: 'connection.create',
        payload: {
          ideaId: 'idea-main',
          from: { createdByCommandId: 'create-direct-mod' },
          to: { cardId: 'card-ask' },
          strength: 'strong',
          polarity: 'helps',
        },
      },
    ] as never

    const denied = planProfileAgentCommandBatch(
      document,
      request(document.head.revision, commands),
      trusted(),
      4,
    )
    expect(denied).toMatchObject({ ok: false, code: 'capability-denied' })

    const dryRun = planProfileAgentCommandBatch(
      document,
      { ...request(document.head.revision, commands), dryRun: true },
      trusted(),
      5,
    )
    const applied = planProfileAgentCommandBatch(
      document,
      request(document.head.revision, commands),
      trusted(),
      5,
    )
    expect(dryRun.ok).toBe(true)
    expect(applied.ok).toBe(true)
    if (!dryRun.ok || !applied.ok) return
    expect(dryRun.value.commandResults).toEqual(applied.value.commandResults)
    expect(dryRun.value.recordChanges).toEqual(applied.value.recordChanges)
    expect(applied.value.commandResults[0]).toEqual({
      commandId: 'create-direct-mod',
      name: 'mod-instance.create',
      cardId: 'card:create-direct-mod',
      blockId: 'block:create-direct-mod',
      instanceId: 'mod-instance:create-direct-mod:create-direct-mod:0',
      source: { kind: 'direct' },
    })

    const inserted = applied.value.recordChanges.flatMap((change) => (
      change.operation === 'insert' ? [change.after] : []
    ))
    expect(inserted).toEqual(expect.arrayContaining([
      expect.objectContaining({
        recordId: 'card:create-direct-mod',
        kind: 'card',
        payload: expect.objectContaining({
          id: 'card:create-direct-mod',
          kind: 'mod',
          position: { x: 720, y: 360 },
        }),
      }),
      expect.objectContaining({
        recordId: 'block:create-direct-mod',
        kind: 'block',
      }),
      expect.objectContaining({
        recordId: 'mod-instance:create-direct-mod:create-direct-mod:0',
        kind: 'mod-instance',
        parentId: 'card:create-direct-mod',
        payload: {
          source: { kind: 'direct' },
          createdAt: COMMITTED_AT,
          mod,
        },
      }),
      expect.objectContaining({
        kind: 'connection',
        payload: expect.objectContaining({
          from: { cardId: 'card:create-direct-mod' },
          to: { cardId: 'card-ask' },
          polarity: 'helps',
        }),
      }),
    ]))
    expect(applied.value.intentEventDrafts.map(({ event }) => (
      (event as { type?: string }).type
    ))).toEqual(['card.created', 'connection.created'])
    const hydrated = hydrateProfileLogicalDocument(
      applyPlan(document, applied.value),
      fixture.hydrateAsset,
    )
    expect(hydrated.boards['idea-main']?.cards.find((card) => (
      card.id === 'card:create-direct-mod'
    ))?.modV2).toEqual(mod)
  })

  it('describes exact Mod reads/effects without advertising uninstalled handlers', () => {
    expect(PROFILE_AGENT_MOD_COMMAND_DESCRIPTORS).toEqual({
      'mod-template.create': {
        name: 'mod-template.create',
        payloadVersion: 1,
        scope: 'profile',
        dryRun: true,
        reads: [],
        effects: ['mod-template'],
      },
      'mod-template.update': {
        name: 'mod-template.update',
        payloadVersion: 1,
        scope: 'profile',
        dryRun: true,
        reads: ['mod-template'],
        effects: ['mod-template'],
      },
      'mod-template.delete': {
        name: 'mod-template.delete',
        payloadVersion: 1,
        scope: 'profile',
        dryRun: true,
        reads: ['mod-template'],
        effects: ['mod-template'],
      },
      'mod-instance.stamp': {
        name: 'mod-instance.stamp',
        payloadVersion: 1,
        scope: 'idea',
        dryRun: true,
        reads: ['mod-template'],
        effects: ['card', 'block', 'mod-instance'],
      },
      'mod-instance.create': {
        name: 'mod-instance.create',
        payloadVersion: 1,
        scope: 'idea',
        dryRun: true,
        reads: [],
        effects: ['card', 'block', 'mod-instance'],
      },
      'mod-instance.configure': {
        name: 'mod-instance.configure',
        payloadVersion: 1,
        scope: 'idea',
        dryRun: true,
        reads: ['card', 'mod-instance'],
        effects: ['card', 'mod-instance'],
      },
      'mod-instance.delete': {
        name: 'mod-instance.delete',
        payloadVersion: 1,
        scope: 'idea',
        dryRun: true,
        reads: ['card', 'mod-instance'],
        effects: ['card', 'block', 'connection', 'mod-instance'],
      },
    })
    expect(PUBLIC_GATEWAY_COMMAND_REGISTRY['mod-instance.stamp']).toMatchObject({
      affectedRecords: ['card', 'block', 'mod-instance'],
      semanticAttribution: 'profile-revision-and-board-intent-log',
    })
    expect(PUBLIC_GATEWAY_COMMAND_REGISTRY['mod-instance.create']).toMatchObject({
      affectedRecords: ['card', 'block', 'mod-instance'],
      semanticAttribution: 'profile-revision-and-board-intent-log',
    })
    expect(createProfileCapabilities('sqlite').commands).toEqual([])
  })

  it('composes Board creation and stamp in original order within one Idea scope', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const plan = mustPlan(document, request(document.head.revision, [
      {
        version: 1,
        id: 'create-before-stamp',
        name: 'card.create',
        payload: {
          ideaId: 'idea-main',
          kind: 'note',
          position: { x: 700_000, y: 700_000 },
          text: 'Placed first',
        },
      },
      {
        version: 1,
        id: 'stamp-after-card',
        name: 'mod-instance.stamp',
        payload: {
          ideaId: 'idea-main',
          templateId: 'mod-template-synthetic',
          expectedTemplateVersion: 1,
          position: { x: 700_000, y: 700_000 },
        },
      },
    ]), trusted())

    expect(plan.scope).toEqual({ kind: 'idea', ideaId: 'idea-main' })
    expect(plan.commandResults.map(({ name }) => name)).toEqual([
      'card.create',
      'mod-instance.stamp',
    ])
    expect(plan.intentEventDrafts.map(({ event }) => (
      (event as { type?: string }).type
    ))).toEqual(['card.created', 'card.created'])
    const createdCards = plan.recordChanges.flatMap((change) => (
      change.operation === 'insert' && change.after.kind === 'card' ? [change.after] : []
    ))
    expect(createdCards).toHaveLength(2)
    const firstPosition = (createdCards[0]?.payload as { position?: unknown } | undefined)?.position
    const secondPosition = (createdCards[1]?.payload as { position?: unknown } | undefined)?.position
    expect(firstPosition).not.toEqual(secondPosition)
  })

  it('fails atomically on scope, template, schema, version, and derived-identity violations', () => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const before = JSON.stringify(document)
    const currentTemplate = fixture.snapshot.modTemplates[0]
    if (!currentTemplate) throw new Error('Synthetic template is missing')

    const missing = planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'update-missing',
      name: 'mod-template.update',
      payload: {
        templateId: 'mod-template-missing',
        expectedTemplateVersion: 1,
        mod: switchMod('MISSING', ['missing-item']),
      },
    }]), trusted())
    expect(missing).toMatchObject({ ok: false, code: 'not-found' })

    const stale = planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'update-stale',
      name: 'mod-template.update',
      payload: {
        templateId: currentTemplate.recordId,
        expectedTemplateVersion: 2,
        mod: currentTemplate.payload.mod,
      },
    }]), trusted())
    expect(stale).toMatchObject({
      ok: false,
      code: 'conflict',
      currentRevision: document.head.revision,
    })

    const futureControl = planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'create-future-control',
      name: 'mod-template.create',
      payload: {
        templateId: 'mod-template-future-control',
        mod: {
          ...switchMod('FUTURE CONTROL', ['future-control']),
          kind: 'wire',
        },
      },
    }] as never), trusted())
    expect(futureControl).toMatchObject({ ok: false, code: 'invalid' })

    const observedScopes: unknown[] = []
    const mixedScopeContext = {
      ...trusted(),
      deriveId(scope: Parameters<ProfileAgentCommandTrustedContext['deriveId']>[0]) {
        observedScopes.push(scope)
        return `${scope.purpose}:${scope.commandId}`
      },
    }
    const mixedScope = planProfileAgentCommandBatch(document, request(document.head.revision, [
      {
        version: 1,
        id: 'profile-command',
        name: 'mod-template.delete',
        payload: { templateId: currentTemplate.recordId, expectedTemplateVersion: 1 },
      },
      {
        version: 1,
        id: 'idea-command',
        name: 'mod-instance.stamp',
        payload: {
          ideaId: 'idea-main',
          templateId: currentTemplate.recordId,
          expectedTemplateVersion: 1,
          position: { x: 0, y: 0 },
        },
      },
    ]), mixedScopeContext)
    expect(mixedScope).toMatchObject({ ok: false, code: 'invalid' })
    expect(observedScopes).toEqual([])

    const collidingContext = {
      ...trusted(),
      deriveId() { return currentTemplate.recordId },
    }
    const collision = planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'stamp-collision',
      name: 'mod-instance.stamp',
      payload: {
        ideaId: 'idea-main',
        templateId: currentTemplate.recordId,
        expectedTemplateVersion: 1,
        position: { x: 0, y: 0 },
      },
    }]), collidingContext)
    expect(collision).toMatchObject({
      ok: false,
      code: 'internal',
      currentRevision: document.head.revision,
    })

    const rewind = planProfileAgentCommandBatch(document, request(document.head.revision, [
      {
        version: 1,
        id: 'delete-before-recreate',
        name: 'mod-template.delete',
        payload: { templateId: currentTemplate.recordId, expectedTemplateVersion: 1 },
      },
      {
        version: 1,
        id: 'recreate-deleted-id',
        name: 'mod-template.create',
        payload: {
          templateId: currentTemplate.recordId,
          mod: currentTemplate.payload.mod,
        },
      },
    ]), trusted())
    expect(rewind).toMatchObject({ ok: false, code: 'invalid' })
    expect(JSON.stringify(document)).toBe(before)
  })

  it('reserves immutable stamp provenance IDs after the current template changes', () => {
    const fixture = createCompleteProfileFixture()
    const current = fixture.snapshot.modTemplates[0]
    if (!current) throw new Error('Synthetic template is missing')
    const updated = updateProfileModTemplate(current, {
      updatedAt: '2026-07-19T00:30:00.000Z',
      mod: switchMod('CURRENT TEMPLATE WITHOUT OLD PART IDS', ['current-source-control']),
    })
    if (!updated.ok) throw new Error(updated.message)
    fixture.snapshot.modTemplates[0] = updated.value
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const context = {
      ...trusted('2026-07-19T01:00:00.000Z'),
      deriveId() { return 'control-template-item-0' },
    }

    const result = planProfileAgentCommandBatch(document, request(document.head.revision, [{
      version: 1,
      id: 'stamp-after-template-change',
      name: 'mod-instance.stamp',
      payload: {
        ideaId: 'idea-main',
        templateId: current.recordId,
        expectedTemplateVersion: 2,
        position: { x: 0, y: 0 },
      },
    }]), context)

    expect(result).toMatchObject({
      ok: false,
      code: 'internal',
      currentRevision: document.head.revision,
    })
  })
})

describe('Profile Agent Group membership planning', () => {
  it('keeps a multi-member add valid when reframing absorbs a later member', () => {
    const fixture = createCompleteProfileFixture()
    fixture.snapshot.boards['idea-main']!.cards.push({
      id: 'card-auto-member',
      kind: 'note',
      position: { x: 450, y: 90 },
      blocks: [{ id: 'block-auto-member', text: 'Nearby evidence', kind: 'line' }],
    })
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    const planned = mustPlan(document, request(document.head.revision, [{
      version: 1,
      id: 'add-ask-to-group',
      name: 'group.membership.set',
      payload: {
        ideaId: 'idea-main',
        card: { cardId: 'card-ask' },
        group: { cardId: 'card-group' },
      },
    }, {
      version: 1,
      id: 'add-auto-member-to-group',
      name: 'group.membership.set',
      payload: {
        ideaId: 'idea-main',
        card: { cardId: 'card-auto-member' },
        group: { cardId: 'card-group' },
      },
    }] as never), trusted(), 5)

    expect(planned.commandResults).toEqual([
      {
        commandId: 'add-ask-to-group',
        name: 'group.membership.set',
        cardId: 'card-ask',
        groupId: 'card-group',
      },
      {
        commandId: 'add-auto-member-to-group',
        name: 'group.membership.set',
        cardId: 'card-auto-member',
        groupId: 'card-group',
      },
    ])
    const hydrated = hydrateProfileLogicalDocument(
      applyPlan(document, planned),
      fixture.hydrateAsset,
    )
    expect(hydrated.boards['idea-main']!.cards
      .filter(({ id }) => id === 'card-ask' || id === 'card-auto-member')
      .every(({ groupId }) => groupId === 'card-group')).toBe(true)
  })

  it('reframes on add and clears only saved membership on remove', () => {
    const fixture = createCompleteProfileFixture()
    let document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)

    const added = mustPlan(document, request(document.head.revision, [{
      version: 1,
      id: 'add-ask-to-group',
      name: 'group.membership.set',
      payload: {
        ideaId: 'idea-main',
        card: { cardId: 'card-ask' },
        group: { cardId: 'card-group' },
      },
    }] as never), trusted(), 5)
    expect(added.commandResults).toEqual([{
      commandId: 'add-ask-to-group',
      name: 'group.membership.set',
      cardId: 'card-ask',
      groupId: 'card-group',
    }])
    expect(added.intentEventDrafts.map(({ event }) => (
      (event as { type?: string }).type
    ))).toEqual(['card.moved', 'card.resized', 'group.members.changed'])
    document = applyPlan(document, added)
    let hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)
    const reframedGroup = hydrated.boards['idea-main']!.cards.find(({ id }) => id === 'card-group')
    expect(reframedGroup).toMatchObject({
      position: { x: 92, y: 34 },
      size: { width: 616, height: 256 },
    })
    expect(hydrated.boards['idea-main']!.cards.find(({ id }) => id === 'card-ask')?.groupId)
      .toBe('card-group')

    const removed = mustPlan(document, request(document.head.revision, [{
      version: 1,
      id: 'remove-ask-from-group',
      name: 'group.membership.set',
      payload: {
        ideaId: 'idea-main',
        card: { cardId: 'card-ask' },
        group: null,
      },
    }] as never), trusted('2026-07-19T02:00:00.000Z'), 5)
    expect(removed.commandResults).toEqual([{
      commandId: 'remove-ask-from-group',
      name: 'group.membership.set',
      cardId: 'card-ask',
      groupId: null,
    }])
    expect(removed.intentEventDrafts.map(({ event }) => (
      (event as { type?: string }).type
    ))).toEqual(['card.moved', 'group.members.changed'])
    document = applyPlan(document, removed)
    hydrated = hydrateProfileLogicalDocument(document, fixture.hydrateAsset)
    expect(hydrated.boards['idea-main']!.cards.find(({ id }) => id === 'card-group'))
      .toEqual(reframedGroup)
    expect(hydrated.boards['idea-main']!.cards.find(({ id }) => id === 'card-ask')?.groupId)
      .toBeUndefined()
  })
})

function switchMod(title: string, ids: readonly string[]): Mod<'switch'> {
  const mod = createSeedMod('switch', {
    title,
    createId: (role, ordinal) => `${role}-${ordinal}`,
  })
  mod.state.items = ids.map((id, index) => ({
    id,
    label: `SWITCH ${index + 1}`,
    on: index === 0,
    frame: '',
  }))
  return mod
}

function request(
  expectedRevision: number,
  commands: ProfileAgentCommandRequest['commands'],
): ProfileAgentCommandRequest {
  return {
    version: 1,
    schemaVersion: 1,
    expectedRevision,
    idempotencyKey: 'idempotency-agent-mods',
    dryRun: false,
    commands,
  }
}

function trusted(
  committedAt = COMMITTED_AT,
  stampedAt = committedAt,
): ProfileAgentCommandTrustedContext {
  return {
    profileId: 'profile-synthetic',
    actor: {
      id: 'agent-mod-test', kind: 'agent', transport: 'test',
      client: 'agent-mod-client', sessionId: 'agent-mod-session',
    },
    clientTxnId: 'client-txn-agent-mods',
    commitId: 'commit-agent-mods',
    committedAt,
    stampedAt,
    contentSha256: (text) => createHash('sha256').update(text).digest('hex'),
    deriveId(scope) {
      return [
        scope.purpose,
        scope.commandId,
        ...('sourceId' in scope ? [scope.sourceId, scope.ordinal] : []),
      ]
        .filter((part) => part !== undefined)
        .join(':')
    },
  }
}

function mustPlan(
  document: ProfileLogicalDocument,
  candidate: ProfileAgentCommandRequest,
  context: ProfileAgentCommandTrustedContext,
  surfaceVersion: NonNullable<Parameters<typeof planProfileAgentCommandBatch>[3]> = 2,
) {
  const result = planProfileAgentCommandBatch(document, candidate, context, surfaceVersion)
  expect(result.ok).toBe(true)
  if (!result.ok) throw new Error(result.message)
  return result.value
}

function applyPlan(
  document: ProfileLogicalDocument,
  plan: ReturnType<typeof mustPlan>,
): ProfileLogicalDocument {
  const records = new Map(document.records.map((record) => [record.recordId, record]))
  for (const change of plan.recordChanges) {
    if (change.operation === 'delete') records.delete(change.before.recordId)
    else records.set(change.after.recordId, change.after)
  }
  return {
    head: { ...document.head, revision: plan.proposedRevision },
    records: [...records.values()],
  }
}
