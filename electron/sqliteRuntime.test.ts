import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  assertLiveSqliteExclusiveRuntime,
  createSqliteExclusiveRuntimeOpener,
  createSqliteRuntimeOpener,
  openSqliteExclusiveRuntime,
  SQLITE_DATABASE_OPTIONS,
  type SqliteDatabase,
  type SqliteStatement,
} from './sqliteRuntime'

describe('packaged SQLite runtime', () => {
  it('proves exclusive ordering without minting authority from an injected backend', () => {
    const ordered: string[] = []
    let isTransaction = false
    const database = createFakeDatabase({
      exec: (sql) => {
        ordered.push(`exec:${sql.trim()}`)
        if (sql === 'BEGIN EXCLUSIVE') isTransaction = true
        if (sql === 'COMMIT' || sql === 'ROLLBACK') isTransaction = false
      },
      isTransaction: () => isTransaction,
      statement: (sql) => {
        ordered.push(`prepare:${sql}`)
        if (sql.startsWith('PRAGMA locking_mode')) {
          return statement({ locking_mode: 'exclusive' })
        }
        if (sql === 'SELECT 1 AS exclusive_lock_acquired') {
          return statement({ exclusive_lock_acquired: 1 })
        }
        return pragmaStatement(sql)
      },
    })

    const databasePath = path.resolve('owner.sqlite')
    const runtime = createSqliteExclusiveRuntimeOpener({
      openDatabase: () => database,
    })(databasePath)

    expect(ordered.slice(0, 7)).toEqual([
      'prepare:PRAGMA locking_mode = EXCLUSIVE',
      'prepare:PRAGMA locking_mode',
      'exec:BEGIN EXCLUSIVE',
      'prepare:SELECT 1 AS exclusive_lock_acquired',
      'exec:COMMIT',
      'prepare:PRAGMA journal_mode = WAL',
      `exec:PRAGMA synchronous = FULL;
PRAGMA trusted_schema = OFF;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 1000;`,
    ])
    expect(runtime.exclusiveOwnership).toEqual({
      lockingMode: 'exclusive',
      acquisition: 'transactionally-proven',
    })
    expect(() => assertLiveSqliteExclusiveRuntime(runtime, databasePath)).toThrow(
      'SQLite exclusive runtime authority is not live at the expected path',
    )
    runtime.close()
  })

  it('mints path-bound authority only through the native DatabaseSync opener', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'eido-460-native-owner-'))
    const databasePath = path.join(root, 'owner.sqlite')
    const runtime = openSqliteExclusiveRuntime(databasePath)
    try {
      expect(() => assertLiveSqliteExclusiveRuntime(runtime, databasePath)).not.toThrow()
      expect(() => assertLiveSqliteExclusiveRuntime(runtime, path.join(root, 'other.sqlite')))
        .toThrow('SQLite exclusive runtime authority is not live at the expected path')
      expect(() => assertLiveSqliteExclusiveRuntime(
        { ...runtime } as never,
        databasePath,
      )).toThrow('SQLite exclusive runtime authority is not live at the expected path')
      runtime.close()
      expect(() => assertLiveSqliteExclusiveRuntime(runtime, databasePath)).toThrow(
        'SQLite exclusive runtime authority is not live at the expected path',
      )
    } finally {
      runtime.close()
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('recognizes the same native authority through a canonical parent alias', () => {
    const proofRoot = mkdtempSync(path.join(tmpdir(), 'eido-460-native-alias-'))
    const canonicalRoot = path.join(proofRoot, 'canonical')
    const aliasRoot = path.join(proofRoot, 'alias')
    mkdirSync(canonicalRoot)
    symlinkSync(canonicalRoot, aliasRoot, process.platform === 'win32' ? 'junction' : 'dir')
    const aliasPath = path.join(aliasRoot, 'owner.sqlite')
    const canonicalPath = path.join(canonicalRoot, 'owner.sqlite')
    const runtime = openSqliteExclusiveRuntime(aliasPath)
    try {
      expect(() => assertLiveSqliteExclusiveRuntime(runtime, canonicalPath)).not.toThrow()
    } finally {
      runtime.close()
      rmSync(proofRoot, { recursive: true, force: true })
    }
  })

  it('opens the caller path with the locked policy and verifies normalized WAL settings', () => {
    const close = vi.fn()
    const exec = vi.fn()
    const prepare = vi.fn((sql: string) => pragmaStatement(sql))
    const openDatabase = vi.fn(() => ({
      close,
      enableLoadExtension: vi.fn(),
      exec,
      get isTransaction() {
        return false
      },
      prepare,
    } satisfies SqliteDatabase))
    const openSqliteRuntime = createSqliteRuntimeOpener({ openDatabase })
    const databasePath = path.resolve('synthetic', 'proof.sqlite')

    const runtime = openSqliteRuntime(databasePath)

    expect(openDatabase).toHaveBeenCalledWith(
      databasePath,
      SQLITE_DATABASE_OPTIONS,
    )
    expect(exec).toHaveBeenCalledWith(`
PRAGMA synchronous = FULL;
PRAGMA trusted_schema = OFF;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 1000;
`)
    expect(runtime.settings).toEqual({
      journalMode: 'wal',
      synchronous: 'full',
      trustedSchema: false,
      walAutocheckpointPages: 1000,
      foreignKeys: true,
      busyTimeoutMs: 1000,
      doubleQuotedStringLiterals: false,
      extensionLoading: false,
      defensive: true,
    })

    runtime.close()
    runtime.close()
    expect(close).toHaveBeenCalledOnce()
  })

  it('owns immediate transactions, fail-closes async continuations, and normalizes FULL checkpoints', async () => {
    const executed: string[] = []
    let isTransaction = false
    const database = createFakeDatabase({
      exec: (sql) => {
        executed.push(sql)
        if (sql === 'BEGIN IMMEDIATE') isTransaction = true
        if (sql === 'COMMIT' || sql === 'ROLLBACK') isTransaction = false
      },
      isTransaction: () => isTransaction,
      statement: (sql) => {
        if (sql === 'PRAGMA wal_checkpoint(FULL)') {
          return statement({ busy: 0, log: 3, checkpointed: 3 })
        }
        if (sql === 'PRAGMA integrity_check') {
          return statement(undefined, [{ integrity_check: 'ok' }])
        }
        return pragmaStatement(sql)
      },
    })
    const runtime = createSqliteRuntimeOpener({ openDatabase: () => database })(path.resolve('proof.sqlite'))
    executed.length = 0

    expect(runtime.transaction('write', (connection) => {
      connection.exec('INSERT INTO proof VALUES (1)')
      return 'acknowledged'
    })).toBe('acknowledged')
    expect(executed).toEqual(['BEGIN IMMEDIATE', 'INSERT INTO proof VALUES (1)', 'COMMIT'])
    expect(runtime.checkpointFull()).toEqual({ busy: 0, logFrames: 3, checkpointedFrames: 3 })
    expect(runtime.integrityCheck()).toEqual({ ok: true, messages: ['ok'] })

    let continuation: Promise<void> | undefined
    expect(() => runtime.transaction('write', (connection) => {
      continuation = (async () => {
        await Promise.resolve()
        connection.exec('INSERT INTO proof VALUES (2)')
      })()
      return continuation
    })).toThrow(
      'SQLite transactions must complete synchronously',
    )
    expect(executed.slice(-2)).toEqual(['BEGIN IMMEDIATE', 'ROLLBACK'])
    expect(database.close).toHaveBeenCalledOnce()
    expect(() => runtime.exec('INSERT INTO proof VALUES (3)')).toThrow('SQLite runtime is closed')
    await expect(continuation).rejects.toThrow('SQLite runtime is closed')
  })

  it('behaviorally verifies DQS, extension, defensive, and foreign-key locks', () => {
    let writableSchema = 0
    let isTransaction = false
    const database = createFakeDatabase({
      enableLoadExtension: () => {
        throw new Error('extension loading cannot be enabled')
      },
      exec: (sql) => {
        if (sql === 'BEGIN IMMEDIATE') isTransaction = true
        if (sql === 'COMMIT' || sql === 'ROLLBACK') isTransaction = false
        if (sql === 'PRAGMA writable_schema = ON') writableSchema = 0
        if (sql.includes('INSERT INTO eido_sqlite_fk_child')) {
          throw new Error('FOREIGN KEY constraint failed')
        }
      },
      isTransaction: () => isTransaction,
      statement: (sql) => {
        if (sql === 'SELECT "eido_dqs_literal"') return throwingStatement('no such column')
        if (sql.startsWith('SELECT load_extension(')) return throwingStatement('not authorized')
        if (sql === 'PRAGMA writable_schema') return statement({ writable_schema: writableSchema })
        return pragmaStatement(sql)
      },
    })
    const runtime = createSqliteRuntimeOpener({ openDatabase: () => database })(path.resolve('proof.sqlite'))

    expect(runtime.verifySecurityBoundary()).toEqual({
      doubleQuotedStringLiteralsRejected: true,
      extensionLoadingLocked: true,
      writableSchemaLocked: true,
      foreignKeysEnforced: true,
    })
  })
})

