import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { issueSqliteProfileOwnershipCapability } from './sqliteProfileOwnerCapability'
import { createSqliteProfileRevisionStore } from './sqliteProfileRevisionStore'
import {
  createSqliteRuntimeOpener,
  openSqliteExclusiveRuntime,
  type SqliteDatabase,
} from './sqliteRuntime'
import { createPerfBoard, PERF_BOARD_SIZES, type PerfBoardName } from '../src/graph/perfFixtures'
import {
  GUI_PROFILE_PROJECTION_VERSION,
  mergeGuiProfileProjection,
  type GuiProfileProjectionRequest,
} from '../src/persistence/profileGuiProjection'
import { PROFILE_CONTRACT_VERSIONS, type ProfileSnapshot } from '../src/persistence/profileServiceContract'
import type { SavedBoard } from '../src/graph/types'

// What a checkpoint save actually costs (#1313 follow-up).
//
// Switching Idea, quitting, and updating all take the same path: the renderer
// stops waiting for its quiet window, captures the Board, the owner merges that
// capture into the Profile snapshot, and SQLite commits one revision. This file
// times those stages against a real database on disk so "switching feels slow"
// can be answered with a number instead of an impression.
//
// It is a report, not a gate: no budget is asserted, because the honest
// comparison is between stages and fixtures, not against a target nobody has
// set yet.
//
// The first run found two defects, both since fixed:
//   - The SQLite commit cost ~0.3s at 100 Cards and ~7s at 1,000 Cards even
//     though exactly one record changed, because every commit re-validated and
//     re-projected the whole Profile six to eight times over. It now does that
//     once. Cost still grows with Profile size, because a save still ships and
//     re-derives the whole Board; it no longer grows by a multiple of it.
//   - The 5,000-Card fixture could not be measured at all: its 50,000 intent
//     events exceeded a 250,000-node capture limit, so the save was rejected as
//     invalid before any write happened. That limit is now a runaway guard well
//     above any real Board.
const CASES: PerfBoardName[] = ['smoke', 'medium', 'large']
const WARMUPS = 1
const SAMPLES = 2

describe('installed Profile save cost report', () => {
  it('times the checkpoint save that Idea switching, quitting, and updating wait for', async () => {
    const rows: Record<string, unknown>[] = []

    for (const caseName of CASES) {
      // The fixtures carry explicit `undefined` fields, which the Profile's
      // inert-JSON check rejects. A save from the real app never carries them,
      // so drop them here rather than measuring a shape the app cannot send.
      const board = jsonOnly(createPerfBoard(caseName))
      // Record IDs are globally unique in a Profile, and two fixture Boards
      // would collide, so the second Idea holds a minimal Board of its own.
      const other = otherBoard()
      const captureMs = median(sample(() => {
        JSON.parse(JSON.stringify(board)) as SavedBoard
      }))

      const mergeSamples: number[] = []
      const commitSamples: number[] = []
      const readSamples: number[] = []
      const secondMergeSamples: number[] = []
      const secondCommitSamples: number[] = []
      let databaseBytes = 0
      let changedRecords = 0

      for (let iteration = 0; iteration < WARMUPS + SAMPLES; iteration += 1) {
        const root = mkdtempSync(path.join(tmpdir(), 'eido-save-cost-'))
        try {
          const store = openStore(root, snapshotWith(board, other))
          const current = await store.snapshot()
          if (!current.ok) throw new Error('Profile snapshot is unavailable')

          const edited = editBoard(board)
          const request = saveRequest(current.value, edited, iteration)

          const mergeStart = performance.now()
          const merged = mergeGuiProfileProjection(current.value, request, {
            projectAsset: () => {
              throw new Error('Benchmark boards carry no assets')
            },
            materializeUserModTemplate: () => {
              throw new Error('Benchmark boards carry no Mod templates')
            },
            materializeNewModInstance: () => {
              throw new Error('Benchmark boards carry no new Mods')
            },
          })
          const mergeMs = performance.now() - mergeStart

          const commitStart = performance.now()
          const committed = await store.commitGuiProjectionRevision({
            request,
            candidate: merged.logicalDocument,
          })
          const commitMs = performance.now() - commitStart
          if (!committed.ok) throw new Error(`Profile commit failed: ${committed.code}`)

          // What the other Idea costs to reach after the save lands: the owner
          // re-reads the Profile and the renderer hydrates the new Board.
          const readStart = performance.now()
          const reread = await store.snapshot()
          const readMs = performance.now() - readStart
          if (!reread.ok) throw new Error('Profile re-read failed')

          // A second save on the same open Profile: what every later
          // checkpoint costs once the database is warm.
          const secondCurrent = await store.snapshot()
          if (!secondCurrent.ok) throw new Error('Profile snapshot is unavailable')
          const secondRequest = saveRequest(
            secondCurrent.value,
            editBoard(editBoard(board)),
            iteration + 1000,
          )
          const secondMergeStart = performance.now()
          const secondMerged = mergeGuiProfileProjection(secondCurrent.value, secondRequest, {
            projectAsset: () => {
              throw new Error('Benchmark boards carry no assets')
            },
            materializeUserModTemplate: () => {
              throw new Error('Benchmark boards carry no Mod templates')
            },
            materializeNewModInstance: () => {
              throw new Error('Benchmark boards carry no new Mods')
            },
          })
          const secondMergeMs = performance.now() - secondMergeStart
          const secondCommitStart = performance.now()
          const secondCommitted = await store.commitGuiProjectionRevision({
            request: secondRequest,
            candidate: secondMerged.logicalDocument,
          })
          const secondCommitMs = performance.now() - secondCommitStart
          if (!secondCommitted.ok) throw new Error('Second Profile commit failed')
          changedRecords = secondCommitted.value.changedRecordIds.length

          if (iteration >= WARMUPS) {
            secondMergeSamples.push(secondMergeMs)
            secondCommitSamples.push(secondCommitMs)
            mergeSamples.push(mergeMs)
            commitSamples.push(commitMs)
            readSamples.push(readMs)
          }
          databaseBytes = statSync(path.join(root, 'profile.sqlite')).size
          store.close()
        } finally {
          rmSync(root, { recursive: true, force: true })
        }
      }

      const mergeMs = median(mergeSamples)
      const commitMs = median(commitSamples)
      const readMs = median(readSamples)
      rows.push({
        fixture: caseName,
        cards: PERF_BOARD_SIZES[caseName].cards,
        events: PERF_BOARD_SIZES[caseName].timelineEvents,
        captureMs: format(captureMs),
        mergeMs: format(mergeMs),
        commitMs: format(commitMs),
        saveTotalMs: format(captureMs + mergeMs + commitMs),
        warmMergeMs: format(median(secondMergeSamples)),
        warmCommitMs: format(median(secondCommitSamples)),
        changedRecords,
        readSnapshotMs: format(readMs),
        databaseMb: (databaseBytes / (1024 * 1024)).toFixed(1),
      })
    }

    console.log('\nInstalled Profile checkpoint save cost')
    console.table(rows)
    expect(rows).toHaveLength(CASES.length)
  }, 600_000)
})

