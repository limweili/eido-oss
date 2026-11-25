import { describe, expect, it } from 'vitest'
import { createSourceContextSnapshot, sourceChangeStatus } from '../brain/sourceContext'
import type { AppliedMod, CardAsset, IntentLogEvent } from '../graph/types'
import { listModPartIdentities } from '../mods/identity'
import { createSeedMod } from '../mods/seeds'
import { snapshotModValues } from '../mods/snapshot'
import { hydrateProfileLogicalAsset, toProfileLogicalAssetPayload } from './profileAssetKernel'
import {
  hydrateProfileLogicalDocument,
  projectProfileSnapshot,
} from './profileLogicalProjection'
import {
  remapLegacyProfileIdea,
  remapAppliedModControlIdentities,
  remapProfileIdea,
  type ProfileIdeaIdentityAllocator,
  type ProfileIdeaIdentityKind,
  type ProfileIdeaIdentityRemapResult,
} from './profileIdeaIdentityRemap'
import type { ProfileSnapshot } from './profileServiceContract'
import { createCompleteProfileFixture } from './fixtures/profileLogicalProjectionFixture'

const AT = '2026-07-19T03:00:00.000Z'

describe('Applied Mod identity remap (#764)', () => {
  it('walks v2 snapshot part identities while preserving the legacy payload byte shape', () => {
    const sourceMod = createSeedMod('matrix', {
      createId: (role, ordinal) => `source-${role}-${ordinal}`,
    })
    const snapshot = snapshotModValues(sourceMod)
    const v2: AppliedMod = {
      modVersion: 2,
      modCardId: 'card-mod-v2',
      controlValues: snapshot,
      appliedInstructions: ['Treat rows before columns.', 'Keep the contrast visible.'],
    }
    const seen: string[] = []

    const remappedV2 = remapAppliedModControlIdentities(v2, (sourceId) => {
      seen.push(sourceId)
      return `target-${sourceId}`
    })

    expect(seen).toEqual([
      ...sourceMod.state.rows.map(({ id }) => id),
      ...sourceMod.state.cols.map(({ id }) => id),
    ])
    expect(remappedV2).toMatchObject({
      modVersion: 2,
      modCardId: 'card-mod-v2',
      controlValues: {
        schema: 'mod-v2',
        kind: 'matrix',
        state: {
          rows: sourceMod.state.rows.map((row) => ({ ...row, id: `target-${row.id}` })),
          cols: sourceMod.state.cols.map((col) => ({ ...col, id: `target-${col.id}` })),
        },
      },
      appliedInstructions: v2.appliedInstructions,
    })
    expect(snapshot.state.rows.map(({ id }) => id)).toEqual(
      sourceMod.state.rows.map(({ id }) => id),
    )

    const legacy: AppliedMod = {
      modCardId: 'card-mod-legacy',
      participantCardId: 'card-participant',
      controlValues: {
        'control-one': 5,
        'control-two': { coincidentalControlId: 'control-one' },
      },
      appliedInstructions: ['Keep the established instruction.'],
    }
    expect(remapAppliedModControlIdentities(legacy, (id) => `target-${id}`)).toEqual({
      modCardId: 'card-mod-legacy',
      participantCardId: 'card-participant',
      controlValues: {
        'control-one': 5,
        'control-two': { coincidentalControlId: 'control-one' },
      },
      appliedInstructions: ['Keep the established instruction.'],
    })
  })
})