function pragmaStatement(sql: string): SqliteStatement {
  const rows: Record<string, unknown> = {
    'PRAGMA journal_mode = WAL': { journal_mode: 'wal' },
    'PRAGMA journal_mode': { journal_mode: 'wal' },
    'PRAGMA synchronous': { synchronous: 2 },
    'PRAGMA trusted_schema': { trusted_schema: 0 },
    'PRAGMA wal_autocheckpoint': { wal_autocheckpoint: 1000 },
    'PRAGMA foreign_keys': { foreign_keys: 1 },
    'PRAGMA busy_timeout': { timeout: 1000 },
  }
  return {
    all: vi.fn(() => []),
    get: vi.fn(() => rows[sql] as never),
    run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
  }
}

function createFakeDatabase({
  enableLoadExtension = vi.fn(),
  exec = vi.fn(),
  isTransaction = () => false,
  statement: prepareStatement = pragmaStatement,
}: {
  enableLoadExtension?: (allow: boolean) => void
  exec?: (sql: string) => void
  isTransaction?: () => boolean
  statement?: (sql: string) => SqliteStatement
} = {}): SqliteDatabase {
  return {
    close: vi.fn(),
    enableLoadExtension,
    exec,
    get isTransaction() {
      return isTransaction()
    },
    prepare: vi.fn(prepareStatement),
  }
}

function statement(row?: Record<string, never> | Record<string, number | string>, rows = row ? [row] : []): SqliteStatement {
  return {
    all: vi.fn(() => rows),
    get: vi.fn(() => row),
    run: vi.fn(() => ({ changes: 0, lastInsertRowid: 0 })),
  }
}

function throwingStatement(message: string): SqliteStatement {
  return {
    all: vi.fn(() => {
      throw new Error(message)
    }),
    get: vi.fn(() => {
      throw new Error(message)
    }),
    run: vi.fn(() => {
      throw new Error(message)
    }),
  }
}
