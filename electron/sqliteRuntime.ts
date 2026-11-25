import { realpathSync } from 'node:fs'
import { backup, DatabaseSync } from 'node:sqlite'
import path from 'node:path'

export type SqliteInput = null | number | bigint | string | Uint8Array
export type SqliteOutput = SqliteInput
export type SqliteRow = Readonly<Record<string, SqliteOutput>>

export type SqliteRunResult = Readonly<{
  changes: number | bigint
  lastInsertRowid: number | bigint
}>

export type SqliteStatement = {
  all: (...parameters: SqliteInput[]) => SqliteRow[]
  get: (...parameters: SqliteInput[]) => SqliteRow | undefined
  run: (...parameters: SqliteInput[]) => SqliteRunResult
}

export type SqliteDatabase = {
  close: () => void
  enableLoadExtension: (allow: boolean) => void
  exec: (sql: string) => void
  readonly isTransaction: boolean
  prepare: (sql: string) => SqliteStatement
}

export const SQLITE_DATABASE_OPTIONS = Object.freeze({
  enableForeignKeyConstraints: true,
  enableDoubleQuotedStringLiterals: false,
  allowExtension: false,
  timeout: 1000,
  defensive: true,
})

export type SqliteRuntimeSettings = Readonly<{
  journalMode: 'wal'
  synchronous: 'full'
  trustedSchema: false
  walAutocheckpointPages: 1000
  foreignKeys: true
  busyTimeoutMs: 0 | 1000
  doubleQuotedStringLiterals: false
  extensionLoading: false
  defensive: true
}>

export type SqliteCheckpointResult = Readonly<{
  busy: number
  logFrames: number
  checkpointedFrames: number
}>

export type SqliteIntegrityResult = Readonly<{
  ok: boolean
  messages: readonly string[]
}>

export type SqliteSecurityBoundary = Readonly<{
  doubleQuotedStringLiteralsRejected: true
  extensionLoadingLocked: true
  writableSchemaLocked: true
  foreignKeysEnforced: true
}>

export type SqliteRuntime = {
  readonly settings: SqliteRuntimeSettings
  prepare: (sql: string) => SqliteStatement
  exec: (sql: string) => void
  transaction: <Result>(
    mode: 'read' | 'write',
    operation: (connection: SqliteRuntime) => Result,
  ) => Result
  checkpointFull: () => SqliteCheckpointResult
  integrityCheck: () => SqliteIntegrityResult
  verifySecurityBoundary: () => SqliteSecurityBoundary
  backupTo: (destinationPath: string) => Promise<number>
  close: () => void
}

export type SqliteExclusiveRuntime = SqliteRuntime & {
  readonly exclusiveOwnership: Readonly<{
    lockingMode: 'exclusive'
    acquisition: 'transactionally-proven'
  }>
}

type SqliteRuntimeDependencies = {
  openDatabase: (location: string, options: SqliteDatabaseOptions) => SqliteDatabase
}

type SqliteDatabaseOptions = Omit<typeof SQLITE_DATABASE_OPTIONS, 'timeout'> & Readonly<{
  timeout: 0 | 1000
}>

const exclusiveRuntimeStates = new WeakMap<
  SqliteExclusiveRuntime,
  Readonly<{ location: string; isClosed: () => boolean }>
>()

function configurePragmas(busyTimeoutMs: 0 | 1000): string {
  return `
PRAGMA synchronous = FULL;
PRAGMA trusted_schema = OFF;
PRAGMA wal_autocheckpoint = 1000;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = ${busyTimeoutMs};
`
}

export function createSqliteRuntimeOpener({
  openDatabase,
}: SqliteRuntimeDependencies, {
  busyTimeoutMs = 1000,
}: Readonly<{ busyTimeoutMs?: 0 | 1000 }> = {}): (location: string) => SqliteRuntime {
  return function openSqliteRuntime(location) {
    return openConfiguredSqliteRuntime(location, openDatabase, false, false, busyTimeoutMs)
  }
}

