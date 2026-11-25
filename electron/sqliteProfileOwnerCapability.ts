import { lstatSync, realpathSync } from 'node:fs'
import path from 'node:path'
import {
  assertLiveSqliteExclusiveRuntime,
  type SqliteExclusiveRuntime,
  type SqliteOutput,
  type SqliteRow,
  type SqliteRuntime,
} from './sqliteRuntime'

declare const ownershipCapabilityBrand: unique symbol

export type SqliteProfileOwnershipCapability = Readonly<{
  [ownershipCapabilityBrand]: true
}>

type SqliteProfileOwnershipFence = Readonly<{
  ownerToken: string
  generation: number
  ownerId: string
}>

export type SqlitePhysicalFileIdentity = Readonly<{
  device: bigint
  inode: bigint
  birthtime: bigint
}>

type OwnershipCapabilityState = Readonly<{
  profileDatabasePath: string
  sidecarPath: string
  sidecarRuntime: SqliteExclusiveRuntime
  sidecarIdentity: SqlitePhysicalFileIdentity
  fence: SqliteProfileOwnershipFence
}>

export class SqliteProfileOwnershipCapabilityError extends Error {}

const capabilityStates = new WeakMap<
  SqliteProfileOwnershipCapability,
  OwnershipCapabilityState
>()

export function issueSqliteProfileOwnershipCapability(options: {
  profileDatabasePath: string
  sidecarPath: string
  sidecarRuntime: SqliteExclusiveRuntime
}): SqliteProfileOwnershipCapability {
  const profileDatabasePath = canonicalizeSqliteProfileDatabasePath(options.profileDatabasePath)
  const sidecarPath = canonicalizeAuthorityFilePath(options.sidecarPath)
  if (sidecarPath !== path.resolve(`${profileDatabasePath}.owner.sqlite`)) {
    throw new SqliteProfileOwnershipCapabilityError(
      'SQLite Profile ownership capability paths do not match',
    )
  }
  assertExclusiveRuntime(options.sidecarRuntime, sidecarPath)
  const sidecarIdentity = requireSqlitePhysicalFile(sidecarPath)
  const fence = readCurrentFence(options.sidecarRuntime)
  const capability = Object.freeze(Object.create(null)) as SqliteProfileOwnershipCapability
  capabilityStates.set(capability, Object.freeze({
    profileDatabasePath,
    sidecarPath,
    sidecarRuntime: options.sidecarRuntime,
    sidecarIdentity,
    fence,
  }))
  return capability
}

export function assertLiveSqliteProfileOwnershipCapability(
  capability: SqliteProfileOwnershipCapability,
  profileDatabasePath: string,
): void {
  resolveCapabilityState(capability, profileDatabasePath)
}

export function bindSqliteProfileOwnershipCapability(
  capability: SqliteProfileOwnershipCapability,
  profileRuntime: SqliteRuntime,
  profileDatabasePath: string,
): void {
  const fence = resolveCapabilityState(capability, profileDatabasePath).fence
  const current = profileRuntime.prepare(`
SELECT owner_token, generation
FROM profile_owner_fence
`).get()
  if (!current) {
    profileRuntime.prepare(`
INSERT INTO profile_owner_fence (profile_id, owner_token, generation, owner_id)
SELECT profile_id, ?, ?, ? FROM profile_meta
`).run(fence.ownerToken, fence.generation, fence.ownerId)
    return
  }
  const currentGeneration = readPositiveInteger(current, 'generation')
  const currentToken = readString(current, 'owner_token')
  if (currentGeneration === fence.generation && currentToken === fence.ownerToken) {
    profileRuntime.prepare('UPDATE profile_owner_fence SET owner_id = ?').run(fence.ownerId)
    return
  }
  if (fence.generation <= currentGeneration) {
    throw new SqliteProfileOwnershipCapabilityError('SQLite Profile ownership fence is stale')
  }
  const result = profileRuntime.prepare(`
UPDATE profile_owner_fence
SET owner_token = ?, generation = ?, owner_id = ?
WHERE generation < ?
`).run(fence.ownerToken, fence.generation, fence.ownerId, fence.generation)
  if (Number(result.changes) !== 1) {
    throw new SqliteProfileOwnershipCapabilityError(
      'SQLite Profile ownership fence did not advance',
    )
  }
}

export function assertSqliteProfileOwnershipCapability(
  capability: SqliteProfileOwnershipCapability,
  profileRuntime: SqliteRuntime,
  profileDatabasePath: string,
): void {
  const fence = resolveCapabilityState(capability, profileDatabasePath).fence
  const current = profileRuntime.prepare(`
SELECT owner_token, generation
FROM profile_owner_fence
`).get()
  if (
    !current
    || readString(current, 'owner_token') !== fence.ownerToken
    || readPositiveInteger(current, 'generation') !== fence.generation
  ) {
    throw new SqliteProfileOwnershipCapabilityError(
      'SQLite Profile ownership fence was lost',
    )
  }
}