describe('Profile Idea identity remap (#463)', () => {
  it('remaps one complete native current and historical closure without touching provenance or opaque data', () => {
    const fixture = createCompleteProfileFixture()
    const snapshot = richSourceSnapshot(fixture.snapshot)
    const previewAsset: CardAsset = {
      id: 'asset-note-local-preview',
      kind: 'image',
      name: 'review.html preview.jpg',
      mimeType: 'image/jpeg',
      dataUrl: 'data:image/jpeg;base64,/9j/2Q==',
      size: 4,
      createdAt: AT,
      width: 1200,
      height: 675,
    }
    const sourceNote = snapshot.boards['idea-main']!.cards.find((card) => card.id === 'card-note')!
    sourceNote.assets = [...(sourceNote.assets ?? []), previewAsset]
    sourceNote.localHtmlPreview = {
      sourceId: 'source-opaque-remap',
      name: 'review.html',
      status: 'ready',
      assetId: previewAsset.id,
    }
    const sourceBoardForContext = snapshot.boards['idea-main']!
    sourceBoardForContext.outputs[0]!.versions.find((version) => version.id === 'version-result-1')!
      .sourceContext = clone(createSourceContextSnapshot(sourceBoardForContext, [
        { cardId: 'card-mod' },
        { cardId: 'card-group', groupMode: 'full' },
        { cardId: 'card-conversation-result' },
      ]))
    const dismissedAfterPreview = sourceBoardForContext.outputs[0]!.versions
      .find((version) => version.id === 'version-empty-containers')!
    dismissedAfterPreview.sourceChangeDismissedSignature = sourceChangeStatus(
      sourceBoardForContext,
      dismissedAfterPreview,
    )!.signature
    const sourceDocument = projectProfileSnapshot(snapshot, (asset) => (
      asset.id === previewAsset.id
        ? toProfileLogicalAssetPayload(asset, '3'.repeat(64))
        : fixture.projectAsset(asset)
    ))
    const hydrateSourceAsset = (payload: Parameters<typeof fixture.hydrateAsset>[0]) => (
      payload.id === previewAsset.id
        ? hydrateProfileLogicalAsset(payload, previewAsset.dataUrl)
        : fixture.hydrateAsset(payload)
    )
    const before = JSON.stringify(sourceDocument)
    const result = remapProfileIdea({
      sourceDocument,
      sourceIdeaId: 'idea-main',
      destinationDocument: sourceDocument,
      targetIdea: {
        id: 'idea-native-copy',
        name: 'Native copy',
        createdAt: AT,
        updatedAt: AT,
        lastOpenedAt: AT,
      },
      hydrateSourceAsset,
      allocateIdentity: prefixedAllocator('native-copy'),
    })

    expect(JSON.stringify(sourceDocument)).toBe(before)
    const hydrated = hydrateProfileLogicalDocument(result.document, (payload) => {
      const mapping = result.identityMap.find((entry) => (
        entry.kind === 'logical-asset' && entry.targetId === payload.id
      ))
      if (payload.id === previewAsset.id) return hydrateProfileLogicalAsset(payload, previewAsset.dataUrl)
      if (!mapping) return fixture.hydrateAsset(payload)
      if (mapping.sourceId === previewAsset.id) {
        return hydrateProfileLogicalAsset(payload, previewAsset.dataUrl)
      }
      const sourceAsset = fixture.hydrateAsset({ ...payload, id: mapping.sourceId })
      return { ...sourceAsset, id: payload.id }
    })
    const sourceBoard = hydrated.boards['idea-main']!
    const targetBoard = hydrated.boards['idea-native-copy']!
    expect(hydrated.activeIdeaId).toBe('idea-native-copy')
    expect(sourceBoard.cards.some((card) => card.id === 'card-note')).toBe(true)

    const targetNoteId = mapped(result, 'card', 'card-note')
    const targetNote = targetBoard.cards.find((card) => card.id === targetNoteId)!
    expect(targetNote.groupId).toBe(mapped(result, 'card', 'card-group'))
    expect(targetNote.blocks[0]!.id).toBe(mapped(result, 'block', 'block-note'))
    expect(targetNote.assets![0]!.id).toBe(mapped(result, 'logical-asset', 'asset-note-image'))
    expect(targetNote.localHtmlPreview?.assetId).toBe(
      mapped(result, 'logical-asset', previewAsset.id),
    )
    expect(targetNote.meta).toEqual({ coincidentalCardId: 'card-note' })

    const sourceModCard = sourceBoard.cards.find((card) => card.id === 'card-mod')!
    const targetModCard = targetBoard.cards.find((card) => (
      card.id === mapped(result, 'card', 'card-mod')
    ))!
    if (!sourceModCard.modV2 || !targetModCard.modV2) throw new Error('Expected v2 Mod Cards')
    expect(listModPartIdentities(targetModCard.modV2).map(({ sourceId }) => sourceId)).toEqual(
      listModPartIdentities(sourceModCard.modV2).map(({ sourceId }) => (
        mapped(result, 'mod-control', sourceId)
      )),
    )

    const targetRun = targetBoard.runs.find((run) => run.id === mapped(result, 'run', 'run-main'))!
    expect(targetRun.triggeredBy).toEqual({
      kind: 'agent',
      client: 'codex-desktop',
      sessionId: 'session-721',
    })
    expect(targetRun.usedGroupDigests).toEqual([{
      groupCardId: mapped(result, 'card', 'card-group'),
      versionId: mapped(result, 'output-version', 'version-result-1'),
      connectionId: mapped(result, 'connection', 'connection-note-ask'),
    }])
    expect(targetRun.contextBudget).toMatchObject({
      compactedCardIds: [mapped(result, 'card', 'card-retired-compacted')],
      droppedCardIds: [mapped(result, 'card', 'card-retired-dropped')],
    })
    expect(targetRun.plan).toMatchObject({
      rootCardId: mapped(result, 'card', 'card-ask'),
      steps: [{
        id: mapped(result, 'execution-step', 'step-main'),
        dependsOn: [mapped(result, 'execution-step', 'step-retired-dependency')],
        connectionId: mapped(result, 'connection', 'connection-retired-plan'),
      }],
    })
    expect(targetRun.appliedMods[0]!.controlValues).toEqual({
      'control-1': 5,
      'control-retired': {
        coincidentalControlId: 'control-1',
      },
    })

    const targetFreshVersion = targetBoard.outputs
      .find((output) => output.id === mapped(result, 'output', 'output-result'))!
      .versions.find((version) => version.id === mapped(result, 'output-version', 'version-result-1'))!
    expect(sourceChangeStatus(targetBoard, targetFreshVersion)).toBeNull()
    const sourceFreshVersion = sourceBoard.outputs
      .find((output) => output.id === 'output-result')!
      .versions.find((version) => version.id === 'version-result-1')!
    const sourceModFingerprint = sourceFreshVersion.sourceContext!.sources
      .find((source) => source.cardId === 'card-mod')!
    const targetModFingerprint = targetFreshVersion.sourceContext!.sources
      .find((source) => source.cardId === mapped(result, 'card', 'card-mod'))!
    expect(targetModFingerprint.hash).not.toBe(sourceModFingerprint.hash)

    const targetDismissedVersion = targetBoard.outputs
      .find((output) => output.id === mapped(result, 'output', 'output-result'))!
      .versions.find((version) => (
        version.id === mapped(result, 'output-version', 'version-empty-containers')
      ))!
    expect(sourceChangeStatus(targetBoard, targetDismissedVersion)).toBeNull()
    const withoutDismissal = clone(targetDismissedVersion)
    delete withoutDismissal.sourceChangeDismissedSignature
    const remappedStale = sourceChangeStatus(targetBoard, withoutDismissal)!
    expect(remappedStale.changes).toEqual([expect.objectContaining({
      cardId: mapped(result, 'card', 'card-note'),
      reason: 'changed',
    })])
    expect(targetDismissedVersion.sourceChangeDismissedSignature).toBe(remappedStale.signature)
    expect(targetDismissedVersion.sourceChangeDismissedSignature).not.toBe(
      sourceBoard.outputs[0]!.versions.find((version) => version.id === 'version-empty-containers')!
        .sourceChangeDismissedSignature,
    )
    const targetStaleVersion = targetBoard.outputs
      .find((output) => output.id === mapped(result, 'output', 'output-conversation'))!
      .versions.find((version) => (
        version.id === mapped(result, 'output-version', 'version-conversation-1')
      ))!
    expect(sourceChangeStatus(targetBoard, targetStaleVersion)).toMatchObject({
      changes: [expect.objectContaining({
        cardId: mapped(result, 'card', 'card-note'),
        reason: 'changed',
      })],
    })
    expect(targetStaleVersion.sourceChangeDismissedSignature).toBeUndefined()

    const targetBoardId = 'board:idea-native-copy'
    const sourceStamped = snapshot.modInstances.find((instance) => (
      instance.recordId === 'mod-stamp-1'
    ))!
    const stamped = hydrated.modInstances.find((instance) => (
      instance.ownerId === targetBoardId && instance.recordId === mapped(result, 'mod-instance', 'mod-stamp-1')
    ))!
    expect(stamped.payload.source).toEqual({
      kind: 'template',
      templateId: 'mod-template-synthetic',
      templateVersion: 1,
    })
    if (!('idMap' in stamped.payload)) throw new Error('Expected stamped Mod fixture')
    expect(stamped.payload.idMap.mod).toEqual({
      sourceId: 'mod-template-synthetic',
      instanceId: mapped(result, 'mod-instance', 'mod-stamp-1'),
    })
    if (!('idMap' in sourceStamped.payload)) throw new Error('Expected source stamp fixture')
    expect(stamped.payload.idMap.controls).toEqual(sourceStamped.payload.idMap.controls.map((pair) => ({
      sourceId: pair.sourceId,
      instanceId: mapped(result, 'mod-control', pair.instanceId),
    })))
    expect(listModPartIdentities(stamped.payload.mod).map(({ sourceId }) => sourceId)).toEqual(
      listModPartIdentities(sourceStamped.payload.mod).map(({ sourceId }) => (
        mapped(result, 'mod-control', sourceId)
      )),
    )
    expect(stamped.payload.mod).toMatchObject({
      futureWires: [{ from: 'control-1', to: 'card-note' }],
    })
    expect(targetModCard.modV2).toEqual(stamped.payload.mod)
    const sourceDirect = snapshot.modInstances.find((instance) => (
      instance.recordId === 'mod-direct-1'
    ))!
    const direct = hydrated.modInstances.find((instance) => (
      instance.ownerId === targetBoardId && instance.recordId === mapped(result, 'mod-instance', 'mod-direct-1')
    ))!
    expect(direct.payload).toMatchObject({
      source: { kind: 'direct' },
      createdAt: '2026-07-19T00:00:00.000Z',
      mod: { opaqueProvenance: { importedFrom: 'synthetic-fixture' } },
    })
    expect(listModPartIdentities(direct.payload.mod).map(({ sourceId }) => sourceId)).toEqual(
      listModPartIdentities(sourceDirect.payload.mod).map(({ sourceId }) => (
        mapped(result, 'mod-control', sourceId)
      )),
    )

    const moved = targetBoard.intentLog!.find((event) => event.type === 'card.moved')!
    expect(moved).toMatchObject({
      cardId: targetNoteId,
      commitId: 'commit-causal-preserved',
      actorId: 'actor-causal-preserved',
      clientTxnId: 'txn-causal-preserved',
      seq: 17,
      data: {
        moves: [{
          cardId: targetNoteId,
          previousGroupId: mapped(result, 'card', 'card-retired-group'),
          nextGroupId: mapped(result, 'card', 'card-group'),
        }],
      },
    })
    const groupChange = targetBoard.intentLog!.find((event) => event.type === 'group.members.changed')!
    if (groupChange.type !== 'group.members.changed') throw new Error('Expected group change')
    expect(groupChange.data.memberChanges).toEqual({
      [mapped(result, 'card', 'card-retired-member')]: {
        from: mapped(result, 'card', 'card-retired-group'),
        to: mapped(result, 'card', 'card-group'),
      },
    })
    const arranged = targetBoard.intentLog!.find((event) => event.type === 'cards.arranged')!
    expect(arranged).toMatchObject({
      cardId: targetNoteId,
      data: {
        changes: [{
          cardId: targetNoteId,
          before: { groupId: mapped(result, 'card', 'card-retired-group') },
          after: { groupId: mapped(result, 'card', 'card-group') },
        }],
        claimedTransitionEvidence: { version: 1, count: 1, sha256: 'a'.repeat(64) },
      },
    })
    const layer = targetBoard.intentLog!.find((event) => event.type === 'card.layer.changed')!
    expect(layer).toMatchObject({
      cardId: targetNoteId,
      data: {
        changes: [
          { cardId: targetNoteId, from: 0, to: 2 },
          { cardId: mapped(result, 'card', 'card-retired-member'), to: 1 },
        ],
        claimedTransitionEvidence: { version: 1, count: 2, sha256: 'b'.repeat(64) },
      },
    })
    const acceptance = targetBoard.intentLog!
      .find((event) => event.type === 'version.acceptance.changed')!
    expect(acceptance).toMatchObject({
      versionId: mapped(result, 'output-version', 'version-result-1'),
      data: {
        outputId: mapped(result, 'output', 'output-result'),
        claimedTransitionEvidence: { version: 1, count: 1, sha256: 'c'.repeat(64) },
      },
    })
    const noteEvent = targetBoard.intentLog!.find((event) => event.type === 'version.note.created')!
    expect(noteEvent).toMatchObject({
      versionId: mapped(result, 'output-version', 'version-conversation-1'),
      data: {
        sourceMessageId: mapped(result, 'transcript-message', 'transcript-participant-1'),
      },
    })

    expect(result.identityMap).toContainEqual(expect.objectContaining({
      kind: 'card', sourceId: 'card-retired-member', defined: false,
    }))
    expect(result.identityMap).toContainEqual(expect.objectContaining({
      kind: 'logical-asset', sourceId: 'asset-retired-image', defined: true,
    }))

    const targetAsset = result.document.records.find((record) => (
      record.kind === 'logical-asset'
      && record.recordId === mapped(result, 'logical-asset', 'asset-note-image')
    ))!
    expect(targetAsset.payload).toMatchObject({ sha256: '1'.repeat(64), size: 68 })
    const targetHistorical = result.document.records.find((record) => (
      record.kind === 'intent-event'
      && record.recordId === mapped(result, 'intent-event', 'event-retired-asset')
    ))!
    expect(targetHistorical.payload).toMatchObject({
      data: {
        card: {
          assets: [{
            id: mapped(result, 'logical-asset', 'asset-retired-image'),
            sha256: '2'.repeat(64),
          }],
        },
      },
    })
  })

  it('turns current v2 Board Mods into direct provenance and drops retired legacy Mods', () => {
    const fixture = createCompleteProfileFixture()
    const destination = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const sourceBoard = clone(fixture.snapshot.boards['idea-main']!)
    ;(sourceBoard.cards.find((card) => card.id === 'card-note') as unknown as Record<string, unknown>).mod = {
      id: 'retired-legacy-mod',
      label: 'Retired legacy Mod',
      controls: [{
        id: 'retired-legacy-control',
        label: 'Legacy control',
        kind: 'toggle',
        value: true,
      }],
    }
    const result = remapLegacyProfileIdea({
      sourceIdea: fixture.snapshot.ideas[0]!,
      sourceBoard,
      destinationDocument: destination,
      targetIdea: {
        id: 'idea-legacy-copy',
        name: 'Legacy copy',
        createdAt: AT,
        updatedAt: AT,
        lastOpenedAt: AT,
      },
      importedAt: AT,
      projectAsset: fixture.projectAsset,
      allocateIdentity: prefixedAllocator('legacy-copy'),
    })

    const hydrated = hydrateProfileLogicalDocument(result.document, placeholderAsset)
    const instances = hydrated.modInstances.filter((instance) => instance.ownerId === 'board:idea-legacy-copy')
    expect(instances).toHaveLength(2)
    expect(result.identityMap.filter(({ kind }) => kind === 'mod-instance').map(({ sourceId }) => sourceId))
      .toEqual([
        'mod-instance:legacy-import:idea-main:card-mod',
        'mod-instance:legacy-import:idea-main:card-mod-direct',
      ])
    expect(instances.every((instance) => instance.recordVersion === 2)).toBe(true)
    expect(instances.every((instance) => instance.payload.source.kind === 'direct')).toBe(true)
    expect(instances.every((instance) => 'idMap' in instance.payload === false)).toBe(true)
    expect(instances.every((instance) => (
      'createdAt' in instance.payload && instance.payload.createdAt === AT
    ))).toBe(true)
    for (const instance of instances) {
      const card = hydrated.boards['idea-legacy-copy']!.cards.find((candidate) => (
        candidate.id === instance.parentId
      ))!
      expect(card).not.toHaveProperty('mod')
      expect(card.modV2).toEqual(instance.payload.mod)
    }
    const importedNote = hydrated.boards['idea-legacy-copy']!.cards.find((card) => (
      card.id === mapped(result, 'card', 'card-note')
    ))!
    expect(importedNote).not.toHaveProperty('mod')
    expect(importedNote.modV2).toBeUndefined()
    expect(hydrated.modTemplates).toEqual(fixture.snapshot.modTemplates)
  })

  it('strips retired legacy Mods from live and historical Card snapshots without translating them', () => {
    const fixture = createCompleteProfileFixture()
    const destination = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const expectedSourceBoard = clone(fixture.snapshot.boards['idea-main']!)
    const note = expectedSourceBoard.cards.find((card) => card.id === 'card-note')!
    const group = expectedSourceBoard.cards.find((card) => card.id === 'card-group')!
    expectedSourceBoard.intentLog ??= []
    expectedSourceBoard.intentLog.push(
      {
        id: 'event-legacy-card-created-snapshot',
        at: AT,
        ideaId: 'idea-main',
        commitId: 'commit-legacy-history-preserved',
        actorId: 'actor-legacy-history-preserved',
        clientTxnId: 'txn-legacy-history-preserved',
        type: 'card.created',
        cardId: note.id,
        data: {
          card: {
            ...clone(note),
            title: 'Historical created Card fields survive',
            meta: { history: ['created', 7, false, null] },
          },
          sourceCardId: 'card-ask',
        },
      },
      {
        id: 'event-legacy-group-created-snapshot',
        at: AT,
        ideaId: 'idea-main',
        commitId: 'commit-legacy-group-preserved',
        actorId: 'actor-legacy-group-preserved',
        clientTxnId: 'txn-legacy-group-preserved',
        type: 'group.created',
        cardId: group.id,
        data: {
          card: {
            ...clone(group),
            title: 'Historical Group fields survive',
            meta: { history: ['group.created', 11] },
          },
          memberChanges: {
            'card-note': { to: group.id },
          },
        },
      },
    )

    const sourceBoard = clone(expectedSourceBoard)
    const retiredMod = {
      id: 'retired-live-and-history-mod',
      label: 'Retired legacy Mod',
      controls: [{
        id: 'retired-live-and-history-control',
        label: 'Retired control',
        kind: 'toggle' as const,
        value: true,
      }],
    }
    ;(sourceBoard.cards.find((card) => card.id === 'card-note') as unknown as Record<string, unknown>).mod = clone(retiredMod)
    const snapshotEventIds = new Set([
      'event-legacy-card-created-snapshot',
      'event-legacy-group-created-snapshot',
      'event-retired-asset',
    ])
    for (const event of sourceBoard.intentLog ?? []) {
      if (!snapshotEventIds.has(event.id)) continue
      if (event.type !== 'card.created'
        && event.type !== 'group.created'
        && event.type !== 'card.deleted') {
        throw new Error(`Expected Card-shaped Intent event ${event.id}`)
      }
      ;(event.data.card as unknown as Record<string, unknown>).mod = clone(retiredMod)
    }

    const request = {
      sourceIdea: fixture.snapshot.ideas[0]!,
      destinationDocument: destination,
      targetIdea: {
        id: 'idea-legacy-history-copy',
        name: 'Legacy history copy',
        createdAt: AT,
        updatedAt: AT,
        lastOpenedAt: AT,
      },
      importedAt: AT,
      projectAsset: fixture.projectAsset,
      allocateIdentity: prefixedAllocator('legacy-history-copy'),
    }
    const expected = remapLegacyProfileIdea({
      ...request,
      sourceBoard: expectedSourceBoard,
    })
    const before = JSON.stringify(sourceBoard)
    const result = remapLegacyProfileIdea({ ...request, sourceBoard })

    expect(JSON.stringify(sourceBoard)).toBe(before)
    expect(result).toEqual(expected)
    expect(JSON.stringify(result.document)).not.toContain('retired-live-and-history')

    const hydrated = hydrateProfileLogicalDocument(result.document, placeholderAsset)
    const importedBoard = hydrated.boards['idea-legacy-history-copy']!
    const importedNote = importedBoard.cards.find((card) => (
      card.id === mapped(result, 'card', 'card-note')
    ))!
    expect(importedNote).not.toHaveProperty('mod')
    expect(importedNote).not.toHaveProperty('modV2')
    for (const sourceEventId of snapshotEventIds) {
      const event = importedBoard.intentLog?.find((candidate) => (
        candidate.id === mapped(result, 'intent-event', sourceEventId)
      ))
      if (event?.type !== 'card.created'
        && event?.type !== 'group.created'
        && event?.type !== 'card.deleted') {
        throw new Error(`Missing remapped Card-shaped Intent event ${sourceEventId}`)
      }
      expect(event.data.card).not.toHaveProperty('mod')
      expect(event.data.card).not.toHaveProperty('modV2')
    }
  })

  it('rejects executable legacy input without evaluating it', () => {
    const fixture = createCompleteProfileFixture()
    const destination = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const board = clone(fixture.snapshot.boards['idea-main']!)
    let getterReads = 0
    Object.defineProperty(board.cards[0]!, 'title', {
      enumerable: true,
      get() {
        getterReads += 1
        return 'must not run'
      },
    })

    expect(() => remapLegacyProfileIdea({
      sourceIdea: fixture.snapshot.ideas[0]!,
      sourceBoard: board,
      destinationDocument: destination,
      targetIdea: {
        id: 'idea-hostile-copy',
        name: 'Hostile copy',
        createdAt: AT,
        updatedAt: AT,
        lastOpenedAt: AT,
      },
      importedAt: AT,
      projectAsset: fixture.projectAsset,
      allocateIdentity: prefixedAllocator('hostile-copy'),
    })).toThrow(/not inert JSON data/)
    expect(getterReads).toBe(0)
  })

  it('reserves orphaned destination stamp provenance against new logical identities', () => {
    const fixture = createCompleteProfileFixture()
    const sourceDocument = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    const destinationSnapshot = clone(fixture.snapshot)
    const stamped = destinationSnapshot.modInstances.find((instance) => instance.recordId === 'mod-stamp-1')!
    if (!('idMap' in stamped.payload)) throw new Error('Expected stamped Mod fixture')
    const payload = stamped.payload as unknown as {
      source: { templateId: string }
      idMap: { mod: { sourceId: string } }
    }
    payload.source.templateId = 'orphaned-template-id'
    payload.idMap.mod.sourceId = 'orphaned-template-id'
    const destinationDocument = projectProfileSnapshot(destinationSnapshot, fixture.projectAsset)

    expect(() => remapProfileIdea({
      sourceDocument,
      sourceIdeaId: 'idea-main',
      destinationDocument,
      targetIdea: {
        id: 'idea-provenance-copy',
        name: 'Provenance copy',
        createdAt: AT,
        updatedAt: AT,
        lastOpenedAt: AT,
      },
      hydrateSourceAsset: fixture.hydrateAsset,
      allocateIdentity: () => 'orphaned-template-id',
    })).toThrow(/reserved/)
  })

  const allocatorFailures: ReadonlyArray<Readonly<{
    name: string
    allocate: ProfileIdeaIdentityAllocator
  }>> = [
    { name: 'unchanged source identity', allocate: ({ sourceId }) => sourceId },
    { name: 'destination identity', allocate: () => 'card-second' },
    { name: 'duplicate generated identity', allocate: () => 'one-duplicate-target' },
    { name: 'preserved template identity', allocate: () => 'mod-template-synthetic' },
    { name: 'template nested identity', allocate: () => 'control-template-item-0' },
    { name: 'derived Board identity', allocate: () => 'board:idea-failed-copy' },
  ]

  it.each(allocatorFailures)('rejects allocator collision: $name', ({ allocate }) => {
    const fixture = createCompleteProfileFixture()
    const document = projectProfileSnapshot(fixture.snapshot, fixture.projectAsset)
    expect(() => remapProfileIdea({
      sourceDocument: document,
      sourceIdeaId: 'idea-main',
      destinationDocument: document,
      targetIdea: {
        id: 'idea-failed-copy',
        name: 'Failed copy',
        createdAt: AT,
        updatedAt: AT,
        lastOpenedAt: AT,
      },
      hydrateSourceAsset: fixture.hydrateAsset,
      allocateIdentity: allocate,
    })).toThrow(/fresh|reserved|duplicated/)
  })
})

