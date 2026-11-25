import { randomUUID } from 'node:crypto'
import { chmodSync, mkdirSync } from 'node:fs'
import { realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { localHtmlPathFromClipboardText } from '../src/shared/linkPreview'
import type { LocalHtmlPreviewSource } from './linkPreviewContract'
import { openNoWaitSqliteRuntime, type SqliteRuntime } from './sqliteRuntime'

const DEFAULT_MAX_SOURCE_BYTES = 20_000_000

export type ResolvedLocalHtmlPreviewSource = Readonly<{
  source: LocalHtmlPreviewSource
  path: string
  size: number
  modifiedAtMs: number
}>

export type LocalHtmlPreviewSourceStore = Readonly<{
  recognize(clipboardText: string): Promise<LocalHtmlPreviewSource | null>
  resolve(sourceId: string): Promise<ResolvedLocalHtmlPreviewSource | null>
  close(): void
}>

export function createLocalHtmlPreviewSourceStore({
  userDataRoot,
  createId = () => `local-${randomUUID()}`,
  now = () => new Date().toISOString(),
  maxSourceBytes = DEFAULT_MAX_SOURCE_BYTES,
  openRuntime = openNoWaitSqliteRuntime,
}: Readonly<{
  userDataRoot: string
  createId?: () => string
  now?: () => string
  maxSourceBytes?: number
  openRuntime?: (databasePath: string) => SqliteRuntime
}>): LocalHtmlPreviewSourceStore {
  if (!path.isAbsolute(userDataRoot) || userDataRoot.includes('\0')) {
    throw new Error('Local HTML preview root is invalid')
  }
  if (!Number.isSafeInteger(maxSourceBytes) || maxSourceBytes <= 0) {
    throw new Error('Local HTML preview source limit is invalid')
  }
  const directory = path.join(path.normalize(userDataRoot), 'local-previews')
  const databasePath = path.join(directory, 'local-html-sources.sqlite')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const runtime = openRuntime(databasePath)
  chmodSync(databasePath, 0o600)
  runtime.exec(`
CREATE TABLE IF NOT EXISTS local_html_sources (
  source_id TEXT PRIMARY KEY,
  canonical_path TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  observed_size INTEGER NOT NULL CHECK (observed_size >= 0),
  observed_mtime_ms REAL NOT NULL CHECK (observed_mtime_ms >= 0),
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
`)

  const store: LocalHtmlPreviewSourceStore = Object.freeze({
    async recognize(clipboardText) {
      const candidate = localHtmlPathFromClipboardText(clipboardText)
      if (!candidate) return null
      const inspected = await inspect(candidate, maxSourceBytes)
      if (!inspected) return null
      const observedAt = now()
      const existing = runtime.prepare(`
SELECT source_id, display_name
FROM local_html_sources
WHERE canonical_path = ?
`).get(inspected.path)
      if (typeof existing?.source_id === 'string' && typeof existing.display_name === 'string') {
        runtime.prepare(`
UPDATE local_html_sources
SET observed_size = ?, observed_mtime_ms = ?, last_seen_at = ?
WHERE source_id = ?
`).run(inspected.size, inspected.modifiedAtMs, observedAt, existing.source_id)
        return Object.freeze({ id: existing.source_id, name: existing.display_name })
      }
      const source = Object.freeze({ id: createId(), name: path.basename(inspected.path) })
      if (!validSource(source)) throw new Error('Local HTML preview source identity is invalid')
      runtime.prepare(`
INSERT INTO local_html_sources (
  source_id, canonical_path, display_name, observed_size, observed_mtime_ms, created_at, last_seen_at
) VALUES (?, ?, ?, ?, ?, ?, ?)
`).run(
        source.id,
        inspected.path,
        source.name,
        inspected.size,
        inspected.modifiedAtMs,
        observedAt,
        observedAt,
      )
      return source
    },
    async resolve(sourceId) {
      if (!/^[a-z\d_-]{1,128}$/i.test(sourceId)) return null
      const row = runtime.prepare(`
SELECT canonical_path, display_name
FROM local_html_sources
WHERE source_id = ?
`).get(sourceId)
      if (typeof row?.canonical_path !== 'string' || typeof row.display_name !== 'string') return null
      const inspected = await inspect(row.canonical_path, maxSourceBytes)
      if (!inspected || inspected.path !== row.canonical_path) return null
      return Object.freeze({
        source: Object.freeze({ id: sourceId, name: row.display_name }),
        path: inspected.path,
        size: inspected.size,
        modifiedAtMs: inspected.modifiedAtMs,
      })
    },
    close() {
      runtime.close()
    },
  })
  return store
}

async function inspect(candidate: string, maxSourceBytes: number): Promise<Readonly<{
  path: string
  size: number
  modifiedAtMs: number
}> | null> {
  try {
    const canonicalPath = await realpath(candidate)
    if (!path.isAbsolute(canonicalPath) || !/\.html?$/i.test(canonicalPath)) return null
    const details = await stat(canonicalPath)
    if (!details.isFile() || details.size > maxSourceBytes) return null
    return Object.freeze({
      path: canonicalPath,
      size: details.size,
      modifiedAtMs: details.mtimeMs,
    })
  } catch {
    return null
  }
}

function validSource(source: LocalHtmlPreviewSource): boolean {
  return /^[a-z\d_-]{1,128}$/i.test(source.id)
    && source.name.length > 0
    && source.name.length <= 255
    && !/[\\/\0\r\n]/.test(source.name)
    && /\.html?$/i.test(source.name)
}