export function createSqliteExclusiveRuntimeOpener({
  openDatabase,
}: SqliteRuntimeDependencies): (location: string) => SqliteExclusiveRuntime {
  return function openSqliteExclusiveRuntime(location) {
    return openConfiguredSqliteRuntime(location, openDatabase, true, false) as SqliteExclusiveRuntime
  }
}

export function assertLiveSqliteExclusiveRuntime(
  runtime: SqliteExclusiveRuntime,
  expectedLocation: string,
): void {
  const state = exclusiveRuntimeStates.get(runtime)
  if (
    !state
    || state.isClosed()
    || state.location !== canonicalizeDatabaseLocation(expectedLocation)
  ) throw new Error('SQLite exclusive runtime authority is not live at the expected path')
  expectText(runtime.prepare('PRAGMA locking_mode').get(), 'locking_mode', 'exclusive')
}

function openConfiguredSqliteRuntime(
  location: string,
  openDatabase: SqliteRuntimeDependencies['openDatabase'],
  exclusiveOwnership: boolean,
  authenticateExclusiveAuthority = false,
  busyTimeoutMs: 0 | 1000 = 1000,
): SqliteRuntime | SqliteExclusiveRuntime {
    if (!path.isAbsolute(location) || location.includes('\0')) {
      throw new Error('SQLite database path must be absolute')
    }
    const database = openDatabase(location, { ...SQLITE_DATABASE_OPTIONS, timeout: busyTimeoutMs })
    try {
      if (exclusiveOwnership) acquireExclusiveOwnership(database)
      expectText(database.prepare('PRAGMA journal_mode = WAL').get(), 'journal_mode', 'wal')
      database.exec(configurePragmas(busyTimeoutMs))
      const settings = readAndVerifySettings(database, busyTimeoutMs)
      let closed = false
      const assertOpen = () => {
        if (closed) throw new Error('SQLite runtime is closed')
      }
      const runtime: SqliteRuntime | SqliteExclusiveRuntime = {
        settings,
        ...(exclusiveOwnership ? {
          exclusiveOwnership: Object.freeze({
            lockingMode: 'exclusive' as const,
            acquisition: 'transactionally-proven' as const,
          }),
        } : {}),
        prepare: (sql) => {
          assertOpen()
          return narrowStatement(database.prepare(sql))
        },
        exec: (sql) => {
          assertOpen()
          database.exec(sql)
        },
        transaction: (mode, operation) => {
          assertOpen()
          database.exec(mode === 'write' ? 'BEGIN IMMEDIATE' : 'BEGIN')
          let asynchronousResult: PromiseLike<unknown> | undefined
          try {
            const result = operation(runtime)
            if (isThenable(result)) {
              asynchronousResult = result
              throw new Error('SQLite transactions must complete synchronously')
            }
            database.exec('COMMIT')
            return result
          } catch (error) {
            if (asynchronousResult) {
              void Promise.resolve(asynchronousResult).catch(() => undefined)
              closed = true
              rollback(database, error, true)
            }
            rollback(database, error, false)
          }
        },
        checkpointFull: () => {
          assertOpen()
          return normalizeCheckpoint(database.prepare('PRAGMA wal_checkpoint(FULL)').get())
        },
        integrityCheck: () => {
          assertOpen()
          return normalizeIntegrity(database.prepare('PRAGMA integrity_check').all())
        },
        verifySecurityBoundary: () => {
          assertOpen()
          return verifySecurityBoundary(runtime, database)
        },
        backupTo: (destinationPath) => {
          assertOpen()
          if (!path.isAbsolute(destinationPath) || destinationPath.includes('\0')) {
            return Promise.reject(new Error('SQLite backup path must be absolute'))
          }
          return backup(database as DatabaseSync, destinationPath)
        },
        close: () => {
          if (closed) return
          database.close()
          closed = true
        },
      }
      const frozenRuntime = Object.freeze(runtime)
      if (authenticateExclusiveAuthority) {
        exclusiveRuntimeStates.set(frozenRuntime as SqliteExclusiveRuntime, {
          location: canonicalizeDatabaseLocation(location),
          isClosed: () => closed,
        })
      }
      return frozenRuntime
    } catch (error) {
      database.close()
      throw error
    }
}