function richSourceSnapshot(candidate: ProfileSnapshot): ProfileSnapshot {
  const snapshot = clone(candidate)
  const board = snapshot.boards['idea-main']!
  const note = board.cards.find((card) => card.id === 'card-note')!
  note.meta = { coincidentalCardId: 'card-note' }
  const stamped = snapshot.modInstances.find((instance) => instance.recordId === 'mod-stamp-1')!
  ;(stamped.payload.mod as unknown as Record<string, unknown>).futureWires = [
    { from: 'control-1', to: 'card-note' },
  ]
  board.cards.find((card) => card.id === 'card-mod')!.modV2 = clone(stamped.payload.mod)

  const run = board.runs.find((candidateRun) => candidateRun.id === 'run-main')!
  run.triggeredBy = { kind: 'agent', client: 'codex-desktop', sessionId: 'session-721' }
  run.usedGroupDigests = [{
    groupCardId: 'card-group',
    versionId: 'version-result-1',
    connectionId: 'connection-note-ask',
  }]
  run.contextBudget = {
    budgetTokens: 100,
    estimatedTokens: 120,
    finalTokens: 90,
    compactedCardIds: ['card-retired-compacted'],
    droppedCardIds: ['card-retired-dropped'],
    mode: 'when-needed',
  }
  run.plan = {
    version: 1,
    rootCardId: 'card-ask',
    steps: [{
      id: 'step-main',
      kind: 'ask',
      cardId: 'card-ask',
      dependsOn: ['step-retired-dependency'],
      connectionId: 'connection-retired-plan',
      contextPolicy: { name: 'direct', version: 1 },
    }],
  }
  run.appliedMods[0]!.controlValues = {
    'control-1': 5,
    'control-retired': { coincidentalControlId: 'control-1' },
  }
  const conversationRun = board.runs.find((candidateRun) => candidateRun.id === 'run-conversation')!
  conversationRun.conversation!.participants[0]!.participantMods = [{
    cardId: 'card-mod',
    label: 'Participant Mod',
    instructions: ['Keep exact strings.'],
  }]

  const dismissedVersion = board.outputs[0]!.versions
    .find((version) => version.id === 'version-empty-containers')!
  const staleSnapshot = clone(createSourceContextSnapshot(board, [{ cardId: 'card-note' }]))
  dismissedVersion.sourceContext = clone(staleSnapshot)
  board.outputs[1]!.versions[0]!.sourceContext = clone(staleSnapshot)
  note.blocks[0]!.text = 'Synthetic source note changed after the retained version.'
  dismissedVersion.sourceChangeDismissedSignature = sourceChangeStatus(board, dismissedVersion)!.signature
  const freshVersion = board.outputs[0]!.versions.find((version) => version.id === 'version-result-1')!
  freshVersion.sourceContext = clone(createSourceContextSnapshot(board, [
    { cardId: 'card-mod' },
    { cardId: 'card-group', groupMode: 'full' },
    { cardId: 'card-conversation-result' },
  ]))

  const runEvent = board.intentLog!.find((event) => event.id === 'event-run-completed')!
  if (runEvent.type === 'run.completed') runEvent.data.run = clone(run)
  const connection = clone(board.connections[0]!)
  const previousMessage = {
    id: 'follow-up-retired-message',
    role: 'assistant' as const,
    text: 'Historical answer',
    createdAt: AT,
    status: 'complete' as const,
  }
  const extraEvents: IntentLogEvent[] = [
    {
      id: 'event-moved-rich',
      at: AT,
      ideaId: 'idea-main',
      commitId: 'commit-causal-preserved',
      actorId: 'actor-causal-preserved',
      clientTxnId: 'txn-causal-preserved',
      seq: 17,
      type: 'card.moved',
      cardId: 'card-note',
      data: {
        moves: [{
          cardId: 'card-note',
          from: { x: 0, y: 0 },
          to: { x: 1, y: 1 },
          previousGroupId: 'card-retired-group',
          nextGroupId: 'card-group',
        }],
      },
    },
    {
      id: 'event-asset-rich', at: AT, ideaId: 'idea-main', type: 'card.content.edited',
      cardId: 'card-note', data: { field: 'assets', action: 'remove', assetId: 'asset-retired-soft' },
    },
    {
      id: 'event-arranged-rich', at: AT, ideaId: 'idea-main', type: 'cards.arranged',
      cardId: 'card-note',
      data: {
        changes: [{
          cardId: 'card-note',
          before: {
            position: { x: 0, y: 0 }, size: { width: 260, height: 180 },
            groupId: 'card-retired-group',
          },
          after: {
            position: { x: 20, y: 30 }, size: { width: 300, height: 200 },
            groupId: 'card-group',
          },
        }],
        claimedTransitionEvidence: { version: 1, count: 1, sha256: 'a'.repeat(64) },
      },
    },
    {
      id: 'event-layer-rich', at: AT, ideaId: 'idea-main', type: 'card.layer.changed',
      cardId: 'card-note',
      data: {
        direction: 'front',
        changes: [
          { cardId: 'card-note', from: 0, to: 2 },
          { cardId: 'card-retired-member', to: 1 },
        ],
        claimedTransitionEvidence: { version: 1, count: 2, sha256: 'b'.repeat(64) },
      },
    },
    {
      id: 'event-members-rich', at: AT, ideaId: 'idea-main', type: 'group.members.changed',
      cardId: 'card-group',
      data: { memberChanges: { 'card-retired-member': { from: 'card-retired-group', to: 'card-group' } } },
    },
    {
      id: 'event-connection-rich', at: AT, ideaId: 'idea-main', type: 'connection.changed',
      connectionId: connection.id,
      data: { before: connection, after: { ...clone(connection), reason: 'Changed without changing identity.' } },
    },
    {
      id: 'event-compression-rich', at: AT, ideaId: 'idea-main', type: 'group.compression.completed',
      cardId: 'card-group', runId: run.id, versionId: 'version-result-1', data: { run: clone(run) },
    },
    {
      id: 'event-version-rich', at: AT, ideaId: 'idea-main', type: 'version.chosen',
      versionId: 'version-result-1',
      data: { outputId: 'output-result', previousVersionId: 'version-retired-choice', nextVersionId: 'version-result-1' },
    },
    {
      id: 'event-acceptance-rich', at: AT, ideaId: 'idea-main',
      type: 'version.acceptance.changed', versionId: 'version-result-1',
      data: {
        outputId: 'output-result', from: false, to: true,
        claimedTransitionEvidence: { version: 1, count: 1, sha256: 'c'.repeat(64) },
      },
    },
    {
      id: 'event-note-rich', at: AT, ideaId: 'idea-main', type: 'version.note.created',
      versionId: 'version-conversation-1', cardId: 'card-note',
      data: {
        outputId: 'output-conversation', resultCardId: 'card-conversation-result',
        noteCardId: 'card-note', source: 'conversation', sourceMessageId: 'transcript-participant-1', textLength: 12,
      },
    },
    {
      id: 'event-followup-rich', at: AT, ideaId: 'idea-main', type: 'followup.message.added',
      versionId: 'version-result-1',
      data: { outputId: 'output-result', resultCardId: 'card-result', message: previousMessage },
    },
    {
      id: 'event-followup-clear-rich', at: AT, ideaId: 'idea-main', type: 'followup.thread.cleared',
      versionId: 'version-result-1',
      data: { outputId: 'output-result', resultCardId: 'card-result', previousMessages: [previousMessage] },
    },
  ]
  board.intentLog!.push(...extraEvents)
  return snapshot
}

function prefixedAllocator(prefix: string): ProfileIdeaIdentityAllocator {
  return ({ kind, sourceId }) => `${prefix}:${kind}:${sourceId}`
}

function mapped(
  result: ProfileIdeaIdentityRemapResult,
  kind: ProfileIdeaIdentityKind,
  sourceId: string,
): string {
  const mapping = result.identityMap.find((entry) => entry.kind === kind && entry.sourceId === sourceId)
  if (!mapping) throw new Error(`Missing mapping for ${kind}:${sourceId}`)
  return mapping.targetId
}

function placeholderAsset(payload: Parameters<typeof hydrateProfileLogicalAsset>[0]) {
  return hydrateProfileLogicalAsset(payload, `data:${payload.mimeType};base64,`)
}

function clone<Value>(value: Value): Value {
  return JSON.parse(JSON.stringify(value)) as Value
}
