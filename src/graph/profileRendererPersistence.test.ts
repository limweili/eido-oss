import { describe, expect, it, vi } from 'vitest'
import {
  PROFILE_RENDERER_CHECKPOINT_ACK_EVENT,
  PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT,
  type InstalledProfileBridge,
  type RendererProfileProjection,
  type ProfileRendererCheckpointAck,
} from '../../electron/profileBridgeContract'
import {
  mergeGuiProfileProjection,
  type GuiNewModOrigin,
  type GuiProfileProjection,
  type ProfileGuiProjectionDependencies,
  type GuiUserModTemplate,
} from '../persistence/profileGuiProjection'
import {
  PROFILE_CONTRACT_VERSIONS,
  profileServiceFailure,
  type ProfileSnapshot,
} from '../persistence/profileServiceContract'
import { createSeedMod, listModPartIdentities, remapModPartIdentities } from '../mods'
import type { IntentLogEvent, SavedBoard } from './types'
import {
  registerProfileRendererCheckpointHandler,
  selectProfileRendererPersistence,
  type ProfileRendererHydration,
  type ProfileRendererStateSink,
} from './profileRendererPersistence'

const BOARD: SavedBoard = {
  version: 1,
  cards: [],
  connections: [],
  outputs: [],
  runs: [],
  updatedAt: '2026-07-19T00:00:00.000Z',
}

const USER_MOD = {
  templateId: 'mod-user-one',
  mod: createSeedMod('slider', {
    title: 'USER MOD',
    createId: (role, ordinal) => `user-${role}-${ordinal}`,
  }),
}

const BUILT_IN_MOD = createSeedMod('switch', {
  title: 'BUILT IN',
  createId: (role, ordinal) => `builtin-${role}-${ordinal}`,
})