function canonicalizeDatabaseLocation(location: string): string {
  const resolved = path.resolve(location)
  return path.join(realpathSync.native(path.dirname(resolved)), path.basename(resolved))
}

function acquireExclusiveOwnership(database: SqliteDatabase): void {
  expectText(
    database.prepare('PRAGMA locking_mode = EXCLUSIVE').get(),
    'locking_mode',
    'exclusive',
  )
  expectText(database.prepare('PRAGMA locking_mode').get(), 'locking_mode', 'exclusive')
  database.exec('BEGIN EXCLUSIVE')
  try {
    expectInteger(
      database.prepare('SELECT 1 AS exclusive_lock_acquired').get(),
      'exclusive_lock_acquired',
      1,
    )
    database.exec('COMMIT')
  } catch (error) {
    rollback(database, error, false)
  }
}

function narrowStatement(statement: SqliteStatement): SqliteStatement {
  return Object.freeze({
    all: (...parameters) => statement.all(...parameters),
    get: (...parameters) => statement.get(...parameters),
    run: (...parameters) => statement.run(...parameters),
  })
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    (typeof value === 'object' && value !== null) || typeof value === 'function'
  ) && 'then' in value && typeof value.then === 'function'
}

function rollback(
  database: SqliteDatabase,
  originalError: unknown,
  closeDatabase: boolean,
): never {
  const cleanupErrors = [originalError]
  if (database.isTransaction) {
    try {
      database.exec('ROLLBACK')
    } catch (rollbackError) {
      cleanupErrors.push(rollbackError)
    }
  }
  if (closeDatabase) {
    try {
      database.close()
    } catch (closeError) {
      cleanupErrors.push(closeError)
    }
  }
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, 'SQLite transaction cleanup failed')
  }
  throw originalError
}

function normalizeCheckpoint(row: unknown): SqliteCheckpointResult {
  const values = Array.isArray(row)
    ? row
    : [readUnknownColumn(row, 'busy'), readUnknownColumn(row, 'log'), readUnknownColumn(row, 'checkpointed')]
  if (values.length < 3) throw new Error('SQLite FULL checkpoint returned invalid evidence')
  return Object.freeze({
    busy: requireNonNegativeInteger(values[0], 'busy'),
    logFrames: requireNonNegativeInteger(values[1], 'log'),
    checkpointedFrames: requireNonNegativeInteger(values[2], 'checkpointed'),
  })
}

function normalizeIntegrity(rows: readonly unknown[]): SqliteIntegrityResult {
  const messages = rows.map((row) => {
    const value = readUnknownColumn(row, 'integrity_check')
    if (typeof value !== 'string' || value.trim() === '') {
      throw new Error('SQLite integrity check returned invalid evidence')
    }
    return value
  })
  return Object.freeze({
    ok: messages.length === 1 && messages[0].toLowerCase() === 'ok',
    messages: Object.freeze(messages),
  })
}

function verifySecurityBoundary(
  runtime: SqliteRuntime,
  database: SqliteDatabase,
): SqliteSecurityBoundary {
  expectRejected(
    () => database.prepare('SELECT "eido_dqs_literal"').get(),
    'double-quoted string literals',
  )

  let extensionEnableRejected = false
  try {
    database.enableLoadExtension(true)
  } catch {
    extensionEnableRejected = true
  }
  if (!extensionEnableRejected) {
    database.enableLoadExtension(false)
    throw new Error('SQLite extension loading could be re-enabled')
  }
  expectRejected(
    () => database.prepare("SELECT load_extension('eido-proof-missing')").get(),
    'extension loading',
  )

  try {
    database.exec('PRAGMA writable_schema = ON')
  } catch {
    // Defensive mode may reject the write directly; readback below remains authoritative.
  }
  const writableSchema = readUnknownColumn(
    database.prepare('PRAGMA writable_schema').get(),
    'writable_schema',
  )
  if (writableSchema !== 0 && writableSchema !== 0n) {
    database.exec('PRAGMA writable_schema = OFF')
    throw new Error('SQLite writable_schema escaped defensive mode')
  }

  const rollbackSignal = new Error('rollback SQLite foreign-key proof')
  let foreignKeysEnforced = false
  try {
    runtime.transaction('write', (connection) => {
      connection.exec('CREATE TABLE eido_sqlite_fk_parent (id INTEGER PRIMARY KEY)')
      connection.exec(`
CREATE TABLE eido_sqlite_fk_child (
  parent_id INTEGER NOT NULL REFERENCES eido_sqlite_fk_parent(id)
)
`)
      try {
        connection.exec('INSERT INTO eido_sqlite_fk_child (parent_id) VALUES (1)')
      } catch {
        foreignKeysEnforced = true
      }
      throw rollbackSignal
    })
  } catch (error) {
    if (error !== rollbackSignal) throw error
  }
  if (!foreignKeysEnforced) throw new Error('SQLite foreign-key enforcement is unavailable')

  return Object.freeze({
    doubleQuotedStringLiteralsRejected: true,
    extensionLoadingLocked: true,
    writableSchemaLocked: true,
    foreignKeysEnforced: true,
  })
}