function openStore(root: string, seed: ProfileSnapshot) {
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
  'owner-save-cost', '2026-08-27T00:00:00.000Z'
);
`)
  return createSqliteProfileRevisionStore({
    databasePath,
    ownershipCapability: issueSqliteProfileOwnershipCapability({
      profileDatabasePath: databasePath,
      sidecarPath,
      sidecarRuntime: sidecar,
    }),
    seed,
    openRuntime: createSqliteRuntimeOpener({
      openDatabase: (location) => new DatabaseSync(location) as unknown as SqliteDatabase,
    }),
    now: () => '2026-08-27T00:00:01.000Z',
  })
}

function snapshotWith(active: SavedBoard, inactive: SavedBoard): ProfileSnapshot {
  return {
    profileId: 'profile-save-cost',
    revision: 1,
    versions: PROFILE_CONTRACT_VERSIONS,
    activeIdeaId: 'idea-active',
    ideas: [idea('idea-active', 'Active'), idea('idea-other', 'Other')],
    boards: { 'idea-active': active, 'idea-other': inactive },
    modTemplates: [],
    modInstances: [],
    profileSettings: [],
    migrationLedger: [],
    recoveryPoints: [],
    compatibility: { read: 'supported', write: 'supported', source: 'friends-alpha' },
  }
}

function otherBoard(): SavedBoard {
  return {
    version: 1,
    cards: [{
      id: 'card-other-idea',
      kind: 'note',
      position: { x: 100, y: 100 },
      blocks: [{ id: 'block-other-idea', text: 'Second Idea', kind: 'line' }],
    }],
    connections: [],
    outputs: [],
    runs: [],
    updatedAt: '2026-08-27T00:00:00.000Z',
  } as unknown as SavedBoard
}

function idea(id: string, name: string) {
  return {
    id,
    name,
    createdAt: '2026-08-27T00:00:00.000Z',
    updatedAt: '2026-08-27T00:00:00.000Z',
    lastOpenedAt: '2026-08-27T00:00:00.000Z',
  }
}

// One typed character on one Card: the smallest edit a checkpoint can carry.
function editBoard(board: SavedBoard): SavedBoard {
  const [first, ...rest] = board.cards
  if (!first) throw new Error('Benchmark board has no Cards')
  return {
    ...board,
    cards: [
      { ...first, blocks: [{ ...first.blocks[0]!, text: `${first.blocks[0]!.text}!` }] },
      ...rest,
    ],
  }
}

function saveRequest(
  current: ProfileSnapshot,
  edited: SavedBoard,
  iteration: number,
): GuiProfileProjectionRequest {
  return {
    generation: 1,
    expectedRevision: current.revision,
    clientTxnId: `save-cost-txn-${iteration}`,
    idempotencyKey: `save-cost-key-${iteration}`,
    committedAt: '2026-08-27T00:00:02.000Z',
    context: { trustedActorId: 'actor-save-cost', ordinaryNewIdeas: [] },
    projection: {
      projectionVersion: GUI_PROFILE_PROJECTION_VERSION,
      profileId: current.profileId,
      activeIdeaId: current.activeIdeaId,
      ideas: current.ideas,
      boardReplacements: { 'idea-active': edited },
      userModTemplates: [],
      profileSettings: [],
      newModOrigins: {},
    },
  }
}

function jsonOnly(board: SavedBoard): SavedBoard {
  const plain = JSON.parse(JSON.stringify(board)) as SavedBoard
  // Mod Cards need matching Mod instance records in the seeded Profile, which
  // the Board fixtures do not carry. They are a small share of the payload, so
  // drop them rather than hand-build owner records the benchmark never times.
  return {
    ...plain,
    cards: plain.cards.map(({ modV2: _modV2, ...card }) => card),
  }
}

function sample(work: () => void): number[] {
  const samples: number[] = []
  for (let iteration = 0; iteration < WARMUPS + SAMPLES; iteration += 1) {
    const start = performance.now()
    work()
    if (iteration >= WARMUPS) samples.push(performance.now() - start)
  }
  return samples
}

function median(samples: number[]): number {
  const sorted = [...samples].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? Number.NaN
}

function format(value: number): string {
  return value.toFixed(1)
}