function profileSnapshot(): ProfileSnapshot {
  return {
    profileId: 'profile-synthetic',
    revision: 7,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: 'idea-one',
    ideas: [{
      id: 'idea-one',
      name: 'One',
      createdAt: '2026-07-19T00:00:00.000Z',
      updatedAt: '2026-07-19T00:00:00.000Z',
      lastOpenedAt: '2026-07-19T00:00:00.000Z',
    }],
    boards: { 'idea-one': BOARD },
    modTemplates: [
      {
        kind: 'mod-template',
        recordId: 'builtin-mod-one',
        ownerId: 'profile-synthetic',
        parentId: 'profile-synthetic',
        recordVersion: 2,
        payload: {
          templateVersion: 1,
          provenance: { kind: 'built-in' },
          createdAt: '2026-07-19T00:00:00.000Z',
          updatedAt: '2026-07-19T00:00:00.000Z',
          mod: BUILT_IN_MOD,
        },
      },
      {
        kind: 'mod-template',
        recordId: USER_MOD.templateId,
        ownerId: 'profile-synthetic',
        parentId: 'profile-synthetic',
        recordVersion: 2,
        payload: {
          templateVersion: 3,
          provenance: { kind: 'user' },
          createdAt: '2026-07-19T00:00:00.000Z',
          updatedAt: '2026-07-19T00:00:00.000Z',
          mod: USER_MOD.mod,
        },
      },
    ],
    modInstances: [],
    profileSettings: [{
      id: 'profile-setting-locale',
      recordVersion: 1,
      classification: 'portable-profile',
      value: { locale: 'en-AU' },
    }],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
}

function profileHydration(
  snapshot: ProfileSnapshot,
  epoch = `epoch-${snapshot.revision}`,
  intentActorId = 'actor-trusted-owner',
) {
  return {
    intentActorId,
    snapshot,
    acknowledgement: { epoch, revision: snapshot.revision },
  }
}

function bridgeWith(
  snapshot: ProfileSnapshot,
  overrides: Partial<InstalledProfileBridge> = {},
): InstalledProfileBridge {
  const unavailable = vi.fn(async () => {
    throw new Error('not used')
  })
  return {
    runtimeProbe: unavailable,
    hydrate: vi.fn(async () => ({ ok: true, value: profileHydration(snapshot) })),
    ackHydration: vi.fn(async (epoch: string, revision: number) => ({
      ok: true as const,
      value: { acknowledged: true as const, epoch, revision },
    })),
    createOrdinaryIdea: unavailable,
    commitGuiProjection: unavailable,
    confirmRevision: unavailable,
    flush: unavailable,
    status: unavailable,
    capabilities: unavailable,
    query: unavailable,
    exportPortable: unavailable,
    duplicateIdea: unavailable,
    importIdeaClosure: unavailable,
    inspectRecovery: unavailable,
    restoreRecovery: unavailable,
    startFresh: unavailable,
    ...overrides,
  } as unknown as InstalledProfileBridge
}

function stateSink(
  overrides: Partial<ProfileRendererStateSink> = {},
): ProfileRendererStateSink {
  return {
    applyHydration: vi.fn(() => undefined),
    applyAuthoritativeUpdate: vi.fn((update) => ({
      status: 'applied' as const,
      revision: update.revision,
    })),
    admitHydration: vi.fn(() => undefined),
    applySaveStatus: vi.fn(),
    applyTerminalFailure: vi.fn(),
    ...overrides,
  }
}

function connectStateSink(
  selection: ReturnType<typeof selectProfileRendererPersistence>,
  sink: ProfileRendererStateSink = stateSink(),
) {
  if (selection.kind !== 'packaged-profile') throw new Error('expected packaged persistence')
  selection.persistence.connectStateSink(sink)
  return selection.persistence
}

describe('Profile renderer persistence', () => {
  it('permits browser persistence only through an explicit development context', () => {
    expect(selectProfileRendererPersistence({}, { mode: 'browser-development' })).toEqual({
      kind: 'browser-development',
    })
    expect(selectProfileRendererPersistence({
      location: { protocol: 'http:', hostname: 'localhost' },
    })).toEqual({ kind: 'browser-development' })

    expect(() => selectProfileRendererPersistence({
      location: { protocol: 'eido:', hostname: 'app' },
    })).toThrow('Packaged Profile bridge is unavailable')
    expect(() => selectProfileRendererPersistence({})).toThrow(
      'Packaged Profile bridge is unavailable',
    )

    expect(() => selectProfileRendererPersistence({ eidoDesktop: undefined })).toThrow(
      'Packaged Profile bridge is unavailable',
    )
    expect(() => selectProfileRendererPersistence({
      eidoDesktop: true,
      eidoProfile: { runtimeProbe: async () => ({}) },
    })).toThrow('Packaged Profile bridge is unavailable')
    expect(() => selectProfileRendererPersistence({
      eidoProfile: bridgeWith(profileSnapshot()),
    })).toThrow('Packaged Profile bridge is unavailable')
  })

  it('hydrates the active Board and native user Mod library for the current renderer model', async () => {
    const selection = selectProfileRendererPersistence({
      eidoDesktop: true,
      eidoProfile: bridgeWith(profileSnapshot()),
    })
    expect(selection.kind).toBe('packaged-profile')
    const persistence = connectStateSink(selection)

    await expect(persistence.hydrate()).resolves.toEqual({
      intentActorId: 'actor-trusted-owner',
      idea: profileSnapshot().ideas[0],
      board: BOARD,
      ideas: profileSnapshot().ideas,
      userModTemplates: [USER_MOD],
      modOrigins: {},
    })

    const stamped = persistence.stampModTemplate(USER_MOD.templateId)
    const sourceParts = listModPartIdentities(USER_MOD.mod)
    const instanceParts = listModPartIdentities(stamped.mod)
    expect(stamped.origin).toEqual({
      kind: 'stamped',
      instanceId: expect.any(String),
      sourceTemplateId: USER_MOD.templateId,
      sourceTemplateVersion: 3,
      sourceToInstanceIdMap: {
        mod: {
          sourceId: USER_MOD.templateId,
          instanceId: expect.any(String),
        },
        controls: sourceParts.map((part, index) => ({
          sourceId: part.sourceId,
          instanceId: instanceParts[index]!.sourceId,
        })),
      },
    })
    if (stamped.origin.kind !== 'stamped') throw new Error('Expected stamped origin')
    expect(stamped.origin.instanceId).toBe(stamped.origin.sourceToInstanceIdMap.mod.instanceId)
  })

  it('keeps a timestamp-only live Agent barrier at the current Profile revision', async () => {
    const snapshot = profileSnapshot()
    const commitGuiProjection = vi.fn(async () => {
      throw new Error('Timestamp-only renderer state must not create a GUI revision')
    })
    const bridge = bridgeWith(snapshot, {
      commitGuiProjection,
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: 0, revision: snapshot.revision },
      })),
    })
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
    )
    await persistence.hydrate()

    await expect(persistence.beginAuthoritativeMutation({
      activeIdeaId: snapshot.activeIdeaId,
      ideas: snapshot.ideas,
      board: { ...BOARD, updatedAt: '2026-07-19T00:00:30.000Z' },
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })).resolves.toEqual({
      generation: 0,
      nativeGeneration: 0,
      revision: snapshot.revision,
    })
    await expect(persistence.finishAuthoritativeMutation()).resolves.toEqual({
      generation: 0,
      nativeGeneration: 0,
      revision: snapshot.revision,
    })
    expect(commitGuiProjection).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['oversized', 'a'.repeat(513)],
    ['multibyte byte overflow', 'é'.repeat(257)],
  ])('fails terminally before applying hydration with a %s Intent actor', async (_case, actor) => {
    const snapshot = profileSnapshot()
    const applyHydration = vi.fn(() => undefined)
    const admitHydration = vi.fn(() => undefined)
    const bridge = bridgeWith(snapshot, {
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: { ...profileHydration(snapshot), intentActorId: actor },
      })) as InstalledProfileBridge['hydrate'],
    })
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({ applyHydration, admitHydration }),
    )

    await expect(persistence.hydrate()).rejects.toThrow(
      'Profile hydration Intent actor identity was invalid',
    )
    expect(applyHydration).not.toHaveBeenCalled()
    expect(admitHydration).not.toHaveBeenCalled()
    expect(bridge.ackHydration).not.toHaveBeenCalled()
  })

  it('fails terminally before applying a changed Intent actor on rehydration', async () => {
    const snapshot = profileSnapshot()
    let hydrationCount = 0
    const applyHydration = vi.fn(() => undefined)
    const admitHydration = vi.fn(() => undefined)
    const bridge = bridgeWith(snapshot, {
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: profileHydration(
          snapshot,
          `actor-epoch-${hydrationCount}`,
          hydrationCount++ === 0 ? 'actor-trusted-owner' : 'actor-changed',
        ),
      })),
    })
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({ applyHydration, admitHydration }),
    )

    await persistence.hydrate()
    await expect(persistence.hydrate()).rejects.toThrow(
      'Profile hydration Intent actor identity changed',
    )
    expect(applyHydration).toHaveBeenCalledOnce()
    expect(admitHydration).toHaveBeenCalledOnce()
    expect(bridge.ackHydration).toHaveBeenCalledOnce()
  })

  it('applies exact native Mod origins to renderer state before acknowledging hydration', async () => {
    const stampedMod = remapModPartIdentities(
      USER_MOD.mod,
      ({ role, ordinal }) => `stamped-${role}-${ordinal}`,
    )
    const directMod = createSeedMod('count', {
      createId: (role, ordinal) => `direct-${role}-${ordinal}`,
    })
    const snapshot = profileSnapshot()
    snapshot.boards['idea-one'] = {
      ...BOARD,
      cards: [
        {
          id: 'card-stamped',
          kind: 'mod',
          blocks: [{ id: 'block-stamped', text: '' }],
          position: { x: 0, y: 0 },
          modV2: stampedMod.value,
        },
        {
          id: 'card-direct',
          kind: 'mod',
          blocks: [{ id: 'block-direct', text: '' }],
          position: { x: 100, y: 0 },
          modV2: directMod,
        },
      ],
    }
    snapshot.modInstances = [
      {
        kind: 'mod-instance',
        recordId: 'mod-instance-stamped',
        ownerId: 'board:idea-one',
        parentId: 'card-stamped',
        recordVersion: 2,
        payload: {
          source: { kind: 'template', templateId: USER_MOD.templateId, templateVersion: 3 },
          idMap: {
            mod: { sourceId: USER_MOD.templateId, instanceId: 'mod-instance-stamped' },
            controls: stampedMod.mappings.map((mapping) => ({
              sourceId: mapping.sourceId,
              instanceId: mapping.instanceId,
            })),
          },
          stampedAt: '2026-07-19T00:00:00.000Z',
          mod: stampedMod.value,
        },
      },
      {
        kind: 'mod-instance',
        recordId: 'mod-instance-direct',
        ownerId: 'board:idea-one',
        parentId: 'card-direct',
        recordVersion: 2,
        payload: {
          source: { kind: 'direct' },
          createdAt: '2026-07-19T00:00:00.000Z',
          mod: directMod,
        },
      },
    ]
    const order: string[] = []
    const ackHydration = vi.fn(async (epoch: string, revision: number) => {
      order.push('ack')
      return { ok: true as const, value: { acknowledged: true as const, epoch, revision } }
    })
    const selection = selectProfileRendererPersistence({
      eidoDesktop: true,
      eidoProfile: bridgeWith(snapshot, { ackHydration }),
    })
    const persistence = connectStateSink(selection, stateSink({
      applyHydration: vi.fn((hydration) => {
        order.push('apply')
        expect(hydration.modOrigins).toEqual({
          'card-stamped': {
            kind: 'stamped',
            instanceId: 'mod-instance-stamped',
            sourceTemplateId: USER_MOD.templateId,
            sourceTemplateVersion: 3,
            sourceToInstanceIdMap: {
              mod: { sourceId: USER_MOD.templateId, instanceId: 'mod-instance-stamped' },
              controls: stampedMod.mappings.map((mapping) => ({
                sourceId: mapping.sourceId,
                instanceId: mapping.instanceId,
              })),
            },
          },
          'card-direct': { kind: 'direct', instanceId: 'mod-instance-direct' },
        })
        return undefined
      }),
      admitHydration: vi.fn(() => {
        order.push('admit')
        return undefined
      }),
    }))

    await persistence.hydrate()

    expect(order).toEqual(['apply', 'ack', 'admit'])
  })

  it('applies a newer authoritative snapshot through the live renderer seam', async () => {
    const initial = profileSnapshot()
    const agentCard = {
      id: 'agent-created',
      kind: 'note' as const,
      position: { x: 100, y: 200 },
      blocks: [{ id: 'agent-created-block', text: 'Added by an agent' }],
      createdBy: { kind: 'agent' as const, client: 'codex', sessionId: 'agent-session' },
      lastModifiedBy: { kind: 'agent' as const, client: 'codex', sessionId: 'agent-session' },
    }
    const refreshed: ProfileSnapshot = {
      ...initial,
      revision: 8,
      boards: {
        ...initial.boards,
        'idea-one': { ...BOARD, cards: [agentCard], updatedAt: '2026-07-22T00:02:00.000Z' },
      },
    }
    const applyAuthoritativeUpdate = vi.fn((update) => ({
      status: 'applied' as const,
      revision: update.revision,
    }))
    const bridge = bridgeWith(initial)
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({ applyAuthoritativeUpdate }),
    )
    await persistence.hydrate()

    expect(persistence.applyAuthoritativeSnapshot(refreshed)).toEqual({
      status: 'applied',
      revision: 8,
    })
    expect(applyAuthoritativeUpdate).toHaveBeenCalledWith(expect.objectContaining({
      previousRevision: 7,
      revision: 8,
      previous: expect.objectContaining({ board: BOARD }),
      next: expect.objectContaining({ board: refreshed.boards['idea-one'] }),
    }))
    expect(bridge.hydrate).toHaveBeenCalledOnce()
    expect(bridge.ackHydration).toHaveBeenCalledOnce()

    expect(persistence.applyAuthoritativeSnapshot(initial)).toEqual({
      status: 'stale',
      revision: 8,
    })
    expect(applyAuthoritativeUpdate).toHaveBeenCalledOnce()
  })

  it('blocks a newer authoritative snapshot while renderer work is pending', async () => {
    const initial = profileSnapshot()
    const refreshed: ProfileSnapshot = { ...initial, revision: 8 }
    const applyAuthoritativeUpdate = vi.fn((update) => ({
      status: 'applied' as const,
      revision: update.revision,
    }))
    const bridge = bridgeWith(initial, {
      commitGuiProjection: vi.fn(() => new Promise<Awaited<
        ReturnType<InstalledProfileBridge['commitGuiProjection']>
      >>(() => undefined)),
    })
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({ applyAuthoritativeUpdate }),
    )
    await persistence.hydrate()
    persistence.schedule({
      activeIdeaId: initial.activeIdeaId,
      ideas: initial.ideas,
      board: { ...BOARD, updatedAt: '2026-07-22T00:01:00.000Z' },
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })

    expect(persistence.applyAuthoritativeSnapshot(refreshed)).toEqual({
      status: 'blocked',
      revision: 7,
    })
    expect(applyAuthoritativeUpdate).not.toHaveBeenCalled()
  })

  it('holds a queued GUI commit across a live Agent revision and rebases both changes', async () => {
    const firstGuiEvent = movedIntentEvent(
      'event-first-gui',
      'actor-trusted-owner',
      '2026-07-22T01:00:00.000Z',
      1,
    )
    const agentEvent = movedIntentEvent(
      'event-agent-live',
      'actor-agent-live',
      '2026-07-22T01:00:02.000Z',
      2,
    )
    const heldGuiEvent = movedIntentEvent(
      'event-held-gui',
      'actor-trusted-owner',
      '2026-07-22T01:00:01.000Z',
      2,
    )
    const rebasedHeldGuiEvent = {
      ...heldGuiEvent,
      at: agentEvent.at,
      seq: 3,
    }
    const baseCard = {
      id: 'card-base',
      kind: 'note' as const,
      position: { x: 0, y: 0 },
      blocks: [{ id: 'block-base', kind: 'line' as const, text: 'Base' }],
    }
    const initialBoard = { ...BOARD, cards: [baseCard], intentLog: [] }
    const initial: ProfileSnapshot = {
      ...profileSnapshot(),
      boards: { 'idea-one': initialBoard },
    }
    const firstGuiIdea = {
      ...initial.ideas[0]!,
      updatedAt: '2026-07-22T01:00:00.000Z',
      lastOpenedAt: '2026-07-22T01:00:00.000Z',
    }
    const firstGuiBoard = {
      ...initialBoard,
      cards: [{ ...baseCard, position: { x: 20, y: 10 } }],
      intentLog: [firstGuiEvent],
      updatedAt: '2026-07-22T01:00:00.000Z',
    }
    const userCard = {
      id: 'card-user-held',
      kind: 'note' as const,
      position: { x: 200, y: 10 },
      blocks: [{ id: 'block-user-held', kind: 'line' as const, text: 'User held' }],
    }
    const heldGuiBoard = {
      ...firstGuiBoard,
      cards: [
        { ...firstGuiBoard.cards[0], position: { x: 30, y: 10 } },
        userCard,
      ],
      intentLog: [firstGuiEvent, heldGuiEvent],
      updatedAt: '2026-07-22T01:00:01.000Z',
    }
    const heldGuiIdea = {
      ...firstGuiIdea,
      name: 'User held rename',
      updatedAt: '2026-07-22T01:00:01.000Z',
      lastOpenedAt: '2026-07-22T01:00:01.000Z',
    }
    const agentCard = {
      id: 'card-agent-live',
      kind: 'note' as const,
      position: { x: 400, y: 10 },
      blocks: [{ id: 'block-agent-live', kind: 'line' as const, text: 'Agent live' }],
      createdBy: { kind: 'agent' as const, client: 'codex', sessionId: 'live-session' },
      lastModifiedBy: { kind: 'agent' as const, client: 'codex', sessionId: 'live-session' },
    }
    const authoritative: ProfileSnapshot = {
      ...initial,
      revision: 9,
      ideas: [{
        ...firstGuiIdea,
        updatedAt: '2026-07-22T01:00:02.000Z',
        lastOpenedAt: '2026-07-22T01:00:02.000Z',
      }],
      boards: {
        'idea-one': {
          ...firstGuiBoard,
          cards: [
            { ...firstGuiBoard.cards[0], position: { x: 200, y: 10 } },
            agentCard,
          ],
          intentLog: [firstGuiEvent, agentEvent],
          updatedAt: '2026-07-22T01:00:02.000Z',
        },
      },
    }
    let nativeGeneration = 0
    let nativeRevision = 7
    let resolveFirstCommit!: (value: {
      ok: true
      value: { generation: number; revision: number; durable: true; dirty: false }
    }) => void
    const submitted: RendererProfileProjection[] = []
    const commitGuiProjection = vi.fn(async (candidate: RendererProfileProjection) => {
      submitted.push(candidate)
      if (submitted.length === 1) {
        expect(validateSubmittedGuiProjection(initial, candidate).snapshot).toMatchObject({
          revision: 8,
          ideas: [firstGuiIdea],
          boards: { 'idea-one': { updatedAt: firstGuiBoard.updatedAt } },
        })
        return new Promise<Parameters<typeof resolveFirstCommit>[0]>((resolve) => {
          resolveFirstCommit = resolve
        })
      }
      expect(candidate.boardReplacements['idea-one']?.intentLog).toEqual([
        firstGuiEvent,
        agentEvent,
        rebasedHeldGuiEvent,
      ])
      expect(candidate.ideas[0]).toEqual({
        ...heldGuiIdea,
        updatedAt: authoritative.ideas[0]!.updatedAt,
        lastOpenedAt: authoritative.ideas[0]!.lastOpenedAt,
      })
      expect(candidate.boardReplacements['idea-one']?.updatedAt).toBe(
        authoritative.boards['idea-one']!.updatedAt,
      )
      const admitted = validateSubmittedGuiProjection(authoritative, candidate)
      expect(admitted.snapshot).toMatchObject({
        revision: 10,
        ideas: [{
          name: heldGuiIdea.name,
          createdAt: heldGuiIdea.createdAt,
          updatedAt: authoritative.ideas[0]!.updatedAt,
          lastOpenedAt: authoritative.ideas[0]!.lastOpenedAt,
        }],
        boards: {
          'idea-one': { updatedAt: authoritative.boards['idea-one']!.updatedAt },
        },
      })
      nativeGeneration = 2
      nativeRevision = 10
      return {
        ok: true as const,
        value: { generation: 2, revision: 10, durable: true as const, dirty: false as const },
      }
    })
    const bridge = bridgeWith(initial, {
      commitGuiProjection,
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: nativeRevision },
      })),
    })
    const applyTerminalFailure = vi.fn()
    const applyAuthoritativeUpdate = vi.fn((
      update: Parameters<ProfileRendererStateSink['applyAuthoritativeUpdate']>[0],
    ) => {
      expect(update.previous.board.cards.map((card) => card.id)).toEqual([
        'card-base',
        'card-user-held',
      ])
      expect(update.next.board.cards.map((card) => card.id)).toEqual([
        'card-base',
        'card-user-held',
        'card-agent-live',
      ])
      expect(update.previous.board.cards[0]?.position).toEqual({ x: 30, y: 10 })
      expect(update.next.board.cards[0]?.position).toEqual({ x: 30, y: 10 })
      expect(update.authoritativeTransition.previous.board.cards[0]?.position).toEqual({
        x: 20,
        y: 10,
      })
      expect(update.authoritativeTransition.next.board.cards[0]?.position).toEqual({
        x: 200,
        y: 10,
      })
      return { status: 'applied' as const, revision: update.revision }
    })
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({ applyAuthoritativeUpdate, applyTerminalFailure }),
    )
    await persistence.hydrate()

    persistence.schedule({
      activeIdeaId: initial.activeIdeaId,
      ideas: [firstGuiIdea],
      board: firstGuiBoard,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })
    const barrier = persistence.beginAuthoritativeMutation({
      activeIdeaId: initial.activeIdeaId,
      ideas: [firstGuiIdea],
      board: firstGuiBoard,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })
    persistence.schedule({
      activeIdeaId: initial.activeIdeaId,
      ideas: [heldGuiIdea],
      board: heldGuiBoard,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })
    expect(commitGuiProjection).toHaveBeenCalledTimes(1)

    nativeGeneration = 1
    nativeRevision = 8
    resolveFirstCommit({
      ok: true,
      value: { generation: 1, revision: 8, durable: true, dirty: false },
    })
    await expect(barrier).resolves.toEqual({
      generation: 1,
      nativeGeneration: 1,
      revision: 8,
    })

    expect(persistence.applyAuthoritativeSnapshot(authoritative)).toEqual({
      status: 'applied',
      revision: 9,
    })
    await expect(persistence.finishAuthoritativeMutation()).resolves.toEqual({
      generation: 2,
      nativeGeneration: 2,
      revision: 10,
    })

    expect(commitGuiProjection).toHaveBeenCalledTimes(2)
    expect(submitted[1]?.boardReplacements['idea-one']?.cards.map((card) => card.id)).toEqual([
      'card-base',
      'card-user-held',
      'card-agent-live',
    ])
    expect(submitted[1]?.boardReplacements['idea-one']?.intentLog?.map((event) => event.id)).toEqual([
      'event-first-gui',
      'event-agent-live',
      'event-held-gui',
    ])
    expect(applyTerminalFailure).not.toHaveBeenCalled()
  })

  it('admits a synchronous ready-observer mutation immediately after exact hydration acknowledgement', async () => {
    const snapshot = profileSnapshot()
    const readyBoard = { ...BOARD, updatedAt: '2026-07-19T00:00:30.000Z' }
    const commitGuiProjection = vi.fn(async () => ({
      ok: true as const,
      value: { generation: 1, revision: 8, durable: true as const, dirty: false as const },
    }))
    const bridge = bridgeWith(snapshot, {
      commitGuiProjection,
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: 1, revision: 8 },
      })),
    })
    const selection = selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge })
    let persistence!: ReturnType<typeof connectStateSink>
    let readyGeneration: number | undefined
    persistence = connectStateSink(selection, stateSink({
      admitHydration: vi.fn(() => {
        readyGeneration = persistence.schedule({
          activeIdeaId: snapshot.activeIdeaId,
          ideas: snapshot.ideas,
          board: readyBoard,
          userModTemplates: [USER_MOD],
          newModOrigins: {},
        })
        return undefined
      }),
    }))

    await expect(persistence.hydrate()).resolves.toMatchObject({ board: BOARD })
    expect(readyGeneration).toBe(1)
    await expect(persistence.flush()).resolves.toEqual({
      generation: 1,
      nativeGeneration: 1,
      revision: 8,
    })
    expect(commitGuiProjection).toHaveBeenCalledOnce()
    expect(commitGuiProjection).toHaveBeenCalledWith(expect.objectContaining({
      boardReplacements: { [snapshot.activeIdeaId]: readyBoard },
    }))
  })

  it('never acknowledges hydration when renderer state application fails', async () => {
    const bridge = bridgeWith(profileSnapshot())
    const terminal = vi.fn()
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({
        applyHydration: vi.fn(() => {
          throw new Error('synthetic store rejection')
        }),
        applyTerminalFailure: terminal,
      }),
    )

    await expect(persistence.hydrate()).rejects.toThrow('Profile renderer hydration application failed')
    expect(bridge.ackHydration).not.toHaveBeenCalled()
    expect(terminal).toHaveBeenCalledOnce()
  })

  it('rejects asynchronous renderer application without acknowledging the host epoch', async () => {
    const bridge = bridgeWith(profileSnapshot())
    const terminal = vi.fn()
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({
        applyHydration: vi.fn((() => Promise.resolve()) as unknown as (
          hydration: Parameters<ProfileRendererStateSink['applyHydration']>[0]
        ) => undefined),
        applyTerminalFailure: terminal,
      }),
    )

    await expect(persistence.hydrate()).rejects.toThrow('Profile renderer hydration application failed')
    expect(bridge.ackHydration).not.toHaveBeenCalled()
    expect(terminal).toHaveBeenCalledOnce()
  })

  it('fails terminally without ACK when native Mod provenance is incomplete', async () => {
    const snapshot = profileSnapshot()
    const orphanedMod = createSeedMod('count', {
      title: 'MISSING ORIGIN',
      createId: (role, ordinal) => `missing-origin-${role}-${ordinal}`,
    })
    snapshot.boards['idea-one'] = {
      ...BOARD,
      cards: [{
        id: 'card-without-native-origin',
        kind: 'mod',
        blocks: [{ id: 'block-without-native-origin', text: '' }],
        position: { x: 0, y: 0 },
        modV2: orphanedMod,
      }],
    }
    const bridge = bridgeWith(snapshot)
    const terminal = vi.fn()
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({ applyTerminalFailure: terminal }),
    )

    await expect(persistence.hydrate()).rejects.toThrow('Profile hydration snapshot was invalid')
    expect(bridge.ackHydration).not.toHaveBeenCalled()
    expect(terminal).toHaveBeenCalledOnce()
  })

  it('stays recovery-only after a corrupt hydrate and resumes only after restore hydration is acknowledged', async () => {
    const recovered: ProfileSnapshot = { ...profileSnapshot(), revision: 8 }
    let hydrateCount = 0
    const hydrationOrder: string[] = []
    const candidate = {
      id: 'recovery-one',
      recordVersion: PROFILE_CONTRACT_VERSIONS.record,
      revision: 6,
      verified: true,
      createdAt: '2026-07-19T00:00:00.000Z',
    }
    const bridge = bridgeWith(profileSnapshot(), {
      hydrate: vi.fn(async () => hydrateCount++ === 0
        ? profileServiceFailure('corrupt-or-recovery-required')
        : { ok: true as const, value: profileHydration(recovered, 'epoch-recovered') }),
      ackHydration: vi.fn(async (epoch, revision) => {
        hydrationOrder.push(`ack:${revision}`)
        return { ok: true as const, value: { acknowledged: true as const, epoch, revision } }
      }),
      inspectRecovery: vi.fn(async () => ({
        ok: true as const,
        value: {
          mode: 'inspect' as const,
          currentRevision: 7,
          selectedCandidateId: candidate.id,
          candidates: [candidate],
          rejectedCandidateIds: [],
          quarantinedCurrentState: false as const,
        },
      })),
      restoreRecovery: vi.fn(async () => ({
        ok: true as const,
        value: {
          mode: 'restore' as const,
          selectedCandidateId: candidate.id,
          rejectedCandidateIds: [],
          quarantinedCurrentState: false,
          previousRevision: 7,
          revision: 8,
        },
      })),
      commitGuiProjection: vi.fn(async () => ({
        ok: true as const,
        value: { generation: 1, revision: 9, durable: true as const, dirty: false as const },
      })),
    })
    const selection = selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge })
    let persistence!: ReturnType<typeof connectStateSink>
    let readyGeneration: number | undefined
    const readyBoard = { ...BOARD, updatedAt: '2026-07-19T00:10:00.000Z' }
    persistence = connectStateSink(selection, stateSink({
      applyHydration: vi.fn((hydration) => {
        hydrationOrder.push(`apply:${hydration.idea.id}:${recovered.revision}`)
        return undefined
      }),
      admitHydration: vi.fn(() => {
        hydrationOrder.push('admit:8')
        readyGeneration = persistence.schedule({
          activeIdeaId: recovered.activeIdeaId,
          ideas: recovered.ideas,
          board: readyBoard,
          userModTemplates: [USER_MOD],
          newModOrigins: {},
        })
        return undefined
      }),
    }))

    await expect(persistence.hydrate()).rejects.toMatchObject({
      failure: { code: 'corrupt-or-recovery-required' },
    })
    expect(() => persistence.schedule({
      activeIdeaId: 'idea-one',
      ideas: profileSnapshot().ideas,
      board: BOARD,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })).toThrow('Profile recovery is required')
    await expect(persistence.inspectRecovery()).resolves.toMatchObject({
      selectedCandidateId: candidate.id,
      candidates: [candidate],
    })
    await expect(persistence.restoreRecovery(candidate.id)).resolves.toMatchObject({
      receipt: { selectedCandidateId: candidate.id, revision: 8 },
      hydration: { idea: recovered.ideas[0], board: BOARD },
    })
    expect(bridge.ackHydration).toHaveBeenCalledWith('epoch-recovered', 8)
    expect(hydrationOrder).toEqual(['apply:idea-one:8', 'ack:8', 'admit:8'])
    expect(readyGeneration).toBe(1)
    await vi.waitFor(() => expect(bridge.commitGuiProjection).toHaveBeenCalledWith(
      expect.objectContaining({ boardReplacements: { 'idea-one': readyBoard } }),
    ))
  })

  it('starts fresh from recovery and resumes only after fresh hydration is acknowledged', async () => {
    const fresh: ProfileSnapshot = { ...profileSnapshot(), profileId: 'profile-fresh', revision: 0 }
    let hydrateCount = 0
    const hydrationOrder: string[] = []
    const bridge = bridgeWith(profileSnapshot(), {
      hydrate: vi.fn(async () => hydrateCount++ === 0
        ? profileServiceFailure('corrupt-or-recovery-required')
        : { ok: true as const, value: profileHydration(fresh, 'epoch-fresh') }),
      ackHydration: vi.fn(async (epoch, revision) => {
        hydrationOrder.push(`ack:${revision}`)
        return { ok: true as const, value: { acknowledged: true as const, epoch, revision } }
      }),
      startFresh: vi.fn(async () => ({
        ok: true as const,
        value: {
          mode: 'start-fresh' as const,
          operationId: 'start-fresh-operation',
          previousRevision: 7,
          profileId: 'profile-fresh',
          revision: 0,
          quarantinedCurrentState: true,
        },
      })),
    })
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({
        applyHydration: vi.fn((hydration) => {
          hydrationOrder.push(`apply:${hydration.idea.id}:${fresh.revision}`)
          return undefined
        }),
        admitHydration: vi.fn(() => {
          hydrationOrder.push('admit:0')
          return undefined
        }),
      }),
    )

    await expect(persistence.hydrate()).rejects.toMatchObject({
      failure: { code: 'corrupt-or-recovery-required' },
    })
    expect(() => persistence.schedule({
      activeIdeaId: 'idea-one',
      ideas: profileSnapshot().ideas,
      board: BOARD,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })).toThrow('Profile recovery is required')
    await expect(persistence.startFreshProfile()).resolves.toMatchObject({
      receipt: { mode: 'start-fresh', profileId: 'profile-fresh', revision: 0 },
      hydration: { idea: fresh.ideas[0] },
    })
    expect(bridge.ackHydration).toHaveBeenCalledWith('epoch-fresh', 0)
    expect(hydrationOrder).toEqual(['apply:idea-one:0', 'ack:0', 'admit:0'])
  })

  it('refuses start-fresh while recovery is not required', async () => {
    const startFresh = vi.fn(async () => {
      throw new Error('must not be called')
    })
    const bridge = bridgeWith(profileSnapshot(), { startFresh })
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
    )
    await persistence.hydrate()

    await expect(persistence.startFreshProfile()).rejects.toThrow(
      'Profile recovery is not required',
    )
    expect(startFresh).not.toHaveBeenCalled()
  })

  it('projects an unexpected recovery bridge rejection as sticky terminal state', async () => {
    const bridge = bridgeWith(profileSnapshot(), {
      hydrate: vi.fn(async () => profileServiceFailure('corrupt-or-recovery-required')),
      restoreRecovery: vi.fn(async () => {
        throw new Error('synthetic recovery route loss')
      }),
    })
    const terminal = vi.fn()
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({ applyTerminalFailure: terminal }),
    )

    await expect(persistence.hydrate()).rejects.toMatchObject({
      failure: { code: 'corrupt-or-recovery-required' },
    })
    await expect(persistence.restoreRecovery('candidate-route-loss')).rejects.toThrow(
      'Profile recovery restore route failed',
    )
    expect(terminal).toHaveBeenCalledOnce()
    await expect(persistence.inspectRecovery()).rejects.toThrow(
      'Profile recovery restore route failed',
    )
  })

  it('blocks all recovery IPC after renderer persistence enters a terminal state', async () => {
    const inspectRecovery = vi.fn(async () => {
      throw new Error('must not be called')
    })
    const restoreRecovery = vi.fn(async () => {
      throw new Error('must not be called')
    })
    const bridge = bridgeWith(profileSnapshot(), {
      commitGuiProjection: vi.fn(async () => {
        throw new Error('lost commit outcome')
      }),
      inspectRecovery,
      restoreRecovery,
    })
    const terminal = vi.fn()
    const selection = selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge })
    const persistence = connectStateSink(selection, stateSink({ applyTerminalFailure: terminal }))
    await persistence.hydrate()
    persistence.schedule({
      activeIdeaId: 'idea-one',
      ideas: profileSnapshot().ideas,
      board: { ...BOARD, updatedAt: '2026-07-19T00:20:00.000Z' },
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })
    await vi.waitFor(() => expect(terminal).toHaveBeenCalledOnce())
    await expect(persistence.flush()).rejects.toThrow('Profile projection outcome is uncertain')
    await expect(persistence.inspectRecovery()).rejects.toThrow(
      'Profile projection outcome is uncertain',
    )
    await expect(persistence.restoreRecovery('candidate')).rejects.toThrow(
      'Profile projection outcome is uncertain',
    )
    expect(inspectRecovery).not.toHaveBeenCalled()
    expect(restoreRecovery).not.toHaveBeenCalled()
  })

  it('confirms and flushes the latest renderer generation without privileged projection fields', async () => {
    let submitted: unknown
    const bridge = bridgeWith(profileSnapshot(), {
      commitGuiProjection: vi.fn(async (projection) => {
        submitted = projection
        return {
          ok: true as const,
          value: { generation: 41, revision: 8, durable: true as const, dirty: false as const },
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: 41, revision: 8 },
      })),
    })
    const selection = selectProfileRendererPersistence({
      eidoDesktop: true,
      eidoProfile: bridge,
    })
    const persistence = connectStateSink(selection)
    await persistence.hydrate()
    const changedBoard = { ...BOARD, updatedAt: '2026-07-19T00:01:00.000Z' }

    expect(persistence.schedule({
      activeIdeaId: 'idea-one',
      ideas: profileSnapshot().ideas,
      board: changedBoard,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })).toBe(1)

    await expect(persistence.flush()).resolves.toEqual({
      generation: 1,
      nativeGeneration: 41,
      revision: 8,
    })
    expect(submitted).toEqual({
      projectionVersion: 2,
      activeIdeaId: 'idea-one',
      ideas: profileSnapshot().ideas,
      boardReplacements: { 'idea-one': changedBoard },
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })
    expect(JSON.stringify(submitted)).not.toMatch(
      /profileId|profileSettings|locale|trustedActor|authorization|context|token|path/i,
    )
  })

  it('does not resend an unrelated receipted Board replacement in an ordinary later commit', async () => {
    const first = profileSnapshot()
    const secondIdea = {
      id: 'idea-two',
      name: 'Two',
      createdAt: '2026-07-19T00:02:00.000Z',
      updatedAt: '2026-07-19T00:02:00.000Z',
      lastOpenedAt: '2026-07-19T00:02:00.000Z',
    }
    const snapshot: ProfileSnapshot = {
      ...first,
      ideas: [...first.ideas, secondIdea],
      boards: { ...first.boards, [secondIdea.id]: BOARD },
    }
    const submissions: Parameters<InstalledProfileBridge['commitGuiProjection']>[0][] = []
    let nativeGeneration = 0
    let nativeRevision = snapshot.revision
    const bridge = bridgeWith(snapshot, {
      commitGuiProjection: vi.fn(async (candidate) => {
        submissions.push(candidate)
        nativeGeneration += 1
        nativeRevision += 1
        return {
          ok: true as const,
          value: {
            generation: nativeGeneration,
            revision: nativeRevision,
            durable: true as const,
            dirty: false as const,
          },
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: nativeRevision },
      })),
    })
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
    )
    await persistence.hydrate()
    const firstBoard = { ...BOARD, updatedAt: '2026-07-19T00:03:00.000Z' }
    persistence.schedule({
      activeIdeaId: first.activeIdeaId,
      ideas: snapshot.ideas,
      board: firstBoard,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })
    await persistence.flush()
    const secondBoard = { ...BOARD, updatedAt: '2026-07-19T00:04:00.000Z' }
    persistence.schedule({
      activeIdeaId: secondIdea.id,
      ideas: snapshot.ideas,
      board: secondBoard,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })
    await persistence.flush()

    expect(submissions).toHaveLength(2)
    expect(submissions[0]!.boardReplacements).toEqual({ [first.activeIdeaId]: firstBoard })
    expect(submissions[1]!.boardReplacements).toEqual({ [secondIdea.id]: secondBoard })
  })

  it('rehydrates native Mod template revisions after create, update, and delete commits', async () => {
    const initial = profileSnapshot()
    const newTemplate = {
      templateId: 'mod-new-template',
      mod: createSeedMod('dial', {
        title: 'NEW TEMPLATE',
        createId: (role, ordinal) => `new-${role}-${ordinal}`,
      }),
    }
    let currentSnapshot = initial
    let nativeGeneration = 0
    let commitCount = 0
    let newTemplateVersion = 0
    let scheduleReleaseGap: (() => void) | undefined
    let releaseGapScheduled = false
    const templateSubmissions: unknown[] = []
    let resolveTemplateGate!: (value: {
      ok: true
      value: { cancelled: true }
    }) => void
    const nativeTemplate = (
      template: GuiUserModTemplate,
      templateVersion: number,
    ): ProfileSnapshot['modTemplates'][number] => ({
      kind: 'mod-template',
      recordId: template.templateId,
      ownerId: initial.profileId,
      parentId: initial.profileId,
      recordVersion: 2,
      payload: {
        templateVersion,
        provenance: { kind: 'user' },
        createdAt: '2026-07-19T00:00:00.000Z',
        updatedAt: '2026-07-19T00:00:00.000Z',
        mod: template.mod,
      },
    })
    const bridge = bridgeWith(initial, {
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: profileHydration(currentSnapshot),
      })),
      ackHydration: vi.fn(async (epoch, revision) => {
        nativeGeneration = 0
        if (revision === 9 && !releaseGapScheduled) {
          releaseGapScheduled = true
          queueMicrotask(() => scheduleReleaseGap?.())
        }
        return { ok: true as const, value: { acknowledged: true as const, epoch, revision } }
      }),
      commitGuiProjection: vi.fn(async (projection) => {
        templateSubmissions.push(projection)
        commitCount += 1
        nativeGeneration += 1
        const userTemplates = projection.userModTemplates as readonly GuiUserModTemplate[]
        const nextNativeTemplate = userTemplates.find(
          (template) => template.templateId === newTemplate.templateId,
        )
        const previousNativeRecord = currentSnapshot.modTemplates.find((template) => (
          template.recordId === newTemplate.templateId
        ))
        const previousNativeTemplate = previousNativeRecord
          ? { templateId: previousNativeRecord.recordId, mod: previousNativeRecord.payload.mod }
          : undefined
        if (nextNativeTemplate
          && JSON.stringify(nextNativeTemplate) !== JSON.stringify(previousNativeTemplate)) {
          newTemplateVersion += 1
        }
        currentSnapshot = {
          ...currentSnapshot,
          revision: 7 + commitCount,
          modTemplates: [
            initial.modTemplates[0]!,
            ...userTemplates.map((template) => nativeTemplate(
              template,
              template.templateId === newTemplate.templateId ? newTemplateVersion : 3,
            )),
          ],
        }
        return {
          ok: true as const,
          value: {
            generation: nativeGeneration,
            revision: currentSnapshot.revision,
            durable: true as const,
            dirty: false as const,
          },
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: currentSnapshot.revision },
      })),
      exportPortable: vi.fn(async () => new Promise<Parameters<typeof resolveTemplateGate>[0]>(
        (resolve) => { resolveTemplateGate = resolve },
      )),
    })
    const selection = selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge })
    const persistence = connectStateSink(selection)
    scheduleReleaseGap = () => {
      persistence.schedule({
        activeIdeaId: initial.activeIdeaId,
        ideas: initial.ideas,
        board: { ...BOARD, updatedAt: '2026-07-19T00:40:00.000Z' },
        userModTemplates: [USER_MOD, {
          ...newTemplate,
          mod: { ...newTemplate.mod, title: 'UPDATED TEMPLATE' },
        }],
        newModOrigins: {},
      })
    }
    await persistence.hydrate()
    const scheduleTemplates = async (userModTemplates: readonly GuiUserModTemplate[]) => {
      persistence.schedule({
        activeIdeaId: initial.activeIdeaId,
        ideas: initial.ideas,
        board: BOARD,
        userModTemplates,
        newModOrigins: {},
      })
      await persistence.flush()
    }

    await scheduleTemplates([USER_MOD, newTemplate])
    expect(persistence.stampModTemplate(newTemplate.templateId).origin).toMatchObject({
      sourceTemplateId: newTemplate.templateId,
      sourceTemplateVersion: 1,
    })

    const updatedTemplate = {
      ...newTemplate,
      mod: { ...newTemplate.mod, title: 'UPDATED TEMPLATE' },
    }
    const gatedUpdate = persistence.exportPortable({ operationId: 'template-refresh-gate' })
    await vi.waitFor(() => expect(bridge.exportPortable).toHaveBeenCalledTimes(1))
    persistence.schedule({
      activeIdeaId: initial.activeIdeaId,
      ideas: initial.ideas,
      board: BOARD,
      userModTemplates: [USER_MOD, updatedTemplate],
      newModOrigins: {},
    })
    expect(() => persistence.stampModTemplate(newTemplate.templateId)).toThrow(
      'Profile Mod template revisions are refreshing',
    )
    resolveTemplateGate({ ok: true, value: { cancelled: true } })
    await expect(gatedUpdate).resolves.toEqual({ cancelled: true })
    expect(templateSubmissions).toHaveLength(3)
    expect(templateSubmissions[2]).toMatchObject({
      boardReplacements: {
        'idea-one': { updatedAt: '2026-07-19T00:40:00.000Z' },
      },
    })
    expect(persistence.stampModTemplate(newTemplate.templateId).origin).toMatchObject({
      sourceTemplateId: newTemplate.templateId,
      sourceTemplateVersion: 2,
    })

    await scheduleTemplates([USER_MOD])
    expect(() => persistence.stampModTemplate(newTemplate.templateId)).toThrow(
      'Profile Mod template revision is unavailable',
    )
    expect(bridge.hydrate).toHaveBeenCalledTimes(4)
  })

  it('rebinds lifecycle retries after definitive conflict and dialog cancellation', async () => {
    let nativeGeneration = 0
    let nativeRevision = 7
    const exportRequests: Array<{ expectedRevision: number }> = []
    const importRequests: Array<{ expectedRevision: number }> = []
    const bridge = bridgeWith(profileSnapshot(), {
      commitGuiProjection: vi.fn(async () => {
        nativeGeneration += 1
        nativeRevision += 1
        return {
          ok: true as const,
          value: {
            generation: nativeGeneration,
            revision: nativeRevision,
            durable: true as const,
            dirty: false as const,
          },
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: nativeRevision },
      })),
      exportPortable: vi.fn(async (request) => {
        exportRequests.push(request)
        return { ok: true as const, value: { cancelled: true as const } }
      }),
      importIdeaClosure: vi.fn(async (request) => {
        importRequests.push(request)
        return importRequests.length === 1
          ? profileServiceFailure('conflict', { currentRevision: nativeRevision })
          : { ok: true as const, value: { cancelled: true as const } }
      }),
    })
    const selection = selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge })
    const persistence = connectStateSink(selection)
    await persistence.hydrate()
    const changeBoard = async (minute: number) => {
      persistence.schedule({
        activeIdeaId: 'idea-one',
        ideas: profileSnapshot().ideas,
        board: { ...BOARD, updatedAt: `2026-07-19T00:${minute}:00.000Z` },
        userModTemplates: [USER_MOD],
        newModOrigins: {},
      })
      await persistence.flush()
    }

    await expect(persistence.exportPortable({ operationId: 'export-retry' })).resolves.toEqual({
      cancelled: true,
    })
    await changeBoard(1)
    await expect(persistence.exportPortable({ operationId: 'export-retry' })).resolves.toEqual({
      cancelled: true,
    })
    expect(exportRequests.map((request) => request.expectedRevision)).toEqual([7, 8])

    const importRequest = {
      operationId: 'import-retry',
      idempotencyKey: 'import-retry-key',
      name: 'Imported Idea',
    }
    await expect(persistence.importIdeaClosure(importRequest)).rejects.toMatchObject({
      failure: { code: 'conflict' },
    })
    await changeBoard(2)
    await expect(persistence.importIdeaClosure(importRequest)).resolves.toEqual({ cancelled: true })
    expect(importRequests.map((request) => request.expectedRevision)).toEqual([8, 9])
  })

  it('retains the exact lifecycle request after an outcome-uncertain internal failure', async () => {
    let nativeGeneration = 0
    let nativeRevision = 7
    const requests: unknown[] = []
    const bridge = bridgeWith(profileSnapshot(), {
      commitGuiProjection: vi.fn(async () => {
        nativeGeneration += 1
        nativeRevision += 1
        return {
          ok: true as const,
          value: {
            generation: nativeGeneration,
            revision: nativeRevision,
            durable: true as const,
            dirty: false as const,
          },
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: nativeRevision },
      })),
      importIdeaClosure: vi.fn(async (request) => {
        requests.push(request)
        return requests.length === 1
          ? profileServiceFailure('internal')
          : { ok: true as const, value: { cancelled: true as const } }
      }),
    })
    const selection = selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge })
    const persistence = connectStateSink(selection)
    await persistence.hydrate()
    const request = {
      operationId: 'uncertain-import',
      idempotencyKey: 'uncertain-import-key',
      name: 'Uncertain import',
    }

    await expect(persistence.importIdeaClosure(request)).rejects.toMatchObject({
      failure: { code: 'internal' },
    })
    persistence.schedule({
      activeIdeaId: 'idea-one',
      ideas: profileSnapshot().ideas,
      board: { ...BOARD, updatedAt: '2026-07-19T00:30:00.000Z' },
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })
    await persistence.flush()
    await expect(persistence.importIdeaClosure(request)).resolves.toEqual({ cancelled: true })

    expect(requests).toHaveLength(2)
    expect(requests[1]).toEqual(requests[0])
    expect(requests[0]).toMatchObject({
      operationId: request.operationId,
      idempotencyKey: request.idempotencyKey,
      expectedRevision: 7,
    })
  })

  it('bounds high-frequency saves to one active and one latest renderer projection', async () => {
    const submitted: unknown[] = []
    let resolveFirst!: (value: {
      ok: true
      value: { generation: number; revision: number; durable: true; dirty: false }
    }) => void
    const bridge = bridgeWith(profileSnapshot(), {
      commitGuiProjection: vi.fn(async (projection) => {
        submitted.push(projection)
        if (submitted.length === 1) {
          return new Promise<{
            ok: true
            value: { generation: number; revision: number; durable: true; dirty: false }
          }>((resolve) => {
            resolveFirst = resolve
          })
        }
        return {
          ok: true as const,
          value: { generation: 51, revision: 8, durable: true as const, dirty: false as const },
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: 51, revision: 8 },
      })),
    })
    const selection = selectProfileRendererPersistence({
      eidoDesktop: true,
      eidoProfile: bridge,
    })
    const persistence = connectStateSink(selection)
    await persistence.hydrate()
    const state = (ordinal: number) => ({
      activeIdeaId: 'idea-one',
      ideas: profileSnapshot().ideas,
      board: {
        ...BOARD,
        updatedAt: `2026-07-19T00:00:${String(ordinal).padStart(2, '0')}.000Z`,
      },
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })

    for (let ordinal = 1; ordinal <= 50; ordinal += 1) {
      persistence.schedule(state(ordinal))
    }
    expect(submitted).toHaveLength(1)

    const flushed = persistence.flush()
    resolveFirst({
      ok: true,
      value: { generation: 51, revision: 8, durable: true, dirty: false },
    })
    await expect(flushed).resolves.toEqual({ generation: 50, nativeGeneration: 51, revision: 8 })
    expect(submitted).toHaveLength(2)
    expect((submitted[1] as { boardReplacements: Record<string, SavedBoard> })
      .boardReplacements['idea-one']?.updatedAt).toBe('2026-07-19T00:00:50.000Z')
  })

  it('gates successors behind an unresolved new Mod origin and then strips the consumed origin', async () => {
    const submitted: Array<Record<string, unknown>> = []
    let resolveOriginCommit!: (value: {
      ok: true
      value: { generation: number; revision: number; durable: true; dirty: false }
    }) => void
    const bridge = bridgeWith(profileSnapshot(), {
      commitGuiProjection: vi.fn(async (projection) => {
        submitted.push(projection as unknown as Record<string, unknown>)
        if (submitted.length === 1) {
          return new Promise<{
            ok: true
            value: { generation: number; revision: number; durable: true; dirty: false }
          }>((resolve) => {
            resolveOriginCommit = resolve
          })
        }
        return {
          ok: true as const,
          value: {
            generation: 40 + submitted.length,
            revision: 7 + submitted.length,
            durable: true as const,
            dirty: false as const,
          },
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: {
          generation: 40 + submitted.length,
          revision: 7 + submitted.length,
        },
      })),
    })
    const selection = selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge })
    const persistence = connectStateSink(selection)
    await persistence.hydrate()
    const directCardId = 'card-new-direct-mod'
    const directInstanceId = 'instance-new-direct-mod'
    const directOrigin = {
      kind: 'direct',
      instanceId: directInstanceId,
    } as const satisfies GuiNewModOrigin
    const directModCard: SavedBoard['cards'][number] = {
      id: directCardId,
      kind: 'mod',
      position: { x: 100, y: 200 },
      blocks: [{ id: 'block-new-direct-mod', kind: 'line', text: 'New direct Mod' }],
      modV2: createSeedMod('count', {
        title: 'NEW DIRECT MOD',
        createId: (role, ordinal) => `new-direct-${role}-${ordinal}`,
      }),
    }
    const state = (minute: number): Parameters<typeof persistence.schedule>[0] => ({
      activeIdeaId: 'idea-one',
      ideas: profileSnapshot().ideas,
      board: {
        ...BOARD,
        cards: [directModCard],
        updatedAt: `2026-07-19T00:0${minute}:00.000Z`,
      },
      userModTemplates: [USER_MOD],
      newModOrigins: (minute === 1
        ? { [directCardId]: directOrigin }
        : {}),
    })

    expect(persistence.schedule(state(1))).toBe(1)
    expect(persistence.schedule(state(2))).toBe(2)
    expect(persistence.schedule(state(3))).toBe(3)
    expect(submitted).toHaveLength(1)
    expect(submitted[0]?.newModOrigins).toEqual({ [directCardId]: directOrigin })

    const flushed = persistence.flush()
    resolveOriginCommit({
      ok: true as const,
      value: { generation: 41, revision: 8, durable: true, dirty: false },
    })
    await expect(flushed).resolves.toEqual({ generation: 3, nativeGeneration: 42, revision: 9 })
    expect(submitted).toHaveLength(2)
    expect(submitted.map((candidate) => candidate.newModOrigins)).toEqual([
      { [directCardId]: directOrigin },
      {},
    ])
    expect((submitted[1]?.boardReplacements as Record<string, SavedBoard>)['idea-one']?.updatedAt)
      .toBe('2026-07-19T00:03:00.000Z')

    expect(persistence.schedule(state(4))).toBe(4)
    expect(submitted).toHaveLength(3)
    expect(submitted[2]?.newModOrigins).toEqual({})
    expect((submitted[2]?.boardReplacements as Record<string, SavedBoard>)['idea-one']?.updatedAt)
      .toBe('2026-07-19T00:04:00.000Z')
    await expect(persistence.flush()).resolves.toEqual({
      generation: 4,
      nativeGeneration: 43,
      revision: 10,
    })
    await expect(persistence.renameCurrentIdea('Renamed after receipt')).resolves.toMatchObject({
      idea: { name: 'Renamed after receipt' },
      modOrigins: { [directCardId]: directOrigin },
    })
  })

  it('synchronously schedules a close checkpoint and acknowledges its exact flush token', async () => {
    const target = new EventTarget()
    const schedule = vi.fn(() => 6)
    let resolveFlush!: (value: { generation: number; nativeGeneration: number; revision: number }) => void
    const flush = vi.fn(async () => new Promise<{
      generation: number
      nativeGeneration: number
      revision: number
    }>((resolve) => {
      resolveFlush = resolve
    }))
    const acknowledgements: ProfileRendererCheckpointAck[] = []
    target.addEventListener(PROFILE_RENDERER_CHECKPOINT_ACK_EVENT, (event) => {
      acknowledgements.push((event as CustomEvent<ProfileRendererCheckpointAck>).detail)
    })
    const unregister = registerProfileRendererCheckpointHandler(
      target,
      { schedule, flush },
      () => ({
        activeIdeaId: 'idea-one',
        ideas: profileSnapshot().ideas,
        board: BOARD,
        userModTemplates: [USER_MOD],
        newModOrigins: {},
      }),
    )

    target.dispatchEvent(new CustomEvent(PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT, {
      detail: { token: 'close-token-one' },
    }))
    expect(schedule).toHaveBeenCalledTimes(1)
    expect(flush).toHaveBeenCalledTimes(1)
    expect(acknowledgements).toEqual([])

    resolveFlush({ generation: 6, nativeGeneration: 22, revision: 13 })
    await vi.waitFor(() => expect(acknowledgements).toEqual([{
      token: 'close-token-one',
      ok: true,
      generation: 6,
      nativeGeneration: 22,
      revision: 13,
    }]))

    unregister()
    target.dispatchEvent(new CustomEvent(PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT, {
      detail: { token: 'close-token-two' },
    }))
    expect(schedule).toHaveBeenCalledTimes(1)
  })

  it('does not schedule or acknowledge a close checkpoint until delegated runs drain', async () => {
    const target = new EventTarget()
    const drained = deferred<void>()
    const prepareForCheckpoint = vi.fn(() => drained.promise)
    const schedule = vi.fn(() => 7)
    const flush = vi.fn(async () => ({
      generation: 7,
      nativeGeneration: 23,
      revision: 14,
    }))
    const acknowledgements: ProfileRendererCheckpointAck[] = []
    target.addEventListener(PROFILE_RENDERER_CHECKPOINT_ACK_EVENT, (event) => {
      acknowledgements.push((event as CustomEvent<ProfileRendererCheckpointAck>).detail)
    })
    registerProfileRendererCheckpointHandler(
      target,
      { schedule, flush },
      () => ({
        activeIdeaId: 'idea-one',
        ideas: profileSnapshot().ideas,
        board: BOARD,
        userModTemplates: [USER_MOD],
        newModOrigins: {},
      }),
      { prepareForCheckpoint },
    )

    target.dispatchEvent(new CustomEvent(PROFILE_RENDERER_CHECKPOINT_REQUEST_EVENT, {
      detail: { token: 'close-after-agent-runs' },
    }))
    expect(prepareForCheckpoint).toHaveBeenCalledOnce()
    expect(schedule).not.toHaveBeenCalled()
    expect(flush).not.toHaveBeenCalled()
    expect(acknowledgements).toEqual([])

    drained.resolve()
    await vi.waitFor(() => expect(acknowledgements).toEqual([{
      token: 'close-after-agent-runs',
      ok: true,
      generation: 7,
      nativeGeneration: 23,
      revision: 14,
    }]))
    expect(schedule).toHaveBeenCalledOnce()
    expect(flush).toHaveBeenCalledOnce()
  })

  it('keeps an authoritative lifecycle active-Idea switch when held renderer state is unchanged', async () => {
    const initial = profileSnapshot()
    const duplicateIdea = {
      id: 'idea-authoritative-duplicate',
      name: 'Authoritative duplicate',
      createdAt: '2026-07-19T00:50:00.000Z',
      updatedAt: '2026-07-19T00:50:00.000Z',
      lastOpenedAt: '2026-07-19T00:50:00.000Z',
    }
    const refreshed: ProfileSnapshot = {
      ...initial,
      revision: 8,
      activeIdeaId: duplicateIdea.id,
      ideas: [...initial.ideas, duplicateIdea],
      boards: { ...initial.boards, [duplicateIdea.id]: BOARD },
    }
    let resolveDuplicate!: (value: {
      ok: true
      value: {
        kind: 'duplicate-idea'
        operationId: string
        previousRevision: number
        revision: number
        targetIdeaId: string
        insertedRecordIds: readonly string[]
        importedAssetIds: readonly string[]
        replayed: boolean
      }
    }) => void
    let hydrateCount = 0
    let nativeGeneration = 0
    let nativeRevision = 7
    let resolveFirstCommit!: (value: {
      ok: true
      value: { generation: number; revision: number; durable: true; dirty: false }
    }) => void
    const submitted: unknown[] = []
    const bridge = bridgeWith(initial, {
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: profileHydration(hydrateCount++ === 0 ? initial : refreshed),
      })),
      duplicateIdea: vi.fn(async () => new Promise<Parameters<typeof resolveDuplicate>[0]>((resolve) => {
        resolveDuplicate = resolve
      })),
      commitGuiProjection: vi.fn(async (projection) => {
        submitted.push(projection)
        if (submitted.length === 1) {
          return new Promise<Parameters<typeof resolveFirstCommit>[0]>((resolve) => {
            resolveFirstCommit = resolve
          })
        }
        nativeGeneration = 2
        nativeRevision = 10
        return {
          ok: true as const,
          value: { generation: 2, revision: 10, durable: true as const, dirty: false as const },
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: nativeRevision },
      })),
    })
    const selection = selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge })
    const persistence = connectStateSink(selection)
    await persistence.hydrate()

    const duplicate = persistence.duplicateCurrentIdea()
    await vi.waitFor(() => expect(bridge.duplicateIdea).toHaveBeenCalledTimes(1))
    persistence.schedule({
      activeIdeaId: initial.activeIdeaId,
      ideas: initial.ideas,
      board: BOARD,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })
    nativeRevision = 8
    resolveDuplicate({
      ok: true,
      value: {
        kind: 'duplicate-idea',
        operationId: 'authoritative-duplicate-operation',
        previousRevision: 7,
        revision: 8,
        targetIdeaId: duplicateIdea.id,
        insertedRecordIds: [duplicateIdea.id],
        importedAssetIds: [],
        replayed: false,
      },
    })

    await vi.waitFor(() => expect(submitted).toHaveLength(1))
    expect(submitted[0]).toMatchObject({
      activeIdeaId: duplicateIdea.id,
      ideas: refreshed.ideas,
      boardReplacements: {},
    })
    const editedTargetBoard = { ...BOARD, updatedAt: '2026-07-19T00:51:00.000Z' }
    persistence.schedule({
      activeIdeaId: duplicateIdea.id,
      ideas: refreshed.ideas,
      board: editedTargetBoard,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })
    nativeGeneration = 1
    nativeRevision = 9
    resolveFirstCommit({
      ok: true,
      value: { generation: 1, revision: 9, durable: true, dirty: false },
    })

    await expect(duplicate).resolves.toMatchObject({
      hydration: { idea: duplicateIdea, board: editedTargetBoard, ideas: refreshed.ideas },
    })
    expect(submitted).toHaveLength(2)
    expect(submitted[1]).toMatchObject({
      activeIdeaId: duplicateIdea.id,
      ideas: refreshed.ideas,
      boardReplacements: { [duplicateIdea.id]: editedTargetBoard },
    })
  })

  it('rebases an ACK-gap target edit from the complete applied lifecycle candidate exactly once', async () => {
    const initial = profileSnapshot()
    const targetIdea = {
      id: 'idea-ack-gap-target',
      name: 'Copy of One',
      createdAt: '2026-07-19T00:52:00.000Z',
      updatedAt: '2026-07-19T00:52:00.000Z',
      lastOpenedAt: '2026-07-19T00:52:00.000Z',
    }
    const refreshed: ProfileSnapshot = {
      ...initial,
      revision: 8,
      activeIdeaId: targetIdea.id,
      ideas: [...initial.ideas, targetIdea],
      boards: { ...initial.boards, [targetIdea.id]: BOARD },
    }
    const sourceCardId = 'card-held-on-source'
    const sourceInstanceId = 'instance-held-on-source'
    const sourceOrigin = {
      kind: 'direct',
      instanceId: sourceInstanceId,
    } as const satisfies GuiNewModOrigin
    const sourceBoard: SavedBoard = {
      ...BOARD,
      updatedAt: '2026-07-19T00:52:30.000Z',
      cards: [{
        id: sourceCardId,
        kind: 'mod',
        position: { x: 100, y: 200 },
        blocks: [{ id: 'block-held-on-source', kind: 'line', text: 'Held source Mod' }],
        modV2: createSeedMod('switch', {
          title: 'HELD SOURCE MOD',
          createId: (role, ordinal) => `held-source-${role}-${ordinal}`,
        }),
      }],
    }
    const targetBoard: SavedBoard = {
      ...BOARD,
      updatedAt: '2026-07-19T00:53:00.000Z',
    }
    let resolveDuplicate!: (value: {
      ok: true
      value: {
        kind: 'duplicate-idea'
        operationId: string
        previousRevision: number
        revision: number
        targetIdeaId: string
        insertedRecordIds: readonly string[]
        importedAssetIds: readonly string[]
        replayed: boolean
      }
    }) => void
    let resolveRefreshAck!: (value: {
      ok: true
      value: { acknowledged: true; epoch: string; revision: number }
    }) => void
    let hydrateCount = 0
    let nativeGeneration = 0
    let nativeRevision = 7
    const submissions: Parameters<InstalledProfileBridge['commitGuiProjection']>[0][] = []
    const appliedHydrations: ProfileRendererHydration[] = []
    const bridge = bridgeWith(initial, {
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: profileHydration(hydrateCount++ === 0 ? initial : refreshed),
      })),
      ackHydration: vi.fn(async (epoch, revision) => {
        if (revision === initial.revision) {
          return { ok: true as const, value: { acknowledged: true as const, epoch, revision } }
        }
        return new Promise<{
          ok: true
          value: { acknowledged: true; epoch: string; revision: number }
        }>((resolve) => { resolveRefreshAck = resolve })
      }),
      duplicateIdea: vi.fn(async () => new Promise<Parameters<typeof resolveDuplicate>[0]>((resolve) => {
        resolveDuplicate = resolve
      })),
      commitGuiProjection: vi.fn(async (candidate) => {
        submissions.push(candidate)
        nativeGeneration = 1
        nativeRevision = 9
        return {
          ok: true as const,
          value: { generation: 1, revision: 9, durable: true as const, dirty: false as const },
        }
      }),
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: nativeRevision },
      })),
    })
    const persistence = connectStateSink(
      selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge }),
      stateSink({
        applyHydration: vi.fn((hydration) => {
          appliedHydrations.push(hydration)
          return undefined
        }),
      }),
    )
    await persistence.hydrate()

    const duplicate = persistence.duplicateCurrentIdea()
    await vi.waitFor(() => expect(bridge.duplicateIdea).toHaveBeenCalledOnce())
    expect(persistence.schedule({
      activeIdeaId: initial.activeIdeaId,
      ideas: initial.ideas,
      board: sourceBoard,
      userModTemplates: [USER_MOD],
      newModOrigins: { [sourceCardId]: sourceOrigin },
    })).toBe(1)
    nativeRevision = 8
    resolveDuplicate({
      ok: true,
      value: {
        kind: 'duplicate-idea',
        operationId: 'operation-ack-gap-duplicate',
        previousRevision: 7,
        revision: 8,
        targetIdeaId: targetIdea.id,
        insertedRecordIds: [targetIdea.id],
        importedAssetIds: [],
        replayed: false,
      },
    })

    await vi.waitFor(() => expect(bridge.ackHydration).toHaveBeenCalledWith('epoch-8', 8))
    expect(appliedHydrations[appliedHydrations.length - 1]).toMatchObject({
      idea: targetIdea,
      board: BOARD,
      modOrigins: { [sourceCardId]: sourceOrigin },
    })
    expect(persistence.schedule({
      activeIdeaId: targetIdea.id,
      ideas: refreshed.ideas,
      board: targetBoard,
      userModTemplates: [USER_MOD],
      newModOrigins: {},
    })).toBe(2)
    expect(submissions).toEqual([])
    resolveRefreshAck({
      ok: true,
      value: { acknowledged: true, epoch: 'epoch-8', revision: 8 },
    })

    await expect(duplicate).resolves.toMatchObject({
      hydration: { idea: targetIdea, board: targetBoard, ideas: refreshed.ideas },
    })
    expect(submissions).toHaveLength(1)
    expect(submissions[0]).toEqual(expect.objectContaining({
      activeIdeaId: targetIdea.id,
      ideas: refreshed.ideas,
      boardReplacements: {
        [initial.activeIdeaId]: sourceBoard,
        [targetIdea.id]: targetBoard,
      },
      newModOrigins: { [sourceCardId]: sourceOrigin },
    }))
    expect(Object.keys(submissions[0]!.newModOrigins)).toEqual([sourceCardId])
  })

  it('coalesces renderer schedules during Idea duplication and safely rebases the latest after rehydration', async () => {
    const base = profileSnapshot()
    const selectedIdea = {
      id: 'idea-two',
      name: 'Two',
      createdAt: '2026-07-19T00:04:00.000Z',
      updatedAt: '2026-07-19T00:04:00.000Z',
      lastOpenedAt: '2026-07-19T00:04:00.000Z',
    }
    const initial: ProfileSnapshot = {
      ...base,
      ideas: [...base.ideas, selectedIdea],
      boards: { ...base.boards, [selectedIdea.id]: BOARD },
    }
    const duplicateIdea = {
      id: 'idea-duplicate',
      name: 'Copy of One',
      createdAt: '2026-07-19T00:05:00.000Z',
      updatedAt: '2026-07-19T00:05:00.000Z',
      lastOpenedAt: '2026-07-19T00:05:00.000Z',
    }
    const refreshed: ProfileSnapshot = {
      ...initial,
      revision: 8,
      activeIdeaId: initial.activeIdeaId,
      ideas: [...initial.ideas, duplicateIdea],
      boards: { ...initial.boards, [duplicateIdea.id]: BOARD },
      modTemplates: initial.modTemplates.filter((template) => (
        template.payload.provenance.kind === 'built-in'
      )),
    }
    let resolveDuplicate!: (value: {
      ok: true
      value: {
        kind: 'duplicate-idea'
        operationId: string
        previousRevision: number
        revision: number
        targetIdeaId: string
        insertedRecordIds: readonly string[]
        importedAssetIds: readonly string[]
        replayed: boolean
      }
    }) => void
    let resolveRefreshAck!: (value: {
      ok: true
      value: { acknowledged: true; epoch: string; revision: number }
    }) => void
    let hydrateCount = 0
    let nativeRevision = 7
    let nativeGeneration = 0
    let resolveFirstCommit!: (value: {
      ok: true
      value: { generation: number; revision: number; durable: true; dirty: false }
    }) => void
    const submitted: unknown[] = []
    const appliedHydrations: ProfileRendererHydration[] = []
    const commitGuiProjection = vi.fn(async (projection) => {
      submitted.push(projection)
      if (submitted.length === 1) {
        return new Promise<Parameters<typeof resolveFirstCommit>[0]>((resolve) => {
          resolveFirstCommit = resolve
        })
      }
      nativeGeneration = 2
      nativeRevision = 10
      return {
        ok: true as const,
        value: { generation: 2, revision: 10, durable: true as const, dirty: false as const },
      }
    })
    const bridge = bridgeWith(initial, {
      hydrate: vi.fn(async () => ({
        ok: true as const,
        value: profileHydration(hydrateCount++ === 0 ? initial : refreshed),
      })),
      ackHydration: vi.fn(async (epoch, revision) => {
        if (revision === 7) {
          return { ok: true as const, value: { acknowledged: true as const, epoch, revision } }
        }
        expect(appliedHydrations[appliedHydrations.length - 1]).toMatchObject({
          idea: selectedIdea,
          board: { updatedAt: '2026-07-19T00:02:00.000Z' },
          userModTemplates: [],
          modOrigins: {
            'card-origin-a': { kind: 'direct', instanceId: 'instance-origin-a' },
          },
        })
        return new Promise<{
          ok: true
          value: { acknowledged: true; epoch: string; revision: number }
        }>((resolve) => {
          resolveRefreshAck = resolve
        })
      }),
      commitGuiProjection,
      flush: vi.fn(async () => ({
        ok: true as const,
        value: { generation: nativeGeneration, revision: nativeRevision },
      })),
      duplicateIdea: vi.fn(async () => new Promise<Parameters<typeof resolveDuplicate>[0]>((resolve) => {
        resolveDuplicate = resolve
      })),
    })
    const selection = selectProfileRendererPersistence({ eidoDesktop: true, eidoProfile: bridge })
    const persistence = connectStateSink(selection, stateSink({
      applyHydration: vi.fn((hydration) => {
        appliedHydrations.push(hydration)
        return undefined
      }),
    }))
    await persistence.hydrate()

    const duplicate = persistence.duplicateCurrentIdea()
    await vi.waitFor(() => expect(bridge.duplicateIdea).toHaveBeenCalledTimes(1))
    const originCard = (suffix: string): SavedBoard['cards'][number] => ({
      id: `card-${suffix}`,
      kind: 'mod',
      position: { x: 100, y: 200 },
      blocks: [{ id: `block-${suffix}`, kind: 'line', text: suffix }],
      modV2: createSeedMod('count', {
        title: suffix.toUpperCase(),
        createId: (role, ordinal) => `${suffix}-${role}-${ordinal}`,
      }),
    })
    const staleState = (
      minute: number,
      cards: SavedBoard['cards'],
      newModOrigins: Record<string, GuiNewModOrigin>,
    ): Parameters<typeof persistence.schedule>[0] => ({
      activeIdeaId: selectedIdea.id,
      ideas: initial.ideas,
      board: { ...BOARD, cards, updatedAt: `2026-07-19T00:0${minute}:00.000Z` },
      userModTemplates: [USER_MOD],
      newModOrigins,
    })
    const cardA = originCard('origin-a')
    const cardB = originCard('origin-b')
    const originA = {
      kind: 'direct',
      instanceId: 'instance-origin-a',
    } as const satisfies GuiNewModOrigin
    const originB = {
      kind: 'direct',
      instanceId: 'instance-origin-b',
    } as const satisfies GuiNewModOrigin
    expect(persistence.schedule(staleState(1, [cardA], {
      [cardA.id]: originA,
    }))).toBe(1)
    expect(persistence.schedule(staleState(2, [cardA], {}))).toBe(2)
    expect(commitGuiProjection).not.toHaveBeenCalled()

    const concurrentFlush = persistence.flush()
    let concurrentFlushSettled = false
    void concurrentFlush.finally(() => { concurrentFlushSettled = true })
    await Promise.resolve()
    expect(concurrentFlushSettled).toBe(false)

    nativeRevision = 8
    resolveDuplicate({
      ok: true,
      value: {
        kind: 'duplicate-idea',
        operationId: 'operation-duplicate',
        previousRevision: 7,
        revision: 8,
        targetIdeaId: duplicateIdea.id,
        insertedRecordIds: [duplicateIdea.id],
        importedAssetIds: [],
        replayed: false,
      },
    })

    await vi.waitFor(() => expect(bridge.ackHydration).toHaveBeenCalledWith('epoch-8', 8))
    expect(commitGuiProjection).not.toHaveBeenCalled()
    resolveRefreshAck({
      ok: true,
      value: { acknowledged: true, epoch: 'epoch-8', revision: 8 },
    })

    await vi.waitFor(() => expect(commitGuiProjection).toHaveBeenCalledTimes(1))
    expect((submitted[0] as { newModOrigins: unknown }).newModOrigins).toEqual({
      [cardA.id]: originA,
    })
    expect((submitted[0] as { userModTemplates: unknown }).userModTemplates).toEqual([])
    expect(persistence.schedule({
      ...staleState(3, [cardA, cardB], {
        [cardB.id]: originB,
      }),
      ideas: refreshed.ideas,
      userModTemplates: [],
    })).toBe(3)
    expect(commitGuiProjection).toHaveBeenCalledTimes(1)
    nativeGeneration = 1
    nativeRevision = 9
    resolveFirstCommit({
      ok: true,
      value: { generation: 1, revision: 9, durable: true, dirty: false },
    })

    await expect(duplicate).resolves.toMatchObject({
      hydration: {
        idea: selectedIdea,
        ideas: refreshed.ideas,
        board: { updatedAt: '2026-07-19T00:03:00.000Z' },
      },
    })
    await expect(concurrentFlush).resolves.toEqual({
      generation: 3,
      nativeGeneration: 2,
      revision: 10,
    })
    expect(commitGuiProjection).toHaveBeenCalledTimes(2)
    expect(submitted[1]).toMatchObject({
      activeIdeaId: selectedIdea.id,
      ideas: refreshed.ideas,
      boardReplacements: {
        [selectedIdea.id]: { updatedAt: '2026-07-19T00:03:00.000Z' },
      },
      newModOrigins: { [cardB.id]: originB },
      userModTemplates: [],
    })
  })
})

