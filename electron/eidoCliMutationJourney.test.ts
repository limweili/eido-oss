import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { ProfileGatewayResponse, ProfileGatewaySessionService } from '../src/persistence/profileAgentGateway'
import { PROFILE_CONTRACT_VERSIONS, type ProfileSnapshot } from '../src/persistence/profileServiceContract'
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

const TEXT_ALIAS_NOTICE = '--text is a deprecated alias for --body and will be removed. Use --body.\n'

describe('eido mutation journey (#714)', () => {
  it('runs dry-run, apply, stale rejection, exact replay, and final inspection through verbs', async () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eido-714-cli-journey-'))
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
  'owner-eido-714', '2026-07-22T00:00:00.000Z'
);
`)
    const ownershipCapability = issueSqliteProfileOwnershipCapability({
      profileDatabasePath: databasePath,
      sidecarPath,
      sidecarRuntime: sidecar,
    })
    let clientTxnSequence = 0
    let intentEventSequence = 0
    const store = createSqliteProfileRevisionStore({
      databasePath,
      ownershipCapability,
      seed: syntheticSnapshot(),
      openRuntime: openTestRuntime,
      agentCommandSurfaceVersion: 5,
      agentActor: { client: 'eido-cli', sessionId: 'session-eido-714' },
      now: () => '2026-07-22T00:00:01.000Z',
      // ADRs 0029/0030 keep this identity owner-minted after trusted transport admission.
      createAgentClientTxnId: () => `owner-client-txn-${++clientTxnSequence}`,
      createIntentEventId: () => `intent-eido-714-${++intentEventSequence}`,
    })
    const service: ProfileGatewaySessionService = {
      status: () => store.status(),
      capabilities: () => store.capabilities(),
      query: request => store.query(request),
      applyAgentCommandBatch: request => store.applyAgentCommandBatch(request, 'cli'),
      close: async () => undefined,
    }

    try {
      const commonCreate = [
        'card', 'create',
        '--idea', 'idea-main',
        '--kind', 'note',
        '--x', '420',
        '--y', '180',
        '--text', 'Created through eido verbs',
        '--expected-revision', '7',
        '--idempotency-key', 'journey-card-create',
      ]
      const dryRun = await invokeVerb([...commonCreate, '--dry-run'], 'request-dry-run', service)
      expect(dryRun).toMatchObject({
        exitCode: 0,
        response: {
          ok: true,
          result: {
            previousRevision: 7,
            revision: 7,
            proposedRevision: 8,
            commitId: null,
            dryRun: true,
            replayed: false,
          },
        },
        stderr: TEXT_ALIAS_NOTICE,
      })

      const applied = await invokeVerb([...commonCreate, '--apply'], 'request-apply', service)
      expect(applied).toMatchObject({
        exitCode: 0,
        response: {
          ok: true,
          result: {
            previousRevision: 7,
            revision: 8,
            proposedRevision: 8,
            commitId: 'agent:owner-client-txn-1',
            dryRun: false,
            replayed: false,
          },
        },
        stderr: TEXT_ALIAS_NOTICE,
      })
      if (!applied.response.ok) throw new Error('Synthetic mutation did not apply')
      const appliedResult = applied.response.result as {
        commandResults?: Array<{ cardId?: string; blockId?: string }>
        commitId?: string | null
      }
      const cardId = appliedResult.commandResults?.[0]?.cardId
      const blockId = appliedResult.commandResults?.[0]?.blockId
      if (!cardId || !blockId) throw new Error('Synthetic mutation did not return Card identity')

      const stale = await invokeVerb([
        'card', 'update', cardId,
        '--idea', 'idea-main',
        '--block', blockId,
        '--text', 'Stale update must not land',
        '--expected-revision', '7',
        '--apply',
        '--idempotency-key', 'journey-stale-update',
      ], 'request-stale', service)
      expect(stale).toMatchObject({
        exitCode: 4,
        response: {
          requestId: 'request-stale',
          ok: false,
          error: { code: 'conflict', currentRevision: 8 },
        },
        stderr: `${TEXT_ALIAS_NOTICE}Eido Profile inspection failed (conflict).\n`,
      })

      const replayed = await invokeVerb([...commonCreate, '--apply'], 'request-replay', service)
      expect(replayed).toMatchObject({
        exitCode: 0,
        response: {
          ok: true,
          result: {
            revision: 8,
            commitId: appliedResult.commitId,
            replayed: true,
          },
        },
        stderr: TEXT_ALIAS_NOTICE,
      })

      const inspected = await invokeVerb([
        'record', 'get', `eido://app/?idea=idea-main&card=${cardId}&x=1&y=2&zoom=3`,
      ], 'request-inspect', service)
      expect(inspected).toMatchObject({
        exitCode: 0,
        response: {
          ok: true,
          result: {
            revision: 8,
            items: [{
              recordId: cardId,
              kind: 'card',
              payload: {
                id: cardId,
                kind: 'note',
                createdBy: { kind: 'agent', client: 'eido-cli', sessionId: 'session-eido-714' },
                lastModifiedBy: { kind: 'agent', client: 'eido-cli', sessionId: 'session-eido-714' },
              },
            }],
          },
        },
        stderr: '',
      })
    } finally {
      store.close()
      sidecar.close()
      const expectedPrefix = path.join(tmpdir(), 'eido-714-cli-journey-')
      if (!root.startsWith(expectedPrefix)) throw new Error('Refusing to remove an unexpected test root')
      rmSync(root, { recursive: true, force: true })
    }
  })
})

async function invokeVerb(
  argv: readonly string[],
  requestId: string,
  service: ProfileGatewaySessionService,
): Promise<Readonly<{ exitCode: number; response: ProfileGatewayResponse; stderr: string }>> {
  const stdout: string[] = []
  const stderr: string[] = []
  const mutation = argv[0] === 'card' || argv[0] === 'connection'
  const exitCode = await runEidoCli({
    argv: mutation ? [...argv, '--request-id', requestId] : argv,
    createRequestId: () => requestId,
    describeGateway: () => { throw new Error('Mutation journey requested discovery') },
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
    response: JSON.parse(stdout.join('')) as ProfileGatewayResponse,
    stderr: stderr.join(''),
  }
}

async function* emptyInput(): AsyncGenerator<Uint8Array> {}

function syntheticSnapshot(): ProfileSnapshot {
  return {
    profileId: 'profile-eido-714',
    revision: 7,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: 'idea-main',
    ideas: [{
      id: 'idea-main',
      name: 'Synthetic CLI Journey',
      createdAt: '2026-07-22T00:00:00.000Z',
      updatedAt: '2026-07-22T00:00:00.000Z',
      lastOpenedAt: '2026-07-22T00:00:00.000Z',
    }],
    boards: {
      'idea-main': {
        version: 1,
        cards: [{
          id: 'card-seed',
          kind: 'note',
          position: { x: 100, y: 100 },
          blocks: [{ id: 'block-seed', text: 'Synthetic seed', kind: 'line' }],
        }],
        connections: [],
        outputs: [],
        runs: [],
        updatedAt: '2026-07-22T00:00:00.000Z',
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
