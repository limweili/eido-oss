import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type {
  ProfileGatewayResponse,
  ProfileGatewaySessionService,
} from '../src/persistence/profileAgentGateway'
import {
  PROFILE_CONTRACT_VERSIONS,
  type ProfileSnapshot,
} from '../src/persistence/profileServiceContract'
import { runEidoCli, type EidoCliRawIo } from './eidoCli'
import { runProfileJsonCli } from './profileJsonCli'
import { issueSqliteProfileOwnershipCapability } from './sqliteProfileOwnerCapability'
import { createSqliteProfileRevisionStore } from './sqliteProfileRevisionStore'
import {
  createSqliteRuntimeOpener,
  openSqliteExclusiveRuntime,
  type SqliteDatabase,
} from './sqliteRuntime'

const openTestRuntime = createSqliteRuntimeOpener({
  openDatabase: location => new DatabaseSync(location) as unknown as SqliteDatabase,
})

describe('eido Idea creation journey', () => {
  it('previews, creates, replays, inspects, and then authors inside a named inactive Idea', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eido-idea-create-journey-'))
    const databasePath = path.join(root, 'profile.sqlite')
    const sidecarPath = `${databasePath}.owner.sqlite`
    const sidecar = openSqliteExclusiveRuntime(sidecarPath)
    sidecar.exec(`
CREATE TABLE profile_owner_generation (
  identity INTEGER PRIMARY KEY CHECK (identity = 1),
  generation INTEGER NOT NULL CHECK (generation >= 1),
  owner_token TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  acquired_at TEXT NOT NULL
);
INSERT INTO profile_owner_generation (
  identity, generation, owner_token, owner_id, acquired_at
) VALUES (
  1, 1, 'synthetic-owner-token-synthetic-owner-token-synthetic-owner-token',
  'owner-idea-create', '2026-08-02T00:00:00.000Z'
);
`)
    const ownershipCapability = issueSqliteProfileOwnershipCapability({
      profileDatabasePath: databasePath,
      sidecarPath,
      sidecarRuntime: sidecar,
    })
    let clientTxnSequence = 0
    let profileAgentEventSequence = 0
    let intentEventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability,
      seed: syntheticSnapshot(),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5,
      agentActor: { client: 'eido-cli', sessionId: 'session-idea-create' },
      now: () => '2026-08-02T00:00:01.000Z',
      createAgentClientTxnId: () => `owner-client-txn-${++clientTxnSequence}`,
      createProfileAgentEventId: () => `profile-agent-event-${++profileAgentEventSequence}`,
      createIntentEventId: () => `intent-idea-create-${++intentEventSequence}`,
    })
    const service: ProfileGatewaySessionService = {
      status: () => store.status(),
      capabilities: () => store.capabilities(),
      query: request => store.query(request),
      changes: request => store.changes(request),
      applyAgentCommandBatch: request => store.applyAgentCommandBatch(request, 'cli'),
      close: async () => undefined,
    }

    try {
      const create = [
        'idea', 'create', 'Chicken Research_1',
        '--expected-revision', '7',
        '--idempotency-key', 'chicken-research-1-create',
      ]
      const dryRun = await invokeVerb(
        [...create, '--dry-run'],
        'request-idea-dry-run',
        service,
        true,
      )
      expect(dryRun).toMatchObject({
        exitCode: 0,
        response: {
          ok: true,
          result: {
            version: 5,
            previousRevision: 7,
            revision: 7,
            proposedRevision: 8,
            commitId: null,
            commandResults: [{
              name: 'idea.create',
              boardId: expect.stringMatching(/^board:/),
              ideaName: 'Chicken Research_1',
            }],
            effects: {
              inserted: 2,
              updated: 0,
              deleted: 0,
              intentEvents: 0,
              profileAgentEvents: 1,
            },
            dryRun: true,
            replayed: false,
          },
        },
        stderr: '',
      })
      expect(await store.status()).toMatchObject({ ok: true, value: { revision: 7 } })
      expect(await store.snapshot()).toMatchObject({
        ok: true,
        value: {
          activeIdeaId: 'idea-main',
          ideas: [{ id: 'idea-main' }],
        },
      })

      const applied = await invokeVerb(
        [...create, '--apply'],
        'request-idea-apply',
        service,
        true,
      )
      expect(applied).toMatchObject({
        exitCode: 0,
        response: {
          ok: true,
          result: {
            version: 5,
            previousRevision: 7,
            revision: 8,
            proposedRevision: 8,
            commitId: 'agent:owner-client-txn-2',
            commandResults: [{
              name: 'idea.create',
              boardId: expect.stringMatching(/^board:/),
              ideaName: 'Chicken Research_1',
            }],
            profileAgentEventIds: ['profile-agent-event-1'],
            dryRun: false,
            replayed: false,
          },
        },
        stderr: '',
      })
      if (!applied.response.ok) throw new Error('Synthetic Idea creation did not apply')
      const commandResult = (applied.response.result as {
        commandResults?: Array<{
          ideaId?: string
          boardId?: string
          ideaName?: string
        }>
      }).commandResults?.[0]
      if (!commandResult?.ideaId || !commandResult.boardId) {
        throw new Error('Synthetic Idea creation did not return its aggregate identities')
      }
      expect(commandResult.boardId).toBe(`board:${commandResult.ideaId}`)

      const snapshot = await store.snapshot()
      expect(snapshot).toMatchObject({
        ok: true,
        value: {
          revision: 8,
          activeIdeaId: 'idea-main',
          ideas: [
            { id: 'idea-main', name: 'Existing work' },
            {
              id: commandResult.ideaId,
              name: 'Chicken Research_1',
              createdAt: '2026-08-02T00:00:01.000Z',
              updatedAt: '2026-08-02T00:00:01.000Z',
              lastOpenedAt: '2026-08-02T00:00:01.000Z',
            },
          ],
          boards: {
            [commandResult.ideaId]: {
              version: 1,
              cards: [],
              connections: [],
              outputs: [],
              runs: [],
              updatedAt: '2026-08-02T00:00:01.000Z',
            },
          },
        },
      })

      const listed = await invokeVerb(
        ['idea', 'list', '--projection', 'name'],
        'request-idea-list',
        service,
        false,
      )
      expect(listed).toMatchObject({
        exitCode: 0,
        response: {
          ok: true,
          result: {
            revision: 8,
            items: expect.arrayContaining([
              expect.objectContaining({
                recordId: commandResult.ideaId,
                payload: expect.objectContaining({ name: 'Chicken Research_1' }),
              }),
            ]),
          },
        },
      })

      const replayed = await invokeVerb(
        [...create, '--apply'],
        'request-idea-replay',
        service,
        true,
      )
      expect(replayed).toMatchObject({
        exitCode: 0,
        response: {
          ok: true,
          result: {
            revision: 8,
            commitId: 'agent:owner-client-txn-2',
            replayed: true,
          },
        },
      })

      const collision = await invokeVerb([
        'idea', 'create', 'Chicken Research_changed',
        '--expected-revision', '7',
        '--idempotency-key', 'chicken-research-1-create',
        '--apply',
      ], 'request-idea-collision', service, true)
      expect(collision).toMatchObject({
        exitCode: 2,
        response: { ok: false, error: { code: 'invalid' } },
      })

      const stale = await invokeVerb([
        'idea', 'create', 'Chicken Research_2',
        '--expected-revision', '7',
        '--idempotency-key', 'chicken-research-2-stale',
        '--apply',
      ], 'request-idea-stale', service, true)
      expect(stale).toMatchObject({
        exitCode: 4,
        response: { ok: false, error: { code: 'conflict', currentRevision: 8 } },
      })

      const authored = await invokeVerb([
        'card', 'create',
        '--idea', commandResult.ideaId,
        '--kind', 'note',
        '--x', '120',
        '--y', '80',
        '--body', 'Research question',
        '--expected-revision', '8',
        '--idempotency-key', 'chicken-research-1-first-card',
        '--apply',
      ], 'request-first-card', service, true)
      expect(authored).toMatchObject({
        exitCode: 0,
        response: {
          ok: true,
          result: { previousRevision: 8, revision: 9 },
        },
      })
      if (!authored.response.ok) throw new Error('Synthetic Card creation did not apply')
      const authoredCardId = (authored.response.result as {
        commandResults?: Array<{ cardId?: string }>
      }).commandResults?.[0]?.cardId
      if (!authoredCardId) throw new Error('Synthetic Card creation did not return its identity')

      const scopedCards = await invokeVerb([
        'graph', 'query',
        '--kind', 'card',
        '--idea', commandResult.ideaId,
        '--limit', '5',
        '--projection', 'id',
        '--projection', 'kind',
      ], 'request-scoped-cards', service, false)
      expect(scopedCards).toMatchObject({
        exitCode: 0,
        response: {
          ok: true,
          result: {
            revision: 9,
            items: [{
              recordId: authoredCardId,
              kind: 'card',
              ownerId: commandResult.boardId,
              payload: {
                id: authoredCardId,
                kind: 'note',
              },
            }],
            truncated: false,
          },
        },
      })

      // With --idempotency-key omitted the key is derived from the command, so
      // rerunning the exact same `idea create` replays instead of making a
      // second Idea.
      const retryable = [
        'idea', 'create', 'Derived Retry Proof',
        '--expected-revision', '9',
        '--apply',
      ]
      const firstDerived = await invokeVerb(retryable, 'request-derived-1', service, true)
      expect(firstDerived).toMatchObject({
        exitCode: 0,
        response: { ok: true, result: { previousRevision: 9, revision: 10, replayed: false } },
      })
      const secondDerived = await invokeVerb(retryable, 'request-derived-2', service, true)
      expect(secondDerived).toMatchObject({
        exitCode: 0,
        response: { ok: true, result: { revision: 10, replayed: true } },
      })
      expect(await store.status()).toMatchObject({ ok: true, value: { revision: 10 } })
      const afterRetry = await store.snapshot()
      if (!afterRetry.ok) throw new Error('Snapshot read failed')
      expect(afterRetry.value.ideas.filter(idea => idea.name === 'Derived Retry Proof'))
        .toHaveLength(1)
    } finally {
      store.close()
      sidecar.close()
      const expectedPrefix = path.join(tmpdir(), 'eido-idea-create-journey-')
      if (!root.startsWith(expectedPrefix)) {
        throw new Error('Refusing to remove an unexpected test root')
      }
      rmSync(root, { recursive: true, force: true })
    }
  })
})