function deferred<Value>(): Readonly<{
  promise: Promise<Value>
  resolve(value: Value): void
}> {
  let resolve!: (value: Value) => void
  const promise = new Promise<Value>((next) => { resolve = next })
  return { promise, resolve }
}

function movedIntentEvent(id: string, actorId: string, at: string, seq: number): IntentLogEvent {
  return {
    id,
    at,
    actorId,
    seq,
    type: 'card.moved',
    cardId: 'card-base',
    data: {
      moves: [{
        cardId: 'card-base',
        from: { x: 0, y: 0 },
        to: { x: 1, y: 1 },
      }],
    },
  }
}

const LIVE_MERGE_VALIDATION_DEPENDENCIES: ProfileGuiProjectionDependencies = {
  projectAsset() {
    throw new Error('Live merge timestamp proof does not project assets')
  },
  materializeUserModTemplate() {
    throw new Error('Live merge timestamp proof does not materialize Mod templates')
  },
  materializeNewModInstance() {
    throw new Error('Live merge timestamp proof does not materialize Mod instances')
  },
}

function validateSubmittedGuiProjection(
  current: ProfileSnapshot,
  candidate: RendererProfileProjection,
) {
  return mergeGuiProfileProjection(current, {
    generation: 1,
    expectedRevision: current.revision,
    clientTxnId: `client-txn-live-merge-${current.revision}`,
    idempotencyKey: `idempotency-live-merge-${current.revision}`,
    committedAt: '2026-07-22T01:00:03.000Z',
    context: {
      trustedActorId: 'actor-trusted-owner',
      ordinaryNewIdeas: [],
    },
    projection: {
      ...candidate,
      profileId: current.profileId,
      profileSettings: current.profileSettings as unknown as GuiProfileProjection['profileSettings'],
    },
  }, LIVE_MERGE_VALIDATION_DEPENDENCIES)
}