function expectRejected(operation: () => unknown, policy: string): void {
  try {
    operation()
  } catch {
    return
  }
  throw new Error(`SQLite ${policy} policy was not enforced`)
}

function requireNonNegativeInteger(value: unknown, field: string): number {
  const normalized = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isSafeInteger(normalized) || Number(normalized) < 0) {
    throw new Error(`SQLite checkpoint ${field} was invalid`)
  }
  return Number(normalized)
}

function readUnknownColumn(row: unknown, key: string): unknown {
  if (!row || typeof row !== 'object' || !(key in row)) return undefined
  return (row as Record<string, unknown>)[key]
}

function readAndVerifySettings(
  database: SqliteDatabase,
  busyTimeoutMs: 0 | 1000,
): SqliteRuntimeSettings {
  expectText(database.prepare('PRAGMA journal_mode').get(), 'journal_mode', 'wal')
  expectInteger(database.prepare('PRAGMA synchronous').get(), 'synchronous', 2)
  expectInteger(database.prepare('PRAGMA trusted_schema').get(), 'trusted_schema', 0)
  expectInteger(database.prepare('PRAGMA wal_autocheckpoint').get(), 'wal_autocheckpoint', 1000)
  expectInteger(database.prepare('PRAGMA foreign_keys').get(), 'foreign_keys', 1)
  expectInteger(database.prepare('PRAGMA busy_timeout').get(), 'timeout', busyTimeoutMs)
  return Object.freeze({
    journalMode: 'wal',
    synchronous: 'full',
    trustedSchema: false,
    walAutocheckpointPages: 1000,
    foreignKeys: true,
    busyTimeoutMs,
    doubleQuotedStringLiterals: false,
    extensionLoading: false,
    defensive: true,
  })
}

function expectText(row: SqliteRow | undefined, key: string, expected: string): void {
  const actual = readColumn(row, key)
  if (typeof actual !== 'string' || actual.toLowerCase() !== expected) {
    throw new Error(`SQLite ${key} policy mismatch`)
  }
}

function expectInteger(row: SqliteRow | undefined, key: string, expected: number): void {
  const actual = readColumn(row, key)
  if (actual !== expected && actual !== BigInt(expected)) {
    throw new Error(`SQLite ${key} policy mismatch`)
  }
}

function readColumn(row: SqliteRow | undefined, key: string): SqliteOutput | undefined {
  if (!row || !(key in row)) return undefined
  return row[key]
}

export const openSqliteRuntime = createSqliteRuntimeOpener({
  openDatabase: (location, options) => new DatabaseSync(location, options),
})

// Small device-local registries used from Electron main must fail immediately
// on contention instead of applying the Profile owner's one-second busy wait.
export const openNoWaitSqliteRuntime = createSqliteRuntimeOpener({
  openDatabase: (location, options) => new DatabaseSync(location, options),
}, { busyTimeoutMs: 0 })

export function openSqliteExclusiveRuntime(location: string): SqliteExclusiveRuntime {
  return openConfiguredSqliteRuntime(
    location,
    (databasePath, options) => new DatabaseSync(databasePath, options),
    true,
    true,
  ) as SqliteExclusiveRuntime
}