function resolveCapabilityState(
  capability: SqliteProfileOwnershipCapability,
  profileDatabasePath: string,
): OwnershipCapabilityState {
  const state = capabilityStates.get(capability)
  if (
    !state
    || state.profileDatabasePath !== canonicalizeSqliteProfileDatabasePath(profileDatabasePath)
  ) {
    throw new SqliteProfileOwnershipCapabilityError(
      'SQLite Profile ownership capability was not issued for this Profile',
    )
  }
  assertExclusiveRuntime(state.sidecarRuntime, state.sidecarPath)
  assertSameSqlitePhysicalFile(
    state.sidecarIdentity,
    requireSqlitePhysicalFile(state.sidecarPath),
  )
  const current = readCurrentFence(state.sidecarRuntime)
  if (
    current.ownerToken !== state.fence.ownerToken
    || current.generation !== state.fence.generation
  ) {
    throw new SqliteProfileOwnershipCapabilityError(
      'SQLite Profile ownership capability is stale',
    )
  }
  return state
}

export function canonicalizeSqliteProfileDatabasePath(location: string): string {
  if (!path.isAbsolute(location) || location.includes('\0')) {
    throw new SqliteProfileOwnershipCapabilityError(
      'SQLite Profile capability path must be absolute',
    )
  }
  const resolved = path.resolve(location)
  try {
    return realpathSync.native(resolved)
  } catch (error) {
    if (readErrorCode(error) !== 'ENOENT') throw error
  }
  const parent = realpathSync.native(path.dirname(resolved))
  return path.join(parent, path.basename(resolved))
}

function canonicalizeAuthorityFilePath(location: string): string {
  if (!path.isAbsolute(location) || location.includes('\0')) {
    throw new SqliteProfileOwnershipCapabilityError(
      'SQLite Profile capability path must be absolute',
    )
  }
  const resolved = path.resolve(location)
  const parent = realpathSync.native(path.dirname(resolved))
  return path.join(parent, path.basename(resolved))
}

export function captureSqlitePhysicalFile(
  location: string,
): SqlitePhysicalFileIdentity | undefined {
  try {
    const file = lstatSync(location, { bigint: true })
    if (file.isSymbolicLink()) {
      throw new SqliteProfileOwnershipCapabilityError(
        'SQLite authority path cannot be a symbolic link',
      )
    }
    if (!file.isFile() || file.nlink !== 1n) {
      throw new SqliteProfileOwnershipCapabilityError(
        'SQLite authority path must be a single-link regular file',
      )
    }
    return Object.freeze({
      device: file.dev,
      inode: file.ino,
      birthtime: file.birthtimeNs,
    })
  } catch (error) {
    if (readErrorCode(error) === 'ENOENT') return undefined
    throw error
  }
}

export function requireSqlitePhysicalFile(location: string): SqlitePhysicalFileIdentity {
  const identity = captureSqlitePhysicalFile(location)
  if (!identity) {
    throw new SqliteProfileOwnershipCapabilityError('SQLite authority file is missing')
  }
  return identity
}

export function assertSameSqlitePhysicalFile(
  expected: SqlitePhysicalFileIdentity,
  actual: SqlitePhysicalFileIdentity,
): void {
  if (
    expected.device !== actual.device
    || expected.inode !== actual.inode
    || expected.birthtime !== actual.birthtime
  ) {
    throw new SqliteProfileOwnershipCapabilityError(
      'SQLite authority file identity changed',
    )
  }
}

function assertExclusiveRuntime(
  runtime: SqliteExclusiveRuntime,
  sidecarPath: string,
): void {
  try {
    assertLiveSqliteExclusiveRuntime(runtime, sidecarPath)
  } catch {
    throw new SqliteProfileOwnershipCapabilityError(
      'SQLite Profile ownership sidecar is not live',
    )
  }
}

function readCurrentFence(runtime: SqliteExclusiveRuntime): SqliteProfileOwnershipFence {
  let row: SqliteRow | undefined
  try {
    row = runtime.prepare(`
SELECT owner_token, generation, owner_id
FROM profile_owner_generation
WHERE identity = 1
`).get()
  } catch {
    throw new SqliteProfileOwnershipCapabilityError(
      'SQLite Profile ownership sidecar metadata is unavailable',
    )
  }
  return Object.freeze({
    ownerToken: readString(row, 'owner_token'),
    generation: readPositiveInteger(row, 'generation'),
    ownerId: readString(row, 'owner_id'),
  })
}

function readPositiveInteger(row: SqliteRow | undefined, key: string): number {
  const value = readColumn(row, key)
  const normalized = typeof value === 'bigint' ? Number(value) : value
  if (!Number.isSafeInteger(normalized) || Number(normalized) < 1) {
    throw new SqliteProfileOwnershipCapabilityError(`SQLite owner ${key} is invalid`)
  }
  return Number(normalized)
}

function readString(row: SqliteRow | undefined, key: string): string {
  const value = readColumn(row, key)
  if (typeof value !== 'string' || value.length === 0) {
    throw new SqliteProfileOwnershipCapabilityError(`SQLite owner ${key} is invalid`)
  }
  return value
}

function readColumn(row: SqliteRow | undefined, key: string): SqliteOutput | undefined {
  if (!row || !(key in row)) return undefined
  return row[key]
}

function readErrorCode(error: unknown): unknown {
  if (!error || typeof error !== 'object' || !('code' in error)) return undefined
  return error.code
}