async function invokeVerb(
  argv: readonly string[],
  requestId: string,
  service: ProfileGatewaySessionService,
  mutation: boolean,
): Promise<Readonly<{ exitCode: number; response: ProfileGatewayResponse; stderr: string }>> {
  const stdout: string[] = []
  const stderr: string[] = []
  const exitCode = await runEidoCli({
    argv: mutation ? [...argv, '--request-id', requestId] : argv,
    createRequestId: () => requestId,
    describeGateway: () => { throw new Error('Idea journey requested discovery') },
    stdin: emptyInput(),
    stdout: { write: value => { stdout.push(value) } },
    stderr: { write: value => { stderr.push(value) } },
    runRaw: (io: EidoCliRawIo) => runProfileJsonCli({
      ...io,
      openService: async () => ({ ok: true, value: service }),
    }),
  })
  return {
    exitCode,
    response: stdout.length === 0
      ? ({ version: 1, requestId: null, ok: false, error: {
          code: 'invalid', retryable: false, message: 'No response',
        } } as ProfileGatewayResponse)
      : JSON.parse(stdout.join('')) as ProfileGatewayResponse,
    stderr: stderr.join(''),
  }
}

async function* emptyInput(): AsyncGenerator<Uint8Array> {}

function syntheticSnapshot(): ProfileSnapshot {
  return {
    profileId: 'profile-idea-create',
    revision: 7,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: 'idea-main',
    ideas: [{
      id: 'idea-main',
      name: 'Existing work',
      createdAt: '2026-08-02T00:00:00.000Z',
      updatedAt: '2026-08-02T00:00:00.000Z',
      lastOpenedAt: '2026-08-02T00:00:00.000Z',
    }],
    boards: {
      'idea-main': {
        version: 1,
        cards: [],
        connections: [],
        outputs: [],
        runs: [],
        updatedAt: '2026-08-02T00:00:00.000Z',
      },
    },
    modTemplates: [],
    modInstances: [],
    profileSettings: [],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
}
