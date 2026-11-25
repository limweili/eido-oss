import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { remapModPartIdentities } from '../src/mods'
import type { GuiProfileProjectionRequest } from '../src/persistence/profileGuiProjection'
import { PROFILE_BUILT_IN_MOD_TEMPLATES } from '../src/persistence/profileBuiltInMods'
import {
  createProfileCapabilities,
  profileServiceFailure,
  type ProfileSnapshot,
  type ProfileStatus,
} from '../src/persistence/profileServiceContract'
import {
  INSTALLED_PROFILE_AGENT_COMMAND_NAMES,
} from '../src/persistence/profileAgentCommandInstallation'
import {
  createProductionProfileSeed,
  createProfileUtilityHost,
  readAuthoritativeLocaleSettings,
  type ProfileUtilityHostOptions,
} from './profileUtilityHost'
import {
  createProfileUtilityRequest,
  type ProfileUtilityRequestMessage,
  type ProfileUtilityResponseMessage,
} from './profileUtilityProtocol'
import type { SqliteProfileOwnerCoordinator } from './sqliteProfileOwnerCoordinator'

const disposableRoots: string[] = []
const hosts: ReturnType<typeof createProfileUtilityHost>[] = []
let cleanupSequence = 0

afterEach(async () => {
  await Promise.allSettled(hosts.splice(0).map((host) => {
    cleanupSequence += 1
    return host.handle(createProfileUtilityRequest(`cleanup-${cleanupSequence}`, 'close', {}))
  }))
  while (disposableRoots.length > 0) {
    const root = disposableRoots.pop()!
    if (existsSync(root)) rmSync(root, { recursive: true, force: true })
  }
})

