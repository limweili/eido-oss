import { DatabaseSync } from 'node:sqlite'
import { PROFILE_AUTHORITY_INSTALLED, type RuntimeProbeResult } from './runtimeProbeContract'

type RuntimeVersions = {
  chrome?: string
  electron?: string
  node?: string
}

type SqliteStatement = {
  get: () => unknown
}

type SqliteDatabase = {
  close: () => void
  prepare: (sql: string) => SqliteStatement
}

type RuntimeProbeDependencies = {
  openDatabase: (location: ':memory:') => SqliteDatabase
  versions: RuntimeVersions
}

export function createRuntimeProbe({ openDatabase, versions }: RuntimeProbeDependencies): () => RuntimeProbeResult {
  return function runtimeProbe() {
    const database = openDatabase(':memory:')
    try {
      const row = database.prepare('SELECT sqlite_version() AS sqliteVersion').get()
      const sqliteVersion = readVersion(row, 'sqliteVersion')
      return {
        chromium: requireVersion(versions.chrome, 'Chromium'),
        electron: requireVersion(versions.electron, 'Electron'),
        node: requireVersion(versions.node, 'Node'),
        profileAuthority: PROFILE_AUTHORITY_INSTALLED,
        sqlite: sqliteVersion,
      }
    } finally {
      database.close()
    }
  }
}

function readVersion(row: unknown, key: string): string {
  if (!row || typeof row !== 'object') throw new Error(`Embedded SQLite did not return ${key}`)
  if (!(key in row)) throw new Error(`Embedded SQLite did not return ${key}`)
  return requireVersion((row as Record<string, unknown>)[key], 'SQLite')
}

function requireVersion(value: unknown, runtime: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${runtime} runtime version is unavailable`)
  }
  return value
}

export const probeEmbeddedRuntime = createRuntimeProbe({
  openDatabase: (location) => new DatabaseSync(location),
  versions: process.versions as RuntimeVersions,
})