describe('native Profile utility host', () => {
  it('throws when any request reaches the host before native initialization', async () => {
    const host = newHost()

    await expect(host.handle(createProfileUtilityRequest('pre-init-status', 'status', {})))
      .rejects.toThrow('before native initialization')
    await expect(host.handle(createProfileUtilityRequest('pre-init-close', 'close', {})))
      .rejects.toThrow('before native initialization')
  })

  it('returns not-found for an absent existing-only Profile without creating artifacts', async () => {
    const root = disposableRoot()
    const absentRoot = path.join(root, 'absent-installation')
    const createInitialProfile = vi.fn(createProductionProfileSeed)
    const host = newHost({ createInitialProfile })

    await expect(host.initialize({
      route: 'exclusive-headless-owner',
      databasePath: path.join(absentRoot, 'profiles', 'default', 'eido-profile.sqlite'),
      transport: 'cli',
      actor: { client: 'eido-test', sessionId: 'absent-headless-session' },
    })).resolves.toMatchObject({ kind: 'fatal', failure: { code: 'not-found' } })

    expect(createInitialProfile).not.toHaveBeenCalled()
    expect(existsSync(absentRoot)).toBe(false)
  })

  it('opens an existing Profile under the exclusive headless route without reseeding it', async () => {
    const root = disposableRoot()
    const databasePath = path.join(root, 'profiles', 'default', 'eido-profile.sqlite')
    const active = newHost()
    await expect(active.initialize({
      route: 'active-owner',
      databasePath,
      portableTempRoot: path.join(root, 'portable-operations'),
    })).resolves.toMatchObject({ kind: 'ready', route: 'active-owner', state: 'ready' })
    await request(active, createProfileUtilityRequest('close-active', 'close', {}))

    const createInitialProfile = vi.fn(createProductionProfileSeed)
    const headless = newHost({ createInitialProfile })
    await expect(headless.initialize({
      route: 'exclusive-headless-owner',
      databasePath,
      transport: 'cli',
      actor: { client: 'eido-test', sessionId: 'existing-headless-session' },
    })).resolves.toMatchObject({
      kind: 'ready',
      route: 'exclusive-headless-owner',
      state: 'ready',
      revision: 0,
    })
    expect((await request(
      headless,
      createProfileUtilityRequest('headless-hydrate-denied', 'hydrate', {}),
    )).result).toMatchObject({ ok: false, code: 'capability-denied' })
    const status = await request(
      headless,
      createProfileUtilityRequest('headless-status', 'status', {}),
    )
    expect(status.result).toMatchObject({
      ok: true,
      value: {
        revision: 0,
        owner: { route: 'exclusive-headless-owner' },
      },
    })
    expect(createInitialProfile).not.toHaveBeenCalled()
    expect(existsSync(path.join(root, 'portable-operations-headless'))).toBe(false)
  })

  it('installs Agent command authority only for the acquired headless route', async () => {
    const seed = createProductionProfileSeed()
    const commandRequest = {
      version: 1 as const,
      schemaVersion: 1 as const,
      expectedRevision: seed.revision,
      idempotencyKey: 'host-agent-batch',
      dryRun: true,
      commands: [{
        version: 1 as const,
        id: 'create-note',
        name: 'card.create' as const,
        payload: {
          ideaId: seed.activeIdeaId,
          kind: 'note' as const,
          position: { x: 10, y: 20 },
          body: 'Headless native command',
        },
      }],
    }
    const receipt = {
      kind: 'agent-command-batch' as const,
      version: 5 as const,
      previousRevision: seed.revision,
      revision: seed.revision,
      proposedRevision: seed.revision + 1,
      commitId: null,
      commandResults: [{
        commandId: 'create-note',
        name: 'card.create' as const,
        cardId: 'card-created',
        blockId: 'block-created',
        position: { x: 10, y: 20 },
      }],
      effects: {
        inserted: 2,
        updated: 0,
        deleted: 0,
        intentEvents: 1,
        profileAgentEvents: 0,
      },
      intentEventIds: [],
      profileAgentEventIds: [],
      dryRun: true,
      replayed: false,
    }
    const applyAgentCommandBatch = vi.fn(async () => ({ ok: true as const, value: receipt }))
    const changes = vi.fn(async () => ({
      ok: true as const,
      value: {
        profileId: seed.profileId,
        revision: seed.revision,
        since: 0,
        items: [],
        truncated: false,
      },
    }))
    const agentCardNeighbors = vi.fn(async () => ({
      ok: true as const,
      value: {
        profileId: seed.profileId,
        revision: seed.revision,
        ideaId: seed.activeIdeaId,
        card: {
          cardId: 'card-anchor',
          deepLink: `eido://app/?idea=${seed.activeIdeaId}&card=card-anchor`,
        },
        items: [],
        truncated: false,
      },
    }))
    const agentCardSetBounds = vi.fn(async () => ({
      ok: true as const,
      value: {
        profileId: seed.profileId,
        revision: seed.revision,
        ideaId: seed.activeIdeaId,
        cards: [{
          cardId: 'card-anchor',
          deepLink: `eido://app/?idea=${seed.activeIdeaId}&card=card-anchor`,
          kind: 'note' as const,
          position: { x: 10, y: 20 },
          size: { width: 260, height: 180 },
        }],
        bounds: { x: 10, y: 20, width: 260, height: 180 },
      },
    }))
    const headlessStatus: ProfileStatus = {
      profileId: seed.profileId,
      revision: seed.revision,
      versions: seed.versions,
      state: 'ready',
      owner: { mode: 'mutable', route: 'exclusive-headless-owner' },
      dirty: 'clean',
      compatibility: seed.compatibility,
    }
    const headlessCoordinator = syntheticCoordinator(seed, {
      owner: Object.freeze({
        ownerId: 'synthetic-headless-owner',
        generation: 1,
        route: 'exclusive-headless-owner',
      }),
      status: vi.fn(async () => ({ ok: true as const, value: headlessStatus })),
      capabilities: vi.fn(async () => ({
        ok: true as const,
        value: createProfileCapabilities('sqlite'),
      })),
      changes,
      agentCardNeighbors,
      agentCardSetBounds,
      applyAgentCommandBatch,
    })
    const root = disposableRoot()
    const databasePath = path.join(root, 'profiles', 'default', 'eido-profile.sqlite')
    mkdirSync(path.dirname(databasePath), { recursive: true })
    writeFileSync(databasePath, '')
    const headless = hostWithCoordinator(headlessCoordinator)
    await expect(headless.initialize({
      route: 'exclusive-headless-owner',
      databasePath,
      transport: 'mcp',
      actor: { client: 'eido-test', sessionId: 'capability-headless-session' },
    })).resolves.toMatchObject({ kind: 'ready', route: 'exclusive-headless-owner' })

    const capabilities = await request(
      headless,
      createProfileUtilityRequest('headless-command-capabilities', 'capabilities', {}),
    )
    expect(capabilities.result).toMatchObject({
      ok: true,
      value: { commands: INSTALLED_PROFILE_AGENT_COMMAND_NAMES, commandBatch: { version: 5 } },
    })
    const listedChanges = await request(headless, createProfileUtilityRequest(
      'headless-agent-changes',
      'changes',
      { request: { since: 0, limit: 1, byteLimit: 4_096 } },
    ))
    expect(listedChanges.result).toMatchObject({
      ok: true,
      value: { profileId: seed.profileId, revision: seed.revision, since: 0 },
    })
    expect(changes).toHaveBeenCalledWith({ since: 0, limit: 1, byteLimit: 4_096 })
    const listedNeighbors = await request(headless, createProfileUtilityRequest(
      'headless-agent-neighbors',
      'agent-card-neighbors',
      {
        request: {
          ideaId: seed.activeIdeaId,
          card: 'card-anchor',
          limit: 1,
          byteLimit: 4_096,
        },
      },
    ))
    expect(listedNeighbors.result).toMatchObject({
      ok: true,
      value: { profileId: seed.profileId, revision: seed.revision, items: [] },
    })
    expect(agentCardNeighbors).toHaveBeenCalledWith({
      ideaId: seed.activeIdeaId,
      card: 'card-anchor',
      limit: 1,
      byteLimit: 4_096,
    })
    const listedBounds = await request(headless, createProfileUtilityRequest(
      'headless-agent-bounds',
      'agent-card-set-bounds',
      { request: { ideaId: seed.activeIdeaId, cards: ['card-anchor'] } },
    ))
    expect(listedBounds.result).toMatchObject({
      ok: true,
      value: { profileId: seed.profileId, revision: seed.revision },
    })
    expect(agentCardSetBounds).toHaveBeenCalledWith({
      ideaId: seed.activeIdeaId,
      cards: ['card-anchor'],
    })
    const applied = await request(headless, createProfileUtilityRequest(
      'headless-command-apply',
      'apply-agent-command-batch',
      { request: commandRequest },
    ))
    expect(applied.result).toEqual({ ok: true, value: receipt })
    expect(applyAgentCommandBatch).toHaveBeenCalledWith(commandRequest, 'mcp', {
      client: 'eido-test',
      sessionId: 'capability-headless-session',
    })

    const activeApply = vi.fn(async () => ({ ok: true as const, value: receipt }))
    const active = hostWithCoordinator(syntheticCoordinator(seed, {
      capabilities: vi.fn(async () => ({
        ok: true as const,
        value: createProfileCapabilities('sqlite'),
      })),
      agentCardNeighbors,
      agentCardSetBounds,
      applyAgentCommandBatch: activeApply,
    }))
    await initializeSyntheticHost(active)
    const activeCapabilities = await request(
      active,
      createProfileUtilityRequest('active-command-capabilities', 'capabilities', {}),
    )
    expect(activeCapabilities.result).toMatchObject({
      ok: true,
      value: { commands: INSTALLED_PROFILE_AGENT_COMMAND_NAMES, commandBatch: { version: 5 } },
    })
    expect((await request(active, createProfileUtilityRequest(
      'active-agent-neighbors',
      'agent-card-neighbors',
      {
        request: {
          ideaId: seed.activeIdeaId,
          card: 'card-anchor',
          limit: 1,
          byteLimit: 4_096,
        },
      },
    ))).result).toMatchObject({ ok: true, value: { revision: seed.revision } })
    expect((await request(active, createProfileUtilityRequest(
      'active-agent-bounds',
      'agent-card-set-bounds',
      { request: { ideaId: seed.activeIdeaId, cards: ['card-anchor'] } },
    ))).result).toMatchObject({ ok: true, value: { revision: seed.revision } })
    expect((await request(active, createProfileUtilityRequest(
      'active-command-denied',
      'apply-agent-command-batch',
      { request: commandRequest },
    ))).result).toMatchObject({ ok: false, code: 'capability-denied' })
    const liveActor = { client: 'codex', sessionId: 'live-session-1' }
    expect((await request(active, createProfileUtilityRequest(
      'active-command-live',
      'apply-agent-command-batch',
      { request: commandRequest, transport: 'cli', actor: liveActor },
    ))).result).toEqual({ ok: true, value: receipt })
    expect(activeApply).toHaveBeenCalledOnce()
    expect(activeApply).toHaveBeenCalledWith(commandRequest, 'cli', liveActor)

    expect((await request(headless, createProfileUtilityRequest(
      'headless-command-live-shape-denied',
      'apply-agent-command-batch',
      { request: commandRequest, transport: 'cli', actor: liveActor },
    ))).result).toMatchObject({ ok: false, code: 'capability-denied' })
  })

  it('binds trusted transport at session initialization and rejects cross-transport replay', async () => {
    const root = disposableRoot()
    const databasePath = path.join(root, 'profiles', 'default', 'eido-profile.sqlite')
    const active = newHost()
    await expect(active.initialize({
      route: 'active-owner',
      databasePath,
      portableTempRoot: path.join(root, 'portable-operations'),
    })).resolves.toMatchObject({ kind: 'ready', route: 'active-owner', state: 'ready' })
    const hydrated = await request(active, createProfileUtilityRequest(
      'transport-boundary-hydrate',
      'hydrate',
      {},
    ))
    if (!hydrated.result.ok) throw new Error('Synthetic transport Profile did not hydrate')
    const ideaId = hydrated.result.value.activeIdeaId
    await request(active, createProfileUtilityRequest('transport-boundary-close-active', 'close', {}))

    const commandRequest = {
      version: 1 as const,
      schemaVersion: 1 as const,
      expectedRevision: 0,
      idempotencyKey: 'transport-boundary-command',
      dryRun: false,
      commands: [{
        version: 1 as const,
        id: 'transport-boundary-create',
        name: 'card.create' as const,
        payload: {
          ideaId,
          kind: 'note' as const,
          position: { x: 10, y: 20 },
          text: 'Trusted CLI attribution',
        },
      }],
    }
    const cli = newHost()
    await expect(cli.initialize({
      route: 'exclusive-headless-owner',
      databasePath,
      transport: 'cli',
      actor: { client: 'eido-test', sessionId: 'transport-cli-session' },
    })).resolves.toMatchObject({ kind: 'ready', revision: 0 })
    expect((await request(cli, createProfileUtilityRequest(
      'transport-boundary-cli-apply',
      'apply-agent-command-batch',
      { request: commandRequest },
    ))).result).toMatchObject({
      ok: true,
      value: { revision: 1, replayed: false },
    })
    await request(cli, createProfileUtilityRequest('transport-boundary-close-cli', 'close', {}))

    const mcp = newHost()
    await expect(mcp.initialize({
      route: 'exclusive-headless-owner',
      databasePath,
      transport: 'mcp',
      actor: { client: 'eido-test', sessionId: 'transport-mcp-session' },
    })).resolves.toMatchObject({ kind: 'ready', revision: 1 })
    expect((await request(mcp, createProfileUtilityRequest(
      'transport-boundary-mcp-replay',
      'apply-agent-command-batch',
      { request: commandRequest },
    ))).result).toMatchObject({
      ok: false,
      code: 'invalid',
      currentRevision: 1,
    })
    expect((await request(mcp, createProfileUtilityRequest(
      'transport-boundary-status',
      'status',
      {},
    ))).result).toMatchObject({ ok: true, value: { revision: 1 } })
    await request(mcp, createProfileUtilityRequest('transport-boundary-close-mcp', 'close', {}))
  })

  it('becomes ready only after acquiring one active owner with a valid first-run Profile', async () => {
    const root = disposableRoot()
    const host = newHost()
    const ready = await host.initialize({
      route: 'active-owner',
      databasePath: path.join(root, 'profiles', 'default', 'eido-profile.sqlite'),
      portableTempRoot: path.join(root, 'portable-operations'),
    })

    expect(ready).toMatchObject({
      kind: 'ready',
      route: 'active-owner',
      state: 'ready',
      revision: 0,
    })

    const hydrated = await request(host, createProfileUtilityRequest('hydrate-1', 'hydrate', {}))
    expect(hydrated.result).toMatchObject({
      ok: true,
      value: {
        revision: 0,
        compatibility: { read: 'supported', write: 'supported' },
      },
    })
    if (!hydrated.result.ok) throw new Error('Synthetic first-run Profile did not hydrate')
    const snapshot = hydrated.result.value
    expect(snapshot.modTemplates.map(({ recordId }) => recordId)).toEqual([
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
    expect(snapshot.modTemplates.map(({ payload }) => payload.mod.kind)).toEqual([
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
    expect(snapshot.profileSettings).toEqual([{
      id: 'profile-setting-locale',
      recordVersion: 1,
      classification: 'portable-profile',
      value: { locale: expect.any(String) },
    }])
    for (const template of snapshot.modTemplates) {
      expect(template).toMatchObject({
        ownerId: snapshot.profileId,
        parentId: snapshot.profileId,
        recordVersion: 2,
        payload: {
          templateVersion: 1,
          provenance: { kind: 'built-in' },
          createdAt: snapshot.ideas[0]!.createdAt,
          updatedAt: snapshot.ideas[0]!.createdAt,
        },
      })
      expect(template.payload.mod).not.toHaveProperty('id')
    }
    expect(snapshot.profileId).toMatch(/^profile:/)
    expect(snapshot.ideas).toEqual([
      expect.objectContaining({ id: snapshot.activeIdeaId, name: 'Main Idea' }),
    ])
    expect(snapshot.boards[snapshot.activeIdeaId]).toMatchObject({
      version: 1,
      cards: [],
      connections: [],
      outputs: [],
      runs: [],
    })

    const confirmed = await request(
      host,
      createProfileUtilityRequest('confirm-1', 'confirm-revision', { expectedRevision: 0 }),
    )
    expect(confirmed.result).toEqual({
      ok: true,
      value: { revision: 0, durable: true, dirty: false },
    })

    const secondHost = newHost()
    expect(await secondHost.initialize({
      route: 'active-owner',
      databasePath: path.join(root, 'profiles', 'default', 'eido-profile.sqlite'),
      portableTempRoot: path.join(root, 'portable-operations-second'),
    })).toMatchObject({ kind: 'fatal', failure: { code: 'busy' } })

    expect((await request(host, createProfileUtilityRequest('close-1', 'close', {}))).result)
      .toEqual({ ok: true, value: { closed: true } })
    expect((await request(host, createProfileUtilityRequest('close-2', 'close', {}))).result)
      .toEqual({ ok: true, value: { closed: true } })
  })

  it('commits only a full owner-context GUI request and confirms its exact revision', async () => {
    const root = disposableRoot()
    const host = newHost()
    const ready = await host.initialize({
      route: 'active-owner',
      databasePath: path.join(root, 'profile.sqlite'),
      portableTempRoot: path.join(root, 'portable-operations'),
    })
    if (ready.kind !== 'ready') throw new Error('Synthetic utility owner was unavailable')

    const hydrated = await request(host, createProfileUtilityRequest('hydrate-2', 'hydrate', {}))
    if (!hydrated.result.ok) throw new Error('Synthetic Profile did not hydrate')
    const snapshot = hydrated.result.value
    const ideaId = 'idea:created-by-gui'
    const authorized = await request(
      host,
      createProfileUtilityRequest('authorize-1', 'authorize-ordinary-idea-create', { ideaId }),
    )
    if (!authorized.result.ok) throw new Error('Synthetic Idea authorization was unavailable')

    const committedAt = new Date(
      Date.parse(authorized.result.value.createdAt) + 1,
    ).toISOString()
    const builtIn = PROFILE_BUILT_IN_MOD_TEMPLATES[0]!
    const stamped = remapModPartIdentities(
      builtIn.mod,
      ({ role, ordinal }) => `first-built-in-stamp-${role}-${ordinal}`,
    )
    const stampedMod = stamped.value
    const instanceId = 'mod-instance:first-built-in-stamp'
    const committed = await request(host, createProfileUtilityRequest(
      'commit-1',
      'commit-gui-projection',
      {
        generation: 1,
        expectedRevision: 0,
        clientTxnId: 'client-txn-1',
        idempotencyKey: 'idempotency-1',
        committedAt,
        context: {
          trustedActorId: 'eido-gui',
          ordinaryNewIdeas: [authorized.result.value],
        },
        rendererProjection: {
          projectionVersion: 2,
          activeIdeaId: ideaId,
          ideas: [
              ...snapshot.ideas,
              {
                id: ideaId,
                name: 'Created by GUI',
                createdAt: authorized.result.value.createdAt,
                updatedAt: committedAt,
                lastOpenedAt: committedAt,
              },
          ],
          boardReplacements: {
              [ideaId]: {
                version: 1,
                cards: [{
                  id: 'card:first-built-in-stamp',
                  kind: 'mod',
                  position: { x: 40, y: 60 },
                  blocks: [{
                    id: 'block:first-built-in-stamp',
                    kind: 'line',
                    text: 'First built-in stamp',
                  }],
                  modV2: stampedMod,
                }],
                connections: [],
                outputs: [],
                runs: [],
                updatedAt: committedAt,
              },
          },
          userModTemplates: [],
          newModOrigins: {
              'card:first-built-in-stamp': {
                kind: 'stamped',
                instanceId,
                sourceTemplateId: builtIn.templateId,
                sourceTemplateVersion: 1,
                sourceToInstanceIdMap: {
                  mod: { sourceId: builtIn.templateId, instanceId },
                  controls: stamped.mappings.map((mapping) => ({
                    sourceId: mapping.sourceId,
                    instanceId: mapping.instanceId,
                  })),
                },
              },
          },
        },
      },
    ))

    expect(committed.result).toMatchObject({ ok: true, value: { revision: 1 } })
    const afterCommit = await request(
      host,
      createProfileUtilityRequest('hydrate-after-stamp', 'hydrate', {}),
    )
    expect(afterCommit.result).toMatchObject({
      ok: true,
      value: {
        modInstances: [{
          recordId: instanceId,
          payload: {
            source: {
              kind: 'template',
              templateId: builtIn.templateId,
              templateVersion: 1,
            },
          },
        }],
      },
    })
    if (!afterCommit.result.ok) throw new Error('Synthetic built-in stamp did not hydrate')
    expect(afterCommit.result.value.profileSettings).toEqual(snapshot.profileSettings)
    expect((await request(host, createProfileUtilityRequest(
      'confirm-2',
      'confirm-revision',
      { expectedRevision: 1 },
    ))).result).toEqual({
      ok: true,
      value: { revision: 1, durable: true, dirty: false },
    })

    await request(host, createProfileUtilityRequest('close-3', 'close', {}))
  })

  it('materializes portable file capabilities inside the utility boundary', async () => {
    const root = disposableRoot()
    const host = newHost()
    const ready = await host.initialize({
      route: 'active-owner',
      databasePath: path.join(root, 'profile.sqlite'),
      portableTempRoot: path.join(root, 'portable-operations'),
    })
    if (ready.kind !== 'ready' || ready.state !== 'ready') {
      throw new Error('Synthetic utility owner was unavailable')
    }
    const hydrated = await request(host, createProfileUtilityRequest('hydrate-portable', 'hydrate', {}))
    if (!hydrated.result.ok) throw new Error('Synthetic Profile did not hydrate')
    const snapshot = hydrated.result.value

    const exportPath = path.join(root, 'exports', 'profile.eido.zip')
    mkdirSync(path.dirname(exportPath), { recursive: true })
    const exported = await request(host, createProfileUtilityRequest(
      'export-1',
      'export-portable',
      {
        request: { version: 1, operationId: 'export-operation-1', expectedRevision: 0 },
        destinationPath: exportPath,
      },
    ))
    expect(exported.result).toMatchObject({
      ok: true,
      value: { operationId: 'export-operation-1', revision: 0, verified: true },
    })
    expect(existsSync(exportPath)).toBe(true)

    const duplicated = await request(host, createProfileUtilityRequest(
      'duplicate-1',
      'duplicate-idea',
      {
        request: {
          version: 1,
          operationId: 'duplicate-operation-1',
          idempotencyKey: 'duplicate-key-1',
          expectedRevision: 0,
          sourceIdeaId: snapshot.activeIdeaId,
          name: 'Duplicated Main Idea',
        },
      },
    ))
    expect(duplicated.result).toMatchObject({
      ok: true,
      value: { kind: 'duplicate-idea', revision: 1 },
    })

    const legacyPath = path.join(root, 'incoming-idea.json')
    writeFileSync(legacyPath, JSON.stringify({
      version: 1,
      exportedAt: new Date().toISOString(),
      idea: snapshot.ideas[0],
      board: snapshot.boards[snapshot.activeIdeaId],
    }), { encoding: 'utf8' })
    const imported = await request(host, createProfileUtilityRequest(
      'import-1',
      'import-idea-closure',
      {
        request: {
          version: 1,
          operationId: 'import-operation-1',
          idempotencyKey: 'import-key-1',
          expectedRevision: 1,
          name: 'Imported Main Idea',
        },
        sourcePath: legacyPath,
      },
    ))
    expect(imported.result).toMatchObject({
      ok: true,
      value: { kind: 'import-idea', revision: 2 },
    })

    await request(host, createProfileUtilityRequest('close-portable', 'close', {}))
  })

  it('reports and consumes recovery high-water only from native authority', async () => {
    const root = disposableRoot()
    const databasePath = path.join(root, 'profile.sqlite')
    const host = newHost()
    const ready = await host.initialize({
      route: 'active-owner',
      databasePath,
      portableTempRoot: path.join(root, 'portable-operations'),
    })
    if (ready.kind !== 'ready' || ready.state !== 'ready') {
      throw new Error('Synthetic utility owner was unavailable')
    }

    const mutator = new DatabaseSync(databasePath)
    try {
      mutator.exec(`
UPDATE profile_owner_fence
SET owner_token = 'tampered-owner-token'
`)
    } finally {
      mutator.close()
    }

    expect((await request(host, createProfileUtilityRequest(
      'status-recovery',
      'status',
      {},
    ))).result).toMatchObject({ ok: false, code: 'corrupt-or-recovery-required' })
    expect((await request(host, createProfileUtilityRequest(
      'inspect-recovery',
      'inspect-recovery',
      {},
    ))).result).toEqual({
      ok: true,
      value: {
        mode: 'inspect',
        candidates: [],
        rejectedCandidateIds: [],
        quarantinedCurrentState: false,
        currentRevision: 0,
      },
    })
    expect((await request(host, createProfileUtilityRequest(
      'restore-missing',
      'restore-recovery',
      { candidateId: 'missing-candidate' },
    ))).result).toMatchObject({ ok: false, code: 'not-found', currentRevision: 0 })
  })

  it('starts fresh from a recovery-required boot and serves the fresh Profile', async () => {
    const root = disposableRoot()
    const databasePath = path.join(root, 'profile.sqlite')
    const initialize = {
      route: 'active-owner' as const,
      databasePath,
      portableTempRoot: path.join(root, 'portable-operations'),
    }
    const first = newHost()
    const firstReady = await first.initialize(initialize)
    if (firstReady.kind !== 'ready' || firstReady.state !== 'ready') {
      throw new Error('Synthetic utility owner was unavailable')
    }
    const seeded = await request(first, createProfileUtilityRequest('hydrate-seeded', 'hydrate', {}))
    if (!seeded.result.ok) throw new Error('Synthetic Profile did not hydrate')
    const seededProfileId = seeded.result.value.profileId
    await request(first, createProfileUtilityRequest('close-seeded', 'close', {}))

    // A pre-0.1.1 Profile carries physical record axis 1 and must fail closed.
    const mutator = new DatabaseSync(databasePath)
    try {
      mutator.exec('UPDATE profile_meta SET record_version = 1')
    } finally {
      mutator.close()
    }

    const host = newHost()
    const ready = await host.initialize(initialize)
    expect(ready).toMatchObject({ kind: 'ready', state: 'recovery-required' })

    const fresh = await request(host, createProfileUtilityRequest('start-fresh', 'start-fresh', {}))
    if (!fresh.result.ok) throw new Error('Expected start-fresh to succeed')
    expect(fresh.result.value).toMatchObject({
      mode: 'start-fresh',
      previousRevision: 0,
      revision: 0,
      quarantinedCurrentState: true,
    })
    expect(fresh.result.value.profileId).not.toBe(seededProfileId)

    const hydrated = await request(host, createProfileUtilityRequest('hydrate-fresh', 'hydrate', {}))
    if (!hydrated.result.ok) throw new Error('Expected the fresh Profile to hydrate')
    expect(hydrated.result.value.profileId).toBe(fresh.result.value.profileId)
    expect(hydrated.result.value.revision).toBe(0)
    expect((await request(host, createProfileUtilityRequest(
      'status-fresh',
      'status',
      {},
    ))).result).toMatchObject({ ok: true, value: { revision: 0, state: 'ready' } })
  })

  it('deeply rejects malformed GUI domain state before native revision mutation', async () => {
    const root = disposableRoot()
    const host = newHost()
    const ready = await host.initialize({
      route: 'active-owner',
      databasePath: path.join(root, 'profile.sqlite'),
      portableTempRoot: path.join(root, 'portable-operations'),
    })
    if (ready.kind !== 'ready' || ready.state !== 'ready') {
      throw new Error('Synthetic utility owner was unavailable')
    }
    const hydrated = await request(host, createProfileUtilityRequest(
      'hydrate-deep-validation',
      'hydrate',
      {},
    ))
    if (!hydrated.result.ok) throw new Error('Synthetic Profile did not hydrate')
    const snapshot = hydrated.result.value
    const currentIdea = snapshot.ideas[0]!
    const currentBoard = snapshot.boards[snapshot.activeIdeaId]!
    const baseProjection = {
      projectionVersion: 2,
      activeIdeaId: snapshot.activeIdeaId,
      ideas: snapshot.ideas,
      boardReplacements: {},
      userModTemplates: [],
      newModOrigins: {},
    } as const
    const malformedProjections: readonly Readonly<{ name: string; projection: unknown }>[] = [
      {
        name: 'Idea',
        projection: {
          ...baseProjection,
          ideas: [{ ...currentIdea, name: 42 }],
        },
      },
      {
        name: 'Board',
        projection: {
          ...baseProjection,
          boardReplacements: {
            [snapshot.activeIdeaId]: { ...currentBoard, version: 99 },
          },
        },
      },
      {
        name: 'user Mod template ownership',
        projection: {
          ...baseProjection,
          userModTemplates: [PROFILE_BUILT_IN_MOD_TEMPLATES[0]!],
        },
      },
      {
        name: 'new Mod origin consumption',
        projection: {
          ...baseProjection,
          newModOrigins: {
            'card:unused': { kind: 'direct', instanceId: 'mod-instance:unused' },
          },
        },
      },
    ]

    for (const [index, malformed] of malformedProjections.entries()) {
      const response = await host.handle({
        version: 1,
        kind: 'request',
        requestId: `invalid-${index}`,
        operation: 'commit-gui-projection',
        payload: {
          generation: index + 1,
          expectedRevision: 0,
          clientTxnId: `invalid-client-${index}`,
          idempotencyKey: `invalid-key-${index}`,
          committedAt: new Date(Date.parse(currentIdea.updatedAt) + 1_000).toISOString(),
          context: { trustedActorId: 'eido-gui', ordinaryNewIdeas: [] },
          rendererProjection: malformed.projection,
        },
      })
      expect(response, malformed.name).toMatchObject({
        kind: 'response',
        result: { ok: false, code: 'invalid' },
      })
    }

    expect((await request(host, createProfileUtilityRequest(
      'hydrate-after-invalid',
      'hydrate',
      {},
    ))).result).toMatchObject({ ok: true, value: { revision: 0 } })
  })

  it('preserves an authoritative empty locale collection across an unrelated GUI commit', async () => {
    const root = disposableRoot()
    const seed = createProductionProfileSeed()
    const host = newHost({
      createInitialProfile: () => Object.freeze({
        ...seed,
        profileSettings: [],
      }),
    })
    const ready = await host.initialize({
      route: 'active-owner',
      databasePath: path.join(root, 'profile.sqlite'),
      portableTempRoot: path.join(root, 'portable-operations'),
    })
    if (ready.kind !== 'ready' || ready.state !== 'ready') {
      throw new Error('Synthetic zero-locale utility owner was unavailable')
    }
    const hydrated = await request(host, createProfileUtilityRequest(
      'hydrate-zero-locale',
      'hydrate',
      {},
    ))
    if (!hydrated.result.ok) throw new Error('Synthetic zero-locale Profile did not hydrate')
    const snapshot = hydrated.result.value
    const currentIdea = snapshot.ideas[0]!
    const committedAt = new Date(Date.parse(currentIdea.updatedAt) + 1_000).toISOString()

    const committed = await request(host, createProfileUtilityRequest(
      'commit-zero-locale',
      'commit-gui-projection',
      {
        generation: 1,
        expectedRevision: 0,
        clientTxnId: 'zero-locale-client',
        idempotencyKey: 'zero-locale-key',
        committedAt,
        context: { trustedActorId: 'eido-gui', ordinaryNewIdeas: [] },
        rendererProjection: {
          projectionVersion: 2,
          activeIdeaId: snapshot.activeIdeaId,
          ideas: [{
            ...currentIdea,
            name: 'Renamed without locale mutation',
            updatedAt: committedAt,
            lastOpenedAt: committedAt,
          }],
          boardReplacements: {},
          userModTemplates: [],
          newModOrigins: {},
        },
      },
    ))
    expect(committed.result).toMatchObject({ ok: true, value: { revision: 1 } })
    const after = await request(host, createProfileUtilityRequest(
      'hydrate-after-zero-locale',
      'hydrate',
      {},
    ))
    expect(after.result).toMatchObject({
      ok: true,
      value: {
        revision: 1,
        profileSettings: [],
        ideas: [expect.objectContaining({ name: 'Renamed without locale mutation' })],
      },
    })
  })

  it('selects only exact zero-or-one canonical native locale state', () => {
    const seed = createProductionProfileSeed()
    const empty = readAuthoritativeLocaleSettings({ ...seed, profileSettings: [] })
    const one = readAuthoritativeLocaleSettings(seed)

    expect(empty).toEqual([])
    expect(Object.isFrozen(empty)).toBe(true)
    expect(one).toEqual(seed.profileSettings)
    expect(Object.isFrozen(one)).toBe(true)
    expect(Object.isFrozen(one?.[0])).toBe(true)
    expect(Object.isFrozen(one?.[0]?.value)).toBe(true)
    expect(readAuthoritativeLocaleSettings({
      ...seed,
      profileSettings: [...seed.profileSettings, ...seed.profileSettings],
    })).toBeUndefined()
    expect(readAuthoritativeLocaleSettings({
      ...seed,
      profileSettings: [{
        id: 'profile-setting-locale',
        recordVersion: 1,
        classification: 'portable-profile',
        value: { locale: 'not a canonical locale' },
      }],
    })).toBeUndefined()
  })

  it('throws instead of continuing after impossible authoritative locale state', async () => {
    const seed = createProductionProfileSeed()
    const invalidSnapshot: ProfileSnapshot = {
      ...seed,
      profileSettings: [...seed.profileSettings, ...seed.profileSettings],
    }
    const commitGuiProjection = vi.fn()
    const coordinator = syntheticCoordinator(seed, {
      snapshot: vi.fn(async () => ({ ok: true as const, value: invalidSnapshot })),
      commitGuiProjection,
    })
    const host = hostWithCoordinator(coordinator)
    await initializeSyntheticHost(host)

    await expect(host.handle(guiCommitRequest(seed, 'invalid-authority')))
      .rejects.toThrow('authoritative locale')
    expect(commitGuiProjection).not.toHaveBeenCalled()
  })

  // A Profile setting whose id this build has never heard of used to make
  // `readAuthoritativeLocaleSettings` return undefined, which made EVERY GUI
  // save throw. That is the exact failure class ADR 0040 exists to kill: a
  // setting nothing here reads taking the whole Profile offline. It is now
  // inert: carried through verbatim, ignored, never fatal.
  it('carries a Profile setting it does not recognise through a save instead of throwing', async () => {
    const seed = createProductionProfileSeed()
    const foreignSetting = {
      id: 'profile-setting-from-a-newer-build',
      recordVersion: 1 as const,
      classification: 'portable-profile' as const,
      value: { theme: 'aurora', density: 3 },
    }
    const withForeignSetting: ProfileSnapshot = {
      ...seed,
      profileSettings: [...seed.profileSettings, foreignSetting],
    }
    const commitGuiProjection = vi.fn(async () => ({
      ok: true as const,
      value: Object.freeze({
        previousRevision: seed.revision,
        revision: seed.revision + 1,
        commitId: 'commit-foreign-setting',
        generation: 1,
        clientTxnId: 'client-foreign-setting',
        idempotencyKey: 'key-foreign-setting',
        deletedRecordIds: Object.freeze([]),
        changedRecordIds: Object.freeze([]),
        appendedIntentEventIds: Object.freeze([]),
        authorizationIds: Object.freeze([]),
        replayed: false,
      }),
    }))
    const coordinator = syntheticCoordinator(seed, {
      snapshot: vi.fn(async () => ({ ok: true as const, value: withForeignSetting })),
      commitGuiProjection,
    })
    const host = hostWithCoordinator(coordinator)
    await initializeSyntheticHost(host)

    await expect(host.handle(guiCommitRequest(seed, 'foreign-setting'))).resolves.toBeDefined()

    // Rule 1: the setting reaches the commit unchanged and in its stored
    // order, so the save cannot delete a preference this build cannot read.
    expect(commitGuiProjection).toHaveBeenCalledTimes(1)
    const committed = (commitGuiProjection.mock.calls as unknown as [GuiProfileProjectionRequest][])[0]![0]
    expect(committed.projection.profileSettings).toEqual([
      seed.profileSettings[0],
      foreignSetting,
    ])

    // And the reader agrees when asked directly, including with the
    // unrecognised row standing alone.
    expect(readAuthoritativeLocaleSettings(withForeignSetting))
      .toEqual([seed.profileSettings[0], foreignSetting])
    expect(readAuthoritativeLocaleSettings({ profileSettings: [foreignSetting] }))
      .toEqual([foreignSetting])
  })

  it('throws when the provider returns an impossible recovery receipt mode', async () => {
    const seed = createProductionProfileSeed()
    const inspectCoordinator = syntheticCoordinator(seed, {
      recover: vi.fn(async () => ({
        ok: true as const,
        value: Object.freeze({
          mode: 'restore' as const,
          selectedCandidateId: 'candidate-wrong-mode',
          rejectedCandidateIds: [],
          quarantinedCurrentState: true,
          previousRevision: 0,
          revision: 1,
        }),
      })),
    })
    const inspectHost = hostWithCoordinator(inspectCoordinator)
    await initializeSyntheticHost(inspectHost)
    await expect(inspectHost.handle(createProfileUtilityRequest(
      'inspect-wrong-mode',
      'inspect-recovery',
      {},
    ))).rejects.toThrow('recovery inspection mode')

    const restoreCoordinator = syntheticCoordinator(seed, {
      recover: vi.fn(async () => ({
        ok: true as const,
        value: Object.freeze({
          mode: 'inspect' as const,
          candidates: [],
          rejectedCandidateIds: [],
          quarantinedCurrentState: false as const,
        }),
      })),
    })
    const restoreHost = hostWithCoordinator(restoreCoordinator)
    await initializeSyntheticHost(restoreHost)
    await expect(restoreHost.handle(createProfileUtilityRequest(
      'restore-wrong-mode',
      'restore-recovery',
      { candidateId: 'candidate-wrong-mode' },
    ))).rejects.toThrow('recovery restore mode')
  })

  it('keeps provider-declared failures as ordinary typed responses', async () => {
    const seed = createProductionProfileSeed()
    const snapshotFailure = profileServiceFailure('corrupt-or-recovery-required', {
      currentRevision: seed.revision,
    })
    const recoveryFailure = profileServiceFailure('not-found', {
      currentRevision: seed.revision,
    })
    const coordinator = syntheticCoordinator(seed, {
      snapshot: vi.fn(async () => snapshotFailure),
      recover: vi.fn(async () => recoveryFailure),
    })
    const host = hostWithCoordinator(coordinator)
    await initializeSyntheticHost(host)

    expect((await host.handle(guiCommitRequest(seed, 'provider-failure'))).result)
      .toEqual(snapshotFailure)
    expect((await request(host, createProfileUtilityRequest(
      'provider-recovery-failure',
      'inspect-recovery',
      {},
    ))).result).toEqual(recoveryFailure)
  })

  it('dispatches bounded Result inspection through the acquired owner only', async () => {
    const seed = createProductionProfileSeed()
    const inspectResult = vi.fn(async () => ({
      ok: true as const,
      value: {
        profileId: seed.profileId,
        revision: seed.revision,
        ideaId: seed.activeIdeaId,
        resultCardId: 'card-result',
        items: [],
        truncated: false,
      },
    }))
    const host = hostWithCoordinator(syntheticCoordinator(seed, { inspectResult }))
    await initializeSyntheticHost(host)

    const response = await request(host, createProfileUtilityRequest(
      'inspect-result-owner',
      'inspect-result',
      {
        request: {
          ideaId: seed.activeIdeaId,
          resultCardId: 'card-result',
          limit: 2,
          byteLimit: 4_096,
        },
      },
    ))
    expect(response.result).toMatchObject({
      ok: true,
      value: {
        profileId: seed.profileId,
        revision: seed.revision,
        ideaId: seed.activeIdeaId,
        resultCardId: 'card-result',
      },
    })
    expect(inspectResult).toHaveBeenCalledWith({
      ideaId: seed.activeIdeaId,
      resultCardId: 'card-result',
      limit: 2,
      byteLimit: 4_096,
    })
  })

  it('runs embedded SQLite evidence inside the utility handler and propagates probe failure', async () => {
    const seed = createProductionProfileSeed()
    const coordinator = syntheticCoordinator(seed)
    const evidence = Object.freeze({
      chromium: '150.0.7871.114',
      electron: '43.1.1',
      node: '24.18.0',
      profileAuthority: 'installed' as const,
      sqlite: '3.50.4',
    })
    const probeRuntime = vi.fn(() => evidence)
    const host = hostWithCoordinator(coordinator, { probeRuntime })
    await initializeSyntheticHost(host)

    const response = await request(host, createProfileUtilityRequest(
      'embedded-runtime-probe',
      'runtime-probe',
      {},
    ))
    expect(response.result).toEqual({ ok: true, value: evidence })
    expect(probeRuntime).toHaveBeenCalledOnce()
    expect(Object.isFrozen(response.result.ok && response.result.value)).toBe(true)

    const probeFailure = new Error('Embedded SQLite probe failed')
    const throwingProbe = vi.fn(() => { throw probeFailure })
    const throwingHost = hostWithCoordinator(syntheticCoordinator(seed), {
      probeRuntime: throwingProbe,
    })
    await initializeSyntheticHost(throwingHost)
    await expect(throwingHost.handle(createProfileUtilityRequest(
      'embedded-runtime-probe-failure',
      'runtime-probe',
      {},
    ))).rejects.toBe(probeFailure)
    expect(throwingProbe).toHaveBeenCalledOnce()
  })
})

async function request<Operation extends ProfileUtilityRequestMessage['operation']>(
  host: ReturnType<typeof createProfileUtilityHost>,
  message: ProfileUtilityRequestMessage<Operation>,
): Promise<ProfileUtilityResponseMessage<Operation>> {
  return host.handle(message) as Promise<ProfileUtilityResponseMessage<Operation>>
}

function disposableRoot(): string {
  const root = mkdtempSync(path.join(tmpdir(), 'eido-465-utility-'))
  disposableRoots.push(root)
  return root
}

function newHost(options?: ProfileUtilityHostOptions): ReturnType<typeof createProfileUtilityHost> {
  const host = createProfileUtilityHost(options)
  hosts.push(host)
  return host
}

function hostWithCoordinator(
  coordinator: SqliteProfileOwnerCoordinator,
  options: Omit<ProfileUtilityHostOptions, 'acquireProfileOwner'> = {},
): ReturnType<typeof createProfileUtilityHost> {
  return newHost({
    ...options,
    acquireProfileOwner: () => ({ ok: true, value: coordinator }),
  })
}

async function initializeSyntheticHost(
  host: ReturnType<typeof createProfileUtilityHost>,
): Promise<void> {
  const root = disposableRoot()
  await expect(host.initialize({
    route: 'active-owner',
    databasePath: path.join(root, 'profile.sqlite'),
    portableTempRoot: path.join(root, 'portable-operations'),
  })).resolves.toMatchObject({ kind: 'ready', state: 'ready', revision: 0 })
}

function syntheticCoordinator(
  seed: ProfileSnapshot,
  overrides: Partial<SqliteProfileOwnerCoordinator> = {},
): SqliteProfileOwnerCoordinator {
  const status: ProfileStatus = {
    profileId: seed.profileId,
    revision: seed.revision,
    versions: seed.versions,
    state: 'ready',
    owner: { mode: 'mutable', route: 'active-owner' },
    dirty: 'clean',
    compatibility: seed.compatibility,
  }
  return {
    owner: Object.freeze({ ownerId: 'synthetic-owner', generation: 1, route: 'active-owner' }),
    status: vi.fn(async () => ({ ok: true, value: status })),
    snapshot: vi.fn(async () => ({ ok: true, value: seed })),
    recoveryHighWaterRevision: vi.fn(() => seed.revision),
    recover: vi.fn(async () => profileServiceFailure('not-found', {
      currentRevision: seed.revision,
    })),
    close: vi.fn(async () => undefined),
    ...overrides,
  } as unknown as SqliteProfileOwnerCoordinator
}

function guiCommitRequest(
  snapshot: ProfileSnapshot,
  suffix: string,
): ReturnType<typeof createProfileUtilityRequest<'commit-gui-projection'>> {
  return createProfileUtilityRequest(`commit-${suffix}`, 'commit-gui-projection', {
    generation: 1,
    expectedRevision: snapshot.revision,
    clientTxnId: `client-${suffix}`,
    idempotencyKey: `key-${suffix}`,
    committedAt: new Date(Date.parse(snapshot.ideas[0]!.updatedAt) + 1_000).toISOString(),
    context: { trustedActorId: 'eido-gui', ordinaryNewIdeas: [] },
    rendererProjection: {
      projectionVersion: 2,
      activeIdeaId: snapshot.activeIdeaId,
      ideas: snapshot.ideas,
      boardReplacements: {},
      userModTemplates: [],
      newModOrigins: {},
    },
  })
}
